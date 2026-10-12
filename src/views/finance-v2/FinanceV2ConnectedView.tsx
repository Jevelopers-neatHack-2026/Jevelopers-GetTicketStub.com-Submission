import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { FinanceV2View, type FinanceV2TransactionFilters, type FinanceV2ViewName, type FinanceV2ViewProps } from './FinanceV2Views';
import { FINANCE_V2_FAULT_COPY, useFinanceV2Read, type FinanceV2Authorization, type FinanceV2HostAvailability, type FinanceV2SyntheticReadPort } from './async-port';
import type { FinanceV2TrustedReferences } from './check';
import type { OpaqueProductScope } from './types';

type Shared = Readonly<{
  view: FinanceV2ViewName;
  /** Explicit host gate. Nothing is read unless the host states `available`; the dashboard never derives it from a grant. */
  availability: FinanceV2HostAvailability;
  /** The host's own trusted scope, snapshot and hashes, stated independently of the response. */
  scope: OpaqueProductScope;
  expectedSnapshotId: string;
  expectedQueryContentHash: string;
  expectedSummaryContentHash: string;
  /** References the host pinned independently of the response (for example from a digest-verified definition registry). */
  expectedReferences?: FinanceV2TrustedReferences;
  authorization: FinanceV2Authorization;
  timeoutMs?: number;
  /** `FinancialSummaryQueryV2.pageSize` (1..500), host-stated. */
  pageSize?: number;
  /**
   * Opaque cursor kept in the host's own durable context (for example a deep link or reload). Cursor metadata only, never a credential and never an authority: the page that
   * answers it must still match the host's scope, snapshot and hashes. Read once; to apply a different one the host remounts this view.
   */
  initialCursor?: string;
  /** Told the cursor of the page now requested (`null` for the first page), so the host can keep it in its own context. */
  onCursorChange?: (cursor: string | null) => void;
}> & Pick<FinanceV2ViewProps, 'detailId' | 'detailHref' | 'listHref' | 'onNavigate' | 'filters' | 'onFiltersChange'>;

/**
 * `SYNTHETIC_PROPOSAL` takes a host-injected port that declares itself synthetic. `INTEGRATED` accepts no port at all (`port?: undefined`):
 * no accepted Finance port type exists, so an integrated mount is always unavailable and there is no path from it to a fixture.
 */
export type FinanceV2ConnectedViewProps = Shared & (
  | Readonly<{ mode: 'SYNTHETIC_PROPOSAL'; port?: FinanceV2SyntheticReadPort }>
  | Readonly<{ mode: 'INTEGRATED'; port?: undefined }>
);

const UNAVAILABLE_COPY = {
  'integrated-port-not-accepted': 'Integrated Finance v2 reporting is not available: no accepted read port exists. No fixture data is substituted and no amounts are shown.',
  'no-port': 'No Finance v2 read port was provided by the host. No fixture data is substituted and no amounts are shown.',
  'port-kind-mismatch': 'The provided read port is not usable in this mode. No fixture data is substituted and no amounts are shown.',
} as const;
const GATED_COPY = {
  restricted: 'The host reports that this report is restricted for your access. No amounts are shown.',
  unauthorized: 'The host reports that you are not authorized to view this report. No amounts are shown.',
  unavailable: 'The host reports that Finance reporting is unavailable. No amounts are shown.',
} as const;
const HEADINGS: Readonly<Record<FinanceV2ViewName, string>> = { budget: 'Budget advisory', breakdown: 'Cost breakdown', transactions: 'Transaction drilldown', 'transaction-detail': 'Transaction detail view' };

/**
 * Read-only connected Finance v2 view. It requests the report through the injected port with the host's independent identity,
 * shows loading, typed errors with retry, and the missing/restricted/unauthorized/unknown states without any amount, and hands a
 * page to `FinanceV2View` only after the identity check passed. CFO export stays unavailable: no export port exists in this slice.
 */
export function FinanceV2ConnectedView(props: FinanceV2ConnectedViewProps) {
  const headingId = useId();
  // The transaction filters are owned here unless the host owns them, so a change of either always reaches the read and returns the list to the first page.
  const [localFilters, setLocalFilters] = useState<FinanceV2TransactionFilters>({ valuation: 'all', currency: 'all' });
  const hostFilters = props.filters !== undefined && props.onFiltersChange !== undefined;
  const filters = hostFilters ? props.filters! : localFilters;
  const onFiltersChange = hostFilters ? props.onFiltersChange! : setLocalFilters;
  const { state, retry, paging } = useFinanceV2Read({
    mode: props.mode, port: props.port, availability: props.availability, scope: props.scope, expectedSnapshotId: props.expectedSnapshotId,
    expectedQueryContentHash: props.expectedQueryContentHash, expectedSummaryContentHash: props.expectedSummaryContentHash, authorization: props.authorization,
    resetKey: JSON.stringify([filters.valuation, filters.currency]),
    ...(props.expectedReferences ? { expectedReferences: props.expectedReferences } : {}),
    ...(props.timeoutMs !== undefined ? { timeoutMs: props.timeoutMs } : {}),
    ...(props.pageSize !== undefined ? { pageSize: props.pageSize } : {}),
    ...(props.initialCursor !== undefined ? { initialCursor: props.initialCursor } : {}),
    ...(props.onCursorChange ? { onCursorChange: props.onCursorChange } : {}),
  });
  // Retry and page focus: the Retry, Next page and Previous page buttons unmount when loading starts, which would drop focus to <body>. After one of them, focus moves
  // to the heading of the view that follows the hidden anchor (loading, error or result), but only while focus is on <body> or still inside that view, so a place the
  // user moved to is never taken. The anchor is hidden, so it adds nothing to layout or the accessibility tree.
  const anchor = useRef<HTMLSpanElement>(null);
  const retryFocus = useRef(false);
  useEffect(() => {
    if (!retryFocus.current) return;
    if (state.phase !== 'loading') retryFocus.current = false;
    const view = anchor.current?.nextElementSibling;
    const active = document.activeElement;
    if (!view || (active !== null && active !== document.body && !view.contains(active))) { retryFocus.current = false; return; }
    const heading = view.querySelector('h2');
    if (heading) { heading.tabIndex = -1; heading.focus(); }
  }, [state.phase]);
  const onRetry = () => { retryFocus.current = true; retry(); };
  const pageLabel = paging.pageNumber === null ? 'Linked page (position from the first page unknown)' : `Page ${paging.pageNumber}`;
  const onPage = (direction: 'previous' | 'next') => { retryFocus.current = true; if (direction === 'next') paging.next(); else paging.previous(); };
  const onRestart = () => { retryFocus.current = true; paging.restart(); };
  // Whatever the continuation did not deliver, the way out is the first page; no earlier amount is kept or shown meanwhile.
  const escape = paging.canPrevious && state.phase !== 'ready' && state.phase !== 'unavailable' && state.phase !== 'gated'
    ? <p><button type="button" onClick={onRestart}>Return to first page</button></p> : null;
  const shell = (body: ReactNode) => <section className="td-component-stack" aria-labelledby={headingId}><h2 id={headingId}>{HEADINGS[props.view] ?? 'Finance v2'}</h2>{body}</section>;
  const notice = (title: string, text: string, role: 'status' | 'alert', extra?: ReactNode) => shell(<section className="td-example-section" role={role}><h3>{title}</h3><p>{text}</p>{extra}</section>);
  const view = (): ReactNode => {
    switch (state.phase) {
    case 'unavailable': return notice('Finance v2 unavailable', UNAVAILABLE_COPY[state.reason], 'status');
    case 'gated': return notice('Finance v2 not available to you', GATED_COPY[state.reason], state.reason === 'unauthorized' ? 'alert' : 'status');
    case 'loading': return shell(<p role="status" aria-busy="true">Loading the report. No amounts are shown until it is verified.</p>);
    case 'error': return notice('Report could not be loaded', FINANCE_V2_FAULT_COPY[state.kind], 'alert', state.retryable ? <button type="button" onClick={onRetry}>Retry</button> : null);
    case 'refused': return shell(<section className="td-example-section" role="alert"><h3>Report refused</h3>
      <p>This report failed the presentation check, so it is not displayed. No amounts are shown.</p>
      <dl><div><dt>Refusal code</dt><dd>{state.code}</dd></div><div><dt>Refusal path</dt><dd>{state.path}</dd></div></dl></section>);
    case 'ready':
      return <FinanceV2View mode="SYNTHETIC_PROPOSAL" view={props.view} input={{ status: 'ready', page: state.page }} expectedScope={props.scope} expectedSnapshotId={props.expectedSnapshotId}
        expectedQueryContentHash={props.expectedQueryContentHash} expectedSummaryContentHash={props.expectedSummaryContentHash} {...(props.expectedReferences ? { expectedReferences: props.expectedReferences } : {})}
        {...(props.detailId !== undefined ? { detailId: props.detailId } : {})} {...(props.detailHref ? { detailHref: props.detailHref } : {})} {...(props.listHref ? { listHref: props.listHref } : {})}
        {...(props.onNavigate ? { onNavigate: props.onNavigate } : {})} filters={filters} onFiltersChange={onFiltersChange}
        paging={{ pageLabel, hasPrevious: paging.canPrevious, hasNext: paging.canNext, onNavigate: onPage }} />;
    default:
      return <FinanceV2View mode="SYNTHETIC_PROPOSAL" view={props.view} input={{ status: state.phase }} expectedScope={props.scope} />;
    }
  };
  return <><span hidden ref={anchor} />{view()}{escape}</>;
}
