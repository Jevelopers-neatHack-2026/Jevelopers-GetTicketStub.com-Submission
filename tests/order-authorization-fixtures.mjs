// SIMULATED ONLY. Fake issuer, fake HTTP port and runtime harness for the order-authorization consumer suite.
// No network, no server, no real key. The token key is the PUBLISHED fixture key (vendored, pinned, public on purpose) and
// the consumer key below is a synthetic test string that exists only in this file. Neither is a credential.
// The vendored producer verifier (verify.mjs, byte-identical to the pinned app commit) is the independent oracle for tokens,
// canonical JSON, action ids and consumer signatures; the code under test never imports it.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  actionIdOf,
  canonicalJson,
  commandHash,
  consumerSignature,
  signOrderAuthorization,
  verifyOrderAuthorization
} from "./fixtures/order-authorization/verify.mjs";
import {
  ALL_SHARED_SHAPES,
  CONTRACT_OWNERSHIP,
  FulfillmentConnectorRuntime,
  createConsumerRequestSigner,
  createTicketStubOrderAuthorizationVerifier
} from "../dist/index.js";

export const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "order-authorization");
export const readFixtureText = (name) => readFileSync(join(FIXTURE_DIR, name), "utf8");
export const readFixtureJson = (name) => JSON.parse(readFixtureText(name));

export const fixtureKey = readFixtureJson("fixture-key.json");
export const content = readFixtureJson("content.json");
export const provenance = readFixtureJson("provenance.json");

export const PROVIDER_ID = "fixture-provider";
export const TEST_CONSUMER_KEY = "SIMULATED-TEST-CONSUMER-KEY-0123456789-abcdef";
export const ROTATED_TOKEN_KEY = "SIMULATED-ROTATED-ISSUER-KEY-0123456789-abcdef";
export const START = Date.parse("2026-10-10T14:00:00.000Z");
export const scope = { tenantId: content.tenant, projectId: content.project.id };
export const TERMS_DIGEST = `sha256:${provenance.files.find((file) => file.path === "content.json").sha256}`;

export const sha256Hex = (text) => createHash("sha256").update(text).digest("hex");

export function makeClock(start = START) {
  const clock = { current: start, now: () => clock.current };
  return clock;
}

/** The connector's own terms for one order: the vendored synthetic terms, with the quote of the connector harness. */
export function baseTerms(orderRef = "ord_FIXTURE_0001") {
  const terms = structuredClone(content.terms);
  terms.orderRef = orderRef;
  terms.quote = { id: "quote-fixture-1", amountMinor: 1250, currency: "USD" };
  return terms;
}

export function tokenRecordOf(token) {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).authorization;
}

const HEX64 = /^[a-f0-9]{64}$/;
const REF = /^[\w.:-]{8,128}$/;
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

// ------------------------------------------------------------------------------------------------
// The fake issuer: the claim protocol with the producer's own verifier doing every judgement.
// ------------------------------------------------------------------------------------------------

export class FakeIssuer {
  constructor({ clock, tokenKey = fixtureKey.key, consumerKey = TEST_CONSUMER_KEY, recordMode = "sandbox", environment = "development", provider = "sandbox" } = {}) {
    this.clock = clock;
    this.tokenKey = tokenKey;
    this.consumerKey = consumerKey;
    this.recordMode = recordMode;
    this.environment = environment;
    this.provider = provider;
    this.records = new Map();
    this.claimsByKey = new Map();
    this.claimsByAuth = new Map();
    this.claimedActions = new Set();
    this.approval = "active";
    this.orderable = true;
    this.seq = 0;
    this.commits = 0;
    this.replays = 0;
    this.requests = [];
  }

  issue({ orderRef = "ord_FIXTURE_0001", terms, ttlMs = 15 * 60_000, tenant = scope.tenantId, projectId = scope.projectId, overrides = {} } = {}) {
    const bound = terms ?? baseTerms(orderRef);
    const n = ++this.seq;
    const record = {
      schema: "ticketstub.order-authorization/1",
      id: `oau_SIM_${n}`,
      issuer: "ticketstub",
      audience: "fulfillment-connectors",
      tenant: { id: tenant },
      project: { kind: "stub", id: projectId },
      actor: { kind: "account", id: tenant },
      action: "fulfillment.submit",
      provider: this.provider,
      actionId: actionIdOf(tenant, { kind: "stub", id: projectId }, "fulfillment.submit", bound.orderRef),
      command: { name: "submit_order", hash: commandHash("fulfillment.submit", this.provider, bound) },
      terms: bound,
      approval: { id: bound.approvalId, purpose: "print.compose" },
      idempotencyKey: `issue_SIM_${n}`,
      membershipRevision: 3,
      notAuthorizes: ["payment", "refund", "other_orders", "destination_change", "asset_rights"],
      environment: this.environment,
      mode: this.recordMode,
      issuedAt: new Date(this.clock.now()).toISOString(),
      expiresAt: new Date(this.clock.now() + ttlMs).toISOString(),
      ...overrides
    };
    if (overrides.terms === undefined && overrides.provider !== undefined) {
      record.command = { name: "submit_order", hash: commandHash("fulfillment.submit", record.provider, record.terms) };
    }
    this.records.set(record.id, { record, revoked: false, n });
    return this.tokenOf(record.id);
  }

  /** The token is derived from the record and the CURRENT signing key, exactly like the real issuer. */
  tokenOf(id) {
    return signOrderAuthorization(this.records.get(id).record, this.tokenKey);
  }

  rotateTokenKey(key) {
    this.tokenKey = key;
  }

  revoke(id) {
    this.records.get(id).revoked = true;
  }

  claimCount() {
    return this.claimsByAuth.size;
  }

  stateOf(entry, idemKey) {
    const claim = this.claimsByAuth.get(entry.record.id);
    const superseded = [...this.records.values()].some((other) => other.record.actionId === entry.record.actionId && other.n > entry.n);
    return {
      known: true,
      revoked: entry.revoked,
      superseded,
      approval: this.approval,
      membershipRevision: entry.record.membershipRevision,
      capabilityVersion: entry.record.terms.capabilityVersion,
      orderable: this.orderable,
      claim: claim ? { reference: claim.ref, keyMatches: idemKey !== undefined && claim.key === idemKey } : null
    };
  }

  reject(reason, fields) {
    const status = reason === "already_claimed" || reason === "idempotency_conflict" ? 409 : 403;
    return { status, bodyText: JSON.stringify({ ok: false, status: "rejected", reason, ...(fields ? { fields } : {}), error: { code: "authorization_invalid", message: "No." } }) };
  }

  json(status, body) {
    return { status, bodyText: JSON.stringify(body) };
  }

  parseExpect(raw, withClaim) {
    const bad = () => { throw Object.assign(new Error("bad_request"), { http: 400 }); };
    if (!isObj(raw) || typeof raw.project !== "string") bad();
    const project = /^stub:([\w.:-]{1,128})$/.exec(raw.project);
    const t = raw.terms;
    if (!project || typeof raw.tenant !== "string" || raw.tenant.length > 160 || typeof raw.action !== "string" || typeof raw.provider !== "string") bad();
    if (!isObj(t) || !isObj(t.options) || !isObj(t.quote) || !isObj(t.destination) || !isObj(t.design)) bad();
    if (!(t.sku === null || typeof t.sku === "string") || typeof t.orderRef !== "string" || !REF.test(t.orderRef) || t.orderRef.length > 64) bad();
    if (!Number.isInteger(t.quote.amountMinor) || typeof t.quote.id !== "string" || typeof t.quote.currency !== "string") bad();
    if (typeof t.destination.ref !== "string" || !REF.test(t.destination.ref) || !HEX64.test(t.destination.digest)) bad();
    if (![t.design.designHash, t.design.artHash, t.design.factsHash, t.design.compositionHash].every((h) => HEX64.test(h))) bad();
    if (typeof t.approvalId !== "string" || typeof t.capabilityVersion !== "string" || typeof t.design.versionId !== "string") bad();
    if (!Number.isInteger(t.options.quantity)) bad();
    if (withClaim && typeof raw.claimReference !== "string") bad();
    const terms = {
      orderRef: t.orderRef, sku: t.sku, options: { ...t.options }, quote: { ...t.quote }, destination: { ...t.destination }, design: { ...t.design },
      approvalId: t.approvalId, capabilityVersion: t.capabilityVersion
    };
    return {
      tenant: raw.tenant, project: { kind: "stub", id: project[1] }, action: raw.action, provider: raw.provider, terms,
      ...(withClaim ? { claimReference: raw.claimReference } : {})
    };
  }

  /** One signed consumer request in, one HTTP-shaped answer out. The path is what the consumer signed, exactly. */
  handle(path, bodyText, headers) {
    this.requests.push({ path, bodyText, headers: { ...headers } });
    const now = this.clock.now();
    const timestamp = headers["x-ticketstub-consumer-timestamp"];
    const signature = headers["x-ticketstub-consumer-signature"];
    const wanted = /^\d{10,16}$/.test(timestamp ?? "") ? consumerSignature(this.consumerKey, Number(timestamp), "POST", path, bodyText) : null;
    if (wanted === null || wanted !== signature || Math.abs(now - Number(timestamp)) > 5 * 60_000) {
      return this.json(401, { ok: false, error: { code: "consumer_unauthorized" } });
    }
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return this.json(400, { ok: false, error: { code: "bad_json" } });
    }
    try {
      if (path === "/api/order-authorizations/claim") return this.claim(body, now);
      if (path === "/api/order-authorizations/claims/lookup") return this.lookup(body, now);
      if (path === "/api/order-authorizations/revalidate") return this.revalidate(body, now);
    } catch (error) {
      if (error?.http === 400) return this.json(400, { ok: false, error: { code: "bad_request" } });
      throw error;
    }
    return this.json(404, { ok: false });
  }

  presented(token) {
    const claimed = isObj(tokenRecordOf(token)) ? tokenRecordOf(token) : null;
    return claimed === null ? null : this.records.get(claimed.id) ?? null;
  }

  claim(body, now) {
    if (!isObj(body) || typeof body.token !== "string" || typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9_.:-]{8,128}$/.test(body.idempotencyKey)) {
      return this.json(400, { ok: false, error: { code: "bad_request" } });
    }
    const expect = this.parseExpect(body.expect, false);
    const stateless = verifyOrderAuthorization(body.token, this.tokenKey, expect, { now, intent: "claim" });
    if (!stateless.ok && ["invalid_clock", "unknown", "forged", "unsupported_version"].includes(stateless.reason)) return this.reject(stateless.reason);
    const entry = this.presented(body.token);
    if (!entry) return this.reject("unknown");
    if (canonicalJson(entry.record) !== canonicalJson(tokenRecordOf(body.token))) return this.reject("forged");
    const verdict = verifyOrderAuthorization(body.token, this.tokenKey, expect, { now, state: this.stateOf(entry, body.idempotencyKey), intent: "claim" });
    if (!verdict.ok) return this.reject(verdict.reason, verdict.fields);
    const byKey = this.claimsByKey.get(body.idempotencyKey);
    if (byKey && byKey.authId !== entry.record.id) return this.reject("idempotency_conflict");
    const had = this.claimsByAuth.get(entry.record.id);
    if (had) {
      this.replays += 1;
      return this.json(200, { ok: true, status: "claimed", replayed: true, authorizationId: had.authId, actionId: had.actionId, claimReference: had.ref, claimedAt: had.claimedAt });
    }
    const claim = { authId: entry.record.id, actionId: entry.record.actionId, key: body.idempotencyKey, ref: `clm_SIM_${entry.n}`, claimedAt: new Date(now).toISOString() };
    this.claimsByAuth.set(entry.record.id, claim);
    this.claimsByKey.set(body.idempotencyKey, claim);
    this.claimedActions.add(claim.actionId);
    this.commits += 1;
    return this.json(200, { ok: true, status: "claimed", replayed: false, authorizationId: claim.authId, actionId: claim.actionId, claimReference: claim.ref, claimedAt: claim.claimedAt });
  }

  lookup(body, now) {
    const project = isObj(body) && typeof body.project === "string" ? /^stub:([\w.:-]{1,128})$/.exec(body.project) : null;
    if (!isObj(body) || typeof body.tenant !== "string" || !project || typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9_.:-]{8,128}$/.test(body.idempotencyKey)) {
      return this.json(400, { ok: false, error: { code: "bad_request" } });
    }
    const hit = this.claimsByKey.get(body.idempotencyKey);
    const entry = hit ? this.records.get(hit.authId) : undefined;
    if (hit && entry && entry.record.tenant.id === body.tenant && entry.record.project.id === project[1]) {
      // Like the producer: the authority is judged against the RECORD'S OWN terms, which proves nothing about the consumer's.
      const selfExpect = { tenant: entry.record.tenant.id, project: entry.record.project, action: entry.record.action, provider: entry.record.provider, terms: entry.record.terms, claimReference: hit.ref };
      const verdict = verifyOrderAuthorization(this.tokenOf(entry.record.id), this.tokenKey, selfExpect, { now, state: this.stateOf(entry, hit.key), intent: "revalidate" });
      return this.json(200, {
        ok: true, found: true,
        claim: { authorizationId: hit.authId, actionId: hit.actionId, claimReference: hit.ref, claimedAt: hit.claimedAt },
        authority: verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason },
        checkedAt: new Date(now).toISOString()
      });
    }
    return this.json(200, { ok: true, found: false, checkedAt: new Date(now).toISOString() });
  }

  revalidate(body, now) {
    if (!isObj(body) || typeof body.token !== "string") return this.json(400, { ok: false, error: { code: "bad_request" } });
    const expect = this.parseExpect(body.expect, true);
    const stateless = verifyOrderAuthorization(body.token, this.tokenKey, expect, { now, intent: "revalidate" });
    if (!stateless.ok && ["invalid_clock", "unknown", "forged", "unsupported_version"].includes(stateless.reason)) return this.reject(stateless.reason);
    const entry = this.presented(body.token);
    if (!entry) return this.reject("unknown");
    if (canonicalJson(entry.record) !== canonicalJson(tokenRecordOf(body.token))) return this.reject("forged");
    const claim = this.claimsByAuth.get(entry.record.id);
    const verdict = verifyOrderAuthorization(body.token, this.tokenKey, expect, { now, state: this.stateOf(entry, claim?.key), intent: "revalidate" });
    if (!verdict.ok) return this.reject(verdict.reason, verdict.fields);
    return this.json(200, { ok: true, status: "dispatchable", authorization: verdict.authorization, checkedAt: new Date(now).toISOString() });
  }
}

// ------------------------------------------------------------------------------------------------
// The fake HTTP port: records every request and injects faults around the issuer.
// ------------------------------------------------------------------------------------------------

export function pathKind(path) {
  return path.endsWith("/claim") ? "claim" : path.endsWith("/claims/lookup") ? "lookup" : path.endsWith("/revalidate") ? "revalidate" : "other";
}

export function createFakeHttp(issuer) {
  const calls = [];
  const faults = [];
  const port = {
    calls,
    fault(path, fault) {
      faults.push({ path, times: 1, ...fault });
      return port;
    },
    count(kind) {
      return calls.filter((call) => pathKind(call.path) === kind).length;
    },
    async send(request) {
      calls.push({ path: request.path, bodyText: request.bodyText, headers: { ...request.headers }, aborted: () => request.signal.aborted });
      const kind = pathKind(request.path);
      const index = faults.findIndex((fault) => (fault.path === "*" || fault.path === kind) && fault.times > 0);
      const fault = index === -1 ? undefined : faults[index];
      if (fault) fault.times -= 1;
      const run = () => issuer.handle(request.path, request.bodyText, request.headers);
      if (fault?.kind === "throw") throw new Error("connect ECONNRESET");
      if (fault?.kind === "timeout") {
        await new Promise((resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });
      }
      if (fault?.kind === "replace") return { status: fault.status, bodyText: fault.bodyText };
      const response = run();
      if (fault?.kind === "drop-after-commit") throw new Error("socket hang up");
      if (fault?.kind === "status-after-commit") return { status: fault.status, bodyText: fault.bodyText ?? "" };
      if (fault?.kind === "mutate") return fault.mutate(response);
      return response;
    }
  };
  return port;
}

export function mutateJson(change) {
  return (response) => {
    const body = JSON.parse(response.bodyText);
    const next = change(body) ?? body;
    return { status: response.status, bodyText: JSON.stringify(next) };
  };
}

// ------------------------------------------------------------------------------------------------
// Trusted terms source and verifier wiring.
// ------------------------------------------------------------------------------------------------

export function createTermsSource(options = {}) {
  const { terms, mutate, behavior } = options;
  const provenanceFor = () => ("provenance" in options ? options.provenance : { kind: "development_fixture", digest: TERMS_DIGEST });
  const source = {
    calls: [],
    terms: terms ?? baseTerms(),
    async resolve(request) {
      source.calls.push(request);
      if (behavior === "throw") throw new Error("terms source down");
      if (behavior === "missing") return { status: "missing", fields: ["destination"] };
      const bound = structuredClone(source.terms);
      if (mutate) mutate(bound);
      return { status: "bound", terms: bound, provenance: provenanceFor() };
    }
  };
  return source;
}

export function createSecretSource(getSecret = () => TEST_CONSUMER_KEY) {
  const source = {
    loads: 0,
    async load() {
      source.loads += 1;
      return { secret: getSecret(), version: `v${source.loads}`, mode: "simulated" };
    }
  };
  return source;
}

export function createVerifierHarness(options = {}) {
  const clock = options.clock ?? makeClock();
  const issuer = options.issuer ?? new FakeIssuer({ clock, ...(options.issuerOptions ?? {}) });
  const http = createFakeHttp(issuer);
  const termsSource = options.termsSource ?? createTermsSource(options.termsOptions);
  const secrets = createSecretSource(options.getSecret);
  const signer = createConsumerRequestSigner({ source: secrets, providerId: PROVIDER_ID, secretReference: "order-auth-consumer", mode: "simulated", clock });
  const verifier = createTicketStubOrderAuthorizationVerifier({
    termsSource, http, signer, clock, trustedProviderIds: options.trustedProviderIds ?? [PROVIDER_ID], ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
  });
  return { clock, issuer, http, termsSource, secrets, signer, verifier };
}

export function quoteTerms(overrides = {}) {
  return {
    quoteId: "quote-fixture-1",
    currency: "USD",
    totalMinor: 1250,
    expiresAt: "2026-10-10T15:00:00.000Z",
    productionBundleDigest: "sha256:fixture-bundle",
    termsFingerprint: "sha256:fixture-terms",
    ...overrides
  };
}

export function submitCommand(token, overrides = {}) {
  return {
    productionBundle: { fixture: "bundle" },
    productionBundleDigest: "sha256:fixture-bundle",
    quote: quoteTerms(),
    authorizationEnvelope: { schema: "ticketstub.order-authorization/1", token },
    amountMinor: 1250,
    currency: "USD",
    idempotencyKey: "idem-fixture-1",
    requestFingerprint: "sha256:fixture-request",
    ...overrides
  };
}

/** What the runtime hands the verifier for a submit (the check). */
export function authorizationCheck(token, options = {}) {
  const { mode = "simulated", providerId = PROVIDER_ID, operation = "submit", command, trustedScope = scope } = options;
  const { authorizationEnvelope, idempotencyKey, requestFingerprint, ...facts } = command ?? submitCommand(token);
  void authorizationEnvelope; void idempotencyKey; void requestFingerprint;
  const envelope = Object.hasOwn(options, "envelope") ? options.envelope : { schema: "ticketstub.order-authorization/1", token };
  return { authorizationEnvelope: envelope, facts: { providerId, mode, trustedScope, operation, command: facts } };
}

// ------------------------------------------------------------------------------------------------
// Runtime harness: the real FulfillmentConnectorRuntime over fake ports. Order of effects is recorded in `events`.
// ------------------------------------------------------------------------------------------------

const operationNames = ["discover_capabilities", "quote", "preflight", "submit", "status", "shipment", "cancel"];

function createBindings(overrides = {}) {
  const bindings = new Map();
  for (const shape of ALL_SHARED_SHAPES) {
    const bytes = JSON.stringify({ shape, version: "1.0.0", label: "order-authorization suite local development fixture; never an upstream acceptance pin" });
    bindings.set(shape, {
      shape, ...CONTRACT_OWNERSHIP[shape], state: "development_fixture", schemaVersion: "1.0.0",
      sourceRevision: "local-order-authorization-suite-fixture", fixtureDigest: `sha256:${sha256Hex(bytes)}`
    });
  }
  for (const [shape, binding] of Object.entries(overrides)) bindings.set(shape, { ...bindings.get(shape), ...binding });
  return bindings;
}

export function createRuntimeHarness(options = {}) {
  const verifierParts = options.verifierParts ?? createVerifierHarness(options);
  const { clock } = verifierParts;
  const events = [];
  const state = { transportCalls: [], budgetCalls: 0, adapterCalls: 0, attempts: new Map(), events, observations: [] };
  const bindings = createBindings(options.bindingOverrides);
  const contracts = {
    binding: (shape) => bindings.get(shape),
    async validateInbound(request) {
      const input = request.envelope;
      if (input === null || typeof input !== "object") return { ok: false, failure: { code: "invalid_input" } };
      return { ok: true, value: input.command, receipts: request.requiredShapes.map((shape) => ({ shape, schemaVersion: "1.0.0", tenantId: input.tenantId, projectId: input.projectId })) };
    },
    async validateOutbound(request) {
      return { ok: true, value: request.value, receipts: request.requiredShapes.map((shape) => ({ shape, schemaVersion: "1.0.0", tenantId: request.trustedScope.tenantId, projectId: request.trustedScope.projectId })) };
    }
  };
  const operations = Object.fromEntries(operationNames.map((operation) => [operation, {
    supported: true,
    sideEffect: operation === "submit" || operation === "cancel" ? "external" : "none",
    mayCharge: operation === "submit",
    idempotency: operation === "submit" ? "connector_attempt_store" : operation === "cancel" ? "provider_key" : "not_applicable"
  }]));
  const transportRequests = options.transportRequests ?? 1;
  const adapter = {
    descriptor: { providerId: PROVIDER_ID, apiVersion: "private-fixture-api/1", productLimits: { maxItems: 10 }, operations, supportedModes: ["simulated", "sandbox"] },
    async validateBeforeSubmit() { return { status: "supported", value: { valid: true, issues: [] } }; },
    async submit(command, context) {
      state.adapterCalls += 1;
      for (let attempt = 0; attempt < transportRequests; attempt += 1) {
        await context.transport.request({ operation: "submit", method: "POST", path: "/fixture/orders", body: command, idempotencyKey: command.idempotencyKey });
      }
      return { status: "supported", value: { providerRequestId: "request-fixture-1", acceptedAt: "2026-10-10T14:00:00.000Z" } };
    },
    async quote() { return { status: "unsupported" }; },
    async preflight() { return { status: "unsupported" }; },
    async getStatus() { return { status: "unsupported" }; },
    async observeShipment() { return { status: "unsupported" }; },
    async cancel() { return { status: "unsupported" }; }
  };
  const mode = options.runtimeOptions?.mode ?? "simulated";
  const attemptKey = (record) => `${record.providerId}/${record.tenantId}/${record.projectId}/${record.idempotencyKey}`;
  const usageSink = { async record() {} };
  const dependencies = {
    contracts,
    transport: {
      mode,
      async request(request) {
        events.push("transport");
        state.transportCalls.push(request);
        return { fixture: true };
      }
    },
    clock,
    persistence: {
      async getSubmitAttempt(providerId, trustedScope, key) {
        return state.attempts.get(`${providerId}/${trustedScope.tenantId}/${trustedScope.projectId}/${key}`);
      },
      async claimSubmitAttempt(record) {
        const existing = state.attempts.get(attemptKey(record));
        const action = [...state.attempts.values()].find((attempt) => attempt.actionId === record.actionId || attempt.authorizationId === record.authorizationId);
        if (existing !== undefined || action !== undefined) return { claimed: false, existing: existing ?? action };
        state.attempts.set(attemptKey(record), record);
        return { claimed: true };
      },
      async saveSubmitAttempt(record) { state.attempts.set(attemptKey(record), record); }
    },
    authorizationVerifier: options.authorizationVerifier ?? verifierParts.verifier,
    budgetClient: {
      async authorize() {
        state.budgetCalls += 1;
        events.push("budget");
        if (options.onBudget) await options.onBudget(verifierParts);
        return { authorized: true, reference: "fixture-budget-reference" };
      }
    },
    usageSink,
    metering: async (requestedScope) => ({
      isConfiguredFor: (providerId, runtimeMode, suppliedScope) =>
        providerId === PROVIDER_ID && runtimeMode === mode && suppliedScope.tenantId === requestedScope.tenantId && suppliedScope.projectId === requestedScope.projectId,
      async replayPending() { return { pending: 0, failures: [] }; },
      async recordObservation(observation) {
        state.observations.push(observation.outcome);
        events.push(`metering:${observation.outcome}`);
        if (observation.outcome === "dispatching" && options.onDispatchingMetering) await options.onDispatchingMetering(verifierParts);
        const validation = await contracts.validateOutbound({
          operation: observation.operation, requiredShapes: ["fulfillment_usage"],
          value: { ...structuredClone(observation), providerId: PROVIDER_ID, mode }, trustedScope: requestedScope
        });
        if (!validation.ok) return { status: "blocked", reason: "contract_unavailable" };
        await usageSink.record(validation.value);
        return { status: "recorded" };
      }
    })
  };
  const runtime = new FulfillmentConnectorRuntime(adapter, dependencies, options.runtimeOptions);
  return { ...verifierParts, runtime, state, dependencies, adapter, events };
}

export const envelope = (command) => ({ tenantId: scope.tenantId, projectId: scope.projectId, command });

export function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
