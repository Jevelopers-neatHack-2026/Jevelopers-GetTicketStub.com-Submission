// Node 24 cryptographic identifiers and idempotency fingerprints.
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { DurableJsonStore, type DurableJson } from "./metering-store.js";
import type {
  BudgetClient,
  Clock,
  ContractReceipt,
  ContractValidator,
  Operation,
  ProviderMode,
  RuntimeMeteringResolver,
  SharedShape,
  TrustedScope,
  UsageSink
} from "./types.js";

export type EvidenceMode = "private_fixture" | "provider_sandbox_account" | "unknown";
export type AmountBasis = "unknown" | "estimated" | "provider_confirmed";

export type ExactMoney =
  | { readonly representation: "decimal"; readonly value: string; readonly currency: string }
  | { readonly representation: "scaled"; readonly units: string; readonly scale: number; readonly currency: string }
  /** Exact source integer when the producer supplies minor units without a currency exponent. */
  | { readonly representation: "minor_units"; readonly units: string; readonly currency: string };

export interface AmountEvidence {
  readonly amount: ExactMoney | null;
  readonly basis: AmountBasis;
}

export type MeteringOutcome =
  | "observed"
  | "attempt_prepared"
  | "reservation_requested"
  | "dispatching"
  | "provider_accepted"
  | "not_dispatched"
  | "unknown";

export type MeteringCompleteness = "complete" | "partial" | "unknown";

export interface MeteringObservationInput {
  readonly operation: Operation;
  /** Stable source delivery key; replays with the same key and facts reuse the event identity. */
  readonly sourceEventKey?: string;
  readonly logicalOperationId?: string;
  readonly billableAttemptId?: string;
  readonly transportAttemptId?: string;
  readonly providerRequestId?: string;
  readonly occurredAt?: string;
  readonly outcome: MeteringOutcome;
  readonly completeness: MeteringCompleteness;
  readonly durationMs?: number;
  readonly sourceRefs?: readonly string[];
  readonly quoteAmount?: AmountEvidence;
  readonly chargeAmount?: AmountEvidence;
  readonly effect: "non_billable_observation" | "potentially_billable_effect" | "confirmed_effect" | "unknown_effect";
}

export interface BillableAttemptInput {
  readonly providerId: string;
  readonly operation: "submit" | "cancel";
  readonly logicalOperationId: string;
  /** Stable key for one billable execution; a distinct execution uses a distinct key. */
  readonly clientAttemptKey: string;
  readonly sourceRefs?: readonly string[];
  readonly quoteAmount?: AmountEvidence;
  /** Exact externally supplied reservation facts; this module does not estimate or value them. */
  readonly reservationAmount: AmountEvidence;
}

export interface BudgetReservationResolver {
  /** Reads only from the financial owner; there is deliberately no release or mutation method. */
  resolve(requestId: string, scope: TrustedScope, mode: ProviderMode): Promise<unknown>;
}

export interface MeteringDependencies {
  readonly directory: string;
  readonly scope: TrustedScope;
  readonly providerId: string;
  readonly mode: ProviderMode;
  readonly billingMode: ProviderMode;
  readonly evidenceMode: EvidenceMode;
  readonly contracts: ContractValidator;
  readonly usageSink: UsageSink;
  readonly budgetClient: BudgetClient;
  readonly reservationResolver?: BudgetReservationResolver;
  readonly clock: Clock;
  readonly idFactory?: (kind: "event" | "observation" | "attempt" | "transport" | "reservation") => string;
}

export type MeteringFailure =
  | "invalid_input"
  | "storage_unavailable"
  | "storage_corrupt"
  | "contract_unavailable"
  | "usage_sink_unavailable"
  | "budget_denied"
  | "budget_unknown"
  | "reservation_unavailable"
  | "attempt_conflict"
  | "logical_operation_blocked"
  | "attempt_not_ready"
  | "attempt_outcome_unknown"
  | "outcome_recording_pending";

export type MeteringResult =
  | { readonly status: "recorded"; readonly eventId: string; readonly observationId: string }
  | { readonly status: "pending"; readonly eventId: string; readonly observationId: string; readonly reason: MeteringFailure }
  | { readonly status: "ready"; readonly attemptId: string; readonly reservationReference: string }
  | { readonly status: "denied"; readonly attemptId: string; readonly reason: MeteringFailure }
  | { readonly status: "blocked"; readonly attemptId?: string; readonly eventId?: string; readonly observationId?: string; readonly reason: MeteringFailure }
  | {
      readonly status: "effect_recorded";
      readonly attemptId: string;
      readonly transportAttemptId: string;
      readonly outcome: "provider_accepted" | "not_dispatched" | "unknown";
      readonly providerRequestId: string | null;
      readonly pendingEventId: string | null;
    };

export interface DispatchIdentity {
  readonly providerId: string;
  readonly operation: "submit" | "cancel";
  readonly logicalOperationId: string;
  readonly billableAttemptId: string;
  readonly transportAttemptId: string;
  readonly reservationRequestId: string;
  readonly reservationReference: string;
  readonly mode: ProviderMode;
  readonly billingMode: ProviderMode;
  readonly evidenceMode: EvidenceMode;
  readonly scope: TrustedScope;
}

export type DispatchResult =
  | { readonly outcome: "provider_accepted"; readonly providerRequestId?: string; readonly chargeAmount?: AmountEvidence; readonly sourceRefs?: readonly string[] }
  | { readonly outcome: "not_dispatched"; readonly sourceRefs?: readonly string[] }
  | { readonly outcome: "unknown"; readonly sourceRefs?: readonly string[] };

export type DispatchPort = (identity: DispatchIdentity) => Promise<DispatchResult>;

export interface StoredAttemptSummary {
  readonly attemptId: string;
  readonly clientAttemptKey: string;
  readonly logicalOperationId: string;
  readonly operation: "submit" | "cancel";
  readonly phase: string;
  readonly reservationState: string;
  readonly reservationRequestId: string;
  readonly reservationReference: string | null;
  readonly transportAttemptId: string | null;
  readonly providerRequestId: string | null;
  readonly outcome: string | null;
  readonly updatedAt: string;
}

export interface MeteringSnapshot {
  readonly schemaVersion: "private-connector-metering-state/2";
  readonly revision: number;
  readonly attempts: readonly StoredAttemptSummary[];
  readonly outbox: readonly {
    readonly eventId: string;
    readonly observationId: string;
    readonly eventType: string;
    readonly deliveryState: "pending" | "delivered";
    readonly deliveryAttempts: number;
    readonly sequence: number;
  }[];
}

interface MutableAttempt {
  attemptId: string;
  clientAttemptKey: string;
  fingerprint: string;
  providerId: string;
  operation: "submit" | "cancel";
  logicalOperationId: string;
  mode: ProviderMode;
  billingMode: ProviderMode;
  evidenceMode: EvidenceMode;
  scope: TrustedScope;
  sourceRefs: string[];
  quoteAmount: AmountEvidence;
  reservationAmount: AmountEvidence;
  reservationRequestId: string;
  reservationCandidate: DurableJson;
  reservationEnvelope: DurableJson | null;
  reservationReceipts: ContractReceipt[];
  reservationState: ReservationState;
  reservationReference: string | null;
  /** First finance-confirmed terminal result; never cleared by late responses. */
  reservationRetirement: ReservationRetirementEvidence | null;
  /** First conflicting finance result, retained as a fail-closed diagnostic. */
  reservationConflictEvidence: ReservationConflictEvidence | null;
  /** Legacy /2 unknown states cannot reveal whether an earlier conflict was overwritten. */
  reservationHistoryUncertain: boolean;
  /** First replacement attempt for this logical operation, written atomically. */
  supersededByAttemptId: string | null;
  phase: "accounting_pending" | "reservation_pending" | "reservation_unknown" | "denied" | "ready" | "dispatch_intent" | "dispatching" | "unknown" | "provider_accepted" | "not_dispatched";
  transportAttemptId: string | null;
  providerRequestId: string | null;
  outcome: "provider_accepted" | "not_dispatched" | "unknown" | null;
  dispatchStartedAt: string | null;
  updatedAt: string;
}

interface MutableOutboxEvent {
  sequence: number;
  eventId: string;
  observationId: string;
  eventType: string;
  sourceEventKey: string | null;
  fingerprint: string;
  attemptId: string | null;
  candidate: DurableJson;
  canonicalEnvelope: DurableJson | null;
  receipts: ContractReceipt[];
  deliveryState: "pending" | "delivered";
  deliveryAttempts: number;
  safeFailure: "contract_unavailable" | "usage_sink_unavailable" | null;
}

interface MutableState {
  schemaVersion: "private-connector-metering-state/2";
  context: MeteringStoreContext;
  revision: number;
  nextSequence: number;
  attempts: MutableAttempt[];
  outbox: MutableOutboxEvent[];
}

interface MeteringStoreContext {
  readonly providerId: string;
  readonly mode: ProviderMode;
  readonly billingMode: ProviderMode;
  readonly evidenceMode: EvidenceMode;
  readonly scope: TrustedScope;
}

type ReservationState = "not_requested" | "requesting" | "unknown" | "reserved" | "denied" | "released";
type ReservationResponseSource = "authorization" | "resolver" | "legacy_state";

interface ReservationRetirementEvidence {
  readonly reservationRequestId: string;
  readonly state: "denied" | "released";
  readonly source: ReservationResponseSource;
  readonly observedAt: string;
}

interface ReservationConflictEvidence {
  readonly reservationRequestId: string;
  readonly priorState: ReservationState;
  readonly priorReference: string | null;
  readonly receivedState: "reserved" | "denied" | "released";
  readonly receivedReference: string | null;
  readonly source: Exclude<ReservationResponseSource, "legacy_state">;
  readonly observedAt: string;
}

interface NormalizedObservation {
  operation: Operation;
  sourceEventKey: string | null;
  logicalOperationId: string | null;
  billableAttemptId: string | null;
  transportAttemptId: string | null;
  providerRequestId: string | null;
  occurredAt: string | null;
  outcome: MeteringOutcome;
  completeness: MeteringCompleteness;
  durationMs: number | null;
  sourceRefs: string[];
  quoteAmount: AmountEvidence;
  chargeAmount: AmountEvidence;
  effect: MeteringObservationInput["effect"];
}

function initialState(context: MeteringStoreContext): MutableState {
  return {
    schemaVersion: "private-connector-metering-state/2",
    context: {
      providerId: context.providerId,
      mode: context.mode,
      billingMode: context.billingMode,
      evidenceMode: context.evidenceMode,
      scope: { tenantId: context.scope.tenantId, projectId: context.scope.projectId }
    },
    revision: 0,
    nextSequence: 1,
    attempts: [],
    outbox: []
  };
}

const SHAPE_USAGE: SharedShape = "fulfillment_usage";
const SHAPE_BUDGET: SharedShape = "budget_reservation";

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function normalizeStoreContext(value: unknown): MeteringStoreContext | undefined {
  if (!isRecord(value) || !requireToken(value.providerId) ||
      (value.mode !== "simulated" && value.mode !== "sandbox") ||
      (value.billingMode !== "simulated" && value.billingMode !== "sandbox") ||
      !["private_fixture", "provider_sandbox_account", "unknown"].includes(String(value.evidenceMode)) ||
      !isRecord(value.scope) || !requireToken(value.scope.tenantId) || !requireToken(value.scope.projectId)) return undefined;
  return {
    providerId: value.providerId,
    mode: value.mode,
    billingMode: value.billingMode,
    evidenceMode: value.evidenceMode as EvidenceMode,
    scope: { tenantId: value.scope.tenantId, projectId: value.scope.projectId }
  };
}

function sameStoreContext(left: MeteringStoreContext, right: MeteringStoreContext): boolean {
  return stableStringify(left) === stableStringify(right);
}

function attemptMatchesContext(value: Record<string, unknown>, context: MeteringStoreContext): boolean {
  return value.providerId === context.providerId && value.mode === context.mode &&
    value.billingMode === context.billingMode && value.evidenceMode === context.evidenceMode &&
    isRecord(value.scope) && value.scope.tenantId === context.scope.tenantId &&
    value.scope.projectId === context.scope.projectId;
}

function candidateMatchesContext(value: unknown, context: MeteringStoreContext): boolean {
  return isRecord(value) && value.provider_id === context.providerId && value.mode === context.mode &&
    value.billing_mode === context.billingMode && value.evidence_mode === context.evidenceMode &&
    isRecord(value.trusted_scope) && value.trusted_scope.tenantId === context.scope.tenantId &&
    value.trusted_scope.projectId === context.scope.projectId;
}

function reservationMatchesContext(value: unknown, context: MeteringStoreContext): boolean {
  if (!isRecord(value) || value.provider_id !== context.providerId || value.mode !== context.mode ||
      value.billing_mode !== context.billingMode || value.evidence_mode !== context.evidenceMode) return false;
  if (value.trusted_scope === undefined) return true;
  return isRecord(value.trusted_scope) && value.trusted_scope.tenantId === context.scope.tenantId &&
    value.trusted_scope.projectId === context.scope.projectId;
}

function cloneData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object") throw new TypeError("invalid_json_value");
  if (seen.has(value)) throw new TypeError("cyclic_value");
  seen.add(value);
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("invalid_array_value");
      result.push(cloneData(descriptor.value, seen));
    }
    seen.delete(value);
    return Object.freeze(result);
  }
  if (!isRecord(value)) throw new TypeError("invalid_object_value");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new TypeError("invalid_object_key");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("invalid_object_value");
    if (descriptor.enumerable) result[key] = cloneData(descriptor.value, seen);
  }
  seen.delete(value);
  return Object.freeze(result);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(stableStringify(value), "utf8").digest("hex");
}

function requireToken(value: unknown, maximum = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function safeRefs(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  let snapshot: unknown;
  try { snapshot = cloneData(value); } catch { return undefined; }
  if (!Array.isArray(snapshot) || snapshot.length > 50) return undefined;
  const refs: string[] = [];
  for (const item of snapshot) {
    if (!requireToken(item, 256)) return undefined;
    refs.push(item);
  }
  return refs;
}

function normalizeMoney(value: unknown): AmountEvidence | undefined {
  if (value === undefined) return { amount: null, basis: "unknown" };
  let snapshot: unknown;
  try { snapshot = cloneData(value); } catch { return undefined; }
  if (!isRecord(snapshot) || !Object.hasOwn(snapshot, "amount") || !Object.hasOwn(snapshot, "basis")) return undefined;
  const basis = snapshot.basis;
  const amount = snapshot.amount;
  if (basis !== "unknown" && basis !== "estimated" && basis !== "provider_confirmed") return undefined;
  if (amount === null) return basis === "unknown" ? { amount: null, basis } : undefined;
  if (!isRecord(amount) || typeof amount.currency !== "string" || !/^[A-Z]{3}$/.test(amount.currency)) return undefined;
  if (amount.representation === "decimal") {
    if (typeof amount.value !== "string" || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount.value)) return undefined;
    if (basis === "unknown") return undefined;
    return { amount: { representation: "decimal", value: amount.value, currency: amount.currency }, basis };
  }
  if (amount.representation === "scaled") {
    if (typeof amount.units !== "string" || !/^-?(?:0|[1-9][0-9]*)$/.test(amount.units)) return undefined;
    if (!Number.isInteger(amount.scale) || (amount.scale as number) < 0 || (amount.scale as number) > 18 || basis === "unknown") return undefined;
    return { amount: { representation: "scaled", units: amount.units, scale: amount.scale as number, currency: amount.currency }, basis };
  }
  if (amount.representation === "minor_units") {
    if (typeof amount.units !== "string" || !/^-?(?:0|[1-9][0-9]*)$/.test(amount.units) || basis === "unknown") return undefined;
    return { amount: { representation: "minor_units", units: amount.units, currency: amount.currency }, basis };
  }
  return undefined;
}

function utcFromEpoch(epoch: number): string | undefined {
  if (!Number.isFinite(epoch) || !Number.isSafeInteger(epoch) || epoch < 0) return undefined;
  try { return new Date(epoch).toISOString(); } catch { return undefined; }
}

function validUtc(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().replace(/\.000Z$/, "Z") === value.replace(/\.000Z$/, "Z");
}

function normalizeReservationRetirement(
  value: unknown,
  reservationRequestId: unknown
): ReservationRetirementEvidence | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || value.reservationRequestId !== reservationRequestId ||
      (value.state !== "denied" && value.state !== "released") ||
      !["authorization", "resolver", "legacy_state"].includes(String(value.source)) ||
      !validUtc(value.observedAt)) return undefined;
  return {
    reservationRequestId: value.reservationRequestId as string,
    state: value.state,
    source: value.source as ReservationResponseSource,
    observedAt: value.observedAt
  };
}

function normalizeReservationConflict(
  value: unknown,
  reservationRequestId: unknown
): ReservationConflictEvidence | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || value.reservationRequestId !== reservationRequestId ||
      !["not_requested", "requesting", "unknown", "reserved", "denied", "released"].includes(String(value.priorState)) ||
      !(value.priorReference === null || requireToken(value.priorReference)) ||
      !["reserved", "denied", "released"].includes(String(value.receivedState)) ||
      !(value.receivedReference === null || requireToken(value.receivedReference)) ||
      (value.source !== "authorization" && value.source !== "resolver") || !validUtc(value.observedAt)) return undefined;
  if ((value.priorState === "reserved") !== (value.priorReference !== null) ||
      (value.receivedState === "reserved") !== (value.receivedReference !== null)) return undefined;
  return {
    reservationRequestId: value.reservationRequestId as string,
    priorState: value.priorState as ReservationState,
    priorReference: value.priorReference as string | null,
    receivedState: value.receivedState as "reserved" | "denied" | "released",
    receivedReference: value.receivedReference as string | null,
    source: value.source,
    observedAt: value.observedAt
  };
}

function cloneReceipts(value: unknown, shape: SharedShape, scope: TrustedScope, schemaVersion: string): ContractReceipt[] | undefined {
  let snapshot: unknown;
  try { snapshot = cloneData(value); } catch { return undefined; }
  if (!Array.isArray(snapshot)) return undefined;
  const matching = snapshot.filter((receipt) => isRecord(receipt) && receipt.shape === shape);
  if (matching.length !== 1) return undefined;
  const receipt = matching[0] as Record<string, unknown>;
  if (typeof receipt.schemaVersion !== "string" || receipt.schemaVersion !== schemaVersion ||
      receipt.tenantId !== scope.tenantId || receipt.projectId !== scope.projectId) return undefined;
  return [{ shape, schemaVersion: receipt.schemaVersion, tenantId: scope.tenantId, projectId: scope.projectId }];
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function safeStoreError(error: unknown): MeteringFailure {
  if (error !== null && typeof error === "object" && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (code === "corrupt_state") return "storage_corrupt";
  }
  return "storage_unavailable";
}

function validateState(value: DurableJson, expectedContext?: MeteringStoreContext): MutableState | undefined {
  if (!isRecord(value) || value.schemaVersion !== "private-connector-metering-state/2" ||
      !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
      !Number.isSafeInteger(value.nextSequence) || (value.nextSequence as number) < 1 ||
      !Array.isArray(value.attempts) || !Array.isArray(value.outbox)) return undefined;
  const context = normalizeStoreContext(value.context);
  if (context === undefined || (expectedContext !== undefined && !sameStoreContext(context, expectedContext))) return undefined;
  const attemptIds = new Set<string>();
  const attemptKeys = new Set<string>();
  for (const candidate of value.attempts) {
    if (!isRecord(candidate) || !attemptMatchesContext(candidate, context) || !requireToken(candidate.attemptId) || !requireToken(candidate.clientAttemptKey, 256) ||
        !/^[a-f0-9]{64}$/.test(String(candidate.fingerprint)) || !requireToken(candidate.providerId) ||
        (candidate.operation !== "submit" && candidate.operation !== "cancel") ||
        !requireToken(candidate.logicalOperationId) || !requireToken(candidate.reservationRequestId) ||
        (candidate.mode !== "simulated" && candidate.mode !== "sandbox") ||
        (candidate.billingMode !== "simulated" && candidate.billingMode !== "sandbox") ||
        !["private_fixture", "provider_sandbox_account", "unknown"].includes(String(candidate.evidenceMode)) ||
        !isRecord(candidate.scope) || !requireToken(candidate.scope.tenantId) || !requireToken(candidate.scope.projectId) ||
        !Array.isArray(candidate.sourceRefs) || safeRefs(candidate.sourceRefs) === undefined ||
        normalizeMoney(candidate.quoteAmount) === undefined || normalizeMoney(candidate.reservationAmount) === undefined ||
        !reservationMatchesContext(candidate.reservationCandidate, context) ||
        !(candidate.reservationEnvelope === null || reservationMatchesContext(candidate.reservationEnvelope, context)) ||
        !Array.isArray(candidate.reservationReceipts) ||
        !["not_requested", "requesting", "unknown", "reserved", "denied", "released"].includes(String(candidate.reservationState)) ||
        !["accounting_pending", "reservation_pending", "reservation_unknown", "denied", "ready", "dispatch_intent", "dispatching", "unknown", "provider_accepted", "not_dispatched"].includes(String(candidate.phase)) ||
        !(candidate.reservationReference === null || requireToken(candidate.reservationReference)) ||
        !(candidate.transportAttemptId === null || requireToken(candidate.transportAttemptId)) ||
        !(candidate.providerRequestId === null || requireToken(candidate.providerRequestId)) ||
        !(candidate.outcome === null || ["provider_accepted", "not_dispatched", "unknown"].includes(String(candidate.outcome))) ||
        !(candidate.dispatchStartedAt === null || validUtc(candidate.dispatchStartedAt)) || !validUtc(candidate.updatedAt)) return undefined;
    if (candidate.phase === "dispatch_intent" || candidate.phase === "dispatching" ||
        candidate.phase === "provider_accepted" || (candidate.phase === "not_dispatched" && candidate.outcome !== null)) {
      if (!requireToken(candidate.transportAttemptId)) return undefined;
    }
    const terminalReservation = candidate.reservationState === "denied" || candidate.reservationState === "released";
    const terminalPhase = candidate.phase === "denied" || candidate.phase === "not_dispatched";
    let retirement: ReservationRetirementEvidence | null;
    if (Object.hasOwn(candidate, "reservationRetirement")) {
      const normalized = normalizeReservationRetirement(candidate.reservationRetirement, candidate.reservationRequestId);
      if (normalized === undefined || (normalized === null && terminalReservation && terminalPhase)) return undefined;
      retirement = normalized;
    } else if (terminalReservation) {
      // Schema /2 snapshots written before retirement evidence was added kept
      // the terminal finance fact in these fields. Normalize that fact without
      // rewriting the file; the next successful mutation persists the evidence.
      retirement = {
        reservationRequestId: candidate.reservationRequestId,
        state: candidate.reservationState as "denied" | "released",
        source: "legacy_state",
        observedAt: candidate.updatedAt
      };
    } else {
      retirement = null;
    }
    const conflictEvidence = Object.hasOwn(candidate, "reservationConflictEvidence")
      ? normalizeReservationConflict(candidate.reservationConflictEvidence, candidate.reservationRequestId)
      : null;
    const historyUncertain = Object.hasOwn(candidate, "reservationHistoryUncertain")
      ? candidate.reservationHistoryUncertain
      : candidate.reservationState === "unknown";
    const supersededByAttemptId = Object.hasOwn(candidate, "supersededByAttemptId")
      ? candidate.supersededByAttemptId
      : null;
    if (retirement === undefined || conflictEvidence === undefined ||
        typeof historyUncertain !== "boolean" ||
        !(supersededByAttemptId === null || requireToken(supersededByAttemptId)) ||
        (retirement === null && terminalReservation) ||
        (retirement !== null && (!terminalReservation || retirement.state !== candidate.reservationState)) ||
        (supersededByAttemptId !== null && retirement === null) ||
        (historyUncertain && retirement === null && candidate.reservationState !== "unknown") ||
        (conflictEvidence !== null && retirement === null && candidate.reservationState !== "unknown" &&
          !phaseHasEffectProgress(candidate.phase as MutableAttempt["phase"]))) return undefined;
    candidate.reservationRetirement = retirement as unknown as DurableJson;
    candidate.reservationConflictEvidence = conflictEvidence as unknown as DurableJson;
    candidate.reservationHistoryUncertain = historyUncertain as DurableJson;
    candidate.supersededByAttemptId = supersededByAttemptId as DurableJson;
    if (attemptIds.has(candidate.attemptId) || attemptKeys.has(candidate.clientAttemptKey)) return undefined;
    attemptIds.add(candidate.attemptId);
    attemptKeys.add(candidate.clientAttemptKey);
  }
  const attemptPositions = new Map<string, number>();
  for (let index = 0; index < value.attempts.length; index += 1) {
    const candidate = value.attempts[index] as Record<string, unknown>;
    attemptPositions.set(candidate.attemptId as string, index);
  }
  for (let index = 0; index < value.attempts.length; index += 1) {
    const candidate = value.attempts[index] as Record<string, unknown>;
    if (candidate.supersededByAttemptId === null) continue;
    const successorIndex = attemptPositions.get(candidate.supersededByAttemptId as string);
    if (successorIndex === undefined || successorIndex <= index) return undefined;
    const successor = value.attempts[successorIndex] as Record<string, unknown>;
    if (successor.providerId !== candidate.providerId || successor.logicalOperationId !== candidate.logicalOperationId ||
        !isRecord(successor.scope) || !isRecord(candidate.scope) ||
        successor.scope.tenantId !== candidate.scope.tenantId || successor.scope.projectId !== candidate.scope.projectId) return undefined;
  }
  const eventIds = new Set<string>();
  const observationIds = new Set<string>();
  const sequences = new Set<number>();
  let maxSequence = 0;
  for (const candidate of value.outbox) {
    if (!isRecord(candidate) || !candidateMatchesContext(candidate.candidate, context) ||
        !Number.isSafeInteger(candidate.sequence) || (candidate.sequence as number) < 1 ||
        !requireToken(candidate.eventId) || !requireToken(candidate.observationId) || !requireToken(candidate.eventType) ||
        !(candidate.sourceEventKey === null || requireToken(candidate.sourceEventKey, 256)) ||
        !/^[a-f0-9]{64}$/.test(String(candidate.fingerprint)) ||
        !(candidate.attemptId === null || requireToken(candidate.attemptId)) ||
        !isRecord(candidate.candidate) || candidate.candidate.event_id !== candidate.eventId ||
        candidate.candidate.observation_id !== candidate.observationId ||
        !(candidate.canonicalEnvelope === null || candidateMatchesContext(candidate.canonicalEnvelope, context)) ||
        !Array.isArray(candidate.receipts) ||
        (candidate.deliveryState !== "pending" && candidate.deliveryState !== "delivered") ||
        !Number.isSafeInteger(candidate.deliveryAttempts) || (candidate.deliveryAttempts as number) < 0 ||
        !(candidate.safeFailure === null || candidate.safeFailure === "contract_unavailable" || candidate.safeFailure === "usage_sink_unavailable")) return undefined;
    const sequence = candidate.sequence as number;
    if (eventIds.has(candidate.eventId) || observationIds.has(candidate.observationId) || sequences.has(sequence)) return undefined;
    if (candidate.attemptId !== null && !attemptIds.has(candidate.attemptId)) return undefined;
    eventIds.add(candidate.eventId);
    observationIds.add(candidate.observationId);
    sequences.add(sequence);
    maxSequence = Math.max(maxSequence, sequence);
  }
  if ((value.nextSequence as number) <= maxSequence) return undefined;
  return value as unknown as MutableState;
}

function normalizeObservation(input: MeteringObservationInput): NormalizedObservation | undefined {
  let snapshot: unknown;
  try { snapshot = cloneData(input); } catch { return undefined; }
  if (!isRecord(snapshot)) return undefined;
  const safeInput = snapshot as unknown as MeteringObservationInput;
  const fields = new Set([
    "operation", "sourceEventKey", "logicalOperationId", "billableAttemptId", "transportAttemptId",
    "providerRequestId", "occurredAt", "outcome", "completeness", "durationMs", "sourceRefs",
    "quoteAmount", "chargeAmount", "effect"
  ]);
  try {
    for (const key of Reflect.ownKeys(safeInput)) {
      if (typeof key !== "string" || !fields.has(key)) return undefined;
      const descriptor = Object.getOwnPropertyDescriptor(safeInput, key);
      if (descriptor === undefined || !("value" in descriptor)) return undefined;
    }
  } catch { return undefined; }
  const op = safeInput.operation;
  const outcomes: readonly string[] = ["observed", "attempt_prepared", "reservation_requested", "dispatching", "provider_accepted", "not_dispatched", "unknown"];
  const completeness = safeInput.completeness;
  if (typeof op !== "string" || ![
    "discover_capabilities", "quote", "preflight", "submit", "status", "shipment", "cancel"
  ].includes(op) || !outcomes.includes(String(safeInput.outcome)) ||
      (completeness !== "complete" && completeness !== "partial" && completeness !== "unknown") ||
      !["non_billable_observation", "potentially_billable_effect", "confirmed_effect", "unknown_effect"].includes(String(safeInput.effect))) return undefined;
  const sourceEventKey = safeInput.sourceEventKey === undefined ? null : safeInput.sourceEventKey;
  if (sourceEventKey !== null && !requireToken(sourceEventKey, 256)) return undefined;
  const optionalId = (raw: unknown): string | null | undefined => raw === undefined ? null : requireToken(raw) ? raw : undefined;
  const logicalOperationId = optionalId(safeInput.logicalOperationId);
  const billableAttemptId = optionalId(safeInput.billableAttemptId);
  const transportAttemptId = optionalId(safeInput.transportAttemptId);
  const providerRequestId = optionalId(safeInput.providerRequestId);
  if (logicalOperationId === undefined || billableAttemptId === undefined || transportAttemptId === undefined || providerRequestId === undefined) return undefined;
  const occurredAt = safeInput.occurredAt === undefined ? null : safeInput.occurredAt;
  if (occurredAt !== null && !validUtc(occurredAt)) return undefined;
  const durationMs = safeInput.durationMs === undefined ? null : safeInput.durationMs;
  if (durationMs !== null && (!Number.isSafeInteger(durationMs) || durationMs < 0)) return undefined;
  const refs = safeRefs(safeInput.sourceRefs);
  if (refs === undefined) return undefined;
  const quoteAmount = normalizeMoney(safeInput.quoteAmount);
  const chargeAmount = normalizeMoney(safeInput.chargeAmount);
  if (quoteAmount === undefined || chargeAmount === undefined) return undefined;
  return {
    operation: op as Operation,
    sourceEventKey,
    logicalOperationId,
    billableAttemptId,
    transportAttemptId,
    providerRequestId,
    occurredAt,
    outcome: safeInput.outcome as MeteringOutcome,
    completeness,
    durationMs,
    sourceRefs: refs,
    quoteAmount,
    chargeAmount,
    effect: safeInput.effect
  };
}

function observationFingerprint(input: NormalizedObservation): string {
  const { sourceEventKey: _key, ...stable } = input;
  return fingerprint(stable);
}

type ReservationFact =
  | { readonly state: "reserved"; readonly reference: string }
  | { readonly state: "denied" | "released" | "unknown"; readonly reference: null };

interface ReservationMerge {
  readonly attempt: MutableAttempt;
  readonly conflict: boolean;
}

function phaseHasEffectProgress(phase: MutableAttempt["phase"]): boolean {
  return phase === "dispatch_intent" || phase === "dispatching" || phase === "unknown" ||
    phase === "provider_accepted" || phase === "not_dispatched";
}

function mergeReservationFact(
  stored: MutableAttempt,
  fact: ReservationFact,
  updatedAt: string,
  source: Exclude<ReservationResponseSource, "legacy_state">,
  siblingHasOwner: boolean
): ReservationMerge {
  if (fact.state === "unknown") {
    return { attempt: stored, conflict: stored.reservationConflictEvidence !== null || stored.reservationHistoryUncertain };
  }
  const sameFact = stored.reservationState === fact.state && stored.reservationReference === fact.reference;
  const newConflict: ReservationConflictEvidence = {
    reservationRequestId: stored.reservationRequestId,
    priorState: stored.reservationState,
    priorReference: stored.reservationReference,
    receivedState: fact.state,
    receivedReference: fact.reference,
    source,
    observedAt: updatedAt
  };
  const withUnknownConflict = (): ReservationMerge => {
    const preserveEffectProgress = phaseHasEffectProgress(stored.phase);
    return {
      attempt: stored.reservationConflictEvidence === null
        ? {
            ...stored,
            reservationState: preserveEffectProgress ? stored.reservationState : "unknown",
            reservationReference: preserveEffectProgress ? stored.reservationReference : null,
            reservationConflictEvidence: newConflict,
            phase: preserveEffectProgress ? stored.phase : "reservation_unknown",
            updatedAt
          }
        : stored,
      conflict: true
    };
  };
  const retirementForFact = (): ReservationRetirementEvidence => ({
    reservationRequestId: stored.reservationRequestId,
    state: fact.state as "denied" | "released",
    source,
    observedAt: updatedAt
  });
  const canRecordRetirement = (phase: MutableAttempt["phase"]): boolean =>
    !phaseHasEffectProgress(phase) || phase === "not_dispatched";
  const terminalPhaseFor = (phase: MutableAttempt["phase"]): MutableAttempt["phase"] =>
    phase === "not_dispatched" ? "not_dispatched" : "denied";

  if (stored.reservationRetirement !== null) {
    if (sameFact && fact.state === stored.reservationRetirement.state) {
      return { attempt: stored, conflict: stored.reservationConflictEvidence !== null || stored.reservationHistoryUncertain };
    }
    return {
      attempt: stored.reservationConflictEvidence === null
        ? { ...stored, reservationConflictEvidence: newConflict, updatedAt }
        : stored,
      conflict: true
    };
  }

  if (stored.reservationHistoryUncertain) {
    if ((fact.state === "denied" || fact.state === "released") && canRecordRetirement(stored.phase)) {
      return {
        attempt: {
          ...stored,
          reservationState: fact.state,
          reservationReference: null,
          reservationRetirement: retirementForFact(),
          phase: terminalPhaseFor(stored.phase),
          updatedAt
        },
        conflict: true
      };
    }
    if (fact.state === "reserved") return withUnknownConflict();
    return { attempt: stored, conflict: true };
  }

  if (stored.reservationConflictEvidence !== null) {
    if ((fact.state === "denied" || fact.state === "released") && canRecordRetirement(stored.phase)) {
      return {
        attempt: {
          ...stored,
          reservationState: fact.state,
          reservationReference: null,
          reservationRetirement: retirementForFact(),
          phase: terminalPhaseFor(stored.phase),
          updatedAt
        },
        conflict: true
      };
    }
    return { attempt: stored, conflict: true };
  }

  if (sameFact) return { attempt: stored, conflict: false };

  const canRetire = (fact.state === "denied" || fact.state === "released") &&
    canRecordRetirement(stored.phase) &&
    (stored.reservationState === "requesting" || stored.reservationState === "unknown" ||
      (stored.phase === "not_dispatched" && stored.reservationState === "reserved"));
  if (canRetire) {
    return {
      attempt: {
        ...stored,
        reservationState: fact.state,
        reservationReference: null,
        reservationRetirement: retirementForFact(),
        phase: terminalPhaseFor(stored.phase),
        updatedAt
      },
      conflict: false
    };
  }

  const currentIsKnown = stored.reservationState === "reserved" || stored.reservationState === "denied" ||
    stored.reservationState === "released";
  const mustRemainUnknown = fact.state !== "reserved" || currentIsKnown || stored.reservationState === "not_requested";
  if (mustRemainUnknown) return withUnknownConflict();

  // A late reserved result cannot activate an attempt after a sibling has
  // claimed or completed the same logical operation.
  if (siblingHasOwner || stored.supersededByAttemptId !== null) return withUnknownConflict();
  return {
    attempt: {
      ...stored,
      reservationState: "reserved",
      reservationReference: fact.reference,
      phase: phaseHasEffectProgress(stored.phase) ? stored.phase : "ready",
      updatedAt
    },
    conflict: false
  };
}

export class FulfillmentMetering {
  private readonly store: DurableJsonStore;
  private readonly idFactory: NonNullable<MeteringDependencies["idFactory"]>;
  private readonly context: MeteringStoreContext;

  private constructor(private readonly dependencies: MeteringDependencies, store: DurableJsonStore, context: MeteringStoreContext) {
    this.store = store;
    this.context = deepFreeze(context);
    this.idFactory = dependencies.idFactory ?? (() => randomUUID());
  }

  static async open(dependencies: MeteringDependencies): Promise<FulfillmentMetering> {
    if (!isRecord(dependencies) || !requireToken(dependencies.providerId) ||
        (dependencies.mode !== "simulated" && dependencies.mode !== "sandbox") ||
        (dependencies.billingMode !== "simulated" && dependencies.billingMode !== "sandbox") ||
        !["private_fixture", "provider_sandbox_account", "unknown"].includes(String(dependencies.evidenceMode)) ||
        !isRecord(dependencies.scope) || !requireToken(dependencies.scope.tenantId) || !requireToken(dependencies.scope.projectId)) {
      throw new TypeError("invalid_metering_configuration");
    }
    let scope: TrustedScope;
    try { scope = deepFreeze(cloneData(dependencies.scope)) as TrustedScope; }
    catch { throw new TypeError("invalid_metering_configuration"); }
    const context = normalizeStoreContext({
      providerId: dependencies.providerId,
      mode: dependencies.mode,
      billingMode: dependencies.billingMode,
      evidenceMode: dependencies.evidenceMode,
      scope
    });
    if (context === undefined) throw new TypeError("invalid_metering_configuration");
    const safeDependencies: MeteringDependencies = { ...dependencies, scope: context.scope };
    const store = await DurableJsonStore.open(safeDependencies.directory, initialState(context) as unknown as DurableJson);
    const instance = new FulfillmentMetering(safeDependencies, store, context);
    instance.checkClock();
    await instance.readState();
    return instance;
  }

  isConfiguredFor(providerId: string, mode: ProviderMode, scope: TrustedScope): boolean {
    try {
      return providerId === this.context.providerId && mode === this.context.mode &&
        scope !== null && typeof scope === "object" &&
        scope.tenantId === this.context.scope.tenantId && scope.projectId === this.context.scope.projectId;
    } catch { return false; }
  }

  async snapshot(): Promise<MeteringSnapshot> {
    const state = await this.readState();
    return deepFreeze({
      schemaVersion: state.schemaVersion,
      revision: state.revision,
      attempts: state.attempts.map((attempt) => ({
        attemptId: attempt.attemptId,
        clientAttemptKey: attempt.clientAttemptKey,
        logicalOperationId: attempt.logicalOperationId,
        operation: attempt.operation,
        phase: attempt.phase,
        reservationState: attempt.reservationState,
        reservationRequestId: attempt.reservationRequestId,
        reservationReference: attempt.reservationReference,
        transportAttemptId: attempt.transportAttemptId,
        providerRequestId: attempt.providerRequestId,
        outcome: attempt.outcome,
        updatedAt: attempt.updatedAt
      })),
      outbox: state.outbox.map((event) => ({
        eventId: event.eventId,
        observationId: event.observationId,
        eventType: event.eventType,
        deliveryState: event.deliveryState,
        deliveryAttempts: event.deliveryAttempts,
        sequence: event.sequence
      }))
    });
  }

  async recordObservation(input: MeteringObservationInput): Promise<MeteringResult> {
    const normalized = normalizeObservation(input);
    if (normalized === undefined) return { status: "blocked", reason: "invalid_input" };
    const observedAt = this.nowUtc();
    if (observedAt === undefined) return { status: "blocked", reason: "invalid_input" };
    const stableFingerprint = fingerprint({
      context: {
        providerId: this.dependencies.providerId,
        scope: this.dependencies.scope,
        mode: this.dependencies.mode,
        billingMode: this.dependencies.billingMode,
        evidenceMode: this.dependencies.evidenceMode
      },
      observation: observationFingerprint(normalized)
    });
    let selected: MutableOutboxEvent | undefined;
    try {
      const result = await this.mutateState<{ readonly conflict: boolean; readonly event: MutableOutboxEvent }>((state) => {
        if (normalized.sourceEventKey !== null) {
          const existing = state.outbox.find((event) => event.sourceEventKey === normalized.sourceEventKey);
          if (existing !== undefined) {
            if (existing.fingerprint !== stableFingerprint) return { state, result: { conflict: true as const, event: existing } };
            return { state, result: { conflict: false as const, event: existing } };
          }
        }
        const event = this.newEvent(state, {
          eventType: "provider_observation",
          sourceEventKey: normalized.sourceEventKey,
          fingerprint: stableFingerprint,
          attemptId: null,
          candidate: this.observationCandidate("provider_observation", normalized, observedAt)
        });
        state.outbox.push(event);
        return { state, result: { conflict: false as const, event } };
      });
      if (result.conflict) return { status: "blocked", eventId: result.event.eventId, observationId: result.event.observationId, reason: "attempt_conflict" } as MeteringResult;
      selected = result.event;
    } catch (error) {
      return { status: "blocked", reason: safeStoreError(error) };
    }
    if (selected === undefined) return { status: "blocked", reason: "storage_unavailable" };
    const delivered = await this.deliverEvent(selected.eventId);
    return delivered
      ? { status: "recorded", eventId: selected.eventId, observationId: selected.observationId }
      : { status: "pending", eventId: selected.eventId, observationId: selected.observationId, reason: "usage_sink_unavailable" };
  }

  async prepareBillableAttempt(input: BillableAttemptInput): Promise<MeteringResult> {
    const normalized = this.normalizeAttemptInput(input);
    if (normalized === undefined || normalized.providerId !== this.dependencies.providerId) return { status: "blocked", reason: "invalid_input" };
    const stableFingerprint = fingerprint({
      request: normalized,
      configuredProviderId: this.dependencies.providerId,
      scope: this.dependencies.scope,
      mode: this.dependencies.mode,
      billingMode: this.dependencies.billingMode,
      evidenceMode: this.dependencies.evidenceMode
    });
    const current = await this.safeReadState();
    if (current.state === undefined) return { status: "blocked", reason: current.reason };
    const existing = current.state.attempts.find((attempt) => attempt.clientAttemptKey === normalized.clientAttemptKey);
    if (existing !== undefined) {
      if (existing.fingerprint !== stableFingerprint) return { status: "blocked", attemptId: existing.attemptId, reason: "attempt_conflict" };
      return this.advancePreparation(existing.attemptId);
    }
    if (current.state.outbox.some((event) => event.deliveryState === "pending")) {
      const replay = await this.replayPending();
      if (replay.pending > 0) return { status: "blocked", reason: "usage_sink_unavailable" };
    }
    const active = current.state.attempts.find((attempt) =>
      attempt.providerId === normalized.providerId &&
      attempt.scope.tenantId === this.dependencies.scope.tenantId &&
      attempt.scope.projectId === this.dependencies.scope.projectId &&
      attempt.logicalOperationId === normalized.logicalOperationId &&
      !this.canStartAnother(attempt)
    );
    if (active !== undefined) return { status: "blocked", attemptId: active.attemptId, reason: "logical_operation_blocked" };
    const observedAt = this.nowUtc();
    if (observedAt === undefined) return { status: "blocked", reason: "invalid_input" };
    let attemptId: string;
    let reservationRequestId: string;
    try {
      attemptId = this.newId("attempt");
      reservationRequestId = this.newId("reservation");
    } catch { return { status: "blocked", reason: "invalid_input" }; }
    const now = observedAt;
    const candidate = this.toDurable({
      reservation_request_id: reservationRequestId,
      provider_id: normalized.providerId,
      operation: normalized.operation,
      logical_operation_id: normalized.logicalOperationId,
      billable_attempt_id: attemptId,
      mode: this.dependencies.mode,
      billing_mode: this.dependencies.billingMode,
      evidence_mode: this.dependencies.evidenceMode,
      requested_amount: normalized.reservationAmount,
      source_refs: normalized.sourceRefs
    });
    if (candidate === undefined) return { status: "blocked", reason: "invalid_input" };
    const attempt: MutableAttempt = {
      attemptId,
      clientAttemptKey: normalized.clientAttemptKey,
      fingerprint: stableFingerprint,
      providerId: normalized.providerId,
      operation: normalized.operation,
      logicalOperationId: normalized.logicalOperationId,
      mode: this.dependencies.mode,
      billingMode: this.dependencies.billingMode,
      evidenceMode: this.dependencies.evidenceMode,
      scope: this.toDurable(this.dependencies.scope) as unknown as TrustedScope,
      sourceRefs: normalized.sourceRefs,
      quoteAmount: normalized.quoteAmount,
      reservationAmount: normalized.reservationAmount,
      reservationRequestId,
      reservationCandidate: candidate,
      reservationEnvelope: null,
      reservationReceipts: [],
      reservationState: "not_requested",
      reservationReference: null,
      reservationRetirement: null,
      reservationConflictEvidence: null,
      reservationHistoryUncertain: false,
      supersededByAttemptId: null,
      phase: "accounting_pending",
      transportAttemptId: null,
      providerRequestId: null,
      outcome: null,
      dispatchStartedAt: null,
      updatedAt: now
    };
    try {
      await this.mutateState((state) => {
        if (state.attempts.some((stored) => stored.clientAttemptKey === normalized.clientAttemptKey)) {
          return { state, result: false };
        }
        if (state.attempts.some((stored) => stored.providerId === normalized.providerId &&
            stored.scope.tenantId === this.dependencies.scope.tenantId && stored.scope.projectId === this.dependencies.scope.projectId &&
            stored.logicalOperationId === normalized.logicalOperationId && !this.canStartAnother(stored))) {
          return { state, result: false };
        }
        for (let index = 0; index < state.attempts.length; index += 1) {
          const stored = state.attempts[index]!;
          if (this.sameLogicalOperation(stored, attempt) && this.canStartAnother(stored) &&
              stored.supersededByAttemptId === null) {
            state.attempts[index] = { ...stored, supersededByAttemptId: attemptId };
          }
        }
        state.attempts.push(attempt);
        state.outbox.push(this.newAttemptEvent(state, attempt, "billable_attempt_prepared", "attempt_prepared", null));
        return { state, result: true };
      });
    } catch (error) {
      return { status: "blocked", attemptId, reason: safeStoreError(error) };
    }
    const reloaded = await this.safeReadState();
    if (reloaded.state === undefined) return { status: "blocked", attemptId, reason: reloaded.reason };
    const saved = reloaded.state.attempts.find((item) => item.attemptId === attemptId);
    if (saved === undefined) {
      const winner = reloaded.state.attempts.find((item) => item.clientAttemptKey === normalized.clientAttemptKey);
      if (winner !== undefined && winner.fingerprint === stableFingerprint) return this.advancePreparation(winner.attemptId);
      const logicalWinner = reloaded.state.attempts.find((item) => item.providerId === normalized.providerId &&
        item.scope.tenantId === this.dependencies.scope.tenantId && item.scope.projectId === this.dependencies.scope.projectId &&
        item.logicalOperationId === normalized.logicalOperationId && !this.canStartAnother(item));
      if (logicalWinner !== undefined) return { status: "blocked", attemptId: logicalWinner.attemptId, reason: "logical_operation_blocked" };
      return { status: "blocked", reason: "attempt_conflict" };
    }
    return this.advancePreparation(attemptId);
  }

  async reconcileReservation(attemptId: string): Promise<MeteringResult> {
    const read = await this.safeReadState();
    if (read.state === undefined) return { status: "blocked", attemptId, reason: read.reason };
    const attempt = read.state.attempts.find((item) => item.attemptId === attemptId);
    if (attempt === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
    if (attempt.reservationHistoryUncertain || attempt.reservationConflictEvidence !== null) {
      return { status: "blocked", attemptId, reason: "budget_unknown" };
    }
    if (attempt.phase === "denied") return { status: "denied", attemptId, reason: "budget_denied" };
    if (attempt.phase === "dispatch_intent" || attempt.phase === "dispatching" || attempt.phase === "unknown") {
      return { status: "blocked", attemptId, reason: "attempt_outcome_unknown" };
    }
    if (attempt.phase === "provider_accepted" || attempt.phase === "not_dispatched") {
      if (attempt.phase === "provider_accepted") return { status: "blocked", attemptId, reason: "attempt_not_ready" };
      if (attempt.reservationState === "denied" || attempt.reservationState === "released") {
        return { status: "denied", attemptId, reason: "budget_denied" };
      }
    }
    if (this.hasSiblingOwner(read.state, attempt)) {
      return { status: "blocked", attemptId, reason: "logical_operation_blocked" };
    }
    if (attempt.phase === "ready" && attempt.reservationState === "reserved" && attempt.reservationReference !== null) {
      return { status: "ready", attemptId, reservationReference: attempt.reservationReference };
    }
    if (attempt.reservationState !== "requesting" && attempt.reservationState !== "unknown" &&
        !(attempt.phase === "not_dispatched" && attempt.reservationState === "reserved")) {
      return { status: "blocked", attemptId, reason: "reservation_unavailable" };
    }
    const resolver = this.dependencies.reservationResolver;
    if (resolver === undefined) return { status: "blocked", attemptId, reason: "budget_unknown" };
    let raw: unknown;
    try { raw = await resolver.resolve(attempt.reservationRequestId, attempt.scope, attempt.mode); }
    catch { return { status: "blocked", attemptId, reason: "budget_unknown" }; }
    const status = this.parseReservationResolution(raw);
    if (status === undefined) return { status: "blocked", attemptId, reason: "budget_unknown" };
    const updatedAt = this.nowUtc();
    if (updatedAt === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
    try {
      const merged = await this.applyReservationFact(attemptId, attempt.reservationRequestId, status, updatedAt, "resolver");
      if (merged === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
      if (merged.conflict) return { status: "blocked", attemptId, reason: "budget_unknown" };
      return this.reservationResult(merged.attempt);
    } catch (error) { return { status: "blocked", attemptId, reason: safeStoreError(error) }; }
  }

  async dispatchPreparedAttempt(attemptId: string, dispatch: DispatchPort): Promise<MeteringResult> {
    if (!requireToken(attemptId) || typeof dispatch !== "function") return { status: "blocked", reason: "invalid_input" };
    const read = await this.safeReadState();
    if (read.state === undefined) return { status: "blocked", attemptId, reason: read.reason };
    let attempt = read.state.attempts.find((item) => item.attemptId === attemptId);
    if (attempt === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
    if (attempt.reservationRetirement !== null || attempt.reservationHistoryUncertain ||
        attempt.supersededByAttemptId !== null) {
      return { status: "blocked", attemptId, reason: "attempt_not_ready" };
    }
    if (this.hasSiblingOwner(read.state, attempt)) {
      return { status: "blocked", attemptId, reason: "logical_operation_blocked" };
    }
    if (attempt.phase === "provider_accepted" || attempt.phase === "not_dispatched" || attempt.phase === "unknown" || attempt.phase === "dispatching") {
      return {
        status: "blocked",
        attemptId,
        reason: attempt.phase === "unknown" || attempt.phase === "dispatching" ? "attempt_outcome_unknown" : "attempt_not_ready"
      };
    }
    if (attempt.phase === "accounting_pending" || attempt.phase === "reservation_pending" || attempt.phase === "reservation_unknown" ||
        attempt.phase === "denied" || attempt.reservationState !== "reserved" || attempt.reservationReference === null) {
      return { status: "blocked", attemptId, reason: "attempt_not_ready" };
    }
    const pending = read.state.outbox.find((event) => event.deliveryState === "pending");
    if (pending !== undefined) {
      await this.replayPending();
      const refreshed = await this.safeReadState();
      if (refreshed.state === undefined) return { status: "blocked", attemptId, reason: refreshed.reason };
      attempt = refreshed.state.attempts.find((item) => item.attemptId === attemptId);
      if (attempt === undefined || refreshed.state.outbox.some((event) => event.deliveryState === "pending")) {
        return { status: "blocked", attemptId, reason: "usage_sink_unavailable" };
      }
    }
    if (attempt.transportAttemptId === null) {
      let transportAttemptId: string;
      try { transportAttemptId = this.newId("transport"); }
      catch { return { status: "blocked", attemptId, reason: "invalid_input" }; }
      const observedAt = this.nowUtc();
      if (observedAt === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
      try {
        await this.mutateState((state) => {
          const index = state.attempts.findIndex((item) => item.attemptId === attemptId);
          if (index < 0) return { state, result: false };
          const stored = state.attempts[index]!;
          if (stored.transportAttemptId !== null || stored.phase !== "ready" ||
              stored.reservationRetirement !== null || stored.reservationHistoryUncertain ||
              stored.supersededByAttemptId !== null ||
              this.hasSiblingOwner(state, stored)) return { state, result: false };
          const updated = { ...stored, transportAttemptId, phase: "dispatch_intent" as const, updatedAt: observedAt };
          state.attempts[index] = updated;
          state.outbox.push(this.newAttemptEvent(state, updated, "transport_attempt_intent", "dispatching", transportAttemptId));
          return { state, result: true };
        });
      } catch (error) { return { status: "blocked", attemptId, reason: safeStoreError(error) }; }
      const refreshed = await this.safeReadState();
      if (refreshed.state === undefined) return { status: "blocked", attemptId, reason: refreshed.reason };
      attempt = refreshed.state.attempts.find((item) => item.attemptId === attemptId);
      if (attempt === undefined || attempt.transportAttemptId === null) return { status: "blocked", attemptId, reason: "attempt_not_ready" };
    }
    const intent = (await this.safeReadState()).state?.outbox.find((event) => event.attemptId === attemptId && event.eventType === "transport_attempt_intent");
    if (intent === undefined) return { status: "blocked", attemptId, reason: "attempt_not_ready" };
    if (intent.deliveryState !== "delivered") {
      const report = await this.replayPending();
      if (report.pending > 0) return { status: "blocked", attemptId, reason: "usage_sink_unavailable" };
    }
    const dispatchStartedAt = this.nowUtc();
    if (dispatchStartedAt === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
    try {
      const claim = await this.mutateState<
        | { readonly claimed: true; readonly attempt: MutableAttempt }
        | { readonly claimed: false; readonly attempt?: MutableAttempt }
      >((state) => {
        const index = state.attempts.findIndex((item) => item.attemptId === attemptId);
        if (index < 0) return { state, result: { claimed: false as const } };
        const stored = state.attempts[index]!;
        const pendingOutbox = state.outbox.some((event) => event.deliveryState === "pending");
        const intentDelivered = state.outbox.some((event) => event.attemptId === attemptId &&
          event.eventType === "transport_attempt_intent" && event.deliveryState === "delivered");
        if (stored.phase !== "dispatch_intent" || stored.transportAttemptId === null || pendingOutbox || !intentDelivered ||
            stored.reservationState !== "reserved" || stored.reservationReference === null ||
            stored.reservationRetirement !== null || stored.reservationHistoryUncertain ||
            stored.supersededByAttemptId !== null ||
            this.hasSiblingOwner(state, stored)) {
          return { state, result: { claimed: false as const, attempt: stored } };
        }
        const claimed: MutableAttempt = { ...stored, phase: "dispatching", dispatchStartedAt, updatedAt: dispatchStartedAt };
        state.attempts[index] = claimed;
        return { state, result: { claimed: true as const, attempt: claimed } };
      });
      if (!claim.claimed) return { status: "blocked", attemptId, reason: claim.attempt?.phase === "dispatching" || claim.attempt?.phase === "unknown" ? "attempt_outcome_unknown" : "attempt_not_ready" };
      attempt = claim.attempt;
    } catch (error) { return { status: "blocked", attemptId, reason: safeStoreError(error) }; }
    const identity: DispatchIdentity = deepFreeze({
      providerId: attempt.providerId,
      operation: attempt.operation,
      logicalOperationId: attempt.logicalOperationId,
      billableAttemptId: attempt.attemptId,
      transportAttemptId: attempt.transportAttemptId as string,
      reservationRequestId: attempt.reservationRequestId,
      reservationReference: attempt.reservationReference as string,
      mode: attempt.mode,
      billingMode: attempt.billingMode,
      evidenceMode: attempt.evidenceMode,
      scope: { tenantId: attempt.scope.tenantId, projectId: attempt.scope.projectId }
    });
    const startEpoch = Date.parse(dispatchStartedAt);
    let raw: unknown;
    type DispatchOutcome = "provider_accepted" | "not_dispatched" | "unknown";
    let outcome: DispatchOutcome = "unknown";
    let providerRequestId: string | null = null;
    let chargeAmount: AmountEvidence = { amount: null, basis: "unknown" };
    let sourceRefs = attempt.sourceRefs;
    try {
      const dispatchResponse = cloneData(await dispatch(identity));
      if (!isRecord(dispatchResponse) || !["provider_accepted", "not_dispatched", "unknown"].includes(String(dispatchResponse.outcome))) {
        outcome = "unknown";
      } else {
        outcome = dispatchResponse.outcome as DispatchOutcome;
        if (dispatchResponse.providerRequestId !== undefined) {
          if (!requireToken(dispatchResponse.providerRequestId)) outcome = "unknown";
          else providerRequestId = dispatchResponse.providerRequestId;
        }
        if (dispatchResponse.chargeAmount !== undefined) {
          const normalizedCharge = normalizeMoney(dispatchResponse.chargeAmount);
          if (normalizedCharge === undefined) outcome = "unknown";
          else chargeAmount = normalizedCharge;
        }
        if (dispatchResponse.sourceRefs !== undefined) {
          const refs = safeRefs(dispatchResponse.sourceRefs);
          if (refs === undefined) outcome = "unknown";
          else sourceRefs = refs;
        }
      }
    } catch {
      outcome = "unknown";
    }
    const finishedAt = this.nowUtc();
    const elapsedMs = finishedAt === undefined || !Number.isFinite(startEpoch) ? Number.NaN : Date.parse(finishedAt) - startEpoch;
    const durationMs = Number.isSafeInteger(elapsedMs) && elapsedMs >= 0 ? elapsedMs : null;
    const safeFinishedAt = finishedAt ?? dispatchStartedAt;
    try {
      const updated = await this.mutateState<{ readonly attempt: MutableAttempt; readonly event: MutableOutboxEvent } | MutableAttempt>((state) => {
        const index = state.attempts.findIndex((item) => item.attemptId === attemptId);
        if (index < 0) throw new Error("attempt_missing");
        const stored = state.attempts[index]!;
        if (stored.phase !== "dispatching") return { state, result: stored };
        const phase = outcome === "provider_accepted" ? "provider_accepted" : outcome === "not_dispatched" ? "not_dispatched" : "unknown";
        const current: MutableAttempt = {
          ...stored,
          phase,
          providerRequestId,
          outcome,
          sourceRefs,
          updatedAt: safeFinishedAt
        };
        state.attempts[index] = current;
        const normalized: NormalizedObservation = {
          operation: current.operation,
          sourceEventKey: null,
          logicalOperationId: current.logicalOperationId,
          billableAttemptId: current.attemptId,
          transportAttemptId: current.transportAttemptId,
          providerRequestId,
          occurredAt: safeFinishedAt,
          outcome,
          completeness: outcome === "unknown" ? "partial" : "complete",
          durationMs,
          sourceRefs,
          quoteAmount: current.quoteAmount,
          chargeAmount,
          effect: outcome === "provider_accepted" ? "confirmed_effect" : outcome === "not_dispatched" ? "potentially_billable_effect" : "unknown_effect"
        };
        const event = this.newEvent(state, {
          eventType: "billable_attempt_outcome",
          sourceEventKey: null,
          fingerprint: fingerprint({ attemptId, outcome, providerRequestId, chargeAmount, sourceRefs, finishedAt: safeFinishedAt }),
          attemptId,
          candidate: this.observationCandidate("billable_attempt_outcome", normalized, safeFinishedAt)
        });
        state.outbox.push(event);
        return { state, result: { attempt: current, event } };
      });
      const final = "event" in (updated as unknown as Record<string, unknown>)
        ? updated as unknown as { readonly attempt: MutableAttempt; readonly event: MutableOutboxEvent }
        : { attempt: updated as unknown as MutableAttempt, event: undefined };
      if (final.event === undefined) return { status: "blocked", attemptId, reason: "attempt_outcome_unknown" };
      const delivered = await this.deliverEvent(final.event.eventId);
      return {
        status: "effect_recorded",
        attemptId,
        transportAttemptId: final.attempt.transportAttemptId as string,
        outcome: final.attempt.outcome as "provider_accepted" | "not_dispatched" | "unknown",
        providerRequestId: final.attempt.providerRequestId,
        pendingEventId: delivered ? null : final.event.eventId
      };
    } catch (error) {
      return { status: "blocked", attemptId, reason: safeStoreError(error) };
    }
  }

  async replayPending(): Promise<{ readonly delivered: number; readonly pending: number; readonly failures: readonly MeteringFailure[] }> {
    let state: MutableState;
    try { state = await this.readState(); }
    catch (error) { return { delivered: 0, pending: 0, failures: [safeStoreError(error)] }; }
    let delivered = 0;
    const failures: MeteringFailure[] = [];
    for (const event of [...state.outbox].sort((a, b) => a.sequence - b.sequence)) {
      if (event.deliveryState === "delivered") continue;
      const success = await this.deliverEvent(event.eventId);
      if (success) delivered += 1;
      else {
        const refreshed = await this.safeReadState();
        const current = refreshed.state?.outbox.find((item) => item.eventId === event.eventId);
        failures.push(current?.safeFailure ?? "usage_sink_unavailable");
      }
    }
    const refreshed = await this.safeReadState();
    const pending = refreshed.state?.outbox.filter((event) => event.deliveryState === "pending").length ?? 0;
    if (refreshed.state === undefined) failures.push(refreshed.reason);
    return { delivered, pending, failures };
  }

  private async applyReservationFact(
    attemptId: string,
    expectedRequestId: string,
    fact: ReservationFact,
    updatedAt: string,
    source: Exclude<ReservationResponseSource, "legacy_state">
  ): Promise<{ readonly attempt: MutableAttempt; readonly conflict: boolean } | undefined> {
    return this.mutateState((state) => {
      const index = state.attempts.findIndex((item) => item.attemptId === attemptId);
      if (index < 0) return { state, result: undefined };
      const stored = state.attempts[index]!;
      if (stored.reservationRequestId !== expectedRequestId) {
        return { state, result: { attempt: stored, conflict: true } };
      }
      const merged = mergeReservationFact(stored, fact, updatedAt, source, this.hasSiblingOwner(state, stored));
      if (merged.attempt !== stored) state.attempts[index] = merged.attempt;
      return { state, result: merged };
    });
  }

  private reservationResult(attempt: MutableAttempt): MeteringResult {
    if (attempt.phase === "ready" && attempt.reservationState === "reserved" && attempt.reservationReference !== null) {
      return { status: "ready", attemptId: attempt.attemptId, reservationReference: attempt.reservationReference };
    }
    if (attempt.phase === "denied") return { status: "denied", attemptId: attempt.attemptId, reason: "budget_denied" };
    if (attempt.phase === "dispatch_intent" || attempt.phase === "dispatching" || attempt.phase === "unknown") {
      return { status: "blocked", attemptId: attempt.attemptId, reason: "attempt_outcome_unknown" };
    }
    if (attempt.phase === "not_dispatched" && (attempt.reservationState === "denied" || attempt.reservationState === "released")) {
      return { status: "denied", attemptId: attempt.attemptId, reason: "budget_denied" };
    }
    if (attempt.phase === "provider_accepted" || attempt.phase === "not_dispatched") {
      return { status: "blocked", attemptId: attempt.attemptId, reason: "attempt_not_ready" };
    }
    if (attempt.reservationState === "denied" || attempt.reservationState === "released") {
      return { status: "denied", attemptId: attempt.attemptId, reason: "budget_denied" };
    }
    return { status: "blocked", attemptId: attempt.attemptId, reason: "budget_unknown" };
  }

  private async advancePreparation(attemptId: string): Promise<MeteringResult> {
    let read = await this.safeReadState();
    if (read.state === undefined) return { status: "blocked", attemptId, reason: read.reason };
    let attempt = read.state.attempts.find((item) => item.attemptId === attemptId);
    if (attempt === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
    if (attempt.phase !== "ready") {
      const terminal = this.preparationResult(attempt);
      if (terminal !== undefined) return terminal;
    }
    if (this.hasSiblingOwner(read.state, attempt)) {
      return { status: "blocked", attemptId, reason: "logical_operation_blocked" };
    }
    if (attempt.phase === "ready") return this.preparationResult(attempt) as MeteringResult;
    const accounting = await this.replayPending();
    read = await this.safeReadState();
    if (read.state === undefined) return { status: "blocked", attemptId, reason: read.reason };
    attempt = read.state.attempts.find((item) => item.attemptId === attemptId);
    if (attempt === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
    if (attempt.phase !== "ready") {
      const afterReplay = this.preparationResult(attempt);
      if (afterReplay !== undefined) return afterReplay;
    }
    if (this.hasSiblingOwner(read.state, attempt)) {
      return { status: "blocked", attemptId, reason: "logical_operation_blocked" };
    }
    if (attempt.phase === "ready") return this.preparationResult(attempt) as MeteringResult;
    if (accounting.pending > 0 || read.state.outbox.some((event) => event.attemptId === attemptId && event.deliveryState === "pending")) {
      return { status: "blocked", attemptId, reason: "usage_sink_unavailable" };
    }
    if (attempt.reservationState === "requesting" || attempt.reservationState === "unknown") return this.reconcileReservation(attemptId);
    if (attempt.reservationState === "reserved" && attempt.reservationReference !== null) {
      const updatedAt = this.nowUtc();
      if (updatedAt === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
      const ready = await this.mutateState((state) => {
        const index = state.attempts.findIndex((item) => item.attemptId === attemptId);
        if (index < 0) return { state, result: undefined };
        const stored = state.attempts[index]!;
        if ((stored.phase !== "reservation_pending" && stored.phase !== "reservation_unknown" && stored.phase !== "accounting_pending") ||
            stored.reservationRetirement !== null || stored.supersededByAttemptId !== null ||
            this.hasSiblingOwner(state, stored)) {
          return { state, result: stored };
        }
        const updated = { ...stored, phase: "ready" as const, updatedAt };
        state.attempts[index] = updated;
        return { state, result: updated };
      });
      if (ready === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
      const terminalAfterUpdate = this.preparationResult(ready);
      if (terminalAfterUpdate !== undefined) return terminalAfterUpdate;
      return { status: "blocked", attemptId, reason: "budget_unknown" };
    }
    if (attempt.reservationState === "denied" || attempt.reservationState === "released") return { status: "denied", attemptId, reason: "budget_denied" };
    return this.requestReservation(attemptId);
  }

  private preparationResult(attempt: MutableAttempt): MeteringResult | undefined {
    const attemptId = attempt.attemptId;
    if (attempt.reservationHistoryUncertain || attempt.reservationConflictEvidence !== null) {
      return { status: "blocked", attemptId, reason: "budget_unknown" };
    }
    if (attempt.phase === "ready") {
      return attempt.reservationState === "reserved" && attempt.reservationReference !== null
        ? { status: "ready", attemptId, reservationReference: attempt.reservationReference }
        : { status: "blocked", attemptId, reason: "budget_unknown" };
    }
    if (attempt.phase === "denied") return { status: "denied", attemptId, reason: "budget_denied" };
    if (attempt.phase === "dispatch_intent" || attempt.phase === "dispatching" || attempt.phase === "unknown") {
      return { status: "blocked", attemptId, reason: "attempt_outcome_unknown" };
    }
    if (attempt.phase === "provider_accepted" || attempt.phase === "not_dispatched") {
      return { status: "blocked", attemptId, reason: "attempt_not_ready" };
    }
    return undefined;
  }

  private async requestReservation(attemptId: string): Promise<MeteringResult> {
    let read = await this.safeReadState();
    if (read.state === undefined) return { status: "blocked", attemptId, reason: read.reason };
    let attempt = read.state.attempts.find((item) => item.attemptId === attemptId);
    if (attempt === undefined || attempt.reservationState !== "not_requested") return { status: "blocked", attemptId, reason: "reservation_unavailable" };
    if (attempt.reservationRetirement !== null || attempt.reservationHistoryUncertain ||
        attempt.reservationConflictEvidence !== null || attempt.supersededByAttemptId !== null ||
        this.hasSiblingOwner(read.state, attempt)) {
      return { status: "blocked", attemptId, reason: "logical_operation_blocked" };
    }
    if (attempt.reservationAmount.amount === null) return { status: "blocked", attemptId, reason: "budget_unknown" };
    const boundary = await this.validateOutbound(attempt.operation, SHAPE_BUDGET, attempt.reservationCandidate, attempt.scope);
    if (boundary === undefined) return { status: "blocked", attemptId, reason: "contract_unavailable" };
    const canonical = this.toDurable(boundary.value);
    if (canonical === undefined) return { status: "blocked", attemptId, reason: "contract_unavailable" };
    const updatedAt = this.nowUtc();
    if (updatedAt === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
    const budgetEventResult = await this.mutateState((state) => {
      const index = state.attempts.findIndex((item) => item.attemptId === attemptId);
      if (index < 0) return { state, result: { claimed: false, ownerConflict: false } };
      const stored = state.attempts[index]!;
      const ownerConflict = this.hasSiblingOwner(state, stored);
      if (ownerConflict) return { state, result: { claimed: false, ownerConflict: true } };
      if (stored.reservationState !== "not_requested" || stored.reservationRetirement !== null ||
          stored.reservationHistoryUncertain || stored.reservationConflictEvidence !== null ||
          stored.supersededByAttemptId !== null) {
        return { state, result: { claimed: false, ownerConflict: false } };
      }
      const current: MutableAttempt = {
        ...stored,
        reservationEnvelope: canonical,
        reservationReceipts: boundary.receipts,
        // This durable state is the one-time external-call claim. After it is
        // written, a restart may only resolve the request through the finance
        // authority; it must never invoke authorize a second time.
        reservationState: "requesting",
        phase: "reservation_pending",
        updatedAt
      };
      state.attempts[index] = current;
      const normalized: NormalizedObservation = {
        operation: current.operation,
        sourceEventKey: null,
        logicalOperationId: current.logicalOperationId,
        billableAttemptId: current.attemptId,
        transportAttemptId: null,
        providerRequestId: null,
        occurredAt: null,
        outcome: "reservation_requested",
        completeness: "complete",
        durationMs: null,
        sourceRefs: current.sourceRefs,
        quoteAmount: current.quoteAmount,
        chargeAmount: { amount: null, basis: "unknown" },
        effect: "potentially_billable_effect"
      };
      state.outbox.push(this.newEvent(state, {
        eventType: "budget_reservation_requested",
        sourceEventKey: null,
        fingerprint: fingerprint({ attemptId, requestId: current.reservationRequestId }),
        attemptId,
        candidate: this.observationCandidate("budget_reservation_requested", normalized, updatedAt, current.reservationRequestId)
      }));
      return { state, result: { claimed: true, ownerConflict: false } };
    });
    if (!budgetEventResult.claimed) {
      return { status: "blocked", attemptId, reason: budgetEventResult.ownerConflict ? "logical_operation_blocked" : "reservation_unavailable" };
    }
    const refreshed = await this.safeReadState();
    if (refreshed.state === undefined) return { status: "blocked", attemptId, reason: refreshed.reason };
    const reservationEvent = [...refreshed.state.outbox].reverse().find((event) => event.attemptId === attemptId && event.eventType === "budget_reservation_requested");
    if (reservationEvent === undefined || !(await this.deliverEvent(reservationEvent.eventId))) {
      return { status: "blocked", attemptId, reason: "usage_sink_unavailable" };
    }
    const afterPersist = await this.safeReadState();
    if (afterPersist.state === undefined) return { status: "blocked", attemptId, reason: afterPersist.reason };
    attempt = afterPersist.state.attempts.find((item) => item.attemptId === attemptId);
    if (attempt === undefined) return { status: "blocked", attemptId, reason: "reservation_unavailable" };
    if (attempt.reservationState !== "requesting" || attempt.reservationEnvelope === null || attempt.phase !== "reservation_pending") {
      return this.reservationResult(attempt);
    }
    if (this.hasSiblingOwner(afterPersist.state, attempt)) {
      return { status: "blocked", attemptId, reason: "logical_operation_blocked" };
    }
    let raw: unknown;
    let reservationState: "unknown" | "denied" | "reserved" = "unknown";
    let reference: string | null = null;
    try {
      raw = cloneData(await this.dependencies.budgetClient.authorize({
        contractPayload: deepFreeze(this.fromDurable(attempt.reservationEnvelope)),
        trustedScope: attempt.scope,
        mode: attempt.mode
      }));
      if (isRecord(raw) && raw.authorized === false) reservationState = "denied";
      else if (isRecord(raw) && raw.authorized === true && requireToken(raw.reference)) {
        reservationState = "reserved";
        reference = raw.reference;
      }
    } catch { reservationState = "unknown"; }
    const finishedAt = this.nowUtc();
    if (finishedAt === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
    try {
      const fact: ReservationFact = reservationState === "reserved"
        ? { state: "reserved", reference: reference as string }
        : { state: reservationState, reference: null };
      const merged = await this.applyReservationFact(attemptId, attempt.reservationRequestId, fact, finishedAt, "authorization");
      if (merged === undefined) return { status: "blocked", attemptId, reason: "invalid_input" };
      if (merged.conflict) return { status: "blocked", attemptId, reason: "budget_unknown" };
      return this.reservationResult(merged.attempt);
    } catch (error) { return { status: "blocked", attemptId, reason: safeStoreError(error) }; }
  }

  private async deliverEvent(eventId: string): Promise<boolean> {
    let read = await this.safeReadState();
    if (read.state === undefined) return false;
    let event = read.state.outbox.find((item) => item.eventId === eventId);
    if (event === undefined) return false;
    if (event.deliveryState === "delivered") return true;
    if (event.canonicalEnvelope === null) {
      const candidate = this.fromDurable(event.candidate);
      const operation = isRecord(candidate) ? candidate.operation : undefined;
      if (typeof operation !== "string") return false;
      const boundary = await this.validateOutbound(operation as Operation, SHAPE_USAGE, candidate, this.dependencies.scope);
      if (boundary === undefined) {
        await this.setEventFailure(eventId, "contract_unavailable");
        return false;
      }
      const canonical = this.toDurable(boundary.value);
      if (canonical === undefined) {
        await this.setEventFailure(eventId, "contract_unavailable");
        return false;
      }
      try {
        await this.mutateState((state) => {
          const index = state.outbox.findIndex((item) => item.eventId === eventId);
          if (index < 0) return { state, result: false };
          const stored = state.outbox[index]!;
          if (stored.canonicalEnvelope !== null) return { state, result: true };
          state.outbox[index] = { ...stored, canonicalEnvelope: canonical, receipts: boundary.receipts, safeFailure: null };
          return { state, result: true };
        });
      } catch { return false; }
      read = await this.safeReadState();
      if (read.state === undefined) return false;
      event = read.state.outbox.find((item) => item.eventId === eventId);
      if (event === undefined) return false;
    }
    const attemptAt = this.nowUtc();
    if (attemptAt === undefined) return false;
    try {
      await this.mutateState((state) => {
        const index = state.outbox.findIndex((item) => item.eventId === eventId);
        if (index < 0) return { state, result: false };
        const stored = state.outbox[index]!;
        state.outbox[index] = { ...stored, deliveryAttempts: stored.deliveryAttempts + 1, safeFailure: null };
        return { state, result: true };
      });
    } catch { return false; }
    try {
      await this.dependencies.usageSink.record(deepFreeze(this.fromDurable(event.canonicalEnvelope as DurableJson)));
    } catch {
      await this.setEventFailure(eventId, "usage_sink_unavailable");
      return false;
    }
    try {
      await this.mutateState((state) => {
        const index = state.outbox.findIndex((item) => item.eventId === eventId);
        if (index < 0) return { state, result: false };
        state.outbox[index] = { ...state.outbox[index]!, deliveryState: "delivered", safeFailure: null };
        return { state, result: true };
      });
      return true;
    } catch { return false; }
  }

  private async validateOutbound(operation: Operation, shape: SharedShape, value: unknown, scope: TrustedScope): Promise<{
    readonly value: unknown;
    readonly receipts: ContractReceipt[];
  } | undefined> {
    try {
      const binding = cloneData(this.dependencies.contracts.binding(shape));
      if (!isRecord(binding) || binding.shape !== shape ||
          (binding.state !== "accepted" && binding.state !== "development_fixture") ||
          typeof binding.schemaVersion !== "string" || binding.schemaVersion.length === 0) return undefined;
      const frozenValue = deepFreeze(cloneData(value));
      const result = cloneData(await this.dependencies.contracts.validateOutbound({
        operation,
        requiredShapes: [shape],
        value: frozenValue,
        trustedScope: scope
      }));
      if (!isRecord(result) || result.ok !== true) return undefined;
      const receipts = cloneReceipts(result.receipts, shape, scope, binding.schemaVersion);
      if (receipts === undefined) return undefined;
      const cloned = cloneData(result.value);
      return { value: cloned, receipts };
    } catch { return undefined; }
  }

  private newAttemptEvent(
    state: MutableState,
    attempt: MutableAttempt,
    eventType: string,
    outcome: MeteringOutcome,
    transportAttemptId: string | null
  ): MutableOutboxEvent {
    const observedAt = this.nowUtc();
    if (observedAt === undefined) throw new Error("invalid_clock");
    const normalized: NormalizedObservation = {
      operation: attempt.operation,
      sourceEventKey: null,
      logicalOperationId: attempt.logicalOperationId,
      billableAttemptId: attempt.attemptId,
      transportAttemptId,
      providerRequestId: null,
      occurredAt: null,
      outcome,
      completeness: "complete",
      durationMs: null,
      sourceRefs: attempt.sourceRefs,
      quoteAmount: attempt.quoteAmount,
      chargeAmount: { amount: null, basis: "unknown" },
      effect: "potentially_billable_effect"
    };
    return this.newEvent(state, {
      eventType,
      sourceEventKey: null,
      fingerprint: fingerprint({ attemptId: attempt.attemptId, eventType }),
      attemptId: attempt.attemptId,
      candidate: this.observationCandidate(eventType, normalized, observedAt)
    });
  }

  private observationCandidate(
    eventType: string,
    input: NormalizedObservation,
    observedAt: string,
    reservationRequestId?: string
  ): DurableJson {
    const eventId = this.newId("event");
    const observationId = this.newId("observation");
    const candidate = {
      event_id: eventId,
      observation_id: observationId,
      event_type: eventType,
      provider_id: this.dependencies.providerId,
      trusted_scope: this.dependencies.scope,
      operation: input.operation,
      logical_operation_id: input.logicalOperationId,
      billable_attempt_id: input.billableAttemptId,
      transport_attempt_id: input.transportAttemptId,
      provider_request_id: input.providerRequestId,
      reservation_request_id: reservationRequestId ?? null,
      observed_at: observedAt,
      occurred_at: input.occurredAt,
      mode: this.dependencies.mode,
      billing_mode: this.dependencies.billingMode,
      evidence_mode: this.dependencies.evidenceMode,
      outcome: input.outcome,
      completeness: input.completeness,
      duration_ms: input.durationMs,
      source_refs: input.sourceRefs,
      quote_amount: input.quoteAmount,
      charge_amount: input.chargeAmount,
      effect: input.effect
    };
    const durable = this.toDurable(candidate);
    if (durable === undefined) throw new Error("invalid_candidate");
    return durable;
  }

  private newEvent(
    state: MutableState,
    input: {
      readonly eventType: string;
      readonly sourceEventKey: string | null;
      readonly fingerprint: string;
      readonly attemptId: string | null;
      readonly candidate: DurableJson;
    }
  ): MutableOutboxEvent {
    const candidate = input.candidate as Record<string, DurableJson>;
    const eventId = candidate.event_id;
    const observationId = candidate.observation_id;
    if (typeof eventId !== "string" || typeof observationId !== "string" ||
        state.outbox.some((event) => event.eventId === eventId || event.observationId === observationId)) {
      throw new Error("event_id_conflict");
    }
    return {
      sequence: state.nextSequence++,
      eventId,
      observationId,
      eventType: input.eventType,
      sourceEventKey: input.sourceEventKey,
      fingerprint: input.fingerprint,
      attemptId: input.attemptId,
      candidate: input.candidate,
      canonicalEnvelope: null,
      receipts: [],
      deliveryState: "pending",
      deliveryAttempts: 0,
      safeFailure: null
    };
  }

  private normalizeAttemptInput(input: BillableAttemptInput): {
    readonly providerId: string;
    readonly operation: "submit" | "cancel";
    readonly logicalOperationId: string;
    readonly clientAttemptKey: string;
    readonly sourceRefs: string[];
    readonly quoteAmount: AmountEvidence;
    readonly reservationAmount: AmountEvidence;
  } | undefined {
    let snapshot: unknown;
    try { snapshot = cloneData(input); } catch { return undefined; }
    if (!isRecord(snapshot) || !requireToken(snapshot.providerId) ||
        (snapshot.operation !== "submit" && snapshot.operation !== "cancel") ||
        !requireToken(snapshot.logicalOperationId) || !requireToken(snapshot.clientAttemptKey, 256)) return undefined;
    const refs = safeRefs(snapshot.sourceRefs);
    const quoteAmount = normalizeMoney(snapshot.quoteAmount);
    const reservationAmount = normalizeMoney(snapshot.reservationAmount);
    if (refs === undefined || quoteAmount === undefined || reservationAmount === undefined) return undefined;
    return {
      providerId: snapshot.providerId,
      operation: snapshot.operation,
      logicalOperationId: snapshot.logicalOperationId,
      clientAttemptKey: snapshot.clientAttemptKey,
      sourceRefs: refs,
      quoteAmount,
      reservationAmount
    };
  }

  private sameLogicalOperation(left: MutableAttempt, right: MutableAttempt): boolean {
    return left.providerId === right.providerId &&
      left.scope.tenantId === right.scope.tenantId &&
      left.scope.projectId === right.scope.projectId &&
      left.logicalOperationId === right.logicalOperationId;
  }

  private hasSiblingOwner(state: MutableState, attempt: MutableAttempt): boolean {
    return state.attempts.some((sibling) => sibling.attemptId !== attempt.attemptId &&
      this.sameLogicalOperation(sibling, attempt) && !this.canStartAnother(sibling));
  }

  private canStartAnother(attempt: MutableAttempt): boolean {
    return (attempt.phase === "not_dispatched" || attempt.phase === "denied") &&
      (attempt.reservationState === "denied" || attempt.reservationState === "released") &&
      attempt.reservationRetirement !== null &&
      attempt.reservationRetirement.reservationRequestId === attempt.reservationRequestId &&
      attempt.reservationRetirement.state === attempt.reservationState &&
      attempt.reservationConflictEvidence === null && !attempt.reservationHistoryUncertain;
  }

  private parseReservationResolution(value: unknown):
    | { readonly state: "reserved"; readonly reference: string }
    | { readonly state: "denied" | "released" | "unknown"; readonly reference: null }
    | undefined {
    let snapshot: unknown;
    try { snapshot = cloneData(value); } catch { return undefined; }
    if (!isRecord(snapshot) || typeof snapshot.status !== "string") return undefined;
    if (snapshot.status === "reserved" && requireToken(snapshot.reference)) return { state: "reserved", reference: snapshot.reference };
    if (snapshot.status === "denied") return { state: "denied", reference: null };
    if (snapshot.status === "released") return { state: "released", reference: null };
    if (snapshot.status === "unknown" || snapshot.status === "not_found") return { state: "unknown", reference: null };
    return undefined;
  }

  private async setEventFailure(eventId: string, failure: MutableOutboxEvent["safeFailure"]): Promise<void> {
    try {
      await this.mutateState((state) => {
        const index = state.outbox.findIndex((item) => item.eventId === eventId);
        if (index >= 0) state.outbox[index] = { ...state.outbox[index]!, safeFailure: failure };
        return { state, result: undefined };
      });
    } catch { /* original pending record remains durable */ }
  }

  private async updateAttempt(attemptId: string, update: (attempt: MutableAttempt) => MutableAttempt): Promise<MutableAttempt> {
    return this.mutateState((state) => {
      const index = state.attempts.findIndex((item) => item.attemptId === attemptId);
      if (index < 0) throw new Error("attempt_missing");
      const updated = update(state.attempts[index]!);
      state.attempts[index] = updated;
      return { state, result: updated };
    });
  }

  private async readState(): Promise<MutableState> {
    const raw = await this.store.read();
    const state = validateState(raw, this.context);
    if (state === undefined) throw new Error("corrupt_state");
    return state;
  }

  private async safeReadState(): Promise<{ readonly state: MutableState; readonly reason?: never } | { readonly state?: never; readonly reason: MeteringFailure }> {
    try { return { state: await this.readState() }; }
    catch (error) { return { reason: safeStoreError(error) }; }
  }

  private async mutateState<T>(mutate: (state: MutableState) => { readonly state: MutableState; readonly result: T }): Promise<T> {
    return this.store.update((raw) => {
      const current = validateState(raw, this.context);
      if (current === undefined) throw new Error("corrupt_state");
      const next = mutate(current);
      if (!sameStoreContext(next.state.context, this.context)) throw new Error("context_mutation");
      next.state.revision += 1;
      return { state: next.state as unknown as DurableJson, result: next.result };
    });
  }

  private toDurable(value: unknown): DurableJson | undefined {
    try { return cloneData(value) as DurableJson; } catch { return undefined; }
  }

  private fromDurable(value: DurableJson): unknown {
    return cloneData(value);
  }

  private newId(kind: "event" | "observation" | "attempt" | "transport" | "reservation"): string {
    const value = this.idFactory(kind);
    if (!requireToken(value, 128)) throw new TypeError("invalid_id");
    return value;
  }

  private nowUtc(): string | undefined {
    try { return utcFromEpoch(this.dependencies.clock.now()); } catch { return undefined; }
  }

  private checkClock(): void {
    if (this.nowUtc() === undefined) throw new TypeError("invalid_clock");
  }
}

/**
 * Builds the runtime adapter using the same durable store, sink and authority
 * dependencies as the standalone attempt workflow. The runtime supplies only
 * the already trusted tenant/project scope for each operation.
 */
export function createRuntimeMeteringResolver(
  dependencies: Omit<MeteringDependencies, "scope">
): RuntimeMeteringResolver {
  return async (scope) => {
    const context = normalizeStoreContext({
      providerId: dependencies.providerId,
      mode: dependencies.mode,
      billingMode: dependencies.billingMode,
      evidenceMode: dependencies.evidenceMode,
      scope
    });
    if (context === undefined) throw new TypeError("invalid_metering_configuration");
    const partition = fingerprint(context);
    return FulfillmentMetering.open({
      ...dependencies,
      directory: join(dependencies.directory, `scope-${partition}`),
      scope: context.scope
    });
  };
}
