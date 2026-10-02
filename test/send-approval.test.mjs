import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

function fixture({ outcome = 'allowed-once', policy = 'ask', mode = 'workspace-write', missing, header = {}, approve, resume } = {}) {
  const timeline = [];
  const calls = { resume: 0, create: 0, messages: [], requests: [] };
  let record = { header: { id: 'target', cwd: '/workspace', ...header } };
  let live;
  const controller = new AbortController();
  const caller = { id: 'caller', session: { header: { id: 'caller', cwd: '/workspace' } } };
  const target = { id: 'target', session: record, followup(message) { timeline.push('followup'); calls.messages.push(message); } };
  const services = {
    sandboxPolicy: { resolve: () => ({ mode }) },
    approval: {
      overrideOf: () => policy,
      config: { policy: 'ask' },
      async request(req) {
        timeline.push('approval'); calls.requests.push(req);
        return approve ? approve(req, state) : outcome;
      },
    },
    sessionQuery: {
      async listSessions(signal) {
        timeline.push('read'); assert.equal(signal, controller.signal);
        return record ? [record] : [];
      },
    },
  };
  delete services[missing];
  const agents = {
    get: () => live,
    async create() { calls.create++; throw new Error('unexpected create'); },
    async resume(options) {
      timeline.push('resume'); calls.resume++;
      assert.equal(options.signal, controller.signal);
      if (resume) await resume(options, state);
      live = target;
      return { agent: target };
    },
  };
  const tools = {};
  const ctx = {
    tools: { register(tool) { tools[tool.name] = tool; } }, agents,
    sessionTitle: { get() {}, rename() {} },
    workspaceRegistry: { list: () => [] },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    get: name => services[name],
  };
  apply(ctx);
  const state = {
    calls, timeline, controller, target, services,
    get live() { return live; }, set live(value) { live = value; },
    get record() { return record; }, set record(value) { record = value; },
    run(message = 'hello', sessionId = 'target') {
      return tools.session_send.execute({ sessionId, message }, { agent: caller, name: 'session_send', callId: message, signal: controller.signal });
    },
    registerAgain() { apply(ctx); },
  };
  return state;
}

for (const outcome of ['rejected', 'cancelled', 'unavailable']) {
  test(`closed target: ${outcome} leaves target closed and untouched`, async () => {
    const h = fixture({ outcome });
    await assert.rejects(h.run());
    assert.deepEqual(h.timeline, ['read', 'approval']);
    assert.equal(h.live, undefined);
    assert.equal(h.calls.create + h.calls.resume + h.calls.messages.length, 0);
  });
}
for (const missing of ['approval', 'sandboxPolicy']) {
  test(`closed target: missing ${missing} has no write side effects`, async () => {
    const h = fixture({ missing });
    await assert.rejects(h.run(), /cannot establish permission/);
    assert.equal(h.live, undefined);
    assert.equal(h.calls.create + h.calls.resume + h.calls.messages.length, 0);
  });
}
test('closed target: workspace-write + never requests and is rejected without resume', async () => {
  const h = fixture({ policy: 'never', outcome: 'rejected' });
  await assert.rejects(h.run(), /declined/);
  assert.deepEqual(h.timeline, ['read', 'approval']);
  assert.equal(h.live, undefined);
});
test('closed target: allowed request rechecks before resume and sends once', async () => {
  const h = fixture();
  await h.run();
  assert.deepEqual(h.timeline, ['read', 'approval', 'read', 'resume', 'followup']);
  assert.equal(h.calls.resume, 1);
  assert.equal(h.calls.messages.length, 1);
});
test('closed target: explicit full access bypasses prompt and sends once', async () => {
  const h = fixture({ policy: 'never', mode: 'danger-full-access' });
  await h.run();
  assert.deepEqual(h.timeline, ['read', 'read', 'resume', 'followup']);
});
test('closed target: already cancelled never queries, resumes or sends', async () => {
  const h = fixture(); h.controller.abort();
  await assert.rejects(h.run(), /aborted/);
  assert.deepEqual(h.timeline, []);
});
test('closed target: cancellation while approval is pending rejects a late grant', async () => {
  const h = fixture({ approve: async (_, state) => { state.controller.abort(); await Promise.resolve(); return 'allowed-once'; } });
  await assert.rejects(h.run(), /cancelled/);
  assert.deepEqual(h.timeline, ['read', 'approval']);
  assert.equal(h.live, undefined);
});
for (const header of [{ delegationDepth: 1 }, { cwd: undefined }, { cwd: '' }]) {
  test(`closed target: invalid metadata is rejected before approval ${JSON.stringify(header)}`, async () => {
    const h = fixture({ header });
    await assert.rejects(h.run());
    assert.deepEqual(h.timeline, ['read']);
    assert.equal(h.calls.resume, 0);
  });
}
test('closed self target is rejected without a query or approval', async () => {
  const h = fixture();
  await assert.rejects(h.run('hello', 'caller'), /own session/);
  assert.deepEqual(h.timeline, []);
});
for (const change of ['deleted', 'subagent', 'missing cwd', 'live subagent']) {
  test(`target is revalidated after approval: ${change}`, async () => {
    const h = fixture({ approve: async (_, state) => {
      if (change === 'deleted') state.record = undefined;
      if (change === 'subagent') state.record.header.delegationDepth = 1;
      if (change === 'missing cwd') state.record.header.cwd = undefined;
      if (change === 'live subagent') state.live = { ...state.target, session: { header: { cwd: '/workspace', delegationDepth: 1 } } };
      return 'allowed-once';
    } });
    await assert.rejects(h.run());
    assert.equal(h.calls.resume + h.calls.create + h.calls.messages.length, 0);
  });
}
test('target opened during approval is reused without resume', async () => {
  const h = fixture({ approve: async (_, state) => { state.live = state.target; return 'allowed-once'; } });
  await h.run();
  assert.equal(h.calls.resume, 0);
  assert.equal(h.calls.messages.length, 1);
});
test('two approved sends serialize the cold resume and each deliver exactly once', async () => {
  let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const h = fixture({ resume: async () => { await barrier; } });
  const a = h.run('A');
  h.registerAgain(); // another registration still shares the same service lock
  const b = h.run('B');
  // Let both callers finish approval while the first resume remains pending.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.requests.length, 2);
  assert.equal(h.calls.resume, 1);
  release();
  await Promise.all([a, b]);
  assert.equal(h.calls.resume, 1);
  assert.deepEqual(h.calls.messages.map(m => m.content[0].text).sort(), ['A', 'B']);
});
test('failed resume releases the queue for a later approved sender', async () => {
  let attempts = 0;
  const h = fixture({ resume: async () => { if (++attempts === 1) throw new Error('resume failed'); } });
  const [a, b] = await Promise.allSettled([h.run('A'), h.run('B')]);
  assert.equal(a.status, 'rejected');
  assert.equal(b.status, 'fulfilled');
  assert.equal(h.calls.resume, 2);
  assert.deepEqual(h.calls.messages.map(m => m.content[0].text), ['B']);
});
test('cancellation during authorized resume prevents message delivery', async () => {
  const h = fixture({ resume: async (_, state) => { state.controller.abort(); } });
  await assert.rejects(h.run(), /aborted/);
  assert.equal(h.calls.messages.length, 0);
});
