import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { brandString } from "@deepseek-ai/dsh-brand";

/** Stable Loader identity. */
const name = "tool-session";
/** Nothing to configure. */
const Config = z.object({});
/** Host services this tool needs: where it registers tools, and what it creates a session with. */
const inject = [
	"tools",
	"agents",
	"sessionTitle",
	"workspaceRegistry",
	"agentDefaultModel"
];
/** List the existing workspaces, so a rejected path tells the caller what to use instead. */
function workspaceCatalogue(registry) {
	const items = registry.list();
	return items.map((workspace) => `${workspace.title} (${workspace.path})`).join("; ");
}
/**
* Give the new session the same model as this one: read the model the calling
* session is using, and fall back to the default when it has not chosen one.
*/
function currentSelection(ctx, agent) {
	const projections = ctx.get("sessionProjections");
	let inherited;
	if (projections !== void 0) try {
		const state = projections.stateOf(agent.session, "modelSelection");
		inherited = state?.pending ?? state?.lastUsed ?? void 0;
	} catch {}
	if (inherited !== void 0) return {
		provider: inherited.provider,
		model: inherited.model,
		...inherited.reasoningEffort === void 0 ? {} : { reasoningEffort: inherited.reasoningEffort }
	};
	const selected = ctx.agentDefaultModel.currentSelection();
	return {
		provider: selected.provider,
		model: selected.model
	};
}
/**
* Find the agent preset the new session should start on: the one this session
* uses, or the default preset when this session has none. A new session without
* a preset gets no tools, so it would sit in the list unable to do anything.
* @param ctx - services of the calling agent.
* @param agent - the calling agent.
* @param presets - the preset registry, when one is composed.
* @returns the preset id to use, or undefined when there is none.
*/
async function resolvePreset(ctx, agent, presets) {
	const projections = ctx.get("sessionProjections");
	if (projections !== void 0) try {
		const current = projections.stateOf(agent.session, "agentPreset");
		if (current !== void 0) return current;
	} catch {}
	if (presets === void 0) return void 0;
	try {
		return (await presets.resolve(void 0)).id;
	} catch {
		return void 0;
	}
}
/**
* Get the live agent for a target session, opening the session again when it is
* not currently running. The session is reopened on the preset it was created
* with.
* @param ctx - services of the calling agent.
* @param sessionId - the target session.
* @param callerAgent - the calling agent, whose model the reopened session inherits.
* @returns the live or resumed Agent.
*/
async function resolveTargetAgent(ctx, sessionId, callerAgent) {
	const live = ctx.agents.get(sessionId);
	if (live !== void 0) return live;
	const query = ctx.get("sessionQuery");
	if (query === void 0) throw new Error(`session_send cannot open ${JSON.stringify(sessionId)}: this DSH does not offer session lookup`);
	let record;
	try {
		record = (await query.listSessions()).find((entry) => String(entry.header.id) === sessionId);
	} catch (error) {
		throw new Error(`session_send cannot read ${JSON.stringify(sessionId)}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (record === void 0) throw new Error(`session_send cannot find session ${JSON.stringify(sessionId)}: no open or saved session has that id`);
	if (record.header.cwd === void 0) throw new Error(`session_send cannot open ${JSON.stringify(sessionId)}: the saved session records no working directory`);
	const agentPresets = ctx.get("agentPresets");
	const presetId = record.header.agentPreset;
	const setup = agentPresets === void 0 || presetId === void 0 ? void 0 : async (agentCtx) => {
		await agentPresets.mount(agentCtx, presetId);
	};
	const resumed = await ctx.agents.resume({
		resumeSessionId: sessionId,
		agentOptions: currentSelection(ctx, callerAgent),
		...setup === void 0 ? {} : { setup }
	});
	return resumed.agent;
}
/**
* Register `session_create` and `session_send`.
* @param ctx - services of the agent this plugin was loaded for.
*/
function apply(ctx) {
	ctx.tools.register(defineTool({
		name: "session_create",
		description: "Start a new chat session the person can see in the session list. The new session runs its own first turn and keeps going on its own; this call returns as soon as it exists. Pass workspacePath to put it under that workspace, or leave it out to leave it ungrouped. Use this when the work deserves its own session the person can open and continue; use a subagent instead when the work should stay inside this conversation.",
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "The new session's first user message. Write it self-contained: the new session cannot see this conversation."
			},
			workspacePath: {
				type: "string",
				description: "Full path of a workspace that already exists (for example \"E:\\\\Users\\\\Ryuu\\\\Desktop\"). Leave it out to leave the new session ungrouped. This tool never creates a workspace, so an unknown path fails with the list of existing ones."
			},
			title: {
				type: "string",
				description: "Optional title. Leave it out and the title is generated from the first message, exactly like a session the person creates by hand."
			},
			wait: {
				type: "boolean",
				description: "Wait for the new session's first turn to finish before returning. Defaults to false."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					sessionId: {
						type: "string",
						required: true
					},
					grouped: {
						type: "boolean",
						required: true
					},
					cwd: {
						type: "string",
						required: true
					},
					workspaceId: { type: "string" },
					workspacePath: { type: "string" }
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: value.grouped ? `Created session ${value.sessionId} in workspace ${value.workspacePath}` : `Created session ${value.sessionId}, ungrouped`
			}]
		},
		async execute(args, exec) {
			if (exec.agent === void 0) throw new Error("session_create must run inside a session");
			const prompt = args.prompt.trim();
			if (prompt === "") throw new Error("session_create needs a prompt: it becomes the new session's first user message");
			let workspace;
			let cwd;
			if (args.workspacePath !== void 0) {
				const requested = args.workspacePath.trim();
				if (!isAbsolute(requested)) throw new Error(`session_create needs a full workspace path, got ${JSON.stringify(args.workspacePath)}`);
				workspace = await ctx.workspaceRegistry.resolveByPath(requested);
				if (workspace === void 0) {
					throw new Error(`session_create cannot use ${JSON.stringify(requested)}: no workspace has that path, and this tool does not create workspaces. Existing workspaces: ${workspaceCatalogue(ctx.workspaceRegistry)}. Use one of those paths, or leave workspacePath out to create the session under Ungrouped.`);
				}
				cwd = workspace.path;
			} else {
				cwd = exec.agent.session.header.cwd;
				if (cwd === void 0) throw new Error("session_create needs a working directory, and this session has none");
			}
			const agentOptions = currentSelection(ctx, exec.agent);
			const agentPresets = ctx.get("agentPresets");
			const presetId = await resolvePreset(ctx, exec.agent, agentPresets);
			const sessionId = brandString(`session-${randomUUID()}`);
			let handle;
			let attached = false;
			try {
				handle = await ctx.agents.create({
					sessionId,
					agentOptions,
					meta: {
						cwd,
						...presetId === void 0 ? {} : { agentPreset: presetId }
					},
					...agentPresets === void 0 || presetId === void 0 ? {} : { setup: async (agentCtx) => {
						await agentPresets.mount(agentCtx, presetId);
					} }
				});
				if (workspace !== void 0) {
					await workspace.attachSession(sessionId);
					attached = true;
				}
				const title = args.title === void 0 ? void 0 : args.title.trim();
				if (title !== void 0 && title !== "") ctx.sessionTitle.rename(handle.agent.session, title);
				handle.agent.followup(createUserMessage({
					content: [{
						type: "text",
						text: prompt
					}],
					source: {
						kind: "plugin",
						plugin: name
					}
				}));
				if (args.wait === true) await handle.agent.whenIdle();
			} catch (error) {
				if (attached) try {
					await workspace.detachSession(sessionId);
				} catch {}
				if (handle !== void 0) try {
					await handle.dispose();
				} catch {}
				throw error;
			}
			return {
				sessionId: String(sessionId),
				grouped: workspace !== void 0,
				cwd,
				...workspace === void 0 ? {} : {
					workspaceId: String(workspace.id),
					workspacePath: workspace.path
				}
			};
		}
	}));
	ctx.tools.register(defineTool({
		name: "session_send",
		description: "Send a message to an existing chat session so that session continues on its own — including one this session started earlier. It cannot send to itself, cannot send to a subagent the agent spawned (use send_message for those), and never rewrites past messages. Sending returns right away; the target handles the message when it can.",
		parameters: {
			sessionId: {
				type: "string",
				required: true,
				description: "Target Session id, for example \"session-2330bd36-fe62-4621-8d42-c7e04566f447\"."
			},
			message: {
				type: "string",
				required: true,
				description: "Message text. Write it self-contained: the target cannot see this conversation unless the person linked the two."
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					sessionId: {
						type: "string",
						required: true
					},
					cwd: {
						type: "string",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `Delivered to session ${value.sessionId}`
			}]
		},
		async execute(args, exec) {
			if (exec.agent === void 0) throw new Error("session_send must run inside a session");
			const requested = args.sessionId.trim();
			if (requested === "") throw new Error("session_send needs a session id");
			const message = args.message.trim();
			if (message === "") throw new Error("session_send needs a message");
			const target = await resolveTargetAgent(ctx, requested, exec.agent);
			const targetId = String(target.id);
			if (targetId === String(exec.agent.id)) throw new Error("session_send cannot send to its own session: use the current conversation instead");
			const depth = target.session.header.delegationDepth ?? 0;
			if (depth > 0) throw new Error(`session_send cannot send to ${JSON.stringify(targetId)}: that is a subagent session, not a regular one. Use send_message for it.`);
			target.followup(createUserMessage({
				content: [{
					type: "text",
					text: message
				}],
				source: {
					kind: "plugin",
					plugin: name
				}
			}));
			return {
				sessionId: targetId,
				cwd: String(target.session.header.cwd ?? "")
			};
		}
	}));
}
export { Config, apply, inject, name };
