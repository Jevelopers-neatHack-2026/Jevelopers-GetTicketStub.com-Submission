/** CI-only directory-preserving transport; never follows symbolic links or certifies stores. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync, readlinkSync, mkdirSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const captureRoots = ['build/controls-package-evidence/lifecycle-stores', 'examples/frontend-action-roundtrip/test-results/browser-stores'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function snapshot(workspace) {
  const roots = [], members = [];
  function walk(path) {
    const absolute = join(workspace, path), stat = lstatSync(absolute);
    const mode = stat.mode & 0o7777;
    if (stat.isDirectory()) {
      members.push({ path, kind: 'directory', mode });
      for (const name of readdirSync(absolute).sort()) walk(`${path}/${name}`);
    } else if (stat.isFile() || stat.isSymbolicLink()) {
      const bytes = stat.isFile() ? readFileSync(absolute) : readlinkSync(absolute, { encoding: 'buffer' });
      members.push({ path, kind: stat.isFile() ? 'file' : 'symlink', mode, bytes: bytes.length, sha256: digest(bytes) });
    } else {
      const kind = stat.isFIFO() ? 'fifo' : stat.isCharacterDevice() ? 'character-device' : stat.isBlockDevice() ? 'block-device' : undefined;
      assert.ok(kind, 'Unsupported capture transport member');
      members.push({ path, kind, mode, device: stat.rdev });
    }
  }
  for (const path of captureRoots) {
    let present = true;
    try { assert.equal(lstatSync(join(workspace, path)).isDirectory(), true, 'Capture transport roots must be directories'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; present = false; }
    roots.push({ path, present }); if (present) walk(path);
  }
  return { roots, members };
}
export function packageCaptureCustody(workspace = process.cwd()) {
  workspace = resolve(workspace);
  const before = snapshot(workspace), directory = join(workspace, 'build/controls-package-evidence');
  mkdirSync(directory, { recursive: true });
  const archive = join(directory, 'capture-custody.tar'), receipt = join(directory, 'capture-custody.receipt.json');
  const partialArchive = `${archive}.incomplete`, partialReceipt = `${receipt}.incomplete`;
  for (const path of [archive, receipt, partialArchive, partialReceipt]) assert.equal(existsSync(path), false, 'Capture transport outputs must not be overwritten');
  // GNU tar is an explicit CI transport prerequisite, not a public runtime dependency.
  const paths = before.roots.filter(root => root.present).map(root => root.path);
  const result = spawnSync('tar', ['--sort=name', '--format=gnu', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--hard-dereference', '-cf', partialArchive,
    ...(paths.length ? ['--', ...paths] : ['--files-from=/dev/null'])], { cwd: workspace, encoding: 'utf8' });
  assert.ifError(result.error); assert.equal(result.status, 0, `Capture transport tar failed: ${result.stderr}`);
  assert.deepEqual(snapshot(workspace), before, 'Capture roots changed during transport packaging');
  const bytes = readFileSync(partialArchive), complete = before.roots.every(root => root.present);
  const record = { format: 'controls-capture-custody-transport/1', complete, archive: { path: 'build/controls-package-evidence/capture-custody.tar', bytes: bytes.length, sha256: digest(bytes) }, ...before };
  writeFileSync(partialReceipt, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  renameSync(partialArchive, archive); renameSync(partialReceipt, receipt);
  assert.equal(complete, true, 'Required capture roots are missing; transport receipt records incomplete evidence');
  return record;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) packageCaptureCustody();
