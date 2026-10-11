import type { CreativeConceptBatchProposal } from "../../../src/generation/concepts.mjs";

export function readPolicyScope(batch: CreativeConceptBatchProposal): readonly string[] {
  return [
    batch.policy_snapshot.tenant_id.toUpperCase(),
    batch.policy_snapshot.project_id.toUpperCase(),
    batch.policy_snapshot.brief_id.toUpperCase(),
  ];
}
