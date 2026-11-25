// Reconstruct and package the reviewed companion host; this is build tooling, not a test fixture.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const [mode, checkoutArg, outputArg] = process.argv.slice(2);
const checkout = path.resolve(checkoutArg);
const output = path.resolve(outputArg);
const source = JSON.parse(fs.readFileSync(new URL('./host/source.json', import.meta.url)));
const patch = fs.readFileSync(new URL('./host/native-reading.patch', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', ['-C', checkout, ...args], { encoding: 'utf8' }).trim();
assert.equal(hash(patch), source.patchSha256, 'companion patch changed');
fs.mkdirSync(output, { recursive: true });

if (mode === 'apply') {
  assert.equal(git('rev-parse', 'HEAD'), source.base, 'wrong official host base');
  assert.equal(git('status', '--porcelain'), '', 'host checkout must be clean');
  execFileSync('git', ['-C', checkout, 'apply', '--index', '-'], { input: patch });
} else {
  assert.equal(mode, 'pack', 'expected apply or pack');
}
assert.equal(git('write-tree'), source.tree, 'reconstructed host tree differs from reviewed candidate');
for (const [file, expected] of Object.entries(source.files)) {
  assert.equal(hash(fs.readFileSync(path.join(checkout, file))), expected.sha256, `host source changed: ${file}`);
  assert.equal(git('rev-parse', `:${file}`), expected.blob, `host index changed: ${file}`);
}
fs.writeFileSync(path.join(output, 'host-source.json'), JSON.stringify(source, null, 2));

if (mode === 'pack') {
  const packages = {};
  for (const suffix of ['ui-chat', 'ui-sidebar-right', 'ui-subagent']) {
    const name = `@deepseek-ai/dsh-client-${suffix}`;
    execFileSync(process.execPath, [path.join(checkout, 'node_modules/pnpm/bin/pnpm.cjs'), '--filter', name, 'pack', '--pack-destination', output], { cwd: checkout, stdio: 'inherit' });
    const tarball = path.join(output, `deepseek-ai-dsh-client-${suffix}-0.2.0-rc.2.tgz`);
    const metadata = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json']));
    assert.equal(metadata.name, name);
    assert.equal(metadata.version, '0.2.0-rc.2');
    const client = execFileSync('tar', ['-xOf', tarball, 'package/lib/client.js']);
    assert.equal(hash(client), hash(fs.readFileSync(path.join(checkout, 'packages/client', suffix, 'lib/client.js'))));
    packages[name] = { tarball, sha256: hash(fs.readFileSync(tarball)), clientSha256: hash(client) };
  }
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ base: source.base, head: source.head, tree: source.tree, packages }, null, 2));
}
