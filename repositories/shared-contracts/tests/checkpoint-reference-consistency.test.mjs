import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../scripts/generate.mjs';
import { fixturePayload, assertFixture } from '../tooling/fixture-harness.mjs';
import { checkProductionBundle, checkResearchBatchReceipt, commerceContentHash, hashManifest, validateContract } from '../generated/index.mjs';

async function positive(contract) {
  const fixture = await readJson('fixtures/' + contract + '.json');
  const row = fixture.cases.find(row => row.mode && row.expected.ok);
  const context = structuredClone(row.context);
  if (context.artifact_bytes) context.artifact_bytes = Object.fromEntries(Object.entries(context.artifact_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
  return { value: fixturePayload(fixture, row), context };
}

for (const [field, replacement] of [
  ['contract', 'OrderAuthorization'],
  ['revision', 999],
  ['id', '123e4567-e89b-42d3-a456-000000099009'],
  ['content_hash', 'sha256:' + '9'.repeat(64)]
]) test('SC-CHK-009 rejects rebound handoff ' + field, async () => {
  // Given a wire-valid bundle whose declared reference and digest were rebound together.
  const { value, context } = await positive('ProductionBundle');
  value.handoff_ref[field] = replacement;
  context.references.handoff_ref = structuredClone(value.handoff_ref);
  value.bundle_hash = commerceContentHash(value, 'bundle_hash');
  assert.equal(validateContract(value.contract, value).ok, true);
  // When checked against the independent original handoff.
  const result = checkProductionBundle(value, context);
  // Then contradictory provenance is rejected at its reference.
  assertFixture(result, { ok: false, code: 'REFERENCE_MISMATCH', path: '/handoff_ref' });
});

test('SC-CHK-009 preserves an exact handoff tuple', async () => {
  // Given the genuine bundle and handoff.
  const { value, context } = await positive('ProductionBundle');
  // When their immutable provenance is checked.
  const result = checkProductionBundle(value, context);
  // Then the bundle remains usable.
  assert.equal(result.ok, true);
});

function batchOutcome(value, context, outcome) {
  value.successful_request_ids = outcome === 'successful' ? [...value.request_ids] : [];
  value.failed_request_ids = outcome === 'failed' ? [...value.request_ids] : [];
  value.pending_request_ids = outcome === 'pending' ? [...value.request_ids] : [];
  if (outcome !== 'successful') {
    value.answer_receipt_refs = [];
    delete context.references['answer_receipt_refs/0'];
  }
}

for (const policy of ['partial', 'all_or_nothing']) {
  for (const [status, outcome, accepted] of [
    ['rejected', 'successful', false], ['rejected', 'pending', false], ['rejected', 'failed', true],
    ['accepted', 'successful', true], ['accepted', 'failed', true], ['accepted', 'pending', true],
    ['duplicate', 'successful', false], ['duplicate', 'failed', false], ['duplicate', 'pending', true],
    ['unknown', 'pending', true]
  ]) test('SC-CHK-010 ' + policy + ' admission ' + status + ' with ' + outcome + ' outcome', async () => {
    // Given an exact bound admission receipt with a separately selected batch outcome.
    const { value, context } = await positive('ResearchBatchReceipt');
    value.acceptance_policy = context.acceptance_policy = policy;
    const receipt = context.request_receipts[0];
    receipt.status = status;
    receipt.error_ref = status === 'rejected' ? { ...receipt.policy_ref, contract: 'ErrorEnvelope' } : null;
    value.request_receipt_refs[0].content_hash = hashManifest(receipt);
    context.references['request_receipt_refs/0'] = structuredClone(value.request_receipt_refs[0]);
    batchOutcome(value, context, outcome);
    assert.equal(validateContract('ResearchRequestReceipt', receipt).ok, true);
    assert.equal(validateContract(value.contract, value).ok, true);
    // When the batch reconciles admission evidence and outcome membership.
    const result = checkResearchBatchReceipt(value, context);
    // Then rejection is terminal failure; accepted work may still succeed, fail or be pending.
    // Duplicate admission remains unresolved without an independently supplied prior admission.
    if (accepted) assert.equal(result.ok, true);
    else assertFixture(result, { ok: false, code: 'INVALID_BATCH', path: '/' + outcome + '_request_ids' });
  });
}

for (const rejectedOutcome of ['failed', 'successful']) test('SC-CHK-010 mixed partial batch with rejected member ' + rejectedOutcome, async () => {
  // Given admitted successful work and a second independently bound rejected request.
  const { value, context } = await positive('ResearchBatchReceipt');
  const rejected = structuredClone(context.request_receipts[0]);
  rejected.request_id = '123e4567-e89b-42d3-a456-000000099010';
  rejected.receipt_id = '123e4567-e89b-42d3-a456-000000099011';
  rejected.request_ref.id = rejected.request_id;
  rejected.status = 'rejected';
  rejected.error_ref = { ...rejected.policy_ref, contract: 'ErrorEnvelope' };
  context.request_receipts.push(rejected);
  value.request_ids.push(rejected.request_id);
  context.request_ids.push(rejected.request_id);
  value.request_receipt_refs.push({ ...value.request_receipt_refs[0], id: rejected.receipt_id, content_hash: hashManifest(rejected) });
  context.references['request_receipt_refs/1'] = structuredClone(value.request_receipt_refs[1]);
  value[rejectedOutcome + '_request_ids'].push(rejected.request_id);
  // When partial acceptance is checked.
  const result = checkResearchBatchReceipt(value, context);
  // Then genuine partial success is retained, while rejected success is refused.
  if (rejectedOutcome === 'failed') assert.equal(result.ok, true);
  else assertFixture(result, { ok: false, code: 'INVALID_BATCH', path: '/successful_request_ids' });
});
