import { useId, useState, type MouseEvent, type ReactNode } from 'react';
import { AmountText, type AmountDisplay } from '../../components/AmountText';
import { FilterSelect } from '../../components/FilterSelect';
import { MetricCard } from '../../components/MetricCard';
import { ScopeContext } from '../../components/ScopeContext';
import { StateBadge } from '../../components/StateBadge';
import { TableScroll } from '../../components/TableScroll';
import { checkFinanceV2Page } from './check';
import {
  DETAIL_METRIC_NAMES, METRIC_NAMES, REPORTING_DIMENSIONS,
  type FinanceV2Input, type FinanceV2Mode, type FinanceV2Page, type OpaqueProductScope, type ReportingAmount, type ReportingBudget, type ReportingCoverage,
  type ReportingCurrencySummary, type ReportingDetail, type ReportingGroup,
} from './types';

export type FinanceV2ViewName = 'budget' | 'breakdown' | 'transactions' | 'transaction-detail';
/** Transaction list filter selection. `all` means unfiltered; `unknown` is a real valuation value and is never treated as `all`. */
export type FinanceV2TransactionFilters = Readonly<{ valuation: string; currency: string }>;
const VALUATION_FILTERS = ['all', 'estimated', 'provider_confirmed', 'unknown'] as const;
export type FinanceV2ViewProps = Readonly<{
  /** Must be the literal `SYNTHETIC_PROPOSAL`. The frozen Finance v2 proposal is not accepted, so nothing else is rendered. */
  mode: FinanceV2Mode;
  view: FinanceV2ViewName;
  input: FinanceV2Input;
  /** The host's own opaque scope. A page for any other scope is refused, never shown. Nothing is derived from it. */
  expectedScope: OpaqueProductScope;
  expectedSnapshotId?: string;
  /** Detail id for `transaction-detail`. */
  detailId?: string;
  detailHref?: (detailId: string) => string;
  /** Where "Back to transactions" goes. The host puts its filter and snapshot context in this href so return and deep links keep them. */
  listHref?: string;
  onNavigate?: (href: string) => void;
  /**
   * Host-owned transaction filters (for example kept in the URL query) so they survive detail navigation, reload and deep links.
   * Used only together with `onFiltersChange`; otherwise the list keeps its own local selection. A value that is not one of the
   * offered options is shown as `all`, never guessed.
   */
  filters?: FinanceV2TransactionFilters;
  onFiltersChange?: (next: FinanceV2TransactionFilters) => void;
}>;

const known = (text: string, currency: string): AmountDisplay => ({ status: 'available', text, currency });
const orUnknown = (text: string | null, currency: string): AmountDisplay => (text === null ? { status: 'unknown' } : known(text, currency));

function Notice({ title, children, alert }: { title: string; children: ReactNode; alert?: boolean }) {
  return <section className="td-example-section" role={alert ? 'alert' : 'status'}><h3>{title}</h3><p>{children}</p></section>;
}
function Section({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return <section className="td-example-section" aria-label={label}><h3>{title ?? label}</h3>{children}</section>;
}
function Row({ term, children }: { term: string; children: ReactNode }) { return <div><dt>{term}</dt><dd>{children}</dd></div>; }

/** One producer `ReportingAmount`, verbatim: status, known subtotal, total and unknown count stay separate; null is "unknown", never zero. */
function ReportingAmountCells({ amount, currency }: { amount: ReportingAmount; currency: string }) {
  return <>
    <td>{amount.status}</td>
    <td><AmountText amount={orUnknown(amount.knownSubtotal, currency)} /></td>
    <td><AmountText amount={orUnknown(amount.total, currency)} /></td>
    <td>{amount.unknownCount}</td>
  </>;
}
const AMOUNT_HEAD = <><th scope="col">Status</th><th scope="col">Known subtotal</th><th scope="col">Total</th><th scope="col">Unknown count</th></>;

function MetricsTable({ caption, metrics, currency }: { caption: string; metrics: ReportingCurrencySummary['metrics']; currency: string }) {
  return <TableScroll caption={caption}><table className="td-table"><caption>{caption}</caption>
    <thead><tr><th scope="col">Metric</th>{AMOUNT_HEAD}</tr></thead>
    <tbody>{METRIC_NAMES.map((name) => <tr key={name}><th scope="row">{name}</th><ReportingAmountCells amount={metrics[name]} currency={currency} /></tr>)}</tbody>
  </table></TableScroll>;
}

function Banner({ page }: { page: FinanceV2Page }) {
  return <>
    <p role="note"><strong>SYNTHETIC_PROPOSAL</strong>: offline fixture generated from the frozen, unaccepted Finance v2 proposal. Not Finance output, not an observation, not owner-accepted. Metric definitions are pending owner acknowledgement.</p>
    <ScopeContext scope={{ status: 'available', projectLabel: page.scope.projectId, periodLabel: `${page.period.start} to ${page.period.end}`, currencyLabel: page.summary.currencies.map((entry) => `${entry.currency} (scale ${entry.scale})`).join(', ') || 'None delivered' }} />
    <Section label="Snapshot and scope" title="Snapshot and scope">
      <dl>
        <Row term="Tenant">{page.scope.tenantId}</Row>
        <Row term="Project">{page.scope.projectId}</Row>
        <Row term="Environment">{page.scope.environment}</Row>
        <Row term="Billing mode">{page.scope.billingMode}</Row>
        <Row term="Actor">{page.scope.actorId}</Row>
        <Row term="Snapshot">{page.snapshotId}</Row>
        <Row term="Query hash">{page.queryContentHash}</Row>
        <Row term="Summary hash">{page.summaryContentHash}</Row>
        <Row term="As of">{page.asOf} ({page.timezone})</Row>
        <Row term="Request">{page.requestId}</Row>
        <Row term="Policy version">{page.summary.policyVersion}</Row>
        <Row term="Accounting policy version">{page.summary.accountingPolicyVersion}</Row>
        <Row term="Definitions status">{page.summary.definitionsStatus}</Row>
        <Row term="Canonical mapping">{page.canonicalMappingStatus}. The opaque product scope is shown as delivered and is not converted to a canonical identifier; no grant is derived from it. This view does not depend on a canonical summary.</Row>
      </dl>
    </Section>
  </>;
}

function ExportUnavailable() {
  return <Section label="CFO export" title="CFO export">
    <p role="status">Export is restricted. No approved export port is connected, so no file is produced and no export success is claimed.</p>
    <button type="button" disabled>Export unavailable</button>
  </Section>;
}

function Coverage({ coverage }: { coverage: ReportingCoverage }) {
  return <Section label="Coverage" title="Coverage">
    <dl>
      <Row term="Coverage status">{coverage.status}</Row>
      <Row term="Observed">{coverage.observed}</Row>
      <Row term="Expected">{coverage.expected === null ? 'Unknown' : coverage.expected}</Row>
      <Row term="Unknown amount count">{coverage.unknownAmountCount}</Row>
      <Row term="Unposted attempts">{coverage.unpostedAttemptCount}</Row>
      <Row term="Attempts awaiting evidence">{coverage.awaitingEvidenceAttemptCount}</Row>
      <Row term="Quarantined observations">{coverage.quarantinedObservationCount}</Row>
      <Row term="Unsupported events">{coverage.unsupportedEventCount}</Row>
      <Row term="Missing sources">{coverage.missingSources.length ? <ul>{coverage.missingSources.map((source) => <li key={source}>{source}</li>)}</ul> : 'None reported'}</Row>
    </dl>
  </Section>;
}

/* ---------- Budget advisory ---------- */
function BudgetCard({ budget }: { budget: ReportingBudget }) {
  const c = budget.currency;
  return <section className="td-example-section" aria-label={`${c} budget advisory`}>
    <h3>{c} budget advisory</h3>
    <p>Advisory only. Remaining authorized capacity is not spend authority, and lifecycle consumption is not ledger expense.</p>
    <div className="td-metrics">
      <MetricCard title={`${c} limit`} amount={orUnknown(budget.limit, c)} description={budget.limit === null ? 'No limit delivered. This is not zero.' : 'Producer limit, as delivered.'} />
      <MetricCard title={`${c} ledger expense`} amount={known(budget.ledgerExpense, c)} description="Recognized in the ledger." />
      <MetricCard title={`${c} lifecycle consumed`} amount={known(budget.lifecycleConsumed, c)} description="Lifecycle consumption. It is not ledger expense." />
      <MetricCard title={`${c} held`} amount={known(budget.held, c)} description="Held, as delivered." />
      <MetricCard title={`${c} remaining authorized capacity (advisory)`} amount={orUnknown(budget.remainingAuthorizedCapacity, c)} description={budget.remainingAuthorizedCapacity === null ? 'Not delivered. This is not zero and not spend authority.' : 'Advisory only. Not spend authority.'} />
    </div>
    <dl>
      <Row term="Window">{budget.window}</Row>
      <Row term="Policy reference">{budget.policyReference ? `${budget.policyReference.id} revision ${budget.policyReference.revision} (${budget.policyReference.contentHash})` : 'No policy reference delivered'}</Row>
      <Row term="Unresolved exposure">{budget.unresolvedExposure ? 'Yes: exposure is unresolved' : 'No unresolved exposure reported'}</Row>
      <Row term="Advisory only">{String(budget.advisoryOnly)}</Row>
    </dl>
  </section>;
}
function BudgetView({ page }: { page: FinanceV2Page }) {
  const budgets = page.summary.budgets;
  return <>
    {budgets.length === 0 ? <Notice title="No budget delivered">No budget advisory was delivered for this snapshot. This is not a zero budget.</Notice> : budgets.map((budget) => <BudgetCard key={budget.currency} budget={budget} />)}
    <Coverage coverage={page.summary.coverage} />
    <ExportUnavailable />
  </>;
}

/* ---------- Cost breakdown ---------- */
function groupLabel(group: ReportingGroup): string { return group.value === null ? 'Unallocated (no value delivered)' : group.value; }
function CurrencyBreakdown({ entry }: { entry: ReportingCurrencySummary }) {
  const c = entry.currency;
  const groups = REPORTING_DIMENSIONS.map((dimension) => ({ dimension, rows: entry.groups.filter((group) => group.dimension === dimension) })).filter(({ rows }) => rows.length > 0);
  return <section className="td-example-section" aria-label={`${c} cost breakdown`}>
    <h3>{c} cost breakdown</h3>
    <p>Totals are shown as delivered for {c} only. Other currencies are never added to or converted into this one.</p>
    <MetricsTable caption={`${c} parent totals`} metrics={entry.metrics} currency={c} />
    {groups.map(({ dimension, rows }) => <TableScroll key={dimension} caption={`${c} by ${dimension}`}><table className="td-table"><caption>{c} by {dimension}</caption>
      <thead><tr><th scope="col">{dimension}</th><th scope="col">Bucket</th><th scope="col">Events</th><th scope="col">Expense status</th><th scope="col">Expense known subtotal</th><th scope="col">Expense total</th><th scope="col">Expense unknown count</th></tr></thead>
      <tbody>{rows.map((group, index) => <tr key={`${group.value ?? 'null'}-${index}`}><th scope="row">{groupLabel(group)}</th><td>{group.bucket}</td><td>{group.eventCount}</td><ReportingAmountCells amount={group.metrics.expense} currency={c} /></tr>)}</tbody>
    </table></TableScroll>)}
    <Section label={`${c} valuation and reconciliation`} title={`${c} valuation and reconciliation`}>
      <p>Estimated, confirmed and unknown are separate. None is folded into another.</p>
      <TableScroll caption={`${c} valuation`}><table className="td-table"><caption>{c} valuation</caption>
        <thead><tr><th scope="col">Valuation</th>{AMOUNT_HEAD}</tr></thead>
        <tbody>
          <tr><th scope="row">Estimated</th><ReportingAmountCells amount={entry.valuation.estimated} currency={c} /></tr>
          <tr><th scope="row">Confirmed</th><ReportingAmountCells amount={entry.valuation.confirmed} currency={c} /></tr>
        </tbody></table></TableScroll>
      <dl>
        <Row term="Unknown valuation count">{entry.valuation.unknownCount}</Row>
        <Row term="Reconciliation matched">{entry.reconciliation.matchedCount}</Row>
        <Row term="Reconciliation unmatched">{entry.reconciliation.unmatchedCount}</Row>
        <Row term="Reconciliation exceptions">{entry.reconciliation.exceptionCount}</Row>
      </dl>
    </Section>
    <Section label={`${c} simulated`} title={`${c} simulated (not actual)`}>
      <dl>
        <Row term="Simulated expense"><AmountText amount={known(entry.simulated.expense, c)} /></Row>
        <Row term="Simulated gross sales"><AmountText amount={known(entry.simulated.grossSales, c)} /></Row>
        <Row term="Simulated net sales"><AmountText amount={known(entry.simulated.netSales, c)} /></Row>
        <Row term="Simulated direct costs"><AmountText amount={known(entry.simulated.directCosts, c)} /></Row>
      </dl>
    </Section>
  </section>;
}
function BreakdownView({ page }: { page: FinanceV2Page }) {
  const currencies = page.summary.currencies;
  return <>
    {currencies.length === 0 ? <Notice title="No currency summary delivered">No cost breakdown was delivered for this snapshot. This is not a zero total.</Notice> : currencies.map((entry) => <CurrencyBreakdown key={entry.currency} entry={entry} />)}
    <Coverage coverage={page.summary.coverage} />
    <ExportUnavailable />
  </>;
}

/* ---------- Transaction drilldown ---------- */
type Nav = Pick<FinanceV2ViewProps, 'detailHref' | 'onNavigate' | 'listHref'>;
function Anchor({ href, onNavigate, children }: { href: string; onNavigate: ((href: string) => void) | undefined; children: ReactNode }) {
  return <a href={href} onClick={(event: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(href);
  }}>{children}</a>;
}
function TransactionList({ page, detailHref, onNavigate, filters, onFiltersChange }: { page: FinanceV2Page } & Nav & Pick<FinanceV2ViewProps, 'filters' | 'onFiltersChange'>) {
  const [local, setLocal] = useState<FinanceV2TransactionFilters>({ valuation: 'all', currency: 'all' });
  const currencies = page.summary.currencies.map((entry) => entry.currency);
  const hostOwned = filters !== undefined && onFiltersChange !== undefined;
  const selected = hostOwned ? filters : local;
  const valuation = (VALUATION_FILTERS as readonly string[]).includes(selected.valuation) ? selected.valuation : 'all';
  const currency = selected.currency === 'all' || currencies.includes(selected.currency) ? selected.currency : 'all';
  const setValuation = (next: string) => { const value = { valuation: next, currency }; if (hostOwned) onFiltersChange(value); else setLocal(value); };
  const setCurrency = (next: string) => { const value = { valuation, currency: next }; if (hostOwned) onFiltersChange(value); else setLocal(value); };
  const shown = page.details.filter((detail) => (valuation === 'all' || detail.valuation === valuation) && (currency === 'all' || detail.currency === currency));
  return <>
    <Section label="Transaction filters" title="Filters">
      <div className="td-filters">
        <FilterSelect label="Valuation" value={valuation} onChange={setValuation} options={[{ value: 'all', label: 'All valuations' }, { value: 'estimated', label: 'Estimated' }, { value: 'provider_confirmed', label: 'Provider confirmed' }, { value: 'unknown', label: 'Unknown' }]} />
        <FilterSelect label="Currency" value={currency} onChange={setCurrency} options={[{ value: 'all', label: 'All currencies' }, ...currencies.map((code) => ({ value: code, label: code }))]} />
      </div>
    </Section>
    <Section label="Transaction list" title="Transaction list">
      <dl>
        <Row term="Detail count (producer)">{page.detailCount}</Row>
        <Row term="More rows exist">{page.hasMore ? 'Yes. Only the delivered page is shown; no further page is fetched here.' : 'No'}</Row>
        <Row term="Next cursor">{page.nextCursor === null ? 'None' : page.nextCursor}</Row>
      </dl>
      <TableScroll caption="Transaction details"><table className="td-table"><caption>Transaction details</caption>
        <thead><tr><th scope="col">Detail</th><th scope="col">Occurred</th><th scope="col">Event type</th><th scope="col">Classification</th><th scope="col">Valuation</th><th scope="col">Reconciliation</th><th scope="col">Settlement</th><th scope="col">Status</th><th scope="col">Amount</th></tr></thead>
        <tbody>{shown.map((detail) => <tr key={detail.detailId}>
          <th scope="row">{detailHref ? <Anchor href={detailHref(detail.detailId)} onNavigate={onNavigate}>{detail.detailId}</Anchor> : detail.detailId}</th>
          <td>{detail.occurredAt}</td><td>{detail.eventType}</td><td>{detail.classification}</td><td>{detail.valuation}</td><td>{detail.reconciliation}</td><td>{detail.settlement}</td><td>{detail.status}</td>
          <td><AmountText amount={orUnknown(detail.amount, detail.currency)} /></td>
        </tr>)}{shown.length === 0 && <tr><td colSpan={9}><p role="status">No transactions match these filters.</p></td></tr>}</tbody>
      </table></TableScroll>
    </Section>
    <ExportUnavailable />
  </>;
}
function DetailBody({ detail, parent }: { detail: ReportingDetail; parent: ReportingCurrencySummary | undefined }) {
  const c = detail.currency;
  return <>
    <Section label="Transaction record" title="Transaction record">
      <dl>
        <Row term="Detail">{detail.detailId}</Row>
        <Row term="Currency">{c}</Row>
        <Row term="Event type">{detail.eventType}</Row>
        <Row term="Classification">{detail.classification}</Row>
        <Row term="Occurred">{detail.occurredAt}</Row>
        <Row term="Status">{detail.status}</Row>
        <Row term="Amount"><AmountText amount={orUnknown(detail.amount, c)} /></Row>
      </dl>
    </Section>
    <Section label="Detail states" title="Valuation, reconciliation and settlement">
      <div className="td-badges">{detail.valuation === 'estimated' && <StateBadge state="estimated" />}{detail.valuation === 'provider_confirmed' && <StateBadge state="confirmed" />}{detail.valuation === 'unknown' && <StateBadge state="unknown" />}</div>
      <dl><Row term="Valuation">{detail.valuation}</Row><Row term="Reconciliation">{detail.reconciliation}</Row><Row term="Settlement">{detail.settlement}</Row></dl>
    </Section>
    <Section label="Detail dimensions" title="Dimensions">
      <dl>{REPORTING_DIMENSIONS.map((key) => <Row key={key} term={key}>{detail.dimensions[key] ?? 'Not set'}</Row>)}</dl>
    </Section>
    <Section label="Detail metrics" title="Detail metrics">
      <dl>{DETAIL_METRIC_NAMES.map((name) => <Row key={name} term={name}><AmountText amount={known(detail.metrics[name], c)} /></Row>)}</dl>
    </Section>
    {parent ? <Section label={`${c} parent totals for this snapshot`} title={`${c} parent totals for this snapshot`}>
      <p>Synthetic parent totals supplied for the same snapshot and currency, as delivered. This detail is not added to them.</p>
      <MetricsTable caption={`${c} parent totals`} metrics={parent.metrics} currency={c} />
    </Section> : null}
  </>;
}
function DetailView({ page, detailId, listHref, onNavigate }: { page: FinanceV2Page; detailId: string | undefined } & Nav) {
  const detail = detailId === undefined ? undefined : page.details.find((item) => item.detailId === detailId);
  const back = listHref ? <p><Anchor href={listHref} onNavigate={onNavigate}>Back to transactions</Anchor></p> : null;
  if (!detail) return <>{back}<Notice title="Transaction not in this snapshot">This transaction was not delivered in this snapshot. No amounts are shown.</Notice></>;
  return <>{back}<DetailBody detail={detail} parent={page.summary.currencies.find((entry) => entry.currency === detail.currency)} /><ExportUnavailable /></>;
}

const HEADINGS: Readonly<Record<FinanceV2ViewName, string>> = { budget: 'Budget advisory', breakdown: 'Cost breakdown', transactions: 'Transaction drilldown', 'transaction-detail': 'Transaction detail view' };

/**
 * Read-only presentation of a Finance v2 reporting projection from the frozen WIP proposal, in explicit `SYNTHETIC_PROPOSAL` mode.
 * Amounts are producer strings, shown verbatim. There is no arithmetic, no cross-currency combination, no balance, no spend
 * authority and no grant: `remainingAuthorizedCapacity` is advisory and `lifecycleConsumed` is not `ledgerExpense`.
 */
export function FinanceV2View(props: FinanceV2ViewProps) {
  const headingId = useId();
  const { view, input, expectedScope, expectedSnapshotId, detailId, detailHref, listHref, onNavigate, filters, onFiltersChange } = props;
  const wrap = (body: ReactNode) => <section className="td-component-stack" aria-labelledby={headingId}><h2 id={headingId}>{HEADINGS[view] ?? 'Finance v2'}</h2>{body}</section>;
  if (props.mode !== 'SYNTHETIC_PROPOSAL') return wrap(<Notice alert title="Unsupported mode">This presentation only renders in explicit SYNTHETIC_PROPOSAL mode. Nothing is shown. Code UNSUPPORTED_MODE.</Notice>);
  if (!input || typeof input !== 'object') return wrap(<Notice title="Finance state unknown">The state of this report could not be determined. No amounts are shown.</Notice>);
  if (input.status === 'missing') return wrap(<Notice title="No report delivered">No Finance v2 report has been delivered for this scope. No amounts are shown.</Notice>);
  if (input.status === 'restricted') return wrap(<Notice title="Report restricted">This report is restricted for your access. No amounts are shown.</Notice>);
  if (input.status === 'unauthorized') return wrap(<Notice alert title="Not authorized">You are not authorized to view this report. No amounts are shown.</Notice>);
  if (input.status !== 'ready') return wrap(<Notice title="Finance state unknown">The state of this report could not be determined. No amounts are shown.</Notice>);
  const checked = checkFinanceV2Page(input.page, expectedScope, expectedSnapshotId);
  if (!checked.ok) {
    return wrap(<section className="td-example-section" role="alert"><h3>Report refused</h3>
      <p>This report failed the presentation check, so it is not displayed. No amounts are shown.</p>
      <dl><Row term="Refusal code">{checked.code}</Row><Row term="Refusal path">{checked.path}</Row></dl></section>);
  }
  const { page } = checked;
  return wrap(<>
    <Banner page={page} />
    {view === 'budget' && <BudgetView page={page} />}
    {view === 'breakdown' && <BreakdownView page={page} />}
    {view === 'transactions' && <TransactionList page={page} {...(detailHref ? { detailHref } : {})} {...(onNavigate ? { onNavigate } : {})} {...(filters ? { filters } : {})} {...(onFiltersChange ? { onFiltersChange } : {})} />}
    {view === 'transaction-detail' && <DetailView page={page} detailId={detailId} {...(listHref ? { listHref } : {})} {...(onNavigate ? { onNavigate } : {})} />}
  </>);
}
