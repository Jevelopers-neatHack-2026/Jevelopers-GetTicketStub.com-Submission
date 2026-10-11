import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fixtureStatusMapping,
  fixtureTrackingHostPolicy
} from "../dist/status.js";
import { LocalStatusStore } from "../dist/status-store.js";

export const statusScope = Object.freeze({ tenantId: "tenant-fixture-a", projectId: "project-fixture-a" });
export const otherStatusScope = Object.freeze({ tenantId: "tenant-fixture-b", projectId: "project-fixture-b" });
export const statusProviderId = "synthetic-status-provider";

export function statusPollPolicy(overrides = {}) {
  return {
    policyId: "poll-policy-fixture-a",
    version: "fc-poll-policy-fixture/1",
    policyState: "development_fixture",
    minimumIntervalMs: 1_000,
    maximumBackoffMs: 5_000,
    maximumAttempts: 6,
    terminalStates: ["delivered", "cancelled", "rejected", "failed"],
    ...overrides
  };
}

export function statusObservation({
  requestId = "request-a",
  status = "fixture.accepted",
  sourceObservationId,
  sourceRevision,
  occurredAt = "2026-10-11T12:00:00.000Z",
  shipments = []
} = {}) {
  return {
    providerRequestId: requestId,
    providerStatus: status,
    occurredAt,
    ...(sourceObservationId === undefined ? {} : { sourceObservationId }),
    ...(sourceRevision === undefined ? {} : { sourceRevision }),
    shipments
  };
}

export function shipmentFact({
  shipmentId = "shipment-a",
  status = "fixture.shipped",
  carrierCode = "carrier-a",
  trackingNumber = "TRACK-12345",
  trackingUrl = "https://tracking.example.test/parcel/TRACK-12345",
  items = []
} = {}) {
  return {
    shipmentId,
    providerStatus: status,
    ...(carrierCode === undefined ? {} : { carrierCode }),
    ...(trackingNumber === undefined ? {} : { trackingNumber }),
    ...(trackingUrl === undefined ? {} : { trackingUrl }),
    items
  };
}

export function itemFact({
  itemId = "item-a",
  status = "fixture.shipped",
  quantities = []
} = {}) {
  return { itemId, providerStatus: status, quantities };
}

export function cumulativeQuantity(value, { kind = "fulfilled", unit = "each" } = {}) {
  return { kind, value, unit, basis: "cumulative" };
}

export function deltaQuantity(value, contributionId, { kind = "fulfilled", unit = "each" } = {}) {
  return { kind, value, unit, basis: "delta", contributionId };
}

export function correctionPolicy(overrides = {}) {
  return {
    policyId: "correction-policy-fixture-a",
    version: "fc-correction-policy-fixture-1",
    policyState: "development_fixture",
    approvedBy: "fixture-owner",
    allowedFrom: ["cancelled", "delivered"],
    allowedTo: ["cancelled"],
    ...overrides
  };
}

export async function makeStatusDirectory(prefix = "fc-status-test-") {
  const parent = await realpath(tmpdir());
  return mkdtemp(join(parent, prefix));
}

export async function removeStatusDirectory(directory) {
  await rm(directory, { recursive: true, force: true });
}

export function makeStatusClock(start = Date.parse("2026-10-11T12:00:00.000Z")) {
  return {
    value: start,
    now() { return this.value; },
    advance(milliseconds) { this.value += milliseconds; }
  };
}

export async function openStatusStore({
  directory,
  clock,
  lookup = async () => ({ status: "unavailable" }),
  allowUnverifiedHints = false,
  providerId = statusProviderId,
  mapping = fixtureStatusMapping(providerId),
  trackingPolicy = fixtureTrackingHostPolicy(),
  mode = "simulated"
}) {
  return LocalStatusStore.open({
    directory,
    providerId,
    mode,
    mapping,
    trackingPolicy,
    lookup: { lookup },
    allowUnverifiedHints,
    clock: { now: () => clock.now() }
  });
}
