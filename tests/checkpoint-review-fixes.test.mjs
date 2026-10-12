import test from 'node:test';
import assert from 'node:assert/strict';
import { readJson } from '../scripts/generate.mjs';
import { fixturePayload, assertFixture } from '../tooling/fixture-harness.mjs';
import { checkCommerceEvidence, commerceContentHash, projectEvaluationEvidence, checkResearchCreative, hashManifest, canonicalJson } from '../generated/index.mjs';
import { dependencyErrors, dependencyNumbers, deliverableGraph, graphErrors } from '../scripts/dependency-map.mjs';

async function positive(name) {
  const fixture = await readJson('fixtures/' + name + '.json');
  const row = fixture.cases.find(row => ['commerce_evidence', 'research_creative'].includes(row.mode) && row.expected.ok);
  const context = structuredClone(row.context);
  if (context.artifact_bytes) context.artifact_bytes = Object.fromEntries(Object.entries(context.artifact_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
  return { value: fixturePayload(fixture, row), context };
}
for (const mutation of ['display_only', 'approval_identity', 'subject_identity', 'subject_revision', 'preview_identity', 'facts_identity', 'composition']) test('SC-CHK-003 rejects consumption approval substitution ' + mutation, async () => {
  const { value, context } = await positive('ArtifactConsumptionReceipt');
  const approval = context.current_approval.receipt;
  if (mutation === 'display_only') approval.binding.intended_use = 'design_preview';
  if (mutation === 'approval_identity') { approval.approval_id = '123e4567-e89b-42d3-a456-000000019001'; value.approval_ref.id = approval.approval_id; }
  if (mutation === 'subject_identity') approval.binding.subject_ref.id = '123e4567-e89b-42d3-a456-000000019002';
  if (mutation === 'subject_revision') approval.binding.subject_ref.revision++;
  if (mutation === 'preview_identity') approval.binding.preview_ref.id = '123e4567-e89b-42d3-a456-000000019003';
  if (mutation === 'facts_identity') approval.binding.facts_ref.id = '123e4567-e89b-42d3-a456-000000019004';
  if (mutation === 'composition') approval.binding.composition_hash = 'sha256:' + '9'.repeat(64);
  approval.receipt_hash = commerceContentHash(approval, 'receipt_hash');
  context.expected_binding = structuredClone(approval.binding);
  value.approval_ref.content_hash = approval.receipt_hash; context.references.approval_ref = structuredClone(value.approval_ref);
  assertFixture(checkCommerceEvidence(value.contract, value, context), { ok: false, code: 'STALE_APPROVAL', path: '/approval_ref' });
});
test('SC-CHK-003 preserves exact valid and duplicate consumption without mutation', async () => {
  const { value, context } = await positive('ArtifactConsumptionReceipt');
  const before = canonicalJson(value);
  assert.equal(checkCommerceEvidence(value.contract, value, context).ok, true);
  context.prior_consumption = structuredClone(value);
  assert.equal(checkCommerceEvidence(value.contract, value, context).ok, true);
  assert.equal(canonicalJson(value), before);
});
function nextStatus(prior, status, number) {
  return { ...structuredClone(prior), revision: prior.revision + 1, event_id: '123e4567-e89b-42d3-a456-' + String(number).padStart(12, '0'), source_observation_id: '123e4567-e89b-42d3-a456-' + String(number + 1).padStart(12, '0'), provider_status: status, normalized_status: status };
}
for (const intermediate of ['unknown', 'cancel_requested', 'cancel_rejected']) test('SC-CHK-004 carries shipped progress through ' + intermediate, async () => {
  const { value, context } = await positive('FulfillmentStatus');
  Object.assign(context.status_mapping, { shipped: 'shipped', accepted: 'accepted', fulfilled: 'fulfilled', unknown: 'unknown', cancel_requested: 'cancel_requested', cancel_rejected: 'cancel_rejected' });
  Object.assign(value, { normalized_status: 'shipped', provider_status: 'shipped', last_known_status: 'shipped' });
  assert.equal(checkCommerceEvidence(value.contract, value, context).ok, true);
  const middle = nextStatus(value, intermediate, 19020); middle.last_known_status = 'shipped';
  if (intermediate === 'cancel_requested') middle.cancellation = 'requested';
  if (intermediate === 'cancel_rejected') middle.cancellation = 'rejected';
  assert.equal(checkCommerceEvidence(value.contract, middle, { ...context, prior_status: value }).ok, true);
  const regression = nextStatus(middle, 'accepted', 19030); regression.last_known_status = 'accepted';
  assertFixture(checkCommerceEvidence(value.contract, regression, { ...context, prior_status: middle }), { ok: false, code: 'INVALID_TRANSITION', path: '/normalized_status' });
  const forward = nextStatus(middle, 'fulfilled', 19040); forward.last_known_status = 'fulfilled';
  assert.equal(checkCommerceEvidence(value.contract, forward, { ...context, prior_status: middle }).ok, true);
  const forgotten = nextStatus(middle, 'unknown', 19050); forgotten.last_known_status = 'accepted';
  assertFixture(checkCommerceEvidence(value.contract, forgotten, { ...context, prior_status: middle }), { ok: false, code: 'INVALID_TRANSITION', path: '/last_known_status' });
});
for (const field of ['contract', 'id', 'content_hash']) test('SC-CHK-005 exact research request reference ' + field, async () => {
  const { value, context } = await positive('ResearchAnswerReceipt');
  assert.equal(checkResearchCreative(value.contract, value, context).ok, true);
  value.request_ref[field] = field === 'contract' ? 'ResearchCorrectionRequest' : field === 'id' ? '123e4567-e89b-42d3-a456-000000019060' : 'sha256:' + '9'.repeat(64);
  context.references.request_ref = structuredClone(value.request_ref);
  assertFixture(checkResearchCreative(value.contract, value, context), { ok: false, code: 'INVALID_RECEIPT', path: '/request_ref' });
});
for (const invalid of [null, false, 1, 'not-a-receipt', {}, []]) test('SC-CHK-006 malformed receipt element ' + JSON.stringify(invalid), async () => {
  const { value, context } = await positive('ResearchBatchReceipt');
  context.request_receipts = [invalid];
  assertFixture(checkResearchCreative(value.contract, value, context), { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/request_receipts' });
});
test('SC-CHK-006 missing collection rejects and valid membership still passes', async () => {
  const { value, context } = await positive('ResearchBatchReceipt');
  assert.equal(checkResearchCreative(value.contract, value, context).ok, true);
  delete context.request_receipts;
  assertFixture(checkResearchCreative(value.contract, value, context), { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/request_receipts' });
});
test('SC-CHK-007 separate public ID never exposes the restricted operational ID', async () => {
  const { value, context } = await positive('EvaluationEvidence');
  const projection = projectEvaluationEvidence(value, context);
  assert.equal(projection.ok, true);
  assert.equal(projection.value.evidence_id, context.public_evidence_id);
  assert.ok(!JSON.stringify(projection).includes(value.evidence_id));
});
for (const invalid of ['missing', 'reused', 'not-a-uuid']) test('SC-CHK-007 rejects ' + invalid + ' public ID', async () => {
  const { value, context } = await positive('EvaluationEvidence');
  if (invalid === 'missing') delete context.public_evidence_id;
  else context.public_evidence_id = invalid === 'reused' ? value.evidence_id : invalid;
  assertFixture(projectEvaluationEvidence(value, context), { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/public_evidence_id' });
});
test('SC-CHK-008 complete issue/body-hash authority agrees with dependency data and executable stages', async () => {
  const requirements = await readJson('docs/requirements.json'), authority = await readJson('docs/authority-dependencies.json');
  assert.deepEqual(dependencyErrors(requirements, authority), []);
  assert.deepEqual(requirements.issues.find(row => row.issue === 4).dependencies, [5]);
  assert.deepEqual(requirements.issues.find(row => row.issue === 3).closure_dependencies, Array.from({ length: 27 }, (_, index) => index + 4));
  const nodes = deliverableGraph(requirements);
  assert.deepEqual(graphErrors(nodes), []);
  assert.deepEqual(nodes.find(node => node.id === '4:inventory-inspection').requires, []);
  assert.deepEqual(nodes.find(node => node.id === '5:toolchain-implementation').requires, ['4:inventory-toolchain-agreement']);
  assert.deepEqual(nodes.find(node => node.id === '4:machine-inventory-verification').requires, ['5:toolchain-implementation']);
  const broken = structuredClone(requirements); broken.issues.find(row => row.issue === 4).dependencies = [];
  assert.ok(dependencyErrors(broken, authority).some(row => row.issue === 4 && row.code === 'AUTHORITATIVE_DEPENDENCY_MISMATCH'));
  const aggregate = structuredClone(requirements); aggregate.issues.find(row => row.issue === 3).closure_dependencies.pop();
  assert.ok(dependencyErrors(aggregate, authority).some(row => row.issue === 3));
  for (const source of authority.issues) assert.deepEqual(dependencyNumbers(source.blocked_by_source), requirements.issues.find(row => row.issue === source.issue).dependencies);
});

for (const field of ['run_id', 'event_id', 'correlation_id']) test('public evaluation projection rejects source identifier ' + field, async () => {
  const { value, context } = await positive('EvaluationEvidence');
  assert.equal(typeof value[field], 'string');
  context.public_evidence_id = value[field];
  assertFixture(projectEvaluationEvidence(value, context), { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/public_evidence_id' });
});

test('dependency authority cannot omit an issue even when its requirement edges are removed', async () => {
  const requirements = await readJson('docs/requirements.json'), authority = await readJson('docs/authority-dependencies.json');
  authority.issues = authority.issues.filter(row => row.issue !== 9);
  Object.assign(requirements.issues.find(row => row.issue === 9), { dependencies: [], artifact_dependencies: [], closure_dependencies: [] });
  assert.ok(dependencyErrors(requirements, authority).some(row => row.code === 'AUTHORITY_ISSUE_SET_MISMATCH'));
});

test('dependency authority rejects extra and duplicate issue entries', async () => {
  const requirements = await readJson('docs/requirements.json'), authority = await readJson('docs/authority-dependencies.json');
  for (const issue of [9, 999]) {
    const modified = structuredClone(authority);
    modified.issues.push({ ...modified.issues[0], issue });
    assert.ok(dependencyErrors(requirements, modified).some(row => row.code === 'AUTHORITY_ISSUE_SET_MISMATCH'));
  }
});

test('research batch returns typed failure for a throwing receipt Proxy', async () => {
  const { value, context } = await positive('ResearchBatchReceipt');
  context.request_receipts = [new Proxy({}, { ownKeys() { throw new Error('untrusted object trap'); } })];
  assertFixture(checkResearchCreative(value.contract, value, context), { ok: false, code: 'INVALID_TRUST_CONTEXT', path: '/request_receipts' });
});
