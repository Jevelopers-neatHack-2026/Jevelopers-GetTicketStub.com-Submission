import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCreativeApi } from "../../src/api/v1.mjs";
import { canonicalHash, normalizeResearchPackage, validateCreativeBrief } from "../../src/contracts/index.mjs";
import { createOpenRouterImagesProvider } from "creative-engine/models";
import { createCreativeVersionApiPorts } from "../../src/versions/api-ports.mjs";
import { CreativeVersionStore } from "../../src/versions/store.mjs";
import { createSqliteTelemetryOutbox, USAGE_PROFILE } from "../../src/telemetry/index.mjs";
import { completeResearchPackage } from "../../fixtures/planning/research-packages.mjs";
import { makePng } from "../../fixtures/models/png.mjs";
import { CREDENTIAL_CANARY, FULL_USAGE, OR_ENDPOINT, OR_MODEL, OR_PROVIDER_TAG, orProfile } from "../../fixtures/models/openrouter-harness.mjs";

// API -> C03 -> CE08 -> CE11 integration for the OpenRouter adapter. Every provider response is
// intercepted; there is no credential, network access, or paid call. The usage map is an explicit MOCK
// owner profile used only to exercise the positive publication path.
const NOW = Date.parse("2026-10-10T18:00:00.000Z");
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


async function setup(t, { root: suppliedRoot, initialNow = NOW, idPrefix = "api", sameSourcePage = false } = {}) {
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
  const asset2SourcePage = sameSourcePage ? "page-1" : "page-2";
  researchInput.source_refs.push("asset:asset-2");
  if (!sameSourcePage) researchInput.source_refs.push("source:page-2");
  researchInput.source_identity[0].content_hash = hash(firstReferenceBytes);
  researchInput.assets.items[0].content_hash = hash(firstReferenceBytes);
  if (!sameSourcePage) researchInput.source_identity.push({ source_id: "page-2", uri: "https://example.test/reference-2.png",
    retrieved_at: "2026-10-10T12:00:00Z", content_hash: hash(referenceBytes) });
  researchInput.assets.items.push({ asset_id: "asset-2", source_id: asset2SourcePage,
    content_hash: hash(referenceBytes), media_type: "image/png" });
  researchInput.permissions.items.push({ asset_id: "asset-2", action: "modify", status: "granted",
    evidence_refs: [asset2SourcePage] });
  researchInput.permissions.items.push({ asset_id: "asset-2", action: "reproduce", status: "granted",
    evidence_refs: [asset2SourcePage] });
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
    { asset_id: "asset-2", action: "modify", status: "granted", evidence_refs: [asset2SourcePage] },
    { asset_id: "asset-2", action: "reproduce", status: "granted", evidence_refs: [asset2SourcePage] },
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


function orProvider({ context, fetchImpl, profile = {}, promptPort }) {
  const authority = orAuthority();
  const verify = authority.capabilityPort.verify;
  context.bindings = [];
  authority.capabilityPort = { ...authority.capabilityPort, verify(input) {
    context.bindings.push(input.target_binding);
    return verify(input);
  } };
  return createOpenRouterImagesProvider({
    ...orProfile({ configuration: { aspect_ratio: "1:1", output_format: "png", background: "opaque" }, ...profile }),
    ...authority,
    promptPort: promptPort ?? { async render() { return "Synthetic integration prompt with no model authority."; } },
    assetPort: {
      async readArtifact(input) { return context.store.getArtifactBytes({ scope: { ...input.scope, brief_id: SCOPE.brief_id },
        brief_id: SCOPE.brief_id, design_version_id: context.parentVersionId }); },
      async readReference(input) { return context.referenceAssetBytes.get(input.asset_id); },
    },
    fetchImpl,
    now: () => NOW,
    idFactory: () => `artifact-or-output-${++context.outputSequence}`,
  });
}

function orAuthority() {
  const evidenceHash = `sha256:${"a".repeat(64)}`;
  const capabilityFor = (input) => ({ status: "verified", eligible: true, revoked: false,
    operation_permission: "allowed", quota_status: "available", service: "openrouter",
    account_ref: "or-workspace-synthetic", project_ref: "or-key-synthetic",
    tenant_id: input.scope.tenant_id, project_id: input.scope.project_id,
    budget_scope_id: input.attempt.budget_scope_id, operation: input.operation, model: input.model,
    target_binding_sha256: input.target_binding_sha256, expires_at: new Date(NOW + 10 * 60_000).toISOString(),
    evidence_ref: "fixture-capability-proof", evidence_sha256: evidenceHash });
  const authorityFor = (input) => {
    const grant = { service: "openrouter", grant_ref: "grant-synthetic", account_ref: "or-workspace-synthetic",
      project_ref: "or-key-synthetic", tenant_id: input.scope.tenant_id, project_id: input.scope.project_id,
      target_binding_sha256: input.target_binding_sha256, operation: input.operation, model: OR_MODEL,
      permission: "allowed", revoked: false, expires_at: new Date(NOW + 10 * 60_000).toISOString(),
      evidence_ref: "fixture-grant-proof", evidence_sha256: evidenceHash };
    const finance = { status: "held", revoked: false, reservation_ref: input.reservation_ref,
      billable_attempt_id: input.billable_attempt_id, budget_scope_id: input.budget_scope_id,
      lease_ref: "finance-lease-synthetic", grant_ref: grant.grant_ref, account_ref: grant.account_ref,
      project_ref: grant.project_ref, tenant_id: grant.tenant_id, project_id: grant.project_id,
      provider: "openrouter", model: OR_MODEL, operation: input.operation, target_binding_sha256: input.target_binding_sha256,
      held_amount: { amount: "1.00", currency: "USD" }, authorized_cap: { amount: "2.00", currency: "USD" },
      expires_at: new Date(NOW + 10 * 60_000).toISOString(), evidence_ref: "fixture-finance-proof", evidence_sha256: evidenceHash };
    return { status: "authorized", revoked: false, grant, finance };
  };
  return {
    capabilityPort: { verify: capabilityFor, revalidate: capabilityFor },
    authorizationPort: { revalidate: authorityFor },
    credentialPort: { async resolveCredential(input) { return {
      status: "resolved", token: CREDENTIAL_CANARY,
      binding: { service: "openrouter", account_ref: input.account_ref, project_ref: input.project_ref,
        grant_ref: input.grant_ref, target_binding_sha256: input.target_binding_sha256 },
      provider_scope: { organization_id: input.account_ref, project_id: input.project_ref },
      expires_at: new Date(NOW + 10 * 60_000).toISOString(),
      evidence: { ref: "fixture-credential-proof", sha256: evidenceHash },
    }; } },
  };
}

/** Explicit MOCK owner profile: exercises the positive OpenRouter path only. It is not Finance acceptance. */
function mockOrUsageProfileAuthority() {
  const profileSha = `sha256:${"b".repeat(64)}`;
  return Object.freeze({
    async mapProviderUsage(input) {
      const raw = input.rawUsage;
      if (input.attempt.provider.name !== "openrouter" || raw.completeness !== "unknown" ||
          JSON.stringify(raw.missing_fields) !== JSON.stringify(["usage.profile_mapping_pending"])) return { status: "unknown" };
      const attempt = input.attempt;
      return { status: "mapped", profile_ref: "mock-owner-profile:openrouter-fixture/1", profile_sha256: profileSha,
        raw_usage_sha256: input.rawUsageSha256, target_binding_sha256: input.targetBindingSha256,
        attempt_binding_sha256: input.attemptBindingSha256,
        observation: { schema_version: "creative.metering.proposal/v1", tenant_id: attempt.tenant_id,
          project_id: attempt.project_id, budget_scope_id: attempt.budget_scope_id,
          logical_operation_id: attempt.logical_operation_id, billable_attempt_id: attempt.billable_attempt_id,
          source_observation_id: input.sourceObservationId, source: "provider_response",
          provider_name: attempt.provider.name, model: attempt.provider.model,
          transport_attempt_id: input.transportAttemptId, environment: attempt.environment,
          billing_mode: attempt.billing_mode, completeness: "complete", missing_fields: [],
          usage_units: [
            { name: "input_tokens", quantity: String(raw.input_tokens), relation: "included_subset", included_in: "total_tokens" },
            { name: "output_tokens", quantity: String(raw.output_tokens), relation: "included_subset", included_in: "total_tokens" },
            { name: "total_tokens", quantity: String(raw.total_tokens), relation: "standalone" },
          ] } };
    },
  });
}

function orResponseWith(bytes, usage = FULL_USAGE) {
  return new Response(JSON.stringify({ created: 1760205600, data: [{ b64_json: bytes.toString("base64"), media_type: "image/png" }],
    ...(usage === undefined ? {} : { usage }) }), { status: 200, headers: { "content-type": "application/json",
    "x-request-id": "raw-request-id-that-must-not-be-used" } });
}

async function seedGeneration(context, actionId = "or-parent-generate") {
  const plan = await jsonFixture("generate-plan");
  plan.base.brief_hash = canonicalHash(context.brief);
  plan.source_refs = ["page-1"];
  plan.steps[0].source_refs = ["page-1"];
  return context.api.invoke(authorizedActor(), apiRequest(actionId, "generate", plan, "page-1"));
}

async function editRequest(context, seed, actionId = "or-reference-edit") {
  const parent = seed.result.design_version;
  const editPlan = await jsonFixture("edit-plan");
  editPlan.base.brief_hash = canonicalHash(context.brief);
  editPlan.base.design_hash = parent.design_hash;
  editPlan.base.design_version_id = parent.design_version_id;
  editPlan.source_refs = ["page-2"];
  editPlan.steps[0].source_refs = ["page-2"];
  editPlan.steps[0].parameters.design_version_id = parent.design_version_id;
  editPlan.steps[0].parameters.artifact_id = parent.artifact.artifact_id;
  editPlan.expected_result.parent_version_id = parent.design_version_id;
  const manifest = { contract: "CreativeImageReferenceManifest", schema_version: "1.0",
    tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id, brief_id: SCOPE.brief_id,
    brief_hash: canonicalHash(context.brief), research_package_id: context.research.package_id,
    research_package_hash: canonicalHash(context.research), base_design_version_id: parent.design_version_id,
    base_design_hash: parent.design_hash,
    references: [{ source_ref: "page-2", asset_id: "asset-2", content_hash: hash(context.referenceBytes),
      media_type: "image/png", width: 16, height: 16 }] };
  return apiRequest(actionId, "edit", editPlan, "page-2", { design_version_id: parent.design_version_id,
    image_reference_manifest: manifest });
}

function assertNoSecrets(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of [CREDENTIAL_CANARY, "Bearer ", ";base64,", "data:image", "raw-request-id-that-must-not-be-used",
    "Synthetic integration prompt"]) {
    assert.ok(!text.includes(secret), `leaked ${secret}`);
  }
}

test("OpenRouter generate then reference edit pass through API, C03, CE08 and CE11 with lineage", async (t) => {
  const context = await setup(t);
  context.outputSequence = 0;
  context.ports.telemetry.usage_profile_authority = mockOrUsageProfileAuthority();
  const posts = [];
  const outputs = [makePng({ width: 16, height: 16 }), makePng({ width: 16, height: 16, transparent: true })];
  const provider = orProvider({ context, fetchImpl: async (url, init) => {
    context.counters.provider_posts += 1;
    posts.push({ url: String(url), init, body: JSON.parse(init.body) });
    return orResponseWith(outputs[posts.length - 1]);
  } });
  context.ports.provider = provider;

  const seed = await seedGeneration(context);
  assert.equal(seed.ok, true, JSON.stringify(seed));
  context.parentVersionId = seed.result.design_version.design_version_id;
  assert.equal(seed.result.design_version.parent_version_id, null);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].url, OR_ENDPOINT);
  assert.equal(posts[0].init.method, "POST");
  assert.equal(posts[0].init.redirect, "error");
  assert.deepEqual(Object.keys(posts[0].init.headers).sort(), ["authorization", "content-type"]);
  assert.equal(Object.hasOwn(posts[0].body, "input_references"), false, "generation never sends references");
  assert.deepEqual(posts[0].body.provider, { only: [OR_PROVIDER_TAG], allow_fallbacks: false });
  assert.equal(seed.result.design_version.artifact.content_hash, hash(outputs[0]));

  const request = await editRequest(context, seed);
  const edited = await context.api.invoke(authorizedActor(), request);
  assert.equal(edited.ok, true, JSON.stringify(edited));
  assert.equal(posts.length, 2);
  const refs = posts[1].body.input_references;
  assert.equal(refs.length, 2, "selected parent first, then exactly the manifest reference");
  assert.deepEqual(Buffer.from(refs[0].image_url.url.split(",")[1], "base64"), outputs[0]);
  assert.deepEqual(Buffer.from(refs[1].image_url.url.split(",")[1], "base64"), context.referenceBytes);
  assert.ok(refs.every((item) => item.type === "image_url" && item.image_url.url.startsWith("data:image/png;base64,")));
  assert.equal(edited.result.design_version.parent_version_id, seed.result.design_version.design_version_id);
  assert.equal(edited.result.design_version.artifact.content_hash, hash(outputs[1]));
  assert.equal(context.counters.reserves, 2);
  assert.equal(context.counters.settlements, 2);
  assert.equal(context.counters.held, 0);

  const versions = context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items;
  assert.equal(versions.length, 2);
  assert.equal(context.store.getSelection({ scope: SCOPE, brief_id: SCOPE.brief_id }).design_version_id,
    edited.result.design_version.design_version_id);

  const dispatches = context.store.db.prepare(`SELECT provider_name,provider_model
    FROM creative_dispatch_intents`).all();
  assert.equal(dispatches.length, 2);
  assert.ok(dispatches.every((row) => row.provider_name === "openrouter" && row.provider_model === OR_MODEL));
  const bindings = context.bindings;
  assert.equal(bindings.length, 2);
  assert.deepEqual(bindings.map((item) => item.operation_kind).sort(), ["image_generation", "image_reference_edit"]);
  assert.ok(bindings.every((item) => item.service === "openrouter" && item.endpoint === OR_ENDPOINT &&
    item.provider_tag === OR_PROVIDER_TAG));

  const usageRows = context.store.db.prepare(`SELECT provider_name,usage_json FROM private_provider_usage_attributions`).all();
  assert.equal(usageRows.length, 2);
  for (const row of usageRows) {
    assert.equal(row.provider_name, "openrouter");
    const usage = JSON.parse(row.usage_json);
    assert.deepEqual(usage.cost, { amount: "0.04", currency: "USD", provenance: "provider_reported_unsettled" });
    assert.deepEqual(usage.missing_fields, ["usage.profile_mapping_pending"]);
  }
  assert.equal(context.store.db.prepare(`SELECT COUNT(*) AS n FROM private_provider_attributions`).get().n, 0,
    "no provider request id exists, so none is fabricated or recorded");

  assert.ok(context.counters.usage_observations.length >= 2);
  assert.ok(context.counters.usage_observations.every((observation) => observation.provider_name === "openrouter"));
  assert.ok(context.counters.usage_observations.every((observation) => !JSON.stringify(observation).includes("cost")),
    "provider-reported cost never becomes a settled valuation");
  const outbox = context.store.db.prepare(`SELECT payload_json FROM creative_telemetry_evidence_outbox_v1`).all();
  assert.ok(outbox.length >= 2);
  assertNoSecrets(outbox);
  assertNoSecrets(context.store.db.prepare(`SELECT result_json,error_json FROM creative_jobs`).all());
  assertNoSecrets(edited);
  assertNoSecrets(seed);

  const replay = await context.api.invoke(authorizedActor(), request);
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(posts.length, 2, "completed replay never repeats the paid request");
});

test("without an accepted usage map OpenRouter output stays unpublished and the C03 hold is retained", async (t) => {
  const context = await setup(t);
  context.outputSequence = 0;
  let posts = 0;
  context.ports.provider = orProvider({ context, fetchImpl: async () => { posts += 1; return orResponseWith(makePng()); } });
  const seed = await seedGeneration(context);
  assert.equal(seed.ok, false);
  assert.equal(posts, 1);
  assert.equal(context.counters.held, 1);
  assert.equal(context.counters.settlements, 0);
  assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
  assertNoSecrets(seed);
});

test("a response without cost cannot be completed by a profile map: the hold is retained", async (t) => {
  const context = await setup(t);
  context.outputSequence = 0;
  context.ports.telemetry.usage_profile_authority = mockOrUsageProfileAuthority();
  context.ports.provider = orProvider({ context, fetchImpl: async () =>
    orResponseWith(makePng(), { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }) });
  const seed = await seedGeneration(context);
  assert.equal(seed.ok, false, "missing cost leaves usage incomplete; it is never treated as zero");
  assert.equal(context.counters.held, 1);
  assert.equal(context.counters.settlements, 0);
  const row = context.store.db.prepare(`SELECT usage_json FROM private_provider_usage_attributions`).get();
  assert.ok(JSON.parse(row.usage_json).missing_fields.includes("usage.cost"));
  assert.equal(Object.hasOwn(JSON.parse(row.usage_json), "cost"), false);
});

test("provider failures through the API retain the hold on unknown and never publish or leak", async (t) => {
  for (const status of [524, 402, 502]) await t.test(`HTTP ${status}`, async (tt) => {
    const context = await setup(tt, { idPrefix: `fail${status}` });
    context.outputSequence = 0;
    let posts = 0;
    context.ports.provider = orProvider({ context, fetchImpl: async () => {
      posts += 1;
      return new Response(JSON.stringify({ error: { code: status, message: `PROVIDER-TEXT ${CREDENTIAL_CANARY}`,
        metadata: { flagged_input: "Synthetic integration prompt" } } }), { status, headers: { "retry-after": "1" } });
    } });
    const seed = await seedGeneration(context);
    assert.equal(seed.ok, false);
    assert.equal(posts, 1, "no automatic retry");
    assert.equal(context.counters.held, 1, "an observed provider failure never releases the C03 hold locally");
    assert.equal(context.counters.settlements, 0);
    assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 0);
    assertNoSecrets(seed);
    assert.ok(!JSON.stringify(seed).includes("PROVIDER-TEXT"));
    assertNoSecrets(context.store.db.prepare(`SELECT result_json,error_json FROM creative_jobs`).all());
    assertNoSecrets(context.store.db.prepare(`SELECT payload_json FROM creative_telemetry_evidence_outbox_v1`).all());
  });
});

test("a generation-only OpenRouter profile denies edit before C03 reservation or any POST", async (t) => {
  const context = await setup(t);
  context.outputSequence = 0;
  context.ports.telemetry.usage_profile_authority = mockOrUsageProfileAuthority();
  let posts = 0;
  const provider = orProvider({ context, profile: { capabilities: { generation: true, edit: false } },
    fetchImpl: async () => { posts += 1; return orResponseWith(makePng()); } });
  context.ports.provider = provider;
  const seed = await seedGeneration(context);
  assert.equal(seed.ok, true, JSON.stringify(seed));
  context.parentVersionId = seed.result.design_version.design_version_id;
  const reservesBefore = context.counters.reserves;
  const denied = await context.api.invoke(authorizedActor(), await editRequest(context, seed));
  assert.equal(denied.ok, false);
  assert.equal(posts, 1, "generation capability never implies edit capability");
  assert.equal(context.counters.reserves, reservesBefore);
  assert.equal(context.store.listDesignVersions({ scope: SCOPE, brief_id: SCOPE.brief_id, limit: 10 }).items.length, 1);
});

test("OpenRouter routes cannot ride an OpenAI adapter identity or endpoint through the runtime fences", async (t) => {
  const context = await setup(t);
  context.outputSequence = 0;
  let posts = 0;
  const provider = orProvider({ context, fetchImpl: async () => { posts += 1; return orResponseWith(makePng()); } });
  for (const mutate of [
    (route) => ({ ...route, provider: { ...route.provider, name: "unlisted-provider" } }),
    (route) => ({ ...route, provider: { ...route.provider, name: "openai" } }),
  ]) {
    context.ports.provider = Object.freeze({ ...provider, resolveRoute: (input) => mutate(provider.resolveRoute(input)) });
    context.ports.telemetry.usage_profile_authority = mockOrUsageProfileAuthority();
    const result = await context.api.invoke(authorizedActor(), apiRequest(`or-mismatch-${posts}-${Math.random()}`, "generate",
      { ...(await jsonFixture("generate-plan")), source_refs: [] }, "page-1"));
    assert.equal(result.ok, false);
  }
  assert.equal(posts, 0, "a mismatched provider identity or endpoint fails before any POST");
});

function installOrConceptAuthority(context, provider) {
  context.ports.provider = provider;
  context.ports.telemetry.usage_profile_authority = mockOrUsageProfileAuthority();
  context.ports.concepts = { resolveTrustedSnapshots(input) {
    const observedAt = Date.parse(input.now);
    const expires = new Date(observedAt + 10 * 60_000).toISOString();
    const deadline = new Date(observedAt + 5 * 60_000).toISOString();
    const { configuration, provider_tag, capabilities } = provider.getConceptConfiguration();
    return { policy_snapshot: { tenant_id: input.scope.tenant_id, project_id: input.scope.project_id,
      brief_id: input.scope.brief_id, policy_ref: "local-concept-policy/1", policy_version: "1",
      evidence_ref: "synthetic-policy-evidence", observed_at: input.now, expires_at: expires, deadline_at: deadline,
      maximum_concept_count: 2, maximum_reference_count: 2, maximum_elapsed_ms: 5 * 60_000,
      maximum_single_reference_bytes: 1_000_000, maximum_aggregate_reference_bytes: 2_000_000,
      budget_scope_id: "budget-api-1", budget_snapshot_ref: "synthetic-budget-snapshot", budget_expires_at: expires },
    adapter_snapshot: { capability_ref: "openrouter-reference-edit-capability/fixture", capability_schema_version: "1.0",
      provider_name: "openrouter", model: OR_MODEL, endpoint: OR_ENDPOINT, provider_operation: "edit",
      operation_mapping_ref: "creative-engine/concepts-to-openrouter-images-reference-edit/1",
      operation_kind: "image_edit", target_ref: "openrouter-reference-edit-target/fixture", sdk_name: "native-fetch",
      provider_tag, capabilities,
      sdk_version: process.versions.node, configuration_ref: "openrouter-image-config/fixture",
      configuration_sha256: canonicalHash(configuration), configuration, prompt_template_ref: "concept-prompt/fixture",
      prompt_template_version: "1", prompt_template_sha256: canonicalHash("Synthetic integration prompt with no model authority.") } };
  } };
}

test("OpenRouter concepts.create sends only the two authorized references and publishes parentless siblings", async (t) => {
  const context = await setup(t);
  context.outputSequence = 0;
  const seed = await (async () => {
    context.ports.provider = undefined;
    return undefined;
  })();
  assert.equal(seed, undefined);
  const outputs = [makePng({ width: 16, height: 16 }), makePng({ width: 16, height: 16, transparent: true })];
  const posts = [];
  const provider = orProvider({ context,
    promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
      template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
      template_sha256: prompt_template.template_sha256 }; } },
    fetchImpl: async (url, init) => {
      context.counters.provider_posts += 1;
      posts.push({ url: String(url), body: JSON.parse(init.body) });
      return orResponseWith(outputs[posts.length - 1]);
    } });
  installOrConceptAuthority(context, provider);
  const request = conceptRequest("or-concept-two-siblings");
  const result = await context.api.invoke(authorizedActor(), request);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.status, "completed");
  assert.equal(result.result.candidates.length, 2);
  assert.equal(posts.length, 2);
  for (const post of posts) {
    assert.equal(post.url, OR_ENDPOINT);
    assert.equal(post.body.input_references.length, 2, "references only: no fabricated parent");
    assert.deepEqual(post.body.input_references.map((item) => hash(Buffer.from(item.image_url.url.split(",")[1], "base64"))),
      [hash(context.referenceAssetBytes.get("asset-1")), hash(context.referenceAssetBytes.get("asset-2"))]);
    assert.deepEqual(post.body.provider, { only: [OR_PROVIDER_TAG], allow_fallbacks: false });
  }
  for (const candidate of result.result.candidates) {
    assert.equal(candidate.design_version.parent_version_id, null);
    assert.equal(candidate.creative_concept_lineage.parent_version_id, null);
    assert.equal(candidate.creative_concept_lineage.adapter_snapshot.provider_name, "openrouter");
  }
  const bindings = context.store.db.prepare(`SELECT target_binding_json FROM creative_concept_dispatch_bindings_v1`).all()
    .map((row) => JSON.parse(row.target_binding_json));
  assert.equal(bindings.length, 2);
  assert.ok(bindings.every((item) => item.service === "openrouter" && item.operation_kind === "image_reference_edit" &&
    item.edit_semantics === "reference_guided"));
  assertNoSecrets(result);
  assertNoSecrets(context.store.db.prepare(`SELECT payload_json FROM creative_telemetry_evidence_outbox_v1`).all());
  const replay = await context.api.invoke(authorizedActor(), request);
  assert.equal(replay.replayed, true);
  assert.equal(posts.length, 2);
});

test("re-pinning the provider tag or capabilities invalidates an owner-approved concept snapshot", async (t) => {
  const context = await setup(t);
  context.outputSequence = 0;
  let posts = 0;
  const handler = async () => { posts += 1; return orResponseWith(makePng()); };
  const approved = orProvider({ context, fetchImpl: handler,
    promptPort: { async render({ prompt_template }) { return { prompt: "Synthetic integration prompt with no model authority.",
      template_ref: prompt_template.template_ref, template_version: prompt_template.template_version,
      template_sha256: prompt_template.template_sha256 }; } } });
  installOrConceptAuthority(context, approved);
  const approvedSnapshots = context.ports.concepts.resolveTrustedSnapshots;
  for (const [name, profile] of [["provider tag", { provider_tag: "re-pinned-provider" }],
    ["capabilities", { capabilities: { generation: true, edit: { max_input_references: 5 } } }]]) {
    const repinned = orProvider({ context, fetchImpl: handler, profile,
      promptPort: { async render() { return "unused"; } } });
    context.ports.provider = repinned;
    context.ports.concepts = { resolveTrustedSnapshots: approvedSnapshots };
    const result = await context.api.invoke(authorizedActor(), conceptRequest(`or-repin-${name.replace(" ", "-")}`));
    assert.equal(result.ok, false, name);
    assert.equal(result.error.code, "unavailable", name);
  }
  assert.equal(posts, 0, "a re-pinned route never reaches the provider");
  assert.equal(context.counters.reserves, 0);
});
