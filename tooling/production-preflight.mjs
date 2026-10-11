import { validateContract, canonicalJson, hashManifest, checkTrustedContext } from './runtime.mjs';
import { productionIssue, productionOk, checkProductionApproval, validateProductionReference } from './production-errors.mjs';
import { checkComposition, translateProductionGeometry } from './production-values.mjs';
import { checkProductionBundleV2 } from './production-bundle.mjs';
import { checkPrintSpecBinding } from './capability.mjs';

const same = (a,b) => canonicalJson(a) === canonicalJson(b);
export function checkProductionPreflight(input, context) {
  const parsed = validateContract('PreflightReport', input);
  if (!parsed.ok) return parsed;
  if (input.report_ref.content_hash !== hashManifest(input.body) || !same(input.body.artifact_ref, context.artifact_ref) || !same(input.body.spec_ref, context.spec_ref) || !same(input.body.rule_ref, context.rule_ref)) return productionIssue('HASH_MISMATCH');
  if (input.body.status !== 'passed' || !input.body.model_ready || !input.body.files_ready || input.body.findings.some(finding => finding.state !== 'passed')) return productionIssue('PREFLIGHT_FAILED');
  const expected = context.files.filter(file => file.role === 'print_output');
  if (input.body.checked_files.length !== expected.length || new Set(input.body.checked_files.map(file=>file.file_hash)).size !== expected.length) return productionIssue('PREFLIGHT_FAILED');
  for (const file of input.body.checked_files) {
    if (!expected.some(descriptor=>descriptor.byte_hash===file.file_hash) || file.composition_hash!==context.artifact_ref.composition_ref.content_hash || file.render_hash!==context.artifact_ref.render_hash || !same(file.parser_ref,context.parser_ref) || file.checks.length!==5 || new Set(file.checks.map(check=>check.name)).size!==5 || file.checks.some(check=>check.state!=='passed')) return productionIssue('PREFLIGHT_FAILED');
  }
  return parsed;
}

/** Eligibility is evaluated independently of bytes with actual supplied domain evidence. */
export function checkProductionBundleEligibility(bundle, context) {
  const parsed = checkProductionBundleV2(bundle, context.scope);
  if (!parsed.ok) return parsed;
  if (!checkTrustedContext(bundle, context.scope).ok) return productionIssue('NOT_FOUND');
  const composition = checkComposition(context.composition, context.composition_context);
  if (!composition.ok) return composition;
  const facts = context.composition_context.facts?.package;
  if (!facts || facts.readiness !== 'ready' || Date.parse(facts.expires_at) <= Date.parse(context.now)) return productionIssue('FACTS_UNSUPPORTED');
  if (!same(bundle.composition_ref, context.artifact_ref.composition_ref) || bundle.composition.composition_hash !== composition.value.content_hash || bundle.composition.render_hash !== context.artifact_ref.render_hash || bundle.composition.private_revision_hash !== context.artifact_ref.private_revision_hash || !same(bundle.composition.source_artwork_hashes, context.artifact_ref.source_artwork_hashes)) return productionIssue('HASH_MISMATCH');
  if (!same(bundle.template_ref,composition.value.template_ref) || !same(bundle.spec_ref,composition.value.spec_ref) || !same(bundle.capability_ref,composition.value.capability_ref) || !same(bundle.policy_refs,composition.value.policy_refs) || !same(bundle.font_refs,composition.value.font_refs) || !same(bundle.renderer_ref,composition.value.runtime_ref)) return productionIssue('POLICY_MISMATCH');
  if (bundle.composition.input_binding_hash!==composition.value.input_binding_hash || bundle.composition.barcode_hash!==(composition.value.barcode.state==='bound'?composition.value.barcode.input_hash:null)) return productionIssue('HASH_MISMATCH');
  const spec = checkPrintSpecBinding(context.spec,context.capture,{trusted_scope:context.scope,now:context.now,capture_identity:context.capture.capture_identity,content_identity:context.capture.content_identity});
  if (!spec.ok) return spec;
  if (bundle.spec_ref.content_hash!==spec.value.spec_identity || bundle.capability_ref.content_hash!==context.capture.capture_identity) return productionIssue('HASH_MISMATCH');
  const geometry=translateProductionGeometry(spec.value,{scope:context.scope,maximum_nm:context.maximum_nm});
  if (!geometry.ok) return geometry;
  if (context.artifact_ref.preview_ref===null || bundle.composition.composed_preview_hash===null || context.artifact_ref.preview_ref.content_hash!==bundle.composition.composed_preview_hash) return productionIssue('PREVIEW_UNKNOWN');
  if (!bundle.files.some(file=>file.role==='composed_preview'&&file.artifact_id===context.artifact_ref.preview_ref.id&&file.byte_hash===bundle.composition.composed_preview_hash)) return productionIssue('PREVIEW_UNKNOWN');
  if (bundle.files.filter(file=>file.role==='print_output').some(file=>file.geometry===null||file.geometry.effective_dpi===null||file.geometry.effective_dpi<context.composition_context.template.minimum_effective_dpi)) return productionIssue('GEOMETRY_UNCONFIRMED');
  const preflight=checkProductionPreflight(context.report,{artifact_ref:context.artifact_ref,spec_ref:bundle.spec_ref,rule_ref:context.inspection_policy_ref,files:bundle.files,parser_ref:context.parser_ref});
  if (!preflight.ok || !same(bundle.preflight.report_ref,context.report.report_ref) || bundle.preflight.status!=='passed' || bundle.preflight.reasons.length) return productionIssue('PREFLIGHT_FAILED');
  const approval=checkProductionApproval(context.current_approval,context);
  if (!approval.ok) return approval;
  const receipt=approval.value.receipt,binding=receipt.binding;
  if (bundle.approval_ref.id!==receipt.approval_id||bundle.approval_ref.content_hash!==receipt.receipt_hash||binding.subject_type!=='composition'||!same(binding.subject_ref,bundle.composition_ref)||!same(binding.composition_ref,bundle.composition_ref)||!same(binding.facts_ref,bundle.facts_ref)||binding.facts_hash!==bundle.composition.facts_hash||binding.composition_hash!==bundle.composition.composition_hash||binding.preview_ref.content_hash!==bundle.composition.composed_preview_hash||!same(binding.asset_hashes,bundle.composition.source_artwork_hashes)) return productionIssue('APPROVAL_INVALID');
  if (!same(bundle.row_scope,context.expected_row_scope)) return productionIssue('ROW_BINDING_MISMATCH');
  if (!validateProductionReference(context.accepted_domain_pin).ok || !validateProductionReference(context.accepted_consumer_pin).ok) return productionIssue('OWNER_ACCEPTANCE_PENDING');
  return productionOk({state:'eligible',evidence_mode:'independently_supplied_domain_values',authority_issued:false});
}
