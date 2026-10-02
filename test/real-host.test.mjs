import { test } from 'node:test';
import assert from 'node:assert/strict';
import { realHost } from './helpers/real-host.mjs';
import { createUserMessage } from '@deepseek-ai/dsh-llm';

test('Loader creates a real Agent and durably reloads its model response', { timeout: 15000 }, async (t) => {
 const h = await realHost(t);
 h.model.text('fixture answer');
 const handle = await h.createAgent('fixture-caller');
 handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'synthetic fixture only' }], source: { kind: 'user' } }));
 await handle.agent.whenIdle();
 assert.equal(h.model.requests.length, 1);
 await handle.dispose();
 const reader = await h.ctx.sessionPersistence.open('fixture-caller', 'read');
 const stored = await reader.read();
 await reader.close();
 assert.match(JSON.stringify(stored), /fixture answer/);
});

for (const outcome of ['rejected', 'allowed-once']) {
 test(`real approval ${outcome} controls session_create before durable side effects`, { timeout: 15000 }, async (t) => {
   const h = await realHost(t);
   const asked = [];
   h.ctx.on('approval/request', (request) => { asked.push(request); return outcome; });
   h.model.tool('session_create', { prompt: 'synthetic child', wait: true });
   if (outcome === 'allowed-once') h.model.text('child answer');
   h.model.text('caller done');
   const handle = await h.createAgent('fixture-caller');
   handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'exercise tool' }] }));
   await handle.agent.whenIdle();
   assert.equal(asked.length, 1);
   const events = handle.agent.session.snapshotEvents();
   assert.equal(events.find(e => e.type === 'approval/decided').data.outcome, outcome);
   const stored = await h.ctx.sessionPersistence.list();
   assert.equal(stored.length, outcome === 'allowed-once' ? 2 : 1);
   const finalRequest = h.model.requests.at(-1);
   assert.match(JSON.stringify(finalRequest.messages), outcome === 'allowed-once' ? /Created session/ : /declined/);
 });
}

test('real session_send delivers only to the target and persists plugin message provenance', { timeout: 15000 }, async (t) => {
 const h = await realHost(t);
 h.ctx.on('approval/request', () => 'allowed-once');
 const target = await h.createAgent('fixture-target');
 h.model.tool('session_send', { sessionId: target.agent.id, message: 'synthetic routed message', wait: true, timeoutMs: 1000 });
 h.model.text('target answer');
 h.model.text('caller done');
 const caller = await h.createAgent('fixture-caller');
 caller.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'exercise send' }] }));
 await caller.agent.whenIdle();
 await target.agent.whenIdle();
 const delivered = target.agent.session.snapshotEvents().filter(e => e.type === 'user/message' && e.data.source.plugin === 'tool-session');
 assert.equal(delivered.length, 1);
 assert.equal(delivered[0].data.content[0].text, 'synthetic routed message');
 assert.deepEqual(delivered[0].data.source, { kind: 'plugin', plugin: 'tool-session' });
 assert.notEqual(delivered[0].data.id, caller.agent.session.snapshotEvents().find(e => e.type === 'user/message').data.id);
 assert.match(JSON.stringify(h.model.requests.at(-1).messages), /target answer/);
 await target.dispose();
 const reader = await h.ctx.sessionPersistence.open('fixture-target', 'read');
 try { assert.deepEqual((await reader.read()).events.find(e => e.type === 'user/message').data, delivered[0].data); }
 finally { await reader.close(); }
});

test('cancelling a real pending approval cleans up without creating another session', { timeout: 15000 }, async (t) => {
 const h = await realHost(t);
 const pending = Promise.withResolvers();
 const answer = Promise.withResolvers();
 h.ctx.on('approval/request', () => { pending.resolve(); return answer.promise; });
 h.model.tool('session_create', { prompt: 'must never be delivered' });
 const caller = await h.createAgent('fixture-caller');
 caller.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'cancel fixture' }] }));
 await pending.promise;
 caller.agent.cancel({ kind: 'user' });
 await caller.agent.whenIdle();
 answer.resolve('allowed-once');
 await Promise.resolve();
 assert.equal((await h.ctx.sessionPersistence.list()).length, 1);
 assert.equal(caller.agent.session.snapshotEvents().find(e => e.type === 'approval/decided').data.outcome, 'cancelled');
 assert.equal(h.model.requests.length, 1);
});
