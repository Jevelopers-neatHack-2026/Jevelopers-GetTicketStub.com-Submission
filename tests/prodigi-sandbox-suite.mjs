import assert from "node:assert/strict";
import {
  createEnvServerSecretSource,
  createFetchProdigiHttpPort,
  createProdigiQuotePort,
  executePrivateQuote,
  mapOrderRequest,
  mapQuoteRequest,
  PRODIGI_SANDBOX_SECRET_BINDING,
  ProdigiSandboxClient,
  ProdigiSandboxError,
  projectQuoteResponse,
  SecretResolverError,
  toStatusResult,
  withServerSecret
} from "../dist/index.js";
import * as packageRoot from "../dist/index.js";
import {
  FIXTURE_ORDER_ID,
  FIXTURE_SANDBOX_KEY,
  FIXTURE_SKU,
  fixtureDecision,
  fixtureVerifier,
  orderInput,
  orderResponse,
  quoteResponse,
  recordingHttp
} from "./prodigi-sandbox-fixtures.mjs";
import { catalogA, contractValidator, copyCatalog, quoteScope, selectionFor } from "./quote-fixtures.mjs";

// Network guard: any accidental use of global fetch fails the suite.
let globalFetchCalls = 0;
globalThis.fetch = async () => {
  globalFetchCalls += 1;
  throw new Error("network is forbidden in the Prodigi sandbox suite");
};

const cases = [];
const add = (name, run) => cases.push([name, run]);

function sandboxEnv(value = FIXTURE_SANDBOX_KEY) {
  return { PRODIGI_SANDBOX_API_KEY: value };
}

function countingSecrets(env = sandboxEnv()) {
  const source = createEnvServerSecretSource({ bindings: [PRODIGI_SANDBOX_SECRET_BINDING], env });
  const counter = { loads: 0 };
  return {
    counter,
    source: {
      async load(input) {
        counter.loads += 1;
        return source.load(input);
      }
    }
  };
}

function client({ http, secrets = countingSecrets().source, enabled = true, verifier = fixtureVerifier(), decision = fixtureDecision, timeoutMs } = {}) {
  return new ProdigiSandboxClient({
    http: http.port,
    secrets,
    decision,
    decisionVerifier: verifier,
    ...(enabled === undefined ? {} : { sandboxCallsEnabled: enabled }),
    ...(timeoutMs === undefined ? {} : { timeoutMs })
  });
}

function quoteRequest(overrides = {}) {
  return {
    providerId: "prodigi",
    apiVersion: "v4.0",
    catalogVersion: "fixture",
    catalogSnapshotIdentity: "sha256:fixture",
    catalogContentIdentity: "sha256:fixture",
    sku: FIXTURE_SKU,
    variantId: "matte-white",
    specIdentity: "sha256:fixture",
    selectionDigest: "sha256:fixture",
    quantity: 25,
    options: [],
    materials: [],
    destination: { reference: "destination:fixture-a", digest: `sha256:${"a".repeat(64)}`, countryCode: "US", regionCode: "CA" },
    shippingMethod: "express",
    personalization: null,
    requestDigest: `sha256:${"b".repeat(64)}`,
    ...overrides
  };
}

async function rejectsWith(promise, code, sideEffectState) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ProdigiSandboxError, `expected ProdigiSandboxError, got ${error?.name}`);
    assert.equal(error.code, code);
    if (sideEffectState !== undefined) assert.equal(error.sideEffectState, sideEffectState);
    assert.equal(String(error.message).includes(FIXTURE_SANDBOX_KEY), false);
    assert.equal(JSON.stringify(error).includes(FIXTURE_SANDBOX_KEY), false);
    return true;
  });
}

// --- Secret-reference resolver -------------------------------------------------

add("secret resolver reads the sandbox reference from env on every call without caching", async () => {
  const env = sandboxEnv("first-fixture-value");
  const source = createEnvServerSecretSource({ bindings: [PRODIGI_SANDBOX_SECRET_BINDING], env });
  const first = await source.load({ providerId: "prodigi", secretReference: "prodigi/sandbox/api-key", mode: "sandbox" });
  assert.deepEqual(first, { secret: "first-fixture-value", version: "env-unversioned", mode: "sandbox" });
  env.PRODIGI_SANDBOX_API_KEY = "rotated-fixture-value";
  const second = await source.load({ providerId: "prodigi", secretReference: "prodigi/sandbox/api-key", mode: "sandbox" });
  assert.equal(second.secret, "rotated-fixture-value");
  assert.ok(Object.isFrozen(second));
});

add("secret resolver returns nothing for simulated mode, other providers, unknown references and bad values", async () => {
  const source = createEnvServerSecretSource({ bindings: [PRODIGI_SANDBOX_SECRET_BINDING], env: sandboxEnv() });
  const base = { providerId: "prodigi", secretReference: "prodigi/sandbox/api-key" };
  assert.equal(await source.load({ ...base, mode: "simulated" }), undefined);
  assert.equal(await source.load({ ...base, mode: "live" }), undefined);
  assert.equal(await source.load({ ...base, providerId: "other", mode: "sandbox" }), undefined);
  assert.equal(await source.load({ ...base, secretReference: "PRODIGI_SANDBOX_API_KEY", mode: "sandbox" }), undefined);
  for (const value of [undefined, "", " padded ", "has space", "x".repeat(4097)]) {
    const env = value === undefined ? {} : { PRODIGI_SANDBOX_API_KEY: value };
    const s = createEnvServerSecretSource({ bindings: [PRODIGI_SANDBOX_SECRET_BINDING], env });
    assert.equal(await s.load({ ...base, mode: "sandbox" }), undefined);
  }
  const inherited = createEnvServerSecretSource({ bindings: [PRODIGI_SANDBOX_SECRET_BINDING], env: Object.create({ PRODIGI_SANDBOX_API_KEY: "inherited" }) });
  assert.equal(await inherited.load({ ...base, mode: "sandbox" }), undefined);
});

add("missing credential fails through withServerSecret without exposing the reference value", async () => {
  const source = createEnvServerSecretSource({ bindings: [PRODIGI_SANDBOX_SECRET_BINDING], env: {} });
  let used = false;
  await assert.rejects(withServerSecret({
    providerId: "prodigi", secretReference: "prodigi/sandbox/api-key", mode: "sandbox", source,
    use: async () => { used = true; }
  }), (error) => error.code === "server_secret_unavailable");
  assert.equal(used, false);
});

add("live bindings are refused by default and never issue a lease even when the future flag is set", async () => {
  const live = { reference: "prodigi/live/api-key", providerId: "prodigi", credentialClass: "live", envVar: "PRODIGI_LIVE_API_KEY" };
  assert.throws(() => createEnvServerSecretSource({ bindings: [PRODIGI_SANDBOX_SECRET_BINDING, live], env: {} }),
    (error) => error instanceof SecretResolverError && error.code === "live_binding_refused");
  const env = { ...sandboxEnv(), PRODIGI_LIVE_API_KEY: "live-fixture-value" };
  const source = createEnvServerSecretSource({ bindings: [PRODIGI_SANDBOX_SECRET_BINDING, live], env, allowLiveCredentialBindings: true });
  for (const mode of ["sandbox", "live", "simulated"]) {
    assert.equal(await source.load({ providerId: "prodigi", secretReference: "prodigi/live/api-key", mode }), undefined);
  }
});

add("sandbox and live references stay distinct by name, variable and class", () => {
  const code = (bindings, options = {}) => {
    try {
      createEnvServerSecretSource({ bindings, env: {}, ...options });
      return "accepted";
    } catch (error) {
      assert.ok(error instanceof SecretResolverError);
      return error.code;
    }
  };
  const sandbox = (envVar, reference = "prodigi/sandbox/api-key") => ({ reference, providerId: "prodigi", credentialClass: "sandbox", envVar });
  assert.equal(code([sandbox("PRODIGI_API_KEY")]), "class_name_mismatch");
  assert.equal(code([sandbox("PRODIGI_SANDBOX_LIVE_KEY")]), "class_name_mismatch");
  assert.equal(code([sandbox("PRODIGI_PROD_SANDBOX_KEY")]), "class_name_mismatch");
  assert.equal(code([{ ...sandbox("PRODIGI_SANDBOX_API_KEY"), credentialClass: "live" }], { allowLiveCredentialBindings: true }), "class_name_mismatch");
  assert.equal(code([sandbox("PRODIGI_SANDBOX_API_KEY"), sandbox("PRODIGI_SANDBOX_API_KEY", "prodigi/sandbox/other")]), "duplicate_binding");
  assert.equal(code([sandbox("PRODIGI_SANDBOX_API_KEY"), sandbox("PRODIGI_SANDBOX_KEY_B")]), "duplicate_binding");
  assert.equal(code([]), "invalid_binding");
  assert.equal(code([{ ...sandbox("lowercase_sandbox") }]), "invalid_binding");
  assert.equal(code([{ ...sandbox("PRODIGI_SANDBOX_API_KEY"), credentialClass: "staging" }]), "invalid_binding");
  assert.equal(code([sandbox("PRODIGI_SANDBOX_API_KEY")]), "accepted");
});

add("the package declares only the sandbox binding and no PRODIGI_API_KEY binding", () => {
  assert.deepEqual({ ...PRODIGI_SANDBOX_SECRET_BINDING }, {
    reference: "prodigi/sandbox/api-key", providerId: "prodigi", credentialClass: "sandbox", envVar: "PRODIGI_SANDBOX_API_KEY"
  });
  assert.ok(Object.isFrozen(PRODIGI_SANDBOX_SECRET_BINDING));
  const serialized = JSON.stringify(Object.values(packageRoot).filter((value) => value !== null && typeof value === "object"));
  assert.equal(serialized.includes("\"PRODIGI_API_KEY\""), false);
  assert.equal(serialized.includes("\"live\",\"envVar\""), false);
});

// --- Request mapping ------------------------------------------------------------

add("quote mapping produces the documented v4 create-quote body", () => {
  const body = mapQuoteRequest(quoteRequest(), { currencyCode: "USD", attributes: { wrap: "White" } });
  assert.deepEqual(JSON.parse(JSON.stringify(body)), {
    shippingMethod: "Express",
    destinationCountryCode: "US",
    currencyCode: "USD",
    items: [{ sku: FIXTURE_SKU, copies: 25, attributes: { wrap: "White" }, assets: [{ printArea: "default" }] }]
  });
  const invalid = (request, config = { currencyCode: "USD" }) => assert.throws(() => mapQuoteRequest(request, config), (e) => e.code === "invalid_input");
  invalid(quoteRequest({ providerId: "fixture-provider-alpha" }));
  invalid(quoteRequest({ shippingMethod: "tracked" }));
  invalid(quoteRequest({ quantity: 0 }));
  invalid(quoteRequest({ personalization: { mode: "variable_text", fieldCount: 1 } }));
  invalid(quoteRequest(), { currencyCode: "JPY" });
  invalid(quoteRequest(), { currencyCode: "USD", attributes: { "bad key": "x" } });
});

add("order mapping produces the documented v4 create-order body and validates inputs", () => {
  const body = JSON.parse(JSON.stringify(mapOrderRequest(orderInput())));
  assert.deepEqual(body, {
    merchantReference: "merchant-ref-fixture-1",
    idempotencyKey: "idem-fixture-1",
    shippingMethod: "Express",
    recipient: {
      name: "Fixture Recipient Name",
      address: { line1: "1 Fixture Placeholder Way", postalOrZipCode: "ZZ-FIXTURE-POSTAL", countryCode: "US", townOrCity: "Fixtureville", stateOrCounty: "CA" }
    },
    items: [{
      sku: FIXTURE_SKU, copies: 1, sizing: "fillPrintArea", attributes: {},
      assets: [{ printArea: "default", url: "https://assets.example.invalid/fixture.png", md5Hash: "0".repeat(32) }],
      merchantReference: "item-ref-fixture-1"
    }]
  });
  assert.equal("callbackUrl" in body || "metadata" in body, false);
  const invalid = (input) => assert.throws(() => mapOrderRequest(input), (e) => e.code === "invalid_input");
  invalid(orderInput({ idempotencyKey: "" }));
  invalid(orderInput({ items: [] }));
  invalid(orderInput({ items: [{ ...orderInput().items[0], assets: [{ printArea: "default", url: "http://insecure.example/x.png" }] }] }));
  invalid(orderInput({ items: [{ ...orderInput().items[0], sizing: "crop" }] }));
  invalid(orderInput({ recipient: { name: "x", address: { ...orderInput().recipient.address, countryCode: "usa" } } }));
});

// --- Gates before any request ----------------------------------------------------

add("sandbox calls are disabled by default: no secret read and no request", async () => {
  const http = recordingHttp([]);
  const secrets = countingSecrets();
  const c = new ProdigiSandboxClient({ http: http.port, secrets: secrets.source, decision: fixtureDecision, decisionVerifier: fixtureVerifier() });
  await rejectsWith(c.getOrder(FIXTURE_ORDER_ID), "sandbox_calls_disabled", "not_dispatched");
  await rejectsWith(c.createQuote(quoteRequest(), { currencyCode: "USD" }), "sandbox_calls_disabled", "not_dispatched");
  assert.equal(http.calls.length, 0);
  assert.equal(secrets.counter.loads, 0);
});

add("an unverified owner decision or a request outside the decision sends nothing", async () => {
  const http = recordingHttp([]);
  const secrets = countingSecrets();
  const rejecting = client({ http, secrets: secrets.source, verifier: fixtureVerifier({ approve: false }) });
  await rejectsWith(rejecting.getOrder(FIXTURE_ORDER_ID), "decision_unverified", "not_dispatched");
  const ok = client({ http, secrets: secrets.source });
  await rejectsWith(ok.createQuote(quoteRequest({ sku: "other-sku" }), { currencyCode: "USD" }), "decision_mismatch");
  await rejectsWith(ok.createQuote(quoteRequest({ shippingMethod: "standard" }), { currencyCode: "USD" }), "decision_mismatch");
  await rejectsWith(ok.createQuote(quoteRequest({ destination: { ...quoteRequest().destination, countryCode: "GB" } }), { currencyCode: "USD" }), "decision_mismatch");
  await rejectsWith(ok.createOrder(orderInput({ shippingMethod: "budget" })), "decision_mismatch", "not_dispatched");
  assert.equal(http.calls.length, 0);
  assert.equal(secrets.counter.loads, 0);
});

add("a missing sandbox credential stops before the HTTP port", async () => {
  const http = recordingHttp([]);
  const c = client({ http, secrets: countingSecrets({}).source });
  await rejectsWith(c.getOrder(FIXTURE_ORDER_ID), "credential_unavailable", "not_dispatched");
  assert.equal(http.calls.length, 0);
});

// --- Quote --------------------------------------------------------------------------

add("quote sends one sandbox POST with the key header and projects exact provider terms", async () => {
  const http = recordingHttp([{ body: quoteResponse() }]);
  const quote = await client({ http }).createQuote(quoteRequest(), { currencyCode: "USD" });
  assert.equal(http.calls.length, 1);
  const call = http.calls[0];
  assert.equal(call.method, "POST");
  assert.equal(call.url, "https://api.sandbox.prodigi.com/v4.0/quotes");
  assert.equal(call.headers["X-API-Key"], FIXTURE_SANDBOX_KEY);
  assert.equal(call.headers["Content-Type"], "application/json");
  assert.equal(JSON.parse(call.body).shippingMethod, "Express");
  assert.match(quote.providerQuoteReference, /^prodigi-quote:sha256-[a-f0-9]{64}$/);
  assert.deepEqual(JSON.parse(JSON.stringify({ ...quote, providerQuoteReference: "x" })), {
    providerQuoteReference: "x",
    currency: "USD",
    currencyScale: 2,
    breakdown: {
      production: { state: "known", decimal: "20.00" },
      shipping: { state: "known", decimal: "8.50" },
      tax: { state: "known", decimal: "2.28" },
      fee: { state: "known", decimal: "0" }
    },
    taxBasis: "excluded",
    total: { state: "known", decimal: "30.78" },
    providerExpiry: { state: "unknown", reasonCode: "not_disclosed" },
    leadTime: { state: "unknown", reasonCode: "not_disclosed" },
    warnings: [],
    providerNotes: []
  });
  assert.equal(JSON.stringify(quote).includes(FIXTURE_SANDBOX_KEY), false);
});

add("quote tax basis comes only from exact reconciliation; missing totals stay unknown", () => {
  const expected = { shippingMethod: "Express", currencyCode: "USD", requestDigest: "d" };
  const included = projectQuoteResponse(quoteResponse({ costSummary: { totalTax: { amount: "2.28", currency: "USD" }, totalCost: { amount: "28.50", currency: "USD" } } }), expected);
  assert.equal(included.taxBasis, "included");
  const mismatch = projectQuoteResponse(quoteResponse({ costSummary: { totalCost: { amount: "99.00", currency: "USD" } } }), expected);
  assert.equal(mismatch.taxBasis, "unknown");
  const summary = quoteResponse();
  delete summary.quotes[0].costSummary.totalTax;
  delete summary.quotes[0].costSummary.totalCost;
  const partial = projectQuoteResponse(summary, expected);
  assert.deepEqual(partial.breakdown.tax, { state: "unknown", reasonCode: "not_provided" });
  assert.deepEqual(partial.total, { state: "unknown", reasonCode: "not_provided" });
  assert.equal(partial.taxBasis, "unknown");
  const branded = projectQuoteResponse(quoteResponse({ costSummary: { branding: { amount: "1.00", currency: "USD" }, totalCost: { amount: "31.78", currency: "USD" } } }), expected);
  assert.deepEqual(branded.breakdown.fee, { state: "known", decimal: "1.00" });
  assert.equal(branded.taxBasis, "excluded");
});

add("quote projection selects the requested method and rejects malformed terms", () => {
  const expected = { shippingMethod: "Express", currencyCode: "USD", requestDigest: "d" };
  const budget = quoteResponse().quotes[0];
  const two = quoteResponse({ extraQuotes: [{ ...budget, shipmentMethod: "Budget", costSummary: { ...budget.costSummary, items: { amount: "1.00", currency: "USD" } } }] });
  assert.equal(projectQuoteResponse(two, expected).breakdown.production.decimal, "20.00");
  const invalid = (body) => assert.throws(() => projectQuoteResponse(body, expected), (e) => e.code === "invalid_response");
  invalid({ ...quoteResponse(), outcome: "ValidationFailed" });
  invalid(quoteResponse({ costSummary: { items: { amount: "20.00", currency: "GBP" } } }));
  invalid(quoteResponse({ costSummary: { items: { amount: 20, currency: "USD" } } }));
  invalid(quoteResponse({ costSummary: { shipping: { amount: "8.505", currency: "USD" } } }));
  invalid(quoteResponse({ costSummary: { items: undefined } }));
  invalid(quoteResponse({ quote: { shipmentMethod: "Budget" } }));
  invalid(quoteResponse({ extraQuotes: [quoteResponse().quotes[0]] }));
  const withIssues = projectQuoteResponse({ ...quoteResponse(), outcome: "createdWithIssues", issues: [{ errorCode: "destinationCountryCode.UsSalesTaxWarning", description: "free text dropped" }] }, expected);
  assert.deepEqual([...withIssues.warnings], ["destinationCountryCode.UsSalesTaxWarning"]);
  assert.equal(JSON.stringify(withIssues).includes("free text dropped"), false);
});

add("the Prodigi quote port feeds executePrivateQuote end to end without order calls", async () => {
  const catalog = copyCatalog(catalogA);
  catalog.providerId = "prodigi";
  catalog.apiVersion = "v4.0";
  const snapshot = await (await import("../dist/catalog.js")).normalizeCatalogSnapshot(catalog);
  const http = recordingHttp([{ body: quoteResponse() }]);
  const port = createProdigiQuotePort(client({ http }), { currencyCode: "USD" });
  assert.deepEqual(Object.keys(port), ["quote"]);
  const result = await executePrivateQuote({
    catalogSource: catalog,
    selection: selectionFor(snapshot, { personalization: null, destination: { countryCode: "US", regionCode: "CA" }, shippingMethod: "express" }),
    quantity: 25,
    destinationReference: "destination:fixture-a",
    destinationDigest: `sha256:${"a".repeat(64)}`
  }, {
    quotePort: port,
    contracts: contractValidator(),
    clock: { now: () => Date.parse("2026-10-10T10:30:00.000Z") },
    trustedScope: quoteScope
  });
  assert.equal(result.quote.status, "complete");
  assert.equal(result.quote.breakdown.total.value.minorUnits, "3078");
  assert.equal(result.quote.financialEffect, "quote_only");
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].url, "https://api.sandbox.prodigi.com/v4.0/quotes");
});

// --- Order create and status --------------------------------------------------------

add("order creation posts once to /v4.0/Orders and returns a PII-free observation", async () => {
  const http = recordingHttp([{ body: orderResponse() }]);
  const observation = await client({ http }).createOrder(orderInput());
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].method, "POST");
  assert.equal(http.calls[0].url, "https://api.sandbox.prodigi.com/v4.0/Orders");
  assert.equal(JSON.parse(http.calls[0].body).idempotencyKey, "idem-fixture-1");
  assert.equal(observation.orderId, FIXTURE_ORDER_ID);
  assert.equal(observation.outcome, "created");
  assert.equal(observation.normalizedState, "accepted");
  const serialized = JSON.stringify(observation);
  for (const text of ["Fixture Recipient Name", "Placeholder Way", "Fixtureville", "ZZ-FIXTURE-POSTAL", "assets.example.invalid", FIXTURE_SANDBOX_KEY]) {
    assert.equal(serialized.includes(text), false, `observation leaked ${text}`);
  }
  for (const outcome of ["AlreadyExists", "createdWithIssues", "OnHold"]) {
    const replay = recordingHttp([{ body: orderResponse({ outcome }) }]);
    assert.equal((await client({ http: replay }).createOrder(orderInput())).outcome, outcome.toLowerCase());
  }
});

add("order read uses GET without a body and maps documented stages conservatively", async () => {
  const shipped = orderResponse({
    stage: "Complete",
    details: { downloadAssets: "Complete", printReadyAssetsPrepared: "Complete", allocateProductionLocation: "Complete", inProduction: "Complete", shipping: "Complete" },
    shipments: [{ id: "shp_fixture1", status: "Shipped", carrier: { name: "FixtureCarrier", service: "Express" }, tracking: { number: "TRACK-FIXTURE-1", url: "https://tracking.example.invalid/x" }, dispatchDate: "2026-10-12T09:00:00Z", items: [{ itemId: "ori_fixture1" }] }]
  });
  const http = recordingHttp([
    { body: { ...orderResponse({ details: { downloadAssets: "Complete", inProduction: "InProgress" } }), outcome: "Ok" } },
    { body: { ...shipped, outcome: "Ok" } },
    { body: { ...orderResponse({ stage: "Cancelled" }), outcome: "Ok" } },
    { body: { ...orderResponse({ details: { downloadAssets: "Error" }, issues: [{ objectId: "ori_fixture1", errorCode: "order.items.assets.FailedToDownloaded", description: "x" }] }), outcome: "Ok" } }
  ]);
  const c = client({ http });
  const inProduction = await c.getOrder(FIXTURE_ORDER_ID);
  assert.equal(http.calls[0].method, "GET");
  assert.equal(http.calls[0].url, `https://api.sandbox.prodigi.com/v4.0/orders/${FIXTURE_ORDER_ID}`);
  assert.equal(http.calls[0].body, undefined);
  assert.equal(http.calls[0].headers["Content-Type"], undefined);
  assert.equal(inProduction.normalizedState, "in_production");
  const complete = await c.getOrder(FIXTURE_ORDER_ID);
  assert.equal(complete.normalizedState, "shipped");
  assert.deepEqual(JSON.parse(JSON.stringify(complete.shipments)), [{ id: "shp_fixture1", status: "Shipped", carrier: "FixtureCarrier", trackingNumber: "TRACK-FIXTURE-1", dispatchDate: "2026-10-12T09:00:00Z" }]);
  assert.equal(JSON.stringify(complete).includes("tracking.example.invalid"), false);
  assert.equal((await c.getOrder(FIXTURE_ORDER_ID)).normalizedState, "cancelled");
  const errored = await c.getOrder(FIXTURE_ORDER_ID);
  assert.equal(errored.normalizedState, "unknown");
  assert.deepEqual([...errored.issueCodes], ["order.items.assets.FailedToDownloaded"]);
  assert.deepEqual({ ...toStatusResult(complete, "2026-10-12T10:00:00.000Z") }, {
    providerRequestId: FIXTURE_ORDER_ID, providerStatus: "Complete", normalizedState: "shipped", observedAt: "2026-10-12T10:00:00.000Z"
  });
  await rejectsWith(c.getOrder("../orders/ord_x"), "invalid_input", "not_dispatched");
  await rejectsWith(c.getOrder("ord_1?x=1"), "invalid_input", "not_dispatched");
});

// --- Failure classification ---------------------------------------------------------

add("HTTP failures map to typed errors; uncertain order creation reports unknown side effects", async () => {
  const errorBody = { statusText: "fixture", statusCode: 0, data: { echoed: FIXTURE_SANDBOX_KEY }, traceParent: "x" };
  const expectations = [
    [401, "authentication_failed", "not_dispatched", "not_dispatched"],
    [400, "validation_failed", "not_dispatched", "not_dispatched"],
    [404, "not_found", "not_dispatched", "not_dispatched"],
    [429, "rate_limited", "not_dispatched", "not_dispatched"],
    [500, "provider_unavailable", "not_dispatched", "unknown"],
    [302, "provider_unavailable", "not_dispatched", "unknown"]
  ];
  for (const [status, code, readEffect, submitEffect] of expectations) {
    const http = recordingHttp([{ status, body: errorBody }, { status, body: errorBody }]);
    const c = client({ http });
    await rejectsWith(c.getOrder(FIXTURE_ORDER_ID), code, readEffect);
    await rejectsWith(c.createOrder(orderInput()), code, submitEffect);
  }
  const thrown = recordingHttp([() => { throw new Error(`socket reset ${FIXTURE_SANDBOX_KEY}`); }]);
  await rejectsWith(client({ http: thrown }).createOrder(orderInput()), "provider_unavailable", "unknown");
  const malformed = recordingHttp([{ body: "{not json" }, { body: { ...orderResponse(), outcome: "Created", order: { id: "bad" } } }]);
  const c = client({ http: malformed });
  await rejectsWith(c.createOrder(orderInput()), "invalid_response", "unknown");
  await rejectsWith(c.createOrder(orderInput()), "invalid_response", "unknown");
});

add("a request exceeding the timeout aborts the port signal and reports timeout", async () => {
  let seenSignal;
  const http = recordingHttp([(request) => new Promise((_, reject) => {
    seenSignal = request.signal;
    request.signal.addEventListener("abort", () => reject(new Error("aborted")));
  })]);
  await rejectsWith(client({ http, timeoutMs: 20 }).createOrder(orderInput()), "timeout", "unknown");
  assert.equal(seenSignal.aborted, true);
});

add("the fetch port refuses non-sandbox URLs and disables redirects", async () => {
  const seen = [];
  const port = createFetchProdigiHttpPort(async (url, init) => {
    seen.push({ url, redirect: init.redirect });
    return { status: 200, text: async () => "{}" };
  });
  const signal = new AbortController().signal;
  await assert.rejects(port.send({ method: "GET", url: "https://api.prodigi.com/v4.0/orders/ord_1", headers: {}, signal }));
  await assert.rejects(port.send({ method: "GET", url: "https://api.sandbox.prodigi.com.evil.example/v4.0/x", headers: {}, signal }));
  const response = await port.send({ method: "GET", url: "https://api.sandbox.prodigi.com/v4.0/orders/ord_1", headers: {}, signal });
  assert.equal(response.status, 200);
  assert.deepEqual(seen, [{ url: "https://api.sandbox.prodigi.com/v4.0/orders/ord_1", redirect: "error" }]);
});

add("the suite made no network request", () => {
  assert.equal(globalFetchCalls, 0);
});

export async function runProdigiSandboxSuite() {
  const results = [];
  for (const [name, run] of cases) {
    try {
      await run();
      results.push({ name, status: "passed" });
    } catch (error) {
      results.push({ name, status: "failed", detail: error instanceof Error ? error.message : "unknown test failure" });
    }
  }
  return results;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const results = await runProdigiSandboxSuite();
  for (const result of results) process.stdout.write(`${result.status.toUpperCase()} ${result.name}${result.detail ? `: ${result.detail}` : ""}\n`);
  const failed = results.filter((result) => result.status !== "passed");
  process.stdout.write(`Prodigi sandbox adapter suite: ${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}
