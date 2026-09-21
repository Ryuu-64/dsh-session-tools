/**
 * Browser half: render the `session_create` tool card as something the person
 * can act on. The host half prints a receipt; this half turns the session that
 * receipt names into a button that opens it.
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

		/** Slots this client half needs before it can register anything. */
		const inject = ["slots", "sessions"];

		/** Diagnostics stay behind one switch so a quiet console stays quiet. */
		const DEBUG = false;

		/**
		* Read the created session out of a settled tool result.
		*
		* The frozen block is tried first (structured output), then the rendered
		* text, which is the form the host half guarantees. Both are read
		* defensively: this half must never break the transcript when a shape
		* changes underneath it.
		* @param block - the settled tool call block handed to the slot.
		* @returns the session id and optional title, or undefined.
		*/
		function readCreatedSession(block) {
			if (block === null || typeof block !== "object") return undefined;
			if (DEBUG) {
				try {
					console.log("[session-tools] block keys:", Object.keys(block), "result:", JSON.stringify(block.result ?? null)?.slice(0, 400));
				} catch {}
			}
			const candidates = [block.value, block.result?.value, block.result?.output, block.output];
			for (const candidate of candidates) {
				if (candidate !== null && typeof candidate === "object" && typeof candidate.sessionId === "string") {
					return { sessionId: candidate.sessionId, title: typeof candidate.title === "string" ? candidate.title : undefined };
				}
			}
			const text = typeof block.value === "string"
				? block.value
				: (block.result?.content ?? []).map((part) => (typeof part?.text === "string" ? part.text : "")).join("\n");
			const id = /session-[0-9a-f-]{8,}/u.exec(text ?? "")?.[0];
			if (id === undefined) return undefined;
			const title = /^Created session:\s*(.+?)\s+·\s+session-/mu.exec(text ?? "")?.[1];
			return { sessionId: id, title };
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
			const title = created?.title === undefined || created.title === "" ? "会话" : created.title;
			const canOpen = created !== undefined && typeof openSession === "function";
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
						title: created?.sessionId ?? "没有读到会话 id",
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
				created === undefined ? react.createElement("span", { style: { opacity: 0.6 } }, "（结果里没有会话信息）") : null,
				created === undefined ? null : react.createElement("span", { style: { opacity: 0.55, fontFamily: "ui-monospace, monospace", fontSize: "11px" } }, created.sessionId),
			);
		}

		/**
		* Wait for the tool view slot list to exist, then register a keyed row that
		* replaces the default card for `session_create`.
		* @param ctx - the browser plugin context.
		*/
		function apply(ctx) {
			ctx.slots.inject("tool.call.toolview", () => ctx.slots.register(
				{
					name: "tool.call.toolview",
					key: "session_create",
					inject: () => ({ openSession: (sessionId) => ctx.sessions.open(sessionId) }),
				},
				SessionCreateRow,
			));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
