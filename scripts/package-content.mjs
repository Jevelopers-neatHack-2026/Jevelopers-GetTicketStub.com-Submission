import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { hashBytes, hashManifest } from '../tooling/runtime.mjs';

export const contentManifestPath = 'generated/package-content-manifest.json';
export function safePackagePath(path) {
  return typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !path.includes('\\') && path.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}
export async function packageContents(directory, generated) {
  const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const files = new Map([['package.json', await readFile(join(directory, 'package.json'))]]);
  async function visit(path) {
    if (!safePackagePath(path)) throw new Error('Invalid package path');
    const entries = await readdir(join(directory, path), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const next = path + '/' + entry.name;
      if (next === contentManifestPath) continue;
      if (entry.isSymbolicLink()) throw new Error('Package symlink is forbidden');
      if (entry.isDirectory()) await visit(next);
      else if (entry.isFile() && next !== contentManifestPath) files.set(next, await readFile(join(directory, next)));
      else throw new Error('Unsupported package file');
    }
  }
  for (const path of packageJson.files) {
    if (path === 'generated' && generated) {
      for (const [name, source] of generated) if ('generated/' + name !== contentManifestPath) files.set('generated/' + name, Buffer.from(source));
    } else if (path.endsWith('.mjs') || path.endsWith('.md') || path.endsWith('.json')) files.set(path, await readFile(join(directory, path)));
    else await visit(path);
  }
  return new Map([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
}
export async function packageContentManifest(directory, generated) {
  const contents = await packageContents(directory, generated);
  const files = Object.fromEntries([...contents].map(([path, bytes]) => [path, hashBytes(bytes)]));
  return { policy_version: '1.0.0', self_exclusion: contentManifestPath, files, digest: hashManifest(files) };
}
export async function verifyPackageContents(directory, expected) {
  const manifest = JSON.parse(await readFile(join(directory, contentManifestPath), 'utf8'));
  if (manifest.policy_version !== '1.0.0' || manifest.self_exclusion !== contentManifestPath || hashManifest(manifest.files) !== manifest.digest || manifest.digest !== expected.digest || JSON.stringify(manifest.files) !== JSON.stringify(expected.files)) return false;
  const actual = await packageContentManifest(directory);
  return actual.digest === expected.digest && JSON.stringify(actual.files) === JSON.stringify(expected.files);
}
