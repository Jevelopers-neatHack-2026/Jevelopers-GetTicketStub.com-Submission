import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as root from '../../src';
import { checkPreparedExport } from '../../src';
import { FINANCE_V2_EXPORT_KIND, usePreparedExport, type FinanceV2ExportHostAccess, type FinanceV2PreparedExportOptions, type FinanceV2SyntheticExportPort } from '../../src/views/finance-v2';
import { exportConformanceIdentity, exportConformancePage, exportConformanceScope } from '../../integration/fixture-host/finance-v2-export';
import { FINANCE_EXPORT, FINANCE_READ } from '../../src/access/permissions';
import { ZERO, clone, expectationZero, ok, receiptZero, tamperUnderDeclaredHash, withContent, type Receipt } from './export-support';

/**
 * SYNTHETIC_EXPORT_CONFORMANCE_ONLY. EXP-R1: the PUBLIC root `checkPreparedExport` is the only public accepted result and it hashes the real bytes (real Web Crypto; the hostile
 * variants are test-built from the producer's ACTUAL receipt 0 and keep its original declared hashes). EXP-R2: what an answer is bound to is captured privately BEFORE the port sees the
 * request, so a port that changes its request and returns bytes with a correctly recomputed digest is still refused. Test doubles for the host seams; no acceptance is claimed.
 */
const FUTURE = '2099-01-01T00:00:00Z';
const settle = (ms = 25) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

describe('EXP-R1: the public root entry point accepts nothing it has not hashed', () => {
  it.each([
    ['summary.json', '"ledgerExpense":"6"', '"ledgerExpense":"9"', 0],
    ['metrics.csv', '6.000000000000000000', '9.000000000000000000', 1],
  ] as const)('refuses an equal-length financial change in %s under the original declared hash, with no bytes', async (name, from, to, index) => {
    const hostile = tamperUnderDeclaredHash(receiptZero().receipt, name, (content) => content.replace(from, to));
    const result = await checkPreparedExport(ok(hostile), expectationZero());
    expect(result).toEqual({ ok: false, kind: 'refused', code: 'CONTENT_MISMATCH', path: `/value/artifacts/${index}/content` });
    expect('files' in result).toBe(false);
  });
  it('control: the untouched producer receipt 0 is accepted with its exact strings', async () => {
    const receipt = receiptZero().receipt;
    const result = await checkPreparedExport(ok(receipt), expectationZero());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.files.map((file) => file.content)).toEqual(receipt.artifacts.map((artifact) => artifact.content));
  });
  it('the structural helper is not part of the public root surface, and the earlier async name is the same function', () => {
    expect(Object.keys(root)).not.toContain('inspectPreparedExportStructure');
    expect(Object.keys(root)).not.toContain('verifyPreparedFilesIntegrity');
    expect(root.checkPreparedExportIntegrity).toBe(root.checkPreparedExport);
  });
  it('the public result is a promise: there is no synchronous accepted result to misuse', () => {
    expect(checkPreparedExport(ok(receiptZero().receipt), expectationZero())).toBeInstanceOf(Promise);
  });
});

describe('EXP-R2: the expectation is private and captured before the port sees the request', () => {
  const created: Blob[] = [];
  beforeEach(() => {
    created.length = 0;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn((blob: Blob) => { created.push(blob); return 'blob:synthetic-export'; }) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  const access = (): FinanceV2ExportHostAccess => ({ revision: '1', scope: exportConformanceScope, capabilities: [FINANCE_READ, FINANCE_EXPORT], expiresAt: FUTURE });
  const optionsFor = (port: FinanceV2SyntheticExportPort, page = exportConformancePage()): FinanceV2PreparedExportOptions => ({
    mode: 'SYNTHETIC_PROPOSAL', port, access, authorization: { revision: '1', token: async () => 'private-test-token' }, scope: exportConformanceScope,
    expectedSnapshotId: exportConformanceIdentity.snapshotId, expectedQueryContentHash: exportConformanceIdentity.queryContentHash, expectedSummaryContentHash: exportConformanceIdentity.summaryContentHash,
    page, firstPage: true,
  });
  /** A hostile port: it tries to change what it was asked about (recording whether the attempt could even be made), then returns bytes that match its OWN change with a correct digest. */
  const mutating = (mutate: (request: Parameters<FinanceV2SyntheticExportPort['prepare']>[0]) => void, answer: Receipt, attempts: boolean[]): FinanceV2SyntheticExportPort => ({
    kind: FINANCE_V2_EXPORT_KIND,
    prepare: async (request) => {
      try { mutate(request); attempts.push(true); } catch { attempts.push(false); }
      return clone(ok(answer));
    },
  });
  const run = async (port: FinanceV2SyntheticExportPort, page = exportConformancePage()) => {
    const hook = renderHook(() => usePreparedExport(optionsFor(port, page)));
    act(() => hook.result.current.prepare()); await settle();
    return hook;
  };
  const rehashed = (change: (content: string) => string): Receipt => withContent(receiptZero().receipt, 'summary.json', change);

  it.each([
    ['asOf', (r: Parameters<FinanceV2SyntheticExportPort['prepare']>[0]) => { (r.summarySnapshot as { asOf: string }).asOf = '2026-10-12T23:00:00.000Z'; }, (c: string) => c.replace(ZERO.asOf, '2026-10-12T23:00:00.000Z'), 'SNAPSHOT_MISMATCH'],
    ['timezone', (r: Parameters<FinanceV2SyntheticExportPort['prepare']>[0]) => { (r.summarySnapshot as { timezone: string }).timezone = 'Europe/Paris'; }, (c: string) => c.replace('"timezone":"UTC"', '"timezone":"Europe/Paris"'), 'PERIOD_MISMATCH'],
    ['period', (r: Parameters<FinanceV2SyntheticExportPort['prepare']>[0]) => { (r.summarySnapshot.period as { start: string }).start = '2026-10-09T00:00:00.000Z'; }, (c: string) => c.replace(ZERO.period.start, '2026-10-09T00:00:00.000Z'), 'PERIOD_MISMATCH'],
    ['summary reference', (r: Parameters<FinanceV2SyntheticExportPort['prepare']>[0]) => { (r.summarySnapshot as { summaryContentHash: string }).summaryContentHash = `sha256:${'a'.repeat(64)}`; }, (c: string) => c.replace(ZERO.summaryContentHash, `sha256:${'a'.repeat(64)}`), 'SUMMARY_HASH_MISMATCH'],
    ['scope environment', (r: Parameters<FinanceV2SyntheticExportPort['prepare']>[0]) => { (r.scope as { environment: string }).environment = 'production'; }, (c: string) => c.replace('"environment":"test"', '"environment":"production"'), 'SCOPE_MISMATCH'],
  ])('a port that changes the request %s and returns matching bytes with a correct digest is refused; the host page is untouched', async (_name, mutate, change, code) => {
    const attempts: boolean[] = [];
    const page = exportConformancePage();
    const before = structuredClone(page);
    const hook = await run(mutating(mutate, rehashed(change), attempts), page);
    expect(attempts).toHaveLength(1);
    expect(hook.result.current.state).toMatchObject({ phase: 'refused', code });
    expect(page).toEqual(before);
    let file: string | null = 'x';
    act(() => { file = hook.result.current.download(); });
    expect(file).toBeNull();
    expect(created).toEqual([]);
  });
  it('the request the port receives is a different, immutable copy of the host page and scope', async () => {
    let seen: Parameters<FinanceV2SyntheticExportPort['prepare']>[0] | undefined;
    const port: FinanceV2SyntheticExportPort = { kind: FINANCE_V2_EXPORT_KIND, prepare: async (request) => { seen = request; return ok(receiptZero().receipt); } };
    const page = exportConformancePage();
    await run(port, page);
    expect(seen!.summarySnapshot).not.toBe(page);
    expect(seen!.summarySnapshot).toEqual(page);
    expect(Object.isFrozen(seen!.summarySnapshot)).toBe(true);
    expect(Object.isFrozen(seen!.summarySnapshot.summary)).toBe(true);
    expect(Object.isFrozen(seen!.scope)).toBe(true);
    expect(seen!.scope).not.toBe(exportConformanceScope);
  });
  it('control: a port that does not touch its request prepares and downloads the genuine receipt', async () => {
    const port: FinanceV2SyntheticExportPort = { kind: FINANCE_V2_EXPORT_KIND, prepare: async () => clone(ok(receiptZero().receipt)) };
    const hook = await run(port);
    expect(hook.result.current.state.phase).toBe('prepared');
    let file: string | null = null;
    act(() => { file = hook.result.current.download(); });
    expect(file).toBe('summary.json');
    expect(created).toHaveLength(1);
  });
});
