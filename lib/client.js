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
				ctx.inject(["uiWorkspace"], (scope) => register(scope,
					(sessionId) => scope.uiWorkspace.openSession(sessionId)));
			}
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
