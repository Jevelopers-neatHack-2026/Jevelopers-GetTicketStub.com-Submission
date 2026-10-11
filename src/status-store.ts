import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, unlink, link } from "node:fs/promises";
import { isAbsolute, join, parse, resolve, sep } from "node:path";
import { DurableJsonStore, DurableStoreError, type DurableJson } from "./metering-store.js";
import {
  fixtureStatusStateRank,
  isPlainDataRecord,
  isProjectedStatusState,
  isApprovedTrackingUrl,
  isStatusState,
  normalizeProviderObservation,
  snapshotDenseArray,
  snapshotExactRecord,
  snapshotStatusPolicies,
  stableDigest,
  StatusInputError,
  type NormalizedStatusObservation,
  type NormalizedStatusItem,
  type NormalizedStatusShipment,
  type ObservationSource,
  type ProjectedStatusState,
  type ProviderStatusMapping,
  type ProviderStatusObservation,
  type StatusState,
  type TrackingHostPolicy
} from "./status.js";

export type StatusStoreErrorCode =
  | "invalid_path"
  | "invalid_record"
  | "binding_mismatch"
  | "corrupt_state"
  | "unsupported_version"
  | "storage_busy"
  | "storage_unavailable"
  | "not_found"
  | "stale_lease"
  | "callbacks_disabled"
  | "policy_mismatch"
  | "conflict_unresolved"
  | "capacity_exceeded";

export class StatusStoreError extends Error {
  readonly code: StatusStoreErrorCode;

  constructor(code: StatusStoreErrorCode) {
    super(code);
    this.name = "StatusStoreError";
    this.code = code;
  }
}

export interface StatusScope {
  readonly tenantId: string;
  readonly projectId: string;
}

export interface PollPolicy {
  readonly policyId: string;
  readonly version: "fc-poll-policy-fixture/1";
  readonly policyState: "development_fixture";
  readonly minimumIntervalMs: number;
  readonly maximumBackoffMs: number;
  readonly maximumAttempts: number;
  readonly terminalStates: readonly StatusState[];
}

export type TrustedLookupRequest = {
  readonly providerId: string;
  readonly mode: "simulated" | "sandbox";
  readonly scope: StatusScope;
  readonly providerRequestId: string;
  readonly reason: "scheduled_poll" | "canonical_reconciliation";
};

export type TrustedLookupResponse =
  | { readonly status: "found"; readonly observation: unknown }
  | { readonly status: "rate_limited"; readonly retryAfterMs: number }
  | { readonly status: "unavailable" }
  | { readonly status: "ambiguous" };

export interface TrustedStatusLookup {
  /** The caller must bind this port to a reviewed authenticated provider read. */
  lookup(request: TrustedLookupRequest): Promise<TrustedLookupResponse>;
}

export interface LocalStatusStoreOptions {
  readonly directory: string;
  readonly providerId: string;
  readonly mode: "simulated" | "sandbox";
  readonly mapping: ProviderStatusMapping;
  readonly trackingPolicy: TrackingHostPolicy;
  readonly lookup: TrustedStatusLookup;
  /** Unverified hints remain disabled unless the containing app explicitly opts in. */
  readonly allowUnverifiedHints?: boolean;
  readonly clock?: { now(): number };
}

export interface ProjectedQuantity {
  readonly kind: "fulfilled" | "failed";
  readonly unit: string;
  readonly basis: "cumulative" | "delta";
  readonly total: number;
  readonly contributions: readonly { readonly id: string; readonly amount: number }[];
}

export interface ProjectedItem {
  readonly itemId: string;
  readonly state: ProjectedStatusState;
  readonly quantities: readonly ProjectedQuantity[];
}

export interface ProjectedShipment {
  readonly shipmentId: string;
  readonly state: ProjectedStatusState;
  readonly carrierCode?: string;
  readonly trackingNumber?: string;
  readonly trackingUrl?: string;
  readonly items: readonly ProjectedItem[];
}

export interface StatusProjection {
  readonly providerId: string;
  readonly mode: "simulated" | "sandbox";
  readonly scope: StatusScope;
  readonly providerRequestId: string;
  readonly state: ProjectedStatusState;
  /** Latest accepted root fact, retained while `state` summarizes unresolved conflicts. */
  readonly rootState: StatusState;
  readonly cancellationRequested: boolean;
  readonly shipments: readonly ProjectedShipment[];
  readonly observationIds: readonly string[];
  readonly conflictIds: readonly string[];
  readonly revision: number;
  /** Evidence timestamp only; never used to pick a winning state. */
  readonly updatedAt: number;
}

export type ConflictKind = "source_id_collision" | "terminal_contradiction" | "tracking_contradiction" | "quantity_contradiction";

export type ConflictLocation =
  | { readonly level: "root" }
  | { readonly level: "shipment"; readonly shipmentId: string }
  | { readonly level: "item"; readonly shipmentId: string; readonly itemId: string };

export interface StatusConflict {
  readonly conflictId: string;
  readonly providerId: string;
  readonly mode: "simulated" | "sandbox";
  readonly scope: StatusScope;
  readonly providerRequestId: string;
  readonly kind: ConflictKind;
  readonly location: ConflictLocation;
  readonly observationIds: readonly string[];
  readonly state: "unresolved" | "resolved";
  readonly createdAt: number;
  readonly resolutionId?: string;
}

export interface StatusCorrectionPolicy {
  readonly policyId: string;
  readonly version: string;
  readonly policyState: "development_fixture";
  readonly approvedBy: string;
  readonly allowedFrom: readonly StatusState[];
  readonly allowedTo: readonly StatusState[];
}

export interface StatusResolution {
  readonly resolutionId: string;
  readonly providerId: string;
  readonly mode: "simulated" | "sandbox";
  readonly scope: StatusScope;
  readonly providerRequestId: string;
  readonly conflictIds: readonly string[];
  readonly lookupObservationId: string;
  readonly correctedState: StatusState;
  readonly correctionPolicy: StatusCorrectionPolicy;
  readonly recordedAt: number;
}

export type PollTaskKind = "scheduled_poll" | "canonical_reconciliation";

export interface PollLease {
  readonly providerId: string;
  readonly mode: "simulated" | "sandbox";
  readonly scope: StatusScope;
  readonly providerRequestId: string;
  readonly kind: PollTaskKind;
  readonly token: string;
  readonly fence: number;
  readonly expiresAt: number;
}

export interface PollRunResult {
  readonly status: "no_due_work" | "observed" | "duplicate" | "retry_scheduled" | "unresolved";
  readonly kind?: PollTaskKind;
  readonly providerRequestId?: string;
  readonly observationId?: string;
  readonly safeFailure?: "lookup_unavailable" | "lookup_ambiguous" | "invalid_observation" | "rate_limited";
}

export interface StatusObservationRecord extends NormalizedStatusObservation {
  readonly providerId: string;
  readonly mode: "simulated" | "sandbox";
  readonly scope: StatusScope;
  readonly disposition: "applied" | "duplicate_effect" | "source_id_conflict" | "source_duplicate";
}

export interface StatusOutboxEvent {
  readonly eventId: string;
  readonly providerId: string;
  readonly mode: "simulated" | "sandbox";
  readonly scope: StatusScope;
  readonly providerRequestId: string;
  readonly causalEffectId: string;
  readonly payload: StatusProjection;
  readonly status: "pending" | "leased" | "acked";
  readonly leaseFence: number;
  readonly leaseToken?: string;
  readonly leaseUntil?: number;
  readonly leaseConsumer?: string;
  readonly ackToken?: string;
  readonly ackFence?: number;
  readonly ackConsumer?: string;
  readonly createdAt: number;
}

export interface StatusOutboxLease {
  readonly event: StatusOutboxEvent;
  readonly token: string;
  readonly fence: number;
  readonly expiresAt: number;
}

interface CallbackHintRecord {
  readonly hintId: string;
  readonly providerRequestId: string;
  readonly scope: StatusScope;
  readonly receivedAt: number;
}

interface PollLeaseRecord {
  readonly kind: PollTaskKind;
  readonly token: string;
  readonly fence: number;
  readonly expiresAt: number;
}

interface PollTargetRecord {
  readonly providerRequestId: string;
  readonly scope: StatusScope;
  readonly policy: PollPolicy;
  readonly state: "active" | "stopped_terminal" | "exhausted";
  readonly nextPollAt: number;
  readonly attempts: number;
  readonly reconciliationAttempts: number;
  readonly nextReconciliationAt?: number;
  readonly trustedNotBeforeAt?: number;
  readonly lastLookupFailure?: "lookup_unavailable" | "lookup_ambiguous" | "invalid_observation" | "rate_limited";
  readonly leaseFence: number;
  readonly lease?: PollLeaseRecord;
}

interface StateBinding {
  readonly providerId: string;
  readonly mode: "simulated" | "sandbox";
  readonly ownerUid: number | null;
  readonly mappingVersion: string;
  readonly mappingDigest: string;
  readonly trackingPolicyId: string;
  readonly trackingPolicyVersion: string;
  readonly trackingPolicyDigest: string;
}

interface StatusStoreState {
  readonly format: "fc-status-store/2";
  readonly binding: StateBinding;
  readonly observations: readonly StatusObservationRecord[];
  readonly projections: readonly StatusProjection[];
  readonly conflicts: readonly StatusConflict[];
  readonly resolutions: readonly StatusResolution[];
  readonly pollTargets: readonly PollTargetRecord[];
  readonly callbackHints: readonly CallbackHintRecord[];
  readonly outbox: readonly StatusOutboxEvent[];
  readonly effectIds: readonly string[];
}

const STORE_FORMAT = "fc-status-store/2" as const;
const MARKER_FORMAT = "fc-status-commit/1";
const STATE_DIRECTORY = ".status-store-v1";
const COMMIT_MARKER = ".status-store-committed.json";
const MAX_STATE_ROWS = 100_000;
const MAX_SCOPE = 128;
const MAX_LEASE_MS = 300_000;
const MAX_RETRY_AFTER_MS = 86_400_000;
const MAX_PROJECTED_SHIPMENTS = 200;
const MAX_PROJECTED_ITEMS = 2_000;
const MAX_PROJECTED_QUANTITIES = 4_000;
const MAX_PROJECTED_CONTRIBUTIONS = 10_000;
const TERMINAL_STATES = new Set<StatusState>(["delivered", "cancelled", "rejected", "failed"]);

function fail(code: StatusStoreErrorCode): never {
  throw new StatusStoreError(code);
}

function errorCode(error: unknown): string | undefined {
  try {
    if (error === null || typeof error !== "object") return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(error, "code");
    return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function uid(): number | null {
  const getter = (process as NodeJS.Process & { getuid?: () => number }).getuid;
  return typeof getter === "function" ? getter() : null;
}

function safeToken(value: unknown, maximum = MAX_SCOPE): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value) && !value.includes("@");
}

function validTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 8_640_000_000_000_000;
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return isPlainDataRecord(value);
}

function exactKeys(value: unknown, required: readonly string[], optional: readonly string[] = []): value is Record<string, unknown> {
  if (!plainRecord(value)) return false;
  try {
    const allowed = new Set([...required, ...optional]);
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== "string" || !allowed.has(key)) ||
      required.some((key) => !Object.hasOwn(value, key))) return false;
    return keys.every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor !== undefined && "value" in descriptor && descriptor.enumerable;
    });
  } catch {
    return false;
  }
}

function normalizeScope(value: unknown): StatusScope {
  const row = snapshotExactRecord(value, ["tenantId", "projectId"]);
  if (!safeToken(row.tenantId) || !safeToken(row.projectId)) fail("invalid_record");
  return { tenantId: row.tenantId, projectId: row.projectId };
}

function sameScope(left: StatusScope, right: StatusScope): boolean {
  return left.tenantId === right.tenantId && left.projectId === right.projectId;
}

function scopeKey(providerId: string, mode: string, scope: StatusScope, requestId: string): string {
  return stableDigest({ providerId, mode, tenantId: scope.tenantId, projectId: scope.projectId, providerRequestId: requestId });
}

function ownerBinding(
  providerId: string,
  mode: "simulated" | "sandbox",
  mapping: ProviderStatusMapping,
  trackingPolicy: TrackingHostPolicy
): StateBinding {
  return {
    providerId,
    mode,
    ownerUid: uid(),
    mappingVersion: mapping.version,
    mappingDigest: stableDigest(mapping.statuses),
    trackingPolicyId: trackingPolicy.policyId,
    trackingPolicyVersion: trackingPolicy.version,
    trackingPolicyDigest: stableDigest(trackingPolicy.approvedHosts)
  };
}

function initialState(binding: StateBinding): StatusStoreState {
  return {
    format: STORE_FORMAT,
    binding,
    observations: [],
    projections: [],
    conflicts: [],
    resolutions: [],
    pollTargets: [],
    callbackHints: [],
    outbox: [],
    effectIds: []
  };
}

function isMode(value: unknown): value is "simulated" | "sandbox" {
  return value === "simulated" || value === "sandbox";
}

function isScope(value: unknown): value is StatusScope {
  return exactKeys(value, ["tenantId", "projectId"]) && safeToken(value.tenantId) && safeToken(value.projectId);
}

function isSafeStatusTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && Math.abs(parsed) <= 8_640_000_000_000_000 && new Date(parsed).toISOString() === value;
}

function isNormalizedQuantity(value: unknown): boolean {
  if (!exactKeys(value, ["kind", "value", "unit", "basis"], ["contributionId"])) return false;
  if ((value.kind !== "fulfilled" && value.kind !== "failed") ||
    !Number.isSafeInteger(value.value) || (value.value as number) < 1 ||
    !safeToken(value.unit, 32) || (value.basis !== "cumulative" && value.basis !== "delta")) return false;
  return value.basis === "delta" ? safeToken(value.contributionId) : value.contributionId === undefined;
}

function isNormalizedItem(value: unknown): boolean {
  if (!exactKeys(value, ["itemId", "providerStatus", "state", "quantities"]) ||
    !safeToken(value.itemId) || !safeToken(value.providerStatus, 96) || !isStatusState(value.state)) return false;
  try {
    return snapshotDenseArray(value.quantities, 4_000).every(isNormalizedQuantity);
  } catch {
    return false;
  }
}

function isNormalizedShipment(value: unknown, trackingPolicy: TrackingHostPolicy): boolean {
  if (!exactKeys(value, ["shipmentId", "providerStatus", "state", "items"], ["carrierCode", "trackingNumber", "trackingUrl"]) ||
    !safeToken(value.shipmentId) || !safeToken(value.providerStatus, 96) || !isStatusState(value.state) ||
    (value.carrierCode !== undefined && !safeToken(value.carrierCode, 48)) ||
    (value.trackingNumber !== undefined && !safeToken(value.trackingNumber, 80)) ||
    (value.trackingUrl !== undefined && !isApprovedTrackingUrl(value.trackingUrl, trackingPolicy))) return false;
  try {
    const items = snapshotDenseArray(value.items, 2_000);
    return items.every(isNormalizedItem) && new Set(items.map((item) => (item as Record<string, unknown>).itemId)).size === items.length;
  } catch {
    return false;
  }
}

function isObservation(value: unknown, trackingPolicy: TrackingHostPolicy): value is StatusObservationRecord {
  if (!exactKeys(value,
    ["observationId", "sourceObservationId", "sourceIdKind", "sourceKind", "providerRequestId", "providerStatus", "state", "occurredAt", "ingestedAt", "contentDigest", "semanticEffectId", "shipments", "providerId", "mode", "scope", "disposition"],
    ["sourceRevision"])) return false;
  if (!safeToken(value.observationId) || !safeToken(value.providerId) || !isMode(value.mode) || !isScope(value.scope) ||
    !safeToken(value.sourceObservationId) || (value.sourceIdKind !== "provider_supplied" && value.sourceIdKind !== "derived_semantic") ||
    (value.sourceKind !== "trusted_poll" && value.sourceKind !== "trusted_lookup") ||
    !safeToken(value.providerRequestId) || !safeToken(value.providerStatus, 96) || !isStatusState(value.state) ||
    !isSafeStatusTimestamp(value.occurredAt) || !validTime(value.ingestedAt) ||
    typeof value.contentDigest !== "string" || !/^[0-9a-f]{64}$/u.test(value.contentDigest) ||
    !safeToken(value.semanticEffectId) ||
    (value.sourceRevision !== undefined && !safeToken(value.sourceRevision)) ||
    (value.disposition !== "applied" && value.disposition !== "duplicate_effect" &&
      value.disposition !== "source_id_conflict" && value.disposition !== "source_duplicate")) return false;
  try {
    return snapshotDenseArray(value.shipments, 200).every((shipment) => isNormalizedShipment(shipment, trackingPolicy));
  } catch {
    return false;
  }
}

function rehydrateObservation(
  record: StatusObservationRecord,
  mapping: ProviderStatusMapping,
  trackingPolicy: TrackingHostPolicy
): NormalizedStatusObservation {
  const input: ProviderStatusObservation = {
    providerRequestId: record.providerRequestId,
    providerStatus: record.providerStatus,
    occurredAt: record.occurredAt,
    ...(record.sourceIdKind === "provider_supplied" ? { sourceObservationId: record.sourceObservationId } : {}),
    ...(record.sourceRevision === undefined ? {} : { sourceRevision: record.sourceRevision }),
    shipments: record.shipments.map((shipment) => ({
      shipmentId: shipment.shipmentId,
      providerStatus: shipment.providerStatus,
      ...(shipment.carrierCode === undefined ? {} : { carrierCode: shipment.carrierCode }),
      ...(shipment.trackingNumber === undefined ? {} : { trackingNumber: shipment.trackingNumber }),
      ...(shipment.trackingUrl === undefined ? {} : { trackingUrl: shipment.trackingUrl }),
      items: shipment.items.map((item) => ({
        itemId: item.itemId,
        providerStatus: item.providerStatus,
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
  try {
    return normalizeProviderObservation(input, record.sourceKind, record.ingestedAt, mapping, trackingPolicy);
  } catch {
    fail("corrupt_state");
  }
}

function isProjectedQuantity(value: unknown): boolean {
  if (!exactKeys(value, ["kind", "unit", "basis", "total", "contributions"]) ||
    (value.kind !== "fulfilled" && value.kind !== "failed") || !safeToken(value.unit, 32) ||
    (value.basis !== "cumulative" && value.basis !== "delta") || !Number.isSafeInteger(value.total) ||
    (value.total as number) < 1) return false;
  try {
    const contributions = snapshotDenseArray(value.contributions, MAX_PROJECTED_CONTRIBUTIONS);
    if (value.basis === "cumulative") return contributions.length === 0 && (value.total as number) <= 1_000_000;
    if (contributions.length === 0) return false;
    let total = 0;
    const ids = new Set<string>();
    for (const item of contributions) {
      if (!exactKeys(item, ["id", "amount"]) || !safeToken(item.id) ||
        !Number.isSafeInteger(item.amount) || (item.amount as number) < 1 || (item.amount as number) > 1_000_000 ||
        ids.has(item.id as string)) return false;
      ids.add(item.id as string);
      total += item.amount as number;
      if (!Number.isSafeInteger(total)) return false;
    }
    return total === value.total;
  } catch {
    return false;
  }
}

function isProjectedItem(value: unknown): boolean {
  if (!exactKeys(value, ["itemId", "state", "quantities"]) || !safeToken(value.itemId) || !isProjectedStatusState(value.state)) return false;
  try {
    const quantities = snapshotDenseArray(value.quantities, MAX_PROJECTED_QUANTITIES);
    if (!quantities.every(isProjectedQuantity)) return false;
    const bucketKeys = new Set<string>();
    const units = new Map<string, string>();
    const bases = new Map<string, string>();
    for (const quantity of quantities as ProjectedQuantity[]) {
      const kindUnit = `${quantity.kind}:${quantity.unit}`;
      const priorUnit = units.get(quantity.kind);
      const priorBasis = bases.get(kindUnit);
      const key = `${kindUnit}:${quantity.basis}`;
      if (bucketKeys.has(key) || priorUnit !== undefined && priorUnit !== quantity.unit ||
        priorBasis !== undefined && priorBasis !== quantity.basis) return false;
      bucketKeys.add(key);
      units.set(quantity.kind, quantity.unit);
      bases.set(kindUnit, quantity.basis);
    }
    return true;
  } catch {
    return false;
  }
}

function isProjectedShipment(value: unknown, trackingPolicy: TrackingHostPolicy): boolean {
  if (!exactKeys(value, ["shipmentId", "state", "items"], ["carrierCode", "trackingNumber", "trackingUrl"]) ||
    !safeToken(value.shipmentId) || !isProjectedStatusState(value.state) ||
    (value.carrierCode !== undefined && !safeToken(value.carrierCode, 48)) ||
    (value.trackingNumber !== undefined && !safeToken(value.trackingNumber, 80)) ||
    (value.trackingUrl !== undefined && !isApprovedTrackingUrl(value.trackingUrl, trackingPolicy))) return false;
  try {
    const items = snapshotDenseArray(value.items, MAX_PROJECTED_ITEMS);
    return items.every(isProjectedItem) && new Set(items.map((item) => (item as Record<string, unknown>).itemId)).size === items.length;
  } catch {
    return false;
  }
}

function isProjection(value: unknown, trackingPolicy: TrackingHostPolicy): value is StatusProjection {
  if (!exactKeys(value, ["providerId", "mode", "scope", "providerRequestId", "state", "rootState", "cancellationRequested", "shipments", "observationIds", "conflictIds", "revision", "updatedAt"]) ||
    !safeToken(value.providerId) || !isMode(value.mode) || !isScope(value.scope) ||
    !safeToken(value.providerRequestId) || !isProjectedStatusState(value.state) || !isStatusState(value.rootState) ||
    typeof value.cancellationRequested !== "boolean" ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || !validTime(value.updatedAt)) return false;
  try {
    const shipments = snapshotDenseArray(value.shipments, MAX_PROJECTED_SHIPMENTS);
    const observations = snapshotDenseArray(value.observationIds, 100_000);
    const conflicts = snapshotDenseArray(value.conflictIds, 100_000);
    return shipments.every((item) => isProjectedShipment(item, trackingPolicy)) && observations.every((item) => safeToken(item)) &&
      conflicts.every((item) => safeToken(item)) && new Set(shipments.map((item) => (item as Record<string, unknown>).shipmentId)).size === shipments.length &&
      new Set(observations).size === observations.length && new Set(conflicts).size === conflicts.length &&
      (value.state === "conflict" ? conflicts.length > 0 : conflicts.length === 0 && value.state === value.rootState);
  } catch {
    return false;
  }
}

function isPollPolicy(value: unknown): value is PollPolicy {
  if (!exactKeys(value, ["policyId", "version", "policyState", "minimumIntervalMs", "maximumBackoffMs", "maximumAttempts", "terminalStates"]) ||
    !safeToken(value.policyId) || value.version !== "fc-poll-policy-fixture/1" || value.policyState !== "development_fixture" ||
    !Number.isSafeInteger(value.minimumIntervalMs) || (value.minimumIntervalMs as number) < 1_000 ||
    !Number.isSafeInteger(value.maximumBackoffMs) || (value.maximumBackoffMs as number) < (value.minimumIntervalMs as number) ||
    (value.maximumBackoffMs as number) > MAX_RETRY_AFTER_MS || !Number.isSafeInteger(value.maximumAttempts) ||
    (value.maximumAttempts as number) < 1 || (value.maximumAttempts as number) > 100) return false;
  try {
    const terminals = snapshotDenseArray(value.terminalStates, 4);
    return terminals.length > 0 && terminals.every((item) => isStatusState(item) && TERMINAL_STATES.has(item)) &&
      new Set(terminals).size === terminals.length;
  } catch {
    return false;
  }
}

function isPollTarget(value: unknown): boolean {
  if (!exactKeys(value,
    ["providerRequestId", "scope", "policy", "state", "nextPollAt", "attempts", "reconciliationAttempts", "leaseFence"],
    ["nextReconciliationAt", "trustedNotBeforeAt", "lastLookupFailure", "lease"])) return false;
  if (!safeToken(value.providerRequestId) || !isScope(value.scope) || !isPollPolicy(value.policy) ||
    (value.state !== "active" && value.state !== "stopped_terminal" && value.state !== "exhausted") ||
    !validTime(value.nextPollAt) || !Number.isSafeInteger(value.attempts) || (value.attempts as number) < 0 ||
    !Number.isSafeInteger(value.reconciliationAttempts) || (value.reconciliationAttempts as number) < 0 ||
    !Number.isSafeInteger(value.leaseFence) || (value.leaseFence as number) < 0 ||
    (value.nextReconciliationAt !== undefined && !validTime(value.nextReconciliationAt)) ||
    (value.trustedNotBeforeAt !== undefined && !validTime(value.trustedNotBeforeAt)) ||
    (value.trustedNotBeforeAt !== undefined && value.state === "active" &&
      (value.nextPollAt as number) < (value.trustedNotBeforeAt as number)) ||
    (value.nextReconciliationAt !== undefined && value.trustedNotBeforeAt !== undefined &&
      (value.nextReconciliationAt as number) < (value.trustedNotBeforeAt as number)) ||
    (value.lastLookupFailure !== undefined && !["lookup_unavailable", "lookup_ambiguous", "invalid_observation", "rate_limited"].includes(value.lastLookupFailure as string))) return false;
  if (value.lease !== undefined) {
    const lease = value.lease;
    if (!exactKeys(lease, ["kind", "token", "fence", "expiresAt"]) ||
      (lease.kind !== "scheduled_poll" && lease.kind !== "canonical_reconciliation") || !safeToken(lease.token) ||
      !Number.isSafeInteger(lease.fence) || (lease.fence as number) < 1 || lease.fence !== value.leaseFence ||
      !validTime(lease.expiresAt)) return false;
  }
  return true;
}

function isConflictLocation(value: unknown): value is ConflictLocation {
  if (!plainRecord(value)) return false;
  if (value.level === "root") return exactKeys(value, ["level"]);
  if (value.level === "shipment") return exactKeys(value, ["level", "shipmentId"]) && safeToken(value.shipmentId);
  if (value.level === "item") return exactKeys(value, ["level", "shipmentId", "itemId"]) &&
    safeToken(value.shipmentId) && safeToken(value.itemId);
  return false;
}

function isConflict(value: unknown): boolean {
  if (!exactKeys(value,
    ["conflictId", "providerId", "mode", "scope", "providerRequestId", "kind", "location", "observationIds", "state", "createdAt"],
    ["resolutionId"])) return false;
  return safeToken(value.conflictId) && safeToken(value.providerId) && isMode(value.mode) &&
    isScope(value.scope) && safeToken(value.providerRequestId) &&
    ["source_id_collision", "terminal_contradiction", "tracking_contradiction", "quantity_contradiction"].includes(value.kind as string) &&
    isConflictLocation(value.location) &&
    Array.isArray(value.observationIds) && snapshotDenseArray(value.observationIds, 4).length >= 2 &&
    snapshotDenseArray(value.observationIds, 4).every((item) => safeToken(item)) &&
    (value.state === "unresolved" || value.state === "resolved") && validTime(value.createdAt) &&
    (value.state === "unresolved" ? value.resolutionId === undefined : safeToken(value.resolutionId));
}

function isCorrectionPolicy(value: unknown): value is StatusCorrectionPolicy {
  if (!exactKeys(value, ["policyId", "version", "policyState", "approvedBy", "allowedFrom", "allowedTo"]) ||
    !safeToken(value.policyId) || !safeToken(value.version) || value.policyState !== "development_fixture" || !safeToken(value.approvedBy)) return false;
  try {
    const from = snapshotDenseArray(value.allowedFrom, 4);
    const to = snapshotDenseArray(value.allowedTo, 4);
    return from.length > 0 && to.length === 1 && from.every((item) => isStatusState(item) && TERMINAL_STATES.has(item)) &&
      to.every((item) => isStatusState(item) && TERMINAL_STATES.has(item)) &&
      new Set(from).size === from.length && new Set(to).size === to.length;
  } catch {
    return false;
  }
}

function isResolution(value: unknown): boolean {
  if (!exactKeys(value, ["resolutionId", "providerId", "mode", "scope", "providerRequestId", "conflictIds", "lookupObservationId", "correctedState", "correctionPolicy", "recordedAt"])) return false;
  const conflictIds = snapshotDenseArray(value.conflictIds, 100);
  return safeToken(value.resolutionId) && safeToken(value.providerId) && isMode(value.mode) && isScope(value.scope) &&
    safeToken(value.providerRequestId) && conflictIds.length > 0 && conflictIds.every((item) => safeToken(item)) &&
    new Set(conflictIds).size === conflictIds.length &&
    safeToken(value.lookupObservationId) && isStatusState(value.correctedState) && TERMINAL_STATES.has(value.correctedState) &&
    isCorrectionPolicy(value.correctionPolicy) && validTime(value.recordedAt);
}

function isCallbackHint(value: unknown): boolean {
  return exactKeys(value, ["hintId", "providerRequestId", "scope", "receivedAt"]) && safeToken(value.hintId) &&
    safeToken(value.providerRequestId) && isScope(value.scope) && validTime(value.receivedAt);
}

function isOutboxEvent(value: unknown, trackingPolicy: TrackingHostPolicy): boolean {
  if (!exactKeys(value,
    ["eventId", "providerId", "mode", "scope", "providerRequestId", "causalEffectId", "payload", "status", "leaseFence", "createdAt"],
    ["leaseToken", "leaseUntil", "leaseConsumer", "ackToken", "ackFence", "ackConsumer"])) return false;
  const leaseKeys = ["leaseToken", "leaseUntil", "leaseConsumer"] as const;
  const ackKeys = ["ackToken", "ackFence", "ackConsumer"] as const;
  const hasAnyLease = leaseKeys.some((key) => Object.hasOwn(value, key));
  const hasAllLease = leaseKeys.every((key) => Object.hasOwn(value, key));
  const hasAnyAck = ackKeys.some((key) => Object.hasOwn(value, key));
  const hasAllAck = ackKeys.every((key) => Object.hasOwn(value, key));
  return safeToken(value.eventId) && safeToken(value.providerId) && isMode(value.mode) && isScope(value.scope) &&
    safeToken(value.providerRequestId) && safeToken(value.causalEffectId) && isProjection(value.payload, trackingPolicy) &&
    (value.status === "pending" || value.status === "leased" || value.status === "acked") &&
    Number.isSafeInteger(value.leaseFence) && (value.leaseFence as number) >= 0 && validTime(value.createdAt) &&
    (value.status === "pending" ? !hasAnyLease && !hasAnyAck && value.leaseFence === 0 :
      value.status === "leased" ? hasAllLease && !hasAnyAck && (value.leaseFence as number) >= 1 &&
        safeToken(value.leaseToken) && validTime(value.leaseUntil) && safeToken(value.leaseConsumer) :
        hasAllAck && !hasAnyLease && (value.leaseFence as number) >= 1 && value.ackFence === value.leaseFence &&
          safeToken(value.ackToken) && Number.isSafeInteger(value.ackFence) && (value.ackFence as number) >= 1 &&
          safeToken(value.ackConsumer));
}

function decodeState(
  value: unknown,
  binding: StateBinding,
  mapping: ProviderStatusMapping,
  trackingPolicy: TrackingHostPolicy,
  requireCommittedState = false
): StatusStoreState {
  if (!plainRecord(value)) fail("corrupt_state");
  if (typeof value.format === "string" && value.format.startsWith("fc-status-store/") && value.format !== STORE_FORMAT) {
    fail("unsupported_version");
  }
  const required = ["format", "binding", "observations", "projections", "conflicts", "resolutions", "pollTargets", "callbackHints", "outbox", "effectIds"];
  const bindingKeys = ["providerId", "mode", "ownerUid", "mappingVersion", "mappingDigest", "trackingPolicyId", "trackingPolicyVersion", "trackingPolicyDigest"];
  if (!exactKeys(value, required) || value.format !== STORE_FORMAT || !exactKeys(value.binding, bindingKeys) ||
    value.binding.providerId !== binding.providerId || value.binding.mode !== binding.mode || value.binding.ownerUid !== binding.ownerUid ||
    value.binding.mappingVersion !== binding.mappingVersion || value.binding.mappingDigest !== binding.mappingDigest ||
    value.binding.trackingPolicyId !== binding.trackingPolicyId || value.binding.trackingPolicyVersion !== binding.trackingPolicyVersion ||
    value.binding.trackingPolicyDigest !== binding.trackingPolicyDigest) {
    if (exactKeys(value, required) && exactKeys(value.binding, bindingKeys) &&
      (value.binding.providerId !== binding.providerId || value.binding.mode !== binding.mode || value.binding.ownerUid !== binding.ownerUid ||
        value.binding.mappingVersion !== binding.mappingVersion || value.binding.mappingDigest !== binding.mappingDigest ||
        value.binding.trackingPolicyId !== binding.trackingPolicyId || value.binding.trackingPolicyVersion !== binding.trackingPolicyVersion ||
        value.binding.trackingPolicyDigest !== binding.trackingPolicyDigest)) {
      fail("binding_mismatch");
    }
    fail("corrupt_state");
  }
  try {
    const observations = snapshotDenseArray(value.observations, MAX_STATE_ROWS);
    const projections = snapshotDenseArray(value.projections, MAX_STATE_ROWS);
    const conflicts = snapshotDenseArray(value.conflicts, MAX_STATE_ROWS);
    const resolutions = snapshotDenseArray(value.resolutions, MAX_STATE_ROWS);
    const pollTargets = snapshotDenseArray(value.pollTargets, MAX_STATE_ROWS);
    const callbackHints = snapshotDenseArray(value.callbackHints, MAX_STATE_ROWS);
    const outbox = snapshotDenseArray(value.outbox, MAX_STATE_ROWS);
    const effectIds = snapshotDenseArray(value.effectIds, MAX_STATE_ROWS);
    if (requireCommittedState && pollTargets.length === 0) fail("corrupt_state");
    if (!observations.every((item) => isObservation(item, trackingPolicy)) ||
      !projections.every((item) => isProjection(item, trackingPolicy)) || !conflicts.every(isConflict) ||
      !resolutions.every(isResolution) || !pollTargets.every(isPollTarget) || !callbackHints.every(isCallbackHint) ||
      !outbox.every((item) => isOutboxEvent(item, trackingPolicy)) || !effectIds.every((item) => safeToken(item)) ||
      new Set(observations.map((item) => (item as StatusObservationRecord).observationId)).size !== observations.length ||
      new Set(effectIds).size !== effectIds.length ||
      new Set(projections.map((item) => `${scopeKey((item as StatusProjection).providerId, (item as StatusProjection).mode,
        (item as StatusProjection).scope, (item as StatusProjection).providerRequestId)}`)).size !== projections.length ||
      new Set(conflicts.map((item) => (item as StatusConflict).conflictId)).size !== conflicts.length ||
      new Set(resolutions.map((item) => (item as StatusResolution).resolutionId)).size !== resolutions.length ||
      new Set(pollTargets.map((item) => scopeKey(binding.providerId, binding.mode, (item as PollTargetRecord).scope,
        (item as PollTargetRecord).providerRequestId))).size !== pollTargets.length ||
      new Set(outbox.map((item) => (item as StatusOutboxEvent).eventId)).size !== outbox.length) fail("corrupt_state");
    if ((observations as StatusObservationRecord[]).some((row) => row.providerId !== binding.providerId || row.mode !== binding.mode) ||
      (projections as StatusProjection[]).some((row) => row.providerId !== binding.providerId || row.mode !== binding.mode) ||
      (conflicts as StatusConflict[]).some((row) => row.providerId !== binding.providerId || row.mode !== binding.mode) ||
      (resolutions as StatusResolution[]).some((row) => row.providerId !== binding.providerId || row.mode !== binding.mode) ||
      (outbox as StatusOutboxEvent[]).some((row) => row.providerId !== binding.providerId || row.mode !== binding.mode)) fail("corrupt_state");
    const observationMap = new Map(observations.map((item) => [(item as StatusObservationRecord).observationId, item as StatusObservationRecord]));
    const conflictMap = new Map(conflicts.map((item) => [(item as StatusConflict).conflictId, item as StatusConflict]));
    const resolutionMap = new Map(resolutions.map((item) => [(item as StatusResolution).resolutionId, item as StatusResolution]));
    const projectionMap = new Map((projections as StatusProjection[]).map((item) =>
      [scopeKey(item.providerId, item.mode, item.scope, item.providerRequestId), item]));
    const pollTargetMap = new Map((pollTargets as PollTargetRecord[]).map((item) =>
      [scopeKey(binding.providerId, binding.mode, item.scope, item.providerRequestId), item]));
    const sameBinding = (row: { providerId: string; mode: "simulated" | "sandbox"; scope: StatusScope; providerRequestId: string },
      other: { providerId: string; mode: "simulated" | "sandbox"; scope: StatusScope; providerRequestId: string }): boolean =>
      row.providerId === other.providerId && row.mode === other.mode && row.providerRequestId === other.providerRequestId &&
      scopeMatches(row.scope, other.scope);
    for (const projection of projections as StatusProjection[]) {
      if (!projection.observationIds.every((id) => {
        const observation = observationMap.get(id);
        return observation !== undefined && sameBinding(projection, observation);
      }) || !projection.conflictIds.every((id) => {
        const conflict = conflictMap.get(id);
        return conflict !== undefined && conflict.state === "unresolved" && sameBinding(projection, conflict);
      })) fail("corrupt_state");
    }
    for (const conflict of conflicts as StatusConflict[]) {
      if (!conflict.observationIds.every((id) => {
        const observation = observationMap.get(id);
        return observation !== undefined && sameBinding(conflict, observation);
      })) fail("corrupt_state");
      if (conflict.state === "resolved") {
        const resolution = resolutionMap.get(conflict.resolutionId as string);
        if (resolution === undefined || !resolution.conflictIds.includes(conflict.conflictId) || !sameBinding(conflict, resolution)) fail("corrupt_state");
      }
    }
    for (const resolution of resolutions as StatusResolution[]) {
      if (resolution.conflictIds.length !== 1) fail("corrupt_state");
      const conflict = conflictMap.get(resolution.conflictIds[0]!);
      const lookup = observationMap.get(resolution.lookupObservationId);
      const lookupState = lookup === undefined || conflict === undefined
        ? undefined
        : observationStateAtLocation(lookup, conflict.location);
      if (conflict === undefined || conflict.state !== "resolved" || conflict.resolutionId !== resolution.resolutionId ||
        !sameBinding(resolution, conflict) || lookup === undefined || lookup.sourceKind !== "trusted_lookup" ||
        lookupState !== resolution.correctedState || !sameBinding(resolution, lookup)) fail("corrupt_state");
    }
    for (const event of outbox as StatusOutboxEvent[]) {
      const expectedId = `status-${stableDigest({
        providerId: binding.providerId,
        mode: binding.mode,
        tenantId: event.scope.tenantId,
        projectId: event.scope.projectId,
        providerRequestId: event.providerRequestId,
        causalEffectId: event.causalEffectId
      }).slice(0, 48)}`;
      if (!sameBinding(event, event.payload) || event.eventId !== expectedId) fail("corrupt_state");
    }

    const targetFor = (scope: StatusScope, requestId: string): PollTargetRecord | undefined =>
      pollTargetMap.get(scopeKey(binding.providerId, binding.mode, scope, requestId));
    for (const projection of projections as StatusProjection[]) {
      if (targetFor(projection.scope, projection.providerRequestId) === undefined) fail("corrupt_state");
    }
    for (const conflict of conflicts as StatusConflict[]) {
      if (targetFor(conflict.scope, conflict.providerRequestId) === undefined) fail("corrupt_state");
    }
    const hintIds = new Set<string>();
    for (const hint of callbackHints as CallbackHintRecord[]) {
      const key = `${scopeKey(binding.providerId, binding.mode, hint.scope, hint.providerRequestId)}:${hint.hintId}`;
      if (hintIds.has(key) || targetFor(hint.scope, hint.providerRequestId) === undefined) fail("corrupt_state");
      hintIds.add(key);
    }
    for (const target of pollTargets as PollTargetRecord[]) {
      const key = scopeKey(binding.providerId, binding.mode, target.scope, target.providerRequestId);
      const projection = projectionMap.get(key);
      const unresolved = (conflicts as StatusConflict[]).some((conflict) => conflict.state === "unresolved" &&
        conflict.providerId === binding.providerId && conflict.mode === binding.mode &&
        conflict.providerRequestId === target.providerRequestId && scopeMatches(conflict.scope, target.scope));
      if ((target.nextReconciliationAt !== undefined) !== unresolved &&
        !(unresolved && target.state === "exhausted" && target.nextReconciliationAt === undefined &&
          target.reconciliationAttempts >= target.policy.maximumAttempts)) fail("corrupt_state");
      if (target.state === "stopped_terminal" && (unresolved || projection === undefined ||
        projection.state === "conflict" || !target.policy.terminalStates.includes(projection.state as StatusState))) fail("corrupt_state");
      if (target.state === "exhausted" && target.attempts < target.policy.maximumAttempts &&
        (!unresolved || target.reconciliationAttempts < target.policy.maximumAttempts)) fail("corrupt_state");
    }

    // Rebuild the immutable inbox, effect index, projections, conflicts, and event payloads
    // from their persisted causes. This catches shaped but disconnected rows at reopen.
    const observationRows = observations as StatusObservationRecord[];
    const observationIndex = new Map(observationRows.map((row, index) => [row.observationId, index]));
    const emissions = new Map<string, { readonly kind: "observation"; readonly observationIndex: number } | {
      readonly kind: "resolution"; readonly resolution: StatusResolution
    }>();
    const registerEmission = (cause: string, emission: { readonly kind: "observation"; readonly observationIndex: number } | {
      readonly kind: "resolution"; readonly resolution: StatusResolution
    }): void => {
      if (emissions.has(cause)) fail("corrupt_state");
      emissions.set(cause, emission);
    };
    for (const [index, observation] of observationRows.entries()) {
      if (observation.disposition === "applied") {
        registerEmission(observation.semanticEffectId, { kind: "observation", observationIndex: index });
      } else if (observation.disposition === "source_id_conflict") {
        const conflict = (conflicts as StatusConflict[]).find((candidate) => candidate.kind === "source_id_collision" &&
          candidate.observationIds.includes(observation.observationId));
        if (conflict === undefined) fail("corrupt_state");
        registerEmission(`conflict-${conflict.conflictId}`, { kind: "observation", observationIndex: index });
      }
    }
    for (const resolution of resolutions as StatusResolution[]) {
      registerEmission(`correction-${resolution.resolutionId}`, { kind: "resolution", resolution });
    }
    if (emissions.size !== outbox.length || (outbox as StatusOutboxEvent[]).some((event) => !emissions.has(event.causalEffectId))) {
      fail("corrupt_state");
    }

    const applyRecordedResolution = (state: StatusStoreState, resolution: StatusResolution): StatusStoreState => {
      const conflictIndex = state.conflicts.findIndex((conflict) => conflict.conflictId === resolution.conflictIds[0] &&
        conflict.state === "unresolved" && sameBinding(resolution, conflict));
      if (resolution.conflictIds.length !== 1 || conflictIndex < 0) fail("corrupt_state");
      const conflict = state.conflicts[conflictIndex]!;
      if (conflict.kind !== "terminal_contradiction") fail("corrupt_state");
      const lookup = state.observations.find((observation) => observation.observationId === resolution.lookupObservationId &&
        observation.sourceKind === "trusted_lookup" && sameBinding(resolution, observation));
      const conflictObservations = conflict.observationIds.map((id) => state.observations.find((observation) => observation.observationId === id));
      const lookupState = lookup === undefined ? undefined : observationStateAtLocation(lookup, conflict.location);
      if (lookup === undefined || lookupState !== resolution.correctedState || !isStatusState(lookupState) || !TERMINAL_STATES.has(lookupState) ||
        !resolution.correctionPolicy.allowedTo.includes(lookupState) || conflictObservations.some((observation) => {
          if (observation === undefined) return true;
          const observed = observationStateAtLocation(observation, conflict.location);
          return !isStatusState(observed) || !TERMINAL_STATES.has(observed) || !resolution.correctionPolicy.allowedFrom.includes(observed);
        })) fail("corrupt_state");
      const expectedResolutionId = `resolution-${stableDigest({
        scopeKey: scopeKey(binding.providerId, binding.mode, resolution.scope, resolution.providerRequestId),
        conflictId: conflict.conflictId,
        lookupObservationId: lookup.observationId,
        correctedState: lookupState,
        policy: resolution.correctionPolicy
      }).slice(0, 48)}`;
      if (resolution.resolutionId !== expectedResolutionId) fail("corrupt_state");
      const conflicts = state.conflicts.slice();
      conflicts[conflictIndex] = { ...conflict, state: "resolved", resolutionId: resolution.resolutionId };
      const unresolved = conflicts.some((item) => item.providerId === binding.providerId && item.mode === binding.mode &&
        item.providerRequestId === resolution.providerRequestId && scopeMatches(item.scope, resolution.scope) && item.state === "unresolved");
      const projectionIndex = state.projections.findIndex((item) => sameBinding(item, resolution));
      if (projectionIndex < 0) fail("corrupt_state");
      const projection = state.projections[projectionIndex]!;
      const locationUpdated = withProjectionLocationState(projection, conflict.location, lookupState);
      if (locationUpdated === undefined) fail("corrupt_state");
      const unresolvedIds = conflicts.filter((item) => item.providerId === binding.providerId && item.mode === binding.mode &&
        item.providerRequestId === resolution.providerRequestId && scopeMatches(item.scope, resolution.scope) && item.state === "unresolved")
        .map((item) => item.conflictId);
      const updatedProjection: StatusProjection = {
        ...locationUpdated,
        state: unresolved ? "conflict" : locationUpdated.rootState,
        cancellationRequested: conflict.location.level === "root" && lookupState === "cancelled"
          ? false
          : projection.cancellationRequested,
        conflictIds: unresolvedIds,
        revision: projection.revision + 1,
        updatedAt: resolution.recordedAt
      };
      const projections = state.projections.slice();
      projections[projectionIndex] = updatedProjection;
      const outbox = appendOutbox(state.outbox, binding, resolution.scope, resolution.providerRequestId,
        `correction-${resolution.resolutionId}`, updatedProjection, resolution.recordedAt);
      return { ...state, conflicts, projections, outbox, resolutions: pushBounded(state.resolutions, resolution) };
    };

    let rebuilt = initialState(binding);
    let nextObservation = 0;
    const replayObservationsThrough = (lastIndex: number): void => {
      if (lastIndex < nextObservation) return;
      for (; nextObservation <= lastIndex; nextObservation += 1) {
        const record = observationRows[nextObservation]!;
        const normalized = rehydrateObservation(record, mapping, trackingPolicy);
        const key = scopeKey(binding.providerId, binding.mode, record.scope, record.providerRequestId);
        const expectedObservationId = `obs-${stableDigest({ key, sourceObservationId: normalized.sourceObservationId,
          contentDigest: normalized.contentDigest, sourceKind: normalized.sourceKind }).slice(0, 48)}`;
        const expectedEffectId = `effect-${stableDigest({ key, semanticEffectId: normalized.semanticEffectId }).slice(0, 48)}`;
        if (record.sourceObservationId !== normalized.sourceObservationId || record.sourceIdKind !== normalized.sourceIdKind ||
          record.contentDigest !== normalized.contentDigest || record.semanticEffectId !== expectedEffectId ||
          record.observationId !== expectedObservationId || record.providerStatus !== normalized.providerStatus ||
          record.state !== normalized.state || stableDigest(record.shipments) !== stableDigest(normalized.shipments)) fail("corrupt_state");
        rebuilt = applyStatusObservation(rebuilt, binding, record.scope, normalized).state;
      }
    };
    const immutableOutbox = (event: StatusOutboxEvent): unknown => ({
      eventId: event.eventId,
      providerId: event.providerId,
      mode: event.mode,
      scope: event.scope,
      providerRequestId: event.providerRequestId,
      causalEffectId: event.causalEffectId,
      payload: event.payload,
      createdAt: event.createdAt
    });
    for (const event of outbox as StatusOutboxEvent[]) {
      const emission = emissions.get(event.causalEffectId);
      if (emission === undefined) fail("corrupt_state");
      if (emission.kind === "observation") {
        replayObservationsThrough(emission.observationIndex);
      } else {
        const lookupIndex = observationIndex.get(emission.resolution.lookupObservationId);
        if (lookupIndex === undefined) fail("corrupt_state");
        replayObservationsThrough(lookupIndex);
        rebuilt = applyRecordedResolution(rebuilt, emission.resolution);
      }
      const rebuiltEvent = rebuilt.outbox[rebuilt.outbox.length - 1];
      if (rebuiltEvent === undefined || rebuiltEvent.causalEffectId !== event.causalEffectId ||
        stableDigest(immutableOutbox(rebuiltEvent)) !== stableDigest(immutableOutbox(event))) fail("corrupt_state");
    }
    if (nextObservation < observationRows.length) replayObservationsThrough(observationRows.length - 1);
    if (stableDigest(rebuilt.observations) !== stableDigest(observations) ||
      stableDigest(rebuilt.projections) !== stableDigest(projections) ||
      stableDigest(rebuilt.conflicts) !== stableDigest(conflicts) ||
      stableDigest(rebuilt.resolutions) !== stableDigest(resolutions) ||
      stableDigest(rebuilt.effectIds) !== stableDigest(effectIds) || rebuilt.outbox.length !== outbox.length ||
      (rebuilt.outbox as StatusOutboxEvent[]).some((event, index) => {
        const persisted = (outbox as StatusOutboxEvent[])[index];
        return persisted === undefined || stableDigest(immutableOutbox(event)) !== stableDigest(immutableOutbox(persisted));
      })) fail("corrupt_state");
    return value as unknown as StatusStoreState;
  } catch (error) {
    if (error instanceof StatusStoreError) throw error;
    fail("corrupt_state");
  }
}

interface CommitMarker {
  readonly format: typeof MARKER_FORMAT;
  readonly providerId: string;
  readonly mode: "simulated" | "sandbox";
  readonly ownerUid: number | null;
  readonly state: "pending" | "committed";
  readonly pid: number;
  readonly token: string;
}

function durableValue(value: StatusStoreState): DurableJson {
  return JSON.parse(JSON.stringify(value)) as DurableJson;
}

function errorToStore(error: unknown): StatusStoreError {
  if (error instanceof StatusStoreError) return error;
  if (error instanceof DurableStoreError) {
    if (error.code === "corrupt_state") return new StatusStoreError("corrupt_state");
    if (error.code === "invalid_path") return new StatusStoreError("invalid_path");
    if (error.code === "storage_busy") return new StatusStoreError("storage_busy");
  }
  if (error instanceof StatusInputError) return new StatusStoreError("invalid_record");
  const code = errorCode(error);
  if (code === "EACCES" || code === "EPERM") return new StatusStoreError("storage_unavailable");
  if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") return new StatusStoreError("invalid_path");
  return new StatusStoreError("storage_unavailable");
}

async function assertNoSymlinkAncestors(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let cursor = root;
  for (const component of absolute.slice(root.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, component);
    let metadata;
    try {
      metadata = await lstat(cursor);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) fail("invalid_path");
  }
}

async function assertPrivateDirectory(path: string, expectedUid: number | null, create: boolean): Promise<void> {
  const absolute = resolve(path);
  if (!isAbsolute(path) || absolute !== path) fail("invalid_path");
  await assertNoSymlinkAncestors(absolute);
  if (create) await mkdir(absolute, { recursive: true, mode: 0o700 });
  const metadata = await lstat(absolute);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) fail("invalid_path");
  if (expectedUid !== null && metadata.uid !== expectedUid) fail("storage_unavailable");
  if (process.platform !== "win32" && ((metadata.mode & 0o077) !== 0 || (metadata.mode & 0o200) === 0)) {
    fail("storage_unavailable");
  }
  if (await realpath(absolute) !== absolute) fail("invalid_path");
}

async function assertManagedFile(path: string, expectedUid: number | null): Promise<boolean> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) fail("invalid_path");
    if (expectedUid !== null && metadata.uid !== expectedUid) fail("storage_unavailable");
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) fail("storage_unavailable");
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw errorToStore(error);
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

function parseMarker(value: unknown, binding: StateBinding): CommitMarker {
  if (!plainRecord(value)) fail("corrupt_state");
  if (typeof value.format === "string" && value.format.startsWith("fc-status-commit/") && value.format !== MARKER_FORMAT) {
    fail("unsupported_version");
  }
  if (!exactKeys(value, ["format", "providerId", "mode", "ownerUid", "state", "pid", "token"]) ||
    value.format !== MARKER_FORMAT || !safeToken(value.providerId) || !isMode(value.mode) ||
    !(value.ownerUid === null || (Number.isSafeInteger(value.ownerUid) && (value.ownerUid as number) >= 0)) ||
    (value.state !== "pending" && value.state !== "committed") || !Number.isSafeInteger(value.pid) ||
    (value.pid as number) < 1 || !safeToken(value.token)) fail("corrupt_state");
  if (value.providerId !== binding.providerId || value.mode !== binding.mode || value.ownerUid !== binding.ownerUid) {
    fail("binding_mismatch");
  }
  const marker = value as unknown as CommitMarker;
  if (marker.state === "pending") {
    if (processIsAlive(marker.pid)) fail("storage_busy");
    fail("corrupt_state");
  }
  return marker;
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function writeMarker(directory: string, binding: StateBinding, state: "pending" | "committed", token: string): Promise<void> {
  const destination = join(directory, COMMIT_MARKER);
  const temporary = join(directory, `.status-commit-${randomUUID()}.tmp`);
  const marker: CommitMarker = {
    format: MARKER_FORMAT,
    providerId: binding.providerId,
    mode: binding.mode,
    ownerUid: binding.ownerUid,
    state,
    pid: process.pid,
    token
  };
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(JSON.stringify(marker), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (state === "pending") await link(temporary, destination);
    else await rename(temporary, destination);
    await syncDirectory(directory);
  } catch (error) {
    if (handle !== undefined) {
      try { await handle.close(); } catch { /* marker is not published until synced */ }
    }
    throw errorToStore(error);
  } finally {
    try { await unlink(temporary); } catch { /* a published marker remains authoritative */ }
  }
}

function isValidPollPolicy(value: unknown): value is PollPolicy {
  return isPollPolicy(value);
}

function scopeMatches(left: StatusScope, right: StatusScope): boolean {
  return sameScope(left, right);
}

function pushBounded<T>(rows: readonly T[], item: T): readonly T[] {
  if (rows.length >= MAX_STATE_ROWS) fail("capacity_exceeded");
  return [...rows, item];
}

function assertProposedStateCapacity(state: StatusStoreState): void {
  const rows: readonly (readonly unknown[])[] = [
    state.observations, state.projections, state.conflicts, state.resolutions, state.pollTargets,
    state.callbackHints, state.outbox, state.effectIds
  ];
  if (rows.some((items) => items.length > MAX_STATE_ROWS)) fail("capacity_exceeded");
  for (const projection of state.projections) {
    if (projection.shipments.length > MAX_PROJECTED_SHIPMENTS) fail("capacity_exceeded");
    for (const shipment of projection.shipments) {
      if (shipment.items.length > MAX_PROJECTED_ITEMS) fail("capacity_exceeded");
      for (const item of shipment.items) {
        if (item.quantities.length > MAX_PROJECTED_QUANTITIES) fail("capacity_exceeded");
        for (const quantity of item.quantities) {
          if (quantity.contributions.length > MAX_PROJECTED_CONTRIBUTIONS) fail("capacity_exceeded");
        }
      }
    }
  }
  for (const observation of state.observations) {
    if (observation.shipments.length > MAX_PROJECTED_SHIPMENTS) fail("capacity_exceeded");
    for (const shipment of observation.shipments) {
      if (shipment.items.length > MAX_PROJECTED_ITEMS) fail("capacity_exceeded");
      for (const item of shipment.items) {
        if (item.quantities.length > MAX_PROJECTED_QUANTITIES) fail("capacity_exceeded");
      }
    }
  }
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizePollPolicy(value: unknown): PollPolicy {
  const row = snapshotExactRecord(value, ["policyId", "version", "policyState", "minimumIntervalMs", "maximumBackoffMs", "maximumAttempts", "terminalStates"]);
  if (!isValidPollPolicy(row)) fail("invalid_record");
  const terminalStates = snapshotDenseArray(row.terminalStates, 4).slice().sort() as StatusState[];
  return {
    policyId: row.policyId as string,
    version: "fc-poll-policy-fixture/1",
    policyState: "development_fixture",
    minimumIntervalMs: row.minimumIntervalMs as number,
    maximumBackoffMs: row.maximumBackoffMs as number,
    maximumAttempts: row.maximumAttempts as number,
    terminalStates
  };
}

function normalizeCorrectionPolicy(value: unknown): StatusCorrectionPolicy {
  const row = snapshotExactRecord(value, ["policyId", "version", "policyState", "approvedBy", "allowedFrom", "allowedTo"]);
  if (!isCorrectionPolicy(row)) fail("invalid_record");
  const allowedFrom = snapshotDenseArray(row.allowedFrom, 4).slice().sort() as StatusState[];
  const allowedTo = snapshotDenseArray(row.allowedTo, 4).slice().sort() as StatusState[];
  if (new Set(allowedFrom).size !== allowedFrom.length || new Set(allowedTo).size !== allowedTo.length) fail("invalid_record");
  return {
    policyId: row.policyId as string,
    version: row.version as string,
    policyState: "development_fixture",
    approvedBy: row.approvedBy as string,
    allowedFrom,
    allowedTo
  };
}

function hasUnresolvedConflict(
  state: StatusStoreState,
  scope: StatusScope,
  requestId: string,
  providerId: string,
  mode: "simulated" | "sandbox"
): boolean {
  return state.conflicts.some((conflict) => conflict.providerId === providerId && conflict.mode === mode &&
    conflict.providerRequestId === requestId && scopeMatches(conflict.scope, scope) && conflict.state === "unresolved");
}

function appendOutbox(
  rows: readonly StatusOutboxEvent[],
  binding: StateBinding,
  scope: StatusScope,
  providerRequestId: string,
  causalEffectId: string,
  payload: StatusProjection,
  createdAt: number
): readonly StatusOutboxEvent[] {
  const eventId = `status-${stableDigest({
    providerId: binding.providerId,
    mode: binding.mode,
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    providerRequestId,
    causalEffectId
  }).slice(0, 48)}`;
  const prior = rows.find((event) => event.eventId === eventId);
  if (prior !== undefined) {
    if (prior.causalEffectId !== causalEffectId || stableDigest(prior.payload) !== stableDigest(payload)) fail("corrupt_state");
    return rows;
  }
  const event: StatusOutboxEvent = {
    eventId,
    providerId: binding.providerId,
    mode: binding.mode,
    scope,
    providerRequestId,
    causalEffectId,
    payload,
    status: "pending",
    leaseFence: 0,
    createdAt
  };
  return pushBounded(rows, event);
}

function emptyProjection(
  binding: StateBinding,
  scope: StatusScope,
  providerRequestId: string,
  now: number
): StatusProjection {
  return {
    providerId: binding.providerId,
    mode: binding.mode,
    scope,
    providerRequestId,
    state: "unknown",
    rootState: "unknown",
    cancellationRequested: false,
    shipments: [],
    observationIds: [],
    conflictIds: [],
    revision: 0,
    updatedAt: now
  };
}

function isTerminalState(state: StatusState): boolean {
  return TERMINAL_STATES.has(state);
}

function mergeState(current: StatusState, incoming: StatusState): { readonly state: ProjectedStatusState; readonly terminalConflict: boolean } {
  if (current === incoming) return { state: current, terminalConflict: false };
  if (current === "cancel_requested" || current === "cancel_rejected") {
    return { state: incoming === "cancel_rejected" ? "unknown" : incoming, terminalConflict: false };
  }
  if (incoming === "cancel_requested" || incoming === "cancel_rejected") {
    return { state: current, terminalConflict: false };
  }
  if (isTerminalState(current) && isTerminalState(incoming)) return { state: "conflict", terminalConflict: true };
  if (isTerminalState(current)) return { state: current, terminalConflict: false };
  if (isTerminalState(incoming)) return { state: incoming, terminalConflict: false };
  if (incoming === "unknown") return { state: current, terminalConflict: false };
  if (current === "unknown") return { state: incoming, terminalConflict: false };
  const currentRank = fixtureStatusStateRank(current);
  const incomingRank = fixtureStatusStateRank(incoming);
  if (currentRank !== undefined && incomingRank !== undefined) {
    return { state: incomingRank > currentRank ? incoming : current, terminalConflict: false };
  }
  return { state: current, terminalConflict: false };
}

function recordConflict(
  state: StatusStoreState,
  binding: StateBinding,
  scope: StatusScope,
  providerRequestId: string,
  kind: ConflictKind,
  location: ConflictLocation,
  observationIds: readonly string[],
  now: number
): { readonly state: StatusStoreState; readonly conflict: StatusConflict } {
  const ids = [...new Set(observationIds)].sort();
  if (ids.length < 2 || ids.length > 4) fail("corrupt_state");
  const conflictId = `conflict-${stableDigest({
    key: scopeKey(binding.providerId, binding.mode, scope, providerRequestId), kind, location, observationIds: ids
  }).slice(0, 48)}`;
  const existing = state.conflicts.find((conflict) => conflict.conflictId === conflictId);
  if (existing !== undefined) return { state, conflict: existing };
  const conflict: StatusConflict = {
    conflictId,
    providerId: binding.providerId,
    mode: binding.mode,
    scope,
    providerRequestId,
    kind,
    location,
    observationIds: ids,
    state: "unresolved",
    createdAt: now
  };
  return { state: { ...state, conflicts: pushBounded(state.conflicts, conflict) }, conflict };
}

function observationStateAtLocation(
  observation: Pick<StatusObservationRecord, "state" | "shipments">,
  location: ConflictLocation
): StatusState | undefined {
  if (location.level === "root") return observation.state;
  const shipment = observation.shipments.find((item) => item.shipmentId === location.shipmentId);
  if (shipment === undefined) return undefined;
  if (location.level === "shipment") return shipment.state;
  return shipment.items.find((item) => item.itemId === location.itemId)?.state;
}

function withProjectionLocationState(
  projection: StatusProjection,
  location: ConflictLocation,
  state: StatusState
): StatusProjection | undefined {
  if (location.level === "root") return { ...projection, rootState: state };
  const shipmentIndex = projection.shipments.findIndex((item) => item.shipmentId === location.shipmentId);
  if (shipmentIndex < 0) return undefined;
  const shipments = projection.shipments.slice();
  const shipment = shipments[shipmentIndex]!;
  if (location.level === "shipment") {
    shipments[shipmentIndex] = { ...shipment, state };
    return { ...projection, shipments };
  }
  const itemIndex = shipment.items.findIndex((item) => item.itemId === location.itemId);
  if (itemIndex < 0) return undefined;
  const items = shipment.items.slice();
  items[itemIndex] = { ...items[itemIndex]!, state };
  shipments[shipmentIndex] = { ...shipment, items };
  return { ...projection, shipments };
}

function priorLocationObservationId(
  state: StatusStoreState,
  projection: StatusProjection,
  incomingId: string,
  location: ConflictLocation,
  matchingState?: StatusState
): string | undefined {
  return [...projection.observationIds].reverse().find((id) => {
    if (id === incomingId) return false;
    const observation = state.observations.find((item) => item.observationId === id);
    if (observation === undefined) return false;
    const value = observationStateAtLocation(observation, location);
    return value !== undefined && (matchingState === undefined || value === matchingState);
  });
}

function mergeQuantities(
  previous: readonly ProjectedQuantity[],
  incoming: NormalizedStatusItem["quantities"]
): { readonly quantities: readonly ProjectedQuantity[]; readonly conflict: boolean } {
  const quantities: ProjectedQuantity[] = previous.map((quantity): ProjectedQuantity => ({
    ...quantity,
    contributions: [...quantity.contributions]
  }));
  const bucketIndex = new Map<string, number>();
  const contributionIndex = new Map<string, Map<string, number>>();
  const keyFor = (kind: string, unit: string, basis: string): string => `${kind}:${unit}:${basis}`;
  for (const [index, quantity] of quantities.entries()) {
    const key = keyFor(quantity.kind, quantity.unit, quantity.basis);
    bucketIndex.set(key, index);
    contributionIndex.set(key, new Map(quantity.contributions.map((item) => [item.id, item.amount])));
  }
  let conflict = false;
  for (const fact of incoming) {
    const sameKindUnit = quantities.filter((quantity) => quantity.kind === fact.kind && quantity.unit === fact.unit);
    if (quantities.some((quantity) => quantity.kind === fact.kind && quantity.unit !== fact.unit)) {
      conflict = true;
      continue;
    }
    if (sameKindUnit.some((quantity) => quantity.basis !== fact.basis)) {
      conflict = true;
      continue;
    }
    const key = keyFor(fact.kind, fact.unit, fact.basis);
    const index = bucketIndex.get(key) ?? -1;
    if (fact.basis === "cumulative") {
      if (index < 0) {
        quantities.push({ kind: fact.kind, unit: fact.unit, basis: fact.basis, total: fact.value, contributions: [] });
        bucketIndex.set(key, quantities.length - 1);
        contributionIndex.set(key, new Map());
      } else if (fact.value < quantities[index]!.total) {
        conflict = true;
      } else if (fact.value > quantities[index]!.total) {
        quantities[index] = { ...quantities[index]!, total: fact.value };
      }
      continue;
    }
    if (fact.contributionId === undefined) fail("invalid_record");
    if (index < 0) {
      quantities.push({ kind: fact.kind, unit: fact.unit, basis: fact.basis, total: 0, contributions: [] });
      bucketIndex.set(key, quantities.length - 1);
      contributionIndex.set(key, new Map());
    }
    const quantityIndex = bucketIndex.get(key)!;
    const quantity = quantities[quantityIndex]!;
    const contributions = contributionIndex.get(key)!;
    const priorAmount = contributions.get(fact.contributionId);
    if (priorAmount !== undefined) {
      if (priorAmount !== fact.value) conflict = true;
      continue;
    }
    const total = quantity.total + fact.value;
    if (!Number.isSafeInteger(total)) fail("capacity_exceeded");
    if (quantity.contributions.length >= MAX_PROJECTED_CONTRIBUTIONS) fail("capacity_exceeded");
    contributions.set(fact.contributionId, fact.value);
    const updated: ProjectedQuantity = {
      kind: fact.kind,
      unit: fact.unit,
      basis: fact.basis,
      total,
      contributions: [...quantity.contributions, { id: fact.contributionId, amount: fact.value }]
    };
    quantities[quantityIndex] = updated;
  }
  for (let index = 0; index < quantities.length; index += 1) {
    const quantity = quantities[index]!;
    if (quantity.basis === "delta") {
      quantities[index] = {
        ...quantity,
        contributions: [...quantity.contributions].sort((left, right) => left.id.localeCompare(right.id))
      };
    }
  }
  quantities.sort((left, right) => `${left.kind}:${left.unit}:${left.basis}`.localeCompare(`${right.kind}:${right.unit}:${right.basis}`));
  return { quantities, conflict };
}

function normalizeTrustedResponse(value: unknown):
  | { readonly status: "found"; readonly observation: unknown }
  | { readonly status: "rate_limited"; readonly retryAfterMs: number }
  | { readonly status: "unavailable" }
  | { readonly status: "ambiguous" } {
  try {
    const row = snapshotExactRecord(value, ["status"], ["observation", "retryAfterMs"]);
    if (row.status === "found" && Object.hasOwn(row, "observation") && !Object.hasOwn(row, "retryAfterMs")) {
      return { status: "found", observation: row.observation };
    }
    if (row.status === "rate_limited" && !Object.hasOwn(row, "observation") && Number.isSafeInteger(row.retryAfterMs) &&
      (row.retryAfterMs as number) >= 0 && (row.retryAfterMs as number) <= MAX_RETRY_AFTER_MS) {
      return { status: "rate_limited", retryAfterMs: row.retryAfterMs as number };
    }
    if (row.status === "unavailable" && !Object.hasOwn(row, "observation") && !Object.hasOwn(row, "retryAfterMs")) return { status: "unavailable" };
    if (row.status === "ambiguous" && !Object.hasOwn(row, "observation") && !Object.hasOwn(row, "retryAfterMs")) return { status: "ambiguous" };
  } catch {
    // The caller receives only a safe failure class.
  }
  return { status: "unavailable" };
}

function applyStatusObservation(
  original: StatusStoreState,
  binding: StateBinding,
  scope: StatusScope,
  normalized: NormalizedStatusObservation
): { readonly state: StatusStoreState; readonly disposition: "applied" | "duplicate" | "conflict"; readonly observationId: string } {
  const key = scopeKey(binding.providerId, binding.mode, scope, normalized.providerRequestId);
  const observationId = `obs-${stableDigest({ key, sourceObservationId: normalized.sourceObservationId,
    contentDigest: normalized.contentDigest, sourceKind: normalized.sourceKind }).slice(0, 48)}`;
  const semanticEffectId = `effect-${stableDigest({ key, semanticEffectId: normalized.semanticEffectId }).slice(0, 48)}`;
  const observation: StatusObservationRecord = {
    ...normalized,
    observationId,
    semanticEffectId,
    providerId: binding.providerId,
    mode: binding.mode,
    scope,
    disposition: "applied"
  };
  const sameObservation = original.observations.find((item) => item.observationId === observation.observationId);
  if (sameObservation !== undefined) {
    return {
      state: original,
      disposition: sameObservation.disposition === "source_id_conflict" ? "conflict" : "duplicate",
      observationId: sameObservation.observationId
    };
  }
  const sourcePrior = original.observations.find((item) => item.providerId === binding.providerId && item.mode === binding.mode &&
    item.providerRequestId === normalized.providerRequestId && scopeMatches(item.scope, scope) &&
    item.sourceObservationId === normalized.sourceObservationId);
  if (sourcePrior !== undefined && sourcePrior.contentDigest === observation.contentDigest) {
    if (sourcePrior.sourceKind === observation.sourceKind) {
      return { state: original, disposition: "duplicate", observationId: sourcePrior.observationId };
    }
    const audit: StatusObservationRecord = { ...observation, disposition: "source_duplicate" };
    return {
      state: { ...original, observations: pushBounded(original.observations, audit) },
      disposition: "duplicate",
      observationId: audit.observationId
    };
  }

  const projectionIndex = original.projections.findIndex((item) => item.providerId === binding.providerId && item.mode === binding.mode &&
    item.providerRequestId === normalized.providerRequestId && scopeMatches(item.scope, scope));
  const previousProjection = projectionIndex < 0
    ? emptyProjection(binding, scope, normalized.providerRequestId, normalized.ingestedAt)
    : original.projections[projectionIndex]!;
  if (sourcePrior !== undefined) {
    const conflictingObservation: StatusObservationRecord = { ...observation, disposition: "source_id_conflict" };
    let state: StatusStoreState = { ...original, observations: pushBounded(original.observations, conflictingObservation) };
    const conflictResult = recordConflict(state, binding, scope, normalized.providerRequestId, "source_id_collision",
      { level: "root" }, [sourcePrior.observationId, conflictingObservation.observationId], normalized.ingestedAt);
    state = conflictResult.state;
    const conflictIds = state.conflicts.filter((item) => item.providerId === binding.providerId && item.mode === binding.mode &&
      item.providerRequestId === normalized.providerRequestId && scopeMatches(item.scope, scope) && item.state === "unresolved")
      .map((item) => item.conflictId);
    const updatedProjection: StatusProjection = {
      ...previousProjection,
      state: "conflict",
      conflictIds,
      observationIds: previousProjection.observationIds.includes(conflictingObservation.observationId)
        ? previousProjection.observationIds
        : pushBounded(previousProjection.observationIds, conflictingObservation.observationId),
      revision: previousProjection.revision + 1,
      updatedAt: normalized.ingestedAt
    };
    const projections = state.projections.slice();
    if (projectionIndex < 0) projections.push(updatedProjection);
    else projections[projectionIndex] = updatedProjection;
    const outbox = appendOutbox(state.outbox, binding, scope, normalized.providerRequestId,
      `conflict-${conflictResult.conflict.conflictId}`, updatedProjection, normalized.ingestedAt);
    return {
      state: { ...state, projections, outbox },
      disposition: "conflict",
      observationId: conflictingObservation.observationId
    };
  }

  const priorEffect = original.effectIds.includes(semanticEffectId);
  if (priorEffect) {
    const duplicateEffect: StatusObservationRecord = { ...observation, disposition: "duplicate_effect" };
    return {
      state: { ...original, observations: pushBounded(original.observations, duplicateEffect) },
      disposition: "duplicate",
      observationId: duplicateEffect.observationId
    };
  }

  const storedObservation = observation;
  let state: StatusStoreState = { ...original, observations: pushBounded(original.observations, storedObservation) };
  const projection = cloneJson(previousProjection);
  let rootState = projection.rootState;
  let cancellationRequested = projection.cancellationRequested;
  let topConflict = false;
  if (normalized.state === "cancel_requested") cancellationRequested = true;
  else if (normalized.state === "cancel_rejected") cancellationRequested = false;
  else if (normalized.state !== "unknown") {
    const merged = mergeState(rootState, normalized.state);
    topConflict = merged.terminalConflict;
    if (!merged.terminalConflict && isStatusState(merged.state)) rootState = merged.state;
  }

  if (topConflict && isTerminalState(projection.rootState)) {
    const rootLocation: ConflictLocation = { level: "root" };
    const unresolvedRoot = state.conflicts.find((item) => item.providerId === binding.providerId && item.mode === binding.mode &&
      item.providerRequestId === normalized.providerRequestId && scopeMatches(item.scope, scope) &&
      item.kind === "terminal_contradiction" && item.state === "unresolved" && stableDigest(item.location) === stableDigest(rootLocation));
    const incomingStateAlreadyCaptured = unresolvedRoot?.observationIds.some((id) => {
      const prior = state.observations.find((item) => item.observationId === id);
      return prior !== undefined && observationStateAtLocation(prior, rootLocation) === normalized.state;
    }) ?? false;
    if (!incomingStateAlreadyCaptured) {
      const priorTerminalId = priorLocationObservationId(state, projection, observationId, rootLocation, projection.rootState);
      if (priorTerminalId === undefined) fail("corrupt_state");
      const conflict = recordConflict(state, binding, scope, normalized.providerRequestId, "terminal_contradiction",
        rootLocation, [priorTerminalId, observationId], normalized.ingestedAt);
      state = conflict.state;
    }
  }

  const existingShipments = new Map(projection.shipments.map((shipment) => [shipment.shipmentId, shipment]));
  const updatedShipments: ProjectedShipment[] = [];
  for (const incomingShipment of normalized.shipments) {
    const previousShipment = existingShipments.get(incomingShipment.shipmentId);
    if (previousShipment === undefined) {
      updatedShipments.push({
        shipmentId: incomingShipment.shipmentId,
        state: incomingShipment.state,
        ...(incomingShipment.carrierCode === undefined ? {} : { carrierCode: incomingShipment.carrierCode }),
        ...(incomingShipment.trackingNumber === undefined ? {} : { trackingNumber: incomingShipment.trackingNumber }),
        ...(incomingShipment.trackingUrl === undefined ? {} : { trackingUrl: incomingShipment.trackingUrl }),
        items: incomingShipment.items.map((item) => ({
          itemId: item.itemId,
          state: item.state,
          quantities: mergeQuantities([], item.quantities).quantities
        }))
      });
      existingShipments.delete(incomingShipment.shipmentId);
      continue;
    }

    const mergedShipmentState = mergeState(
      previousShipment.state === "conflict" ? "unknown" : previousShipment.state,
      incomingShipment.state
    );
    let shipmentState: ProjectedStatusState = previousShipment.state === "conflict" ? "conflict" : mergedShipmentState.state;
    if (mergedShipmentState.terminalConflict) {
      const location: ConflictLocation = { level: "shipment", shipmentId: incomingShipment.shipmentId };
      const priorId = priorLocationObservationId(state, projection, observationId, location,
        isStatusState(previousShipment.state) ? previousShipment.state : undefined);
      if (priorId === undefined) fail("corrupt_state");
      const conflict = recordConflict(state, binding, scope, normalized.providerRequestId, "terminal_contradiction",
        location, [priorId, observationId], normalized.ingestedAt);
      state = conflict.state;
      shipmentState = "conflict";
    }
    const mergeTracking = (oldValue: string | undefined, newValue: string | undefined): string | undefined => {
      if (newValue === undefined) return oldValue;
      if (oldValue === undefined || oldValue === newValue) return newValue;
      const location: ConflictLocation = { level: "shipment", shipmentId: incomingShipment.shipmentId };
      const priorId = priorLocationObservationId(state, projection, observationId, location);
      if (priorId === undefined) fail("corrupt_state");
      const conflict = recordConflict(state, binding, scope, normalized.providerRequestId, "tracking_contradiction",
        location, [priorId, observationId], normalized.ingestedAt);
      state = conflict.state;
      return oldValue;
    };
    const carrierCode = mergeTracking(previousShipment.carrierCode, incomingShipment.carrierCode);
    const trackingNumber = mergeTracking(previousShipment.trackingNumber, incomingShipment.trackingNumber);
    const trackingUrl = mergeTracking(previousShipment.trackingUrl, incomingShipment.trackingUrl);
    const itemsById = new Map(previousShipment.items.map((item) => [item.itemId, item]));
    const mergedItems: ProjectedItem[] = [];
    for (const incomingItem of incomingShipment.items) {
      const previousItem = itemsById.get(incomingItem.itemId);
      if (previousItem === undefined) {
        mergedItems.push({
          itemId: incomingItem.itemId,
          state: incomingItem.state,
          quantities: mergeQuantities([], incomingItem.quantities).quantities
        });
        itemsById.delete(incomingItem.itemId);
        continue;
      }
      const mergedItemState = mergeState(previousItem.state === "conflict" ? "unknown" : previousItem.state, incomingItem.state);
      let itemState: ProjectedStatusState = previousItem.state === "conflict" ? "conflict" : mergedItemState.state;
      if (mergedItemState.terminalConflict) {
        const location: ConflictLocation = {
          level: "item", shipmentId: incomingShipment.shipmentId, itemId: incomingItem.itemId
        };
        const priorId = priorLocationObservationId(state, projection, observationId, location,
          isStatusState(previousItem.state) ? previousItem.state : undefined);
        if (priorId === undefined) fail("corrupt_state");
        const conflict = recordConflict(state, binding, scope, normalized.providerRequestId, "terminal_contradiction",
          location, [priorId, observationId], normalized.ingestedAt);
        state = conflict.state;
        itemState = "conflict";
      }
      const mergedQuantities = mergeQuantities(previousItem.quantities, incomingItem.quantities);
      if (mergedQuantities.conflict) {
        const location: ConflictLocation = {
          level: "item", shipmentId: incomingShipment.shipmentId, itemId: incomingItem.itemId
        };
        const priorId = priorLocationObservationId(state, projection, observationId, location);
        if (priorId === undefined) fail("corrupt_state");
        const conflict = recordConflict(state, binding, scope, normalized.providerRequestId, "quantity_contradiction",
          location, [priorId, observationId], normalized.ingestedAt);
        state = conflict.state;
      }
      mergedItems.push({ itemId: incomingItem.itemId, state: itemState, quantities: mergedQuantities.quantities });
      itemsById.delete(incomingItem.itemId);
    }
    mergedItems.push(...itemsById.values());
    mergedItems.sort((left, right) => left.itemId.localeCompare(right.itemId));
    updatedShipments.push({
      shipmentId: previousShipment.shipmentId,
      state: shipmentState,
      ...(carrierCode === undefined ? {} : { carrierCode }),
      ...(trackingNumber === undefined ? {} : { trackingNumber }),
      ...(trackingUrl === undefined ? {} : { trackingUrl }),
      items: mergedItems
    });
    existingShipments.delete(incomingShipment.shipmentId);
  }
  updatedShipments.push(...existingShipments.values());
  updatedShipments.sort((left, right) => left.shipmentId.localeCompare(right.shipmentId));

  const unresolvedIds = state.conflicts.filter((conflict) => conflict.providerId === binding.providerId && conflict.mode === binding.mode &&
    conflict.providerRequestId === normalized.providerRequestId && scopeMatches(conflict.scope, scope) && conflict.state === "unresolved")
    .map((conflict) => conflict.conflictId);
  const updatedProjection: StatusProjection = {
    ...projection,
    state: unresolvedIds.length > 0 ? "conflict" : rootState,
    rootState,
    cancellationRequested,
    shipments: updatedShipments,
    observationIds: pushBounded(projection.observationIds, observationId),
    conflictIds: unresolvedIds,
    revision: projection.revision + 1,
    updatedAt: normalized.ingestedAt
  };
  const projections = state.projections.slice();
  if (projectionIndex < 0) projections.push(updatedProjection);
  else projections[projectionIndex] = updatedProjection;
  const effectIds = pushBounded(state.effectIds, semanticEffectId);
  const outbox = appendOutbox(state.outbox, binding, scope, normalized.providerRequestId,
    semanticEffectId, updatedProjection, normalized.ingestedAt);
  state = { ...state, projections, effectIds, outbox };

  const targets = state.pollTargets.map((target) => {
    if (target.providerRequestId !== normalized.providerRequestId || !scopeMatches(target.scope, scope)) return target;
    if (unresolvedIds.length === 0 && target.policy.terminalStates.includes(updatedProjection.state as StatusState)) {
      const { nextReconciliationAt: _ignored, lastLookupFailure: _lastFailure, ...rest } = target;
      return { ...rest, state: "stopped_terminal" as const };
    }
    return target;
  });
  if (targets.some((target, index) => target !== state.pollTargets[index])) state = { ...state, pollTargets: targets };
  return {
    state,
    disposition: unresolvedIds.length > 0 ? "conflict" : "applied",
    observationId
  };
}

export class LocalStatusStore {
  private readonly rootDirectory: string;
  private readonly stateDirectory: string;
  private readonly stateFile: string;
  private readonly markerFile: string;
  private readonly binding: StateBinding;
  private readonly durable: DurableJsonStore;
  private readonly mapping: ProviderStatusMapping;
  private readonly trackingPolicy: TrackingHostPolicy;
  private readonly lookupPort: TrustedStatusLookup;
  private readonly lookupMethod: TrustedStatusLookup["lookup"];
  private readonly allowUnverifiedHints: boolean;
  private readonly clock: { now(): number };

  private constructor(input: {
    readonly rootDirectory: string;
    readonly binding: StateBinding;
    readonly durable: DurableJsonStore;
    readonly mapping: ProviderStatusMapping;
    readonly trackingPolicy: TrackingHostPolicy;
    readonly lookupPort: TrustedStatusLookup;
    readonly lookupMethod: TrustedStatusLookup["lookup"];
    readonly allowUnverifiedHints: boolean;
    readonly clock: { now(): number };
  }) {
    this.rootDirectory = input.rootDirectory;
    this.stateDirectory = join(input.rootDirectory, STATE_DIRECTORY);
    this.stateFile = join(this.stateDirectory, "metering-state.json");
    this.markerFile = join(input.rootDirectory, COMMIT_MARKER);
    this.binding = input.binding;
    this.durable = input.durable;
    this.mapping = input.mapping;
    this.trackingPolicy = input.trackingPolicy;
    this.lookupPort = input.lookupPort;
    this.lookupMethod = input.lookupMethod;
    this.allowUnverifiedHints = input.allowUnverifiedHints;
    this.clock = input.clock;
  }

  static async open(options: LocalStatusStoreOptions): Promise<LocalStatusStore> {
    try {
      const row = snapshotExactRecord(options, ["directory", "providerId", "mode", "mapping", "trackingPolicy", "lookup"], ["allowUnverifiedHints", "clock"]);
      if (typeof row.directory !== "string" || !isAbsolute(row.directory) || resolve(row.directory) !== row.directory ||
        !safeToken(row.providerId) || !isMode(row.mode) || row.allowUnverifiedHints !== undefined && typeof row.allowUnverifiedHints !== "boolean") {
        fail("invalid_path");
      }
      const { mapping, trackingPolicy } = snapshotStatusPolicies(row.mapping, row.trackingPolicy);
      if (mapping.providerId !== row.providerId) fail("binding_mismatch");
      const lookupRow = snapshotExactRecord(row.lookup, ["lookup"]);
      if (typeof lookupRow.lookup !== "function") fail("invalid_record");
      const clockValue = row.clock === undefined ? { now: () => Date.now() } : row.clock;
      const clockRow = snapshotExactRecord(clockValue, ["now"]);
      if (typeof clockRow.now !== "function") fail("invalid_record");
      const rootDirectory = row.directory as string;
      const binding = ownerBinding(row.providerId as string, row.mode, mapping, trackingPolicy);
      await assertPrivateDirectory(rootDirectory, binding.ownerUid, true);
      const stateDirectory = join(rootDirectory, STATE_DIRECTORY);
      await assertPrivateDirectory(stateDirectory, binding.ownerUid, true);
      const statePath = join(stateDirectory, "metering-state.json");
      const markerPath = join(rootDirectory, COMMIT_MARKER);
      await assertManagedFile(statePath, binding.ownerUid);
      await assertManagedFile(markerPath, binding.ownerUid);
      const durable = await DurableJsonStore.open(stateDirectory, durableValue(initialState(binding)));
      const store = new LocalStatusStore({
        rootDirectory,
        binding,
        durable,
        mapping,
        trackingPolicy,
        lookupPort: row.lookup as TrustedStatusLookup,
        lookupMethod: lookupRow.lookup as TrustedStatusLookup["lookup"],
        allowUnverifiedHints: row.allowUnverifiedHints === true,
        clock: { now: clockRow.now as () => number }
      });
      await store.readState();
      return store;
    } catch (error) {
      throw errorToStore(error);
    }
  }

  private async readMarker(): Promise<CommitMarker | undefined> {
    const exists = await assertManagedFile(this.markerFile, this.binding.ownerUid);
    if (!exists) return undefined;
    try {
      const text = await readFile(this.markerFile, "utf8");
      const parsed: unknown = JSON.parse(text);
      return parseMarker(parsed, this.binding);
    } catch (error) {
      if (error instanceof StatusStoreError) throw error;
      fail("corrupt_state");
    }
  }

  private async checkFilesystem(): Promise<boolean> {
    await assertPrivateDirectory(this.rootDirectory, this.binding.ownerUid, false);
    await assertPrivateDirectory(this.stateDirectory, this.binding.ownerUid, false);
    const stateExists = await assertManagedFile(this.stateFile, this.binding.ownerUid);
    const marker = await this.readMarker();
    if (stateExists !== (marker !== undefined)) fail("corrupt_state");
    return !stateExists;
  }

  private async readState(): Promise<StatusStoreState> {
    try {
      const fresh = await this.checkFilesystem();
      const raw = await this.durable.read();
      const state = decodeState(raw, this.binding, this.mapping, this.trackingPolicy, !fresh);
      if (fresh && state.observations.length + state.pollTargets.length + state.outbox.length !== 0) fail("corrupt_state");
      return state;
    } catch (error) {
      throw errorToStore(error);
    }
  }

  private async mutate<T>(
    change: (state: StatusStoreState) => { readonly state: StatusStoreState; readonly result: T },
    allowInitialize = false
  ): Promise<T> {
    try {
      const fresh = await this.checkFilesystem();
      if (fresh && !allowInitialize) fail("not_found");
      let token: string | undefined;
      if (fresh) {
        token = randomUUID();
        try {
          await writeMarker(this.rootDirectory, this.binding, "pending", token);
        } catch (error) {
          if (errorCode(error) !== "EEXIST") throw error;
          const marker = await this.readMarker();
          if (marker === undefined) fail("corrupt_state");
          if (marker.state !== "committed") fail("storage_busy");
        }
      }
      let result: T | undefined;
      let persisted = false;
      for (let attempt = 0; attempt < 8; attempt += 1) {
        try {
          result = await this.durable.update((raw) => {
            const current = decodeState(raw, this.binding, this.mapping, this.trackingPolicy, !fresh);
            const updated = change(current);
            assertProposedStateCapacity(updated.state);
            const candidate = durableValue(updated.state);
            const validated = decodeState(candidate, this.binding, this.mapping, this.trackingPolicy, true);
            return { state: durableValue(validated), result: updated.result };
          });
          persisted = true;
          break;
        } catch (error) {
          if (!(error instanceof DurableStoreError) || error.code !== "storage_busy" || attempt === 7) throw error;
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 10 * (2 ** attempt)));
        }
      }
      if (!persisted) fail("storage_busy");
      if (fresh && token !== undefined) await writeMarker(this.rootDirectory, this.binding, "committed", token);
      return result as T;
    } catch (error) {
      throw errorToStore(error);
    }
  }

  private now(): number {
    const value = this.clock.now();
    if (!validTime(value)) fail("invalid_record");
    return value;
  }

  private async claimDuePoll(now: number, leaseDurationMs: number): Promise<PollLease | undefined> {
    return this.mutate((state) => {
      const candidates: { readonly target: PollTargetRecord; readonly kind: PollTaskKind; readonly dueAt: number }[] = [];
      for (const target of state.pollTargets) {
        const unresolved = hasUnresolvedConflict(state, target.scope, target.providerRequestId, this.binding.providerId, this.binding.mode);
        const leaseAvailable = target.lease === undefined || target.lease.expiresAt <= now;
        if (!leaseAvailable) continue;
        if (unresolved && target.nextReconciliationAt !== undefined && target.nextReconciliationAt <= now &&
          target.reconciliationAttempts < target.policy.maximumAttempts) {
          candidates.push({ target, kind: "canonical_reconciliation", dueAt: target.nextReconciliationAt });
          continue;
        }
        if (target.state === "active" && target.nextPollAt <= now && target.attempts < target.policy.maximumAttempts) {
          candidates.push({ target, kind: "scheduled_poll", dueAt: target.nextPollAt });
        }
      }
      candidates.sort((left, right) => left.dueAt - right.dueAt || left.target.providerRequestId.localeCompare(right.target.providerRequestId) ||
        left.kind.localeCompare(right.kind));
      const selected = candidates[0];
      if (selected === undefined) return { state, result: undefined };
      const target = selected.target;
      const fence = target.leaseFence + 1;
      if (!Number.isSafeInteger(fence)) fail("capacity_exceeded");
      const lease: PollLeaseRecord = { kind: selected.kind, token: randomUUID(), fence, expiresAt: now + leaseDurationMs };
      const updatedTarget: PollTargetRecord = { ...target, leaseFence: fence, lease };
      const pollTargets = state.pollTargets.map((item) => item === target ? updatedTarget : item);
      return {
        state: { ...state, pollTargets },
        result: {
          providerId: this.binding.providerId,
          mode: this.binding.mode,
          scope: cloneJson(target.scope),
          providerRequestId: target.providerRequestId,
          kind: selected.kind,
          token: lease.token,
          fence,
          expiresAt: lease.expiresAt
        }
      };
    });
  }

  private async completeDuePoll(lease: PollLease, responseValue: unknown, completedAt: number): Promise<PollRunResult> {
    const response = normalizeTrustedResponse(responseValue);
    let normalized: NormalizedStatusObservation | undefined;
    let invalidObservation = false;
    if (response.status === "found") {
      try {
        normalized = normalizeProviderObservation(response.observation,
          lease.kind === "canonical_reconciliation" ? "trusted_lookup" : "trusted_poll",
          completedAt, this.mapping, this.trackingPolicy);
        if (normalized.providerRequestId !== lease.providerRequestId) throw new StatusInputError("invalid_input");
      } catch {
        invalidObservation = true;
      }
    }
    const safeFailure: PollRunResult["safeFailure"] = invalidObservation ? "invalid_observation" :
      response.status === "rate_limited" ? "rate_limited" : response.status === "ambiguous" ? "lookup_ambiguous" :
        response.status === "unavailable" ? "lookup_unavailable" : undefined;
    return this.mutate<PollRunResult>((state) => {
      const targetIndex = state.pollTargets.findIndex((target) => target.providerRequestId === lease.providerRequestId &&
        scopeMatches(target.scope, lease.scope));
      if (targetIndex < 0) fail("stale_lease");
      const target = state.pollTargets[targetIndex]!;
      if (target.lease === undefined || target.lease.token !== lease.token || target.lease.fence !== lease.fence ||
        target.lease.kind !== lease.kind || target.lease.expiresAt <= completedAt) fail("stale_lease");

      let next = state;
      let observationId: string | undefined;
      let appliedDisposition: "applied" | "duplicate" | "conflict" | undefined;
      if (normalized !== undefined && safeFailure === undefined) {
        const applied = applyStatusObservation(state, this.binding, lease.scope, normalized);
        next = applied.state;
        observationId = applied.observationId;
        appliedDisposition = applied.disposition;
      }

      const attemptCount = lease.kind === "canonical_reconciliation" ? target.reconciliationAttempts + 1 : target.attempts + 1;
      if (!Number.isSafeInteger(attemptCount)) fail("capacity_exceeded");
      const baseDelay = Math.min(target.policy.maximumBackoffMs,
        target.policy.minimumIntervalMs * (2 ** Math.min(Math.max(attemptCount - 1, 0), 30)));
      const retryDelay = response.status === "rate_limited" ? Math.max(baseDelay, response.retryAfterMs) : baseDelay;
      const retryAt = completedAt + Math.min(target.policy.maximumBackoffMs, retryDelay);
      if (!validTime(retryAt)) fail("capacity_exceeded");

      const unresolved = hasUnresolvedConflict(next, lease.scope, lease.providerRequestId, this.binding.providerId, this.binding.mode);
      const currentProjection = next.projections.find((projection) => projection.providerId === this.binding.providerId &&
        projection.mode === this.binding.mode && projection.providerRequestId === lease.providerRequestId &&
        scopeMatches(projection.scope, lease.scope));
      const terminal = currentProjection !== undefined && currentProjection.state !== "conflict" &&
        isStatusState(currentProjection.state) && target.policy.terminalStates.includes(currentProjection.state);
      const exhausted = attemptCount >= target.policy.maximumAttempts;
      const { lease: _oldLease, ...withoutLease } = target;
      let updatedTarget: PollTargetRecord;
      if (unresolved) {
        const updated = lease.kind === "canonical_reconciliation"
          ? { ...withoutLease, reconciliationAttempts: attemptCount }
          : { ...withoutLease, attempts: attemptCount };
        const { lastLookupFailure: _oldFailure, ...withoutFailure } = updated;
        if (lease.kind === "canonical_reconciliation" && exhausted) {
          const { nextReconciliationAt: _nextRecon, ...withoutRecon } = withoutFailure;
          updatedTarget = {
            ...withoutRecon,
            trustedNotBeforeAt: retryAt,
            state: "exhausted",
            ...(safeFailure === undefined ? {} : { lastLookupFailure: safeFailure })
          };
        } else {
          updatedTarget = {
            ...withoutFailure,
            trustedNotBeforeAt: retryAt,
            state: exhausted && lease.kind === "scheduled_poll" ? "exhausted" : "active",
            nextPollAt: lease.kind === "scheduled_poll" ? retryAt : Math.max(updated.nextPollAt, retryAt),
            nextReconciliationAt: retryAt,
            ...(safeFailure === undefined ? {} : { lastLookupFailure: safeFailure })
          };
        }
      } else if (terminal) {
        const { nextReconciliationAt: _nextRecon, lastLookupFailure: _failure, ...rest } = withoutLease;
        updatedTarget = {
          ...rest,
          trustedNotBeforeAt: retryAt,
          state: "stopped_terminal",
          ...(lease.kind === "canonical_reconciliation"
            ? { reconciliationAttempts: attemptCount }
            : { attempts: attemptCount })
        };
      } else if (exhausted) {
        const { nextReconciliationAt: _nextRecon, ...rest } = withoutLease;
        updatedTarget = {
          ...rest,
          trustedNotBeforeAt: retryAt,
          state: "exhausted",
          ...(lease.kind === "canonical_reconciliation"
            ? { reconciliationAttempts: attemptCount }
            : { attempts: attemptCount }),
          ...(safeFailure === undefined ? {} : { lastLookupFailure: safeFailure })
        };
      } else {
        const { nextReconciliationAt: _nextRecon, lastLookupFailure: _oldFailure, ...withoutStaleSchedule } = withoutLease;
        updatedTarget = {
          ...withoutStaleSchedule,
          trustedNotBeforeAt: retryAt,
          state: "active",
          ...(lease.kind === "canonical_reconciliation"
            ? { reconciliationAttempts: attemptCount, nextPollAt: retryAt }
            : { attempts: attemptCount, nextPollAt: retryAt }),
          ...(safeFailure === undefined ? {} : { lastLookupFailure: safeFailure })
        };
      }
      const pollTargets = next.pollTargets.slice();
      const nextIndex = pollTargets.findIndex((item) => item.providerRequestId === lease.providerRequestId && scopeMatches(item.scope, lease.scope));
      if (nextIndex < 0) fail("corrupt_state");
      pollTargets[nextIndex] = updatedTarget;
      next = { ...next, pollTargets };
      if (safeFailure !== undefined) {
        return {
          state: next,
          result: {
            status: "retry_scheduled",
            kind: lease.kind,
            providerRequestId: lease.providerRequestId,
            ...(safeFailure === undefined ? {} : { safeFailure })
          }
        };
      }
      if (appliedDisposition === "conflict" || unresolved) {
        return {
          state: next,
          result: {
            status: "unresolved",
            kind: lease.kind,
            providerRequestId: lease.providerRequestId,
            ...(observationId === undefined ? {} : { observationId })
          }
        };
      }
      if (appliedDisposition === "duplicate") {
        return {
          state: next,
          result: {
            status: "duplicate",
            kind: lease.kind,
            providerRequestId: lease.providerRequestId,
            ...(observationId === undefined ? {} : { observationId })
          }
        };
      }
      return {
        state: next,
        result: {
          status: "observed",
          kind: lease.kind,
          providerRequestId: lease.providerRequestId,
          ...(observationId === undefined ? {} : { observationId })
        }
      };
    });
  }

  async projection(scopeValue: unknown, requestIdValue: unknown): Promise<StatusProjection | undefined> {
    try {
      const scope = normalizeScope(scopeValue);
      if (!safeToken(requestIdValue)) fail("invalid_record");
      const state = await this.readState();
      const found = state.projections.find((item) => item.providerId === this.binding.providerId && item.mode === this.binding.mode &&
        item.providerRequestId === requestIdValue && scopeMatches(item.scope, scope));
      return found === undefined ? undefined : cloneJson(found);
    } catch (error) {
      throw errorToStore(error);
    }
  }

  async history(scopeValue: unknown, requestIdValue: unknown): Promise<readonly StatusObservationRecord[]> {
    try {
      const scope = normalizeScope(scopeValue);
      if (!safeToken(requestIdValue)) fail("invalid_record");
      const state = await this.readState();
      return cloneJson(state.observations.filter((item) => item.providerId === this.binding.providerId && item.mode === this.binding.mode &&
        item.providerRequestId === requestIdValue && scopeMatches(item.scope, scope)));
    } catch (error) {
      throw errorToStore(error);
    }
  }

  async conflicts(scopeValue: unknown, requestIdValue: unknown): Promise<readonly StatusConflict[]> {
    try {
      const scope = normalizeScope(scopeValue);
      if (!safeToken(requestIdValue)) fail("invalid_record");
      const state = await this.readState();
      return cloneJson(state.conflicts.filter((item) => item.providerId === this.binding.providerId && item.mode === this.binding.mode &&
        item.providerRequestId === requestIdValue && scopeMatches(item.scope, scope)));
    } catch (error) {
      throw errorToStore(error);
    }
  }

  async registerPollTarget(input: unknown): Promise<void> {
    try {
      const row = snapshotExactRecord(input, ["scope", "providerRequestId", "policy"]);
      const scope = normalizeScope(row.scope);
      if (!safeToken(row.providerRequestId)) fail("invalid_record");
      const policy = normalizePollPolicy(row.policy);
      const registeredAt = this.now();
      await this.mutate((state) => {
        const key = scopeKey(this.binding.providerId, this.binding.mode, scope, row.providerRequestId as string);
        const existing = state.pollTargets.find((target) =>
          scopeKey(this.binding.providerId, this.binding.mode, target.scope, target.providerRequestId) === key);
        if (existing !== undefined) {
          if (stableDigest(existing.policy) !== stableDigest(policy)) fail("policy_mismatch");
          return { state, result: undefined };
        }
        const target: PollTargetRecord = {
          providerRequestId: row.providerRequestId as string,
          scope,
          policy,
          state: "active",
          nextPollAt: registeredAt,
          attempts: 0,
          reconciliationAttempts: 0,
          leaseFence: 0
        };
        return { state: { ...state, pollTargets: pushBounded(state.pollTargets, target) }, result: undefined };
      }, true);
    } catch (error) {
      throw errorToStore(error);
    }
  }

  async requestUnverifiedCallbackHint(input: unknown): Promise<"queued" | "duplicate"> {
    try {
      if (!this.allowUnverifiedHints) fail("callbacks_disabled");
      const row = snapshotExactRecord(input, ["scope", "providerRequestId", "hintId"]);
      const scope = normalizeScope(row.scope);
      if (!safeToken(row.providerRequestId) || !safeToken(row.hintId)) fail("invalid_record");
      const receivedAt = this.now();
      return await this.mutate((state) => {
        const key = scopeKey(this.binding.providerId, this.binding.mode, scope, row.providerRequestId as string);
        const index = state.pollTargets.findIndex((target) =>
          scopeKey(this.binding.providerId, this.binding.mode, target.scope, target.providerRequestId) === key);
        if (index < 0) fail("not_found");
        const hintKey = `${key}:${row.hintId as string}`;
        if (state.callbackHints.some((hint) =>
          `${scopeKey(this.binding.providerId, this.binding.mode, hint.scope, hint.providerRequestId)}:${hint.hintId}` === hintKey)) {
          return { state, result: "duplicate" as const };
        }
        const hint: CallbackHintRecord = {
          hintId: row.hintId as string,
          providerRequestId: row.providerRequestId as string,
          scope,
          receivedAt
        };
        const target = state.pollTargets[index]!;
        const unresolved = hasUnresolvedConflict(state, scope, row.providerRequestId as string, this.binding.providerId, this.binding.mode);
        const canSchedule = target.attempts < target.policy.maximumAttempts;
        const reactivateTerminal = target.state === "stopped_terminal" && canSchedule;
        const updatedTarget: PollTargetRecord = {
          ...target,
          ...(target.state === "active" ? {
            nextPollAt: Math.max(target.trustedNotBeforeAt ?? 0,
              Math.min(target.nextPollAt, receivedAt + target.policy.minimumIntervalMs))
          } : reactivateTerminal ? {
            state: "active" as const,
            nextPollAt: Math.max(target.nextPollAt, receivedAt + target.policy.minimumIntervalMs,
              target.trustedNotBeforeAt ?? 0)
          } : {}),
          ...(unresolved
            ? { nextReconciliationAt: Math.max(target.trustedNotBeforeAt ?? 0,
                Math.min(target.nextReconciliationAt ?? (receivedAt + target.policy.minimumIntervalMs),
                  receivedAt + target.policy.minimumIntervalMs)) }
            : {})
        };
        const targets = state.pollTargets.slice();
        targets[index] = updatedTarget;
        return {
          state: { ...state, callbackHints: pushBounded(state.callbackHints, hint), pollTargets: targets },
          result: "queued" as const
        };
      });
    } catch (error) {
      throw errorToStore(error);
    }
  }

  async runOneDuePoll(leaseDurationMs = 30_000): Promise<PollRunResult> {
    const now = this.now();
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs < 1_000 || leaseDurationMs > MAX_LEASE_MS ||
      now + leaseDurationMs > 8_640_000_000_000_000) fail("invalid_record");
    const lease = await this.claimDuePoll(now, leaseDurationMs);
    if (lease === undefined) return { status: "no_due_work" };
    let response: unknown;
    try {
      response = await this.lookupMethod.call(this.lookupPort, {
        providerId: this.binding.providerId,
        mode: this.binding.mode,
        scope: cloneJson(lease.scope),
        providerRequestId: lease.providerRequestId,
        reason: lease.kind === "canonical_reconciliation" ? "canonical_reconciliation" : "scheduled_poll"
      });
    } catch {
      response = { status: "unavailable" };
    }
    return this.completeDuePoll(lease, response, this.now());
  }

  async claimOutbox(
    scopeValue: unknown,
    consumerIdValue: unknown,
    leaseDurationMsValue: unknown
  ): Promise<StatusOutboxLease | undefined> {
    try {
      const scope = normalizeScope(scopeValue);
      const now = this.now();
      if (!safeToken(consumerIdValue) || !Number.isSafeInteger(leaseDurationMsValue) ||
        (leaseDurationMsValue as number) < 1_000 || (leaseDurationMsValue as number) > MAX_LEASE_MS ||
        now + (leaseDurationMsValue as number) > 8_640_000_000_000_000) fail("invalid_record");
      return await this.mutate((state) => {
        const candidates = state.outbox.filter((event) => event.providerId === this.binding.providerId &&
          event.mode === this.binding.mode && scopeMatches(event.scope, scope) && event.status !== "acked" &&
          (event.status === "pending" || (event.leaseUntil !== undefined && event.leaseUntil <= now)))
          .sort((left, right) => left.createdAt - right.createdAt || left.eventId.localeCompare(right.eventId));
        const event = candidates[0];
        if (event === undefined) return { state, result: undefined };
        const fence = event.leaseFence + 1;
        if (!Number.isSafeInteger(fence)) fail("capacity_exceeded");
        const token = randomUUID();
        const expiresAt = now + (leaseDurationMsValue as number);
        const updated: StatusOutboxEvent = {
          ...event,
          status: "leased",
          leaseFence: fence,
          leaseToken: token,
          leaseUntil: expiresAt,
          leaseConsumer: consumerIdValue as string
        };
        return {
          state: { ...state, outbox: state.outbox.map((row) => row.eventId === event.eventId ? updated : row) },
          result: { event: cloneJson(updated), token, fence, expiresAt }
        };
      });
    } catch (error) {
      throw errorToStore(error);
    }
  }

  async acknowledgeOutbox(input: unknown): Promise<"acked" | "already_acked"> {
    try {
      const row = snapshotExactRecord(input, ["scope", "eventId", "consumerId", "token", "fence"]);
      const scope = normalizeScope(row.scope);
      const now = this.now();
      if (!safeToken(row.eventId) || !safeToken(row.consumerId) || !safeToken(row.token) ||
        !Number.isSafeInteger(row.fence) || (row.fence as number) < 1) fail("invalid_record");
      return await this.mutate((state) => {
        const index = state.outbox.findIndex((event) => event.eventId === row.eventId && event.providerId === this.binding.providerId &&
          event.mode === this.binding.mode && scopeMatches(event.scope, scope));
        if (index < 0) fail("not_found");
        const current = state.outbox[index]!;
        if (current.status === "acked") {
          if (current.ackToken === row.token && current.ackFence === row.fence && current.ackConsumer === row.consumerId) {
            return { state, result: "already_acked" as const };
          }
          fail("stale_lease");
        }
        if (current.status !== "leased" || current.leaseToken !== row.token || current.leaseFence !== row.fence ||
          current.leaseConsumer !== row.consumerId || current.leaseUntil === undefined || current.leaseUntil <= now) {
          fail("stale_lease");
        }
        const { leaseToken: _leaseToken, leaseUntil: _leaseUntil, leaseConsumer: _leaseConsumer, ...withoutLease } = current;
        const updated: StatusOutboxEvent = {
          ...withoutLease,
          status: "acked",
          ackToken: row.token as string,
          ackFence: row.fence as number,
          ackConsumer: row.consumerId as string
        };
        const outbox = state.outbox.slice();
        outbox[index] = updated;
        return { state: { ...state, outbox }, result: "acked" as const };
      });
    } catch (error) {
      throw errorToStore(error);
    }
  }

  async resolveTerminalConflict(input: unknown): Promise<StatusResolution> {
    try {
      const row = snapshotExactRecord(input, ["scope", "providerRequestId", "conflictId", "lookupObservationId", "policy"]);
      const scope = normalizeScope(row.scope);
      const recordedAt = this.now();
      if (!safeToken(row.providerRequestId) || !safeToken(row.conflictId) || !safeToken(row.lookupObservationId)) {
        fail("invalid_record");
      }
      const policy = normalizeCorrectionPolicy(row.policy);
      return await this.mutate((state) => {
        const conflictIndex = state.conflicts.findIndex((conflict) => conflict.conflictId === row.conflictId &&
          conflict.providerId === this.binding.providerId && conflict.mode === this.binding.mode &&
          conflict.providerRequestId === row.providerRequestId && scopeMatches(conflict.scope, scope));
        if (conflictIndex < 0) fail("not_found");
        const conflict = state.conflicts[conflictIndex]!;
        if (conflict.kind !== "terminal_contradiction" || conflict.state !== "unresolved") fail("conflict_unresolved");
        const lookupObservation = state.observations.find((observation) => observation.observationId === row.lookupObservationId &&
          observation.providerId === this.binding.providerId && observation.mode === this.binding.mode &&
          observation.providerRequestId === row.providerRequestId && scopeMatches(observation.scope, scope) &&
          observation.sourceKind === "trusted_lookup");
        const lookupState = lookupObservation === undefined ? undefined : observationStateAtLocation(lookupObservation, conflict.location);
        if (lookupObservation === undefined || !isStatusState(lookupState) || !TERMINAL_STATES.has(lookupState) ||
          !policy.allowedTo.includes(lookupState)) {
          fail("conflict_unresolved");
        }
        const conflictObservations = conflict.observationIds.map((id) => state.observations.find((observation) =>
          observation.observationId === id && observation.providerId === this.binding.providerId &&
          observation.mode === this.binding.mode && observation.providerRequestId === row.providerRequestId &&
          scopeMatches(observation.scope, scope)));
        if (conflictObservations.some((observation) => {
          if (observation === undefined) return true;
          const observed = observationStateAtLocation(observation, conflict.location);
          return !isStatusState(observed) || !TERMINAL_STATES.has(observed) || !policy.allowedFrom.includes(observed);
        })) fail("conflict_unresolved");
        const resolutionId = `resolution-${stableDigest({
          scopeKey: scopeKey(this.binding.providerId, this.binding.mode, scope, row.providerRequestId as string),
          conflictId: conflict.conflictId,
          lookupObservationId: lookupObservation.observationId,
          correctedState: lookupState,
          policy
        }).slice(0, 48)}`;
        const existing = state.resolutions.find((resolution) => resolution.resolutionId === resolutionId);
        if (existing !== undefined) return { state, result: cloneJson(existing) };
        const resolution: StatusResolution = {
          resolutionId,
          providerId: this.binding.providerId,
          mode: this.binding.mode,
          scope,
          providerRequestId: row.providerRequestId as string,
          conflictIds: [conflict.conflictId],
          lookupObservationId: lookupObservation.observationId,
          correctedState: lookupState,
          correctionPolicy: policy,
          recordedAt
        };
        const conflicts = state.conflicts.slice();
        conflicts[conflictIndex] = { ...conflict, state: "resolved", resolutionId };
        const unresolvedIds = conflicts.filter((item) => item.providerId === this.binding.providerId && item.mode === this.binding.mode &&
          item.providerRequestId === row.providerRequestId && scopeMatches(item.scope, scope) && item.state === "unresolved")
          .map((item) => item.conflictId);
        const unresolved = unresolvedIds.length > 0;
        const projectionIndex = state.projections.findIndex((item) => item.providerId === this.binding.providerId &&
          item.mode === this.binding.mode && item.providerRequestId === row.providerRequestId && scopeMatches(item.scope, scope));
        if (projectionIndex < 0) fail("corrupt_state");
        const projection = state.projections[projectionIndex]!;
        const locationUpdated = withProjectionLocationState(projection, conflict.location, lookupState);
        if (locationUpdated === undefined) fail("conflict_unresolved");
        const updatedProjection: StatusProjection = {
          ...locationUpdated,
          state: unresolved ? "conflict" : locationUpdated.rootState,
          cancellationRequested: conflict.location.level === "root" && lookupState === "cancelled"
            ? false
            : projection.cancellationRequested,
          conflictIds: unresolvedIds,
          revision: projection.revision + 1,
          updatedAt: recordedAt
        };
        const projections = state.projections.slice();
        projections[projectionIndex] = updatedProjection;
        const causalEffectId = `correction-${resolutionId}`;
        const outbox = appendOutbox(state.outbox, this.binding, scope, row.providerRequestId as string,
          causalEffectId, updatedProjection, recordedAt);
        const targets = state.pollTargets.map((target) => {
          if (target.providerRequestId !== row.providerRequestId || !scopeMatches(target.scope, scope)) return target;
          if (unresolved) return target;
          const { nextReconciliationAt: _ignored, lease: _lease, ...rest } = target;
          const leaseFence = target.leaseFence + 1;
          if (!Number.isSafeInteger(leaseFence)) fail("capacity_exceeded");
          return {
            ...rest,
            leaseFence,
            state: target.policy.terminalStates.includes(updatedProjection.rootState)
              ? "stopped_terminal" as const
              : target.state === "exhausted" ? "exhausted" as const : "active" as const
          };
        });
        return {
          state: {
            ...state,
            conflicts,
            resolutions: pushBounded(state.resolutions, resolution),
            projections,
            pollTargets: targets,
            outbox
          },
          result: resolution
        };
      });
    } catch (error) {
      throw errorToStore(error);
    }
  }
}
