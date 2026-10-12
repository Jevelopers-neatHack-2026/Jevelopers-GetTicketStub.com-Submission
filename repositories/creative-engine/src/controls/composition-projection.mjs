/** Trusted control policy consumer. A projection is derived AFTER the immutable
 * neutral revision is hashed; it is never inserted into that revision. */
import { canonicalHash } from 'creative-engine/contracts';
import { createCompositionEditPlan } from 'creative-engine/contracts/approval-handoff';
import { applyCompositionPlan, validateCompositionRevision } from 'creative-engine/contracts/composition-authority';
import { canonical, snapshotControlJson, validId, isRecord } from './schema.mjs';
import { projectPublicTelemetry } from 'creative-engine/telemetry';

export const COMPOSITION_CONTROL_VERSION = 'creative-composition-controls/1.0';
export const COMPOSITION_APPLY_VERSION = 'creative-composition-apply/1.0';
const exact = (value, keys) => isRecord(value) && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export class CompositionControlsError extends TypeError {
  constructor(code, field) { super('The composition controls request could not be validated.'); this.code = code; this.field = field; }
}
const fail = (field, code = 'invalid_request') => { throw new CompositionControlsError(code, field); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const fields = ['name_size', 'layout', 'logo_position', 'layout_emphasis'];
const equal = (a, b) => canonical(a) === canonical(b);
const options = { name_size: ['small', 'medium', 'large'], layout: ['centered', 'stacked'], logo_position: ['top', 'bottom'], layout_emphasis: ['balanced', 'name'] };

/** This is authenticated owner configuration, never a browser request. There
 * are no default category-to-geometry mappings. Fixtures declare theirs. */
export function validateCompositionControlPolicy(input) {
  const p = snapshotControlJson(input);
  if (!exact(p, ['contract', 'schema_version', 'policy_id', 'policy_version', 'targets', 'name_sizes', 'layouts', 'logos', 'locked_fields', 'text_limit', 'allow_text', 'size_bounds', 'checked_at', 'expires_at']) ||
      p.contract !== 'CreativeCompositionControlPolicy' || p.schema_version !== '1.0' || !validId(p.policy_id) || !validId(p.policy_version) ||
      !exact(p.targets, ['name_layer_id', 'layout_layer_id', 'logo_layer_id', 'logo_asset_id']) || Object.values(p.targets).some(x => !validId(x)) ||
      !exact(p.name_sizes, options.name_size) || !exact(p.layouts, ['centered', 'stacked_balanced', 'stacked_name']) || !exact(p.logos, options.logo_position) ||
      !Array.isArray(p.locked_fields) || p.locked_fields.some(x => !fields.includes(x)) || new Set(p.locked_fields).size !== p.locked_fields.length ||
      !Number.isSafeInteger(p.text_limit) || p.text_limit < 1 || p.text_limit > 256 || typeof p.allow_text !== 'boolean' ||
      !Number.isSafeInteger(p.checked_at) || !Number.isSafeInteger(p.expires_at) || p.checked_at >= p.expires_at) fail('policy');
  const decimal = x => typeof x === 'string' && /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(x) && Number(x) > 0 && Number(x) <= 1000;
  if (!exact(p.size_bounds, ['min_value','max_value','units']) || !decimal(p.size_bounds.min_value) || !decimal(p.size_bounds.max_value) || Number(p.size_bounds.min_value) > Number(p.size_bounds.max_value) ||
      !Array.isArray(p.size_bounds.units) || !p.size_bounds.units.length || p.size_bounds.units.some(x=>!['pt','px'].includes(x)) || new Set(p.size_bounds.units).size !== p.size_bounds.units.length) fail('bounds');
  for (const size of Object.values(p.name_sizes)) if (!exact(size, ['value', 'unit']) || typeof size.value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(size.value) || Number(size.value) <= 0 || Number(size.value) > Number(p.size_bounds.max_value) || Number(size.value) < Number(p.size_bounds.min_value) || !p.size_bounds.units.includes(size.unit)) fail('size');
  for (const layout of [...Object.values(p.layouts), ...Object.values(p.logos)]) {
    if (!isRecord(layout) || Object.keys(layout).some(k => !['x_milli', 'y_milli', 'width_milli', 'height_milli'].includes(k)) ||
        !['x_milli', 'y_milli'].every(k => Number.isSafeInteger(layout[k]) && layout[k] >= 0 && layout[k] <= 1000) ||
        ['width_milli', 'height_milli'].some(k => Object.hasOwn(layout, k) && (!Number.isSafeInteger(layout[k]) || layout[k] < 1 || layout[k] > 1000)) ||
        (layout.width_milli !== undefined && layout.x_milli + layout.width_milli > 1000) || (layout.height_milli !== undefined && layout.y_milli + layout.height_milli > 1000)) fail('layout');
  }
  for (const entries of [Object.values(p.name_sizes), Object.values(p.layouts), Object.values(p.logos)]) if (new Set(entries.map(canonical)).size !== entries.length) fail('ambiguous policy');
  return freeze(p);
}

function templates(policy, values) {
  const t = policy.targets, result = [];
  if (values.name_size !== undefined) result.push({ kind: 'set_text_size', layer_id: t.name_layer_id, size: policy.name_sizes[values.name_size] });
  // q01 and c02 share one explicit joint table. They never last-write-win.
  if (values.layout !== undefined || values.layout_emphasis !== undefined) {
    const layout = values.layout === 'centered' ? policy.layouts.centered : policy.layouts[`stacked_${values.layout_emphasis}`];
    if (!layout) fail('joint layout');
    result.push({ kind: 'set_layer_layout', layer_id: t.layout_layer_id, layout });
  }
  if (values.logo_position !== undefined) result.push({ kind: 'position_approved_logo', layer_id: t.logo_layer_id, asset_id: t.logo_asset_id, layout: policy.logos[values.logo_position] });
  return result;
}

export function createCompositionControlProjection({ revision, preview_bytes, policy, principal, selection_revision, can_apply, now_ms }) {
  principal = snapshotControlJson(principal); policy = validateCompositionControlPolicy(policy);
  if (!exact(principal, ['actor_id', 'tenant_id', 'project_id']) || Object.values(principal).some(x => !validId(x)) || typeof can_apply !== 'boolean' ||
      !Number.isSafeInteger(now_ms) || policy.checked_at > now_ms || policy.expires_at <= now_ms) fail('authority');
  revision = validateCompositionRevision(revision, { trustedScope: { ...principal, brief_id: revision.brief_id }, previewBytes: preview_bytes, nowMs: now_ms });
  if (revision.dependencies.selection_revision !== selection_revision) fail('selection', 'stale_version');
  const p = policy.targets, layers = new Map(revision.layer_manifest.map(x => [x.layer_id, x])), geometry = new Map(revision.geometry.map(x => [x.layer_id, x]));
  if (layers.get(p.name_layer_id)?.kind !== 'text' || !layers.has(p.layout_layer_id) || layers.get(p.logo_layer_id)?.kind !== 'approved_asset' || layers.get(p.logo_layer_id).asset_id !== p.logo_asset_id) fail('targets');
  const lockedLayers = revision.dependencies.edit_policy.locked_layer_ids;
  const denied = field => !can_apply || policy.locked_fields.includes(field) || lockedLayers.includes(field === 'name_size' ? p.name_layer_id : field === 'logo_position' ? p.logo_layer_id : p.layout_layer_id) ||
    (field === 'logo_position' && !revision.dependencies.asset_rights.some(x => x.asset_id === p.logo_asset_id && x.action === 'modify'));
  const match = (table, actual) => Object.keys(table).find(k => equal(table[k], actual)) ?? null;
  const layoutKey = match(policy.layouts, geometry.get(p.layout_layer_id).layout);
  const values = { name_size: match(policy.name_sizes, geometry.get(p.name_layer_id).text_size), layout: layoutKey === 'centered' ? 'centered' : layoutKey?.startsWith('stacked_') ? 'stacked' : null,
    logo_position: match(policy.logos, geometry.get(p.logo_layer_id).layout), layout_emphasis: layoutKey?.startsWith('stacked_') ? layoutKey.slice(8) : null };
  const textAllowed = can_apply && policy.allow_text && !lockedLayers.includes(p.name_layer_id) && !revision.dependencies.edit_policy.factual_text_layers.some(x => x.layer_id === p.name_layer_id);
  const base = { tenant_id: revision.tenant_id, project_id: revision.project_id, brief_id: revision.brief_id, composition_id: revision.composition_id,
    revision_id: revision.revision_id, revision_sha256: revision.revision_sha256, state_sha256: revision.state_sha256,
    design_version_id: revision.dependencies.design_version_id, design_version_sha256: revision.dependencies.design_version_sha256, artwork_sha256: revision.dependencies.artwork_sha256,
    selection_revision, edit_policy_sha256: revision.dependencies.edit_policy.policy_sha256, control_policy_sha256: canonicalHash(policy), preview_sha256: revision.preview.preview_sha256 };
  const categories = fields.map(field => ({ field, current_value: values[field], options: options[field], locked: denied(field),
    ...(field === 'layout_emphasis' ? { when: { field: 'layout', value: 'stacked' }, required: true } : {}) }));
  const body = { contract: 'CreativeCompositionControlProjection', schema_version: COMPOSITION_CONTROL_VERSION, base, categories,
    exact_controls: { text: { layer_id: p.name_layer_id, value: layers.get(p.name_layer_id).value, max_length: policy.text_limit, locked: !textAllowed },
      text_size: { layer_id: p.name_layer_id, value: geometry.get(p.name_layer_id).text_size, locked: denied('name_size'), bounds: policy.size_bounds },
      layout: { layer_id: p.layout_layer_id, value: geometry.get(p.layout_layer_id).layout, locked: denied('layout') },
      logo: { layer_id: p.logo_layer_id, asset_id: p.logo_asset_id, value: geometry.get(p.logo_layer_id).layout, locked: denied('logo_position') } },
    expires_at: Math.min(policy.expires_at, revision.preview.expires_at, revision.dependencies.edit_policy.expires_at, revision.dependencies.authority_proof.expires_at), approval: false, purchase: false };
  // Validate every declared template against real C04 targets and neutral policy.
  for (const size of options.name_size) validateTemplates(revision, templates(policy, { name_size: size }), principal, 'policy-validation', true);
  for (const layout of ['centered', 'stacked']) for (const emphasis of layout === 'centered' ? ['balanced'] : options.layout_emphasis) validateTemplates(revision, templates(policy, { layout, layout_emphasis: emphasis }), principal, 'policy-validation', true);
  for (const logo_position of options.logo_position) validateTemplates(revision, templates(policy, { logo_position }), principal, 'policy-validation', true);
  return freeze({ ...body, projection_sha256: canonicalHash(body) });
}

function validateTemplates(revision, operations, principal, actionId, shapeOnly = false) {
  const plan = createCompositionEditPlan({ plan_id: `plan:${actionId}`, binding: revision.binding, layer_manifest: revision.layer_manifest,
    target_composition_revision_id: `revision:${actionId}`, operations: operations.map((x, i) => ({ operation_id: `op:${actionId}:${i}`, ...x })), trustedScope: principal });
  // Shape-only verification deliberately does not remove actual locks. Locked
  // templates remain visible but cannot pass the execution validator below.
  if (!shapeOnly) applyCompositionPlan(revision, plan, principal);
  return plan;
}

/** Rebuild from the fresh trusted projection; no operation templates are accepted
 * from a caller. Exact controls and categoricals cannot write the same field. */
export function createCompositionControlPlan({ revision, policy, projection, action }) {
  action = snapshotControlJson(action);
  if (action.action_version !== COMPOSITION_APPLY_VERSION) fail('action_version', 'unsupported_version');
  if (action.projection_sha256 !== projection.projection_sha256) fail('projection', 'stale_version');
  if (!exact(action, ['action_version', 'action_id', 'projection_sha256', 'intent', 'draft']) || !validId(action.action_id) || action.intent !== 'apply' ||
      !exact(action.draft, ['categories', 'exact']) || !isRecord(action.draft.categories) || !isRecord(action.draft.exact)) fail('action');
  const body = { ...projection }; delete body.projection_sha256;
  if (canonicalHash(body) !== projection.projection_sha256 || canonicalHash(validateCompositionControlPolicy(policy)) !== projection.base.control_policy_sha256 || revision.revision_sha256 !== projection.base.revision_sha256) fail('projection binding');
  const draft = action.draft, values = {};
  for (const [field, value] of Object.entries(draft.categories)) {
    const control = projection.categories.find(x => x.field === field);
    if (!control || !control.options.includes(value)) fail('category');
    if (control.locked) fail('category.locked', 'permission_denied');
    values[field] = value;
  }
  if (values.layout === 'stacked' && values.layout_emphasis === undefined) fail('q01 required');
  if (values.layout_emphasis !== undefined && (values.layout ?? projection.categories.find(x => x.field === 'layout').current_value) !== 'stacked') fail('q01 inactive');
  if (values.layout_emphasis !== undefined && values.layout === undefined) values.layout = 'stacked';
  for (const field of Object.keys(values)) if (field !== 'layout_emphasis' && values[field] === projection.categories.find(x => x.field === field).current_value) delete values[field];
  if (values.layout === undefined && values.layout_emphasis !== undefined && values.layout_emphasis === projection.categories.find(x => x.field === 'layout_emphasis').current_value) delete values.layout_emphasis;
  const operations = templates(policy, values);
  const exactMap = { text: ['set_text', 'value', null], text_size: ['set_text_size', 'size', 'name_size'], layout: ['set_layer_layout', 'layout', 'layout'], logo: ['position_approved_logo', 'layout', 'logo_position'] };
  for (const [field, value] of Object.entries(draft.exact)) {
    const map = exactMap[field], control = projection.exact_controls[field];
    if (!map || !control || (map[2] !== null && Object.hasOwn(draft.categories, map[2])) || (field === 'layout' && Object.hasOwn(draft.categories, 'layout_emphasis'))) fail('exact conflict');
    if (control.locked) fail('exact.locked', 'permission_denied');
    if (field === 'text' && (typeof value !== 'string' || !value.length || value.length > control.max_length || /[<>\u0000-\u001f\u007f]/.test(value) || projectPublicTelemetry({ text: value }).redactions.length)) fail('text');
    if (field === 'text_size' && (!exact(value, ['value','unit']) || !control.bounds.units.includes(value.unit) || Number(value.value) < Number(control.bounds.min_value) || Number(value.value) > Number(control.bounds.max_value))) fail('exact size bounds');
    if (!equal(value, control.value)) operations.push({ kind: map[0], layer_id: control.layer_id, [map[1]]: value, ...(field === 'logo' ? { asset_id: control.asset_id } : {}) });
  }
  if (!operations.length || operations.length > 4 || new Set(operations.map(x => `${x.layer_id}:${x.kind === 'set_layer_layout' || x.kind === 'position_approved_logo' ? 'layout' : x.kind}`)).size !== operations.length) fail('empty or overlapping plan');
  // Explicit stable order: manifest order, then operation kind. IDs are bound to
  // the durable reviewed action; retry reconstructs identical request bytes.
  operations.sort((a, b) => revision.layer_manifest.findIndex(x => x.layer_id === a.layer_id) - revision.layer_manifest.findIndex(x => x.layer_id === b.layer_id) || a.kind.localeCompare(b.kind));
  const plan = validateTemplates(revision, operations, projection.base, action.action_id);
  if (!equal(operations, plan.operations.map(({ operation_id: _id, ...x })=>x))) fail('noncanonical exact operation');
  return plan;
}
