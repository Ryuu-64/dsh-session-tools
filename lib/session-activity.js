import { symbols } from "@deepseek-ai/cordis";

// Use events whose rc.2 meaning is independent of crash-recovery repair.
// Bare step/tool completion records do not independently advance activity.
const activityEvents = new Set([
	"user/message", "assistant/message", "assistant/attempt",
	"turn/start", "step/start", "tool/call"
]);
const executedTurnEnds = new Set(["completed", "aborted", "blocked", "error", "max-tokens"]);

export function conversationActivity(events, createdAt, inheritedEventCount = 0) {
	let latest;
	for (let index = inheritedEventCount; index < events.length; index++) {
		const event = events[index];
		const newInput = event.type === "agent/inbox/spliced" && event.data.inserted?.length > 0;
		const executionEnded = event.type === "turn/end" && executedTurnEnds.has(event.data.reason?.kind);
		if ((activityEvents.has(event.type) || newInput || executionEnded) && Number.isFinite(event.time)) {
			latest = latest === undefined ? event.time : Math.max(latest, event.time);
		}
	}
	return latest ?? (Number.isFinite(createdAt) ? createdAt : 0);
}

/** Four active observations, shared by overlapping calls to this tool instance. */
function readSlots() {
	let active = 0;
	const waiting = [];
	return async (read, signal) => {
		signal?.throwIfAborted();
		if (active < 4) active++;
		else await new Promise((resolve, reject) => {
			const entry = { resolve: () => { signal?.removeEventListener("abort", abort); resolve(); } };
			const abort = () => {
				const index = waiting.indexOf(entry);
				if (index >= 0) waiting.splice(index, 1);
				reject(signal.reason);
			};
			waiting.push(entry);
			signal?.addEventListener("abort", abort, { once: true });
		});
		try {
			signal?.throwIfAborted();
			return await read();
		} finally {
			const next = waiting.shift();
			if (next) next.resolve();
			else active--;
		}
	};
}

const identity = service => service?.[symbols.original] ?? service;

/** Cache only the derived number, never a log, a read handle, or an Agent. */
export function createActivitySorter(ctx) {
	const cache = new Map();
	const liveCache = new WeakMap();
	const inSlot = readSlots();
	async function activity(record, signal) {
		const id = String(record.header.id);
		const live = ctx.get("sessions")?.get(id) ?? ctx.agents.get(id)?.session;
		if (typeof live?.snapshotEvents === "function") {
			const events = live.snapshotEvents();
			const source = identity(live);
			const previous = liveCache.get(source);
			if (previous?.version === events.length) return previous.time;
			const time = conversationActivity(events, live.header.createdAt, live.inheritedEventCount);
			liveCache.set(source, { version: events.length, time });
			return time;
		}
		const persistence = ctx.get("sessionPersistence");
		if (persistence !== undefined) {
			const source = identity(persistence);
			// Revisions are comparable only for the same service instance and id.
			const version = (await persistence.stat?.(id, { signal }))?.revision;
			signal?.throwIfAborted();
			const previous = cache.get(id);
			if (version !== undefined && previous?.source === source && previous.version === version) return previous.time;
			const reader = await persistence.open(id, "read", { signal });
			let time;
			try {
				signal?.throwIfAborted();
				const { events } = await reader.read(0, undefined, { signal });
				signal?.throwIfAborted();
				time = conversationActivity(events, reader.header.createdAt, reader.inheritedEventCount);
			} finally {
				await reader.close();
			}
			if (version !== undefined) cache.set(id, { source, version, time });
			return time;
		}
		// Query-only hosts have no revision token, so never reuse a cold result.
		const log = await ctx.get("sessionQuery").readSession(id);
		signal?.throwIfAborted();
		return conversationActivity(log.events, record.header.createdAt, log.inheritedEventCount);
	}
	return async (records, signal) => {
		signal?.throwIfAborted();
		const ids = new Set(records.map(record => String(record.header.id)));
		for (const id of cache.keys()) if (!ids.has(id)) cache.delete(id);
		// Wait for every observation to close, including after an error/abort.
		const ordered = [];
		let next = 0;
		let failed = false;
		const worker = async () => {
			try {
				while (!failed && next < records.length) {
					const index = next++;
					const record = records[index];
					const time = await inSlot(() => activity(record, signal), signal);
					ordered.push({ record, index, time });
				}
			} catch (error) { failed = true; throw error; }
		};
		const results = await Promise.allSettled(Array.from({ length: Math.min(4, records.length) }, worker));
		const failure = results.find(result => result.status === "rejected");
		if (failure) throw failure.reason;
		signal?.throwIfAborted();
		return ordered
			.sort((a, b) => b.time - a.time || a.index - b.index)
			.map(({ record }) => record);
	};
}
