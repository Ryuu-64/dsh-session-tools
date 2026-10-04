import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { realHost } from './helpers/real-host.mjs';

test('real rc.2 resume: cancelling a queued sender leaves the preceding preset mount and later sender intact', { timeout: 10000 }, async t => {
  const mounted = Promise.withResolvers(), releaseMount = Promise.withResolvers(), finishCaller = Promise.withResolvers();
  t.after(() => { releaseMount.resolve(); finishCaller.resolve(); });
  const h = await realHost(t);
  // Query is only a metadata adapter here; resume, approval, ToolRuntime and
  // JSONL storage are the real rc.2 services, including the delayed setup path.
  h.ctx.provide('sessionQuery', { listSessions: signal => h.ctx.sessionPersistence.list({ signal }) });
  const cold = await h.ctx.agents.create({
    sessionId: 'queue-target', meta: { cwd: h.root, agentPreset: 'delayed-preset' },
    agentOptions: { provider: 'fixture', model: 'scripted' },
  });
  h.model.text('saved answer');
  cold.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'save target' }] }));
  await cold.agent.whenIdle();
  await cold.dispose();

  let mounts = 0;
  h.ctx.provide('agentPresets', { async mount() { mounts++; mounted.resolve(); await releaseMount.promise; } });
  const approvals = [];
  const approvedB = Promise.withResolvers(), approvedC = Promise.withResolvers();
  h.ctx.on('approval/request', request => {
    approvals.push(request.callId);
    if (request.callId === 'B') approvedB.resolve();
    if (request.callId === 'C') approvedC.resolve();
    return 'allowed-once';
  });
  const callerStarted = Promise.withResolvers();
  h.model.scripts.push(async function* () {
    callerStarted.resolve(); await finishCaller.promise;
    yield { type: 'finish', reason: { kind: 'stop' } };
  });
  const caller = await h.createAgent('queue-caller');
  caller.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hold caller' }] }));
  await callerStarted.promise;
  h.model.text('answer A'); h.model.text('answer C');
  const aController = new AbortController(), bController = new AbortController(), cController = new AbortController();
  const run = (id, signal) => h.ctx.tools.execute({
    name: 'session_send', callId: id, agent: caller.agent, signal,
    arguments: { sessionId: 'queue-target', message: id },
  });
  const a = run('A', aController.signal);
  await mounted.promise;
  let bSettled = false;
  const b = run('B', bController.signal).finally(() => { bSettled = true; });
  await approvedB.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(approvals, ['A', 'B']);
  bController.abort();
  await new Promise(resolve => setImmediate(resolve));
  const returnedWhileAIsPending = bSettled;
  const listenersAfterCancel = getEventListeners(bController.signal, 'abort').length;
  let cSettled = false;
  const c = run('C', cController.signal).finally(() => { cSettled = true; });
  await approvedC.promise;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(approvals, ['A', 'B', 'C']);
  assert.equal(cSettled, false);
  assert.equal(mounts, 1);
  assert.equal(aController.signal.aborted, false);
  releaseMount.resolve();
  const [aResult, bResult, cResult] = await Promise.all([a, b, c]);
  const target = h.ctx.agents.get('queue-target');
  await target.whenIdle();
  finishCaller.resolve();
  await caller.agent.whenIdle();
  assert.equal(returnedWhileAIsPending, true, 'B cancellation cannot wait for A preset mount');
  assert.equal(listenersAfterCancel, 0);
  assert.equal(aResult.isError, false);
  assert.equal(cResult.isError, false);
  assert.equal(bResult.isError, true);
  assert.match(bResult.error.message, /aborted/);
  assert.equal(mounts, 1);
  assert.deepEqual(target.session.snapshotEvents()
    .filter(event => event.type === 'user/message' && event.data.source?.kind === 'tool-session')
    .map(event => event.data.content[0].text), ['A', 'C']);
  assert.equal(getEventListeners(cController.signal, 'abort').length, 0);
});
