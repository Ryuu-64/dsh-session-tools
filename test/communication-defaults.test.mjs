import assert from 'node:assert/strict';
import { test } from 'node:test';
import { communicationPermissions } from '../lib/communication-permissions.js';
import { receiptHost } from './helpers/message-receipts-host.mjs';

test('live defaults govern inherited communication and preserve explicit session settings', async t => {
  let approvals = 0;
  const h = await receiptHost(t, { onApproval() { approvals++; return 'allowed-once'; } });
  await h.loader.create({ name: '@deepseek-ai/dsh-session-query' });
  await h.loader.await();
  const caller = await h.holdCaller();
  await h.create('inherited');
  await h.create('overridden');
  await h.ctx.sessionPersistence.flush();

  const entry = h.loader.resolve(h.pluginId);
  const fiber = entry.fiber;
  const statusTool = h.ctx.tools.get('session_communication_status');
  const permissions = communicationPermissions(h.ctx, () => ({
    send: entry.options.config?.defaultSend ?? true,
    receive: entry.options.config?.defaultReceive ?? true,
  }));
  const statusOf = async sessionId => (await statusTool.execute({ sessionId }, caller.exec)).communication.reason;
  const before = await permissions.get('inherited');
  assert.deepEqual(before, { send: true, receive: true, revision: 0 });
  assert.equal(await statusOf('inherited'), 'switches_allow');
  assert.equal((await permissions.set('overridden', { send: true, receive: true }, 0)).status, 'saved');

  await h.loader.update(h.pluginId, { config: { defaultReceive: false } });
  await h.loader.await();
  assert.equal(entry.fiber, fiber, 'only volatile settings changed');
  assert.equal(h.ctx.tools.get('session_communication_status'), statusTool);
  assert.equal(await statusOf('inherited'), 'target_receive_disabled');
  assert.equal(await statusOf('overridden'), 'switches_allow');
  const listed = await h.ctx.tools.get('list_sessions').execute({}, caller.exec);
  assert.equal(listed.sessions.find(row => row.sessionId === 'inherited').communication.reason, 'target_receive_disabled');
  await assert.rejects(h.ctx.tools.get('session_create').execute({
    prompt: 'This must not create a new conversation',
  }, caller.exec), { name: 'CommunicationDenied' });
  assert.equal(approvals, 0);
  assert.equal((await h.ctx.sessionPersistence.list()).length, 3);

  await assert.rejects(h.ctx.tools.get('session_send').execute({
    sessionId: 'inherited', message: 'This must be denied',
  }, caller.exec), { name: 'CommunicationDenied' });

  const stale = await permissions.set('inherited', { send: false, receive: true }, before.revision, {
    send: before.send, receive: before.receive,
  });
  assert.deepEqual(stale, { status: 'conflict', current: { send: true, receive: false, revision: 0 } });
  assert.equal((await permissions.set('inherited', { send: false, receive: false }, stale.current.revision, {
    send: stale.current.send, receive: stale.current.receive,
  })).status, 'saved');

  await h.loader.update(h.pluginId, { config: { defaultSend: false } });
  await h.loader.await();
  assert.equal(await statusOf('overridden'), 'sender_send_disabled');
  assert.deepEqual(await permissions.get('inherited'), { send: false, receive: false, revision: 1 });
  await assert.rejects(h.ctx.tools.get('session_create').execute({
    prompt: 'This must be denied',
  }, caller.exec), { name: 'CommunicationDenied' });
});

for (const boundary of ['preset setup', 'agent publication']) {
  test(`closing default receive during ${boundary} leaves no saved child`, { timeout: 15000 }, async t => {
    const h = await receiptHost(t);
    const caller = await h.holdCaller();
    await h.ctx.sessionPersistence.flush();
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    t.after(release.resolve);
    if (boundary === 'preset setup') {
      h.ctx.provide('agentPresets', {
        async resolve() { return { id: 'delayed' }; },
        async mount() { entered.resolve(); await release.promise; },
      });
    }
    const published = [];
    h.ctx.on('agent/created', async ({ agent }) => {
      published.push(agent.id);
      if (boundary === 'agent publication') {
        entered.resolve();
        await release.promise;
      }
    });
    const denied = assert.rejects(h.ctx.tools.get('session_create').execute({
      prompt: 'Do not leave this prompt in a title',
    }, caller.exec), { name: 'CommunicationDenied' });
    try {
      await Promise.race([entered.promise, denied.then(() => assert.fail('Denied before configuration changed'))]);
      await h.loader.update(h.pluginId, { config: { defaultReceive: false } });
      await h.loader.await();
    } finally {
      release.resolve();
    }
    await denied;
    assert.equal(published.length, boundary === 'preset setup' ? 0 : 1);
    await h.ctx.sessionPersistence.flush();
    assert.deepEqual((await h.ctx.sessionPersistence.list()).map(item => item.header.id), ['caller']);
  });
}
