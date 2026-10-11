import {
  evaluateCatalogSelection,
  normalizeCatalogSnapshot,
  type CatalogSnapshot
} from "./catalog.js";
import type { ContractValidator, TrustedScope } from "./types.js";

/** Private FC-04 development output. It is not shared-contracts FulfillmentQuote. */
export const PRIVATE_QUOTE_FORMAT = "connector-development-quote/1" as const;

export type QuoteErrorCode =
  | "missing_input"
  | "invalid_input"
  | "unsupported"
  | "stale_quote"
  | "rate_limit"
  | "timeout"
  | "provider_failure"
  | "provider_response_invalid"
  | "contract_missing"
  | "contract_rejected"
  | "scope_mismatch"
  | "unsupported_schema_major";

const SAFE_MESSAGES: Readonly<Record<QuoteErrorCode, string>> = {
  missing_input: "Required quote inputs are missing.",
  invalid_input: "The quote input did not pass validation.",
  unsupported: "The selected product or option is unsupported.",
  stale_quote: "The selection or quote is stale and needs a fresh quote.",
  rate_limit: "The local quote rate limit prevented this operation.",
  timeout: "The quote operation exceeded its configured time limit.",
  provider_failure: "The quotation provider failed.",
  provider_response_invalid: "The quotation response did not pass validation.",
  contract_missing: "A quote contract binding is required.",
  contract_rejected: "The injected quote contract boundary rejected the result.",
  scope_mismatch: "The quote contract receipt did not match the trusted scope.",
  unsupported_schema_major: "The quote contract schema major version is unsupported."
};

export class QuoteExecutionError extends Error {
  readonly operation = "quote" as const;
  readonly safeMessage: string;

  constructor(readonly code: QuoteErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "QuoteExecutionError";
    this.safeMessage = SAFE_MESSAGES[code];
    Object.freeze(this);
  }

  toJSON(): { operation: "quote"; code: QuoteErrorCode; safeMessage: string } {
    return { operation: this.operation, code: this.code, safeMessage: this.safeMessage };
  }
}

export type QuoteUnknownReason =
  | "not_disclosed"
  | "not_provided"
  | "not_supported"
  | "provider_unspecified"
  | "outside_scope";

export type ProviderAmountInput =
  | { readonly state: "known"; readonly decimal: string }
  | { readonly state: "unknown"; readonly reasonCode: QuoteUnknownReason };

export interface QuoteProviderRequest {
  readonly providerId: string;
  readonly apiVersion: string;
  readonly catalogVersion: string;
  readonly catalogSnapshotIdentity: string;
  readonly catalogContentIdentity: string;
  readonly sku: string;
  readonly variantId: string;
  readonly specIdentity: string;
  readonly selectionDigest: string;
  readonly quantity: number;
  readonly options: readonly string[];
  readonly materials: readonly string[];
  readonly destination: {
    readonly reference: string;
    readonly digest: string;
    readonly countryCode: string;
    readonly regionCode?: string;
  };
  readonly shippingMethod: string;
  readonly personalization: null | {
    readonly mode: string;
    readonly fieldCount: number;
  };
  readonly requestDigest: string;
}

export interface QuoteProviderCallContext {
  readonly operation: "quote";
  readonly signal: AbortSignal;
}

/** This port deliberately has one operation and no submission or payment API. */
export interface BoundedQuotePort {
  quote(request: QuoteProviderRequest, context: QuoteProviderCallContext): Promise<unknown>;
}

export interface QuoteClock {
  now(): number;
}

export interface QuoteExecutionPolicy {
  readonly timeoutMs: number;
  readonly maximumQuotesPerWindow: number;
  readonly rateWindowMs: number;
  readonly localMaximumValidityMs: number;
}

export interface QuoteDependencies {
  readonly quotePort: BoundedQuotePort;
  readonly contracts: ContractValidator;
  readonly clock: QuoteClock;
  readonly trustedScope: TrustedScope;
  readonly policy?: Partial<QuoteExecutionPolicy>;
}

export type ExactMoney = {
  readonly currency: string;
  readonly scale: number;
  readonly decimal: string;
  readonly minorUnits: string;
};

export type QuotedAmount =
  | { readonly state: "known"; readonly value: ExactMoney }
  | { readonly state: "unknown"; readonly reasonCode: QuoteUnknownReason };

export type QuoteLeadTime =
  | { readonly state: "known"; readonly minimumDays: number; readonly maximumDays: number; readonly confidence: "estimate" }
  | { readonly state: "unknown"; readonly reasonCode: QuoteUnknownReason };

export interface PrivateQuoteBinding {
  readonly tenantId: string;
  readonly projectId: string;
  readonly providerId: string;
  readonly apiVersion: string;
  readonly catalogVersion: string;
  readonly catalogSnapshotIdentity: string;
  readonly catalogContentIdentity: string;
  readonly sku: string;
  readonly variantId: string;
  readonly specIdentity: string;
  readonly selectionDigest: string;
  readonly quantity: number;
  readonly options: readonly string[];
  readonly materials: readonly string[];
  readonly destination: {
    readonly reference: string;
    readonly digest: string;
    readonly countryCode: string;
    readonly regionCode?: string;
  };
  readonly shippingMethod: string;
  readonly requestDigest: string;
}

export interface PrivateQuoteSnapshot {
  readonly localFormat: typeof PRIVATE_QUOTE_FORMAT;
  readonly quoteId: string;
  readonly termsFingerprint: string;
  readonly status: "complete" | "incomplete";
  readonly binding: PrivateQuoteBinding;
  readonly catalogEvidenceMode: CatalogSnapshot["source"]["evidenceMode"];
  readonly providerQuoteReference: string;
  readonly createdAt: string;
  readonly expiry: {
    readonly provider: { readonly state: "known"; readonly validUntil: string } | { readonly state: "unknown"; readonly reasonCode: QuoteUnknownReason };
    readonly localPolicy: { readonly version: "quote-local-policy/1"; readonly validUntil: string };
    readonly effectiveValidUntil: string;
    readonly effectiveSource: "provider" | "local_policy" | "provider_and_local_policy";
  };
  readonly currency: string;
  readonly currencyScale: number;
  readonly breakdown: {
    readonly production: QuotedAmount;
    readonly shipping: QuotedAmount;
    readonly tax: QuotedAmount;
    readonly fee: QuotedAmount;
    readonly total: QuotedAmount;
    readonly taxBasis: "included" | "excluded" | "unknown";
    readonly reconciliation:
      | { readonly state: "reconciled"; readonly expectedTotal: ExactMoney }
      | { readonly state: "incomplete"; readonly missing: readonly string[] };
  };
  readonly leadTime: QuoteLeadTime;
  readonly warnings: readonly string[];
  readonly providerNotes: readonly string[];
  readonly financialEffect: "quote_only";
}

export interface PrivateQuoteResponse {
  readonly quote: PrivateQuoteSnapshot;
  readonly sharedPayload: unknown;
  readonly contractBinding: {
    readonly state: "development_fixture" | "accepted";
    readonly schemaVersion: string;
    readonly sourceRevision?: string;
    readonly fixtureDigest: string;
  };
}

export type QuoteCurrentReason =
  | "quote_integrity_invalid"
  | "quote_expired"
  | "quote_incomplete"
  | "trusted_scope_changed"
  | "catalog_changed"
  | "catalog_stale"
  | "selection_changed"
  | "destination_changed"
  | "request_changed"
  | "selection_ineligible";

export type QuoteRequiredAction =
  | "refresh_catalog"
  | "revalidate_selection"
  | "requote"
  | "obtain_external_authorization"
  | "renew_external_authorization";

export interface QuoteCurrentEvaluation {
  readonly status: "current" | "stale" | "incomplete" | "invalid";
  readonly reasons: readonly QuoteCurrentReason[];
  readonly requiredActions: readonly QuoteRequiredAction[];
  readonly quoteMayBePresentedForExternalReview: boolean;
}

const SAFE_TREE_MAX_NODES = 20_000;
const SAFE_TREE_MAX_DEPTH = 20;
const SAFE_STRING_MAX = 4_096;
const SAFE_TOTAL_BYTES = 1_000_000;
const MAX_QUANTITY = 1_000_000;
const MAX_AMOUNT_INTEGER_DIGITS = 14;
const MAX_AMOUNT_SCALE = 6;
const UNKNOWN_REASONS = new Set<QuoteUnknownReason>([
  "not_disclosed", "not_provided", "not_supported", "provider_unspecified", "outside_scope"
]);
const OPAQUE_REFERENCE = /^[A-Za-z][A-Za-z0-9._+-]{0,31}:[A-Za-z0-9][A-Za-z0-9._:/#-]{0,223}$/u;
const SCHEMA_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u;
const FORBIDDEN_KEY = /(?:address|email|phone|street|recipient|customer|contact|postal.?code|zip.?code|password|secret|token|credential|api.?key|signed.?url)/iu;
const EMAIL_OR_URL = /(?:https?:\/\/|\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b)/iu;
const PHONE_LIKE = /(?:^|\D)\+?\d[\d\s().-]{8,}\d(?:\D|$)/u;
const OPAQUE_QUOTE_ID = /^quote:sha256:[a-f0-9]{64}$/u;
const ADDRESS_LIKE = /\b\d{1,6}\s+[A-Za-z0-9.' -]{2,64}\s(?:street|st|road|rd|avenue|ave|boulevard|blvd|lane|ln|drive|dr)\b/iu;
const SECRET_LIKE = /(?:\bbearer\s+[A-Za-z0-9._~-]{8,}|\bsk-[A-Za-z0-9_-]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----)/iu;

function invalid(code: QuoteErrorCode = "invalid_input"): never {
  throw new QuoteExecutionError(code);
}

function safeTree(value: unknown, depth = 0, seen = new WeakSet<object>(), budget = { nodes: 0, bytes: 0 }): unknown {
  budget.nodes += 1;
  if (budget.nodes > SAFE_TREE_MAX_NODES || depth > SAFE_TREE_MAX_DEPTH) return invalid();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > SAFE_STRING_MAX || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) return invalid();
    budget.bytes += new TextEncoder().encode(value).byteLength;
    if (budget.bytes > SAFE_TOTAL_BYTES) return invalid();
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return invalid();
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value) || value.length > 2_000) return invalid();
    seen.add(value);
    const copy: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return invalid();
      copy.push(safeTree(descriptor.value, depth + 1, seen, budget));
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length) return invalid();
    }
    seen.delete(value);
    return Object.freeze(copy);
  }
  if (typeof value !== "object") return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  if (seen.has(value)) return invalid();
  seen.add(value);
  const keys = Reflect.ownKeys(value);
  if (keys.length > 1_000) return invalid();
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0 || key.length > 128) return invalid();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return invalid();
    Object.defineProperty(copy, key, {
      value: safeTree(descriptor.value, depth + 1, seen, budget),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  seen.delete(value);
  return Object.freeze(copy);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) return invalid();
}

function requiredKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  if (expected.some((key) => !Object.hasOwn(value, key))) return invalid("missing_input");
  exactKeys(value, expected);
}

function ownValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return invalid("missing_input");
  return descriptor.value;
}

function dependencyValue<T>(value: unknown, key: string): T {
  if (value === null || typeof value !== "object") return invalid("missing_input");
  try {
    return ownValue(value, key) as T;
  } catch {
    return invalid("missing_input");
  }
}

function optionalDependencyValue<T>(value: unknown, key: string): T | undefined {
  if (value === null || typeof value !== "object") return invalid("missing_input");
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) return undefined;
    if (!("value" in descriptor) || descriptor.enumerable !== true) return invalid("missing_input");
    return descriptor.value as T;
  } catch {
    return invalid("missing_input");
  }
}

function captureMethod(target: unknown, key: string): (...args: unknown[]) => unknown {
  try {
    if ((typeof target !== "object" && typeof target !== "function") || target === null) return invalid("missing_input");
    let current: object | null = target as object;
    for (let depth = 0; current !== null && depth < 16; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor !== undefined) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") return invalid("missing_input");
        const method = descriptor.value as (...args: unknown[]) => unknown;
        return (...args: unknown[]) => Reflect.apply(method, target, args);
      }
      current = Object.getPrototypeOf(current) as object | null;
    }
  } catch {
    return invalid("missing_input");
  }
  return invalid("missing_input");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(",")}]`;
  const object = value as Record<string, unknown>;
  const keys = Object.keys(object).sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
}

async function digest(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableJson(value));
  if (bytes.byteLength > SAFE_TOTAL_BYTES * 4) return invalid();
  try {
    const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${Array.from(new Uint8Array(hash), (part) => part.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return invalid("provider_failure");
  }
}

function canonicalTimestamp(value: unknown): { readonly text: string; readonly epochMs: number } {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return invalid();
  const epochMs = Date.parse(value);
  if (!Number.isSafeInteger(epochMs) || new Date(epochMs).toISOString() !== value) return invalid();
  return { text: value, epochMs };
}

function safeText(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum || value.trim() !== value ||
      /[\u0000-\u001F\u007F]/u.test(value) || EMAIL_OR_URL.test(value) || PHONE_LIKE.test(value) ||
      ADDRESS_LIKE.test(value) || SECRET_LIKE.test(value)) return invalid("provider_response_invalid");
  return value;
}

function safeReference(value: unknown): string {
  const result = safeText(value, 256);
  if (!OPAQUE_REFERENCE.test(result)) return invalid("provider_response_invalid");
  return result;
}

function safeDigest(value: unknown): string {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value)) return invalid("invalid_input");
  return value;
}

function safeCode(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9._:/+-]{0,127}$/u.test(value)) return invalid("provider_response_invalid");
  return value;
}

function safeUnknownReason(value: unknown): QuoteUnknownReason {
  if (typeof value !== "string" || !UNKNOWN_REASONS.has(value as QuoteUnknownReason)) return invalid("provider_response_invalid");
  return value as QuoteUnknownReason;
}

function snapshotScope(value: unknown): TrustedScope {
  const scope = record(safeTree(value));
  exactKeys(scope, ["tenantId", "projectId"]);
  const tenantId = safeText(scope.tenantId, 128);
  const projectId = safeText(scope.projectId, 128);
  if (tenantId.length === 0 || projectId.length === 0) return invalid("scope_mismatch");
  return Object.freeze({ tenantId, projectId });
}

function quotePolicy(value: unknown): QuoteExecutionPolicy {
  const defaults: QuoteExecutionPolicy = {
    timeoutMs: 5_000,
    maximumQuotesPerWindow: 10,
    rateWindowMs: 1_000,
    localMaximumValidityMs: 5 * 60_000
  };
  if (value === undefined) return Object.freeze(defaults);
  const input = record(safeTree(value));
  const keys = Object.keys(input);
  if (keys.some((key) => !["timeoutMs", "maximumQuotesPerWindow", "rateWindowMs", "localMaximumValidityMs"].includes(key))) return invalid();
  const result: QuoteExecutionPolicy = {
    timeoutMs: input.timeoutMs === undefined ? defaults.timeoutMs : input.timeoutMs as number,
    maximumQuotesPerWindow: input.maximumQuotesPerWindow === undefined ? defaults.maximumQuotesPerWindow : input.maximumQuotesPerWindow as number,
    rateWindowMs: input.rateWindowMs === undefined ? defaults.rateWindowMs : input.rateWindowMs as number,
    localMaximumValidityMs: input.localMaximumValidityMs === undefined ? defaults.localMaximumValidityMs : input.localMaximumValidityMs as number
  };
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs < 1 || result.timeoutMs > 30_000 ||
      !Number.isSafeInteger(result.maximumQuotesPerWindow) || result.maximumQuotesPerWindow < 1 || result.maximumQuotesPerWindow > 100 ||
      !Number.isSafeInteger(result.rateWindowMs) || result.rateWindowMs < 100 || result.rateWindowMs > 60_000 ||
      !Number.isSafeInteger(result.localMaximumValidityMs) || result.localMaximumValidityMs < 1_000 || result.localMaximumValidityMs > 86_400_000) return invalid();
  return Object.freeze(result);
}

function readNow(clock: unknown): { readonly text: string; readonly epochMs: number } {
  const nowMethod = captureMethod(clock, "now");
  let result: unknown;
  try {
    result = Reflect.apply(nowMethod, clock, []);
  } catch {
    return invalid("invalid_input");
  }
  if (!Number.isSafeInteger(result) || (result as number) < 0 || (result as number) > 253_402_300_799_999) return invalid("invalid_input");
  return canonicalTimestamp(new Date(result as number).toISOString());
}

interface RateState {
  readonly policySignature: string;
  readonly timestamps: number[];
}

const rateStates = new WeakMap<object, RateState>();

function consumeRateLimit(port: unknown, policy: QuoteExecutionPolicy, now: number): void {
  if ((typeof port !== "object" && typeof port !== "function") || port === null) return invalid("missing_input");
  const signature = `${policy.maximumQuotesPerWindow}/${policy.rateWindowMs}`;
  let state = rateStates.get(port as object);
  if (state === undefined) {
    state = { policySignature: signature, timestamps: [] };
    rateStates.set(port as object, state);
  } else if (state.policySignature !== signature) {
    return invalid();
  }
  const last = state.timestamps[state.timestamps.length - 1];
  if (last !== undefined && now < last) return invalid("invalid_input");
  const cutoff = now - policy.rateWindowMs;
  while (state.timestamps.length > 0 && state.timestamps[0]! <= cutoff) state.timestamps.shift();
  if (state.timestamps.length >= policy.maximumQuotesPerWindow) return invalid("rate_limit");
  state.timestamps.push(now);
}

function parseRequest(value: unknown): Record<string, unknown> {
  const request = record(safeTree(value));
  requiredKeys(request, ["catalogSource", "selection", "quantity", "destinationReference", "destinationDigest"]);
  return request;
}

function safeDestinationReference(value: unknown): string {
  const result = safeText(value, 256);
  if (!OPAQUE_REFERENCE.test(result)) return invalid("invalid_input");
  return result;
}

function amountInput(value: unknown): { readonly state: "known"; readonly decimal: string } | { readonly state: "unknown"; readonly reasonCode: QuoteUnknownReason } {
  const amount = record(value);
  if (amount.state === "known") {
    exactKeys(amount, ["state", "decimal"]);
    if (typeof amount.decimal !== "string") return invalid("provider_response_invalid");
    return { state: "known", decimal: amount.decimal };
  }
  if (amount.state === "unknown") {
    exactKeys(amount, ["state", "reasonCode"]);
    return { state: "unknown", reasonCode: safeUnknownReason(amount.reasonCode) };
  }
  return invalid("provider_response_invalid");
}

function normalizeAmount(value: unknown, currency: string, scale: number): QuotedAmount {
  const input = amountInput(value);
  if (input.state === "unknown") return Object.freeze({ state: "unknown", reasonCode: input.reasonCode });
  const decimal = input.decimal;
  const pattern = new RegExp(`^(?:0|[1-9]\\d{0,${MAX_AMOUNT_INTEGER_DIGITS - 1}})(?:\\.\\d{1,${MAX_AMOUNT_SCALE}})?$`, "u");
  if (!pattern.test(decimal)) return invalid("provider_response_invalid");
  const [whole = "0", fraction = ""] = decimal.split(".");
  if (fraction.length > scale) return invalid("provider_response_invalid");
  const normalizedFraction = fraction.padEnd(scale, "0");
  const normalized = scale === 0 ? whole : `${whole}.${normalizedFraction}`;
  const minorUnits = BigInt(whole) * (10n ** BigInt(scale)) + BigInt(normalizedFraction || "0");
  const moneyValue: ExactMoney = Object.freeze({ currency, scale, decimal: normalized, minorUnits: minorUnits.toString() });
  return Object.freeze({ state: "known", value: moneyValue });
}

function knownMinor(value: QuotedAmount): bigint | undefined {
  return value.state === "known" ? BigInt(value.value.minorUnits) : undefined;
}

function normalizeLeadTime(value: unknown): QuoteLeadTime {
  const input = record(value);
  if (input.state === "unknown") {
    exactKeys(input, ["state", "reasonCode"]);
    return Object.freeze({ state: "unknown", reasonCode: safeUnknownReason(input.reasonCode) });
  }
  if (input.state !== "known") return invalid("provider_response_invalid");
  exactKeys(input, ["state", "minimumDays", "maximumDays"]);
  const minimumDays = input.minimumDays;
  const maximumDays = input.maximumDays;
  if (!Number.isSafeInteger(minimumDays) || !Number.isSafeInteger(maximumDays) ||
      (minimumDays as number) < 0 || (maximumDays as number) < (minimumDays as number) || (maximumDays as number) > 3_650) return invalid("provider_response_invalid");
  return Object.freeze({ state: "known", minimumDays: minimumDays as number, maximumDays: maximumDays as number, confidence: "estimate" });
}

function normalizeTextList(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 32) return invalid("provider_response_invalid");
  const values = value.map((item) => safeText(item, 512));
  return Object.freeze(values);
}

function normalizeProviderExpiry(value: unknown): PrivateQuoteSnapshot["expiry"]["provider"] {
  const input = record(value);
  if (input.state === "unknown") {
    exactKeys(input, ["state", "reasonCode"]);
    return Object.freeze({ state: "unknown", reasonCode: safeUnknownReason(input.reasonCode) });
  }
  if (input.state === "known") {
    exactKeys(input, ["state", "validUntil"]);
    const timestamp = canonicalTimestamp(input.validUntil);
    return Object.freeze({ state: "known", validUntil: timestamp.text });
  }
  return invalid("provider_response_invalid");
}

async function normalizeProviderQuote(value: unknown, createdAt: string, policy: QuoteExecutionPolicy): Promise<{
  readonly providerQuoteReference: string;
  readonly expiry: PrivateQuoteSnapshot["expiry"];
  readonly currency: string;
  readonly currencyScale: number;
  readonly breakdown: PrivateQuoteSnapshot["breakdown"];
  readonly leadTime: QuoteLeadTime;
  readonly warnings: readonly string[];
  readonly providerNotes: readonly string[];
  readonly termsFingerprint: string;
  readonly status: "complete" | "incomplete";
}> {
  let input: Record<string, unknown>;
  try {
    input = record(safeTree(value));
  } catch {
    return invalid("provider_response_invalid");
  }
  exactKeys(input, ["providerQuoteReference", "currency", "currencyScale", "breakdown", "taxBasis", "total", "providerExpiry", "leadTime", "warnings", "providerNotes"]);
  const providerQuoteReference = safeReference(input.providerQuoteReference);
  const currency = input.currency;
  const currencyScale = input.currencyScale;
  if (typeof currency !== "string" || !/^[A-Z]{3}$/u.test(currency) || !Number.isSafeInteger(currencyScale) ||
      (currencyScale as number) < 0 || (currencyScale as number) > MAX_AMOUNT_SCALE) return invalid("provider_response_invalid");
  const scale = currencyScale as number;
  const rawBreakdown = record(input.breakdown);
  exactKeys(rawBreakdown, ["production", "shipping", "tax", "fee"]);
  const production = normalizeAmount(rawBreakdown.production, currency, scale);
  const shipping = normalizeAmount(rawBreakdown.shipping, currency, scale);
  const tax = normalizeAmount(rawBreakdown.tax, currency, scale);
  const fee = normalizeAmount(rawBreakdown.fee, currency, scale);
  const total = normalizeAmount(input.total, currency, scale);
  const taxBasis = input.taxBasis;
  if (taxBasis !== "included" && taxBasis !== "excluded" && taxBasis !== "unknown") return invalid("provider_response_invalid");
  const totalMinor = knownMinor(total);
  const productionMinor = knownMinor(production);
  const shippingMinor = knownMinor(shipping);
  const feeMinor = knownMinor(fee);
  const taxMinor = knownMinor(tax);
  const missing: string[] = [];
  if (totalMinor === undefined) missing.push("total");
  if (productionMinor === undefined) missing.push("production");
  if (shippingMinor === undefined) missing.push("shipping");
  if (feeMinor === undefined) missing.push("fee");
  if (taxBasis === "unknown") missing.push("tax_basis");
  if (taxBasis === "excluded" && taxMinor === undefined) missing.push("tax");
  let reconciliation: PrivateQuoteSnapshot["breakdown"]["reconciliation"];
  if (missing.length > 0) {
    reconciliation = Object.freeze({ state: "incomplete", missing: Object.freeze([...new Set(missing)]) });
  } else {
    const expected = productionMinor! + shippingMinor! + feeMinor! + (taxBasis === "excluded" ? taxMinor! : 0n);
    if (expected !== totalMinor) return invalid("provider_response_invalid");
    reconciliation = Object.freeze({
      state: "reconciled",
      expectedTotal: Object.freeze({ currency, scale, decimal: (total as Extract<QuotedAmount, { state: "known" }>).value.decimal, minorUnits: expected.toString() })
    });
  }
  const breakdown = Object.freeze({ production, shipping, tax, fee, total, taxBasis, reconciliation });
  const leadTime = normalizeLeadTime(input.leadTime);
  const warnings = normalizeTextList(input.warnings);
  const providerNotes = normalizeTextList(input.providerNotes);
  const created = canonicalTimestamp(createdAt);
  const providerExpiry = normalizeProviderExpiry(input.providerExpiry);
  if (providerExpiry.state === "known" && Date.parse(providerExpiry.validUntil) <= created.epochMs) return invalid("provider_response_invalid");
  const localExpiryMs = created.epochMs + policy.localMaximumValidityMs;
  if (!Number.isSafeInteger(localExpiryMs) || localExpiryMs > 253_402_300_799_999) return invalid("provider_response_invalid");
  const localValidUntil = new Date(localExpiryMs).toISOString();
  let effectiveValidUntil = localValidUntil;
  let effectiveSource: PrivateQuoteSnapshot["expiry"]["effectiveSource"] = "local_policy";
  if (providerExpiry.state === "known") {
    const providerMs = Date.parse(providerExpiry.validUntil);
    if (providerMs < localExpiryMs) {
      effectiveValidUntil = providerExpiry.validUntil;
      effectiveSource = "provider";
    } else if (providerMs === localExpiryMs) {
      effectiveValidUntil = providerExpiry.validUntil;
      effectiveSource = "provider_and_local_policy";
    }
  }
  const expiry = Object.freeze({
    provider: providerExpiry,
    localPolicy: Object.freeze({ version: "quote-local-policy/1" as const, validUntil: localValidUntil }),
    effectiveValidUntil,
    effectiveSource
  });
  const status: "complete" | "incomplete" =
    production.state === "known" && shipping.state === "known" && tax.state === "known" && fee.state === "known" &&
    total.state === "known" && taxBasis !== "unknown" && reconciliation.state === "reconciled"
      ? "complete"
      : "incomplete";
  const termsFingerprint = await digest({
    providerQuoteReference, currency, currencyScale: scale, breakdown, expiry, leadTime, warnings, providerNotes
  });
  return { providerQuoteReference, expiry, currency, currencyScale: scale, breakdown, leadTime, warnings, providerNotes, termsFingerprint, status };
}

function contractBinding(validator: unknown, scope: TrustedScope): {
  readonly state: "development_fixture" | "accepted";
  readonly schemaVersion: string;
  readonly sourceRevision?: string;
  readonly fixtureDigest: string;
  readonly validateOutbound: (...args: unknown[]) => unknown;
} {
  const bindingMethod = captureMethod(validator, "binding");
  const validateOutbound = captureMethod(validator, "validateOutbound");
  let rawBinding: unknown;
  try {
    rawBinding = Reflect.apply(bindingMethod, validator, ["fulfillment_quote"]);
  } catch {
    return invalid("contract_missing");
  }
  const binding = record(safeTree(rawBinding));
  const allowedKeys = ["shape", "ownerRepository", "upstreamIssue", "state", "schemaVersion", "sourceRevision", "fixtureDigest"];
  if (Object.keys(binding).some((key) => !allowedKeys.includes(key))) return invalid("contract_missing");
  if (binding.shape !== "fulfillment_quote" || binding.ownerRepository !== "shared-contracts" || binding.upstreamIssue !== "#25" ||
      (binding.state !== "development_fixture" && binding.state !== "accepted") ||
      typeof binding.schemaVersion !== "string" || SCHEMA_VERSION.exec(binding.schemaVersion) === null ||
      typeof binding.fixtureDigest !== "string" || binding.fixtureDigest.trim() === "") return invalid("contract_missing");
  if (binding.state === "accepted") {
    if (typeof binding.sourceRevision !== "string" || binding.sourceRevision.trim() === "") return invalid("contract_missing");
  } else if (binding.sourceRevision !== undefined) {
    return invalid("contract_missing");
  }
  return Object.freeze({
    state: binding.state,
    schemaVersion: binding.schemaVersion,
    ...(typeof binding.sourceRevision === "string" ? { sourceRevision: binding.sourceRevision } : {}),
    fixtureDigest: binding.fixtureDigest,
    validateOutbound
  });
}

function validateBoundaryReceipt(value: unknown, binding: ReturnType<typeof contractBinding>, scope: TrustedScope): unknown {
  const result = record(safeTree(value));
  if (result.ok !== true) {
    if (result.ok === false) {
      const failure = record(result.failure);
      if (failure.code === "scope_mismatch") return invalid("scope_mismatch");
      if (failure.code === "unsupported_schema_major") return invalid("unsupported_schema_major");
      return invalid("contract_rejected");
    }
    return invalid("contract_rejected");
  }
  exactKeys(result, ["ok", "value", "receipts"]);
  if (!Array.isArray(result.receipts) || result.receipts.length !== 1) return invalid("contract_rejected");
  const receipt = record(result.receipts[0]);
  exactKeys(receipt, ["shape", "schemaVersion", "tenantId", "projectId"]);
  if (receipt.shape !== "fulfillment_quote" || receipt.tenantId !== scope.tenantId || receipt.projectId !== scope.projectId) return invalid("scope_mismatch");
  if (typeof receipt.schemaVersion !== "string") return invalid("contract_rejected");
  const receiptVersion = SCHEMA_VERSION.exec(receipt.schemaVersion);
  const bindingVersion = SCHEMA_VERSION.exec(binding.schemaVersion);
  if (receiptVersion === null || bindingVersion === null) return invalid("contract_rejected");
  if (receiptVersion[1] !== bindingVersion[1]) return invalid("unsupported_schema_major");
  if (receipt.schemaVersion !== binding.schemaVersion && binding.state === "accepted") return invalid("contract_rejected");
  const payload = safeTree(result.value);
  ensurePrivacySafe(payload);
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return invalid("contract_rejected");
  return payload;
}

function ensurePrivacySafe(value: unknown, depth = 0): void {
  if (depth > SAFE_TREE_MAX_DEPTH) return invalid("contract_rejected");
  if (typeof value === "string") {
    if (OPAQUE_QUOTE_ID.test(value)) return;
    if (EMAIL_OR_URL.test(value) || PHONE_LIKE.test(value) || ADDRESS_LIKE.test(value) || SECRET_LIKE.test(value)) return invalid("contract_rejected");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) ensurePrivacySafe(item, depth + 1);
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_KEY.test(key)) return invalid("contract_rejected");
      ensurePrivacySafe(child, depth + 1);
    }
  }
}

async function prepareBoundInput(input: unknown, scopeValue: unknown, now: string): Promise<{
  readonly snapshot: CatalogSnapshot;
  readonly selection: Record<string, unknown>;
  readonly binding: PrivateQuoteBinding;
}> {
  const request = parseRequest(input);
  const quantity = request.quantity;
  if (!Number.isSafeInteger(quantity) || (quantity as number) < 1 || (quantity as number) > MAX_QUANTITY) return invalid("invalid_input");
  const scope = snapshotScope(scopeValue);
  let snapshot: CatalogSnapshot;
  try {
    snapshot = await normalizeCatalogSnapshot(request.catalogSource);
  } catch (error) {
    if (error instanceof QuoteExecutionError) throw error;
    return invalid("invalid_input");
  }
  const rawSelection = record(safeTree(request.selection));
  if (rawSelection.snapshotIdentity !== snapshot.snapshotIdentity || rawSelection.catalogContentIdentity !== snapshot.catalogContentIdentity) return invalid("stale_quote");
  const evaluated = evaluateCatalogSelection(snapshot, rawSelection, now);
  if (evaluated.status !== "eligible" || evaluated.eligible !== true) {
    if (evaluated.reasons.includes("catalog_stale") || evaluated.reasons.includes("sku_removed") || evaluated.reasons.includes("sku_not_found") || evaluated.reasons.includes("spec_identity_changed")) return invalid("stale_quote");
    if (evaluated.reasons.includes("unsupported_mandatory_constraint") || evaluated.reasons.includes("unknown_mandatory_constraint") ||
        evaluated.details.some((detail) => detail.includes("unsupported") || detail.includes("unknown"))) return invalid("unsupported");
    return invalid("invalid_input");
  }
  const product = snapshot.products.find((entry) => entry.sku === rawSelection.sku && entry.variantId === rawSelection.variantId);
  if (product === undefined || product.availability !== "available" || product.specIdentity !== rawSelection.specIdentity) return invalid("stale_quote");
  const destinationSelection = record(rawSelection.destination);
  const destinationReference = safeDestinationReference(request.destinationReference);
  const destinationDigest = safeDigest(request.destinationDigest);
  const destination = Object.freeze({
    reference: destinationReference,
    digest: destinationDigest,
    countryCode: destinationSelection.countryCode as string,
    ...(destinationSelection.regionCode === undefined ? {} : { regionCode: destinationSelection.regionCode as string })
  });
  const selectionDigest = await digest(rawSelection);
  const bindingCore = {
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    providerId: snapshot.providerId,
    apiVersion: snapshot.apiVersion,
    catalogVersion: snapshot.catalogVersion,
    catalogSnapshotIdentity: snapshot.snapshotIdentity,
    catalogContentIdentity: snapshot.catalogContentIdentity,
    sku: rawSelection.sku as string,
    variantId: rawSelection.variantId as string,
    specIdentity: rawSelection.specIdentity as string,
    selectionDigest,
    quantity: quantity as number,
    options: Object.freeze([...(rawSelection.options as readonly string[])]),
    materials: Object.freeze([...(rawSelection.materials as readonly string[])]),
    destination,
    shippingMethod: rawSelection.shippingMethod as string
  };
  const requestDigest = await digest(bindingCore);
  const binding: PrivateQuoteBinding = Object.freeze({ ...bindingCore, requestDigest });
  return { snapshot, selection: rawSelection, binding };
}

function quoteMethod(port: unknown): (...args: unknown[]) => unknown {
  return captureMethod(port, "quote");
}

function classifyProviderFailure(error: unknown): QuoteErrorCode {
  try {
    if (error !== null && (typeof error === "object" || typeof error === "function")) {
      const status = Object.getOwnPropertyDescriptor(error, "status");
      const code = Object.getOwnPropertyDescriptor(error, "code");
      if (status !== undefined && "value" in status && status.value === 429) return "rate_limit";
      if (code !== undefined && "value" in code && typeof code.value === "string" && ["RATE_LIMIT", "RATE_LIMITED"].includes(code.value.toUpperCase())) return "rate_limit";
    }
  } catch {
    return "provider_failure";
  }
  return "provider_failure";
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Validates a private catalog selection, invokes one bounded quote-only port,
 * normalizes exact decimal amounts, and delegates canonical encoding to the
 * injected shared-contract boundary. No order, payment, or budget operation is reachable here.
 */
export async function executePrivateQuote(input: unknown, dependencies: QuoteDependencies): Promise<PrivateQuoteResponse> {
  try {
    const nowBeforeCall = readNow(dependencyValue(dependencies, "clock"));
    const policy = quotePolicy(optionalDependencyValue(dependencies, "policy"));
    const contracts = dependencyValue<ContractValidator>(dependencies, "contracts");
    const validatorBinding = contractBinding(contracts, snapshotScope(dependencyValue(dependencies, "trustedScope")));
    const scope = snapshotScope(dependencyValue(dependencies, "trustedScope"));
    const prepared = await prepareBoundInput(input, scope, nowBeforeCall.text);
    const port = dependencyValue<BoundedQuotePort>(dependencies, "quotePort");
    const method = quoteMethod(port);
    consumeRateLimit(port, policy, nowBeforeCall.epochMs);
    const requestWithoutDigest = {
      providerId: prepared.binding.providerId,
      apiVersion: prepared.binding.apiVersion,
      catalogVersion: prepared.binding.catalogVersion,
      catalogSnapshotIdentity: prepared.binding.catalogSnapshotIdentity,
      catalogContentIdentity: prepared.binding.catalogContentIdentity,
      sku: prepared.binding.sku,
      variantId: prepared.binding.variantId,
      specIdentity: prepared.binding.specIdentity,
      selectionDigest: prepared.binding.selectionDigest,
      quantity: prepared.binding.quantity,
      options: prepared.binding.options,
      materials: prepared.binding.materials,
      destination: prepared.binding.destination,
      shippingMethod: prepared.binding.shippingMethod,
      personalization: prepared.selection.personalization === null ? null : Object.freeze({
        mode: record(prepared.selection.personalization).mode as string,
        fieldCount: (record(prepared.selection.personalization).fields as readonly unknown[]).length
      })
    };
    const providerInput: QuoteProviderRequest = Object.freeze({ ...requestWithoutDigest, requestDigest: prepared.binding.requestDigest });
    const controller = new AbortController();
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort();
        reject(new QuoteExecutionError("timeout"));
      }, policy.timeoutMs);
    });
    let rawProviderResult: unknown;
    try {
      rawProviderResult = await Promise.race([
        Promise.resolve(Reflect.apply(method, port, [providerInput, Object.freeze({ operation: "quote" as const, signal: controller.signal })])),
        timeout
      ]);
    } catch (error) {
      if (error instanceof QuoteExecutionError) throw error;
      throw new QuoteExecutionError(classifyProviderFailure(error));
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    }
    const createdAt = readNow(dependencyValue(dependencies, "clock")).text;
    let normalized: Awaited<ReturnType<typeof normalizeProviderQuote>>;
    try {
      normalized = await normalizeProviderQuote(rawProviderResult, createdAt, policy);
    } catch (error) {
      if (error instanceof QuoteExecutionError && (error.code === "invalid_input" || error.code === "missing_input")) {
        throw new QuoteExecutionError("provider_response_invalid");
      }
      throw error;
    }
    const terms = {
      providerQuoteReference: normalized.providerQuoteReference,
      currency: normalized.currency,
      currencyScale: normalized.currencyScale,
      breakdown: normalized.breakdown,
      expiry: normalized.expiry,
      leadTime: normalized.leadTime,
      warnings: normalized.warnings,
      providerNotes: normalized.providerNotes
    };
    const body = {
      localFormat: PRIVATE_QUOTE_FORMAT,
      termsFingerprint: normalized.termsFingerprint,
      status: normalized.status,
      binding: prepared.binding,
      catalogEvidenceMode: prepared.snapshot.source.evidenceMode,
      providerQuoteReference: normalized.providerQuoteReference,
      createdAt,
      expiry: normalized.expiry,
      currency: normalized.currency,
      currencyScale: normalized.currencyScale,
      breakdown: normalized.breakdown,
      leadTime: normalized.leadTime,
      warnings: normalized.warnings,
      providerNotes: normalized.providerNotes,
      financialEffect: "quote_only" as const
    };
    const termsFingerprint = await digest(terms);
    if (termsFingerprint !== normalized.termsFingerprint) return invalid("provider_response_invalid");
    const quoteId = `quote:${await digest(body)}`;
    const quote = deepFreeze({ ...body, quoteId }) as PrivateQuoteSnapshot;
    const outboundRequest = Object.freeze({
      operation: "quote" as const,
      requiredShapes: Object.freeze(["fulfillment_quote" as const]),
      value: quote,
      trustedScope: scope
    });
    let boundaryResult: unknown;
    try {
      boundaryResult = await Reflect.apply(validatorBinding.validateOutbound, contracts, [outboundRequest]);
    } catch {
      return invalid("contract_rejected");
    }
    const sharedPayload = validateBoundaryReceipt(boundaryResult, validatorBinding, scope);
    return deepFreeze({
      quote,
      sharedPayload,
      contractBinding: {
        state: validatorBinding.state,
        schemaVersion: validatorBinding.schemaVersion,
        ...(validatorBinding.sourceRevision === undefined ? {} : { sourceRevision: validatorBinding.sourceRevision }),
        fixtureDigest: validatorBinding.fixtureDigest
      }
    });
  } catch (error) {
    if (error instanceof QuoteExecutionError) throw error;
    throw new QuoteExecutionError("invalid_input");
  }
}

function quoteBody(snapshot: Record<string, unknown>): Record<string, unknown> {
  const quoteId = snapshot.quoteId;
  if (typeof quoteId !== "string" || !/^quote:sha256:[a-f0-9]{64}$/u.test(quoteId)) return invalid("provider_response_invalid");
  const body: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const [key, value] of Object.entries(snapshot)) if (key !== "quoteId") Object.defineProperty(body, key, { value, enumerable: true });
  return body;
}

function baseCurrentEvaluation(status: QuoteCurrentEvaluation["status"], reasons: readonly QuoteCurrentReason[], requiredActions: readonly QuoteRequiredAction[]): QuoteCurrentEvaluation {
  return Object.freeze({
    status,
    reasons: Object.freeze([...reasons]),
    requiredActions: Object.freeze([...new Set(requiredActions)]),
    quoteMayBePresentedForExternalReview: status === "current"
  });
}

/** Rechecks expiry, scope, catalog, selection, destination, quantity, and shipping before downstream use. */
export async function evaluatePrivateQuoteCurrent(
  quoteValue: unknown,
  currentInput: unknown,
  dependencies: Pick<QuoteDependencies, "clock" | "trustedScope">
): Promise<QuoteCurrentEvaluation> {
  try {
    const quote = record(safeTree(quoteValue));
    const body = quoteBody(quote);
    const integrityDigest = `quote:${await digest(body)}`;
    if (quote.localFormat !== PRIVATE_QUOTE_FORMAT || integrityDigest !== quote.quoteId) {
      return baseCurrentEvaluation("invalid", ["quote_integrity_invalid"], ["requote", "renew_external_authorization"]);
    }
    const scope = snapshotScope(dependencyValue(dependencies, "trustedScope"));
    const now = readNow(dependencyValue(dependencies, "clock"));
    const expiry = record(quote.expiry);
    const effectiveValidUntil = canonicalTimestamp(expiry.effectiveValidUntil);
    if (effectiveValidUntil.epochMs <= now.epochMs) {
      return baseCurrentEvaluation("stale", ["quote_expired"], ["requote", "renew_external_authorization"]);
    }
    if (quote.status !== "complete") {
      return baseCurrentEvaluation("incomplete", ["quote_incomplete"], ["requote", "renew_external_authorization"]);
    }
    const originalBinding = record(quote.binding);
    if (originalBinding.tenantId !== scope.tenantId || originalBinding.projectId !== scope.projectId) {
      return baseCurrentEvaluation("stale", ["trusted_scope_changed"], ["requote", "renew_external_authorization"]);
    }
    let prepared: Awaited<ReturnType<typeof prepareBoundInput>>;
    try {
      prepared = await prepareBoundInput(currentInput, scope, now.text);
    } catch (error) {
      if (error instanceof QuoteExecutionError && error.code === "stale_quote") {
        return baseCurrentEvaluation("stale", ["catalog_stale"], ["refresh_catalog", "revalidate_selection", "requote", "renew_external_authorization"]);
      }
      if (error instanceof QuoteExecutionError && error.code === "unsupported") {
        return baseCurrentEvaluation("stale", ["selection_ineligible"], ["revalidate_selection", "requote", "renew_external_authorization"]);
      }
      return baseCurrentEvaluation("invalid", ["selection_ineligible"], ["revalidate_selection", "requote", "renew_external_authorization"]);
    }
    const currentBinding = prepared.binding;
    const changed: QuoteCurrentReason[] = [];
    if (originalBinding.catalogSnapshotIdentity !== currentBinding.catalogSnapshotIdentity ||
        originalBinding.catalogContentIdentity !== currentBinding.catalogContentIdentity ||
        originalBinding.catalogVersion !== currentBinding.catalogVersion ||
        originalBinding.providerId !== currentBinding.providerId || originalBinding.apiVersion !== currentBinding.apiVersion) changed.push("catalog_changed");
    if (originalBinding.sku !== currentBinding.sku || originalBinding.variantId !== currentBinding.variantId ||
        originalBinding.specIdentity !== currentBinding.specIdentity || originalBinding.selectionDigest !== currentBinding.selectionDigest ||
        stableJson(originalBinding.options) !== stableJson(currentBinding.options) ||
        stableJson(originalBinding.materials) !== stableJson(currentBinding.materials)) changed.push("selection_changed");
    if (stableJson(originalBinding.destination) !== stableJson(currentBinding.destination)) changed.push("destination_changed");
    if (originalBinding.quantity !== currentBinding.quantity || originalBinding.shippingMethod !== currentBinding.shippingMethod ||
        originalBinding.requestDigest !== currentBinding.requestDigest) changed.push("request_changed");
    if (changed.length > 0) {
      const actions: QuoteRequiredAction[] = [];
      if (changed.includes("catalog_changed")) actions.push("refresh_catalog");
      actions.push("revalidate_selection", "requote", "renew_external_authorization");
      return baseCurrentEvaluation("stale", changed, actions);
    }
    const breakdown = record(quote.breakdown);
    const total = record(breakdown.total);
    const reconciliation = record(breakdown.reconciliation);
    if (total.state !== "known" || reconciliation.state !== "reconciled") {
      return baseCurrentEvaluation("incomplete", ["quote_incomplete"], ["requote", "renew_external_authorization"]);
    }
    return baseCurrentEvaluation("current", [], ["obtain_external_authorization"]);
  } catch {
    return baseCurrentEvaluation("invalid", ["quote_integrity_invalid"], ["requote", "renew_external_authorization"]);
  }
}
