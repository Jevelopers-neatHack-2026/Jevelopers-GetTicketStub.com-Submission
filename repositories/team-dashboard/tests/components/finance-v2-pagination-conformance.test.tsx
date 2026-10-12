import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FinanceV2ConnectedView, checkFinanceV2Page, type FinanceV2ConnectedViewProps, type FinanceV2SyntheticReadPort, type OpaqueProductScope } from '../../src/views/finance-v2';
import { sameDeliveredValue } from '../../src/views/finance-v2/check';
import { hostFixture } from '../../integration/fixture-host/conformance';
import { capturedForeignProjectId, capturedPaginationPort, financeV2InputFromApiResult, type CapturedApiResult, type CapturedGrant, type CapturedPortLog, type CapturedTamper } from '../../integration/fixture-host/finance-v2-captured';

/**
 * SYNTHETIC_CONFORMANCE_ONLY over the ACTUAL captured Finance-producer pagination chain (3 pages, 6 ordered unique details, 9 typed refusals), committed byte for byte. No cursor, page or hash
 * below is fabricated: continuations are the recorded responses to the recorded queries, served by a fixture port that only looks them up. Nothing here is live Finance, a grant, real billing
 * evidence, a consumer ACK or export adoption. Every host expectation is a literal stated in this file, never read from the page under test.
 */
const DIR = 'tests/fixtures/finance-v2-pagination-conformance/';
const bytes = (name: string, dir = DIR): Buffer => readFileSync(dir + name);
const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const json = <T = any>(name: string): T => JSON.parse(bytes(name).toString('utf8')) as T; // eslint-disable-line @typescript-eslint/no-explicit-any

const PINS = {
  'producer-v2-pagination-page.json': '0b69c52a47e13cb181c0abcf388a15753ed9673dc74b583da0a0d305330e4423',
  'producer-v2-refusals-page.json': 'eefdaa7f7f55ce9f5340d63e0fe527a63dd12126f9ccf030b950af6fbfe74953',
} as const;
/** The nine earlier committed Finance v2 conformance files (source22) stay exactly as they were. */
const EARLIER_PINS = {
  'producer-v2-page.json': 'c272b9b8d25f3d73bed228554f95b448d3951bc2bb9b8defcabc4d633249ac3d',
  'producer-budget-v2-page.json': '5887fede39b86791972fcb57f35f549ec5869a2108a4f18a3a07bb7e61abfe85',
  'producer-unknown-simulated-v2-page.json': 'a2fc429439d1a7488ed037ce499acb1d97aaf614997fd1d17afb1bebdfcf4755',
  'producer-v1-page.json': '0b9b7210c515d05af66eea0f48c9fd1b79b737bb60230dcf67b23b4588447be3',
  'ie-ci06-pg-page.json': '4462b866d69c9da2d5f92086f89c6cec8cb898d4af08d9e2ac8e94c9cbb21e03',
  'definition-registry.json': '577ce8801855db08ba393f115c00ac670df3a47a5cc9e9a5a78f8b0132cb34e1',
  'schemas/FinancialSummaryPageSchema.json': '862900ad30b1e5684c98852cb93f0010eb73504d2fd9f58018673c9334ddf814',
  'source/schema-v2.ts': '0400a033d1bf13cf047cda507639126b362e99c1bb26348ad3b233758aa38fdb',
  'source/query-export-handoff.json': 'eca74fe6fd34b9631fcb3022f3417425ef94580043a67fce4832b52fa6993da9',
} as const;

const SCOPE: OpaqueProductScope = { tenantId: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222', environment: 'test', billingMode: 'live', actorId: 'synthetic-reporting-service' };
const SNAPSHOT = 'sha256:4cb761b1942d9eef9a1f79230e97da0dee11f608b4d903a0074b401f7c63915c';
const QUERY = 'sha256:7288e98f5ac9273db9d8f0aa50e42b4531935e4900e92f11a40ad76a358dda12';
const SUMMARY = 'sha256:e0465f3ee6f6715fd4e2ac107571bc19dc58eb718eddbda08be936d6c4a7685a';
const ORDERED_IDS = [
  'sha256:036c70e5b7464bdc11f763b6acfda55262b97ef55966b979f9553b1232ea6290', 'sha256:166c1909740fbe3ec116795ea02213620f7c46e75cac702991ad752e85687f9a',
  'sha256:71635407ad49a4ee0103de85adf4530629d9299e3307cc5b34d8ffd599042b86', 'sha256:77589252a56b6a19aa2bd1a5e32e79afb8135a1188b6b2f01423301a5828e7d5',
  'sha256:94c412dadc4f90ce5842c3393aa4fc715a5b301668c44e913fc4561cb96172c7', 'sha256:bae0bfc297830c7fb2278042a8a1ea0ba2fc38bd5581bdf7b56090423b7c4f7a',
] as const;
const REFUSAL_NAMES = ['unsigned_cursor_forgery', 'cursor_page_size_mismatch', 'snapshot_period_mismatch', 'snapshot_filter_mismatch', 'foreign_scope', 'cross_version_snapshot', 'current_grant_denied', 'stale_current_grant', 'revoked_after_commit'] as const;

const capture = json('producer-v2-pagination-page.json');
const refusals = json('producer-v2-refusals-page.json');
const responses: any[] = capture.pages.map((entry: any) => entry.response); // eslint-disable-line @typescript-eslint/no-explicit-any
const observationOf = (name: string) => refusals.observations.find((entry: any) => entry.name === name); // eslint-disable-line @typescript-eslint/no-explicit-any

describe('committed artifacts and pins (portable: no /tmp, no skips)', () => {
  it.each(Object.entries(PINS))('%s hashes to its pinned digest', (file, digest) => { expect(sha256(bytes(file))).toBe(digest); });
  it('keeps the nine earlier conformance files unchanged', () => {
    for (const [file, digest] of Object.entries(EARLIER_PINS)) expect(sha256(bytes(file, 'tests/fixtures/finance-v2-conformance/')), file).toBe(digest);
  });
  it('keeps PROVENANCE.json in step with the literal pins, with no host-absolute path', () => {
    const provenance = json('PROVENANCE.json');
    expect(provenance.classification).toBe('SYNTHETIC_CONFORMANCE_ONLY');
    expect(Object.fromEntries(provenance.committed.map((item: { path: string; sha256: string }) => [item.path, item.sha256]))).toEqual(PINS);
    expect(provenance.producer).toMatchObject({ head: '924cdd2b5489681434790b5d1d7aac138198ccfd', tree: '88c0bcaeaaee050678ca59261229c5f9ad1bfd13', actualMerge: '06dafe24183c0243b30e5b851b3a6ff218bd88d1', actualMergeTree: '88c0bcaeaaee050678ca59261229c5f9ad1bfd13', candidateRun: 38248332764, mainRun: 38249053428 });
    expect(provenance.handoff).toMatchObject({ status: 'FINANCE_OWNER_ACCEPTED_SYNTHETIC_CONFORMANCE_ONLY', packetSha256: 'a193d27f4bbfea7211a809be2f312606312daef531913b4163ea465a6798fded', independentReviewSha256: '59977ebcb04a7c2d2a97830d05c7930098b57ceeb3391c85199218aad1b87387' });
    expect(provenance.handoff.ownerReceipt).toMatch(/cost-intelligence\/issues\/2#issuecomment-6124267724$/u);
    expect(provenance.handoff.consumerTargets.ack).toMatch(/no consumer ACK is claimed/u);
    expect(JSON.stringify(provenance)).not.toMatch(/\/tmp\/|\/private\/|\/Users\/|\/root\//u);
  });
  it('detects a one-byte change in either committed capture', () => {
    for (const file of Object.keys(PINS)) {
      const tampered = Buffer.from(bytes(file)); tampered[Math.floor(tampered.length / 2)] = tampered[Math.floor(tampered.length / 2)]! ^ 1;
      expect(sha256(tampered), file).not.toBe(PINS[file as keyof typeof PINS]);
    }
  });
  it('states the capture limits honestly: synthetic only, no real billing proof, not a consumer ACK', () => {
    expect(capture.status).toBe('TESTED_SYNTHETIC_PAGINATION_CAPTURE_NOT_CONSUMER_ACK');
    expect(capture.billingEvidence).toMatch(/not actual provider billing proof/u);
    expect(refusals.status).toBe('TESTED_SYNTHETIC_REFUSAL_CAPTURE_NOT_CURRENT_HOST_GRANT');
  });
});

describe('the actual captured chain', () => {
  it('is three pages of two details: six exactly ordered unique ids, count 6, terminal on the last', () => {
    expect(capture.pages).toHaveLength(3);
    const ids = responses.flatMap((page) => page.details.map((detail: { detailId: string }) => detail.detailId));
    expect(ids).toEqual(ORDERED_IDS);
    expect(capture.orderedDetailIds).toEqual(ORDERED_IDS);
    expect(new Set(ids).size).toBe(6);
    expect(responses.map((page) => [page.details.length, page.detailCount, page.hasMore, page.nextCursor === null])).toEqual([[2, 6, true, false], [2, 6, true, false], [2, 6, false, true]]);
    expect(capture.terminal).toBe(true);
  });
  it('chains each continuation request to the prior nextCursor and to the same snapshot, query and page size', () => {
    const [first, second, third] = capture.pages.map((entry: any) => entry.request); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(first).not.toHaveProperty('cursor'); expect(first).not.toHaveProperty('snapshotId');
    expect(second.cursor).toBe(responses[0].nextCursor); expect(third.cursor).toBe(responses[1].nextCursor);
    for (const request of [second, third]) expect(request.snapshotId).toBe(SNAPSHOT);
    for (const request of [first, second, third]) expect(request).toMatchObject({ schemaVersion: '2.0.0', pageSize: 2, scope: SCOPE });
    const strip = ({ cursor, snapshotId, ...rest }: Record<string, unknown>) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(sameDeliveredValue(strip(second), strip(first))).toBe(true); expect(sameDeliveredValue(strip(third), strip(first))).toBe(true);
  });
  it('keeps the public snapshot envelope (summary, unknowns, subcent, currencies, watermark, references) identical on all three pages, whatever the key order', () => {
    const envelope = ({ requestId, details, hasMore, nextCursor, ...rest }: Record<string, unknown>) => rest; // eslint-disable-line @typescript-eslint/no-unused-vars
    expect(sameDeliveredValue(envelope(responses[0]), envelope(responses[1]))).toBe(true);
    expect(sameDeliveredValue(envelope(responses[1]), envelope(responses[2]))).toBe(true);
    for (const page of responses) {
      expect(page.summary.currencies.map((entry: { currency: string }) => entry.currency)).toEqual(['EUR', 'USD']);
      expect(page.summary.currencies[1].metrics.expense).toEqual({ status: 'partial', knownSubtotal: '1.000000000000000001', total: null, unknownCount: 0 });
      expect(page.summary.currencies[0].metrics.expense).toEqual({ status: 'partial', knownSubtotal: '2', total: null, unknownCount: 0 });
      expect(page.summary.currencies[1].simulated.expense).toEqual({ status: 'unknown', knownSubtotal: null, total: null, unknownCount: 0 });
      expect(page.canonicalSummaries).toHaveLength(2);
    }
    expect(responses[1].details[1].amount).toBe('0.000000000000000001');
  });
  it('is accepted page by page by the presentation guard against host literals and the independently pinned registry', () => {
    const host = hostFixture('conformance-pagination');
    expect({ scope: host.expectedScope, snapshot: host.expectedSnapshotId, query: host.expectedQueryContentHash, summary: host.expectedSummaryContentHash }).toEqual({ scope: SCOPE, snapshot: SNAPSHOT, query: QUERY, summary: SUMMARY });
    expect(host.input).toEqual({ status: 'ready', page: responses[0] });
    expect(sha256(bytes('definition-registry.json', 'tests/fixtures/finance-v2-conformance/'))).toBe(EARLIER_PINS['definition-registry.json']);
    expect(host.expectedReferences).toBeDefined();
    for (const page of responses) expect(checkFinanceV2Page(page, SCOPE, SNAPSHOT, { queryContentHash: QUERY, summaryContentHash: SUMMARY, references: host.expectedReferences! })).toMatchObject({ ok: true });
    const forged = structuredClone(responses[1]); forged.canonicalSummaries[0].policy_ref.content_hash = `sha256:${'f'.repeat(64)}`;
    expect(checkFinanceV2Page(forged, SCOPE, SNAPSHOT, { queryContentHash: QUERY, summaryContentHash: SUMMARY, references: host.expectedReferences! })).toMatchObject({ ok: false, code: 'REFERENCE_MISMATCH' });
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); await new Promise((resolve) => setTimeout(resolve, 0)); });
const SECRET_TOKEN = 'conformance-opaque-token-9f3';
const authorization = (revision = '1') => ({ revision, token: async () => SECRET_TOKEN });
function props(port: FinanceV2SyntheticReadPort, over: Partial<FinanceV2ConnectedViewProps> = {}): FinanceV2ConnectedViewProps {
  const host = hostFixture('conformance-pagination');
  return { mode: 'SYNTHETIC_PROPOSAL', view: 'transactions', availability: { status: 'available' }, scope: host.expectedScope, authorization: authorization(), expectedSnapshotId: host.expectedSnapshotId,
    expectedQueryContentHash: host.expectedQueryContentHash, expectedSummaryContentHash: host.expectedSummaryContentHash, expectedReferences: host.expectedReferences!, pageSize: 2, port, ...over } as FinanceV2ConnectedViewProps;
}
const rowIds = () => within(screen.getByRole('table', { name: 'Transaction details' })).getAllByRole('rowheader').map((cell) => cell.textContent);
const bannerText = () => screen.getByRole('region', { name: 'Snapshot and scope' }).textContent;
const click = async (name: string) => { fireEvent.click(screen.getByRole('button', { name })); await flush(); };
const newLog = (): CapturedPortLog => ({ reads: [] });
const everything = () => document.body.innerHTML;
/** Nothing the producer or the host kept private may reach a page: no raw safe_message, diagnostic reference, cursor or token. */
function expectNoLeak() {
  const html = everything();
  const secrets = [SECRET_TOKEN, ...refusals.observations.flatMap((entry: any) => [entry.result.error.safe_message, entry.result.error.diagnostic_ref]), ...responses.map((page) => page.nextCursor).filter(Boolean), ...refusals.observations.map((entry: any) => entry.request.cursor).filter(Boolean)]; // eslint-disable-line @typescript-eslint/no-explicit-any
  for (const secret of secrets) expect(html).not.toContain(secret);
}

describe('hydrated pages through the captured-chain port', () => {
  it('walks the three actual pages forward and back, replacing the rows each time and showing the delivered summary unchanged', async () => {
    const log = newLog();
    render(<FinanceV2ConnectedView {...props(capturedPaginationPort({ log }))} />); await flush();
    const banner = bannerText();
    expect(rowIds()).toEqual([ORDERED_IDS[0], ORDERED_IDS[1]]);
    expect(screen.getByRole('table', { name: 'Transaction details' }).textContent).toContain('2 EUR');
    await click('Next page'); expect(rowIds()).toEqual([ORDERED_IDS[2], ORDERED_IDS[3]]);
    expect(screen.getByRole('table', { name: 'Transaction details' }).textContent).toContain('0.000000000000000001 USD');
    expect(bannerText()).toBe(banner);
    await click('Next page'); expect(rowIds()).toEqual([ORDERED_IDS[4], ORDERED_IDS[5]]);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(bannerText()).toBe(banner);
    await click('Previous page'); expect(rowIds()).toEqual([ORDERED_IDS[2], ORDERED_IDS[3]]);
    await click('Previous page'); expect(rowIds()).toEqual([ORDERED_IDS[0], ORDERED_IDS[1]]);
    expect(log.reads.map((read) => [read.page, read.pageSize, read.outcome, read.code])).toEqual([[null, 2, 'ready', null], [1, 2, 'ready', null], [2, 2, 'ready', null], [1, 2, 'ready', null], [null, 2, 'ready', null]]);
    expect(screen.getByText(/no total is calculated for a page/iu)).toBeInTheDocument();
    expectNoLeak();
  });
  it('shows no amount while Previous re-reads: it is a fresh authorized read, not a cached page', async () => {
    const log = newLog();
    render(<FinanceV2ConnectedView {...props(capturedPaginationPort({ log, delayContinuationMs: 30 }))} />); await flush();
    const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
    await click('Next page'); await wait(60);
    await click('Next page'); await wait(60);
    expect(rowIds()).toEqual([ORDERED_IDS[4], ORDERED_IDS[5]]);
    fireEvent.click(screen.getByRole('button', { name: 'Previous page' })); await flush();
    expect(screen.getByText(/Loading the report/u)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+(\.\d+)? (USD|EUR)/u);
    await wait(60);
    expect(rowIds()).toEqual([ORDERED_IDS[2], ORDERED_IDS[3]]);
    expect(log.reads.map((read) => read.page)).toEqual([null, 1, 2, 1]);
  });
  it('a deep-linked actual cursor is a request parameter: the linked page reads, and Previous returns to the first page', async () => {
    const log = newLog();
    render(<FinanceV2ConnectedView {...props(capturedPaginationPort({ log }), { initialCursor: responses[0].nextCursor })} />); await flush();
    expect(rowIds()).toEqual([ORDERED_IDS[2], ORDERED_IDS[3]]);
    expect(document.body.textContent).toContain('Linked page');
    await click('Previous page'); expect(rowIds()).toEqual([ORDERED_IDS[0], ORDERED_IDS[1]]);
    expect(log.reads.map((read) => read.page)).toEqual([1, null]);
  });
  it('a filter change on page 2 returns to the first page and a fresh read, with the same actual rows', async () => {
    const log = newLog();
    const view = render(<FinanceV2ConnectedView {...props(capturedPaginationPort({ log }))} />); await flush();
    await click('Next page');
    fireEvent.change(screen.getByLabelText('Currency'), { target: { value: 'USD' } }); await flush();
    expect(log.reads.map((read) => read.page)).toEqual([null, 1, null]);
    expect(rowIds()).toEqual([ORDERED_IDS[1]]);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    view.unmount();
  });
  it('INTEGRATED mode never reaches the captured port, with or without a cursor', async () => {
    const log = newLog();
    render(<FinanceV2ConnectedView {...(props(capturedPaginationPort({ log }), { initialCursor: responses[0].nextCursor }) as object as FinanceV2ConnectedViewProps)} mode="INTEGRATED" port={undefined} />); await flush();
    expect(log.reads).toEqual([]);
    expect(document.body.textContent).toContain('no accepted read port exists');
    expect(document.body.textContent).not.toMatch(/\d+(\.\d+)? (USD|EUR)/u);
  });
});

describe('the actual nine typed refusals reach the page safely, with exact codes and the permission distinction', () => {
  type Setup = Readonly<{ over?: Partial<FinanceV2ConnectedViewProps>; grant?: CapturedGrant; tamper?: CapturedTamper; then?: 'next' }>;
  const cursorOf = (name: string): string => observationOf(name).request.cursor;
  const setups: Readonly<Record<(typeof REFUSAL_NAMES)[number], Setup & { shows: string; outcome: string }>> = {
    unsigned_cursor_forgery: { over: { initialCursor: cursorOf('unsigned_cursor_forgery') }, shows: 'Report could not be loaded', outcome: 'fault-400' },
    cursor_page_size_mismatch: { over: { initialCursor: cursorOf('cursor_page_size_mismatch'), pageSize: 3 }, shows: 'Report could not be loaded', outcome: 'fault-400' },
    snapshot_period_mismatch: { tamper: 'period', shows: 'Report could not be loaded', outcome: 'fault-400' },
    snapshot_filter_mismatch: { tamper: 'filters', shows: 'Report could not be loaded', outcome: 'fault-400' },
    foreign_scope: { over: { scope: { ...SCOPE, projectId: capturedForeignProjectId } }, shows: 'Report restricted', outcome: 'restricted' },
    cross_version_snapshot: { tamper: 'version', shows: 'Report could not be loaded', outcome: 'fault-400' },
    current_grant_denied: { grant: 'denied', shows: 'Not authorized', outcome: 'unauthorized' },
    stale_current_grant: { grant: 'stale', shows: 'Not authorized', outcome: 'unauthorized' },
    revoked_after_commit: { grant: 'revoked', then: 'next', shows: 'Not authorized', outcome: 'unauthorized' },
  };
  it.each(REFUSAL_NAMES)('%s: exact producer code, safe fixed copy, no amount, no raw message, diagnostic, cursor or token', async (name) => {
    const setup = setups[name]; const log = newLog();
    const expected = observationOf(name);
    render(<FinanceV2ConnectedView {...props(capturedPaginationPort({ log, ...(setup.grant ? { grant: setup.grant } : {}), ...(setup.tamper ? { tamper: setup.tamper } : {}) }), setup.over)} />); await flush();
    if (setup.then === 'next') { expect(rowIds()).toEqual([ORDERED_IDS[0], ORDERED_IDS[1]]); await click('Next page'); }
    expect(screen.getByRole('heading', { name: setup.shows })).toBeInTheDocument();
    const last = log.reads[log.reads.length - 1]!;
    expect({ code: last.code, outcome: last.outcome }).toEqual({ code: expected.result.error.code, outcome: setup.outcome });
    expect(document.body.textContent).not.toMatch(/\d+(\.\d+)? (USD|EUR)/u);
    expect(screen.queryByRole('table', { name: 'Transaction details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expectNoLeak();
  });
  it('covers all nine recorded refusals, and the code table is exactly the recorded one', () => {
    expect(refusals.observations.map((entry: { name: string }) => entry.name)).toEqual([...REFUSAL_NAMES]);
    expect(refusals.observations.map((entry: any) => entry.result.error.code)).toEqual(['VALIDATION_ERROR', 'IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT', 'FORBIDDEN_SCOPE', 'IDEMPOTENCY_CONFLICT', 'FORBIDDEN_SCOPE', 'FORBIDDEN_SCOPE', 'FORBIDDEN_SCOPE']); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(refusals.observations.every((entry: any) => entry.result.ok === false && entry.result.error.retryable === false)).toBe(true); // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  it('maps FORBIDDEN_SCOPE by what the host knows: a foreign scope is restricted, a lost current grant is unauthorized; unknown codes show no amount', () => {
    const forbidden = observationOf('foreign_scope').result as CapturedApiResult;
    expect(financeV2InputFromApiResult(forbidden, 'scope')).toEqual({ status: 'restricted' });
    expect(financeV2InputFromApiResult(forbidden, 'grant')).toEqual({ status: 'unauthorized' });
    const odd = { ok: false, error: { ...(forbidden as { error: object }).error, code: 'SOMETHING_NEW' } } as unknown as CapturedApiResult;
    expect(financeV2InputFromApiResult(odd)).toEqual({ status: 'unknown' });
    expect(() => financeV2InputFromApiResult({ ok: false, error: { ...(forbidden as { error: object }).error, code: 'SOURCE_UNAVAILABLE', retryable: true } } as unknown as CapturedApiResult)).toThrow();
  });
  it('an unrecorded cursor or scope is refused by class, never answered with a page', async () => {
    const log = newLog(); const port = capturedPaginationPort({ log });
    const base = { scope: SCOPE, expectedSnapshotId: SNAPSHOT, expectedQueryContentHash: QUERY, expectedSummaryContentHash: SUMMARY, pageSize: 2, authorization: { token: 't', revision: '1' }, signal: new AbortController().signal };
    await expect(port.read({ ...base, cursor: 'not-a-recorded-cursor' })).rejects.toMatchObject({ status: 400 });
    await expect(port.read({ ...base, scope: { ...SCOPE, actorId: 'account:synthetic-actor-b' } })).resolves.toEqual({ status: 'restricted' });
    expect(log.reads.map((read) => [read.code, read.outcome])).toEqual([['VALIDATION_ERROR', 'fault-400'], ['FORBIDDEN_SCOPE', 'restricted']]);
  });
});

describe('the repaired guards against the actual chain', () => {
  const wrap = (change: (index: number, page: any) => any): FinanceV2SyntheticReadPort => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const inner = capturedPaginationPort();
    return { kind: 'SYNTHETIC_PROPOSAL', read: async (request) => {
      const answer = await inner.read(request);
      if (answer.status !== 'ready') return answer;
      const index = responses.findIndex((page) => page.nextCursor === request.cursor) + 1;
      return { status: 'ready', page: change(index, structuredClone(answer.page)) };
    } };
  };
  const alert = () => screen.getByRole('alert').textContent;
  it.each([
    ['summary expense total', (page: any) => { page.summary.currencies[1].metrics.expense.total = '999.000000000000000000'; }, 'SNAPSHOT_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['asOf', (page: any) => { page.asOf = '2030-01-01T00:00:00.000Z'; }, 'SNAPSHOT_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['detailCount', (page: any) => { page.detailCount = 999; }, 'SNAPSHOT_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['canonicalSummaries emptied', (page: any) => { page.canonicalSummaries = []; }, 'SNAPSHOT_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
  ])('an actual page 2 whose %s differs from page 1 is refused with %s and shows no amount', async (_name, change, code) => {
    render(<FinanceV2ConnectedView {...props(wrap((index, page) => { if (index === 1) change(page); return page; }))} />); await flush();
    await click('Next page');
    expect(alert()).toContain(code);
    expect(document.body.textContent).not.toMatch(/\d+(\.\d+)? (USD|EUR)/u);
  });
  it('p1 -> p2 -> p3 -> Previous answered with the actual page 3 is refused as PAGE_REPLAY, not shown as page 2', async () => {
    let revisits = 0;
    render(<FinanceV2ConnectedView {...props(wrap((index, page) => { if (index === 1) { revisits += 1; return revisits > 1 ? structuredClone(responses[2]) : page; } return page; }))} />); await flush();
    await click('Next page'); await click('Next page'); await click('Previous page');
    expect(alert()).toContain('PAGE_REPLAY');
    expect(document.body.textContent).not.toContain(ORDERED_IDS[4]);
    expect(document.body.textContent).not.toMatch(/\d+(\.\d+)? (USD|EUR)/u);
  });
});
