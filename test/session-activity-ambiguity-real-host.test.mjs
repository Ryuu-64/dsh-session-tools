import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symbols } from '@deepseek-ai/cordis';
import { interruptedTurnClosers } from '@deepseek-ai/dsh-session';
import { conversationActivity } from '../lib/session-activity.js';
import { receiptHost, user } from './helpers/message-receipts-host.mjs';

async function withQuery(h) {
  await h.loader.create({ name: '@deepseek-ai/dsh-session-query' });
  await h.loader.await();
  return args => h.ctx.tools.get('list_sessions').execute(args ?? {}, {});
}

/** Preserve the reviewer's actual emitted-record counterexample unchanged. */
async function ambiguousPrefix(t, clock) {
  const h = await receiptHost(t); await withQuery(h);
  const source = await h.create('source');
  const session = source.agent.session[symbols.original] ?? source.agent.session;
  const append = session.append;
  let renamed = false;
  t.mock.method(session, 'append', function (type, ...args) {
    const result = append.call(this, type, ...args);
    if (type === 'tool/result' && !renamed) {
      renamed = true; clock.now = 300;
      h.ctx.sessionTitle.rename(source.agent.session, 'same millisecond title');
    }
    return result;
  });
  h.model.tool('list_sessions', {}); h.model.text('done');
  source.agent.followup(user('task')); await source.agent.whenIdle();
  const events = source.agent.session.snapshotEvents();
  const end = events.findIndex(event => event.type === 'step/end');
  assert.ok(end > 0);
  assert.equal(events[end - 1].type, 'session/title');
  assert.equal(events[end - 1].time, 300);
  assert.equal(events[end].time, 300, 'this is a genuine step/end emitted by the live official loop');
  const prefix = events.slice(0, end + 1);
  await source.dispose();
  return { prefix, header: source.agent.session.header };
}

test('official genuine and wholly repaired step endings can produce identical persisted records', async t => {
  const clock = { now: 100 }; t.mock.method(Date, 'now', () => clock.now);
  const { prefix } = await ambiguousPrefix(t, clock);
  const realStepThenRepair = [...prefix, ...interruptedTurnClosers(prefix)];
  const repairBoth = [...prefix.slice(0, -1), ...interruptedTurnClosers(prefix.slice(0, -1))];
  assert.equal(prefix.at(-1).type, 'step/end');
  assert.equal(prefix.at(-1).time, 300);
  assert.deepEqual(realStepThenRepair, repairBoth,
    'equal fields cannot prove whether step/end was genuine; no classifier may claim otherwise');
});

test('explicit activity definition is stable for the ambiguous records live, cold and after restart', { timeout: 15000 }, async t => {
  const clock = { now: 100 }; t.mock.method(Date, 'now', () => clock.now);
  const { prefix, header } = await ambiguousPrefix(t, clock);
  // Separate fixture storage makes the crashed history the only old candidate.
  let h = await receiptHost(t), list = await withQuery(h);
  const writer = await h.ctx.sessionPersistence.create({ ...header, id: 'crash' });
  try { await writer.append(prefix); await writer.flush(); } finally { await writer.close(); }
  clock.now = 200; await h.create('newer');
  const before = conversationActivity(prefix, 100);
  assert.equal(before, 100, 'the last selected activity record is at 100; bare step/end at 300 is not selected');
  assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'newer');
  clock.now = 1000;
  const resumed = await h.ctx.agents.resume({ resumeSessionId: 'crash', agentOptions: { provider: 'fixture', model: 'scripted' } });
  assert.equal(conversationActivity(resumed.agent.session.snapshotEvents(), 100), before);
  assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'newer');
  assert.equal(h.model.requests.length, 0);
  await h.ctx.sessionPersistence.flush(); await resumed.dispose();
  const durable = await h.read('crash');
  assert.equal(conversationActivity(durable.events, durable.header.createdAt), before);
  assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'newer');
  h = await h.restart(); list = await withQuery(h);
  const restarted = await h.read('crash');
  assert.equal(conversationActivity(restarted.events, restarted.header.createdAt), before);
  assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'newer');
  assert.equal(h.ctx.agents.get('crash'), undefined);
  assert.equal(h.model.requests.length, 0);
  const active = await h.ctx.agents.resume({ resumeSessionId: 'crash', agentOptions: { provider: 'fixture', model: 'scripted' } });
  clock.now = 1100; h.model.text('new output'); active.agent.followup(user('new input')); await active.agent.whenIdle();
  assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'crash', 'later explicit activity still advances the session');
});
