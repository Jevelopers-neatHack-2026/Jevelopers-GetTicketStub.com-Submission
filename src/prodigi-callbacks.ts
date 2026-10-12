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
 * The callback request does at most one quick, single-flight, rate-limited
 * read under a hard deadline. Anything else is scheduled outside the request
 * with jittered backoff. Nothing is recorded for an event until an
 * authenticated read covering it has been applied.
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
 * Callback types that may trigger an authenticated read. The v4 reference
 * documents the `com.prodigi.order.status.stage.changed#<Stage>` shape (its
 * example is `#InProgress`) and the order stages `InProgress`, `Complete` and
 * `Cancelled`. It names no shipment event type string, so none is allowed
 * until one is confirmed against a sandbox recording. Any other `com.prodigi.*`
 * type is acknowledged as `ignored_type` without a store access or read.
 */
export const PRODIGI_CALLBACK_EVENT_TYPES: readonly string[] = Object.freeze([
  "com.prodigi.order.status.stage.changed#InProgress",
  "com.prodigi.order.status.stage.changed#Complete",
  "com.prodigi.order.status.stage.changed#Cancelled"
]);
const ALLOWED_EVENT_TYPES: ReadonlySet<string> = new Set(PRODIGI_CALLBACK_EVENT_TYPES);

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
  if (typeof eventId !== "string" || !EVENT_ID_PATTERN.test(eventId)) return invalidCallback();
  if (typeof type !== "string" || !EVENT_TYPE_PATTERN.test(type)) return invalidCallback();
  if (typeof subject !== "string" || !ORDER_ID_PATTERN.test(subject)) return invalidCallback();
  if (typeof time !== "string" || !TIME_PATTERN.test(time) || Number.isNaN(Date.parse(time))) return invalidCallback();
  const data = own("data");
  if (data !== undefined && data !== null) {
    if (typeof data !== "object" || Array.isArray(data)) return invalidCallback();
    const dataId = Object.prototype.hasOwnProperty.call(data, "id") ? (data as Record<string, unknown>).id : undefined;
    if (dataId !== undefined && dataId !== subject) return invalidCallback();
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
   * Local start time of the latest authenticated read whose result was applied
   * or matched the stored state. A callback whose event time is at least the
   * coverage skew before this is already reflected, so it triggers no read.
   * Null until such a read. Callback content never sets it.
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
 * Replay and order-state store.
 *
 * - Replay records are keyed on scope, order ID and event ID. They are written
 *   only after an authenticated read covering the event was applied, and only
 *   for tracked orders. Each record carries `expiresAt` (the reconciler's
 *   `replayTtlMs`, default 7 days). An implementation must keep a record until
 *   it expires *or* until a fixed capacity bound evicts it oldest-first, and
 *   must not keep it after it expires. Eviction is safe: a replay record only
 *   saves work, and an evicted event is still covered by `confirmedAt`.
 * - Order state is written only through `compareAndSetOrder`, which must be
 *   atomic across workers and restarts.
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
}

function scopeKey(scope: TrustedScope, orderId: string): string {
  return JSON.stringify([scope.tenantId, scope.projectId, orderId]);
}

export interface InMemoryProdigiReconciliationStore extends ProdigiReconciliationStore {
  /** Entry counts, for tests and diagnostics. */
  stats(): { readonly orders: number; readonly replayRecords: number };
}

/**
 * Single-process reference store for tests and local development. It is not
 * durable and gives no cross-process atomicity. Replay records expire at their
 * `expiresAt` and are capped at `maxReplayRecords` (default 10000), evicting
 * the oldest record first.
 */
export function createInMemoryProdigiReconciliationStore(options: { readonly maxReplayRecords?: number; readonly clock?: { now(): number } } = {}): InMemoryProdigiReconciliationStore {
  const maxReplayRecords = boundedInt(options.maxReplayRecords, 10_000, 1, 1_000_000);
  const clock = options.clock ?? { now: () => Date.now() };
  // Insertion-ordered: the first entry is the oldest.
  const events = new Map<string, number>();
  const orders = new Map<string, ProdigiReconciledOrderState>();
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
    stats() {
      sweep();
      return Object.freeze({ orders: orders.size, replayRecords: events.size });
    }
  });
}

// ---------------------------------------------------------------------------
// Read limiter and scheduler ports

/**
 * Global bound on authenticated reads. `tryAcquire` returns a release function
 * when a read may start now, or null when it must be deferred. It never waits.
 */
export interface ProdigiReadLimiter {
  tryAcquire(): (() => void) | null;
}

/**
 * Token bucket plus a concurrency cap. Defaults: 4 concurrent reads, a burst
 * of 10 and 2 reads per second sustained.
 */
export function createProdigiReadLimiter(options: {
  readonly maxConcurrent?: number;
  readonly burst?: number;
  readonly refillPerSecond?: number;
  readonly clock?: { now(): number };
} = {}): ProdigiReadLimiter {
  const maxConcurrent = boundedInt(options.maxConcurrent, 4, 1, 64);
  const burst = boundedInt(options.burst, 10, 1, 1000);
  const refillPerSecond = boundedInt(options.refillPerSecond, 2, 1, 100);
  const clock = options.clock ?? { now: () => Date.now() };
  let tokens = burst;
  let refilledAt = clock.now();
  let active = 0;
  return Object.freeze({
    tryAcquire(): (() => void) | null {
      const now = clock.now();
      if (now > refilledAt) {
        tokens = Math.min(burst, tokens + ((now - refilledAt) / 1000) * refillPerSecond);
        refilledAt = now;
      }
      if (active >= maxConcurrent || tokens < 1) return null;
      tokens -= 1;
      active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        active -= 1;
      };
    }
  });
}

/**
 * Background reconciliation job. `key` identifies the order across workers so a
 * durable queue can coalesce jobs for the same order. `eventTime` is the
 * newest callback time the job must cover, or null for an unconditional read.
 */
export interface ProdigiReconcileJob {
  readonly key: string;
  readonly orderId: string;
  readonly attempt: number;
  readonly delayMs: number;
  readonly eventTime: string | null;
}

/**
 * Runs `ProdigiCallbackReconciler.runScheduledReconciliation(job)` after
 * `job.delayMs`, outside the callback request. `durable: true` means an
 * accepted job survives a restart; only then may the host acknowledge a
 * deferred callback with 202. The default scheduler is in-process timers
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
  /** Total read attempts per poll or per scheduled chain. 1..10, default 5. */
  readonly maxAttempts?: number;
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
  /** Hard deadline for in-request work in `handleCallback`. 50..10000 ms, default 2000. */
  readonly requestDeadlineMs?: number;
  /** Timeout for one authenticated read, independent of any request. 100..120000 ms, default 30000. */
  readonly readTimeoutMs?: number;
  /** Minimum time between callback-triggered reads of one order. 0..600000 ms, default 5000. */
  readonly minReadIntervalMs?: number;
  /** Clock-skew margin for event coverage (`confirmedAt >= time + skew`). 0..300000 ms, default 2000. */
  readonly coverageSkewMs?: number;
  /** Replay record TTL. 60000..2592000000 ms (30 days), default 604800000 (7 days). */
  readonly replayTtlMs?: number;
  /** Cap on scheduled jobs pending in this process. 1..100000, default 1000. */
  readonly maxPendingJobs?: number;
  /** Global read bound. Defaults to `createProdigiReadLimiter()` on this reconciler's clock. */
  readonly readLimiter?: ProdigiReadLimiter;
  /** Background scheduler. Defaults to in-process timers (`durable: false`). */
  readonly scheduler?: ProdigiReconciliationScheduler;
  readonly clock?: { now(): number };
  /** Uniform random in [0, 1) for full jitter. Injected for tests. */
  readonly random?: () => number;
  /** Injected for tests; defaults to an abortable timer. Used only by `reconcileOrder` backoff. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export type ProdigiReconcileErrorCode = ProdigiSandboxErrorCode | "reader_error" | "read_budget_exhausted";

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
 * (`recommendedHttpStatus`):
 *
 * | outcome | meaning | status |
 * | --- | --- | --- |
 * | `reconciled` | an authenticated read covering the event was applied | 200 |
 * | `replayed` | the event ID was already reconciled | 200 |
 * | `already_reconciled` | a read confirmed after the event time already covers it | 200 |
 * | `already_terminal` | the authoritative state is terminal | 200 |
 * | `ignored_type` | not a documented, allowlisted type | 200 |
 * | `deferred` | a read is scheduled outside the request | 202 if the scheduler is durable, else 503 |
 * | `not_tracked` | the order is not (yet) tracked; nothing was stored | 503 |
 * | `reconcile_failed` | the read failed or could not be scheduled | 503 |
 */
export type ProdigiCallbackOutcome =
  | "reconciled"
  | "replayed"
  | "already_reconciled"
  | "already_terminal"
  | "ignored_type"
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
  /** Whether a background reconciliation job is pending for this order. */
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
  | "retries_exhausted"
  | "read_failed";

export interface ProdigiScheduledRunResult {
  readonly status: ProdigiScheduledRunStatus;
  readonly orderId: string;
  readonly attempt: number;
  readonly errorCode?: ProdigiReconcileErrorCode;
}

const RETRYABLE: ReadonlySet<ProdigiReconcileErrorCode> = new Set(["rate_limited", "provider_unavailable", "timeout", "read_budget_exhausted"]);
/** Presented and stored tokens: printable ASCII, 43..512 characters (43 base64url characters carry 256 bits). */
const TOKEN_PATTERN = /^[\x21-\x7E]{1,512}$/u;
const MIN_TOKEN_LENGTH = 43;
const MAX_TOKEN_LENGTH = 512;
const DEFAULT_BODY_BYTES = 512 * 1024;
const RETRY_AFTER_SECONDS = 30;
/** Bound on per-order in-process bookkeeping (read times), oldest evicted first. */
const MAX_ORDER_ENTRIES = 10_000;
// Scope identifiers intentionally exclude `_` (unlike callback event/order IDs,
// which must admit Prodigi's `evt_`/`ord_` prefixes); this matches the shared
// trusted-scope rules elsewhere in the package.
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REFERENCE_PATTERN = /^[a-z][a-z0-9._/-]{0,127}$/u;

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
  readonly startedAt: number;
  readonly promise: Promise<ReadOutcome>;
}

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
  readonly #requestDeadlineMs: number;
  readonly #readTimeoutMs: number;
  readonly #minReadIntervalMs: number;
  readonly #coverageSkewMs: number;
  readonly #replayTtlMs: number;
  readonly #maxPendingJobs: number;
  readonly #limiter: ProdigiReadLimiter;
  readonly #scheduler: ProdigiReconciliationScheduler;
  readonly #clock: { now(): number };
  readonly #random: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Single-flight reads, keyed by scope and order. Entries live only while a read runs. */
  readonly #flights = new Map<string, Flight>();
  /** Start time of the latest read per tracked order, bounded to MAX_ORDER_ENTRIES. */
  readonly #lastReadStart = new Map<string, number>();
  /** Jobs pending in this process, keyed by scope and order, with the newest event time to cover. */
  readonly #pending = new Map<string, number | null>();
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
    if (store === null || typeof store !== "object" || typeof store.hasEvent !== "function" || typeof store.recordEvent !== "function" ||
        typeof store.getOrder !== "function" || typeof store.compareAndSetOrder !== "function") {
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
    const policy = options.pollPolicy ?? {};
    this.#initialDelayMs = boundedInt(policy.initialDelayMs, 1000, 1, 60_000);
    this.#maxDelayMs = boundedInt(policy.maxDelayMs, Math.max(60_000, this.#initialDelayMs), this.#initialDelayMs, 300_000);
    this.#maxAttempts = boundedInt(policy.maxAttempts, 5, 1, 10);
    this.#maxBodyBytes = boundedInt(options.maxBodyBytes, DEFAULT_BODY_BYTES, 1, 1024 * 1024);
    this.#requestDeadlineMs = boundedInt(options.requestDeadlineMs, 2000, 50, 10_000);
    this.#readTimeoutMs = boundedInt(options.readTimeoutMs, 30_000, 100, 120_000);
    this.#minReadIntervalMs = boundedInt(options.minReadIntervalMs, 5000, 0, 600_000);
    this.#coverageSkewMs = boundedInt(options.coverageSkewMs, 2000, 0, 300_000);
    this.#replayTtlMs = boundedInt(options.replayTtlMs, 7 * 24 * 3600 * 1000, 60_000, 30 * 24 * 3600 * 1000);
    this.#maxPendingJobs = boundedInt(options.maxPendingJobs, 1000, 1, 100_000);
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
  }

  get callbacksEnabled(): boolean {
    return this.#callbacksEnabled;
  }

  /** In-process bookkeeping sizes, for tests and diagnostics. All are bounded. */
  diagnostics(): { readonly inFlightReads: number; readonly pendingJobs: number; readonly orderEntries: number } {
    return Object.freeze({ inFlightReads: this.#flights.size, pendingJobs: this.#pending.size, orderEntries: this.#lastReadStart.size });
  }

  /** Cancel in-process scheduled timers (the default scheduler only). */
  close(): void {
    for (const timer of this.#timers) clearTimeout(timer);
    this.#timers.clear();
  }

  /**
   * Backoff caps: the delay before attempt n+1 is drawn uniformly from
   * (0, min(max, initial * 2^(n-1))] (full jitter).
   */
  backoffSchedule(): readonly number[] {
    const delays: number[] = [];
    for (let attempt = 1; attempt < this.#maxAttempts; attempt += 1) delays.push(this.#backoffCap(attempt));
    return Object.freeze(delays);
  }

  /** Register an order this application created, so callbacks for it may trigger reads. */
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
    const deadline = this.#clock.now() + this.#requestDeadlineMs;
    const outcome = await raceDeadline(this.#handle(input, deadline), this.#requestDeadlineMs, input.signal);
    if (outcome === TIMED_OUT) throw new ProdigiCallbackError("deadline_exceeded");
    return outcome;
  }

  async #handle(input: { readonly presentedToken: unknown; readonly headers: unknown; readonly rawBody: Uint8Array; readonly signal?: AbortSignal }, deadline: number): Promise<ProdigiCallbackResult> {
    const generation = await this.#verifyToken(input.presentedToken);
    const rawBody = input.rawBody;
    if (!(rawBody instanceof Uint8Array)) throw new ProdigiCallbackError("callback_invalid");
    if (rawBody.byteLength > this.#maxBodyBytes) throw new ProdigiCallbackError("callback_oversized");
    const hint = parseProdigiCallbackEvent(rawBody);
    const respond = (outcome: ProdigiCallbackOutcome, extra: Partial<Pick<ProdigiCallbackResult, "reconciliation" | "errorCode">> = {}, scheduled = false): ProdigiCallbackResult => {
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

    // 1. Allowlist: undocumented types touch neither the store nor the provider.
    if (!ALLOWED_EVENT_TYPES.has(hint.type)) return respond("ignored_type");

    // 2. Tracking before anything else: an unknown order stores nothing and is
    //    not consumed, so a callback racing trackOrder is redelivered.
    const current = await this.#getOrder(hint.orderId);
    if (current === undefined) return respond("not_tracked");

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

    // 4. Suppression only from authoritative read state, never from the claim.
    const eventTimeMs = this.#effectiveEventTime(hint.eventTime);
    if (isTerminalStage(current.stage) && !current.conflict) return respond("already_terminal");
    if (this.#covers(current, eventTimeMs)) return respond("already_reconciled");

    // 5. At most one quick read, shared with any read already in flight.
    const key = scopeKey(scope, hint.orderId);
    let flight = this.#flights.get(key);
    if (flight === undefined) {
      const wait = this.#intervalRemaining(key);
      if (wait > 0) {
        // A read happened moments ago; it may already cover this event.
        const fresh = await this.#getOrder(hint.orderId);
        if (fresh !== undefined && this.#covers(fresh, eventTimeMs)) return respond("already_reconciled");
        return this.#deferResult(respond, hint.orderId, 1, eventTimeMs, wait);
      }
      flight = this.#startFlight(hint.orderId);
      if (flight === undefined) return this.#deferResult(respond, hint.orderId, 1, eventTimeMs, this.#initialDelayMs);
    }
    const reserve = Math.min(250, Math.floor(this.#requestDeadlineMs / 4));
    const read = await raceDeadline(flight.promise, deadline - reserve - this.#clock.now());
    if (read === TIMED_OUT) {
      // The read keeps running and will still apply; a job covers its failure.
      return this.#deferResult(respond, hint.orderId, 1, eventTimeMs, this.#initialDelayMs);
    }
    if (!read.ok) {
      const retryable = RETRYABLE.has(read.code);
      const scheduled = retryable && this.#maxAttempts > 1 ? await this.#schedule(hint.orderId, 2, eventTimeMs, 0) : false;
      return respond("reconcile_failed", { errorCode: read.code }, scheduled);
    }
    const status = read.result.status;
    if (status === "terminal_conflict" ||
        ((status === "applied" || status === "unchanged") && read.result.state !== undefined && this.#covers(read.result.state, eventTimeMs))) {
      await this.#recordEvent(hint.orderId, hint.eventId);
      return respond("reconciled", { reconciliation: read.result });
    }
    if (status === "untracked_order") return respond("not_tracked");
    // A stale or regressed read, or a shared read that started before the event:
    // not covered, so read again outside the request.
    return this.#deferResult(respond, hint.orderId, 1, eventTimeMs, this.#initialDelayMs, read.result);
  }

  async #deferResult(
    respond: (outcome: ProdigiCallbackOutcome, extra?: Partial<Pick<ProdigiCallbackResult, "reconciliation" | "errorCode">>, scheduled?: boolean) => ProdigiCallbackResult,
    orderId: string,
    attempt: number,
    eventTimeMs: number,
    minDelayMs: number,
    reconciliation?: ProdigiReconcileResult
  ): Promise<ProdigiCallbackResult> {
    const scheduled = await this.#schedule(orderId, attempt, eventTimeMs, minDelayMs);
    const extra = reconciliation === undefined ? {} : { reconciliation };
    return scheduled ? respond("deferred", extra, true) : respond("reconcile_failed", extra, false);
  }

  /**
   * Run one background reconciliation job, outside any callback request. The
   * default scheduler calls this; a host with a durable queue calls it when a
   * job it accepted through `scheduler.schedule` is due.
   */
  async runScheduledReconciliation(job: ProdigiReconcileJob): Promise<ProdigiScheduledRunResult> {
    if (job === null || typeof job !== "object" || typeof job.orderId !== "string" || !ORDER_ID_PATTERN.test(job.orderId) ||
        !Number.isSafeInteger(job.attempt) || job.attempt < 1 || job.attempt > this.#maxAttempts ||
        (job.eventTime !== null && (typeof job.eventTime !== "string" || Number.isNaN(Date.parse(job.eventTime))))) {
      throw new ProdigiCallbackError("invalid_input");
    }
    const { orderId, attempt } = job;
    const key = scopeKey(this.#scope, orderId);
    const pendingTime = this.#pending.get(key);
    this.#pending.delete(key);
    const jobTime = job.eventTime === null ? null : Date.parse(job.eventTime);
    const eventTimeMs = jobTime === null ? (pendingTime ?? null) : Math.max(jobTime, pendingTime ?? jobTime);
    const done = (status: ProdigiScheduledRunStatus, errorCode?: ProdigiReconcileErrorCode): ProdigiScheduledRunResult =>
      Object.freeze({ status, orderId, attempt, ...(errorCode === undefined ? {} : { errorCode }) });
    const retry = async (status: ProdigiScheduledRunStatus, errorCode?: ProdigiReconcileErrorCode, minDelayMs = 0): Promise<ProdigiScheduledRunResult> => {
      if (attempt >= this.#maxAttempts) return done(status, errorCode);
      return (await this.#schedule(orderId, attempt + 1, eventTimeMs, minDelayMs)) ? done("rescheduled", errorCode) : done(status, errorCode);
    };

    const current = await this.#getOrder(orderId);
    if (current === undefined) return done("untracked_order");
    if (isTerminalStage(current.stage) && !current.conflict) return done("already_terminal");
    if (eventTimeMs !== null && this.#covers(current, eventTimeMs)) return done("covered");
    let flight = this.#flights.get(key);
    if (flight === undefined) {
      const wait = this.#intervalRemaining(key);
      if (wait > 0) return retry("retries_exhausted", "read_budget_exhausted", wait);
      flight = this.#startFlight(orderId);
      if (flight === undefined) return retry("retries_exhausted", "read_budget_exhausted");
    }
    const read = await flight.promise;
    if (!read.ok) return RETRYABLE.has(read.code) ? retry("retries_exhausted", read.code) : done("read_failed", read.code);
    const status = read.result.status;
    if (status === "untracked_order") return done("untracked_order");
    if (status === "terminal_conflict") return done("terminal_conflict");
    if ((status === "applied" || status === "unchanged") &&
        (eventTimeMs === null || (read.result.state !== undefined && this.#covers(read.result.state, eventTimeMs)))) {
      return done(status);
    }
    return retry("retries_exhausted");
  }

  /**
   * Authenticated polling entry point, independent of callbacks: read the
   * order (single-flight, through the global read limiter) with bounded,
   * fully jittered exponential backoff on retryable failures, then apply it
   * under the ordering rules with compare-and-set. Meant for a scheduled
   * poller, not for a request handler.
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
      if (read.ok) return Object.freeze({ ...read.result, attempts, delaysMs: Object.freeze([...delays]) });
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

  /** Start a single-flight read if the global limiter allows one now; otherwise undefined. */
  #startFlight(orderId: string): Flight | undefined {
    const key = scopeKey(this.#scope, orderId);
    const release = this.#limiter.tryAcquire();
    if (release === null) return undefined;
    const startedAt = this.#clock.now();
    this.#lastReadStart.delete(key);
    this.#lastReadStart.set(key, startedAt);
    while (this.#lastReadStart.size > MAX_ORDER_ENTRIES) this.#lastReadStart.delete(this.#lastReadStart.keys().next().value as string);
    const promise = this.#read(orderId, startedAt).finally(() => {
      release();
      this.#flights.delete(key);
    });
    const flight: Flight = { startedAt, promise };
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
      return { ok: false, code: "reader_error", startedAt };
    }
  }

  async #apply(orderId: string, observation: ProdigiOrderObservation, startedAt: number): Promise<ProdigiReconcileResult> {
    const result = (status: ProdigiReconcileStatus, state: ProdigiReconciledOrderState | undefined): ProdigiReconcileResult =>
      Object.freeze({ status, orderId, attempts: 1, delaysMs: Object.freeze([]), state });
    const startedIso = new Date(startedAt).toISOString();
    const confirm = (state: ProdigiReconciledOrderState): string =>
      state.confirmedAt !== null && Date.parse(state.confirmedAt) >= startedAt ? state.confirmedAt : startedIso;
    for (let round = 0; round < 4; round += 1) {
      const current = await this.#getOrder(orderId);
      if (current === undefined) return result("untracked_order", undefined);
      const decision = decideProdigiOrdering(current, observation);
      if (decision === "stale") return result("stale_rejected", current);
      if (decision === "regression") return result("regression_rejected", current);
      let next: ProdigiReconciledOrderState;
      if (decision === "unchanged") {
        // Record that a read confirmed the state, so covered callbacks skip reads.
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
          reconciledAt: new Date(this.#clock.now()).toISOString(),
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
  // Coalescing and scheduling

  /** Event times in the future are clamped to now, so a forged far-future time cannot dodge coverage forever. */
  #effectiveEventTime(eventTime: string): number {
    return Math.min(Date.parse(eventTime), this.#clock.now());
  }

  #covers(state: ProdigiReconciledOrderState, eventTimeMs: number): boolean {
    if (state.confirmedAt === null) return false;
    return Date.parse(state.confirmedAt) >= eventTimeMs + this.#coverageSkewMs;
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

  /** Schedule one job per order. Returns false when the job could not be accepted. */
  async #schedule(orderId: string, attempt: number, eventTimeMs: number | null, minDelayMs: number): Promise<boolean> {
    const key = scopeKey(this.#scope, orderId);
    if (this.#pending.has(key)) {
      const existing = this.#pending.get(key) ?? null;
      this.#pending.set(key, existing === null || eventTimeMs === null ? (existing ?? eventTimeMs) : Math.max(existing, eventTimeMs));
      return true;
    }
    if (this.#pending.size >= this.#maxPendingJobs) return false;
    const job: ProdigiReconcileJob = Object.freeze({
      key,
      orderId,
      attempt,
      delayMs: Math.max(minDelayMs, this.#jitter(attempt)),
      eventTime: eventTimeMs === null ? null : new Date(eventTimeMs).toISOString()
    });
    this.#pending.set(key, eventTimeMs);
    try {
      await this.#scheduler.schedule(job);
      return true;
    } catch {
      this.#pending.delete(key);
      return false;
    }
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
      await this.#store.recordEvent({ scope: this.#scope, orderId, eventId, expiresAt: new Date(this.#clock.now() + this.#replayTtlMs).toISOString() });
    } catch {
      // The state is already applied and confirmedAt covers the event, so a
      // missing replay record only costs a coverage check on redelivery.
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
}
