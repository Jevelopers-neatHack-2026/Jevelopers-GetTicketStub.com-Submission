import { executePrivateQuote } from "../dist/quotes.js";
import { contractValidator, copyCatalog, destinationDigest, destinationReference, providerQuote, quoteHarness, quoteScope, requestFor } from "./quote-fixtures.mjs";

export const comparisonScope = Object.freeze({ tenantId: "tenant:comparison", projectId: "project:comparison" });
export const comparisonNow = Date.parse("2026-10-10T10:30:00.000Z");
export const comparisonDependencies = {
  trustedScope: comparisonScope,
  clock: { now: () => comparisonNow }
};

export function sameBasisCatalog(providerId = "fixture-provider-alpha") {
  const catalog = copyCatalog();
  const slug = providerId.endsWith("alpha") ? "alpha" : providerId.endsWith("beta") ? "beta" : "gamma";
  catalog.providerId = providerId;
  catalog.apiVersion = "fixture-api-" + slug;
  catalog.catalogVersion = slug + "-r1";
  catalog.source.reference = "fixture:" + slug + "/catalog";
  catalog.source.revision = "revision:" + slug + "-1";
  catalog.source.evidenceReference = "fixture:" + slug + ":catalog-v1";
  catalog.products[0].sku = "poster-" + slug;
  catalog.products[0].variantId = "matte-" + slug;
  if (slug !== "alpha") catalog.products[0].constraints.materials.value.push("paper-250gsm");
  return catalog;
}

function fixtureContracts() {
  return contractValidator({
    async validateOutbound(request) {
      return {
        ok: true,
        value: { quote_reference: request.value.quoteId },
        receipts: [{
          shape: "fulfillment_quote",
          schemaVersion: "0.1.0",
          tenantId: request.trustedScope.tenantId,
          projectId: request.trustedScope.projectId
        }]
      };
    }
  });
}

export async function makeQuote({
  catalog = sameBasisCatalog(),
  providerId,
  scope = comparisonScope,
  quantity = 25,
  options = ["matte"],
  materials = ["paper-200gsm"],
  destination = { reference: destinationReference, digest: destinationDigest, countryCode: "US", regionCode: "CA" },
  shippingMethod = "express",
  selectionOverrides = {},
  quoteOverrides = {},
  now = comparisonNow
} = {}) {
  if (providerId !== undefined) catalog.providerId = providerId;
  const request = await requestFor(catalog, {
    quantity,
    destinationReference: destination.reference,
    destinationDigest: destination.digest
  });
  request.selection = {
    ...request.selection,
    options: [...options],
    materials: [...materials],
    destination: {
      countryCode: destination.countryCode,
      ...(destination.regionCode === undefined ? {} : { regionCode: destination.regionCode })
    },
    shippingMethod,
    ...selectionOverrides
  };
  const contracts = fixtureContracts();
  const harness = quoteHarness({
    response: providerQuote(quoteOverrides),
    scope,
    now,
    contracts
  });
  const response = await executePrivateQuote(request, harness.dependencies);
  return { quote: response.quote, currentInput: structuredClone(request), harness, contracts, response };
}

export function makeUnknownAmounts() {
  return {
    currency: "USD",
    currencyScale: 2,
    breakdown: {
      production: { state: "unknown", reasonCode: "not_disclosed" },
      shipping: { state: "known", decimal: "3.00" },
      tax: { state: "unknown", reasonCode: "not_provided" },
      fee: { state: "known", decimal: "0.25" }
    },
    taxBasis: "unknown",
    total: { state: "unknown", reasonCode: "provider_unspecified" },
    providerExpiry: { state: "unknown", reasonCode: "not_disclosed" },
    leadTime: { state: "unknown", reasonCode: "outside_scope" }
  };
}

export function quoteFixtureScope() {
  return quoteScope;
}
