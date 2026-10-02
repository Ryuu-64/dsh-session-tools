import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symbols } from '@deepseek-ai/cordis';
import { receiptHost, user } from './helpers/message-receipts-host.mjs';

async function query(h) {
  await h.loader.create({ name: '@deepseek-ai/dsh-session-query' });
  await h.loader.await();
  return args => h.ctx.tools.get('list_sessions').execute(args ?? {}, {});
}
function trackReads(t, h) {
  const service = h.ctx.sessionPersistence[symbols.original];
  const open = service.open;
  const stats = { opens: 0, reads: 0, closes: 0, active: 0, maximum: 0 };
  t.mock.method(service, 'open', async function (...args) {
    assert.equal(args[1], 'read', 'listing must never open a writable handle');
    const handle = await open.apply(this, args);
    stats.opens++; stats.maximum = Math.max(stats.maximum, ++stats.active);
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.read = async (...args) => { stats.reads++; return read(...args); };
    handle.close = async () => { try { return await close(); } finally { stats.closes++; stats.active--; } };
    return handle;
  });
  return stats;
}

test('real rc.2 query and Agent logs sort conversation activity before limit, live and after restart', { timeout: 15000 }, async t => {
  let h = await receiptHost(t);
  let list = await query(h);
  let now = 100;
  t.mock.method(Date, 'now', () => now);
  const a = await h.create('A');
  now = 110; h.model.text('A first answer'); a.agent.followup(user('A first task')); await a.agent.whenIdle();
  now = 200; const b = await h.create('B');
  now = 250; h.model.text('B answer'); b.agent.followup(user('B task')); await b.agent.whenIdle();
  now = 300; h.model.text('A latest answer'); a.agent.followup(user('A recent task')); await a.agent.whenIdle();
  now = 900; h.ctx.sessionTitle.rename(b.agent.session, 'renamed without conversation');
  assert.deepEqual((await h.ctx.sessionQuery.listSessions()).map(r => r.header.id), ['B', 'A'], 'official query really returns creation order');
  assert.deepEqual((await list()).sessions.map(r => r.sessionId), ['A', 'B']);
  assert.equal((await list({ limit: 1 })).sessions[0].sessionId, 'A');
  await h.ctx.sessionPersistence.flush();
  await a.dispose(); await b.dispose();
  h = await h.restart(); list = await query(h);
  const stats = trackReads(t, h);
  const result = await list({ limit: 1 });
  assert.equal(result.sessions[0].sessionId, 'A');
  assert.equal(h.ctx.agents.get('A'), undefined); assert.equal(h.ctx.agents.get('B'), undefined);
  assert.equal(h.ctx.sessions.list().length, 0, 'read-only sorting does not create a Session');
  assert.equal(h.model.requests.length, 0);
  assert.equal(stats.active, 0); assert.equal(stats.closes, stats.opens);
  const firstReads = stats.reads;
  await list({ limit: 1 });
  assert.ok(stats.reads - firstReads <= 1, 'unchanged logs need no further activity scan; selected title may be read');
  assert.equal(stats.active, 0);
});

test('real JSONL cold scan cost and revision invalidation stay bounded', { timeout: 30000 }, async t => {
  let h = await receiptHost(t);
  const count = 24, eventsPerSession = 400;
  for (let index = 0; index < count; index++) {
    const handle = await h.create(`old-${index}`);
    for (let n = 0; n < eventsPerSession; n++) {
      handle.agent.session.append('user/message', user('x'.repeat(256)), { surfaceOp: 'append' });
    }
    await handle.dispose();
  }
  h = await h.restart();
  const list = await query(h);
  const stored = await h.ctx.sessionPersistence.list();
  const bytes = stored.reduce((total, item) => total + item.sizeBytes, 0);
  const stats = trackReads(t, h);
  const first = performance.now();
  const result = await list({ limit: 1 });
  const coldMs = performance.now() - first;
  const coldReads = stats.reads;
  const second = performance.now();
  await list({ limit: 1 });
  const warmMs = performance.now() - second, warmReads = stats.reads - coldReads;
  assert.equal(result.total, count);
  assert.ok(coldReads >= count && coldReads <= count + 1, 'one activity read per old log, plus selected title');
  assert.ok(warmReads <= 1, 'unchanged revisions avoid repeated activity scans');
  assert.ok(stats.maximum <= 4); assert.equal(stats.active, 0);
  assert.equal(stats.opens, stats.closes);
  assert.equal(h.ctx.sessions.list().length, 0); assert.equal(h.model.requests.length, 0);
  t.diagnostic(JSON.stringify({ sessions: count, events: count * eventsPerSession, bytes, coldMs, warmMs, coldReads, warmReads, maxReadHandles: stats.maximum }));

  // Another writer appends while this plugin retains its prior numeric cache.
  // Use the real backend's append-only event/revision contract, then restore
  // read-only instrumentation for the next listing.
  t.mock.restoreAll();
  const id = 'old-0';
  const writer = await h.ctx.sessionPersistence.open(id, 'write');
  try {
    const { events } = await writer.read();
    await writer.append([{ seq: events.length, time: Date.now() + 10000, type: 'user/message', data: user('latest'), surfaceOp: 'append' }]);
    await writer.flush();
  } finally { await writer.close(); }
  const changed = trackReads(t, h);
  assert.equal((await list({ limit: 1 })).sessions[0].sessionId, id);
  assert.ok(changed.reads >= 1 && changed.reads <= 2, 'only the changed log and selected title need reading');
  assert.equal(changed.opens, changed.closes);
});
