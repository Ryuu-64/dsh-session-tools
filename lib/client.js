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
		* Read the created session out of a settled tool result.
		*
		* The result node's `content` blocks are the form the host half guarantees,
		* so they are the first source; a structured value is used when present.
		* Both are read defensively: this half must never break the transcript when
		* a shape changes underneath it.
		* @param block - the settled tool call block handed to the slot.
		* @param output - the owner's rendered result text, when it passes one.
		* @returns the session id and optional title, or undefined.
		*/
		function readCreatedSession(block, output) {
			if (block === null || typeof block !== "object") return undefined;
			// Settled results expose `content` directly; a raw event nests them under `result`.
			const settled = Array.isArray(block.content) ? block : block.result ?? block;
			if (DEBUG) {
				try {
					console.log("[session-tools] block:", Object.keys(block), "settled:", Object.keys(settled), "output:", String(output ?? "").slice(0, 160));
				} catch {}
			}
			for (const candidate of [settled.value, settled.output, block.value, block.output]) {
				if (candidate !== null && typeof candidate === "object" && typeof candidate.sessionId === "string") {
					return { sessionId: candidate.sessionId, title: typeof candidate.title === "string" ? candidate.title : undefined };
				}
			}
			const text = [resultText(settled), typeof output === "string" ? output : ""].filter((part) => part !== "").join("\n");
			const id = /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/u.exec(text)?.[0];
			if (id === undefined) return undefined;
			const title = /Created session:\s*(.+?)\s+·\s+session-/u.exec(text)?.[1];
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
			// The owner hands over the raw result node; `output` is its rendered text.
			// Reading both makes the row survive a shape change on either side.
			const created = readCreatedSession(props.block, props.output);
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
