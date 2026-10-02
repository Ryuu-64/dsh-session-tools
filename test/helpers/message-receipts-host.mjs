import { Context } from '@deepseek-ai/cordis';
import { Loader } from '@deepseek-ai/cordis-plugin-loader';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ScriptedModel } from './real-host.mjs';

export const user = text => createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] });
export async function* textChunks(text) {
  yield { type: 'block-start', index: 0, blockType: 'text' };
  yield { type: 'text-delta', index: 0, text };
  yield { type: 'block-end', index: 0, block: { type: 'text', text } };
  yield { type: 'finish', reason: { kind: 'stop' } };
}
export function gate() {
  const pending = Promise.withResolvers();
  return {
    release: pending.resolve,
    async wait(signal) {
      const aborted = Promise.withResolvers();
      const stop = () => aborted.resolve();
      signal?.addEventListener('abort', stop, { once: true });
      try { if (!signal?.aborted) await Promise.race([pending.promise, aborted.promise]); }
      finally { signal?.removeEventListener('abort', stop); }
    },
  };
}

/** Official rc.2 host with restartable, workspace-local JSONL storage. */
export async function receiptHost(t) {
  const root = await mkdtemp(join(process.cwd(), '.receipt-host-'));
  const contexts = [], gates = [];
  t.after(async () => {
    for (const g of gates) g.release();
    for (const ctx of contexts.reverse()) await ctx.fiber.dispose();
    await rm(root, { recursive: true, force: true });
  });
  const start = async () => {
    const ctx = new Context(); contexts.push(ctx);
    const loader = new Loader(ctx, { baseUrl: new URL('../../', import.meta.url).href });
    const entries = [
      ['dsh-session'], ['dsh-agent'], ['dsh-session-projection'], ['dsh-system-prompt', {}],
      ['dsh-tools'], ['dsh-llm'], ['dsh-session-persistence-jsonl', { root: join(root, 'sessions') }],
      ['dsh-storage'], ['dsh-storage-json', { root: join(root, 'storage') }],
      ['dsh-storage-domain', { backend: 'json' }], ['dsh-workspace'],
      ['dsh-session-title', { fallbackMaxWords: 8, fallbackMaxBytes: 100, maxTitleBytes: 100 }],
      ['dsh-agent-default-model', { provider: 'fixture', model: 'scripted' }],
      ['dsh-user-approval', { policy: 'ask' }], ['dsh-sandbox-policy'], ['dsh-agent-loop', { agents: [] }],
    ].map(([name, config]) => ({ name: `@deepseek-ai/${name}`, ...(config && { config }) }));
    const configFile = join(root, 'plugins.json');
    await writeFile(configFile, JSON.stringify(entries));
    for (const entry of JSON.parse(await readFile(configFile, 'utf8'))) await loader.create(entry);
    await loader.create({ name: new URL('../../lib/index.js', import.meta.url).href });
    await loader.await();
    const model = new ScriptedModel(); ctx.llm.registerAdapter(['fixture'], model);
    ctx.on('approval/request', () => 'allowed-once');
    const create = id => ctx.agents.create({ sessionId: id, meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'scripted' } });
    const holdCaller = async (id = 'caller') => {
      const started = Promise.withResolvers(), hold = gate(); gates.push(hold);
      model.scripts.push(async function* (options) { started.resolve(); await hold.wait(options.signal); yield* textChunks('caller done'); });
      const caller = await create(id); caller.agent.followup(user('hold caller')); await started.promise;
      return { caller, release: hold.release, exec: { name: 'receipt-fixture', callId: 'call', agent: caller.agent, signal: new AbortController().signal } };
    };
    const read = async id => {
      const reader = await ctx.sessionPersistence.open(id, 'read');
      try { return { ...await reader.read(), header: reader.header, inheritedEventCount: reader.inheritedEventCount }; }
      finally { await reader.close(); }
    };
    return { ctx, model, create, holdCaller, read, root, restart: async () => { await ctx.fiber.dispose(); return start(); } };
  };
  return start();
}
