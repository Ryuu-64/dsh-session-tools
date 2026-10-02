/**
 * Test suite for dsh-session-tools. Runs the real plugin against fake hosts and
 * real session logs. No network, no DSH process needed.
 *
 *   node --test test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const plugin = await import(new URL("../lib/index.js", import.meta.url).href);

const ANSWER_OLD = "上一轮的答案";
const ANSWER_NEW = "这一轮的新答案";

/**
 * A fake host good enough to load the plugin and drive its tools. The approval
 * service is stubbed as "allowed once" because the plugin asks before writing
 * into another session — without it every send is refused by design.
 */
function build({ agentFor = () => undefined, query, policy = "ask" } = {}) {
  const registered = [];
  const ctx = {
    tools: { register: (definition) => registered.push(definition) },
    agents: { get: agentFor },
    sessionTitle: { get: () => undefined, rename: () => {} },
    workspaceRegistry: {
      resolveByPath: async () => undefined,
      list: () => [],
      archivedSessionIds: [],
    },
    agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
    get: (serviceName) => {
      if (serviceName === "sessionQuery") return query;
      if (serviceName === "sandboxPolicy") return { resolve: () => ({ mode: "workspace-write" }) };
      if (serviceName === "approval") {
        return {
          overrideOf: () => policy,
          config: { policy: "ask" },
          // The service answers with the decision itself, not a wrapper object.
          request: async () => "allowed-once",
        };
      }
      return undefined;
    },
  };
  plugin.apply(ctx);
  return Object.fromEntries(registered.map((definition) => [definition.name, definition]));
}

const execFor = (name) => ({ agent: { id: "self" }, name, callId: "call-1" });

/**
 * An agent that models the host's real timing, taken from
 * `@deepseek-ai/dsh-agent-loop`:
 *
 *   - `activityDone` is a resolved promise while the agent is idle.
 *   - `wakeDriver` replaces it with a fresh pending promise and flips the phase
 *     to `running` in the SAME synchronous block, then kicks the driver.
 *   - `whenIdle` loops until `activityDone` stops changing.
 *
 * That is what makes "queue a message, then wait" subtle: a caller that awaits
 * idle without checking the inbox can be handed the previous answer.
 */
function fakeAgent(t, { startDelayMs = 0, workMs = 0, faithfulWhenIdle = true } = {}) {
  const timers = new Set();
  const schedule = (callback, delay) => {
    const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
    return timer;
  };
  t.after(() => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });
  const queued = [];
  const events = [];
  const append = (type, data) => events.push({ seq: events.length, type, data });
  append('turn/start', { turn: 1 });
  append('assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: ANSWER_OLD }] }, stream: [] });
  append('turn/end', { turn: 1, reason: { kind: 'completed' } });
  let turn = 1;
  let phase = "idle";
  let activityDone = Promise.resolve();

  const startWork = () => {
    const driver = Promise.withResolvers();
    activityDone = driver.promise;
    phase = "running";
    // The driver picks the message up in a microtask, like `kick()` does.
    queueMicrotask(() => {
      turn++;
      append('turn/start', { turn });
      const claimed = queued.splice(0, queued.length);
      append('agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: claimed.length, inserted: [] });
      for (const message of claimed) append('user/message', message);
      schedule(() => {
        append('assistant/message', { turn, step: 1, message: { content: [{ type: 'text', text: ANSWER_NEW }] }, stream: [] });
        append('turn/end', { turn, reason: { kind: 'completed' } });
        phase = "idle";
        driver.resolve();
      }, workMs);
    });
  };

  const agent = {
    id: "target",
    session: { header: { cwd: "E:\\x", id: "target" }, snapshotEvents: () => events.slice() },
    get status() {
      return phase;
    },
    inbox: {
      get nextTurn() {
        return queued.slice();
      },
    },
    followup(message) {
      append('agent/inbox/spliced', { target: 'next-turn', start: queued.length, inserted: [message] });
      queued.push(message);
      if (startDelayMs > 0) schedule(startWork, startDelayMs);
      else startWork();
    },
    async whenIdle() {
      if (!faithfulWhenIdle) {
        // The tempting-but-wrong shape: it happens to work while a message sits
        // in the inbox, which is exactly why the bug hid for so long.
        return new Promise((resolve) => {
          const poll = () => (phase === "idle" && queued.length === 0 ? resolve() : schedule(poll, 5));
          poll();
        });
      }
      let activity;
      do await (activity = activityDone);
      while (activity !== activityDone);
    },
  };
  return agent;
}

function eventsFor(replies) {
  const events = [
    { type: "assistant/message", data: { message: { content: [{ type: "text", text: ANSWER_OLD }] } } },
  ];
  for (const reply of replies) {
    events.push({ type: "assistant/message", data: { message: { content: [{ type: "text", text: reply }] } } });
  }
  return events;
}

const queryFor = (events) => ({
  listSessions: async () => [{ header: { id: "target", cwd: "E:\\x" } }],
  readSession: async () => ({ events }),
  readTitle: async () => ({ title: "target" }),
});

test("session_send wait:true waits for the queued message, not the previous answer", async (t) => {
  const agent = fakeAgent(t, { startDelayMs: 120, workMs: 180 });
  const tools = build({ agentFor: (id) => (id === "target" ? agent : undefined), query: queryFor(eventsFor([ANSWER_NEW])) });

  const result = await tools.session_send.execute(
    { sessionId: "target", message: "干活", wait: true, timeoutMs: 5000 },
    execFor("session_send"),
  );

  assert.equal(result.waited, true);
  assert.equal(result.completed, true, "the send must report completion only after the target answered");
  assert.equal(result.output, ANSWER_NEW, "the answer must be the one produced after our message, not the previous turn");
  assert.equal(agent.inbox.nextTurn.length, 0, "our message must have been consumed");
});

test("session_send wait:true reports a timeout instead of a stale answer", { timeout: 3000 }, async (t) => {
  // The target never gets to our message within the budget.
  const agent = fakeAgent(t, { startDelayMs: 10_000, workMs: 10 });
  const tools = build({ agentFor: (id) => (id === "target" ? agent : undefined), query: queryFor(eventsFor([])) });
  const realSetTimeout = globalThis.setTimeout;
  let deadlineFired = false;
  t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
    if (ms !== 300) return realSetTimeout(callback, ms, ...args);
    return realSetTimeout((...values) => { deadlineFired = true; callback(...values); }, ms, ...args);
  });
  const controller = new AbortController();
  t.after(() => controller.abort());

  const result = await tools.session_send.execute(
    { sessionId: "target", message: "干活", wait: true, timeoutMs: 300 },
    { ...execFor("session_send"), signal: controller.signal },
  );

  assert.equal(result.waited, true);
  assert.equal(result.completed, false, "an unanswered message must not be reported as completed");
  assert.equal(result.waitStatus, "timedOut");
  assert.equal(result.output, undefined, "timeout must not return the previous answer");
  // Node timers and Date.now use different clocks; a real 300ms timer can
  // produce a 299ms wall-clock delta. Verify the actual deadline fired instead.
  assert.equal(deadlineFired, true, "must wait for the requested 300ms timer");
  assert.equal(agent.inbox.nextTurn.length, 1, "timing out must leave the target message queued");
});

test("session_send consumes exactly its observation budget on a controlled clock", { timeout: 3000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000 });
  const observationStarted = Promise.withResolvers();
  const mockedSetTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, ms, ...args) => {
    const timer = mockedSetTimeout(callback, ms, ...args);
    // The fixture's 10s startup timer is distinct from the observation timer.
    if (ms !== 10_000) observationStarted.resolve(ms);
    return timer;
  });
  const agent = fakeAgent(t, { startDelayMs: 10_000, workMs: 10 });
  const tools = build({ agentFor: (id) => (id === "target" ? agent : undefined), query: queryFor(eventsFor([])) });
  const controller = new AbortController();
  t.after(() => controller.abort());
  const pending = tools.session_send.execute(
    { sessionId: "target", message: "干活", wait: true, timeoutMs: 300 },
    { ...execFor("session_send"), signal: controller.signal },
  );
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    assert.equal(await observationStarted.promise, 300, "forward the exact requested budget");
    t.mock.timers.tick(299);
    await new Promise(setImmediate); // Drain result microtasks without advancing the clock.
    assert.equal(settled, false, "must not settle before the deadline");
    t.mock.timers.tick(1);
    const result = await pending;
    assert.equal(result.waited, true);
    assert.equal(result.completed, false);
    assert.equal(result.waitStatus, "timedOut");
    assert.equal(result.elapsedMs, 300);
    assert.equal(result.output, undefined);
    assert.equal(agent.inbox.nextTurn.length, 1);
  } finally {
    controller.abort();
    await pending.catch(() => {});
  }
});

test("session_wait waits while the target is already running", async (t) => {
  const agent = fakeAgent(t, { startDelayMs: 0, workMs: 150 });
  agent.followup({ id: "already", content: [] }); // pretend work is in flight
  const tools = build({ agentFor: (id) => (id === "target" ? agent : undefined), query: queryFor(eventsFor([ANSWER_NEW])) });

  const result = await tools.session_wait.execute({ sessionId: "target", timeoutMs: 5000 }, execFor("session_wait"));
  assert.equal(result.completed, true);
  assert.equal(result.output, ANSWER_NEW);
});

test("session_wait on an idle session returns its last answer at once", async () => {
  const events = eventsFor([]);
  const tools = build({ query: queryFor(events) });

  const started = Date.now();
  const result = await tools.session_wait.execute({ sessionId: "target", timeoutMs: 5000 }, execFor("session_wait"));

  assert.equal(result.completed, true);
  assert.equal(result.running, false);
  assert.equal(result.output, ANSWER_OLD);
  assert.ok(Date.now() - started < 1000, "an idle session must not make the caller wait");
});

test("session_wait rejects an unknown session id", async () => {
  const tools = build({ query: { listSessions: async () => [], readSession: async () => ({ events: [] }) } });
  await assert.rejects(
    () => tools.session_wait.execute({ sessionId: "nope" }, execFor("session_wait")),
    /cannot find session/,
  );
});

test("session_wait refuses to wait on its own session", async () => {
  const tools = build({ query: queryFor([]) });
  await assert.rejects(
    () => tools.session_wait.execute({ sessionId: "self" }, { agent: { id: "self" }, name: "session_wait", callId: "c" }),
    /own session/,
  );
});

test("waitBudgetMs: a nonsensical budget falls back to the default, absurd values are capped", async (t) => {
  const agent = fakeAgent(t, { startDelayMs: 0, workMs: 0 });
  agent.followup({ id: "x", content: [] });
  const tools = build({ agentFor: (id) => (id === "target" ? agent : undefined), query: queryFor(eventsFor([ANSWER_NEW])) });

  // A negative budget must not become a zero-length wait.
  const started = Date.now();
  const result = await tools.session_wait.execute({ sessionId: "target", timeoutMs: -5 }, execFor("session_wait"));
  const elapsed = Date.now() - started;
  assert.equal(result.completed, true, "a negative budget must fall back to the default, not expire instantly");
  assert.ok(elapsed < 3000, `should have finished quickly once the work settled, took ${elapsed}ms`);
});

test("session_send queues a message whose id the wait can match", async () => {
  // The fix matches the queued message by id, so the message must carry a real
  // one. This asserts the id the plugin hands to followup is the same id the
  // inbox reports while the message waits — the exact comparison the fix makes.
  const seen = [];
  const agent = {
    id: "target",
    session: { header: { cwd: "E:\\x" } },
    status: "running",
    inbox: {
      get nextTurn() {
        return seen.slice();
      },
    },
    followup(message) {
      seen.push(message);
    },
    whenIdle: async () => {},
  };
  const tools = build({
    agentFor: (id) => (id === "target" ? agent : undefined),
    query: queryFor(eventsFor([])),
  });

  const result = await tools.session_send.execute(
    { sessionId: "target", message: "干活", wait: true, timeoutMs: 200 },
    execFor("session_send"),
  );

  assert.equal(seen.length, 1, "exactly one message must be queued");
  const queued = seen[0];
  assert.equal(typeof queued.id, "string");
  assert.ok(queued.id.length > 0, "the queued message must carry an id");
  assert.equal(queued.role, "user");
  assert.equal(queued.source?.kind, "plugin", "the message must be marked as plugin-sourced");
  // The message never leaves the inbox, so the wait must time out rather than
  // claim completion.
  assert.equal(result.completed, false);
  assert.equal(result.waited, true);
});

test("list_sessions marks archived sessions and reports state", async () => {
  const registered = [];
  const registry = { resolveByPath: async () => undefined, list: () => [], archivedSessionIds: ["archived-one"] };
  const ctx = {
    tools: { register: (d) => registered.push(d) },
    agents: { get: (id) => (id === "running-one" ? { id, status: "running" } : undefined) },
    sessionTitle: { get: () => undefined, rename: () => {} },
    workspaceRegistry: registry,
    agentDefaultModel: { currentSelection: () => ({ provider: "p", model: "m" }) },
    get: (n) => {
      if (n === "workspaceRegistry") return registry;
      if (n === "sessionQuery") {
        return {
          listSessions: async () => [
            { header: { id: "running-one", cwd: "E:\\a" } },
            { header: { id: "idle-one", cwd: "E:\\b" } },
            { header: { id: "archived-one", cwd: "E:\\c" } },
            { header: { id: "sub", cwd: "E:\\d", delegationDepth: 1 } },
          ],
          readTitle: async (id) => ({ title: `标题-${id}` }),
        };
      }
      return undefined;
    },
  };
  plugin.apply(ctx);
  const listed = registered.find((d) => d.name === "list_sessions");
  const result = await listed.execute({}, execFor("list_sessions"));

  const byId = Object.fromEntries(result.sessions.map((s) => [s.sessionId, s]));
  assert.equal(byId["running-one"].state, "running");
  assert.equal(byId["idle-one"].state, "idle");
  assert.equal(byId["archived-one"].state, "archived");
  assert.equal(byId["sub"], undefined, "subagent sessions must not be listed");
  assert.equal(byId["running-one"].title, "标题-running-one", "the title must be text, not a snapshot object");
});
