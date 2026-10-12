import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFinancialSummary, type ProjectionResult, type SummaryProjection } from '../../src/data/shared-contracts-adapter';
import { FinancialSummaryView, evaluateFinancePacket, readFinancePage, type PacketOutcome, type TrustedPacketExpectation } from '../../src/views/financial-summary';
import { projection, ready, requestedOf, stale, stubKit, stubScope, wirePayload } from './financial-summary.fixtures';

const view = (result: ProjectionResult<SummaryProjection>, projectLabel?: string) => render(<FinancialSummaryView result={result} {...(projectLabel ? { projectLabel } : {})} />);

describe('FinancialSummaryView exact producer values', () => {
  it('shows producer metric names, exact amount strings and definition refs without aliases or arithmetic', () => {
    const { container } = view(ready(requestedOf(projection(), ['expense.effective'])));
    const card = screen.getByRole('heading', { name: 'expense.effective' }).closest('section')!;
    expect(within(card).getByText('0.000007')).toBeVisible();
    expect(within(card).getByText('USD')).toBeVisible();
    expect(within(card).getByText(/definition-ui-expense revision 4; 2 source references/u)).toBeVisible();
    expect(container.textContent).not.toMatch(/\b(spent|earned|remaining|budget|balance|total|net)\b/iu);
  });
  it('shows a requested metric absent from the record as unavailable, not zero, and an unknown one as unknown', () => {
    const { container } = view(ready(requestedOf(projection(), ['expense.effective', 'expense.provider_unbilled', 'expense.never_delivered'])));
    const absent = screen.getByRole('heading', { name: 'expense.never_delivered' }).closest('section')!;
    expect(within(absent).getByText('Amount unavailable')).toBeVisible();
    expect(within(absent).getByText(/not zero/u)).toBeVisible();
    const unknown = screen.getByRole('heading', { name: 'expense.provider_unbilled' }).closest('section')!;
    expect(within(unknown).getByText('Amount unknown')).toBeVisible();
    expect(container.textContent).not.toMatch(/(?<![\d.])0(\.0+)?\s*USD/u);
  });
  it('lists every delivered metric when none were requested', () => {
    view(ready());
    expect(screen.getByRole('heading', { name: 'expense.provider_unbilled' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'expense.effective' })).toBeVisible();
  });
  it('treats a metric named __proto__ as a plain key', () => {
    const data = projection({ metrics: Object.assign(Object.create(null), { ['__proto__']: { amount: { status: 'available', text: '1.5', currency: 'USD' }, definition: { id: 'd', revision: 1 }, sourceCount: 0 } }) });
    view(ready(data));
    expect(screen.getByRole('heading', { name: '__proto__' })).toBeVisible();
    expect(screen.getByText('1.5')).toBeVisible();
  });
});

describe('FinancialSummaryView independent axes, coverage, freshness and mode', () => {
  it('renders every lifecycle axis as its own labelled value, taken verbatim from the producer', () => {
    view(ready());
    const states = screen.getByRole('region', { name: 'Summary states' });
    for (const [label, value] of [['Valuation', 'estimated'], ['Settlement', 'unpaid'], ['Reconciliation', 'unmatched'], ['Reservation', 'held'], ['Completeness', 'incomplete'], ['Environment', 'test'], ['Billing mode', 'simulated']] as const) {
      expect(within(states).getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(value);
    }
    expect(within(states).getByText('Evidence: synthetic fixture')).toBeVisible();
  });
  it('does not derive one axis from another', () => {
    view(ready(projection({ axes: { valuation: 'confirmed', settlement: 'unpaid', reconciliation: 'unmatched', reservation: 'none', completeness: 'unknown' }, badges: ['live', 'confirmed', 'unreconciled', 'partial'] })));
    const states = screen.getByRole('region', { name: 'Summary states' });
    expect(within(states).getByText('Valuation', { selector: 'dt' }).nextElementSibling).toHaveTextContent('confirmed');
    expect(within(states).getByText('Settlement', { selector: 'dt' }).nextElementSibling).toHaveTextContent('unpaid');
    expect(within(states).getByText('Completeness', { selector: 'dt' }).nextElementSibling).toHaveTextContent('unknown');
  });
  it('reports unknown expected coverage and missing sources without implying completeness', () => {
    view(ready());
    const coverage = screen.getByRole('region', { name: 'Coverage and freshness' });
    expect(within(coverage).getByText('Sources expected', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Unknown');
    expect(within(coverage).getByText('ui-source-b')).toBeVisible();
    expect(within(coverage).getByText('Observed at', { selector: 'dt' }).nextElementSibling).toHaveTextContent('2026-10-08T00:05:00Z');
  });
  it('announces stale data as stale while keeping the last observed amounts', () => {
    view(stale());
    expect(screen.getByRole('status')).toHaveTextContent('older than the host freshness policy');
    expect(screen.getByText('Freshness: stale')).toBeVisible();
    expect(screen.getByText('0.000007')).toBeVisible();
  });
});

describe('FinancialSummaryView scope and provenance accessibility', () => {
  it('is a labelled region with a heading, a scope section and a scoped provenance table', () => {
    view(ready(requestedOf(projection(), ['expense.effective'])), 'Authorized host project');
    const region = screen.getByRole('region', { name: 'Financial summary' });
    expect(within(region).getByRole('region', { name: 'Financial scope' })).toHaveTextContent('Authorized host project');
    const table = within(region).getByRole('table', { name: 'Metric provenance' });
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.getAttribute('scope'))).toEqual(['col', 'col', 'col', 'col']);
    const row = within(table).getByRole('row', { name: /expense\.effective/u });
    expect(within(row).getByRole('rowheader')).toHaveAttribute('scope', 'row');
  });
  it('does not invent a project label when the host supplies none', () => {
    view(ready());
    expect(screen.getByRole('region', { name: 'Financial scope' })).toHaveTextContent('Not supplied by host');
  });
  it('lists provenance only for metrics the producer delivered', () => {
    view(ready(requestedOf(projection(), ['expense.never_delivered'])));
    expect(screen.queryByRole('table', { name: 'Metric provenance' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Summary provenance' })).toHaveTextContent('producer-revision-ui-fixture');
    expect(screen.getByRole('region', { name: 'Summary provenance' })).toHaveTextContent('Read-only projection');
  });
});

describe('FinancialSummaryView non-ready results never show amounts', () => {
  it.each([
    ['missing', { status: 'missing', authority: 'read_only_projection' }, 'No summary delivered'],
    ['restricted', { status: 'restricted', authority: 'read_only_projection' }, 'Summary restricted'],
    ['unknown', { status: 'unknown', authority: 'read_only_projection' }, 'Summary state unknown'],
  ] as const)('renders %s as a status without metrics', (_name, result, title) => {
    const { container } = view(result);
    expect(screen.getByRole('status')).toHaveTextContent(title);
    expect(screen.queryByRole('heading', { level: 3, name: /expense/u })).toBeNull();
    expect(container.textContent).not.toMatch(/\d\.\d/u);
  });
  it.each([['UNSUPPORTED_VERSION', 'Unsupported summary contract'], ['SCOPE_MISMATCH', 'Summary refused']] as const)('renders a %s refusal as an alert with code and path', (code, title) => {
    view({ status: 'refused', authority: 'read_only_projection', code, path: '/x' });
    expect(screen.getByRole('alert')).toHaveTextContent(title);
    expect(screen.getByRole('alert')).toHaveTextContent(code);
    expect(screen.getByRole('alert')).toHaveTextContent('/x');
  });
});

describe('adapter to view (stub kit; contract validation itself is covered by test:contracts)', () => {
  const request = (over = {}) => ({ kit: stubKit, scope: stubScope, delivery: { kind: 'payload' as const, json: JSON.stringify(wirePayload()) }, now: '2026-10-08T00:10:00Z', maxAgeMs: 3_600_000, currency: 'USD', references: {}, metricNames: ['expense.effective', 'expense.unbilled', 'expense.absent'], ...over });
  it('keeps exact amounts, unknown and unavailable through the adapter and the view', () => {
    view(readFinancialSummary(request()));
    expect(screen.getByText('0.000003')).toBeVisible();
    const unknown = screen.getByRole('heading', { name: 'expense.unbilled' }).closest('section')!;
    expect(within(unknown).getByText('Amount unknown')).toBeVisible();
    const absent = screen.getByRole('heading', { name: 'expense.absent' }).closest('section')!;
    expect(within(absent).getByText('Amount unavailable')).toBeVisible();
  });
  it('shows a partition mismatch as a refusal, not as data', () => {
    view(readFinancialSummary(request({ scope: { ...stubScope, environment: 'production' } })));
    expect(screen.getByRole('alert')).toHaveTextContent('PARTITION_MISMATCH');
    expect(screen.queryByText('0.000003')).toBeNull();
  });
});

/**
 * Test-only vectors. The UUID and content hash below only have the right SHAPE so the gate's structural check can be
 * exercised; they are not Finance references and nothing in src produces or defaults such values.
 */
const SCHEMA_SHA = '8d73d97e86d0684ccbb84fc1838de9d7802438966be60bd1f2da3347833067d9';
const shapeOnlyReference = { id: '00000000-0000-4000-8000-000000000001', revision: 1, content_hash: `sha256:${'a'.repeat(64)}` };
const trusted = (over: Partial<TrustedPacketExpectation> = {}): TrustedPacketExpectation => ({ schemaSha256: SCHEMA_SHA, summaryDigest: 'sha256:digest', references: { '/policy_ref': shapeOnlyReference }, ...over });
const manifestOf = (over: Record<string, unknown> = {}, root: Record<string, unknown> = {}) => ({
  canonicalReferences: { status: 'proposal_only', adoptionAccepted: false, packageVersion: '0.3.0', schemaVersion: '1.0.0', schemas: [{ contract: 'UsageEvent', schemaVersion: '1.0.0', sha256: '1'.repeat(64) }, { contract: 'FinancialSummary', schemaVersion: '1.0.0', sha256: SCHEMA_SHA }], ...over },
  financeAcknowledgment: null, dashboardAcknowledgment: null, ...root,
});
const refusal = (outcome: PacketOutcome) => outcome.outcome === 'refused' ? outcome.result : undefined;

describe('Finance packet gate: schema, contract, digest, reference and review, not package version', () => {
  it('does not refuse an identical schema solely because the package version differs (0.3.0 against the 0.9.7 pin)', () => {
    for (const packageVersion of ['0.3.0', '0.9.7', '9.9.9']) expect(evaluateFinancePacket(manifestOf({ packageVersion }), trusted()).outcome).toBe('synthetic_development_only');
  });
  it('allows a proposal-only packet in explicit synthetic development only, never as production adoption', () => {
    const outcome = evaluateFinancePacket(manifestOf(), trusted());
    expect(outcome).toEqual({ outcome: 'synthetic_development_only', productionAdoption: 'not_established', ownerAcknowledgement: 'absent', packageVersion: '0.3.0', packetStatus: 'proposal_only', schemaSha256: SCHEMA_SHA });
    render(<FinancialSummaryView result={ready()} packet={outcome} />);
    expect(screen.getByText('Contract adoption', { selector: 'dt' }).nextElementSibling).toHaveTextContent('Synthetic development only. Production adoption is not established: no owner acknowledgement.');
  });
  it('refuses production adoption even when the packet claims an acknowledgement or adoption, since no owner verifier exists here', () => {
    const claimed = manifestOf({ adoptionAccepted: true }, { dashboardAcknowledgment: { by: 'someone' } });
    expect(refusal(evaluateFinancePacket(claimed, trusted(), 'production'))).toEqual({ status: 'refused', authority: 'read_only_projection', code: 'UNACCEPTED_INTERFACE', path: '/ownerAcknowledgement' });
    expect(evaluateFinancePacket(claimed, trusted())).toMatchObject({ outcome: 'synthetic_development_only', productionAdoption: 'not_established', ownerAcknowledgement: 'claimed_unverified' });
    expect(refusal(evaluateFinancePacket(manifestOf(), trusted(), 'production'))).toMatchObject({ code: 'UNACCEPTED_INTERFACE' });
  });
  it('refuses unsupported wire versions and unknown contracts', () => {
    expect(refusal(evaluateFinancePacket(manifestOf({ schemaVersion: '2.0.0' }), trusted()))).toMatchObject({ code: 'UNSUPPORTED_VERSION', path: '/canonicalReferences/schemaVersion' });
    expect(refusal(evaluateFinancePacket(manifestOf({ schemas: [{ contract: 'FinancialSummary', schemaVersion: '1.1.0', sha256: SCHEMA_SHA }] }), trusted()))).toMatchObject({ code: 'UNSUPPORTED_VERSION', path: '/canonicalReferences/schemas/FinancialSummary/schemaVersion' });
    expect(refusal(evaluateFinancePacket(manifestOf({ schemas: [{ contract: 'UsageEvent', schemaVersion: '1.0.0', sha256: SCHEMA_SHA }] }), trusted()))).toMatchObject({ code: 'UNKNOWN_CONTRACT' });
    expect(refusal(evaluateFinancePacket(manifestOf({ schemas: undefined }), trusted()))).toMatchObject({ code: 'UNKNOWN_CONTRACT' });
    for (const bad of [null, 'text', [], {}, { canonicalReferences: [] }]) expect(refusal(evaluateFinancePacket(bad, trusted()))).toMatchObject({ code: 'INVALID_PAYLOAD', path: '/canonicalReferences' });
  });
  it('refuses a schema digest that differs from the host-trusted digest, and a malformed trusted digest', () => {
    const other = manifestOf({ schemas: [{ contract: 'FinancialSummary', schemaVersion: '1.0.0', sha256: 'b'.repeat(64) }] });
    expect(refusal(evaluateFinancePacket(other, trusted()))).toMatchObject({ code: 'DIGEST_MISMATCH', path: '/canonicalReferences/schemas/FinancialSummary/sha256' });
    expect(refusal(evaluateFinancePacket(manifestOf(), trusted({ schemaSha256: 'not-a-digest' })))).toMatchObject({ code: 'INVALID_TRUST_CONTEXT', path: '/trusted/schemaSha256' });
    expect(refusal(evaluateFinancePacket(manifestOf(), trusted({ summaryDigest: '' })))).toMatchObject({ code: 'INVALID_TRUST_CONTEXT', path: '/trusted/summaryDigest' });
  });
  it('refuses when trusted versioned references are missing or malformed, and never defaults them', () => {
    expect(refusal(evaluateFinancePacket(manifestOf(), trusted({ references: {} })))).toMatchObject({ code: 'REFERENCE_MISMATCH', path: '/trusted/references' });
    expect(refusal(evaluateFinancePacket(manifestOf(), trusted({ references: undefined as never })))).toMatchObject({ code: 'REFERENCE_MISMATCH', path: '/trusted/references' });
    for (const reference of [{ id: 'policy-1.0.0', revision: 1, content_hash: shapeOnlyReference.content_hash }, { ...shapeOnlyReference, revision: -1 }, { ...shapeOnlyReference, content_hash: 'sha256:short' }, null]) {
      expect(refusal(evaluateFinancePacket(manifestOf(), trusted({ references: { '/policy_ref': reference } })))).toMatchObject({ code: 'REFERENCE_MISMATCH', path: '/trusted/references//policy_ref' });
    }
  });
  it('renders a refused outcome as an alert without amounts', () => {
    view(refusal(evaluateFinancePacket(manifestOf({ schemaVersion: '2.0.0' }), trusted()))!);
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported summary contract');
    expect(screen.getByRole('alert')).toHaveTextContent('UNSUPPORTED_VERSION');
  });
});

describe('readFinancePage keeps the Finance wrapper apart and hands only the exact inner summary to the canonical reader', () => {
  const summary = wirePayload();
  const page = { schema: 'FinancialSummaryPage', asOf: '2026-10-08T00:05:00Z', timezone: 'UTC', watermark: 'w-1', queryContentHash: 'q', summaryContentHash: 'sha256:digest', filters: { project: 'p' }, pagination: { cursor: null }, summary };
  const request = (over = {}) => ({ kit: stubKit, scope: stubScope, now: '2026-10-08T00:10:00Z', maxAgeMs: 3_600_000, currency: 'USD', metricNames: ['expense.effective'], manifest: manifestOf(), trusted: trusted(), page, ...over });
  it('preserves every non-summary wrapper field verbatim and passes the inner summary with the trusted references and digest', () => {
    const seen: unknown[] = [];
    const kit = { ...stubKit, parseContractVersion: (contract: string, version: string, text: string) => { seen.push(JSON.parse(text)); return stubKit.parseContractVersion(contract, version, text); }, hashManifest: () => 'sha256:digest' };
    const read = readFinancePage(request({ kit }));
    expect(seen).toEqual([summary]);
    expect(read.wrapper).toEqual({ schema: 'FinancialSummaryPage', asOf: '2026-10-08T00:05:00Z', timezone: 'UTC', watermark: 'w-1', queryContentHash: 'q', summaryContentHash: 'sha256:digest', filters: { project: 'p' }, pagination: { cursor: null } });
    expect(read.wrapper).not.toHaveProperty('summary');
    expect(read.packet.outcome).toBe('synthetic_development_only');
    expect(read.result.status).toBe('ready');
  });
  it('refuses the whole page passed where the inner summary belongs, and a page whose summary is not an object', () => {
    expect(readFinancePage(request({ page: summary })).result).toMatchObject({ status: 'refused', code: 'INVALID_PAYLOAD', path: '/summary_id' });
    expect(readFinancePage(request({ page: { ...page, summary: 'x' } })).result).toMatchObject({ status: 'refused', code: 'INVALID_PAYLOAD', path: '/summary' });
    expect(readFinancePage(request({ page: 'x' })).result).toMatchObject({ status: 'refused', code: 'INVALID_PAYLOAD' });
  });
  it('refuses a page digest that disagrees with the trusted digest, and an inner digest the canonical reader recomputes differently', () => {
    expect(readFinancePage(request({ page: { ...page, summaryContentHash: 'sha256:other' } })).result).toMatchObject({ status: 'refused', code: 'DIGEST_MISMATCH', path: '/summaryContentHash' });
    expect(readFinancePage(request({ kit: { ...stubKit, hashManifest: () => 'sha256:recomputed-differs' } })).result).toMatchObject({ status: 'refused', code: 'DIGEST_MISMATCH' });
  });
  it('reports a page without a canonical summary as missing, preserving the wrapper and inventing no zero summary', () => {
    for (const absent of [null, undefined]) {
      const read = readFinancePage(request({ page: { ...page, summary: absent } }));
      expect(read.result).toEqual({ status: 'missing', authority: 'read_only_projection' });
      expect(read.wrapper).toMatchObject({ watermark: 'w-1' });
    }
  });
  it('stops at the packet gate before any canonical read, and surfaces semantic refusals from the consumer helper unchanged', () => {
    let called = false;
    const spy = { ...stubKit, parseContractVersion: () => { called = true; return { ok: true as const, value: {} }; } };
    expect(readFinancePage(request({ kit: spy, trusted: trusted({ references: {} }) }))).toMatchObject({ result: { status: 'refused', code: 'REFERENCE_MISMATCH' } });
    expect(called).toBe(false);
    const semantic = { ...stubKit, hashManifest: () => 'sha256:digest', checkFinancialSummary: () => ({ ok: false as const, errors: [{ code: 'INVALID_PAYLOAD', path: '/coverage' }] }) };
    expect(readFinancePage(request({ kit: semantic })).result).toMatchObject({ status: 'refused', code: 'INVALID_PAYLOAD', path: '/coverage' });
  });
  it('shows wrapper metadata in its own section without altering or summing anything', () => {
    const { container } = render(<FinancialSummaryView result={ready()} wrapper={{ asOf: 'A', filters: { project: 'p' }, pagination: { cursor: null } }} />);
    const section = screen.getByRole('region', { name: 'Finance response metadata' });
    expect(within(section).getByText('asOf', { selector: 'dt' }).nextElementSibling).toHaveTextContent('A');
    expect(within(section).getByText('filters', { selector: 'dt' }).nextElementSibling).toHaveTextContent('{"project":"p"}');
    expect(container.textContent).not.toMatch(/\b(spent|earned|remaining|budget|balance)\b/iu);
  });
});

const packet = '/tmp/ie-financial-fixture-handoff';
describe.skipIf(!existsSync(`${packet}/manifest.json`))('IE financial handoff packet (read-only, when present on this machine)', () => {
  const manifest = existsSync(`${packet}/manifest.json`) ? JSON.parse(readFileSync(`${packet}/manifest.json`, 'utf8')) : {};
  it('matches its manifest hashes for vectors, coverage and README', () => {
    for (const file of manifest.files) expect(createHash('sha256').update(readFileSync(`${packet}/${file.path}`)).digest('hex')).toBe(file.sha256);
  });
  it('is pending owner acceptance: schema-compatible in synthetic development at most, never production adoption', () => {
    expect(manifest.acceptanceState).toBe('PENDING_OWNER_ACCEPTANCE');
    expect(manifest.dashboardAcknowledgment).toBeNull();
    const entry = manifest.canonicalReferences.schemas.find((schema: { contract: string }) => schema.contract === 'FinancialSummary');
    expect(entry.sha256).toBe(SCHEMA_SHA);
    expect(evaluateFinancePacket(manifest, trusted({ references: {} }))).toMatchObject({ outcome: 'refused', result: { code: 'REFERENCE_MISMATCH' } });
    expect(evaluateFinancePacket(manifest, trusted())).toMatchObject({ outcome: 'synthetic_development_only', productionAdoption: 'not_established', ownerAcknowledgement: 'absent' });
    expect(evaluateFinancePacket(manifest, trusted(), 'production')).toMatchObject({ outcome: 'refused', result: { code: 'UNACCEPTED_INTERFACE' } });
  });
  it('carries no successful FinancialSummary for the dashboard to render', () => {
    const found: unknown[] = [];
    const walk = (node: unknown) => { if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) { if (key === 'expectedPublicFinancialSummary') found.push(value); else walk(value); } };
    walk(JSON.parse(readFileSync(`${packet}/vectors.json`, 'utf8')));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((value) => value === null)).toBe(true);
  });
});
