import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { TextDecoder } from 'node:util';

const directory = process.argv[2];
const fallbackPath = process.argv[3] ?? 'docs/api/entire-graph-agent-fallback.md';
if (!directory) {
  throw new Error('Usage: node scripts/validate-entire-graph-artifact.mjs <artifact-directory> [fallback-file]');
}

const expected = new Set(['.entire/graph-agent.md', 'AGENTS.md', 'CLAUDE.md']);
const actual = new Set();
const root = join(directory);

async function walk(current) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = join(current, entry.name);
    const stat = await lstat(path);
    const name = relative(root, path).split(sep).join('/');
    if (stat.isSymbolicLink()) throw new Error('Artifact path is a symlink: ' + name);
    if (stat.isDirectory()) {
      if (name !== '.entire') throw new Error('Unexpected artifact directory: ' + name);
      await walk(path);
      continue;
    }
    if (!stat.isFile() || !expected.has(name)) throw new Error('Unexpected artifact file: ' + name);
    if (stat.size === 0 || stat.size > 1024 * 1024) throw new Error('Artifact file has invalid size: ' + name);
    actual.add(name);
  }
}

await walk(root);
if (actual.size !== expected.size || [...expected].some(name => !actual.has(name))) {
  throw new Error('Artifact must contain exactly: ' + [...expected].sort().join(', '));
}

const decoder = new TextDecoder('utf-8', { fatal: true });
const contents = new Map();
for (const name of expected) {
  contents.set(name, decoder.decode(await readFile(join(root, name))));
}

const fallback = await readFile(fallbackPath);
for (const name of ['AGENTS.md', 'CLAUDE.md']) {
  const text = contents.get(name);
  const begins = [...text.matchAll(/<!-- entire-graph:begin -->/g)].length;
  const ends = [...text.matchAll(/<!-- entire-graph:end -->/g)].length;
  if (begins !== 1 || ends !== 1 || text.indexOf('<!-- entire-graph:begin -->') > text.indexOf('<!-- entire-graph:end -->')) {
    throw new Error(name + ' must contain exactly one ordered generated block');
  }
  const suffix = Buffer.from(text).subarray(Buffer.byteLength(text) - fallback.length);
  if (suffix.length !== fallback.length || !suffix.equals(fallback)) {
    throw new Error(name + ' must end with the repository-owned fallback text');
  }
}

if (!contents.get('.entire/graph-agent.md').trim()) {
  throw new Error('The generated graph-agent instructions must not be empty');
}
