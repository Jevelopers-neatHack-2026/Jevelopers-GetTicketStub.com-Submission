import { validateContract, checkTrustedContext, canonicalJson, hashManifest, hashBytes, ContractError } from './runtime.mjs';
import { checkPrintSpec, checkFulfillmentCapabilitySnapshot } from './capability.mjs';
import { researchContentHash } from './research-creative.mjs';
import { commerceContentHash } from './commerce-evidence.mjs';
import { validateVersionedReference } from './operations.mjs';
import { productionIssue, productionOk, validateProductionReference } from './production-errors.mjs';
import { productionReferences } from './production-operations.mjs';

export function productionContentHash(value) {
  return hashManifest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'content_hash')));
}
const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
const unique = values => new Set(values).size === values.length;
const inside = (inner, outer) => BigInt(inner.x_nm) >= BigInt(outer.x_nm) && BigInt(inner.y_nm) >= BigInt(outer.y_nm) && BigInt(inner.x_nm) + BigInt(inner.width_nm) <= BigInt(outer.x_nm) + BigInt(outer.width_nm) && BigInt(inner.y_nm) + BigInt(inner.height_nm) <= BigInt(outer.y_nm) + BigInt(outer.height_nm);
const validNm = value => /^(?:0|-?[1-9][0-9]{0,9})$/.test(value) && BigInt(value) >= -2000000000n && BigInt(value) <= 2000000000n;

// All EventIntelligencePackage VersionedReference slots. Null kinds deliberately
// retain the established generic descriptor semantics (not inferred domain policy).
function factsReferences(value) {
  return [
    ...(value.parent_ref === null ? [] : [['/parent_ref', value.parent_ref, 'EventIntelligencePackage']]),
    ['/request_ref', value.request_ref, 'ResearchRequest'], ['/request_receipt_ref', value.request_receipt_ref, 'ResearchRequestReceipt'],
    ...value.answer_receipt_refs.map((ref, index) => ['/answer_receipt_refs/' + index, ref, 'ResearchAnswerReceipt']),
    ['/batch_receipt_ref', value.batch_receipt_ref, 'ResearchBatchReceipt'],
    ...value.sources.flatMap((source, index) => [['/sources/' + index + '/retention_ref', source.retention_ref, null], ['/sources/' + index + '/access_ref', source.access_ref, null]]),
    ...value.facts.flatMap((fact, index) => fact.provenance.map((provenance, inner) => ['/facts/' + index + '/provenance/' + inner + '/evidence_ref', provenance.evidence_ref, null])),
    ...value.approved_assets.flatMap((asset, index) => [['/approved_assets/' + index + '/artifact_ref', asset.artifact_ref, 'Artifact'], ['/approved_assets/' + index + '/approval_ref', asset.approval_ref, 'ApprovalReference']]),
    ['/policy_ref', value.policy_ref, null],
    ...value.decision_refs.map((ref, index) => ['/decision_refs/' + index, ref, null]),
    ...value.usage_refs.map((ref, index) => ['/usage_refs/' + index, ref, null])
  ];
}
function validFactsURL(value) {
  let url;
  try { url = new URL(value); } catch (error) { if (error instanceof TypeError) return false; throw error; }
  return ['http:', 'https:'].includes(url.protocol) && Boolean(url.hostname) && !url.username && !url.password && !url.hash;
}

/** Immutable facts only: no freshness, issuer, approval or transitive record authority. */
export function checkProductionFacts(input, scope) {
  const parsed = validateContract('EventIntelligencePackage', input);
  if (!parsed.ok) return parsed;
  if (!checkTrustedContext(input, scope).ok) return productionIssue('NOT_FOUND');
  for (const [path, reference, kind] of factsReferences(input)) {
    if (!validateVersionedReference(reference).ok || (kind && reference.contract !== kind)) return productionIssue('FACTS_UNSUPPORTED', path);
  }
  if (input.parent_ref !== null && (input.package_version === 1 || input.parent_ref.id !== input.package_id ||
      input.parent_ref.revision !== input.package_version - 1)) return productionIssue('FACTS_UNSUPPORTED', '/parent_ref');
  if (input.package_hash !== researchContentHash(input, 'package_hash')) return productionIssue('HASH_MISMATCH', '/package_hash');
  for (const [index, source] of input.sources.entries()) if (!validFactsURL(source.url)) return productionIssue('FACTS_UNSUPPORTED', '/sources/' + index + '/url');
  if (!unique(input.sources.map(source => source.source_id)) || !unique(input.facts.map(fact => fact.fact_id)) || !unique(input.facts.map(fact => fact.key)) || !unique(input.asset_candidates.map(asset => asset.asset_id)) || !unique(input.approved_assets.map(asset => asset.asset_id))) return productionIssue('FACTS_UNSUPPORTED');
  for (const [index, fact] of input.facts.entries()) {
    if (fact.fact_hash !== researchContentHash(fact, 'fact_hash')) return productionIssue('HASH_MISMATCH', '/facts/' + index + '/fact_hash');
    if (fact.provenance.some(provenance => !input.sources.some(source => source.source_id === provenance.source_id && source.retrieved_at === provenance.retrieved_at)) || (fact.confidence.basis === 'not_measured') !== (fact.confidence.value === null)) return productionIssue('FACTS_UNSUPPORTED', '/facts/' + index);
    switch (fact.status) {
      case 'known': if (fact.value === null || fact.candidate_values.length) return productionIssue('FACTS_UNSUPPORTED'); break;
      case 'unknown': if (fact.value !== null || fact.candidate_values.length) return productionIssue('FACTS_UNSUPPORTED'); break;
      case 'conflicting': if (fact.value !== null || fact.candidate_values.length < 2 || !unique(fact.candidate_values.map(canonicalJson))) return productionIssue('FACTS_UNSUPPORTED'); break;
      case 'review': break;
      default: return productionIssue('FACTS_UNSUPPORTED');
    }
  }
  if (input.readiness === 'ready' && input.facts.some(fact => fact.status !== 'known')) return productionIssue('FACTS_UNSUPPORTED');
  for (const [index, asset] of input.asset_candidates.entries()) {
    if (!input.sources.some(source => source.source_id === asset.source_id)) return productionIssue('FACTS_UNSUPPORTED', '/asset_candidates/' + index + '/source_id');
    if (!validFactsURL(asset.discovery_url)) return productionIssue('FACTS_UNSUPPORTED', '/asset_candidates/' + index + '/discovery_url');
  }
  for (const asset of input.approved_assets) if (!input.asset_candidates.some(candidate => candidate.asset_id === asset.asset_id && candidate.revision === asset.revision && candidate.original_hash === asset.original_hash && candidate.transformed_hash === asset.transformed_hash)) return productionIssue('FACTS_UNSUPPORTED');
  return parsed;
}

/** Intrinsic commitments in supplied records, separate from resolver authenticity. */
export function checkProductionValueIntegrity(contract, input, scope) {
  const parsed = validateContract(contract, input);
  if (!parsed.ok) return parsed;
  if (Object.hasOwn(input, 'tenant_id') && !checkTrustedContext(input, scope).ok) return productionIssue('NOT_FOUND');
  switch (contract) {
    case 'EventIntelligencePackage': return checkProductionFacts(input, scope);
    case 'PrintSpec': return checkPrintSpec(input, { trusted_scope: scope });
    case 'FulfillmentCapabilitySnapshot': return checkFulfillmentCapabilitySnapshot(input, { trusted_scope: scope, now: input.freshness.fresh_until });
    case 'DesignVersion':
      if (input.design_hash !== researchContentHash(input, 'design_hash')) return productionIssue('HASH_MISMATCH');
      break;
    case 'ArtifactHandoffManifest':
      if (input.manifest_hash !== commerceContentHash(input, 'manifest_hash')) return productionIssue('HASH_MISMATCH');
      break;
    case 'ApprovalReceipt':
      if (input.receipt_hash !== commerceContentHash(input, 'receipt_hash')) return productionIssue('HASH_MISMATCH');
      break;
    case 'TemplateSpec': case 'Composition': case 'PersonalizationSchema': case 'ProductionPolicy': case 'ProductionRuntime': case 'ProductionResource': case 'ProductionDiagnostic': case 'CsvDialect': case 'CsvMapping':
      if (input.content_hash !== productionContentHash(input)) return productionIssue('HASH_MISMATCH');
      break;
    case 'PreflightReport':
      if (input.report_ref.content_hash !== hashManifest(input.body)) return productionIssue('HASH_MISMATCH');
      break;
    case 'ProductionBundle':
      if (input.schema_version !== '2.0.0') return productionIssue('UNSUPPORTED_VERSION');
      if (input.bundle_hash !== commerceContentHash(input, 'bundle_hash')) return productionIssue('HASH_MISMATCH');
      break;
    case 'ComposeArtifactRequest': case 'PersonalizeBatchRequest': case 'InspectArtifactRequest': case 'ExportBundleRequest': case 'CompareTemplateRequest': case 'ArtifactStatusRequest': case 'ProductionReference': case 'ProductionExecutionPins': case 'ProductionError': case 'ArtifactRef': case 'JobRef': case 'BatchResult': case 'RowResult': case 'CompatibilityReport': case 'ArtifactManifestStatus': case 'ProductionBundleRef': case 'ProductionBundleDetached': case 'ArtifactFile': case 'CsvCheckpoint': break;
    default: return productionIssue('UNSUPPORTED_VERSION');
  }
  const kinds = contract === 'DesignVersion'
    ? { parent_ref: 'DesignVersion', brief_ref: 'CreativeBrief', control_ref: 'DesignControlSchema', job_ref: 'JobStatus', source_artifact_ref: 'Artifact' }
    : ['ApprovalReceipt', 'ArtifactHandoffManifest'].includes(contract)
    ? { design_ref: 'DesignVersion', approval_ref: 'ApprovalReceipt', product_spec_ref: 'PrintSpec' }
    : { runtime_ref: 'ProductionRuntime', renderer_ref: 'ProductionRuntime', font_refs: 'ProductionResource', allowed_font_refs: 'ProductionResource', product_ref: 'ProductionResource', template_ref: 'TemplateSpec', source_template_ref: 'TemplateSpec', target_template_ref: 'TemplateSpec', spec_ref: 'PrintSpec', capability_ref: 'FulfillmentCapabilitySnapshot', composition_ref: 'Composition', facts_ref: 'EventIntelligencePackage', design_ref: 'DesignVersion', handoff_ref: 'ArtifactHandoffManifest', approval_ref: 'ApprovalReceipt', permission_ref: 'ApprovalReceipt', report_ref: 'PreflightReport', row_schema_ref: 'PersonalizationSchema', personalization_schema_ref: 'PersonalizationSchema', dialect_ref: 'CsvDialect', mapping_ref: 'CsvMapping', checkpoint_ref: 'CsvCheckpoint', asset_ref: 'ArtifactFile', file_ref: 'ArtifactFile', normalization_policy_ref: 'ProductionPolicy', output_policy_ref: 'ProductionPolicy', formatting_policy_ref: 'ProductionPolicy', inspection_policy_ref: 'ProductionPolicy', rule_ref: 'ProductionPolicy', parser_ref: 'ProductionRuntime', job_ref: 'JobStatus' };
  for (const [path, reference] of productionReferences(input)) {
    const kind = kinds[path.replace(/\/\d+$/, '').split('/').at(-1)];
    if (kind && reference.contract !== kind) return productionIssue('REFERENCE_MISMATCH', path);
  }
  function children(value) {
    if (value === null || typeof value !== 'object') return productionOk(value);
    if (value !== input && typeof value.contract === 'string' && Object.hasOwn(value, 'policy_version')) return checkProductionValueIntegrity(value.contract, value, scope);
    for (const child of Object.values(value)) {
      const checked = children(child);
      if (!checked.ok) return checked;
    }
    return productionOk(value);
  }
  const nested = children(input);
  return nested.ok ? parsed : nested;
}

export function checkTemplateSpec(input, scope) {
  const parsed = checkProductionValueIntegrity('TemplateSpec', input, scope);
  if (!parsed.ok) return parsed;
  if (!checkTrustedContext(input, scope).ok) return productionIssue('NOT_FOUND');
  if (input.content_hash !== productionContentHash(input)) return productionIssue('HASH_MISMATCH');
  const geometry = input.coordinate_geometry, canvas = { x_nm: '0', y_nm: '0', ...geometry.canvas };
  if (![...Object.values(geometry.canvas), ...Object.values(geometry.trim), ...Object.values(geometry.bleed), ...Object.values(geometry.safe)].every(validNm)) return productionIssue('INVALID_GEOMETRY');
  if (!inside(geometry.trim, canvas) || !inside(geometry.trim, geometry.bleed) || !inside(geometry.safe, geometry.trim)) return productionIssue('INVALID_GEOMETRY');
  const width = BigInt(canvas.width_nm), height = BigInt(canvas.height_nm);
  const orientation = width === height ? 'square' : width > height ? 'landscape' : 'portrait';
  if (input.orientation !== orientation) return productionIssue('INVALID_GEOMETRY');
  if (!unique(input.slots.map(slot => slot.slot_id)) || !unique(input.slots.filter(slot => slot.field_id !== null).map(slot => slot.field_id)) || !unique(input.font_refs.map(canonicalJson))) return productionIssue('DUPLICATE_SLOT');
  for (const slot of input.slots) {
    if (!Object.values(slot.bounds).every(validNm) || !inside(slot.bounds, canvas)) return productionIssue('INVALID_GEOMETRY');
    if (slot.allowed_fits.includes('cover') && !slot.allow_crop) return productionIssue('INVALID_GEOMETRY');
    if (slot.kind === 'text') {
      if (slot.font_bounds_nm === null || !slot.allowed_font_refs.length || !validNm(slot.font_bounds_nm.minimum) || !validNm(slot.font_bounds_nm.maximum) || BigInt(slot.font_bounds_nm.minimum) > BigInt(slot.font_bounds_nm.maximum)) return productionIssue('FONT_UNSUPPORTED');
      if (!slot.allowed_font_refs.every(font => input.font_refs.some(expected => equal(font, expected)))) return productionIssue('FONT_UNSUPPORTED');
    } else if (slot.font_bounds_nm !== null || slot.allowed_font_refs.length) return productionIssue('FONT_UNSUPPORTED');
  }
  return parsed;
}

export function checkPersonalizationSchema(input, template) {
  if (!validateContract('TemplateSpec', template).ok) return productionIssue('INVALID_TRUST_CONTEXT');
  const parsed = checkProductionValueIntegrity('PersonalizationSchema', input, { tenant_id: template.tenant_id, project_id: template.project_id });
  if (!parsed.ok) return parsed;
  if (!checkTrustedContext(input, { tenant_id: template.tenant_id, project_id: template.project_id }).ok) return productionIssue('NOT_FOUND');
  if (input.content_hash !== productionContentHash(input) || template.personalization_schema_ref.id !== input.schema_id || template.personalization_schema_ref.revision !== input.revision || template.personalization_schema_ref.content_hash !== input.content_hash) return productionIssue('HASH_MISMATCH');
  if (!unique(input.fields.map(field => field.field_id)) || !unique(input.fields.map(field => field.slot_id)) || input.fields.length > input.limits.maximum_fields) return productionIssue('ROW_SCHEMA');
  for (const field of input.fields) if (!template.slots.some(slot => slot.slot_id === field.slot_id && slot.field_id === field.field_id && slot.kind === 'text')) return productionIssue('ROW_SCHEMA');
  return parsed;
}

/** Supported facts and resolved input commitments must be independently supplied. */
export function checkComposition(input, context) {
  if (context === null || typeof context !== 'object' || Array.isArray(context) || !checkTrustedContext(context.scope, context.scope).ok) return productionIssue('INVALID_TRUST_CONTEXT');
  const parsed = checkProductionValueIntegrity('Composition', input, context.scope);
  if (!parsed.ok) return parsed;
  try { canonicalJson({ policies: context.expected_policy_refs, fonts: context.expected_font_refs, runtime: context.expected_runtime_ref }); }
  catch (error) { if (error instanceof ContractError) return productionIssue('INVALID_TRUST_CONTEXT'); throw error; }
  if (context.expected_references !== undefined) {
    try { canonicalJson(context.expected_references); }
    catch (error) { if (error instanceof ContractError) return productionIssue('INVALID_TRUST_CONTEXT'); throw error; }
  }
  if (context.expected_policy_refs === null || typeof context.expected_policy_refs !== 'object' || Array.isArray(context.expected_policy_refs) ||
      Object.keys(input.policy_refs).some(key => !(key === 'repair' && context.expected_policy_refs[key] === null) && !validateProductionReference(context.expected_policy_refs[key]).ok) ||
      !Array.isArray(context.expected_font_refs) || context.expected_font_refs.some(ref => !validateProductionReference(ref).ok) ||
      !validateProductionReference(context.expected_runtime_ref).ok) return productionIssue('INVALID_TRUST_CONTEXT');
  if (!checkTrustedContext(input, context.scope).ok) return productionIssue('NOT_FOUND');
  if (input.content_hash !== productionContentHash(input)) return productionIssue('HASH_MISMATCH');
  for (const [path, reference] of productionReferences(input)) {
    if (!context.expected_references?.[path] || !equal(reference, context.expected_references[path])) return productionIssue('NOT_FOUND');
  }
  const template = checkTemplateSpec(context.template, context.scope);
  if (!template.ok) return template;
  const policy = checkPersonalizationSchema(context.personalization, template.value);
  if (!policy.ok) return policy;
  if (input.template_ref.id !== template.value.template_id || input.template_ref.revision !== template.value.revision || input.template_ref.content_hash !== template.value.content_hash) return productionIssue('HASH_MISMATCH');
  if (input.facts_ref.contract !== 'EventIntelligencePackage' || !context.facts || context.facts.reference?.contract !== 'EventIntelligencePackage') return productionIssue('FACTS_UNSUPPORTED');
  const facts = checkProductionFacts(context.facts.package, context.scope);
  if (!facts.ok) return productionIssue('FACTS_UNSUPPORTED');
  try { canonicalJson(context.facts.reference); }
  catch (error) { if (error instanceof ContractError) return productionIssue('INVALID_TRUST_CONTEXT'); throw error; }
  if (!equal(input.facts_ref, context.facts.reference) || input.facts_ref.id !== facts.value.package_id || input.facts_ref.revision !== facts.value.package_version || input.facts_ref.content_hash !== facts.value.package_hash) return productionIssue('FACTS_UNSUPPORTED');
  if (context.expected_resolved_layout_commitment !== input.resolved_layout_commitment || !equal(input.policy_refs, context.expected_policy_refs) || !equal(input.font_refs, context.expected_font_refs) || !equal(input.runtime_ref, context.expected_runtime_ref)) return productionIssue('POLICY_MISMATCH');
  if (!equal(input.spec_ref, template.value.spec_ref) || !equal(input.capability_ref, template.value.capability_ref) || !equal(input.policy_refs.layout, template.value.layout_policy_ref) || !equal(input.policy_refs.formatting, template.value.formatting_policy_ref) || !equal(input.font_refs, template.value.font_refs)) return productionIssue('POLICY_MISMATCH');
  const rowFields = policy.value.fields.filter(field => field.source_policy === 'row_display');
  if (!unique(input.slot_bindings.map(binding => binding.slot_id)) || template.value.slots.filter(slot => slot.required).some(slot => !input.slot_bindings.some(binding => binding.slot_id === slot.slot_id))) return productionIssue('INCOMPLETE_COMPOSITION');
  for (const binding of input.slot_bindings) {
    const slot = template.value.slots.find(slot => slot.slot_id === binding.slot_id);
    if (!slot) return productionIssue('INCOMPLETE_COMPOSITION');
    switch (binding.source.kind) {
      case 'asset':
        if (!['artwork','overlay'].includes(slot.kind) || !input.asset_uses.some(asset => asset.purpose === slot.kind && equal(asset.asset_ref,binding.source.asset_ref))) return productionIssue('INCOMPLETE_COMPOSITION');
        break;
      case 'value':
        if (slot.kind !== 'text' || slot.field_id !== binding.source.field_id || !Object.hasOwn(input.values,binding.source.field_id)) return productionIssue('INCOMPLETE_COMPOSITION');
        break;
      case 'fact':
        if (slot.kind !== 'text' || !input.fact_bindings.some(fact => fact.slot_id === slot.slot_id && fact.fact_key === binding.source.fact_key)) return productionIssue('INCOMPLETE_COMPOSITION');
        break;
      case 'policy':
        if (!['shape','guide'].includes(slot.kind) || !equal(binding.source.policy_ref,input.policy_refs.layout)) return productionIssue('INCOMPLETE_COMPOSITION');
        break;
      default: return productionIssue('INCOMPLETE_COMPOSITION');
    }
  }
  if (Object.keys(input.values).some(key => !rowFields.some(field => field.field_id === key))) return productionIssue('READONLY_FACT');
  for (const field of rowFields) {
    const value = input.values[field.field_id];
    if (field.required && (!value || value.kind !== 'display' || value.value.length === 0)) return productionIssue('ROW_SCHEMA');
    if (value?.kind === 'display' && value.value.length > field.maximum_utf16_units) return productionIssue('ROW_SCHEMA');
  }
  const readonly = policy.value.fields.filter(field => field.source_policy === 'approved_fact_readonly');
  if (input.fact_bindings.length !== readonly.length || !unique(input.fact_bindings.map(value => value.slot_id))) return productionIssue('READONLY_FACT');
  for (const field of readonly) {
    const binding = input.fact_bindings.find(value => value.slot_id === field.slot_id);
    const fact = facts.value.facts.find(value => value.key === binding?.fact_key);
    if (!fact || fact.status !== 'known' || typeof fact.value !== 'string' || binding.value_hash !== hashManifest({ kind: 'display', value: fact.value })) return productionIssue('READONLY_FACT');
  }
  if (input.input_binding_hash !== hashManifest({ values: input.values, fact_bindings: input.fact_bindings, facts_ref: input.facts_ref, formatting: input.policy_refs.formatting })) return productionIssue('HASH_MISMATCH');
  if (input.barcode.state === 'bound' && (!template.value.slots.some(slot => slot.slot_id === input.barcode.slot_id) || input.barcode.input_hash !== input.input_binding_hash)) return productionIssue('HASH_MISMATCH');
  const expected = context.asset_bytes;
  if (!expected || Object.keys(expected).length !== input.asset_uses.length || !unique(input.asset_uses.map(asset => asset.asset_ref.id))) return productionIssue('ASSET_MISSING');
  for (const asset of input.asset_uses) {
    const bytes = expected[asset.asset_ref.id];
    if (!(bytes instanceof Uint8Array)) return productionIssue('ASSET_MISSING');
    if (bytes.byteLength > 64 * 1024 * 1024 || hashBytes(bytes) !== asset.asset_ref.content_hash) return productionIssue('HASH_MISMATCH');
  }
  return parsed;
}

/** Exact six-decimal mm strings, bounded by the independently supplied private limit. */
export function nmToPrivateMillimetres(input, maximumNm) {
  if (typeof input !== 'string' || !validNm(input) || typeof maximumNm !== 'string' || !/^[1-9][0-9]{0,9}$/.test(maximumNm) || BigInt(maximumNm) > 2000000000n) return productionIssue('LEGACY_UNREPRESENTABLE');
  const signed = BigInt(input), value = signed < 0n ? -signed : signed;
  if (value > BigInt(maximumNm)) return productionIssue('LEGACY_UNREPRESENTABLE');
  return productionOk((signed < 0n ? '-' : '') + (value / 1000000n) + '.' + (value % 1000000n).toString().padStart(6, '0'));
}
export function privateMillimetresToNm(input, maximumNm) {
  if (typeof input !== 'string' || !/^-?(?:0|[1-9][0-9]{0,3})\.[0-9]{6}$/.test(input) || input === '-0.000000') return productionIssue('LEGACY_UNREPRESENTABLE');
  const nm = BigInt(input.replace('.', '')).toString();
  const roundtrip = nmToPrivateMillimetres(nm, maximumNm);
  return roundtrip.ok && roundtrip.value === input ? productionOk(nm) : productionIssue('LEGACY_UNREPRESENTABLE');
}

export function translateProductionGeometry(input, context) {
  if (context === null || typeof context !== 'object' || Array.isArray(context) || !checkTrustedContext(context.scope, context.scope).ok) return productionIssue('INVALID_TRUST_CONTEXT');
  const spec = checkPrintSpec(input, { trusted_scope: context.scope });
  if (!spec.ok) return spec;
  const c = spec.value.constraints;
  if (![c.geometry.trim, c.geometry.printable, c.inset_geometry_basis, c.minimum_bleed, c.minimum_safe_area, c.surfaces].every(state => state.state === 'known')) return productionIssue('GEOMETRY_UNCONFIRMED');
  if (!context.maximum_nm) return productionIssue('LEGACY_UNREPRESENTABLE');
  const result = {};
  for (const [name, geometry] of Object.entries({ trim: c.geometry.trim.value, printable: c.geometry.printable.value, bleed: c.minimum_bleed.value, safe: c.minimum_safe_area.value })) {
    result[name] = {};
    for (const [key, value] of Object.entries(geometry)) if (key.endsWith('_nm')) {
      const converted = nmToPrivateMillimetres(value, context.maximum_nm);
      if (!converted.ok) return converted;
      result[name][key.replace('_nm', '_mm')] = converted.value;
    }
  }
  return productionOk({ unit: 'mm', geometry: result, surfaces: c.surfaces.value, evidence_mode: 'supplied_values_only' });
}

export function compareProductionTemplates(prior, current, scope) {
  const before = checkTemplateSpec(prior, scope), after = checkTemplateSpec(current, scope);
  if (!before.ok) return before;
  if (!after.ok) return after;
  const fields = ['coordinate_geometry', 'orientation', 'minimum_effective_dpi', 'export_formats', 'font_refs', 'slots', 'spec_ref', 'capability_ref', 'layout_policy_ref', 'color_policy_ref', 'formatting_policy_ref', 'personalization_schema_ref', 'warning_policy_ref', 'proof_policy_ref'];
  const changed = fields.filter(key => !equal(prior[key], current[key]));
  return productionOk({ changed_fields: changed, relayout: changed.length > 0, reapproval: changed.length > 0, eligibility: 'unknown' });
}
