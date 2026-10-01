import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service, symbols } from '@deepseek-ai/cordis';
import { apply } from '../lib/index.js';

test('real Cordis traced agent proxies share one cold-resume lock across caller contexts', async (t) => {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  let live, resumeCalls = 0, release;
  const barrier = new Promise(resolve => { release = resolve; });
  const owners = [];
  const messages = [];
  const header = { id: 'target', cwd: '/workspace' };
  const target = { id: 'target', session: { header }, followup: m => messages.push(m.content[0].text) };
  class Agents extends Service {
    constructor(ctx) { super(ctx, 'agents'); }
    get() { owners.push(this.ctx.owner); return live; }
    async resume() {
      owners.push(this.ctx.owner); resumeCalls++;
      await barrier;
      if (live) throw new Error('exclusive write ownership collision');
      live = target;
      return { agent: target };
    }
  }
  const original = new Agents(ctx);
  const registered = [];
  ctx.provide('tools', { register: tool => registered.push(tool) });
  ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) });
  ctx.provide('approval', { overrideOf: () => 'ask', config: { policy: 'ask' }, request: async () => 'allowed-once' });
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write' }) });
  ctx.provide('sessionQuery', { listSessions: async () => [{ header }] });
  const aCtx = ctx.extend({ owner: 'A' });
  const bCtx = ctx.extend({ owner: 'B' });
  assert.notEqual(aCtx.agents, aCtx.agents);
  assert.equal(aCtx.agents[symbols.original], original);
  assert.equal(bCtx.agents[symbols.original], original);
  apply(aCtx); apply(bCtx);
  const senders = registered.filter(tool => tool.name === 'session_send');
  const exec = { agent: { id: 'caller', session: { header: { id: 'caller', cwd: '/workspace' } } }, name: 'session_send', callId: 'send', signal: new AbortController().signal };
  const a = senders[0].execute({ sessionId: 'target', message: 'A' }, exec);
  const b = senders[1].execute({ sessionId: 'target', message: 'B' }, exec);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(resumeCalls, 1);
  release();
  await Promise.all([a, b]);
  assert.equal(resumeCalls, 1);
  assert.deepEqual(messages.sort(), ['A', 'B']);
  assert.ok(owners.includes('A') && owners.includes('B'), 'method calls retain both caller contexts');
});

function creation({ abortAt } = {}) {
  const controller = new AbortController();
  const calls = { create: 0, attach: 0, detach: 0, dispose: 0, rename: 0, followup: 0 };
  const cancel = where => { if (abortAt === where) controller.abort(); };
  const target = { session: { header: {} }, followup() { calls.followup++; } };
  const workspace = {
    id: 'workspace', path: '/workspace',
    async attachSession() { calls.attach++; cancel('attach'); },
    async detachSession() { calls.detach++; },
  };
  let create;
  apply({
    tools: { register(tool) { if (tool.name === 'session_create') create = tool; } },
    agents: { async create(options) {
      calls.create++;
      assert.equal(options.signal, controller.signal);
      cancel('create');
      return { agent: target, async dispose() { calls.dispose++; } };
    } },
    workspaceRegistry: { resolveByPath: async () => workspace, list: () => [workspace] },
    sessionTitle: { get() {}, rename() { calls.rename++; cancel('rename'); } },
    agentDefaultModel: { currentSelection: () => ({ provider: 'p', model: 'm' }) },
    get: name => ({
      approval: { overrideOf: () => 'ask', request: async () => 'allowed-once' },
      sandboxPolicy: { resolve: () => ({ mode: 'workspace-write' }) },
      agentPresets: { async resolve() { cancel('preset'); await Promise.resolve(); return { id: 'preset' }; }, async mount() {} },
    })[name],
  });
  return { calls, run: () => create.execute({ prompt: 'hello', workspacePath: '/workspace', title: 'test' }, {
    name: 'session_create', callId: 'create', signal: controller.signal,
    agent: { id: 'caller', session: { header: { id: 'caller', cwd: '/workspace' } } },
  }) };
}
test('cancellation while awaiting preset resolution prevents create and followup', async () => {
  const h = creation({ abortAt: 'preset' });
  await assert.rejects(h.run(), /aborted/);
  assert.deepEqual(h.calls, { create: 0, attach: 0, detach: 0, dispose: 0, rename: 0, followup: 0 });
});
test('cancellation during authorized create skips attach and disposes returned handle', async () => {
  const h = creation({ abortAt: 'create' });
  await assert.rejects(h.run(), /aborted/);
  assert.deepEqual(h.calls, { create: 1, attach: 0, detach: 0, dispose: 1, rename: 0, followup: 0 });
});
test('cancellation during attach skips title and message, then detaches and disposes', async () => {
  const h = creation({ abortAt: 'attach' });
  await assert.rejects(h.run(), /aborted/);
  assert.deepEqual(h.calls, { create: 1, attach: 1, detach: 1, dispose: 1, rename: 0, followup: 0 });
});
test('cancellation triggered by title update is checked again before followup', async () => {
  const h = creation({ abortAt: 'rename' });
  await assert.rejects(h.run(), /aborted/);
  assert.deepEqual(h.calls, { create: 1, attach: 1, detach: 1, dispose: 1, rename: 1, followup: 0 });
});
test('successful create forwards the signal and still attaches, titles and sends once', async () => {
  const h = creation();
  await h.run();
  assert.deepEqual(h.calls, { create: 1, attach: 1, detach: 0, dispose: 0, rename: 1, followup: 1 });
});
