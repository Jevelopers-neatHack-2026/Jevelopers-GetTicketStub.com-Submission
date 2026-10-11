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
  const directory = await newTempDir();
  try {
    await writeFile(resolve(directory, "metering-state.json"), JSON.stringify({
      schemaVersion: "private-connector-metering-state/1",
      revision: 2,
      nextSequence: 1,
      attempts: [{ phase: "dispatching" }],
      outbox: []
    }));
    const meter = await FulfillmentMetering.open(createHarness(directory).dependencies);
    await assert.rejects(() => meter.snapshot());
    const stillCorrupt = JSON.parse(await readFile(resolve(directory, "metering-state.json"), "utf8"));
    assert.equal(stillCorrupt.attempts[0].phase, "dispatching");
  } finally { await rm(directory, { recursive: true, force: true }); }
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
      metering: createRuntimeMeteringResolver({
        ...meterHarness.dependencies,
        contracts: runtimeContracts,
        usageSink: meterHarness.sink,
        budgetClient
      })
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
    const pendingMeter = await FulfillmentMetering.open({ ...meterHarness.dependencies, contracts: runtimeContracts, usageSink: meterHarness.sink, budgetClient });
    const pendingEvent = (await pendingMeter.snapshot()).outbox[0];
    assert.equal(pendingEvent.deliveryState, "pending");

    meterHarness.sink.fail = false;
    const retryCommand = { ...command, idempotencyKey: "runtime-idempotency-2", requestFingerprint: "sha256:runtime-request-2" };
    const result = await runtime.submit({ tenantId: scope.tenantId, projectId: scope.projectId, command: retryCommand }, scope);
    assert.equal(result.value.providerRequestId, "supplier-request-runtime-1");
    assert.equal(transportCalls, 1);
    assert.equal(budgetCalls, 1);
    const meter = await FulfillmentMetering.open({ ...meterHarness.dependencies, contracts: runtimeContracts, usageSink: meterHarness.sink, budgetClient });
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
