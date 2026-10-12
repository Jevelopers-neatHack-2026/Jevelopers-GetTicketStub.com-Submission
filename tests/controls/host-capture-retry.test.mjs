/** Preserve failed regular-file capture attempts while certifying only a retry. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, cpSync, writeFileSync, readFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createIntegratedHost } from '../../fixtures/controls/integrated-host.mjs';
import { createHostLifecycle } from '../../examples/frontend-action-roundtrip/host-lifecycle.mjs';
import { closeAndCaptureHost } from '../../examples/frontend-action-roundtrip/host-capture.mjs';
import { inventoryTree, readCaptureInventory } from '../../examples/frontend-action-roundtrip/host-capture-inventory.mjs';
const fault = stage => Object.assign(new Error(`MOCK ${stage} failure`), { code: 'EIO' });
async function setup(t, stage, recordFailures = 0, fragmentReadFailures = 0) {
  const dir = mkdtempSync(join(tmpdir(), 'capture-retry-host-'));
  const evidence = mkdtempSync(join(process.env.CONTROLS_LIFECYCLE_EVIDENCE_DIR ?? tmpdir(), 'capture-retry-'));
  const host = await createIntegratedHost(dir, { enableComposition: true });
  let fail = stage !== undefined, remainingRecords = recordFailures, remainingReads = fragmentReadFailures, counts = 0, copies = 0;
  const count = host.counts.bind(host); host.counts = () => { counts++; return count(); };
  const operations = {
    copy(from, to, options) {
      copies++; cpSync(from, to, options);
      if (fail && stage === 'membership') { mkdirSync(join(to, 'unexpected-empty-directory')); fail = false; }
      if (fail && stage === 'copy') { fail = false; throw fault(stage); }
    },
    read(path) {
      if (basename(path).includes('.record-') && remainingReads > 0) { remainingReads--; throw fault('fragment read'); }
      if (fail && stage === 'walk') { fail = false; throw fault(stage); } return readFileSync(path);
    },
    write(path, bytes, options) {
      const metadata = stage === 'manifest' ? 'manifest.json' : 'receipt.json';
      if (fail && ['manifest', 'receipt'].includes(stage) && basename(path) === metadata) {
        writeFileSync(path, Buffer.from(bytes).subarray(0, 13), options); fail = false; throw fault(stage);
      }
      if (basename(path).includes('.record-') && remainingRecords > 0) {
        writeFileSync(path, Buffer.from(bytes).subarray(0, 13), options); remainingRecords--; throw fault('attempt inventory');
      }
      writeFileSync(path, bytes, options);
    },
    rename(from, to) { if (fail && stage === 'publish' && basename(to).startsWith('session-')) { fail = false; throw fault(stage); } renameSync(from, to); },
  };
  const lifecycle = createHostLifecycle({ host, dir }, { create() {}, finalize: (session, reason) => closeAndCaptureHost(session, reason, evidence, operations), remove: value => rmSync(value.dir, { recursive: true, force: true }) });
  t.after(async () => {
    await lifecycle.stop();
    if (!process.env.CONTROLS_LIFECYCLE_EVIDENCE_DIR) rmSync(evidence, { recursive: true, force: true });
  });
  return { lifecycle, evidence, dir, counts: () => counts, copies: () => copies };
}
for (const stage of ['copy', 'walk', 'manifest', 'receipt', 'publish']) test(`${stage} failure preserves an inventoried attempt and one certified retry`, async t => {
  const value = await setup(t, stage);
  await assert.rejects(value.lifecycle.change('capture'), new RegExp(`MOCK ${stage} failure`));
  assert.equal(value.lifecycle.state().closed, true); assert.equal(value.lifecycle.state().finalized, false);
  assert.equal(existsSync(value.dir), true); await assert.rejects(value.lifecycle.acquire(), /finalized/);
  const failed = readCaptureInventory(value.evidence); assert.equal(failed.sessions.length, 0); assert.equal(failed.attempts.length, 1); assert.equal(failed.attempts[0].stage, stage);
  const before = inventoryTree(join(value.evidence, 'attempts'));
  if (['manifest', 'receipt'].includes(stage)) assert.equal(failed.attempts[0].files.find(file => file.path === `${stage}.json`).bytes, 13);
  await value.lifecycle.change('capture');
  assert.deepEqual(inventoryTree(join(value.evidence, 'attempts')), before, 'Failed bytes and provenance must remain unchanged');
  const complete = readCaptureInventory(value.evidence); assert.equal(complete.sessions.length, 1); assert.equal(complete.attempts.length, 1);
  const sealed = inventoryTree(value.evidence); await value.lifecycle.change('capture');
  assert.deepEqual(inventoryTree(value.evidence), sealed, 'Successful capture must remain idempotent');
  assert.equal(value.counts(), 1); assert.equal(value.copies(), 2);
  await value.lifecycle.stop(); assert.equal(existsSync(value.dir), false);
});
test('partial failed-inventory writes remain owned and block new certification until recorded', async t => {
  const value = await setup(t, 'receipt', 2);
  await assert.rejects(value.lifecycle.change('capture'), error => error instanceof AggregateError && error.errors.map(item => item.message).join(',') === 'MOCK receipt failure,MOCK attempt inventory failure');
  assert.throws(() => readCaptureInventory(value.evidence), /inventoried/);
  const first = inventoryTree(join(value.evidence, 'attempts')), raw = first.filter(file => file.path.includes('/'));
  await assert.rejects(value.lifecycle.change('capture'), /MOCK attempt inventory failure/);
  assert.equal(value.copies(), 1); assert.equal(value.lifecycle.state().finalized, false); assert.equal(existsSync(value.dir), true);
  assert.deepEqual(inventoryTree(join(value.evidence, 'attempts')).filter(file => file.path.includes('/')), raw);
  await value.lifecycle.change('capture');
  const complete = readCaptureInventory(value.evidence); assert.equal(complete.sessions.length, 1); assert.equal(complete.attempts.length, 1);
  assert.equal(complete.attempts[0].record_failures, 2); assert.equal(complete.attempts[0].fragments.length, 2);
  const after = inventoryTree(join(value.evidence, 'attempts'));
  for (const entry of first) assert.deepEqual(after.find(file => file.path === entry.path), entry, 'Earlier failed bytes must remain unchanged');
  assert.equal(value.counts(), 1); assert.equal(value.copies(), 2);
});
test('failed fragment reads retain ownership and block new certification until measured', async t => {
  const value = await setup(t, 'receipt', 1, 2);
  await assert.rejects(value.lifecycle.change('capture'), error => error instanceof AggregateError && error.errors[0].message === 'MOCK receipt failure' &&
    error.errors[1] instanceof AggregateError && error.errors[1].errors.map(item => item.message).join(',') === 'MOCK attempt inventory failure,MOCK fragment read failure');
  const before = inventoryTree(join(value.evidence, 'attempts'));
  await assert.rejects(value.lifecycle.change('capture'), /MOCK fragment read failure/);
  assert.equal(value.copies(), 1); assert.equal(value.lifecycle.state().finalized, false); assert.equal(existsSync(value.dir), true);
  assert.deepEqual(inventoryTree(join(value.evidence, 'attempts')), before);
  await value.lifecycle.change('capture');
  const complete = readCaptureInventory(value.evidence);
  assert.equal(complete.sessions.length, 1); assert.equal(complete.attempts.length, 1);
  assert.equal(complete.attempts[0].record_failures, 1); assert.equal(complete.attempts[0].fragments.length, 1);
  const after = inventoryTree(join(value.evidence, 'attempts'));
  for (const entry of before) assert.deepEqual(after.find(file => file.path === entry.path), entry);
  assert.equal(value.counts(), 1); assert.equal(value.copies(), 2);
});
test('strict completed-stage membership is validated before certification', async t => {
  const value = await setup(t, 'membership');
  await assert.rejects(value.lifecycle.change('capture'), /Unexpected certified store directory/);
  assert.equal(value.lifecycle.state().closed, true); assert.equal(value.lifecycle.state().finalized, false);
  assert.equal(existsSync(value.dir), true);
  const failed = readCaptureInventory(value.evidence);
  assert.equal(failed.sessions.length, 0); assert.equal(failed.attempts.length, 1); assert.equal(failed.attempts[0].stage, 'publish');
  assert.ok(failed.attempts[0].files.some(file => file.path === 'store-root/unexpected-empty-directory' && file.kind === 'directory'));
  const before = inventoryTree(join(value.evidence, 'attempts'));
  await value.lifecycle.change('capture');
  const complete = readCaptureInventory(value.evidence); assert.equal(complete.sessions.length, 1); assert.equal(complete.attempts.length, 1);
  assert.deepEqual(inventoryTree(join(value.evidence, 'attempts')), before);
  assert.equal(value.counts(), 1); assert.equal(value.copies(), 2);
});
test('strict inventory rejects unknown and altered members on disposable copies only', async t => {
  const value = await setup(t, 'receipt'); await assert.rejects(value.lifecycle.change('capture'), /MOCK receipt failure/); await value.lifecycle.change('capture');
  const complete = readCaptureInventory(value.evidence), sealed = inventoryTree(value.evidence);
  for (const mutation of [
    copy => writeFileSync(join(copy, 'unexpected.txt'), 'MOCK extra'),
    copy => mkdirSync(join(copy, 'attempts', 'attempt-9999-unknown')),
    copy => writeFileSync(join(copy, 'attempts', 'unexpected.record-unknown'), 'MOCK extra'),
    copy => writeFileSync(join(copy, complete.sessions[0].name, 'store-root', 'creative.sqlite-wal'), 'MOCK extra'),
    copy => mkdirSync(join(copy, complete.sessions[0].name, 'store-root', 'unexpected-empty-directory')),
    copy => writeFileSync(join(copy, 'attempts', complete.attempts[0].attempt, 'receipt.json'), 'MOCK changed'),
  ]) {
    const disposable = mkdtempSync(join(tmpdir(), 'capture-inventory-negative-'));
    try { cpSync(value.evidence, disposable, { recursive: true }); mutation(disposable); assert.throws(() => readCaptureInventory(disposable)); }
    finally { rmSync(disposable, { recursive: true, force: true }); }
  }
  assert.deepEqual(inventoryTree(value.evidence), sealed, 'Negative validation must not alter retained corpus');
});
