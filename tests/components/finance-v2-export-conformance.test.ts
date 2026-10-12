import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkPreparedExport, type FinanceV2PreparedExpectation } from '../../src/views/finance-v2';
import { inspectPreparedExportStructure as checkStructure } from '../../src/views/finance-v2/export-check';
import { DIR, clone, expectationZero, hasReceipt, json, loadCandidate, ok, pins, receiptZero, sha256, ZERO, type Candidate } from './export-support';

/**
 * SYNTHETIC_EXPORT_CONFORMANCE_ONLY pinned-artifact conformance against the Finance export producer's ACTUAL candidate receipts (producer 0c4c7024, tree 377cd19b, merge ef6dee41,
 * candidate f8e06f3d run 38254570860). 17 receipts / 34 artifact files are pinned byte for byte. Receipt 0 is committed here and always checked; receipts 1..16 are checked as soon as
 * `scripts/prepare-export-conformance.mjs` has written them from the producer packet, and are reported pending (a failure with TD_REQUIRE_EXPORT_FIXTURES=1) until then.
 * Nothing here is a mounted host, a live issuer, CFO delivery or a consumer acceptance, and no producer source is imported or executed.
 */
const required = process.env.TD_REQUIRE_EXPORT_FIXTURES === '1';
const indices = Array.from({ length: 17 }, (_unused, index) => index);
const present = indices.filter(hasReceipt);
const pending = indices.filter((index) => !hasReceipt(index));
const rich = (index: number): boolean => pins.receipts[index]!.schema === 'rich-2.0.0';

/** Expectation for an arbitrary receipt: hashes from the pinned handoff table; scope, period and currencies read from that receipt's own summary.json (receipt 0 is independently literal below). */
function expectationFor(index: number, candidate: Candidate): FinanceV2PreparedExpectation {
  const pin = pins.receipts[index]!;
  const summary = JSON.parse(candidate.receipt.artifacts[0]!.content) as { environment: string; billingMode: string; timezone: string; asOf: string; period: { start: string; end: string }; currencies: { currency: string }[] };
  return {
    snapshotId: pin.snapshotId, queryContentHash: pin.queryContentHash, summaryContentHash: pin.summaryContentHash, format: 'json', environment: summary.environment, billingMode: summary.billingMode,
    asOf: summary.asOf, timezone: summary.timezone, period: summary.period, currencies: summary.currencies.map((entry) => entry.currency),
  };
}

describe('provenance and pins are complete and portable', () => {
  const provenance = json<Record<string, any>>('PROVENANCE.json'); // eslint-disable-line @typescript-eslint/no-explicit-any
  it('states the label, the owner acceptance, the handoff digest and the producer revisions', () => {
    expect(provenance.label).toBe('SYNTHETIC_EXPORT_CONFORMANCE_ONLY');
    expect(provenance.ownerAcceptance).toBe('https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/3#issuecomment-6125399193');
    expect(provenance.handoff.sha256).toBe('410a99fe766a6c0b3b36b696bf73b8f5a46590f9ce9170e9fbe02be3939f59c6');
    expect(provenance.producer).toMatchObject({ originalHead: '0c4c7024c68b5a52a12f3de3cec891f64aa65bd3', tree: '377cd19beeafad222b19cd8e1b057552196f64df', actualMerge: 'ef6dee41fdce642bc1b90a2acb2640226ec699fe', candidateCheckout: 'f8e06f3d9b8c4d98e67b616f869e1392c74b8996', candidateRun: 38254570860, mainRun: 38255883018 });
    expect(provenance.candidateReceipts).toMatchObject({ packetSha256: '6d1995a0091d7d9f2a836ca77b43cbcd86749adf1bb06568dad36ec7a6090da1', receiptCount: 17, artifactFileCount: 34 });
  });
  it('contains no absolute path, host name or credential, so it is portable', () => {
    for (const name of ['PROVENANCE.json', 'candidate-pins.json']) {
      const text = readFileSync(DIR + name, 'utf8');
      expect(text).not.toMatch(/\/private\/|\/tmp\/|\/Users\/|C:\\\\|token|secret|password/iu);
    }
  });
  it('pins 17 receipts and 34 artifact files, with the producer\'s duplicate artifacts intact', () => {
    expect(pins.receipts).toHaveLength(17);
    expect(pins.receipts.map((receipt) => receipt.index)).toEqual(indices);
    expect(pins.receipts.flatMap((receipt) => Object.keys(receipt.files))).toHaveLength(34);
    const same = (a: number, b: number) => expect(pins.receipts[a]!.files).toEqual(pins.receipts[b]!.files);
    same(3, 5); same(6, 8); same(9, 11);
    expect(pins.receipts[0]!.summaryContentHash).toBe(pins.receipts[16]!.summaryContentHash);
    expect(pins.receipts[0]!.queryContentHash).not.toBe(pins.receipts[16]!.queryContentHash);
    expect(pins.receipts.filter((receipt) => receipt.schema === 'legacy-1.0.0').map((receipt) => receipt.index)).toEqual([1]);
  });
  it('the committed pinned schema reference is byte-identical to the handoff pin and is data only', () => {
    const bytes = readFileSync(`${DIR}schemas/ReportingExportManifestSchema.json`);
    expect(sha256(bytes)).toBe('7b101a9f29a6945f7ee86406ed9da4045e50de938420d6f22f1cb1b657cc3fb8');
    expect(bytes.length).toBe(4788);
    expect(provenance.pinnedSourceReferences['schemas/ReportingExportManifestSchema.json'].use).toMatch(/DATA ONLY/u);
  });
});

describe('the committed candidate bytes are exactly the pinned bytes', () => {
  it('receipt 0 is always present', () => { expect(hasReceipt(0)).toBe(true); });
  it.each(present)('receipt %i: both artifacts hash to the pinned sha256 and byte length, and the receipt query binding is the pinned one', (index) => {
    const candidate = loadCandidate(index);
    const pin = pins.receipts[index]!;
    expect(candidate.query).toEqual({ snapshotId: pin.snapshotId, queryContentHash: pin.queryContentHash, summaryContentHash: pin.summaryContentHash });
    for (const name of ['summary.json', 'metrics.csv'] as const) {
      const artifact = candidate.receipt.artifacts.find((item) => item.fileName === name)!;
      const bytes = Buffer.from(artifact.content, 'utf8');
      expect(sha256(bytes)).toBe(pin.files[name]!.sha256);
      expect(bytes.length).toBe(pin.files[name]!.byteLength);
      expect(artifact.contentHash).toBe(`sha256:${pin.files[name]!.sha256}`);
      expect(artifact.byteLength).toBe(pin.files[name]!.byteLength);
    }
  });
  it('reports the receipts still pending the producer-packet copy (a failure when TD_REQUIRE_EXPORT_FIXTURES=1)', () => {
    if (required) expect(pending).toEqual([]);
    else expect(present).toContain(0);
  });
});

describe('the consumer guard against the actual receipts', () => {
  it('receipt 0, with the host\'s independently stated literals, is accepted with the exact delivered strings', async () => {
    const { receipt } = receiptZero();
    const result = await checkPreparedExport(ok(receipt), expectationZero());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.manifest.exportId).toBe('sha256:3d33f92e69e26c63c6047a48c4e1dd7cb49f93798d180c0a35dbc13a636eccf1');
      expect(result.manifest.artifacts).toEqual(receipt.manifest.artifacts);
      expect(result.files.map((file) => file.content)).toEqual(receipt.artifacts.map((artifact) => artifact.content));
    }
  });
  it.each(present.filter(rich))('rich receipt %i is accepted for its own pinned snapshot and refused for every other receipt\'s snapshot', async (index) => {
    const candidate = loadCandidate(index);
    expect((await checkPreparedExport(ok(candidate.receipt), expectationFor(index, candidate))).ok).toBe(true);
    for (const other of present.filter(rich)) {
      if (other === index || pins.receipts[other]!.snapshotId === pins.receipts[index]!.snapshotId) continue;
      const result = await checkPreparedExport(ok(candidate.receipt), expectationFor(other, loadCandidate(other)));
      expect(result.ok).toBe(false);
    }
  });
  it.each(present.filter(rich))('rich receipt %i: preserved currencies, exact signed decimals, nulls and 11 rows per currency', async (index) => {
    const { receipt } = loadCandidate(index);
    const manifest = receipt.manifest;
    const csv = receipt.artifacts[1]!.content;
    const rows = csv.split('\r\n');
    expect(rows.at(-1)).toBe('');
    expect(rows.length - 2).toBe(manifest.itemCount);
    expect(manifest.itemCount).toBe(manifest.currencies.length * 11);
    expect(manifest).toMatchObject({ status: 'prepared', delivery: 'manual_prepared', deliveryReference: null, consumerAcknowledgement: 'pending', canonicalAdoption: 'proposal_only', sourceEvidenceStatus: 'not_exposed_by_query', requestedFormat: 'json' });
    const summary = JSON.parse(receipt.artifacts[0]!.content) as { currencies: { currency: string; scale: number; metrics: { total: unknown; knownSubtotal: unknown; status: string }[] }[]; unavailableMetrics: { metric: string }[] };
    expect(summary.currencies.map((entry) => entry.currency)).toEqual(manifest.currencies);
    expect(summary.unavailableMetrics.map((entry) => entry.metric)).toEqual(['cash_net']);
    for (const entry of summary.currencies) {
      expect(entry.scale).toBe(18);
      // A partial or unknown total is JSON null in the file and an empty CSV cell: never zero.
      for (const metric of entry.metrics) if (metric.status !== 'known') expect(metric.total).toBeNull();
    }
    // The consumer never rewrites the delivered text.
    expect(await checkPreparedExport(ok(receipt), expectationFor(index, loadCandidate(index)))).toMatchObject({ ok: true });
  });
  it.each(present.filter((index) => !rich(index)))('legacy receipt %i is refused by the Finance v2 consumer as UNSUPPORTED_SHAPE, with no bytes', async (index) => {
    const result = await checkPreparedExport(ok(loadCandidate(index).receipt), expectationZero());
    expect(result).toEqual({ ok: false, kind: 'refused', code: 'UNSUPPORTED_SHAPE', path: '/value' });
  });
  it('receipt 16 shares receipt 0\'s projection hash but another query: it cannot stand in for receipt 0', async () => {
    if (!hasReceipt(16)) return;
    expect(await checkPreparedExport(ok(loadCandidate(16).receipt), expectationZero())).toMatchObject({ ok: false, kind: 'refused', code: 'SNAPSHOT_MISMATCH' });
  });
  it('a receipt\'s own copy of its artifacts cannot be recombined: receipt 0 manifest with another receipt\'s files is refused', async () => {
    if (!hasReceipt(2)) return;
    const mixed = clone(receiptZero().receipt);
    mixed.artifacts = clone(loadCandidate(2).receipt.artifacts);
    expect(await checkPreparedExport(ok(mixed), expectationZero())).toMatchObject({ ok: false, kind: 'refused', code: 'ARTIFACT_MISMATCH' });
  });
});

describe('the consumer guard mirrors the pinned producer manifest schema (data only)', () => {
  const schema = json<{ required: string[]; additionalProperties: boolean; properties: Record<string, { const?: unknown; type?: string; anyOf?: { const: string }[]; pattern?: string }> }>('schemas/ReportingExportManifestSchema.json');
  const manifestOf = () => clone(receiptZero().receipt.manifest);
  it('the real manifest has exactly the schema\'s required members, and the schema is closed', () => {
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(manifestOf()).sort()).toEqual([...schema.required].sort());
  });
  it('every const member of the schema holds in the real manifest and is enforced by the guard', () => {
    const consts = Object.entries(schema.properties).filter(([, definition]) => definition.const !== undefined);
    expect(consts.map(([name]) => name)).toEqual(expect.arrayContaining(['schemaVersion', 'sourceEncoding', 'status', 'destination', 'delivery', 'canonicalAdoption', 'definitionsStatus', 'consumerAcknowledgement', 'sourceEvidenceStatus']));
    for (const [name, definition] of consts) {
      expect(receiptZero().receipt.manifest[name]).toBe(definition.const);
      const receipt = clone(receiptZero().receipt);
      receipt.manifest[name] = `${String(definition.const)}-changed`;
      expect(checkStructure(ok(receipt), expectationZero()).ok).toBe(false);
    }
  });
  it('every enum member of the schema is accepted or refused by the guard exactly as the schema says (evidence mode, requested format)', () => {
    const evidence = schema.properties.evidenceMode!.anyOf!.map((entry) => entry.const);
    expect(evidence).toEqual(['mocked', 'sandbox', 'live']);
    for (const value of evidence) {
      const receipt = clone(receiptZero().receipt); receipt.manifest.evidenceMode = value;
      const summary = JSON.parse(receipt.artifacts[0]!.content) as Record<string, unknown>;
      summary.evidenceMode = value;
      receipt.artifacts[0]!.content = `${JSON.stringify(summary)}\n`;
      receipt.artifacts[0]!.byteLength = Buffer.byteLength(receipt.artifacts[0]!.content, 'utf8');
      receipt.manifest.artifacts[0].byteLength = receipt.artifacts[0]!.byteLength;
      // Test-built content under the original declared hashes: structure only (the byte hash is deliberately not what is under test here).
      expect(checkStructure(ok(receipt), expectationZero()).ok).toBe(true);
    }
    const bad = clone(receiptZero().receipt); bad.manifest.evidenceMode = 'production';
    expect(checkStructure(ok(bad), expectationZero()).ok).toBe(false);
    expect(schema.properties.requestedFormat!.anyOf!.map((entry) => entry.const)).toEqual(['json', 'csv']);
  });
  it('every hash-shaped member must match the schema pattern', () => {
    for (const [name, definition] of Object.entries(schema.properties)) {
      if (definition.pattern !== '^sha256:[a-f0-9]{64}$' || name === 'artifacts') continue;
      const receipt = clone(receiptZero().receipt);
      receipt.manifest[name] = 'sha256:not-a-digest';
      expect(checkStructure(ok(receipt), expectationZero()).ok).toBe(false);
    }
  });
});

describe('earlier inputs are untouched', () => {
  const EARLIER: Readonly<Record<string, string>> = {
    'tests/fixtures/finance-v2-conformance/producer-v2-page.json': 'c272b9b8d25f3d73bed228554f95b448d3951bc2bb9b8defcabc4d633249ac3d',
    'tests/fixtures/finance-v2-conformance/producer-budget-v2-page.json': '5887fede39b86791972fcb57f35f549ec5869a2108a4f18a3a07bb7e61abfe85',
    'tests/fixtures/finance-v2-conformance/producer-unknown-simulated-v2-page.json': 'a2fc429439d1a7488ed037ce499acb1d97aaf614997fd1d17afb1bebdfcf4755',
    'tests/fixtures/finance-v2-conformance/producer-v1-page.json': '0b9b7210c515d05af66eea0f48c9fd1b79b737bb60230dcf67b23b4588447be3',
    'tests/fixtures/finance-v2-conformance/ie-ci06-pg-page.json': '4462b866d69c9da2d5f92086f89c6cec8cb898d4af08d9e2ac8e94c9cbb21e03',
    'tests/fixtures/finance-v2-conformance/definition-registry.json': '577ce8801855db08ba393f115c00ac670df3a47a5cc9e9a5a78f8b0132cb34e1',
    'tests/fixtures/finance-v2-pagination-conformance/producer-v2-pagination-page.json': '0b69c52a47e13cb181c0abcf388a15753ed9673dc74b583da0a0d305330e4423',
    'tests/fixtures/finance-v2-pagination-conformance/producer-v2-refusals-page.json': 'eefdaa7f7f55ce9f5340d63e0fe527a63dd12126f9ccf030b950af6fbfe74953',
  };
  it.each(Object.entries(EARLIER))('%s is byte-identical to its earlier pin', (path, digest) => { expect(sha256(readFileSync(path))).toBe(digest); });
  it('the structural prepared-export-request fixture is not committed or relabelled as the actual PostgreSQL request', () => {
    expect(JSON.stringify(json('PROVENANCE.json').notCopied)).toContain('NOT the actual PostgreSQL request');
    expect(() => readFileSync(`${DIR}prepared-export-request.json`)).toThrow();
  });
  it('the Dashboard SDK pin and trust guards are not part of this change', () => {
    const pin = JSON.parse(readFileSync('contracts/shared-contracts.pin.json', 'utf8')) as Record<string, unknown>;
    expect(JSON.stringify(pin)).toContain('0.9.7');
  });
});

describe('ZERO literals agree with the pinned table', () => {
  it('receipt 0 binding in the pins is the one the tests state as host literals', () => {
    expect(pins.receipts[0]).toMatchObject({ snapshotId: ZERO.snapshotId, queryContentHash: ZERO.queryContentHash, summaryContentHash: ZERO.summaryContentHash });
  });
});
