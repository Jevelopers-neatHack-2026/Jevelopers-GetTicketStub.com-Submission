import { createHash } from "node:crypto";
import { isIP } from "node:net";

export type StatusState =
  | "pending"
  | "accepted"
  | "in_production"
  | "shipped"
  | "delivered"
  | "cancel_requested"
  | "cancel_rejected"
  | "cancelled"
  | "rejected"
  | "failed"
  | "unknown";

export type ProjectedStatusState = StatusState | "conflict";
export type ObservationSource = "trusted_poll" | "trusted_lookup";
export type QuantityBasis = "cumulative" | "delta";
export type QuantityKind = "fulfilled" | "failed";

export interface ProviderStatusMapping {
  readonly providerId: string;
  readonly version: string;
  readonly policyState: "development_fixture";
  readonly statuses: Readonly<Record<string, StatusState>>;
}

export interface TrackingHostPolicy {
  readonly policyId: string;
  readonly version: string;
  readonly policyState: "development_fixture";
  readonly approvedHosts: readonly string[];
}

export interface QuantityFact {
  readonly kind: QuantityKind;
  readonly value: number;
  readonly unit: string;
  readonly basis: QuantityBasis;
  readonly contributionId?: string;
}

export interface StatusItemFact {
  readonly itemId: string;
  readonly providerStatus: string;
  readonly quantities: readonly QuantityFact[];
}

export interface StatusShipmentFact {
  readonly shipmentId: string;
  readonly providerStatus: string;
  readonly carrierCode?: string;
  readonly trackingNumber?: string;
  readonly trackingUrl?: string;
  readonly items: readonly StatusItemFact[];
}

/** This is adapter input, never a canonical shared-contract payload. */
export interface ProviderStatusObservation {
  readonly providerRequestId: string;
  readonly providerStatus: string;
  readonly occurredAt: string;
  readonly sourceObservationId?: string;
  readonly sourceRevision?: string;
  readonly shipments: readonly StatusShipmentFact[];
}

export interface NormalizedQuantityFact {
  readonly kind: QuantityKind;
  readonly value: number;
  readonly unit: string;
  readonly basis: QuantityBasis;
  readonly contributionId?: string;
}

export interface NormalizedStatusItem {
  readonly itemId: string;
  readonly providerStatus: string;
  readonly state: StatusState;
  readonly quantities: readonly NormalizedQuantityFact[];
}

export interface NormalizedStatusShipment {
  readonly shipmentId: string;
  readonly providerStatus: string;
  readonly state: StatusState;
  readonly carrierCode?: string;
  readonly trackingNumber?: string;
  readonly trackingUrl?: string;
  readonly items: readonly NormalizedStatusItem[];
}

export interface NormalizedStatusObservation {
  readonly observationId: string;
  readonly sourceObservationId: string;
  readonly sourceIdKind: "provider_supplied" | "derived_semantic";
  readonly sourceKind: ObservationSource;
  readonly providerRequestId: string;
  readonly providerStatus: string;
  readonly state: StatusState;
  readonly occurredAt: string;
  readonly ingestedAt: number;
  readonly contentDigest: string;
  readonly semanticEffectId: string;
  readonly sourceRevision?: string;
  readonly shipments: readonly NormalizedStatusShipment[];
}

export type StatusInputErrorCode = "invalid_input" | "invalid_policy";

export class StatusInputError extends Error {
  readonly code: StatusInputErrorCode;

  constructor(code: StatusInputErrorCode) {
    super(code);
    this.name = "StatusInputError";
    this.code = code;
  }
}

const STATUS_STATES = new Set<StatusState>([
  "pending", "accepted", "in_production", "shipped", "delivered", "cancel_requested",
  "cancel_rejected", "cancelled", "rejected", "failed", "unknown"
]);
const MAX_ID = 128;
const MAX_SHIPMENTS = 200;
const MAX_ITEMS = 2_000;
const MAX_QUANTITIES = 4_000;
const MAX_TRACKING_URL = 1_024;
const MAX_INTEGER_QUANTITY = 1_000_000;
const ISO_DATE_LIMIT = 8_640_000_000_000_000;

export function fixtureStatusMapping(providerId = "synthetic-status-provider"): ProviderStatusMapping {
  return Object.freeze({
    providerId,
    version: "fc-status-map-fixture/1",
    policyState: "development_fixture",
    statuses: Object.freeze({
      "fixture.pending": "pending",
      "fixture.accepted": "accepted",
      "fixture.production": "in_production",
      "fixture.shipped": "shipped",
      "fixture.delivered": "delivered",
      "fixture.cancel-requested": "cancel_requested",
      "fixture.cancel-rejected": "cancel_rejected",
      "fixture.cancelled": "cancelled",
      "fixture.rejected": "rejected",
      "fixture.failed": "failed"
    })
  });
}

export function fixtureTrackingHostPolicy(): TrackingHostPolicy {
  return Object.freeze({
    policyId: "synthetic-tracking-hosts",
    version: "fc-tracking-policy-fixture/1",
    policyState: "development_fixture",
    approvedHosts: Object.freeze(["tracking.example.test"])
  });
}

export function isStatusState(value: unknown): value is StatusState {
  return typeof value === "string" && STATUS_STATES.has(value as StatusState);
}

export function isProjectedStatusState(value: unknown): value is ProjectedStatusState {
  return value === "conflict" || isStatusState(value);
}

export function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  try {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

export function snapshotExactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = []
): Record<string, unknown> {
  try {
    if (!isPlainDataRecord(value)) throw new Error();
    const allowed = new Set([...required, ...optional]);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
      required.some((key) => !Object.hasOwn(value, key))) throw new Error();
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string") throw new Error();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw new Error();
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    throw new StatusInputError("invalid_input");
  }
}

export function snapshotDenseArray(value: unknown, maximum: number): unknown[] {
  try {
    if (!Array.isArray(value)) throw new Error();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    const length = lengthDescriptor !== undefined && "value" in lengthDescriptor ? lengthDescriptor.value : undefined;
    if (!Number.isSafeInteger(length) || (length as number) < 0 || (length as number) > maximum) throw new Error();
    const copy: unknown[] = [];
    for (let index = 0; index < (length as number); index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor)) throw new Error();
      copy.push(descriptor.value);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string" || !/^(0|[1-9]\d*)$/u.test(key) || Number(key) >= (length as number)) throw new Error();
    }
    return copy;
  } catch {
    throw new StatusInputError("invalid_input");
  }
}

function isSafeToken(value: unknown, maximum = MAX_ID): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum &&
    value.trim() === value && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value) &&
    !/^https?:/iu.test(value) && !value.includes("@");
}

function isSafeCode(value: unknown, maximum = 96): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum &&
    value.trim() === value && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value);
}

function isCanonicalTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && Math.abs(milliseconds) <= ISO_DATE_LIMIT &&
    new Date(milliseconds).toISOString() === value;
}

function snapshotDynamicRecord(value: unknown): Record<string, unknown> {
  try {
    if (!isPlainDataRecord(value)) throw new Error();
    const copy: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = Reflect.ownKeys(value);
    if (keys.length > 100) throw new Error();
    for (const key of keys) {
      if (typeof key !== "string") throw new Error();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) throw new Error();
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    throw new StatusInputError("invalid_policy");
  }
}

export function validateStatusPolicies(mapping: ProviderStatusMapping, tracking: TrackingHostPolicy): void {
  const mappingRow = snapshotExactRecord(mapping, ["providerId", "version", "policyState", "statuses"]);
  const statuses = snapshotDynamicRecord(mappingRow.statuses);
  if (!isSafeToken(mappingRow.providerId) || mappingRow.version !== "fc-status-map-fixture/1" ||
    mappingRow.policyState !== "development_fixture") throw new StatusInputError("invalid_policy");
  for (const [providerStatus, state] of Object.entries(statuses)) {
    if (!isSafeCode(providerStatus) || !isStatusState(state)) throw new StatusInputError("invalid_policy");
  }
  const trackingRow = snapshotExactRecord(tracking, ["policyId", "version", "policyState", "approvedHosts"]);
  if (!isSafeToken(trackingRow.policyId) || trackingRow.version !== "fc-tracking-policy-fixture/1" ||
    trackingRow.policyState !== "development_fixture") throw new StatusInputError("invalid_policy");
  const hosts = snapshotDenseArray(trackingRow.approvedHosts, 64);
  const seen = new Set<string>();
  for (const host of hosts) {
    if (typeof host !== "string" || host !== host.toLowerCase() || host.length > 253 ||
      !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/u.test(host) ||
      isIP(host) !== 0 || seen.has(host)) throw new StatusInputError("invalid_policy");
    seen.add(host);
  }
}

export function snapshotStatusPolicies(mappingValue: unknown, trackingValue: unknown): {
  readonly mapping: ProviderStatusMapping;
  readonly trackingPolicy: TrackingHostPolicy;
} {
  try {
    const mappingRow = snapshotExactRecord(mappingValue, ["providerId", "version", "policyState", "statuses"]);
    const statusEntries = snapshotDynamicRecord(mappingRow.statuses);
    const statuses = Object.create(null) as Record<string, StatusState>;
    for (const [providerStatus, state] of Object.entries(statusEntries)) {
      if (!isSafeCode(providerStatus) || !isStatusState(state)) throw new Error();
      statuses[providerStatus] = state;
    }
    const trackingRow = snapshotExactRecord(trackingValue, ["policyId", "version", "policyState", "approvedHosts"]);
    const approvedHosts = snapshotDenseArray(trackingRow.approvedHosts, 64).map((host) => {
      if (typeof host !== "string") throw new Error();
      return host;
    });
    const mappingSnapshot: ProviderStatusMapping = {
      providerId: mappingRow.providerId as string,
      version: mappingRow.version as string,
      policyState: mappingRow.policyState as "development_fixture",
      statuses
    };
    const trackingSnapshot: TrackingHostPolicy = {
      policyId: trackingRow.policyId as string,
      version: trackingRow.version as string,
      policyState: trackingRow.policyState as "development_fixture",
      approvedHosts
    };
    validateStatusPolicies(mappingSnapshot, trackingSnapshot);
    return {
      mapping: Object.freeze({
        providerId: mappingRow.providerId as string,
        version: "fc-status-map-fixture/1",
        policyState: "development_fixture",
        statuses: Object.freeze(statuses)
      }),
      trackingPolicy: Object.freeze({
        policyId: trackingRow.policyId as string,
        version: "fc-tracking-policy-fixture/1",
        policyState: "development_fixture",
        approvedHosts: Object.freeze(approvedHosts)
      })
    };
  } catch {
    throw new StatusInputError("invalid_policy");
  }
}

function validateTrackingUrl(value: unknown, policy: TrackingHostPolicy): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > MAX_TRACKING_URL || value.trim() !== value ||
    /[\u0000-\u0020\u007f]/u.test(value)) throw new StatusInputError("invalid_input");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StatusInputError("invalid_input");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" ||
    url.search !== "" || url.hash !== "" || isIP(url.hostname) !== 0 ||
    !policy.approvedHosts.includes(url.hostname.toLowerCase())) throw new StatusInputError("invalid_input");
  const normalized = url.toString();
  if (normalized.length > MAX_TRACKING_URL) throw new StatusInputError("invalid_input");
  return normalized;
}

export function isApprovedTrackingUrl(value: unknown, policy: TrackingHostPolicy): value is string {
  try {
    return validateTrackingUrl(value, policy) !== undefined;
  } catch {
    return false;
  }
}

function mapState(raw: string, mapping: ProviderStatusMapping): StatusState {
  if (Object.hasOwn(mapping.statuses, raw)) {
    const state = mapping.statuses[raw];
    if (isStatusState(state)) return state;
  }
  return "unknown";
}

function normalizeQuantity(value: unknown): NormalizedQuantityFact {
  const row = snapshotExactRecord(value, ["kind", "value", "unit", "basis"], ["contributionId"]);
  if ((row.kind !== "fulfilled" && row.kind !== "failed") ||
    !Number.isSafeInteger(row.value) || (row.value as number) < 1 || (row.value as number) > MAX_INTEGER_QUANTITY ||
    !isSafeCode(row.unit, 32) || (row.basis !== "cumulative" && row.basis !== "delta")) {
    throw new StatusInputError("invalid_input");
  }
  if (row.basis === "delta" && !isSafeToken(row.contributionId)) throw new StatusInputError("invalid_input");
  if (row.basis === "cumulative" && row.contributionId !== undefined) throw new StatusInputError("invalid_input");
  return {
    kind: row.kind,
    value: row.value as number,
    unit: row.unit,
    basis: row.basis,
    ...(row.contributionId === undefined ? {} : { contributionId: row.contributionId as string })
  };
}

function normalizeItem(value: unknown, mapping: ProviderStatusMapping): NormalizedStatusItem {
  const row = snapshotExactRecord(value, ["itemId", "providerStatus", "quantities"]);
  if (!isSafeToken(row.itemId) || !isSafeCode(row.providerStatus)) throw new StatusInputError("invalid_input");
  const quantities = snapshotDenseArray(row.quantities, MAX_QUANTITIES).map(normalizeQuantity);
  const identities = new Set<string>();
  const quantityUnits = new Map<QuantityKind, string>();
  const quantityBases = new Map<string, QuantityBasis>();
  for (const quantity of quantities) {
    const priorUnit = quantityUnits.get(quantity.kind);
    if (priorUnit !== undefined && priorUnit !== quantity.unit) throw new StatusInputError("invalid_input");
    quantityUnits.set(quantity.kind, quantity.unit);
    const basisKey = `${quantity.kind}:${quantity.unit}`;
    const priorBasis = quantityBases.get(basisKey);
    if (priorBasis !== undefined && priorBasis !== quantity.basis) throw new StatusInputError("invalid_input");
    quantityBases.set(basisKey, quantity.basis);
    const key = quantity.basis === "delta"
      ? `${quantity.kind}:${quantity.unit}:delta:${quantity.contributionId}`
      : `${quantity.kind}:${quantity.unit}:cumulative`;
    if (identities.has(key)) throw new StatusInputError("invalid_input");
    identities.add(key);
  }
  quantities.sort((left, right) => {
    const a = `${left.kind}:${left.unit}:${left.basis}:${left.contributionId ?? ""}:${left.value}`;
    const b = `${right.kind}:${right.unit}:${right.basis}:${right.contributionId ?? ""}:${right.value}`;
    return a.localeCompare(b);
  });
  return { itemId: row.itemId, providerStatus: row.providerStatus, state: mapState(row.providerStatus, mapping), quantities };
}

function normalizeShipment(value: unknown, mapping: ProviderStatusMapping, tracking: TrackingHostPolicy): NormalizedStatusShipment {
  const row = snapshotExactRecord(value, ["shipmentId", "providerStatus", "items"], ["carrierCode", "trackingNumber", "trackingUrl"]);
  if (!isSafeToken(row.shipmentId) || !isSafeCode(row.providerStatus) ||
    (row.carrierCode !== undefined && !isSafeCode(row.carrierCode, 48)) ||
    (row.trackingNumber !== undefined && !isSafeToken(row.trackingNumber, 80))) {
    throw new StatusInputError("invalid_input");
  }
  const items = snapshotDenseArray(row.items, MAX_ITEMS).map((item) => normalizeItem(item, mapping));
  items.sort((left, right) => left.itemId.localeCompare(right.itemId));
  if (items.some((item, index) => index > 0 && item.itemId === items[index - 1]?.itemId)) {
    throw new StatusInputError("invalid_input");
  }
  const trackingUrl = validateTrackingUrl(row.trackingUrl, tracking);
  return {
    shipmentId: row.shipmentId,
    providerStatus: row.providerStatus,
    state: mapState(row.providerStatus, mapping),
    ...(row.carrierCode === undefined ? {} : { carrierCode: row.carrierCode as string }),
    ...(row.trackingNumber === undefined ? {} : { trackingNumber: row.trackingNumber as string }),
    ...(trackingUrl === undefined ? {} : { trackingUrl }),
    items
  };
}

function semanticFacts(input: {
  readonly providerRequestId: string;
  readonly providerStatus: string;
  readonly state: StatusState;
  readonly shipments: readonly NormalizedStatusShipment[];
}): unknown {
  return {
    providerRequestId: input.providerRequestId,
    state: input.state,
    ...(input.state === "unknown" ? { providerStatus: input.providerStatus } : {}),
    shipments: input.shipments.map((shipment) => ({
      shipmentId: shipment.shipmentId,
      state: shipment.state,
      ...(shipment.state === "unknown" ? { providerStatus: shipment.providerStatus } : {}),
      ...(shipment.carrierCode === undefined ? {} : { carrierCode: shipment.carrierCode }),
      ...(shipment.trackingNumber === undefined ? {} : { trackingNumber: shipment.trackingNumber }),
      ...(shipment.trackingUrl === undefined ? {} : { trackingUrl: shipment.trackingUrl }),
      items: shipment.items.map((item) => ({
        itemId: item.itemId,
        state: item.state,
        ...(item.state === "unknown" ? { providerStatus: item.providerStatus } : {}),
        quantities: item.quantities.map((quantity) => ({
          kind: quantity.kind,
          value: quantity.value,
          unit: quantity.unit,
          basis: quantity.basis,
          ...(quantity.contributionId === undefined ? {} : { contributionId: quantity.contributionId })
        }))
      }))
    }))
  };
}

export function stableDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function normalizeProviderObservation(
  value: unknown,
  sourceKind: ObservationSource,
  ingestedAt: number,
  mapping: ProviderStatusMapping,
  tracking: TrackingHostPolicy
): NormalizedStatusObservation {
  const policies = snapshotStatusPolicies(mapping, tracking);
  mapping = policies.mapping;
  tracking = policies.trackingPolicy;
  if (sourceKind !== "trusted_poll" && sourceKind !== "trusted_lookup") throw new StatusInputError("invalid_input");
  if (!Number.isSafeInteger(ingestedAt) || ingestedAt < 0) throw new StatusInputError("invalid_input");
  const row = snapshotExactRecord(value, ["providerRequestId", "providerStatus", "occurredAt", "shipments"], ["sourceObservationId", "sourceRevision"]);
  if (!isSafeToken(row.providerRequestId) || !isSafeCode(row.providerStatus) || !isCanonicalTimestamp(row.occurredAt) ||
    (row.sourceObservationId !== undefined && !isSafeToken(row.sourceObservationId)) ||
    (row.sourceRevision !== undefined && !isSafeToken(row.sourceRevision))) throw new StatusInputError("invalid_input");
  if (mapping.providerId.length === 0) throw new StatusInputError("invalid_policy");
  const shipments = snapshotDenseArray(row.shipments, MAX_SHIPMENTS).map((item) => normalizeShipment(item, mapping, tracking));
  shipments.sort((left, right) => left.shipmentId.localeCompare(right.shipmentId));
  if (shipments.some((item, index) => index > 0 && item.shipmentId === shipments[index - 1]?.shipmentId)) {
    throw new StatusInputError("invalid_input");
  }
  const state = mapState(row.providerStatus, mapping);
  const facts = semanticFacts({ providerRequestId: row.providerRequestId, providerStatus: row.providerStatus, state, shipments });
  const semanticDigest = stableDigest(facts);
  const sourceObservationId = (row.sourceObservationId as string | undefined) ?? `poll-${semanticDigest.slice(0, 48)}`;
  const sourceIdKind = row.sourceObservationId === undefined ? "derived_semantic" : "provider_supplied";
  const contentDigest = row.sourceObservationId === undefined
    ? semanticDigest
    : stableDigest({
        sourceObservationId,
        ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision }),
        providerRequestId: row.providerRequestId,
        providerStatus: row.providerStatus,
        state,
        occurredAt: row.occurredAt,
        shipments
      });
  const observationId = `obs-${stableDigest({ sourceObservationId, contentDigest, sourceKind }).slice(0, 48)}`;
  return {
    observationId,
    sourceObservationId,
    sourceIdKind,
    sourceKind,
    providerRequestId: row.providerRequestId,
    providerStatus: row.providerStatus,
    state,
    occurredAt: row.occurredAt,
    ingestedAt,
    contentDigest,
    semanticEffectId: `effect-${semanticDigest.slice(0, 48)}`,
    ...(row.sourceRevision === undefined ? {} : { sourceRevision: row.sourceRevision as string }),
    shipments
  };
}

export function fixtureStatusStateRank(state: StatusState): number | undefined {
  switch (state) {
    case "pending": return 0;
    case "accepted": return 10;
    case "in_production": return 20;
    case "shipped": return 30;
    case "delivered": return 40;
    case "cancel_requested": return undefined;
    case "cancel_rejected": return undefined;
    case "cancelled": return undefined;
    case "rejected": return undefined;
    case "failed": return undefined;
    case "unknown": return undefined;
  }
}
