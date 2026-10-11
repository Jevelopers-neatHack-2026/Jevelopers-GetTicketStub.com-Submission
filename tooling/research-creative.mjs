import { validateContract, validatePrimitive, checkTrustedContext, canonicalJson, hashManifest, hashBytes, ContractError } from './runtime.mjs';
import { validateVersionedReference } from './operations.mjs';
const ok = value => ({ ok: true, value });
const fail = (code, path = '') => ({ ok: false, errors: [{ code, path }] });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (a, b) => canonicalJson(a) === canonicalJson(b);
const sameSet = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && new Set(a).size === a.length && a.every(id => b.includes(id));
const delivery = new Set(['contract', 'event_id', 'producer', 'occurred_at', 'observed_at', 'ingested_at', 'source_refs', 'trace_id', 'correlation_id']);

export function researchContentHash(value, field) {
  canonicalJson(value);
  if (!object(value) || !['fact_hash', 'package_hash', 'brief_hash', 'control_schema_hash', 'design_hash'].includes(field)) throw new ContractError('INVALID_PAYLOAD');
  return hashManifest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== field && (field === 'fact_hash' || !delivery.has(key)))));
}

function refs(value, path = '', slot = false) {
  if (value === null || typeof value !== 'object') return [];
  if (slot && object(value) && Object.hasOwn(value, 'id') && Object.hasOwn(value, 'schema_version') && Object.hasOwn(value, 'content_hash')) return [[path, value]];
  return Object.entries(value).flatMap(([key, child]) => ['value', 'candidate_values', 'customer_input', 'visual_intent'].includes(key) ? [] : refs(child, path ? path + '/' + key : key, key.endsWith('_ref') || key.endsWith('_refs') || (slot && Array.isArray(value))));
}

function boundary(contract, input, context) {
  const parsed = validateContract(contract, input); if (!parsed.ok) return parsed;
  if (!object(context)) return fail('INVALID_TRUST_CONTEXT');
  try { canonicalJson({ scope: context.scope, now: context.now, policy_version: context.policy_version, references: context.references }); } catch (error) {
    if (error instanceof ContractError) return fail('INVALID_TRUST_CONTEXT');
    throw error;
  }
  if (!validatePrimitive('UtcTime', context.now).ok || !context.now.endsWith('Z') || context.policy_version !== '1.0.0' || !object(context.references)) return fail('INVALID_TRUST_CONTEXT');
  const scoped = checkTrustedContext(parsed.value, context.scope); if (!scoped.ok) return scoped;
  for (const [path, reference] of refs(parsed.value)) {
    const expected = context.references[path];
    if (!validateVersionedReference(expected).ok) return fail('INVALID_TRUST_CONTEXT', '/' + path);
    if (!equal(reference, expected)) return fail('REFERENCE_MISMATCH', '/' + path);
  }
  return parsed;
}

function safeURL(value, domains) {
  if (!Array.isArray(domains) || !domains.length || domains.some(domain => typeof domain !== 'string' || !/^[a-z0-9.-]+$/.test(domain))) return fail('INVALID_TRUST_CONTEXT');
  let url;
  try { url = new URL(value); } catch (error) { if (error instanceof TypeError) return fail('INVALID_PAYLOAD'); throw error; }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.hash) return fail('INVALID_PAYLOAD');
  return domains.includes(url.hostname.toLowerCase()) ? ok(value) : fail('POLICY_MISMATCH');
}

function ingressPolicy(value, context) {
  if (!Array.isArray(context.allowed_outputs) || context.allowed_outputs.some(output => !['artwork', 'preview', 'print_bundle'].includes(output)) || !Number.isSafeInteger(context.max_variants) || context.max_variants < 1 || context.max_variants > 20) return fail('INVALID_TRUST_CONTEXT');
  if (!context.allowed_outputs.includes(value.kind)) return fail('UNSUPPORTED_CASE', '/outputs/kind');
  if (value.variant_count > context.max_variants) return fail('POLICY_MISMATCH', '/outputs/variant_count');
  return ok(value);
}

export function checkProjectRequest(input, context) {
  const parsed = boundary('ProjectRequest', input, context); if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!Array.isArray(context.allowed_actions) || context.allowed_actions.some(action => !['create_project', 'request_research'].includes(action))) return fail('INVALID_TRUST_CONTEXT');
  if (!context.allowed_actions.includes(v.action)) return fail('UNSUPPORTED_CASE', '/action');
  const output = ingressPolicy(v.outputs, context); if (!output.ok) return output;
  if (!v.customer_input.text.trim() && !v.customer_input.source_urls.length) return fail('INVALID_PAYLOAD', '/customer_input');
  for (let index = 0; index < v.customer_input.source_urls.length; index++) { const result = safeURL(v.customer_input.source_urls[index], context.allowed_domains); if (!result.ok) return fail(result.errors[0].code, '/customer_input/source_urls/' + index); }
  if (Date.parse(v.deadline_at) <= Date.parse(context.now)) return fail('EXPIRED', '/deadline_at');
  return parsed;
}

export function checkResearchRequest(input, context) {
  const parsed = boundary('ResearchRequest', input, context); if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!Array.isArray(context.requested_facts) || context.requested_facts.some(key => typeof key !== 'string') || !Array.isArray(context.allowed_domains) || !Number.isSafeInteger(context.max_sources) || context.max_sources < 1 || !Number.isSafeInteger(context.max_age_seconds) || context.max_age_seconds < 0) return fail('INVALID_TRUST_CONTEXT');
  if (!sameSet(v.requested_facts, context.requested_facts)) return fail('POLICY_MISMATCH', '/requested_facts');
  if (!sameSet(v.constraints.allowed_domains, context.allowed_domains) || v.constraints.max_sources > context.max_sources || v.constraints.max_age_seconds > context.max_age_seconds || v.source_seeds.length > v.constraints.max_sources) return fail('POLICY_MISMATCH', '/constraints');
  if (new Set(v.source_seeds.map(source => source.source_id)).size !== v.source_seeds.length) return fail('INVALID_PAYLOAD', '/source_seeds');
  for (let index = 0; index < v.source_seeds.length; index++) { const result = safeURL(v.source_seeds[index].url, context.allowed_domains); if (!result.ok) return fail(result.errors[0].code, '/source_seeds/' + index + '/url'); }
  if (Date.parse(v.deadline_at) <= Date.parse(context.now)) return fail('EXPIRED', '/deadline_at');
  return parsed;
}

function factFacts(fact, sources, path) {
  if (fact.fact_hash !== researchContentHash(fact, 'fact_hash')) return fail('REFERENCE_MISMATCH', path + '/fact_hash');
  for (const provenance of fact.provenance) {
    const source = sources.find(source => source.source_id === provenance.source_id);
    if (!source || provenance.retrieved_at !== source.retrieved_at) return fail('REFERENCE_MISMATCH', path + '/provenance');
  }
  if ((fact.confidence.basis === 'not_measured') !== (fact.confidence.value === null)) return fail('INVALID_PAYLOAD', path + '/confidence');
  switch (fact.status) {
    case 'known': if (fact.value === null || fact.candidate_values.length) return fail('INVALID_PAYLOAD', path + '/value'); break;
    case 'unknown': if (fact.value !== null || fact.candidate_values.length) return fail('INVALID_PAYLOAD', path + '/value'); break;
    case 'conflicting': if (fact.value !== null || fact.candidate_values.length < 2 || new Set(fact.candidate_values.map(canonicalJson)).size !== fact.candidate_values.length) return fail('INVALID_PAYLOAD', path + '/candidate_values'); break;
    case 'review': break;
    default: return fail('INVALID_PAYLOAD', path + '/status');
  }
  return ok(fact);
}

function approvalFor(asset, context, path) {
  const verification = context.approvals?.[asset.approval_ref.id];
  if (!object(verification) || !checkTrustedContext(verification, context.scope).ok || !validateVersionedReference(verification.reference).ok || typeof context.audience !== 'string' || !context.audience.trim() || typeof verification.audience !== 'string' || !verification.audience.trim() || typeof verification.actor_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(verification.actor_id) || !validatePrimitive('AssetId', verification.subject_id).ok || !Number.isSafeInteger(verification.subject_version) || verification.subject_version < 0 || !validatePrimitive('Sha256', verification.subject_hash).ok || !['display', 'reproduce', 'modify', 'publish'].includes(verification.intended_use) || !['valid', 'revoked', 'unknown'].includes(verification.status)) return fail('INVALID_TRUST_CONTEXT', path + '/approval_ref');
  if (verification.issuer !== 'getticketstub.com' || verification.audience !== context.audience || !verification.actor_id || verification.status !== 'valid') return fail('STALE_APPROVAL', path + '/approval_ref');
  const actualHash = asset.transformed_hash ?? asset.original_hash;
  if (verification.subject_id !== asset.asset_id || verification.subject_version !== asset.revision || verification.subject_hash !== actualHash || verification.intended_use !== asset.intended_use || !equal(verification.reference, asset.approval_ref)) return fail('STALE_APPROVAL', path + '/approval_ref');
  if (!validatePrimitive('UtcTime', verification.issued_at).ok || !validatePrimitive('UtcTime', verification.expires_at).ok || Date.parse(verification.issued_at) > Date.parse(context.now) || Date.parse(verification.expires_at) <= Date.parse(context.now) || Date.parse(asset.expires_at) > Date.parse(verification.expires_at) || Date.parse(asset.expires_at) <= Date.parse(context.now)) return fail('STALE_APPROVAL', path + '/expires_at');
  return ok(asset);
}

function packageFacts(v, context) {
  if (context.max_age_seconds !== undefined && (!Number.isSafeInteger(context.max_age_seconds) || context.max_age_seconds < 0)) return fail('INVALID_TRUST_CONTEXT', '/max_age_seconds');
  if (v.package_hash !== researchContentHash(v, 'package_hash')) return fail('REFERENCE_MISMATCH', '/package_hash');
  if (Date.parse(v.expires_at) <= Date.parse(context.now)) return fail('EXPIRED', '/expires_at');
  if (new Set(v.sources.map(source => source.source_id)).size !== v.sources.length || new Set(v.facts.map(fact => fact.fact_id)).size !== v.facts.length || new Set(v.facts.map(fact => fact.key)).size !== v.facts.length) return fail('INVALID_PAYLOAD', '/facts');
  for (let index = 0; index < v.sources.length; index++) {
    const source = v.sources[index], result = safeURL(source.url, context.allowed_domains);
    if (!result.ok) return fail(result.errors[0].code, '/sources/' + index + '/url');
    if (Date.parse(source.retrieved_at) > Date.parse(context.now) || (context.max_age_seconds !== undefined && Date.parse(context.now) - Date.parse(source.retrieved_at) > context.max_age_seconds * 1000)) return fail('EXPIRED', '/sources/' + index + '/retrieved_at');
  }
  for (let index = 0; index < v.facts.length; index++) { const result = factFacts(v.facts[index], v.sources, '/facts/' + index); if (!result.ok) return result; }
  if (v.readiness === 'ready' && v.facts.some(fact => fact.status !== 'known')) return fail('UNSUPPORTED_CASE', '/readiness');
  if (new Set(v.asset_candidates.map(asset => asset.asset_id)).size !== v.asset_candidates.length || new Set(v.approved_assets.map(asset => asset.asset_id)).size !== v.approved_assets.length) return fail('INVALID_PAYLOAD', '/asset_candidates');
  for (let index = 0; index < v.asset_candidates.length; index++) {
    const asset = v.asset_candidates[index];
    if (!v.sources.some(source => source.source_id === asset.source_id)) return fail('REFERENCE_MISMATCH', '/asset_candidates/' + index + '/source_id');
    if (!safeURL(asset.discovery_url, context.allowed_domains).ok) return fail('INVALID_PAYLOAD', '/asset_candidates/' + index + '/discovery_url');
  }
  for (let index = 0; index < v.approved_assets.length; index++) {
    const asset = v.approved_assets[index], candidate = v.asset_candidates.find(candidate => candidate.asset_id === asset.asset_id);
    if (!candidate || candidate.revision !== asset.revision || candidate.original_hash !== asset.original_hash || candidate.transformed_hash !== asset.transformed_hash) return fail('REFERENCE_MISMATCH', '/approved_assets/' + index);
    const checked = approvalFor(asset, context, '/approved_assets/' + index); if (!checked.ok) return checked;
  }
  if (context.prior_package) {
    const old = validateContract('EventIntelligencePackage', context.prior_package);
    if (!old.ok || !checkTrustedContext(old.value, context.scope).ok || old.value.package_hash !== researchContentHash(old.value, 'package_hash')) return fail('INVALID_TRUST_CONTEXT', '/prior_package');
    if (v.package_id !== old.value.package_id || v.package_version !== old.value.package_version + 1 || !v.parent_ref || v.parent_ref.id !== old.value.package_id || v.parent_ref.revision !== old.value.package_version || v.parent_ref.content_hash !== old.value.package_hash) return fail('STALE_REVISION', '/parent_ref');
  } else if (v.package_version !== 1 || v.parent_ref !== null) return fail('INVALID_TRUST_CONTEXT', '/prior_package');
  return ok(v);
}

export function checkEventIntelligencePackage(input, context) {
  const parsed = boundary('EventIntelligencePackage', input, context); return parsed.ok ? packageFacts(parsed.value, context) : parsed;
}

export function checkResearchRequestReceipt(input, context) {
  const parsed = boundary('ResearchRequestReceipt', input, context); if (!parsed.ok) return parsed;
  const request = validateContract('ResearchRequest', context.request); if (!request.ok || !checkTrustedContext(request.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/request');
  const v = parsed.value;
  if (v.request_id !== request.value.request_id || v.request_hash !== hashManifest(request.value) || v.request_ref.id !== request.value.request_id || v.request_ref.content_hash !== v.request_hash) return fail('INVALID_RECEIPT', '/request_hash');
  if ((v.status === 'rejected') !== (v.error_ref !== null)) return fail('INVALID_RECEIPT', '/error_ref');
  return parsed;
}

export function checkResearchAnswerReceipt(input, context) {
  const parsed = boundary('ResearchAnswerReceipt', input, context); if (!parsed.ok) return parsed;
  const request = validateContract('ResearchRequest', context.request), pkg = validateContract('EventIntelligencePackage', context.package);
  if (!request.ok || !pkg.ok || !checkTrustedContext(request.value, context.scope).ok || !checkTrustedContext(pkg.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT');
  const v = parsed.value;
  if (v.request_id !== request.value.request_id || v.batch_id !== request.value.batch_id || v.package_ref.id !== pkg.value.package_id || v.package_ref.revision !== pkg.value.package_version || v.package_ref.content_hash !== pkg.value.package_hash) return fail('INVALID_RECEIPT', '/package_ref');
  if (!sameSet(v.answer_ids, v.fact_refs.map(ref => ref.id)) || v.fact_refs.some(ref => !pkg.value.facts.some(fact => fact.fact_id === ref.id && fact.revision === ref.revision && fact.fact_hash === ref.content_hash))) return fail('INVALID_RECEIPT', '/fact_refs');
  if (v.status === 'complete' && !sameSet(v.answer_ids, pkg.value.facts.map(fact => fact.fact_id))) return fail('INVALID_RECEIPT', '/answer_ids');
  return parsed;
}

export function checkResearchBatchReceipt(input, context) {
  const parsed = boundary('ResearchBatchReceipt', input, context); if (!parsed.ok) return parsed;
  const v = parsed.value, ids = [...v.successful_request_ids, ...v.failed_request_ids, ...v.pending_request_ids];
  if (!sameSet(v.request_ids, context.request_ids) || !sameSet(ids, v.request_ids)) return fail('INVALID_BATCH', '/request_ids');
  if (!Array.isArray(context.request_receipts) || !sameSet(context.request_receipts.map(receipt => receipt.request_id), v.request_ids) || v.request_receipt_refs.length !== context.request_receipts.length) return fail('INVALID_TRUST_CONTEXT', '/request_receipts');
  for (const receipt of context.request_receipts) {
    if (!validateContract('ResearchRequestReceipt', receipt).ok || !checkTrustedContext(receipt, context.scope).ok || !v.request_receipt_refs.some(ref => ref.contract === 'ResearchRequestReceipt' && ref.id === receipt.receipt_id && ref.content_hash === hashManifest(receipt))) return fail('INVALID_RECEIPT', '/request_receipt_refs');
  }
  if (v.acceptance_policy !== context.acceptance_policy || (v.acceptance_policy === 'all_or_nothing' && v.successful_request_ids.length && (v.failed_request_ids.length || v.pending_request_ids.length))) return fail('INVALID_BATCH', '/acceptance_policy');
  return parsed;
}

function correctionAuthority(v, context) {
  const authority = context.correction_authority;
  if (!object(authority) || !validateVersionedReference(authority.actor_ref).ok || !validateVersionedReference(authority.authority_ref).ok || !validateVersionedReference(authority.expected_package_ref).ok || !Array.isArray(authority.allowed_fact_ids) || authority.allowed_fact_ids.some(id => !validatePrimitive('FactId', id).ok) || !['proposed', 'accepted', 'rejected'].includes(authority.status)) return fail('INVALID_TRUST_CONTEXT', '/correction_authority');
  if (!equal(v.authority_ref, authority.authority_ref) || !equal(v.expected_package_ref, authority.expected_package_ref) || (v.actor_ref && !equal(v.actor_ref, authority.actor_ref))) return fail('SCOPE_MISMATCH', '/authority_ref');
  if (authority.authority_ref.contract !== 'getticketstub.com') return fail('SCOPE_MISMATCH', '/authority_ref');
  return ok(authority);
}

export function checkResearchCorrectionRequest(input, context) {
  const parsed = boundary('ResearchCorrectionRequest', input, context); if (!parsed.ok) return parsed;
  const authority = correctionAuthority(parsed.value, context); if (!authority.ok) return authority;
  const pkg = validateContract('EventIntelligencePackage', context.package); if (!pkg.ok || !checkTrustedContext(pkg.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/package');
  const v = parsed.value;
  if (v.expected_package_ref.id !== pkg.value.package_id || v.expected_package_ref.revision !== pkg.value.package_version || v.expected_package_ref.content_hash !== pkg.value.package_hash) return fail('STALE_REVISION', '/expected_package_ref');
  if (new Set(v.changes.map(change => change.fact_id)).size !== v.changes.length || v.changes.some(change => !authority.value.allowed_fact_ids.includes(change.fact_id) || !pkg.value.facts.some(fact => fact.fact_id === change.fact_id))) return fail('POLICY_MISMATCH', '/changes');
  for (let index = 0; index < v.changes.length; index++) {
    const original = pkg.value.facts.find(fact => fact.fact_id === v.changes[index].fact_id);
    const proposed = { ...original, ...v.changes[index], revision: original.revision + 1 };
    proposed.fact_hash = researchContentHash(proposed, 'fact_hash');
    const checked = factFacts(proposed, pkg.value.sources, '/changes/' + index); if (!checked.ok) return checked;
  }
  return parsed;
}

export function checkResearchCorrectionReceipt(input, context) {
  const parsed = boundary('ResearchCorrectionReceipt', input, context); if (!parsed.ok) return parsed;
  const authority = correctionAuthority(parsed.value, context); if (!authority.ok) return authority;
  const request = checkResearchCorrectionRequest(context.request, context); if (!request.ok) return fail('INVALID_TRUST_CONTEXT', '/request');
  const v = parsed.value;
  if (v.request_id !== request.value.request_id || v.request_hash !== hashManifest(request.value) || v.status !== authority.value.status) return fail('INVALID_RECEIPT', '/status');
  if (v.status !== 'accepted') return v.new_package_ref === null ? parsed : fail('INVALID_RECEIPT', '/new_package_ref');
  const pkg = validateContract('EventIntelligencePackage', context.new_package); if (!pkg.ok) return fail('INVALID_TRUST_CONTEXT', '/new_package');
  const checked = packageFacts(pkg.value, { ...context, prior_package: context.package }); if (!checked.ok) return checked;
  if (!checkTrustedContext(pkg.value, context.scope).ok || !v.new_package_ref || v.new_package_ref.id !== pkg.value.package_id || v.new_package_ref.revision !== pkg.value.package_version || v.new_package_ref.content_hash !== pkg.value.package_hash) return fail('INVALID_RECEIPT', '/new_package_ref');
  if (pkg.value.facts.length !== context.package.facts.length) return fail('INVALID_RECEIPT', '/new_package_ref');
  for (const old of context.package.facts) {
    const next = pkg.value.facts.find(fact => fact.fact_id === old.fact_id), change = request.value.changes.find(change => change.fact_id === old.fact_id);
    if (!next || (change ? next.revision !== old.revision + 1 || !['status', 'value', 'candidate_values', 'provenance'].every(key => equal(next[key], change[key])) : !equal(next, old))) return fail('INVALID_RECEIPT', '/new_package_ref');
  }
  return parsed;
}

export function checkResearchInvalidation(input, context) {
  const parsed = boundary('ResearchInvalidation', input, context); if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!v.affected_package_refs.length && !v.affected_asset_refs.length) return fail('INVALID_PAYLOAD', '/affected_package_refs');
  if (Date.parse(v.effective_at) > Date.parse(context.now)) return fail('INVALID_PAYLOAD', '/effective_at');
  if (!context.prior_invalidation) return v.revision === 1 ? parsed : fail('INVALID_TRUST_CONTEXT', '/prior_invalidation');
  const old = validateContract('ResearchInvalidation', context.prior_invalidation); if (!old.ok || !checkTrustedContext(old.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/prior_invalidation');
  if (v.invalidation_id !== old.value.invalidation_id) return fail('IDENTITY_COLLISION', '/invalidation_id');
  if (v.revision === old.value.revision) return equal(v, old.value) ? parsed : fail('REVISION_CONFLICT', '/revision');
  if (v.revision !== old.value.revision + 1 || Date.parse(v.effective_at) < Date.parse(old.value.effective_at)) return fail('STALE_REVISION', '/revision');
  if (v.event_id === old.value.event_id || v.source_observation_id === old.value.source_observation_id) return fail('IDENTITY_COLLISION', '/event_id');
  return parsed;
}

export function checkCreativeBrief(input, context) {
  const parsed = boundary('CreativeBrief', input, context); if (!parsed.ok) return parsed;
  const pkg = validateContract('EventIntelligencePackage', context.package); if (!pkg.ok || !checkTrustedContext(pkg.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/package');
  const packageChecked = packageFacts(pkg.value, context); if (!packageChecked.ok) return packageChecked;
  const v = parsed.value;
  if (v.brief_hash !== researchContentHash(v, 'brief_hash')) return fail('REFERENCE_MISMATCH', '/brief_hash');
  if (v.package_ref.id !== pkg.value.package_id || v.package_ref.revision !== pkg.value.package_version || v.package_ref.content_hash !== pkg.value.package_hash) return fail('STALE_REVISION', '/package_ref');
  for (let index = 0; index < v.composition_facts.length; index++) if (!pkg.value.facts.some(fact => equal(fact, v.composition_facts[index]))) return fail('REFERENCE_MISMATCH', '/composition_facts/' + index);
  if (v.readiness === 'ready' && (pkg.value.readiness !== 'ready' || v.composition_facts.some(fact => fact.status !== 'known'))) return fail('UNSUPPORTED_CASE', '/readiness');
  for (let index = 0; index < v.asset_refs.length; index++) if (!pkg.value.approved_assets.some(asset => equal(asset, v.asset_refs[index]))) return fail('STALE_APPROVAL', '/asset_refs/' + index);
  const output = ingressPolicy(v.output_constraints, context); return output.ok ? parsed : output;
}

export function checkDesignControlSchema(input, context) {
  const parsed = boundary('DesignControlSchema', input, context); if (!parsed.ok) return parsed;
  const v = parsed.value;
  if (!object(context.allowed_controls)) return fail('INVALID_TRUST_CONTEXT', '/allowed_controls');
  if (v.control_schema_hash !== researchContentHash(v, 'control_schema_hash')) return fail('REFERENCE_MISMATCH', '/control_schema_hash');
  if (new Set(v.controls.map(control => control.control_id)).size !== v.controls.length) return fail('INVALID_PAYLOAD', '/controls');
  for (let index = 0; index < v.controls.length; index++) {
    const control = v.controls[index], path = '/controls/' + index, expected = context.allowed_controls[control.control_id];
    if (!expected || !equal(control, expected)) return fail('POLICY_MISMATCH', path);
    if (control.kind === 'number' && control.minimum > control.maximum) return fail('INVALID_PAYLOAD', path + '/minimum');
    if ((control.default_presence === 'absent') !== (control.default_value === null)) return fail('INVALID_PAYLOAD', path + '/default_value');
    if (control.default_value === null) continue;
    switch (control.kind) {
      case 'number': if (control.minimum > control.maximum || control.default_value < control.minimum || control.default_value > control.maximum || Math.abs((control.default_value - control.minimum) / control.step - Math.round((control.default_value - control.minimum) / control.step)) > 1e-8) return fail('INVALID_PAYLOAD', path + '/default_value'); break;
      case 'enum': if (!control.values.includes(control.default_value)) return fail('INVALID_PAYLOAD', path + '/default_value'); break;
      case 'text': if (control.default_value.length > control.max_length || /<\/?script\b|javascript:/i.test(control.default_value)) return fail('INVALID_PAYLOAD', path + '/default_value'); break;
      case 'boolean': break;
      default: return fail('INVALID_PAYLOAD', path + '/kind');
    }
  }
  return parsed;
}

export function checkDesignVersion(input, context) {
  const parsed = boundary('DesignVersion', input, context); if (!parsed.ok) return parsed;
  const v = parsed.value;
  const job = validateContract('JobStatus', context.job);
  if (!job.ok || !checkTrustedContext(job.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/job');
  if (v.job_outcome !== job.value.outcome || v.job_ref.id !== job.value.job_id || v.job_ref.revision !== job.value.revision || v.job_ref.content_hash !== hashManifest(job.value)) return fail('REFERENCE_MISMATCH', '/job_ref');
  if (v.design_hash !== researchContentHash(v, 'design_hash')) return fail('REFERENCE_MISMATCH', '/design_hash');
  if (v.lineage_branch !== context.expected_branch) return fail('SCOPE_MISMATCH', '/lineage_branch');
  if (context.prior_design) {
    const old = validateContract('DesignVersion', context.prior_design); if (!old.ok || !checkTrustedContext(old.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/prior_design');
    if (v.design_id !== old.value.design_id || v.design_version_id === old.value.design_version_id || v.revision !== old.value.revision + 1 || !v.parent_ref || v.parent_ref.id !== old.value.design_version_id || v.parent_ref.revision !== old.value.revision || v.parent_ref.content_hash !== old.value.design_hash) return fail('INVALID_TRANSITION', '/parent_ref');
  } else if (v.revision !== 1 || v.parent_ref !== null) return fail('INVALID_TRUST_CONTEXT', '/prior_design');
  if (v.job_outcome === 'succeeded' && (v.artifact_state !== 'available' || !v.artwork || !v.preview)) return fail('INVALID_TRANSITION', '/artwork');
  if (v.artifact_state === 'unavailable') return v.artwork === null && v.preview === null ? parsed : fail('INVALID_PAYLOAD', '/artifact_state');
  if (!v.artwork || !v.preview) return fail('INVALID_PAYLOAD', '/artwork');
  if (v.artwork.artifact_id === v.preview.artifact_id || v.preview.artwork_byte_hash !== v.artwork.byte_hash || context.preview_artwork_hash !== v.artwork.byte_hash) return fail('REFERENCE_MISMATCH', '/preview/artwork_byte_hash');
  if (v.artwork.kind === 'transformed' ? !v.artwork.source_artifact_ref || v.artwork.source_artifact_ref.content_hash !== v.artwork.original_byte_hash : v.artwork.source_artifact_ref !== null || v.artwork.byte_hash !== v.artwork.original_byte_hash) return fail('REFERENCE_MISMATCH', '/artwork/source_artifact_ref');
  for (const [key, artifact] of [['artwork', v.artwork], ['preview', v.preview]]) {
    const bytes = context.artifact_bytes?.[artifact.artifact_id];
    if (!(bytes instanceof Uint8Array)) return fail('INVALID_TRUST_CONTEXT', '/' + key);
    if (bytes.length !== artifact.byte_size || hashBytes(bytes) !== artifact.byte_hash) return fail('REFERENCE_MISMATCH', '/' + key + '/byte_hash');
  }
  return parsed;
}

export function adaptResearchPackage(source, profile, candidate) {
  try { canonicalJson(source); } catch (error) { if (error instanceof ContractError) return fail('INVALID_PAYLOAD'); throw error; }
  if (!object(source)) return fail('PROFILE_UNREPRESENTABLE');
  let target;
  if (profile === 'canonical-alias-1.0.0') {
    if (!['ResearchPackage', 'EventIntelligencePackage'].includes(source.contract) || source.schema_version !== '1.0.0') return fail('PROFILE_UNREPRESENTABLE', '/contract');
    target = { ...source, contract: 'EventIntelligencePackage' };
  } else if (['creative-local-1.0', 'creative-local-1.1'].includes(profile)) {
    if (!['ResearchPackage', 'EventIntelligencePackage'].includes(source.contract) || source.schema_version !== profile.slice('creative-local-'.length) || !Array.isArray(source.facts) || !Array.isArray(source.source_identity)) return fail('PROFILE_UNREPRESENTABLE');
    target = candidate;
    const validated = validateContract('EventIntelligencePackage', target); if (!validated.ok) return fail('PROFILE_UNREPRESENTABLE', '/candidate');
    if (source.tenant_id !== target.tenant_id || source.project_id !== target.project_id || source.package_id !== target.package_id) return fail('PROFILE_UNREPRESENTABLE', '/scope');
    if (target.asset_candidates.length || target.approved_assets.length) return fail('PROFILE_UNREPRESENTABLE', '/permissions');
    if (source.facts.length !== target.facts.length || source.source_identity.length !== target.sources.length) return fail('PROFILE_UNREPRESENTABLE', '/facts');
    for (const fact of source.facts) {
      const mapped = target.facts.find(value => value.key === fact.key), status = { verified: 'known', unknown: 'unknown', conflicting: 'conflicting' }[fact.status];
      if (!mapped || !status || mapped.status !== status || !equal(mapped.value, Object.hasOwn(fact, 'value') ? fact.value : null) || !equal(mapped.candidate_values, fact.candidate_values ?? []) || !Array.isArray(fact.provenance) || fact.provenance.length !== mapped.provenance.length || fact.provenance.some((provenance, index) => provenance.source_id !== mapped.provenance[index].source_id || provenance.retrieved_at !== mapped.provenance[index].retrieved_at)) return fail('PROFILE_UNREPRESENTABLE', '/facts');
    }
    for (const sourceIdentity of source.source_identity) if (!target.sources.some(value => value.source_id === sourceIdentity.source_id && value.url === sourceIdentity.uri && value.retrieved_at === sourceIdentity.retrieved_at && value.content_hash === sourceIdentity.content_hash)) return fail('PROFILE_UNREPRESENTABLE', '/source_identity');
    if (source.assets?.items?.length || source.permissions?.items?.length) return fail('PROFILE_UNREPRESENTABLE', '/permissions');
  } else return fail('PROFILE_UNREPRESENTABLE', '/profile');
  const parsed = validateContract('EventIntelligencePackage', target); if (!parsed.ok || target.package_hash !== researchContentHash(target, 'package_hash')) return fail('PROFILE_UNREPRESENTABLE', '/candidate');
  return ok({ source: structuredClone(source), candidate: target, profile, accepted_migration: false });
}

export function checkResearchCreative(contract, value, context) {
  switch (contract) {
    case 'ProjectRequest': return checkProjectRequest(value, context);
    case 'ResearchRequest': return checkResearchRequest(value, context);
    case 'EventIntelligencePackage': return checkEventIntelligencePackage(value, context);
    case 'ResearchRequestReceipt': return checkResearchRequestReceipt(value, context);
    case 'ResearchAnswerReceipt': return checkResearchAnswerReceipt(value, context);
    case 'ResearchBatchReceipt': return checkResearchBatchReceipt(value, context);
    case 'ResearchCorrectionRequest': return checkResearchCorrectionRequest(value, context);
    case 'ResearchCorrectionReceipt': return checkResearchCorrectionReceipt(value, context);
    case 'ResearchInvalidation': return checkResearchInvalidation(value, context);
    case 'CreativeBrief': return checkCreativeBrief(value, context);
    case 'DesignControlSchema': return checkDesignControlSchema(value, context);
    case 'DesignVersion': return checkDesignVersion(value, context);
    default: return fail('UNKNOWN_CONTRACT', '/contract');
  }
}
