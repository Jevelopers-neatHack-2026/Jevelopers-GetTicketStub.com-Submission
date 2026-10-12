import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {
  checkProviderReportedCostEvidence,
  checkReportedUnsettledUsageEvent,
  compareReportedUnsettledUsageIdentity,
  providerReportedCostEvidenceContentHash
} from '@jevelopers/shared-contracts/usage-reported-unsettled';
import { checkOperation, checkUsageEvent, compareUsageIdentity } from '@jevelopers/shared-contracts/operations';

const fixture = JSON.parse(await readFile(new URL('../fixtures/UsageEvent.2_0_0.json', import.meta.url), 'utf8'));
const v1Fixture = JSON.parse(await readFile(new URL('../fixtures/UsageEvent.json', import.meta.url), 'utf8'));
const checked = checkReportedUnsettledUsageEvent(fixture.valid, fixture.context);
if (!checked.ok) {
  process.stderr.write(JSON.stringify({ status: 'synthetic_candidate_rejected', errors: checked.errors }) + '\n');
  process.exitCode = 1;
} else {
  function accessor(value) {
    const input = structuredClone(value);
    let calls = 0;
    Object.defineProperty(input, 'schema_version', {
      configurable: true,
      enumerable: true,
      get() {
        calls++;
        throw new Error('schema getter executed');
      }
    });
    return { input, calls: () => calls };
  }
  function failure(result, code) {
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(error => error.code === code), JSON.stringify(result.errors));
  }
  function deepValue(depth) {
    let value = {};
    for (let index = 0; index < depth; index++) value = { child: value };
    return value;
  }

  for (const [name, check] of [
    ['checkUsageEvent', input => checkUsageEvent(input, null)],
    ['compareUsageIdentity', input => compareUsageIdentity(input, v1Fixture.valid)],
    ['checkOperation', input => checkOperation('UsageEvent', input, null)]
  ]) {
    const guarded = accessor(v1Fixture.valid);
    failure(check(guarded.input), 'NON_JSON_VALUE');
    assert.equal(guarded.calls(), 0, name + ' getter ran');
  }

  const evidenceAccessor = accessor(fixture.context.evidence_lookup.record);
  failure(checkProviderReportedCostEvidence(evidenceAccessor.input), 'NON_JSON_VALUE');
  assert.equal(evidenceAccessor.calls(), 0);
  const eventAccessor = accessor(fixture.valid);
  failure(checkReportedUnsettledUsageEvent(eventAccessor.input, fixture.context), 'NON_JSON_VALUE');
  assert.equal(eventAccessor.calls(), 0);
  const comparisonAccessor = accessor(fixture.valid);
  failure(compareReportedUnsettledUsageIdentity(fixture.valid, comparisonAccessor.input), 'NON_JSON_VALUE');
  assert.equal(comparisonAccessor.calls(), 0);
  const hashAccessor = accessor(fixture.context.evidence_lookup.record);
  assert.throws(
    () => providerReportedCostEvidenceContentHash(hashAccessor.input),
    error => error?.name === 'ContractError' && error.code === 'NON_JSON_VALUE'
  );
  assert.equal(hashAccessor.calls(), 0);

  const invalidMoney = structuredClone(fixture.valid);
  invalidMoney.valuation.money = { amount: '0.1', currency: 'USD', scale: 0 };
  failure(compareReportedUnsettledUsageIdentity(invalidMoney, fixture.valid), 'INVALID_MONEY');
  failure(compareReportedUnsettledUsageIdentity(fixture.valid, invalidMoney), 'INVALID_MONEY');
  const invalidUsage = structuredClone(fixture.valid);
  invalidUsage.completeness = 'unknown';
  invalidUsage.usage_units = [{ name: 'tokens', quantity: '0', scale: 0, relation: 'standalone' }];
  failure(compareReportedUnsettledUsageIdentity(invalidUsage, fixture.valid), 'UNKNOWN_USAGE');
  failure(compareReportedUnsettledUsageIdentity(fixture.valid, invalidUsage), 'UNKNOWN_USAGE');

  const duplicate = structuredClone(fixture.valid);
  duplicate.event_id = '123e4567-e89b-42d3-a456-000000000035';
  duplicate.correlation_id = '123e4567-e89b-42d3-a456-000000000036';
  duplicate.transport_attempt_id = '123e4567-e89b-42d3-a456-000000000037';
  duplicate.ingested_at = '2026-10-10T12:00:04Z';
  assert.equal(compareReportedUnsettledUsageIdentity(fixture.valid, duplicate).value, 'duplicate_observation');
  const correction = structuredClone(fixture.valid);
  correction.event_id = '123e4567-e89b-42d3-a456-000000000040';
  correction.usage_event_id = '123e4567-e89b-42d3-a456-000000000040';
  correction.source_observation_id = '123e4567-e89b-42d3-a456-000000000039';
  correction.supersedes_observation_id = fixture.valid.source_observation_id;
  correction.observed_at = '2026-10-10T12:00:05Z';
  correction.valuation.money.amount = '0.000004';
  correction.valuation.provider_evidence_ref.id = '123e4567-e89b-42d3-a456-000000000044';
  correction.valuation.provider_evidence_ref.content_hash = 'sha256:' + 'f'.repeat(64);
  assert.equal(compareReportedUnsettledUsageIdentity(fixture.valid, correction).value, 'superseding_observation');
  assert.equal(compareReportedUnsettledUsageIdentity(correction, fixture.valid).value, 'superseded_observation');
  const selfSuperseding = structuredClone(fixture.valid);
  selfSuperseding.supersedes_observation_id = selfSuperseding.source_observation_id;
  failure(compareReportedUnsettledUsageIdentity(selfSuperseding, fixture.valid), 'IDENTITY_COLLISION');

  const hidden = structuredClone(fixture.valid);
  Object.defineProperty(hidden, 'private_extension', { value: true, enumerable: false });
  failure(checkReportedUnsettledUsageEvent(hidden, fixture.context), 'NON_JSON_VALUE');
  const symbolic = structuredClone(fixture.context.evidence_lookup.record);
  symbolic[Symbol('unserialized')] = true;
  failure(checkProviderReportedCostEvidence(symbolic), 'NON_JSON_VALUE');
  const deepEvent = structuredClone(fixture.valid);
  deepEvent.extra = deepValue(70);
  failure(checkReportedUnsettledUsageEvent(deepEvent, fixture.context), 'RESOURCE_LIMIT');
  const deepEvidence = structuredClone(fixture.context.evidence_lookup.record);
  deepEvidence.extra = deepValue(70);
  failure(checkProviderReportedCostEvidence(deepEvidence), 'RESOURCE_LIMIT');
  assert.throws(
    () => providerReportedCostEvidenceContentHash(deepEvidence),
    error => error?.name === 'ContractError' && error.code === 'RESOURCE_LIMIT'
  );

  const contextWithAccessor = structuredClone(fixture.context);
  let contextGetterCalls = 0;
  Object.defineProperty(contextWithAccessor, 'now', {
    configurable: true,
    enumerable: true,
    get() {
      contextGetterCalls++;
      throw new Error('clock getter executed');
    }
  });
  failure(checkReportedUnsettledUsageEvent(fixture.valid, contextWithAccessor), 'INVALID_TRUST_CONTEXT');
  assert.equal(contextGetterCalls, 0);

  process.stdout.write(JSON.stringify({
    status: 'synthetic_candidate_only',
    schema_version: checked.value.schema_version,
    basis: checked.value.valuation.basis,
    amount: checked.value.valuation.money.amount,
    currency: checked.value.valuation.money.currency,
    provider_request_id: checked.value.provider_request_id,
    authenticated_provider_receipt: false,
    installed_boundary_regressions: 'passed',
    installed_identity_regressions: 'passed'
  }) + '\n');
}
