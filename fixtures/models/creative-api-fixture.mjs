// Repository-local, synthetic-only fixture composition. No production package export.
// Shared with the actual API integration suite; this module does not contact a provider.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCreativeApi } from "creative-engine/api/v1";
import { canonicalHash, normalizeResearchPackage, validateCreativeBrief } from "creative-engine/contracts";
import { createOpenAIImagesProvider } from "creative-engine/models";
import { createCreativeVersionApiPorts, CreativeVersionStore } from "creative-engine/versions";
import { createSqliteTelemetryOutbox, USAGE_PROFILE } from "creative-engine/telemetry";
import { completeResearchPackage } from "../planning/research-packages.mjs";
import { makePng } from "./png.mjs";

export const NOW = Date.parse("2026-10-10T18:00:00.000Z");
export const MODEL = "gpt-image-2.5-sunburst-2026-09-08";
export const NATIVE_FIXTURE_CONFIGURATION = Object.freeze({ quality: "low", size: "16x16",
  output_format: "png", background: "opaque", moderation: "auto" });
export const SCOPE = Object.freeze({ tenant_id: "tenant-api-1", project_id: "project-api-1", brief_id: "brief-api-1" });

export const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export async function jsonFixture(path) {
  return JSON.parse(await readFile(new URL(`../../fixtures/api/${path}.json`, import.meta.url), "utf8"));
}

export function authorizedActor() {
  return { actor_id: "actor-api-1", tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    expires_at: "2026-10-11T00:00:00.000Z",
    permissions: ["creative.generate", "creative.edit", "creative.read", "creative.restore", "creative.cancel"],
    budget_scope_id: "budget-api-1", budget_policy_version: "budget-policy/1" };
}

export function apiRequest(actionId, operation, plan, sourceRef, payload = {}) {
  const occurred = "2026-10-10T12:20:00.000Z";
  return { contract: "CreativeApiRequest", schema_version: "1.0", event_id: `event-${actionId}`,
    request_id: `request-${actionId}`, tenant_id: SCOPE.tenant_id, project_id: SCOPE.project_id,
    correlation_id: `correlation-${actionId}`, producer: "creative-image-api-integration",
    occurred_at: occurred, ingested_at: occurred, environment: "test", billing_mode: "simulated",
    source_refs: [sourceRef], operation, action_id: actionId,
    payload: { brief_id: SCOPE.brief_id, plan, ...payload } };
}

export function authorityPorts() {
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

async function setup(t, { root: suppliedRoot, initialNow = NOW, idPrefix = "api", sameSourcePage = false,
  compositionLogo = false, leaseDurationMs = 60_000 } = {}) {
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
  if (compositionLogo) researchInput.permissions.items.push({ asset_id: "asset-2", action: "display", status: "granted",
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
    ...(compositionLogo ? [{ asset_id: "asset-2", action: "display", status: "granted", evidence_refs: [asset2SourcePage] }] : []),
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
  const adapted = createCreativeVersionApiPorts({ store, idFactory: () => `${idPrefix === "api" ? "version-port" : `${idPrefix}-version-port`}-${++id}`, leaseDurationMs,
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

export function createNativeProvider({ referenceAssetBytes, store, fetchImpl, authorityOverrides = {}, promptPort,
  readArtifact, idFactory = () => "artifact-native-image-output" }) {
  if (typeof fetchImpl !== "function") throw new TypeError("An explicit intercepted fetch fixture is required; there is no network fallback.");
  return createOpenAIImagesProvider({
    model_id: MODEL,
    configuration: NATIVE_FIXTURE_CONFIGURATION,
    ...authorityPorts(),
    ...authorityOverrides,
    promptPort: promptPort ?? { async render() { return "Synthetic integration prompt with no model authority."; } },
    assetPort: {
      readArtifact: readArtifact ?? (async (input) => store.getArtifactBytes({
        scope: { ...input.scope, brief_id: SCOPE.brief_id }, brief_id: SCOPE.brief_id,
        design_version_id: "design-image-parent-1" })),
      async readReference(input) { return referenceAssetBytes.get(input.asset_id); },
    },
    fetchImpl,
    now: () => NOW,
    idFactory,
  });
}

export function mockOwnerUsageProfileAuthority({ transformResult = (result) => result, beforeMap } = {}) {
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

/** Owns its temporary SQLite/object directory. Always await close(), including on failure.
 * A supplied root remains caller-owned; close() only closes this fixture's store.
 * All authority, credential, permission and Finance ports are synthetic fixtures.
 */
export async function createCreativeApiFixture(options = {}) {
  const cleanups = [];
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    for (const cleanup of cleanups.toReversed()) await cleanup();
  };
  try {
    const context = await setup({ after: (cleanup) => cleanups.push(cleanup) }, options);
    return { ...context, close };
  } catch (error) {
    await close();
    throw error;
  }
}
