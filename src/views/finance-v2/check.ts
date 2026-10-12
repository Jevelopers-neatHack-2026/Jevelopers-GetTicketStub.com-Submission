import { DETAIL_METRIC_NAMES, METRIC_NAMES, REPORTING_DIMENSIONS, type FinanceV2Check, type FinanceV2Page, type FinanceV2RefusalCode, type OpaqueProductScope } from './types';

/**
 * Presentation guard for a delivered Finance v2 page. It is NOT a producer validator and not a canonical schema: it only
 * refuses what the view could not render faithfully (wrong shape, wrong version, a scope the host did not expect, a detail
 * whose currency is not in the parent summary, or a snapshot that is not the one the host asked for).
 * Amount values are only required to be strings; they are never parsed, rounded, summed or compared.
 */
const HASH = /^sha256:[a-f0-9]{64}$/u;
const SCOPE_KEYS = ['tenantId', 'projectId', 'environment', 'billingMode', 'actorId'] as const;
const PAGE_KEYS: ReadonlySet<string> = new Set(['schemaVersion', 'requestId', 'snapshotId', 'queryContentHash', 'summaryContentHash', 'asOf', 'timezone', 'period', 'scope', 'filters', 'watermark', 'summary', 'details', 'detailCount', 'hasMore', 'nextCursor', 'canonicalSummaries', 'canonicalMappingStatus']);
const AMOUNT_STATUS = new Set(['known', 'partial', 'unknown']);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableText = (value: unknown): boolean => value === null || text(value);
/** `FinancialSummaryQueryV2.cursor` is `minLength: 1, maxLength: 2048`. A cursor is an opaque string: it is measured, never parsed. */
export const FINANCE_V2_CURSOR_MAX_LENGTH = 2048;
export const validCursor = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= FINANCE_V2_CURSOR_MAX_LENGTH;
const refuse = (code: FinanceV2RefusalCode, path: string): FinanceV2Check => ({ ok: false, code, path });

function amountPath(value: unknown, path: string): string | undefined {
  if (!record(value)) return path;
  if (typeof value.status !== 'string' || !AMOUNT_STATUS.has(value.status)) return `${path}/status`;
  if (!nullableText(value.knownSubtotal)) return `${path}/knownSubtotal`;
  if (!nullableText(value.total)) return `${path}/total`;
  if (!count(value.unknownCount)) return `${path}/unknownCount`;
  return undefined;
}
function metricsPath(value: unknown, path: string): string | undefined {
  if (!record(value)) return path;
  for (const name of METRIC_NAMES) { const bad = amountPath(value[name], `${path}/${name}`); if (bad) return bad; }
  return undefined;
}
function summaryPath(summary: unknown): string | undefined {
  if (!record(summary)) return '/summary';
  for (const key of ['policyVersion', 'accountingPolicyVersion', 'definitionsStatus'] as const) if (!text(summary[key])) return `/summary/${key}`;
  if (!Array.isArray(summary.currencies)) return '/summary/currencies';
  for (const [index, entry] of summary.currencies.entries()) {
    const base = `/summary/currencies/${index}`;
    if (!record(entry)) return base;
    if (!text(entry.currency)) return `${base}/currency`;
    if (entry.scale !== 18) return `${base}/scale`;
    const bad = metricsPath(entry.metrics, `${base}/metrics`); if (bad) return bad;
    if (!record(entry.valuation)) return `${base}/valuation`;
    for (const key of ['estimated', 'confirmed'] as const) { const worse = amountPath(entry.valuation[key], `${base}/valuation/${key}`); if (worse) return worse; }
    if (!count(entry.valuation.unknownCount)) return `${base}/valuation/unknownCount`;
    if (!record(entry.reconciliation)) return `${base}/reconciliation`;
    for (const key of ['matchedCount', 'unmatchedCount', 'exceptionCount'] as const) if (!count(entry.reconciliation[key])) return `${base}/reconciliation/${key}`;
    if (!record(entry.simulated)) return `${base}/simulated`;
    for (const key of ['expense', 'grossSales', 'netSales', 'directCosts'] as const) { const bad = amountPath(entry.simulated[key], `${base}/simulated/${key}`); if (bad) return bad; }
    if (!Array.isArray(entry.groups)) return `${base}/groups`;
    for (const [at, group] of entry.groups.entries()) {
      const where = `${base}/groups/${at}`;
      if (!record(group)) return where;
      if (!REPORTING_DIMENSIONS.includes(group.dimension as never)) return `${where}/dimension`;
      if (!nullableText(group.value)) return `${where}/value`;
      if (group.bucket !== 'known' && group.bucket !== 'unknown_unallocated') return `${where}/bucket`;
      if (!count(group.eventCount)) return `${where}/eventCount`;
      const worse = metricsPath(group.metrics, `${where}/metrics`); if (worse) return worse;
    }
  }
  const coverage = summary.coverage;
  if (!record(coverage)) return '/summary/coverage';
  if (coverage.status !== 'complete' && coverage.status !== 'partial' && coverage.status !== 'unknown') return '/summary/coverage/status';
  if (!count(coverage.observed)) return '/summary/coverage/observed';
  if (coverage.expected !== null && !count(coverage.expected)) return '/summary/coverage/expected';
  for (const key of ['unknownAmountCount', 'unpostedAttemptCount', 'awaitingEvidenceAttemptCount', 'quarantinedObservationCount', 'unsupportedEventCount'] as const) if (!count(coverage[key])) return `/summary/coverage/${key}`;
  if (!Array.isArray(coverage.missingSources) || !coverage.missingSources.every(text)) return '/summary/coverage/missingSources';
  if (!Array.isArray(summary.budgets)) return '/summary/budgets';
  for (const [index, budget] of summary.budgets.entries()) {
    const base = `/summary/budgets/${index}`;
    if (!record(budget)) return base;
    if (!text(budget.currency)) return `${base}/currency`;
    if (budget.window !== 'project_lifetime') return `${base}/window`;
    if (budget.policyReference !== null && !(record(budget.policyReference) && text(budget.policyReference.id) && count(budget.policyReference.revision) && typeof budget.policyReference.contentHash === 'string' && HASH.test(budget.policyReference.contentHash))) return `${base}/policyReference`;
    for (const key of ['limit', 'remainingAuthorizedCapacity'] as const) if (!nullableText(budget[key])) return `${base}/${key}`;
    for (const key of ['ledgerExpense', 'lifecycleConsumed', 'held'] as const) if (!text(budget[key])) return `${base}/${key}`;
    if (typeof budget.unresolvedExposure !== 'boolean') return `${base}/unresolvedExposure`;
    if (budget.advisoryOnly !== true) return `${base}/advisoryOnly`;
  }
  if (!Array.isArray(summary.unitCosts)) return '/summary/unitCosts';
  if (!Array.isArray(summary.allocations)) return '/summary/allocations';
  return undefined;
}
function detailPath(detail: unknown, index: number, currencies: ReadonlySet<string>): { path: string; code: FinanceV2RefusalCode } | undefined {
  const base = `/details/${index}`;
  if (!record(detail)) return { path: base, code: 'INVALID_SHAPE' };
  if (typeof detail.detailId !== 'string' || !HASH.test(detail.detailId)) return { path: `${base}/detailId`, code: 'INVALID_SHAPE' };
  for (const key of ['currency', 'eventType', 'classification', 'occurredAt'] as const) if (!text(detail[key])) return { path: `${base}/${key}`, code: 'INVALID_SHAPE' };
  if (!['estimated', 'provider_confirmed', 'unknown'].includes(detail.valuation as string)) return { path: `${base}/valuation`, code: 'INVALID_SHAPE' };
  if (!['unmatched', 'matched', 'exception'].includes(detail.reconciliation as string)) return { path: `${base}/reconciliation`, code: 'INVALID_SHAPE' };
  if (!['unpaid', 'partly_paid', 'paid'].includes(detail.settlement as string)) return { path: `${base}/settlement`, code: 'INVALID_SHAPE' };
  if (!['recognized', 'unknown', 'unsupported'].includes(detail.status as string)) return { path: `${base}/status`, code: 'INVALID_SHAPE' };
  if (!nullableText(detail.amount)) return { path: `${base}/amount`, code: 'INVALID_SHAPE' };
  if (!record(detail.dimensions) || !REPORTING_DIMENSIONS.every((key) => nullableText((detail.dimensions as Record<string, unknown>)[key]))) return { path: `${base}/dimensions`, code: 'INVALID_SHAPE' };
  // Exactly the eleven frozen names, each a non-empty string: a missing, extra or invented metric key is refused, never displayed.
  if (!record(detail.metrics) || Object.keys(detail.metrics).length !== DETAIL_METRIC_NAMES.length || !DETAIL_METRIC_NAMES.every((name) => text((detail.metrics as Record<string, unknown>)[name]))) return { path: `${base}/metrics`, code: 'INVALID_SHAPE' };
  if (!currencies.has(detail.currency as string)) return { path: `${base}/currency`, code: 'SNAPSHOT_MISMATCH' };
  return undefined;
}

/**
 * The earlier proposal delivered `simulated.*` as bare decimal strings. The accepted-for-conformance producer shape delivers `ReportingAmount` objects.
 * The two are never the same `2.0.0`: a page still carrying a scalar there is refused under its own code, and nothing is coerced to an amount.
 */
function legacyPath(summary: unknown): string | undefined {
  if (!record(summary) || !Array.isArray(summary.currencies)) return undefined;
  for (const [index, entry] of summary.currencies.entries()) {
    if (!record(entry) || !record(entry.simulated)) continue;
    for (const key of Object.keys(entry.simulated)) if (typeof entry.simulated[key] === 'string') return `/summary/currencies/${index}/simulated/${key}`;
  }
  return undefined;
}

/** A canonical reference as the pinned registry states it. Compared field by field for equality only. */
export type FinanceV2CanonicalReference = Readonly<{ contract: string; schema_version: string; id: string; revision: number; content_hash: string }>;
/**
 * References the host pinned independently of the payload (for example from the definition registry whose digest the host verified).
 * A canonical summary naming any other definition or policy reference is refused; the payload never vouches for its own references.
 */
export type FinanceV2TrustedReferences = Readonly<{ metrics: Readonly<Record<string, FinanceV2CanonicalReference>>; policy: FinanceV2CanonicalReference }>;
const REFERENCE_KEYS = ['contract', 'schema_version', 'id', 'revision', 'content_hash'] as const;
const sameReference = (actual: unknown, trusted: FinanceV2CanonicalReference | undefined): boolean =>
  trusted !== undefined && record(actual) && Object.keys(actual).length === REFERENCE_KEYS.length && REFERENCE_KEYS.every((key) => actual[key] === trusted[key]);
function referencePath(summaries: readonly unknown[], trusted: FinanceV2TrustedReferences): string | undefined {
  for (const [index, entry] of summaries.entries()) {
    const base = `/canonicalSummaries/${index}`;
    if (!record(entry) || !record(entry.metrics)) return `${base}/metrics`;
    // Every independently pinned metric key must be present: deleting an entry (or emptying `metrics`) is refused, not skipped.
    for (const name of Object.keys(trusted.metrics)) if (!Object.hasOwn(entry.metrics, name)) return `${base}/metrics/${name}`;
    for (const name of Object.keys(entry.metrics)) {
      const metric = entry.metrics[name];
      const own = Object.hasOwn(trusted.metrics, name) ? trusted.metrics[name] : undefined;
      if (!record(metric) || !sameReference(metric.definition_ref, own)) return `${base}/metrics/${name}/definition_ref`;
    }
    if (!sameReference(entry.policy_ref, trusted.policy)) return `${base}/policy_ref`;
  }
  return undefined;
}

function wrapperPath(raw: Record<string, unknown>): string | undefined {
  const { filters, watermark } = raw;
  if (!record(filters)) return '/filters';
  for (const key of ['environments', 'billingModes'] as const) if (!Array.isArray(filters[key]) || !filters[key].every(text)) return `/filters/${key}`;
  if (!record(watermark)) return '/watermark';
  if (typeof watermark.watermarkId !== 'string' || !HASH.test(watermark.watermarkId)) return '/watermark/watermarkId';
  if (!text(watermark.capturedAt)) return '/watermark/capturedAt';
  if (!Array.isArray(watermark.sources) || watermark.sources.length === 0) return '/watermark/sources';
  for (const [index, source] of watermark.sources.entries()) {
    const base = `/watermark/sources/${index}`;
    if (!record(source)) return base;
    for (const key of ['source', 'revision', 'observedThrough', 'completeness'] as const) if (!text(source[key])) return `${base}/${key}`;
    if (typeof source.contentHash !== 'string' || !HASH.test(source.contentHash)) return `${base}/contentHash`;
  }
  return undefined;
}

/** Identity the host asked for, stated independently of the response. The browser only compares these strings for equality; it never computes or vouches for a hash. */
export type FinanceV2ExpectedHashes = Readonly<{ queryContentHash?: string; summaryContentHash?: string; references?: FinanceV2TrustedReferences }>;

/** `expectedScope` is the host's own opaque scope. `expectedSnapshotId` and `expected` are optional; when given, a different snapshot, hash or canonical reference is refused. */
export function checkFinanceV2Page(raw: unknown, expectedScope: OpaqueProductScope, expectedSnapshotId?: string, expected: FinanceV2ExpectedHashes = {}): FinanceV2Check {
  if (!record(raw)) return refuse('INVALID_SHAPE', '/');
  if (raw.schemaVersion !== '2.0.0') return refuse('UNSUPPORTED_VERSION', '/schemaVersion');
  // The pinned page schema is closed (`additionalProperties: false`) and requires all eighteen members: an invented top-level member is refused, never displayed.
  for (const key of Object.keys(raw)) if (!PAGE_KEYS.has(key)) return refuse('INVALID_SHAPE', `/${key}`);
  if (!record(raw.scope)) return refuse('INVALID_SHAPE', '/scope');
  for (const key of SCOPE_KEYS) {
    if (!text(raw.scope[key])) return refuse('INVALID_SHAPE', `/scope/${key}`);
    if (raw.scope[key] !== expectedScope[key]) return refuse('SCOPE_MISMATCH', `/scope/${key}`);
  }
  for (const key of ['requestId', 'timezone', 'asOf'] as const) if (!text(raw[key])) return refuse('INVALID_SHAPE', `/${key}`);
  for (const key of ['snapshotId', 'queryContentHash', 'summaryContentHash'] as const) if (typeof raw[key] !== 'string' || !HASH.test(raw[key])) return refuse('INVALID_SHAPE', `/${key}`);
  if (!record(raw.period) || !text(raw.period.start) || !text(raw.period.end)) return refuse('INVALID_SHAPE', '/period');
  if (expectedSnapshotId !== undefined && raw.snapshotId !== expectedSnapshotId) return refuse('SNAPSHOT_MISMATCH', '/snapshotId');
  if (expected.queryContentHash !== undefined && raw.queryContentHash !== expected.queryContentHash) return refuse('QUERY_HASH_MISMATCH', '/queryContentHash');
  if (expected.summaryContentHash !== undefined && raw.summaryContentHash !== expected.summaryContentHash) return refuse('SUMMARY_HASH_MISMATCH', '/summaryContentHash');
  const legacy = legacyPath(raw.summary);
  if (legacy) return refuse('LEGACY_PROPOSAL_SHAPE', legacy);
  const wrapper = wrapperPath(raw);
  if (wrapper) return refuse('INVALID_SHAPE', wrapper);
  const bad = summaryPath(raw.summary);
  if (bad) return refuse('INVALID_SHAPE', bad);
  if (!Array.isArray(raw.details)) return refuse('INVALID_SHAPE', '/details');
  const currencies = new Set(((raw.summary as { currencies: { currency: string }[] }).currencies).map((entry) => entry.currency));
  for (const [index, detail] of raw.details.entries()) { const worse = detailPath(detail, index, currencies); if (worse) return refuse(worse.code, worse.path); }
  if (!count(raw.detailCount)) return refuse('INVALID_SHAPE', '/detailCount');
  if (typeof raw.hasMore !== 'boolean') return refuse('INVALID_SHAPE', '/hasMore');
  // The cursor is opaque and is never decoded: only its presence is tied to `hasMore`, and its length to the pinned query schema.
  if (raw.hasMore ? !validCursor(raw.nextCursor) : raw.nextCursor !== null) return refuse('INVALID_SHAPE', '/nextCursor');
  if (!Array.isArray(raw.canonicalSummaries)) return refuse('INVALID_SHAPE', '/canonicalSummaries');
  if (raw.canonicalMappingStatus !== 'proposal_only_owner_ack_pending' && raw.canonicalMappingStatus !== 'unsupported_opaque_scope') return refuse('INVALID_SHAPE', '/canonicalMappingStatus');
  if (expected.references !== undefined) { const mismatch = referencePath(raw.canonicalSummaries, expected.references); if (mismatch) return refuse('REFERENCE_MISMATCH', mismatch); }
  return { ok: true, page: raw as unknown as FinanceV2Page };
}

/** One step of the page history: the opaque cursor that fetched a page, and the detail ids of the page it was taken from. */
export type FinanceV2TrailEntry = Readonly<{ cursor: string; fromDetailIds: readonly string[]; linked: boolean }>;
export type FinanceV2PageTrail = readonly FinanceV2TrailEntry[];

/** Members that legitimately vary per read: everything else on a page is the immutable public snapshot envelope. */
const PER_READ_KEYS: ReadonlySet<string> = new Set(['requestId', 'details', 'hasMore', 'nextCursor']);
/** Key of the cursorless first page in the evidence; a real cursor is never empty (`minLength: 1`). */
const FIRST_PAGE = '';

/** Structural equality of delivered JSON values, insensitive to object key order. Compares values only; nothing is hashed, parsed or computed. */
export function sameDeliveredValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((item, index) => sameDeliveredValue(item, b[index]));
  if (!record(a) || !record(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameDeliveredValue(a[key], b[key]));
}

/**
 * What this identity generation has independently observed: the immutable public envelope of the first accepted page, and for every request cursor the
 * page it was answered with (an immutable deep copy of the accepted details in order,`hasMore`, `nextCursor`). Held only for one scope/snapshot/authorization/filter generation and
 * never persisted. It survives Previous, retry and revisits, so it is not erased by trail truncation. Deep-linked pages can be compared only against
 * pages observed from the first one onward; an unseen preceding page cannot be checked.
 */
export type FinanceV2Evidence = Readonly<{
  envelope: Readonly<Record<string, unknown>> | null;
  pages: ReadonlyMap<string, Readonly<{ details: readonly FinanceV2Page['details'][number][]; hasMore: boolean; nextCursor: string | null }>>;
}>;
export const NO_EVIDENCE: FinanceV2Evidence = { envelope: null, pages: new Map() };

/** Compares a structurally accepted page, answered for `requestCursor` (undefined = first page), with the evidence. Only delivered strings and values are compared. */
export function checkFinanceV2Evidence(page: FinanceV2Page, requestCursor: string | undefined, evidence: FinanceV2Evidence): FinanceV2Check {
  const at = requestCursor ?? FIRST_PAGE;
  if (evidence.envelope !== null) {
    const raw = page as unknown as Record<string, unknown>;
    for (const key of Object.keys(evidence.envelope)) if (!sameDeliveredValue(evidence.envelope[key], raw[key])) return refuse('SNAPSHOT_MISMATCH', `/${key}`);
  }
  const ids = page.details.map((detail) => detail.detailId);
  for (const [other, seen] of evidence.pages) {
    if (other === at) continue;
    const clash = ids.findIndex((id) => seen.details.some((detail) => detail.detailId === id));
    if (clash >= 0) return refuse('PAGE_REPLAY', `/details/${clash}/detailId`);
  }
  const known = evidence.pages.get(at);
  if (known !== undefined) {
    if (known.details.length !== ids.length || known.details.some((detail, index) => detail.detailId !== ids[index])) return refuse('PAGE_REPLAY', '/details');
    // Same ids are not enough: every delivered value of a previously accepted detail must be unchanged (key order ignored). Values are only compared.
    const changed = known.details.findIndex((detail, index) => !sameDeliveredValue(detail, page.details[index]));
    if (changed >= 0) return refuse('PAGE_REPLAY', `/details/${changed}`);
    if (known.hasMore !== page.hasMore || known.nextCursor !== page.nextCursor) return refuse('PAGE_REPLAY', '/nextCursor');
  }
  return { ok: true, page };
}

/** Records an accepted page. The envelope is taken from the first accepted page of the generation and never replaced. */
export function recordFinanceV2Evidence(page: FinanceV2Page, requestCursor: string | undefined, evidence: FinanceV2Evidence): FinanceV2Evidence {
  const pages = new Map(evidence.pages);
  pages.set(requestCursor ?? FIRST_PAGE, { details: structuredClone(page.details), hasMore: page.hasMore, nextCursor: page.nextCursor });
  const envelope = evidence.envelope ?? structuredClone(Object.fromEntries(Object.entries(page).filter(([key]) => !PER_READ_KEYS.has(key))));
  return { envelope, pages };
}

/**
 * Replay guard for a page shown after other pages of the same snapshot: a detail id already delivered (on this page or on an earlier page of
 * the trail), or a `nextCursor` that points back into the trail, is refused. Only strings are compared; nothing is recomputed or summed.
 */
export function checkFinanceV2Continuation(page: FinanceV2Page, trail: FinanceV2PageTrail): FinanceV2Check {
  const seen = new Set<string>(trail.flatMap((entry) => entry.fromDetailIds));
  for (const [index, detail] of page.details.entries()) {
    if (seen.has(detail.detailId)) return refuse('PAGE_REPLAY', `/details/${index}/detailId`);
    seen.add(detail.detailId);
  }
  if (page.nextCursor !== null && trail.some((entry) => entry.cursor === page.nextCursor)) return refuse('PAGE_REPLAY', '/nextCursor');
  return { ok: true, page };
}
