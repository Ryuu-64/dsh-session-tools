import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import { communicationPermissions } from '../lib/communication-permissions.js';
import { receiptHost } from './helpers/message-receipts-host.mjs';

const domainName = 'session_tools_communication';
const defaults = () => ({ send: true, receive: true });

test('domain closes after the last owner drains, and a new owner waits to reopen', { timeout: 10000 }, async t => {
  const ctx = new Context();
  const writeStarted = Promise.withResolvers(), allowWrite = Promise.withResolvers();
  const closeStarted = Promise.withResolvers(), allowClose = Promise.withResolvers();
  t.after(async () => {
    allowWrite.resolve();
    allowClose.resolve();
    await ctx.fiber.dispose();
  });
  const records = new Map();
  let opens = 0, closes = 0;
  ctx.provide('storageDomain', {
    async open() {
      opens++;
      return {
        table: () => ({
          get: id => records.get(id),
          async put(id, row) {
            writeStarted.resolve();
            await allowWrite.promise;
            records.set(id, row);
          },
        }),
        async close() {
          closes++;
          closeStarted.resolve();
          await allowClose.promise;
        },
      };
    },
  });
  const start = async () => {
    let permissions;
    // Each instance gets its own Fiber, and owns its own lease on the domain.
    const fiber = ctx.plugin({ apply(scope) { permissions = communicationPermissions(scope, defaults); } });
    await fiber.await();
    return { fiber, permissions };
  };

  const first = await start(), second = await start();
  await first.fiber.dispose();
  assert.equal(opens, 1);
  assert.equal(closes, 0);
  const write = second.permissions.set('session', { send: false, receive: true }, 0);
  await writeStarted.promise;
  const disposing = second.fiber.dispose();
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(second.permissions.get('session'), /unloaded/);
  assert.equal(closes, 0, 'the accepted write has not committed yet');
  allowWrite.resolve();
  await closeStarted.promise;

  const next = await start();
  const read = next.permissions.get('session');
  assert.equal(opens, 1, 'the replacement cannot open until the old domain closes');
  allowClose.resolve();
  await disposing;
  assert.equal((await write).status, 'saved');
  assert.deepEqual(await read, { send: false, receive: true, revision: 1 });
  assert.equal(opens, 2);
});

test('the official Loader unloads and reopens the permission domain, retaining overrides', async t => {
  const h = await receiptHost(t);
  const actor = await h.holdCaller();
  const create = () => h.ctx.tools.get('session_create').execute({ prompt: 'Unavailable to this session' }, actor.exec);
  await assert.rejects(h.ctx.tools.get('session_create').execute({ prompt: ' ' }, actor.exec), /needs a prompt/);
  const old = h.ctx.storageDomain.get(domainName);
  await old.table('sessions').put('caller', { send: false, receive: true, revision: 1 });
  await assert.rejects(create(), { name: 'CommunicationDenied' });
  await h.loader.update(h.pluginId, { disabled: true });
  await h.loader.await();
  assert.equal(h.ctx.storageDomain.get(domainName), undefined);
  await h.loader.update(h.pluginId, { disabled: false });
  await h.loader.await();
  await assert.rejects(create(), { name: 'CommunicationDenied' });
  assert.notEqual(h.ctx.storageDomain.get(domainName), old);
});
