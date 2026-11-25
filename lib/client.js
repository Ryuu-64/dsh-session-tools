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
		const { MenuItemButton, Modal, Button, Switch, Tag, ReferenceIconRegular, SettingsForm, SettingsFormModel } = require("@deepseek-ai/dsh-client-ui-primitives");

		/** One ephemeral return point. The port belongs to one concrete reading occurrence. */
		function createReturnNavigation(port) {
			let state = { phase: "idle", record: null, message: "", reason: "" };
			let active = null, disposed = false;
			const listeners = new Set();
			const publish = (next) => { state = { ...state, ...next }; for (const listener of listeners) listener(); };
			const cancel = (clear, reason = "") => {
				const previous = active; active = null; previous?.controller.abort();
				publish({ phase: "idle", message: "", reason, ...(clear ? { record: null } : {}) });
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
					if (disposed) return Promise.resolve();
					if (target === port.current(origin)) {
						if (active !== null) cancel(false);
						return Promise.resolve();
					}
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
						const release = port.prepareReturn
							? await port.prepareReturn(record, signal)
							: await port.prepare(record.sessionId, signal, record.position);
						try {
							signal.throwIfAborted();
							if (port.openForReturn) await port.openForReturn(record, signal);
							else if (port.current() !== record.sessionId) await port.open(record.sessionId, signal);
							signal.throwIfAborted();
							await port.restore(record, signal);
							signal.throwIfAborted();
							publish({ record: null, message: "" });
						} finally { release?.(); }
					});
				},
				cancel: () => cancel(false),
				fail(message) { cancel(true); publish({ phase: "error", message }); },
				invalidate: (reason = "navigation") => cancel(true, reason),
				dispose() { disposed = true; cancel(true); listeners.clear(); port.dispose?.(); },
			};
		}

		/** RC2 native-Chat DOM seam, intentionally separate from navigation policy. */
		function createReadingReturnAdapter(ctx, openSession, browser = window) {
			const doc = browser.document;
			let root = null, main = null, navigation = null, ownNavigation = false, controller;
			let expected = new Set(), observer = null, lifetimeObserver = null, stopPanel = () => {}, stopNavigation = () => {}, intentRoot = null;
			let viewTransition = false, transitionTarget = null, viewGuard = null, hadChat = false;
			const nativeContent = owner => owner?.querySelector('[data-slot="main.conversation"] [data-conversation-content]') ?? null;
			const selectedTab = () => main?.querySelector('[data-conversation-tabs] [role="tab"][aria-selected="true"]') ?? null;
			const adoptView = () => { viewGuard = { sessionId: current(), tab: selectedTab() }; hadChat = Boolean(chat()); };
			const INTENTS = ["wheel", "touchstart", "pointerdown", "keydown"];
			const SCROLL_KEYS = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
			const current = () => root?.dataset.conversationSession;
			const scroller = () => root?.querySelector(":scope > [data-conversation-scroll]");
			const chat = () => root?.querySelector('[data-slot="conversation.view"] [data-chat-flow]');
			const source = (id) => {
				const binding = ctx.sessions.binding(id);
				if (binding === undefined) return undefined;
				const conversation = ctx.uiConversation.binding(binding);
				// A cold retained Session has no mounted Chat subscriber yet. The
				// public activation builds its target without selecting a UI view.
				conversation.activate("chat");
				return conversation.target("chat").getSnapshot();
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
				observer?.disconnect(); observer = null; lifetimeObserver?.disconnect(); lifetimeObserver = null; stopPanel(); stopPanel = () => {};
				for (const type of INTENTS) intentRoot?.removeEventListener(type, onIntent, true);
				intentRoot = null;
				main?.removeEventListener("click", onViewIntent, true);
				main?.removeEventListener("keydown", onViewIntent, true);
			};
			const onIntent = event => {
				if (event.type === "keydown" && !SCROLL_KEYS.has(event.key)) return;
				if (controller.getSnapshot().phase !== "idle" && controller.getSnapshot().phase !== "error") controller.cancel();
			};
			const onViewIntent = event => {
				if (!event.target?.closest('[data-conversation-tabs] [role="tab"]')) return;
				if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
				controller.invalidate();
			};
			const retireRoot = () => {
				controller.invalidate("view-unmounted"); detachRoot(); stopNavigation();
				root = null; main = null; expected = new Set(); viewGuard = null; hadChat = false;
			};
			const viewChanged = () => {
				if (viewTransition || root === null) return false;
				const differentTab = viewGuard?.sessionId === current()
					&& viewGuard.tab !== null && selectedTab() !== viewGuard.tab;
				return differentTab || (hadChat && root.querySelector('[data-slot="conversation.view"]')?.firstElementChild && !chat());
			};
			const adoptExpectedRoot = () => {
				const owner = transitionTarget?.main;
				if (!viewTransition || !owner?.isConnected) return false;
				const next = nativeContent(owner);
				if (!next || next.dataset.conversationSession !== transitionTarget.id || next.closest('[data-slot="main"]') !== owner) return false;
				if (next !== root) bindRoot(next);
				return true;
			};
			const bindRoot = (element) => {
				if (element === root) return;
				detachRoot(); root = element; main = root?.closest('[data-slot="main"]') ?? null;
				expected = new Set([current()]);
				if (root === null) return;
				adoptView();
				main.addEventListener("click", onViewIntent, true);
				main.addEventListener("keydown", onViewIntent, true);
				intentRoot = scroller();
				for (const type of INTENTS) intentRoot?.addEventListener(type, onIntent, { passive: true, capture: true });
				observer = new browser.MutationObserver(() => {
					if (root === null) return;
					if (!root.isConnected) { if (viewTransition) adoptExpectedRoot(); else retireRoot(); return; }
					// Selected tab identity catches Chat→Trajectory→Chat while a
					// history request is pending; empty loading outlets are allowed.
					if (!expected.has(current()) || viewChanged()) controller.invalidate(!expected.has(current()) ? `session-changed:${JSON.stringify({ current: current(), expected: [...expected], phase: controller.getSnapshot().phase })}` : "view-changed");
					else if (!viewTransition && viewGuard?.tab === null && selectedTab() !== null) adoptView();
				});
				observer.observe(main, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-conversation-session", "aria-selected"] });
				// Removing an ancestor does not notify an observer attached only
				// inside it. This observer does no geometry or transcript scanning.
				lifetimeObserver = new browser.MutationObserver(() => {
					if (root !== null && !root.isConnected) { if (viewTransition) adoptExpectedRoot(); else retireRoot(); }
				});
				lifetimeObserver.observe(doc, { childList: true, subtree: true });
				stopPanel = ctx.layout.panelInfo.subscribe(() => {
					if (ctx.layout.panelInfo.getSnapshot().activePanelId !== null) controller.invalidate("panel-changed");
				});
			};
			const check = signal => {
				signal.throwIfAborted();
				if (viewTransition && transitionTarget?.main) {
					if (!transitionTarget.main.isConnected) throw new Error("主阅读视图已卸载，已停止导航。");
					adoptExpectedRoot();
					if (!root?.isConnected) return;
				}
				if (viewChanged()) { controller.invalidate("view-changed"); signal.throwIfAborted(); }
				if (!root?.isConnected || !expected.has(current())) throw new Error("阅读视图已变化，已停止恢复。");
				if (!viewTransition && ctx.sessions.binding(current())?.session.getSnapshot().removed) throw new Error("会话已删除，已停止恢复。");
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
				const nativeReading = ctx.get?.("uiChatReading");
				if (nativeReading && clicked) {
					const destination = nativeContent(doc.querySelector('[data-slot="main"]'));
					if (destination) { bindRoot(destination); expected = new Set([current()]); armNavigation(); }
					const bookmark = nativeReading.capture(clicked);
					if (bookmark === null) return null;
					const summary = ctx.sessions.list.getSnapshot().byId[bookmark.sessionId];
					return { sessionId: bookmark.sessionId, title: summary?.displayTitle || bookmark.sessionId, native: { service: nativeReading, bookmark } };
				}
				const occurrence = clicked?.closest("[data-conversation-content]");
				const hostMain = occurrence?.closest('[data-slot="main"]');
				// uiWorkspace can navigate only the main occurrence. Never adopt an
				// embedded view merely because it displays the same Session id.
				if (!occurrence || !hostMain || nativeContent(hostMain) !== occurrence
					|| occurrence.dataset.conversationSession !== origin.sessionId) {
					const destination = nativeContent(doc.querySelector('[data-slot="main"]'));
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
							if (snapshot.removed) throw new Error(position ? "来源会话已删除，无法返回原位置。" : "目标会话已删除，无法打开。");
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
					if (root !== null) check(signal);
					expected.add(id); viewTransition = true; transitionTarget = { main: main ?? doc.querySelector('[data-slot="main"]'), id };
					try {
						own(() => openSession(id)); armNavigation();
						if (transitionTarget.main !== null) {
							await wait(() => current() === id && ctx.sessions.binding(id)?.session.getSnapshot().openState === "open", signal);
							expected = new Set([id]);
						}
					} finally {
						viewTransition = false; transitionTarget = null;
						if (root !== null && !root.isConnected) retireRoot(); else adoptView();
					}
				},
				async prepareReturn(record, signal) {
					if (record.native) return () => {};
					return port.prepare(record.sessionId, signal, record.position);
				},
				async openForReturn(record, signal) {
					if (!record.native && current() !== record.sessionId) await port.open(record.sessionId, signal);
				},
				async restore(record, signal) {
					if (record.native) {
						// The native service owns navigation cancellation and the exact source
						// occurrence; the consumer must not substitute another same-session view.
						stopNavigation();
						const navigationSessionId = record.native.bookmark.navigationSessionId ?? current();
						expected.add(navigationSessionId);
						viewTransition = true;
						transitionTarget = { main: main ?? doc.querySelector('[data-slot="main"]'), id: navigationSessionId };
						try {
							const result = await record.native.service.restore(record.native.bookmark, signal);
							signal.throwIfAborted();
							if (result.kind !== "restored") {
								const messages = { unavailable: "来源阅读视图已关闭或变化，无法原位返回。", missing: "来源内容已删除或未能加载，无法精确返回。", changed: "来源内容已变化，无法确认原来阅读的位置。", interrupted: "阅读恢复已被新的操作打断。" };
								if (result.kind === "unavailable") { controller.fail(messages.unavailable); return; }
								if (result.kind === "interrupted") { controller.invalidate(); return; }
								throw new Error(messages[result.kind] || "无法精确恢复来源位置，请重试。");
							}
						} finally {
							viewTransition = false; transitionTarget = null;
							if (root !== null && !root.isConnected) retireRoot();
							else { expected = new Set([current()]); adoptView(); }
						}
						return;
					}
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
						if (!paragraph.isConnected || !chat()?.contains(row)) throw new Error("来源内容已卸载，已停止恢复。");
						const rect = paragraph.getBoundingClientRect(), viewport = scroll.getBoundingClientRect();
						if (Math.abs(rect.top - viewport.top - position.top) < 2) return true;
						if (viewport.width !== position.width || rect.height !== position.height) return rect.bottom > viewport.top && rect.top < viewport.bottom;
						return false;
					}, signal);
					check(signal);
					if (!paragraph.isConnected || !chat()?.contains(row)) throw new Error("来源内容已卸载，已停止恢复。");
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
			return react.createElement("span", { ref, "data-session-tools-return": "", "data-return-phase": state.phase, "data-return-reason": state.reason, "data-return-message": state.message, style: { display: "inline-flex", alignItems: "center", gap: "6px" } }, belongs && react.createElement(react.Fragment, null,
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
			const readingUnavailable = props.readingUnavailable ?? props.slot?.injected?.readingUnavailable;
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
						"data-session-tools-source": props.sessionId,
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
				readingUnavailable && react.createElement("span", null, "当前宿主不支持返回原阅读位置"),
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
					value: { record: null, busy: false, failed: false, notice: "正在读取设置…" } });
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
						notice: entry.saving ? "已读取当前设置，保存请求仍未结束；暂不能再次更改。" : changed ? "设置已在其他页面更改，已同步最新状态。" : entry.value.record ? entry.value.notice : "已读取最新设置。更改后立即生效。" });
				} catch {
					if (token === entry.token) publish(entry, { record: null, failed: true, notice: "状态未知，暂时无法读取设置。请重试。" });
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
				publish(entry, { busy: true, failed: false, notice: "正在保存…" });
				// A timeout cannot cancel an accepted write. Keep the write lock until
				// it settles; never replay it or offer a misleading rollback.
				let timedOut = false, staleResponse = false;
				const timer = setTimeout(() => {
					if (api !== owner) return;
					timedOut = true;
					publish(entry, { record: null, failed: true, notice: "保存结果尚未确认，仍在等待。不会重复提交；关闭面板不会取消更改。" });
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
						notice: result.value.status === "saved" ? "已保存，立即生效。" : "设置已在其他页面更改。已显示最新设置，请确认后再操作。" });
				} catch {
					if (api !== owner) return;
					publish(entry, { record: null, failed: true, notice: "保存结果暂无法确认，正在重新读取；不会自动重复保存。" });
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
							publish(entry, { record: null, busy: entry.saving, failed: true, notice: "连接已断开，状态未知。恢复连接后会重新读取。" });
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
		function CommunicationControls({ sessionId, store, compact = false, visible = true }) {
			const subscribe = react.useCallback(listener => store.subscribe(sessionId, listener, visible), [store, sessionId, visible]);
			const snapshot = react.useCallback(() => store.get(sessionId), [store, sessionId]);
			const { record, busy, failed, notice } = react.useSyncExternalStore(subscribe, snapshot);
			react.useEffect(() => { if (visible) void store.read(sessionId); }, [store, sessionId, visible]);
			const row = (key, label, description) => react.createElement("div", { key, style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: compact ? 8 : 24, padding: compact ? "10px 0" : "16px 0", borderBottom: "0.5px solid var(--dsw-alias-border-l2)" } },
				react.createElement("div", { title: description, style: { flex: 1, minWidth: 0, fontSize: compact ? 13 : 14, lineHeight: "20px", color: "var(--dsw-alias-label-primary)" } }, label,
					!compact && react.createElement("div", { style: { marginTop: 4, fontSize: 12, lineHeight: "18px", color: "var(--dsw-alias-label-secondary)" } }, description)),
				react.createElement("span", { "aria-hidden": true, style: { flexShrink: 0, color: "var(--dsw-alias-label-secondary)", fontSize: 12 } }, record ? record[key] ? "开启" : "关闭" : "未知"),
				record && react.createElement(Switch, { checked: record[key], onChange: value => void store.change(sessionId, key, value), label, disabled: busy }));
			return react.createElement("section", { "aria-label": "会话通信", "aria-busy": busy, "data-communication-session": sessionId, style: { padding: compact ? "0 6px 12px" : 0, minWidth: 0 } },
				row("receive", "接收其他会话消息", "关闭会拒绝新的插件消息：未送达、未排队；已接收消息继续处理。"),
				row("send", "向其他会话发送", "也控制创建带首条消息的新会话。"),
				(!compact || record?.receive === false) && react.createElement("p", { style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: "18px" } }, "仅控制本插件的新消息。关闭接收后，新消息未送达、未排队；已经接收的消息继续处理，历史仍可查看。"),
				react.createElement("div", { role: failed ? "alert" : "status", "aria-live": "polite", style: { marginTop: 8, fontSize: 12, lineHeight: "18px", color: failed ? "var(--dsw-alias-state-error-primary)" : "var(--dsw-alias-label-secondary)" } }, notice),
				!record && !busy && react.createElement(Button, { variant: "outline", onClick: () => void store.read(sessionId) }, "重新读取"));
		}
		function CommunicationForm({ request, store, close }) {
			return react.createElement(Modal, { open: true, onClose: close, closeLabel: "关闭", title: "会话通信", description: request.title || request.sessionId,
				footer: react.createElement(Button, { variant: "outline", onClick: close }, "关闭"),
			}, react.createElement(CommunicationControls, { sessionId: request.sessionId, store }));
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
			if ((!parentId || parentId === sessionId) && children.length === 0) return react.createElement("p", { style: { margin: 8, color: "var(--dsw-alias-label-secondary)", fontSize: 13 } }, "当前对话还没有相关对话。");
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
            }, react.createElement(CommunicationControls, { key: props.sessionId, sessionId: props.sessionId, store: props.communication, compact: true, visible: tab.visible }),
                react.createElement(RelatedConversationRows, { ...props, key: tab.id }));
        }
        function RelationsEntry(props) {
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
                variant: "ghost", size: "sm", title: props.sidebar ? "会话通信与相关对话" : "会话工具不可用：宿主未提供会话工具停靠接口", "aria-label": props.sidebar ? "会话通信与相关对话" : "会话工具不可用：宿主未提供会话工具停靠接口", disabled: !props.sidebar,
                style: { flex: "none", width: 28, padding: 0, color: "var(--dsw-alias-label-secondary)" },
                onClick: () => props.reveal(props.sessionId, false),
            }, react.createElement(ReferenceIconRegular, { kind: "session", size: 16 }));
        }
		function registerCommunicationUI(ctx, store) {
			let request = null;
			const listeners = new Set();
			const publish = value => { request = value; for (const listener of listeners) listener(); };
			const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
			function Overlay() {
				const current = react.useSyncExternalStore(subscribe, () => request);
				return current ? react.createElement(CommunicationForm, { key: current.sessionId, request: current, store, close: () => publish(null) }) : null;
			}
			ctx.slots.inject("shell.overlay", () => ctx.slots.register({ name: "shell.overlay", id: "session-tools.communication" }, Overlay));
			ctx.slots.inject("sidebar.workspaces.session.menu.item", () => ctx.slots.register({ name: "sidebar.workspaces.session.menu.item", id: "session-tools.communication", order: 350 },
				({ sessionId, displayTitle, useMenuOpenState }) => {
					const [, setMenuOpen] = useMenuOpenState();
					return react.createElement(MenuItemButton, { onSelect: () => { setMenuOpen(false); publish({ sessionId, title: displayTitle }); } }, "会话通信…");
				}));
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
				for (const key of ["session_send", "session_wait"]) yield ctx.slots.register({ name: "tool.call.toolview", key }, MessageStateRow);
			});
			const register = (scope, openSession) => {
                let capabilities = {};
                const listeners = new Set();
                const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
                const snapshot = () => capabilities;
                scope.slots.inject("conversation.session.header.utilities", () => scope.slots.register({
                    name: "conversation.session.header.utilities", id: "session-tools.relations",
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
                        title: () => "会话",
                    }));
                    ui.slots.inject("sidebar.right.pane.tab", () => ui.slots.register({
                        name: "sidebar.right.pane.tab", key: RELATIONS_TAB, inject: () => ({ openSession, visibility, communication }),
                    }, RelationsTab));
                    ui.effect(() => {
                        capabilities = { sidebar, reveal, wasShown };
                        listeners.forEach(listener => listener());
                        return () => { capabilities = {}; listeners.forEach(listener => listener()); };
                    });
                });
				registerCard(scope, openSession);
			};
			const registerCard = (scope, openSession, priority = 0, readingUnavailable = true) => scope.slots.inject("tool.call.toolview", () => scope.slots.register(
				{
					name: "tool.call.toolview",
					key: "session_create", priority,
					inject: () => ({ openSession, readingUnavailable }),
				},
				SessionCreateRow,
			));
			// Pre-0.2 hosts put UI selection on sessions. In 0.2 the Session
			// Controller only owns data/references; UIWorkspace owns mainView
			// retention, selection, panel reveal and release. Do not retain a
			// persistent reference. Reading checks use only bounded temporary references.
			if (typeof ctx.sessions.open === "function") {
				register(ctx, (sessionId) => ctx.sessions.open(sessionId));
			} else {
				// Package client.inject is not a startup-order guarantee. Wait for
				// the actual service and bind the row to that service's lifetime.
				ctx.inject(["uiWorkspace"], (scope) => {
					const openSession = sessionId => scope.uiWorkspace.openSession(sessionId);
					register(scope, openSession);
					if (!window.document) return;
					// Module dependencies install packages; Cordis service injection
					// separately grants access and binds this adapter to their lifetime.
					scope.inject(["layout", "uiConversation"], (readingScope) => {
						// Stock RC2 has navigation but no native reading-ownership capability.
						// Shadow its explicit unavailable card only while that capability lives.
						readingScope.inject(["uiChatReading"], (nativeScope) => {
							const controller = createReadingReturnAdapter(nativeScope, openSession);
							nativeScope.effect(() => () => controller.dispose());
							registerCard(nativeScope, (sessionId, origin) => { void controller.open(sessionId, origin); }, -1, false);
							nativeScope.slots.inject("conversation.session.header.actions", () => nativeScope.slots.register({
								name: "conversation.session.header.actions", id: "session-tools.return-source",
								inject: () => ({ returnController: controller }),
							}, ReturnToSource));
						});
					});
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
