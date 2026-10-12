import { readFileSync } from 'node:fs';
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
import { clone, loadCandidate, pins, receiptZero, tamperUnderDeclaredHash, type Receipt } from './export-support';

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
  it('the two namespaces are separate: the new capture is not the earlier 410a packet and is never read from its directory', () => {
    expect(DENIAL_DIR).toBe('tests/fixtures/export-denial-conformance/');
    expect(DENIAL_DIR).not.toBe('tests/fixtures/export-conformance/');
    expect(sha256(captureBytes())).not.toBe(sha256(readFileSync('tests/fixtures/export-conformance/candidate-pins.json')));
  });
});

/**
 * Independent literal hash pairs per receipt index: [index, old summary, new summary, old metrics, new metrics]. `old` is the earlier 410a packet (tests/fixtures/export-conformance);
 * `new` is the fresh 3e8 capture. They were audited outside this repo and are stated here so neither side can be derived from the other. The new financial receipts are the same case
 * FAMILY (17 receipts / 34 files) as the old ones, NOT the same bytes: 16 of 17 receipt objects and 32 of 34 artifact contents differ. Only index 15 is byte-identical.
 */
const PAIRS: [number, string, string, string, string][] = [
  [0, '9129ef4a88437e70d7c7da85c8ad36d5ce3c9569a66aa779a4e694ee1f1a1353', 'c5d28fe07174e45577d507bb6b31472e38d10f7c17e9681027c9a843af823e9a', '38fd0ac898825be6547fe5a014595c06665b7f6ea95cffc28bfffe99dbb31132', '4760d7888998024f8324d0968b4cadd014e6fec474b87635c4542bc4693175f2'],
  [1, '0fc1062106526bc110f57cfc96e28b4a9e7d9e4a5f4c8e36903f60b99e81efd1', '7dbdd8f4f0fe1c468ff521d4fcd9264c1d498cb31da22e48684a38bf17db90e1', '5f39afd6302a7b81f6213e3674e39252ca10be722a22ab69827901537e23fde5', 'ab4f2b6e678b9954feefbb15fd571d5f8498d6e6b29c0357e61b231b5a1d7b6f'],
  [2, 'd4f57533aa6e382eb2b8afadace1a8e5c4fd5c8dcb3f2548eb247860990e133e', '94260ddfb6a257b109e8208353f5bc99f9f4451ca597244bc5b0bc8c333b5446', '481883402042b7b0333e4ed2394049cd2d47edf80372ffd941935428eaf60d60', 'b01c6a15c79a2943f9b84d8fa5c5d8f0424ff967c773d7f3d26a211ef6b03490'],
  [3, '8eb7d7bcae89fea453bb3d45fe7099aa92b5c1595e33248ec65728551a530b2a', '75736d22873d6b0af3fbbcb608aaa134db959aedf4166f9234ea02a0947fd02a', '5f90a7a5e416221dbdbf97ee04454331a0f3ea653477e83da30369cf551e1d63', 'fabfef641a5aa398a8f315507b4289319c2ecf78803dc55bd02f324b18b5fbcb'],
  [4, '27c2d089d868f3e616f7ce002a1ceab1c46b1268eb123057a93e814a3e06a950', '91ae06e02b91a265aa37fc34e4778e27816a8de7bba81ba54b7403e583091040', '2a003adec10ee33a4058510bd0842e9bcb2a59ad391bfa80f0e20336601a437a', '5925b5ab5ba768361b41e9d3e26442eaaf56df403fb07db039edb407ce6c2828'],
  [5, '8eb7d7bcae89fea453bb3d45fe7099aa92b5c1595e33248ec65728551a530b2a', '75736d22873d6b0af3fbbcb608aaa134db959aedf4166f9234ea02a0947fd02a', '5f90a7a5e416221dbdbf97ee04454331a0f3ea653477e83da30369cf551e1d63', 'fabfef641a5aa398a8f315507b4289319c2ecf78803dc55bd02f324b18b5fbcb'],
  [6, '77af36063deb1504b2aa1977e964fa28b5a2618d4db2d6c7c8513b635478cfb3', 'aea295d029d372a10ef2e45a5644d90ce737cb65f77da2ef06472eb23c75b16d', 'aed0162b3db1e9bf1454c4695603fba0153f80d6cfc08d2373cd6593d1d7fb19', 'c385fe7b216330b8554df25ff0a93adee175a4bdc9826c2fa809c58991bafa5f'],
  [7, '44629648f9668620c82a08cc2d1be9d6244fdaddfb23bb43c45bdaa780041056', '6fedc87b73876ca1c3adcc7ef85771d1684580b23ce5fc0a2d4c35d86ffcd081', '9927481de4970f46e8b0c5b733f9e97edb80c26d85e44c8f3aed016f88b9b50c', '388cee2e22ac03613155252d08770d07b84addf5b93eba7ea5b9272133ead9b8'],
  [8, '77af36063deb1504b2aa1977e964fa28b5a2618d4db2d6c7c8513b635478cfb3', 'aea295d029d372a10ef2e45a5644d90ce737cb65f77da2ef06472eb23c75b16d', 'aed0162b3db1e9bf1454c4695603fba0153f80d6cfc08d2373cd6593d1d7fb19', 'c385fe7b216330b8554df25ff0a93adee175a4bdc9826c2fa809c58991bafa5f'],
  [9, 'c694bdb2e75fb338971b1d84d5e9b03653f864163c2434c9d5c1b5ff901c0ae8', 'd3c2aba1f42411e92af84ed639e35327c2243f148ec96d991a3fc9205f32109c', 'b4da4df1f363a17476d2ae46b0c7100aaef1ddf1d84105c689d4cd1eccb185b7', '62178a19968bc3983f3e1452434cfd013713baf546fa2dfc6e44d51e4175a84e'],
  [10, '7891bd3cd60740d8eb5cee5497902460e5bef8be2884714e58b39412faa4eae6', 'c73dacef10c1565868e6478ae46c28d68e09c91ccdb25c11bd85ced69a14131c', '952ad8f7b93ab73a8a08e8889ef47f6e3b968223568050a7e6deb41b9dc41625', '086ff991cbe2be6af7a1d2e4ab1ea12ce41a49d779ac279839568dab5a2903c7'],
  [11, 'c694bdb2e75fb338971b1d84d5e9b03653f864163c2434c9d5c1b5ff901c0ae8', 'd3c2aba1f42411e92af84ed639e35327c2243f148ec96d991a3fc9205f32109c', 'b4da4df1f363a17476d2ae46b0c7100aaef1ddf1d84105c689d4cd1eccb185b7', '62178a19968bc3983f3e1452434cfd013713baf546fa2dfc6e44d51e4175a84e'],
  [12, '4252325052b278fa4dd46224fc0047388a051783442a9de96031085c21c1d98a', '1401bb0003e05e39bf4676de7ddae807fdb760fd1028be577964683a3b068a7b', '167d915ddea252cbdf319ff61afb1f3e41808a3804ba1afe74f6bce2eb975672', '82026022c3be3698932d54d292274fd4b97bea9361a1536c7ac2e32efc6ebc03'],
  [13, '698e9eff7a742e2bddf76a5006351e4dc8a118353ee9c56cbbf4365d2a3b5f48', '07440f8fa04c62be9be1bb9c1d8645adf7ce2cc668ebac979e2abc37828693c5', '3ddff7b90c2ce5e8214ff754a3b03c5af0f5a1b29a1536d83798ca7821a3ca49', 'fbab797f618331a5de234739b9bdfda96c7b4e8297ea94c2d67304230796ac75'],
  [14, '2ac5de361b7a3a8007186f925c053da420e40bbf372167ab82425ccb46cdc18a', 'fdbea9632e681d23f47ce2a3facce1e36b1ddd3a4bd2805cdba584e0b15801c7', '92bbe1e12cd7b64bd42c38fa7cd68857d88ea1c6926aa2598f1b600ef054f1bc', 'a71945f7c284b3c8108d7ad0860e4bb2b3587c9869490765de487fd21a66a8f5'],
  [15, 'd45c7ead7344c213f73b0810b24de13517e792229e91f9b522dc84b2232269aa', 'd45c7ead7344c213f73b0810b24de13517e792229e91f9b522dc84b2232269aa', 'a390bef17eadd74474aed6ba0230edaaa03f74ca02530e54b36f7c8db653fb82', 'a390bef17eadd74474aed6ba0230edaaa03f74ca02530e54b36f7c8db653fb82'],
  [16, 'a46cd249adceea653fd5e24afc94115d6c969b95599375abb5865f410ebfbd4a', '06411e172d89a04ea9633047720c44f7372808a1da30cd09dc8328401d49faf6', '00564e7f3c956b9c9ee15d3a6c2a0fca6e39385f7b914ecab3bff6f00e88fe54', 'fe1f35894eb2d18f9bedd2ac9932814526776956ec6a5b2cf3aa103989145467'],
];
const SAME_INDEX = 15;

describe('old 410a packet and new 3e8 capture: same 17-receipt family, DIFFERENT bytes (except receipt 15), each namespace pinned separately', () => {
  const oldPins = pins.receipts;
  const fresh = capture().receipts;
  const contentOf = (receipt: Receipt, name: string) => receipt.artifacts.find((artifact) => artifact.fileName === name)!;

  it('each side has exactly 17 receipts and 34 files, read from its own namespace', () => {
    expect(oldPins).toHaveLength(17);
    expect(fresh).toHaveLength(17);
    expect(PAIRS).toHaveLength(17);
    for (let index = 0; index < 17; index += 1) {
      expect(loadCandidate(index).receipt.artifacts.map((artifact) => artifact.fileName)).toEqual(['summary.json', 'metrics.csv']);
      expect(fresh[index]!.receipt.artifacts.map((artifact) => artifact.fileName)).toEqual(['summary.json', 'metrics.csv']);
    }
  });
  it.each(PAIRS)('receipt %i: the OLD side matches the old pins and the old fixture file, with the old literal hashes', (index, oldSummary, _newSummary, oldMetrics) => {
    const pin = oldPins[index]!;
    expect(pin.files['summary.json']!.sha256).toBe(oldSummary);
    expect(pin.files['metrics.csv']!.sha256).toBe(oldMetrics);
    const old = loadCandidate(index).receipt;
    expect(sha256(Buffer.from(contentOf(old, 'summary.json').content, 'utf8'))).toBe(oldSummary);
    expect(sha256(Buffer.from(contentOf(old, 'metrics.csv').content, 'utf8'))).toBe(oldMetrics);
  });
  it.each(PAIRS)('receipt %i: the NEW side matches the committed capture with the new literal hashes (computed from the capture bytes, not from the old pins)', (index, _oldSummary, newSummary, _oldMetrics, newMetrics) => {
    const receipt = fresh[index]!.receipt;
    for (const [name, expected] of [['summary.json', newSummary], ['metrics.csv', newMetrics]] as const) {
      const artifact = contentOf(receipt, name);
      const bytes = Buffer.from(artifact.content, 'utf8');
      expect(sha256(bytes)).toBe(expected);
      expect(artifact.contentHash).toBe(`sha256:${expected}`);
      expect(artifact.byteLength).toBe(bytes.length);
    }
  });
  it.each(PAIRS)('receipt %i: old and new are compared object-for-object and file-for-file, and differ exactly where audited', (index, oldSummary, newSummary, oldMetrics, newMetrics) => {
    const old = loadCandidate(index).receipt;
    const next = fresh[index]!.receipt;
    const same = index === SAME_INDEX;
    expect(JSON.stringify(old) === JSON.stringify(next), 'receipt object').toBe(same);
    expect(contentOf(old, 'summary.json').content === contentOf(next, 'summary.json').content, 'summary.json contents').toBe(same);
    expect(contentOf(old, 'metrics.csv').content === contentOf(next, 'metrics.csv').content, 'metrics.csv contents').toBe(same);
    expect(oldSummary === newSummary, 'summary hash pair').toBe(same);
    expect(oldMetrics === newMetrics, 'metrics hash pair').toBe(same);
  });
  it('totals: 16 of 17 receipt objects and 32 of 34 artifact contents differ; exactly 1 object and 2 artifacts match (receipt 15)', () => {
    let objects = 0;
    let artifacts = 0;
    const matching: string[] = [];
    for (let index = 0; index < 17; index += 1) {
      const old = loadCandidate(index).receipt;
      const next = fresh[index]!.receipt;
      if (JSON.stringify(old) !== JSON.stringify(next)) objects += 1;
      for (const name of ['summary.json', 'metrics.csv']) {
        if (contentOf(old, name).content !== contentOf(next, name).content) artifacts += 1;
        else matching.push(`${index}:${name}`);
      }
    }
    expect(objects).toBe(16);
    expect(artifacts).toBe(32);
    expect(matching).toEqual([`${SAME_INDEX}:summary.json`, `${SAME_INDEX}:metrics.csv`]);
  });
  it('rejects accidental aliasing: old data standing in for new (or the reverse) fails, and the fresh side is not the old packet', () => {
    for (const [index] of PAIRS) {
      if (index === SAME_INDEX) continue;
      const old = loadCandidate(index).receipt;
      const next = fresh[index]!.receipt;
      expect(old.artifacts[0]!.contentHash).not.toBe(next.artifacts[0]!.contentHash);
      expect(sha256(Buffer.from(old.artifacts[0]!.content, 'utf8'))).not.toBe(sha256(Buffer.from(next.artifacts[0]!.content, 'utf8')));
      expect(old.artifacts[1]!.contentHash).not.toBe(next.artifacts[1]!.contentHash);
    }
    // The whole new capture is not the old packet: no old pinned hash set equals the fresh one.
    const oldSet = new Set(oldPins.flatMap((pin) => Object.values(pin.files).map((file) => file.sha256)));
    const freshSet = new Set(fresh.flatMap((entry) => entry.receipt.artifacts.map((artifact) => artifact.contentHash.slice(7))));
    expect([...freshSet].filter((hash) => oldSet.has(hash)).sort()).toEqual(['a390bef17eadd74474aed6ba0230edaaa03f74ca02530e54b36f7c8db653fb82', 'd45c7ead7344c213f73b0810b24de13517e792229e91f9b522dc84b2232269aa']);
  });
  it('the old namespace is still the original 410a packet: 17 pinned receipts, 34 pinned files, untouched by the new capture', () => {
    expect(oldPins.reduce((sum, pin) => sum + Object.keys(pin.files).length, 0)).toBe(34);
    expect(oldPins.map((pin) => pin.index)).toEqual([...Array(17).keys()]);
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
