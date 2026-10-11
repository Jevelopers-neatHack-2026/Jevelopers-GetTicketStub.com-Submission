import assert from "node:assert/strict";
import {
  decodeProdigiProductDetails,
  prodigiProductDetailsPath,
  ProdigiProductDetailsError
} from "../dist/prodigi-product-details.js";

const fixtureSku = "FIXTURE-CANVAS-SYNTHETIC-01";

function response() {
  return {
    outcome: "Ok",
    traceParent: "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    product: {
      sku: fixtureSku,
      description: "Synthetic fixture only; not a selected product.",
      productDimensions: { width: 10, height: 7.5, units: "in" },
      attributes: { wrap: ["Black", "White"] },
      printAreas: { default: { required: true } },
      variants: [
        {
          attributes: { wrap: "Black" },
          shipsTo: ["ZZ"],
          printAreaSizes: { default: { horizontalResolution: 1522, verticalResolution: 1200 } }
        }
      ]
    }
  };
}

function assertCode(run, code, forbiddenText = []) {
  assert.throws(run, (error) => {
    assert.ok(error instanceof ProdigiProductDetailsError);
    assert.equal(error.code, code);
    for (const text of forbiddenText) assert.equal(error.message.includes(text), false);
    return true;
  });
}

const cases = [];
const add = (name, run) => cases.push([name, run]);

add("preserves the documented provider facts without converting or selecting them", () => {
  const decoded = decodeProdigiProductDetails(response(), fixtureSku);
  assert.equal(decoded.sku, fixtureSku);
  assert.equal(decoded.description, "Synthetic fixture only; not a selected product.");
  assert.deepEqual({ ...decoded.productDimensions }, { width: 10, height: 7.5, units: "in" });
  assert.deepEqual([...decoded.attributes.wrap], ["Black", "White"]);
  assert.equal(decoded.printAreas.default.required, true);
  assert.deepEqual({ ...decoded.variants[0].attributes }, { wrap: "Black" });
  assert.deepEqual([...decoded.variants[0].shipsTo], ["ZZ"]);
  assert.deepEqual({ ...decoded.variants[0].printAreaSizes.default }, { horizontalResolution: 1522, verticalResolution: 1200 });
  assert.equal(Object.hasOwn(decoded, "availability"), false);
  assert.equal(Object.hasOwn(decoded.variants[0], "selected"), false);
});

add("returns detached, deeply frozen data", () => {
  const input = response();
  const decoded = decodeProdigiProductDetails(input, fixtureSku);
  input.product.description = "changed after parsing";
  input.product.attributes.wrap[0] = "changed";
  input.product.variants[0].shipsTo.push("YY");
  assert.equal(decoded.description, "Synthetic fixture only; not a selected product.");
  assert.equal(decoded.attributes.wrap[0], "Black");
  assert.deepEqual([...decoded.variants[0].shipsTo], ["ZZ"]);
  for (const value of [
    decoded,
    decoded.productDimensions,
    decoded.attributes,
    decoded.attributes.wrap,
    decoded.printAreas,
    decoded.printAreas.default,
    decoded.variants,
    decoded.variants[0],
    decoded.variants[0].attributes,
    decoded.variants[0].shipsTo,
    decoded.variants[0].printAreaSizes,
    decoded.variants[0].printAreaSizes.default
  ]) assert.equal(Object.isFrozen(value), true);
  assert.throws(() => { decoded.description = "attempted write"; }, TypeError);
});

add("requires an exact requested SKU binding and keeps mismatch errors safe", () => {
  assertCode(() => decodeProdigiProductDetails(response(), "OTHER-SYNTHETIC-SKU"), "sku_mismatch", [fixtureSku, "OTHER-SYNTHETIC-SKU"]);
  assertCode(() => decodeProdigiProductDetails(response(), "bad/sku"), "invalid_sku", ["bad/sku"]);
  const invalidResponseSku = response();
  invalidResponseSku.product.sku = "bad%2Fsku";
  assertCode(() => decodeProdigiProductDetails(invalidResponseSku, fixtureSku), "invalid_response", ["bad%2Fsku"]);
});

add("builds only the fixed path and safely escapes a valid path segment", () => {
  assert.equal(prodigiProductDetailsPath(fixtureSku), `/v4.0/products/${fixtureSku}`);
  assert.equal(prodigiProductDetailsPath("fixture sku+1"), "/v4.0/products/fixture%20sku%2B1");
  assert.equal(prodigiProductDetailsPath("é!()*"), "/v4.0/products/%C3%A9%21%28%29%2A");
});

add("rejects path separators, encoded ambiguity, traversal, controls, and invalid identifiers", () => {
  for (const sku of [
    "",
    " ",
    ".",
    "..",
    "../sku",
    "folder/sku",
    "folder\\sku",
    "%2f",
    "sku?query",
    "sku#fragment",
    "sku\u0000",
    `sku${"x".repeat(128)}`,
    "\ud800"
  ]) assertCode(() => prodigiProductDetailsPath(sku), "invalid_sku");
  assertCode(() => prodigiProductDetailsPath(42), "invalid_sku");
});

add("accepts only the documented success envelope", () => {
  const invalidOutcome = response();
  invalidOutcome.outcome = "Error";
  assertCode(() => decodeProdigiProductDetails(invalidOutcome, fixtureSku), "invalid_response");
  const missingProduct = { outcome: "Ok" };
  assertCode(() => decodeProdigiProductDetails(missingProduct, fixtureSku), "invalid_response");
  const unsafeTrace = response();
  unsafeTrace.traceParent = { secret: "do not disclose" };
  assertCode(() => decodeProdigiProductDetails(unsafeTrace, fixtureSku), "invalid_response", ["do not disclose"]);
});

add("rejects missing, extra, and malformed fields at each documented object level", () => {
  const mutations = [
    (value) => { delete value.product.description; },
    (value) => { value.product.orderable = true; },
    (value) => { value.product.productDimensions.extra = "unknown"; },
    (value) => { value.product.variants[0].extra = "unknown"; },
    (value) => { value.product.printAreas.default.required = "yes"; },
    (value) => { value.product.variants[0].printAreaSizes.default.verticalResolution = 1.5; },
    (value) => { value.product.variants[0].attributes.wrap = 1; },
    (value) => { value.product.attributes.wrap = "Black"; },
    (value) => { value.product.productDimensions.units = ""; },
    (value) => { value.product.description = ""; }
  ];
  for (const mutate of mutations) {
    const input = response();
    mutate(input);
    assertCode(() => decodeProdigiProductDetails(input, fixtureSku), "invalid_response");
  }
  for (const extra of [
    (value) => { value.extra = true; },
    (value) => { value.product.extra = true; },
    (value) => { value.product.variants[0].extra = true; },
    (value) => { value.product.productDimensions.extra = true; }
  ]) {
    const input = response();
    extra(input);
    assertCode(() => decodeProdigiProductDetails(input, fixtureSku), "invalid_response");
  }
});

add("rejects unsafe numeric dimensions and non-positive or non-integer resolutions", () => {
  for (const width of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "10"]) {
    const input = response();
    input.product.productDimensions.width = width;
    assertCode(() => decodeProdigiProductDetails(input, fixtureSku), "invalid_response");
  }
  for (const value of [0, -1, 2.5, Number.MAX_SAFE_INTEGER + 1, "1522"]) {
    const input = response();
    input.product.variants[0].printAreaSizes.default.horizontalResolution = value;
    assertCode(() => decodeProdigiProductDetails(input, fixtureSku), "invalid_response");
  }
});

add("rejects duplicate list members and unsafe dictionary keys", () => {
  const duplicateAttribute = response();
  duplicateAttribute.product.attributes.wrap.push("Black");
  assertCode(() => decodeProdigiProductDetails(duplicateAttribute, fixtureSku), "invalid_response");
  const duplicateDestination = response();
  duplicateDestination.product.variants[0].shipsTo.push("ZZ");
  assertCode(() => decodeProdigiProductDetails(duplicateDestination, fixtureSku), "invalid_response");
  const duplicateVariant = response();
  duplicateVariant.product.variants.push(structuredClone(duplicateVariant.product.variants[0]));
  assertCode(() => decodeProdigiProductDetails(duplicateVariant, fixtureSku), "invalid_response");
  const unsafeKey = response();
  Object.defineProperty(unsafeKey.product.attributes, "__proto__", { value: ["x"], enumerable: true });
  assertCode(() => decodeProdigiProductDetails(unsafeKey, fixtureSku), "invalid_response");
});

add("requires plain data and rejects accessors without invoking them", () => {
  let getterCalls = 0;
  const accessor = response();
  Object.defineProperty(accessor.product, "description", {
    enumerable: true,
    configurable: true,
    get() { getterCalls += 1; return "secret"; }
  });
  assertCode(() => decodeProdigiProductDetails(accessor, fixtureSku), "invalid_response", ["secret"]);
  assert.equal(getterCalls, 0);

  const withSymbol = response();
  withSymbol[Symbol("extra")] = "secret";
  assertCode(() => decodeProdigiProductDetails(withSymbol, fixtureSku), "invalid_response", ["secret"]);
  assertCode(() => decodeProdigiProductDetails(new Date(), fixtureSku), "invalid_response");
  assertCode(() => decodeProdigiProductDetails(new Proxy(response(), { ownKeys() { throw new Error("provider secret body"); } }), fixtureSku), "invalid_response", ["provider secret body"]);
});

add("rejects sparse and augmented arrays", () => {
  const sparse = response();
  sparse.product.variants[0].shipsTo = ["ZZ", ,];
  assertCode(() => decodeProdigiProductDetails(sparse, fixtureSku), "invalid_response");
  const augmented = response();
  augmented.product.attributes.wrap.note = "extra";
  assertCode(() => decodeProdigiProductDetails(augmented, fixtureSku), "invalid_response");
});

add("bounds large values and returns fixed safe messages", () => {
  const tooManyVariants = response();
  tooManyVariants.product.variants = Array.from({ length: 257 }, () => response().product.variants[0]);
  assertCode(() => decodeProdigiProductDetails(tooManyVariants, fixtureSku), "invalid_response");
  const longDescription = response();
  longDescription.product.description = "x".repeat(4097);
  assertCode(() => decodeProdigiProductDetails(longDescription, fixtureSku), "invalid_response");
});

let failures = 0;
for (const [name, run] of cases) {
  try {
    await run();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    failures += 1;
    process.stderr.write(`FAIL ${name}: ${error instanceof Error ? error.message : "unknown test failure"}\n`);
  }
}
process.stdout.write(`RESULT ${cases.length - failures}/${cases.length}\n`);
if (failures > 0) process.exitCode = 1;
