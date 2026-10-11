import assert from "node:assert/strict";
import test from "node:test";
import { canonicalHash } from "../../src/contracts/index.mjs";
import { CreativeVersionStore } from "../../src/versions/store.mjs";
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

test("a database with the legacy openai-only CHECK is widened in place without losing rows, triggers, or keys", async (t) => {
  const { store: original } = await createStore(t);
  let id = 0;
  const makePorts = (store) => createCreativeVersionApiPorts({ store, idFactory: () => `or-widen-port-${++id}` });
  const legacy = await dispatchRow(original, makePorts(original), "legacy-row", "openai", "gpt-image-2.5-sunburst-2026-09-08");
  original.recordPrivateProviderUsageAttribution(usageInput(legacy, "openai", "gpt-image-2.5-sunburst-2026-09-08",
    { ...USAGE, transport_attempt_id: legacy.transport_attempt_id }));
  // Recreate the tables exactly as an earlier build did.
  const sql = (name) => original.db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(name).sql;
  const widened = "CHECK(provider_name IN ('openai','openrouter'))";
  assert.ok(sql("private_provider_usage_attributions").includes(widened), "fresh databases use the allowlist");
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    const current = sql(table);
    original.db.exec(`ALTER TABLE ${table} RENAME TO ${table}_tmp`);
    original.db.exec(current.replace(widened, "CHECK(provider_name='openai')"));
    original.db.exec(`INSERT INTO ${table} SELECT * FROM ${table}_tmp`);
    original.db.exec(`DROP TABLE ${table}_tmp`);
  }
  original.db.exec(`CREATE TRIGGER private_provider_usage_attributions_no_update
      BEFORE UPDATE ON private_provider_usage_attributions BEGIN SELECT RAISE(ABORT,'private provider usage attribution is immutable'); END;
    CREATE TRIGGER private_provider_usage_attributions_no_delete
      BEFORE DELETE ON private_provider_usage_attributions BEGIN SELECT RAISE(ABORT,'private provider usage attribution is immutable'); END;`);
  assert.ok(sql("private_provider_usage_attributions").includes("CHECK(provider_name='openai')"));
  assert.throws(() => original.db.prepare("UPDATE private_provider_usage_attributions SET provider_model='x'").run(), /immutable/);
  const before = { ...original.db.prepare("SELECT * FROM private_provider_usage_attributions").get() };
  const { databasePath, objectRoot } = original;
  original.close();

  const migrated = new CreativeVersionStore({ databasePath, objectRoot, now: () => Date.parse("2026-10-11T12:00:00.000Z") });
  t.after(() => migrated.close());
  assert.equal(migrated.db.prepare("PRAGMA user_version").get().user_version, 10, "the storage major is unchanged");
  assert.deepEqual({ ...migrated.db.prepare("SELECT * FROM private_provider_usage_attributions").get() }, before);
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    const rebuilt = migrated.db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(table).sql;
    assert.ok(rebuilt.includes(widened) && !rebuilt.includes("CHECK(provider_name='openai')"), table);
  }
  assert.throws(() => migrated.db.prepare("UPDATE private_provider_usage_attributions SET provider_model='x'").run(), /immutable/);
  assert.throws(() => migrated.db.prepare("DELETE FROM private_provider_usage_attributions").run(), /immutable/);
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
  assert.equal(reopened.db.prepare("SELECT COUNT(*) AS n FROM private_provider_usage_attributions").get().n, 2,
    "reopening is idempotent and keeps both rows");
});
