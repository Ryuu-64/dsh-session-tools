// Real official Web-host bootstrap acceptance using only a temporary empty profile.
// This does not claim the synthetic-history or Desktop layers have passed.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { seedHistory, exercise } from './browser-scenarios.mjs';
const createRedactor = secrets => value => { let text = String(value); for (const secret of secrets) text = text.split(secret).join('[redacted]'); return text.replace(/([?&]token=)[^\s&]+/g, '$1[redacted]'); };
const npmCommand = args => ({ command: 'npm', args });
const secrets = new Set();
const redact = createRedactor(secrets);

const [version, artifactArg, outputArg, hostArtifactsArg] = process.argv.slice(2);
const versions = Object.keys(JSON.parse(fs.readFileSync(new URL('./vendor-versions.json', import.meta.url))));
assert.ok(versions.includes(version), 'use an explicit acceptance target');
const artifact = path.resolve(artifactArg);
const output = path.resolve(outputArg);
fs.mkdirSync(output, { recursive: true });
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hostArtifacts = hostArtifactsArg ? JSON.parse(fs.readFileSync(path.resolve(hostArtifactsArg))) : null;
const candidateBundles = new Map();
if (hostArtifacts) {
  assert.equal(version, '0.2.0-rc.2', 'local host artifacts require the researched RC2 base');
  assert.equal(hostArtifacts.base, '639ed015397290b3745d163aafe02ffee4aa3f84');
  assert.deepEqual(Object.keys(hostArtifacts.packages).sort(), ['@deepseek-ai/dsh-client-ui-chat', '@deepseek-ai/dsh-client-ui-sidebar-right', '@deepseek-ai/dsh-client-ui-subagent']);
  for (const [name, item] of Object.entries(hostArtifacts.packages)) {
    assert.ok(path.isAbsolute(item.tarball), 'host tarball path must be absolute');
    assert.equal(digest(fs.readFileSync(item.tarball)), item.sha256, `host artifact changed: ${name}`);
    const bundle = execFileSync('tar', ['-xOf', item.tarball, 'package/lib/client.js']);
    assert.equal(digest(bundle), item.clientSha256, `host bundle changed: ${name}`);
    candidateBundles.set(name, bundle);
  }
  fs.writeFileSync(path.join(output, 'host-artifacts.json'), JSON.stringify(hostArtifacts, null, 2));
}
const hash = () => createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
const artifactSha256 = hash();
const run = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP || '/tmp', 'session-tools-return-web-'));
const discovery = path.join(run, 'discovery');
const runtime = path.join(run, 'runtime');
const home = path.join(run, 'home');
const workspace = path.join(run, 'workspace');

const queryPath = path.join(run, 'content-index.sqlite');
for (const dir of [discovery, runtime, home]) fs.mkdirSync(dir, { recursive: true });
const manifest = { name: 'session-tools-return-synthetic-acceptance', private: true, type: 'module', dependencies: { '@deepseek-ai/dsh': version } };
const env = { ...process.env };
// Never inherit a developer's DSH home, skill roots, or model credentials.
// The fixture's Node/npm children need only public-registry access.
for (const name of Object.keys(env)) {
  if (name.startsWith('DSH_') || /(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name)) delete env[name];
}
Object.assign(env, {
  HOME: home,
  XDG_DATA_HOME: path.join(home, '.local/share'),
  XDG_CACHE_HOME: path.join(home, '.cache'),
  XDG_CONFIG_HOME: path.join(home, '.config'),
  DSH_HOME: path.join(home, '.dsh'),
  DSH_AGENTS_HOME: path.join(home, '.agents'),
  DSH_BUNDLED_SKILL_DIR: path.join(home, '.bundled-skills'),
  npm_config_ignore_scripts: 'true',
  npm_config_cache: path.join(process.env.RUNNER_TEMP || '/tmp', 'session-tools-return-registry-cache'),
  npm_config_registry: 'https://registry.npmjs.org',
  npm_config_userconfig: path.join(home, '.npmrc'),
});
function npmInstall(dir, filename) {
  const log = fs.openSync(path.join(output, filename), 'w');
  const npm = npmCommand(['install', '--ignore-scripts', '--strict-peer-deps', '--no-audit', '--no-fund']);
  try { execFileSync(npm.command, npm.args, { cwd: dir, env, stdio: ['ignore', log, log], timeout: 600_000 }); }
  finally { fs.closeSync(log); }
}
// Resolve the target's official dependency graph from metadata, without first
// installing a drifting caret graph or relaxing its peers. Exact non-DSH peer
// pins (e.g. Cordis Loader) are preserved as declared by the target packages.
const seen = new Set(['@deepseek-ai/dsh']);
let queue = ['@deepseek-ai/dsh'];
// Each pin comes from vendor/*/package.json at that exact official release tag.
const vendorVersions = JSON.parse(fs.readFileSync(new URL('./vendor-versions.json', import.meta.url)))[version];
assert.ok(vendorVersions, 'vendor baseline must be researched for this target');
const overrides = { ...vendorVersions };
const manifests = {};
while (queue.length) {
  const batch = queue.splice(0, 12);
  const records = await Promise.all(batch.map(name => new Promise((resolve, reject) => {
    const npm = npmCommand(['view', `${name}@${version}`, '--json']);
    const child = spawn(npm.command, npm.args, { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);
    child.on('error', reject);
    child.on('exit', code => {
      if (code !== 0) reject(new Error(`metadata ${name}@${version}: ${stderr}`));
      else { try { resolve([name, JSON.parse(stdout)]); } catch (error) { reject(error); } }
    });
  })));
  for (const [name, record] of records) {
    assert.equal(record.version, version, `registry target ${name}`);
    manifests[name] = { version: record.version, dependencies: record.dependencies, peerDependencies: record.peerDependencies };
    if (name !== '@deepseek-ai/dsh') overrides[name] = version;
    for (const dependency of Object.keys({ ...record.dependencies, ...record.optionalDependencies, ...record.peerDependencies })) {
      if (dependency.startsWith('@deepseek-ai/dsh-') && !seen.has(dependency)) { seen.add(dependency); queue.push(dependency); }
    }
    for (const [dependency, range] of Object.entries(record.peerDependencies || {})) {
      if (dependency.startsWith('@deepseek-ai/') && !dependency.startsWith('@deepseek-ai/dsh') && /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(range)) {
        if (overrides[dependency]) assert.equal(overrides[dependency], range, `conflicting official peer pins: ${dependency}`);
        overrides[dependency] = range;
      }
    }
  }
}
manifest.overrides = overrides;
for (const [name, item] of Object.entries(hostArtifacts?.packages || {})) {
  manifest.dependencies[name] = `file:${item.tarball}`;
  overrides[name] = `file:${item.tarball}`;
}
fs.writeFileSync(path.join(output, 'target-manifests.json'), JSON.stringify(manifests, null, 2));
fs.writeFileSync(path.join(runtime, 'package.json'), JSON.stringify(manifest));
npmInstall(runtime, 'exact-install.log');
const runtimeRequire = createRequire(path.join(runtime, 'node_modules/@deepseek-ai/dsh/package.json'));
const exactLockText = fs.readFileSync(path.join(runtime, 'package-lock.json'), 'utf8');
fs.writeFileSync(path.join(output, 'runtime-lock.json'), exactLockText);
const exactLock = JSON.parse(exactLockText);
const observed = {};
for (const location of Object.keys(exactLock.packages)) {
  const packageName = location.split('node_modules/').at(-1);
  const isDsh = packageName === '@deepseek-ai/dsh' || packageName.startsWith('@deepseek-ai/dsh-');
  if (!isDsh && !vendorVersions[packageName]) continue;
  const file = path.join(runtime, location, 'package.json');
  if (!fs.existsSync(file)) continue; // npm may record an uninstalled optional platform package.
  observed[location] = JSON.parse(fs.readFileSync(file)).version;
  assert.equal(observed[location], isDsh ? version : vendorVersions[packageName], `version drift: ${location}`);
}
for (const name of ['dsh-client-ui-chat', 'dsh-client-ui-conversation', 'dsh-api-session-controller', 'dsh-client-ui-renderer', 'dsh-client-ui-session', 'dsh-app-boot']) {
  const file = runtimeRequire.resolve(`@deepseek-ai/${name}/package.json`);
  assert.equal(JSON.parse(fs.readFileSync(file)).version, version, `required host package ${name}`);
}
fs.writeFileSync(path.join(output, 'host-versions.json'), JSON.stringify(observed, null, 2));
const bin = runtimeRequire.resolve('@deepseek-ai/dsh/package.json').replace(/package.json$/, 'lib/bin.js');
const installLog = fs.openSync(path.join(output, 'plugin-install.log'), 'w');
try {
  execFileSync(process.execPath, [bin, 'plugin', '--profile', 'web', 'add', artifact, '--ignore-scripts'], { cwd: runtime, env, stdio: ['ignore', installLog, installLog], timeout: 300_000 });
} finally { fs.closeSync(installLog); }
const installedHost = {};
for (const [name, bundle] of candidateBundles) {
  const installed = runtimeRequire.resolve(`${name}/client`);
  const sha256 = digest(fs.readFileSync(installed));
  assert.equal(sha256, digest(bundle), `profile installation replaced candidate: ${name}`);
  installedHost[name] = { path: installed, sha256 };
}
fs.writeFileSync(path.join(output, 'installed-host-artifacts.json'), JSON.stringify(installedHost, null, 2));
assert.equal(hash(), artifactSha256);
const seeded = await seedHistory(runtimeRequire, home, workspace);
const patch = path.join(home, '.dsh/profiles/web/cordis.patch.yml');
fs.writeFileSync(patch, JSON.stringify([
  { id: 'session-title-llm', disabled: true },
  { id: 'session-query-sqlite', config: { path: queryPath, openAt: 'first-search' } },
  { id: 'ui-chat', config: { transcriptView: 'verbose' } },
]));
let serverLog = '';
const server = spawn(process.execPath, [bin, '--profile', 'web', '--no-open', '--host', '127.0.0.1', '--port', '4195'], { cwd: workspace, env });
server.stdout.on('data', data => serverLog += data);
server.stderr.on('data', data => serverLog += data);
let browser, context, page;
const errors = [], consoleErrors = [];
const report = { version, artifactSha256, bootstrap: 'pending', readingReturn: 'not-run', seeds: seeded };
const receivedBundles = new Set();
const responses = [];
const prepareBundle = bytes => {
  let source = bytes.toString('utf8').replace(/(?:\r?\n)?\/\/# sourceURL=([^\r\n]+)(?:\r?\n)?$/, '').replace(/(?:\r?\n)?\/\/# sourceMappingURL=[^\r\n]*(?:\r?\n)?$/, '');
  return source.endsWith('\n') ? source : `${source}\n`;
};
try {
  let url;
  for (let elapsed = 0; elapsed < 180; elapsed++) {
    url = serverLog.match(/http:\/\/127\.0\.0\.1:4195\/\?token=[^\s]+/)?.[0];
    if (url) break;
    assert.equal(server.exitCode, null, 'host exited before startup');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(url, 'host startup did not provide its temporary local URL');
  secrets.add(new URL(url).searchParams.get('token'));
  let ready = false;
  for (let elapsed = 0; elapsed < 60; elapsed++) {
    assert.equal(server.exitCode, null, 'host exited after announcing its URL');
    try { const response = await fetch(new URL('/', url), { redirect: 'manual' }); if ([200,401].includes(response.status)) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready, 'host did not become HTTP-ready');
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  report.browserVersion = browser.version();
  context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'en-US' });
  page = await context.newPage();
  page.on('response', response => {
    if (!new URL(response.url()).pathname.startsWith('/plugins/')) return;
    responses.push((async () => {
      const body = await response.body();
      const source = body.toString('utf8');
      for (const [name, bundle] of candidateBundles) {
        if (!source.includes(prepareBundle(bundle))) continue;
        receivedBundles.add(name);
        const filename = `loaded-${name.split('/').at(-1)}.js`;
        fs.writeFileSync(path.join(output, filename), body);
        installedHost[name].response = { path: new URL(response.url()).pathname, sha256: digest(body), filename };
      }
    })().catch(error => { errors.push(`candidate host response: ${error.message}`); }));
  });
  await page.addInitScript(() => {
    const events = []; window.__readingReturnInput = events;
    for (const type of ['click', 'keydown']) window.addEventListener(type, event => {
      if (type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
      const button = event.target?.closest?.('button');
      if (!button || !button.textContent.includes('RETURN_')) return;
      const record = { type, trusted: event.isTrusted, label: button.textContent, source: button.dataset.sessionToolsSource, disabled: button.disabled, key: event.key };
      events.push(record); if (events.length > 30) events.shift();
      queueMicrotask(() => { record.defaultPrevented = event.defaultPrevented; });
    }, true);
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(url, { waitUntil: 'load' });
  const notice = page.getByText(/^(Internal Testing Notice|Preview Notice)$/);
  await notice.waitFor({ state: 'visible', timeout: 30000 });
  assert.equal(await page.getByRole('checkbox').count(), 0, 'unexpected consent control');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  const later = page.getByRole('button', { name: 'Configure later', exact: true });
  await later.waitFor({ state: 'visible', timeout: 30000 }); await later.click();
  report.bootstrap = 'passed';
  report.scenarios = await exercise(page, browser, url, output);
  await Promise.all(responses);
  assert.deepEqual([...receivedBundles].sort(), [...candidateBundles.keys()].sort(), 'browser did not load every candidate host bundle');
  assert.deepEqual(errors, [], 'unhandled browser errors');
  report.readingReturn = 'passed';
} catch (error) {
  report.error = redact(error);
  report.browserErrors = errors.map(redact);
  report.consoleErrors = consoleErrors.map(redact);
  report.readingReturn = 'failed';
  if (page) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    report.domScope = await page.evaluate(() => ({
      input: window.__readingReturnInput,
      slots: [...new Set([...document.querySelectorAll('[data-slot]')].map(x => x.dataset.slot))],
      mainCount: document.querySelectorAll('[data-slot="main"]').length,
      contents: [...document.querySelectorAll('[data-conversation-content]')].map(x => ({
        sessionId: x.dataset.conversationSession, connected: x.isConnected,
        main: !!x.closest('[data-slot="main"]'), chat: !!x.querySelector('[data-chat-flow]'),
      })),
      returnControls: [...document.querySelectorAll('[data-session-tools-return]')].map(x => ({ text: x.textContent, main: !!x.closest('[data-slot="main"]'), phase: x.dataset.returnPhase, reason: x.dataset.returnReason, message: x.dataset.returnMessage })),
      activeElement: { tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.slice(0,100) },
    })).catch(() => null);
    fs.writeFileSync(path.join(output, 'failure-dom.txt'), redact(await page.locator('body').innerText().catch(() => 'unavailable')));
  }
  process.exitCode = 1;
} finally {
  try { await context?.close(); } finally { await browser?.close(); }
  server.kill('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 500));
  if (server.exitCode === null) server.kill('SIGKILL');
  fs.writeFileSync(path.join(output, 'server.log'), redact(serverLog));
  fs.writeFileSync(path.join(output, 'installed-host-artifacts.json'), JSON.stringify(installedHost, null, 2));
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
