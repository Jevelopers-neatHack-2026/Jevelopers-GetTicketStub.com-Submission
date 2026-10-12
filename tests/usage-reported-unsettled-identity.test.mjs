import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkOperation, checkUsageEvent, compareUsageIdentity } from '../generated/index.mjs';
import { checkFinanceOperation } from '../tooling/finance-v2.mjs';
import {
  checkReportedUnsettledUsageEvent,
  compareReportedUnsettledUsageIdentity
} from '../tooling/usage-reported-unsettled.mjs';
import { clone, valid, updateEvidence, expectFailure, v1Fixture } from './usage-reported-unsettled-fixtures.mjs';

const reviewerCycle = JSON.parse(readFileSync(new URL('./usage-reported-unsettled-cycle-inputs.json', import.meta.url), 'utf8'));

test('redelivery remains duplicate across changed transport and envelope fields', () => {
  const seed = valid();
  const duplicate = clone(seed.value);
  duplicate.event_id = '123e4567-e89b-42d3-a456-000000000035';
  duplicate.correlation_id = '123e4567-e89b-42d3-a456-000000000036';
  duplicate.transport_attempt_id = '123e4567-e89b-42d3-a456-000000000037';
  duplicate.ingested_at = '2026-10-10T12:00:04Z';
  assert.deepEqual(compareReportedUnsettledUsageIdentity(seed.value, duplicate), {ok:true,value:'duplicate_observation'});
});

test('same-observation economic or evidence changes conflict while attempt identity changes collide', () => {
  const seed = valid();
  const changedMoney = clone(seed.value);
  changedMoney.valuation.money.amount = '0.000004';
  expectFailure(compareReportedUnsettledUsageIdentity(seed.value, changedMoney), 'OBSERVATION_CONFLICT', '/valuation');

  const changedEvidence = clone(seed.value);
  changedEvidence.valuation.provider_evidence_ref.content_hash = 'sha256:' + 'f'.repeat(64);
  expectFailure(compareReportedUnsettledUsageIdentity(seed.value, changedEvidence), 'OBSERVATION_CONFLICT', '/valuation');

  const changedAttempt = clone(seed.value);
  changedAttempt.billable_attempt_id = '123e4567-e89b-42d3-a456-000000000038';
  expectFailure(compareReportedUnsettledUsageIdentity(seed.value, changedAttempt), 'IDENTITY_COLLISION', '/billable_attempt_id');
});

test('corrections require a new observation ID and exact supersession; late old events stay stale', () => {
  const original = valid();
  const originalBytes = JSON.stringify(original.value);
  const corrected = valid();
  corrected.value.source_observation_id = '123e4567-e89b-42d3-a456-000000000039';
  corrected.value.usage_event_id = '123e4567-e89b-42d3-a456-000000000040';
  corrected.value.supersedes_observation_id = original.value.source_observation_id;
  corrected.value.observed_at = '2026-10-10T12:00:05Z';
  corrected.value.ingested_at = '2026-10-10T12:00:06Z';
  corrected.value.valuation.money.amount = '0.000004';
  corrected.context.prior = original.value;
  updateEvidence(corrected, evidence => {
    evidence.evidence_id = '123e4567-e89b-42d3-a456-000000000041';
    evidence.source_observation_id = corrected.value.source_observation_id;
    evidence.source_observed_at = corrected.value.observed_at;
    evidence.reported_cost.money.amount = '0.000004';
  });
  corrected.context.evidence_lookup.resolved_at = '2026-10-10T12:00:07Z';
  assert.equal(checkReportedUnsettledUsageEvent(corrected.value, corrected.context).ok, true);
  assert.equal(compareReportedUnsettledUsageIdentity(original.value, corrected.value).value, 'superseding_observation');
  assert.equal(JSON.stringify(original.value), originalBytes);

  const unlinked = clone(corrected.value);
  unlinked.supersedes_observation_id = null;
  expectFailure(compareReportedUnsettledUsageIdentity(original.value, unlinked), 'OBSERVATION_CONFLICT', '/valuation');

  const late = valid();
  late.context.prior = corrected.value;
  expectFailure(checkReportedUnsettledUsageEvent(late.value, late.context), 'STALE_REVISION', '/source_observation_id');
});

test('sealed mutual supersession rejects both comparison and helper prior directions', () => {
  const { first, second } = clone(reviewerCycle);
  const originalBytes = JSON.stringify({ first, second });

  expectFailure(compareReportedUnsettledUsageIdentity(first.value, second.value), 'IDENTITY_COLLISION', '/supersedes_observation_id');
  expectFailure(compareReportedUnsettledUsageIdentity(second.value, first.value), 'IDENTITY_COLLISION', '/supersedes_observation_id');
  expectFailure(checkReportedUnsettledUsageEvent(first.value, first.context), 'IDENTITY_COLLISION', '/supersedes_observation_id');
  expectFailure(checkReportedUnsettledUsageEvent(second.value, second.context), 'IDENTITY_COLLISION', '/supersedes_observation_id');
  assert.equal(JSON.stringify({ first, second }), originalBytes);

  const earlier = clone(first.value);
  earlier.supersedes_observation_id = null;
  const later = clone(second.value);
  assert.deepEqual(compareReportedUnsettledUsageIdentity(earlier, later), { ok: true, value: 'superseding_observation' });
  assert.deepEqual(compareReportedUnsettledUsageIdentity(later, earlier), { ok: true, value: 'superseded_observation' });
  assert.equal(checkReportedUnsettledUsageEvent(later, { ...second.context, prior: earlier }).ok, true);
  expectFailure(
    checkReportedUnsettledUsageEvent(earlier, { ...first.context, prior: later }),
    'STALE_REVISION',
    '/source_observation_id'
  );
});

test('v1 public helpers and Finance surfaces reject UsageEvent/2.0.0', () => {
  const seed = valid();
  expectFailure(checkUsageEvent(seed.value, seed.context), 'UNSUPPORTED_VERSION', '/schema_version');
  expectFailure(compareUsageIdentity(seed.value, seed.value), 'UNSUPPORTED_VERSION', '/schema_version');
  expectFailure(checkOperation('UsageEvent', seed.value, seed.context), 'UNSUPPORTED_VERSION', '/schema_version');
  const finance = checkFinanceOperation('UsageEvent', seed.value, {});
  assert.equal(finance.ok, false);
  assert.equal(finance.errors[0].code, 'UNKNOWN_CONTRACT');
});

test('v1 provider_confirmed remains unreconciled with its synthetic applicable-rate control', () => {
  const value = clone(v1Fixture.valid);
  value.valuation.basis = 'provider_confirmed';
  const context = {
    scope: {tenant_id:value.tenant_id,project_id:value.project_id},
    now: '2026-10-10T12:05:00Z',
    policy_version: '1.0.0',
    environment: value.environment,
    billing_mode: value.billing_mode,
    references: {
      'valuation/rate_card_ref': value.valuation.rate_card_ref,
      'retry_mapping_ref': value.retry_mapping_ref
    }
  };
  const result = checkUsageEvent(value, context);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.valuation.basis, 'provider_confirmed');
  assert.equal(result.value.reconciliation_ref, null);
});

test('v1 rejects a mismatched RateCard reference without inferring reconciliation', () => {
  const value = clone(v1Fixture.valid);
  value.valuation.basis = 'provider_confirmed';
  const expectedRate = { ...value.valuation.rate_card_ref, id: '123e4567-e89b-42d3-a456-000000000045' };
  const context = {
    scope: {tenant_id:value.tenant_id,project_id:value.project_id},
    now: '2026-10-10T12:05:00Z',
    policy_version: '1.0.0',
    environment: value.environment,
    billing_mode: value.billing_mode,
    references: {
      'valuation/rate_card_ref': expectedRate,
      'retry_mapping_ref': value.retry_mapping_ref
    }
  };
  expectFailure(checkUsageEvent(value, context), 'REFERENCE_MISMATCH', '/valuation/rate_card_ref');
});
