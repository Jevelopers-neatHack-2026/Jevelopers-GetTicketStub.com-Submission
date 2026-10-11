// @ts-ignore Node built-in types are intentionally not a package dependency; execution targets Node 24.
import { createHash } from "node:crypto";
import type {
  AdapterCallContext,
  CancelCommand,
  CancelResult,
  Clock,
  Operation,
  PreflightCommand,
  PreflightReport,
  PreSubmitContext,
  ProviderAdapter,
  ProviderDescriptor,
  ProviderResult,
  QuoteCommand,
  QuoteResult,
  ShipmentCommand,
  ShipmentResult,
  StatusCommand,
  StatusResult,
  SubmitCommand,
  SubmitResult
} from "./types.js";

/** Private local fixture identity. It is not a supplier or accepted contract version. */
export const SIMULATOR_FIXTURE_VERSION = "fc-mock-development/1";
export const SIMULATOR_PROVIDER_ID = "development-deterministic-simulator";

export type SimulatorOrderStatus = StatusResult["normalizedState"];
export type SimulatorFaultKind =
  | "refuse_before_dispatch"
  | "unsupported"
  | "rate_limit"
  | "accepted_then_timeout"
  | "crash_after_acceptance"
  | "malformed_response"
  | "unknown_status";

export interface SimulatorFault {
  readonly operation: Operation;
  readonly kind: SimulatorFaultKind;
}

export interface SimulatorShipmentRecord {
  readonly providerShipmentId: string;
  readonly trackingNumber: string;
  readonly carrier: string;
  readonly occurredAt: string;
}

export interface SimulatorQuoteRecord {
  readonly providerQuoteId: string;
  readonly productionBundleDigest: string;
  readonly quantity: number;
  readonly totalMinor: number;
  readonly currency: string;
  readonly termsFingerprint: string;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export interface SimulatorOrderRecord {
  readonly providerRequestId: string;
  readonly quoteId: string;
  readonly productionBundleDigest: string;
  readonly requestFingerprintDigest: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly acceptedAt: string;
  status: SimulatorOrderStatus;
  statusOccurredAt: string;
  shipments: SimulatorShipmentRecord[];
}

export interface SimulatorIdempotencyRecord {
  readonly keyDigest: string;
  readonly requestDigest: string;
  readonly providerRequestId: string;
  readonly expiresAt: number;
  readonly generation: number;
}

export interface SimulatorCancelIdempotencyRecord {
  readonly keyDigest: string;
  readonly requestDigest: string;
  readonly result: CancelResult;
  readonly expiresAt: number;
  readonly generation: number;
}

export interface SimulatorBillingEvidence {
  readonly billingMode: "simulated";
  readonly event: "order_accepted";
  readonly providerRequestId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly observedAt: string;
  readonly charged: false;
}

interface StatusCallbackRecord {
  readonly kind: "status";
  readonly eventId: string;
  readonly providerRequestId: string;
  readonly status: SimulatorOrderStatus;
  readonly occurredAt: string;
  readonly availableAt: number;
  deliveryAttempts: number;
  applied: boolean;
}

interface ShipmentCallbackRecord {
  readonly kind: "shipment";
  readonly eventId: string;
  readonly providerRequestId: string;
  readonly shipment: SimulatorShipmentRecord;
  readonly occurredAt: string;
  readonly availableAt: number;
  deliveryAttempts: number;
  applied: boolean;
}

export type SimulatorCallbackRecord = StatusCallbackRecord | ShipmentCallbackRecord;

export interface SimulatorCallbackDelivery {
  readonly eventId: string;
  readonly outcome: "delivered" | "delayed" | "duplicate" | "not_found";
}

export interface SimulatorSnapshot {
  readonly format: typeof SIMULATOR_FIXTURE_VERSION;
  readonly billingMode: "simulated";
  readonly seed: string;
  nowMs: number;
  readonly quoteTtlMs: number;
  readonly idempotencyTtlMs: number;
  readonly unsupportedOperations: Operation[];
  faults: SimulatorFault[];
  readonly triggeredFaults: { readonly operation: Operation; readonly kind: SimulatorFaultKind }[];
  quotes: SimulatorQuoteRecord[];
  orders: SimulatorOrderRecord[];
  idempotency: SimulatorIdempotencyRecord[];
  cancelIdempotency: SimulatorCancelIdempotencyRecord[];
  callbacks: SimulatorCallbackRecord[];
  readonly dispatchCounters: Record<Operation, number>;
  duplicateSubmissions: number;
  duplicateCallbacks: number;
  readonly billingEvidence: SimulatorBillingEvidence[];
}

export interface SimulatorOptions {
  /** Synthetic test seed only. Never place production data or credentials here. */
  readonly seed?: string;
  /** Deterministic ISO timestamp or epoch milliseconds; required for a new state. */
  readonly startAt?: string | number;
  /** JSON-compatible state from snapshot(), used to model a restart. */
  readonly snapshot?: SimulatorSnapshot;
  readonly faults?: readonly SimulatorFault[];
  readonly unsupportedOperations?: readonly Operation[];
  readonly quoteTtlMs?: number;
  readonly idempotencyTtlMs?: number;
}

const OPERATIONS: readonly Operation[] = [
  "discover_capabilities", "quote", "preflight", "submit", "status", "shipment", "cancel"
];
const ORDER_STATUS_RANK: Readonly<Record<SimulatorOrderStatus, number>> = {
  pending: 0,
  accepted: 1,
  in_production: 2,
  shipped: 3,
  cancelled: 4,
  failed: 4,
  delivered: 5,
  unknown: -1
};
const CURRENCY = "USD";
const UNIT_PRODUCTION_MINOR = 1_200;
const FLAT_SHIPPING_MINOR = 300;
const SIMULATED_TAX_BASIS_POINTS = 1_000;
const MAX_QUANTITY = 10_000;
const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;

function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function canonicalJson(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite simulator input");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("cyclic simulator input");
    seen.add(value);
    const parts: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("accessor simulator input");
      parts.push(canonicalJson(descriptor.value, seen));
    }
    seen.delete(value);
    return `[${parts.join(",")}]`;
  }
  if (typeof value !== "object") throw new TypeError("non-JSON simulator input");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError("non-JSON simulator object");
  if (seen.has(value)) throw new TypeError("cyclic simulator input");
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) throw new TypeError("symbol simulator input");
  const entries: string[] = [];
  for (const key of (keys as string[]).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("accessor simulator input");
    entries.push(`${JSON.stringify(key)}:${canonicalJson(descriptor.value, seen)}`);
  }
  seen.delete(value);
  return `{${entries.join(",")}}`;
}

/** Exposed for local test fixtures; this is not a shared-contract digest rule. */
export function simulatorFixtureDigest(value: unknown): string {
  return `sha256:${hashText(canonicalJson(value))}`;
}

/** Local deterministic bridge for the private runtime's quote fingerprint field. */
export function simulatorQuoteTermsFingerprint(input: {
  readonly providerQuoteId: string;
  readonly totalMinor: number;
  readonly currency: string;
  readonly expiresAt: string;
  readonly productionBundleDigest: string;
}): string {
  return simulatorFixtureDigest({
    providerQuoteId: input.providerQuoteId,
    totalMinor: input.totalMinor,
    currency: input.currency,
    expiresAt: input.expiresAt,
    productionBundleDigest: input.productionBundleDigest
  });
}

function iso(milliseconds: number): string {
  return new Date(milliseconds).toISOString();
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validStatus(value: unknown): value is SimulatorOrderStatus {
  return value === "pending" || value === "accepted" || value === "in_production" || value === "shipped" ||
    value === "delivered" || value === "cancelled" || value === "failed" || value === "unknown";
}

function validOperation(value: unknown): value is Operation {
  return typeof value === "string" && OPERATIONS.includes(value as Operation);
}

function descriptorFor(unsupported: readonly Operation[]): ProviderDescriptor {
  const disabled = new Set(unsupported);
  return Object.freeze({
    providerId: SIMULATOR_PROVIDER_ID,
    apiVersion: SIMULATOR_FIXTURE_VERSION,
    productLimits: Object.freeze({ maxQuantity: MAX_QUANTITY, currency: CURRENCY }),
    operations: Object.freeze({
      discover_capabilities: Object.freeze({ supported: !disabled.has("discover_capabilities"), sideEffect: "none", mayCharge: false, idempotency: "not_applicable" }),
      quote: Object.freeze({ supported: !disabled.has("quote"), sideEffect: "none", mayCharge: false, idempotency: "not_applicable" }),
      preflight: Object.freeze({ supported: !disabled.has("preflight"), sideEffect: "none", mayCharge: false, idempotency: "not_applicable" }),
      submit: Object.freeze({ supported: !disabled.has("submit"), sideEffect: "external", mayCharge: true, idempotency: "provider_key" }),
      status: Object.freeze({ supported: !disabled.has("status"), sideEffect: "none", mayCharge: false, idempotency: "not_applicable" }),
      shipment: Object.freeze({ supported: !disabled.has("shipment"), sideEffect: "none", mayCharge: false, idempotency: "not_applicable" }),
      cancel: Object.freeze({ supported: !disabled.has("cancel"), sideEffect: "external", mayCharge: false, idempotency: "provider_key" })
    }),
    supportedModes: Object.freeze(["simulated"] as const)
  });
}

function makeInitialState(options: SimulatorOptions): SimulatorSnapshot {
  if (typeof options.seed !== "string" || options.seed.trim() === "" || options.seed.length > 200) {
    throw new TypeError("a bounded synthetic simulator seed is required");
  }
  const start = typeof options.startAt === "string" ? Date.parse(options.startAt) : options.startAt;
  if (typeof start !== "number" || !Number.isSafeInteger(start) || Math.abs(start) > MAX_DATE_EPOCH_MS) {
    throw new TypeError("a deterministic simulator start time is required");
  }
  const quoteTtlMs = options.quoteTtlMs ?? 60 * 60 * 1_000;
  const idempotencyTtlMs = options.idempotencyTtlMs ?? 30 * 24 * 60 * 60 * 1_000;
  if (!Number.isSafeInteger(quoteTtlMs) || quoteTtlMs < 1 || !Number.isSafeInteger(idempotencyTtlMs) || idempotencyTtlMs < 1 ||
    start + quoteTtlMs > MAX_DATE_EPOCH_MS || start + idempotencyTtlMs > Number.MAX_SAFE_INTEGER) {
    throw new TypeError("simulator retention intervals must be positive safe integers");
  }
  const unsupportedOperations = [...new Set(options.unsupportedOperations ?? [])];
  if (unsupportedOperations.some((operation) => !validOperation(operation))) throw new TypeError("unknown unsupported simulator operation");
  const faults = (options.faults ?? []).map((fault) => {
    if (fault === null || typeof fault !== "object" || !validOperation(fault.operation) ||
      !["refuse_before_dispatch", "unsupported", "rate_limit", "accepted_then_timeout", "crash_after_acceptance", "malformed_response", "unknown_status"].includes(fault.kind)) {
      throw new TypeError("invalid simulator fault plan");
    }
    return { operation: fault.operation, kind: fault.kind };
  });
  return {
    format: SIMULATOR_FIXTURE_VERSION,
    billingMode: "simulated",
    seed: options.seed,
    nowMs: start,
    quoteTtlMs,
    idempotencyTtlMs,
    unsupportedOperations,
    faults,
    triggeredFaults: [],
    quotes: [],
    orders: [],
    idempotency: [],
    cancelIdempotency: [],
    callbacks: [],
    dispatchCounters: {
      discover_capabilities: 0, quote: 0, preflight: 0, submit: 0, status: 0, shipment: 0, cancel: 0
    },
    duplicateSubmissions: 0,
    duplicateCallbacks: 0,
    billingEvidence: []
  };
}

function parseSnapshot(snapshot: SimulatorSnapshot): SimulatorSnapshot {
  let copy: SimulatorSnapshot;
  try {
    copy = JSON.parse(JSON.stringify(snapshot)) as SimulatorSnapshot;
  } catch {
    throw new TypeError("simulator snapshot must be JSON serializable");
  }
  if (copy === null || typeof copy !== "object" || copy.format !== SIMULATOR_FIXTURE_VERSION ||
    copy.billingMode !== "simulated" || typeof copy.seed !== "string" || copy.seed.trim() === "" ||
    !Number.isSafeInteger(copy.nowMs) || Math.abs(copy.nowMs) > MAX_DATE_EPOCH_MS || !Number.isSafeInteger(copy.quoteTtlMs) || copy.quoteTtlMs < 1 ||
    !Number.isSafeInteger(copy.idempotencyTtlMs) || copy.idempotencyTtlMs < 1 ||
    !Array.isArray(copy.unsupportedOperations) || copy.unsupportedOperations.some((op) => !validOperation(op)) ||
    !Array.isArray(copy.faults) || !Array.isArray(copy.triggeredFaults) || !Array.isArray(copy.quotes) ||
    !Array.isArray(copy.orders) || !Array.isArray(copy.idempotency) || !Array.isArray(copy.cancelIdempotency) || !Array.isArray(copy.callbacks) ||
    !Array.isArray(copy.billingEvidence) || copy.dispatchCounters === null || typeof copy.dispatchCounters !== "object" ||
    OPERATIONS.some((operation) => !Number.isSafeInteger(copy.dispatchCounters[operation]) || copy.dispatchCounters[operation] < 0) ||
    !Number.isSafeInteger(copy.duplicateSubmissions) || copy.duplicateSubmissions < 0 ||
    !Number.isSafeInteger(copy.duplicateCallbacks) || copy.duplicateCallbacks < 0) {
    throw new TypeError("simulator snapshot is invalid or has an unsupported version");
  }
  return copy;
}

class SimulatedProviderError extends Error {
  constructor(message = "Simulated provider operation failed.", readonly code?: string, readonly status?: number) {
    super(message);
    this.name = "SimulatedProviderError";
  }
}

function stableQuote(record: SimulatorQuoteRecord): QuoteResult {
  const production = UNIT_PRODUCTION_MINOR * record.quantity;
  const tax = Math.floor((production * SIMULATED_TAX_BASIS_POINTS + 5_000) / 10_000);
  return {
    providerQuoteId: record.providerQuoteId,
    currency: record.currency,
    totalMinor: record.totalMinor,
    expiresAt: record.expiresAt,
    breakdown: [
      { label: "simulated production", amountMinor: production },
      { label: "simulated shipping", amountMinor: FLAT_SHIPPING_MINOR },
      { label: "simulated tax", amountMinor: tax }
    ]
  };
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new SimulatedProviderError();
  return value;
}

function requireSafeInteger(value: unknown, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new SimulatedProviderError();
  return value as number;
}

export class DeterministicSimulator implements Clock {
  readonly mode = "simulated" as const;
  readonly adapter: ProviderAdapter;
  readonly transport: { readonly mode: "simulated"; request<T>(request: import("./types.js").ProviderTransportRequest): Promise<T> };
  readonly clock: Clock = this;
  readonly descriptor: ProviderDescriptor;
  private readonly state: SimulatorSnapshot;
  private crashBarrierHandler: (() => void) | undefined = undefined;

  constructor(options: SimulatorOptions) {
    if (options.snapshot !== undefined) {
      if (options.seed !== undefined || options.startAt !== undefined || options.faults !== undefined ||
        options.unsupportedOperations !== undefined || options.quoteTtlMs !== undefined || options.idempotencyTtlMs !== undefined) {
        throw new TypeError("restore from one snapshot without overriding its deterministic settings");
      }
      this.state = parseSnapshot(options.snapshot);
    } else {
      this.state = makeInitialState(options);
    }
    this.descriptor = descriptorFor(this.state.unsupportedOperations);
    this.transport = Object.freeze({
      mode: "simulated" as const,
      request: <T>(request: import("./types.js").ProviderTransportRequest): Promise<T> => this.request<T>(request)
    });
    this.adapter = this.createAdapter();
  }

  now(): number {
    return this.state.nowMs;
  }

  /** Advances only the synthetic clock stored in this isolated fixture. */
  advanceTime(milliseconds: number): void {
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || !Number.isSafeInteger(this.state.nowMs + milliseconds) ||
      Math.abs(this.state.nowMs + milliseconds) > MAX_DATE_EPOCH_MS) {
      throw new TypeError("simulator time advance must be a non-negative safe integer");
    }
    this.state.nowMs += milliseconds;
  }

  snapshot(): SimulatorSnapshot {
    return JSON.parse(JSON.stringify(this.state)) as SimulatorSnapshot;
  }

  /** Test seam invoked at the persisted accepted-order / not-yet-returned-response crash boundary. */
  setCrashBarrierHandler(handler: (() => void) | undefined): void {
    this.crashBarrierHandler = handler;
  }

  dispatchCounters(): Readonly<Record<Operation, number>> {
    return Object.freeze({ ...this.state.dispatchCounters });
  }

  orders(): readonly SimulatorOrderRecord[] {
    return JSON.parse(JSON.stringify(this.state.orders)) as SimulatorOrderRecord[];
  }

  shipments(providerRequestId: string): readonly SimulatorShipmentRecord[] {
    const order = this.findOrder(providerRequestId);
    return order === undefined ? [] : JSON.parse(JSON.stringify(order.shipments)) as SimulatorShipmentRecord[];
  }

  queueStatusCallback(input: {
    readonly providerRequestId: string;
    readonly status: SimulatorOrderStatus;
    readonly occurredAt?: string;
    readonly delayMs?: number;
  }): string {
    if (!validStatus(input.status) || input.status === "unknown") throw new TypeError("callback status must be authoritative and recognized");
    return this.addCallback({
      kind: "status",
      providerRequestId: requireString(input.providerRequestId, "providerRequestId"),
      status: input.status,
      occurredAt: this.callbackTime(input.occurredAt),
      delayMs: input.delayMs ?? 0
    });
  }

  queueShipmentCallback(input: {
    readonly providerRequestId: string;
    readonly shipment: Omit<SimulatorShipmentRecord, "providerShipmentId"> & { readonly providerShipmentId?: string };
    readonly delayMs?: number;
  }): string {
    const providerRequestId = requireString(input.providerRequestId, "providerRequestId");
    const occurredAt = this.callbackTime(input.shipment.occurredAt);
    const shipmentId = input.shipment.providerShipmentId ?? `sim-shipment-${hashText(`${this.state.seed}|${providerRequestId}|${input.shipment.trackingNumber}|${occurredAt}`).slice(0, 16)}`;
    const shipment: SimulatorShipmentRecord = {
      providerShipmentId: requireString(shipmentId, "providerShipmentId"),
      trackingNumber: requireString(input.shipment.trackingNumber, "trackingNumber"),
      carrier: requireString(input.shipment.carrier, "carrier"),
      occurredAt
    };
    return this.addCallback({
      kind: "shipment",
      providerRequestId,
      shipment,
      occurredAt,
      delayMs: input.delayMs ?? 0
    });
  }

  deliverCallback(eventId: string): SimulatorCallbackDelivery {
    const callback = this.state.callbacks.find((entry) => entry.eventId === eventId);
    if (callback === undefined) return { eventId, outcome: "not_found" };
    callback.deliveryAttempts += 1;
    if (this.state.nowMs < callback.availableAt) return { eventId, outcome: "delayed" };
    if (callback.applied) {
      this.state.duplicateCallbacks += 1;
      return { eventId, outcome: "duplicate" };
    }
    const order = this.findOrder(callback.providerRequestId);
    if (order === undefined) return { eventId, outcome: "not_found" };
    if (callback.kind === "status") {
      const currentRank = ORDER_STATUS_RANK[order.status];
      const nextRank = ORDER_STATUS_RANK[callback.status];
      if (nextRank >= currentRank) {
        order.status = callback.status;
        order.statusOccurredAt = callback.occurredAt;
      }
    } else {
      if (!order.shipments.some((entry) => entry.providerShipmentId === callback.shipment.providerShipmentId)) {
        order.shipments.push({ ...callback.shipment });
        order.shipments.sort((left, right) => left.providerShipmentId.localeCompare(right.providerShipmentId));
      } else {
        this.state.duplicateCallbacks += 1;
      }
      if (ORDER_STATUS_RANK[order.status] < ORDER_STATUS_RANK.shipped) {
        order.status = "shipped";
        order.statusOccurredAt = callback.occurredAt;
      }
    }
    callback.applied = true;
    return { eventId, outcome: "delivered" };
  }

  private callbackTime(candidate?: string): string {
    if (candidate === undefined) return iso(this.state.nowMs);
    const parsed = Date.parse(candidate);
    if (!Number.isFinite(parsed) || Math.abs(parsed) > MAX_DATE_EPOCH_MS) throw new TypeError("callback time must be an ISO-compatible timestamp");
    return iso(parsed);
  }

  private addCallback(input: {
    readonly kind: "status";
    readonly providerRequestId: string;
    readonly status: SimulatorOrderStatus;
    readonly occurredAt: string;
    readonly delayMs: number;
  } | {
    readonly kind: "shipment";
    readonly providerRequestId: string;
    readonly shipment: SimulatorShipmentRecord;
    readonly occurredAt: string;
    readonly delayMs: number;
  }): string {
    if (!Number.isSafeInteger(input.delayMs) || input.delayMs < 0) throw new TypeError("callback delay must be a non-negative safe integer");
    if (this.findOrder(input.providerRequestId) === undefined) throw new TypeError("callbacks require a known synthetic order");
    const sequence = this.state.callbacks.length + 1;
    const content = input.kind === "status" ? input.status : input.shipment;
    const eventId = `sim-event-${hashText(`${this.state.seed}|${sequence}|${input.providerRequestId}|${input.kind}|${canonicalJson(content)}`).slice(0, 16)}`;
    const base = {
      eventId,
      providerRequestId: input.providerRequestId,
      occurredAt: input.occurredAt,
      availableAt: this.state.nowMs + input.delayMs,
      deliveryAttempts: 0,
      applied: false
    };
    if (input.kind === "status") {
      this.state.callbacks.push({ ...base, kind: "status", status: input.status });
    } else {
      this.state.callbacks.push({ ...base, kind: "shipment", shipment: { ...input.shipment } });
    }
    return eventId;
  }

  private createAdapter(): ProviderAdapter {
    const simulator = this;
    return Object.freeze({
      descriptor: this.descriptor,
      async quote(command: QuoteCommand, context: AdapterCallContext): Promise<ProviderResult<QuoteResult>> {
        if (!simulator.contextIsSimulated(context)) return { status: "unsupported" };
        const fault = simulator.takeAdapterFault("quote");
        if (fault === "unsupported") return { status: "unsupported" };
        if (fault === "refuse_before_dispatch") throw new SimulatedProviderError();
        const quantity = requireSafeInteger(command.quantity, 1);
        if (quantity > MAX_QUANTITY) throw new SimulatedProviderError();
        const bundleDigest = simulator.digestOrFail(command.productionBundle);
        const raw = await context.transport.request<unknown>({
          operation: "quote", method: "POST", path: "/simulator/quotes", body: { bundleDigest, quantity }
        });
        return { status: "supported", value: simulator.parseQuote(raw) };
      },
      async preflight(command: PreflightCommand, context: AdapterCallContext): Promise<ProviderResult<PreflightReport>> {
        if (!simulator.contextIsSimulated(context)) return { status: "unsupported" };
        const fault = simulator.takeAdapterFault("preflight");
        if (fault === "unsupported") return { status: "unsupported" };
        if (fault === "refuse_before_dispatch") throw new SimulatedProviderError();
        const bundleDigest = simulator.digestOrFail(command.productionBundle);
        const specificationDigest = simulator.digestOrFail(command.printSpecification);
        const raw = await context.transport.request<unknown>({
          operation: "preflight", method: "POST", path: "/simulator/preflight", body: { bundleDigest, specificationDigest }
        });
        return { status: "supported", value: simulator.parsePreflight(raw) };
      },
      async validateBeforeSubmit(command: SubmitCommand, context: PreSubmitContext): Promise<ProviderResult<PreflightReport>> {
        if (context.mode !== "simulated") return { status: "unsupported" };
        const report = simulator.validateSubmitQuote(command);
        return { status: "supported", value: report };
      },
      async submit(command: SubmitCommand, context: AdapterCallContext): Promise<ProviderResult<SubmitResult>> {
        if (!simulator.contextIsSimulated(context)) return { status: "unsupported" };
        const fault = simulator.takeAdapterFault("submit");
        if (fault === "unsupported") return { status: "unsupported" };
        if (fault === "refuse_before_dispatch") throw new SimulatedProviderError();
        const body = {
          quoteId: requireString(command.quote.quoteId, "quoteId"),
          quoteExpiresAt: requireString(command.quote.expiresAt, "quoteExpiresAt"),
          termsFingerprint: requireString(command.quote.termsFingerprint, "termsFingerprint"),
          productionBundleDigest: requireString(command.productionBundleDigest, "productionBundleDigest"),
          amountMinor: requireSafeInteger(command.amountMinor, 1),
          currency: requireString(command.currency, "currency"),
          requestFingerprint: requireString(command.requestFingerprint, "requestFingerprint")
        };
        const raw = await context.transport.request<unknown>({
          operation: "submit", method: "POST", path: "/simulator/orders", body, idempotencyKey: command.idempotencyKey
        });
        return { status: "supported", value: simulator.parseSubmit(raw) };
      },
      async getStatus(command: StatusCommand, context: AdapterCallContext): Promise<ProviderResult<StatusResult>> {
        if (!simulator.contextIsSimulated(context)) return { status: "unsupported" };
        const fault = simulator.takeAdapterFault("status");
        if (fault === "unsupported") return { status: "unsupported" };
        if (fault === "refuse_before_dispatch") throw new SimulatedProviderError();
        const raw = await context.transport.request<unknown>({
          operation: "status", method: "GET", path: "/simulator/orders/status", body: { providerRequestId: requireString(command.providerRequestId, "providerRequestId") }
        });
        return { status: "supported", value: simulator.parseStatus(raw) };
      },
      async observeShipment(command: ShipmentCommand, context: AdapterCallContext): Promise<ProviderResult<ShipmentResult>> {
        if (!simulator.contextIsSimulated(context)) return { status: "unsupported" };
        const fault = simulator.takeAdapterFault("shipment");
        if (fault === "unsupported") return { status: "unsupported" };
        if (fault === "refuse_before_dispatch") throw new SimulatedProviderError();
        const raw = await context.transport.request<unknown>({
          operation: "shipment", method: "GET", path: "/simulator/orders/shipments", body: { providerRequestId: requireString(command.providerRequestId, "providerRequestId") }
        });
        return { status: "supported", value: simulator.parseShipment(raw) };
      },
      async cancel(command: CancelCommand, context: AdapterCallContext): Promise<ProviderResult<CancelResult>> {
        if (!simulator.contextIsSimulated(context)) return { status: "unsupported" };
        const fault = simulator.takeAdapterFault("cancel");
        if (fault === "unsupported") return { status: "unsupported" };
        if (fault === "refuse_before_dispatch") throw new SimulatedProviderError();
        const raw = await context.transport.request<unknown>({
          operation: "cancel",
          method: "POST",
          path: "/simulator/orders/cancel",
          body: { providerRequestId: requireString(command.providerRequestId, "providerRequestId"), requestFingerprint: requireString(command.requestFingerprint, "requestFingerprint") },
          idempotencyKey: requireString(command.idempotencyKey, "idempotencyKey")
        });
        return { status: "supported", value: simulator.parseCancel(raw) };
      }
    });
  }

  private contextIsSimulated(context: AdapterCallContext): boolean {
    return context.mode === "simulated" && context.transport.mode === "simulated";
  }

  private digestOrFail(value: unknown): string {
    try {
      return simulatorFixtureDigest(value);
    } catch {
      throw new SimulatedProviderError();
    }
  }

  private validateSubmitQuote(command: SubmitCommand): PreflightReport {
    const quote = this.state.quotes.find((entry) => entry.providerQuoteId === command.quote.quoteId);
    if (quote === undefined || Date.parse(quote.expiresAt) <= this.state.nowMs || Date.parse(command.quote.expiresAt) <= this.state.nowMs) {
      return { valid: false, issues: [{ code: "stale_quote", safeMessage: "The local simulated quote is missing or expired." }] };
    }
    if (quote.productionBundleDigest !== command.productionBundleDigest ||
      quote.productionBundleDigest !== command.quote.productionBundleDigest ||
      quote.totalMinor !== command.amountMinor || quote.totalMinor !== command.quote.totalMinor ||
      quote.currency !== command.currency || quote.currency !== command.quote.currency ||
      quote.termsFingerprint !== command.quote.termsFingerprint || quote.expiresAt !== command.quote.expiresAt) {
      return { valid: false, issues: [{ code: "quote_terms_mismatch", safeMessage: "The local simulated quote terms do not match the submission." }] };
    }
    return { valid: true, issues: [] };
  }

  private takeAdapterFault(operation: Operation): "refuse_before_dispatch" | "unsupported" | undefined {
    const index = this.state.faults.findIndex((fault) => fault.operation === operation &&
      (fault.kind === "refuse_before_dispatch" || fault.kind === "unsupported"));
    if (index < 0) return undefined;
    const [fault] = this.state.faults.splice(index, 1);
    if (fault === undefined) return undefined;
    this.state.triggeredFaults.push({ operation: fault.operation, kind: fault.kind });
    return fault.kind === "refuse_before_dispatch" || fault.kind === "unsupported" ? fault.kind : undefined;
  }

  private takeTransportFault(operation: Operation): SimulatorFaultKind | undefined {
    const index = this.state.faults.findIndex((fault) => fault.operation === operation &&
      fault.kind !== "refuse_before_dispatch" && fault.kind !== "unsupported");
    if (index < 0) return undefined;
    const [fault] = this.state.faults.splice(index, 1);
    if (fault === undefined) return undefined;
    this.state.triggeredFaults.push({ operation: fault.operation, kind: fault.kind });
    return fault.kind;
  }

  private async request<T>(request: import("./types.js").ProviderTransportRequest): Promise<T> {
    this.assertLocalRequest(request);
    this.state.dispatchCounters[request.operation] += 1;
    const fault = this.takeTransportFault(request.operation);
    if (fault === "rate_limit") throw new SimulatedProviderError("Simulated provider rate limit.", "RATE_LIMIT", 429);
    let response: unknown;
    switch (request.operation) {
      case "discover_capabilities":
        response = { supported: true };
        break;
      case "quote":
        response = this.quoteResponse(request.body);
        break;
      case "preflight":
        response = this.preflightResponse(request.body);
        break;
      case "submit":
        response = this.submitResponse(request.body, request.idempotencyKey);
        break;
      case "status":
        response = this.statusResponse(request.body, fault === "unknown_status");
        break;
      case "shipment":
        response = this.shipmentResponse(request.body);
        break;
      case "cancel":
        response = this.cancelResponse(request.body, request.idempotencyKey);
        break;
      default:
        throw new SimulatedProviderError();
    }
    if (fault === "accepted_then_timeout") {
      const timeout = new Error("Simulated accepted request timed out.");
      timeout.name = "TimeoutError";
      throw timeout;
    }
    if (fault === "crash_after_acceptance") {
      this.crashBarrierHandler?.();
      const crash = new Error("Simulated process interruption after provider acceptance.");
      crash.name = "SimulatedCrashError";
      throw crash;
    }
    if (fault === "malformed_response") return { malformed: true } as T;
    if (fault === "unknown_status" && request.operation !== "status") throw new SimulatedProviderError();
    return response as T;
  }

  private assertLocalRequest(request: import("./types.js").ProviderTransportRequest): void {
    const routes: Readonly<Record<Operation, readonly [string, string]>> = {
      discover_capabilities: ["GET", "/simulator/capabilities"],
      quote: ["POST", "/simulator/quotes"],
      preflight: ["POST", "/simulator/preflight"],
      submit: ["POST", "/simulator/orders"],
      status: ["GET", "/simulator/orders/status"],
      shipment: ["GET", "/simulator/orders/shipments"],
      cancel: ["POST", "/simulator/orders/cancel"]
    };
    const route = request !== null && typeof request === "object" && validOperation(request.operation) ? routes[request.operation] : undefined;
    if (route === undefined || request.method !== route[0] || request.path !== route[1] || request.path.startsWith("http")) {
      throw new SimulatedProviderError();
    }
  }

  private quoteResponse(body: unknown): QuoteResult {
    if (!isPlainRecord(body)) throw new SimulatedProviderError();
    const productionBundleDigest = requireString(body.bundleDigest, "bundleDigest");
    const quantity = requireSafeInteger(body.quantity, 1);
    if (quantity > MAX_QUANTITY) throw new SimulatedProviderError();
    const existing = this.state.quotes.find((entry) => entry.productionBundleDigest === productionBundleDigest &&
      entry.quantity === quantity && Date.parse(entry.createdAt) === this.state.nowMs);
    if (existing !== undefined) return stableQuote(existing);
    const production = UNIT_PRODUCTION_MINOR * quantity;
    const tax = Math.floor((production * SIMULATED_TAX_BASIS_POINTS + 5_000) / 10_000);
    const totalMinor = production + FLAT_SHIPPING_MINOR + tax;
    if (!Number.isSafeInteger(totalMinor)) throw new SimulatedProviderError();
    const quoteExpiryMs = this.state.nowMs + this.state.quoteTtlMs;
    if (!Number.isSafeInteger(quoteExpiryMs) || quoteExpiryMs > MAX_DATE_EPOCH_MS) throw new SimulatedProviderError();
    const expiresAt = iso(quoteExpiryMs);
    const providerQuoteId = `sim-quote-${hashText(`${this.state.seed}|${productionBundleDigest}|${quantity}|${totalMinor}|${CURRENCY}|${this.state.nowMs}|${this.state.quoteTtlMs}`).slice(0, 20)}`;
    const termsFingerprint = simulatorQuoteTermsFingerprint({
      providerQuoteId, totalMinor, currency: CURRENCY, expiresAt, productionBundleDigest
    });
    const record: SimulatorQuoteRecord = {
      providerQuoteId,
      productionBundleDigest,
      quantity,
      totalMinor,
      currency: CURRENCY,
      termsFingerprint,
      createdAt: iso(this.state.nowMs),
      expiresAt
    };
    this.state.quotes.push(record);
    return stableQuote(record);
  }

  private preflightResponse(body: unknown): PreflightReport {
    if (!isPlainRecord(body) || typeof body.bundleDigest !== "string" || typeof body.specificationDigest !== "string") {
      throw new SimulatedProviderError();
    }
    return { valid: true, issues: [] };
  }

  private submitResponse(body: unknown, idempotencyKey: string | undefined): SubmitResult {
    if (!isPlainRecord(body)) throw new SimulatedProviderError();
    const quoteId = requireString(body.quoteId, "quoteId");
    const quoteExpiresAt = requireString(body.quoteExpiresAt, "quoteExpiresAt");
    const termsFingerprint = requireString(body.termsFingerprint, "termsFingerprint");
    const productionBundleDigest = requireString(body.productionBundleDigest, "productionBundleDigest");
    const amountMinor = requireSafeInteger(body.amountMinor, 1);
    const currency = requireString(body.currency, "currency");
    const requestFingerprint = requireString(body.requestFingerprint, "requestFingerprint");
    const key = requireString(idempotencyKey, "idempotencyKey");
    const quote = this.state.quotes.find((entry) => entry.providerQuoteId === quoteId);
    if (quote === undefined || Date.parse(quote.expiresAt) <= this.state.nowMs || Date.parse(quoteExpiresAt) <= this.state.nowMs) {
      throw new SimulatedProviderError("The simulated quote is stale.", "STALE_QUOTE");
    }
    if (quote.productionBundleDigest !== productionBundleDigest || quote.totalMinor !== amountMinor || quote.currency !== currency ||
      quote.termsFingerprint !== termsFingerprint) {
      throw new SimulatedProviderError("The simulated quote terms differ.", "QUOTE_MISMATCH");
    }
    const keyDigest = hashText(`${this.state.seed}|provider-idempotency|${key}`);
    const requestDigest = hashText(canonicalJson({ quoteId, productionBundleDigest, amountMinor, currency, requestFingerprint }));
    const active = this.state.idempotency.find((entry) => entry.keyDigest === keyDigest && entry.expiresAt > this.state.nowMs);
    if (active !== undefined) {
      if (active.requestDigest !== requestDigest) throw new SimulatedProviderError("The simulated idempotency key conflicts.", "IDEMPOTENCY_CONFLICT");
      this.state.duplicateSubmissions += 1;
      const existingOrder = this.findOrder(active.providerRequestId);
      if (existingOrder === undefined) throw new SimulatedProviderError();
      return { providerRequestId: existingOrder.providerRequestId, acceptedAt: existingOrder.acceptedAt };
    }
    const prior = this.state.idempotency.find((entry) => entry.keyDigest === keyDigest);
    const generation = (prior?.generation ?? 0) + 1;
    const idempotencyExpiry = this.state.nowMs + this.state.idempotencyTtlMs;
    if (!Number.isSafeInteger(idempotencyExpiry)) throw new SimulatedProviderError();
    const providerRequestId = `sim-order-${hashText(`${this.state.seed}|${keyDigest}|${requestDigest}|${generation}`).slice(0, 20)}`;
    const order: SimulatorOrderRecord = {
      providerRequestId,
      quoteId,
      productionBundleDigest,
      requestFingerprintDigest: `sha256:${requestDigest}`,
      amountMinor,
      currency,
      acceptedAt: iso(this.state.nowMs),
      status: "accepted",
      statusOccurredAt: iso(this.state.nowMs),
      shipments: []
    };
    this.state.orders.push(order);
    this.state.idempotency = this.state.idempotency.filter((entry) => entry.keyDigest !== keyDigest);
    this.state.idempotency.push({ keyDigest, requestDigest, providerRequestId, expiresAt: idempotencyExpiry, generation });
    this.state.billingEvidence.push({
      billingMode: "simulated",
      event: "order_accepted",
      providerRequestId,
      amountMinor,
      currency,
      observedAt: iso(this.state.nowMs),
      charged: false
    });
    return { providerRequestId, acceptedAt: order.acceptedAt };
  }

  private statusResponse(body: unknown, forceUnknown: boolean): StatusResult {
    if (!isPlainRecord(body)) throw new SimulatedProviderError();
    const providerRequestId = requireString(body.providerRequestId, "providerRequestId");
    const order = this.findOrder(providerRequestId);
    const normalizedState: SimulatorOrderStatus = forceUnknown || order === undefined ? "unknown" : order.status;
    return {
      providerRequestId,
      providerStatus: normalizedState === "unknown" ? "Unknown" : normalizedState,
      normalizedState,
      observedAt: iso(this.state.nowMs)
    };
  }

  private shipmentResponse(body: unknown): ShipmentResult {
    if (!isPlainRecord(body)) throw new SimulatedProviderError();
    const providerRequestId = requireString(body.providerRequestId, "providerRequestId");
    const order = this.findOrder(providerRequestId);
    const shipment = order?.shipments[0];
    if (shipment === undefined) return { providerRequestId, observedAt: iso(this.state.nowMs) };
    return {
      providerRequestId,
      providerShipmentId: shipment.providerShipmentId,
      trackingNumber: shipment.trackingNumber,
      carrier: shipment.carrier,
      observedAt: iso(this.state.nowMs)
    };
  }

  private cancelResponse(body: unknown, idempotencyKey: string | undefined): CancelResult {
    if (!isPlainRecord(body)) throw new SimulatedProviderError();
    const providerRequestId = requireString(body.providerRequestId, "providerRequestId");
    const key = requireString(idempotencyKey, "idempotencyKey");
    const requestDigest = hashText(canonicalJson({ providerRequestId, requestFingerprint: requireString(body.requestFingerprint, "requestFingerprint") }));
    const keyDigest = hashText(`${this.state.seed}|cancel-idempotency|${key}`);
    const idempotency = this.state.cancelIdempotency.find((entry) => entry.keyDigest === keyDigest && entry.expiresAt > this.state.nowMs);
    if (idempotency !== undefined && idempotency.requestDigest !== requestDigest) {
      throw new SimulatedProviderError("The simulated cancellation key conflicts.", "IDEMPOTENCY_CONFLICT");
    }
    if (idempotency !== undefined) return JSON.parse(JSON.stringify(idempotency.result)) as CancelResult;
    const order = this.findOrder(providerRequestId);
    let outcome: CancelResult["outcome"];
    if (order === undefined) outcome = "not_found";
    else if (["delivered", "cancelled", "failed", "shipped"].includes(order.status)) outcome = "already_terminal";
    else {
      order.status = "cancelled";
      order.statusOccurredAt = iso(this.state.nowMs);
      outcome = "cancelled";
    }
    const result = { providerRequestId, outcome, observedAt: iso(this.state.nowMs) } satisfies CancelResult;
    const prior = this.state.cancelIdempotency.find((entry) => entry.keyDigest === keyDigest);
    const generation = (prior?.generation ?? 0) + 1;
    const idempotencyExpiry = this.state.nowMs + this.state.idempotencyTtlMs;
    if (!Number.isSafeInteger(idempotencyExpiry)) throw new SimulatedProviderError();
    this.state.cancelIdempotency = this.state.cancelIdempotency.filter((entry) => entry.keyDigest !== keyDigest);
    this.state.cancelIdempotency.push({ keyDigest, requestDigest, result, expiresAt: idempotencyExpiry, generation });
    return result;
  }

  private parseQuote(value: unknown): QuoteResult {
    if (!isPlainRecord(value) || !Array.isArray(value.breakdown)) throw new SimulatedProviderError();
    const result = value as unknown as QuoteResult;
    requireString(result.providerQuoteId, "providerQuoteId");
    requireString(result.currency, "currency");
    requireString(result.expiresAt, "expiresAt");
    requireSafeInteger(result.totalMinor, 0);
    if (!Number.isFinite(Date.parse(result.expiresAt)) || !/^[A-Z]{3}$/.test(result.currency)) throw new SimulatedProviderError();
    let sum = 0;
    for (const line of result.breakdown) {
      if (!isPlainRecord(line)) throw new SimulatedProviderError();
      requireString(line.label, "label");
      sum += requireSafeInteger(line.amountMinor, 0);
      if (!Number.isSafeInteger(sum)) throw new SimulatedProviderError();
    }
    if (sum !== result.totalMinor) throw new SimulatedProviderError();
    return JSON.parse(JSON.stringify(result)) as QuoteResult;
  }

  private parsePreflight(value: unknown): PreflightReport {
    if (!isPlainRecord(value) || typeof value.valid !== "boolean" || !Array.isArray(value.issues)) throw new SimulatedProviderError();
    for (const issue of value.issues) {
      if (!isPlainRecord(issue) || typeof issue.code !== "string" || typeof issue.safeMessage !== "string") throw new SimulatedProviderError();
    }
    return JSON.parse(JSON.stringify(value)) as PreflightReport;
  }

  private parseSubmit(value: unknown): SubmitResult {
    if (!isPlainRecord(value)) throw new SimulatedProviderError();
    const providerRequestId = requireString(value.providerRequestId, "providerRequestId");
    const acceptedAt = requireString(value.acceptedAt, "acceptedAt");
    if (!Number.isFinite(Date.parse(acceptedAt))) throw new SimulatedProviderError();
    return { providerRequestId, acceptedAt };
  }

  private parseStatus(value: unknown): StatusResult {
    if (!isPlainRecord(value) || !validStatus(value.normalizedState)) throw new SimulatedProviderError();
    const providerRequestId = requireString(value.providerRequestId, "providerRequestId");
    const providerStatus = requireString(value.providerStatus, "providerStatus");
    const observedAt = requireString(value.observedAt, "observedAt");
    if (!Number.isFinite(Date.parse(observedAt))) throw new SimulatedProviderError();
    return { providerRequestId, providerStatus, normalizedState: value.normalizedState, observedAt };
  }

  private parseShipment(value: unknown): ShipmentResult {
    if (!isPlainRecord(value)) throw new SimulatedProviderError();
    const providerRequestId = requireString(value.providerRequestId, "providerRequestId");
    const observedAt = requireString(value.observedAt, "observedAt");
    if (!Number.isFinite(Date.parse(observedAt))) throw new SimulatedProviderError();
    if (value.providerShipmentId === undefined) return { providerRequestId, observedAt };
    return {
      providerRequestId,
      providerShipmentId: requireString(value.providerShipmentId, "providerShipmentId"),
      trackingNumber: requireString(value.trackingNumber, "trackingNumber"),
      carrier: requireString(value.carrier, "carrier"),
      observedAt
    };
  }

  private parseCancel(value: unknown): CancelResult {
    if (!isPlainRecord(value) || (value.outcome !== "cancelled" && value.outcome !== "already_terminal" && value.outcome !== "not_found")) {
      throw new SimulatedProviderError();
    }
    const providerRequestId = requireString(value.providerRequestId, "providerRequestId");
    const observedAt = requireString(value.observedAt, "observedAt");
    if (!Number.isFinite(Date.parse(observedAt))) throw new SimulatedProviderError();
    return { providerRequestId, outcome: value.outcome, observedAt };
  }

  private findOrder(providerRequestId: string): SimulatorOrderRecord | undefined {
    return this.state.orders.find((order) => order.providerRequestId === providerRequestId);
  }
}

export function createDeterministicSimulator(options: SimulatorOptions): DeterministicSimulator {
  return new DeterministicSimulator(options);
}
