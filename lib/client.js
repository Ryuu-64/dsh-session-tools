/**
 * Browser half: render the `session_create` tool card as something the person
 * can act on. The host half persists an explicit target in presentationMeta;
 * this half uses that durable identity, never an id guessed from the receipt.
 *
 * Loaded by the browser module table as a CJS closure factory; `require` resolves
 * only platform seeds and other registered bundles.
 */
window.__ModuleLoader__.load({
	id: "@ryuu-64/dsh-session-tools",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const { MenuItemButton, Modal, Button, Switch } = require("@deepseek-ai/dsh-client-ui-primitives");

		/** Slots this client half needs before it can register anything. */
		const inject = ["slots", "sessions"];

		/**
		* Flatten a settled result's content blocks, mirroring how `ui-tool` reads
		* them: text blocks verbatim, anything else as JSON.
		* @param node - a candidate settled result node.
		* @returns the flattened text, or "" when this is not a result node.
		*/
		function resultText(node) {
			if (node === null || typeof node !== "object" || !Array.isArray(node.content)) return "";
			return node.content
				.map((part) => (part !== null && typeof part === "object" && part.type === "text" && typeof part.text === "string"
					? part.text
					: JSON.stringify(part)))
				.join("\n");
		}

		/**
		* Read only the successful ToolResultNode's durable presentation metadata.
		* rc.2 projects event.data.meta here; canonical value is not persisted.
		* Old receipts cannot prove identity, even when only one id is visible.
		* @param block - the running or settled tool call block handed to the slot.
		* @returns the session id and optional title, or undefined.
		*/
		function readCreatedSession(block) {
			if (block === null || typeof block !== "object" || block.kind !== "tool-result" || block.isError !== false) return undefined;
			const meta = block.meta;
			if (meta === null || typeof meta !== "object" || Array.isArray(meta)) return undefined;
			if (typeof meta.sessionId !== "string" || !/^session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(meta.sessionId)) return undefined;
			return { sessionId: meta.sessionId, title: typeof meta.title === "string" ? meta.title : undefined };
		}

		/**
		* One row for a finished `session_create` call: what was created, and a
		* button that opens it in the conversation area.
		* @param props - slot owner props plus the injected `openSession`.
		* @returns the row element.
		*/
		function SessionCreateRow(props) {
			const openSession = props.openSession ?? props.slot?.injected?.openSession;
			const created = readCreatedSession(props.block);
			if (created === undefined) {
				// Keep errors and legacy receipts readable, without claiming a
				// successful creation or inventing a clickable navigation target.
				const text = resultText(props.block);
				const fallback = props.block?.kind === "tool-result" ? "没有可用的会话创建结果" : "正在创建会话…";
				return react.createElement("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, text || fallback);
			}
			const title = created.title === undefined || created.title === "" ? "会话" : created.title;
			const canOpen = typeof openSession === "function";
			const onOpen = () => {
				if (!canOpen) return;
				try {
					openSession(created.sessionId);
				} catch (error) {
					console.error("[session-tools] opening the session failed:", error);
				}
			};
			return react.createElement(
				"div",
				{
					style: {
						display: "flex",
						alignItems: "center",
						gap: "8px",
						flexWrap: "wrap",
						fontSize: "13px",
					},
				},
				react.createElement("span", null, "已创建会话"),
				react.createElement(
					"button",
					{
						type: "button",
						onClick: onOpen,
						disabled: !canOpen,
						title: created.sessionId,
						style: {
							border: "1px solid var(--dsh-border, #3a4150)",
							background: "transparent",
							color: "inherit",
							borderRadius: "999px",
							padding: "1px 10px",
							cursor: canOpen ? "pointer" : "default",
							font: "inherit",
							opacity: canOpen ? "1" : "0.55",
						},
					},
					title,
				),
				react.createElement("span", { style: { opacity: 0.55, fontFamily: "ui-monospace, monospace", fontSize: "11px" } }, created.sessionId),
				react.createElement("div", { style: { flexBasis: "100%" } }, react.createElement(MessageStateRow, { block: props.block })),
			);
		}


		const statusLabels = {
			queued: "已排队", delivered: "已交给目标", turnCompleted: "目标本轮结束（不等于任务成功）",
			discarded: "取消", cancelled: "取消", interrupted: "中断", failed: "失败", incomplete: "未完整结束",
			blocked: "未完整结束", unknown: "暂无法确认",
		};
		function MessageStateRow({ block }) {
			const text = resultText(block);
			if (block?.kind !== "tool-result") return react.createElement("span", { role: "status" }, "正在处理…");
			const meta = block.meta;
			if (block.isError || meta?.scope === "sessionOverview" || typeof meta?.messageId !== "string") {
				return react.createElement("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, text || "暂无法确认");
			}
			return react.createElement("div", { style: { display: "grid", gap: 6 } },
				react.createElement("strong", null, statusLabels[meta.messageStatus] ?? "暂无法确认"),
				meta.waitStatus === "timedOut" && react.createElement("div", null, "等待超时。没有重发，也没有取消；请用同一消息编号继续查询。"),
				meta.waitStatus === "callerCancelled" && react.createElement("div", null, "已停止等待，目标会话继续处理。"),
				react.createElement("details", null, react.createElement("summary", null, "消息编号与结果详情"),
					react.createElement("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--dsw-alias-label-secondary)" } }, text)));
		}
		const remoteContribution = (() => {
			// TypertSchema requires parse(value); keep these strict schemas local to
			// this browser bundle because Zod is not a platform module seed.
			const scalar = check => value => {
				if (!check(value)) throw new TypeError("Invalid session communication field");
				return value;
			};
			const object = fields => ({ parse(value) {
				if (!value || typeof value !== "object" || Array.isArray(value)
					|| Object.keys(value).some(key => !Object.hasOwn(fields, key))
					|| Object.keys(fields).some(key => !Object.hasOwn(value, key))) {
					throw new TypeError("Invalid session communication object");
				}
				return Object.fromEntries(Object.entries(fields).map(([key, parse]) => [key, parse(value[key])]));
			} });
			const sessionId = scalar(value => typeof value === "string" && value.length >= 1 && value.length <= 1024);
			const boolean = scalar(value => typeof value === "boolean");
			const revision = scalar(value => Number.isSafeInteger(value) && value >= 0);
			const getSchema = object({ sessionId });
			const setSchema = object({ sessionId, send: boolean, receive: boolean, expectedRevision: revision });
			const recordSchema = object({ send: boolean, receive: boolean, revision });
			const setResultSchema = object({ status: scalar(value => value === "saved" || value === "conflict"), current: value => recordSchema.parse(value) });
			return {
				package: "@ryuu-64/dsh-session-tools",
				descriptors: ["get", "set"].map(method => ({
					id: `@ryuu-64/dsh-session-tools:sessionCommunication.${method}`,
					service: "sessionCommunication", namespace: "sessionCommunication", method,
					invocation: { kind: "direct" },
					parameters: [{ name: "request", wire: "request", source: "json", codec: {
						mode: "strict", typeSymbol: `@ryuu-64/dsh-session-tools:sessionCommunication.${method}:request`,
						create: () => method === "get" ? getSchema : setSchema,
					} }],
					result: {
						mode: "strict", typeSymbol: `@ryuu-64/dsh-session-tools:sessionCommunication.${method}:result`,
						create: () => method === "get" ? recordSchema : setResultSchema,
					},
				})),
			};
		})();
		function validRecord(value) {
			return value && typeof value.send === "boolean" && typeof value.receive === "boolean" && Number.isSafeInteger(value.revision) && value.revision >= 0;
		}
		function CommunicationForm({ request, api, close }) {
			const [record, setRecord] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [notice, setNotice] = react.useState("正在读取设置…");
			const [failed, setFailed] = react.useState(false);
			const inFlight = react.useRef(false);
			const alive = react.useRef(true);
			const read = async () => {
				if (inFlight.current) return;
				inFlight.current = true; setBusy(true); setNotice("正在读取设置…"); setFailed(false);
				try {
					const result = await api.get({ sessionId: request.sessionId });
					if (!result.ok || !validRecord(result.value)) { console.error("[session-tools] settings read failed", result.error?.message, JSON.stringify(result)); throw new Error("unavailable"); }
					if (alive.current) { setRecord(result.value); setNotice("设置已加载。更改后立即生效。"); }
				} catch (error) {
					console.error("[session-tools] settings read exception", error);
					if (alive.current) { setRecord(null); setFailed(true); setNotice("暂时无法读取设置，发送和接收状态尚未确认。请重试。"); }
				} finally { inFlight.current = false; if (alive.current) setBusy(false); }
			};
			react.useEffect(() => { alive.current = true; void read(); return () => { alive.current = false; }; }, []);
			const change = async (key, next) => {
				if (!record || inFlight.current) return;
				inFlight.current = true; setBusy(true); setFailed(false); setNotice("正在保存… 关闭窗口不会取消已提交的更改；重新打开可查看结果。");
				try {
					const result = await api.set({ sessionId: request.sessionId, send: record.send, receive: record.receive, [key]: next, expectedRevision: record.revision });
					if (!result.ok || !validRecord(result.value?.current) || !["saved", "conflict"].includes(result.value?.status)) throw new Error("unconfirmed");
					if (alive.current) {
						setRecord(result.value.current);
						setFailed(result.value.status === "conflict");
						setNotice(result.value.status === "saved" ? "已保存，立即生效。" : "设置已在其他页面更改。已显示最新设置，请确认后再操作。");
					}
				} catch {
					if (alive.current) { setRecord(null); setFailed(true); setNotice("保存结果暂无法确认。请重新读取设置；不会自动重复保存。"); }
				} finally { inFlight.current = false; if (alive.current) setBusy(false); }
			};
			// Dismissal never waits on storage or the network. An accepted write may
			// still finish; reopening always reads the authoritative saved value.
			const onClose = close;
			const row = (key, label, description) => react.createElement("div", { key, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, padding: "16px 0", borderBottom: "0.5px solid var(--dsw-alias-border-l2)" } },
				react.createElement("div", { style: { flex: 1, minWidth: 0 } }, react.createElement("div", { style: { fontSize: 14, lineHeight: "20px", color: "var(--dsw-alias-label-primary)" } }, label), react.createElement("div", { style: { marginTop: 4, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" } }, description)),
				react.createElement("span", { "aria-hidden": true, style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: "18px" } }, record[key] ? "开启" : "关闭"),
				react.createElement(Switch, { checked: record[key], onChange: value => void change(key, value), label, disabled: busy }));
			return react.createElement(Modal, {
				open: true, onClose, closeLabel: "关闭", title: "会话通信", description: request.title || request.sessionId,
				footer: react.createElement(Button, { variant: "outline", onClick: onClose }, "关闭"),
			}, react.createElement("div", { style: { minWidth: 0, fontSize: 14, lineHeight: "22px" } },
				react.createElement("div", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: "18px" } }, "控制通过本插件发送和接收的新消息。"),
				record && row("send", "向其他会话发送", "允许这个会话发消息，也允许它创建带首条消息的新会话。"),
				record && row("receive", "接收其他会话消息", "允许其他会话向这个会话发送新消息。"),
				react.createElement("p", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: "18px", margin: "16px 0" } }, "关闭后会拒绝新的发送或接收。已经接收的消息会继续处理，历史记录仍可查看。"),
				react.createElement("div", { role: failed ? "alert" : "status", "aria-live": "polite", style: { fontSize: 12, lineHeight: "18px", minHeight: 18, color: failed ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-secondary)" } }, notice),
				!record && !busy && react.createElement(Button, { variant: "outline", onClick: () => void read() }, "重新读取")));
		}
		function registerCommunicationUI(ctx, api) {
			let request = null;
			const listeners = new Set();
			const publish = value => { request = value; for (const listener of listeners) listener(); };
			const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
			function Overlay() {
				const current = react.useSyncExternalStore(subscribe, () => request);
				return current ? react.createElement(CommunicationForm, { key: current.sessionId, request: current, api, close: () => publish(null) }) : null;
			}
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "session-tools.communication" }, Overlay));
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({ name: "sidebar.workspaces.session.menu.item", id: "session-tools.communication", order: 350 },
				({ sessionId, displayTitle, useMenuOpenState }) => {
					const [, setMenuOpen] = useMenuOpenState();
					return react.createElement(MenuItemButton, { onSelect: () => { setMenuOpen(false); publish({ sessionId, title: displayTitle }); } }, "会话通信…");
				}));
		}

		/**
		* Wait for the tool view slot list to exist, then register a keyed row that
		* replaces the default card for `session_create`.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			ctx.inject(["remote"], async scope => {
				try {
					await scope.remote.$mount(remoteContribution);
					scope.inject(["remote.sessionCommunication"], ui => {
						registerCommunicationUI(ui, ui.remote.sessionCommunication);
					});
				} catch(error) { console.error("[session-tools] communication UI initialization failed", error); throw error; }
			});
			ctx.slots.inject("tool.call.toolview", function* () {
				for (const key of ["session_send", "session_wait"]) yield ctx.slots.register({ name: "tool.call.toolview", key }, MessageStateRow);
			});
			const register = (scope, openSession) => scope.slots.inject("tool.call.toolview", () => scope.slots.register(
				{
					name: "tool.call.toolview",
					key: "session_create",
					inject: () => ({ openSession }),
				},
				SessionCreateRow,
			));
			// Pre-0.2 hosts put UI selection on sessions. In 0.2 the Session
			// Controller only owns data/references; UIWorkspace owns mainView
			// retention, selection, panel reveal and release. Do not retain a
			// second reference here or await a history load before navigating.
			if (typeof ctx.sessions.open === "function") {
				register(ctx, (sessionId) => ctx.sessions.open(sessionId));
			} else {
				// Package client.inject is not a startup-order guarantee. Wait for
				// the actual service and bind the row to that service's lifetime.
				ctx.inject(["uiWorkspace"], (scope) => register(scope,
					(sessionId) => scope.uiWorkspace.openSession(sessionId)));
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
