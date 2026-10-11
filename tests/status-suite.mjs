import assert from "node:assert/strict";
import { readFile, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  fixtureStatusMapping,
  fixtureTrackingHostPolicy,
  normalizeProviderObservation,
  StatusInputError
} from "../dist/status.js";
import { LocalStatusStore, StatusStoreError } from "../dist/status-store.js";
import {
  correctionPolicy,
  cumulativeQuantity,
  deltaQuantity,
  itemFact,
  makeStatusClock,
  makeStatusDirectory,
  openStatusStore,
  otherStatusScope,
  removeStatusDirectory,
  shipmentFact,
  statusObservation,
  statusPollPolicy,
  statusProviderId,
  statusScope
} from "./status-fixtures.mjs";

const cases = [];
const add = (name, run) => cases.push([name, run]);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const statusModuleUrl = pathToFileURL(join(repositoryRoot, "dist/status.js")).href;
const storeModuleUrl = pathToFileURL(join(repositoryRoot, "dist/status-store.js")).href;
const statusStatePath = (directory) => join(directory, ".status-store-v1", "metering-state.json");
const statusMarkerPath = (directory) => join(directory, ".status-store-committed.json");
const childEnv = () => Object.fromEntries(["PATH", "TMPDIR", "TMP", "TEMP"].flatMap((key) =>
  process.env[key] === undefined ? [] : [[key, process.env[key]]]));
const clone = (value) => JSON.parse(JSON.stringify(value));

async function withHarness(run, { responses = [], allowUnverifiedHints = false } = {}) {
  const directory = await makeStatusDirectory();
  const clock = makeStatusClock();
  const calls = [];
  const queue = responses.slice();
  const lookup = async (request) => {
    calls.push(clone(request));
    const response = queue.shift() ?? { status: "unavailable" };
    return typeof response === "function" ? response(request) : response;
  };
  try {
    const store = await openStatusStore({ directory, clock, lookup, allowUnverifiedHints });
    await run({ directory, clock, calls, queue, lookup, store });
  } finally {
    await removeStatusDirectory(directory);
  }
}

async function expectStoreError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof StatusStoreError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

function expectInputError(run, code = "invalid_input") {
  assert.throws(run, (error) => {
    assert.ok(error instanceof StatusInputError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    return true;
  });
}

async function spawnChild(code, extraEnvironment = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", code], {
      cwd: repositoryRoot,
      env: { ...childEnv(), ...extraEnvironment },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("close", (status, signal) => resolvePromise({ status, signal, stdout, stderr }));
  });
}

function childStorePrefix() {
  return `import { LocalStatusStore, StatusStoreError } from ${JSON.stringify(storeModuleUrl)};
import { fixtureStatusMapping, fixtureTrackingHostPolicy } from ${JSON.stringify(statusModuleUrl)};
const scope = ${JSON.stringify(statusScope)};
const directory = process.env.FC_STATUS_DIR;
const now = Number(process.env.FC_STATUS_NOW);
const store = await LocalStatusStore.open({
  directory,
  providerId: ${JSON.stringify(statusProviderId)},
  mode: "simulated",
  mapping: fixtureStatusMapping(${JSON.stringify(statusProviderId)}),
  trackingPolicy: fixtureTrackingHostPolicy(),
  lookup: { lookup: async () => ({ status: "unavailable" }) },
  clock: { now: () => now }
});
`;
}

async function waitForFile(file, timeoutMs = 5_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      await stat(file);
      return;
    } catch {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
    }
  }
  throw new Error("child_ready_timeout");
}

add("normalization is strict, timestamp-independent for effects, and preserves unknown states", async () => {
  const mapping = fixtureStatusMapping();
  const tracking = fixtureTrackingHostPolicy();
  const firstInput = statusObservation({
    sourceObservationId: "event-source-a",
    occurredAt: "2026-10-11T12:00:00.000Z",
    status: "fixture.shipped",
    shipments: [shipmentFact({ items: [itemFact({ quantities: [deltaQuantity(3, "contrib-a")] })] })]
  });
  const secondInput = { ...firstInput, sourceObservationId: "event-source-b", occurredAt: "2026-10-11T12:01:00.000Z" };
  const first = normalizeProviderObservation(firstInput, "trusted_poll", 10, mapping, tracking);
  const second = normalizeProviderObservation(secondInput, "trusted_poll", 20, mapping, tracking);
  assert.equal(first.semanticEffectId, second.semanticEffectId);
  assert.notEqual(first.contentDigest, second.contentDigest);
  assert.equal(first.shipments[0].items[0].quantities[0].basis, "delta");

  const unknown = normalizeProviderObservation(
    statusObservation({ status: "fixture.future-status" }), "trusted_poll", 20, mapping, tracking);
  assert.equal(unknown.state, "unknown");
  assert.equal(unknown.providerStatus, "fixture.future-status");

  let getterCalled = false;
  const accessorInput = Object.defineProperty({}, "providerRequestId", {
    enumerable: true,
    get() { getterCalled = true; return "request-a"; }
  });
  Object.assign(accessorInput, {
    providerStatus: "fixture.accepted", occurredAt: "2026-10-11T12:00:00.000Z", shipments: []
  });
  expectInputError(() => normalizeProviderObservation(accessorInput, "trusted_poll", 0, mapping, tracking));
  assert.equal(getterCalled, false);

  const unsafeUrls = [
    "http://tracking.example.test/x",
    "https://user:pass@tracking.example.test/x",
    "https://tracking.example.test/x?token=secret",
    "https://tracking.example.test/x#fragment",
    "https://127.0.0.1/x",
    "https://attacker.example/x"
  ];
  for (const trackingUrl of unsafeUrls) {
    const input = statusObservation({ shipments: [shipmentFact({ trackingUrl })] });
    expectInputError(() => normalizeProviderObservation(input, "trusted_poll", 0, mapping, tracking));
  }
  expectInputError(() => normalizeProviderObservation(statusObservation({
    shipments: [shipmentFact({ items: [itemFact({ quantities: [deltaQuantity(2, undefined)] })] })]
  }), "trusted_poll", 0, mapping, tracking));
  const sparse = [];
  sparse.length = 1;
  expectInputError(() => normalizeProviderObservation(statusObservation({ shipments: sparse }), "trusted_poll", 0, mapping, tracking));
});

add("store scope and immutable history survive a fresh process reopen", async () => {
  const response = { status: "found", observation: statusObservation() };
  await withHarness(async ({ directory, clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    const first = await store.projection(statusScope, "request-a");
    assert.equal(first.state, "accepted");
    assert.equal((await store.projection(otherStatusScope, "request-a")), undefined);
    assert.equal((await store.history(statusScope, "request-a")).length, 1);
    assert.equal((await store.history(statusScope, "request-a"))[0].sourceIdKind, "derived_semantic");

    const childCode = `${childStorePrefix()}
const projection = await store.projection(scope, "request-a");
const history = await store.history(scope, "request-a");
process.stdout.write(JSON.stringify({ projection, historyCount: history.length, sourceIdKind: history[0]?.sourceIdKind }));`;
    const child = await spawnChild(childCode, {
      FC_STATUS_DIR: directory,
      FC_STATUS_NOW: String(clock.value)
    });
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.signal, null);
    const reopened = JSON.parse(child.stdout);
    assert.equal(reopened.projection.state, "accepted");
    assert.equal(reopened.historyCount, 1);
    assert.equal(reopened.sourceIdKind, "derived_semantic");
  }, { responses: [response] });
});

add("source and semantic dedup retain evidence without duplicate effective outbox effects", async () => {
  const one = statusObservation({ sourceObservationId: "source-one", occurredAt: "2026-10-11T12:00:00.000Z" });
  const two = statusObservation({ sourceObservationId: "source-two", occurredAt: "2026-10-11T12:05:00.000Z" });
  const repeated = statusObservation({ sourceObservationId: "source-two", occurredAt: "2026-10-11T12:05:00.000Z" });
  await withHarness(async ({ clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    clock.advance(1_000);
    assert.equal((await store.runOneDuePoll()).status, "duplicate");
    clock.advance(2_000);
    assert.equal((await store.runOneDuePoll()).status, "duplicate");
    const history = await store.history(statusScope, "request-a");
    assert.equal(history.length, 2);
    assert.deepEqual(history.map((item) => item.disposition), ["applied", "duplicate_effect"]);
    const lease = await store.claimOutbox(statusScope, "consumer-a", 5_000);
    assert.ok(lease);
    assert.equal(lease.event.status, "leased");
    assert.equal(lease.event.payload.state, "accepted");
    await store.acknowledgeOutbox({
      scope: statusScope, eventId: lease.event.eventId, consumerId: "consumer-a", token: lease.token, fence: lease.fence
    });
    assert.equal(await store.claimOutbox(statusScope, "consumer-a", 5_000), undefined);
  }, { responses: [
    { status: "found", observation: one },
    { status: "found", observation: two },
    { status: "found", observation: repeated }
  ] });
});

add("a reused provider source ID with changed content is retained as an unresolved collision", async () => {
  await withHarness(async ({ clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    clock.advance(1_000);
    assert.equal((await store.runOneDuePoll()).status, "unresolved");
    const projection = await store.projection(statusScope, "request-a");
    const history = await store.history(statusScope, "request-a");
    const conflicts = await store.conflicts(statusScope, "request-a");
    assert.equal(projection.state, "conflict");
    assert.equal(history.length, 2);
    assert.equal(history[0].sourceObservationId, history[1].sourceObservationId);
    assert.notEqual(history[0].contentDigest, history[1].contentDigest);
    assert.equal(conflicts[0].kind, "source_id_collision");
    assert.equal(conflicts[0].state, "unresolved");
    assert.equal((await store.runOneDuePoll()).status, "no_due_work");
    clock.advance(2_000);
    assert.equal((await store.runOneDuePoll()).status, "retry_scheduled");
    assert.equal((await store.conflicts(statusScope, "request-a"))[0].state, "unresolved");
  }, { responses: [
    { status: "found", observation: statusObservation({ sourceObservationId: "same-source", status: "fixture.accepted" }) },
    { status: "found", observation: statusObservation({ sourceObservationId: "same-source", status: "fixture.shipped", occurredAt: "2026-10-11T12:02:00.000Z" }) },
    { status: "ambiguous" }
  ] });
});

add("split shipments, quantities, tracking, and out-of-order progress merge conservatively", async () => {
  const first = statusObservation({
    status: "fixture.shipped",
    sourceObservationId: "split-1",
    shipments: [
      shipmentFact({ shipmentId: "shipment-a", items: [itemFact({
        itemId: "sku-a", quantities: [deltaQuantity(3, "part-a"), deltaQuantity(1, "reject-a", { kind: "failed" })]
      })] }),
      shipmentFact({ shipmentId: "shipment-b", trackingNumber: "TRACK-67890", items: [itemFact({
        itemId: "sku-a", quantities: [deltaQuantity(2, "part-b")]
      })] })
    ]
  });
  const second = statusObservation({
    status: "fixture.accepted",
    sourceObservationId: "split-2",
    occurredAt: "2026-10-11T11:59:00.000Z",
    shipments: [shipmentFact({ shipmentId: "shipment-a", status: "fixture.production", items: [itemFact({
      itemId: "sku-a", status: "fixture.production", quantities: [deltaQuantity(3, "part-a"), deltaQuantity(2, "part-c")]
    })] })]
  });
  await withHarness(async ({ clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    clock.advance(1_000);
    assert.equal((await store.runOneDuePoll()).status, "observed");
    const projection = await store.projection(statusScope, "request-a");
    assert.equal(projection.state, "shipped");
    assert.equal(projection.shipments.length, 2);
    const shipmentA = projection.shipments.find((item) => item.shipmentId === "shipment-a");
    assert.equal(shipmentA.state, "shipped");
    const item = shipmentA.items.find((row) => row.itemId === "sku-a");
    assert.equal(item.state, "shipped");
    assert.equal(item.quantities.find((quantity) => quantity.kind === "fulfilled").total, 5);
    assert.equal(item.quantities.find((quantity) => quantity.kind === "failed").total, 1);
    assert.equal(shipmentA.trackingUrl, "https://tracking.example.test/parcel/TRACK-12345");
  }, { responses: [
    { status: "found", observation: first },
    { status: "found", observation: second }
  ] });
});

add("first-seen and later item delta facts share one contribution-aware bucket across restart", async () => {
  const first = statusObservation({
    sourceObservationId: "delta-first-seen",
    status: "fixture.shipped",
    shipments: [shipmentFact({ items: [itemFact({ quantities: [
      deltaQuantity(3, "first-b"), deltaQuantity(2, "first-a")
    ] })] })]
  });
  const second = statusObservation({
    sourceObservationId: "delta-new-item",
    occurredAt: "2026-10-11T12:01:00.000Z",
    status: "fixture.shipped",
    shipments: [shipmentFact({ items: [
      itemFact({ itemId: "item-b", quantities: [deltaQuantity(2, "new-b"), deltaQuantity(3, "new-a")] })
    ] })]
  });
  const third = statusObservation({
    sourceObservationId: "delta-repeat-after-restart",
    occurredAt: "2026-10-11T12:02:00.000Z",
    status: "fixture.shipped",
    shipments: [shipmentFact({ items: [itemFact({ itemId: "item-b", quantities: [
      deltaQuantity(3, "new-a"), deltaQuantity(4, "new-c"), deltaQuantity(2, "new-b")
    ] })] })]
  });
  await withHarness(async ({ directory, clock, store, lookup }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    let item = (await store.projection(statusScope, "request-a")).shipments[0].items[0];
    assert.equal(item.quantities.length, 1);
    assert.equal(item.quantities[0].total, 5);
    assert.deepEqual(item.quantities[0].contributions.map((row) => row.id), ["first-a", "first-b"]);

    clock.advance(1_000);
    assert.equal((await store.runOneDuePoll()).status, "observed");
    item = (await store.projection(statusScope, "request-a")).shipments[0].items.find((row) => row.itemId === "item-b");
    assert.equal(item.quantities.length, 1);
    assert.equal(item.quantities[0].total, 5);

    const reopened = await openStatusStore({ directory, clock, lookup });
    clock.advance(2_000);
    assert.equal((await reopened.runOneDuePoll()).status, "observed");
    const projection = await reopened.projection(statusScope, "request-a");
    item = projection.shipments[0].items.find((row) => row.itemId === "item-b");
    assert.equal(item.quantities.length, 1);
    assert.equal(item.quantities[0].total, 9);
    assert.deepEqual(item.quantities[0].contributions.map((row) => row.id), ["new-a", "new-b", "new-c"]);
    const firstItem = projection.shipments[0].items.find((row) => row.itemId === "item-a");
    assert.equal(firstItem.quantities.length, 1);
    assert.equal(firstItem.quantities[0].total, 5);
    const reopenedAgain = await openStatusStore({ directory, clock, lookup });
    assert.equal((await reopenedAgain.projection(statusScope, "request-a")).shipments[0].items
      .find((row) => row.itemId === "item-b").quantities[0].total, 9);
  }, { responses: [
    { status: "found", observation: first },
    { status: "found", observation: second },
    { status: "found", observation: third }
  ] });
});

add("cumulative quantity changes and conflicting tracking facts create evidence instead of silent overwrite", async () => {
  const first = statusObservation({
    sourceObservationId: "quantity-first",
    shipments: [shipmentFact({ items: [itemFact({ quantities: [cumulativeQuantity(5)] })] })]
  });
  const second = statusObservation({
    sourceObservationId: "quantity-second",
    occurredAt: "2026-10-11T12:01:00.000Z",
    shipments: [shipmentFact({ trackingNumber: "TRACK-99999", items: [itemFact({ quantities: [cumulativeQuantity(4)] })] })]
  });
  await withHarness(async ({ clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    clock.advance(1_000);
    assert.equal((await store.runOneDuePoll()).status, "unresolved");
    const projection = await store.projection(statusScope, "request-a");
    const kinds = (await store.conflicts(statusScope, "request-a")).map((row) => row.kind).sort();
    assert.equal(projection.state, "conflict");
    assert.deepEqual(kinds, ["quantity_contradiction", "tracking_contradiction"]);
    const quantity = projection.shipments[0].items[0].quantities[0];
    assert.equal(quantity.total, 5);
  }, { responses: [
    { status: "found", observation: first },
    { status: "found", observation: second }
  ] });
});

add("cumulative quantities advance monotonically, deduplicate repeats, and keep decreases explicit", async () => {
  const observation = (sourceObservationId, fulfilled, failed) => statusObservation({
    sourceObservationId,
    status: "fixture.shipped",
    shipments: [shipmentFact({ items: [itemFact({ quantities: [
      cumulativeQuantity(fulfilled), cumulativeQuantity(failed, { kind: "failed" })
    ] })] })]
  });
  await withHarness(async ({ directory, clock, store, lookup }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a",
      policy: statusPollPolicy({ maximumBackoffMs: 1_000 }) });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    clock.advance(1_000);
    assert.equal((await store.runOneDuePoll()).status, "observed");
    let item = (await store.projection(statusScope, "request-a")).shipments[0].items[0];
    assert.deepEqual(item.quantities.map((row) => [row.kind, row.total]), [["failed", 2], ["fulfilled", 5]]);

    const reopened = await openStatusStore({ directory, clock, lookup });
    clock.advance(1_000);
    assert.equal((await reopened.runOneDuePoll()).status, "duplicate");
    assert.equal((await reopened.history(statusScope, "request-a")).length, 3);
    clock.advance(1_000);
    assert.equal((await reopened.runOneDuePoll()).status, "unresolved");
    item = (await reopened.projection(statusScope, "request-a")).shipments[0].items[0];
    assert.deepEqual(item.quantities.map((row) => [row.kind, row.total]), [["failed", 2], ["fulfilled", 5]]);
    assert.deepEqual((await reopened.conflicts(statusScope, "request-a")).map((row) => row.kind), ["quantity_contradiction"]);
    const persisted = await openStatusStore({ directory, clock, lookup });
    assert.equal((await persisted.projection(statusScope, "request-a")).state, "conflict");
  }, { responses: [
    { status: "found", observation: observation("cumulative-2-1", 2, 1) },
    { status: "found", observation: observation("cumulative-5-2", 5, 2) },
    { status: "found", observation: observation("cumulative-repeat", 5, 2) },
    { status: "found", observation: observation("cumulative-lower", 4, 2) }
  ] });
});

add("terminal contradiction requires a scoped trusted lookup and explicit correction policy", async () => {
  await withHarness(async ({ directory, clock, store, calls }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    assert.equal((await store.projection(statusScope, "request-a")).state, "delivered");
    assert.equal(await store.requestUnverifiedCallbackHint({ scope: statusScope, providerRequestId: "request-a", hintId: "hint-terminal" }), "queued");
    assert.equal((await store.projection(statusScope, "request-a")).state, "delivered");
    clock.advance(1_000);
    assert.equal((await store.runOneDuePoll()).status, "unresolved");
    assert.equal((await store.projection(statusScope, "request-a")).state, "conflict");
    assert.equal(calls[1].reason, "scheduled_poll");
    clock.advance(2_000);
    assert.equal((await store.runOneDuePoll()).status, "unresolved");
    assert.equal(calls[2].reason, "canonical_reconciliation");
    const trustedLookup = (await store.history(statusScope, "request-a")).find((row) => row.sourceKind === "trusted_lookup");
    assert.ok(trustedLookup);
    const conflict = (await store.conflicts(statusScope, "request-a")).find((row) => row.kind === "terminal_contradiction");
    assert.ok(conflict);
    const result = await store.resolveTerminalConflict({
      scope: statusScope,
      providerRequestId: "request-a",
      conflictId: conflict.conflictId,
      lookupObservationId: trustedLookup.observationId,
      policy: correctionPolicy()
    });
    assert.equal(result.correctedState, "cancelled");
    assert.equal((await store.history(statusScope, "request-a")).find((row) => row.observationId === trustedLookup.observationId).disposition,
      "duplicate_effect");
    const corrected = await store.projection(statusScope, "request-a");
    assert.equal(corrected.state, "cancelled");
    assert.deepEqual(corrected.conflictIds, []);
    assert.equal((await store.conflicts(statusScope, "request-a")).find((row) => row.conflictId === conflict.conflictId).state, "resolved");
    const reopened = await openStatusStore({ directory, clock });
    assert.equal((await reopened.projection(statusScope, "request-a")).state, "cancelled");
  }, { allowUnverifiedHints: true, responses: [
    { status: "found", observation: statusObservation({ sourceObservationId: "terminal-delivered", status: "fixture.delivered" }) },
    { status: "found", observation: statusObservation({ sourceObservationId: "terminal-cancelled", status: "fixture.cancelled" }) },
    { status: "found", observation: statusObservation({ sourceObservationId: "lookup-cancelled", status: "fixture.cancelled" }) }
  ] });
});

add("applied lookup correction replay survives interleaved scopes, partial revisions, restart, append, and delivery", async () => {
  const delivered = statusObservation({
    sourceObservationId: "nested-delivered",
    status: "fixture.delivered",
    shipments: [shipmentFact({ status: "fixture.delivered", items: [itemFact({ status: "fixture.delivered" })] })]
  });
  const cancelled = statusObservation({
    sourceObservationId: "nested-cancelled",
    occurredAt: "2026-10-11T12:01:00.000Z",
    status: "fixture.cancelled",
    shipments: [shipmentFact({ status: "fixture.cancelled", items: [itemFact({ status: "fixture.cancelled" })] })]
  });
  const lookupWithNewShipment = statusObservation({
    sourceObservationId: "nested-trusted-lookup",
    occurredAt: "2026-10-11T12:03:00.000Z",
    status: "fixture.cancelled",
    shipments: [
      shipmentFact({ status: "fixture.cancelled", items: [itemFact({ status: "fixture.cancelled" })] }),
      shipmentFact({ shipmentId: "shipment-added-by-lookup", status: "fixture.shipped", carrierCode: undefined,
        trackingNumber: undefined, trackingUrl: undefined })
    ]
  });
  await withHarness(async ({ directory, clock, store, queue, lookup, calls }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    assert.equal(await store.requestUnverifiedCallbackHint({
      scope: statusScope, providerRequestId: "request-a", hintId: "reactivate-a"
    }), "queued");
    clock.advance(1_000);
    assert.equal((await store.runOneDuePoll()).status, "unresolved");
    clock.advance(2_000);
    assert.equal((await store.runOneDuePoll()).status, "unresolved");
    assert.equal(calls[2].reason, "canonical_reconciliation");

    const beforeInterleave = await store.history(statusScope, "request-a");
    const lookupRow = beforeInterleave.find((row) => row.sourceObservationId === "nested-trusted-lookup");
    assert.ok(lookupRow);
    assert.equal(lookupRow.sourceKind, "trusted_lookup");
    assert.equal(lookupRow.disposition, "applied");
    assert.equal((await store.projection(statusScope, "request-a")).shipments.some((row) => row.shipmentId === "shipment-added-by-lookup"), true);

    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-b", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    const conflicts = await store.conflicts(statusScope, "request-a");
    assert.deepEqual(conflicts.map((row) => row.location.level).sort(), ["item", "root", "shipment"]);
    for (const level of ["root", "shipment", "item"]) {
      const conflict = conflicts.find((row) => row.location.level === level);
      assert.ok(conflict);
      await store.resolveTerminalConflict({
        scope: statusScope,
        providerRequestId: "request-a",
        conflictId: conflict.conflictId,
        lookupObservationId: lookupRow.observationId,
        policy: correctionPolicy()
      });
      const projection = await store.projection(statusScope, "request-a");
      if (level !== "item") assert.equal(projection.state, "conflict");
    }
    const corrected = await store.projection(statusScope, "request-a");
    assert.equal(corrected.state, "cancelled");
    assert.equal(corrected.rootState, "cancelled");
    assert.equal(corrected.shipments.find((row) => row.shipmentId === "shipment-a").state, "cancelled");
    assert.equal(corrected.shipments.find((row) => row.shipmentId === "shipment-a").items[0].state, "cancelled");
    assert.deepEqual(corrected.conflictIds, []);
    assert.ok((await store.conflicts(statusScope, "request-a")).every((row) => row.state === "resolved"));

    const reopenCode = `${childStorePrefix()}
const projection = await store.projection(scope, "request-a");
const history = await store.history(scope, "request-a");
const conflicts = await store.conflicts(scope, "request-a");
process.stdout.write(JSON.stringify({state: projection?.state, rootState: projection?.rootState,
  shipmentState: projection?.shipments[0]?.state, itemState: projection?.shipments[0]?.items[0]?.state,
  historyCount: history.length, conflictStates: conflicts.map((item) => item.state)}));`;
    const child = await spawnChild(reopenCode, { FC_STATUS_DIR: directory, FC_STATUS_NOW: String(clock.value) });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), {
      state: "cancelled", rootState: "cancelled", shipmentState: "cancelled", itemState: "cancelled",
      historyCount: 3, conflictStates: ["resolved", "resolved", "resolved"]
    });

    const reopened = await openStatusStore({ directory, clock, lookup, allowUnverifiedHints: true });
    queue.push({ status: "found", observation: statusObservation({
      requestId: "request-b", sourceObservationId: "b-second", status: "fixture.shipped"
    }) });
    clock.advance(1_000);
    assert.equal((await reopened.runOneDuePoll()).status, "observed");
    assert.equal((await reopened.history(statusScope, "request-b")).length, 2);

    const deliveredIds = [];
    for (let index = 0; index < 10; index += 1) {
      const lease = await reopened.claimOutbox(statusScope, "replay-consumer", 5_000);
      if (lease === undefined) break;
      deliveredIds.push(lease.event.eventId);
      assert.equal(await reopened.acknowledgeOutbox({
        scope: statusScope, eventId: lease.event.eventId, consumerId: "replay-consumer", token: lease.token, fence: lease.fence
      }), "acked");
    }
    assert.equal(deliveredIds.length, 8);
    assert.equal(new Set(deliveredIds).size, deliveredIds.length);
    assert.equal(await reopened.claimOutbox(statusScope, "replay-consumer", 5_000), undefined);
  }, { allowUnverifiedHints: true, responses: [
    { status: "found", observation: delivered },
    { status: "found", observation: cancelled },
    { status: "found", observation: lookupWithNewShipment },
    { status: "found", observation: statusObservation({ requestId: "request-b", sourceObservationId: "b-first" }) }
  ] });
});

add("partial trusted lookup coverage resolves only the covered root and keeps nested reconciliation active", async () => {
  await withHarness(async ({ clock, store, calls }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    assert.equal(await store.requestUnverifiedCallbackHint({
      scope: statusScope, providerRequestId: "request-a", hintId: "reactivate-for-conflict"
    }), "queued");
    clock.advance(1_000);
    assert.equal((await store.runOneDuePoll()).status, "unresolved");
    clock.advance(2_000);
    assert.equal((await store.runOneDuePoll()).status, "unresolved");
    const lookup = (await store.history(statusScope, "request-a")).find((row) => row.sourceKind === "trusted_lookup");
    assert.ok(lookup);
    assert.equal(lookup.shipments.length, 0);
    const conflicts = await store.conflicts(statusScope, "request-a");
    const rootConflict = conflicts.find((row) => row.location.level === "root");
    assert.ok(rootConflict);
    await store.resolveTerminalConflict({
      scope: statusScope,
      providerRequestId: "request-a",
      conflictId: rootConflict.conflictId,
      lookupObservationId: lookup.observationId,
      policy: correctionPolicy()
    });
    const projection = await store.projection(statusScope, "request-a");
    assert.equal(projection.rootState, "cancelled");
    assert.equal(projection.state, "conflict");
    assert.equal(projection.shipments[0].state, "conflict");
    assert.equal(projection.shipments[0].items[0].state, "conflict");
    assert.equal(projection.conflictIds.length, 2);
    assert.deepEqual((await store.conflicts(statusScope, "request-a")).filter((row) => row.state === "unresolved")
      .map((row) => row.location.level).sort(), ["item", "shipment"]);
    clock.advance(1_000);
    const next = await store.runOneDuePoll();
    assert.equal(next.status, "retry_scheduled");
    assert.equal(calls.at(-1).reason, "canonical_reconciliation");
    assert.equal((await store.projection(statusScope, "request-a")).state, "conflict");
  }, { allowUnverifiedHints: true, responses: [
    { status: "found", observation: statusObservation({ status: "fixture.delivered", shipments: [
      shipmentFact({ status: "fixture.delivered", items: [itemFact({ status: "fixture.delivered" })] })
    ] }) },
    { status: "found", observation: statusObservation({ sourceObservationId: "nested-cancelled", status: "fixture.cancelled",
      shipments: [shipmentFact({ status: "fixture.cancelled", items: [itemFact({ status: "fixture.cancelled" })] })] }) },
    { status: "found", observation: statusObservation({ sourceObservationId: "root-only-lookup", status: "fixture.cancelled" }) },
    { status: "unavailable" }
  ] });
});

add("poll retries are bounded, respect rate limits, and stop at the explicit terminal policy", async () => {
  await withHarness(async ({ clock, store, calls }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy({ maximumAttempts: 5 }) });
    assert.equal((await store.runOneDuePoll()).safeFailure, "lookup_unavailable");
    assert.equal((await store.runOneDuePoll()).status, "no_due_work");
    clock.advance(999);
    assert.equal((await store.runOneDuePoll()).status, "no_due_work");
    clock.advance(1);
    assert.equal((await store.runOneDuePoll()).safeFailure, "rate_limited");
    assert.equal((await store.runOneDuePoll()).status, "no_due_work");
    clock.advance(5_000);
    assert.equal((await store.runOneDuePoll()).status, "observed");
    assert.equal((await store.projection(statusScope, "request-a")).state, "delivered");
    assert.equal((await store.runOneDuePoll()).status, "no_due_work");
    assert.equal(calls.length, 3);
  }, { responses: [
    { status: "unavailable" },
    { status: "rate_limited", retryAfterMs: 99_999 },
    { status: "found", observation: statusObservation({ sourceObservationId: "final-status", status: "fixture.delivered" }) }
  ] });
});

add("callback hints are disabled by default and never mutate provider state", async () => {
  await withHarness(async ({ store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    await expectStoreError(store.requestUnverifiedCallbackHint({
      scope: statusScope, providerRequestId: "request-a", hintId: "hint-disabled"
    }), "callbacks_disabled");
  });
  await withHarness(async ({ store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal(await store.requestUnverifiedCallbackHint({ scope: statusScope, providerRequestId: "request-a", hintId: "hint-a" }), "queued");
    assert.equal(await store.requestUnverifiedCallbackHint({ scope: statusScope, providerRequestId: "request-a", hintId: "hint-a" }), "duplicate");
    assert.equal(await store.projection(statusScope, "request-a"), undefined);
    await assert.rejects(store.requestUnverifiedCallbackHint({
      scope: statusScope, providerRequestId: "request-a", hintId: "hint-b", receivedAt: 0
    }), (error) => error instanceof StatusStoreError && error.code === "invalid_record");
  }, { allowUnverifiedHints: true });
});

add("callback hints cannot shorten trusted retry floors after restart for scheduled polls or reconciliation", async () => {
  await withHarness(async ({ directory, clock, store, lookup, calls }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).safeFailure, "rate_limited");
    await Promise.all(["scheduled-hint-a", "scheduled-hint-b"].map((hintId) => store.requestUnverifiedCallbackHint({
      scope: statusScope, providerRequestId: "request-a", hintId
    })));
    const reopened = await openStatusStore({ directory, clock, lookup, allowUnverifiedHints: true });
    assert.equal(await reopened.requestUnverifiedCallbackHint({
      scope: statusScope, providerRequestId: "request-a", hintId: "scheduled-hint-after-reopen"
    }), "queued");
    clock.advance(4_999);
    assert.equal((await reopened.runOneDuePoll()).status, "no_due_work");
    assert.equal(calls.length, 1);
    clock.advance(1);
    assert.equal((await reopened.runOneDuePoll()).status, "retry_scheduled");
    assert.equal(calls.length, 2);
  }, { allowUnverifiedHints: true, responses: [
    { status: "rate_limited", retryAfterMs: 5_000 },
    { status: "unavailable" }
  ] });

  await withHarness(async ({ directory, clock, store, lookup, calls }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    assert.equal(await store.requestUnverifiedCallbackHint({
      scope: statusScope, providerRequestId: "request-a", hintId: "reconcile-reactivate"
    }), "queued");
    clock.advance(1_000);
    assert.equal((await store.runOneDuePoll()).status, "unresolved");
    clock.advance(2_000);
    assert.equal((await store.runOneDuePoll()).safeFailure, "rate_limited");
    assert.equal(calls.at(-1).reason, "canonical_reconciliation");
    await Promise.all(["reconcile-hint-a", "reconcile-hint-b"].map((hintId) => store.requestUnverifiedCallbackHint({
      scope: statusScope, providerRequestId: "request-a", hintId
    })));
    const reopened = await openStatusStore({ directory, clock, lookup, allowUnverifiedHints: true });
    assert.equal(await reopened.requestUnverifiedCallbackHint({
      scope: statusScope, providerRequestId: "request-a", hintId: "reconcile-hint-after-reopen"
    }), "queued");
    clock.advance(4_999);
    assert.equal((await reopened.runOneDuePoll()).status, "no_due_work");
    assert.equal(calls.length, 3);
    clock.advance(1);
    assert.equal((await reopened.runOneDuePoll()).safeFailure, "lookup_unavailable");
    assert.equal(calls.at(-1).reason, "canonical_reconciliation");
  }, { allowUnverifiedHints: true, responses: [
    { status: "found", observation: statusObservation({ sourceObservationId: "floor-delivered", status: "fixture.delivered" }) },
    { status: "found", observation: statusObservation({ sourceObservationId: "floor-cancelled", status: "fixture.cancelled" }) },
    { status: "rate_limited", retryAfterMs: 5_000 },
    { status: "unavailable" }
  ] });
});

add("aggregate shipment, item, and contribution limits reject before write and remain readable and appendable", async () => {
  const shipment = (shipmentId, items = []) => shipmentFact({
    shipmentId, carrierCode: undefined, trackingNumber: undefined, trackingUrl: undefined, items
  });
  const item = (itemId, quantities = []) => itemFact({ itemId, quantities });
  const observation = (sourceObservationId, shipments) => statusObservation({
    sourceObservationId, status: "fixture.shipped", shipments
  });
  const contributionBatch = (prefix, count, start = 0) => Array.from({ length: count }, (_, index) =>
    deltaQuantity(1, `part-${prefix}-${start + index}`));

  const verifyCapacityFailure = async ({ seeds, overflow, gaps, expectedHistory }) => {
    await withHarness(async ({ directory, clock, store, lookup, queue }) => {
      await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
      for (let index = 0; index < seeds.length; index += 1) {
        queue.push({ status: "found", observation: seeds[index] });
        assert.equal((await store.runOneDuePoll()).status, "observed");
        if (gaps[index] !== undefined) clock.advance(gaps[index]);
      }
      let committedBeforeCandidate;
      queue.push(async () => {
        committedBeforeCandidate = await readFile(statusStatePath(directory), "utf8");
        return { status: "found", observation: overflow };
      });
      await expectStoreError(store.runOneDuePoll(), "capacity_exceeded");
      assert.equal(await readFile(statusStatePath(directory), "utf8"), committedBeforeCandidate);

      let reopened = await openStatusStore({ directory, clock, lookup });
      assert.equal((await reopened.history(statusScope, "request-a")).length, expectedHistory);
      assert.ok(await reopened.projection(statusScope, "request-a"));
      clock.advance(30_001);
      queue.push({ status: "unavailable" });
      assert.equal((await reopened.runOneDuePoll()).status, "retry_scheduled");
      reopened = await openStatusStore({ directory, clock, lookup });
      assert.equal((await reopened.history(statusScope, "request-a")).length, expectedHistory);

      clock.advance(5_000);
      queue.push({ status: "found", observation: {
        ...seeds.at(-1), sourceObservationId: "capacity-recovered-duplicate"
      } });
      assert.equal((await reopened.runOneDuePoll()).status, "duplicate");
      assert.equal((await reopened.history(statusScope, "request-a")).length, expectedHistory + 1);
      assert.ok(await openStatusStore({ directory, clock, lookup }));
    });
  };

  await verifyCapacityFailure({
    seeds: [observation("shipments-at-bound", Array.from({ length: 200 }, (_, index) => shipment(`shipment-${index}`)))],
    overflow: observation("shipment-over-bound", [shipment("shipment-200")]),
    gaps: [1_000],
    expectedHistory: 1
  });
  await verifyCapacityFailure({
    seeds: [observation("items-at-bound", [
      shipment("shipment-items", Array.from({ length: 2_000 }, (_, index) => item(`sku-${index}`)))
    ])],
    overflow: observation("item-over-bound", [shipment("shipment-items", [item("sku-2000")])]),
    gaps: [1_000],
    expectedHistory: 1
  });
  await verifyCapacityFailure({
    seeds: [
      observation("contributions-4000", [shipment("shipment-quantity", [item("sku-quantity", contributionBatch("a", 4_000))])]),
      observation("contributions-8000", [shipment("shipment-quantity", [item("sku-quantity", contributionBatch("b", 4_000))])]),
      observation("contributions-10000", [shipment("shipment-quantity", [item("sku-quantity", contributionBatch("c", 2_000))])])
    ],
    overflow: observation("contribution-over-bound", [shipment("shipment-quantity", [item("sku-quantity", [
      deltaQuantity(1, "part-c-1999"), deltaQuantity(1, "part-over-bound")
    ])])]),
    gaps: [1_000, 2_000, 4_000],
    expectedHistory: 3
  });
});

add("delta quantity totals retain the existing safe-integer range beyond one billion", async () => {
  const largeBatch = Array.from({ length: 1_001 }, (_, index) => deltaQuantity(1_000_000, `large-part-${index}`));
  await withHarness(async ({ directory, clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    const projection = await store.projection(statusScope, "request-a");
    assert.equal(projection.shipments[0].items[0].quantities[0].total, 1_001_000_000);
    const reopened = await openStatusStore({ directory, clock });
    assert.equal((await reopened.projection(statusScope, "request-a")).shipments[0].items[0].quantities[0].total, 1_001_000_000);
  }, { responses: [{ status: "found", observation: statusObservation({ sourceObservationId: "large-safe-total", shipments: [
    shipmentFact({ items: [itemFact({ quantities: largeBatch })] })
  ] }) }] });
});

add("outbox leases replay one stable event ID and fence stale acknowledgments", async () => {
  await withHarness(async ({ directory, clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    const childCode = `${childStorePrefix()}
import { writeFile } from "node:fs/promises";
const lease = await store.claimOutbox(scope, "crash-consumer", 1_000);
if (!lease) process.exit(9);
await writeFile(process.env.FC_STATUS_ACCEPTED, JSON.stringify({eventId: lease.event.eventId, token: lease.token, fence: lease.fence}));`;
    const child = await spawnChild(childCode, {
      FC_STATUS_DIR: directory,
      FC_STATUS_NOW: String(clock.value),
      FC_STATUS_ACCEPTED: join(directory, "consumer-accepted.json")
    });
    assert.equal(child.status, 0, child.stderr);
    const accepted = JSON.parse(await readFile(join(directory, "consumer-accepted.json"), "utf8"));
    clock.advance(1_001);
    const reopened = await openStatusStore({ directory, clock });
    const secondLease = await reopened.claimOutbox(statusScope, "replay-consumer", 5_000);
    assert.ok(secondLease);
    assert.equal(secondLease.event.eventId, accepted.eventId);
    assert.equal(secondLease.fence, accepted.fence + 1);
    await expectStoreError(reopened.acknowledgeOutbox({
      scope: statusScope, eventId: accepted.eventId, consumerId: "crash-consumer", token: accepted.token, fence: accepted.fence
    }), "stale_lease");
    assert.equal(await reopened.acknowledgeOutbox({
      scope: statusScope, eventId: secondLease.event.eventId, consumerId: "replay-consumer", token: secondLease.token, fence: secondLease.fence
    }), "acked");
    assert.equal(await reopened.acknowledgeOutbox({
      scope: statusScope, eventId: secondLease.event.eventId, consumerId: "replay-consumer", token: secondLease.token, fence: secondLease.fence
    }), "already_acked");
  }, { responses: [{ status: "found", observation: statusObservation({ sourceObservationId: "outbox-source" }) }] });
});

add("poll lease and outbox pending, leased, expired, and acknowledged field groups are exact and fenced", async () => {
  await withHarness(async ({ directory, clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    const statePath = statusStatePath(directory);
    const original = await readFile(statePath, "utf8");
    const rejectsUnchanged = async (mutate) => {
      const damaged = JSON.parse(original);
      mutate(damaged);
      const text = JSON.stringify(damaged);
      await writeFile(statePath, text, { mode: 0o600 });
      await expectStoreError(openStatusStore({ directory, clock }), "corrupt_state");
      assert.equal(await readFile(statePath, "utf8"), text);
    };
    const leased = (state) => {
      Object.assign(state.outbox[0], {
        status: "leased", leaseFence: 1, leaseToken: "lease-token", leaseUntil: clock.value + 5_000, leaseConsumer: "consumer-a"
      });
    };
    const acked = (state) => {
      Object.assign(state.outbox[0], {
        status: "acked", leaseFence: 1, ackToken: "ack-token", ackFence: 1, ackConsumer: "consumer-a"
      });
    };
    const mutations = [
      (state) => { state.outbox[0].leaseToken = "orphan-token"; },
      (state) => { leased(state); delete state.outbox[0].leaseToken; },
      (state) => { leased(state); delete state.outbox[0].leaseUntil; },
      (state) => { leased(state); delete state.outbox[0].leaseConsumer; },
      (state) => { leased(state); state.outbox[0].leaseFence = 0; },
      (state) => { leased(state); state.outbox[0].leaseToken = []; },
      (state) => { leased(state); state.outbox[0].leaseUntil = -1; },
      (state) => { leased(state); state.outbox[0].leaseConsumer = ""; },
      (state) => { leased(state); state.outbox[0].ackToken = "partial-ack"; },
      (state) => { acked(state); state.outbox[0].ackFence = 99; },
      (state) => { acked(state); state.outbox[0].ackFence = 0; },
      (state) => { acked(state); delete state.outbox[0].ackToken; },
      (state) => { acked(state); delete state.outbox[0].ackFence; },
      (state) => { acked(state); delete state.outbox[0].ackConsumer; },
      (state) => { acked(state); state.outbox[0].ackToken = []; },
      (state) => { acked(state); state.outbox[0].ackConsumer = ""; },
      (state) => { acked(state); state.outbox[0].leaseToken = "coexisting-lease"; },
      (state) => { acked(state); state.outbox[0].leaseFence = 0; },
      (state) => {
        const target = state.pollTargets[0];
        target.leaseFence = 2;
        target.lease = { kind: "scheduled_poll", token: "poll-token", fence: 1, expiresAt: clock.value + 5_000 };
      },
      (state) => {
        const target = state.pollTargets[0];
        target.leaseFence = 1;
        target.lease = { kind: "scheduled_poll", token: "poll-token", fence: 1 };
      },
      (state) => {
        const target = state.pollTargets[0];
        target.leaseFence = 1;
        target.lease = { kind: "scheduled_poll", token: [], fence: 1, expiresAt: clock.value + 5_000 };
      }
    ];
    for (const mutate of mutations) {
      await rejectsUnchanged(mutate);
      await writeFile(statePath, original, { mode: 0o600 });
    }

    const validPollLease = JSON.parse(original);
    validPollLease.pollTargets[0].leaseFence = 1;
    validPollLease.pollTargets[0].lease = {
      kind: "scheduled_poll", token: "valid-poll-token", fence: 1, expiresAt: clock.value - 1
    };
    await writeFile(statePath, JSON.stringify(validPollLease), { mode: 0o600 });
    assert.ok(await openStatusStore({ directory, clock }));
    await writeFile(statePath, original, { mode: 0o600 });

    const reopened = await openStatusStore({ directory, clock });
    const firstLease = await reopened.claimOutbox(statusScope, "valid-consumer", 1_000);
    assert.ok(firstLease);
    assert.ok(await openStatusStore({ directory, clock }));
    clock.advance(1_001);
    const afterExpiry = await (await openStatusStore({ directory, clock })).claimOutbox(statusScope, "replay-consumer", 5_000);
    assert.ok(afterExpiry);
    assert.equal(afterExpiry.event.eventId, firstLease.event.eventId);
    assert.equal(afterExpiry.fence, firstLease.fence + 1);
    assert.equal(await (await openStatusStore({ directory, clock })).acknowledgeOutbox({
      scope: statusScope, eventId: afterExpiry.event.eventId, consumerId: "replay-consumer", token: afterExpiry.token, fence: afterExpiry.fence
    }), "acked");
    const ackedStore = await openStatusStore({ directory, clock });
    assert.equal((await ackedStore.projection(statusScope, "request-a")).state, "accepted");
    assert.equal(await ackedStore.claimOutbox(statusScope, "valid-consumer", 1_000), undefined);
  }, { responses: [{ status: "found", observation: statusObservation({ sourceObservationId: "fence-seed" }) }] });
});

add("a process death after poll lease commit allows one fenced restart recovery", async () => {
  await withHarness(async ({ directory, clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    const ready = join(directory, "poll-claimed.json");
    const childCode = `${childStorePrefix()}
const lookup = async () => {
  const fs = await import("node:fs/promises");
  await fs.writeFile(process.env.FC_STATUS_READY, "claimed");
  await new Promise(() => { setInterval(() => {}, 1_000); });
};
const workerStore = await LocalStatusStore.open({ directory, providerId: ${JSON.stringify(statusProviderId)}, mode: "simulated",
  mapping: fixtureStatusMapping(${JSON.stringify(statusProviderId)}), trackingPolicy: fixtureTrackingHostPolicy(), lookup: { lookup },
  clock: { now: () => now } });
await workerStore.runOneDuePoll(1_000);`;
    const child = spawn(process.execPath, ["--input-type=module", "-e", childCode], {
      cwd: repositoryRoot,
      env: { ...childEnv(), FC_STATUS_DIR: directory, FC_STATUS_NOW: String(clock.value), FC_STATUS_READY: ready },
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    const closed = new Promise((resolvePromise, rejectPromise) => {
      child.on("error", rejectPromise);
      child.on("close", (status, signal) => resolvePromise({ status, signal }));
    });
    await waitForFile(ready);
    child.kill("SIGKILL");
    const exit = await closed;
    assert.equal(exit.signal, "SIGKILL", stderr);
    clock.advance(1_001);
    const recovered = await openStatusStore({ directory, clock, lookup: async () => ({
      status: "found", observation: statusObservation({ sourceObservationId: "recovered-after-kill" })
    }) });
    assert.equal((await recovered.runOneDuePoll(1_000)).status, "observed");
    assert.equal((await recovered.projection(statusScope, "request-a")).state, "accepted");
    assert.equal((await recovered.history(statusScope, "request-a")).length, 1);
    assert.equal(typeof store.projection, "function");
  });
});

add("simultaneous processes cannot claim the same due poll or outbox event", async () => {
  await withHarness(async ({ directory, clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    const pollLog = join(directory, "poll-lookups.log");
    const pollCode = `${childStorePrefix()}
const lookup = async () => {
  const fs = await import("node:fs/promises");
  await fs.appendFile(process.env.FC_STATUS_POLL_LOG, "lookup\\n");
  await new Promise((resolve) => setTimeout(resolve, 120));
  return { status: "found", observation: ${JSON.stringify(statusObservation({ sourceObservationId: "multi-process-poll" }))} };
};
const concurrentStore = await LocalStatusStore.open({ directory, providerId: ${JSON.stringify(statusProviderId)}, mode: "simulated",
  mapping: fixtureStatusMapping(${JSON.stringify(statusProviderId)}), trackingPolicy: fixtureTrackingHostPolicy(), lookup: { lookup },
  clock: { now: () => now } });
const result = await concurrentStore.runOneDuePoll();
process.stdout.write(JSON.stringify({status: result.status}));`;
    const workers = await Promise.all(Array.from({ length: 5 }, () => spawnChild(pollCode, {
      FC_STATUS_DIR: directory,
      FC_STATUS_NOW: String(clock.value),
      FC_STATUS_POLL_LOG: pollLog
    })));
    for (const worker of workers) assert.equal(worker.status, 0, worker.stderr);
    const pollCalls = (await readFile(pollLog, "utf8")).trim().split(/\r?\n/u).filter(Boolean);
    assert.equal(pollCalls.length, 1);
    assert.equal(workers.map((worker) => JSON.parse(worker.stdout).status).filter((status) => status === "observed").length, 1);
    assert.equal(workers.map((worker) => JSON.parse(worker.stdout).status).filter((status) => status === "no_due_work").length, 4);

    const outboxCode = `${childStorePrefix()}
const lease = await store.claimOutbox(scope, "race-consumer", 10_000);
process.stdout.write(JSON.stringify({eventId: lease?.event.eventId ?? null, fence: lease?.fence ?? null}));`;
    const outboxWorkers = await Promise.all(Array.from({ length: 5 }, () => spawnChild(outboxCode, {
      FC_STATUS_DIR: directory,
      FC_STATUS_NOW: String(clock.value)
    })));
    for (const worker of outboxWorkers) assert.equal(worker.status, 0, worker.stderr);
    const leases = outboxWorkers.map((worker) => JSON.parse(worker.stdout)).filter((result) => result.eventId !== null);
    assert.equal(leases.length, 1);
    assert.equal(outboxWorkers.map((worker) => JSON.parse(worker.stdout)).filter((result) => result.eventId === null).length, 4);
  }, { allowUnverifiedHints: false });
});

add("store rejects policy substitution and corrupt snapshots without rewriting them", async () => {
  await withHarness(async ({ directory, clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    await store.runOneDuePoll();
    const modifiedStatuses = { ...fixtureStatusMapping().statuses, "fixture.accepted": "delivered" };
    await expectStoreError(openStatusStore({ directory, clock, mapping: {
      providerId: statusProviderId, version: "fc-status-map-fixture/1", policyState: "development_fixture", statuses: modifiedStatuses
    } }), "binding_mismatch");

    const statePath = join(directory, ".status-store-v1", "metering-state.json");
    const original = await readFile(statePath, "utf8");
    const rejectsUnchangedBytes = async (mutate) => {
      const damaged = JSON.parse(original);
      mutate(damaged);
      const damagedText = JSON.stringify(damaged);
      await writeFile(statePath, damagedText, { mode: 0o600 });
      await expectStoreError(openStatusStore({ directory, clock }), "corrupt_state");
      assert.equal(await readFile(statePath, "utf8"), damagedText);
    };
    try {
      await rejectsUnchangedBytes((damaged) => { damaged.observations[0].providerStatus = { unsafe: true }; });
      await rejectsUnchangedBytes((damaged) => { damaged.observations[0].providerId = "foreign-provider"; });
      await rejectsUnchangedBytes((damaged) => { damaged.effectIds = []; });
      await rejectsUnchangedBytes((damaged) => { damaged.projections[0].observationIds = []; });
      await rejectsUnchangedBytes((damaged) => { damaged.outbox = []; });
      await rejectsUnchangedBytes((damaged) => { damaged.outbox[0].payload.state = "shipped"; });
    } finally {
      await writeFile(statePath, original, { mode: 0o600 });
    }

    const symlinkPath = join(directory, "unsafe-link");
    await symlink(directory, symlinkPath);
    await expectStoreError(openStatusStore({ directory: symlinkPath, clock }), "invalid_path");
  }, { responses: [{ status: "found", observation: statusObservation({ sourceObservationId: "corruption-seed" }) }] });
});

add("committed marker rejects detectable state loss, reset, marker loss, and unsupported format without repair", async () => {
  await withHarness(async ({ directory, clock, store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    const statePath = statusStatePath(directory);
    const markerPath = statusMarkerPath(directory);
    const originalState = await readFile(statePath, "utf8");
    const originalMarker = await readFile(markerPath, "utf8");

    await unlink(statePath);
    await expectStoreError(openStatusStore({ directory, clock }), "corrupt_state");
    await assert.rejects(readFile(statePath), (error) => error?.code === "ENOENT");
    assert.equal(await readFile(markerPath, "utf8"), originalMarker);
    await writeFile(statePath, originalState, { mode: 0o600 });

    await writeFile(statePath, "", { mode: 0o600 });
    await expectStoreError(openStatusStore({ directory, clock }), "corrupt_state");
    assert.equal(await readFile(statePath, "utf8"), "");
    await writeFile(statePath, originalState, { mode: 0o600 });

    const emptyCommitted = JSON.parse(originalState);
    for (const key of ["observations", "projections", "conflicts", "resolutions", "pollTargets", "callbackHints", "outbox", "effectIds"]) {
      emptyCommitted[key] = [];
    }
    const emptyCommittedText = JSON.stringify(emptyCommitted);
    await writeFile(statePath, emptyCommittedText, { mode: 0o600 });
    await expectStoreError(openStatusStore({ directory, clock }), "corrupt_state");
    assert.equal(await readFile(statePath, "utf8"), emptyCommittedText);
    await writeFile(statePath, originalState, { mode: 0o600 });

    await unlink(markerPath);
    await expectStoreError(openStatusStore({ directory, clock }), "corrupt_state");
    assert.equal(await readFile(statePath, "utf8"), originalState);
    await assert.rejects(readFile(markerPath), (error) => error?.code === "ENOENT");
    await writeFile(markerPath, originalMarker, { mode: 0o600 });

    const unsupported = JSON.parse(originalState);
    unsupported.format = "fc-status-store/1";
    const unsupportedText = JSON.stringify(unsupported);
    await writeFile(statePath, unsupportedText, { mode: 0o600 });
    await expectStoreError(openStatusStore({ directory, clock }), "unsupported_version");
    assert.equal(await readFile(statePath, "utf8"), unsupportedText);
    await writeFile(statePath, originalState, { mode: 0o600 });
    assert.equal((await (await openStatusStore({ directory, clock })).history(statusScope, "request-a")).length, 1);
  }, { responses: [{ status: "found", observation: statusObservation({ sourceObservationId: "marker-seed" }) }] });
});

add("mapping and caller-owned arrays are snapshotted before later mutation", async () => {
  const original = fixtureStatusMapping();
  const mapping = { ...original, statuses: { ...original.statuses } };
  await withHarness(async ({ directory, clock }) => {
    const store = await openStatusStore({ directory, clock, mapping, lookup: async () => ({
      status: "found", observation: statusObservation({ sourceObservationId: "snapshot-mapping" })
    }) });
    mapping.statuses["fixture.accepted"] = "delivered";
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    assert.equal((await store.runOneDuePoll()).status, "observed");
    assert.equal((await store.projection(statusScope, "request-a")).state, "accepted");
  });
});

add("provider lookup failures stay safe and do not cross finance or order boundaries", async () => {
  await withHarness(async ({ store }) => {
    await store.registerPollTarget({ scope: statusScope, providerRequestId: "request-a", policy: statusPollPolicy() });
    const result = await store.runOneDuePoll();
    assert.equal(result.safeFailure, "lookup_unavailable");
    assert.equal(JSON.stringify(result).includes("secret"), false);
    assert.equal(await store.projection(statusScope, "request-a"), undefined);
    assert.equal(Object.hasOwn(result, "orderCalls"), false);
  }, { responses: [async () => { throw new Error("private-provider-secret"); }] });
});

let passedCount = 0;
for (const [name, run] of cases) {
  try {
    await run();
    process.stdout.write(`PASSED ${name}\n`);
    passedCount += 1;
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : "unknown_error";
    process.stdout.write(`FAILED ${name}: ${detail}\n`);
  }
}

process.stdout.write(`Status inbox suite: ${passedCount}/${cases.length} passed\n`);
if (passedCount !== cases.length) process.exitCode = 1;
