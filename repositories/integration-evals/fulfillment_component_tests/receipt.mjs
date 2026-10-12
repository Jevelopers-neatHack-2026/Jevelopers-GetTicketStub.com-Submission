import assert from 'node:assert/strict';
import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256, verifyMembers } from './custody.mjs';

export const variantIds = ['valid', 'tampered-payload', 'tampered-manifest', 'tampered-detached', 'missing-payload', 'missing-manifest', 'extra-file'];
export const boundaryIds = ['wrong-scope', 'use-time-drift', 'non-simulated-denial'];
export const artifactNames = [...variantIds.map(id => `variant-${id}.json`), ...boundaryIds.map(id => `boundary-${id}.json`)];
const expectedInputs = (id, pin) => Object.fromEntries(pin.corpus.members.filter(row => row.path.startsWith(`variants/${id}/`)).map(row => [row.path.split('/').at(-1), `sha256:${row.sha256}`]));
export function blocked(report) {
  assert.equal(report.eligibility, 'blocked');
  for (const field of ['authorityIssued', 'accepted', 'handoffEligible']) assert.equal(report[field], false);
  assert.equal(report.owner.accepted, false);
}
export function validateVariant(value, pin) {
  assert.ok(variantIds.includes(value.id)); assert.equal(value.basis, 'direct_owner_api');
  assert.deepEqual(value.inputs, expectedInputs(value.id, pin)); assert.deepEqual(value.after, value.inputs);
  assert.equal(value.commitment_sha256, pin.corpus.members.find(row => row.path === 'bundle/trusted-commitment.json').sha256);
  const report = value.report; blocked(report);
  assert.equal(report.consumer.revision, pin.revision); assert.equal(report.owner.archiveSha256, pin.sdk.sha256);
  assert.equal(report.owner.version, pin.sdk.version);
  assert.equal(report.verdict, value.id === 'valid' ? 'integrity_passed_blocked' : 'integrity_failed');
  assert.equal(report.unchanged, true);
  assert.deepEqual(report.inputDigests, report.outputDigests);
  assert.deepEqual(report.inputDigests, { 'trusted-commitment.json': `sha256:${value.commitment_sha256}`, ...value.inputs });
  if (value.id === 'valid') assert.equal(report.criteria.find(row => row.id === 'owner_integrity').state, 'verified_owner');
  else assert.ok(report.owner.codes.includes('INTEGRITY_FAILURE'));
}
function allZero(counters) {
  for (const value of Object.values(counters)) {
    if (typeof value === 'number') assert.equal(value, 0);
    else { assert.equal(typeof value, 'object'); for (const count of Object.values(value)) assert.equal(count, 0); }
  }
}
export function validateBoundary(value, pin) {
  assert.ok(boundaryIds.includes(value.id)); assert.equal(value.actual_sandbox_execution, false);
  assert.equal(value.simulator_submit, 0); assert.equal(value.counters_delta.transport, 0);
  assert.equal(value.counters_after.transport, value.counters_before.transport);
  assert.equal(value.error.side_effect_state, 'not_dispatched');
  assert.deepEqual(value.baseline_after, expectedInputs('valid', pin));
  assert.ok(value.calls.resolve.length <= 8 && value.calls.read.length <= 32);
  for (const read of value.calls.read) {
    assert.ok(Number.isSafeInteger(read.maxLength) && read.maxLength > 0 && read.maxLength <= 32 * 1024 * 1024);
    assert.match(read.byteHash, /^sha256:[a-f0-9]{64}$/);
  }
  switch (value.id) {
    case 'wrong-scope':
      assert.equal(value.error.code, 'bundle_invalid'); assert.equal(value.gate_report.verdict, 'integrity_failed');
      assert.equal(value.gate_report.criteria.find(row => row.id === 'anchor_resolution').code, 'BUNDLE_UNPUBLISHED');
      assert.equal(value.calls.read.length, 0); break;
    case 'use-time-drift':
      assert.equal(value.error.code, 'bundle_changed'); assert.equal(value.error.retryable, false);
      assert.ok(value.calls.resolve.length >= 2); assert.deepEqual(value.attempts, [{ side_effect_state: 'not_dispatched' }]);
      assert.equal(value.drift_origin, 'variants/tampered-payload/lineage.json'); break;
    case 'non-simulated-denial':
      assert.equal(value.error.code, 'bundle_invalid'); allZero(value.counters_before); allZero(value.counters_after);
      assert.deepEqual(Object.keys(value.counters_after).sort(), ['inbound','outbound','claim','revalidate','persistenceGet','persistenceClaim','persistenceSave','budget','usage','metering','transport','adapter'].sort());
      assert.deepEqual(value.calls, { resolve: [], read: [] }); assert.deepEqual(value.order, []); assert.deepEqual(value.attempts, []); break;
    default: assert.fail('unknown boundary');
  }
}
export async function validateArtifacts(output, pin) {
  const values = [];
  for (const name of artifactNames) {
    const path = join(output, name); const stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 128 * 1024);
    const bytes = await readFile(path); const value = JSON.parse(bytes);
    assert.equal(name, `${name.startsWith('variant-') ? 'variant' : 'boundary'}-${value.id}.json`);
    if (name.startsWith('variant-')) validateVariant(value, pin); else validateBoundary(value, pin);
    values.push({ path: name, sha256: sha256(bytes) });
  }
  assert.equal(JSON.parse(await readFile(join(output, 'fixture-cleanup.json'))).completed, true);
  return values;
}
export function validateReceipt(receipt, pin) {
  assert.equal(receipt.kind, 'fulfillment-bundle-component-development'); assert.equal(receipt.status, 'passed');
  assert.equal(receipt.source, pin.revision); assert.equal(receipt.corpus_sha256, pin.corpus.sha256);
  assert.equal(receipt.platform, 'linux'); assert.equal(receipt.node, `v${pin.node}`);
  assert.equal(receipt.accepted, false); assert.equal(receipt.handoffEligible, false);
  assert.equal(receipt.paid_execution_enabled, false); assert.equal(receipt.actual_sandbox_execution, false);
  assert.deepEqual(receipt.execution_boundary, { namespace_separate: true, interfaces: ['lo'], ipv4_route_count: 0, uid_nonroot: true, claim: 'network_namespace_only' });
  assert.equal(receipt.cleanup.confirmed, true); assert.equal(receipt.cleanup.private_removed, true);
  assert.equal(receipt.owner_control.basis, 'owner_assertion'); assert.equal(receipt.owner_control.status, 'passed');
  assert.equal(receipt.owner_control.localFixtureCounts.total, 166); assert.equal(receipt.owner_control.localFixtureCounts.passed, 166); assert.equal(receipt.owner_control.localFixtureCounts.failed, 0);
  assert.deepEqual(receipt.artifacts.map(row => row.path), artifactNames);
  for (const row of receipt.artifacts) assert.match(row.sha256, /^[a-f0-9]{64}$/);
  verifyMembers(receipt.members, pin);
}
