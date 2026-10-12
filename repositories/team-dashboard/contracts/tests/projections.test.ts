import { describe, expect, it } from 'vitest';
import {
  SUPPORTED_CONTRACTS, UNSUPPORTED_INTERFACES, readEvidenceProjection, readFulfillmentStatus, readJobStatus, refuseUnsupported,
} from '../../src/data/shared-contracts-adapter';
import { NOW, caseOf, json, kit, manifest, payloadOf, scopeOf } from './support';

const evidence = manifest('EvidenceProjection'), job = manifest('JobStatus'), fulfillment = manifest('FulfillmentStatus');
const base = { kit, scope: scopeOf(), now: NOW, maxAgeMs: 3_600_000 };

describe('TD-01B EvidenceProjection', () => {
  const read = (payload: unknown, scope = scopeOf()) => readEvidenceProjection({ kit, scope, delivery: { kind: 'payload', json: json(payload) } });
  it('maps the sanitized projection and states that scope is only host-bound', () => {
    const result = read(evidence.valid);
    expect(result).toMatchObject({ status: 'ready', data: { outcome: 'passed', component: { name: 'shared-contracts' }, partition: { environment: 'test', billingMode: 'simulated' }, scopeBinding: 'host_request_only' } });
  });
  it('carries no tenant/project: a payload that tries to bring its own scope is refused as an unknown field', () => {
    expect(read({ ...evidence.valid, tenant_id: scopeOf().tenantId })).toMatchObject({ status: 'refused', code: 'INVALID_PAYLOAD' });
  });
  it('refuses sensitive nested locators, other partitions and tampered bytes', () => {
    const c = caseOf(evidence, 'nested-sensitive-locator');
    expect(read(payloadOf(evidence, c.id))).toMatchObject({ status: 'refused', code: c.expected.code, path: c.expected.path });
    expect(read({ ...evidence.valid, environment: 'production' })).toMatchObject({ status: 'refused', code: 'PARTITION_MISMATCH' });
    expect(read({ ...evidence.valid, billing_mode: 'live' })).toMatchObject({ status: 'refused', code: 'PARTITION_MISMATCH' });
    const digest = kit.hashManifest(evidence.valid);
    expect(readEvidenceProjection({ kit, scope: scopeOf(), delivery: { kind: 'payload', json: json(evidence.valid) }, expectedDigest: digest }).status).toBe('ready');
    expect(readEvidenceProjection({ kit, scope: scopeOf(), delivery: { kind: 'payload', json: json({ ...evidence.valid, outcome: 'failed' }) }, expectedDigest: digest })).toMatchObject({ code: 'DIGEST_MISMATCH' });
  });
  it('keeps an explicit unknown outcome unknown and never reports freshness it cannot know', () => {
    const result = read({ ...evidence.valid, outcome: 'unknown' });
    expect(result).toMatchObject({ status: 'ready', data: { outcome: 'unknown' } });
    expect(result).not.toHaveProperty('ageMs');
  });
  it('maps missing, restricted and unknown deliveries to explicit states', () => {
    for (const kind of ['absent', 'restricted', 'unknown'] as const) {
      const result = readEvidenceProjection({ kit, scope: scopeOf(), delivery: { kind } });
      expect(result.status).toBe(kind === 'absent' ? 'missing' : kind);
      expect(result).not.toHaveProperty('data');
    }
  });
});

describe('TD-01B JobStatus projection', () => {
  const read = (payload: unknown, over = {}) => readJobStatus({ ...base, delivery: { kind: 'payload', json: json(payload) }, ...over });
  it('maps state, outcome, execution and usage axes without conflating them', () => {
    expect(read(job.valid)).toMatchObject({ status: 'ready', data: { state: 'running', outcome: 'unknown', executionState: 'not_dispatched', usageCompleteness: 'unknown', progress: { completed: 1, total: 10 } } });
  });
  it('keeps unknown progress as null rather than zero', () => {
    const result = read(payloadOf(job, 'unknown-progress'));
    if (result.status !== 'ready') throw new Error(JSON.stringify(result));
    expect(result.data.progress.completed).toBeNull();
  });
  it('refuses forged tenant/job scope, other partitions, unsupported versions and invalid shapes', () => {
    expect(read({ ...job.valid, tenant_id: '123e4567-e89b-42d3-a456-426614174999' })).toMatchObject({ code: 'SCOPE_MISMATCH', path: '/tenant_id' });
    expect(read({ ...job.valid, environment: 'production' })).toMatchObject({ code: 'PARTITION_MISMATCH' });
    expect(read({ ...job.valid, schema_version: '2.0.0' })).toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    expect(read({ ...job.valid, extra: true })).toMatchObject({ code: 'INVALID_PAYLOAD' });
  });
  it('flags a stale status', () => {
    expect(read(job.valid, { now: '2026-10-11T00:00:00Z' })).toMatchObject({ status: 'stale' });
  });
});

describe('TD-01B FulfillmentStatus projection', () => {
  const orderId = fulfillment.valid.order_id as string;
  const read = (payload: unknown, over = {}) => readFulfillmentStatus({ ...base, expectedOrderId: orderId, delivery: { kind: 'payload', json: json(payload) }, ...over });
  it('maps statuses as separate axes', () => {
    expect(read(fulfillment.valid)).toMatchObject({ status: 'ready', data: { orderId, normalizedStatus: 'accepted', submissionOutcome: 'accepted', executionUncertainty: 'known', cancellation: 'not_requested' } });
  });
  it('preserves an ambiguous submission as unknown instead of a rejection or success', () => {
    const result = read(payloadOf(fulfillment, 'ambiguous-submission'));
    if (result.status !== 'ready') throw new Error(JSON.stringify(result));
    expect(result.data.submissionOutcome).toBe('unknown');
  });
  it('refuses a status for an order the authorized route did not ask for, and forged project scope', () => {
    expect(read(fulfillment.valid, { expectedOrderId: '123e4567-e89b-42d3-a456-000000000999' })).toMatchObject({ code: 'SCOPE_MISMATCH', path: '/order_id' });
    expect(read({ ...fulfillment.valid, project_id: '123e4567-e89b-42d3-a456-426614174999' })).toMatchObject({ code: 'SCOPE_MISMATCH', path: '/project_id' });
    expect(read(fulfillment.valid, { scope: scopeOf({ billingMode: 'live' }) })).toMatchObject({ code: 'PARTITION_MISMATCH' });
  });
});

describe('TD-01B explicit refusals for unsupported interfaces', () => {
  it('names Preview1/ArtifactFile2 eligibility as LEGACY_UNREPRESENTABLE', () => {
    expect(refuseUnsupported('Preview1/ArtifactFile2 eligibility')).toMatchObject({ status: 'refused', code: 'LEGACY_UNREPRESENTABLE' });
  });
  it.each(['CSV input activation', 'draft-row publication', 'repair/derived-composition', 'local UsageEvent pre-ingestion mapping'])('refuses %s as an unaccepted interface', (name) => {
    expect(refuseUnsupported(name)).toMatchObject({ status: 'refused', code: 'UNACCEPTED_INTERFACE' });
  });
  it('refuses any other contract by name and never approximates it', () => {
    expect(refuseUnsupported('BudgetReservation')).toMatchObject({ status: 'refused', code: 'UNSUPPORTED_INTERFACE' });
    expect(Object.keys(UNSUPPORTED_INTERFACES)).toHaveLength(5);
    expect(SUPPORTED_CONTRACTS).toEqual(['FinancialSummary', 'EvidenceProjection', 'JobStatus', 'FulfillmentStatus']);
  });
});
