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
  return {
    bindings,
    binding(shape) {
      if (options.throwBindingFor === shape) throw new Error("private fixture binding lookup failed");
      const binding = bindings.get(shape);
      if (binding === undefined) throw new Error("private fixture binding missing");
      return binding;
    },
    async validateInbound(request) {
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
    attempts: new Map(),
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
        if (existing !== undefined && existing.sideEffectState !== "not_dispatched") {
          return { claimed: false, existing };
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
      async verify(check) {
        state.authorizationCalls.push(check);
        return { authorized: options.authorizationAllowed !== false };
      }
    },
    budgetClient: {
      async authorize(check) {
        state.budgetCalls.push(check);
        return { authorized: options.budgetAllowed !== false, reference: "fixture-budget-reference" };
      }
    },
    usageSink: {
      async record(contractPayload) {
        state.usagePayloads.push(contractPayload);
      }
    }
  };
  const runtime = new FulfillmentConnectorRuntime(adapter, dependencies, options.runtimeOptions);
  return { runtime, state, contractValidator };
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
  assert.equal(state.usagePayloads.length, 14);
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

cases.push(["budget denial rejects before provider transport", async () => {
  const { runtime, state } = createHarness({ budgetAllowed: false });
  await expectError(runtime.submit(envelope(submitCommand()), scope), "budget_denied", "not_dispatched");
  assert.equal(state.authorizationCalls.length, 1);
  assert.equal(state.budgetCalls.length, 1);
  assert.equal(state.transportCalls.length, 0);
  assert.equal(state.attempts.values().next().value.sideEffectState, "not_dispatched");
}]);

cases.push(["dispatch usage is accepted before budget reservation", async () => {
  const { runtime, state } = createHarness({ contracts: { rejectOutboundShape: "fulfillment_usage" } });
  await expectError(runtime.submit(envelope(submitCommand()), scope), "invalid_input", "not_dispatched");
  assert.equal(state.usagePayloads.length, 0);
  assert.equal(state.authorizationCalls.length, 1);
  assert.equal(state.budgetCalls.length, 0);
  assert.equal(state.transportCalls.length, 0);
  assert.equal(state.attempts.values().next().value.sideEffectState, "not_dispatched");
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

cases.push(["minor-unit amount must be an explicit positive safe integer", async () => {
  const { runtime, state } = createHarness();
  await expectError(runtime.submit(envelope(submitCommand({ amountMinor: 0 })), scope), "invalid_input", "not_dispatched");
  await expectError(runtime.submit(envelope(submitCommand({ amountMinor: Number.MAX_SAFE_INTEGER + 1 })), scope), "invalid_input", "not_dispatched");
  assert.equal(state.transportCalls.length, 0);
  assert.equal(state.authorizationCalls.length, 0);
  assert.equal(state.budgetCalls.length, 0);
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
