import { createHash } from "node:crypto";
import {
  ALL_SHARED_SHAPES,
  CONTRACT_OWNERSHIP,
  FulfillmentConnectorRuntime
} from "../dist/index.js";
import {
  createDeterministicSimulator,
  simulatorFixtureDigest,
  simulatorQuoteTermsFingerprint
} from "../dist/simulator.js";

export const MOCK_SCOPE = Object.freeze({ tenantId: "tenant-mock-fixture", projectId: "project-mock-fixture" });
export const MOCK_START_AT = "2026-10-10T14:00:00.000Z";
export const MOCK_BUNDLE = Object.freeze({ fixture: "development-only-production-bundle" });
export const MOCK_SPECIFICATION = Object.freeze({ fixture: "development-only-print-specification" });
export const MOCK_AUTHORIZATION = Object.freeze({ fixture: "development-only-authorization-envelope", mode: "simulated" });
export const MOCK_BINDING_LABEL = "development_fixture; local synthetic data; never an accepted upstream pin";

export function cloneFixture(value) {
  return JSON.parse(JSON.stringify(value));
}

export function hashFixture(value) {
  return `sha256:${createHash("sha256").update(stableJson(value), "utf8").digest("hex")}`;
}

function stableJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function keyFor(providerId, tenantId, projectId, idempotencyKey) {
  return `${providerId}/${tenantId}/${projectId}/${idempotencyKey}`;
}

function initialRuntimeStore() {
  return {
    format: "fc-mock-runtime-fixture/1",
    billingMode: "simulated",
    attempts: [],
    authorizationClaims: [],
    simulatedReservations: [],
    usageEvents: []
  };
}

function createPrivateDevelopmentContracts() {
  const bindings = new Map();
  for (const shape of ALL_SHARED_SHAPES) {
    const fixtureDigest = hashFixture({ label: MOCK_BINDING_LABEL, shape, version: "1.0.0" });
    bindings.set(shape, {
      shape,
      ...CONTRACT_OWNERSHIP[shape],
      state: "development_fixture",
      schemaVersion: "1.0.0",
      sourceRevision: "local-mock-suite-only",
      fixtureDigest
    });
  }

  return {
    binding(shape) {
      const binding = bindings.get(shape);
      if (binding === undefined) throw new Error("private development fixture binding missing");
      return binding;
    },
    async validateInbound(request) {
      const envelope = request.envelope;
      if (envelope === null || typeof envelope !== "object" || Array.isArray(envelope) ||
        envelope.tenantId !== request.trustedScope.tenantId || envelope.projectId !== request.trustedScope.projectId ||
        envelope.command === null || typeof envelope.command !== "object" || Array.isArray(envelope.command)) {
        return { ok: false, failure: { code: "invalid_input" } };
      }
      const receipts = request.requiredShapes.map((shape) => ({
        shape,
        schemaVersion: envelope.schemaVersions?.[shape] ?? bindings.get(shape).schemaVersion,
        tenantId: envelope.tenantId,
        projectId: envelope.projectId
      }));
      return { ok: true, value: envelope.command, receipts };
    },
    async validateOutbound(request) {
      const receipts = request.requiredShapes.map((shape) => ({
        shape,
        schemaVersion: bindings.get(shape).schemaVersion,
        tenantId: request.trustedScope.tenantId,
        projectId: request.trustedScope.projectId
      }));
      return { ok: true, value: request.value, receipts };
    }
  };
}

export function createMockHarness(options = {}) {
  const simulator = options.simulatorSnapshot === undefined
    ? createDeterministicSimulator({
        seed: options.seed ?? "fc02-mock-test-seed-v1",
        startAt: options.startAt ?? MOCK_START_AT,
        ...(options.faults === undefined ? {} : { faults: options.faults }),
        ...(options.unsupportedOperations === undefined ? {} : { unsupportedOperations: options.unsupportedOperations }),
        ...(options.quoteTtlMs === undefined ? {} : { quoteTtlMs: options.quoteTtlMs }),
        ...(options.idempotencyTtlMs === undefined ? {} : { idempotencyTtlMs: options.idempotencyTtlMs })
      })
    : createDeterministicSimulator({ snapshot: cloneFixture(options.simulatorSnapshot) });

  const store = cloneFixture(options.runtimeStore ?? initialRuntimeStore());
  if (store.format !== "fc-mock-runtime-fixture/1" || store.billingMode !== "simulated") {
    throw new TypeError("runtime fixture store is not a simulated development fixture");
  }
  const contracts = createPrivateDevelopmentContracts();
  const authorizationVerifier = {
    async verifyAndClaim(check) {
      if (options.authorizationAllowed === false || check.facts.mode !== "simulated" ||
        check.authorizationEnvelope?.fixture !== MOCK_AUTHORIZATION.fixture ||
        check.authorizationEnvelope?.mode !== "simulated") {
        return { status: "rejected" };
      }
      const scopeKey = `${check.facts.providerId}/${check.facts.trustedScope.tenantId}/${check.facts.trustedScope.projectId}/${check.facts.operation}`;
      const authorizationId = `sim-auth-${hashFixture(scopeKey).slice(7, 23)}`;
      const actionId = `sim-action-${hashFixture(scopeKey).slice(7, 23)}`;
      const claimReference = `sim-claim-${hashFixture({ scopeKey, authorizationId }).slice(7, 23)}`;
      store.authorizationClaims.push({ authorizationId, actionId, operation: check.facts.operation, mode: "simulated" });
      return { status: "claimed", authorizationId, actionId, claimReference };
    }
  };

  const persistence = {
    async getSubmitAttempt(providerId, scope, idempotencyKey) {
      return store.attempts.find((entry) => keyFor(providerId, entry.tenantId, entry.projectId, entry.idempotencyKey) ===
        keyFor(providerId, scope.tenantId, scope.projectId, idempotencyKey));
    },
    async claimSubmitAttempt(record) {
      const existingByKey = store.attempts.find((entry) => keyFor(entry.providerId, entry.tenantId, entry.projectId, entry.idempotencyKey) ===
        keyFor(record.providerId, record.tenantId, record.projectId, record.idempotencyKey));
      const existingByAction = store.attempts.find((entry) => entry.providerId === record.providerId &&
        entry.tenantId === record.tenantId && entry.projectId === record.projectId &&
        (entry.actionId === record.actionId || entry.authorizationId === record.authorizationId));
      const existing = existingByKey ?? existingByAction;
      if (existing !== undefined) return { claimed: false, existing };
      store.attempts.push(cloneFixture(record));
      return { claimed: true };
    },
    async saveSubmitAttempt(record) {
      const index = store.attempts.findIndex((entry) => entry.providerId === record.providerId &&
        entry.tenantId === record.tenantId && entry.projectId === record.projectId &&
        entry.idempotencyKey === record.idempotencyKey);
      if (index < 0 || store.attempts[index].claimId !== record.claimId) throw new Error("fixture claim owner mismatch");
      store.attempts[index] = cloneFixture(record);
    }
  };

  const budgetClient = {
    async authorize(check) {
      const request = check.contractPayload;
      const amountMinor = request?.amountMinor;
      const currency = request?.currency;
      const purpose = request?.purpose;
      const entry = { mode: "simulated", amountMinor, currency, purpose, outcome: options.budgetAllowed === false ? "denied" : "reserved" };
      store.simulatedReservations.push(entry);
      if (options.budgetFailure === true) throw new Error("local simulated reservation fixture unavailable");
      return {
        authorized: options.budgetAllowed !== false,
        reference: `sim-reservation-${hashFixture(entry).slice(7, 23)}`
      };
    }
  };

  const usageSink = {
    async record(contractPayload) {
      store.usageEvents.push(cloneFixture(contractPayload));
    }
  };

  const dependencies = {
    contracts,
    transport: simulator.transport,
    clock: simulator.clock,
    persistence,
    authorizationVerifier,
    budgetClient,
    usageSink
  };
  const runtime = new FulfillmentConnectorRuntime(simulator.adapter, dependencies, options.runtimeOptions);
  return {
    simulator,
    runtime,
    store,
    dependencies,
    contracts,
    snapshot() {
      return { simulator: simulator.snapshot(), runtimeStore: cloneFixture(store) };
    }
  };
}

export function envelope(command, scope = MOCK_SCOPE, extra = {}) {
  return { tenantId: scope.tenantId, projectId: scope.projectId, command, ...extra };
}

export function makeQuoteCommand(bundle = MOCK_BUNDLE, destination = { fixture: "synthetic-destination" }, quantity = 1) {
  return { productionBundle: bundle, quantity, destination };
}

export function makeSubmitCommand(quoteResult, bundle = MOCK_BUNDLE, overrides = {}) {
  const productionBundleDigest = simulatorFixtureDigest(bundle);
  const quote = {
    quoteId: quoteResult.providerQuoteId,
    currency: quoteResult.currency,
    totalMinor: quoteResult.totalMinor,
    expiresAt: quoteResult.expiresAt,
    productionBundleDigest,
    termsFingerprint: simulatorQuoteTermsFingerprint({
      providerQuoteId: quoteResult.providerQuoteId,
      totalMinor: quoteResult.totalMinor,
      currency: quoteResult.currency,
      expiresAt: quoteResult.expiresAt,
      productionBundleDigest
    })
  };
  return {
    productionBundle: bundle,
    productionBundleDigest,
    quote,
    authorizationEnvelope: MOCK_AUTHORIZATION,
    amountMinor: quoteResult.totalMinor,
    currency: quoteResult.currency,
    idempotencyKey: "mock-provider-key-1",
    requestFingerprint: "mock-request-fingerprint-1",
    ...overrides
  };
}
