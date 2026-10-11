import assert from "node:assert/strict";
import { evaluatePrivateQuoteCurrent, executePrivateQuote, QuoteExecutionError } from "../dist/quotes.js";
import {
  catalogA,
  catalogB,
  copyCatalog,
  contractValidator,
  destinationDigest,
  destinationReference,
  providerQuote,
  quoteHarness,
  quoteScope,
  requestFor,
  selectionFor
} from "./quote-fixtures.mjs";

const cases = [];
const add = (name, run) => cases.push([name, run]);
const assertNoOrder = (harness) => assert.equal(harness.calls.order, 0, "quote path must never submit an order");

async function quoteOnce({ catalog = copyCatalog(catalogA), response = providerQuote(), policy, now, contracts, quote } = {}) {
  const request = await requestFor(catalog);
  const harness = quoteHarness({ response, policy, now, contracts, quote });
  const result = await executePrivateQuote(request, harness.dependencies);
  return { request, harness, result };
}

async function expectQuoteError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof QuoteExecutionError);
    assert.equal(error.code, code);
    assert.equal(error.message, error.safeMessage);
    return true;
  });
}

add("valid quote binds exact catalog, selection, destination, shipping, scope, and currency terms", async () => {
  const { request, harness, result } = await quoteOnce();
  const quote = result.quote;
  assert.equal(quote.localFormat, "connector-development-quote/1");
  assert.match(quote.quoteId, /^quote:sha256:[a-f0-9]{64}$/u);
  assert.equal(quote.status, "complete");
  assert.equal(quote.binding.tenantId, quoteScope.tenantId);
  assert.equal(quote.binding.projectId, quoteScope.projectId);
  assert.equal(quote.binding.catalogVersion, "alpha-r1");
  assert.equal(quote.binding.catalogSnapshotIdentity, request.selection.snapshotIdentity);
  assert.equal(quote.binding.sku, request.selection.sku);
  assert.deepEqual(quote.binding.options, request.selection.options);
  assert.equal(quote.binding.quantity, 25);
  assert.equal(quote.binding.destination.reference, destinationReference);
  assert.equal(quote.binding.destination.digest, destinationDigest);
  assert.equal(quote.binding.destination.countryCode, "US");
  assert.equal(quote.binding.destination.regionCode, "CA");
  assert.equal(quote.binding.shippingMethod, "express");
  assert.equal(quote.breakdown.production.value.decimal, "12.50");
  assert.equal(quote.breakdown.production.value.minorUnits, "1250");
  assert.equal(quote.breakdown.shipping.value.decimal, "3.00");
  assert.equal(quote.breakdown.tax.value.decimal, "1.55");
  assert.equal(quote.breakdown.fee.value.decimal, "0.25");
  assert.equal(quote.breakdown.total.value.decimal, "17.30");
  assert.deepEqual(quote.breakdown.reconciliation, {
    state: "reconciled",
    expectedTotal: { currency: "USD", scale: 2, decimal: "17.30", minorUnits: "1730" }
  });
  assert.equal(quote.expiry.provider.state, "known");
  assert.equal(quote.expiry.effectiveSource, "provider_and_local_policy");
  assert.equal(quote.expiry.localPolicy.version, "quote-local-policy/1");
  assert.deepEqual(quote.leadTime, { state: "known", minimumDays: 3, maximumDays: 6, confidence: "estimate" });
  assert.deepEqual(quote.warnings, ["Fixture shipping estimate may change before purchase."]);
  assert.equal(quote.financialEffect, "quote_only");
  assert.equal(Object.hasOwn(quote, "actualExpense"), false);
  assert.ok(Object.isFrozen(quote) && Object.isFrozen(quote.breakdown) && Object.isFrozen(quote.breakdown.total.value));
  assert.equal(harness.calls.quote, 1);
  assert.equal(harness.calls.request.operation, undefined);
  assert.equal(harness.calls.request.destination.digest, destinationDigest);
  assert.equal(harness.calls.request.shippingMethod, "express");
  assert.equal(harness.calls.request.personalization.fieldCount, 1);
  assert.equal(result.contractBinding.state, "development_fixture");
  assert.equal(result.sharedPayload.quote_reference, quote.quoteId);
  assertNoOrder(harness);

  const current = await evaluatePrivateQuoteCurrent(quote, request, harness.dependencies);
  assert.deepEqual(current, {
    status: "current",
    reasons: [],
    requiredActions: ["obtain_external_authorization"],
    quoteMayBePresentedForExternalReview: true
  });
  assertNoOrder(harness);
});

add("quote IDs are deterministic for identical inputs and response timestamps", async () => {
  const first = await quoteOnce();
  const second = await quoteOnce();
  assert.equal(first.result.quote.quoteId, second.result.quote.quoteId);
  assert.equal(first.result.quote.termsFingerprint, second.result.quote.termsFingerprint);
  assertNoOrder(first.harness);
  assertNoOrder(second.harness);
});

add("known zero remains distinct from an unknown price component", async () => {
  const zero = await quoteOnce({ response: providerQuote({
    breakdown: {
      production: { state: "known", decimal: "12.50" },
      shipping: { state: "known", decimal: "0" },
      tax: { state: "known", decimal: "0.00" },
      fee: { state: "known", decimal: "0.00" }
    },
    total: { state: "known", decimal: "12.5" }
  }) });
  assert.equal(zero.result.quote.breakdown.shipping.state, "known");
  assert.equal(zero.result.quote.breakdown.shipping.value.decimal, "0.00");
  assert.equal(zero.result.quote.status, "complete");
  assertNoOrder(zero.harness);

  const unknown = await quoteOnce({ response: providerQuote({
    breakdown: {
      production: { state: "known", decimal: "12.50" },
      shipping: { state: "known", decimal: "3.00" },
      tax: { state: "unknown", reasonCode: "not_disclosed" },
      fee: { state: "known", decimal: "0.25" }
    }
  }) });
  assert.deepEqual(unknown.result.quote.breakdown.tax, { state: "unknown", reasonCode: "not_disclosed" });
  assert.equal(unknown.result.quote.status, "incomplete");
  assert.deepEqual(unknown.result.quote.breakdown.reconciliation, { state: "incomplete", missing: ["tax"] });
  const current = await evaluatePrivateQuoteCurrent(unknown.result.quote, unknown.request, unknown.harness.dependencies);
  assert.equal(current.status, "incomplete");
  assert.equal(current.quoteMayBePresentedForExternalReview, false);
  assertNoOrder(unknown.harness);
});

add("included unknown tax is preserved while a reconciled total remains exact", async () => {
  const { harness, result } = await quoteOnce({ response: providerQuote({
    breakdown: {
      production: { state: "known", decimal: "12.50" },
      shipping: { state: "known", decimal: "3.00" },
      tax: { state: "unknown", reasonCode: "not_disclosed" },
      fee: { state: "known", decimal: "0.25" }
    },
    taxBasis: "included",
    total: { state: "known", decimal: "15.75" }
  }) });
  assert.equal(result.quote.breakdown.taxBasis, "included");
  assert.equal(result.quote.breakdown.tax.state, "unknown");
  assert.deepEqual(result.quote.breakdown.reconciliation, {
    state: "reconciled",
    expectedTotal: { currency: "USD", scale: 2, decimal: "15.75", minorUnits: "1575" }
  });
  assert.equal(result.quote.status, "incomplete");
  assert.equal(result.quote.breakdown.total.value.decimal, "15.75");
  assertNoOrder(harness);
});

add("zero-decimal and three-decimal currencies reconcile without floating-point arithmetic", async () => {
  const jpy = await quoteOnce({ response: providerQuote({
    currency: "JPY", currencyScale: 0,
    breakdown: {
      production: { state: "known", decimal: "1200" },
      shipping: { state: "known", decimal: "0" },
      tax: { state: "known", decimal: "0" },
      fee: { state: "known", decimal: "0" }
    }, total: { state: "known", decimal: "1200" }
  }) });
  assert.equal(jpy.result.quote.breakdown.total.value.minorUnits, "1200");
  assert.equal(jpy.result.quote.breakdown.total.value.decimal, "1200");
  assertNoOrder(jpy.harness);

  const kwd = await quoteOnce({ response: providerQuote({
    currency: "KWD", currencyScale: 3,
    breakdown: {
      production: { state: "known", decimal: "1.234" },
      shipping: { state: "known", decimal: "0.001" },
      tax: { state: "known", decimal: "0.005" },
      fee: { state: "known", decimal: "0" }
    }, total: { state: "known", decimal: "1.240" }
  }) });
  assert.equal(kwd.result.quote.currency, "KWD");
  assert.equal(kwd.result.quote.breakdown.total.value.minorUnits, "1240");
  assert.equal(kwd.result.quote.breakdown.tax.value.decimal, "0.005");
  assertNoOrder(kwd.harness);
});

add("provider response rejects unmodeled per-line currency fields", async () => {
  const responseWithLineCurrency = providerQuote({
    breakdown: {
      production: { state: "known", decimal: "12.50" },
      shipping: { state: "known", decimal: "3.00" },
      tax: { state: "known", decimal: "1.55" },
      fee: { state: "known", decimal: "0.25" },
      currency: "EUR"
    }
  });
  const harness = quoteHarness({ quote: async () => responseWithLineCurrency });
  await expectQuoteError(executePrivateQuote(await requestFor(), harness.dependencies), "provider_response_invalid");
  assert.equal(harness.calls.quote, 1);
  assertNoOrder(harness);
});

add("amount precision beyond the declared currency scale is rejected", async () => {
  const harness = quoteHarness({ response: providerQuote({
    breakdown: {
      production: { state: "known", decimal: "12.501" },
      shipping: { state: "known", decimal: "3.00" },
      tax: { state: "known", decimal: "1.55" },
      fee: { state: "known", decimal: "0.25" }
    }
  }) });
  await expectQuoteError(executePrivateQuote(await requestFor(), harness.dependencies), "provider_response_invalid");
  assert.equal(harness.calls.quote, 1);
  assertNoOrder(harness);
});

add("a mismatched provider total fails exact reconciliation", async () => {
  const harness = quoteHarness({ response: providerQuote({ total: { state: "known", decimal: "17.31" } }) });
  await expectQuoteError(executePrivateQuote(await requestFor(), harness.dependencies), "provider_response_invalid");
  assert.equal(harness.calls.quote, 1);
  assertNoOrder(harness);
});

add("missing inputs and stale snapshot selections fail before quotation", async () => {
  const harness = quoteHarness();
  const request = await requestFor();
  const { quantity: _quantity, ...missing } = request;
  await expectQuoteError(executePrivateQuote(missing, harness.dependencies), "missing_input");
  const stale = { ...request, selection: { ...request.selection, snapshotIdentity: `sha256:${"b".repeat(64)}` } };
  await expectQuoteError(executePrivateQuote(stale, harness.dependencies), "stale_quote");
  assert.equal(harness.calls.quote, 0);
  assertNoOrder(harness);
});

add("unsupported personalization and removed catalog products never invoke the quote port", async () => {
  const unsupportedCatalog = copyCatalog(catalogB);
  const unsupportedSnapshot = await (await import("../dist/catalog.js")).normalizeCatalogSnapshot(unsupportedCatalog);
  const unsupportedRequest = {
    catalogSource: unsupportedCatalog,
    selection: selectionFor(unsupportedSnapshot, { personalization: { mode: "variable_text", fields: [{ name: "title", characterCount: 12 }] } }),
    quantity: 1,
    destinationReference,
    destinationDigest
  };
  const harness = quoteHarness();
  await expectQuoteError(executePrivateQuote(unsupportedRequest, harness.dependencies), "unsupported");

  const removedCatalog = copyCatalog(catalogA);
  removedCatalog.products[0].availability = "removed";
  const removedSnapshot = await (await import("../dist/catalog.js")).normalizeCatalogSnapshot(removedCatalog);
  const removedRequest = { ...unsupportedRequest, catalogSource: removedCatalog, selection: selectionFor(removedSnapshot), quantity: 1 };
  await expectQuoteError(executePrivateQuote(removedRequest, harness.dependencies), "stale_quote");
  assert.equal(harness.calls.quote, 0);
  assertNoOrder(harness);
});

add("catalog snapshot freshness expiry blocks quotation", async () => {
  const harness = quoteHarness({ now: "2026-10-10T11:00:00.001Z" });
  const request = await requestFor();
  await expectQuoteError(executePrivateQuote(request, harness.dependencies), "stale_quote");
  assert.equal(harness.calls.quote, 0);
  assertNoOrder(harness);
});

add("provider expiry and conservative local expiry remain distinct", async () => {
  const providerEarly = await quoteOnce({ response: providerQuote({ providerExpiry: { state: "known", validUntil: "2026-10-10T10:30:45.000Z" } }) });
  assert.equal(providerEarly.result.quote.expiry.effectiveSource, "provider");
  assert.equal(providerEarly.result.quote.expiry.effectiveValidUntil, "2026-10-10T10:30:45.000Z");
  assert.equal(providerEarly.result.quote.expiry.localPolicy.validUntil, "2026-10-10T10:35:00.000Z");
  assertNoOrder(providerEarly.harness);

  const undocumented = await quoteOnce({ response: providerQuote({
    providerExpiry: { state: "unknown", reasonCode: "not_provided" }
  }) });
  assert.deepEqual(undocumented.result.quote.expiry.provider, { state: "unknown", reasonCode: "not_provided" });
  assert.equal(undocumented.result.quote.expiry.effectiveSource, "local_policy");
  assert.equal(undocumented.result.quote.expiry.effectiveValidUntil, "2026-10-10T10:35:00.000Z");
  assertNoOrder(undocumented.harness);
});

add("expired provider quotes and unknown total cannot pass the quote boundary as usable terms", async () => {
  const expired = quoteHarness({ response: providerQuote({ providerExpiry: { state: "known", validUntil: "2026-10-10T10:29:59.000Z" } }) });
  await expectQuoteError(executePrivateQuote(await requestFor(), expired.dependencies), "provider_response_invalid");
  assert.equal(expired.contracts.receipts.length, 0);
  assertNoOrder(expired);

  const unknownTotal = await quoteOnce({ response: providerQuote({ total: { state: "unknown", reasonCode: "provider_unspecified" } }) });
  assert.equal(unknownTotal.result.quote.breakdown.total.state, "unknown");
  assert.equal(unknownTotal.result.quote.status, "incomplete");
  assert.equal(unknownTotal.result.quote.breakdown.reconciliation.state, "incomplete");
  const evaluation = await evaluatePrivateQuoteCurrent(unknownTotal.result.quote, unknownTotal.request, unknownTotal.harness.dependencies);
  assert.equal(evaluation.status, "incomplete");
  assertNoOrder(unknownTotal.harness);
});

add("quote timeout aborts the bounded quote request and never submits an order", async () => {
  let signal;
  const harness = quoteHarness({
    policy: { timeoutMs: 2 },
    quote: (_request, context) => {
      signal = context.signal;
      return new Promise((resolve) => setTimeout(() => resolve(providerQuote()), 30));
    }
  });
  await expectQuoteError(executePrivateQuote(await requestFor(), harness.dependencies), "timeout");
  assert.equal(signal.aborted, true);
  assert.equal(harness.calls.quote, 1);
  assertNoOrder(harness);
});

add("per-port rate limit rejects excess quotes before invoking the provider", async () => {
  const harness = quoteHarness({ policy: { maximumQuotesPerWindow: 1, rateWindowMs: 60_000 } });
  const request = await requestFor();
  await executePrivateQuote(request, harness.dependencies);
  await expectQuoteError(executePrivateQuote(request, harness.dependencies), "rate_limit");
  assert.equal(harness.calls.quote, 1);
  assertNoOrder(harness);
});

add("provider errors expose only bounded safe messages", async () => {
  const harness = quoteHarness({ quote: async () => { throw new Error("sk-secret-review-marker-provider-body"); } });
  await expectQuoteError(executePrivateQuote(await requestFor(), harness.dependencies), "provider_failure");
  assert.equal(JSON.stringify(new QuoteExecutionError("provider_failure")).includes("review-marker"), false);
  assertNoOrder(harness);
});

add("provider notes and contract payloads reject sensitive data", async () => {
  const noteHarness = quoteHarness({ response: providerQuote({ providerNotes: ["Send details to person@example.test"] }) });
  await expectQuoteError(executePrivateQuote(await requestFor(), noteHarness.dependencies), "provider_response_invalid");
  assert.equal(noteHarness.contracts.receipts.length, 0);
  assertNoOrder(noteHarness);

  const sensitiveBoundary = quoteHarness({ contracts: {
    ...contractValidator(),
    async validateOutbound(request) {
      return {
        ok: true,
        value: { privateNote: "Person at 123 Main Street" },
        receipts: [{ shape: "fulfillment_quote", schemaVersion: "0.1.0", tenantId: request.trustedScope.tenantId, projectId: request.trustedScope.projectId }]
      };
    }
  } });
  await expectQuoteError(executePrivateQuote(await requestFor(), sensitiveBoundary.dependencies), "contract_rejected");
  assertNoOrder(sensitiveBoundary);
});

add("getter-backed input and provider responses are rejected without invoking accessors", async () => {
  const harness = quoteHarness();
  const request = await requestFor();
  let inputGetterCalled = false;
  const withGetter = { ...request };
  Object.defineProperty(withGetter, "quantity", { enumerable: true, get() { inputGetterCalled = true; return 25; } });
  await expectQuoteError(executePrivateQuote(withGetter, harness.dependencies), "invalid_input");
  assert.equal(inputGetterCalled, false);
  assert.equal(harness.calls.quote, 0);
  assertNoOrder(harness);

  const raw = providerQuote();
  let providerGetterCalled = false;
  Object.defineProperty(raw, "total", { enumerable: true, get() { providerGetterCalled = true; return { state: "known", decimal: "17.30" }; } });
  const providerHarness = quoteHarness({ quote: async () => raw });
  await expectQuoteError(executePrivateQuote(request, providerHarness.dependencies), "provider_response_invalid");
  assert.equal(providerGetterCalled, false);
  assertNoOrder(providerHarness);
});

add("missing or malformed quote schema pins fail closed before the quote port", async () => {
  const missing = quoteHarness({ contracts: contractValidator({ binding: { state: "missing" } }) });
  await expectQuoteError(executePrivateQuote(await requestFor(), missing.dependencies), "contract_missing");
  assert.equal(missing.calls.quote, 0);
  assertNoOrder(missing);

  const wrongReceipt = quoteHarness({ contracts: contractValidator({
    validateOutbound: async (request) => ({
      ok: true,
      value: { quote_reference: request.value.quoteId },
      receipts: [{ shape: "fulfillment_quote", schemaVersion: "0.1.0", tenantId: "other-tenant", projectId: request.trustedScope.projectId }]
    })
  }) });
  await expectQuoteError(executePrivateQuote(await requestFor(), wrongReceipt.dependencies), "scope_mismatch");
  assert.equal(wrongReceipt.calls.quote, 1);
  assertNoOrder(wrongReceipt);
});

add("changed catalog, selection, destination, shipping, or quantity requires re-quote and renewed external authorization", async () => {
  const { request, harness, result } = await quoteOnce();

  const changedCatalog = copyCatalog(catalogA);
  changedCatalog.catalogVersion = "alpha-r2";
  const changedCatalogSnapshot = await (await import("../dist/catalog.js")).normalizeCatalogSnapshot(changedCatalog);
  const catalogRequest = { ...request, catalogSource: changedCatalog, selection: selectionFor(changedCatalogSnapshot) };
  const catalogResult = await evaluatePrivateQuoteCurrent(result.quote, catalogRequest, harness.dependencies);
  assert.equal(catalogResult.status, "stale");
  assert.ok(catalogResult.reasons.includes("catalog_changed"));
  assert.ok(catalogResult.requiredActions.includes("refresh_catalog"));
  assert.ok(catalogResult.requiredActions.includes("requote"));
  assert.ok(catalogResult.requiredActions.includes("renew_external_authorization"));

  const selectionRequest = { ...request, selection: { ...request.selection, options: ["matte"] } };
  const selectionResult = await evaluatePrivateQuoteCurrent(result.quote, selectionRequest, harness.dependencies);
  assert.equal(selectionResult.status, "stale");
  assert.ok(selectionResult.reasons.includes("selection_changed"));
  assert.ok(selectionResult.requiredActions.includes("renew_external_authorization"));

  const destinationResult = await evaluatePrivateQuoteCurrent(result.quote, {
    ...request,
    destinationDigest: `sha256:${"b".repeat(64)}`
  }, harness.dependencies);
  assert.equal(destinationResult.status, "stale");
  assert.ok(destinationResult.reasons.includes("destination_changed"));
  assert.ok(destinationResult.requiredActions.includes("requote"));
  assert.ok(destinationResult.requiredActions.includes("renew_external_authorization"));

  const quantityResult = await evaluatePrivateQuoteCurrent(result.quote, { ...request, quantity: 26 }, harness.dependencies);
  assert.equal(quantityResult.status, "stale");
  assert.ok(quantityResult.reasons.includes("request_changed"));
  assertNoOrder(harness);
});

add("expired quotes require a fresh quote and renewed external authorization", async () => {
  const { request, harness, result } = await quoteOnce();
  harness.setNow("2026-10-10T10:35:00.000Z");
  const evaluation = await evaluatePrivateQuoteCurrent(result.quote, request, harness.dependencies);
  assert.equal(evaluation.status, "stale");
  assert.deepEqual(evaluation.reasons, ["quote_expired"]);
  assert.deepEqual(evaluation.requiredActions, ["requote", "renew_external_authorization"]);
  assertNoOrder(harness);
});

export async function runQuoteSuite() {
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
  const results = await runQuoteSuite();
  for (const result of results) process.stdout.write(`${result.status.toUpperCase()} ${result.name}${result.detail ? `: ${result.detail}` : ""}\n`);
  const failed = results.filter((result) => result.status !== "passed");
  process.stdout.write(`Quote normalization suite: ${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length > 0) process.exitCode = 1;
}
