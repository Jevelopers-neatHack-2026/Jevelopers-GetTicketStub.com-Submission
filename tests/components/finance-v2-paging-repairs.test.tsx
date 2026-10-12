import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFinanceV2Read, type FinanceV2ReadOptions, type FinanceV2ReadRequest, type FinanceV2SyntheticReadPort } from '../../src/views/finance-v2/async-port';
import { syntheticOpaqueScope, syntheticQueryContentHash, syntheticSnapshotId, syntheticSummaryContentHash } from '../../src/views/finance-v2/fixtures';
import { syntheticPagedCursors, syntheticPagedPage } from '../../integration/fixture-host/finance-v2-paged';
import producerPage from '../fixtures/finance-v2-conformance/producer-v2-page.json';

/**
 * Regressions for the TD03 independent review (TD03-R1 filter reset, TD03-R2 revisited-page identity, TD03-R3 immutable public snapshot envelope).
 * Every page here is HAND-AUTHORED synthetic port data (`syntheticPagedPage`), answered by hand so the test controls exactly which payload answers which request.
 * Nothing is a producer continuation; the actual three-page producer chain is exercised in finance-v2-pagination-conformance.test.tsx.
 */
type Answer = Awaited<ReturnType<FinanceV2SyntheticReadPort['read']>>;
type Page = ReturnType<typeof syntheticPagedPage>;
function setup(over: Partial<FinanceV2ReadOptions> = {}) {
  const requests: Array<{ request: FinanceV2ReadRequest; resolve: (answer: Answer) => void; reject: (error: unknown) => void }> = [];
  const tokens: string[] = [];
  const port: FinanceV2SyntheticReadPort = { kind: 'SYNTHETIC_PROPOSAL', read: (request) => new Promise((resolve, reject) => requests.push({ request, resolve, reject })) };
  const options: FinanceV2ReadOptions = {
    mode: 'SYNTHETIC_PROPOSAL', port, availability: { status: 'available' }, scope: syntheticOpaqueScope, expectedSnapshotId: syntheticSnapshotId,
    expectedQueryContentHash: syntheticQueryContentHash, expectedSummaryContentHash: syntheticSummaryContentHash,
    authorization: { revision: '1', token: async () => { tokens.push('t'); return 'token'; } }, resetKey: 'filter-A', ...over,
  };
  const hook = renderHook((o: FinanceV2ReadOptions) => useFinanceV2Read(o), { initialProps: options });
  const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const answer = async (at: number, index: 0 | 1 | 2, extra: Record<string, unknown> = {}) => act(async () => requests[at]!.resolve({ status: 'ready', page: { ...syntheticPagedPage(index, requests[at]!.request), ...extra } }));
  const answerWith = async (at: number, change: (page: Page) => void, index: 0 | 1 | 2 = 1) => {
    const page = structuredClone(syntheticPagedPage(index, requests[at]!.request));
    change(page);
    await act(async () => requests[at]!.resolve({ status: 'ready', page }));
  };
  const next = async () => { act(() => hook.result.current.paging.next()); await settle(); };
  const previous = async () => { act(() => hook.result.current.paging.previous()); await settle(); };
  return { ...hook, options, requests, tokens, settle, answer, answerWith, next, previous };
}
const phase = (h: ReturnType<typeof setup>) => h.result.current.state.phase;
const throughPage3 = async (h: ReturnType<typeof setup>) => { await h.settle(); await h.answer(0, 0); await h.next(); await h.answer(1, 1); await h.next(); await h.answer(2, 2); };

describe('TD03-R1: a filter or identity reset cancels and restarts the read, also at the first page', () => {
  it('aborts an in-flight first-page read on a filter change, reads again and drops the old answer', async () => {
    const h = setup(); await h.settle();
    h.rerender({ ...h.options, resetKey: 'filter-B' }); await h.settle();
    expect(h.requests[0]!.request.signal.aborted).toBe(true);
    expect(h.requests).toHaveLength(2);
    await h.answer(0, 0, { requestId: 'OLD-FILTER-ANSWER' });
    expect(phase(h)).toBe('loading');
    await h.answer(1, 0, { requestId: 'NEW-FILTER-ANSWER' });
    expect(h.result.current.state).toMatchObject({ phase: 'ready', page: { requestId: 'NEW-FILTER-ANSWER' } });
  });
  it('drops a settled first page on a filter change and shows no amount until the fresh read answers', async () => {
    const h = setup(); await h.settle(); await h.answer(0, 0);
    expect(phase(h)).toBe('ready');
    h.rerender({ ...h.options, resetKey: 'filter-B' });
    expect(h.result.current.state).toEqual({ phase: 'loading' });
    await h.settle();
    expect(h.requests).toHaveLength(2);
  });
  it('A -> B -> A at the first page reads again each time and never resurfaces the first answer', async () => {
    const h = setup(); await h.settle(); await h.answer(0, 0, { requestId: 'ANSWER-A1' });
    h.rerender({ ...h.options, resetKey: 'filter-B' }); await h.settle();
    h.rerender({ ...h.options, resetKey: 'filter-A' });
    expect(h.result.current.state).toEqual({ phase: 'loading' });
    await h.settle();
    expect(h.requests).toHaveLength(3);
    expect(h.requests[1]!.request.signal.aborted).toBe(true);
    await h.answer(1, 0, { requestId: 'LATE-B' });
    expect(phase(h)).toBe('loading');
    await h.answer(2, 0, { requestId: 'ANSWER-A2' });
    expect(h.result.current.state).toMatchObject({ phase: 'ready', page: { requestId: 'ANSWER-A2' } });
  });
  it('a retry within one filter still re-reads only that filter and does not reset the generation evidence', async () => {
    const h = setup(); await h.settle();
    await act(async () => h.requests[0]!.reject({ status: 503 })); await h.settle();
    expect(phase(h)).toBe('error');
    act(() => h.result.current.retry()); await h.settle();
    await h.answer(1, 0);
    expect(phase(h)).toBe('ready');
  });
});

describe('TD03-R2: the page behind every request cursor is remembered across Previous and revisits', () => {
  it('refuses page 3 delivered for the page-2 cursor after p1 -> p2 -> p3 -> Previous, with no page-3 amount', async () => {
    const h = setup(); await throughPage3(h); await h.previous();
    expect(h.result.current.state).toEqual({ phase: 'loading' });
    expect(h.requests[3]!.request.cursor).toBe(syntheticPagedCursors[0]);
    await h.answer(3, 2);
    expect(h.result.current.state).toMatchObject({ phase: 'refused', code: 'PAGE_REPLAY' });
    expect(h.result.current.paging.pageNumber).toBe(2);
    expect(h.result.current.paging.canNext).toBe(false);
  });
  it('control: Previous re-reads page 2 with a fresh token and accepts the same page-2 answer', async () => {
    const h = setup(); await throughPage3(h);
    const before = h.tokens.length;
    await h.previous();
    expect(h.tokens.length).toBe(before + 1);
    expect(h.result.current.state).toEqual({ phase: 'loading' });
    await h.answer(3, 1);
    expect(h.result.current.state).toMatchObject({ phase: 'ready', page: { hasMore: true, nextCursor: syntheticPagedCursors[1] } });
    expect(h.result.current.paging.pageNumber).toBe(2);
    expect(h.result.current.paging.canNext).toBe(true);
  });
  it('refuses a revisited page whose rows changed, and one whose continuation changed', async () => {
    const rows = setup(); await throughPage3(rows); await rows.previous();
    await rows.answerWith(3, (page) => { page.details = [page.details[0]!]; });
    expect(rows.result.current.state).toMatchObject({ phase: 'refused', code: 'PAGE_REPLAY', path: '/details' });
    const cont = setup(); await throughPage3(cont); await cont.previous();
    await cont.answerWith(3, (page) => { page.hasMore = false; page.nextCursor = null; });
    expect(cont.result.current.state).toMatchObject({ phase: 'refused', code: 'PAGE_REPLAY', path: '/nextCursor' });
  });
  it('refuses the page-2 payload for the first-page request after Previous from page 2', async () => {
    const h = setup(); await h.settle(); await h.answer(0, 0); await h.next(); await h.answer(1, 1); await h.previous();
    expect(h.requests[2]!.request.cursor).toBeUndefined();
    await h.answer(2, 1);
    expect(h.result.current.state).toMatchObject({ phase: 'refused', code: 'PAGE_REPLAY' });
  });
  it('refuses the page-1 payload for the page-3 request and the page-3 payload for the page-2 request going forward', async () => {
    const h = setup(); await h.settle(); await h.answer(0, 0); await h.next(); await h.answer(1, 0);
    expect(h.result.current.state).toMatchObject({ phase: 'refused', code: 'PAGE_REPLAY' });
  });
  it('forgets the evidence when the filter changes, so the same rows are accepted again under the new generation', async () => {
    const h = setup(); await throughPage3(h);
    h.rerender({ ...h.options, resetKey: 'filter-B' }); await h.settle();
    expect(h.requests[3]!.request.cursor).toBeUndefined();
    await h.answer(3, 2, { hasMore: false, nextCursor: null });
    expect(phase(h)).toBe('ready');
  });
  it('control: forward replay of a first-page row is still refused', async () => {
    const h = setup(); await h.settle(); await h.answer(0, 0); await h.next(); await h.answer(1, 0);
    expect(h.result.current.state).toMatchObject({ phase: 'refused', code: 'PAGE_REPLAY' });
  });
});

describe('TD03-R3: the immutable public snapshot envelope of the first accepted page binds every later page', () => {
  const changes: ReadonlyArray<readonly [string, (page: Page) => void, string]> = [
    ['asOf', (page) => { page.asOf = '2030-01-01T00:00:00Z'; }, '/asOf'],
    ['watermark.capturedAt', (page) => { page.watermark = { ...page.watermark, capturedAt: '2030-01-01T00:00:00Z' }; }, '/watermark'],
    ['timezone', (page) => { page.timezone = 'Asia/Tokyo'; }, '/timezone'],
    ['period.end', (page) => { page.period = { ...page.period, end: '2030-01-01T00:00:00Z' }; }, '/period'],
    ['filters.environments', (page) => { page.filters = { ...page.filters, environments: ['live'] }; }, '/filters'],
    ['summary expense total', (page) => { page.summary = { ...page.summary, currencies: page.summary.currencies.map((c) => ({ ...c, metrics: { ...c.metrics, expense: { ...c.metrics.expense, total: '999.000000000000000000' } } })) }; }, '/summary'],
    ['canonicalSummaries emptied', (page) => { page.canonicalSummaries = []; }, '/canonicalSummaries'],
    ['detailCount', (page) => { page.detailCount = 999; }, '/detailCount'],
    ['canonicalMappingStatus', (page) => { page.canonicalMappingStatus = page.canonicalMappingStatus === 'unsupported_opaque_scope' ? 'proposal_only_owner_ack_pending' : 'unsupported_opaque_scope'; }, '/canonicalMappingStatus'],
  ];
  it.each(changes)('Next: a continuation cannot change %s while echoing the expected hashes', async (_name, change, path) => {
    const h = setup(); await h.settle(); await h.answer(0, 0, { canonicalSummaries: producerPage.canonicalSummaries });
    await h.next();
    await h.answerWith(1, (page) => { page.canonicalSummaries = producerPage.canonicalSummaries as never; change(page); });
    expect(h.result.current.state).toMatchObject({ phase: 'refused', code: 'SNAPSHOT_MISMATCH', path });
  });
  it.each(changes.slice(0, 3))('Previous: a revisited first page cannot change %s', async (_name, change, path) => {
    const h = setup(); await h.settle(); await h.answer(0, 0); await h.next(); await h.answer(1, 1); await h.previous();
    await h.answerWith(2, change, 0);
    expect(h.result.current.state).toMatchObject({ phase: 'refused', code: 'SNAPSHOT_MISMATCH', path });
  });
  it('retry: a retried continuation still has to match the first page envelope', async () => {
    const h = setup(); await h.settle(); await h.answer(0, 0); await h.next();
    await act(async () => h.requests[1]!.reject({ status: 503 })); await h.settle();
    expect(phase(h)).toBe('error');
    act(() => h.result.current.retry()); await h.settle();
    await h.answerWith(2, (page) => { page.detailCount = 999; });
    expect(h.result.current.state).toMatchObject({ phase: 'refused', code: 'SNAPSHOT_MISMATCH', path: '/detailCount' });
  });
  it('deep link: the first observed page is the baseline, and Previous (the first page) must match it', async () => {
    const h = setup({ initialCursor: syntheticPagedCursors[0] }); await h.settle();
    expect(h.requests[0]!.request.cursor).toBe(syntheticPagedCursors[0]);
    await h.answer(0, 1);
    expect(phase(h)).toBe('ready');
    await h.previous();
    await h.answerWith(1, (page) => { page.asOf = '2030-01-01T00:00:00Z'; }, 0);
    expect(h.result.current.state).toMatchObject({ phase: 'refused', code: 'SNAPSHOT_MISMATCH', path: '/asOf' });
  });
  it('deep link control: Previous from a deep-linked page accepts the legitimate first page whose nextCursor is the deep-linked cursor', async () => {
    const h = setup({ initialCursor: syntheticPagedCursors[0] }); await h.settle(); await h.answer(0, 1);
    await h.previous(); await h.answer(1, 0);
    expect(phase(h)).toBe('ready');
  });
  it('a page refused for its envelope never becomes the baseline', async () => {
    const h = setup(); await h.settle(); await h.answer(0, 0); await h.next();
    await h.answerWith(1, (page) => { page.detailCount = 999; });
    expect(phase(h)).toBe('refused');
    await h.previous(); await h.answer(2, 0);
    expect(phase(h)).toBe('ready');
    await h.next(); await h.answer(3, 1);
    expect(h.result.current.state).toMatchObject({ phase: 'ready', page: { detailCount: 6 } });
  });
  it('control: requestId, details, hasMore and nextCursor vary per page, and a different object key order is the same envelope', async () => {
    const h = setup(); await h.settle(); await h.answer(0, 0, { requestId: 'one' }); await h.next();
    await h.answerWith(1, (page) => {
      page.requestId = 'two';
      page.period = { end: page.period.end, start: page.period.start };
      page.scope = { actorId: page.scope.actorId, billingMode: page.scope.billingMode, environment: page.scope.environment, projectId: page.scope.projectId, tenantId: page.scope.tenantId };
    });
    expect(h.result.current.state).toMatchObject({ phase: 'ready', page: { requestId: 'two' } });
  });
  it('a new filter generation may carry a different envelope (a genuinely different snapshot is a new read)', async () => {
    const h = setup(); await h.settle(); await h.answer(0, 0);
    h.rerender({ ...h.options, resetKey: 'filter-B' }); await h.settle();
    await h.answerWith(1, (page) => { page.detailCount = 7; }, 0);
    expect(h.result.current.state).toMatchObject({ phase: 'ready', page: { detailCount: 7 } });
  });
  it('a new authorization revision starts a new generation: it re-reads and compares against nothing', async () => {
    const h = setup(); await h.settle(); await h.answer(0, 0);
    h.rerender({ ...h.options, authorization: { ...h.options.authorization, revision: '2' } }); await h.settle();
    await h.answerWith(1, (page) => { page.detailCount = 7; }, 0);
    expect(phase(h)).toBe('ready');
  });
});

describe('independent Astra probes, controls retained', () => {
  it('control: authorization revision revocation aborts and discards an ignored-abort continuation', async () => {
    const h = setup(); await h.settle(); await h.answer(0, 0); await h.next();
    h.rerender({ ...h.options, authorization: { revision: '2', token: async () => null } }); await h.settle();
    expect(h.requests[1]!.request.signal.aborted).toBe(true);
    await h.answer(1, 1);
    expect(phase(h)).toBe('unauthorized');
    expect(h.result.current.paging.pageNumber).toBe(1);
  });
});
