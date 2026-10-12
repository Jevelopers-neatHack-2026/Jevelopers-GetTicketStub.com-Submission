import { describe, expect, it } from 'vitest';
import { readFinancialSummary, type SummaryRequest } from '../../src/data/shared-contracts-adapter';
import { NOW, caseOf, json, kit, manifest, payloadOf, scopeOf } from './support';

const m = manifest('FinancialSummary');
const context = caseOf(m, 'semantic-positive').context;
const valid = () => structuredClone(m.valid) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const request = (over: Partial<SummaryRequest> & { payload?: unknown } = {}): SummaryRequest => {
  const { payload, ...rest } = over;
  return { kit, scope: scopeOf(), delivery: { kind: 'payload', json: json(payload ?? valid()) }, now: NOW, maxAgeMs: 3_600_000, currency: 'USD', references: context.references, metricNames: ['expense'], ...rest };
};

describe('TD-01B FinancialSummary 1.0.0 positive', () => {
  it('maps the producer fixture to exact UI amounts with separate lifecycle axes and a fixture badge', () => {
    const result = readFinancialSummary(request());
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    expect(result.authority).toBe('read_only_projection');
    expect(result.data.metrics.expense?.amount).toEqual({ status: 'available', text: '0.000003', currency: 'USD' });
    expect(result.data.axes).toEqual({ valuation: 'estimated', settlement: 'unpaid', reconciliation: 'unmatched', reservation: 'held', completeness: 'complete' });
    expect(result.data.badges).toEqual(['fixture', 'estimated', 'unreconciled']);
    expect(result.data.partition).toEqual({ environment: 'test', billingMode: 'simulated' });
  });
  it.each(['semantic-positive', 'unknown-total', 'sub-cent-retained', 'signed-sub-cent-total', 'bound-currency-conversion'])('accepts producer semantic fixture %s through the adapter', (id) => {
    const c = caseOf(m, id), p = payloadOf(m, id);
    const result = readFinancialSummary(request({ payload: p, scope: scopeOf({ tenantId: c.context.scope.tenant_id, projectId: c.context.scope.project_id }), currency: c.context.currency, references: c.context.references }));
    expect(result.status).toBe('ready');
  });
  it('keeps sub-cent and signed amounts as exact strings', () => {
    const c = caseOf(m, 'signed-sub-cent-total');
    const result = readFinancialSummary(request({ payload: payloadOf(m, c.id), currency: c.context.currency, references: c.context.references, metricNames: Object.keys(payloadOf(m, c.id).metrics) }));
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') return;
    for (const metric of Object.values(result.data.metrics)) if (metric.amount.status === 'available') expect(metric.amount.text).toMatch(/^-?\d+(\.\d+)?$/);
  });
});

describe('TD-01B FinancialSummary refusals (malformed, forged scope, reference mismatch, tampered bytes)', () => {
  it.each([
    ['malformed JSON', json(valid()).slice(0, -3), 'MALFORMED_JSON'],
    ['duplicate member', json(valid()).replace('"revision":1,', '"revision":1,"revision":2,'), 'MALFORMED_JSON'],
  ])('refuses %s', (_name, text, code) => {
    expect(readFinancialSummary(request({ delivery: { kind: 'payload', json: text } }))).toMatchObject({ status: 'refused', code });
  });
  it.each([
    ['unsupported major', { schema_version: '2.0.0' }, 'UNSUPPORTED_VERSION'],
    ['unsupported minor', { schema_version: '1.1.0' }, 'UNSUPPORTED_VERSION'],
    ['additive unknown field', { extra_field: 1 }, 'INVALID_PAYLOAD'],
    ['bad enum', { billing_mode: 'paper' }, 'INVALID_PAYLOAD'],
    ['wrong discriminator', { contract: 'EvidenceProjection' }, 'INVALID_PAYLOAD'],
  ])('refuses %s', (_name, patch, code) => {
    expect(readFinancialSummary(request({ payload: { ...valid(), ...patch } }))).toMatchObject({ status: 'refused', code });
  });
  it('refuses a forged tenant and a forged project even when they swap the two ids', () => {
    expect(readFinancialSummary(request({ payload: { ...valid(), tenant_id: '123e4567-e89b-42d3-a456-426614174999' } }))).toMatchObject({ status: 'refused', code: 'SCOPE_MISMATCH', path: '/tenant_id' });
    expect(readFinancialSummary(request({ scope: scopeOf({ projectId: '123e4567-e89b-42d3-a456-426614174111' }) }))).toMatchObject({ status: 'refused', code: 'SCOPE_MISMATCH', path: '/project_id' });
  });
  it('never takes scope from the payload: an authorized host scope for another tenant rejects a payload that merely self-describes it', () => {
    const forged = { ...valid(), tenant_id: '123e4567-e89b-42d3-a456-426614174222' };
    expect(readFinancialSummary(request({ payload: forged }))).toMatchObject({ code: 'SCOPE_MISMATCH' });
  });
  it('refuses a reference that differs from the independent trusted expectation', () => {
    const references = { ...context.references, 'metrics/expense/definition_ref': { ...context.references['metrics/expense/definition_ref'], content_hash: 'sha256:' + '1'.repeat(64) } };
    expect(readFinancialSummary(request({ references }))).toMatchObject({ status: 'refused', code: 'REFERENCE_MISMATCH', path: '/metrics/expense/definition_ref' });
  });
  it('refuses when no trusted reference is supplied rather than reading it from the payload', () => {
    expect(readFinancialSummary(request({ references: {} }))).toMatchObject({ status: 'refused', code: 'INVALID_TRUST_CONTEXT' });
  });
  it('refuses tampered bytes against the host-supplied canonical digest, and accepts the untampered record', () => {
    const digest = caseOf(m, 'minimal').expected.canonical_sha256!;
    expect(readFinancialSummary(request({ expectedDigest: digest })).status).toBe('ready');
    const tampered = json(valid()).replace('"amount":"0.000003"', '"amount":"0.000004"');
    expect(tampered).not.toBe(json(valid()));
    expect(readFinancialSummary(request({ delivery: { kind: 'payload', json: tampered }, expectedDigest: digest }))).toMatchObject({ status: 'refused', code: 'DIGEST_MISMATCH' });
  });
  it('refuses a currency the host did not ask for', () => {
    expect(readFinancialSummary(request({ currency: 'EUR' }))).toMatchObject({ status: 'refused', code: 'CURRENCY_MISMATCH' });
  });
  it.each(['foreign-currency-without-conversion', 'invalid-period', 'fake-complete-coverage', 'mode-expansion', 'forged-tenant'])('preserves producer negative fixture %s as a refusal with the producer code and path', (id) => {
    const c = caseOf(m, id);
    const result = readFinancialSummary(request({ payload: payloadOf(m, id), scope: scopeOf({ tenantId: c.context.scope.tenant_id, projectId: c.context.scope.project_id }), currency: c.context.currency, references: c.context.references }));
    expect(result).toMatchObject({ status: 'refused', code: c.expected.code, path: c.expected.path });
  });
});

describe('TD-01B explicit missing, stale, restricted and unknown states', () => {
  it('missing delivery is missing, not empty and not zero', () => {
    const result = readFinancialSummary(request({ delivery: { kind: 'absent' } }));
    expect(result).toEqual({ status: 'missing', authority: 'read_only_projection' });
  });
  it('a requested metric absent from a valid record is unavailable and never zero', () => {
    const result = readFinancialSummary(request({ metricNames: ['expense', 'revenue'] }));
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.data.requested.revenue).toEqual({ status: 'unavailable' });
    expect(result.data.missingMetrics).toEqual(['revenue']);
    expect(Object.keys(result.data.metrics)).toEqual(['expense']);
  });
  it('restricted delivery carries no data', () => {
    const result = readFinancialSummary(request({ delivery: { kind: 'restricted' } }));
    expect(result).toEqual({ status: 'restricted', authority: 'read_only_projection' });
    expect('data' in result).toBe(false);
  });
  it('unknown delivery (undetermined transport outcome) carries no data', () => {
    expect(readFinancialSummary(request({ delivery: { kind: 'unknown' } }))).toEqual({ status: 'unknown', authority: 'read_only_projection' });
  });
  it('stale data is flagged with its age and a stale badge, and still shows exact amounts', () => {
    const result = readFinancialSummary(request({ now: '2026-10-10T16:00:00Z', maxAgeMs: 60_000 }));
    expect(result.status).toBe('stale');
    if (result.status !== 'stale') return;
    expect(result.ageMs).toBe(14_399_000);
    expect(result.data.badges).toContain('stale');
    expect(result.data.metrics.expense?.amount).toMatchObject({ status: 'available', text: '0.000003' });
  });
  it('future-dated records are refused, not treated as fresh', () => {
    expect(readFinancialSummary(request({ now: '2026-10-10T11:00:00Z' }))).toMatchObject({ status: 'refused', code: 'FUTURE_DATED' });
  });
  it('an explicitly unknown metric stays unknown and is neither zero nor omitted', () => {
    const c = caseOf(m, 'unknown-total'), p = payloadOf(m, c.id);
    const names = Object.keys(p.metrics);
    const result = readFinancialSummary(request({ payload: p, currency: c.context.currency, references: c.context.references, metricNames: names }));
    if (result.status !== 'ready') throw new Error('expected ready');
    const unknown = names.filter((n) => p.metrics[n].status === 'unknown');
    expect(unknown.length).toBeGreaterThan(0);
    for (const n of unknown) { expect(result.data.requested[n]).toEqual({ status: 'unknown' }); }
    expect(result.data.axes.completeness).not.toBe('complete');
    expect(result.data.badges).toContain('partial');
  });
  it('unknown valuation, incomplete coverage and unreconciled state surface as separate unknown/partial/unresolved badges', () => {
    const p = { ...valid(), valuation_basis: 'unknown', completeness: 'unknown', coverage: { observed: 0, expected: null, missing_sources: ['usage'] }, metrics: { expense: { status: 'unknown', definition_ref: valid().metrics.expense.definition_ref, value: null, source_refs: [] } } };
    const result = readFinancialSummary(request({ payload: p, metricNames: ['expense', 'revenue'] }));
    if (result.status !== 'ready') throw new Error(JSON.stringify(result));
    expect(result.data.badges).toEqual(['fixture', 'unknown', 'unreconciled', 'partial']);
    expect(result.data.requested).toEqual({ expense: { status: 'unknown' }, revenue: { status: 'unavailable' } });
    expect(result.data.coverage).toEqual({ observed: 0, expected: null, missingSources: ['usage'] });
  });
  it('does not infer ledger, live revenue or authority from paid/live/confirmed values', () => {
    const p = { ...valid(), billing_mode: 'live', environment: 'production', included_billing_modes: ['live'], included_environments: ['production'], settlement: 'paid', reconciliation: 'matched', valuation_basis: 'provider_confirmed' };
    const result = readFinancialSummary(request({ payload: p, scope: scopeOf({ environment: 'production', billingMode: 'live' }) }));
    if (result.status !== 'ready') throw new Error(JSON.stringify(result));
    expect(result.authority).toBe('read_only_projection');
    expect(Object.keys(result.data)).not.toContain('ledger');
    expect(Object.keys(result.data.metrics)).toEqual(['expense']); // no revenue/zero is synthesised
    expect(result.data.requested).toEqual({ expense: { status: 'available', text: '0.000003', currency: 'USD' } });
  });
});

describe('TD-01B environment and billing partitions stay separate', () => {
  const production = () => ({ ...valid(), environment: 'production', billing_mode: 'live', included_environments: ['production'], included_billing_modes: ['live'] });
  it('refuses a payload from another environment or billing mode than the host partition', () => {
    expect(readFinancialSummary(request({ payload: production(), scope: scopeOf() }))).toMatchObject({ status: 'refused', code: 'PARTITION_MISMATCH', path: '/environment' });
    expect(readFinancialSummary(request({ payload: { ...valid(), billing_mode: 'live', included_billing_modes: ['live'] } }))).toMatchObject({ status: 'refused', code: 'PARTITION_MISMATCH', path: '/billing_mode' });
  });
  it('refuses a summary that aggregates several modes or environments into one read', () => {
    expect(readFinancialSummary(request({ payload: { ...valid(), included_billing_modes: ['simulated', 'live'] } }))).toMatchObject({ code: 'SCOPE_MISMATCH', path: '/included_billing_modes' });
    expect(readFinancialSummary(request({ payload: { ...valid(), included_environments: ['test', 'production'] } }))).toMatchObject({ code: 'SCOPE_MISMATCH', path: '/included_billing_modes' });
  });
  it('each partition reads only under its own scope and exposes no cross-partition total', () => {
    const live = readFinancialSummary(request({ payload: production(), scope: scopeOf({ environment: 'production', billingMode: 'live' }) }));
    const simulated = readFinancialSummary(request());
    if (live.status !== 'ready' || simulated.status !== 'ready') throw new Error('expected ready');
    expect(live.data.partition).toEqual({ environment: 'production', billingMode: 'live' });
    expect(simulated.data.partition).toEqual({ environment: 'test', billingMode: 'simulated' });
    expect(live.data.badges[0]).toBe('live');
    expect(simulated.data.badges[0]).toBe('fixture');
    expect(Object.keys(live.data)).not.toContain('total');
  });
});
