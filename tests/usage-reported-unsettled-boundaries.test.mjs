import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkOperation,
  checkUsageEvent,
  compareUsageIdentity
} from '../generated/index.mjs';
import {
  checkProviderReportedCostEvidence,
  checkReportedUnsettledUsageEvent,
  compareReportedUnsettledUsageIdentity,
  providerReportedCostEvidenceContentHash
} from '../tooling/usage-reported-unsettled.mjs';
import { ContractError } from '../tooling/runtime.mjs';
import { clone, valid, expectFailure, v1Fixture } from './usage-reported-unsettled-fixtures.mjs';

function withSchemaAccessor(value, throws = true) {
  const input = clone(value);
  let calls = 0;
  Object.defineProperty(input, 'schema_version', {
    configurable: true,
    enumerable: true,
    get() {
      calls++;
      if (throws) throw new Error('schema getter executed');
      return '2.0.0';
    }
  });
  return { input, calls: () => calls };
}

function deeplyNested(depth) {
  let value = {};
  for (let index = 0; index < depth; index++) value = { child: value };
  return value;
}

test('v1 UsageEvent entrypoints reject schema accessors before invoking them', () => {
  for (const [name, check] of [
    ['checkUsageEvent', input => checkUsageEvent(input, null)],
    ['compareUsageIdentity', input => compareUsageIdentity(input, v1Fixture.valid)],
    ['checkOperation', input => checkOperation('UsageEvent', input, null)]
  ]) {
    const throwing = withSchemaAccessor(v1Fixture.valid);
    const result = check(throwing.input);
    expectFailure(result, 'NON_JSON_VALUE', '');
    assert.equal(throwing.calls(), 0, name + ' invoked a throwing getter');

    const returning = withSchemaAccessor(v1Fixture.valid, false);
    expectFailure(check(returning.input), 'NON_JSON_VALUE', '');
    assert.equal(returning.calls(), 0, name + ' invoked a returning getter');
  }
});

test('all public v2 boundaries preflight accessors on either comparison operand', () => {
  const seed = valid();
  const evidence = withSchemaAccessor(seed.context.evidence_lookup.record);
  expectFailure(checkProviderReportedCostEvidence(evidence.input), 'NON_JSON_VALUE', '');
  assert.equal(evidence.calls(), 0);

  const event = withSchemaAccessor(seed.value);
  expectFailure(checkReportedUnsettledUsageEvent(event.input, seed.context), 'NON_JSON_VALUE', '');
  assert.equal(event.calls(), 0);

  for (const side of ['left', 'right']) {
    const accessor = withSchemaAccessor(seed.value);
    const result = side === 'left'
      ? compareReportedUnsettledUsageIdentity(accessor.input, seed.value)
      : compareReportedUnsettledUsageIdentity(seed.value, accessor.input);
    expectFailure(result, 'NON_JSON_VALUE', '');
    assert.equal(accessor.calls(), 0, side + ' comparison operand getter ran');
  }

  const hashInput = withSchemaAccessor(seed.context.evidence_lookup.record);
  assert.throws(
    () => providerReportedCostEvidenceContentHash(hashInput.input),
    error => error instanceof ContractError && error.code === 'NON_JSON_VALUE'
  );
  assert.equal(hashInput.calls(), 0);
});

test('canonical preflight rejects hidden properties, symbols, and resource excess', () => {
  const seed = valid();
  const hidden = clone(seed.value);
  Object.defineProperty(hidden, 'private_extension', { value: true, enumerable: false });
  expectFailure(checkReportedUnsettledUsageEvent(hidden, seed.context), 'NON_JSON_VALUE', '');

  const symbolic = clone(seed.context.evidence_lookup.record);
  symbolic[Symbol('unserialized')] = true;
  expectFailure(checkProviderReportedCostEvidence(symbolic), 'NON_JSON_VALUE', '');
  assert.throws(
    () => providerReportedCostEvidenceContentHash(symbolic),
    error => error instanceof ContractError && error.code === 'NON_JSON_VALUE'
  );

  const deepEvent = clone(seed.value);
  deepEvent.extra = deeplyNested(70);
  expectFailure(checkReportedUnsettledUsageEvent(deepEvent, seed.context), 'RESOURCE_LIMIT', '');

  const deepEvidence = clone(seed.context.evidence_lookup.record);
  deepEvidence.extra = deeplyNested(70);
  expectFailure(checkProviderReportedCostEvidence(deepEvidence), 'RESOURCE_LIMIT', '');
  assert.throws(
    () => providerReportedCostEvidenceContentHash(deepEvidence),
    error => error instanceof ContractError && error.code === 'RESOURCE_LIMIT'
  );
});

test('trusted context accessors are rejected without reading them', () => {
  const seed = valid();
  let calls = 0;
  Object.defineProperty(seed.context, 'now', {
    configurable: true,
    enumerable: true,
    get() {
      calls++;
      throw new Error('clock getter executed');
    }
  });
  expectFailure(checkReportedUnsettledUsageEvent(seed.value, seed.context), 'INVALID_TRUST_CONTEXT', '');
  assert.equal(calls, 0);
});

test('identity comparison rejects intrinsically invalid usage and money on both sides', () => {
  const seed = valid();
  const invalidMoney = clone(seed.value);
  invalidMoney.valuation.money = { amount: '0.1', currency: 'USD', scale: 0 };
  expectFailure(compareReportedUnsettledUsageIdentity(invalidMoney, seed.value), 'INVALID_MONEY', '/valuation/money/amount');
  expectFailure(compareReportedUnsettledUsageIdentity(seed.value, invalidMoney), 'INVALID_MONEY', '/valuation/money/amount');

  const invalidUsage = clone(seed.value);
  invalidUsage.completeness = 'unknown';
  invalidUsage.usage_units = [{ name: 'tokens', quantity: '0', scale: 0, relation: 'standalone' }];
  expectFailure(compareReportedUnsettledUsageIdentity(invalidUsage, seed.value), 'UNKNOWN_USAGE', '/usage_units');
  expectFailure(compareReportedUnsettledUsageIdentity(seed.value, invalidUsage), 'UNKNOWN_USAGE', '/usage_units');
});

test('same-observation source facts stay immutable and self-supersession rejects', () => {
  const seed = valid();
  const changedObservedAt = clone(seed.value);
  changedObservedAt.observed_at = '2026-10-10T12:00:03Z';
  expectFailure(compareReportedUnsettledUsageIdentity(seed.value, changedObservedAt), 'OBSERVATION_CONFLICT', '/observed_at');

  const changedProducer = clone(seed.value);
  changedProducer.producer.build_revision = 'synthetic-different-build';
  expectFailure(compareReportedUnsettledUsageIdentity(seed.value, changedProducer), 'IDENTITY_COLLISION', '/producer');

  const selfSuperseding = clone(seed.value);
  selfSuperseding.supersedes_observation_id = selfSuperseding.source_observation_id;
  expectFailure(compareReportedUnsettledUsageIdentity(selfSuperseding, seed.value), 'IDENTITY_COLLISION', '/supersedes_observation_id');
  const prior = valid();
  prior.context.prior = selfSuperseding;
  expectFailure(checkReportedUnsettledUsageEvent(selfSuperseding, prior.context), 'IDENTITY_COLLISION', '/supersedes_observation_id');
});
