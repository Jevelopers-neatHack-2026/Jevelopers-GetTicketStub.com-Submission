// Offline lifecycle fixture. It is copied into a fresh installed-package
// consumer and imports only the package's public entrypoints and Node builtins.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCreativeApi } from "creative-engine/api/v1";
import { canonicalHash } from "creative-engine/contracts";
import { CreativeVersionStore, createCreativeVersionApiPorts } from "creative-engine/versions";
import { createSqliteTelemetryOutbox } from "creative-engine/telemetry";

assert.equal(typeof process.send, "function", "this fixture requires its isolated IPC coordinator");
const config = await new Promise((resolve) => process.once("message", resolve));
const send = (event, fields = {}) => new Promise((resolve, reject) => {
  process.send({ event, worker: config.worker, pid: process.pid, ...fields }, (error) => error ? reject(error) : resolve());
});
const gates = new Map();
async function hold(stage, fields = {}) {
  const released = new Promise((resolve) => gates.set(stage, resolve));
  await send(stage, fields);
  await released;
  gates.delete(stage);
}

// This deliberately prevents accidental provider network calls in this fixture.
globalThis.fetch = () => { throw new Error("public-process fixture cannot dispatch network requests"); };
const store = new CreativeVersionStore({ databasePath: config.databasePath,
  objectRoot: config.objectRoot, now: () => config.now });
const counters = { provider: 0, reservations: 0, settlements: 0, unknown_holds: 0,
  transport_ids: [], durable_observation_ids: [] };
let nextId = 0;
const id = () => `${config.worker}-${++nextId}`;
const bytes = Buffer.from(config.artifactBase64, "base64");
const artifactHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function executeImage(input) {
  await input.recordTransportAttempt(input.transport_attempt_id);
  counters.provider += 1;
  counters.transport_ids.push(input.transport_attempt_id);
  if (config.holdProvider) await hold("provider-held", {
    job_id: input.job_id, transport_attempt_id: input.transport_attempt_id,
    billable_attempt_id: input.billable_attempt_id,
  });
  return { design_version_id: `design-${config.worker}-${counters.provider}`,
    artifact: { artifact_id: `artifact-${config.worker}-${counters.provider}`,
      content_hash: artifactHash, media_type: "image/png" },
    artifact_bytes: Uint8Array.from(bytes), provider: "fixture-provider", model: "fixture-model",
    usage: { completeness: "complete", input_tokens: 2, output_tokens: 4 } };
}

const adapted = createCreativeVersionApiPorts({ store, idFactory: id, otherPorts: {
  provider: {
    resolveRoute: () => ({ retry_mapping_ref: "retry:public-process-fixture/1", provider: {
      name: "fixture-provider", model: "fixture-model", endpoint: "test:/image",
      sdk: { name: "fixture-sdk", version: "1.0" },
    } }),
    generate: executeImage, edit: executeImage,
  },
  metering: {
    async reserveAttempt(attempt) {
      counters.reservations += 1;
      return { status: "reserved", reservation_id: `reservation:${attempt.billable_attempt_id}`,
        billable_attempt_id: attempt.billable_attempt_id,
        held_amount: { amount: "1.00", currency: "USD" }, lease_id: `finance-lease:${attempt.billable_attempt_id}` };
    },
    async releaseBeforeDispatch() { return { status: "released" }; },
    async markAttemptInFlight(input) { return { status: "in_flight", reservation_id: input.reservation_id }; },
    async recordTransportAttempt() { return { status: "recorded" }; },
    async recordUsageObservation(input) {
      const row = store.db.prepare(`SELECT payload_json FROM creative_telemetry_observations_v1
        WHERE source_observation_id=?`).get(input.observation.source_observation_id);
      assert.ok(row, "synthetic Finance ACK requires an already durable usage row");
      assert.equal(JSON.parse(row.payload_json).attempt.billable_attempt_id, input.observation.billable_attempt_id);
      counters.durable_observation_ids.push(input.observation.source_observation_id);
      return { status: "accepted", source_observation_id: input.observation.source_observation_id,
        effective_billable_attempt_id: input.observation.billable_attempt_id };
    },
    async settleReservation(input) {
      counters.settlements += 1;
      return { status: "settled", reservation_id: input.reservation_id,
        consumed_amount: { amount: "0.10", currency: "USD" },
        released_unused_amount: { amount: "0.90", currency: "USD" } };
    },
    async markOutcomeUnknown() { counters.unknown_holds += 1; return { status: "held_for_reconciliation" }; },
  },
} });
const durableOutbox = createSqliteTelemetryOutbox({ database: store.db, clock: () => config.now,
  claimLeaseMs: 1_000, idFactory: id });
let writingUsage = false;
const nativeExec = store.db.exec.bind(store.db);
store.db.exec = (sql) => {
  if (writingUsage && sql === "BEGIN IMMEDIATE") {
    process.send({ event: "usage-lock-attempt", worker: config.worker, pid: process.pid });
  }
  try { return nativeExec(sql); }
  catch (error) {
    if (writingUsage && sql === "BEGIN IMMEDIATE" && error?.code === "ERR_SQLITE_ERROR" &&
      Number.isSafeInteger(error.errcode) && [5, 6].includes(error.errcode & 0xff)) {
      process.send({ event: "usage-lock-busy", worker: config.worker, pid: process.pid,
        code: error.code, errcode: error.errcode });
    }
    throw error;
  }
};
const outbox = Object.freeze({ ...durableOutbox,
  async enqueueUsageObservation(input) {
    writingUsage = true;
    try { return await durableOutbox.enqueueUsageObservation(input); }
    finally { writingUsage = false; }
  },
});
const ports = { ...adapted.ports, telemetry: { outbox,
  modes: { provider_execution_mode: "mock", commerce_mode: "simulated" },
  usage_profiles: { image_generation: "creative.normalized-token-usage/1", image_edit: "creative.normalized-token-usage/1" },
} };
if (config.holdPublication) {
  const commit = ports.storage.commitPreparedDesignVersion;
  ports.storage.commitPreparedDesignVersion = async (...args) => {
    await hold("publication-held", { transaction_open: store.db.isTransaction });
    return commit(...args);
  };
}
const api = createCreativeApi({ ports, now: () => config.now, idFactory: id });

async function command(input) {
  if (input.kind === "release") { gates.get(input.stage)?.(); return; }
  if (input.kind === "transaction-state") {
    await send("transaction-state", { command_id: input.command_id, transaction_open: store.db.isTransaction });
    return;
  }
  if (input.kind === "invoke") {
    const response = await api.invoke(input.principal, input.request);
    await send("result", { command_id: input.command_id, response, counters });
    return;
  }
  if (input.kind === "recover") {
    await send("recovered", { command_id: input.command_id, recovery: await store.recover(), counters });
    return;
  }
  if (input.kind === "claim") {
    const result = await durableOutbox.claimPendingEvidence({ limit: 32, leaseMs: 1_000 });
    await send("claimed", { command_id: input.command_id, result, counters });
    if (input.crash) process.exit(86); // Exact hard-exit fixture; deliberately leave the database open.
    return;
  }
  if (input.kind === "acknowledge") {
    const results = [];
    for (const entry of input.records) results.push(await durableOutbox.acknowledgeEvidence({
      event_id: entry.event.event_id, claim_token: entry.claim_token,
    }));
    await send("acknowledged", { command_id: input.command_id, results, counters });
    return;
  }
  if (input.kind === "close") {
    store.close();
    await send("closed", { counters });
    process.disconnect();
    return;
  }
  throw new Error("Unsupported public-process fixture command");
}
process.on("message", (input) => command(input).catch(async (error) => {
  process.exitCode = 1;
  await send("failed", { command_id: input.command_id, error: { name: error.name, message: error.message,
    code: error.code, stack: error.stack } });
  process.disconnect();
}));
if (config.brief) store.putBrief({ scope: config.scope, brief: config.brief });
await send("ready", { runtime: process.version, module_url: import.meta.url, database_path: config.databasePath,
  ...(config.brief ? { brief_hash: canonicalHash(config.brief) } : {}) });
