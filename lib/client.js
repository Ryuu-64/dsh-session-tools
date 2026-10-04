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

		/** One ephemeral return point. The port belongs to one concrete reading occurrence. */
		function createReturnNavigation(port) {
			let state = { phase: "idle", record: null, message: "" };
			let active = null, disposed = false;
			const listeners = new Set();
			const publish = (next) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
			const cancel = (clear) => {
				const previous = active; active = null; previous?.controller.abort();
				publish({ phase: "idle", message: "", ...(clear ? { record: null } : {}) });
			};
			const run = (kind, operation, identity) => {
				if (disposed) return Promise.resolve();
				if (active?.kind === kind && active.identity === identity) return active.promise;
				cancel(false);
				const task = { kind, identity, controller: new AbortController(), promise: null };
				active = task;
				const signal = task.controller.signal;
				const timer = setTimeout(() => task.controller.abort(new Error("等待超时，请重试。")), 15000);
				publish({ phase: kind, message: "" });
				task.promise = (async () => {
					try { await operation(signal); }
					catch (error) {
						if (active === task && !disposed) publish({ phase: "error", message: error?.message || "无法打开或精确恢复来源位置，请重试。" });
					} finally {
						clearTimeout(timer);
						if (active === task) { active = null; if (state.phase === kind) publish({ phase: "idle" }); }
					}
				})();
				return task.promise;
			};
			return {
				getSnapshot: () => state,
				subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
				open(target, origin) {
					if (disposed || target === port.current(origin)) return Promise.resolve();
					return run(`opening:${target}`, async signal => {
						const captured = port.capture(origin);
						publish({});
						const release = await port.prepare(target, signal);
						try {
							signal.throwIfAborted();
							await port.open(target, signal);
							signal.throwIfAborted();
							publish({ record: captured === null ? null : { ...captured, targetId: target }, message: captured === null ? "当前阅读视图暂不支持原位返回。" : "" });
						} finally { release?.(); }
					}, port.sourceIdentity?.(origin) ?? origin?.sessionId);
				},
				back() {
					if (disposed || state.record === null) return Promise.resolve();
					const record = state.record;
					return run("restoring", async signal => {
						const release = await port.prepare(record.sessionId, signal, record.position);
						try {
							signal.throwIfAborted();
							if (port.current() !== record.sessionId) await port.open(record.sessionId, signal);
							signal.throwIfAborted();
							await port.restore(record, signal);
							signal.throwIfAborted();
							publish({ record: null, message: "" });
						} finally { release?.(); }
					});
				},
				cancel: () => cancel(false),
				invalidate: () => cancel(true),
				dispose() { disposed = true; cancel(true); listeners.clear(); port.dispose?.(); },
			};
		}

		/** RC2 native-Chat DOM seam, intentionally separate from navigation policy. */
		function createReadingReturnAdapter(ctx, openSession, browser = window) {
			const doc = browser.document;
			let root = null, main = null, navigation = null, ownNavigation = false, controller;
			let expected = new Set(), observer = null, stopPanel = () => {}, stopNavigation = () => {}, intentRoot = null;
			const INTENTS = ["wheel", "touchstart", "pointerdown", "keydown"];
			const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
			const current = () => root?.dataset.conversationSession;
			const scroller = () => root?.querySelector(":scope > [data-conversation-scroll]");
			const chat = () => root?.querySelector('[data-slot="conversation.view"] [data-chat-flow]');
			const source = (id) => {
				const binding = ctx.sessions.binding(id);
				return binding === undefined ? undefined : ctx.uiConversation?.binding(binding).target("chat").getSnapshot();
			};
			const own = (fn) => { ownNavigation = true; try { return fn(); } finally { ownNavigation = false; } };
			const armNavigation = () => {
				stopNavigation();
				navigation = own(() => ctx.layout.beginNavigation());
				const signal = navigation;
				const aborted = () => { if (!ownNavigation) controller.invalidate(); };
				signal.addEventListener("abort", aborted, { once: true });
				stopNavigation = () => signal.removeEventListener("abort", aborted);
			};
			const detachRoot = () => {
				observer?.disconnect(); observer = null; stopPanel(); stopPanel = () => {};
				for (const type of INTENTS) intentRoot?.removeEventListener(type, onIntent, true);
				intentRoot = null;
			};
			const onIntent = event => {
				if (event.type === "keydown" && !SCROLL_KEYS.has(event.key)) return;
				if (controller.getSnapshot().phase !== "idle" && controller.getSnapshot().phase !== "error") controller.cancel();
			};
			const bindRoot = (element) => {
				if (element === root) return;
				detachRoot(); root = element; main = root?.closest('[data-slot="main"]') ?? null;
				if (root === null) return;
				intentRoot = scroller();
				for (const type of INTENTS) intentRoot?.addEventListener(type, onIntent, { passive: true, capture: true });
				observer = new browser.MutationObserver(() => {
					const phase = controller.getSnapshot().phase;
					const differentView = (phase === "idle" || phase === "error")
						&& root.querySelector('[data-slot="conversation.view"]') && !chat();
					if (!root.isConnected || !expected.has(current()) || differentView) controller.invalidate();
				});
				observer.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-conversation-session"] });
				stopPanel = ctx.layout.panelInfo.subscribe(() => {
					if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) controller.invalidate();
				});
			};
			const check = signal => {
				signal.throwIfAborted();
				if (!root?.isConnected || !expected.has(current())) throw new Error("阅读视图已变化，已停止恢复。");
			};
			const wait = (predicate, signal) => new Promise((resolve, reject) => {
				let frame;
				const cleanup = () => { browser.cancelAnimationFrame(frame); signal.removeEventListener("abort", abort); };
				const abort = () => { cleanup(); reject(signal.reason ?? new Error("已停止恢复。")); };
				const sample = () => {
					try { check(signal); const value = predicate(); if (value) { cleanup(); resolve(value); } else frame = browser.requestAnimationFrame(sample); }
					catch (error) { cleanup(); reject(error); }
				};
				signal.addEventListener("abort", abort, { once: true }); sample();
			});
			const abortable = (promise, signal) => new Promise((resolve, reject) => {
				const abort = () => reject(signal.reason ?? new Error("已停止恢复。"));
				if (signal.aborted) { abort(); return; }
				signal.addEventListener("abort", abort, { once: true });
				Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
			});
			const visible = element => !element.closest("[hidden]") && element.getClientRects().length > 0;
			const parts = row => [...row.querySelectorAll("p,pre,li,h1,h2,h3,h4,h5,h6,blockquote")]
				.filter(element => !element.querySelector("p,pre,li"));
			const capture = origin => {
				const clicked = origin?.element;
				const occurrence = clicked?.closest("[data-conversation-content]");
				const hostMain = occurrence?.closest('[data-slot="main"]');
				// uiWorkspace can navigate only the main occurrence. Never adopt an
				// embedded view merely because it displays the same Session id.
				if (!occurrence || !hostMain || hostMain.querySelector("[data-conversation-content]") !== occurrence
					|| occurrence.dataset.conversationSession !== origin.sessionId) {
					const destination = doc.querySelector('[data-slot="main"] [data-conversation-content]');
					if (destination) { bindRoot(destination); expected = new Set([current()]); }
					return null;
				}
				bindRoot(occurrence); expected = new Set([current()]); armNavigation();
				const flow = chat(), scroll = scroller();
				if (!flow || !scroll) return null;
				const viewport = scroll.getBoundingClientRect();
				const bottom = scroll.querySelector("[data-composer-seat]")?.getBoundingClientRect().top ?? viewport.bottom;
				const line = viewport.top + Math.min(24, Math.max(1, (bottom - viewport.top) / 4));
				const rows = [...flow.querySelectorAll('[data-chat-anchor-key][data-chat-node-key]:not([data-chat-flow-kind="turn-process"])')];
				const row = rows.find(element => visible(element) && element.getBoundingClientRect().bottom > line && element.getBoundingClientRect().top < bottom);
				if (!row) return null;
				const group = row.closest("[data-step-process]");
				if (group && !group.hasAttribute("data-group-expanded-mode")) return null;
				const node = source(current())?.nodes.get(row.dataset.chatNodeKey);
				if (!node || !Number.isSafeInteger(node.anchorSeq) || node.anchorSeq < 0) return null;
				const paragraphs = parts(row);
				const paragraph = paragraphs.find(element => visible(element) && element.getBoundingClientRect().bottom > line && element.getBoundingClientRect().top < bottom) ?? row;
				const summary = ctx.sessions.list.getSnapshot().byId[current()];
				return { sessionId: current(), title: summary?.displayTitle || current(), position: {
					anchorKey: row.dataset.chatAnchorKey, nodeKey: row.dataset.chatNodeKey, seq: node.anchorSeq,
					part: paragraphs.indexOf(paragraph), tag: paragraph.tagName, text: paragraph.textContent,
					top: paragraph.getBoundingClientRect().top - viewport.top,
					width: viewport.width, height: paragraph.getBoundingClientRect().height,
				} };
			};
			const port = {
				current: origin => origin?.sessionId ?? current(),
				sourceIdentity: origin => origin?.element?.closest("[data-conversation-content]"),
				capture,
				async prepare(id, signal, position) {
					armNavigation();
					const reference = ctx.sessions.retain(id, { source: "controllerOperation", signal });
					try {
						const binding = await abortable(reference.ready, signal);
						signal.throwIfAborted();
						const verify = () => {
							const snapshot = binding.session.getSnapshot();
							if (snapshot.openState !== "open") throw new Error(snapshot.openError?.message || "会话已删除、不可访问或加载失败，请重试。");
						};
						verify();
						if (position && !source(id)?.nodes.get(position.nodeKey)) {
							await abortable(binding.session.loadThrough(position.seq), signal);
							signal.throwIfAborted(); verify();
						}
						if (position && !source(id)?.nodes.get(position.nodeKey)) throw new Error("来源内容已删除或未能加载，无法精确返回。请重试。");
						return () => reference.release();
					} catch (error) { reference.release(); throw error; }
				},
				async open(id, signal) {
					signal.throwIfAborted();
					expected.add(id);
					own(() => openSession(id)); armNavigation();
					if (root !== null) {
						await wait(() => current() === id && ctx.sessions.binding(id)?.session.getSnapshot().openState === "open", signal);
						expected = new Set([id]);
					}
				},
				async restore(record, signal) {
					const position = record.position;
					let row = await wait(() => [...(chat()?.querySelectorAll("[data-chat-anchor-key]") ?? [])]
						.find(element => element.dataset.chatAnchorKey === position.anchorKey && element.dataset.chatNodeKey === position.nodeKey), signal);
					for (let element = row; element && element !== root; element = element.parentElement) {
						if (element.hasAttribute("hidden")) element.dispatchEvent(new browser.Event("beforematch"));
					}
					await wait(() => visible(row), signal);
					const paragraph = position.part === -1 ? row : parts(row)[position.part];
					if (!paragraph || paragraph.tagName !== position.tag || !paragraph.textContent.startsWith(position.text)) throw new Error("来源内容已变化，无法确认原来阅读的段落。");
					const scroll = scroller();
					check(signal);
					scroll.scrollTop += paragraph.getBoundingClientRect().top - scroll.getBoundingClientRect().top - position.top;
					// The native Chat owns follow-tail. Wait for its real scroll sample;
					// writing its saved cache or inventing a restore API would not do this.
					await wait(() => !root.querySelector("[data-chat-following-tail]"), signal);
					await wait(() => {
						const rect = paragraph.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
						if (Math.abs(rect.top - viewport.top - position.top) < 2) return true;
						if (viewport.width !== position.width || rect.height !== position.height) return rect.bottom > viewport.top && rect.top < viewport.bottom;
						return false;
					}, signal);
					check(signal);
					const hadTabIndex = paragraph.hasAttribute("tabindex");
					if (!hadTabIndex) paragraph.setAttribute("tabindex", "-1");
					paragraph.focus({ preventScroll: true });
					if (!hadTabIndex) paragraph.removeAttribute("tabindex");
				},
				dispose() { detachRoot(); stopNavigation(); root = null; main = null; },
			};
			controller = createReturnNavigation(port);
			return { ...controller, root: () => root, main: () => main };
		}

		/** Additive native header action; it never renders in another reading occurrence. */
		function ReturnToSource(props) {
			const controller = props.returnController ?? props.slot?.injected?.returnController;
			const state = react.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
			const ref = react.useRef(null);
			const [belongs, setBelongs] = react.useState(false);
			react.useLayoutEffect(() => { setBelongs(ref.current?.closest('[data-slot="main"]') === controller.main()); }, [controller, state]);
			const busy = state.phase !== "idle" && state.phase !== "error";
			return react.createElement("span", { ref, "data-session-tools-return": "", style: { display: "inline-flex", alignItems: "center", gap: "6px" } }, belongs && react.createElement(react.Fragment, null,
				state.record && react.createElement("button", { type: "button", disabled: busy, onClick: () => { void controller.back(); }, title: state.record.sessionId }, `返回 ${state.record.title} 的原位置`),
				busy && react.createElement("span", { role: "status" }, state.phase === "restoring" ? "正在恢复阅读位置…" : "正在打开会话…"),
				busy && react.createElement("button", { type: "button", onClick: controller.cancel }, "停止"),
				state.message && react.createElement("span", { role: "status" }, state.message),
			));
		}

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
			const onOpen = (event) => {
				if (!canOpen) return;
				try {
					openSession(created.sessionId, { sessionId: props.sessionId, element: event?.currentTarget });
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
			);
		}

		/**
		* Wait for the tool view slot list to exist, then register a keyed row that
		* replaces the default card for `session_create`.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
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
				ctx.inject(["uiWorkspace"], (scope) => {
					const openSession = sessionId => scope.uiWorkspace.openSession(sessionId);
					if (!window.document) { register(scope, openSession); return; }
					const controller = createReadingReturnAdapter(scope, openSession);
					scope.effect(() => () => controller.dispose());
					register(scope, (sessionId, origin) => { void controller.open(sessionId, origin); });
					scope.slots.inject("conversation.session.header.actions", () => scope.slots.register({
						name: "conversation.session.header.actions", id: "session-tools.return-source",
						inject: () => ({ returnController: controller }),
					}, ReturnToSource));
				});
			}
		}

		exports.createReturnNavigation = createReturnNavigation;
		exports.createReadingReturnAdapter = createReadingReturnAdapter;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
