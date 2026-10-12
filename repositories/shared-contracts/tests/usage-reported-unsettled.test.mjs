import test from 'node:test';
import assert from 'node:assert/strict';
import { validateContractVersion } from '../generated/index.mjs';
import {
  checkProviderReportedCostEvidence,
  checkReportedUnsettledUsageEvent,
  providerReportedCostEvidenceContentHash
} from '../tooling/usage-reported-unsettled.mjs';
import { hashBytes, hashManifest } from '../tooling/runtime.mjs';
import { clone, valid, updateEvidence, expectFailure, evidenceReference } from './usage-reported-unsettled-fixtures.mjs';

test('exact USD report remains known with null request ID and unknown usage on timeout', () => {
  const seed = valid();
  const result = checkReportedUnsettledUsageEvent(seed.value, seed.context);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.valuation.money.amount, '0.000003');
  assert.equal(result.value.valuation.money.currency, 'USD');
  assert.equal(result.value.valuation.rate_card_ref, null);
  assert.equal(result.value.provider_request_id, null);
  assert.equal(result.value.completeness, 'unknown');
  assert.equal(result.value.usage_units, null);
  assert.equal(result.value.outcome, 'timeout');
  assert.equal(result.value.reconciliation_ref, null);
});

test('known provider cost is independent of cancelled and unknown outcomes', () => {
  for (const outcome of ['cancelled', 'unknown']) {
    const seed = valid();
    seed.value.outcome = outcome;
    assert.equal(checkReportedUnsettledUsageEvent(seed.value, seed.context).ok, true);
  }
});

test('unknown evidence remains null and cannot claim the reported valuation branch', () => {
  const seed = valid();
  updateEvidence(seed, evidence => { evidence.reported_cost = { state: 'unknown', money: null }; });
  assert.equal(checkProviderReportedCostEvidence(seed.context.evidence_lookup.record).ok, true);
  expectFailure(checkReportedUnsettledUsageEvent(seed.value, seed.context), 'UNKNOWN_USAGE', '/evidence_lookup/record/reported_cost');
  const unknownEvent = clone(seed.value);
  unknownEvent.valuation = { basis: 'unknown', money: null, rate_card_ref: null };
  assert.equal(validateContractVersion('UsageEvent', '2.0.0', unknownEvent).ok, true);
  assert.equal(checkReportedUnsettledUsageEvent(unknownEvent, seed.context).errors[0].code, 'UNSUPPORTED_CASE');
});

test('missing money rejects and a fabricated zero conflicts with the resolved report', () => {
  const missing = valid();
  missing.value.valuation.money = null;
  expectFailure(checkReportedUnsettledUsageEvent(missing.value, missing.context), 'INVALID_PAYLOAD', '/valuation');

  const zero = valid();
  zero.value.valuation.money = { amount: '0', currency: 'USD', scale: 0 };
  expectFailure(checkReportedUnsettledUsageEvent(zero.value, zero.context), 'OBSERVATION_CONFLICT', '/valuation/money');
});

test('exact decimal scale and USD are enforced without rounding', () => {
  const excessScale = valid();
  excessScale.value.valuation.money = { amount: '0.0000001', currency: 'USD', scale: 6 };
  expectFailure(checkReportedUnsettledUsageEvent(excessScale.value, excessScale.context), 'INVALID_MONEY', '/valuation/money/amount');

  const wrongCurrency = valid();
  wrongCurrency.value.valuation.money.currency = 'EUR';
  assert.equal(validateContractVersion('UsageEvent', '2.0.0', wrongCurrency.value).ok, false);

  const tooManyScaleDigits = valid();
  tooManyScaleDigits.value.valuation.money.scale = 19;
  assert.equal(validateContractVersion('UsageEvent', '2.0.0', tooManyScaleDigits.value).ok, false);

  const numericAmount = valid();
  numericAmount.value.valuation.money.amount = 0.000003;
  assert.equal(validateContractVersion('UsageEvent', '2.0.0', numericAmount.value).ok, false);

  const rateCard = valid();
  rateCard.value.valuation.rate_card_ref = {};
  assert.equal(validateContractVersion('UsageEvent', '2.0.0', rateCard.value).ok, false);

  const reconciliation = valid();
  reconciliation.value.reconciliation_ref = {};
  assert.equal(validateContractVersion('UsageEvent', '2.0.0', reconciliation.value).ok, false);
});

test('record commitment is domain-separated and binds its source-byte commitment', () => {
  const seed = valid();
  const record = seed.context.evidence_lookup.record;
  const unsigned = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'content_hash'));
  assert.equal(providerReportedCostEvidenceContentHash(record), record.content_hash);
  assert.notEqual(record.content_hash, hashManifest(unsigned));
  assert.notEqual(record.content_hash, record.source_bytes_hash);

  const tampered = clone(record);
  tampered.source_bytes_hash = hashBytes(new TextEncoder().encode('different synthetic source bytes'));
  expectFailure(checkProviderReportedCostEvidence(tampered), 'INVALID_PAYLOAD', '/content_hash');
});

test('missing, revoked and unverified resolver results reject', () => {
  for (const status of ['missing', 'revoked', 'unverified']) {
    const seed = valid();
    seed.context.evidence_lookup.status = status;
    expectFailure(checkReportedUnsettledUsageEvent(seed.value, seed.context), 'INVALID_TRUST_CONTEXT', '/evidence_lookup/status');
  }
  const absent = valid();
  delete absent.context.evidence_lookup;
  expectFailure(checkReportedUnsettledUsageEvent(absent.value, absent.context), 'INVALID_TRUST_CONTEXT', '/evidence_lookup');
});

test('event and resolver references must match the actual immutable record', () => {
  const expectedMismatch = valid();
  expectedMismatch.context.evidence_lookup.expected_reference.id = '123e4567-e89b-42d3-a456-000000000032';
  expectFailure(checkReportedUnsettledUsageEvent(expectedMismatch.value, expectedMismatch.context), 'REFERENCE_MISMATCH', '/valuation/provider_evidence_ref');

  const recordMismatch = valid();
  const priorReference = evidenceReference(recordMismatch.context.evidence_lookup.record);
  updateEvidence(recordMismatch, evidence => { evidence.evidence_id = '123e4567-e89b-42d3-a456-000000000033'; });
  recordMismatch.context.evidence_lookup.expected_reference = priorReference;
  recordMismatch.value.valuation.provider_evidence_ref = priorReference;
  expectFailure(checkReportedUnsettledUsageEvent(recordMismatch.value, recordMismatch.context), 'REFERENCE_MISMATCH', '/evidence_lookup/record');

  const sourceBytesMismatch = valid();
  sourceBytesMismatch.context.evidence_lookup.source_bytes_hash = 'sha256:' + 'd'.repeat(64);
  expectFailure(checkReportedUnsettledUsageEvent(sourceBytesMismatch.value, sourceBytesMismatch.context), 'REFERENCE_MISMATCH', '/evidence_lookup/source_bytes_hash');
});

test('scope, provider, model, source, attempt and request bindings must match', () => {
  const badScope = valid();
  badScope.context.scope.tenant_id = '123e4567-e89b-42d3-a456-000000000099';
  expectFailure(checkReportedUnsettledUsageEvent(badScope.value, badScope.context), 'SCOPE_MISMATCH', '/tenant_id');

  for (const [field, expectedPath] of [
    ['provider', '/provider'],
    ['model', '/model'],
    ['source', '/source']
  ]) {
    const seed = valid();
    updateEvidence(seed, evidence => { evidence[field] = field === 'source' ? 'billing_export' : 'different_value'; });
    expectFailure(checkReportedUnsettledUsageEvent(seed.value, seed.context), 'REFERENCE_MISMATCH', expectedPath);
  }

  const observation = valid();
  updateEvidence(observation, evidence => { evidence.source_observation_id = '123e4567-e89b-42d3-a456-000000000044'; });
  expectFailure(checkReportedUnsettledUsageEvent(observation.value, observation.context), 'REFERENCE_MISMATCH', '/source_observation_id');

  const attempt = valid();
  updateEvidence(attempt, evidence => { evidence.source_scope.provider_attempt_id = '123e4567-e89b-42d3-a456-000000000034'; });
  expectFailure(checkReportedUnsettledUsageEvent(attempt.value, attempt.context), 'IDENTITY_COLLISION', '/provider_attempt_id');

  const request = valid();
  request.value.provider_request_id = 'mismatched-request';
  expectFailure(checkReportedUnsettledUsageEvent(request.value, request.context), 'IDENTITY_COLLISION', '/provider_request_id');

  const mode = valid();
  mode.value.billing_mode = 'live';
  expectFailure(checkReportedUnsettledUsageEvent(mode.value, mode.context), 'SCOPE_MISMATCH', '/billing_mode');
});

test('aggregate evidence is never promoted to an attempt by a matching amount', () => {
  const seed = valid();
  updateEvidence(seed, evidence => {
    evidence.source_scope = {
      kind: 'per_key_aggregate',
      aggregate_key: 'synthetic-key',
      period_start: '2026-10-10T11:00:00Z',
      period_end: '2026-10-10T12:00:00Z'
    };
  });
  expectFailure(checkReportedUnsettledUsageEvent(seed.value, seed.context), 'UNSUPPORTED_CASE', '/evidence_lookup/record/source_scope');
});

test('source clock and resolver clock are checked against the event and trusted now', () => {
  const sourceTime = valid();
  updateEvidence(sourceTime, evidence => { evidence.source_observed_at = '2026-10-10T12:00:00Z'; });
  expectFailure(checkReportedUnsettledUsageEvent(sourceTime.value, sourceTime.context), 'REFERENCE_MISMATCH', '/observed_at');

  const futureEvent = valid();
  futureEvent.value.ingested_at = '2026-10-10T12:06:00Z';
  expectFailure(checkReportedUnsettledUsageEvent(futureEvent.value, futureEvent.context), 'INVALID_TRUST_CONTEXT', '/now');

  const futureLookup = valid();
  futureLookup.context.evidence_lookup.resolved_at = '2026-10-10T12:06:00Z';
  expectFailure(checkReportedUnsettledUsageEvent(futureLookup.value, futureLookup.context), 'INVALID_TRUST_CONTEXT', '/evidence_lookup/resolved_at');
});

test('malformed contexts return typed errors instead of throwing', () => {
  const seed = valid();
  seed.context.loop = seed.context;
  expectFailure(checkReportedUnsettledUsageEvent(seed.value, seed.context), 'INVALID_TRUST_CONTEXT', '');
  const badClock = valid();
  badClock.context.now = 'not-a-time';
  expectFailure(checkReportedUnsettledUsageEvent(badClock.value, badClock.context), 'INVALID_TRUST_CONTEXT', '');
});
