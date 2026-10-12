import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { createCreativeConceptBatchProposal } from "../../../src/generation/concepts.mjs";
import { conceptProposalInput } from "../../../fixtures/generation/concept-proposal.mjs";

const consumerModulePath = process.argv[2];
assert.ok(consumerModulePath, "compiled strict consumer path is required");
const { readPolicyScope } = await import(pathToFileURL(consumerModulePath).href);
const batch = createCreativeConceptBatchProposal(conceptProposalInput());
assert.deepEqual(readPolicyScope(batch), [
  batch.tenant_id.toUpperCase(),
  batch.project_id.toUpperCase(),
  batch.brief_id.toUpperCase(),
]);
console.log(JSON.stringify({
  status: "compiled_consumer_observed_policy_scope",
  tenant_id: batch.policy_snapshot.tenant_id,
  project_id: batch.policy_snapshot.project_id,
  brief_id: batch.policy_snapshot.brief_id,
}));
