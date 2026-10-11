#!/usr/bin/env node
/**
 * Owner-gated, single-request Prodigi SANDBOX smoke check: one quote, or one
 * order read. It never creates an order and never targets the live API.
 *
 * NOT run by `npm test` or CI. Run it only after the repository owner approves
 * one authenticated sandbox call and names the SKU, destination and shipping
 * method. The key is read server-side from PRODIGI_SANDBOX_API_KEY (e.g. via
 * Node's built-in `--env-file=.env`) and is never printed.
 *
 *   npm run build
 *   node --env-file=.env scripts/prodigi-sandbox-smoke.mjs \
 *     --owner-approved --decision-reference <ref> \
 *     --sku <SKU> --country <CC> --shipping <Budget|Standard|StandardPlus|Express|Overnight> \
 *     [--currency USD] [--copies 1] [--attributes '{"wrap":"White"}'] [--print-area default]
 *
 *   # read instead of quote:
 *   node --env-file=.env scripts/prodigi-sandbox-smoke.mjs --owner-approved ... --read-order ord_123
 */
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import {
  createEnvServerSecretSource,
  createFetchProdigiHttpPort,
  PRODIGI_SANDBOX_SECRET_BINDING,
  ProdigiSandboxClient
} from "../dist/index.js";

const { values } = parseArgs({
  options: {
    "owner-approved": { type: "boolean", default: false },
    "decision-reference": { type: "string" },
    sku: { type: "string" },
    country: { type: "string" },
    shipping: { type: "string" },
    currency: { type: "string", default: "USD" },
    copies: { type: "string", default: "1" },
    attributes: { type: "string", default: "{}" },
    "print-area": { type: "string", default: "default" },
    "read-order": { type: "string" }
  },
  strict: true
});

function fail(reason) {
  process.stdout.write(`${JSON.stringify({ status: "refused", reason, externalProviderCalls: 0 })}\n`);
  process.exit(2);
}

if (values["owner-approved"] !== true) fail("owner_approval_flag_required");
for (const key of ["decision-reference", "sku", "country", "shipping"]) {
  if (typeof values[key] !== "string" || values[key].trim() === "") fail(`${key}_required`);
}

const decision = {
  decisionReference: values["decision-reference"],
  sku: values.sku,
  destinationCountryCode: values.country,
  shippingMethod: values.shipping
};
// Operator attestation only: this records that the owner approved this exact
// decision out of band. It is not product, destination or account evidence.
const operatorAttestedVerifier = {
  async verify(request) {
    return { ...request, productAndDestinationApproved: true, sandboxAccountAccessConfirmed: true };
  }
};

const client = new ProdigiSandboxClient({
  http: createFetchProdigiHttpPort(),
  secrets: createEnvServerSecretSource({ bindings: [PRODIGI_SANDBOX_SECRET_BINDING] }),
  decision,
  decisionVerifier: operatorAttestedVerifier,
  sandboxCallsEnabled: true
});

try {
  if (values["read-order"] !== undefined) {
    const order = await client.getOrder(values["read-order"]);
    process.stdout.write(`${JSON.stringify({ status: "ok", operation: "read", externalProviderCalls: 1, order }, null, 2)}\n`);
  } else {
    const request = {
      providerId: "prodigi",
      apiVersion: "v4.0",
      catalogVersion: "smoke",
      catalogSnapshotIdentity: "smoke:none",
      catalogContentIdentity: "smoke:none",
      sku: decision.sku,
      variantId: "smoke",
      specIdentity: "smoke:none",
      selectionDigest: "smoke:none",
      quantity: Number(values.copies),
      options: [],
      materials: [],
      destination: { reference: "smoke:destination", digest: "smoke:none", countryCode: decision.destinationCountryCode },
      shippingMethod: decision.shippingMethod,
      personalization: null,
      requestDigest: `sha256:${createHash("sha256").update(JSON.stringify(decision)).digest("hex")}`
    };
    const quote = await client.createQuote(request, {
      currencyCode: values.currency,
      attributes: JSON.parse(values.attributes),
      printArea: values["print-area"]
    });
    process.stdout.write(`${JSON.stringify({ status: "ok", operation: "quote", externalProviderCalls: 1, quote }, null, 2)}\n`);
  }
} catch (error) {
  const safe = error !== null && typeof error === "object" && typeof error.code === "string"
    ? { code: error.code, sideEffectState: error.sideEffectState ?? null, httpStatus: error.httpStatus ?? null }
    : { code: "unexpected_failure" };
  process.stdout.write(`${JSON.stringify({ status: "failed", ...safe })}\n`);
  process.exitCode = 1;
}
