import { toolResult } from './helpers/session-card.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { receiptHost, gate, textChunks, user } from './helpers/message-receipts-host.mjs';
import { receiptProjectionKey, foldReceipts, messageReceipt } from '../lib/message-receipts.js';

const wait = (h, receipt, exec = {}) => h.ctx.tools.get('session_wait').execute({ sessionId: receipt.sessionId, messageId: receipt.messageId, timeoutMs: 1000 }, exec);
const send = (h, exec, args = {}) => h.ctx.tools.get('session_send').execute({ sessionId: 'target', message: 'A', wait: true, timeoutMs: 1000, ...args }, exec);

test('real public claims agree with durable A/B receipts, checkpoint and fresh-host replay', { timeout: 15000 }, async t => {
  let h = await receiptHost(t);
  const caller = await h.holdCaller();
  const target = await h.create('target');
  const notifications = [];
  h.ctx.on('agent/inbox/claimed', p => notifications.push({ type: 'claimed', id: p.message.id, turn: p.turn }));
  h.ctx.on('agent/inbox/discarded', p => notifications.push({ type: 'discarded', id: p.message.id }));
  h.model.text('answer A'); h.model.text('answer B');
  const [a, b] = await Promise.all([send(h, caller.exec), send(h, caller.exec, { message: 'B' })]);
  assert.equal(a.output, 'answer A'); assert.equal(b.output, 'answer B');
  assert.equal(a.messageStatus, 'turnCompleted'); assert.equal(b.messageStatus, 'turnCompleted');
  assert.notEqual(a.turn, b.turn); assert.notEqual(a.messageId, b.messageId);
  for (const r of [a, b]) assert.ok(notifications.some(n => n.type === 'claimed' && n.id === r.messageId && n.turn === r.turn));
  const checkpointFile = join(h.root, 'receipt-checkpoint.json');
  await writeFile(checkpointFile, JSON.stringify(h.ctx.sessionProjections.checkpoint(target.agent.session)));
  const checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'));
  assert.ok(checkpoint[receiptProjectionKey]);
  await h.ctx.sessionPersistence.flush();
  const stored = await h.read('target');
  const restored = h.ctx.sessionProjections.restore(checkpoint, stored.events, 0, stored.header, stored.inheritedEventCount);
  assert.deepEqual(restored.checkpoint[receiptProjectionKey], checkpoint[receiptProjectionKey]);
  assert.equal(messageReceipt(restored.checkpoint[receiptProjectionKey].val, a.messageId, stored.events).output, 'answer A');
  caller.release(); await caller.caller.agent.whenIdle();
  h = await h.restart();
  assert.equal(h.ctx.agents.get('target'), undefined);
  const freshStored = await h.read('target');
  const freshCheckpoint = h.ctx.sessionProjections.restore(JSON.parse(await readFile(checkpointFile, 'utf8')), freshStored.events, 0, freshStored.header, freshStored.inheritedEventCount);
  assert.equal(messageReceipt(freshCheckpoint.checkpoint[receiptProjectionKey].val, a.messageId, freshStored.events).output, 'answer A');
  assert.equal((await wait(h, a)).output, 'answer A');
  assert.equal((await wait(h, b)).output, 'answer B');
  assert.equal(h.ctx.agents.get('target'), undefined, 'receipt cold read never resumes a target');
  const resumed = await h.ctx.agents.resume({ resumeSessionId: 'target', agentOptions: { provider: 'fixture', model: 'scripted' } });
  h.model.text('answer C'); resumed.agent.followup(user('C')); await resumed.agent.whenIdle();
  assert.equal((await wait(h, a)).output, 'answer A');
  assert.equal((await wait(h, b)).output, 'answer B');
});

test('real queued message cancellation is discarded after restart, never previous output', { timeout: 15000 }, async t => {
  let h = await receiptHost(t); const caller = await h.holdCaller(); const target = await h.create('target');
  const entered = Promise.withResolvers(), hold = gate(); t.after(hold.release);
  h.model.scripts.push(async function* (options) { entered.resolve(); await hold.wait(options.signal); yield* textChunks('previous answer'); });
  target.agent.followup(user('hold previous turn')); await entered.promise;
  const receipt = await send(h, caller.exec, { wait: false });
  const discarded = []; h.ctx.on('agent/inbox/discarded', p => discarded.push(p.message.id));
  target.agent.cancel({ kind: 'user' }); await target.agent.whenIdle();
  const result = await wait(h, receipt); assert.equal(result.messageStatus, 'discarded'); assert.equal(result.output, undefined); assert.equal(result.completed, false);
  assert.ok(discarded.includes(receipt.messageId));
  caller.release(); await caller.caller.agent.whenIdle(); h = await h.restart();
  assert.equal((await wait(h, receipt)).messageStatus, 'discarded');
});

for (const scenario of ['cancelled', 'failed', 'blocked', 'rewritten', 'empty']) {
  test(`real claimed message ${scenario} returns its actual terminal result`, { timeout: 15000 }, async t => {
    let h = await receiptHost(t); const caller = await h.holdCaller(); const target = await h.create('target');
    let entered;
    if (scenario === 'cancelled') {
      entered = Promise.withResolvers(); const hold = gate(); t.after(hold.release);
      h.model.scripts.push(async function* (options) { entered.resolve(); await hold.wait(options.signal); yield* textChunks('cancelled prefix'); });
    } else if (scenario === 'failed') h.model.scripts.push(async function* () { throw new Error('fixture model failure'); });
    else if (scenario === 'blocked' || scenario === 'rewritten') h.ctx.on('agent/pre-step', async (p, next) => {
      if (p.agent.id !== 'target') return next();
      return scenario === 'blocked' ? { kind: 'reject' } : { kind: 'enter', messages: [] };
    });
    else h.model.scripts.push(async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; });
    const pending = send(h, caller.exec);
    if (scenario === 'cancelled') { await entered.promise; target.agent.cancel({ kind: 'user' }); }
    const result = await pending;
    const expected = { cancelled: 'cancelled', failed: 'failed', blocked: 'blocked', rewritten: 'unknown', empty: 'turnCompleted' }[scenario];
    assert.equal(result.messageStatus, expected);
    assert.equal(result.completed, scenario === 'empty');
    assert.equal(result.output, undefined);
    assert.ok(result.messageId); assert.ok(result.turn);
    caller.release(); await caller.caller.agent.whenIdle(); h = await h.restart();
    const cold = await wait(h, result);
    assert.equal(cold.messageStatus, expected); assert.equal(cold.completed, scenario === 'empty'); assert.equal(cold.output, undefined);
  });
}

test('real timeout and caller cancellation retain the same receipt and never redeliver or stop target', { timeout: 15000 }, async t => {
  const h = await receiptHost(t); const caller = await h.holdCaller(); const target = await h.create('target');
  const entered = Promise.withResolvers(), hold = gate(); t.after(hold.release);
  h.model.scripts.push(async function* (options) { entered.resolve(); await hold.wait(options.signal); yield* textChunks('eventual A'); });
  const pending = send(h, caller.exec, { timeoutMs: 15 }); await entered.promise;
  const receipt = await pending; assert.equal(receipt.waitStatus, 'timedOut'); assert.equal(receipt.completed, false); assert.equal(receipt.output, undefined); assert.equal(receipt.messageStatus, 'delivered');
  const controller = new AbortController();
  const again = wait(h, receipt, { ...caller.exec, signal: controller.signal }); controller.abort();
  assert.equal((await again).waitStatus, 'callerCancelled'); assert.equal(target.agent.status, 'running');
  hold.release(); await target.agent.whenIdle();
  const done = await wait(h, receipt); assert.equal(done.output, 'eventual A'); assert.equal(done.completed, true);
  assert.equal(target.agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.id === receipt.messageId).length, 1);
});

test('real next-step input and followup can share a turn without stealing another turn result', { timeout: 15000 }, async t => {
  const h = await receiptHost(t); const caller = await h.holdCaller(); const target = await h.create('target');
  const extra = user('injected context'); target.agent.inbox.append('next-step', extra);
  h.model.text('shared response'); const receipt = await send(h, caller.exec);
  const extraResult = await wait(h, { sessionId: 'target', messageId: extra.id });
  assert.equal(extraResult.turn, receipt.turn); assert.equal(extraResult.output, 'shared response');
  assert.equal(receipt.output, 'shared response');
  const projected = foldReceipts(target.agent.session.snapshotEvents());
  assert.equal(projected.messages[extra.id].admitted, true);
});

test('real ToolRuntime persists send receipt identity in JSONL presentation metadata', { timeout: 15000 }, async t => {
  const h = await receiptHost(t); const target = await h.create('target');
  h.model.tool('session_send', { sessionId: 'target', message: 'A', wait: true }); h.model.text('answer A'); h.model.text('caller done');
  const caller = await h.create('caller'); caller.agent.followup(user('exercise send'));
  await caller.agent.whenIdle(); await target.agent.whenIdle(); await h.ctx.sessionPersistence.flush();
  const stored = await h.read('caller'); const result = stored.events.find(e => e.type === 'tool/result');
  assert.notEqual(toolResult(result).isError, true);
  assert.equal(result.data.meta.sessionId, 'target'); assert.ok(result.data.meta.messageId);
  assert.match(JSON.stringify(result.data.message.content), new RegExp(result.data.meta.messageId));
  assert.equal((await wait(h, result.data.meta)).output, 'answer A');
});

test('a persisted crash-open turn stays unfinished on cold read and becomes interrupted only after official resume repair', { timeout: 15000 }, async t => {
  const h = await receiptHost(t); const caller = await h.holdCaller(); const target = await h.create('target');
  const entered = Promise.withResolvers(), hold = gate(); t.after(hold.release);
  h.model.scripts.push(async function* (options) { entered.resolve(); await hold.wait(options.signal); yield* textChunks('later source result'); });
  const receipt = await send(h, caller.exec, { wait: false }); await entered.promise;
  // Persist the exact valid prefix captured before turn/end to model a process
  // dying there. No forged assistant text or fabricated message/turn mapping.
  const writer = await h.ctx.sessionPersistence.create({ ...target.agent.session.header, id: 'crash-target' });
  await writer.append(target.agent.session.snapshotEvents()); await writer.flush(); await writer.close();
  const crashReceipt = { sessionId: 'crash-target', messageId: receipt.messageId };
  const cold = await wait(h, crashReceipt);
  assert.equal(cold.messageStatus, 'delivered'); assert.equal(cold.completed, false); assert.equal(cold.output, undefined);
  assert.equal(h.ctx.agents.get('crash-target'), undefined);
  const resumed = await h.ctx.agents.resume({ resumeSessionId: 'crash-target', agentOptions: { provider: 'fixture', model: 'scripted' } });
  const repaired = await wait(h, crashReceipt);
  assert.equal(repaired.messageStatus, 'interrupted'); assert.equal(repaired.turnEndKind, 'interrupted'); assert.equal(repaired.completed, false);
  assert.equal(resumed.agent.session.snapshotEvents().findLast(e => e.type === 'turn/end').data.reason.kind, 'interrupted');
  hold.release(); await target.agent.whenIdle();
});

test('real creation returns the first-message receipt, and later turns cannot replace it', { timeout: 15000 }, async t => {
  const h = await receiptHost(t); const caller = await h.holdCaller();
  h.model.text('first result');
  const created = await h.ctx.tools.get('session_create').execute({ prompt: 'first task', wait: true, timeoutMs: 1000 }, caller.exec);
  assert.equal(created.messageStatus, 'turnCompleted'); assert.equal(created.output, 'first result'); assert.ok(created.messageId);
  const target = h.ctx.agents.get(created.sessionId);
  assert.equal(target.session.snapshotEvents().find(e => e.type === 'user/message').data.id, created.messageId);
  h.model.text('later result'); target.followup(user('later task')); await target.whenIdle();
  assert.equal((await wait(h, created)).output, 'first result');
});

test('real cancellation after claim but before request admission is not completed', { timeout: 15000 }, async t => {
  const h = await receiptHost(t); const caller = await h.holdCaller(); const target = await h.create('target');
  const entered = Promise.withResolvers(), hold = gate(); t.after(hold.release);
  h.ctx.on('agent/request', async (p, next) => {
    if (p.agent.id === 'target') { entered.resolve(); await hold.wait(p.signal); }
    return next();
  });
  const pending = send(h, caller.exec); await entered.promise; target.agent.cancel({ kind: 'user' });
  const result = await pending;
  assert.equal(result.messageStatus, 'cancelled'); assert.equal(result.completed, false); assert.equal(result.output, undefined);
  assert.equal(target.agent.session.snapshotEvents().some(e => e.type === 'user/message' && e.data.id === result.messageId), false);
});

test('real failed-attempt stream supplies only its owning completed turn fallback', { timeout: 15000 }, async t => {
  const h = await receiptHost(t); const caller = await h.holdCaller(); const target = await h.create('target');
  h.ctx.on('agent/request-error', async (p, next) => p.agent.id === 'target' ? { kind: 'retry' } : next());
  h.model.scripts.push(async function* () {
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'recorded attempt text' };
    throw new Error('fixture attempt error');
  });
  h.model.scripts.push(async function* () { yield { type: 'finish', reason: { kind: 'stop' } }; });
  const receipt = await send(h, caller.exec);
  assert.equal(receipt.messageStatus, 'turnCompleted'); assert.equal(receipt.output, 'recorded attempt text');
  assert.ok(target.agent.session.snapshotEvents().some(e => e.type === 'assistant/attempt' && e.data.stream.length));
  await h.ctx.sessionPersistence.flush(); await target.dispose();
  assert.equal((await wait(h, receipt)).output, 'recorded attempt text');
});

test('real queued JSONL receipt stays pending until the resumed owner explicitly wakes it', { timeout: 15000 }, async t => {
  const h = await receiptHost(t); const caller = await h.holdCaller(); const target = await h.create('target');
  const entered = Promise.withResolvers(), hold = gate(); t.after(hold.release);
  h.model.scripts.push(async function* (options) { entered.resolve(); await hold.wait(options.signal); yield* textChunks('old active result'); });
  target.agent.followup(user('old active turn')); await entered.promise;
  const receipt = await send(h, caller.exec, { wait: false }); assert.equal(receipt.messageStatus, 'queued');
  const writer = await h.ctx.sessionPersistence.create({ ...target.agent.session.header, id: 'queued-crash-target' });
  await writer.append(target.agent.session.snapshotEvents()); await writer.flush(); await writer.close();
  const saved = { sessionId: 'queued-crash-target', messageId: receipt.messageId };
  const pending = await wait(h, saved); assert.equal(pending.messageStatus, 'queued'); assert.equal(pending.completed, false);
  assert.equal(h.ctx.agents.get(saved.sessionId), undefined);
  h.model.text('resumed queued answer');
  const resumed = await h.ctx.agents.resume({ resumeSessionId: saved.sessionId, agentOptions: { provider: 'fixture', model: 'scripted' } });
  assert.equal(resumed.agent.inbox.nextTurn[0].id, receipt.messageId);
  // Resume alone does not wake rc.2. The owner explicitly steers; wait never does.
  resumed.agent.steer(user('owner wake'));
  await resumed.agent.whenIdle();
  const done = await wait(h, saved); assert.equal(done.messageStatus, 'turnCompleted'); assert.equal(done.output, 'resumed queued answer');
  target.agent.cancel({ kind: 'user' }); await target.agent.whenIdle();
});

test('receipt A completes while a later B turn is still running', { timeout: 15000 }, async t => {
  const h = await receiptHost(t); const caller = await h.holdCaller(); const target = await h.create('target');
  const enteredB = Promise.withResolvers(), holdB = gate(); t.after(holdB.release);
  h.model.text('A settled');
  h.model.scripts.push(async function* (options) { enteredB.resolve(); await holdB.wait(options.signal); yield* textChunks('B settled'); });
  const a = send(h, caller.exec);
  const b = send(h, caller.exec, { message: 'B', wait: false });
  await enteredB.promise;
  const resultA = await a;
  assert.equal(resultA.output, 'A settled'); assert.equal(resultA.completed, true);
  assert.equal(target.agent.status, 'running', 'A does not wait for unrelated B to become idle');
  const receiptB = await b;
  holdB.release(); await target.agent.whenIdle();
  assert.equal((await wait(h, receiptB)).output, 'B settled');
  assert.equal((await wait(h, resultA)).output, 'A settled');
});
