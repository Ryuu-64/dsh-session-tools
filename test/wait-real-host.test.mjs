/** Real rc.2 Cordis/Loader/Agent/persistence; only the external model is scripted.
 * The isolated host composition follows the Issue #5 test foundation.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { Loader } from '@deepseek-ai/cordis-plugin-loader';
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function host(t) {
  const root = await mkdtemp(join(tmpdir(), 'session-wait-'));
  const ctx = new Context();
  const started = Promise.withResolvers(), targetStarted = Promise.withResolvers(), finish = Promise.withResolvers();
  t.after(async () => { finish.resolve(); await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  const loader = new Loader(ctx, { baseUrl: new URL('../', import.meta.url).href });
  const entries = [
    ['dsh-session'], ['dsh-agent'], ['dsh-session-projection'], ['dsh-system-prompt', {}],
    ['dsh-tools'], ['dsh-llm'], ['dsh-session-persistence-jsonl', { root: join(root, 'sessions') }],
    ['dsh-storage'], ['dsh-storage-json', { root: join(root, 'storage') }],
    ['dsh-storage-domain', { backend: 'json' }], ['dsh-workspace'],
    ['dsh-session-title', { fallbackMaxWords: 8, fallbackMaxBytes: 100, maxTitleBytes: 100 }],
    ['dsh-agent-default-model', { provider: 'fixture', model: 'scripted' }],
    ['dsh-user-approval', { policy: 'ask' }], ['dsh-sandbox-policy'], ['dsh-agent-loop', { agents: [] }],
  ].map(([name, config]) => ({ name: `@deepseek-ai/${name}`, ...(config && { config }) }));
  const configPath = join(root, 'plugins.json');
  await writeFile(configPath, JSON.stringify(entries));
  for (const entry of JSON.parse(await readFile(configPath, 'utf8'))) await loader.create(entry);
  await loader.create({ name: new URL('../lib/index.js', import.meta.url).href });
  await loader.await();
  ctx.on('approval/request', () => 'allowed-once');
  let calls = 0;
  class Model extends LlmAdapter {
    async *stream() {
      if (++calls === 1) started.resolve(); else targetStarted.resolve();
      await finish.promise;
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'independent result' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'independent result' } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  ctx.llm.registerAdapter(['fixture'], new Model());
  const create = id => ctx.agents.create({ sessionId: id, meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'scripted' } });
  return { ctx, create, started, targetStarted, finish };
}

for (const toolName of ['session_create', 'session_send', 'session_wait']) {
  test(`real ${toolName}: cancelled observation leaves target running to its durable result`, { timeout: 15000 }, async t => {
    const h = await host(t);
    const caller = await h.create('caller');
    caller.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'hold caller turn open' }], source: { kind: 'user' } }));
    await h.started.promise;
    const target = toolName === 'session_create' ? undefined : await h.create('target');
    const controller = new AbortController();
    if (toolName === 'session_wait') target.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'synthetic' }], source: { kind: 'user' } }));
    const args = toolName === 'session_create' ? { prompt: 'synthetic', wait: true } : toolName === 'session_send' ? { sessionId: 'target', message: 'synthetic', wait: true } : { sessionId: 'target' };
    const pending = h.ctx.tools.get(toolName).execute(args, { name: toolName, callId: 'fixture', agent: caller.agent, signal: controller.signal });
    await h.targetStarted.promise;
    controller.abort();
    const receipt = await pending;
    assert.equal(receipt.waitStatus, 'callerCancelled');
    const independent = h.ctx.agents.get(receipt.sessionId);
    assert.ok(independent);
    assert.equal(independent.status, 'running');
    h.finish.resolve();
    await independent.whenIdle();
    assert.match(JSON.stringify(independent.session.snapshotEvents()), /independent result/);
    await caller.agent.whenIdle();
    // Flush the host's persistence bindings before asserting durable output.
    await h.ctx.sessionPersistence.flush();
    const reader = await h.ctx.sessionPersistence.open(receipt.sessionId, 'read');
    try { assert.match(JSON.stringify(await reader.read()), /independent result/); }
    finally { await reader.close(); }
  });
}
