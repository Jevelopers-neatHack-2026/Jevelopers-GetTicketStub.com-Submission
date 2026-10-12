// Independent verifier for the provisioned shared-contracts package. It deliberately imports NOTHING from the package:
// the canonical JSON and sha256 below reimplement the producer's `canonicalJson`/`hashManifest` (tooling/runtime.mjs,
// scripts/package-content.mjs) for the only shapes the manifests use (objects of strings, arrays, strings, safe integers).
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';

/**
 * Deliberately restricted: only a plain object of well-formed string keys to well-formed string values (the shape of
 * every file-hash map this verifier hashes). Anything else throws, so it can never false-pass where the producer's
 * general canonicalJson would reject (unsafe numbers, depth, sparse arrays, ill-formed unicode).
 */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('only a string map can be canonicalised');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error('only a plain object can be canonicalised');
  const keys = Object.keys(value).sort();
  return '{' + keys.map((key) => {
    const item = value[key];
    if (typeof item !== 'string' || !key.isWellFormed() || !item.isWellFormed()) throw new Error('only well-formed string entries are allowed');
    return JSON.stringify(key) + ':' + JSON.stringify(item);
  }).join(',') + '}';
}
export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const hashManifest = (value) => 'sha256:' + sha256Hex(Buffer.from(canonicalJson(value), 'utf8'));

/** Every entry under the package, using directory entries only (never following links). Returns a failure message or the file list. */
function listPackage(directory, base, found) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) return 'symlink in package: ' + relative(base, path).split(sep).join('/');
    if (entry.isDirectory()) { const problem = listPackage(path, base, found); if (problem) return problem; }
    else if (entry.isFile()) found.push(relative(base, path).split(sep).join('/'));
    else return 'unsupported entry in package: ' + relative(base, path).split(sep).join('/');
  }
  return null;
}
const inside = (parent, child) => { const name = relative(parent, child); return name !== '' && name !== '..' && !name.startsWith('..' + sep) && !isAbsolute(name); };
const MANIFEST = 'generated/package-content-manifest.json';

/** Returns a failure message, or null when the installed package is exactly the pinned one. Throws nothing the caller must interpret. */
export function verifyInstalledPackage(snapshot, pin, consumerRoot) {
  try {
    // The package root must really live in this consumer's node_modules and must itself be a real directory.
    if (!lstatSync(snapshot).isDirectory()) return 'package root is not a real directory';
    const realRoot = realpathSync(snapshot);
    if (!inside(realpathSync(join(consumerRoot, 'node_modules')), realRoot)) return 'package root resolves outside the consumer node_modules';
    const present = [];
    const listing = listPackage(snapshot, snapshot, present);
    if (listing) return listing;
    const read = (path) => JSON.parse(readFileSync(join(snapshot, path), 'utf8'));
    const manifest = read('generated/package-content-manifest.json');
    if (!manifest || typeof manifest.files !== 'object' || manifest.files === null || Array.isArray(manifest.files)) return 'content manifest has no file map';
    // 1. The file map itself must hash to the committed pin, before any entry in it is trusted.
    if (hashManifest(manifest.files) !== pin.package_content_digest) return 'recomputed content digest differs from the pin';
    if (manifest.digest !== pin.package_content_digest) return 'declared content digest differs from the pin';
    // 2. Every listed file must be a regular file inside the package whose bytes match its (now anchored) hash.
    for (const [path, expected] of Object.entries(manifest.files)) {
      if (path.startsWith('/') || path.includes('\\') || path.split('/').some((part) => part === '' || part === '.' || part === '..')) return 'unsafe path in manifest: ' + path;
      const full = join(snapshot, path);
      if (!lstatSync(full).isFile() || !inside(realRoot, realpathSync(full))) return 'listed entry is not a regular file inside the package: ' + path;
      if ('sha256:' + sha256Hex(readFileSync(full)) !== expected) return 'installed file bytes differ from the pin: ' + path;
    }
    // 3. No file of any kind may exist that the anchored map does not list (the self-excluded manifest is the only exception).
    for (const path of present) if (path !== MANIFEST && !Object.hasOwn(manifest.files, path)) return 'unlisted file in package: ' + path;
    // 4. Fixture manifest: aggregate recomputed independently and anchored to the pin.
    const fixtures = read('generated/fixture-manifest.json');
    if (hashManifest(fixtures.files) !== pin.fixture_digest || fixtures.digest !== pin.fixture_digest) return 'fixture digest differs from the pin';
    const pkg = read('package.json');
    if (pkg.name !== pin.package || pkg.version !== pin.version) return 'installed package name/version differs from the pin';
    return null;
  } catch (error) {
    return 'verification error: ' + (error && error.code ? error.code : 'unreadable package');
  }
}
