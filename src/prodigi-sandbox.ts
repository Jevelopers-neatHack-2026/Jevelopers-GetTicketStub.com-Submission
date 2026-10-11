import { createHash } from "node:crypto";
import {
  evaluateProviderPolicy,
  PRODIGI_SANDBOX_BASE_URL,
  PRODIGI_SANDBOX_OPERATION_ENDPOINTS,
  type SandboxDecisionVerifier,
  type SandboxOperation
} from "./provider-matrix.js";
import { withServerSecret, type ServerSecretSource } from "./security.js";
import { PRODIGI_SANDBOX_SECRET_BINDING } from "./prodigi-secrets.js";
import type { BoundedQuotePort, QuoteProviderCallContext, QuoteProviderRequest, QuoteUnknownReason } from "./quotes.js";
import type { StatusResult } from "./types.js";

/**
 * Prodigi Print API v4 sandbox adapter.
 *
 * Maps the connector's private quote request and a private order-create input
 * to the documented v4 `POST /v4.0/quotes`, `POST /v4.0/Orders` and
 * `GET /v4.0/orders/{id}` requests, and projects the documented responses into
 * bounded, PII-free observations. All network access goes through an injected
 * HTTP port; the module never constructs a live URL and refuses to send unless
 * sandbox calls are explicitly enabled, the owner sandbox decision verifies,
 * and a sandbox-class credential resolves through the secret-reference port.
 */

export const PRODIGI_SANDBOX_ORIGIN = "https://api.sandbox.prodigi.com" as const;

export type ProdigiShippingMethod = "Budget" | "Standard" | "StandardPlus" | "Express" | "Overnight";
export type ProdigiSizing = "fillPrintArea" | "fitPrintArea" | "stretchToPrintArea";

export interface ProdigiHttpRequest {
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly signal: AbortSignal;
}

export interface ProdigiHttpResponse {
  readonly status: number;
  readonly bodyText: string;
}

/** Transport port. Tests inject recorded fixtures; production may use `createFetchProdigiHttpPort`. */
export interface ProdigiHttpPort {
  send(request: ProdigiHttpRequest): Promise<ProdigiHttpResponse>;
}

export interface ProdigiSandboxDecision {
  readonly decisionReference: string;
  readonly sku: string;
  readonly destinationCountryCode: string;
  readonly shippingMethod: ProdigiShippingMethod;
}

export interface ProdigiSandboxClientOptions {
  readonly http: ProdigiHttpPort;
  readonly secrets: ServerSecretSource;
  readonly decision: ProdigiSandboxDecision;
  readonly decisionVerifier: SandboxDecisionVerifier;
  /** Must be exactly `true`. Defaults off so constructing a client sends nothing. */
  readonly sandboxCallsEnabled?: boolean;
  /** Secret reference name; defaults to `prodigi/sandbox/api-key`. Never a raw key. */
  readonly secretReference?: string;
  readonly timeoutMs?: number;
}

export type ProdigiSandboxErrorCode =
  | "sandbox_calls_disabled"
  | "decision_unverified"
  | "decision_mismatch"
  | "invalid_input"
  | "credential_unavailable"
  | "authentication_failed"
  | "validation_failed"
  | "not_found"
  | "rate_limited"
  | "provider_unavailable"
  | "timeout"
  | "invalid_response";

/** Whether the provider may have applied the request. Order creation uses `unknown` when uncertain. */
export type ProdigiSideEffectState = "not_dispatched" | "possible" | "confirmed" | "unknown";

const ERROR_MESSAGES: Readonly<Record<ProdigiSandboxErrorCode, string>> = {
  sandbox_calls_disabled: "Prodigi sandbox calls are disabled.",
  decision_unverified: "The owner sandbox decision could not be verified.",
  decision_mismatch: "The request does not match the verified sandbox decision.",
  invalid_input: "The Prodigi request input did not pass validation.",
  credential_unavailable: "The Prodigi sandbox credential is unavailable.",
  authentication_failed: "Prodigi rejected the sandbox credential.",
  validation_failed: "Prodigi rejected the request as invalid.",
  not_found: "Prodigi did not find the requested entity.",
  rate_limited: "Prodigi rate-limited the request.",
  provider_unavailable: "Prodigi was unavailable or returned an unexpected status.",
  timeout: "The Prodigi request timed out.",
  invalid_response: "The Prodigi response is invalid or unsupported."
};

export class ProdigiSandboxError extends Error {
  readonly code: ProdigiSandboxErrorCode;
  readonly sideEffectState: ProdigiSideEffectState;
  readonly httpStatus: number | null;
  constructor(code: ProdigiSandboxErrorCode, sideEffectState: ProdigiSideEffectState, httpStatus: number | null = null) {
    super(ERROR_MESSAGES[code]);
    this.name = "ProdigiSandboxError";
    this.code = code;
    this.sideEffectState = sideEffectState;
    this.httpStatus = httpStatus;
  }
}

// ---------------------------------------------------------------------------
// Input validation helpers

const SKU_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const COUNTRY_PATTERN = /^[A-Z]{2}$/u;
const CURRENCY_SCALES: Readonly<Record<string, number>> = Object.freeze({ USD: 2, GBP: 2, EUR: 2, CAD: 2, AUD: 2 });
const ATTRIBUTE_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/u;
const PRINT_AREA_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/u;
const ORDER_ID_PATTERN = /^ord_[A-Za-z0-9]{1,64}$/u;
const REFERENCE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u;
const MD5_PATTERN = /^[a-f0-9]{32}$/u;
const AMOUNT_PATTERN = /^(0|[1-9][0-9]{0,14})(\.[0-9]{1,6})?$/u;
const ISSUE_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9._]{0,127}$/u;
const MAX_RESPONSE_CHARS = 1_048_576;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 60_000;

const SHIPPING_METHODS: Readonly<Record<string, ProdigiShippingMethod>> = Object.freeze({
  budget: "Budget",
  standard: "Standard",
  standardplus: "StandardPlus",
  express: "Express",
  overnight: "Overnight"
});

function invalidInput(): never {
  throw new ProdigiSandboxError("invalid_input", "not_dispatched");
}

function invalidResponse(sideEffectState: ProdigiSideEffectState, httpStatus: number | null): never {
  throw new ProdigiSandboxError("invalid_response", sideEffectState, httpStatus);
}

/** Case-insensitive mapping of a configured shipping choice to the documented enum. */
export function toProdigiShippingMethod(value: unknown): ProdigiShippingMethod {
  if (typeof value !== "string") return invalidInput();
  const key = value.toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(SHIPPING_METHODS, key)) return invalidInput();
  return SHIPPING_METHODS[key] as ProdigiShippingMethod;
}

function boundedText(value: unknown, max: number, optional: false): string;
function boundedText(value: unknown, max: number, optional: true): string | undefined;
function boundedText(value: unknown, max: number, optional: boolean): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value.length === 0 || value.length > max || value.trim() !== value ||
      /[\u0000-\u001F\u007F]/u.test(value)) return invalidInput();
  return value;
}

function attributesOf(value: unknown): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalidInput();
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 16) return invalidInput();
  const result: Record<string, string> = {};
  for (const [key, attribute] of entries) {
    if (!ATTRIBUTE_KEY_PATTERN.test(key)) return invalidInput();
    result[key] = boundedText(attribute, 64, false);
  }
  return Object.freeze(result);
}

function httpsAssetUrl(value: unknown): string {
  const text = boundedText(value, 2048, false);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return invalidInput();
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "") return invalidInput();
  return text;
}

// ---------------------------------------------------------------------------
// Request mapping (pure; exported for tests and review)

export interface ProdigiQuoteMappingConfig {
  /** Prodigi attributes approved for the selected SKU (from the print specification). */
  readonly attributes?: Readonly<Record<string, string>>;
  readonly printArea?: string;
  readonly currencyCode: string;
}

/** Maps the connector's private `QuoteProviderRequest` to a v4 create-quote body. */
export function mapQuoteRequest(request: QuoteProviderRequest, config: ProdigiQuoteMappingConfig): Readonly<Record<string, unknown>> {
  if (request === null || typeof request !== "object") return invalidInput();
  if (request.providerId !== "prodigi") return invalidInput();
  if (typeof request.sku !== "string" || !SKU_PATTERN.test(request.sku)) return invalidInput();
  if (!Number.isSafeInteger(request.quantity) || request.quantity < 1 || request.quantity > 1000) return invalidInput();
  const countryCode = request.destination?.countryCode;
  if (typeof countryCode !== "string" || !COUNTRY_PATTERN.test(countryCode)) return invalidInput();
  if (request.personalization !== null) return invalidInput();
  const currencyCode = config.currencyCode;
  if (typeof currencyCode !== "string" || CURRENCY_SCALES[currencyCode] === undefined) return invalidInput();
  const printArea = config.printArea ?? "default";
  if (!PRINT_AREA_PATTERN.test(printArea)) return invalidInput();
  return Object.freeze({
    shippingMethod: toProdigiShippingMethod(request.shippingMethod),
    destinationCountryCode: countryCode,
    currencyCode,
    items: [{
      sku: request.sku,
      copies: request.quantity,
      attributes: attributesOf(config.attributes),
      assets: [{ printArea }]
    }]
  });
}

export interface ProdigiOrderRecipientInput {
  readonly name: string;
  readonly email?: string;
  readonly phoneNumber?: string;
  readonly address: {
    readonly line1: string;
    readonly line2?: string;
    readonly postalOrZipCode: string;
    readonly countryCode: string;
    readonly townOrCity: string;
    readonly stateOrCounty?: string;
  };
}

export interface ProdigiOrderItemInput {
  readonly merchantReference?: string;
  readonly sku: string;
  readonly copies: number;
  readonly sizing: ProdigiSizing;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly assets: readonly { readonly printArea: string; readonly url: string; readonly md5Hash?: string }[];
}

/**
 * Private, connector-local order-create input. The recipient is expected to be
 * resolved server-side from an encrypted scoped reference immediately before
 * the call; it is sent to Prodigi and never returned, logged or persisted here.
 */
export interface ProdigiOrderCreateInput {
  readonly merchantReference: string;
  readonly idempotencyKey: string;
  readonly shippingMethod: string;
  readonly recipient: ProdigiOrderRecipientInput;
  readonly items: readonly ProdigiOrderItemInput[];
}

/** Maps the private order-create input to a v4 create-order body. No callback URL or metadata is sent. */
export function mapOrderRequest(input: ProdigiOrderCreateInput): Readonly<Record<string, unknown>> {
  if (input === null || typeof input !== "object") return invalidInput();
  const merchantReference = boundedText(input.merchantReference, 100, false);
  const idempotencyKey = boundedText(input.idempotencyKey, 100, false);
  if (!REFERENCE_PATTERN.test(merchantReference) || !REFERENCE_PATTERN.test(idempotencyKey)) return invalidInput();
  const recipient = input.recipient;
  if (recipient === null || typeof recipient !== "object") return invalidInput();
  const address = recipient.address;
  if (address === null || typeof address !== "object") return invalidInput();
  if (typeof address.countryCode !== "string" || !COUNTRY_PATTERN.test(address.countryCode)) return invalidInput();
  const mappedAddress: Record<string, string> = {
    line1: boundedText(address.line1, 256, false),
    postalOrZipCode: boundedText(address.postalOrZipCode, 32, false),
    countryCode: address.countryCode,
    townOrCity: boundedText(address.townOrCity, 128, false)
  };
  const line2 = boundedText(address.line2, 256, true);
  if (line2 !== undefined) mappedAddress.line2 = line2;
  const stateOrCounty = boundedText(address.stateOrCounty, 128, true);
  if (stateOrCounty !== undefined) mappedAddress.stateOrCounty = stateOrCounty;
  const mappedRecipient: Record<string, unknown> = { name: boundedText(recipient.name, 256, false), address: mappedAddress };
  const email = boundedText(recipient.email, 254, true);
  if (email !== undefined) mappedRecipient.email = email;
  const phoneNumber = boundedText(recipient.phoneNumber, 32, true);
  if (phoneNumber !== undefined) mappedRecipient.phoneNumber = phoneNumber;

  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 10) return invalidInput();
  const items = input.items.map((item) => {
    if (item === null || typeof item !== "object") return invalidInput();
    if (typeof item.sku !== "string" || !SKU_PATTERN.test(item.sku)) return invalidInput();
    if (!Number.isSafeInteger(item.copies) || item.copies < 1 || item.copies > 1000) return invalidInput();
    if (item.sizing !== "fillPrintArea" && item.sizing !== "fitPrintArea" && item.sizing !== "stretchToPrintArea") return invalidInput();
    if (!Array.isArray(item.assets) || item.assets.length < 1 || item.assets.length > 8) return invalidInput();
    const assets = (item.assets as readonly unknown[]).map((raw) => {
      const asset = raw as ProdigiOrderItemInput["assets"][number];
      if (asset === null || typeof asset !== "object" || typeof asset.printArea !== "string" || !PRINT_AREA_PATTERN.test(asset.printArea)) {
        return invalidInput();
      }
      const mapped: Record<string, string> = { printArea: asset.printArea, url: httpsAssetUrl(asset.url) };
      if (asset.md5Hash !== undefined) {
        if (typeof asset.md5Hash !== "string" || !MD5_PATTERN.test(asset.md5Hash)) return invalidInput();
        mapped.md5Hash = asset.md5Hash;
      }
      return mapped;
    });
    const mapped: Record<string, unknown> = { sku: item.sku, copies: item.copies, sizing: item.sizing, attributes: attributesOf(item.attributes), assets };
    const itemReference = boundedText(item.merchantReference, 100, true);
    if (itemReference !== undefined) {
      if (!REFERENCE_PATTERN.test(itemReference)) return invalidInput();
      mapped.merchantReference = itemReference;
    }
    return mapped;
  });

  return Object.freeze({
    merchantReference,
    idempotencyKey,
    shippingMethod: toProdigiShippingMethod(input.shippingMethod),
    recipient: mappedRecipient,
    items
  });
}

// ---------------------------------------------------------------------------
// Response projection

type JsonRecord = Readonly<Record<string, unknown>>;

function record(value: unknown, sideEffect: ProdigiSideEffectState, status: number): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalidResponse(sideEffect, status);
  return value as JsonRecord;
}

function outcomeOf(body: JsonRecord): string {
  return typeof body.outcome === "string" ? body.outcome.toLowerCase() : "";
}

function issueCodes(value: unknown, sideEffect: ProdigiSideEffectState, status: number): readonly string[] {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 64) return invalidResponse(sideEffect, status);
  const codes: string[] = [];
  for (const issue of value) {
    const code = record(issue, sideEffect, status).errorCode;
    if (typeof code !== "string" || !ISSUE_CODE_PATTERN.test(code)) return invalidResponse(sideEffect, status);
    if (!codes.includes(code)) codes.push(code);
  }
  return Object.freeze(codes.slice(0, 16));
}

interface Money {
  readonly decimal: string;
  readonly minor: bigint;
}

function money(value: unknown, currency: string, scale: number, status: number): Money | undefined {
  if (value === undefined || value === null) return undefined;
  const cost = record(value, "not_dispatched", status);
  if (cost.currency !== currency || typeof cost.amount !== "string" || !AMOUNT_PATTERN.test(cost.amount)) {
    return invalidResponse("not_dispatched", status);
  }
  const [whole = "0", fraction = ""] = cost.amount.split(".");
  if (fraction.length > scale) return invalidResponse("not_dispatched", status);
  const minor = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, "0") || "0");
  return { decimal: cost.amount, minor };
}

/** Provider quote shape consumed by `executePrivateQuote` (see quotes.ts). */
export interface ProdigiProviderQuote {
  readonly providerQuoteReference: string;
  readonly currency: string;
  readonly currencyScale: number;
  readonly breakdown: {
    readonly production: ProviderAmount;
    readonly shipping: ProviderAmount;
    readonly tax: ProviderAmount;
    readonly fee: ProviderAmount;
  };
  readonly taxBasis: "included" | "excluded" | "unknown";
  readonly total: ProviderAmount;
  readonly providerExpiry: { readonly state: "unknown"; readonly reasonCode: QuoteUnknownReason };
  readonly leadTime: { readonly state: "unknown"; readonly reasonCode: QuoteUnknownReason };
  readonly warnings: readonly string[];
  readonly providerNotes: readonly string[];
}

type ProviderAmount = { readonly state: "known"; readonly decimal: string } | { readonly state: "unknown"; readonly reasonCode: QuoteUnknownReason };

function known(value: Money | undefined): ProviderAmount {
  return value === undefined ? { state: "unknown", reasonCode: "not_provided" } : { state: "known", decimal: value.decimal };
}

/**
 * Projects a v4 create-quote response for one requested shipping method.
 *
 * - `production` = `costSummary.items`, `shipping` = `costSummary.shipping`.
 * - `fee` = `costSummary.branding`; this adapter never requests branded inserts,
 *   so an absent branding cost is an explicit known zero.
 * - `tax` = `costSummary.totalTax`, `total` = `costSummary.totalCost`; absent
 *   values stay unknown, never zero.
 * - The docs say `totalCost` includes tax but not whether line amounts already
 *   include it, so the tax basis is taken from exact reconciliation only:
 *   lines + tax = total gives `excluded`, lines = total with tax > 0 gives
 *   `included`, anything else is `unknown`.
 * - Prodigi documents no quote identifier or expiry; the reference is a local
 *   digest and expiry and lead time are reported as undisclosed.
 */
export function projectQuoteResponse(
  body: unknown,
  expected: { readonly shippingMethod: ProdigiShippingMethod; readonly currencyCode: string; readonly requestDigest: string },
  httpStatus = 200
): ProdigiProviderQuote {
  const scale = CURRENCY_SCALES[expected.currencyCode];
  if (scale === undefined) return invalidInput();
  const envelope = record(body, "not_dispatched", httpStatus);
  const outcome = outcomeOf(envelope);
  if (outcome !== "created" && outcome !== "createdwithissues") return invalidResponse("not_dispatched", httpStatus);
  const quotes = envelope.quotes;
  if (!Array.isArray(quotes) || quotes.length === 0 || quotes.length > 8) return invalidResponse("not_dispatched", httpStatus);
  const matching = quotes.filter((quote) => {
    const method = record(quote, "not_dispatched", httpStatus).shipmentMethod;
    return typeof method === "string" && method.toLowerCase() === expected.shippingMethod.toLowerCase();
  });
  if (matching.length !== 1) return invalidResponse("not_dispatched", httpStatus);
  const quote = record(matching[0], "not_dispatched", httpStatus);
  const summary = record(quote.costSummary, "not_dispatched", httpStatus);
  const currency = expected.currencyCode;
  const items = money(summary.items, currency, scale, httpStatus);
  const shipping = money(summary.shipping, currency, scale, httpStatus);
  if (items === undefined || shipping === undefined) return invalidResponse("not_dispatched", httpStatus);
  const fee = money(summary.branding, currency, scale, httpStatus) ?? { decimal: "0", minor: 0n };
  const tax = money(summary.totalTax, currency, scale, httpStatus);
  const total = money(summary.totalCost, currency, scale, httpStatus);

  let taxBasis: ProdigiProviderQuote["taxBasis"] = "unknown";
  if (tax !== undefined && total !== undefined) {
    const lines = items.minor + shipping.minor + fee.minor;
    if (lines + tax.minor === total.minor) taxBasis = "excluded";
    else if (lines === total.minor && tax.minor > 0n && tax.minor <= total.minor) taxBasis = "included";
  }

  const warnings = [
    ...issueCodes(envelope.issues, "not_dispatched", httpStatus),
    ...issueCodes(quote.issues, "not_dispatched", httpStatus)
  ].filter((code, index, all) => all.indexOf(code) === index).slice(0, 16);

  const digest = createHash("sha256")
    .update(JSON.stringify([expected.requestDigest, expected.shippingMethod, currency, items.decimal, shipping.decimal,
      fee.decimal, tax?.decimal ?? null, total?.decimal ?? null]))
    .digest("hex");

  return Object.freeze({
    providerQuoteReference: `prodigi-quote:sha256-${digest}`,
    currency,
    currencyScale: scale,
    breakdown: Object.freeze({ production: known(items), shipping: known(shipping), tax: known(tax), fee: known(fee) }),
    taxBasis,
    total: known(total),
    providerExpiry: Object.freeze({ state: "unknown" as const, reasonCode: "not_disclosed" as const }),
    leadTime: Object.freeze({ state: "unknown" as const, reasonCode: "not_disclosed" as const }),
    warnings: Object.freeze(warnings),
    providerNotes: Object.freeze([])
  });
}

export type ProdigiOrderStage = "InProgress" | "Complete" | "Cancelled";
export type ProdigiStepState = "NotStarted" | "InProgress" | "Complete" | "Error";

/** PII-free order observation. Recipient, asset URLs, charges and metadata are dropped. */
export interface ProdigiOrderObservation {
  readonly outcome: string;
  readonly orderId: string;
  readonly created: string;
  readonly lastUpdated: string | null;
  readonly stage: ProdigiOrderStage;
  readonly details: Readonly<Record<"downloadAssets" | "printReadyAssetsPrepared" | "allocateProductionLocation" | "inProduction" | "shipping", ProdigiStepState>>;
  readonly issueCodes: readonly string[];
  readonly shipments: readonly {
    readonly id: string;
    readonly status: string;
    readonly carrier: string | null;
    readonly trackingNumber: string | null;
    readonly dispatchDate: string | null;
  }[];
  readonly normalizedState: StatusResult["normalizedState"];
}

const STAGES: Readonly<Record<string, ProdigiOrderStage>> = Object.freeze({ inprogress: "InProgress", complete: "Complete", cancelled: "Cancelled" });
const STEP_STATES: Readonly<Record<string, ProdigiStepState>> = Object.freeze({
  notstarted: "NotStarted", inprogress: "InProgress", complete: "Complete", error: "Error"
});
const DETAIL_KEYS = ["downloadAssets", "printReadyAssetsPrepared", "allocateProductionLocation", "inProduction", "shipping"] as const;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})?$/u;
const SHORT_TEXT = /^[A-Za-z0-9][A-Za-z0-9 ._:/#-]{0,127}$/u;

function lookup<T>(table: Readonly<Record<string, T>>, value: unknown): T | undefined {
  if (typeof value !== "string") return undefined;
  const key = value.toLowerCase();
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

function optionalShort(value: unknown, sideEffect: ProdigiSideEffectState, status: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !SHORT_TEXT.test(value)) return invalidResponse(sideEffect, status);
  return value;
}

/**
 * Status mapping. `Complete` means shipping notifications were sent for all
 * items, not delivery, so it maps to `shipped`. Any step in `Error` maps to
 * `unknown` because the docs do not say whether such errors are terminal.
 */
function normalizeOrderState(stage: ProdigiOrderStage, details: ProdigiOrderObservation["details"]): StatusResult["normalizedState"] {
  if (stage === "Cancelled") return "cancelled";
  if (stage === "Complete") return "shipped";
  if (DETAIL_KEYS.some((key) => details[key] === "Error")) return "unknown";
  if (details.shipping !== "NotStarted") return "in_production";
  if (details.inProduction !== "NotStarted") return "in_production";
  return "accepted";
}

export function projectOrderResponse(
  body: unknown,
  allowedOutcomes: readonly string[],
  sideEffect: ProdigiSideEffectState,
  httpStatus = 200
): ProdigiOrderObservation {
  const envelope = record(body, sideEffect, httpStatus);
  const outcome = outcomeOf(envelope);
  if (!allowedOutcomes.includes(outcome)) return invalidResponse(sideEffect, httpStatus);
  const order = record(envelope.order, sideEffect, httpStatus);
  if (typeof order.id !== "string" || !ORDER_ID_PATTERN.test(order.id)) return invalidResponse(sideEffect, httpStatus);
  if (typeof order.created !== "string" || !TIMESTAMP_PATTERN.test(order.created)) return invalidResponse(sideEffect, httpStatus);
  const lastUpdated = order.lastUpdated === undefined || order.lastUpdated === null ? null : order.lastUpdated;
  if (lastUpdated !== null && (typeof lastUpdated !== "string" || !TIMESTAMP_PATTERN.test(lastUpdated))) return invalidResponse(sideEffect, httpStatus);
  const status = record(order.status, sideEffect, httpStatus);
  const stage = lookup(STAGES, status.stage);
  if (stage === undefined) return invalidResponse(sideEffect, httpStatus);
  const rawDetails = record(status.details, sideEffect, httpStatus);
  const details = {} as Record<(typeof DETAIL_KEYS)[number], ProdigiStepState>;
  for (const key of DETAIL_KEYS) {
    const state = lookup(STEP_STATES, rawDetails[key]);
    if (state === undefined) return invalidResponse(sideEffect, httpStatus);
    details[key] = state;
  }
  const rawShipments = order.shipments ?? [];
  if (!Array.isArray(rawShipments) || rawShipments.length > 64) return invalidResponse(sideEffect, httpStatus);
  const shipments = rawShipments.map((raw) => {
    const shipment = record(raw, sideEffect, httpStatus);
    const id = optionalShort(shipment.id, sideEffect, httpStatus);
    const shipmentStatus = optionalShort(shipment.status, sideEffect, httpStatus);
    if (id === null || shipmentStatus === null) return invalidResponse(sideEffect, httpStatus);
    const carrierRecord = shipment.carrier;
    const carrier = carrierRecord !== null && typeof carrierRecord === "object"
      ? optionalShort((carrierRecord as JsonRecord).name, sideEffect, httpStatus)
      : optionalShort(carrierRecord, sideEffect, httpStatus);
    const tracking = shipment.tracking;
    const trackingNumber = tracking !== null && typeof tracking === "object"
      ? optionalShort((tracking as JsonRecord).number, sideEffect, httpStatus)
      : null;
    const dispatchDate = shipment.dispatchDate;
    if (dispatchDate !== undefined && dispatchDate !== null && (typeof dispatchDate !== "string" || !TIMESTAMP_PATTERN.test(dispatchDate))) {
      return invalidResponse(sideEffect, httpStatus);
    }
    return Object.freeze({ id, status: shipmentStatus, carrier, trackingNumber, dispatchDate: (dispatchDate as string | undefined) ?? null });
  });
  const frozenDetails = Object.freeze(details);
  return Object.freeze({
    outcome,
    orderId: order.id,
    created: order.created,
    lastUpdated: lastUpdated as string | null,
    stage,
    details: frozenDetails,
    issueCodes: issueCodes(status.issues, sideEffect, httpStatus),
    shipments: Object.freeze(shipments),
    normalizedState: normalizeOrderState(stage, frozenDetails)
  });
}

// ---------------------------------------------------------------------------
// Client

type OperationKey = SandboxOperation;

interface SendOutcome {
  readonly ok: boolean;
  readonly status: number;
  readonly body?: unknown;
  readonly error?: ProdigiSandboxError;
}

function classifyHttpFailure(status: number, operation: OperationKey): ProdigiSandboxError {
  // For order creation, only explicit client errors prove the order was not created.
  const ambiguous: ProdigiSideEffectState = operation === "submit" ? "unknown" : "not_dispatched";
  if (status === 401 || status === 403) return new ProdigiSandboxError("authentication_failed", "not_dispatched", status);
  if (status === 400) return new ProdigiSandboxError("validation_failed", "not_dispatched", status);
  if (status === 404) return new ProdigiSandboxError("not_found", "not_dispatched", status);
  if (status === 429) return new ProdigiSandboxError("rate_limited", "not_dispatched", status);
  return new ProdigiSandboxError("provider_unavailable", ambiguous, status);
}

export class ProdigiSandboxClient {
  readonly #http: ProdigiHttpPort;
  readonly #secrets: ServerSecretSource;
  readonly #decision: ProdigiSandboxDecision;
  readonly #verifier: SandboxDecisionVerifier;
  readonly #enabled: boolean;
  readonly #secretReference: string;
  readonly #timeoutMs: number;

  constructor(options: ProdigiSandboxClientOptions) {
    if (options === null || typeof options !== "object") throw new ProdigiSandboxError("invalid_input", "not_dispatched");
    if (options.http === null || typeof options.http !== "object" || typeof options.http.send !== "function") throw new ProdigiSandboxError("invalid_input", "not_dispatched");
    if (options.secrets === null || typeof options.secrets !== "object" || typeof options.secrets.load !== "function") throw new ProdigiSandboxError("invalid_input", "not_dispatched");
    const decision = options.decision;
    if (decision === null || typeof decision !== "object" || typeof decision.sku !== "string" || !SKU_PATTERN.test(decision.sku) ||
        typeof decision.destinationCountryCode !== "string" || !COUNTRY_PATTERN.test(decision.destinationCountryCode) ||
        typeof decision.decisionReference !== "string" || decision.decisionReference.trim() === "") {
      throw new ProdigiSandboxError("invalid_input", "not_dispatched");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) throw new ProdigiSandboxError("invalid_input", "not_dispatched");
    const secretReference = options.secretReference ?? PRODIGI_SANDBOX_SECRET_BINDING.reference;
    if (typeof secretReference !== "string" || secretReference.length === 0) throw new ProdigiSandboxError("invalid_input", "not_dispatched");
    this.#http = options.http;
    this.#secrets = options.secrets;
    this.#decision = Object.freeze({
      decisionReference: decision.decisionReference,
      sku: decision.sku,
      destinationCountryCode: decision.destinationCountryCode,
      shippingMethod: toProdigiShippingMethod(decision.shippingMethod)
    });
    this.#verifier = options.decisionVerifier;
    this.#enabled = options.sandboxCallsEnabled === true;
    this.#secretReference = secretReference;
    this.#timeoutMs = timeoutMs;
  }

  get decision(): ProdigiSandboxDecision {
    return this.#decision;
  }

  /** Creates a quote for the verified decision. Quotes are non-charging and create no order. */
  async createQuote(
    request: QuoteProviderRequest,
    config: ProdigiQuoteMappingConfig,
    signal?: AbortSignal
  ): Promise<ProdigiProviderQuote> {
    const body = mapQuoteRequest(request, config);
    this.#assertMatchesDecision(request.sku, request.destination.countryCode, body.shippingMethod as ProdigiShippingMethod);
    const result = await this.#send("quote", "POST", PRODIGI_SANDBOX_OPERATION_ENDPOINTS.quote.path, body, signal);
    return projectQuoteResponse(result, {
      shippingMethod: body.shippingMethod as ProdigiShippingMethod,
      currencyCode: config.currencyCode,
      requestDigest: request.requestDigest
    });
  }

  /** Creates a sandbox order. Uncertain transport outcomes report `sideEffectState: "unknown"`. */
  async createOrder(input: ProdigiOrderCreateInput, signal?: AbortSignal): Promise<ProdigiOrderObservation> {
    const body = mapOrderRequest(input);
    const items = body.items as readonly { readonly sku: string }[];
    for (const item of items) {
      this.#assertMatchesDecision(item.sku, (body.recipient as { address: { countryCode: string } }).address.countryCode, body.shippingMethod as ProdigiShippingMethod);
    }
    const result = await this.#send("submit", "POST", PRODIGI_SANDBOX_OPERATION_ENDPOINTS.submit.path, body, signal);
    return projectOrderResponse(result, ["created", "onhold", "createdwithissues", "alreadyexists"], "unknown");
  }

  /** Reads one order by Prodigi order ID. */
  async getOrder(orderId: string, signal?: AbortSignal): Promise<ProdigiOrderObservation> {
    if (typeof orderId !== "string" || !ORDER_ID_PATTERN.test(orderId)) return invalidInput();
    const path = PRODIGI_SANDBOX_OPERATION_ENDPOINTS.status.path.replace("{prodigi_order_id}", orderId);
    const result = await this.#send("status", "GET", path, undefined, signal);
    return projectOrderResponse(result, ["ok"], "not_dispatched");
  }

  #assertMatchesDecision(sku: string, countryCode: string, shippingMethod: ProdigiShippingMethod): void {
    if (sku !== this.#decision.sku || countryCode !== this.#decision.destinationCountryCode || shippingMethod !== this.#decision.shippingMethod) {
      throw new ProdigiSandboxError("decision_mismatch", "not_dispatched");
    }
  }

  async #send(operation: OperationKey, method: "GET" | "POST", path: string, body: unknown, signal: AbortSignal | undefined): Promise<unknown> {
    if (!this.#enabled) throw new ProdigiSandboxError("sandbox_calls_disabled", "not_dispatched");
    const policy = await evaluateProviderPolicy({
      mode: "sandbox",
      providerId: "prodigi",
      endpoint: PRODIGI_SANDBOX_BASE_URL,
      operation,
      credentialClass: "sandbox",
      sku: this.#decision.sku,
      destinationCountryCode: this.#decision.destinationCountryCode,
      shippingMethod: this.#decision.shippingMethod,
      decisionReference: this.#decision.decisionReference
    }, this.#verifier);
    if (policy.status !== "sandbox_prerequisites_verified" || policy.sandboxRoute?.method !== method) {
      throw new ProdigiSandboxError("decision_unverified", "not_dispatched");
    }
    // Paths come only from the fixed endpoint table; the origin is the fixed sandbox host.
    if (!path.startsWith("/v4.0/")) throw new ProdigiSandboxError("invalid_input", "not_dispatched");
    const url = `${PRODIGI_SANDBOX_ORIGIN}${path}`;
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const http = this.#http;
    const timeoutMs = this.#timeoutMs;

    let outcome: SendOutcome;
    try {
      outcome = await withServerSecret<SendOutcome>({
        providerId: "prodigi",
        secretReference: this.#secretReference,
        mode: "sandbox",
        source: this.#secrets,
        use: async ({ secret }) => sendWithSecret(http, operation, method, url, payload, secret, timeoutMs, signal)
      });
    } catch {
      // withServerSecret failures happen before the callback runs, or inside it
      // only for unexpected errors (sendWithSecret itself never throws).
      throw new ProdigiSandboxError("credential_unavailable", "not_dispatched");
    }
    if (!outcome.ok) throw outcome.error ?? new ProdigiSandboxError("provider_unavailable", operation === "submit" ? "unknown" : "not_dispatched");
    return outcome.body;
  }
}

async function sendWithSecret(
  http: ProdigiHttpPort,
  operation: OperationKey,
  method: "GET" | "POST",
  url: string,
  payload: string | undefined,
  secret: string,
  timeoutMs: number,
  external: AbortSignal | undefined
): Promise<SendOutcome> {
  const uncertain: ProdigiSideEffectState = operation === "submit" ? "unknown" : "not_dispatched";
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = (): void => controller.abort();
  external?.addEventListener("abort", onAbort, { once: true });
  if (external?.aborted === true) controller.abort();
  const headers: Record<string, string> = { "X-API-Key": secret, Accept: "application/json" };
  if (payload !== undefined) headers["Content-Type"] = "application/json";
  let response: ProdigiHttpResponse;
  try {
    response = await http.send(Object.freeze({
      method,
      url,
      headers: Object.freeze(headers),
      ...(payload === undefined ? {} : { body: payload }),
      signal: controller.signal
    }));
  } catch {
    const error = timedOut
      ? new ProdigiSandboxError("timeout", uncertain)
      : new ProdigiSandboxError("provider_unavailable", uncertain);
    return { ok: false, status: 0, error };
  } finally {
    clearTimeout(timer);
    external?.removeEventListener("abort", onAbort);
  }
  if (response === null || typeof response !== "object" || !Number.isSafeInteger(response.status)) {
    return { ok: false, status: 0, error: new ProdigiSandboxError("invalid_response", uncertain) };
  }
  const status = response.status;
  if (status < 200 || status > 299) return { ok: false, status, error: classifyHttpFailure(status, operation) };
  const text = response.bodyText;
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_RESPONSE_CHARS) {
    return { ok: false, status, error: new ProdigiSandboxError("invalid_response", uncertain, status) };
  }
  try {
    return { ok: true, status, body: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, status, error: new ProdigiSandboxError("invalid_response", uncertain, status) };
  }
}

/**
 * Adapts the client to the existing `BoundedQuotePort` so `executePrivateQuote`
 * can normalize Prodigi quotes. The port exposes no order or payment method.
 */
export function createProdigiQuotePort(client: ProdigiSandboxClient, config: ProdigiQuoteMappingConfig): BoundedQuotePort {
  return Object.freeze({
    async quote(request: QuoteProviderRequest, context: QuoteProviderCallContext): Promise<unknown> {
      return client.createQuote(request, config, context.signal);
    }
  });
}

/** Map an order observation to the runtime's `StatusResult`. */
export function toStatusResult(observation: ProdigiOrderObservation, observedAt: string): StatusResult {
  return Object.freeze({
    providerRequestId: observation.orderId,
    providerStatus: observation.stage,
    normalizedState: observation.normalizedState,
    observedAt
  });
}

/**
 * Fetch-backed HTTP port with redirects disabled and a bounded body. It is
 * only ever handed URLs under the fixed sandbox origin by the client above.
 */
export function createFetchProdigiHttpPort(fetchImpl: typeof fetch = globalThis.fetch): ProdigiHttpPort {
  return Object.freeze({
    async send(request: ProdigiHttpRequest): Promise<ProdigiHttpResponse> {
      if (!request.url.startsWith(`${PRODIGI_SANDBOX_ORIGIN}/`)) throw new Error("refused");
      const response = await fetchImpl(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: "error",
        signal: request.signal
      });
      const bodyText = await response.text();
      return { status: response.status, bodyText: bodyText.length > MAX_RESPONSE_CHARS ? "" : bodyText };
    }
  });
}
