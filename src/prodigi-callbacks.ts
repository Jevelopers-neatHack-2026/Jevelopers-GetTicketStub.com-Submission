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
 *    event ID, order ID (`subject`) and event type are kept. The embedded order
 *    object (`data`, which includes the recipient) is discarded unread.
 * 3. The order state changes only from an authenticated `GET /v4.0/orders/{id}`
 *    read through the sandbox adapter, polled with bounded backoff, and applied
 *    with monotonic ordering checks so a stale or reordered read cannot regress it.
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
  | "store_unavailable";

const CALLBACK_MESSAGES: Readonly<Record<ProdigiCallbackErrorCode, string>> = {
  invalid_config: "The Prodigi callback reconciler configuration is invalid.",
  live_refused: "Live Prodigi callbacks and reconciliation are refused.",
  callbacks_disabled: "Prodigi callbacks are disabled.",
  callback_forged: "The callback did not present the expected capability token.",
  callback_token_unavailable: "The callback capability token is unavailable.",
  callback_invalid: "The callback did not pass validation.",
  callback_oversized: "The callback exceeded the configured body limit.",
  invalid_input: "The reconciliation input did not pass validation.",
  store_unavailable: "The reconciliation store is unavailable."
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
  /** Set when an authenticated read contradicted a terminal stage; the read was not applied. */
  readonly conflict: boolean;
}

export type ProdigiOrderingDecision = "apply" | "unchanged" | "stale" | "regression" | "terminal_conflict";

function observationDigest(observation: ProdigiOrderObservation): string {
  const canonical = JSON.stringify({
    stage: observation.stage,
    details: DETAIL_KEYS.map((key) => observation.details[key]),
    issues: [...observation.issueCodes].sort(),
    shipments: observation.shipments.map((s) => [s.id, s.status, s.carrier, s.trackingNumber, s.dispatchDate])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  });
  return `sha256:${createHash("sha256").update(canonical).digest("hex")}`;
}

/**
 * Decide whether an authenticated observation may replace the stored state.
 * A strictly older `lastUpdated` is stale. A terminal stage cannot move back to
 * `InProgress`, and `Complete` versus `Cancelled` is a conflict, never a
 * timestamp-selected winner. Within `InProgress`, no step and no shipment may
 * go backwards.
 */
export function decideProdigiOrdering(current: ProdigiReconciledOrderState | undefined, observation: ProdigiOrderObservation): ProdigiOrderingDecision {
  if (current === undefined || current.stage === null || current.details === null) return "apply";
  if (current.observationDigest === observationDigest(observation)) return "unchanged";
  const storedTime = timeOf(current.lastUpdated);
  const incomingTime = timeOf(observation.lastUpdated);
  if (storedTime !== null && incomingTime !== null && incomingTime < storedTime) return "stale";
  if (isTerminalStage(current.stage)) {
    if (!isTerminalStage(observation.stage)) return "regression";
    if (observation.stage !== current.stage) return "terminal_conflict";
  }
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

export type ProdigiEventClaim = "claimed" | "replayed" | "duplicate_status";

/**
 * Idempotency and order-state store. Event claims are keyed on scope, order ID
 * and event ID (replay) and on scope, order ID and event type (duplicate
 * status). A production implementation must make `claimEvent` and
 * `compareAndSetOrder` atomic across workers and restarts.
 */
export interface ProdigiReconciliationStore {
  claimEvent(input: { readonly scope: TrustedScope; readonly orderId: string; readonly eventId: string; readonly statusKey: string }): Promise<ProdigiEventClaim>;
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

/**
 * Single-process reference store for tests and local development. It is not
 * durable and gives no cross-process atomicity.
 */
export function createInMemoryProdigiReconciliationStore(): ProdigiReconciliationStore {
  const events = new Set<string>();
  const statuses = new Set<string>();
  const orders = new Map<string, ProdigiReconciledOrderState>();
  return Object.freeze({
    async claimEvent(input: { scope: TrustedScope; orderId: string; eventId: string; statusKey: string }): Promise<ProdigiEventClaim> {
      const base = scopeKey(input.scope, input.orderId);
      const eventKey = `${base}|event|${input.eventId}`;
      if (events.has(eventKey)) return "replayed";
      events.add(eventKey);
      const statusKey = `${base}|status|${input.statusKey}`;
      if (statuses.has(statusKey)) return "duplicate_status";
      statuses.add(statusKey);
      return "claimed";
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
    }
  });
}

// ---------------------------------------------------------------------------
// Reconciler

/** The authenticated read used for reconciliation (`ProdigiSandboxClient` satisfies it). */
export interface ProdigiOrderReader {
  getOrder(orderId: string, signal?: AbortSignal): Promise<ProdigiOrderObservation>;
}

export interface ProdigiPollPolicy {
  /** Delay before the second attempt. 1..60000 ms, default 1000. */
  readonly initialDelayMs?: number;
  /** Cap for any single delay. initialDelayMs..300000 ms, default 60000. */
  readonly maxDelayMs?: number;
  /** Total read attempts per reconciliation. 1..10, default 5. */
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
  /** Host-injected secret reference for the callback URL token. There is no default binding. */
  readonly callbackTokenReference?: string;
  /** Raw body limit, 1..1048576 bytes, default 524288. */
  readonly maxBodyBytes?: number;
  readonly pollPolicy?: ProdigiPollPolicy;
  readonly clock?: { now(): number };
  /** Injected for tests; defaults to an abortable timer. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

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
  readonly errorCode?: ProdigiSandboxErrorCode;
}

export type ProdigiCallbackOutcome = "reconciled" | "replayed" | "duplicate_status" | "stale_hint" | "already_terminal" | "untracked_order";

export interface ProdigiCallbackResult {
  readonly outcome: ProdigiCallbackOutcome;
  readonly trust: "unverified";
  readonly eventId: string;
  readonly orderId: string;
  /** The callback body itself never mutates state; only `reconciliation` does. */
  readonly authoritativeMutationAllowed: false;
  readonly reconciliation?: ProdigiReconcileResult;
}

const RETRYABLE: ReadonlySet<ProdigiSandboxErrorCode> = new Set(["rate_limited", "provider_unavailable", "timeout"]);
const TOKEN_PATTERN = /^[\x21-\x7E]{1,512}$/u;
const MIN_TOKEN_LENGTH = 32;
const DEFAULT_BODY_BYTES = 512 * 1024;
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

export class ProdigiCallbackReconciler {
  readonly #scope: TrustedScope;
  readonly #reader: ProdigiOrderReader;
  readonly #store: ProdigiReconciliationStore;
  readonly #callbacksEnabled: boolean;
  readonly #secrets: ServerSecretSource | undefined;
  readonly #tokenReference: string | undefined;
  readonly #maxBodyBytes: number;
  readonly #initialDelayMs: number;
  readonly #maxDelayMs: number;
  readonly #maxAttempts: number;
  readonly #clock: { now(): number };
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

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
    if (store === null || typeof store !== "object" || typeof store.claimEvent !== "function" ||
        typeof store.getOrder !== "function" || typeof store.compareAndSetOrder !== "function") {
      throw new ProdigiCallbackError("invalid_config");
    }
    const enabled = options.callbacksEnabled === true;
    if (enabled) {
      if (options.secrets === null || typeof options.secrets !== "object" || typeof options.secrets.load !== "function") throw new ProdigiCallbackError("invalid_config");
      if (typeof options.callbackTokenReference !== "string" || !REFERENCE_PATTERN.test(options.callbackTokenReference)) throw new ProdigiCallbackError("invalid_config");
    }
    const policy = options.pollPolicy ?? {};
    this.#initialDelayMs = boundedInt(policy.initialDelayMs, 1000, 1, 60_000);
    this.#maxDelayMs = boundedInt(policy.maxDelayMs, Math.max(60_000, this.#initialDelayMs), this.#initialDelayMs, 300_000);
    this.#maxAttempts = boundedInt(policy.maxAttempts, 5, 1, 10);
    this.#maxBodyBytes = boundedInt(options.maxBodyBytes, DEFAULT_BODY_BYTES, 1, 1024 * 1024);
    this.#scope = Object.freeze({ tenantId: scope.tenantId, projectId: scope.projectId });
    this.#reader = options.reader;
    this.#store = store;
    this.#callbacksEnabled = enabled;
    this.#secrets = enabled ? options.secrets : undefined;
    this.#tokenReference = enabled ? options.callbackTokenReference : undefined;
    this.#clock = options.clock ?? { now: () => Date.now() };
    this.#sleep = options.sleep ?? defaultSleep;
  }

  get callbacksEnabled(): boolean {
    return this.#callbacksEnabled;
  }

  /** Bounded exponential schedule: delay before attempt n+1 = min(max, initial * 2^(n-1)). */
  backoffSchedule(): readonly number[] {
    const delays: number[] = [];
    for (let attempt = 1; attempt < this.#maxAttempts; attempt += 1) {
      delays.push(Math.min(this.#maxDelayMs, this.#initialDelayMs * 2 ** (attempt - 1)));
    }
    return Object.freeze(delays);
  }

  /** Register an order this application created, so callbacks for it may trigger reads. */
  async trackOrder(orderId: string): Promise<ProdigiReconciledOrderState> {
    if (typeof orderId !== "string" || !ORDER_ID_PATTERN.test(orderId)) throw new ProdigiCallbackError("invalid_input");
    const existing = await this.#getOrder(orderId);
    if (existing !== undefined) return existing;
    const initial: ProdigiReconciledOrderState = Object.freeze({
      orderId, revision: 0, stage: null, normalizedState: "pending", details: null, shipmentIds: Object.freeze([]),
      lastUpdated: null, observationDigest: null, reconciledAt: null, conflict: false
    });
    if (await this.#cas(orderId, null, initial)) return initial;
    const raced = await this.#getOrder(orderId);
    if (raced === undefined) throw new ProdigiCallbackError("store_unavailable");
    return raced;
  }

  /**
   * Accept one callback request. `presentedToken` is the capability token the
   * host's HTTP handler extracted from the callback URL it registered. The body
   * is never applied; at most it triggers an authenticated reconciliation.
   */
  async handleCallback(input: {
    readonly presentedToken: unknown;
    readonly headers: unknown;
    readonly rawBody: Uint8Array;
    readonly signal?: AbortSignal;
  }): Promise<ProdigiCallbackResult> {
    if (!this.#callbacksEnabled) throw new ProdigiCallbackError("callbacks_disabled");
    if (input === null || typeof input !== "object") throw new ProdigiCallbackError("callback_invalid");
    await this.#verifyToken(input.presentedToken);

    // Pre-parse for the order-scoped claim; ingestProviderCallback re-parses its own copy.
    const rawBody = input.rawBody;
    if (!(rawBody instanceof Uint8Array)) throw new ProdigiCallbackError("callback_invalid");
    if (rawBody.byteLength > this.#maxBodyBytes) throw new ProdigiCallbackError("callback_oversized");
    const hint = parseProdigiCallbackEvent(rawBody);
    let claim: ProdigiEventClaim | undefined;
    const store = this.#store;
    const scope = this.#scope;
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
            claim = await store.claimEvent({ scope, orderId: hint.orderId, eventId: hint.eventId, statusKey: hint.type });
            return claim === "claimed";
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
    const base = { trust: "unverified" as const, eventId: hint.eventId, orderId: hint.orderId, authoritativeMutationAllowed: false as const };
    if (claim === "replayed") return Object.freeze({ ...base, outcome: "replayed" });
    if (claim === "duplicate_status") return Object.freeze({ ...base, outcome: "duplicate_status" });
    if (claim !== "claimed") throw new ProdigiCallbackError("store_unavailable");

    const current = await this.#getOrder(hint.orderId);
    if (current === undefined) return Object.freeze({ ...base, outcome: "untracked_order" });
    // A hint naming an earlier stage than the reconciled one (e.g. a reordered
    // InProgress after Complete) is stale and triggers no read.
    if (hint.claimedStage !== null && stageRank(hint.claimedStage) < stageRank(current.stage)) {
      return Object.freeze({ ...base, outcome: "stale_hint" });
    }
    if (isTerminalStage(current.stage) && !current.conflict) return Object.freeze({ ...base, outcome: "already_terminal" });
    const reconciliation = await this.reconcileOrder(hint.orderId, input.signal);
    return Object.freeze({ ...base, outcome: "reconciled", reconciliation });
  }

  /**
   * Authenticated reconciliation: read the order through the adapter with
   * bounded exponential backoff on retryable failures, then apply it under the
   * ordering rules with compare-and-set. Usable as scheduled polling with
   * callbacks disabled.
   */
  async reconcileOrder(orderId: string, signal?: AbortSignal): Promise<ProdigiReconcileResult> {
    if (typeof orderId !== "string" || !ORDER_ID_PATTERN.test(orderId)) throw new ProdigiCallbackError("invalid_input");
    const tracked = await this.#getOrder(orderId);
    if (tracked === undefined) {
      return Object.freeze({ status: "untracked_order", orderId, attempts: 0, delaysMs: Object.freeze([]), state: undefined });
    }
    const schedule = this.backoffSchedule();
    const delays: number[] = [];
    let attempts = 0;
    let observation: ProdigiOrderObservation | undefined;
    let lastCode: ProdigiSandboxErrorCode | undefined;
    while (attempts < this.#maxAttempts) {
      attempts += 1;
      try {
        observation = await this.#reader.getOrder(orderId, signal);
        break;
      } catch (error) {
        lastCode = error instanceof ProdigiSandboxError ? error.code : "provider_unavailable";
        if (!RETRYABLE.has(lastCode) || attempts >= this.#maxAttempts || signal?.aborted === true) break;
        const delay = schedule[attempts - 1] as number;
        delays.push(delay);
        try {
          await this.#sleep(delay, signal);
        } catch {
          break;
        }
      }
    }
    const frozenDelays = Object.freeze(delays);
    if (observation === undefined) {
      const status: ProdigiReconcileStatus = lastCode !== undefined && RETRYABLE.has(lastCode) && attempts >= this.#maxAttempts ? "retries_exhausted" : "read_failed";
      return Object.freeze({ status, orderId, attempts, delaysMs: frozenDelays, state: await this.#getOrder(orderId), ...(lastCode === undefined ? {} : { errorCode: lastCode }) });
    }
    if (observation.orderId !== orderId) {
      return Object.freeze({ status: "read_failed", orderId, attempts, delaysMs: frozenDelays, state: await this.#getOrder(orderId), errorCode: "invalid_response" as const });
    }
    return this.#apply(orderId, observation, attempts, frozenDelays);
  }

  async #apply(orderId: string, observation: ProdigiOrderObservation, attempts: number, delaysMs: readonly number[]): Promise<ProdigiReconcileResult> {
    for (let round = 0; round < 4; round += 1) {
      const current = await this.#getOrder(orderId);
      if (current === undefined) return Object.freeze({ status: "untracked_order", orderId, attempts, delaysMs, state: undefined });
      const decision = decideProdigiOrdering(current, observation);
      if (decision === "unchanged") return Object.freeze({ status: "unchanged", orderId, attempts, delaysMs, state: current });
      if (decision === "stale") return Object.freeze({ status: "stale_rejected", orderId, attempts, delaysMs, state: current });
      if (decision === "regression") return Object.freeze({ status: "regression_rejected", orderId, attempts, delaysMs, state: current });
      const next: ProdigiReconciledOrderState = decision === "terminal_conflict"
        ? Object.freeze({ ...current, revision: current.revision + 1, conflict: true })
        : Object.freeze({
          orderId,
          revision: current.revision + 1,
          stage: observation.stage,
          normalizedState: observation.normalizedState,
          details: Object.freeze({ ...observation.details }),
          shipmentIds: Object.freeze(observation.shipments.map((s) => s.id).sort()),
          lastUpdated: observation.lastUpdated,
          observationDigest: observationDigest(observation),
          reconciledAt: new Date(this.#clock.now()).toISOString(),
          conflict: current.conflict
        });
      if (decision === "terminal_conflict" && current.conflict) {
        return Object.freeze({ status: "terminal_conflict", orderId, attempts, delaysMs, state: current });
      }
      if (await this.#cas(orderId, current.revision, next)) {
        return Object.freeze({ status: decision === "terminal_conflict" ? "terminal_conflict" : "applied", orderId, attempts, delaysMs, state: next });
      }
    }
    throw new ProdigiCallbackError("store_unavailable");
  }

  async #verifyToken(presented: unknown): Promise<void> {
    if (typeof presented !== "string" || !TOKEN_PATTERN.test(presented)) throw new ProdigiCallbackError("callback_forged");
    let matched: boolean;
    try {
      matched = await withServerSecret<boolean>({
        providerId: "prodigi",
        secretReference: this.#tokenReference,
        mode: "sandbox",
        source: this.#secrets as ServerSecretSource,
        use: async ({ secret }) => {
          if (secret.length < MIN_TOKEN_LENGTH) throw new Error("weak");
          return timingSafeEqual(digestToken(presented), digestToken(secret));
        }
      });
    } catch {
      throw new ProdigiCallbackError("callback_token_unavailable");
    }
    if (!matched) throw new ProdigiCallbackError("callback_forged");
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
