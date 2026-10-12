/**
 * Consumer-side structural guard for ONE prepared-export answer (`{ok:true,value}` or `{ok:false,error}`) from a host-injected export port.
 *
 * It is NOT the producer validator and not a canonical schema: the host port owns canonical validation and its own coherent authority fence. This guard only refuses what the
 * Dashboard could not hand to a person faithfully: a wrong or invented shape, a status other than `prepared` / `manual_prepared`, anything not bound to the snapshot, hashes, format,
 * period, timezone, environment, billing mode and currencies the HOST stated independently of the answer, and bytes whose encoding or record structure is not what the manifest says.
 * Strings are compared for equality; nothing is signed, summed, converted or re-encoded here, and no CSV is generated. The structural step is internal and never an accepted result; the public
 * `checkPreparedExport` also verifies each delivered file's declared SHA-256 over its exact bytes (content integrity only, not host authentication or financial authority), and
 * `usePreparedExport` never keeps or offers bytes that failed it. Whatever fails yields no bytes at all.
 *
 * The pinned producer manifest (`ReportingExportManifest@2.0.0`) is mirrored here as data (closed key set and constants); `tests/components/finance-v2-export-conformance.test.tsx`
 * compares these constants with the committed, digest-pinned producer schema and with the committed candidate artifacts. Nothing from the producer repository is imported.
 */
const HASH = /^sha256:[a-f0-9]{64}$/u;
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(?:Z|[+-]\d{2}:\d{2})$/u;
const CURRENCY = /^[A-Z]{3}$/u;
export const FINANCE_V2_EXPORT_MAX_BYTES = 1_048_576;

export const FINANCE_V2_EXPORT_ERROR_CODES = ['SOURCE_UNAVAILABLE', 'FORBIDDEN_SCOPE', 'IDEMPOTENCY_CONFLICT', 'VALIDATION_ERROR', 'UNSUPPORTED_VERSION'] as const;
export type FinanceV2ExportErrorCode = (typeof FINANCE_V2_EXPORT_ERROR_CODES)[number];
export type FinanceV2PreparedRefusalCode =
  | 'INVALID_SHAPE' | 'UNSUPPORTED_SHAPE' | 'UNSUPPORTED_STATUS' | 'SNAPSHOT_MISMATCH' | 'QUERY_HASH_MISMATCH' | 'SUMMARY_HASH_MISMATCH'
  | 'FORMAT_MISMATCH' | 'PERIOD_MISMATCH' | 'SCOPE_MISMATCH' | 'CURRENCY_MISMATCH' | 'ARTIFACT_MISMATCH' | 'CONTENT_MISMATCH';

export type FinanceV2ExportFormat = 'json' | 'csv';
/** What the host stated independently of the answer, plus the identity of the accepted FIRST page this export is for. */
export type FinanceV2PreparedExpectation = Readonly<{
  snapshotId: string; queryContentHash: string; summaryContentHash: string; format: FinanceV2ExportFormat;
  environment: string; billingMode: string; asOf: string; timezone: string; period: Readonly<{ start: string; end: string }>; currencies: readonly string[];
}>;
export type FinanceV2PreparedFileName = 'summary.json' | 'metrics.csv';
export type FinanceV2PreparedArtifactRef = Readonly<{ fileName: FinanceV2PreparedFileName; mediaType: string; contentHash: string; byteLength: number }>;
/** Held in memory by the hook and handed to the browser only on an explicit download; never rendered. */
export type FinanceV2PreparedFile = FinanceV2PreparedArtifactRef & Readonly<{ content: string }>;
/** Manifest fields shown to a person, exactly as delivered. Nothing here is derived. */
export type FinanceV2PreparedManifestView = Readonly<{
  exportId: string; createdAt: string; status: 'prepared'; delivery: 'manual_prepared'; deliveryReference: null; requestedFormat: FinanceV2ExportFormat; evidenceMode: string;
  itemCount: number; currencies: readonly string[]; artifacts: readonly FinanceV2PreparedArtifactRef[];
}>;
export type FinanceV2PreparedCheck =
  | Readonly<{ ok: true; manifest: FinanceV2PreparedManifestView; files: readonly FinanceV2PreparedFile[] }>
  | Readonly<{ ok: false; kind: 'error'; code: FinanceV2ExportErrorCode }>
  | Readonly<{ ok: false; kind: 'refused'; code: FinanceV2PreparedRefusalCode; path: string }>;

class Refusal extends Error {
  constructor(readonly code: FinanceV2PreparedRefusalCode, readonly path: string) { super(code); }
}
const refuse = (code: FinanceV2PreparedRefusalCode, path: string): never => { throw new Refusal(code, path); };

/** Closed plain object, string keys only, own data properties only (no accessor, no inherited or symbol member). Each field is read exactly once. */
function closed(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return refuse('INVALID_SHAPE', path);
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) return refuse('INVALID_SHAPE', path);
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || !own.every((key) => typeof key === 'string' && keys.includes(key))) return refuse('INVALID_SHAPE', path);
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) return refuse('INVALID_SHAPE', `${path}/${key}`);
    out[key] = descriptor.value as unknown;
  }
  return out;
}
function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) return refuse('INVALID_SHAPE', path);
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (typeof length !== 'number' || length > max) return refuse('INVALID_SHAPE', path);
  return Array.from({ length }, (_unused, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !('value' in descriptor)) return refuse('INVALID_SHAPE', `${path}/${index}`);
    return descriptor.value as unknown;
  });
}
const sha = (value: unknown, path: string): string => (typeof value === 'string' && HASH.test(value) ? value : refuse('INVALID_SHAPE', path));
function instant(value: unknown, path: string): number {
  if (typeof value !== 'string') return refuse('INVALID_SHAPE', path);
  const match = INSTANT.exec(value);
  const parsed = match ? Date.parse(value) : Number.NaN;
  return Number.isNaN(parsed) ? refuse('INVALID_SHAPE', path) : parsed;
}
/** Parses a host-stated instant; an unparseable expectation can never match, so it refuses rather than passes. */
function expectedInstant(value: string): number { return INSTANT.test(value) ? Date.parse(value) : Number.NaN; }
const sameSet = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && new Set(a).size === a.length && new Set(b).size === b.length && a.every((item) => b.includes(item));

const MANIFEST_KEYS = ['schemaVersion', 'sourceEncoding', 'exportId', 'status', 'destination', 'createdAt', 'snapshotId', 'queryContentHash', 'projectionContentHash', 'snapshotEnvelopeHash', 'definitionRegistryHash', 'artifactSetHash', 'artifacts', 'evidenceMode', 'requestedFormat', 'period', 'timezone', 'currencies', 'itemCount', 'delivery', 'deliveryReference', 'canonicalAdoption', 'definitionsStatus', 'consumerAcknowledgement', 'sourceEvidenceStatus'] as const;
const CONSTANTS: Readonly<Record<string, string>> = {
  schemaVersion: '2.0.0', sourceEncoding: '2.0.0', status: 'prepared', destination: 'cfo.ai', delivery: 'manual_prepared', canonicalAdoption: 'proposal_only',
  definitionsStatus: 'pending_owner_review', consumerAcknowledgement: 'pending', sourceEvidenceStatus: 'not_exposed_by_query',
};
const FILES = [{ fileName: 'summary.json', mediaType: 'application/json' }, { fileName: 'metrics.csv', mediaType: 'text/csv' }] as const;
const ARTIFACT_REF_KEYS = ['fileName', 'mediaType', 'contentHash', 'byteLength'] as const;
export const FINANCE_V2_CSV_HEADER = 'currency,scale,metric,recognition,definition,status,known_subtotal,total,unknown_count,period_start,period_end,timezone,environment,billing_mode,projection_content_hash,query_content_hash';
/** Actual (seven) plus simulated (four) metric rows per currency, as the pinned producer documents them. */
export const FINANCE_V2_ROWS_PER_CURRENCY = 11;
const encoder = new TextEncoder();

/** Quote-aware record reader for validation only (it never builds or rewrites CSV). Records end in CRLF, a bare LF outside quotes or an unterminated record is refused. */
export function readCsvRecords(content: string): string[][] | undefined {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index]!;
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (content[index + 1] === '"') { field += '"'; index += 1; continue; }
      quoted = false; closedQuote = true; continue;
    }
    if (closedQuote && char !== ',' && char !== '\r') return undefined;
    if (char === '"') { if (field !== '') return undefined; quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; closedQuote = false; continue; }
    if (char === '\r') {
      if (content[index + 1] !== '\n') return undefined;
      row.push(field); rows.push(row); row = []; field = ''; closedQuote = false; index += 1; continue;
    }
    if (char === '\n') return undefined;
    field += char;
  }
  return quoted || field !== '' || row.length > 0 || closedQuote ? undefined : rows;
}

function checkSummaryJson(content: string, manifest: { evidenceMode: string; currencies: readonly string[] }, expected: FinanceV2PreparedExpectation): void {
  if (content.charCodeAt(0) === 0xfeff || !content.endsWith('\n') || content.endsWith('\n\n')) refuse('CONTENT_MISMATCH', '/artifacts/0/content');
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return refuse('CONTENT_MISMATCH', '/artifacts/0/content'); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return refuse('CONTENT_MISMATCH', '/artifacts/0/content');
  const doc = parsed as Record<string, unknown>;
  const at = (key: string) => `/artifacts/0/content/${key}`;
  if (doc.kind !== 'finance_reporting_export_proposal') refuse('CONTENT_MISMATCH', at('kind'));
  if (doc.schemaVersion !== '2.0.0') refuse('CONTENT_MISMATCH', at('schemaVersion'));
  if (doc.sourceEvidenceStatus !== 'not_exposed_by_query') refuse('CONTENT_MISMATCH', at('sourceEvidenceStatus'));
  if (doc.evidenceMode !== manifest.evidenceMode) refuse('CONTENT_MISMATCH', at('evidenceMode'));
  if (doc.environment !== expected.environment || doc.billingMode !== expected.billingMode) refuse('SCOPE_MISMATCH', at('environment'));
  if (doc.timezone !== expected.timezone) refuse('PERIOD_MISMATCH', at('timezone'));
  const period = doc.period as { start?: unknown; end?: unknown } | null;
  if (typeof period !== 'object' || period === null || typeof period.start !== 'string' || typeof period.end !== 'string'
    || Date.parse(period.start) !== expectedInstant(expected.period.start) || Date.parse(period.end) !== expectedInstant(expected.period.end)) refuse('PERIOD_MISMATCH', at('period'));
  if (typeof doc.asOf !== 'string' || Date.parse(doc.asOf) !== expectedInstant(expected.asOf)) refuse('SNAPSHOT_MISMATCH', at('asOf'));
  const provenance = doc.provenance as Record<string, unknown> | null;
  if (typeof provenance !== 'object' || provenance === null) return refuse('CONTENT_MISMATCH', at('provenance'));
  if (provenance.snapshotId !== expected.snapshotId) refuse('SNAPSHOT_MISMATCH', at('provenance/snapshotId'));
  if (provenance.queryContentHash !== expected.queryContentHash) refuse('QUERY_HASH_MISMATCH', at('provenance/queryContentHash'));
  if (provenance.projectionContentHash !== expected.summaryContentHash) refuse('SUMMARY_HASH_MISMATCH', at('provenance/projectionContentHash'));
  const blocks = doc.currencies;
  if (!Array.isArray(blocks) || !sameSet(blocks.map((block) => (typeof block === 'object' && block !== null ? String((block as { currency?: unknown }).currency) : '')), manifest.currencies)) refuse('CURRENCY_MISMATCH', at('currencies'));
}

function checkMetricsCsv(content: string, manifest: { itemCount: number; currencies: readonly string[] }, expected: FinanceV2PreparedExpectation): void {
  if (content.charCodeAt(0) === 0xfeff) refuse('CONTENT_MISMATCH', '/artifacts/1/content');
  const rows = readCsvRecords(content);
  if (!rows || rows.length === 0) return refuse('CONTENT_MISMATCH', '/artifacts/1/content');
  if (rows[0]!.join(',') !== FINANCE_V2_CSV_HEADER || rows[0]!.length !== 16) refuse('CONTENT_MISMATCH', '/artifacts/1/content/header');
  const body = rows.slice(1);
  if (body.length !== manifest.itemCount) refuse('CONTENT_MISMATCH', '/artifacts/1/content/rows');
  const start = expectedInstant(expected.period.start);
  const end = expectedInstant(expected.period.end);
  const seen = new Set<string>();
  for (const [index, row] of body.entries()) {
    const at = `/artifacts/1/content/rows/${index}`;
    if (row.length !== 16) refuse('CONTENT_MISMATCH', at);
    const [currency = '', , , , , , , , , from = '', to = '', timezone = '', environment = '', billingMode = '', projection = '', query = ''] = row;
    if (!manifest.currencies.includes(currency)) refuse('CURRENCY_MISMATCH', `${at}/currency`);
    seen.add(currency);
    if (Date.parse(from) !== start || Date.parse(to) !== end || timezone !== expected.timezone) refuse('PERIOD_MISMATCH', at);
    if (environment !== expected.environment || billingMode !== expected.billingMode) refuse('SCOPE_MISMATCH', at);
    if (projection !== expected.summaryContentHash) refuse('SUMMARY_HASH_MISMATCH', `${at}/projection_content_hash`);
    if (query !== expected.queryContentHash) refuse('QUERY_HASH_MISMATCH', `${at}/query_content_hash`);
  }
  if (!sameSet([...seen], manifest.currencies)) refuse('CURRENCY_MISMATCH', '/artifacts/1/content/currency');
}

function inspect(raw: unknown, expected: FinanceV2PreparedExpectation): FinanceV2PreparedCheck {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return refuse('INVALID_SHAPE', '/');
  const okDescriptor = Object.getOwnPropertyDescriptor(raw, 'ok');
  if (!okDescriptor || !('value' in okDescriptor)) return refuse('INVALID_SHAPE', '/ok');
  if (okDescriptor.value === false) {
    // A failure carries no value and no bytes. Only its typed `code` is read: `safe_message` and every other member are never read, stored or shown.
    const envelope = closed(raw, ['ok', 'error'], '/');
    const error = envelope.error;
    const code = typeof error === 'object' && error !== null && !Array.isArray(error) ? Object.getOwnPropertyDescriptor(error, 'code')?.value as unknown : undefined;
    if (typeof code !== 'string' || !(FINANCE_V2_EXPORT_ERROR_CODES as readonly string[]).includes(code)) return refuse('INVALID_SHAPE', '/error/code');
    return { ok: false, kind: 'error', code: code as FinanceV2ExportErrorCode };
  }
  if (okDescriptor.value !== true) return refuse('INVALID_SHAPE', '/ok');
  const envelope = closed(raw, ['ok', 'value'], '/');
  const value = envelope.value;
  // The legacy ExportRequest@1.0.0 receipt has `manifest`, `artifactManifest` and `artifacts` and no `schemaVersion`: the Finance v2 page can only be exported as the rich 2.0.0 receipt.
  if (typeof value === 'object' && value !== null && Object.hasOwn(value, 'artifactManifest')) return refuse('UNSUPPORTED_SHAPE', '/value');
  const receipt = closed(value, ['schemaVersion', 'artifacts', 'manifest'], '/value');
  if (receipt.schemaVersion !== '2.0.0') return refuse('UNSUPPORTED_SHAPE', '/value/schemaVersion');
  const manifest = closed(receipt.manifest, MANIFEST_KEYS, '/value/manifest');
  for (const [key, constant] of Object.entries(CONSTANTS)) if (manifest[key] !== constant) return refuse(key === 'status' || key === 'delivery' ? 'UNSUPPORTED_STATUS' : 'INVALID_SHAPE', `/value/manifest/${key}`);
  if (manifest.deliveryReference !== null) return refuse('UNSUPPORTED_STATUS', '/value/manifest/deliveryReference');
  for (const key of ['exportId', 'snapshotId', 'queryContentHash', 'projectionContentHash', 'snapshotEnvelopeHash', 'definitionRegistryHash', 'artifactSetHash'] as const) sha(manifest[key], `/value/manifest/${key}`);
  instant(manifest.createdAt, '/value/manifest/createdAt');
  if (!(typeof manifest.evidenceMode === 'string' && ['mocked', 'sandbox', 'live'].includes(manifest.evidenceMode))) return refuse('INVALID_SHAPE', '/value/manifest/evidenceMode');
  if (manifest.requestedFormat !== 'json' && manifest.requestedFormat !== 'csv') return refuse('INVALID_SHAPE', '/value/manifest/requestedFormat');
  if (typeof manifest.timezone !== 'string' || manifest.timezone.length < 1 || manifest.timezone.length > 64) return refuse('INVALID_SHAPE', '/value/manifest/timezone');
  const period = closed(manifest.period, ['start', 'end'], '/value/manifest/period');
  const periodStart = instant(period.start, '/value/manifest/period/start');
  const periodEnd = instant(period.end, '/value/manifest/period/end');
  const currencies = list(manifest.currencies, '/value/manifest/currencies', 100).map((item, index) => (typeof item === 'string' && CURRENCY.test(item) ? item : refuse('INVALID_SHAPE', `/value/manifest/currencies/${index}`)));
  if (new Set(currencies).size !== currencies.length) return refuse('INVALID_SHAPE', '/value/manifest/currencies');
  const itemCount = manifest.itemCount;
  if (typeof itemCount !== 'number' || !Number.isSafeInteger(itemCount) || itemCount < 0 || itemCount > 1100) return refuse('INVALID_SHAPE', '/value/manifest/itemCount');

  // Binding to what the HOST stated, independent of this answer.
  if (manifest.snapshotId !== expected.snapshotId) return refuse('SNAPSHOT_MISMATCH', '/value/manifest/snapshotId');
  if (manifest.queryContentHash !== expected.queryContentHash) return refuse('QUERY_HASH_MISMATCH', '/value/manifest/queryContentHash');
  if (manifest.projectionContentHash !== expected.summaryContentHash) return refuse('SUMMARY_HASH_MISMATCH', '/value/manifest/projectionContentHash');
  if (manifest.requestedFormat !== expected.format) return refuse('FORMAT_MISMATCH', '/value/manifest/requestedFormat');
  if (manifest.timezone !== expected.timezone || periodStart !== expectedInstant(expected.period.start) || periodEnd !== expectedInstant(expected.period.end)) return refuse('PERIOD_MISMATCH', '/value/manifest/period');
  if (!sameSet(currencies, expected.currencies)) return refuse('CURRENCY_MISMATCH', '/value/manifest/currencies');
  if (itemCount !== currencies.length * FINANCE_V2_ROWS_PER_CURRENCY) return refuse('CURRENCY_MISMATCH', '/value/manifest/itemCount');

  // Manifest artifact references and delivered artifacts: exactly two, ordered, with the pinned names and media types, and identical to each other.
  const refs = list(manifest.artifacts, '/value/manifest/artifacts', 2).map((item, index) => closed(item, ARTIFACT_REF_KEYS, `/value/manifest/artifacts/${index}`));
  const delivered = list(receipt.artifacts, '/value/artifacts', 2).map((item, index) => closed(item, [...ARTIFACT_REF_KEYS, 'content'], `/value/artifacts/${index}`));
  if (refs.length !== 2 || delivered.length !== 2) return refuse('ARTIFACT_MISMATCH', '/value/artifacts');
  const files: FinanceV2PreparedFile[] = [];
  for (const [index, pinned] of FILES.entries()) {
    const ref = refs[index]!;
    const file = delivered[index]!;
    const at = `/value/artifacts/${index}`;
    if (ref.fileName !== pinned.fileName || ref.mediaType !== pinned.mediaType || file.fileName !== pinned.fileName || file.mediaType !== pinned.mediaType) return refuse('ARTIFACT_MISMATCH', at);
    const hash = sha(ref.contentHash, `/value/manifest/artifacts/${index}/contentHash`);
    if (file.contentHash !== hash) return refuse('ARTIFACT_MISMATCH', `${at}/contentHash`);
    const byteLength = ref.byteLength;
    if (typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > FINANCE_V2_EXPORT_MAX_BYTES) return refuse('INVALID_SHAPE', `/value/manifest/artifacts/${index}/byteLength`);
    if (file.byteLength !== byteLength) return refuse('ARTIFACT_MISMATCH', `${at}/byteLength`);
    const content = file.content;
    if (typeof content !== 'string' || content.length === 0 || content.length > FINANCE_V2_EXPORT_MAX_BYTES) return refuse('INVALID_SHAPE', `${at}/content`);
    // The delivered text must be exactly the number of UTF-8 bytes the manifest declares (a size check, not a hash, and not a re-encoding of anything).
    if (encoder.encode(content).byteLength !== byteLength) return refuse('CONTENT_MISMATCH', `${at}/content`);
    files.push({ fileName: pinned.fileName, mediaType: pinned.mediaType, contentHash: hash, byteLength, content });
  }
  const view = { evidenceMode: manifest.evidenceMode, currencies, itemCount };
  checkSummaryJson(files[0]!.content, view, expected);
  checkMetricsCsv(files[1]!.content, view, expected);
  return {
    ok: true,
    files,
    manifest: {
      exportId: manifest.exportId as string, createdAt: manifest.createdAt as string, status: 'prepared', delivery: 'manual_prepared', deliveryReference: null, requestedFormat: manifest.requestedFormat,
      evidenceMode: manifest.evidenceMode, itemCount, currencies, artifacts: files.map(({ fileName, mediaType, contentHash, byteLength }) => ({ fileName, mediaType, contentHash, byteLength })),
    },
  };
}

/**
 * STRUCTURE ONLY, NOT PUBLIC and NEVER an accepted result. It validates shape, host binding and byte lengths but does not hash, so it cannot see an equal-length change of bytes under
 * their declared hash. Its success carries `bytesVerified: false` and is a different type from `FinanceV2PreparedCheck`: only `checkPreparedExport` (which hashes) yields an accepted one.
 */
export type FinanceV2StructuralCheck =
  | Readonly<{ ok: true; bytesVerified: false; manifest: FinanceV2PreparedManifestView; files: readonly FinanceV2PreparedFile[] }>
  | Extract<FinanceV2PreparedCheck, { ok: false }>;
export function inspectPreparedExportStructure(raw: unknown, expected: FinanceV2PreparedExpectation): FinanceV2StructuralCheck {
  try {
    const result = inspect(raw, expected);
    return result.ok ? { ok: true, bytesVerified: false, manifest: result.manifest, files: result.files } : result;
  } catch (error) { return error instanceof Refusal ? { ok: false, kind: 'refused', code: error.code, path: error.path } : { ok: false, kind: 'refused', code: 'INVALID_SHAPE', path: '/' }; }
}

/**
 * Content integrity of delivered artifact bytes: the SHA-256 of each file's exact UTF-8 bytes must equal the `contentHash` the manifest declared. This is the ONLY hashing here and it
 * is a check on bytes in hand, never a reconstruction of any snapshot, projection or financial hash and never a new hash offered as proof. A match shows the bytes are the ones the
 * manifest declared; it is NOT host authentication and NOT financial authority (the host port owns those). Without Web Crypto nothing can be verified, so nothing is accepted.
 * Returns `null` when every file matches, otherwise the path of the first file that does not.
 */
export async function verifyPreparedFilesIntegrity(files: readonly FinanceV2PreparedFile[]): Promise<string | null> {
  const subtle = (globalThis as { crypto?: { subtle?: { digest?: unknown } } }).crypto?.subtle;
  if (typeof subtle?.digest !== 'function') return '/value/artifacts';
  for (const [index, file] of files.entries()) {
    let digest: ArrayBuffer;
    try { digest = await (subtle as SubtleCrypto).digest('SHA-256', encoder.encode(file.content)); } catch { return `/value/artifacts/${index}/content`; }
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (`sha256:${hex}` !== file.contentHash) return `/value/artifacts/${index}/content`;
  }
  return null;
}

/**
 * Validates an untrusted prepared-export answer against the host's expectation and verifies the real SHA-256 of each delivered file's exact bytes against its declared `contentHash`.
 * This is the ONLY public path to `ok: true` (and so to `files`): a structure-valid answer whose bytes differ, even by an equal-length change, is refused with `CONTENT_MISMATCH` and
 * no bytes. Never throws and never rejects; every failure is a typed refusal with a path and NO bytes. A typed producer failure is returned as `kind: 'error'` with only its closed code.
 * A matching hash is content integrity only: host authentication and the Finance authority fence stay with the host port.
 */
export async function checkPreparedExport(raw: unknown, expected: FinanceV2PreparedExpectation): Promise<FinanceV2PreparedCheck> {
  const structural = inspectPreparedExportStructure(raw, expected);
  if (!structural.ok) return structural;
  let failed: string | null;
  try { failed = await verifyPreparedFilesIntegrity(structural.files); } catch { failed = '/value/artifacts'; }
  return failed === null ? { ok: true, manifest: structural.manifest, files: structural.files } : { ok: false, kind: 'refused', code: 'CONTENT_MISMATCH', path: failed };
}
/** The same function under its earlier name, so no caller can hold a differently-behaving entry point. */
export const checkPreparedExportIntegrity: typeof checkPreparedExport = checkPreparedExport;

/** The file a person asked for: the producer prepares both files, the manual representation selects one. */
export const FINANCE_V2_FORMAT_FILE: Readonly<Record<FinanceV2ExportFormat, FinanceV2PreparedFileName>> = { json: 'summary.json', csv: 'metrics.csv' };
