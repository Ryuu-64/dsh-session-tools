import { test } from 'node:test';
import assert from 'node:assert/strict';
import { receiptHost, user, gate, textChunks } from './helpers/message-receipts-host.mjs';

async function withQuery(h) {
  await h.loader.create({ name: '@deepseek-ai/dsh-session-query' });
  await h.loader.await();
  return args => h.ctx.tools.get('list_sessions').execute(args ?? {}, {});
}

for (const cut of ['turn/start', 'step/start', 'assistant/message', 'tool/call']) {
  test(`official recovery after ${cut} does not turn a title change into activity`, { timeout: 15000 }, async t => {
    let h = await receiptHost(t);
    let list = await withQuery(h);
    let now = 100; t.mock.method(Date, 'now', () => now);
    const source = await h.create('source');
    h.model.tool('list_sessions', {}); h.model.text('source answer');
    source.agent.followup(user('source task')); await source.agent.whenIdle();
    const events = source.agent.session.snapshotEvents();
    const index = events.findIndex(event => event.type === cut);
    assert.ok(index >= 0);
    const prefix = events.slice(0, index + 1);
    now = 900; h.ctx.sessionTitle.rename(source.agent.session, 'title only');
    const title = source.agent.session.snapshotEvents().findLast(event => event.type === 'session/title');
    const writer = await h.ctx.sessionPersistence.create({ ...source.agent.session.header, id: 'crash' });
    try {
      await writer.append([...prefix, { ...title, seq: prefix.length }]);
      await writer.flush();
    } finally { await writer.close(); }
    now = 200; await h.create('newer');
    const before = (await list()).sessions.map(session => session.sessionId);
    assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'newer');
    const requests = h.model.requests.length;
    now = 1000;
    const resumed = await h.ctx.agents.resume({ resumeSessionId: 'crash', agentOptions: { provider: 'fixture', model: 'scripted' } });
    const recovered = resumed.agent.session.snapshotEvents().slice(prefix.length + 1);
    assert.equal(recovered.find(event => event.type === 'turn/end').data.reason.kind, 'interrupted');
    if (cut !== 'turn/start') assert.ok(recovered.some(event => event.type === 'step/end'));
    if (['assistant/message', 'tool/call'].includes(cut)) {
      const result = recovered.find(event => event.type === 'tool/result');
      assert.equal(result.data.error.code, cut === 'tool/call' ? 'TOOL_OUTCOME_UNKNOWN' : 'TOOL_NOT_STARTED');
    }
    assert.deepEqual((await list()).sessions.map(session => session.sessionId), before);
    assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'newer');
    assert.equal(h.model.requests.length, requests, 'recovery and listing run no model request');
    await h.ctx.sessionPersistence.flush();
    await resumed.dispose();
    assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'newer', 'durable repaired log retains the same activity');
    h = await h.restart(); list = await withQuery(h);
    assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'newer', 'fresh plugin replays the same repaired history');
    assert.equal(h.ctx.agents.get('crash'), undefined);
    assert.equal(h.model.requests.length, 0);
    const again = await h.ctx.agents.resume({ resumeSessionId: 'crash', agentOptions: { provider: 'fixture', model: 'scripted' } });
    now = 1100; h.model.text('new answer'); again.agent.followup(user('new work')); await again.agent.whenIdle();
    assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'crash', 'later real conversation still advances activity');
    assert.equal(h.model.requests.length, 1);
  });
}

for (const cut of ['tool/result', 'step/end']) {
  test(`bare ${cut} is not an independent activity marker before or after recovery`, { timeout: 15000 }, async t => {
    const h = await receiptHost(t), list = await withQuery(h);
    let now = 100; t.mock.method(Date, 'now', () => now);
    const source = await h.create('source');
    h.model.tool('list_sessions', {}); h.model.text('source answer');
    source.agent.followup(user('task')); await source.agent.whenIdle();
    const events = source.agent.session.snapshotEvents();
    const index = events.findIndex(event => event.type === cut);
    const prefix = events.slice(0, index + 1);
    now = 250; h.ctx.sessionTitle.rename(source.agent.session, 'title only');
    const title = source.agent.session.snapshotEvents().findLast(event => event.type === 'session/title');
    // Place a metadata change before an actual execution event at a later time.
    // Under the explicit activity definition, neither this bare completion
    // nor a later recovery suffix is an independent sort marker.
    const tail = { ...prefix.pop(), seq: index + 1, time: 300 };
    const writer = await h.ctx.sessionPersistence.create({ ...source.agent.session.header, id: 'crash' });
    try {
      await writer.append([...prefix, { ...title, seq: index }, tail]);
      await writer.flush();
    } finally { await writer.close(); }
    now = 200; await h.create('newer');
    assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'newer');
    now = 1000;
    await h.ctx.agents.resume({ resumeSessionId: 'crash', agentOptions: { provider: 'fixture', model: 'scripted' } });
    assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'newer', 'recovery cannot change the meaning of a bare completion');
  });
}

test('a genuine user cancellation after a title change still advances activity', { timeout: 15000 }, async t => {
  const h = await receiptHost(t), list = await withQuery(h);
  let now = 100; t.mock.method(Date, 'now', () => now);
  const a = await h.create('A'), started = Promise.withResolvers(), hold = gate();
  t.after(hold.release);
  h.model.scripts.push(async function* (options) { started.resolve(); await hold.wait(options.signal); yield* textChunks('partial result'); });
  a.agent.followup(user('task')); await started.promise;
  now = 200; await h.create('B');
  now = 900; h.ctx.sessionTitle.rename(a.agent.session, 'title only');
  assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'B');
  now = 1000; a.agent.cancel({ kind: 'user' }); await a.agent.whenIdle();
  assert.equal(a.agent.session.snapshotEvents().findLast(event => event.type === 'turn/end').data.reason.kind, 'aborted');
  assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'A');
});

for (const kind of ['blocked', 'error']) {
  test(`real ${kind} turn ending advances activity without model output`, { timeout: 15000 }, async t => {
    const h = await receiptHost(t), list = await withQuery(h);
    let now = 100; t.mock.method(Date, 'now', () => now);
    const a = await h.create('A'), entered = Promise.withResolvers(), hold = gate();
    t.after(hold.release);
    h.ctx.on('agent/pre-step', async (p, next) => {
      if (p.agent.id !== 'A') return next();
      entered.resolve(); await hold.wait(p.signal);
      if (kind === 'error') throw new Error('fixture pre-step failure');
      return { kind: 'reject' };
    });
    a.agent.followup(user('task')); await entered.promise;
    now = 200; await h.create('B');
    now = 250; h.ctx.sessionTitle.rename(a.agent.session, 'title only');
    assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'B');
    now = 300; hold.release(); await a.agent.whenIdle();
    const events = a.agent.session.snapshotEvents();
    const ended = events.findLast(event => event.type === 'turn/end');
    assert.equal(ended.data.reason.kind, kind); assert.equal(ended.time, 300);
    assert.equal(events.some(event => ['assistant/message', 'assistant/attempt', 'step/start'].includes(event.type)), false,
      'this actual terminal outcome is the only execution record later than turn/start');
    assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'A');
    assert.equal(h.model.requests.length, 0);
  });
}
