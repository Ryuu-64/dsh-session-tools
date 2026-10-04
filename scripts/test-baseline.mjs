/** Configure the isolated CI checkout for a previously supported host release. */
import { readFile, writeFile, rm } from 'node:fs/promises';
const version = process.argv[2];
if (!['0.1.5-rc.2', '0.1.5-rc.3', '0.1.6-alpha.1', '0.1.6-alpha.2'].includes(version)) throw new Error('Unknown legacy test baseline');
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
// These APIs were introduced with the 0.2 browser split; their integration
// tests run only on 0.2. Legacy hosts run the legacy navigation contract.
const clientOnly = ['dsh-client-store', 'dsh-client-ui-workspace', 'dsh-client-ui-primitives', 'dsh-api-session-controller', 'dsh-client-ui-renderer', 'dsh-client-ui-layout'];
for (const section of ['devDependencies', 'overrides']) {
  for (const name of Object.keys(pkg[section])) {
    if (clientOnly.includes(name.replace('@deepseek-ai/', ''))) delete pkg[section][name];
    else if (name.startsWith('@deepseek-ai/dsh-')) pkg[section][name] = version;
  }
}
// Read the host's matching published peer constraints via npm resolution.
// 0.1.5/0.1.6 ship against this common Cordis / Loader family.
pkg.devDependencies['@deepseek-ai/cordis'] = '4.0.2';
pkg.devDependencies['@deepseek-ai/cordis-plugin-loader'] = '1.0.3';
pkg.devDependencies['@deepseek-ai/schemastery'] = '3.18.2';
await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');

// Re-resolve a clean legacy graph instead of retaining newer optional peers.
await rm('package-lock.json', { force: true });
