import assert from 'node:assert/strict';
import { readFile, readdir, realpath, readlink, lstat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { sha256 } from './custody.mjs';

export async function manifest(root) {
  const rows = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name); const path = relative(root, full);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) rows.push({ path, bytes: (await lstat(full)).size, sha256: sha256(await readFile(full)) });
      else if (entry.isSymbolicLink()) {
        assert.ok((await realpath(full)).startsWith(`${await realpath(root)}/`));
        rows.push({ path, symlink: await readlink(full) });
      } else assert.fail('special file');
      assert.ok(rows.length <= 20000);
    }
  }
  await walk(root); return rows.sort((a,b) => a.path < b.path ? -1 : 1);
}
export async function saveJson(output, name, value) {
  await writeFile(join(output, name), JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
}
export function portable(value, roots) {
  return JSON.parse(JSON.stringify(value, (_key, item) => {
    if (typeof item !== 'string') return item;
    let result = item;
    for (const [path, label] of roots) result = result.replaceAll(path, label);
    return result;
  }));
}
