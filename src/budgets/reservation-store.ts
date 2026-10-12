import { Value } from '@sinclair/typebox/value';
import { budgetDigest, normalizedBudgetRequest, verifyBudgetSource, verifyReservationHost, CurrentReservationRequestSchema, PartialAcknowledgementRequestSchema, type BudgetEvidencePort, type BudgetReservationAuthorityPort, type BudgetReference, type CurrentReservationRequest, type PartialAcknowledgementRequest } from './authority.js';
import { Type, type Static } from '@sinclair/typebox';
import {
  authorizeFinanceOperation,
  errorEnvelope,
  failure,
  type ApiResult,
  type Clock,
  type ErrorEnvelope,
  type FinanceAuthorizationPort,
  type FinanceOperation,
  type TrustedContextPort,
  type TrustedScope,
  type Validation,
} from '../shared/contracts.js';
import { bindFinancialDatabaseScope } from '../shared/database-scope.js';
import {
  validateReleaseReservationCommandBoundary,
  validateReservationRequestBoundary,
  validateSettleReservationCommandBoundary,
  type AuthorizationDecision,
  type MarkDispatchedCommand,
  type ReleaseReservationCommand,
  type ReservationRequest,
  type SettleReservationCommand,
  type ReservationSnapshot,
} from './index.js';

/* ------------------------------------------------------------------ *
 * CI-05A: atomic project budget reservations and bounded authorization.
 *
 * The authoritative budget state is an append-only event log
 * (`budget_reservation_events`) governed by a versioned, append-only
 * budget policy (`budget_scope_policies`). Capacity is a projection over
 * those events — never a mutable counter — so a rebuild from the log is
 * always equal to the enforced number. Concurrency is serialized per
 * (tenant, project, environment, billing_mode, currency) partition with a
 * transaction-scoped PostgreSQL advisory lock under READ COMMITTED plus a
 * bounded `lock_timeout`; a unique idempotency binding makes retries reuse
 * the single existing hold. Replaying a key is honored only for the identical
 * normalized original request; anything else is a typed IDEMPOTENCY_CONFLICT.
 * Every operation shares one finite end-to-end deadline (authority, connection
 * and statements). Work that has not reached its COMMIT when the deadline passes
 * is abandoned and rolled back. A timeout while awaiting COMMIT acknowledgement
 * returns the retryable unavailable result, but the transaction outcome is
 * ambiguous: the hold or lifecycle event may have persisted, so the caller must
 * retry with the same idempotency key (which replays it or reports a conflict).
 * Budget authority is NOT product-purchase
 * authority: these records only ration spend against a project limit.
 * ------------------------------------------------------------------ */

/** The reviewed budget decision policy version pinned by this leaf. */
export const BUDGET_DECISION_POLICY_VERSION = 'ci-budget-policy-1.0.0' as const;

/** Bounded wait, in milliseconds, for the per-partition authority lock before returning `unavailable`. */
export const DEFAULT_AUTHORITY_WAIT_MS = 2_000;
/** Upper bound for a configured end-to-end authority wait; zero, infinite and larger values are rejected. */
export const MAX_AUTHORITY_WAIT_MS = 60_000;
/** Retry guidance returned to callers when authorization is temporarily unavailable. */
export const DEFAULT_RETRY_AFTER_MS = 1_000;

export interface BudgetQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number | null;
}

/** Structural subset implemented by a node-postgres PoolClient. */
export interface BudgetTransactionPort {
  query(text: string, values?: readonly unknown[]): Promise<BudgetQueryResult>;
  release(): void;
}

/** Inject an existing host-managed pool; this module never opens a hidden connection. */
export interface BudgetDatabasePort {
  connect(): Promise<BudgetTransactionPort>;
}

export interface BudgetRuntimePorts {
  readonly database: BudgetDatabasePort;
  readonly trustedContext: TrustedContextPort;
  readonly clock: Clock;
  /** Current operation-scoped host authority; missing configuration denies writes and reads. */
  readonly financeAuthority?: FinanceAuthorizationPort;
  /** Bounded wait for the partition authority lock before returning unavailable. */
  readonly authorityWaitMs?: number;
  readonly reservationAuthority?: BudgetReservationAuthorityPort;
  readonly budgetEvidence?: BudgetEvidencePort;
}

const VersionedReferenceSchema = Type.Object({
  contract: Type.String({ minLength: 1 }), schema_version: Type.Literal('1.0.0'), id: Type.String({ minLength: 1 }),
  revision: Type.Integer({ minimum: 0 }), content_hash: Type.String({ pattern: '^sha256:[a-f0-9]{64}$' }),
}, { additionalProperties: false });
type VersionedReference = Static<typeof VersionedReferenceSchema>;

export const BudgetPolicyChangeRequestSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'), requestId: Type.String({ minLength: 1, maxLength: 128 }),
  idempotencyKey: Type.String({ minLength: 1, maxLength: 200 }),
  scope: Type.Object({
    tenantId: Type.String({ minLength: 1, maxLength: 128 }), projectId: Type.String({ minLength: 1, maxLength: 128 }),
    environment: Type.Union([Type.Literal('development'), Type.Literal('test'), Type.Literal('production')]),
    billingMode: Type.Union([Type.Literal('live'), Type.Literal('sandbox'), Type.Literal('simulated')]),
    actorId: Type.String({ minLength: 1, maxLength: 128 }),
  }, { additionalProperties: false }),
  currency: Type.String({ pattern: '^[A-Z]{3}$' }),
  limitAmount: Type.String({ pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,18})?$', maxLength: 40 }),
  expectedPolicyRevision: Type.Integer({ minimum: 0 }),
  actorReference: Type.String({ minLength: 1, maxLength: 200 }),
  reasonReference: Type.String({ minLength: 1, maxLength: 200 }),
  sourceAuthorityRef: VersionedReferenceSchema,
  expectedLedgerRevision: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });
export type BudgetPolicyChangeRequest = Static<typeof BudgetPolicyChangeRequestSchema>;

export interface BudgetPolicyReceipt {
  readonly schemaVersion: '1.0.0';
  readonly requestId: string;
  readonly status: 'applied' | 'denied' | 'replay' | 'stale' | 'conflict';
  readonly policyVersionId: string;
  readonly policyRevision: number;
  readonly currency: string;
  readonly effectiveLimit: string;
  readonly previousLimit: string;
  readonly effectiveConsumedSpend: string;
  readonly activeUnconsumedCommitments: string;
  readonly replayedStatus?: 'denied' | 'stale';
  readonly decisionPolicyVersion: typeof BUDGET_DECISION_POLICY_VERSION;
  readonly policyRef: VersionedReference;
}

export type ReservationLifecycleState = 'held' | 'dispatched' | 'partially_settled' | 'settled' | 'released' | 'expired';

export interface ReservationCommandOutcome {
  readonly schemaVersion: '1.0.0';
  readonly requestId: string;
  readonly status: 'applied' | 'replay' | 'conflict' | 'stale_revision';
  readonly reservationId: string;
  readonly state: ReservationLifecycleState;
  readonly heldAmount: string;
  readonly consumedAmount: string;
  readonly releasedAmount: string;
  readonly outstandingHold: string;
  /** Observed consumption above the hold (variance); real spend is recorded in full, never clamped to the hold. */
  readonly overrunAmount: string;
  readonly currency: string;
  readonly revision: number;
  readonly usageFinality: 'unknown' | 'partial' | 'final';
}

export interface CapacitySnapshot {
  readonly schemaVersion: '1.0.0';
  readonly requestId: string;
  readonly scope: TrustedScope;
  readonly currency: string;
  readonly limitAmount: string;
  readonly effectiveConsumedSpend: string;
  readonly outstandingHolds: string;
  readonly usedCapacity: string;
  readonly availableCapacity: string;
  readonly reservationCount: number;
  /** Advisory read only; it never creates a reservation or authorizes dispatch. */
  readonly advisoryOnly: true;
  readonly capacityState: 'unconfigured' | 'available' | 'near_limit' | 'exhausted' | 'over_limit';
  readonly unresolvedExposure: boolean;
  readonly policyWindow: 'project_lifetime';
  readonly policyRef: VersionedReference;
}

/* -------------------------------- exact decimal helpers -------------------------------- */

const SCALE = 1_000_000_000_000_000_000n;

function parseScaledDecimal(value: string): bigint {
  const match = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/.exec(value);
  if (!match) throw new Error('Decimal failed validation before exact parsing.');
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = BigInt(match[2] ?? '0');
  const fraction = BigInt((match[3] ?? '').padEnd(18, '0') || '0');
  return sign * (whole * SCALE + fraction);
}

function formatScaledDecimal(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / SCALE;
  const fraction = (absolute % SCALE).toString().padStart(18, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole.toString()}${fraction ? `.${fraction}` : ''}`;
}

/* -------------------------------- misc helpers -------------------------------- */

function makeError(operation: string, code: ErrorEnvelope['code'], requestId: string, message: string, retryable = false): ErrorEnvelope {
  return errorEnvelope('budgets', operation, code, requestId, message, retryable);
}

function asString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Database returned an unexpected budget value.');
  return value;
}

function fromRow(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  return typeof value === 'number' ? String(value) : asString(value);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify((function canon(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canon);
    if (typeof input === 'object' && input !== null) {
      const object = input as Record<string, unknown>;
      return Object.fromEntries(Object.keys(object).sort().map(key => [key, canon(object[key])]));
    }
    return input;
  })(value));
}

/** Compare two JSON-shaped values (objects or their serialized text) by canonical content. */
function sameJson(left: unknown, right: unknown): boolean {
  const normalize = (input: unknown): unknown => {
    if (typeof input !== 'string') return input ?? null;
    try { return JSON.parse(input); } catch { return input; }
  };
  return canonicalJson(normalize(left)) === canonicalJson(normalize(right));
}

async function hashValue(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Resolve the configured end-to-end wait; only a finite positive bounded integer is accepted. */
function resolveWaitMs(ports: BudgetRuntimePorts): number | null {
  const configured: unknown = ports.authorityWaitMs;
  if (configured === undefined) return DEFAULT_AUTHORITY_WAIT_MS;
  return typeof configured === 'number' && Number.isInteger(configured) && configured > 0 && configured <= MAX_AUTHORITY_WAIT_MS
    ? configured : null;
}

function invalidWaitFailure(operation: string, requestId: string): ApiResult<never> {
  return failure(makeError(operation, 'VALIDATION_ERROR', requestId,
    'The budget authority wait must be a finite positive integer number of milliseconds within the supported bound.'));
}

class DeadlineExceeded extends Error {}

/**
 * Shared end-to-end deadline for one operation. Once the deadline fires before
 * the commit statement is issued, every later checkpoint throws so late work
 * can never persist a hold after `unavailable` was reported.
 */
class DeadlineGate {
  expired = false;
  committing = false;
  private readonly deadlineAt: number;
  constructor(waitMs: number) { this.deadlineAt = Date.now() + waitMs; }
  remainingMs(): number { return Math.max(1, Math.ceil(this.deadlineAt - Date.now())); }
  async wait<T>(work: Promise<T>): Promise<T> {
    this.checkpoint();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([work, new Promise<T>((_resolve,reject) => {
        timer=setTimeout(()=>{this.expired=true;reject(new DeadlineExceeded('budget verifier deadline exceeded'));},this.remainingMs());
      })]);
    } finally { if(timer!==undefined)clearTimeout(timer); }
  }
  checkpoint(): void { if (this.expired) throw new DeadlineExceeded('budget deadline exceeded'); }
  /** The commit is the point of no return: its outcome is unknown until acknowledged, and the deadline still applies. */
  beginCommit(): void { this.checkpoint(); this.committing = true; }
}

async function runBounded<T>(waitMs: number, onTimeout: () => T, body: (gate: DeadlineGate) => Promise<T>): Promise<T> {
  const gate = new DeadlineGate(waitMs);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>(resolve => {
    // The deadline also applies while a COMMIT is unacknowledged. The commit may still land, so the
    // caller gets the retryable unavailable result; a retry with the same idempotency key replays
    // (or conflicts with) whatever persisted and never frees or double-books the exposure.
    timer = setTimeout(() => { gate.expired = true; resolve(onTimeout()); }, waitMs);
  });
  const work = body(gate);
  work.catch(() => undefined);
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function trustedNow(ports: BudgetRuntimePorts): Date | null {
  try {
    const now = ports.clock.now();
    return now instanceof Date && Number.isFinite(now.getTime()) ? now : null;
  } catch {
    return null;
  }
}

async function authorizeScope(
  scope: TrustedScope,
  requestId: string,
  ports: BudgetRuntimePorts,
  requestOperation: string,
  operation: FinanceOperation,
): Promise<ErrorEnvelope | null> {
  const authorization = await authorizeFinanceOperation({
    module: 'budgets', requestOperation, operation, scope, requestId, clock: ports.clock,
    financeAuthority: ports.financeAuthority,
  });
  if (authorization.ok) return null;
  // A temporarily unavailable authority maps to a retryable budget-unavailable envelope.
  if (authorization.error.code === 'SOURCE_UNAVAILABLE') {
    return makeError(requestOperation, 'BUDGET_UNAVAILABLE', requestId,
      'Budget authorization is temporarily unavailable; retry the identical idempotent request.', true);
  }
  return authorization.error;
}

async function rollback(client: BudgetTransactionPort): Promise<void> {
  await client.query('ROLLBACK').catch(() => undefined);
}

function partitionLockKey(scope: TrustedScope, currency: string): string {
  return `ci05a-budget:${scope.tenantId}:${scope.projectId}:${scope.environment}:${scope.billingMode}:${currency}`;
}

/** Bind the remaining end-to-end budget to every statement of the open transaction. */
async function bindDeadline(client: BudgetTransactionPort, gate: DeadlineGate): Promise<void> {
  gate.checkpoint();
  const remaining = gate.remainingMs();
  await client.query(`SET LOCAL statement_timeout = '${remaining}ms'`);
  await client.query(`SET LOCAL lock_timeout = '${remaining}ms'`);
}

/** Acquire the per-partition authority lock within the transaction's bounded deadline. */
async function acquirePartitionLock(
  client: BudgetTransactionPort,
  scope: TrustedScope,
  currency: string,
  gate: DeadlineGate,
): Promise<boolean> {
  gate.checkpoint();
  try {
    // Existing ledger writers use this scope lock. Always lock ledger before the currency partition.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ci02-ledger:${scope.tenantId}:${scope.projectId}:${scope.environment}:${scope.billingMode}`]);
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [partitionLockKey(scope, currency)]);
  } catch {
    return false;
  }
  gate.checkpoint();
  return true;
}

interface PartitionCapacity {
  readonly limit: bigint;
  readonly consumed: bigint;
  readonly outstandingHolds: bigint;
  readonly used: bigint;
  readonly available: bigint;
  readonly reservationCount: number;
  readonly unresolvedExposure: boolean;
  readonly ledgerRevision: number;
  readonly policy: { id: string; revision: number; contentHash: string } | null;
}

async function currentPolicy(
  client: BudgetTransactionPort,
  scope: TrustedScope,
  currency: string,
): Promise<{ id: string; revision: number; limit: bigint; contentHash: string } | null> {
  const result = await client.query(
    `SELECT policy_version_id, policy_revision, limit_amount::text AS limit_amount, content_hash
     FROM cost_intelligence.budget_scope_policies
     WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4 AND currency = $5
     ORDER BY policy_revision DESC LIMIT 1`,
    [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, currency],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: asString(row.policy_version_id),
    revision: Number(row.policy_revision),
    limit: parseScaledDecimal(asString(row.limit_amount)),
    contentHash: asString(row.content_hash),
  };
}

/** Project enforced capacity from the event log; this equals a full rebuild of the partition. */
async function projectCapacity(
  client: BudgetTransactionPort,
  scope: TrustedScope,
  currency: string,
): Promise<PartitionCapacity> {
  const policy = await currentPolicy(client, scope, currency);
  const aggregate = await client.query(
    `WITH effective_spend AS (
       SELECT e.* FROM cost_intelligence.financial_ledger_events e
       WHERE e.tenant_id=$1 AND e.project_id=$2 AND e.environment=$3 AND e.billing_mode=$4 AND e.currency=$5
         AND e.financial_effect AND e.classification IN ('direct_cost','supplier_expense','operating_expense','payable_labor')
         AND NOT EXISTS (SELECT 1 FROM cost_intelligence.financial_ledger_events n WHERE n.supersedes_event_id=e.event_id)
     ), attempt_spend AS (
       SELECT billable_attempt_id, greatest(coalesce(sum(amount),0),0) AS amount, bool_or(amount IS NULL) AS unknown
       FROM effective_spend WHERE billable_attempt_id IS NOT NULL GROUP BY billable_attempt_id
     ), per_reservation AS (
       SELECT reservation_id, (array_agg(billable_attempt_id ORDER BY event_sequence))[1] AS attempt_id,
              sum(held_amount) AS hold, sum(released_amount) AS released, max(consumed_amount) AS consumed,
              (array_agg(usage_finality ORDER BY event_sequence DESC))[1] AS finality
       FROM cost_intelligence.budget_reservation_events
       WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND currency=$5 GROUP BY reservation_id
     ), joined AS (
       SELECT r.*, greatest(r.consumed,coalesce(l.amount,0)) AS effective_consumed,
              greatest(r.hold-r.released-greatest(r.consumed,coalesce(l.amount,0)),0) AS outstanding,
              coalesce(l.unknown,false) OR (r.finality='unknown' AND r.consumed>0) AS unknown
       FROM per_reservation r LEFT JOIN attempt_spend l ON l.billable_attempt_id=r.attempt_id
     ), unmatched AS (
       SELECT coalesce(sum(e.amount),0) AS amount, coalesce(bool_or(e.amount IS NULL),false) AS unknown
       FROM effective_spend e WHERE e.billable_attempt_id IS NULL OR NOT EXISTS (SELECT 1 FROM per_reservation r WHERE r.attempt_id=e.billable_attempt_id)
     )
     SELECT (SELECT count(*) FROM per_reservation)::int AS reservation_count,
       (coalesce(sum(effective_consumed),0)+greatest((SELECT amount FROM unmatched),0))::text AS consumed,
       coalesce(sum(outstanding),0)::text AS outstanding_holds,
       (coalesce(sum(effective_consumed+outstanding),0)+greatest((SELECT amount FROM unmatched),0))::text AS used,
       (coalesce(bool_or(unknown),false) OR (SELECT unknown FROM unmatched)) AS unresolved_exposure,
       (SELECT count(*) FROM cost_intelligence.financial_ledger_events WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4)::int AS ledger_revision
     FROM joined`,
    [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, currency],
  );
  const row = aggregate.rows[0] ?? {};
  const consumed = parseScaledDecimal(fromRow(row, 'consumed') ?? '0');
  const outstandingHolds = parseScaledDecimal(fromRow(row, 'outstanding_holds') ?? '0');
  const used = parseScaledDecimal(fromRow(row, 'used') ?? '0');
  const limit = policy ? policy.limit : 0n;
  const available = limit - used > 0n ? limit - used : 0n;
  return {
    limit, consumed, outstandingHolds, used, available,
    reservationCount: Number(row.reservation_count ?? 0),
    unresolvedExposure: row.unresolved_exposure === true, ledgerRevision: Number(row.ledger_revision ?? 0),
    policy: policy ? { id: policy.id, revision: policy.revision, contentHash: policy.contentHash } : null,
  };
}

/* -------------------------------- change budget policy -------------------------------- */

/** Append a new, versioned budget policy limit. Future versions never reinterpret existing reservations. */
export async function changeBudgetPolicy(
  value: unknown,
  ports: BudgetRuntimePorts,
): Promise<ApiResult<BudgetPolicyReceipt>> {
  const outer = ((): Validation<BudgetPolicyChangeRequest> => {
    const requestId = requestIdOf(value);
    if (typeof value === 'object' && value !== null && 'schemaVersion' in value && (value as Record<string, unknown>).schemaVersion !== '1.0.0') {
      return { ok: false, error: makeError('changeBudget', 'UNSUPPORTED_VERSION', requestId, 'The budget policy change schema version is not supported.') };
    }
    const { Value } = requireValue();
    if (!Value.Check(BudgetPolicyChangeRequestSchema, value)) {
      return { ok: false, error: makeError('changeBudget', 'VALIDATION_ERROR', requestId, 'The budget policy change does not match the published schema.') };
    }
    return { ok: true, value: value as BudgetPolicyChangeRequest };
  })();
  if (!outer.ok) return failure(outer.error);
  const request = structuredClone(outer.value);
  const scope = request.scope as TrustedScope;

  const waitMs = resolveWaitMs(ports);
  if (waitMs === null) return invalidWaitFailure('changeBudget', request.requestId);
  const unavailable = (): ApiResult<BudgetPolicyReceipt> => failure(makeError('changeBudget', 'BUDGET_UNAVAILABLE', request.requestId,
    'Budget policy persistence is temporarily unavailable; retry the identical idempotent request.', true));

  return runBounded(waitMs, unavailable, async gate => {
    let client: BudgetTransactionPort | undefined;
    let inTransaction = false;
    try {
      const authorizationError = await authorizeScope(scope, request.requestId, ports, 'changeBudget', 'budgets.changeBudget');
      gate.checkpoint();
      if (authorizationError) return failure(authorizationError);
      if (!trustedNow(ports)) return failure(makeError('changeBudget', 'BUDGET_UNAVAILABLE', request.requestId, 'The trusted budget clock is unavailable.', true));
      if (!ports.budgetEvidence) return unavailable();
      if (!(await verifySource(ports, request as unknown as Record<string, unknown>, 'changeBudget', request.sourceAuthorityRef))) return failure(makeError('changeBudget', 'FORBIDDEN_SCOPE', request.requestId, 'Current authenticated budget policy source evidence is missing.'));

      client = await ports.database.connect();
      gate.checkpoint();
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await bindFinancialDatabaseScope(client, scope);
      await bindDeadline(client, gate);
      if (!(await acquirePartitionLock(client, scope, request.currency, gate))) {
        await rollback(client); inTransaction = false;
        return failure(makeError('changeBudget', 'BUDGET_UNAVAILABLE', request.requestId, 'The budget partition is busy; retry the identical idempotent request.', true));
      }

      const replay = await client.query(
        `SELECT policy_version_id, policy_revision, currency, limit_amount::text AS limit_amount, content_hash,
                actor_reference, reason_reference, source_authority_ref, change_request,
                (SELECT limit_amount::text FROM cost_intelligence.budget_scope_policies previous WHERE previous.policy_version_id=budget_scope_policies.supersedes_policy_version_id) AS prior_limit
         FROM cost_intelligence.budget_scope_policies
         WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4 AND idempotency_key = $5`,
        [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, request.idempotencyKey],
      );
      const existing = await currentPolicy(client, scope, request.currency);
      const capacity = await projectCapacity(client, scope, request.currency);
      if (replay.rows.length) {
        const row = replay.rows[0] as Record<string, unknown>;
        // A replay must match the normalized original change; otherwise it is a typed conflict.
        const identical = sameJson(row.change_request, normalizedBudgetRequest(request as unknown as Record<string, unknown>)) && fromRow(row, 'currency') === request.currency
          && fromRow(row, 'limit_amount') !== null
          && parseScaledDecimal(asString(row.limit_amount)) === parseScaledDecimal(request.limitAmount)
          && Number(row.policy_revision) - 1 === request.expectedPolicyRevision
          && fromRow(row, 'actor_reference') === request.actorReference
          && fromRow(row, 'reason_reference') === request.reasonReference
          && sameJson(row.source_authority_ref, request.sourceAuthorityRef);
        if (!identical) {
          await rollback(client); inTransaction = false;
          return failure(makeError('changeBudget', 'IDEMPOTENCY_CONFLICT', request.requestId,
            'The idempotency key was already used for a different budget policy change.'));
        }
        gate.beginCommit();
        await client.query('COMMIT'); inTransaction = false;
        return {
          ok: true,
          value: {
            schemaVersion: '1.0.0', requestId: request.requestId, status: 'replay',
            policyVersionId: asString(row.policy_version_id), policyRevision: Number(row.policy_revision), currency: request.currency,
            effectiveLimit: formatScaledDecimal(parseScaledDecimal(asString(row.limit_amount))),
            previousLimit: formatScaledDecimal(parseScaledDecimal(fromRow(row,'prior_limit') ?? '0')),
            decisionPolicyVersion: BUDGET_DECISION_POLICY_VERSION,
            effectiveConsumedSpend: formatScaledDecimal(capacity.consumed), activeUnconsumedCommitments: formatScaledDecimal(capacity.outstandingHolds),
            policyRef: { contract: 'cost-intelligence.budget-policy', schema_version: '1.0.0', id: asString(row.policy_version_id), revision: Number(row.policy_revision), content_hash: asString(row.content_hash) },
          },
        };
      }

      const priorDecision=await client.query(`SELECT command_request,command_receipt FROM cost_intelligence.budget_policy_decisions WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND idempotency_key=$5`,[scope.tenantId,scope.projectId,scope.environment,scope.billingMode,request.idempotencyKey]);
      if(priorDecision.rows[0]){
        const prior=priorDecision.rows[0];if(!sameJson(prior.command_request,normalizedBudgetRequest(request as unknown as Record<string,unknown>))){await rollback(client);inTransaction=false;return failure(makeError('changeBudget','IDEMPOTENCY_CONFLICT',request.requestId,'This policy command key already binds another request.'));}
        const receipt=prior.command_receipt as BudgetPolicyReceipt;gate.beginCommit();await client.query('COMMIT');inTransaction=false;
        return {ok:true,value:{...receipt,requestId:request.requestId,status:'replay',...(receipt.status==='denied'||receipt.status==='stale'?{replayedStatus:receipt.status}:{})}};
      }
      const currentRevision = existing?.revision ?? 0;
      if (request.expectedPolicyRevision !== currentRevision || (request.expectedLedgerRevision !== undefined && request.expectedLedgerRevision !== capacity.ledgerRevision)) {
        const receipt: BudgetPolicyReceipt = {
            schemaVersion: '1.0.0', requestId: request.requestId, status: 'stale',
            policyVersionId: existing?.id ?? 'none', policyRevision: currentRevision, currency: request.currency,
            effectiveLimit: existing ? formatScaledDecimal(existing.limit) : '0',
            previousLimit: existing ? formatScaledDecimal(existing.limit) : '0',
            decisionPolicyVersion: BUDGET_DECISION_POLICY_VERSION,
            effectiveConsumedSpend: formatScaledDecimal(capacity.consumed), activeUnconsumedCommitments: formatScaledDecimal(capacity.outstandingHolds),
            policyRef: decisionReference(existing),
          };
        await persistPolicyDecision(client,request,receipt);gate.beginCommit();await client.query('COMMIT');inTransaction=false;
        return {ok:true,value:receipt};
      }

      if (parseScaledDecimal(request.limitAmount) < capacity.used || capacity.unresolvedExposure && existing !== null && parseScaledDecimal(request.limitAmount) < existing.limit) {
        const receipt: BudgetPolicyReceipt = { schemaVersion: '1.0.0', requestId: request.requestId, status: 'denied', policyVersionId: existing?.id ?? 'none', policyRevision: currentRevision, currency: request.currency,
          effectiveLimit: formatScaledDecimal(existing?.limit ?? 0n), previousLimit: formatScaledDecimal(existing?.limit ?? 0n),
          effectiveConsumedSpend: formatScaledDecimal(capacity.consumed), activeUnconsumedCommitments: formatScaledDecimal(capacity.outstandingHolds),
          decisionPolicyVersion: BUDGET_DECISION_POLICY_VERSION, policyRef: decisionReference(existing) };
        await persistPolicyDecision(client,request,receipt);gate.beginCommit();await client.query('COMMIT');inTransaction=false;
        return {ok:true,value:receipt};
      }

      const nextRevision = currentRevision + 1;
      const policyVersionId = globalThis.crypto.randomUUID();
      const contentHash = await hashValue({
        tenant: scope.tenantId, project: scope.projectId, environment: scope.environment, billingMode: scope.billingMode,
        currency: request.currency, limit: request.limitAmount, revision: nextRevision, policy: BUDGET_DECISION_POLICY_VERSION,
      });
      gate.checkpoint();
      await client.query(
        `INSERT INTO cost_intelligence.budget_scope_policies
          (policy_version_id, tenant_id, project_id, environment, billing_mode, currency, policy_revision,
           limit_amount, alert_threshold_percent, decision_policy_version, idempotency_key, actor_reference,
           reason_reference, source_authority_ref, supersedes_policy_version_id, content_hash, change_request)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,80,$9,$10,$11,$12,$13::jsonb,$14,$15,$16::jsonb)`,
        [policyVersionId, scope.tenantId, scope.projectId, scope.environment, scope.billingMode, request.currency, nextRevision,
          request.limitAmount, BUDGET_DECISION_POLICY_VERSION, request.idempotencyKey, request.actorReference,
          request.reasonReference, JSON.stringify(request.sourceAuthorityRef), existing?.id ?? null, contentHash, JSON.stringify(normalizedBudgetRequest(request as unknown as Record<string,unknown>))],
      );
      gate.beginCommit();
      await client.query('COMMIT'); inTransaction = false;
      return {
        ok: true,
        value: {
          schemaVersion: '1.0.0', requestId: request.requestId, status: 'applied',
          policyVersionId, policyRevision: nextRevision, currency: request.currency,
          effectiveLimit: formatScaledDecimal(parseScaledDecimal(request.limitAmount)),
          previousLimit: existing ? formatScaledDecimal(existing.limit) : '0',
          decisionPolicyVersion: BUDGET_DECISION_POLICY_VERSION,
          effectiveConsumedSpend: formatScaledDecimal(capacity.consumed), activeUnconsumedCommitments: formatScaledDecimal(capacity.outstandingHolds),
          policyRef: { contract: 'cost-intelligence.budget-policy', schema_version: '1.0.0', id: policyVersionId, revision: nextRevision, content_hash: contentHash },
        },
      };
    } catch {
      if (client && inTransaction) await rollback(client);
      return unavailable();
    } finally {
      if(client&&inTransaction)await rollback(client);
      client?.release();
    }
  });
}

/* -------------------------------- authorize reservation -------------------------------- */

function requireValue(): { Value: { Check(schema: unknown, value: unknown): boolean } } {
  // Deferred import avoids a hard dependency cycle at module init.
  return { Value: valueModule };
}

function decisionReference(policy: { id: string; revision: number; contentHash: string } | null): VersionedReference {
  return policy
    ? { contract: 'cost-intelligence.budget-policy', schema_version: '1.0.0', id: policy.id, revision: policy.revision, content_hash: policy.contentHash }
    : { contract: 'cost-intelligence.budget-policy', schema_version: '1.0.0', id: 'unconfigured', revision: 0, content_hash: `sha256:${'0'.repeat(64)}` };
}

/**
 * The hold a request needs. Only a complete estimate is bounded. An
 * incomplete/unknown estimate would need an authorized explicit maximum policy,
 * but no trusted resolver for `maximumPolicyRef` exists at the approved
 * boundary (the finance authority port receives only scope/operation/permission),
 * so a caller-supplied reference is never treated as authority: unbounded.
 */
function requiredHold(request: ReservationRequest): bigint | null {
  const estimate = request.estimate;
  return estimate.completeness === 'complete' ? parseScaledDecimal(estimate.knownSubtotal) : null;
}

function sameAmount(left: string, right: string): boolean {
  return parseScaledDecimal(left) === parseScaledDecimal(right);
}

/** Contradictory financial fields between the canonical request and the estimate. */
function financialBindingError(request: ReservationRequest): string | null {
  const canonical = request.canonicalRequest;
  const requested = canonical.requested;
  if (request.estimate.currency !== canonical.currency || requested.currency !== canonical.currency) {
    return 'The estimate and requested amount currency must match the reservation request currency.';
  }
  if (request.estimate.completeness === 'complete' && !sameAmount(requested.amount, request.estimate.knownSubtotal)) {
    return 'The canonical requested amount contradicts the complete estimate.';
  }
  const maximum = request.estimate.boundedConservativeMaximum;
  if (request.estimate.completeness === 'complete') {
    // A reference to a maximum policy has no persisted, replay-bound home and is never authority; refuse it rather than ignore it.
    if (request.estimate.maximumPolicyRef !== undefined) {
      return 'A maximum policy reference is not supported on a complete estimate; omit it.';
    }
    if (maximum !== undefined && parseScaledDecimal(maximum) < parseScaledDecimal(request.estimate.knownSubtotal)) {
      return 'The bounded conservative maximum cannot be below the known subtotal.';
    }
  }
  return null;
}

function policyRefMatches(canonicalRef: { id: string; revision: number; content_hash: string }, policy: { id: string; revision: number; contentHash: string }): boolean {
  return canonicalRef.id === policy.id && canonicalRef.revision === policy.revision && canonicalRef.content_hash === policy.contentHash;
}

/**
 * Atomically check applicable project capacity and create an idempotent
 * reservation hold before billable dispatch. The whole call, including the
 * host authority, the connection and every database statement, shares one
 * finite deadline. Work not yet at COMMIT when the deadline passes is rolled
 * back and cannot create a hold. A timeout while awaiting COMMIT acknowledgement
 * returns the retryable `unavailable` decision, but the transaction outcome is
 * ambiguous and the hold may have persisted: the caller must not dispatch and
 * must retry with the same idempotency key, which replays the hold if it
 * persisted (or reports a conflict for a different request).
 */
export async function authorizeReservation(
  value: unknown,
  ports: BudgetRuntimePorts,
): Promise<ApiResult<AuthorizationDecision>> {
  const validated = validateReservationRequestBoundary(value);
  if (!validated.ok) return failure(validated.error);
  const request = structuredClone(validated.value) as ReservationRequest;
  const scope = request.scope as TrustedScope;
  const requestId = request.requestId;
  const waitMs = resolveWaitMs(ports);
  if (waitMs === null) return invalidWaitFailure('authorize', requestId);
  const currency = request.estimate.currency;
  const unavailable = (): ApiResult<AuthorizationDecision> => ({ ok: true, value: unavailableDecision(requestId, request, currency, trustedNow(ports)) });

  return runBounded(waitMs, unavailable, async gate => {
    let client: BudgetTransactionPort | undefined;
    let inTransaction = false;
    try {
      const authorizationError = await authorizeScope(scope, requestId, ports, 'authorize', 'budgets.authorize');
      gate.checkpoint();
      if (authorizationError) return failure(authorizationError);
      const now = trustedNow(ports);
      if (!now) return failure(makeError('authorize', 'BUDGET_UNAVAILABLE', requestId, 'The trusted budget clock is unavailable.', true));

      if (!request.authorityBinding || !request.sourceAuthorityRef || !ports.reservationAuthority || !ports.budgetEvidence) return unavailable();
      if (Date.parse(request.canonicalRequest.expires_at) <= now.getTime()) return failure(makeError('authorize', 'VALIDATION_ERROR', requestId, 'The financial reservation expiry is not current.'));
      if (request.authorityBinding.budgetScopeId !== request.canonicalRequest.budget_scope_id || request.idempotencyKey !== request.canonicalRequest.idempotency_key
        || request.attemptBinding.billableAttemptId !== request.canonicalRequest.billable_attempt_id || request.attemptBinding.logicalOperationId !== request.canonicalRequest.logical_operation_id) return failure(makeError('authorize', 'VALIDATION_ERROR', requestId, 'Canonical and Finance economic identity must match exactly.'));
      if (request.authorityBinding.provider === 'openrouter' && currency !== 'USD') return failure(makeError('authorize', 'VALIDATION_ERROR', requestId, 'The OpenRouter authority mapping requires an exact USD partition.'));
      const source = await verifySource(ports, request as unknown as Record<string, unknown>, 'authorize', request.sourceAuthorityRef);
      if (!source) return failure(makeError('authorize', 'FORBIDDEN_SCOPE', requestId, 'Current authenticated estimate source evidence is missing.'));
      const host = await verifyReservationHost(ports.reservationAuthority, { scope, billableAttemptId: request.attemptBinding.billableAttemptId, binding: request.authorityBinding, sourceAuthorityRef: request.sourceAuthorityRef, phase: 'admission' }, now);
      gate.checkpoint();
      if (!host) return failure(makeError('authorize', 'FORBIDDEN_SCOPE', requestId, 'The current host target grant or lease is unavailable or revoked.'));
      let approvedMaximum: bigint | null = null;
      if (request.estimate.completeness !== 'complete' && request.estimate.maximumPolicyRef && request.estimate.boundedConservativeMaximum && source.maximum
        && sameJson(source.maximum.policyRef, request.estimate.maximumPolicyRef) && source.maximum.currency === currency
        && sameAmount(source.maximum.authorizedCap, request.estimate.boundedConservativeMaximum)
        && sameAmount(source.maximum.authorizedCap, request.canonicalRequest.requested.amount)
        && parseScaledDecimal(source.maximum.authorizedCap) >= parseScaledDecimal(request.estimate.knownSubtotal)) approvedMaximum = parseScaledDecimal(source.maximum.authorizedCap);
      // Cross-currency pooling is forbidden without explicit policy, and the
      // canonical requested amount may not contradict the estimate.
      const bindingError = financialBindingError(request);
      if (bindingError) return failure(makeError('authorize', 'VALIDATION_ERROR', requestId, bindingError));

      client = await ports.database.connect();
      gate.checkpoint();
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await bindFinancialDatabaseScope(client, scope);
      await bindDeadline(client, gate);
      if (!(await acquirePartitionLock(client, scope, currency, gate))) {
        await rollback(client); inTransaction = false;
        return unavailable();
      }

      // Idempotent retry: the key returns the single existing hold only when the
      // normalized original request matches; otherwise it is a typed conflict.
      const replay = await client.query(
        `SELECT reservation_id, event_type, event_sequence, currency, held_amount::text AS held_amount,
                partial_allowed_amount::text AS partial_allowed_amount, estimate_completeness,
                known_subtotal::text AS known_subtotal, bounded_maximum::text AS bounded_maximum, allow_partial,
                attempt_binding, policy_version_id, policy_ref, rate_card_ref, authorization_request, reservation_event_id, content_hash, authorized_cap::text AS authorized_cap
         FROM cost_intelligence.budget_reservation_events
         WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4 AND idempotency_key = $5
         ORDER BY event_sequence ASC LIMIT 1`,
        [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, request.idempotencyKey],
      );
      const capacity = await projectCapacity(client, scope, currency);
      if (replay.rows.length) {
        const row = replay.rows[0] as Record<string, unknown>;
        const eventType = fromRow(row, 'event_type');
        const storedPolicyRef = parseRef(row.policy_ref);
        const storedKnown = fromRow(row, 'known_subtotal');
        const storedMaximum = fromRow(row, 'bounded_maximum');
        const incomingMaximum = request.estimate.boundedConservativeMaximum;
        const identical = sameJson(row.authorization_request, normalizedBudgetRequest(request as unknown as Record<string, unknown>))
          && (eventType === 'authorized' || eventType === 'partially_authorized')
          && Number(row.event_sequence) === 1
          && fromRow(row, 'currency') === currency
          && fromRow(row, 'estimate_completeness') === request.estimate.completeness
          && storedKnown !== null && sameAmount(storedKnown, request.estimate.knownSubtotal)
          && (storedMaximum === null ? incomingMaximum === undefined : incomingMaximum !== undefined && sameAmount(storedMaximum, incomingMaximum))
          && row.allow_partial === request.allowPartialAuthorization
          && sameJson(row.attempt_binding, request.attemptBinding)
          && sameJson(row.rate_card_ref, request.estimate.rateCardRef)
          && storedPolicyRef !== null
          && policyRefMatches(request.canonicalRequest.policy_ref, { id: storedPolicyRef.id, revision: storedPolicyRef.revision, contentHash: storedPolicyRef.content_hash });
        if (!identical) {
          await rollback(client); inTransaction = false;
          return failure(makeError('authorize', 'IDEMPOTENCY_CONFLICT', requestId,
            'The idempotency key was already used for a different reservation request.'));
        }
        const held = parseScaledDecimal(fromRow(row, 'held_amount') ?? '0');
        const partial = fromRow(row, 'partial_allowed_amount');
        const status: AuthorizationDecision['status'] = eventType === 'authorized' ? 'authorized' : 'partial';
        gate.beginCommit();
        await client.query('COMMIT'); inTransaction = false;
        return {
          ok: true,
          value: buildDecision({
            requestId, request, currency, now, status,
            reservationId: asString(row.reservation_id), held, available: capacity.available,
            partialAllowed: partial === null ? null : parseScaledDecimal(partial),
            policyRef: storedPolicyRef!,
            rateCardRef: parseRef(row.rate_card_ref), evidenceRef: `ci05a:${asString(row.reservation_event_id)}`, evidenceHash: asString(row.content_hash), authorizedCap: parseScaledDecimal(fromRow(row,'authorized_cap') ?? '0'),
          }),
        };
      }

      const acknowledgementKey=await client.query(`SELECT acknowledgement_id FROM cost_intelligence.budget_reservation_acknowledgements WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND idempotency_key=$5`,[scope.tenantId,scope.projectId,scope.environment,scope.billingMode,request.idempotencyKey]);
      if(acknowledgementKey.rows.length){await rollback(client);inTransaction=false;return failure(makeError('authorize','IDEMPOTENCY_CONFLICT',requestId,'The key already identifies a partial acknowledgement.'));}
      // No applicable budget policy means no configured authority: deny by default.
      if (!capacity.policy) {
        await rollback(client); inTransaction = false;
        return { ok: true, value: buildDecision({ requestId, request, currency, now, status: 'denied', reservationId: 'none', held: 0n, available: capacity.available, partialAllowed: null, policyRef: decisionReference(null), rateCardRef: request.estimate.rateCardRef }) };
      }

      // The canonical policy reference must name the applicable stored policy
      // revision exactly; a stale or foreign reference never authorizes.
      if (!policyRefMatches(request.canonicalRequest.policy_ref, capacity.policy)) {
        await rollback(client); inTransaction = false;
        return failure(makeError('authorize', 'VALIDATION_ERROR', requestId,
          'The reservation policy reference is not the currently applicable budget policy; re-read the policy and resubmit.'));
      }

      const duplicateAttempt = await client.query(`SELECT reservation_id FROM cost_intelligence.budget_reservation_events WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND billable_attempt_id=$5 AND event_sequence=1`, [scope.tenantId,scope.projectId,scope.environment,scope.billingMode,request.attemptBinding.billableAttemptId]);
      if (duplicateAttempt.rows.length) { await rollback(client); inTransaction=false; return failure(makeError('authorize', 'IDEMPOTENCY_CONFLICT', requestId, 'This economic billable attempt already has a reservation; reuse its original key.')); }
      const need = request.estimate.completeness === 'complete' ? requiredHold(request) : approvedMaximum;
      if (capacity.unresolvedExposure) { await rollback(client);inTransaction=false;return unavailable(); }
      if (need === null) {
        // Unknown / unbounded pricing cannot auto-authorize.
        await rollback(client); inTransaction = false;
        return { ok: true, value: buildDecision({ requestId, request, currency, now, status: 'denied', reservationId: 'none', held: 0n, available: capacity.available, partialAllowed: null, policyRef: decisionReference(capacity.policy), rateCardRef: request.estimate.rateCardRef }) };
      }

      if(request.workPlan && (parseScaledDecimal(request.workPlan.unitMaximumAmount)<=0n || parseScaledDecimal(request.workPlan.unitMaximumAmount)*BigInt(request.workPlan.requestedUnits)!==need))return failure(makeError('authorize','VALIDATION_ERROR',requestId,'The source-authenticated work plan must equal the requested conservative cap.'));
      const reservationId = globalThis.crypto.randomUUID();
      let status: AuthorizationDecision['status'];
      let hold: bigint;
      let partialAllowed: bigint | null = null;
      if (need <= capacity.available) {
        status = 'authorized'; hold = need;
      } else if (request.allowPartialAuthorization && capacity.available > 0n) {
        status = 'partial'; hold = capacity.available;
        if (request.workPlan) { const unit = parseScaledDecimal(request.workPlan.unitMaximumAmount); if (unit <= 0n) return failure(makeError('authorize','VALIDATION_ERROR',requestId,'Partial work needs a positive conservative unit bound.')); hold = (hold / unit) * unit; }
        if (hold <= 0n) status = 'denied';
        partialAllowed = hold;
      } else {
        status = 'denied'; hold = 0n;
      }

      if (status === 'denied') {
        await rollback(client); inTransaction = false;
        return { ok: true, value: buildDecision({ requestId, request, currency, now, status, reservationId: 'none', held: 0n, available: capacity.available, partialAllowed: null, policyRef: decisionReference(capacity.policy), rateCardRef: request.estimate.rateCardRef }) };
      }

      const currentNow=trustedNow(ports);if(!currentNow)return unavailable();
      const finalScope=await gate.wait(authorizeScope(scope,requestId,ports,'authorize','budgets.authorize'));gate.checkpoint();if(finalScope)return failure(finalScope);
      const finalHost=await gate.wait(verifyReservationHost(ports.reservationAuthority,{scope,billableAttemptId:request.attemptBinding.billableAttemptId,binding:request.authorityBinding,sourceAuthorityRef:request.sourceAuthorityRef,phase:'admission'},currentNow));gate.checkpoint();
      const finalSource=await gate.wait(verifySource(ports,request as unknown as Record<string,unknown>,'authorize',request.sourceAuthorityRef));gate.checkpoint();
      if(!finalHost||!finalSource || approvedMaximum!==null && (!finalSource.maximum||!sameJson(finalSource.maximum.policyRef,request.estimate.maximumPolicyRef)||!sameAmount(finalSource.maximum.authorizedCap,formatScaledDecimal(approvedMaximum))||finalSource.maximum.currency!==currency))return failure(makeError('authorize','FORBIDDEN_SCOPE',requestId,'Current host or source authority changed during admission.'));
      const policyRef = decisionReference(capacity.policy);
      const eventId = globalThis.crypto.randomUUID();
      const contentHash = await hashValue({ reservationId, request: normalizedBudgetRequest(request as unknown as Record<string, unknown>), hold: formatScaledDecimal(hold), authorizedCap: formatScaledDecimal(need), status, currency, host, source });
      gate.checkpoint();
      await client.query(
        `INSERT INTO cost_intelligence.budget_reservation_events
          (reservation_event_id, tenant_id, project_id, environment, billing_mode, currency, reservation_id, event_sequence,
           event_type, decision_status, held_amount, consumed_amount, released_amount, estimate_completeness, known_subtotal,
           bounded_maximum, allow_partial, partial_allowed_amount, usage_finality, settlement_sequence, policy_version_id,
           rate_card_ref, policy_ref, idempotency_key, expected_revision, actor_reference, source_authority_ref,
           attempt_binding, logical_operation_id, billable_attempt_id, content_hash, authorization_request, authority_binding, financial_expires_at, authorized_cap, authority_evidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9,$10::numeric,0,0,$11,$12::numeric,$13::numeric,$14,$15,'unknown',NULL,$16,
           $17::jsonb,$18::jsonb,$19,NULL,$20,$21::jsonb,$22::jsonb,$23,$24,$25,$26::jsonb,$27::jsonb,$28::timestamptz,$29::numeric,$30::jsonb)`,
        [eventId, scope.tenantId, scope.projectId, scope.environment, scope.billingMode, currency, reservationId,
          status === 'authorized' ? 'authorized' : 'partially_authorized', status,
          formatScaledDecimal(hold), request.estimate.completeness, request.estimate.knownSubtotal,
          request.estimate.boundedConservativeMaximum === undefined ? null : formatScaledDecimal(parseScaledDecimal(request.estimate.boundedConservativeMaximum)),
          request.allowPartialAuthorization,
          partialAllowed === null ? null : formatScaledDecimal(partialAllowed), capacity.policy.id,
          request.estimate.rateCardRef === null ? null : JSON.stringify(request.estimate.rateCardRef),
          JSON.stringify(policyRef), request.idempotencyKey, scope.actorId,
          JSON.stringify(request.sourceAuthorityRef),
          JSON.stringify(request.attemptBinding), request.attemptBinding.logicalOperationId, request.attemptBinding.billableAttemptId, contentHash, JSON.stringify(normalizedBudgetRequest(request as unknown as Record<string, unknown>)), JSON.stringify(request.authorityBinding), request.canonicalRequest.expires_at, formatScaledDecimal(need), JSON.stringify({host, source})],
      );
      if (Date.parse(request.canonicalRequest.expires_at) <= (trustedNow(ports)?.getTime() ?? Infinity) || Date.parse(request.authorityBinding.leaseExpiresAt) <= (trustedNow(ports)?.getTime() ?? Infinity)) { await rollback(client); inTransaction=false; return unavailable(); }
      gate.beginCommit();
      await client.query('COMMIT'); inTransaction = false;
      const availableAfter = capacity.available - hold > 0n ? capacity.available - hold : 0n;
      return {
        ok: true,
        value: buildDecision({ requestId, request, currency, now, status, reservationId, held: hold, available: availableAfter, partialAllowed, policyRef, rateCardRef: request.estimate.rateCardRef, evidenceRef: `ci05a:${eventId}`, evidenceHash: contentHash, authorizedCap: need }),
      };
    } catch {
      if (client && inTransaction) await rollback(client);
      return unavailable();
    } finally {
      if(client&&inTransaction)await rollback(client);
      client?.release();
    }
  });
}

function parseRef(value: unknown): VersionedReference | null {
  if (value === null || value === undefined) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const { Value } = requireValue();
    return Value.Check(VersionedReferenceSchema, parsed) ? parsed as VersionedReference : null;
  } catch {
    return null;
  }
}

function unavailableDecision(requestId: string, request: ReservationRequest, currency: string, now: Date | null): AuthorizationDecision {
  return buildDecision({
    requestId, request, currency, now: now ?? new Date(0), status: 'unavailable',
    reservationId: 'none', held: 0n, available: 0n, partialAllowed: null,
    policyRef: decisionReference(null), rateCardRef: request.estimate.rateCardRef,
  });
}

function buildDecision(args: {
  requestId: string; request: ReservationRequest; currency: string; now: Date;
  status: AuthorizationDecision['status']; reservationId: string; held: bigint; available: bigint;
  partialAllowed: bigint | null; policyRef: VersionedReference; rateCardRef: VersionedReference | null;
  evidenceRef?: string; evidenceHash?: string; authorizedCap?: bigint;
}): AuthorizationDecision {
  const { request } = args;
  return {
    schemaVersion: '1.0.0', requestId: args.requestId, decidedAt: args.now.toISOString(), status: args.status,
    reservationId: args.reservationId, heldAmount: formatScaledDecimal(args.held), availableAmount: formatScaledDecimal(args.available),
    currency: args.currency, estimateCompleteness: request.estimate.completeness, knownSubtotal: request.estimate.knownSubtotal,
    boundedConservativeMaximum: request.estimate.boundedConservativeMaximum ?? null,
    rateCardRef: args.rateCardRef, policyRef: args.policyRef,
    expiryEligibility: args.status === 'authorized' || args.status === 'partial' ? 'eligible_if_never_dispatched' : 'not_expired',
    attemptBinding: request.attemptBinding,
    partialAuthorization: args.status === 'partial' && args.partialAllowed !== null
      ? { allowedAmount: formatScaledDecimal(args.partialAllowed), allowedWorkUnits: request.workPlan ? (args.partialAllowed / parseScaledDecimal(request.workPlan.unitMaximumAmount)).toString() : null, unit: request.workPlan?.unit ?? null, callerAcknowledgementRequired: true, replanBeforeDispatch: true }
      : null,
    retryAfterMs: args.status === 'unavailable' ? DEFAULT_RETRY_AFTER_MS : null,
    ...(request.authorityBinding && args.evidenceRef && args.evidenceHash && args.authorizedCap !== undefined ? { finance: financeEnvelope(request, args.reservationId, args.held, args.authorizedCap, args.evidenceRef, args.evidenceHash) } : {}),
  };
}

/* -------------------------------- lifecycle commands -------------------------------- */

interface ReservationState {
  readonly exists: boolean;
  readonly currency: string;
  readonly policyVersionId: string;
  readonly held: bigint;
  readonly consumed: bigint;
  readonly released: bigint;
  readonly revision: number;
  readonly lastType: string;
  readonly usageFinality: 'unknown' | 'partial' | 'final';
  /** Durable dispatch state: true once any `dispatched` event was appended. */
  readonly everDispatched: boolean;
  /** The first event of the reservation; a partial authorization is never dispatchable without acknowledgement evidence. */
  readonly firstType: string;
  /** The attempt binding persisted with the authorization. */
  readonly originalBinding: unknown;
  readonly authorizationRequest: ReservationRequest | null;
  readonly financialExpiresAt: string | null;
  readonly acknowledged: boolean;
  readonly acknowledgementEvidence: unknown;
  readonly dispatchEvidence: unknown;
}

async function loadReservation(client: BudgetTransactionPort, scope: TrustedScope, reservationId: string): Promise<ReservationState | null> {
  const result = await client.query(
    `SELECT currency, policy_version_id,
            sum(held_amount)::text AS held, sum(released_amount)::text AS released, max(consumed_amount)::text AS consumed,
            max(event_sequence)::int AS revision,
            (array_agg(event_type ORDER BY event_sequence DESC))[1] AS last_type,
            (array_agg(usage_finality ORDER BY event_sequence DESC))[1] AS last_finality,
            bool_or(event_type = 'dispatched') AS ever_dispatched,
            (array_agg(event_type ORDER BY event_sequence ASC))[1] AS first_type,
            (array_agg(attempt_binding ORDER BY event_sequence ASC))[1] AS original_binding,
            (array_agg(authorization_request ORDER BY event_sequence ASC))[1] AS authorization_request,
            (array_agg(financial_expires_at::text ORDER BY event_sequence ASC))[1] AS financial_expires_at,
            bool_or(event_type = 'partial_acknowledged') AS acknowledged,
            (array_agg(command_evidence ORDER BY event_sequence DESC) FILTER (WHERE event_type='partial_acknowledged'))[1] AS acknowledgement_evidence,
            (array_agg(command_evidence ORDER BY event_sequence DESC) FILTER (WHERE event_type='dispatched'))[1] AS dispatch_evidence
     FROM cost_intelligence.budget_reservation_events
     WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4 AND reservation_id = $5
     GROUP BY currency, policy_version_id`,
    [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, reservationId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const acknowledgements=await client.query(`SELECT event_sequence,command_request FROM cost_intelligence.budget_reservation_acknowledgements WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND reservation_id=$5 ORDER BY event_sequence DESC LIMIT 1`,[scope.tenantId,scope.projectId,scope.environment,scope.billingMode,reservationId]);
  const acknowledgement=acknowledgements.rows[0];const ackRevision=Number(acknowledgement?.event_sequence??0);
  const finalityRaw = fromRow(row, 'last_finality');
  return {
    exists: true, currency: asString(row.currency), policyVersionId: asString(row.policy_version_id),
    held: parseScaledDecimal(fromRow(row, 'held') ?? '0'), consumed: parseScaledDecimal(fromRow(row, 'consumed') ?? '0'),
    released: parseScaledDecimal(fromRow(row, 'released') ?? '0'), revision: Math.max(Number(row.revision),ackRevision),
    lastType: ackRevision>Number(row.revision)?'partial_acknowledged':asString(row.last_type),
    usageFinality: finalityRaw === 'partial' || finalityRaw === 'final' ? finalityRaw : 'unknown',
    everDispatched: row.ever_dispatched === true,
    firstType: fromRow(row, 'first_type') ?? '',
    originalBinding: row.original_binding ?? null,
    authorizationRequest: row.authorization_request as ReservationRequest ?? null, financialExpiresAt: fromRow(row, 'financial_expires_at'), acknowledged: !!acknowledgement, acknowledgementEvidence: acknowledgement?.command_request ?? null, dispatchEvidence: row.dispatch_evidence ?? null,
  };
}

function stateFor(lastType: string, usageFinality: 'unknown' | 'partial' | 'final'): ReservationLifecycleState {
  switch (lastType) {
    case 'authorized': case 'partially_authorized': case 'partial_acknowledged': return 'held';
    case 'dispatched': return 'dispatched';
    case 'settled': return usageFinality === 'final' ? 'settled' : 'partially_settled';
    case 'released': return 'released';
    case 'expired': return 'expired';
    default: return 'held';
  }
}

function outcomeFrom(requestId: string, status: ReservationCommandOutcome['status'], reservationId: string, state: ReservationState): ReservationCommandOutcome {
  const outstanding = state.held - state.released - state.consumed;
  return {
    schemaVersion: '1.0.0', requestId, status, reservationId,
    state: stateFor(state.lastType, state.usageFinality),
    heldAmount: formatScaledDecimal(state.held), consumedAmount: formatScaledDecimal(state.consumed),
    releasedAmount: formatScaledDecimal(state.released),
    outstandingHold: formatScaledDecimal(outstanding > 0n ? outstanding : 0n),
    overrunAmount: formatScaledDecimal(state.consumed > state.held ? state.consumed - state.held : 0n),
    currency: state.currency, revision: state.revision, usageFinality: state.usageFinality,
  };
}

type CommandKind = 'mark_dispatched' | 'settle' | 'release' | 'acknowledge_partial';

/** The normalized identity of a lifecycle command, compared against the stored event on replay. */
interface CommandIdentity {
  readonly eventType: 'dispatched' | 'settled' | 'released' | 'partial_acknowledged';
  readonly consumed: bigint;
  readonly released: bigint;
  readonly usageFinality: 'unknown' | 'partial' | 'final' | null;
  readonly settlementSequence: number | null;
}

async function applyCommand(args: {
  requestId: string; idempotencyKey: string; scope: TrustedScope; reservationId: string; expectedRevision: number;
  currency: string; actorReference: string; sourceAuthorityRef: VersionedReference; attemptBinding: Record<string, unknown>;
  logicalOperationId: string; billableAttemptId: string; kind: CommandKind; identity: CommandIdentity;
  ports: BudgetRuntimePorts; operation: string; authority: FinanceOperation;
  command?: Record<string, unknown>;
  validateCurrent?(state: ReservationState): Promise<ErrorEnvelope | null>;
  compute(state: ReservationState): { eventType: string; consumed: bigint; released: bigint; usageFinality: 'unknown' | 'partial' | 'final'; settlementSequence: number | null } | { reject: ErrorEnvelope };
}): Promise<ApiResult<ReservationCommandOutcome>> {
  const { ports, scope, requestId } = args;
  const waitMs = resolveWaitMs(ports);
  if (waitMs === null) return invalidWaitFailure(args.operation, requestId);
  const unavailable = (): ApiResult<ReservationCommandOutcome> => failure(makeError(args.operation, 'BUDGET_UNAVAILABLE', requestId,
    'Reservation lifecycle persistence is temporarily unavailable; retry the identical idempotent request.', true));

  return runBounded(waitMs, unavailable, async gate => {
    let client: BudgetTransactionPort | undefined;
    let inTransaction = false;
    try {
      const authorizationError = await authorizeScope(scope, requestId, ports, args.operation, args.authority);
      gate.checkpoint();
      if (authorizationError) return failure(authorizationError);
      if (!trustedNow(ports)) return failure(makeError(args.operation, 'BUDGET_UNAVAILABLE', requestId, 'The trusted budget clock is unavailable.', true));

      client = await ports.database.connect();
      gate.checkpoint();
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await bindFinancialDatabaseScope(client, scope);
      await bindDeadline(client, gate);
      // mark_dispatched carries no currency of its own; resolve it from the
      // stored reservation so the partition lock and currency check are exact.
      let effectiveCurrency = args.currency;
      if (effectiveCurrency === '') {
        const preload = await loadReservation(client, scope, args.reservationId);
        if (!preload) {
          await rollback(client); inTransaction = false;
          return failure(makeError(args.operation, 'VALIDATION_ERROR', requestId, 'The reservation does not exist in this authorized scope.'));
        }
        effectiveCurrency = preload.currency;
      }
      if (!(await acquirePartitionLock(client, scope, effectiveCurrency, gate))) {
        await rollback(client); inTransaction = false;
        return failure(makeError(args.operation, 'BUDGET_UNAVAILABLE', requestId, 'The budget partition is busy; retry the identical idempotent request.', true));
      }

      const replay = await client.query(
        `SELECT reservation_id, event_type, event_sequence, currency, consumed_amount::text AS consumed_amount,
                released_amount::text AS released_amount, usage_finality, settlement_sequence, expected_revision, attempt_binding, actor_reference, source_authority_ref, command_evidence
         FROM cost_intelligence.budget_reservation_events
         WHERE tenant_id = $1 AND project_id = $2 AND environment = $3 AND billing_mode = $4 AND idempotency_key = $5
         UNION ALL
         SELECT reservation_id,'partial_acknowledged' AS event_type,event_sequence,currency,'0' AS consumed_amount,'0' AS released_amount,'unknown' AS usage_finality,NULL AS settlement_sequence,expected_revision,attempt_binding,actor_reference,source_authority_ref,command_request AS command_evidence
         FROM cost_intelligence.budget_reservation_acknowledgements
         WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND idempotency_key=$5
         ORDER BY event_sequence ASC LIMIT 1`,
        [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, args.idempotencyKey],
      );
      if (replay.rows.length) {
        const row = replay.rows[0] as Record<string, unknown>;
        const identity = args.identity;
        const identical = fromRow(row,'actor_reference') === args.actorReference && sameJson(row.source_authority_ref,args.sourceAuthorityRef)
          && (!args.command || sameJson(row.command_evidence, normalizedBudgetRequest(args.command)))
          && fromRow(row, 'reservation_id') === args.reservationId
          && fromRow(row, 'event_type') === identity.eventType
          && fromRow(row, 'currency') === effectiveCurrency
          && Number(row.expected_revision) === args.expectedRevision
          && sameJson(row.attempt_binding, args.attemptBinding)
          && parseScaledDecimal(fromRow(row, 'consumed_amount') ?? '-1') === identity.consumed
          && parseScaledDecimal(fromRow(row, 'released_amount') ?? '-1') === identity.released
          && (identity.usageFinality === null || fromRow(row, 'usage_finality') === identity.usageFinality)
          && (identity.settlementSequence === null ? row.settlement_sequence === null || row.settlement_sequence === undefined
            : Number(row.settlement_sequence) === identity.settlementSequence);
        if (!identical) {
          await rollback(client); inTransaction = false;
          return failure(makeError(args.operation, 'IDEMPOTENCY_CONFLICT', requestId,
            'The idempotency key was already used for a different reservation command.'));
        }
        const existingReservation = asString(row.reservation_id);
        const state = await loadReservation(client, scope, existingReservation);
        gate.beginCommit();
        await client.query('COMMIT'); inTransaction = false;
        if (!state) return failure(makeError(args.operation, 'BUDGET_UNAVAILABLE', requestId, 'The reservation lifecycle state is unavailable.', true));
        return { ok: true, value: outcomeFrom(requestId, 'replay', existingReservation, state) };
      }

      const state = await loadReservation(client, scope, args.reservationId);
      if (!state) {
        await rollback(client); inTransaction = false;
        return failure(makeError(args.operation, 'VALIDATION_ERROR', requestId, 'The reservation does not exist in this authorized scope.'));
      }
      if (state.currency !== effectiveCurrency) {
        await rollback(client); inTransaction = false;
        return failure(makeError(args.operation, 'VALIDATION_ERROR', requestId, 'The command currency does not match the reservation currency.'));
      }
      if (args.expectedRevision !== state.revision) {
        await rollback(client); inTransaction = false;
        return { ok: true, value: outcomeFrom(requestId, 'stale_revision', args.reservationId, state) };
      }

      const computed = args.compute(state);
      if ('reject' in computed) {
        await rollback(client); inTransaction = false;
        return failure(computed.reject);
      }

      if (args.validateCurrent) { const denied = await gate.wait(args.validateCurrent(state)); gate.checkpoint(); if (denied) { await rollback(client); inTransaction=false; return failure(denied); } }
      const nextSequence = state.revision + 1;
      const eventId = globalThis.crypto.randomUUID();
      const contentHash = await hashValue({ reservationId: args.reservationId, sequence: nextSequence, type: computed.eventType, idempotencyKey: args.idempotencyKey });
      gate.checkpoint();
      if(args.kind==='acknowledge_partial'){
        await client.query(`INSERT INTO cost_intelligence.budget_reservation_acknowledgements (acknowledgement_id,tenant_id,project_id,environment,billing_mode,currency,reservation_id,event_sequence,expected_revision,idempotency_key,actor_reference,source_authority_ref,attempt_binding,command_request,content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15)`,[eventId,scope.tenantId,scope.projectId,scope.environment,scope.billingMode,effectiveCurrency,args.reservationId,nextSequence,args.expectedRevision,args.idempotencyKey,args.actorReference,JSON.stringify(args.sourceAuthorityRef),JSON.stringify(args.attemptBinding),JSON.stringify(normalizedBudgetRequest(args.command!)),contentHash]);
      } else {
      await client.query(
        `INSERT INTO cost_intelligence.budget_reservation_events
          (reservation_event_id, tenant_id, project_id, environment, billing_mode, currency, reservation_id, event_sequence,
           event_type, decision_status, held_amount, consumed_amount, released_amount, estimate_completeness, known_subtotal,
           bounded_maximum, allow_partial, partial_allowed_amount, usage_finality, settlement_sequence, policy_version_id,
           rate_card_ref, policy_ref, idempotency_key, expected_revision, actor_reference, source_authority_ref,
           attempt_binding, logical_operation_id, billable_attempt_id, content_hash, command_evidence)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NULL,0,$10::numeric,$11::numeric,NULL,NULL,NULL,false,NULL,$12,$13,$14,
           NULL,$15::jsonb,$16,$17,$18,$19::jsonb,$20::jsonb,$21,$22,$23,$24::jsonb)`,
        [eventId, scope.tenantId, scope.projectId, scope.environment, scope.billingMode, effectiveCurrency, args.reservationId, nextSequence,
          computed.eventType, formatScaledDecimal(computed.consumed), formatScaledDecimal(computed.released), computed.usageFinality,
          computed.settlementSequence, state.policyVersionId, JSON.stringify(args.sourceAuthorityRef), args.idempotencyKey,
          args.expectedRevision, args.actorReference, JSON.stringify(args.sourceAuthorityRef), JSON.stringify(args.attemptBinding),
          args.logicalOperationId, args.billableAttemptId, contentHash, args.command ? JSON.stringify(normalizedBudgetRequest(args.command)) : null],
      );
      }
      const refreshed = await loadReservation(client, scope, args.reservationId);
      gate.beginCommit();
      await client.query('COMMIT'); inTransaction = false;
      return { ok: true, value: outcomeFrom(requestId, 'applied', args.reservationId, refreshed ?? state) };
    } catch {
      if (client && inTransaction) await rollback(client);
      return unavailable();
    } finally {
      if(client&&inTransaction)await rollback(client);
      client?.release();
    }
  });
}

export async function markReservationDispatched(value: unknown, ports: BudgetRuntimePorts): Promise<ApiResult<ReservationCommandOutcome>> {
  const { Value } = requireValue();
  if (!Value.Check(markSchema(), value)) return failure(makeError('markDispatched', 'VALIDATION_ERROR', requestIdOf(value), 'The mark-dispatched command does not match the published schema.'));
  const request = structuredClone(value) as MarkDispatchedCommand;
  return applyCommand({
    requestId: request.requestId, idempotencyKey: request.idempotencyKey, scope: request.scope as TrustedScope,
    reservationId: request.reservationId, expectedRevision: request.expectedRevision, currency: '',
    actorReference: request.actorReference, sourceAuthorityRef: request.sourceAuthorityRef as VersionedReference,
    attemptBinding: request.attemptBinding as unknown as Record<string, unknown>,
    logicalOperationId: request.attemptBinding.logicalOperationId, billableAttemptId: request.attemptBinding.billableAttemptId,
    command: request as unknown as Record<string, unknown>,
    validateCurrent: async state => validateDispatchEvidence(state, request, ports),
    kind: 'mark_dispatched', ports, operation: 'markDispatched', authority: 'budgets.markDispatched',
    identity: { eventType: 'dispatched', consumed: 0n, released: 0n, usageFinality: 'unknown', settlementSequence: null },
    compute(state) {
      if (state.lastType !== 'authorized' && state.lastType !== 'partially_authorized' && state.lastType !== 'partial_acknowledged') {
        return { reject: makeError('markDispatched', 'VALIDATION_ERROR', request.requestId, 'Only a held reservation can be dispatched.') };
      }
      // A partial authorization needs validated caller acknowledgement/replan evidence. The
      // pinned MarkDispatched contract carries none, so dispatch stays unavailable (hold preserved).
      if (state.firstType === 'partially_authorized' && !state.acknowledged) {
        return { reject: makeError('markDispatched', 'BUDGET_UNAVAILABLE', request.requestId,
          'Dispatch of a partially authorized reservation is unavailable: no acknowledgement or replan evidence is defined at the approved boundary.') };
      }
      if (!sameJson(state.originalBinding, request.attemptBinding)) {
        return { reject: makeError('markDispatched', 'VALIDATION_ERROR', request.requestId, 'The attempt binding does not match the reservation\'s original attempt.') };
      }
      return { eventType: 'dispatched', consumed: 0n, released: 0n, usageFinality: 'unknown', settlementSequence: null };
    },
  });
}

function attemptMismatch(operation: string, requestId: string): { reject: ErrorEnvelope } {
  return { reject: makeError(operation, 'VALIDATION_ERROR', requestId, 'The attempt binding does not match the reservation\'s original attempt.') };
}

/**
 * Final usage is authoritative only when the usage is also complete. Reported usage that is
 * incomplete is a lower bound (partial) and unknown usage proves nothing (unknown), so neither can
 * make a hold releasable or present a zero as settled consumption.
 */
function effectiveFinality(finality: 'partial' | 'final', completeness: 'unknown' | 'incomplete' | 'complete'): 'unknown' | 'partial' | 'final' {
  if (completeness === 'complete') return finality;
  return completeness === 'incomplete' ? 'partial' : 'unknown';
}

/**
 * Record a cumulative settlement observation. The observed cumulative amount is recorded in full:
 * consumption above the hold is a variance (`overrunAmount`), never truncated to the reservation.
 *
 * Local mapping (FC001 proposal only): the canonical SettleRequest `consumed` amount and currency
 * must equal the wrapper's cumulative observation. This is NOT accepted FC003 producer
 * delta-vs-cumulative semantics; that broader question remains open under #13.
 */
export async function settleReservation(value: unknown, ports: BudgetRuntimePorts): Promise<ApiResult<ReservationCommandOutcome>> {
  const validated = validateSettleReservationCommandBoundary(value);
  if (!validated.ok) return failure(validated.error);
  const request = structuredClone(validated.value) as SettleReservationCommand;
  const currency = request.settlement.currency;
  const cumulative = parseScaledDecimal(request.settlement.cumulativeAmount);
  const consumed = request.canonicalCommand.consumed;
  if (consumed.currency !== currency || request.canonicalCommand.currency !== currency
      || parseScaledDecimal(consumed.amount) !== cumulative) {
    return failure(makeError('settle', 'VALIDATION_ERROR', request.requestId, 'The canonical settlement amount and currency contradict the settlement.'));
  }
  const settledFinality = effectiveFinality(request.settlement.finality, request.settlement.usageCompleteness);
  return applyCommand({
    requestId: request.requestId, idempotencyKey: request.idempotencyKey, scope: request.scope as TrustedScope,
    reservationId: request.reservationId, expectedRevision: request.expectedRevision, currency,
    actorReference: request.actorReference, sourceAuthorityRef: request.sourceAuthorityRef as VersionedReference,
    attemptBinding: request.attemptBinding as unknown as Record<string, unknown>,
    logicalOperationId: request.attemptBinding.logicalOperationId, billableAttemptId: request.attemptBinding.billableAttemptId,
    command: request as unknown as Record<string,unknown>,
    kind: 'settle', ports, operation: 'settle', authority: 'budgets.settle',
    identity: { eventType: 'settled', consumed: cumulative, released: 0n, usageFinality: settledFinality, settlementSequence: request.settlement.sequence },
    compute(state) {
      if (!sameJson(state.originalBinding, request.attemptBinding)) return attemptMismatch('settle', request.requestId);
      if (state.lastType === 'released' || state.lastType === 'expired') {
        return { reject: makeError('settle', 'VALIDATION_ERROR', request.requestId, 'A released or expired reservation cannot be settled.') };
      }
      if (cumulative < state.consumed) {
        return { reject: makeError('settle', 'VALIDATION_ERROR', request.requestId, 'Cumulative settlement cannot decrease a previously recorded consumption.') };
      }
      // Record the cumulative consumption; never double-count a settled portion.
      return {
        eventType: 'settled', consumed: cumulative, released: 0n,
        usageFinality: settledFinality, settlementSequence: request.settlement.sequence,
      };
    },
  });
}

export async function releaseReservation(value: unknown, ports: BudgetRuntimePorts): Promise<ApiResult<ReservationCommandOutcome>> {
  const validated = validateReleaseReservationCommandBoundary(value);
  if (!validated.ok) return failure(validated.error);
  const request = structuredClone(validated.value) as ReleaseReservationCommand;
  const currency = request.release.currency;
  const releaseAmount = parseScaledDecimal(request.release.amount);
  // The pinned ReleaseRequest carries an economic currency but no amount; that currency must agree with the wrapper.
  if (request.canonicalCommand.currency !== currency) {
    return failure(makeError('release', 'VALIDATION_ERROR', request.requestId, 'The canonical release currency contradicts the release.'));
  }
  return applyCommand({
    requestId: request.requestId, idempotencyKey: request.idempotencyKey, scope: request.scope as TrustedScope,
    reservationId: request.reservationId, expectedRevision: request.expectedRevision, currency,
    actorReference: request.actorReference, sourceAuthorityRef: request.sourceAuthorityRef as VersionedReference,
    attemptBinding: request.attemptBinding as unknown as Record<string, unknown>,
    logicalOperationId: request.attemptBinding.logicalOperationId, billableAttemptId: request.attemptBinding.billableAttemptId,
    command: request as unknown as Record<string,unknown>,
    kind: 'release', ports, operation: 'release', authority: 'budgets.release',
    identity: { eventType: 'released', consumed: 0n, released: releaseAmount, usageFinality: null, settlementSequence: null },
    compute(state) {
      if (!sameJson(state.originalBinding, request.attemptBinding)) return attemptMismatch('release', request.requestId);
      const remaining = state.held - state.released - state.consumed;
      const floorRemaining = remaining > 0n ? remaining : 0n;
      if (state.lastType === 'released' || state.lastType === 'expired') {
        return { reject: makeError('release', 'VALIDATION_ERROR', request.requestId, 'A released or expired reservation has no outstanding hold to release.') };
      }
      if (releaseAmount > floorRemaining) {
        return { reject: makeError('release', 'VALIDATION_ERROR', request.requestId, 'The release amount exceeds the outstanding hold.') };
      }
      // Capacity is released only on authoritative durable evidence; caller-supplied
      // refs are not evidence. Otherwise the hold is preserved and the failure is typed.
      const preserved = (message: string) => ({ reject: makeError('release', 'BUDGET_UNAVAILABLE', request.requestId, `${message} The hold is preserved.`) });
      if (request.release.proof === 'never_dispatched_fenced') {
        const held = state.lastType === 'authorized' || state.lastType === 'partially_authorized';
        if (state.everDispatched || !held) {
          return preserved('Never-dispatched release is refused: the durable state shows dispatch or an unresolved lifecycle.');
        }
        // Releasing the entire hold moves the reservation to `released`, which fences any later dispatch.
        if (releaseAmount !== floorRemaining) {
          return preserved('Never-dispatched release must release the whole hold so that a late worker is fenced.');
        }
      } else if (state.lastType !== 'settled' || state.usageFinality !== 'final') {
        return preserved('Final-usage release is refused: the reservation has no final settlement.');
      }
      return { eventType: 'released', consumed: 0n, released: releaseAmount, usageFinality: state.usageFinality, settlementSequence: null };
    },
  });
}

/** Advisory capacity read. It never authorizes dispatch or creates a reservation. */
export async function readCapacity(
  scope: TrustedScope,
  currency: string,
  requestId: string,
  ports: BudgetRuntimePorts,
): Promise<ApiResult<CapacitySnapshot>> {
  const waitMs = resolveWaitMs(ports);
  if (waitMs === null) return invalidWaitFailure('authorize', requestId);
  const unavailable = (): ApiResult<CapacitySnapshot> => failure(makeError('authorize', 'BUDGET_UNAVAILABLE', requestId,
    'The advisory capacity read is temporarily unavailable.', true));

  return runBounded(waitMs, unavailable, async gate => {
    let client: BudgetTransactionPort | undefined;
    let inTransaction = false;
    try {
      const authorizationError = await authorizeScope(scope, requestId, ports, 'authorize', 'budgets.authorize');
      gate.checkpoint();
      if (authorizationError) return failure(authorizationError);
      client = await ports.database.connect();
      gate.checkpoint();
      await client.query('BEGIN');
      inTransaction = true;
      await client.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await bindFinancialDatabaseScope(client, scope);
      await bindDeadline(client, gate);
      const capacity = await projectCapacity(client, scope, currency);
      gate.beginCommit();
      await client.query('COMMIT'); inTransaction = false;
      return {
        ok: true,
        value: {
          schemaVersion: '1.0.0', requestId, scope, currency,
          limitAmount: formatScaledDecimal(capacity.limit), effectiveConsumedSpend: formatScaledDecimal(capacity.consumed),
          outstandingHolds: formatScaledDecimal(capacity.outstandingHolds), usedCapacity: formatScaledDecimal(capacity.used),
          availableCapacity: formatScaledDecimal(capacity.available), reservationCount: capacity.reservationCount, advisoryOnly: true, capacityState: capacityState(capacity), unresolvedExposure: capacity.unresolvedExposure, policyWindow: 'project_lifetime', policyRef: decisionReference(capacity.policy),
        },
      };
    } catch {
      if (client && inTransaction) await rollback(client);
      return unavailable();
    } finally {
      if(client&&inTransaction)await rollback(client);
      client?.release();
    }
  });
}

/* -------------------------------- small schema plumbing -------------------------------- */

import { Value as valueModule } from '@sinclair/typebox/value';
import { MarkDispatchedCommandSchema } from './index.js';

function markSchema() { return MarkDispatchedCommandSchema; }
function requestIdOf(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'requestId' in value) {
    const id = (value as Record<string, unknown>).requestId;
    if (typeof id === 'string' && id.length > 0) return id;
  }
  return 'unavailable';
}

async function verifySource(ports: BudgetRuntimePorts, request: Record<string, unknown>, operation: string, sourceAuthorityRef: BudgetReference) {
  const now = trustedNow(ports);
  if (!now) return null;
  const scope = request.scope as TrustedScope;
  return verifyBudgetSource(ports.budgetEvidence, { operation, scope, actorId: scope.actorId, sourceAuthorityRef,
    requestDigest: await budgetDigest(normalizedBudgetRequest(request)) }, now);
}
function capacityState(capacity: PartitionCapacity): CapacitySnapshot['capacityState'] {
  if (!capacity.policy) return 'unconfigured';
  if (capacity.used > capacity.limit) return 'over_limit';
  if (capacity.used === capacity.limit) return 'exhausted';
  return capacity.used * 100n >= capacity.limit * 80n ? 'near_limit' : 'available';
}
function financeEnvelope(request: ReservationRequest, reservationId: string, held: bigint, cap: bigint, evidenceRef: string, evidenceHash: string) {
  const binding = request.authorityBinding!;
  return { status: 'held' as const, revoked: false as const, reservation_ref: reservationId,
    billable_attempt_id: request.attemptBinding.billableAttemptId, budget_scope_id: binding.budgetScopeId,
    lease_ref: binding.leaseRef, grant_ref: binding.grantRef, tenant_id: request.scope.tenantId, project_id: request.scope.projectId,
    account_ref: binding.accountRef, project_ref: binding.projectRef, provider: binding.provider, model: binding.model,
    operation: binding.operation, target_binding_sha256: binding.targetBindingSha256,
    held_amount: { amount: formatScaledDecimal(held), currency: request.estimate.currency },
    authorized_cap: { amount: formatScaledDecimal(cap), currency: request.estimate.currency },
    expires_at: new Date(Math.min(Date.parse(request.canonicalRequest.expires_at),Date.parse(binding.leaseExpiresAt))).toISOString(), evidence_ref: evidenceRef, evidence_sha256: evidenceHash };
}
export interface ReservationSnapshotRequest {
  readonly schemaVersion: '1.0.0'; readonly requestId: string; readonly scope: TrustedScope; readonly reservationId: string;
}
const SnapshotRequestSchema = Type.Object({ schemaVersion: Type.Literal('1.0.0'), requestId: Type.String({ minLength: 1 }),
  scope: BudgetPolicyChangeRequestSchema.properties.scope, reservationId: Type.String({ minLength: 1 }) }, { additionalProperties: false });
async function snapshotFrom(client: BudgetTransactionPort, request: ReservationSnapshotRequest, state: ReservationState, now: Date): Promise<ReservationSnapshot | null> {
  const original = state.authorizationRequest;
  if (!original?.sourceAuthorityRef || !original.authorityBinding) return null;
  const first = await client.query(`SELECT reservation_event_id, content_hash, authorized_cap::text AS cap FROM cost_intelligence.budget_reservation_events WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND reservation_id=$5 AND event_sequence=1`, [request.scope.tenantId,request.scope.projectId,request.scope.environment,request.scope.billingMode,request.reservationId]);
  const row=first.rows[0]; if (!row) return null;
  const expired = Date.parse(original.canonicalRequest.expires_at) <= now.getTime();
  const lifecycle = stateFor(state.lastType,state.usageFinality);
  const eligible = !expired && Date.parse(original.authorityBinding.leaseExpiresAt)>now.getTime() && (lifecycle==='held' || lifecycle==='dispatched') && (state.firstType!=='partially_authorized' || state.acknowledged);
  const c=original.canonicalRequest;
  const money = (amount: bigint) => { const value=formatScaledDecimal(amount); return {amount:value,currency:state.currency,scale:value.includes('.')?value.split('.')[1]!.length:0}; };
  // Explicit projection of the pinned v1 representation. Local state retains richer lifecycle/partial semantics.
  const canonical = { contract:'BudgetReservation', schema_version:'1.0.0', policy_version:c.policy_version,
    event_id:request.reservationId, tenant_id:c.tenant_id,project_id:c.project_id,correlation_id:c.correlation_id,producer:c.producer,
    occurred_at:c.occurred_at,observed_at:c.observed_at,ingested_at:c.ingested_at,environment:c.environment,billing_mode:c.billing_mode,source_refs:c.source_refs,
    reservation_id:request.reservationId,budget_scope_id:c.budget_scope_id,logical_operation_id:c.logical_operation_id,billable_attempt_id:c.billable_attempt_id,
    decision:'granted',lifecycle: lifecycle==='released'?'released':lifecycle==='settled'?'consumed':state.everDispatched?'uncertain_in_flight':expired?'expired':'held',
    held:money(state.held),consumed:money(state.consumed),expires_at:c.expires_at,revision:state.revision,
    execution_state:state.usageFinality==='final'?'finished':state.everDispatched?'in_flight':'not_dispatched',usage_completeness:state.usageFinality==='final'?'complete':'unknown',
    idempotency_key:original.idempotencyKey,authority_ref:original.sourceAuthorityRef,settlement_ref:null };
  return {schemaVersion:'1.0.0',requestId:request.requestId,asOf:now.toISOString(),reservation:canonical as ReservationSnapshot['reservation'],
    state:expired && !state.everDispatched && lifecycle==='held'?'expired':lifecycle, heldAmount:formatScaledDecimal(state.held),effectiveConsumedAmount:formatScaledDecimal(state.consumed),releasedAmount:formatScaledDecimal(state.released),latestCumulativeSettlement:formatScaledDecimal(state.consumed),overrunAmount:formatScaledDecimal(state.consumed>state.held?state.consumed-state.held:0n),usageFinality:state.usageFinality,expectedRevision:state.revision,attemptBinding:original.attemptBinding,
    dispatchEligible:eligible, ...(eligible ? {finance:financeEnvelope(original,request.reservationId,state.held-state.released-state.consumed>0n?state.held-state.released-state.consumed:0n,parseScaledDecimal(fromRow(row,'cap')??'0'),`ci05a:${asString(row.reservation_event_id)}`,asString(row.content_hash))}: {})};
}
/** Current scope-authorized read; historical authorization replay must never substitute for this operation. */
export async function readReservationSnapshot(value: unknown, ports: BudgetRuntimePorts): Promise<ApiResult<ReservationSnapshot>> {
  if (!Value.Check(SnapshotRequestSchema,value)) return failure(makeError('getReservationSnapshot','VALIDATION_ERROR',requestIdOf(value),'The current reservation request is invalid.'));
  const request=structuredClone(value) as ReservationSnapshotRequest;
  const wait=resolveWaitMs(ports);if(wait===null)return invalidWaitFailure('getReservationSnapshot',request.requestId);
  const unavailable=()=>failure(makeError('getReservationSnapshot','BUDGET_UNAVAILABLE',request.requestId,'Current reservation state is unavailable.',true));
  return runBounded<ApiResult<ReservationSnapshot>>(wait,unavailable,async gate=>{
    let client:BudgetTransactionPort|undefined;let transaction=false;
    try {
      const denied=await authorizeScope(request.scope,request.requestId,ports,'getReservationSnapshot','budgets.readReservation');gate.checkpoint();if(denied)return failure(denied);
      const now=trustedNow(ports);if(!now)return unavailable();
      client=await ports.database.connect();gate.checkpoint();await client.query('BEGIN');transaction=true;await bindFinancialDatabaseScope(client,request.scope);await bindDeadline(client,gate);
      const state=await loadReservation(client,request.scope,request.reservationId);if(!state){await rollback(client);transaction=false;return failure(makeError('getReservationSnapshot','FORBIDDEN_SCOPE',request.requestId,'The reservation is unavailable in this authorized scope.'));}
      const snapshot=await snapshotFrom(client,request,state,now);gate.beginCommit();await client.query('COMMIT');transaction=false;
      if(!snapshot)return unavailable();
      const {finance, ...facts}=snapshot;
      return {ok:true,value:{...facts,dispatchEligible:false}};
    }catch{if(client&&transaction)await rollback(client);return unavailable();}finally{if(client&&transaction)await rollback(client);client?.release();}
  });
}
export interface CurrentReservationAuthorization {
  readonly schemaVersion:'1.0.0';readonly requestId:string;readonly status:'authorized'|'denied';readonly revoked:boolean;
  readonly snapshot:ReservationSnapshot;readonly finance?:import('./authority.js').FinanceReservationAuthority;
}
/** Both consumer phases re-read durable state and independently resolve the current host/source/maximum/plan. */
export async function revalidateReservation(value: unknown, ports: BudgetRuntimePorts): Promise<ApiResult<CurrentReservationAuthorization>> {
  if(!Value.Check(CurrentReservationRequestSchema,value))return failure(makeError('revalidateReservation','VALIDATION_ERROR',requestIdOf(value),'The current authority query is invalid.'));
  const request=structuredClone(value) as CurrentReservationRequest;
  const wait=resolveWaitMs(ports);if(wait===null)return invalidWaitFailure('revalidateReservation',request.requestId);
  const unavailable=()=>failure(makeError('revalidateReservation','BUDGET_UNAVAILABLE',request.requestId,'Current host or source verification is unavailable.',true));
  return runBounded<ApiResult<CurrentReservationAuthorization>>(wait,unavailable,async gate=>{
    let client:BudgetTransactionPort|undefined;let transaction=false;
    try{
      const denied=await authorizeScope(request.scope,request.requestId,ports,'revalidateReservation','budgets.readReservation');gate.checkpoint();if(denied)return failure(denied);
      if(!ports.reservationAuthority||!ports.budgetEvidence)return unavailable();
      client=await ports.database.connect();gate.checkpoint();await client.query('BEGIN');transaction=true;await bindFinancialDatabaseScope(client,request.scope);await bindDeadline(client,gate);
      let state=await loadReservation(client,request.scope,request.reservationId);if(!state){await rollback(client);transaction=false;return failure(makeError('revalidateReservation','FORBIDDEN_SCOPE',request.requestId,'The reservation is unavailable in this authorized scope.'));}
      if(!(await acquirePartitionLock(client,request.scope,state.currency,gate))){await rollback(client);transaction=false;return unavailable();}state=(await loadReservation(client,request.scope,request.reservationId))!;
      const now=trustedNow(ports);if(!now)return unavailable();const original=state.authorizationRequest;
      const snapshot=await snapshotFrom(client,request,state,now);if(!snapshot||!original?.sourceAuthorityRef||!original.authorityBinding)return unavailable();
      let allowed=snapshot.dispatchEligible===true && sameJson(request.attemptBinding,original.attemptBinding) && sameJson(request.authorityBinding,original.authorityBinding) && (request.expectedRevision===undefined||request.expectedRevision===state.revision);
      if(request.phase==='post_transport_ack'&&(!request.dispatchIntentRef||request.transportAttemptId!==original.attemptBinding.transportAttemptId||!state.everDispatched||!sameJson((state.dispatchEvidence as MarkDispatchedCommand|null)?.dispatchIntentRef,request.dispatchIntentRef)))allowed=false;
      const host=await gate.wait(verifyReservationHost(ports.reservationAuthority,{scope:request.scope,billableAttemptId:original.attemptBinding.billableAttemptId,binding:original.authorityBinding,sourceAuthorityRef:original.sourceAuthorityRef,phase:request.phase,reservationId:request.reservationId,...(request.dispatchIntentRef?{dispatchIntentRef:request.dispatchIntentRef}:{}),...(request.transportAttemptId?{transportAttemptId:request.transportAttemptId}:{})},now));gate.checkpoint();
      const source=await gate.wait(verifySource(ports,original as unknown as Record<string,unknown>,'authorize',original.sourceAuthorityRef));gate.checkpoint();
      allowed=allowed&&!!host&&!!source;
      if(original.estimate.completeness!=='complete')allowed=allowed&&!!source?.maximum&&sameJson(source.maximum.policyRef,original.estimate.maximumPolicyRef)&&sameAmount(source.maximum.authorizedCap,original.estimate.boundedConservativeMaximum??'0')&&source.maximum.currency===state.currency;
      if(state.firstType==='partially_authorized'){
        const ack=state.acknowledgementEvidence as PartialAcknowledgementRequest|null;
        allowed=allowed&&!!ack&&!!(ack&&await gate.wait(verifySource(ports,ack as unknown as Record<string,unknown>,'acknowledgePartial',ack.sourceAuthorityRef)));gate.checkpoint();
      }
      const finalNow=trustedNow(ports);allowed=allowed&&!!finalNow&&Date.parse(original.canonicalRequest.expires_at)>(finalNow?.getTime()??Infinity)&&Date.parse(original.authorityBinding.leaseExpiresAt)>(finalNow?.getTime()??Infinity)&&!!host&&Date.parse(host.expiresAt)>(finalNow?.getTime()??Infinity)&&!!source&&Date.parse(source.expiresAt)>(finalNow?.getTime()??Infinity);
      gate.beginCommit();await client.query('COMMIT');transaction=false;
      const {finance: snapshotFinance, ...facts}=snapshot;
      if(allowed&&snapshotFinance&&host&&source)snapshotFinance.expires_at=new Date(Math.min(Date.parse(snapshotFinance.expires_at),Date.parse(host.expiresAt),Date.parse(source.expiresAt))).toISOString();
      return {ok:true,value:{schemaVersion:'1.0.0',requestId:request.requestId,status:allowed?'authorized':'denied',revoked:!allowed,snapshot:{...facts,dispatchEligible:allowed,...(allowed&&snapshotFinance?{finance:snapshotFinance}:{})},...(allowed&&snapshot.finance?{finance:snapshot.finance}:{})}};
    }catch{if(client&&transaction)await rollback(client);return unavailable();}finally{if(client&&transaction)await rollback(client);client?.release();}
  });
}
async function validateDispatchEvidence(state:ReservationState,request:MarkDispatchedCommand,ports:BudgetRuntimePorts):Promise<ErrorEnvelope|null>{
  const original=state.authorizationRequest;const now=trustedNow(ports);
  const refuse=()=>makeError('markDispatched','FORBIDDEN_SCOPE',request.requestId,'Current dispatch target, source, expiry, lease or revised plan evidence is missing.');
  if(!original?.authorityBinding||!original.sourceAuthorityRef||!now||Date.parse(original.canonicalRequest.expires_at)<=now.getTime()||request.workerLeaseId!==original.authorityBinding.leaseRef||request.workerLeaseExpiresAt!==original.authorityBinding.leaseExpiresAt)return refuse();
  if(!ports.reservationAuthority||!ports.budgetEvidence)return makeError('markDispatched','BUDGET_UNAVAILABLE',request.requestId,'Current host and source verification is not configured.',true);
  const host=await verifyReservationHost(ports.reservationAuthority,{scope:request.scope,billableAttemptId:original.attemptBinding.billableAttemptId,binding:original.authorityBinding,sourceAuthorityRef:original.sourceAuthorityRef,phase:'dispatch',reservationId:request.reservationId,dispatchIntentRef:request.dispatchIntentRef,transportAttemptId:request.attemptBinding.transportAttemptId},now);
  const source=await verifySource(ports,request as unknown as Record<string,unknown>,'markDispatched',request.sourceAuthorityRef);
  if(!host||!source)return refuse();
  const estimate=await verifySource(ports,original as unknown as Record<string,unknown>,'authorize',original.sourceAuthorityRef);
  if(!estimate)return refuse();
  if(original.estimate.completeness!=='complete'&&(!estimate.maximum||!sameJson(estimate.maximum.policyRef,original.estimate.maximumPolicyRef)||!sameAmount(estimate.maximum.authorizedCap,original.estimate.boundedConservativeMaximum??'0')||estimate.maximum.currency!==state.currency))return refuse();
  if(state.firstType==='partially_authorized'){
    const ack=state.acknowledgementEvidence as PartialAcknowledgementRequest|null;
    if(!ack||!(await verifySource(ports,ack as unknown as Record<string,unknown>,'acknowledgePartial',ack.sourceAuthorityRef)))return refuse();
  }
  const finalNow=trustedNow(ports);if(!finalNow||Date.parse(original.canonicalRequest.expires_at)<=finalNow.getTime()||Date.parse(host.expiresAt)<=finalNow.getTime()||Date.parse(source.expiresAt)<=finalNow.getTime())return refuse();
  return null;
}
/** Finance-local partial protocol, pending canonical GAP002 acceptance. No acknowledgement is inferred from opt-in. */
export async function acknowledgePartialReservation(value:unknown,ports:BudgetRuntimePorts):Promise<ApiResult<ReservationCommandOutcome>>{
  if(!Value.Check(PartialAcknowledgementRequestSchema,value))return failure(makeError('acknowledgePartial','VALIDATION_ERROR',requestIdOf(value),'The partial acknowledgement is invalid.'));
  const request=structuredClone(value) as PartialAcknowledgementRequest;
  return applyCommand({requestId:request.requestId,idempotencyKey:request.idempotencyKey,scope:request.scope,reservationId:request.reservationId,expectedRevision:request.expectedRevision,currency:'',actorReference:request.actorReference,sourceAuthorityRef:request.sourceAuthorityRef,attemptBinding:request.attemptBinding as Record<string,unknown>,logicalOperationId:(request.attemptBinding as MarkDispatchedCommand['attemptBinding']).logicalOperationId,billableAttemptId:(request.attemptBinding as MarkDispatchedCommand['attemptBinding']).billableAttemptId,kind:'acknowledge_partial',command:request as unknown as Record<string,unknown>,ports,operation:'acknowledgePartial',authority:'budgets.markDispatched',identity:{eventType:'partial_acknowledged',consumed:0n,released:0n,usageFinality:'unknown',settlementSequence:null},
    validateCurrent:async state=>{
      const now=trustedNow(ports);if(!now||!state.authorizationRequest||Date.parse(state.authorizationRequest.canonicalRequest.expires_at)<=now.getTime()||request.revisedPlanHash!==await budgetDigest(request.revisedPlan)||!(await verifySource(ports,request as unknown as Record<string,unknown>,'acknowledgePartial',request.sourceAuthorityRef)))return makeError('acknowledgePartial','FORBIDDEN_SCOPE',request.requestId,'Current authenticated replan evidence is unavailable.');return null;
    },
    compute(state){
      if(state.firstType!=='partially_authorized'||state.lastType!=='partially_authorized'||!sameJson(state.originalBinding,request.attemptBinding))return{reject:makeError('acknowledgePartial','VALIDATION_ERROR',request.requestId,'Only the original held partial attempt can acknowledge a replan.')};
      const original=state.authorizationRequest!;const plan=request.revisedPlan;const cap=state.held-state.released-state.consumed;
      if(!original.workPlan||request.allowedWorkUnits!==plan.requestedUnits||request.unit!==plan.unit||request.unit!==original.workPlan.unit||request.allowedWorkUnits>original.workPlan.requestedUnits||parseScaledDecimal(plan.unitMaximumAmount)*BigInt(plan.requestedUnits)>cap||!sameAmount(request.allowedAmount,formatScaledDecimal(cap)))return{reject:makeError('acknowledgePartial','VALIDATION_ERROR',request.requestId,'The acknowledged work must fit the exact granted cap and original work bounds.')};
      return{eventType:'partial_acknowledged',consumed:0n,released:0n,usageFinality:'unknown',settlementSequence:null};
    }});
}

async function persistPolicyDecision(client:BudgetTransactionPort,request:BudgetPolicyChangeRequest,receipt:BudgetPolicyReceipt):Promise<void>{
  const scope=request.scope;const normalized=normalizedBudgetRequest(request as unknown as Record<string,unknown>);
  await client.query(`INSERT INTO cost_intelligence.budget_policy_decisions (decision_id,tenant_id,project_id,environment,billing_mode,currency,idempotency_key,actor_reference,source_authority_ref,command_request,command_receipt,content_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11::jsonb,$12)`,[crypto.randomUUID(),scope.tenantId,scope.projectId,scope.environment,scope.billingMode,request.currency,request.idempotencyKey,request.actorReference,JSON.stringify(request.sourceAuthorityRef),JSON.stringify(normalized),JSON.stringify(receipt),await budgetDigest({request:normalized,receipt})]);
}
