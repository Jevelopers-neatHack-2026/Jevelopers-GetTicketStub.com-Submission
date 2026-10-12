import assert from "node:assert/strict";
import {
  createEnvServerSecretSource,
  createInMemoryProdigiReconciliationStore,
  createProdigiReadLimiter,
  decideProdigiOrdering,
  parseProdigiCallbackEvent,
  PRODIGI_CALLBACK_EVENT_TYPES,
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
 *
 * Network: every provider read goes through the injected recording HTTP port,
 * so no test can reach `createFetchProdigiHttpPort`. The runner additionally
 * preloads the sandbox network guard (fetch, http/https, net, tls); when run
 * standalone, a local fetch guard is installed instead. Both are
 * belt-and-braces, and the last case asserts zero attempts.
 */

const GUARD_KEY = Symbol.for("fulfillment-connectors.prodigi-sandbox.network-guard");
const guard = globalThis[GUARD_KEY];
let localFetchCalls = 0;
if (guard === undefined) {
  globalThis.fetch = async () => {
    localFetchCalls += 1;
    throw new Error("network is forbidden in the Prodigi callback suite");
  };
}

const cases = [];
const add = (name, run) => cases.push([name, run]);

// Test-only binding. The real callback-token reference and variable are host-injected.
const TOKEN_REFERENCE = "fixture/sandbox/callback-token";
const TOKEN_ENV_VAR = "FIXTURE_SANDBOX_CALLBACK_TOKEN";
const PREVIOUS_REFERENCE = "fixture/sandbox/callback-token-previous";
const PREVIOUS_ENV_VAR = "FIXTURE_SANDBOX_CALLBACK_TOKEN_PREVIOUS";
const FIXTURE_TOKEN = "fixture-callback-capability-token-not-real-0001";
const PREVIOUS_TOKEN = "fixture-previous-callback-token-not-real-00002";
const TOKEN_BINDING = Object.freeze({ reference: TOKEN_REFERENCE, providerId: "prodigi", credentialClass: "sandbox", envVar: TOKEN_ENV_VAR });
const PREVIOUS_BINDING = Object.freeze({ reference: PREVIOUS_REFERENCE, providerId: "prodigi", credentialClass: "sandbox", envVar: PREVIOUS_ENV_VAR });
const SCOPE = Object.freeze({ tenantId: "tenant-fixture", projectId: "project-fixture" });
const START = Date.parse("2026-10-10T12:00:00.000Z");
const STAGE = (name) => `com.prodigi.order.status.stage.changed#${name}`;
const encoder = new TextEncoder();
const DONE = { downloadAssets: "Complete", printReadyAssetsPrepared: "Complete", allocateProductionLocation: "Complete", inProduction: "Complete", shipping: "Complete" };

function env({ token = FIXTURE_TOKEN, previous = null, apiKey = FIXTURE_SANDBOX_KEY } = {}) {
  // `null` omits a variable; `undefined` would fall back to the default.
  const values = {};
  if (token !== null) values[TOKEN_ENV_VAR] = token;
  if (previous !== null) values[PREVIOUS_ENV_VAR] = previous;
  if (apiKey !== null) values.PRODIGI_SANDBOX_API_KEY = apiKey;
  return values;
}

function countingSecrets(values = env()) {
  const source = createEnvServerSecretSource({ bindings: [PRODIGI_SANDBOX_SECRET_BINDING, TOKEN_BINDING, PREVIOUS_BINDING], env: values });
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

function cloudEvent({ id = "evt_000001", type = STAGE("InProgress"), subject = FIXTURE_ORDER_ID, time = "2026-10-10T10:31:06Z", data = orderResponse({ stage: "Complete" }).order, extra = {} } = {}) {
  return encoder.encode(JSON.stringify({
    specversion: "1.0",
    type,
    source: "http://api.sandbox.prodigi.com/v4.0/Orders/",
    id,
    time,
    dataContentType: "application/json",
    subject,
    data: data === null ? null : { ...data, id: subject },
    ...extra
  }));
}

function mutableClock(start = START) {
  return { t: start, now() { return this.t; }, advance(ms) { this.t += ms; } };
}

function recordingScheduler({ durable = false, fail = false } = {}) {
  const jobs = [];
  return { jobs, scheduler: { durable, schedule(job) { if (fail) throw new Error("queue down"); jobs.push(job); } } };
}

function harness({
  responses = [],
  http = recordingHttp(responses),
  callbacksEnabled = true,
  secrets = countingSecrets(),
  clock = mutableClock(),
  store = createInMemoryProdigiReconciliationStore({ clock }),
  pollPolicy = { initialDelayMs: 100, maxDelayMs: 400, maxAttempts: 4 },
  scope = SCOPE,
  sandboxCallsEnabled = true,
  reader,
  queue = recordingScheduler(),
  extra = {}
} = {}) {
  const sandboxReader = reader ?? new ProdigiSandboxClient({
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
    reader: sandboxReader,
    store,
    callbacksEnabled,
    secrets: secrets.source,
    callbackTokenReference: TOKEN_REFERENCE,
    pollPolicy,
    clock,
    random: () => 0.5,
    scheduler: queue.scheduler,
    sleep: async (ms) => { sleeps.push(ms); },
    ...extra
  });
  return { http, reconciler, secrets, store, sleeps, clock, jobs: queue.jobs };
}

async function rejectsWith(promise, code) {
  await assert.rejects(promise, (error) => error instanceof ProdigiCallbackError && error.code === code);
}

function deliver(reconciler, body, ...token) {
  const presentedToken = token.length === 0 ? FIXTURE_TOKEN : token[0];
  return reconciler.handleCallback({ presentedToken, headers: { "Content-Type": "application/json" }, rawBody: body });
}

function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { promise, open };
}

// ---------------------------------------------------------------------------
// Configuration gates

add("callbacks are disabled by default and read nothing (real reader, secret source and token reference wired)", async () => {
  const secrets = countingSecrets();
  const http = recordingHttp([readResponse()]);
  const reader = new ProdigiSandboxClient({ http: http.port, secrets: secrets.source, decision: fixtureDecision, decisionVerifier: fixtureVerifier(), sandboxCallsEnabled: true });
  const reconciler = new ProdigiCallbackReconciler({
    mode: "sandbox",
    trustedScope: SCOPE,
    reader,
    store: createInMemoryProdigiReconciliationStore(),
    secrets: secrets.source,
    callbackTokenReference: TOKEN_REFERENCE
  });
  assert.equal(reconciler.callbacksEnabled, false);
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  await rejectsWith(deliver(reconciler, cloudEvent()), "callbacks_disabled");
  // The same wiring does read when polled, so the zero counts above are not tautological.
  assert.equal(secrets.loads.length, 0);
  assert.equal(http.calls.length, 0);
  assert.equal((await reconciler.reconcileOrder(FIXTURE_ORDER_ID)).status, "applied");
  assert.equal(http.calls.length, 1);
  assert.deepEqual(secrets.loads, ["prodigi/sandbox/api-key"]);
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
  assert.throws(() => new ProdigiCallbackReconciler({ ...base, secrets: countingSecrets().source, callbackTokenReference: TOKEN_REFERENCE, previousCallbackTokenReference: TOKEN_REFERENCE }), (e) => e.code === "invalid_config");
});

add("poll, deadline, interval and retention settings are bounded", () => {
  const base = { mode: "sandbox", trustedScope: SCOPE, reader: { async getOrder() {} }, store: createInMemoryProdigiReconciliationStore() };
  for (const pollPolicy of [{ maxAttempts: 0 }, { maxAttempts: 11 }, { initialDelayMs: 0 }, { initialDelayMs: 60_001 }, { initialDelayMs: 500, maxDelayMs: 100 }, { maxDelayMs: 300_001 }]) {
    assert.throws(() => new ProdigiCallbackReconciler({ ...base, pollPolicy }), (e) => e.code === "invalid_config");
  }
  for (const extra of [{ requestDeadlineMs: 49 }, { requestDeadlineMs: 10_001 }, { readTimeoutMs: 99 }, { minReadIntervalMs: -1 }, { coverageSkewMs: 300_001 }, { replayTtlMs: 59_999 }, { maxPendingJobs: 0 }, { scheduler: { schedule() {} } }, { readLimiter: {} }]) {
    assert.throws(() => new ProdigiCallbackReconciler({ ...base, ...extra }), (e) => e.code === "invalid_config");
  }
  const capped = new ProdigiCallbackReconciler({ ...base, pollPolicy: { initialDelayMs: 1000, maxDelayMs: 1500, maxAttempts: 4 } });
  assert.deepEqual(capped.backoffSchedule(), [1000, 1500, 1500]);
  const defaults = new ProdigiCallbackReconciler(base);
  assert.deepEqual(defaults.backoffSchedule(), [1000, 2000, 4000, 8000]);
});

// ---------------------------------------------------------------------------
// Parsing and allowlist

add("a CloudEvent parses to a bounded hint and the embedded order is discarded", () => {
  const hint = parseProdigiCallbackEvent(cloudEvent());
  assert.deepEqual({ ...hint }, {
    eventId: "evt_000001",
    orderId: FIXTURE_ORDER_ID,
    type: STAGE("InProgress"),
    claimedStage: "InProgress",
    eventTime: "2026-10-10T10:31:06Z"
  });
  assert.equal(JSON.stringify(hint).includes("Fixture Recipient"), false);
  const shipment = parseProdigiCallbackEvent(cloudEvent({ type: "com.prodigi.order.shipments.created" }));
  assert.equal(shipment.claimedStage, null);
  assert.deepEqual([...PRODIGI_CALLBACK_EVENT_TYPES], [STAGE("InProgress"), STAGE("Complete"), STAGE("Cancelled")]);
});

add("malformed CloudEvents are rejected", () => {
  const bad = [
    encoder.encode("not json"),
    encoder.encode("[]"),
    cloudEvent({ extra: { specversion: "0.3" } }),
    cloudEvent({ id: "event-without-prefix" }),
    cloudEvent({ type: "org.example.order.changed" }),
    cloudEvent({ type: STAGE("Shipped") }),
    cloudEvent({ subject: "ord_../../admin", data: null }),
    cloudEvent({ time: "yesterday" }),
    encoder.encode(JSON.stringify({ specversion: "1.0", type: STAGE("InProgress"), id: "evt_1", time: "2026-10-10T10:31:06Z", subject: FIXTURE_ORDER_ID, data: { id: "ord_999" } })),
    new Uint8Array([0xff, 0xfe])
  ];
  for (const body of bad) {
    assert.throws(() => parseProdigiCallbackEvent(body), (e) => e instanceof ProdigiCallbackError && e.code === "callback_invalid");
  }
});

add("M1: 20 invented com.prodigi types cause zero reads and zero store access", async () => {
  const calls = [];
  const inner = createInMemoryProdigiReconciliationStore();
  const store = Object.fromEntries(["hasEvent", "recordEvent", "getOrder", "compareAndSetOrder"].map((name) => [name, async (input) => { calls.push(name); return inner[name](input); }]));
  const { reconciler, http } = harness({ store, responses: Array.from({ length: 50 }, () => ({ status: 503, body: "x" })) });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  calls.length = 0;
  for (let i = 0; i < 20; i += 1) {
    const result = await deliver(reconciler, cloudEvent({ id: `evt_inv${i}`, type: `com.prodigi.invented.type${i}` }));
    assert.equal(result.outcome, "ignored_type");
    assert.equal(result.recommendedHttpStatus, 200);
  }
  assert.equal(http.calls.length, 0);
  assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------------------
// Tokens

add("forged callbacks (missing, wrong or malformed token) are rejected before any store access or read", async () => {
  const { reconciler, http, store, secrets } = harness({ responses: [readResponse()] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  for (const token of [undefined, "", "wrong-token-value-that-is-long-enough-000000000", `${FIXTURE_TOKEN} `, FIXTURE_TOKEN.slice(0, -1), 42]) {
    await rejectsWith(deliver(reconciler, cloudEvent(), token), "callback_forged");
  }
  assert.equal(http.calls.length, 0);
  assert.ok(secrets.loads.every((reference) => reference === TOKEN_REFERENCE));
  assert.deepEqual(store.stats(), { orders: 1, replayRecords: 0 });
  // Nothing was recorded, so the genuine delivery is read and applied.
  const genuine = await deliver(reconciler, cloudEvent());
  assert.equal(genuine.outcome, "reconciled");
  assert.equal(genuine.reconciliation.status, "applied");
  assert.equal(genuine.reconciliation.state.revision, 1);
  assert.equal(genuine.tokenGeneration, "current");
  assert.equal(http.calls.length, 1);
});

add("L3: a missing, short, overlong or non-printable server token fails closed as token_unavailable", async () => {
  const presented = "p".repeat(48);
  for (const [token, sent] of [[null, FIXTURE_TOKEN], ["short-token", "short-token"], ["x".repeat(32), "x".repeat(32)], ["y".repeat(513), presented], [`${"z".repeat(44)}é`, presented], [`${"z".repeat(44)} z`, presented]]) {
    const h = harness({ secrets: countingSecrets(env({ token })) });
    await h.reconciler.trackOrder(FIXTURE_ORDER_ID);
    await rejectsWith(deliver(h.reconciler, cloudEvent(), sent), "callback_token_unavailable");
    assert.equal(h.http.calls.length, 0);
  }
});

add("L4: a previous token is accepted during rotation and reported as such", async () => {
  const secrets = countingSecrets(env({ previous: PREVIOUS_TOKEN }));
  const { reconciler } = harness({ secrets, responses: [readResponse()], extra: { previousCallbackTokenReference: PREVIOUS_REFERENCE } });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const viaPrevious = await deliver(reconciler, cloudEvent(), PREVIOUS_TOKEN);
  assert.equal(viaPrevious.tokenGeneration, "previous");
  const viaCurrent = await deliver(reconciler, cloudEvent({ id: "evt_000002" }));
  assert.equal(viaCurrent.tokenGeneration, "current");
  await rejectsWith(deliver(reconciler, cloudEvent(), "q".repeat(48)), "callback_forged");
  // A configured but absent previous token never matches and does not break the current one.
  const absent = harness({ responses: [readResponse()], extra: { previousCallbackTokenReference: PREVIOUS_REFERENCE } });
  await absent.reconciler.trackOrder(FIXTURE_ORDER_ID);
  assert.equal((await deliver(absent.reconciler, cloudEvent())).tokenGeneration, "current");
  await rejectsWith(deliver(absent.reconciler, cloudEvent(), PREVIOUS_TOKEN), "callback_forged");
});

// ---------------------------------------------------------------------------
// Callback content is never applied

add("callback body content is never applied; only the authenticated read changes state", async () => {
  // The body claims Complete (and carries a Complete order); the authenticated read says InProgress.
  const { reconciler, http } = harness({ responses: [readResponse({ stage: "InProgress", details: { downloadAssets: "Complete" } })] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const result = await deliver(reconciler, cloudEvent({ type: STAGE("Complete") }));
  assert.equal(result.outcome, "reconciled");
  assert.equal(result.recommendedHttpStatus, 200);
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

add("oversized callbacks are rejected", async () => {
  const store = createInMemoryProdigiReconciliationStore();
  const small = new ProdigiCallbackReconciler({
    mode: "sandbox", trustedScope: SCOPE, reader: { async getOrder() {} }, store, callbacksEnabled: true,
    secrets: countingSecrets().source, callbackTokenReference: TOKEN_REFERENCE, maxBodyBytes: 64
  });
  await rejectsWith(deliver(small, cloudEvent()), "callback_oversized");
});

// ---------------------------------------------------------------------------
// H1: lost callbacks

add("H1: a callback before trackOrder is not_tracked (503), stores nothing, and its redelivery reconciles", async () => {
  const { reconciler, http, store } = harness({ responses: [readResponse({ details: { downloadAssets: "Complete" } })] });
  const early = await deliver(reconciler, cloudEvent());
  assert.equal(early.outcome, "not_tracked");
  assert.equal(early.recommendedHttpStatus, 503);
  assert.equal(early.retryAfterSeconds, 30);
  assert.deepEqual(store.stats(), { orders: 0, replayRecords: 0 });
  assert.equal(http.calls.length, 0);
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const redelivered = await deliver(reconciler, cloudEvent());
  assert.equal(redelivered.outcome, "reconciled");
  assert.equal(redelivered.reconciliation.status, "applied");
  assert.equal(http.calls.length, 1);
  assert.equal((await deliver(reconciler, cloudEvent())).outcome, "replayed");
  assert.equal(http.calls.length, 1);
});

add("H1: failed reads return a retryable 503, record nothing, schedule backoff, and a redelivery reconciles", async () => {
  const { reconciler, http, store, clock, jobs, sleeps } = harness({ responses: [{ status: 503, body: "x" }, readResponse({ details: { downloadAssets: "Complete" } })] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const failed = await deliver(reconciler, cloudEvent());
  assert.equal(failed.outcome, "reconcile_failed");
  assert.equal(failed.recommendedHttpStatus, 503);
  assert.equal(failed.errorCode, "provider_unavailable");
  assert.equal(failed.scheduled, true);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].attempt, 2);
  assert.equal(store.stats().replayRecords, 0);
  assert.deepEqual(sleeps, [], "no backoff sleep runs inside the request");
  assert.equal(http.calls.length, 1);
  clock.advance(6000);
  const redelivered = await deliver(reconciler, cloudEvent());
  assert.equal(redelivered.outcome, "reconciled");
  assert.equal(redelivered.reconciliation.status, "applied");
  assert.equal(http.calls.length, 2);
  // The scheduled job is now covered and reads nothing.
  assert.equal((await reconciler.runScheduledReconciliation(jobs[0])).status, "covered");
  assert.equal(http.calls.length, 2);
});

add("H1: when the request read fails, the scheduled job retries with jittered backoff outside the request", async () => {
  const { reconciler, http, clock, jobs } = harness({ responses: [{ status: 503, body: "x" }, { status: 429, body: {} }, readResponse({ details: { downloadAssets: "Complete" } })] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  assert.equal((await deliver(reconciler, cloudEvent())).outcome, "reconcile_failed");
  clock.advance(6000);
  const second = await reconciler.runScheduledReconciliation(jobs[0]);
  assert.equal(second.status, "rescheduled");
  assert.equal(second.errorCode, "rate_limited");
  assert.equal(jobs.length, 2);
  assert.equal(jobs[1].attempt, 3);
  assert.ok(jobs[1].delayMs > 0 && jobs[1].delayMs <= 400, "jittered delay stays within the cap");
  clock.advance(6000);
  assert.equal((await reconciler.runScheduledReconciliation(jobs[1])).status, "applied");
  assert.equal(http.calls.length, 3);
});

add("H1: a non-retryable read failure is 503 and schedules nothing", async () => {
  const { reconciler, jobs } = harness({ responses: [{ status: 401, body: "denied" }] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const failed = await deliver(reconciler, cloudEvent());
  assert.equal(failed.outcome, "reconcile_failed");
  assert.equal(failed.errorCode, "authentication_failed");
  assert.equal(failed.scheduled, false);
  assert.equal(jobs.length, 0);
});

add("H1: a scheduler that refuses the job turns a deferral into a retryable failure; a durable one yields 202", async () => {
  const refused = harness({ responses: [{ status: 503, body: "x" }], queue: recordingScheduler({ fail: true }) });
  await refused.reconciler.trackOrder(FIXTURE_ORDER_ID);
  const failed = await deliver(refused.reconciler, cloudEvent());
  assert.equal(failed.outcome, "reconcile_failed");
  assert.equal(failed.scheduled, false);
  assert.equal(refused.reconciler.diagnostics().pendingJobs, 0);

  const durable = harness({ responses: [readResponse()], queue: recordingScheduler({ durable: true }) });
  await durable.reconciler.trackOrder(FIXTURE_ORDER_ID);
  await deliver(durable.reconciler, cloudEvent({ id: "evt_a", time: "2026-10-10T11:00:00Z" }));
  const deferred = await deliver(durable.reconciler, cloudEvent({ id: "evt_b", time: "2026-10-10T12:00:00Z" }));
  assert.equal(deferred.outcome, "deferred");
  assert.equal(deferred.recommendedHttpStatus, 202);
});

// ---------------------------------------------------------------------------
// H2: no per-type dedupe

add("H2: a forged Complete cannot suppress the genuine Complete", async () => {
  const { reconciler, http, clock } = harness({ responses: [
    readResponse({ stage: "InProgress", details: { downloadAssets: "Complete" }, lastUpdated: "2026-10-10T11:58:00.000Z" }),
    readResponse({ stage: "Complete", details: DONE, lastUpdated: "2026-10-10T12:04:00.000Z" })
  ] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const forged = await deliver(reconciler, cloudEvent({ id: "evt_fake", type: STAGE("Complete"), time: "2026-10-10T11:59:00Z" }));
  assert.equal(forged.outcome, "reconciled");
  assert.equal(forged.reconciliation.state.stage, "InProgress");
  clock.advance(6 * 60_000);
  const genuine = await deliver(reconciler, cloudEvent({ id: "evt_genuine", type: STAGE("Complete"), time: "2026-10-10T12:05:00Z" }));
  assert.equal(genuine.outcome, "reconciled");
  assert.equal(genuine.reconciliation.status, "applied");
  assert.equal(genuine.reconciliation.state.stage, "Complete");
  assert.equal(http.calls.length, 2);
});

add("H2: a repeated status is suppressed only when an authoritative read already covers its time", async () => {
  const { reconciler, http, clock, jobs } = harness({ responses: [readResponse(), readResponse({ details: { downloadAssets: "Complete" }, lastUpdated: "2026-10-10T12:00:30.000Z" })] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  assert.equal((await deliver(reconciler, cloudEvent({ id: "evt_000001" }))).outcome, "reconciled");
  // Same type, new ID, event time before the confirming read: covered, no read.
  assert.equal((await deliver(reconciler, cloudEvent({ id: "evt_000002" }))).outcome, "already_reconciled");
  // Same type again (e.g. InProgress after an Error step), newer than the read: within the interval it is deferred, not dropped.
  clock.advance(1000);
  const newer = await deliver(reconciler, cloudEvent({ id: "evt_000003", time: "2026-10-10T12:00:01Z" }));
  assert.equal(newer.outcome, "deferred");
  assert.equal(newer.recommendedHttpStatus, 503, "the in-process scheduler is not durable");
  assert.equal(http.calls.length, 1);
  clock.advance(6000);
  assert.equal((await reconciler.runScheduledReconciliation(jobs[0])).status, "applied");
  assert.equal(http.calls.length, 2);
});

// ---------------------------------------------------------------------------
// M1: read amplification

add("M1: concurrent callbacks for one order share a single read", async () => {
  const opened = gate();
  const http = recordingHttp([async () => { await opened.promise; return { status: 200, bodyText: JSON.stringify(readResponse().body) }; }]);
  const { reconciler } = harness({ http });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const pending = Array.from({ length: 5 }, (_, i) => deliver(reconciler, cloudEvent({ id: `evt_c${i}` })));
  await new Promise((resolve) => setTimeout(resolve, 20));
  opened.open();
  const results = await Promise.all(pending);
  assert.deepEqual(results.map((r) => r.outcome), Array(5).fill("reconciled"));
  assert.equal(http.calls.length, 1);
  assert.equal(reconciler.diagnostics().inFlightReads, 0);
});

add("M1: 20 documented callbacks against a failing provider give at most maxAttempts reads in total", async () => {
  const { reconciler, http, clock, jobs, sleeps } = harness({ responses: Array.from({ length: 50 }, () => ({ status: 503, body: "x" })) });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  for (let i = 0; i < 20; i += 1) {
    const result = await deliver(reconciler, cloudEvent({ id: `evt_f${i}`, type: PRODIGI_CALLBACK_EVENT_TYPES[i % 3], time: "2026-10-10T12:00:00Z" }));
    assert.equal(result.recommendedHttpStatus, 503);
  }
  assert.equal(http.calls.length, 1, "one quick read in-request; the rest are coalesced");
  assert.equal(jobs.length, 1, "one pending job per order");
  // Drain the background chain.
  for (let i = 0; i < jobs.length && i < 20; i += 1) {
    clock.advance(6000);
    await reconciler.runScheduledReconciliation(jobs[i]);
  }
  assert.ok(http.calls.length <= 4, `reads: ${http.calls.length}`);
  assert.deepEqual(sleeps, []);
});

add("M1: the global read limiter bounds reads across many orders", async () => {
  const clock = mutableClock();
  const http = recordingHttp(Array.from({ length: 40 }, (_, i) => (request) => {
    const id = request.url.split("/").pop();
    return { status: 200, bodyText: JSON.stringify(readResponse({ orderId: id }).body) };
  }));
  const { reconciler } = harness({ http, clock, extra: { readLimiter: createProdigiReadLimiter({ burst: 3, maxConcurrent: 2, clock }) } });
  const ids = Array.from({ length: 20 }, (_, i) => `ord_${String(1000 + i)}`);
  for (const id of ids) await reconciler.trackOrder(id);
  const results = await Promise.all(ids.map((id, i) => deliver(reconciler, cloudEvent({ id: `evt_g${i}`, subject: id }))));
  assert.ok(http.calls.length <= 3, `reads: ${http.calls.length}`);
  assert.ok(results.filter((r) => r.outcome === "deferred").length >= 17);
});

// ---------------------------------------------------------------------------
// M2: bounded storage

add("M2: 1,000 callbacks for unknown orders store zero entries and keep no in-process state", async () => {
  const { reconciler, http, store } = harness();
  for (let i = 0; i < 1000; i += 1) {
    const result = await deliver(reconciler, cloudEvent({ id: `evt_u${i}`, subject: `ord_u${i}` }));
    assert.equal(result.outcome, "not_tracked");
  }
  assert.deepEqual(store.stats(), { orders: 0, replayRecords: 0 });
  assert.deepEqual(reconciler.diagnostics(), { inFlightReads: 0, pendingJobs: 0, orderEntries: 0 });
  assert.equal(http.calls.length, 0);
});

add("M2: replay records expire after their TTL and are capped oldest-first", async () => {
  const clock = mutableClock();
  const store = createInMemoryProdigiReconciliationStore({ maxReplayRecords: 3, clock });
  const expiresAt = new Date(START + 60_000).toISOString();
  for (let i = 0; i < 5; i += 1) await store.recordEvent({ scope: SCOPE, orderId: FIXTURE_ORDER_ID, eventId: `evt_${i}`, expiresAt });
  assert.equal(store.stats().replayRecords, 3);
  assert.equal(await store.hasEvent({ scope: SCOPE, orderId: FIXTURE_ORDER_ID, eventId: "evt_0" }), false);
  assert.equal(await store.hasEvent({ scope: SCOPE, orderId: FIXTURE_ORDER_ID, eventId: "evt_4" }), true);
  clock.advance(60_000);
  assert.equal(await store.hasEvent({ scope: SCOPE, orderId: FIXTURE_ORDER_ID, eventId: "evt_4" }), false);
  assert.equal(store.stats().replayRecords, 0);
  // The reconciler writes expiry = now + replayTtlMs.
  const recorded = [];
  const inner = createInMemoryProdigiReconciliationStore({ clock });
  const spy = { ...inner, async recordEvent(input) { recorded.push(input); return inner.recordEvent(input); } };
  const h = harness({ store: spy, clock, responses: [readResponse()], extra: { replayTtlMs: 120_000 } });
  await h.reconciler.trackOrder(FIXTURE_ORDER_ID);
  await deliver(h.reconciler, cloudEvent());
  assert.deepEqual(recorded.map((r) => r.expiresAt), [new Date(clock.now() + 120_000).toISOString()]);
});

// ---------------------------------------------------------------------------
// M3: in-request deadline

add("M3: a hung provider read is cut off at the in-request deadline and scheduled outside the request", async () => {
  const reads = [];
  const reader = { getOrder(orderId, signal) { reads.push(orderId); return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))); } };
  const { reconciler, jobs, sleeps } = harness({ reader, extra: { requestDeadlineMs: 200, readTimeoutMs: 1000 } });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const started = Date.now();
  const result = await deliver(reconciler, cloudEvent());
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 400, `elapsed ${elapsed} ms`);
  assert.equal(result.outcome, "deferred");
  assert.equal(result.recommendedHttpStatus, 503);
  assert.equal(jobs.length, 1);
  assert.equal(reads.length, 1);
  assert.deepEqual(sleeps, []);
});

add("M3: a hung store is cut off by the hard deadline", async () => {
  const hang = () => new Promise(() => {});
  const inner = createInMemoryProdigiReconciliationStore();
  const store = { ...inner, getOrder: hang };
  const { reconciler } = harness({ store, extra: { requestDeadlineMs: 150 } });
  const started = Date.now();
  await rejectsWith(deliver(reconciler, cloudEvent()), "deadline_exceeded");
  assert.ok(Date.now() - started < 350);
});

// ---------------------------------------------------------------------------
// Replay, scope and reordering

add("a replayed event after a successful apply triggers no second read, even with a changed body", async () => {
  const { reconciler, http } = harness({ responses: [readResponse()] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const first = await deliver(reconciler, cloudEvent());
  const replay = await deliver(reconciler, cloudEvent());
  const replayWithChangedBody = await deliver(reconciler, cloudEvent({ type: STAGE("Cancelled"), time: "2026-10-10T12:00:00Z" }));
  assert.equal(first.outcome, "reconciled");
  assert.equal(replay.outcome, "replayed");
  assert.equal(replayWithChangedBody.outcome, "replayed");
  assert.equal(http.calls.length, 1);
});

add("replay records and state are scoped by tenant/project and order", async () => {
  const clock = mutableClock();
  const store = createInMemoryProdigiReconciliationStore({ clock });
  const a = harness({ store, clock, responses: [readResponse()] });
  const b = harness({ store, clock, responses: [readResponse()], scope: { tenantId: "tenant-other", projectId: "project-fixture" } });
  await a.reconciler.trackOrder(FIXTURE_ORDER_ID);
  await b.reconciler.trackOrder(FIXTURE_ORDER_ID);
  assert.equal((await deliver(a.reconciler, cloudEvent())).outcome, "reconciled");
  assert.equal((await deliver(b.reconciler, cloudEvent())).outcome, "reconciled");
});

add("a reordered earlier-stage callback after Complete triggers no read and cannot regress state", async () => {
  const shipped = readResponse({ stage: "Complete", lastUpdated: "2026-10-10T15:00:00.000Z", details: DONE, shipments: [{ id: "shp_1", status: "Shipped", carrier: { name: "FixtureCarrier" }, tracking: { number: "TRACK1" }, dispatchDate: "2026-10-10T14:00:00.000Z" }] });
  const { reconciler, http, clock } = harness({ responses: [shipped] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const complete = await deliver(reconciler, cloudEvent({ id: "evt_000003", type: STAGE("Complete") }));
  assert.equal(complete.reconciliation.state.normalizedState, "shipped");
  clock.advance(60_000);
  const late = await deliver(reconciler, cloudEvent({ id: "evt_000001", type: STAGE("InProgress"), time: "2026-10-10T12:00:30Z" }));
  assert.equal(late.outcome, "already_terminal");
  const lateShipment = await deliver(reconciler, cloudEvent({ id: "evt_000004", type: "com.prodigi.order.shipments.created" }));
  assert.equal(lateShipment.outcome, "ignored_type");
  assert.equal(http.calls.length, 1);
  const state = complete.reconciliation.state;
  assert.equal(state.stage, "Complete");
  assert.deepEqual(state.shipmentIds, ["shp_1"]);
  assert.equal(JSON.stringify(state).includes("TRACK1"), false);
});

// ---------------------------------------------------------------------------
// Ordering rules on authenticated reads

add("ordering: stale, regressed and contradictory reads are rejected", () => {
  const base = { orderId: FIXTURE_ORDER_ID, revision: 1, normalizedState: "in_production", conflict: false, reconciledAt: "2026-10-10T12:00:00.000Z", confirmedAt: null };
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

add("L2: an older Cancelled read after a stored Complete is a terminal_conflict, not stale", async () => {
  const current = { orderId: FIXTURE_ORDER_ID, revision: 1, stage: "Complete", normalizedState: "shipped", details: DONE, shipmentIds: [], lastUpdated: "2026-10-10T15:00:00.000Z", observationDigest: null, reconciledAt: null, confirmedAt: null, conflict: false };
  assert.equal(decideProdigiOrdering(current, observation({ stage: "Cancelled", details: DONE, lastUpdated: "2026-10-10T09:00:00.000Z" })), "terminal_conflict");
  const { reconciler } = harness({ responses: [
    readResponse({ stage: "Complete", details: DONE, lastUpdated: "2026-10-10T15:00:00.000Z" }),
    readResponse({ stage: "Cancelled", details: DONE, lastUpdated: "2026-10-10T09:00:00.000Z" })
  ] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  const conflict = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(conflict.status, "terminal_conflict");
  assert.equal(conflict.state.stage, "Complete");
  assert.equal(conflict.state.conflict, true);
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
  const { reconciler } = harness({ responses: [
    readResponse({ stage: "Complete", details: DONE, lastUpdated: "2026-10-10T15:00:00.000Z" }),
    readResponse({ stage: "Cancelled", details: DONE, lastUpdated: "2026-10-10T16:00:00.000Z" })
  ] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  const conflict = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(conflict.status, "terminal_conflict");
  assert.equal(conflict.state.stage, "Complete");
  assert.equal(conflict.state.conflict, true);
});

// ---------------------------------------------------------------------------
// Polling entry point

add("polling works with callbacks disabled and backs off with full jitter on retryable failures", async () => {
  const { reconciler, http, sleeps } = harness({ callbacksEnabled: false, responses: [
    { status: 429, body: { outcome: "TooManyRequests" } },
    { status: 503, body: "unavailable" },
    readResponse({ details: { downloadAssets: "Complete", inProduction: "InProgress" } })
  ] });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const result = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(result.status, "applied");
  assert.equal(result.attempts, 3);
  // random() = 0.5 draws half of each cap (100, 200).
  assert.deepEqual(result.delaysMs, [50, 100]);
  assert.deepEqual(sleeps, [50, 100]);
  assert.equal(http.calls.length, 3);
});

add("polling stops after the bounded attempt count", async () => {
  const { reconciler, http, sleeps } = harness({ responses: Array.from({ length: 4 }, () => ({ status: 503, body: "x" })) });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const result = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(result.status, "retries_exhausted");
  assert.equal(result.errorCode, "provider_unavailable");
  assert.equal(result.attempts, 4);
  assert.deepEqual(sleeps, [50, 100, 200]);
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

add("L1: unknown reader errors are not retried", async () => {
  let calls = 0;
  const reader = { async getOrder() { calls += 1; throw new TypeError("bug"); } };
  const { reconciler, sleeps, jobs } = harness({ reader });
  await reconciler.trackOrder(FIXTURE_ORDER_ID);
  const polled = await reconciler.reconcileOrder(FIXTURE_ORDER_ID);
  assert.equal(polled.status, "read_failed");
  assert.equal(polled.errorCode, "reader_error");
  assert.equal(polled.attempts, 1);
  assert.deepEqual(sleeps, []);
  const callback = await deliver(reconciler, cloudEvent({ time: "2026-10-10T12:00:00Z" }));
  assert.equal(callback.outcome, "deferred", "within the min interval of the poll read");
  assert.equal(calls, 1);
  assert.equal(jobs.length, 1);
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
    ...inner,
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

add("compare-and-set under real interleaving: two workers converge without regression", async () => {
  const clock = mutableClock();
  const inner = createInMemoryProdigiReconciliationStore({ clock });
  // Yield between read and write so the two workers genuinely interleave.
  const store = { ...inner, async getOrder(input) { const value = await inner.getOrder(input); await new Promise((r) => setImmediate(r)); return value; } };
  const older = harness({ store, clock, responses: [readResponse({ details: { downloadAssets: "Complete" }, lastUpdated: "2026-10-10T12:00:00.000Z" })] });
  const newer = harness({ store, clock, responses: [readResponse({ details: { downloadAssets: "Complete", inProduction: "Complete" }, lastUpdated: "2026-10-10T13:00:00.000Z" })] });
  await older.reconciler.trackOrder(FIXTURE_ORDER_ID);
  const [a, b] = await Promise.all([older.reconciler.reconcileOrder(FIXTURE_ORDER_ID), newer.reconciler.reconcileOrder(FIXTURE_ORDER_ID)]);
  const final = await store.getOrder({ scope: SCOPE, orderId: FIXTURE_ORDER_ID });
  assert.equal(final.details.inProduction, "Complete");
  assert.equal(final.lastUpdated, "2026-10-10T13:00:00.000Z");
  assert.ok(["applied", "stale_rejected"].includes(a.status) && b.status === "applied", `${a.status}/${b.status}`);
});

add("store failures surface as store_unavailable", async () => {
  const broken = {
    async hasEvent() { throw new Error("db down"); },
    async recordEvent() { throw new Error("db down"); },
    async getOrder() { throw new Error("db down"); },
    async compareAndSetOrder() { throw new Error("db down"); }
  };
  const { reconciler } = harness({ store: broken });
  await rejectsWith(reconciler.trackOrder(FIXTURE_ORDER_ID), "store_unavailable");
  await rejectsWith(deliver(reconciler, cloudEvent()), "store_unavailable");
});

add("the suite made no network request", () => {
  if (guard !== undefined) {
    assert.equal(guard.installed, true);
    assert.equal(guard.attempts, 0);
  }
  assert.equal(localFetchCalls, 0);
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

export function networkGuardInstalled() {
  return guard !== undefined && guard.installed === true;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const results = await runProdigiCallbackSuite();
  for (const result of results) process.stdout.write(`${result.status.toUpperCase()} ${result.name}${result.detail ? `: ${result.detail}` : ""}\n`);
  const failed = results.filter((result) => result.status !== "passed");
  process.stdout.write(`Prodigi callback suite: ${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}
