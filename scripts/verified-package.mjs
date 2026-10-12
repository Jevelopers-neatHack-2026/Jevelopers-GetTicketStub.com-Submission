// Gatekeeper for loading the shared-contracts package. Imports nothing from the package.
//  (a) refuse to run when any node_modules directory exists anywhere in the repo other than the verified root one,
//      because Node resolves bare specifiers from the importer's directory and such a directory would shadow it;
//  (b) import only by an absolute file URL whose realpath is inside the package root that package-verify.mjs checked.
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyInstalledPackage } from './package-verify.mjs';

const SKIP = new Set(['.git', '.shared-contracts', 'dist', 'artifacts', 'test-results', 'playwright-report', '.entire']);
export function findShadowNodeModules(root) {
  const found = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.name === 'node_modules') { if (directory !== root) found.push(relative(root, path).split(sep).join('/')); continue; }
      if (entry.isDirectory() && !(directory === root && SKIP.has(entry.name))) walk(path);
    }
  };
  walk(root);
  return found;
}

/** Returns a failure message or null. Verifies the root copy, then proves nothing else can shadow it. */
export function checkPackageResolution(root) {
  const pin = JSON.parse(readFileSync(join(root, 'contracts/shared-contracts.pin.json'), 'utf8'));
  const snapshot = join(root, 'node_modules/@jevelopers/shared-contracts');
  try { lstatSync(snapshot); } catch { return 'shared-contracts is not provisioned; run `npm run contracts:provision`'; }
  const shadows = findShadowNodeModules(root);
  if (shadows.length) return 'node_modules directory could shadow the verified package: ' + shadows[0];
  return verifyInstalledPackage(snapshot, pin, root);
}

/**
 * `resolved` is what the importing file's own `import.meta.resolve(specifier)` returned. It must be a file URL inside the
 * verified package root; only then is it imported (by that absolute URL).
 */
export async function importVerified(resolved, root, options = {}) {
  // `boundRoot` is only for the offline contract driver run under the producer's consumer runner, which byte-verifies the
  // snapshot it binds (its own import hook and native observer) and resolves the package specifier to it. Shadow
  // directories are still refused, and the resolution must still lie inside that exact root.
  const bound = typeof options.boundRoot === 'string' && options.boundRoot ? realpathSync(options.boundRoot) : null;
  let realRoot;
  if (bound) {
    const shadows = findShadowNodeModules(root);
    if (shadows.length) throw new Error('PACKAGE_REFUSED: node_modules directory could shadow the verified package: ' + shadows[0]);
    realRoot = bound;
  } else {
    const problem = checkPackageResolution(root);
    if (problem) throw new Error('PACKAGE_REFUSED: ' + problem);
    realRoot = realpathSync(join(root, 'node_modules/@jevelopers/shared-contracts'));
  }
  if (typeof resolved !== 'string' || !resolved.startsWith('file:')) throw new Error('PACKAGE_REFUSED: package did not resolve to a file URL');
  const target = realpathSync(fileURLToPath(resolved));
  const name = relative(realRoot, target);
  if (name === '' || name === '..' || name.startsWith('..' + sep)) throw new Error('PACKAGE_REFUSED: package resolved outside the verified root');
  return import(pathToFileURL(target).href);
}
