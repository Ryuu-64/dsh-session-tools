import { symbols } from "@deepseek-ai/cordis";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z } from "zod";

const maxExplicitRounds = 256;
const activeFiberState = 2; // Cordis FiberState.ACTIVE is a compile-time enum.
const grants = defineDomain({
	name: "session_tools_goal_grants",
	version: 1,
	tables: {
		grants: domainTable(z.object({
			sessionId: z.string(),
			grantedBy: z.string(),
			turnStartSeq: z.number().int().nonnegative(),
			rounds: z.number().int().positive(),
			at: z.number().int().nonnegative(),
		}).strict()),
	},
});
const domains = new WeakMap();

function grantTableReader(ctx) {
	const storage = ctx.get("storageDomain");
	const identity = storage[symbols.original] ?? storage;
	let shared = domains.get(identity);
	if (!shared || shared.closing) {
		shared = { owners: 0, predecessor: shared?.closing };
		domains.set(identity, shared);
	}
	shared.owners++;
	let released = false;
	const assertActive = () => {
		if (released) throw new Error("Session goal tools were unloaded");
	};
	ctx.effect?.(() => () => {
		released = true;
		if (--shared.owners > 0) return;
		shared.closing = (shared.ready ?? shared.predecessor ?? Promise.resolve())
			.catch(() => undefined)
			.then(domain => domain?.close())
			.finally(() => {
				if (domains.get(identity) === shared) domains.delete(identity);
			});
		return shared.closing;
	});
	return async () => {
		assertActive();
		shared.ready ??= shared.predecessor
			? shared.predecessor.then(() => storage.open(grants))
			: storage.open(grants);
		const domain = await shared.ready;
		assertActive();
		return domain.table("grants");
	};
}

function requireGoals(ctx) {
	const goals = ctx.get("goals");
	if (!goals) throw new Error("Session goals require the DSH goals service (dsh-goal)");
	return goals;
}

function serviceIdentity(service) {
	return service?.[symbols.original] ?? service;
}

function requireRoundDriver(ctx, goals) {
	const goalService = serviceIdentity(goals);
	if (serviceIdentity(ctx.get("goals")) !== goalService) throw new Error("The DSH goals service changed. Retry the goal operation");
	const agents = serviceIdentity(ctx.agents);
	// The first-party driver registers listeners and has no service of its own.
	for (const runtime of ctx.registry?.values() ?? []) {
		if (runtime.name !== "goal-round-driver") continue;
		for (const fiber of runtime.fibers) {
			if (fiber.state === activeFiberState && serviceIdentity(fiber.ctx.get("goals")) === goalService &&
				serviceIdentity(fiber.ctx.get("agents")) === agents) return;
		}
	}
	throw new Error("Creating or resuming a session goal requires an active DSH goal round driver (dsh-goal-round-driver)");
}

function humanTurn(ctx, exec) {
	exec.signal?.throwIfAborted();
	const agent = exec.agent;
	const header = agent?.session?.header;
	if (!header || header.origin === "subagent" || (header.delegationDepth ?? 0) > 0 ||
		ctx.agents.get(agent.id) !== agent || agent.status !== "running" ||
		ctx.agents.currentInitiator?.() !== agent) {
		throw new Error("Changing a child session goal requires a direct human turn in the parent session");
	}
	const boundary = typeof ctx.agents.turnBoundaryOf === "function"
		? ctx.agents.turnBoundaryOf(agent.session)
		: ctx.get("sessionProjections")?.stateOf(agent.session, "turnBoundary");
	const start = boundary?.openTurnStartSeq;
	if (Number.isSafeInteger(start) && start >= (agent.session.inheritedEventCount ?? 0)) {
		const events = agent.session.snapshotEvents();
		for (let seq = start + 1; seq < events.length; seq++) {
			const event = events[seq];
			if (event?.type === "user/message" && event.data.source.kind === "user") return start;
		}
	}
	throw new Error("Changing a child session goal requires a direct human turn in the parent session");
}

function assertHumanTurn(ctx, exec, start) {
	if (humanTurn(ctx, exec) !== start) throw new Error("The approving turn has ended. Request the goal change again in a human turn");
}

function directChild(ctx, parentId, sessionId) {
	const target = ctx.agents.get(sessionId);
	const header = target?.session?.header;
	if (!header || String(header.id) !== sessionId || sessionId === parentId ||
		header.parentSession !== parentId || header.origin === "subagent" || (header.delegationDepth ?? 0) > 0) {
		throw new Error("session_goal requires an open, ordinary direct child session");
	}
	return target;
}

function normalizeObjective(value) {
	const objective = value.trim();
	if (objective === "" || Array.from(objective).length > 4000) {
		throw new Error("A session goal objective must contain 1 to 4000 characters");
	}
	return objective;
}

function validateRounds(rounds) {
	if (rounds !== undefined && (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > maxExplicitRounds)) {
		throw new Error(`Session goal rounds must be an integer from 1 to ${maxExplicitRounds}`);
	}
	return rounds;
}

export function roundLimitDescription(rounds) {
	return rounds === undefined ? "using the host's configured round limit" : `up to ${rounds} automatic rounds`;
}

function ref(goal) {
	return { id: goal.id, revision: goal.revision };
}

function sameRef(a, b) {
	return a?.id === b?.id && a?.revision === b?.revision;
}

export const createGoalParameter = {
	oneOf: [
		{ type: "boolean", const: true },
		{ type: "object", additionalProperties: false, properties: { rounds: { type: "integer", required: true } } },
	],
	description: "Opt in to a persistent goal using prompt as the objective. Requires direct human input in this turn and the active DSH goal round driver. Use true for the host's configured round limit, or { rounds } to set an explicit limit from 1 to 256.",
};

export const goalOutput = {
	oneOf: [
		{ type: "null" },
		{
			type: "object",
			additionalProperties: true,
			properties: {
				id: { type: "string", required: true },
				revision: { type: "integer", required: true },
				objective: { type: "string", required: true },
				phase: { type: "string", enum: ["active", "paused", "blocked", "complete"], required: true },
				activation: { type: "string", enum: ["armed", "disarmed"], required: true },
				maxGoalRounds: { type: "integer", required: true },
				roundsStarted: { type: "integer", required: true },
			},
		},
	],
};

export function sessionGoals(ctx, permissions, requireApproval) {
	const readGrantTable = grantTableReader(ctx);
	// Stage the host goal disarmed while writing its exact identity to storage.
	// The driver's goal-change checkpoint yields before it can start an idle round.
	async function grant(exec, target, spec, table, checkAdmission, start) {
		const { goals, objective, rounds, turn } = spec;
		assertHumanTurn(ctx, exec, turn);
		directChild(ctx, exec.agent.id, target.id);
		requireRoundDriver(ctx, goals);
		const created = goals.create(target, { objective, ...(rounds === undefined ? {} : { maxGoalRounds: rounds }) });
		let owned = created;
		try {
			goals.disarm(target);
			await table.put(created.id, {
				sessionId: String(target.id), grantedBy: String(exec.agent.id),
				turnStartSeq: turn, rounds: created.maxGoalRounds, at: Date.now(),
			});
			checkAdmission();
			assertHumanTurn(ctx, exec, turn);
			requireRoundDriver(ctx, goals);
			if (!sameRef(goals.get(target), created)) throw new Error("The target goal changed during creation");
			owned = goals.resume(target, ref(created));
			start?.();
			return owned;
		} catch (error) {
			// Avoid undoing an operator's concurrent mutation of the staged goal.
			try {
				const current = goals.get(target);
				if (sameRef(current, owned) && current.roundsStarted === 0) goals.clear(target, ref(current));
			} catch {}
			throw error;
		}
	}

	return {
		async prepareCreate(exec, prompt, option) {
			const goals = requireGoals(ctx);
			requireRoundDriver(ctx, goals);
			return {
				goals,
				turn: humanTurn(ctx, exec),
				objective: normalizeObjective(prompt),
				rounds: validateRounds(option === true ? undefined : option.rounds),
				table: await readGrantTable(),
			};
		},
		checkContinuation(spec) {
			requireRoundDriver(ctx, spec.goals);
		},
		startCreated(exec, target, spec, checkAdmission, start) {
			return grant(exec, target, spec, spec.table, checkAdmission, start);
		},
		tool: defineTool({
			name: "session_goal",
			description: "Read or manage a persistent goal in an open, ordinary direct child session. Changes require direct human input in the parent turn. Manage goals granted by this session. Set creates a goal, replaces a completed goal, or edits an unfinished one. Pause stops continuation, resume restarts it, and clear removes the goal.",
			parameters: {
				sessionId: { type: "string", required: true, description: "Open direct child session ID." },
				action: { type: "string", required: true, enum: ["get", "set", "pause", "resume", "clear"] },
				objective: { type: "string", description: "For set only. Required for a new goal, up to 4000 characters." },
				rounds: { type: "integer", description: "For set only. Explicit total automatic rounds from 1 to 256, including rounds already started. Omit to use the host default on creation or keep the existing limit when editing." },
			},
			output: {
				schema: { type: "object", additionalProperties: false, properties: {
					sessionId: { type: "string", required: true },
					managed: { type: "boolean", required: true },
					goal: { ...goalOutput, required: true },
				} },
				render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
			},
			async execute(args, exec) {
				const goals = requireGoals(ctx);
				const parentId = exec.agent?.session?.header.id;
				if (!parentId || exec.agent.id !== parentId || ctx.agents.get(parentId) !== exec.agent) {
					throw new Error("session_goal requires a live calling session");
				}
				exec.signal?.throwIfAborted();
				const sessionId = args.sessionId.trim();
				const { action } = args;
				if (action !== "set" && (args.objective !== undefined || args.rounds !== undefined)) {
					throw new Error("objective and rounds are only accepted by session_goal set");
				}
				const objective = args.objective === undefined ? undefined : normalizeObjective(args.objective);
				const rounds = validateRounds(args.rounds);
				const turn = action === "get" ? undefined : humanTurn(ctx, exec);
				const target = directChild(ctx, parentId, sessionId);
				const table = await readGrantTable();
				exec.signal?.throwIfAborted();
				if (directChild(ctx, parentId, sessionId) !== target) throw new Error("The target session changed");
				const snapshot = goals.get(target);
				const isManaged = goal => {
					const grant = goal && table.get(goal.id);
					return grant?.grantedBy === parentId && grant.sessionId === sessionId;
				};
				const result = goal => ({ sessionId, managed: isManaged(goal), goal: goal ?? null });
				if (action === "get") return result(snapshot);
				if (snapshot && !isManaged(snapshot)) throw new Error("This session did not grant the current goal. Manage it from the target session");
				const creating = action === "set" && (!snapshot || snapshot.phase === "complete");
				if (creating && objective === undefined) throw new Error("A new session goal needs an objective");
				if (!snapshot && action !== "set") {
					if (action === "clear") return result(undefined);
					throw new Error("The child session has no current goal");
				}
				const addingWork = action === "set" || action === "resume";
				if (action === "pause" && snapshot?.phase === "complete") {
					throw new Error("This goal is already complete. There is no need to pause it.");
				}
				const limit = creating ? rounds : rounds ?? snapshot?.maxGoalRounds;
				if (creating || action === "resume") requireRoundDriver(ctx, goals);
				if (addingWork) await permissions.check(parentId, sessionId);
				const operation = creating && snapshot ? "replace the completed goal with a new persistent goal" : `${action} the persistent goal`;
				await requireApproval(ctx, exec, `${operation} in child session ${JSON.stringify(sessionId)}` +
					(addingWork ? ` (${roundLimitDescription(limit)})` : "") +
					(action === "pause" ? " (may interrupt its current turn)" : "") +
					(objective === undefined ? "" : `: ${objective.slice(0, 120)}`));
				const change = async checkAdmission => {
					assertHumanTurn(ctx, exec, turn);
					if (directChild(ctx, parentId, sessionId) !== target) throw new Error("The target session changed during approval");
					const current = goals.get(target);
					if (!sameRef(snapshot, current)) throw new Error("The target goal changed during approval. Read it again before retrying");
					if (creating) return result(await grant(exec, target, { goals, turn, objective, rounds }, table, checkAdmission));
					switch (action) {
						case "clear":
							goals.clear(target, ref(current));
							return result(undefined);
						case "pause":
							return result(current.phase === "paused" ? current : goals.pause(target, ref(current)));
						case "resume":
							requireRoundDriver(ctx, goals);
							return result(current.phase === "active" && current.activation === "armed" ? current : goals.resume(target, ref(current)));
						case "set": {
							const changes = {};
							if (objective !== undefined && objective !== current.objective) changes.objective = objective;
							if (rounds !== undefined && rounds !== current.maxGoalRounds) changes.maxGoalRounds = rounds;
							if (Object.keys(changes).length === 0) return result(current);
							if (rounds !== undefined && rounds < current.roundsStarted) throw new Error("The round limit cannot be below the number of rounds already started");
							return result(goals.edit(target, ref(current), changes));
						}
					}
				};
				return addingWork ? permissions.admit(parentId, sessionId, exec, change) : change();
			},
		}),
	};
}
