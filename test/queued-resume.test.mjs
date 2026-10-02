import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { apply } from '../lib/index.js';

const nextTick = () => new Promise(resolve => setImmediate(resolve));

function queuedHost({ firstFails = false } = {}) {
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  const messages = [], approvals = [];
  const header = { id: 'target', cwd: '/workspace' };
  let live, resumes = 0, send;
  const target = { id: 'target', session: { header }, followup: message => messages.push(message.content[0].text) };
  const services = {
    sessionQuery: { listSessions: async () => [{ header }] },
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
    approval: { overrideOf: () => 'ask', async request({ callId }) { approvals.push(callId); return 'allowed-once'; } },
  };
  apply({
    tools: { register(tool) { if (tool.name === 'session_send') send = tool; } },
    agents: {
      get: () => live,
      async resume({ signal }) {
        if (++resumes === 1) {
          started.resolve(signal);
          await release.promise;
          if (firstFails) throw new Error('first resume failed');
        }
        live = target;
        return { agent: target };
      },
    },
    agentDefaultModel: { currentSelection: () => ({ provider: 'fixture', model: 'scripted' }) },
    get: name => services[name],
  });
  return {
    started, release, messages, approvals, get resumes() { return resumes; },
    run(message, signal) {
      return send.execute({ sessionId: 'target', message }, {
        name: 'session_send', callId: message, signal,
        agent: { id: 'caller', session: { header: { id: 'caller', cwd: '/workspace' } } },
      });
    },
  };
}

for (const firstFails of [false, true]) {
  test(`queued cancellation returns before prior resume ${firstFails ? 'fails' : 'completes'} without releasing its lock`, async t => {
    const h = queuedHost({ firstFails });
    t.after(() => h.release.resolve());
    const aController = new AbortController(), bController = new AbortController(), cController = new AbortController();
    const a = h.run('A', aController.signal).then(() => 'sent', error => error.message);
    assert.equal(await h.started.promise, aController.signal);
    let bSettled = false;
    const b = h.run('B', bController.signal).then(() => 'sent', error => error).finally(() => { bSettled = true; });
    await nextTick();
    assert.deepEqual(h.approvals, ['A', 'B']);
    bController.abort();
    await nextTick();
    const returnedWhileAIsPending = bSettled;
    const bListenersWhileAIsPending = getEventListeners(bController.signal, 'abort').length;
    let cSettled = false;
    const c = h.run('C', cController.signal).finally(() => { cSettled = true; });
    await nextTick();
    assert.deepEqual(h.approvals, ['A', 'B', 'C']);
    assert.equal(h.resumes, 1, 'C cannot overtake A through the cancelled B queue slot');
    assert.equal(cSettled, false);
    assert.deepEqual(h.messages, []);
    assert.equal(aController.signal.aborted, false);
    h.release.resolve();
    const [aResult, bResult] = await Promise.all([a, b, c]);
    assert.equal(returnedWhileAIsPending, true, 'B must return before A is released');
    assert.equal(bListenersWhileAIsPending, 0, 'B must release its abort listener promptly');
    assert.equal(bResult, bController.signal.reason);
    assert.equal(aResult, firstFails ? 'first resume failed' : 'sent');
    assert.equal(h.resumes, firstFails ? 2 : 1);
    assert.deepEqual(h.messages, firstFails ? ['C'] : ['A', 'C']);
    assert.equal(getEventListeners(cController.signal, 'abort').length, 0);
  });
}

test('normally completed queued send removes its abort listener and sends once', async t => {
  const h = queuedHost();
  t.after(() => h.release.resolve());
  const a = h.run('A', new AbortController().signal);
  await h.started.promise;
  const controller = new AbortController();
  const b = h.run('B', controller.signal);
  await nextTick();
  h.release.resolve();
  await Promise.all([a, b]);
  assert.deepEqual(h.messages, ['A', 'B']);
  assert.equal(h.resumes, 1);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});
