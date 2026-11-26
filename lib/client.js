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
		const { MenuItemButton, Modal, Button, Switch, Tag, ReferenceIconRegular, SettingsForm, SettingsFormModel, Toast } = require("@deepseek-ai/dsh-client-ui-primitives");

		/** Slots this client half needs before it can register anything. */
		const inject = ["slots", "sessions"];

		const UI_LOCALE = "session-tools.ui";
		const uiCopy = {
			zh: {
				createUnavailable: "没有可用的会话创建结果",
				creating: "正在创建会话…",
				session: "会话",
				created: "已创建会话",
				processing: "正在处理…",
				unknownResult: "暂无法确认",
				waitTimeout: "等待超时。没有重发，也没有取消；请用同一消息编号继续查询。",
				waitCancelled: "已停止等待，目标会话继续处理。",
				messageDetails: "消息详情",
				"communicationStatus.switches_allow": "通信开关允许",
				"communicationStatus.sender_send_disabled": "当前会话已关闭发送",
				"communicationStatus.target_receive_disabled": "目标会话已关闭接收",
				"communicationStatus.both_disabled": "当前会话已关闭发送，目标会话已关闭接收",
				"communicationStatus.unavailable": "通信状态无法确认",
				communicationStatusHint: "这是当前的开关状态。实际发送时会再次检查收发设置、审批和其他发送限制。",
				reading: "正在读取设置…",
				readingDuringSave: "已读取当前设置，保存请求仍未结束；暂不能再次更改。",
				synced: "设置已在其他页面更改，已同步最新状态。",
				loaded: "已读取最新设置。更改后立即生效。",
				readFailed: "状态未知，暂时无法读取设置。请重试。",
				saving: "正在保存…",
				savePending: "保存结果尚未确认，仍在等待。不会重复提交；关闭面板不会取消更改。",
				saved: "已保存，立即生效。",
				conflict: "设置已在其他页面更改。已显示最新设置，请确认后再操作。",
				saveUnconfirmed: "保存结果暂无法确认，正在重新读取；不会自动重复保存。",
				disconnected: "连接已断开，状态未知。恢复连接后会重新读取。",
				on: "开启",
				off: "关闭",
				unknown: "未知",
				close: "关闭",
				communication: "会话通信",
				communicationMenu: "会话通信…",
				receive: "接收其他会话消息",
				receiveHelp: "关闭会拒绝新的插件消息：未送达、未排队；已接收消息继续处理。",
				send: "向其他会话发送",
				sendHelp: "也控制创建带首条消息的新会话。",
				communicationHelp: "仅控制本插件的新消息。关闭接收后，新消息未送达、未排队；已经接收的消息继续处理，历史仍可查看。",
				readAgain: "重新读取",
				noRelated: "当前对话还没有相关对话。",
				related: "相关对话",
				parentArchived: "父对话已归档 · {title}",
				parent: "返回父对话 · {title}",
				createdConversations: "创建的对话 · {count}",
				crossWorkspace: "跨工作区 · {name}",
				ungrouped: "未分组",
				running: "运行中",
				idle: "空闲",
				stateUnknown: "状态未知",
				collapse: "收起列表",
				expand: "展开更多（{count}）",
				openRelations: "会话通信与相关对话",
				sidebarUnavailable: "会话工具不可用：宿主未提供会话工具停靠接口",
				"status.queued": "已排队",
				"status.delivered": "已发送消息",
				"status.turnCompleted": "已发送消息",
				"status.discarded": "取消",
				"status.cancelled": "取消",
				"status.interrupted": "中断",
				"status.failed": "失败",
				"status.incomplete": "未完整结束",
				"status.blocked": "未完整结束",
				"status.unknown": "暂无法确认",
			},
			en: {
				createUnavailable: "Session creation result unavailable",
				creating: "Creating session…",
				session: "Session",
				created: "Session created",
				processing: "Processing…",
				unknownResult: "Unable to confirm",
				waitTimeout: "Wait timed out. The message was neither resent nor cancelled. Check again using the same message ID.",
				waitCancelled: "Stopped waiting. The target session continues.",
				messageDetails: "Message details",
				"communicationStatus.switches_allow": "Communication switches allow sending",
				"communicationStatus.sender_send_disabled": "Sending is off for this session",
				"communicationStatus.target_receive_disabled": "Receiving is off for the target session",
				"communicationStatus.both_disabled": "Sending is off for this session and receiving is off for the target",
				"communicationStatus.unavailable": "Unable to confirm communication status",
				communicationStatusHint: "These are the current switch settings. Sending rechecks the switches, approval, and other delivery rules.",
				reading: "Loading settings…",
				readingDuringSave: "Settings loaded. Wait for the current save to finish before making another change.",
				synced: "Settings changed in another view. The latest values are shown.",
				loaded: "Settings loaded. Changes take effect immediately.",
				readFailed: "Could not read the current settings. Try again.",
				saving: "Saving…",
				savePending: "The save is still pending. Closing this panel does not cancel the change.",
				saved: "Saved. Changes are active.",
				conflict: "Settings changed in another view. Review the latest values before trying again.",
				saveUnconfirmed: "Could not confirm the save. Reloading settings without retrying the change.",
				disconnected: "Disconnected. Settings will reload when the connection returns.",
				on: "On",
				off: "Off",
				unknown: "Unknown",
				close: "Close",
				communication: "Session communication",
				communicationMenu: "Session communication…",
				receive: "Receive messages from other sessions",
				receiveHelp: "Turning this off rejects new plugin messages before delivery or queuing. Already accepted messages continue.",
				send: "Send messages to other sessions",
				sendHelp: "Also controls creating sessions with a first message.",
				communicationHelp: "Applies to new messages from this plugin. Turning off receiving rejects new messages before delivery or queuing. Accepted messages continue, and history remains visible.",
				readAgain: "Reload settings",
				noRelated: "No related conversations yet.",
				related: "Related conversations",
				parentArchived: "Parent conversation archived · {title}",
				parent: "Back to parent conversation · {title}",
				createdConversations: "Created conversations · {count}",
				crossWorkspace: "Other workspace · {name}",
				ungrouped: "Ungrouped",
				running: "Running",
				idle: "Idle",
				stateUnknown: "Status unknown",
				collapse: "Show less",
				expand: "Show more ({count})",
				openRelations: "Session communication and related conversations",
				sidebarUnavailable: "Session Tools unavailable: this host does not support docked session tools",
				"status.queued": "Queued",
				"status.delivered": "Message sent",
				"status.turnCompleted": "Message sent",
				"status.discarded": "Cancelled",
				"status.cancelled": "Cancelled",
				"status.interrupted": "Interrupted",
				"status.failed": "Failed",
				"status.incomplete": "Incomplete",
				"status.blocked": "Incomplete",
				"status.unknown": "Unable to confirm",
			},
		};
		const fallbackTranslate = (key, params = {}) => (uiCopy.zh[key] ?? key)
			.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
		let translate = fallbackTranslate;

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
			const t = props.t ?? translate;
			const openSession = props.openSession ?? props.slot?.injected?.openSession;
			const created = readCreatedSession(props.block);
			if (created === undefined) {
				// Keep errors and legacy receipts readable, without claiming a
				// successful creation or inventing a clickable navigation target.
				const text = resultText(props.block);
				const fallback = props.block?.kind === "tool-result" ? t("createUnavailable") : t("creating");
				return react.createElement("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, text || fallback);
			}
			const title = created.title === undefined || created.title === "" ? t("session") : created.title;
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
				react.createElement("span", null, t("created")),
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
				react.createElement("div", { style: { flexBasis: "100%" } }, react.createElement(MessageStateRow, { block: props.block, t })),
			);
		}


		const previousStatusLabels = {
			delivered: ["已交给目标"],
			turnCompleted: ["目标本轮结束（不等于任务成功）", "对方已处理这条消息"],
		};
		function MessageStateRow({ block, t = translate }) {
			const text = resultText(block);
			if (block?.kind !== "tool-result") return react.createElement("span", { role: "status" }, t("processing"));
			const meta = block.meta;
			if (block.isError || meta?.scope === "sessionOverview" || typeof meta?.messageId !== "string") {
				return react.createElement("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, text || t("unknownResult"));
			}
			const candidate = "status." + meta.messageStatus;
			const statusKey = Object.hasOwn(uiCopy.en, candidate) ? candidate : "status.unknown";
			const status = t(statusKey);
			const [receiptBlock, replyBlock] = block.content ?? [];
			const reply = block.content?.length === 2 && receiptBlock?.type === "text" && replyBlock?.type === "text" ? replyBlock.text : undefined;
			const lines = (reply === undefined ? text : receiptBlock.text).split("\n");
			const receipt = `Receipt: sessionId=${meta.sessionId}, messageId=${meta.messageId}`;
			const receiptIndex = lines.slice(1, 3).findIndex(line => line === receipt || line.startsWith(`${receipt}, `)) + 1;
			const printedStatus = lines[receiptIndex - 1];
			// The card supplies the status, including when it replays a saved receipt.
			if (printedStatus === uiCopy.zh[statusKey] || printedStatus === uiCopy.en[statusKey] || previousStatusLabels[meta.messageStatus]?.includes(printedStatus)) {
				lines.splice(receiptIndex - 1, 1);
			}
			return react.createElement("div", { style: { display: "grid", gap: 6 } },
				react.createElement("strong", null, status),
				meta.waitStatus === "timedOut" && react.createElement("div", null, t("waitTimeout")),
				meta.waitStatus === "callerCancelled" && react.createElement("div", null, t("waitCancelled")),
				reply && react.createElement("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" } }, reply),
				react.createElement("details", null, react.createElement("summary", null, t("messageDetails")),
					react.createElement("div", { style: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--dsw-alias-label-secondary)" } }, lines.join("\n"))));
		}
		function CommunicationStatusRow({ block, t = translate }) {
			if (block?.kind !== "tool-result") return react.createElement("span", { role: "status" }, t("processing"));
			const reason = block.meta?.communicationReason;
			if (block.isError || typeof reason !== "string") {
				return react.createElement("div", null, resultText(block) || t("communicationStatus.unavailable"));
			}
			const key = "communicationStatus." + reason;
			return react.createElement("div", null,
				react.createElement("strong", null, t(Object.hasOwn(uiCopy.en, key) ? key : "communicationStatus.unavailable")),
				react.createElement("p", null, t("communicationStatusHint")));
		}
		const remoteContribution = (() => {
			// TypertSchema requires parse(value); keep these strict schemas local to
			// this browser bundle because Zod is not a platform module seed.
			const scalar = check => value => {
				if (!check(value)) throw new TypeError("Invalid session communication field");
				return value;
			};
			const object = (fields, optional = {}) => ({ parse(value) {
				if (!value || typeof value !== "object" || Array.isArray(value)
					|| Object.keys(value).some(key => !Object.hasOwn(fields, key) && !Object.hasOwn(optional, key))
					|| Object.keys(fields).some(key => !Object.hasOwn(value, key))) {
					throw new TypeError("Invalid session communication object");
				}
				return Object.fromEntries(Object.keys(value).map(key => [key, (fields[key] ?? optional[key])(value[key])]));
			} });
			const sessionId = scalar(value => typeof value === "string" && value.length >= 1 && value.length <= 1024);
			const boolean = scalar(value => typeof value === "boolean");
			const revision = scalar(value => Number.isSafeInteger(value) && value >= 0);
			const getSchema = object({ sessionId });
			const defaultsSchema = object({ send: boolean, receive: boolean });
			const setSchema = object({ sessionId, send: boolean, receive: boolean, expectedRevision: revision }, {
				expectedDefaults: value => defaultsSchema.parse(value),
			});
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
		// One authoritative cache per client, shared by every pane and the menu.
		// Other windows are reconciled by bounded polling and focus/visibility reads.
		function createCommunicationStore() {
			let api;
			const entries = new Map();
			const entryFor = id => {
				if (!entries.has(id)) entries.set(id, { listeners: new Set(), active: 0, token: 0, reading: false, saving: false,
					value: { record: null, busy: false, failed: false, notice: "reading" } });
				return entries.get(id);
			};
			const publish = (entry, patch) => {
				entry.value = { ...entry.value, ...patch };
				entry.listeners.forEach(listener => listener());
			};
			const read = async (id, verifyPending = false) => {
				const entry = entryFor(id);
				if (!api || entry.reading || (entry.saving && !verifyPending)) return;
				entry.reading = true;
				if (!entry.value.record) publish(entry, { busy: true });
				const token = ++entry.token;
				let timer;
				try {
					const result = await Promise.race([api.get({ sessionId: id }), new Promise((_, reject) => {
						timer = setTimeout(() => reject(new Error("read timeout")), 12000);
					})]);
					if (token !== entry.token) return;
					if (!result.ok || !validRecord(result.value)) throw new Error("unavailable");
					if (entry.value.record && result.value.revision < entry.value.record.revision) return;
					const previous = entry.value.record;
					const changed = previous && (result.value.revision !== previous.revision
						|| result.value.send !== previous.send || result.value.receive !== previous.receive);
					publish(entry, { record: result.value, failed: changed ? false : !!entry.value.record && entry.value.failed,
						notice: entry.saving ? "readingDuringSave" : changed ? "synced" : entry.value.record ? entry.value.notice : "loaded" });
				} catch {
					if (token === entry.token) publish(entry, { record: null, failed: true, notice: "readFailed" });
				} finally {
					clearTimeout(timer); entry.reading = false;
					if (token === entry.token) publish(entry, { busy: entry.saving });
					if (!entry.listeners.size && !entry.saving) entries.delete(id);
				}
			};
			const change = async (id, key, next) => {
				const entry = entryFor(id), record = entry.value.record;
				if (!api || !record || entry.saving) return;
				const owner = api;
				entry.saving = true; ++entry.token;
				publish(entry, { busy: true, failed: false, notice: "saving" });
				// A timeout cannot cancel an accepted write. Keep the write lock until
				// it settles; never replay it or offer a misleading rollback.
				let timedOut = false, staleResponse = false;
				const timer = setTimeout(() => {
					if (api !== owner) return;
					timedOut = true;
					publish(entry, { record: null, failed: true, notice: "savePending" });
					void read(id, true);
				}, 12000);
				try {
					const result = await owner.set({
						sessionId: id, send: record.send, receive: record.receive, [key]: next,
						expectedRevision: record.revision,
						...(record.revision === 0 && { expectedDefaults: { send: record.send, receive: record.receive } }),
					});
					if (api !== owner) return;
					if (!result.ok || !validRecord(result.value?.current) || !["saved", "conflict"].includes(result.value?.status)) throw new Error("unconfirmed");
					if (entry.value.record && result.value.current.revision < entry.value.record.revision) { staleResponse = true; return; }
					publish(entry, { record: result.value.current, failed: result.value.status === "conflict",
						notice: result.value.status === "saved" ? "saved" : "conflict" });
				} catch {
					if (api !== owner) return;
					publish(entry, { record: null, failed: true, notice: "saveUnconfirmed" });
				} finally {
					clearTimeout(timer); ++entry.token; entry.saving = false; publish(entry, { busy: false });
					if (api !== owner || timedOut || staleResponse || !entry.value.record) void read(id);
					else if (!entry.listeners.size && !entry.reading) entries.delete(id);
				}
			};
			const refresh = () => { if (document.visibilityState === "hidden") return; for (const [id, entry] of entries) if (entry.active) void read(id); };
			return {
				connect(value) {
					api = value; refresh();
					return () => {
						if (api !== value) return;
						api = undefined;
						for (const entry of entries.values()) {
							++entry.token;
							publish(entry, { record: null, busy: entry.saving, failed: true, notice: "disconnected" });
						}
					};
				},
				get: id => entryFor(id).value, read, change,
				subscribe(id, listener, active) {
					const entry = entryFor(id); entry.listeners.add(listener);
					if (active) entry.active++;
					if (active && entry.active === 1) {
						entry.timer = setInterval(() => { if (document.visibilityState !== "hidden") void read(id); }, 3000);
						window.addEventListener("focus", refresh);
						document.addEventListener("visibilitychange", refresh);
					}
					if (active) void read(id);
					return () => {
						entry.listeners.delete(listener);
						if (active) entry.active--;
						if (!entry.active) clearInterval(entry.timer);
						if (![...entries.values()].some(item => item.active)) {
							window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh);
						}
						if (!entry.listeners.size && !entry.reading && !entry.saving) entries.delete(id);
					};
				},
			};
		}
		function CommunicationControls({ sessionId, store, t, compact = false, visible = true }) {
			const subscribe = react.useCallback(listener => store.subscribe(sessionId, listener, visible), [store, sessionId, visible]);
			const snapshot = react.useCallback(() => store.get(sessionId), [store, sessionId]);
			const { record, busy, failed, notice } = react.useSyncExternalStore(subscribe, snapshot);
			react.useEffect(() => { if (visible) void store.read(sessionId); }, [store, sessionId, visible]);
			const row = (key, label, description) => react.createElement("div", { key, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: compact ? 8 : 24, padding: compact ? "10px 0" : "16px 0", borderBottom: "0.5px solid var(--dsw-alias-border-l2)" } },
				react.createElement("div", { title: description, style: { flex: 1, minWidth: 0, fontSize: compact ? 13 : 14, lineHeight: "20px", color: "var(--dsw-alias-label-primary)" } }, label,
					!compact && react.createElement("div", { style: { marginTop: 4, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" } }, description)),
				react.createElement("span", { "aria-hidden": true, style: { flexShrink: 0, color: "var(--dsw-alias-label-secondary)", fontSize: 12 } }, t(record ? (record[key] ? "on" : "off") : "unknown")),
				record && react.createElement(Switch, { checked: record[key], onChange: value => void store.change(sessionId, key, value), label, disabled: busy }));
			return react.createElement("section", { "aria-label": t("communication"), "aria-busy": busy, "data-communication-session": sessionId, style: { padding: compact ? "0 6px 12px" : 0, minWidth: 0 } },
				row("receive", t("receive"), t("receiveHelp")),
				row("send", t("send"), t("sendHelp")),
				(!compact || record?.receive === false) && react.createElement("p", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: "18px" } }, t("communicationHelp")),
				react.createElement("div", { role: failed ? "alert" : "status", "aria-live": "polite", style: { marginTop: 8, fontSize: 12, lineHeight: "18px", color: failed ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-secondary)" } }, t(notice)),
				!record && !busy && react.createElement(Button, { variant: "outline", onClick: () => void store.read(sessionId) }, t("readAgain")));
		}
		function CommunicationForm({ request, store, close, t }) {
			return react.createElement(Modal, { open: true, onClose: close, closeLabel: t("close"), title: t("communication"), description: request.title || request.sessionId,
				footer: react.createElement(Button, { variant: "outline", onClick: close }, t("close")),
			}, react.createElement(CommunicationControls, { sessionId: request.sessionId, store, t }));
		}
		/** Direct ordinary children from the public, durable host catalog.
		 * The client controller maps header.parentSession to summary.parentId.
		 * Never infer lineage from workspace, title or message text. Native
		 * subagents keep their existing catalog and continuation semantics.
		 */
		function RelatedConversationRows({ sessionId, useSessions, useWorkspaces, openSession, t }) {
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
			if ((!parentId || parentId === sessionId) && children.length === 0) return react.createElement("p", { style: { margin: 8, color: "var(--dsw-alias-label-secondary)", fontSize: 13 } }, t("noRelated"));
			return react.createElement("section", {
				"aria-label": t("related"), ref: scrollRegion,
				style: { padding: "4px 6px 6px", minWidth: 0, minHeight: 0, overflowY: "auto" },
			},
				parentId && parentId !== sessionId ? react.createElement(Button, {
					variant: "ghost", disabled: workspaces.archivedSessionIds.includes(parentId), onClick: () => openSession(parentId),
					style: { width: "100%", justifyContent: "flex-start", height: "auto", padding: "6px 8px", textAlign: "left", whiteSpace: "normal", overflowWrap: "anywhere" },
				}, t(workspaces.archivedSessionIds.includes(parentId) ? "parentArchived" : "parent", { title: parent ? titleOf(parent) : parentId })) : null,
				children.length ? react.createElement(react.Fragment, null,
					react.createElement("div", { style: { padding: "2px 8px", fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" } }, t("createdConversations", { count: children.length })),
					react.createElement("div", { id: listId }, visible.map((child, index) => {
						const workspace = workspaceOf(child.id);
						const crossWorkspace = workspaces.phase === "ready" && workspaces.state !== "error" && workspace?.workspaceId !== currentWorkspace?.workspaceId;
						return react.createElement(Button, {
							key: child.id, ref: index === 3 ? firstAdded : undefined, variant: "ghost", title: child.id, onClick: () => openSession(child.id),
							style: { width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "6px 8px", height: "auto", minWidth: 0, textAlign: "left" },
						},
							react.createElement("span", { style: { minWidth: 0, overflowWrap: "anywhere", whiteSpace: "normal", fontSize: 13, lineHeight: "20px" } },
								titleOf(child),
								crossWorkspace ? react.createElement("span", { style: { display: "block", fontSize: 11, color: "var(--dsw-alias-label-secondary)" } }, t("crossWorkspace", { name: workspace?.title || workspace?.path || t("ungrouped") })) : null),
							react.createElement("span", { style: { flexShrink: 0, color: "var(--dsw-alias-label-secondary)", fontSize: 12 } }, child.running === true ? t("running") : child.running === false ? t("idle") : t("stateUnknown")));
					})),
					children.length > 3 ? react.createElement(Button, {
						variant: "ghost", "aria-expanded": expanded, "aria-controls": listId,
						onClick: event => {
							expansion.current = expanded ? null : { keyboard: event.detail === 0, scrollTop: scrollRegion.current?.scrollTop || 0 };
							setExpandedSession(expanded ? null : sessionId);
						},
						style: { width: "100%", fontSize: 12, height: "auto", padding: "6px 8px" },
					}, expanded ? t("collapse") : t("expand", { count: children.length - 3 })) : null) : null);
		}

        const RELATIONS_TAB = "@ryuu-64/dsh-session-tools/relations";
        const RELATIONS_KIND = "session-tools.relations";
        // Only the automatic first reveal is plugin-owned. All pane geometry,
        // collapse, movement, docking and layout persistence belong to DSH.
        function hasRelations(sessionId, catalog, workspaces) {
            const archived = workspaces.archivedSessionIds;
            const parentId = catalog.byId[sessionId]?.parentId;
            return (!!parentId && parentId !== sessionId && !!catalog.byId[parentId] && !archived.includes(parentId)) ||
                catalog.ids.some(id => {
                    const row = catalog.byId[id];
                    return row && id !== sessionId && row.parentId === sessionId && row.origin !== "subagent" && !archived.includes(id);
                });
        }
        function RelationsTab(props) {
            const { tab } = props.useTabInfo();
            react.useLayoutEffect(() => {
                props.visibility.set(tab.id, tab.visible);
                return () => props.visibility.delete(tab.id);
            }, [props.visibility, tab.id, tab.visible]);
            return react.createElement("div", {
                "data-session-tools-tab": props.sessionId,
                style: { height: "100%", minHeight: 0, overflow: "auto", padding: 8, boxSizing: "border-box" },
            }, react.createElement(CommunicationControls, { key: props.sessionId, sessionId: props.sessionId, store: props.communication, t: props.t ?? translate, compact: true, visible: tab.visible }),
                react.createElement(RelatedConversationRows, { ...props, key: tab.id, t: props.t ?? translate }));
        }
        function RelationsEntry(props) {
            const t = props.t ?? translate;
            const catalog = props.useSessions(state => state);
            const workspaces = props.useWorkspaces(state => state);
            const mounted = react.useSyncExternalStore(props.sidebar?.mounted.subscribe ?? (() => () => {}), props.sidebar?.mounted.getSnapshot ?? (() => undefined));
            const available = workspaces.phase === "ready" && hasRelations(props.sessionId, catalog, workspaces);
            react.useEffect(() => {
                if (!props.sidebar || !available || mounted !== props.sessionId || props.wasShown(props.sessionId)) return;
                // This is synchronous and rechecks the host's owner before opening.
                // Record success only after the native tab actually exists.
                props.reveal(props.sessionId, true);
            }, [available, mounted, props.sessionId, props.reveal, props.wasShown]);
            if (!props.sessionId) return null;
            return react.createElement(Button, {
                variant: "ghost", size: "sm", title: props.sidebar ? t("openRelations") : t("sidebarUnavailable"), "aria-label": props.sidebar ? t("openRelations") : t("sidebarUnavailable"), disabled: !props.sidebar,
                style: { flex: "none", width: 28, padding: 0, color: "var(--dsw-alias-label-secondary)" },
                onClick: () => props.reveal(props.sessionId, false),
            }, react.createElement(ReferenceIconRegular, { kind: "session", size: 16 }));
        }
		function registerCommunicationUI(ctx, store) {
			let request = null;
			const listeners = new Set();
			const publish = value => { request = value; for (const listener of listeners) listener(); };
			const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
			function Overlay({ t = translate }) {
				const current = react.useSyncExternalStore(subscribe, () => request);
				return current ? react.createElement(CommunicationForm, { key: current.sessionId, request: current, store, t, close: () => publish(null) }) : null;
			}
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "session-tools.communication", locale: UI_LOCALE }, Overlay));
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({ name: "sidebar.workspaces.session.menu.item", id: "session-tools.communication", order: 350, locale: UI_LOCALE },
				({ sessionId, displayTitle, useMenuOpenState, t = translate }) => {
					const [, setMenuOpen] = useMenuOpenState();
					return react.createElement(MenuItemButton, { onSelect: () => { setMenuOpen(false); publish({ sessionId, title: displayTitle }); } }, t("communicationMenu"));
				}));
		}

		const sessionLinkPrefix = "https://dsh.invalid/session/";

		function registerSessionLinks(ctx, openSession) {
			ctx.inject(["workspaces", "locale"], scope => {
				const locale = "session-tools.links";
				scope.effect(() => scope.locale.register(locale, {
					zh: { unavailable: "无法打开会话。会话可能已归档，或在当前 DSH 中不可用。" },
					en: { unavailable: "Could not open the conversation. It may be archived or unavailable in this DSH instance." },
				}));
				let notice = 0;
				let sequence = 0;
				const listeners = new Set();
				const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
				const snapshot = () => notice;
				const publish = value => { notice = value; for (const listener of listeners) listener(); };
				const dismiss = () => publish(0);
				function SessionLinkOverlay({ t }) {
					const current = react.useSyncExternalStore(subscribe, snapshot);
					return current ? react.createElement(Toast, { key: current, text: t("unavailable"), onDone: dismiss }) : null;
				}
				scope.slots.inject("shell.overlay", () => scope.slots.register({
					name: "shell.overlay", id: "session-tools.links", locale,
				}, SessionLinkOverlay));
				scope.effect(() => {
					if (typeof document === "undefined") return;
					function activate(event) {
						if (event.type === "keydown" && event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
						const anchor = event.target?.closest?.("a[href]");
						const href = anchor?.getAttribute("href");
						if (!href?.startsWith(sessionLinkPrefix)) return;
						const row = anchor.closest("[data-chat-flow-kind]");
						if (!row?.matches('[data-chat-flow-kind="assistant-step"]:not([data-chat-group-part="reasoning"])') || !row.closest("[data-chat-flow]")) return;
						// Handle the reserved URL before DSH's ordinary HTTP link action.
						event.preventDefault();
						event.stopPropagation();
						if (event.type !== "click" || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
						const payload = href.slice(sessionLinkPrefix.length);
						try {
							const sessionId = /^[^/?#]+$/u.test(payload) ? decodeURIComponent(payload) : "";
							const catalog = scope.sessions.list.getSnapshot();
							const archived = scope.workspaces.list.getSnapshot().archivedSessionIds;
							const target = catalog.byId[sessionId];
							if (target && catalog.ids.includes(sessionId) && target.origin !== "subagent" && !archived.includes(sessionId)) {
								openSession(sessionId);
								dismiss();
								return;
							}
						} catch (error) {
							console.error("[session-tools] opening the session link failed:", error);
						}
						publish(++sequence);
					}
					const events = ["click", "auxclick", "contextmenu", "keydown"];
					const options = { capture: true };
					for (const name of events) document.addEventListener(name, activate, options);
					return () => {
						for (const name of events) document.removeEventListener(name, activate, options);
					};
				});
			});
		}

		const settingsEntry = "session-tools-bundle";
		const settingsLocale = "session-tools.settings";
		const settingsFields = ["defaultSend", "defaultReceive"];
		const settingsCopy = {
			zh: {
				summary: "设置尚未单独配置的会话能否发送和接收消息。",
				defaultSend: "默认允许向其他会话发送",
				defaultSendHint: "关闭后，未单独设置的会话无法发送消息或创建带首条消息的会话。",
				defaultReceive: "默认允许接收其他会话消息",
				defaultReceiveHint: "关闭后，未单独设置的会话不会收到新的跨会话消息，插件也无法代建并投递首条消息。",
				overridden: "已覆盖",
				reset: "恢复默认",
				unavailable: "宿主未提供会话通信默认设置。",
				readOnly: "当前配置为只读。",
				saveFailed: "无法保存。请检查当前值后重试。",
				save: "保存",
				saving: "正在保存…",
			},
			en: {
				summary: "Choose whether sessions without their own settings can send and receive messages.",
				defaultSend: "Allow sending to other sessions by default",
				defaultSendHint: "When off, sessions without their own settings cannot send messages or create a session with a first message.",
				defaultReceive: "Allow receiving from other sessions by default",
				defaultReceiveHint: "When off, sessions without their own settings cannot receive new messages, including the first message in a session created by this plugin.",
				overridden: "Overridden",
				reset: "Reset to default",
				unavailable: "The host does not expose session communication defaults.",
				readOnly: "This configuration is read-only.",
				saveFailed: "Could not save. Check the current values and try again.",
				save: "Save",
				saving: "Saving…",
			},
		};
		const settingsRow = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16,
			fontSize: 13, lineHeight: 1.5, color: "var(--dsw-alias-label-primary)" };
		const settingsActions = { display: "flex", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 };
		const settingsHint = { margin: 0, fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary)" };
		const settingsReset = { height: "auto", padding: 0, fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-label-secondary)" };

		function registerDefaultSettings(ctx) {
			ctx.inject(["configForms", "locale"], scope => {
				scope.effect(() => scope.locale.register(settingsLocale, settingsCopy));
				const model = new SettingsFormModel(scope.configForms.get(settingsEntry), settingsFields.map(field => ({
					field,
					format: value => typeof value === "boolean" ? String(value) : "",
					parse: text => text === "true" || text === "false" ? { kind: "set", value: text === "true" } : undefined,
				})));
				scope.effect(() => () => model.dispose());
				const store = model.bind(() => ({
					...model.shell(),
					fields: Object.fromEntries(settingsFields.map(field => [field, model.field(field)])),
				}));
				const { edit, resetField, save, discard } = model.actions();
				function DefaultSettings({ t, view }) {
					const state = react.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
					if (view === "summary") return t("summary");
					const disabled = !state.writable || state.saving;
					const labels = Object.fromEntries(["unavailable", "readOnly", "saveFailed", "save", "saving"].map(key => [key, t(key)]));
					return react.createElement(SettingsForm, { labels, state: { ...state, dirty: state.dirty && state.writable }, onSave: save, onDiscard: discard },
						settingsFields.map((field, index) => {
							const value = state.fields[field];
							const label = t(field);
							return react.createElement("div", { key: field, style: { display: "grid", gap: 6, padding: "12px 0",
								borderTop: index ? "0.5px solid var(--dsw-alias-border-l2)" : undefined } },
								react.createElement("div", { style: settingsRow },
									react.createElement("span", { style: { flex: 1, minWidth: 0 } }, label),
									react.createElement("div", { style: settingsActions },
										value.overridden && react.createElement(Tag, { tone: "neutral" }, t("overridden")),
										value.overridden && react.createElement(Button, {
											type: "button", variant: "ghost", size: "sm", disabled, style: settingsReset,
											"aria-label": `${t("reset")} · ${label}`, onClick: () => resetField(field),
										}, t("reset")),
										react.createElement(Switch, { checked: value.text === "true", disabled, label,
											onChange: checked => edit(field, String(checked)) }))),
								react.createElement("p", { style: settingsHint }, t(`${field}Hint`)));
						}));
				}
				scope.effect(() => scope.configForms.whileServed([settingsEntry], () => scope.slots.inject("plugins.row.config", () => scope.slots.register({
					name: "plugins.row.config",
					key: "@ryuu-64/dsh-session-tools#" + settingsEntry,
					locale: settingsLocale,
				}, DefaultSettings))));
			});
		}

		/**
		* Wait for the tool view slot list to exist, then register a keyed row that
		* replaces the default card for `session_create`.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
            ctx.inject(["locale"], scope => {
                scope.effect(() => {
                    const unregister = scope.locale.register(UI_LOCALE, uiCopy);
                    translate = scope.locale.bind(UI_LOCALE);
                    return () => { translate = fallbackTranslate; unregister?.(); };
                });
            });
            registerDefaultSettings(ctx);
            const communication = createCommunicationStore();
			ctx.inject(["remote"], async scope => {
				try {
					await scope.remote.$mount(remoteContribution);
					scope.inject(["remote.sessionCommunication"], ui => {
						ui.effect(() => communication.connect(ui.remote.sessionCommunication));
                        registerCommunicationUI(ui, communication);
					});
				} catch(error) { console.error("[session-tools] communication UI initialization failed", error); throw error; }
			});
			ctx.slots.inject("tool.call.toolview", function* () {
				for (const key of ["session_send", "session_wait"]) yield ctx.slots.register({ name: "tool.call.toolview", key, locale: UI_LOCALE }, MessageStateRow);
				yield ctx.slots.register({ name: "tool.call.toolview", key: "session_communication_status", locale: UI_LOCALE }, CommunicationStatusRow);
			});
			const register = (scope, openSession) => {
				registerSessionLinks(scope, openSession);
                let capabilities = {};
                const listeners = new Set();
                const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
                const snapshot = () => capabilities;
                scope.slots.inject("conversation.session.header.utilities", () => scope.slots.register({
                    name: "conversation.session.header.utilities", id: "session-tools.relations", locale: UI_LOCALE,
                }, props => react.createElement(RelationsEntry, { ...props, ...react.useSyncExternalStore(subscribe, snapshot) })));
                scope.inject(["sidebarRight", "sidebarRightTabs"], ui => {
                    const sidebar = ui.sidebarRight;
                    if (!["openTab", "tabsIn", "focus"].every(key => typeof sidebar[key] === "function") || typeof sidebar.mounted?.getSnapshot !== "function" || typeof sidebar.mounted?.subscribe !== "function" || typeof sidebar.tabDomain?.occurrence !== "function" || typeof ui.sidebarRightTabs.register !== "function") return;
                    const shown = new Set(), visibility = new Map();
                    const storageKey = id => "dsh-session-tools:relations-shown:" + id;
                    const wasShown = id => {
                        if (shown.has(id)) return true;
                        try { return localStorage.getItem(storageKey(id)) === "1"; } catch { return false; }
                    };
                    const markShown = id => {
                        shown.add(id);
                        try { localStorage.setItem(storageKey(id), "1"); } catch { /* In-memory suppression still respects a close this run. */ }
                    };
                    const reveal = (id, automatic) => {
                        if (ui.sidebarRight.mounted.getSnapshot() !== id) return;
                        const existing = ui.sidebarRight.tabsIn(id).find(tab => tab.kind === RELATIONS_KIND);
                        if (existing) {
                            // A restored layout must keep the user's selected tab and collapsed state.
                            if (!automatic) {
                                const occurrence = sidebar.tabDomain.occurrence(id, { id: existing.id });
                                if (typeof sidebar.revealOccurrence === "function") sidebar.revealOccurrence(occurrence);
                                else if (visibility.get(existing.id)) sidebar.focus(existing.id);
                                else occurrence.tabActions.openTab(RELATIONS_KIND);
                            }
                        } else ui.sidebarRight.openTab(RELATIONS_KIND);
                        if (ui.sidebarRight.tabsIn(id).some(tab => tab.kind === RELATIONS_KIND)) markShown(id);
                    };
                    ui.effect(() => ui.sidebarRightTabs.register({
                        id: RELATIONS_TAB, kind: RELATIONS_KIND, keepMounted: true,
                        title: () => translate("session"),
                    }));
                    ui.slots.inject("sidebar.right.pane.tab", () => ui.slots.register({
                        name: "sidebar.right.pane.tab", key: RELATIONS_TAB, locale: UI_LOCALE, inject: () => ({ openSession, visibility, communication }),
                    }, RelationsTab));
                    ui.slots.inject("sidebar.right.pane.tab.title", () => ui.slots.register({
                        name: "sidebar.right.pane.tab.title", key: RELATIONS_TAB, locale: UI_LOCALE,
                    }, ({ t = translate }) => t("session")));
                    ui.effect(() => {
                        capabilities = { sidebar, reveal, wasShown };
                        listeners.forEach(listener => listener());
                        return () => { capabilities = {}; listeners.forEach(listener => listener()); };
                    });
                });
				return scope.slots.inject("tool.call.toolview", () => scope.slots.register(
				{
					name: "tool.call.toolview",
					key: "session_create",
					locale: UI_LOCALE,
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
