import { registerHooks } from 'node:module';
import { readFileSync, appendFileSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const config = JSON.parse(readFileSync(process.env.SHARED_CONTRACTS_BINDING_CONFIG, 'utf8'));
const snapshot = realpathSync(config.snapshot);
const packageJson = JSON.parse(readFileSync(join(snapshot, 'package.json'), 'utf8'));
const inside = path => { const name = relative(snapshot, path); return name !== '..' && !name.startsWith('../') && !isAbsolute(name); };
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const denied = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram', 'child_process', 'worker_threads']);
globalThis.fetch = () => { throw new Error('Offline consumer driver'); };
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (denied.has(specifier.replace(/^node:/, ''))) throw new Error('Offline consumer driver');
    const packageName = '@jevelopers/shared-contracts';
    if (specifier === packageName || specifier.startsWith(packageName + '/')) {
      const key = specifier === packageName ? '.' : '.' + specifier.slice(packageName.length);
      let target = packageJson.exports[key]?.import ?? packageJson.exports[key];
      if (!target) for (const [pattern, value] of Object.entries(packageJson.exports)) {
        if (pattern.endsWith('/*') && key.startsWith(pattern.slice(0, -1))) target = value.replace('*', key.slice(pattern.length - 1));
      }
      if (typeof target !== 'string') throw new Error('Unknown package export');
      const path = realpathSync(join(snapshot, target));
      if (!inside(path)) throw new Error('Package import escaped verified snapshot');
      return nextResolve(pathToFileURL(path).href, context);
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (!url.startsWith('file:')) return loaded;
    const path = realpathSync(fileURLToPath(url));
    if (!inside(path)) return loaded;
    const name = relative(snapshot, path).split('\\').join('/');
    const bytes = readFileSync(path);
    if (hash(bytes) !== config.files[name]) throw new Error('Imported package bytes differ from tested pin');
    appendFileSync(config.audit, JSON.stringify({ kind: 'import', path: name, sha256: config.files[name] }) + '\n');
    if (name !== 'tooling/fixture-harness.mjs') return loaded;
    const original = bytes.toString('utf8');
    const marker = 'export function runCanonicalFixtures(';
    if (!original.includes(marker)) throw new Error('Fixture API instrumentation mismatch');
    const extra = `
import { readFileSync as __fixtureRead, appendFileSync as __fixtureAppend } from 'node:fs';
import { hashManifest as __fixtureHash } from './runtime.mjs';
export function runCanonicalFixtures(contract, manifest) {
  const result = __observedRunCanonicalFixtures(contract, manifest);
  if (${JSON.stringify(config.required)}.includes(contract)) {
    const expected = JSON.parse(__fixtureRead(new URL('../fixtures/' + contract + '.json', import.meta.url), 'utf8'));
    __fixtureAppend(${JSON.stringify(config.audit)}, JSON.stringify({
      kind: 'fixture_run', contract, bound: __fixtureHash(manifest) === __fixtureHash(expected),
      failures: result.failures.length, positive: result.records.filter(row => row.expected.ok).length,
      negative: result.records.filter(row => !row.expected.ok).length,
      semantic: result.records.some(row => ['semantic', 'research_creative', 'commerce_evidence'].includes(row.mode)) ? 1 : 0
    }) + '\\n');
  }
  return result;
}
`;
    return { ...loaded, source: original.replace(marker, 'function __observedRunCanonicalFixtures(') + extra };
  }
});
