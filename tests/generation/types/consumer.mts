import {
  applyCreativeConceptEvent,
  createCreativeConceptBatchProposal,
  inspectCreativeConceptImageBytes,
  replayCreativeConceptBatch,
} from "../../../src/generation/concepts.mjs";
import type {
  CreativeConceptBatchEvent,
  CreativeConceptBatchProposal,
  CreativeConceptBatchProposalInput,
} from "../../../src/generation/concepts.mjs";
import type { MeteredAttemptRequest } from "../../../src/contracts/metering.mjs";

declare const input: CreativeConceptBatchProposalInput;
declare const batch: CreativeConceptBatchProposal;
declare const event: CreativeConceptBatchEvent;
declare const upstreamMeteredAttempt: MeteredAttemptRequest;

const created = createCreativeConceptBatchProposal(input);
const updated = applyCreativeConceptEvent(created, event);
const replayed = replayCreativeConceptBatch(updated.batch, { trusted_scope: input.trusted_scope, request: input.request });
const rejectedArtifact = applyCreativeConceptEvent(created, {
  tenant_id: created.tenant_id,
  project_id: created.project_id,
  action_id: created.action_id,
  batch_id: created.batch_id,
  concept_id: created.slots[0].concept_id,
  event_id: "artifact-rejection-event",
  event_type: "artifact_rejected",
  billable_attempt_id: "billable-attempt",
  transport_attempt_id: "transport-attempt",
  artifact_sha256: `sha256:${"a".repeat(64)}`,
  failure_code: "image_inspection_failed",
  inspection_evidence_ref: "native-inspection-evidence",
});
const imageCheck = inspectCreativeConceptImageBytes({
  bytes: new Uint8Array([1]),
  expected_media_type: "image/png",
  maximum_bytes: 100,
  expected_dimensions: { width: 1, height: 1 },
});
const policyScope = [
  batch.policy_snapshot.tenant_id.toUpperCase(),
  batch.policy_snapshot.project_id.toUpperCase(),
  batch.policy_snapshot.brief_id.toUpperCase(),
];
const outputLineage = batch.slots[0].output_lineage;
if (outputLineage !== null) {
  const designVersionId: string = outputLineage.design_version_id;
  const artifactId: string = outputLineage.artifact_id;
  const artifactHash: `sha256:${string}` = outputLineage.artifact_sha256;
  const artifactMediaType: "image/png" | "image/jpeg" | "image/webp" = outputLineage.artifact_media_type;
  void [designVersionId, artifactId, artifactHash, artifactMediaType];
}

upstreamMeteredAttempt.provider.model = "mutable-input-contract-control";
upstreamMeteredAttempt.provider.sdk.name = "mutable-input-contract-control";
upstreamMeteredAttempt.budget.policy_version = "mutable-input-contract-control";

// @ts-expect-error stored attempt snapshots expose deeply readonly provider fields
batch.slots[0].attempts[0].metering_attempt.provider.model = "changed";
// @ts-expect-error nested SDK fields are readonly too
batch.slots[0].attempts[0].metering_attempt.provider.sdk.name = "changed";
// @ts-expect-error nested budget fields are readonly too
batch.slots[0].attempts[0].metering_attempt.budget.policy_version = "changed";

void batch;
void rejectedArtifact;
void replayed;
void imageCheck;
void policyScope;
