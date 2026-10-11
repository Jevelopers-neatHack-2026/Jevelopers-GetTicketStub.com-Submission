/**
 * A bounded projection of the documented Prodigi v4 Product Details response.
 * This is provider-private wire data, not a catalog, availability, or approval
 * decision. Unknown provider fields are rejected until reviewed against a new
 * documentation revision.
 */

export interface ProdigiProductDimensions {
  readonly width: number;
  readonly height: number;
  readonly units: string;
}

export interface ProdigiPrintArea {
  readonly required: boolean;
}

export interface ProdigiPrintAreaSize {
  readonly horizontalResolution: number;
  readonly verticalResolution: number;
}

export interface ProdigiProductVariant {
  readonly attributes: Readonly<Record<string, string>>;
  readonly shipsTo: readonly string[];
  readonly printAreaSizes: Readonly<Record<string, ProdigiPrintAreaSize>>;
}

/** Provider-private fields from one successful Product Details response. */
export interface ProdigiProductDetails {
  readonly sku: string;
  readonly description: string;
  readonly productDimensions: ProdigiProductDimensions;
  readonly attributes: Readonly<Record<string, readonly string[]>>;
  readonly printAreas: Readonly<Record<string, ProdigiPrintArea>>;
  readonly variants: readonly ProdigiProductVariant[];
}

export type ProdigiProductDetailsErrorCode = "invalid_sku" | "sku_mismatch" | "invalid_response";

function normalizedErrorCode(value: unknown): ProdigiProductDetailsErrorCode {
  if (value === "invalid_sku") return "invalid_sku";
  if (value === "sku_mismatch") return "sku_mismatch";
  return "invalid_response";
}

function errorMessage(code: ProdigiProductDetailsErrorCode): string {
  switch (code) {
    case "invalid_sku":
      return "Prodigi product SKU is invalid.";
    case "sku_mismatch":
      return "Prodigi product response SKU does not match the requested SKU.";
    case "invalid_response":
      return "Prodigi Product Details response is invalid or unsupported.";
  }
}

/** Safe fixed-message error; never includes provider response or SKU content. */
export class ProdigiProductDetailsError extends Error {
  readonly code: ProdigiProductDetailsErrorCode;

  constructor(code: ProdigiProductDetailsErrorCode) {
    const safeCode = normalizedErrorCode(code);
    super(errorMessage(safeCode));
    this.name = "ProdigiProductDetailsError";
    this.code = safeCode;
  }
}

const MAX_SKU_LENGTH = 128;
const MAX_TEXT_LENGTH = 4096;
const MAX_KEY_LENGTH = 128;
const MAX_RECORD_ENTRIES = 256;
const MAX_ARRAY_ENTRIES = 256;
const MAX_TOTAL_NODES = 4096;
const MAX_TOTAL_TEXT_LENGTH = 100_000;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u;
const UNSAFE_KEY_NAMES = new Set(["__proto__", "prototype", "constructor"]);

interface Budget {
  nodes: number;
  textLength: number;
}

type SafeRecord = Record<string, unknown>;

const INTERNAL_FAILURES = {
  invalid_sku: Symbol("invalid_sku"),
  sku_mismatch: Symbol("sku_mismatch"),
  invalid_response: Symbol("invalid_response")
};

function fail(code: ProdigiProductDetailsErrorCode): never {
  switch (code) {
    case "invalid_sku":
      throw INTERNAL_FAILURES.invalid_sku;
    case "sku_mismatch":
      throw INTERNAL_FAILURES.sku_mismatch;
    case "invalid_response":
      throw INTERNAL_FAILURES.invalid_response;
  }
}

function errorForFailure(failure: unknown): ProdigiProductDetailsError {
  if (failure === INTERNAL_FAILURES.invalid_sku) return new ProdigiProductDetailsError("invalid_sku");
  if (failure === INTERNAL_FAILURES.sku_mismatch) return new ProdigiProductDetailsError("sku_mismatch");
  return new ProdigiProductDetailsError("invalid_response");
}

function withSafeFailureBoundary<T>(operation: () => T): T {
  try {
    return operation();
  } catch (failure) {
    throw errorForFailure(failure);
  }
}

function consumeNode(budget: Budget): void {
  budget.nodes += 1;
  if (budget.nodes > MAX_TOTAL_NODES) fail("invalid_response");
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function recordString(value: unknown, budget: Budget, maxLength = MAX_TEXT_LENGTH): string {
  consumeNode(budget);
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || CONTROL_CHARACTERS.test(value) || !isWellFormedUnicode(value)) {
    fail("invalid_response");
  }
  budget.textLength += value.length;
  if (budget.textLength > MAX_TOTAL_TEXT_LENGTH) fail("invalid_response");
  return value;
}

function validateSku(value: unknown, failureCode: "invalid_sku" | "invalid_response" = "invalid_sku"): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_SKU_LENGTH ||
    value.trim() !== value ||
    value === "." ||
    value === ".." ||
    /[\\/%?#]/u.test(value) ||
    CONTROL_CHARACTERS.test(value) ||
    !isWellFormedUnicode(value)
  ) {
    fail(failureCode);
  }
  return value;
}

/**
 * Build the fixed Product Details path segment for a caller-supplied SKU.
 * The helper returns a path only; it has no host, transport, or credentials.
 */
export function prodigiProductDetailsPath(sku: string): string {
  return withSafeFailureBoundary(() => {
    const safeSku = validateSku(sku);
    let escaped: string;
    try {
      escaped = encodeURIComponent(safeSku).replace(/[!'()*]/gu, (character) =>
        `%${character.charCodeAt(0).toString(16).toUpperCase()}`
      );
    } catch {
      fail("invalid_sku");
    }
    return `/v4.0/products/${escaped}`;
  });
}

function getOwnRecord(value: unknown, allowedKeys: readonly string[] | null, requiredKeys: readonly string[], budget: Budget): SafeRecord {
  consumeNode(budget);
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("invalid_response");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail("invalid_response");

  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > MAX_RECORD_ENTRIES) fail("invalid_response");
  const allowed = allowedKeys === null ? null : new Set(allowedKeys);
  const captured: SafeRecord = Object.create(null) as SafeRecord;
  for (const key of ownKeys) {
    if (typeof key !== "string" || (allowed !== null && !allowed.has(key))) fail("invalid_response");
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      fail("invalid_response");
    }
    captured[key] = descriptor.value;
  }
  for (const key of requiredKeys) {
    if (!Object.prototype.hasOwnProperty.call(captured, key)) fail("invalid_response");
  }
  return captured;
}

function getOwnArray(value: unknown, budget: Budget): unknown[] {
  consumeNode(budget);
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) fail("invalid_response");
  const ownKeys = Reflect.ownKeys(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0 ||
    lengthDescriptor.value > MAX_ARRAY_ENTRIES ||
    ownKeys.length !== lengthDescriptor.value + 1
  ) {
    fail("invalid_response");
  }

  const values: unknown[] = [];
  for (let index = 0; index < lengthDescriptor.value; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      descriptor.get !== undefined ||
      descriptor.set !== undefined
    ) {
      fail("invalid_response");
    }
    values.push(descriptor.value);
  }
  const expectedKeys = new Set<string>(["length"]);
  for (let index = 0; index < lengthDescriptor.value; index += 1) expectedKeys.add(String(index));
  for (const key of ownKeys) {
    if (typeof key !== "string" || !expectedKeys.has(key)) fail("invalid_response");
  }
  return values;
}

function recordKey(value: string, budget: Budget): string {
  const key = recordString(value, budget, MAX_KEY_LENGTH);
  if (UNSAFE_KEY_NAMES.has(key)) fail("invalid_response");
  return key;
}

function recordStringList(value: unknown, budget: Budget): readonly string[] {
  const source = getOwnArray(value, budget);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const text = recordString(item, budget);
    if (seen.has(text)) fail("invalid_response");
    seen.add(text);
    result.push(text);
  }
  return Object.freeze(result);
}

function recordAttributeValues(value: unknown, budget: Budget): Readonly<Record<string, readonly string[]>> {
  const source = getOwnRecord(value, null, [], budget);
  const result: Record<string, readonly string[]> = Object.create(null) as Record<string, readonly string[]>;
  for (const key of Object.keys(source)) {
    const safeKey = recordKey(key, budget);
    result[safeKey] = recordStringList(source[safeKey], budget);
  }
  return Object.freeze(result);
}

function recordStringMap(value: unknown, budget: Budget): Readonly<Record<string, string>> {
  const source = getOwnRecord(value, null, [], budget);
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const key of Object.keys(source)) {
    const safeKey = recordKey(key, budget);
    result[safeKey] = recordString(source[safeKey], budget);
  }
  return Object.freeze(result);
}

function recordPrintAreas(value: unknown, budget: Budget): Readonly<Record<string, ProdigiPrintArea>> {
  const source = getOwnRecord(value, null, [], budget);
  const result: Record<string, ProdigiPrintArea> = Object.create(null) as Record<string, ProdigiPrintArea>;
  for (const key of Object.keys(source)) {
    const safeKey = recordKey(key, budget);
    const area = getOwnRecord(source[safeKey], ["required"], ["required"], budget);
    if (typeof area.required !== "boolean") fail("invalid_response");
    consumeNode(budget);
    result[safeKey] = Object.freeze({ required: area.required });
  }
  return Object.freeze(result);
}

function recordResolution(value: unknown, budget: Budget): ProdigiPrintAreaSize {
  const source = getOwnRecord(value, ["horizontalResolution", "verticalResolution"], ["horizontalResolution", "verticalResolution"], budget);
  const horizontalResolution = source.horizontalResolution;
  const verticalResolution = source.verticalResolution;
  if (
    typeof horizontalResolution !== "number" ||
    !Number.isSafeInteger(horizontalResolution) ||
    horizontalResolution <= 0 ||
    typeof verticalResolution !== "number" ||
    !Number.isSafeInteger(verticalResolution) ||
    verticalResolution <= 0
  ) {
    fail("invalid_response");
  }
  consumeNode(budget);
  consumeNode(budget);
  return Object.freeze({ horizontalResolution, verticalResolution });
}

function recordPrintAreaSizes(value: unknown, budget: Budget): Readonly<Record<string, ProdigiPrintAreaSize>> {
  const source = getOwnRecord(value, null, [], budget);
  const result: Record<string, ProdigiPrintAreaSize> = Object.create(null) as Record<string, ProdigiPrintAreaSize>;
  for (const key of Object.keys(source)) {
    const safeKey = recordKey(key, budget);
    result[safeKey] = recordResolution(source[safeKey], budget);
  }
  return Object.freeze(result);
}

function recordVariant(value: unknown, budget: Budget): ProdigiProductVariant {
  const source = getOwnRecord(value, ["attributes", "shipsTo", "printAreaSizes"], ["attributes", "shipsTo", "printAreaSizes"], budget);
  return Object.freeze({
    attributes: recordStringMap(source.attributes, budget),
    shipsTo: recordStringList(source.shipsTo, budget),
    printAreaSizes: recordPrintAreaSizes(source.printAreaSizes, budget)
  });
}

function variantSignature(variant: ProdigiProductVariant): string {
  return JSON.stringify({
    attributes: Object.keys(variant.attributes).sort().map((key) => [key, variant.attributes[key]]),
    shipsTo: variant.shipsTo,
    printAreaSizes: Object.keys(variant.printAreaSizes).sort().map((key) => {
      const size = variant.printAreaSizes[key];
      if (size === undefined) fail("invalid_response");
      return [key, size.horizontalResolution, size.verticalResolution];
    })
  });
}

function recordDimensions(value: unknown, budget: Budget): ProdigiProductDimensions {
  const source = getOwnRecord(value, ["width", "height", "units"], ["width", "height", "units"], budget);
  if (
    typeof source.width !== "number" ||
    !Number.isFinite(source.width) ||
    source.width <= 0 ||
    typeof source.height !== "number" ||
    !Number.isFinite(source.height) ||
    source.height <= 0
  ) {
    fail("invalid_response");
  }
  consumeNode(budget);
  consumeNode(budget);
  const units = recordString(source.units, budget, 64);
  consumeNode(budget);
  return Object.freeze({ width: source.width, height: source.height, units });
}

function recordVariants(value: unknown, budget: Budget): readonly ProdigiProductVariant[] {
  const source = getOwnArray(value, budget);
  const result: ProdigiProductVariant[] = [];
  const seen = new Set<string>();
  for (const item of source) {
    const variant = recordVariant(item, budget);
    const signature = variantSignature(variant);
    if (seen.has(signature)) fail("invalid_response");
    seen.add(signature);
    result.push(variant);
  }
  return Object.freeze(result);
}

/**
 * Decode only the documented success envelope and bind it to the requested
 * SKU. The input must be plain data; output is a detached, deeply frozen DTO.
 */
export function decodeProdigiProductDetails(input: unknown, expectedSku: string): ProdigiProductDetails {
  return withSafeFailureBoundary(() => {
    validateSku(expectedSku);
    const budget: Budget = { nodes: 0, textLength: 0 };
    const envelope = getOwnRecord(input, ["outcome", "product", "traceParent"], ["outcome", "product"], budget);
    consumeNode(budget);
    if (envelope.outcome !== "Ok") fail("invalid_response");
    if (Object.prototype.hasOwnProperty.call(envelope, "traceParent")) {
      recordString(envelope.traceParent, budget, 512);
    }
    const product = getOwnRecord(
      envelope.product,
      ["sku", "description", "productDimensions", "attributes", "printAreas", "variants"],
      ["sku", "description", "productDimensions", "attributes", "printAreas", "variants"],
      budget
    );
    const sku = validateSku(product.sku, "invalid_response");
    if (sku !== expectedSku) fail("sku_mismatch");
    const details: ProdigiProductDetails = {
      sku,
      description: recordString(product.description, budget),
      productDimensions: recordDimensions(product.productDimensions, budget),
      attributes: recordAttributeValues(product.attributes, budget),
      printAreas: recordPrintAreas(product.printAreas, budget),
      variants: recordVariants(product.variants, budget)
    };
    consumeNode(budget);
    return Object.freeze(details);
  });
}
