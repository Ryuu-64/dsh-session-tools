import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { brandString } from "@deepseek-ai/dsh-brand";

/** Stable Loader identity. */
const name = "tool-session";
/** No configuration: the tool contract is the whole surface. */
const Config = z.object({});
/** Host services this tool needs: the registry it registers into, and the Session it creates. */
const inject = [
	"tools",
	"agents",
	"sessionTitle",
	"workspaceRegistry",
	"agentDefaultModel"
];
/** Render the registered workspaces a caller may target, so a rejected path is actionable. */
function workspaceCatalogue(registry) {
	const items = registry.list();
	return items.map((workspace) => `${workspace.title} (${workspace.path})`).join("; ");
}
/**
* Inherit the calling Session's model route so the new conversation behaves like
* this one.
*
* The route is read from the Session's own `modelSelection` projection — the
* source the host session controller's `selectionFor` uses — because `ctx.agents`
* is the agent registry (`@deepseek-ai/dsh-agent`: create/resume/get only) and
* exposes no selection accessor. Asking it there returned undefined silently.
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
* Resolve the agent preset the new Session must mount: the calling Session's own
* preset when it owns one, otherwise the deployment's configured default.
*
* Read from the Session projection — the same source the host session
* controller's `presetForSession` uses — for the same reason as `currentSelection`
* above. Without this the new Session mounts no preset and therefore receives no
* tools at all: visible in the sidebar, but unable to do any work.
* @param ctx - agent-scoped services; host services resolve from the composition.
* @param agent - the calling Agent, whose Session carries the projection.
* @param presets - the deployment's agent preset service, when it has one.
* @returns the preset id to mount, or undefined when this deployment has none.
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
* Resolve the live Agent for one formal Session, resuming a cold one from its
* persisted header. Mirrors the host session controller's own resolve path —
* `agents.get` first, then the stored header, then `agents.resume` with the
* preset that header records — without depending on the web host plane.
* @param ctx - agent-scoped services; host services resolve from the composition.
* @param sessionId - target Session identity.
* @param callerAgent - the Agent whose model route a resume inherits.
* @returns the live or resumed Agent.
*/
async function resolveFormalAgent(ctx, sessionId, callerAgent) {
	const live = ctx.agents.get(sessionId);
	if (live !== void 0) return live;
	const query = ctx.get("sessionQuery");
	if (query === void 0) throw new Error(`session_send cannot resume ${JSON.stringify(sessionId)}: this deployment mounts no session query service`);
	let record;
	try {
		record = (await query.listSessions()).find((entry) => String(entry.header.id) === sessionId);
	} catch (error) {
		throw new Error(`session_send cannot read ${JSON.stringify(sessionId)}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (record === void 0) throw new Error(`session_send cannot reach ${JSON.stringify(sessionId)}: no live or persisted Session carries that id`);
	if (record.header.cwd === void 0) throw new Error(`session_send cannot resume ${JSON.stringify(sessionId)}: its stored header carries no working directory`);
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
* Register `session_create`: the host-side creation entry point for user-visible conversations.
* @param ctx - agent-scoped services; host services resolve from the enclosing composition.
*/
function apply(ctx) {
	ctx.tools.register(defineTool({
		name: "session_create",
		description: "Create an independent, user-visible conversation the human can open from the session list: a new Session that runs its own first turn. Pass workspacePath to attach it to that workspace's group, or omit workspacePath to create it under Ungrouped. The call returns as soon as the conversation exists; the new Session keeps running independently of this one. Use it when work needs its own conversation the user can see and continue, and use a subagent instead when the work should stay inside this conversation.",
		parameters: {
			prompt: {
				type: "string",
				required: true,
				description: "The new conversation's first user message. Self-contained: the new Session cannot see this conversation."
			},
			workspacePath: {
				type: "string",
				description: "Absolute path of an existing registered workspace the new conversation should belong to (for example \"E:\\\\Users\\\\Ryuu\\\\Desktop\"). Omit to create the conversation under Ungrouped. This tool never registers a workspace, so the path must already exist in the registry."
			},
			title: {
				type: "string",
				description: "Optional title. Omit to let the deployment's title generator name the conversation from its first prompt, exactly as a user-created conversation is named."
			},
			wait: {
				type: "boolean",
				description: "Wait for the new conversation's first turn to finish before returning. Defaults to false: creation is non-blocking."
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
				text: value.grouped ? `Created session ${value.sessionId} in workspace ${value.workspacePath}` : `Created ungrouped session ${value.sessionId}`
			}]
		},
		async execute(args, exec) {
			if (exec.agent === void 0) throw new Error("session_create requires an agent Session");
			const prompt = args.prompt.trim();
			if (prompt === "") throw new Error("session_create needs a non-empty prompt: it becomes the new conversation's first user message");
			let workspace;
			let cwd;
			if (args.workspacePath !== void 0) {
				const requested = args.workspacePath.trim();
				if (!isAbsolute(requested)) throw new Error(`session_create needs an absolute workspacePath, got ${JSON.stringify(args.workspacePath)}`);
				workspace = await ctx.workspaceRegistry.resolveByPath(requested);
				if (workspace === void 0) {
					throw new Error(`session_create: ${JSON.stringify(requested)} is not a registered workspace, and this tool never registers one as a side effect. Registered workspaces: ${workspaceCatalogue(ctx.workspaceRegistry)}. Retry with one of those paths, or omit workspacePath to create the conversation under Ungrouped.`);
				}
				cwd = workspace.path;
			} else {
				cwd = exec.agent.session.header.cwd;
				if (cwd === void 0) throw new Error("session_create needs the calling Session to have a working directory when it creates an ungrouped conversation");
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
		description: "Deliver a message into an existing formal conversation (a root Session, live or persisted) so that conversation continues on its own. Use it to hand information or a follow-up to another conversation, including one this Session created earlier. It never rewrites history, it cannot address a delegated subagent Session (use send_message for those), and it refuses this Session's own id. Delivery is non-blocking.",
		parameters: {
			sessionId: {
				type: "string",
				required: true,
				description: "Target Session id, for example \"session-2330bd36-fe62-4621-8d42-c7e04566f447\"."
			},
			message: {
				type: "string",
				required: true,
				description: "Message text. Self-contained: the target cannot see this conversation unless the user referenced it."
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
			if (exec.agent === void 0) throw new Error("session_send requires an agent Session");
			const requested = args.sessionId.trim();
			if (requested === "") throw new Error("session_send needs a non-empty sessionId");
			const message = args.message.trim();
			if (message === "") throw new Error("session_send needs a non-empty message");
			const target = await resolveFormalAgent(ctx, requested, exec.agent);
			const targetId = String(target.id);
			if (targetId === String(exec.agent.id)) throw new Error("session_send refuses this Session's own id: a conversation does not message itself");
			const depth = target.session.header.delegationDepth ?? 0;
			if (depth > 0) throw new Error(`session_send addresses formal conversations only: ${JSON.stringify(targetId)} is a delegated Session at depth ${depth}. Use send_message for a continuable child.`);
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
