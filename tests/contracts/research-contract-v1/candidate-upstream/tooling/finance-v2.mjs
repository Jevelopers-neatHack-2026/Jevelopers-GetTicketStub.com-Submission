import { validateContractVersion, validatePrimitive, checkTrustedContext, canonicalJson, hashManifest, ContractError } from './runtime.mjs';
import { validateVersionedReference } from './operations.mjs';

const ok = value => ({ ok: true, value });
const fail = (code, path = '') => ({ ok: false, errors: [{ code, path }] });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (left, right) => left !== undefined && right !== undefined && canonicalJson(left) === canonicalJson(right);
const commands = ['ReserveRequest', 'SettleRequest', 'ReleaseRequest', 'QueryRequest'];
const names = ['BudgetReservation', ...commands, 'ReserveResult', 'SettleResult', 'ReleaseResult', 'QueryResult'];
const closed = value => ['consumed', 'released', 'expired'].includes(value.lifecycle);
const granted = value => ['granted', 'partially_granted'].includes(value.decision);
const uncertain = state => ['in_flight', 'uncertain'].includes(state);
const scaleOf = value => value.split('.')[1]?.length ?? 0;
const scaled = (value, scale) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole + fraction.padEnd(scale, '0')); };
function compare(a, b) { const scale = Math.max(a.scale, b.scale); const x = scaled(a.amount, scale), y = scaled(b.amount, scale); return x < y ? -1 : x > y ? 1 : 0; }
function money(value, currency) { return object(value) && value.currency === currency && validatePrimitive('ExactDecimal', value.amount).ok && Number.isSafeInteger(value.scale) && value.scale >= 0 && value.scale <= 18 && scaleOf(value.amount) <= value.scale; }
function zero(value) { return value !== null && scaled(value.amount, value.scale) === 0n; }
function excessMatches(value, consumed, held) {
  const scale = Math.max(consumed.scale, held.scale, value.scale);
  const delta = scaled(consumed.amount, scale) - scaled(held.amount, scale);
  return scaled(value.amount, scale) === (delta > 0n ? delta : 0n);
}
function remainingMatches(value, consumed, held) {
  const scale = Math.max(consumed.scale, held.scale, value.scale);
  const remaining = scaled(held.amount, scale) - scaled(consumed.amount, scale);
  return scaled(value.amount, scale) === (remaining > 0n ? remaining : 0n);
}
function reference(value) {
  if (!object(value)) return false;
  if (value.schema_version === '1.0.0') return validateVersionedReference(value).ok;
  return value.schema_version === '2.0.0' && names.includes(value.contract) && Object.keys(value).length === 5 &&
    validatePrimitive('TenantId', value.id).ok && Number.isSafeInteger(value.revision) && value.revision >= 0 && validatePrimitive('Sha256', value.content_hash).ok;
}
function references(value, path = '', slot = false) {
  if (value === null || typeof value !== 'object') return [];
  if (slot && object(value) && Object.hasOwn(value, 'schema_version') && Object.hasOwn(value, 'content_hash')) return [[path, value]];
  return Object.entries(value).flatMap(([key, child]) => references(child, path ? path + '/' + key : key, key.endsWith('_ref') || key.endsWith('_refs') || key === 'reference' || (slot && Array.isArray(value))));
}
function partition(value, context, prefix = '') {
  const scope = checkTrustedContext(value, context.scope);
  if (!scope.ok) return scope;
  for (const key of ['environment', 'billing_mode']) if (value[key] !== context[key]) return fail('SCOPE_MISMATCH', prefix + '/' + key);
  return ok(value);
}
function boundary(contract, input, context) {
  const parsed = validateContractVersion(contract, '2.0.0', input); if (!parsed.ok) return parsed;
  try { canonicalJson(context); } catch (error) { if (error instanceof ContractError) return fail('INVALID_TRUST_CONTEXT'); throw error; }
  if (!object(context) || context.policy_version !== '1.0.0' || context.finance_protocol_version !== '2.0.0' || !object(context.references) ||
      !validatePrimitive('UtcTime', context.now).ok || !validatePrimitive('Currency', context.currency).ok ||
      !['development', 'test', 'production'].includes(context.environment) || !['live', 'sandbox', 'simulated'].includes(context.billing_mode) ||
      !['not_dispatched', 'in_flight', 'finished', 'uncertain'].includes(context.execution_state) ||
      !['complete', 'incomplete', 'unknown'].includes(context.usage_completeness) ||
      !['eligible', 'blocked'].includes(context.dispatch_state) || !reference(context.authority_ref) || context.authority_ref.contract !== 'cost-intelligence') return fail('INVALID_TRUST_CONTEXT');
  const scoped = partition(parsed.value, context); if (!scoped.ok) return scoped;
  for (const key of ['initial_request', 'prior', 'command_prior', 'previous_command', 'request', 'current_reservation', 'previous_result']) {
    if (context[key] === undefined) continue;
    const supplied = context[key];
    if (!object(supplied) || !names.includes(supplied.contract)) return fail('INVALID_TRUST_CONTEXT', '/' + key);
    const checked = validateContractVersion(supplied.contract, '2.0.0', supplied);
    if (!checked.ok || !partition(supplied, context).ok || (supplied.currency !== undefined && supplied.currency !== context.currency)) return fail('INVALID_TRUST_CONTEXT', '/' + key);
    const snapshot = supplied.contract === 'BudgetReservation' ? supplied : supplied.reservation;
    if (snapshot && (!partition(snapshot, context).ok || ['held', 'consumed', 'dispatch_cap', 'requested_capacity', 'retained_exposure', 'released_capacity', 'overrun'].some(field => snapshot[field] !== null && snapshot[field].currency !== context.currency))) return fail('INVALID_TRUST_CONTEXT', '/' + key);
    if (snapshot && !terminalFinality(snapshot, context).ok) return fail('INVALID_TRUST_CONTEXT', '/' + key);
  }
  if (parsed.value.policy_version !== context.policy_version) return fail('POLICY_MISMATCH', '/policy_version');
  for (const [path, ref] of references(parsed.value)) {
    if (!reference(context.references[path])) return fail('INVALID_TRUST_CONTEXT', '/' + path);
    if (!same(ref, context.references[path])) return fail('REFERENCE_MISMATCH', '/' + path);
  }
  if (parsed.value.error?.code === 'UNKNOWN_USAGE' && parsed.value.error.usage_state === 'complete') return fail('UNKNOWN_USAGE', '/error/usage_state');
  return parsed;
}
function scopedRecord(value, context) { return object(value) && partition(value, context).ok; }
function originalRequest(context) {
  const parsed = validateContractVersion('ReserveRequest', '2.0.0', context.initial_request);
  if (!parsed.ok || !scopedRecord(parsed.value, context) || parsed.value.currency !== context.currency ||
      (parsed.value.pricing_basis === 'bounded_conservative' ? !money(parsed.value.requested, context.currency) || zero(parsed.value.requested) : parsed.value.requested !== null)) return fail('INVALID_TRUST_CONTEXT', '/initial_request');
  return parsed;
}
function correctionAuthorized(value, old, context) {
  const authority = context.correction_authority;
  return value.consumption_kind === 'correction' && value.correction_ref !== null && object(authority) && scopedRecord(authority, context) &&
    authority.status === 'authorized' && authority.currency === context.currency && authority.reservation_id === old.reservation_id &&
    authority.billable_attempt_id === old.billable_attempt_id && authority.expected_revision === old.revision &&
    reference(authority.reference) && same(authority.reference, value.correction_ref) &&
    money(authority.from, context.currency) && same(authority.from, old.consumed) && money(authority.to, context.currency) && same(authority.to, value.consumed) &&
    reference(authority.prior_reservation_ref) && authority.prior_reservation_ref.contract === 'BudgetReservation' && authority.prior_reservation_ref.schema_version === '2.0.0' &&
    authority.prior_reservation_ref.id === old.reservation_id && authority.prior_reservation_ref.revision === old.revision && authority.prior_reservation_ref.content_hash === hashManifest(old) &&
    validatePrimitive('UtcTime', authority.checked_at).ok && Date.parse(authority.checked_at) <= Date.parse(context.now);
}
function acknowledgement(value, context) {
  const ack = context.dispatch_acknowledgement;
  if (!object(ack) || !scopedRecord(ack, context) || ack.reservation_id !== value.reservation_id || ack.grant_revision !== value.grant_revision ||
      !same(ack.grant_request_ref, value.grant_request_ref) || !money(ack.cap, context.currency) || !same(ack.cap, value.held) ||
      !reference(ack.reference) || ack.reference.contract !== 'DispatchAcknowledgement' || !same(ack.reference, value.dispatch_acknowledgement_ref) ||
      !validatePrimitive('UtcTime', ack.checked_at).ok || !validatePrimitive('UtcTime', ack.expires_at).ok || Date.parse(ack.checked_at) > Date.parse(context.now) ||
      !['valid', 'revoked', 'expired', 'unavailable'].includes(ack.status)) return fail('INVALID_TRUST_CONTEXT', '/dispatch_acknowledgement');
  return ok(ack.status === 'valid' && Date.parse(ack.expires_at) > Date.parse(context.now));
}
function observation(value, context) {
  const observed = context.consumption_observation;
  if (!object(observed) || !scopedRecord(observed, context) || observed.reservation_id !== value.reservation_id || observed.billable_attempt_id !== value.billable_attempt_id ||
      !money(observed.consumed, context.currency) || !same(observed.consumed, value.consumed) || observed.consumption_kind !== value.consumption_kind ||
      !reference(observed.reference) || !same(observed.reference, value.consumption_evidence_ref) || !same(observed.correction_ref, value.correction_ref) ||
      !Array.isArray(observed.exception_refs) || !same(observed.exception_refs, value.exception_refs) ||
      !validatePrimitive('UtcTime', observed.observed_at).ok || Date.parse(observed.observed_at) > Date.parse(context.now)) return fail('INVALID_TRUST_CONTEXT', '/consumption_observation');
  return ok(observed);
}
function terminalFinality(value, context) {
  if (!closed(value)) return ok(value);
  if (uncertain(value.execution_state)) return fail('UNCERTAIN_EXECUTION', '/lifecycle');
  if (value.usage_completeness !== 'complete' && !(value.lifecycle !== 'consumed' && value.execution_state === 'not_dispatched' &&
      zero(value.consumed) && resolved(context, value, value.resolution_ref))) return fail('UNKNOWN_USAGE', '/usage_completeness');
  return ok(value);
}
function queryDisposition(snapshot) {
  switch (snapshot.lifecycle) {
    case 'held': return snapshot.settlement_intent === 'partial' ? 'partially_consumed' : snapshot.decision;
    case 'consumed': return 'consumed';
    case 'released': return 'released';
    case 'expired': return 'expired';
    case 'uncertain_in_flight': return 'held_for_reconciliation';
    default: return null;
  }
}
function facts(value, context, historical = false) {
  if (value.producer.module !== 'cost-intelligence' || !same(value.authority_ref, context.authority_ref)) return fail('SCOPE_MISMATCH', '/authority_ref');
  const initial = originalRequest(context); if (!initial.ok) return initial;
  const request = initial.value;
  for (const key of ['budget_scope_id', 'logical_operation_id', 'billable_attempt_id']) if (value[key] !== request[key]) return fail('IDENTITY_COLLISION', '/' + key);
  if (value.grant_request_ref.id !== request.request_id || value.grant_request_ref.content_hash !== hashManifest(request) || !same(value.requested_capacity, request.requested) ||
      value.expires_at !== request.expires_at || value.idempotency_key !== request.idempotency_key || value.grant_revision !== context.grant_revision || value.revision < value.grant_revision ||
      value.decision !== context.grant_decision) return fail('INVALID_TRUST_CONTEXT', '/grant_request_ref');
  const finality = terminalFinality(value, context); if (!finality.ok) return finality;
  if (!granted(value)) {
    if ([value.held, value.consumed, value.overrun, value.dispatch_cap, value.retained_exposure, value.released_capacity].some(item => item !== null) || value.dispatch_acknowledgement_ref !== null ||
        value.settlement_intent !== 'none' || value.consumption_evidence_ref !== null || value.correction_ref !== null || value.exception_refs.length || value.settlement_ref !== null) return fail('INVALID_PAYLOAD', '/held');
    if (value.unreported_exposure !== (['unknown', 'unavailable'].includes(value.decision) ? 'unknown' : 'none')) return fail('UNKNOWN_USAGE', '/unreported_exposure');
    return ok(value);
  }
  if (request.pricing_basis !== 'bounded_conservative') return fail('UNKNOWN_USAGE', '/pricing_basis');
  for (const key of ['held', 'consumed', 'overrun', 'dispatch_cap', 'retained_exposure', 'released_capacity']) {
    if (value[key]?.currency !== context.currency) return fail('CURRENCY_MISMATCH', '/' + key + '/currency');
    if (!money(value[key], context.currency)) return fail('INVALID_MONEY', '/' + key);
  }
  if (!money(context.authorized_capacity, context.currency) || !same(value.held, context.authorized_capacity) || zero(value.held)) return fail('INVALID_TRUST_CONTEXT', '/authorized_capacity');
  if (value.decision === 'granted' && !same(value.held, request.requested)) return fail('INVALID_MONEY', '/held');
  if (value.decision === 'partially_granted' && (request.partial_grant !== 'allow_with_acknowledgement' || compare(value.held, request.requested) >= 0)) return fail('INVALID_TRANSITION', '/decision');
  if (!excessMatches(value.overrun, value.consumed, value.held)) return fail('INVALID_MONEY', '/overrun');
  const finalized = closed(value);
  if (finalized ? !zero(value.retained_exposure) || !remainingMatches(value.released_capacity, value.consumed, value.held) :
      !remainingMatches(value.retained_exposure, value.consumed, value.held) || !zero(value.released_capacity)) return fail('INVALID_MONEY', '/retained_exposure');
  if (value.unreported_exposure !== (finalized ? 'none' : 'unknown')) return fail('UNKNOWN_USAGE', '/unreported_exposure');
  if (!zero(value.overrun) && !value.exception_refs.length) return fail('INVALID_PAYLOAD', '/exception_refs');
  if (value.consumption_kind === 'regular' && value.correction_ref !== null) return fail('INVALID_PAYLOAD', '/correction_ref');
  if (value.consumption_kind !== 'regular' && value.correction_ref === null) return fail('INVALID_PAYLOAD', '/correction_ref');
  let acknowledged = false;
  if (value.dispatch_acknowledgement_ref !== null && !historical) {
    const checked = acknowledgement(value, context); if (!checked.ok) return checked;
    acknowledged = checked.value;
  }
  const canDispatch = !closed(value) && zero(value.overrun) && context.dispatch_state === 'eligible' && (value.decision === 'granted' || acknowledged);
  if (historical ? !zero(value.dispatch_cap) && (!same(value.dispatch_cap, value.held) || (value.decision === 'partially_granted' && value.dispatch_acknowledgement_ref === null)) :
      canDispatch ? !same(value.dispatch_cap, value.held) : !zero(value.dispatch_cap)) return fail('INVALID_MONEY', '/dispatch_cap');
  if (value.settlement_intent === 'none' && (!zero(value.consumed) || value.consumption_evidence_ref !== null || value.correction_ref !== null || value.exception_refs.length)) return fail('INVALID_TRANSITION', '/settlement_intent');
  if (value.settlement_intent !== 'none' && !historical) { const observed = observation(value, context); if (!observed.ok) return observed; }
  if (value.settlement_intent === 'final' && (value.lifecycle !== 'consumed' || value.usage_completeness !== 'complete' || uncertain(value.execution_state) || value.settlement_ref === null)) return fail('UNCERTAIN_EXECUTION', '/settlement_intent');
  if (value.lifecycle === 'consumed' && value.settlement_intent !== 'final') return fail('INVALID_TRANSITION', '/lifecycle');
  if (value.settlement_intent === 'partial' && (closed(value) || value.settlement_ref !== null)) return fail('INVALID_TRANSITION', '/settlement_intent');
  if (value.execution_state === 'uncertain' && value.lifecycle !== 'uncertain_in_flight') return fail('UNCERTAIN_EXECUTION', '/lifecycle');
  return ok(value);
}
function prior(context) {
  const parsed = validateContractVersion('BudgetReservation', '2.0.0', context.prior);
  if (!parsed.ok || !partition(parsed.value, context).ok) return fail('INVALID_TRUST_CONTEXT', '/prior');
  const checked = facts(parsed.value, context, true);
  if (!checked.ok) return fail('INVALID_TRUST_CONTEXT', '/prior');
  return parsed;
}
function resolved(context, old, ref) {
  const result = context.resolution;
  return object(result) && scopedRecord(result, context) && result.currency === context.currency && result.reservation_id === old.reservation_id && result.billable_attempt_id === old.billable_attempt_id &&
    ['finished', 'not_dispatched'].includes(result.execution_state) && result.execution_state === context.execution_state &&
    reference(result.reference) && result.reference.contract === 'FinanceResolution' && ref !== null && ref !== undefined && same(result.reference, ref);
}
function reservation(input, context, historical = false) {
  const parsed = boundary('BudgetReservation', input, context); if (!parsed.ok) return parsed;
  const value = parsed.value, checked = facts(value, context, historical); if (!checked.ok) return checked;
  if (historical && value.settlement_intent !== 'none') { const observed = observation(value, context); if (!observed.ok) return observed; }
  if (value.execution_state !== context.execution_state || value.usage_completeness !== context.usage_completeness) return fail('INVALID_TRUST_CONTEXT', '/execution_state');
  if (value.lifecycle === 'expired' && Date.parse(context.now) < Date.parse(value.expires_at)) return fail('INVALID_TRANSITION', '/lifecycle');
  if (!context.prior) return parsed;
  const old = prior(context); if (!old.ok) return old;
  for (const key of ['reservation_id', 'budget_scope_id', 'logical_operation_id', 'billable_attempt_id', 'idempotency_key', 'decision', 'grant_revision', 'grant_request_ref', 'requested_capacity', 'held', 'expires_at']) if (!same(value[key], old.value[key])) return fail('IDENTITY_COLLISION', '/' + key);
  if (value.revision === old.value.revision) return same(value, old.value) ? parsed : fail('REVISION_CONFLICT', '/revision');
  if (value.revision !== old.value.revision + 1) return fail('STALE_REVISION', '/revision');
  if (value.event_id === old.value.event_id) return fail('IDENTITY_COLLISION', '/event_id');
  if (uncertain(old.value.execution_state) && !uncertain(value.execution_state) && !resolved(context, old.value, value.resolution_ref)) return fail('UNCERTAIN_EXECUTION', '/execution_state');
  if (value.consumed && old.value.consumed && compare(value.consumed, old.value.consumed) < 0 && !correctionAuthorized(value, old.value, context)) return fail('INVALID_MONEY', '/consumed');
  if (closed(old.value) && (value.consumption_kind === 'regular' || value.correction_ref === null || value.lifecycle !== 'consumed')) return fail('INVALID_TRANSITION', '/lifecycle');
  if (old.value.consumption_evidence_ref && same(value.consumption_evidence_ref, old.value.consumption_evidence_ref) && value.consumed && old.value.consumed &&
      compare(value.consumed, old.value.consumed) !== 0) return fail('IDENTITY_COLLISION', '/consumption_evidence_ref');
  return parsed;
}
export function checkFinanceReservation(input, context) { return reservation(input, context); }
function commandShape(input, context) {
  if (!object(input) || !commands.includes(input.contract)) return fail('UNKNOWN_CONTRACT', '/contract');
  const parsed = boundary(input.contract, input, context); if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (value.currency !== context.currency) return fail('CURRENCY_MISMATCH', '/currency');
  if (context.previous_command) {
    const previous = validateContractVersion(context.previous_command.contract, '2.0.0', context.previous_command);
    if (!previous.ok || !commands.includes(previous.value.contract) || !partition(previous.value, context).ok || previous.value.currency !== context.currency) return fail('INVALID_TRUST_CONTEXT', '/previous_command');
    if (previous.value.idempotency_key === value.idempotency_key && !same(previous.value, value)) return fail('IDENTITY_COLLISION', '/idempotency_key');
  }
  if (value.contract === 'ReserveRequest') {
    if (context.prior) {
      const old = prior(context); if (!old.ok) return old;
      for (const key of ['budget_scope_id', 'logical_operation_id', 'billable_attempt_id']) if (value[key] !== old.value[key]) return fail('IDENTITY_COLLISION', '/' + key);
    }
    return value.pricing_basis === 'bounded_conservative' ? money(value.requested, context.currency) && !zero(value.requested) ? parsed : fail('INVALID_MONEY', '/requested') :
      value.requested === null ? parsed : fail('INVALID_MONEY', '/requested');
  }
  const old = prior(context); if (!old.ok) return old;
  for (const key of ['reservation_id', 'budget_scope_id', 'logical_operation_id', 'billable_attempt_id']) if (value[key] !== old.value[key]) return fail('IDENTITY_COLLISION', '/' + key);
  if (value.expected_revision !== old.value.revision) return fail('STALE_REVISION', '/expected_revision');
  if (value.contract === 'SettleRequest') {
    if (!money(value.consumed, context.currency)) return fail('INVALID_MONEY', '/consumed');
    if (old.value.consumed && compare(value.consumed, old.value.consumed) < 0 && !correctionAuthorized(value, old.value, context)) return fail('INVALID_MONEY', '/consumed');
    if ((value.consumption_kind === 'regular') !== (value.correction_ref === null)) return fail('INVALID_PAYLOAD', '/correction_ref');
  }
  return parsed;
}
function commandState(value, old) {
  if (!granted(old)) return fail('INVALID_TRANSITION', '/reservation_id');
  switch (value.contract) {
    case 'ReleaseRequest':
      if (closed(old) || !zero(old.consumed)) return fail('INVALID_TRANSITION', '/reason');
      return ok(value);
    case 'SettleRequest':
      if (closed(old) && (value.consumption_kind === 'regular' || value.correction_ref === null || value.settlement_intent !== 'final')) return fail('INVALID_TRANSITION', '/consumption_kind');
      return ok(value);
    default: return fail('UNKNOWN_CONTRACT', '/contract');
  }
}
function eligible(value, context) {
  if (value.contract === 'ReserveRequest') {
    if (value.pricing_basis !== 'bounded_conservative') return fail('UNKNOWN_USAGE', '/pricing_basis');
    return Date.parse(value.expires_at) > Date.parse(context.now) ? ok(value) : fail('EXPIRED', '/expires_at');
  }
  const old = prior(context); if (!old.ok) return old;
  if (value.contract === 'QueryRequest') return ok(value);
  const state = commandState(value, old.value); if (!state.ok) return state;
  if (value.contract === 'ReleaseRequest' || value.settlement_intent === 'final') {
    if (uncertain(context.execution_state) || (uncertain(old.value.execution_state) && !resolved(context, old.value, value.resolution_ref))) return fail('UNCERTAIN_EXECUTION', value.contract === 'ReleaseRequest' ? '/reason' : '/settlement_intent');
    if (context.usage_completeness !== 'complete' && !(value.contract === 'ReleaseRequest' && context.execution_state === 'not_dispatched' &&
        resolved(context, old.value, value.resolution_ref))) return fail('UNKNOWN_USAGE', '/usage_ref');
  }
  if (value.contract === 'ReleaseRequest') {
    if (value.reason === 'expired' && Date.parse(context.now) < Date.parse(old.value.expires_at)) return fail('INVALID_TRANSITION', '/reason');
  }
  if (value.contract === 'SettleRequest') {
    const candidate = { ...old.value, consumed: value.consumed, consumption_kind: value.consumption_kind, correction_ref: value.correction_ref, exception_refs: value.exception_refs, consumption_evidence_ref: value.usage_ref };
    const observed = observation(candidate, context); if (!observed.ok) return observed;
    const scale = Math.max(old.value.held.scale, value.consumed.scale);
    if (scaled(value.consumed.amount, scale) > scaled(old.value.held.amount, scale) && value.exception_refs.length === 0) return fail('INVALID_PAYLOAD', '/exception_refs');
  }
  return ok(value);
}
export function checkFinanceCommand(input, context) {
  const parsed = commandShape(input, context); return parsed.ok ? eligible(parsed.value, context) : parsed;
}
export function checkFinanceResult(input, context) {
  if (!object(input) || !names.filter(name => name.endsWith('Result')).includes(input.contract)) return fail('UNKNOWN_CONTRACT', '/contract');
  const parsed = boundary(input.contract, input, context); if (!parsed.ok) return parsed;
  let value = parsed.value;
  const duplicate = value.disposition === 'duplicate';
  if (context.previous_result) {
    const previous = validateContractVersion(context.previous_result.contract, '2.0.0', context.previous_result);
    if (!previous.ok || !partition(previous.value, context).ok || (previous.value.reservation && !partition(previous.value.reservation, context).ok)) return fail('INVALID_TRUST_CONTEXT', '/previous_result');
  }
  const requestContext = { ...context, references: context.request_references };
  if (duplicate && context.command_prior !== undefined) requestContext.prior = context.command_prior;
  // A cached grant has no pre-grant reservation, even when the live state has advanced.
  if (duplicate && context.request?.contract === 'ReserveRequest') delete requestContext.prior;
  const request = commandShape(context.request, requestContext); if (!request.ok) return fail('INVALID_TRUST_CONTEXT', '/request');
  const command = request.value;
  if (value.contract !== command.contract.replace('Request', 'Result') || value.request_id !== command.request_id || value.idempotency_key !== command.idempotency_key ||
      value.request_ref.id !== command.request_id || value.request_ref.content_hash !== hashManifest(command)) return fail('IDENTITY_COLLISION', '/request_ref');
  if (value.producer.module !== 'cost-intelligence') return fail('SCOPE_MISMATCH', '/producer/module');
  const failures = ['denied', 'unknown', 'unavailable'];
  if (['denied', 'unavailable'].includes(value.disposition) && value.error === null) return fail('INVALID_PAYLOAD', '/error');
  if (!failures.includes(value.disposition) && (value.reservation === null || value.error !== null)) return fail('INVALID_PAYLOAD', '/reservation');
  if (value.contract === 'QueryResult' && value.reservation !== null) {
    const scoped = partition(value.reservation, context); if (!scoped.ok) return scoped;
    if (!object(context.current_reservation) || !same(value.reservation, context.current_reservation)) return fail('INVALID_TRUST_CONTEXT', '/current_reservation');
    if (!failures.includes(value.disposition) && (value.reservation.execution_state !== context.execution_state ||
        value.reservation.usage_completeness !== context.usage_completeness)) return fail('INVALID_TRUST_CONTEXT', '/execution_state');
    const disposition = value.disposition === 'duplicate' ? context.previous_result?.disposition : value.disposition;
    if (!failures.includes(disposition) && disposition !== 'duplicate' && disposition !== queryDisposition(value.reservation)) return fail('INVALID_RECEIPT', '/disposition');
  }
  if (failures.includes(value.disposition)) {
    if (value.reservation !== null && (!context.prior || !same(value.reservation, context.prior))) return fail('INVALID_RECEIPT', '/reservation');
    return parsed;
  }
  if (duplicate) {
    if (!object(context.previous_result) || !object(context.previous_command) || !same(context.previous_command, command)) return fail('INVALID_TRUST_CONTEXT', '/previous_result');
    const previous = validateContractVersion(value.contract, '2.0.0', context.previous_result);
    if (!previous.ok || !partition(previous.value, context).ok || failures.includes(previous.value.disposition) || previous.value.disposition === 'duplicate' ||
        !same({ ...previous.value, disposition: 'duplicate' }, value)) return fail('INVALID_RECEIPT', '/reservation');
    // Validate the original outcome, without renewing command eligibility or dispatch authority.
    value = previous.value;
  }
  const outcomeContext = duplicate ? requestContext : context;
  const subcontext = { ...outcomeContext, references: Object.fromEntries(Object.entries(context.references).filter(([key]) => key.startsWith('reservation/')).map(([key, ref]) => [key.slice('reservation/'.length), ref])) };
  if (value.disposition === 'held_for_reconciliation') {
    const old = prior(outcomeContext); if (!old.ok) return old;
    if ((!uncertain(context.execution_state) && context.usage_completeness === 'complete') || value.reservation.lifecycle !== 'uncertain_in_flight' || value.reservation.settlement_ref !== null ||
        !same(value.reservation.consumed, old.value.consumed) || !same(value.reservation.held, old.value.held) ||
        !same(value.reservation.overrun, old.value.overrun) || !same(value.reservation.consumption_evidence_ref, old.value.consumption_evidence_ref) ||
        !same(value.reservation.retained_exposure, old.value.retained_exposure) || !same(value.reservation.released_capacity, old.value.released_capacity) ||
        value.reservation.unreported_exposure !== old.value.unreported_exposure ||
        value.reservation.settlement_intent !== old.value.settlement_intent || !same(value.reservation.exception_refs, old.value.exception_refs) ||
        !same(value.reservation.correction_ref, old.value.correction_ref)) return fail('INVALID_RECEIPT', '/reservation');
    const heldContext = { ...subcontext };
    if (command.contract !== 'QueryRequest') {
      if (context.prior_observation === undefined) delete heldContext.consumption_observation;
      else heldContext.consumption_observation = context.prior_observation;
    }
    const checked = reservation(value.reservation, heldContext, duplicate); return checked.ok ? parsed : checked;
  }
  if (!duplicate) { const transition = eligible(command, context); if (!transition.ok) return transition; }
  if (['SettleRequest', 'ReleaseRequest'].includes(command.contract)) {
    const old = prior(outcomeContext); if (!old.ok) return old;
    if (duplicate) { const state = commandState(command, old.value); if (!state.ok) return state; }
    // Snapshot equality cannot establish the origin of a successful mutation.
    if (value.reservation.revision !== old.value.revision + 1) return fail(value.reservation.revision === old.value.revision ? 'REVISION_CONFLICT' : 'STALE_REVISION', '/revision');
    if (value.reservation.event_id === old.value.event_id) return fail('IDENTITY_COLLISION', '/event_id');
  }
  const checked = reservation(value.reservation, subcontext, duplicate); if (!checked.ok) return checked;
  const snapshot = checked.value;
  for (const key of ['budget_scope_id', 'logical_operation_id', 'billable_attempt_id']) if (snapshot[key] !== command[key]) return fail('IDENTITY_COLLISION', '/reservation/' + key);
  if (command.contract === 'ReserveRequest') {
    if (outcomeContext.prior || !zero(snapshot.consumed) || snapshot.revision !== snapshot.grant_revision || snapshot.settlement_intent !== 'none' || snapshot.lifecycle !== 'held' ||
        snapshot.grant_request_ref.id !== command.request_id || snapshot.grant_request_ref.content_hash !== hashManifest(command)) return fail('INVALID_RECEIPT', '/reservation');
    if (!['granted', 'partially_granted'].includes(value.disposition) || value.disposition !== snapshot.decision) return fail('INVALID_RECEIPT', '/disposition');
    if (value.disposition === 'granted' && (snapshot.decision !== 'granted' || !same(snapshot.held, command.requested))) return fail('INVALID_MONEY', '/reservation/held');
    if (value.disposition === 'partially_granted' && (snapshot.decision !== 'partially_granted' || command.partial_grant !== 'allow_with_acknowledgement' ||
        !zero(snapshot.dispatch_cap) || snapshot.dispatch_acknowledgement_ref !== null)) return fail('INVALID_TRANSITION', '/reservation/dispatch_cap');
  } else if (command.contract === 'SettleRequest') {
    if (!same(snapshot.consumed, command.consumed) || snapshot.settlement_intent !== command.settlement_intent || snapshot.consumption_kind !== command.consumption_kind ||
        !same(snapshot.consumption_evidence_ref, command.usage_ref) || !same(snapshot.correction_ref, command.correction_ref) || !same(snapshot.exception_refs, command.exception_refs) ||
        !same(snapshot.resolution_ref ?? null, command.resolution_ref ?? null) ||
        value.disposition !== (command.settlement_intent === 'final' ? 'consumed' : 'partially_consumed')) return fail('INVALID_MONEY', '/reservation/consumed');
  } else if (command.contract === 'ReleaseRequest') {
    if (!['released', 'expired'].includes(value.disposition)) return fail('INVALID_RECEIPT', '/disposition');
    if (!same(snapshot.consumed, outcomeContext.prior.consumed) || snapshot.lifecycle !== (value.disposition === 'expired' ? 'expired' : 'released') ||
        (value.disposition === 'expired') !== (command.reason === 'expired') || !same(snapshot.resolution_ref ?? null, command.resolution_ref ?? null) || !zero(snapshot.dispatch_cap)) return fail('INVALID_RECEIPT', '/reservation');
  } else if (!object(context.current_reservation) || !same(snapshot, context.current_reservation)) return fail('INVALID_TRUST_CONTEXT', '/current_reservation');
  return parsed;
}
export function checkFinanceDispatch(input, context) {
  const parsed = checkFinanceReservation(input, context); if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (value.decision === 'partially_granted') return fail('UNSUPPORTED_CASE', '/decision');
  if (!granted(value) || closed(value) || context.dispatch_state !== 'eligible' || value.execution_state !== 'not_dispatched' || value.settlement_intent !== 'none' || Date.parse(value.expires_at) <= Date.parse(context.now) ||
      !money(context.requested_dispatch, context.currency) || zero(context.requested_dispatch) || zero(value.dispatch_cap)) return fail('INVALID_TRANSITION', '/dispatch_cap');
  if (value.usage_completeness !== 'complete') return fail('UNKNOWN_USAGE', '/usage_completeness');
  const scale = Math.max(value.dispatch_cap.scale, value.consumed.scale, context.requested_dispatch.scale);
  if (scaled(value.consumed.amount, scale) + scaled(context.requested_dispatch.amount, scale) > scaled(value.dispatch_cap.amount, scale)) return fail('INVALID_MONEY', '/dispatch_cap');
  return parsed;
}
export function checkFinanceOperation(contract, input, context) {
  if (object(input) && input.contract !== contract) return fail('INVALID_PAYLOAD', '/contract');
  if (contract === 'BudgetReservation') return checkFinanceReservation(input, context);
  if (commands.includes(contract)) return checkFinanceCommand(input, context);
  if (names.includes(contract)) return checkFinanceResult(input, context);
  return fail('UNKNOWN_CONTRACT', '/contract');
}
