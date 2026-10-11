import {
  evaluateCatalogSelection,
  normalizeCatalogSnapshot,
  type CatalogDimensions,
  type CatalogInsets,
  type CatalogSnapshot,
  type CatalogSelectionResult
} from "./catalog.js";
import {
  evaluatePrivateQuoteCurrent,
  type PrivateQuoteSnapshot,
  type QuoteCurrentEvaluation,
  type QuoteCurrentReason
} from "./quotes.js";
import type { TrustedScope } from "./types.js";

/** Private FC-09 development projection. This is not a canonical shared schema. */
export const PRIVATE_COMPARISON_FORMAT = "connector-development-comparison/1" as const;

export interface PrivateQuoteComparisonRequest {
  readonly entries: readonly {
    readonly quote: unknown;
    readonly currentInput: unknown;
  }[];
}

export interface PrivateQuoteComparisonDependencies {
  readonly clock: { now(): number };
  readonly trustedScope: TrustedScope;
}

export type ComparisonReason =
  | "comparison_input_invalid"
  | "at_least_two_quotes_required"
  | "quote_unavailable"
  | "quote_invalid"
  | "quote_not_current"
  | "quote_incomplete"
  | "capability_not_eligible"
  | "region_not_eligible"
  | "product_basis_differs"
  | "product_basis_unknown"
  | "currency_differs"
  | "quantity_differs"
  | "options_differ"
  | "materials_differ"
  | "destination_binding_differs"
  | "shipping_method_differs"
  | "tax_basis_differs"
  | "tax_basis_unknown"
  | "validity_differs"
  | "provider_expiry_unknown"
  | "lead_time_unknown"
  | "amount_unknown";

export interface ComparisonQuoteReferences {
  readonly quoteId: string;
  readonly providerQuoteReference: string;
  readonly providerId: string;
  readonly apiVersion: string;
  readonly catalogVersion: string;
  readonly catalogSnapshotIdentity: string;
  readonly catalogContentIdentity: string;
  readonly sku: string;
  readonly variantId: string;
  readonly specIdentity: string;
  readonly selectionDigest: string;
  readonly requestDigest: string;
  readonly quantity: number;
  readonly options: readonly string[];
  readonly materials: readonly string[];
  readonly destination: {
    readonly reference: string;
    readonly digest: string;
    readonly countryCode: string;
    readonly regionCode?: string;
  };
  readonly shippingMethod: string;
  readonly catalogEvidenceMode: PrivateQuoteSnapshot["catalogEvidenceMode"];
}

export interface ComparisonCapabilityFit {
  readonly status: CatalogSelectionResult["status"] | "invalid";
  readonly reasons: readonly string[];
  readonly details: readonly string[];
}

export interface ComparisonQuoteEntry {
  readonly index: number;
  readonly currentness: {
    readonly status: QuoteCurrentEvaluation["status"] | "unavailable";
    readonly reasons: readonly (QuoteCurrentReason | "quote_unavailable")[];
  };
  readonly sourceReferences?: ComparisonQuoteReferences;
  readonly capabilityFit?: ComparisonCapabilityFit;
  readonly regionSuitability?: "eligible" | "unsupported" | "unknown";
  readonly terms?: {
    readonly createdAt: string;
    readonly expiry: PrivateQuoteSnapshot["expiry"];
    readonly currency: string;
    readonly currencyScale: number;
    readonly breakdown: PrivateQuoteSnapshot["breakdown"];
    readonly leadTime: PrivateQuoteSnapshot["leadTime"];
    readonly warnings: readonly string[];
    readonly financialEffect: "quote_only";
  };
}

export interface PrivateQuoteComparison {
  readonly localFormat: typeof PRIVATE_COMPARISON_FORMAT;
  readonly status: "comparable" | "not_comparable" | "invalid";
  readonly reasons: readonly ComparisonReason[];
  readonly entries: readonly ComparisonQuoteEntry[];
  readonly financialEffect: "quote_only";
  readonly projectionOnly: true;
}

const MAX_ENTRIES = 20;
const MAX_DEPTH = 24;
const MAX_NODES = 100_000;
const MAX_BYTES = 10_000_000;
const MAX_STRING_LENGTH = 4_096;
const COMPARISON_REASONS = new Set<ComparisonReason>([
  "comparison_input_invalid", "at_least_two_quotes_required", "quote_unavailable", "quote_invalid",
  "quote_not_current", "quote_incomplete", "capability_not_eligible", "region_not_eligible",
  "product_basis_differs", "product_basis_unknown",
  "currency_differs", "quantity_differs", "options_differ", "materials_differ",
  "destination_binding_differs", "shipping_method_differs", "tax_basis_differs", "tax_basis_unknown",
  "validity_differs", "provider_expiry_unknown", "lead_time_unknown", "amount_unknown"
]);

function invalid(): never {
  throw new TypeError("invalid comparison input");
}

function ownValue(value: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) return invalid();
  return descriptor.value;
}

function safeCopy(value: unknown, depth = 0, seen = new WeakSet<object>(), budget = { nodes: 0, bytes: 0 }): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_NODES || depth > MAX_DEPTH) return invalid();
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > MAX_STRING_LENGTH || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value)) return invalid();
    budget.bytes += new TextEncoder().encode(value).byteLength;
    if (budget.bytes > MAX_BYTES) return invalid();
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) return invalid();
    return value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value) || value.length > 2_000) return invalid();
    seen.add(value);
    const copy: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) copy.push(safeCopy(ownValue(value, String(index)), depth + 1, seen, budget));
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length) return invalid();
    }
    seen.delete(value);
    return copy;
  }
  if (typeof value !== "object") return invalid();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid();
  if (seen.has(value)) return invalid();
  seen.add(value);
  const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  const keys = Reflect.ownKeys(value);
  if (keys.length > 1_000) return invalid();
  for (const key of keys) {
    if (typeof key !== "string" || key.length === 0 || key.length > 128) return invalid();
    Object.defineProperty(copy, key, {
      value: safeCopy(ownValue(value, key), depth + 1, seen, budget),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  seen.delete(value);
  return copy;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) return invalid();
}

function freezeTree<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && "value" in descriptor) freezeTree(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map((entry) => stableJson(entry)).join(",") + "]";
  const source = value as Record<string, unknown>;
  return "{" + Object.keys(source).sort().map((key) => JSON.stringify(key) + ":" + stableJson(source[key])).join(",") + "}";
}

interface SelectedProductionBasis {
  readonly dimensions: CatalogDimensions;
  readonly bleed: CatalogInsets;
  readonly safeArea: CatalogInsets;
  readonly effectiveResolutionDpi: number;
  readonly surface: string;
  readonly fileType: string;
  readonly fileCount: number;
  readonly colorSpace: string;
  readonly colorProfile: string;
  readonly options: readonly string[];
  readonly materials: readonly string[];
  readonly personalization: unknown;
}

interface BuiltComparisonEntry {
  readonly entry: ComparisonQuoteEntry;
  readonly basis?: SelectedProductionBasis;
}

function exactNanometres(value: unknown, selectedUnit: unknown, allowZero: boolean): string {
  if (typeof value !== "string" || value.length > 24) return invalid();
  if (selectedUnit !== "mm" && selectedUnit !== "cm" && selectedUnit !== "in") return invalid();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,3})?$/u.test(value)) return invalid();
  const [wholeText = "0", fractionText = ""] = value.split(".");
  const scale = selectedUnit === "mm" ? 1_000_000n : selectedUnit === "cm" ? 10_000_000n : 25_400_000n;
  const denominator = 10n ** BigInt(fractionText.length);
  const fractionalNumerator = fractionText.length === 0 ? 0n : BigInt(fractionText) * scale;
  if (fractionalNumerator % denominator !== 0n) return invalid();
  const result = BigInt(wholeText) * scale + fractionalNumerator / denominator;
  if ((!allowZero && result <= 0n) || (allowZero && result < 0n) || result > 2_000_000_000n) return invalid();
  return result.toString(10);
}

function selectedDimensions(value: unknown): CatalogDimensions {
  const input = record(value);
  exactKeys(input, ["width", "height", "depth", "unit"]);
  const selectedUnit = ownValue(input, "unit");
  return {
    widthNm: exactNanometres(ownValue(input, "width"), selectedUnit, false),
    heightNm: exactNanometres(ownValue(input, "height"), selectedUnit, false),
    depthNm: exactNanometres(ownValue(input, "depth"), selectedUnit, false),
    unit: "nm"
  };
}

function selectedInsets(value: unknown): CatalogInsets {
  const input = record(value);
  exactKeys(input, ["top", "right", "bottom", "left", "unit"]);
  const selectedUnit = ownValue(input, "unit");
  return {
    topNm: exactNanometres(ownValue(input, "top"), selectedUnit, true),
    rightNm: exactNanometres(ownValue(input, "right"), selectedUnit, true),
    bottomNm: exactNanometres(ownValue(input, "bottom"), selectedUnit, true),
    leftNm: exactNanometres(ownValue(input, "left"), selectedUnit, true),
    unit: "nm"
  };
}

function selectedSet(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return invalid();
  const copied = value.map((entry) => {
    if (typeof entry !== "string") return invalid();
    return entry;
  });
  return copied.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function deriveSelectedProductionBasis(
  selectionValue: unknown,
  catalog: CatalogSnapshot,
  catalogResult: CatalogSelectionResult
): SelectedProductionBasis | undefined {
  if (catalogResult.status !== "eligible") return undefined;
  const selection = record(selectionValue);
  const product = catalog.products.find((candidate) =>
    candidate.sku === selection.sku && candidate.variantId === selection.variantId
  );
  if (product === undefined || product.constraints.dimensions.state !== "known") return undefined;
  const dimensions = selectedDimensions(ownValue(selection, "dimensions"));
  if (stableJson(dimensions) !== stableJson(product.constraints.dimensions.value)) return undefined;

  const personalizationValue = ownValue(selection, "personalization");
  const personalization = personalizationValue === null ? null : safeCopy(personalizationValue);
  const effectiveResolutionDpi = ownValue(selection, "effectiveResolutionDpi");
  const surface = ownValue(selection, "surface");
  const fileType = ownValue(selection, "fileType");
  const fileCount = ownValue(selection, "fileCount");
  const colorSpace = ownValue(selection, "colorSpace");
  const colorProfile = ownValue(selection, "colorProfile");
  if (typeof surface !== "string" || typeof fileType !== "string" || typeof colorSpace !== "string" ||
      typeof colorProfile !== "string") return undefined;
  if (typeof effectiveResolutionDpi !== "number" || !Number.isSafeInteger(effectiveResolutionDpi) ||
      typeof fileCount !== "number" || !Number.isSafeInteger(fileCount)) return undefined;

  return {
    dimensions,
    bleed: selectedInsets(ownValue(selection, "bleed")),
    safeArea: selectedInsets(ownValue(selection, "safeArea")),
    effectiveResolutionDpi,
    surface,
    fileType,
    fileCount,
    colorSpace,
    colorProfile,
    options: selectedSet(ownValue(selection, "options")),
    materials: selectedSet(ownValue(selection, "materials")),
    personalization
  };
}

function pushReason(reasons: ComparisonReason[], reason: ComparisonReason): void {
  if (COMPARISON_REASONS.has(reason) && !reasons.includes(reason)) reasons.push(reason);
}

function invalidResult(reason: ComparisonReason = "comparison_input_invalid"): PrivateQuoteComparison {
  return freezeTree({
    localFormat: PRIVATE_COMPARISON_FORMAT,
    status: "invalid",
    reasons: [reason],
    entries: [],
    financialEffect: "quote_only",
    projectionOnly: true
  });
}

function regionStatus(result: CatalogSelectionResult): "eligible" | "unsupported" | "unknown" {
  if (result.status === "eligible") return "eligible";
  if (result.details.includes("destination_country_unsupported") || result.details.includes("destination_region_unsupported")) return "unsupported";
  return "unknown";
}

function capabilityFit(result: CatalogSelectionResult | undefined): ComparisonCapabilityFit {
  if (result === undefined) return { status: "invalid", reasons: ["catalog_input_invalid"], details: [] };
  return {
    status: result.status,
    reasons: [...result.reasons],
    details: [...result.details]
  };
}

function references(quote: PrivateQuoteSnapshot): ComparisonQuoteReferences {
  return {
    quoteId: quote.quoteId,
    providerQuoteReference: quote.providerQuoteReference,
    providerId: quote.binding.providerId,
    apiVersion: quote.binding.apiVersion,
    catalogVersion: quote.binding.catalogVersion,
    catalogSnapshotIdentity: quote.binding.catalogSnapshotIdentity,
    catalogContentIdentity: quote.binding.catalogContentIdentity,
    sku: quote.binding.sku,
    variantId: quote.binding.variantId,
    specIdentity: quote.binding.specIdentity,
    selectionDigest: quote.binding.selectionDigest,
    requestDigest: quote.binding.requestDigest,
    quantity: quote.binding.quantity,
    options: [...quote.binding.options],
    materials: [...quote.binding.materials],
    destination: {
      reference: quote.binding.destination.reference,
      digest: quote.binding.destination.digest,
      countryCode: quote.binding.destination.countryCode,
      ...(quote.binding.destination.regionCode === undefined ? {} : { regionCode: quote.binding.destination.regionCode })
    },
    shippingMethod: quote.binding.shippingMethod,
    catalogEvidenceMode: quote.catalogEvidenceMode
  };
}

function scopeMatches(quoteValue: unknown, scope: TrustedScope): boolean {
  const quote = record(quoteValue);
  const binding = record(quote.binding);
  return binding.tenantId === scope.tenantId && binding.projectId === scope.projectId;
}

function unavailableEntry(index: number): ComparisonQuoteEntry {
  return { index, currentness: { status: "unavailable", reasons: ["quote_unavailable"] } };
}

function quoteEntry(
  index: number,
  quote: PrivateQuoteSnapshot,
  currentness: QuoteCurrentEvaluation,
  catalogResult: CatalogSelectionResult | undefined
): ComparisonQuoteEntry {
  return {
    index,
    currentness: { status: currentness.status, reasons: [...currentness.reasons] },
    sourceReferences: references(quote),
    capabilityFit: capabilityFit(catalogResult),
    regionSuitability: catalogResult === undefined ? "unknown" : regionStatus(catalogResult),
    terms: {
      createdAt: quote.createdAt,
      expiry: quote.expiry,
      currency: quote.currency,
      currencyScale: quote.currencyScale,
      breakdown: quote.breakdown,
      leadTime: quote.leadTime,
      warnings: [...quote.warnings],
      financialEffect: "quote_only"
    }
  };
}

function sameDestination(left: ComparisonQuoteReferences["destination"], right: ComparisonQuoteReferences["destination"]): boolean {
  return left.reference === right.reference && left.digest === right.digest && left.countryCode === right.countryCode &&
    left.regionCode === right.regionCode;
}

function compareEntries(entries: readonly ComparisonQuoteEntry[], reasons: ComparisonReason[]): void {
  for (const entry of entries) {
    if (entry.currentness.status === "unavailable") pushReason(reasons, "quote_unavailable");
    else if (entry.currentness.status === "invalid") {
      pushReason(reasons, entry.currentness.reasons.includes("quote_integrity_invalid") ? "quote_invalid" : "quote_not_current");
    } else if (entry.currentness.status === "stale") pushReason(reasons, "quote_not_current");
    else if (entry.currentness.status === "incomplete") pushReason(reasons, "quote_incomplete");
    if (entry.capabilityFit?.status !== "eligible") pushReason(reasons, "capability_not_eligible");
    if (entry.regionSuitability === "unsupported") pushReason(reasons, "region_not_eligible");
    if (entry.terms === undefined) continue;
    if (entry.terms.breakdown.taxBasis === "unknown") pushReason(reasons, "tax_basis_unknown");
    if (entry.terms.expiry.provider.state === "unknown") pushReason(reasons, "provider_expiry_unknown");
    if (entry.terms.leadTime.state === "unknown") pushReason(reasons, "lead_time_unknown");
    if ([entry.terms.breakdown.production, entry.terms.breakdown.shipping, entry.terms.breakdown.tax,
      entry.terms.breakdown.fee, entry.terms.breakdown.total].some((amount) => amount.state === "unknown")) {
      pushReason(reasons, "amount_unknown");
    }
  }

  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const left = entries[leftIndex];
    if (left?.sourceReferences === undefined || left.terms === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const right = entries[rightIndex];
      if (right?.sourceReferences === undefined || right.terms === undefined) continue;
      const leftRef = left.sourceReferences;
      const rightRef = right.sourceReferences;
      if (left.terms.currency !== right.terms.currency) pushReason(reasons, "currency_differs");
      if (leftRef.quantity !== rightRef.quantity) pushReason(reasons, "quantity_differs");
      if (stableJson(selectedSet(leftRef.options)) !== stableJson(selectedSet(rightRef.options))) pushReason(reasons, "options_differ");
      if (stableJson(selectedSet(leftRef.materials)) !== stableJson(selectedSet(rightRef.materials))) pushReason(reasons, "materials_differ");
      if (!sameDestination(leftRef.destination, rightRef.destination)) pushReason(reasons, "destination_binding_differs");
      if (leftRef.shippingMethod !== rightRef.shippingMethod) pushReason(reasons, "shipping_method_differs");
      if (left.terms.breakdown.taxBasis !== right.terms.breakdown.taxBasis) pushReason(reasons, "tax_basis_differs");
      if (stableJson(left.terms.expiry) !== stableJson(right.terms.expiry)) pushReason(reasons, "validity_differs");
    }
  }
}

function compareBuiltEntries(entries: readonly BuiltComparisonEntry[], reasons: ComparisonReason[]): void {
  compareEntries(entries.map((item) => item.entry), reasons);
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    const left = entries[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const right = entries[rightIndex];
      if (right === undefined || left.entry.sourceReferences === undefined || right.entry.sourceReferences === undefined ||
          left.entry.terms === undefined || right.entry.terms === undefined) continue;
      if (left.basis === undefined || right.basis === undefined) pushReason(reasons, "product_basis_unknown");
      else if (stableJson(left.basis) !== stableJson(right.basis)) pushReason(reasons, "product_basis_differs");
    }
  }
}

function readDependencies(value: unknown): { scope: TrustedScope; now: number; nowText: string } {
  const dependencies = record(value);
  exactKeys(dependencies, ["clock", "trustedScope"]);
  const clock = record(ownValue(dependencies, "clock"));
  exactKeys(clock, ["now"]);
  const nowFunction = ownValue(clock, "now");
  if (typeof nowFunction !== "function") return invalid();
  const nowValue: unknown = Reflect.apply(nowFunction, clock, []);
  if (typeof nowValue !== "number" || !Number.isSafeInteger(nowValue) || nowValue < 0) return invalid();
  const scopeCopy = record(safeCopy(ownValue(dependencies, "trustedScope")));
  exactKeys(scopeCopy, ["tenantId", "projectId"]);
  if (typeof scopeCopy.tenantId !== "string" || scopeCopy.tenantId.length === 0 || scopeCopy.tenantId.length > 128 ||
      typeof scopeCopy.projectId !== "string" || scopeCopy.projectId.length === 0 || scopeCopy.projectId.length > 128) return invalid();
  const nowText = new Date(nowValue).toISOString();
  return {
    scope: Object.freeze({ tenantId: scopeCopy.tenantId, projectId: scopeCopy.projectId }) as TrustedScope,
    now: nowValue,
    nowText
  };
}

function readRequest(value: unknown): { entries: readonly Record<string, unknown>[] } {
  const request = record(safeCopy(value));
  exactKeys(request, ["entries"]);
  if (!Array.isArray(request.entries) || request.entries.length === 0) return invalid();
  if (request.entries.length > MAX_ENTRIES) return invalid();
  const entries = request.entries.map((entryValue) => {
    const entry = record(entryValue);
    exactKeys(entry, ["quote", "currentInput"]);
    return entry;
  });
  return { entries };
}

async function buildEntry(
  index: number,
  value: Record<string, unknown>,
  scope: TrustedScope,
  now: number,
  nowText: string
): Promise<BuiltComparisonEntry> {
  const quoteValue = value.quote;
  let snapshot: Record<string, unknown>;
  try {
    snapshot = record(quoteValue);
    if (!scopeMatches(snapshot, scope)) return { entry: unavailableEntry(index) };
  } catch {
    return { entry: unavailableEntry(index) };
  }

  const currentInput = value.currentInput;
  const dependencies = { trustedScope: scope, clock: { now: () => now } };
  let currentness: QuoteCurrentEvaluation;
  try {
    currentness = await evaluatePrivateQuoteCurrent(snapshot, currentInput, dependencies);
  } catch {
    return { entry: { index, currentness: { status: "invalid", reasons: ["quote_integrity_invalid"] } } };
  }
  if (currentness.reasons.includes("quote_integrity_invalid")) {
    return { entry: { index, currentness: { status: "invalid", reasons: ["quote_integrity_invalid"] } } };
  }

  const quote = snapshot as unknown as PrivateQuoteSnapshot;
  let catalogResult: CatalogSelectionResult | undefined;
  let catalog: CatalogSnapshot | undefined;
  let selection: unknown;
  try {
    const input = record(currentInput);
    selection = ownValue(input, "selection");
    catalog = await normalizeCatalogSnapshot(input.catalogSource);
    catalogResult = evaluateCatalogSelection(catalog, selection, nowText);
  } catch {
    catalogResult = undefined;
  }
  const entry = quoteEntry(index, quote, currentness, catalogResult);
  let basis: SelectedProductionBasis | undefined;
  if (catalog !== undefined && catalogResult !== undefined) {
    try {
      basis = deriveSelectedProductionBasis(selection, catalog, catalogResult);
    } catch {
      basis = undefined;
    }
  }
  return { entry, ...(basis === undefined ? {} : { basis }) };
}

/**
 * Builds a deterministic read-only comparison of validated private quote snapshots.
 * Currentness is recalculated from the supplied trusted scope, clock, catalog, and selection.
 */
export async function comparePrivateQuotes(
  input: unknown,
  dependencies: unknown
): Promise<PrivateQuoteComparison> {
  try {
    const request = readRequest(input);
    const { scope, now, nowText } = readDependencies(dependencies);
    const builtEntries = await Promise.all(request.entries.map((entry, index) => buildEntry(index, entry, scope, now, nowText)));
    const reasons: ComparisonReason[] = [];
    if (builtEntries.length < 2) pushReason(reasons, "at_least_two_quotes_required");
    compareBuiltEntries(builtEntries, reasons);
    const entries = builtEntries.map((item) => item.entry);
    const comparable = reasons.length === 0 && entries.length >= 2;
    return freezeTree({
      localFormat: PRIVATE_COMPARISON_FORMAT,
      status: comparable ? "comparable" : "not_comparable",
      reasons,
      entries,
      financialEffect: "quote_only",
      projectionOnly: true
    });
  } catch {
    return invalidResult();
  }
}
