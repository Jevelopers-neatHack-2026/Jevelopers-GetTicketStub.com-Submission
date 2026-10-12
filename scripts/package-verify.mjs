// Independent verifier for the provisioned shared-contracts package. It deliberately imports NOTHING from the package:
// the canonical JSON and sha256 below reimplement the producer's `canonicalJson`/`hashManifest` (tooling/runtime.mjs,
// scripts/package-content.mjs) for the only shapes the manifests use (objects of strings, arrays, strings, safe integers).
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export function canonicalJson(value) {
  if (value === null) return 'null';
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) && !Number.isFinite(value)) throw new Error('non-canonical number');
    return JSON.stringify(value === 0 ? 0 : value);
  }
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new Error('ill-formed string');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  throw new Error('non-JSON value');
}
export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const hashManifest = (value) => 'sha256:' + sha256Hex(Buffer.from(canonicalJson(value), 'utf8'));

const executable = /\.(?:mjs|cjs|js|node|wasm)$/u;
function walk(directory, base, found) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = statSync(path);
    if (stat.isDirectory()) { if (name !== 'node_modules') walk(path, base, found); } else found.push(relative(base, path).split(sep).join('/'));
  }
}

/** Returns a failure message, or null when the installed package is exactly the pinned one. Throws nothing the caller must interpret. */
export function verifyInstalledPackage(snapshot, pin) {
  try {
    const read = (path) => JSON.parse(readFileSync(join(snapshot, path), 'utf8'));
    const manifest = read('generated/package-content-manifest.json');
    if (!manifest || typeof manifest.files !== 'object' || manifest.files === null || Array.isArray(manifest.files)) return 'content manifest has no file map';
    // 1. The file map itself must hash to the committed pin, before any entry in it is trusted.
    if (hashManifest(manifest.files) !== pin.package_content_digest) return 'recomputed content digest differs from the pin';
    if (manifest.digest !== pin.package_content_digest) return 'declared content digest differs from the pin';
    // 2. Every listed file must match its (now anchored) hash.
    for (const [path, expected] of Object.entries(manifest.files)) {
      if (path.startsWith('/') || path.split('/').includes('..')) return 'unsafe path in manifest: ' + path;
      if ('sha256:' + sha256Hex(readFileSync(join(snapshot, path))) !== expected) return 'installed file bytes differ from the pin: ' + path;
    }
    // 3. No executable file may exist that the anchored map does not list.
    const present = [];
    walk(snapshot, snapshot, present);
    for (const path of present) if (executable.test(path) && !Object.hasOwn(manifest.files, path)) return 'unlisted executable file: ' + path;
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
