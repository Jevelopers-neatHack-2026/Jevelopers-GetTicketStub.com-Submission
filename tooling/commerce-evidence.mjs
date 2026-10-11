import { validateContract, validatePrimitive, checkTrustedContext, canonicalJson, hashManifest, hashBytes, projectEvidence, ContractError } from './runtime.mjs';
import { validateVersionedReference } from './operations.mjs';
import { DefinitionApprovalBinding } from '../generated/validators.mjs';
const ok = value => ({ ok: true, value });
const fail = (code, path = '') => ({ ok: false, errors: [{ code, path }] });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && new Set(a).size === a.length && a.every(value => b.includes(value));
const recordReference = (reference, record, identity) => reference.contract === record.contract && reference.schema_version === record.schema_version && Object.entries(identity).every(([key, value]) => reference[key] === value);

export function commerceContentHash(value, field) {
  canonicalJson(value);
  if (!object(value) || !['receipt_hash', 'manifest_hash', 'bundle_hash', 'quote_hash', 'authorization_hash', 'evidence_hash'].includes(field)) throw new ContractError('INVALID_PAYLOAD');
  const copy = Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
  if (field === 'manifest_hash' && object(copy.access)) copy.access = Object.fromEntries(Object.entries(copy.access).filter(([key]) => !['locator_ref', 'expires_at'].includes(key)));
  return hashManifest(copy);
}

function refs(value, path = '', slot = false) {
  if (value === null || typeof value !== 'object') return [];
  if (slot && object(value) && Object.hasOwn(value, 'id') && Object.hasOwn(value, 'schema_version') && Object.hasOwn(value, 'content_hash')) return [[path, value]];
  return Object.entries(value).flatMap(([key, child]) => refs(child, path ? path + '/' + key : key, key.endsWith('_ref') || key.endsWith('_refs') || key === 'reference' || (slot && Array.isArray(value))));
}

function boundary(contract, input, context) {
  const parsed = validateContract(contract, input); if (!parsed.ok) return parsed;
  if (!object(context)) return fail('INVALID_TRUST_CONTEXT');
  try { canonicalJson(Object.fromEntries(Object.entries(context).filter(([key]) => key !== 'artifact_bytes'))); } catch (error) { if (error instanceof ContractError) return fail('INVALID_TRUST_CONTEXT'); throw error; }
  if (!validatePrimitive('UtcTime', context.now).ok || context.policy_version !== '1.0.0' || !object(context.references)) return fail('INVALID_TRUST_CONTEXT');
  const scoped = checkTrustedContext(parsed.value, context.scope); if (!scoped.ok) return scoped;
  for (const [path, reference] of refs(parsed.value)) {
    const expected = context.references[path];
    if (!validateVersionedReference(expected).ok) return fail('INVALID_TRUST_CONTEXT', '/' + path);
    if (!same(reference, expected)) return fail('REFERENCE_MISMATCH', '/' + path);
  }
  return parsed;
}

function approvalState(context, requireValid = true) {
  const current = context.current_approval;
  if (!object(current) || !['valid', 'rejected', 'stale', 'expired', 'revoked', 'unavailable'].includes(current.status) || !validatePrimitive('UtcTime', current.checked_at).ok || Date.parse(current.checked_at) > Date.parse(context.now) || !token(context.actor_id) || !token(context.audience)) return fail('INVALID_TRUST_CONTEXT', '/current_approval');
  const receipt = validateContract('ApprovalReceipt', current.receipt);
  if (!receipt.ok || !checkTrustedContext(receipt.value, context.scope).ok || !DefinitionApprovalBinding(context.expected_binding)) return fail('INVALID_TRUST_CONTEXT', '/current_approval');
  const r = receipt.value;
  if (r.receipt_hash !== commerceContentHash(r, 'receipt_hash')) return fail('INVALID_TRUST_CONTEXT', '/current_approval');
  if (r.issuer !== 'getticketstub.com' || r.audience !== context.audience || r.actor_id !== context.actor_id || !same(r.binding, context.expected_binding)) return fail('STALE_APPROVAL', '/binding');
  if (requireValid && current.status !== 'valid') return fail('STALE_APPROVAL', '/status_ref');
  if (Date.parse(r.issued_at) > Date.parse(context.now) || Date.parse(r.expires_at) <= Date.parse(r.issued_at)) return fail('INVALID_TRUST_CONTEXT', '/current_approval');
  if (requireValid && Date.parse(r.expires_at) <= Date.parse(context.now)) return fail('EXPIRED', '/expires_at');
  return receipt;
}

export function checkApprovalReceipt(input, context) {
  const parsed = boundary('ApprovalReceipt', input, context); if (!parsed.ok) return parsed;
  const current = approvalState(context); if (!current.ok) return current;
  if (!same(parsed.value, current.value)) return fail('STALE_APPROVAL', '/binding');
  return parsed;
}

export function checkApprovalReference(input, context) {
  const parsed = boundary('ApprovalReference', input, context); if (!parsed.ok) return parsed;
  const current = approvalState(context); if (!current.ok) return current;
  const v = parsed.value, r = current.value;
  if (v.approval_id !== r.approval_id || !recordReference(v.receipt_ref, r, { id: r.approval_id, content_hash: r.receipt_hash }) || v.binding_hash !== hashManifest(r.binding) || v.intended_use !== r.binding.intended_use || v.audience !== context.audience) return fail('STALE_APPROVAL', '/receipt_ref');
  return parsed;
}

export function checkApprovalVerificationRequest(input, context) {
  const parsed = boundary('ApprovalVerificationRequest', input, context); if (!parsed.ok) return parsed;
  const current = approvalState(context, false); if (!current.ok) return current;
  if (parsed.value.expected_audience !== context.audience || !same(parsed.value.expected_binding, context.expected_binding) || !recordReference(parsed.value.approval_ref, current.value, { id: current.value.approval_id, content_hash: current.value.receipt_hash })) return fail('STALE_APPROVAL', '/expected_binding');
  return parsed;
}

export function checkApprovalVerificationOutcome(input, context) {
  const parsed = boundary('ApprovalVerificationOutcome', input, context); if (!parsed.ok) return parsed;
  const current = approvalState(context, false); if (!current.ok) return current;
  const request = checkApprovalVerificationRequest(context.verification_request, { ...context, references: context.verification_request_references });
  if (!request.ok) return fail('INVALID_TRUST_CONTEXT', '/verification_request');
  const v = parsed.value;
  if (v.request_id !== request.value.request_id || !recordReference(v.request_ref, request.value, { id: request.value.request_id, content_hash: hashManifest(request.value) }) || v.status !== context.current_approval.status || v.checked_at !== context.current_approval.checked_at) return fail('INVALID_RECEIPT', '/status');
  if (v.status === 'valid') {
    const valid = approvalState(context); if (!valid.ok) return valid;
    if (!v.receipt_ref || !recordReference(v.receipt_ref, valid.value, { id: valid.value.approval_id, content_hash: valid.value.receipt_hash }) || !v.verified_binding || !same(v.verified_binding, context.expected_binding)) return fail('INVALID_RECEIPT', '/verified_binding');
  } else if (v.verified_binding !== null) return fail('INVALID_RECEIPT', '/verified_binding');
  if (v.receipt_ref && !recordReference(v.receipt_ref, current.value, { id: current.value.approval_id, content_hash: current.value.receipt_hash })) return fail('INVALID_RECEIPT', '/receipt_ref');
  return parsed;
}

function verifyBytes(artifact, bytesById, path) {
  const bytes = bytesById?.[artifact.artifact_id];
  if (!(bytes instanceof Uint8Array)) return fail('INVALID_TRUST_CONTEXT', path);
  if (bytes.length !== artifact.byte_size || hashBytes(bytes) !== artifact.byte_hash) return fail('REFERENCE_MISMATCH', path + '/byte_hash');
  return ok(artifact);
}

export function checkArtifactHandoffManifest(input, context) {
  const parsed = boundary('ArtifactHandoffManifest', input, context); if (!parsed.ok) return parsed;
  const design = validateContract('DesignVersion', context.design); if (!design.ok || !checkTrustedContext(design.value, context.scope).ok || !design.value.artwork || !design.value.preview) return fail('INVALID_TRUST_CONTEXT', '/design');
  const approval = approvalState(context); if (!approval.ok) return approval;
  const v = parsed.value, d = design.value, binding = approval.value.binding;
  if (!validateVersionedReference(context.artwork_ref).ok || !validateVersionedReference(context.preview_ref).ok) return fail('INVALID_TRUST_CONTEXT', '/artwork_ref');
  if (v.manifest_hash !== commerceContentHash(v, 'manifest_hash')) return fail('REFERENCE_MISMATCH', '/manifest_hash');
  if (!recordReference(v.design_ref, d, { id: d.design_version_id, revision: d.revision, content_hash: d.design_hash })) return fail('REFERENCE_MISMATCH', '/design_ref');
  if (v.artwork.role !== 'source_artwork' || v.artwork.artifact_id !== d.artwork.artifact_id || v.artwork.byte_hash !== d.artwork.byte_hash || v.artwork.media_type !== d.artwork.media_type || v.artwork.byte_size !== d.artwork.byte_size || v.preview_ref.id !== d.preview.artifact_id || v.preview_ref.content_hash !== d.preview.byte_hash) return fail('REFERENCE_MISMATCH', '/artwork');
  if (!recordReference(v.approval_ref, approval.value, { id: approval.value.approval_id, content_hash: approval.value.receipt_hash }) || binding.subject_type !== 'artwork' || binding.subject_ref.contract !== 'Artifact' || !same(binding.subject_ref, v.artwork_ref) || !same(v.artwork_ref, context.artwork_ref) || v.artwork_ref.id !== d.artwork.artifact_id || v.artwork_ref.content_hash !== d.artwork.byte_hash || !same(binding.preview_ref, v.preview_ref) || !same(v.preview_ref, context.preview_ref) || v.preview_ref.id !== d.preview.artifact_id || v.preview_ref.content_hash !== d.preview.byte_hash || binding.intended_use !== 'production' || binding.composition_hash !== v.composition_hash || !same(binding.facts_ref, v.facts_ref) || binding.facts_hash !== v.facts_ref.content_hash) return fail('STALE_APPROVAL', '/approval_ref');
  if (Date.parse(v.access.expires_at) <= Date.parse(context.now)) return fail('EXPIRED', '/access/expires_at');
  const bytes = verifyBytes(v.artwork, context.artifact_bytes, '/artwork'); return bytes.ok ? parsed : bytes;
}

export function checkArtifactConsumptionReceipt(input, context) {
  const parsed = boundary('ArtifactConsumptionReceipt', input, context); if (!parsed.ok) return parsed;
  const handoff = validateContract('ArtifactHandoffManifest', context.handoff); if (!handoff.ok || !checkTrustedContext(handoff.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/handoff');
  const approval = approvalState(context); if (!approval.ok) return approval;
  const v = parsed.value, h = handoff.value;
  const binding = approval.value.binding;
  if (h.manifest_hash !== commerceContentHash(h, 'manifest_hash')) return fail('INVALID_TRUST_CONTEXT', '/handoff/manifest_hash');
  if (!same(v.approval_ref, h.approval_ref) || !recordReference(h.approval_ref, approval.value, { id: approval.value.approval_id, content_hash: approval.value.receipt_hash }) || binding.intended_use !== 'production' || binding.subject_type !== 'artwork' ||
      binding.subject_ref.contract !== 'Artifact' || !same(binding.subject_ref, h.artwork_ref) || !same(binding.preview_ref, h.preview_ref) ||
      !same(binding.facts_ref, h.facts_ref) || binding.facts_hash !== h.facts_ref.content_hash || binding.composition_hash !== h.composition_hash ||
      !same(context.artwork_ref, h.artwork_ref) || !same(context.preview_ref, h.preview_ref) ||
      h.artwork_ref.id !== h.artwork.artifact_id || h.artwork_ref.content_hash !== h.artwork.byte_hash) return fail('STALE_APPROVAL', '/approval_ref');
  const design = validateContract('DesignVersion', context.design);
  if (!design.ok || !checkTrustedContext(design.value, context.scope).ok || !design.value.artwork || !design.value.preview ||
      !recordReference(h.design_ref, design.value, { id: design.value.design_version_id, revision: design.value.revision, content_hash: design.value.design_hash }) ||
      ['artifact_id', 'role', 'byte_hash', 'byte_size', 'media_type'].some(key => h.artwork[key] !== design.value.artwork[key]) ||
      h.preview_ref.id !== design.value.preview.artifact_id || h.preview_ref.content_hash !== design.value.preview.byte_hash) return fail('INVALID_TRUST_CONTEXT', '/handoff/design_ref');
  if (!token(context.consumer_id)) return fail('INVALID_TRUST_CONTEXT', '/consumer_id');
  if (v.consumer_id !== context.consumer_id || !recordReference(v.manifest_ref, h, { id: h.handoff_id, revision: h.revision, content_hash: h.manifest_hash })) return fail('INVALID_RECEIPT', '/manifest_ref');
  if (v.consumed_artifacts.length !== 1 || !same(v.consumed_artifacts[0], h.artwork) || Date.parse(v.consumed_at) > Date.parse(context.now) ||
      Date.parse(v.consumed_at) >= Date.parse(h.access.expires_at)) return fail('INVALID_RECEIPT', '/consumed_artifacts');
  const bytes = verifyBytes(v.consumed_artifacts[0], context.artifact_bytes, '/consumed_artifacts/0'); if (!bytes.ok) return bytes;
  if (context.prior_consumption) {
    const old = validateContract('ArtifactConsumptionReceipt', context.prior_consumption); if (!old.ok || !checkTrustedContext(old.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/prior_consumption');
    if (old.value.idempotency_key === v.idempotency_key && !same(old.value, v)) return fail('IDENTITY_COLLISION', '/idempotency_key');
  }
  return parsed;
}

export function checkProductionBundle(input, context) {
  const parsed = boundary('ProductionBundle', input, context); if (!parsed.ok) return parsed;
  const h = validateContract('ArtifactHandoffManifest', context.handoff); if (!h.ok || !checkTrustedContext(h.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/handoff');
  if (h.value.manifest_hash !== commerceContentHash(h.value, 'manifest_hash')) return fail('INVALID_TRUST_CONTEXT', '/handoff/manifest_hash');
  const approval = approvalState(context); if (!approval.ok) return approval;
  const v = parsed.value;
  if (!object(context.expected_spec) || !Array.isArray(context.expected_files) || !object(context.expected_composition) || !object(context.preflight)) return fail('INVALID_TRUST_CONTEXT');
  if (v.bundle_hash !== commerceContentHash(v, 'bundle_hash')) return fail('REFERENCE_MISMATCH', '/bundle_hash');
  if (!recordReference(v.handoff_ref, h.value, { id: h.value.handoff_id, revision: h.value.revision, content_hash: h.value.manifest_hash })) return fail('REFERENCE_MISMATCH', '/handoff_ref');
  if (!same(v.print_spec, context.expected_spec) || !same(v.composition, context.expected_composition)) return fail('REFERENCE_MISMATCH', '/composition');
  if (!same(v.files, context.expected_files) || new Set(v.files.map(file => file.filename)).size !== v.files.length || new Set(v.files.map(file => file.artifact_id)).size !== v.files.length || !v.files.some(file => file.role === 'print_output') || !v.files.some(file => file.role === 'composed_preview')) return fail('INVALID_PAYLOAD', '/files');
  for (let i = 0; i < v.files.length; i++) {
    const file = v.files[i];
    if (file.role === 'print_output' && (file.unit !== v.print_spec.unit || file.width !== v.print_spec.width || file.height !== v.print_spec.height)) return fail('INVALID_PAYLOAD', '/files/' + i);
    const bytes = verifyBytes(file, context.artifact_bytes, '/files/' + i); if (!bytes.ok) return bytes;
  }
  if (!same(v.preflight, context.preflight)) return fail('REFERENCE_MISMATCH', '/preflight');
  if (v.preflight.status !== 'passed' || v.preflight.reasons.length) return fail('UNSUPPORTED_CASE', '/preflight/status');
  const binding = approval.value.binding;
  if (binding.intended_use !== 'production' || binding.subject_type !== 'composition' || binding.subject_ref.contract !== 'Composition' || !same(binding.subject_ref, v.composition_ref) || !same(binding.composition_ref, v.composition_ref) || v.composition_ref.content_hash !== v.composition.composition_hash || !same(binding.preview_ref, v.composed_preview_ref) || !same(binding.facts_ref, v.facts_ref) || v.facts_ref.content_hash !== v.composition.facts_hash || v.composed_preview_ref.content_hash !== v.composition.composed_preview_hash || !v.files.some(file => file.role === 'composed_preview' && file.artifact_id === v.composed_preview_ref.id && file.byte_hash === v.composed_preview_ref.content_hash) || binding.facts_hash !== v.composition.facts_hash || binding.composition_hash !== v.composition.composition_hash || !recordReference(v.approval_ref, approval.value, { id: approval.value.approval_id, content_hash: approval.value.receipt_hash })) return fail('STALE_APPROVAL', '/approval_ref');
  if (v.composition.source_artwork_hash !== h.value.artwork.byte_hash || v.composition.displayed_preview_hash !== h.value.preview_ref.content_hash || !v.files.some(file => file.role === 'composed_preview' && file.byte_hash === v.composition.composed_preview_hash)) return fail('REFERENCE_MISMATCH', '/composition');
  return parsed;
}

function moneyValid(value, currency) { return object(value) && value.currency === currency && validatePrimitive('ExactDecimal', value.amount).ok && Number.isSafeInteger(value.scale) && value.scale >= 0 && value.scale <= 18 && (value.amount.split('.')[1]?.length ?? 0) <= value.scale; }
function scaled(value, scale) { const [whole, fraction = ''] = value.split('.'); return BigInt(whole + fraction.padEnd(scale, '0')); }
function compareMoney(a, b) { const scale = Math.max(a.scale, b.scale); const x = scaled(a.amount, scale), y = scaled(b.amount, scale); return x < y ? -1 : x > y ? 1 : 0; }

export function checkFulfillmentQuote(input, context) {
  const parsed = boundary('FulfillmentQuote', input, context); if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!object(context.expected_terms) || !validatePrimitive('Currency', context.currency).ok || !token(context.provider)) return fail('INVALID_TRUST_CONTEXT');
  if (v.provider !== context.provider || v.currency !== context.currency || !same(v.terms, context.expected_terms)) return fail('POLICY_MISMATCH', '/terms');
  if (v.quote_hash !== commerceContentHash(v, 'quote_hash')) return fail('REFERENCE_MISMATCH', '/quote_hash');
  if (Date.parse(v.issued_at) > Date.parse(context.now) || Date.parse(v.expires_at) <= Date.parse(context.now) || Date.parse(v.expires_at) <= Date.parse(v.issued_at)) return fail('EXPIRED', '/expires_at');
  if (v.charges.some(charge => !moneyValid(charge.money, v.currency))) return fail('INVALID_MONEY', '/charges');
  if (v.valuation_basis === 'unknown') return v.total === null ? parsed : fail('INVALID_MONEY', '/total');
  if (!moneyValid(v.total, v.currency) || v.charges.some(charge => !moneyValid(charge.money, v.currency))) return fail('INVALID_MONEY', '/total');
  const scale = Math.max(v.total.scale, ...v.charges.map(charge => charge.money.scale));
  const sum = v.charges.reduce((sum, charge) => sum + (charge.kind === 'discount' ? -1n : 1n) * scaled(charge.money.amount, scale), 0n);
  if (sum < 0n || sum !== scaled(v.total.amount, scale)) return fail('INVALID_MONEY', '/total/amount');
  return parsed;
}

export function checkOrderAuthorization(input, context) {
  const parsed = boundary('OrderAuthorization', input, context); if (!parsed.ok) return parsed;
  const current = context.current_authorization;
  if (!object(current) || !['valid', 'expired', 'revoked', 'unavailable'].includes(current.status) || !validatePrimitive('UtcTime', current.checked_at).ok || Date.parse(current.checked_at) > Date.parse(context.now) || !token(context.actor_id) || !token(context.audience) || !validatePrimitive('OrderId', context.expected_order_id).ok) return fail('INVALID_TRUST_CONTEXT', '/current_authorization');
  const auth = validateContract('OrderAuthorization', current.authorization), quote = validateContract('FulfillmentQuote', context.quote);
  if (!auth.ok || !quote.ok || !checkTrustedContext(auth.value, context.scope).ok || !checkTrustedContext(quote.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT');
  const v = parsed.value;
  const checkedQuote = checkFulfillmentQuote(context.quote, context); if (!checkedQuote.ok) return fail('INVALID_TRUST_CONTEXT', '/quote');
  if (current.status !== 'valid') return fail('STALE_APPROVAL', '/status_ref');
  if (!same(v, auth.value) || v.actor_id !== context.actor_id || v.audience !== context.audience || v.order_id !== context.expected_order_id) return fail('STALE_APPROVAL', '/terms');
  if (v.authorization_hash !== commerceContentHash(v, 'authorization_hash') || auth.value.authorization_hash !== commerceContentHash(auth.value, 'authorization_hash')) return fail('REFERENCE_MISMATCH', '/authorization_hash');
  if (quote.value.valuation_basis !== 'quoted' || !moneyValid(quote.value.total, context.currency) || !moneyValid(v.maximum, context.currency)) return fail('INVALID_MONEY', '/maximum');
  if (!recordReference(v.quote_ref, quote.value, { id: quote.value.quote_id, revision: quote.value.quote_version, content_hash: quote.value.quote_hash }) || !same(v.bundle_ref, quote.value.bundle_ref) || !same(v.terms, quote.value.terms) || !same(v.terms, context.expected_terms)) return fail('STALE_APPROVAL', '/quote_ref');
  if (compareMoney(quote.value.total, v.maximum) > 0) return fail('INVALID_MONEY', '/maximum');
  if (Date.parse(v.issued_at) > Date.parse(context.now) || Date.parse(v.expires_at) <= Date.parse(context.now) || Date.parse(quote.value.expires_at) <= Date.parse(context.now)) return fail('EXPIRED', '/expires_at');
  return parsed;
}

export function checkFulfillmentStatus(input, context) {
  const parsed = boundary('FulfillmentStatus', input, context); if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!validatePrimitive('OrderId', context.expected_order_id).ok || !token(context.provider) || !token(context.external_idempotency_key) || !object(context.status_mapping) || (context.expected_supplier_order_id !== null && !token(context.expected_supplier_order_id))) return fail('INVALID_TRUST_CONTEXT');
  if (v.order_id !== context.expected_order_id || v.provider !== context.provider || v.external_idempotency_key !== context.external_idempotency_key) return fail('SCOPE_MISMATCH', '/order_id');
  if (v.supplier_order_id !== context.expected_supplier_order_id) return fail('IDENTITY_COLLISION', '/supplier_order_id');
  const expected = Object.hasOwn(context.status_mapping, v.provider_status) ? context.status_mapping[v.provider_status] : 'unknown';
  if (v.normalized_status !== expected) return fail('UNSUPPORTED_CASE', '/normalized_status');
  if (Date.parse(v.effective_at) > Date.parse(context.now)) return fail('INVALID_PAYLOAD', '/effective_at');
  if (v.submission_outcome === 'unknown' && (v.execution_uncertainty === 'known' || ['accepted', 'rejected', 'cancelled', 'fulfilled'].includes(v.normalized_status))) return fail('UNCERTAIN_EXECUTION', '/submission_outcome');
  if (v.normalized_status === 'cancelled' && v.cancellation !== 'confirmed') return fail('INVALID_TRANSITION', '/cancellation');
  if (v.cancellation === 'requested' && v.normalized_status === 'cancelled') return fail('INVALID_TRANSITION', '/normalized_status');
  if (context.prior_status) {
    const old = validateContract('FulfillmentStatus', context.prior_status); if (!old.ok || !checkTrustedContext(old.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/prior_status');
    for (const key of ['order_id', 'provider', 'external_idempotency_key', 'provider_attempt_id', 'billable_attempt_id']) if (v[key] !== old.value[key]) return fail('IDENTITY_COLLISION', '/' + key);
    if (old.value.supplier_order_id !== null && v.supplier_order_id !== old.value.supplier_order_id) return fail('IDENTITY_COLLISION', '/supplier_order_id');
    for (const key of ['bundle_ref', 'authorization_ref']) if (!same(v[key], old.value[key])) return fail('IDENTITY_COLLISION', '/' + key);
    if (v.revision === old.value.revision) return same(v, old.value) ? parsed : fail('REVISION_CONFLICT', '/revision');
    if (v.revision !== old.value.revision + 1 || Date.parse(v.effective_at) < Date.parse(old.value.effective_at)) return fail('STALE_REVISION', '/revision');
    if (v.source_observation_id === old.value.source_observation_id || v.event_id === old.value.event_id) return fail('IDENTITY_COLLISION', '/source_observation_id');
    const rank = { created: 0, submission_pending: 1, accepted: 2, in_production: 3, shipped: 4, fulfilled: 5 };
    const intermediate = ['unknown', 'cancel_requested', 'cancel_rejected'];
    const known = intermediate.includes(old.value.normalized_status) ? old.value.last_known_status : old.value.normalized_status;
    if (Object.hasOwn(rank, known) && Object.hasOwn(rank, v.normalized_status) && rank[v.normalized_status] < rank[known]) return fail('INVALID_TRANSITION', '/normalized_status');
    if (['fulfilled', 'cancelled', 'rejected'].includes(old.value.normalized_status) && v.normalized_status !== old.value.normalized_status) return fail('INVALID_TRANSITION', '/normalized_status');
    if (intermediate.includes(v.normalized_status) && v.last_known_status !== known) return fail('INVALID_TRANSITION', '/last_known_status');
    if (['fulfilled', 'cancelled', 'rejected'].includes(known) && !intermediate.includes(v.normalized_status) && v.normalized_status !== known) return fail('INVALID_TRANSITION', '/normalized_status');
  } else if (v.revision !== 1) return fail('INVALID_TRUST_CONTEXT', '/prior_status');
  return parsed;
}

export function checkEvaluationEvidence(input, context) {
  const parsed = boundary('EvaluationEvidence', input, context); if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!Array.isArray(context.acceptance_ids) || !object(context.input) || !Array.isArray(context.components) || !Array.isArray(context.contracts) || !Array.isArray(context.tools) || !Array.isArray(context.commands) || !Array.isArray(context.metrics)) return fail('INVALID_TRUST_CONTEXT');
  if (v.evidence_hash !== commerceContentHash(v, 'evidence_hash')) return fail('REFERENCE_MISMATCH', '/evidence_hash');
  if (!sameSet(v.acceptance_ids, context.acceptance_ids) || !same(v.input, context.input) || !same(v.components, context.components) || !same(v.contracts, context.contracts) || !same(v.tools, context.tools)) return fail('REFERENCE_MISMATCH', '/input');
  if (v.provider_mode !== context.provider_mode || v.dependency_mode !== context.dependency_mode || !same(v.commands, context.commands) || !same(v.metrics, context.metrics)) return fail('POLICY_MISMATCH', '/dependency_mode');
  if (v.finished_at !== null && (Date.parse(v.finished_at) < Date.parse(v.started_at) || Date.parse(v.finished_at) > Date.parse(context.now))) return fail('INVALID_PAYLOAD', '/finished_at');
  for (let i = 0; i < v.metrics.length; i++) {
    const metric = v.metrics[i];
    if ((metric.measurement_status === 'measured') !== (metric.value !== null) || (metric.unit === 'decimal' && metric.value !== null && typeof metric.value !== 'string') || (metric.unit !== 'decimal' && metric.value !== null && typeof metric.value !== 'number')) return fail('INVALID_PAYLOAD', '/metrics/' + i + '/value');
    if (metric.basis === 'baseline_delta' && v.baseline_ref === null) return fail('INVALID_PAYLOAD', '/baseline_ref');
  }
  for (let i = 0; i < v.commands.length; i++) {
    const command = v.commands[i];
    if ((command.status === 'passed' && command.exit_code !== 0) || (command.status === 'failed' && (command.exit_code === null || command.exit_code === 0)) || (['planned', 'unknown', 'blocked'].includes(command.status) && command.exit_code !== null)) return fail('INVALID_PAYLOAD', '/commands/' + i + '/exit_code');
  }
  if (v.status === 'passed' && (v.finished_at === null || !v.commands.length || v.commands.some(command => command.status !== 'passed') || v.metrics.some(metric => metric.measurement_status !== 'measured') || v.dependency_mode === 'unknown' || v.provider_mode === 'unknown')) return fail('INVALID_PAYLOAD', '/status');
  if (['planned', 'unmeasured', 'unknown', 'blocked'].includes(v.status) && !v.limitations.length) return fail('INVALID_PAYLOAD', '/limitations');
  if (new Set(v.components.map(c => c.name)).size !== v.components.length || new Set(v.commands.map(c => c.command_id)).size !== v.commands.length || new Set(v.metrics.map(c => c.metric_id)).size !== v.metrics.length) return fail('INVALID_PAYLOAD');
  return parsed;
}

export function projectEvaluationEvidence(input, context) {
  const parsed = checkEvaluationEvidence(input, context); if (!parsed.ok) return parsed;
  const v = parsed.value, component = v.components.find(component => component.name === 'integration-evals');
  if (!component) return fail('INVALID_PAYLOAD', '/components');
  if (!validatePrimitive('EvidenceId', context.public_evidence_id).ok || context.public_evidence_id === v.evidence_id) return fail('INVALID_TRUST_CONTEXT', '/public_evidence_id');
  return projectEvidence({ evidence_id: context.public_evidence_id, environment: v.environment, billing_mode: v.billing_mode, outcome: ['passed', 'failed', 'blocked'].includes(v.status) ? v.status : 'unknown', component: { name: component.name, source_revision: component.source_revision } });
}

export function checkCommerceEvidence(contract, value, context) {
  switch (contract) {
    case 'ApprovalReceipt': return checkApprovalReceipt(value, context);
    case 'ApprovalReference': return checkApprovalReference(value, context);
    case 'ApprovalVerificationRequest': return checkApprovalVerificationRequest(value, context);
    case 'ApprovalVerificationOutcome': return checkApprovalVerificationOutcome(value, context);
    case 'ArtifactHandoffManifest': return checkArtifactHandoffManifest(value, context);
    case 'ArtifactConsumptionReceipt': return checkArtifactConsumptionReceipt(value, context);
    case 'ProductionBundle': return checkProductionBundle(value, context);
    case 'FulfillmentQuote': return checkFulfillmentQuote(value, context);
    case 'OrderAuthorization': return checkOrderAuthorization(value, context);
    case 'FulfillmentStatus': return checkFulfillmentStatus(value, context);
    case 'EvaluationEvidence': return checkEvaluationEvidence(value, context);
    default: return fail('UNKNOWN_CONTRACT', '/contract');
  }
}
