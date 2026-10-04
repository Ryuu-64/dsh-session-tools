import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { realHost } from './helpers/real-host.mjs';
import { resultNode, sessionCard, toolResult } from './helpers/session-card.mjs';

const exec = promisify(execFile);
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));

test('npm tarball loads through Loader and its client replays a durable creation result', { timeout: 20000 }, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'session-tools-packed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { stdout } = await exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], {
    cwd: sourceRoot, env: { ...process.env, npm_config_cache: join(root, 'npm-cache') },
  });
  const [packed] = JSON.parse(stdout);
  assert.ok(packed.files.some(file => file.path === 'lib/client.js'));
  assert.ok(packed.files.some(file => file.path === 'cordis.patch.yml'));
  assert.ok(!packed.files.some(file => file.path.startsWith('test/')));
  await exec('tar', ['-xzf', join(root, packed.filename), '-C', root]);
  // Host-provided peers remain outside the artifact, exactly as for a plugin
  // install. No source lib is available through this extracted package path.
  await symlink(join(sourceRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
  const pkg = JSON.parse(await readFile(join(root, 'package/package.json'), 'utf8'));
  const entryUrl = pathToFileURL(join(root, 'package', pkg.exports['.'])).href;
  const exported = await import(entryUrl);
  assert.equal('default' in exported, false);
  assert.deepEqual([...exported.inject], ['tools', 'agents', 'sessionTitle', 'workspaceRegistry', 'agentDefaultModel']);
  const h = await realHost(t, { pluginPath: entryUrl });
  assert.equal(h.loader.unwrapExports(exported).apply, exported.apply);
  h.ctx.on('approval/request', () => 'allowed-once');
  const title = 'Discuss session-11111111-1111-1111-1111-111111111111';
  h.model.tool('session_create', { prompt: 'synthetic packed child', title, wait: true });
  h.model.text('packed child answer');
  h.model.text('packed caller answer');
  const caller = await h.createAgent('packed-caller');
  caller.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'packed test' }] }));
  await caller.agent.whenIdle();
  const childId = (await h.ctx.sessionPersistence.list()).find(row => row.header.id !== 'packed-caller').header.id;
  await caller.dispose();
  const reader = await h.ctx.sessionPersistence.open('packed-caller', 'read');
  let events;
  try { events = (await reader.read()).events; } finally { await reader.close(); }
  const resultEvent = events.find(event => event.type === 'tool/result');
  assert.ok(resultEvent, 'read the result from JSONL, not an in-memory tool return');
  const result = toolResult(resultEvent);
  assert.notEqual(result.isError, true);
  assert.match(JSON.stringify(result.content), new RegExp(childId));

  assert.deepEqual(resultEvent.data.meta, { sessionId: childId, title });
  const card = await sessionCard(t, { path: join(root, 'package', pkg.exports['./client']) });
  const { html, button } = card.render(resultNode(resultEvent));
  assert.match(html, /已创建会话/);
  assert.match(html, new RegExp(childId));
  assert.doesNotMatch(html, /disabled=""/);
  button.props.onClick();
  button.props.onClick();
  assert.deepEqual(card.opened, [childId, childId]);
  const legacy = card.render({ ...resultNode(resultEvent), meta: undefined });
  assert.equal(legacy.button, undefined);
  assert.match(legacy.html, /Created session:/);
  assert.deepEqual(card.opened, [childId, childId], 'legacy text alone must not navigate');
});
