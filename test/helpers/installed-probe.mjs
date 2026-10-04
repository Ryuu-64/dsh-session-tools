/** Executed inside a clean consumer, resolving only its installed dependencies. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realHost } from './real-host.mjs';
import { createRequire } from 'node:module';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
const require = createRequire(import.meta.url);

test('installed tarball runs create/send/wait/list through real host services and persists provenance', async t => {
  const h = await realHost(t, { pluginPath: import.meta.resolve('@ryuu-64/dsh-session-tools') });
  await h.loader.create({ name: '@deepseek-ai/dsh-session-query' });
  await h.loader.await();
  h.ctx.on('approval/request', () => 'allowed-once');
  const entered = Promise.withResolvers(), hold = Promise.withResolvers();
  t.after(() => hold.resolve());
  h.model.scripts.push(async function* (options) {
    entered.resolve();
    const aborted = Promise.withResolvers();
    const onAbort = () => aborted.resolve();
    options.signal.addEventListener('abort', onAbort, { once: true });
    try { await Promise.race([hold.promise, aborted.promise]); }
    finally { options.signal.removeEventListener('abort', onAbort); }
    yield { type: 'finish', reason: { kind: 'stop' } };
  });
  const caller = await h.createAgent('installed-caller');
  caller.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'hold installed caller turn' }] }));
  await entered.promise;
  const exec = name => ({ agent: caller.agent, name, callId: 'installed-call', signal: new AbortController().signal });
  h.model.text('installed first answer');
  const created = await h.ctx.tools.get('session_create').execute({ prompt: 'installed first task', wait: true }, exec('session_create'));
  assert.equal(created.messageStatus, 'turnCompleted');
  assert.equal(created.output, 'installed first answer');
  h.model.text('installed second answer');
  const sent = await h.ctx.tools.get('session_send').execute({ sessionId: created.sessionId, message: 'installed next task', wait: true }, exec('session_send'));
  assert.equal(sent.messageStatus, 'turnCompleted');
  assert.equal(sent.output, 'installed second answer');
  const waited = await h.ctx.tools.get('session_wait').execute({ sessionId: created.sessionId, messageId: created.messageId }, exec('session_wait'));
  assert.equal(waited.output, 'installed first answer');
  const listed = await h.ctx.tools.get('list_sessions').execute({}, exec('list_sessions'));
  assert.ok(JSON.stringify(listed).includes(created.sessionId));
  hold.resolve();
  await caller.agent.whenIdle();
  await h.ctx.sessionPersistence.flush();
  const reader = await h.ctx.sessionPersistence.open(created.sessionId, 'read');
  try {
    const log = await reader.read();
    const messages = log.events.filter(e => e.type === 'user/message' && [created.messageId, sent.messageId].includes(e.data.id));
    assert.equal(messages.length, 2);
    assert.deepEqual(new Set(messages.map(e => e.data.id)), new Set([created.messageId, sent.messageId]));
    for (const message of messages) assert.deepEqual(message.data.source, { kind: 'tool-session', form: 'relay' });
  } finally { await reader.close(); }
  if (require('@deepseek-ai/dsh-agent/package.json').version === '0.2.0-rc.2') {
    const { clientRc2 } = await import('./client-rc2.mjs');
    const browser = await clientRc2(t, { ids: [created.sessionId], pluginPath: new URL(import.meta.resolve('@ryuu-64/dsh-session-tools/client')) });
    await browser.mountWorkspace();
    browser.click(created.sessionId);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(browser.ctx.sessions.binding(created.sessionId).session.getSnapshot().openState, 'open');
    assert.equal(browser.ctx.sessions.retainInfo(created.sessionId).getSnapshot().retainedBy.mainView, 1);
    assert.deepEqual(browser.cancelled, []);
  }
});
