import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { checkProductionBundleEligibility, checkComposition, checkProductionApproval, productionBundleContentHash, productionContentHash, productionReferences } from '../tooling/production-operations.mjs';
import { commerceContentHash, hashManifest, researchContentHash } from '../generated/index.mjs';

const seed = JSON.parse(await readFile(new URL('../fixtures/ProductionEligibilityCalibration.json', import.meta.url), 'utf8'));
const copy = structuredClone;
function hydrate(input) {
  const value = copy(input);
  value.context.composition_context.asset_bytes = Object.fromEntries(Object.entries(value.context.composition_context.asset_bytes).map(([id, bytes]) => [id, Buffer.from(bytes, 'base64')]));
  return value;
}
function resealApproval(input) {
  const { bundle, context } = input, receipt = context.current_approval.receipt;
  Object.assign(receipt.binding, { subject_ref: copy(bundle.composition_ref), composition_ref: copy(bundle.composition_ref), facts_ref: copy(bundle.facts_ref), facts_hash: bundle.composition.facts_hash });
  receipt.receipt_hash = commerceContentHash(receipt, 'receipt_hash');
  context.expected_binding = copy(receipt.binding);
  bundle.approval_ref.content_hash = receipt.receipt_hash;
  bundle.bundle_hash = productionBundleContentHash(bundle);
}
function eligibility(input) { const { bundle, context } = hydrate(input); return checkProductionBundleEligibility(bundle, context); }

test('SC-CHK-018 refuses a JSON-shaped non-clock before Date.parse', () => {
  const input = hydrate(seed.valid);
  input.context.now = { toString: null, valueOf: null };
  const result = checkProductionBundleEligibility(input.bundle, input.context);
  assert.equal(result.errors[0].code, 'INVALID_TRUST_CONTEXT');
});
test('SC-CHK-021 refuses cyclic independent reference expectation', () => {
  const input = hydrate(seed.valid), expected = {};
  expected.self = expected;
  const path = productionReferences(input.context.composition).find(([path]) => path.endsWith('template_ref'))[0];
  input.context.composition_context.expected_references[path] = expected;
  const result = checkComposition(input.context.composition, input.context.composition_context);
  assert.equal(result.errors[0].code, 'INVALID_TRUST_CONTEXT');
});
test('SC-CHK-021 refuses hidden approval-binding properties', () => {
  const input = hydrate(seed.valid);
  Object.defineProperty(input.context.expected_binding, 'hidden', { value: true });
  const result = checkProductionApproval(input.context.current_approval, input.context);
  assert.equal(result.errors[0].code, 'INVALID_TRUST_CONTEXT');
});
for (const route of ['composition', 'eligibility']) for (const recipe of ['cycle', 'hidden', 'symbol']) test('SC-CHK-021 refuses noncanonical facts reference / ' + route + ' / ' + recipe, () => {
  const input = hydrate(seed.valid), context = input.context.composition_context, reference = context.facts.reference;
  if (recipe === 'cycle') reference.extra = reference;
  else if (recipe === 'hidden') Object.defineProperty(reference, 'synthetic_extra', { value: 1, enumerable: false });
  else reference[Symbol('synthetic_extra')] = 1;
  const result = route === 'composition' ? checkComposition(input.context.composition, context) : checkProductionBundleEligibility(input.bundle, input.context);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'INVALID_TRUST_CONTEXT');
});

for (const purpose of ['design_preview', 'asset_display', 'asset_reproduce', 'asset_modify', 'asset_publish']) test('SC-CHK-019 refuses non-production purpose ' + purpose, () => {
  const input = copy(seed.valid);
  input.context.current_approval.receipt.binding.intended_use = purpose;
  resealApproval(input);
  const result = eligibility(input);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'APPROVAL_INVALID');
});
for (const field of ['artifact_ref', 'capture', 'expected_row_scope', 'inspection_policy_ref', 'parser_ref']) test('SC-CHK-018 refuses missing ' + field, () => {
  const input = hydrate(seed.valid);
  delete input.context[field];
  const result = checkProductionBundleEligibility(input.bundle, input.context);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'INVALID_TRUST_CONTEXT');
});
for (const field of ['artifact_ref', 'capture']) for (const value of [null, false, {}]) test('SC-CHK-018 refuses malformed ' + field + ' / ' + JSON.stringify(value), () => {
  const input = hydrate(seed.valid);
  input.context[field] = value;
  const result = checkProductionBundleEligibility(input.bundle, input.context);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'INVALID_TRUST_CONTEXT');
});
function resealComposition(input) {
  const { bundle, context } = input, value = context.composition, expected = context.composition_context;
  expected.facts.package.package_hash = researchContentHash(expected.facts.package, 'package_hash');
  expected.facts.reference.content_hash = expected.facts.package.package_hash;
  value.facts_ref = copy(expected.facts.reference);
  expected.personalization.content_hash = productionContentHash(expected.personalization);
  expected.template.personalization_schema_ref.content_hash = expected.personalization.content_hash;
  expected.template.content_hash = productionContentHash(expected.template);
  value.template_ref.content_hash = expected.template.content_hash;
  value.input_binding_hash = hashManifest({ values: value.values, fact_bindings: value.fact_bindings, facts_ref: value.facts_ref, formatting: value.policy_refs.formatting });
  value.content_hash = productionContentHash(value);
  expected.expected_references = Object.fromEntries(productionReferences(value));
  context.artifact_ref.composition_ref.content_hash = value.content_hash;
  context.artifact_ref.private_revision_hash = hashManifest({ compositionHash: value.content_hash, renderHash: context.artifact_ref.render_hash });
  Object.assign(bundle, { composition_ref: copy(context.artifact_ref.composition_ref), facts_ref: copy(value.facts_ref), template_ref: copy(value.template_ref) });
  Object.assign(bundle.composition, { composition_hash: value.content_hash, facts_hash: value.facts_ref.content_hash, input_binding_hash: value.input_binding_hash, private_revision_hash: context.artifact_ref.private_revision_hash });
  context.report.body.artifact_ref = copy(context.artifact_ref);
  for (const file of context.report.body.checked_files) file.composition_hash = value.content_hash;
  context.report.report_ref.content_hash = hashManifest(context.report.body);
  bundle.preflight.report_ref = copy(context.report.report_ref);
  bundle.files.find(file => file.role === 'preflight_report').semantic_hash = context.report.report_ref.content_hash;
  context.current_approval.receipt.binding.composition_hash = value.content_hash;
  resealApproval(input);
}

test('complete synthetic control remains blocked on the unestablished preview bridge', () => {
  assert.equal(hashManifest(seed.valid), seed.provenance.input_hash);
  const result = eligibility(seed.valid);
  assert.deepEqual(result.errors[0], { code: 'LEGACY_UNREPRESENTABLE', path: '/approval_ref/preview_ref' });
});
for (const [field, value] of [['id', '123e4567-e89b-42d3-a456-000000008502'], ['revision', 9], ['content_hash', hashManifest('different factual package')], ['contract', 'DesignVersion']]) test('SC-CHK-015 rejects independently contradictory bundle facts ' + field, () => {
  const input = copy(seed.valid);
  input.bundle.facts_ref[field] = value;
  input.bundle.composition.facts_hash = input.bundle.facts_ref.content_hash;
  resealApproval(input);
  const result = eligibility(input);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors[0], { code: 'FACTS_UNSUPPORTED', path: '/facts_ref' });
});
for (const field of ['id', 'revision']) test('eligibility binds the actual composition ' + field, () => {
  const input = copy(seed.valid);
  input.bundle.composition_ref[field] = field === 'id' ? '123e4567-e89b-42d3-a456-000000008502' : 9;
  input.context.artifact_ref.composition_ref = copy(input.bundle.composition_ref);
  input.context.report.body.artifact_ref = copy(input.context.artifact_ref);
  input.context.report.report_ref.content_hash = hashManifest(input.context.report.body);
  input.bundle.preflight.report_ref = copy(input.context.report.report_ref);
  input.bundle.files.find(file => file.role === 'preflight_report').semantic_hash = input.context.report.report_ref.content_hash;
  resealApproval(input);
  const result = eligibility(input);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors[0], { code: 'HASH_MISMATCH', path: '/composition_ref' });
});
for (const field of ['tenant_id', 'project_id']) test('SC-CHK-016 rejects foreign composition scope ' + field, () => {
  const input = copy(seed.valid);
  input.context.composition[field] = '123e4567-e89b-42d3-a456-000000008503';
  input.context.composition_context.scope[field] = input.context.composition[field];
  for (const record of [input.context.composition_context.template, input.context.composition_context.personalization, input.context.composition_context.facts.package]) record[field] = input.context.composition[field];
  resealComposition(input);
  const result = eligibility(input);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'NOT_FOUND');
});
test('correctly rebound facts preserve the unsupported preview bridge boundary', () => {
  const input = copy(seed.valid);
  input.context.composition_context.facts.package.policy_ref.content_hash = hashManifest('new legitimate policy descriptor');
  resealComposition(input);
  assert.deepEqual(eligibility(input).errors[0], { code: 'LEGACY_UNREPRESENTABLE', path: '/approval_ref/preview_ref' });
});
for (const [field, value] of [['id', '123e4567-e89b-42d3-a456-000000008502'], ['revision', 9], ['contract', 'OrderAuthorization'], ['content_hash', hashManifest('another preview')]]) test('SC-CHK-020 refuses substituted approval preview ' + field, () => {
  const input = copy(seed.valid);
  input.context.current_approval.receipt.binding.preview_ref[field] = value;
  resealApproval(input);
  const result = eligibility(input);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'APPROVAL_INVALID');
});
for (const field of ['expected_policy_refs', 'expected_font_refs', 'expected_runtime_ref']) for (const invalid of [undefined, null, false, 1]) test('SC-CHK-017 rejects malformed ' + field + ' / ' + invalid, () => {
  const input = hydrate(seed.valid);
  if (invalid === undefined) delete input.context.composition_context[field];
  else input.context.composition_context[field] = invalid;
  const result = checkComposition(input.context.composition, input.context.composition_context);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'INVALID_TRUST_CONTEXT');
});
for (const kind of ['sparse-fonts', 'cyclic-policy', 'malformed-font', 'missing-policy']) test('composition rejects noncanonical or incomplete expectation ' + kind, () => {
  const input = hydrate(seed.valid), context = input.context.composition_context;
  if (kind === 'sparse-fonts') context.expected_font_refs = new Array(1);
  if (kind === 'cyclic-policy') context.expected_policy_refs.layout = context.expected_policy_refs;
  if (kind === 'malformed-font') context.expected_font_refs = [null];
  if (kind === 'missing-policy') delete context.expected_policy_refs.layout;
  const result = checkComposition(input.context.composition, context);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'INVALID_TRUST_CONTEXT');
});
