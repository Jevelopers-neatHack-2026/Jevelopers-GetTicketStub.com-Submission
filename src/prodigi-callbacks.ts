import { createHash, timingSafeEqual } from "node:crypto";
import { ingestProviderCallback, SecurityBoundaryError, withServerSecret, type ServerSecretSource } from "./security.js";
import {
  ProdigiSandboxError,
  type ProdigiOrderObservation,
  type ProdigiOrderStage,
  type ProdigiSandboxErrorCode,
  type ProdigiStepState
} from "./prodigi-sandbox.js";
import type { StatusResult, TrustedScope } from "./types.js";

/**
 * Prodigi v4 callback intake and authenticated reconciliation.
 *
 * The public v4 reference (https://www.prodigi.com/print-api/docs/reference/#callbacks,
 * checked 2026-10-11) documents callbacks as CloudEvents 1.0 JSON posted to a
 * merchant-chosen `callbackUrl`. It documents no signature, HMAC, shared
 * secret, signing header, source IP list or retry policy. A callback is
 * therefore never treated as provider-authenticated here:
 *
 * 1. The containing application may embed a server-held capability token in
 *    the callback URL it registers. The token is resolved through the secret
 *    reference port at call time and compared in constant time. It only keeps
 *    anonymous senders out; it is not provider authenticity (Prodigi echoes
 *    `callbackUrl` in order objects, so anyone with order read access can see it).
 * 2. A callback that passes the token gate is an untrusted *hint*: only the
 *    event ID, order ID (`subject`), event type and time are kept. The embedded
 *    order object (`data`, which includes the recipient) is discarded unread.
 * 3. The order state changes only from an authenticated `GET /v4.0/orders/{id}`
 *    read through the sandbox adapter, applied with monotonic ordering checks
 *    so a stale or reordered read cannot regress it.
 *
 * A callback is acknowledged (2xx) only when an authenticated read that
 * started after the callback was received (our clock) has been applied, or a
 * durable job owing such a read is persisted in the store. The request does at
 * most one quick, single-flight, rate-limited read under a hard deadline;
 * anything else is recorded as a pending reconciliation in the store and run
 * outside the request with jittered backoff. Nothing is recorded for an event
 * until an authenticated read covering it has been applied.
 *
 * Callbacks are disabled by default, and only sandbox mode is accepted.
 */

export type ProdigiCallbackErrorCode =
  | "invalid_config"
  | "live_refused"
  | "callbacks_disabled"
  | "callback_forged"
  | "callback_token_unavailable"
  | "callback_invalid"
  | "callback_oversized"
  | "invalid_input"
  | "store_unavailable"
  | "deadline_exceeded";

const CALLBACK_MESSAGES: Readonly<Record<ProdigiCallbackErrorCode, string>> = {
  invalid_config: "The Prodigi callback reconciler configuration is invalid.",
  live_refused: "Live Prodigi callbacks and reconciliation are refused.",
  callbacks_disabled: "Prodigi callbacks are disabled.",
  callback_forged: "The callback did not present the expected capability token.",
  callback_token_unavailable: "The callback capability token is unavailable.",
  callback_invalid: "The callback did not pass validation.",
  callback_oversized: "The callback exceeded the configured body limit.",
  invalid_input: "The reconciliation input did not pass validation.",
  store_unavailable: "The reconciliation store is unavailable.",
  deadline_exceeded: "The callback request exceeded its processing deadline."
};

export class ProdigiCallbackError extends Error {
  readonly code: ProdigiCallbackErrorCode;
  constructor(code: ProdigiCallbackErrorCode) {
    super(CALLBACK_MESSAGES[code]);
    this.name = "ProdigiCallbackError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// CloudEvent parsing (untrusted hint only)

const EVENT_ID_PATTERN = /^evt_[A-Za-z0-9]{1,64}$/u;
const ORDER_ID_PATTERN = /^ord_[A-Za-z0-9]{1,64}$/u;
const EVENT_TYPE_PATTERN = /^com\.prodigi\.[A-Za-z0-9.]{1,96}(#[A-Za-z]{1,32})?$/u;
const STAGE_EVENT_PREFIX = "com.prodigi.order.status.stage.changed#";
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$/u;
const STAGE_BY_NAME: Readonly<Record<string, ProdigiOrderStage>> = Object.freeze({
  inprogress: "InProgress", complete: "Complete", cancelled: "Cancelled"
});

/**
 * Documented stage-change callback types. The v4 reference documents the
 * `com.prodigi.order.status.stage.changed#<Stage>` shape (its example is
 * `#InProgress`) and the order stages `InProgress`, `Complete` and `Cancelled`.
 * Only these name a stage (`claimedStage`).
 */
export const PRODIGI_CALLBACK_EVENT_TYPES: readonly string[] = Object.freeze([
  "com.prodigi.order.status.stage.changed#InProgress",
  "com.prodigi.order.status.stage.changed#Complete",
  "com.prodigi.order.status.stage.changed#Cancelled"
]);

/**
 * Prefix of every order callback type. The reference says callbacks are sent
 * "when an order's stage changes or when a shipment is made" and defines `type`
 * as `com.prodigi.` + object + path to the changed nested object + `#` + new
 * value, but gives no shipment type string. Any well-formed `com.prodigi.order.*`
 * type (stage changes and shipments) may therefore trigger one bounded read;
 * other objects are `ignored_type`.
 */
export const PRODIGI_ORDER_CALLBACK_TYPE_PREFIX = "com.prodigi.order.";

/** Whether a well-formed callback type may trigger an authenticated read. */
export function isProdigiOrderCallbackType(type: string): boolean {
  return typeof type === "string" && EVENT_TYPE_PATTERN.test(type) && type.startsWith(PRODIGI_ORDER_CALLBACK_TYPE_PREFIX) &&
    type.length > PRODIGI_ORDER_CALLBACK_TYPE_PREFIX.length && type[PRODIGI_ORDER_CALLBACK_TYPE_PREFIX.length] !== "#";
}

/**
 * Accepted CloudEvent `source` values. The reference documents the sandbox
 * source as `https://api.sandbox.prodigi.com/v4.0/Orders/` (live:
 * `https://api.prodigi.com/v4.0/Orders/`); its example uses `http://`, so both
 * schemes are accepted, case-insensitively, with an optional trailing order ID.
 * Only the sandbox host is accepted; a live-origin callback is invalid here.
 */
const SANDBOX_SOURCE_PATTERN = /^https?:\/\/api\.sandbox\.prodigi\.com\/v4\.0\/orders(\/(ord_[A-Za-z0-9]{1,64})?)?$/iu;
export const PRODIGI_SANDBOX_CALLBACK_SOURCE = "https://api.sandbox.prodigi.com/v4.0/Orders/";

/** The only fields kept from a callback. Nothing here is provider evidence. */
export interface ProdigiCallbackHint {
  readonly eventId: string;
  readonly orderId: string;
  readonly type: string;
  /** Stage named by a `stage.changed#<Stage>` type, otherwise null. Untrusted. */
  readonly claimedStage: ProdigiOrderStage | null;
  readonly eventTime: string;
}

function invalidCallback(): never {
  throw new ProdigiCallbackError("callback_invalid");
}

/**
 * Parse a Prodigi CloudEvent body into a bounded hint. `data` (the full order,
 * including the recipient) is only checked for a matching `id` and is not kept.
 */
export function parseProdigiCallbackEvent(rawBody: Uint8Array): ProdigiCallbackHint {
  if (!(rawBody instanceof Uint8Array) || rawBody.byteLength === 0) return invalidCallback();
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
  } catch {
    return invalidCallback();
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return invalidCallback();
  const event = parsed as Readonly<Record<string, unknown>>;
  const own = (key: string): unknown => (Object.prototype.hasOwnProperty.call(event, key) ? event[key] : undefined);
  if (own("specversion") !== "1.0") return invalidCallback();
  const eventId = own("id");
  const type = own("type");
  const subject = own("subject");
  const time = own("time");
  const source = own("source");
  if (typeof source !== "string" || source.length > 256 || !SANDBOX_SOURCE_PATTERN.test(source)) return invalidCallback();
  if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) return invalidCallback();
  if (typeof type !== "string" || !EVENT_TYPE_PATTERN.test(type)) return invalidCallback();
  if (typeof subject !== "string" || !ORDER_ID_PATTERN.test(subject)) return invalidCallback();
  if (typeof time !== "string" || !TIME_PATTERN.test(time) || Number.isNaN(Date.parse(time))) return invalidCallback();
  const data = own("data");
  if (data !== undefined && data !== null) {
    if (typeof data !== "object" || Array.isArray(data)) return invalidCallback();
    // The reference shows both `data.id` and `data.order.id`; whichever is present must match.
    const record = data as Record<string, unknown>;
    const dataId = Object.prototype.hasOwnProperty.call(record, "id") ? record.id : undefined;
    if (dataId !== undefined && dataId !== subject) return invalidCallback();
    const nested = Object.prototype.hasOwnProperty.call(record, "order") ? record.order : undefined;
    if (nested !== undefined && nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedId = Object.prototype.hasOwnProperty.call(nested, "id") ? (nested as Record<string, unknown>).id : undefined;
      if (nestedId !== undefined && nestedId !== subject) return invalidCallback();
    }
  }
  let claimedStage: ProdigiOrderStage | null = null;
  if (type.startsWith(STAGE_EVENT_PREFIX)) {
    const name = type.slice(STAGE_EVENT_PREFIX.length).toLowerCase();
    claimedStage = Object.prototype.hasOwnProperty.call(STAGE_BY_NAME, name) ? STAGE_BY_NAME[name] as ProdigiOrderStage : null;
    if (claimedStage === null) return invalidCallback();
  }
  return Object.freeze({ eventId, orderId: subject, type, claimedStage, eventTime: time });
}

// ---------------------------------------------------------------------------
// Ordering

const STEP_RANK: Readonly<Record<ProdigiStepState, number>> = Object.freeze({ NotStarted: 0, InProgress: 1, Error: 1, Complete: 2 });
const DETAIL_KEYS = ["downloadAssets", "printReadyAssetsPrepared", "allocateProductionLocation", "inProduction", "shipping"] as const;

function isTerminalStage(stage: ProdigiOrderStage | null): boolean {
  return stage === "Complete" || stage === "Cancelled";
}

function stageRank(stage: ProdigiOrderStage | null): number {
  if (stage === null) return 0;
  return stage === "InProgress" ? 1 : 2;
}

function timeOf(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Last authoritative state for one order. Only authenticated reads write it. */
export interface ProdigiReconciledOrderState {
  readonly orderId: string;
  /** Compare-and-set revision, starting at 0 when the order is tracked. */
  readonly revision: number;
  /** Null until the first authenticated read. */
  readonly stage: ProdigiOrderStage | null;
  readonly normalizedState: StatusResult["normalizedState"] | "pending";
  readonly details: Readonly<Record<(typeof DETAIL_KEYS)[number], ProdigiStepState>> | null;
  readonly shipmentIds: readonly string[];
  readonly lastUpdated: string | null;
  readonly observationDigest: string | null;
  readonly reconciledAt: string | null;
  /**
   * Start time, on our own clock, of the latest authenticated read whose
   * result was applied or matched the stored state. A callback received
   * strictly before this is covered. Prodigi's event `time` is never compared
   * with it. Null until such a read. Callback content never sets it.
   */
  readonly confirmedAt: string | null;
  /** Set when an authenticated read contradicted a terminal stage; the read was not applied. */
  readonly conflict: boolean;
}

export type ProdigiOrderingDecision = "apply" | "unchanged" | "stale" | "regression" | "terminal_conflict";

function observationDigest(observation: ProdigiOrderObservation): string {
  const canonical = JSON.stringify({
    stage: observation.stage,
    details: DETAIL_KEYS.map((key) => observation.details[key]),
    issues: [...observation.issueCodes].sort(),
    shipments: observation.shipments.map((s) => [s.id, s.status, s.carrier, s.hasTrackingNumber, s.dispatchDate])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * Decide whether an authenticated observation may replace the stored state.
 * Terminal disagreement is evaluated first, so `Complete` versus `Cancelled`
 * is always a conflict, never hidden as `stale` or selected by timestamp. A
 * strictly older `lastUpdated` is then stale. A terminal stage cannot move
 * back to `InProgress`. Within `InProgress`, no step and no shipment may go
 * backwards.
 */
export function decideProdigiOrdering(current: ProdigiReconciledOrderState | undefined, observation: ProdigiOrderObservation): ProdigiOrderingDecision {
  if (current === undefined || current.stage === null || current.details === null) return "apply";
  if (current.observationDigest === observationDigest(observation)) return "unchanged";
  if (isTerminalStage(current.stage) && isTerminalStage(observation.stage) && observation.stage !== current.stage) return "terminal_conflict";
  const storedTime = timeOf(current.lastUpdated);
  const incomingTime = timeOf(observation.lastUpdated);
  if (storedTime !== null && incomingTime !== null && incomingTime < storedTime) return "stale";
  if (isTerminalStage(current.stage) && !isTerminalStage(observation.stage)) return "regression";
  if (stageRank(observation.stage) < stageRank(current.stage)) return "regression";
  for (const key of DETAIL_KEYS) {
    if (STEP_RANK[observation.details[key]] < STEP_RANK[current.details[key]]) return "regression";
  }
  const incomingShipments = new Set(observation.shipments.map((s) => s.id));
  if (current.shipmentIds.some((id) => !incomingShipments.has(id))) return "regression";
  return "apply";
}

// ---------------------------------------------------------------------------
// Store port

/**
 * Durable record that a background reconciliation is owed for one order.
 * It lives in the store, not in process memory, so whichever worker runs the
 * job (or a worker after a restart) sees and clears it.
 */
export interface ProdigiPendingReconciliation {
  readonly orderId: string;
  /** Compare-and-set revision. */
  readonly revision: number;
  /**
   * Newest local receipt time (ISO, our clock) of a callback this job owes a
   * read to. Only a read that starts strictly after it covers the job.
   */
  readonly coverAfter: string;
  /** Highest stage claimed by a merged callback; the covering read must reach it. Untrusted, so it only ever causes more reads. */
  readonly requiredStage: ProdigiOrderStage | null;
  /** Receipt time of the oldest callback in this chain; the retry horizon is measured from it. */
  readonly firstReceivedAt: string;
  /**
   * Event IDs merged into this record (at most 32). When a covering read
   * clears the record they are recorded as reconciled, so their redeliveries
   * are `replayed`. Event IDs beyond the cap only cost a read on redelivery.
   */
  readonly eventIds: readonly string[];
  /** Attempt number of the currently scheduled job. */
  readonly attempt: number;
  readonly dueAt: string;
  /**
   * After this instant the record is treated as orphaned (its job was lost, for
   * example with the in-process scheduler after a restart): it no longer
   * counts toward `maxPendingJobs`, and the next callback replaces it and
   * schedules a fresh job.
   */
  readonly staleAt: string;
}

/**
 * Replay, order-state and pending-job store. This is the durable interface.
 *
 * - Replay records are keyed on scope, order ID and event ID. They are written
 *   only after an authenticated read covering the event was applied, and only
 *   for tracked orders. Each record carries `expiresAt` (the reconciler's
 *   `replayTtlMs`, default 7 days). An implementation must keep a record until
 *   it expires *or* until a fixed capacity bound evicts it oldest-first, and
 *   must not keep it after it expires. Eviction is safe: a replay record only
 *   saves work.
 * - Order state is written only through `compareAndSetOrder`, which must be
 *   atomic across workers and restarts.
 * - Pending reconciliations are written only through
 *   `compareAndSetPendingReconciliation` (`next: null` deletes), which must be
 *   atomic across workers and restarts. `countPendingReconciliations` counts
 *   one scope's records whose `staleAt` is after `now`.
 * - Nothing is written for an order that was never tracked.
 */
export interface ProdigiReconciliationStore {
  hasEvent(input: { readonly scope: TrustedScope; readonly orderId: string; readonly eventId: string }): Promise<boolean>;
  recordEvent(input: { readonly scope: TrustedScope; readonly orderId: string; readonly eventId: string; readonly expiresAt: string }): Promise<void>;
  getOrder(input: { readonly scope: TrustedScope; readonly orderId: string }): Promise<ProdigiReconciledOrderState | undefined>;
  /** Writes `next` only if the stored revision equals `expectedRevision` (null = absent). */
  compareAndSetOrder(input: {
    readonly scope: TrustedScope;
    readonly orderId: string;
    readonly expectedRevision: number | null;
    readonly next: ProdigiReconciledOrderState;
  }): Promise<boolean>;
  getPendingReconciliation(input: { readonly scope: TrustedScope; readonly orderId: string }): Promise<ProdigiPendingReconciliation | undefined>;
  /** Writes `next` (or deletes, when `next` is null) only if the stored revision equals `expectedRevision` (null = absent). */
  compareAndSetPendingReconciliation(input: {
    readonly scope: TrustedScope;
    readonly orderId: string;
    readonly expectedRevision: number | null;
    readonly next: ProdigiPendingReconciliation | null;
  }): Promise<boolean>;
  /** Records in `scope` whose `staleAt` is strictly after `now`. */
  countPendingReconciliations(input: { readonly scope: TrustedScope; readonly now: string }): Promise<number>;
}

const STORE_METHODS = [
  "hasEvent", "recordEvent", "getOrder", "compareAndSetOrder",
  "getPendingReconciliation", "compareAndSetPendingReconciliation", "countPendingReconciliations"
] as const;

function scopeKey(scope: TrustedScope, orderId: string): string {
  return JSON.stringify([scope.tenantId, scope.projectId, orderId]);
}

export interface InMemoryProdigiReconciliationStore extends ProdigiReconciliationStore {
  /** Entry counts, for tests and diagnostics. */
  stats(): { readonly orders: number; readonly replayRecords: number; readonly pendingReconciliations: number };
}

/**
 * Single-process reference store for tests and local development. It is not
 * durable and gives no cross-process atomicity. Replay records expire at their
 * `expiresAt` and are capped at `maxReplayRecords` (default 10000), evicting
 * the oldest record first. Pending records exist only for tracked orders.
 */
export function createInMemoryProdigiReconciliationStore(options: { readonly maxReplayRecords?: number; readonly clock?: { now(): number } } = {}): InMemoryProdigiReconciliationStore {
  const maxReplayRecords = boundedInt(options.maxReplayRecords, 10_000, 1, 1_000_000);
  const clock = options.clock ?? { now: () => Date.now() };
  // Insertion-ordered: the first entry is the oldest.
  const events = new Map<string, number>();
  const orders = new Map<string, ProdigiReconciledOrderState>();
  const pending = new Map<string, { readonly scope: string; readonly record: ProdigiPendingReconciliation }>();
  const sweep = (): void => {
    const now = clock.now();
    for (const [key, expiresAt] of events) {
      if (expiresAt > now) break;
      events.delete(key);
    }
  };
  return Object.freeze({
    async hasEvent(input: { scope: TrustedScope; orderId: string; eventId: string }): Promise<boolean> {
      const key = `${scopeKey(input.scope, input.orderId)}|${input.eventId}`;
      const expiresAt = events.get(key);
      if (expiresAt === undefined) return false;
      if (expiresAt <= clock.now()) {
        events.delete(key);
        return false;
      }
      return true;
    },
    async recordEvent(input: { scope: TrustedScope; orderId: string; eventId: string; expiresAt: string }): Promise<void> {
      const expiresAt = Date.parse(input.expiresAt);
      if (Number.isNaN(expiresAt)) throw new Error("invalid expiry");
      const key = `${scopeKey(input.scope, input.orderId)}|${input.eventId}`;
      events.delete(key);
      events.set(key, expiresAt);
      sweep();
      while (events.size > maxReplayRecords) {
        const oldest = events.keys().next().value as string;
        events.delete(oldest);
      }
    },
    async getOrder(input: { scope: TrustedScope; orderId: string }): Promise<ProdigiReconciledOrderState | undefined> {
      return orders.get(scopeKey(input.scope, input.orderId));
    },
    async compareAndSetOrder(input: { scope: TrustedScope; orderId: string; expectedRevision: number | null; next: ProdigiReconciledOrderState }): Promise<boolean> {
      const key = scopeKey(input.scope, input.orderId);
      const current = orders.get(key);
      if ((current?.revision ?? null) !== input.expectedRevision) return false;
      orders.set(key, Object.freeze({ ...input.next }));
      return true;
    },
    async getPendingReconciliation(input: { scope: TrustedScope; orderId: string }): Promise<ProdigiPendingReconciliation | undefined> {
      return pending.get(scopeKey(input.scope, input.orderId))?.record;
    },
    async compareAndSetPendingReconciliation(input: { scope: TrustedScope; orderId: string; expectedRevision: number | null; next: ProdigiPendingReconciliation | null }): Promise<boolean> {
      const key = scopeKey(input.scope, input.orderId);
      const current = pending.get(key);
      if ((current?.record.revision ?? null) !== input.expectedRevision) return false;
      if (input.next === null) {
        pending.delete(key);
      } else {
        if (!orders.has(key)) return false;
        pending.set(key, { scope: JSON.stringify([input.scope.tenantId, input.scope.projectId]), record: Object.freeze({ ...input.next }) });
      }
      return true;
    },
    async countPendingReconciliations(input: { scope: TrustedScope; now: string }): Promise<number> {
      const scope = JSON.stringify([input.scope.tenantId, input.scope.projectId]);
      const now = Date.parse(input.now);
      let count = 0;
      for (const entry of pending.values()) {
        if (entry.scope === scope && Date.parse(entry.record.staleAt) > now) count += 1;
      }
      return count;
    },
    stats() {
      sweep();
      return Object.freeze({ orders: orders.size, replayRecords: events.size, pendingReconciliations: pending.size });
    }
  });
}

// ---------------------------------------------------------------------------
// Read limiter and scheduler ports

/**
 * Bound on authenticated reads. `tryAcquire` returns a release function when
 * a read may start now, or null when it must be deferred. It never waits.
 * The reconciler passes its tenant ID so a shared limiter can be fair across
 * tenants.
 */
export interface ProdigiReadLimiter {
  tryAcquire(tenantKey?: string): (() => void) | null;
}

/** Bound on per-tenant buckets kept by `createProdigiReadLimiter`, least recently used evicted first. */
const MAX_TENANT_BUCKETS = 10_000;

/**
 * Token bucket plus a concurrency cap, with a per-tenant sub-budget. A read
 * needs a token from the global bucket *and* from its tenant's bucket, so one
 * tenant's burst can use at most `tenantBurst` of the global burst and
 * `tenantMaxConcurrent` of the concurrency, and other tenants keep the rest.
 * Defaults: 4 concurrent reads, a burst of 10 and 2 reads per second globally;
 * per tenant, half of each (2 concurrent, a burst of 5, 1 read per second).
 * Calls without a tenant key use only the global budget.
 */
export function createProdigiReadLimiter(options: {
  readonly maxConcurrent?: number;
  readonly burst?: number;
  readonly refillPerSecond?: number;
  readonly tenantMaxConcurrent?: number;
  readonly tenantBurst?: number;
  readonly tenantRefillPerSecond?: number;
  readonly clock?: { now(): number };
} = {}): ProdigiReadLimiter {
  const maxConcurrent = boundedInt(options.maxConcurrent, 4, 1, 64);
  const burst = boundedInt(options.burst, 10, 1, 1000);
  const refillPerSecond = boundedInt(options.refillPerSecond, 2, 1, 100);
  const tenantMaxConcurrent = boundedInt(options.tenantMaxConcurrent, Math.max(1, Math.ceil(maxConcurrent / 2)), 1, maxConcurrent);
  const tenantBurst = boundedInt(options.tenantBurst, Math.max(1, Math.floor(burst / 2)), 1, burst);
  const tenantRefillPerSecond = boundedInt(options.tenantRefillPerSecond, Math.max(1, Math.floor(refillPerSecond / 2)), 1, refillPerSecond);
  const clock = options.clock ?? { now: () => Date.now() };
  interface Bucket { tokens: number; refilledAt: number; active: number }
  const global: Bucket = { tokens: burst, refilledAt: clock.now(), active: 0 };
  const tenants = new Map<string, Bucket>();
  const refill = (bucket: Bucket, cap: number, rate: number, now: number): void => {
    if (now > bucket.refilledAt) {
      bucket.tokens = Math.min(cap, bucket.tokens + ((now - bucket.refilledAt) / 1000) * rate);
      bucket.refilledAt = now;
    }
  };
  const tenantBucket = (key: string, now: number): Bucket => {
    let bucket = tenants.get(key);
    if (bucket === undefined) {
      bucket = { tokens: tenantBurst, refilledAt: now, active: 0 };
    } else {
      tenants.delete(key);
    }
    tenants.set(key, bucket);
    while (tenants.size > MAX_TENANT_BUCKETS) {
      const [oldestKey, oldest] = tenants.entries().next().value as [string, Bucket];
      if (oldest.active > 0) break;
      tenants.delete(oldestKey);
    }
    return bucket;
  };
  return Object.freeze({
    tryAcquire(tenantKey?: string): (() => void) | null {
      const now = clock.now();
      refill(global, burst, refillPerSecond, now);
      if (global.active >= maxConcurrent || global.tokens < 1) return null;
      let tenant: Bucket | undefined;
      if (typeof tenantKey === "string" && tenantKey.length > 0) {
        tenant = tenantBucket(tenantKey, now);
        refill(tenant, tenantBurst, tenantRefillPerSecond, now);
        if (tenant.active >= tenantMaxConcurrent || tenant.tokens < 1) return null;
        tenant.tokens -= 1;
        tenant.active += 1;
      }
      global.tokens -= 1;
      global.active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        global.active -= 1;
        if (tenant !== undefined) tenant.active -= 1;
      };
    }
  });
}

/**
 * Background reconciliation job. It carries the order ID and the receipt time
 * (`coverAfter`, our clock) that the job must cover; the authoritative,
 * possibly newer requirement is the store's `ProdigiPendingReconciliation`.
 * Queues must not drop a job in favor of an older one for the same `key`;
 * the reconciler collapses duplicate jobs itself (`superseded`).
 */
export interface ProdigiReconcileJob {
  readonly key: string;
  readonly orderId: string;
  readonly attempt: number;
  readonly delayMs: number;
  readonly coverAfter: string;
  readonly requiredStage: ProdigiOrderStage | null;
}

/**
 * Runs `ProdigiCallbackReconciler.runScheduledReconciliation(job)` after
 * `job.delayMs`, outside the callback request. `durable: true` means an
 * accepted job survives a restart and runs on some worker; only then may the
 * host acknowledge a deferred callback with 202. If
 * `runScheduledReconciliation` throws (for example, the store is down), a
 * durable queue must retry the job. The default scheduler is in-process timers
 * (`durable: false`).
 */
export interface ProdigiReconciliationScheduler {
  readonly durable: boolean;
  schedule(job: ProdigiReconcileJob): Promise<void> | void;
}

// ---------------------------------------------------------------------------
// Reconciler

/** The authenticated read used for reconciliation (`ProdigiSandboxClient` satisfies it). */
export interface ProdigiOrderReader {
  getOrder(orderId: string, signal?: AbortSignal): Promise<ProdigiOrderObservation>;
}

export interface ProdigiPollPolicy {
  /** Backoff cap before the second attempt. 1..60000 ms, default 1000. */
  readonly initialDelayMs?: number;
  /** Cap for any single delay. initialDelayMs..300000 ms, default 60000. */
  readonly maxDelayMs?: number;
  /** Total read attempts per `reconcileOrder` call. 1..10, default 5. */
  readonly maxAttempts?: number;
}

/**
 * Retry budget for deferred (background) jobs. A chain is abandoned, and
 * `reconcile_abandoned` is emitted, once `maxAttempts` jobs have run or
 * `horizonMs` has passed since the chain's first callback.
 *
 * Defaults with a durable scheduler: 2 s initial, 5 min cap, 40 attempts,
 * a 1 h horizon (full jitter; the horizon binds first). With the in-process
 * scheduler: the poll policy's delays and attempts, and a 10 min horizon
 * (those deferrals were answered with 503, so Prodigi redelivers anyway).
 */
export interface ProdigiJobRetryPolicy {
  /** 1..600000 ms. */
  readonly initialDelayMs?: number;
  /** initialDelayMs..3600000 ms. */
  readonly maxDelayMs?: number;
  /** 1..1000. */
  readonly maxAttempts?: number;
  /** 1000..86400000 ms. */
  readonly horizonMs?: number;
}

export type ProdigiAbandonReason = "retries_exhausted" | "horizon_exceeded" | "read_failed" | "claim_unconfirmed" | "schedule_failed";

/**
 * Terminal outcome of a background chain that gave up without covering every
 * callback it owed a read to. The host must route it to the poller
 * (`reconcileOrder`) or an operator; it is never dropped silently.
 */
export interface ProdigiReconcileAbandonedEvent {
  readonly outcome: "reconcile_abandoned";
  readonly scope: TrustedScope;
  readonly orderId: string;
  readonly reason: ProdigiAbandonReason;
  readonly attempts: number;
  readonly coverAfter: string;
  readonly requiredStage: ProdigiOrderStage | null;
  readonly firstReceivedAt: string;
  readonly abandonedAt: string;
  readonly errorCode?: ProdigiReconcileErrorCode;
}

export interface ProdigiCallbackReconcilerOptions {
  /** Must be `"sandbox"`. `"live"` (or anything else) is refused at construction. */
  readonly mode: string;
  readonly trustedScope: TrustedScope;
  readonly reader: ProdigiOrderReader;
  readonly store: ProdigiReconciliationStore;
  /** Must be exactly `true` to accept callbacks. Polling works without it. */
  readonly callbacksEnabled?: boolean;
  /** Secret source used to resolve the callback capability token. Required when callbacks are enabled. */
  readonly secrets?: ServerSecretSource;
  /** Host-injected secret reference for the current callback URL token. There is no default binding. */
  readonly callbackTokenReference?: string;
  /** Optional previous token reference, accepted during a rotation window. */
  readonly previousCallbackTokenReference?: string;
  /** Raw body limit, 1..1048576 bytes, default 524288. */
  readonly maxBodyBytes?: number;
  readonly pollPolicy?: ProdigiPollPolicy;
  /** Retry budget for background jobs. Defaults depend on `scheduler.durable`. */
  readonly jobRetryPolicy?: ProdigiJobRetryPolicy;
  /** Hard deadline for in-request work in `handleCallback`. 50..10000 ms, default 2000. */
  readonly requestDeadlineMs?: number;
  /** Timeout for one authenticated read, independent of any request. 100..120000 ms, default 30000. */
  readonly readTimeoutMs?: number;
  /** Minimum time between reads of one order in this process; bursts inside it are coalesced into one follow-up read. 0..600000 ms, default 5000. */
  readonly minReadIntervalMs?: number;
  /** Replay record TTL. 60000..2592000000 ms (30 days), default 604800000 (7 days). */
  readonly replayTtlMs?: number;
  /** Cap on pending reconciliations per scope, counted from the store. 1..100000, default 1000. */
  readonly maxPendingJobs?: number;
  /** How long after its due time a pending record is considered orphaned. 1000..3600000 ms, default max(120000, 2 × readTimeoutMs). */
  readonly pendingJobGraceMs?: number;
  /**
   * Callbacks for an order that was never tracked get 503 so a callback racing
   * `trackOrder` is redelivered. Once the event is older than this (by its
   * `time`), the answer is `untracked_expired`/200 instead, so an order created
   * outside this application is not redelivered forever. 0 disables;
   * otherwise 60000..2592000000 ms. Default 86400000 (24 h).
   */
  readonly untrackedAckAfterMs?: number;
  /** Read bound. Defaults to `createProdigiReadLimiter()` on this reconciler's clock. Called with the tenant ID. */
  readonly readLimiter?: ProdigiReadLimiter;
  /** Background scheduler. Defaults to in-process timers (`durable: false`). */
  readonly scheduler?: ProdigiReconciliationScheduler;
  /** Receives every `reconcile_abandoned` outcome. Strongly recommended with a durable scheduler. Errors it throws are swallowed. */
  readonly onReconcileAbandoned?: (event: ProdigiReconcileAbandonedEvent) => void | Promise<void>;
  readonly clock?: { now(): number };
  /** Uniform random in [0, 1) for full jitter. Injected for tests. */
  readonly random?: () => number;
  /** Injected for tests; defaults to an abortable timer. Used only by `reconcileOrder` backoff. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export type ProdigiReconcileErrorCode = ProdigiSandboxErrorCode | "reader_error" | "read_budget_exhausted" | "store_unavailable";

export type ProdigiReconcileStatus =
  | "applied"
  | "unchanged"
  | "stale_rejected"
  | "regression_rejected"
  | "terminal_conflict"
  | "untracked_order"
  | "retries_exhausted"
  | "read_failed";

export interface ProdigiReconcileResult {
  readonly status: ProdigiReconcileStatus;
  readonly orderId: string;
  readonly attempts: number;
  /** Delays actually waited between attempts, in ms. */
  readonly delaysMs: readonly number[];
  readonly state: ProdigiReconciledOrderState | undefined;
  readonly errorCode?: ProdigiReconcileErrorCode;
}

/**
 * Callback outcomes and the HTTP status the host should answer with
 * (`recommendedHttpStatus`). A 2xx is given only when a successful
 * authenticated read that started after this callback was received has been
 * applied, or a durable job that will perform such a read is persisted.
 *
 * | outcome | meaning | status |
 * | --- | --- | --- |
 * | `reconciled` | this request's read (started after receipt) was applied | 200 |
 * | `already_reconciled` | another read that started after receipt was already applied | 200 |
 * | `replayed` | the event ID was already reconciled | 200 |
 * | `already_terminal` | the authoritative state is terminal | 200 |
 * | `ignored_type` | not a `com.prodigi.order.*` type | 200 |
 * | `untracked_expired` | never tracked, and older than `untrackedAckAfterMs` | 200 |
 * | `deferred` | a job owing a covering read is recorded in the store | 202 if the scheduler is durable, else 503 |
 * | `not_tracked` | the order is not (yet) tracked; nothing was stored | 503 |
 * | `reconcile_failed` | the read failed or no job could be recorded | 503 |
 */
export type ProdigiCallbackOutcome =
  | "reconciled"
  | "replayed"
  | "already_reconciled"
  | "already_terminal"
  | "ignored_type"
  | "untracked_expired"
  | "deferred"
  | "not_tracked"
  | "reconcile_failed";

export interface ProdigiCallbackResult {
  readonly outcome: ProdigiCallbackOutcome;
  readonly trust: "unverified";
  readonly eventId: string;
  readonly orderId: string;
  /** The callback body itself never mutates state; only `reconciliation` does. */
  readonly authoritativeMutationAllowed: false;
  /** 200, 202 or 503. Non-2xx asks Prodigi to redeliver. */
  readonly recommendedHttpStatus: 200 | 202 | 503;
  /** Present with 503. */
  readonly retryAfterSeconds?: number;
  /** Whether a background job owing a covering read is recorded for this order. */
  readonly scheduled: boolean;
  /** Which configured token matched. `previous` means a rotation is still in progress. */
  readonly tokenGeneration: "current" | "previous";
  readonly reconciliation?: ProdigiReconcileResult;
  readonly errorCode?: ProdigiReconcileErrorCode;
}

export type ProdigiScheduledRunStatus =
  | "applied"
  | "unchanged"
  | "terminal_conflict"
  | "covered"
  | "already_terminal"
  | "untracked_order"
  | "rescheduled"
  | "superseded"
  | "obsolete"
  | "reconcile_abandoned";

export interface ProdigiScheduledRunResult {
  readonly status: ProdigiScheduledRunStatus;
  readonly orderId: string;
  readonly attempt: number;
  readonly errorCode?: ProdigiReconcileErrorCode;
  /** Present with `reconcile_abandoned`. */
  readonly reason?: ProdigiAbandonReason;
}

const RETRYABLE: ReadonlySet<ProdigiReconcileErrorCode> = new Set(["rate_limited", "provider_unavailable", "timeout", "read_budget_exhausted", "store_unavailable"]);
/** Presented and stored tokens: printable ASCII, 43..512 characters (43 base64url characters carry 256 bits). */
const TOKEN_PATTERN = /^[\x21-\x7E]{1,512}$/u;
const MIN_TOKEN_LENGTH = 43;
const MAX_TOKEN_LENGTH = 512;
const DEFAULT_BODY_BYTES = 512 * 1024;
const RETRY_AFTER_SECONDS = 30;
/** Bound on per-order in-process bookkeeping (read times), oldest evicted first. */
const MAX_ORDER_ENTRIES = 10_000;
const CAS_ROUNDS = 4;
const MAX_PENDING_EVENT_IDS = 32;
// Scope identifiers intentionally exclude `_` (unlike callback event/order IDs,
// which must admit Prodigi's `evt_`/`ord_` prefixes); this matches the shared
// trusted-scope rules elsewhere in the package.
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REFERENCE_PATTERN = /^[a-z][a-z0-9._/-]{0,127}$/u;
const STAGES: ReadonlySet<string> = new Set(["InProgress", "Complete", "Cancelled"]);

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) throw new ProdigiCallbackError("invalid_config");
  return value as number;
}

function digestToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function maxStage(a: ProdigiOrderStage | null, b: ProdigiOrderStage | null): ProdigiOrderStage | null {
  if (a === null) return b;
  if (b === null) return a;
  return stageRank(b) > stageRank(a) ? b : a;
}

/** Whether the authoritative state has reached a claimed stage (a claim never lowers the bar). */
function stageMet(state: ProdigiReconciledOrderState, stage: ProdigiOrderStage | null): boolean {
  return stage === null || state.conflict || stageRank(state.stage) >= stageRank(stage);
}

const TIMED_OUT: unique symbol = Symbol("timed_out");

/** Resolve with the promise, or with TIMED_OUT after `ms` or on abort. Never rejects for the timer. */
function raceDeadline<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true || ms <= 0) {
      resolve(TIMED_OUT);
      promise.catch(() => undefined);
      return;
    }
    const finish = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = (): void => {
      finish();
      resolve(TIMED_OUT);
    };
    const timer = setTimeout(onAbort, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then((value) => { finish(); resolve(value); }, (error: unknown) => { finish(); reject(error); });
  });
}

type ReadOutcome =
  | { readonly ok: true; readonly result: ProdigiReconcileResult; readonly startedAt: number }
  | { readonly ok: false; readonly code: ProdigiReconcileErrorCode; readonly startedAt: number };

interface Flight {
  /** Our clock, ms. */
  readonly startedAt: number;
  /** In-process sequence number, comparable with a callback's receipt sequence. */
  readonly seq: number;
  readonly promise: Promise<ReadOutcome>;
}

/** What a covering read must satisfy: start strictly after `after` (our clock) and reach `stage`. */
interface Need {
  readonly after: number;
  readonly stage: ProdigiOrderStage | null;
}

interface Receipt {
  readonly at: number;
  readonly seq: number;
}

type Respond = (outcome: ProdigiCallbackOutcome, extra?: Partial<Pick<ProdigiCallbackResult, "reconciliation" | "errorCode">>, scheduled?: boolean) => ProdigiCallbackResult;

export class ProdigiCallbackReconciler {
  readonly #scope: TrustedScope;
  readonly #reader: ProdigiOrderReader;
  readonly #store: ProdigiReconciliationStore;
  readonly #callbacksEnabled: boolean;
  readonly #secrets: ServerSecretSource | undefined;
  readonly #tokenReference: string | undefined;
  readonly #previousTokenReference: string | undefined;
  readonly #maxBodyBytes: number;
  readonly #initialDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #maxAttempts: number;
  readonly #jobInitialDelayMs: number;
  readonly #jobMaxDelayMs: number;
  readonly #jobMaxAttempts: number;
  readonly #jobHorizonMs: number;
  readonly #requestDeadlineMs: number;
  readonly #readTimeoutMs: number;
  readonly #minReadIntervalMs: number;
  readonly #replayTtlMs: number;
  readonly #maxPendingJobs: number;
  readonly #pendingGraceMs: number;
  readonly #untrackedAckAfterMs: number;
  readonly #limiter: ProdigiReadLimiter;
  readonly #scheduler: ProdigiReconciliationScheduler;
  readonly #onAbandoned: ((event: ProdigiReconcileAbandonedEvent) => void | Promise<void>) | undefined;
  readonly #clock: { now(): number };
  readonly #random: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Monotonic in-process sequence for callback receipts and read starts. */
  #seq = 0;
  /** Single-flight reads, keyed by scope and order. Entries live only while a read runs. */
  readonly #flights = new Map<string, Flight>();
  /** Start time of the latest read per tracked order, bounded to MAX_ORDER_ENTRIES. */
  readonly #lastReadStart = new Map<string, number>();
  /** In-process scheduler timers only. Pending-job state lives in the store. */
  readonly #timers = new Set<ReturnType<typeof setTimeout>>();

  constructor(options: ProdigiCallbackReconcilerOptions) {
    if (options === null || typeof options !== "object") throw new ProdigiCallbackError("invalid_config");
    if (options.mode === "live") throw new ProdigiCallbackError("live_refused");
    if (options.mode !== "sandbox") throw new ProdigiCallbackError("invalid_config");
    const scope = options.trustedScope;
    if (scope === null || typeof scope !== "object" ||
        typeof scope.tenantId !== "string" || !IDENTIFIER_PATTERN.test(scope.tenantId) ||
        typeof scope.projectId !== "string" || !IDENTIFIER_PATTERN.test(scope.projectId)) {
      throw new ProdigiCallbackError("invalid_config");
    }
    if (options.reader === null || typeof options.reader !== "object" || typeof options.reader.getOrder !== "function") throw new ProdigiCallbackError("invalid_config");
    const store = options.store;
    if (store === null || typeof store !== "object" || STORE_METHODS.some((name) => typeof store[name] !== "function")) {
      throw new ProdigiCallbackError("invalid_config");
    }
    const enabled = options.callbacksEnabled === true;
    if (enabled) {
      if (options.secrets === null || typeof options.secrets !== "object" || typeof options.secrets.load !== "function") throw new ProdigiCallbackError("invalid_config");
      if (typeof options.callbackTokenReference !== "string" || !REFERENCE_PATTERN.test(options.callbackTokenReference)) throw new ProdigiCallbackError("invalid_config");
      if (options.previousCallbackTokenReference !== undefined &&
          (typeof options.previousCallbackTokenReference !== "string" || !REFERENCE_PATTERN.test(options.previousCallbackTokenReference) ||
           options.previousCallbackTokenReference === options.callbackTokenReference)) {
        throw new ProdigiCallbackError("invalid_config");
      }
    }
    if (options.readLimiter !== undefined && (options.readLimiter === null || typeof options.readLimiter.tryAcquire !== "function")) throw new ProdigiCallbackError("invalid_config");
    if (options.scheduler !== undefined && (options.scheduler === null || typeof options.scheduler.schedule !== "function" || typeof options.scheduler.durable !== "boolean")) {
      throw new ProdigiCallbackError("invalid_config");
    }
    if (options.onReconcileAbandoned !== undefined && typeof options.onReconcileAbandoned !== "function") throw new ProdigiCallbackError("invalid_config");
    const policy = options.pollPolicy ?? {};
    this.#initialDelayMs = boundedInt(policy.initialDelayMs, 1000, 1, 60_000);
    this.#maxDelayMs = boundedInt(policy.maxDelayMs, Math.max(60_000, this.#initialDelayMs), this.#initialDelayMs, 300_000);
    this.#maxAttempts = boundedInt(policy.maxAttempts, 5, 1, 10);
    const durable = options.scheduler?.durable === true;
    const jobPolicy = options.jobRetryPolicy ?? {};
    if (jobPolicy === null || typeof jobPolicy !== "object") throw new ProdigiCallbackError("invalid_config");
    this.#jobInitialDelayMs = boundedInt(jobPolicy.initialDelayMs, durable ? 2000 : this.#initialDelayMs, 1, 600_000);
    this.#jobMaxDelayMs = boundedInt(jobPolicy.maxDelayMs, Math.max(this.#jobInitialDelayMs, durable ? 300_000 : this.#maxDelayMs), this.#jobInitialDelayMs, 3_600_000);
    this.#jobMaxAttempts = boundedInt(jobPolicy.maxAttempts, durable ? 40 : this.#maxAttempts, 1, 1000);
    this.#jobHorizonMs = boundedInt(jobPolicy.horizonMs, durable ? 3_600_000 : 600_000, 1000, 86_400_000);
    this.#maxBodyBytes = boundedInt(options.maxBodyBytes, DEFAULT_BODY_BYTES, 1, 1024 * 1024);
    this.#requestDeadlineMs = boundedInt(options.requestDeadlineMs, 2000, 50, 10_000);
    this.#readTimeoutMs = boundedInt(options.readTimeoutMs, 30_000, 100, 120_000);
    this.#minReadIntervalMs = boundedInt(options.minReadIntervalMs, 5000, 0, 600_000);
    this.#replayTtlMs = boundedInt(options.replayTtlMs, 7 * 24 * 3600 * 1000, 60_000, 30 * 24 * 3600 * 1000);
    this.#maxPendingJobs = boundedInt(options.maxPendingJobs, 1000, 1, 100_000);
    this.#pendingGraceMs = boundedInt(options.pendingJobGraceMs, Math.max(120_000, 2 * this.#readTimeoutMs), 1000, 3_600_000);
    const untracked = options.untrackedAckAfterMs;
    this.#untrackedAckAfterMs = untracked === 0 ? 0 : boundedInt(untracked, 24 * 3600 * 1000, 60_000, 30 * 24 * 3600 * 1000);
    this.#scope = Object.freeze({ tenantId: scope.tenantId, projectId: scope.projectId });
    this.#reader = options.reader;
    this.#store = store;
    this.#callbacksEnabled = enabled;
    this.#secrets = enabled ? options.secrets : undefined;
    this.#tokenReference = enabled ? options.callbackTokenReference : undefined;
    this.#previousTokenReference = enabled ? options.previousCallbackTokenReference : undefined;
    this.#clock = options.clock ?? { now: () => Date.now() };
    this.#random = options.random ?? Math.random;
    this.#sleep = options.sleep ?? defaultSleep;
    this.#limiter = options.readLimiter ?? createProdigiReadLimiter({ clock: this.#clock });
    this.#scheduler = options.scheduler ?? this.#inProcessScheduler();
    this.#onAbandoned = options.onReconcileAbandoned;
  }

  get callbacksEnabled(): boolean {
    return this.#callbacksEnabled;
  }

  /** In-process bookkeeping sizes, for tests and diagnostics. All are bounded. Pending jobs are in the store. */
  diagnostics(): { readonly inFlightReads: number; readonly localTimers: number; readonly orderEntries: number } {
    return Object.freeze({ inFlightReads: this.#flights.size, localTimers: this.#timers.size, orderEntries: this.#lastReadStart.size });
  }

  /** Cancel in-process scheduled timers (the default scheduler only). */
  close(): void {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  /**
   * Poll backoff caps: the delay before attempt n+1 is drawn uniformly from
   * (0, min(max, initial * 2^(n-1))] (full jitter).
   */
  backoffSchedule(): readonly number[] {
    const delays: number[] = [];
    for (let attempt = 1; attempt < this.#maxAttempts; attempt += 1) delays.push(this.#backoffCap(attempt));
    return Object.freeze(delays);
  }

  /** The effective background-job retry budget. */
  jobRetryBudget(): { readonly initialDelayMs: number; readonly maxDelayMs: number; readonly maxAttempts: number; readonly horizonMs: number } {
    return Object.freeze({ initialDelayMs: this.#jobInitialDelayMs, maxDelayMs: this.#jobMaxDelayMs, maxAttempts: this.#jobMaxAttempts, horizonMs: this.#jobHorizonMs });
  }

  /**
   * Register an order this application created, so callbacks for it may
   * trigger reads. Call it before the order's `callbackUrl` can receive
   * callbacks (that is, before or immediately after `POST /Orders`, and before
   * enabling a dashboard-wide callback URL for existing orders).
   */
  async trackOrder(orderId: string): Promise<ProdigiReconciledOrderState> {
    if (typeof orderId !== "string" || !ORDER_ID_PATTERN.test(orderId)) throw new ProdigiCallbackError("invalid_input");
    const existing = await this.#getOrder(orderId);
    if (existing !== undefined) return existing;
    const initial: ProdigiReconciledOrderState = Object.freeze({
      orderId, revision: 0, stage: null, normalizedState: "pending", details: null, shipmentIds: Object.freeze([]),
      lastUpdated: null, observationDigest: null, reconciledAt: null, confirmedAt: null, conflict: false
    });
    if (await this.#cas(orderId, null, initial)) return initial;
    const raced = await this.#getOrder(orderId);
    if (raced === undefined) throw new ProdigiCallbackError("store_unavailable");
    return raced;
  }

  /**
   * Accept one callback request. `presentedToken` is the capability token the
   * host's HTTP handler extracted from the callback URL it registered. The body
   * is never applied; at most it triggers one quick authenticated read, under
   * a hard deadline of `requestDeadlineMs`. The host answers with
   * `recommendedHttpStatus`.
   */
  async handleCallback(input: {
    readonly presentedToken: unknown;
    readonly headers: unknown;
    readonly rawBody: Uint8Array;
    readonly signal?: AbortSignal;
  }): Promise<ProdigiCallbackResult> {
    if (!this.#callbacksEnabled) throw new ProdigiCallbackError("callbacks_disabled");
    if (input === null || typeof input !== "object") throw new ProdigiCallbackError("callback_invalid");
    // Receipt is stamped first, on our clock. Coverage is decided only against it.
    const receipt: Receipt = { at: this.#clock.now(), seq: this.#nextSeq() };
    const deadline = receipt.at + this.#requestDeadlineMs;
    const outcome = await raceDeadline(this.#handle(input, deadline, receipt), this.#requestDeadlineMs, input.signal);
    if (outcome === TIMED_OUT) throw new ProdigiCallbackError("deadline_exceeded");
    return outcome;
  }

  async #handle(input: { readonly presentedToken: unknown; readonly headers: unknown; readonly rawBody: Uint8Array; readonly signal?: AbortSignal }, deadline: number, receipt: Receipt): Promise<ProdigiCallbackResult> {
    const generation = await this.#verifyToken(input.presentedToken);
    const rawBody = input.rawBody;
    if (!(rawBody instanceof Uint8Array)) throw new ProdigiCallbackError("callback_invalid");
    if (rawBody.byteLength > this.#maxBodyBytes) throw new ProdigiCallbackError("callback_oversized");
    const hint = parseProdigiCallbackEvent(rawBody);
    const respond: Respond = (outcome, extra = {}, scheduled = false) => {
      const status: 200 | 202 | 503 = outcome === "deferred" ? (this.#scheduler.durable ? 202 : 503)
        : outcome === "not_tracked" || outcome === "reconcile_failed" ? 503 : 200;
      return Object.freeze({
        outcome,
        trust: "unverified" as const,
        eventId: hint.eventId,
        orderId: hint.orderId,
        authoritativeMutationAllowed: false as const,
        recommendedHttpStatus: status,
        ...(status === 503 ? { retryAfterSeconds: RETRY_AFTER_SECONDS } : {}),
        scheduled,
        tokenGeneration: generation,
        ...extra
      });
    };

    // 1. Only order callbacks (stage changes and shipments) may cause a read;
    //    other objects touch neither the store nor the provider.
    if (!isProdigiOrderCallbackType(hint.type)) return respond("ignored_type");

    // 2. Tracking before anything else: an unknown order stores nothing and is
    //    not consumed, so a callback racing trackOrder is redelivered.
    const current = await this.#getOrder(hint.orderId);
    if (current === undefined) {
      const age = receipt.at - Math.min(Date.parse(hint.eventTime), receipt.at);
      if (this.#untrackedAckAfterMs > 0 && age >= this.#untrackedAckAfterMs) return respond("untracked_expired");
      return respond("not_tracked");
    }

    // 3. Shared intake boundary. The replay check is read-only here; the
    //    event is recorded only after a covering read was applied.
    const store = this.#store;
    const scope = this.#scope;
    let seen = false;
    try {
      await ingestProviderCallback({
        providerId: "prodigi",
        mode: "sandbox",
        trustedScope: scope,
        headers: input.headers ?? {},
        rawBody,
        maxBodyBytes: this.#maxBodyBytes,
        // Prodigi documents no authenticity method, so there is no verifier:
        // the hint stays unverified and requires an authenticated read.
        allowUnverifiedHints: true,
        parseHint: (bytes) => {
          const parsed = parseProdigiCallbackEvent(bytes);
          if (parsed.eventId !== hint.eventId || parsed.orderId !== hint.orderId) throw new Error("mismatch");
          return { eventId: parsed.eventId, providerRequestId: parsed.orderId };
        },
        replayStore: {
          async claim() {
            seen = await store.hasEvent({ scope, orderId: hint.orderId, eventId: hint.eventId });
            return !seen;
          }
        }
      });
    } catch (error) {
      if (error instanceof SecurityBoundaryError) {
        if (error.code === "callback_oversized") throw new ProdigiCallbackError("callback_oversized");
        if (error.code === "callback_unavailable") throw new ProdigiCallbackError("store_unavailable");
        throw new ProdigiCallbackError("callback_invalid");
      }
      throw new ProdigiCallbackError("store_unavailable");
    }
    if (seen) return respond("replayed");

    // 4. Suppression only from authoritative read state on our own clock.
    if (isTerminalStage(current.stage) && !current.conflict) return respond("already_terminal");
    const need: Need = { after: receipt.at, stage: hint.claimedStage };
    if (this.#satisfied(current, need)) {
      await this.#recordEvent(hint.orderId, hint.eventId);
      return respond("already_reconciled");
    }

    // 5. At most one quick read that starts after receipt.
    const key = scopeKey(scope, hint.orderId);
    let flight = this.#flights.get(key);
    if (flight !== undefined && flight.seq < receipt.seq) {
      // The read in flight started before this callback arrived, so it cannot
      // cover it. Join the next read: one follow-up job, after the interval.
      return this.#deferResult(respond, hint, need, 1, Math.max(1, this.#intervalRemaining(key)));
    }
    if (flight === undefined) {
      const wait = this.#intervalRemaining(key);
      if (wait > 0) return this.#deferResult(respond, hint, need, 1, wait);
      flight = this.#startFlight(hint.orderId);
      if (flight === undefined) return this.#deferResult(respond, hint, need, 1, this.#jobInitialDelayMs);
    }
    const reserve = Math.min(250, Math.floor(this.#requestDeadlineMs / 4));
    const read = await raceDeadline(flight.promise, deadline - reserve - this.#clock.now());
    if (read === TIMED_OUT) {
      // The read keeps running and still applies; the job covers this callback either way.
      return this.#deferResult(respond, hint, need, 1, Math.max(this.#jobInitialDelayMs, this.#intervalRemaining(key)));
    }
    if (!read.ok) {
      const retryable = RETRYABLE.has(read.code);
      const scheduled = retryable && this.#jobMaxAttempts > 1
        ? await this.#defer(hint.orderId, need, 2, this.#intervalRemaining(key), hint.eventId)
        : false;
      return respond("reconcile_failed", { errorCode: read.code }, scheduled);
    }
    const status = read.result.status;
    if (status === "untracked_order") return respond("not_tracked");
    const state = read.result.state;
    if (status === "terminal_conflict" ||
        ((status === "applied" || status === "unchanged") && state !== undefined && stageMet(state, need.stage))) {
      await this.#recordEvent(hint.orderId, hint.eventId);
      if (state !== undefined) await this.#settleQuietly(hint.orderId, read.startedAt, state);
      return respond("reconciled", { reconciliation: read.result });
    }
    // A stale or regressed read, or one that has not yet reached the claimed
    // stage (Prodigi read lag): not covered, so read again outside the request.
    return this.#deferResult(respond, hint, need, 1, Math.max(this.#jobInitialDelayMs, this.#intervalRemaining(key)), read.result);
  }

  async #deferResult(respond: Respond, hint: ProdigiCallbackHint, need: Need, attempt: number, minDelayMs: number, reconciliation?: ProdigiReconcileResult): Promise<ProdigiCallbackResult> {
    const scheduled = await this.#defer(hint.orderId, need, attempt, minDelayMs, hint.eventId);
    const extra = reconciliation === undefined ? {} : { reconciliation };
    return scheduled ? respond("deferred", extra, true) : respond("reconcile_failed", extra, false);
  }

  /**
   * Run one background reconciliation job, outside any callback request. The
   * default scheduler calls this; a host with a durable queue calls it when a
   * job it accepted through `scheduler.schedule` is due, on any worker. The
   * pending record in the store is authoritative; it is cleared by whichever
   * worker's read covers it.
   */
  async runScheduledReconciliation(job: ProdigiReconcileJob): Promise<ProdigiScheduledRunResult> {
    if (job === null || typeof job !== "object" || typeof job.orderId !== "string" || !ORDER_ID_PATTERN.test(job.orderId) ||
        !Number.isSafeInteger(job.attempt) || job.attempt < 1 || job.attempt > 1000 ||
        typeof job.coverAfter !== "string" || Number.isNaN(Date.parse(job.coverAfter)) ||
        (job.requiredStage !== null && !STAGES.has(job.requiredStage as string))) {
      throw new ProdigiCallbackError("invalid_input");
    }
    const { orderId, attempt } = job;
    const key = scopeKey(this.#scope, orderId);
    const done = (status: ProdigiScheduledRunStatus, errorCode?: ProdigiReconcileErrorCode, reason?: ProdigiAbandonReason): ProdigiScheduledRunResult =>
      Object.freeze({ status, orderId, attempt, ...(errorCode === undefined ? {} : { errorCode }), ...(reason === undefined ? {} : { reason }) });

    const pending = await this.#getPending(orderId);
    if (pending === undefined) return done("obsolete");
    if (attempt < pending.attempt) return done("superseded");
    const need: Need = {
      after: Math.max(Date.parse(pending.coverAfter), Date.parse(job.coverAfter)),
      stage: maxStage(pending.requiredStage, job.requiredStage)
    };

    const retry = async (errorCode: ProdigiReconcileErrorCode | undefined, cause: "claim" | "other", minDelayMs = 0): Promise<ProdigiScheduledRunResult> => {
      for (let round = 0; round < CAS_ROUNDS; round += 1) {
        const m = await this.#getPending(orderId);
        if (m === undefined) return done("obsolete", errorCode);
        if (attempt < m.attempt) return done("superseded", errorCode);
        const now = this.#clock.now();
        const next = m.attempt + 1;
        if (next > this.#jobMaxAttempts) return this.#abandon(m, cause === "claim" ? "claim_unconfirmed" : "retries_exhausted", errorCode, done);
        if (now - Date.parse(m.firstReceivedAt) >= this.#jobHorizonMs) return this.#abandon(m, cause === "claim" ? "claim_unconfirmed" : "horizon_exceeded", errorCode, done);
        const delayMs = Math.max(minDelayMs, this.#jobJitter(next));
        const updated: ProdigiPendingReconciliation = Object.freeze({
          ...m, revision: m.revision + 1, attempt: next, dueAt: iso(now + delayMs), staleAt: iso(now + delayMs + this.#pendingGraceMs)
        });
        if (!(await this.#casPending(orderId, m.revision, updated))) continue;
        try {
          await this.#scheduler.schedule(this.#job(updated, delayMs));
        } catch {
          return this.#abandon(updated, "schedule_failed", errorCode, done);
        }
        return done("rescheduled", errorCode);
      }
      throw new ProdigiCallbackError("store_unavailable");
    };

    const current = await this.#getOrder(orderId);
    if (current === undefined) {
      await this.#clearPending(orderId);
      return done("untracked_order");
    }
    if (isTerminalStage(current.stage) && !current.conflict) {
      await this.#clearPending(orderId);
      return done("already_terminal");
    }
    if (this.#satisfied(current, need)) {
      const settled = await this.#settle(orderId, Date.parse(current.confirmedAt as string), current);
      return settled === "remaining" ? retry(undefined, "other", this.#intervalRemaining(key)) : done("covered");
    }
    let flight = this.#flights.get(key);
    if (flight !== undefined && flight.startedAt <= need.after) {
      return retry("read_budget_exhausted", "other", Math.max(1, this.#intervalRemaining(key)));
    }
    if (flight === undefined) {
      const wait = this.#intervalRemaining(key);
      if (wait > 0) return retry("read_budget_exhausted", "other", wait);
      flight = this.#startFlight(orderId);
      if (flight === undefined) return retry("read_budget_exhausted", "other");
    }
    const read = await flight.promise;
    if (!read.ok) {
      if (RETRYABLE.has(read.code)) return retry(read.code, "other", this.#intervalRemaining(key));
      const m = await this.#getPending(orderId);
      return m === undefined ? done("obsolete", read.code) : this.#abandon(m, "read_failed", read.code, done);
    }
    const status = read.result.status;
    if (status === "untracked_order") {
      await this.#clearPending(orderId);
      return done("untracked_order");
    }
    const state = read.result.state;
    if (status === "terminal_conflict") {
      await this.#clearPending(orderId);
      return done("terminal_conflict");
    }
    if ((status === "applied" || status === "unchanged") && state !== undefined) {
      const settled = await this.#settle(orderId, read.startedAt, state);
      if (settled !== "remaining") return done(status);
      // A newer callback arrived during the read, or the claimed stage is not
      // visible yet (read lag): read again.
      const m = await this.#getPending(orderId);
      const claimUnmet = m !== undefined && !stageMet(state, m.requiredStage);
      return retry(undefined, claimUnmet ? "claim" : "other", this.#intervalRemaining(key));
    }
    // Stale or regressed read: not covered.
    return retry(undefined, "other", this.#intervalRemaining(key));
  }

  /**
   * Authenticated polling entry point, independent of callbacks: read the
   * order (single-flight, through the read limiter) with bounded, fully
   * jittered exponential backoff on retryable failures, then apply it under
   * the ordering rules with compare-and-set. Meant for a scheduled poller and
   * for orders reported by `reconcile_abandoned`, not for a request handler.
   */
  async reconcileOrder(orderId: string, signal?: AbortSignal): Promise<ProdigiReconcileResult> {
    if (typeof orderId !== "string" || !ORDER_ID_PATTERN.test(orderId)) throw new ProdigiCallbackError("invalid_input");
    const tracked = await this.#getOrder(orderId);
    if (tracked === undefined) {
      return Object.freeze({ status: "untracked_order", orderId, attempts: 0, delaysMs: Object.freeze([]), state: undefined });
    }
    const key = scopeKey(this.#scope, orderId);
    const delays: number[] = [];
    let attempts = 0;
    let lastCode: ProdigiReconcileErrorCode | undefined;
    while (attempts < this.#maxAttempts) {
      attempts += 1;
      const flight = this.#flights.get(key) ?? this.#startFlight(orderId);
      const read: ReadOutcome = flight === undefined
        ? { ok: false, code: "read_budget_exhausted", startedAt: this.#clock.now() }
        : await flight.promise;
      if (read.ok) {
        if (read.result.state !== undefined && (read.result.status === "applied" || read.result.status === "unchanged")) {
          await this.#settleQuietly(orderId, read.startedAt, read.result.state);
        }
        return Object.freeze({ ...read.result, attempts, delaysMs: Object.freeze([...delays]) });
      }
      lastCode = read.code;
      if (!RETRYABLE.has(lastCode) || attempts >= this.#maxAttempts || signal?.aborted === true) break;
      const delay = this.#jitter(attempts);
      delays.push(delay);
      try {
        await this.#sleep(delay, signal);
      } catch {
        break;
      }
    }
    const status: ProdigiReconcileStatus = lastCode !== undefined && RETRYABLE.has(lastCode) && attempts >= this.#maxAttempts ? "retries_exhausted" : "read_failed";
    return Object.freeze({
      status, orderId, attempts, delaysMs: Object.freeze(delays), state: await this.#getOrder(orderId),
      ...(lastCode === undefined ? {} : { errorCode: lastCode })
    });
  }

  // -------------------------------------------------------------------------
  // Reads

  #nextSeq(): number {
    this.#seq += 1;
    return this.#seq;
  }

  /** Start a single-flight read if the limiter allows one now; otherwise undefined. */
  #startFlight(orderId: string): Flight | undefined {
    const key = scopeKey(this.#scope, orderId);
    const release = this.#limiter.tryAcquire(this.#scope.tenantId);
    if (typeof release !== "function") return undefined;
    const seq = this.#nextSeq();
    const startedAt = this.#clock.now();
    this.#lastReadStart.delete(key);
    this.#lastReadStart.set(key, startedAt);
    while (this.#lastReadStart.size > MAX_ORDER_ENTRIES) this.#lastReadStart.delete(this.#lastReadStart.keys().next().value as string);
    const promise = this.#read(orderId, startedAt).finally(() => {
      release();
      this.#flights.delete(key);
    });
    const flight: Flight = { startedAt, seq, promise };
    this.#flights.set(key, flight);
    return flight;
  }

  async #read(orderId: string, startedAt: number): Promise<ReadOutcome> {
    const controller = new AbortController();
    let observation: ProdigiOrderObservation;
    try {
      const result = await raceDeadline(Promise.resolve().then(() => this.#reader.getOrder(orderId, controller.signal)), this.#readTimeoutMs);
      if (result === TIMED_OUT) {
        controller.abort();
        return { ok: false, code: "timeout", startedAt };
      }
      observation = result;
    } catch (error) {
      // Unknown, non-adapter failures are programming or wiring errors: not retried.
      return { ok: false, code: error instanceof ProdigiSandboxError ? error.code : "reader_error", startedAt };
    }
    if (observation === null || typeof observation !== "object" || observation.orderId !== orderId) {
      return { ok: false, code: "invalid_response", startedAt };
    }
    try {
      return { ok: true, result: await this.#apply(orderId, observation, startedAt), startedAt };
    } catch {
      // Store blips and CAS exhaustion while applying are transient: retryable.
      return { ok: false, code: "store_unavailable", startedAt };
    }
  }

  async #apply(orderId: string, observation: ProdigiOrderObservation, startedAt: number): Promise<ProdigiReconcileResult> {
    const result = (status: ProdigiReconcileStatus, state: ProdigiReconciledOrderState | undefined): ProdigiReconcileResult =>
      Object.freeze({ status, orderId, attempts: 1, delaysMs: Object.freeze([]), state });
    const startedIso = iso(startedAt);
    const confirm = (state: ProdigiReconciledOrderState): string =>
      state.confirmedAt !== null && Date.parse(state.confirmedAt) >= startedAt ? state.confirmedAt : startedIso;
    for (let round = 0; round < CAS_ROUNDS; round += 1) {
      const current = await this.#getOrder(orderId);
      if (current === undefined) return result("untracked_order", undefined);
      const decision = decideProdigiOrdering(current, observation);
      if (decision === "stale") return result("stale_rejected", current);
      if (decision === "regression") return result("regression_rejected", current);
      let next: ProdigiReconciledOrderState;
      if (decision === "unchanged") {
        // Record that a read confirmed the state, so callbacks received before it are covered.
        if (current.confirmedAt !== null && Date.parse(current.confirmedAt) >= startedAt) return result("unchanged", current);
        next = Object.freeze({ ...current, revision: current.revision + 1, confirmedAt: startedIso });
      } else if (decision === "terminal_conflict") {
        if (current.conflict) return result("terminal_conflict", current);
        next = Object.freeze({ ...current, revision: current.revision + 1, conflict: true });
      } else {
        next = Object.freeze({
          orderId,
          revision: current.revision + 1,
          stage: observation.stage,
          normalizedState: observation.normalizedState,
          details: Object.freeze({ ...observation.details }),
          shipmentIds: Object.freeze(observation.shipments.map((s) => s.id).sort()),
          lastUpdated: observation.lastUpdated,
          observationDigest: observationDigest(observation),
          reconciledAt: iso(this.#clock.now()),
          confirmedAt: confirm(current),
          conflict: current.conflict
        });
      }
      if (await this.#cas(orderId, current.revision, next)) {
        return result(decision === "apply" ? "applied" : decision === "unchanged" ? "unchanged" : "terminal_conflict", next);
      }
    }
    throw new ProdigiCallbackError("store_unavailable");
  }

  // -------------------------------------------------------------------------
  // Coverage, coalescing and scheduling

  /** A read confirmed by the store started strictly after receipt (our clock) and reached any claimed stage. */
  #satisfied(state: ProdigiReconciledOrderState, need: Need): boolean {
    if (state.confirmedAt === null) return false;
    return Date.parse(state.confirmedAt) > need.after && stageMet(state, need.stage);
  }

  #intervalRemaining(key: string): number {
    const last = this.#lastReadStart.get(key);
    if (last === undefined) return 0;
    return Math.max(0, last + this.#minReadIntervalMs - this.#clock.now());
  }

  #backoffCap(attempt: number): number {
    return Math.min(this.#maxDelayMs, this.#initialDelayMs * 2 ** (attempt - 1));
  }

  #jitter(attempt: number): number {
    const r = this.#random();
    const unit = Number.isFinite(r) && r >= 0 && r < 1 ? r : 0.5;
    return Math.max(1, Math.ceil(this.#backoffCap(attempt) * unit));
  }

  /** Full jitter for background job `attempt` (1-based): uniform in (0, min(max, initial * 2^(attempt-1))]. */
  #jobJitter(attempt: number): number {
    const r = this.#random();
    const unit = Number.isFinite(r) && r >= 0 && r < 1 ? r : 0.5;
    const cap = Math.min(this.#jobMaxDelayMs, this.#jobInitialDelayMs * 2 ** Math.min(attempt - 1, 40));
    return Math.max(1, Math.ceil(cap * unit));
  }

  #job(record: ProdigiPendingReconciliation, delayMs: number): ProdigiReconcileJob {
    return Object.freeze({
      key: scopeKey(this.#scope, record.orderId),
      orderId: record.orderId,
      attempt: record.attempt,
      delayMs,
      coverAfter: record.coverAfter,
      requiredStage: record.requiredStage
    });
  }

  /**
   * Record in the store that a covering read is owed. If a live pending record
   * exists, merge this callback's requirement into it (its job will see it, so
   * acknowledging is safe). Otherwise create one, subject to `maxPendingJobs`
   * counted from the store, and schedule its job. Returns whether a job owns
   * the requirement.
   */
  async #defer(orderId: string, need: Need, attempt: number, minDelayMs: number, eventId: string | null): Promise<boolean> {
    const withEvent = (ids: readonly string[]): readonly string[] =>
      eventId === null || ids.includes(eventId) || ids.length >= MAX_PENDING_EVENT_IDS ? ids : Object.freeze([...ids, eventId]);
    for (let round = 0; round < CAS_ROUNDS; round += 1) {
      const now = this.#clock.now();
      const existing = await this.#getPending(orderId);
      if (existing !== undefined && Date.parse(existing.staleAt) > now) {
        const after = Math.max(Date.parse(existing.coverAfter), need.after);
        const stage = maxStage(existing.requiredStage, need.stage);
        const eventIds = withEvent(existing.eventIds ?? []);
        if (after === Date.parse(existing.coverAfter) && stage === existing.requiredStage && eventIds === existing.eventIds) return true;
        const merged: ProdigiPendingReconciliation = Object.freeze({ ...existing, revision: existing.revision + 1, coverAfter: iso(after), requiredStage: stage, eventIds });
        if (await this.#casPending(orderId, existing.revision, merged)) return true;
        continue;
      }
      if (await this.#countPending(now) >= this.#maxPendingJobs) return false;
      const delayMs = Math.max(minDelayMs, this.#jobJitter(attempt));
      // An orphaned record's requirement is carried into the fresh chain.
      const after = existing === undefined ? need.after : Math.max(Date.parse(existing.coverAfter), need.after);
      const fresh: ProdigiPendingReconciliation = Object.freeze({
        orderId,
        revision: existing === undefined ? 0 : existing.revision + 1,
        coverAfter: iso(after),
        requiredStage: existing === undefined ? need.stage : maxStage(existing.requiredStage, need.stage),
        firstReceivedAt: iso(need.after),
        eventIds: withEvent(existing === undefined ? [] : (existing.eventIds ?? [])),
        attempt,
        dueAt: iso(now + delayMs),
        staleAt: iso(now + delayMs + this.#pendingGraceMs)
      });
      if (!(await this.#casPending(orderId, existing?.revision ?? null, fresh))) continue;
      try {
        await this.#scheduler.schedule(this.#job(fresh, delayMs));
        return true;
      } catch {
        try {
          await this.#casPending(orderId, fresh.revision, null);
        } catch {
          // Left to expire at staleAt.
        }
        return false;
      }
    }
    return false;
  }

  /**
   * After a successful read that started at `readStartedAt`, clear the pending
   * record if that read covers it: it started strictly after the record's
   * newest receipt and reached its claimed stage (a terminal state always
   * covers). Atomic, so a callback merged during the read keeps the record.
   */
  async #settle(orderId: string, readStartedAt: number, state: ProdigiReconciledOrderState): Promise<"none" | "cleared" | "remaining"> {
    for (let round = 0; round < CAS_ROUNDS; round += 1) {
      const m = await this.#getPending(orderId);
      if (m === undefined) return "none";
      const terminal = isTerminalStage(state.stage) || state.conflict;
      if (!terminal && !(Date.parse(m.coverAfter) < readStartedAt && stageMet(state, m.requiredStage))) return "remaining";
      if (await this.#casPending(orderId, m.revision, null)) {
        for (const eventId of m.eventIds ?? []) await this.#recordEvent(orderId, eventId);
        return "cleared";
      }
    }
    return "remaining";
  }

  async #settleQuietly(orderId: string, readStartedAt: number, state: ProdigiReconciledOrderState): Promise<void> {
    try {
      await this.#settle(orderId, readStartedAt, state);
    } catch {
      // Best effort: the pending job still runs and finds the order covered.
    }
  }

  async #clearPending(orderId: string): Promise<void> {
    for (let round = 0; round < CAS_ROUNDS; round += 1) {
      const m = await this.#getPending(orderId);
      if (m === undefined || await this.#casPending(orderId, m.revision, null)) return;
    }
  }

  async #abandon(
    record: ProdigiPendingReconciliation,
    reason: ProdigiAbandonReason,
    errorCode: ProdigiReconcileErrorCode | undefined,
    done: (status: ProdigiScheduledRunStatus, errorCode?: ProdigiReconcileErrorCode, reason?: ProdigiAbandonReason) => ProdigiScheduledRunResult
  ): Promise<ProdigiScheduledRunResult> {
    // Delete with the latest revision, so a requirement merged meanwhile is
    // part of the reported event rather than silently dropped.
    let latest: ProdigiPendingReconciliation = record;
    for (let round = 0; round < CAS_ROUNDS; round += 1) {
      const m = await this.#getPending(record.orderId);
      if (m === undefined) break;
      latest = m;
      if (await this.#casPending(record.orderId, m.revision, null)) break;
    }
    const event: ProdigiReconcileAbandonedEvent = Object.freeze({
      outcome: "reconcile_abandoned" as const,
      scope: this.#scope,
      orderId: latest.orderId,
      reason,
      attempts: latest.attempt,
      coverAfter: latest.coverAfter,
      requiredStage: latest.requiredStage,
      firstReceivedAt: latest.firstReceivedAt,
      abandonedAt: iso(this.#clock.now()),
      ...(errorCode === undefined ? {} : { errorCode })
    });
    if (this.#onAbandoned !== undefined) {
      try {
        await this.#onAbandoned(event);
      } catch {
        // The run result still reports reconcile_abandoned to the job runner.
      }
    }
    return done("reconcile_abandoned", errorCode, reason);
  }

  #inProcessScheduler(): ProdigiReconciliationScheduler {
    return Object.freeze({
      durable: false,
      schedule: (job: ProdigiReconcileJob): void => {
        const timer = setTimeout(() => {
          this.#timers.delete(timer);
          this.runScheduledReconciliation(job).catch(() => undefined);
        }, job.delayMs);
        timer.unref?.();
        this.#timers.add(timer);
      }
    });
  }

  async #recordEvent(orderId: string, eventId: string): Promise<void> {
    try {
      await this.#store.recordEvent({ scope: this.#scope, orderId, eventId, expiresAt: iso(this.#clock.now() + this.#replayTtlMs) });
    } catch {
      // The state is already applied, so a missing replay record only costs a
      // read on redelivery.
    }
  }

  // -------------------------------------------------------------------------
  // Token and store helpers

  async #verifyToken(presented: unknown): Promise<"current" | "previous"> {
    if (typeof presented !== "string" || !TOKEN_PATTERN.test(presented)) throw new ProdigiCallbackError("callback_forged");
    // The current token must resolve and be well formed, or the gate fails closed.
    const current = await this.#matchToken(this.#tokenReference as string, presented);
    if (current === "unavailable") throw new ProdigiCallbackError("callback_token_unavailable");
    // A previous token is optional during rotation; if it is unavailable it simply never matches.
    const previous = this.#previousTokenReference === undefined ? "nomatch" : await this.#matchToken(this.#previousTokenReference, presented);
    if (current === "match") return "current";
    if (previous === "match") return "previous";
    throw new ProdigiCallbackError("callback_forged");
  }

  async #matchToken(reference: string, presented: string): Promise<"match" | "nomatch" | "unavailable"> {
    try {
      const matched = await withServerSecret<boolean>({
        providerId: "prodigi",
        secretReference: reference,
        mode: "sandbox",
        source: this.#secrets as ServerSecretSource,
        use: async ({ secret }) => {
          if (secret.length < MIN_TOKEN_LENGTH || secret.length > MAX_TOKEN_LENGTH || !TOKEN_PATTERN.test(secret)) throw new Error("unusable");
          return timingSafeEqual(digestToken(presented), digestToken(secret));
        }
      });
      return matched ? "match" : "nomatch";
    } catch {
      return "unavailable";
    }
  }

  async #getOrder(orderId: string): Promise<ProdigiReconciledOrderState | undefined> {
    try {
      return await this.#store.getOrder({ scope: this.#scope, orderId });
    } catch {
      throw new ProdigiCallbackError("store_unavailable");
    }
  }

  async #cas(orderId: string, expectedRevision: number | null, next: ProdigiReconciledOrderState): Promise<boolean> {
    let written: unknown;
    try {
      written = await this.#store.compareAndSetOrder({ scope: this.#scope, orderId, expectedRevision, next });
    } catch {
      throw new ProdigiCallbackError("store_unavailable");
    }
    if (typeof written !== "boolean") throw new ProdigiCallbackError("store_unavailable");
    return written;
  }

  async #getPending(orderId: string): Promise<ProdigiPendingReconciliation | undefined> {
    try {
      return await this.#store.getPendingReconciliation({ scope: this.#scope, orderId });
    } catch {
      throw new ProdigiCallbackError("store_unavailable");
    }
  }

  async #casPending(orderId: string, expectedRevision: number | null, next: ProdigiPendingReconciliation | null): Promise<boolean> {
    let written: unknown;
    try {
      written = await this.#store.compareAndSetPendingReconciliation({ scope: this.#scope, orderId, expectedRevision, next });
    } catch {
      throw new ProdigiCallbackError("store_unavailable");
    }
    if (typeof written !== "boolean") throw new ProdigiCallbackError("store_unavailable");
    return written;
  }

  async #countPending(now: number): Promise<number> {
    let count: unknown;
    try {
      count = await this.#store.countPendingReconciliations({ scope: this.#scope, now: iso(now) });
    } catch {
      throw new ProdigiCallbackError("store_unavailable");
    }
    if (!Number.isSafeInteger(count) || (count as number) < 0) throw new ProdigiCallbackError("store_unavailable");
    return count as number;
  }
}
