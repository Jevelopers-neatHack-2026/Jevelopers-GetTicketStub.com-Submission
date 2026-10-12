import { registerHooks } from 'node:module';
import { readFileSync, realpathSync } from 'node:fs';
import { join, relative, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const config = JSON.parse(readFileSync(process.env.SHARED_CONTRACTS_BINDING_CONFIG, 'utf8'));
const snapshot = realpathSync(config.snapshot);
const packageJson = JSON.parse(readFileSync(join(snapshot, 'package.json'), 'utf8'));
const inside = path => { const name = relative(snapshot, path); return name !== '..' && !name.startsWith('../') && !isAbsolute(name); };
const hash = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const denied = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram', 'child_process', 'worker_threads', 'inspector', 'inspector/promises']);
const offline = () => { throw new Error('Offline consumer driver'); };
globalThis.fetch = offline;
globalThis.WebSocket = class { constructor() { offline(); } };
const getBuiltinModule = process.getBuiltinModule.bind(process);
process.getBuiltinModule = specifier => {
  if (typeof specifier === 'string' && denied.has(specifier.replace(/^node:/, ''))) offline();
  return getBuiltinModule(specifier);
};
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
    return loaded;
  }
});
