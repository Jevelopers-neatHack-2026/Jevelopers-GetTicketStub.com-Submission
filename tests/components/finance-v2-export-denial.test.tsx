import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FINANCE_V2_EXPORT_ERROR_COPY, FINANCE_V2_EXPORT_KIND, PreparedExportPanel, checkPreparedExport, usePreparedExport, type FinanceV2ExportHostAccess, type FinanceV2PreparedExportOptions,
  type FinanceV2SyntheticExportPort,
} from '../../src/views/finance-v2';
import { exportConformanceIdentity, exportConformancePage, exportConformanceScope } from '../../integration/fixture-host/finance-v2-export';
import { FINANCE_EXPORT, FINANCE_READ } from '../../src/access/permissions';
import {
  CAPTURE_FILE, DENIAL_DIR, allCases, answerOf, capture, captureBytes, capturedFiles, entryMissingFence, failureCases, failureOf, lateForbidden, positiveCases, provenance, receiptOf, sha256,
  testBuiltExpectation,
} from './denial-support';
import { clone, receiptZero, tamperUnderDeclaredHash } from './export-support';

/**
 * SYNTHETIC_DENIAL_CAPTURE_SUPPLEMENT_ONLY. The consumer's public async guard (`checkPreparedExport`) and its UI/port disclosure (hook and panel) against the Finance producer's ACTUAL
 * captured authorization composition: 92 cases, 64 typed failures (60 late FORBIDDEN_SCOPE, 4 entry SOURCE_UNAVAILABLE) and 28 positives (14 legacy 1.0.0, 14 rich 2.0.0).
 * Current UI read/export access is ALLOWED throughout, so every refusal below is the producer's answer, not the Dashboard's own gate. The host seams are test doubles; the authority behind
 * the capture is a synthetic single-state host, not a live issuer. Nothing here claims fresh database execution, zero SQL reads for late denials, CFO delivery or consumer acceptance.
 */
const FUTURE = '2099-01-01T00:00:00Z';
const settle = (ms = 25) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
const access = (): FinanceV2ExportHostAccess => ({ revision: '1', scope: exportConformanceScope, capabilities: [FINANCE_READ, FINANCE_EXPORT], expiresAt: FUTURE });
const answering = (answer: unknown): FinanceV2SyntheticExportPort => ({ kind: FINANCE_V2_EXPORT_KIND, prepare: async () => structuredClone(answer) });
const optionsFor = (port: FinanceV2SyntheticExportPort): FinanceV2PreparedExportOptions => ({
  mode: 'SYNTHETIC_PROPOSAL', port, access, authorization: { revision: '1', token: async () => 'private-test-token' }, scope: exportConformanceScope,
  expectedSnapshotId: exportConformanceIdentity.snapshotId, expectedQueryContentHash: exportConformanceIdentity.queryContentHash, expectedSummaryContentHash: exportConformanceIdentity.summaryContentHash,
  page: exportConformancePage(), firstPage: true,
});

const created: Blob[] = [];
beforeEach(() => {
  created.length = 0;
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn((blob: Blob) => { created.push(blob); return 'blob:synthetic-denial'; }) });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

const failures = failureCases();
const failureIds = failures.map((item) => item.caseId);
const byId = (id: string) => allCases().find((item) => item.caseId === id)!;

describe('the committed capture is the accepted capture, byte for byte, with portable provenance', () => {
  const info = provenance();
  it('has the accepted size and SHA-256 (node crypto) and states them in PROVENANCE.json', () => {
    const bytes = captureBytes();
    expect(bytes.length).toBe(1_021_876);
    expect(sha256(bytes)).toBe('6305706dbac8f366ca20601e62594b3a534fd79e69c0e1087cb3a9e815203d07');
    expect(info.capturedFile).toMatchObject({ name: CAPTURE_FILE, sha256: sha256(bytes), byteLength: bytes.length });
    expect(info.label).toBe('SYNTHETIC_DENIAL_CAPTURE_SUPPLEMENT_ONLY');
    expect(info.handoff.sha256).toBe('8a38eaaf8af1c2723124958cd2ea0d0e4ce37925cab8268374a1a284ece4bfc3');
    expect(info.producer).toMatchObject({ head: '3e88311d481052f522e8e79ed20155334ab526e7', tree: 'fc3541edcc80ed9c0b30908cd4bbb0425ff15305', candidateCheckout: 'ffe2ae493b61dd7010b2883933d39fecb96d0ec4', candidateRun: 38259518439 });
  });
  it('is portable: no absolute path, host name or credential in the provenance', () => {
    expect(JSON.stringify(info)).not.toMatch(/\/private\/|\/tmp\/|\/Users\/|C:\\\\|token|secret|password/iu);
  });
  it('states the qualifications instead of overclaiming', () => {
    const text = (info.qualifications as string[]).join(' ');
    expect(text).toMatch(/NOT a claim of fresh database execution and NOT a claim of zero SQL reads/u);
    expect(text).toMatch(/storeLookups is 0/u);
    expect(text).toMatch(/NOT the actual PostgreSQL request/u);
    expect(text).toMatch(/TEST_BUILT/u);
    expect(info.consumerAcknowledgement).toBe('pending');
    expect(capture().fixtureMode).toBe('real_disposable_postgresql_synthetic_financial_postings');
    expect(capture().executionProvenance.authorityMode).toBe('synthetic_single_state_host_NOT_live_issuer');
  });
  it('has the accepted case counts, with the stated counts matching the capture itself', () => {
    expect(allCases()).toHaveLength(92);
    expect(lateForbidden()).toHaveLength(60);
    expect(entryMissingFence()).toHaveLength(4);
    expect(failures).toHaveLength(64);
    expect(positiveCases()).toHaveLength(28);
    expect(positiveCases('1.0.0')).toHaveLength(14);
    expect(positiveCases('2.0.0')).toHaveLength(14);
    expect(info.counts).toMatchObject({ authorizationCases: 92, lateForbiddenScope: 60, entryMissingFourthFenceSourceUnavailable: 4, positives: 28, typedFailurePayloads: 64, capturedArtifactFiles: 90 });
    expect(new Set(allCases().map((item) => item.caseId)).size).toBe(92);
    expect(failures.filter((item) => item.version === '1.0.0')).toHaveLength(32);
    expect(failures.filter((item) => item.version === '2.0.0')).toHaveLength(32);
  });
  it('the late denials reached their denial after real reads (counters grew, so no zero-read claim), and the entry cases did no protected I/O at all', () => {
    for (const item of lateForbidden()) {
      expect(item.reached.originalVerified).toBe(true);
      expect(item.counters.after.sourceQueries).toBeGreaterThan(item.counters.before.sourceQueries);
      expect(item.counters.after.fenceValidations).toBeGreaterThan(item.counters.before.fenceValidations);
    }
    for (const item of entryMissingFence()) {
      expect(item.reached).toMatchObject({ capabilityAbsent: true, storeLookups: 0 });
      expect(item.counters.after).toEqual(item.counters.before);
    }
  });
  it('all 90 captured file bytes (34 original receipt files + 56 positive case files) hash to their declared SHA-256 and length with node crypto', () => {
    const files = capturedFiles();
    expect(files).toHaveLength(90);
    expect(files.filter((file) => file.origin.startsWith('receipt:'))).toHaveLength(34);
    expect(files.filter((file) => !file.origin.startsWith('receipt:'))).toHaveLength(56);
    for (const file of files) {
      const bytes = Buffer.from(file.content, 'utf8');
      expect(bytes.length, `${file.origin} ${file.fileName} length`).toBe(file.byteLength);
      expect(`sha256:${sha256(bytes)}`, `${file.origin} ${file.fileName} hash`).toBe(file.contentHash);
    }
  });
  it('the original 17 receipts in the capture are the same pinned bytes as the earlier packet (their qualification stays separate)', () => {
    const pinned = JSON.parse(JSON.stringify(capture().receipts.map((entry) => entry.receipt.artifacts.map((artifact) => [artifact.fileName, artifact.contentHash, artifact.byteLength]))));
    expect(pinned).toHaveLength(17);
    expect(DENIAL_DIR).not.toBe('tests/fixtures/export-conformance/');
  });
});

describe('every one of the 64 captured typed failures through the public async guard', () => {
  it.each(failureIds)('%s: the closed producer code only, no bytes, no message, no diagnostic reference', async (id) => {
    const item = byId(id);
    const error = failureOf(item);
    expect(['FORBIDDEN_SCOPE', 'SOURCE_UNAVAILABLE']).toContain(error.code);
    expect(error.code).toBe(item.expectedCode);
    const result = await checkPreparedExport(answerOf(item), testBuiltBlank());
    expect(result).toEqual({ ok: false, kind: 'error', code: error.code });
    expect(Object.keys(result).sort()).toEqual(['code', 'kind', 'ok']);
    const text = JSON.stringify(result);
    expect(text).not.toContain(error.safe_message);
    expect(text).not.toContain(error.diagnostic_ref);
    expect(result).not.toHaveProperty('files');
    expect(result).not.toHaveProperty('manifest');
  });
  it('the 60 late denials and 4 entry failures keep their own generic codes', async () => {
    const codes = new Map<string, number>();
    for (const item of failures) {
      const result = await checkPreparedExport(answerOf(item), testBuiltBlank());
      if (!result.ok && result.kind === 'error') codes.set(result.code, (codes.get(result.code) ?? 0) + 1);
    }
    expect([...codes.entries()].sort()).toEqual([['FORBIDDEN_SCOPE', 60], ['SOURCE_UNAVAILABLE', 4]]);
  });
  it('a captured failure that also carries a later, fake value is rejected: no bytes, no accepted result', async () => {
    const rich = receiptOf(positiveCases('2.0.0')[0]!);
    for (const item of [lateForbidden()[0]!, entryMissingFence()[0]!]) {
      const fake = { ...(answerOf(item) as object), value: clone(rich) };
      const result = await checkPreparedExport(fake, testBuiltBlank());
      expect(result).toMatchObject({ ok: false, kind: 'refused', code: 'INVALID_SHAPE' });
      expect(result).not.toHaveProperty('files');
      const flipped = { ok: true, value: clone(rich), error: failureOf(item) };
      expect(await checkPreparedExport(flipped, testBuiltBlank())).toMatchObject({ ok: false, kind: 'refused', code: 'INVALID_SHAPE' });
    }
  });
  it('a failure whose code is not one of the closed codes is refused rather than echoed', async () => {
    const item = lateForbidden()[0]!;
    const changed = { ok: false, error: { ...failureOf(item), code: 'FORBIDDEN_SCOPE_AND_MORE' } };
    expect(await checkPreparedExport(changed, testBuiltBlank())).toMatchObject({ ok: false, kind: 'refused', code: 'INVALID_SHAPE' });
  });
});

/** The expectation only matters to an accepted answer; a failure never reads it. Any well-formed one will do. */
function testBuiltBlank() {
  return testBuiltExpectation(positiveCases('2.0.0')[0]!);
}

describe('every captured failure through the public hook and panel: current UI access is allowed, the producer denies', () => {
  it.each(failureIds)('%s: hook shows the generic closed code, nothing is downloadable, nothing created', async (id) => {
    const item = byId(id);
    const error = failureOf(item);
    const options = optionsFor(answering(answerOf(item)));
    const hook = renderHook(() => usePreparedExport(options));
    expect(hook.result.current.unavailable).toBeNull();
    act(() => hook.result.current.prepare()); await settle();
    expect(hook.result.current.state).toEqual({ phase: 'failed', code: error.code });
    expect(JSON.stringify(hook.result.current.state)).not.toContain(error.safe_message);
    expect(JSON.stringify(hook.result.current.state)).not.toContain(error.diagnostic_ref);
    let file: string | null = 'x';
    act(() => { file = hook.result.current.download(); });
    expect(file).toBeNull();
    expect(created).toEqual([]);
    hook.unmount();
  });
  it.each(failureIds)('%s: panel renders only the fixed generic copy, no download, no producer message or diagnostic', async (id) => {
    const item = byId(id);
    const error = failureOf(item);
    const view = render(<PreparedExportPanel {...optionsFor(answering(answerOf(item)))} />);
    expect(screen.getByRole('button', { name: 'Prepare manual export' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare manual export' })); await settle();
    expect(screen.getByRole('alert')).toHaveTextContent(FINANCE_V2_EXPORT_ERROR_COPY[error.code as 'FORBIDDEN_SCOPE']);
    expect(screen.getByRole('alert')).toHaveTextContent('No file was produced.');
    expect(screen.queryByRole('button', { name: /^Download / })).toBeNull();
    const html = view.container.innerHTML;
    for (const secret of [error.safe_message, error.diagnostic_ref, 'ci1:', 'private-test-token', 'finance_reporting_export_proposal', 'currency,scale,metric']) expect(html).not.toContain(secret);
    expect(screen.queryByText(/prepared for manual handoff/iu)).toBeNull();
    expect(created).toEqual([]);
    view.unmount();
  });
  it('control: the same hook, access and page DO prepare a genuine receipt, so the failures above are the producer answer and not the setup', async () => {
    const options = optionsFor(answering({ ok: true, value: receiptZero().receipt }));
    const hook = renderHook(() => usePreparedExport(options));
    act(() => hook.result.current.prepare()); await settle();
    expect(hook.result.current.state.phase).toBe('prepared');
    let file: string | null = null;
    act(() => { file = hook.result.current.download(); });
    expect(file).toBe('summary.json');
  });
});

describe('the 28 captured positives', () => {
  const rich = positiveCases('2.0.0');
  const legacy = positiveCases('1.0.0');
  it.each(rich.map((item) => item.caseId))('rich %s: byte hash, length and source fields pass, with the exact delivered strings', async (id) => {
    const item = byId(id);
    const receipt = receiptOf(item);
    const baseline = testBuiltExpectation(item);
    const result = await checkPreparedExport({ ok: true, value: receipt }, baseline);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map((file) => file.content)).toEqual(receipt.artifacts.map((artifact) => artifact.content));
    expect(result.files.map((file) => [file.contentHash, file.byteLength])).toEqual(receipt.artifacts.map((artifact) => [artifact.contentHash, artifact.byteLength]));
    expect(result.manifest.exportId).toBe(receipt.manifest.exportId);
    expect(receipt.manifest.queryContentHash).toBe(item.sourceBinding.queryContentHash);
    expect(receipt.manifest.projectionContentHash).toBe(item.sourceBinding.summaryContentHash);
    expect(Object.isFrozen(baseline)).toBe(true);
  });
  it.each(legacy.map((item) => item.caseId))('legacy %s remains an explicit UNSUPPORTED_SHAPE (the rich consumer is not a legacy 1.0.0 consumer), no bytes', async (id) => {
    const item = byId(id);
    const result = await checkPreparedExport({ ok: true, value: receiptOf(item) }, testBuiltExpectation(rich[0]!));
    expect(result).toEqual({ ok: false, kind: 'refused', code: 'UNSUPPORTED_SHAPE', path: '/value' });
  });

  describe('rich negative controls (TEST_BUILT variants of the captured positive, against the same frozen independent baseline)', () => {
    it.each(rich.map((item) => item.caseId))('%s: an equal-length byte change under the declared hash is refused with no bytes, in both files', async (id) => {
      const item = byId(id);
      const baseline = testBuiltExpectation(item);
      const receipt = receiptOf(item);
      const summary = tamperUnderDeclaredHash(receipt, 'summary.json', (content) => content.replace('"accountingPolicyVersion":"ci06-accounting-policy-1.0.0"', '"accountingPolicyVersion":"ci06-accounting-policy-1.0.1"'));
      expect(await checkPreparedExport({ ok: true, value: summary }, baseline)).toMatchObject({ ok: false, kind: 'refused', code: 'CONTENT_MISMATCH', path: '/value/artifacts/0/content' });
      const csv = tamperUnderDeclaredHash(receipt, 'metrics.csv', (content) => content.replace(',partial,', ',partiaX,'));
      const result = await checkPreparedExport({ ok: true, value: csv }, baseline);
      expect(result).toMatchObject({ ok: false, kind: 'refused', code: 'CONTENT_MISMATCH', path: '/value/artifacts/1/content' });
      expect(result).not.toHaveProperty('files');
      // Control: the same baseline accepts the untouched receipt.
      expect((await checkPreparedExport({ ok: true, value: receipt }, baseline)).ok).toBe(true);
    });
    it.each(rich.map((item) => item.caseId))('%s: the same bytes under a changed source binding are refused (same value, different baseline)', async (id) => {
      const item = byId(id);
      const receipt = receiptOf(item);
      const baseline = testBuiltExpectation(item);
      const other = (hash: string) => `sha256:${hash === 'sha256:' + 'f'.repeat(64) ? 'e'.repeat(64) : 'f'.repeat(64)}`;
      expect(await checkPreparedExport({ ok: true, value: receipt }, { ...baseline, snapshotId: other(baseline.snapshotId) })).toMatchObject({ ok: false, code: 'SNAPSHOT_MISMATCH' });
      expect(await checkPreparedExport({ ok: true, value: receipt }, { ...baseline, queryContentHash: other(baseline.queryContentHash) })).toMatchObject({ ok: false, code: 'QUERY_HASH_MISMATCH' });
      expect(await checkPreparedExport({ ok: true, value: receipt }, { ...baseline, summaryContentHash: other(baseline.summaryContentHash) })).toMatchObject({ ok: false, code: 'SUMMARY_HASH_MISMATCH' });
      expect(await checkPreparedExport({ ok: true, value: receipt }, { ...baseline, format: 'csv' })).toMatchObject({ ok: false, code: 'FORMAT_MISMATCH' });
    });
    it('a manifest source field changed while the artifacts stay put is refused, and so are artifacts moved between two captured positives', async () => {
      const [first, second] = [rich[0]!, rich.find((item) => receiptOf(item).manifest.exportId !== receiptOf(rich[0]!).manifest.exportId)!];
      const baseline = testBuiltExpectation(first);
      const changed = clone(receiptOf(first));
      changed.manifest.queryContentHash = receiptOf(second).manifest.queryContentHash;
      expect(await checkPreparedExport({ ok: true, value: changed }, baseline)).toMatchObject({ ok: false, kind: 'refused' });
      const moved = clone(receiptOf(first));
      moved.artifacts = clone(receiptOf(second).artifacts);
      expect(await checkPreparedExport({ ok: true, value: moved }, baseline)).toMatchObject({ ok: false, kind: 'refused', code: 'ARTIFACT_MISMATCH' });
    });
  });
});
