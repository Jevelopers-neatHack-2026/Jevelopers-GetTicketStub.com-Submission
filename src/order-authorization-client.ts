import { createHash, createHmac } from "node:crypto";
import { withServerSecret } from "./security.js";
import type { ServerSecretSource } from "./security.js";
import type {
  AuthorizationCheck,
  AuthorizationClaimResult,
  AuthorizationClaimed,
  AuthorizationDispatchResult,
  AuthorizationVerifier,
  Clock,
  ProviderMode,
  SubmitQuoteTerms,
  TrustedOrderTerms,
  TrustedTermsSource
} from "./types.js";

/**
 * Simulated, development-only consumer of the TicketStub order-authorization
 * port (`ticketstub.order-authorization/1`).
 *
 * Scope and limits, stated plainly:
 * - It owns no endpoint, base URL, `fetch`, `.env` read or live key. Every byte
 *   leaves through an injected {@link OrderAuthorizationHttpPort}; the port owns
 *   the origin-only base URL and TLS.
 * - It accepts only the connector `simulated` mode and maps it to the app
 *   provider `sandbox`. The app provider `prodigi` is never named and a
 *   connector `sandbox` mode is refused. No canonical binding is accepted or
 *   forged here, and the runtime's own `sandbox_disabled` and
 *   `contract_missing` gates are untouched.
 * - Purchase terms come only from an injected {@link TrustedTermsSource} that
 *   declares `development_fixture` provenance. Terms are never copied from the
 *   authorization envelope and the token body is never decoded.
 * - Issuer responses are not message-authenticated. Trust in them is limited to
 *   the transport (TLS) plus the field bindings checked here.
 *
 * This is not consumer-conformance evidence and not a scope-completion claim.
 */

export const ORDER_AUTHORIZATION_SCHEMA = "ticketstub.order-authorization/1";
export const ORDER_AUTHORIZATION_ACTION = "fulfillment.submit";
export const ORDER_AUTHORIZATION_AUDIENCE = "fulfillment-connectors";
export const ORDER_AUTHORIZATION_PATHS = Object.freeze({
  claim: "/api/order-authorizations/claim",
  lookup: "/api/order-authorizations/claims/lookup",
  revalidate: "/api/order-authorizations/revalidate"
});
export const ORDER_AUTHORIZATION_CONSUMER_HEADERS = Object.freeze({
  timestamp: "x-ticketstub-consumer-timestamp",
  signature: "x-ticketstub-consumer-signature"
});
export const ORDER_AUTHORIZATION_REJECTION_REASONS: readonly string[] = Object.freeze([
  "unknown",
  "forged",
  "unsupported_version",
  "wrong_scope",
  "changed_terms",
  "revoked",
  "expired",
  "stale_approval",
  "stale",
  "not_orderable",
  "already_claimed",
  "not_claimed",
  "idempotency_conflict",
  "invalid_clock"
]);

/** Connector mode to app provider. The only entry is the simulated one; there is deliberately no prodigi route. */
const MODE_TO_APP_PROVIDER: Readonly<Record<string, string>> = Object.freeze({ simulated: "sandbox" });
const APP_RECORD_MODE = "sandbox";
const APP_ENVIRONMENTS: readonly string[] = ["development", "preview"];
const MAX_TOKEN_CHARS = 8192;
const MAX_RESPONSE_CHARS = 65536;
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_CONSUMER_KEY_CHARS = 32;
const FIXTURE_KEY_MARKER = "FIXTURE-ONLY";
const REFERENCE = /^[\w.:-]{8,128}$/;
const PROJECT_ID = /^[\w.:-]{1,128}$/;
const HEX64 = /^[a-f0-9]{64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const IDENTITY = /^[\x21-\x7e]{1,512}$/;

export type OrderAuthorizationErrorCode =
  | "invalid_configuration"
  | "invalid_check"
  | "refused_mode"
  | "refused_provider"
  | "key_unavailable"
  | "transport_failed"
  | "timeout"
  | "unexpected_status"
  | "malformed_response"
  | "unknown_rejection"
  | "ambiguous_claim"
  | "lookup_unavailable";

const SAFE_MESSAGES: Readonly<Record<OrderAuthorizationErrorCode, string>> = {
  invalid_configuration: "The order authorization verifier is not configured safely.",
  invalid_check: "The authorization check is malformed.",
  refused_mode: "Only the simulated connector mode may use this authorization port.",
  refused_provider: "The provider is not mapped to an authorization provider.",
  key_unavailable: "The consumer request key is unavailable or unsafe.",
  transport_failed: "The order authorization port could not be reached.",
  timeout: "The order authorization port did not answer in time.",
  unexpected_status: "The order authorization port returned an unexpected status.",
  malformed_response: "The order authorization port returned a malformed response.",
  unknown_rejection: "The order authorization port returned an unknown rejection.",
  ambiguous_claim: "The authorization claim outcome is still unknown after reconciliation.",
  lookup_unavailable: "The authorization claim lookup could not be completed."
};

/** Carries a fixed message only: never a token, signature, key, claim key or caller-supplied text. */
export class OrderAuthorizationError extends Error {
  constructor(readonly code: OrderAuthorizationErrorCode) {
    super(SAFE_MESSAGES[code]);
    this.name = "OrderAuthorizationError";
  }
}

export interface OrderAuthorizationHttpRequest {
  readonly method: "POST";
  /** The exact path that was signed. The port joins it to its own origin-only base without altering it. */
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  /** The exact body text that was signed. Send these bytes unchanged. */
  readonly bodyText: string;
  readonly signal: AbortSignal;
}

export interface OrderAuthorizationHttpResponse {
  readonly status: number;
  readonly bodyText: string;
}

/** Injected transport. Production wiring of a real one is out of scope and forbidden here. */
export interface OrderAuthorizationHttpPort {
  send(request: OrderAuthorizationHttpRequest): Promise<OrderAuthorizationHttpResponse>;
}

export interface ConsumerRequestSigner {
  sign(input: { readonly method: string; readonly path: string; readonly bodyText: string }): Promise<{
    readonly timestamp: number;
    readonly signature: string;
  }>;
}

/** Canonical JSON as the issuer computes it: keys sorted, no whitespace, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => (item === undefined ? "null" : canonicalJson(item))).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** HMAC-SHA256 hex over `<timestamp ms>\n<METHOD>\n<path>\n<sha256 hex of the exact body text>`. Pure; takes whatever key it is given. */
export function consumerSignature(
  key: string,
  timestamp: number,
  method: string,
  path: string,
  bodyText: string
): string {
  return createHmac("sha256", key)
    .update(`${timestamp}\n${method.toUpperCase()}\n${path}\n${sha256Hex(bodyText)}`)
    .digest("hex");
}

/** The issuer's logical action identity for an order: `act_` plus 32 hex of the canonical tenant, project, action and orderRef. */
export function deriveOrderActionId(tenant: string, projectId: string, orderRef: string): string {
  return `act_${sha256Hex(canonicalJson({
    tenant,
    project: { kind: "stub", id: projectId },
    action: ORDER_AUTHORIZATION_ACTION,
    orderRef
  })).slice(0, 32)}`;
}

/**
 * The consumer claim idempotency key. It mirrors the issuer's action identity
 * and uses only trusted facts, so it survives token re-signing under a rotated
 * issuer key and is shared by every delivery key for the same order. It never
 * contains the token, the delivery idempotency key, the request fingerprint or
 * any secret. 69 characters, inside the issuer's `^[A-Za-z0-9_.:-]{8,128}$`.
 */
export function deriveOrderClaimKey(input: {
  readonly providerId: string;
  readonly mode: string;
  readonly tenant: string;
  readonly projectId: string;
  readonly orderRef: string;
}): string {
  return `fcc1:${sha256Hex(canonicalJson({
    v: 1,
    consumer: ORDER_AUTHORIZATION_AUDIENCE,
    providerId: input.providerId,
    mode: input.mode,
    tenant: input.tenant,
    project: `stub:${input.projectId}`,
    action: ORDER_AUTHORIZATION_ACTION,
    orderRef: input.orderRef
  }))}`;
}

/** The exact lookup body text (field order is part of what is signed). */
export function orderClaimLookupBody(tenant: string, projectId: string, idempotencyKey: string): string {
  return JSON.stringify({ tenant, project: `stub:${projectId}`, idempotencyKey });
}

/**
 * Signs consumer requests. The key is leased from the injected source on EVERY
 * request and never cached, so rotation is a hard cutover. Keys shorter than 32
 * characters or carrying the published fixture marker are refused, so the
 * public fixture key can never sign through this factory.
 */
export function createConsumerRequestSigner(options: {
  readonly source: ServerSecretSource;
  readonly providerId: string;
  readonly secretReference: string;
  readonly mode: ProviderMode;
  readonly clock: Clock;
}): ConsumerRequestSigner {
  const { source, providerId, secretReference, mode, clock } = options;
  if (typeof clock?.now !== "function") throw new OrderAuthorizationError("invalid_configuration");
  return Object.freeze({
    async sign(input: Parameters<ConsumerRequestSigner["sign"]>[0]) {
      const timestamp = clock.now();
      if (!Number.isSafeInteger(timestamp) || timestamp <= 0) throw new OrderAuthorizationError("key_unavailable");
      try {
        const signature = await withServerSecret({
          providerId,
          secretReference,
          mode,
          source,
          use: async ({ secret }) => {
            if (secret.length < MIN_CONSUMER_KEY_CHARS || secret.includes(FIXTURE_KEY_MARKER)) {
              throw new OrderAuthorizationError("key_unavailable");
            }
            return consumerSignature(secret, timestamp, input.method, input.path, input.bodyText);
          }
        });
        return { timestamp, signature };
      } catch {
        throw new OrderAuthorizationError("key_unavailable");
      }
    }
  });
}

export interface TicketStubOrderAuthorizationOptions {
  readonly termsSource: TrustedTermsSource;
  readonly http: OrderAuthorizationHttpPort;
  readonly signer: ConsumerRequestSigner;
  readonly clock: Clock;
  /** Connector provider ids this verifier serves. Anything else is refused before any request. */
  readonly trustedProviderIds: readonly string[];
  readonly timeoutMs?: number;
}

type Json = Record<string, unknown>;

function asRecord(value: unknown): Json | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Json : undefined;
}

function boundedString(value: unknown, max: number): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function reference(value: unknown, max: number): string | undefined {
  const text = boundedString(value, max);
  return text !== undefined && REFERENCE.test(text) ? text : undefined;
}

function hex(value: unknown): string | undefined {
  return typeof value === "string" && HEX64.test(value) ? value : undefined;
}

function integer(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}

function identity(value: unknown): string | undefined {
  return typeof value === "string" && IDENTITY.test(value) ? value : undefined;
}

/** Strict shape check mirroring what the issuer accepts. Unknown keys are dropped. Any gap means the terms are not fully bound. */
function snapshotTerms(raw: unknown): TrustedOrderTerms | undefined {
  const terms = asRecord(raw);
  const options = asRecord(terms?.options);
  const quote = asRecord(terms?.quote);
  const destination = asRecord(terms?.destination);
  const design = asRecord(terms?.design);
  if (terms === undefined || options === undefined || quote === undefined || destination === undefined || design === undefined) {
    return undefined;
  }
  const orderRef = boundedString(terms.orderRef, 64) !== undefined ? reference(terms.orderRef, 64) : undefined;
  const sku = terms.sku === null ? null : boundedString(terms.sku, 128);
  const variantId = boundedString(options.variantId, 64);
  const material = boundedString(options.material, 32);
  const finish = boundedString(options.finish, 32);
  const size = boundedString(options.size, 32);
  const quantity = integer(options.quantity, 1, 1000);
  const quoteId = boundedString(quote.id, 200);
  const amountMinor = integer(quote.amountMinor, 0, 1_000_000_000);
  const currency = boundedString(quote.currency, 8);
  const destinationRef = reference(destination.ref, 128);
  const destinationDigest = hex(destination.digest);
  const versionId = boundedString(design.versionId, 128);
  const designHash = hex(design.designHash);
  const artHash = hex(design.artHash);
  const factsHash = hex(design.factsHash);
  const compositionHash = hex(design.compositionHash);
  const approvalId = boundedString(terms.approvalId, 64);
  const capabilityVersion = boundedString(terms.capabilityVersion, 64);
  if (
    orderRef === undefined || sku === undefined || variantId === undefined || material === undefined ||
    finish === undefined || size === undefined || quantity === undefined || quoteId === undefined ||
    amountMinor === undefined || currency === undefined || destinationRef === undefined ||
    destinationDigest === undefined || versionId === undefined || designHash === undefined ||
    artHash === undefined || factsHash === undefined || compositionHash === undefined ||
    approvalId === undefined || capabilityVersion === undefined
  ) return undefined;
  return Object.freeze({
    orderRef,
    sku,
    options: Object.freeze({ variantId, material, finish, size, quantity }),
    quote: Object.freeze({ id: quoteId, amountMinor, currency }),
    destination: Object.freeze({ ref: destinationRef, digest: destinationDigest }),
    design: Object.freeze({ versionId, designHash, artHash, factsHash, compositionHash }),
    approvalId,
    capabilityVersion
  });
}

interface PreparedCheck {
  readonly token: string;
  readonly tenant: string;
  readonly projectId: string;
  readonly providerId: string;
  readonly mode: string;
  readonly appProvider: string;
  readonly terms: TrustedOrderTerms;
  readonly claimKey: string;
  readonly actionId: string;
}

type PreparedResult = { readonly rejected: true } | { readonly rejected: false; readonly prepared: PreparedCheck };

type ClaimFacts = { readonly authorizationId: string; readonly actionId: string; readonly claimReference: string };

type Exchange =
  | { readonly kind: "response"; readonly status: number; readonly text: string }
  | { readonly kind: "failure"; readonly code: "transport_failed" | "timeout" };

type ClaimOnce =
  | { readonly kind: "claimed"; readonly claim: ClaimFacts }
  | { readonly kind: "rejected" }
  | { readonly kind: "ambiguous" };

type LookupOutcome =
  | { readonly kind: "found"; readonly claim: ClaimFacts }
  | { readonly kind: "not_found"; readonly authorizationClaimed: boolean };

function parseJsonText(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

function claimFacts(raw: unknown): ClaimFacts | undefined {
  const record = asRecord(raw);
  const authorizationId = identity(record?.authorizationId);
  const actionId = identity(record?.actionId);
  const claimReference = identity(record?.claimReference);
  return authorizationId === undefined || actionId === undefined || claimReference === undefined
    ? undefined
    : { authorizationId, actionId, claimReference };
}

class TicketStubOrderAuthorizationVerifier implements AuthorizationVerifier {
  private readonly termsSource: TrustedTermsSource;
  private readonly http: OrderAuthorizationHttpPort;
  private readonly signer: ConsumerRequestSigner;
  private readonly clock: Clock;
  private readonly trustedProviderIds: ReadonlySet<string>;
  private readonly timeoutMs: number;

  constructor(options: TicketStubOrderAuthorizationOptions) {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (
      typeof options?.termsSource?.resolve !== "function" || typeof options.http?.send !== "function" ||
      typeof options.signer?.sign !== "function" || typeof options.clock?.now !== "function" ||
      !Array.isArray(options.trustedProviderIds) || options.trustedProviderIds.length === 0 ||
      !options.trustedProviderIds.every((id) => boundedString(id, 128) !== undefined) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000
    ) throw new OrderAuthorizationError("invalid_configuration");
    this.termsSource = options.termsSource;
    this.http = options.http;
    this.signer = options.signer;
    this.clock = options.clock;
    this.trustedProviderIds = new Set(options.trustedProviderIds);
    this.timeoutMs = timeoutMs;
  }

  async verifyAndClaim(check: AuthorizationCheck): Promise<AuthorizationClaimResult> {
    const result = await this.prepare(check);
    if (result.rejected) return { status: "rejected" };
    const prepared = result.prepared;

    let claim: ClaimFacts;
    const first = await this.claimOnce(prepared);
    if (first.kind === "rejected") return { status: "rejected" };
    if (first.kind === "claimed") {
      claim = first.claim;
    } else {
      // The commit is unknown. Ask under the same key; never mint a new one.
      const looked = await this.lookup(prepared);
      if (looked.kind === "found") {
        claim = looked.claim;
      } else if (looked.authorizationClaimed) {
        return { status: "rejected" };
      } else {
        // found:false is definitive: nothing is in flight. Retry once under the same key.
        const second = await this.claimOnce(prepared);
        if (second.kind === "rejected") return { status: "rejected" };
        if (second.kind === "ambiguous") throw new OrderAuthorizationError("ambiguous_claim");
        claim = second.claim;
      }
    }

    // A fresh claim, a replay and a lookup hit all end here: none proves the
    // connector's own terms. Only the issuer's revalidate under trusted terms does.
    if (claim.actionId !== prepared.actionId) return { status: "rejected" };
    if (!(await this.revalidate(prepared, claim))) return { status: "rejected" };
    return { status: "claimed", ...claim };
  }

  async revalidateBeforeDispatch(
    check: AuthorizationCheck,
    claim: AuthorizationClaimed
  ): Promise<AuthorizationDispatchResult> {
    const result = await this.prepare(check);
    if (result.rejected) return { status: "rejected" };
    const facts = claimFacts(claim);
    if (facts === undefined || facts.actionId !== result.prepared.actionId) return { status: "rejected" };
    return (await this.revalidate(result.prepared, facts)) ? { status: "dispatchable" } : { status: "rejected" };
  }

  private async prepare(check: AuthorizationCheck): Promise<PreparedResult> {
    const rejected: PreparedResult = { rejected: true };
    const checkRecord = asRecord(check);
    const facts = asRecord(checkRecord?.facts);
    if (checkRecord === undefined || facts === undefined) throw new OrderAuthorizationError("invalid_check");
    if (facts.operation !== "submit") return rejected;
    // The connector sandbox mode, like every unmapped mode, is refused outright.
    const mode = facts.mode;
    const appProvider = typeof mode === "string" ? MODE_TO_APP_PROVIDER[mode] : undefined;
    if (mode !== "simulated" || appProvider === undefined) throw new OrderAuthorizationError("refused_mode");
    const providerId = facts.providerId;
    if (typeof providerId !== "string" || !this.trustedProviderIds.has(providerId)) {
      throw new OrderAuthorizationError("refused_provider");
    }

    const scope = asRecord(facts.trustedScope);
    const tenant = boundedString(scope?.tenantId, 160);
    const projectId = typeof scope?.projectId === "string" && PROJECT_ID.test(scope.projectId) ? scope.projectId : undefined;
    const command = asRecord(facts.command);
    const quote = asRecord(command?.quote);
    const quoteId = boundedString(quote?.quoteId, 200);
    const commandAmount = command?.amountMinor;
    const productionBundleDigest = boundedString(command?.productionBundleDigest, 512);
    if (
      tenant === undefined || projectId === undefined || command === undefined || quote === undefined ||
      quoteId === undefined || productionBundleDigest === undefined || typeof quote.totalMinor !== "number" ||
      typeof quote.currency !== "string" || typeof commandAmount !== "number" || typeof command.currency !== "string"
    ) return rejected;

    // Only the opaque token string is read from the envelope. Anything else in it is ignored.
    const envelope = asRecord(checkRecord.authorizationEnvelope);
    const token = envelope?.schema === ORDER_AUTHORIZATION_SCHEMA ? envelope.token : undefined;
    if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) return rejected;

    let resolved: unknown;
    try {
      resolved = await this.termsSource.resolve(Object.freeze({
        trustedScope: Object.freeze({ tenantId: tenant, projectId }),
        providerId,
        mode,
        productionBundleDigest,
        quote: Object.freeze({ ...quote }) as unknown as SubmitQuoteTerms
      }));
    } catch {
      return rejected;
    }
    const resolvedRecord = asRecord(resolved);
    const provenance = asRecord(resolvedRecord?.provenance);
    if (
      resolvedRecord?.status !== "bound" || provenance?.kind !== "development_fixture" ||
      typeof provenance.digest !== "string" || !DIGEST.test(provenance.digest)
    ) return rejected;
    const terms = snapshotTerms(resolvedRecord.terms);
    if (terms === undefined) return rejected;

    // The connector's own quote must agree with the terms it will name to the issuer.
    if (
      terms.quote.id !== quoteId || terms.quote.amountMinor !== commandAmount || commandAmount !== quote.totalMinor ||
      terms.quote.currency !== command.currency || command.currency !== quote.currency
    ) return rejected;

    return {
      rejected: false,
      prepared: {
        token,
        tenant,
        projectId,
        providerId,
        mode,
        appProvider,
        terms,
        claimKey: deriveOrderClaimKey({ providerId, mode, tenant, projectId, orderRef: terms.orderRef }),
        actionId: deriveOrderActionId(tenant, projectId, terms.orderRef)
      }
    };
  }

  private expectBody(prepared: PreparedCheck, claimReference?: string): Json {
    const terms = prepared.terms;
    return {
      tenant: prepared.tenant,
      project: `stub:${prepared.projectId}`,
      action: ORDER_AUTHORIZATION_ACTION,
      provider: prepared.appProvider,
      terms: {
        orderRef: terms.orderRef,
        sku: terms.sku,
        options: { ...terms.options },
        quote: { ...terms.quote },
        destination: { ...terms.destination },
        design: { ...terms.design },
        approvalId: terms.approvalId,
        capabilityVersion: terms.capabilityVersion
      },
      ...(claimReference === undefined ? {} : { claimReference })
    };
  }

  /** Signs exact body text, sends exactly that text and bounds the wait. A port failure or timeout is reported, never thrown. */
  private async exchange(path: string, bodyText: string): Promise<Exchange> {
    let signed: { readonly timestamp: number; readonly signature: string };
    try {
      signed = await this.signer.sign({ method: "POST", path, bodyText });
    } catch {
      throw new OrderAuthorizationError("key_unavailable");
    }
    const { timestamp, signature } = signed;
    if (!Number.isSafeInteger(timestamp) || typeof signature !== "string" || !HEX64.test(signature)) {
      throw new OrderAuthorizationError("key_unavailable");
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Exchange>((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve({ kind: "failure", code: "timeout" });
      }, this.timeoutMs);
    });
    const send = (async (): Promise<Exchange> => {
      try {
        const response = await this.http.send(Object.freeze({
          method: "POST" as const,
          path,
          headers: Object.freeze({
            "content-type": "application/json",
            [ORDER_AUTHORIZATION_CONSUMER_HEADERS.timestamp]: String(timestamp),
            [ORDER_AUTHORIZATION_CONSUMER_HEADERS.signature]: signature
          }),
          bodyText,
          signal: controller.signal
        }));
        const record = asRecord(response);
        if (
          record === undefined || typeof record.status !== "number" || !Number.isInteger(record.status) ||
          typeof record.bodyText !== "string" || record.bodyText.length > MAX_RESPONSE_CHARS
        ) return { kind: "failure", code: "transport_failed" };
        return { kind: "response", status: record.status, text: record.bodyText };
      } catch {
        return { kind: "failure", code: "transport_failed" };
      }
    })();
    try {
      return await Promise.race([send, timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async claimOnce(prepared: PreparedCheck): Promise<ClaimOnce> {
    const bodyText = JSON.stringify({
      token: prepared.token,
      idempotencyKey: prepared.claimKey,
      expect: this.expectBody(prepared)
    });
    const exchange = await this.exchange(ORDER_AUTHORIZATION_PATHS.claim, bodyText);
    // Transport errors, timeouts, 5xx (other than the issuer's own pre-commit 503)
    // and a 200 whose body is not JSON may follow a committed claim.
    if (exchange.kind === "failure") return { kind: "ambiguous" };
    const { status, text } = exchange;
    if (status === 200) {
      const parsed = parseJsonText(text);
      if (!parsed.ok) return { kind: "ambiguous" };
      const body = asRecord(parsed.value);
      const facts = claimFacts(body);
      if (body?.ok !== true || body.status !== "claimed" || typeof body.replayed !== "boolean" || facts === undefined) {
        throw new OrderAuthorizationError("malformed_response");
      }
      return { kind: "claimed", claim: facts };
    }
    if (status >= 500 && status <= 599 && status !== 503) return { kind: "ambiguous" };
    if (this.isRejectionStatus(status)) return this.rejection(text);
    throw new OrderAuthorizationError("unexpected_status");
  }

  private async lookup(prepared: PreparedCheck): Promise<LookupOutcome> {
    // The token is never parsed, so the lookup is by key alone.
    const bodyText = orderClaimLookupBody(prepared.tenant, prepared.projectId, prepared.claimKey);
    const exchange = await this.exchange(ORDER_AUTHORIZATION_PATHS.lookup, bodyText);
    if (exchange.kind === "failure") throw new OrderAuthorizationError("lookup_unavailable");
    if (exchange.status !== 200) throw new OrderAuthorizationError("unexpected_status");
    const parsed = parseJsonText(exchange.text);
    const body = parsed.ok ? asRecord(parsed.value) : undefined;
    if (body === undefined || body.ok !== true) throw new OrderAuthorizationError("malformed_response");
    if (body.found === true) {
      const facts = claimFacts(body.claim);
      if (facts === undefined) throw new OrderAuthorizationError("malformed_response");
      return { kind: "found", claim: facts };
    }
    if (body.found === false) {
      if (body.authorizationClaimed !== undefined && typeof body.authorizationClaimed !== "boolean") {
        throw new OrderAuthorizationError("malformed_response");
      }
      return { kind: "not_found", authorizationClaimed: body.authorizationClaimed === true };
    }
    throw new OrderAuthorizationError("malformed_response");
  }

  /** True only when the issuer answers dispatchable AND every returned field matches what the connector trusts. */
  private async revalidate(prepared: PreparedCheck, claim: ClaimFacts): Promise<boolean> {
    const bodyText = JSON.stringify({
      token: prepared.token,
      expect: this.expectBody(prepared, claim.claimReference)
    });
    const exchange = await this.exchange(ORDER_AUTHORIZATION_PATHS.revalidate, bodyText);
    if (exchange.kind === "failure") throw new OrderAuthorizationError(exchange.code);
    const { status, text } = exchange;
    if (status === 200) {
      const parsed = parseJsonText(text);
      const body = parsed.ok ? asRecord(parsed.value) : undefined;
      const record = asRecord(body?.authorization);
      if (body?.ok !== true || body.status !== "dispatchable" || record === undefined) {
        throw new OrderAuthorizationError("malformed_response");
      }
      return this.bindsTrustedValues(prepared, claim, record);
    }
    if (this.isRejectionStatus(status)) {
      this.rejection(text);
      return false;
    }
    throw new OrderAuthorizationError("unexpected_status");
  }

  private bindsTrustedValues(prepared: PreparedCheck, claim: ClaimFacts, record: Json): boolean {
    const now = this.clock.now();
    if (!Number.isFinite(now)) throw new OrderAuthorizationError("malformed_response");
    const project = asRecord(record.project);
    const tenant = asRecord(record.tenant);
    const expiresAt = typeof record.expiresAt === "string" ? Date.parse(record.expiresAt) : Number.NaN;
    return (
      record.schema === ORDER_AUTHORIZATION_SCHEMA &&
      record.id === claim.authorizationId &&
      record.actionId === claim.actionId &&
      record.actionId === prepared.actionId &&
      record.audience === ORDER_AUTHORIZATION_AUDIENCE &&
      tenant?.id === prepared.tenant &&
      project?.kind === "stub" && project.id === prepared.projectId &&
      record.action === ORDER_AUTHORIZATION_ACTION &&
      record.provider === prepared.appProvider &&
      record.mode === APP_RECORD_MODE &&
      typeof record.environment === "string" && APP_ENVIRONMENTS.includes(record.environment) &&
      canonicalJson(record.terms) === canonicalJson(this.expectBody(prepared).terms) &&
      Number.isFinite(expiresAt) && expiresAt > now
    );
  }

  private isRejectionStatus(status: number): boolean {
    return status === 403 || status === 409;
  }

  /** A 403/409 carrying a known reason is a rejection. An unknown reason or a malformed body is not a decision. */
  private rejection(text: string): { readonly kind: "rejected" } {
    const parsed = parseJsonText(text);
    const body = parsed.ok ? asRecord(parsed.value) : undefined;
    if (body === undefined || body.ok !== false || body.status !== "rejected") {
      throw new OrderAuthorizationError("malformed_response");
    }
    if (typeof body.reason !== "string" || !ORDER_AUTHORIZATION_REJECTION_REASONS.includes(body.reason)) {
      throw new OrderAuthorizationError("unknown_rejection");
    }
    return { kind: "rejected" };
  }
}

/**
 * Builds the simulated, development-only TicketStub order-authorization
 * verifier. The returned verifier implements the optional
 * `revalidateBeforeDispatch`, so the runtime revalidates before every transport
 * request.
 */
export function createTicketStubOrderAuthorizationVerifier(
  options: TicketStubOrderAuthorizationOptions
): AuthorizationVerifier {
  return new TicketStubOrderAuthorizationVerifier(options);
}
