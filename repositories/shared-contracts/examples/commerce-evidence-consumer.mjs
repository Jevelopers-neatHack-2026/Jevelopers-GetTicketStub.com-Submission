import assert from 'node:assert/strict';
import { checkCommerceEvidence, projectEvaluationEvidence } from '@jevelopers/shared-contracts/commerce-evidence';
import approval from '@jevelopers/shared-contracts/fixtures/ApprovalReceipt.json' with { type: 'json' };
import handoff from '@jevelopers/shared-contracts/fixtures/ArtifactHandoffManifest.json' with { type: 'json' };
import auth from '@jevelopers/shared-contracts/fixtures/OrderAuthorization.json' with { type: 'json' };
import evidence from '@jevelopers/shared-contracts/fixtures/EvaluationEvidence.json' with { type: 'json' };
const serverScope = { tenant_id: '123e4567-e89b-42d3-a456-426614174000', project_id: '123e4567-e89b-42d3-a456-426614174000' };
function context(fixture) {
  const server = structuredClone(fixture.cases.find(c => c.id === 'semantic-positive').context);
  server.scope = serverScope;
  if (server.artifact_bytes) server.artifact_bytes = Object.fromEntries(Object.entries(server.artifact_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
  return server;
}
assert.equal(checkCommerceEvidence('ApprovalReceipt', approval.valid, context(approval)).ok, true);
const revoked = context(approval); revoked.current_approval.status = 'revoked';
assert.equal(checkCommerceEvidence('ApprovalReceipt', approval.valid, revoked).ok, false);
assert.equal(checkCommerceEvidence('ArtifactHandoffManifest', handoff.valid, context(handoff)).ok, true);
const wrongBytes = context(handoff); wrongBytes.artifact_bytes[handoff.valid.artwork.artifact_id] = Uint8Array.from([0, 0, 0]);
assert.equal(checkCommerceEvidence('ArtifactHandoffManifest', handoff.valid, wrongBytes).ok, false);
assert.equal(checkCommerceEvidence('OrderAuthorization', auth.valid, context(auth)).ok, true);
assert.equal(checkCommerceEvidence('OrderAuthorization', { ...auth.valid, terms: { ...auth.valid.terms, quantity: auth.valid.terms.quantity + 1 } }, context(auth)).ok, false);
assert.equal(checkCommerceEvidence('OrderAuthorization', { ...auth.valid, tenant_id: '123e4567-e89b-42d3-a456-000000000999' }, context(auth)).ok, false);
const projected = projectEvaluationEvidence(evidence.valid, context(evidence));
assert.equal(projected.ok, true);
if (!projected.ok) throw new Error('Projection did not parse');
assert.deepEqual(Object.keys(projected.value).sort(), ['billing_mode', 'component', 'contract', 'environment', 'evidence_id', 'outcome', 'policy_version', 'schema_version'].sort());
assert.equal(Object.hasOwn(projected.value, 'artifacts'), false);
console.log(JSON.stringify({ status: 'passed', node: process.version, dependency_mode: 'offline_installed_commerce_evidence', provider_calls: 0, cases: ['current_approval', 'revocation', 'exact_handoff_bytes', 'exact_purchase_terms', 'forged_scope', 'allowlisted_evidence'] }));
