import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getEventListeners } from 'node:events';
import { apply } from '../lib/index.js';

function fixture({ cold = false, query: suppliedQuery, persistence } = {}) {
  const tools = {};
  const delivered = [];
  let disposed = 0;
  const target = {
    id: 'target', status: 'idle', inbox: { nextTurn: delivered },
    session: { header: { id: 'target', cwd: '/fixture' }, snapshotEvents: () => [] },
    followup(message) { delivered.push(message); this.status = 'running'; },
    whenIdle() { return this.status === 'idle' ? Promise.resolve() : new Promise(() => {}); },
    cancel() { throw new Error('must not cancel target'); },
  };
  const query = suppliedQuery ?? { listSessions: async () => [{ header: target.session.header }], readSession: async () => ({ events: [] }) };
  apply({
    tools: { register: d => { tools[d.name] = d; } },
    agents: { get: () => cold ? undefined : target, create: async () => ({ agent: target, dispose: async () => { disposed++; } }) },
    workspaceRegistry: { list: () => [] }, sessionTitle: { get: () => undefined },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    get: name => ({ sessionQuery: query, sessionPersistence: persistence, sandboxPolicy: { resolve: () => ({ mode: 'danger-full-access' }) }, approval: { overrideOf: () => 'never', request: async () => 'allowed-once' } })[name],
  });
  const controller = new AbortController();
  const exec = { name: 'fixture', callId: 'call', signal: controller.signal, agent: { id: 'caller', session: { header: { id: 'caller', cwd: '/fixture' } } } };
  return { tools, target, delivered, controller, exec, disposed: () => disposed };
}

test('idle wait releases its timer immediately', async () => {
  const f = fixture();
  const original = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (...args) => { const timer = original(...args); timers.push(timer); return timer; };
  try {
    const result = await f.tools.session_wait.execute({ sessionId: 'target', timeoutMs: 60_000 }, f.exec);
    assert.equal(result.completed, true);
    assert.equal(timers.filter(t => !t._destroyed).length, 0, 'no active timeout after completion');
    assert.equal(getEventListeners(f.exec.signal, 'abort').length, 0);
  } finally { globalThis.setTimeout = original; timers.forEach(clearTimeout); }
});

for (const name of ['session_create', 'session_send', 'session_wait']) {
  test(`${name} cancellation ends only the wait and removes listeners`, async () => {
    const f = fixture();
    if (name === 'session_wait') f.target.status = 'running';
    const args = { sessionId: 'target', prompt: 'synthetic', message: 'synthetic', wait: true, timeoutMs: 150 };
    const started = Date.now();
    const timer = setTimeout(() => f.controller.abort(), 10);
    try {
      const result = await f.tools[name].execute(args, f.exec);
      assert.equal(result.waitStatus, 'callerCancelled');
      assert.equal(result.completed, false);
      assert.ok(Date.now() - started < 120);
      assert.ok(result.sessionId);
      assert.equal(f.target.status, 'running');
      assert.equal(f.disposed(), 0);
      assert.equal(getEventListeners(f.exec.signal, 'abort').length, 0);
    } finally { clearTimeout(timer); }
  });
  test(`${name} timeout preserves target and receipt`, async () => {
    const f = fixture();
    if (name === 'session_wait') f.target.status = 'running';
    const result = await f.tools[name].execute({ sessionId: 'target', prompt: 'synthetic', message: 'synthetic', wait: true, timeoutMs: 15 }, f.exec);
    assert.equal(result.waitStatus, 'timedOut');
    assert.equal(result.completed, false);
    assert.ok(result.sessionId);
    assert.equal(f.disposed(), 0);
    assert.equal(f.target.status, 'running');
    assert.equal(getEventListeners(f.exec.signal, 'abort').length, 0);
  });
}

for (const outcome of ['complete', 'error', 'cancel', 'timeout']) {
  test(`cold read ${outcome} forwards cancellation and closes exactly once`, async () => {
    let closed = 0;
    let openSignal, readSignal;
    const f = fixture({ cold: true, persistence: {
      async open(id, access, { signal }) {
        assert.equal(id, 'target'); assert.equal(access, 'read'); openSignal = signal;
        return {
          async read(offset, length, { signal }) {
            readSignal = signal;
            if (outcome === 'complete') return { events: [] };
            if (outcome === 'error') throw new Error('synthetic read failure');
            if (outcome === 'cancel') queueMicrotask(() => f.controller.abort());
            return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
          },
          async close() { closed++; },
        };
      },
    } });
    const operation = f.tools.session_wait.execute({ sessionId: 'target', timeoutMs: 20 }, f.exec);
    if (outcome === 'error') await assert.rejects(operation, /synthetic read failure/);
    else {
      const result = await operation;
      assert.equal(result.waitStatus, { complete: 'completed', cancel: 'callerCancelled', timeout: 'timedOut' }[outcome]);
    }
    assert.equal(closed, 1);
    assert.equal(openSignal, readSignal);
    assert.equal(readSignal.aborted, true);
    assert.equal(getEventListeners(f.exec.signal, 'abort').length, 0);
  });
}

test('cold listing observes caller cancellation before starting a read', async () => {
  let observed, reads = 0;
  const f = fixture({ cold: true, query: {
    async listSessions(signal) {
      observed = signal;
      queueMicrotask(() => f.controller.abort());
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
    async readSession() { reads++; return { events: [] }; },
  } });
  const result = await f.tools.session_wait.execute({ sessionId: 'target' }, f.exec);
  assert.equal(result.waitStatus, 'callerCancelled');
  assert.equal(observed.aborted, true);
  assert.equal(reads, 0);
});

for (const [requested, expected] of [[undefined, 60000], [-1, 60000], [0, 60000], [900000, 300000], [0.2, 1]]) {
  test(`wait budget ${requested} becomes ${expected}`, async () => {
    const f = fixture();
    const original = globalThis.setTimeout;
    const budgets = [];
    globalThis.setTimeout = (fn, ms, ...args) => { budgets.push(ms); return original(fn, ms, ...args); };
    try {
      await f.tools.session_wait.execute({ sessionId: 'target', ...(requested === undefined ? {} : { timeoutMs: requested }) }, f.exec);
      assert.equal(budgets[0], expected);
    } finally { globalThis.setTimeout = original; }
  });
}

// Exercise the registered defineTool wrapper, not waitBudgetMs or a raw body:
// malformed JSON values are rejected before the plugin can choose a default.
for (const name of ['session_create', 'session_send', 'session_wait']) {
  for (const [label, value] of [['string', '60000'], ['null', null], ['object', {}], ['array', []], ['boolean', true], ['NaN', NaN], ['Infinity', Infinity], ['negative Infinity', -Infinity]]) {
    test(`${name} rejects ${label} timeout at the real defineTool boundary`, async () => {
      const f = fixture();
      let observed = 0;
      f.target.whenIdle = async () => { observed++; };
      const args = { sessionId: 'target', prompt: 'synthetic', message: 'synthetic', wait: true, timeoutMs: value };
      // Each tool gets only its own declared parameters, so timeoutMs is the
      // sole invalid argument and the assertion cannot pass for another reason.
      if (name === 'session_create') { delete args.sessionId; delete args.message; }
      if (name === 'session_send') delete args.prompt;
      if (name === 'session_wait') { delete args.prompt; delete args.message; delete args.wait; }
      await assert.rejects(f.tools[name].execute(args, f.exec), error => {
        assert.equal(error.code, 'INVALID_ARGS');
        assert.match(error.message, /timeoutMs/);
        return true;
      });
      assert.equal(f.delivered.length, 0);
      assert.equal(observed, 0);
      assert.equal(getEventListeners(f.exec.signal, 'abort').length, 0);
    });
  }
}

test('wait error clears timer and abort listener without disposing target', async () => {
  const f = fixture();
  f.target.whenIdle = async () => { throw new Error('synthetic driver failure'); };
  await assert.rejects(f.tools.session_wait.execute({ sessionId: 'target' }, f.exec), /synthetic driver failure/);
  assert.equal(getEventListeners(f.exec.signal, 'abort').length, 0);
  assert.equal(f.disposed(), 0);
});

test('a completed default-budget wait does not keep a child process alive', async () => {
  const program = `
    import { apply } from ${JSON.stringify(new URL('../lib/index.js', import.meta.url).href)};
    let wait;
    const target = { status: 'idle', whenIdle: async () => {}, session: { snapshotEvents: () => [] } };
    apply({ tools: { register: d => { if (d.name === 'session_wait') wait = d; } }, agents: { get: () => target } });
    await wait.execute({ sessionId: 'target' }, { agent: { id: 'caller' }, signal: new AbortController().signal });
  `;
  const result = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', program], { timeout: 5000 });
  assert.equal(result.stderr, '');
});

test('timeout receipt can be used for a later result without redelivery', async () => {
  const f = fixture();
  const first = await f.tools.session_send.execute({ sessionId: 'target', message: 'synthetic', wait: true, timeoutMs: 5 }, f.exec);
  assert.equal(first.waitStatus, 'timedOut');
  f.target.status = 'idle';
  f.target.session.snapshotEvents = () => [{ type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'later result' }] } } }];
  const later = await f.tools.session_wait.execute({ sessionId: first.sessionId }, f.exec);
  assert.equal(later.output, 'later result');
  assert.equal(f.delivered.length, 1);
});

test('already cancelled cold wait performs no query or read', async () => {
  let calls = 0;
  const f = fixture({ cold: true, query: { listSessions: async () => { calls++; return []; } } });
  f.controller.abort();
  const result = await f.tools.session_wait.execute({ sessionId: 'target' }, f.exec);
  assert.equal(result.waitStatus, 'callerCancelled');
  assert.equal(calls, 0);
});

test('create observation failure never rolls back an already delivered session', async () => {
  const f = fixture();
  f.target.whenIdle = async () => { throw new Error('observation failed'); };
  await assert.rejects(f.tools.session_create.execute({ prompt: 'synthetic', wait: true }, f.exec), /observation failed/);
  assert.equal(f.delivered.length, 1);
  assert.equal(f.disposed(), 0);
  assert.equal(getEventListeners(f.exec.signal, 'abort').length, 0);
});

test('a late read-only open after cancellation is closed without reading', async () => {
  const opened = Promise.withResolvers();
  const wasOpened = Promise.withResolvers();
  const closed = Promise.withResolvers();
  let reads = 0;
  const f = fixture({ cold: true, persistence: { open: async () => { wasOpened.resolve(); return opened.promise; } } });
  const pending = f.tools.session_wait.execute({ sessionId: 'target' }, f.exec);
  await wasOpened.promise;
  f.controller.abort();
  assert.equal((await pending).waitStatus, 'callerCancelled');
  opened.resolve({ read: async () => { reads++; return { events: [] }; }, close: async () => closed.resolve() });
  await closed.promise;
  assert.equal(reads, 0);
});
