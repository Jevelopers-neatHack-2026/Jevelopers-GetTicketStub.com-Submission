import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFinancialSummary, type ProjectionResult, type SummaryProjection } from '../../src/data/shared-contracts-adapter';
import { FinancialSummaryView, refuseUnsupportedPacket } from '../../src/views/financial-summary';
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

describe('Finance shared-contracts 0.3.0 packet is unsupported, not relabelled', () => {
  it('refuses the proposal-only 0.3.0 reference set as UNSUPPORTED_VERSION', () => {
    const result = refuseUnsupportedPacket({ canonicalReferences: { packageVersion: '0.3.0', schemaVersion: '1.0.0', status: 'proposal_only', adoptionAccepted: false } });
    expect(result).toEqual({ status: 'refused', authority: 'read_only_projection', code: 'UNSUPPORTED_VERSION', path: '/canonicalReferences/packageVersion' });
    view(result!);
    expect(screen.getByRole('alert')).toHaveTextContent('Unsupported summary contract');
  });
  it('still refuses a pinned version that Finance has not adopted, and a missing reference set', () => {
    expect(refuseUnsupportedPacket({ canonicalReferences: { packageVersion: '0.9.7', schemaVersion: '1.0.0', adoptionAccepted: false } })).toMatchObject({ code: 'UNACCEPTED_INTERFACE' });
    expect(refuseUnsupportedPacket({ canonicalReferences: { packageVersion: '0.9.7', schemaVersion: '2.0.0', adoptionAccepted: true } })).toMatchObject({ code: 'UNSUPPORTED_VERSION', path: '/canonicalReferences/schemaVersion' });
    expect(refuseUnsupportedPacket(null)).toMatchObject({ code: 'UNSUPPORTED_VERSION' });
    expect(refuseUnsupportedPacket({ canonicalReferences: { packageVersion: '0.9.7', schemaVersion: '1.0.0', adoptionAccepted: true } })).toBeUndefined();
  });
});

const packet = '/tmp/ie-financial-fixture-handoff';
describe.skipIf(!existsSync(`${packet}/manifest.json`))('IE financial handoff packet (read-only, when present on this machine)', () => {
  const manifest = existsSync(`${packet}/manifest.json`) ? JSON.parse(readFileSync(`${packet}/manifest.json`, 'utf8')) : {};
  it('matches its manifest hashes for vectors, coverage and README', () => {
    for (const file of manifest.files) expect(createHash('sha256').update(readFileSync(`${packet}/${file.path}`)).digest('hex')).toBe(file.sha256);
  });
  it('is pending owner acceptance and its canonical references are unsupported here', () => {
    expect(manifest.acceptanceState).toBe('PENDING_OWNER_ACCEPTANCE');
    expect(manifest.dashboardAcknowledgment).toBeNull();
    expect(refuseUnsupportedPacket(manifest)).toMatchObject({ status: 'refused', code: 'UNSUPPORTED_VERSION' });
  });
  it('carries no successful FinancialSummary for the dashboard to render', () => {
    const found: unknown[] = [];
    const walk = (node: unknown) => { if (Array.isArray(node)) node.forEach(walk); else if (node && typeof node === 'object') for (const [key, value] of Object.entries(node)) { if (key === 'expectedPublicFinancialSummary') found.push(value); else walk(value); } };
    walk(JSON.parse(readFileSync(`${packet}/vectors.json`, 'utf8')));
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((value) => value === null)).toBe(true);
  });
});
