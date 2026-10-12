import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productionReferences } from '@jevelopers/shared-contracts/production-operations';
import * as consumer from './installed-caller.mjs';
const fixture = name => JSON.parse(readFileSync(new URL(import.meta.resolve('@jevelopers/shared-contracts/fixtures/' + name + '.json'))));
const calibration = fixture('ProductionCalibration');
const eligibility = fixture('ProductionEligibilityCalibration').valid;
const scope = calibration.scope;
const alien = { ...scope, project_id: '123e4567-e89b-42d3-a456-000000000999' };
const records = [];
function check(scenario, result, expected) {
  assert.equal(result.ok, expected, scenario + ': ' + JSON.stringify(result));
  records.push({ scenario, passed: true, accepted: result.ok, codes: result.errors?.map(error => error.code) ?? [] });
  return result;
}
check('design-valid', consumer.inspectDesign(calibration.template, scope), true);
check('design-cross-project', consumer.inspectDesign(calibration.template, alien), false);
check('design-content-corruption', consumer.inspectDesign({ ...calibration.template, revision: 999 }, scope), false);
check('reference-valid', consumer.inspectReference(calibration.facts.reference), true);
check('reference-wrong-version', consumer.inspectReference({ ...calibration.facts.reference, schema_version: '99.0.0' }), false);
check('facts-valid', consumer.inspectFacts(calibration.facts.package, scope), true);
check('facts-cross-project', consumer.inspectFacts(calibration.facts.package, alien), false);
const policy = fixture('ProductionPolicy').valid;
check('value-valid', consumer.inspectValue('ProductionPolicy', policy, scope), true);
check('value-content-corruption', consumer.inspectValue('ProductionPolicy', { ...policy, revision: 999 }, scope), false);
const composition = calibration.composition;
const compositionContext = {
  scope, template: calibration.template, personalization: calibration.personalization,
  facts: calibration.facts, expected_references: Object.fromEntries(productionReferences(composition)),
  expected_resolved_layout_commitment: composition.resolved_layout_commitment,
  expected_policy_refs: composition.policy_refs, expected_font_refs: composition.font_refs,
  expected_runtime_ref: composition.runtime_ref,
  asset_bytes: Object.fromEntries(Object.entries(calibration.asset_bytes).map(([id, bytes]) => [id, Buffer.from(bytes, 'base64')])),
};
check('composition-valid', consumer.inspectComposition(composition, compositionContext), true);
check('composition-cross-project', consumer.inspectComposition(composition, { ...compositionContext, scope: alien }), false);
const rowFixture = fixture('RowResult');
const rowContext = rowFixture.cases.find(row => row.mode === 'production' && row.expected.ok).context;
const rows = { scope, job: rowContext.job, original_rows: rowContext.rows };
check('row-valid-blocked', consumer.inspectRow(rowFixture.valid, rows), true);
assert.equal(rowFixture.valid.eligibility.handoff_eligible, false);
check('row-wrong-ordinal', consumer.inspectRow({ ...rowFixture.valid, ordinal: 999 }, rows), false);
const preflightContext = {
  artifact_ref: eligibility.context.artifact_ref, spec_ref: eligibility.context.report.body.spec_ref,
  rule_ref: eligibility.context.inspection_policy_ref, parser_ref: eligibility.context.parser_ref,
  files: eligibility.bundle.files,
};
check('preflight-valid', consumer.inspectPreflight(eligibility.context.report, preflightContext), true);
check('preflight-wrong-spec', consumer.inspectPreflight(eligibility.context.report, { ...preflightContext, spec_ref: { ...preflightContext.spec_ref, revision: 999 } }), false);
const files = Object.entries(calibration.byte_files).map(([filename, value]) => ({ filename, bytes: Buffer.from(value, 'base64') }));
const byteContext = { scope, trusted_commitment: calibration.trusted_commitment };
const verified = check('bundle-valid', consumer.inspectBytes(files, byteContext), true);
assert.equal(verified.value.eligibility, 'blocked');
assert.equal(verified.value.evidence_mode, 'byte_verification_only');
check('bundle-corrupt-payload', consumer.inspectBytes(files.map(file => file.filename === 'output.svg' ? { ...file, bytes: Buffer.from('corrupt') } : file), byteContext), false);
const zip = files.find(file => file.filename === 'archive.zip').bytes;
const descriptors = [...verified.value.bundle.files, calibration.trusted_commitment.file_set.find(file => file.filename === 'manifest.json')];
check('zip-valid', consumer.inspectZip(zip, descriptors), true);
check('zip-corruption', consumer.inspectZip(Buffer.from('invalid zip'), descriptors), false);
console.log(JSON.stringify({ surface: 'installed-public-sdk-consumer', synthetic: true, product_acceptance: 'blocked', records }));
