import { readFileSync, readdirSync } from 'node:fs';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dashboard } from '../../src';
import { FinanceV2View, checkFinanceV2Page, type FinanceV2ViewName, type FinanceV2ViewProps } from '../../src/views/finance-v2';
import { FROZEN_PROPOSAL_PROVENANCE, detailIds, financeV2Fixture, financeV2FixtureNames, syntheticOpaqueScope, type FinanceV2FixtureName } from '../../src/views/finance-v2/fixtures';
import { authorizedFixture, fixtureProvider } from '../../integration/fixture-host/host';
import { routeHref } from '../../integration/routes';

function props(name: FinanceV2FixtureName, view: FinanceV2ViewName, extra: Partial<FinanceV2ViewProps> = {}): FinanceV2ViewProps {
  const fixture = financeV2Fixture(name);
  return { mode: 'SYNTHETIC_PROPOSAL', view, input: fixture.input, expectedScope: fixture.expectedScope, expectedSnapshotId: fixture.expectedSnapshotId, ...extra };
}
const show = (name: FinanceV2FixtureName, view: FinanceV2ViewName, extra: Partial<FinanceV2ViewProps> = {}) => render(<FinanceV2View {...props(name, view, extra)} />);
const region = (name: string) => screen.getByRole('region', { name });
const refusal = () => screen.getByRole('alert');

describe('fixture provenance (frozen, unaccepted proposal)', () => {
  it('records the frozen manifest status, base, four file hashes and that nothing is an observation or owner-accepted', () => {
    expect(FROZEN_PROPOSAL_PROVENANCE.status).toBe('WIP_PROPOSAL_NOT_ACCEPTED');
    expect(FROZEN_PROPOSAL_PROVENANCE.sourceBase).toBe('a08760e9ea65bda1e116867ac00b3e03d737bb7e');
    expect(FROZEN_PROPOSAL_PROVENANCE.files.map((file) => file.path)).toEqual(['src/reporting/schema-v2.ts', 'src/reporting/definitions.ts', 'src/reporting/host-authority.ts', 'fixtures/reporting/query-export-handoff.json']);
    for (const file of FROZEN_PROPOSAL_PROVENANCE.files) expect(file.sha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(FROZEN_PROPOSAL_PROVENANCE.observation).toBe(false);
    expect(FROZEN_PROPOSAL_PROVENANCE.ownerAccepted).toBe(false);
  });
  it('uses an opaque product scope that is not a canonical UUID and is still accepted', () => {
    expect(syntheticOpaqueScope.tenantId).toMatch(/^account:/u);
    expect(syntheticOpaqueScope.projectId).toMatch(/^event:/u);
    const fixture = financeV2Fixture('ready');
    expect(checkFinanceV2Page((fixture.input as { page: unknown }).page, fixture.expectedScope, fixture.expectedSnapshotId).ok).toBe(true);
  });
});

describe('checkFinanceV2Page', () => {
  const check = (name: FinanceV2FixtureName) => { const fixture = financeV2Fixture(name); return checkFinanceV2Page((fixture.input as { page: unknown }).page, fixture.expectedScope, fixture.expectedSnapshotId); };
  it.each(['ready', 'mixed-currency-partial', 'unknown-coverage', 'refund-negative', 'empty-budget'] as const)('accepts the %s fixture', (name) => { expect(check(name).ok).toBe(true); });
  it.each([
    ['forged-scope', 'SCOPE_MISMATCH', '/scope/tenantId'],
    ['forged-snapshot', 'SNAPSHOT_MISMATCH', '/snapshotId'],
    ['unsupported-version', 'UNSUPPORTED_VERSION', '/schemaVersion'],
    ['invalid-shape', 'INVALID_SHAPE', '/summary/currencies'],
  ] as const)('refuses %s as %s at %s', (name, code, path) => { expect(check(name)).toEqual({ ok: false, code, path }); });
  it.each([null, 'page', 7, [], {}])('refuses a non-page value %j', (value) => { expect(checkFinanceV2Page(value, syntheticOpaqueScope).ok).toBe(false); });
  it('refuses a detail whose currency is not in the parent summary, and a budget that is not advisory-only', () => {
    const page = structuredClone((financeV2Fixture('ready').input as { page: Record<string, unknown> }).page) as { details: { currency: string }[]; summary: { budgets: { advisoryOnly: boolean }[] } };
    page.details[0]!.currency = 'JPY';
    expect(checkFinanceV2Page(page, syntheticOpaqueScope)).toMatchObject({ ok: false, code: 'SNAPSHOT_MISMATCH', path: '/details/0/currency' });
    page.details[0]!.currency = 'USD';
    page.summary.budgets[0]!.advisoryOnly = false;
    expect(checkFinanceV2Page(page, syntheticOpaqueScope)).toMatchObject({ ok: false, code: 'INVALID_SHAPE', path: '/summary/budgets/0/advisoryOnly' });
  });
  it('refuses a number where the producer delivers a decimal string', () => {
    const page = structuredClone((financeV2Fixture('ready').input as { page: Record<string, unknown> }).page) as { summary: { budgets: { limit: unknown }[] } };
    page.summary.budgets[0]!.limit = 100;
    expect(checkFinanceV2Page(page, syntheticOpaqueScope)).toMatchObject({ ok: false, path: '/summary/budgets/0/limit' });
  });
});

describe('FinanceV2View states', () => {
  it('renders nothing financial unless the mode is exactly SYNTHETIC_PROPOSAL', () => {
    render(<FinanceV2View {...props('ready', 'budget')} mode={'PRODUCTION' as never} />);
    expect(refusal()).toHaveTextContent('UNSUPPORTED_MODE');
    expect(screen.queryByText('100.000000000000000000')).toBeNull();
  });
  it.each([
    ['missing', 'No report delivered', 'status'], ['restricted', 'Report restricted', 'status'], ['unauthorized', 'Not authorized', 'alert'], ['unknown-state', 'Finance state unknown', 'status'],
  ] as const)('%s shows a notice and no amounts on every view', (name, title, role) => {
    for (const view of ['budget', 'breakdown', 'transactions', 'transaction-detail'] as const) {
      const { unmount } = show(name, view);
      expect(screen.getByRole(role)).toHaveTextContent(title);
      expect(document.body.textContent).not.toMatch(/\d\.\d{18}/u);
      expect(screen.queryByRole('region', { name: 'Snapshot and scope' })).toBeNull();
      unmount();
    }
  });
  it.each([['forged-scope', 'SCOPE_MISMATCH', '/scope/tenantId'], ['forged-snapshot', 'SNAPSHOT_MISMATCH', '/snapshotId'], ['unsupported-version', 'UNSUPPORTED_VERSION', '/schemaVersion'], ['invalid-shape', 'INVALID_SHAPE', '/summary/currencies']] as const)('%s is refused with %s and shows no amounts', (name, code, path) => {
    show(name, 'breakdown');
    expect(refusal()).toHaveTextContent(code);
    expect(refusal()).toHaveTextContent(path);
    expect(document.body.textContent).not.toMatch(/\d\.\d{18}/u);
    expect(screen.queryByText('account:another-tenant')).toBeNull();
  });
  it('labels every ready view SYNTHETIC_PROPOSAL with pending definitions and shows the opaque scope and snapshot as delivered', () => {
    show('ready', 'budget');
    expect(screen.getByRole('note')).toHaveTextContent('SYNTHETIC_PROPOSAL');
    expect(screen.getByRole('note')).toHaveTextContent('pending owner acknowledgement');
    const snapshot = region('Snapshot and scope');
    for (const text of ['account:synthetic-tenant', 'event:synthetic-project', 'account:synthetic-actor', 'definitions_pending_owner_signoff', 'unsupported_opaque_scope', 'ci08-reporting-policy-2.0.0']) expect(snapshot).toHaveTextContent(text);
    expect(snapshot).toHaveTextContent('not converted to a canonical identifier');
  });
});

describe('budget advisory', () => {
  it('shows producer strings verbatim, advisory capacity, and lifecycle consumed apart from ledger expense', () => {
    show('ready', 'budget');
    const card = region('USD budget advisory');
    expect(card).toHaveTextContent('Advisory only. Remaining authorized capacity is not spend authority');
    const pair = (title: string) => within(card).getByRole('heading', { name: title }).closest('section')!;
    expect(pair('Limit')).toHaveTextContent('100.000000000000000000 USD');
    expect(pair('Ledger expense')).toHaveTextContent('42.000000000000000000 USD');
    expect(pair('Lifecycle consumed')).toHaveTextContent('55.000000000000000000 USD');
    expect(pair('Lifecycle consumed')).toHaveTextContent('It is not ledger expense');
    expect(pair('Held')).toHaveTextContent('10.000000000000000000 USD');
    expect(pair('Remaining authorized capacity (advisory)')).toHaveTextContent('35.000000000000000000 USD');
    expect(pair('Remaining authorized capacity (advisory)')).toHaveTextContent('Not spend authority');
    expect(card).toHaveTextContent('Yes: exposure is unresolved');
    expect(card).toHaveTextContent('budget-policy-synthetic revision 1');
  });
  it('keeps mixed currencies as separate budgets and retains null limit and capacity as unknown, not zero', () => {
    show('mixed-currency-partial', 'budget');
    expect(region('USD budget advisory')).toHaveTextContent('100.000000000000000000 USD');
    const eur = region('EUR budget advisory');
    expect(eur).not.toHaveTextContent('USD');
    expect(within(eur).getByRole('heading', { name: 'Limit' }).closest('section')).toHaveTextContent('Amount unknown');
    expect(within(eur).getByRole('heading', { name: 'Limit' }).closest('section')).toHaveTextContent('This is not zero');
    expect(within(eur).getByRole('heading', { name: 'Remaining authorized capacity (advisory)' }).closest('section')).toHaveTextContent('not zero and not spend authority');
    expect(eur).toHaveTextContent('No policy reference delivered');
    expect(eur).toHaveTextContent('No unresolved exposure reported');
  });
  it('says no budget was delivered rather than showing a zero budget', () => {
    show('empty-budget', 'budget');
    expect(screen.getByText('No budget delivered')).toBeVisible();
    expect(screen.queryByRole('region', { name: /budget advisory/u })).toBeNull();
  });
  it('keeps coverage separate and the CFO export restricted with no success claim', () => {
    show('ready', 'budget');
    expect(region('Coverage')).toHaveTextContent('complete');
    const exportSection = region('CFO export');
    expect(exportSection).toHaveTextContent('Export is restricted');
    expect(within(exportSection).getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/\.csv|export (started|complete|succeeded)|downloaded/iu);
  });
});

describe('cost breakdown', () => {
  it('shows parent totals per currency verbatim with status, known subtotal, total and unknown count apart', () => {
    show('ready', 'breakdown');
    const table = within(region('USD parent totals')).getByRole('table', { name: 'USD parent totals' });
    const expense = within(table).getByRole('rowheader', { name: 'expense' }).closest('tr')!;
    expect(expense).toHaveTextContent('known');
    expect(within(expense).getAllByText('42.000000000000000000')).toHaveLength(2);
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Metric', 'Status', 'Known subtotal', 'Total', 'Unknown count']);
    expect(within(table).getAllByRole('rowheader').map((cell) => cell.textContent)).toEqual(['expense', 'grossSales', 'netSales', 'directCosts', 'contribution', 'cashReceipts', 'cashPayouts']);
  });
  it('separates mixed currencies, shows partial and unknown amounts with null retained, and unallocated groups', () => {
    show('mixed-currency-partial', 'breakdown');
    const usd = region('USD cost breakdown');
    const eur = region('EUR cost breakdown');
    expect(usd).not.toHaveTextContent('EUR');
    expect(eur).not.toHaveTextContent('USD');
    const usdTotals = within(usd).getByRole('table', { name: 'USD parent totals' });
    const expense = within(usdTotals).getByRole('rowheader', { name: 'expense' }).closest('tr')!;
    expect(expense).toHaveTextContent('partial');
    expect(expense).toHaveTextContent('30.000000000000000000 USD');
    expect(expense).toHaveTextContent('Amount unknown');
    expect(within(expense).getAllByRole('cell').at(-1)).toHaveTextContent('2');
    const contribution = within(usdTotals).getByRole('rowheader', { name: 'contribution' }).closest('tr')!;
    expect(contribution).toHaveTextContent('unknown');
    expect(within(contribution).getAllByText('Amount unknown')).toHaveLength(2);
    expect(within(usd).getByRole('table', { name: 'USD by provider' })).toHaveTextContent('Unallocated (no value delivered)');
    expect(within(usd).getByRole('table', { name: 'USD by provider' })).toHaveTextContent('unknown_unallocated');
    expect(within(eur).getByRole('table', { name: 'EUR parent totals' })).toHaveTextContent('8.000000000000000000 EUR');
  });
  it('keeps estimated, confirmed, unknown, reconciliation and simulated apart, and coverage in its own section', () => {
    show('mixed-currency-partial', 'breakdown');
    const valuation = within(region('USD valuation and reconciliation')).getByRole('table', { name: 'USD valuation' });
    expect(within(valuation).getByRole('rowheader', { name: 'Estimated' }).closest('tr')).toHaveTextContent('partial');
    expect(within(valuation).getByRole('rowheader', { name: 'Confirmed' }).closest('tr')).toHaveTextContent('known');
    expect(region('USD valuation and reconciliation')).toHaveTextContent('Unknown valuation count2');
    expect(region('USD simulated')).toHaveTextContent('Simulated expense');
    expect(screen.getAllByText(/simulated \(not actual\)/iu).length).toBeGreaterThan(0);
    const coverage = region('Coverage');
    expect(coverage).toHaveTextContent('partial');
    expect(coverage).toHaveTextContent('synthetic-cash-source');
    expect(coverage).toHaveTextContent('Unknown amount count2');
  });
  it('shows unknown coverage with unknown expected sources and every amount unknown, never zero', () => {
    show('unknown-coverage', 'breakdown');
    expect(region('Coverage')).toHaveTextContent('ExpectedUnknown');
    expect(region('Coverage')).toHaveTextContent('synthetic-expense-source');
    expect(within(region('USD parent totals')).getByRole('table').textContent).not.toMatch(/\d\.\d{18}/u);
  });
  it('never combines currencies: no combined or converted total is rendered', () => {
    show('mixed-currency-partial', 'breakdown');
    expect(screen.queryAllByRole('heading', { name: /combined|converted|all currencies|grand total/iu })).toHaveLength(0);
  });
});

describe('transaction drilldown', () => {
  const href = (id: string) => routeHref('/admin/finance', 'transaction-detail', { id });
  it('lists details with exact strings, negative refund, null amount unknown, and producer detailCount/hasMore', () => {
    show('ready', 'transactions', { detailHref: href });
    const table = screen.getByRole('table', { name: 'Transaction details' });
    expect(within(table).getByRole('link', { name: detailIds.refund }).closest('tr')).toHaveTextContent('-10.000000000000000000 USD');
    expect(within(table).getByRole('link', { name: detailIds.refund }).closest('tr')).toHaveTextContent('sale.refunded');
    expect(within(table).getByRole('link', { name: detailIds.unknown }).closest('tr')).toHaveTextContent('Amount unknown');
    expect(region('Transactions')).toHaveTextContent('Detail count (producer)4');
    expect(region('Transactions')).toHaveTextContent('More rows exist');
    expect(within(table).getByRole('link', { name: detailIds.refund })).toHaveAttribute('href', href(detailIds.refund));
  });
  it('states that more rows exist without fetching them when hasMore is true', () => {
    const fixture = financeV2Fixture('ready');
    const page = { ...(fixture.input as { page: Record<string, unknown> }).page, hasMore: true, nextCursor: 'synthetic-cursor', detailCount: 40 };
    render(<FinanceV2View {...props('ready', 'transactions')} input={{ status: 'ready', page }} />);
    expect(region('Transactions')).toHaveTextContent('Yes. Only the delivered page is shown');
    expect(region('Transactions')).toHaveTextContent('synthetic-cursor');
    expect(region('Transactions')).toHaveTextContent('Detail count (producer)40');
  });
  it('filters by valuation and currency without changing any amount, and reports an empty filter', () => {
    show('mixed-currency-partial', 'transactions');
    const table = () => screen.getByRole('table', { name: 'Transaction details' });
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
    expect(within(table()).getAllByRole('row')).toHaveLength(2);
    expect(table()).toHaveTextContent('8.000000000000000000 EUR');
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'all' } });
    fireEvent.change(screen.getByLabelText('Valuation'), { target: { value: 'unknown' } });
    expect(table()).toHaveTextContent('Amount unknown');
    expect(table()).not.toHaveTextContent('12.000000000000000000');
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'EUR' } });
    expect(table()).toHaveTextContent('No transactions match these filters.');
  });
  it('shows a detail with all separate states, dimensions, metrics and the same-snapshot, same-currency parent totals verbatim', () => {
    show('refund-negative', 'transaction-detail', { detailId: detailIds.refund, listHref: '/admin/finance/transactions' });
    expect(region('Transaction detail')).toHaveTextContent('-10.000000000000000000 USD');
    expect(region('Transaction detail')).toHaveTextContent('sale.refunded');
    expect(region('Detail states')).toHaveTextContent('provider_confirmed');
    expect(region('Detail states')).toHaveTextContent('partly_paid');
    expect(region('Detail dimensions')).toHaveTextContent('Not set');
    expect(region('Detail dimensions')).toHaveTextContent('order-1');
    expect(region('Detail metrics')).toHaveTextContent('netSales-10.000000000000000000 USD');
    expect(region('Detail metrics')).toHaveTextContent('simulatedExpense');
    const parent = region('USD parent totals for this snapshot');
    expect(parent).toHaveTextContent('This detail is not added to them');
    expect(within(parent).getByRole('rowheader', { name: 'netSales' }).closest('tr')).toHaveTextContent('-10.000000000000000000 USD');
    expect(screen.getByRole('link', { name: 'Back to transactions' })).toHaveAttribute('href', '/admin/finance/transactions');
  });
  it('shows an unknown detail amount as unknown and a missing detail as absent from the snapshot', () => {
    const unknown = show('unknown-coverage', 'transaction-detail', { detailId: detailIds.unknown });
    expect(region('Transaction detail')).toHaveTextContent('Amount unknown');
    expect(region('Detail states')).toHaveTextContent('unknown');
    unknown.unmount();
    show('ready', 'transaction-detail', { detailId: 'sha256:' + 'f'.repeat(64) });
    expect(screen.getByRole('status')).toHaveTextContent('Transaction not in this snapshot');
    expect(document.body.textContent).not.toMatch(/\d\.\d{18}/u);
  });
  it('uses the detail currency for the parent totals when currencies are mixed', () => {
    show('mixed-currency-partial', 'transaction-detail', { detailId: detailIds.eur });
    expect(region('EUR parent totals for this snapshot')).toHaveTextContent('8.000000000000000000 EUR');
    expect(screen.queryByRole('region', { name: 'USD parent totals for this snapshot' })).toBeNull();
  });
});

describe('no browser arithmetic (source)', () => {
  it('does not parse, sum, round or compare money in the view or the guard', () => {
    const dir = 'src/views/finance-v2/';
    for (const file of readdirSync(dir).filter((name) => /^(FinanceV2Views\.tsx|check\.ts)$/u.test(name))) {
      const source = readFileSync(dir + file, 'utf8');
      expect(source, file).not.toMatch(/parseFloat|parseInt|Number\(|BigInt|Decimal|\.reduce\(|toFixed|Math\.|Intl\.NumberFormat|toLocaleString/u);
    }
  });
});

describe('through the real Dashboard routes (synthetic fixture mode)', () => {
  const routes: readonly (readonly [string, FinanceV2ViewName, string])[] = [['/admin/finance/budgets', 'budget', 'Budget advisory'], ['/admin/finance/ai-costs', 'breakdown', 'Cost breakdown'], ['/admin/finance/transactions', 'transactions', 'Transaction drilldown']];
  it.each(routes)('mounts %s after the provider resolves', async (pathname, view, heading) => {
    render(<Dashboard basePath="/admin/finance" pathname={pathname} navigate={() => undefined} access={authorizedFixture} provider={fixtureProvider('ready')}
      renderRoute={() => <FinanceV2View {...props('ready', view)} />} />);
    expect(await screen.findByRole('region', { name: heading })).toBeVisible();
    expect(screen.getByRole('note')).toHaveTextContent('SYNTHETIC_PROPOSAL');
  });
  it('does not render the view or any amount for restricted host access', async () => {
    render(<Dashboard basePath="/admin/finance" pathname="/admin/finance/budgets" navigate={() => undefined} access={{ status: 'restricted' }} provider={fixtureProvider('ready')}
      renderRoute={() => <FinanceV2View {...props('ready', 'budget')} />} />);
    await new Promise((settle) => setTimeout(settle, 20));
    expect(screen.queryByRole('region', { name: 'Budget advisory' })).toBeNull();
    expect(screen.queryByText('100.000000000000000000 USD')).toBeNull();
  });
  it('covers every named fixture on every view without throwing', () => {
    for (const name of financeV2FixtureNames) for (const view of ['budget', 'breakdown', 'transactions', 'transaction-detail'] as const) { const { unmount } = show(name, view, { detailId: detailIds.aiCost }); unmount(); }
  });
});
