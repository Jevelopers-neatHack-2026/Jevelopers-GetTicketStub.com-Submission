import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, lstat, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export const digest = value => sha256(JSON.stringify(value));
export function checked(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `${command} failed`);
  return result.stdout.trim();
}
export async function verifySource(source, pin) {
  assert.equal(await realpath(source), resolve(source));
  const git = args => checked('git', ['-C', source, ...args]);
  assert.equal(git(['rev-parse', 'HEAD']), pin.revision);
  assert.equal(git(['rev-parse', 'HEAD^{tree}']), pin.tree);
  assert.equal(git(['status', '--porcelain=v1', '--untracked-files=all']), '');
  const files = [];
  for (const path of git(['ls-files']).split('\n')) {
    const full = join(source, path); assert.equal((await lstat(full)).isFile(), true);
    files.push({ path, sha256: sha256(await readFile(full)) });
  }
  assert.equal(digest(files), pin.tracked_files_sha256);
  for (const [path, expected] of Object.entries(pin.files)) assert.equal(sha256(await readFile(join(source, path))), expected);
  return { revision: pin.revision, tree: pin.tree, files, clean: true };
}
export async function verifyArchive(archive, pin) {
  const stat = await lstat(archive); assert.ok(stat.isFile() && !stat.isSymbolicLink());
  assert.equal(stat.size, pin.corpus.bytes);
  assert.equal(sha256(await readFile(archive)), pin.corpus.sha256);
}
export function verifyMembers(rows, pin) {
  assert.deepEqual(rows, pin.corpus.members);
}
export function verifyProvenance(provenance, pin) {
  assert.equal(provenance.producer.artifactZipSha256, pin.corpus.sha256);
  assert.equal(provenance.producer.revision, pin.corpus.revision);
  assert.equal(provenance.sharedContractsPin.source_revision, pin.sdk.revision);
  assert.equal(provenance.sharedContractsPin.archive_sha256, pin.sdk.sha256);
  assert.equal(provenance.accepted, false); assert.equal(provenance.handoffEligible, false);
  verifyMembers(provenance.pins.map(row => ({ path: row.path, bytes: row.size, sha256: row.sha256 })).sort((a,b) => a.path < b.path ? -1 : 1), pin);
}
