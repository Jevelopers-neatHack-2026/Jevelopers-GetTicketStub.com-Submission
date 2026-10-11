import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ConnectorError } from "../dist/index.js";
import {
  createDeterministicSimulator,
  simulatorFixtureDigest
} from "../dist/simulator.js";
import {
  MOCK_AUTHORIZATION,
  MOCK_BUNDLE,
  MOCK_SCOPE,
  MOCK_SPECIFICATION,
  MOCK_START_AT,
  createMockHarness,
  envelope,
  hashFixture,
  makeQuoteCommand,
  makeSubmitCommand
} from "./mock-fixtures.mjs";

const cases = [];

function test(id, run) {
  cases.push({ id, run });
}

async function expectConnectorError(promise, code, sideEffectState) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ConnectorError);
    assert.equal(error.code, code);
    if (sideEffectState !== undefined) assert.equal(error.sideEffectState, sideEffectState);
    return true;
  });
}

async function prepareSubmit(harness, options = {}) {
  const bundle = options.bundle ?? MOCK_BUNDLE;
  const quoteResponse = await harness.runtime.quote(
    envelope(makeQuoteCommand(bundle, options.destination ?? { fixture: "synthetic destination" }, options.quantity ?? 1)),
    MOCK_SCOPE
  );
  return {
    quoteResponse,
    command: makeSubmitCommand(quoteResponse.value, bundle, options.commandOverrides ?? {})
  };
}

function adapterContext(simulator) {
  return { mode: "simulated", transport: simulator.transport, clock: simulator.clock };
}

function cancelCommand(providerRequestId, idempotencyKey = "mock-cancel-key-1") {
  return {
    providerRequestId,
    authorizationEnvelope: MOCK_AUTHORIZATION,
    idempotencyKey,
    requestFingerprint: `cancel-fingerprint-${idempotencyKey}`
  };
}

function permutations(items) {
  if (items.length < 2) return [items.slice()];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [item, ...rest]));
}

function simulatorTransportRequest(operation, method, path, body, idempotencyKey) {
  return { operation, method, path, body, ...(idempotencyKey === undefined ? {} : { idempotencyKey }) };
}

test("all seven runtime operations use deterministic simulated capabilities and results", async () => {
  const harness = createMockHarness();
  const { runtime, simulator, store } = harness;
  const capabilities = await runtime.discoverCapabilities(envelope({ catalogKey: "synthetic-catalog" }), MOCK_SCOPE);
  const quote = await runtime.quote(envelope(makeQuoteCommand()), MOCK_SCOPE);
  const preflight = await runtime.preflight(envelope({ productionBundle: MOCK_BUNDLE, printSpecification: MOCK_SPECIFICATION }), MOCK_SCOPE);
  const command = makeSubmitCommand(quote.value);
  const submitted = await runtime.submit(envelope(command), MOCK_SCOPE);
  const status = await runtime.getStatus(envelope({ providerRequestId: submitted.value.providerRequestId }), MOCK_SCOPE);
  const shipment = await runtime.observeShipment(envelope({ providerRequestId: submitted.value.providerRequestId }), MOCK_SCOPE);
  const cancelled = await runtime.cancel(envelope(cancelCommand(submitted.value.providerRequestId)), MOCK_SCOPE);

  assert.equal(capabilities.value.mode, "simulated");
  assert.equal(capabilities.value.providerId, "development-deterministic-simulator");
  assert.deepEqual(capabilities.value.supportedModes, ["simulated"]);
  assert.equal(quote.value.currency, "USD");
  assert.equal(quote.value.totalMinor, 1_620);
  assert.equal(quote.value.breakdown.reduce((sum, line) => sum + line.amountMinor, 0), quote.value.totalMinor);
  assert.equal(preflight.value.valid, true);
  assert.equal(submitted.value.providerRequestId.startsWith("sim-order-"), true);
  assert.equal(status.value.normalizedState, "accepted");
  assert.equal(shipment.value.providerShipmentId, undefined);
  assert.equal(cancelled.value.outcome, "cancelled");
  assert.deepEqual(simulator.dispatchCounters(), {
    discover_capabilities: 0,
    quote: 1,
    preflight: 1,
    submit: 1,
    status: 1,
    shipment: 1,
    cancel: 1
  });
  assert.equal(store.simulatedReservations.length, 1);
  assert.equal(store.simulatedReservations[0].mode, "simulated");
  assert.equal(store.usageEvents.length, 14);
  assert.ok(store.usageEvents.every((event) => event.mode === "simulated"));
  assert.equal(simulator.snapshot().billingEvidence.length, 1);
  assert.equal(simulator.snapshot().billingEvidence[0].charged, false);
  assert.equal(simulator.snapshot().billingEvidence[0].billingMode, "simulated");
  assert.equal(runtime.audit().contractReadiness.ready, false);
  assert.equal(runtime.audit().liveModeSupported, false);
});

test("pre-dispatch refusal has zero provider dispatch and keeps simulated reservation evidence", async () => {
  const harness = createMockHarness({ faults: [{ operation: "submit", kind: "refuse_before_dispatch" }] });
  const { command } = await prepareSubmit(harness);
  await expectConnectorError(harness.runtime.submit(envelope(command), MOCK_SCOPE), "provider_failure", "not_dispatched");
  assert.equal(harness.simulator.dispatchCounters().submit, 0);
  assert.equal(harness.simulator.orders().length, 0);
  assert.equal(harness.simulator.snapshot().billingEvidence.length, 0);
  assert.equal(harness.store.simulatedReservations.length, 1);
  assert.equal(harness.store.attempts[0].budgetReservationState, "reserved");
  assert.equal(harness.store.attempts[0].sideEffectState, "not_dispatched");
});

test("provider unsupported response and descriptor rejection both avoid dispatch", async () => {
  const faultHarness = createMockHarness({ faults: [{ operation: "quote", kind: "unsupported" }] });
  await expectConnectorError(
    faultHarness.runtime.quote(envelope(makeQuoteCommand()), MOCK_SCOPE),
    "unsupported",
    "not_dispatched"
  );
  assert.equal(faultHarness.simulator.dispatchCounters().quote, 0);

  const descriptorHarness = createMockHarness({ unsupportedOperations: ["cancel"] });
  await expectConnectorError(
    descriptorHarness.runtime.cancel(envelope(cancelCommand("sim-order-does-not-exist")), MOCK_SCOPE),
    "unsupported",
    "not_dispatched"
  );
  assert.equal(descriptorHarness.simulator.dispatchCounters().cancel, 0);
  assert.equal(descriptorHarness.store.authorizationClaims.length, 0);
});

test("fault plans are rejected when discovery has no boundary and every supported matrix entry fires", async () => {
  for (const kind of ["refuse_before_dispatch", "unsupported", "rate_limit", "accepted_then_timeout", "crash_after_acceptance", "malformed_response"]) {
    assert.throws(() => createDeterministicSimulator({
      seed: "invalid-discovery-fault",
      startAt: MOCK_START_AT,
      faults: [{ operation: "discover_capabilities", kind }]
    }), TypeError);
  }
  for (const operation of ["quote", "preflight", "submit", "shipment", "cancel"]) {
    assert.throws(() => createDeterministicSimulator({
      seed: "invalid-unknown-status-fault",
      startAt: MOCK_START_AT,
      faults: [{ operation, kind: "unknown_status" }]
    }), TypeError, `unknown_status is valid only for status, received ${operation}`);
  }

  const operations = ["quote", "preflight", "submit", "status", "shipment", "cancel"];
  const kinds = ["refuse_before_dispatch", "unsupported", "rate_limit", "accepted_then_timeout", "crash_after_acceptance", "malformed_response"];
  for (const operation of operations) {
    for (const kind of kinds) {
      const harness = createMockHarness({ faults: [{ operation, kind }] });
      let providerRequestId;
      let submitCommand;
      if (["submit", "status", "shipment", "cancel"].includes(operation)) {
        const prepared = await prepareSubmit(harness);
        submitCommand = prepared.command;
        if (operation !== "submit") {
          providerRequestId = (await harness.runtime.submit(envelope(submitCommand), MOCK_SCOPE)).value.providerRequestId;
        }
      }
      const call = {
        quote: () => harness.runtime.quote(envelope(makeQuoteCommand()), MOCK_SCOPE),
        preflight: () => harness.runtime.preflight(envelope({ productionBundle: MOCK_BUNDLE, printSpecification: MOCK_SPECIFICATION }), MOCK_SCOPE),
        submit: () => harness.runtime.submit(envelope(submitCommand), MOCK_SCOPE),
        status: () => harness.runtime.getStatus(envelope({ providerRequestId }), MOCK_SCOPE),
        shipment: () => harness.runtime.observeShipment(envelope({ providerRequestId }), MOCK_SCOPE),
        cancel: () => harness.runtime.cancel(envelope(cancelCommand(providerRequestId, `matrix-cancel-${kind}`)), MOCK_SCOPE)
      }[operation];
      await assert.rejects(call(), `${operation}/${kind} must fail at its declared boundary`);
      assert.deepEqual(harness.simulator.snapshot().triggeredFaults, [{ operation, kind }]);
      assert.equal(harness.simulator.snapshot().faults.length, 0);
      const preDispatch = kind === "refuse_before_dispatch" || kind === "unsupported";
      assert.equal(harness.simulator.dispatchCounters()[operation], preDispatch ? 0 : 1);
      assert.ok(harness.simulator.snapshot().billingEvidence.every((record) => record.billingMode === "simulated" && record.charged === false));
    }
  }

  const statusHarness = createMockHarness({ faults: [{ operation: "status", kind: "unknown_status" }] });
  const statusPrepared = await prepareSubmit(statusHarness);
  const submitted = await statusHarness.runtime.submit(envelope(statusPrepared.command), MOCK_SCOPE);
  const observed = await statusHarness.runtime.getStatus(envelope({ providerRequestId: submitted.value.providerRequestId }), MOCK_SCOPE);
  assert.equal(observed.value.normalizedState, "unknown");
  assert.deepEqual(statusHarness.simulator.snapshot().triggeredFaults, [{ operation: "status", kind: "unknown_status" }]);
});

test("authorization and simulated budget denials stop before provider dispatch", async () => {
  const authorizationDenied = createMockHarness({ authorizationAllowed: false });
  const deniedQuote = await authorizationDenied.runtime.quote(envelope(makeQuoteCommand()), MOCK_SCOPE);
  const deniedCommand = makeSubmitCommand(deniedQuote.value);
  await expectConnectorError(
    authorizationDenied.runtime.submit(envelope(deniedCommand), MOCK_SCOPE),
    "stale_authorization",
    "not_dispatched"
  );
  assert.equal(authorizationDenied.simulator.dispatchCounters().submit, 0);
  assert.equal(authorizationDenied.store.simulatedReservations.length, 0);

  const budgetDenied = createMockHarness({ budgetAllowed: false });
  const { command } = await prepareSubmit(budgetDenied);
  await expectConnectorError(budgetDenied.runtime.submit(envelope(command), MOCK_SCOPE), "budget_denied", "not_dispatched");
  assert.equal(budgetDenied.simulator.dispatchCounters().submit, 0);
  assert.equal(budgetDenied.simulator.orders().length, 0);
  assert.equal(budgetDenied.store.simulatedReservations[0].outcome, "denied");
  assert.equal(budgetDenied.store.attempts[0].budgetReservationState, "denied");
});

test("accepted-then-timeout stays ambiguous across serialized restart without a second dispatch", async () => {
  const first = createMockHarness({ faults: [{ operation: "submit", kind: "accepted_then_timeout" }] });
  const { command } = await prepareSubmit(first);
  await expectConnectorError(first.runtime.submit(envelope(command), MOCK_SCOPE), "ambiguous_submission", "possible");
  assert.equal(first.simulator.dispatchCounters().submit, 1);
  assert.equal(first.simulator.orders().length, 1);
  assert.equal(first.simulator.snapshot().billingEvidence[0].charged, false);
  assert.equal(first.store.attempts[0].sideEffectState, "possible");

  const checkpoint = first.snapshot();
  const restarted = createMockHarness({
    simulatorSnapshot: checkpoint.simulator,
    runtimeStore: checkpoint.runtimeStore
  });
  await expectConnectorError(
    restarted.runtime.submit(envelope({ ...command, idempotencyKey: "mock-provider-key-after-restart" }), MOCK_SCOPE),
    "ambiguous_submission",
    "possible"
  );
  assert.equal(restarted.simulator.dispatchCounters().submit, 1);
  assert.equal(restarted.simulator.orders().length, 1);
  assert.equal(restarted.store.simulatedReservations.length, 1);
  assert.equal(restarted.store.attempts.length, 1);
});

test("crash barrier after acceptance restores order, dispatch count, and uncertain attempt", async () => {
  const first = createMockHarness({ faults: [{ operation: "submit", kind: "crash_after_acceptance" }] });
  const { command } = await prepareSubmit(first);
  let crashCheckpoint;
  first.simulator.setCrashBarrierHandler(() => { crashCheckpoint = first.snapshot(); });
  await expectConnectorError(first.runtime.submit(envelope(command), MOCK_SCOPE), "ambiguous_submission", "possible");
  assert.ok(crashCheckpoint, "crash barrier must capture durable state before runtime observes the lost response");
  const durable = crashCheckpoint;
  assert.equal(durable.simulator.orders.length, 1);
  assert.equal(durable.simulator.dispatchCounters.submit, 1);
  assert.equal(durable.runtimeStore.attempts[0].sideEffectState, "unknown");

  const restarted = createMockHarness({ simulatorSnapshot: durable.simulator, runtimeStore: durable.runtimeStore });
  await expectConnectorError(
    restarted.runtime.submit(envelope({ ...command, idempotencyKey: "mock-crash-restart-key" }), MOCK_SCOPE),
    "ambiguous_submission",
    "unknown"
  );
  const reconciled = await restarted.runtime.getStatus(
    envelope({ providerRequestId: durable.simulator.orders[0].providerRequestId }),
    MOCK_SCOPE
  );
  assert.equal(reconciled.value.normalizedState, "accepted");
  assert.equal(restarted.simulator.orders().length, 1);
  assert.equal(restarted.simulator.dispatchCounters().submit, 1);
});

test("unknown provider status remains unknown instead of reporting acceptance", async () => {
  const harness = createMockHarness({ faults: [{ operation: "status", kind: "unknown_status" }] });
  const { command } = await prepareSubmit(harness);
  const submitted = await harness.runtime.submit(envelope(command), MOCK_SCOPE);
  const status = await harness.runtime.getStatus(envelope({ providerRequestId: submitted.value.providerRequestId }), MOCK_SCOPE);
  assert.equal(status.value.normalizedState, "unknown");
  assert.equal(status.value.providerStatus, "Unknown");
  assert.equal(harness.simulator.orders()[0].status, "accepted");
  assert.equal(harness.simulator.dispatchCounters().status, 1);
});

test("rate limit is visible, creates no order, and does not authorize an automatic retry", async () => {
  const harness = createMockHarness({ faults: [{ operation: "submit", kind: "rate_limit" }] });
  const { command } = await prepareSubmit(harness);
  await expectConnectorError(harness.runtime.submit(envelope(command), MOCK_SCOPE), "rate_limit", "possible");
  assert.equal(harness.simulator.dispatchCounters().submit, 1);
  assert.equal(harness.simulator.orders().length, 0);
  assert.equal(harness.store.simulatedReservations.length, 1);
  await expectConnectorError(harness.runtime.submit(envelope(command), MOCK_SCOPE), "ambiguous_submission", "possible");
  assert.equal(harness.simulator.dispatchCounters().submit, 1);
});

test("malformed submit response preserves the accepted order as ambiguous", async () => {
  const harness = createMockHarness({ faults: [{ operation: "submit", kind: "malformed_response" }] });
  const { command } = await prepareSubmit(harness);
  await expectConnectorError(harness.runtime.submit(envelope(command), MOCK_SCOPE), "ambiguous_submission", "possible");
  assert.equal(harness.simulator.dispatchCounters().submit, 1);
  assert.equal(harness.simulator.orders().length, 1);
  assert.equal(harness.store.attempts[0].sideEffectState, "possible");
});

test("provider idempotency handles replay, key conflict, variation, and expiry deterministically", async () => {
  const harness = createMockHarness({ quoteTtlMs: 10_000, idempotencyTtlMs: 100 });
  const { quoteResponse, command } = await prepareSubmit(harness);
  const context = adapterContext(harness.simulator);
  const preSubmitContext = { mode: "simulated", clock: harness.simulator.clock, trustedScope: MOCK_SCOPE };
  assert.equal((await harness.simulator.adapter.validateBeforeSubmit(command, preSubmitContext)).value.valid, true);
  const first = await harness.simulator.adapter.submit(command, context);
  const duplicate = await harness.simulator.adapter.submit(command, context);
  assert.equal(first.value.providerRequestId, duplicate.value.providerRequestId);
  assert.equal(harness.simulator.orders().length, 1);
  assert.equal(harness.simulator.snapshot().duplicateSubmissions, 1);

  await assert.rejects(harness.simulator.adapter.submit({
    ...command,
    requestFingerprint: "different-fingerprint-same-provider-key"
  }, context));
  assert.equal(harness.simulator.orders().length, 1);

  const changedKey = await harness.simulator.adapter.submit({
    ...command,
    idempotencyKey: "provider-key-variation-b",
    requestFingerprint: "request-fingerprint-variation-b"
  }, context);
  assert.notEqual(changedKey.value.providerRequestId, first.value.providerRequestId);
  assert.equal(harness.simulator.orders().length, 2);

  harness.simulator.advanceTime(101);
  const expiredKey = await harness.simulator.adapter.submit({
    ...command,
    requestFingerprint: "request-fingerprint-after-expiry"
  }, context);
  assert.notEqual(expiredKey.value.providerRequestId, first.value.providerRequestId);
  assert.equal(harness.simulator.orders().length, 3);
  assert.equal(harness.simulator.dispatchCounters().submit, 5);
  assert.equal(quoteResponse.value.expiresAt, command.quote.expiresAt);
});

test("active provider key replays after quote expiry across JSON restart without new acceptance", async () => {
  const harness = createMockHarness({ quoteTtlMs: 10, idempotencyTtlMs: 100 });
  const { command } = await prepareSubmit(harness);
  const first = await harness.simulator.adapter.submit(command, adapterContext(harness.simulator));
  harness.simulator.advanceTime(10);
  const atQuoteExpiry = await harness.simulator.adapter.submit(command, adapterContext(harness.simulator));
  assert.deepEqual(atQuoteExpiry.value, first.value);

  const restored = createDeterministicSimulator({ snapshot: JSON.parse(JSON.stringify(harness.simulator.snapshot())) });
  const atEqualityAfterRestart = await restored.adapter.submit(command, adapterContext(restored));
  assert.deepEqual(atEqualityAfterRestart.value, first.value);
  restored.advanceTime(40);
  const beyondQuoteExpiry = await restored.adapter.submit(command, adapterContext(restored));
  assert.deepEqual(beyondQuoteExpiry.value, first.value);
  await assert.rejects(
    restored.adapter.submit({ ...command, amountMinor: command.amountMinor + 1 }, adapterContext(restored)),
    (error) => error.code === "IDEMPOTENCY_CONFLICT"
  );
  await assert.rejects(
    restored.adapter.submit({ ...command, quote: { ...command.quote, expiresAt: "2026-10-10T14:00:00.011Z" } }, adapterContext(restored)),
    (error) => error.code === "IDEMPOTENCY_CONFLICT"
  );
  await assert.rejects(
    restored.adapter.submit({ ...command, idempotencyKey: "fresh-key-after-stale-quote" }, adapterContext(restored)),
    (error) => error.code === "STALE_QUOTE"
  );
  assert.equal(restored.orders().length, 1);
  assert.equal(restored.snapshot().billingEvidence.length, 1);
  assert.equal(restored.snapshot().billingEvidence[0].charged, false);

  restored.advanceTime(50);
  await assert.rejects(restored.adapter.submit(command, adapterContext(restored)), (error) => error.code === "STALE_QUOTE");
  assert.equal(restored.orders().length, 1);
  assert.equal(restored.snapshot().billingEvidence.length, 1);
});

test("accepted-then-timeout key resolves from restored provider state after quote expiry", async () => {
  const firstHarness = createMockHarness({
    quoteTtlMs: 10,
    idempotencyTtlMs: 100,
    faults: [{ operation: "submit", kind: "accepted_then_timeout" }]
  });
  const { command } = await prepareSubmit(firstHarness);
  await expectConnectorError(firstHarness.runtime.submit(envelope(command), MOCK_SCOPE), "ambiguous_submission", "possible");
  assert.equal(firstHarness.simulator.orders().length, 1);
  assert.equal(firstHarness.simulator.snapshot().billingEvidence.length, 1);
  const restored = createDeterministicSimulator({ snapshot: JSON.parse(JSON.stringify(firstHarness.simulator.snapshot())) });
  restored.advanceTime(20);
  const replay = await restored.adapter.submit(command, adapterContext(restored));
  assert.equal(replay.value.providerRequestId, firstHarness.simulator.orders()[0].providerRequestId);
  assert.equal(replay.value.acceptedAt, firstHarness.simulator.orders()[0].acceptedAt);
  assert.equal(restored.orders().length, 1);
  assert.equal(restored.snapshot().billingEvidence.length, 1);
  assert.equal(restored.snapshot().billingEvidence[0].charged, false);
});

test("runtime authorization action claim prevents a second order with a distinct idempotency key", async () => {
  const harness = createMockHarness();
  const { command } = await prepareSubmit(harness);
  const first = await harness.runtime.submit(envelope(command), MOCK_SCOPE);
  await expectConnectorError(
    harness.runtime.submit(envelope({ ...command, idempotencyKey: "distinct-key-same-authorized-action" }), MOCK_SCOPE),
    "duplicate_submission",
    "confirmed"
  );
  assert.equal(harness.simulator.dispatchCounters().submit, 1);
  assert.equal(harness.simulator.orders().length, 1);
  assert.equal(harness.store.simulatedReservations.length, 1);
  assert.ok(first.value.providerRequestId.startsWith("sim-order-"));
});

test("cancel idempotency returns the same terminal observation on replay", async () => {
  const harness = createMockHarness();
  const { command } = await prepareSubmit(harness);
  const submitted = await harness.runtime.submit(envelope(command), MOCK_SCOPE);
  const cancel = cancelCommand(submitted.value.providerRequestId, "same-cancel-key");
  const first = await harness.runtime.cancel(envelope(cancel), MOCK_SCOPE);
  harness.simulator.advanceTime(1_000);
  const replay = await harness.runtime.cancel(envelope(cancel), MOCK_SCOPE);
  assert.deepEqual(replay.value, first.value);
  assert.equal(harness.simulator.orders().length, 1);
  assert.equal(harness.simulator.snapshot().cancelIdempotency.length, 1);
  assert.equal(harness.simulator.dispatchCounters().cancel, 2);
});

test("first transport cancellation result, adapter result, and runtime result cannot mutate persisted replay state", async () => {
  const harness = createMockHarness();
  const { command } = await prepareSubmit(harness);
  const submitted = await harness.runtime.submit(envelope(command), MOCK_SCOPE);
  const providerRequestId = submitted.value.providerRequestId;
  const rawRequest = simulatorTransportRequest(
    "cancel", "POST", "/simulator/orders/cancel",
    { providerRequestId, requestFingerprint: "transport-cancel-fingerprint" },
    "transport-cancel-key"
  );
  const expectedRaw = await harness.simulator.transport.request(rawRequest);
  const firstRaw = await harness.simulator.transport.request(rawRequest);
  firstRaw.providerRequestId = "sim-order-mutated";
  firstRaw.outcome = "not_found";
  firstRaw.observedAt = "2000-01-01T00:00:00.000Z";
  assert.deepEqual(harness.simulator.snapshot().cancelIdempotency[0].result, expectedRaw);
  assert.deepEqual(await harness.simulator.transport.request(rawRequest), expectedRaw);
  const restart = createDeterministicSimulator({ snapshot: JSON.parse(JSON.stringify(harness.simulator.snapshot())) });
  assert.deepEqual(await restart.transport.request(rawRequest), expectedRaw);
  assert.deepEqual(restart.snapshot().cancelIdempotency[0].result, expectedRaw);

  const adapterCommand = cancelCommand(providerRequestId, "adapter-cancel-key");
  const adapterFirst = await harness.simulator.adapter.cancel(adapterCommand, adapterContext(harness.simulator));
  assert.equal(adapterFirst.status, "supported");
  const expectedAdapter = { ...adapterFirst.value };
  adapterFirst.value.providerRequestId = "sim-order-adapter-mutated";
  adapterFirst.value.outcome = "not_found";
  const adapterReplay = await harness.simulator.adapter.cancel(adapterCommand, adapterContext(harness.simulator));
  assert.equal(adapterReplay.status, "supported");
  assert.deepEqual(adapterReplay.value, expectedAdapter);

  const runtimeCommand = cancelCommand(providerRequestId, "runtime-cancel-key");
  const runtimeFirst = await harness.runtime.cancel(envelope(runtimeCommand), MOCK_SCOPE);
  const expectedRuntime = { ...runtimeFirst.value };
  runtimeFirst.value.providerRequestId = "sim-order-runtime-mutated";
  runtimeFirst.value.outcome = "not_found";
  const runtimeReplay = await harness.runtime.cancel(envelope(runtimeCommand), MOCK_SCOPE);
  assert.deepEqual(runtimeReplay.value, expectedRuntime);

  const statusCommand = { providerRequestId };
  const statusFirst = await harness.simulator.adapter.getStatus(statusCommand, adapterContext(harness.simulator));
  assert.equal(statusFirst.status, "supported");
  statusFirst.value.normalizedState = "failed";
  const statusReplay = await harness.simulator.adapter.getStatus(statusCommand, adapterContext(harness.simulator));
  assert.equal(statusReplay.status, "supported");
  assert.equal(statusReplay.value.normalizedState, "cancelled");
  assert.equal(harness.simulator.orders()[0].status, "cancelled");
  assert.equal(harness.simulator.snapshot().billingEvidence.length, 1);
  assert.equal(harness.simulator.orders().length, 1);
});

test("concurrent same-key and distinct-key attempts allow only one synthetic order", async () => {
  for (const keys of [
    ["concurrent-same-key", "concurrent-same-key"],
    ["concurrent-key-a", "concurrent-key-b"]
  ]) {
    const harness = createMockHarness();
    const { command } = await prepareSubmit(harness);
    const results = await Promise.allSettled(keys.map((idempotencyKey) =>
      harness.runtime.submit(envelope({ ...command, idempotencyKey }), MOCK_SCOPE)
    ));
    assert.equal(results.filter((entry) => entry.status === "fulfilled").length, 1);
    assert.equal(results.filter((entry) => entry.status === "rejected").length, 1);
    assert.equal(harness.simulator.dispatchCounters().submit, 1);
    assert.equal(harness.simulator.orders().length, 1);
    assert.equal(harness.store.simulatedReservations.length, 1);
  }
});

test("delayed, duplicate, out-of-order callbacks keep status monotonic and split shipments deduplicated", async () => {
  const harness = createMockHarness();
  const { command } = await prepareSubmit(harness);
  const submitted = await harness.runtime.submit(envelope(command), MOCK_SCOPE);
  const requestId = submitted.value.providerRequestId;
  const delayedProduction = harness.simulator.queueStatusCallback({
    providerRequestId: requestId,
    status: "in_production",
    occurredAt: "2026-10-10T14:00:01.000Z",
    delayMs: 500
  });
  const shipped = harness.simulator.queueStatusCallback({
    providerRequestId: requestId,
    status: "shipped",
    occurredAt: "2026-10-10T14:00:02.000Z"
  });
  const packageOne = harness.simulator.queueShipmentCallback({
    providerRequestId: requestId,
    shipment: { trackingNumber: "SIM-TRACK-001", carrier: "Synthetic Carrier", occurredAt: "2026-10-10T14:00:02.000Z" }
  });
  const packageTwo = harness.simulator.queueShipmentCallback({
    providerRequestId: requestId,
    shipment: { trackingNumber: "SIM-TRACK-002", carrier: "Synthetic Carrier", occurredAt: "2026-10-10T14:00:03.000Z" }
  });
  const delivered = harness.simulator.queueStatusCallback({
    providerRequestId: requestId,
    status: "delivered",
    occurredAt: "2026-10-10T14:00:05.000Z"
  });
  const lateCancellation = harness.simulator.queueStatusCallback({
    providerRequestId: requestId,
    status: "cancelled",
    occurredAt: "2026-10-10T14:00:06.000Z"
  });

  assert.equal(harness.simulator.deliverCallback(delayedProduction).outcome, "delayed");
  assert.equal(harness.simulator.deliverCallback(shipped).outcome, "delivered");
  assert.equal(harness.simulator.deliverCallback(packageOne).outcome, "delivered");
  assert.equal(harness.simulator.deliverCallback(packageTwo).outcome, "delivered");
  assert.equal(harness.simulator.deliverCallback(packageOne).outcome, "duplicate");
  harness.simulator.advanceTime(500);
  assert.equal(harness.simulator.deliverCallback(delayedProduction).outcome, "delivered");
  assert.equal(harness.simulator.deliverCallback(delivered).outcome, "delivered");
  assert.equal(harness.simulator.deliverCallback(lateCancellation).outcome, "delivered");

  const status = await harness.runtime.getStatus(envelope({ providerRequestId: requestId }), MOCK_SCOPE);
  const shipment = await harness.runtime.observeShipment(envelope({ providerRequestId: requestId }), MOCK_SCOPE);
  assert.equal(status.value.normalizedState, "delivered");
  assert.equal(shipment.value.providerShipmentId !== undefined, true);
  assert.equal(harness.simulator.shipments(requestId).length, 2);
  assert.equal(harness.simulator.snapshot().duplicateCallbacks, 1);
  assert.equal(harness.simulator.dispatchCounters().submit, 1);
});

test("terminal conflicts, repeated statuses, timestamps, and split shipments converge across all permutations and restart", async () => {
  const harness = createMockHarness();
  const { command } = await prepareSubmit(harness);
  const submitted = await harness.runtime.submit(envelope(command), MOCK_SCOPE);
  const requestId = submitted.value.providerRequestId;
  const queued = [
    harness.simulator.queueStatusCallback({ providerRequestId: requestId, status: "cancelled", occurredAt: "2026-10-10T14:00:01.000Z" }),
    harness.simulator.queueStatusCallback({ providerRequestId: requestId, status: "failed", occurredAt: "2026-10-10T14:00:02.000Z" }),
    harness.simulator.queueStatusCallback({ providerRequestId: requestId, status: "cancelled", occurredAt: "2026-10-10T14:00:02.000Z" }),
    harness.simulator.queueStatusCallback({ providerRequestId: requestId, status: "failed", occurredAt: "2026-10-10T14:00:03.000Z" }),
    harness.simulator.queueStatusCallback({ providerRequestId: requestId, status: "delivered", occurredAt: "2026-10-10T14:00:00.000Z" }),
    harness.simulator.queueShipmentCallback({
      providerRequestId: requestId,
      shipment: { providerShipmentId: "sim-package-a", trackingNumber: "SIM-PACKAGE-A", carrier: "Synthetic", occurredAt: "2026-10-10T14:00:04.000Z" }
    }),
    harness.simulator.queueShipmentCallback({
      providerRequestId: requestId,
      shipment: { providerShipmentId: "sim-package-b", trackingNumber: "SIM-PACKAGE-B", carrier: "Synthetic", occurredAt: "2026-10-10T14:00:05.000Z" }
    })
  ];
  const shipmentReplayId = queued[5];
  const queuedSnapshot = JSON.parse(JSON.stringify(harness.simulator.snapshot()));
  let runs = 0;

  for (const deliveryOrder of permutations(queued)) {
    let simulator = createDeterministicSimulator({ snapshot: queuedSnapshot });
    const restartAfter = Math.floor(deliveryOrder.length / 2);
    for (let index = 0; index < deliveryOrder.length; index += 1) {
      if (index === restartAfter) simulator = createDeterministicSimulator({ snapshot: JSON.parse(JSON.stringify(simulator.snapshot())) });
      assert.equal(simulator.deliverCallback(deliveryOrder[index]).outcome, "delivered");
    }
    assert.equal(simulator.deliverCallback(shipmentReplayId).outcome, "duplicate");
    assert.deepEqual(simulator.orders()[0], {
      ...simulator.orders()[0],
      status: "delivered",
      statusOccurredAt: "2026-10-10T14:00:05.000Z",
      shipments: [
        { providerShipmentId: "sim-package-a", trackingNumber: "SIM-PACKAGE-A", carrier: "Synthetic", occurredAt: "2026-10-10T14:00:04.000Z" },
        { providerShipmentId: "sim-package-b", trackingNumber: "SIM-PACKAGE-B", carrier: "Synthetic", occurredAt: "2026-10-10T14:00:05.000Z" }
      ]
    });
    assert.equal(simulator.orders().length, 1);
    assert.equal(simulator.snapshot().billingEvidence.length, 1);
    assert.equal(simulator.snapshot().dispatchCounters.submit, 1);
    assert.equal(simulator.snapshot().duplicateCallbacks, 1);
    runs += 1;
  }
  assert.equal(runs, 5_040);
});

test("conflicting data cannot reuse a synthetic shipment identity", async () => {
  const harness = createMockHarness();
  const { command } = await prepareSubmit(harness);
  const submitted = await harness.runtime.submit(envelope(command), MOCK_SCOPE);
  const providerRequestId = submitted.value.providerRequestId;
  harness.simulator.queueShipmentCallback({
    providerRequestId,
    shipment: { providerShipmentId: "sim-package-conflict", trackingNumber: "SIM-FIRST", carrier: "Synthetic", occurredAt: "2026-10-10T14:00:01.000Z" }
  });
  assert.throws(() => harness.simulator.queueShipmentCallback({
    providerRequestId,
    shipment: { providerShipmentId: "sim-package-conflict", trackingNumber: "SIM-SECOND", carrier: "Synthetic", occurredAt: "2026-10-10T14:00:02.000Z" }
  }), /cannot be reused with different details/);
});

test("quote destination and authorization data are omitted from provider state and usage evidence", async () => {
  const privateAddress = "44 Fictional Avenue, Synthetic City";
  const harness = createMockHarness();
  const { command } = await prepareSubmit(harness, { destination: { address: privateAddress } });
  await harness.runtime.submit(envelope(command), MOCK_SCOPE);
  const stateText = JSON.stringify(harness.simulator.snapshot());
  const usageText = JSON.stringify(harness.store.usageEvents);
  assert.equal(stateText.includes(privateAddress), false);
  assert.equal(usageText.includes(privateAddress), false);
  assert.equal(stateText.includes("authorizationEnvelope"), false);
  assert.equal(usageText.includes("authorizationEnvelope"), false);
});

test("serialized simulator snapshot resumes fixed time, identities, callback state, and counters", async () => {
  const first = createMockHarness();
  const { command } = await prepareSubmit(first);
  const submitted = await first.runtime.submit(envelope(command), MOCK_SCOPE);
  const originalCounters = first.simulator.dispatchCounters();
  const snapshot = JSON.parse(JSON.stringify(first.simulator.snapshot()));
  const restored = createDeterministicSimulator({ snapshot });
  assert.equal(restored.now(), Date.parse(MOCK_START_AT));
  assert.deepEqual(restored.dispatchCounters(), originalCounters);
  assert.equal(restored.orders()[0].providerRequestId, submitted.value.providerRequestId);
  const status = await restored.adapter.getStatus(
    { providerRequestId: submitted.value.providerRequestId },
    adapterContext(restored)
  );
  assert.equal(status.value.normalizedState, "accepted");
  assert.equal(restored.dispatchCounters().status, 1);
});

test("versioned snapshot validation rejects malformed nested state before any provider dispatch", async () => {
  const harness = createMockHarness({
    faults: [
      { operation: "status", kind: "unknown_status" },
      { operation: "shipment", kind: "rate_limit" }
    ]
  });
  const { command } = await prepareSubmit(harness);
  const submitted = await harness.runtime.submit(envelope(command), MOCK_SCOPE);
  const providerRequestId = submitted.value.providerRequestId;
  const observed = await harness.runtime.getStatus(envelope({ providerRequestId }), MOCK_SCOPE);
  assert.equal(observed.value.normalizedState, "unknown");
  await harness.simulator.adapter.cancel(cancelCommand(providerRequestId, "snapshot-cancel-key"), adapterContext(harness.simulator));
  harness.simulator.queueStatusCallback({
    providerRequestId,
    status: "delivered",
    occurredAt: "2026-10-10T14:00:04.000Z",
    delayMs: 100
  });
  const shipmentEvent = harness.simulator.queueShipmentCallback({
    providerRequestId,
    shipment: { providerShipmentId: "sim-snapshot-package", trackingNumber: "SIM-SNAPSHOT-PACKAGE", carrier: "Synthetic", occurredAt: "2026-10-10T14:00:03.000Z" }
  });
  assert.equal(harness.simulator.deliverCallback(shipmentEvent).outcome, "delivered");

  const snapshot = JSON.parse(JSON.stringify(harness.simulator.snapshot()));
  const restored = createDeterministicSimulator({ snapshot });
  assert.deepEqual(restored.snapshot(), snapshot);
  const replay = await restored.adapter.submit(command, adapterContext(restored));
  assert.equal(replay.value.providerRequestId, providerRequestId);
  assert.equal(restored.orders().length, 1);
  assert.equal(restored.snapshot().billingEvidence.length, 1);
  assert.equal(restored.snapshot().billingEvidence[0].charged, false);
  restored.advanceTime(100);
  const pendingStatus = snapshot.callbacks.find((callback) => callback.kind === "status");
  assert.ok(pendingStatus);
  assert.equal(restored.deliverCallback(pendingStatus.eventId).outcome, "delivered");
  assert.equal(restored.orders()[0].status, "delivered");
  assert.equal(restored.shipments(providerRequestId).length, 1);
  assert.doesNotThrow(() => createDeterministicSimulator({ snapshot: JSON.parse(JSON.stringify(restored.snapshot())) }));

  const corruptions = [
    ["format version", (state) => { state.format = "fc-mock-development/999"; }],
    ["unknown top-level field", (state) => { state.extra = true; }],
    ["duplicate unsupported operation", (state) => { state.unsupportedOperations = ["cancel", "cancel"]; }],
    ["quote null expiry", (state) => { state.quotes[0].expiresAt = null; }],
    ["quote NaN amount serialized as null", (state) => { state.quotes[0].totalMinor = Number.NaN; }],
    ["duplicate quote identity", (state) => { state.quotes.push({ ...state.quotes[0] }); }],
    ["quote identity does not bind to seed and terms", (state) => { state.quotes[0].providerQuoteId = "sim-quote-00000000000000000000"; }],
    ["dangling order quote reference", (state) => { state.orders[0].quoteId = "sim-quote-absent"; }],
    ["unknown order status", (state) => { state.orders[0].status = "returned"; }],
    ["nonsynthetic order identity", (state) => { state.orders[0].providerRequestId = "real-provider-order-123"; }],
    ["order null amount", (state) => { state.orders[0].amountMinor = null; }],
    ["malformed order timestamp", (state) => { state.orders[0].statusOccurredAt = "not-a-date"; }],
    ["duplicate order identity", (state) => { state.orders.push({ ...state.orders[0], shipments: state.orders[0].shipments.map((shipment) => ({ ...shipment })) }); }],
    ["nonsynthetic shipment identity", (state) => { state.orders[0].shipments[0].providerShipmentId = "real-carrier-shipment"; }],
    ["shipment tracking identifier is not a fixture identifier", (state) => { state.orders[0].shipments[0].trackingNumber = "9400111899223856923456"; }],
    ["unknown nested order field", (state) => { state.orders[0].supplierResponse = "live"; }],
    ["null active key expiry", (state) => { state.idempotency[0].expiresAt = null; }],
    ["dangling idempotency order reference", (state) => { state.idempotency[0].providerRequestId = "sim-order-00000000000000000000"; }],
    ["duplicate idempotency key", (state) => { state.idempotency.push({ ...state.idempotency[0] }); }],
    ["cancel result has unsupported outcome", (state) => { state.cancelIdempotency[0].result.outcome = "charged"; }],
    ["cancel result has dangling order reference", (state) => { state.cancelIdempotency[0].result.providerRequestId = "sim-order-absent"; }],
    ["duplicate cancellation idempotency key", (state) => { state.cancelIdempotency.push({ ...state.cancelIdempotency[0], result: { ...state.cancelIdempotency[0].result } }); }],
    ["callback has unknown status", (state) => { state.callbacks[0].status = "unknown"; }],
    ["status callback event identity binds its timestamp", (state) => { state.callbacks[0].occurredAt = "2026-10-10T14:00:09.000Z"; }],
    ["callback has dangling order reference", (state) => { state.callbacks[0].providerRequestId = "sim-order-absent"; }],
    ["callback has a non-finite availability time", (state) => { state.callbacks[0].availableAt = Number.NaN; }],
    ["callback shipment is malformed", (state) => { state.callbacks[1].shipment.providerShipmentId = "real-tracking-id"; }],
    ["callback identity is duplicated", (state) => { state.callbacks[1].eventId = state.callbacks[0].eventId; }],
    ["fault kind is unrecognized", (state) => { state.faults[0].kind = "live_charge"; }],
    ["unreachable discovery fault is rejected", (state) => { state.faults.push({ operation: "discover_capabilities", kind: "unsupported" }); }],
    ["unknown-status fault is restricted to status", (state) => { state.faults.push({ operation: "quote", kind: "unknown_status" }); }],
    ["triggered fault kind is unrecognized", (state) => { state.triggeredFaults[0].kind = "live_charge"; }],
    ["billing mode must remain simulated", (state) => { state.billingEvidence[0].billingMode = "live"; }],
    ["simulator never records a charge", (state) => { state.billingEvidence[0].charged = true; }],
    ["billing evidence has dangling order reference", (state) => { state.billingEvidence[0].providerRequestId = "sim-order-absent"; }],
    ["billing amount must be a finite minor-unit integer", (state) => { state.billingEvidence[0].amountMinor = null; }],
    ["duplicate billing evidence", (state) => { state.billingEvidence.push({ ...state.billingEvidence[0] }); }],
    ["missing accepted-order evidence", (state) => { state.billingEvidence = []; }],
    ["counter key is required", (state) => { delete state.dispatchCounters.cancel; }],
    ["counter must be a safe integer", (state) => { state.dispatchCounters.submit = 1.5; }],
    ["counter object rejects extra fields", (state) => { state.dispatchCounters.live = 1; }],
    ["duplicate callback counter must be a safe integer", (state) => { state.duplicateCallbacks = Number.NaN; }]
  ];
  let dispatchesAfterRestore = 0;
  function restoreThenProbe(snapshotToRestore) {
    const candidate = createDeterministicSimulator({ snapshot: snapshotToRestore });
    dispatchesAfterRestore += 1;
    return candidate.transport.request(simulatorTransportRequest("discover_capabilities", "GET", "/simulator/capabilities", {}));
  }
  for (const [name, corrupt] of corruptions) {
    const candidate = JSON.parse(JSON.stringify(snapshot));
    corrupt(candidate);
    assert.throws(() => restoreThenProbe(candidate), TypeError, name);
    assert.equal(dispatchesAfterRestore, 0, `${name} must fail before a restored simulator can dispatch`);
  }
});

test("fixed seed and clock reproduce normalized results and state hashes", async () => {
  async function scenario() {
    const harness = createMockHarness({ seed: "repeatable-seed-17", startAt: MOCK_START_AT });
    const capability = await harness.runtime.discoverCapabilities(envelope({}), MOCK_SCOPE);
    const quote = await harness.runtime.quote(envelope(makeQuoteCommand()), MOCK_SCOPE);
    await harness.runtime.preflight(envelope({ productionBundle: MOCK_BUNDLE, printSpecification: MOCK_SPECIFICATION }), MOCK_SCOPE);
    const submitted = await harness.runtime.submit(envelope(makeSubmitCommand(quote.value)), MOCK_SCOPE);
    const status = await harness.runtime.getStatus(envelope({ providerRequestId: submitted.value.providerRequestId }), MOCK_SCOPE);
    const cancel = await harness.runtime.cancel(envelope(cancelCommand(submitted.value.providerRequestId)), MOCK_SCOPE);
    const normalized = {
      capabilities: capability.value,
      quote: quote.value,
      submit: submitted.value,
      status: status.value,
      cancel: cancel.value,
      simulator: harness.simulator.snapshot()
    };
    return hashFixture(normalized);
  }
  assert.equal(await scenario(), await scenario());
});

test("simulator requires only synthetic seed and clock, with no network or credential access", async () => {
  const source = await readFile(new URL("../src/simulator.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']node:(?:http|https|net|tls|dns)["']/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /process\.env/);
  const simulator = createDeterministicSimulator({ seed: "credential-free-synthetic-seed", startAt: MOCK_START_AT });
  assert.deepEqual(simulator.descriptor.supportedModes, ["simulated"]);
  assert.deepEqual(Object.keys(simulator.dispatchCounters()).sort(), ["cancel", "discover_capabilities", "preflight", "quote", "shipment", "status", "submit"]);
  assert.equal(simulatorFixtureDigest({ "a:b": 1, c: 2 }), simulatorFixtureDigest({ c: 2, "a:b": 1 }));
});

test("expired quote refuses before the simulator accepts an order", async () => {
  const harness = createMockHarness({ quoteTtlMs: 10 });
  const { command } = await prepareSubmit(harness);
  harness.simulator.advanceTime(10);
  await expectConnectorError(harness.runtime.submit(envelope(command), MOCK_SCOPE), "stale_quote", "not_dispatched");
  assert.equal(harness.simulator.dispatchCounters().submit, 0);
  assert.equal(harness.simulator.orders().length, 0);
  assert.equal(harness.store.simulatedReservations.length, 0);
});

test("fixture outputs and status observations do not claim sandbox or live evidence", async () => {
  const harness = createMockHarness();
  const { command } = await prepareSubmit(harness);
  const submitted = await harness.runtime.submit(envelope(command), MOCK_SCOPE);
  const result = {
    mode: harness.runtime.mode,
    status: (await harness.runtime.getStatus(envelope({ providerRequestId: submitted.value.providerRequestId }), MOCK_SCOPE)).value,
    billingMode: harness.simulator.snapshot().billingMode
  };
  assert.equal(result.mode, "simulated");
  assert.equal(result.billingMode, "simulated");
  assert.equal(harness.runtime.audit().sandboxReady, false);
  assert.equal(harness.runtime.audit().liveModeSupported, false);
  assert.equal(simulatorFixtureDigest({ fixture: "local" }).startsWith("sha256:"), true);
});

export async function runMockSuite() {
  const results = [];
  const savedFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network is disabled for the simulator fixture suite");
  };
  try {
    for (const entry of cases) {
      try {
        await entry.run();
        results.push({ id: entry.id, status: "passed" });
      } catch (error) {
        results.push({ id: entry.id, status: "failed", message: error instanceof Error ? error.message : "fixture failed" });
      }
    }
    results.push({
      id: "network-denial-guard-no-fetch",
      status: fetchCalls === 0 ? "passed" : "failed",
      ...(fetchCalls === 0 ? {} : { message: "simulator attempted to use the guarded fetch port" })
    });
  } finally {
    if (savedFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = savedFetch;
  }
  return results;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await runMockSuite();
  const failed = result.filter((entry) => entry.status !== "passed");
  for (const entry of result) process.stdout.write(`${entry.status.toUpperCase()} ${entry.id}${entry.message ? `: ${entry.message}` : ""}\n`);
  process.stdout.write(`Mock fixture suite: ${result.length - failed.length}/${result.length} passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}
