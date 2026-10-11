import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { spawn, spawnSync } from "node:child_process";
import { cp, readFile, unlink } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCreativeApi } from "../../src/api/v1.mjs";
import { canonicalHash, canonicalSerialize } from "../../src/contracts/index.mjs";
import { PINNED_JEV_MODEL_ID } from "../../src/contracts/decision-port/v1.mjs";
import { makePng } from "../models/png.mjs";
import { completeResearchPackage } from "../planning/research-packages.mjs";
import { createCreativeVersionApiPorts } from "../../src/versions/api-ports.mjs";
import { CreativeVersionStore } from "../../src/versions/store.mjs";
import { createSqliteTelemetryOutbox, createUsageObservation, USAGE_PROFILE } from "../../src/telemetry/index.mjs";

const NOW = Date.parse("2026-10-10T12:30:00.000Z");
let CLOCK=NOW;
const SCOPE = Object.freeze({ tenant_id: "tenant-api-1", project_id: "project-api-1", brief_id: "brief-api-1" });

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../api/${name}.json`, import.meta.url), "utf8"));
}

function actor() {
  return { actor_id: "actor-api-1", tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    expires_at: "2026-10-11T00:00:00.000Z",
    permissions: ["creative.generate", "creative.edit", "creative.read", "creative.restore", "creative.cancel"],
    budget_scope_id: "budget-api-1", budget_policy_version: "budget-policy/1" };
}

function request(actionId, plan) {
  return { contract: "CreativeApiRequest", schema_version: "1.0", event_id: `event-${actionId}`,
    request_id: `request-${actionId}`, tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    correlation_id: `correlation-${actionId}`, producer: "versions-api-integration",
    occurred_at: "2026-10-10T12:20:00.000Z", ingested_at: "2026-10-10T12:20:00.000Z",
    environment: "test", billing_mode: "simulated", source_refs: ["source-api-1"],
    operation: "generate", action_id: actionId, payload: { brief_id: SCOPE.brief_id, plan } };
}

function inspectionRequest(actionId, designVersionId) {
  const body = request(actionId, null);
  body.operation = "inspect";
  body.payload = { brief_id: SCOPE.brief_id, design_version_id: designVersionId };
  return body;
}

async function repairEditRequest(actionId, design, reportHash, inspectionActionId) {
  const plan = await fixture("edit-plan");
  plan.base = { brief_hash: design.brief_hash, design_hash: design.design_hash,
    design_version_id: design.design_version_id };
  for (const step of plan.steps) {
    if (step.parameters.design_version_id !== undefined) step.parameters.design_version_id = design.design_version_id;
    if (step.parameters.artifact_id !== undefined) step.parameters.artifact_id = design.artifact.artifact_id;
  }
  plan.expected_result.parent_version_id = design.design_version_id;
  const body = { ...request(actionId, plan), operation: "edit",
    payload: { brief_id: SCOPE.brief_id, design_version_id: design.design_version_id, plan,
      inspection_repair: { contract: "CreativeInspectionRepairRequest", schema_version: "1.0",
        inspection_action_id: inspectionActionId, report_hash: reportHash, repair_action: "image.edit" } } };
  return body;
}

function substituteAttemptIdentity(intentJson) {
  const intent = JSON.parse(intentJson);
  intent.evidence.creation.billable_attempt_id = "billable-substituted-after-prepare";
  intent.evidence.attempt_identities.billable_attempt_id = "billable-substituted-after-prepare";
  return canonicalSerialize(intent);
}

function tamperDispatchFenceForRecoveryFixture(store, jobId, replacement) {
  // Model an offline database writer, then restore and exercise the exact
  // immutable-target trigger before recovery reads the damaged durable row.
  const originalTrigger = store.db.prepare(`SELECT sql FROM sqlite_master
    WHERE type='trigger' AND name='creative_dispatch_target_binding_once'`).get();
  assert.ok(originalTrigger?.sql, "the current schema installs the dispatch target immutability trigger");
  const firstDispatch = store.db.prepare(`SELECT transport_attempt_id,context_fence_json FROM creative_dispatch_intents
    WHERE job_id=? ORDER BY transport_attempt_id LIMIT 1`).get(jobId);
  assert.ok(firstDispatch, "corruption fixture has a durable dispatch row");
  store.db.exec("DROP TRIGGER creative_dispatch_target_binding_once");
  try {
    store.db.prepare("UPDATE creative_dispatch_intents SET context_fence_json=? WHERE job_id=?")
      .run(replacement, jobId);
  } finally {
    store.db.exec(originalTrigger.sql);
  }
  const restoredTrigger = store.db.prepare(`SELECT sql FROM sqlite_master
    WHERE type='trigger' AND name='creative_dispatch_target_binding_once'`).get();
  assert.equal(restoredTrigger?.sql, originalTrigger.sql, "the original immutability trigger is restored before recovery");

  store.db.exec("SAVEPOINT fixture_dispatch_trigger_check");
  let blocked;
  try {
    store.db.prepare(`UPDATE creative_dispatch_intents SET context_fence_json=?
      WHERE job_id=? AND transport_attempt_id=?`).run("fixture-trigger-probe", jobId, firstDispatch.transport_attempt_id);
  } catch (error) {
    blocked = error;
  }
  assert.match(blocked?.message ?? "", /dispatch target binding is immutable/,
    "the restored trigger still blocks ordinary changes to the durable dispatch row");
  store.db.exec("ROLLBACK TO fixture_dispatch_trigger_check");
  store.db.exec("RELEASE fixture_dispatch_trigger_check");
  const afterProbe = store.db.prepare(`SELECT context_fence_json FROM creative_dispatch_intents
    WHERE job_id=? AND transport_attempt_id=?`).get(jobId, firstDispatch.transport_attempt_id);
  assert.equal(afterProbe?.context_fence_json, replacement,
    "the enforcement probe leaves the deliberately corrupted bytes unchanged");
}

function portsFor(store, counters, idFactory, { leaseDurationMs = 60_000,
  artifactBytes = Buffer.from("durable exact artwork bytes"), artifactMediaType = "image/png" } = {}) {
  const bytes = Buffer.from(artifactBytes);
  const hash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const provider = {
    resolveRoute: () => ({ retry_mapping_ref: "retry:fixture/1", provider: {
      name: "fixture-provider", model: "fixture-model", endpoint: "test:/image",
      sdk: { name: "fixture-sdk", version: "1.0" },
    } }),
    async generate(input) {
      counters.provider += 1;
      (counters.providerTransportIds ??= []).push(input.transport_attempt_id);
      await input.recordTransportAttempt(input.transport_attempt_id);
      return { design_version_id: "design-durable-api-1",
        artifact: { artifact_id: "artifact-durable-api-1", content_hash: hash, media_type: artifactMediaType },
        artifact_bytes: Uint8Array.from(bytes), provider: "fixture-provider", model: "fixture-model",
        usage: { completeness: "complete", input_tokens: 2, output_tokens: 4 } };
    },
    async edit(input) {
      counters.provider += 1;
      (counters.providerTransportIds ??= []).push(input.transport_attempt_id);
      await input.recordTransportAttempt(input.transport_attempt_id);
      return { design_version_id: `design-durable-edit-${counters.provider}`,
        artifact: { artifact_id: `artifact-durable-edit-${counters.provider}`, content_hash: hash, media_type: artifactMediaType },
        artifact_bytes: Uint8Array.from(bytes), provider: "fixture-provider", model: "fixture-model",
        usage: { completeness: "complete", input_tokens: 2, output_tokens: 4 } };
    },
  };
  const metering = {
    async reserveAttempt(attempt) { counters.reserved += 1; return { status: "reserved",
      reservation_id: `reservation:${attempt.billable_attempt_id}`, billable_attempt_id: attempt.billable_attempt_id,
      held_amount: { amount: "1.00", currency: "USD" }, lease_id: `finance-lease:${attempt.billable_attempt_id}` }; },
    async releaseBeforeDispatch() { return { status: "released" }; },
    async markAttemptInFlight(input) { return { status: "in_flight", reservation_id: input.reservation_id }; },
    async recordTransportAttempt(input) {
      (counters.financeTransportIds ??= []).push(input.transport_attempt_id);
      return { status: "recorded" };
    },
    async recordUsageObservation(input) { return { status: "accepted",
      source_observation_id: input.observation.source_observation_id,
      effective_billable_attempt_id: input.observation.billable_attempt_id }; },
    async settleReservation(input) { return { status: "settled", reservation_id: input.reservation_id,
      consumed_amount: { amount: "0.10", currency: "USD" },
      released_unused_amount: { amount: "0.90", currency: "USD" } }; },
    async markOutcomeUnknown() { return { status: "held_for_reconciliation" }; },
  };
  const adapted = createCreativeVersionApiPorts({ store, otherPorts: { provider, metering }, idFactory, leaseDurationMs });
  return {
    ...adapted.ports,
    telemetry: {
      outbox: createSqliteTelemetryOutbox({ database: store.db, clock: () => NOW }),
      modes: { provider_execution_mode: "mock", commerce_mode: "simulated" },
      usage_profiles: {
        image_generation: "creative.normalized-token-usage/1",
        image_edit: "creative.normalized-token-usage/1",
        vision_observation: "creative.normalized-token-usage/1",
        jev_decision: "typesafe.systemone-usage/2026-10-10",
      },
    },
  };
}

function attachInspectionPorts(ports, counters, { recommendRepair = false, estimateRepair = true, repairUnits = 1,
  decisionDefectProbability = 0.8, decisionQualityScore = 2 } = {}) {
  ports.telemetry.usage_profile_authority = Object.freeze({
    mapProviderUsage(input) {
      const profile = input.attempt.operation_kind === "jev_decision"
        ? USAGE_PROFILE.TYPESAFE_DECISION : USAGE_PROFILE.NORMALIZED;
      const observation = createUsageObservation({ attempt: input.attempt, trustedScope: input.trustedScope,
        usage: input.rawUsage, profile, sourceObservationId: input.sourceObservationId,
        source: "provider_response", transportAttemptId: input.transportAttemptId });
      return { status: "mapped", profile_ref: `offline-fixture-profile:${profile}`,
        profile_sha256: canonicalHash({ profile, source: "versions-api-integration-fixture" }),
        raw_usage_sha256: input.rawUsageSha256, target_binding_sha256: input.targetBindingSha256,
        attempt_binding_sha256: input.attemptBindingSha256, observation };
    },
  });
  const route = { retry_mapping_ref: "retry:inspection-fixture/1", provider: {
    name: "fixture-vision", model: "fixture-vision-model", endpoint: "test:/vision",
    sdk: { name: "fixture-sdk", version: "1.0" },
  } };
  ports.inspection = {
    resolveRoute: () => structuredClone(route),
    async inspect(input) {
      counters.inspection = (counters.inspection ?? 0) + 1;
      (counters.inspectionTransportIds ??= []).push(input.transport_attempt_id);
      await input.recordTransportAttempt(input.transport_attempt_id);
      return { status: "complete", observer: { type: "model", id: "offline-vision-observer",
        model_id: "fixture-vision-model", config_ref: canonicalHash("offline-vision-config/1") },
        uncertainty: { status: "measured", note: "not_independently_measured" },
        findings: [{ code: "layout_issue", status: "present", severity: "moderate", confidence: 0.9,
          region: { x: 0.25, y: 0.25, width: 0.25, height: 0.25 } }],
        usage: { completeness: "complete", input_tokens: 2, output_tokens: 3 } };
    },
    ...(estimateRepair ? { estimateFixtureRepairCost() { return { contract: "CreativeFixtureRepairEstimate", schema_version: "1.0",
      evidence_mode: "fixture", policy_version: "fixture-repair-estimate/1", simulated_units: repairUnits }; } } : {}),
  };
  const jevRoute = { retry_mapping_ref: "retry:inspection-jev-fixture/1", provider: {
    name: "fixture-jev", model: PINNED_JEV_MODEL_ID, endpoint: "test:/jev",
    sdk: { name: "fixture-sdk", version: "1.0" },
  } };
  ports.decisionPort = {
    resolveRoute: () => structuredClone(jevRoute),
    async execute(input) {
      counters.decision = (counters.decision ?? 0) + 1;
      await input.recordTransportAttempt(input.transport_attempt_id);
      const answers = {};
      for (const [key, question] of Object.entries(input.request.questions)) {
        if (question.type === "noul") {
          answers[key] = { status: "answered", question_schema_version: question.question_schema_version,
            policy_version: question.policy_version, answer: { type: "noul", noul: decisionDefectProbability } };
        } else if (question.type === "score") {
          const keys = question.criteria.map((_item, index) => String(index));
          const lower = Math.floor(decisionQualityScore);
          const upper = Math.min(4, lower + 1);
          const probabilities = Object.fromEntries(keys.map((item) => [item, 0]));
          probabilities[String(lower)] = 1 - (decisionQualityScore - lower);
          probabilities[String(upper)] += decisionQualityScore - lower;
          answers[key] = { status: "answered", question_schema_version: question.question_schema_version,
            policy_version: question.policy_version, answer: { type: "score", score: decisionQualityScore,
              legend: Object.fromEntries(question.criteria.map((item, index) => [String(index), item])),
              probabilities, confidence: 0.95 } };
        } else {
          const choice = recommendRepair && question.eligible_candidate_ids.includes("repair_image_edit")
            ? "repair_image_edit" : "acceptable_for_review";
          answers[key] = { status: "answered", question_schema_version: question.question_schema_version,
            policy_version: question.policy_version, answer: { type: "choice", choice,
              probabilities: Object.fromEntries(question.eligible_candidate_ids.map((item) => [item, item === choice ? 1 : 0])),
              confidence: 0.95 } };
        }
      }
      return { contract: "DecisionPortResult", schema_version: "1.0", event_id: `result:${input.request.event_id}`,
        tenant_id: input.request.tenant_id, project_id: input.request.project_id,
        correlation_id: input.request.correlation_id, producer: "fixture-jev", occurred_at: input.request.occurred_at,
        ingested_at: input.request.ingested_at, environment: input.request.environment, billing_mode: input.request.billing_mode,
        source_refs: input.request.source_refs, request_id: input.request.request_id,
        logical_operation_id: input.request.logical_operation_id, billable_attempt_id: input.request.billable_attempt_id,
        model_id: input.request.model_policy.model_id, model_policy_version: input.request.model_policy.policy_version,
        job_id: input.request.job_id, answers, status: "complete",
        usage: { completeness: "complete", input_tokens: 2, output_tokens: 2 } };
    },
  };
  return ports;
}

async function setupInspectionSystem(t, { artifactBytes = Buffer.from(makePng(16, 16)),
  artifactMediaType = "image/png", recommendRepair = false, decisionDefectProbability = 0.8,
  decisionQualityScore = 2 } = {}) {
  const root = await mkdtemp(join(tmpdir(), "creative-inspection-api-case-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => CLOCK });
  t.after(() => store.close());
  const brief = await fixture("brief");
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const counters = { provider: 0, reserved: 0, inspection: 0, decision: 0 };
  let id = 0;
  const ports = attachInspectionPorts(portsFor(store, counters, () => `case-port-${++id}`,
    { artifactBytes, artifactMediaType }), counters, { recommendRepair, decisionDefectProbability, decisionQualityScore });
  const api = createCreativeApi({ ports, now: () => CLOCK, idFactory: () => `case-api-${++id}` });
  return { root, store, brief, counters, ports, api, nextId: () => ++id };
}

async function setupAssetBackedInspectionSystem(t) {
  const system = await setupInspectionSystem(t, { recommendRepair: true });
  const research = { ...completeResearchPackage(), tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id };
  research.permissions.items.push({...research.permissions.items[0], action: "modify"});
  system.ports.planning.getCurrentResearchPackage = async () => research;
  let permissionStatus = "granted";
  system.ports.planning.assetPermissionVerifier = { async verifyAssetUse(input) {
    return { status: permissionStatus, owner_evidence_status: permissionStatus === "granted" ? "verified" : "revoked",
      tenant_id: input.tenant_id, project_id: input.project_id, asset_id: input.asset_id,
      content_hash: input.content_hash, action: input.action, package_id: input.package_id,
      package_hash: input.package_hash, evidence_ref: "fixture:inspection-asset-permission",
      checked_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + 60_000).toISOString() };
  } };
  const createBriefBody = request("inspection-asset-brief", null);
  createBriefBody.operation = "brief.create";
  createBriefBody.payload = {};
  createBriefBody.source_refs = [];
  const briefCreated = await system.api.invoke({ ...actor(), permissions: [...actor().permissions, "creative.brief.create"] },
    createBriefBody);
  assert.equal(briefCreated.ok, true, JSON.stringify(briefCreated));
  const brief = briefCreated.result.brief;
  const plan = await fixture("generate-plan");
  const planHash = canonicalHash(brief);
  plan.base.brief_hash = planHash;
  plan.base.design_hash = canonicalHash({ contract: "DesignRoot", schema_version: "1.0", brief_id: brief.brief_id });
  plan.expected_result.parent_version_id = `root:${brief.brief_id}`;
  plan.source_refs = ["page-1"];
  plan.steps[0].source_refs = ["page-1"];
  plan.steps[0].parameters.brief_id = brief.brief_id;
  const generateBody = request("inspection-asset-generation", plan);
  generateBody.payload.brief_id = brief.brief_id;
  generateBody.source_refs = ["page-1"];
  const generated = await system.api.invoke(actor(), generateBody);
  assert.equal(generated.ok, true, JSON.stringify(generated));
  assert.equal(generated.result.design_version.creative_asset_use.entries.length, 1);
  // Retain initial granted fixture rights for the crash/recovery scenario.
  return { ...system, brief, design: generated.result.design_version };
}



import { mkdir, writeFile } from 'node:fs/promises';
import { applyResearchInvalidation } from '../../src/planning/index.mjs';
import { createSqliteInspectionRepairController } from '../../src/inspection/index.mjs';
const WORKER = process.argv[2] === "worker";
const RECOVERY_WORKER = process.argv[2] === "recovery-worker";
const mode = WORKER ? process.argv[3] : process.argv[2];
const assetMode = mode?.startsWith("rights-") ?? false;
const ordinaryMode = ["ordinary-valid", "legacy-ordinary", "legacy-ordinary-generate"].includes(mode);
const legacyMode = ["legacy-ordinary", "legacy-ordinary-generate", "legacy-repair", "rights-dispatch-ttl-legacy"].includes(mode);

async function runCrashWorker() {
  const system = assetMode
    ? await setupAssetBackedInspectionSystem({ after() {} })
    : await setupInspectionSystem({ after() {} }, { recommendRepair: true });
  if (mode === "rights-ttl") {
    system.ports.planning.assetPermissionVerifier = { async verifyAssetUse(input) {
      return { ...input, status: "granted", owner_evidence_status: "verified", evidence_ref: "fixture:short-rights",
        checked_at: new Date(NOW).toISOString(), expires_at: new Date(NOW + 10_000).toISOString() };
    } };
  }
  if (mode === "rights-dispatch-ttl-new" || mode === "rights-dispatch-ttl-legacy") {
    const verifier = system.ports.planning.assetPermissionVerifier;
    let dispatchAuthorized = false;
    system.ports.planning.assetPermissionVerifier = { async verifyAssetUse(input) {
      const proof = await verifier.verifyAssetUse(input);
      return { ...proof, expires_at: new Date(NOW + (dispatchAuthorized ? 60_000 : 10_000)).toISOString() };
    } };
    const authorize = system.ports.jobs.authorizeDispatch.bind(system.ports.jobs);
    system.ports.jobs.authorizeDispatch = async (input) => {
      const result = await authorize(input);
      if (result.status === "authorized" && input.provider_name === "fixture-provider") dispatchAuthorized = true;
      return result;
    };
  }

  const generated = assetMode ? { ok: true, result: { design_version: system.design } }
    : await system.api.invoke(actor(), request("recovery-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const design = generated.result.design_version;
  let scope = { ...SCOPE, brief_id: design.brief_id };
  let inspected;
  let inspectBody;
  if (!ordinaryMode) {
    inspectBody = inspectionRequest("recovery-inspect", design.design_version_id);
    inspectBody.payload.brief_id = design.brief_id;
    if (assetMode) inspectBody.source_refs = ["page-1"];
    inspected = await system.api.invoke(actor(), inspectBody);
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    assert.equal(inspected.result.report.outcome, "bounded_repair_recommended");
  }
  CLOCK = mode === "root-deadline" ? NOW + 59_000 : NOW;

  const prepare = system.store.prepareDesignVersion.bind(system.store);
  system.store.prepareDesignVersion = async (input, options) => {
    const prepared = await prepare(input, options);
    const commitIntent = system.store.db.prepare("SELECT * FROM creation_actions WHERE action_id=?")
      .get("recovery-repair");
    const job = system.store.db.prepare("SELECT * FROM creative_jobs WHERE action_id=?")
      .get("recovery-repair");
    const dispatchIntents = system.store.db.prepare("SELECT * FROM creative_dispatch_intents WHERE job_id=?")
      .all(prepared.job_id);
    const repairRows = system.store.db.prepare("SELECT * FROM creative_inspection_action_v2").all();
    const rootState = system.store.db.prepare("SELECT * FROM creative_inspection_state_v1").all();
    const inspectionSessions = system.store.db.prepare("SELECT * FROM creative_inspection_sessions_v1").all();
    process.stdout.write(JSON.stringify({ root: system.root, mode, scope, clock: CLOCK,
      prepared, selection: system.store.getSelection({ scope, brief_id: scope.brief_id }), counters: system.counters,
      repair: repairRows, root_state: rootState, inspection_sessions: inspectionSessions,
      repair_input_present: Object.hasOwn(repair.payload, "inspection_repair"),
      replay_request: repair, job, commit_intent: commitIntent, dispatch_intents: dispatchIntents }) + "\n");
    process.exit(86);
  };
  let repair;
  if (mode === "legacy-ordinary-generate") {
    const legacyBrief = await fixture("brief");
    legacyBrief.brief_id = "brief-api-legacy-generation";
    legacyBrief.event_id = "event-legacy-generation";
    legacyBrief.correlation_id = "correlation-legacy-generation";
    system.store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id },
      brief: legacyBrief });
    const plan = await fixture("generate-plan");
    plan.base.brief_hash = canonicalHash(legacyBrief);
    plan.base.design_hash = canonicalHash({ contract: "DesignRoot", schema_version: "1.0", brief_id: legacyBrief.brief_id });
    plan.expected_result.parent_version_id = `root:${legacyBrief.brief_id}`;
    plan.steps[0].parameters.brief_id = legacyBrief.brief_id;
    repair = request("recovery-repair", plan);
    repair.payload.brief_id = legacyBrief.brief_id;
    scope = { ...SCOPE, brief_id: legacyBrief.brief_id };
  } else {
    repair = await repairEditRequest("recovery-repair", design,
      inspected ? canonicalHash(inspected.result.report) : canonicalHash("unused"), inspectBody?.action_id ?? "unused");
    if (ordinaryMode) delete repair.payload.inspection_repair;
    repair.payload.brief_id = design.brief_id;
  }
  if (assetMode) {
    repair.source_refs = ["page-1"];
    repair.payload.plan.source_refs = ["page-1"];
    for (const step of repair.payload.plan.steps) step.source_refs = ["page-1"];
  }
  const result = await system.api.invoke(actor(), repair);
  throw new Error(`Expected hard exit after durable preparation; API returned ${JSON.stringify(result)}`);
}

function rewriteIntent(store, actionId, mutate) {
  const row = store.db.prepare("SELECT intent_json FROM creation_actions WHERE action_id=?").get(actionId);
  assert.ok(row, "prepared commit intent is present");
  const intent = JSON.parse(row.intent_json);
  mutate(intent);
  const intentJson = canonicalSerialize(intent);
  const { created_at: _createdAt, ...stable } = intent;
  const payloadHash = canonicalHash(stable);
  store.db.prepare("UPDATE creation_actions SET intent_json=?,payload_hash=? WHERE action_id=?")
    .run(intentJson, payloadHash, actionId);
  return intent;
}

async function runRecoveryWorker() {
  const root = process.argv[3];
  assert.ok(root, "recovery worker requires the crash fixture root");
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW + 1_000 });
  process.stdout.write("READY\n");
  await new Promise((resolveStart) => process.stdin.once("data", resolveStart));
  const recovered = await store.recover();
  const job = store.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?").get("recovery-repair");
  const repairs = store.db.prepare("SELECT status,result_hash FROM creative_inspection_action_v2").all();
  const result = { runtime: process.version, recovered, job_status: job?.status,
    repairs, recoveryTxnOpen: store.db.isTransaction };
  store.close();
  process.stdout.write(JSON.stringify(result) + "\n");
}

async function runConcurrentRecoveryWorkers(root) {
  const filename = fileURLToPath(import.meta.url);
  const startChild = () => {
    const child = spawn(process.execPath, [filename, "recovery-worker", root],
      { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let resolveReady;
    let rejectReady;
    const ready = new Promise((resolveReadyWorker, rejectReadyWorker) => {
      resolveReady = resolveReadyWorker;
      rejectReady = rejectReadyWorker;
    });
    let readyResolved = false;
    const done = new Promise((resolveDone) => {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (!readyResolved && stdout.includes("READY")) {
          readyResolved = true;
          resolveReady();
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (exit_code) => {
        if (!readyResolved) rejectReady(new Error(`recovery worker exited before ready: ${stderr}`));
        resolveDone({ exit_code, stdout, stderr });
      });
    });
    return { child, ready, done };
  };
  const children = [];
  try {
    for (let index = 0; index < 2; index += 1) {
      const entry = startChild();
      children.push(entry);
      await entry.ready;
    }
  } catch (error) {
    for (const entry of children) entry.child.kill();
    await Promise.all(children.map((entry) => entry.done));
    throw error;
  }
  for (const entry of children) entry.child.stdin.end("start");
  const completed = await Promise.all(children.map((entry) => entry.done));
  return completed.map((entry) => {
    const resultText = entry.stdout.trim().split(String.fromCharCode(10)).filter((line) => line.startsWith("{")).at(-1);
    return { exit_code: entry.exit_code, stdout: entry.stdout, stderr: entry.stderr,
      result: resultText ? JSON.parse(resultText) : null };
  });
}

async function runScenario() {
  const out = process.argv[3];
  assert.ok(out, "pass an output directory as the third argument");
  await mkdir(out, { recursive: true });
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "worker", mode], { encoding: "utf8" });
  await writeFile(join(out, "child.stdout"), child.stdout);
  await writeFile(join(out, "child.stderr"), child.stderr);
  assert.equal(child.status, 86, child.stderr + "\n" + child.stdout);

  const prior = JSON.parse(child.stdout.trim());
  await cp(prior.root, join(out, "before-recovery"), { recursive: true });
  CLOCK = NOW + (mode === "root-deadline" ? 61_000
    : mode.startsWith("rights-") ? 11_000 : 1_000);
  const concurrentRecoveryRuns = mode === "concurrent-recover"
    ? await runConcurrentRecoveryWorkers(prior.root) : null;
  const store = new CreativeVersionStore({ databasePath: join(prior.root, "versions.sqlite"),
    objectRoot: join(prior.root, "objects"), now: () => CLOCK });
  const scope = prior.scope;
  let mutation;

  if (mode === "root-cancel") {
    const action = prior.repair[0];
    mutation = createSqliteInspectionRepairController({ database: store.db, now: () => CLOCK })
      .cancelInspection({ scope: { ...scope, design_version_id: action.design_version_id }, inspection_id: action.inspection_id });
    assert.equal(mutation.status, "cancelled");
  }
  if (mode === "rights-revoked") {
    const intent = JSON.parse(prior.commit_intent.intent_json);
    const asset = intent.design_version.creative_asset_use.entries[0];
    assert.ok(asset);
    mutation = await applyResearchInvalidation({ trusted_scope: scope,
      event: { event_id: "recovery-rights-revoked", tenant_id: scope.tenant_id, project_id: scope.project_id,
        source_package_id: asset.package_id, source_package_hash: asset.package_hash, source_revision: 2,
        occurred_at: new Date(CLOCK).toISOString(), kind: "asset", reason: "asset_permission_revoked",
        assets: [{ asset_id: asset.asset_id, content_hash: asset.content_hash }],
        affected_briefs: [{ brief_id: scope.brief_id, brief_hash: intent.context.brief_hash }] },
      ports: { clock: { now: () => new Date(CLOCK).toISOString() }, store: store.planningStore(scope),
        verifier: { async verifyInvalidation({ event: sourceEvent }) {
          return { status: "verified", classification: "synthetic_test", evidence_ref: "fixture:trusted-revocation",
            event_hash: sourceEvent.content_hash, event_id: sourceEvent.event_id, tenant_id: scope.tenant_id,
            project_id: scope.project_id, verified_at: new Date(CLOCK).toISOString(),
            valid_until: new Date(NOW + 60_000).toISOString() };
        } } } });
    assert.equal(store.isAssetFenced({ scope, asset_id: asset.asset_id, content_hash: asset.content_hash }), true);
  }
  if (legacyMode) {
    rewriteIntent(store, "recovery-repair", (intent) => { delete intent.publication_fence; });
  }
  if (mode === "missing-dispatch") {
    store.db.prepare("DELETE FROM creative_dispatch_intents WHERE job_id=?").run(prior.job.job_id);
  }
  if (mode === "corrupt-dispatch") {
    tamperDispatchFenceForRecoveryFixture(store, prior.job.job_id, "not-json");
  }
  if (mode === "tampered-dispatch") {
    tamperDispatchFenceForRecoveryFixture(store, prior.job.job_id, canonicalSerialize({
      ...JSON.parse(prior.dispatch_intents[0].context_fence_json),
        inspection_repair: { ...JSON.parse(prior.dispatch_intents[0].context_fence_json).inspection_repair,
          deadline_at_ms: JSON.parse(prior.dispatch_intents[0].context_fence_json).inspection_repair.deadline_at_ms + 60_000 } }));
  }
  if (mode === "tampered-publication-fence") {
    rewriteIntent(store, "recovery-repair", (intent) => {
      intent.publication_fence.inspection_repair.root_design_hash = `sha256:${"0".repeat(64)}`;
    });
  }
  if (mode === "missing-rights-proof") {
    rewriteIntent(store, "recovery-repair", (intent) => { delete intent.publication_fence.inspection_rights; });
    tamperDispatchFenceForRecoveryFixture(store, prior.job.job_id,
      canonicalSerialize((({ inspection_rights: _rights, ...rest }) => rest)(JSON.parse(prior.dispatch_intents[0].context_fence_json))));
  }
  if (mode === "corrupt-inspection-session") {
    store.db.prepare("UPDATE creative_inspection_sessions_v1 SET result_json='{}' WHERE action_id=?")
      .run("recovery-inspect");
  }
  if (mode === "atomic-outcome-failure") {
    store.db.exec(`CREATE TRIGGER fail_repair_outcome BEFORE UPDATE OF status ON creative_inspection_action_v2
      WHEN NEW.status='recorded' BEGIN SELECT RAISE(ABORT,'fixture outcome write failure'); END`);
  }
  if (mode === "rights-dispatch-ttl-new" || mode === "rights-dispatch-ttl-legacy") {
    // The child deliberately stores the dispatch proof with a shorter TTL than
    // the later prepared publication proof; the two authorities are not conflated.
    assert.ok(prior.dispatch_intents.length > 0);
    const dispatchFence = JSON.parse(prior.dispatch_intents[0].context_fence_json);
    const intent = JSON.parse(prior.commit_intent.intent_json);
    assert.ok(dispatchFence.inspection_rights.proofs[0].expires_at <
      intent.publication_fence.inspection_rights.proofs[0].expires_at,
    "fixture must establish distinct dispatch and publication proof expiries");
  }

  const before = store.getSelection({ scope, brief_id: scope.brief_id });
  const rootBefore = store.db.prepare("SELECT * FROM creative_inspection_state_v1").all();
  const rightsBefore = store.db.prepare("SELECT * FROM creative_invalidation_fences").all();
  const attemptEvidenceBefore = store.db.prepare("SELECT attempt_evidence_json FROM creative_jobs WHERE job_id=?")
    .get(prior.job.job_id)?.attempt_evidence_json;
  const dispatchRows = store.db.prepare(`SELECT transport_attempt_id,billable_attempt_id,dispatch_intent_ref,context_fence_json
    FROM creative_dispatch_intents WHERE job_id=? ORDER BY transport_attempt_id`).all(prior.job.job_id);
  const dispatchAuthorityUsed = dispatchRows.map((row) => {
    let contextFenceHash = null;
    try { contextFenceHash = canonicalHash(JSON.parse(row.context_fence_json)); } catch { /* retain corrupt raw authority for evidence */ }
    return { ...row, context_fence_sha256: contextFenceHash };
  });
  let borrowedRecovery;
  let recovered;
  if (mode === "concurrent-recover") {
    const runs = concurrentRecoveryRuns.map((entry) => entry.result?.recovered ?? {});
    recovered = { examined: runs.reduce((sum, item) => sum + (item.examined ?? 0), 0),
      committed: runs.reduce((sum, item) => sum + (item.committed ?? 0), 0),
      conflicts: runs.reduce((sum, item) => sum + (item.conflicts ?? 0), 0),
      unknown: runs.reduce((sum, item) => sum + (item.unknown ?? 0), 0) };
  } else if (mode === "borrowed-transaction") {
    store.db.exec("BEGIN IMMEDIATE");
    let error;
    try { await store.recover(); } catch (caught) { error = caught; }
    borrowedRecovery = { code: error?.code ?? null, transactionOpen: store.db.isTransaction,
      actionState: store.db.prepare("SELECT state FROM creation_actions WHERE action_id=?")
        .get("recovery-repair")?.state,
      jobStatus: store.db.prepare("SELECT status FROM creative_jobs WHERE job_id=?").get(prior.job.job_id)?.status,
      versionsForAction: store.db.prepare("SELECT count(*) AS count FROM design_versions WHERE action_id=?")
        .get("recovery-repair").count };
    assert.equal(borrowedRecovery.code, "unavailable");
    assert.equal(borrowedRecovery.transactionOpen, true, "recover must leave the caller-owned transaction open");
    assert.equal(borrowedRecovery.actionState, "commit_intent");
    assert.equal(borrowedRecovery.jobStatus, "running");
    assert.equal(borrowedRecovery.versionsForAction, 0);
    store.db.exec("ROLLBACK");
    recovered = await store.recover();
  } else {
    recovered = await store.recover();
  }
  const after = store.getSelection({ scope, brief_id: scope.brief_id });
  const job = store.db.prepare("SELECT * FROM creative_jobs WHERE action_id=?").get("recovery-repair");
  const repairs = store.db.prepare("SELECT * FROM creative_inspection_action_v2").all();
  const finalIntentRow = store.db.prepare("SELECT intent_json,payload_hash,state FROM creation_actions WHERE action_id=?")
    .get("recovery-repair");
  const finalIntent = finalIntentRow ? JSON.parse(finalIntentRow.intent_json) : null;
  const expectedRepairResultHash = finalIntent?.job_result?.inspection_repair
    ? canonicalHash({ design_hash: finalIntent.design_version.design_hash,
      billable_attempt_id: finalIntent.evidence.creation.billable_attempt_id,
      telemetry_evidence: finalIntent.job_result.telemetry_evidence }) : null;
  const versionsForAction = store.db.prepare("SELECT count(*) AS count FROM design_versions WHERE action_id=?")
    .get("recovery-repair").count;
  const recoveryTxnOpen = store.db.isTransaction;

  let replay;
  const replayCounters = { provider: 0, reserved: 0, inspection: 0, decision: 0 };
  let replayId = 0;
  const replayPorts = attachInspectionPorts(portsFor(store, replayCounters, () => `recovery-replay-port-${++replayId}`),
    replayCounters, { recommendRepair: true });
  const replayApi = createCreativeApi({ ports: replayPorts, now: () => CLOCK,
    idFactory: () => `recovery-replay-api-${++replayId}` });
  if (prior.replay_request) replay = await replayApi.invoke(actor(), structuredClone(prior.replay_request));
  const repairEvidence = finalIntent?.job_result?.inspection_repair;

  const result = { runtime: process.version, mode, child_exit: child.status, prior, clock: CLOCK,
    elapsed_ms: CLOCK - NOW, mutation, rootBefore, rightsBefore, before, recovered, after, job, repairs,
    finalIntent, expectedRepairResultHash, attemptEvidenceBefore, attemptEvidenceAfter: job.attempt_evidence_json,
    dispatchAuthorityUsed, recoveryTxnOpen, versionsForAction, borrowedRecovery, concurrentRecoveryRuns, replay, replayCounters };
  await writeFile(join(out, "result.json"), JSON.stringify(result, null, 2) + "\n");
  store.close();
  await cp(prior.root, join(out, "after-recovery"), { recursive: true });
  await rm(prior.root, { recursive: true, force: true });

  if (["repair-valid", "legacy-repair", "rights-dispatch-ttl-new", "borrowed-transaction", "concurrent-recover"].includes(mode)) {
    assert.equal(recovered.committed, 1, `${mode}: current persisted authority should permit recovery`);
    assert.equal(job.status, "completed");
    if (repairEvidence) {
      assert.equal(repairs[0].status, "recorded", `${mode}: repair outcome commits atomically`);
      assert.equal(repairs[0].result_hash, expectedRepairResultHash);
    }
    assert.equal(replay?.ok, true, `${mode}: exact replay succeeds`);
    assert.deepEqual(replayCounters, { provider: 0, reserved: 0, inspection: 0, decision: 0 });
    if (mode === "concurrent-recover") {
      assert.equal(recovered.committed, 1, "two simultaneous recovery workers publish one version");
      assert.equal(recovered.unknown, 0, "a stale concurrent snapshot cannot poison a committed job");
      assert.equal(concurrentRecoveryRuns.length, 2);
      assert.ok(concurrentRecoveryRuns.every((entry) => entry.exit_code === 0 && entry.result?.recoveryTxnOpen === false),
        JSON.stringify(concurrentRecoveryRuns));
    }
  } else if (ordinaryMode) {
    assert.equal(recovered.committed, 1, `${mode}: ordinary edit recovery remains compatible`);
    assert.equal(job.status, "completed");
    assert.equal(replay?.ok, true, `${mode}: exact ordinary replay succeeds`);
    assert.deepEqual(replayCounters, { provider: 0, reserved: 0, inspection: 0, decision: 0 });
    if (["legacy-ordinary", "legacy-ordinary-generate"].includes(mode)) {
      assert.equal(finalIntent.publication_fence, undefined);
      assert.equal(prior.repair_input_present, false, "ordinary legacy recovery has no repair input");
      assert.deepEqual(prior.repair, [], "ordinary legacy recovery creates no repair claim");
      assert.deepEqual(prior.root_state, [], "ordinary legacy recovery creates no repair root state");
      assert.deepEqual(prior.inspection_sessions, [], "ordinary legacy recovery creates no inspection session");
      assert.ok(dispatchAuthorityUsed.length > 0, "legacy authority comes from durable dispatch rows");
      assert.deepEqual(dispatchAuthorityUsed.map((row) => row.transport_attempt_id),
        finalIntent.evidence.creation.transport_attempt_ids);
      assert.ok(dispatchAuthorityUsed.every((row) => row.billable_attempt_id ===
        finalIntent.evidence.creation.billable_attempt_id));
    }
  } else if (mode === "rights-dispatch-ttl-legacy") {
    assert.equal(recovered.committed, 0, "legacy recovery uses the expired durable dispatch proof");
    assert.equal(job.status, "failed");
    assert.equal(finalIntent.publication_fence, undefined);
    assert.equal(replayCounters.provider, 0);
    assert.equal(replayCounters.reserved, 0);
  } else {
    assert.equal(recovered.committed, 0, `${mode}: invalid or stale authority fails closed`);
    assert.equal(job.status, "failed");
    assert.equal(after?.design_version_id ?? null, before?.design_version_id ?? null,
      `${mode}: failed recovery cannot change selection`);
    assert.equal(job.attempt_evidence_json, attemptEvidenceBefore,
      `${mode}: unknown recovery retains the exact billed-attempt identity record`);
    assert.deepEqual(replayCounters, { provider: 0, reserved: 0, inspection: 0, decision: 0 },
      `${mode}: recovery and replay do not start external work`);
  }
  if (["root-deadline", "root-cancel", "rights-ttl", "rights-revoked", "rights-dispatch-ttl-legacy",
    "missing-dispatch", "corrupt-dispatch", "tampered-dispatch", "tampered-publication-fence",
    "missing-rights-proof", "corrupt-inspection-session", "atomic-outcome-failure"].includes(mode)) {
    assert.equal(recovered.committed, 0, `${mode}: unsafe recovery remains unresolved`);
  }
  if (mode === "atomic-outcome-failure") {
    assert.equal(recoveryTxnOpen, false);
    assert.equal(versionsForAction, 0, "version insert rolls back with failed repair outcome");
    assert.equal(repairs[0].status, "claimed");
    assert.equal(repairs[0].result_hash, null);
  }
  if (mode === "root-deadline") {
    assert.ok(finalIntent?.publication_fence?.inspection_repair?.deadline_at_ms < CLOCK,
      "root deadline has elapsed even though the repair claim row remains active");
    assert.equal(rootBefore[0]?.status, "active");
  }
  if (mode === "root-cancel") assert.equal(rootBefore[0]?.status, "cancelled");
  if (mode === "rights-ttl") assert.equal(CLOCK, NOW + 11_000);
  if (mode === "rights-dispatch-ttl-new") {
    assert.ok(recovered.committed === 1, "complete prepared publication proof remains current after dispatch TTL");
  }

  process.stdout.write(JSON.stringify({ runtime: result.runtime, mode, child_exit: child.status,
    recovered, before, after, job_status: job.status,
    repairs: repairs.map(({ status, result_hash }) => ({ status, result_hash })),
    replayCounters, dispatchAuthorityUsed: dispatchAuthorityUsed.map(({ transport_attempt_id, billable_attempt_id,
      dispatch_intent_ref, context_fence_sha256 }) => ({ transport_attempt_id, billable_attempt_id,
      dispatch_intent_ref, context_fence_sha256 })) }) + "\n");
}

if (RECOVERY_WORKER) await runRecoveryWorker();
else if (WORKER) await runCrashWorker();
else await runScenario();
