import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntimeMeteringResolver, FulfillmentMetering } from "../dist/metering.js";
import { DurableJsonStore } from "../dist/metering-store.js";
import { FulfillmentConnectorRuntime } from "../dist/runtime.js";
import { CONTRACT_OWNERSHIP } from "../dist/contracts.js";

const here = dirname(fileURLToPath(import.meta.url));
const storeModuleUrl = new URL("../dist/metering-store.js", import.meta.url).href;
const scope = { tenantId: "tenant-fixture-1", projectId: "project-fixture-1" };
const baseEpoch = Date.parse("2026-10-10T14:00:00.000Z");
const results = [];

async function test(name, run) {
  try {
    await run();
    results.push({ name, status: "passed" });
  } catch (error) {
    results.push({
      name,
      status: "failed",
      error: error instanceof Error ? error.message : "unexpected fixture failure"
    });
  }
}

function money(value, currency = "USD", basis = "estimated") {
  return { amount: { representation: "decimal", value, currency }, basis };
}

function unknownMoney() {
  return { amount: null, basis: "unknown" };
}

function createHarness(directory, options = {}) {
  const state = {
    now: baseEpoch,
    ids: 0,
    validateCalls: [],
    sinkCalls: [],
    sinkDedup: new Map(),
    budgetCalls: [],
    resolverCalls: [],
    dispatchCalls: []
  };
  const contracts = {
    binding(shape) {
      if (options.missingBinding === shape) return { shape, state: "missing" };
      return {
        shape,
        ownerRepository: shape === "budget_reservation" ? "cost-intelligence" : "shared-contracts",
        upstreamIssue: shape === "budget_reservation" ? "12" : "11",
        state: options.bindingState ?? "development_fixture",
        schemaVersion: "private-metering-fixture/1",
        fixtureDigest: "sha256:private-fixture-only"
      };
    },
    async validateOutbound(request) {
      state.validateCalls.push({ operation: request.operation, shape: request.requiredShapes[0] });
      if (options.rejectShape === request.requiredShapes[0]) {
        return { ok: false, failure: { code: "invalid_input" } };
      }
      return {
        ok: true,
        value: request.value,
        receipts: request.requiredShapes.map((shape) => ({
          shape,
          schemaVersion: "private-metering-fixture/1",
          tenantId: request.trustedScope.tenantId,
          projectId: request.trustedScope.projectId
        }))
      };
    },
    async validateInbound() {
      return { ok: false, failure: { code: "invalid_input" } };
    }
  };
  const sink = {
    fail: options.sinkFails ?? false,
    acceptedThenThrow: options.acceptedThenThrow ?? false,
    async record(payload) {
      const copy = structuredClone(payload);
      state.sinkCalls.push(copy);
      const eventId = copy.event_id;
      state.sinkDedup.set(eventId, (state.sinkDedup.get(eventId) ?? 0) + 1);
      if (this.fail || (this.acceptedThenThrow && state.sinkDedup.get(eventId) === 1)) {
        throw new Error("fixture raw supplier credential must never be persisted");
      }
      await options.sinkRecordHook?.(copy, state);
    }
  };
  const budget = {
    async authorize(check) {
      const copy = structuredClone(check.contractPayload);
      state.budgetCalls.push({ mode: check.mode, payload: copy });
      if (options.budgetBehavior !== undefined) return options.budgetBehavior(check, state);
      return { authorized: true, reference: `reservation-${state.budgetCalls.length}` };
    }
  };
  const resolver = options.resolver === false ? undefined : {
    status: options.resolverStatus ?? "not_found",
    async resolve(requestId, trustedScope, mode) {
      state.resolverCalls.push({ requestId, trustedScope: structuredClone(trustedScope), mode });
      if (typeof this.status === "function") return this.status(requestId, trustedScope, mode);
      return this.status === "reserved"
        ? { status: "reserved", reference: "reservation-resolved-1" }
        : { status: this.status };
    }
  };
  const clock = { now: () => state.now };
  const idFactory = () => `fixture-id-${++state.ids}`;
  const dependencies = {
    directory,
    scope,
    providerId: "fixture-provider",
    mode: "simulated",
    billingMode: "sandbox",
    evidenceMode: "private_fixture",
    contracts,
    usageSink: sink,
    budgetClient: budget,
    ...(resolver === undefined ? {} : { reservationResolver: resolver }),
    clock,
    idFactory
  };
  return { state, contracts, sink, budget, resolver, clock, dependencies };
}

function billableInput(clientAttemptKey, overrides = {}) {
  return {
    providerId: "fixture-provider",
    operation: "submit",
    logicalOperationId: "logical-order-1",
    clientAttemptKey,
    sourceRefs: ["preview:fixture-1", "bundle:fixture-1"],
    quoteAmount: money("11.5000", "USD", "provider_confirmed"),
    reservationAmount: money("12.0000", "USD", "estimated"),
    ...overrides
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function withTimeout(promise, label, timeoutMs = 15_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out waiting for ${label}`)), timeoutMs);
      })
    ]);
  } finally { clearTimeout(timer); }
}

async function waitForSignal(signal, operation, label) {
  await withTimeout(Promise.race([
      signal.promise,
      operation.then((result) => { throw new Error(`${label} not reached: ${JSON.stringify(result)}`); })
    ]), label, 15_000);
}

function createRuntimeHarness(directory, options = {}) {
  const meterHarness = createHarness(directory, options);
  const runtimeContracts = {
    binding(shape) {
      return {
        shape,
        ...CONTRACT_OWNERSHIP[shape],
        state: "development_fixture",
        schemaVersion: "1.0.0",
        fixtureDigest: "sha256:private-fixture-only"
      };
    },
    async validateInbound(request) {
      return {
        ok: true,
        value: request.envelope.command,
        receipts: request.requiredShapes.map((shape) => ({
          shape,
          schemaVersion: "1.0.0",
          tenantId: request.trustedScope.tenantId,
          projectId: request.trustedScope.projectId
        }))
      };
    },
    async validateOutbound(request) {
      return {
        ok: true,
        value: request.value,
        receipts: request.requiredShapes.map((shape) => ({
          shape,
          schemaVersion: "1.0.0",
          tenantId: request.trustedScope.tenantId,
          projectId: request.trustedScope.projectId
        }))
      };
    }
  };
  const attempts = new Map();
  const attemptKey = (record) => `${record.providerId}/${record.tenantId}/${record.projectId}/${record.idempotencyKey}`;
  const persistence = {
    async getSubmitAttempt(providerId, trustedScope, key) {
      return attempts.get(`${providerId}/${trustedScope.tenantId}/${trustedScope.projectId}/${key}`);
    },
    async claimSubmitAttempt(record) {
      const key = attemptKey(record);
      const existing = attempts.get(key);
      if (existing !== undefined) return { claimed: false, existing };
      attempts.set(key, record);
      return { claimed: true };
    },
    async saveSubmitAttempt(record) {
      const key = attemptKey(record);
      if (!attempts.has(key)) throw new Error("attempt_missing");
      attempts.set(key, record);
    }
  };
  let authorizationSequence = 0;
  const operations = Object.fromEntries([
    "discover_capabilities", "quote", "preflight", "submit", "status", "shipment", "cancel"
  ].map((operation) => [operation, {
    supported: true,
    sideEffect: operation === "submit" || operation === "cancel" ? "external" : "none",
    mayCharge: operation === "submit",
    idempotency: operation === "submit" ? "connector_attempt_store" : operation === "cancel" ? "provider_key" : "not_applicable"
  }]));
  const adapter = {
    descriptor: {
      providerId: "fixture-provider",
      apiVersion: "private-fixture-api/1",
      productLimits: {},
      operations,
      supportedModes: ["simulated"]
    },
    async quote() { return { status: "unsupported" }; },
    async preflight() { return { status: "unsupported" }; },
    async validateBeforeSubmit() { return { status: "supported", value: { valid: true, issues: [] } }; },
    async submit(command, context) {
      await context.transport.request({ operation: "submit", method: "POST", path: "/private-fixture/orders", body: command });
      return { status: "supported", value: { providerRequestId: "supplier-request-runtime-1", acceptedAt: "2026-10-10T14:00:00.000Z" } };
    },
    async getStatus() { return { status: "unsupported" }; },
    async observeShipment() { return { status: "unsupported" }; },
    async cancel() { return { status: "unsupported" }; }
  };
  let transportMode = "simulated";
  let transportCalls = 0;
  let budgetCalls = 0;
  const transport = {
    get mode() { return transportMode; },
    set mode(value) { transportMode = value; },
    async request() { transportCalls += 1; return { fixture: true }; }
  };
  const budgetClient = {
    async authorize(check) {
      budgetCalls += 1;
      if (options.runtimeBudgetBehavior !== undefined) return options.runtimeBudgetBehavior(check, meterHarness.state);
      return { authorized: true, reference: `runtime-reservation-${budgetCalls}` };
    }
  };
  const meteringResolver = createRuntimeMeteringResolver({
    ...meterHarness.dependencies,
    contracts: runtimeContracts,
    usageSink: meterHarness.sink,
    budgetClient
  });
  const runtime = new FulfillmentConnectorRuntime(adapter, {
    contracts: runtimeContracts,
    transport,
    clock: meterHarness.clock,
    persistence,
    authorizationVerifier: {
      async verifyAndClaim() {
        authorizationSequence += 1;
        return {
          status: "claimed",
          authorizationId: `runtime-auth-${authorizationSequence}`,
          actionId: `runtime-action-${authorizationSequence}`,
          claimReference: `runtime-claim-${authorizationSequence}`
        };
      }
    },
    budgetClient,
    usageSink: meterHarness.sink,
    metering: meteringResolver
  });
  function command(key, expiresAt = new Date(baseEpoch + 60 * 60 * 1000).toISOString()) {
    return {
      productionBundle: { fixture: "bundle" },
      productionBundleDigest: "sha256:fixture-bundle",
      quote: {
        quoteId: "quote-runtime-1",
        currency: "USD",
        totalMinor: 1250,
        expiresAt,
        productionBundleDigest: "sha256:fixture-bundle",
        termsFingerprint: "sha256:fixture-terms"
      },
      authorizationEnvelope: { fixture: "authorization" },
      amountMinor: 1250,
      currency: "USD",
      idempotencyKey: key,
      requestFingerprint: `sha256:${key}`
    };
  }
  return {
    runtime,
    state: meterHarness.state,
    sink: meterHarness.sink,
    attempts,
    command,
    meteringResolver,
    transport,
    get transportCalls() { return transportCalls; },
    get budgetCalls() { return budgetCalls; }
  };
}

const privateProducerRows = Object.freeze([
  Object.freeze({
    scenario: "quote-valid",
    input: Object.freeze({
      operation: "quote",
      sourceEventKey: "private:quote:valid:1",
      logicalOperationId: "logical-order-quote-1",
      outcome: "observed",
      completeness: "complete",
      sourceRefs: Object.freeze(["supplier-observation:quote-1", "order-approval:order-1"]),
      quoteAmount: Object.freeze({ amount: Object.freeze({ representation: "decimal", value: "7.2300", currency: "EUR" }), basis: "provider_confirmed" }),
      chargeAmount: Object.freeze({ amount: null, basis: "unknown" }),
      effect: "non_billable_observation"
    })
  }),
  Object.freeze({
    scenario: "quote-invalid",
    input: Object.freeze({
      operation: "quote",
      sourceEventKey: "private:quote:invalid:1",
      logicalOperationId: "logical-order-quote-invalid-1",
      outcome: "observed",
      completeness: "complete",
      sourceRefs: Object.freeze(["supplier-observation:quote-invalid-1"]),
      quoteAmount: Object.freeze({ amount: Object.freeze({ representation: "decimal", value: "7.23x", currency: "EUR" }), basis: "provider_confirmed" }),
      chargeAmount: Object.freeze({ amount: null, basis: "unknown" }),
      effect: "non_billable_observation"
    })
  }),
  Object.freeze({
    scenario: "quote-unknown",
    input: Object.freeze({
      operation: "quote",
      sourceEventKey: "private:quote:unknown:1",
      logicalOperationId: "logical-order-quote-unknown-1",
      outcome: "observed",
      completeness: "unknown",
      sourceRefs: Object.freeze(["supplier-observation:quote-unknown-1", "order-approval:order-unknown-1"]),
      quoteAmount: Object.freeze({ amount: null, basis: "unknown" }),
      chargeAmount: Object.freeze({ amount: null, basis: "unknown" }),
      effect: "non_billable_observation"
    })
  }),
  Object.freeze({
    scenario: "status-observation",
    input: Object.freeze({
      operation: "status",
      sourceEventKey: "private:status:1",
      logicalOperationId: "logical-order-submit-1",
      billableAttemptId: "billable-attempt-submit-1",
      transportAttemptId: "transport-attempt-submit-1",
      providerRequestId: "supplier-request-1",
      outcome: "observed",
      completeness: "complete",
      sourceRefs: Object.freeze(["supplier-observation:status-1", "order-approval:order-1"]),
      quoteAmount: Object.freeze({ amount: null, basis: "unknown" }),
      chargeAmount: Object.freeze({ amount: null, basis: "unknown" }),
      effect: "non_billable_observation"
    })
  }),
  Object.freeze({
    scenario: "ambiguous-outcome",
    input: Object.freeze({
      operation: "submit",
      sourceEventKey: "private:submit:ambiguous:1",
      logicalOperationId: "logical-order-ambiguous-1",
      billableAttemptId: "billable-attempt-ambiguous-1",
      transportAttemptId: "transport-attempt-ambiguous-1",
      outcome: "unknown",
      completeness: "unknown",
      sourceRefs: Object.freeze(["supplier-observation:timeout-1", "order-approval:order-ambiguous-1"]),
      quoteAmount: Object.freeze({ amount: Object.freeze({ representation: "minor_units", units: "1250", currency: "USD" }), basis: "provider_confirmed" }),
      chargeAmount: Object.freeze({ amount: null, basis: "unknown" }),
      effect: "unknown_effect"
    })
  })
]);
const privateProducerFixtureDigest = `sha256:${createHash("sha256").update(JSON.stringify(privateProducerRows), "utf8").digest("hex")}`;

async function readyAttempt(harness, key = "attempt-key-1", overrides = {}) {
  const meter = await FulfillmentMetering.open(harness.dependencies);
  const result = await meter.prepareBillableAttempt(billableInput(key, overrides));
  assert.equal(result.status, "ready");
  return { meter, attemptId: result.attemptId, reservationReference: result.reservationReference };
}

async function newTempDir(prefix = "fc10-metering-") {
  return mkdtemp(resolve(tmpdir(), prefix));
}

await test("observations keep stable identity, exact source money and separate modes", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory);
    const meter = await FulfillmentMetering.open(harness.dependencies);
    const input = {
      operation: "quote",
      sourceEventKey: "provider-quote-observation-1",
      logicalOperationId: "logical-order-1",
      outcome: "observed",
      completeness: "complete",
      effect: "non_billable_observation",
      quoteAmount: money("7.2300", "EUR", "provider_confirmed"),
      chargeAmount: unknownMoney()
    };
    const first = await meter.recordObservation(input);
    const replay = await meter.recordObservation(input);
    assert.equal(first.status, "recorded");
    assert.equal(replay.status, "recorded");
    assert.equal(replay.eventId, first.eventId);
    assert.equal(replay.observationId, first.observationId);
    assert.equal(harness.state.sinkCalls.length, 1);
    const payload = harness.state.sinkCalls[0];
    assert.equal(payload.event_id, first.eventId);
    assert.equal(payload.observation_id, first.observationId);
    assert.equal(payload.provider_id, "fixture-provider");
    assert.deepEqual(payload.trusted_scope, scope);
    assert.equal(payload.mode, "simulated");
    assert.equal(payload.billing_mode, "sandbox");
    assert.equal(payload.evidence_mode, "private_fixture");
    assert.equal(payload.quote_amount.amount.value, "7.2300");
    assert.equal(payload.quote_amount.amount.currency, "EUR");
    assert.deepEqual(payload.charge_amount, unknownMoney());
    assert.equal(payload.duration_ms, null);
    assert.deepEqual(payload.source_refs, []);
    const conflict = await meter.recordObservation({ ...input, quoteAmount: money("7.23", "EUR", "provider_confirmed") });
    assert.equal(conflict.status, "blocked");
    assert.equal(conflict.reason, "attempt_conflict");
    assert.equal(harness.state.sinkCalls.length, 1);
    const numericAmount = await meter.recordObservation({
      ...input,
      sourceEventKey: "invalid-numeric-amount",
      quoteAmount: { amount: { representation: "decimal", value: 7.23, currency: "EUR" }, basis: "provider_confirmed" }
    });
    assert.equal(numericAmount.status, "blocked");
    assert.equal(numericAmount.reason, "invalid_input");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("sink outage persists a stable outbox event and blocks reservation and dispatch", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory, { sinkFails: true });
    const meter = await FulfillmentMetering.open(harness.dependencies);
    const prepared = await meter.prepareBillableAttempt(billableInput("outage-key"));
    assert.equal(prepared.status, "blocked");
    assert.equal(prepared.reason, "usage_sink_unavailable");
    assert.equal(harness.state.budgetCalls.length, 0);
    const before = await meter.snapshot();
    const pending = before.outbox.filter((event) => event.deliveryState === "pending");
    assert.equal(pending.length, 1);
    const stableEventId = pending[0].eventId;
    harness.sink.fail = false;
    const restarted = await FulfillmentMetering.open(harness.dependencies);
    const replay = await restarted.replayPending();
    assert.equal(replay.pending, 0);
    assert.equal(replay.delivered, 1);
    assert.equal(harness.state.sinkCalls.at(-1).event_id, stableEventId);
    assert.equal(harness.state.budgetCalls.length, 0);
    const continued = await restarted.prepareBillableAttempt(billableInput("outage-key"));
    assert.equal(continued.status, "ready");
    assert.equal(harness.state.budgetCalls.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("sink acknowledgment loss replays at least once with the same conflict identity", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory, { acceptedThenThrow: true });
    const meter = await FulfillmentMetering.open(harness.dependencies);
    const first = await meter.recordObservation({
      operation: "status",
      sourceEventKey: "status-source-1",
      outcome: "observed",
      completeness: "partial",
      effect: "non_billable_observation"
    });
    assert.equal(first.status, "pending");
    const saved = (await meter.snapshot()).outbox[0];
    harness.sink.acceptedThenThrow = false;
    const restarted = await FulfillmentMetering.open(harness.dependencies);
    const report = await restarted.replayPending();
    assert.equal(report.pending, 0);
    const sameIdentity = harness.state.sinkCalls.map((call) => call.event_id);
    assert.deepEqual(sameIdentity, [saved.eventId, saved.eventId]);
    assert.equal(harness.state.sinkDedup.get(saved.eventId), 2);
    assert.equal((await restarted.snapshot()).outbox[0].eventId, saved.eventId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("accounting precedes one reserved dispatch and keeps charge evidence separate", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory);
    const { meter, attemptId } = await readyAttempt(harness, "ordered-key");
    assert.equal(harness.state.budgetCalls.length, 1);
    const callsBefore = harness.state.sinkCalls.length;
    let dispatchCount = 0;
    const result = await meter.dispatchPreparedAttempt(attemptId, async (identity) => {
      dispatchCount += 1;
      assert.equal(identity.mode, "simulated");
      assert.equal(identity.billingMode, "sandbox");
      assert.equal(identity.evidenceMode, "private_fixture");
      assert.equal(identity.logicalOperationId, "logical-order-1");
      return {
        outcome: "provider_accepted",
        providerRequestId: "provider-request-1",
        sourceRefs: ["provider-receipt:1"],
        chargeAmount: money("12.3400", "USD", "provider_confirmed")
      };
    });
    assert.equal(result.status, "effect_recorded");
    assert.equal(result.outcome, "provider_accepted");
    assert.equal(result.providerRequestId, "provider-request-1");
    assert.equal(result.pendingEventId, null);
    assert.equal(dispatchCount, 1);
    assert.ok(harness.state.sinkCalls.length > callsBefore);
    const outcome = harness.state.sinkCalls.find((call) => call.event_type === "billable_attempt_outcome");
    assert.ok(outcome);
    assert.equal(outcome.billable_attempt_id, attemptId);
    assert.equal(typeof outcome.transport_attempt_id, "string");
    assert.equal(outcome.provider_request_id, "provider-request-1");
    assert.equal(outcome.quote_amount.amount.value, "11.5000");
    assert.equal(outcome.charge_amount.amount.value, "12.3400");
    assert.equal(outcome.charge_amount.amount.currency, "USD");
    assert.equal(outcome.charge_amount.basis, "provider_confirmed");
    assert.equal(outcome.mode, "simulated");
    assert.equal(outcome.billing_mode, "sandbox");
    assert.equal(outcome.evidence_mode, "private_fixture");
    assert.equal(outcome.effect, "confirmed_effect");
    assert.equal(outcome.duration_ms, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("unknown reservation survives restart and elapsed time until finance authority resolves it", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory, {
      resolverStatus: "unknown",
      budgetBehavior: async (_check, state) => {
        if (state.budgetCalls.length === 1) throw new Error("fixture finance timeout with sensitive detail");
        return { authorized: true, reference: `released-retry-${state.budgetCalls.length}` };
      }
    });
    const meter = await FulfillmentMetering.open(harness.dependencies);
    const pending = await meter.prepareBillableAttempt(billableInput("uncertain-budget-key"));
    assert.equal(pending.status, "blocked");
    assert.equal(pending.reason, "budget_unknown");
    assert.equal(harness.state.budgetCalls.length, 1);
    const storedAttemptId = pending.attemptId;
    harness.state.now += 30 * 24 * 60 * 60 * 1000;
    const restarted = await FulfillmentMetering.open(harness.dependencies);
    const resolution = await restarted.reconcileReservation(storedAttemptId);
    assert.equal(resolution.status, "blocked");
    assert.equal(resolution.reason, "budget_unknown");
    const distinctKey = await restarted.prepareBillableAttempt(billableInput("uncertain-budget-key-2"));
    assert.equal(distinctKey.status, "blocked");
    assert.equal(distinctKey.reason, "logical_operation_blocked");
    assert.equal(harness.state.budgetCalls.length, 1);
    assert.equal(harness.state.dispatchCalls.length, 0);
    assert.equal(JSON.stringify(await restarted.snapshot()).includes("sensitive detail"), false);
    harness.resolver.status = "released";
    const released = await restarted.reconcileReservation(storedAttemptId);
    assert.equal(released.status, "denied");
    assert.equal(harness.state.budgetCalls.length, 1);
    const retry = await restarted.prepareBillableAttempt(billableInput("uncertain-budget-key-2"));
    assert.equal(retry.status, "ready", JSON.stringify(retry));
    assert.equal(harness.state.budgetCalls.length, 2);
    const attempts = (await restarted.snapshot()).attempts;
    assert.equal(new Set(attempts.map((attempt) => attempt.attemptId)).size, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("unknown reservation amount and missing contract pins fail closed before finance effects", async () => {
  const directory = await newTempDir();
  try {
    const unknownHarness = createHarness(directory);
    const unknownMeter = await FulfillmentMetering.open(unknownHarness.dependencies);
    const unknown = await unknownMeter.prepareBillableAttempt(billableInput("unknown-amount-key", { reservationAmount: unknownMoney() }));
    assert.equal(unknown.status, "blocked");
    assert.equal(unknown.reason, "budget_unknown");
    assert.equal(unknownHarness.state.budgetCalls.length, 0);

    const otherDirectory = await newTempDir();
    try {
      const missingHarness = createHarness(otherDirectory, { missingBinding: "fulfillment_usage" });
      const missingMeter = await FulfillmentMetering.open(missingHarness.dependencies);
      const blocked = await missingMeter.prepareBillableAttempt(billableInput("missing-usage-pin-key"));
      assert.equal(blocked.status, "blocked");
      assert.equal(blocked.reason, "usage_sink_unavailable");
      assert.equal(missingHarness.state.budgetCalls.length, 0);
      assert.equal(missingHarness.state.sinkCalls.length, 0);
    } finally { await rm(otherDirectory, { recursive: true, force: true }); }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("concurrent distinct keys cannot duplicate finance reservation for one logical operation", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory);
    const first = await FulfillmentMetering.open(harness.dependencies);
    const second = await FulfillmentMetering.open(harness.dependencies);
    const results = await Promise.all([
      first.prepareBillableAttempt(billableInput("concurrent-key-a")),
      second.prepareBillableAttempt(billableInput("concurrent-key-b"))
    ]);
    assert.equal(results.filter((result) => result.status === "ready").length, 1, JSON.stringify(results));
    assert.equal(results.filter((result) => result.status === "blocked" && result.reason === "logical_operation_blocked").length, 1, JSON.stringify(results));
    assert.equal(harness.state.budgetCalls.length, 1);
    const snapshot = await first.snapshot();
    assert.equal(snapshot.attempts.length, 1);
    assert.equal(new Set(snapshot.attempts.map((attempt) => attempt.attemptId)).size, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("same persisted dispatch claim is one-winner across two manager instances", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory);
    const prepared = await readyAttempt(harness, "dispatch-race-key");
    const manager2 = await FulfillmentMetering.open(harness.dependencies);
    let releaseDispatch;
    const dispatchGate = new Promise((resolveGate) => { releaseDispatch = resolveGate; });
    let dispatchCount = 0;
    const dispatch = async () => {
      dispatchCount += 1;
      await dispatchGate;
      return { outcome: "provider_accepted", providerRequestId: "one-winner-request" };
    };
    const first = prepared.meter.dispatchPreparedAttempt(prepared.attemptId, dispatch);
    const deadline = Date.now() + 5000;
    while (dispatchCount === 0 && Date.now() < deadline) await new Promise((resolveTurn) => setTimeout(resolveTurn, 5));
    assert.equal(dispatchCount, 1, "the first manager should own the durable dispatch claim");
    const second = await manager2.dispatchPreparedAttempt(prepared.attemptId, dispatch);
    assert.equal(second.status, "blocked");
    assert.equal(dispatchCount, 1);
    releaseDispatch();
    const firstResult = await first;
    assert.equal(firstResult.status, "effect_recorded");
    assert.equal(firstResult.outcome, "provider_accepted");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("confirmed not-dispatched outcome retries only after external reservation release", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory, { resolverStatus: "released" });
    const first = await readyAttempt(harness, "retry-key-1");
    const outcome = await first.meter.dispatchPreparedAttempt(first.attemptId, async () => ({ outcome: "not_dispatched" }));
    assert.equal(outcome.status, "effect_recorded");
    assert.equal(outcome.outcome, "not_dispatched");
    const released = await first.meter.reconcileReservation(first.attemptId);
    assert.equal(released.status, "denied");
    const second = await first.meter.prepareBillableAttempt(billableInput("retry-key-2"));
    assert.equal(second.status, "ready");
    assert.notEqual(second.attemptId, first.attemptId);
    assert.equal(harness.state.budgetCalls.length, 2);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("throwing supplier response becomes unknown without persisting raw error detail", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory);
    const prepared = await readyAttempt(harness, "supplier-timeout-key");
    const result = await prepared.meter.dispatchPreparedAttempt(prepared.attemptId, async () => {
      throw new Error("fixture supplier secret raw exception text");
    });
    assert.equal(result.status, "effect_recorded");
    assert.equal(result.outcome, "unknown");
    const raw = await readFile(resolve(directory, "metering-state.json"), "utf8");
    assert.equal(raw.includes("fixture supplier secret raw exception text"), false);
    assert.equal(raw.includes("reservationReference"), true);
    const retry = await prepared.meter.prepareBillableAttempt(billableInput("supplier-timeout-new-key"));
    assert.equal(retry.status, "blocked");
    assert.equal(retry.reason, "logical_operation_blocked");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("same-process store instances serialize updates without lost snapshots", async () => {
  const directory = await newTempDir();
  try {
    const first = await DurableJsonStore.open(directory, { revision: 0, count: 0 });
    const second = await DurableJsonStore.open(directory, { revision: 0, count: 0 });
    await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 === 0 ? first : second).update((current) => {
      const state = current;
      assert.equal(typeof state, "object");
      return { state: { revision: state.revision, count: state.count + 1 }, result: null };
    })));
    const state = await first.read();
    assert.equal(state.count, 24);
    assert.equal(state.revision, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("separate processes contend safely and recover only after the lock owner dies", async () => {
  const directory = await newTempDir();
  let holder;
  try {
    const parent = await DurableJsonStore.open(directory, { count: 0 });
    const environment = {
      ...process.env,
      FC10_STORE_URL: storeModuleUrl,
      FC10_STORE_DIR: directory
    };
    const holderScript = `
      const { DurableJsonStore } = await import(process.env.FC10_STORE_URL);
      const store = await DurableJsonStore.open(process.env.FC10_STORE_DIR, { count: 0 }, {
        afterLock: async () => { process.stdout.write("LOCKED\\n"); await new Promise(() => {}); }
      });
      await store.update((state) => ({ state: { count: state.count + 1 }, result: null }));
    `;
    holder = spawn(process.execPath, ["--input-type=module", "-e", holderScript], { env: environment, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    await new Promise((resolveLine, rejectLine) => {
      const timeout = setTimeout(() => rejectLine(new Error("lock holder did not acquire lock")), 5000);
      holder.stdout.on("data", (chunk) => {
        output += chunk.toString();
        if (output.includes("LOCKED")) { clearTimeout(timeout); resolveLine(); }
      });
      holder.once("error", (error) => { clearTimeout(timeout); rejectLine(error); });
      holder.once("exit", (code) => {
        if (!output.includes("LOCKED")) { clearTimeout(timeout); rejectLine(new Error(`lock holder exited early: ${code}`)); }
      });
    });
    const contenderScript = `
      const { DurableJsonStore } = await import(process.env.FC10_STORE_URL);
      const store = await DurableJsonStore.open(process.env.FC10_STORE_DIR, { count: 0 });
      try { await store.update((state) => ({ state: { count: state.count + 1 }, result: null })); process.stdout.write("UNEXPECTED_SUCCESS"); }
      catch (error) { process.stdout.write(String(error.code ?? "unknown")); }
    `;
    const contender = execFileSync(process.execPath, ["--input-type=module", "-e", contenderScript], {
      env: environment,
      encoding: "utf8",
      timeout: 5000
    });
    assert.equal(contender, "storage_busy");
    holder.kill("SIGKILL");
    await new Promise((resolveExit) => holder.once("exit", resolveExit));
    holder = undefined;
    await parent.update((state) => ({ state: { count: state.count + 1 }, result: null }));
    assert.deepEqual(await parent.read(), { count: 1 });
  } finally {
    if (holder !== undefined && holder.exitCode === null) holder.kill("SIGKILL");
    await rm(directory, { recursive: true, force: true });
  }
});

await test("abrupt process exit after temp-file fsync preserves old state and never treats lease time as release", async () => {
  const directory = await newTempDir();
  try {
    const parent = await DurableJsonStore.open(directory, { revision: 0, value: "before" });
    await parent.update((state) => ({ state: { revision: state.revision + 1, value: "committed-before-crash" }, result: null }));
    const crashScript = `
      const { DurableJsonStore } = await import(process.env.FC10_STORE_URL);
      const store = await DurableJsonStore.open(process.env.FC10_STORE_DIR, { revision: 0, value: "before" }, {
        afterTemporaryFileSync: () => process.exit(73)
      });
      await store.update((state) => ({ state: { revision: state.revision + 1, value: "must-not-appear" }, result: null }));
    `;
    let exitCode = null;
    try {
      execFileSync(process.execPath, ["--input-type=module", "-e", crashScript], {
        env: { ...process.env, FC10_STORE_URL: storeModuleUrl, FC10_STORE_DIR: directory },
        encoding: "utf8",
        timeout: 5000
      });
    } catch (error) { exitCode = error.status; }
    assert.equal(exitCode, 73);
    assert.deepEqual(await parent.read(), { revision: 1, value: "committed-before-crash" });
    await parent.update((state) => ({ state: { revision: state.revision + 1, value: "after-dead-owner-recovery" }, result: null }));
    assert.deepEqual(await parent.read(), { revision: 2, value: "after-dead-owner-recovery" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("corrupt durable state fails closed rather than being reset", async () => {
  const fixtures = [
    {
      schemaVersion: "private-connector-metering-state/1",
      revision: 2,
      nextSequence: 1,
      attempts: [],
      outbox: []
    },
    {
      schemaVersion: "private-connector-metering-state/2",
      revision: 2,
      nextSequence: 1,
      attempts: [{ phase: "dispatching" }],
      outbox: []
    }
  ];
  for (const fixture of fixtures) {
    const directory = await newTempDir();
    try {
      const contents = JSON.stringify(fixture);
      const path = resolve(directory, "metering-state.json");
      await writeFile(path, contents);
      await assert.rejects(() => FulfillmentMetering.open(createHarness(directory).dependencies));
      assert.equal(await readFile(path, "utf8"), contents);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

await test("schema /2 terminal and unknown reservation histories migrate without resetting durable data", async () => {
  for (const legacyKind of ["terminal", "unknown", "effect-terminal"]) {
    const directory = await newTempDir();
    try {
      const harness = createHarness(directory, {
        budgetBehavior: async (_check, state) => {
          if (legacyKind === "effect-terminal") return { authorized: true, reference: `legacy-reservation-${state.budgetCalls.length}` };
          throw new Error("fixture authorization ambiguity");
        }
      });
      harness.resolver.status = "released";
      const meter = await FulfillmentMetering.open(harness.dependencies);
      const original = await meter.prepareBillableAttempt(billableInput(`legacy-${legacyKind}`));
      if (legacyKind === "effect-terminal") assert.equal(original.status, "ready");
      else assert.equal(original.status, "blocked");
      if (legacyKind === "terminal") {
        assert.equal((await meter.reconcileReservation(original.attemptId)).status, "denied");
      } else if (legacyKind === "effect-terminal") {
        const outcome = await meter.dispatchPreparedAttempt(original.attemptId, async () => ({
          outcome: "provider_accepted",
          providerRequestId: "legacy-effect-accepted"
        }));
        assert.equal(outcome.status, "effect_recorded");
      }
      const durablePath = resolve(directory, "metering-state.json");
      const legacy = JSON.parse(await readFile(durablePath, "utf8"));
      const targetAttemptId = original.attemptId;
      const attempt = legacy.attempts.find((stored) => stored.attemptId === targetAttemptId);
      assert.ok(attempt);
      if (legacyKind === "unknown") {
        attempt.reservationState = "unknown";
        attempt.phase = "reservation_unknown";
        attempt.reservationReference = null;
      } else if (legacyKind === "effect-terminal") {
        attempt.reservationState = "released";
        attempt.reservationReference = null;
      }
      for (const field of ["reservationRetirement", "reservationConflictEvidence", "reservationHistoryUncertain", "supersededByAttemptId"]) {
        delete attempt[field];
      }
      const originalLegacyBytes = JSON.stringify(legacy);
      await writeFile(durablePath, originalLegacyBytes);

      const reopened = await FulfillmentMetering.open(harness.dependencies);
      if (legacyKind === "unknown") {
        const blocked = await reopened.reconcileReservation(original.attemptId);
        assert.equal(blocked.status, "blocked");
        assert.equal(blocked.reason, "budget_unknown");
        assert.equal(harness.state.resolverCalls.length, 0);
        const distinct = await reopened.prepareBillableAttempt(billableInput("legacy-unknown-replacement"));
        assert.equal(distinct.status, "blocked");
        assert.equal(distinct.reason, "logical_operation_blocked");
        assert.equal(await readFile(durablePath, "utf8"), originalLegacyBytes);
      } else if (legacyKind === "terminal") {
        const terminalResult = await reopened.prepareBillableAttempt(billableInput(`legacy-${legacyKind}`));
        assert.equal(terminalResult.status, "denied");
        assert.equal(await readFile(durablePath, "utf8"), originalLegacyBytes);
      } else {
        const terminalResult = await reopened.prepareBillableAttempt(billableInput(`legacy-${legacyKind}`));
        assert.equal(terminalResult.status, "blocked");
        assert.equal(terminalResult.reason, "attempt_not_ready");
        assert.equal(await readFile(durablePath, "utf8"), originalLegacyBytes);
      }
      const observation = await reopened.recordObservation({
        operation: "status",
        sourceEventKey: `legacy-migration-${legacyKind}`,
        outcome: "observed",
        completeness: "partial",
        effect: "non_billable_observation"
      });
      assert.equal(observation.status, "recorded");
      const migrated = JSON.parse(await readFile(durablePath, "utf8"));
      const migratedAttempt = migrated.attempts.find((stored) => stored.attemptId === targetAttemptId);
      if (legacyKind === "unknown") {
        assert.equal(migratedAttempt.reservationRetirement, null);
        assert.equal(migratedAttempt.reservationHistoryUncertain, true);
        assert.equal(migratedAttempt.reservationState, "unknown");
      } else {
        assert.equal(migratedAttempt.reservationRetirement.state, "released");
        assert.equal(migratedAttempt.reservationRetirement.source, "legacy_state");
        assert.equal(migratedAttempt.reservationHistoryUncertain, false);
      }
      if (legacyKind === "effect-terminal") {
        assert.equal(migratedAttempt.phase, "provider_accepted");
        assert.equal(migratedAttempt.outcome, "provider_accepted");
      }
      assert.equal(migratedAttempt.reservationConflictEvidence, null);
      assert.equal(migratedAttempt.supersededByAttemptId, null);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

await test("durable metering state is bound to provider, modes and tenant-project context", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory);
    const meter = await FulfillmentMetering.open(harness.dependencies);
    const observation = await meter.recordObservation({
      operation: "quote",
      sourceEventKey: "context-bound-observation",
      outcome: "observed",
      completeness: "complete",
      effect: "non_billable_observation"
    });
    const prepared = await meter.prepareBillableAttempt(billableInput("context-bound-attempt"));
    assert.equal(observation.status, "recorded");
    assert.equal(prepared.status, "ready");
    const before = await meter.snapshot();
    const incompatible = [
      { providerId: "other-provider" },
      { mode: "sandbox" },
      { billingMode: "simulated" },
      { evidenceMode: "provider_sandbox_account" },
      { scope: { ...scope, tenantId: "other-tenant" } },
      { scope: { ...scope, projectId: "other-project" } }
    ];
    for (const change of incompatible) {
      await assert.rejects(() => FulfillmentMetering.open({ ...harness.dependencies, ...change }));
    }
    const durablePath = resolve(directory, "metering-state.json");
    const canonicalContents = await readFile(durablePath, "utf8");
    for (const mutate of [
      (state) => { state.context.providerId = "other-provider"; },
      (state) => { state.attempts[0].providerId = "other-provider"; },
      (state) => { state.attempts[0].reservationCandidate.provider_id = "other-provider"; },
      (state) => { state.attempts[0].reservationEnvelope.provider_id = "other-provider"; },
      (state) => { state.outbox[0].candidate.trusted_scope.tenantId = "other-tenant"; },
      (state) => { state.outbox[0].canonicalEnvelope.trusted_scope.tenantId = "other-tenant"; }
    ]) {
      const tampered = JSON.parse(canonicalContents);
      mutate(tampered);
      const tamperedContents = JSON.stringify(tampered);
      await writeFile(durablePath, tamperedContents);
      await assert.rejects(() => FulfillmentMetering.open(harness.dependencies));
      assert.equal(await readFile(durablePath, "utf8"), tamperedContents);
    }
    await writeFile(durablePath, canonicalContents);
    const restarted = await FulfillmentMetering.open(harness.dependencies);
    assert.deepEqual(await restarted.snapshot(), before);
    assert.equal((await restarted.replayPending()).pending, 0);
    assert.equal((await restarted.snapshot()).attempts[0].attemptId, prepared.attemptId);
    assert.equal((await restarted.snapshot()).outbox[0].eventId, observation.eventId);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("runtime metering resolver partitions scopes with independent identical caller keys", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory);
    const resolver = createRuntimeMeteringResolver(harness.dependencies);
    const otherScope = { tenantId: "tenant-fixture-2", projectId: "project-fixture-2" };
    const first = await resolver(scope);
    const second = await resolver(otherScope);
    const observation = {
      operation: "quote",
      sourceEventKey: "same-source-key-in-each-tenant",
      logicalOperationId: "same-logical-operation",
      outcome: "observed",
      completeness: "complete",
      effect: "non_billable_observation"
    };
    const [firstObservation, secondObservation] = await Promise.all([
      first.recordObservation(observation),
      second.recordObservation(observation)
    ]);
    assert.equal(firstObservation.status, "recorded");
    assert.equal(secondObservation.status, "recorded");
    assert.notEqual(firstObservation.eventId, secondObservation.eventId);
    const [firstAttempt, secondAttempt] = await Promise.all([
      first.prepareBillableAttempt(billableInput("same-attempt-key", { logicalOperationId: "same-logical-operation" })),
      second.prepareBillableAttempt(billableInput("same-attempt-key", { logicalOperationId: "same-logical-operation" }))
    ]);
    assert.equal(firstAttempt.status, "ready");
    assert.equal(secondAttempt.status, "ready");
    assert.notEqual(firstAttempt.attemptId, secondAttempt.attemptId);
    const firstRestart = await resolver(scope);
    const secondRestart = await resolver(otherScope);
    assert.equal((await firstRestart.snapshot()).attempts[0].attemptId, firstAttempt.attemptId);
    assert.equal((await secondRestart.snapshot()).attempts[0].attemptId, secondAttempt.attemptId);
    const firstEnvelope = harness.state.sinkCalls.find((payload) => payload.event_id === firstObservation.eventId);
    const secondEnvelope = harness.state.sinkCalls.find((payload) => payload.event_id === secondObservation.eventId);
    assert.deepEqual(firstEnvelope.trusted_scope, scope);
    assert.deepEqual(secondEnvelope.trusted_scope, otherScope);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("late authorization responses preserve dispatch and provider outcomes across restarts", async () => {
  for (const outcome of ["provider_accepted", "unknown"]) {
    for (const completionOrder of ["authorization_during_dispatch", "authorization_after_outcome"]) {
      const directory = await newTempDir();
      try {
        const authorizeStarted = deferred();
        const authorizeResponse = deferred();
        const resolverStarted = deferred();
        const resolverResponse = deferred();
        const harness = createHarness(directory, {
          budgetBehavior: async () => {
            authorizeStarted.resolve();
            return authorizeResponse.promise;
          }
        });
        harness.resolver.status = () => {
          resolverStarted.resolve();
          return resolverResponse.promise;
        };
        const preparingMeter = await FulfillmentMetering.open(harness.dependencies);
        const resolverMeter = await FulfillmentMetering.open(harness.dependencies);
        const dispatchMeter = await FulfillmentMetering.open(harness.dependencies);
        const preparing = preparingMeter.prepareBillableAttempt(billableInput(`late-auth-${outcome}-${completionOrder}`));
        await withTimeout(authorizeStarted.promise, "late-auth budget request");
        const attemptId = (await preparingMeter.snapshot()).attempts[0].attemptId;
        const reconciliation = resolverMeter.reconcileReservation(attemptId);
        await withTimeout(resolverStarted.promise, "late-auth resolver request");
        resolverResponse.resolve({ status: "reserved", reference: "shared-reservation-late-auth" });
        assert.equal((await withTimeout(reconciliation, "late-auth resolver result")).status, "ready");

        const dispatchStarted = deferred();
        const dispatchResponse = deferred();
        let dispatchCount = 0;
        const dispatching = dispatchMeter.dispatchPreparedAttempt(attemptId, async () => {
          dispatchCount += 1;
          dispatchStarted.resolve();
          if (outcome === "unknown") {
            await dispatchResponse.promise;
            throw new Error("fixture timeout after provider boundary");
          }
          return dispatchResponse.promise;
        });
        await waitForSignal(dispatchStarted, dispatching, "late-auth provider dispatch entry");
        assert.equal((await resolverMeter.snapshot()).attempts[0].phase, "dispatching");

        if (completionOrder === "authorization_during_dispatch") {
          authorizeResponse.resolve({ authorized: true, reference: "shared-reservation-late-auth" });
          await withTimeout(preparing, "authorization result during dispatch");
          assert.equal((await preparingMeter.snapshot()).attempts[0].phase, "dispatching");
        }
        dispatchResponse.resolve({ outcome, providerRequestId: outcome === "provider_accepted" ? "late-auth-request" : undefined });
        const dispatchResult = await withTimeout(dispatching, "late-auth provider outcome");
        assert.equal(dispatchResult.status, "effect_recorded");
        assert.equal(dispatchCount, 1);
        if (completionOrder === "authorization_after_outcome") {
          authorizeResponse.resolve({ authorized: true, reference: "shared-reservation-late-auth" });
          await withTimeout(preparing, "authorization result after outcome");
        }

        const expectedPhase = outcome === "provider_accepted" ? "provider_accepted" : "unknown";
        const reopened = await FulfillmentMetering.open(harness.dependencies);
        const snapshot = await reopened.snapshot();
        const stored = snapshot.attempts.find((attempt) => attempt.attemptId === attemptId);
        assert.equal(stored.phase, expectedPhase);
        assert.equal(stored.outcome, outcome);
        assert.equal(stored.providerRequestId, outcome === "provider_accepted" ? "late-auth-request" : null);
        assert.equal(snapshot.outbox.filter((event) => event.eventType === "billable_attempt_outcome").length, 1);
        const outcomeEnvelope = harness.state.sinkCalls.find((payload) => payload.event_type === "billable_attempt_outcome");
        assert.ok(outcomeEnvelope);
        assert.equal(outcomeEnvelope.outcome, outcome);
        assert.equal(outcomeEnvelope.provider_request_id, outcome === "provider_accepted" ? "late-auth-request" : null);
        assert.equal(harness.state.budgetCalls.length, 1);
      } finally { await rm(directory, { recursive: true, force: true }); }
    }
  }
});

await test("concurrent reservation resolutions cannot move dispatch intent or terminal outcomes backwards", async () => {
  const directory = await newTempDir();
  try {
    const authorizeStarted = deferred();
    const authorizeResponse = deferred();
    const resolverGates = [deferred(), deferred(), deferred()];
    const resolverStarted = [deferred(), deferred(), deferred()];
    let resolverIndex = 0;
    let pauseIntent = false;
    let intentEntered = deferred();
    let releaseIntent = deferred();
    const harness = createHarness(directory, {
      budgetBehavior: async () => {
        authorizeStarted.resolve();
        return authorizeResponse.promise;
      },
      sinkRecordHook: async (payload) => {
        if (pauseIntent && payload.event_type === "transport_attempt_intent") {
          pauseIntent = false;
          intentEntered.resolve();
          await releaseIntent.promise;
        }
      }
    });
    harness.resolver.status = () => {
      const index = resolverIndex++;
      resolverStarted[index]?.resolve();
      return resolverGates[index].promise;
    };
    const authorizingMeter = await FulfillmentMetering.open(harness.dependencies);
    const firstResolver = await FulfillmentMetering.open(harness.dependencies);
    const secondResolver = await FulfillmentMetering.open(harness.dependencies);
    const thirdResolver = await FulfillmentMetering.open(harness.dependencies);
    const dispatchMeter = await FulfillmentMetering.open(harness.dependencies);
    const preparing = authorizingMeter.prepareBillableAttempt(billableInput("concurrent-resolution-key"));
    await withTimeout(authorizeStarted.promise, "initial budget request");
    const attemptId = (await authorizingMeter.snapshot()).attempts[0].attemptId;
    const resolution1 = firstResolver.reconcileReservation(attemptId);
    await withTimeout(resolverStarted[0].promise, "first resolver request");
    const resolution2 = secondResolver.reconcileReservation(attemptId);
    await withTimeout(resolverStarted[1].promise, "second resolver request");
    const resolution3 = thirdResolver.reconcileReservation(attemptId);
    await withTimeout(resolverStarted[2].promise, "third resolver request");
    resolverGates[0].resolve({ status: "reserved", reference: "shared-reservation-concurrent" });
    assert.equal((await withTimeout(resolution1, "first reservation result")).status, "ready");

    pauseIntent = true;
    const dispatchEntered = deferred();
    const dispatchOutcome = deferred();
    const dispatching = dispatchMeter.dispatchPreparedAttempt(attemptId, async () => {
      dispatchEntered.resolve();
      return dispatchOutcome.promise;
    });
    await waitForSignal(intentEntered, dispatching, "dispatch intent delivery");
    assert.equal((await dispatchMeter.snapshot()).attempts[0].phase, "dispatch_intent");
    resolverGates[1].resolve({ status: "reserved", reference: "shared-reservation-concurrent" });
    assert.equal((await withTimeout(resolution2, "dispatch-intent reservation result")).status, "blocked");
    assert.equal((await dispatchMeter.snapshot()).attempts[0].phase, "dispatch_intent");

    releaseIntent.resolve();
    await waitForSignal(dispatchEntered, dispatching, "provider dispatch entry");
    dispatchOutcome.resolve({ outcome: "provider_accepted", providerRequestId: "concurrent-resolution-request" });
    assert.equal((await withTimeout(dispatching, "provider outcome")).outcome, "provider_accepted");
    resolverGates[2].resolve({ status: "reserved", reference: "shared-reservation-concurrent" });
    assert.equal((await withTimeout(resolution3, "terminal reservation result")).status, "blocked");
    const snapshot = await (await FulfillmentMetering.open(harness.dependencies)).snapshot();
    assert.equal(snapshot.attempts[0].phase, "provider_accepted");
    assert.equal(snapshot.attempts[0].outcome, "provider_accepted");
    assert.equal(snapshot.attempts[0].providerRequestId, "concurrent-resolution-request");
    assert.equal(snapshot.outbox.filter((event) => event.eventType === "billable_attempt_outcome").length, 1);
    authorizeResponse.resolve({ authorized: true, reference: "shared-reservation-concurrent" });
    await withTimeout(preparing, "late authorization result");
    assert.equal((await authorizingMeter.snapshot()).attempts[0].phase, "provider_accepted");
    assert.equal(harness.state.budgetCalls.length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("own reservation conflicts during dispatch intent fence effects across finance result orders and managers", async () => {
  const cases = [
    { order: "authorize_then_resolver", fact: "released", source: "resolver" },
    { order: "authorize_then_resolver", fact: "denied", source: "resolver" },
    { order: "authorize_then_resolver", fact: "different_reference", source: "resolver" },
    { order: "resolver_then_authorize", fact: "denied", source: "authorization" },
    { order: "resolver_then_authorize", fact: "different_reference", source: "authorization" }
  ];
  for (const scenario of cases) {
    for (const managerOwnership of ["same_manager", "separate_manager"]) {
      for (const restartBeforeClaim of [false, true]) {
        const directory = await newTempDir();
        const authorizationStarted = deferred();
        const authorizationResponse = deferred();
        const resolverStarted = deferred();
        const resolverResponse = deferred();
        const intentEntered = deferred();
        const releaseIntent = deferred();
        let pauseIntent = false;
        try {
          const harness = createHarness(directory, {
            budgetBehavior: async () => {
              authorizationStarted.resolve();
              return authorizationResponse.promise;
            },
            sinkRecordHook: async (payload) => {
              if (pauseIntent && payload.event_type === "transport_attempt_intent") {
                pauseIntent = false;
                intentEntered.resolve();
                await releaseIntent.promise;
              }
            }
          });
          harness.resolver.status = async () => {
            resolverStarted.resolve();
            return resolverResponse.promise;
          };
          const preparingManager = await FulfillmentMetering.open(harness.dependencies);
          const separateManager = await FulfillmentMetering.open(harness.dependencies);
          const concurrentManager = managerOwnership === "same_manager" ? preparingManager : separateManager;
          const resolverManager = concurrentManager;
          const dispatchManager = concurrentManager;
          const preparation = preparingManager.prepareBillableAttempt(
            billableInput(`intent-conflict-${scenario.order}-${scenario.fact}-${managerOwnership}-${restartBeforeClaim}`)
          );
          await withTimeout(authorizationStarted.promise, "intent conflict authorization start");
          const attemptId = (await preparingManager.snapshot()).attempts[0].attemptId;
          const reconciliation = resolverManager.reconcileReservation(attemptId);
          await withTimeout(resolverStarted.promise, "intent conflict resolver start");

          if (scenario.order === "authorize_then_resolver") {
            authorizationResponse.resolve({ authorized: true, reference: "ref-original" });
            assert.equal((await withTimeout(preparation, "initial reservation authorization")).status, "ready");
          } else {
            resolverResponse.resolve({ status: "reserved", reference: "ref-original" });
            assert.equal((await withTimeout(reconciliation, "initial reservation resolver")).status, "ready");
          }

          pauseIntent = true;
          const effects = [];
          const dispatching = dispatchManager.dispatchPreparedAttempt(attemptId, async (identity) => {
            effects.push(identity);
            return { outcome: "provider_accepted", providerRequestId: "must-not-dispatch" };
          });
          await waitForSignal(intentEntered, dispatching, "intent conflict sink pause");

          if (scenario.source === "resolver") {
            resolverResponse.resolve(scenario.fact === "different_reference"
              ? { status: "reserved", reference: "ref-other" }
              : { status: scenario.fact });
            const conflictResult = await withTimeout(reconciliation, "late resolver conflict");
            assert.equal(conflictResult.status, "blocked");
            assert.equal(conflictResult.reason, "budget_unknown");
          } else {
            authorizationResponse.resolve(scenario.fact === "different_reference"
              ? { authorized: true, reference: "ref-other" }
              : { authorized: false });
            const conflictResult = await withTimeout(preparation, "late authorization conflict");
            assert.equal(conflictResult.status, "blocked");
            assert.equal(conflictResult.reason, "budget_unknown");
          }

          const expectedConflict = {
            reservationRequestId: (await preparingManager.snapshot()).attempts[0].reservationRequestId,
            priorState: "reserved",
            priorReference: "ref-original",
            receivedState: scenario.fact === "different_reference" ? "reserved" : scenario.fact,
            receivedReference: scenario.fact === "different_reference" ? "ref-other" : null,
            source: scenario.source,
            observedAt: "2026-10-10T14:00:00.000Z"
          };
          const beforeClaim = JSON.parse(await readFile(resolve(directory, "metering-state.json"), "utf8"));
          assert.equal(beforeClaim.attempts[0].phase, "dispatch_intent");
          assert.equal(beforeClaim.attempts[0].reservationReference, "ref-original");
          assert.deepEqual(beforeClaim.attempts[0].reservationConflictEvidence, expectedConflict);

          const reopened = restartBeforeClaim ? await FulfillmentMetering.open(harness.dependencies) : undefined;
          releaseIntent.resolve();
          const dispatchResult = await withTimeout(dispatching, "claim after intent conflict");
          assert.equal(dispatchResult.status, "blocked");
          assert.equal(dispatchResult.reason, "budget_unknown");
          assert.equal(effects.length, 0);

          const finalManager = reopened ?? dispatchManager;
          if (reopened !== undefined) assert.equal((await reopened.replayPending()).pending, 0);
          const finalState = JSON.parse(await readFile(resolve(directory, "metering-state.json"), "utf8"));
          const finalAttempt = finalState.attempts.find((attempt) => attempt.attemptId === attemptId);
          assert.equal(finalAttempt.phase, "dispatch_intent");
          assert.equal(finalAttempt.outcome, null);
          assert.equal(finalAttempt.reservationReference, "ref-original");
          assert.deepEqual(finalAttempt.reservationConflictEvidence, expectedConflict);
          assert.equal(finalState.outbox.filter((event) => event.eventType === "billable_attempt_outcome").length, 0);
          const retry = await finalManager.dispatchPreparedAttempt(attemptId, async (identity) => {
            effects.push(identity);
            return { outcome: "provider_accepted", providerRequestId: "must-not-retry" };
          });
          assert.equal(retry.status, "blocked");
          assert.equal(retry.reason, "budget_unknown");
          assert.equal(effects.length, 0);
        } finally {
          releaseIntent.resolve();
          await rm(directory, { recursive: true, force: true });
        }
      }
    }
  }
});

await test("equivalent reservation responses during dispatch intent retain the positive dispatch path", async () => {
  for (const order of ["authorize_then_resolver", "resolver_then_authorize"]) {
    for (const managerOwnership of ["same_manager", "separate_manager"]) {
      const directory = await newTempDir();
      const authorizationStarted = deferred();
      const authorizationResponse = deferred();
      const resolverStarted = deferred();
      const resolverResponse = deferred();
      const intentEntered = deferred();
      const releaseIntent = deferred();
      let pauseIntent = false;
      try {
        const harness = createHarness(directory, {
          budgetBehavior: async () => {
            authorizationStarted.resolve();
            return authorizationResponse.promise;
          },
          sinkRecordHook: async (payload) => {
            if (pauseIntent && payload.event_type === "transport_attempt_intent") {
              pauseIntent = false;
              intentEntered.resolve();
              await releaseIntent.promise;
            }
          }
        });
        harness.resolver.status = async () => {
          resolverStarted.resolve();
          return resolverResponse.promise;
        };
        const preparingManager = await FulfillmentMetering.open(harness.dependencies);
        const separateManager = await FulfillmentMetering.open(harness.dependencies);
        const concurrentManager = managerOwnership === "same_manager" ? preparingManager : separateManager;
        const preparation = preparingManager.prepareBillableAttempt(
          billableInput(`equivalent-intent-${order}-${managerOwnership}`)
        );
        await withTimeout(authorizationStarted.promise, "equivalent authorization start");
        const attemptId = (await preparingManager.snapshot()).attempts[0].attemptId;
        const reconciliation = concurrentManager.reconcileReservation(attemptId);
        await withTimeout(resolverStarted.promise, "equivalent resolver start");

        if (order === "authorize_then_resolver") {
          authorizationResponse.resolve({ authorized: true, reference: "ref-equivalent" });
          assert.equal((await withTimeout(preparation, "equivalent authorization result")).status, "ready");
        } else {
          resolverResponse.resolve({ status: "reserved", reference: "ref-equivalent" });
          assert.equal((await withTimeout(reconciliation, "equivalent resolver result")).status, "ready");
        }

        pauseIntent = true;
        const effects = [];
        const dispatching = concurrentManager.dispatchPreparedAttempt(attemptId, async (identity) => {
          effects.push(identity);
          return { outcome: "provider_accepted", providerRequestId: "equivalent-effect" };
        });
        await waitForSignal(intentEntered, dispatching, "equivalent intent sink pause");
        if (order === "authorize_then_resolver") {
          resolverResponse.resolve({ status: "reserved", reference: "ref-equivalent" });
          const result = await withTimeout(reconciliation, "equivalent late resolver");
          assert.equal(result.status, "blocked");
          assert.equal(result.reason, "attempt_outcome_unknown");
        } else {
          authorizationResponse.resolve({ authorized: true, reference: "ref-equivalent" });
          const result = await withTimeout(preparation, "equivalent late authorization");
          assert.equal(result.status, "blocked");
          assert.equal(result.reason, "attempt_outcome_unknown");
        }
        const beforeDispatchState = JSON.parse(await readFile(resolve(directory, "metering-state.json"), "utf8"));
        assert.equal(beforeDispatchState.attempts[0].reservationConflictEvidence, null);
        releaseIntent.resolve();
        const dispatched = await withTimeout(dispatching, "equivalent dispatch outcome");
        assert.equal(dispatched.status, "effect_recorded");
        assert.equal(dispatched.outcome, "provider_accepted");
        assert.equal(effects.length, 1);
        const reopened = await FulfillmentMetering.open(harness.dependencies);
        const reopenedState = JSON.parse(await readFile(resolve(directory, "metering-state.json"), "utf8"));
        const stored = reopenedState.attempts[0];
        assert.equal(stored.phase, "provider_accepted");
        assert.equal(stored.outcome, "provider_accepted");
        assert.equal(stored.reservationConflictEvidence, null);
        assert.equal((await reopened.dispatchPreparedAttempt(attemptId, async (identity) => {
          effects.push(identity);
          return { outcome: "provider_accepted" };
        })).status, "blocked");
        assert.equal(effects.length, 1);
      } finally {
        releaseIntent.resolve();
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
});

await test("released reservations stay retired through stale responses, restart, replay and replacement dispatch", async () => {
  for (const terminalStatus of ["released", "denied"]) {
    for (const responseOrder of ["authorize_then_resolvers", "resolvers_then_authorize"]) {
      for (const newerEffect of ["before_stale_responses", "after_stale_responses"]) {
        for (const restart of [false, true]) {
        const directory = await newTempDir();
        try {
          const authorizeStarted = deferred();
          const authorizeResponse = deferred();
          const resolverStarted = [deferred(), deferred()];
          const resolverResponses = [deferred(), deferred()];
          const releaseStarted = deferred();
          const releaseResponse = deferred();
          let resolverCalls = 0;
          const harness = createHarness(directory, {
            budgetBehavior: async (_check, state) => {
              if (state.budgetCalls.length === 1) {
                authorizeStarted.resolve();
                return authorizeResponse.promise;
              }
              return { authorized: true, reference: "replacement-reservation" };
            }
          });
          harness.resolver.status = async () => {
            const index = resolverCalls++;
            if (index < resolverResponses.length) {
              resolverStarted[index].resolve();
              return resolverResponses[index].promise;
            }
            releaseStarted.resolve();
            return releaseResponse.promise;
          };

          let manager = await FulfillmentMetering.open(harness.dependencies);
          const authorizingManager = await FulfillmentMetering.open(harness.dependencies);
          const firstResolver = await FulfillmentMetering.open(harness.dependencies);
          const secondResolver = await FulfillmentMetering.open(harness.dependencies);
          const releaseResolver = await FulfillmentMetering.open(harness.dependencies);
          const originalPreparation = authorizingManager.prepareBillableAttempt(billableInput("retired-old-key"));
          await withTimeout(authorizeStarted.promise, "retired attempt authorization");
          const oldAttemptId = (await manager.snapshot()).attempts[0].attemptId;
          const oldResolution1 = firstResolver.reconcileReservation(oldAttemptId);
          await withTimeout(resolverStarted[0].promise, "first stale reservation resolver");
          const oldResolution2 = secondResolver.reconcileReservation(oldAttemptId);
          await withTimeout(resolverStarted[1].promise, "second stale reservation resolver");
          const releaseResolution = releaseResolver.reconcileReservation(oldAttemptId);
          await withTimeout(releaseStarted.promise, "terminal reservation resolver");
          releaseResponse.resolve({ status: terminalStatus });
          assert.equal((await withTimeout(releaseResolution, "released reservation result")).status, "denied");

          const replacement = await manager.prepareBillableAttempt(billableInput("retired-new-key"));
          assert.equal(replacement.status, "ready");
          let raw = JSON.parse(await readFile(resolve(directory, "metering-state.json"), "utf8"));
          const originalRetirement = raw.attempts.find((attempt) => attempt.attemptId === oldAttemptId).reservationRetirement;
          assert.equal(originalRetirement.state, terminalStatus);
          assert.equal(originalRetirement.reservationRequestId, raw.attempts[0].reservationRequestId);
          assert.equal(raw.attempts.find((attempt) => attempt.attemptId === oldAttemptId).phase, "denied");
          assert.equal(raw.attempts.find((attempt) => attempt.attemptId === oldAttemptId).supersededByAttemptId, replacement.attemptId);

          // A replayed prepared event must not rewrite the terminal finance fact
          // or the immutable edge to its replacement.
          const preparedEvent = raw.outbox.find((event) => event.attemptId === oldAttemptId && event.eventType === "billable_attempt_prepared");
          assert.ok(preparedEvent);
          preparedEvent.deliveryState = "pending";
          await writeFile(resolve(directory, "metering-state.json"), JSON.stringify(raw));
          manager = await FulfillmentMetering.open(harness.dependencies);
          assert.equal((await manager.replayPending()).pending, 0);
          raw = JSON.parse(await readFile(resolve(directory, "metering-state.json"), "utf8"));
          const replayedOldAttempt = raw.attempts.find((attempt) => attempt.attemptId === oldAttemptId);
          assert.deepEqual(replayedOldAttempt.reservationRetirement, originalRetirement);
          assert.equal(replayedOldAttempt.supersededByAttemptId, replacement.attemptId);

          if (restart) manager = await FulfillmentMetering.open(harness.dependencies);
          let firstConflict;
          const assertRetired = async () => {
            const state = JSON.parse(await readFile(resolve(directory, "metering-state.json"), "utf8"));
            const stored = state.attempts.find((attempt) => attempt.attemptId === oldAttemptId);
            assert.equal(stored.phase, "denied");
            assert.equal(stored.reservationState, terminalStatus);
            assert.equal(stored.reservationReference, null);
            assert.deepEqual(stored.reservationRetirement, originalRetirement);
            assert.equal(stored.supersededByAttemptId, replacement.attemptId);
            assert.equal(stored.reservationHistoryUncertain, false);
            assert.ok(stored.reservationConflictEvidence);
            assert.equal(stored.reservationConflictEvidence.receivedState, "reserved");
            if (firstConflict === undefined) firstConflict = structuredClone(stored.reservationConflictEvidence);
            else assert.deepEqual(stored.reservationConflictEvidence, firstConflict);
          };
          const staleAuthorization = async () => {
            authorizeResponse.resolve({ authorized: true, reference: "old-released-reservation" });
            const result = await withTimeout(originalPreparation, "late authorization result");
            assert.equal(result.status, "blocked");
            assert.equal(result.reason, "budget_unknown");
            await assertRetired();
          };
          const staleResolver = async (index, operation) => {
            resolverResponses[index].resolve({ status: "reserved", reference: "old-released-reservation" });
            const result = await withTimeout(operation, "late reservation resolver " + (index + 1));
            assert.equal(result.status, "blocked");
            assert.equal(result.reason, "budget_unknown");
            await assertRetired();
          };

          const calls = [];
          const dispatch = async (identity) => {
            calls.push(identity);
            return { outcome: "provider_accepted", providerRequestId: "single-effect-" + calls.length };
          };
          let replacementDispatch;
          if (newerEffect === "before_stale_responses") {
            replacementDispatch = await manager.dispatchPreparedAttempt(replacement.attemptId, dispatch);
            assert.equal(replacementDispatch.status, "effect_recorded");
          }
          const completions = {
            authorize: staleAuthorization,
            resolver1: () => staleResolver(0, oldResolution1),
            resolver2: () => staleResolver(1, oldResolution2)
          };
          const order = responseOrder === "authorize_then_resolvers"
            ? ["authorize", "resolver1", "resolver2"]
            : ["resolver1", "resolver2", "authorize"];
          for (const completion of order) {
            await completions[completion]();
            if (restart) manager = await FulfillmentMetering.open(harness.dependencies);
          }

          const oldDispatch = await manager.dispatchPreparedAttempt(oldAttemptId, dispatch);
          assert.equal(oldDispatch.status, "blocked");
          assert.equal(calls.length, newerEffect === "before_stale_responses" ? 1 : 0);
          if (newerEffect === "after_stale_responses") {
            replacementDispatch = await manager.dispatchPreparedAttempt(replacement.attemptId, dispatch);
            assert.equal(replacementDispatch.status, "blocked");
            assert.equal(replacementDispatch.reason, "logical_operation_blocked");
          }
          assert.equal(calls.length, newerEffect === "before_stale_responses" ? 1 : 0);
          if (calls.length === 1) {
            assert.equal(calls[0].billableAttemptId, replacement.attemptId);
            assert.equal(calls[0].logicalOperationId, "logical-order-1");
          }
          await assertRetired();
          const final = await manager.snapshot();
          assert.equal(final.attempts.find((attempt) => attempt.attemptId === oldAttemptId).phase, "denied");
          assert.equal(final.attempts.find((attempt) => attempt.attemptId === replacement.attemptId).phase,
            newerEffect === "before_stale_responses" ? "provider_accepted" : "ready");
          assert.equal(final.outbox.filter((event) => event.eventType === "billable_attempt_outcome").length,
            newerEffect === "before_stale_responses" ? 1 : 0);
          } finally { await rm(directory, { recursive: true, force: true }); }
        }
      }
    }
  }
});

await test("a late conflict fences a replacement before its reservation can activate", async () => {
  const directory = await newTempDir();
  try {
    const authorizationStarted = deferred();
    const authorizationResponse = deferred();
    const staleResolverStarted = deferred();
    const staleResolverResponse = deferred();
    const releaseResolverStarted = deferred();
    const releaseResolverResponse = deferred();
    const replacementPreparedSink = deferred();
    const releaseReplacementSink = deferred();
    let preparedEvents = 0;
    let resolverCalls = 0;
    const harness = createHarness(directory, {
      budgetBehavior: async (_check, state) => {
        if (state.budgetCalls.length === 1) {
          authorizationStarted.resolve();
          return authorizationResponse.promise;
        }
        return { authorized: true, reference: "replacement-reservation" };
      },
      sinkRecordHook: async (payload) => {
        if (payload.event_type === "billable_attempt_prepared" && ++preparedEvents === 2) {
          replacementPreparedSink.resolve();
          await releaseReplacementSink.promise;
        }
      }
    });
    harness.resolver.status = async () => {
      const index = resolverCalls++;
      if (index === 0) {
        staleResolverStarted.resolve();
        return staleResolverResponse.promise;
      }
      releaseResolverStarted.resolve();
      return releaseResolverResponse.promise;
    };
    const originalManager = await FulfillmentMetering.open(harness.dependencies);
    const authorizationManager = await FulfillmentMetering.open(harness.dependencies);
    const staleResolverManager = await FulfillmentMetering.open(harness.dependencies);
    const releaseResolverManager = await FulfillmentMetering.open(harness.dependencies);
    const originalPreparation = authorizationManager.prepareBillableAttempt(billableInput("activation-fence-old"));
    await withTimeout(authorizationStarted.promise, "old activation-fence authorization");
    const oldAttemptId = (await originalManager.snapshot()).attempts[0].attemptId;
    const staleResolution = staleResolverManager.reconcileReservation(oldAttemptId);
    await withTimeout(staleResolverStarted.promise, "old activation-fence stale resolver");
    const releaseResolution = releaseResolverManager.reconcileReservation(oldAttemptId);
    await withTimeout(releaseResolverStarted.promise, "old activation-fence release resolver");
    releaseResolverResponse.resolve({ status: "released" });
    assert.equal((await withTimeout(releaseResolution, "old activation-fence release result")).status, "denied");

    const preparingManager = await FulfillmentMetering.open(harness.dependencies);
    const replacementPreparation = preparingManager.prepareBillableAttempt(billableInput("activation-fence-new"));
    await withTimeout(replacementPreparedSink.promise, "replacement prepared outbox delivery");
    authorizationResponse.resolve({ authorized: true, reference: "old-reservation" });
    assert.equal((await withTimeout(originalPreparation, "late original authorization")).status, "blocked");
    staleResolverResponse.resolve({ status: "reserved", reference: "old-reservation" });
    assert.equal((await withTimeout(staleResolution, "late original resolver")).status, "blocked");

    const restarted = await FulfillmentMetering.open(harness.dependencies);
    const reopenedState = JSON.parse(await readFile(resolve(directory, "metering-state.json"), "utf8"));
    const oldStored = reopenedState.attempts.find((attempt) => attempt.attemptId === oldAttemptId);
    const replacementStored = reopenedState.attempts.find((attempt) => attempt.clientAttemptKey === "activation-fence-new");
    assert.equal(oldStored.reservationState, "released");
    assert.equal(oldStored.reservationRetirement.state, "released");
    assert.equal(oldStored.supersededByAttemptId, replacementStored.attemptId);
    assert.equal(oldStored.reservationConflictEvidence.receivedState, "reserved");
    releaseReplacementSink.resolve();
    const preparationResult = await withTimeout(replacementPreparation, "replacement activation after conflict");
    assert.equal(preparationResult.status, "blocked");
    assert.equal(preparationResult.reason, "logical_operation_blocked");
    assert.equal(harness.state.budgetCalls.length, 1);
    const effects = [];
    assert.equal((await restarted.dispatchPreparedAttempt(oldAttemptId, async () => {
      effects.push("old");
      return { outcome: "provider_accepted" };
    })).status, "blocked");
    assert.equal((await restarted.dispatchPreparedAttempt(replacementStored.attemptId, async () => {
      effects.push("new");
      return { outcome: "provider_accepted" };
    })).status, "blocked");
    assert.equal(effects.length, 0);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("confirmed release and denial permit one replacement before any conflicting finance response", async () => {
  for (const terminalStatus of ["released", "denied"]) {
    const directory = await newTempDir();
    try {
      const harness = createHarness(directory, {
        budgetBehavior: async (_check, state) => {
          if (state.budgetCalls.length === 1) throw new Error("fixture authorization ambiguity");
          return { authorized: true, reference: "replacement-reservation" };
        }
      });
      const meter = await FulfillmentMetering.open(harness.dependencies);
      const original = await meter.prepareBillableAttempt(billableInput("positive-control-old"));
      assert.equal(original.status, "blocked");
      harness.resolver.status = terminalStatus;
      const resolved = await meter.reconcileReservation(original.attemptId);
      assert.equal(resolved.status, "denied");
      const replacement = await meter.prepareBillableAttempt(billableInput("positive-control-new"));
      assert.equal(replacement.status, "ready");
      const effects = [];
      const dispatched = await meter.dispatchPreparedAttempt(replacement.attemptId, async (identity) => {
        effects.push(identity);
        return { outcome: "provider_accepted", providerRequestId: "positive-control-effect" };
      });
      assert.equal(dispatched.status, "effect_recorded");
      assert.equal(effects.length, 1);
      assert.equal(effects[0].billableAttemptId, replacement.attemptId);
      assert.equal((await meter.dispatchPreparedAttempt(original.attemptId, async () => {
        effects.push("duplicate");
        return { outcome: "provider_accepted" };
      })).status, "blocked");
      assert.equal(effects.length, 1);
      const stored = JSON.parse(await readFile(resolve(directory, "metering-state.json"), "utf8"));
      const retired = stored.attempts.find((attempt) => attempt.attemptId === original.attemptId);
      assert.equal(retired.reservationRetirement.state, terminalStatus);
      assert.equal(retired.reservationConflictEvidence, null);
      assert.equal(retired.supersededByAttemptId, replacement.attemptId);
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

await test("same-key preparation remains terminal across replay waits and release reconciliation", async () => {
  for (const outcome of ["provider_accepted", "not_dispatched", "unknown"]) {
    const directory = await newTempDir();
    try {
      let pauseFirstReplay = false;
      let replayPauseUsed = false;
      const replayEntered = deferred();
      const releaseReplay = deferred();
      const harness = createHarness(directory, {
        budgetBehavior: async (_check, state) => {
          if (state.budgetCalls.length === 1) throw new Error("fixture authorization ambiguity");
          return { authorized: true, reference: `released-retry-${state.budgetCalls.length}` };
        },
        sinkRecordHook: async () => {
          if (pauseFirstReplay && !replayPauseUsed) {
            replayPauseUsed = true;
            replayEntered.resolve();
            await releaseReplay.promise;
          }
        }
      });
      harness.resolver.status = "not_found";
      const meter = await FulfillmentMetering.open(harness.dependencies);
      const initial = await meter.prepareBillableAttempt(billableInput(`terminal-replay-${outcome}`));
      assert.equal(initial.status, "blocked");
      assert.equal(initial.reason, "budget_unknown");
      const attemptId = initial.attemptId;
      const secondManager = await FulfillmentMetering.open(harness.dependencies);
      const original = await meter.snapshot();
      const durablePath = resolve(directory, "metering-state.json");
      const rawState = JSON.parse(await readFile(durablePath, "utf8"));
      const preparedEvent = rawState.outbox.find((event) => event.attemptId === attemptId && event.eventType === "billable_attempt_prepared");
      assert.ok(preparedEvent);
      preparedEvent.deliveryState = "pending";
      await writeFile(durablePath, JSON.stringify(rawState));

      pauseFirstReplay = true;
      const sameKeyPreparation = meter.prepareBillableAttempt(billableInput(`terminal-replay-${outcome}`));
      await waitForSignal(replayEntered, sameKeyPreparation, "same-key preparation replay");
      harness.resolver.status = "reserved";
      const restoredReservation = await secondManager.reconcileReservation(attemptId);
      assert.equal(restoredReservation.status, "ready");
      const beforeOutcome = await secondManager.prepareBillableAttempt(billableInput(`terminal-replay-${outcome}`));
      assert.equal(beforeOutcome.status, "ready");
      let dispatchCount = 0;
      const dispatchResult = await secondManager.dispatchPreparedAttempt(attemptId, async () => {
        dispatchCount += 1;
        if (outcome === "unknown") throw new Error("fixture dispatch timeout");
        return { outcome };
      });
      assert.equal(dispatchResult.status, "effect_recorded");
      assert.equal(dispatchResult.outcome, outcome);
      assert.equal(dispatchCount, 1);
      releaseReplay.resolve();
      const retried = await sameKeyPreparation;
      assert.equal(retried.status, "blocked");
      const restarted = await FulfillmentMetering.open(harness.dependencies);
      const terminal = await restarted.snapshot();
      assert.equal(terminal.attempts[0].phase, outcome);
      assert.equal(terminal.attempts[0].outcome, outcome);
      assert.equal(terminal.attempts[0].attemptId, original.attempts[0].attemptId);
      assert.equal(harness.state.budgetCalls.length, 1);
      assert.equal(harness.state.sinkCalls.filter((payload) => payload.event_type === "billable_attempt_outcome").length, 1);

      if (outcome === "not_dispatched") {
        harness.resolver.status = "released";
        const released = await restarted.reconcileReservation(attemptId);
        assert.equal(released.status, "denied");
        const stillTerminal = await (await FulfillmentMetering.open(harness.dependencies)).snapshot();
        assert.equal(stillTerminal.attempts[0].phase, "not_dispatched");
        const sameKeyAgain = await restarted.prepareBillableAttempt(billableInput(`terminal-replay-${outcome}`));
        assert.equal(sameKeyAgain.status, "blocked");
        const distinct = await restarted.prepareBillableAttempt(billableInput(`terminal-replay-${outcome}-new`, {
          logicalOperationId: "logical-order-1"
        }));
        assert.equal(distinct.status, "ready");
        assert.equal(harness.state.budgetCalls.length, 2);
        assert.equal((await restarted.snapshot()).attempts.filter((attempt) => attempt.phase === "not_dispatched").length, 1);
        let redispatches = 0;
        const oldAttemptRetry = await restarted.dispatchPreparedAttempt(attemptId, async () => {
          redispatches += 1;
          return { outcome: "provider_accepted" };
        });
        assert.equal(oldAttemptRetry.status, "blocked");
        assert.equal(redispatches, 0);
      } else {
        const sameKeyAgain = await restarted.prepareBillableAttempt(billableInput(`terminal-replay-${outcome}`));
        assert.equal(sameKeyAgain.status, "blocked");
        const distinct = await restarted.prepareBillableAttempt(billableInput(`terminal-replay-${outcome}-new`));
        assert.equal(distinct.status, "blocked");
        assert.equal(distinct.reason, "logical_operation_blocked");
        assert.equal(harness.state.budgetCalls.length, 1);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
});

await test("private producer rows cover valid, invalid, duplicate, conflicting and unknown quote plus submit, status, cancel and ambiguity", async () => {
  const directory = await newTempDir();
  try {
    const harness = createHarness(directory);
    const meter = await FulfillmentMetering.open(harness.dependencies);
    const row = (scenario) => privateProducerRows.find((fixture) => fixture.scenario === scenario).input;

    const validQuote = await meter.recordObservation(row("quote-valid"));
    const duplicateQuote = await meter.recordObservation(row("quote-valid"));
    assert.equal(validQuote.status, "recorded");
    assert.equal(duplicateQuote.eventId, validQuote.eventId);
    assert.equal(duplicateQuote.observationId, validQuote.observationId);
    const conflictQuote = await meter.recordObservation({ ...row("quote-valid"), quoteAmount: money("7.2301", "EUR", "provider_confirmed") });
    assert.equal(conflictQuote.status, "blocked");
    assert.equal(conflictQuote.reason, "attempt_conflict");
    const invalidQuote = await meter.recordObservation(row("quote-invalid"));
    assert.equal(invalidQuote.status, "blocked");
    assert.equal(invalidQuote.reason, "invalid_input");
    const unknownQuote = await meter.recordObservation(row("quote-unknown"));
    assert.equal(unknownQuote.status, "recorded");

    const submitPrepared = await meter.prepareBillableAttempt(billableInput("producer-submit-attempt", {
      logicalOperationId: "logical-order-submit-fixture",
      sourceRefs: ["supplier-observation:quote-1", "order-approval:order-1", "bundle:bundle-1"],
      quoteAmount: { amount: { representation: "minor_units", units: "1250", currency: "USD" }, basis: "provider_confirmed" }
    }));
    assert.equal(submitPrepared.status, "ready");
    const statusObserved = await meter.recordObservation(row("status-observation"));
    assert.equal(statusObserved.status, "recorded");

    const cancelPrepared = await meter.prepareBillableAttempt(billableInput("producer-cancel-attempt", {
      operation: "cancel",
      logicalOperationId: "logical-order-cancel-fixture",
      sourceRefs: ["supplier-observation:cancel-request-1", "order-approval:order-1"],
      quoteAmount: { amount: null, basis: "unknown" },
      reservationAmount: money("2.5000", "USD", "estimated")
    }));
    assert.equal(cancelPrepared.status, "ready");
    const cancelOutcome = await meter.dispatchPreparedAttempt(cancelPrepared.attemptId, async () => ({
      outcome: "unknown",
      sourceRefs: ["supplier-observation:cancel-timeout-1"]
    }));
    assert.equal(cancelOutcome.status, "effect_recorded");
    assert.equal(cancelOutcome.outcome, "unknown");
    const ambiguous = await meter.recordObservation(row("ambiguous-outcome"));
    assert.equal(ambiguous.status, "recorded");

    const payloads = harness.state.sinkCalls;
    assert.ok(payloads.some((payload) => payload.operation === "quote" && payload.quote_amount.amount.value === "7.2300"));
    assert.ok(payloads.some((payload) => payload.operation === "quote" && payload.quote_amount.amount === null));
    assert.ok(payloads.some((payload) => payload.operation === "submit" && payload.event_type === "billable_attempt_prepared"));
    assert.ok(payloads.some((payload) => payload.operation === "status" && payload.billable_attempt_id === "billable-attempt-submit-1"));
    const cancelAttempt = payloads.find((payload) => payload.operation === "cancel" && payload.event_type === "billable_attempt_prepared");
    assert.ok(cancelAttempt);
    assert.equal(cancelAttempt.quote_amount.amount, null);
    const cancelReservation = harness.state.budgetCalls.find(({ payload }) => payload.operation === "cancel");
    assert.ok(cancelReservation);
    assert.equal(cancelReservation.payload.requested_amount.amount.value, "2.5000");
    const cancelUnknown = payloads.find((payload) => payload.operation === "cancel" && payload.event_type === "billable_attempt_outcome");
    assert.ok(cancelUnknown);
    assert.equal(cancelUnknown.outcome, "unknown");
    assert.deepEqual(cancelUnknown.charge_amount, unknownMoney());
    const ambiguity = payloads.find((payload) => payload.event_id === ambiguous.eventId);
    assert.ok(ambiguity);
    assert.equal(ambiguity.outcome, "unknown");
    assert.equal(ambiguity.effect, "unknown_effect");
    assert.deepEqual(ambiguity.quote_amount.amount, { representation: "minor_units", units: "1250", currency: "USD" });
    assert.deepEqual(ambiguity.charge_amount, unknownMoney());
    for (const payload of payloads) {
      assert.deepEqual(payload.trusted_scope, scope);
      assert.equal(payload.mode, "simulated");
      assert.equal(payload.billing_mode, "sandbox");
      assert.equal(payload.evidence_mode, "private_fixture");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

await test("runtime rechecks quote expiry and mode after awaited dispatch metering", async () => {
  for (const expiryDelta of [0, 1]) {
    const directory = await newTempDir();
    const dispatchEvent = deferred();
    const releaseSink = deferred();
    try {
      const expiresAt = new Date(baseEpoch + 5_000).toISOString();
      const harness = createRuntimeHarness(directory, {
        sinkRecordHook: async (payload) => {
          if (payload.outcome === "dispatching") {
            dispatchEvent.resolve();
            await releaseSink.promise;
          }
        }
      });
      const command = harness.command(`runtime-expiry-${expiryDelta}`, expiresAt);
      const submission = harness.runtime.submit({ tenantId: scope.tenantId, projectId: scope.projectId, command }, scope);
      await waitForSignal(dispatchEvent, submission, "dispatch observation sink");
      harness.state.now = Date.parse(expiresAt) + expiryDelta;
      releaseSink.resolve();
      await assert.rejects(
        submission,
        (error) => error?.code === "stale_quote" && error?.sideEffectState === "not_dispatched"
      );
      assert.equal(harness.transportCalls, 0);
      assert.equal(harness.budgetCalls, 1);
      const stored = harness.attempts.get(`fixture-provider/${scope.tenantId}/${scope.projectId}/${command.idempotencyKey}`);
      assert.equal(stored.budgetReservationState, "reserved");
      assert.equal(stored.sideEffectState, "not_dispatched");
      for (const retry of [command, harness.command(`runtime-expiry-new-${expiryDelta}`, expiresAt)]) {
        await assert.rejects(
          harness.runtime.submit({ tenantId: scope.tenantId, projectId: scope.projectId, command: retry }, scope),
          (error) => error?.code === "stale_quote"
        );
      }
      assert.equal(harness.transportCalls, 0);
      assert.equal(harness.budgetCalls, 1);
    } finally {
      releaseSink.resolve();
      await rm(directory, { recursive: true, force: true });
    }
  }

  const directory = await newTempDir();
  const dispatchEvent = deferred();
  const releaseSink = deferred();
  try {
    let harness;
    harness = createRuntimeHarness(directory, {
      sinkRecordHook: async (payload) => {
        if (payload.outcome === "dispatching") {
          dispatchEvent.resolve();
          await releaseSink.promise;
        }
      }
    });
    const command = harness.command("runtime-mode-change");
    const submission = harness.runtime.submit({ tenantId: scope.tenantId, projectId: scope.projectId, command }, scope);
    await waitForSignal(dispatchEvent, submission, "mode-change dispatch observation sink");
    harness.transport.mode = "sandbox";
    releaseSink.resolve();
    await assert.rejects(
      submission,
      (error) => error?.code === "mode_mismatch" && error?.sideEffectState === "not_dispatched"
    );
    assert.equal(harness.transportCalls, 0);
    assert.equal(harness.budgetCalls, 1);
    const stored = harness.attempts.get(`fixture-provider/${scope.tenantId}/${scope.projectId}/${command.idempotencyKey}`);
    assert.equal(stored.budgetReservationState, "reserved");
    assert.equal(stored.sideEffectState, "not_dispatched");
    for (const retry of [command, harness.command("runtime-mode-change-new")]) {
      await assert.rejects(
        harness.runtime.submit({ tenantId: scope.tenantId, projectId: scope.projectId, command: retry }, scope),
        (error) => error?.code === "mode_mismatch"
      );
    }
    assert.equal(harness.transportCalls, 0);
    assert.equal(harness.budgetCalls, 1);
  } finally {
    releaseSink.resolve();
    await rm(directory, { recursive: true, force: true });
  }
});

await test("runtime resolver uses the durable outbox before submit transport and records the provider outcome", async () => {
  const directory = await newTempDir();
  try {
    const meterHarness = createHarness(directory);
    const runtimeContracts = {
      binding(shape) {
        return {
          shape,
          ...CONTRACT_OWNERSHIP[shape],
          state: "development_fixture",
          schemaVersion: "1.0.0",
          fixtureDigest: "sha256:private-fixture-only"
        };
      },
      async validateInbound(request) {
        return {
          ok: true,
          value: request.envelope.command,
          receipts: request.requiredShapes.map((shape) => ({
            shape,
            schemaVersion: "1.0.0",
            tenantId: request.trustedScope.tenantId,
            projectId: request.trustedScope.projectId
          }))
        };
      },
      async validateOutbound(request) {
        return {
          ok: true,
          value: request.value,
          receipts: request.requiredShapes.map((shape) => ({
            shape,
            schemaVersion: "1.0.0",
            tenantId: request.trustedScope.tenantId,
            projectId: request.trustedScope.projectId
          }))
        };
      }
    };
    const attempts = new Map();
    const attemptKey = (record) => `${record.providerId}/${record.tenantId}/${record.projectId}/${record.idempotencyKey}`;
    const persistence = {
      async getSubmitAttempt(providerId, trustedScope, key) {
        return attempts.get(`${providerId}/${trustedScope.tenantId}/${trustedScope.projectId}/${key}`);
      },
      async claimSubmitAttempt(record) {
        const key = attemptKey(record);
        const existing = attempts.get(key);
        if (existing !== undefined) return { claimed: false, existing };
        attempts.set(key, record);
        return { claimed: true };
      },
      async saveSubmitAttempt(record) {
        const key = attemptKey(record);
        if (!attempts.has(key)) throw new Error("attempt_missing");
        attempts.set(key, record);
      }
    };
    const now = baseEpoch;
    const clock = { now: () => now };
    let authorizationSequence = 0;
    const operations = Object.fromEntries([
      "discover_capabilities", "quote", "preflight", "submit", "status", "shipment", "cancel"
    ].map((operation) => [operation, {
      supported: true,
      sideEffect: operation === "submit" || operation === "cancel" ? "external" : "none",
      mayCharge: operation === "submit",
      idempotency: operation === "submit" ? "connector_attempt_store" : operation === "cancel" ? "provider_key" : "not_applicable"
    }]));
    const adapter = {
      descriptor: {
        providerId: "fixture-provider",
        apiVersion: "private-fixture-api/1",
        productLimits: {},
        operations,
        supportedModes: ["simulated"]
      },
      async quote() { return { status: "unsupported" }; },
      async preflight() { return { status: "unsupported" }; },
      async validateBeforeSubmit() { return { status: "supported", value: { valid: true, issues: [] } }; },
      async submit(command, context) {
        await context.transport.request({ operation: "submit", method: "POST", path: "/private-fixture/orders", body: command });
        return { status: "supported", value: { providerRequestId: "supplier-request-runtime-1", acceptedAt: "2026-10-10T14:00:00.000Z" } };
      },
      async getStatus() { return { status: "unsupported" }; },
      async observeShipment() { return { status: "unsupported" }; },
      async cancel() { return { status: "unsupported" }; }
    };
    let transportCalls = 0;
    let budgetCalls = 0;
    const budgetClient = {
      async authorize() {
        budgetCalls += 1;
        return { authorized: true, reference: "runtime-reservation-1" };
      }
    };
    const meteringResolver = createRuntimeMeteringResolver({
      ...meterHarness.dependencies,
      contracts: runtimeContracts,
      usageSink: meterHarness.sink,
      budgetClient
    });
    const dependencies = {
      contracts: runtimeContracts,
      transport: {
        mode: "simulated",
        async request() { transportCalls += 1; return { fixture: true }; }
      },
      clock,
      persistence,
      authorizationVerifier: {
        async verifyAndClaim() {
          authorizationSequence += 1;
          return {
            status: "claimed",
            authorizationId: `runtime-auth-${authorizationSequence}`,
            actionId: `runtime-action-${authorizationSequence}`,
            claimReference: `runtime-claim-${authorizationSequence}`
          };
        }
      },
      budgetClient,
      usageSink: meterHarness.sink,
      metering: meteringResolver
    };
    const runtime = new FulfillmentConnectorRuntime(adapter, dependencies);
    const command = {
      productionBundle: { fixture: "bundle" },
      productionBundleDigest: "sha256:fixture-bundle",
      quote: {
        quoteId: "quote-runtime-1",
        currency: "USD",
        totalMinor: 1250,
        expiresAt: "2026-10-10T15:00:00.000Z",
        productionBundleDigest: "sha256:fixture-bundle",
        termsFingerprint: "sha256:fixture-terms"
      },
      authorizationEnvelope: { fixture: "authorization" },
      amountMinor: 1250,
      currency: "USD",
      idempotencyKey: "runtime-idempotency-1",
      requestFingerprint: "sha256:runtime-request"
    };
    meterHarness.sink.fail = true;
    await assert.rejects(
      runtime.submit({ tenantId: scope.tenantId, projectId: scope.projectId, command }, scope),
      (error) => error?.code === "usage_sink_unavailable"
    );
    assert.equal(transportCalls, 0);
    assert.equal(budgetCalls, 0);
    const pendingMeter = await meteringResolver(scope);
    const pendingEvent = (await pendingMeter.snapshot()).outbox[0];
    assert.equal(pendingEvent.deliveryState, "pending");

    meterHarness.sink.fail = false;
    const retryCommand = { ...command, idempotencyKey: "runtime-idempotency-2", requestFingerprint: "sha256:runtime-request-2" };
    const result = await runtime.submit({ tenantId: scope.tenantId, projectId: scope.projectId, command: retryCommand }, scope);
    assert.equal(result.value.providerRequestId, "supplier-request-runtime-1");
    assert.equal(transportCalls, 1);
    assert.equal(budgetCalls, 1);
    const meter = await meteringResolver(scope);
    const snapshot = await meter.snapshot();
    assert.equal(snapshot.attempts.length, 0);
    assert.equal(snapshot.outbox.length, 4);
    assert.ok(snapshot.outbox.every((event) => event.deliveryState === "delivered"));
    const observations = meterHarness.state.sinkCalls;
    assert.equal(observations[0].event_id, pendingEvent.eventId);
    assert.equal(observations[1].event_id, pendingEvent.eventId);
    assert.deepEqual(observations.slice(2).map((event) => event.outcome), ["attempt_prepared", "dispatching", "provider_accepted"]);
    assert.equal(observations[2].logical_operation_id, "runtime-action-2");
    assert.equal(observations[3].transport_attempt_id, observations[4].transport_attempt_id);
    assert.equal(observations[4].provider_request_id, "supplier-request-runtime-1");
    assert.deepEqual(observations[4].charge_amount, unknownMoney());
    assert.ok(observations[3].source_refs.includes("budget-reservation:runtime-reservation-1"));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

const failed = results.filter((result) => result.status === "failed");
process.stdout.write(`${JSON.stringify({ suite: "metering", status: failed.length === 0 ? "passed" : "failed", passed: results.length - failed.length, failed: failed.length, fixtureDigest: privateProducerFixtureDigest, externalProviderCalls: 0, results })}\n`);
if (failed.length > 0) process.exitCode = 1;
