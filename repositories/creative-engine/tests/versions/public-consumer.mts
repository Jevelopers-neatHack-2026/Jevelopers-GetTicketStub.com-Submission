import { createCreativeApi } from "creative-engine/api/v1";
import { createCreativeVersionApiPorts, CreativeVersionStore, VersionStoreError } from "creative-engine/versions";
import type { CreativeApiRequest, TrustedCreativeActor, DesignSelection, CreativeContextFence,
  CreativeRuntimePorts, CreativeVersionCreationEvidence } from "creative-engine/api/v1";
import type { DesignVersion } from "creative-engine/contracts/creative/v1";
import type { VersionScope, VersionSelectionInput } from "creative-engine/versions";
import type { CreativeVersionRuntimeStorage } from "creative-engine/versions";

const store = new CreativeVersionStore({ databasePath: "/tmp/creative-versions.sqlite", objectRoot: "/tmp/creative-objects" });
const paired = createCreativeVersionApiPorts({ store, idFactory: () => "public-consumer-id" });
const api = createCreativeApi({ ports: paired.ports });
const actor: TrustedCreativeActor = {
  actor_id: "actor-public", tenant_id: "tenant-public", project_id: "project-public",
  expires_at: "2026-10-11T00:00:00.000Z", permissions: ["creative.read"],
  budget_scope_id: "budget-public", budget_policy_version: "budget/1",
};
const request: CreativeApiRequest = {
  contract: "CreativeApiRequest", schema_version: "1.0", event_id: "event-public", request_id: "request-public",
  tenant_id: "tenant-public", project_id: "project-public", correlation_id: "correlation-public",
  producer: "public-consumer", occurred_at: "2026-10-10T12:00:00.000Z", ingested_at: "2026-10-10T12:00:00.000Z",
  environment: "test", billing_mode: "simulated", source_refs: [], operation: "job.status", payload: { job_id: "job-public" },
};
void api.invoke(actor, request);
const publicError = new VersionStoreError("unavailable", "handoff.durable_result_staging", true);
const readSelection = (selection: DesignSelection) => selection.design_hash;
void readSelection;
void publicError;
const scope: VersionScope = { tenant_id: "tenant-public", project_id: "project-public", brief_id: "brief-public" };
const selection: VersionSelectionInput = { mode: "advance", expected_revision: 0,
  expected_selected_design_version_id: null, expected_selected_design_hash: null };
void scope;
void selection;

const publicationFence: CreativeContextFence = {
  brief_id: "brief-public",
  brief_hash: `sha256:${"a".repeat(64)}`,
  expected_current_design_version_id: null,
  expected_current_design_hash: null,
  inspection_rights: { proofs: [{ asset_id: "asset-public", action: "modify", source_ref: "source-public",
    content_hash: `sha256:${"b".repeat(64)}`, package_id: "package-public",
    package_hash: `sha256:${"c".repeat(64)}`, checked_at: 1, expires_at: 60_000 }] },
  inspection_repair: { inspection_id: "inspection-public", action_id: "action-public",
    request_hash: `sha256:${"d".repeat(64)}`, claim_ref: `sha256:${"e".repeat(64)}`,
    root_brief_hash: `sha256:${"a".repeat(64)}`, root_design_hash: `sha256:${"f".repeat(64)}`,
    root_design_version_id: "design-root-public", started_at_ms: 1, deadline_at_ms: 60_001,
    simulated_units_milli: 1_000, result_hash: `sha256:${"9".repeat(64)}` },
};
type RuntimePrepareInput = Parameters<NonNullable<NonNullable<CreativeRuntimePorts["storage"]>["prepareDesignVersion"]>>[0];
type VersionPrepareInput = Parameters<CreativeVersionRuntimeStorage["prepareDesignVersion"]>[0];
const prepareIdentity = { tenant_id: "tenant-public", project_id: "project-public" } as const;
const runtimePrepareInput: RuntimePrepareInput = {
  scope: prepareIdentity, brief_id: "brief-public", design_version: {} as DesignVersion,
  artifact_bytes: new Uint8Array(), selection_mode: "advance", creation: {} as CreativeVersionCreationEvidence,
  lease_token: "lease-public", job_result: {}, publication_fence: publicationFence,
  expected_brief_hash: `sha256:${"a".repeat(64)}`, expected_current_design_version_id: null,
  expected_current_design_hash: null, expected_parent_design_version_id: null, expected_parent_design_hash: null,
};
const versionPrepareInput: VersionPrepareInput = {
  ...runtimePrepareInput,
  publication_fence: publicationFence,
};
const readRecoveryAuthority = (input: VersionPrepareInput) => ({
  rootClaim: input.publication_fence.inspection_repair?.claim_ref,
  rightsExpiry: input.publication_fence.inspection_rights?.proofs[0]?.expires_at,
});
void readRecoveryAuthority(runtimePrepareInput);
void readRecoveryAuthority(versionPrepareInput);

// Internal transaction minting must not be part of the public declaration.
// @ts-expect-error publication transactions are created only by the paired adapter
store.createPublicationTransaction({});

// Unknown adapter options remain rejected by the public type surface.
// @ts-expect-error lease duration is bounded by the durable adapter contract
createCreativeVersionApiPorts({ store, inMemoryOnly: true });
