import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createCreativeApi } from "../../src/api/v1.mjs";
import { canonicalHash, canonicalSerialize, normalizeResearchPackage, validateCreativeBrief } from "../../src/contracts/index.mjs";
import { createOpenAIImagesProvider } from "creative-engine/models";
import { createCreativeVersionApiPorts } from "../../src/versions/api-ports.mjs";
import { CreativeVersionStore } from "../../src/versions/store.mjs";
import { createSqliteTelemetryOutbox, USAGE_PROFILE } from "../../src/telemetry/index.mjs";
import { completeResearchPackage } from "../../fixtures/planning/research-packages.mjs";
import { makePng } from "../../fixtures/models/png.mjs";
import { createVersion } from "../versions/helpers.mjs";

const NOW = Date.parse("2026-10-10T18:00:00.000Z");
const MODEL = "gpt-image-2.5-sunburst-2026-09-08";
const SCOPE = Object.freeze({ tenant_id: "tenant-api-1", project_id: "project-api-1", brief_id: "brief-api-1" });
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function jsonFixture(path) {
  return JSON.parse(await readFile(new URL(`../../fixtures/api/${path}.json`, import.meta.url), "utf8"));
}

function authorizedActor() {
  return { actor_id: "actor-api-1", tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    expires_at: "2026-10-11T00:00:00.000Z",
    permissions: ["creative.generate", "creative.edit", "creative.read", "creative.restore", "creative.cancel"],
    budget_scope_id: "budget-api-1", budget_policy_version: "budget-policy/1" };
}

function apiRequest(actionId, operation, plan, sourceRef, payload = {}) {
  const occurred = "2026-10-10T12:20:00.000Z";
  return { contract: "CreativeApiRequest", schema_version: "1.0", event_id: `event-${actionId}`,
    request_id: `request-${actionId}`, tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    correlation_id: `correlation-${actionId}`, producer: "creative-image-api-integration",
    occurred_at: occurred, ingested_at: occurred, environment: "test", billing_mode: "simulated",
    source_refs: [sourceRef], operation, action_id: actionId,
    payload: { brief_id: SCOPE.brief_id, plan, ...payload } };
}

function conceptRequest(actionId, schemaVersion = "1.1", requestedCount = 2) {
  const occurred = "2026-10-10T12:20:00.000Z";
  return { contract: "CreativeApiRequest", schema_version: schemaVersion, event_id: `event-${actionId}`,
    request_id: `request-${actionId}`, tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    correlation_id: `correlation-${actionId}`, producer: "creative-concept-api-integration",
    occurred_at: occurred, ingested_at: occurred, environment: "test", billing_mode: "simulated",
    source_refs: ["page-1", "page-2"], operation: "concepts.create", action_id: actionId,
    payload: { brief_id: SCOPE.brief_id, plan_id: `concept-plan-${actionId}`, requested_count: requestedCount,
      references: [{ asset_id: "asset-1", role_ref: "primary-subject" },
        { asset_id: "asset-2", role_ref: "supporting-detail" }] } };
}

function cancelRequest(actionId, jobId) {
  return { contract: "CreativeApiRequest", schema_version: "1.0", event_id: `event-${actionId}`,
    request_id: `request-${actionId}`, tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    correlation_id: `correlation-${actionId}`, producer: "creative-image-api-integration",
    occurred_at: "2026-10-10T12:20:00.000Z", ingested_at: "2026-10-10T12:20:00.000Z",
    environment: "test", billing_mode: "simulated", source_refs: [], operation: "cancel", action_id: actionId,
    payload: { job_id: jobId } };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function authorityPorts() {
  const evidenceHash = `sha256:${"a".repeat(64)}`;
  const capabilityFor = (input) => ({ status: "verified", eligible: true, revoked: false,
    operation_permission: "allowed", quota_status: "available", service: "openai",
    account_ref: "org-synthetic", project_ref: "proj-synthetic",
    tenant_id: input.scope.tenant_id, project_id: input.scope.project_id,
    budget_scope_id: input.attempt.budget_scope_id, operation: input.operation, model: input.model,
    target_binding_sha256: input.target_binding_sha256,
    expires_at: new Date(NOW + 10 * 60_000).toISOString(),
    evidence_ref: "fixture-capability-proof", evidence_sha256: evidenceHash });
  const authorityFor = (input) => {
    const grant = { service: "openai", grant_ref: "grant-synthetic", account_ref: "org-synthetic",
      project_ref: "proj-synthetic", tenant_id: input.scope.tenant_id, project_id: input.scope.project_id,
      target_binding_sha256: input.target_binding_sha256, operation: input.operation, model: MODEL,
      permission: "allowed", revoked: false, expires_at: new Date(NOW + 10 * 60_000).toISOString(),
      evidence_ref: "fixture-grant-proof", evidence_sha256: evidenceHash };
    const finance = { status: "held", revoked: false, reservation_ref: input.reservation_ref,
      billable_attempt_id: input.billable_attempt_id, budget_scope_id: input.budget_scope_id,
      lease_ref: "finance-lease-synthetic", grant_ref: grant.grant_ref,
      account_ref: grant.account_ref, project_ref: grant.project_ref, tenant_id: grant.tenant_id,
      project_id: grant.project_id, provider: "openai", model: MODEL, operation: input.operation,
      target_binding_sha256: input.target_binding_sha256,
      held_amount: { amount: "1.00", currency: "USD" }, authorized_cap: { amount: "2.00", currency: "USD" },
      expires_at: new Date(NOW + 10 * 60_000).toISOString(), evidence_ref: "fixture-finance-proof",
      evidence_sha256: evidenceHash };
    return { status: "authorized", revoked: false, grant, finance };
  };
  return {
    capabilityPort: { verify: capabilityFor, revalidate: capabilityFor },
    authorizationPort: { revalidate: authorityFor },
    credentialPort: { async resolveCredential(input) { return {
      status: "resolved", token: "synthetic-offline-token",
      binding: { service: "openai", account_ref: input.account_ref, project_ref: input.project_ref,
        grant_ref: input.grant_ref, target_binding_sha256: input.target_binding_sha256 },
      provider_scope: { organization_id: input.account_ref, project_id: input.project_ref },
      expires_at: new Date(NOW + 10 * 60_000).toISOString(),
      evidence: { ref: "fixture-credential-proof", sha256: evidenceHash },
    }; } },
  };
}

async function setup(t, { root: suppliedRoot, initialNow = NOW, idPrefix = "api" } = {}) {
  const root = suppliedRoot ?? await mkdtemp(join(tmpdir(), "creative-image-api-integration-"));
  if (suppliedRoot === undefined) t.after(async () => rm(root, { recursive: true, force: true }));
  const databasePath = join(root, "versions.sqlite");
  const objectRoot = join(root, "objects");
  let runtimeNow = initialNow;
  const store = new CreativeVersionStore({ databasePath, objectRoot, now: () => runtimeNow });
  t.after(() => store.close());

  const referenceBytes = makePng({ width: 16, height: 16 });
  const firstReferenceBytes = makePng({ width: 17, height: 16 });
  const researchInput = completeResearchPackage();
  researchInput.tenant_id = SCOPE.tenant_id;
  researchInput.project_id = SCOPE.project_id;
  researchInput.package_id = "research-image-api-1";
  researchInput.source_refs.push("source:page-2", "asset:asset-2");
  researchInput.source_identity[0].content_hash = hash(firstReferenceBytes);
  researchInput.assets.items[0].content_hash = hash(firstReferenceBytes);
  researchInput.source_identity.push({ source_id: "page-2", uri: "https://example.test/reference-2.png",
    retrieved_at: "2026-10-10T12:00:00Z", content_hash: hash(referenceBytes) });
  researchInput.assets.items.push({ asset_id: "asset-2", source_id: "page-2",
    content_hash: hash(referenceBytes), media_type: "image/png" });
  researchInput.permissions.items.push({ asset_id: "asset-2", action: "modify", status: "granted",
    evidence_refs: ["page-2"] });
  researchInput.permissions.items.push({ asset_id: "asset-2", action: "reproduce", status: "granted",
    evidence_refs: ["page-2"] });
  const research = normalizeResearchPackage(researchInput, { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id });

  const brief = await jsonFixture("brief");
  brief.research_package_ref.package_id = research.package_id;
  brief.research_package_ref.content_hash = canonicalHash(research);
  brief.source_identity = research.source_identity.map(({ source_id, uri }) => ({ source_id, uri }));
  brief.facts.verified = research.facts.filter((fact) => fact.status === "verified").map((fact) => ({
    fact_id: fact.fact_id, key: fact.key, value: fact.value,
    provenance_refs: [...new Set(fact.provenance.map((item) => item.source_id))],
  }));
  brief.permissions.items = [
    { asset_id: "asset-1", action: "reproduce", status: "granted", evidence_refs: ["page-1"] },
    { asset_id: "asset-2", action: "modify", status: "granted", evidence_refs: ["page-2"] },
    { asset_id: "asset-2", action: "reproduce", status: "granted", evidence_refs: ["page-2"] },
  ];
  const trustedBrief = validateCreativeBrief(brief, { trustedScope: SCOPE });
  store.putBrief({ scope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id }, brief: trustedBrief });

  const referenceAssetBytes = new Map([["asset-1", firstReferenceBytes], ["asset-2", referenceBytes]]);
  const counters = { seed_dispatches: 0, provider_posts: 0, reserves: 0, settlements: 0, held: 0,
    usage_observations: [] };
  let id = 0;
  const metering = {
    async reserveAttempt(attempt) {
      counters.reserves += 1;
      return { status: "reserved", reservation_id: `reservation:${attempt.billable_attempt_id}`,
        billable_attempt_id: attempt.billable_attempt_id, held_amount: { amount: "1.00", currency: "USD" },
        lease_id: `finance-lease:${attempt.billable_attempt_id}` };
    },
    async releaseBeforeDispatch() { return { status: "released" }; },
    async markAttemptInFlight(input) { return { status: "in_flight", reservation_id: input.reservation_id }; },
    async recordTransportAttempt() { return { status: "recorded" }; },
    async recordUsageObservation(input) {
      counters.usage_observations.push(structuredClone(input.observation));
      return { status: "accepted",
      source_observation_id: input.observation.source_observation_id,
      effective_billable_attempt_id: input.observation.billable_attempt_id }; },
    async settleReservation(input) {
      counters.settlements += 1;
      return { status: "settled", reservation_id: input.reservation_id,
        consumed_amount: { amount: "0.10", currency: "USD" },
        released_unused_amount: { amount: "0.90", currency: "USD" } };
    },
    async markOutcomeUnknown() { counters.held += 1; return { status: "held_for_reconciliation" }; },
  };
  const fixtureBytes = makePng({ width: 16, height: 16 });
  const fixtureHash = hash(fixtureBytes);
  const provider = {
    resolveRoute: ({ operation }) => ({ retry_mapping_ref: "retry:fixture/1", provider: {
      name: "fixture-provider", model: "fixture-model", endpoint: `test:/images/${operation}`,
      sdk: { name: "fixture-sdk", version: "1" },
    } }),
    async generate(input) {
      counters.seed_dispatches += 1;
      await input.recordTransportAttempt(input.transport_attempt_id);
      return { design_version_id: "design-image-parent-1",
        artifact: { artifact_id: "artifact-image-parent-1", content_hash: fixtureHash, media_type: "image/png" },
        artifact_bytes: Uint8Array.from(fixtureBytes), provider: "fixture-provider", model: "fixture-model",
        usage: { completeness: "complete", input_tokens: 3, output_tokens: 5 } };
    },
    async edit() { throw new Error("fixture edit should not be used"); },
  };
  let assetPermissionRevoked = false;
  const permissionVerifier = {
    async verifyAssetUse(input) { return { status: assetPermissionRevoked ? "denied" : "granted",
      owner_evidence_status: "verified",
      tenant_id: input.tenant_id, project_id: input.project_id, asset_id: input.asset_id,
      content_hash: input.content_hash, action: input.action, package_id: input.package_id,
      package_hash: input.package_hash, checked_at: input.now,
      expires_at: new Date(NOW + 5 * 60_000).toISOString(), evidence_ref: "synthetic-permission-proof" }; },
  };
  const adapted = createCreativeVersionApiPorts({ store, idFactory: () => `${idPrefix === "api" ? "version-port" : `${idPrefix}-version-port`}-${++id}`, leaseDurationMs: 60_000,
    otherPorts: { provider, metering, planning: { getCurrentResearchPackage: () => research,
      assetPermissionVerifier: permissionVerifier } } });
  const ports = { ...adapted.ports,
    telemetry: { outbox: createSqliteTelemetryOutbox({ database: store.db, clock: () => NOW }),
      modes: { provider_execution_mode: "mock", commerce_mode: "simulated" },
      usage_profiles: { image_generation: USAGE_PROFILE.NORMALIZED, image_edit: USAGE_PROFILE.NORMALIZED,
        vision_observation: USAGE_PROFILE.NORMALIZED, jev_decision: USAGE_PROFILE.TYPESAFE_DECISION } },
  };
  const api = createCreativeApi({ ports, now: () => runtimeNow,
    idFactory: () => `${idPrefix === "api" ? "api-id" : `${idPrefix}-api-id`}-${++id}` });
  return { root, databasePath, objectRoot, store, api, ports, research, brief: trustedBrief, referenceBytes, referenceAssetBytes, counters,
    revokeAssetPermission() { assetPermissionRevoked = true; }, advanceClock(milliseconds) { runtimeNow += milliseconds; } };
}

function createNativeProvider({ referenceAssetBytes, store, fetchImpl, authorityOverrides = {}, promptPort }) {
  return createOpenAIImagesProvider({
    model_id: MODEL,
    configuration: { quality: "low", size: "16x16", output_format: "png", background: "opaque", moderation: "auto" },
    ...authorityPorts(),
    ...authorityOverrides,
    promptPort: promptPort ?? { async render() { return "Synthetic integration prompt with no model authority."; } },
    assetPort: {
      async readArtifact(input) { return store.getArtifactBytes({ scope: { ...input.scope, brief_id: SCOPE.brief_id },
        brief_id: SCOPE.brief_id, design_version_id: "design-image-parent-1" }); },
      async readReference(input) { return referenceAssetBytes.get(input.asset_id); },
    },
    fetchImpl,
    now: () => NOW,
    idFactory: () => "artifact-native-image-output",
  });
}

function syntheticNativePromptPort() {
  return { async render({ prompt_template }) {
    return { prompt: "Synthetic integration prompt with no model authority.",
      template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
      template_sha256: prompt_template.template_sha256 };
  } };
}

function mockOwnerUsageProfileAuthority({ transformResult = (result) => result, beforeMap } = {}) {
  const profileSha = `sha256:${"b".repeat(64)}`;
  return Object.freeze({
    async mapProviderUsage(input) {
      await beforeMap?.(input);
      if (input.attempt.provider.name !== "openai" || input.attempt.provider.model !== MODEL ||
          input.rawUsage.transport_attempt_id !== input.transportAttemptId ||
          input.rawUsage.completeness !== "unknown" ||
          JSON.stringify(input.rawUsage.missing_fields) !== JSON.stringify(["usage.profile_mapping_pending"])) {
        return { status: "unknown" };
      }
      const attempt = input.attempt;
      const raw = input.rawUsage;
      const observation = {
        schema_version: "creative.metering.proposal/v1",
        tenant_id: attempt.tenant_id,
        project_id: attempt.project_id,
        budget_scope_id: attempt.budget_scope_id,
        logical_operation_id: attempt.logical_operation_id,
        billable_attempt_id: attempt.billable_attempt_id,
        source_observation_id: input.sourceObservationId,
        source: "provider_response",
        provider_name: attempt.provider.name,
        model: attempt.provider.model,
        ...(raw.provider_request_id ? { provider_request_id: raw.provider_request_id } : {}),
        transport_attempt_id: input.transportAttemptId,
        environment: attempt.environment,
        billing_mode: attempt.billing_mode,
        completeness: "complete",
        missing_fields: [],
        usage_units: [
          { name: "input_tokens", quantity: String(raw.input_tokens), relation: "included_subset", included_in: "total_tokens" },
          { name: "output_tokens", quantity: String(raw.output_tokens), relation: "included_subset", included_in: "total_tokens" },
          { name: "total_tokens", quantity: String(raw.total_tokens), relation: "standalone" },
          { name: "input_tokens_details.image_tokens", quantity: String(raw.input_tokens_details.image_tokens), relation: "included_subset", included_in: "input_tokens" },
          { name: "input_tokens_details.text_tokens", quantity: String(raw.input_tokens_details.text_tokens), relation: "included_subset", included_in: "input_tokens" },
          { name: "output_tokens_details.image_tokens", quantity: String(raw.output_tokens_details.image_tokens), relation: "included_subset", included_in: "output_tokens" },
          { name: "output_tokens_details.text_tokens", quantity: String(raw.output_tokens_details.text_tokens), relation: "included_subset", included_in: "output_tokens" },
        ],
      };
      return transformResult({
        status: "mapped",
        profile_ref: "mock-owner-profile:gpt-image-2.5-fixture/1",
        profile_sha256: profileSha,
        raw_usage_sha256: input.rawUsageSha256,
        target_binding_sha256: input.targetBindingSha256,
        attempt_binding_sha256: input.attemptBindingSha256,
        observation,
      }, input);
    },
  });
}

function installConceptAuthority(context, provider) {
  context.ports.provider = provider;
  context.ports.telemetry.usage_profile_authority = mockOwnerUsageProfileAuthority();
  context.ports.concepts = { resolveTrustedSnapshots(input) {
    const observedAt = Date.parse(input.now);
    const expires = new Date(observedAt + 10 * 60_000).toISOString();
    const deadline = new Date(observedAt + 5 * 60_000).toISOString();
    const configuration = provider.getConceptConfiguration().configuration;
    return { policy_snapshot: { tenant_id: input.scope.tenant_id, project_id: input.scope.project_id,
      brief_id: input.scope.brief_id, policy_ref: "local-concept-policy/1", policy_version: "1",
      evidence_ref: "synthetic-policy-evidence", observed_at: input.now, expires_at: expires, deadline_at: deadline,
      maximum_concept_count: 2, maximum_reference_count: 2, maximum_elapsed_ms: 5 * 60_000,
      maximum_single_reference_bytes: 1_000_000, maximum_aggregate_reference_bytes: 2_000_000,
      budget_scope_id: "budget-api-1", budget_snapshot_ref: "synthetic-budget-snapshot", budget_expires_at: expires },
    adapter_snapshot: { capability_ref: "openai-images-edit-capability/fixture", capability_schema_version: "1.0",
      provider_name: "openai", model: MODEL, endpoint: "https://api.openai.com/v1/images/edits",
      provider_operation: "edit", operation_mapping_ref: "creative-engine/concepts-to-openai-images-edit/1",
      operation_kind: "image_edit", target_ref: "openai-image-edit-target/fixture", sdk_name: "native-fetch",
      sdk_version: process.versions.node, configuration_ref: "openai-image-config/fixture",
      configuration_sha256: canonicalHash(configuration), configuration, prompt_template_ref: "concept-prompt/fixture",
      prompt_template_version: "1", prompt_template_sha256: canonicalHash("Synthetic integration prompt with no model authority.") } };
  } };
}

async function addLaterHistory(context, count) {
  let selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  let parent = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  for (let index = 0; index < count; index += 1) {
    const id = `later-history-${String(index).padStart(3, "0")}`;
    const occurred_at = new Date(Date.parse("2026-10-11T00:00:00.000Z") + index * 1000).toISOString();
    const version = createVersion({ scope: SCOPE, brief: context.brief, id, parent, occurred_at,
      bytes: makePng({ width: 16, height: 16 }), extra: { brief_id: SCOPE.brief_id } });
    const actor_id = authorizedActor().actor_id;
    const creation = { job_id: `history-job-${index}`, action_id: `history-action-${index}`, actor_id,
      request_hash: canonicalHash({ id, brief_id: SCOPE.brief_id, history_fixture: "paginated-concept-replay" }),
      logical_operation_id: `history-logical-${index}`, billable_attempt_id: `history-billable-${index}`,
      parent_design_hash: parent.design_hash, transport_attempt_ids: [`history-transport-${index}`],
      provider_request_ids: [`history-provider-${index}`] };
    const saved = await context.store.saveDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id, actor_id,
      brief_snapshot: context.brief, design_version: version.design_version, artifact_bytes: version.artifact_bytes,
      creation, selection: { mode: "advance", expected_revision: selection.revision,
        expected_selected_design_version_id: selection.design_version_id,
        expected_selected_design_hash: selection.design_hash },
      configuration_snapshot: { renderer: "fixture-history", schema_version: "1" } });
    assert.equal(saved.status, "saved");
    parent = saved.design_version;
    selection = saved.selection;
  }
}

test("actual Creative API v1.1 concepts.create edits two authorized references and publishes parentless siblings", async (t) => {
  const context = await setup(t);
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("concept-public-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  assert.equal(seed.result.design_version.parent_version_id, null);
  const providerOutputs = [makePng({ width: 16, height: 16 }), makePng({ width: 16, height: 16, transparent: true })];
  const observedInputs = [];
  let outputIndex = 0;
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
      template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
      template_sha256: prompt_template.template_sha256 }; } },
    fetchImpl: async (url, init) => {
      context.counters.provider_posts += 1;
      assert.equal(String(url), "https://api.openai.com/v1/images/edits");
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      assert.equal(init.body.has("mask"), false, "initial concept edits have no synthetic mask");
      const files = init.body.getAll("image[]");
      assert.equal(files.length, 2, "only the two authorized references are sent; no parent image is fabricated");
      observedInputs.push(await Promise.all(files.map(async (file) => hash(Buffer.from(await file.arrayBuffer())))));
      const current = providerOutputs[outputIndex++];
      return new Response(JSON.stringify({ data: [{ b64_json: current.toString("base64") }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
          input_tokens_details: { image_tokens: 18, text_tokens: 2 },
          output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": `req-concept-${outputIndex}` } });
    } });
  installConceptAuthority(context, provider);

  const badV10 = conceptRequest("concept-v10-negative", "1.0");
  const rejected = await context.api.invoke(authorizedActor(), badV10);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, "unsupported_version");
  assert.equal(context.counters.reserves, 1);
  assert.equal(context.counters.provider_posts, 0);

  const selectionBefore = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const countersBeforeConcepts = { reserves: context.counters.reserves,
    settlements: context.counters.settlements, provider_posts: context.counters.provider_posts };
  const request = conceptRequest("concept-api-two-siblings");
  const result = await context.api.invoke(authorizedActor(), request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.schema_version, "1.1");
  assert.equal(result.result.contract, "CreativeConceptBatchResult");
  assert.equal(result.result.status, "completed");
  assert.equal(result.result.candidates.length, 2);
  assert.equal(context.counters.provider_posts - countersBeforeConcepts.provider_posts, 2);
  assert.equal(context.counters.reserves - countersBeforeConcepts.reserves, 2);
  assert.equal(context.counters.settlements - countersBeforeConcepts.settlements, 2);
  assert.deepEqual(observedInputs, [[hash(context.referenceAssetBytes.get("asset-1")), hash(context.referenceAssetBytes.get("asset-2"))],
    [hash(context.referenceAssetBytes.get("asset-1")), hash(context.referenceAssetBytes.get("asset-2"))]]);
  const [first, second] = result.result.candidates;
  assert.notEqual(first.design_version.design_version_id, second.design_version.design_version_id);
  assert.notEqual(first.design_version.artifact.content_hash, second.design_version.artifact.content_hash);
  for (const candidate of result.result.candidates) {
    assert.equal(candidate.design_version.parent_version_id, null);
    assert.equal(candidate.creative_concept_lineage.parent_version_id, null);
    assert.deepEqual(candidate.design_version.source_refs, ["page-1", "page-2"]);
    assert.equal(candidate.creative_concept_lineage.source_assets.length, 2);
    assert.equal(Object.isFrozen(candidate.creative_concept_lineage.source_assets[0]), true);
  }
  assert.deepEqual(context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }), selectionBefore,
    "publishing concepts does not select either sibling");
  const durable = context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id });
  assert.equal(durable.length, 2);
  assert.deepEqual(durable.map((entry) => entry.design_version.design_version_id),
    result.result.candidates.map((entry) => entry.design_version.design_version_id));
  const listRequest = { ...request, schema_version: "1.0", request_id: "request-concept-list", event_id: "event-concept-list", action_id: undefined,
    operation: "list", source_refs: [], payload: { brief_id: SCOPE.brief_id, limit: 10 } };
  delete listRequest.action_id;
  const listed = await context.api.invoke(authorizedActor(), listRequest);
  assert.equal(listed.ok, true, JSON.stringify(listed));
  for (const candidate of result.result.candidates) {
    assert.ok(listed.result.items.some((entry) => entry.design_version_id === candidate.design_version.design_version_id));
  }
  const compareRequest = { ...listRequest, request_id: "request-concept-compare", event_id: "event-concept-compare",
    operation: "compare", payload: { brief_id: SCOPE.brief_id,
      left_design_version_id: first.design_version.design_version_id,
      right_design_version_id: second.design_version.design_version_id } };
  const compared = await context.api.invoke(authorizedActor(), compareRequest);
  assert.equal(compared.ok, true, JSON.stringify(compared));
  assert.equal(compared.result.left.parent_version_id, null);
  assert.equal(compared.result.right.parent_version_id, null);

  context.ports.telemetry.usage_profile_authority = undefined;
  context.ports.inspection = {
    resolveRoute: () => ({ retry_mapping_ref: "openai-inspection-fixture/retry-v1", provider: {
      name: "openai", model: MODEL, endpoint: "https://api.openai.com/v1/responses",
      sdk: { name: "native-fetch", version: process.versions.node },
    } }),
    async inspect(input) {
      await input.recordTransportAttempt(input.transport_attempt_id);
      return { status: "unavailable", usage: { input_tokens: 3, output_tokens: 3 } };
    },
  };
  let selectionRevision = selectionBefore.revision;
  for (const [index, candidate] of result.result.candidates.entries()) {
    const restoreCandidate = { ...listRequest, request_id: `request-concept-restore-${index}`,
      event_id: `event-concept-restore-${index}`, action_id: `restore-concept-${index}`, operation: "restore",
      payload: { brief_id: SCOPE.brief_id, target_design_version_id: candidate.design_version.design_version_id,
        expected_selection_revision: selectionRevision } };
    const restored = await context.api.invoke(authorizedActor(), restoreCandidate);
    assert.equal(restored.ok, true, JSON.stringify(restored));
    assert.equal(restored.result.selection.design_version_id, candidate.design_version.design_version_id);
    selectionRevision += 1;
    const inspectRequest = { ...listRequest, request_id: `request-concept-inspect-${index}`,
      event_id: `event-concept-inspect-${index}`, action_id: `inspect-concept-${index}`, operation: "inspect",
      payload: { brief_id: SCOPE.brief_id, design_version_id: candidate.design_version.design_version_id } };
    const inspected = await context.api.invoke(authorizedActor(), inspectRequest);
    assert.equal(inspected.ok, true, JSON.stringify(inspected));
    assert.equal(inspected.result.report.design_version_id, candidate.design_version.design_version_id);
    assert.equal(inspected.result.report.design_hash, candidate.design_version.design_hash);
    assert.equal(inspected.result.report.artifact_id, candidate.design_version.artifact.artifact_id);
    assert.equal(inspected.result.report.artifact_hash, candidate.design_version.artifact.content_hash);
    assert.equal(inspected.result.report.outcome, "needs_human_review");
  }

  const restoreSeed = { ...listRequest, request_id: "request-concept-restore-seed",
    event_id: "event-concept-restore-seed", action_id: "restore-concept-seed", operation: "restore",
    payload: { brief_id: SCOPE.brief_id, target_design_version_id: seed.result.design_version.design_version_id,
      expected_selection_revision: selectionRevision } };
  const restoredSeed = await context.api.invoke(authorizedActor(), restoreSeed);
  assert.equal(restoredSeed.ok, true, JSON.stringify(restoredSeed));
  assert.equal(restoredSeed.result.selection.design_version_id, seed.result.design_version.design_version_id);

  await addLaterHistory(context, 101);
  const rawHistoryPage = context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 101 });
  assert.equal(rawHistoryPage.items.length, 101);
  assert.ok(rawHistoryPage.items.every((item) => item.tenant_id === SCOPE.tenant_id &&
    item.project_id === SCOPE.project_id && item.brief_id === SCOPE.brief_id),
  JSON.stringify(rawHistoryPage.items.slice(0, 3).map(({ tenant_id, project_id, brief_id, design_version_id }) =>
    ({ tenant_id, project_id, brief_id, design_version_id }))));
  const firstHistoryPage = await context.api.invoke(authorizedActor(), { ...listRequest,
    request_id: "request-concept-history-page-1", event_id: "event-concept-history-page-1",
    payload: { brief_id: SCOPE.brief_id, limit: 100 } });
  assert.equal(firstHistoryPage.ok, true, JSON.stringify(firstHistoryPage));
  assert.equal(firstHistoryPage.result.items.length, 100);
  assert.ok(firstHistoryPage.result.next_cursor);
  for (const candidate of result.result.candidates) {
    assert.equal(firstHistoryPage.result.items.some((entry) =>
      entry.design_version_id === candidate.design_version.design_version_id), false,
    "newer history pushes each concept sibling beyond the first 100-item page");
  }
  const secondHistoryPage = await context.api.invoke(authorizedActor(), { ...listRequest,
    request_id: "request-concept-history-page-2", event_id: "event-concept-history-page-2",
    payload: { brief_id: SCOPE.brief_id, limit: 100, cursor: firstHistoryPage.result.next_cursor } });
  assert.equal(secondHistoryPage.ok, true, JSON.stringify(secondHistoryPage));
  for (const candidate of result.result.candidates) {
    assert.ok(secondHistoryPage.result.items.some((entry) =>
      entry.design_version_id === candidate.design_version.design_version_id));
  }

  const replayed = await context.api.invoke(authorizedActor(), request);
  assert.equal(replayed.ok, true, JSON.stringify(replayed));
  assert.equal(replayed.schema_version, "1.1");
  assert.equal(replayed.replayed, true);
  assert.deepEqual(replayed.result, result.result);
  assert.equal(context.counters.provider_posts - countersBeforeConcepts.provider_posts, 2,
    "completed replay returns durable siblings without a second dispatch");
});

test("concept request, trusted policy, and rights negatives stop before any C03 reservation or native POST", async (t) => {
  const context = await setup(t);
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    fetchImpl: async () => {
      context.counters.provider_posts += 1;
      throw new Error("negative concepts test reached the provider");
    } });
  installConceptAuthority(context, provider);

  for (const count of [0, 3]) {
    const response = await context.api.invoke(authorizedActor(), conceptRequest(`concept-count-negative-${count}`, "1.1", count));
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "invalid_request");
  }
  const v11LegacyOperation = { ...conceptRequest("concept-v11-legacy-operation"), operation: "generate",
    payload: { brief_id: SCOPE.brief_id } };
  const rejectedV11LegacyOperation = await context.api.invoke(authorizedActor(), v11LegacyOperation);
  assert.equal(rejectedV11LegacyOperation.ok, false);
  assert.equal(rejectedV11LegacyOperation.error.code, "unsupported_version",
    "v1.1 adds only the concepts.create arm; legacy operations stay on exact v1.0");
  const forgedFinancialRequest = conceptRequest("concept-settlement-request-forgery");
  forgedFinancialRequest.payload.financial_exposure_status = "settled";
  forgedFinancialRequest.payload.financial_settlement_evidence = { status: "settled",
    reservation_id: "forged-reservation", source_observation_id: "forged-observation",
    effective_billable_attempt_id: "forged-billable" };
  const forgedSettlement = await context.api.invoke(authorizedActor(), forgedFinancialRequest);
  assert.equal(forgedSettlement.ok, false);
  assert.equal(forgedSettlement.error.code, "invalid_request");
  const resolveTrustedSnapshots = context.ports.concepts.resolveTrustedSnapshots;
  context.ports.concepts.resolveTrustedSnapshots = (input) => {
    const snapshots = resolveTrustedSnapshots(input);
    return { ...snapshots, policy_snapshot: { ...snapshots.policy_snapshot, maximum_concept_count: 1 } };
  };
  const overPolicy = await context.api.invoke(authorizedActor(), conceptRequest("concept-count-policy-negative"));
  assert.equal(overPolicy.ok, false);
  assert.equal(overPolicy.error.code, "budget_unavailable");

  context.ports.concepts.resolveTrustedSnapshots = resolveTrustedSnapshots;
  context.revokeAssetPermission();
  const revoked = await context.api.invoke(authorizedActor(), conceptRequest("concept-rights-negative"));
  assert.equal(revoked.ok, false);
  assert.equal(revoked.error.code, "permission_denied");
  assert.equal(context.counters.reserves, 0);
  assert.equal(context.counters.provider_posts, 0);
  assert.equal(context.counters.settlements, 0);
  assert.equal(context.counters.held, 0);
  assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: "concept-count-policy-negative" }).length, 0);
  assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: "concept-rights-negative" }).length, 0);
});

test("concurrent concepts.create replay observes the active job without duplicating native dispatch", async (t) => {
  const context = await setup(t);
  const outputBytes = [makePng({ width: 16, height: 16 }), makePng({ width: 16, height: 16, transparent: true })];
  const firstPostEntered = deferred();
  const releaseFirstPost = deferred();
  let providerPosts = 0;
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
      template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
      template_sha256: prompt_template.template_sha256 }; } },
    fetchImpl: async (url, init) => {
      providerPosts += 1;
      context.counters.provider_posts += 1;
      assert.equal(String(url), "https://api.openai.com/v1/images/edits");
      assert.equal(init.body.getAll("image[]").length, 2);
      if (providerPosts === 1) {
        firstPostEntered.resolve();
        await releaseFirstPost.promise;
      }
      const bytes = outputBytes[providerPosts - 1];
      return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
          input_tokens_details: { image_tokens: 18, text_tokens: 2 },
          output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": `req-concurrent-concept-${providerPosts}` } });
    } });
  installConceptAuthority(context, provider);

  const request = conceptRequest("concept-concurrent-identical-action");
  const firstPromise = context.api.invoke(authorizedActor(), request);
  await firstPostEntered.promise;
  const duplicate = await context.api.invoke(authorizedActor(), request);
  assert.equal(duplicate.ok, true, JSON.stringify(duplicate));
  assert.equal(duplicate.replayed, true);
  assert.equal(duplicate.job.status, "running");
  assert.equal(Object.hasOwn(duplicate, "result"), false,
    "an in-flight duplicate reports the durable job instead of inventing a partial result");
  assert.equal(providerPosts, 1);
  releaseFirstPost.resolve();
  const completed = await firstPromise;
  assert.equal(completed.ok, true, JSON.stringify(completed));
  assert.equal(completed.result.status, "completed");
  assert.equal(completed.result.candidates.length, 2);
  assert.equal(providerPosts, 2);
  assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 2);
});

test("malformed native concept output keeps the exact attempts private and publishes zero versions", async (t) => {
  const context = await setup(t);
  const referenceHashes = [hash(context.referenceAssetBytes.get("asset-1")), hash(context.referenceAssetBytes.get("asset-2"))];
  let providerPosts = 0;
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
      template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
      template_sha256: prompt_template.template_sha256 }; } },
    fetchImpl: async (url, init) => {
      providerPosts += 1;
      context.counters.provider_posts += 1;
      assert.equal(String(url), "https://api.openai.com/v1/images/edits");
      const images = init.body.getAll("image[]");
      assert.equal(images.length, 2);
      assert.deepEqual(await Promise.all(images.map(async (image) => hash(Buffer.from(await image.arrayBuffer())))),
        referenceHashes);
      return new Response(JSON.stringify({ data: [{ b64_json: Buffer.from("not a valid raster image").toString("base64") }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
          input_tokens_details: { image_tokens: 18, text_tokens: 2 },
          output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-invalid-concept-raster" } });
    } });
  installConceptAuthority(context, provider);
  const request = conceptRequest("concept-invalid-native-raster", "1.1", 1);
  const result = await context.api.invoke(authorizedActor(), request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.status, "partial",
    "the exact provider image is unknown, but its complete usage was independently settled by the C03 port");
  assert.equal(result.result.candidates.length, 0);
  assert.deepEqual(result.result.progress.map((slot) => slot.status), ["unknown"]);
  assert.equal(providerPosts, 1);
  assert.equal(context.counters.reserves, 1);
  assert.equal(context.counters.settlements, 1, "the complete usage observation settles the fixture C03 attempt even though image validation fails");
  assert.equal(context.counters.held, 0,
    "the C03 executor did not retain a financial hold after confirming settlement");
  const batch = context.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id }).batch;
  assert.equal(batch.slots.length, 1);
  assert.equal(batch.slots[0].attempts.length, 1);
  const attempt = batch.slots[0].attempts[0];
  assert.equal(attempt.status, "unknown");
  assert.equal(attempt.unknown_financial_exposure, false);
  assert.equal(typeof attempt.billable_attempt_id, "string");
  assert.equal(typeof attempt.transport_attempt_id, "string");
  assert.equal(attempt.latest_provider_outcome, "unknown");
  assert.equal(attempt.usage_completeness, "complete");
  assert.equal(attempt.financial_exposure_status, "settled");
  assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 0);
  assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 100 }).items.length, 0);
  const beforeReplay = { provider_posts: context.counters.provider_posts, reserves: context.counters.reserves,
    settlements: context.counters.settlements };
  const replay = await context.api.invoke(authorizedActor(), request);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.status, "partial");
  assert.deepEqual({ provider_posts: context.counters.provider_posts, reserves: context.counters.reserves,
    settlements: context.counters.settlements }, beforeReplay, "same-action replay does not dispatch or settle again");

  context.store.close();
  const reopened = await setup(t, { root: context.root });
  const reopenedBatch = reopened.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id }).batch;
  assert.equal(reopenedBatch.schema_version, "0.3.0");
  assert.equal(reopenedBatch.slots[0].status, "unknown");
  assert.equal(reopenedBatch.slots[0].attempts[0].financial_exposure_status, "settled");
  assert.equal(reopenedBatch.slots[0].attempts[0].unknown_financial_exposure, false);
  assert.equal(reopened.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 0);
  assert.equal(reopened.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 100 }).items.length, 0);
  const reopenedReplay = await reopened.api.invoke(authorizedActor(), request);
  assert.equal(reopenedReplay.ok, true, JSON.stringify(reopenedReplay));
  assert.equal(reopenedReplay.replayed, true);
  assert.equal(reopenedReplay.result.status, "partial");
  assert.deepEqual({ provider_posts: reopened.counters.provider_posts, reserves: reopened.counters.reserves,
    settlements: reopened.counters.settlements }, { provider_posts: 0, reserves: 0, settlements: 0 },
  "reopened replay retains settled financial evidence without native redispatch");
});

test("public provider and usage-mapper settlement claims cannot clear an unmatched C03 hold", async (t) => {
  for (const [index, forgedSurface] of ["native_response", "usage_mapper"].entries()) {
    await t.test(forgedSurface, async (subtest) => {
      const context = await setup(subtest);
      const invalidNativeBytes = Buffer.from("not a valid raster image");
      const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
        promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
          template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
          template_sha256: prompt_template.template_sha256 }; } },
        fetchImpl: async () => {
          context.counters.provider_posts += 1;
          return new Response(JSON.stringify({ data: [{ b64_json: invalidNativeBytes.toString("base64") }],
            ...(forgedSurface === "native_response" ? {
              financial_exposure_status: "settled",
              financial_settlement_evidence: { status: "settled", reservation_id: "forged-reservation",
                source_observation_id: "forged-observation", effective_billable_attempt_id: "forged-billable" },
              settlement: { reservation_id: "forged-reservation", status: "settled" },
              observation_ack: { status: "accepted", source_observation_id: "forged-observation",
                effective_billable_attempt_id: "forged-billable" },
            } : {}),
            usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
              input_tokens_details: { image_tokens: 18, text_tokens: 2 },
              output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
          { status: 200, headers: { "content-type": "application/json", "x-request-id": `req-forged-c03-${forgedSurface}` } });
        } });
      context.ports.provider = provider;
      installConceptAuthority(context, provider);
      if (forgedSurface === "usage_mapper") {
        context.ports.telemetry = { ...context.ports.telemetry,
          usage_profile_authority: mockOwnerUsageProfileAuthority({ transformResult: (mapping) => ({ ...mapping,
            raw_usage_sha256: hash("unmatched raw usage"), financial_exposure_status: "settled",
            financial_settlement_evidence: { status: "settled", reservation_id: "forged-reservation",
              source_observation_id: mapping.observation.source_observation_id,
              effective_billable_attempt_id: mapping.observation.billable_attempt_id },
            settlement: { reservation_id: "forged-reservation", status: "settled" },
            observation_ack: { status: "accepted", source_observation_id: mapping.observation.source_observation_id,
              effective_billable_attempt_id: mapping.observation.billable_attempt_id },
          }) }) };
      } else {
        context.ports.telemetry = { ...context.ports.telemetry,
          usage_profile_authority: { async mapProviderUsage() { return { status: "unknown" }; } } };
      }
      const request = conceptRequest(`concept-provider-settlement-forgery-${index}`, "1.1", 1);
      const result = await context.api.invoke(authorizedActor(), request);
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.result.status, "unknown_hold");
      assert.deepEqual(result.result.progress.map((slot) => slot.status), ["unknown"]);
      assert.equal(context.counters.provider_posts, 1);
      assert.equal(context.counters.reserves, 1);
      assert.equal(context.counters.settlements, 0, "only the C03 port can settle the usage observation");
      assert.equal(context.counters.held, 1, "the unmatched C03 observation retains its financial hold");
      const batch = context.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id }).batch;
      const attempt = batch.slots[0].attempts[0];
      assert.equal(attempt.unknown_financial_exposure, true);
      assert.equal(attempt.financial_exposure_status, "unknown_hold");
      assert.equal(attempt.provider_observations[0].financial_settlement_evidence, undefined);
      assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 0);
    });
  }
});

test("an explicitly eligible fully mapped native failure gets one distinct metered retry for a single concept", async (t) => {
  const context = await setup(t);
  const outputBytes = makePng({ width: 16, height: 16 });
  let providerPosts = 0;
  const usage = { input_tokens: 20, output_tokens: 10, total_tokens: 30,
    input_tokens_details: { image_tokens: 18, text_tokens: 2 },
    output_tokens_details: { image_tokens: 9, text_tokens: 1 } };
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
      template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
      template_sha256: prompt_template.template_sha256 }; } },
    fetchImpl: async (url, init) => {
      providerPosts += 1;
      context.counters.provider_posts += 1;
      assert.equal(String(url), "https://api.openai.com/v1/images/edits");
      assert.equal(init.body.getAll("image[]").length, 2);
      if (providerPosts === 1) return new Response(JSON.stringify({ error: { code: "request_conflict" }, usage }),
        { status: 409, headers: { "content-type": "application/json", "x-request-id": "req-concept-retry-first" } });
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }], usage }),
        { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-concept-retry-second" } });
    } });
  installConceptAuthority(context, provider);
  const request = conceptRequest("concept-known-failure-retry", "1.1", 1);
  const result = await context.api.invoke(authorizedActor(), request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.status, "completed");
  assert.equal(result.result.candidates.length, 1);
  assert.equal(providerPosts, 2);
  assert.equal(context.counters.reserves, 2);
  assert.equal(context.counters.settlements, 2);
  assert.equal(context.counters.held, 0);
  assert.equal(context.counters.usage_observations.length, 2);
  const attempts = context.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id }).batch.slots[0].attempts;
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].latest_provider_outcome, "failed");
  assert.equal(attempts[0].latest_retry_disposition, "eligible_retry");
  assert.equal(attempts[0].usage_completeness, "complete");
  assert.equal(attempts[0].financial_exposure_status, "settled");
  assert.equal(attempts[0].unknown_financial_exposure, false);
  assert.equal(attempts[1].latest_provider_outcome, "succeeded");
  assert.equal(attempts[1].usage_completeness, "complete");
  assert.equal(attempts[1].unknown_financial_exposure, false);
  assert.equal(new Set(attempts.map((attempt) => attempt.billable_attempt_id)).size, 2);
  assert.equal(new Set(attempts.map((attempt) => attempt.transport_attempt_id)).size, 2);
  assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 1);
});

test("durable native authorization, quota, policy, permission, and malformed-request hard stops prevent more concept spend", async (t) => {
  const cases = [
    { label: "auth count one", count: 1, status: 401, code: "invalid_api_key" },
    { label: "permission count one", count: 1, status: 403, code: "permission_denied" },
    { label: "quota count one", count: 1, status: 429, code: "insufficient_quota" },
    { label: "moderation count one", count: 1, status: 400, code: "moderation_blocked" },
    { label: "malformed request count one", count: 1, status: 400, code: "invalid_request" },
    { label: "auth count two", count: 2, status: 401, code: "invalid_api_key", reopen: true },
    { label: "quota count two", count: 2, status: 429, code: "insufficient_quota", reopen: true },
    { label: "moderation count two", count: 2, status: 400, code: "moderation_blocked", reopen: true },
  ];
  const usage = { input_tokens: 20, output_tokens: 10, total_tokens: 30,
    input_tokens_details: { image_tokens: 18, text_tokens: 2 },
    output_tokens_details: { image_tokens: 9, text_tokens: 1 } };
  for (const scenario of cases) await t.test(scenario.label, async (subtest) => {
    const context = await setup(subtest);
    const outputBytes = makePng({ width: 16, height: 16 });
    let providerPosts = 0;
    const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
      promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
        template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
        template_sha256: prompt_template.template_sha256 }; } },
      fetchImpl: async () => {
        providerPosts += 1;
        context.counters.provider_posts += 1;
        if (providerPosts === 1) return new Response(JSON.stringify({ error: { code: scenario.code }, usage }),
          { status: scenario.status, headers: { "content-type": "application/json", "x-request-id": `req-hard-stop-${scenario.label.replaceAll(" ", "-")}` } });
        return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }], usage }),
          { status: 200, headers: { "content-type": "application/json", "x-request-id": `req-unexpected-second-${scenario.label.replaceAll(" ", "-")}` } });
      } });
    installConceptAuthority(context, provider);
    const request = conceptRequest(`concept-hard-stop-${scenario.label.replaceAll(" ", "-")}`, "1.1", scenario.count);
    const result = await context.api.invoke(authorizedActor(), request);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.status, "partial");
    assert.equal(result.result.candidates.length, 0);
    assert.deepEqual(result.result.progress.map((slot) => slot.status), scenario.count === 1 ? ["failed"] : ["failed", "pending"]);
    assert.equal(providerPosts, 1);
    assert.equal(context.counters.provider_posts, 1);
    assert.equal(context.counters.reserves, 1);
    assert.equal(context.counters.settlements, 1);
    assert.equal(context.counters.held, 0);
    const batch = context.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id }).batch;
    const attempt = batch.slots[0].attempts[0];
    assert.equal(attempt.latest_provider_outcome, "failed");
    assert.equal(attempt.latest_retry_disposition, "hard_stop");
    assert.equal(attempt.provider_observations[0].retry_disposition, "hard_stop");
    assert.equal(attempt.usage_completeness, "complete");
    assert.equal(attempt.financial_exposure_status, "settled");
    assert.equal(attempt.unknown_financial_exposure, false);
    assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 0);

    if (scenario.reopen) {
      const root = context.root;
      context.store.close();
      const reopened = await setup(subtest, { root, idPrefix: `hard-stop-reopen-${scenario.label.replaceAll(" ", "-")}` });
      const reopenedProvider = createNativeProvider({ store: reopened.store, referenceAssetBytes: reopened.referenceAssetBytes,
        fetchImpl: async () => { throw new Error("durable hard stop must not dispatch after process restart"); } });
      installConceptAuthority(reopened, reopenedProvider);
      const replay = await reopened.api.invoke(authorizedActor(), request);
      assert.equal(replay.ok, true, JSON.stringify(replay));
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.result, result.result);
      assert.equal(reopened.counters.provider_posts, 0);
      assert.equal(reopened.counters.reserves, 0);
      assert.equal(reopened.counters.settlements, 0);
    } else {
      const replay = await context.api.invoke(authorizedActor(), request);
      assert.equal(replay.ok, true, JSON.stringify(replay));
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.result, result.result);
      assert.equal(providerPosts, 1);
    }
  });
});

test("a settled per-slot request conflict preserves the other immutable ordinal across replay and reopen", async (t) => {
  for (const failedOrdinal of [1, 2]) await t.test(`ordinal ${failedOrdinal} fails`, async (subtest) => {
    const context = await setup(subtest);
    const outputs = [makePng({ width: 16, height: 16 }), makePng({ width: 16, height: 16, transparent: true })];
    const usage = { input_tokens: 20, output_tokens: 10, total_tokens: 30,
      input_tokens_details: { image_tokens: 18, text_tokens: 2 },
      output_tokens_details: { image_tokens: 9, text_tokens: 1 } };
    let providerPosts = 0;
    const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
      promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
        template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
        template_sha256: prompt_template.template_sha256 }; } },
      fetchImpl: async (url, init) => {
        providerPosts += 1;
        context.counters.provider_posts += 1;
        assert.equal(String(url), "https://api.openai.com/v1/images/edits");
        assert.equal(init.body.getAll("image[]").length, 2);
        assert.equal(init.body.has("mask"), false);
        if (providerPosts === failedOrdinal) return new Response(JSON.stringify({ error: { code: "request_conflict" }, usage }),
          { status: 409, headers: { "content-type": "application/json", "x-request-id": `req-partial-conflict-${failedOrdinal}` } });
        return new Response(JSON.stringify({ data: [{ b64_json: outputs[providerPosts - 1].toString("base64") }], usage }),
          { status: 200, headers: { "content-type": "application/json", "x-request-id": `req-partial-success-${failedOrdinal}` } });
      } });
    installConceptAuthority(context, provider);
    const request = conceptRequest(`concept-partial-ordinal-${failedOrdinal}`, "1.1", 2);
    const result = await context.api.invoke(authorizedActor(), request);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.status, "partial");
    assert.equal(result.result.candidates.length, 1);
    const candidate = result.result.candidates[0];
    const expectedOrdinal = failedOrdinal === 1 ? 2 : 1;
    assert.equal(candidate.ordinal, expectedOrdinal);
    assert.equal(candidate.design_version.parent_version_id, null);
    assert.equal(providerPosts, 2);
    assert.equal(context.counters.reserves, 2);
    assert.equal(context.counters.settlements, 2);
    const generic = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
      design_version_id: candidate.design_version.design_version_id });
    assert.deepEqual(generic, candidate.design_version);
    const listed = context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 100 });
    assert.ok(listed.items.some((item) => item.design_version_id === candidate.design_version.design_version_id));
    const durable = context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id });
    assert.equal(durable.length, 1);
    assert.equal(durable[0].ordinal, expectedOrdinal);
    assert.deepEqual(durable[0].design_version, generic);
    const versionRow = context.store.db.prepare(`SELECT action_id,creation_job_id FROM design_versions
      WHERE tenant_id=? AND project_id=? AND brief_id=? AND design_version_id=?`)
      .get(SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id, candidate.design_version.design_version_id);
    const batchAction = context.store.db.prepare(`SELECT action_id,state FROM creation_actions
      WHERE tenant_id=? AND project_id=? AND action_id=?`)
      .get(SCOPE.tenant_id, SCOPE.project_id, request.action_id);
    assert.equal(versionRow.action_id, expectedOrdinal === 1 ? request.action_id
      : `concept-version-${canonicalHash({ action_id: request.action_id, concept_id: candidate.concept_id }).slice(7)}`);
    assert.equal(batchAction.action_id, request.action_id);
    assert.equal(batchAction.state, "committed");

    const replay = await context.api.invoke(authorizedActor(), request);
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, result.result);
    assert.equal(providerPosts, 2, "same-action replay never bills or regenerates the durable candidate");

    const root = context.root;
    context.store.close();
    const reopened = await setup(subtest, { root, idPrefix: `partial-reopen-${failedOrdinal}` });
    let reopenedPosts = 0;
    installConceptAuthority(reopened, createNativeProvider({ store: reopened.store,
      referenceAssetBytes: reopened.referenceAssetBytes,
      fetchImpl: async () => { reopenedPosts += 1; throw new Error("durable partial replay must not dispatch"); } }));
    const reopenedReplay = await reopened.api.invoke(authorizedActor(), request);
    assert.equal(reopenedReplay.ok, true, JSON.stringify(reopenedReplay));
    assert.equal(reopenedReplay.replayed, true);
    assert.deepEqual(reopenedReplay.result, result.result);
    assert.equal(reopenedPosts, 0);
    assert.equal(reopened.counters.reserves, 0);
    assert.equal(reopened.counters.settlements, 0);
  });
});

test("concept publication rejects a forged slot ordinal before either generic sibling becomes visible", async (t) => {
  const context = await setup(t);
  const usage = { input_tokens: 20, output_tokens: 10, total_tokens: 30,
    input_tokens_details: { image_tokens: 18, text_tokens: 2 },
    output_tokens_details: { image_tokens: 9, text_tokens: 1 } };
  let providerPosts = 0;
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    promptPort: syntheticNativePromptPort(),
    fetchImpl: async () => {
      providerPosts += 1;
      context.counters.provider_posts += 1;
      const outputBytes = makePng({ width: 16, height: 16, transparent: providerPosts === 2 });
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }], usage }),
        { status: 200, headers: { "content-type": "application/json", "x-request-id": `req-forged-ordinal-${providerPosts}` } });
    } });
  installConceptAuthority(context, provider);
  const commit = context.store.commitConceptDesignVersions.bind(context.store);
  context.store.commitConceptDesignVersions = (inputs, transaction) => commit(inputs.map((input, index) => index === 1
    ? { ...input, concept_identity: { ...input.concept_identity, ordinal: 1 } } : input), transaction);
  const request = conceptRequest("concept-forged-publication-ordinal", "1.1", 2);
  const result = await context.api.invoke(authorizedActor(), request);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "stale_version",
    "the API job port maps a publication identity conflict to its established stale-context response");
  assert.equal(result.error.field, "creative_context");
  assert.equal(providerPosts, 2);
  assert.equal(context.counters.reserves, 2);
  assert.equal(context.counters.settlements, 2);
  assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 0);
  assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 100 }).items.length, 0);
  const job = context.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id });
  assert.deepEqual(job.batch.slots.map((slot) => slot.status), ["staged", "staged"],
    "the failed publication transaction leaves both staged candidates private and resumable");
  assert.equal(context.store.db.prepare(`SELECT COUNT(*) AS count FROM creation_actions
    WHERE tenant_id=? AND project_id=? AND action_id=?`).get(SCOPE.tenant_id, SCOPE.project_id, request.action_id).count, 0);
});

test("completed concepts replay validates its retained brief after a legitimate brief revision", async (t) => {
  const successfulAction = async (subtest, actionId) => {
    const context = await setup(subtest);
    let providerPosts = 0;
    const outputBytes = makePng({ width: 16, height: 16 });
    const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
      promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
        template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
        template_sha256: prompt_template.template_sha256 }; } },
      fetchImpl: async () => {
        providerPosts += 1;
        context.counters.provider_posts += 1;
        return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
            input_tokens_details: { image_tokens: 18, text_tokens: 2 },
            output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
        { status: 200, headers: { "content-type": "application/json", "x-request-id": `req-history-${actionId}` } });
      } });
    installConceptAuthority(context, provider);
    const request = conceptRequest(actionId, "1.1", 1);
    const original = await context.api.invoke(authorizedActor(), request);
    assert.equal(original.ok, true, JSON.stringify(original));
    const revisedBrief = structuredClone(context.brief);
    revisedBrief.event_id = `event-revised-${actionId}`;
    revisedBrief.facts.verified[0].value = "Updated event name";
    const update = context.store.putBrief({ scope: SCOPE, brief: revisedBrief,
      expected_brief_hash: canonicalHash(context.brief) });
    assert.equal(update.status, "saved");
    return { context, request, original, providerPosts: () => providerPosts };
  };

  await t.test("authorized exact replay returns identical result without redispatch", async (subtest) => {
    const { context, request, original, providerPosts } = await successfulAction(subtest, "concept-history-replay");
    const otherActor = await context.api.invoke({ ...authorizedActor(), actor_id: "different-authorized-actor" }, request);
    assert.equal(otherActor.ok, false);
    const wrongScope = await context.api.invoke(authorizedActor(), { ...request, project_id: "different-project" });
    assert.equal(wrongScope.ok, false);
    const replay = await context.api.invoke(authorizedActor(), request);
    assert.equal(replay.ok, true, JSON.stringify(replay));
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.result, original.result);
    assert.equal(providerPosts(), 1);
    assert.equal(context.counters.reserves, 1);
    assert.equal(context.counters.settlements, 1);
  });

  for (const historyMode of ["missing", "tampered"]) await t.test(`${historyMode} retained brief fails closed`, async (subtest) => {
    const { context, request, providerPosts } = await successfulAction(subtest, `concept-history-${historyMode}`);
    const storage = context.ports.storage;
    context.ports.storage = { ...storage, async getBriefVersionByHash(input) {
      const historic = await storage.getBriefVersionByHash(input);
      if (historyMode === "missing") return null;
      const changed = structuredClone(historic);
      changed.facts.verified[0].value = "Tampered retained event";
      return changed;
    } };
    const replay = await context.api.invoke(authorizedActor(), request);
    assert.equal(replay.ok, false);
    assert.equal(replay.error.code, historyMode === "missing" ? "unavailable" : "failed");
    assert.equal(replay.error.field, historyMode === "missing" ? "brief_history" : "brief_history.hash");
    assert.equal(providerPosts(), 1, "invalid history cannot trigger a replacement generation");
    assert.equal(context.counters.reserves, 1);
    assert.equal(context.counters.settlements, 1);
    assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 1);
  });
});

test("concept response stage survives a hard process exit and resumes the identical attempt without redispatch", async (t) => {
  if (process.env.CONCEPT_HARD_EXIT_CHILD === "1") {
    const root = process.env.CONCEPT_HARD_EXIT_ROOT;
    assert.equal(typeof root, "string");
    const context = await setup(t, { root, idPrefix: "crash-child" });
    const outputBytes = makePng({ width: 16, height: 16 });
    const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
      promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
        template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
        template_sha256: prompt_template.template_sha256 }; } },
      fetchImpl: async (url, init) => {
        assert.equal(String(url), "https://api.openai.com/v1/images/edits");
        assert.equal(init.body.getAll("image[]").length, 2);
        assert.equal(init.body.has("mask"), false);
        return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
            input_tokens_details: { image_tokens: 18, text_tokens: 2 },
            output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
        { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-hardexit-concept-1" } });
      } });
    installConceptAuthority(context, provider);
    const stageConceptResponse = context.ports.storage.stageConceptResponse;
    context.ports.storage = { ...context.ports.storage, async stageConceptResponse(input) {
      const staged = await stageConceptResponse(input);
      process.stdout.write(`durable_stage=${staged.content_hash};attempt=${input.billable_attempt_id}\n`);
      process.exit(86);
    } };
    await context.api.invoke(authorizedActor(), conceptRequest("hardexit-concept-action", "1.1", 2));
    process.exit(87);
  }

  const initial = await setup(t);
  const root = initial.root;
  initial.store.close();
  const childEnvironment = { ...process.env, CONCEPT_HARD_EXIT_CHILD: "1", CONCEPT_HARD_EXIT_ROOT: root };
  delete childEnvironment.NODE_TEST_CONTEXT;
  delete childEnvironment.NODE_TEST_WORKER_ID;
  const child = spawnSync(process.execPath,
    ["--test", "--test-reporter=tap", "--test-name-pattern=concept response stage survives a hard process exit",
      fileURLToPath(import.meta.url)],
    { cwd: process.cwd(), env: childEnvironment,
      encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(child.error, undefined, child.error?.message);
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.equal(child.status, 1, `the outer node:test driver reports its worker's hard exit as a failed test, got ${child.status}`);
  const durableStage = child.stdout.match(/durable_stage=(sha256:[a-f0-9]{64});attempt=([A-Za-z0-9._:/@+-]+)/);
  assert.ok(durableStage, "the child must print its committed response stage before exiting");
  assert.match(child.stdout, /exitCode: 86/, "the isolated worker must be observed exiting with the requested hard-exit code");

  const recovered = await setup(t, { root, initialNow: NOW + 61_000, idPrefix: "crash-recovery" });
  const request = conceptRequest("hardexit-concept-action", "1.1", 2);
  const batchBefore = recovered.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id });
  assert.equal(batchBefore.batch.slots[0].status, "dispatching");
  const stageBefore = recovered.store.getConceptResponseStage({ scope: SCOPE, action_id: request.action_id,
    concept_id: batchBefore.batch.slots[0].concept_id });
  assert.ok(stageBefore);
  const attemptBefore = batchBefore.batch.slots[0].attempts[0];
  assert.equal(stageBefore.billable_attempt_id, attemptBefore.billable_attempt_id);
  assert.equal(stageBefore.transport_attempt_id, attemptBefore.transport_attempt_id);
  const stageBytes = Buffer.from(stageBefore.response_bytes);
  const stageHash = hash(stageBytes);
  assert.equal(stageHash, stageBefore.content_hash);
  assert.equal(durableStage[1], stageHash);
  assert.equal(durableStage[2], attemptBefore.billable_attempt_id);

  let remainingSlotDispatches = 0;
  const recoveryProvider = createNativeProvider({ store: recovered.store,
    referenceAssetBytes: recovered.referenceAssetBytes, promptPort: { async render({ prompt_template }) {
      return { prompt: "Synthetic integration prompt with no model authority.",
        template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
        template_sha256: prompt_template.template_sha256 };
    } }, fetchImpl: async () => {
      remainingSlotDispatches += 1;
      const outputBytes = makePng({ width: 16, height: 16, transparent: true });
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
          input_tokens_details: { image_tokens: 18, text_tokens: 2 },
          output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-hardexit-concept-resume" } });
    } });
  installConceptAuthority(recovered, recoveryProvider);
  const resumed = await recovered.api.invoke(authorizedActor(), request);
  assert.equal(remainingSlotDispatches, 0, "an unresolved C03 settlement hold blocks fresh sibling spend");
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.result.status, "unknown_hold");
  assert.equal(resumed.result.candidates.length, 1);
  assert.equal(resumed.result.candidates[0].design_version.artifact.content_hash, stageHash);
  assert.equal(resumed.result.candidates[0].design_version.parent_version_id, null);
  assert.deepEqual(resumed.result.progress.map((item) => item.status), ["succeeded", "pending"]);
  const batchAfter = recovered.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id });
  const stageAfter = recovered.store.getConceptResponseStage({ scope: SCOPE, action_id: request.action_id,
    concept_id: batchAfter.batch.slots[0].concept_id });
  assert.deepEqual(Buffer.from(stageAfter.response_bytes), stageBytes);
  assert.equal(stageAfter.content_hash, stageBefore.content_hash);
  assert.equal(batchAfter.batch.slots[0].attempts.length, 1);
  assert.equal(batchAfter.batch.slots[0].attempts[0].billable_attempt_id, attemptBefore.billable_attempt_id);
  assert.equal(batchAfter.batch.slots[0].attempts[0].transport_attempt_id, attemptBefore.transport_attempt_id);
  assert.equal(batchAfter.batch.slots[1].attempts.length, 0);
  assert.equal(recovered.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 1);
});

test("a durable native hard stop blocks fresh sibling spend after process exit", async (t) => {
  if (process.env.CONCEPT_HARD_STOP_CHILD === "1") {
    const root = process.env.CONCEPT_HARD_STOP_ROOT;
    assert.equal(typeof root, "string");
    const context = await setup(t, { root, idPrefix: "hard-stop-crash-child" });
    const usage = { input_tokens: 20, output_tokens: 10, total_tokens: 30,
      input_tokens_details: { image_tokens: 18, text_tokens: 2 },
      output_tokens_details: { image_tokens: 9, text_tokens: 1 } };
    const appendConceptEvent = context.ports.storage.appendConceptEvent;
    let nativePosts = 0;
    const nativeProvider = createNativeProvider({ store: context.store,
      referenceAssetBytes: context.referenceAssetBytes, promptPort: syntheticNativePromptPort(),
      fetchImpl: async () => {
        nativePosts += 1;
        return new Response(JSON.stringify({ error: { code: "invalid_api_key" }, usage }),
          { status: 401, headers: { "content-type": "application/json", "x-request-id": "req-hard-stop-crash" } });
      } });
    installConceptAuthority(context, nativeProvider);
    context.ports.storage = { ...context.ports.storage, async appendConceptEvent(input) {
      const ack = await appendConceptEvent(input);
      if (input.event.event_type === "provider_outcome" && input.event.outcome === "failed") {
        const batch = ack.batch;
        const attempt = batch.slots[0].attempts[0];
        process.stdout.write("durable_hard_stop=" + batch.slots[0].status + ";retry=" +
          attempt.latest_retry_disposition + ";financial=" + attempt.financial_exposure_status +
          ";unknown=" + attempt.unknown_financial_exposure + ";posts=" + nativePosts + "\n");
        process.exit(86);
      }
      return ack;
    } };
    await context.api.invoke(authorizedActor(), conceptRequest("hard-stop-process-exit", "1.1", 2));
    process.exit(87);
  }

  const initial = await setup(t);
  const root = initial.root;
  initial.store.close();
  const childEnvironment = { ...process.env, CONCEPT_HARD_STOP_CHILD: "1", CONCEPT_HARD_STOP_ROOT: root };
  delete childEnvironment.NODE_TEST_CONTEXT;
  delete childEnvironment.NODE_TEST_WORKER_ID;
  const child = spawnSync(process.execPath,
    ["--test", "--test-reporter=tap", "--test-name-pattern=a durable native hard stop blocks fresh sibling spend",
      fileURLToPath(import.meta.url)],
    { cwd: process.cwd(), env: childEnvironment, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(child.error, undefined, child.error?.message);
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.equal(child.status, 1);
  assert.match(child.stdout, /durable_hard_stop=failed;retry=hard_stop;financial=settled;unknown=false;posts=1/);
  assert.match(child.stdout, /exitCode: 86/);

  const recovered = await setup(t, { root, initialNow: NOW + 61_000, idPrefix: "hard-stop-crash-recovery" });
  const request = conceptRequest("hard-stop-process-exit", "1.1", 2);
  const before = recovered.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id }).batch;
  assert.deepEqual(before.slots.map((slot) => slot.status), ["failed", "pending"]);
  assert.equal(before.slots[0].attempts[0].latest_retry_disposition, "hard_stop");
  assert.equal(before.slots[0].attempts[0].financial_exposure_status, "settled");
  assert.equal(before.slots[0].attempts[0].unknown_financial_exposure, false);
  const eventCount = recovered.store.db.prepare("SELECT COUNT(*) AS count FROM creative_concept_events_v1 WHERE tenant_id=? AND project_id=? AND brief_id=? AND action_id=?")
    .get(SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id, request.action_id).count;
  let resumedPosts = 0;
  installConceptAuthority(recovered, createNativeProvider({ store: recovered.store,
    referenceAssetBytes: recovered.referenceAssetBytes,
    fetchImpl: async () => { resumedPosts += 1; throw new Error("durable hard stop must not spend after restart"); } }));
  const resumed = await recovered.api.invoke(authorizedActor(), request);
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.result.status, "partial");
  assert.deepEqual(resumed.result.progress.map((slot) => slot.status), ["failed", "pending"]);
  assert.equal(resumed.result.candidates.length, 0);
  assert.equal(resumedPosts, 0);
  assert.equal(recovered.counters.provider_posts, 0);
  assert.equal(recovered.counters.reserves, 0);
  assert.equal(recovered.counters.settlements, 0);
  assert.equal(recovered.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id }).batch.slots[0]
    .attempts[0].latest_retry_disposition, "hard_stop");
  assert.equal(recovered.store.db.prepare("SELECT COUNT(*) AS count FROM creative_concept_events_v1 WHERE tenant_id=? AND project_id=? AND brief_id=? AND action_id=?")
    .get(SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id, request.action_id).count, eventCount,
  "recovery completes the partial job without changing or repeating the hard-stop event history");
});

test("legacy concept batches upgrade through durable events before recovery", async (t) => {
  if (process.env.CONCEPT_LEGACY_SCHEMA_CHILD === "1") {
    const root = process.env.CONCEPT_LEGACY_SCHEMA_ROOT;
    const schemaVersion = process.env.CONCEPT_LEGACY_SCHEMA_VERSION;
    assert.equal(typeof root, "string");
    assert.ok(["0.1.0", "0.2.0"].includes(schemaVersion));
    const context = await setup(t, { root, idPrefix: "legacy-schema-child" });
    const usage = { input_tokens: 20, output_tokens: 10, total_tokens: 30,
      input_tokens_details: { image_tokens: 18, text_tokens: 2 },
      output_tokens_details: { image_tokens: 9, text_tokens: 1 } };
    const provider = createNativeProvider({ store: context.store,
      referenceAssetBytes: context.referenceAssetBytes,
      promptPort: syntheticNativePromptPort(),
      fetchImpl: async () => {
        context.counters.provider_posts += 1;
        if (schemaVersion === "0.1.0") {
          throw new Error("legacy v0.1 cut exits before provider response");
        }
        return new Response(JSON.stringify({ error: { code: "request_conflict" }, usage }),
          { status: 409, headers: { "content-type": "application/json", "x-request-id": "req-legacy-v2-conflict" } });
      } });
    installConceptAuthority(context, provider);
    const originalAppend = context.ports.storage.appendConceptEvent;
    context.ports.storage = { ...context.ports.storage, async appendConceptEvent(input) {
      if (schemaVersion === "0.1.0" && input.event.event_type === "dispatch_started") {
        const ack = await originalAppend(input);
        const legacy = structuredClone(ack.batch);
        legacy.schema_version = "0.1.0";
        for (const slot of legacy.slots) for (const attempt of slot.attempts) delete attempt.latest_retry_disposition;
        context.store.db.prepare("UPDATE creative_concept_batches_v1 SET batch_json=? WHERE tenant_id=? AND project_id=? AND brief_id=? AND action_id=?")
          .run(JSON.stringify(legacy), SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id, input.action_id);
        process.stdout.write("legacy_seed=0.1.0;state=" + legacy.slots[0].status + ";posts=" +
          context.counters.provider_posts + "\n");
        process.exit(86);
      }
      if (schemaVersion === "0.2.0" && input.event.event_type === "provider_outcome") {
        const current = context.store.getConceptBatch({ scope: SCOPE, action_id: input.action_id }).batch;
        const legacy = structuredClone(current);
        legacy.schema_version = "0.2.0";
        for (const slot of legacy.slots) for (const attempt of slot.attempts) delete attempt.latest_retry_disposition;
        context.store.db.prepare("UPDATE creative_concept_batches_v1 SET batch_json=? WHERE tenant_id=? AND project_id=? AND brief_id=? AND action_id=?")
          .run(JSON.stringify(legacy), SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id, input.action_id);
        const legacyEvent = { ...input.event };
        delete legacyEvent.retry_disposition;
        const ack = await originalAppend({ ...input, event: legacyEvent });
        const attempt = ack.batch.slots[0].attempts[0];
        process.stdout.write("legacy_seed=0.2.0;state=" + ack.batch.slots[0].status +
          ";retry=" + attempt.latest_retry_disposition + ";financial=" + attempt.financial_exposure_status +
          ";unknown=" + attempt.unknown_financial_exposure + ";posts=" + context.counters.provider_posts + "\n");
        process.exit(86);
      }
      return originalAppend(input);
    } };
    await context.api.invoke(authorizedActor(), conceptRequest("legacy-schema-resume-" + schemaVersion, "1.1", 2));
    process.exit(87);
  }

  for (const schemaVersion of ["0.1.0", "0.2.0"]) await t.test("persisted " + schemaVersion + " history", async (subtest) => {
    const initial = await setup(subtest);
    const root = initial.root;
    initial.store.close();
    const childEnvironment = { ...process.env, CONCEPT_LEGACY_SCHEMA_CHILD: "1",
      CONCEPT_LEGACY_SCHEMA_ROOT: root, CONCEPT_LEGACY_SCHEMA_VERSION: schemaVersion };
    delete childEnvironment.NODE_TEST_CONTEXT;
    delete childEnvironment.NODE_TEST_WORKER_ID;
    const child = spawnSync(process.execPath,
      ["--test", "--test-reporter=tap", "--test-name-pattern=legacy concept batches upgrade through durable events",
        fileURLToPath(import.meta.url)],
      { cwd: process.cwd(), env: childEnvironment, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(child.error, undefined, child.error?.message);
    process.stdout.write(child.stdout);
    process.stderr.write(child.stderr);
    assert.equal(child.status, 1);
    assert.match(child.stdout, /exitCode: 86/);
    if (schemaVersion === "0.1.0") {
      assert.match(child.stdout, /legacy_seed=0\.1\.0;state=dispatching;posts=0/);
    } else {
      assert.match(child.stdout, /legacy_seed=0\.2\.0;state=failed;retry=undefined;financial=settled;unknown=false;posts=1/);
    }

    const recovered = await setup(subtest, { root, initialNow: NOW + 61_000, idPrefix: "legacy-schema-recovery" });
    const request = conceptRequest("legacy-schema-resume-" + schemaVersion, "1.1", 2);
    const priorRow = recovered.store.db.prepare("SELECT batch_json FROM creative_concept_batches_v1 WHERE tenant_id=? AND project_id=? AND brief_id=? AND action_id=?")
      .get(SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id, request.action_id);
    assert.ok(priorRow);
    const priorBatch = JSON.parse(priorRow.batch_json);
    assert.equal(priorBatch.schema_version, schemaVersion);
    const priorEvents = recovered.store.db.prepare("SELECT sequence,event_id,event_type,event_hash,event_json FROM creative_concept_events_v1 WHERE tenant_id=? AND project_id=? AND brief_id=? AND action_id=? ORDER BY sequence")
      .all(SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id, request.action_id);
    assert.ok(priorEvents.length >= (schemaVersion === "0.1.0" ? 2 : 3));
    if (schemaVersion === "0.2.0") {
      assert.equal(priorBatch.slots[0].status, "failed");
      assert.equal(priorBatch.slots[0].attempts[0].financial_exposure_status, "settled");
      assert.equal(priorBatch.slots[0].attempts[0].unknown_financial_exposure, false);
      assert.equal(priorBatch.slots[0].attempts[0].latest_retry_disposition, undefined);
    }
    let resumedPosts = 0;
    installConceptAuthority(recovered, createNativeProvider({ store: recovered.store,
      referenceAssetBytes: recovered.referenceAssetBytes,
      fetchImpl: async () => { resumedPosts += 1; throw new Error("legacy recovery must not dispatch again"); } }));
    const resumed = await recovered.api.invoke(authorizedActor(), request);
    assert.equal(resumed.ok, true, JSON.stringify(resumed));
    assert.equal(resumed.result.status, schemaVersion === "0.1.0" ? "unknown_hold" : "partial");
    assert.deepEqual(resumed.result.progress.map((slot) => slot.status),
      schemaVersion === "0.1.0" ? ["unknown", "pending"] : ["failed", "pending"]);
    assert.equal(resumed.result.candidates.length, 0);
    assert.equal(resumedPosts, 0);
    assert.equal(recovered.counters.provider_posts, 0);
    assert.equal(recovered.counters.reserves, 0);
    assert.equal(recovered.counters.settlements, 0);
    const after = recovered.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id }).batch;
    assert.equal(after.schema_version, "0.3.0");
    if (schemaVersion === "0.1.0") {
      assert.equal(after.slots[0].attempts[0].latest_retry_disposition, null);
      assert.equal(after.slots[0].attempts[0].unknown_financial_exposure, true);
    } else {
      assert.equal(after.slots[0].attempts[0].latest_retry_disposition, "legacy_unclassified");
      assert.equal(after.slots[0].attempts[0].financial_exposure_status, "settled");
    }
    assert.deepEqual(after.events.slice(0, priorBatch.events.length), priorBatch.events,
      "the migration keeps every prior event identity and hash in place");
    assert.equal(after.events[priorBatch.events.length].event_type, "upgrade_retry_disposition");
    const recoveredEvents = recovered.store.db.prepare("SELECT sequence,event_id,event_type,event_hash,event_json FROM creative_concept_events_v1 WHERE tenant_id=? AND project_id=? AND brief_id=? AND action_id=? ORDER BY sequence")
      .all(SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id, request.action_id);
    assert.deepEqual(recoveredEvents.slice(0, priorEvents.length), priorEvents,
      "the upgrade appends a new immutable database event without rewriting historical event bytes");
  });
});

test("a reconciled staged sibling resumes the untouched slot after a hard process exit", async (t) => {
  if (process.env.CONCEPT_SETTLED_HARD_EXIT_CHILD === "1") {
    const root = process.env.CONCEPT_SETTLED_HARD_EXIT_ROOT;
    assert.equal(typeof root, "string");
    const context = await setup(t, { root, idPrefix: "settled-crash-child" });
    const outputBytes = makePng({ width: 16, height: 16 });
    const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
      promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
        template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
        template_sha256: prompt_template.template_sha256 }; } },
      fetchImpl: async () => new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
          input_tokens_details: { image_tokens: 18, text_tokens: 2 },
          output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-settled-hardexit-1" } }) });
    installConceptAuthority(context, provider);
    const appendConceptEvent = context.ports.storage.appendConceptEvent;
    context.ports.storage = { ...context.ports.storage, async appendConceptEvent(input) {
      const ack = await appendConceptEvent(input);
      if (input.event.event_type === "provider_outcome" && input.event.outcome === "succeeded") {
        process.stdout.write(`settled_outcome=${input.event.usage_completeness};attempt=${input.event.billable_attempt_id}\n`);
        process.exit(86);
      }
      return ack;
    } };
    await context.api.invoke(authorizedActor(), conceptRequest("settled-hardexit-action", "1.1", 2));
    process.exit(87);
  }

  const initial = await setup(t);
  const root = initial.root;
  initial.store.close();
  const childEnvironment = { ...process.env, CONCEPT_SETTLED_HARD_EXIT_CHILD: "1",
    CONCEPT_SETTLED_HARD_EXIT_ROOT: root };
  delete childEnvironment.NODE_TEST_CONTEXT;
  delete childEnvironment.NODE_TEST_WORKER_ID;
  const child = spawnSync(process.execPath,
    ["--test", "--test-reporter=tap", "--test-name-pattern=a reconciled staged sibling resumes the untouched slot",
      fileURLToPath(import.meta.url)],
    { cwd: process.cwd(), env: childEnvironment, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(child.error, undefined, child.error?.message);
  process.stdout.write(child.stdout);
  process.stderr.write(child.stderr);
  assert.equal(child.status, 1);
  const settledAttempt = child.stdout.match(/settled_outcome=complete;attempt=([A-Za-z0-9._:/@+-]+)/);
  assert.ok(settledAttempt, "the durable provider outcome must carry complete usage before the child exits");
  assert.match(child.stdout, /exitCode: 86/);

  const recovered = await setup(t, { root, initialNow: NOW + 61_000, idPrefix: "settled-crash-recovery" });
  const request = conceptRequest("settled-hardexit-action", "1.1", 2);
  const batchBefore = recovered.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id });
  assert.equal(batchBefore.batch.slots[0].status, "response_received");
  const attemptBefore = batchBefore.batch.slots[0].attempts[0];
  assert.equal(attemptBefore.usage_completeness, "complete");
  assert.equal(attemptBefore.unknown_financial_exposure, false);
  assert.equal(attemptBefore.billable_attempt_id, settledAttempt[1]);
  const stageBefore = recovered.store.getConceptResponseStage({ scope: SCOPE, action_id: request.action_id,
    concept_id: batchBefore.batch.slots[0].concept_id });
  assert.ok(stageBefore);
  const stageBytes = Buffer.from(stageBefore.response_bytes);
  const stageHash = hash(stageBytes);

  let remainingSlotDispatches = 0;
  const recoveryProvider = createNativeProvider({ store: recovered.store,
    referenceAssetBytes: recovered.referenceAssetBytes, promptPort: { async render({ prompt_template }) {
      return { prompt: "Synthetic integration prompt with no model authority.",
        template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
        template_sha256: prompt_template.template_sha256 };
    } }, fetchImpl: async () => {
      remainingSlotDispatches += 1;
      const outputBytes = makePng({ width: 16, height: 16, transparent: true });
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
          input_tokens_details: { image_tokens: 18, text_tokens: 2 },
          output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-settled-hardexit-resume" } });
    } });
  installConceptAuthority(recovered, recoveryProvider);
  const resumed = await recovered.api.invoke(authorizedActor(), request);
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(resumed.result.status, "completed");
  assert.equal(remainingSlotDispatches, 1, "the reconciled attempt is reused and only the untouched slot is dispatched");
  assert.equal(resumed.result.candidates.length, 2);
  assert.equal(resumed.result.candidates[0].design_version.artifact.content_hash, stageHash);
  assert.equal(resumed.result.candidates[0].design_version.parent_version_id, null);
  assert.equal(resumed.result.candidates[1].design_version.parent_version_id, null);
  const batchAfter = recovered.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id });
  const resumedAttempt = batchAfter.batch.slots[0].attempts[0];
  assert.equal(resumedAttempt.billable_attempt_id, attemptBefore.billable_attempt_id);
  assert.equal(resumedAttempt.transport_attempt_id, attemptBefore.transport_attempt_id);
  assert.equal(resumedAttempt.usage_completeness, "complete");
  assert.equal(batchAfter.batch.slots[1].attempts.length, 1);
  assert.equal(recovered.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 2);
});

test("concept dispatch rechecks public cancellation and the durable lease after the final awaited owner authorization", async (t) => {
  for (const mode of ["cancel", "lease-expiry"]) await t.test(mode, async (subtest) => {
    const context = await setup(subtest, { idPrefix: `concept-${mode}` });
    const outputBytes = makePng({ width: 16, height: 16 });
    let providerPosts = 0;
    const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
      promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
        template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
        template_sha256: prompt_template.template_sha256 }; } },
      fetchImpl: async () => {
        providerPosts += 1;
        return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
          usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
            input_tokens_details: { image_tokens: 18, text_tokens: 2 },
            output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
        { status: 200, headers: { "content-type": "application/json", "x-request-id": `req-concept-${mode}` } });
      } });
    installConceptAuthority(context, provider);
    const reachedFinalAuthorization = deferred();
    const releaseFinalAuthorization = deferred();
    const authorizationCountByTransport = new Map();
    const actualAuthorizeDispatch = context.ports.jobs.authorizeDispatch.bind(context.ports.jobs);
    let paused = false;
    context.ports.jobs = { ...context.ports.jobs, async authorizeDispatch(input) {
      const authorized = await actualAuthorizeDispatch(input);
      const count = (authorizationCountByTransport.get(input.transport_attempt_id) ?? 0) + 1;
      authorizationCountByTransport.set(input.transport_attempt_id, count);
      if (!paused && count === 5 && authorized.status === "authorized") {
        paused = true;
        reachedFinalAuthorization.resolve();
        await releaseFinalAuthorization.promise;
      }
      return authorized;
    } };

    const request = conceptRequest(`concept-final-fence-${mode}`);
    const inFlight = context.api.invoke(authorizedActor(), request);
    const reached = await Promise.race([reachedFinalAuthorization.promise.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 5_000))]);
    assert.equal(reached, true, "the intercepted native attempt must reach the final awaited owner authorization");
    try {
      if (mode === "cancel") {
        const job = context.store.db.prepare(`SELECT job_id FROM creative_jobs
          WHERE tenant_id=? AND project_id=? AND action_id=?`).get(SCOPE.tenant_id, SCOPE.project_id, request.action_id);
        assert.ok(job?.job_id);
        const cancelled = await context.api.invoke(authorizedActor(), cancelRequest(`cancel-${request.action_id}`, job.job_id));
        assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
      } else {
        context.advanceClock(60_001);
      }
    } finally {
      releaseFinalAuthorization.resolve();
    }

    const result = await inFlight;
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(providerPosts, 0, "the intercepted native POST must remain unsent after cancellation or lease expiry");
    const batch = context.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id });
    assert.ok(batch);
    const slot = batch.batch.slots[0];
    assert.equal(slot.status, "unknown");
    assert.equal(slot.attempts.length, 1);
    assert.equal(slot.attempts[0].unknown_financial_exposure, true);
    assert.equal(slot.attempts[0].usage_completeness, "unknown");
    assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 0);
    assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 100 }).items
      .some((version) => version.logical_operation_id === request.action_id), false);
  });
});

test("late native concept response after public cancellation stays private and leaves an unknown financial hold", async (t) => {
  const context = await setup(t);
  const outputBytes = makePng({ width: 16, height: 16 });
  const fetchStarted = deferred();
  const releaseResponse = deferred();
  let providerPosts = 0;
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
      template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
      template_sha256: prompt_template.template_sha256 }; } },
    fetchImpl: async (url, init) => {
      providerPosts += 1;
      assert.equal(String(url), "https://api.openai.com/v1/images/edits");
      assert.equal(init.body.getAll("image[]").length, 2);
      fetchStarted.resolve();
      return releaseResponse.promise;
    } });
  installConceptAuthority(context, provider);
  const actualAppendConceptEvent = context.ports.storage.appendConceptEvent.bind(context.ports.storage);
  let rejectedForeignUsageReference = false;
  let rejectedBorrowedTransaction = false;
  context.ports.storage = { ...context.ports.storage, async appendConceptEvent(input) {
    if (input.event.event_type === "provider_outcome" && !rejectedForeignUsageReference) {
      rejectedForeignUsageReference = true;
      const currentSlot = context.store.getConceptBatch({ scope: SCOPE, action_id: input.action_id }).batch.slots[0];
      const currentAttempt = currentSlot.attempts[0].metering_attempt;
      const currentObservation = context.counters.usage_observations[0];
      assert.ok(currentObservation);
      const foreignLogicalId = "logical:foreign-observation";
      const foreignBillableId = "billable:foreign-observation";
      const foreignTransportId = "transport:foreign-observation";
      const foreignObservation = await context.ports.telemetry.outbox.enqueueUsageObservation({
        attempt: { ...currentAttempt, logical_operation_id: foreignLogicalId, billable_attempt_id: foreignBillableId },
        trustedScope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
          budget_scope_id: currentAttempt.budget_scope_id },
        observation: { ...currentObservation, logical_operation_id: foreignLogicalId,
          billable_attempt_id: foreignBillableId, source_observation_id: "usage:foreign-existing-observation",
          transport_attempt_id: foreignTransportId },
      });
      const forged = { ...input, event: { ...input.event, event_id: `${input.event.event_id}-foreign-observation`,
        usage_evidence_ref: foreignObservation.record_ref } };
      await assert.rejects(actualAppendConceptEvent(forged), (error) =>
        error?.name === "VersionStoreError" && error?.code === "unavailable" && error?.field === "concept.job");
      assert.equal(context.store.db.prepare(`SELECT 1 AS present FROM creative_concept_events_v1 WHERE event_id=?`)
        .get(forged.event.event_id), undefined);
    }
    if (input.event.event_type === "provider_outcome" && !rejectedBorrowedTransaction) {
      rejectedBorrowedTransaction = true;
      context.store.db.exec("BEGIN IMMEDIATE");
      try {
        context.store.db.exec(`CREATE TABLE borrowed_late_concept_sentinels (
          id TEXT PRIMARY KEY, value TEXT NOT NULL
        ) STRICT`);
        context.store.db.prepare("INSERT INTO borrowed_late_concept_sentinels VALUES(?,?)")
          .run("outer", "caller-owned");
        context.store.db.exec("SAVEPOINT borrowed_late_concept");
        context.store.db.prepare("INSERT INTO borrowed_late_concept_sentinels VALUES(?,?)")
          .run("savepoint", "caller-savepoint");
        await assert.rejects(actualAppendConceptEvent(input), (error) =>
          error?.name === "VersionStoreError" && error?.code === "unavailable" &&
          error?.field === "concept.event.transaction");
        assert.equal(context.store.db.isTransaction, true);
        assert.deepEqual(context.store.db.prepare(`SELECT id,value FROM borrowed_late_concept_sentinels ORDER BY id`).all()
          .map((row) => ({ ...row })), [
          { id: "outer", value: "caller-owned" },
          { id: "savepoint", value: "caller-savepoint" },
        ]);
        context.store.db.exec("ROLLBACK TO borrowed_late_concept");
        context.store.db.exec("RELEASE borrowed_late_concept");
        assert.deepEqual(context.store.db.prepare(`SELECT id,value FROM borrowed_late_concept_sentinels`).all()
          .map((row) => ({ ...row })), [{ id: "outer", value: "caller-owned" }]);
      } finally {
        if (context.store.db.isTransaction) context.store.db.exec("ROLLBACK");
      }
    }
    return actualAppendConceptEvent(input);
  } };
  const request = conceptRequest("concept-late-response-cancel");
  const inFlight = context.api.invoke(authorizedActor(), request);
  await fetchStarted.promise;
  const job = context.store.db.prepare(`SELECT job_id FROM creative_jobs
    WHERE tenant_id=? AND project_id=? AND action_id=?`).get(SCOPE.tenant_id, SCOPE.project_id, request.action_id);
  assert.ok(job?.job_id);
  const cancelled = await context.api.invoke(authorizedActor(), cancelRequest(`cancel-${request.action_id}`, job.job_id));
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  releaseResponse.resolve(new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
    usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
      input_tokens_details: { image_tokens: 18, text_tokens: 2 },
      output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
  { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-late-concept-response" } }));
  const result = await inFlight;
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(providerPosts, 1);
  assert.equal(context.counters.settlements, 0);
  assert.equal(context.counters.held, 1);
  const batch = context.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id });
  const slot = batch.batch.slots[0];
  assert.equal(rejectedForeignUsageReference, true);
  assert.equal(rejectedBorrowedTransaction, true);
  assert.equal(slot.status, "unknown");
  assert.equal(slot.attempts.length, 1);
  assert.equal(slot.attempts[0].latest_provider_outcome, "unknown");
  assert.equal(slot.attempts[0].unknown_financial_exposure, true);
  assert.equal(context.counters.usage_observations.length, 1);
  assert.equal(context.counters.usage_observations[0].billable_attempt_id, slot.attempts[0].billable_attempt_id);
  assert.equal(context.counters.usage_observations[0].transport_attempt_id, slot.attempts[0].transport_attempt_id);
  assert.equal(context.store.getConceptResponseStage({ scope: SCOPE, action_id: request.action_id,
    concept_id: slot.concept_id }), null);
  assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 0);
  assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 100 }).items
    .some((version) => version.logical_operation_id === request.action_id), false);
  const privateProviderRows = context.store.db.prepare(`SELECT provider_request_id,billable_attempt_id FROM private_provider_attributions
    WHERE tenant_id=? AND project_id=? AND action_id=?`).all(SCOPE.tenant_id, SCOPE.project_id, request.action_id);
  const usageEvent = context.store.db.prepare(`SELECT event_json FROM creative_concept_events_v1
    WHERE tenant_id=? AND project_id=? AND action_id=? AND event_type='provider_outcome'`)
    .get(SCOPE.tenant_id, SCOPE.project_id, request.action_id);
  const usageEvidenceRef = JSON.parse(usageEvent.event_json).usage_evidence_ref;
  const usageRecord = context.store.db.prepare(`SELECT record_ref,billable_attempt_id,logical_operation_id,payload_json FROM creative_telemetry_observations_v1
    WHERE record_ref=?`).get(usageEvidenceRef);
  assert.ok(usageRecord);
  assert.equal(usageRecord.billable_attempt_id, slot.attempts[0].billable_attempt_id);
  assert.equal(usageRecord.logical_operation_id, slot.logical_operation_id);
  const usagePayload = JSON.parse(usageRecord.payload_json);
  assert.equal(usagePayload.observation.transport_attempt_id, slot.attempts[0].transport_attempt_id);
  assert.equal(usagePayload.attempt.billable_attempt_id, slot.attempts[0].billable_attempt_id);
  assert.equal(privateProviderRows.length, 1);
  assert.equal(privateProviderRows[0].provider_request_id, "req-late-concept-response");
  assert.equal(privateProviderRows[0].billable_attempt_id, slot.attempts[0].billable_attempt_id);
});

test("late native concept response cannot mutate the attempt after a replacement owner recovers it", async (t) => {
  const context = await setup(t);
  const outputBytes = makePng({ width: 16, height: 16 });
  const fetchStarted = deferred();
  const releaseResponse = deferred();
  let providerPosts = 0;
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
      template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
      template_sha256: prompt_template.template_sha256 }; } },
    fetchImpl: async (url, init) => {
      providerPosts += 1;
      assert.equal(String(url), "https://api.openai.com/v1/images/edits");
      assert.equal(init.body.getAll("image[]").length, 2);
      fetchStarted.resolve();
      return releaseResponse.promise;
    } });
  installConceptAuthority(context, provider);
  const request = conceptRequest("concept-late-response-replaced-owner");
  const originalFlight = context.api.invoke(authorizedActor(), request);
  await fetchStarted.promise;
  const originalJob = context.store.db.prepare(`SELECT job_id,lease_hash,request_hash FROM creative_jobs
    WHERE tenant_id=? AND project_id=? AND action_id=?`).get(SCOPE.tenant_id, SCOPE.project_id, request.action_id);
  assert.ok(originalJob?.job_id);
  context.advanceClock(60_001);
  const replacementResult = await context.api.invoke(authorizedActor(), request);
  assert.equal(replacementResult.ok, true, JSON.stringify(replacementResult));
  assert.equal(replacementResult.result?.status, "unknown_hold");
  assert.deepEqual(replacementResult.result?.progress.map(({ status }) => status), ["unknown", "pending"]);
  const replacementJob = context.store.db.prepare(`SELECT lease_hash FROM creative_jobs
    WHERE tenant_id=? AND project_id=? AND job_id=?`).get(SCOPE.tenant_id, SCOPE.project_id, originalJob.job_id);
  assert.notEqual(replacementJob.lease_hash, originalJob.lease_hash);
  const recovered = context.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id });
  const recoveredSlot = recovered.batch.slots[0];
  assert.equal(recoveredSlot.status, "unknown");
  assert.equal(recoveredSlot.attempts.length, 1);
  assert.equal(recoveredSlot.attempts[0].unknown_financial_exposure, true);
  assert.equal(providerPosts, 1, "replacement owner must not resend the uncertain attempt");
  const eventsBeforeLateResponse = context.store.db.prepare(`SELECT sequence,event_json FROM creative_concept_events_v1
    WHERE tenant_id=? AND project_id=? AND action_id=? ORDER BY sequence`)
    .all(SCOPE.tenant_id, SCOPE.project_id, request.action_id);
  releaseResponse.resolve(new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
    usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
      input_tokens_details: { image_tokens: 18, text_tokens: 2 },
      output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
  { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-replaced-concept-owner" } }));
  const originalResult = await originalFlight;
  assert.equal(originalResult.ok, false, JSON.stringify(originalResult));
  assert.equal(context.counters.settlements, 0);
  assert.equal(context.counters.held, 1);
  assert.equal(context.counters.usage_observations.length, 1);
  assert.equal(context.counters.usage_observations[0].billable_attempt_id, recoveredSlot.attempts[0].billable_attempt_id);
  assert.equal(context.counters.usage_observations[0].transport_attempt_id, recoveredSlot.attempts[0].transport_attempt_id);
  const afterLateResponse = context.store.getConceptBatch({ scope: SCOPE, action_id: request.action_id });
  assert.equal(canonicalSerialize(afterLateResponse), canonicalSerialize(recovered));
  assert.deepEqual(context.store.db.prepare(`SELECT sequence,event_json FROM creative_concept_events_v1
    WHERE tenant_id=? AND project_id=? AND action_id=? ORDER BY sequence`)
    .all(SCOPE.tenant_id, SCOPE.project_id, request.action_id), eventsBeforeLateResponse);
  assert.equal(context.store.getConceptResponseStage({ scope: SCOPE, action_id: request.action_id,
    concept_id: recoveredSlot.concept_id }), null);
  assert.equal(context.store.getConceptVersions({ scope: SCOPE, action_id: request.action_id }).length, 0);
  assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 100 }).items
    .some((version) => version.logical_operation_id === request.action_id), false);
});

test("actual Creative API edit serializes parent plus authorized reference; unknown usage holds and raw request ID persists privately", async (t) => {
  const context = await setup(t);
  const plan = await jsonFixture("generate-plan");
  plan.base.brief_hash = canonicalHash(context.brief);
  plan.source_refs = ["page-1"];
  plan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("image-parent-action", "generate", plan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  assert.equal(context.counters.settlements, 1);
  assert.equal(context.counters.seed_dispatches, 1);

  const outputBytes = makePng({ width: 16, height: 16 });
  let postedUrl;
  let observedInputFiles;
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    fetchImpl: async (url, init) => {
      context.counters.provider_posts += 1;
      postedUrl = String(url);
      observedInputFiles = init.body.getAll("image[]");
      assert.equal(init.method, "POST");
      assert.equal(init.redirect, "error");
      assert.equal(init.cache, "no-store");
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
          input_tokens_details: { image_tokens: 18, text_tokens: 2 },
          output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-private-image-edit-01" } });
    } });
  context.ports.provider = provider;

  const editPlan = await jsonFixture("edit-plan");
  editPlan.base.brief_hash = canonicalHash(context.brief);
  editPlan.base.design_hash = seed.result.design_version.design_hash;
  editPlan.base.design_version_id = seed.result.design_version.design_version_id;
  editPlan.source_refs = ["page-2"];
  editPlan.steps[0].source_refs = ["page-2"];
  editPlan.steps[0].parameters.design_version_id = seed.result.design_version.design_version_id;
  editPlan.steps[0].parameters.artifact_id = seed.result.design_version.artifact.artifact_id;
  editPlan.expected_result.parent_version_id = seed.result.design_version.design_version_id;
  const manifest = { contract: "CreativeImageReferenceManifest", schema_version: "1.0",
    tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id, brief_id: SCOPE.brief_id,
    brief_hash: canonicalHash(context.brief), research_package_id: context.research.package_id,
    research_package_hash: canonicalHash(context.research),
    base_design_version_id: seed.result.design_version.design_version_id,
    base_design_hash: seed.result.design_version.design_hash,
    references: [{ source_ref: "page-2", asset_id: "asset-2", content_hash: hash(context.referenceBytes),
      media_type: "image/png", width: 16, height: 16 }] };
  const result = await context.api.invoke(authorizedActor(), apiRequest("image-edit-action", "edit", editPlan, "page-2", {
    design_version_id: seed.result.design_version.design_version_id,
    image_reference_manifest: manifest,
  }));
  assert.equal(result.ok, false, "unmapped GPT Image 2.5 usage must not authorize settlement or publication");
  assert.equal(context.counters.provider_posts, 1, JSON.stringify(result));
  assert.equal(postedUrl, "https://api.openai.com/v1/images/edits");
  assert.equal(observedInputFiles.length, 2, "parent plus exactly one authorized reference is sent as image[]");
  assert.deepEqual(Buffer.from(await observedInputFiles[0].arrayBuffer()), outputBytes,
    "selected immutable parent bytes are first");
  assert.deepEqual(Buffer.from(await observedInputFiles[1].arrayBuffer()), context.referenceBytes,
    "manifest reference bytes follow in manifest order");
  assert.equal(context.counters.held, 1);
  assert.equal(context.counters.settlements, 1, "the initial fixture generation alone settles");
  assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 1,
    "unmapped image usage leaves the exact returned bytes unpublished");

  const attribution = context.store.db.prepare(`SELECT * FROM private_provider_attributions
    WHERE action_id='image-edit-action'`).get();
  assert.ok(attribution);
  assert.equal(attribution.provider_request_id, "req-private-image-edit-01");
  assert.equal(attribution.operation, "edit");
  assert.equal(attribution.reservation_ref.startsWith("reservation:"), true);
  assert.equal(attribution.billable_attempt_id.length > 0, true);
  assert.equal(attribution.dispatch_intent_ref.length > 0, true);
  const rawUsageAttribution = context.store.db.prepare(`SELECT * FROM private_provider_usage_attributions
    WHERE action_id='image-edit-action'`).get();
  assert.ok(rawUsageAttribution, "raw provider counters are retained separately from owner normalization");
  assert.equal(rawUsageAttribution.provider_model, MODEL);
  assert.equal(rawUsageAttribution.target_binding_sha256.startsWith("sha256:"), true);
  const privateUsage = JSON.parse(rawUsageAttribution.usage_json);
  assert.equal(privateUsage.input_tokens, 20);
  assert.equal(privateUsage.output_tokens_details.image_tokens, 9);
  assert.deepEqual(privateUsage.missing_fields, ["usage.profile_mapping_pending"],
    "the private record retains that no accepted profile mapped these native counts");
  assert.doesNotMatch(rawUsageAttribution.usage_json, /req-private-image-edit-01/);
  const publicRows = context.store.db.prepare(`SELECT result_json,error_json FROM creative_jobs WHERE action_id='image-edit-action'`).get();
  assert.doesNotMatch(JSON.stringify(publicRows), /req-private-image-edit-01/);
  const telemetryRows = context.store.db.prepare(`SELECT payload_json FROM creative_telemetry_evidence_outbox_v1`).all();
  assert.doesNotMatch(JSON.stringify(telemetryRows), /req-private-image-edit-01/);

  const databasePath = context.store.databasePath;
  const objectRoot = context.store.objectRoot;
  context.store.close();
  const reopened = new (context.store.constructor)({ databasePath, objectRoot, now: () => NOW });
  t.after(() => reopened.close());
  const persisted = reopened.db.prepare(`SELECT provider_request_id,provider_request_ref,reservation_ref,transport_attempt_id
    FROM private_provider_attributions WHERE action_id='image-edit-action'`).get();
  assert.equal(persisted.provider_request_id, "req-private-image-edit-01", "private attribution survives process/store restart");
  assert.match(persisted.provider_request_ref, /^provider-request-[a-f0-9]{64}$/);
  const persistedUsage = reopened.db.prepare(`SELECT usage_sha256,usage_json FROM private_provider_usage_attributions
    WHERE action_id='image-edit-action'`).get();
  assert.ok(persistedUsage, "bounded usage attribution survives process/store restart");
  assert.equal(canonicalHash(JSON.parse(persistedUsage.usage_json)), persistedUsage.usage_sha256);
});

test("actual API holds and stages native response attribution on a transient usage writer failure", async (t) => {
  const context = await setup(t);
  const outputBytes = makePng({ width: 16, height: 16 });
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    fetchImpl: async () => {
      context.counters.provider_posts += 1;
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
        usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20 } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-private-transient-usage-01" } });
    } });
  context.ports.provider = provider;
  const originalJobs = context.ports.jobs;
  let stageCalls = 0;
  let stageFailure;
  context.ports.jobs = { ...originalJobs, async recordPrivateProviderAttribution(input) {
    return { status: "recorded", transport_attempt_id: "transport-foreign",
      provider_request_ref: input.provider_request_ref };
  }, async recordPrivateProviderUsageAttribution() {
    throw new Error("transient private usage store interruption");
  }, async stagePrivateProviderAttribution(input) {
    stageCalls += 1;
    try { return await originalJobs.stagePrivateProviderAttribution(input); }
    catch (error) { stageFailure = `${error.code ?? "error"}:${error.field ?? ""}`; throw error; }
  } };
  const plan = await jsonFixture("generate-plan");
  plan.base.brief_hash = canonicalHash(context.brief);
  plan.source_refs = [];
  plan.steps[0].source_refs = [];
  const request = apiRequest("image-stage-usage-action", "generate", plan, "page-1");
  request.source_refs = [];
  const result = await context.api.invoke(authorizedActor(), request);
  assert.equal(result.ok, false);
  assert.equal(context.counters.provider_posts, 1);
  assert.equal(context.counters.held, 1);
  assert.equal(context.counters.settlements, 0);
  assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM private_provider_attributions WHERE action_id=?")
    .get("image-stage-usage-action").count, 0, "an unavailable ACK is not accepted as a recorded identity");
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM private_provider_usage_attributions WHERE action_id=?")
    .get("image-stage-usage-action").count, 0);
  const jobRow = context.store.db.prepare("SELECT job_id,status FROM creative_jobs WHERE action_id=?")
    .get("image-stage-usage-action");
  assert.equal(jobRow.status, "failed");
  const staged = context.store.db.prepare("SELECT payload_json,payload_sha256 FROM private_provider_attribution_pending WHERE job_id=?")
    .get(jobRow.job_id);
  assert.ok(staged, `${JSON.stringify(result)}; stageCalls=${stageCalls}; stageFailure=${stageFailure ?? "none"}`);
  assert.equal(stageCalls, 1);
  assert.equal(stageFailure, undefined);
  const stagedPayload = JSON.parse(staged.payload_json);
  assert.equal(stagedPayload.provider_request_id, "req-private-transient-usage-01");
  assert.equal(stagedPayload.usage.input_tokens, 12);
  assert.equal(stagedPayload.usage.output_tokens, 8);
  assert.equal(canonicalHash(stagedPayload), staged.payload_sha256);
  assert.doesNotMatch(JSON.stringify(result), /req-private-transient-usage-01/);

  const reconciled = await context.ports.jobs.reconcilePrivateProviderAttributions({ scope: SCOPE, limit: 10 });
  assert.deepEqual(reconciled, { reconciled: 1, remaining: 0 });
  assert.equal(context.counters.provider_posts, 1, "reconciliation never redispatches the provider request");
  assert.equal(context.store.db.prepare("SELECT provider_request_id FROM private_provider_attributions WHERE action_id=?")
    .get("image-stage-usage-action").provider_request_id, "req-private-transient-usage-01");
  const persistedUsage = context.store.db.prepare(`SELECT usage_json FROM private_provider_usage_attributions WHERE action_id=?`)
    .get("image-stage-usage-action");
  assert.ok(persistedUsage);
  assert.equal(JSON.parse(persistedUsage.usage_json).total_tokens, 20);
  assert.deepEqual(await context.ports.jobs.reconcilePrivateProviderAttributions({ scope: SCOPE, limit: 10 }),
    { reconciled: 0, remaining: 0 });
});

test("wide native usage preserves bounded counters and private request identity before rejecting the response", async (t) => {
  const cases = [
    ["200 root width", 200, "root"],
    ["200 detail width", 200, "details"],
    ["400 root width", 400, "root"],
    ["400 detail width", 400, "details"],
  ];
  for (const [index, [label, status, width]] of cases.entries()) {
    await t.test(label, async (subtest) => {
      const context = await setup(subtest);
      const outputBytes = makePng({ width: 16, height: 16 });
      const rawUsage = { input_tokens: 12, output_tokens: 8, total_tokens: 20,
        input_tokens_details: { image_tokens: 10, text_tokens: 2 },
        output_tokens_details: { image_tokens: 7, text_tokens: 1 } };
      if (width === "root") {
        for (let extra = 0; extra < 33; extra += 1) rawUsage[`extension_${extra}`] = extra;
      } else {
        for (let extra = 0; extra < 33; extra += 1) rawUsage.input_tokens_details[`extension_${extra}`] = extra;
      }
      const requestId = `req-private-wide-usage-${index}`;
      context.ports.provider = createNativeProvider({ store: context.store,
        referenceAssetBytes: context.referenceAssetBytes, fetchImpl: async () => {
          context.counters.provider_posts += 1;
          return new Response(JSON.stringify(status === 200
            ? { data: [{ b64_json: outputBytes.toString("base64") }], usage: rawUsage }
            : { error: { code: "invalid_request" }, usage: rawUsage }),
          { status, headers: { "content-type": "application/json", "x-request-id": requestId } });
        } });
      const plan = await jsonFixture("generate-plan");
      plan.base.brief_hash = canonicalHash(context.brief);
      plan.source_refs = [];
      plan.steps[0].source_refs = [];
      const request = apiRequest(`image-wide-usage-${index}`, "generate", plan, "page-1");
      request.source_refs = [];
      const result = await context.api.invoke(authorizedActor(), request);

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(context.counters.provider_posts, 1);
      assert.equal(context.counters.held, 1);
      assert.equal(context.counters.settlements, 0);
      assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
      assert.equal(context.counters.usage_observations.length, 1);
      assert.notEqual(context.counters.usage_observations[0].completeness, "complete");
      assert.doesNotMatch(JSON.stringify(context.counters.usage_observations[0]), /extension_/,
        "unrecognized provider extensions are never copied into public telemetry");

      const job = context.store.db.prepare("SELECT job_id FROM creative_jobs WHERE action_id=?")
        .get(`image-wide-usage-${index}`);
      const identity = context.store.db.prepare("SELECT provider_request_id FROM private_provider_attributions WHERE job_id=?")
        .get(job.job_id);
      assert.equal(identity?.provider_request_id, requestId, "the bounded provider identity is retained privately");
      const usageRow = context.store.db.prepare("SELECT usage_json FROM private_provider_usage_attributions WHERE job_id=?")
        .get(job.job_id);
      assert.ok(usageRow, "recognized native counters are durably retained despite unsupported width");
      const safeUsage = JSON.parse(usageRow.usage_json);
      assert.equal(safeUsage.completeness, "unknown");
      assert.equal(safeUsage.input_tokens, 12);
      assert.equal(safeUsage.output_tokens, 8);
      assert.equal(safeUsage.total_tokens, 20);
      assert.doesNotMatch(JSON.stringify(safeUsage), /extension_/);
      assert.deepEqual(safeUsage.input_tokens_details, { image_tokens: 10, text_tokens: 2 });
      assert.deepEqual(safeUsage.output_tokens_details, { image_tokens: 7, text_tokens: 1 });
      assert.ok(safeUsage.missing_fields.includes(width === "root"
        ? "usage.too_many_fields" : "usage.input_tokens_details.too_many_fields"),
      JSON.stringify(safeUsage.missing_fields));
      assert.doesNotMatch(JSON.stringify(result), new RegExp(requestId));
      assert.equal(context.counters.provider_posts, 1, "usage rejection never retries or redispatches the response");
    });
  }
});

test("small unknown native usage extensions remain unmapped through the API and C03", async (t) => {
  const cases = [
    ["200 root extension", 200, "root"],
    ["200 input detail extension", 200, "input_tokens_details"],
    ["200 output detail extension", 200, "output_tokens_details"],
    ["400 root extension", 400, "root"],
    ["400 input detail extension", 400, "input_tokens_details"],
    ["400 output detail extension", 400, "output_tokens_details"],
    ["200 no-extension mapped positive control", 200, "none"],
  ];
  for (const [index, [label, status, location]] of cases.entries()) {
    await t.test(label, async (subtest) => {
      const context = await setup(subtest);
      const outputBytes = makePng({ width: 16, height: 16 });
      const rawUsage = { input_tokens: 12, output_tokens: 8, total_tokens: 20,
        input_tokens_details: { image_tokens: 10, text_tokens: 2 },
        output_tokens_details: { image_tokens: 7, text_tokens: 1 } };
      if (location === "root") rawUsage.unreviewed_billable_units = 9;
      if (location === "input_tokens_details") rawUsage.input_tokens_details.unreviewed_billable_units = 9;
      if (location === "output_tokens_details") rawUsage.output_tokens_details.unreviewed_billable_units = 9;
      context.ports.telemetry = { ...context.ports.telemetry,
        usage_profile_authority: mockOwnerUsageProfileAuthority() };
      const requestId = `req-private-unknown-usage-${index}`;
      context.ports.provider = createNativeProvider({ store: context.store,
        referenceAssetBytes: context.referenceAssetBytes, fetchImpl: async () => {
          context.counters.provider_posts += 1;
          const body = status === 200
            ? { data: [{ b64_json: outputBytes.toString("base64") }], usage: rawUsage }
            : { error: { code: "invalid_request" }, usage: rawUsage };
          return new Response(JSON.stringify(body),
            { status, headers: { "content-type": "application/json", "x-request-id": requestId } });
        } });
      const plan = await jsonFixture("generate-plan");
      plan.base.brief_hash = canonicalHash(context.brief);
      plan.source_refs = [];
      plan.steps[0].source_refs = [];
      const request = apiRequest(`image-unknown-usage-${index}`, "generate", plan, "page-1");
      request.source_refs = [];
      const result = await context.api.invoke(authorizedActor(), request);

      const isPositiveControl = location === "none";
      assert.equal(result.ok, isPositiveControl, JSON.stringify(result));
      assert.equal(context.counters.provider_posts, 1, "an unknown usage extension never retries the provider request");
      assert.equal(context.counters.settlements, isPositiveControl ? 1 : 0);
      assert.equal(context.counters.held, isPositiveControl ? 0 : 1);
      assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length,
        isPositiveControl ? 1 : 0, "an unmapped extension cannot publish artwork");
      assert.equal(context.counters.usage_observations.length, 1);
      const observation = context.counters.usage_observations[0];
      assert.equal(observation.completeness === "complete", isPositiveControl);
      if (!isPositiveControl) {
        const marker = location === "root" ? "usage.unmapped_fields" : `usage.${location}.unmapped_fields`;
        assert.ok(observation.missing_fields.includes(marker), JSON.stringify(observation.missing_fields));
      }
      assert.doesNotMatch(JSON.stringify(observation), /unreviewed_billable_units|extension_/,
        "unknown provider field names and values are not copied into public telemetry");

      const job = context.store.db.prepare("SELECT job_id FROM creative_jobs WHERE action_id=?")
        .get(`image-unknown-usage-${index}`);
      const identity = context.store.db.prepare("SELECT provider_request_id FROM private_provider_attributions WHERE job_id=?")
        .get(job.job_id);
      assert.equal(identity?.provider_request_id, requestId, "the private identity record preserves the actual request id");
      const usageRow = context.store.db.prepare("SELECT usage_json FROM private_provider_usage_attributions WHERE job_id=?")
        .get(job.job_id);
      assert.ok(usageRow, "recognized usage counters remain in the restricted usage record");
      const safeUsage = JSON.parse(usageRow.usage_json);
      assert.equal(safeUsage.input_tokens, 12);
      assert.equal(safeUsage.output_tokens, 8);
      assert.equal(safeUsage.total_tokens, 20);
      assert.doesNotMatch(JSON.stringify(safeUsage), /unreviewed_billable_units|extension_/);
      if (isPositiveControl) {
        assert.deepEqual(safeUsage.missing_fields, ["usage.profile_mapping_pending"]);
      } else {
        const marker = location === "root" ? "usage.unmapped_fields" : `usage.${location}.unmapped_fields`;
        assert.ok(safeUsage.missing_fields.includes(marker), JSON.stringify(safeUsage.missing_fields));
        assert.ok(safeUsage.missing_fields.includes("usage.profile_mapping_pending"));
      }
      assert.doesNotMatch(JSON.stringify(result), new RegExp(requestId));
    });
  }
});

test("wide native usage survives a transient writer failure, store reopen, and one reconciliation without redispatch", async (t) => {
  const context = await setup(t);
  const outputBytes = makePng({ width: 16, height: 16 });
  const rawUsage = { input_tokens: 12, output_tokens: 8, total_tokens: 20,
    input_tokens_details: { image_tokens: 10, text_tokens: 2 },
    output_tokens_details: { image_tokens: 7, text_tokens: 1 } };
  for (let extra = 0; extra < 33; extra += 1) rawUsage.input_tokens_details[`extension_${extra}`] = extra;
  const requestId = "req-private-wide-transient-usage";
  context.ports.provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    fetchImpl: async () => {
      context.counters.provider_posts += 1;
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }], usage: rawUsage }),
        { status: 200, headers: { "content-type": "application/json", "x-request-id": requestId } });
    } });
  const originalJobs = context.ports.jobs;
  context.ports.jobs = { ...originalJobs,
    async recordPrivateProviderAttribution(input) {
      return { status: "unavailable", transport_attempt_id: input.transport_attempt_id,
        provider_request_ref: input.provider_request_ref };
    },
    async recordPrivateProviderUsageAttribution() { throw new Error("transient usage storage outage"); },
    async stagePrivateProviderAttribution(input) { return originalJobs.stagePrivateProviderAttribution(input); },
  };
  const plan = await jsonFixture("generate-plan");
  plan.base.brief_hash = canonicalHash(context.brief);
  plan.source_refs = [];
  plan.steps[0].source_refs = [];
  const request = apiRequest("image-wide-transient-action", "generate", plan, "page-1");
  request.source_refs = [];
  const result = await context.api.invoke(authorizedActor(), request);

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(context.counters.provider_posts, 1);
  assert.equal(context.counters.held, 1);
  assert.equal(context.counters.settlements, 0);
  assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
  const job = context.store.db.prepare("SELECT job_id FROM creative_jobs WHERE action_id=?")
    .get("image-wide-transient-action");
  const pending = context.store.db.prepare("SELECT pending_ref,payload_json,payload_sha256 FROM private_provider_attribution_pending WHERE job_id=?")
    .get(job.job_id);
  assert.ok(pending, "the real store staged the unavailable private writes");
  assert.equal(canonicalHash(JSON.parse(pending.payload_json)), pending.payload_sha256);
  const staged = JSON.parse(pending.payload_json);
  assert.equal(staged.provider_request_id, requestId);
  assert.equal(staged.usage.input_tokens, 12);
  assert.equal(staged.usage.output_tokens, 8);
  assert.equal(staged.usage.total_tokens, 20);
  assert.equal(staged.usage.completeness, "unknown");
  assert.ok(staged.usage.missing_fields.includes("usage.input_tokens_details.too_many_fields"));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(requestId));

  const databasePath = context.store.databasePath;
  const objectRoot = context.store.objectRoot;
  context.store.close();
  const reopened = new CreativeVersionStore({ databasePath, objectRoot, now: () => NOW });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.reconcilePrivateProviderAttributions({ scope: SCOPE, limit: 10 }),
    { reconciled: 1, remaining: 0 });
  const privateIdentity = reopened.db.prepare("SELECT provider_request_id,transport_attempt_id FROM private_provider_attributions WHERE job_id=?")
    .get(job.job_id);
  assert.equal(privateIdentity.provider_request_id, requestId);
  const privateUsage = reopened.db.prepare("SELECT usage_json FROM private_provider_usage_attributions WHERE job_id=?")
    .get(job.job_id);
  assert.ok(privateUsage);
  assert.equal(JSON.parse(privateUsage.usage_json).input_tokens_details.image_tokens, 10);
  assert.deepEqual(reopened.reconcilePrivateProviderAttributions({ scope: SCOPE, limit: 10 }),
    { reconciled: 0, remaining: 0 }, "reopen reconciliation is idempotent");
  assert.equal(context.counters.provider_posts, 1, "reconciliation does not call the provider again");
  assert.equal(reopened.db.prepare("SELECT COUNT(*) AS count FROM design_versions WHERE tenant_id=? AND project_id=? AND brief_id=?")
    .get(SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id).count, 0, "failed unknown usage never publishes artwork");
});

test("runtime rejects a staged attribution ACK unless ref and hash bind the exact pending payload", async (t) => {
  const context = await setup(t);
  const outputBytes = makePng({ width: 16, height: 16 });
  const requestId = "req-private-stale-pending-ack";
  context.ports.provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    fetchImpl: async () => {
      context.counters.provider_posts += 1;
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
        usage: { input_tokens: 2, output_tokens: 3, total_tokens: 5 } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": requestId } });
    } });
  const originalJobs = context.ports.jobs;
  context.ports.jobs = { ...originalJobs,
    async recordPrivateProviderAttribution(input) {
      return { status: "unavailable", transport_attempt_id: input.transport_attempt_id,
        provider_request_ref: input.provider_request_ref };
    },
    async recordPrivateProviderUsageAttribution() { throw new Error("transient usage storage outage"); },
    async stagePrivateProviderAttribution(input) {
      return { status: "staged", transport_attempt_id: input.transport_attempt_id,
        pending_ref: `private-attribution:${"f".repeat(64)}`, payload_sha256: `sha256:${"e".repeat(64)}` };
    },
  };
  const plan = await jsonFixture("generate-plan");
  plan.base.brief_hash = canonicalHash(context.brief);
  plan.source_refs = [];
  plan.steps[0].source_refs = [];
  const request = apiRequest("image-stale-pending-ack-action", "generate", plan, "page-1");
  request.source_refs = [];
  const result = await context.api.invoke(authorizedActor(), request);

  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(context.counters.provider_posts, 1);
  assert.equal(context.counters.held, 1);
  assert.equal(context.counters.settlements, 0);
  assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
  const job = context.store.db.prepare("SELECT job_id FROM creative_jobs WHERE action_id=?")
    .get("image-stale-pending-ack-action");
  for (const table of ["private_provider_attributions", "private_provider_usage_attributions",
    "private_provider_attribution_pending"]) {
    assert.equal(context.store.db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE job_id=?`).get(job.job_id).count, 0,
      `${table} did not persist a row for the stale ACK`);
  }
  assert.equal(context.counters.usage_observations.length, 1);
  assert.ok(context.counters.usage_observations[0].missing_fields.includes("private_attribution_unavailable"));
  assert.ok(!context.counters.usage_observations[0].missing_fields.includes("private_attribution_pending_reconciliation"));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(requestId));
});

test("actual API refreshes current job and asset authority after native post-ack awaits and before POST", async (t) => {
  for (const kind of ["cancelled", "asset_revoked", "lease_expired"]) await t.test(kind, async (subtest) => {
    const context = await setup(subtest);
    const authority = authorityPorts();
    const actionId = `image-${kind}-during-native-revalidate`;
    let cancelResult;
    const outputBytes = makePng({ width: 16, height: 16 });
    const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
      authorityOverrides: { capabilityPort: {
        verify: authority.capabilityPort.verify,
        async revalidate(input) {
          const result = await authority.capabilityPort.revalidate(input);
          if (input.phase === "post_transport_ack") {
            const job = context.store.db.prepare("SELECT job_id FROM creative_jobs WHERE action_id=?").get(actionId);
            assert.ok(job);
            if (kind === "cancelled") {
              cancelResult = await context.api.invoke(authorizedActor(),
                cancelRequest(`cancel-after-native-capability-${kind}`, job.job_id));
            } else if (kind === "asset_revoked") {
              context.revokeAssetPermission();
            } else {
              context.store.db.prepare("UPDATE creative_jobs SET lease_expires_at=? WHERE job_id=?")
                .run(new Date(NOW - 1).toISOString(), job.job_id);
            }
          }
          return result;
        },
      } },
      fetchImpl: async () => {
        context.counters.provider_posts += 1;
        return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }),
        { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-never-posted" } });
      } });
    context.ports.provider = provider;
    const plan = await jsonFixture("generate-plan");
    plan.base.brief_hash = canonicalHash(context.brief);
    // Bind an actual research asset permission so the post-ack revocation
    // case exercises the same verifier used by production dispatch.
    plan.source_refs = ["page-1"];
    plan.steps[0].source_refs = ["page-1"];
    const request = apiRequest(actionId, "generate", plan, "page-1");
    const result = await context.api.invoke(authorizedActor(), request);
    assert.equal(result.ok, false, JSON.stringify(result));
    if (kind === "cancelled") {
      assert.equal(cancelResult.ok, true);
      assert.equal(context.store.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?").get(actionId).status, "cancelled");
    } else if (kind === "asset_revoked") {
      assert.equal(context.store.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?").get(actionId).status, "failed");
    } else {
      assert.equal(result.error.code, "cancelled");
      assert.equal(context.store.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?").get(actionId).status, "failed");
    }
    assert.equal(context.counters.provider_posts, 0, `${kind} during post-ack capability I/O prevents POST`);
    assert.equal(context.counters.settlements, 0);
    assert.equal(context.counters.held, 1);
    assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
  });
});

test("actual native direct generation has no image inputs and refuses an unsafe reference-manifest extension before reservation", async (t) => {
  const context = await setup(t);
  const outputBytes = makePng({ width: 16, height: 16 });
  let generationBody;
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    fetchImpl: async (url, init) => {
      context.counters.provider_posts += 1;
      assert.equal(String(url), "https://api.openai.com/v1/images/generations");
      generationBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
        usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-private-image-generate-01" } });
    } });
  context.ports.provider = provider;
  const plan = await jsonFixture("generate-plan");
  plan.base.brief_hash = canonicalHash(context.brief);
  plan.source_refs = [];
  plan.steps[0].source_refs = [];
  const request = apiRequest("image-generate-action", "generate", plan, "page-1");
  request.source_refs = [];
  const result = await context.api.invoke(authorizedActor(), request);
  assert.equal(context.counters.provider_posts, 1);
  assert.equal(generationBody.model, MODEL);
  assert.equal(generationBody.n, 1);
  assert.equal(Object.hasOwn(generationBody, "image"), false);
  assert.equal(Object.hasOwn(generationBody, "images"), false);
  assert.equal(result.ok, false, "the candidate has no reviewed GPT Image 2.5 usage mapping, so C03 retains the hold");
  assert.equal(context.counters.held, 1);
  assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);

  const unsafe = structuredClone(request);
  unsafe.action_id = "generation-with-edit-reference";
  unsafe.payload.image_reference_manifest = { contract: "CreativeImageReferenceManifest" };
  const beforeReservations = context.counters.reserves;
  const blocked = await context.api.invoke(authorizedActor(), unsafe);
  assert.equal(blocked.ok, false);
  assert.equal(context.counters.provider_posts, 1, "generation never sends edit-only image[] references");
  assert.equal(context.counters.reserves, beforeReservations, "unsupported generation inputs reject before C03 reservation");
});

test("only an injected exact attempt and target bound MOCK usage map can settle and publish native image bytes", async (t) => {
  const context = await setup(t);
  const outputBytes = makePng({ width: 16, height: 16 });
  context.ports.telemetry = {
    ...context.ports.telemetry,
    usage_profile_authority: mockOwnerUsageProfileAuthority(),
  };
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    fetchImpl: async (url, init) => {
      context.counters.provider_posts += 1;
      assert.equal(String(url), "https://api.openai.com/v1/images/generations");
      assert.equal(init.method, "POST");
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
        usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20,
          input_tokens_details: { image_tokens: 10, text_tokens: 2 },
          output_tokens_details: { image_tokens: 7, text_tokens: 1 } } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-private-image-mock-profile" } });
    } });
  context.ports.provider = provider;
  const plan = await jsonFixture("generate-plan");
  plan.base.brief_hash = canonicalHash(context.brief);
  plan.source_refs = ["page-1"];
  plan.steps[0].source_refs = ["page-1"];
  const result = await context.api.invoke(authorizedActor(), apiRequest("image-mapped-action", "generate", plan, "page-1"));
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(context.counters.provider_posts, 1);
  assert.equal(context.counters.settlements, 1);
  assert.equal(context.counters.held, 0);
  assert.equal(result.result.design_version.artifact.content_hash, hash(outputBytes));
  const versions = context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items;
  assert.equal(versions.length, 1);
  assert.deepEqual(Buffer.from(await context.store.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: result.result.design_version.design_version_id })), outputBytes,
  "published immutable version retains the exact decoded native bytes");
  const observationRows = context.store.db.prepare(`SELECT payload_json FROM creative_telemetry_observations_v1
    WHERE logical_operation_id='image-mapped-action'`).all();
  assert.equal(observationRows.length, 1);
  const observation = JSON.parse(observationRows[0].payload_json).observation;
  assert.equal(observation.completeness, "complete");
  assert.equal(observation.usage_units.find((unit) => unit.name === "total_tokens").quantity, "20");
  assert.equal(observation.usage_units.find((unit) => unit.name === "input_tokens_details.image_tokens").included_in, "input_tokens");
  assert.equal(observation.usage_units.find((unit) => unit.name === "output_tokens_details.image_tokens").included_in, "output_tokens");
  assert.doesNotMatch(JSON.stringify(result), /req-private-image-mock-profile/);
  const rawUsageRow = context.store.db.prepare(`SELECT usage_json FROM private_provider_usage_attributions
    WHERE action_id='image-mapped-action'`).get();
  assert.ok(rawUsageRow, "the mapped MOCK observation did not replace private raw provider attribution");
  assert.deepEqual(JSON.parse(rawUsageRow.usage_json).missing_fields, ["usage.profile_mapping_pending"]);
  assert.doesNotMatch(rawUsageRow.usage_json, /req-private-image-mock-profile/);
  const databasePath = context.store.databasePath;
  const objectRoot = context.store.objectRoot;
  context.store.close();
  const reopened = new (context.store.constructor)({ databasePath, objectRoot, now: () => NOW });
  t.after(() => reopened.close());
  const reopenedBytes = await reopened.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: result.result.design_version.design_version_id });
  assert.deepEqual(Buffer.from(reopenedBytes), outputBytes,
    "the exact successful native bytes and immutable design version survive store reopen");
  const reopenedUsage = reopened.db.prepare(`SELECT usage_sha256,usage_json FROM private_provider_usage_attributions
    WHERE action_id='image-mapped-action'`).get();
  assert.ok(reopenedUsage);
  assert.equal(canonicalHash(JSON.parse(reopenedUsage.usage_json)), reopenedUsage.usage_sha256);
});

test("settled native edit mapping metadata matches persisted result and exact completed replay", async (t) => {
  const context = await setup(t);
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("image-mapped-edit-parent", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  assert.equal(context.counters.settlements, 1);

  const outputBytes = makePng({ width: 16, height: 16 });
  context.ports.telemetry = { ...context.ports.telemetry,
    usage_profile_authority: mockOwnerUsageProfileAuthority() };
  let postedFiles;
  context.ports.provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    fetchImpl: async (url, init) => {
      context.counters.provider_posts += 1;
      assert.equal(String(url), "https://api.openai.com/v1/images/edits");
      postedFiles = init.body.getAll("image[]");
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
          input_tokens_details: { image_tokens: 18, text_tokens: 2 },
          output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-private-mapped-edit-replay" } });
    } });
  const editPlan = await jsonFixture("edit-plan");
  editPlan.base.brief_hash = canonicalHash(context.brief);
  editPlan.base.design_hash = seed.result.design_version.design_hash;
  editPlan.base.design_version_id = seed.result.design_version.design_version_id;
  editPlan.source_refs = ["page-2"];
  editPlan.steps[0].source_refs = ["page-2"];
  editPlan.steps[0].parameters.design_version_id = seed.result.design_version.design_version_id;
  editPlan.steps[0].parameters.artifact_id = seed.result.design_version.artifact.artifact_id;
  editPlan.expected_result.parent_version_id = seed.result.design_version.design_version_id;
  const manifest = { contract: "CreativeImageReferenceManifest", schema_version: "1.0",
    tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id, brief_id: SCOPE.brief_id,
    brief_hash: canonicalHash(context.brief), research_package_id: context.research.package_id,
    research_package_hash: canonicalHash(context.research),
    base_design_version_id: seed.result.design_version.design_version_id,
    base_design_hash: seed.result.design_version.design_hash,
    references: [{ source_ref: "page-2", asset_id: "asset-2", content_hash: hash(context.referenceBytes),
      media_type: "image/png", width: 16, height: 16 }] };
  const request = apiRequest("image-mapped-edit-replay", "edit", editPlan, "page-2", {
    design_version_id: seed.result.design_version.design_version_id, image_reference_manifest: manifest,
  });
  const result = await context.api.invoke(authorizedActor(), request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(context.counters.provider_posts, 1);
  assert.equal(context.counters.settlements, 2);
  assert.equal(result.result.usage.completeness, "complete");
  assert.equal(result.result.design_version.usage_status, "complete");
  assert.equal(postedFiles.length, 2);
  assert.deepEqual(Buffer.from(await postedFiles[0].arrayBuffer()), context.counters.seed_bytes ??
    Buffer.from(await context.store.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
      design_version_id: seed.result.design_version.design_version_id })));
  assert.deepEqual(Buffer.from(await postedFiles[1].arrayBuffer()), context.referenceBytes);
  assert.doesNotMatch(JSON.stringify(result), /req-private-mapped-edit-replay|mock-owner-profile/);

  const storedJob = context.store.db.prepare("SELECT result_json FROM creative_jobs WHERE action_id=?")
    .get("image-mapped-edit-replay");
  const storedResult = JSON.parse(storedJob.result_json);
  assert.equal(storedResult.usage.completeness, "complete");
  assert.equal(storedResult.design.usage_status, "complete");
  assert.equal(storedResult.usage_evidence.status, "settled_owner_mapping");
  assert.equal(storedResult.usage_evidence.billable_attempt_id, storedResult.design.billable_attempt_id);
  assert.equal(storedResult.usage_evidence.provider_name, "openai");
  assert.equal(storedResult.usage_evidence.model, MODEL);
  assert.match(storedResult.usage_evidence.observation_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(storedResult.usage_evidence.source_observation_id,
    context.counters.usage_observations.at(-1).source_observation_id);
  assert.equal(storedResult.usage_evidence.observation_sha256,
    canonicalHash(context.counters.usage_observations.at(-1)),
  "stored settled evidence hashes the exact C03 observation, not the raw candidate counters");
  const privateUsage = JSON.parse(context.store.db.prepare(`SELECT usage_json FROM private_provider_usage_attributions
    WHERE action_id='image-mapped-edit-replay'`).get().usage_json);
  assert.equal(storedResult.usage_evidence.raw_usage_sha256, canonicalHash(privateUsage));
  assert.deepEqual(privateUsage.missing_fields, ["usage.profile_mapping_pending"],
    "the raw provider record remains unknown even though the separate MOCK mapping was settled");

  const beforeReplay = { posts: context.counters.provider_posts, reserves: context.counters.reserves,
    settlements: context.counters.settlements };
  const replay = await context.api.invoke(authorizedActor(), request);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.design_version.design_version_id, result.result.design_version.design_version_id);
  assert.deepEqual({ posts: context.counters.provider_posts, reserves: context.counters.reserves,
    settlements: context.counters.settlements }, beforeReplay,
  "historical owner-mapped result replay performs no extra POST, reservation, or settlement");
});

test("malformed or misbound usage-profile results retain the hold and never publish native bytes", async (t) => {
  const cases = [
    ["wrong raw usage hash", (result) => ({ ...result, raw_usage_sha256: hash("other raw usage") })],
    ["wrong target binding", (result) => ({ ...result, target_binding_sha256: hash("other target") })],
    ["wrong attempt binding", (result) => ({ ...result, attempt_binding_sha256: hash("other attempt") })],
    ["wrong provider identity", (result) => ({ ...result, observation: { ...result.observation, provider_name: "other-provider" } })],
    ["wrong transport identity", (result) => ({ ...result, observation: {
      ...result.observation, transport_attempt_id: "transport-for-another-attempt",
    } })],
    ["malformed usage quantity", (result) => ({ ...result, observation: { ...result.observation,
      usage_units: result.observation.usage_units.map((unit, index) => index === 0 ? { ...unit, quantity: "-1" } : unit),
    } })],
    ["incomplete mapping", (result) => ({ ...result, observation: { ...result.observation,
      completeness: "partial", missing_fields: ["usage.unmapped_provider_dimension"],
    } })],
    ["throwing mapper", (_result) => { throw new Error("Bearer private mapper failure marker"); }],
    ["throwing result getter", (result) => Object.defineProperty(result, "observation", {
      enumerable: true, get() { throw new Error("Bearer private mapper getter marker"); },
    })],
    ["malformed profile hash", (result) => ({ ...result, profile_sha256: "not-a-pinned-hash" })],
  ];

  for (const [caseIndex, [label, transformResult]] of cases.entries()) {
    await t.test(label, async (subtest) => {
      const context = await setup(subtest);
      const outputBytes = makePng({ width: 16, height: 16 });
      context.ports.telemetry = { ...context.ports.telemetry,
        usage_profile_authority: mockOwnerUsageProfileAuthority({ transformResult }) };
      context.ports.provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
        fetchImpl: async () => {
          context.counters.provider_posts += 1;
          return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
            usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20,
              input_tokens_details: { image_tokens: 10, text_tokens: 2 },
              output_tokens_details: { image_tokens: 7, text_tokens: 1 } } }),
          { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-private-mapper-probe" } });
        } });
      const plan = await jsonFixture("generate-plan");
      plan.base.brief_hash = canonicalHash(context.brief);
      plan.source_refs = ["page-1"];
      plan.steps[0].source_refs = ["page-1"];
      const result = await context.api.invoke(authorizedActor(), apiRequest(`mapper-${caseIndex}`, "generate", plan, "page-1"));

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(context.counters.provider_posts, 1);
      assert.equal(context.counters.settlements, 0, "an unverified or incomplete mapping cannot settle the reservation");
      assert.equal(context.counters.held, 1);
      assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0,
        "provider bytes remain unpublished when the mapping cannot be bound and validated");
      assert.doesNotMatch(JSON.stringify(result), /req-private-mapper-probe|input_tokens|total_tokens|Bearer private mapper/);
      const privateUsage = context.store.db.prepare(`SELECT usage_json FROM private_provider_usage_attributions
        WHERE action_id LIKE 'mapper-%'`).get();
      assert.ok(privateUsage, "observed native counters remain available in the restricted attribution table");
      assert.deepEqual(JSON.parse(privateUsage.usage_json).missing_fields, ["usage.profile_mapping_pending"]);
      assert.doesNotMatch(privateUsage.usage_json, /req-private-mapper-probe/);
    });
  }
});

test("cancellation, expired deadline, or revoked asset permission during async usage mapping retains the C03 hold", async (t) => {
  const cases = ["cancelled", "deadline_elapsed", "asset_permission_revoked"];
  for (const [index, kind] of cases.entries()) {
    await t.test(kind, async (subtest) => {
      const context = await setup(subtest);
      const outputBytes = makePng({ width: 16, height: 16 });
      const actionId = `image-map-late-${index}`;
      let entered;
      const mapEntered = new Promise((resolve) => { entered = resolve; });
      let release;
      const waitForRelease = new Promise((resolve) => { release = resolve; });
      context.ports.telemetry = { ...context.ports.telemetry,
        usage_profile_authority: mockOwnerUsageProfileAuthority({ beforeMap: async () => {
          entered();
          await waitForRelease;
        } }) };
      context.ports.provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
        fetchImpl: async () => {
          context.counters.provider_posts += 1;
          return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
            usage: { input_tokens: 12, output_tokens: 8, total_tokens: 20,
              input_tokens_details: { image_tokens: 10, text_tokens: 2 },
              output_tokens_details: { image_tokens: 7, text_tokens: 1 } } }),
          { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-private-late-map" } });
        } });
      const plan = await jsonFixture("generate-plan");
      plan.base.brief_hash = canonicalHash(context.brief);
      plan.source_refs = ["page-1"];
      plan.steps[0].source_refs = ["page-1"];
      const generation = context.api.invoke(authorizedActor(), apiRequest(actionId, "generate", plan, "page-1"));
      await mapEntered;
      const job = context.store.db.prepare("SELECT job_id FROM creative_jobs WHERE action_id=?").get(actionId);
      assert.ok(job?.job_id, "job is active while the trusted mapper is paused");
      if (kind === "cancelled") {
        const cancelled = await context.api.invoke(authorizedActor(), cancelRequest(`cancel-${actionId}`, job.job_id));
        assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
        assert.equal(cancelled.job.status, "cancelled");
      } else if (kind === "deadline_elapsed") {
        context.advanceClock(30_001);
      } else {
        context.revokeAssetPermission();
      }
      release();
      const result = await generation;
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(context.counters.provider_posts, 1);
      assert.equal(context.counters.settlements, 0, "late mapping cannot settle after its authorization fence closes");
      assert.equal(context.counters.held, 1);
      assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
      assert.doesNotMatch(JSON.stringify(result), /req-private-late-map|input_tokens|total_tokens/);
      assert.equal(context.counters.usage_observations.length, 1,
        "C03 receives the observed usage even though the dispatch fence no longer permits settlement");
      const lateObservation = context.counters.usage_observations[0];
      assert.equal(lateObservation.completeness, "partial");
      assert.ok(lateObservation.missing_fields.includes("usage.dispatch_authorization_not_current"));
      assert.ok(lateObservation.usage_units.some((unit) => unit.name === "total_tokens" && unit.quantity === "20"),
        "known token counts remain available for reconciliation without authorizing settlement");
      const rawUsage = context.store.db.prepare("SELECT usage_json FROM private_provider_usage_attributions WHERE action_id=?").get(actionId);
      assert.ok(rawUsage, "known native counters stay in the restricted attribution record for reconciliation");
      assert.deepEqual(JSON.parse(rawUsage.usage_json).missing_fields, ["usage.profile_mapping_pending"]);
    });
  }
});
