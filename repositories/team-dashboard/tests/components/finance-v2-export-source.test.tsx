/* eslint-disable @typescript-eslint/no-explicit-any */
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FINANCE_V2_EXPORT_KIND, PreparedExportPanel, checkPreparedExportIntegrity, usePreparedExport, type FinanceV2ExportHostAccess, type FinanceV2PreparedExportOptions,
  type FinanceV2PreparedExportRequest, type FinanceV2SyntheticExportPort,
} from '../../src/views/finance-v2';
import { exportConformanceIdentity, exportConformancePage, exportConformanceScope } from '../../integration/fixture-host/finance-v2-export';
import { FINANCE_EXPORT, FINANCE_READ } from '../../src/access/permissions';
import { expectationZero, ok, receiptZero, tamperUnderDeclaredHash, withContent, type Receipt } from './export-support';

/**
 * SYNTHETIC_EXPORT_CONFORMANCE_ONLY. EXP-R1 (the delivered bytes must match their declared SHA-256, checked with the REAL Web Crypto over the producer's ACTUAL receipt 0 and test-built
 * hostile variants of it), EXP-R2 (the public hook/panel binds the WHOLE accepted source page, not just its snapshot id) and EXP-R3 (an obsolete run never touches a newer run's bytes).
 * The host seams (access reader, token, ports) are test doubles. Nothing here is a Product issuer, a coherent live fence, CFO delivery or a consumer acceptance.
 */
const FUTURE = '2099-01-01T00:00:00Z';
const settle = (ms = 25) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

function hostAccess() {
  const state: { current: FinanceV2ExportHostAccess } = { current: { revision: '1', scope: exportConformanceScope, capabilities: [FINANCE_READ, FINANCE_EXPORT], expiresAt: FUTURE } };
  return { state, reader: () => state.current };
}
type Host = ReturnType<typeof hostAccess>;
function deferred() {
  const pending: { request: FinanceV2PreparedExportRequest; resolve: (x: unknown) => void; reject: (x: unknown) => void }[] = [];
  const port: FinanceV2SyntheticExportPort = { kind: FINANCE_V2_EXPORT_KIND, prepare: (request) => new Promise((resolve, reject) => { pending.push({ request, resolve, reject }); }) };
  return { port, pending };
}
const answering = (answer: unknown): FinanceV2SyntheticExportPort => ({ kind: FINANCE_V2_EXPORT_KIND, prepare: async () => structuredClone(answer) });
const optionsFor = (host: Host, port: FinanceV2SyntheticExportPort, over: Partial<FinanceV2PreparedExportOptions> = {}): FinanceV2PreparedExportOptions => ({
  mode: 'SYNTHETIC_PROPOSAL', port, access: host.reader, authorization: { revision: '1', token: async () => 'private-test-token' }, scope: exportConformanceScope,
  expectedSnapshotId: exportConformanceIdentity.snapshotId, expectedQueryContentHash: exportConformanceIdentity.queryContentHash, expectedSummaryContentHash: exportConformanceIdentity.summaryContentHash,
  page: exportConformancePage(), firstPage: true, ...over,
});

const created: Blob[] = [];
beforeEach(() => {
  created.length = 0;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn((blob: Blob) => { created.push(blob); return 'blob:synthetic-export'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

/** Options are built ONCE: a fresh port or page object per render would itself be a source change. */
const hookFor = (host: Host, answer: unknown) => { const options = optionsFor(host, answering(answer)); return renderHook(() => usePreparedExport(options)); };
const csvReceipt =(): Receipt => { const receipt = withContent(receiptZero().receipt, 'summary.json', (content) => content); receipt.manifest.requestedFormat = 'csv'; return receipt; };

describe('EXP-R1: delivered bytes must match their declared SHA-256 (real Web Crypto, content integrity only)', () => {
  const exact = (receipt: Receipt, name: string) => receipt.artifacts.find((artifact) => artifact.fileName === name)!;
  it('accepts the actual producer receipt and returns the exact strings, declared hashes and lengths unchanged', async () => {
    const receipt = receiptZero().receipt;
    const result = await checkPreparedExportIntegrity(ok(receipt), expectationZero());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((file) => [file.fileName, file.content, file.contentHash, file.byteLength])).toEqual(receipt.artifacts.map((a) => [a.fileName, a.content, a.contentHash, a.byteLength]));
  });
  it.each([
    ['summary.json', '"ledgerExpense":"6"', '"ledgerExpense":"9"', 0],
    ['metrics.csv', '6.000000000000000000', '9.000000000000000000', 1],
  ])('refuses an equal-length financial substitution in %s that keeps the original declared hash, with no bytes', async (name, from, to, index) => {
    const original = receiptZero().receipt;
    const hostile = tamperUnderDeclaredHash(original, name as 'summary.json', (content) => content.replace(from, to));
    expect(exact(hostile, name).content.length).toBe(exact(original, name).content.length);
    expect(exact(hostile, name).contentHash).toBe(exact(original, name).contentHash);
    const result = await checkPreparedExportIntegrity(ok(hostile), expectationZero());
    expect(result).toEqual({ ok: false, kind: 'refused', code: 'CONTENT_MISMATCH', path: `/value/artifacts/${index}/content` });
    expect(Object.keys(result).sort()).toEqual(['code', 'kind', 'ok', 'path']);
  });
  it('a one-bit change in a multibyte-safe position is caught as well (every byte is covered, not just the numbers)', async () => {
    const hostile = tamperUnderDeclaredHash(receiptZero().receipt, 'summary.json', (content) => content.replace('"kind":"finance_reporting_export_proposal"', '"kind":"finance_reporting_export_proposaL"'));
    expect((await checkPreparedExportIntegrity(ok(hostile), expectationZero())).ok).toBe(false);
  });
  it('does not call a made-up hash proof: a re-hashed variant is accepted only because its OWN declared hash matches, which proves integrity of those bytes and nothing about their source', async () => {
    const rehashed = withContent(receiptZero().receipt, 'metrics.csv', (content) => content.replace('6.000000000000000000', '9.000000000000000000'));
    expect((await checkPreparedExportIntegrity(ok(rehashed), expectationZero())).ok).toBe(true);
  });
  it('fails closed when Web Crypto is unavailable', async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      expect(await checkPreparedExportIntegrity(ok(receiptZero().receipt), expectationZero())).toMatchObject({ ok: false, kind: 'refused', code: 'CONTENT_MISMATCH' });
    } finally { Object.defineProperty(globalThis, 'crypto', original); }
  });

  it.each([
    ['json', 'summary.json', '"ledgerExpense":"6"', '"ledgerExpense":"9"'],
    ['csv', 'metrics.csv', '6.000000000000000000', '9.000000000000000000'],
  ] as const)('the hook refuses a %s receipt whose bytes were changed under the declared hash: refused, nothing held, no download', async (format, name, from, to) => {
    const host = hostAccess();
    const source = format === 'csv' ? csvReceipt() : receiptZero().receipt;
    const hostile = tamperUnderDeclaredHash(source, name, (content) => content.replace(from, to));
    const hook = hookFor(host, ok(hostile));
    if (format === 'csv') act(() => hook.result.current.setFormat('csv'));
    act(() => hook.result.current.prepare()); await settle();
    expect(hook.result.current.state).toMatchObject({ phase: 'refused', code: 'CONTENT_MISMATCH' });
    let file: string | null = 'x';
    act(() => { file = hook.result.current.download(); });
    expect(file).toBeNull();
    expect(created).toEqual([]);
  });
  it('control: the same hook prepares and downloads the genuine receipt (so the refusal above is the bytes, not the setup)', async () => {
    const host = hostAccess();
    const hook = hookFor(host, ok(receiptZero().receipt));
    act(() => hook.result.current.prepare()); await settle();
    expect(hook.result.current.state.phase).toBe('prepared');
    let file: string | null = null;
    act(() => { file = hook.result.current.download(); });
    expect(file).toBe('summary.json');
    expect(created).toHaveLength(1);
  });

  describe('host access is renewed after the async hashing await', () => {
    // The wrapper calls the REAL digest and only then changes the host's access, so the change lands exactly inside the new await.
    const duringDigest = (change: () => void) => {
      const original = crypto.subtle.digest.bind(crypto.subtle);
      vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (...args: Parameters<SubtleCrypto['digest']>) => { const out = await original(...args); change(); return out; });
    };
    it.each([
      ['export capability revoked', (host: Host) => { host.state.current = { ...host.state.current, capabilities: [FINANCE_READ] }; }],
      ['read capability revoked', (host: Host) => { host.state.current = { ...host.state.current, capabilities: [FINANCE_EXPORT] }; }],
      ['access revision changed', (host: Host) => { host.state.current = { ...host.state.current, revision: '2' }; }],
      ['actor switched', (host: Host) => { host.state.current = { ...host.state.current, scope: { ...exportConformanceScope, actorId: 'account:other' } }; }],
      ['access expired', (host: Host) => { host.state.current = { ...host.state.current, expiresAt: '2020-01-01T00:00:00Z' }; }],
    ])('%s during the hashing await: the genuine bytes are dropped, never prepared, never downloadable', async (_name, change) => {
      const host = hostAccess();
      const hook = hookFor(host, ok(receiptZero().receipt));
      duringDigest(() => change(host));
      act(() => hook.result.current.prepare()); await settle();
      expect(hook.result.current.state.phase).not.toBe('prepared');
      let file: string | null = 'x';
      act(() => { file = hook.result.current.download(); });
      expect(file).toBeNull();
      expect(created).toEqual([]);
    });
    it('revoke then restore inside the hashing await (revision unchanged) still leaves nothing prepared once access is back', async () => {
      const host = hostAccess();
      const granted = host.state.current;
      const hook = hookFor(host, ok(receiptZero().receipt));
      duringDigest(() => { host.state.current = { ...granted, capabilities: [FINANCE_READ] }; });
      act(() => hook.result.current.prepare()); await settle();
      host.state.current = granted;
      hook.rerender(); await settle(600);
      expect(hook.result.current.state.phase).not.toBe('prepared');
      let file: string | null = 'x';
      act(() => { file = hook.result.current.download(); });
      expect(file).toBeNull();
      expect(created).toEqual([]);
    });
    it('a source page change inside the hashing await drops the genuine bytes too', async () => {
      const host = hostAccess();
      const options = optionsFor(host, answering(ok(receiptZero().receipt)));
      const hook = renderHook(() => usePreparedExport(options));
      duringDigest(() => { (options.page as any).watermark.observedThrough = '2026-10-13T22:00:00.000Z'; });
      act(() => hook.result.current.prepare()); await settle();
      expect(hook.result.current.state.phase).not.toBe('prepared');
      let file: string | null = 'x';
      act(() => { file = hook.result.current.download(); });
      expect(file).toBeNull();
    });
  });
});

describe('EXP-R2: the public hook binds the WHOLE accepted source page, not only its snapshot id', () => {
  const edits: [string, (page: any) => void][] = [
    ['asOf', (page) => { page.asOf = '2026-10-13T22:00:00.000Z'; }],
    ['timezone', (page) => { page.timezone = 'America/New_York'; }],
    ['period end', (page) => { page.period.end = '2026-10-12T00:00:00.000Z'; }],
    ['watermark', (page) => { page.watermark = { ...page.watermark, observedThrough: '2026-10-13T22:00:00.000Z' }; }],
    ['summary amount', (page) => { page.summary.currencies[0].metrics.expense.knownSubtotal = '9'; }],
    ['envelope request id', (page) => { page.requestId = 'another-request'; }],
    ['nested filter list', (page) => { page.filters.environments = ['test', 'prod']; }],
    ['carried opaque canonical summaries', (page) => { page.canonicalSummaries = [...page.canonicalSummaries, { reference: 'x' }]; }],
    ['mapping status', (page) => { page.canonicalMappingStatus = page.canonicalMappingStatus === 'unsupported_opaque_scope' ? 'proposal_only_owner_ack_pending' : 'unsupported_opaque_scope'; }],
    ['has-more flag', (page) => { page.hasMore = !page.hasMore; }],
  ];
  it.each(edits)('a changed %s with the SAME snapshot id invalidates a pending export: its late answer is never prepared or downloadable', async (_name, edit) => {
    const host = hostAccess();
    const { port, pending } = deferred();
    const first = optionsFor(host, port);
    const hook = renderHook(({ o }) => usePreparedExport(o), { initialProps: { o: first } });
    act(() => hook.result.current.prepare()); await settle();
    const page = structuredClone(first.page) as any; edit(page);
    expect(page.snapshotId).toBe(first.page.snapshotId);
    hook.rerender({ o: { ...first, page } });
    expect(hook.result.current.state.phase).toBe('idle');
    pending[0]!.resolve(ok(receiptZero().receipt)); await settle();
    expect(hook.result.current.state.phase).toBe('idle');
    let file: string | null = 'x';
    act(() => { file = hook.result.current.download(); });
    expect(file).toBeNull();
    expect(created).toEqual([]);
    expect(pending[0]!.request.signal.aborted).toBe(true);
  });
  it.each(edits)('a changed %s after preparation discards the prepared export: nothing to download, no old bytes offered', async (_name, edit) => {
    const host = hostAccess();
    const first = optionsFor(host, answering(ok(receiptZero().receipt)));
    const hook = renderHook(({ o }) => usePreparedExport(o), { initialProps: { o: first } });
    act(() => hook.result.current.prepare()); await settle();
    expect(hook.result.current.state.phase).toBe('prepared');
    const page = structuredClone(first.page) as any; edit(page);
    hook.rerender({ o: { ...first, page } }); await settle();
    expect(hook.result.current.state.phase).toBe('idle');
    let file: string | null = 'x';
    act(() => { file = hook.result.current.download(); });
    expect(file).toBeNull();
    expect(created).toEqual([]);
  });
  it('control: an equal page with a different key order and a new object does NOT reset a pending export, which then prepares', async () => {
    const host = hostAccess();
    const { port, pending } = deferred();
    const first = optionsFor(host, port);
    const hook = renderHook(({ o }) => usePreparedExport(o), { initialProps: { o: first } });
    act(() => hook.result.current.prepare()); await settle();
    const reordered = Object.fromEntries(Object.entries(structuredClone(first.page)).reverse()) as any;
    reordered.summary = Object.fromEntries(Object.entries(reordered.summary).reverse());
    hook.rerender({ o: { ...first, page: reordered } });
    expect(hook.result.current.state.phase).toBe('preparing');
    pending[0]!.resolve(ok(receiptZero().receipt)); await settle();
    expect(hook.result.current.state.phase).toBe('prepared');
    let file: string | null = null;
    act(() => { file = hook.result.current.download(); });
    expect(file).toBe('summary.json');
  });
  it('the request carries an immutable copy: mutating the host\'s page object in place afterwards cannot change what was sent', async () => {
    const host = hostAccess();
    const { port, pending } = deferred();
    const options = optionsFor(host, port);
    const hook = renderHook(() => usePreparedExport(options));
    act(() => hook.result.current.prepare()); await settle();
    const sent = pending[0]!.request.summarySnapshot;
    expect(sent).not.toBe(options.page);
    expect(sent).toEqual(options.page);
    const before = JSON.stringify(sent);
    (options.page as any).summary.currencies[0].metrics.expense.knownSubtotal = '9';
    expect(JSON.stringify(sent)).toBe(before);
  });
  it('an alias mutated in place WHILE pending, with no re-render, cancels the run: the late answer is dropped', async () => {
    const host = hostAccess();
    const { port, pending } = deferred();
    const options = optionsFor(host, port);
    const hook = renderHook(() => usePreparedExport(options));
    act(() => hook.result.current.prepare()); await settle();
    (options.page as any).summary.currencies[0].metrics.expense.knownSubtotal = '9';
    pending[0]!.resolve(ok(receiptZero().receipt)); await settle();
    expect(hook.result.current.state.phase).not.toBe('prepared');
    let file: string | null = 'x';
    act(() => { file = hook.result.current.download(); });
    expect(file).toBeNull();
    expect(created).toEqual([]);
  });
  it('an alias mutated in place AFTER preparation, with no re-render, discloses nothing on download and drops the bytes for good', async () => {
    const host = hostAccess();
    const options = optionsFor(host, answering(ok(receiptZero().receipt)));
    const hook = renderHook(() => usePreparedExport(options));
    act(() => hook.result.current.prepare()); await settle();
    expect(hook.result.current.state.phase).toBe('prepared');
    (options.page as any).asOf = '2026-10-13T22:00:00.000Z';
    let file: string | null = 'x';
    act(() => { file = hook.result.current.download(); });
    expect(file).toBeNull();
    expect(created).toEqual([]);
    (options.page as any).asOf = exportConformancePage().asOf;
    act(() => { file = hook.result.current.download(); });
    expect(file).toBeNull();
  });
  it('the same holds for the public PreparedExportPanel used on its own (outside the connected view): no old download is rendered for a changed source', async () => {
    const host = hostAccess();
    const first = optionsFor(host, answering(ok(receiptZero().receipt)));
    const view = render(<PreparedExportPanel {...first} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare manual export' })); await settle();
    expect(screen.getByRole('button', { name: 'Download summary.json' })).toBeInTheDocument();
    const page = structuredClone(first.page) as any; page.summary.currencies[0].metrics.expense.knownSubtotal = '9';
    view.rerender(<PreparedExportPanel {...first} page={page} />); await settle();
    expect(screen.queryByRole('button', { name: /^Download / })).toBeNull();
    expect(screen.getByText(/Nothing is prepared yet/u)).toBeInTheDocument();
    expect(created).toEqual([]);
  });
});

describe('EXP-R3: an obsolete run never clears or replaces a newer run\'s prepared bytes', () => {
  it.each(['resolve', 'reject'] as const)('a cancelled older preparation that later %ss leaves the newer prepared export downloadable', async (how) => {
    const host = hostAccess();
    const old = deferred();
    const first = optionsFor(host, old.port);
    const hook = renderHook(({ o }) => usePreparedExport(o), { initialProps: { o: first } });
    act(() => hook.result.current.prepare()); await settle();
    hook.rerender({ o: optionsFor(host, answering(ok(receiptZero().receipt))) }); await settle();
    act(() => hook.result.current.prepare()); await settle();
    expect(hook.result.current.state.phase).toBe('prepared');
    if (how === 'resolve') old.pending[0]!.resolve(ok(receiptZero().receipt)); else old.pending[0]!.reject(Object.assign(new Error('obsolete failure'), { status: 500 }));
    await settle();
    expect(hook.result.current.state.phase).toBe('prepared');
    let file: string | null = null;
    act(() => { file = hook.result.current.download(); });
    expect(file).toBe('summary.json');
    expect(created).toHaveLength(1);
  });
  it.each(['resolve', 'reject'] as const)('the same overlap through the public panel: the newer Download button stays and works after the older run %ss', async (how) => {
    const host = hostAccess();
    const old = deferred();
    const first = optionsFor(host, old.port);
    const view = render(<PreparedExportPanel {...first} />);
    fireEvent.click(screen.getByRole('button', { name: 'Prepare manual export' })); await settle();
    const next = optionsFor(host, answering(ok(receiptZero().receipt)));
    view.rerender(<PreparedExportPanel {...next} />); await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare manual export' })); await settle();
    expect(screen.getByRole('button', { name: 'Download summary.json' })).toBeInTheDocument();
    await act(async () => { if (how === 'resolve') old.pending[0]!.resolve(ok(receiptZero().receipt)); else old.pending[0]!.reject(new Error('obsolete failure')); await Promise.resolve(); });
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Download summary.json' }));
    expect(created).toHaveLength(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('an older run that is vetoed after being cancelled does not discard the newer run either', async () => {
    const host = hostAccess();
    const old = deferred();
    const hook = renderHook(({ o }) => usePreparedExport(o), { initialProps: { o: optionsFor(host, old.port) } });
    act(() => hook.result.current.prepare()); await settle();
    hook.rerender({ o: optionsFor(host, answering(ok(receiptZero().receipt))) }); await settle();
    act(() => hook.result.current.prepare()); await settle();
    expect(hook.result.current.state.phase).toBe('prepared');
    old.pending[0]!.resolve(ok(receiptZero().receipt)); await flush(); await settle();
    expect(hook.result.current.state.phase).toBe('prepared');
  });
});
