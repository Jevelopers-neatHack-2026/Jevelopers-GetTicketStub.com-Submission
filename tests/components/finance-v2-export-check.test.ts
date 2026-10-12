import { describe, expect, it } from 'vitest';
import { type FinanceV2PreparedExpectation } from '../../src/views/finance-v2';
import { inspectPreparedExportStructure as checkStructure, readCsvRecords } from '../../src/views/finance-v2/export-check';
import { clone, expectationZero, ok, receiptZero, withContent, type Receipt } from './export-support';

/**
 * Adversarial structure and binding tests for the consumer-side prepared-export guard, over the producer's ACTUAL receipt 0 (SYNTHETIC_EXPORT_CONFORMANCE_ONLY). Every defect below is a
 * test-built mutation of that receipt, never producer output. The guard must accept the untouched receipt and must refuse each mutation with a typed code, a path and NO bytes.
 */
const base = (): Receipt => receiptZero().receipt;
const BOM = String.fromCharCode(0xfeff);
const expectRefused = (answer: unknown, code: string, path?: string, expected: FinanceV2PreparedExpectation = expectationZero()) => {
  const result = checkStructure(answer, expected);
  expect(result.ok).toBe(false);
  if (result.ok || result.kind !== 'refused') throw new Error(`expected a refusal, got ${JSON.stringify(result).slice(0, 200)}`);
  expect(result.code).toBe(code);
  if (path !== undefined) expect(result.path).toBe(path);
  expect(Object.keys(result).sort()).toEqual(['code', 'kind', 'ok', 'path']);
};

describe('accepts the actual producer receipt exactly', () => {
  it('returns the delivered manifest fields and the exact artifact strings, unchanged', () => {
    const receipt = base();
    const result = checkStructure(ok(receipt), expectationZero());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest).toMatchObject({ exportId: receipt.manifest.exportId, createdAt: '2026-10-12T22:00:00.000Z', status: 'prepared', delivery: 'manual_prepared', deliveryReference: null, requestedFormat: 'json', itemCount: 11, currencies: ['USD'] });
    expect(result.files.map((file) => file.fileName)).toEqual(['summary.json', 'metrics.csv']);
    expect(result.files[0]!.content).toBe(receipt.artifacts[0]!.content);
    expect(result.files[1]!.content).toBe(receipt.artifacts[1]!.content);
    expect(result.files[1]!.content).toContain('\r\n');
  });
  it('preserves the delivered null unknown totals, exact signed decimals and separate simulated rows verbatim (no arithmetic, no rounding, no zero)', () => {
    const csv = base().artifacts[1]!.content;
    expect(csv).toContain(',contribution,actual,net_sales - direct_costs,partial,-1.000000000000000000,,0,');
    expect(csv).toContain('gross_sales,actual,"recognized actual sale magnitudes before discount and refund, excluding tax",unknown,,,0,');
    expect(csv.split('\r\n').filter((line) => line.includes(',simulated,'))).toHaveLength(4);
    const summary = JSON.parse(base().artifacts[0]!.content) as { unavailableMetrics: unknown[]; currencies: { metrics: { metric: string; total: unknown }[] }[] };
    expect(summary.unavailableMetrics).toEqual([{ knownSubtotal: null, metric: 'cash_net', status: 'not_supplied_by_query', total: null }]);
    expect(summary.currencies[0]!.metrics.every((metric) => metric.total === null)).toBe(true);
    const result = checkStructure(ok(base()), expectationZero());
    expect(result.ok && result.files[1]!.content).toBe(csv);
  });
});

describe('binding to what the host stated', () => {
  const cases: readonly (readonly [string, Partial<FinanceV2PreparedExpectation>, string, string])[] = [
    ['a different snapshot', { snapshotId: `sha256:${'1'.repeat(64)}` }, 'SNAPSHOT_MISMATCH', '/value/manifest/snapshotId'],
    ['a different query hash', { queryContentHash: `sha256:${'2'.repeat(64)}` }, 'QUERY_HASH_MISMATCH', '/value/manifest/queryContentHash'],
    ['a different summary hash', { summaryContentHash: `sha256:${'3'.repeat(64)}` }, 'SUMMARY_HASH_MISMATCH', '/value/manifest/projectionContentHash'],
    ['a different format (receipt prepared for json, csv expected)', { format: 'csv' }, 'FORMAT_MISMATCH', '/value/manifest/requestedFormat'],
    ['a different period start', { period: { start: '2026-10-09T00:00:00.000Z', end: '2026-10-11T00:00:00.000Z' } }, 'PERIOD_MISMATCH', '/value/manifest/period'],
    ['a different timezone', { timezone: 'Europe/Berlin' }, 'PERIOD_MISMATCH', '/value/manifest/period'],
    ['an extra expected currency', { currencies: ['USD', 'EUR'] }, 'CURRENCY_MISMATCH', '/value/manifest/currencies'],
    ['a different currency', { currencies: ['EUR'] }, 'CURRENCY_MISMATCH', '/value/manifest/currencies'],
    ['a different environment (the artifacts say test)', { environment: 'production' }, 'SCOPE_MISMATCH', '/artifacts/0/content/environment'],
    ['a different billing mode (the artifacts say live)', { billingMode: 'simulated' }, 'SCOPE_MISMATCH', '/artifacts/0/content/environment'],
    ['a different snapshot as-of', { asOf: '2026-10-12T21:00:00.000Z' }, 'SNAPSHOT_MISMATCH', '/artifacts/0/content/asOf'],
  ];
  it.each(cases)('refuses %s, with no bytes', (_name, over, code, path) => { expectRefused(ok(base()), code, path, expectationZero(over)); });
  it('compares instants, not spellings: the same moment written with an offset is the same period', () => {
    const result = checkStructure(ok(base()), expectationZero({ period: { start: '2026-10-10T02:00:00.000+02:00', end: '2026-10-11T02:00:00.000+02:00' } }));
    expect(result.ok).toBe(true);
  });
  it('refuses an unparseable host expectation instead of matching it', () => {
    expectRefused(ok(base()), 'PERIOD_MISMATCH', undefined, expectationZero({ period: { start: 'yesterday', end: 'today' } }));
  });
  it('refuses a receipt for another snapshot even though it is internally consistent (the receipt cannot vouch for its own binding)', () => {
    const other = clone(base());
    other.manifest.snapshotId = `sha256:${'a'.repeat(64)}`;
    expectRefused(ok(other), 'SNAPSHOT_MISMATCH', '/value/manifest/snapshotId');
  });
});

describe('closed shape: nothing invented, nothing missing', () => {
  it.each([
    ['null', null], ['a string', 'prepared'], ['an array', []], ['an empty object', {}], ['ok as a string', { ok: 'true', value: base() }],
  ])('refuses %s', (_name, answer) => { expectRefused(answer, 'INVALID_SHAPE'); });
  it('refuses an extra member of the envelope, receipt, manifest, artifact and artifact reference', () => {
    expectRefused({ ...ok(base()), extra: 1 }, 'INVALID_SHAPE', '/');
    expectRefused(ok({ ...base(), extra: 1 }), 'INVALID_SHAPE', '/value');
    const manifest = clone(base()); manifest.manifest.invented = 'x';
    expectRefused(ok(manifest), 'INVALID_SHAPE', '/value/manifest');
    const artifact = clone(base()); (artifact.artifacts[0] as Record<string, unknown>).invented = 'x';
    expectRefused(ok(artifact), 'INVALID_SHAPE', '/value/artifacts/0');
    const reference = clone(base()); reference.manifest.artifacts[0].invented = 'x';
    expectRefused(ok(reference), 'INVALID_SHAPE', '/value/manifest/artifacts/0');
  });
  it('refuses every missing manifest member', () => {
    for (const key of Object.keys(base().manifest)) {
      const next = clone(base()); delete next.manifest[key];
      expectRefused(ok(next), 'INVALID_SHAPE', '/value/manifest');
    }
  });
  it('refuses the legacy receipt shape (manifest + artifactManifest + artifacts) because a Finance v2 page can only be exported as the rich 2.0.0 receipt', () => {
    const legacy = { manifest: { schemaVersion: '1.0.0' }, artifactManifest: { schemaVersion: '2.0.0' }, artifacts: [] };
    expectRefused(ok(legacy), 'UNSUPPORTED_SHAPE', '/value');
  });
  it('refuses another receipt version', () => { expectRefused(ok({ ...base(), schemaVersion: '3.0.0' }), 'UNSUPPORTED_SHAPE', '/value/schemaVersion'); });
  it.each([
    ['accessor property', () => { const value = clone(base()); Object.defineProperty(value, 'schemaVersion', { get: () => '2.0.0', enumerable: true }); return value; }],
    ['non-plain prototype', () => Object.assign(Object.create({ inherited: true }) as object, clone(base()))],
    ['symbol member', () => { const value = clone(base()); Object.defineProperty(value, Symbol('s'), { value: 1, enumerable: true }); return value; }],
    ['throwing proxy', () => new Proxy({}, { ownKeys() { throw new Error('trap'); }, getPrototypeOf() { throw new Error('trap'); } })],
  ])('refuses a %s without throwing', (_name, make) => { expect(() => checkStructure(ok(make()), expectationZero())).not.toThrow(); expectRefused(ok(make()), 'INVALID_SHAPE'); });
});

describe('honest status: prepared and manual_prepared, never delivered', () => {
  it.each([
    ['status delivered', 'status', 'delivered', 'UNSUPPORTED_STATUS'], ['status failed', 'status', 'failed', 'UNSUPPORTED_STATUS'], ['delivery delivered', 'delivery', 'delivered', 'UNSUPPORTED_STATUS'],
    ['another destination', 'destination', 'cfo.example', 'INVALID_SHAPE'], ['a claimed consumer acknowledgement', 'consumerAcknowledgement', 'accepted', 'INVALID_SHAPE'],
    ['a claimed canonical adoption', 'canonicalAdoption', 'adopted', 'INVALID_SHAPE'], ['approved definitions', 'definitionsStatus', 'approved', 'INVALID_SHAPE'],
    ['a claimed source evidence status', 'sourceEvidenceStatus', 'attested', 'INVALID_SHAPE'], ['another source encoding', 'sourceEncoding', '1.0.0', 'INVALID_SHAPE'],
  ])('refuses %s', (_name, key, value, code) => {
    const next = clone(base()); next.manifest[key] = value;
    expectRefused(ok(next), code, `/value/manifest/${key}`);
  });
  it('refuses any delivery reference, even a non-empty string', () => {
    const next = clone(base()); next.manifest.deliveryReference = 'cfo-ref-1';
    expectRefused(ok(next), 'UNSUPPORTED_STATUS', '/value/manifest/deliveryReference');
  });
});

describe('manifest ↔ delivered artifacts', () => {
  it('refuses a swapped artifact order, a wrong media type and a renamed file', () => {
    const swapped = clone(base()); swapped.artifacts.reverse(); swapped.manifest.artifacts.reverse();
    expectRefused(ok(swapped), 'ARTIFACT_MISMATCH', '/value/artifacts/0');
    const media = clone(base()); media.artifacts[1]!.mediaType = 'text/plain'; media.manifest.artifacts[1].mediaType = 'text/plain';
    expectRefused(ok(media), 'ARTIFACT_MISMATCH', '/value/artifacts/1');
    const renamed = clone(base()); renamed.artifacts[0]!.fileName = 'other.json'; renamed.manifest.artifacts[0].fileName = 'other.json';
    expectRefused(ok(renamed), 'ARTIFACT_MISMATCH', '/value/artifacts/0');
  });
  it('refuses a delivered artifact whose hash or length differs from the manifest reference', () => {
    const hash = clone(base()); hash.artifacts[0]!.contentHash = `sha256:${'0'.repeat(64)}`;
    expectRefused(ok(hash), 'ARTIFACT_MISMATCH', '/value/artifacts/0/contentHash');
    const length = clone(base()); length.artifacts[1]!.byteLength += 1;
    expectRefused(ok(length), 'ARTIFACT_MISMATCH', '/value/artifacts/1/byteLength');
  });
  it('refuses a malformed hash and an out-of-bounds length', () => {
    const hash = clone(base()); hash.manifest.artifacts[0].contentHash = 'sha256:short'; hash.artifacts[0]!.contentHash = 'sha256:short';
    expectRefused(ok(hash), 'INVALID_SHAPE', '/value/manifest/artifacts/0/contentHash');
    const big = clone(base()); big.manifest.artifacts[0].byteLength = 1_048_577; big.artifacts[0]!.byteLength = 1_048_577;
    expectRefused(ok(big), 'INVALID_SHAPE', '/value/manifest/artifacts/0/byteLength');
  });
  it('refuses one artifact, three artifacts and empty content', () => {
    const one = clone(base()); one.artifacts.pop(); expectRefused(ok(one), 'ARTIFACT_MISMATCH', '/value/artifacts');
    const three = clone(base()); three.artifacts.push(clone(three.artifacts[0]!)); expectRefused(ok(three), 'INVALID_SHAPE', '/value/artifacts');
    const empty = clone(base()); empty.artifacts[0]!.content = ''; expectRefused(ok(empty), 'INVALID_SHAPE', '/value/artifacts/0/content');
  });
  it('refuses delivered text that is not exactly the declared number of UTF-8 bytes (a multi-byte substitution of equal character count)', () => {
    const next = clone(base());
    next.artifacts[0]!.content = next.artifacts[0]!.content.replace('"UTC"', '"UTÇ"');
    expectRefused(ok(next), 'CONTENT_MISMATCH', '/value/artifacts/0/content');
  });
  it('refuses an item count that is not eleven rows per delivered currency', () => {
    const next = clone(base()); next.manifest.itemCount = 10;
    expectRefused(ok(next), 'CURRENCY_MISMATCH', '/value/manifest/itemCount');
  });
  it('refuses duplicate or malformed currencies', () => {
    const duplicate = clone(base()); duplicate.manifest.currencies = ['USD', 'USD']; expectRefused(ok(duplicate), 'INVALID_SHAPE', '/value/manifest/currencies');
    const lower = clone(base()); lower.manifest.currencies = ['usd']; expectRefused(ok(lower), 'INVALID_SHAPE', '/value/manifest/currencies/0');
  });
});

describe('summary.json content is bound to the same snapshot', () => {
  const tamper = (change: (doc: Record<string, any>) => void): Receipt => withContent(base(), 'summary.json', (content) => { const doc = JSON.parse(content) as Record<string, any>; change(doc); return `${JSON.stringify(doc)}\n`; }); // eslint-disable-line @typescript-eslint/no-explicit-any
  it.each([
    ['snapshot id', (doc: Record<string, any>) => { doc.provenance.snapshotId = `sha256:${'b'.repeat(64)}`; }, 'SNAPSHOT_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['query hash', (doc: Record<string, any>) => { doc.provenance.queryContentHash = `sha256:${'b'.repeat(64)}`; }, 'QUERY_HASH_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['projection hash', (doc: Record<string, any>) => { doc.provenance.projectionContentHash = `sha256:${'b'.repeat(64)}`; }, 'SUMMARY_HASH_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['environment', (doc: Record<string, any>) => { doc.environment = 'production'; }, 'SCOPE_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['period', (doc: Record<string, any>) => { doc.period.end = '2026-10-12T00:00:00.000Z'; }, 'PERIOD_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['currency block set', (doc: Record<string, any>) => { doc.currencies[0].currency = 'EUR'; }, 'CURRENCY_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['evidence mode label', (doc: Record<string, any>) => { doc.evidenceMode = 'live'; }, 'CONTENT_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['kind', (doc: Record<string, any>) => { doc.kind = 'something_else'; }, 'CONTENT_MISMATCH'], // eslint-disable-line @typescript-eslint/no-explicit-any
  ])('refuses a changed %s inside summary.json', (_name, change, code) => { expectRefused(ok(tamper(change)), code); });
  it('refuses invalid JSON, a BOM, and a missing final line feed', () => {
    expectRefused(ok(withContent(base(), 'summary.json', () => '{"broken":\n')), 'CONTENT_MISMATCH');
    expectRefused(ok(withContent(base(), 'summary.json', (content) => `${BOM}${content}`)), 'CONTENT_MISMATCH');
    expectRefused(ok(withContent(base(), 'summary.json', (content) => content.slice(0, -1))), 'CONTENT_MISMATCH');
  });
});

describe('metrics.csv content is bound to the same snapshot', () => {
  const swap = (from: string, to: string) => withContent(base(), 'metrics.csv', (content) => content.replace(from, to));
  it('refuses a changed header, projection hash, query hash, period, timezone, environment and billing mode in a single row', () => {
    expectRefused(ok(swap('currency,scale,metric', 'currency,scale,metrics')), 'CONTENT_MISMATCH', '/artifacts/1/content/header');
    expectRefused(ok(swap(`${'sha256:366c764516c4222767479897b26d7d4fd99c37c2bce7115fb213b987aa227755'},`, `sha256:${'c'.repeat(64)},`)), 'SUMMARY_HASH_MISMATCH');
    expectRefused(ok(swap(`,${'sha256:c37d31cd096f650a79c33b74a865ca5c4b67808e8ad2812e1e69a199293615c7'}\r\n`, `,sha256:${'d'.repeat(64)}\r\n`)), 'QUERY_HASH_MISMATCH');
    expectRefused(ok(swap('2026-10-11T00:00:00.000Z', '2026-10-12T00:00:00.000Z')), 'PERIOD_MISMATCH');
    expectRefused(ok(swap(',UTC,test,live,', ',CET,test,live,')), 'PERIOD_MISMATCH');
    expectRefused(ok(swap(',UTC,test,live,', ',UTC,production,live,')), 'SCOPE_MISMATCH');
    expectRefused(ok(swap(',UTC,test,live,', ',UTC,test,sandbox,')), 'SCOPE_MISMATCH');
  });
  it('refuses a row for a currency the manifest does not list, a short row and a changed row count', () => {
    expectRefused(ok(swap('\r\nUSD,18,gross_sales', '\r\nEUR,18,gross_sales')), 'CURRENCY_MISMATCH');
    expectRefused(ok(swap('partial,6.000000000000000000,,0,', 'partial,6.000000000000000000,0,')), 'CONTENT_MISMATCH');
    expectRefused(ok(withContent(base(), 'metrics.csv', (content) => content.split('\r\n').slice(0, -2).join('\r\n') + '\r\n')), 'CONTENT_MISMATCH', '/artifacts/1/content/rows');
  });
  it('refuses a BOM, bare LF records, a missing final CRLF and an unterminated quote', () => {
    expectRefused(ok(withContent(base(), 'metrics.csv', (content) => `${BOM}${content}`)), 'CONTENT_MISMATCH');
    expectRefused(ok(withContent(base(), 'metrics.csv', (content) => content.replaceAll('\r\n', '\n'))), 'CONTENT_MISMATCH');
    expectRefused(ok(withContent(base(), 'metrics.csv', (content) => content.slice(0, -2))), 'CONTENT_MISMATCH');
    expectRefused(ok(withContent(base(), 'metrics.csv', (content) => content.replace('"actual direct,', 'actual direct,"'))), 'CONTENT_MISMATCH');
  });
  it('reads quoted commas, doubled quotes and embedded line breaks as single fields, and refuses malformed quoting', () => {
    expect(readCsvRecords('a,"b,c","d""e","f\r\ng"\r\n')).toEqual([['a', 'b,c', 'd"e', 'f\r\ng']]);
    expect(readCsvRecords('a,b\r\n,\r\n')).toEqual([['a', 'b'], ['', '']]);
    for (const bad of ['a,b', 'a,b\n', 'a,"b\r\n', 'a,b"c"\r\n', 'a,"b"c\r\n', 'a\rb\r\n']) expect(readCsvRecords(bad)).toBeUndefined();
  });
});

describe('typed producer failures carry no bytes and echo nothing', () => {
  it.each(['SOURCE_UNAVAILABLE', 'FORBIDDEN_SCOPE', 'IDEMPOTENCY_CONFLICT', 'VALIDATION_ERROR', 'UNSUPPORTED_VERSION'])('returns only the closed code %s', (code) => {
    const answer = { ok: false, error: { code, safe_message: 'CANARY-SAFE-MESSAGE-do-not-show', nested: { password: 'CANARY' } } };
    const result = checkStructure(answer, expectationZero());
    expect(result).toEqual({ ok: false, kind: 'error', code });
    expect(JSON.stringify(result)).not.toContain('CANARY');
  });
  it('refuses an unknown error code, a missing error, and a failure that also carries a value or bytes', () => {
    expectRefused({ ok: false, error: { code: 'EVERYTHING_FINE' } }, 'INVALID_SHAPE', '/error/code');
    expectRefused({ ok: false, error: { code: 42 } }, 'INVALID_SHAPE', '/error/code');
    expectRefused({ ok: false, error: null }, 'INVALID_SHAPE', '/error/code');
    expectRefused({ ok: false, error: { code: 'SOURCE_UNAVAILABLE' }, value: base() }, 'INVALID_SHAPE', '/');
    expectRefused({ ok: false, error: { code: 'SOURCE_UNAVAILABLE' }, artifacts: base().artifacts }, 'INVALID_SHAPE', '/');
  });
  it('does not authorize anything from a success that is also an error', () => {
    expectRefused({ ok: true, value: base(), error: { code: 'SOURCE_UNAVAILABLE' } }, 'INVALID_SHAPE', '/');
  });
});
