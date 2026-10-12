import { useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FinanceV2ConnectedView, type FinanceV2ConnectedViewProps, type FinanceV2ReadRequest, type FinanceV2SyntheticReadPort } from '../../src/views/finance-v2';
import { detailIds, syntheticOpaqueScope, syntheticQueryContentHash, syntheticSnapshotId, syntheticSummaryContentHash } from '../../src/views/finance-v2/fixtures';
import { syntheticPagedCursors, syntheticPagedPage, syntheticPagedPort } from '../../integration/fixture-host/finance-v2-paged';

/**
 * HAND-AUTHORED SYNTHETIC pages (see `finance-v2-paged.ts`). Nothing here is Finance output or a producer-produced continuation chain; produced multi-page
 * conformance is pending actual artifacts. The manual port ignores `request.signal` on purpose, so a late answer is real and must still be dropped.
 */
type Answer = Awaited<ReturnType<FinanceV2SyntheticReadPort['read']>>;
type Pending = { request: FinanceV2ReadRequest; resolve: (value: Answer) => void; reject: (error: unknown) => void };
function manualPort() {
  const pending: Pending[] = [];
  const port: FinanceV2SyntheticReadPort = { kind: 'SYNTHETIC_PROPOSAL', read: (request) => new Promise((resolve, reject) => { pending.push({ request, resolve, reject }); }) };
  return { port, pending };
}
const token = vi.fn(async () => 'opaque-token-1');
const authorization = (revision = '1', value: string | null = 'opaque-token-1') => ({ revision, token: async () => value });
function connected(port: FinanceV2SyntheticReadPort | undefined, over: Partial<FinanceV2ConnectedViewProps> = {}): FinanceV2ConnectedViewProps {
  return {
    mode: 'SYNTHETIC_PROPOSAL', view: 'transactions', availability: { status: 'available' }, scope: syntheticOpaqueScope, expectedSnapshotId: syntheticSnapshotId,
    expectedQueryContentHash: syntheticQueryContentHash, expectedSummaryContentHash: syntheticSummaryContentHash, authorization: authorization(), ...(port ? { port } : {}), ...over,
  } as FinanceV2ConnectedViewProps;
}
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
const ready = (request: FinanceV2ReadRequest, index: 0 | 1 | 2, over: Record<string, unknown> = {}): Answer => ({ status: 'ready', page: { ...syntheticPagedPage(index, request), ...over } });
const answer = async (pending: Pending[], at: number, index: 0 | 1 | 2, over: Record<string, unknown> = {}) => { await act(async () => pending[at]!.resolve(ready(pending[at]!.request, index, over))); };
const amountsShown = () => screen.queryAllByText(/\d\.0{18}/u).length > 0;
const table = () => screen.getByRole('table', { name: 'Transaction details' });
const next = () => screen.getByRole('button', { name: 'Next page' });
const previous = () => screen.getByRole('button', { name: 'Previous page' });
const heading = () => screen.getByRole('heading', { level: 2, name: 'Transaction drilldown' });
const refusal = () => screen.getByRole('alert');

async function onPageOne(over: Partial<FinanceV2ConnectedViewProps> = {}) {
  const m = manualPort();
  const view = render(<><button type="button">elsewhere</button><FinanceV2ConnectedView {...connected(m.port, over)} /></>);
  await settle();
  await answer(m.pending, 0, 0);
  return { ...m, view };
}
async function onPageTwo(over: Partial<FinanceV2ConnectedViewProps> = {}) {
  const page = await onPageOne(over);
  fireEvent.click(next());
  await settle();
  await answer(page.pending, 1, 1);
  return page;
}

describe('page transitions', () => {
  it('requests the first page with no cursor, then the opaque nextCursor of the same snapshot, query and summary hashes, with a fresh token each time', async () => {
    const calls: string[] = [];
    const { pending } = await onPageOne({ authorization: { revision: '3', token: async () => { calls.push('token'); return 'opaque-token-3'; } } });
    expect(Object.hasOwn(pending[0]!.request, 'cursor')).toBe(false);
    expect(table()).toHaveTextContent(detailIds.aiCost);
    fireEvent.click(next());
    // Nothing from page 1 stays on screen while page 2 is requested.
    expect(screen.getByRole('status')).toHaveTextContent('Loading the report');
    expect(amountsShown()).toBe(false);
    await settle();
    expect(pending).toHaveLength(2);
    const second = pending[1]!.request;
    expect(second.cursor).toBe(syntheticPagedCursors[0]);
    expect(second.scope).toEqual(syntheticOpaqueScope);
    expect([second.expectedSnapshotId, second.expectedQueryContentHash, second.expectedSummaryContentHash]).toEqual([syntheticSnapshotId, syntheticQueryContentHash, syntheticSummaryContentHash]);
    expect(second.authorization).toEqual({ token: 'opaque-token-3', revision: '3' });
    expect(calls).toHaveLength(2);
    expect(Object.keys(second).sort()).toEqual(['authorization', 'cursor', 'expectedQueryContentHash', 'expectedSnapshotId', 'expectedSummaryContentHash', 'scope', 'signal']);
  });

  it('shows only the rows of the current page with exact negative, unknown and subcent strings, and never a total of its own', async () => {
    const { pending } = await onPageOne();
    expect(table()).toHaveTextContent(detailIds.aiCost);
    expect(table()).not.toHaveTextContent(detailIds.refund);
    expect(screen.getByText('Page 1')).toBeVisible();
    fireEvent.click(next()); await settle(); await answer(pending, 1, 1);
    expect(screen.getByText('Page 2')).toBeVisible();
    expect(table()).toHaveTextContent('-10.000000000000000000 USD');
    expect(table()).toHaveTextContent('Amount unknown');
    expect(table()).not.toHaveTextContent(detailIds.aiCost);
    fireEvent.click(next()); await settle(); await answer(pending, 2, 2);
    expect(screen.getByText('Page 3')).toBeVisible();
    expect(table()).toHaveTextContent('0.000000000000000001 USD');
    expect(table()).toHaveTextContent('-0.000000000000000500 USD');
    // The last page offers no Next, and the producer's cursor is held, not displayed.
    expect(next()).toBeDisabled();
    expect(document.body.textContent).not.toContain(syntheticPagedCursors[0]);
    expect(document.body.textContent).not.toContain(syntheticPagedCursors[1]);
    expect(screen.getByText(/no total is calculated for a page/iu)).toBeVisible();
    expect(screen.getByText('Detail count (producer)').nextElementSibling).toHaveTextContent('6');
  });

  it('goes back by re-reading the earlier page with its own cursor, showing no old amount meanwhile', async () => {
    const { pending } = await onPageTwo();
    expect(previous()).toBeEnabled();
    fireEvent.click(previous());
    expect(screen.getByRole('status')).toHaveTextContent('Loading the report');
    expect(amountsShown()).toBe(false);
    await settle();
    expect(pending).toHaveLength(3);
    expect(Object.hasOwn(pending[2]!.request, 'cursor')).toBe(false);
    await answer(pending, 2, 0);
    expect(screen.getByText('Page 1')).toBeVisible();
    expect(previous()).toBeDisabled();
  });

  it('ignores a second Next click made before the first one rendered', async () => {
    const { pending } = await onPageOne();
    const button = next();
    fireEvent.click(button); fireEvent.click(button);
    await settle();
    expect(pending).toHaveLength(2);
  });

  it('offers no Next without hasMore, and refuses to page past a verified last page', async () => {
    const m = manualPort();
    render(<FinanceV2ConnectedView {...connected(m.port)} />);
    await settle();
    await answer(m.pending, 0, 2);
    expect(next()).toBeDisabled();
    fireEvent.click(next());
    await settle();
    expect(m.pending).toHaveLength(1);
  });
});

describe('keyboard and focus', () => {
  it('moves focus from the removed Next button to the view heading while loading and keeps it there on the new page', async () => {
    const { pending } = await onPageOne();
    next().focus();
    fireEvent.click(next());
    expect(document.activeElement).toBe(heading());
    await settle(); await answer(pending, 1, 1);
    expect(document.activeElement).toBe(heading());
    // Previous behaves the same way, and both are plain buttons reachable and operable from the keyboard.
    previous().focus();
    expect(document.activeElement).toBe(previous());
    fireEvent.click(previous());
    expect(document.activeElement).toBe(heading());
    await settle(); await answer(pending, 2, 0);
    expect(document.activeElement).toBe(heading());
    expect(next().tagName).toBe('BUTTON');
  });

  it('does not take focus the user moved elsewhere while the page was loading', async () => {
    const { pending } = await onPageOne();
    next().focus();
    fireEvent.click(next());
    const elsewhere = screen.getByRole('button', { name: 'elsewhere' });
    elsewhere.focus();
    await settle(); await answer(pending, 1, 1);
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('scope, filter and authorization changes cancel old paging and reset the history', () => {
  it('a filter change on page 2 returns to the first page, with no history', async () => {
    const m = await onPageTwo();
    expect(previous()).toBeEnabled();
    fireEvent.change(screen.getByLabelText('Valuation'), { target: { value: 'estimated' } });
    expect(screen.getByRole('status')).toHaveTextContent('Loading the report');
    expect(amountsShown()).toBe(false);
    await settle();
    expect(m.pending).toHaveLength(3);
    expect(Object.hasOwn(m.pending[2]!.request, 'cursor')).toBe(false);
    await answer(m.pending, 2, 0);
    expect(screen.getByText('Page 1')).toBeVisible();
    expect(previous()).toBeDisabled();
    expect(table()).toHaveTextContent(detailIds.aiCost);
    expect(table()).not.toHaveTextContent(detailIds.sale);
  });

  it('a host filter change while page 2 is still loading aborts that read, restarts at the first page and drops the late answer', async () => {
    const m = manualPort();
    function Host() {
      const [filters, setFilters] = useState({ valuation: 'all', currency: 'all' });
      return <><button type="button" onClick={() => setFilters({ valuation: 'estimated', currency: 'all' })}>host filter</button><FinanceV2ConnectedView {...connected(m.port, { filters, onFiltersChange: setFilters })} /></>;
    }
    render(<Host />);
    await settle(); await answer(m.pending, 0, 0);
    fireEvent.click(next());
    await settle();
    const late = m.pending[1]!;
    expect(late.request.cursor).toBe(syntheticPagedCursors[0]);
    fireEvent.click(screen.getByRole('button', { name: 'host filter' }));
    expect(late.request.signal.aborted).toBe(true);
    await settle();
    expect(Object.hasOwn(m.pending[2]!.request, 'cursor')).toBe(false);
    await act(async () => late.resolve(ready(late.request, 1, { requestId: 'STALE-PAGE-2' })));
    expect(document.body.textContent).not.toContain('STALE-PAGE-2');
    expect(amountsShown()).toBe(false);
    await answer(m.pending, 2, 0);
    expect(screen.getByText('Page 1')).toBeVisible();
    expect(previous()).toBeDisabled();
  });

  it('the filter selects stay the same mounted, focused elements while a filter change is re-read, and show no earlier currency or amount', async () => {
    const m = manualPort();
    function Host() {
      const [filters, setFilters] = useState({ valuation: 'all', currency: 'all' });
      return <FinanceV2ConnectedView {...connected(m.port, { filters, onFiltersChange: setFilters })} />;
    }
    render(<Host />);
    await settle(); await answer(m.pending, 0, 0);
    const valuation = screen.getByLabelText('Valuation') as HTMLSelectElement;
    valuation.focus();
    expect(valuation).toHaveFocus();
    fireEvent.change(valuation, { target: { value: 'estimated' } });
    await settle();
    // Re-read in flight: the very same element is still mounted, focused, and holds the new value; the read is not answered yet.
    expect(screen.getByLabelText('Valuation')).toBe(valuation);
    expect(valuation).toHaveFocus();
    expect(valuation).toHaveValue('estimated');
    expect(screen.getByRole('status')).toHaveTextContent('Loading the report');
    expect(amountsShown()).toBe(false);
    expect(within(screen.getByLabelText('Currency')).getAllByRole('option').map((option) => option.textContent)).toEqual(['All currencies']);
    // A second keyboard-style change while still loading is accepted by the same element.
    fireEvent.change(valuation, { target: { value: 'unknown' } });
    await settle();
    expect(screen.getByLabelText('Valuation')).toBe(valuation);
    expect(valuation).toHaveFocus();
    expect(valuation).toHaveValue('unknown');
    await answer(m.pending, m.pending.length - 1, 0);
    expect(screen.getByLabelText('Valuation')).toBe(valuation);
    expect(valuation).toHaveFocus();
    expect(valuation).toHaveValue('unknown');
  });

  const changes: readonly (readonly [string, Partial<FinanceV2ConnectedViewProps>])[] = [
    ['actor', { scope: { ...syntheticOpaqueScope, actorId: 'account:another-actor' } }],
    ['tenant', { scope: { ...syntheticOpaqueScope, tenantId: 'account:another-tenant' } }],
    ['project', { scope: { ...syntheticOpaqueScope, projectId: 'event:another-project' } }],
    ['environment', { scope: { ...syntheticOpaqueScope, environment: 'live' } }],
    ['billing mode', { scope: { ...syntheticOpaqueScope, billingMode: 'live' } }],
    ['authorization revision', { authorization: authorization('2') }],
    ['expected snapshot', { expectedSnapshotId: `sha256:${'a'.repeat(64)}` }],
    ['expected query hash', { expectedQueryContentHash: `sha256:${'b'.repeat(64)}` }],
    ['expected summary hash', { expectedSummaryContentHash: `sha256:${'c'.repeat(64)}` }],
    ['page size', { pageSize: 25 }],
  ];
  it.each(changes)('a %s change while page 2 is in flight aborts it, restarts at the first page and drops the ignored-abort late answer', async (_name, change) => {
    const m = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(m.port)} />);
    await settle(); await answer(m.pending, 0, 0);
    fireEvent.click(next());
    await settle();
    const late = m.pending[1]!;
    view.rerender(<FinanceV2ConnectedView {...connected(m.port, change)} />);
    expect(late.request.signal.aborted).toBe(true);
    expect(screen.getByRole('status')).toHaveTextContent('Loading the report');
    await settle();
    expect(m.pending).toHaveLength(3);
    // The new identity starts over at the first page: no old cursor travels with it.
    expect(Object.hasOwn(m.pending[2]!.request, 'cursor')).toBe(false);
    await act(async () => late.resolve(ready(late.request, 1, { requestId: 'STALE-PAGE-2' })));
    expect(document.body.textContent).not.toContain('STALE-PAGE-2');
    expect(amountsShown()).toBe(false);
    const fresh = m.pending[2]!.request;
    const over: Record<string, unknown> = {
      ...(change.expectedSnapshotId ? { snapshotId: change.expectedSnapshotId } : {}), ...(change.expectedQueryContentHash ? { queryContentHash: change.expectedQueryContentHash } : {}),
      ...(change.expectedSummaryContentHash ? { summaryContentHash: change.expectedSummaryContentHash } : {}),
    };
    await act(async () => m.pending[2]!.resolve(ready(fresh, 0, over)));
    expect(screen.getByText('Page 1')).toBeVisible();
    expect(previous()).toBeDisabled();
  });

  it('does not bring page 2 back when an identity returns to its earlier value (A -> B -> A)', async () => {
    const m = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(m.port)} />);
    await settle(); await answer(m.pending, 0, 0);
    fireEvent.click(next()); await settle(); await answer(m.pending, 1, 1);
    view.rerender(<FinanceV2ConnectedView {...connected(m.port, { authorization: authorization('2') })} />);
    await settle();
    view.rerender(<FinanceV2ConnectedView {...connected(m.port)} />);
    await settle();
    expect(Object.hasOwn(m.pending[3]!.request, 'cursor')).toBe(false);
    expect(amountsShown()).toBe(false);
  });

  it('withdraws page 2 at once when the host revokes the token with a new revision', async () => {
    const m = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(m.port)} />);
    await settle(); await answer(m.pending, 0, 0);
    fireEvent.click(next()); await settle(); await answer(m.pending, 1, 1);
    expect(amountsShown()).toBe(true);
    view.rerender(<FinanceV2ConnectedView {...connected(m.port, { authorization: authorization('2', null) })} />);
    await settle();
    expect(amountsShown()).toBe(false);
    expect(screen.getByRole('heading', { name: 'Not authorized' })).toBeVisible();
    expect(m.pending).toHaveLength(2);
  });

  it('withdraws page 2 and aborts a page in flight when the host withdraws availability', async () => {
    const m = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(m.port)} />);
    await settle(); await answer(m.pending, 0, 0);
    fireEvent.click(next()); await settle();
    view.rerender(<FinanceV2ConnectedView {...connected(m.port, { availability: { status: 'refused', reason: 'restricted' } })} />);
    expect(m.pending[1]!.request.signal.aborted).toBe(true);
    expect(amountsShown()).toBe(false);
    await act(async () => m.pending[1]!.resolve(ready(m.pending[1]!.request, 1, { requestId: 'STALE-PAGE-2' })));
    expect(document.body.textContent).not.toContain('STALE-PAGE-2');
  });
});

describe('a continuation that does not match is refused without amounts', () => {
  const cases: readonly (readonly [string, Record<string, unknown>, string, string])[] = [
    ['snapshot id', { snapshotId: `sha256:${'1'.padStart(64, '0')}` }, 'SNAPSHOT_MISMATCH', '/snapshotId'],
    ['query content hash', { queryContentHash: `sha256:${'2'.padStart(64, '0')}` }, 'QUERY_HASH_MISMATCH', '/queryContentHash'],
    ['summary content hash', { summaryContentHash: `sha256:${'3'.padStart(64, '0')}` }, 'SUMMARY_HASH_MISMATCH', '/summaryContentHash'],
    ['tenant', { scope: { ...syntheticOpaqueScope, tenantId: 'account:another-tenant' } }, 'SCOPE_MISMATCH', '/scope/tenantId'],
    ['actor', { scope: { ...syntheticOpaqueScope, actorId: 'account:another-actor' } }, 'SCOPE_MISMATCH', '/scope/actorId'],
    ['environment', { scope: { ...syntheticOpaqueScope, environment: 'live' } }, 'SCOPE_MISMATCH', '/scope/environment'],
    ['empty cursor with hasMore', { hasMore: true, nextCursor: '' }, 'INVALID_SHAPE', '/nextCursor'],
    ['missing cursor with hasMore', { hasMore: true, nextCursor: null }, 'INVALID_SHAPE', '/nextCursor'],
    ['cursor past 2048 characters', { hasMore: true, nextCursor: 'c'.repeat(2049) }, 'INVALID_SHAPE', '/nextCursor'],
    ['cursor of the wrong type', { hasMore: true, nextCursor: 7 }, 'INVALID_SHAPE', '/nextCursor'],
    ['cursor without hasMore', { hasMore: false, nextCursor: syntheticPagedCursors[1] }, 'INVALID_SHAPE', '/nextCursor'],
    ['cursor that points back at the request', { hasMore: true, nextCursor: syntheticPagedCursors[0] }, 'PAGE_REPLAY', '/nextCursor'],
  ];
  it.each(cases)('refuses a page 2 with a wrong %s', async (_name, over, code, path) => {
    const { pending } = await onPageOne();
    fireEvent.click(next()); await settle();
    await answer(pending, 1, 1, over);
    expect(within(refusal()).getByText(code)).toBeVisible();
    expect(within(refusal()).getByText(path)).toBeVisible();
    expect(amountsShown()).toBe(false);
    expect(screen.queryByRole('table', { name: 'Transaction details' })).toBeNull();
    expect(document.body.textContent).not.toContain(syntheticPagedCursors[0]);
  });

  it('refuses a page 2 that repeats a detail of page 1, and a page that repeats a detail within itself', async () => {
    const m = await onPageOne();
    const first = syntheticPagedPage(0, m.pending[0]!.request).details;
    fireEvent.click(next()); await settle();
    await answer(m.pending, 1, 1, { details: [syntheticPagedPage(1, m.pending[1]!.request).details[0]!, first[1]!] });
    expect(within(refusal()).getByText('PAGE_REPLAY')).toBeVisible();
    expect(within(refusal()).getByText('/details/1/detailId')).toBeVisible();
    expect(amountsShown()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Return to first page' }));
    await settle(); await answer(m.pending, 2, 0);
    fireEvent.click(next()); await settle();
    const second = syntheticPagedPage(1, m.pending[3]!.request).details;
    await answer(m.pending, 3, 1, { details: [second[0]!, second[0]!] });
    expect(within(refusal()).getByText('/details/1/detailId')).toBeVisible();
  });

  it('refuses a page 3 that repeats a detail of page 1 (replay across non-adjacent pages)', async () => {
    const m = await onPageTwo();
    fireEvent.click(next()); await settle();
    await answer(m.pending, 2, 2, { details: syntheticPagedPage(0, m.pending[2]!.request).details });
    expect(within(refusal()).getByText('PAGE_REPLAY')).toBeVisible();
    expect(amountsShown()).toBe(false);
  });

  it('refuses a page 3 whose nextCursor loops back to page 2, and does not call the port again', async () => {
    const m = await onPageTwo();
    fireEvent.click(next()); await settle();
    await answer(m.pending, 2, 2, { hasMore: true, nextCursor: syntheticPagedCursors[0] });
    expect(within(refusal()).getByText('/nextCursor')).toBeVisible();
    await settle();
    expect(m.pending).toHaveLength(3);
  });

  it('offers a way back to the first page from a refusal, and reads it fresh', async () => {
    const m = await onPageOne();
    fireEvent.click(next()); await settle();
    await answer(m.pending, 1, 1, { snapshotId: `sha256:${'9'.padStart(64, '0')}` });
    screen.getByRole('button', { name: 'Return to first page' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Return to first page' }));
    expect(document.activeElement).toBe(heading());
    await settle();
    expect(Object.hasOwn(m.pending[2]!.request, 'cursor')).toBe(false);
    await answer(m.pending, 2, 0);
    expect(screen.getByText('Page 1')).toBeVisible();
  });

  it('shows no first-page amount on the refused page-2 view', async () => {
    const m = await onPageOne();
    expect(table()).toHaveTextContent(detailIds.aiCost);
    fireEvent.click(next()); await settle();
    await answer(m.pending, 1, 1, { queryContentHash: `sha256:${'5'.padStart(64, '0')}` });
    expect(document.body.textContent).not.toContain(detailIds.aiCost);
    expect(amountsShown()).toBe(false);
  });
});

describe('typed states of a continuation: no amount, no fallback to an earlier page', () => {
  it.each([[401, 'Not authorized'], [403, 'Report restricted'], [404, 'No report delivered']] as const)('page 2 answering %s shows no amount and offers the first page', async (status, title) => {
    const m = await onPageOne();
    fireEvent.click(next()); await settle();
    await act(async () => m.pending[1]!.reject({ status }));
    expect(screen.getByRole('heading', { name: title })).toBeVisible();
    expect(amountsShown()).toBe(false);
    expect(screen.queryByRole('table', { name: 'Transaction details' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Return to first page' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('page 2 answering a typed restricted or unknown state shows no amount', async () => {
    const m = await onPageOne();
    fireEvent.click(next()); await settle();
    await act(async () => m.pending[1]!.resolve({ status: 'restricted' }));
    expect(amountsShown()).toBe(false);
    expect(screen.getByRole('heading', { name: 'Report restricted' })).toBeVisible();
  });

  it('retries a failed continuation with the same cursor and a fresh token, and shows the new answer only', async () => {
    const calls: string[] = [];
    const m = await onPageOne({ authorization: { revision: '1', token: async () => { calls.push('t'); return `opaque-token-${calls.length}`; } } });
    fireEvent.click(next()); await settle();
    await act(async () => m.pending[1]!.reject({ status: 503 }));
    expect(amountsShown()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await settle();
    expect(m.pending).toHaveLength(3);
    expect(m.pending[2]!.request.cursor).toBe(syntheticPagedCursors[0]);
    expect(m.pending[2]!.request.authorization.token).toBe('opaque-token-3');
    await answer(m.pending, 2, 1);
    expect(screen.getByText('Page 2')).toBeVisible();
  });

  it('times out a continuation that never answers, aborts it, and drops its late answer', async () => {
    vi.useFakeTimers();
    try {
      const m = manualPort();
      render(<FinanceV2ConnectedView {...connected(m.port, { timeoutMs: 50 })} />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      await act(async () => m.pending[0]!.resolve(ready(m.pending[0]!.request, 0)));
      fireEvent.click(next());
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      const late = m.pending[1]!;
      await act(async () => { await vi.advanceTimersByTimeAsync(60); });
      expect(late.request.signal.aborted).toBe(true);
      expect(screen.getByRole('heading', { name: 'Report could not be loaded' })).toBeVisible();
      await act(async () => late.resolve(ready(late.request, 1, { requestId: 'STALE-PAGE-2' })));
      expect(document.body.textContent).not.toContain('STALE-PAGE-2');
      expect(amountsShown()).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it('passes through the synthetic port end to end across three pages and back', async () => {
    const log = { requests: [] as Array<{ cursor: string | null }> };
    render(<FinanceV2ConnectedView {...connected(syntheticPagedPort({}, log as never))} />);
    expect(await screen.findByText('Page 1')).toBeVisible();
    fireEvent.click(next());
    expect(await screen.findByText('Page 2')).toBeVisible();
    fireEvent.click(next());
    expect(await screen.findByText('Page 3')).toBeVisible();
    fireEvent.click(previous());
    expect(await screen.findByText('Page 2')).toBeVisible();
    expect(log.requests.map((entry) => entry.cursor)).toEqual([null, syntheticPagedCursors[0], syntheticPagedCursors[1], syntheticPagedCursors[0]]);
  });
});

describe('deep link, reload and host-kept cursor', () => {
  it('requests a host-supplied cursor once, as a request parameter only, and still binds the answer to the host identity', async () => {
    const m = manualPort();
    render(<FinanceV2ConnectedView {...connected(m.port, { initialCursor: syntheticPagedCursors[0] })} />);
    await settle();
    expect(m.pending[0]!.request.cursor).toBe(syntheticPagedCursors[0]);
    await answer(m.pending, 0, 1, { snapshotId: `sha256:${'7'.padStart(64, '0')}` });
    expect(within(refusal()).getByText('SNAPSHOT_MISMATCH')).toBeVisible();
    expect(amountsShown()).toBe(false);
  });

  it('labels a deep-linked page without inventing its position, and Previous returns to the first page', async () => {
    const m = manualPort();
    render(<FinanceV2ConnectedView {...connected(m.port, { initialCursor: syntheticPagedCursors[0] })} />);
    await settle(); await answer(m.pending, 0, 1);
    expect(screen.getByText(/Linked page \(position from the first page unknown\)/u)).toBeVisible();
    expect(screen.queryByText('Page 2')).toBeNull();
    fireEvent.click(previous());
    await settle();
    expect(Object.hasOwn(m.pending[1]!.request, 'cursor')).toBe(false);
    await answer(m.pending, 1, 0);
    expect(screen.getByText('Page 1')).toBeVisible();
    expect(previous()).toBeDisabled();
  });

  it('applies a deep-link cursor to the first identity only; a new scope starts at the first page', async () => {
    const m = manualPort();
    const view = render(<FinanceV2ConnectedView {...connected(m.port, { initialCursor: syntheticPagedCursors[0] })} />);
    await settle();
    view.rerender(<FinanceV2ConnectedView {...connected(m.port, { initialCursor: syntheticPagedCursors[0], scope: { ...syntheticOpaqueScope, actorId: 'account:another-actor' } })} />);
    await settle();
    expect(m.pending[1]!.request.cursor).toBeUndefined();
  });

  it('tells the host which cursor is now requested, so it can keep it in its own context', async () => {
    const seen: Array<string | null> = [];
    const m = manualPort();
    render(<FinanceV2ConnectedView {...connected(m.port, { onCursorChange: (cursor) => seen.push(cursor) })} />);
    await settle(); await answer(m.pending, 0, 0);
    expect(seen).toEqual([]);
    fireEvent.click(next()); await settle(); await answer(m.pending, 1, 1);
    fireEvent.click(previous()); await settle();
    expect(seen).toEqual([syntheticPagedCursors[0], null]);
  });

  it.each([['empty', ''], ['over 2048 characters', 'c'.repeat(2049)]] as const)('refuses a %s deep-link cursor before any read, without amounts', async (_name, cursor) => {
    const m = manualPort();
    render(<FinanceV2ConnectedView {...connected(m.port, { initialCursor: cursor })} />);
    await settle();
    expect(m.pending).toHaveLength(0);
    expect(within(refusal()).getByText('INVALID_SHAPE')).toBeVisible();
    expect(within(refusal()).getByText('/cursor')).toBeVisible();
    expect(amountsShown()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Return to first page' }));
    await settle();
    expect(m.pending).toHaveLength(1);
    expect(Object.hasOwn(m.pending[0]!.request, 'cursor')).toBe(false);
  });

  it('passes a valid page size through, and refuses an invalid one before any read', async () => {
    const good = manualPort();
    render(<FinanceV2ConnectedView {...connected(good.port, { pageSize: 25 })} />);
    await settle();
    expect(good.pending[0]!.request.pageSize).toBe(25);
    document.body.innerHTML = '';
    for (const pageSize of [0, 501, 1.5, Number.NaN]) {
      const bad = manualPort();
      const view = render(<FinanceV2ConnectedView {...connected(bad.port, { pageSize })} />);
      await settle();
      expect(bad.pending).toHaveLength(0);
      expect(within(refusal()).getByText('/pageSize')).toBeVisible();
      view.unmount();
    }
  });

  it('INTEGRATED mode never reaches a port, with or without a cursor', async () => {
    const m = manualPort();
    render(<FinanceV2ConnectedView {...({ ...connected(m.port, { initialCursor: syntheticPagedCursors[0] }), mode: 'INTEGRATED' } as FinanceV2ConnectedViewProps)} />);
    await settle();
    expect(m.pending).toHaveLength(0);
    expect(screen.getByRole('status')).toHaveTextContent('no accepted read port exists');
    expect(screen.queryByRole('button', { name: 'Next page' })).toBeNull();
  });

  it('keeps the page-1 header intact: a token is never rendered', async () => {
    token.mockClear();
    await onPageTwo();
    expect(document.body.textContent).not.toContain('opaque-token-1');
  });
});
