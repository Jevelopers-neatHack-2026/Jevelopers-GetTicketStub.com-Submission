/**
 * TD-01B: scoped, typed, read-only adapter from shared-contracts 0.9.7 wire records to the dashboard's UI projection types.
 *
 * - No runtime imports: the package's canonical helpers arrive through the injected `ContractKit`, so this module neither
 *   bundles nor requires the provisioned archive. Only erasable TypeScript syntax is used so the offline contract driver
 *   can execute this exact file under Node type stripping.
 * - Tenant/project/environment/billing partition come from the host's trusted scope, never from the payload.
 * - Missing, stale, restricted and unknown are explicit result states. Nothing is inferred: no zero for a missing amount,
 *   no ledger, no live revenue, no authority. Every result carries `authority: 'read_only_projection'`.
 * - One read covers exactly one environment x billing partition; partitions are never merged or re-labelled.
 */
import type { AmountDisplay } from '../components/AmountText';
import type { BadgeState } from '../components/StateBadge';
import type { BillingMode, FinanceEnvironment } from '../access/trusted-host';

export const SHARED_CONTRACTS_PIN = Object.freeze({ package: '@jevelopers/shared-contracts', version: '0.9.7' });

type Issue = Readonly<{ code: string; path: string }>;
type Check = Readonly<{ ok: true; value: unknown }> | Readonly<{ ok: false; errors: readonly Issue[] }>;
/** The subset of the package runtime/operations helpers this adapter calls. Method syntax keeps the real generics assignable. */
export interface ContractKit {
  parseContractVersion(contract: string, version: string, json: string): Check;
  checkTrustedContext(value: unknown, expected: Record<string, string>): Check;
  checkFinancialSummary(value: unknown, context: unknown): Check;
  hashManifest(value: unknown): string;
}

/** Host-derived expectation. Build it from the verified `TrustedScope`; never from a URL, payload or cache key. */
export type ContractScope = Readonly<{ tenantId: string; projectId: string; environment: FinanceEnvironment; billingMode: BillingMode }>;
export type Delivery =
  | Readonly<{ kind: 'payload'; json: string }>
  | Readonly<{ kind: 'absent' }>
  | Readonly<{ kind: 'restricted' }>
  | Readonly<{ kind: 'unknown' }>;

export type RefusalCode =
  | 'MALFORMED_JSON' | 'INVALID_PAYLOAD' | 'UNSUPPORTED_VERSION' | 'UNKNOWN_CONTRACT'
  | 'SCOPE_MISMATCH' | 'PARTITION_MISMATCH' | 'REFERENCE_MISMATCH' | 'DIGEST_MISMATCH' | 'FUTURE_DATED'
  | 'CURRENCY_MISMATCH' | 'INVALID_MONEY' | 'POLICY_MISMATCH' | 'INVALID_TRUST_CONTEXT' | 'CONTRACT_REFUSED'
  | 'UNSUPPORTED_INTERFACE' | 'LEGACY_UNREPRESENTABLE' | 'UNACCEPTED_INTERFACE';
export type Authority = 'read_only_projection';
export type ProjectionResult<T> =
  | Readonly<{ status: 'ready'; authority: Authority; data: T }>
  | Readonly<{ status: 'stale'; authority: Authority; data: T; ageMs: number }>
  | Readonly<{ status: 'missing' | 'restricted' | 'unknown'; authority: Authority }>
  | Readonly<{ status: 'refused'; authority: Authority; code: RefusalCode; path: string }>;

type Common = Readonly<{
  kit: ContractKit; scope: ContractScope; delivery: Delivery; now: string; maxAgeMs: number;
  /** Canonical digest (`kit.hashManifest`) the host obtained out of band; a mismatch refuses tampered bytes. */
  expectedDigest?: string; maxFutureSkewMs?: number;
}>;
export type SummaryRequest = Common & Readonly<{
  currency: string;
  /** Independent trusted reference expectations (path -> VersionedReference), supplied by the host/owning API, never read from the payload. */
  references: Readonly<Record<string, unknown>>;
  /** Metrics the view needs. A requested metric absent from the record is `unavailable`, never zero. */
  metricNames?: readonly string[];
}>;

/** Shape already validated by the package's generated validators; fields are read, never trusted from outside that gate. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Wire = any;
const authority: Authority = 'read_only_projection';
const refuse = (code: RefusalCode, path = ''): ProjectionResult<never> => ({ status: 'refused', authority, code, path });
const KNOWN_CODES: ReadonlySet<string> = new Set<RefusalCode>(['MALFORMED_JSON', 'INVALID_PAYLOAD', 'UNSUPPORTED_VERSION', 'UNKNOWN_CONTRACT', 'SCOPE_MISMATCH', 'REFERENCE_MISMATCH', 'CURRENCY_MISMATCH', 'INVALID_MONEY', 'POLICY_MISMATCH', 'INVALID_TRUST_CONTEXT']);
function fromCheck(result: Extract<Check, { ok: false }>): ProjectionResult<never> {
  const first = result.errors[0];
  return refuse(first && KNOWN_CODES.has(first.code) ? (first.code as RefusalCode) : 'CONTRACT_REFUSED', first?.path ?? '');
}
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Interfaces the producer has not accepted for consumers. They are refused by name, never approximated. */
export const UNSUPPORTED_INTERFACES = Object.freeze({
  'Preview1/ArtifactFile2 eligibility': 'LEGACY_UNREPRESENTABLE',
  'CSV input activation': 'UNACCEPTED_INTERFACE',
  'draft-row publication': 'UNACCEPTED_INTERFACE',
  'repair/derived-composition': 'UNACCEPTED_INTERFACE',
  'local UsageEvent pre-ingestion mapping': 'UNACCEPTED_INTERFACE',
} as const satisfies Record<string, RefusalCode>);
export const SUPPORTED_CONTRACTS = Object.freeze(['FinancialSummary', 'EvidenceProjection', 'JobStatus', 'FulfillmentStatus'] as const);
export function refuseUnsupported(name: string): ProjectionResult<never> {
  const code = Object.hasOwn(UNSUPPORTED_INTERFACES, name) ? UNSUPPORTED_INTERFACES[name as keyof typeof UNSUPPORTED_INTERFACES] : 'UNSUPPORTED_INTERFACE';
  return refuse(code, '/' + name);
}

type Intake = Readonly<{ value: Record<string, unknown> }>;
/** Delivery state, structural parse, trusted scope, partition and digest. Everything contract-specific happens after this. */
function intake(contract: string, request: Common, trusted: Record<string, string>): ProjectionResult<never> | Intake {
  const { kit, scope, delivery } = request;
  if (delivery.kind === 'restricted') return { status: 'restricted', authority };
  if (delivery.kind === 'absent') return { status: 'missing', authority };
  if (delivery.kind === 'unknown') return { status: 'unknown', authority };
  if (delivery.kind !== 'payload' || typeof delivery.json !== 'string') return refuse('INVALID_PAYLOAD');
  if (!scope.tenantId || !scope.projectId) return refuse('INVALID_TRUST_CONTEXT');
  const parsed = kit.parseContractVersion(contract, '1.0.0', delivery.json);
  if (!parsed.ok) return fromCheck(parsed);
  const value = parsed.value;
  if (!record(value)) return refuse('INVALID_PAYLOAD');
  // Records with no scope fields (EvidenceProjection) cannot be scope-checked from the payload; the caller reports that explicitly.
  if (Object.keys(trusted).length) {
    const bound = kit.checkTrustedContext(value, trusted);
    if (!bound.ok) return fromCheck(bound);
  }
  if (value.environment !== scope.environment || value.billing_mode !== scope.billingMode) return refuse('PARTITION_MISMATCH', value.environment !== scope.environment ? '/environment' : '/billing_mode');
  if (request.expectedDigest !== undefined && kit.hashManifest(value) !== request.expectedDigest) return refuse('DIGEST_MISMATCH');
  return { value };
}

/** Freshness from the producer's `observed_at` against the host clock and host policy. */
function freshness(request: Common, observedAt: unknown): Readonly<{ stale: boolean; ageMs: number }> | ProjectionResult<never> {
  const now = Date.parse(request.now), observed = typeof observedAt === 'string' ? Date.parse(observedAt) : Number.NaN;
  if (!Number.isFinite(now) || !Number.isFinite(observed) || !Number.isFinite(request.maxAgeMs) || request.maxAgeMs < 0) return refuse('INVALID_TRUST_CONTEXT', '/observed_at');
  const ageMs = now - observed;
  if (ageMs < -(request.maxFutureSkewMs ?? 5000)) return refuse('FUTURE_DATED', '/observed_at');
  return { stale: ageMs > request.maxAgeMs, ageMs: Math.max(0, ageMs) };
}
function finish<T>(request: Common, observedAt: unknown, data: T): ProjectionResult<T> {
  const fresh = freshness(request, observedAt);
  if ('status' in fresh) return fresh;
  return fresh.stale ? { status: 'stale', authority, data, ageMs: fresh.ageMs } : { status: 'ready', authority, data };
}
const trustedOf = (scope: ContractScope, extra: Record<string, string> = {}) => ({ tenant_id: scope.tenantId, project_id: scope.projectId, ...extra });
const partitionOf = (scope: ContractScope) => ({ environment: scope.environment, billingMode: scope.billingMode }) as const;

/* ---- FinancialSummary ------------------------------------------------------------------------------------------- */
export type MetricProjection = Readonly<{ amount: AmountDisplay; definition: Readonly<{ id: string; revision: number }>; sourceCount: number }>;
export type SummaryProjection = Readonly<{
  summaryId: string; revision: number; period: Readonly<{ start: string; end: string }>; currency: string; scale: number;
  partition: ReturnType<typeof partitionOf>;
  /** Independent lifecycle axes; none is derived from another. */
  axes: Readonly<{ valuation: 'unknown' | 'estimated' | 'confirmed'; settlement: string; reconciliation: string; reservation: string; completeness: 'unknown' | 'incomplete' | 'complete' }>;
  coverage: Readonly<{ observed: number; expected: number | null; missingSources: readonly string[] }>;
  metrics: Readonly<Record<string, MetricProjection>>;
  /** Requested metrics the record does not contain: shown as unavailable, never as zero. */
  missingMetrics: readonly string[];
  requested: Readonly<Record<string, AmountDisplay>>;
  badges: readonly BadgeState[];
  observedAt: string; ingestedAt: string; producerRevision: string;
}>;
const VALUATION = { unknown: 'unknown', estimated: 'estimated', provider_confirmed: 'confirmed' } as const;
const MODE_BADGE: Record<BillingMode, BadgeState> = { live: 'live', sandbox: 'sandbox', simulated: 'fixture' };

export function readFinancialSummary(request: SummaryRequest): ProjectionResult<SummaryProjection> {
  const { kit, scope } = request;
  const taken = intake('FinancialSummary', request, trustedOf(scope));
  if ('status' in taken) return taken;
  const v = taken.value as Wire; // validated by the package parser above
  const checked = kit.checkFinancialSummary(v, {
    scope: trustedOf(scope), now: request.now, policy_version: '1.0.0', references: request.references,
    currency: request.currency, included_environments: [scope.environment], included_billing_modes: [scope.billingMode],
  });
  if (!checked.ok) return fromCheck(checked);
  const metrics: Record<string, MetricProjection> = {};
  for (const [name, metric] of Object.entries<Wire>(v.metrics)) {
    const amount: AmountDisplay = metric.status === 'known'
      ? { status: 'available', text: metric.value.amount, currency: metric.value.currency }
      : { status: 'unknown' };
    metrics[name] = { amount, definition: { id: metric.definition_ref.id, revision: metric.definition_ref.revision }, sourceCount: metric.source_refs.length };
  }
  const requested: Record<string, AmountDisplay> = {}, missingMetrics: string[] = [];
  for (const name of request.metricNames ?? []) {
    const found = Object.hasOwn(metrics, name) ? metrics[name] : undefined;
    if (found) requested[name] = found.amount; else { requested[name] = { status: 'unavailable' }; missingMetrics.push(name); }
  }
  const badges: BadgeState[] = [MODE_BADGE[scope.billingMode as BillingMode], VALUATION[v.valuation_basis as keyof typeof VALUATION],
    v.reconciliation === 'matched' ? 'reconciled' : 'unreconciled'];
  if (v.completeness !== 'complete') badges.push('partial');
  const data: SummaryProjection = {
    summaryId: v.summary_id, revision: v.revision, period: { start: v.period.start, end: v.period.end }, currency: v.currency, scale: v.scale,
    partition: partitionOf(scope),
    axes: { valuation: VALUATION[v.valuation_basis as keyof typeof VALUATION], settlement: v.settlement, reconciliation: v.reconciliation, reservation: v.reservation_state, completeness: v.completeness },
    coverage: { observed: v.coverage.observed, expected: v.coverage.expected, missingSources: [...v.coverage.missing_sources] },
    metrics, missingMetrics, requested, badges, observedAt: v.observed_at, ingestedAt: v.ingested_at, producerRevision: v.producer.source_revision,
  };
  const result = finish(request, v.observed_at, data);
  if (result.status === 'stale') return { ...result, data: { ...data, badges: [...badges, 'stale'] } };
  return result;
}

/* ---- Sanitized evidence / status projections ---------------------------------------------------------------------- */
export type EvidenceView = Readonly<{
  evidenceId: string; outcome: 'passed' | 'failed' | 'blocked' | 'unknown'; component: Readonly<{ name: string; sourceRevision: string }>;
  partition: ReturnType<typeof partitionOf>;
  /** EvidenceProjection carries no tenant or project, so scope cannot be verified from the payload; it is bound only by the host's request. */
  scopeBinding: 'host_request_only';
}>;
/** `EvidenceProjection` has no timestamp, so freshness cannot be assessed here: it is never reported as fresh by inference. */
export function readEvidenceProjection(request: Omit<Common, 'now' | 'maxAgeMs'>): ProjectionResult<EvidenceView> {
  const taken = intake('EvidenceProjection', { ...request, now: '', maxAgeMs: 0 }, {});
  if ('status' in taken) return taken;
  const v = taken.value as Wire;
  return { status: 'ready', authority, data: { evidenceId: v.evidence_id, outcome: v.outcome, component: { name: v.component.name, sourceRevision: v.component.source_revision }, partition: partitionOf(request.scope), scopeBinding: 'host_request_only' } };
}

export type JobView = Readonly<{
  jobId: string; revision: number; state: string; outcome: 'unknown' | 'partial' | 'succeeded' | 'failed' | 'cancelled'; executionState: string; usageCompleteness: 'unknown' | 'incomplete' | 'complete';
  /** `null` stays null: unknown progress is not zero. */
  progress: Readonly<{ completed: number | null; total: number | null; unit: string }>;
  partition: ReturnType<typeof partitionOf>;
}>;
/** Structural + trusted-scope intake only; transition ordering needs the owner's prior record, which the dashboard does not hold. */
export function readJobStatus(request: Common): ProjectionResult<JobView> {
  const taken = intake('JobStatus', request, trustedOf(request.scope));
  if ('status' in taken) return taken;
  const v = taken.value as Wire;
  return finish(request, v.observed_at, { jobId: v.job_id, revision: v.revision, state: v.state, outcome: v.outcome, executionState: v.execution_state, usageCompleteness: v.usage_completeness, progress: { completed: v.progress.completed, total: v.progress.total, unit: v.progress.unit }, partition: partitionOf(request.scope) });
}

export type FulfillmentView = Readonly<{
  orderId: string; revision: number; normalizedStatus: string; submissionOutcome: string; executionUncertainty: string; cancellation: string; effectiveAt: string;
  partition: ReturnType<typeof partitionOf>;
}>;
/** `expectedOrderId` is the order the authorized route asked for. Supplier/transition checks need owner context and are not claimed. */
export function readFulfillmentStatus(request: Common & Readonly<{ expectedOrderId: string }>): ProjectionResult<FulfillmentView> {
  const taken = intake('FulfillmentStatus', request, trustedOf(request.scope, { order_id: request.expectedOrderId }));
  if ('status' in taken) return taken;
  const v = taken.value as Wire;
  return finish(request, v.observed_at, { orderId: v.order_id, revision: v.revision, normalizedStatus: v.normalized_status, submissionOutcome: v.submission_outcome, executionUncertainty: v.execution_uncertainty, cancellation: v.cancellation, effectiveAt: v.effective_at, partition: partitionOf(request.scope) });
}
