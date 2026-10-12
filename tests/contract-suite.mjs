import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  ALL_SHARED_SHAPES,
  CONTRACT_OWNERSHIP,
  ConnectorError,
  FulfillmentConnectorRuntime
} from "../dist/index.js";

const scope = { tenantId: "tenant-test", projectId: "project-test" };
const FIXTURE_VERSION = "1.0.0";
const PRIVATE_FIXTURE_LABEL = "FC-01 local development fixture; never an upstream acceptance pin";

function createBindings(overrides = {}) {
  const bindings = new Map();
  for (const shape of ALL_SHARED_SHAPES) {
    const fixtureBytes = JSON.stringify({ shape, version: FIXTURE_VERSION, label: PRIVATE_FIXTURE_LABEL });
    const fixtureDigest = `sha256:${createHash("sha256").update(fixtureBytes).digest("hex")}`;
    bindings.set(shape, {
      shape,
      ...CONTRACT_OWNERSHIP[shape],
      state: "development_fixture",
      schemaVersion: FIXTURE_VERSION,
      sourceRevision: "local-contract-suite-fixture",
      fixtureDigest
    });
  }
  for (const [shape, binding] of Object.entries(overrides)) {
    bindings.set(shape, { ...bindings.get(shape), ...binding });
  }
  return bindings;
}

function createFixtureValidator(options = {}) {
  const bindings = createBindings(options.bindingOverrides);
  let inboundCalls = 0;
  return {
    bindings,
    get inboundCalls() { return inboundCalls; },
    binding(shape) {
      if (options.throwBindingFor === shape) throw new Error("private fixture binding lookup failed");
      const binding = bindings.get(shape);
      if (binding === undefined) throw new Error("private fixture binding missing");
      return binding;
    },
    async validateInbound(request) {
      inboundCalls += 1;
      const envelope = request.envelope;
      if (envelope === null || typeof envelope !== "object") {
        return { ok: false, failure: { code: "invalid_input" } };
      }
      const input = envelope;
      const tenantId = typeof input.tenantId === "string" ? input.tenantId : "";
      const projectId = typeof input.projectId === "string" ? input.projectId : "";
      if (tenantId === "" || projectId === "") {
        return { ok: false, failure: { code: "invalid_input" } };
      }
      const schemaVersions = input.schemaVersions ?? {};
      const receipts = request.requiredShapes.map((shape) => ({
        shape,
        schemaVersion: schemaVersions[shape] ?? bindings.get(shape).schemaVersion,
        tenantId,
        projectId
      }));
      return {
        ok: true,
        value: input.command,
        receipts
      };
    },
    async validateOutbound(request) {
      if (options.rejectOutboundShape === request.requiredShapes[0]) {
        return { ok: false, failure: { code: "invalid_input" } };
      }
      const receipts = request.requiredShapes.map((shape) => ({
        shape,
        schemaVersion: options.outputVersions?.[shape] ?? bindings.get(shape).schemaVersion,
        tenantId: request.trustedScope.tenantId,
        projectId: request.trustedScope.projectId
      }));
      return { ok: true, value: request.value, receipts };
    }
  };
}

const operationNames = [
  "discover_capabilities",
  "quote",
  "preflight",
  "submit",
  "status",
  "shipment",
  "cancel"
];

function createDescriptor(options = {}) {
  const operations = Object.fromEntries(operationNames.map((operation) => {
    const isSubmit = operation === "submit";
    const isCancel = operation === "cancel";
    const supported = !(operation === "cancel" && options.cancelUnsupported);
    return [operation, {
      supported,
      sideEffect: isSubmit || isCancel ? "external" : "none",
      mayCharge: isSubmit,
      idempotency: isSubmit ? "connector_attempt_store" : isCancel ? "provider_key" : "not_applicable"
    }];
  }));
  return {
    providerId: "fixture-provider",
    apiVersion: "private-fixture-api/1",
    productLimits: { maxItems: 10 },
    operations,
    supportedModes: ["simulated", "sandbox"]
  };
}

function createHarness(options = {}) {
  const contractValidator = createFixtureValidator(options.contracts);
  const state = {
    transportCalls: [],
    authorizationCalls: [],
    budgetCalls: [],
    usagePayloads: [],
    meteringObservations: [],
    attempts: options.sharedAttempts ?? new Map(),
    claimedAuthorizationActions: options.sharedAuthorizationActions ?? new Set(),
    validateBeforeSubmitCalls: 0,
    adapterCalls: []
  };
  const fixedClock = { now: () => Date.parse("2026-10-10T14:00:00.000Z") };
  const transport = {
    mode: options.runtimeOptions?.mode ?? "simulated",
    async request(request) {
      state.transportCalls.push(request);
      if (options.transportFailure !== undefined) {
        throw options.transportFailure();
      }
      return { fixture: true, operation: request.operation };
    }
  };
  const adapter = {
    descriptor: createDescriptor(options),
    async quote(command, context) {
      state.adapterCalls.push("quote");
      await context.transport.request({ operation: "quote", method: "POST", path: "/fixture/quote", body: command });
      return {
        status: "supported",
        value: {
          providerQuoteId: "quote-fixture-1",
          currency: "USD",
          totalMinor: 1250,
          expiresAt: "2026-10-10T15:00:00.000Z",
          breakdown: [{ label: "production", amountMinor: 1250 }]
        }
      };
    },
    async preflight(command, context) {
      state.adapterCalls.push("preflight");
      await context.transport.request({ operation: "preflight", method: "POST", path: "/fixture/preflight", body: command });
      return { status: "supported", value: { valid: true, issues: [] } };
    },
    async validateBeforeSubmit(command, context) {
      state.validateBeforeSubmitCalls += 1;
      if (options.preSubmitReport !== undefined) {
        return { status: "supported", value: options.preSubmitReport };
      }
      assert.equal(context.mode, "simulated");
      assert.equal(context.trustedScope.tenantId, scope.tenantId);
      assert.equal(typeof command.amountMinor, "number");
      return { status: "supported", value: { valid: true, issues: [] } };
    },
    async submit(command, context) {
      state.adapterCalls.push("submit");
      await context.transport.request({
        operation: "submit",
        method: "POST",
        path: "/fixture/orders",
        body: command,
        idempotencyKey: command.idempotencyKey
      });
      return { status: "supported", value: { providerRequestId: "request-fixture-1", acceptedAt: "2026-10-10T14:00:00.000Z" } };
    },
    async getStatus(command, context) {
      state.adapterCalls.push("status");
      await context.transport.request({ operation: "status", method: "GET", path: "/fixture/status", body: command });
      return { status: "supported", value: {
        providerRequestId: command.providerRequestId,
        normalizedState: "in_production",
        observedAt: "2026-10-10T14:01:00.000Z"
      } };
    },
    async observeShipment(command, context) {
      state.adapterCalls.push("shipment");
      await context.transport.request({ operation: "shipment", method: "GET", path: "/fixture/shipment", body: command });
      return { status: "supported", value: {
        providerRequestId: command.providerRequestId,
        providerShipmentId: "shipment-fixture-1",
        carrier: "Fixture Carrier",
        observedAt: "2026-10-10T14:02:00.000Z"
      } };
    },
    async cancel(command, context) {
      state.adapterCalls.push("cancel");
      await context.transport.request({
        operation: "cancel",
        method: "POST",
        path: "/fixture/cancel",
        body: command,
        idempotencyKey: command.idempotencyKey
      });
      return { status: "supported", value: {
        providerRequestId: command.providerRequestId,
        outcome: "cancelled",
        observedAt: "2026-10-10T14:03:00.000Z"
      } };
    }
  };
  const usageSink = {
    async record(contractPayload) {
      state.usagePayloads.push(contractPayload);
    }
  };
  const runtimeMode = options.runtimeOptions?.mode ?? "simulated";
  const dependencies = {
    contracts: contractValidator,
    transport,
    clock: fixedClock,
    persistence: {
      async getSubmitAttempt(providerId, trustedScope, key) {
        return state.attempts.get(`${providerId}/${trustedScope.tenantId}/${trustedScope.projectId}/${key}`);
      },
      async claimSubmitAttempt(record) {
        const key = `${record.providerId}/${record.tenantId}/${record.projectId}/${record.idempotencyKey}`;
        const existing = state.attempts.get(key);
        const actionExisting = [...state.attempts.values()].find((attempt) =>
          attempt.providerId === record.providerId &&
          attempt.tenantId === record.tenantId &&
          attempt.projectId === record.projectId &&
          (attempt.actionId === record.actionId || attempt.authorizationId === record.authorizationId)
        );
        if (existing !== undefined || actionExisting !== undefined) {
          return { claimed: false, existing: existing ?? actionExisting };
        }
        state.attempts.set(key, record);
        return { claimed: true };
      },
      async saveSubmitAttempt(record) {
        const key = `${record.providerId}/${record.tenantId}/${record.projectId}/${record.idempotencyKey}`;
        const existing = state.attempts.get(key);
        if (existing === undefined || existing.claimId !== record.claimId) throw new Error("claim ownership mismatch");
        state.attempts.set(key, record);
      }
    },
    authorizationVerifier: {
      async verifyAndClaim(check) {
        state.authorizationCalls.push(check);
        if (options.authorizationAllowed === false || options.authorizationFactsAllowed?.(check) === false) {
          return { status: "rejected" };
        }
        const operation = check.facts.operation;
        const actionId = options.authorizationActionId ?? `fixture-${operation}-action-1`;
        const authorizationId = options.authorizationId ?? `fixture-${operation}-authorization-1`;
        if (!options.authorizationAllowsReplay) {
          const prefix = `${check.facts.providerId}/${check.facts.trustedScope.tenantId}/${check.facts.trustedScope.projectId}`;
          const actionKey = `${prefix}/action/${actionId}`;
          const authorizationKey = `${prefix}/authorization/${authorizationId}`;
          if (state.claimedAuthorizationActions.has(actionKey) || state.claimedAuthorizationActions.has(authorizationKey)) {
            return { status: "rejected" };
          }
          state.claimedAuthorizationActions.add(actionKey);
          state.claimedAuthorizationActions.add(authorizationKey);
        }
        return {
          status: "claimed",
          authorizationId,
          actionId,
          claimReference: `fixture-${operation}-claim-1`
        };
      }
    },
    budgetClient: {
      async authorize(check) {
        state.budgetCalls.push(check);
        return { authorized: options.budgetAllowed !== false, reference: "fixture-budget-reference" };
      }
    },
    usageSink,
    metering: async (requestedScope) => ({
      isConfiguredFor(providerId, mode, suppliedScope) {
        return providerId === "fixture-provider" && mode === runtimeMode &&
          suppliedScope.tenantId === requestedScope.tenantId && suppliedScope.projectId === requestedScope.projectId;
      },
      async replayPending() {
        return { pending: options.meteringReplayPending === true ? 1 : 0, failures: [] };
      },
      async recordObservation(observation) {
        const copy = structuredClone(observation);
        state.meteringObservations.push(copy);
        const validation = await contractValidator.validateOutbound({
          operation: copy.operation,
          requiredShapes: ["fulfillment_usage"],
          value: { ...copy, providerId: "fixture-provider", mode: runtimeMode },
          trustedScope: requestedScope
        });
        if (!validation.ok) return { status: "blocked", reason: "contract_unavailable" };
        if (options.meteringPending === true) return { status: "pending", reason: "usage_sink_unavailable" };
        await usageSink.record(validation.value);
        return { status: "recorded" };
      }
    })
  };
  const runtime = new FulfillmentConnectorRuntime(adapter, dependencies, options.runtimeOptions);
  return { runtime, state, contractValidator, adapter, dependencies };
}

function envelope(command, extra = {}) {
  return { tenantId: scope.tenantId, projectId: scope.projectId, command, ...extra };
}

function submitCommand(overrides = {}) {
  return {
    productionBundle: { fixture: "bundle" },
    productionBundleDigest: "sha256:fixture-bundle",
    quote: {
      quoteId: "quote-fixture-1",
      currency: "USD",
      totalMinor: 1250,
      expiresAt: "2026-10-10T15:00:00.000Z",
      productionBundleDigest: "sha256:fixture-bundle",
      termsFingerprint: "sha256:fixture-terms"
    },
    authorizationEnvelope: { fixture: "authorization" },
    amountMinor: 1250,
    currency: "USD",
    idempotencyKey: "idem-fixture-1",
    requestFingerprint: "sha256:fixture-request",
    ...overrides
  };
}

function authorizationCommand(command) {
  const { authorizationEnvelope, idempotencyKey, requestFingerprint, ...facts } = command;
  void authorizationEnvelope;
  void idempotencyKey;
  void requestFingerprint;
  return facts;
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function expectError(promise, code, sideEffectState) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ConnectorError);
    assert.equal(error.code, code);
    if (sideEffectState !== undefined) assert.equal(error.sideEffectState, sideEffectState);
    return true;
  });
}

const cases = [];

cases.push(["all seven typed operations run through injected ports in simulated mode", async () => {
  const { runtime, state } = createHarness();
  assert.equal(runtime.mode, "simulated");
  const caps = await runtime.discoverCapabilities(envelope({ catalogKey: "catalog-fixture" }), scope);
  const quote = await runtime.quote(envelope({
    productionBundle: { fixture: "bundle" }, quantity: 1, destination: { fixture: true }
  }), scope);
  const preflight = await runtime.preflight(envelope({
    productionBundle: { fixture: "bundle" }, printSpecification: { fixture: true }
  }), scope);
  const submitted = await runtime.submit(envelope(submitCommand()), scope);
  const status = await runtime.getStatus(envelope({ providerRequestId: "request-fixture-1" }), scope);
  const shipment = await runtime.observeShipment(envelope({ providerRequestId: "request-fixture-1" }), scope);
  const canceled = await runtime.cancel(envelope({
    providerRequestId: "request-fixture-1",
    authorizationEnvelope: { fixture: "authorization" },
    idempotencyKey: "cancel-fixture-1",
    requestFingerprint: "sha256:fixture-cancel"
  }), scope);
  assert.equal(caps.value.mode, "simulated");
  assert.equal(quote.value.totalMinor, 1250);
  assert.equal(preflight.value.valid, true);
  assert.equal(submitted.value.providerRequestId, "request-fixture-1");
  assert.equal(status.value.normalizedState, "in_production");
  assert.equal(shipment.value.providerShipmentId, "shipment-fixture-1");
  assert.equal(canceled.value.outcome, "cancelled");
  assert.equal(state.adapterCalls.length, 6);
  assert.equal(state.transportCalls.length, 6);
  assert.equal(state.authorizationCalls.length, 2);
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.usagePayloads.length, 20);
  assert.equal(state.meteringObservations.filter((event) => event.transportAttemptId !== undefined).length, 12);
  assert.equal(state.meteringObservations.filter((event) => event.billableAttemptId !== undefined).length, 6);
  assert.equal(state.budgetCalls[0].trustedScope.tenantId, scope.tenantId);
  assert.ok(!("request" in state.budgetCalls[0]));
  assert.equal(runtime.audit().liveModeSupported, false);
  assert.equal(runtime.audit().contractReadiness.ready, false);
}]);

cases.push(["tenant mismatch rejects before transport, authorization, budget, usage, or persistence", async () => {
  const { runtime, state } = createHarness();
  await expectError(
    runtime.quote(envelope({ productionBundle: {}, quantity: 1, destination: {} }, { tenantId: "other-tenant" }), scope),
    "scope_mismatch",
    "not_dispatched"
  );
  assert.equal(state.transportCalls.length, 0);
  assert.equal(state.authorizationCalls.length, 0);
  assert.equal(state.budgetCalls.length, 0);
  assert.equal(state.usagePayloads.length, 0);
}]);

cases.push(["empty trusted scope rejects before calling the contract validator or transport", async () => {
  const { runtime, state } = createHarness();
  await expectError(
    runtime.quote(envelope({ productionBundle: {}, quantity: 1, destination: {} }), { tenantId: " ", projectId: scope.projectId }),
    "scope_mismatch",
    "not_dispatched"
  );
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["invalid quote quantity rejects before transport", async () => {
  const { runtime, state } = createHarness();
  await expectError(runtime.quote(envelope({ productionBundle: {}, quantity: 0, destination: {} }), scope), "invalid_input", "not_dispatched");
  await expectError(runtime.quote(envelope({ productionBundle: {}, quantity: Number.MAX_SAFE_INTEGER + 1, destination: {} }), scope), "invalid_input", "not_dispatched");
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["unsupported schema major rejects before provider transport", async () => {
  const { runtime, state } = createHarness();
  await expectError(
    runtime.quote(envelope({
      productionBundle: {}, quantity: 1, destination: {}
    }, { schemaVersions: { production_bundle: "2.0.0" } }), scope),
    "unsupported_schema_major",
    "not_dispatched"
  );
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["same-major older consumer accepts additive envelope fields through its validator", async () => {
  const { runtime, state } = createHarness();
  const result = await runtime.quote(envelope({
    productionBundle: {}, quantity: 1, destination: {}
  }, {
    schemaVersions: { production_bundle: "1.0.0" },
    additiveFutureField: { ignoredByFixtureDecoder: true }
  }), scope);
  assert.equal(result.value.providerQuoteId, "quote-fixture-1");
  assert.equal(state.transportCalls.length, 1);
}]);

cases.push(["missing accepted pins remain a typed fail-closed prerequisite", async () => {
  const { runtime, state } = createHarness({
    contracts: { bindingOverrides: {
      production_bundle: { state: "missing", schemaVersion: undefined, fixtureDigest: undefined }
    } }
  });
  assert.equal(runtime.audit().contractReadiness.ready, false);
  await expectError(
    runtime.quote(envelope({ productionBundle: {}, quantity: 1, destination: {} }), scope),
    "contract_missing",
    "not_dispatched"
  );
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["binding lookup failure is a typed fail-closed result and safe audit", async () => {
  const { runtime, state } = createHarness({ contracts: { throwBindingFor: "production_bundle" } });
  assert.equal(runtime.audit().contractReadiness.ready, false);
  await expectError(
    runtime.quote(envelope({ productionBundle: {}, quantity: 1, destination: {} }), scope),
    "contract_missing",
    "not_dispatched"
  );
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["pre-submit validation rejects stale quotes before authorization, budget, persistence, and transport", async () => {
  const { runtime, state } = createHarness({
    preSubmitReport: { valid: false, issues: [{ code: "stale_quote" }] }
  });
  await expectError(runtime.submit(envelope(submitCommand()), scope), "stale_quote", "not_dispatched");
  assert.equal(state.validateBeforeSubmitCalls, 1);
  assert.equal(state.authorizationCalls.length, 0);
  assert.equal(state.budgetCalls.length, 0);
  assert.equal(state.attempts.size, 0);
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["quote expiry during async submit phases blocks reservation or final transport", async () => {
  const expiry = Date.parse("2026-10-10T15:00:00.000Z");
  for (const phase of ["pre-submit", "issuer", "budget", "adapter-before-transport"]) {
    const { runtime, state, adapter, dependencies } = createHarness({ authorizationAllowsReplay: true });
    let now = Date.parse("2026-10-10T14:00:00.000Z");
    dependencies.clock.now = () => now;
    const expire = (at = Date.parse("2026-10-10T16:00:00.000Z")) => { now = at; };

    if (phase === "pre-submit") {
      const validate = adapter.validateBeforeSubmit.bind(adapter);
      adapter.validateBeforeSubmit = async (...args) => {
        const result = await validate(...args);
        expire();
        return result;
      };
    } else if (phase === "issuer") {
      const verify = dependencies.authorizationVerifier.verifyAndClaim.bind(dependencies.authorizationVerifier);
      dependencies.authorizationVerifier.verifyAndClaim = async (...args) => {
        const result = await verify(...args);
        expire();
        return result;
      };
    } else if (phase === "budget") {
      const authorize = dependencies.budgetClient.authorize.bind(dependencies.budgetClient);
      dependencies.budgetClient.authorize = async (...args) => {
        const result = await authorize(...args);
        expire();
        return result;
      };
    } else {
      adapter.submit = async (command, context) => {
        state.adapterCalls.push("submit");
        await Promise.resolve();
        expire(expiry);
        await context.transport.request({
          operation: "submit",
          method: "POST",
          path: "/fixture/orders",
          body: command,
          idempotencyKey: command.idempotencyKey
        });
        return { status: "supported", value: { providerRequestId: "request-fixture-1", acceptedAt: "2026-10-10T14:00:00.000Z" } };
      };
    }

    await expectError(runtime.submit(envelope(submitCommand()), scope), "stale_quote", "not_dispatched");
    assert.equal(state.transportCalls.length, 0, `${phase} dispatched after quote expiry`);
    if (phase === "pre-submit") {
      assert.equal(state.authorizationCalls.length, 0);
      assert.equal(state.budgetCalls.length, 0);
      assert.equal(state.attempts.size, 0);
      continue;
    }

    const attempt = state.attempts.values().next().value;
    assert.equal(state.authorizationCalls.length, 1);
    assert.equal(attempt.sideEffectState, "not_dispatched");
    if (phase === "issuer") {
      assert.equal(state.budgetCalls.length, 0);
      assert.equal(attempt.budgetReservationState, "not_requested");
    } else {
      assert.equal(state.budgetCalls.length, 1);
      assert.equal(attempt.budgetReservationState, "reserved");
      assert.equal(attempt.budgetReservationReference, "fixture-budget-reference");
      assert.equal(state.adapterCalls.includes("submit"), phase === "adapter-before-transport");
    }

    const retryCode = phase === "issuer" ? "authorization_action_claimed" : "reservation_unresolved";
    for (const idempotencyKey of ["idem-fixture-1", `${phase}-new-key`]) {
      const restoredAttempts = new Map(JSON.parse(JSON.stringify([...state.attempts.entries()])));
      const restored = createHarness({ sharedAttempts: restoredAttempts, authorizationAllowsReplay: true });
      await expectError(
        restored.runtime.submit(envelope(submitCommand({ idempotencyKey })), scope),
        retryCode,
        "not_dispatched"
      );
      assert.equal(restored.state.budgetCalls.length, 0);
      assert.equal(restored.state.transportCalls.length, 0);
    }
    assert.equal(state.budgetCalls.length, phase === "issuer" ? 0 : 1);
  }
}]);

cases.push(["an unexpired quote dispatches successfully", async () => {
  const { runtime, state } = createHarness();
  const result = await runtime.submit(envelope(submitCommand()), scope);
  assert.equal(result.value.providerRequestId, "request-fixture-1");
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.transportCalls.filter((call) => call.operation === "submit").length, 1);
}]);

cases.push(["quote expiry exactly at the transport deadline rejects and retains the reservation", async () => {
  const expiry = Date.parse("2026-10-10T15:00:00.000Z");
  const { runtime, state, adapter, dependencies } = createHarness({ authorizationAllowsReplay: true });
  let now = Date.parse("2026-10-10T14:00:00.000Z");
  dependencies.clock.now = () => now;
  adapter.submit = async (command, context) => {
    state.adapterCalls.push("submit");
    await Promise.resolve();
    now = expiry;
    await context.transport.request({
      operation: "submit",
      method: "POST",
      path: "/fixture/orders",
      body: command,
      idempotencyKey: command.idempotencyKey
    });
    return { status: "supported", value: { providerRequestId: "request-fixture-1", acceptedAt: "2026-10-10T14:00:00.000Z" } };
  };

  await expectError(runtime.submit(envelope(submitCommand()), scope), "stale_quote", "not_dispatched");
  const attempt = state.attempts.values().next().value;
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.transportCalls.length, 0);
  assert.equal(attempt.budgetReservationState, "reserved");
  assert.equal(attempt.budgetReservationReference, "fixture-budget-reference");
  assert.equal(attempt.sideEffectState, "not_dispatched");
}]);

cases.push(["submit rejects a quote that does not bind the exact amount, currency, and artifact", async () => {
  const { runtime, state } = createHarness();
  const mismatched = submitCommand({
    quote: { ...submitCommand().quote, totalMinor: 1300, productionBundleDigest: "sha256:other-bundle" }
  });
  await expectError(runtime.submit(envelope(mismatched), scope), "invalid_input", "not_dispatched");
  assert.equal(state.validateBeforeSubmitCalls, 0);
  assert.equal(state.authorizationCalls.length, 0);
  assert.equal(state.budgetCalls.length, 0);
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["stale authorization rejects before budget or provider transport", async () => {
  const { runtime, state } = createHarness({ authorizationAllowed: false });
  await expectError(runtime.submit(envelope(submitCommand()), scope), "stale_authorization", "not_dispatched");
  assert.equal(state.authorizationCalls.length, 1);
  assert.equal(state.budgetCalls.length, 0);
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["private synthetic authority blocks authorization reuse after a lost claim response", async () => {
  // This models a private fixture claim followed by a lost response. It is not
  // evidence of a real issuer protocol, recovery path, or production restart.
  const authorizationId = "fixture-lost-response-authorization";
  const first = createHarness({
    authorizationId,
    authorizationActionId: "fixture-first-purchase-action"
  });
  const fixtureClaim = first.dependencies.authorizationVerifier.verifyAndClaim.bind(
    first.dependencies.authorizationVerifier
  );
  let committedFixtureClaims = 0;
  first.dependencies.authorizationVerifier.verifyAndClaim = async (check) => {
    const result = await fixtureClaim(check);
    assert.equal(result.status, "claimed");
    committedFixtureClaims += 1;
    throw new Error("private fixture simulates a lost response after claim commit");
  };

  await expectError(
    first.runtime.submit(envelope(submitCommand()), scope),
    "authorization_unavailable",
    "not_dispatched"
  );
  const fixtureScope = `fixture-provider/${scope.tenantId}/${scope.projectId}`;
  assert.equal(committedFixtureClaims, 1);
  assert.equal(first.state.claimedAuthorizationActions.size, 2);
  assert.equal(first.state.claimedAuthorizationActions.has(
    `${fixtureScope}/action/fixture-first-purchase-action`
  ), true);
  assert.equal(first.state.claimedAuthorizationActions.has(
    `${fixtureScope}/authorization/${authorizationId}`
  ), true);
  assert.equal(first.state.attempts.size, 0);
  assert.equal(first.state.budgetCalls.length, 0);
  assert.equal(first.state.transportCalls.length, 0);

  const second = createHarness({
    sharedAuthorizationActions: first.state.claimedAuthorizationActions,
    authorizationId,
    authorizationActionId: "fixture-second-purchase-action"
  });
  const secondPurchase = submitCommand({
    productionBundle: { fixture: "different purchase" },
    productionBundleDigest: "sha256:different-purchase-bundle",
    quote: {
      ...submitCommand().quote,
      quoteId: "quote-fixture-second-purchase",
      totalMinor: 1400,
      productionBundleDigest: "sha256:different-purchase-bundle"
    },
    amountMinor: 1400,
    idempotencyKey: "idem-fixture-second-purchase",
    requestFingerprint: "sha256:fixture-second-purchase-request"
  });
  await expectError(
    second.runtime.submit(envelope(secondPurchase), scope),
    "stale_authorization",
    "not_dispatched"
  );
  assert.equal(second.state.authorizationCalls.length, 1);
  assert.equal(first.state.claimedAuthorizationActions.size, 2);
  assert.equal(second.state.attempts.size, 0);
  assert.equal(second.state.budgetCalls.length, 0);
  assert.equal(second.state.transportCalls.length, 0);
}]);

cases.push(["legacy boolean authorization verification fails closed without an atomic action claim", async () => {
  const { runtime, state, dependencies } = createHarness();
  dependencies.authorizationVerifier.verify = async () => ({ authorized: true });
  dependencies.authorizationVerifier.verifyAndClaim = undefined;
  await expectError(
    runtime.submit(envelope(submitCommand()), scope),
    "authorization_unavailable",
    "not_dispatched"
  );
  assert.equal(state.attempts.size, 0);
  assert.equal(state.budgetCalls.length, 0);
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["authorization rejects independent changes to price, currency, artifact, quote, terms, and destination", async () => {
  const original = submitCommand({
    productionBundle: { fixture: "bundle", destination: { country: "US" } }
  });
  const expectedFacts = JSON.stringify(authorizationCommand(original));
  const variants = [
    submitCommand({ amountMinor: 1300, quote: { ...original.quote, totalMinor: 1300 }, productionBundle: original.productionBundle }),
    submitCommand({ currency: "EUR", quote: { ...original.quote, currency: "EUR" }, productionBundle: original.productionBundle }),
    submitCommand({
      productionBundle: { fixture: "different-bytes", destination: { country: "US" } },
      productionBundleDigest: "sha256:different-bundle",
      quote: { ...original.quote, productionBundleDigest: "sha256:different-bundle" }
    }),
    submitCommand({ quote: { ...original.quote, quoteId: "quote-other" }, productionBundle: original.productionBundle }),
    submitCommand({ quote: { ...original.quote, expiresAt: "2026-10-10T16:00:00.000Z" }, productionBundle: original.productionBundle }),
    submitCommand({ quote: { ...original.quote, termsFingerprint: "sha256:other-terms" }, productionBundle: original.productionBundle }),
    submitCommand({ productionBundle: { fixture: "bundle", destination: { country: "CA" } } })
  ];
  for (const altered of variants) {
    const { runtime, state } = createHarness({
      authorizationAllowsReplay: true,
      authorizationFactsAllowed: (check) => JSON.stringify(check.facts.command) === expectedFacts
    });
    await expectError(runtime.submit(envelope(altered), scope), "stale_authorization", "not_dispatched");
    assert.equal(state.authorizationCalls.length, 1);
    assert.equal(state.budgetCalls.length, 0);
    assert.equal(state.transportCalls.length, 0);
  }
}]);

cases.push(["authorization facts include provider identity and cancellation target", async () => {
  const providerHarness = createHarness({
    authorizationAllowsReplay: true,
    authorizationFactsAllowed: (check) =>
      check.facts.providerId === "fixture-provider" &&
      check.facts.mode === "simulated" &&
      check.facts.trustedScope.tenantId === scope.tenantId &&
      check.facts.operation === "submit"
  });
  providerHarness.adapter.descriptor.providerId = "other-provider";
  const providerRuntime = new FulfillmentConnectorRuntime(providerHarness.adapter, providerHarness.dependencies);
  await expectError(
    providerRuntime.submit(envelope(submitCommand()), scope),
    "stale_authorization",
    "not_dispatched"
  );
  assert.equal(providerHarness.state.budgetCalls.length, 0);
  assert.equal(providerHarness.state.transportCalls.length, 0);

  const cancelHarness = createHarness({
    authorizationAllowsReplay: true,
    authorizationFactsAllowed: (check) =>
      check.facts.operation === "cancel" && check.facts.command.providerRequestId === "request-fixture-1"
  });
  await expectError(cancelHarness.runtime.cancel(envelope({
    providerRequestId: "request-other",
    authorizationEnvelope: { fixture: "authorization" },
    idempotencyKey: "cancel-key",
    requestFingerprint: "same-caller-fingerprint"
  }), scope), "stale_authorization", "not_dispatched");
  assert.equal(cancelHarness.state.budgetCalls.length, 0);
  assert.equal(cancelHarness.state.transportCalls.length, 0);
}]);

cases.push(["caller mutation while boundary, pre-submit, and authorization ports await cannot change dispatched facts", async () => {
  const { runtime, state, contractValidator, adapter, dependencies } = createHarness({ authorizationAllowsReplay: true });
  const originalValidateInbound = contractValidator.validateInbound.bind(contractValidator);
  const originalVerifyAndClaim = dependencies.authorizationVerifier.verifyAndClaim.bind(dependencies.authorizationVerifier);
  const boundaryGate = deferred();
  const preSubmitGate = deferred();
  const authorizationGate = deferred();
  const preSubmitEntered = deferred();
  const authorizationEntered = deferred();
  contractValidator.validateInbound = async (request) => {
    if (request.operation === "submit") await boundaryGate.promise;
    return originalValidateInbound(request);
  };
  adapter.validateBeforeSubmit = async (command) => {
    state.validateBeforeSubmitCalls += 1;
    preSubmitEntered.resolve();
    await preSubmitGate.promise;
    assert.equal(command.amountMinor, 1250);
    assert.equal(command.productionBundle.destination.country, "US");
    assert.equal(Reflect.set(command, "amountMinor", 999999), false);
    return { status: "supported", value: { valid: true, issues: [] } };
  };
  dependencies.authorizationVerifier.verifyAndClaim = async (check) => {
    authorizationEntered.resolve();
    await authorizationGate.promise;
    assert.equal(check.facts.command.amountMinor, 1250);
    assert.equal(check.facts.command.productionBundle.destination.country, "US");
    assert.equal(Reflect.set(check.facts.command, "amountMinor", 999999), false);
    return originalVerifyAndClaim(check);
  };

  const command = submitCommand({
    productionBundle: { fixture: "bundle", destination: { country: "US" } }
  });
  const mutableScope = { ...scope };
  const pending = runtime.submit(envelope(command), mutableScope);
  command.amountMinor = 999999;
  command.productionBundle.destination.country = "CA";
  mutableScope.tenantId = "mutated-tenant";
  boundaryGate.resolve();
  await preSubmitEntered.promise;
  command.quote.quoteId = "quote-mutated";
  mutableScope.projectId = "mutated-project";
  preSubmitGate.resolve();
  await authorizationEntered.promise;
  command.currency = "EUR";
  authorizationGate.resolve();
  await pending;
  assert.equal(state.transportCalls.length, 1);
  assert.equal(state.transportCalls[0].body.amountMinor, 1250);
  assert.equal(state.transportCalls[0].body.productionBundle.destination.country, "US");
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.authorizationCalls[0].facts.trustedScope.tenantId, scope.tenantId);
}]);

cases.push(["budget denial rejects before provider transport", async () => {
  const { runtime, state } = createHarness({ budgetAllowed: false });
  await expectError(runtime.submit(envelope(submitCommand()), scope), "budget_denied", "not_dispatched");
  assert.equal(state.authorizationCalls.length, 1);
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.transportCalls.length, 0);
  assert.equal(state.attempts.values().next().value.sideEffectState, "not_dispatched");
}]);

cases.push(["budget approval without a valid reservation reference stays unknown and blocks dispatch", async () => {
  for (const reference of [undefined, "", " reservation-1", "reservation\n1", "x".repeat(513)]) {
    const { runtime, state, dependencies } = createHarness({ authorizationAllowsReplay: true });
    dependencies.budgetClient.authorize = async (check) => {
      state.budgetCalls.push(check);
      return { authorized: true, ...(reference === undefined ? {} : { reference }) };
    };
    await expectError(runtime.submit(envelope(submitCommand()), scope), "budget_unavailable", "not_dispatched");
    const attempt = state.attempts.values().next().value;
    assert.equal(attempt.budgetReservationState, "unknown");
    assert.equal(attempt.budgetReservationReference, undefined);
    assert.equal(state.budgetCalls.length, 1);
    assert.equal(state.transportCalls.length, 0);
    await expectError(
      runtime.submit(envelope(submitCommand({ idempotencyKey: "new-key-after-unattributed-reservation" })), scope),
      "reservation_unresolved",
      "not_dispatched"
    );
    assert.equal(state.budgetCalls.length, 1);
    assert.equal(state.transportCalls.length, 0);
  }
}]);

cases.push(["dispatch usage is accepted before budget reservation", async () => {
  const { runtime, state } = createHarness({ contracts: { rejectOutboundShape: "fulfillment_usage" } });
  await expectError(runtime.submit(envelope(submitCommand()), scope), "usage_sink_unavailable", "not_dispatched");
  assert.equal(state.usagePayloads.length, 0);
  assert.equal(state.authorizationCalls.length, 1);
  assert.equal(state.budgetCalls.length, 0);
  assert.equal(state.transportCalls.length, 0);
  assert.equal(state.attempts.values().next().value.sideEffectState, "not_dispatched");
}]);

cases.push(["durable metering outage or unresolved outbox blocks new reservation and dispatch", async () => {
  for (const options of [{ meteringPending: true }, { meteringReplayPending: true }]) {
    const { runtime, state } = createHarness(options);
    await expectError(runtime.submit(envelope(submitCommand()), scope), "usage_sink_unavailable", "not_dispatched");
    assert.equal(state.budgetCalls.length, 0);
    assert.equal(state.transportCalls.length, 0);
    assert.equal(state.attempts.values().next().value.sideEffectState, "not_dispatched");
  }
}]);

cases.push(["runtime metering binds a prepared billable attempt to transport and keeps charge unknown", async () => {
  const { runtime, state } = createHarness();
  const submitted = await runtime.submit(envelope(submitCommand()), scope);
  assert.equal(submitted.value.providerRequestId, "request-fixture-1");
  const storedAttempt = state.attempts.values().next().value;
  const prepared = state.meteringObservations.find((event) => event.outcome === "attempt_prepared");
  const dispatching = state.meteringObservations.find((event) => event.operation === "submit" && event.outcome === "dispatching");
  const accepted = state.meteringObservations.find((event) => event.operation === "submit" && event.outcome === "provider_accepted");
  assert.equal(prepared.logicalOperationId, storedAttempt.actionId);
  assert.equal(prepared.billableAttemptId, storedAttempt.claimId);
  assert.ok(dispatching.transportAttemptId);
  assert.equal(accepted.billableAttemptId, storedAttempt.claimId);
  assert.equal(accepted.transportAttemptId, dispatching.transportAttemptId);
  assert.equal(accepted.providerRequestId, "request-fixture-1");
  assert.deepEqual(accepted.quoteAmount, {
    amount: { representation: "minor_units", units: "1250", currency: "USD" },
    basis: "provider_confirmed"
  });
  assert.deepEqual(accepted.chargeAmount, { amount: null, basis: "unknown" });
  assert.ok(accepted.sourceRefs.some((ref) => ref.startsWith("authorization-claim:")));
  assert.ok(accepted.sourceRefs.includes("budget-reservation:fixture-budget-reference"));
}]);

cases.push(["unsupported cancellation fails closed without silent success", async () => {
  const { runtime, state } = createHarness({ cancelUnsupported: true });
  await expectError(runtime.cancel(envelope({
    providerRequestId: "request-fixture-1",
    authorizationEnvelope: { fixture: "authorization" },
    idempotencyKey: "cancel-fixture-1",
    requestFingerprint: "sha256:fixture-cancel"
  }), scope), "unsupported", "not_dispatched");
  assert.equal(state.transportCalls.length, 0);
  assert.equal(state.authorizationCalls.length, 0);
}]);

cases.push(["ambiguous submit is persisted and never automatically retried or re-budgeted", async () => {
  const { runtime, state } = createHarness({
    transportFailure: () => Object.assign(new Error("private token address@example.com"), { name: "TimeoutError" })
  });
  const request = envelope(submitCommand());
  await expectError(runtime.submit(request, scope), "ambiguous_submission", "possible");
  assert.equal(state.transportCalls.length, 1);
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.attempts.values().next().value.sideEffectState, "possible");
  await expectError(runtime.submit(request, scope), "ambiguous_submission", "possible");
  assert.equal(state.transportCalls.length, 1);
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.authorizationCalls.length, 1);
}]);

cases.push(["connector-attempt-store cancellation fails closed before authorization, budget, usage, or transport", async () => {
  const { runtime, state, adapter, dependencies } = createHarness();
  adapter.descriptor.operations.cancel = {
    supported: true,
    sideEffect: "external",
    mayCharge: true,
    idempotency: "connector_attempt_store"
  };
  const connectorStoreRuntime = new FulfillmentConnectorRuntime(adapter, dependencies);
  await expectError(connectorStoreRuntime.cancel(envelope({
    providerRequestId: "request-fixture-1",
    authorizationEnvelope: { fixture: "authorization" },
    budgetRequest: { amountMinor: 25, currency: "USD", purpose: "fulfillment_cancel" },
    idempotencyKey: "cancel-key",
    requestFingerprint: "cancel-fingerprint"
  }), scope), "unsupported", "not_dispatched");
  assert.equal(state.authorizationCalls.length, 0);
  assert.equal(state.budgetCalls.length, 0);
  assert.equal(state.usagePayloads.length, 0);
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["provider error details never appear in public connector errors", async () => {
  const { runtime } = createHarness({
    transportFailure: () => new Error("token=super-secret user@example.com")
  });
  let captured;
  try {
    await runtime.submit(envelope(submitCommand()), scope);
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof ConnectorError);
  assert.equal(captured.code, "ambiguous_submission");
  const serialized = JSON.stringify(captured.toJSON());
  assert.ok(!serialized.includes("super-secret"));
  assert.ok(!serialized.includes("user@example.com"));
}]);

cases.push(["successful duplicate submission does not dispatch a second order", async () => {
  const { runtime, state } = createHarness();
  const request = envelope(submitCommand());
  await runtime.submit(request, scope);
  await expectError(runtime.submit(request, scope), "duplicate_submission", "confirmed");
  assert.equal(state.transportCalls.filter((call) => call.operation === "submit").length, 1);
  assert.equal(state.budgetCalls.length, 1);
}]);

cases.push(["atomic submission claim permits only one concurrent dispatch per scoped idempotency key", async () => {
  const { runtime, state } = createHarness();
  const request = envelope(submitCommand());
  const results = await Promise.allSettled([
    runtime.submit(request, scope),
    runtime.submit(request, scope)
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(state.transportCalls.filter((call) => call.operation === "submit").length, 1);
  assert.equal(state.budgetCalls.length, 1);
}]);

cases.push(["atomic authorization-action claim blocks concurrent submissions with distinct provider keys", async () => {
  const { runtime, state } = createHarness({ authorizationAllowsReplay: true });
  const results = await Promise.allSettled([
    runtime.submit(envelope(submitCommand({ idempotencyKey: "key-a" })), scope),
    runtime.submit(envelope(submitCommand({ idempotencyKey: "key-b" })), scope)
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(state.transportCalls.filter((call) => call.operation === "submit").length, 1);
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.attempts.size, 1);
}]);

cases.push(["sequential distinct provider keys cannot reuse a claimed authorization action", async () => {
  const { runtime, state } = createHarness({ authorizationAllowsReplay: true });
  await runtime.submit(envelope(submitCommand({ idempotencyKey: "key-a" })), scope);
  await expectError(
    runtime.submit(envelope(submitCommand({ idempotencyKey: "key-b" })), scope),
    "duplicate_submission",
    "confirmed"
  );
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.transportCalls.filter((call) => call.operation === "submit").length, 1);
}]);

cases.push(["accepted-then-timeout remains blocked across a restarted runtime and a new provider key", async () => {
  const first = createHarness({
    authorizationAllowsReplay: true,
    transportFailure: () => Object.assign(new Error("accepted then timed out"), { name: "TimeoutError" })
  });
  await expectError(
    first.runtime.submit(envelope(submitCommand({ idempotencyKey: "key-a" })), scope),
    "ambiguous_submission",
    "possible"
  );
  const restarted = createHarness({
    sharedAttempts: first.state.attempts,
    authorizationAllowsReplay: true
  });
  await expectError(
    restarted.runtime.submit(envelope(submitCommand({ idempotencyKey: "key-b" })), scope),
    "ambiguous_submission",
    "possible"
  );
  assert.equal(first.state.budgetCalls.length, 1);
  assert.equal(first.state.transportCalls.length, 1);
  assert.equal(restarted.state.budgetCalls.length, 0);
  assert.equal(restarted.state.transportCalls.length, 0);
}]);

cases.push(["ambiguous budget reservation is durably blocked across restart and new keys", async () => {
  const first = createHarness({ authorizationAllowsReplay: true });
  first.dependencies.budgetClient.authorize = async (check) => {
    first.state.budgetCalls.push(check);
    throw Object.assign(new Error("reservation committed; response lost"), { name: "TimeoutError" });
  };
  await expectError(
    first.runtime.submit(envelope(submitCommand({ idempotencyKey: "budget-key-a" })), scope),
    "budget_unavailable",
    "not_dispatched"
  );
  assert.equal(first.state.attempts.values().next().value.budgetReservationState, "unknown");

  const restarted = createHarness({
    sharedAttempts: first.state.attempts,
    authorizationAllowsReplay: true
  });
  await expectError(
    restarted.runtime.submit(envelope(submitCommand({ idempotencyKey: "budget-key-b" })), scope),
    "reservation_unresolved",
    "not_dispatched"
  );
  assert.equal(first.state.budgetCalls.length, 1);
  assert.equal(first.state.transportCalls.length, 0);
  assert.equal(restarted.state.budgetCalls.length, 0);
  assert.equal(restarted.state.transportCalls.length, 0);
}]);

cases.push(["successful reservation is retained when provider code fails before dispatch", async () => {
  const { runtime, state, adapter } = createHarness({ authorizationAllowsReplay: true });
  adapter.submit = async () => { throw new Error("local provider mapping failure"); };
  await expectError(
    runtime.submit(envelope(submitCommand({ idempotencyKey: "reserved-key-a" })), scope),
    "provider_failure",
    "not_dispatched"
  );
  const attempt = state.attempts.values().next().value;
  assert.equal(attempt.budgetReservationState, "reserved");
  assert.equal(attempt.budgetReservationReference, "fixture-budget-reference");
  await expectError(
    runtime.submit(envelope(submitCommand({ idempotencyKey: "reserved-key-b" })), scope),
    "reservation_unresolved",
    "not_dispatched"
  );
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["retryable errors do not create spending authority", async () => {
  const { runtime, state } = createHarness({
    transportFailure: () => Object.assign(new Error("temporary"), { code: "ETIMEDOUT" })
  });
  let captured;
  try {
    await runtime.submit(envelope(submitCommand()), scope);
  } catch (error) {
    captured = error;
  }
  assert.ok(captured instanceof ConnectorError);
  assert.equal(captured.retryable, true);
  assert.equal(captured.toJSON().side_effect_state, "possible");
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.transportCalls.length, 1);
  assert.equal(state.attempts.values().next().value.sideEffectState, "possible");
}]);

cases.push(["sandbox mode fails before transport while accepted pins are absent", async () => {
  const { runtime, state } = createHarness({
    runtimeOptions: { mode: "sandbox", sandboxEnabled: true }
  });
  assert.equal(runtime.audit().sandboxReady, false);
  await expectError(
    runtime.quote(envelope({ productionBundle: {}, quantity: 1, destination: {} }), scope),
    "sandbox_disabled",
    "not_dispatched"
  );
  assert.equal(state.transportCalls.length, 0);
}]);

cases.push(["JavaScript live, unknown, and non-string modes reject before every injected boundary", async () => {
  for (const mode of ["live", "production", null, 7]) {
    const { state, adapter, dependencies, contractValidator } = createHarness({ runtimeOptions: { mode } });
    adapter.descriptor.supportedModes = [mode];
    dependencies.transport.mode = mode;
    const invalidRuntime = new FulfillmentConnectorRuntime(adapter, dependencies, { mode });
    await expectError(
      invalidRuntime.quote(envelope({ productionBundle: {}, quantity: 1, destination: {} }), scope),
      "mode_mismatch",
      "not_dispatched"
    );
    assert.equal(contractValidator.inboundCalls, 0);
    assert.equal(state.usagePayloads.length, 0);
    assert.equal(state.authorizationCalls.length, 0);
    assert.equal(state.budgetCalls.length, 0);
    assert.equal(state.adapterCalls.length, 0);
    assert.equal(state.transportCalls.length, 0);
  }
}]);

cases.push(["minor-unit amount must be an explicit positive safe integer", async () => {
  const { runtime, state } = createHarness();
  await expectError(runtime.submit(envelope(submitCommand({ amountMinor: 0 })), scope), "invalid_input", "not_dispatched");
  await expectError(runtime.submit(envelope(submitCommand({ amountMinor: Number.MAX_SAFE_INTEGER + 1 })), scope), "invalid_input", "not_dispatched");
  assert.equal(state.transportCalls.length, 0);
  assert.equal(state.authorizationCalls.length, 0);
  assert.equal(state.budgetCalls.length, 0);
}]);

function revalidatingHarness(answer, options = {}) {
  const harness = createHarness(options);
  const calls = [];
  harness.dependencies.authorizationVerifier.revalidateBeforeDispatch = async (check, claim) => {
    calls.push({ check, claim, order: [...harness.state.budgetCalls.map(() => "budget"), ...harness.state.transportCalls.map(() => "transport")] });
    return typeof answer === "function" ? answer(calls.length, check, claim) : answer;
  };
  return { ...harness, calls };
}

cases.push(["optional dispatch revalidation runs after budget and before the single transport request", async () => {
  const { runtime, state, calls } = revalidatingHarness({ status: "dispatchable" });
  await runtime.submit(envelope(submitCommand()), scope);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].order, ["budget"]);
  assert.equal(calls[0].claim.status, "claimed");
  assert.equal(calls[0].claim.claimReference, "fixture-submit-claim-1");
  assert.deepEqual(calls[0].check.facts.command.quote.quoteId, "quote-fixture-1");
  assert.ok(Object.isFrozen(calls[0].check));
  assert.equal(state.transportCalls.length, 1);
}]);

cases.push(["rejected dispatch revalidation sends nothing, is stale_authorization, and records the reserved budget state", async () => {
  const { runtime, state, calls } = revalidatingHarness({ status: "rejected" });
  await expectError(runtime.submit(envelope(submitCommand()), scope), "stale_authorization", "not_dispatched");
  assert.equal(calls.length, 1);
  assert.equal(state.transportCalls.length, 0);
  assert.equal(state.budgetCalls.length, 1);
  const [attempt] = [...state.attempts.values()];
  assert.equal(attempt.budgetReservationState, "reserved");
  assert.equal(attempt.sideEffectState, "not_dispatched");
}]);

cases.push(["throwing or malformed dispatch revalidation is authorization_unavailable with no transport", async () => {
  for (const answer of [() => { throw new Error("verifier down"); }, undefined, null, "dispatchable", { status: "ok" }, { status: " dispatchable" }, {}]) {
    const { runtime, state } = revalidatingHarness(answer);
    await expectError(runtime.submit(envelope(submitCommand()), scope), "authorization_unavailable", "not_dispatched");
    assert.equal(state.transportCalls.length, 0);
  }
}]);

cases.push(["dispatch revalidation runs before every adapter transport request including retries", async () => {
  const { runtime, adapter, state, calls } = revalidatingHarness((count) => ({ status: count < 3 ? "dispatchable" : "rejected" }));
  adapter.submit = async (command, context) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await context.transport.request({ operation: "submit", method: "POST", path: "/fixture/orders", body: command, idempotencyKey: command.idempotencyKey });
    }
    return { status: "supported", value: { providerRequestId: "request-fixture-1", acceptedAt: "2026-10-10T14:00:00.000Z" } };
  };
  await expectError(runtime.submit(envelope(submitCommand()), scope), "stale_authorization", "possible");
  assert.equal(calls.length, 3);
  assert.equal(state.transportCalls.length, 2);
  assert.deepEqual(calls.map((call) => call.order.filter((entry) => entry === "transport").length), [0, 1, 2]);
}]);

cases.push(["verifiers without dispatch revalidation, or with a non-function member, behave exactly as before", async () => {
  for (const member of [undefined, null, "dispatchable", {}]) {
    const harness = createHarness();
    if (member !== undefined) harness.dependencies.authorizationVerifier.revalidateBeforeDispatch = member;
    await harness.runtime.submit(envelope(submitCommand()), scope);
    assert.equal(harness.state.transportCalls.length, 1);
    assert.equal(harness.state.budgetCalls.length, 1);
  }
}]);

export async function runContractSuite() {
  const checks = [];
  for (const [name, run] of cases) {
    try {
      await run();
      checks.push({ id: name, status: "passed" });
    } catch (error) {
      checks.push({
        id: name,
        status: "failed",
        safeMessage: "The local contract fixture assertion failed."
      });
    }
  }
  return checks;
}
