import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { cp, link, readFile, readdir, symlink, unlink, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { createCreativeApi } from "../../src/api/v1.mjs";
import { canonicalHash, canonicalSerialize } from "../../src/contracts/index.mjs";
import { PINNED_JEV_MODEL_ID } from "../../src/contracts/decision-port/v1.mjs";
import { corruptPngCrc, makePng } from "../../fixtures/models/png.mjs";
import { completeResearchPackage } from "../../fixtures/planning/research-packages.mjs";
import { createCreativeVersionApiPorts } from "../../src/versions/api-ports.mjs";
import { CreativeVersionStore, VersionStoreError } from "../../src/versions/store.mjs";
import { createSqliteTelemetryOutbox, createUsageObservation, deliverPendingUsageObservations, USAGE_PROFILE } from "../../src/telemetry/index.mjs";
import { evaluateHeldOutFixtures } from "../../src/inspection/index.mjs";

const NOW = Date.parse("2026-10-10T12:30:00.000Z");
const SCOPE = Object.freeze({ tenant_id: "tenant-api-1", project_id: "project-api-1", brief_id: "brief-api-1" });
const API_CRASH_WORKER = new URL("../../fixtures/versions/api-crash-worker.mjs", import.meta.url);
const INSPECTION_CRASH_WORKER = new URL("../../fixtures/versions/inspection-crash-worker.mjs", import.meta.url);
const RECOVERY_PUBLICATION_MATRIX = new URL("../../fixtures/versions/recovery-publication-matrix.mjs", import.meta.url);

async function fixture(name) {
  return JSON.parse(await readFile(new URL(`../../fixtures/api/${name}.json`, import.meta.url), "utf8"));
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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

function concurrentProvider(label, counters, waitForProvider = async () => {}) {
  // Text bytes stand in for durable object identity only; this fixture declares
  // image/png to satisfy the edit contract but performs no image codec check.
  const artifactBytes = Buffer.from(`exact concurrent artifact bytes:${label}`);
  const content_hash = `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}`;
  return {
    resolveRoute: () => ({ retry_mapping_ref: "retry:concurrent-fixture/1", provider: {
      name: "fixture-provider", model: "fixture-model", endpoint: "test:/image",
      sdk: { name: "fixture-sdk", version: "1.0" },
    } }),
    async generate(input) {
      counters.provider += 1;
      (counters.providerTransportIds ??= []).push(input.transport_attempt_id);
      await input.recordTransportAttempt(input.transport_attempt_id);
      await waitForProvider(input);
      return { design_version_id: `design:${label}`, artifact: {
        artifact_id: `artifact:${label}`, content_hash, media_type: "image/png",
      }, artifact_bytes: Uint8Array.from(artifactBytes), provider: "fixture-provider", model: "fixture-model",
      usage: { completeness: "complete", input_tokens: 2, output_tokens: 4 } };
    },
    async edit(input) {
      counters.provider += 1;
      (counters.providerTransportIds ??= []).push(input.transport_attempt_id);
      await input.recordTransportAttempt(input.transport_attempt_id);
      await waitForProvider(input);
      return { design_version_id: `design:${label}`, artifact: {
        artifact_id: `artifact:${label}`, content_hash, media_type: "image/png",
      }, artifact_bytes: Uint8Array.from(artifactBytes), provider: "fixture-provider", model: "fixture-model",
      usage: { completeness: "complete", input_tokens: 2, output_tokens: 4 } };
    },
  };
}

function barrierFor(participants) {
  let arrived = 0;
  const gate = deferred();
  return async () => {
    arrived += 1;
    if (arrived === participants) gate.resolve();
    await gate.promise;
  };
}

function concurrentApi(store, label, counters, waitForProvider) {
  let portId = 0;
  let apiId = 0;
  const ports = portsFor(store, counters, () => `${label}-port-${++portId}`);
  ports.provider = concurrentProvider(label, counters, waitForProvider);
  return createCreativeApi({ ports, now: () => NOW, idFactory: () => `${label}-api-${++apiId}` });
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
            ? "repair_image_edit" : (question.eligible_candidate_ids.includes("acceptable_for_review")
              ? "acceptable_for_review" : question.eligible_candidate_ids[0]);
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
  decisionQualityScore = 2, now = () => NOW, leaseDurationMs = 60_000 } = {}) {
  const root = await mkdtemp(join(tmpdir(), "creative-inspection-api-case-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now });
  t.after(() => store.close());
  const brief = await fixture("brief");
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const counters = { provider: 0, reserved: 0, inspection: 0, decision: 0 };
  let id = 0;
  const ports = attachInspectionPorts(portsFor(store, counters, () => `case-port-${++id}`,
    { artifactBytes, artifactMediaType, leaseDurationMs }), counters,
  { recommendRepair, decisionDefectProbability, decisionQualityScore });
  const api = createCreativeApi({ ports, now, idFactory: () => `case-api-${++id}` });
  return { root, store, brief, counters, ports, api, nextId: () => ++id, now };
}

async function setupAssetBackedInspectionSystem(t, { now = () => NOW, permissionStatusAfterGenerate = "denied" } = {}) {
  const system = await setupInspectionSystem(t, { recommendRepair: true, now });
  const research = { ...completeResearchPackage(), tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id };
  system.ports.planning.getCurrentResearchPackage = async () => research;
  let permissionStatus = "granted";
  system.ports.planning.assetPermissionVerifier = { async verifyAssetUse(input) {
    return { status: permissionStatus, owner_evidence_status: permissionStatus === "granted" ? "verified" : "revoked",
      tenant_id: input.tenant_id, project_id: input.project_id, asset_id: input.asset_id,
      content_hash: input.content_hash, action: input.action, package_id: input.package_id,
      package_hash: input.package_hash, evidence_ref: "fixture:inspection-asset-permission",
      checked_at: new Date(now()).toISOString(), expires_at: new Date(now() + 60_000).toISOString() };
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
  permissionStatus = permissionStatusAfterGenerate;
  return { ...system, brief, design: generated.result.design_version,
    setPermissionStatus(status) { permissionStatus = status; } };
}

test("real API invocation commits job, exact artifact bytes, version and selection through one durable adapter", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const plan = await fixture("generate-plan");
  const brief = await fixture("brief");
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"), objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  assert.equal(store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief }).status, "saved");
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const api = createCreativeApi({ ports: portsFor(store, counters, () => `fixture-id-${++id}`), now: () => NOW,
    idFactory: () => `api-id-${++id}` });
  const body = request("durable-api-generation-1", plan);
  const result = await api.invoke(actor(), body);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(counters.provider, 1);
  assert.equal(counters.reserved, 1);
  const design = result.result.design_version;
  const persisted = store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: design.design_version_id });
  assert.equal(persisted.design_hash, design.design_hash);
  assert.deepEqual(Buffer.from(await store.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: design.design_version_id })), Buffer.from("durable exact artwork bytes"));
  assert.equal(store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }).design_version_id, design.design_version_id);
  const job = store.db.prepare("SELECT status,result_json,attempt_evidence_json FROM creative_jobs WHERE action_id=?")
    .get("durable-api-generation-1");
  assert.equal(job.status, "completed");
  assert.equal(JSON.parse(job.result_json).design.design_hash, design.design_hash);
  const attemptEvidence = JSON.parse(job.attempt_evidence_json);
  assert.equal(attemptEvidence.billable_attempt_id, design.billable_attempt_id);
  assert.equal(attemptEvidence.transport_attempt_ids.length, 1);
  assert.equal(typeof attemptEvidence.transport_attempt_ids[0], "string");
  assert.deepEqual(counters.providerTransportIds, attemptEvidence.transport_attempt_ids);
  assert.deepEqual(counters.financeTransportIds, attemptEvidence.transport_attempt_ids);
  assert.equal(attemptEvidence.usage_refs.length, 1);
  assert.equal(attemptEvidence.trace_refs.length, 3);
  assert.equal(new Set(attemptEvidence.trace_refs).size, 3);
  assert.ok(attemptEvidence.trace_refs.every((eventId) => store.db.prepare(
    "SELECT 1 AS found FROM creative_telemetry_evidence_outbox_v1 WHERE event_id=?").get(eventId)));
  const telemetryRows = store.db.prepare("SELECT event_type,status FROM creative_telemetry_evidence_outbox_v1 ORDER BY rowid").all();
  assert.deepEqual(telemetryRows.map((row) => row.event_type), ["attempt_intent", "transport_intent", "attempt_outcome"]);
  assert.ok(telemetryRows.every((row) => row.status === "pending"));
  const transportEvent = store.db.prepare("SELECT payload_json FROM creative_telemetry_evidence_outbox_v1 WHERE event_type='transport_intent'").get();
  assert.deepEqual(JSON.parse(transportEvent.payload_json).transport_attempt_id, attemptEvidence.transport_attempt_ids[0]);
  const dispatchIntent = store.db.prepare("SELECT transport_attempt_id FROM creative_dispatch_intents WHERE job_id=?")
    .get(attemptEvidence.job_id);
  assert.equal(dispatchIntent.transport_attempt_id, attemptEvidence.transport_attempt_ids[0]);
  const observationRows = store.db.prepare("SELECT status,source_observation_id FROM creative_telemetry_observations_v1").all();
  assert.equal(observationRows.length, 1);
  assert.equal(observationRows[0].status, "delivered");
  assert.match(observationRows[0].source_observation_id, /^usage:/);
  const action = store.db.prepare("SELECT state FROM creation_actions WHERE action_id=?")
    .get("durable-api-generation-1");
  assert.equal(action.state, "committed");

  store.close();
  const reopened = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"), objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => reopened.close());
  const recovered = await reopened.recover();
  assert.deepEqual(recovered, { examined: 0, committed: 0, conflicts: 0, unknown: 0 });
  const replayApi = createCreativeApi({ ports: portsFor(reopened, counters, () => `replay-id-${++id}`), now: () => NOW,
    idFactory: () => `replay-api-id-${++id}` });
  const replayRequest = { ...body, event_id: "event-retry", request_id: "request-retry", correlation_id: "correlation-retry" };
  const replay = await replayApi.invoke(actor(), replayRequest);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(counters.provider, 1, "completed replay must not dispatch again");
  const changedPayload = { ...replayRequest, payload: structuredClone(replayRequest.payload) };
  changedPayload.payload.plan.steps[0].parameters.variant_count = 2;
  const conflict = await replayApi.invoke(actor(), changedPayload);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, "conflict");
  assert.equal(counters.provider, 1, "conflicting action replay must not dispatch again");
});

test("inspection hard exit reopens with a dispatching stage and never redispatches it", async (t) => {
  const system = await setupInspectionSystem(t);
  const generated = await system.api.invoke(actor(), request("inspection-crash-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const actionId = "inspection-hard-exit-action";
  const designVersionId = generated.result.design_version.design_version_id;
  const callLog = join(system.root, "inspection-side-effects.log");
  const crashAt = NOW + 120_000;
  system.store.close();
  const child = spawnSync(process.execPath, [fileURLToPath(INSPECTION_CRASH_WORKER)], {
    cwd: process.cwd(), encoding: "utf8", timeout: 30_000,
    env: { ...process.env, CE09_INSPECTION_DATABASE: join(system.root, "versions.sqlite"),
      CE09_INSPECTION_OBJECTS: join(system.root, "objects"), CE09_INSPECTION_ACTION: actionId,
      CE09_INSPECTION_DESIGN: designVersionId, CE09_INSPECTION_CALL_LOG: callLog,
      CE09_INSPECTION_NOW: String(crashAt) },
  });
  assert.equal(child.status, 86, `worker must hard-exit at observer dispatch: ${child.stderr}`);
  assert.equal((await readFile(callLog, "utf8")).trim().split("\n").length, 2,
    "the observer side effect and its C03 transport acknowledgement must both precede the hard exit");

  const afterCrash = new CreativeVersionStore({ databasePath: join(system.root, "versions.sqlite"),
    objectRoot: join(system.root, "objects"), now: () => crashAt + 180_000 });
  t.after(() => afterCrash.close());
  const stageBeforeReplay = afterCrash.db.prepare(`SELECT stage,status,attempt_id FROM creative_inspection_stages_v1
    WHERE action_id=?`).get(actionId);
  assert.equal(stageBeforeReplay?.stage, "observer");
  assert.equal(stageBeforeReplay?.status, "dispatching");
  const counters = { provider: 0, reserved: 0, inspection: 0, decision: 0 };
  let id = 0;
  const ports = attachInspectionPorts(portsFor(afterCrash, counters, () => `post-crash-port-${++id}`), counters);
  const api = createCreativeApi({ ports, now: () => crashAt + 180_000,
    idFactory: () => `post-crash-api-${++id}` });
  const replay = await api.invoke(actor(), inspectionRequest(actionId, designVersionId));
  assert.equal(replay.ok, false);
  assert.equal(replay.error.code, "unavailable");
  assert.equal(counters.inspection, 0, "an uncertain observer attempt is never dispatched again");
  assert.equal(counters.decision, 0, "no dependent DecisionPort stage runs after the unknown observer attempt");
  assert.equal(counters.provider, 0);
  assert.equal(counters.reserved, 0, "restart reconciliation adds no metered reserve");
  const stageAfterReplay = afterCrash.db.prepare(`SELECT stage,status,attempt_id FROM creative_inspection_stages_v1
    WHERE action_id=?`).get(actionId);
  assert.deepEqual(stageAfterReplay, stageBeforeReplay);
  assert.equal((await readFile(callLog, "utf8")).trim().split("\n").length, 2);
});

test("inspection API decodes PNG, JPEG, and WebP with the pinned shared codec", async (t) => {
  const samples = [
    { format: "png", mediaType: "image/png", bytes: Buffer.from(makePng(16, 16)) },
    { format: "jpeg", mediaType: "image/jpeg", bytes: await readFile(new URL("../../fixtures/models/valid-16x16.jpg", import.meta.url)) },
    { format: "webp", mediaType: "image/webp", bytes: await readFile(new URL("../../fixtures/models/valid-16x16.webp", import.meta.url)) },
  ];
  for (const sample of samples) await t.test(sample.format, async (subtest) => {
    const system = await setupInspectionSystem(subtest, { artifactBytes: sample.bytes, artifactMediaType: sample.mediaType });
    const generated = await system.api.invoke(actor(), request(`codec-${sample.format}-seed`, await fixture("generate-plan")));
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const inspect = system.ports.inspection.inspect;
    system.ports.inspection.inspect = async (input) => {
      assert.equal(input.deterministic.dimensions.format, sample.format);
      assert.deepEqual(Buffer.from(input.artifact_bytes), sample.bytes);
      return inspect(input);
    };
    const result = await system.api.invoke(actor(), inspectionRequest(`codec-${sample.format}-inspect`,
      generated.result.design_version.design_version_id));
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.report.deterministic.gate, "eligible");
    assert.equal(result.result.report.observations.length, 1);
  });
});

test("CE09 acceptance case 4 persists cumulative root limits across restart and blocks a third repair", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-inspection-reopen-repair-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, "versions.sqlite");
  const objectRoot = join(root, "objects");
  const brief = await fixture("brief");
  const png = Buffer.from(makePng(16, 16));
  const storeOptions = { databasePath, objectRoot, now: () => NOW };
  let store = new CreativeVersionStore(storeOptions);
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const counters = { provider: 0, reserved: 0, inspection: 0, decision: 0 };
  let id = 0;
  const makePorts = () => attachInspectionPorts(portsFor(store, counters,
    () => `inspection-port-${++id}`, { artifactBytes: png }), counters, { recommendRepair: true });
  let activePorts = makePorts();
  let api = createCreativeApi({ ports: activePorts, now: () => NOW, idFactory: () => `inspection-api-${++id}` });
  const generated = await api.invoke(actor(), request("inspection-seed-generation", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const original = generated.result.design_version;
  assert.deepEqual(Buffer.from(await store.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: original.design_version_id })), png);

  const firstInspectAction = `inspect-${original.design_version_id}`;
  const firstInspectBody = inspectionRequest(firstInspectAction, original.design_version_id);
  const inspected = await api.invoke(actor(), firstInspectBody);
  assert.equal(inspected.ok, true, JSON.stringify({ inspected, counters,
    job: store.db.prepare("SELECT status,error_json,result_json FROM creative_jobs WHERE action_id=?").get(firstInspectAction),
    intents: store.db.prepare("SELECT transport_attempt_id,authorized_at FROM creative_dispatch_intents WHERE job_id=(SELECT job_id FROM creative_jobs WHERE action_id=?)")
      .all(firstInspectAction) }));
  assert.equal(inspected.result.report.outcome, "bounded_repair_recommended");
  assert.equal(inspected.result.report.recommendation, "image.edit");
  assert.equal(inspected.result.report.limits.usage_completeness, "complete",
    "a repairable report requires the trusted owner usage mapping for every inspection stage");
  assert.equal(inspected.result.report.deterministic.gate, "eligible");
  assert.equal(inspected.result.report.limitations.some((item) => /not customer approval/i.test(item)), true);
  assert.equal(Object.hasOwn(inspected.result.report, "approved"), false);
  assert.deepEqual(inspected.result.attempt_ids.length, 3, "observer and both sequential C02 stages are separately metered");
  assert.equal(counters.inspection, 1);
  assert.equal(counters.decision, 2);
  assert.equal(counters.reserved, 4, "generation, observer, and both DecisionPort requests have distinct reservations");
  assert.equal(new Set(counters.financeTransportIds).size, 4);
  const sessionRow = store.db.prepare("SELECT status,result_hash FROM creative_inspection_sessions_v1 WHERE action_id=?")
    .get(firstInspectAction);
  assert.equal(sessionRow.status, "completed");
  assert.equal(sessionRow.result_hash, canonicalHash(JSON.parse(sessionRow.result_hash ?
    store.db.prepare("SELECT result_json FROM creative_inspection_sessions_v1 WHERE action_id=?").get(firstInspectAction).result_json : "null")));
  const firstStages = store.db.prepare("SELECT stage,status FROM creative_inspection_stages_v1 WHERE action_id=? ORDER BY stage")
    .all(firstInspectAction);
  assert.deepEqual(firstStages.map((row) => row.status), ["completed", "completed", "completed"]);
  const firstStageResults = store.db.prepare("SELECT stage,attempt_id,result_json FROM creative_inspection_stages_v1 WHERE action_id=? ORDER BY stage")
    .all(firstInspectAction);
  assert.deepEqual(firstStageResults.map((row) => JSON.parse(row.result_json).usage_completeness), ["complete", "complete", "complete"]);
  assert.deepEqual(firstStageResults.map((row) => JSON.parse(row.result_json).telemetry_evidence.local_status),
    ["recorded", "recorded", "recorded"]);
  const firstUsageRows = store.db.prepare(`SELECT billable_attempt_id,status,payload_json
    FROM creative_telemetry_observations_v1 WHERE logical_operation_id=? ORDER BY billable_attempt_id`)
    .all(firstInspectAction);
  assert.equal(firstUsageRows.length, 3, "observer and both dependent DecisionPort stages have separate owner usage evidence");
  assert.ok(firstStageResults.every((stage) => firstUsageRows.some((row) => {
    const observation = JSON.parse(row.payload_json).observation;
    return row.billable_attempt_id === stage.attempt_id && row.status === "delivered" &&
      observation.completeness === "complete" && observation.billable_attempt_id === stage.attempt_id;
  })), "each completed stage must match a complete, acknowledged C03 observation for its own attempt");

  store.close();
  store = new CreativeVersionStore(storeOptions);
  activePorts = makePorts();
  api = createCreativeApi({ ports: activePorts, now: () => NOW, idFactory: () => `inspection-reopen-api-${++id}` });
  const replay = await api.invoke(actor(), { ...firstInspectBody, event_id: "inspect-replay-event",
    request_id: "inspect-replay-request", correlation_id: "inspect-replay-correlation" });
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(counters.inspection, 1, "reopening a completed observation does not call vision again");
  assert.equal(counters.decision, 2, "reopening a completed decision does not call DecisionPort again");
  assert.equal(counters.reserved, 4, "inspection replay creates no additional metered attempts");

  const firstRepair = await repairEditRequest("inspection-repair-1", original,
    canonicalHash(inspected.result.report), firstInspectAction);
  const repaired1 = await api.invoke(actor(), firstRepair);
  assert.equal(repaired1.ok, true, JSON.stringify(repaired1));
  const design1 = repaired1.result.design_version;
  assert.equal(design1.parent_version_id, original.design_version_id);
  assert.equal(repaired1.result.inspection_repair.root_design_version_id, original.design_version_id);
  assert.equal(repaired1.result.inspection_repair.source_report_hash, canonicalHash(inspected.result.report));
  assert.equal(counters.provider, 2, "repair uses the existing normal edit provider path once");
  assert.equal(counters.reserved, 5);
  const state = await activePorts.storage.inspectionRepair.getState({ scope: { ...SCOPE,
    design_version_id: original.design_version_id }, inspection_id: inspected.result.inspection_id });
  assert.equal(state.repairs_used, 1);
  assert.equal(state.simulated_units_used, 1);
  assert.equal(state.remaining_repairs, 1);
  assert.equal(state.remaining_simulated_units, 2);

  store.close();
  store = new CreativeVersionStore(storeOptions);
  activePorts = makePorts();
  api = createCreativeApi({ ports: activePorts, now: () => NOW, idFactory: () => `inspection-reopen-2-api-${++id}` });
  const replayRepair = await api.invoke(actor(), { ...firstRepair, event_id: "repair-replay-event",
    request_id: "repair-replay-request", correlation_id: "repair-replay-correlation" });
  assert.equal(replayRepair.ok, true, JSON.stringify(replayRepair));
  assert.equal(replayRepair.replayed, true);
  assert.equal(replayRepair.result.inspection_repair.claim_ref, repaired1.result.inspection_repair.claim_ref);
  assert.equal(counters.provider, 2, "repair replay after reopen does not redispatch an edit");
  assert.equal(counters.reserved, 5);

  const secondInspectAction = `inspect-${design1.design_version_id}`;
  const secondInspectBody = inspectionRequest(secondInspectAction, design1.design_version_id);
  const inspected2 = await api.invoke(actor(), secondInspectBody);
  assert.equal(inspected2.ok, true, JSON.stringify(inspected2));
  assert.equal(inspected2.result.report.limits.remaining_repairs, 1);
  const secondRepair = await repairEditRequest("inspection-repair-2", design1,
    canonicalHash(inspected2.result.report), secondInspectAction);
  const repaired2 = await api.invoke(actor(), secondRepair);
  assert.equal(repaired2.ok, true, JSON.stringify(repaired2));
  assert.equal(repaired2.result.design_version.parent_version_id, design1.design_version_id);
  assert.equal(counters.provider, 3);
  assert.equal(counters.reserved, 9, "second inspect adds three attempts and second repair adds one");
  const finalState = await activePorts.storage.inspectionRepair.getState({ scope: { ...SCOPE,
    design_version_id: original.design_version_id }, inspection_id: inspected.result.inspection_id });
  assert.equal(finalState.repairs_used, 2);
  assert.equal(finalState.remaining_repairs, 0);

  const thirdDesign = repaired2.result.design_version;
  const thirdInspectAction = `inspect-${thirdDesign.design_version_id}`;
  const thirdInspection = await api.invoke(actor(), inspectionRequest(thirdInspectAction, thirdDesign.design_version_id));
  assert.equal(thirdInspection.ok, true, JSON.stringify(thirdInspection));
  const beforeDeniedRepair = { provider: counters.provider, reserved: counters.reserved };
  const denied = await api.invoke(actor(), await repairEditRequest("inspection-repair-3", thirdDesign,
    canonicalHash(thirdInspection.result.report), thirdInspectAction));
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "review_required", "the durable root repair limit is a review gate, not missing usage");
  assert.deepEqual({ provider: counters.provider, reserved: counters.reserved }, beforeDeniedRepair,
    "the durable two-repair limit stops a third edit before new route, reservation, or transport");
});

test("terminal inspection graphs reopen with exact reports and zero redispatch", async (t) => {
  const cases = [
    { name: "deterministic decode failure", mode: "decode_failure", expectedStages: 0 },
    { name: "observer refusal", mode: "observer_refusal", expectedStages: 1 },
    { name: "observer unavailable", mode: "observer_unavailable", expectedStages: 1 },
    { name: "observer timeout", mode: "observer_timeout", expectedStages: 1 },
    { name: "observer only", mode: "observer_only", expectedStages: 1 },
    { name: "first stage abstention", mode: "first_review", expectedStages: 2 },
    { name: "first stage timeout", mode: "first_timeout", expectedStages: 2 },
    { name: "dependent route timeout", mode: "route_timeout", expectedStages: 3 },
    { name: "complete dependent decisions", mode: "complete", expectedStages: 3 },
  ];
  for (const scenario of cases) {
    await t.test(scenario.name, async (subtest) => {
      const root = await mkdtemp(join(tmpdir(), "creative-inspection-terminal-replay-"));
      subtest.after(async () => rm(root, { recursive: true, force: true }));
      const databasePath = join(root, "versions.sqlite");
      const objectRoot = join(root, "objects");
      const artifactBytes = scenario.mode === "decode_failure"
        ? corruptPngCrc(Buffer.from(makePng(16, 16))) : Buffer.from(makePng(16, 16));
      const storeOptions = { databasePath, objectRoot, now: () => NOW };
      let store = new CreativeVersionStore(storeOptions);
      subtest.after(() => store.close());
      store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
      const counters = { provider: 0, reserved: 0, inspection: 0, decision: 0 };
      let id = 0;
      const makePorts = () => attachInspectionPorts(portsFor(store, counters,
        () => `terminal-replay-port-${++id}`, { artifactBytes }), counters, { recommendRepair: true });
      let ports = makePorts();
      if (["observer_refusal", "observer_unavailable", "observer_timeout"].includes(scenario.mode)) {
        ports.inspection.inspect = async (input) => {
          counters.inspection += 1;
          await input.recordTransportAttempt(input.transport_attempt_id);
          return { status: scenario.mode === "observer_refusal" ? "refused"
            : scenario.mode === "observer_unavailable" ? "unavailable" : "timeout",
          usage: { completeness: "complete", input_tokens: 1, output_tokens: 0 } };
        };
      }
      if (scenario.mode === "observer_only") delete ports.decisionPort;
      if (["first_review", "first_timeout", "route_timeout"].includes(scenario.mode)) {
        const execute = ports.decisionPort.execute;
        ports.decisionPort.execute = async (input) => {
          const result = await execute(input);
          if (scenario.mode === "first_review" && counters.decision === 1) {
            const [key, question] = Object.entries(input.request.questions)[0];
            return { ...result, status: "review", answers: { ...result.answers, [key]: {
              status: "abstain", question_schema_version: question.question_schema_version,
              policy_version: question.policy_version, reason: "fixture review required",
            } } };
          }
          const firstStageTimeout = scenario.mode === "first_timeout" && counters.decision === 1;
          const routeTimeout = scenario.mode === "route_timeout" && counters.decision === 2;
          if (firstStageTimeout || routeTimeout) {
            return { ...result, status: "timeout", answers: Object.fromEntries(
              Object.entries(input.request.questions).map(([key, question]) => [key, {
                status: "unavailable", question_schema_version: question.question_schema_version,
                policy_version: question.policy_version, reason: "fixture timeout",
              }])), error: { code: "timeout", retryable: true, fallback: "review",
                user_message: "The fixture decision timed out." } };
          }
          return result;
        };
      }
      let api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `terminal-replay-api-${++id}` });
      const generated = await api.invoke(actor(), request(`terminal-seed-${scenario.mode}`, await fixture("generate-plan")));
      assert.equal(generated.ok, true, JSON.stringify(generated));
      const inspectBody = inspectionRequest(`terminal-inspect-${scenario.mode}`, generated.result.design_version.design_version_id);
      const inspected = await api.invoke(actor(), inspectBody);
      assert.equal(inspected.ok, true, JSON.stringify(inspected));
      assert.equal(inspected.result.attempt_ids.length, scenario.expectedStages);
      const beforeRestart = { provider: counters.provider, reserved: counters.reserved,
        inspection: counters.inspection, decision: counters.decision };
      assert.equal(store.db.prepare("SELECT status FROM creative_inspection_sessions_v1 WHERE action_id=?")
        .get(inspectBody.action_id).status, "completed");
      store.close();
      store = new CreativeVersionStore(storeOptions);
      ports = makePorts();
      if (scenario.mode === "observer_only") delete ports.decisionPort;
      if (["observer_refusal", "observer_unavailable", "observer_timeout"].includes(scenario.mode)) {
        ports.inspection.inspect = async () => { counters.inspection += 1; throw new Error("replay redispatched observer"); };
      }
      if (["first_review", "first_timeout", "route_timeout"].includes(scenario.mode)) {
        ports.decisionPort.execute = async () => { counters.decision += 1; throw new Error("replay redispatched DecisionPort"); };
      }
      api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `terminal-replay-api-reopen-${++id}` });
      const replay = await api.invoke(actor(), { ...inspectBody,
        event_id: `${inspectBody.event_id}-reopen`, request_id: `${inspectBody.request_id}-reopen` });
      assert.equal(replay.ok, true, JSON.stringify(replay));
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.result, inspected.result);
      assert.deepEqual({ provider: counters.provider, reserved: counters.reserved,
        inspection: counters.inspection, decision: counters.decision }, beforeRestart);
    });
  }
});

test("completed inspection replay uses its validated historical eligibility and still fails closed on persisted tampering", async (t) => {
  const system = await setupInspectionSystem(t, { recommendRepair: true });
  const generated = await system.api.invoke(actor(), request("historical-replay-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const inspectBody = inspectionRequest("historical-replay-inspect", generated.result.design_version.design_version_id);
  const inspected = await system.api.invoke(actor(), inspectBody);
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.deepEqual(inspected.result.report.eligible_repair_actions, ["image.edit"]);
  const before = { provider: system.counters.provider, reserved: system.counters.reserved,
    inspection: system.counters.inspection, decision: system.counters.decision };

  const databasePath = join(system.root, "versions.sqlite");
  const objectRoot = join(system.root, "objects");
  system.store.close();
  const store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(() => store.close());
  let id = 0;
  const ports = attachInspectionPorts(portsFor(store, system.counters, () => `historical-replay-port-${++id}`),
    system.counters, { recommendRepair: true });
  const edit = ports.provider.edit;
  delete ports.provider.edit;
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `historical-replay-api-${++id}` });

  const replayWithoutEdit = await api.invoke(actor(), inspectBody);
  assert.equal(replayWithoutEdit.ok, true, JSON.stringify(replayWithoutEdit));
  assert.equal(replayWithoutEdit.replayed, true);
  assert.deepEqual(replayWithoutEdit.result, inspected.result,
    "stored deterministic provenance reconstructs the original report without current edit capability");
  assert.deepEqual({ provider: system.counters.provider, reserved: system.counters.reserved,
    inspection: system.counters.inspection, decision: system.counters.decision }, before);

  ports.provider.edit = edit;
  const replayAfterRestore = await api.invoke(actor(), inspectBody);
  assert.equal(replayAfterRestore.ok, true, JSON.stringify(replayAfterRestore));
  assert.deepEqual(replayAfterRestore.result, inspected.result);
  assert.deepEqual({ provider: system.counters.provider, reserved: system.counters.reserved,
    inspection: system.counters.inspection, decision: system.counters.decision }, before);

  const denied = await api.invoke({ ...actor(), permissions: actor().permissions.filter((permission) => permission !== "creative.read") },
    { ...inspectBody, action_id: "historical-replay-current-read-denied" });
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "permission_denied", "historical eligibility never bypasses present read authority");

  const observer = store.db.prepare(`SELECT result_json FROM creative_inspection_stages_v1
    WHERE action_id=? AND stage='observer'`).get(inspectBody.action_id);
  const tamperedResult = JSON.parse(observer.result_json);
  tamperedResult.usage_completeness = "unknown";
  store.db.prepare(`UPDATE creative_inspection_stages_v1 SET result_json=?,result_hash=?
    WHERE action_id=? AND stage='observer'`).run(canonicalSerialize(tamperedResult), canonicalHash(tamperedResult),
    inspectBody.action_id);
  const tamperedReplay = await api.invoke(actor(), inspectBody);
  assert.equal(tamperedReplay.ok, false, "coherently rehashed stage mutation cannot rewrite historical owner provenance");
  assert.equal(tamperedReplay.error.code, "unavailable");
  assert.deepEqual({ provider: system.counters.provider, reserved: system.counters.reserved,
    inspection: system.counters.inspection, decision: system.counters.decision }, before,
  "tampered replay fails closed without fresh metering or dispatch");
});

test("compiled public inspection and decision adapters invoke typed dispatch fences at every stage", async (t) => {
  const buildRoot = await mkdtemp(join(tmpdir(), "creative-inspection-typed-adapter-"));
  t.after(async () => rm(buildRoot, { recursive: true, force: true }));
  const compiler = fileURLToPath(new URL("../../examples/frontend-action-roundtrip/node_modules/typescript/bin/tsc", import.meta.url));
  const consumer = fileURLToPath(new URL("../../tests/inspection/adapter-invocation-consumer.mts", import.meta.url));
  const compile = spawnSync(process.execPath, [compiler, "--strict", "--skipLibCheck", "false", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--target", "ES2022", "--rootDir", fileURLToPath(new URL("../../tests/inspection", import.meta.url)),
    "--outDir", buildRoot, consumer], { encoding: "utf8" });
  assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);
  const typed = await import(pathToFileURL(join(buildRoot, "adapter-invocation-consumer.mjs")).href);

  const system = await setupInspectionSystem(t);
  const invoked = [];
  let typedOwnerFenceCalls = 0;
  const assertOwnerCurrent = system.ports.jobs.assertDispatchCurrent.bind(system.ports.jobs);
  const typedOwnerJobs = { assertDispatchCurrent(input) {
    typedOwnerFenceCalls += 1;
    return assertOwnerCurrent(input);
  } };
  system.ports.jobs.assertDispatchCurrent = (input) => typed.assertCurrentDispatch(typedOwnerJobs, input);
  const observer = system.ports.inspection.inspect;
  system.ports.inspection.inspect = async (input) => {
    await input.recordTransportAttempt(input.transport_attempt_id);
    const permit = await typed.revalidateInspection(input, canonicalHash(input.deterministic));
    assert.equal(permit, input.dispatch_intent_ref);
    invoked.push("observer");
    return observer({ ...input, recordTransportAttempt: async () => {} });
  };
  const decision = system.ports.decisionPort.execute;
  system.ports.decisionPort.execute = async (input) => {
    await input.recordTransportAttempt(input.transport_attempt_id);
    const permit = await typed.revalidateDecision(input, canonicalHash(input.request));
    assert.equal(permit, input.dispatch_intent_ref);
    const keys = Object.keys(input.request.questions);
    invoked.push(keys.includes("next_step") ? "decision_route"
      : keys.includes("layout_choice") ? "generic_decision" : "decision_evidence");
    return decision({ ...input, recordTransportAttempt: async () => {} });
  };

  const generate = request("typed-adapter-generate", await fixture("generate-plan"));
  generate.payload.decision_request = { execution_mode: "independent_batch", state: { text: "Choose the clearest layout." },
    questions: { layout_choice: { type: "choice", question_schema_version: "1.0", policy_version: "layout/1",
      instructions: "Choose one eligible layout.", criteria: { compact: "Compact", wide: "Wide" },
      eligible_candidate_ids: ["compact", "wide"],
      policy: { minimum_confidence: 0.5, low_confidence_action: "review" } } } };
  const generated = await system.api.invoke(actor(), generate);
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const inspected = await system.api.invoke(actor(), inspectionRequest("typed-adapter-inspect",
    generated.result.design_version.design_version_id));
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  assert.deepEqual(invoked.sort(), ["decision_evidence", "decision_route", "generic_decision", "observer"]);
  assert.ok(typedOwnerFenceCalls >= 5, "generated image plus every observer/decision stage uses the compiled owner callback");
});

test("compiled public session scope stays exact across begin, stages, completion, reopen, and replay", async (t) => {
  const buildRoot = await mkdtemp(join(tmpdir(), "creative-inspection-session-scope-"));
  t.after(async () => rm(buildRoot, { recursive: true, force: true }));
  const compiler = fileURLToPath(new URL("../../examples/frontend-action-roundtrip/node_modules/typescript/bin/tsc", import.meta.url));
  const consumer = fileURLToPath(new URL("../../tests/inspection/session-scope-consumer.mts", import.meta.url));
  const compile = spawnSync(process.execPath, [compiler, "--strict", "--skipLibCheck", "false", "--module", "NodeNext",
    "--moduleResolution", "NodeNext", "--target", "ES2022", "--rootDir", fileURLToPath(new URL("../../tests/inspection", import.meta.url)),
    "--outDir", buildRoot, consumer], { encoding: "utf8" });
  assert.equal(compile.status, 0, `${compile.stdout}\n${compile.stderr}`);
  const typed = await import(pathToFileURL(join(buildRoot, "session-scope-consumer.mjs")).href);

  const system = await setupInspectionSystem(t);
  const snapshots = [];
  const storage = system.ports.storage;
  const begin = storage.beginInspectionSession.bind(storage);
  storage.beginInspectionSession = async (input) => {
    const fresh = await begin(input);
    snapshots.push({ path: "begin:fresh", session: fresh });
    const replayed = await begin(input);
    snapshots.push({ path: "begin:existing", session: replayed });
    const { lease_token: _leaseToken, ...publicFresh } = fresh;
    assert.deepEqual(replayed, publicFresh, "an existing begin returns the same public scoped record while the job is active");
    return fresh;
  };
  const stage = storage.stageInspectionStage.bind(storage);
  storage.stageInspectionStage = async (input) => {
    const fresh = await stage(input);
    snapshots.push({ path: `stage:${input.stage}:new`, session: fresh });
    const replayed = await stage(input);
    snapshots.push({ path: `stage:${input.stage}:replay`, session: replayed });
    assert.deepEqual(replayed, fresh, "an already-staged attempt returns the same scoped record");
    return fresh;
  };

  const generated = await system.api.invoke(actor(), request("session-scope-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const body = inspectionRequest("session-scope-lifecycle", generated.result.design_version.design_version_id);
  const result = await system.api.invoke(actor(), body);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(system.counters.provider, 1);
  assert.equal(system.counters.reserved, 4);
  assert.equal(system.counters.inspection, 1);
  assert.equal(system.counters.decision, 2);

  const assertRecord = (record, path) => {
    assert.equal(typed.assertInspectionSessionScope(record, SCOPE), record, `${path} uses the public record contract`);
    assert.deepEqual(record.scope, SCOPE, `${path} returns the exact tenant/project/brief scope`);
    assert.equal(record.tenant_id, SCOPE.tenant_id, `${path} retains its flat tenant field`);
    assert.equal(record.project_id, SCOPE.project_id, `${path} retains its flat project field`);
    assert.equal(record.brief_id, SCOPE.brief_id, `${path} retains its flat brief field`);
    assert.equal(Object.isFrozen(record), true, `${path} record is immutable`);
    assert.equal(Object.isFrozen(record.scope), true, `${path} nested scope is immutable`);
    assert.equal(Reflect.set(record, "tenant_id", "caller-mutated"), false);
    assert.equal(Reflect.set(record, "project_id", "caller-mutated"), false);
    assert.equal(Reflect.set(record, "brief_id", "caller-mutated"), false);
    assert.deepEqual(record.scope, SCOPE, `${path} mutation attempts cannot change authoritative scope`);
  };

  assert.equal(snapshots.length, 8, "fresh/existing begin and fresh/replayed returns for all three stages are captured");
  assert.deepEqual(snapshots.map(({ path }) => path), [
    "begin:fresh", "begin:existing",
    "stage:observer:new", "stage:observer:replay",
    "stage:decision_evidence:new", "stage:decision_evidence:replay",
    "stage:decision_route:new", "stage:decision_route:replay",
  ]);
  for (const snapshot of snapshots) assertRecord(snapshot.session, snapshot.path);
  assert.ok(snapshots.every(({ session }) => session.status === "active"),
    "begin and stage returns retain the active-session status during execution");

  const completed = await typed.readInspectionSessionScope(system.ports.storage,
    { scope: SCOPE, action_id: body.action_id }, SCOPE);
  assertRecord(completed, "completed get");
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.stages.map(({ stage: name, status }) => [name, status]), [
    ["observer", "completed"], ["decision_evidence", "completed"], ["decision_route", "completed"],
  ]);

  const databasePath = join(system.root, "versions.sqlite");
  const objectRoot = join(system.root, "objects");
  system.store.close();
  const reopenedStore = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(() => reopenedStore.close());
  const reopenedCounters = { provider: 0, reserved: 0, inspection: 0, decision: 0 };
  const reopenedPorts = attachInspectionPorts(portsFor(reopenedStore, reopenedCounters,
    (() => { let id = 0; return () => `session-scope-reopen-port-${++id}`; })()), reopenedCounters);
  const reopenedApi = createCreativeApi({ ports: reopenedPorts, now: () => NOW,
    idFactory: (() => { let id = 0; return () => `session-scope-reopen-api-${++id}`; })() });
  const replay = await reopenedApi.invoke(actor(), body);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.deepEqual(reopenedCounters, { provider: 0, reserved: 0, inspection: 0, decision: 0 },
    "completed inspection replay after reopen adds no provider, metering, observer, or decision work");
  const reopened = await typed.readInspectionSessionScope(reopenedPorts.storage,
    { scope: SCOPE, action_id: body.action_id }, SCOPE);
  assertRecord(reopened, "reopened replay get");
  assert.deepEqual(reopened, completed, "reopened replay preserves the exact stored scope and session record");
});

test("inspection repair remains review-gated when trusted owner usage evidence is unavailable", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-inspection-unknown-owner-usage-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const counters = { provider: 0, reserved: 0, inspection: 0, decision: 0, estimates: 0 };
  let id = 0;
  const ports = attachInspectionPorts(portsFor(store, counters, () => `unknown-owner-port-${++id}`,
    { artifactBytes: Buffer.from(makePng(16, 16)) }), counters, { recommendRepair: true });
  const estimate = ports.inspection.estimateFixtureRepairCost;
  ports.inspection.estimateFixtureRepairCost = (...args) => {
    counters.estimates += 1;
    return estimate(...args);
  };
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `unknown-owner-api-${++id}` });
  const generated = await api.invoke(actor(), request("unknown-owner-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));

  delete ports.telemetry.usage_profile_authority;
  const inspectionAction = `unknown-owner-inspect-${generated.result.design_version.design_version_id}`;
  const inspection = await api.invoke(actor(), inspectionRequest(inspectionAction,
    generated.result.design_version.design_version_id));
  assert.equal(inspection.ok, true, JSON.stringify(inspection));
  assert.equal(inspection.result.report.limits.usage_completeness, "unknown");
  assert.ok(inspection.result.report.uncertainty.includes("unknown_cost"));
  const stagedUsage = store.db.prepare("SELECT result_json FROM creative_inspection_stages_v1 WHERE action_id=? ORDER BY stage")
    .all(inspectionAction).map((row) => JSON.parse(row.result_json).usage_completeness);
  assert.deepEqual(stagedUsage, ["unknown", "unknown", "unknown"]);

  const before = { provider: counters.provider, reserved: counters.reserved, estimates: counters.estimates };
  const repair = await api.invoke(actor(), await repairEditRequest("unknown-owner-repair",
    generated.result.design_version, canonicalHash(inspection.result.report), inspectionAction));
  assert.equal(repair.ok, false);
  assert.equal(repair.error.code, "unavailable", "repair validation fails closed at the missing owner usage evidence gate");
  assert.deepEqual({ provider: counters.provider, reserved: counters.reserved, estimates: counters.estimates }, before,
    "unknown usage cannot authorize an edit, reserve a repair attempt, or request a cost estimate");
});

test("mixed observer and DecisionPort owner usage remains incomplete across completion, reopen, replay, and repair validation", async (t) => {
  const cases = [
    { name: "unknown observer with known decisions", unknownStage: "observer",
      expected: ["unknown", "complete", "complete"] },
    { name: "known observer and route with unknown first decision", unknownStage: "first_decision",
      expected: ["complete", "unknown", "complete"] },
    { name: "all executed observer and decision stages unknown", unknownStage: "all",
      expected: ["unknown", "unknown", "unknown"] },
  ];
  for (const scenario of cases) await t.test(scenario.name, async (subtest) => {
    const root = await mkdtemp(join(tmpdir(), "creative-inspection-mixed-owner-usage-"));
    subtest.after(async () => rm(root, { recursive: true, force: true }));
    const databasePath = join(root, "versions.sqlite");
    const objectRoot = join(root, "objects");
    const storeOptions = { databasePath, objectRoot, now: () => NOW };
    let store = new CreativeVersionStore(storeOptions);
    subtest.after(() => store.close());
    const brief = await fixture("brief");
    store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
    const counters = { provider: 0, reserved: 0, inspection: 0, decision: 0, estimates: 0 };
    let id = 0;
    const makePorts = () => {
      const ports = attachInspectionPorts(portsFor(store, counters, () => `mixed-owner-port-${++id}`,
        { artifactBytes: Buffer.from(makePng(16, 16)) }),
        counters, { recommendRepair: true });
      const ownerMapper = ports.telemetry.usage_profile_authority.mapProviderUsage;
      let decisionCount = 0;
      ports.telemetry.usage_profile_authority = Object.freeze({ mapProviderUsage(input) {
        if (scenario.unknownStage === "all" ||
          scenario.unknownStage === "observer" && input.attempt.operation_kind === "vision_observation") {
          return { status: "unmapped" };
        }
        if (input.attempt.operation_kind === "jev_decision") {
          decisionCount += 1;
          if (scenario.unknownStage === "first_decision" && decisionCount === 1) return { status: "unmapped" };
        }
        return ownerMapper(input);
      } });
      const estimate = ports.inspection.estimateFixtureRepairCost;
      ports.inspection.estimateFixtureRepairCost = (...args) => {
        counters.estimates += 1;
        return estimate(...args);
      };
      return ports;
    };
    let ports = makePorts();
    let api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `mixed-owner-api-${++id}` });
    const generated = await api.invoke(actor(), request(`mixed-owner-seed-${scenario.unknownStage}`,
      await fixture("generate-plan")));
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const design = generated.result.design_version;
    const inspectBody = inspectionRequest(`mixed-owner-inspect-${scenario.unknownStage}`, design.design_version_id);
    const inspected = await api.invoke(actor(), inspectBody);
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    assert.equal(inspected.result.report.limits.usage_completeness, "unknown");
    assert.ok(inspected.result.report.uncertainty.includes("unknown_cost"));
    const storedStages = store.db.prepare(`SELECT stage,result_json FROM creative_inspection_stages_v1
      WHERE action_id=? ORDER BY CASE stage WHEN 'observer' THEN 0 WHEN 'decision_evidence' THEN 1 ELSE 2 END`)
      .all(inspectBody.action_id).map((row) => JSON.parse(row.result_json).usage_completeness);
    assert.deepEqual(storedStages, scenario.expected);
    const beforeReplay = { provider: counters.provider, reserved: counters.reserved,
      inspection: counters.inspection, decision: counters.decision };

    store.close();
    store = new CreativeVersionStore(storeOptions);
    ports = makePorts();
    api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `mixed-owner-reopen-api-${++id}` });
    const replay = await api.invoke(actor(), { ...inspectBody, event_id: `${inspectBody.event_id}-reopen`,
      request_id: `${inspectBody.request_id}-reopen`, correlation_id: `${inspectBody.correlation_id}-reopen` });
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, inspected.result,
      "reopen reconstructs the same stage-wise unknown-cost report without upgrading owner completeness");
    assert.deepEqual({ provider: counters.provider, reserved: counters.reserved,
      inspection: counters.inspection, decision: counters.decision }, beforeReplay);

    const beforeRepair = { provider: counters.provider, reserved: counters.reserved, estimates: counters.estimates };
    const repair = await api.invoke(actor(), await repairEditRequest(`mixed-owner-repair-${scenario.unknownStage}`,
      design, canonicalHash(inspected.result.report), inspectBody.action_id));
    assert.equal(repair.ok, false);
    assert.equal(repair.error.code, "unavailable",
      "one unknown executed owner stage blocks favorable repair authorization");
    assert.deepEqual({ provider: counters.provider, reserved: counters.reserved, estimates: counters.estimates }, beforeRepair,
      "repair validation does not reserve, dispatch, or request a fixture-cost estimate for mixed unknown usage");
  });
});

test("a repair claim's root deadline prevents a reservation after an awaited route lookup", async (t) => {
  let currentNow = NOW;
  const system = await setupInspectionSystem(t, { now: () => currentNow, recommendRepair: true });
  const { store, ports, counters, api } = system;
  const generated = await api.invoke(actor(), request("repair-route-deadline-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const design = generated.result.design_version;
  const inspectBody = inspectionRequest("repair-route-deadline-inspect", design.design_version_id);
  const inspected = await api.invoke(actor(), inspectBody);
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  const before = { reserved: counters.reserved, provider: counters.provider };
  const resolveRoute = ports.provider.resolveRoute;
  currentNow = NOW + 59_000;
  ports.provider.resolveRoute = async (input) => {
    const route = await resolveRoute(input);
    currentNow = NOW + 61_000;
    return route;
  };
  const body = await repairEditRequest("repair-route-deadline-edit", design,
    canonicalHash(inspected.result.report), inspectBody.action_id);
  const result = await api.invoke(actor(), body);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, "review_required");
  assert.deepEqual({ reserved: counters.reserved, provider: counters.provider }, before,
    "a route lookup that reaches the cumulative root deadline cannot reserve or dispatch the edit");
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions").get().count, 1);
  const state = await ports.storage.inspectionRepair.getState({ scope: { ...SCOPE,
    design_version_id: design.design_version_id }, inspection_id: inspected.result.inspection_id });
  assert.equal(state.repairs_used, 1, "the serialized root claim remains counted after the stopped attempt");
});

test("a repair claim's root deadline blocks the final send permit after the awaited post-ACK authorization", async (t) => {
  let currentNow = NOW;
  const system = await setupInspectionSystem(t, { now: () => currentNow, recommendRepair: true });
  const { store, ports, counters, api } = system;
  const generated = await api.invoke(actor(), request("repair-send-deadline-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const design = generated.result.design_version;
  const inspectBody = inspectionRequest("repair-send-deadline-inspect", design.design_version_id);
  const inspected = await api.invoke(actor(), inspectBody);
  assert.equal(inspected.ok, true, JSON.stringify(inspected));

  const before = { provider: counters.provider, reserved: counters.reserved,
    acknowledgments: counters.financeTransportIds.length };
  const authorize = ports.jobs.authorizeDispatch.bind(ports.jobs);
  const acknowledge = ports.metering.recordTransportAttempt.bind(ports.metering);
  const markUnknown = ports.metering.markOutcomeUnknown.bind(ports.metering);
  const release = ports.metering.releaseBeforeDispatch.bind(ports.metering);
  const edit = ports.provider.edit;
  let repairing = false;
  let acknowledged = false;
  let postAckAuthorizations = 0;
  let expiredAfterFinalAuthorization = false;
  let sendPermits = 0;
  let unknownHolds = 0;
  let releases = 0;
  ports.jobs.authorizeDispatch = async (input) => {
    const result = await authorize(input);
    if (repairing && acknowledged && input.context_fence?.inspection_repair) {
      postAckAuthorizations += 1;
      if (postAckAuthorizations === 3) {
        assert.equal(result.status, "authorized", "the real same-database authorization is valid at T+59s");
        currentNow = NOW + 61_000;
        expiredAfterFinalAuthorization = true;
      }
    }
    return result;
  };
  ports.metering.recordTransportAttempt = async (input) => {
    const result = await acknowledge(input);
    if (repairing) acknowledged = true;
    return result;
  };
  ports.metering.markOutcomeUnknown = async (...args) => {
    unknownHolds += 1;
    return markUnknown(...args);
  };
  ports.metering.releaseBeforeDispatch = async (...args) => {
    releases += 1;
    return release(...args);
  };
  ports.provider.edit = async (input) => {
    await input.recordTransportAttempt(input.transport_attempt_id);
    sendPermits += 1;
    return edit({ ...input, recordTransportAttempt: async () => {} });
  };

  currentNow = NOW + 59_000;
  repairing = true;
  const body = await repairEditRequest("repair-send-deadline-edit", design,
    canonicalHash(inspected.result.report), inspectBody.action_id);
  const result = await api.invoke(actor(), body);
  assert.equal(expiredAfterFinalAuthorization, true);
  assert.equal(postAckAuthorizations, 3);
  assert.equal(acknowledged, true, "C03 ACK remains recorded before the final root check");
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, "review_required");
  assert.equal(sendPermits, 0, "expired cumulative root authority never reaches the provider send permit");
  assert.equal(counters.provider, before.provider);
  assert.equal(counters.reserved, before.reserved + 1, "the single already-authorized repair reservation is retained");
  assert.equal(counters.financeTransportIds.length, before.acknowledgments + 1);
  assert.ok(unknownHolds >= 1, "the already-ACKed attempt remains held for reconciliation");
  assert.equal(releases, 0, "an ACKed attempt is never released as pre-dispatch work");
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions").get().count, 1);
  assert.equal(store.getCurrentDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id }).design_version_id,
    design.design_version_id, "the source design remains selected");
  const job = store.db.prepare("SELECT status,result_json FROM creative_jobs WHERE action_id=?").get(body.action_id);
  assert.notEqual(job.status, "completed");
  assert.equal(job.result_json, null);
  const claim = await ports.storage.inspectionRepair.getState({ scope: { ...SCOPE,
    design_version_id: design.design_version_id }, inspection_id: inspected.result.inspection_id });
  assert.equal(claim.repairs_used, 1, "the failed attempt remains included in cumulative root accounting");
  assert.equal(store.db.prepare(`SELECT status,result_hash FROM creative_inspection_action_v2 WHERE action_id=?`)
    .get(body.action_id).status, "claimed");
});

test("principal expiry during the queued repair read blocks the final send permit", async (t) => {
  let currentNow = NOW;
  const system = await setupInspectionSystem(t, { now: () => currentNow, recommendRepair: true });
  const { store, ports, counters, api } = system;
  const generated = await api.invoke(actor(), request("repair-queued-read-expiry-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const design = generated.result.design_version;
  const inspectBody = inspectionRequest("repair-queued-read-expiry-inspect", design.design_version_id);
  const inspected = await api.invoke(actor(), inspectBody);
  assert.equal(inspected.ok, true, JSON.stringify(inspected));

  const claimReadEntered = deferred();
  const releaseClaimRead = deferred();
  t.after(() => releaseClaimRead.resolve());
  const durableRepairPort = ports.storage.inspectionRepair;
  let acknowledged = false;
  let heldClaimRead = false;
  ports.storage.inspectionRepair = Object.freeze({
    ...durableRepairPort,
    async isClaimCurrent(input) {
      const result = await durableRepairPort.isClaimCurrent(input);
      if (acknowledged && !heldClaimRead) {
        heldClaimRead = true;
        claimReadEntered.resolve();
        await releaseClaimRead.promise;
      }
      return result;
    },
  });
  const recordTransportAttempt = ports.metering.recordTransportAttempt.bind(ports.metering);
  ports.metering.recordTransportAttempt = async (input) => {
    const result = await recordTransportAttempt(input);
    acknowledged = true;
    return result;
  };
  let providerSendPermits = 0;
  const edit = ports.provider.edit;
  ports.provider.edit = async (input) => {
    await input.recordTransportAttempt(input.transport_attempt_id);
    providerSendPermits += 1;
    return edit({ ...input, recordTransportAttempt: async () => {} });
  };

  currentNow = NOW + 29_000;
  const expiresAt = new Date(NOW + 30_000).toISOString();
  const body = await repairEditRequest("repair-queued-read-expiry-edit", design,
    canonicalHash(inspected.result.report), inspectBody.action_id);
  const before = { provider: counters.provider, reserved: counters.reserved,
    acknowledgments: counters.financeTransportIds.length };
  let pending;
  try {
    pending = api.invoke({ ...actor(), expires_at: expiresAt }, body);
    await claimReadEntered.promise;
    currentNow = NOW + 31_000;
    releaseClaimRead.resolve();
    const result = await pending;
    assert.equal(heldClaimRead, true, "the test holds the actual same-database repair proof read after C03 ACK");
    assert.equal(acknowledged, true, "the transport acknowledgment remains attributable before expiry is checked");
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "cancelled");
    assert.equal(providerSendPermits, 0, "expired principal authority never reaches the provider send permit");
    assert.equal(counters.provider, before.provider);
    assert.equal(counters.reserved, before.reserved + 1);
    assert.equal(counters.financeTransportIds.length, before.acknowledgments + 1);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions").get().count, 1);
    assert.equal(store.getCurrentDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id }).design_version_id,
      design.design_version_id);
  } finally {
    releaseClaimRead.resolve();
  }
});

test("repair outcome, immutable child, selection, and job result roll back when publication crosses the root deadline", async (t) => {
  let currentNow = NOW;
  const system = await setupInspectionSystem(t, { now: () => currentNow, recommendRepair: true });
  const { store, ports, counters, api } = system;
  const generated = await api.invoke(actor(), request("repair-publication-deadline-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const design = generated.result.design_version;
  const inspectBody = inspectionRequest("repair-publication-deadline-inspect", design.design_version_id);
  const inspected = await api.invoke(actor(), inspectBody);
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  currentNow = NOW + 59_000;
  const commit = ports.storage.commitPreparedDesignVersion;
  ports.storage.commitPreparedDesignVersion = async (...args) => {
    const result = await commit(...args);
    currentNow = NOW + 61_000;
    return result;
  };
  const body = await repairEditRequest("repair-publication-deadline-edit", design,
    canonicalHash(inspected.result.report), inspectBody.action_id);
  const result = await api.invoke(actor(), body);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, "stale_version");
  assert.equal(counters.provider, 2, "the already completed edit remains attributable");
  assert.equal(counters.reserved, 5);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions").get().count, 1,
    "prepared child metadata is rolled back with the late repair outcome");
  assert.equal(store.getCurrentDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id }).design_version_id,
    design.design_version_id, "selection remains on the source design");
  const job = store.db.prepare("SELECT status,result_json FROM creative_jobs WHERE action_id=?")
    .get(body.action_id);
  assert.notEqual(job.status, "completed");
  assert.equal(job.result_json, null);
  const action = store.db.prepare(`SELECT status,result_hash FROM creative_inspection_action_v2
    WHERE action_id=?`).get(body.action_id);
  assert.equal(action.status, "claimed", "the attempted outcome update rolls back in the same transaction");
  assert.equal(action.result_hash, null);
});

test("inspection stops after observer transport ACK when its owner permission proof expires before provider invocation", async (t) => {
  let currentNow = NOW;
  const system = await setupAssetBackedInspectionSystem(t, { now: () => currentNow,
    permissionStatusAfterGenerate: "granted" });
  const { store, ports, counters, api, design } = system;
  const verifier = ports.planning.assetPermissionVerifier.verifyAssetUse;
  ports.planning.assetPermissionVerifier.verifyAssetUse = async (input) => {
    const proof = await verifier(input);
    return { ...proof, checked_at: new Date(currentNow).toISOString(),
      expires_at: new Date(NOW + 1_000).toISOString() };
  };
  const recordTransportAttempt = ports.metering.recordTransportAttempt.bind(ports.metering);
  let inspectionAck = false;
  ports.metering.recordTransportAttempt = async (input) => {
    const result = await recordTransportAttempt(input);
    if (!inspectionAck) {
      inspectionAck = true;
      currentNow = NOW + 1_001;
    }
    return result;
  };
  let unknownHolds = 0;
  const markOutcomeUnknown = ports.metering.markOutcomeUnknown.bind(ports.metering);
  ports.metering.markOutcomeUnknown = async (...args) => {
    unknownHolds += 1;
    return markOutcomeUnknown(...args);
  };
  const before = { reserved: counters.reserved, provider: counters.provider };
  const acknowledgmentsBefore = counters.financeTransportIds.length;
  const body = inspectionRequest("inspection-owner-proof-expiry", design.design_version_id);
  body.payload.brief_id = system.brief.brief_id;
  const result = await api.invoke(actor(), body);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "permission_denied");
  assert.equal(counters.inspection, 0, "the expired proof blocks the observer call after transport acknowledgment");
  assert.equal(counters.decision ?? 0, 0, "expired owner rights block both dependent decision stages");
  assert.equal(counters.reserved, before.reserved + 1, "no dependent-stage reservation follows the expired proof");
  assert.equal(counters.provider, before.provider);
  assert.equal(counters.financeTransportIds.length, acknowledgmentsBefore + 1,
    "the authorized observer attempt has one C03 transport ACK that remains attributable");
  assert.ok(unknownHolds >= 1, "the already-acknowledged observer remains held for reconciliation");
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM creative_inspection_stages_v1 WHERE action_id=?")
    .get(body.action_id).count, 0, "an ACK without provider invocation cannot forge a completed stage");
  const session = store.db.prepare("SELECT status,result_json FROM creative_inspection_sessions_v1 WHERE action_id=?")
    .get(body.action_id);
  assert.equal(session.status, "active");
  assert.equal(session.result_json, null);
});

test("inspection carries expiring owner proofs through the final send fence for observer and both DecisionPort stages", async (t) => {
  const cases = [
    { stage: "observer", permittedBefore: [], expectedDecisionCalls: 0, expectedReserved: 1 },
    { stage: "decision_evidence", permittedBefore: ["observer"], expectedDecisionCalls: 0, expectedReserved: 2 },
    { stage: "decision_route", permittedBefore: ["observer", "decision_evidence"], expectedDecisionCalls: 1, expectedReserved: 3 },
  ];
  for (const scenario of cases) await t.test(scenario.stage, async (subtest) => {
    let currentNow = NOW;
    const system = await setupAssetBackedInspectionSystem(subtest, { now: () => currentNow,
      permissionStatusAfterGenerate: "granted" });
    const { store, ports, counters, api, design } = system;
    const verifier = ports.planning.assetPermissionVerifier.verifyAssetUse;
    ports.planning.assetPermissionVerifier.verifyAssetUse = async (input) => {
      const proof = await verifier(input);
      return { ...proof, checked_at: new Date(currentNow).toISOString(), expires_at: new Date(NOW + 1_000).toISOString() };
    };
    const authorize = ports.jobs.authorizeDispatch.bind(ports.jobs);
    const dispatchProofs = [];
    const permittedStages = [];
    let activeStage = null;
    let stageAuthorizations = 0;
    let expiredAfterFinalAuthorization = false;
    ports.jobs.authorizeDispatch = async (input) => {
      const result = await authorize(input);
      if (activeStage) {
        const proofs = input.context_fence?.inspection_rights?.proofs;
        dispatchProofs.push({ stage: activeStage, proofs: Array.isArray(proofs) ? proofs.map((proof) => ({
          asset_id: proof.asset_id, action: proof.action, content_hash: proof.content_hash,
          package_id: proof.package_id, package_hash: proof.package_hash, expires_at: proof.expires_at,
        })) : null });
        if (activeStage === scenario.stage) {
          stageAuthorizations += 1;
          if (stageAuthorizations === 2) {
            currentNow = NOW + 1_001;
            expiredAfterFinalAuthorization = true;
          }
        }
      }
      return result;
    };
    const observer = ports.inspection.inspect;
    ports.inspection.inspect = async (input) => {
      activeStage = "observer";
      try {
        await input.recordTransportAttempt(input.transport_attempt_id);
        permittedStages.push("observer");
        return await observer({ ...input, recordTransportAttempt: async () => {} });
      } finally { activeStage = null; }
    };
    const execute = ports.decisionPort.execute;
    ports.decisionPort.execute = async (input) => {
      const stage = Object.hasOwn(input.request.questions, "next_step") ? "decision_route" : "decision_evidence";
      activeStage = stage;
      try {
        await input.recordTransportAttempt(input.transport_attempt_id);
        permittedStages.push(stage);
        return await execute({ ...input, recordTransportAttempt: async () => {} });
      } finally { activeStage = null; }
    };
    const markUnknown = ports.metering.markOutcomeUnknown.bind(ports.metering);
    let unknownHolds = 0;
    ports.metering.markOutcomeUnknown = async (...args) => {
      unknownHolds += 1;
      return markUnknown(...args);
    };

    const beforeReserved = counters.reserved;
    const body = inspectionRequest(`inspection-final-proof-ttl-${scenario.stage}`, design.design_version_id);
    body.payload.brief_id = system.brief.brief_id;
    const result = await api.invoke(actor(), body);
    assert.equal(expiredAfterFinalAuthorization, true, "the TTL expires only after the final awaited job authorization returns");
    assert.equal(stageAuthorizations, 2, "both post-ACK job checks retain the proof before the final synchronous TTL fence");
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "permission_denied", JSON.stringify(result));
    assert.deepEqual(permittedStages, scenario.permittedBefore,
      "no stage receives its send permit once the retained owner proof has expired");
    assert.equal(counters.reserved, beforeReserved + scenario.expectedReserved,
      "only the observer and stages reached before the expired proof receive reservations");
    assert.equal(counters.decision, scenario.expectedDecisionCalls,
      "the expired stage is rejected before its DecisionPort provider executes");
    assert.ok(unknownHolds >= 1, "a transport ACK already issued for the blocked stage remains held for reconciliation");
    assert.ok(dispatchProofs.length >= 2);
    assert.ok(dispatchProofs.filter((item) => item.stage === scenario.stage).every((item) =>
      item.proofs?.length === 1 && item.proofs[0].expires_at === NOW + 1_000),
    "each final job authorization carries the verifier's exact proof expiry");
    const rows = store.db.prepare(`SELECT stage,status FROM creative_inspection_stages_v1 WHERE action_id=?
      ORDER BY CASE stage WHEN 'observer' THEN 0 WHEN 'decision_evidence' THEN 1 ELSE 2 END`)
      .all(body.action_id).map((row) => ({ ...row }));
    assert.deepEqual(rows.map((row) => row.status), [
      ...scenario.permittedBefore.map(() => "completed"), "dispatching",
    ], "the ACKed stage remains unresolved and is never completed with an expired permission proof");
    assert.equal(store.db.prepare("SELECT status FROM creative_inspection_sessions_v1 WHERE action_id=?")
      .get(body.action_id).status, "active");
  });
});

test("inspection rechecks current owner rights after the last dependent stage and before publishing a report", async (t) => {
  const system = await setupAssetBackedInspectionSystem(t, { permissionStatusAfterGenerate: "granted" });
  const { store, ports, counters, api, design, setPermissionStatus } = system;
  const completeStage = ports.storage.completeInspectionStage;
  ports.storage.completeInspectionStage = async (input, ...args) => {
    const result = await completeStage(input, ...args);
    if (input.stage === "decision_route") setPermissionStatus("denied");
    return result;
  };
  const body = inspectionRequest("inspection-owner-revocation-after-route", design.design_version_id);
  body.payload.brief_id = system.brief.brief_id;
  const result = await api.invoke(actor(), body);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "permission_denied");
  assert.equal(counters.inspection, 1);
  assert.equal(counters.decision, 2);
  assert.equal(counters.reserved, 4, "the current-rights recheck does not create a fourth inspection attempt");
  assert.deepEqual(store.db.prepare(`SELECT stage,status FROM creative_inspection_stages_v1
    WHERE action_id=? ORDER BY stage`).all(body.action_id).map((row) => ({ ...row })), [
    { stage: "decision_evidence", status: "completed" },
    { stage: "decision_route", status: "completed" },
    { stage: "observer", status: "completed" },
  ]);
  const session = store.db.prepare("SELECT status,result_json FROM creative_inspection_sessions_v1 WHERE action_id=?")
    .get(body.action_id);
  assert.equal(session.status, "active");
  assert.equal(session.result_json, null, "revoked rights cannot publish the otherwise completed report");
  assert.notEqual(store.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?").get(body.action_id).status,
    "completed");
});

test("the send-permit TTL fence runs after the last awaited owner job authorization for every inspection stage", async (t) => {
  const cases = [
    { stage: "observer", permittedBefore: [], expectedDecisionCalls: 0, expectedReserved: 1 },
    { stage: "decision_evidence", permittedBefore: ["observer"], expectedDecisionCalls: 0, expectedReserved: 2 },
    { stage: "decision_route", permittedBefore: ["observer", "decision_evidence"], expectedDecisionCalls: 1, expectedReserved: 3 },
  ];
  for (const scenario of cases) await t.test(scenario.stage, async (subtest) => {
    let currentNow = NOW;
    const system = await setupAssetBackedInspectionSystem(subtest, { now: () => currentNow,
      permissionStatusAfterGenerate: "granted" });
    const { store, ports, counters, api, design } = system;
    const verifier = ports.planning.assetPermissionVerifier.verifyAssetUse;
    ports.planning.assetPermissionVerifier.verifyAssetUse = async (input) => {
      const proof = await verifier(input);
      return { ...proof, checked_at: new Date(currentNow).toISOString(), expires_at: new Date(NOW + 1_000).toISOString() };
    };
    const authorize = ports.jobs.authorizeDispatch.bind(ports.jobs);
    const dispatchProofs = [];
    const permittedStages = [];
    let activeStage = null;
    let stageAuthorizations = 0;
    let expiredAfterFinalAuthorization = false;
    ports.jobs.authorizeDispatch = async (input) => {
      const result = await authorize(input);
      if (activeStage) {
        const proofs = input.context_fence?.inspection_rights?.proofs;
        dispatchProofs.push({ stage: activeStage, proofs: Array.isArray(proofs) ? proofs.map((proof) => ({
          asset_id: proof.asset_id, action: proof.action, content_hash: proof.content_hash,
          package_id: proof.package_id, package_hash: proof.package_hash, expires_at: proof.expires_at,
        })) : null });
        if (activeStage === scenario.stage) {
          stageAuthorizations += 1;
          if (stageAuthorizations === 2) {
            currentNow = NOW + 1_001;
            expiredAfterFinalAuthorization = true;
          }
        }
      }
      return result;
    };
    const observer = ports.inspection.inspect;
    ports.inspection.inspect = async (input) => {
      activeStage = "observer";
      try {
        await input.recordTransportAttempt(input.transport_attempt_id);
        permittedStages.push("observer");
        return await observer({ ...input, recordTransportAttempt: async () => {} });
      } finally { activeStage = null; }
    };
    const execute = ports.decisionPort.execute;
    ports.decisionPort.execute = async (input) => {
      const stage = Object.hasOwn(input.request.questions, "next_step") ? "decision_route" : "decision_evidence";
      activeStage = stage;
      try {
        await input.recordTransportAttempt(input.transport_attempt_id);
        permittedStages.push(stage);
        return await execute({ ...input, recordTransportAttempt: async () => {} });
      } finally { activeStage = null; }
    };
    const markUnknown = ports.metering.markOutcomeUnknown.bind(ports.metering);
    let unknownHolds = 0;
    ports.metering.markOutcomeUnknown = async (...args) => {
      unknownHolds += 1;
      return markUnknown(...args);
    };

    const beforeReserved = counters.reserved;
    const body = inspectionRequest(`inspection-final-proof-ttl-${scenario.stage}`, design.design_version_id);
    body.payload.brief_id = system.brief.brief_id;
    const result = await api.invoke(actor(), body);
    assert.equal(expiredAfterFinalAuthorization, true, "the TTL expires only after the final awaited job authorization returns");
    assert.equal(stageAuthorizations, 2, "both post-ACK job checks retain the proof before the final synchronous TTL fence");
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "permission_denied", JSON.stringify(result));
    assert.deepEqual(permittedStages, scenario.permittedBefore,
      "no stage receives its send permit once the retained owner proof has expired");
    assert.equal(counters.reserved, beforeReserved + scenario.expectedReserved,
      "only the observer and stages reached before the expired proof receive reservations");
    assert.equal(counters.decision, scenario.expectedDecisionCalls,
      "the expired stage is rejected before its DecisionPort provider executes");
    assert.ok(unknownHolds >= 1, "an already-ACKed attempt remains held for reconciliation");
    assert.ok(dispatchProofs.length >= 2);
    assert.ok(dispatchProofs.filter((item) => item.stage === scenario.stage).every((item) =>
      item.proofs?.length === 1 && item.proofs[0].expires_at === NOW + 1_000),
    `the final job authorizations carry the verifier's exact numeric expiry rather than a boolean grant: ${JSON.stringify(dispatchProofs)}`);
    const rows = store.db.prepare(`SELECT stage,status FROM creative_inspection_stages_v1 WHERE action_id=?
      ORDER BY CASE stage WHEN 'observer' THEN 0 WHEN 'decision_evidence' THEN 1 ELSE 2 END`)
      .all(body.action_id).map((row) => ({ ...row }));
    assert.deepEqual(rows.map((row) => row.status), [
      ...scenario.permittedBefore.map(() => "completed"), "dispatching",
    ], "the ACKed stage remains unresolved and cannot become trusted completed evidence");
    assert.equal(store.db.prepare("SELECT status FROM creative_inspection_sessions_v1 WHERE action_id=?")
      .get(body.action_id).status, "active");
  });
});

test("the same-connection publication CAS rejects an asset invalidation present after the final owner proof", async (t) => {
  const system = await setupAssetBackedInspectionSystem(t, { permissionStatusAfterGenerate: "granted" });
  const { store, ports, counters, api, design } = system;
  const research = await ports.planning.getCurrentResearchPackage({ scope: SCOPE });
  const asset = research.assets.items[0];
  const packageHash = canonicalHash(research);
  const completeIfActive = ports.jobs.completeIfActive;
  let insertedFence = false;
  ports.jobs.completeIfActive = async (input, publish) => {
    if (!insertedFence && input.operation === "inspect") {
      insertedFence = true;
      const eventId = "fixture-rights-revoked-at-publication";
      const eventHash = canonicalHash({ eventId, packageHash, assetId: asset.asset_id, contentHash: asset.content_hash });
      const idempotencyKey = canonicalHash({ eventId, eventHash });
      store.db.prepare(`INSERT INTO creative_invalidation_events
        (tenant_id,project_id,event_id,event_hash,idempotency_key,source_package_id,source_revision,evidence_json,receipt_id,receipt_json)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(SCOPE.tenant_id, SCOPE.project_id, eventId, eventHash, idempotencyKey,
          research.package_id, 1, canonicalSerialize({ fixture: "owner revocation at publication CAS" }),
          "fixture-owner-revocation-receipt", canonicalSerialize({ status: "accepted_fixture_event" }));
      store.db.prepare(`INSERT INTO creative_invalidation_fences
        (tenant_id,project_id,event_id,source_package_id,source_package_hash,kind,target_id,target_hash)
        VALUES (?,?,?,?,?,'asset',?,?)`).run(SCOPE.tenant_id, SCOPE.project_id, eventId, research.package_id,
          packageHash, asset.asset_id, asset.content_hash);
    }
    return completeIfActive(input, publish);
  };
  const body = inspectionRequest("inspection-owner-invalidation-publication-cas", design.design_version_id);
  body.payload.brief_id = system.brief.brief_id;
  const result = await api.invoke(actor(), body);
  assert.equal(insertedFence, true);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "stale_version");
  assert.equal(counters.inspection, 1);
  assert.equal(counters.decision, 2);
  assert.equal(counters.reserved, 4);
  const session = store.db.prepare("SELECT status,result_json FROM creative_inspection_sessions_v1 WHERE action_id=?")
    .get(body.action_id);
  assert.equal(session.status, "active");
  assert.equal(session.result_json, null, "the final CAS rolls back report completion after an asset fence appears");
  assert.equal(store.isAssetFenced({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    brief_id: system.brief.brief_id }, asset_id: asset.asset_id, content_hash: asset.content_hash }), true,
    "the independent invalidation fence remains durable while report publication is rejected");
});

test("the final report publication CAS rejects owner proofs that expire after the last authority read", async (t) => {
  let currentNow = NOW;
  const system = await setupAssetBackedInspectionSystem(t, { now: () => currentNow, permissionStatusAfterGenerate: "granted" });
  const { store, ports, counters, api, design } = system;
  const verify = ports.planning.assetPermissionVerifier.verifyAssetUse;
  ports.planning.assetPermissionVerifier.verifyAssetUse = async (input) => {
    const proof = await verify(input);
    return { ...proof, checked_at: new Date(currentNow).toISOString(), expires_at: new Date(NOW + 1_000).toISOString() };
  };
  const completeIfActive = ports.jobs.completeIfActive;
  let expiredAtPublication = false;
  ports.jobs.completeIfActive = async (input, publish) => {
    if (input.operation === "inspect") {
      currentNow = NOW + 1_001;
      expiredAtPublication = true;
    }
    return completeIfActive(input, publish);
  };
  const body = inspectionRequest("inspection-owner-proof-expiry-publication", design.design_version_id);
  body.payload.brief_id = system.brief.brief_id;
  const result = await api.invoke(actor(), body);
  assert.equal(expiredAtPublication, true);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "stale_version", JSON.stringify(result));
  assert.equal(counters.inspection, 1);
  assert.equal(counters.decision, 2);
  assert.equal(counters.reserved, 4);
  assert.deepEqual(store.db.prepare(`SELECT stage,status FROM creative_inspection_stages_v1 WHERE action_id=?
    ORDER BY stage`).all(body.action_id).map((row) => ({ ...row })).map((row) => row.status),
  ["completed", "completed", "completed"]);
  const session = store.db.prepare("SELECT status,result_json FROM creative_inspection_sessions_v1 WHERE action_id=?")
    .get(body.action_id);
  assert.equal(session.status, "active");
  assert.equal(session.result_json, null, "an expired final proof cannot complete the durable report graph");
  assert.notEqual(store.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?").get(body.action_id).status,
    "completed");
});

test("cancelled repair dispatch keeps its root claim and usage evidence but cannot publish a child", async (t) => {
  const system = await setupInspectionSystem(t, { recommendRepair: true });
  const { store, ports, counters, api } = system;
  const generated = await api.invoke(actor(), request("inspection-cancel-repair-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const design = generated.result.design_version;
  const inspectBody = inspectionRequest("inspection-cancel-repair-inspect", design.design_version_id);
  const inspected = await api.invoke(actor(), inspectBody);
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  const edit = ports.provider.edit;
  let signalEntered;
  const entered = new Promise((resolve) => { signalEntered = resolve; });
  let releaseProvider;
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  ports.provider.edit = async (input) => {
    await input.recordTransportAttempt(input.transport_attempt_id);
    signalEntered();
    await providerGate;
    return edit({ ...input, recordTransportAttempt: async () => {} });
  };
  const repairBody = await repairEditRequest("inspection-cancel-repair-edit", design,
    canonicalHash(inspected.result.report), inspectBody.action_id);
  const pending = api.invoke(actor(), repairBody);
  await entered;
  const job = store.db.prepare("SELECT job_id FROM creative_jobs WHERE action_id=?").get(repairBody.action_id);
  assert.ok(job?.job_id);
  const cancelBody = { ...request("inspection-cancel-repair-cancel", await fixture("generate-plan")),
    operation: "cancel", payload: { job_id: job.job_id } };
  const cancelled = await api.invoke(actor(), cancelBody);
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  assert.equal(cancelled.job.status, "cancelled");
  releaseProvider();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "cancelled");
  const jobRow = store.db.prepare(`SELECT status,result_json,attempt_evidence_json FROM creative_jobs WHERE action_id=?`)
    .get(repairBody.action_id);
  assert.equal(jobRow.status, "cancelled");
  assert.equal(jobRow.result_json, null);
  const usageRows = store.db.prepare(`SELECT billable_attempt_id,status,payload_json FROM
    creative_telemetry_observations_v1 WHERE logical_operation_id=?`).all(repairBody.action_id);
  assert.equal(usageRows.length, 1, "the completed provider response remains attributable after cancellation");
  assert.equal(usageRows[0].status, "delivered");
  const observedUsage = JSON.parse(usageRows[0].payload_json).observation;
  assert.equal(observedUsage.completeness, "partial",
    "cancellation prevents unconfirmed owner mapping from being treated as settled complete usage");
  assert.ok(observedUsage.missing_fields.includes("usage.dispatch_authorization_not_current"));
  assert.equal(observedUsage.transport_attempt_id, counters.providerTransportIds.at(-1));
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions WHERE creation_job_id=?")
    .get(job.job_id).count, 0);
  assert.equal(store.getCurrentDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id }).design_version_id,
    design.design_version_id);
  const repairAction = store.db.prepare(`SELECT status,result_hash FROM creative_inspection_action_v2 WHERE action_id=?`)
    .get(repairBody.action_id);
  assert.deepEqual({ ...repairAction }, { status: "claimed", result_hash: null },
    "cancellation leaves the cumulative root claim consumed without recording a publishable outcome");
  const rootState = await ports.storage.inspectionRepair.getState({ scope: { ...SCOPE,
    design_version_id: design.design_version_id }, inspection_id: inspected.result.inspection_id });
  assert.equal(rootState.repairs_used, 1);
  assert.equal(counters.reserved, 5, "cancellation does not retry or add a repair reservation");
});

test("repair output is held when its job lease expires after transport ACK but before the final publication", async (t) => {
  let currentNow = NOW;
  const system = await setupInspectionSystem(t, { now: () => currentNow, leaseDurationMs: 1_000,
    recommendRepair: true });
  const { store, ports, counters, api } = system;
  const generated = await api.invoke(actor(), request("inspection-lease-drift-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const design = generated.result.design_version;
  const inspectBody = inspectionRequest("inspection-lease-drift-inspect", design.design_version_id);
  const inspected = await api.invoke(actor(), inspectBody);
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  const edit = ports.provider.edit;
  ports.provider.edit = async (input) => {
    await input.recordTransportAttempt(input.transport_attempt_id);
    currentNow = NOW + 1_001;
    return edit({ ...input, recordTransportAttempt: async () => {} });
  };
  const body = await repairEditRequest("inspection-lease-drift-edit", design,
    canonicalHash(inspected.result.report), inspectBody.action_id);
  const before = { provider: counters.provider, reserved: counters.reserved };
  const result = await api.invoke(actor(), body);
  assert.equal(result.ok, false);
  assert.ok(["cancelled", "unavailable"].includes(result.error.code), JSON.stringify(result));
  assert.equal(counters.provider, before.provider + 1, "the authorized edit response is retained as usage evidence");
  assert.equal(counters.reserved, before.reserved + 1, "lease drift cannot trigger a retry reservation");
  const job = store.db.prepare("SELECT status,result_json FROM creative_jobs WHERE action_id=?").get(body.action_id);
  assert.notEqual(job.status, "completed");
  assert.equal(job.result_json, null);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions WHERE creation_job_id=(SELECT job_id FROM creative_jobs WHERE action_id=?)")
    .get(body.action_id).count, 0, "expired lease blocks immutable child publication");
  const rootState = await ports.storage.inspectionRepair.getState({ scope: { ...SCOPE,
    design_version_id: design.design_version_id }, inspection_id: inspected.result.inspection_id });
  assert.equal(rootState.repairs_used, 1, "the claim stays counted while the lease-lost result is not published");
  const usage = store.db.prepare(`SELECT status,payload_json FROM creative_telemetry_observations_v1
    WHERE logical_operation_id=?`).get(body.action_id);
  assert.ok(usage, "post-ACK usage remains durable for reconciliation");
  assert.equal(JSON.parse(usage.payload_json).observation.completeness, "partial");
});

test("concurrent actual API repair requests serialize against the shared two-repair root limit", async (t) => {
  const system = await setupInspectionSystem(t, { recommendRepair: true });
  const { store, ports, counters, api } = system;
  const generated = await api.invoke(actor(), request("inspection-concurrent-repair-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const design = generated.result.design_version;
  const inspectBody = inspectionRequest("inspection-concurrent-repair-inspect", design.design_version_id);
  const inspected = await api.invoke(actor(), inspectBody);
  assert.equal(inspected.ok, true, JSON.stringify(inspected));
  const requests = await Promise.all([
    repairEditRequest("inspection-concurrent-repair-a", design, canonicalHash(inspected.result.report), inspectBody.action_id),
    repairEditRequest("inspection-concurrent-repair-b", design, canonicalHash(inspected.result.report), inspectBody.action_id),
  ]);
  const before = { provider: counters.provider, reserved: counters.reserved };
  const responses = await Promise.all(requests.map((body) => api.invoke(actor(), body)));
  assert.ok(responses.every((response) => response.ok || ["stale_version", "review_required", "unavailable"]
    .includes(response.error?.code)), JSON.stringify(responses));
  const rootState = await ports.storage.inspectionRepair.getState({ scope: { ...SCOPE,
    design_version_id: design.design_version_id }, inspection_id: inspected.result.inspection_id });
  assert.ok(rootState.repairs_used <= 2);
  assert.ok(rootState.simulated_units_used <= 3);
  assert.ok(counters.provider - before.provider <= 2, "concurrent repair execution cannot exceed the cumulative root attempt cap");
  assert.ok(counters.reserved - before.reserved <= 2, "each claimed repair has at most one separately metered edit reservation");
  const claims = store.db.prepare(`SELECT action_id,status,simulated_units_milli FROM creative_inspection_action_v2
    WHERE inspection_id=? AND repair_action='image.edit' ORDER BY action_id`).all(inspected.result.inspection_id);
  assert.equal(claims.length, rootState.repairs_used);
  assert.ok(claims.length <= 2);
  assert.ok(claims.every((claim) => ["claimed", "recorded"].includes(claim.status)));
  assert.ok(claims.reduce((total, claim) => total + claim.simulated_units_milli, 0) <= 3_000);
});

test("CE09 acceptance case 1 blocks corrupt artifacts, revoked rights, and observer refusal before any favorable bypass", async (t) => {
  const corrupt = await setupInspectionSystem(t);
  const generated = await corrupt.api.invoke(actor(), request("case1-corrupt-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const digest = generated.result.design_version.artifact.content_hash.slice("sha256:".length);
  await unlink(join(corrupt.store.objectRoot, "objects", "sha256", digest.slice(0, 2), digest));
  const corrupted = await corrupt.api.invoke(actor(), inspectionRequest("case1-corrupt-inspect",
    generated.result.design_version.design_version_id));
  assert.equal(corrupted.ok, false);
  assert.ok(["failed", "unavailable"].includes(corrupted.error.code));
  assert.equal(corrupt.counters.inspection, 0);
  assert.equal(corrupt.counters.decision, 0);
  assert.equal(corrupt.counters.reserved, 1, "corrupt bytes stop before inspection or DecisionPort reservations");

  const revoked = await setupAssetBackedInspectionSystem(t);
  const revokedBody = inspectionRequest("case1-revoked-inspect", revoked.design.design_version_id);
  revokedBody.payload.brief_id = revoked.brief.brief_id;
  const denied = await revoked.api.invoke(actor(), revokedBody);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "permission_denied");
  assert.equal(revoked.counters.inspection, 0);
  assert.equal(revoked.counters.decision, 0);
  assert.equal(revoked.counters.reserved, 1, "revoked asset rights stop before model or repair dispatch");

  const refusal = await setupInspectionSystem(t, { recommendRepair: true });
  const refusalSeed = await refusal.api.invoke(actor(), request("case1-refusal-seed", await fixture("generate-plan")));
  assert.equal(refusalSeed.ok, true, JSON.stringify(refusalSeed));
  refusal.ports.inspection.inspect = async (input) => {
    refusal.counters.inspection += 1;
    await input.recordTransportAttempt(input.transport_attempt_id);
    return { status: "refusal", usage: { completeness: "unknown", missing_fields: ["usage_unavailable"] } };
  };
  const refused = await refusal.api.invoke(actor(), inspectionRequest("case1-observer-refusal",
    refusalSeed.result.design_version.design_version_id));
  assert.equal(refused.ok, false);
  assert.ok(["failed", "unavailable"].includes(refused.error.code));
  assert.equal(refusal.counters.inspection, 1);
  assert.equal(refusal.counters.decision, 0, "a refusal cannot be overruled by JEV");
  assert.equal(refusal.counters.provider, 1, "a refusal cannot launch a repair image edit");
});

test("CE09 acceptance case 2 executes all seven labeled fixture buckets through the durable public API", async (t) => {
  const manifest = JSON.parse(await readFile(new URL("../../fixtures/inspection/manifest.json", import.meta.url), "utf8"));
  const expectedBuckets = ["corrupt_integrity", "revoked_permission", "valid_unchanged", "wrong_subject",
    "mask_drift", "poor_result", "adversarial_observation"];
  assert.deepEqual(manifest.buckets.map((bucket) => bucket.id), expectedBuckets);
  for (const bucket of manifest.buckets) {
    await t.test(bucket.id, async (subtest) => {
      if (bucket.id === "revoked_permission") {
        const system = await setupAssetBackedInspectionSystem(subtest);
        const body = inspectionRequest(`bucket-${bucket.id}`, system.design.design_version_id);
        body.payload.brief_id = system.brief.brief_id;
        const result = await system.api.invoke(actor(), body);
        assert.equal(result.ok, false);
        assert.equal(result.error.code, "permission_denied");
        assert.equal(system.counters.inspection, 0);
        assert.equal(system.counters.decision, 0);
        return;
      }
      const system = await setupInspectionSystem(subtest, {
        ...(bucket.id === "corrupt_integrity" ? { artifactBytes: corruptPngCrc(makePng(16, 16)) } : {}),
        recommendRepair: bucket.id !== "valid_unchanged",
        ...(bucket.id === "valid_unchanged" ? { decisionDefectProbability: 0.1, decisionQualityScore: 3.5 } : {}) });
      const generated = await system.api.invoke(actor(), request(`bucket-seed-${bucket.id}`, await fixture("generate-plan")));
      assert.equal(generated.ok, true, JSON.stringify(generated));
      const design = generated.result.design_version;
      if (bucket.id === "corrupt_integrity") {
        const result = await system.api.invoke(actor(), inspectionRequest(`bucket-${bucket.id}`, design.design_version_id));
        assert.equal(result.ok, true, JSON.stringify(result));
        assert.equal(result.result.report.outcome, "failure");
        assert.equal(system.counters.inspection, 0);
        assert.equal(system.counters.decision, 0);
      } else {
        const inspect = system.ports.inspection.inspect;
        system.ports.inspection.inspect = async (input) => {
          const raw = await inspect(input);
          if (bucket.id === "valid_unchanged") return { ...raw, findings: [] };
          if (bucket.id === "wrong_subject") return { ...raw, design_version_id: "design-for-another-subject" };
          if (bucket.id === "mask_drift") return { ...raw, findings: [{ code: "mask_drift", status: "present",
            severity: "high", confidence: 0.95 }] };
          if (bucket.id === "poor_result") return { ...raw, findings: [{ code: "other_visual_defect", status: "present",
            severity: "critical", confidence: 0.99 }] };
          if (bucket.id === "adversarial_observation") return { ...raw, instructions: bucket.fixture.injection };
          return raw;
        };
        const result = await system.api.invoke(actor(), inspectionRequest(`bucket-${bucket.id}`, design.design_version_id));
        if (bucket.id === "valid_unchanged") {
          assert.equal(result.ok, true, JSON.stringify(result));
          assert.equal(result.result.report.outcome, "acceptable_for_review");
          assert.equal(Object.hasOwn(result.result.report, "approved"), false);
        } else if (bucket.id === "mask_drift" || bucket.id === "poor_result") {
          assert.equal(result.ok, true, JSON.stringify(result));
          assert.equal(result.result.report.outcome, "bounded_repair_recommended");
          assert.equal(result.result.report.recommendation, "image.edit");
          assert.equal(system.counters.provider, 1, "a recommendation does not itself dispatch the edit provider");
        } else {
          assert.equal(result.ok, false, JSON.stringify(result));
          assert.ok(["failed", "unavailable"].includes(result.error.code));
          assert.equal(system.counters.decision, 0, "unbound or injected observer output cannot reach DecisionPort");
        }
      }
      const expectedSessions = 1;
      assert.equal(system.store.db.prepare("SELECT count(*) AS count FROM creative_inspection_sessions_v1").get().count,
        expectedSessions);
    });
  }
});

test("CE09 acceptance case 3 rejects malformed DecisionPort confidence without authorizing a repair", async (t) => {
  const system = await setupInspectionSystem(t, { recommendRepair: true });
  const generated = await system.api.invoke(actor(), request("case3-malformed-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const execute = system.ports.decisionPort.execute;
  system.ports.decisionPort.execute = async (input) => {
    const result = structuredClone(await execute(input));
    result.answers.defect_present.answer.confidence = 0.99;
    return result;
  };
  const before = { provider: system.counters.provider, reserved: system.counters.reserved };
  const inspected = await system.api.invoke(actor(), inspectionRequest("case3-malformed-confidence",
    generated.result.design_version.design_version_id));
  assert.equal(inspected.ok, false);
  assert.ok(["failed", "unavailable", "review_required"].includes(inspected.error.code));
  assert.equal(system.counters.inspection, 1);
  assert.equal(system.counters.decision, 1);
  assert.equal(system.counters.provider, before.provider, "malformed decision output cannot dispatch an image edit");
  assert.equal(system.counters.reserved, before.reserved + 2, "only observer and malformed first decision are reserved");
  assert.equal(system.store.db.prepare("SELECT count(*) AS count FROM creative_inspection_stages_v1 WHERE status='completed'")
    .get().count, 1, "the malformed stage is not completed or reused as trusted provenance");
});

test("the public inspection API fails closed on malformed, unsupported, or foreign DecisionPort results and reviews valid abstentions/timeouts", async (t) => {
  const cases = [
    { name: "malformed missing answer", mode: "missing_answer", expectedDecisionCalls: 1, expectedReservations: 2, validTerminal: false },
    { name: "unsupported model policy version", mode: "wrong_version", expectedDecisionCalls: 1, expectedReservations: 2, validTerminal: false },
    { name: "foreign tenant result", mode: "foreign_tenant", expectedDecisionCalls: 1, expectedReservations: 2, validTerminal: false },
    { name: "first stage abstention", mode: "first_review", expectedDecisionCalls: 1, expectedReservations: 2, validTerminal: true },
    { name: "first stage timeout", mode: "first_timeout", expectedDecisionCalls: 1, expectedReservations: 2, validTerminal: true },
    { name: "dependent route timeout", mode: "route_timeout", expectedDecisionCalls: 2, expectedReservations: 3, validTerminal: true },
  ];
  for (const scenario of cases) await t.test(scenario.name, async (subtest) => {
    const system = await setupInspectionSystem(subtest, { recommendRepair: true });
    const generated = await system.api.invoke(actor(), request(`decision-matrix-seed-${scenario.mode}`,
      await fixture("generate-plan")));
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const execute = system.ports.decisionPort.execute;
    system.ports.decisionPort.execute = async (input) => {
      const result = structuredClone(await execute(input));
      const call = system.counters.decision;
      if (scenario.mode === "missing_answer" && call === 1) {
        delete result.answers.defect_present;
      } else if (scenario.mode === "wrong_version" && call === 1) {
        result.model_policy_version = "unsupported/decision-policy";
      } else if (scenario.mode === "foreign_tenant" && call === 1) {
        result.tenant_id = "tenant-foreign-result";
      } else if (scenario.mode === "first_review" && call === 1) {
        const [key, question] = Object.entries(input.request.questions)[0];
        result.status = "review";
        result.answers[key] = { status: "abstain", question_schema_version: question.question_schema_version,
          policy_version: question.policy_version, reason: "fixture human review required" };
      } else if ((scenario.mode === "first_timeout" && call === 1) ||
        (scenario.mode === "route_timeout" && call === 2)) {
        result.status = "timeout";
        result.answers = Object.fromEntries(Object.entries(input.request.questions).map(([key, question]) => [key, {
          status: "unavailable", question_schema_version: question.question_schema_version,
          policy_version: question.policy_version, reason: "fixture timeout",
        }]));
        result.error = { code: "timeout", retryable: true, fallback: "review",
          user_message: "The fixture DecisionPort timed out." };
      }
      return result;
    };
    const before = { provider: system.counters.provider, reserved: system.counters.reserved };
    const body = inspectionRequest(`decision-matrix-inspect-${scenario.mode}`,
      generated.result.design_version.design_version_id);
    const inspected = await system.api.invoke(actor(), body);
    assert.equal(system.counters.inspection, 1);
    assert.equal(system.counters.decision, scenario.expectedDecisionCalls);
    assert.equal(system.counters.reserved, before.reserved + scenario.expectedReservations,
      "only the observer and actually executed decision stages receive separate C03 reservations");
    assert.equal(system.counters.provider, before.provider,
      "DecisionPort findings, abstentions, and failures never invoke image repair automatically");
    const stageRows = system.store.db.prepare(`SELECT stage,status FROM creative_inspection_stages_v1
      WHERE action_id=? ORDER BY CASE stage WHEN 'observer' THEN 0 WHEN 'decision_evidence' THEN 1 ELSE 2 END`)
      .all(body.action_id).map((row) => ({ ...row }));
    if (scenario.validTerminal) {
      assert.equal(inspected.ok, true, JSON.stringify(inspected));
      assert.equal(inspected.result.report.outcome, "needs_human_review");
      assert.equal(inspected.result.report.recommendation, "human_review");
      assert.equal(Object.hasOwn(inspected.result.report, "approved"), false);
      assert.equal(system.store.db.prepare("SELECT status FROM creative_inspection_sessions_v1 WHERE action_id=?")
        .get(body.action_id).status, "completed");
      assert.deepEqual(stageRows.map((row) => row.status), Array(scenario.expectedDecisionCalls + 1).fill("completed"));
    } else {
      assert.equal(inspected.ok, false);
      assert.ok(["failed", "unavailable", "review_required", "unsupported_version", "scope_denied"]
        .includes(inspected.error.code), JSON.stringify(inspected));
      assert.deepEqual(stageRows, [{ stage: "observer", status: "completed" },
        { stage: "decision_evidence", status: "dispatching" }],
        "an invalid or foreign DecisionPort result remains unresolved and cannot become trusted provenance");
      assert.equal(system.store.db.prepare("SELECT status FROM creative_inspection_sessions_v1 WHERE action_id=?")
        .get(body.action_id).status, "active");
      assert.notEqual(system.store.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?")
        .get(body.action_id).status, "completed");
    }
  });
});

test("CE09 acceptance case 5 keeps favorable API reports review-only without approval or certification", async (t) => {
  const system = await setupInspectionSystem(t, { decisionDefectProbability: 0.1, decisionQualityScore: 3.5 });
  const generated = await system.api.invoke(actor(), request("case5-review-only-seed", await fixture("generate-plan")));
  assert.equal(generated.ok, true, JSON.stringify(generated));
  const observe = system.ports.inspection.inspect;
  system.ports.inspection.inspect = async (input) => ({ ...await observe(input), findings: [] });
  const result = await system.api.invoke(actor(), inspectionRequest("case5-review-only", generated.result.design_version.design_version_id));
  assert.equal(result.ok, true, JSON.stringify(result));
  const report = result.result.report;
  assert.equal(report.outcome, "acceptable_for_review");
  assert.equal(Object.hasOwn(report, "approved"), false);
  assert.equal(Object.hasOwn(report, "legal_compliance_certified"), false);
  assert.equal(Object.hasOwn(report, "print_ready_certified"), false);
  assert.ok(report.limitations.some((item) => /not customer approval/i.test(item)));
});

test("CE09 acceptance case 6 calculates held-out error rates, latency and unknown total cost from API reports", async (t) => {
  const manifest = JSON.parse(await readFile(new URL("../../fixtures/inspection/manifest.json", import.meta.url), "utf8"));
  const reports = [];
  for (const [label, finding] of [["valid", null], ["defect", "other_visual_defect"]]) {
    const system = await setupInspectionSystem(t, { recommendRepair: finding !== null,
      ...(finding === null ? { decisionDefectProbability: 0.1, decisionQualityScore: 3.5 } : {}) });
    const generated = await system.api.invoke(actor(), request(`case6-${label}-seed`, await fixture("generate-plan")));
    assert.equal(generated.ok, true, JSON.stringify(generated));
    const observe = system.ports.inspection.inspect;
    system.ports.inspection.inspect = async (input) => ({ ...await observe(input), findings: finding ? [{ code: finding,
      status: "present", severity: "critical", confidence: 0.99 }] : [] });
    const start = Date.now();
    const inspected = await system.api.invoke(actor(), inspectionRequest(`case6-${label}-inspect`,
      generated.result.design_version.design_version_id));
    const latency = Math.max(0, Date.now() - start);
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    reports.push({ report: inspected.result.report, latency_ms: latency });
  }
  const metrics = evaluateHeldOutFixtures({ schema_version: "1.0", corpus_hash: manifest.buckets[0].fixture_hash,
    cases: [
      { expected_defect: true, predicted_defect: false, report: reports[0].report, latency_ms: reports[0].latency_ms,
        downstream_cost: { status: "unknown" } },
      { expected_defect: false, predicted_defect: true, report: reports[1].report, latency_ms: reports[1].latency_ms,
        downstream_cost: { status: "unknown" } },
      { expected_defect: null, predicted_defect: null, report: reports[0].report, latency_ms: reports[0].latency_ms,
        downstream_cost: { status: "unknown" } },
    ] });
  assert.equal(metrics.sample_count, 3);
  assert.equal(metrics.defect_false_negatives, 1);
  assert.equal(metrics.valid_output_false_repairs, 1);
  assert.equal(metrics.unknown_label_count, 1);
  assert.ok(metrics.latency_ms.p50 >= 0);
  assert.equal(metrics.downstream_cost.status, "unknown", "the mock fixture does not claim full Finance cost");
  assert.equal(metrics.promotion_status, "not_promoted");
});

test("populated BASE4e v4 database migrates to v13 and replays historical generation, edit, and inspection after restart", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-base4e-v4-migration-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const fixtureRoot = new URL("../../fixtures/versions/base4-populated-v4/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", fixtureRoot), "utf8"));
  const databaseBytes = await readFile(new URL("creative.sqlite", fixtureRoot));
  const requests = JSON.parse(await readFile(new URL("requests.json", fixtureRoot), "utf8"));
  const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(manifest.base_commit, "4e28839ea8baeb4112a4f12340ef2fe84f5c8efe");
  assert.equal(manifest.storage_user_version, 4);
  assert.equal(sha256(databaseBytes), manifest.database_sha256);
  assert.equal(sha256(Buffer.from(JSON.stringify(requests, null, 2) + "\n")), manifest.requests_sha256);
  assert.equal(requests.artifact_sha256, manifest.artifact_sha256);
  assert.equal(sha256(Buffer.from("durable exact artwork bytes")), manifest.artifact_sha256);
  const databasePath = join(root, "versions.sqlite");
  const objectRoot = join(root, "objects");
  await cp(new URL("creative.sqlite", fixtureRoot), databasePath);
  await cp(new URL("objects", fixtureRoot), objectRoot, { recursive: true });

  const baseline = new DatabaseSync(databasePath);
  assert.equal(baseline.prepare("PRAGMA user_version").get().user_version, 4);
  assert.deepEqual(baseline.prepare("SELECT action_id,operation,status FROM creative_jobs ORDER BY operation").all()
    .map((row) => ({ ...row })), [
    { action_id: "base4-edit-action", operation: "edit", status: "completed" },
    { action_id: "base4-generate-action", operation: "generate", status: "completed" },
    { action_id: "base4-inspect-action", operation: "inspect", status: "completed" },
  ]);
  const v4DispatchColumns = baseline.prepare("PRAGMA table_info(creative_dispatch_intents)").all().map((column) => column.name);
  for (const column of ["reservation_ref", "provider_name", "provider_model"]) assert.equal(v4DispatchColumns.includes(column), false);
  assert.equal(baseline.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='private_provider_attributions'").get(), undefined);
  baseline.close();

  let migrated = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  assert.equal(migrated.db.prepare("PRAGMA user_version").get().user_version, 13);
  const v7DispatchColumns = migrated.db.prepare("PRAGMA table_info(creative_dispatch_intents)").all().map((column) => column.name);
  for (const column of ["reservation_ref", "provider_name", "provider_model"]) assert.equal(v7DispatchColumns.includes(column), true);
  assert.ok(migrated.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='private_provider_attributions'").get());
  for (const designVersionId of [requests.expected_generate_design_version_id, requests.expected_edit_design_version_id]) {
    const design = migrated.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id, design_version_id: designVersionId });
    assert.ok(design, designVersionId);
    assert.deepEqual(Buffer.from(await migrated.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
      design_version_id: designVersionId })), Buffer.from("durable exact artwork bytes"));
  }
  assert.equal(migrated.db.prepare("SELECT COUNT(*) AS count FROM creative_jobs WHERE status='completed'").get().count, 3);
  migrated.close();

  migrated = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(() => migrated.close());
  assert.equal(migrated.db.prepare("PRAGMA user_version").get().user_version, 13);
  const counters = { provider: 0, reserved: 0, inspection: 0 };
  let id = 0;
  const ports = portsFor(migrated, counters, () => `base4-replay-port-${++id}`);
  ports.inspection = {
    resolveRoute: () => ({ retry_mapping_ref: "retry:fixture/1", provider: { name: "fixture-provider", model: "fixture-model",
      endpoint: "test:/vision", sdk: { name: "fixture-sdk", version: "1.0" } } }),
    async inspect() { counters.inspection += 1; throw new Error("historical inspection replay must not dispatch"); },
  };
  const api = createCreativeApi({ ports,
    now: () => NOW, idFactory: () => `base4-replay-api-${++id}` });
  const generatedReplay = await api.invoke(actor(), requests.generate_request);
  assert.equal(generatedReplay.ok, true, JSON.stringify(generatedReplay));
  assert.equal(generatedReplay.replayed, true);
  assert.equal(generatedReplay.result.design_version.design_version_id, requests.expected_generate_design_version_id);
  const editedReplay = await api.invoke(actor(), requests.edit_request);
  assert.equal(editedReplay.ok, true, JSON.stringify(editedReplay));
  assert.equal(editedReplay.replayed, true);
  assert.equal(editedReplay.result.design_version.design_version_id, requests.expected_edit_design_version_id);
  const inspectedReplay = await api.invoke(actor(), requests.inspect_request);
  assert.equal(inspectedReplay.ok, true, JSON.stringify(inspectedReplay));
  assert.equal(inspectedReplay.replayed, true);
  assert.equal(inspectedReplay.result.design_version_id, requests.expected_inspection_design_version_id);
  assert.equal(counters.provider, 0, "historical replay after migration must not redispatch generation or edit");
  assert.equal(counters.inspection, 0, "historical inspection replay after migration must not inspect again");
  assert.equal(counters.reserved, 0, "historical replay after migration must not create reservations");
});

test("outcome append failure is durably staged and replayed as pending without another provider attempt", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-pending-outcome-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, "versions.sqlite");
  const objectRoot = join(root, "objects");
  const store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `pending-outcome-port-${++id}`);
  const durableOutbox = ports.telemetry.outbox;
  ports.telemetry.outbox = Object.freeze({
    ...durableOutbox,
    async append(event) {
      if (event.event_type === "attempt_outcome") throw new Error("synthetic single-append failure");
      return durableOutbox.append(event);
    },
  });
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `pending-outcome-api-${++id}` });
  const body = request("pending-outcome-action", await fixture("generate-plan"));
  const result = await api.invoke(actor(), body);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.telemetry_evidence.local_status, "pending");
  assert.equal(result.result.telemetry_evidence.pending_event_staged, true);
  assert.equal(typeof result.result.telemetry_evidence.pending_event_id, "string");
  assert.equal("pending_event" in result.result.telemetry_evidence, false);
  assert.equal(counters.provider, 1);
  assert.equal(counters.reserved, 1);
  const eventRows = store.db.prepare("SELECT event_id,event_type,status FROM creative_telemetry_evidence_outbox_v1 ORDER BY rowid").all();
  assert.deepEqual(eventRows.map((row) => row.event_type), ["attempt_intent", "transport_intent", "attempt_outcome"]);
  assert.ok(eventRows.every((row) => row.status === "pending"));
  assert.equal(eventRows[2].event_id, result.result.telemetry_evidence.pending_event_id);

  store.close();
  const reopened = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(() => reopened.close());
  const replayApi = createCreativeApi({ ports: portsFor(reopened, counters, () => `pending-outcome-replay-${++id}`),
    now: () => NOW, idFactory: () => `pending-outcome-replay-api-${++id}` });
  const replay = await replayApi.invoke(actor(), { ...body, event_id: "pending-outcome-replay-event",
    request_id: "pending-outcome-replay-request", correlation_id: "pending-outcome-replay-correlation" });
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.telemetry_evidence.local_status, "pending");
  assert.equal(replay.result.telemetry_evidence.pending_event_id, result.result.telemetry_evidence.pending_event_id);
  assert.equal(replay.result.telemetry_evidence.pending_event_staged, true);
  assert.equal(counters.provider, 1, "replay must not redispatch after staging the outcome");
  assert.equal(counters.reserved, 1, "replay must not allocate another reservation");
  const claims = await createSqliteTelemetryOutbox({ database: reopened.db, clock: () => NOW })
    .claimPendingEvidence({ limit: 3 });
  assert.ok(claims.records.some((record) => record.event.event_type === "attempt_outcome" &&
    record.event.event_id === result.result.telemetry_evidence.pending_event_id));
});

test("final Finance transport acknowledgement is followed by an atomic active-lease fence before provider dispatch", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-transport-ack-expiry-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  let now = NOW;
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => now });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `transport-ack-expiry-port-${++id}`, { leaseDurationMs: 1_000 });
  const recordTransportAttempt = ports.metering.recordTransportAttempt;
  let unknownOutcomes = 0;
  const markOutcomeUnknown = ports.metering.markOutcomeUnknown;
  ports.metering.recordTransportAttempt = async (input) => {
    const ack = await recordTransportAttempt(input);
    now = NOW + 120_000;
    return ack;
  };
  ports.metering.markOutcomeUnknown = async (...args) => {
    unknownOutcomes += 1;
    return markOutcomeUnknown(...args);
  };
  const api = createCreativeApi({ ports, now: () => now, idFactory: () => `transport-ack-expiry-api-${++id}` });
  const result = await api.invoke(actor(), request("transport-ack-expiry", await fixture("generate-plan")));
  assert.equal(result.ok, false);
  assert.equal(counters.provider, 0, "expired lease after Finance ACK must prevent provider transport");
  assert.equal(counters.reserved, 1);
  assert.equal(unknownOutcomes, 1, "uncertain in-flight Finance state remains held for reconciliation");
  assert.equal(store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
});

test("cached transport identity rechecks the current job lease without repeating the Finance ACK", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-cached-transport-expiry-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  let now = NOW;
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => now });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const counters = { provider: 0, reserved: 0, mockPost: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `cached-transport-port-${++id}`, { leaseDurationMs: 1_000 });
  const generate = ports.provider.generate;
  ports.provider.generate = async (input) => {
    await Promise.resolve();
    now = NOW + 120_000;
    await input.recordTransportAttempt(input.transport_attempt_id);
    counters.mockPost += 1;
    return generate({ ...input, recordTransportAttempt: async () => input.dispatch_intent_ref });
  };
  const recordTransport = ports.metering.recordTransportAttempt;
  ports.metering.recordTransportAttempt = async (input) => {
    counters.financeTransportAcks = (counters.financeTransportAcks ?? 0) + 1;
    return recordTransport(input);
  };
  const api = createCreativeApi({ ports, now: () => now, idFactory: () => `cached-transport-api-${++id}` });
  const result = await api.invoke(actor(), request("cached-transport-expiry", await fixture("generate-plan")));
  assert.equal(result.ok, false);
  assert.equal(counters.reserved, 1);
  assert.equal(counters.financeTransportAcks, 1, "cached transport must not repeat Finance's ACK");
  assert.equal(counters.mockPost, 0, "expired lease on cached ID must stop transport before its side effect");
  assert.equal(counters.provider, 0);
  assert.equal(store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
});

test("cached transport identity is rechecked against changed brief context and persisted cancellation", async (t) => {
  for (const change of ["brief", "cancel"]) {
    const root = await mkdtemp(join(tmpdir(), `creative-version-api-cached-transport-${change}-`));
    t.after(async () => rm(root, { recursive: true, force: true }));
    const brief = await fixture("brief");
    const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
      objectRoot: join(root, "objects"), now: () => NOW });
    t.after(() => store.close());
    store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
    const counters = { provider: 0, reserved: 0, mockPost: 0, financeTransportAcks: 0 };
    let id = 0;
    const ports = portsFor(store, counters, () => `cached-${change}-port-${++id}`);
    const recordTransport = ports.metering.recordTransportAttempt;
    ports.metering.recordTransportAttempt = async (input) => {
      counters.financeTransportAcks += 1;
      return recordTransport(input);
    };
    let nestedCancel;
    let startedJobId;
    const generate = ports.provider.generate;
    let api;
    ports.provider.generate = async (input) => {
      startedJobId = input.job_id;
      if (change === "brief") {
        const updated = structuredClone(brief);
        updated.facts.verified[0].value = "Changed after the first transport intent";
        const saved = store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id },
          brief: updated, expected_brief_hash: canonicalHash(brief) });
        assert.equal(saved.status, "saved");
      } else {
        const body = { ...request("cancel-during-cached-transport", await fixture("generate-plan")),
          operation: "cancel", payload: { job_id: input.job_id } };
        nestedCancel = await api.invoke(actor(), body);
        assert.equal(nestedCancel.ok, true, JSON.stringify(nestedCancel));
      }
      await input.recordTransportAttempt(input.transport_attempt_id);
      counters.mockPost += 1;
      return generate({ ...input, recordTransportAttempt: async () => input.dispatch_intent_ref });
    };
    api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `cached-${change}-api-${++id}` });
    const result = await api.invoke(actor(), request(`cached-transport-${change}`, await fixture("generate-plan")));
    assert.equal(result.ok, false);
    assert.equal(counters.reserved, 1);
    assert.equal(counters.financeTransportAcks, 1, "revalidation must not repeat Finance's transport ACK");
    assert.equal(counters.mockPost, 0, `${change} must fence before the provider's mock transport`);
    assert.equal(counters.provider, 0);
    assert.equal(store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
    if (change === "cancel") {
      assert.equal(nestedCancel.job.status, "cancelled");
      const row = await ports.jobs.get({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, job_id: startedJobId });
      assert.equal(row.status, "cancelled", "cached replay must honor cancellation already persisted by the store");
    }
  }
});

test("known usage attached to a failed provider error is durably observed without publishing an artifact", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-failed-provider-usage-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const counters = { provider: 0, reserved: 0, settled: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `failed-usage-port-${++id}`);
  const generate = ports.provider.generate;
  ports.provider.generate = async (input) => {
    const response = await generate(input);
    throw Object.assign(new Error("synthetic adapter error must remain private"), {
      provider_outcome: "failed",
      usage: response.usage,
    });
  };
  const settle = ports.metering.settleReservation;
  ports.metering.settleReservation = async (...args) => {
    counters.settled += 1;
    return settle(...args);
  };
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `failed-usage-api-${++id}` });
  const result = await api.invoke(actor(), request("failed-provider-usage", await fixture("generate-plan")));
  assert.equal(result.ok, false);
  assert.equal(counters.provider, 1);
  assert.equal(counters.reserved, 1);
  assert.equal(counters.settled, 1, "known complete usage remains available to the trusted metering authority");
  const row = store.db.prepare("SELECT status,payload_json FROM creative_telemetry_observations_v1").get();
  assert.ok(row);
  assert.equal(row.status, "delivered");
  const observation = JSON.parse(row.payload_json).observation;
  assert.equal(observation.completeness, "complete");
  assert.deepEqual(observation.usage_units.map((unit) => [unit.name, unit.quantity]), [["input_tokens", "2"], ["output_tokens", "4"]]);
  assert.equal(store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
  assert.equal(JSON.stringify(result).includes("synthetic adapter error"), false);
});

test("incomplete usage attached to a failed provider error remains held and unpublished", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-failed-partial-usage-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const counters = { provider: 0, reserved: 0, settled: 0, held: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `failed-partial-usage-port-${++id}`);
  const generate = ports.provider.generate;
  ports.provider.generate = async (input) => {
    await generate(input);
    throw Object.assign(new Error("private partial provider failure"), {
      provider_outcome: "failed",
      usage: { completeness: "partial", input_tokens: 2, missing_fields: ["output_tokens"] },
    });
  };
  const settle = ports.metering.settleReservation;
  ports.metering.settleReservation = async (...args) => {
    counters.settled += 1;
    return settle(...args);
  };
  const markUnknown = ports.metering.markOutcomeUnknown;
  ports.metering.markOutcomeUnknown = async (...args) => {
    counters.held += 1;
    return markUnknown(...args);
  };
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `failed-partial-usage-api-${++id}` });
  const result = await api.invoke(actor(), request("failed-partial-provider-usage", await fixture("generate-plan")));
  assert.equal(result.ok, false);
  assert.equal(counters.provider, 1);
  assert.equal(counters.reserved, 1);
  assert.equal(counters.settled, 0);
  assert.equal(counters.held, 1, "partial failed usage cannot authorize settlement");
  const row = store.db.prepare("SELECT status,payload_json FROM creative_telemetry_observations_v1").get();
  assert.ok(row);
  const observation = JSON.parse(row.payload_json).observation;
  assert.equal(observation.completeness, "partial");
  assert.ok(observation.missing_fields.includes("output_tokens"));
  assert.equal(store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
  assert.equal(JSON.stringify(result).includes("private partial provider failure"), false);
});

test("populated V6 records migrate additively and replay legacy telemetry as unknown without redispatch", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-legacy-replay-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const fixtureRoot = new URL("../../fixtures/versions/base6-populated-v6/", import.meta.url);
  const manifest = JSON.parse(await readFile(new URL("manifest.json", fixtureRoot), "utf8"));
  const databaseBytes = await readFile(new URL("creative.sqlite", fixtureRoot));
  const requests = JSON.parse(await readFile(new URL("requests.json", fixtureRoot), "utf8"));
  const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  assert.equal(manifest.source_commit, "5ab7f0ede215e62f6ddb5ef3472a2dc8e55cbc74");
  assert.equal(manifest.storage_user_version, 6);
  assert.equal(manifest.dependency_mode, "offline_fixture");
  assert.equal(sha256(databaseBytes), manifest.database_sha256);
  assert.equal(sha256(Buffer.from(JSON.stringify(requests, null, 2) + "\n")), manifest.requests_sha256);
  assert.equal(requests.storage_user_version, 6);
  assert.equal(requests.artifact_sha256, manifest.artifact_sha256);
  assert.equal(manifest.source_fixture_database_sha256, sha256(await readFile(
    new URL("../base4-populated-v4/creative.sqlite", fixtureRoot))));
  const artifactDigest = manifest.artifact_sha256.slice("sha256:".length);
  const artifactBytes = await readFile(new URL(`objects/objects/sha256/${artifactDigest.slice(0, 2)}/${artifactDigest}`, fixtureRoot));
  assert.equal(sha256(artifactBytes), manifest.artifact_sha256);

  const databasePath = join(root, "versions.sqlite");
  const objectRoot = join(root, "objects");
  await cp(new URL("creative.sqlite", fixtureRoot), databasePath);
  await cp(new URL("objects", fixtureRoot), objectRoot, { recursive: true });
  const baseline = new DatabaseSync(databasePath);
  assert.equal(baseline.prepare("PRAGMA user_version").get().user_version, 6);
  assert.deepEqual(baseline.prepare("SELECT action_id,operation,status FROM creative_jobs ORDER BY action_id").all()
    .map((row) => ({ ...row })), manifest.expected_actions.map((row) => ({ ...row, status: "completed" }))
      .sort((left, right) => left.action_id.localeCompare(right.action_id)));
  assert.deepEqual(baseline.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?) ORDER BY name")
    .all("creative_inspection_sessions_v1", "creative_inspection_stages_v1"), []);
  baseline.close();

  let store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(() => store.close());
  assert.equal(store.db.prepare("PRAGMA user_version").get().user_version, 13);
  const inspectionTables = store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?) ORDER BY name")
    .all("creative_inspection_sessions_v1", "creative_inspection_stages_v1").map((row) => row.name);
  assert.deepEqual(inspectionTables, ["creative_inspection_sessions_v1", "creative_inspection_stages_v1"]);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM creative_inspection_sessions_v1").get().count, 0,
    "old inspect jobs remain historical records; migration does not synthesize new inspection sessions");
  assert.deepEqual(store.db.prepare("PRAGMA foreign_key_check").all(), []);
  for (const designVersionId of [requests.expected_generate_design_version_id, requests.expected_edit_design_version_id]) {
    assert.ok(store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id, design_version_id: designVersionId }));
    assert.deepEqual(Buffer.from(await store.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
      design_version_id: designVersionId })), artifactBytes);
  }

  const preservedCounters = { provider: 0, reserved: 0, inspection: 0 };
  let preservedId = 0;
  const preservedPorts = portsFor(store, preservedCounters, () => `v6-preserved-port-${++preservedId}`);
  preservedPorts.inspection = { resolveRoute() { throw new Error("historical inspection replay must not resolve a route"); },
    async inspect() { preservedCounters.inspection += 1; throw new Error("historical inspection replay must not redispatch"); } };
  const preservedApi = createCreativeApi({ ports: preservedPorts, now: () => NOW,
    idFactory: () => `v6-preserved-api-${++preservedId}` });
  const preservedEvidence = new Map();
  for (const body of [requests.generate_request, requests.edit_request, requests.inspect_request]) {
    const row = store.db.prepare("SELECT result_json FROM creative_jobs WHERE action_id=?").get(body.action_id);
    const historical = JSON.parse(row.result_json);
    const telemetry = body.operation === "inspect" ? historical.inspection.telemetry_evidence : historical.telemetry_evidence;
    assert.deepEqual(telemetry, { local_status: "recorded" }, `${body.operation} retains the V6 metering result`);
    const outbox = store.db.prepare(`SELECT event_id,event_type,status,payload_json FROM creative_telemetry_evidence_outbox_v1
      WHERE tenant_id=? AND project_id=? AND json_extract(payload_json, '$.logical_operation_id')=? ORDER BY rowid`)
      .all(SCOPE.tenant_id, SCOPE.project_id, body.action_id).map((item) => ({ ...item }));
    const observations = store.db.prepare(`SELECT status,source_observation_id,logical_operation_id,billable_attempt_id,payload_json
      FROM creative_telemetry_observations_v1 WHERE tenant_id=? AND project_id=? AND budget_scope_id=? AND logical_operation_id=?
      ORDER BY billable_attempt_id`)
      .all(SCOPE.tenant_id, SCOPE.project_id, "budget-api-1", body.action_id).map((item) => ({ ...item }));
    assert.equal(outbox.length, 3, `${body.operation} retains its attempt, transport, and outcome evidence`);
    assert.equal(observations.length, 1, `${body.operation} retains its source usage observation`);
    assert.equal(observations[0].status, "delivered");
    preservedEvidence.set(body.action_id, canonicalHash({ outbox, observations }));

    const replay = await preservedApi.invoke(actor(), body);
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result.telemetry_evidence, telemetry,
      `${body.operation} keeps the historical public telemetry status and shape`);
    if (body.operation === "generate") {
      assert.equal(replay.result.design_version.design_version_id, requests.expected_generate_design_version_id);
    } else if (body.operation === "edit") {
      assert.equal(replay.result.design_version.design_version_id, requests.expected_edit_design_version_id);
    } else {
      assert.equal(replay.result.design_version_id, requests.expected_inspection_design_version_id);
    }
    const afterOutbox = store.db.prepare(`SELECT event_id,event_type,status,payload_json FROM creative_telemetry_evidence_outbox_v1
      WHERE tenant_id=? AND project_id=? AND json_extract(payload_json, '$.logical_operation_id')=? ORDER BY rowid`)
      .all(SCOPE.tenant_id, SCOPE.project_id, body.action_id).map((item) => ({ ...item }));
    const afterObservations = store.db.prepare(`SELECT status,source_observation_id,logical_operation_id,billable_attempt_id,payload_json
      FROM creative_telemetry_observations_v1 WHERE tenant_id=? AND project_id=? AND budget_scope_id=? AND logical_operation_id=?
      ORDER BY billable_attempt_id`)
      .all(SCOPE.tenant_id, SCOPE.project_id, "budget-api-1", body.action_id).map((item) => ({ ...item }));
    assert.equal(canonicalHash({ outbox: afterOutbox, observations: afterObservations }), preservedEvidence.get(body.action_id),
      `${body.operation} replay preserves the original metering and telemetry rows byte-for-byte`);
  }
  assert.equal(preservedCounters.provider, 0);
  assert.equal(preservedCounters.inspection, 0);
  assert.equal(preservedCounters.reserved, 0);

  for (const body of [requests.generate_request, requests.edit_request, requests.inspect_request]) {
    const row = store.db.prepare("SELECT result_json FROM creative_jobs WHERE action_id=?").get(body.action_id);
    assert.ok(row, body.action_id);
    const legacy = JSON.parse(row.result_json);
    const attemptId = legacy.attempt_id;
    if (body.operation === "inspect") delete legacy.inspection.telemetry_evidence;
    else delete legacy.telemetry_evidence;
    store.db.prepare("UPDATE creative_jobs SET result_json=? WHERE action_id=?")
      .run(JSON.stringify(legacy), body.action_id);
    store.db.prepare(`DELETE FROM creative_telemetry_evidence_outbox_v1
      WHERE tenant_id=? AND project_id=?
        AND json_extract(payload_json, '$.logical_operation_id')=?
        AND json_extract(payload_json, '$.billable_attempt_id')=?`)
      .run(SCOPE.tenant_id, SCOPE.project_id, body.action_id, attemptId);
    store.db.prepare(`DELETE FROM creative_telemetry_observations_v1
      WHERE tenant_id=? AND project_id=? AND budget_scope_id=?
        AND logical_operation_id=? AND billable_attempt_id=?`)
      .run(SCOPE.tenant_id, SCOPE.project_id, "budget-api-1", body.action_id, attemptId);
  }
  store.close();

  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  const counters = { provider: 0, reserved: 0, inspection: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `v6-replay-port-${++id}`);
  ports.inspection = { resolveRoute() { throw new Error("historical inspection replay must not resolve a route"); },
    async inspect() { counters.inspection += 1; throw new Error("historical inspection replay must not redispatch"); } };
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `v6-replay-api-${++id}` });
  for (const body of [requests.generate_request, requests.edit_request, requests.inspect_request]) {
    const replay = await api.invoke(actor(), { ...body, event_id: `${body.event_id}-retry`, request_id: `${body.request_id}-retry` });
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result.telemetry_evidence, { local_status: "unknown" }, body.operation);
  }
  assert.equal(counters.provider, 0, "legacy generation and edit replay never redispatch providers");
  assert.equal(counters.inspection, 0, "legacy inspection replay never calls the observer");
  assert.equal(counters.reserved, 0, "legacy replay never creates another reservation");
});

test("a new result with removed telemetry status fails closed instead of replaying as legacy", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-missing-telemetry-status-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const api = createCreativeApi({ ports: portsFor(store, counters, () => `missing-status-port-${++id}`),
    now: () => NOW, idFactory: () => `missing-status-api-${++id}` });
  const body = request("new-result-missing-telemetry-status", await fixture("generate-plan"));
  const first = await api.invoke(actor(), body);
  assert.equal(first.ok, true, JSON.stringify(first));
  const row = store.db.prepare("SELECT result_json FROM creative_jobs WHERE action_id=?").get(body.action_id);
  const result = JSON.parse(row.result_json);
  delete result.telemetry_evidence;
  store.db.prepare("UPDATE creative_jobs SET result_json=? WHERE action_id=?")
    .run(JSON.stringify(result), body.action_id);
  store.db.prepare(`DELETE FROM creative_telemetry_evidence_outbox_v1
    WHERE tenant_id=? AND project_id=?
      AND json_extract(payload_json, '$.logical_operation_id')=?
      AND json_extract(payload_json, '$.billable_attempt_id')=?`)
    .run(SCOPE.tenant_id, SCOPE.project_id, body.action_id, result.attempt_id);
  assert.ok(store.db.prepare(`SELECT count(*) AS count FROM creative_telemetry_observations_v1
    WHERE logical_operation_id=? AND billable_attempt_id=?`).get(body.action_id, result.attempt_id).count > 0,
  "a current C03 usage observation remains to distinguish this damaged result from a legacy job");

  const replay = await api.invoke(actor(), { ...body, event_id: `${body.event_id}-retry`, request_id: `${body.request_id}-retry` });
  assert.equal(replay.ok, false);
  assert.equal(replay.error.code, "unavailable");
  assert.equal(counters.provider, 1, "malformed replay does not redispatch provider work");
  assert.equal(counters.reserved, 1, "malformed replay does not create another reservation");
});

test("partial provider usage persists an observation before incomplete usage prevents publication", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-partial-usage-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `partial-usage-port-${++id}`);
  const generate = ports.provider.generate;
  ports.provider.generate = async (input) => ({ ...await generate(input),
    usage: { completeness: "partial", input_tokens: 2, missing_fields: ["output_tokens"] } });
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `partial-usage-api-${++id}` });
  const result = await api.invoke(actor(), request("partial-usage-action", await fixture("generate-plan")));
  assert.equal(result.ok, false);
  assert.equal(counters.provider, 1);
  assert.equal(counters.reserved, 1);
  const row = store.db.prepare("SELECT status,payload_json FROM creative_telemetry_observations_v1").get();
  assert.ok(row, "partial usage is retained even when it cannot authorize publication");
  const observation = JSON.parse(row.payload_json).observation;
  assert.equal(observation.completeness, "partial");
  assert.ok(observation.missing_fields.includes("output_tokens"));
  assert.equal(store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
});

test("late usage after deadline remains a durable observation-only replay with no publication", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-late-usage-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `late-usage-port-${++id}`);
  const generate = ports.provider.generate;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 30_000 ? 5 : delay, ...args);
  let result;
  try {
    ports.provider.generate = async (input) => {
      await input.recordTransportAttempt(input.transport_attempt_id);
      await new Promise((resolve) => originalSetTimeout(resolve, 20));
      return { ...await generate({ ...input, recordTransportAttempt: async () => {} }),
        usage: { completeness: "complete", input_tokens: 9, output_tokens: 4 } };
    };
    const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `late-usage-api-${++id}` });
    result = await api.invoke(actor(), request("late-usage-action", await fixture("generate-plan")));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "cancelled");
  assert.equal(counters.reserved, 1);
  await new Promise((resolve) => originalSetTimeout(resolve, 40));
  assert.equal(counters.provider, 1);
  assert.equal(store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
  const row = store.db.prepare("SELECT status,payload_json FROM creative_telemetry_observations_v1").get();
  assert.ok(row, "usage arriving after abort is durable for later C03 reconciliation");
  assert.equal(row.status, "pending", "late usage has not been mistaken for an already-confirmed Finance observation");
  const observation = JSON.parse(row.payload_json).observation;
  assert.equal(observation.input_tokens, undefined);
  assert.deepEqual(observation.usage_units.map((unit) => unit.quantity), ["9", "4"]);
  assert.equal(observation.transport_attempt_id, counters.providerTransportIds[0]);

  store.close();
  const reopened = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => reopened.close());
  const replayed = await deliverPendingUsageObservations({
    outbox: createSqliteTelemetryOutbox({ database: reopened.db, clock: () => NOW }),
    trustedScopeForRecord: async () => ({ tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
      budget_scope_id: "budget-api-1" }),
    meteringPort: {
      async recordUsageObservation(input) {
        return { status: "accepted", source_observation_id: input.observation.source_observation_id,
          effective_billable_attempt_id: input.observation.billable_attempt_id };
      },
    },
  });
  assert.deepEqual(replayed, { status: "complete", attempted: 1, acknowledged: 1, retained: 0 });
  assert.equal(counters.provider, 1, "reconciliation replays only the observation, never the provider call");
});

test("usage attached to a late provider rejection is durably recorded without resettlement or publication", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-late-error-usage-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const counters = { provider: 0, reserved: 0, settled: 0, held: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `late-error-usage-port-${++id}`);
  const generate = ports.provider.generate;
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay, ...args) => originalSetTimeout(callback, delay === 30_000 ? 5 : delay, ...args);
  const settle = ports.metering.settleReservation;
  ports.metering.settleReservation = async (...args) => {
    counters.settled += 1;
    return settle(...args);
  };
  const markUnknown = ports.metering.markOutcomeUnknown;
  ports.metering.markOutcomeUnknown = async (...args) => {
    counters.held += 1;
    return markUnknown(...args);
  };
  let result;
  try {
    ports.provider.generate = async (input) => {
      await input.recordTransportAttempt(input.transport_attempt_id);
      await new Promise((resolve) => originalSetTimeout(resolve, 20));
      const response = await generate({ ...input, recordTransportAttempt: async () => {} });
      throw Object.assign(new Error("late synthetic provider rejection"), {
        provider_outcome: "failed", usage: response.usage,
      });
    };
    const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `late-error-usage-api-${++id}` });
    result = await api.invoke(actor(), request("late-error-usage-action", await fixture("generate-plan")));
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "cancelled");
  assert.equal(counters.reserved, 1);
  await new Promise((resolve) => originalSetTimeout(resolve, 40));
  assert.equal(counters.provider, 1);
  assert.equal(counters.settled, 0);
  assert.equal(counters.held, 1);
  assert.equal(store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
  const row = store.db.prepare("SELECT status,payload_json FROM creative_telemetry_observations_v1").get();
  assert.ok(row, "late rejection usage remains durable for an observation-only reconciliation pass");
  assert.equal(row.status, "pending");
  assert.equal(JSON.parse(row.payload_json).observation.completeness, "complete");
});

test("actual API usage profile persists nested provider counts as included subsets without double counting", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-nested-usage-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  const brief = await fixture("brief");
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `nested-usage-port-${++id}`);
  ports.telemetry.usage_profiles.image_generation = USAGE_PROFILE.OPENAI_RESPONSES;
  const artifactBytes = Buffer.from("durable exact artwork bytes");
  const artifactHash = `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}`;
  ports.provider.generate = async (input) => {
    counters.provider += 1;
    (counters.providerTransportIds ??= []).push(input.transport_attempt_id);
    await input.recordTransportAttempt(input.transport_attempt_id);
    return { design_version_id: "design-nested-usage-1",
      artifact: { artifact_id: "artifact-nested-usage-1", content_hash: artifactHash, media_type: "image/png" },
      artifact_bytes: Uint8Array.from(artifactBytes), provider: "fixture-provider", model: "fixture-model",
      usage: { completeness: "complete", input_tokens: 10, output_tokens: 6, total_tokens: 16,
        input_tokens_details: { cached_tokens: 2 }, output_tokens_details: { reasoning_tokens: 3 },
        provider_request_id: "provider:req-nested-usage" } };
  };
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `nested-usage-api-${++id}` });
  const result = await api.invoke(actor(), request("nested-usage-api", await fixture("generate-plan")));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(counters.provider, 1);
  assert.equal(counters.reserved, 1);
  const row = store.db.prepare("SELECT payload_json,status FROM creative_telemetry_observations_v1").get();
  assert.equal(row.status, "delivered");
  const observation = JSON.parse(row.payload_json).observation;
  assert.equal(observation.completeness, "complete");
  assert.equal(observation.provider_request_id, "provider:req-nested-usage");
  assert.equal(observation.transport_attempt_id, counters.providerTransportIds[0]);
  const units = new Map(observation.usage_units.map((unit) => [unit.name, unit]));
  assert.equal(units.get("total_tokens").relation, "standalone");
  assert.equal(units.get("input_tokens").relation, "included_subset");
  assert.equal(units.get("input_tokens").included_in, "total_tokens");
  assert.equal(units.get("output_tokens").included_in, "total_tokens");
  assert.equal(units.get("input_tokens_details.cached_tokens").included_in, "input_tokens");
  assert.equal(units.get("output_tokens_details.reasoning_tokens").included_in, "output_tokens");
  assert.equal(observation.usage_units.filter((unit) => unit.relation === "standalone").length, 1);
});

test("actual API refuses telemetry append inside an uncommitted shared-store transaction before reservation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-telemetry-tx-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  const brief = await fixture("brief");
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `outer-transaction-port-${++id}`);
  const durableOutbox = ports.telemetry.outbox;
  let guardedAttemptIntent = false;
  ports.telemetry.outbox = Object.freeze({
    ...durableOutbox,
    async append(event) {
      if (event.event_type !== "attempt_intent") return durableOutbox.append(event);
      guardedAttemptIntent = true;
      store.db.exec("BEGIN IMMEDIATE");
      try {
        return await durableOutbox.append(event);
      } finally {
        if (store.db.isTransaction) store.db.exec("ROLLBACK");
      }
    },
  });
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `outer-transaction-api-${++id}` });
  const result = await api.invoke(actor(), request("api-telemetry-outer-transaction", await fixture("generate-plan")));
  assert.equal(guardedAttemptIntent, true);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "unavailable");
  assert.equal(counters.reserved, 0, "an outbox row in an uncommitted outer transaction cannot authorize reservation");
  assert.equal(counters.provider, 0, "an outbox row in an uncommitted outer transaction cannot authorize provider dispatch");
  assert.equal(store.db.isTransaction, false);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM creative_telemetry_evidence_outbox_v1").get().count, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM creative_telemetry_observations_v1").get().count, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions").get().count, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM version_selections").get().count, 0);
});

test("dispatch authorization rechecks lease expiry after the intent timestamp and retains the metering hold", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-api-dispatch-expired-lease-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  let store;
  let authorizationClockReads = 0;
  const now = () => {
    if (store?.db.isTransaction === true &&
      store.db.prepare("SELECT count(*) AS count FROM creative_jobs WHERE status='running'").get().count > 0 &&
      store.db.prepare("SELECT count(*) AS count FROM creation_actions").get().count === 0) {
      authorizationClockReads += 1;
      if (authorizationClockReads >= 2) return NOW + 120_000;
    }
    return NOW;
  };
  store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now });
  t.after(() => store.close());
  const brief = await fixture("brief");
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const api = createCreativeApi({ ports: portsFor(store, counters, () => `dispatch-expiry-port-${++id}`),
    now: () => NOW, idFactory: () => `dispatch-expiry-api-${++id}` });
  const response = await api.invoke(actor(), request("dispatch-expired-lease", await fixture("generate-plan")));

  assert.ok(authorizationClockReads >= 2, "the clock crosses expiry during the final dispatch authorization check");
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(counters.reserved, 1, "the reservation was consumed before the dispatch fence");
  assert.equal(counters.provider, 0, "expired authorization cannot start the transport");
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM creative_dispatch_intents").get().count, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions").get().count, 0);
  assert.equal(store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }), null);
  const job = store.db.prepare("SELECT status,result_json FROM creative_jobs WHERE action_id=?")
    .get("dispatch-expired-lease");
  assert.notEqual(job.status, "completed");
  assert.equal(job.result_json, null);
});

test("dispatch authorization replay does not reuse an intent after the lease expires during replay checks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-api-dispatch-replay-expired-lease-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  let store;
  let replayClockReads = 0;
  let advanceDuringReplay = false;
  const now = () => {
    if (advanceDuringReplay && store?.db.isTransaction === true &&
      store.db.prepare("SELECT count(*) AS count FROM creative_jobs WHERE status='running'").get().count > 0 &&
      store.db.prepare("SELECT count(*) AS count FROM creative_dispatch_intents").get().count > 0) {
      replayClockReads += 1;
      if (replayClockReads >= 2) return NOW + 120_000;
    }
    return NOW;
  };
  store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now });
  t.after(() => store.close());
  const brief = await fixture("brief");
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const adapter = createCreativeVersionApiPorts({ store, idFactory: (() => {
    let id = 0;
    return () => `dispatch-replay-id-${++id}`;
  })() });
  const action_id = "dispatch-replay-expired-lease";
  const started = await adapter.jobs.begin({ scope: SCOPE, actor_id: "actor-api-1", action_id,
    request_hash: canonicalHash({ action_id, operation: "generate" }), operation: "generate" });
  const authorization = { scope: SCOPE, actor_id: "actor-api-1", job_id: started.job_id,
    lease_token: started.lease_token, action_id, operation: "generate",
    billable_attempt_id: "billable-replay-lease", transport_attempt_id: "transport-replay-lease",
    context_fence: { brief_id: SCOPE.brief_id, brief_hash: canonicalHash(brief),
      expected_current_design_version_id: null, expected_current_design_hash: null } };
  const initialAuthorization = await adapter.jobs.authorizeDispatch(authorization);
  assert.equal(initialAuthorization.status, "authorized");
  const currentPermit = { ...authorization, dispatch_intent_ref: initialAuthorization.dispatch_intent_ref };
  assert.deepEqual(adapter.jobs.assertDispatchCurrent(currentPermit), initialAuthorization,
    "the synchronous owner check accepts the exact current intent");
  assert.deepEqual(adapter.jobs.assertDispatchCurrent({ ...currentPermit,
    dispatch_intent_ref: "substituted-intent-reference" }), { status: "lease_lost" },
  "the owner check rejects a substituted dispatch intent");
  store.db.exec("BEGIN");
  assert.deepEqual(adapter.jobs.assertDispatchCurrent(currentPermit), { status: "lease_lost" },
    "the synchronous read refuses to borrow a caller-owned transaction");
  assert.equal(store.db.isTransaction, true, "fail-closed checking leaves the caller transaction open");
  store.db.exec("ROLLBACK");

  advanceDuringReplay = true;
  const replay = await adapter.jobs.authorizeDispatch(authorization);
  assert.ok(replayClockReads >= 2, "the lease expires between the initial and final replay checks");
  assert.deepEqual(replay, { status: "lease_lost" });
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM creative_dispatch_intents WHERE job_id=?")
    .get(started.job_id).count, 1, "the replay cannot create another dispatch intent");
});

test("normal paired publication rolls back when the lease expires during final result timestamping", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-api-publication-expired-lease-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  let store;
  let publicationClockReads = 0;
  const now = () => {
    if (store?.db.isTransaction === true &&
      store.db.prepare("SELECT count(*) AS count FROM creation_actions WHERE state='committed'").get().count > 0) {
      publicationClockReads += 1;
      if (publicationClockReads >= 2) return NOW + 120_000;
    }
    return NOW;
  };
  store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now });
  t.after(() => store.close());
  const brief = await fixture("brief");
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const api = createCreativeApi({ ports: portsFor(store, counters, () => `publication-expiry-port-${++id}`),
    now: () => NOW, idFactory: () => `publication-expiry-api-${++id}` });
  const response = await api.invoke(actor(), request("publication-expired-lease", await fixture("generate-plan")));

  assert.equal(publicationClockReads, 3,
    "the post-callback context fence is sampled before the final persisted completion timestamp expires the lease");
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(counters.provider, 1, "the already-dispatched attempt remains attributable");
  assert.equal(counters.reserved, 1, "publication fencing cannot erase or recreate the reservation");
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions").get().count, 0);
  assert.equal(store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }), null);
  const job = store.db.prepare("SELECT status,result_json FROM creative_jobs WHERE action_id=?")
    .get("publication-expired-lease");
  assert.notEqual(job.status, "completed");
  assert.equal(job.result_json, null);
  const action = store.db.prepare("SELECT state FROM creation_actions WHERE action_id=?")
    .get("publication-expired-lease");
  assert.notEqual(action.state, "committed", "the version publication transaction must roll back with the job result");
});

test("paired API rejects a changed commit intent before publication and replay never redispatches", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-intent-integrity-api-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const plan = await fixture("generate-plan");
  const brief = await fixture("brief");
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `intent-integrity-port-${++id}`);
  const prepare = ports.storage.prepareDesignVersion.bind(ports.storage);
  ports.storage.prepareDesignVersion = async (input) => {
    const prepared = await prepare(input);
    const row = store.db.prepare("SELECT intent_json FROM creation_actions WHERE action_id=?")
      .get("intent-integrity-api");
    store.db.prepare("UPDATE creation_actions SET intent_json=? WHERE action_id=?")
      .run(substituteAttemptIdentity(row.intent_json), "intent-integrity-api");
    return prepared;
  };
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `intent-integrity-api-${++id}` });
  const body = request("intent-integrity-api", plan);
  const first = await api.invoke(actor(), body);
  assert.equal(first.ok, false);
  assert.equal(counters.provider, 1);
  assert.equal(counters.reserved, 1);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions WHERE action_id=?")
    .get("intent-integrity-api").count, 0);
  assert.equal(store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }), null);
  const job = store.db.prepare("SELECT status,result_json FROM creative_jobs WHERE action_id=?")
    .get("intent-integrity-api");
  assert.equal(job.status, "failed");
  assert.equal(job.result_json, null);
  const repeated = await api.invoke(actor(), body);
  assert.equal(counters.provider, 1, "corrupt intent replay cannot make a new provider call");
  assert.equal(counters.reserved, 1, "corrupt intent replay cannot make a new reservation");
  if (repeated.ok) assert.equal(repeated.job.status, "failed");
});

test("paired API persists explicit A/B/C branches and restore-by-selection without creating versions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-branches-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const brief = await fixture("brief");
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"), objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const counters = { provider: 0, reserved: 0 };
  let portId = 0;
  let apiId = 0;
  const api = createCreativeApi({ ports: portsFor(store, counters, () => `branch-port-${++portId}`), now: () => NOW,
    idFactory: () => `branch-api-${++apiId}` });
  const created = await api.invoke(actor(), request("branch-create-A", await fixture("generate-plan")));
  assert.equal(created.ok, true, JSON.stringify(created));
  const a = created.result.design_version;

  const makeBranch = async (actionId) => {
    const plan = await fixture("edit-plan");
    plan.base = { brief_hash: a.brief_hash, design_hash: a.design_hash, design_version_id: a.design_version_id };
    plan.steps[0].parameters.design_version_id = a.design_version_id;
    plan.steps[0].parameters.artifact_id = a.artifact.artifact_id;
    plan.expected_result.parent_version_id = a.design_version_id;
    return api.invoke(actor(), { ...request(actionId, plan), operation: "edit",
      payload: { brief_id: SCOPE.brief_id, design_version_id: a.design_version_id, selection_mode: "branch", plan } });
  };
  const bResult = await makeBranch("branch-create-B");
  const cResult = await makeBranch("branch-create-C");
  assert.equal(bResult.ok, true, JSON.stringify(bResult));
  assert.equal(cResult.ok, true, JSON.stringify(cResult));
  const b = bResult.result.design_version;
  const c = cResult.result.design_version;
  assert.equal(b.parent_version_id, a.design_version_id);
  assert.equal(c.parent_version_id, a.design_version_id);
  assert.equal(store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }).design_version_id, a.design_version_id,
    "explicit child branches do not move implicit current selection");

  const restore = async (actionId, target, revision) => api.invoke(actor(), {
    ...request(actionId, await fixture("generate-plan")), operation: "restore",
    payload: { brief_id: SCOPE.brief_id, target_design_version_id: target.design_version_id,
      expected_selection_revision: revision },
  });
  const selectedB = await restore("branch-select-B", b, 1);
  assert.equal(selectedB.ok, true, JSON.stringify(selectedB));
  assert.deepEqual(selectedB.result.selection, { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    brief_id: SCOPE.brief_id, design_version_id: b.design_version_id, design_hash: b.design_hash, revision: 2 });
  const beforeRestoreCount = store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length;
  const restoreA = await restore("branch-restore-A", a, 2);
  assert.equal(restoreA.ok, true, JSON.stringify(restoreA));
  assert.equal(restoreA.result.selection.design_version_id, a.design_version_id);
  assert.equal(restoreA.result.selection.design_hash, a.design_hash);
  assert.equal(restoreA.result.selection.revision, 3);
  assert.equal(store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, beforeRestoreCount,
    "restore selects an existing immutable record and creates no version");
  assert.equal(counters.provider, 3, "selection and restore invoke no provider");
  assert.equal(counters.reserved, 3, "selection and restore invoke no metering reservation");
  assert.deepEqual(Buffer.from(await store.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: a.design_version_id })), Buffer.from("durable exact artwork bytes"));
  const comparison = store.compareDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id,
    left_design_version_id: b.design_version_id, right_design_version_id: c.design_version_id });
  assert.equal(comparison.left.parent_version_id, a.design_version_id);
  assert.equal(comparison.right.parent_version_id, a.design_version_id);
});

test("SQLite publication is safe across adapter factories, file connections, stale CAS, replay, cancel, and restart", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-sqlite-publication-concurrency-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, "versions.sqlite");
  const objectRoot = join(root, "objects");
  const aliasPath = join(root, "versions-symlink.sqlite");
  const hardLinkPath = join(root, "versions-hardlink.sqlite");
  const brief = await fixture("brief");
  const store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });

  const makeBody = async (actionId, selection_mode) => {
    const body = request(actionId, await fixture("generate-plan"));
    if (selection_mode) body.payload.selection_mode = selection_mode;
    return body;
  };
  const seedCounters = { provider: 0, reserved: 0 };
  const seedApi = concurrentApi(store, "concurrency-root", seedCounters);
  const seedBody = await makeBody("concurrency-root-action");
  const seeded = await seedApi.invoke(actor(), seedBody);
  assert.equal(seeded.ok, true, JSON.stringify(seeded));
  assert.equal(seedCounters.provider, 1);
  const rootVersion = seeded.result.design_version;

  const makeEditBody = async (actionId, parent, selection_mode) => {
    const plan = await fixture("edit-plan");
    plan.base = { brief_hash: parent.brief_hash, design_hash: parent.design_hash,
      design_version_id: parent.design_version_id };
    for (const step of plan.steps) {
      if (step.parameters.design_version_id !== undefined) step.parameters.design_version_id = parent.design_version_id;
      if (step.parameters.artifact_id !== undefined) step.parameters.artifact_id = parent.artifact.artifact_id;
    }
    plan.expected_result.parent_version_id = parent.design_version_id;
    return { ...request(actionId, plan), operation: "edit",
      payload: { brief_id: SCOPE.brief_id, design_version_id: parent.design_version_id, selection_mode, plan } };
  };

  const runConcurrentPair = async ({ firstStore, secondStore, parent, firstLabel, secondLabel,
    firstAction, secondAction, selection_mode }) => {
    const waitForProvider = barrierFor(2);
    const firstCounters = { provider: 0, reserved: 0 };
    const secondCounters = { provider: 0, reserved: 0 };
    const firstApi = concurrentApi(firstStore, firstLabel, firstCounters, waitForProvider);
    const secondApi = concurrentApi(secondStore, secondLabel, secondCounters, waitForProvider);
    const firstBody = await makeEditBody(firstAction, parent, selection_mode);
    const secondBody = await makeEditBody(secondAction, parent, selection_mode);
    const [first, second] = await Promise.all([
      firstApi.invoke(actor(), firstBody), secondApi.invoke(actor(), secondBody),
    ]);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));
    assert.deepEqual([firstCounters.provider, secondCounters.provider], [1, 1]);
    return { firstApi, secondApi, firstBody, secondBody, first, second, firstCounters, secondCounters };
  };

  // Two factories for one connection keep their per-database transaction
  // ownership shared even when the queue has become idle between operations.
  const sameConnection = await runConcurrentPair({ firstStore: store, secondStore: store, parent: rootVersion,
    firstLabel: "same-connection-a", secondLabel: "same-connection-b",
    firstAction: "same-connection-branch-a", secondAction: "same-connection-branch-b",
    selection_mode: "branch" });
  for (const result of [sameConnection.first, sameConnection.second]) {
    const bytes = await store.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
      design_version_id: result.result.design_version.design_version_id });
    assert.deepEqual(Buffer.from(bytes), Buffer.from(`exact concurrent artifact bytes:${result.result.design_version.design_version_id.replace("design:", "")}`));
  }
  const sameReplay = await sameConnection.secondApi.invoke(actor(), sameConnection.firstBody);
  assert.equal(sameReplay.ok, true, JSON.stringify(sameReplay));
  assert.equal(sameReplay.replayed, true);
  assert.equal(sameConnection.firstCounters.provider, 1, "completed cross-adapter replay does not redispatch");
  const changedReplayBody = structuredClone(sameConnection.firstBody);
  changedReplayBody.payload.plan.steps[0].parameters.variant_count = 2;
  const sameConflict = await sameConnection.secondApi.invoke(actor(), changedReplayBody);
  assert.equal(sameConflict.ok, false);
  assert.equal(sameConflict.error.code, "conflict");
  assert.equal(sameConnection.firstCounters.provider, 1, "duplicate action conflict does not redispatch");

  // A symbolic path alias resolves to the same registered SQLite identity.
  // This pair uses two separate DatabaseSync connections and must both publish.
  await symlink(databasePath, aliasPath);
  assert.throws(() => new CreativeVersionStore({ databasePath: aliasPath,
    objectRoot: join(root, "mismatched-objects"), now: () => NOW }),
  (error) => error instanceof VersionStoreError && error.code === "unavailable" && error.field === "database.object_root_mismatch");
  const aliasStore = new CreativeVersionStore({ databasePath: aliasPath, objectRoot, now: () => NOW });
  t.after(() => aliasStore.close());
  const separateConnections = await runConcurrentPair({ firstStore: store, secondStore: aliasStore, parent: rootVersion,
    firstLabel: "separate-connection-a", secondLabel: "separate-connection-b",
    firstAction: "separate-connection-branch-a", secondAction: "separate-connection-branch-b",
    selection_mode: "branch" });

  // A top-level stale selection CAS remains fenced after both providers have
  // completed. Exactly one immutable version can advance the empty selection.
  const staleGate = barrierFor(2);
  const staleCountersA = { provider: 0, reserved: 0 };
  const staleCountersB = { provider: 0, reserved: 0 };
  const staleApiA = concurrentApi(store, "stale-cas-a", staleCountersA, staleGate);
  const staleApiB = concurrentApi(aliasStore, "stale-cas-b", staleCountersB, staleGate);
  const staleBodyA = await makeEditBody("stale-cas-action-a", rootVersion, "advance");
  const staleBodyB = await makeEditBody("stale-cas-action-b", rootVersion, "advance");
  const staleResults = await Promise.all([staleApiA.invoke(actor(), staleBodyA), staleApiB.invoke(actor(), staleBodyB)]);
  assert.equal(staleResults.filter((entry) => entry.ok).length, 1, JSON.stringify(staleResults));
  assert.equal(staleResults.filter((entry) => !entry.ok && entry.error.code === "stale_version").length, 1,
    JSON.stringify(staleResults));
  assert.deepEqual([staleCountersA.provider, staleCountersB.provider], [1, 1]);
  const staleWinner = staleResults.find((entry) => entry.ok);
  const staleLoserBody = staleResults[0].ok ? staleBodyB : staleBodyA;
  const staleLoserActionId = staleLoserBody.action_id;
  const selected = store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  assert.equal(selected.design_version_id, staleWinner.result.design_version.design_version_id);
  const staleWinnerBody = staleWinner === staleResults[0] ? staleBodyA : staleBodyB;
  const staleWinnerApi = staleWinner === staleResults[0] ? staleApiB : staleApiA;
  const staleReplay = await staleWinnerApi.invoke(actor(), staleWinnerBody);
  assert.equal(staleReplay.ok, true, JSON.stringify(staleReplay));
  assert.equal(staleReplay.replayed, true);

  // Provider I/O is outside the SQLite queue: a second connection can cancel
  // an in-flight request, and the late response leaves no visible version.
  const providerEntered = deferred();
  const providerRelease = deferred();
  const cancelCounters = { provider: 0, reserved: 0 };
  const cancelApi = concurrentApi(store, "cancel-race", cancelCounters, async () => {
    providerEntered.resolve();
    await providerRelease.promise;
  });
  const cancelController = concurrentApi(aliasStore, "cancel-controller", { provider: 0, reserved: 0 });
  const cancelBody = await makeEditBody("cancel-race-action", rootVersion, "branch");
  const pending = cancelApi.invoke(actor(), cancelBody);
  await providerEntered.promise;
  const job = store.db.prepare("SELECT job_id FROM creative_jobs WHERE action_id=?").get(cancelBody.action_id);
  assert.ok(job?.job_id);
  const cancelRequest = { ...request("cancel-race-command", await fixture("generate-plan")),
    operation: "cancel", payload: { job_id: job.job_id } };
  const cancellation = await cancelController.invoke(actor(), cancelRequest);
  assert.equal(cancellation.ok, true, JSON.stringify(cancellation));
  assert.equal(cancellation.job.status, "cancelled");
  providerRelease.resolve();
  const lateResponse = await pending;
  assert.equal(lateResponse.ok, false);
  assert.equal(lateResponse.error.code, "cancelled");
  assert.equal(cancelCounters.provider, 1);
  assert.equal(store.db.prepare("SELECT status FROM creative_jobs WHERE job_id=?").get(job.job_id).status, "cancelled");
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions WHERE creation_job_id=?")
    .get(job.job_id).count, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM creation_actions WHERE job_id=?")
    .get(job.job_id).count, 0);

  const committedVersionIds = [
    rootVersion.design_version_id,
    sameConnection.first.result.design_version.design_version_id,
    sameConnection.second.result.design_version.design_version_id,
    separateConnections.first.result.design_version.design_version_id,
    separateConnections.second.result.design_version.design_version_id,
    staleWinner.result.design_version.design_version_id,
  ];
  assert.equal(store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 20 }).items.length, 6);

  store.close();
  aliasStore.close();
  const reopened = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(() => reopened.close());
  const recovery = await reopened.recover();
  assert.deepEqual(recovery, { examined: 1, committed: 0, conflicts: 0, unknown: 1 },
    "recovery records the stale CAS loser as unknown and cannot publish it");
  assert.equal(reopened.db.prepare("SELECT state FROM creation_actions WHERE action_id=?")
    .get(staleLoserActionId).state, "unknown");
  const staleLoserJob = reopened.db.prepare("SELECT status,error_json FROM creative_jobs WHERE action_id=?")
    .get(staleLoserActionId);
  assert.equal(staleLoserJob.status, "failed");
  assert.equal(JSON.parse(staleLoserJob.error_json).code, "stale_version");
  assert.equal(reopened.db.prepare("SELECT count(*) AS count FROM design_versions WHERE action_id=?")
    .get(staleLoserActionId).count, 0);
  assert.equal(reopened.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 20 }).items.length, 6);
  assert.equal(reopened.db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.deepEqual(reopened.db.prepare("PRAGMA foreign_key_check").all(), []);
  for (const design_version_id of committedVersionIds) {
    const bytes = await reopened.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id, design_version_id });
    const label = design_version_id.replace("design:", "");
    assert.deepEqual(Buffer.from(bytes), Buffer.from(`exact concurrent artifact bytes:${label}`));
  }
  const restartCounters = { provider: 0, reserved: 0 };
  const restartApi = concurrentApi(reopened, "restart-replay", restartCounters);
  const restartReplay = await restartApi.invoke(actor(), sameConnection.firstBody);
  assert.equal(restartReplay.ok, true, JSON.stringify(restartReplay));
  assert.equal(restartReplay.replayed, true);
  assert.equal(restartCounters.provider, 0, "restart replay uses the committed exact artifact without redispatch");
  const staleLoserReplay = await restartApi.invoke(actor(), staleLoserBody);
  assert.equal(staleLoserReplay.ok, true, JSON.stringify(staleLoserReplay));
  assert.equal(staleLoserReplay.replayed, true);
  assert.equal(staleLoserReplay.job.status, "failed");
  assert.equal(staleLoserReplay.job.error.code, "stale_version");
  assert.equal(restartCounters.provider, 0, "a recovered stale CAS outcome never redispatches");

  reopened.close();
  // Opt-in evidence capture is used only by the isolated runner; normal tests
  // leave their temporary database and object tree under the cleanup hook.
  const evidenceDbPath = process.env.CE_SQLITE_COMPLETION_EVIDENCE_DB;
  if (typeof evidenceDbPath === "string" && evidenceDbPath.length > 0) {
    const evidenceObjectPath = `${evidenceDbPath}.objects`;
    await cp(databasePath, evidenceDbPath, { force: false, errorOnExist: true });
    await cp(objectRoot, evidenceObjectPath, { recursive: true, force: false, errorOnExist: true });
    const evidenceDbBytes = await readFile(evidenceDbPath);
    t.diagnostic(JSON.stringify({ evidence_db_path: evidenceDbPath, evidence_db_bytes: evidenceDbBytes.byteLength,
      evidence_db_sha256: createHash("sha256").update(evidenceDbBytes).digest("hex"),
      evidence_object_path: evidenceObjectPath }));
  }
  await link(databasePath, hardLinkPath);
  assert.throws(() => new CreativeVersionStore({ databasePath: hardLinkPath,
    objectRoot: join(root, "hardlink-objects"), now: () => NOW }),
  (error) => error instanceof VersionStoreError && error.code === "unavailable" && error.field === "database.hard_link_alias");
  const hardLinkedDatabase = new DatabaseSync(hardLinkPath);
  assert.throws(() => createSqliteTelemetryOutbox({ database: hardLinkedDatabase }),
    (error) => error?.code === "telemetry_storage_unavailable");
  hardLinkedDatabase.close();
});

test("SQLite outbox writes wait behind held branch publication and preserve provider usage", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-sqlite-outbox-admission-"));
  t.after(async () => rm(root, { recursive: true, force: true }));

  const exercisePair = async ({ separateConnection, overlap, label }) => {
    const pairRoot = join(root, label);
    const databasePath = join(pairRoot, "versions.sqlite");
    const aliasPath = join(pairRoot, "versions-alias.sqlite");
    const objectRoot = join(pairRoot, "objects");
    const storeA = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
    t.after(() => storeA.close());
    let storeB = storeA;
    if (separateConnection) {
      await symlink(databasePath, aliasPath);
      storeB = new CreativeVersionStore({ databasePath: aliasPath, objectRoot, now: () => NOW });
      t.after(() => storeB.close());
    }
    storeA.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });

    const seedAction = `${label}-seed`;
    const countersA = { provider: 0, reserved: 0 };
    const countersB = { provider: 0, reserved: 0 };
    let portIdA = 0;
    let apiIdA = 0;
    let portIdB = 0;
    let apiIdB = 0;
    const portsA = portsFor(storeA, countersA, () => `${label}-a-port-${++portIdA}`);
    portsA.provider = concurrentProvider(`${label}-seed-artifact`, countersA);
    const apiA = createCreativeApi({ ports: portsA, now: () => NOW, idFactory: () => `${label}-a-api-${++apiIdA}` });
    const seeded = await apiA.invoke(actor(), request(seedAction, await fixture("generate-plan")));
    assert.equal(seeded.ok, true, JSON.stringify(seeded));
    const parent = seeded.result.design_version;
    portsA.provider = concurrentProvider(`${label}-branch-a-artifact`, countersA);

    const providerEntered = deferred();
    const providerRelease = deferred();
    const providerReturned = deferred();
    const usageWriteEntered = deferred();
    const publicationEntered = deferred();
    const publicationRelease = deferred();
    t.after(() => {
      providerRelease.resolve();
      publicationRelease.resolve();
    });
    const actionA = `${label}-branch-a`;
    const actionB = `${label}-branch-b`;
    const portsB = portsFor(storeB, countersB, () => `${label}-b-port-${++portIdB}`);
    portsB.provider = concurrentProvider(`${label}-branch-b-artifact`, countersB, async () => {
      providerEntered.resolve();
      await providerRelease.promise;
      providerReturned.resolve();
    });
    const durableOutboxB = portsB.telemetry.outbox;
    const seedEventRows = storeA.db.prepare(`SELECT payload_json FROM creative_telemetry_evidence_outbox_v1
      WHERE json_extract(payload_json,'$.logical_operation_id')=? ORDER BY rowid`).all(seedAction);
    const seedEvents = seedEventRows.map((row) => JSON.parse(row.payload_json));
    const intentEvent = structuredClone(seedEvents.find((event) => event.event_type === "attempt_intent"));
    const outcomeEvent = structuredClone(seedEvents.find((event) => event.event_type === "attempt_outcome"));
    intentEvent.event_id = `${label}:mutation-append`;
    outcomeEvent.event_id = `${label}:mutation-stage`;
    const expectedAppendedEvent = structuredClone(intentEvent);
    const expectedStagedEvent = structuredClone(outcomeEvent);
    const seedObservationRow = storeA.db.prepare(`SELECT payload_json FROM creative_telemetry_observations_v1
      WHERE logical_operation_id=?`).get(seedAction);
    const seedObservation = JSON.parse(seedObservationRow.payload_json);
    const mutationAttempt = structuredClone(seedObservation.attempt);
    const mutationObservation = structuredClone(seedObservation.observation);
    mutationObservation.source_observation_id = `${label}:mutation-usage`;
    const expectedMutationObservationId = mutationObservation.source_observation_id;
    const claimableObservationSeeds = [];
    for (const index of [1, 2]) {
      const observation = structuredClone(seedObservation.observation);
      observation.source_observation_id = `${label}:claim-seed-${index}`;
      await durableOutboxB.enqueueUsageObservation({ attempt: seedObservation.attempt,
        trustedScope: { tenant_id: seedObservation.attempt.tenant_id, project_id: seedObservation.attempt.project_id,
          budget_scope_id: seedObservation.attempt.budget_scope_id }, observation });
      claimableObservationSeeds.push(observation);
    }
    const preclaimedObservations = await durableOutboxB.claimPending({ limit: 2 });
    assert.equal(preclaimedObservations.records.length, 2);
    const observationClaims = claimableObservationSeeds.map((observation) => {
      const row = preclaimedObservations.records.find((record) =>
        record.observation.source_observation_id === observation.source_observation_id);
      assert.ok(row);
      return row;
    });
    const preclaimedEvidence = await durableOutboxB.claimPendingEvidence({ limit: 2 });
    assert.equal(preclaimedEvidence.records.length, 2);
    const deliveredRootObservation = storeA.db.prepare(`SELECT record_ref,source_observation_id,billable_attempt_id
      FROM creative_telemetry_observations_v1 WHERE logical_operation_id=?`).get(seedAction);
    const outboxFailures = [];
    let bUsageWriteSettled = false;
    portsB.telemetry.outbox = Object.freeze({
      ...durableOutboxB,
      async append(event) {
        try { return await durableOutboxB.append(event); }
        catch (error) { outboxFailures.push({ method: "append", code: error?.code }); throw error; }
      },
      async stagePendingEvidence(event) {
        try { return await durableOutboxB.stagePendingEvidence(event); }
        catch (error) { outboxFailures.push({ method: "stagePendingEvidence", code: error?.code }); throw error; }
      },
      async enqueueUsageObservation(input) {
        if (input?.attempt?.logical_operation_id === actionB) usageWriteEntered.resolve();
        try {
          const result = await durableOutboxB.enqueueUsageObservation(input);
          if (input?.attempt?.logical_operation_id === actionB) bUsageWriteSettled = true;
          return result;
        }
        catch (error) { outboxFailures.push({ method: "enqueueUsageObservation", code: error?.code }); throw error; }
      },
    });
    let usageAuthorityDurableRow;
    let unknownHolds = 0;
    let settlements = 0;
    const meteringB = portsB.metering;
    portsB.metering = {
      ...meteringB,
      async recordUsageObservation(input) {
        usageAuthorityDurableRow = storeA.db.prepare(`SELECT status,payload_json FROM creative_telemetry_observations_v1
          WHERE source_observation_id=?`).get(input.observation.source_observation_id);
        return meteringB.recordUsageObservation(input);
      },
      async settleReservation(...args) {
        settlements += 1;
        return meteringB.settleReservation(...args);
      },
      async markOutcomeUnknown(...args) {
        unknownHolds += 1;
        return meteringB.markOutcomeUnknown(...args);
      },
    };
    const portsAStorageCommit = portsA.storage.commitPreparedDesignVersion.bind(portsA.storage);
    portsA.storage.commitPreparedDesignVersion = async (...args) => {
      publicationEntered.resolve();
      await publicationRelease.promise;
      return portsAStorageCommit(...args);
    };

    const apiB = createCreativeApi({ ports: portsB, now: () => NOW, idFactory: () => `${label}-b-api-${++apiIdB}` });
    const makeEditBody = async (actionId) => {
      const plan = await fixture("edit-plan");
      plan.base = { brief_hash: parent.brief_hash, design_hash: parent.design_hash,
        design_version_id: parent.design_version_id };
      for (const step of plan.steps) {
        if (step.parameters.design_version_id !== undefined) step.parameters.design_version_id = parent.design_version_id;
        if (step.parameters.artifact_id !== undefined) step.parameters.artifact_id = parent.artifact.artifact_id;
      }
      plan.expected_result.parent_version_id = parent.design_version_id;
      return { ...request(actionId, plan), operation: "edit",
        payload: { brief_id: SCOPE.brief_id, design_version_id: parent.design_version_id,
          selection_mode: "branch", plan } };
    };
    const bodyA = await makeEditBody(actionA);
    const bodyB = await makeEditBody(actionB);
    const apiAForBranch = createCreativeApi({ ports: portsA, now: () => NOW, idFactory: () => `${label}-a-api-${++apiIdA}` });
    const pendingB = apiB.invoke(actor(), bodyB);
    let bSettled = false;
    pendingB.then(() => { bSettled = true; }, () => { bSettled = true; });
    await providerEntered.promise;
    const pendingA = apiAForBranch.invoke(actor(), bodyA);
    let aSettled = false;
    pendingA.then(() => { aSettled = true; }, () => { aSettled = true; });
    await publicationEntered.promise;
    assert.equal(storeA.db.isTransaction, true, "A is held inside its real publication transaction");
    assert.throws(() => createSqliteTelemetryOutbox({ database: storeA.db, clock: () => NOW }),
      (error) => error?.code === "telemetry_outer_transaction_active");
    assert.throws(() => new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW }),
      (error) => error instanceof VersionStoreError && error.code === "unavailable");

    const queuedWriterPromises = [];
    let mutationEvents;
    let queuedClaims;
    let queuedAcknowledgements;
    if (overlap) {
      providerRelease.resolve();
      await providerReturned.promise;
      await usageWriteEntered.promise;
      assert.equal(aSettled, false, "A remains in publication while B receives its provider result");
      assert.equal(bSettled, false, "B waits for durable local usage before publication can proceed");
      assert.equal(bUsageWriteSettled, false, "B usage admission remains queued until A commits");

      const outbox = portsB.telemetry.outbox;
      const appendPromise = outbox.append(intentEvent);
      intentEvent.logical_operation_id = `${label}:mutated-after-append-call`;
      intentEvent.provider.name = "mutated-after-append-call";
      const stagePromise = outbox.stagePendingEvidence(outcomeEvent);
      outcomeEvent.logical_operation_id = `${label}:mutated-after-stage-call`;
      outcomeEvent.provider.name = "mutated-after-stage-call";

      const usagePromise = outbox.enqueueUsageObservation({ attempt: mutationAttempt,
        trustedScope: { tenant_id: mutationAttempt.tenant_id, project_id: mutationAttempt.project_id,
          budget_scope_id: mutationAttempt.budget_scope_id }, observation: mutationObservation });
      mutationAttempt.logical_operation_id = `${label}:mutated-after-usage-call`;
      mutationObservation.source_observation_id = `${label}:mutated-after-usage-call`;

      const queuedClaim = outbox.claimPending({ limit: 2 });
      const queuedEvidenceClaim = outbox.claimPendingEvidence({ limit: 2 });
      const ackEnqueued = outbox.acknowledgeEnqueuedObservation({ record_ref: deliveredRootObservation.record_ref,
        source_observation_id: deliveredRootObservation.source_observation_id,
        effective_billable_attempt_id: deliveredRootObservation.billable_attempt_id, authority_status: "duplicate" });
      const ackObservation = outbox.acknowledge({ record_ref: observationClaims[0].record_ref,
        claim_token: observationClaims[0].claim_token,
        source_observation_id: observationClaims[0].observation.source_observation_id,
        effective_billable_attempt_id: observationClaims[0].attempt.billable_attempt_id, authority_status: "accepted" });
      const deferObservation = outbox.defer({ record_ref: observationClaims[1].record_ref,
        claim_token: observationClaims[1].claim_token, reason: "metering_observation_unconfirmed" });
      const ackEvidence = outbox.acknowledgeEvidence({ event_id: preclaimedEvidence.records[0].event.event_id,
        claim_token: preclaimedEvidence.records[0].claim_token });
      const deferEvidence = outbox.deferEvidence({ event_id: preclaimedEvidence.records[1].event.event_id,
        claim_token: preclaimedEvidence.records[1].claim_token, reason: "sink_unavailable" });
      queuedWriterPromises.push(appendPromise, stagePromise, usagePromise, queuedClaim, queuedEvidenceClaim,
        ackEnqueued, ackObservation, deferObservation, ackEvidence, deferEvidence);
      mutationEvents = { expectedAppendedEvent, expectedStagedEvent, expectedMutationObservationId };
      queuedClaims = { queuedClaim, queuedEvidenceClaim };
      queuedAcknowledgements = { ackEnqueued, ackObservation, deferObservation, ackEvidence, deferEvidence };
      let queuedWriteSettlements = 0;
      for (const promise of queuedWriterPromises) promise.then(() => { queuedWriteSettlements += 1; },
        () => { queuedWriteSettlements += 1; });
      assert.equal(queuedWriteSettlements, 0, "all queued outbox mutations wait behind A's live write owner");
    }

    publicationRelease.resolve();
    const responseA = await pendingA;
    if (!responseA.ok) t.diagnostic(`${label}: A failed ${JSON.stringify({ error: responseA.error,
      job: storeA.db.prepare("SELECT status,error_json FROM creative_jobs WHERE action_id=?").get(actionA),
      selection: storeA.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }), outboxFailures })}`);
    assert.equal(responseA.ok, true, JSON.stringify(responseA));
    if (!overlap) providerRelease.resolve();
    const responseB = await pendingB;
    assert.equal(responseB.ok, true, JSON.stringify(responseB));
    await Promise.all(queuedWriterPromises);
    assert.equal(countersA.provider, 2, "the seed and A each dispatch once");
    assert.equal(countersB.provider, 1, "B dispatches once");
    assert.equal(responseA.result.design_version.parent_version_id, parent.design_version_id);
    assert.equal(responseB.result.design_version.parent_version_id, parent.design_version_id);
    assert.equal(storeA.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }).design_version_id,
      parent.design_version_id, "both explicit branches leave the selected root unchanged");
    assert.deepEqual(outboxFailures, []);
    assert.ok(usageAuthorityDurableRow, "metering authority was called only after B usage had a durable outbox row");
    const bUsagePayload = JSON.parse(usageAuthorityDurableRow.payload_json);
    assert.equal(bUsagePayload.attempt.logical_operation_id, actionB);
    assert.equal(bUsagePayload.attempt.billable_attempt_id, responseB.result.design_version.billable_attempt_id);
    assert.equal(bUsagePayload.observation.completeness, "complete");
    assert.deepEqual(bUsagePayload.observation.usage_units, [
      { name: "input_tokens", quantity: "2", relation: "standalone" },
      { name: "output_tokens", quantity: "4", relation: "standalone" },
    ]);
    assert.equal(usageAuthorityDurableRow.status, "pending", "the outbox row exists before Finance acknowledgment");
    assert.equal(settlements, 1);
    assert.equal(unknownHolds, 0, "a durable provider result is settled rather than held unknown");
    const bOutcomeRow = storeA.db.prepare(`SELECT payload_json FROM creative_telemetry_evidence_outbox_v1
      WHERE event_type='attempt_outcome' AND json_extract(payload_json,'$.logical_operation_id')=?`).get(actionB);
    assert.ok(bOutcomeRow, "provider outcome evidence is persisted");
    assert.equal(JSON.parse(bOutcomeRow.payload_json).provider_outcome, "succeeded");
    assert.equal(storeA.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?").get(actionB).status, "completed");
    assert.deepEqual(Buffer.from(await storeA.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
      design_version_id: responseB.result.design_version.design_version_id })),
    Buffer.from(`exact concurrent artifact bytes:${label}-branch-b-artifact`));

    if (overlap) {
      const appended = JSON.parse(storeA.db.prepare(`SELECT payload_json FROM creative_telemetry_evidence_outbox_v1
        WHERE event_id=?`).get(mutationEvents.expectedAppendedEvent.event_id).payload_json);
      const staged = JSON.parse(storeA.db.prepare(`SELECT payload_json FROM creative_telemetry_evidence_outbox_v1
        WHERE event_id=?`).get(mutationEvents.expectedStagedEvent.event_id).payload_json);
      assert.equal(canonicalSerialize(appended), canonicalSerialize(mutationEvents.expectedAppendedEvent));
      assert.equal(canonicalSerialize(staged), canonicalSerialize(mutationEvents.expectedStagedEvent));
      const stableUsage = storeA.db.prepare(`SELECT payload_json FROM creative_telemetry_observations_v1
        WHERE source_observation_id=?`).get(mutationEvents.expectedMutationObservationId);
      assert.ok(stableUsage);
      assert.equal(JSON.parse(stableUsage.payload_json).attempt.logical_operation_id, seedAction);
      assert.equal(JSON.parse(stableUsage.payload_json).observation.source_observation_id,
        mutationEvents.expectedMutationObservationId);
      const [claimedUsage, claimedEvidence] = await Promise.all([queuedClaims.queuedClaim, queuedClaims.queuedEvidenceClaim]);
      assert.equal(claimedUsage.status, "claimed");
      assert.equal(claimedEvidence.status, "claimed");
      const results = await Promise.all(Object.values(queuedAcknowledgements));
      assert.equal(results[0].status, "acknowledged");
      assert.equal(results[1].status, "acknowledged");
      assert.equal(results[2].status, "retained");
      assert.equal(results[3].status, "acknowledged");
      assert.equal(results[4].status, "retained");
    }

    storeA.close();
    if (storeB !== storeA) storeB.close();
    const reopened = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
    const recovery = await reopened.recover();
    assert.equal(recovery.unknown, 0);
    assert.equal(reopened.db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
    assert.deepEqual(reopened.db.prepare("PRAGMA foreign_key_check").all(), []);
    const recoveredUsage = reopened.db.prepare(`SELECT payload_json FROM creative_telemetry_observations_v1
      WHERE logical_operation_id=?`).get(actionB);
    assert.ok(recoveredUsage, "B usage survives Store close and reopen");
    assert.equal(JSON.parse(recoveredUsage.payload_json).attempt.billable_attempt_id,
      responseB.result.design_version.billable_attempt_id);
    assert.deepEqual(Buffer.from(await reopened.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
      design_version_id: responseB.result.design_version.design_version_id })),
    Buffer.from(`exact concurrent artifact bytes:${label}-branch-b-artifact`));
    reopened.close();
    const evidenceRoot = process.env.CE_SQLITE_PR50_F1_EVIDENCE_ROOT;
    if (overlap && typeof evidenceRoot === "string" && evidenceRoot.length > 0) {
      const evidenceDbPath = join(evidenceRoot, `${label}.sqlite`);
      const evidenceObjectPath = `${evidenceDbPath}.objects`;
      await cp(databasePath, evidenceDbPath, { force: false, errorOnExist: true });
      await cp(objectRoot, evidenceObjectPath, { recursive: true, force: false, errorOnExist: true });
      const databaseBytes = await readFile(evidenceDbPath);
      const objectFiles = [];
      const collectObjects = async (directory, relative = "") => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
          const childPath = join(directory, entry.name);
          if (entry.isDirectory()) await collectObjects(childPath, childRelative);
          else if (entry.isFile()) {
            const bytes = await readFile(childPath);
            objectFiles.push({ path: childRelative, bytes: bytes.byteLength,
              sha256: createHash("sha256").update(bytes).digest("hex") });
          }
        }
      };
      await collectObjects(evidenceObjectPath);
      objectFiles.sort((left, right) => left.path.localeCompare(right.path));
      t.diagnostic(JSON.stringify({ f1_evidence_db_path: evidenceDbPath,
        database_bytes: databaseBytes.byteLength,
        database_sha256: createHash("sha256").update(databaseBytes).digest("hex"),
        evidence_object_path: evidenceObjectPath, object_files: objectFiles }));
    }
  };

  for (const separateConnection of [false, true]) {
    const identity = separateConnection ? "two-connections" : "one-connection";
    await exercisePair({ separateConnection, overlap: true, label: `f1-overlap-${identity}` });
    await exercisePair({ separateConnection, overlap: false, label: `f1-control-${identity}` });
  }
});

for (const separateConnection of [false, true]) for (const overlap of [false, true]) {
  test(`public inspection waits through explicit-parent publication (separateConnection=${separateConnection}, overlap=${overlap})`, async (t) => {
    // This is a fixture-only API composition using generated valid PNG bytes and injected offline adapters.
    const root = await mkdtemp(join(tmpdir(), "creative-inspection-publication-admission-"));
    t.after(async () => rm(root, { recursive: true, force: true }));
    const databasePath = join(root, "versions.sqlite");
    const objectRoot = join(root, "objects");
    const storeA = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
    t.after(() => storeA.close());
    const storeB = separateConnection
      ? new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW }) : storeA;
    if (storeB !== storeA) t.after(() => storeB.close());
    storeA.putBrief({ scope: SCOPE, brief: await fixture("brief") });

    let id = 0;
    const countersA = { provider: 0, reserved: 0 };
    const countersB = { provider: 0, reserved: 0, inspection: 0, decision: 0 };
    const portsA = portsFor(storeA, countersA, () => `inspection-admission-a-port-${++id}`,
      { artifactBytes: Buffer.from(makePng(16, 16)) });
    const apiA = createCreativeApi({ ports: portsA, now: () => NOW,
      idFactory: () => `inspection-admission-a-api-${++id}` });
    const seeded = await apiA.invoke(actor(), request("inspection-admission-seed", await fixture("generate-plan")));
    assert.equal(seeded.ok, true, JSON.stringify(seeded));
    const parent = seeded.result.design_version;

    const portsB = attachInspectionPorts(portsFor(storeB, countersB,
      () => `inspection-admission-b-port-${++id}`), countersB);
    const artifactEntered = deferred();
    const artifactRelease = deferred();
    const publicationEntered = deferred();
    const publicationRelease = deferred();
    const repairReadEntered = deferred();
    t.after(() => {
      artifactRelease.resolve();
      publicationRelease.resolve();
    });

    // Hold inspection after its SQLite artifact read has released the queue.
    // This lets the unrelated branch publication become the active writer.
    const readArtifactBytes = portsB.storage.getArtifactBytes;
    portsB.storage.getArtifactBytes = async (...args) => {
      const result = await readArtifactBytes(...args);
      artifactEntered.resolve();
      await artifactRelease.promise;
      return result;
    };
    const durableRepairPort = portsB.storage.inspectionRepair;
    portsB.storage.inspectionRepair = Object.freeze({
      ...durableRepairPort,
      async startInspection(input) {
        repairReadEntered.resolve();
        return durableRepairPort.startInspection(input);
      },
    });

    const commitPrepared = portsA.storage.commitPreparedDesignVersion;
    portsA.storage.commitPreparedDesignVersion = async (...args) => {
      publicationEntered.resolve();
      await publicationRelease.promise;
      return commitPrepared(...args);
    };
    const apiB = createCreativeApi({ ports: portsB, now: () => NOW,
      idFactory: () => `inspection-admission-b-api-${++id}` });
    const inspectBody = inspectionRequest("inspection-admission-public-inspect", parent.design_version_id);
    let pendingB;
    let inspectionSettled = false;
    let pendingA;
    try {
      pendingB = apiB.invoke({ ...actor(), permissions: [...actor().permissions, "creative.inspect"] }, inspectBody);
      pendingB.then(() => { inspectionSettled = true; }, () => { inspectionSettled = true; });
      await artifactEntered.promise;

      const plan = await fixture("edit-plan");
      plan.base = { brief_hash: parent.brief_hash, design_hash: parent.design_hash,
        design_version_id: parent.design_version_id };
      for (const step of plan.steps) {
        if (step.parameters.design_version_id !== undefined) step.parameters.design_version_id = parent.design_version_id;
        if (step.parameters.artifact_id !== undefined) step.parameters.artifact_id = parent.artifact.artifact_id;
      }
      plan.expected_result.parent_version_id = parent.design_version_id;
      const editBody = { ...request("inspection-admission-explicit-parent-edit", plan), operation: "edit",
        payload: { brief_id: SCOPE.brief_id, design_version_id: parent.design_version_id,
          selection_mode: "branch", plan } };
      pendingA = apiA.invoke(actor(), editBody);
      await publicationEntered.promise;
      assert.equal(storeA.db.isTransaction, true, "A holds its real publication transaction at the barrier");

      if (overlap) {
        artifactRelease.resolve();
        await repairReadEntered.promise;
        await Promise.resolve();
        assert.equal(inspectionSettled, false,
          "B waits behind the held publication instead of failing on a borrowed transaction or SQLite busy timeout");
        publicationRelease.resolve();
      } else {
        // Positive control: finish A before B reaches inspection admission.
        publicationRelease.resolve();
        const completedA = await pendingA;
        assert.equal(completedA.ok, true, JSON.stringify(completedA));
        artifactRelease.resolve();
      }

      const [resultA, resultB] = await Promise.all([pendingA, pendingB]);
      assert.equal(resultA.ok, true, JSON.stringify(resultA));
      assert.equal(resultB.ok, true, JSON.stringify(resultB));
      assert.equal(countersA.provider, 2, "seed and explicit-parent edit each dispatch exactly once");
      assert.equal(countersB.inspection, 1, "inspection runs exactly once after admission");
      assert.equal(countersB.reserved, 3, "the fixture observer and two decision stages each reserve once");
      assert.equal(countersB.decision, 2, "the fixture inspection performs both decision stages");
      assert.equal(resultA.result.design_version.parent_version_id, parent.design_version_id);
      const selection = storeA.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
      assert.equal(selection.design_version_id, parent.design_version_id,
        "an explicit-parent branch publication leaves the current selection on the root");
      assert.equal(resultB.result.report.contract, "CreativeInspectionReport");
      assert.equal(resultB.result.report.design_version_id, parent.design_version_id);
      assert.equal(resultB.result.report.artifact_id, parent.artifact.artifact_id);
      assert.equal(resultB.result.report.artifact_hash, parent.artifact.content_hash);
      assert.equal(resultB.result.report.limits.usage_completeness, "complete");
      assert.equal(resultB.result.attempt_ids.length, 3);
      assert.equal(resultB.result.telemetry_evidence.length, 3);
      const storedSession = storeA.db.prepare(`SELECT status,result_json,result_hash
        FROM creative_inspection_sessions_v1 WHERE action_id=?`).get(inspectBody.action_id);
      assert.equal(storedSession.status, "completed");
      assert.equal(storedSession.result_hash, canonicalHash(JSON.parse(storedSession.result_json)));
      const usageRows = storeA.db.prepare(`SELECT status,logical_operation_id,billable_attempt_id,payload_json
        FROM creative_telemetry_observations_v1 WHERE logical_operation_id=?`).all(inspectBody.action_id);
      assert.equal(usageRows.length, 3);
      assert.ok(usageRows.every((row) => row.status === "delivered" && row.logical_operation_id === inspectBody.action_id &&
        resultB.result.attempt_ids.includes(row.billable_attempt_id) &&
        JSON.parse(row.payload_json).attempt.billable_attempt_id === row.billable_attempt_id &&
        JSON.parse(row.payload_json).observation.completeness === "complete"),
      "the inspection report is supported by three complete, durably acknowledged fixture usage records");
      assert.equal(new Set(usageRows.map((row) => row.billable_attempt_id)).size, 3,
        "each fixture inspection stage has distinct durable attempt evidence");
      assert.deepEqual(Buffer.from(await storeA.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
        design_version_id: resultA.result.design_version.design_version_id })), Buffer.from(makePng(16, 16)));
      assert.equal(storeA.db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
      assert.deepEqual(storeA.db.prepare("PRAGMA foreign_key_check").all(), []);
    } finally {
      artifactRelease.resolve();
      publicationRelease.resolve();
    }
  });
}

test("public inspection repair admission rejects caller BEGIN and SAVEPOINT without changing either transaction", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-inspection-caller-transaction-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  const adapter = createCreativeVersionApiPorts({ store }).ports;
  store.db.exec("CREATE TABLE caller_transaction_sentinel (value TEXT PRIMARY KEY) STRICT;");
  store.db.prepare("INSERT INTO caller_transaction_sentinel(value) VALUES (?)").run("committed-before-test");
  const beforeRows = store.db.prepare("SELECT count(*) AS count FROM creative_inspection_state_v1").get().count;
  const beforeActions = store.db.prepare("SELECT count(*) AS count FROM creative_inspection_action_v2").get().count;

  for (const scenario of [
    { name: "BEGIN", open: () => store.db.exec("BEGIN IMMEDIATE;"), close: () => store.db.exec("ROLLBACK;") },
    { name: "SAVEPOINT", open: () => store.db.exec("SAVEPOINT caller_inspection_admission;"),
      close: () => { store.db.exec("ROLLBACK TO caller_inspection_admission;"); store.db.exec("RELEASE caller_inspection_admission;"); } },
  ]) {
    scenario.open();
    store.db.prepare("INSERT INTO caller_transaction_sentinel(value) VALUES (?)").run(`uncommitted-${scenario.name}`);
    try {
      assert.equal(store.db.isTransaction, true, `${scenario.name} is open before the public adapter call`);
      await assert.rejects(adapter.storage.inspectionRepair.startInspection({ scope: { ...SCOPE,
        design_version_id: `design-caller-${scenario.name.toLowerCase()}` }, inspection_id: `inspection-${scenario.name.toLowerCase()}`,
        brief_hash: canonicalHash("caller transaction brief"), design_hash: canonicalHash("caller transaction design") }),
      (error) => error instanceof VersionStoreError && error.code === "unavailable" &&
        error.field === "inspection.transaction");
      assert.equal(store.db.isTransaction, true, `${scenario.name} remains open after rejection`);
      assert.equal(store.db.prepare("SELECT count(*) AS count FROM caller_transaction_sentinel").get().count, 2,
        `${scenario.name} retains its uncommitted caller sentinel`);
      assert.equal(store.db.prepare("SELECT count(*) AS count FROM creative_inspection_state_v1").get().count, beforeRows);
      assert.equal(store.db.prepare("SELECT count(*) AS count FROM creative_inspection_action_v2").get().count, beforeActions);
    } finally {
      scenario.close();
    }
    assert.equal(store.db.isTransaction, false, `${scenario.name} cleanup closes only its caller transaction`);
    assert.equal(store.db.prepare("SELECT count(*) AS count FROM caller_transaction_sentinel").get().count, 1,
      `${scenario.name} rollback leaves only the previously committed sentinel`);
  }
});

test("SQLite reentrancy expires with its operation and cannot leak through detached async context", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-sqlite-context-lifetime-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const first = createCreativeVersionApiPorts({ store }).ports;
  const second = createCreativeVersionApiPorts({ store }).ports;
  const originalGetBrief = store.getBrief.bind(store);
  let reentrantChildEntered = false;
  store.getBrief = (input) => {
    if (input.test_mode === "outer-reentrant") {
      return second.storage.getBrief({ ...input, test_mode: "inner-reentrant" });
    }
    if (input.test_mode === "inner-reentrant") reentrantChildEntered = true;
    return originalGetBrief(input);
  };
  assert.ok(await first.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id, test_mode: "outer-reentrant" }));
  assert.equal(reentrantChildEntered, true, "an active callback may reenter through another factory on the same connection");

  const aliasPath = join(root, "versions-symlink.sqlite");
  await symlink(join(root, "versions.sqlite"), aliasPath);
  const aliasStore = new CreativeVersionStore({ databasePath: aliasPath,
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => aliasStore.close());
  const aliasPorts = createCreativeVersionApiPorts({ store: aliasStore }).ports;
  store.getBrief = (input) => {
    if (input.test_mode === "cross-connection-nested") {
      return aliasPorts.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id });
    }
    return originalGetBrief(input);
  };
  await assert.rejects(first.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id,
    test_mode: "cross-connection-nested" }),
  (error) => error instanceof VersionStoreError && error.code === "unavailable" && error.field === "database.cross_connection");
  store.getBrief = originalGetBrief;
  assert.ok(await second.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id }),
    "a rejected nested cross-connection call releases the queue");

  store.getBrief = (input) => {
    if (input.test_mode === "sync-throw") throw new Error("focused synchronous callback failure");
    return originalGetBrief(input);
  };
  await assert.rejects(first.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id,
    test_mode: "sync-throw" }), /focused synchronous callback failure/);
  store.getBrief = originalGetBrief;
  assert.ok(await second.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id }),
    "a synchronous queued callback failure releases the shared scheduler");

  const childGate = deferred();
  const childScheduled = deferred();
  const childAttempted = deferred();
  const childFinished = deferred();
  const holdEntered = deferred();
  let releaseHold;
  let childEntered = false;
  store.getBrief = (input) => {
    if (input.test_mode === "seed") {
      setImmediate(async () => {
        childScheduled.resolve();
        await childGate.promise;
        childAttempted.resolve();
        try { childFinished.resolve(await second.storage.getBrief({ ...input, test_mode: "child" })); }
        catch (error) { childFinished.reject(error); }
      });
      return originalGetBrief(input);
    }
    if (input.test_mode === "hold") {
      holdEntered.resolve();
      return new Promise((resolve) => { releaseHold = () => resolve(originalGetBrief(input)); });
    }
    if (input.test_mode === "child") childEntered = true;
    return originalGetBrief(input);
  };

  await first.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id, test_mode: "seed" });
  await childScheduled.promise;
  const holding = first.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id, test_mode: "hold" });
  await holdEntered.promise;
  childGate.resolve();
  await childAttempted.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(childEntered, false, "a settled operation's inherited ALS context cannot bypass the active database queue");
  releaseHold();
  await holding;
  assert.ok(await childFinished.promise);
  assert.equal(childEntered, true, "the detached child runs after the current serialized owner releases");

  // A detached child keeps the old AsyncLocalStorage context after the old
  // Store closes, but a reopened same-path Store has a fresh scheduler owner.
  const staleContextGate = deferred();
  const staleChildScheduled = deferred();
  const staleChildAttempted = deferred();
  const staleChildFinished = deferred();
  store.getBrief = (input) => {
    if (input.test_mode === "stale-context-seed") {
      setImmediate(async () => {
        staleChildScheduled.resolve();
        await staleContextGate.promise;
        staleChildAttempted.resolve();
        try { staleChildFinished.resolve(await reopenedPorts.storage.getBrief({
          scope: SCOPE, brief_id: SCOPE.brief_id, test_mode: "stale-context-child",
        })); } catch (error) { staleChildFinished.reject(error); }
      });
    }
    return originalGetBrief(input);
  };
  await first.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id, test_mode: "stale-context-seed" });
  await staleChildScheduled.promise;
  store.close();
  aliasStore.close();
  const reopenedStore = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => reopenedStore.close());
  const reopenedPorts = createCreativeVersionApiPorts({ store: reopenedStore }).ports;
  const originalReopenedGetBrief = reopenedStore.getBrief.bind(reopenedStore);
  const reopenedHoldEntered = deferred();
  const releaseReopened = deferred();
  let staleChildEntered = false;
  reopenedStore.getBrief = (input) => {
    if (input.test_mode === "reopened-hold") {
      reopenedHoldEntered.resolve();
      return releaseReopened.promise.then(() => originalReopenedGetBrief(input));
    }
    if (input.test_mode === "stale-context-child") staleChildEntered = true;
    return originalReopenedGetBrief(input);
  };
  const reopenedHolding = reopenedPorts.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id,
    test_mode: "reopened-hold" });
  await reopenedHoldEntered.promise;
  staleContextGate.resolve();
  await staleChildAttempted.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(staleChildEntered, false, "an old context cannot reenter the reopened same-inode scheduler");
  releaseReopened.resolve();
  await reopenedHolding;
  assert.ok(await staleChildFinished.promise);
  assert.equal(staleChildEntered, true);
  await assert.rejects(first.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id }),
    (error) => error instanceof VersionStoreError && error.code === "unavailable");
});

test("SQLite in-memory schedulers are shared only by the same DatabaseSync instance", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-sqlite-memory-scheduler-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const firstStore = new CreativeVersionStore({ databasePath: ":memory:", objectRoot: join(root, "first-objects"), now: () => NOW });
  const secondStore = new CreativeVersionStore({ databasePath: ":memory:", objectRoot: join(root, "second-objects"), now: () => NOW });
  t.after(() => firstStore.close());
  t.after(() => secondStore.close());
  for (const store of [firstStore, secondStore]) {
    store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  }
  const firstFactory = createCreativeVersionApiPorts({ store: firstStore }).ports;
  const secondFactory = createCreativeVersionApiPorts({ store: firstStore }).ports;
  const independentFactory = createCreativeVersionApiPorts({ store: secondStore }).ports;
  const originalGetBrief = firstStore.getBrief.bind(firstStore);
  const holdEntered = deferred();
  const releaseHold = deferred();
  let secondFactoryEntered = false;
  firstStore.getBrief = (input) => {
    if (input.test_mode === "held-memory-read") {
      holdEntered.resolve();
      return releaseHold.promise.then(() => originalGetBrief(input));
    }
    if (input.test_mode === "same-memory-instance-queued") secondFactoryEntered = true;
    return originalGetBrief(input);
  };
  const held = firstFactory.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id,
    test_mode: "held-memory-read" });
  await holdEntered.promise;
  assert.ok(await independentFactory.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id }),
    "an independent :memory: connection has an independent scheduler");
  const queued = secondFactory.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id,
    test_mode: "same-memory-instance-queued" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(secondFactoryEntered, false, "two factories over one :memory: connection share queue ownership");
  releaseHold.resolve();
  await held;
  assert.ok(await queued);
  assert.equal(secondFactoryEntered, true);
});

test("SQLite admission queues remain independent for distinct database files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-sqlite-independent-files-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const firstStore = new CreativeVersionStore({ databasePath: join(root, "first.sqlite"),
    objectRoot: join(root, "first-objects"), now: () => NOW });
  const secondStore = new CreativeVersionStore({ databasePath: join(root, "second.sqlite"),
    objectRoot: join(root, "second-objects"), now: () => NOW });
  t.after(() => firstStore.close());
  t.after(() => secondStore.close());
  for (const store of [firstStore, secondStore]) {
    store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  }
  const first = createCreativeVersionApiPorts({ store: firstStore }).ports;
  const second = createCreativeVersionApiPorts({ store: secondStore }).ports;
  const originalGetBrief = firstStore.getBrief.bind(firstStore);
  const holdEntered = deferred();
  const releaseHold = deferred();
  firstStore.getBrief = (input) => {
    if (input.test_mode === "held-distinct-file") {
      holdEntered.resolve();
      return releaseHold.promise.then(() => originalGetBrief(input));
    }
    return originalGetBrief(input);
  };
  const held = first.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id,
    test_mode: "held-distinct-file" });
  await holdEntered.promise;
  assert.ok(await second.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id }),
    "unrelated database work completes while the first file has a held owner");
  releaseHold.resolve();
  assert.ok(await held);
});

test("failed SQLite construction closes the handle and permits a clean retry at the same path", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-sqlite-constructor-cleanup-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, "versions.sqlite");
  await writeFile(databasePath, "not a SQLite database");
  assert.throws(() => new CreativeVersionStore({ databasePath, objectRoot: join(root, "objects"), now: () => NOW }),
    (error) => error instanceof VersionStoreError && error.code === "unavailable");
  await unlink(databasePath);
  const store = new CreativeVersionStore({ databasePath, objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  assert.equal(store.db.prepare("PRAGMA foreign_keys").get().foreign_keys, 1);
  const adapter = createCreativeVersionApiPorts({ store }).ports;
  assert.equal(typeof adapter.storage.getBrief, "function");
});

test("SQLite caller transactions remain untouched and external handoff reads stay outside the DB queue", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-sqlite-boundaries-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const unrelatedStore = new CreativeVersionStore({ databasePath: join(root, "unrelated.sqlite"),
    objectRoot: join(root, "unrelated-objects"), now: () => NOW });
  t.after(() => unrelatedStore.close());
  unrelatedStore.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  const adapter = createCreativeVersionApiPorts({ store, otherPorts: { storage: {
    async getHandoffContext() {
      assert.equal(store.db.isTransaction, false, "external context must not run under a SQLite write transaction");
      await externalGate.promise;
      return null;
    },
  } } });
  const externalGate = deferred();
  const externalRead = adapter.storage.getHandoffContext({});
  assert.equal(typeof externalRead?.then, "function", "the injected read keeps its asynchronous API contract");
  const localRead = await adapter.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id });
  assert.ok(localRead, "an unresolved external read cannot hold the local SQLite scheduler");
  externalGate.resolve();
  assert.equal(await externalRead, null);

  const unrelatedAdapter = createCreativeVersionApiPorts({ store: unrelatedStore }).ports;
  const originalGetBrief = store.getBrief.bind(store);
  const localQueueEntered = deferred();
  const releaseLocalQueue = deferred();
  let lateFactoryEntered = false;
  store.getBrief = (input) => {
    if (input.hold_sqlite_queue) {
      localQueueEntered.resolve();
      return releaseLocalQueue.promise.then(() => originalGetBrief(input));
    }
    if (input.late_factory) lateFactoryEntered = true;
    return originalGetBrief(input);
  };
  const heldLocalRead = adapter.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id, hold_sqlite_queue: true });
  await localQueueEntered.promise;
  const lateFactory = createCreativeVersionApiPorts({ store }).ports;
  const lateFactoryRead = lateFactory.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id, late_factory: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateFactoryEntered, false, "a factory created during a queued DB operation joins its current owner queue");
  assert.ok(await unrelatedAdapter.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id }),
    "a waiting operation on one database cannot block an unrelated database");
  releaseLocalQueue.resolve();
  await heldLocalRead;
  assert.ok(await lateFactoryRead);
  assert.equal(lateFactoryEntered, true);
  store.getBrief = originalGetBrief;

  const throwingRead = createCreativeVersionApiPorts({ store, otherPorts: { storage: {
    getHandoffContext() { throw new Error("fixture handoff read failure"); },
  } } }).storage.getHandoffContext({});
  assert.equal(typeof throwingRead?.then, "function", "synchronous injected errors keep Promise rejection semantics");
  await assert.rejects(throwingRead, /fixture handoff read failure/);

  store.db.exec("BEGIN IMMEDIATE; SAVEPOINT caller_owned");
  await assert.rejects(adapter.jobs.completeIfActive({ operation: "generate" }, async () => {}),
    (error) => error instanceof VersionStoreError && error.code === "unavailable");
  assert.equal(store.db.isTransaction, true, "adapter rejection does not roll back a caller-owned transaction or savepoint");
  store.db.exec("ROLLBACK TO caller_owned; RELEASE caller_owned; ROLLBACK");
  assert.equal(store.db.isTransaction, false);
  assert.ok(await adapter.storage.getBrief({ scope: SCOPE, brief_id: SCOPE.brief_id }),
    "a rejected transaction boundary releases its scheduler slot");
});

test("independent Node processes serialize SQLite BEGIN IMMEDIATE without assuming a process-local queue", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-sqlite-cross-process-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, "versions.sqlite");
  const store = new CreativeVersionStore({ databasePath, objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.db.exec("BEGIN IMMEDIATE");

  const code = `import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv.at(-1));
db.exec("PRAGMA busy_timeout=5000;");
process.stdout.write("attempting\\n");
db.exec("BEGIN IMMEDIATE;");
process.stdout.write("acquired\\n");
db.exec("COMMIT;");
db.close();`;
  const childArgs = ["--input-type=module", "-e", code, databasePath];
  const child = spawn(process.execPath, childArgs, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGTERM"); });
  let stdout = "";
  let stderr = "";
  let signalAttempting;
  const attempting = new Promise((resolve) => { signalAttempting = resolve; });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal }));
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
    if (stdout.includes("attempting\n")) signalAttempting();
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  await attempting;
  assert.equal(child.exitCode, null, "the second process waits while the first owns BEGIN IMMEDIATE");
  store.db.exec("COMMIT");
  const exit = await exited;
  assert.deepEqual(exit, { code: 0, signal: null }, stderr);
  assert.match(stdout, /attempting\nacquired\n/);
  t.diagnostic(JSON.stringify({ executable: process.execPath, child_pid: child.pid,
    argv: [process.execPath, ...childArgs], exit_code: exit.code, signal: exit.signal,
    stdout_bytes: Buffer.byteLength(stdout), stdout_sha256: createHash("sha256").update(stdout).digest("hex"),
    stdout, stderr_bytes: Buffer.byteLength(stderr), stderr_sha256: createHash("sha256").update(stderr).digest("hex"), stderr }));
});

test("paired adapter refuses external handoff while a SQLite publication transaction would be open", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-handoff-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const brief = await fixture("brief");
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const adapter = createCreativeVersionApiPorts({ store, idFactory: (() => {
    let id = 0;
    return () => `handoff-adapter-id-${++id}`;
  })() });
  const action_id = "handoff-adapter-blocked";
  const request_hash = canonicalHash({ action_id, operation: "handoff" });
  const started = await adapter.jobs.begin({ scope: SCOPE, actor_id: "actor-api-1", action_id,
    request_hash, operation: "handoff" });
  assert.equal(started.kind, "started");
  let called = false;
  await assert.rejects(adapter.jobs.completeIfActive({ scope: SCOPE, actor_id: "actor-api-1",
    job_id: started.job_id, lease_token: started.lease_token, action_id, operation: "handoff",
    result: { receipt: { receipt_id: "receipt-fixture-1" } },
    publication_fence: { brief_id: SCOPE.brief_id, brief_hash: canonicalHash(brief) } }, async () => {
    called = true;
  }), (error) => error instanceof VersionStoreError && error.code === "unavailable");
  assert.equal(called, false, "external consumer submit callback must not run under SQLite write transaction");
  const job = store.db.prepare("SELECT status FROM creative_jobs WHERE job_id=?").get(started.job_id);
  assert.equal(job.status, "running");
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM creative_dispatch_intents WHERE job_id=?")
    .get(started.job_id).count, 0);
});

test("paired API reports handoff unavailable before verifier, context, destination, or consumer callbacks", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-handoff-preflight-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const brief = await fixture("brief");
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const calls = { context: 0, destination: 0, verify: 0, submit: 0 };
  const adapter = createCreativeVersionApiPorts({ store, otherPorts: {
    storage: { async getHandoffContext() { calls.context += 1; return null; } },
    handoff: {
      async resolveDestination() { calls.destination += 1; return { expected_audience: "fixture" }; },
      async submit() { calls.submit += 1; throw new Error("must not submit"); },
    },
    approval: { async verifyApproval() { calls.verify += 1; return { status: "verified" }; } },
  }, idFactory: () => "handoff-preflight-id" });
  const api = createCreativeApi({ ports: adapter.ports, now: () => NOW, idFactory: () => "handoff-preflight-api" });
  const body = { ...request("handoff-preflight-action", await fixture("generate-plan")), operation: "handoff",
    payload: { brief_id: SCOPE.brief_id, design_version_id: "not-read-before-preflight",
      approval_ref: "approval-fixture-1", destination_ref: "destination-fixture-1" } };
  const response = await api.invoke({ ...actor(), permissions: [...actor().permissions, "creative.handoff"] }, body);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "unavailable");
  assert.deepEqual(calls, { context: 0, destination: 0, verify: 0, submit: 0 });
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM creative_jobs WHERE action_id=?")
    .get("handoff-preflight-action").count, 0, "unsupported paired handoff must not create a misleading job");
});

test("cancelled dispatch cannot publish but its late worker can persist attempt evidence for reconciliation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-late-attempt-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const brief = await fixture("brief");
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const adapter = createCreativeVersionApiPorts({ store, idFactory: (() => {
    let id = 0; return () => `late-attempt-id-${++id}`;
  })() });
  const action_id = "cancelled-attempt-action";
  const request_hash = canonicalHash({ action_id, operation: "generate" });
  const started = await adapter.jobs.begin({ scope: SCOPE, actor_id: "actor-api-1", action_id,
    request_hash, operation: "generate" });
  const fence = { brief_id: SCOPE.brief_id, brief_hash: canonicalHash(brief),
    expected_current_design_version_id: null, expected_current_design_hash: null };
  assert.equal((await adapter.jobs.authorizeDispatch({ scope: SCOPE, actor_id: "actor-api-1",
    job_id: started.job_id, lease_token: started.lease_token, action_id, operation: "generate",
    billable_attempt_id: "billable-late-1", transport_attempt_id: "transport-late-1", context_fence: fence })).status,
  "authorized");
  const cancelled = await adapter.jobs.cancel({ scope: SCOPE, actor_id: "actor-api-1", job_id: started.job_id,
    target_action_id: action_id, action_id: "cancel-late-worker", request_hash: canonicalHash({ cancel: action_id }) });
  assert.equal(cancelled.kind, "cancelled");
  assert.equal((await adapter.jobs.authorizeDispatch({ scope: SCOPE, actor_id: "actor-api-1",
    job_id: started.job_id, lease_token: started.lease_token, action_id, operation: "generate",
    billable_attempt_id: "billable-late-1", transport_attempt_id: "transport-late-2", context_fence: fence })).status,
  "cancelled");
  const evidence = { job_id: started.job_id, action_id, actor_id: "actor-api-1", request_hash,
    logical_operation_id: action_id, billable_attempt_id: "billable-late-1",
    transport_attempt_ids: ["transport-late-1"], provider_request_ids: ["provider-late-1"],
    usage_refs: ["usage-late-1"], trace_refs: [] };
  assert.deepEqual(await adapter.jobs.recordAttemptEvidence({ scope: SCOPE, actor_id: "actor-api-1",
    job_id: started.job_id, lease_token: started.lease_token, action_id, request_hash, creation: evidence }),
  { status: "recorded" });
  const row = store.db.prepare("SELECT status,attempt_evidence_json FROM creative_jobs WHERE job_id=?").get(started.job_id);
  assert.equal(row.status, "cancelled");
  assert.deepEqual(JSON.parse(row.attempt_evidence_json), evidence);
});

test("actual paired API cancellation after dispatch fences publication and retains attempt evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-api-cancel-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const brief = await fixture("brief");
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const counters = { provider: 0, reserved: 0 };
  let portId = 0;
  let apiId = 0;
  const ports = portsFor(store, counters, () => `cancel-port-${++portId}`);
  let signalEntered;
  const entered = new Promise((resolve) => { signalEntered = resolve; });
  let releaseProvider;
  const providerGate = new Promise((resolve) => { releaseProvider = resolve; });
  const artifactBytes = Buffer.from("durable exact artwork bytes");
  const artifactHash = `sha256:${createHash("sha256").update(artifactBytes).digest("hex")}`;
  ports.provider.generate = async (input) => {
    counters.provider += 1;
    await input.recordTransportAttempt(input.transport_attempt_id);
    signalEntered();
    await providerGate;
    return { design_version_id: "design-cancelled-durable-1",
      artifact: { artifact_id: "artifact-cancelled-durable-1", content_hash: artifactHash, media_type: "image/png" },
      artifact_bytes: Uint8Array.from(artifactBytes), provider: "fixture-provider", model: "fixture-model",
      usage: { completeness: "complete", input_tokens: 2, output_tokens: 4 } };
  };
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `cancel-api-${++apiId}` });
  const pending = api.invoke(actor(), request("cancel-durable-dispatch", await fixture("generate-plan")));
  await entered;
  const job = store.db.prepare("SELECT job_id FROM creative_jobs WHERE action_id=?").get("cancel-durable-dispatch");
  assert.ok(job?.job_id);
  const cancelBody = { ...request("cancel-durable-dispatch-action", await fixture("generate-plan")),
    operation: "cancel", payload: { job_id: job.job_id } };
  const cancelled = await api.invoke(actor(), cancelBody);
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  assert.equal(cancelled.job.status, "cancelled");
  releaseProvider();
  const response = await pending;
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "cancelled");
  assert.equal(counters.provider, 1);
  const persistedJob = store.db.prepare("SELECT status,result_json,attempt_evidence_json FROM creative_jobs WHERE job_id=?")
    .get(job.job_id);
  assert.equal(persistedJob.status, "cancelled");
  assert.equal(persistedJob.result_json, null);
  const evidence = JSON.parse(persistedJob.attempt_evidence_json);
  assert.equal(typeof evidence.billable_attempt_id, "string");
  assert.equal(evidence.transport_attempt_ids.length, 1);
  assert.equal(evidence.usage_refs.length, 1);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions WHERE creation_job_id=?")
    .get(job.job_id).count, 0);
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM creation_actions WHERE job_id=?")
    .get(job.job_id).count, 0, "late provider completion cannot create visible version intent after cancellation");
});

test("private provider attribution can be durably staged and reconciled after restart without redispatch", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-provider-attribution-reconcile-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, "versions.sqlite");
  const objectRoot = join(root, "objects");
  const brief = await fixture("brief");
  let store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(() => store?.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const basePorts = () => createCreativeVersionApiPorts({ store, idFactory: () => "attribution-dispatch-id" }).ports;
  let ports = basePorts();
  const action_id = "action-private-pending-01";
  const request_hash = canonicalHash({ action_id, operation: "generate" });
  const started = await ports.jobs.begin({ scope: SCOPE, actor_id: "actor-api-1", action_id,
    request_hash, operation: "generate" });
  assert.equal(started.kind, "started");
  const transport_attempt_id = "transport-private-pending-01";
  const billable_attempt_id = "billable-private-pending-01";
  const reservation_ref = "reservation-private-pending-01";
  const authorized = await ports.jobs.authorizeDispatch({ scope: SCOPE, actor_id: "actor-api-1",
    job_id: started.job_id, lease_token: started.lease_token, action_id, operation: "generate",
    billable_attempt_id, reservation_ref, provider_name: "openai", provider_model: "gpt-image-2.5-sunburst-2026-09-08",
    transport_attempt_id, context_fence: { brief_id: SCOPE.brief_id, brief_hash: canonicalHash(brief),
      expected_current_design_version_id: null, expected_current_design_hash: null } });
  assert.equal(authorized.status, "authorized");
  const provider_request_id = "req-private-reconcile-fixture-01";
  const provider_request_ref = `provider-request-${createHash("sha256").update(provider_request_id).digest("hex")}`;
  const usage = { completeness: "unknown", missing_fields: ["usage.profile_mapping_pending"],
    transport_attempt_id, provider_request_id: provider_request_ref, input_tokens: 12,
    output_tokens: 8, total_tokens: 20 };
  const pending = await ports.jobs.stagePrivateProviderAttribution({ scope: SCOPE, actor_id: "actor-api-1",
    job_id: started.job_id, action_id, request_hash, operation: "generate", provider: "openai",
    model: "gpt-image-2.5-sunburst-2026-09-08", reservation_ref, billable_attempt_id,
    transport_attempt_id, dispatch_intent_ref: authorized.dispatch_intent_ref,
    target_binding_sha256: `sha256:${"c".repeat(64)}`, provider_request_id, provider_request_ref, usage });
  assert.equal(pending.status, "staged");
  assert.equal(pending.transport_attempt_id, transport_attempt_id);
  assert.match(pending.payload_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM private_provider_attributions").get().count, 0);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM private_provider_usage_attributions").get().count, 0);
  const pendingRow = store.db.prepare("SELECT payload_json FROM private_provider_attribution_pending WHERE pending_ref=?")
    .get(pending.pending_ref);
  assert.ok(pendingRow);
  assert.match(pendingRow.payload_json, /req-private-reconcile-fixture-01/,
    "raw response identity remains in restricted durable storage");

  store.close();
  store = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  ports = basePorts();
  const reconciled = await ports.jobs.reconcilePrivateProviderAttributions({ scope: SCOPE, limit: 10 });
  assert.deepEqual(reconciled, { reconciled: 1, remaining: 0 });
  const rawRequest = store.db.prepare(`SELECT provider_request_id,provider_request_ref,transport_attempt_id
    FROM private_provider_attributions WHERE job_id=?`).get(started.job_id);
  assert.equal(rawRequest.provider_request_id, provider_request_id);
  assert.equal(rawRequest.provider_request_ref, provider_request_ref);
  assert.equal(rawRequest.transport_attempt_id, transport_attempt_id);
  const rawUsage = store.db.prepare(`SELECT usage_sha256,usage_json FROM private_provider_usage_attributions
    WHERE job_id=?`).get(started.job_id);
  assert.ok(rawUsage);
  assert.equal(canonicalHash(JSON.parse(rawUsage.usage_json)), rawUsage.usage_sha256);
  assert.equal(JSON.parse(rawUsage.usage_json).input_tokens, 12);
  assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM private_provider_attribution_reconciliations").get().count, 1);
  assert.deepEqual(await ports.jobs.reconcilePrivateProviderAttributions({ scope: SCOPE, limit: 10 }),
    { reconciled: 0, remaining: 0 }, "replay does not create duplicates or call any provider");
});

test("artifact corruption inside paired publication rolls back the caller-owned SQLite transaction", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-version-corrupt-publish-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const brief = await fixture("brief");
  const store = new CreativeVersionStore({ databasePath: join(root, "versions.sqlite"),
    objectRoot: join(root, "objects"), now: () => NOW });
  t.after(() => store.close());
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
  const counters = { provider: 0, reserved: 0 };
  let id = 0;
  const ports = portsFor(store, counters, () => `corrupt-publish-port-${++id}`);
  const prepare = ports.storage.prepareDesignVersion.bind(ports.storage);
  ports.storage.prepareDesignVersion = async (input) => {
    const prepared = await prepare(input);
    const digest = input.design_version.artifact.content_hash.slice(7);
    await unlink(join(store.objectRoot, "objects", "sha256", digest.slice(0, 2), digest));
    return prepared;
  };
  const api = createCreativeApi({ ports, now: () => NOW, idFactory: () => `corrupt-publish-api-${++id}` });
  const result = await api.invoke(actor(), request("corrupt-paired-publish", await fixture("generate-plan")));
  assert.equal(result.ok, false);
  assert.equal(counters.provider, 1);
  assert.equal(store.db.isTransaction, false, "the adapter must close its own transaction after the error");
  const job = store.db.prepare("SELECT status,result_json FROM creative_jobs WHERE action_id=?")
    .get("corrupt-paired-publish");
  assert.equal(job.status, "failed");
  assert.equal(job.result_json, null);
  const action = store.db.prepare("SELECT state FROM creation_actions WHERE action_id=?")
    .get("corrupt-paired-publish");
  assert.equal(action.state, "commit_intent", "the failed caller-owned transaction must not partially commit its unknown marker");
  assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions WHERE action_id=?")
    .get("corrupt-paired-publish").count, 0);
  assert.equal(store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }), null);
});

test("actual API process crashes preserve attempt evidence and recover without provider redispatch", async (t) => {
  const stages = ["after_object_write", "after_commit_intent", "after_metadata_write", "after_job_commit"];
  for (const [index, stage] of stages.entries()) {
    const root = await mkdtemp(join(tmpdir(), `creative-api-crash-${index}-`));
    try {
      const databasePath = join(root, "versions.sqlite");
      const objectRoot = join(root, "objects");
      const callLog = join(root, "provider-calls.log");
      const actionId = `durable-api-crash-${index}`;
      const seed = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
      const brief = await fixture("brief");
      seed.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief });
      seed.close();
      const child = spawnSync(process.execPath, [API_CRASH_WORKER.pathname], {
        env: { ...process.env, CREATIVE_API_DATABASE: databasePath, CREATIVE_API_OBJECTS: objectRoot,
          CREATIVE_API_ACTION: actionId, CREATIVE_API_CALL_LOG: callLog, CREATIVE_API_CRASH_AT: stage },
        encoding: "utf8", timeout: 20_000,
      });
      assert.equal(child.status, 86, `${stage}: ${child.stderr}`);
      assert.equal((await readFile(callLog, "utf8")).trim().split("\n").length, 1, "one real API provider dispatch before crash");

      const recoveryNow = stage === "after_object_write" ? NOW + 120_000 : NOW;
      const reopened = new CreativeVersionStore({ databasePath, objectRoot, now: () => recoveryNow });
      const recovery = await reopened.recover();
      const row = reopened.db.prepare(`SELECT status,result_json,attempt_evidence_json FROM creative_jobs
        WHERE action_id=?`).get(actionId);
      assert.equal(typeof row.attempt_evidence_json, "string", "attempt identities survive every crash boundary");
      const evidence = JSON.parse(row.attempt_evidence_json);
      assert.equal(typeof evidence.billable_attempt_id, "string");
      assert.equal(evidence.transport_attempt_ids.length, 1);
      const action = reopened.db.prepare("SELECT state FROM creation_actions WHERE action_id=?").get(actionId);

      if (stage === "after_object_write") {
        assert.deepEqual(recovery, { examined: 1, committed: 0, conflicts: 0, unknown: 1 });
        assert.equal(row.status, "failed");
        assert.equal(row.result_json, null);
        assert.equal(action, undefined, "no visible version intent exists before object staging completes");
        assert.equal(reopened.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
      } else if (stage === "after_job_commit") {
        assert.deepEqual(recovery, { examined: 0, committed: 0, conflicts: 0, unknown: 0 });
        assert.equal(row.status, "completed");
        assert.equal(action.state, "committed");
      } else {
        assert.deepEqual(recovery, { examined: 1, committed: 1, conflicts: 0, unknown: 0 });
        assert.equal(row.status, "completed");
        assert.equal(action.state, "committed");
        const design = JSON.parse(row.result_json).design;
        assert.equal(reopened.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
          design_version_id: design.design_version_id }).design_hash, design.design_hash);
        assert.deepEqual(Buffer.from(await reopened.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
          design_version_id: design.design_version_id })), Buffer.from("crash-recovery exact artifact bytes"));
      }

      const counters = { provider: 0, reserved: 0 };
      const replayApi = createCreativeApi({ ports: portsFor(reopened, counters, (() => {
        let id = 0; return () => `replay-crash-id-${index}-${++id}`;
      })()), now: () => recoveryNow, idFactory: (() => {
        let id = 0; return () => `replay-crash-api-id-${index}-${++id}`;
      })() });
      const replay = await replayApi.invoke(actor(), request(actionId, await fixture("generate-plan")));
      assert.equal(counters.provider, 0, "recovery and same-action replay never redispatch the provider");
      assert.equal(counters.reserved, 0, "same-action replay never creates another reservation");
      assert.equal(replay.ok, true);
      assert.equal(replay.replayed, true);
      if (stage === "after_object_write") assert.equal(replay.job.status, "failed");
      else assert.equal(replay.job.status, "completed");
      reopened.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("inspection repair hard-exit recovery preserves complete and legacy authority atomically", async (t) => {
  const evidenceRoot = await mkdtemp(join(tmpdir(), "creative-recovery-publication-matrix-"));
  t.after(async () => rm(evidenceRoot, { recursive: true, force: true }));
  const scenarios = ["repair-valid", "legacy-repair", "root-deadline", "root-cancel", "rights-ttl",
    "rights-revoked", "rights-dispatch-ttl-new", "rights-dispatch-ttl-legacy", "ordinary-valid",
    "legacy-ordinary", "legacy-ordinary-generate", "missing-dispatch", "corrupt-dispatch", "tampered-dispatch",
    "tampered-publication-fence", "missing-rights-proof", "corrupt-inspection-session", "atomic-outcome-failure",
    "borrowed-transaction", "concurrent-recover"];
  for (const mode of scenarios) {
    await t.test(mode, async (subtest) => {
      const out = join(evidenceRoot, mode);
      const matrix = spawnSync(process.execPath, [RECOVERY_PUBLICATION_MATRIX.pathname, mode, out], {
        cwd: process.cwd(), encoding: "utf8", timeout: 45_000,
      });
      assert.equal(matrix.status, 0, `${mode}: ${matrix.stderr}\n${matrix.stdout}`);
      const result = JSON.parse(await readFile(join(out, "result.json"), "utf8"));
      assert.equal(result.runtime, process.version);
      assert.equal(result.child_exit, 86, "the child exits only after durable prepareDesignVersion returns");
      assert.equal(result.recoveryTxnOpen, false, "recovery leaves no borrowed or open SQLite transaction");
      if (["legacy-ordinary", "legacy-ordinary-generate"].includes(mode)) {
        assert.equal(result.recovered.committed, 1);
        assert.ok(result.dispatchAuthorityUsed.length > 0,
          "legacy ordinary recovery was reconstructed from exact durable dispatch rows");
      }
      if (mode === "atomic-outcome-failure") {
        assert.equal(result.recovered.committed, 0);
        assert.equal(result.repairs[0].status, "claimed");
        assert.equal(result.repairs[0].result_hash, null);
      }
      if (mode === "borrowed-transaction") {
        assert.equal(result.borrowedRecovery.code, "unavailable");
        assert.equal(result.borrowedRecovery.transactionOpen, true);
        assert.equal(result.borrowedRecovery.actionState, "commit_intent");
        assert.equal(result.borrowedRecovery.jobStatus, "running");
        assert.equal(result.borrowedRecovery.versionsForAction, 0);
        assert.equal(result.recovered.committed, 1, "recovery can proceed after the caller releases its transaction");
      }
      if (mode === "concurrent-recover") {
        assert.equal(result.recovered.committed, 1);
        assert.equal(result.recovered.unknown, 0);
        assert.equal(result.concurrentRecoveryRuns.length, 2);
        assert.ok(result.concurrentRecoveryRuns.every((entry) => entry.exit_code === 0 &&
          entry.result.recoveryTxnOpen === false));
      }
      if (mode.startsWith("legacy-") && result.recovered.committed === 1) {
        assert.equal(result.finalIntent?.publication_fence, undefined);
      }
    });
  }
});

test("final durable send fence stops actual API dispatch after post-authorization owner changes", async (t) => {
  const cases = [
    ...["observer", "decision_evidence", "decision_route"].flatMap((stage) =>
      ["cancel", "lease_expiry", "lease_replacement", "context_drift"].map((change) => ({ stage, change }))),
    ...["cancel", "lease_expiry", "lease_replacement", "context_drift"].map((change) => ({ stage: "generic", change })),
  ];
  for (const scenario of cases) {
    await t.test(`${scenario.stage}/${scenario.change}`, async (subtest) => {
      let currentNow = NOW;
      const system = await setupInspectionSystem(subtest, { now: () => currentNow, leaseDurationMs: 1_000 });
      const { api, ports, store, brief } = system;
      let design;
      if (scenario.stage !== "generic") {
        const generated = await api.invoke(actor(), request(`send-fence-seed-${scenario.stage}-${scenario.change}`,
          await fixture("generate-plan")));
        assert.equal(generated.ok, true, JSON.stringify(generated));
        design = generated.result.design_version;
      }

      const sends = { observer: 0, decision_evidence: 0, decision_route: 0, generic: 0 };
      const acks = new Set();
      let ackCount = 0;
      let reserves = 0;
      let unknown = 0;
      let releaseBeforeDispatch = 0;
      let activeStage;
      let decisionOrdinal = 0;
      let activeAuthCount = 0;
      let mutationApplied = false;
      const finalFenceStatuses = [];
      let nestedCancellation;
      let replacement;
      const stageIndex = { observer: 1, decision_evidence: 2, decision_route: 3, generic: 1 };

      const originalAck = ports.metering.recordTransportAttempt.bind(ports.metering);
      ports.metering.recordTransportAttempt = async (input) => {
        const result = await originalAck(input);
        acks.add(input.transport_attempt_id);
        ackCount += 1;
        return result;
      };
      const originalReserve = ports.metering.reserveAttempt.bind(ports.metering);
      ports.metering.reserveAttempt = async (...args) => { reserves += 1; return originalReserve(...args); };
      const originalUnknown = ports.metering.markOutcomeUnknown.bind(ports.metering);
      ports.metering.markOutcomeUnknown = async (...args) => { unknown += 1; return originalUnknown(...args); };
      const originalRelease = ports.metering.releaseBeforeDispatch.bind(ports.metering);
      ports.metering.releaseBeforeDispatch = async (...args) => {
        releaseBeforeDispatch += 1;
        return originalRelease(...args);
      };

      const mutateOwner = async (input) => {
        if (scenario.change === "cancel") {
          const body = { ...request(`send-fence-cancel-${scenario.stage}-${scenario.change}`, null),
            operation: "cancel", payload: { job_id: input.job_id } };
          nestedCancellation = await api.invoke(actor(), body);
          assert.equal(nestedCancellation.ok, true, JSON.stringify(nestedCancellation));
          assert.equal(nestedCancellation.job.status, "cancelled");
        } else if (scenario.change === "lease_expiry" || scenario.change === "lease_replacement") {
          currentNow = NOW + 2_000; // Expire the 1-second lease while staying inside the 60-second API deadline.
          if (scenario.change === "lease_replacement") {
            if (scenario.stage === "generic") {
              // This API intentionally only resumes inspect jobs. Model a
              // separate owner installing a replacement generation lease by
              // changing the persisted token hash directly; the real generic
              // API call must reject its now-stale token at the same fence.
              const replacementHash = createHash("sha256").update(`replacement:${input.job_id}`).digest("hex");
              const updated = store.db.prepare(`UPDATE creative_jobs SET lease_hash=?,lease_expires_at=?,updated_at=?
                WHERE tenant_id=? AND project_id=? AND job_id=? AND status='running'`)
                .run(replacementHash, new Date(NOW + 30_000).toISOString(), new Date(NOW).toISOString(),
                  input.scope.tenant_id, input.scope.project_id, input.job_id);
              assert.equal(updated.changes, 1);
              replacement = { kind: "external_owner_token_replaced" };
            } else {
              const row = store.db.prepare("SELECT request_hash FROM creative_jobs WHERE job_id=?").get(input.job_id);
              replacement = await ports.jobs.resumeExpired({ scope: input.scope, actor_id: input.actor_id,
                job_id: input.job_id, action_id: input.action_id, request_hash: row.request_hash });
              assert.equal(replacement.kind, "started");
              assert.notEqual(replacement.lease_token, input.lease_token);
            }
          }
        } else {
          const changedBrief = structuredClone(brief);
          changedBrief.facts.verified[0].value = "Changed after final dispatch authorization";
          const saved = store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id },
            brief: changedBrief, expected_brief_hash: canonicalHash(brief) });
          assert.equal(saved.status, "saved");
        }
        mutationApplied = true;
      };

      const authorize = ports.jobs.authorizeDispatch.bind(ports.jobs);
      ports.jobs.authorizeDispatch = async (input) => {
        const result = await authorize(input);
        if (activeStage === scenario.stage && acks.has(input.transport_attempt_id) &&
            result.status === "authorized") {
          activeAuthCount += 1;
          // The first active authorization belongs to the executor's cached
          // ACK revalidation. The second is the runtime's final awaited owner
          // check immediately before its send permit is returned.
          if (activeAuthCount === 2 && !mutationApplied) await mutateOwner(input);
        }
        return result;
      };
      const assertCurrent = ports.jobs.assertDispatchCurrent.bind(ports.jobs);
      ports.jobs.assertDispatchCurrent = (input) => {
        const result = assertCurrent(input);
        if (activeStage === scenario.stage) finalFenceStatuses.push(result.status);
        return result;
      };

      const wrapStage = (owner, key, label) => {
        const original = owner[key].bind(owner);
        owner[key] = async (input) => {
          const previousStage = activeStage;
          activeStage = label;
          try {
            return await original({ ...input, async recordTransportAttempt(id) {
              await input.recordTransportAttempt(id);
              sends[label] += 1;
            } });
          } finally {
            activeStage = previousStage;
          }
        };
      };
      if (scenario.stage === "observer") {
        wrapStage(ports.inspection, "inspect", "observer");
      } else if (scenario.stage === "decision_evidence" || scenario.stage === "decision_route") {
        const originalExecute = ports.decisionPort.execute.bind(ports.decisionPort);
        ports.decisionPort.execute = async (input) => {
          decisionOrdinal += 1;
          const label = decisionOrdinal === 1 ? "decision_evidence" : "decision_route";
          const previousStage = activeStage;
          activeStage = label;
          try {
            return await originalExecute({ ...input, async recordTransportAttempt(id) {
              await input.recordTransportAttempt(id);
              sends[label] += 1;
            } });
          } finally {
            activeStage = previousStage;
          }
        };
      } else {
        wrapStage(ports.provider, "generate", "generic");
      }

      const body = scenario.stage === "generic"
        ? request(`send-fence-generic-${scenario.change}`, await fixture("generate-plan"))
        : inspectionRequest(`send-fence-inspect-${scenario.stage}-${scenario.change}`, design.design_version_id);
      const beforeDesignCount = store.db.prepare("SELECT count(*) AS count FROM design_versions").get().count;
      const result = await api.invoke(actor(), body);
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(mutationApplied, true, "the database owner changed after authorization returned");
      const expectedFinalStatus = scenario.change === "context_drift" ? "stale_context"
        : scenario.change === "cancel" ? "cancelled" : "lease_lost";
      assert.deepEqual(finalFenceStatuses, ["authorized", expectedFinalStatus],
        "cached executor revalidation passes, then the final synchronous fence rejects the stale permit");
      assert.equal(sends[scenario.stage], 0, "no provider-side effect followed stale authorization");
      assert.equal(ackCount, stageIndex[scenario.stage], "each reached stage has one Finance ACK");
      assert.equal(reserves, stageIndex[scenario.stage], "no duplicate reserve was made");
      assert.equal(unknown, 1, "the acknowledged attempt remains held for reconciliation");
      assert.equal(releaseBeforeDispatch, 0, "a post-ACK hold is never released as pre-dispatch");
      assert.equal(store.db.prepare("SELECT count(*) AS count FROM design_versions").get().count,
        beforeDesignCount, "the failed inspect or generation did not publish a design");
      const job = store.db.prepare("SELECT job_id,status,result_json FROM creative_jobs WHERE action_id=?")
        .get(body.action_id);
      assert.ok(job);
      assert.notEqual(job.status, "completed");
      assert.equal(job.result_json, null, "the terminal report/result is not published after a blocked send");
      let inspectionStageState = [];
      if (scenario.stage !== "generic") {
        const session = store.db.prepare(`SELECT status,result_json FROM creative_inspection_sessions_v1
          WHERE tenant_id=? AND project_id=? AND action_id=?`).get(SCOPE.tenant_id, SCOPE.project_id, body.action_id);
        assert.ok(session);
        assert.equal(session.result_json, null, "a blocked stage cannot publish an inspection report");
        const targetStage = store.db.prepare(`SELECT status FROM creative_inspection_stages_v1
          WHERE tenant_id=? AND project_id=? AND action_id=? AND stage=?`)
          .get(SCOPE.tenant_id, SCOPE.project_id, body.action_id, scenario.stage);
        assert.ok(targetStage);
        assert.notEqual(targetStage.status, "completed", "the target stage remains incomplete after the blocked send");
        inspectionStageState = store.db.prepare(`SELECT stage,attempt_id,status,intent_hash,result_hash
          FROM creative_inspection_stages_v1 WHERE tenant_id=? AND project_id=? AND action_id=? ORDER BY stage`)
          .all(SCOPE.tenant_id, SCOPE.project_id, body.action_id);
      }
      const dispatchIntentsBeforeReplay = store.db.prepare(`SELECT transport_attempt_id,dispatch_intent_ref
        FROM creative_dispatch_intents WHERE job_id=? ORDER BY transport_attempt_id`).all(job.job_id);

      const beforeReplay = { ...sends, ackCount, reserves, unknown };
      await api.invoke(actor(), body);
      assert.deepEqual({ ...sends, ackCount, reserves, unknown }, beforeReplay,
        "exact replay cannot dispatch, reserve, ACK, or settle new work");
      assert.deepEqual(store.db.prepare(`SELECT transport_attempt_id,dispatch_intent_ref
        FROM creative_dispatch_intents WHERE job_id=? ORDER BY transport_attempt_id`).all(job.job_id),
      dispatchIntentsBeforeReplay, "exact replay cannot add a dispatch identity");
      if (scenario.stage !== "generic") {
        assert.deepEqual(store.db.prepare(`SELECT stage,attempt_id,status,intent_hash,result_hash
          FROM creative_inspection_stages_v1 WHERE tenant_id=? AND project_id=? AND action_id=? ORDER BY stage`)
          .all(SCOPE.tenant_id, SCOPE.project_id, body.action_id), inspectionStageState,
        "exact replay cannot complete or add an inspection stage");
      }
    });
  }
});

test("recovery quarantines a corrupted persisted intent without publishing or redispatching", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-api-corrupt-intent-recovery-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, "versions.sqlite");
  const objectRoot = join(root, "objects");
  const callLog = join(root, "provider-calls.log");
  const actionId = "corrupt-intent-recovery";
  const seed = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  seed.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  seed.close();
  const child = spawnSync(process.execPath, [API_CRASH_WORKER.pathname], {
    env: { ...process.env, CREATIVE_API_DATABASE: databasePath, CREATIVE_API_OBJECTS: objectRoot,
      CREATIVE_API_ACTION: actionId, CREATIVE_API_CALL_LOG: callLog, CREATIVE_API_CRASH_AT: "after_commit_intent" },
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(child.status, 86, child.stderr);
  assert.equal((await readFile(callLog, "utf8")).trim().split("\n").length, 1);

  const reopened = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(() => reopened.close());
  const row = reopened.db.prepare("SELECT intent_json FROM creation_actions WHERE action_id=?").get(actionId);
  reopened.db.prepare("UPDATE creation_actions SET intent_json=? WHERE action_id=?")
    .run(substituteAttemptIdentity(row.intent_json), actionId);
  const recovery = await reopened.recover();
  assert.deepEqual(recovery, { examined: 1, committed: 0, conflicts: 0, unknown: 1 });
  const action = reopened.db.prepare("SELECT state FROM creation_actions WHERE action_id=?").get(actionId);
  const job = reopened.db.prepare("SELECT status,result_json,error_json FROM creative_jobs WHERE action_id=?").get(actionId);
  assert.equal(action.state, "unknown");
  assert.equal(job.status, "failed");
  assert.equal(job.result_json, null);
  assert.equal(JSON.parse(job.error_json).code, "integrity_error");
  assert.equal(reopened.db.prepare("SELECT count(*) AS count FROM design_versions WHERE action_id=?").get(actionId).count, 0);
  assert.equal(reopened.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }), null);
  assert.equal(reopened.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);

  const counters = { provider: 0, reserved: 0 };
  const replayApi = createCreativeApi({ ports: portsFor(reopened, counters, () => "corrupt-replay-port"),
    now: () => NOW, idFactory: () => "corrupt-replay-api" });
  const replay = await replayApi.invoke(actor(), request(actionId, await fixture("generate-plan")));
  assert.equal(replay.ok, false);
  assert.equal(counters.provider, 0);
  assert.equal(counters.reserved, 0);
  assert.equal((await readFile(callLog, "utf8")).trim().split("\n").length, 1);
});

test("recovery rechecks the job lease after metadata work before committing publication", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "creative-api-recovery-expired-lease-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, "versions.sqlite");
  const objectRoot = join(root, "objects");
  const callLog = join(root, "provider-calls.log");
  const actionId = "recovery-expired-during-publication";
  const seed = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  seed.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: await fixture("brief") });
  seed.close();
  const child = spawnSync(process.execPath, [API_CRASH_WORKER.pathname], {
    env: { ...process.env, CREATIVE_API_DATABASE: databasePath, CREATIVE_API_OBJECTS: objectRoot,
      CREATIVE_API_ACTION: actionId, CREATIVE_API_CALL_LOG: callLog, CREATIVE_API_CRASH_AT: "after_commit_intent" },
    encoding: "utf8", timeout: 20_000,
  });
  assert.equal(child.status, 86, child.stderr);
  assert.equal((await readFile(callLog, "utf8")).trim().split("\n").length, 1);

  let now = NOW;
  const reopened = new CreativeVersionStore({ databasePath, objectRoot, now: () => now });
  t.after(() => reopened.close());
  const originalTimestamp = reopened.timestamp.bind(reopened);
  let advancedDuringMetadataTimestamp = false;
  reopened.timestamp = () => {
    const value = originalTimestamp();
    if (!advancedDuringMetadataTimestamp) {
      advancedDuringMetadataTimestamp = true;
      now = NOW + 120_000;
    }
    return value;
  };

  const recovery = await reopened.recover();
  assert.equal(advancedDuringMetadataTimestamp, true);
  assert.deepEqual(recovery, { examined: 1, committed: 0, conflicts: 0, unknown: 1 });
  const job = reopened.db.prepare("SELECT status,result_json FROM creative_jobs WHERE action_id=?").get(actionId);
  const action = reopened.db.prepare("SELECT state FROM creation_actions WHERE action_id=?").get(actionId);
  assert.equal(job.status, "failed");
  assert.equal(job.result_json, null);
  assert.equal(action.state, "unknown");
  assert.equal(reopened.db.prepare("SELECT count(*) AS count FROM design_versions WHERE action_id=?").get(actionId).count, 0);
  assert.equal(reopened.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }), null);
  assert.equal(reopened.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
  assert.equal((await readFile(callLog, "utf8")).trim().split("\n").length, 1,
    "recovery of an expired publication intent never redispatches the provider");
});
