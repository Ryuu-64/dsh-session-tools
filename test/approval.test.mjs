import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';

// Only public rc.2 service contracts are exposed. A private effectivePolicy
// call would fail, rather than silently being supported by this fixture.
function host({ mode = 'workspace-write', policy = 'ask', configured = 'ask', outcome = 'allowed-once', missing, request } = {}) {
  const calls = { create: 0, resume: 0, followup: 0, request: [] };
  const session = { header: { id: 'caller', cwd: '/workspace' } };
  const controller = new AbortController();
  const target = { id: 'target', session: { header: { id: 'target', cwd: '/workspace' } }, followup() { calls.followup++; } };
  const approval = {
    config: { policy: configured },
    overrideOf(value) { assert.equal(value, session); return policy; },
    async request(req) { calls.request.push(req); return request ? request(req, controller) : outcome; },
  };
  const services = {
    approval,
    sandboxPolicy: { resolve(value) { assert.equal(value.session, session); return { mode }; } },
  };
  delete services[missing];
  const tools = {};
  apply({
    tools: { register(tool) { tools[tool.name] = tool; } },
    agents: {
      get: () => target,
      async create() { calls.create++; return { agent: target }; },
      async resume() { calls.resume++; return { agent: target }; },
    },
    sessionTitle: { get: () => undefined, rename() {} },
    workspaceRegistry: { list: () => [], resolveByPath: async () => undefined },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    get: name => services[name],
  });
  return {
    calls, controller,
    run(name) {
      return tools[name].execute(name === 'session_create' ? { prompt: 'hello' } : { sessionId: 'target', message: 'hello' }, {
        agent: { id: 'caller', session }, name, callId: 'call-1', signal: controller.signal,
      });
    },
  };
}

for (const name of ['session_create', 'session_send']) {
  for (const mode of ['read-only', 'workspace-write', 'danger-full-access']) {
    for (const policy of ['ask', 'never']) {
      test(`${name}: ${mode} + ${policy}`, async () => {
        // The official host deterministically rejects requests under never.
        const h = host({ mode, policy, outcome: policy === 'never' ? 'rejected' : 'allowed-once' });
        const bypass = mode === 'danger-full-access' && policy === 'never';
        if (policy === 'ask' || bypass) {
          await h.run(name);
          assert.equal(h.calls.followup, 1);
          assert.equal(h.calls.create, name === 'session_create' ? 1 : 0);
        } else {
          await assert.rejects(h.run(name), /declined/);
          assert.equal(h.calls.followup + h.calls.create + h.calls.resume, 0);
        }
        assert.equal(h.calls.request.length, bypass ? 0 : 1);
        if (!bypass) {
          assert.equal(h.calls.request[0].signal, h.controller.signal);
          assert.equal(h.calls.request[0].toolName, name);
          assert.equal(h.calls.request[0].callId, 'call-1');
        }
      });
    }
  }
  for (const outcome of ['rejected', 'cancelled', 'unavailable', undefined, 'allowed', { allowed: true }]) {
    test(`${name}: fail closed on ${JSON.stringify(outcome)}`, async () => {
      const h = host({ request: async () => outcome });
      await assert.rejects(h.run(name));
      assert.equal(h.calls.followup + h.calls.create + h.calls.resume, 0);
    });
  }
  for (const missing of ['approval', 'sandboxPolicy']) {
    test(`${name}: missing ${missing} fails closed even in full access`, async () => {
      const h = host({ missing, mode: 'danger-full-access', policy: 'never' });
      await assert.rejects(h.run(name), /cannot establish permission/);
      assert.equal(h.calls.followup + h.calls.create + h.calls.resume, 0);
    });
  }
  for (const settings of [{ mode: 'unknown' }, { policy: 'unknown' }]) {
    test(`${name}: unknown permission ${JSON.stringify(settings)} fails closed`, async () => {
      const h = host(settings);
      await assert.rejects(h.run(name), /cannot establish permission/);
      assert.equal(h.calls.followup + h.calls.create + h.calls.resume, 0);
    });
  }
  test(`${name}: session override takes precedence over configured never`, async () => {
    const h = host({ mode: 'danger-full-access', configured: 'never', policy: 'ask' });
    await h.run(name);
    assert.equal(h.calls.request.length, 1);
  });
  test(`${name}: already cancelled full-access execution does not write`, async () => {
    const h = host({ mode: 'danger-full-access', policy: 'never' });
    h.controller.abort();
    await assert.rejects(h.run(name), /cancelled|aborted/);
    assert.equal(h.calls.request.length, 0);
    assert.equal(h.calls.followup + h.calls.create + h.calls.resume, 0);
  });
  test(`${name}: late allowance after cancellation does not write`, async () => {
    const h = host({ request: async (_, controller) => { controller.abort(); return 'allowed-once'; } });
    await assert.rejects(h.run(name), /cancelled|aborted/);
    assert.equal(h.calls.followup + h.calls.create + h.calls.resume, 0);
  });
  test(`${name}: throwing approval service does not write`, async () => {
    const h = host({ request: async () => { throw new Error('service failed'); } });
    await assert.rejects(h.run(name), /service failed/);
    assert.equal(h.calls.followup + h.calls.create + h.calls.resume, 0);
  });
}
