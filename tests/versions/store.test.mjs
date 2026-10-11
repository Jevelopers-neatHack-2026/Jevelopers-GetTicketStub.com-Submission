import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { fork, spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canonicalHash, canonicalSerialize, computeDesignVersionHash } from "../../src/contracts/index.mjs";
import { hashArtifactBytes, readContentAddressedObject, writeContentAddressedObject } from "../../src/storage/content-addressed.mjs";
import { CreativeVersionStore, VersionStoreError } from "../../src/versions/store.mjs";
import { createBrief, createStore, createWrite, DEFAULT_SCOPE } from "./helpers.mjs";
import * as publicVersions from "creative-engine/versions";

const CRASH_WORKER = new URL("../../fixtures/versions/crash-worker.mjs", import.meta.url);
const SELECTION_WORKER = new URL("../../fixtures/versions/selection-worker.mjs", import.meta.url);

function expectStoreError(code, operation) {
  assert.throws(operation, (error) => {
    assert.equal(error instanceof VersionStoreError, true, error?.constructor?.name);
    assert.equal(error.code, code);
    assert.equal(typeof error.message, "string");
    assert.equal(error.message.length < 160, true);
    assert.equal(error.message.includes("SYNTHETIC"), false);
    return true;
  });
}

test("versions public entrypoint exposes the runtime constructors and paired adapter", () => {
  assert.equal(typeof publicVersions.CreativeVersionStore, "function");
  assert.equal(typeof publicVersions.VersionStoreError, "function");
  assert.equal(typeof publicVersions.createCreativeVersionApiPorts, "function");
});

test("concept response staging snapshots bytes and metadata before async inspection and never rolls back a borrowed transaction", async (t) => {
  const { store } = await createStore(t);
  const ports = publicVersions.createCreativeVersionApiPorts({ store, idFactory: (() => {
    let index = 0;
    return () => `concept-worker-${++index}`;
  })() });
  store.putBrief({ scope: { tenant_id: DEFAULT_SCOPE.tenant_id, project_id: DEFAULT_SCOPE.project_id }, brief: createBrief() });
  const request_hash = canonicalHash({ action_id: "concept-action", payload: "two references" });
  const started = await ports.jobs.begin({ scope: DEFAULT_SCOPE, actor_id: "actor-1", action_id: "concept-action",
    request_hash, operation: "concepts.create" });
  const batch = { contract: "CreativeConceptBatchProposal", schema_version: "0.1.0",
    acceptance_status: "unaccepted_local_proposal", tenant_id: DEFAULT_SCOPE.tenant_id,
    project_id: DEFAULT_SCOPE.project_id, brief_id: DEFAULT_SCOPE.brief_id, action_id: "concept-action",
    batch_id: "concept-batch", slots: [{ concept_id: "concept-slot-1" }] };
  store.beginConceptBatch({ scope: DEFAULT_SCOPE, actor_id: "actor-1", action_id: "concept-action",
    job_id: started.job_id, lease_token: started.lease_token, request_hash, batch });
  store.db.prepare(`INSERT INTO creative_dispatch_intents
    (tenant_id,project_id,job_id,transport_attempt_id,billable_attempt_id,reservation_ref,provider_name,provider_model,
      dispatch_intent_ref,context_fence_json,authorized_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
    .run(DEFAULT_SCOPE.tenant_id, DEFAULT_SCOPE.project_id, started.job_id, "transport-1", "billable-1",
      "reservation-1", "openai", "model-pinned", "dispatch-1", "{}", new Date(store.now()).toISOString());
  const target_binding = {
    service: "openai",
    endpoint: "https://api.openai.com/v1/images/edits",
    model: "model-pinned",
    sdk_name: "native-fetch",
    sdk_version: "v24.15.0",
    configuration_sha256: `sha256:${"b".repeat(64)}`,
    operation: "edit",
    operation_kind: "image_edit",
    input_sha256: `sha256:${"c".repeat(64)}`,
    prompt_sha256: `sha256:${"d".repeat(64)}`,
    plan_sha256: `sha256:${"e".repeat(64)}`,
    image_reference_manifest_sha256: `sha256:${"f".repeat(64)}`,
    deadline_at: "2026-10-10T12:30:20.000Z",
    transport_policy: { maximum_transport_attempts: 1, automatic_retry: false,
      stop_on: ["cancelled", "deadline", "revoked", "lease_expired", "capability_expired"] },
    tenant_id: DEFAULT_SCOPE.tenant_id,
    project_id: DEFAULT_SCOPE.project_id,
    budget_scope_id: "budget-scope-1",
    billable_attempt_id: "billable-1",
  };
  const target_binding_sha256 = `sha256:${createHash("sha256").update(JSON.stringify(target_binding), "utf8").digest("hex")}`;
  store.recordConceptDispatchBinding({ scope: DEFAULT_SCOPE, actor_id: "actor-1", job_id: started.job_id,
    action_id: "concept-action", request_hash, lease_token: started.lease_token, billable_attempt_id: "billable-1",
    transport_attempt_id: "transport-1", reservation_ref: "reservation-1", dispatch_intent_ref: "dispatch-1",
    target_binding, target_binding_sha256, rendered_prompt_sha256: target_binding.prompt_sha256 });

  const fixture = new Uint8Array(await readFile(new URL("../../fixtures/models/valid-16x16.jpg", import.meta.url)));
  const original = Uint8Array.from(fixture);
  const input = { scope: DEFAULT_SCOPE, action_id: "concept-action", job_id: started.job_id,
    actor_id: "actor-1", request_hash, lease_token: started.lease_token, concept_id: "concept-slot-1",
    billable_attempt_id: "billable-1", transport_attempt_id: "transport-1", reservation_ref: "reservation-1",
    dispatch_intent_ref: "dispatch-1", target_binding_sha256, bytes: fixture,
    content_hash: hashArtifactBytes(original), media_type: "image/jpeg", width: 16, height: 16 };
  const pending = store.stageConceptResponse(input);
  fixture.fill(0);
  input.content_hash = hashArtifactBytes(fixture);
  input.media_type = "image/png";
  input.width = 1;
  input.height = 1;
  input.target_binding_sha256 = `sha256:${"b".repeat(64)}`;
  const staged = await pending;
  assert.equal(staged.status, "staged");
  const recovered = store.getConceptResponseStage({ scope: DEFAULT_SCOPE, action_id: "concept-action", concept_id: "concept-slot-1" });
  assert.equal(recovered.content_hash, hashArtifactBytes(original));
  assert.equal(recovered.media_type, "image/jpeg");
  assert.deepEqual([recovered.width, recovered.height], [16, 16]);
  assert.equal(recovered.target_binding_sha256, target_binding_sha256);
  assert.deepEqual(recovered.response_bytes, original);

  store.db.exec("BEGIN IMMEDIATE");
  store.db.exec(`CREATE TABLE borrowed_transaction_sentinels (
    id TEXT PRIMARY KEY, value TEXT NOT NULL
  ) STRICT`);
  store.db.prepare("INSERT INTO borrowed_transaction_sentinels VALUES(?,?)").run("outer", "caller-owned");
  store.db.exec("SAVEPOINT borrowed_concept_stage");
  store.db.prepare("INSERT INTO borrowed_transaction_sentinels VALUES(?,?)").run("savepoint", "caller-savepoint");
  await assert.rejects(store.stageConceptResponse({ ...input, bytes: original,
    content_hash: hashArtifactBytes(original), media_type: "image/jpeg", width: 16, height: 16,
    target_binding_sha256 }), (error) => error instanceof VersionStoreError && error.code === "unavailable");
  expectStoreError("unavailable", () => store.appendConceptEvent({ scope: DEFAULT_SCOPE,
    action_id: "concept-action", job_id: started.job_id, actor_id: "actor-1", request_hash,
    lease_token: started.lease_token, event: { event_type: "provider_outcome" } }));
  assert.equal(store.db.isTransaction, true, "a rejected call must leave the caller transaction open");
  assert.deepEqual(store.db.prepare("SELECT id,value FROM borrowed_transaction_sentinels ORDER BY id").all()
    .map((row) => ({ ...row })), [
    { id: "outer", value: "caller-owned" },
    { id: "savepoint", value: "caller-savepoint" },
  ], "the rejected call must preserve rows owned by both the outer transaction and active savepoint");
  store.db.exec("ROLLBACK TO borrowed_concept_stage");
  store.db.exec("RELEASE borrowed_concept_stage");
  assert.deepEqual(store.db.prepare("SELECT id,value FROM borrowed_transaction_sentinels").all()
    .map((row) => ({ ...row })), [
    { id: "outer", value: "caller-owned" },
  ], "rolling back the caller savepoint must remove only its own sentinel");
  store.db.exec("ROLLBACK");
});

async function expectStoreReject(code, operation) {
  await assert.rejects(operation, (error) => {
    assert.equal(error instanceof VersionStoreError, true, error?.constructor?.name);
    assert.equal(error.code, code);
    assert.equal(error.message.length < 160, true);
    return true;
  });
}

test("durable root version preserves exact bytes, context, additive fields, and stable action replay across restart", async (t) => {
  let now = Date.parse("2026-10-10T12:30:00.000Z");
  const { root, store } = await createStore(t, { now: () => now });
  const input = createWrite({ id: "version-A", extra: { vendor_id: 42, render_ref: { revision: 2 }, optional_ref: null } });
  const saved = await store.saveDesignVersion(input);
  assert.equal(saved.status, "saved");
  assert.equal(saved.replayed, false);
  assert.equal(saved.design_version.design_hash, input.design_version.design_hash);
  assert.deepEqual(store.getSelection({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id }), {
    tenant_id: DEFAULT_SCOPE.tenant_id,
    project_id: DEFAULT_SCOPE.project_id,
    brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: "version-A",
    design_hash: input.design_version.design_hash,
    revision: 1,
  });
  assert.deepEqual(await store.getArtifactBytes({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: "version-A" }), input.artifact_bytes);
  const evidence = store.db.prepare("SELECT evidence_json,context_json FROM version_evidence WHERE design_version_id=?")
    .get("version-A");
  const decodedEvidence = JSON.parse(evidence.evidence_json);
  const decodedContext = JSON.parse(evidence.context_json);
  assert.equal(decodedEvidence.creation.logical_operation_id, "logical-version-A");
  assert.equal(decodedEvidence.creation.billable_attempt_id, "billable-version-A");
  assert.deepEqual(decodedEvidence.creation.transport_attempt_ids, ["transport-version-A"]);
  assert.deepEqual(decodedEvidence.creation.provider_request_ids, ["provider-version-A"]);
  assert.deepEqual(decodedEvidence.usage_refs, ["usage-version-A"]);
  assert.deepEqual(decodedEvidence.trace_refs, ["trace-version-A"]);
  assert.equal(decodedContext.brief_hash, input.design_version.brief_hash);
  assert.equal(decodedContext.permission_hash.length, 71);
  assert.equal(decodedContext.lock_hash.length, 71);
  assert.equal(decodedContext.source_identity_hash.length, 71);

  now += 7 * 24 * 60 * 60 * 1000;
  const replay = await store.saveDesignVersion(input);
  assert.equal(replay.status, "saved");
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.design_version.artifact, input.design_version.artifact);
  assert.equal(replay.design_version.vendor_id, input.design_version.vendor_id);
  assert.deepEqual(replay.design_version.render_ref, input.design_version.render_ref);
  assert.deepEqual(replay.design_version.optional_ref, input.design_version.optional_ref);
  assert.equal(store.listDesignVersions({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id, limit: 10 }).items.length, 1);

  store.close();
  const reopened = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => now });
  const recovery = await reopened.recover();
  assert.deepEqual(recovery, { examined: 0, committed: 0, conflicts: 0, unknown: 0 });
  const restored = reopened.getDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: "version-A" });
  assert.equal(restored.design_hash, input.design_version.design_hash);
  assert.equal(restored.vendor_id, 42);
  assert.deepEqual(restored.render_ref, { revision: 2 });
  assert.equal(restored.optional_ref, null);
  assert.deepEqual(await reopened.getArtifactBytes({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: "version-A" }), input.artifact_bytes);
  const replayAfterRestart = await reopened.saveDesignVersion(input);
  assert.equal(replayAfterRestart.replayed, true);
  reopened.close();
});

test("explicit branches retain A/B/C and restore changes only the selected pointer with CAS", async (t) => {
  const { store } = await createStore(t);
  store.putBrief({ scope: { tenant_id: DEFAULT_SCOPE.tenant_id, project_id: DEFAULT_SCOPE.project_id },
    brief: createBrief() });
  const aInput = createWrite({ id: "A" });
  const a = await store.saveDesignVersion(aInput);
  const bInput = createWrite({ id: "B", parent: a.design_version,
    selection: { mode: "branch" }, occurred_at: "2026-10-10T12:11:00.000Z" });
  const cInput = createWrite({ id: "C", parent: a.design_version,
    selection: { mode: "branch" }, occurred_at: "2026-10-10T12:12:00.000Z" });
  const [b, c] = await Promise.all([store.saveDesignVersion(bInput), store.saveDesignVersion(cInput)]);
  assert.equal(b.status, "saved");
  assert.equal(c.status, "saved");
  assert.equal(b.selection, null);
  assert.equal(c.selection, null);
  assert.equal(store.listDesignVersions({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id, limit: 10 }).items.length, 3);
  assert.equal(store.getSelection({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id }).design_version_id, "A");
  assert.equal(b.design_version.parent_version_id, "A");
  assert.equal(c.design_version.parent_version_id, "A");
  assert.notEqual(a.design_version.artifact.content_hash, b.design_version.artifact.content_hash);
  assert.notEqual(b.design_version.artifact.content_hash, c.design_version.artifact.content_hash);

  const selectB = await store.selectDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: "B", expected_brief_hash: a.design_version.brief_hash,
    expected_target_design_hash: b.design_version.design_hash,
    expected_selected_design_version_id: "A", expected_selected_design_hash: a.design_version.design_hash,
    expected_selection_revision: 1 });
  assert.equal(selectB.status, "selected");
  assert.equal(selectB.selection.revision, 2);
  const restoreA = await store.selectDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: "A", expected_brief_hash: a.design_version.brief_hash,
    expected_target_design_hash: a.design_version.design_hash,
    expected_selected_design_version_id: "B", expected_selected_design_hash: b.design_version.design_hash,
    expected_selection_revision: 2 });
  assert.equal(restoreA.status, "selected");
  assert.equal(restoreA.selection.design_version_id, "A");
  assert.equal(restoreA.selection.revision, 3);
  assert.equal(store.listDesignVersions({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id, limit: 10 }).items.length, 3);
  assert.deepEqual(await store.getArtifactBytes({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: "A" }), aInput.artifact_bytes);
  assert.equal(store.getCurrentDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id }).design_hash,
    a.design_version.design_hash);

  const [left, right] = await Promise.all([
    store.selectDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
      design_version_id: "B", expected_brief_hash: a.design_version.brief_hash,
      expected_target_design_hash: b.design_version.design_hash,
      expected_selected_design_version_id: "A", expected_selected_design_hash: a.design_version.design_hash,
      expected_selection_revision: 3 }),
    store.selectDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
      design_version_id: "C", expected_brief_hash: a.design_version.brief_hash,
      expected_target_design_hash: c.design_version.design_hash,
      expected_selected_design_version_id: "A", expected_selected_design_hash: a.design_version.design_hash,
      expected_selection_revision: 3 }),
  ]);
  assert.deepEqual([left.status, right.status].sort(), ["selected", "stale"]);
  const current = store.getSelection({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id });
  assert.ok(["B", "C"].includes(current.design_version_id));
  assert.equal(current.revision, 4);
});

test("standalone restore rechecks the current brief inside selection CAS after artifact IO", async (t) => {
  const { store } = await createStore(t);
  const originalBrief = createBrief();
  store.putBrief({ scope: { tenant_id: DEFAULT_SCOPE.tenant_id, project_id: DEFAULT_SCOPE.project_id }, brief: originalBrief });
  const originalBriefHash = canonicalHash(originalBrief);
  const a = await store.saveDesignVersion(createWrite({ id: "restore-fence-A" }));
  const b = await store.saveDesignVersion(createWrite({ id: "restore-fence-B", parent: a.design_version,
    selection: { mode: "branch" } }));
  const selectedB = await store.selectDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: b.design_version.design_version_id, expected_brief_hash: originalBriefHash,
    expected_target_design_hash: b.design_version.design_hash,
    expected_selected_design_version_id: a.design_version.design_version_id,
    expected_selected_design_hash: a.design_version.design_hash, expected_selection_revision: 1 });
  assert.equal(selectedB.status, "selected");

  let entered;
  const readStarted = new Promise((resolve) => { entered = resolve; });
  let release;
  const readGate = new Promise((resolve) => { release = resolve; });
  const readBytes = store.getArtifactBytes.bind(store);
  store.getArtifactBytes = async (input) => {
    const bytes = await readBytes(input);
    entered();
    await readGate;
    return bytes;
  };
  const restoring = store.selectDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: a.design_version.design_version_id, expected_brief_hash: originalBriefHash,
    expected_target_design_hash: a.design_version.design_hash,
    expected_selected_design_version_id: b.design_version.design_version_id,
    expected_selected_design_hash: b.design_version.design_hash, expected_selection_revision: 2 });
  await readStarted;
  const updatedBrief = structuredClone(originalBrief);
  updatedBrief.facts.verified[0].value = "2027-05-19";
  assert.equal(store.putBrief({ scope: { tenant_id: DEFAULT_SCOPE.tenant_id, project_id: DEFAULT_SCOPE.project_id },
    brief: updatedBrief, expected_brief_hash: originalBriefHash }).status, "saved");
  release();

  assert.deepEqual(await restoring, { status: "stale" });
  assert.deepEqual(store.getSelection({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id }), {
    tenant_id: DEFAULT_SCOPE.tenant_id, project_id: DEFAULT_SCOPE.project_id, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: b.design_version.design_version_id, design_hash: b.design_version.design_hash, revision: 2,
  });
  assert.equal(store.listDesignVersions({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id, limit: 10 }).items.length, 2);
});

test("commit-intent integrity binds canonical payload and every row identity before finalize or recovery", async (t) => {
  const { store } = await createStore(t);
  const cases = ["nested_attempt_identity", "row_actor", "row_job", "row_request", "row_brief"];
  for (const kind of cases) {
    const actionId = `intent-integrity-${kind}`;
    const input = createWrite({ id: actionId, action_id: actionId, job_id: `job-${actionId}` });
    const prepared = await store.prepareDesignVersion(input);
    assert.equal(prepared.status, "prepared");
    const action = store.db.prepare(`SELECT * FROM creation_actions WHERE action_id=?`).get(actionId);
    if (kind === "nested_attempt_identity") {
      const intent = JSON.parse(action.intent_json);
      intent.evidence.creation.billable_attempt_id = "billable-substituted";
      intent.evidence.attempt_identities.billable_attempt_id = "billable-substituted";
      store.db.prepare("UPDATE creation_actions SET intent_json=? WHERE action_id=?")
        .run(canonicalSerialize(intent), actionId);
    } else if (kind === "row_actor") {
      store.db.prepare("UPDATE creation_actions SET actor_id=? WHERE action_id=?").run("actor-substituted", actionId);
    } else if (kind === "row_job") {
      store.db.prepare("UPDATE creation_actions SET job_id=? WHERE action_id=?").run("job-substituted", actionId);
    } else if (kind === "row_request") {
      store.db.prepare("UPDATE creation_actions SET request_hash=? WHERE action_id=?")
        .run(canonicalHash({ substituted: kind }), actionId);
    } else {
      store.db.prepare("UPDATE creation_actions SET brief_id=? WHERE action_id=?").run("brief-substituted", actionId);
    }

    await expectStoreReject("integrity_error", () => store.finalizeAction(DEFAULT_SCOPE, actionId));
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions WHERE action_id=?").get(actionId).count, 0);
    assert.equal(store.getSelection({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id }), null);
    const recovery = await store.recover();
    assert.equal(recovery.unknown, 1, kind);
    assert.equal(store.db.prepare("SELECT state FROM creation_actions WHERE action_id=?").get(actionId).state, "unknown");
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions WHERE action_id=?").get(actionId).count, 0);
  }
});

test("separate processes race selection CAS and exactly one branch wins", async (t) => {
  const { root, store } = await createStore(t);
  store.putBrief({ scope: { tenant_id: DEFAULT_SCOPE.tenant_id, project_id: DEFAULT_SCOPE.project_id },
    brief: createBrief() });
  const a = await store.saveDesignVersion(createWrite({ id: "process-A" }));
  const b = await store.saveDesignVersion(createWrite({ id: "process-B", parent: a.design_version,
    selection: { mode: "branch" } }));
  const c = await store.saveDesignVersion(createWrite({ id: "process-C", parent: a.design_version,
    selection: { mode: "branch" } }));
  const selectionFor = (version) => ({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
    design_version_id: version.design_version.design_version_id,
    expected_brief_hash: a.design_version.brief_hash,
    expected_target_design_hash: version.design_version.design_hash,
    expected_selected_design_version_id: "process-A", expected_selected_design_hash: a.design_version.design_hash,
    expected_selection_revision: 1 });
  const children = [b, c].map((version) => fork(SELECTION_WORKER.pathname, [], { stdio: ["ignore", "ignore", "inherit", "ipc"],
    serialization: "json", env: { ...process.env,
      CREATIVE_VERSION_SELECTION_INPUT: JSON.stringify({ databasePath: join(root, "versions.sqlite"),
        objectRoot: join(root, "objects"), selection: selectionFor(version) }) } }));
  t.after(() => { for (const child of children) if (child.connected) child.kill(); });
  const workers = children.map((child) => {
    let readyResolve;
    let resultResolve;
    let resultReject;
    const ready = new Promise((resolve) => { readyResolve = resolve; });
    const result = new Promise((resolve, reject) => { resultResolve = resolve; resultReject = reject; });
    child.on("message", (message) => {
      if (message?.type === "ready") readyResolve();
      else if (message?.type === "result") resultResolve(message.result);
      else if (message?.type === "error") resultReject(new Error(`selection worker: ${message.code}`));
    });
    child.once("error", resultReject);
    child.once("exit", (code) => { if (code !== 0) resultReject(new Error(`selection worker exited ${code}`)); });
    return { child, ready, result };
  });
  await Promise.all(workers.map((worker) => worker.ready));
  for (const worker of workers) worker.child.send({ type: "start" });
  const outcomes = await Promise.all(workers.map((worker) => worker.result));
  assert.deepEqual(outcomes.map((outcome) => outcome.status).sort(), ["selected", "stale"]);
  const selection = store.getSelection({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id });
  assert.ok(["process-B", "process-C"].includes(selection.design_version_id));
  assert.equal(selection.revision, 2);
  assert.equal(store.listDesignVersions({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id, limit: 10 }).items.length, 3);
});

test("implicit stale bases conflict, same action is idempotent, and tenant scope prevents cross-read", async (t) => {
  const { store } = await createStore(t);
  const a = await store.saveDesignVersion(createWrite({ id: "implicit-A" }));
  const b = await store.saveDesignVersion(createWrite({ id: "implicit-B", parent: a.design_version }));
  const staleInput = createWrite({ id: "implicit-C", parent: a.design_version });
  const stale = await store.saveDesignVersion(staleInput);
  assert.equal(stale.status, "stale");
  assert.equal(stale.code, "stale_version");
  assert.equal((await store.saveDesignVersion(staleInput)).replayed, true);
  assert.equal(store.getSelection({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id }).design_version_id, "implicit-B");
  assert.deepEqual(store.listDesignVersions({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id, limit: 10 }).items
    .map((item) => item.design_version_id).sort(), ["implicit-A", "implicit-B"]);

  const actionScope = { tenant_id: "tenant-1", project_id: "project-1", brief_id: "brief-idempotency" };
  const base = createWrite({ scope: actionScope, id: "shared-id", action_id: "tenant-local-action", job_id: "job-tenant-1" });
  const first = await store.saveDesignVersion(base);
  const replay = await store.saveDesignVersion(base);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  const changed = structuredClone(base);
  changed.design_version.vendor_id = 42;
  changed.design_version.design_hash = computeDesignVersionHash(changed.design_version);
  await expectStoreReject("conflict", () => store.saveDesignVersion(changed));

  const otherScope = { tenant_id: "tenant-2", project_id: "project-2", brief_id: "brief-2" };
  const other = await store.saveDesignVersion(createWrite({ scope: otherScope, id: "tenant2-only",
    action_id: "tenant-local-action", job_id: "job-tenant-2", bytes: Buffer.from("different tenant bytes") }));
  assert.equal(other.status, "saved");
  assert.equal(store.getDesignVersion({ scope: actionScope, brief_id: actionScope.brief_id,
    design_version_id: "tenant2-only" }), null);
  assert.equal(await store.getArtifactBytes({ scope: actionScope, brief_id: actionScope.brief_id,
    design_version_id: "tenant2-only" }), null);
  expectStoreError("not_found", () => store.compareDesignVersions({ scope: actionScope,
    brief_id: actionScope.brief_id, left_design_version_id: "shared-id", right_design_version_id: "tenant2-only" }));
  expectStoreError("invalid_request", () => store.getDesignVersion({ scope: actionScope,
    brief_id: actionScope.brief_id, design_version_id: "../tenant-2" }));

  const objectPath = join(store.objectRoot, "objects", "sha256",
    first.design_version.artifact.content_hash.slice(7, 9), first.design_version.artifact.content_hash.slice(7));
  await writeFile(objectPath, Buffer.from("tampered bytes"));
  expectStoreError("integrity_error", () => store.getDesignVersion({ scope: actionScope,
    brief_id: actionScope.brief_id, design_version_id: "shared-id" }));
  expectStoreError("integrity_error", () => store.listDesignVersions({ scope: actionScope,
    brief_id: actionScope.brief_id, limit: 10 }));
});

test("crash recovery reconciles actual process exits at each storage boundary without redispatch", async (t) => {
  const stages = ["after_object_write", "after_commit_intent", "after_metadata_write", "after_commit"];
  for (const [index, stage] of stages.entries()) {
    const root = await mkdtemp(join(tmpdir(), `creative-version-crash-${index}-`));
    try {
      const databasePath = join(root, "versions.sqlite");
      const objectRoot = join(root, "objects");
      const input = createWrite({ id: `crash-${index}` });
      const serialized = { ...input, artifact_bytes_base64: Buffer.from(input.artifact_bytes).toString("base64") };
      delete serialized.artifact_bytes;
      const child = spawnSync(process.execPath, [CRASH_WORKER.pathname], {
        env: { ...process.env, CREATIVE_VERSION_DATABASE: databasePath, CREATIVE_VERSION_OBJECTS: objectRoot,
          CREATIVE_VERSION_CRASH_AT: stage, CREATIVE_VERSION_WRITE_JSON: JSON.stringify(serialized) },
        encoding: "utf8",
        timeout: 15_000,
      });
      assert.equal(child.status, 86, `${stage}: ${child.stderr}`);

      const reopened = new CreativeVersionStore({ databasePath, objectRoot,
        now: () => Date.parse("2026-10-10T12:30:00.000Z") });
      const recovery = await reopened.recover();
      if (stage === "after_object_write") {
        assert.deepEqual(recovery, { examined: 0, committed: 0, conflicts: 0, unknown: 0 });
        assert.equal(reopened.listDesignVersions({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id, limit: 10 }).items.length, 0);
      } else if (stage === "after_commit") {
        assert.deepEqual(recovery, { examined: 0, committed: 0, conflicts: 0, unknown: 0 });
      } else {
        assert.deepEqual(recovery, { examined: 1, committed: 1, conflicts: 0, unknown: 0 });
      }
      if (stage !== "after_object_write") {
        const stored = reopened.getDesignVersion({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
          design_version_id: `crash-${index}` });
        assert.equal(stored.design_hash, input.design_version.design_hash);
        assert.deepEqual(await reopened.getArtifactBytes({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id,
          design_version_id: stored.design_version_id }), input.artifact_bytes);
        const replay = await reopened.saveDesignVersion(input);
        assert.equal(replay.replayed, true);
        assert.equal(reopened.listDesignVersions({ scope: DEFAULT_SCOPE, brief_id: DEFAULT_SCOPE.brief_id, limit: 10 }).items.length, 1);
      }
      reopened.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("storage schema rejects unknown majors and the import graph stays provider-independent", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-schema-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, "future.sqlite");
  const objectRoot = join(root, "objects");
  await mkdir(objectRoot, { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec("PRAGMA user_version=99");
  db.close();
  expectStoreError("unsupported_version", () => new CreativeVersionStore({ databasePath, objectRoot }));

  const rootFiles = [new URL("../../src/versions/index.mjs", import.meta.url),
    new URL("../../src/storage/content-addressed.mjs", import.meta.url)];
  const visited = new Set();
  const visiting = new Set();
  const visit = async (filename) => {
    const absolute = resolve(filename);
    if (visiting.has(absolute)) throw new Error(`cyclic import: ${absolute}`);
    if (visited.has(absolute)) return;
    visiting.add(absolute);
    const source = await readFile(absolute, "utf8");
    assert.doesNotMatch(source, /(?:from\s*|import\s*)["'][^"']*(?:provider|renderer|agent-harness|ledger|transport)[^"']*["']/i);
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?["']([^"']+)["']/g)) {
      if (match[1].startsWith(".")) await visit(resolve(dirname(absolute), match[1]));
    }
    visiting.delete(absolute);
    visited.add(absolute);
  };
  for (const entry of rootFiles) await visit(fileURLToPath(entry));
  const source = await readFile(new URL("../../src/versions/store.mjs", import.meta.url), "utf8");
  assert.match(source, /recover\(\)/);
  assert.match(source, /selectDesignVersion\(/);
  assert.ok(visited.size >= 5, "walks the complete local relative-import closure");
});

test("content-addressed storage snapshots caller bytes before its first await", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-object-snapshot-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = Buffer.from("immutable original bytes");
  const expectedHash = hashArtifactBytes(source);
  const pending = writeContentAddressedObject(root, source, expectedHash);
  source.fill(0x78);
  const saved = await pending;
  assert.equal(saved.content_hash, expectedHash);
  assert.deepEqual(Buffer.from(await readContentAddressedObject(root, expectedHash)),
    Buffer.from("immutable original bytes"));
});

test("storage schema v2 migrates additively through concepts and composition schema v13", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-v2-migration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, "versions.sqlite");
  const objectRoot = join(root, "objects");
  const db = new DatabaseSync(databasePath);
  db.exec(`CREATE TABLE creative_jobs (
    tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, job_id TEXT NOT NULL, brief_id TEXT,
    actor_id TEXT NOT NULL, action_id TEXT NOT NULL, operation TEXT NOT NULL, request_hash TEXT NOT NULL,
    status TEXT NOT NULL, lease_hash TEXT NOT NULL, lease_expires_at TEXT NOT NULL, result_json TEXT,
    error_json TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    PRIMARY KEY(tenant_id,project_id,job_id), UNIQUE(tenant_id,project_id,action_id)
  ) STRICT;
  INSERT INTO creative_jobs VALUES('tenant-test','creative-project-test','legacy-job','brief-test',
    'actor-legacy','action-legacy','generate','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'completed','lease-hash-legacy','2026-10-10T12:30:00.000Z',NULL,NULL,
    '2026-10-10T12:29:00.000Z','2026-10-10T12:30:00.000Z');
  PRAGMA user_version=2;`);
  db.close();
  const migrated = new CreativeVersionStore({ databasePath, objectRoot });
  assert.equal(migrated.db.prepare("PRAGMA user_version").get().user_version, 13);
  const preserved = { ...migrated.db.prepare(`SELECT job_id,brief_id,actor_id,action_id,operation,request_hash,status,
    lease_hash,lease_expires_at,result_json,error_json FROM creative_jobs WHERE job_id='legacy-job'`).get() };
  assert.deepEqual(preserved, {
    job_id: "legacy-job", brief_id: "brief-test", actor_id: "actor-legacy", action_id: "action-legacy",
    operation: "generate", request_hash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "completed", lease_hash: "lease-hash-legacy", lease_expires_at: "2026-10-10T12:30:00.000Z",
    result_json: null, error_json: null,
  }, "the original v2 public job row and identity must survive the additive migration");
  assert.ok(migrated.db.prepare("PRAGMA index_list(creative_jobs)").all().some((index) => index.unique === 1));
  assert.throws(() => migrated.db.prepare(`INSERT INTO creative_jobs
    (tenant_id,project_id,job_id,brief_id,actor_id,action_id,operation,request_hash,status,lease_hash,
     lease_expires_at,result_json,error_json,created_at,updated_at,attempt_evidence_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run("tenant-test", "creative-project-test", "legacy-duplicate",
      "brief-test", "actor-legacy", "action-legacy", "generate", "sha256:" + "b".repeat(64), "completed",
      "lease-hash-legacy", "2026-10-10T12:30:00.000Z", null, null,
      "2026-10-10T12:29:00.000Z", "2026-10-10T12:30:00.000Z", null),
    "the unique scoped action constraint must survive migration");
  assert.equal(migrated.db.prepare("PRAGMA table_info(creative_jobs)").all()
    .some((column) => column.name === "attempt_evidence_json"), true);
  const dispatchColumns = migrated.db.prepare("PRAGMA table_info(creative_dispatch_intents)").all();
  for (const name of ["reservation_ref", "provider_name", "provider_model", "target_binding_sha256",
    "target_binding_json", "rendered_prompt_sha256"]) {
    assert.ok(dispatchColumns.some((column) => column.name === name));
  }
  assert.ok(migrated.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='private_provider_attributions'").get());
  assert.ok(migrated.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='private_provider_attribution_pending'").get());
  assert.ok(migrated.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='private_provider_attribution_reconciliations'").get());
  assert.ok(migrated.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='creative_inspection_sessions_v1'").get());
  assert.ok(migrated.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='creative_inspection_stages_v1'").get());
  for (const table of ["creative_concept_batches_v1", "creative_concept_events_v1",
    "creative_concept_dispatch_bindings_v1", "creative_concept_response_stages_v1", "creative_concept_versions_v1"]) {
    assert.ok(migrated.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table));
  }
  assert.deepEqual(migrated.db.prepare("PRAGMA foreign_key_check").all(), []);
  migrated.close();
});

test("reconstructed v9 private attribution tables migrate through v13 with populated rows, CHECKs, triggers, and foreign keys", async (t) => {
  const { root, store: originalStore } = await createStore(t);
  const actor_id = "actor-v9-migration";
  let portId = 0;
  let migratedStore;
  const makePorts = (store) => publicVersions.createCreativeVersionApiPorts({ store,
    idFactory: () => `v9-migration-port-${++portId}` });
  const originalPorts = makePorts(originalStore);
  const makeJobAndDispatch = async (action_id, operation, transport_attempt_id) => {
    const request_hash = canonicalHash({ action_id, operation });
    const started = await originalPorts.jobs.begin({ scope: DEFAULT_SCOPE, actor_id, action_id, request_hash, operation });
    assert.equal(started.kind, "started");
    const dispatch_intent_ref = `dispatch:${action_id}`;
    originalStore.db.prepare(`INSERT INTO creative_dispatch_intents
      (tenant_id,project_id,job_id,transport_attempt_id,billable_attempt_id,reservation_ref,provider_name,provider_model,
       dispatch_intent_ref,context_fence_json,authorized_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(DEFAULT_SCOPE.tenant_id, DEFAULT_SCOPE.project_id, started.job_id, transport_attempt_id,
        `billable:${action_id}`, `reservation:${action_id}`, "openai", "gpt-image-2.5-migration",
        dispatch_intent_ref, "{}", "2026-10-10T12:30:00.000Z");
    return { action_id, request_hash, job_id: started.job_id, transport_attempt_id,
      billable_attempt_id: `billable:${action_id}`, reservation_ref: `reservation:${action_id}`, dispatch_intent_ref };
  };
  const providerRow = await makeJobAndDispatch("legacy-provider-action", "generate", "legacy-provider-transport");
  const usageRow = await makeJobAndDispatch("legacy-usage-action", "edit", "legacy-usage-transport");
  const pendingRow = await makeJobAndDispatch("legacy-pending-action", "edit", "legacy-pending-transport");

  // This fixture reconstructs the two legacy private attribution tables and user_version 9 on the current
  // non-composition store schema. It exercises the additive private-table rebuild and later composition
  // migrations without claiming a byte-for-byte historical v9 database.
  originalStore.db.exec(`DROP TABLE private_provider_attributions;
    DROP TABLE private_provider_usage_attributions;
    DROP TABLE creative_composition_action_leases_v1;
    DROP TABLE creative_composition_current_v1;
    DROP TABLE creative_composition_actions_v1;
    DROP TABLE creative_composition_revisions_v1;
    CREATE TABLE private_provider_attributions (
      tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, job_id TEXT NOT NULL, action_id TEXT NOT NULL,
      actor_id TEXT NOT NULL, request_hash TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('generate','edit')),
      provider_name TEXT NOT NULL CHECK(provider_name='openai'), provider_model TEXT NOT NULL,
      reservation_ref TEXT NOT NULL, billable_attempt_id TEXT NOT NULL, transport_attempt_id TEXT NOT NULL,
      dispatch_intent_ref TEXT NOT NULL, provider_request_id TEXT NOT NULL, provider_request_ref TEXT NOT NULL,
      captured_at TEXT NOT NULL, PRIMARY KEY(tenant_id,project_id,job_id,transport_attempt_id),
      UNIQUE(tenant_id,project_id,dispatch_intent_ref),
      FOREIGN KEY(tenant_id,project_id,job_id,transport_attempt_id)
        REFERENCES creative_dispatch_intents(tenant_id,project_id,job_id,transport_attempt_id)
    ) STRICT;
    CREATE TRIGGER private_provider_attributions_no_update BEFORE UPDATE ON private_provider_attributions
      BEGIN SELECT RAISE(ABORT,'private provider attribution is immutable'); END;
    CREATE TRIGGER private_provider_attributions_no_delete BEFORE DELETE ON private_provider_attributions
      BEGIN SELECT RAISE(ABORT,'private provider attribution is immutable'); END;
    CREATE TABLE private_provider_usage_attributions (
      tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, job_id TEXT NOT NULL, action_id TEXT NOT NULL,
      actor_id TEXT NOT NULL, request_hash TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('generate','edit')),
      provider_name TEXT NOT NULL CHECK(provider_name='openai'), provider_model TEXT NOT NULL,
      reservation_ref TEXT NOT NULL, billable_attempt_id TEXT NOT NULL, transport_attempt_id TEXT NOT NULL,
      dispatch_intent_ref TEXT NOT NULL, target_binding_sha256 TEXT NOT NULL, usage_sha256 TEXT NOT NULL,
      usage_json TEXT NOT NULL, captured_at TEXT NOT NULL,
      PRIMARY KEY(tenant_id,project_id,job_id,transport_attempt_id),
      UNIQUE(tenant_id,project_id,dispatch_intent_ref),
      FOREIGN KEY(tenant_id,project_id,job_id,transport_attempt_id)
        REFERENCES creative_dispatch_intents(tenant_id,project_id,job_id,transport_attempt_id)
    ) STRICT;
    CREATE TRIGGER private_provider_usage_attributions_no_update BEFORE UPDATE ON private_provider_usage_attributions
      BEGIN SELECT RAISE(ABORT,'private provider usage attribution is immutable'); END;
    CREATE TRIGGER private_provider_usage_attributions_no_delete BEFORE DELETE ON private_provider_usage_attributions
      BEGIN SELECT RAISE(ABORT,'private provider usage attribution is immutable'); END;
    PRAGMA user_version=9;`);
  originalStore.db.prepare(`INSERT INTO private_provider_attributions
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(DEFAULT_SCOPE.tenant_id, DEFAULT_SCOPE.project_id,
      providerRow.job_id, providerRow.action_id, actor_id, providerRow.request_hash, "generate", "openai",
      "gpt-image-2.5-migration", providerRow.reservation_ref, providerRow.billable_attempt_id,
      providerRow.transport_attempt_id, providerRow.dispatch_intent_ref, "private-provider-request-legacy",
      "provider-request:legacy", "2026-10-10T12:30:00.000Z");
  originalStore.db.prepare(`INSERT INTO private_provider_usage_attributions
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(DEFAULT_SCOPE.tenant_id, DEFAULT_SCOPE.project_id,
      usageRow.job_id, usageRow.action_id, actor_id, usageRow.request_hash, "edit", "openai",
      "gpt-image-2.5-migration", usageRow.reservation_ref, usageRow.billable_attempt_id,
      usageRow.transport_attempt_id, usageRow.dispatch_intent_ref, `sha256:${"a".repeat(64)}`,
      `sha256:${"b".repeat(64)}`, `{"input_tokens":3}`, "2026-10-10T12:31:00.000Z");
  originalStore.db.prepare(`INSERT INTO private_provider_attribution_pending
    (tenant_id,project_id,pending_ref,job_id,transport_attempt_id,payload_sha256,payload_json,created_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(DEFAULT_SCOPE.tenant_id, DEFAULT_SCOPE.project_id, "pending:legacy",
      pendingRow.job_id, pendingRow.transport_attempt_id, `sha256:${"c".repeat(64)}`, `{"legacy":true}`,
      "2026-10-10T12:32:00.000Z");
  originalStore.db.prepare(`INSERT INTO private_provider_attribution_reconciliations
    (tenant_id,project_id,pending_ref,payload_sha256,reconciled_at) VALUES(?,?,?,?,?)`)
    .run(DEFAULT_SCOPE.tenant_id, DEFAULT_SCOPE.project_id, "pending:legacy", `sha256:${"d".repeat(64)}`,
      "2026-10-10T12:33:00.000Z");
  assert.deepEqual(originalStore.db.prepare("PRAGMA foreign_key_check").all(), []);
  const expectedProvider = { ...originalStore.db.prepare(`SELECT * FROM private_provider_attributions`).get() };
  const expectedUsage = { ...originalStore.db.prepare(`SELECT * FROM private_provider_usage_attributions`).get() };
  const expectedPending = { ...originalStore.db.prepare(`SELECT * FROM private_provider_attribution_pending`).get() };
  const expectedReconciliation = { ...originalStore.db.prepare(`SELECT * FROM private_provider_attribution_reconciliations`).get() };
  const databasePath = originalStore.databasePath;
  const objectRoot = originalStore.objectRoot;
  originalStore.close();

  migratedStore = new CreativeVersionStore({ databasePath, objectRoot });
  t.after(() => migratedStore?.close());
  assert.equal(migratedStore.db.prepare("PRAGMA user_version").get().user_version, 13);
  assert.deepEqual({ ...migratedStore.db.prepare(`SELECT * FROM private_provider_attributions`).get() }, expectedProvider);
  assert.deepEqual({ ...migratedStore.db.prepare(`SELECT * FROM private_provider_usage_attributions`).get() }, expectedUsage);
  assert.deepEqual({ ...migratedStore.db.prepare(`SELECT * FROM private_provider_attribution_pending`).get() }, expectedPending);
  assert.deepEqual({ ...migratedStore.db.prepare(`SELECT * FROM private_provider_attribution_reconciliations`).get() }, expectedReconciliation);
  assert.deepEqual(migratedStore.db.prepare("PRAGMA foreign_key_check").all(), []);
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    assert.throws(() => migratedStore.db.prepare(`UPDATE ${table} SET provider_model='changed'`)
      .run(), /immutable/);
    assert.throws(() => migratedStore.db.prepare(`DELETE FROM ${table}`).run(), /immutable/);
  }
  assert.throws(() => migratedStore.db.prepare(`UPDATE private_provider_attribution_pending SET payload_sha256=?`)
    .run(`sha256:${"e".repeat(64)}`), /immutable/);
  assert.throws(() => migratedStore.db.prepare(`UPDATE private_provider_attribution_reconciliations SET payload_sha256=?`)
    .run(`sha256:${"f".repeat(64)}`), /immutable/);
  const makeMigratedJobAndDispatch = async (action_id, operation, transport_attempt_id) => {
    const request_hash = canonicalHash({ action_id, operation });
    const started = await makePorts(migratedStore).jobs.begin({ scope: DEFAULT_SCOPE, actor_id,
      action_id, request_hash, operation });
    assert.equal(started.kind, "started");
    const dispatch_intent_ref = `dispatch:${action_id}`;
    const billable_attempt_id = `billable:${action_id}`;
    const reservation_ref = `reservation:${action_id}`;
    migratedStore.db.prepare(`INSERT INTO creative_dispatch_intents
      (tenant_id,project_id,job_id,transport_attempt_id,billable_attempt_id,reservation_ref,provider_name,provider_model,
       dispatch_intent_ref,context_fence_json,authorized_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(DEFAULT_SCOPE.tenant_id, DEFAULT_SCOPE.project_id, started.job_id,
        transport_attempt_id, billable_attempt_id, reservation_ref, "openai", "gpt-image-2.5-migration",
        dispatch_intent_ref, "{}", "2026-10-10T12:35:00.000Z");
    return { action_id, request_hash, job_id: started.job_id, transport_attempt_id, billable_attempt_id,
      reservation_ref, dispatch_intent_ref };
  };
  const insertProviderAttribution = (row, operation) => migratedStore.db.prepare(`INSERT INTO private_provider_attributions
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(DEFAULT_SCOPE.tenant_id, DEFAULT_SCOPE.project_id,
      row.job_id, row.action_id, actor_id, row.request_hash, operation, "openai", "gpt-image-2.5-migration",
      row.reservation_ref, row.billable_attempt_id, row.transport_attempt_id, row.dispatch_intent_ref,
      `private-provider-request:${row.action_id}`, `provider-request:${row.action_id}`, "2026-10-10T12:35:00.000Z");
  const insertUsageAttribution = (row, operation) => migratedStore.db.prepare(`INSERT INTO private_provider_usage_attributions
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(DEFAULT_SCOPE.tenant_id, DEFAULT_SCOPE.project_id,
      row.job_id, row.action_id, actor_id, row.request_hash, operation, "openai", "gpt-image-2.5-migration",
      row.reservation_ref, row.billable_attempt_id, row.transport_attempt_id, row.dispatch_intent_ref,
      `sha256:${"1".repeat(64)}`, `sha256:${"2".repeat(64)}`, `{"input_tokens":3}`, "2026-10-10T12:35:00.000Z");

  const conceptProviderRow = await makeMigratedJobAndDispatch("new-concept-provider-attribution", "concepts.create",
    "new-concept-provider-transport");
  const conceptUsageRow = await makeMigratedJobAndDispatch("new-concept-usage-attribution", "concepts.create",
    "new-concept-usage-transport");
  const invalidProviderOperationRow = await makeMigratedJobAndDispatch("invalid-provider-operation", "edit",
    "invalid-provider-transport");
  const invalidUsageOperationRow = await makeMigratedJobAndDispatch("invalid-usage-operation", "edit",
    "invalid-usage-transport");
  assert.doesNotThrow(() => insertProviderAttribution(conceptProviderRow, "concepts.create"));
  assert.doesNotThrow(() => insertUsageAttribution(conceptUsageRow, "concepts.create"));
  assert.throws(() => insertProviderAttribution(invalidProviderOperationRow, "handoff"),
    (error) => /CHECK constraint failed: operation IN/.test(error.message));
  assert.throws(() => insertUsageAttribution(invalidUsageOperationRow, "handoff"),
    (error) => /CHECK constraint failed: operation IN/.test(error.message));
  assert.deepEqual(migratedStore.db.prepare("PRAGMA foreign_key_check").all(), []);

  const expectedProvidersAfterMigration = migratedStore.db.prepare(`SELECT * FROM private_provider_attributions ORDER BY job_id`)
    .all().map((row) => ({ ...row }));
  const expectedUsageAfterMigration = migratedStore.db.prepare(`SELECT * FROM private_provider_usage_attributions ORDER BY job_id`)
    .all().map((row) => ({ ...row }));
  migratedStore.close();
  migratedStore = new CreativeVersionStore({ databasePath, objectRoot });
  assert.equal(migratedStore.db.prepare("PRAGMA user_version").get().user_version, 13);
  assert.deepEqual(migratedStore.db.prepare(`SELECT * FROM private_provider_attributions ORDER BY job_id`).all()
    .map((row) => ({ ...row })), expectedProvidersAfterMigration);
  assert.deepEqual(migratedStore.db.prepare(`SELECT * FROM private_provider_usage_attributions ORDER BY job_id`).all()
    .map((row) => ({ ...row })), expectedUsageAfterMigration);
  assert.deepEqual({ ...migratedStore.db.prepare(`SELECT * FROM private_provider_attribution_pending`).get() }, expectedPending);
  assert.deepEqual({ ...migratedStore.db.prepare(`SELECT * FROM private_provider_attribution_reconciliations`).get() }, expectedReconciliation);
  assert.deepEqual(migratedStore.db.prepare("PRAGMA foreign_key_check").all(), []);
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions"]) {
    assert.throws(() => migratedStore.db.prepare(`UPDATE ${table} SET provider_model='changed'`).run(), /immutable/);
    assert.throws(() => migratedStore.db.prepare(`DELETE FROM ${table}`).run(), /immutable/);
  }
  assert.throws(() => migratedStore.db.prepare(`UPDATE private_provider_attribution_pending SET payload_sha256=?`)
    .run(`sha256:${"e".repeat(64)}`), /immutable/);
  assert.throws(() => migratedStore.db.prepare(`UPDATE private_provider_attribution_reconciliations SET payload_sha256=?`)
    .run(`sha256:${"f".repeat(64)}`), /immutable/);
  assert.throws(() => migratedStore.db.prepare(`INSERT INTO private_provider_attributions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(DEFAULT_SCOPE.tenant_id, DEFAULT_SCOPE.project_id, "missing-job-provider-fk", "missing-provider-action", actor_id,
      canonicalHash("missing-provider-action"), "edit", "openai", "gpt-image-2.5-migration", "missing-provider-reservation",
      "missing-provider-billable", "missing-provider-transport", "missing-provider-dispatch", "private-provider-request:fk",
      "provider-request:fk", "2026-10-10T12:36:00.000Z"), /FOREIGN KEY constraint failed/);
  assert.deepEqual(migratedStore.db.prepare("PRAGMA foreign_key_check").all(), []);
});
