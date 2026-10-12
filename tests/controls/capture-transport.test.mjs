/** GNU tar preserves capture directories that upload-artifact omits. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, utimesSync, symlinkSync, linkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packageCaptureCustody, captureRoots } from '../../fixtures/controls/package-capture-custody.mjs';
import { inventoryTree } from '../../examples/frontend-action-roundtrip/host-capture-inventory.mjs';
test('capture transport preserves exact bytes and empty directories with deterministic metadata', t => {
  const workspace = mkdtempSync(join(tmpdir(), 'capture-transport-')), second = mkdtempSync(join(tmpdir(), 'capture-transport-second-')), extracted = mkdtempSync(join(tmpdir(), 'capture-transport-extracted-'));
  t.after(() => { for (const path of [workspace, second, extracted]) rmSync(path, { recursive: true, force: true }); });
  for (const path of captureRoots) {
    mkdirSync(join(workspace, path, 'attempts'), { recursive: true });
    mkdirSync(join(workspace, path, 'session-0001-MOCK/store-root/objects/staging'), { recursive: true });
    writeFileSync(join(workspace, path, 'session-0001-MOCK/store-root/creative.sqlite'), 'MOCK transport bytes');
  }
  // These disposable transport inputs never enter the retained capture corpus.
  writeFileSync(join(workspace, 'outside-capture-root'), 'MOCK excluded target');
  symlinkSync(join(workspace, 'outside-capture-root'), join(workspace, captureRoots[0], 'attempts/link-text'));
  linkSync(join(workspace, captureRoots[0], 'session-0001-MOCK/store-root/creative.sqlite'), join(workspace, captureRoots[0], 'attempts/regular-hard-link'));
  const before = captureRoots.map(path => inventoryTree(join(workspace, path)));
  const record = packageCaptureCustody(workspace); assert.equal(record.complete, true);
  assert.equal(record.members.find(member => member.path.endsWith('/link-text')).kind, 'symlink');
  assert.equal(record.members.some(member => member.path === 'outside-capture-root'), false);
  const archive = join(workspace, record.archive.path);
  const unpack = spawnSync('tar', ['-xf', archive, '--no-same-owner', '-C', extracted], { encoding: 'utf8' });
  assert.ifError(unpack.error); assert.equal(unpack.status, 0, unpack.stderr);
  for (const [index, path] of captureRoots.entries()) assert.deepEqual(inventoryTree(join(extracted, path)), before[index]);
  for (const path of captureRoots) {
    mkdirSync(join(second, path), { recursive: true }); cpSync(join(workspace, path), join(second, path), { recursive: true });
    utimesSync(join(second, path), new Date(1234567890000), new Date(1234567890000));
  }
  const again = packageCaptureCustody(second); assert.equal(again.archive.sha256, record.archive.sha256);
  assert.deepEqual(again, record); assert.throws(() => packageCaptureCustody(workspace), /must not be overwritten/);
  for (const [index, path] of captureRoots.entries()) assert.deepEqual(inventoryTree(join(workspace, path)), before[index]);
});
test('missing required capture roots retain an explicit failed transport receipt', t => {
  const workspace = mkdtempSync(join(tmpdir(), 'capture-transport-missing-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  assert.throws(() => packageCaptureCustody(workspace), /Required capture roots are missing/);
  const receipt = JSON.parse(readFileSync(join(workspace, 'build/controls-package-evidence/capture-custody.receipt.json')));
  assert.equal(receipt.complete, false); assert.deepEqual(receipt.roots, captureRoots.map(path => ({ path, present: false })));
  assert.deepEqual(receipt.members, []); assert.ok(receipt.archive.bytes > 0);
});
