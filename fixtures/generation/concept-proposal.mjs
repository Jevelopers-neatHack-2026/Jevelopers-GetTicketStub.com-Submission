import { canonicalHash } from "../../src/contracts/validation.mjs";
import { validateResearchPackage } from "../../src/contracts/creative/v1.mjs";
import { buildCreativeBrief } from "../../src/planning/index.mjs";
import { hashArtifactBytes } from "../../src/storage/content-addressed.mjs";
import { completeResearchPackage } from "../planning/research-packages.mjs";
import { makePng } from "../models/png.mjs";

export const FIXTURE_NOW = "2026-10-10T18:00:00.000Z";
export const FIXTURE_SCOPE = Object.freeze({
  tenant_id: "tenant-concept-fixture",
  project_id: "project-concept-fixture",
});

export function conceptReferenceBytes() {
  return Object.freeze([
    makePng({ width: 16, height: 16 }),
    makePng({ width: 17, height: 16, transparent: true }),
  ]);
}

export function conceptReferencePackage() {
  const [first, second] = conceptReferenceBytes();
  const research = completeResearchPackage();
  research.tenant_id = FIXTURE_SCOPE.tenant_id;
  research.project_id = FIXTURE_SCOPE.project_id;
  research.package_id = "concept-reference-package-fixture";
  research.event_id = "concept-reference-package-event-fixture";
  research.assets = {
    presence: "present",
    items: [
      { asset_id: "asset-concept-one", source_id: "page-1", content_hash: hashArtifactBytes(first), media_type: "image/png" },
      { asset_id: "asset-concept-two", source_id: "page-1", content_hash: hashArtifactBytes(second), media_type: "image/png" },
    ],
  };
  research.permissions = {
    presence: "present",
    items: [
      { asset_id: "asset-concept-one", action: "reproduce", status: "granted", evidence_refs: ["page-1"] },
      { asset_id: "asset-concept-two", action: "reproduce", status: "granted", evidence_refs: ["page-1"] },
    ],
  };
  research.source_refs = ["page-1", "asset-concept-one", "asset-concept-two"];
  return research;
}

export function conceptProposalInput(overrides = {}) {
  const research = conceptReferencePackage();
  const trustedScope = { ...FIXTURE_SCOPE, brief_id: "brief-concept-fixture" };
  const briefPlan = buildCreativeBrief({
    trusted_scope: FIXTURE_SCOPE,
    research_package: research,
    context: { created_at: FIXTURE_NOW, environment: "test", billing_mode: "simulated" },
  });
  const brief = { ...briefPlan.brief, brief_id: trustedScope.brief_id };
  const normalizedPackage = validateResearchPackage(research, trustedScope);
  const packageHash = canonicalHash(normalizedPackage);
  brief.research_package_ref = {
    ...brief.research_package_ref,
    package_id: normalizedPackage.package_id,
    content_hash: packageHash,
  };
  const configuration = Object.freeze({
    quality: "low",
    size: "16x16",
    output_format: "png",
    background: "opaque",
    moderation: "auto",
  });
  const input = {
    trusted_scope: trustedScope,
    now: FIXTURE_NOW,
    brief,
    brief_sha256: canonicalHash(brief),
    research_package: normalizedPackage,
    request: {
      action_id: "action-concept-fixture",
      brief_id: trustedScope.brief_id,
      plan_id: "plan-concept-fixture",
      requested_count: 2,
      references: [
        { asset_id: "asset-concept-one", role_ref: "role-ref-fixture-one" },
        { asset_id: "asset-concept-two", role_ref: "role-ref-fixture-two" },
      ],
    },
    permission_evidence: normalizedPackage.assets.items.map((asset, index) => ({
      status: "granted",
      tenant_id: trustedScope.tenant_id,
      project_id: trustedScope.project_id,
      asset_id: asset.asset_id,
      content_hash: asset.content_hash,
      action: "reproduce",
      package_id: normalizedPackage.package_id,
      package_hash: packageHash,
      owner_evidence_status: "verified",
      evidence_ref: `fixture-permission-evidence-${index + 1}`,
      checked_at: FIXTURE_NOW,
      expires_at: "2026-10-10T19:00:00.000Z",
    })),
    policy_snapshot: {
      tenant_id: trustedScope.tenant_id,
      project_id: trustedScope.project_id,
      brief_id: trustedScope.brief_id,
      policy_ref: "fixture-concept-policy-ref",
      policy_version: "fixture-policy-proposal-v1",
      evidence_ref: "fixture-policy-evidence-ref",
      observed_at: FIXTURE_NOW,
      expires_at: "2026-10-10T19:00:00.000Z",
      deadline_at: "2026-10-10T18:00:30.000Z",
      maximum_concept_count: 2,
      maximum_reference_count: 2,
      maximum_elapsed_ms: 30_000,
      maximum_single_reference_bytes: 1_000_000,
      maximum_aggregate_reference_bytes: 2_000_000,
      budget_scope_id: "fixture-budget-scope",
      budget_snapshot_ref: "fixture-budget-snapshot-ref",
      budget_expires_at: "2026-10-10T18:30:00.000Z",
    },
    adapter_snapshot: {
      capability_ref: "fixture-openai-concept-edit-capability-proposal",
      capability_schema_version: "0.1.0",
      provider_name: "openai",
      model: "fixture-explicit-model-ref",
      endpoint: "https://api.openai.com/v1/images/edits",
      provider_operation: "edit",
      operation_mapping_ref: "fixture-concept-native-edit-to-c03-mapping-proposal",
      operation_kind: "image_edit",
      target_ref: "fixture-explicit-target-ref",
      sdk_name: "native-fetch",
      sdk_version: "fixture-node-runtime",
      configuration_ref: "fixture-configuration-ref",
      configuration_sha256: canonicalHash(configuration),
      configuration,
      prompt_template_ref: "fixture-prompt-template-ref",
      prompt_template_version: "fixture-prompt-template-v1",
      prompt_template_sha256: `sha256:${"c".repeat(64)}`,
    },
  };
  return { ...input, ...overrides };
}
