import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { canonicalHash } from "../../src/contracts/index.mjs";
import { CreativeVersionStore, readPrivateStoreMigrationDiagnostic } from "../../src/versions/store.mjs";
import { createCreativeVersionApiPorts } from "../../src/versions/api-ports.mjs";
import { createStore, DEFAULT_SCOPE } from "../versions/helpers.mjs";

// Offline store checks for the explicit native image provider allowlist: openai and openrouter are accepted,
// every other name is not, and databases created with the old openai-only CHECK are widened in place.

const MODEL = "synthetic-lab/image-model-offline";

async function dispatchRow(store, ports, name, provider = "openrouter", model = MODEL) {
  const request_hash = canonicalHash({ name });
  const started = await ports.jobs.begin({ scope: DEFAULT_SCOPE, actor_id: "actor-1", action_id: name, request_hash, operation: "generate" });
  assert.equal(started.kind, "started");
  const row = { action_id: name, request_hash, job_id: started.job_id, transport_attempt_id: `transport:${name}`,
    billable_attempt_id: `billable:${name}`, reservation_ref: `reservation:${name}`, dispatch_intent_ref: `dispatch:${name}` };
  store.db.prepare(`INSERT INTO creative_dispatch_intents
    (tenant_id,project_id,job_id,transport_attempt_id,billable_attempt_id,reservation_ref,provider_name,provider_model,
     dispatch_intent_ref,context_fence_json,authorized_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(DEFAULT_SCOPE.tenant_id, DEFAULT_SCOPE.project_id, row.job_id, row.transport_attempt_id, row.billable_attempt_id,
      row.reservation_ref, provider, model, row.dispatch_intent_ref, "{}", "2026-10-11T12:00:00.000Z");
  return row;
}

function usageInput(row, provider, model, usage) {
  return { scope: DEFAULT_SCOPE, actor_id: "actor-1", job_id: row.job_id, action_id: row.action_id,
    request_hash: row.request_hash, operation: "generate", provider, model, reservation_ref: row.reservation_ref,
    billable_attempt_id: row.billable_attempt_id, transport_attempt_id: row.transport_attempt_id,
    dispatch_intent_ref: row.dispatch_intent_ref, target_binding_sha256: `sha256:${"a".repeat(64)}`,
    usage_sha256: canonicalHash(usage), usage };
}

const USAGE = { completeness: "unknown", transport_attempt_id: "", input_tokens: 4, missing_fields: ["usage.profile_mapping_pending"] };

function storeMigrationSnapshot(database) {
  const schema = database.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all();
  const tables = schema.filter((row) => row.type === "table").map((row) => row.name);
  const rows = Object.fromEntries(tables.map((table) => [table, database.prepare(`SELECT * FROM "${table}"`).all()
    .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
      value instanceof Uint8Array ? { blob_base64: Buffer.from(value).toString("base64") } : value])))]));
  return { user_version: database.prepare("PRAGMA user_version").get().user_version, schema, rows };
}

test("private usage attribution accepts the explicit allowlist and rejects every other provider", async (t) => {
  const { store } = await createStore(t);
  let id = 0;
  const ports = createCreativeVersionApiPorts({ store, idFactory: () => `or-store-port-${++id}` });
  const openrouter = await dispatchRow(store, ports, "or-row");
  const usage = { ...USAGE, transport_attempt_id: openrouter.transport_attempt_id,
    cost: { amount: "0.04", currency: "USD", provenance: "provider_reported_unsettled" },
    cost_details: { upstream_inference_cost: "0.035" }, is_byok: false };
  assert.equal(store.recordPrivateProviderUsageAttribution(usageInput(openrouter, "openrouter", MODEL, usage)).status, "recorded");
  assert.equal(store.db.prepare("SELECT provider_name FROM private_provider_usage_attributions").get().provider_name, "openrouter");

  const mislabeled = await dispatchRow(store, ports, "or-mislabeled", "openai", "gpt-image-2.5-sunburst-2026-09-08");
  assert.throws(() => store.recordPrivateProviderUsageAttribution(usageInput(mislabeled, "openrouter", MODEL,
    { ...USAGE, transport_attempt_id: mislabeled.transport_attempt_id })), /integrity|supported local contract/i,
  "the attributed provider must equal the dispatched provider");

  for (const provider of ["anthropic", "constructor", "OPENROUTER", undefined]) {
    const row = await dispatchRow(store, ports, `or-denied-${String(provider)}`, "openrouter");
    assert.throws(() => store.recordPrivateProviderUsageAttribution(usageInput(row, provider, MODEL,
      { ...USAGE, transport_attempt_id: row.transport_attempt_id })), /supported local contract/i, String(provider));
  }
  const direct = await dispatchRow(store, ports, "openai-row", "openai", "gpt-image-2.5-sunburst-2026-09-08");
  assert.equal(store.recordPrivateProviderUsageAttribution(usageInput(direct, "openai", "gpt-image-2.5-sunburst-2026-09-08",
    { ...USAGE, transport_attempt_id: direct.transport_attempt_id })).status, "recorded");
});

test("cost fields stay OpenRouter-only and must keep the unsettled provider-reported label", async (t) => {
  const { store } = await createStore(t);
  let id = 0;
  const ports = createCreativeVersionApiPorts({ store, idFactory: () => `or-store-cost-${++id}` });
  const direct = await dispatchRow(store, ports, "direct-with-cost", "openai", "gpt-image-2.5-sunburst-2026-09-08");
  assert.throws(() => store.recordPrivateProviderUsageAttribution(usageInput(direct, "openai", "gpt-image-2.5-sunburst-2026-09-08",
    { ...USAGE, transport_attempt_id: direct.transport_attempt_id, cost: { amount: "0.04", currency: "USD", provenance: "provider_reported_unsettled" } })),
  /supported local contract/i, "the direct OpenAI allowlist is not widened");
  const bad = [
    { cost: { amount: "0.04", currency: "USD", provenance: "settled" } },
    { cost: { amount: "-1", currency: "USD", provenance: "provider_reported_unsettled" } },
    { cost: { amount: "0.04", currency: "EUR", provenance: "provider_reported_unsettled" } },
    { cost_details: { other_cost: "1" } },
    { is_byok: "yes" },
  ];
  for (const [index, extra] of bad.entries()) {
    const row = await dispatchRow(store, ports, `bad-cost-${index}`);
    assert.throws(() => store.recordPrivateProviderUsageAttribution(usageInput(row, "openrouter", MODEL,
      { ...USAGE, transport_attempt_id: row.transport_attempt_id, ...extra })), /supported local contract/i, JSON.stringify(extra));
  }
});

test("a schema-13 database with the legacy openai-only CHECK is widened in place without losing rows, triggers, or keys", async (t) => {
  const { store: original } = await createStore(t);
  let id = 0;
  const makePorts = (store) => createCreativeVersionApiPorts({ store, idFactory: () => `or-widen-port-${++id}` });
  const legacy = await dispatchRow(original, makePorts(original), "legacy-row", "openai", "gpt-image-2.5-sunburst-2026-09-08");
  const providerRequestId = "fixture-only:legacy-request";
  assert.equal(original.recordPrivateProviderAttribution({ scope: DEFAULT_SCOPE, actor_id: "actor-1",
    job_id: legacy.job_id, action_id: legacy.action_id, request_hash: legacy.request_hash, operation: "generate",
    provider: "openai", model: "gpt-image-2.5-sunburst-2026-09-08", reservation_ref: legacy.reservation_ref,
    billable_attempt_id: legacy.billable_attempt_id, transport_attempt_id: legacy.transport_attempt_id,
    dispatch_intent_ref: legacy.dispatch_intent_ref, provider_request_id: providerRequestId,
    provider_request_ref: `provider-request-${createHash("sha256").update(providerRequestId, "utf8").digest("hex")}` }).status,
  "recorded");
  original.recordPrivateProviderUsageAttribution(usageInput(legacy, "openai", "gpt-image-2.5-sunburst-2026-09-08",
    { ...USAGE, transport_attempt_id: legacy.transport_attempt_id }));
  // Recreate the tables from the verbatim base (dbbd10d) DDL, including its triggers.
  const sql = (name) => original.db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(name).sql;
  const widened = "CHECK(provider_name IN ('openai','openrouter'))";
  assert.ok(sql("private_provider_usage_attributions").includes(widened), "fresh databases use the allowlist");
  const rows = {};
  const triggerSql = {};
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    rows[table] = original.db.prepare(`SELECT * FROM ${table}`).all().map((row) => ({ ...row }));
    triggerSql[table] = original.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name")
      .all(table);
    original.db.exec(`DROP TABLE ${table}`);
  }
  original.db.exec(readFileSync(new URL("../../fixtures/versions/legacy-private-attribution-ddl.sql", import.meta.url), "utf8"));
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    for (const row of rows[table]) {
      original.db.prepare(`INSERT INTO ${table} VALUES(${Object.keys(row).map(() => "?").join(",")})`).run(...Object.values(row));
    }
  }
  assert.ok(sql("private_provider_usage_attributions").includes("CHECK(provider_name='openai')"));
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    assert.throws(() => original.db.prepare(`UPDATE ${table} SET provider_model='x'`).run(), /immutable/);
  }
  const { databasePath, objectRoot } = original;
  original.close();

  const migrated = new CreativeVersionStore({ databasePath, objectRoot, now: () => Date.parse("2026-10-11T12:00:00.000Z") });
  t.after(() => migrated.close());
  assert.equal(migrated.db.prepare("PRAGMA user_version").get().user_version, 13,
    "the additive private CHECK rebuild does not change the current schema version");
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    assert.deepEqual(migrated.db.prepare(`SELECT * FROM ${table}`).all().map((row) => ({ ...row })), rows[table],
      `${table} retains every full private record across the independent opener`);
    assert.deepEqual(migrated.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name")
      .all(table), triggerSql[table], `${table} retains its exact immutability trigger SQL`);
  }
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    const rebuilt = migrated.db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table).sql;
    assert.ok(rebuilt.includes(widened) && !rebuilt.includes("CHECK(provider_name='openai')"), table);
  }
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    assert.throws(() => migrated.db.prepare(`UPDATE ${table} SET provider_model='x'`).run(), /immutable/);
    assert.throws(() => migrated.db.prepare(`DELETE FROM ${table}`).run(), /immutable/);
  }
  assert.deepEqual(migrated.db.prepare("PRAGMA foreign_key_check").all(), []);
  const ports = makePorts(migrated);
  const fresh = await dispatchRow(migrated, ports, "after-widen");
  assert.equal(migrated.recordPrivateProviderUsageAttribution(usageInput(fresh, "openrouter", MODEL,
    { ...USAGE, transport_attempt_id: fresh.transport_attempt_id })).status, "recorded");
  assert.throws(() => migrated.db.prepare(`INSERT INTO private_provider_usage_attributions
    SELECT tenant_id,project_id,job_id,action_id,actor_id,request_hash,operation,'anthropic',provider_model,reservation_ref,
      billable_attempt_id,transport_attempt_id,dispatch_intent_ref,target_binding_sha256,usage_sha256,usage_json,captured_at
    FROM private_provider_usage_attributions LIMIT 1`).run(), /CHECK constraint failed/);
  migrated.close();
  const reopened = new CreativeVersionStore({ databasePath, objectRoot, now: () => Date.parse("2026-10-11T12:00:00.000Z") });
  t.after(() => reopened.close());
  assert.equal(reopened.db.prepare("PRAGMA user_version").get().user_version, 13);
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    assert.deepEqual(reopened.db.prepare(`SELECT * FROM ${table}`).all().slice(0, rows[table].length).map((row) => ({ ...row })),
      rows[table], `${table} keeps the same legacy rows after an idempotent second open`);
    assert.deepEqual(reopened.db.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name=? ORDER BY name")
      .all(table), triggerSql[table]);
  }
  assert.equal(reopened.db.prepare("SELECT COUNT(*) AS n FROM private_provider_usage_attributions").get().n, 2,
    "reopening is idempotent and keeps both rows");
});

test("a failed widening migration reports a generic storage_version error and keeps a sanitized private cause", async (t) => {
  const { store: original } = await createStore(t);
  original.db.exec("DROP TABLE private_provider_attributions; DROP TABLE private_provider_usage_attributions;");
  original.db.exec(readFileSync(new URL("../../fixtures/versions/legacy-private-attribution-ddl.sql", import.meta.url), "utf8"));
  // The first private table can rebuild inside makeSchema's borrowed transaction;
  // a conflict on the second rebuild must roll back that first change too.
  original.db.exec("CREATE TABLE private_provider_usage_attributions_widen_old (x TEXT)");
  const before = storeMigrationSnapshot(original.db);
  const { databasePath, objectRoot } = original;
  original.close();
  let caught;
  try { new CreativeVersionStore({ databasePath, objectRoot }); } catch (error) { caught = error; }
  assert.equal(caught?.field, "storage_version");
  const diagnostic = readPrivateStoreMigrationDiagnostic(caught);
  assert.ok(diagnostic && typeof diagnostic === "object");
  assert.ok(!JSON.stringify(caught).includes("private_provider_attributions"));
  assert.ok(!String(caught.message).includes("widen_old"));
  const after = new DatabaseSync(databasePath);
  assert.deepEqual(storeMigrationSnapshot(after), before,
    "failure in the second independent table rebuild restores both prior schemas, triggers, rows, and version");
  assert.deepEqual(after.prepare("PRAGMA foreign_key_check").all(), []);
  after.close();
});

const OR_DETAILS = { input_tokens_details: { audio_tokens: 0, cache_write_tokens: 1, cached_tokens: 2, file_tokens: 3, video_tokens: 4 },
  output_tokens_details: { audio_tokens: 0, image_tokens: 30, reasoning_tokens: 4 } };

test("OpenRouter token details are persisted with their documented keys; the OpenAI allowlist is unchanged", async (t) => {
  const { store } = await createStore(t);
  let id = 0;
  const ports = createCreativeVersionApiPorts({ store, idFactory: () => `or-store-details-${++id}` });
  const ok = await dispatchRow(store, ports, "or-details");
  const usage = { ...USAGE, transport_attempt_id: ok.transport_attempt_id, ...OR_DETAILS,
    missing_fields: ["usage.profile_mapping_pending", "usage.unmapped.service_tier"] };
  assert.equal(store.recordPrivateProviderUsageAttribution(usageInput(ok, "openrouter", MODEL, usage)).status, "recorded");
  const stored = JSON.parse(store.db.prepare("SELECT usage_json FROM private_provider_usage_attributions WHERE transport_attempt_id=?")
    .get(ok.transport_attempt_id).usage_json);
  assert.deepEqual(stored.input_tokens_details, OR_DETAILS.input_tokens_details);
  assert.deepEqual(stored.output_tokens_details, OR_DETAILS.output_tokens_details);
  const bad = [
    { input_tokens_details: { text_tokens: 1 } },
    { output_tokens_details: { cached_tokens: 1 } },
    { input_tokens_details: { cached_tokens: -1 } },
    { output_tokens_details: { image_tokens: 1.5 } },
    { input_tokens_details: [1] },
    { prompt_tokens_details: { cached_tokens: 1 } },
  ];
  for (const [index, extra] of bad.entries()) {
    const row = await dispatchRow(store, ports, `or-bad-details-${index}`);
    assert.throws(() => store.recordPrivateProviderUsageAttribution(usageInput(row, "openrouter", MODEL,
      { ...USAGE, transport_attempt_id: row.transport_attempt_id, ...extra })), /supported local contract/i, JSON.stringify(extra));
  }
  // Direct OpenAI keeps exactly text_tokens/image_tokens and none of the OpenRouter keys or fields.
  const model = "gpt-image-2.5-sunburst-2026-09-08";
  const direct = await dispatchRow(store, ports, "openai-details", "openai", model);
  const openaiBase = { ...USAGE, transport_attempt_id: direct.transport_attempt_id };
  for (const extra of [OR_DETAILS, { input_tokens_details: { cached_tokens: 1 } }, { output_tokens_details: { reasoning_tokens: 1 } }]) {
    assert.throws(() => store.recordPrivateProviderUsageAttribution(usageInput(direct, "openai", model, { ...openaiBase, ...extra })),
      /supported local contract/i, JSON.stringify(extra));
  }
  assert.equal(store.recordPrivateProviderUsageAttribution(usageInput(direct, "openai", model, { ...openaiBase,
    input_tokens_details: { text_tokens: 1, image_tokens: 2 }, output_tokens_details: { image_tokens: 3 } })).status, "recorded");
});

test("staged pending attribution accepts the OpenRouter cost and detail shapes only for openrouter", async (t) => {
  const { store } = await createStore(t);
  let id = 0;
  const ports = createCreativeVersionApiPorts({ store, idFactory: () => `or-store-pending-${++id}` });
  const stage = (row, provider, model, usage) => store.stagePrivateProviderAttribution({ scope: DEFAULT_SCOPE, actor_id: "actor-1",
    job_id: row.job_id, action_id: row.action_id, request_hash: row.request_hash, operation: "generate", provider, model,
    reservation_ref: row.reservation_ref, billable_attempt_id: row.billable_attempt_id, transport_attempt_id: row.transport_attempt_id,
    dispatch_intent_ref: row.dispatch_intent_ref, target_binding_sha256: `sha256:${"a".repeat(64)}`, usage });
  const row = await dispatchRow(store, ports, "or-pending");
  const full = { ...USAGE, transport_attempt_id: row.transport_attempt_id, ...OR_DETAILS,
    cost: { amount: "0.04", currency: "USD", provenance: "provider_reported_unsettled" },
    cost_details: { upstream_inference_cost: "0.035" }, is_byok: false };
  assert.equal(stage(row, "openrouter", MODEL, full).status, "staged");
  const bad = await dispatchRow(store, ports, "or-pending-bad");
  assert.throws(() => stage(bad, "openrouter", MODEL, { ...full, transport_attempt_id: bad.transport_attempt_id,
    cost: { amount: "0.04", currency: "USD", provenance: "settled" } }), /supported local contract/i);
  assert.throws(() => stage(bad, "openrouter", MODEL, { ...full, transport_attempt_id: bad.transport_attempt_id,
    input_tokens_details: { text_tokens: 1 } }), /supported local contract/i);
  const model = "gpt-image-2.5-sunburst-2026-09-08";
  const direct = await dispatchRow(store, ports, "or-pending-openai", "openai", model);
  assert.throws(() => stage(direct, "openai", model, { ...full, transport_attempt_id: direct.transport_attempt_id }),
    /supported local contract/i, "the direct OpenAI pending allowlist is unchanged");
});

test("a busy database during the first migration BEGIN IMMEDIATE is a retryable unavailable error and leaks no connection", async (t) => {
  const { store: original } = await createStore(t);
  const { databasePath, objectRoot } = original;
  original.close();
  const holder = new DatabaseSync(databasePath);
  holder.exec("BEGIN IMMEDIATE");
  let caught;
  const started = Date.now();
  try { new CreativeVersionStore({ databasePath, objectRoot }); } catch (error) { caught = error; }
  assert.ok(Date.now() - started >= 1000, "the store waited on the busy timeout before giving up");
  assert.equal(caught?.code, "unavailable");
  assert.equal(caught?.field, "storage_version");
  assert.equal(caught?.retryable, true);
  assert.ok(!String(caught?.message).includes(databasePath));
  holder.exec("COMMIT");
  holder.close();
  // The failed opener closed its connection: the lock is free and a retry succeeds on the same files.
  const retried = new CreativeVersionStore({ databasePath, objectRoot });
  assert.equal(retried.db.prepare("PRAGMA user_version").get().user_version, 13);
  retried.close();
});
