/**
 * Synthetic Prodigi v4 HTTP fixtures shaped from the public API reference
 * (https://www.prodigi.com/print-api/docs/reference/, checked 2026-10-11).
 *
 * These are NOT recordings of real sandbox traffic: no request has been sent
 * to Prodigi from this repository. SKUs, IDs, names, addresses and keys are
 * placeholders. Replace or extend with sanitized recordings only after an
 * owner-approved sandbox read.
 */

export const FIXTURE_SANDBOX_KEY = "fixture-sandbox-key-not-real-0001";
export const FIXTURE_SKU = "poster-12x18";
export const FIXTURE_ORDER_ID = "ord_000000000000001";

export const fixtureDecision = Object.freeze({
  decisionReference: "decision:fixture-owner-approval-placeholder",
  sku: FIXTURE_SKU,
  destinationCountryCode: "US",
  shippingMethod: "Express"
});

/** Test-only verifier. A real verifier must resolve owner evidence externally. */
export function fixtureVerifier({ approve = true, calls } = {}) {
  return {
    async verify(request) {
      if (calls) calls.push(request);
      if (!approve) return undefined;
      return { ...request, productAndDestinationApproved: true, sandboxAccountAccessConfirmed: true };
    }
  };
}

export function quoteResponse(overrides = {}) {
  return {
    outcome: "Created",
    quotes: [
      {
        shipmentMethod: "Express",
        costSummary: {
          items: { amount: "20.00", currency: "USD" },
          shipping: { amount: "8.50", currency: "USD" },
          totalTax: { amount: "2.28", currency: "USD" },
          totalCost: { amount: "30.78", currency: "USD" },
          ...overrides.costSummary
        },
        shipments: [{
          carrier: { name: "FixtureCarrier", service: "Fixture Express" },
          fulfillmentLocation: { countryCode: "US", labCode: "fixture-lab" },
          cost: { amount: "8.50", currency: "USD" },
          items: ["qit_fixture1"]
        }],
        items: [{
          id: "qit_fixture1",
          sku: FIXTURE_SKU,
          copies: 25,
          unitCost: { amount: "0.80", currency: "USD" },
          attributes: {},
          assets: [{ printArea: "default" }]
        }],
        ...(overrides.quote ?? {})
      },
      ...(overrides.extraQuotes ?? [])
    ],
    ...(overrides.issues === undefined ? {} : { issues: overrides.issues }),
    traceParent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"
  };
}

export function orderResponse({ outcome = "Created", stage = "InProgress", details = {}, shipments = [], issues = [] } = {}) {
  return {
    outcome,
    order: {
      id: FIXTURE_ORDER_ID,
      created: "2026-10-10T10:31:00.000Z",
      lastUpdated: "2026-10-10T10:31:05.000Z",
      callbackUrl: null,
      merchantReference: "merchant-ref-fixture-1",
      shippingMethod: "Express",
      idempotencyKey: "idem-fixture-1",
      status: {
        stage,
        issues,
        details: {
          downloadAssets: "NotStarted",
          printReadyAssetsPrepared: "NotStarted",
          allocateProductionLocation: "NotStarted",
          inProduction: "NotStarted",
          shipping: "NotStarted",
          ...details
        }
      },
      charges: [],
      shipments,
      recipient: {
        name: "Fixture Recipient Name",
        email: null,
        phoneNumber: null,
        address: {
          line1: "1 Fixture Placeholder Way",
          line2: null,
          postalOrZipCode: "ZZ-FIXTURE-POSTAL",
          countryCode: "US",
          townOrCity: "Fixtureville",
          stateOrCounty: "CA"
        }
      },
      items: [{
        id: "ori_fixture1",
        status: "NotYetDownloaded",
        merchantReference: "item-ref-fixture-1",
        sku: FIXTURE_SKU,
        copies: 1,
        sizing: "fillPrintArea",
        attributes: {},
        assets: [{ id: "ast_fixture1", printArea: "default", md5Hash: null, url: "https://assets.example.invalid/fixture.png", status: "InProgress" }]
      }],
      packingSlip: null,
      metadata: {}
    },
    traceParent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"
  };
}

export function orderInput(overrides = {}) {
  return {
    merchantReference: "merchant-ref-fixture-1",
    idempotencyKey: "idem-fixture-1",
    shippingMethod: "express",
    recipient: {
      name: "Fixture Recipient Name",
      address: {
        line1: "1 Fixture Placeholder Way",
        postalOrZipCode: "ZZ-FIXTURE-POSTAL",
        countryCode: "US",
        townOrCity: "Fixtureville",
        stateOrCounty: "CA"
      }
    },
    items: [{
      merchantReference: "item-ref-fixture-1",
      sku: FIXTURE_SKU,
      copies: 1,
      sizing: "fillPrintArea",
      assets: [{ printArea: "default", url: "https://assets.example.invalid/fixture.png", md5Hash: "0".repeat(32) }]
    }],
    ...overrides
  };
}

/** Recording HTTP port. `responses` is a queue of { status, body } or functions. */
export function recordingHttp(responses) {
  const queue = [...responses];
  const calls = [];
  return {
    calls,
    port: {
      async send(request) {
        calls.push({ ...request, headers: { ...request.headers } });
        const next = queue.shift();
        if (next === undefined) throw new Error("unexpected request");
        if (typeof next === "function") return next(request);
        return { status: next.status ?? 200, bodyText: typeof next.body === "string" ? next.body : JSON.stringify(next.body) };
      }
    }
  };
}
