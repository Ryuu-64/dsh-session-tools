import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { getEventListeners } from 'node:events';
import { apply } from '../lib/index.js';

const record = (id, createdAt, extra = {}) => ({ header: { id, createdAt, cwd: `/work/${id}`, ...extra } });
const event = (type, time, data = {}) => ({ type, time, data });
const ids = result => result.sessions.map(session => session.sessionId);
function fixture(records, logs = {}) {
  const tools = new Map(), live = new Map();
  const stats = { reads: [], opens: [], closes: [], active: 0, maximum: 0, resumes: 0 };
  let beforeRead = async () => {};
  const revisions = new Map(records.map(item => [item.header.id, 'v1']));
  const query = {
    listSessions: async signal => { signal?.throwIfAborted(); return records; },
    readTitle: async id => ({ title: `Title ${id}` }),
    readSession: async id => ({ events: logs[id] ?? [] }),
  };
  const persistence = {
    stat: async id => ({ revision: revisions.get(id) }),
    open: async (id, access, { signal }) => {
      assert.equal(access, 'read'); stats.opens.push(id);
      stats.maximum = Math.max(stats.maximum, ++stats.active);
      return {
        header: records.find(item => item.header.id === id).header,
        inheritedEventCount: 0,
        async read(offset, length, options) {
          assert.equal(offset, 0); assert.equal(options.signal, signal);
          stats.reads.push(id); await beforeRead(id, signal);
          return { events: logs[id] ?? [] };
        },
        async close() { stats.closes.push(id); stats.active--; },
      };
    },
  };
  const services = { sessionQuery: query, sessionPersistence: persistence, sessions: { get: id => live.get(id) }, workspaceRegistry: { archivedSessionIds: ['B'] } };
  const ctx = {
    tools: { register: tool => tools.set(tool.name, tool) },
    agents: { get: () => undefined, resume: () => { stats.resumes++; throw new Error('must not resume'); } },
    get: name => services[name],
  };
  apply(ctx);
  return { records, logs, live, stats, services, revisions, query, persistence,
    beforeRead: fn => { beforeRead = fn; },
    list: (limit, signal) => tools.get('list_sessions').execute(limit === undefined ? {} : { limit }, { agent: { id: 'A' }, signal }),
  };
}

test('list_sessions sorts crossed creation/activity times before limit=1', async () => {
  const h = fixture([record('B', 200), record('A', 100)], {
    A: [event('user/message', 500)], B: [event('assistant/message', 300)],
  });
  assert.deepEqual(ids(await h.list(1)), ['A']);
  const result = await h.list();
  assert.deepEqual(ids(result), ['A', 'B']);
  assert.equal(result.sessions[0].current, true);
  assert.equal(result.sessions[1].state, 'archived');
  assert.equal(result.sessions[0].title, 'Title A');
  assert.equal(result.total, 2);
  assert.deepEqual(h.stats.reads.sort(), ['A', 'B'], 'unchanged revisions reuse derived times');
  assert.equal(h.stats.resumes, 0); assert.equal(h.stats.active, 0);
});

test('title-only and queue-removal changes do not count; no activity uses creation time; ties are stable', async () => {
  const h = fixture([record('B', 200), record('A', 100), record('empty', 400), record('title-only', 350)], {
    A: [event('user/message', 500)], B: [event('assistant/message', 500), event('session/title', 900), event('agent/inbox/spliced', 999, { inserted: [] })],
    'title-only': [event('session/title', 1000)],
  });
  assert.deepEqual(ids(await h.list()), ['B', 'A', 'empty', 'title-only']);
  h.logs.B.push(event('session/title', 2000)); h.revisions.set('B', 'v2');
  assert.deepEqual(ids(await h.list()), ['B', 'A', 'empty', 'title-only']);
  assert.deepEqual(h.stats.reads, ['B', 'A', 'empty', 'title-only', 'B']);
});

for (const type of ['user/message', 'assistant/message', 'assistant/attempt', 'turn/start', 'turn/end', 'step/start', 'step/end', 'tool/call', 'tool/result', 'agent/inbox/spliced']) {
  test(`conversation activity includes ${type}`, async () => {
    const h = fixture([record('B', 200), record('A', 100)], { A: [event(type, 300, { inserted: [{}] })] });
    assert.deepEqual(ids(await h.list(1)), ['A']);
  });
}

test('live sessions use current log versions without reading persistence or retaining stale instances', async () => {
  const h = fixture([record('B', 200), record('A', 100)]);
  let events = [event('user/message', 300)];
  h.live.set('A', { header: h.records[1].header, snapshotEvents: () => events });
  assert.deepEqual(ids(await h.list()), ['A', 'B']);
  events = [...events, event('session/title', 700)];
  assert.deepEqual(ids(await h.list()), ['A', 'B']);
  h.live.set('A', { header: h.records[1].header, snapshotEvents: () => [event('user/message', 150)] });
  assert.deepEqual(ids(await h.list()), ['B', 'A'], 'replacement session with same count is a different source');
  h.live.delete('A'); h.logs.A = [event('user/message', 400)];
  assert.deepEqual(ids(await h.list()), ['A', 'B']);
  assert.deepEqual(h.stats.reads, ['B', 'A']);
});

test('fork-inherited events and resume markers do not become new child activity', async () => {
  const h = fixture([record('parent', 100), record('child', 300)]);
  h.live.set('parent', { header: h.records[0].header, snapshotEvents: () => [event('user/message', 400)] });
  h.live.set('child', { header: h.records[1].header, inheritedEventCount: 1, snapshotEvents: () => [event('user/message', 1000), event('session/end-seed', 2000)] });
  assert.deepEqual(ids(await h.list()), ['parent', 'child']);
});

test('persistence replacement with equal revision invalidates cached times; query-only reads are never cached', async () => {
  const h = fixture([record('B', 200), record('A', 100)], { A: [event('user/message', 300)] });
  assert.deepEqual(ids(await h.list(1)), ['A']);
  h.services.sessionPersistence = { ...h.persistence };
  h.logs.A = [];
  assert.deepEqual(ids(await h.list(1)), ['B']);
  delete h.services.sessionPersistence;
  h.logs.A = [event('user/message', 400)];
  assert.deepEqual(ids(await h.list(1)), ['A']);
  h.logs.A = [];
  assert.deepEqual(ids(await h.list(1)), ['B']);
});

test('subagents stay in total but their logs are not read or included in limit', async () => {
  const h = fixture([record('sub', 600, { delegationDepth: 1 }), record('sub-origin', 700, { origin: 'subagent' }), record('A', 100)]);
  const result = await h.list(1);
  assert.deepEqual(ids(result), ['A']); assert.equal(result.total, 3);
  assert.deepEqual(h.stats.reads, ['A']);
});

test('overlapping lists bound full-log read concurrency to four and close every handle', async () => {
  const h = fixture(Array.from({ length: 30 }, (_, index) => record(String(index), index)));
  h.beforeRead(async () => delay(1));
  await Promise.all([h.list(), h.list()]);
  assert.equal(h.stats.maximum, 4);
  assert.equal(h.stats.active, 0);
  assert.equal(h.stats.opens.length, h.stats.closes.length);
});

test('cancellation stops queued work, closes readers and leaves no abort listeners', async () => {
  const h = fixture(Array.from({ length: 30 }, (_, index) => record(String(index), index)));
  const controller = new AbortController();
  h.beforeRead(async (_, signal) => { controller.abort(); signal.throwIfAborted(); });
  await assert.rejects(h.list(1, controller.signal), { name: 'AbortError' });
  assert.equal(h.stats.active, 0);
  assert.equal(h.stats.opens.length, h.stats.closes.length);
  assert.ok(h.stats.opens.length <= 4);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('failed cold reads close handles, fail the list and are not cached as creation time', async () => {
  const h = fixture([record('A', 100)]);
  h.beforeRead(async () => { throw new Error('unreadable log'); });
  await assert.rejects(h.list(), /unreadable log/);
  assert.equal(h.stats.active, 0);
  h.beforeRead(async () => {});
  assert.deepEqual(ids(await h.list()), ['A']);
  assert.equal(h.stats.reads.length, 2);
});
