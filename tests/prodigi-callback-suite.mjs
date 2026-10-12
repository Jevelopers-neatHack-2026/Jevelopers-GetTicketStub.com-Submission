import assert from "node:assert/strict";
import {
  createEnvServerSecretSource,
  createInMemoryProdigiReconciliationStore,
  decideProdigiOrdering,
  parseProdigiCallbackEvent,
  PRODIGI_SANDBOX_SECRET_BINDING,
  ProdigiCallbackError,
  ProdigiCallbackReconciler,
  ProdigiSandboxClient,
  projectOrderResponse
} from "../dist/index.js";
import {
  FIXTURE_ORDER_ID,
  FIXTURE_SANDBOX_KEY,
  fixtureDecision,
  fixtureVerifier,
  orderResponse,
  recordingHttp
} from "./prodigi-sandbox-fixtures.mjs";

/**
 * Offline Prodigi callback and reconciliation suite. Callback bodies follow
 * the CloudEvents shape in the public v4 reference (#callbacks, checked
 * 2026-10-11); they are synthetic, not recordings. Prodigi documents no
 * callback signature, so these tests exercise a host-held URL capability token
 * plus authenticated order reads, never a signature check.
 */

// Network guard: any accidental use of global fetch fails the suite.
let globalFetchCalls = 0;
globalThis.fetch = async () => {
  globalFetchCalls += 1;
  throw new Error("network is forbidden in the Prodigi callback suite");
};

const cases = [];
const add = (name, run) => cases.push([name, run]);

// Test-only binding. The real callback-token reference and variable are host-injected.
const TOKEN_REFERENCE = "fixture/sandbox/callback-token";
const TOKEN_ENV_VAR = "FIXTURE_SANDBOX_CALLBACK_TOKEN";
const FIXTURE_TOKEN = "fixture-callback-capability-token-not-real-0001";
const TOKEN_BINDING = Object.freeze({ reference: TOKEN_REFERENCE, providerId: "prodigi", credentialClass: "sandbox", envVar: TOKEN_ENV_VAR });
const SCOPE = Object.freeze({ tenantId: "tenant-fixture", projectId: "project-fixture" });
const encoder = new TextEncoder();

function env({ token = FIXTURE_TOKEN, apiKey = FIXTURE_SANDBOX_KEY } = {}) {
  // `null` omits a variable; `undefined` would fall back to the default.
  const values = {};
  if (token !== null) values[TOKEN_ENV_VAR] = token;
  if (apiKey !== null) values.PRODIGI_SANDBOX_API_KEY = apiKey;
  return values;
}

function countingSecrets(values = env()) {
  const source = createEnvServerSecretSource({ bindings: [PRODIGI_SANDBOX_SECRET_BINDING, TOKEN_BINDING], env: values });
  const loads = [];
  return {
    loads,
    source: {
      async load(input) {
        loads.push(input.secretReference);
        return source.load(input);
      }
    }
  };
}

function readResponse({ stage = "InProgress", details = {}, lastUpdated = "2026-10-10T10:31:05.000Z", shipments = [], orderId = FIXTURE_ORDER_ID } = {}) {
  const body = orderResponse({ outcome: "Ok", stage, details, shipments });
  body.order.lastUpdated = lastUpdated;
  body.order.id = orderId;
  return { status: 200, body };
}

function observation(options) {
  return projectOrderResponse(readResponse(options).body, ["ok"], "not_dispatched");
}

function cloudEvent({ id = "evt_000001", type = "com.prodigi.order.status.stage.changed#InProgress", subject = FIXTURE_ORDER_ID, time = "2026-10-10T10:31:06Z", data = orderResponse({ stage: "Complete" }).order, extra = {} } = {}) {
  const order = data;
  return encoder.encode(JSON.stringify({
    specversion: "1.0",
    type,
    source: "http://api.sandbox.prodigi.com/v4.0/Orders/",
    id,
    time,
    dataContentType: "application/json",
    subject,
    data: order,
    ...extra
  }));
}

function harness({ responses = [], callbacksEnabled = true, secrets = countingSecrets(), store = createInMemoryProdigiReconciliationStore(), pollPolicy = { initialDelayMs: 100, maxDelayMs: 400, maxAttempts: 4 }, scope = SCOPE, sandboxCallsEnabled = true } = {}) {
  const http = recordingHttp(responses);
  const reader = new ProdigiSandboxClient({
    http: http.port,
    secrets: secrets.source,
    decision: fixtureDecision,
    decisionVerifier: fixtureVerifier(),
    sandboxCallsEnabled
  });
  const sleeps = [];
  const reconciler = new ProdigiCallbackReconciler({
    mode: "sandbox",
    trustedScope: scope,
    reader,
    store,
    callbacksEnabled,
    secrets: secrets.source,
    callbackTokenReference: TOKEN_REFERENCE,
    pollPolicy,
    clock: { now: () => Date.parse("2026-10-10T12:00:00.000Z") },
    sleep: async (ms) => { sleeps.push(ms); }
  });
  return { http, reconciler, secrets, store, sleeps };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => error instanceof ProdigiCallbackError && error.code === code);
}

function deliver(reconciler, body, ...token) {
  const presentedToken = token.length === 0 ? FIXTURE_TOKEN : token[0];
  return reconciler.handleCallback({ presentedToken, headers: { "Content-Type": "application/json" }, rawBody: body });
}

// ---------------------------------------------------------------------------
// Configuration gates

add("callbacks are disabled by default and read nothing", async () => {
  const secrets = countingSecrets();
  const http = recordingHttp([]);
  const reconciler = new ProdigiCallbackReconciler({
    mode: "sandbox",
    trustedScope: SCOPE,
    reader: { async getOrder() { throw new Error("must not read"); } },
    store: createInMemoryProdigiReconciliationStore()
  });
  assert.equal(reconciler.callbacksEnabled, false);
  await rejectsWith(deliver(reconciler, cloudEvent()), "callbacks_disabled");
  assert.equal(secrets.loads.length, 0);
  assert.equal(http.calls.length, 0);
});

add("live mode and unknown modes are refused at construction", () => {
  const base = { trustedScope: SCOPE, reader: { async getOrder() {} }, store: createInMemoryProdigiReconciliationStore() };
  assert.throws(() => new ProdigiCallbackReconciler({ ...base, mode: "live" }), (e) => e instanceof ProdigiCallbackError && e.code === "live_refused");
  assert.throws(() => new ProdigiCallbackReconciler({ ...base, mode: "production" }), (e) => e.code === "invalid_config");
  assert.throws(() => new ProdigiCallbackReconciler({ ...base, mode: "simulated" }), (e) => e.code === "invalid_config");
});

add("enabling callbacks requires a secret source and a token reference", () => {
  const base = { mode: "sandbox", trustedScope: SCOPE, reader: { async getOrder() {} }, store: createInMemoryProdigiReconciliationStore(), callbacksEnabled: true };
  assert.throws(() => new ProdigiCallbackReconciler(base), (e) => e.code === "invalid_config");
  assert.throws(() => new ProdigiCallbackReconciler({ ...base, secrets: countingSecrets().source }), (e) => e.code === "invalid_config");
  assert.throws(() => new ProdigiCallbackReconciler({ ...base, secrets: countingSecrets().source, callbackTokenReference: "RAW TOKEN VALUE" }), (e) => e.code === "invalid_config");
});

add("poll policy is bounded", () => {
  const base = { mode: "sandbox", trustedScope: SCOPE, reader: { async getOrder() {} }, store: createInMemoryProdigiReconciliationStore() };
  for (const pollPolicy of [{ maxAttempts: 0 }, { maxAttempts: 11 }, { initialDelayMs: 0 }, { initialDelayMs: 60_001 }, { initialDelayMs: 500, maxDelayMs: 100 }, { maxDelayMs: 300_001 }]) {
    assert.throws(() => new ProdigiCallbackReconciler({ ...base, pollPolicy }), (e) => e.code === "invalid_config");
  }
  const capped = new ProdigiCallbackReconciler({ ...base, pollPolicy: { initialDelayMs: 1000, maxDelayMs: 1500, maxAttempts: 4 } });
  assert.deepEqual(capped.backoffSchedule(), [1000, 1500, 1500]);
  const defaults = new ProdigiCallbackReconciler(base);
  assert.deepEqual(defaults.backoffSchedule(), [1000, 2000, 4000, 8000]);
});

// ---------------------------------------------------------------------------
// Parsing

add("a CloudEvent parses to a bounded hint and the embedded order is discarded", () => {
  const hint = parseProdigiCallbackEvent(cloudEvent());
  assert.deepEqual({ ...hint }, {
    eventId: "evt_000001",
    orderId: FIXTURE_ORDER_ID,
    type: "com.prodigi.order.status.stage.changed#InProgress",
    claimedStage: "InProgress",
    eventTime: "2026-10-10T10:31:06Z"
  });
  assert.equal(JSON.stringify(hint).includes("Fixture Recipient"), false);
  const shipment = parseProdigiCallbackEvent(cloudEvent({ type: "com.prodigi.order.shipments.created" }));
  assert.equal(shipment.claimedStage, null);
});

add("malformed CloudEvents are rejected", () => {
  const bad = [
    encoder.encode("not json"),
    encoder.encode("[]"),
    cloudEvent({ extra: { specversion: "0.3" } }),
    cloudEvent({ id: "event-without-prefix" }),
    cloudEvent({ type: "org.example.order.changed" }),
    cloudEvent({ type: "com.prodigi.order.status.stage.changed#Shipped" }),
    cloudEvent({ subject: "ord_../../admin" }),
    cloudEvent({ time: "yesterday" }),
    cloudEvent({ data: { ...orderResponse().order, id: "ord_999" } }),
    new Uint8Array([0xff, 0xfe])
  ];
  for (const body of bad) {
    assert.throws(() => parseProdigiCallbackEvent(body), (e) => e instanceof ProdigiCallbackError && e.code === "callback_invalid");
  }
});

// ---------------------------------------------------------------------------
// Forged callbacks

add("forged callbacks (missing, wrong or malformed token) are rejected before any claim or read", async () => {
  const { reconciler, http, store, secrets } = harness();
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  for (const token of [undefined, "", "wrong-token-value-that-is-long-enough-000", `${FIXTURE_TOKEN} `, FIXTURE_TOKEN.slice(0, -1), 42]) {
    await rejectsWith(deliver(reconciler, cloudEvent(), token), "callback_forged");
  }
  assert.equal(http.calls.length, 0);
  assert.ok(secrets.loads.every((reference) => reference === TOKEN_REFERENCE));
  // The event was never claimed, so the genuine delivery still reconciles.
  const genuine = await deliver(reconciler, cloudEvent());
  assert.equal(genuine.outcome, "reconciled");
  assert.equal((await store.getOrder({ scope: SCOPE, orderId: FIXTURE_ORDER_ID })).revision, 0);
});

add("a missing or weak server token fails closed", async () => {
  const missing = harness({ secrets: countingSecrets(env({ token: null })) });
  await missing.reconciler.trackOrder(FIXTURE_ORDER_ID);
  await rejectsWith(deliver(missing.reconciler, cloudEvent()), "callback_token_unavailable");
  const weak = harness({ secrets: countingSecrets(env({ token: "short-token" })) });
  await weak.reconciler.trackOrder(FIXTURE_ORDER_ID);
  await rejectsWith(deliver(weak.reconciler, cloudEvent(), "short-token"), "callback_token_unavailable");
  assert.equal(missing.http.calls.length + weak.http.calls.length, 0);
});

add("callback body content is never applied; only the authenticated read changes state", async () => {
  // The body claims Complete (and carries a Complete order); the authenticated read says InProgress.
  const { reconciler, http } = harness({ responses: [readResponse({ stage: "InProgress", details: { downloadAssets: "Complete" } })] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const result = await deliver(reconciler, cloudEvent({ type: "com.prodigi.order.status.stage.changed#Complete" }));
  assert.equal(result.outcome, "reconciled");
  assert.equal(result.trust, "unverified");
  assert.equal(result.authoritativeMutationAllowed, false);
  assert.equal(result.reconciliation.status, "applied");
  assert.equal(result.reconciliation.state.stage, "InProgress");
  assert.equal(result.reconciliation.state.normalizedState, "accepted");
  assert.equal(http.calls.length, 1);
  assert.equal(http.calls[0].method, "GET");
  assert.equal(http.calls[0].url, `https://api.sandbox.prodigi.com/v4.0/orders/${FIXTURE_ORDER_ID}`);
  assert.equal(http.calls[0].headers["X-API-Key"], FIXTURE_SANDBOX_KEY);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(FIXTURE_TOKEN), false);
  assert.equal(serialized.includes(FIXTURE_SANDBOX_KEY), false);
  assert.equal(serialized.includes("Fixture Recipient"), false);
});

add("callbacks for orders this application did not track trigger no read", async () => {
  const { reconciler, http } = harness();
  const result = await deliver(reconciler, cloudEvent({ subject: "ord_000000000000999", data: null }));
  assert.equal(result.outcome, "untracked_order");
  assert.equal(http.calls.length, 0);
});

add("oversized callbacks are rejected", async () => {
  const store = createInMemoryProdigiReconciliationStore();
  const small = new ProdigiCallbackReconciler({
    mode: "sandbox", trustedScope: SCOPE, reader: { async getOrder() {} }, store, callbacksEnabled: true,
    secrets: countingSecrets().source, callbackTokenReference: TOKEN_REFERENCE, maxBodyBytes: 64
  });
  await rejectsWith(deliver(small, cloudEvent()), "callback_oversized");
});

// ---------------------------------------------------------------------------
// Replay, duplicates and reordering

add("a replayed event is claimed once and triggers no second read", async () => {
  const { reconciler, http } = harness({ responses: [readResponse()] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const first = await deliver(reconciler, cloudEvent());
  const replay = await deliver(reconciler, cloudEvent());
  const replayWithChangedBody = await deliver(reconciler, cloudEvent({ type: "com.prodigi.order.status.stage.changed#Cancelled" }));
  assert.equal(first.outcome, "reconciled");
  assert.equal(replay.outcome, "replayed");
  assert.equal(replayWithChangedBody.outcome, "replayed");
  assert.equal(http.calls.length, 1);
});

add("a duplicate status under a new event ID is coalesced", async () => {
  const { reconciler, http } = harness({ responses: [readResponse()] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  assert.equal((await deliver(reconciler, cloudEvent({ id: "evt_000001" }))).outcome, "reconciled");
  assert.equal((await deliver(reconciler, cloudEvent({ id: "evt_000002" }))).outcome, "duplicate_status");
  assert.equal(http.calls.length, 1);
});

add("replay keys are scoped by tenant/project and order", async () => {
  const store = createInMemoryProdigiReconciliationStore();
  const a = harness({ store, responses: [readResponse()] });
  const b = harness({ store, responses: [readResponse()], scope: { tenantId: "tenant-other", projectId: "project-fixture" } });
  await a.reconciler.trackOrder(FIXTURE_ORDER_ID);
  await b.reconciler.trackOrder(FIXTURE_ORDER_ID);
  assert.equal((await deliver(a.reconciler, cloudEvent())).outcome, "reconciled");
  assert.equal((await deliver(b.reconciler, cloudEvent())).outcome, "reconciled");
});

add("a reordered earlier-stage callback after Complete is stale and cannot regress state", async () => {
  const shipped = readResponse({ stage: "Complete", lastUpdated: "2026-10-10T15:00:00.000Z", details: { downloadAssets: "Complete", printReadyAssetsPrepared: "Complete", allocateProductionLocation: "Complete", inProduction: "Complete", shipping: "Complete" }, shipments: [{ id: "shp_1", status: "Shipped", carrier: { name: "FixtureCarrier" }, tracking: { number: "TRACK1" }, dispatchDate: "2026-10-10T14:00:00.000Z" }] });
  const { reconciler, http } = harness({ responses: [shipped] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const complete = await deliver(reconciler, cloudEvent({ id: "evt_000003", type: "com.prodigi.order.status.stage.changed#Complete" }));
  assert.equal(complete.reconciliation.state.normalizedState, "shipped");
  const late = await deliver(reconciler, cloudEvent({ id: "evt_000001", type: "com.prodigi.order.status.stage.changed#InProgress", time: "2026-10-10T10:31:06Z" }));
  assert.equal(late.outcome, "stale_hint");
  const lateShipment = await deliver(reconciler, cloudEvent({ id: "evt_000004", type: "com.prodigi.order.shipments.created" }));
  assert.equal(lateShipment.outcome, "already_terminal");
  assert.equal(http.calls.length, 1);
  const state = complete.reconciliation.state;
  assert.equal(state.stage, "Complete");
  assert.deepEqual(state.shipmentIds, ["shp_1"]);
});

// ---------------------------------------------------------------------------
// Ordering rules on authenticated reads

add("ordering: stale, regressed and contradictory reads are rejected", () => {
  const base = { orderId: FIXTURE_ORDER_ID, revision: 1, normalizedState: "in_production", conflict: false, reconciledAt: "2026-10-10T12:00:00.000Z" };
  const inProduction = observation({ details: { downloadAssets: "Complete", inProduction: "InProgress" }, lastUpdated: "2026-10-10T12:00:00.000Z" });
  const current = { ...base, stage: "InProgress", details: inProduction.details, shipmentIds: [], lastUpdated: inProduction.lastUpdated, observationDigest: null };
  assert.equal(decideProdigiOrdering(undefined, inProduction), "apply");
  assert.equal(decideProdigiOrdering(current, observation({ lastUpdated: "2026-10-10T11:00:00.000Z" })), "stale");
  assert.equal(decideProdigiOrdering(current, observation({ details: { downloadAssets: "Complete" }, lastUpdated: "2026-10-10T13:00:00.000Z" })), "regression");
  assert.equal(decideProdigiOrdering(current, observation({ details: { downloadAssets: "Complete", inProduction: "Complete" }, lastUpdated: "2026-10-10T13:00:00.000Z" })), "apply");
  const terminal = { ...current, stage: "Complete", shipmentIds: ["shp_1"] };
  assert.equal(decideProdigiOrdering(terminal, observation({ stage: "InProgress", lastUpdated: "2026-10-11T00:00:00.000Z" })), "regression");
  assert.equal(decideProdigiOrdering(terminal, observation({ stage: "Cancelled", lastUpdated: "2026-10-11T00:00:00.000Z", details: inProduction.details, shipments: [{ id: "shp_1", status: "Shipped" }] })), "terminal_conflict");
  assert.equal(decideProdigiOrdering(terminal, observation({ stage: "Complete", lastUpdated: "2026-10-11T00:00:00.000Z", details: inProduction.details })), "regression");
});

add("polling: a stale read after a newer one is rejected and state is kept", async () => {
  const { reconciler } = harness({ responses: [
    readResponse({ details: { downloadAssets: "Complete", inProduction: "InProgress" }, lastUpdated: "2026-10-10T12:00:00.000Z" }),
    readResponse({ details: {}, lastUpdated: "2026-10-10T11:00:00.000Z" }),
    readResponse({ details: { downloadAssets: "Complete", inProduction: "InProgress" }, lastUpdated: "2026-10-10T12:00:00.000Z" })
  ] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const first = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(first.status, "applied");
  assert.equal(first.state.normalizedState, "in_production");
  const stale = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(stale.status, "stale_rejected");
  assert.equal(stale.state.revision, first.state.revision);
  assert.equal(stale.state.normalizedState, "in_production");
  const same = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(same.status, "unchanged");
});

add("polling: Complete then Cancelled is recorded as a conflict and not applied", async () => {
  const done = { downloadAssets: "Complete", printReadyAssetsPrepared: "Complete", allocateProductionLocation: "Complete", inProduction: "Complete", shipping: "Complete" };
  const { reconciler } = harness({ responses: [
    readResponse({ stage: "Complete", details: done, lastUpdated: "2026-10-10T15:00:00.000Z" }),
    readResponse({ stage: "Cancelled", details: done, lastUpdated: "2026-10-10T16:00:00.000Z" })
  ] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  const conflict = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(conflict.status, "terminal_conflict");
  assert.equal(conflict.state.stage, "Complete");
  assert.equal(conflict.state.conflict, true);
});

// ---------------------------------------------------------------------------
// Polling reconciliation and backoff

add("polling works with callbacks disabled and backs off on retryable failures", async () => {
  const { reconciler, http, sleeps } = harness({ callbacksEnabled: false, responses: [
    { status: 429, body: { outcome: "TooManyRequests" } },
    { status: 503, body: "unavailable" },
    readResponse({ details: { downloadAssets: "Complete", inProduction: "InProgress" } })
  ] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const result = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(result.status, "applied");
  assert.equal(result.attempts, 3);
  assert.deepEqual(result.delaysMs, [100, 200]);
  assert.deepEqual(sleeps, [100, 200]);
  assert.equal(http.calls.length, 3);
});

add("polling stops after the bounded attempt count", async () => {
  const { reconciler, http, sleeps } = harness({ responses: Array.from({ length: 4 }, () => ({ status: 503, body: "x" })) });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const result = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(result.status, "retries_exhausted");
  assert.equal(result.errorCode, "provider_unavailable");
  assert.equal(result.attempts, 4);
  assert.deepEqual(sleeps, [100, 200, 400]);
  assert.equal(http.calls.length, 4);
  assert.equal(result.state.revision, 0);
});

add("non-retryable read failures stop immediately without changing state", async () => {
  const auth = harness({ responses: [{ status: 401, body: "denied" }] });
  await auth.reconciler.trackOrder(FIXTURE_ORDER_ID);
  const result = await auth.reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(result.status, "read_failed");
  assert.equal(result.errorCode, "authentication_failed");
  assert.equal(result.attempts, 1);
  assert.deepEqual(auth.sleeps, []);

  const disabled = harness({ sandboxCallsEnabled: false });
  await disabled.reconciler.trackOrder(FIXTURE_ORDER_ID);
  const refused = await disabled.reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(refused.status, "read_failed");
  assert.equal(refused.errorCode, "sandbox_calls_disabled");
  assert.equal(disabled.http.calls.length, 0);
});

add("a read for a different order ID is not applied", async () => {
  const { reconciler } = harness({ responses: [readResponse({ orderId: "ord_000000000000777" })] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const result = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(result.status, "read_failed");
  assert.equal(result.errorCode, "invalid_response");
  assert.equal(result.state.revision, 0);
});

add("compare-and-set contention re-evaluates before writing", async () => {
  const inner = createInMemoryProdigiReconciliationStore();
  let failNext = 1;
  const store = {
    claimEvent: (input) => inner.claimEvent(input),
    getOrder: (input) => inner.getOrder(input),
    async compareAndSetOrder(input) {
      if (input.expectedRevision !== null && failNext > 0) {
        failNext -= 1;
        return false;
      }
      return inner.compareAndSetOrder(input);
    }
  };
  const { reconciler } = harness({ store, responses: [readResponse()] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const result = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(result.status, "applied");
  assert.equal(result.state.revision, 1);
});

add("store failures surface as store_unavailable", async () => {
  const broken = {
    async claimEvent() { throw new Error("db down"); },
    async getOrder() { throw new Error("db down"); },
    async compareAndSetOrder() { throw new Error("db down"); }
  };
  const { reconciler } = harness({ store: broken });
  await rejectsWith(reconciler.trackOrder(FIXTURE_ORDER_ID), "store_unavailable");
  await rejectsWith(deliver(reconciler, cloudEvent()), "store_unavailable");
});

add("the suite made no network request", () => {
  assert.equal(globalFetchCalls, 0);
});

export async function runProdigiCallbackSuite() {
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
  const results = await runProdigiCallbackSuite();
  for (const result of results) process.stdout.write(`${result.status.toUpperCase()} ${result.name}${result.detail ? `: ${result.detail}` : ""}\n`);
  const failed = results.filter((result) => result.status !== "passed");
  process.stdout.write(`Prodigi callback suite: ${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}
