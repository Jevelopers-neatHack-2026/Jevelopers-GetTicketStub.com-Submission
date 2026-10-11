import test from 'node:test';
import assert from 'node:assert/strict';
import { projectApplyResult, projectCounters, projectHistoryList, projectHistoryResult } from '../../src/controls/public-result.mjs';
import { applyErrorMessage, historyErrorMessage } from '../../examples/frontend-action-roundtrip/messages.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ApplyStore } from '../../src/controls/actions.mjs';
import { fixtureState, principal, projection, action } from '../../fixtures/controls/state.mjs';

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

test('contradictory and incomplete result shapes cannot promote identity or lifecycle', () => {
  const common = { operation_id: 'op.safe', status: 'completed' };
  const incomplete = [
    { ok: false, code: 'unavailable', ...common }, { ok: false, code: 'failed', ...common },
    { ok: false, code: 'permission', ...common }, { ok: true, code: 'completed', ...common },
    { ok: true, code: 'completed', ...common, backend_job_id: 'job.safe' },
    { ok: true, code: 'completed', ...common, result: { design_version: design } },
    { ok: true, code: 'replayed', replayed: true, ...common },
    { ok: true, code: 'accepted', ...common }, { ok: true, code: 'ready', operation_id: 'op.safe', status: 'ready' },
    { ok: true, code: 'pending', operation_id: 'op.safe', status: 'pending' },
    { ok: true, code: 'unrecognized', operation_id: 'op.safe', status: 'running' },
    { ok: true, code: 'accepted', operation_id: 'op.safe', status: 'queued', replayed: true },
    { ok: true, code: 'completed', ...common, backend_job_id: 'job.safe', result: { design_version: design }, backend_error: {} },
    { ok: 'true', code: 'completed', ...common }, { ok: false, code: 'unavailable', operation_id: 'op.safe', status: null },
    { ok: false, code: 'unavailable', operation_id: 'op.safe', status: 'cancelled' },
    { ok: false, code: 'unavailable', operation_id: 'op.safe', status: 'ready' },
    { ok: false, code: 'failed', operation_id: 'op.safe', result: { design_version: design } },
  ];
  for (const input of incomplete) {
    const view = projectApplyResult(input);
    assert.equal(view.ok, false); assert.equal(view.operation_id, undefined); assert.equal(view.status, undefined);
    assert.equal(view.result, undefined); assert.equal(applyErrorMessage(view), fallback);
  }
  const noStatus = projectApplyResult({ ok: false, code: 'unavailable', operation_id: 'op.safe', backend_error: { code: 'unavailable' } });
  assert.equal(noStatus.operation_id, 'op.safe'); assert.equal(noStatus.status, undefined); assert.match(applyErrorMessage(noStatus), /reservation may remain held/);
  const completed = { ok: true, code: 'completed', ...common, backend_job_id: 'job.safe', result: { design_version: design } };
  assert.equal(projectApplyResult(completed).ok, true);
  assert.equal(projectApplyResult({ ...completed, code: 'replayed', replayed: true }).ok, true);
});

test('genuine accepted ready replayed and cancelled local results retain supported meaning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'control-result-shapes-')), state = fixtureState();
  const store = new ApplyStore(join(dir, 'controls.sqlite'), () => projection(state));
  try {
    const payload = action(state), accepted = store.apply(principal, payload);
    assert.equal(projectApplyResult(accepted).ok, true); assert.equal(projectApplyResult(accepted).status, 'queued');
    const queuedReplay = store.apply(principal, payload); assert.equal(queuedReplay.code, 'replayed'); assert.equal(projectApplyResult(queuedReplay).status, 'queued');
    const ready = store.dispatch(principal, accepted.operation_id); assert.equal(ready.code, 'ready'); assert.equal(projectApplyResult(ready).ok, true);
    const readyReplay = store.dispatch(principal, accepted.operation_id); assert.equal(readyReplay.code, 'replayed'); assert.equal(projectApplyResult(readyReplay).status, 'ready');
    for (const mutate of [op => op.tasks = [null], op => op.tasks[0].changes = [null], op => op.tasks = [],
      op => op.logical_operation_id = 'op.other', op => op.approval = true, op => op.tasks[0].changes[0].value = 'unsupported']) {
      const malformed = structuredClone(ready); mutate(malformed.operation);
      assert.equal(projectApplyResult(malformed).ok, false); assert.equal(projectApplyResult(malformed).operation_id, undefined);
    }
    const cancelled = store.cancel(principal, accepted.operation_id); assert.equal(projectApplyResult(cancelled).status, 'cancelled');
    const cancelledReplay = store.apply(principal, payload); assert.equal(cancelledReplay.ok, false); assert.equal(projectApplyResult(cancelledReplay).status, 'cancelled');
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});


test('genuine Apply replay acknowledges ready metadata without claiming a new typed handoff or artwork', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'control-ready-ack-')), state = fixtureState();
  const store = new ApplyStore(join(dir, 'controls.sqlite'), () => projection(state));
  try {
    const payload = action(state), accepted = store.apply(principal, payload);
    const ready = store.dispatch(principal, accepted.operation_id), before = store.counts();
    assert.equal(projectApplyResult(ready).ok, true); assert.equal(projectApplyResult(ready).acknowledgment_only, undefined);
    const replay = store.apply(principal, payload);
    assert.equal(replay.ok, true); assert.equal(replay.code, 'replayed'); assert.equal(replay.status, 'ready'); assert.equal(replay.replayed, true);
    assert.equal(replay.operation_id, accepted.operation_id); assert.equal(Object.hasOwn(replay, 'operation'), false);
    const view = projectApplyResult(replay);
    assert.equal(view.ok, true); assert.equal(view.acknowledgment_only, true); assert.equal(view.operation_id, accepted.operation_id); assert.equal(view.status, 'ready');
    assert.equal(view.operation, undefined); assert.equal(view.result, undefined); assert.equal(view.backend_job_id, undefined);
    assert.deepEqual(store.counts(), before); assert.deepEqual(before, { jobs: 1, image_calls: 0, jev_calls: 0 });
    // Missing operation is the producer's acknowledgment form; malformed
    // supplied operation, completion, replay flag or reference stays invalid.
    for (const override of [{ operation: null }, { operation: {} }, { operation: [] }, { operation: { ...ready.operation, approval: true } },
      { operation: { ...ready.operation, logical_operation_id: 'op.other' } }, { status: 'completed' }, { replayed: false },
      { code: 'ready' }, { result: {} }, { operation_id: 'op.access_token:private' }]) {
      const rejected = projectApplyResult({ ...replay, ...override });
      assert.equal(rejected.ok, false); assert.equal(rejected.operation_id, undefined); assert.equal(rejected.acknowledgment_only, undefined);
      assert.equal(applyErrorMessage(rejected), fallback);
    }
  } finally { store.close(); await rm(dir, { recursive: true, force: true }); }
});
