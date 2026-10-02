import { Context } from '@deepseek-ai/cordis';
import { Loader } from '@deepseek-ai/cordis-plugin-loader';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import YAML from 'yaml';

/** Only the external model boundary is replaced; every host service is real. */
export class ScriptedModel extends LlmAdapter {
  requests = [];
  scripts = [];
  async *stream(options) {
    this.requests.push(options);
    const script = this.scripts.shift();
    if (!script) throw new Error('Unexpected model request');
    yield* script(options);
  }
  tool(name, args, id = 'fixture-call') {
    this.scripts.push(async function* () {
      const block = { type: 'tool-call', id, name, arguments: JSON.stringify(args) };
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield { type: 'block-end', index: 0, block };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    });
  }
  text(text) {
    this.scripts.push(async function* () {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text };
      yield { type: 'block-end', index: 0, block: { type: 'text', text } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    });
  }
}

export async function realHost(t, { pluginPath = new URL('../../lib/index.js', import.meta.url).href } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'session-tools-host-'));
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  const loader = new Loader(ctx, { baseUrl: new URL('../../', import.meta.url).href });
  const model = new ScriptedModel();
  const entries = [
    ['dsh-session'], ['dsh-agent'], ['dsh-session-projection'],
    ['dsh-system-prompt', {}], ['dsh-tools'], ['dsh-llm'],
    ['dsh-session-persistence-jsonl', { root: join(root, 'sessions') }],
    ['dsh-storage'], ['dsh-storage-json', { root: join(root, 'storage') }],
    ['dsh-storage-domain', { backend: 'json' }], ['dsh-workspace'],
    ['dsh-session-title', { fallbackMaxWords: 8, fallbackMaxBytes: 100, maxTitleBytes: 100 }],
    ['dsh-agent-default-model', { provider: 'fixture', model: 'scripted' }],
    ['dsh-user-approval', { policy: 'ask' }], ['dsh-sandbox-policy'],
    ['dsh-agent-loop', { agents: [] }],
  ].map(([name, config]) => ({ name: `@deepseek-ai/${name}`, ...(config && {config}) }));
  entries.push({ name: pluginPath });
  // A file-backed test-only composition exercises Loader module resolution,
  // export normalization, dependency injection and configuration validation.
  const configFile = join(root, 'cordis.yml');
  await writeFile(configFile, YAML.stringify(entries));
  for (const entry of YAML.parse(await readFile(configFile, 'utf8'))) await loader.create(entry);
  await loader.await();
  ctx.llm.registerAdapter(['fixture'], model);
  const workspace = await ctx.workspaceRegistry.create(root, 'Isolated fixture');
  const createAgent = async (id) => ctx.agents.create({ sessionId: id, meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'scripted' } });
  return { ctx, loader, model, root, workspace, createAgent };
}
