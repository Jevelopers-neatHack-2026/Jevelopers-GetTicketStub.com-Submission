import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { projectInspectionPresentation, prepareInspectionRequest } from '../../src/controls/inspection-consumer.mjs';
import { createIntegratedHost, fixturePrincipal } from '../../fixtures/controls/integrated-host.mjs';
import { defaultDraft } from '../../src/controls/schema.mjs';
import { canonicalHash } from 'creative-engine/contracts';
import { hash } from '../../src/controls/actions.mjs';
const fixtures = JSON.parse(readFileSync(new URL('../../fixtures/controls/inspection-presentation-inputs.json', import.meta.url)));

test('versioned presentation inputs preserve every report outcome, unknown costs and held status without authority', () => {
  assert.equal(fixtures.mode, 'presentation-only');
  for (const fixture of Object.values(fixtures.cases)) {
    const view = projectInspectionPresentation(fixture.input);
    assert.match(view.evidence_label, /Presentation only; actual CE09 integration pending/);
    assert.deepEqual(view.references, fixture.input.references);
    assert.match(view.authority_message, /cannot start repair, approve artwork or authorize purchase/);
    assert.match(view.retry_message, /Do not regenerate the saved edit/);
    assert.doesNotMatch(view.usage_message, /cost.*(?:0|zero|free)/i);
    if (fixture.input.usage.completeness !== 'complete') assert.match(view.usage_message, /unknown/);
    if (fixture.input.usage.hold === 'held') assert.match(view.hold_message, /remains held/);
    assert.ok(Object.isFrozen(view)); assert.ok(Object.isFrozen(view.references));
  }
  assert.match(projectInspectionPresentation(fixtures.cases.recommended.input).message, /separate explicit authorized action/);
  assert.match(projectInspectionPresentation(fixtures.cases.acceptable.input).message, /grants no approval/);
});

test('unsupported fields, versions, unsafe references and raw private report prose fail with fixed wording', () => {
  const base = fixtures.cases.acceptable.input;
  const mutate = [x => { x.schema_version = 'controls-inspection-presentation/9'; }, x => { x.evidence_mode = 'live'; },
    x => { x.report.recommendation = '<script>secret</script>'; }, x => { x.report.outcome = 'constructor'; },
    x => { x.report.outcome = {}; }, x => { x.report.schema_version = '9'; },
    x => { x.references.inspection_action_id = x.references.edit_action_id; },
    x => { x.usage.cost = '0'; }, x => { x.status = 'approved'; }, x => { x.report = null; },
    x => { x.status = 'failed'; }, x => { x.private_provider_request_id = 'private'; }];
  for (const change of mutate) { const input = structuredClone(base); change(input); assert.throws(() => projectInspectionPresentation(input), /Unsupported inspection presentation/); }
  for (const value of ['design.ghp_' + 'a'.repeat(36), 'id.Bearer+inert-test', 'id.Basic+' + btoa('fixture:inert'),
    'https://example.invalid/a?sig=private', 'customer@example.invalid', '<script>prompt</script>']) {
    for (const key of ['edit_action_id', 'inspection_action_id', 'brief_id', 'design_version_id', 'artifact_hash']) {
      const input = structuredClone(base); input.references[key] = value;
      assert.throws(() => projectInspectionPresentation(input), /Unsupported inspection presentation/);
    }
  }
});

test('presentation boundary rejects hostile getters, iterators and coercion without executing caller hooks', () => {
  let hooks = 0;
  const getter = {}; Object.defineProperty(getter, 'schema_version', { enumerable: true, get() { hooks++; return 'bad'; } });
  const array = []; array[Symbol.iterator] = () => { hooks++; return [][Symbol.iterator](); };
  const coercion = { toString() { hooks++; return 'failure'; } };
  for (const input of [getter, array, { ...fixtures.cases.acceptable.input, report: { ...fixtures.cases.acceptable.input.report, outcome: coercion } }])
    assert.throws(() => projectInspectionPresentation(input), TypeError);
  assert.equal(hooks, 0);
});

test('request preparation binds actual published edit/current brief, keeps distinct retry identity and never invokes inspection', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'controls-inspection-prep-'));
  const host = await createIntegratedHost(dir); t.after(async () => { host.close(); await rm(dir, { recursive: true, force: true }); });
  const schema = host.schema(), originalSelection = host.selection(), draft = defaultDraft(schema); draft.selections.c04 = 'vibrant';
  const action = { action_version: 'creative-apply/1.1', schema_version: schema.schema_version, action_id: 'prep-real-edit',
    tenant_id: schema.tenant_id, project_id: schema.project_id, brief_id: schema.brief_id, expected_versions: schema.expected_versions,
    intent: 'apply', draft, draft_hash: hash(draft), control_schema_hash: `sha256:${hash(schema)}` };
  const result = await host.adapter.apply(fixturePrincipal, action); assert.equal(result.ok, true, JSON.stringify(result));
  const saved = result.result.design_version, before = host.counts(), selection = host.selection();
  const context = host.adapter.context(fixturePrincipal);
  const input = { current_brief: { brief_id: schema.brief_id, brief_hash: canonicalHash(context.brief), tenant_id: schema.tenant_id, project_id: schema.project_id },
    current_selection: context.selection, saved_design: saved, edit_action_id: result.action_id, inspection_action_id: 'prep-separate-inspection' };
  const proposal = prepareInspectionRequest(input);
  assert.equal(proposal.capability_status, 'pending_qualified_producer');
  assert.deepEqual(proposal.request, { operation: 'inspect', action_id: 'prep-separate-inspection', payload: { brief_id: schema.brief_id, design_version_id: saved.design_version_id } });
  assert.equal(proposal.binding.artifact_hash, saved.artifact.content_hash);
  assert.equal(proposal.binding.selection_revision, selection.revision);
  assert.throws(() => prepareInspectionRequest({ ...input, edit_action_id: 'unrelated-edit' }), TypeError);
  assert.deepEqual(prepareInspectionRequest(input), proposal, 'Retry prepares only the same inspection operation fragment');
  for (const status of ['pending', 'unavailable', 'failed']) {
    const fixture = structuredClone(fixtures.cases[status].input);
    fixture.references = { edit_action_id: result.action_id, inspection_action_id: proposal.request.action_id,
      brief_id: schema.brief_id, design_version_id: saved.design_version_id, artifact_hash: saved.artifact.content_hash };
    assert.match(projectInspectionPresentation(fixture).message, /saved artwork remains available/i);
  }
  assert.deepEqual(host.counts(), before); assert.deepEqual(host.selection(), selection);
  assert.equal((await host.history()).result.items.length, 2);
  assert.throws(() => prepareInspectionRequest({ ...input, current_selection: originalSelection }), TypeError, 'Stale original selected design cannot silently rebase inspection');
  assert.throws(() => prepareInspectionRequest({ ...input, inspection_action_id: input.edit_action_id }), TypeError);
  assert.throws(() => prepareInspectionRequest({ ...input, saved_design: { ...saved, brief_id: 'foreign-brief' } }), TypeError);
  input.current_selection.design_version_id = 'mutated';
  assert.equal(proposal.request.payload.design_version_id, saved.design_version_id);
  assert.ok(Object.isFrozen(proposal.request.payload));
  t.diagnostic(JSON.stringify({ controls_probe: 'inspection_preparation_only', saved_design_id: saved.design_version_id,
    artifact_hash: saved.artifact.content_hash, request: proposal.request, counts: before, inspection_invocations: 0, live_application_calls: 0 }));
});
