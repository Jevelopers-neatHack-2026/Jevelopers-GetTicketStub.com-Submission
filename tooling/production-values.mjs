import { validateContract, checkTrustedContext, canonicalJson, hashManifest, hashBytes } from './runtime.mjs';
import { checkPrintSpec } from './capability.mjs';
import { productionIssue, productionOk } from './production-errors.mjs';
import { productionReferences } from './production-operations.mjs';

export function productionContentHash(value) {
  return hashManifest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'content_hash')));
}
const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
const unique = values => new Set(values).size === values.length;
const inside = (inner, outer) => BigInt(inner.x_nm) >= BigInt(outer.x_nm) && BigInt(inner.y_nm) >= BigInt(outer.y_nm) && BigInt(inner.x_nm) + BigInt(inner.width_nm) <= BigInt(outer.x_nm) + BigInt(outer.width_nm) && BigInt(inner.y_nm) + BigInt(inner.height_nm) <= BigInt(outer.y_nm) + BigInt(outer.height_nm);
const validNm = value => /^(?:0|-?[1-9][0-9]{0,9})$/.test(value) && BigInt(value) >= -2000000000n && BigInt(value) <= 2000000000n;

export function checkTemplateSpec(input, scope) {
  const parsed = validateContract('TemplateSpec', input);
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
  const parsed = validateContract('PersonalizationSchema', input);
  if (!parsed.ok) return parsed;
  if (!checkTrustedContext(input, { tenant_id: template.tenant_id, project_id: template.project_id }).ok) return productionIssue('NOT_FOUND');
  if (input.content_hash !== productionContentHash(input) || template.personalization_schema_ref.id !== input.schema_id || template.personalization_schema_ref.revision !== input.revision || template.personalization_schema_ref.content_hash !== input.content_hash) return productionIssue('HASH_MISMATCH');
  if (!unique(input.fields.map(field => field.field_id)) || !unique(input.fields.map(field => field.slot_id)) || input.fields.length > input.limits.maximum_fields) return productionIssue('ROW_SCHEMA');
  for (const field of input.fields) if (!template.slots.some(slot => slot.slot_id === field.slot_id && slot.field_id === field.field_id && slot.kind === 'text')) return productionIssue('ROW_SCHEMA');
  return parsed;
}

/** Supported facts and resolved input commitments must be independently supplied. */
export function checkComposition(input, context) {
  const parsed = validateContract('Composition', input);
  if (!parsed.ok) return parsed;
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
  const facts = validateContract('EventIntelligencePackage', context.facts.package);
  if (!facts.ok || !checkTrustedContext(facts.value, context.scope).ok || !equal(input.facts_ref, context.facts.reference) || input.facts_ref.id !== facts.value.package_id || input.facts_ref.revision !== facts.value.package_version || input.facts_ref.content_hash !== facts.value.package_hash || facts.value.package_hash !== hashManifest(Object.fromEntries(Object.entries(facts.value).filter(([key]) => key !== 'package_hash')))) return productionIssue('FACTS_UNSUPPORTED');
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
