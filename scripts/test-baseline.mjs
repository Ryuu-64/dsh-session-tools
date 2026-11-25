/** Select the newer exact SDK in a disposable test checkout. */
import { readFile, writeFile, rm } from 'node:fs/promises';

const version = process.argv[2];
if (!['0.2.2-rc.3', '0.2.2-rc.5'].includes(version)) throw new Error('Unknown alternate test baseline');

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
for (const dependencies of [pkg.devDependencies, pkg.overrides]) {
  for (const name of Object.keys(dependencies)) {
    if (name.startsWith('@deepseek-ai/dsh-')) dependencies[name] = version;
    if (name.startsWith('@deepseek-ai/cordis-plugin-')) dependencies[name] = '1.1.0';
  }
}
pkg.devDependencies['@deepseek-ai/cordis'] = '4.1.0';
pkg.devDependencies['@deepseek-ai/schemastery'] = '3.19.0';
pkg.devDependencies['@deepseek-ai/dsh-tool-executor-native'] = version;
await writeFile('package.json', JSON.stringify(pkg, null, 2) + '\n');
await rm('package-lock.json', { force: true });
