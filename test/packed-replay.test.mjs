import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { realHost } from './helpers/real-host.mjs';

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
  h.model.tool('session_create', { prompt: 'synthetic packed child', wait: true });
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
  const result = resultEvent.data.message.content.find(block => block.type === 'tool-result');
  assert.equal(result.isError, false);
  assert.match(JSON.stringify(result.content), new RegExp(childId));

  let client;
  const globals = { window: { __ModuleLoader__: { load(definition) {
    assert.equal(definition.id, pkg.name);
    client = definition.factory(name => {
      assert.equal(name, 'react');
      return React;
    });
  } } } };
  vm.runInNewContext(await readFile(join(root, 'package', pkg.exports['./client']), 'utf8'), globals);
  assert.ok(client);
  const slots = new SlotCore();
  const removeOwner = slots.register({ name: 'root', children: { 'tool.call.toolview': { kind: 'keyed', scope: 'session' } } }, () => null);
  t.after(removeOwner);
  const opened = [];
  // Minimal browser wiring around the actual rc.2 slot registry. The plugin
  // uses no DOM APIs; React renders its real component below without a browser.
  const disposers = [];
  client.apply({
    slots: {
      inject(name, register) { assert.ok(slots.spec(name)); disposers.push(register()); },
      register: (options, component) => slots.register(options, component),
    },
    sessions: { open: id => opened.push(id) },
  });
  t.after(() => disposers.forEach(dispose => dispose()));
  const [registered] = slots.entriesOfSlot('tool.call.toolview');
  assert.equal(registered.options.key, 'session_create');
  // Same durable content blocks as a settled tool-call owner. Nothing relies
  // on ephemeral result.value, which ToolRuntime does not persist.
  const props = { block: { content: result.content }, slot: { injected: registered.inject() } };
  const html = renderToStaticMarkup(React.createElement(registered.component, props));
  assert.match(html, /已创建会话/);
  assert.match(html, new RegExp(childId));
  assert.doesNotMatch(html, /disabled=""/);
  const tree = registered.component(props);
  const button = React.Children.toArray(tree.props.children).find(child => child?.type === 'button');
  button.props.onClick();
  assert.deepEqual(opened, [childId]);
  const malformed = registered.component({ block: { content: [] }, slot: props.slot });
  const disabled = React.Children.toArray(malformed.props.children).find(child => child?.type === 'button');
  assert.equal(disabled.props.disabled, true);
  disabled.props.onClick();
  assert.deepEqual(opened, [childId], 'missing durable identity must not navigate');
});
