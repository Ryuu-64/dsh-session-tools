import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Published DSH peers sometimes admit later prereleases. A passing runtime
// suite on a mixed graph must never count as validation of a pinned baseline.
test('every installed DSH package belongs to the selected SDK baseline', async () => {
  const root = new URL('../', import.meta.url);
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
  const baseline = pkg.devDependencies['@deepseek-ai/dsh-agent'];
  let count = 0;
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.includes('/@deepseek-ai/dsh-')) continue;
    count++;
    assert.equal(entry.version, baseline, `${path} resolved outside ${baseline}`);
    const installed = JSON.parse(await readFile(new URL(`${path}/package.json`, root), 'utf8'));
    assert.equal(installed.version, baseline, `${path} installed outside ${baseline}`);
  }
  assert.ok(count > 0, 'a real host dependency graph is required');
});
