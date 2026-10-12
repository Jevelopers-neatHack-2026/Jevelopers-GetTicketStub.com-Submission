import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, lstat, readlink } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = value => sha256(JSON.stringify(value));
export function checked(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command} failed`);
  return result.stdout.trim();
}
export async function manifest(root) {
  const rows = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name); const name = relative(root, path);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) rows.push({ path: name, sha256: sha256(await readFile(path)) });
      else if (entry.isSymbolicLink()) {
        assert.ok((await realpath(path)).startsWith(`${await realpath(root)}/`), 'external installed symlink');
        rows.push({ path: name, symlink: await readlink(path) });
      } else assert.fail('special installed file');
      assert.ok(rows.length <= 100000, 'manifest limit');
    }
  }
  await walk(root);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
export async function sourceCustody(source, pin) {
  assert.equal(await realpath(source), resolve(source));
  const git = args => checked('git', ['-C', source, ...args]);
  assert.equal(git(['rev-parse', 'HEAD']), pin.revision);
  assert.equal(git(['rev-parse', 'HEAD^{tree}']), pin.tree);
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '');
  const archive = spawnSync('git', ['-C', source, 'archive', '--format=tar', 'HEAD'], { maxBuffer: 128 * 1024 * 1024, timeout: 30000 });
  assert.equal(archive.status, 0); assert.equal(sha256(archive.stdout), pin.archive_sha256);
  const files = [];
  for (const path of git(['ls-files']).split('\n')) {
    assert.equal((await lstat(join(source, path))).isFile(), true);
    files.push({ path, sha256: sha256(await readFile(join(source, path))) });
  }
  assert.equal(digest(files), pin.tracked_files_sha256, 'tracked byte drift');
  for (const [path, expected] of Object.entries(pin.files)) assert.equal(sha256(await readFile(join(source, path))), expected);
  const packageJson = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['verify:creative-host'], pin.script);
  return { revision: pin.revision, tree: pin.tree, archive_sha256: pin.archive_sha256, files, clean: true };
}
export async function installedCustody(source) {
  const files = await manifest(join(source, 'node_modules'));
  const creative = JSON.parse(await readFile(join(source, 'src/server/vendor/creative-engine/MANIFEST.json'), 'utf8'));
  for (const [path, expected] of Object.entries(creative.files)) {
    if (path.startsWith('src/')) assert.equal(sha256(await readFile(join(source, 'node_modules/creative-engine', path))), expected);
  }
  return { files, sha256: digest(files) };
}
