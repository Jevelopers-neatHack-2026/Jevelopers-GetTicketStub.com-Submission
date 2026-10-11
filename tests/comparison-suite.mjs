import assert from "node:assert/strict";
import net from "node:net";
import { comparePrivateQuotes } from "../dist/comparison.js";
import {
  comparisonDependencies,
  comparisonNow,
  comparisonScope,
  makeQuote,
  makeUnknownAmounts,
  sameBasisCatalog
} from "./comparison-fixtures.mjs";

const cases = [];
const add = (name, run) => cases.push([name, run]);
const inputOf = (...entries) => ({ entries: entries.map(({ quote, currentInput }) => ({ quote, currentInput })) });

function dependencyAt(now) {
  return { trustedScope: comparisonScope, clock: { now: () => now } };
}

function assertNoChoiceFields(result) {
  assert.equal(Object.hasOwn(result, "winner"), false);
  assert.equal(Object.hasOwn(result, "selectedQuote"), false);
  assert.equal(Object.hasOwn(result, "ranking"), false);
}

async function assertEligibleBasisDifference(alpha, beta, label) {
  assert.ok(beta.quote, label + ": fixture must produce a valid quote");
  const before = JSON.stringify({ alphaQuote: alpha.quote, alphaInput: alpha.currentInput, betaQuote: beta.quote, betaInput: beta.currentInput });
  const result = await comparePrivateQuotes(inputOf(alpha, beta), comparisonDependencies);
  assert.equal(result.status, "not_comparable", label);
  assert.deepEqual(result.entries.map((entry) => entry.currentness.status), ["current", "current"], label + ": both quotes remain current");
  assert.deepEqual(result.entries.map((entry) => entry.capabilityFit.status), ["eligible", "eligible"], label + ": both selections remain eligible");
  assert.ok(result.reasons.includes("product_basis_differs"), label + ": selected production basis difference is explicit");
  assert.equal(JSON.stringify({ alphaQuote: alpha.quote, alphaInput: alpha.currentInput, betaQuote: beta.quote, betaInput: beta.currentInput }), before,
    label + ": source quotes and selections remain unchanged");
  return result;
}

async function positiveLoopbackControl() {
  const server = net.createServer((socket) => socket.end("ok"));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const response = await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: "127.0.0.1", port: address.port });
      let received = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => { received += chunk; });
      socket.once("end", () => resolve(received));
      socket.once("error", reject);
    });
    assert.equal(response, "ok");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function deniedNetworkControl() {
  const socket = net.createConnection({ host: "127.0.0.1", port: 9 });
  const error = await new Promise((resolve) => socket.once("error", resolve));
  assert.equal(error?.code, "EPERM");
}

add("same-basis quotes from distinct synthetic providers preserve exact facts without ranking", async () => {
  const alpha = await makeQuote({
    catalog: sameBasisCatalog("fixture-provider-alpha"),
    quoteOverrides: { providerQuoteReference: "provider-quote:alpha" }
  });
  const beta = await makeQuote({
    catalog: sameBasisCatalog("fixture-provider-beta"),
    quoteOverrides: {
      providerQuoteReference: "provider-quote:beta",
      currencyScale: 3,
      breakdown: {
        production: { state: "known", decimal: "13.125" },
        shipping: { state: "known", decimal: "2.500" },
        tax: { state: "known", decimal: "1.500" },
        fee: { state: "known", decimal: "0.375" }
      },
      total: { state: "known", decimal: "17.500" }
    }
  });
  const alphaBefore = JSON.stringify({ quote: alpha.quote, input: alpha.currentInput });
  const betaBefore = JSON.stringify({ quote: beta.quote, input: beta.currentInput });
  const effectsBefore = [alpha.harness.calls.quote, alpha.harness.calls.order, alpha.contracts.receipts.length,
    beta.harness.calls.quote, beta.harness.calls.order, beta.contracts.receipts.length];

  const result = await comparePrivateQuotes(inputOf(alpha, beta), comparisonDependencies);
  const singleQuote = await comparePrivateQuotes(inputOf(alpha), comparisonDependencies);
  assert.equal(singleQuote.status, "not_comparable");
  assert.deepEqual(singleQuote.reasons, ["at_least_two_quotes_required"]);
  assert.equal(result.status, "comparable");
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.entries.map((entry) => entry.index), [0, 1]);
  assert.deepEqual(result.entries.map((entry) => entry.currentness.status), ["current", "current"]);
  assert.deepEqual(result.entries.map((entry) => entry.capabilityFit.status), ["eligible", "eligible"]);
  assert.deepEqual(result.entries.map((entry) => entry.regionSuitability), ["eligible", "eligible"]);
  assert.equal(result.entries[0].sourceReferences.providerId, "fixture-provider-alpha");
  assert.equal(result.entries[1].sourceReferences.providerId, "fixture-provider-beta");
  assert.notEqual(result.entries[0].sourceReferences.sku, result.entries[1].sourceReferences.sku);
  assert.notEqual(result.entries[0].sourceReferences.specIdentity, result.entries[1].sourceReferences.specIdentity);
  assert.equal(result.entries[0].terms.currencyScale, 2);
  assert.equal(result.entries[0].terms.breakdown.total.value.decimal, "17.30");
  assert.equal(result.entries[1].terms.currencyScale, 3);
  assert.equal(result.entries[1].terms.breakdown.total.value.decimal, "17.500");
  assert.equal(result.entries[1].terms.breakdown.total.value.minorUnits, "17500");
  assert.equal(result.entries[0].terms.leadTime.confidence, "estimate");
  assert.deepEqual(result.entries[0].terms.warnings, alpha.quote.warnings);
  assert.equal(result.entries[0].terms.financialEffect, "quote_only");
  assert.equal(result.financialEffect, "quote_only");
  assert.equal(result.projectionOnly, true);
  assertNoChoiceFields(result);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.entries[0].terms.breakdown.total.value), true);
  assert.equal(JSON.stringify({ quote: alpha.quote, input: alpha.currentInput }), alphaBefore);
  assert.equal(JSON.stringify({ quote: beta.quote, input: beta.currentInput }), betaBefore);
  assert.deepEqual([
    alpha.harness.calls.quote, alpha.harness.calls.order, alpha.contracts.receipts.length,
    beta.harness.calls.quote, beta.harness.calls.order, beta.contracts.receipts.length
  ], effectsBefore);
});

add("currency, quantity, option, material, destination, shipping, tax, and validity basis differences are explicit", async () => {
  const alpha = await makeQuote({
    catalog: sameBasisCatalog("fixture-provider-alpha"),
    quoteOverrides: { providerQuoteReference: "provider-quote:alpha" }
  });
  const beta = await makeQuote({
    catalog: sameBasisCatalog("fixture-provider-beta"),
    quantity: 26,
    options: ["gloss"],
    materials: ["paper-250gsm"],
    destination: {
      reference: "destination:fixture-beta",
      digest: "sha256:" + "b".repeat(64),
      countryCode: "US",
      regionCode: "CA"
    },
    shippingMethod: "standard",
    quoteOverrides: {
      providerQuoteReference: "provider-quote:beta",
      currency: "EUR",
      currencyScale: 2,
      breakdown: {
        production: { state: "known", decimal: "12.50" },
        shipping: { state: "known", decimal: "3.00" },
        tax: { state: "known", decimal: "1.55" },
        fee: { state: "known", decimal: "0.25" }
      },
      taxBasis: "included",
      total: { state: "known", decimal: "15.75" },
      providerExpiry: { state: "known", validUntil: "2026-10-10T10:34:00.000Z" }
    }
  });
  const result = await comparePrivateQuotes(inputOf(alpha, beta), comparisonDependencies);
  assert.equal(result.status, "not_comparable");
  for (const reason of [
    "currency_differs", "quantity_differs", "options_differ", "materials_differ",
    "destination_binding_differs", "shipping_method_differs", "tax_basis_differs", "validity_differs"
  ]) assert.ok(result.reasons.includes(reason), reason);
  assert.deepEqual(result.entries.map((entry) => entry.currentness.status), ["current", "current"]);
  assert.equal(result.entries[1].terms.currency, "EUR");
  assert.equal(result.entries[1].terms.breakdown.taxBasis, "included");
  assert.equal(result.entries[1].terms.expiry.effectiveValidUntil, "2026-10-10T10:34:00.000Z");
  assert.equal(result.entries[1].sourceReferences.quantity, 26);
  assert.deepEqual(result.entries[1].sourceReferences.options, ["gloss"]);
  assert.deepEqual(result.entries[1].sourceReferences.materials, ["paper-250gsm"]);
  assert.deepEqual(result.entries.map((entry) => entry.capabilityFit.status), ["eligible", "eligible"]);
  assert.ok(result.reasons.includes("product_basis_differs"));
  assert.ok(result.reasons.includes("options_differ"));
  assert.ok(result.reasons.includes("materials_differ"));
  assertNoChoiceFields(result);
});

add("normalized selected production facts require a matching basis across providers", async () => {
  const alpha = await makeQuote({ catalog: sameBasisCatalog("fixture-provider-alpha") });
  const equivalentCatalog = sameBasisCatalog("fixture-provider-beta");
  equivalentCatalog.products[0].constraints.dimensions.value = {
    width: "30.48", height: "45.72", depth: "0.03", unit: "cm"
  };
  const equivalent = await makeQuote({
    catalog: equivalentCatalog,
    selectionOverrides: { dimensions: { width: "30.48", height: "45.72", depth: "0.03", unit: "cm" } }
  });
  assert.ok(equivalent.quote);
  const equivalentBefore = JSON.stringify({ quote: equivalent.quote, input: equivalent.currentInput });
  const sameBasis = await comparePrivateQuotes(inputOf(alpha, equivalent), comparisonDependencies);
  assert.equal(sameBasis.status, "comparable", "exactly equivalent dimensions expressed in different units remain comparable");
  assert.deepEqual(sameBasis.entries.map((entry) => entry.currentness.status), ["current", "current"]);
  assert.deepEqual(sameBasis.entries.map((entry) => entry.capabilityFit.status), ["eligible", "eligible"]);
  assert.equal(JSON.stringify({ quote: equivalent.quote, input: equivalent.currentInput }), equivalentBefore);

  const cases = [
    ["width", (catalog) => { catalog.products[0].constraints.dimensions.value.width = "300"; },
      { dimensions: { width: "300", height: "457.2", depth: "0.3", unit: "mm" } }],
    ["height", (catalog) => { catalog.products[0].constraints.dimensions.value.height = "450"; },
      { dimensions: { width: "304.8", height: "450", depth: "0.3", unit: "mm" } }],
    ["depth", (catalog) => { catalog.products[0].constraints.dimensions.value.depth = "0.4"; },
      { dimensions: { width: "304.8", height: "457.2", depth: "0.4", unit: "mm" } }],
    ["selected surface", (catalog) => { catalog.products[0].constraints.surfaces.value.push("back"); },
      { surface: "back" }],
    ["personalization", () => {}, { personalization: null }],
    ["bleed", () => {}, { bleed: { top: "4", right: "3", bottom: "3", left: "3", unit: "mm" } }],
    ["safe area", () => {}, { safeArea: { top: "6", right: "5", bottom: "5", left: "5", unit: "mm" } }],
    ["resolution", () => {}, { effectiveResolutionDpi: 600 }],
    ["file type", () => {}, { fileType: "image/png" }],
    ["file count", () => {}, { fileCount: 2 }],
    ["color space", (catalog) => { catalog.products[0].constraints.color.value.spaces.push("RGB"); },
      { colorSpace: "RGB" }],
    ["color profile", (catalog) => { catalog.products[0].constraints.color.value.profiles.push("fixture-coated-v2"); },
      { colorProfile: "fixture-coated-v2" }]
  ];

  for (const [label, mutateCatalog, selectionOverrides] of cases) {
    const catalog = sameBasisCatalog("fixture-provider-beta");
    mutateCatalog(catalog);
    const beta = await makeQuote({ catalog, selectionOverrides });
    await assertEligibleBasisDifference(alpha, beta, label);
  }

  const unknownBasisQuote = await makeQuote({ catalog: sameBasisCatalog("fixture-provider-beta") });
  const unknownBasisInput = structuredClone(unknownBasisQuote.currentInput);
  unknownBasisInput.catalogSource.products[0].constraints.dimensions = { state: "unknown", reasonCode: "not_in_source" };
  const unknownBasis = await comparePrivateQuotes(inputOf(alpha, {
    quote: unknownBasisQuote.quote,
    currentInput: unknownBasisInput
  }), comparisonDependencies);
  assert.equal(unknownBasis.status, "not_comparable");
  assert.ok(unknownBasis.reasons.includes("product_basis_unknown"));
  assert.notEqual(unknownBasis.entries[1].currentness.status, "current");
});

add("reordered selected option and material sets compare without changing source order", async () => {
  const alphaCatalog = sameBasisCatalog("fixture-provider-alpha");
  alphaCatalog.products[0].constraints.materials.value.push("paper-250gsm");
  const alpha = await makeQuote({
    catalog: alphaCatalog,
    options: ["matte", "gloss"],
    materials: ["paper-200gsm", "paper-250gsm"]
  });
  const beta = await makeQuote({
    catalog: sameBasisCatalog("fixture-provider-beta"),
    options: ["gloss", "matte"],
    materials: ["paper-250gsm", "paper-200gsm"]
  });
  const before = JSON.stringify({ alphaQuote: alpha.quote, alphaInput: alpha.currentInput, betaQuote: beta.quote, betaInput: beta.currentInput });
  const originalQuoteIds = [alpha.quote.quoteId, beta.quote.quoteId];
  const result = await comparePrivateQuotes(inputOf(alpha, beta), comparisonDependencies);
  assert.equal(result.status, "comparable");
  assert.deepEqual(result.reasons, []);
  assert.deepEqual(result.entries.map((entry) => entry.capabilityFit.status), ["eligible", "eligible"]);
  assert.deepEqual(result.entries[0].sourceReferences.options, ["matte", "gloss"]);
  assert.deepEqual(result.entries[1].sourceReferences.options, ["gloss", "matte"]);
  assert.deepEqual(result.entries[0].sourceReferences.materials, ["paper-200gsm", "paper-250gsm"]);
  assert.deepEqual(result.entries[1].sourceReferences.materials, ["paper-250gsm", "paper-200gsm"]);
  assert.deepEqual([result.entries[0].sourceReferences.quoteId, result.entries[1].sourceReferences.quoteId], originalQuoteIds);
  assert.equal(result.entries[0].terms.breakdown.total.value.decimal, alpha.quote.breakdown.total.value.decimal);
  assert.equal(result.entries[1].terms.breakdown.total.value.decimal, beta.quote.breakdown.total.value.decimal);
  assert.equal(JSON.stringify({ alphaQuote: alpha.quote, alphaInput: alpha.currentInput, betaQuote: beta.quote, betaInput: beta.currentInput }), before);
});

add("known zero and large exact money stay distinct from unknown amounts", async () => {
  const zero = await makeQuote({
    catalog: sameBasisCatalog("fixture-provider-alpha"),
    quoteOverrides: {
      providerQuoteReference: "provider-quote:zero",
      breakdown: {
        production: { state: "known", decimal: "0.00" },
        shipping: { state: "known", decimal: "0.00" },
        tax: { state: "known", decimal: "0.00" },
        fee: { state: "known", decimal: "0.00" }
      },
      total: { state: "known", decimal: "0.00" }
    }
  });
  const zeroPeer = await makeQuote({
    catalog: sameBasisCatalog("fixture-provider-beta"),
    quoteOverrides: {
      providerQuoteReference: "provider-quote:zero-peer",
      breakdown: {
        production: { state: "known", decimal: "0.000" },
        shipping: { state: "known", decimal: "0.000" },
        tax: { state: "known", decimal: "0.000" },
        fee: { state: "known", decimal: "0.000" }
      },
      currencyScale: 3,
      total: { state: "known", decimal: "0.000" }
    }
  });
  const zeroResult = await comparePrivateQuotes(inputOf(zero, zeroPeer), comparisonDependencies);
  assert.equal(zeroResult.status, "comparable", "different exact scales alone do not change the currency basis");
  assert.equal(zeroResult.entries[0].terms.breakdown.total.value.decimal, "0.00");
  assert.equal(zeroResult.entries[0].terms.breakdown.total.value.minorUnits, "0");
  assert.equal(zeroResult.entries[1].terms.breakdown.total.value.decimal, "0.000");
  assert.equal(zeroResult.entries[1].terms.breakdown.total.value.minorUnits, "0");
  assert.equal(zeroResult.entries[0].terms.breakdown.total.state, "known");

  const unknown = await makeQuote({
    catalog: sameBasisCatalog("fixture-provider-gamma"),
    quoteOverrides: { ...makeUnknownAmounts(), providerQuoteReference: "provider-quote:unknown" }
  });
  const large = await makeQuote({
    catalog: sameBasisCatalog("fixture-provider-beta"),
    quoteOverrides: {
      providerQuoteReference: "provider-quote:large",
      currencyScale: 6,
      breakdown: {
        production: { state: "known", decimal: "99999999999999.123456" },
        shipping: { state: "known", decimal: "0.000001" },
        tax: { state: "known", decimal: "0.000001" },
        fee: { state: "known", decimal: "0.000001" }
      },
      total: { state: "known", decimal: "99999999999999.123459" }
    }
  });
  const unknownResult = await comparePrivateQuotes(inputOf(unknown, large), comparisonDependencies);
  assert.equal(unknownResult.status, "not_comparable");
  for (const reason of ["quote_incomplete", "amount_unknown", "tax_basis_unknown", "provider_expiry_unknown", "lead_time_unknown"]) {
    assert.ok(unknownResult.reasons.includes(reason), reason);
  }
  assert.equal(unknownResult.entries[0].terms.breakdown.production.state, "unknown");
  assert.equal(unknownResult.entries[0].terms.breakdown.production.reasonCode, "not_disclosed");
  assert.equal(unknownResult.entries[1].terms.breakdown.total.value.decimal, "99999999999999.123459");
  assert.equal(unknownResult.entries[1].terms.breakdown.total.value.minorUnits, "99999999999999123459");
});

add("changed, expired, and malformed quote inputs cannot be marked current or comparable", async () => {
  const alpha = await makeQuote({ catalog: sameBasisCatalog("fixture-provider-alpha") });
  const beta = await makeQuote({ catalog: sameBasisCatalog("fixture-provider-beta") });
  const changedInput = structuredClone(alpha.currentInput);
  changedInput.selection.options = ["gloss"];
  const changed = await comparePrivateQuotes({
    entries: [{ quote: alpha.quote, currentInput: changedInput }, { quote: beta.quote, currentInput: beta.currentInput }]
  }, comparisonDependencies);
  assert.equal(changed.status, "not_comparable");
  assert.equal(changed.entries[0].currentness.status, "stale");
  assert.ok(changed.reasons.includes("quote_not_current"));

  const expired = await comparePrivateQuotes(inputOf(alpha, beta), dependencyAt(Date.parse("2026-10-10T10:35:00.000Z")));
  assert.equal(expired.status, "not_comparable");
  assert.deepEqual(expired.entries.map((entry) => entry.currentness.status), ["stale", "stale"]);
  assert.ok(expired.reasons.includes("quote_not_current"));

  const forged = structuredClone(alpha.quote);
  forged.breakdown.total.value.decimal = "0.01";
  forged.breakdown.total.value.minorUnits = "1";
  const invalid = await comparePrivateQuotes({
    entries: [{ quote: forged, currentInput: alpha.currentInput }, { quote: beta.quote, currentInput: beta.currentInput }]
  }, comparisonDependencies);
  assert.equal(invalid.status, "not_comparable");
  assert.equal(invalid.entries[0].currentness.status, "invalid");
  assert.equal(Object.hasOwn(invalid.entries[0], "sourceReferences"), false);
  assert.equal(Object.hasOwn(invalid.entries[0], "terms"), false);
  assert.ok(invalid.reasons.includes("quote_invalid"));
});

add("catalog capability and region outcomes are recalculated; foreign-scope facts are withheld", async () => {
  const alpha = await makeQuote({ catalog: sameBasisCatalog("fixture-provider-alpha") });
  const beta = await makeQuote({ catalog: sameBasisCatalog("fixture-provider-beta") });
  const unsupportedInput = structuredClone(alpha.currentInput);
  unsupportedInput.selection.destination.regionCode = "FL";
  const unsupported = await comparePrivateQuotes({
    entries: [{ quote: alpha.quote, currentInput: unsupportedInput }, { quote: beta.quote, currentInput: beta.currentInput }]
  }, comparisonDependencies);
  assert.equal(unsupported.status, "not_comparable");
  assert.equal(unsupported.entries[0].regionSuitability, "unsupported");
  assert.equal(unsupported.entries[0].capabilityFit.status, "ineligible");
  assert.ok(unsupported.reasons.includes("region_not_eligible"));

  const unknownCatalog = sameBasisCatalog("fixture-provider-alpha");
  unknownCatalog.products[0].constraints.destinations.value[0].regions = {
    state: "unknown",
    reasonCode: "not_in_source"
  };
  const unknownInput = await (async () => {
    const input = structuredClone(alpha.currentInput);
    input.catalogSource = unknownCatalog;
    const snapshot = await (await import("../dist/catalog.js")).normalizeCatalogSnapshot(unknownCatalog);
    const { selectionFor } = await import("./catalog-fixtures.mjs");
    input.selection = selectionFor(snapshot);
    input.selection.destination = { countryCode: "US", regionCode: "CA" };
    input.selection.shippingMethod = "express";
    return input;
  })();
  const unknownRegion = await comparePrivateQuotes({
    entries: [{ quote: alpha.quote, currentInput: unknownInput }, { quote: beta.quote, currentInput: beta.currentInput }]
  }, comparisonDependencies);
  assert.equal(unknownRegion.entries[0].regionSuitability, "unknown");
  assert.equal(unknownRegion.entries[0].capabilityFit.status, "ineligible");
  assert.equal(unknownRegion.status, "not_comparable");

  const foreignScope = { tenantId: "tenant:foreign-private-marker", projectId: "project:foreign-private-marker" };
  const foreign = await makeQuote({
    catalog: sameBasisCatalog("fixture-provider-foreign"),
    scope: foreignScope,
    quoteOverrides: { providerQuoteReference: "provider-quote:foreign-private-marker" }
  });
  const crossScope = await comparePrivateQuotes(inputOf(alpha, foreign), comparisonDependencies);
  assert.equal(crossScope.status, "not_comparable");
  assert.equal(crossScope.entries[1].currentness.status, "unavailable");
  assert.equal(Object.hasOwn(crossScope.entries[1], "sourceReferences"), false);
  assert.equal(Object.hasOwn(crossScope.entries[1], "terms"), false);
  const publicText = JSON.stringify(crossScope);
  for (const marker of ["foreign-private-marker", foreign.quote.quoteId, foreign.quote.providerQuoteReference]) {
    assert.equal(publicText.includes(marker), false);
  }
});

add("serialized quotes remain current, caller input is not mutated, and forged flags/accessors fail safely", async () => {
  const alpha = await makeQuote({ catalog: sameBasisCatalog("fixture-provider-alpha") });
  const beta = await makeQuote({ catalog: sameBasisCatalog("fixture-provider-beta") });
  const roundTrippedAlpha = JSON.parse(JSON.stringify(alpha.quote));
  const roundTrippedBeta = JSON.parse(JSON.stringify(beta.quote));
  const before = JSON.stringify({ roundTrippedAlpha, roundTrippedBeta, alphaInput: alpha.currentInput, betaInput: beta.currentInput });
  const result = await comparePrivateQuotes(inputOf(
    { quote: roundTrippedAlpha, currentInput: alpha.currentInput },
    { quote: roundTrippedBeta, currentInput: beta.currentInput }
  ), comparisonDependencies);
  assert.equal(result.status, "comparable");
  assert.equal(JSON.stringify({ roundTrippedAlpha, roundTrippedBeta, alphaInput: alpha.currentInput, betaInput: beta.currentInput }), before);

  const forgedFlags = await comparePrivateQuotes({
    entries: [{ quote: alpha.quote, currentInput: alpha.currentInput }, { quote: beta.quote, currentInput: beta.currentInput }],
    status: "current",
    comparable: true
  }, comparisonDependencies);
  assert.equal(forgedFlags.status, "invalid");

  let getterCalled = false;
  const accessorInput = {};
  Object.defineProperty(accessorInput, "entries", {
    enumerable: true,
    get() {
      getterCalled = true;
      return [];
    }
  });
  const accessorResult = await comparePrivateQuotes(accessorInput, comparisonDependencies);
  assert.equal(accessorResult.status, "invalid");
  assert.equal(getterCalled, false);

  const proxyInput = new Proxy({}, {
    ownKeys() { throw new Error("private proxy trap marker"); }
  });
  const proxyResult = await comparePrivateQuotes(proxyInput, comparisonDependencies);
  assert.equal(proxyResult.status, "invalid");
  assert.equal(JSON.stringify(proxyResult).includes("private proxy trap marker"), false);
});

add("network control enforces OS EPERM when requested and otherwise proves local loopback works", async () => {
  if (process.env.FC_COMPARISON_EXPECT_NETWORK_DENIAL === "1") await deniedNetworkControl();
  else await positiveLoopbackControl();
});

export async function runComparisonSuite() {
  const results = [];
  for (const [name, run] of cases) {
    try {
      await run();
      results.push({ name, status: "passed" });
    } catch (error) {
      results.push({ name, status: "failed", detail: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  const results = await runComparisonSuite();
  for (const result of results) process.stdout.write(result.status.toUpperCase() + " " + result.name + (result.detail ? ": " + result.detail : "") + "\n");
  const failed = results.filter((result) => result.status !== "passed");
  process.stdout.write("Private comparison suite: " + (results.length - failed.length) + "/" + results.length + " passed\n");
  if (failed.length > 0) process.exitCode = 1;
}
