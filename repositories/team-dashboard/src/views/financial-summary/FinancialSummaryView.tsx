import { useId, type ReactNode } from 'react';
import { MetricCard } from '../../components/MetricCard';
import { StateBadge } from '../../components/StateBadge';
import { ScopeContext } from '../../components/ScopeContext';
import { TableScroll } from '../../components/TableScroll';
import { SHARED_CONTRACTS_PIN, type ProjectionResult, type SummaryProjection } from '../../data/shared-contracts-adapter';
import { projectWrapperMetadata, type FinanceWrapperMetadata, type PacketOutcome } from './packet';

export type FinancialSummaryViewProps = Readonly<{
  /** Output of `readFinancialSummary` (or the refusal from `evaluateFinancePacket`). The view renders it and derives nothing from it. */
  result: ProjectionResult<SummaryProjection>;
  /** Host-authorized label. The projection carries no project identity, so none is invented when this is absent. */
  projectLabel?: string;
  /** Gate outcome for the handoff packet, when one was evaluated. Shown as adoption status only; it never changes the amounts. */
  packet?: PacketOutcome;
  /** Unvalidated Finance response-envelope metadata kept apart from the canonical summary. Only allowlisted, shape-checked fields are shown; nothing is summed or derived. */
  wrapper?: FinanceWrapperMetadata;
}>;

const UNSUPPORTED = new Set(['UNSUPPORTED_VERSION', 'UNSUPPORTED_INTERFACE', 'UNKNOWN_CONTRACT', 'UNACCEPTED_INTERFACE', 'LEGACY_UNREPRESENTABLE']);

function Notice({ title, children, alert }: { title: string; children: string; alert?: boolean }) {
  return <section className="td-example-section" role={alert ? 'alert' : 'status'}><h3>{title}</h3><p>{children}</p></section>;
}

/**
 * Read-only presentation of one producer `FinancialSummary` projection for one environment x billing partition.
 * Metric names, definition references and amount strings are shown exactly as delivered. There is no arithmetic, no
 * spent/earned/remaining/budget alias, and no balance: an absent metric reads "unavailable" and an unknown one "unknown".
 */
export function FinancialSummaryView({ result, projectLabel, packet, wrapper }: FinancialSummaryViewProps) {
  const headingId = useId();
  const heading = <h2 id={headingId}>Financial summary</h2>;
  const wrap = (body: ReactNode) => <section className="td-component-stack" aria-labelledby={headingId}>{heading}{body}</section>;
  if (result.status === 'missing' || result.status === 'restricted' || result.status === 'unknown') {
    if (result.status === 'missing') return wrap(<Notice title="No summary delivered">No financial summary has been delivered for this scope. No amounts are shown.</Notice>);
    if (result.status === 'restricted') return wrap(<Notice title="Summary restricted">This summary is restricted for your access. No amounts are shown.</Notice>);
    return wrap(<Notice title="Summary state unknown">The state of this summary could not be determined. No amounts are shown.</Notice>);
  }
  if (result.status === 'refused') {
    const unsupported = UNSUPPORTED.has(result.code);
    return wrap(<section className="td-example-section" role="alert">
      <h3>{unsupported ? 'Unsupported summary contract' : 'Summary refused'}</h3>
      <p>{unsupported ? 'This summary is not in a contract version or interface this dashboard accepts, so it is not displayed or reinterpreted.' : 'This summary failed the contract check, so it is not displayed.'}</p>
      <dl><div><dt>Refusal code</dt><dd>{result.code}</dd></div>{result.path && <div><dt>Refusal path</dt><dd>{result.path}</dd></div>}</dl>
    </section>);
  }
  if (!('data' in result)) return wrap(<Notice title="Summary state unknown">The state of this summary could not be determined. No amounts are shown.</Notice>);
  const data = result.data;
  const stale = result.status === 'stale';
  const metadata = projectWrapperMetadata(wrapper);
  const names = Object.keys(data.requested).length ? Object.keys(data.requested) : Object.keys(data.metrics);
  const present = names.filter((name) => Object.hasOwn(data.metrics, name));
  return wrap(<>
    {stale && <Notice title="Stale summary">This summary is older than the host freshness policy. Amounts are shown as last observed, not as current.</Notice>}
    <ScopeContext scope={{ status: 'available', projectLabel: projectLabel?.trim() || 'Not supplied by host', periodLabel: `${data.period.start} to ${data.period.end}`, currencyLabel: `${data.currency} (scale ${data.scale})` }} />
    <section className="td-example-section" aria-label="Summary states">
      <h3>States</h3>
      <div className="td-badges">{data.badges.map((state) => <StateBadge key={state} state={state} />)}</div>
      <dl>
        <div><dt>Environment</dt><dd>{data.partition.environment}</dd></div>
        <div><dt>Billing mode</dt><dd>{data.partition.billingMode}</dd></div>
        <div><dt>Valuation</dt><dd>{data.axes.valuation}</dd></div>
        <div><dt>Settlement</dt><dd>{data.axes.settlement}</dd></div>
        <div><dt>Reconciliation</dt><dd>{data.axes.reconciliation}</dd></div>
        <div><dt>Reservation</dt><dd>{data.axes.reservation}</dd></div>
        <div><dt>Completeness</dt><dd>{data.axes.completeness}</dd></div>
      </dl>
    </section>
    <section className="td-example-section" aria-label="Coverage and freshness">
      <h3>Coverage and freshness</h3>
      <dl>
        <div><dt>Sources observed</dt><dd>{data.coverage.observed}</dd></div>
        <div><dt>Sources expected</dt><dd>{data.coverage.expected === null ? 'Unknown' : data.coverage.expected}</dd></div>
        <div><dt>Missing sources</dt><dd>{data.coverage.missingSources.length ? <ul>{data.coverage.missingSources.map((source) => <li key={source}>{source}</li>)}</ul> : 'None reported'}</dd></div>
        <div><dt>Observed at</dt><dd>{data.observedAt}</dd></div>
        <div><dt>Ingested at</dt><dd>{data.ingestedAt}</dd></div>
      </dl>
    </section>
    <div className="td-metrics">{names.map((name) => {
      const metric = Object.hasOwn(data.metrics, name) ? data.metrics[name] : undefined;
      const amount = Object.hasOwn(data.requested, name) ? data.requested[name]! : metric!.amount;
      const note = !metric ? 'Not present in this summary record. This is not zero.'
        : amount.status === 'unknown' ? 'The producer declared this metric unknown. This is not zero.'
        : `Definition ${metric.definition.id} revision ${metric.definition.revision}; ${metric.sourceCount} source ${metric.sourceCount === 1 ? 'reference' : 'references'}.`;
      return <MetricCard key={name} title={name} amount={amount} description={note} />;
    })}</div>
    {present.length > 0 && <TableScroll caption="Metric provenance"><table>
      <caption>Metric provenance</caption>
      <thead><tr><th scope="col">Metric</th><th scope="col">Definition</th><th scope="col">Revision</th><th scope="col">Source references</th></tr></thead>
      <tbody>{present.map((name) => { const metric = data.metrics[name]!; return <tr key={name}><th scope="row">{name}</th><td>{metric.definition.id}</td><td>{metric.definition.revision}</td><td>{metric.sourceCount}</td></tr>; })}</tbody>
    </table></TableScroll>}
    <section className="td-example-section" aria-label="Summary provenance">
      <h3>Provenance</h3>
      <dl>
        <div><dt>Summary</dt><dd>{data.summaryId} revision {data.revision}</dd></div>
        <div><dt>Producer revision</dt><dd>{data.producerRevision}</dd></div>
        <div><dt>Contract</dt><dd>{SHARED_CONTRACTS_PIN.package}@{SHARED_CONTRACTS_PIN.version}, FinancialSummary 1.0.0</dd></div>
        <div><dt>Authority</dt><dd>Read-only projection</dd></div>
        {packet?.outcome === 'synthetic_development_only' && <div><dt>Contract adoption</dt><dd>Synthetic development only. Production adoption is not established{packet.ownerAcknowledgement === 'absent' ? ': no owner acknowledgement.' : ': the owner acknowledgement claimed in the packet is not verified.'}</dd></div>}
      </dl>
    </section>
    {(metadata.fields.length > 0 || metadata.withheld > 0) && <section className="td-example-section" aria-label="Finance response metadata">
      <h3>Finance response metadata</h3>
      <p>Unvalidated transport metadata. It is not bound to this summary's query or snapshot and is unsupported until a reviewed Finance producer port accepts it.</p>
      {metadata.fields.length > 0 && <dl>{metadata.fields.map(({ key, value }) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
      {metadata.withheld > 0 && <p>{metadata.withheld} other {metadata.withheld === 1 ? 'field' : 'fields'} withheld.</p>}
    </section>}
  </>);
}
