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
		const { MenuItemButton, Modal, Button, Switch, ReferenceIconRegular, MenuSurface } = require("@deepseek-ai/dsh-client-ui-primitives");

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
		/** Direct ordinary children from the public, durable host catalog.
		 * The client controller maps header.parentSession to summary.parentId.
		 * Never infer lineage from workspace, title or message text. Native
		 * subagents keep their existing catalog and continuation semantics.
		 */
		function RelatedConversationRows({ sessionId, useSessions, useWorkspaces, openSession }) {
			const catalog = useSessions(state => state);
			const workspaces = useWorkspaces(state => state);
			const [expandedSession, setExpandedSession] = react.useState(null);
			const expanded = expandedSession === sessionId;
			const scrollRegion = react.useRef(null);
			const firstAdded = react.useRef(null);
			const expansion = react.useRef(null);
			react.useLayoutEffect(() => {
				const pending = expansion.current, region = scrollRegion.current;
				if (!expanded || !pending || !region) return;
				expansion.current = null;
				region.scrollTop = pending.scrollTop;
				if (pending.keyboard && firstAdded.current) {
					firstAdded.current.focus({ preventScroll: true });
					const item = firstAdded.current.getBoundingClientRect(), bounds = region.getBoundingClientRect();
					if (item.height > bounds.height) region.scrollTop += item.top - bounds.top;
					else if (item.bottom > bounds.bottom) region.scrollTop += item.bottom - bounds.bottom;
					else if (item.top < bounds.top) region.scrollTop -= bounds.top - item.top;
				}
			}, [expanded]);
			// Identity order is stable across activity/title updates and remounts.
			const children = catalog.ids.map(id => catalog.byId[id]).filter(row =>
				row && row.id !== sessionId && row.parentId === sessionId && row.origin !== "subagent" && !workspaces.archivedSessionIds.includes(row.id))
				.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
			const parentId = catalog.byId[sessionId]?.parentId;
			const parent = parentId && parentId !== sessionId ? catalog.byId[parentId] : null;
			const workspaceOf = id => workspaces.items.find(item => item.sessionIds.includes(id));
			const currentWorkspace = workspaceOf(sessionId);
			const titleOf = row => row.title?.trim() ? row.title : row.id;
			const visible = expanded ? children : children.slice(0, 3);
			const listId = "session-tools-children-" + sessionId;
			if ((!parentId || parentId === sessionId) && children.length === 0) return null;
			return react.createElement("section", {
				"aria-label": "相关对话", ref: scrollRegion,
				style: { padding: "4px 6px 6px", minWidth: 0, minHeight: 0, overflowY: "auto" },
			},
				parentId && parentId !== sessionId ? react.createElement(Button, {
					variant: "ghost", disabled: workspaces.archivedSessionIds.includes(parentId), onClick: () => openSession(parentId),
					style: { width: "100%", justifyContent: "flex-start", height: "auto", padding: "6px 8px", textAlign: "left", whiteSpace: "normal", overflowWrap: "anywhere" },
				}, (workspaces.archivedSessionIds.includes(parentId) ? "父对话已归档 · " : "返回父对话 · ") + (parent ? titleOf(parent) : parentId)) : null,
				children.length ? react.createElement(react.Fragment, null,
					react.createElement("div", { style: { padding: "2px 8px", fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" } }, "创建的对话 · " + children.length),
					react.createElement("div", { id: listId }, visible.map((child, index) => {
						const workspace = workspaceOf(child.id);
						const crossWorkspace = workspaces.phase === "ready" && workspaces.state !== "error" && workspace?.workspaceId !== currentWorkspace?.workspaceId;
						return react.createElement(Button, {
							key: child.id, ref: index === 3 ? firstAdded : undefined, variant: "ghost", title: child.id, onClick: () => openSession(child.id),
							style: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "6px 8px", height: "auto", minWidth: 0, textAlign: "left" },
						},
							react.createElement("span", { style: { minWidth: 0, overflowWrap: "anywhere", whiteSpace: "normal", fontSize: 13, lineHeight: "20px" } },
								titleOf(child),
								crossWorkspace ? react.createElement("span", { style: { display: "block", fontSize: 11, color: "var(--dsw-alias-label-secondary)" } }, "跨工作区 · " + (workspace?.title || workspace?.path || "未分组")) : null),
							react.createElement("span", { style: { flexShrink: 0, color: "var(--dsw-alias-label-secondary)", fontSize: 12 } }, child.running === true ? "运行中" : child.running === false ? "空闲" : "状态未知"));
					})),
					children.length > 3 ? react.createElement(Button, {
						variant: "ghost", "aria-expanded": expanded, "aria-controls": listId,
						onClick: event => {
							expansion.current = expanded ? null : { keyboard: event.detail === 0, scrollTop: scrollRegion.current?.scrollTop || 0 };
							setExpandedSession(expanded ? null : sessionId);
						},
						style: { width: "100%", fontSize: 12, height: "auto", padding: "6px 8px" },
					}, expanded ? "收起列表" : "展开更多（" + (children.length - 3) + "）") : null) : null);
		}

		/** Session-scoped marker; no visible header control or composer integration. */
		function ConversationBoundaryAnchor({ sessionId, boundaries }) {
			const anchor = react.useRef(null);
			react.useLayoutEffect(() => boundaries.mount(sessionId, anchor.current), [sessionId, boundaries]);
			return react.createElement("span", { ref: anchor, "aria-hidden": true, style: { position: "absolute", width: 0, height: 0, pointerEvents: "none" } });
		}

		/** Read layout capabilities only inside our public main-conversation slot.
		 * Bounded wrapper traversal stops at content, view slots and interactive/text
		 * nodes; it never searches the document or enters the message view tree.
		 */
		function conversationStructure(anchor, sessionId) {
			const nodes = new Set(), attributes = new Set();
			if (!anchor?.isConnected) return { nodes, attributes };
			const scope = anchor.closest('[data-slot="main.conversation"]');
			const header = anchor.closest("header");
			if (!scope || !header || !scope.contains(header)) return { nodes, attributes };
			nodes.add(scope); nodes.add(header);
			let budget = 64;
			const collect = (root, attribute) => {
				const found = [], queue = [...root.children].map(node => [node, 0]);
				while (queue.length) {
					const [node, depth] = queue.shift();
					if (--budget < 0 || depth > 8) return null;
					attributes.add(node);
					if (node === header) continue;
					if (node.hasAttribute(attribute)) { found.push(node); nodes.add(node); continue; }
					// These are ownership/content boundaries, not layout wrappers.
					if (node.hasAttribute("data-conversation-content") || node.hasAttribute("data-conversation-scroll") || node.hasAttribute("data-composer-seat")) continue;
					const slot = node.getAttribute("data-slot");
					if (slot && slot !== "conversation.content") continue;
					if (node.tagName !== "DIV" || node.hasAttribute("role") || node.hasAttribute("contenteditable") || [...node.childNodes].some(part => part.nodeType === 3 && part.textContent.trim())) continue;
					nodes.add(node);
					for (const child of node.children) queue.push([child, depth + 1]);
				}
				return found;
			};
			const contents = collect(scope, "data-conversation-content");
			if (contents?.length !== 1 || contents[0].getAttribute("data-conversation-session") !== sessionId) return { nodes, attributes };
			const content = contents[0], scrolls = collect(content, "data-conversation-scroll");
			if (scrolls?.length !== 1) return { nodes, attributes };
			const scroll = scrolls[0], composers = collect(scroll, "data-composer-seat");
			if (composers?.length !== 1) return { nodes, attributes };
			return { nodes, attributes, scope, header, content, scroll, composer: composers[0] };
		}

		function conversationBoundary(anchor, sessionId) {
			const shape = conversationStructure(anchor, sessionId);
			if (!shape.scroll || anchor.closest("[data-rightbar-fullscreen]")) return null;
			const { header, content, scroll, composer, nodes } = shape;
			const f = content.getBoundingClientRect(), h = header.getBoundingClientRect(), r = scroll.getBoundingClientRect();
			if (f.width <= 0 || f.height <= 0 || h.height <= 0 || r.width <= 0) return null;
			const left = Math.max(0, f.left, r.left) + 8, right = Math.min(window.innerWidth, f.right, r.right) - 8;
			const top = Math.max(0, h.bottom, r.top) + 8;
			let bottom = Math.min(window.innerHeight, f.bottom, r.bottom) - 8;
			const c = composer.getBoundingClientRect();
			if (c.height > 0 && c.top > r.top) bottom = Math.min(bottom, c.top - 8);
			return right > left && bottom > top ? { left, right, top, bottom, nodes: [...nodes] } : null;
		}

		/** Root-mounted non-modal surface, positioned within its current conversation. */
		function CreatedConversations(props) {
			const catalog = props.useSessions(state => state);
			const workspaces = props.useWorkspaces(state => state);
			const inConversation = props.usePanelInfo(info => info.activePanelId === null);
			const selected = Object.values(catalog.byId).filter(row => (row.retainedBy?.mainView ?? 0) > 0);
			// Navigation may briefly retain both generations. Never guess an owner.
			const sessionId = inConversation && selected.length === 1 ? selected[0].id : null;
			const parentId = sessionId && catalog.byId[sessionId]?.parentId;
			const hasChildren = sessionId && catalog.ids.some(id => {
				const row = catalog.byId[id];
				return row && row.id !== sessionId && row.parentId === sessionId && row.origin !== "subagent" && !workspaces.archivedSessionIds.includes(row.id);
			});
			const shown = workspaces.phase === "ready" && !!sessionId && (!!hasChildren || (!!parentId && parentId !== sessionId));
			const panel = react.useRef(null);
			const [positioned, setPositioned] = react.useState(false);
			const [boundaryRevision, setBoundaryRevision] = react.useState(0);
			react.useLayoutEffect(() => props.boundaries.subscribe(() => setBoundaryRevision(n => n + 1)), [props.boundaries]);
			const manual = react.useRef(null);
			const drag = react.useRef(null);
			const [collapsed, setCollapsed] = react.useState(false);
			const handle = react.useRef(null);
			const focusAfterToggle = react.useRef(false);
			const suppressClick = react.useRef(false);
			const toggleCollapsed = value => {
				stopDrag();
				focusAfterToggle.current = true;
				setCollapsed(value);
			};
			const place = () => {
				if (!panel.current) return;
				const bounds = conversationBoundary(props.boundaries.get(sessionId), sessionId);
				if (!bounds || bounds.right - bounds.left < 44 || bounds.bottom - bounds.top < 44) { setPositioned(false); return; }
				panel.current.style.width = Math.min(collapsed ? 44 : 320, bounds.right - bounds.left) + "px";
				panel.current.style.maxHeight = Math.min(340, window.innerHeight * 0.45, bounds.bottom - bounds.top) + "px";
				const box = panel.current.getBoundingClientRect();
				const point = manual.current?.sessionId === sessionId ? manual.current : { left: bounds.right - box.width, top: bounds.top };
				const left = Math.max(bounds.left, Math.min(point.left, bounds.right - box.width));
				const top = Math.max(bounds.top, Math.min(point.top, bounds.bottom - box.height));
				if (manual.current?.sessionId === sessionId) manual.current = { sessionId, left, top };
				panel.current.style.left = left + "px";
				panel.current.style.top = top + "px";
				setPositioned(true);
			};
			const stopDrag = event => {
				const current = drag.current;
				if (event?.pointerId !== undefined && current && event.pointerId !== current.id) return;
				drag.current = null;
				if (current) {
					suppressClick.current = current.moved;
					try { if (current.handle.hasPointerCapture(current.id)) current.handle.releasePointerCapture(current.id); } catch (_) {}
				}
			};
			react.useLayoutEffect(() => {
				if (!shown || !panel.current) return;
				place();
				if (focusAfterToggle.current) { handle.current?.focus({ preventScroll: true }); focusAfterToggle.current = false; }
				const observer = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
				observer?.observe(panel.current);
				const bounds = conversationBoundary(props.boundaries.get(sessionId), sessionId);
				bounds?.nodes.forEach(node => observer?.observe(node));
				// Watch only structural containers, never message descendants. Rebind
				// geometry observers when the host replaces a content/composer seat.
				const structure = typeof MutationObserver === "function" ? new MutationObserver(() => {
					place(); setBoundaryRevision(n => n + 1);
				}) : null;
				const anchor = props.boundaries.get(sessionId);
				const structureInfo = conversationStructure(anchor, sessionId);
				const structuralNodes = structureInfo.nodes;
				const attributeFilter = ["data-slot", "data-conversation-session", "data-conversation-content", "data-conversation-scroll", "data-composer-seat", "role", "contenteditable"];
				structureInfo.attributes.forEach(node => structure?.observe(node, { attributes: true, attributeFilter }));
				// A fullscreen tool pane can cover a still-mounted conversation.
				for (let ancestor = anchor?.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) structure?.observe(ancestor, { attributes: true, attributeFilter: ["data-rightbar-fullscreen"] });
				structuralNodes.forEach(node => structure?.observe(node, { childList: true, attributes: true, attributeFilter }));
				window.addEventListener("scroll", place, true);
				window.addEventListener("resize", place);
				window.addEventListener("blur", stopDrag);
				return () => {
					observer?.disconnect();
					structure?.disconnect();
					window.removeEventListener("scroll", place, true);
					window.removeEventListener("resize", place);
					window.removeEventListener("blur", stopDrag);
					stopDrag();
				};
			}, [shown, sessionId, collapsed, boundaryRevision]);
			const moveHandlers = {
				onPointerDown: event => {
					if (!event.isPrimary || event.button !== 0 || drag.current) return;
					suppressClick.current = false;
					const box = panel.current.getBoundingClientRect();
					try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) { return; }
					drag.current = { id: event.pointerId, handle: event.currentTarget, x: event.clientX, y: event.clientY, left: box.left, top: box.top, moved: false };
				},
				onPointerMove: event => {
					const current = drag.current;
					if (!current || event.pointerId !== current.id) return;
					const x = event.clientX - current.x, y = event.clientY - current.y;
					if (!current.moved && Math.hypot(x, y) < 5) return;
					current.moved = true;
					manual.current = { sessionId, left: current.left + x, top: current.top + y }; place();
				},
				onPointerUp: stopDrag, onPointerCancel: stopDrag, onLostPointerCapture: stopDrag,
				onKeyDown: event => {
					if (event.altKey || event.ctrlKey || event.metaKey || event.isComposing) return;
					if (event.key === "Enter" || event.key === " ") suppressClick.current = false;
					const moves = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
					if (event.key === "Home") { event.preventDefault(); manual.current = null; place(); }
					else if (moves[event.key]) {
						event.preventDefault();
						const box = panel.current.getBoundingClientRect(), [x, y] = moves[event.key];
						manual.current = { sessionId, left: box.left + x, top: box.top + y }; place();
					}
				},
			};
			if (!shown) return null;
			return react.createElement(MenuSurface, {
				role: "complementary", className: "dsh-session-tools-surface", ref: panel, "aria-label": "对话关系浮层",
				style: { position: "fixed", visibility: positioned ? "visible" : "hidden", left: 0, top: 0, width: collapsed ? 44 : "min(320px, calc(100vw - 16px))", maxHeight: "min(340px, 45vh)", display: "flex", flexDirection: "column", boxSizing: "border-box", pointerEvents: "auto", border: 0, background: "transparent", color: "var(--dsw-alias-label-primary)", boxShadow: "var(--dsw-elevation-panel, 0 4px 20px #0002)", overflow: "hidden" },
			}, collapsed ? react.createElement(Button, {
				...moveHandlers, ref: handle, variant: "ghost", "aria-label": "展开相关对话", "aria-expanded": false,
				title: "展开相关对话；拖动或方向键移动；Home 重置位置",
				icon: react.createElement(ReferenceIconRegular, { kind: "session", size: 20 }),
				style: { width: "100%", height: 42, padding: 0, flexShrink: 0, cursor: "grab", touchAction: "none" },
				onClick: event => { if (suppressClick.current && event.detail !== 0) { suppressClick.current = false; return; } toggleCollapsed(false); },
			}) : react.createElement(react.Fragment, null,
                react.createElement("style", null, ".dsh-session-tools-move-handle:focus-visible{outline:2px solid currentColor;outline-offset:-2px;border-radius:4px}"),
				react.createElement("div", { style: { display: "flex", alignItems: "center", flexShrink: 0, padding: "4px 6px", borderBottom: "0.5px solid var(--dsw-alias-border-l2)" } },
					react.createElement("span", {
                        ...moveHandlers, ref: handle, tabIndex: 0, role: "group", className: "dsh-session-tools-move-handle",
                        onKeyDown: event => { if (event.key === " ") event.preventDefault(); moveHandlers.onKeyDown(event); },
                        "aria-label": "移动对话浮层，使用方向键移动，Home 重置位置",
                        title: "拖动移动；方向键移动；Home 重置",
                        style: { display: "inline-flex", alignItems: "center", justifyContent: "center", width: 24, height: 28, flexShrink: 0, cursor: "grab", touchAction: "none", userSelect: "none", color: "var(--dsw-alias-label-secondary)" },
                    }, react.createElement("span", { "aria-hidden": true }, "⠿")),
                    react.createElement("span", { style: { flex: 1, minWidth: 0, fontSize: 12, padding: "6px 4px", userSelect: "none" } }, "相关对话"),
					react.createElement(Button, { variant: "ghost", title: "恢复右上角位置", onClick: () => { manual.current = null; place(); }, style: { fontSize: 11, height: "auto", padding: "6px 8px" } }, "重置"),
					react.createElement(Button, { variant: "ghost", "aria-label": "收起相关对话", "aria-expanded": true, title: "收起为会话图标", onClick: () => toggleCollapsed(true), style: { fontSize: 11, height: "auto", padding: "6px 8px" } }, "收起")),
				react.createElement(RelatedConversationRows, { ...props, key: sessionId, sessionId })));
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
			const register = (scope, openSession) => {
				const anchors = new Map(), listeners = new Set();
				const boundaries = {
					mount(id, node) { const key = {}; anchors.set(key, { id, node }); listeners.forEach(fn => fn()); return () => { anchors.delete(key); listeners.forEach(fn => fn()); }; },
					get(id) { const matches = [...anchors.values()].filter(entry => entry.id === id && entry.node?.isConnected); return matches.length === 1 ? matches[0].node : null; },
					subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
				};
				scope.slots.inject("conversation.session.header.utilities", () => scope.slots.register({
					name: "conversation.session.header.utilities", id: "session-tools.conversation-boundary", inject: () => ({ boundaries }),
				}, ConversationBoundaryAnchor));
				scope.slots.inject("shell.overlay", () => scope.slots.register({
					name: "shell.overlay", id: "session-tools.created-conversations", order: -20,
					inject: () => ({ openSession, boundaries }),
				}, CreatedConversations));
				return scope.slots.inject("tool.call.toolview", () => scope.slots.register(
				{
					name: "tool.call.toolview",
					key: "session_create",
					inject: () => ({ openSession }),
				},
				SessionCreateRow,
			));
			};
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
