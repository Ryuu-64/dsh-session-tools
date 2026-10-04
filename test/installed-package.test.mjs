import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const exec = promisify(execFile);
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));

test('clean npm consumer installs the packed artifact without peer bypass or source links', { timeout: 120000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'session-tools-installed-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, npm_config_cache: process.env.npm_config_cache ?? join(sourceRoot, 'node_modules/.cache/npm') };
  const pkg = JSON.parse(await readFile(join(sourceRoot, 'package.json'), 'utf8'));
  const { stdout } = await exec('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', root], { cwd: sourceRoot, env });
  const [packed] = JSON.parse(stdout);
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'installed-plugin-regression', private: true, type: 'module',
    // Pin the consumer's host SDK. These are host dependencies, not bundled
    // plugin code; npm must resolve the plugin's published peer contract.
    dependencies: { ...pkg.devDependencies, [pkg.name]: `file:${join(root, packed.filename)}` }, overrides: pkg.overrides,
  }));
  await exec('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: root, env, maxBuffer: 4 * 1024 * 1024 });
  await exec('npm', ['ls', '--all'], { cwd: root, env, maxBuffer: 4 * 1024 * 1024 });
  const installed = JSON.parse(await readFile(join(root, 'node_modules/@ryuu-64/dsh-session-tools/package.json'), 'utf8'));
  assert.deepEqual(installed.peerDependencies, pkg.peerDependencies);
  assert.ok(installed.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-workspace'));
  assert.ok(!installed.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'));
  await mkdir(join(root, 'test/helpers'), { recursive: true });
  for (const file of ['real-host.mjs', 'installed-probe.mjs', 'client-rc2.mjs']) await copyFile(join(sourceRoot, 'test/helpers', file), join(root, 'test/helpers', file));
  const childEnv = { ...env };
  delete childEnv.NODE_TEST_CONTEXT;
  const probe = await exec(process.execPath, ['--test', '--test-reporter=tap', 'test/helpers/installed-probe.mjs'], { cwd: root, env: childEnv });
  assert.match(probe.stdout, /pass 1/);
});
