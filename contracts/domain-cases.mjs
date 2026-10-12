// Reviewed local domain cases for the offline contract driver. They execute the real adapter
// (src/data/shared-contracts-adapter.ts) against producer fixtures; expectations come from the
// fixtures' independent contexts and the host scope below, never from payload fields.
import assert from 'node:assert/strict';
import * as adapter from '../src/data/shared-contracts-adapter.ts';

const TENANT = '123e4567-e89b-42d3-a456-426614174000';
const scope = (over = {}) => ({ tenantId: TENANT, projectId: TENANT, environment: 'test', billingMode: 'simulated', ...over });
const NOW = '2026-10-10T12:05:00Z';
const copy = (value) => structuredClone(value);

export function runDomainCases({ kit, fixtures }) {
  const summary = fixtures.FinancialSummary, evidence = fixtures.EvidenceProjection, job = fixtures.JobStatus, fulfillment = fixtures.FulfillmentStatus;
  const references = summary.cases.find((c) => c.id === 'semantic-positive').context.references;
  const send = (payload) => ({ kind: 'payload', json: JSON.stringify(payload) });
  const fin = (over = {}) => adapter.readFinancialSummary({ kit, scope: scope(), delivery: send(summary.valid), now: NOW, maxAgeMs: 3_600_000, currency: 'USD', references, metricNames: ['expense'], ...over });
  const cases = [];
  const test = (id, fn) => {
    try { fn(); cases.push({ id, passed: true }); } catch (error) { cases.push({ id, passed: false, message: String(error.message).slice(0, 200) }); }
  };
  const digest = summary.cases.find((c) => c.id === 'minimal').expected.canonical_sha256;

  test('summary-positive-exact-amount', () => {
    const result = fin();
    assert.equal(result.status, 'ready');
    assert.deepEqual(result.data.metrics.expense.amount, { status: 'available', text: '0.000003', currency: 'USD' });
    assert.equal(result.authority, 'read_only_projection');
  });
  test('summary-forged-tenant-refused', () => {
    const forged = copy(summary.valid); forged.tenant_id = '123e4567-e89b-42d3-a456-426614174999';
    assert.deepEqual([fin({ delivery: send(forged) }).code, fin({ delivery: send(forged) }).path], ['SCOPE_MISMATCH', '/tenant_id']);
  });
  test('summary-reference-mismatch-refused', () => {
    const refs = { ...references, 'metrics/expense/definition_ref': { ...references['metrics/expense/definition_ref'], content_hash: 'sha256:' + '1'.repeat(64) } };
    assert.equal(fin({ references: refs }).code, 'REFERENCE_MISMATCH');
  });
  test('summary-tampered-bytes-refused', () => {
    assert.equal(fin({ expectedDigest: digest }).status, 'ready');
    const tampered = JSON.stringify(summary.valid).replace('"amount":"0.000003"', '"amount":"0.000004"');
    assert.equal(fin({ delivery: { kind: 'payload', json: tampered }, expectedDigest: digest }).code, 'DIGEST_MISMATCH');
  });
  test('summary-malformed-and-unsupported-version-refused', () => {
    assert.equal(fin({ delivery: { kind: 'payload', json: '{"contract":' } }).code, 'MALFORMED_JSON');
    assert.equal(fin({ delivery: send({ ...summary.valid, schema_version: '2.0.0' }) }).code, 'UNSUPPORTED_VERSION');
  });
  test('summary-partition-separation', () => {
    const other = { ...copy(summary.valid), environment: 'production', billing_mode: 'live', included_environments: ['production'], included_billing_modes: ['live'] };
    assert.equal(fin({ delivery: send(other) }).code, 'PARTITION_MISMATCH');
    assert.equal(fin({ delivery: send(other), scope: scope({ environment: 'production', billingMode: 'live' }) }).status, 'ready');
    assert.equal(fin({ delivery: send({ ...copy(summary.valid), included_billing_modes: ['simulated', 'live'] }) }).code, 'SCOPE_MISMATCH');
  });
  test('summary-missing-restricted-unknown-states', () => {
    assert.equal(fin({ delivery: { kind: 'absent' } }).status, 'missing');
    assert.equal(fin({ delivery: { kind: 'restricted' } }).status, 'restricted');
    assert.equal(fin({ delivery: { kind: 'unknown' } }).status, 'unknown');
  });
  test('summary-stale-state', () => {
    const result = fin({ now: '2026-10-10T16:00:00Z', maxAgeMs: 60_000 });
    assert.equal(result.status, 'stale');
    assert.ok(result.data.badges.includes('stale'));
  });
  test('summary-missing-metric-is-unavailable-not-zero', () => {
    const result = fin({ metricNames: ['expense', 'revenue'] });
    assert.deepEqual(result.data.requested.revenue, { status: 'unavailable' });
    assert.deepEqual(result.data.missingMetrics, ['revenue']);
  });
  test('evidence-projection-positive-and-partition', () => {
    const base = { kit, scope: scope(), delivery: send(evidence.valid) };
    const ok = adapter.readEvidenceProjection(base);
    assert.equal(ok.status, 'ready');
    assert.equal(ok.data.scopeBinding, 'host_request_only');
    assert.equal(adapter.readEvidenceProjection({ ...base, delivery: send({ ...evidence.valid, environment: 'production' }) }).code, 'PARTITION_MISMATCH');
  });
  test('job-status-unknown-progress-stays-null', () => {
    const c = job.cases.find((x) => x.id === 'unknown-progress');
    const payload = { ...copy(job.valid), ...copy(c.set ?? {}) };
    const result = adapter.readJobStatus({ kit, scope: scope(), delivery: send(payload), now: NOW, maxAgeMs: 3_600_000 });
    assert.equal(result.status, 'ready');
    assert.equal(result.data.progress.completed, null);
  });
  test('fulfillment-forged-order-refused', () => {
    const base = { kit, scope: scope(), delivery: send(fulfillment.valid), now: NOW, maxAgeMs: 3_600_000 };
    assert.equal(adapter.readFulfillmentStatus({ ...base, expectedOrderId: fulfillment.valid.order_id }).status, 'ready');
    assert.equal(adapter.readFulfillmentStatus({ ...base, expectedOrderId: '123e4567-e89b-42d3-a456-000000000999' }).code, 'SCOPE_MISMATCH');
  });
  test('unsupported-interfaces-refused-by-name', () => {
    assert.equal(adapter.refuseUnsupported('Preview1/ArtifactFile2 eligibility').code, 'LEGACY_UNREPRESENTABLE');
    for (const name of ['CSV input activation', 'draft-row publication', 'repair/derived-composition', 'local UsageEvent pre-ingestion mapping']) assert.equal(adapter.refuseUnsupported(name).code, 'UNACCEPTED_INTERFACE');
    assert.equal(adapter.refuseUnsupported('BudgetReservation').code, 'UNSUPPORTED_INTERFACE');
  });
  return cases;
}
