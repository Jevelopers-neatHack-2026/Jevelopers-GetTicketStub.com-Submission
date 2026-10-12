import { catalogA, catalogB, copyCatalog, selectionFor } from "./catalog-fixtures.mjs";

export const quoteScope = Object.freeze({ tenantId: "tenant:fixture-a", projectId: "project:fixture-a" });
export const destinationReference = "destination:fixture-a";
export const destinationDigest = `sha256:${"a".repeat(64)}`;

export async function requestFor(catalogInput = copyCatalog(catalogA), overrides = {}) {
  const snapshot = await (await import("../dist/catalog.js")).normalizeCatalogSnapshot(catalogInput);
  return {
    catalogSource: catalogInput,
    selection: selectionFor(snapshot),
    quantity: 25,
    destinationReference,
    destinationDigest,
    ...overrides
  };
}

export function providerQuote(overrides = {}) {
  return {
    providerQuoteReference: "provider-quote:fixture-1",
    currency: "USD",
    currencyScale: 2,
    breakdown: {
      production: { state: "known", decimal: "12.50" },
      shipping: { state: "known", decimal: "3" },
      tax: { state: "known", decimal: "1.55" },
      fee: { state: "known", decimal: "0.25" }
    },
    taxBasis: "excluded",
    total: { state: "known", decimal: "17.30" },
    providerExpiry: { state: "known", validUntil: "2026-10-10T10:35:00.000Z" },
    leadTime: { state: "known", minimumDays: 3, maximumDays: 6 },
    warnings: ["Fixture shipping estimate may change before purchase."],
    providerNotes: ["Fixture quote includes the selected finish."],
    ...overrides
  };
}

export function contractValidator(overrides = {}) {
  const receipts = [];
  return {
    receipts,
    binding(shape) {
      if (shape !== "fulfillment_quote") return { shape, ownerRepository: "shared-contracts", upstreamIssue: "#25", state: "missing" };
      return {
        shape,
        ownerRepository: "shared-contracts",
        upstreamIssue: "#25",
        state: "development_fixture",
        schemaVersion: "0.1.0",
        fixtureDigest: "sha256:quote-fixture-only",
        ...overrides.binding
      };
    },
    async validateInbound() {
      throw new Error("quote path must not decode an order envelope");
    },
    async validateOutbound(request) {
      receipts.push(request);
      if (overrides.validateOutbound) return overrides.validateOutbound(request);
      const total = request.value.breakdown.total;
      return {
        ok: true,
        value: {
          quote_reference: request.value.quoteId,
          provider_reference: request.value.providerQuoteReference,
          created_at: request.value.createdAt,
          valid_until: request.value.expiry.effectiveValidUntil,
          currency: request.value.currency,
          total_amount: total.state === "known" ? total.value.decimal : null,
          total_minor_units: total.state === "known" ? total.value.minorUnits : null,
          test_boundary: "fixture-only"
        },
        receipts: [{
          shape: "fulfillment_quote",
          schemaVersion: "0.1.0",
          tenantId: request.trustedScope.tenantId,
          projectId: request.trustedScope.projectId
        }]
      };
    }
  };
}

export function quoteHarness(overrides = {}) {
  const calls = { quote: 0, order: 0, request: undefined, signal: undefined };
  const response = overrides.response ?? providerQuote();
  const port = {
    async quote(request, context) {
      calls.quote += 1;
      calls.request = request;
      calls.signal = context.signal;
      if (overrides.quote) return overrides.quote(request, context);
      return structuredClone(response);
    },
    async submit() {
      calls.order += 1;
      throw new Error("order submission is outside the quote port");
    }
  };
  const contracts = overrides.contracts ?? contractValidator();
  let now = overrides.now === undefined
    ? Date.parse("2026-10-10T10:30:00.000Z")
    : typeof overrides.now === "string" ? Date.parse(overrides.now) : overrides.now;
  const clock = { now: () => now };
  return {
    calls,
    port,
    contracts,
    clock,
    setNow(value) { now = typeof value === "string" ? Date.parse(value) : value; },
    dependencies: {
      quotePort: port,
      contracts,
      clock,
      trustedScope: overrides.scope ?? quoteScope,
      ...(overrides.policy === undefined ? {} : { policy: overrides.policy })
    }
  };
}

export { catalogA, catalogB, copyCatalog, selectionFor };
