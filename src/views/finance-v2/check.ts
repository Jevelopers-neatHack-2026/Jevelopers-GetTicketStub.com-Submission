import { METRIC_NAMES, REPORTING_DIMENSIONS, type FinanceV2Check, type FinanceV2Page, type FinanceV2RefusalCode, type OpaqueProductScope } from './types';

/**
 * Presentation guard for a delivered Finance v2 page. It is NOT a producer validator and not a canonical schema: it only
 * refuses what the view could not render faithfully (wrong shape, wrong version, a scope the host did not expect, a detail
 * whose currency is not in the parent summary, or a snapshot that is not the one the host asked for).
 * Amount values are only required to be strings; they are never parsed, rounded, summed or compared.
 */
const HASH = /^sha256:[a-f0-9]{64}$/u;
const SCOPE_KEYS = ['tenantId', 'projectId', 'environment', 'billingMode', 'actorId'] as const;
const AMOUNT_STATUS = new Set(['known', 'partial', 'unknown']);
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const nullableText = (value: unknown): boolean => value === null || text(value);
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
    const bad = metricsPath(entry.metrics, `${base}/metrics`); if (bad) return bad;
    if (!record(entry.valuation)) return `${base}/valuation`;
    for (const key of ['estimated', 'confirmed'] as const) { const worse = amountPath(entry.valuation[key], `${base}/valuation/${key}`); if (worse) return worse; }
    if (!count(entry.valuation.unknownCount)) return `${base}/valuation/unknownCount`;
    if (!record(entry.reconciliation)) return `${base}/reconciliation`;
    for (const key of ['matchedCount', 'unmatchedCount', 'exceptionCount'] as const) if (!count(entry.reconciliation[key])) return `${base}/reconciliation/${key}`;
    if (!record(entry.simulated)) return `${base}/simulated`;
    for (const key of ['expense', 'grossSales', 'netSales', 'directCosts'] as const) if (!text(entry.simulated[key])) return `${base}/simulated/${key}`;
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
  if (!record(detail.metrics) || !Object.values(detail.metrics).every(text)) return { path: `${base}/metrics`, code: 'INVALID_SHAPE' };
  if (!currencies.has(detail.currency as string)) return { path: `${base}/currency`, code: 'SNAPSHOT_MISMATCH' };
  return undefined;
}

/** `expectedScope` is the host's own opaque scope. `expectedSnapshotId` is optional; when given, a different snapshot is refused. */
export function checkFinanceV2Page(raw: unknown, expectedScope: OpaqueProductScope, expectedSnapshotId?: string): FinanceV2Check {
  if (!record(raw)) return refuse('INVALID_SHAPE', '/');
  if (raw.schemaVersion !== '2.0.0') return refuse('UNSUPPORTED_VERSION', '/schemaVersion');
  if (!record(raw.scope)) return refuse('INVALID_SHAPE', '/scope');
  for (const key of SCOPE_KEYS) {
    if (!text(raw.scope[key])) return refuse('INVALID_SHAPE', `/scope/${key}`);
    if (raw.scope[key] !== expectedScope[key]) return refuse('SCOPE_MISMATCH', `/scope/${key}`);
  }
  for (const key of ['requestId', 'timezone', 'asOf'] as const) if (!text(raw[key])) return refuse('INVALID_SHAPE', `/${key}`);
  for (const key of ['snapshotId', 'queryContentHash', 'summaryContentHash'] as const) if (typeof raw[key] !== 'string' || !HASH.test(raw[key])) return refuse('INVALID_SHAPE', `/${key}`);
  if (!record(raw.period) || !text(raw.period.start) || !text(raw.period.end)) return refuse('INVALID_SHAPE', '/period');
  if (expectedSnapshotId !== undefined && raw.snapshotId !== expectedSnapshotId) return refuse('SNAPSHOT_MISMATCH', '/snapshotId');
  const bad = summaryPath(raw.summary);
  if (bad) return refuse('INVALID_SHAPE', bad);
  if (!Array.isArray(raw.details)) return refuse('INVALID_SHAPE', '/details');
  const currencies = new Set(((raw.summary as { currencies: { currency: string }[] }).currencies).map((entry) => entry.currency));
  for (const [index, detail] of raw.details.entries()) { const worse = detailPath(detail, index, currencies); if (worse) return refuse(worse.code, worse.path); }
  if (!count(raw.detailCount)) return refuse('INVALID_SHAPE', '/detailCount');
  if (typeof raw.hasMore !== 'boolean') return refuse('INVALID_SHAPE', '/hasMore');
  if (raw.nextCursor !== null && typeof raw.nextCursor !== 'string') return refuse('INVALID_SHAPE', '/nextCursor');
  if (raw.canonicalMappingStatus !== 'proposal_only_owner_ack_pending' && raw.canonicalMappingStatus !== 'unsupported_opaque_scope') return refuse('INVALID_SHAPE', '/canonicalMappingStatus');
  return { ok: true, page: raw as unknown as FinanceV2Page };
}
