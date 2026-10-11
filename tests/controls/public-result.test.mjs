import test from 'node:test';
import assert from 'node:assert/strict';
import { projectApplyResult, projectCounters, projectHistoryList, projectHistoryResult } from '../../src/controls/public-result.mjs';
import { applyErrorMessage, historyErrorMessage } from '../../examples/frontend-action-roundtrip/messages.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
const design = { design_version_id: 'design.safe-1', artifact: { content_hash: digest } };
const fallback = 'Apply did not complete. Dispatch and reservation status are not confirmed here. Check the existing operation before retrying.';
test('failed Apply reference projection rejects private and malformed references without coercion', () => {
  let hooks = 0;
  const coercion = { toString() { hooks++; return 'op.safe'; }, [Symbol.toPrimitive]() { hooks++; return 'op.safe'; } };
  const accessor = {}; Object.defineProperty(accessor, 'operation_id', { enumerable: true, get() { hooks++; return 'op.safe'; } });
  const values = ['op.ghp_' + 'a'.repeat(36), 'op.sk-' + 'a'.repeat(24), 'op.access_token:synthetic-private',
    'op.Bearer+synthetic-private-marker', 'https://example.invalid/object?sig=synthetic-private',
    '', null, 42, true, ['op.safe'], coercion];
  for (const value of values) {
    const projected = projectApplyResult({ ok: false, code: 'unavailable', operation_id: value, status: 'unknown' });
    assert.equal(projected.operation_id, undefined); assert.equal(projected.status, undefined);
    assert.equal(projected.ok, false); assert.equal(applyErrorMessage(projected), fallback);
  }
  for (const input of [null, [], accessor, Object.create({ operation_id: 'op.safe' }), { operation_id: 'op.safe', code: coercion },
    { operation_id: 'op.safe', result: { get design_version() { hooks++; return design; } } }]) {
    const projected = projectApplyResult(input); assert.equal(projected.operation_id, undefined); assert.equal(projected.ok, false);
  }
  assert.equal(applyErrorMessage({ get code() { hooks++; return 'unavailable'; } }), fallback);
  assert.equal(historyErrorMessage({ error: { code: coercion } }), 'Version operation did not complete. Refresh controls and review current versions and access before retrying.');
  assert.equal(historyErrorMessage({ get error() { hooks++; return { code: 'permission' }; } }), 'Version operation did not complete. Refresh controls and review current versions and access before retrying.');
  assert.equal(hooks, 0);
});
test('Apply projections preserve safe identities and known outcome wording without projecting raw prose', () => {
  for (const operation_id of ['op.safe-1', 'op.normal:2+v', 'op_bearer_of_good_news']) {
    const projected = projectApplyResult({ ok: false, code: 'unavailable', operation_id, status: 'unknown', message: 'synthetic-private' });
    assert.equal(projected.operation_id, operation_id); assert.equal(projected.status, 'unknown');
    assert.match(applyErrorMessage(projected), /reservation may remain held/); assert.equal(projected.message, undefined);
  }
  const result = projectApplyResult({ ok: true, code: 'completed', operation_id: 'op.safe', status: 'completed', backend_job_id: 'job.safe', result: { design_version: design } });
  assert.equal(result.ok, true); assert.deepEqual(result.result.design_version, design);
  const invalid = projectApplyResult({ ok: true, operation_id: 'op.safe', status: 'completed', backend_job_id: 'job.access_token:private', result: { design_version: design } });
  assert.equal(invalid.ok, false); assert.equal(invalid.operation_id, undefined); assert.equal(invalid.status, undefined);
});
test('artwork, history selection and counters project only validated references and scalar counts', () => {
  const selection = { design_version_id: design.design_version_id, revision: 1 };
  assert.deepEqual(projectHistoryList({ ok: true, selection, result: { items: [design] } }), { selection, items: [design] });
  assert.deepEqual(projectHistoryResult({ ok: true, result: { selection } }, true).result, selection);
  assert.deepEqual(projectHistoryResult({ ok: true, result: { left: design, right: design } }, false).result, { left: digest, right: digest });
  for (const field of ['design_version_id', 'content_hash']) {
    const bad = structuredClone(design); if (field === 'content_hash') bad.artifact[field] = 'Bearer synthetic-private'; else bad[field] = 'id.ghp_' + 'a'.repeat(36);
    assert.equal(projectHistoryList({ ok: true, selection, result: { items: [bad] } }), undefined);
    assert.equal(projectApplyResult({ ok: true, operation_id: 'op.safe', backend_job_id: 'job.safe', result: { design_version: bad } }).ok, false);
  }
  assert.equal(projectHistoryResult({ ok: true, result: { selection: { ...selection, design_version_id: 'id.access_token:private' } } }, true).ok, false);
  assert.equal(projectCounters({ counters: { jobs: 'synthetic-private', jev_calls: 0, image_calls: 0 } }), undefined);
  assert.deepEqual(projectCounters({ counters: { jobs: 1, jev_calls: 0, image_calls: 1 } }), { jobs: 1, jev_calls: 0, image_calls: 1 });
});
