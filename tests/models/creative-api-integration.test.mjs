import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canonicalHash, canonicalSerialize } from "../../src/contracts/index.mjs";
import { createCompositionEditPlan, hashCompositionLayerManifest } from "../../src/contracts/approval-handoff.mjs";
import { compositionStateHash, createCompositionProductionEnvelope, createCompositionRevision } from "../../src/contracts/composition-authority.mjs";
import { CreativeVersionStore, VersionStoreError } from "../../src/versions/store.mjs";
import { makePng } from "../../fixtures/models/png.mjs";
import { createVersion } from "../versions/helpers.mjs";

import {
  NOW, MODEL, SCOPE, hash, jsonFixture, authorizedActor, apiRequest, authorityPorts,
  createNativeProvider, mockOwnerUsageProfileAuthority, createCreativeApiFixture,
} from "../../fixtures/models/creative-api-fixture.mjs";

async function setup(t, options) {
  const context = await createCreativeApiFixture(options);
  t.after(context.close);
  return context;
}

for (const operation of ["generate", "edit"]) test(`actual API and C03 admit the prepared native ${operation} target and exact transport identity`, async (t) => {
  const context = await setup(t);
  let plan = await jsonFixture("generate-plan");
  plan.base.brief_hash = canonicalHash(context.brief);
  plan.source_refs = ["page-1"]; plan.steps[0].source_refs = ["page-1"];
  if (operation === "edit") {
    const seed = await context.api.invoke(authorizedActor(), apiRequest("prepared-edit-seed", "generate", plan, "page-1"));
    assert.equal(seed.ok, true, JSON.stringify(seed));
    plan = await jsonFixture("edit-plan");
    plan.base.brief_hash = canonicalHash(context.brief);
    plan.base.design_hash = seed.result.design_version.design_hash;
    plan.base.design_version_id = seed.result.design_version.design_version_id;
    plan.source_refs = ["page-2"]; plan.steps[0].source_refs = ["page-2"];
    plan.steps[0].parameters.design_version_id = seed.result.design_version.design_version_id;
    plan.steps[0].parameters.artifact_id = seed.result.design_version.artifact.artifact_id;
    plan.expected_result.parent_version_id = seed.result.design_version.design_version_id;
  }
  let admitted;
  let dispatched;
  let renders = 0;
  const originalReserve = context.ports.metering.reserveAttempt;
  context.ports.metering.reserveAttempt = async (attempt, target) => {
    assert.equal(renders, 1, "real prompt preparation precedes admission");
    assert.equal(target.target_binding.billable_attempt_id, attempt.billable_attempt_id);
    assert.equal(target.target_binding.deadline_at, target.deadline_at);
    assert.match(target.target_binding_sha256, /^sha256:[a-f0-9]{64}$/);
    assert.equal(Object.isFrozen(target.target_binding), true);
    admitted = target;
    return originalReserve(attempt);
  };
  const native = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    promptPort: { render() { renders++; return "Prepared actual API fixture prompt"; } },
    fetchImpl: async (_url, init) => {
      context.counters.provider_posts++;
      const prompt = operation === "generate" ? JSON.parse(init.body).prompt : init.body.get("prompt");
      assert.equal(hash(Buffer.from(prompt)), admitted.target_binding.prompt_sha256);
      return Response.json({ data: [{ b64_json: makePng().toString("base64") }], usage: {
        input_tokens: 20, output_tokens: 10, total_tokens: 30,
        input_tokens_details: { image_tokens: 18, text_tokens: 2 }, output_tokens_details: { image_tokens: 9, text_tokens: 1 },
      } });
    } });
  context.ports.provider = { ...native, async [operation](input) {
    dispatched = input;
    assert.equal(input.transport_attempt_id, admitted.transport_attempt_id);
    assert.equal(input.prepared_attempt.target_binding_sha256, admitted.target_binding_sha256);
    assert.equal(input.reservation_ref, `reservation:${input.attempt.billable_attempt_id}`);
    return native[operation](input);
  } };
  context.ports.telemetry.usage_profile_authority = mockOwnerUsageProfileAuthority();
  const body = apiRequest(`prepared-native-${operation}`, operation, plan, operation === "generate" ? "page-1" : "page-2",
    operation === "edit" ? { design_version_id: plan.base.design_version_id } : {});
  const result = await context.api.invoke(authorizedActor(), body);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(context.counters.provider_posts, 1);
  assert.equal(renders, 1, "dispatch consumes prepared prompt without rendering again");
  assert.equal(context.counters.usage_observations.at(-1).transport_attempt_id, dispatched.transport_attempt_id);
  const replay = await context.api.invoke(authorizedActor(), body);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(context.counters.provider_posts, 1);
  assert.equal(renders, 1);
});

test("actual API cancellation while native preparation awaits cannot reserve or dispatch", async (t) => {
  const context = await setup(t);
  const plan = await jsonFixture("generate-plan");
  plan.base.brief_hash = canonicalHash(context.brief); plan.source_refs = ["page-1"]; plan.steps[0].source_refs = ["page-1"];
  const entered = deferred(); const release = deferred();
  let preparingJobId;
  const native = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    promptPort: { async render() { entered.resolve(); await release.promise; return "Cancelled preparation prompt"; } },
    fetchImpl: () => { assert.fail("cancelled preparation reached transport"); } });
  context.ports.provider = { ...native, prepareAttempt(input) {
    preparingJobId = input.job_id;
    return native.prepareAttempt(input);
  } };
  const body = apiRequest("cancel-preparation-action", "generate", plan, "page-1");
  const flight = context.api.invoke(authorizedActor(), body);
  await entered.promise;
  const cancelled = await context.ports.jobs.cancel({ scope: SCOPE, actor_id: authorizedActor().actor_id, job_id: preparingJobId,
    target_action_id: body.action_id, action_id: "cancel-preparation-command", request_hash: canonicalHash({ cancel: true }) });
  release.resolve();
  const result = await flight;
  assert.equal(cancelled.kind, "cancelled");
  assert.equal(result.ok, false);
  assert.equal(context.counters.reserves, 0);
  assert.equal(context.counters.provider_posts, 0);
});
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

function compositionRequest(actionId, operation, payload) {
  const occurred = "2026-10-10T12:20:00.000Z";
  return { contract: "CreativeApiRequest", schema_version: "1.2", event_id: `event-${actionId}`,
    request_id: `request-${actionId}`, tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    correlation_id: `correlation-${actionId}`, producer: "creative-composition-api-integration",
    occurred_at: occurred, ingested_at: occurred, environment: "test", billing_mode: "simulated",
    source_refs: [], operation, ...(actionId ? { action_id: actionId } : {}), payload: { brief_id: SCOPE.brief_id,
      design_version_id: "design-image-parent-1", ...payload } };
}

function compositionV13Request(actionId, operation, payload) {
  const occurred = "2026-10-10T12:20:00.000Z";
  return { contract: "CreativeApiRequest", schema_version: "1.3", event_id: `event-${actionId}`,
    request_id: `request-${actionId}`, tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    correlation_id: `correlation-${actionId}`, producer: "creative-composition-api-integration",
    occurred_at: occurred, ingested_at: occurred, environment: "test", billing_mode: "simulated",
    source_refs: [], operation, ...(actionId ? { action_id: actionId } : {}), payload: { brief_id: SCOPE.brief_id,
      design_version_id: "design-image-parent-1", ...payload } };
}

function initialComposition(context, design, selection, previewBytes,
  { includeLogo = false, previewWidthPx = 16, previewHeightPx = 16, previewMimeType = "image/png",
    lockedLayerIds = [], factualTextLayers = [], titleValue = "Example Festival" } = {}) {
  const scope = { ...SCOPE, brief_id: SCOPE.brief_id };
  const briefHash = canonicalHash(context.brief);
  const factsHash = canonicalHash(context.brief.facts);
  const packageHash = canonicalHash(context.research);
  const compositionId = "composition:api-initial";
  const revisionId = "composition-revision:api-initial";
  const artifact = { artifact_id: design.artifact.artifact_id, locator_ref: "object:fixture:artwork",
    sha256: design.artifact.content_hash.slice(7), mime_type: "image/png", width_px: 16, height_px: 16,
    access_policy_ref: "access:fixture:artwork" };
  const binding = { tenant_id: scope.tenant_id, project_id: scope.project_id,
    design_version: { design_version_id: design.design_version_id, artwork_sha256: design.artifact.content_hash.slice(7) },
    brief: { brief_id: scope.brief_id, sha256: briefHash.slice(7) },
    facts: { revision_id: context.research.event_id, sha256: factsHash.slice(7) }, assets: [],
    composition: { composition_id: compositionId, revision_id: revisionId, sha256: "0".repeat(64) },
    preview_sha256: hash(previewBytes).slice(7) };
  const layer_manifest = [
    { layer_id: "layer:artwork", kind: "artwork", artifact_id: artifact.artifact_id, sha256: artifact.sha256 },
    { layer_id: "layer:title", kind: "text", role: "title", value: titleValue },
  ];
  let assetRights = [];
  if (includeLogo) {
    const asset = context.research.assets.items.find((item) => item.asset_id === "asset-2");
    const permission_ref = "permission:asset-2:logo/1";
    const boundAsset = { asset_id: asset.asset_id, sha256: asset.content_hash.slice(7), permission_ref, intended_use: "logo" };
    binding.assets = [boundAsset];
    const bytes = context.referenceAssetBytes.get(asset.asset_id);
    layer_manifest.push({ layer_id: "layer:logo", kind: "approved_asset", asset_id: asset.asset_id,
      asset_sha256: boundAsset.sha256, permission_ref,
      artifact: { artifact_id: "artifact:asset-2-logo", locator_ref: "object:fixture:asset-2-logo",
        sha256: boundAsset.sha256, mime_type: asset.media_type, width_px: 16, height_px: 16,
        access_policy_ref: "access:fixture:asset-2-logo" } });
    assetRights = ["display", "modify", "reproduce"].map((action) => ({ asset_id: asset.asset_id, action,
      source_ref: asset.source_id, content_hash: asset.content_hash, package_id: context.research.package_id,
      package_hash: packageHash, permission_ref, intended_use: "logo", evidence_ref: `proof:${action}:asset-2`,
      checked_at: NOW - 1000, expires_at: NOW + 60_000 }));
    assert.ok(bytes instanceof Uint8Array);
  }
  binding.composition.sha256 = hashCompositionLayerManifest({ binding, artifact, layer_manifest, trustedScope: scope });
  const checked_at = NOW - 1000;
  const expires_at = NOW + 60_000;
  const dependencies = { brief_hash: briefHash, facts_revision_id: context.research.event_id, facts_sha256: factsHash,
    package_id: context.research.package_id, package_sha256: packageHash,
    design_version_id: design.design_version_id, design_version_sha256: design.design_hash,
    artwork_sha256: design.artifact.content_hash, parent_version_id: design.parent_version_id,
    parent_design_hash: null, selection_revision: selection.revision, asset_rights: assetRights, edit_policy: null,
    authority_proof: { proof_ref: "authority-proof:api-fixture", state_sha256: `sha256:${"0".repeat(64)}`,
      checked_at, expires_at } };
  const policyBody = { contract: "CreativeCompositionEditPolicy", schema_version: "1.0",
    policy_ref: "edit-policy:api-fixture", policy_version: "fixture-v1", brief_hash: briefHash,
    facts_revision_id: context.research.event_id, facts_sha256: factsHash, package_id: context.research.package_id,
    package_sha256: packageHash, design_version_id: design.design_version_id,
    design_version_sha256: design.design_hash, artwork_sha256: design.artifact.content_hash,
    selection_revision: selection.revision, locked_layer_ids: lockedLayerIds, factual_text_layers: factualTextLayers,
    checked_at, expires_at };
  dependencies.edit_policy = { ...policyBody, policy_sha256: canonicalHash(policyBody) };
  const geometry = [
    { layer_id: "layer:artwork", layout: null, text_size: null },
    { layer_id: "layer:title", layout: { x_milli: 100, y_milli: 100, width_milli: 800 },
      text_size: { value: "18", unit: "pt" } },
  ];
  if (includeLogo) geometry.push({ layer_id: "layer:logo", layout: { x_milli: 700, y_milli: 700,
    width_milli: 200, height_milli: 200 }, text_size: null });
  const raw = { tenant_id: scope.tenant_id, project_id: scope.project_id, brief_id: scope.brief_id,
    composition_id: compositionId, revision_id: revisionId, parent_revision_id: null,
    parent_revision_sha256: null, binding, artwork: artifact, layer_manifest, geometry, dependencies,
    preview: { contract: "CreativeCompositionPreviewMetadata", schema_version: "1.1",
      preview_id: "preview:api-initial", preview_sha256: hash(previewBytes), byte_length: previewBytes.byteLength,
      mime_type: previewMimeType, width_px: previewWidthPx, height_px: previewHeightPx,
      proof_ref: "preview-proof:api-initial",
      state_sha256: `sha256:${"0".repeat(64)}`, checked_at, expires_at } };
  const stateHash = compositionStateHash(raw);
  raw.dependencies.authority_proof.state_sha256 = stateHash;
  raw.preview.state_sha256 = stateHash;
  return createCompositionRevision(raw, { trustedScope: scope, previewBytes, nowMs: NOW }).revision;
}

function replacePublishedCompositionPreviewForIntegrityTest(context, actionId, revision, previewBytes) {
  const db = context.store.db;
  const guardedTables = ["creative_composition_actions_v1", "creative_composition_revisions_v1"];
  const triggers = db.prepare(`SELECT name,sql FROM sqlite_master WHERE type='trigger'
    AND tbl_name IN (?,?) ORDER BY name`).all(...guardedTables);
  assert.ok(triggers.length >= 6, "the fixture records every immutable publication guard it temporarily bypasses");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const trigger of triggers) db.exec(`DROP TRIGGER ${trigger.name}`);
    const revisionJson = canonicalSerialize(revision);
    const actionResultJson = canonicalSerialize({ status: "published", revision_id: revision.revision_id,
      revision_sha256: revision.revision_sha256 });
    const composition = createCompositionProductionEnvelope(revision);
    const preview_access = { contract: "CreativeCompositionPreviewAccess", schema_version: "1.1",
      preview_id: revision.preview.preview_id, sha256: revision.preview.preview_sha256,
      byte_length: previewBytes.byteLength, mime_type: revision.preview.mime_type,
      width_px: revision.preview.width_px, height_px: revision.preview.height_px,
      bytes_base64: Buffer.from(previewBytes).toString("base64") };
    const jobResultJson = canonicalSerialize({ status: "saved", composition,
      revision_sha256: revision.revision_sha256, selection_revision: revision.dependencies.selection_revision, preview_access });
    const revisionChanges = db.prepare(`UPDATE creative_composition_revisions_v1 SET revision_sha256=?,state_sha256=?,
      preview_sha256=?,preview_byte_length=?,preview_bytes=?,revision_json=?
      WHERE tenant_id=? AND project_id=? AND brief_id=? AND composition_id=? AND revision_id=?`)
      .run(revision.revision_sha256, revision.state_sha256, revision.preview.preview_sha256, previewBytes.byteLength,
        previewBytes, revisionJson, SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id,
        revision.composition_id, revision.revision_id).changes;
    assert.equal(revisionChanges, 1);
    const currentChanges = db.prepare(`UPDATE creative_composition_current_v1 SET revision_sha256=?
      WHERE tenant_id=? AND project_id=? AND brief_id=? AND composition_id=? AND revision_id=?`)
      .run(revision.revision_sha256, SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id,
        revision.composition_id, revision.revision_id).changes;
    assert.equal(currentChanges, 1);
    const actionChanges = db.prepare(`UPDATE creative_composition_actions_v1 SET candidate_revision_json=?,preview_sha256=?,
      preview_bytes=?,result_json=? WHERE tenant_id=? AND project_id=? AND brief_id=? AND action_id=?`)
      .run(revisionJson, revision.preview.preview_sha256, previewBytes, actionResultJson,
        SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id, actionId).changes;
    assert.equal(actionChanges, 1);
    const jobChanges = db.prepare("UPDATE creative_jobs SET result_json=? WHERE tenant_id=? AND project_id=? AND action_id=?")
      .run(jobResultJson, SCOPE.tenant_id, SCOPE.project_id, actionId).changes;
    assert.equal(jobChanges, 1);
    for (const trigger of triggers) db.exec(trigger.sql);
    db.exec("COMMIT");
  } catch (error) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
  const restored = db.prepare(`SELECT name,sql FROM sqlite_master WHERE type='trigger'
    AND tbl_name IN (?,?) ORDER BY name`).all(...guardedTables);
  assert.deepEqual(restored, triggers, "the original immutable publication guards are restored byte-for-byte");
}

function compositionCurrentAssertion(input) {
  return { contract: "CreativeCompositionCurrentAssertionResult", schema_version: "1.1", status: "current",
    scope: input.scope, composition_id: input.composition_id,
    current_revision_id: input.target_revision_id, current_revision_sha256: input.target_revision_sha256,
    selection_revision: input.selection_revision, design_version_id: input.design_version_id,
    design_version_sha256: input.design_version_sha256, facts_revision_id: input.facts_revision_id,
    facts_sha256: input.facts_sha256, package_id: input.package_id, package_sha256: input.package_sha256,
    proof_ref: "current-proof:api-fixture", checked_at: input.checked_at, expires_at: NOW + 60_000 };
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

function syntheticNativePromptPort() {
  return { async render({ prompt_template }) {
    return { prompt: "Synthetic integration prompt with no model authority.",
      template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
      template_sha256: prompt_template.template_sha256 };
  } };
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
  const preflightCalls = [];
  const nativeRoutePlans = [];
  const nativeManifestReferences = [];
  const nativeEditPlans = [];
  const providerWithPreflightProbe = Object.freeze({
    ...provider,
    resolveRoute(input) {
      nativeRoutePlans.push({ operation: input.operation, plan: input.plan });
      return provider.resolveRoute(input);
    },
    async inspectConceptReferences(input) {
      const inspected = await provider.inspectConceptReferences(input);
      preflightCalls.push({ input, inspected });
      return inspected;
    },
    async edit(input) {
      nativeEditPlans.push(input.plan);
      nativeManifestReferences.push(input.concept_reference_manifest.references.map((reference) => ({ ...reference })));
      return provider.edit(input);
    },
  });
  installConceptAuthority(context, providerWithPreflightProbe);

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
  assert.ok(preflightCalls.length > 0, "the real provider reference decoder must run before dispatch");
  const firstPreflight = preflightCalls[0];
  assert.deepEqual(Object.keys(firstPreflight.input.references[0]).sort(),
    ["asset_id", "content_hash", "media_type", "role_ref", "source_ref"],
    "pre-decode callback references must not claim dimensions that are not known yet");
  assert.deepEqual(firstPreflight.inspected.map(({ width, height }) => [width, height]), [[17, 16], [16, 16]],
    "the provider returns dimensions only after it has read and decoded the authorized bytes");
  assert.ok(nativeManifestReferences.length >= 1);
  for (const references of nativeManifestReferences) {
    assert.deepEqual(references.map(({ width, height }) => [width, height]), [[17, 16], [16, 16]],
      "the final native edit manifest retains validated decoded dimensions");
  }
  assert.ok(nativeRoutePlans.length >= 1, "the public concept route must pass the native plan through the typed route port");
  assert.ok(nativeEditPlans.length >= 1, "the public concept edit must pass the same native plan to the provider");
  const firstNativePlan = nativeRoutePlans[0].plan;
  assert.equal(nativeRoutePlans[0].operation, "edit");
  assert.deepEqual(Object.keys(firstNativePlan).sort(), ["brief_id", "operation", "source_refs", "steps"],
    "route receives the runtime's minimal native plan, not fabricated EditPlan metadata");
  assert.equal(firstNativePlan.operation, "concept.generate");
  assert.equal(firstNativePlan.source_refs.length, 2);
  assert.equal(firstNativePlan.steps.length, 1);
  assert.deepEqual(firstNativePlan.steps[0].source_refs, firstNativePlan.source_refs);
  assert.deepEqual(Object.keys(firstNativePlan.steps[0]).sort(), ["action", "parameters", "source_refs"]);
  assert.deepEqual(firstNativePlan.steps[0].parameters, { variant_count: 1 });
  for (const routePlan of nativeRoutePlans) assert.deepEqual(routePlan.plan, firstNativePlan);
  for (const editPlan of nativeEditPlans) assert.deepEqual(editPlan, firstNativePlan,
    "native provider.edit receives the same minimal plan shape that resolved its route");
  const [first, second] = result.result.candidates;
  assert.notEqual(first.design_version.design_version_id, second.design_version.design_version_id);
  assert.notEqual(first.design_version.artifact.content_hash, second.design_version.artifact.content_hash);
  for (const candidate of result.result.candidates) {
    assert.equal(candidate.design_version.parent_version_id, null);
    assert.equal(candidate.creative_concept_lineage.parent_version_id, null);
    assert.deepEqual(candidate.design_version.source_refs, ["page-1", "page-2"]);
    assert.equal(candidate.creative_concept_lineage.source_assets.length, 2);
    assert.equal(Object.isFrozen(candidate.creative_concept_lineage.source_assets[0]), true);
    assert.equal(candidate.creative_concept_lineage.adapter_snapshot.provider_name, "openai");
    assert.equal(candidate.creative_concept_lineage.adapter_snapshot.configuration.size, "16x16");
    assert.equal(Object.hasOwn(candidate.creative_concept_lineage.adapter_snapshot, "provider_tag"), false);
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

test("actual concepts.create keeps both authorized assets when their shared source page appears once in native plans", async (t) => {
  const context = await setup(t, { sameSourcePage: true });
  const outputBytes = makePng({ width: 16, height: 16 });
  let postedReferenceHashes = [];
  const provider = createNativeProvider({ store: context.store, referenceAssetBytes: context.referenceAssetBytes,
    promptPort: syntheticNativePromptPort(),
    fetchImpl: async (url, init) => {
      context.counters.provider_posts += 1;
      assert.equal(String(url), "https://api.openai.com/v1/images/edits");
      assert.equal(init.method, "POST");
      assert.equal(init.body.has("mask"), false, "same-page initial concept edits still omit a fabricated mask");
      const files = init.body.getAll("image[]");
      assert.equal(files.length, 2, "both distinct authorized assets are sent even though they share one source page");
      postedReferenceHashes = await Promise.all(files.map(async (file) => hash(Buffer.from(await file.arrayBuffer()))));
      return new Response(JSON.stringify({ data: [{ b64_json: outputBytes.toString("base64") }],
        usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30,
          input_tokens_details: { image_tokens: 18, text_tokens: 2 },
          output_tokens_details: { image_tokens: 9, text_tokens: 1 } } }),
      { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-same-source-page" } });
    } });
  const routeCalls = [];
  const editPlans = [];
  const editReferences = [];
  const providerWithPlanProbe = Object.freeze({
    ...provider,
    resolveRoute(input) {
      routeCalls.push(input);
      return provider.resolveRoute(input);
    },
    async edit(input) {
      editPlans.push(input.plan);
      editReferences.push(input.concept_reference_manifest.references.map(({ asset_id, source_ref }) => ({ asset_id, source_ref })));
      return provider.edit(input);
    },
  });
  installConceptAuthority(context, providerWithPlanProbe);

  const request = conceptRequest("concept-api-same-source-page", "1.1", 1);
  request.source_refs = ["page-1"];
  const result = await context.api.invoke(authorizedActor(), request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.status, "completed");
  assert.equal(result.result.candidates.length, 1);
  assert.equal(context.counters.provider_posts, 1);
  assert.equal(context.counters.reserves, 1);
  assert.equal(context.counters.settlements, 1);
  assert.deepEqual(postedReferenceHashes, [
    hash(context.referenceAssetBytes.get("asset-1")), hash(context.referenceAssetBytes.get("asset-2")),
  ]);
  assert.notEqual(postedReferenceHashes[0], postedReferenceHashes[1], "the two authorized asset bytes remain distinct");
  assert.deepEqual(editReferences, [[
    { asset_id: "asset-1", source_ref: "page-1" }, { asset_id: "asset-2", source_ref: "page-1" },
  ]]);
  assert.equal(routeCalls.length, 1);
  assert.equal(routeCalls[0].operation, "edit");
  assert.equal(editPlans.length, 1);
  const routePlan = routeCalls[0].plan;
  const editPlan = editPlans[0];
  assert.deepEqual(editPlan, routePlan, "the route and native edit callback observe the same plan");
  assert.deepEqual(routePlan.source_refs, ["page-1"], "the shared source page is represented once");
  assert.deepEqual(routePlan.steps[0].source_refs, ["page-1"]);
  assert.equal(result.result.candidates[0].design_version.parent_version_id, null);
  assert.equal(result.result.candidates[0].creative_concept_lineage.source_assets.length, 2);
  assert.deepEqual(result.result.candidates[0].design_version.source_refs, ["page-1"]);
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

test("API 1.2 composition.get remains null until explicit create publishes exact owner bytes", async (t) => {
  const context = await setup(t);
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("composition-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const previewBytes = Uint8Array.from(makePng({ width: 17, height: 16 }));
  const revision = initialComposition(context, design, selection, previewBytes, { previewWidthPx: 17 });
  let resolves = 0;
  let assertions = 0;
  context.ports.composition = {
    async resolveCurrent() { resolves += 1; return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision, preview_bytes: Uint8Array.from(previewBytes) }; },
    assertCurrent(input) { assertions += 1; return compositionCurrentAssertion(input); },
  };
  const before = { dispatches: context.counters.seed_dispatches, reserves: context.counters.reserves,
    posts: context.counters.provider_posts, settlements: context.counters.settlements };
  const empty = await context.api.invoke(authorizedActor(), compositionRequest(null, "composition.get", {}));
  assert.equal(empty.ok, true, JSON.stringify(empty));
  assert.deepEqual(empty.result, { composition: null, status: "not_initialized" });
  assert.equal(resolves, 0, "empty reads do not ask an owner port to invent a composition");

  const created = await context.api.invoke(authorizedActor(), compositionRequest("composition-create-api", "composition.create", {}));
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.schema_version, "1.2");
  assert.equal(created.result.status, "saved");
  assert.equal(created.result.composition.revision.revision_sha256, revision.revision_sha256);
  assert.equal(created.result.preview_access.sha256, hash(previewBytes));
  assert.deepEqual(Buffer.from(created.result.preview_access.bytes_base64, "base64"), Buffer.from(previewBytes));
  const persisted = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  assert.equal(persisted.revision.revision_sha256, revision.revision_sha256);
  assert.deepEqual(persisted.preview_bytes, previewBytes);

  const read = await context.api.invoke(authorizedActor(), compositionRequest(null, "composition.get", {}));
  assert.equal(read.ok, true, JSON.stringify(read));
  assert.equal(read.result.status, "current");
  assert.equal(read.result.composition.revision.revision_sha256, revision.revision_sha256);
  assert.deepEqual(Buffer.from(read.result.preview_access.bytes_base64, "base64"), Buffer.from(previewBytes));
  assert.equal(resolves, 2, "explicit create and populated read each resolve the owner-backed revision");
  assert.equal(assertions, 2, "create and read both use an owner-backed synchronous currentness assertion");
  assert.deepEqual({ dispatches: context.counters.seed_dispatches, reserves: context.counters.reserves,
    posts: context.counters.provider_posts, settlements: context.counters.settlements }, before,
  "composition create/get are offline and add no provider or billing effects");
});

test("composition create and update roll back thenable commit ports and keep synchronous publication", async (t) => {
  const context = await setup(t);
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("composition-sync-commit-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const sourceBytes = Uint8Array.from(makePng({ width: 16, height: 16, transparent: true }));
  const revision = initialComposition(context, design, selection, sourceBytes);
  const preparedBytes = Uint8Array.from(makePng({ width: 17, height: 16, transparent: true }));
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision, preview_bytes: Uint8Array.from(sourceBytes) }; },
    async preparePreview(input) {
      const checked_at = NOW - 500;
      return { contract: "CreativeCompositionPreview", schema_version: "1.1",
        preview: { contract: "CreativeCompositionPreviewMetadata", schema_version: "1.1",
          preview_id: `preview:${input.action_id}`, preview_sha256: hash(preparedBytes),
          byte_length: preparedBytes.byteLength, mime_type: "image/png", width_px: 17, height_px: 16,
          proof_ref: `preview-proof:${input.action_id}`, state_sha256: input.candidate.state_sha256,
          checked_at, expires_at: NOW + 60_000 },
        authority_proof: { proof_ref: `authority-proof:${input.action_id}`,
          state_sha256: input.candidate.state_sha256, checked_at, expires_at: NOW + 60_000 },
        preview_bytes: Uint8Array.from(preparedBytes) };
    },
    assertCurrent(input) { return compositionCurrentAssertion(input); },
  };

  const synchronousCommit = context.ports.storage.commitCompositionRevision;
  context.ports.storage.commitCompositionRevision = (input, transaction) =>
    Promise.resolve(synchronousCommit(input, transaction));
  const failedCreate = await context.api.invoke(authorizedActor(), compositionRequest(
    "composition-async-commit-create", "composition.create", {}));
  assert.equal(failedCreate.ok, false, JSON.stringify(failedCreate));
  assert.equal(failedCreate.error.code, "unavailable");
  assert.equal(failedCreate.error.field, "job_publication");
  assert.equal(await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id }), null, "a thenable create commit rolls back its staged revision and current pointer");
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count,
    0, "the failed create commit leaves no immutable revision");
  assert.equal(context.store.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?")
    .get("composition-async-commit-create").status, "failed");

  context.ports.storage.commitCompositionRevision = synchronousCommit;
  const created = await context.api.invoke(authorizedActor(), compositionRequest(
    "composition-sync-commit-create", "composition.create", {}));
  assert.equal(created.ok, true, JSON.stringify(created));
  const parent = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  assert.equal(parent.revision.revision_sha256, revision.revision_sha256,
    "the normal synchronous commit remains usable after the rejected adapter contract");
  const plan = createCompositionEditPlan({ plan_id: "composition-plan:async-commit-update/1",
    binding: parent.revision.binding, layer_manifest: parent.revision.layer_manifest,
    target_composition_revision_id: "composition-revision:async-commit-update",
    operations: [{ operation_id: "set-title/async-commit", kind: "set_text", layer_id: "layer:title",
      value: "This child must not publish" }],
    trustedScope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id } });

  context.ports.storage.commitCompositionRevision = (input, transaction) =>
    Promise.resolve(synchronousCommit(input, transaction));
  const failedUpdate = await context.api.invoke(authorizedActor(), compositionRequest(
    "composition-async-commit-update", "composition.update", { plan }));
  assert.equal(failedUpdate.ok, false, JSON.stringify(failedUpdate));
  assert.equal(failedUpdate.error.code, "unavailable");
  assert.equal(failedUpdate.error.field, "job_publication");
  const currentAfterUpdate = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  assert.equal(currentAfterUpdate.revision.revision_id, parent.revision.revision_id);
  assert.equal(currentAfterUpdate.revision.revision_sha256, parent.revision.revision_sha256,
    "a thenable update commit cannot replace the parent revision");
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count,
    1, "the failed update leaves no child revision");
  assert.equal(context.store.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?")
    .get("composition-async-commit-update").status, "failed");
  const action = await context.ports.storage.getCompositionAction({ scope: SCOPE,
    action_id: "composition-async-commit-update" });
  assert.notEqual(action.status, "published", "a thenable commit cannot publish its staged composition action");
});

test("API 1.3 history exposes identity only and fresh revalidation restores current service after expiry and same-design restore", async (t) => {
  const context = await setup(t, { compositionLogo: true });
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("composition-v13-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const artworkBytes = Uint8Array.from(await context.store.getArtifactBytes({ scope: SCOPE,
    brief_id: SCOPE.brief_id, design_version_id: design.design_version_id }));
  const originalPreviewBytes = Uint8Array.from(makePng({ width: 16, height: 16 }));
  const parent = initialComposition(context, design, selection, originalPreviewBytes, { includeLogo: true,
    lockedLayerIds: ["layer:logo"], factualTextLayers: [{ layer_id: "layer:title", fact_id: "fact-api-1",
      fact_sha256: canonicalHash(context.brief.facts), text_sha256: hash("Example Event") }], titleValue: "Example Event" });
  let ownerRevision = parent;
  let ownerPreviewBytes = originalPreviewBytes;
  let invalidEvidenceTransform = null;
  let rejectedEvidenceCalls = 0;
  let successfulRevalidationCalls = 0;
  let previewCalls = 0;
  const regeneratedPreviewBytes = Uint8Array.from(makePng({ width: 17, height: 16, transparent: true }));
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision: ownerRevision, preview_bytes: Uint8Array.from(ownerPreviewBytes) }; },
    async resolveRevalidation(input) {
      if (input.action_id === "composition-v13-revalidate") successfulRevalidationCalls += 1;
      else rejectedEvidenceCalls += 1;
      const checkedAt = NOW + 60_001;
      const rights = parent.dependencies.asset_rights.map((proof) => ({ ...proof,
        package_id: input.research_package.package_id, package_hash: input.package_hash,
        checked_at: checkedAt, expires_at: checkedAt + 60_000 }));
      const { policy_sha256: _oldPolicyHash, ...policyBody } = parent.dependencies.edit_policy;
      const editPolicy = { ...policyBody, brief_hash: input.brief_hash,
        facts_revision_id: input.research_package.event_id, facts_sha256: canonicalHash(input.brief.facts),
        package_id: input.research_package.package_id, package_sha256: input.package_hash,
        design_version_id: input.selected_design.design_version_id,
        design_version_sha256: input.selected_design.design_hash,
        artwork_sha256: input.selected_design.artifact.content_hash,
        selection_revision: input.selection_revision, checked_at: checkedAt, expires_at: checkedAt + 60_000 };
      editPolicy.policy_sha256 = canonicalHash(editPolicy);
      const evidence = { contract: "CreativeCompositionRevalidationEvidence", schema_version: "1.0",
        scope: input.scope, composition_id: input.composition_id, expected_current: input.expected_current,
        candidate_revision_id: input.candidate_revision_id, brief_hash: input.brief_hash,
        facts_revision_id: input.research_package.event_id, facts_sha256: canonicalHash(input.brief.facts),
        package_id: input.research_package.package_id, package_sha256: input.package_hash,
        design_version_id: input.selected_design.design_version_id,
        design_version_sha256: input.selected_design.design_hash, selection_revision: input.selection_revision,
        asset_rights: rights, edit_policy: editPolicy };
      return invalidEvidenceTransform ? invalidEvidenceTransform(evidence, input) : evidence;
    },
    async readApprovedAssetBytes(input) {
      const asset = context.research.assets.items.find((item) => item.asset_id === input.asset_id);
      return { asset_id: asset.asset_id, content_hash: asset.content_hash, mime_type: asset.media_type,
        bytes: Uint8Array.from(context.referenceAssetBytes.get(input.asset_id)) };
    },
    async preparePreview(input) {
      previewCalls += 1;
      const checked_at = NOW + 60_001;
      const state_sha256 = input.candidate.state_sha256;
      return { contract: "CreativeCompositionPreview", schema_version: "1.1",
        preview: { contract: "CreativeCompositionPreviewMetadata", schema_version: "1.1",
          preview_id: `preview:${input.action_id}`, preview_sha256: hash(regeneratedPreviewBytes),
          byte_length: regeneratedPreviewBytes.byteLength, mime_type: "image/png", width_px: 17, height_px: 16,
          proof_ref: `preview-proof:${input.action_id}`, state_sha256, checked_at, expires_at: checked_at + 60_000 },
        authority_proof: { proof_ref: `authority-proof:${input.action_id}`, state_sha256,
          checked_at, expires_at: checked_at + 60_000 }, preview_bytes: Uint8Array.from(regeneratedPreviewBytes) };
    },
    assertCurrent(input) {
      const result = compositionCurrentAssertion(input);
      return { ...result,
        // The owner assertion must be fresh relative to each operation. The
        // fixture clock advances before revalidation, so a constant NOW-based
        // expiry would correctly fail the publication fence.
        expires_at: input.checked_at + 60_000,
        current_revision_id: input.expected_current_revision_id ?? input.target_revision_id,
        current_revision_sha256: input.expected_current_revision_sha256 ?? input.target_revision_sha256 };
    },
  };
  const created = await context.api.invoke(authorizedActor(), compositionRequest("composition-v13-create", "composition.create", {}));
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.schema_version, "1.2");
  const before = { dispatches: context.counters.seed_dispatches, reserves: context.counters.reserves,
    posts: context.counters.provider_posts, settlements: context.counters.settlements };

  const foreignActor = { ...authorizedActor(), tenant_id: "tenant-composition-foreign", project_id: "project-composition-foreign" };
  const foreignUpdatePlan = createCompositionEditPlan({ plan_id: "composition-plan:foreign-action/1",
    binding: parent.binding, layer_manifest: parent.layer_manifest,
    target_composition_revision_id: "composition-revision:foreign-action",
    operations: [{ operation_id: "foreign-action-title/1", kind: "set_text", layer_id: "layer:title", value: "Foreign" }],
    trustedScope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id } });
  const foreignActionAttempts = [
    compositionRequest("composition-v13-create", "composition.create", {}),
    compositionRequest("composition-v13-create", "composition.update", { plan: foreignUpdatePlan }),
    compositionV13Request("composition-v13-create", "composition.revalidate", {
      design_version_id: design.design_version_id, expected_current_revision_id: parent.revision_id,
      expected_current_revision_sha256: parent.revision_sha256, candidate_revision_id: "composition-revision:foreign" }),
  ];
  for (const foreignRequest of foreignActionAttempts) {
    const foreignAttempt = await context.api.invoke(foreignActor, foreignRequest);
    assert.equal(foreignAttempt.ok, false, JSON.stringify(foreignAttempt));
    assert.equal(foreignAttempt.error.code, "scope_denied");
  }
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 1,
    "cross-tenant reuse of a create action ID cannot inspect or mutate its composition history");
  assert.equal(successfulRevalidationCalls, 0);
  assert.equal(previewCalls, 0);

  const getIdentity = context.ports.storage.getCurrentCompositionIdentity;
  context.ports.storage.getCurrentCompositionIdentity = undefined;
  const unavailableHistory = await context.api.invoke(authorizedActor(), compositionV13Request(null, "composition.history",
    { design_version_id: design.design_version_id }));
  assert.equal(unavailableHistory.ok, false, JSON.stringify(unavailableHistory));
  assert.equal(unavailableHistory.error.code, "unavailable");
  context.ports.storage.getCurrentCompositionIdentity = getIdentity;

  const validHistoryIdentity = await getIdentity({ scope: SCOPE, design_version_id: design.design_version_id });
  context.ports.storage.getCurrentCompositionIdentity = async () => ({ ...validHistoryIdentity,
    selection_revision: 0, updated_at: "not-a-UTC-time" });
  const malformedIdentity = await context.api.invoke(authorizedActor(), compositionV13Request(null, "composition.history",
    { design_version_id: design.design_version_id }));
  assert.equal(malformedIdentity.ok, false, JSON.stringify(malformedIdentity));
  assert.equal(malformedIdentity.error.code, "failed");
  assert.equal(malformedIdentity.error.field, "composition.current_identity");
  context.ports.storage.getCurrentCompositionIdentity = getIdentity;
  const listRevisions = context.ports.storage.listCompositionRevisions;
  context.ports.storage.listCompositionRevisions = async () => ({ items: [{ ...parent,
    dependencies: { ...parent.dependencies, design_version_id: "design:other-tenant" } }], has_more: false });
  const malformedHistory = await context.api.invoke(authorizedActor(), compositionV13Request(null, "composition.history",
    { design_version_id: design.design_version_id }));
  assert.equal(malformedHistory.ok, false, JSON.stringify(malformedHistory));
  assert.equal(malformedHistory.error.code, "failed");
  assert.equal(malformedHistory.error.field, "composition.history_record");
  context.ports.storage.listCompositionRevisions = listRevisions;

  context.advanceClock(60_001);
  const staleRead = await context.api.invoke(authorizedActor(), compositionRequest(null, "composition.get", {}));
  assert.equal(staleRead.ok, false, JSON.stringify(staleRead));
  assert.equal(staleRead.error.code, "stale_version");
  const restore = apiRequest("composition-v13-same-design-restore", "restore", null, "page-1");
  restore.payload = { brief_id: SCOPE.brief_id, target_design_version_id: design.design_version_id,
    expected_selection_revision: selection.revision };
  const restored = await context.api.invoke(authorizedActor(), restore);
  assert.equal(restored.ok, true, JSON.stringify(restored));
  assert.equal(restored.result.selection.design_version_id, design.design_version_id);
  assert.equal(restored.result.selection.revision, selection.revision + 1);

  const historyRequest = compositionV13Request(null, "composition.history", { design_version_id: design.design_version_id, limit: 5 });
  const history = await context.api.invoke(authorizedActor(), historyRequest);
  assert.equal(history.ok, true, JSON.stringify(history));
  assert.equal(history.schema_version, "1.3");
  assert.equal(history.result.status, "identity_only");
  assert.equal(history.result.selection_compatibility, "changed");
  assert.deepEqual(history.result.current, { composition_id: parent.composition_id, revision_id: parent.revision_id,
    revision_sha256: parent.revision_sha256, design_version_id: design.design_version_id,
    design_version_sha256: design.design_hash, selection_revision: selection.revision, updated_at: history.result.current.updated_at });
  assert.equal(history.result.revisions[0].revision_id, parent.revision_id);
  assert.equal(Object.hasOwn(history.result.revisions[0], "preview_bytes"), false);
  assert.equal(Object.hasOwn(history.result.revisions[0], "preview_access"), false);
  assert.equal(Object.hasOwn(history.result, "preview_access"), false);

  const invalidParent = await context.api.invoke(authorizedActor(), compositionV13Request("composition-v13-wrong-parent",
    "composition.revalidate", { design_version_id: design.design_version_id,
      expected_current_revision_id: parent.revision_id, expected_current_revision_sha256: `sha256:${"0".repeat(64)}`,
      candidate_revision_id: "composition-revision:wrong-parent" }));
  assert.equal(invalidParent.ok, false, JSON.stringify(invalidParent));
  assert.equal(invalidParent.error.code, "stale_version");
  const reusedRevisionId = await context.api.invoke(authorizedActor(), compositionV13Request("composition-v13-reused-revision",
    "composition.revalidate", { design_version_id: design.design_version_id,
      expected_current_revision_id: parent.revision_id, expected_current_revision_sha256: parent.revision_sha256,
      candidate_revision_id: parent.revision_id }));
  assert.equal(reusedRevisionId.ok, false, JSON.stringify(reusedRevisionId));
  assert.equal(reusedRevisionId.error.code, "invalid_request");

  const failedEvidenceCases = [
    { name: "cross-scope owner evidence", code: "scope_denied", field: "composition.revalidation_evidence.scope",
      transform(evidence) { evidence.scope = { ...evidence.scope, tenant_id: "tenant-forged" }; return evidence; } },
    { name: "revoked logo permission proof", code: "permission_denied", field: "composition.asset_rights",
      transform(evidence) { evidence.asset_rights = evidence.asset_rights.filter((proof) => proof.action !== "display"); return evidence; } },
    { name: "owner policy drops a locked logo", code: "permission_denied", field: "composition.revalidation_policy",
      transform(evidence) { const { policy_sha256: _hash, ...body } = evidence.edit_policy;
        body.locked_layer_ids = []; evidence.edit_policy = { ...body, policy_sha256: canonicalHash(body) }; return evidence; } },
    { name: "owner policy drops factual text protection", code: "permission_denied", field: "composition.revalidation_policy",
      transform(evidence) { const { policy_sha256: _hash, ...body } = evidence.edit_policy;
        body.factual_text_layers = []; evidence.edit_policy = { ...body, policy_sha256: canonicalHash(body) }; return evidence; } },
  ];
  for (const [index, sample] of failedEvidenceCases.entries()) {
    invalidEvidenceTransform = sample.transform;
    const rejected = await context.api.invoke(authorizedActor(), compositionV13Request(`composition-v13-reject-${index}`,
      "composition.revalidate", { design_version_id: design.design_version_id,
        expected_current_revision_id: parent.revision_id, expected_current_revision_sha256: parent.revision_sha256,
        candidate_revision_id: `composition-revision:rejected-${index}` }));
    assert.equal(rejected.ok, false, `${sample.name}: ${JSON.stringify(rejected)}`);
    assert.equal(rejected.error.code, sample.code, sample.name);
    assert.equal(rejected.error.field, sample.field, sample.name);
    assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 1,
      `${sample.name} leaves the old immutable current revision as the only revision`);
    assert.equal(previewCalls, 0, `${sample.name} is rejected before preview generation`);
  }
  invalidEvidenceTransform = null;
  const resolver = context.ports.composition.resolveRevalidation;
  context.ports.composition.resolveRevalidation = undefined;
  const missingResolver = await context.api.invoke(authorizedActor(), compositionV13Request("composition-v13-no-resolver",
    "composition.revalidate", { design_version_id: design.design_version_id,
      expected_current_revision_id: parent.revision_id, expected_current_revision_sha256: parent.revision_sha256,
      candidate_revision_id: "composition-revision:no-resolver" }));
  assert.equal(missingResolver.ok, false, JSON.stringify(missingResolver));
  assert.equal(missingResolver.error.code, "unavailable");
  context.ports.composition.resolveRevalidation = resolver;
  assert.equal(previewCalls, 0, "a missing optional API 1.3 capability fails closed before preview work");

  const preparePreview = context.ports.composition.preparePreview;
  let resolveCancelPreviewEntered;
  const cancelPreviewEntered = new Promise((resolve) => { resolveCancelPreviewEntered = resolve; });
  let releaseCancelPreview;
  const cancelPreviewGate = new Promise((resolve) => { releaseCancelPreview = resolve; });
  context.ports.composition.preparePreview = async (input) => {
    const preview = await preparePreview(input);
    resolveCancelPreviewEntered(input);
    await cancelPreviewGate;
    return preview;
  };
  const cancelRevalidationRequest = compositionV13Request("composition-v13-revalidate-cancel",
    "composition.revalidate", { design_version_id: design.design_version_id,
      expected_current_revision_id: parent.revision_id, expected_current_revision_sha256: parent.revision_sha256,
      candidate_revision_id: "composition-revision:cancelled-renewal" });
  const cancelRevalidationPromise = context.api.invoke(authorizedActor(), cancelRevalidationRequest);
  const cancelPreviewInput = await cancelPreviewEntered;
  assert.equal(cancelPreviewInput.candidate.revision_id, "composition-revision:cancelled-renewal");
  const pendingRevalidationJob = context.store.db.prepare("SELECT job_id,status FROM creative_jobs WHERE action_id=?")
    .get(cancelRevalidationRequest.action_id);
  assert.equal(pendingRevalidationJob.status, "running");
  const cancelRevalidation = await context.api.invoke(authorizedActor(),
    cancelRequest("composition-v13-revalidate-cancel-request", pendingRevalidationJob.job_id));
  assert.equal(cancelRevalidation.ok, true, JSON.stringify(cancelRevalidation));
  assert.equal(cancelRevalidation.job.status, "cancelled");
  releaseCancelPreview();
  const rejectedCancellation = await cancelRevalidationPromise;
  assert.equal(rejectedCancellation.ok, false, JSON.stringify(rejectedCancellation));
  assert.equal(rejectedCancellation.error.code, "cancelled");
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 1,
    "cancelled revalidation never publishes its renewed child");
  assert.equal((await context.ports.storage.getCompositionAction({ scope: SCOPE,
    action_id: cancelRevalidationRequest.action_id })).status, "cancelled");
  context.ports.composition.preparePreview = preparePreview;

  const request = compositionV13Request("composition-v13-revalidate", "composition.revalidate", {
    design_version_id: design.design_version_id, expected_current_revision_id: parent.revision_id,
    expected_current_revision_sha256: parent.revision_sha256, candidate_revision_id: "composition-revision:v13-renewed" });
  const renewed = await context.api.invoke(authorizedActor(), request);
  assert.equal(renewed.ok, true, JSON.stringify({ renewed,
    job: context.store.db.prepare("SELECT status,error_json FROM creative_jobs WHERE action_id=?").get(request.action_id),
    action: context.store.db.prepare("SELECT status,result_json FROM creative_composition_actions_v1 WHERE action_id=?").get(request.action_id),
    current: context.store.db.prepare("SELECT revision_id,revision_sha256,selection_revision FROM creative_composition_current_v1").get() }));
  assert.equal(renewed.schema_version, "1.3");
  assert.equal(renewed.result.contract, "CreativeCompositionRevalidationResult");
  assert.equal(renewed.result.status, "saved");
  const child = renewed.result.composition.revision;
  const committedChild = await context.ports.storage.getCompositionRevision({ scope: SCOPE,
    composition_id: parent.composition_id, revision_id: child.revision_id });
  ownerRevision = committedChild.revision;
  ownerPreviewBytes = committedChild.preview_bytes;
  assert.equal(child.parent_revision_id, parent.revision_id);
  assert.equal(child.parent_revision_sha256, parent.revision_sha256);
  assert.equal(child.dependencies.selection_revision, selection.revision + 1);
  assert.equal(canonicalSerialize(child.artwork), canonicalSerialize(parent.artwork));
  assert.equal(canonicalSerialize(child.layer_manifest), canonicalSerialize(parent.layer_manifest));
  assert.equal(canonicalSerialize(child.geometry), canonicalSerialize(parent.geometry));
  assert.deepEqual(parent.dependencies.edit_policy.locked_layer_ids, ["layer:logo"]);
  assert.deepEqual(parent.dependencies.edit_policy.factual_text_layers.map((item) => item.layer_id), ["layer:title"]);
  assert.deepEqual(child.dependencies.edit_policy.locked_layer_ids, ["layer:logo"]);
  assert.equal(canonicalSerialize(child.dependencies.edit_policy.factual_text_layers),
    canonicalSerialize(parent.dependencies.edit_policy.factual_text_layers));
  assert.equal(child.dependencies.asset_rights.length, parent.dependencies.asset_rights.length);
  assert.notEqual(child.revision_sha256, parent.revision_sha256);
  assert.equal(successfulRevalidationCalls, 1);
  assert.equal(rejectedEvidenceCalls, failedEvidenceCases.length + 1);
  assert.equal(previewCalls, 2);
  assert.deepEqual(Buffer.from(renewed.result.preview_access.bytes_base64, "base64"), Buffer.from(regeneratedPreviewBytes));
  const parentAgain = await context.ports.storage.getCompositionRevision({ scope: SCOPE,
    composition_id: parent.composition_id, revision_id: parent.revision_id });
  assert.equal(parentAgain.revision.revision_sha256, parent.revision_sha256);
  assert.deepEqual(parentAgain.preview_bytes, originalPreviewBytes);
  const artworkAfter = await context.store.getArtifactBytes({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: design.design_version_id });
  assert.deepEqual(Buffer.from(artworkAfter), Buffer.from(artworkBytes));

  const currentHistory = await context.api.invoke(authorizedActor(), historyRequest);
  assert.equal(currentHistory.ok, true, JSON.stringify(currentHistory));
  assert.equal(currentHistory.result.current.revision_id, child.revision_id);
  assert.equal(currentHistory.result.selection_compatibility, "current");
  const currentGet = await context.api.invoke(authorizedActor(), compositionRequest(null, "composition.get", {}));
  assert.equal(currentGet.ok, true, JSON.stringify(currentGet));
  assert.equal(currentGet.result.composition.revision.revision_id, child.revision_id);

  context.advanceClock(60_001);
  const replay = await context.api.invoke(authorizedActor(), request);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.composition.revision.revision_sha256, child.revision_sha256);
  assert.deepEqual(Buffer.from(replay.result.preview_access.bytes_base64, "base64"), Buffer.from(regeneratedPreviewBytes));
  assert.equal(successfulRevalidationCalls, 1, "completed replay does not request fresh rights or policy proofs");
  assert.equal(previewCalls, 2, "completed replay does not prepare another preview");
  const completedRevalidationJob = context.store.db.prepare("SELECT job_id,status FROM creative_jobs WHERE action_id=?")
    .get(request.action_id);
  assert.equal(completedRevalidationJob.status, "completed");
  const completedCancel = cancelRequest("composition-v13-completed-cancel", completedRevalidationJob.job_id);
  const completedCancellation = await context.api.invoke(authorizedActor(), completedCancel);
  assert.equal(completedCancellation.ok, true, JSON.stringify(completedCancellation));
  assert.equal(completedCancellation.job.status, "completed",
    "cancelling a completed renewal is idempotent and does not regress its completed job");
  const completedCancelReplay = await context.api.invoke(authorizedActor(), completedCancel);
  assert.equal(completedCancelReplay.ok, true, JSON.stringify(completedCancelReplay));
  assert.equal(completedCancelReplay.job.status, "completed");
  assert.deepEqual({ dispatches: context.counters.seed_dispatches, reserves: context.counters.reserves,
    posts: context.counters.provider_posts, settlements: context.counters.settlements }, before);
});

test("composition create/get validate exact decoded PNG, JPEG, and WebP preview metadata", async (t) => {
  const samples = [
    { format: "png", mime_type: "image/png", bytes: Uint8Array.from(makePng({ width: 16, height: 16 })) },
    { format: "jpeg", mime_type: "image/jpeg", bytes: new Uint8Array(await readFile(
      new URL("../../fixtures/models/valid-16x16.jpg", import.meta.url))) },
    { format: "webp", mime_type: "image/webp", bytes: new Uint8Array(await readFile(
      new URL("../../fixtures/models/valid-16x16.webp", import.meta.url))) },
  ];
  for (const sample of samples) await t.test(sample.format, async (subtest) => {
    const context = await setup(subtest);
    const seedPlan = await jsonFixture("generate-plan");
    seedPlan.base.brief_hash = canonicalHash(context.brief);
    seedPlan.source_refs = ["page-1"];
    seedPlan.steps[0].source_refs = ["page-1"];
    const seed = await context.api.invoke(authorizedActor(), apiRequest(`preview-format-seed-${sample.format}`,
      "generate", seedPlan, "page-1"));
    assert.equal(seed.ok, true, JSON.stringify(seed));
    const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
    const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
      design_version_id: selection.design_version_id });
    const revision = initialComposition(context, design, selection, sample.bytes,
      { previewMimeType: sample.mime_type });
    context.ports.composition = {
      async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
        scope: SCOPE, revision, preview_bytes: Uint8Array.from(sample.bytes) }; },
      assertCurrent(input) { return compositionCurrentAssertion(input); },
    };
    const created = await context.api.invoke(authorizedActor(), compositionRequest(`preview-format-create-${sample.format}`,
      "composition.create", {}));
    assert.equal(created.ok, true, JSON.stringify(created));
    const read = await context.api.invoke(authorizedActor(), compositionRequest(null, "composition.get", {}));
    assert.equal(read.ok, true, JSON.stringify(read));
    assert.equal(read.result.preview_access.mime_type, sample.mime_type);
    assert.equal(read.result.preview_access.width_px, 16);
    assert.equal(read.result.preview_access.height_px, 16);
    assert.deepEqual(Buffer.from(read.result.preview_access.bytes_base64, "base64"), Buffer.from(sample.bytes));
    assert.equal(read.result.preview_access.sha256, hash(sample.bytes));
  });
});

test("composition.create rejects preview bytes that are not the declared decoded image", async (t) => {
  for (const sample of [
    { key: "non-image", name: "non-image bytes", bytes: Uint8Array.from(Buffer.from("not an image")),
      expectedField: "composition.preview.decode" },
    { key: "truncated", name: "truncated encoded image", bytes: Uint8Array.from(makePng({ width: 16, height: 16 })).subarray(0, 30),
      expectedField: "composition.preview.decode" },
    { key: "different-dimensions", name: "different decoded dimensions", bytes: Uint8Array.from(makePng({ width: 17, height: 16 })),
      expectedField: "composition.preview.metadata" },
  ]) {
    await t.test(sample.name, async (t) => {
      const context = await setup(t);
      const seedPlan = await jsonFixture("generate-plan");
      seedPlan.base.brief_hash = canonicalHash(context.brief);
      seedPlan.source_refs = ["page-1"];
      seedPlan.steps[0].source_refs = ["page-1"];
      const seed = await context.api.invoke(authorizedActor(), apiRequest(`preview-invalid-seed-${sample.key}`, "generate", seedPlan, "page-1"));
      assert.equal(seed.ok, true, JSON.stringify(seed));
      const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
      const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
        design_version_id: selection.design_version_id });
      const revision = initialComposition(context, design, selection, sample.bytes);
      context.ports.composition = {
        async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
          scope: SCOPE, revision, preview_bytes: sample.bytes }; },
        assertCurrent(input) { return compositionCurrentAssertion(input); },
      };

      const result = await context.api.invoke(authorizedActor(), compositionRequest(`preview-invalid-create-${sample.key}`, "composition.create", {}));
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, "failed");
      assert.equal(result.error.field, sample.expectedField);
      assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 0,
        "invalid preview bytes never create a durable composition revision");
      assert.equal(await context.store.getCurrentComposition({ scope: SCOPE,
        design_version_id: design.design_version_id }), null);
    });
  }
});

test("composition completed replay rejects hash-consistent corrupt preview bytes without rerunning effects", async (t) => {
  const samples = [
    { name: "non-image bytes", bytes: Uint8Array.from(Buffer.from("stored text is not a PNG")),
      options: {}, field: "stored_result.preview.decode" },
    { name: "truncated PNG", bytes: Uint8Array.from(makePng({ width: 16, height: 16 })).subarray(0, 30),
      options: {}, field: "stored_result.preview.decode" },
    { name: "MIME contradicts decoded PNG", bytes: Uint8Array.from(makePng({ width: 16, height: 16 })),
      options: { previewMimeType: "image/webp" }, field: "stored_result.preview.metadata" },
    { name: "dimensions contradict decoded PNG", bytes: Uint8Array.from(makePng({ width: 16, height: 16 })),
      options: { previewWidthPx: 17 }, field: "stored_result.preview.metadata" },
  ];
  for (const [index, sample] of samples.entries()) await t.test(sample.name, async (subtest) => {
    const context = await setup(subtest);
    const seedPlan = await jsonFixture("generate-plan");
    seedPlan.base.brief_hash = canonicalHash(context.brief);
    seedPlan.source_refs = ["page-1"];
    seedPlan.steps[0].source_refs = ["page-1"];
    const seed = await context.api.invoke(authorizedActor(), apiRequest(`preview-replay-seed-${index}`,
      "generate", seedPlan, "page-1"));
    assert.equal(seed.ok, true, JSON.stringify(seed));
    const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
    const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
      design_version_id: selection.design_version_id });
    const originalBytes = Uint8Array.from(makePng({ width: 16, height: 16 }));
    const originalRevision = initialComposition(context, design, selection, originalBytes);
    let ownerResolves = 0;
    let ownerAssertions = 0;
    context.ports.composition = {
      async resolveCurrent() { ownerResolves += 1; return { contract: "CreativeCompositionSource", schema_version: "1.1",
        scope: SCOPE, revision: originalRevision, preview_bytes: Uint8Array.from(originalBytes) }; },
      assertCurrent(input) { ownerAssertions += 1; return compositionCurrentAssertion(input); },
    };
    const actionId = `preview-replay-corrupt-${index}`;
    const created = await context.api.invoke(authorizedActor(), compositionRequest(actionId, "composition.create", {}));
    assert.equal(created.ok, true, JSON.stringify(created));
    const corruptRevision = initialComposition(context, design, selection, sample.bytes, sample.options);
    replacePublishedCompositionPreviewForIntegrityTest(context, actionId, corruptRevision, sample.bytes);
    const durableAction = await context.ports.storage.getCompositionAction({ scope: SCOPE, action_id: actionId });
    assert.equal(durableAction.status, "published");
    assert.equal(durableAction.revision.revision_sha256, corruptRevision.revision_sha256,
      "the test corruption retains matching immutable revision and byte hashes");
    const beforeReplay = { ownerResolves, ownerAssertions, posts: context.counters.provider_posts,
      reserves: context.counters.reserves, settlements: context.counters.settlements, held: context.counters.held };

    const replay = await context.api.invoke(authorizedActor(), compositionRequest(actionId, "composition.create", {}));
    assert.equal(replay.ok, false, JSON.stringify(replay));
    assert.equal(replay.error.code, "failed");
    assert.equal(replay.error.field, sample.field);
    assert.equal(replay.error.retryable, false, "corrupt durable preview is a non-retryable integrity failure");
    assert.equal(replay.result, undefined, "corrupt preview bytes are never returned on replay");
    assert.deepEqual({ ownerResolves, ownerAssertions, posts: context.counters.provider_posts,
      reserves: context.counters.reserves, settlements: context.counters.settlements, held: context.counters.held }, beforeReplay,
    "completed replay does not re-run owner, preview, provider, or billing effects");
    assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 1,
      "replay validation preserves the existing immutable history");
  });
});

test("composition.update rejects a preview provider result whose bytes do not decode to its metadata", async (t) => {
  const context = await setup(t);
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("preview-update-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const initialBytes = Uint8Array.from(makePng({ width: 16, height: 16 }));
  const initial = initialComposition(context, design, selection, initialBytes);
  const invalidBytes = Uint8Array.from(Buffer.from("plain text disguised as a preview"));
  let ownerRevision = initial;
  let ownerBytes = initialBytes;
  const previewCalls = [];
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision: ownerRevision, preview_bytes: ownerBytes }; },
    async preparePreview(input) {
      previewCalls.push(input);
      const checked_at = NOW - 500;
      return { contract: "CreativeCompositionPreview", schema_version: "1.1",
        preview: { contract: "CreativeCompositionPreviewMetadata", schema_version: "1.1",
          preview_id: `preview:${input.action_id}`, preview_sha256: hash(invalidBytes), byte_length: invalidBytes.byteLength,
          mime_type: "image/webp", width_px: 999, height_px: 998,
          proof_ref: `preview-proof:${input.action_id}`, state_sha256: input.candidate.state_sha256,
          checked_at, expires_at: NOW + 60_000 },
        authority_proof: { proof_ref: `authority-proof:${input.action_id}`, state_sha256: input.candidate.state_sha256,
          checked_at, expires_at: NOW + 60_000 }, preview_bytes: invalidBytes };
    },
    assertCurrent(input) { return compositionCurrentAssertion(input); },
  };
  const created = await context.api.invoke(authorizedActor(), compositionRequest("preview-update-create", "composition.create", {}));
  assert.equal(created.ok, true, JSON.stringify(created));
  const storedBefore = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  ownerRevision = storedBefore.revision;
  ownerBytes = Uint8Array.from(storedBefore.preview_bytes);
  const plan = createCompositionEditPlan({ plan_id: "composition-plan:invalid-preview-update/1",
    binding: storedBefore.revision.binding, layer_manifest: storedBefore.revision.layer_manifest,
    target_composition_revision_id: "composition-revision:invalid-preview-update",
    operations: [{ operation_id: "invalid-preview-title/1", kind: "set_text",
      layer_id: "layer:title", value: "Invalid Preview" }],
    trustedScope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id } });

  const result = await context.api.invoke(authorizedActor(), compositionRequest("preview-update-invalid", "composition.update", { plan }));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, "failed");
  assert.equal(result.error.field, "composition.preview.decode");
  assert.equal(previewCalls.length, 1);
  const storedAfter = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  assert.equal(storedAfter.revision.revision_sha256, storedBefore.revision.revision_sha256);
  assert.deepEqual(storedAfter.preview_bytes, storedBefore.preview_bytes);
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 1,
    "an invalid provider preview cannot publish a child revision");
});

test("composition.get rejects a locally expired rights proof after an awaited asset read", async (t) => {
  const context = await setup(t, { compositionLogo: true });
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("preview-expiry-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const previewBytes = Uint8Array.from(makePng({ width: 16, height: 16 }));
  const revision = initialComposition(context, design, selection, previewBytes, { includeLogo: true });
  let expireDuringRead = false;
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision, preview_bytes: previewBytes }; },
    async readApprovedAssetBytes(input) {
      if (expireDuringRead) context.advanceClock(60_001);
      const asset = context.research.assets.items.find((item) => item.asset_id === input.asset_id);
      return { asset_id: input.asset_id, content_hash: asset.content_hash, mime_type: asset.media_type,
        bytes: Uint8Array.from(context.referenceAssetBytes.get(input.asset_id)) };
    },
    assertCurrent(input) { return { ...compositionCurrentAssertion(input), checked_at: input.checked_at,
      expires_at: input.checked_at + 60_000 }; },
  };
  const created = await context.api.invoke(authorizedActor(), compositionRequest("preview-expiry-create", "composition.create", {}));
  assert.equal(created.ok, true, JSON.stringify(created));
  expireDuringRead = true;

  const read = await context.api.invoke(authorizedActor(), compositionRequest(null, "composition.get", {}));
  assert.equal(read.ok, false, JSON.stringify(read));
  assert.equal(read.error.code, "stale_version");
  assert.equal(read.result, undefined, "expired local authority never returns preview access");
  assert.throws(() => context.store.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id }), (error) => error.code === "stale_version",
  "the durable store rejects the same expired local proof");
});

test("composition.get runs a synchronous local fence after the final awaited current read", async (t) => {
  const context = await setup(t);
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("composition-local-fence-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const previewBytes = Uint8Array.from(makePng({ width: 16, height: 16 }));
  const revision = initialComposition(context, design, selection, previewBytes);
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision, preview_bytes: Uint8Array.from(previewBytes) }; },
    assertCurrent(input) { return compositionCurrentAssertion(input); },
  };
  const created = await context.api.invoke(authorizedActor(), compositionRequest("composition-local-fence-create", "composition.create", {}));
  assert.equal(created.ok, true, JSON.stringify(created));

  const originalGet = context.ports.storage.getCurrentComposition.bind(context.ports.storage);
  let reads = 0;
  context.ports.storage.getCurrentComposition = async (input) => {
    const stored = await originalGet(input);
    reads += 1;
    if (reads === 2) {
      // This mutation lands after the final async read resolves but before the
      // caller resumes from await. The external owner assertion remains fresh;
      // only a same-connection local fence can detect the selection ABA.
      queueMicrotask(() => context.store.db.prepare(`UPDATE version_selections SET revision=revision+1
        WHERE tenant_id=? AND project_id=? AND brief_id=?`)
        .run(SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id));
    }
    return stored;
  };
  const read = await context.api.invoke(authorizedActor(), compositionRequest(null, "composition.get", {}));
  assert.equal(read.ok, false, JSON.stringify(read));
  assert.equal(read.error.code, "stale_version");
  assert.equal(read.result, undefined, "a local selection change after the final read cannot expose preview bytes");
  assert.equal(reads, 2, "the mutation is queued by the final awaited current-pointer read");
  assert.equal(context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }).revision,
    selection.revision + 1, "the fixture completed a same-design selection ABA revision");
});

test("composition.get preserves final storage integrity errors separately from ordinary unavailability", async (t) => {
  for (const mode of ["integrity", "unavailable"]) await t.test(mode, async (subtest) => {
    const context = await setup(subtest);
    const seedPlan = await jsonFixture("generate-plan");
    seedPlan.base.brief_hash = canonicalHash(context.brief);
    seedPlan.source_refs = ["page-1"];
    seedPlan.steps[0].source_refs = ["page-1"];
    const seeded = await context.api.invoke(authorizedActor(), apiRequest(`composition-integrity-seed-${mode}`,
      "generate", seedPlan, "page-1"));
    assert.equal(seeded.ok, true, JSON.stringify(seeded));
    const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
    const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
      design_version_id: selection.design_version_id });
    const previewBytes = Uint8Array.from(makePng({ width: 16, height: 16 }));
    const revision = initialComposition(context, design, selection, previewBytes);
    let corruptAfterInitialRead = false;
    context.ports.composition = {
      async resolveCurrent() {
        if (corruptAfterInitialRead) {
          const db = context.store.db;
          const triggers = db.prepare(`SELECT name,sql FROM sqlite_master WHERE type='trigger'
            AND tbl_name='creative_composition_revisions_v1' ORDER BY name`).all();
          assert.ok(triggers.length > 0);
          db.exec("BEGIN IMMEDIATE");
          try {
            for (const trigger of triggers) db.exec(`DROP TRIGGER ${trigger.name}`);
            const changed = db.prepare(`UPDATE creative_composition_revisions_v1 SET revision_json='{'
              WHERE tenant_id=? AND project_id=? AND brief_id=? AND composition_id=? AND revision_id=?`)
              .run(SCOPE.tenant_id, SCOPE.project_id, SCOPE.brief_id, revision.composition_id, revision.revision_id).changes;
            assert.equal(changed, 1);
            for (const trigger of triggers) db.exec(trigger.sql);
            db.exec("COMMIT");
          } catch (error) {
            if (db.isTransaction) db.exec("ROLLBACK");
            throw error;
          }
        }
        return { contract: "CreativeCompositionSource", schema_version: "1.1", scope: SCOPE,
          revision, preview_bytes: Uint8Array.from(previewBytes) };
      },
      assertCurrent(input) { return compositionCurrentAssertion(input); },
    };
    const created = await context.api.invoke(authorizedActor(), compositionRequest(`composition-integrity-create-${mode}`,
      "composition.create", {}));
    assert.equal(created.ok, true, JSON.stringify(created));

    if (mode === "unavailable") {
      context.ports.storage.getCurrentComposition = async () => {
        throw new VersionStoreError("unavailable", "composition.current", true);
      };
      const read = await context.api.invoke(authorizedActor(), compositionRequest(null, "composition.get", {}));
      assert.equal(read.ok, false, JSON.stringify(read));
      assert.equal(read.error.code, "unavailable");
      assert.equal(read.error.field, "composition.current");
      assert.equal(read.error.retryable, true, "real storage availability remains retryable");
      return;
    }

    corruptAfterInitialRead = true;
    const read = await context.api.invoke(authorizedActor(), compositionRequest(null, "composition.get", {}));
    assert.equal(read.ok, false, JSON.stringify(read));
    assert.equal(read.error.code, "failed", "corrupt stored revision is a safe public integrity failure");
    assert.equal(read.error.field, "composition.revision", "the final GET preserves the sanitized store diagnostic");
    assert.equal(read.error.retryable, false);
    assert.equal(read.result, undefined);
    assert.throws(() => context.store.getCurrentComposition({ scope: SCOPE,
      design_version_id: design.design_version_id }), (error) => error.code === "integrity_error" &&
        error.field === "composition.revision",
    "the direct same-store read reports the distinct integrity classification");
  });
});

test("composition publication rechecks queued owner revocation after awaited persistence and before commit", async (t) => {
  const context = await setup(t);
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("composition-fence-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const previewBytes = Uint8Array.from(await context.store.getArtifactBytes({ scope: SCOPE,
    brief_id: SCOPE.brief_id, design_version_id: design.design_version_id }));
  const revision = initialComposition(context, design, selection, previewBytes);
  let ownerCurrent = true;
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision, preview_bytes: Uint8Array.from(previewBytes) }; },
    assertCurrent(input) {
      if (!ownerCurrent) throw Object.assign(new Error("selection or rights were revoked"), { code: "stale_version" });
      return compositionCurrentAssertion(input);
    },
  };
  const complete = context.ports.jobs.completeIfActive.bind(context.ports.jobs);
  context.ports.jobs.completeIfActive = (input, persist, beforeCommit) => complete(input, async (transaction) => {
    const result = await persist(transaction);
    queueMicrotask(() => { ownerCurrent = false; });
    return result;
  }, beforeCommit);
  const result = await context.api.invoke(authorizedActor(), compositionRequest("composition-queued-revoke", "composition.create", {}));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, "stale_version");
  assert.equal(result.error.field, "creative_context");
  assert.equal(ownerCurrent, false, "the fixture revokes owner currentness in the awaited publication gap");
  assert.equal(await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id }), null, "the final fence rolls back staged revision and job result");
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 0);
});

test("composition publication rechecks proof expiry and job lease after the final owner callback", async (t) => {
  for (const sample of [
    { name: "fresh owner assertion cannot revive expired local preview proofs", advance: 60_001,
      leaseDurationMs: 60_000, error: "stale_version", field: "creative_context" },
    { name: "fresh owner assertion cannot extend the local job lease", advance: 1_001,
      leaseDurationMs: 1_000, error: "unavailable" },
  ]) {
    await t.test(sample.name, async (subtest) => {
      const context = await setup(subtest, { leaseDurationMs: sample.leaseDurationMs });
      const seedPlan = await jsonFixture("generate-plan");
      seedPlan.base.brief_hash = canonicalHash(context.brief);
      seedPlan.source_refs = ["page-1"];
      seedPlan.steps[0].source_refs = ["page-1"];
      const seed = await context.api.invoke(authorizedActor(), apiRequest(`composition-final-clock-seed-${sample.advance}`,
        "generate", seedPlan, "page-1"));
      assert.equal(seed.ok, true, JSON.stringify(seed));
      const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
      const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
        design_version_id: selection.design_version_id });
      const sourceBytes = Uint8Array.from(makePng({ width: 16, height: 16, transparent: true }));
      const sourceRevision = initialComposition(context, design, selection, sourceBytes);
      const preparedBytes = Uint8Array.from(makePng({ width: 16, height: 16 }));
      let assertions = 0;
      context.ports.composition = {
        async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
          scope: SCOPE, revision: sourceRevision, preview_bytes: Uint8Array.from(sourceBytes) }; },
        async preparePreview(input) {
          const checked_at = NOW - 500;
          return { contract: "CreativeCompositionPreview", schema_version: "1.1",
            preview: { contract: "CreativeCompositionPreviewMetadata", schema_version: "1.1",
              preview_id: `preview:${input.action_id}`, preview_sha256: hash(preparedBytes),
              byte_length: preparedBytes.byteLength, mime_type: "image/png", width_px: 16, height_px: 16,
              proof_ref: `preview-proof:${input.action_id}`, state_sha256: input.candidate.state_sha256,
              checked_at, expires_at: NOW + 60_000 },
            authority_proof: { proof_ref: `authority-proof:${input.action_id}`,
              state_sha256: input.candidate.state_sha256, checked_at, expires_at: NOW + 60_000 },
            preview_bytes: Uint8Array.from(preparedBytes) };
        },
        assertCurrent(input) {
          assertions += 1;
          context.advanceClock(sample.advance);
          const checked_at = NOW + sample.advance;
          const expectedId = input.expected_current_revision_id ?? input.target_revision_id;
          const expectedHash = input.expected_current_revision_sha256 ?? input.target_revision_sha256;
          return { ...compositionCurrentAssertion(input), current_revision_id: expectedId,
            current_revision_sha256: expectedHash, checked_at, expires_at: checked_at + 60_000 };
        },
      };
      const actionId = `composition-final-clock-${sample.advance}`;
      const result = await context.api.invoke(authorizedActor(), compositionRequest(actionId, "composition.create", {}));
      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, sample.error, JSON.stringify(result));
      if (sample.field) assert.equal(result.error.field, sample.field);
      assert.equal(assertions, 1, "the owner assertion succeeds with fresh evidence after advancing the local clock");
      assert.equal(await context.ports.storage.getCurrentComposition({ scope: SCOPE,
        design_version_id: design.design_version_id }), null, "the failed final fence publishes no current pointer");
      assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count,
        0, "the failed final fence rolls back the staged immutable revision");
      const job = context.store.db.prepare("SELECT status FROM creative_jobs WHERE action_id=?").get(actionId);
      assert.notEqual(job.status, "completed", "the public job result does not commit after the clock boundary");
      const action = await context.ports.storage.getCompositionAction({ scope: SCOPE, action_id: actionId });
      assert.notEqual(action.status, "published", "the staged action does not become publicly published");
    });
  }
});

test("composition.update applies a typed plan, publishes a child preview once, and replays exact durable bytes", async (t) => {
  const context = await setup(t, { compositionLogo: true });
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("composition-update-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const artworkBytes = Uint8Array.from(await context.store.getArtifactBytes({ scope: SCOPE,
    brief_id: SCOPE.brief_id, design_version_id: design.design_version_id }));
  const initialPreviewBytes = Uint8Array.from(makePng({ width: 16, height: 16, transparent: true }));
  const initial = initialComposition(context, design, selection, initialPreviewBytes, { includeLogo: true });
  let ownerRevision = initial;
  let ownerPreviewBytes = initialPreviewBytes;
  const previewCalls = [];
  let assertions = 0;
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision: ownerRevision, preview_bytes: Uint8Array.from(ownerPreviewBytes) }; },
    async readApprovedAssetBytes(input) {
      return { asset_id: input.asset_id, content_hash: context.research.assets.items.find((item) => item.asset_id === input.asset_id)?.content_hash,
        mime_type: context.research.assets.items.find((item) => item.asset_id === input.asset_id)?.media_type,
        bytes: Uint8Array.from(context.referenceAssetBytes.get(input.asset_id)) };
    },
    async preparePreview(input) {
      previewCalls.push(input);
      const bytes = Uint8Array.from(makePng({ width: 16, height: 16, transparent: false }));
      const checked_at = NOW - 500;
      const state_sha256 = input.candidate.state_sha256;
      return { contract: "CreativeCompositionPreview", schema_version: "1.1",
        preview: { contract: "CreativeCompositionPreviewMetadata", schema_version: "1.1",
          preview_id: `preview:${input.action_id}`, preview_sha256: hash(bytes), byte_length: bytes.byteLength,
          mime_type: "image/png", width_px: 16, height_px: 16, proof_ref: `preview-proof:${input.action_id}`,
          state_sha256, checked_at, expires_at: NOW + 60_000 },
        authority_proof: { proof_ref: `authority-proof:${input.action_id}`, state_sha256,
          checked_at, expires_at: NOW + 60_000 }, preview_bytes: bytes };
    },
    assertCurrent(input) {
      assertions += 1;
      const result = compositionCurrentAssertion(input);
      return { ...result, current_revision_id: input.expected_current_revision_id ?? input.target_revision_id,
        current_revision_sha256: input.expected_current_revision_sha256 ?? input.target_revision_sha256 };
    },
  };
  const before = { dispatches: context.counters.seed_dispatches, reserves: context.counters.reserves,
    posts: context.counters.provider_posts, settlements: context.counters.settlements };
  const created = await context.api.invoke(authorizedActor(), compositionRequest("composition-update-create", "composition.create", {}));
  assert.equal(created.ok, true, JSON.stringify(created));
  // Both revisions use the fixture clock. Uppercase Z sorts before lowercase a in SQLite BINARY order.
  const plan = createCompositionEditPlan({ plan_id: "composition-plan:update-title/1", binding: initial.binding,
    layer_manifest: initial.layer_manifest, target_composition_revision_id: "composition-revision:Z",
    operations: [
      { operation_id: "set-title/1", kind: "set_text", layer_id: "layer:title", value: "Updated Festival" },
      { operation_id: "set-title-size/1", kind: "set_text_size", layer_id: "layer:title", size: { value: "20.5", unit: "pt" } },
      { operation_id: "set-title-layout/1", kind: "set_layer_layout", layer_id: "layer:title",
        layout: { x_milli: 125, y_milli: 115, width_milli: 760 } },
      { operation_id: "position-logo/1", kind: "position_approved_logo", layer_id: "layer:logo",
        asset_id: "asset-2", layout: { x_milli: 675, y_milli: 720, width_milli: 200, height_milli: 160 } },
    ],
    trustedScope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id } });
  const reusedActionId = await context.api.invoke(authorizedActor(), compositionRequest("composition-update-create",
    "composition.update", { plan }));
  assert.equal(reusedActionId.ok, false, JSON.stringify(reusedActionId));
  assert.equal(reusedActionId.error.code, "conflict", "one action ID cannot be reused for a different operation");
  assert.equal(previewCalls.length, 0, "a conflicting action ID is rejected before preview work");
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 1);
  const stalePlan = { ...plan, base_composition_revision_id: "composition-revision:obsolete" };
  const stale = await context.api.invoke(authorizedActor(), compositionRequest("composition-update-stale-parent", "composition.update", { plan: stalePlan }));
  assert.equal(stale.ok, false, JSON.stringify(stale));
  assert.equal(stale.error.code, "stale_version");
  assert.equal(previewCalls.length, 0, "a stale parent is rejected before preview preparation");
  const malformedPlan = { ...plan, unrecognized_extension: "must not be ignored" };
  const malformed = await context.api.invoke(authorizedActor(), compositionRequest("composition-update-malformed-plan", "composition.update", { plan: malformedPlan }));
  assert.equal(malformed.ok, false, JSON.stringify(malformed));
  assert.equal(malformed.error.code, "invalid_request");
  assert.equal(previewCalls.length, 0, "unknown plan fields are rejected before preview preparation");
  const request = compositionRequest("composition-update-title", "composition.update", { plan });
  const updated = await context.api.invoke(authorizedActor(), request);
  assert.equal(updated.ok, true, JSON.stringify(updated));
  assert.equal(updated.result.status, "saved");
  assert.equal(previewCalls.length, 1);
  assert.equal(previewCalls[0].idempotency_key.length > 30, true);
  assert.equal(previewCalls[0].base_revision.revision_sha256, initial.revision_sha256);
  assert.equal(previewCalls[0].candidate.revision_id, plan.target_composition_revision_id);
  assert.equal(previewCalls[0].candidate.geometry[1].text_size.value, "20.5");
  assert.deepEqual(artworkBytes, Uint8Array.from(await context.store.getArtifactBytes({ scope: SCOPE,
    brief_id: SCOPE.brief_id, design_version_id: design.design_version_id })), "composition edits do not rewrite artwork bytes");

  const persisted = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  assert.equal(persisted.revision.parent_revision_id, initial.revision_id);
  assert.equal(persisted.revision.parent_revision_sha256, initial.revision_sha256);
  assert.equal(persisted.revision.layer_manifest[1].value, "Updated Festival");
  assert.equal(persisted.revision.revision_id, plan.target_composition_revision_id);
  assert.deepEqual(persisted.revision.geometry[1], { layer_id: "layer:title",
    layout: { x_milli: 125, y_milli: 115, width_milli: 760 }, text_size: { value: "20.5", unit: "pt" } });
  assert.deepEqual(persisted.revision.geometry[2], { layer_id: "layer:logo",
    layout: { x_milli: 675, y_milli: 720, width_milli: 200, height_milli: 160 }, text_size: null });
  assert.notEqual(persisted.revision.binding.composition.sha256, initial.binding.composition.sha256,
    "the legacy C04 digest changes only with the closed layer manifest");
  ownerRevision = persisted.revision;
  ownerPreviewBytes = Uint8Array.from(persisted.preview_bytes);
  const history = await context.ports.storage.listCompositionRevisions({ scope: SCOPE,
    composition_id: initial.composition_id, limit: 10 });
  assert.deepEqual(history.items.map((item) => item.revision_id), [persisted.revision.revision_id, initial.revision_id]);
  const publicHistory = await context.api.invoke(authorizedActor(), compositionV13Request(null, "composition.history",
    { design_version_id: design.design_version_id, limit: 10 }));
  assert.equal(publicHistory.ok, true, JSON.stringify(publicHistory));
  assert.deepEqual(publicHistory.result.revisions.map((revision) => revision.revision_id),
    [persisted.revision.revision_id, initial.revision_id]);
  const firstHistoryPage = await context.api.invoke(authorizedActor(), compositionV13Request(null, "composition.history",
    { design_version_id: design.design_version_id, limit: 1 }));
  assert.equal(firstHistoryPage.ok, true, JSON.stringify(firstHistoryPage));
  assert.equal(firstHistoryPage.result.has_more, true);
  assert.deepEqual(firstHistoryPage.result.revisions.map((revision) => revision.revision_id), [persisted.revision.revision_id]);
  const secondHistoryPage = await context.api.invoke(authorizedActor(), compositionV13Request(null, "composition.history",
    { design_version_id: design.design_version_id, limit: 1, after_revision_id: persisted.revision.revision_id }));
  assert.equal(secondHistoryPage.ok, true, JSON.stringify(secondHistoryPage));
  assert.deepEqual(secondHistoryPage.result.revisions.map((revision) => revision.revision_id), [initial.revision_id]);
  const listCompositionRevisions = context.ports.storage.listCompositionRevisions;
  context.ports.storage.listCompositionRevisions = async (input) => {
    const page = await listCompositionRevisions(input);
    return { ...page, items: [...page.items].reverse() };
  };
  const corruptOrder = await context.api.invoke(authorizedActor(), compositionV13Request(null, "composition.history",
    { design_version_id: design.design_version_id, limit: 10 }));
  assert.equal(corruptOrder.ok, false, JSON.stringify(corruptOrder));
  assert.equal(corruptOrder.error.code, "failed");
  assert.equal(corruptOrder.error.field, "composition.history_record");
  context.ports.storage.listCompositionRevisions = listCompositionRevisions;
  assert.equal(assertions, 5, "create, both rejected plans, update pre-preview currentness, and the synchronous commit fence are checked");

  const replay = await context.api.invoke(authorizedActor(), request);
  assert.equal(replay.ok, true, JSON.stringify(replay));
  assert.equal(replay.replayed, true);
  assert.equal(replay.result.revision_sha256, persisted.revision.revision_sha256);
  assert.deepEqual(Buffer.from(replay.result.preview_access.bytes_base64, "base64"), Buffer.from(persisted.preview_bytes));
  assert.equal(previewCalls.length, 1, "completed action replay does not prepare another preview");
  assert.deepEqual({ dispatches: context.counters.seed_dispatches, reserves: context.counters.reserves,
    posts: context.counters.provider_posts, settlements: context.counters.settlements }, before,
  "composition create/update/replay do not call an image provider or billing port");
});

test("public composition.update cannot edit a locked asset layer or a factual text layer", async (t) => {
  const context = await setup(t, { compositionLogo: true });
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("composition-policy-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const previewBytes = Uint8Array.from(makePng({ width: 16, height: 16, transparent: true }));
  let ownerRevision = initialComposition(context, design, selection, previewBytes, { includeLogo: true,
    lockedLayerIds: ["layer:logo"], factualTextLayers: [{ layer_id: "layer:title", fact_id: "fact-api-1",
      fact_sha256: canonicalHash(context.brief.facts), text_sha256: hash("Example Event") }], titleValue: "Example Event" });
  let ownerPreviewBytes = previewBytes;
  let previewCalls = 0;
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision: ownerRevision, preview_bytes: Uint8Array.from(ownerPreviewBytes) }; },
    async readApprovedAssetBytes(input) {
      const asset = context.research.assets.items.find((item) => item.asset_id === input.asset_id);
      return { asset_id: asset.asset_id, content_hash: asset.content_hash, mime_type: asset.media_type,
        bytes: Uint8Array.from(context.referenceAssetBytes.get(input.asset_id)) };
    },
    async preparePreview() { previewCalls += 1; throw new Error("denied edits must not prepare previews"); },
    assertCurrent(input) {
      const result = compositionCurrentAssertion(input);
      return { ...result, current_revision_id: input.expected_current_revision_id ?? input.target_revision_id,
        current_revision_sha256: input.expected_current_revision_sha256 ?? input.target_revision_sha256 };
    },
  };
  const created = await context.api.invoke(authorizedActor(), compositionRequest("composition-policy-create", "composition.create", {}));
  assert.equal(created.ok, true, JSON.stringify(created));
  const current = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  ownerRevision = current.revision;
  ownerPreviewBytes = current.preview_bytes;

  const attempts = [
    { action_id: "composition-policy-locked-logo", operation: { operation_id: "move-locked-logo/1",
      kind: "position_approved_logo", layer_id: "layer:logo", asset_id: "asset-2",
      layout: { x_milli: 600, y_milli: 700, width_milli: 200, height_milli: 200 } }, field: "plan.locked_layer" },
    { action_id: "composition-policy-factual-title", operation: { operation_id: "change-factual-title/1",
      kind: "set_text", layer_id: "layer:title", value: "Unverified replacement" }, field: "plan.factual_text" },
  ];
  for (const [index, sample] of attempts.entries()) {
    const plan = createCompositionEditPlan({ plan_id: `composition-plan:policy/${index}`, binding: current.revision.binding,
      layer_manifest: current.revision.layer_manifest,
      target_composition_revision_id: `composition-revision:policy-${index}`,
      operations: [sample.operation], trustedScope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id } });
    const result = await context.api.invoke(authorizedActor(), compositionRequest(sample.action_id, "composition.update", { plan }));
    assert.equal(result.ok, false, `${sample.action_id}: ${JSON.stringify(result)}`);
    assert.equal(result.error.code, "permission_denied");
    assert.equal(result.error.field, sample.field);
    assert.equal(previewCalls, 0, "locked and factual edits are denied before preview generation");
    const stillCurrent = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
      design_version_id: design.design_version_id });
    assert.equal(stillCurrent.revision.revision_sha256, current.revision.revision_sha256);
    assert.deepEqual(stillCurrent.preview_bytes, previewBytes);
    assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 1,
      "a denied edit leaves the original immutable revision as the only history entry");
  }
});

test("composition.update rolls back when rights are revoked in the final awaited publication gap", async (t) => {
  const context = await setup(t);
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("composition-update-fence-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const artworkBytes = Uint8Array.from(await context.store.getArtifactBytes({ scope: SCOPE,
    brief_id: SCOPE.brief_id, design_version_id: design.design_version_id }));
  let ownerCurrent = true;
  let ownerRevision;
  let ownerPreviewBytes;
  let assertionCount = 0;
  const createdPreview = Uint8Array.from(makePng({ width: 16, height: 16, transparent: true }));
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision: ownerRevision, preview_bytes: Uint8Array.from(ownerPreviewBytes) }; },
    async preparePreview(input) {
      const checked_at = NOW - 500;
      return { contract: "CreativeCompositionPreview", schema_version: "1.1",
        preview: { contract: "CreativeCompositionPreviewMetadata", schema_version: "1.1",
          preview_id: `preview:${input.action_id}`, preview_sha256: hash(createdPreview), byte_length: createdPreview.byteLength,
          mime_type: "image/png", width_px: 16, height_px: 16, proof_ref: `preview-proof:${input.action_id}`,
          state_sha256: input.candidate.state_sha256, checked_at, expires_at: NOW + 60_000 },
        authority_proof: { proof_ref: `authority-proof:${input.action_id}`, state_sha256: input.candidate.state_sha256,
          checked_at, expires_at: NOW + 60_000 }, preview_bytes: Uint8Array.from(createdPreview) };
    },
    assertCurrent(input) {
      assertionCount += 1;
      if (!ownerCurrent) throw Object.assign(new Error("current rights were revoked"), { code: "stale_version" });
      const result = compositionCurrentAssertion(input);
      return { ...result, current_revision_id: input.expected_current_revision_id ?? input.target_revision_id,
        current_revision_sha256: input.expected_current_revision_sha256 ?? input.target_revision_sha256 };
    },
  };
  const initialPreviewBytes = Uint8Array.from(makePng({ width: 16, height: 16 }));
  ownerRevision = initialComposition(context, design, selection, initialPreviewBytes);
  ownerPreviewBytes = initialPreviewBytes;
  const created = await context.api.invoke(authorizedActor(), compositionRequest("composition-update-fence-create", "composition.create", {}));
  assert.equal(created.ok, true, JSON.stringify(created));
  const initialCurrent = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  const plan = createCompositionEditPlan({ plan_id: "composition-plan:fence-update/1", binding: initialCurrent.revision.binding,
    layer_manifest: initialCurrent.revision.layer_manifest, target_composition_revision_id: "composition-revision:fence-update",
    operations: [{ operation_id: "fence-title/1", kind: "set_text", layer_id: "layer:title", value: "Revocation Race" }],
    trustedScope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id } });
  const complete = context.ports.jobs.completeIfActive.bind(context.ports.jobs);
  context.ports.jobs.completeIfActive = (input, persist, beforeCommit) => complete(input, async (transaction) => {
    const result = await persist(transaction);
    queueMicrotask(() => { ownerCurrent = false; });
    return result;
  }, beforeCommit);
  const result = await context.api.invoke(authorizedActor(), compositionRequest("composition-update-fence-race", "composition.update", { plan }));
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, "stale_version");
  assert.equal(result.error.field, "creative_context");
  assert.equal(ownerCurrent, false);
  assert.equal(assertionCount, 3, "create, pre-preview update, and final post-await assertion were invoked");
  const current = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  assert.equal(current.revision.revision_sha256, initialCurrent.revision.revision_sha256);
  assert.deepEqual(current.preview_bytes, initialCurrent.preview_bytes);
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 1,
    "a failed final fence leaves no child version visible");
  assert.deepEqual(Buffer.from(current.preview_bytes), Buffer.from(initialPreviewBytes));
  assert.deepEqual(artworkBytes, Uint8Array.from(await context.store.getArtifactBytes({ scope: SCOPE,
    brief_id: SCOPE.brief_id, design_version_id: design.design_version_id })));
});

test("public cancel recovers a pending composition.update in its brief scope", async (t) => {
  const context = await setup(t);
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("composition-cancel-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const previewBytes = Uint8Array.from(makePng({ width: 16, height: 16 }));
  let ownerRevision = initialComposition(context, design, selection, previewBytes);
  let ownerPreviewBytes = previewBytes;
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision: ownerRevision, preview_bytes: Uint8Array.from(ownerPreviewBytes) }; },
    assertCurrent(input) {
      const result = compositionCurrentAssertion(input);
      return { ...result, current_revision_id: input.expected_current_revision_id ?? input.target_revision_id,
        current_revision_sha256: input.expected_current_revision_sha256 ?? input.target_revision_sha256 };
    },
  };
  const created = await context.api.invoke(authorizedActor(), compositionRequest("composition-cancel-create", "composition.create", {}));
  assert.equal(created.ok, true, JSON.stringify(created));
  const parent = (await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id }));
  ownerRevision = parent.revision;
  ownerPreviewBytes = parent.preview_bytes;
  let resolvePreviewEntered;
  const previewEntered = new Promise((resolve) => { resolvePreviewEntered = resolve; });
  let releasePreview;
  const previewGate = new Promise((resolve) => { releasePreview = resolve; });
  const nextPreviewBytes = Uint8Array.from(makePng({ width: 17, height: 16 }));
  context.ports.composition.preparePreview = async (input) => {
    resolvePreviewEntered(input);
    return previewGate;
  };
  const plan = createCompositionEditPlan({ plan_id: "composition-plan:cancel/1", binding: parent.revision.binding,
    layer_manifest: parent.revision.layer_manifest, target_composition_revision_id: "composition-revision:cancelled",
    operations: [{ operation_id: "cancel-title/1", kind: "set_text", layer_id: "layer:title", value: "Cancelled edit" }],
    trustedScope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id } });
  const updateRequest = compositionRequest("composition-cancel-update", "composition.update", { plan });
  const updatePromise = context.api.invoke(authorizedActor(), updateRequest);
  const previewInput = await previewEntered;
  const job = context.store.db.prepare("SELECT job_id,status FROM creative_jobs WHERE action_id=?")
    .get(updateRequest.action_id);
  assert.equal(job.status, "running");
  const restoreBriefId = context.store.db.prepare("SELECT brief_id FROM creative_jobs WHERE job_id=?").get(job.job_id).brief_id;
  context.store.db.prepare("UPDATE creative_jobs SET brief_id=? WHERE job_id=?").run("brief:corrupt-cancel-scope", job.job_id);
  const corruptCancel = await context.api.invoke(authorizedActor(), cancelRequest("composition-cancel-corrupt-scope", job.job_id));
  assert.equal(corruptCancel.ok, false);
  assert.equal(corruptCancel.error.code, "failed");
  assert.equal(context.store.db.prepare("SELECT status FROM creative_jobs WHERE job_id=?").get(job.job_id).status, "running",
    "corrupt persisted action/job brief disagreement is detected before cancellation mutates the job");
  context.store.db.prepare("UPDATE creative_jobs SET brief_id=? WHERE job_id=?").run(restoreBriefId, job.job_id);
  const foreignActor = { ...authorizedActor(), tenant_id: "tenant-cancel-foreign", project_id: "project-cancel-foreign" };
  const foreignCancel = await context.api.invoke(foreignActor, cancelRequest("composition-cancel-foreign-scope", job.job_id));
  assert.equal(foreignCancel.ok, false);
  assert.equal(foreignCancel.error.code, "scope_denied");
  assert.equal(context.store.db.prepare("SELECT status FROM creative_jobs WHERE job_id=?").get(job.job_id).status, "running",
    "cross-tenant cancellation cannot mutate the persisted composition job");
  const cancel = cancelRequest("composition-cancel-request", job.job_id);
  const cancelled = await context.api.invoke(authorizedActor(), cancel);
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  assert.equal(cancelled.job.status, "cancelled");
  const duplicateCancel = await context.api.invoke(authorizedActor(), cancel);
  assert.equal(duplicateCancel.ok, true, JSON.stringify(duplicateCancel));
  assert.equal(duplicateCancel.job.status, "cancelled");

  const checkedAt = NOW - 1000;
  const stateHash = previewInput.candidate.state_sha256;
  releasePreview({ contract: "CreativeCompositionPreview", schema_version: "1.1",
    preview: { contract: "CreativeCompositionPreviewMetadata", schema_version: "1.1",
      preview_id: "preview:cancelled-update", preview_sha256: hash(nextPreviewBytes),
      byte_length: nextPreviewBytes.byteLength, mime_type: "image/png", width_px: 17, height_px: 16,
      proof_ref: "preview-proof:cancelled-update", state_sha256: stateHash,
      checked_at: checkedAt, expires_at: NOW + 60_000 },
    authority_proof: { proof_ref: "authority-proof:cancelled-update", state_sha256: stateHash,
      checked_at: checkedAt, expires_at: NOW + 60_000 }, preview_bytes: nextPreviewBytes });
  const update = await updatePromise;
  assert.equal(update.ok, false, JSON.stringify(update));
  assert.equal(update.error.code, "cancelled");
  const persisted = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  assert.equal(persisted.revision.revision_sha256, parent.revision.revision_sha256);
  assert.deepEqual(persisted.preview_bytes, parent.preview_bytes);
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 1,
    "cancelled preview preparation cannot publish a child or alter parent history");
  const action = await context.ports.storage.getCompositionAction({ scope: SCOPE, action_id: updateRequest.action_id });
  assert.equal(action.status, "cancelled");
});

test("public cancel recovers a pending composition.create before publishing its initial revision", async (t) => {
  const context = await setup(t);
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("composition-cancel-create-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const previewBytes = Uint8Array.from(makePng({ width: 16, height: 16 }));
  const revision = initialComposition(context, design, selection, previewBytes);
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision, preview_bytes: Uint8Array.from(previewBytes) }; },
    assertCurrent(input) { return compositionCurrentAssertion(input); },
  };
  const originalBegin = context.ports.storage.beginCompositionAction;
  let beginEntered;
  const entered = new Promise((resolve) => { beginEntered = resolve; });
  let releaseBegin;
  const gate = new Promise((resolve) => { releaseBegin = resolve; });
  context.ports.storage.beginCompositionAction = async (input) => {
    const action = await originalBegin(input);
    beginEntered(action);
    await gate;
    return action;
  };
  const request = compositionRequest("composition-cancel-create-pending", "composition.create", {});
  const createPromise = context.api.invoke(authorizedActor(), request);
  const action = await entered;
  assert.equal(action.status, "pending");
  const job = context.store.db.prepare("SELECT job_id,status FROM creative_jobs WHERE action_id=?").get(request.action_id);
  assert.equal(job.status, "running");
  const cancel = cancelRequest("composition-cancel-create-request", job.job_id);
  const cancelled = await context.api.invoke(authorizedActor(), cancel);
  assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
  assert.equal(cancelled.job.status, "cancelled");
  releaseBegin();
  const create = await createPromise;
  assert.equal(create.ok, false, JSON.stringify(create));
  assert.equal(create.error.code, "cancelled");
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_revisions_v1").get().count, 0);
  assert.equal(context.store.db.prepare("SELECT COUNT(*) AS count FROM creative_composition_current_v1").get().count, 0);
  assert.equal((await context.ports.storage.getCompositionAction({ scope: SCOPE, action_id: request.action_id })).status, "cancelled");
});

test("composition.update resumes an immutable staged preview after lease recovery without repeating the preview effect", async (t) => {
  const context = await setup(t, { leaseDurationMs: 1000 });
  const seedPlan = await jsonFixture("generate-plan");
  seedPlan.base.brief_hash = canonicalHash(context.brief);
  seedPlan.source_refs = ["page-1"];
  seedPlan.steps[0].source_refs = ["page-1"];
  const seed = await context.api.invoke(authorizedActor(), apiRequest("composition-resume-seed", "generate", seedPlan, "page-1"));
  assert.equal(seed.ok, true, JSON.stringify(seed));
  const selection = context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id });
  const design = context.store.getDesignVersion({ scope: SCOPE, brief_id: SCOPE.brief_id,
    design_version_id: selection.design_version_id });
  const initialPreview = Uint8Array.from(makePng({ width: 16, height: 16, transparent: true }));
  const initial = initialComposition(context, design, selection, initialPreview);
  const preparedPreview = Uint8Array.from(makePng({ width: 16, height: 16 }));
  let previewCalls = 0;
  context.ports.composition = {
    async resolveCurrent() { return { contract: "CreativeCompositionSource", schema_version: "1.1",
      scope: SCOPE, revision: initial, preview_bytes: Uint8Array.from(initialPreview) }; },
    async preparePreview(input) {
      previewCalls += 1;
      const checked_at = NOW - 500;
      return { contract: "CreativeCompositionPreview", schema_version: "1.1",
        preview: { contract: "CreativeCompositionPreviewMetadata", schema_version: "1.1",
          preview_id: `preview:${input.action_id}`, preview_sha256: hash(preparedPreview), byte_length: preparedPreview.byteLength,
          mime_type: "image/png", width_px: 16, height_px: 16, proof_ref: `preview-proof:${input.action_id}`,
          state_sha256: input.candidate.state_sha256, checked_at, expires_at: NOW + 60_000 },
        authority_proof: { proof_ref: `authority-proof:${input.action_id}`, state_sha256: input.candidate.state_sha256,
          checked_at, expires_at: NOW + 60_000 }, preview_bytes: Uint8Array.from(preparedPreview) };
    },
    assertCurrent(input) {
      const result = compositionCurrentAssertion(input);
      return { ...result, current_revision_id: input.expected_current_revision_id ?? input.target_revision_id,
        current_revision_sha256: input.expected_current_revision_sha256 ?? input.target_revision_sha256 };
    },
  };
  const created = await context.api.invoke(authorizedActor(), compositionRequest("composition-resume-create", "composition.create", {}));
  assert.equal(created.ok, true, JSON.stringify(created));
  const current = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  const plan = createCompositionEditPlan({ plan_id: "composition-plan:lease-resume/1", binding: current.revision.binding,
    layer_manifest: current.revision.layer_manifest, target_composition_revision_id: "composition-revision:lease-resume",
    operations: [{ operation_id: "resume-title/1", kind: "set_text", layer_id: "layer:title", value: "Recovered Preview" }],
    trustedScope: { tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id } });
  const request = compositionRequest("composition-resume-update", "composition.update", { plan });
  const originalComplete = context.ports.jobs.completeIfActive.bind(context.ports.jobs);
  const firstPublicationReached = deferred();
  const releaseFirstPublication = deferred();
  let publicationCalls = 0;
  context.ports.jobs.completeIfActive = (input, persist, beforeCommit) => {
    publicationCalls += 1;
    if (publicationCalls === 1) {
      firstPublicationReached.resolve();
      return releaseFirstPublication.promise.then(() => originalComplete(input, persist, beforeCommit));
    }
    return originalComplete(input, persist, beforeCommit);
  };
  const interrupted = context.api.invoke(authorizedActor(), request);
  await firstPublicationReached.promise;
  const staged = await context.ports.storage.getCompositionAction({ scope: SCOPE, action_id: request.action_id });
  assert.equal(staged.status, "staged");
  assert.equal(staged.revision.revision_id, plan.target_composition_revision_id);
  assert.equal(previewCalls, 1);
  context.advanceClock(1001);
  const resumed = await context.api.invoke(authorizedActor(), request);
  assert.equal(resumed.ok, true, JSON.stringify(resumed));
  assert.equal(previewCalls, 1, "recovery uses the original staged bytes and does not regenerate a preview");
  assert.equal(publicationCalls, 2);
  const persisted = await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id });
  assert.equal(persisted.revision.revision_id, plan.target_composition_revision_id);
  assert.equal(persisted.revision.parent_revision_sha256, current.revision.revision_sha256);
  assert.deepEqual(persisted.preview_bytes, preparedPreview);
  releaseFirstPublication.resolve();
  const firstResponse = await interrupted;
  assert.equal(firstResponse.ok, false, "the expired lease holder cannot overwrite the recovered publication");
  assert.equal((await context.ports.storage.getCurrentComposition({ scope: SCOPE,
    design_version_id: design.design_version_id })).revision.revision_sha256, persisted.revision.revision_sha256);
});
