import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { CommunicationRemote } from '../lib/communication-remote.js';

async function mountRemote(t, connection) {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  ctx.provide('connection', connection);
  ctx.provide('typert', { register() {} });
  let record = { send: true, receive: true, revision: 0 };
  const writes = [];
  const plugin = ctx.plugin(CommunicationRemote, {
    async get() { return record; },
    async set(id, settings, revision, expectedDefaults) {
      writes.push({ id, settings, revision, expectedDefaults });
      record = { ...settings, revision: revision + 1 };
      return { status: 'saved', current: record };
    },
  });
  await plugin.await();
  // As in Typert Gateway, resolve the service from a call-specific receiver context.
  const remote = (peer, signal = new AbortController().signal) =>
    ctx.extend({ invocation: { peer, signal } }).get('sessionCommunication');
  return { ctx, remote, writes };
}

const request = { sessionId: 'synthetic', send: false, receive: true, expectedRevision: 0,
  expectedDefaults: { send: true, receive: true } };
const denied = { code: 'gateway/bad-request' };

for (const generation of ['legacy operator', 'modern owner']) {
  test(`an authenticated ${generation} can read and update communication permissions`, async t => {
    const peer = generation === 'modern owner' ? { principal: { kind: 'owner' } } : {};
    const { remote, writes } = await mountRemote(t, generation === 'legacy operator' ? { operator: peer } : {});
    const receiver = remote(peer);
    assert.deepEqual(await receiver.get({ sessionId: request.sessionId }), { send: true, receive: true, revision: 0 });
    assert.deepEqual(await receiver.set(request), { status: 'saved', current: { send: false, receive: true, revision: 1 } });
    assert.deepEqual(writes, [{
      id: request.sessionId, settings: { send: false, receive: true }, revision: 0,
      expectedDefaults: { send: true, receive: true },
    }]);
  });
}

test('a share viewer, unmatched legacy peer or missing invocation cannot access permissions', async t => {
  const viewer = { principal: { kind: 'share-viewer' } };
  const { ctx, remote, writes } = await mountRemote(t, { operator: viewer });
  for (const receiver of [remote(viewer), remote({}), ctx.get('sessionCommunication')]) {
    await assert.rejects(receiver.get({ sessionId: request.sessionId }), denied);
    await assert.rejects(receiver.set(request), denied);
  }
  assert.deepEqual(writes, []);
});

test('an aborted owner call cannot write communication permissions', async t => {
  const { remote, writes } = await mountRemote(t, {});
  const owner = { principal: { kind: 'owner' } };
  await assert.rejects(remote(owner, AbortSignal.abort()).set(request), { name: 'AbortError' });
  assert.deepEqual(writes, []);
});
