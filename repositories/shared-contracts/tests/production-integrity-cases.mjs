import { readFile } from 'node:fs/promises';
import { hashManifest } from '../tooling/runtime.mjs';
import { researchContentHash } from '../tooling/research-creative.mjs';
import { productionContentHash, productionReferences } from '../tooling/production-operations.mjs';
import { calibration, clone, compositionContext, readProduction } from './production-seeds.mjs';

export async function productionIntegrityCases() {
  const rows = [];
  function add(id, route, input, expected) {
    rows.push({ id, route, input: clone(input), input_hash: hashManifest(input), expected });
  }
  for (const mode of ['canonical', 'changed-fact-retained-hash', 'changed-fact-rehashed', 'unknown-fact', 'wrong-request-kind', 'wrong-receipt-kind', 'wrong-answer-kind', 'wrong-batch-kind', 'wrong-approval-kind', 'duplicate-fact', 'bad-provenance', 'historical-package', 'delivery-only-change', 'readonly-override']) {
    const value = clone(calibration.composition), context = compositionContext();
    const pkg = context.facts.package, fact = pkg.facts.find(fact => fact.key === value.fact_bindings[0].fact_key);
    if (mode.startsWith('changed-fact')) { fact.value = 'independently changed title'; value.fact_bindings[0].value_hash = hashManifest({ kind: 'display', value: fact.value }); }
    if (mode === 'changed-fact-rehashed') fact.fact_hash = researchContentHash(fact, 'fact_hash');
    if (mode === 'unknown-fact') { fact.status = 'unknown'; fact.value = null; fact.fact_hash = researchContentHash(fact, 'fact_hash'); pkg.readiness = 'review'; }
    if (mode === 'wrong-request-kind') pkg.request_ref.contract = 'OrderAuthorization';
    if (mode === 'wrong-receipt-kind') pkg.request_receipt_ref.contract = 'OrderAuthorization';
    if (mode === 'wrong-answer-kind') pkg.answer_receipt_refs[0].contract = 'OrderAuthorization';
    if (mode === 'wrong-batch-kind') pkg.batch_receipt_ref.contract = 'OrderAuthorization';
    if (mode === 'wrong-approval-kind') pkg.approved_assets[0].approval_ref.contract = 'OrderAuthorization';
    if (mode === 'duplicate-fact') pkg.facts.push(clone(fact));
    if (mode === 'bad-provenance') { fact.provenance[0].source_id = 'absent_source'; fact.fact_hash = researchContentHash(fact, 'fact_hash'); }
    if (mode === 'historical-package') { pkg.package_version = 8; pkg.parent_ref = { ...context.facts.reference, revision: 7 }; pkg.expires_at = '2020-01-01T00:00:00Z'; context.facts.reference.revision = 8; value.facts_ref.revision = 8; }
    if (mode === 'delivery-only-change') pkg.observed_at = '2030-01-01T00:00:00Z';
    if (mode === 'readonly-override') value.values.title = { kind: 'display', value: 'override' };
    pkg.package_hash = researchContentHash(pkg, 'package_hash');
    context.facts.reference.content_hash = pkg.package_hash; value.facts_ref.content_hash = pkg.package_hash;
    value.input_binding_hash = hashManifest({ values: value.values, fact_bindings: value.fact_bindings, facts_ref: value.facts_ref, formatting: value.policy_refs.formatting });
    value.content_hash = productionContentHash(value); context.expected_references = Object.fromEntries(productionReferences(value));
    context.asset_bytes = Object.fromEntries(Object.entries(context.asset_bytes).map(([id, bytes]) => [id, Array.from(bytes)]));
    add('facts/' + mode, 'composition', { value, context }, ['canonical', 'changed-fact-rehashed', 'historical-package', 'delivery-only-change'].includes(mode));
  }
  for (const contract of ['ProductionPolicy', 'ProductionRuntime', 'ProductionResource', 'ProductionDiagnostic', 'CsvDialect', 'CsvMapping', 'TemplateSpec', 'PersonalizationSchema']) {
    const value = await readProduction(contract);
    add(contract + '/canonical', 'integrity', { contract, value, scope: calibration.scope }, true);
    const tampered = clone(value); tampered.content_hash = hashManifest('different identity');
    add(contract + '/stale-hash', 'integrity', { contract, value: tampered, scope: calibration.scope }, false);
  }
  const report = await readProduction('PreflightReport');
  add('report/canonical-result', 'result', { operation: 'inspectArtifact', value: { ok: true, value: report }, scope: calibration.scope }, true);
  const tamperedReport = clone(report); tamperedReport.body.model_ready = !report.body.model_ready;
  add('report/changed-body-result', 'result', { operation: 'inspectArtifact', value: { ok: true, value: tamperedReport }, scope: calibration.scope }, false);
  for (const contract of ['DesignVersion', 'ArtifactHandoffManifest', 'ApprovalReceipt', 'PrintSpec', 'FulfillmentCapabilitySnapshot']) {
    const value = JSON.parse(await readFile(new URL('../fixtures/' + contract + '.json', import.meta.url), 'utf8')).valid;
    const scope = { tenant_id: value.tenant_id, project_id: value.project_id };
    add(contract + '/canonical', 'integrity', { contract, value, scope }, true);
    const tampered = clone(value);
    tampered[{ DesignVersion: 'design_hash', ArtifactHandoffManifest: 'manifest_hash', ApprovalReceipt: 'receipt_hash', PrintSpec: 'spec_identity', FulfillmentCapabilitySnapshot: 'capture_identity' }[contract]] = hashManifest('different identity');
    add(contract + '/stale-hash', 'integrity', { contract, value: tampered, scope }, false);
  }
  return rows;
}

export function runProductionIntegrityCase(api, row) {
  const input = clone(row.input);
  switch (row.route) {
    case 'composition': input.context.asset_bytes = Object.fromEntries(Object.entries(input.context.asset_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)])); return api.checkComposition(input.value, input.context);
    case 'integrity': return api.checkProductionValueIntegrity(input.contract, input.value, input.scope);
    case 'result': return api.validateProductionResult(input.operation, input.value, input.scope);
    default: throw new Error('Unsupported integrity test route');
  }
}
