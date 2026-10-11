import { validateContractVersion, validatePrimitive, checkTrustedContext, canonicalJson, ContractError } from './runtime.mjs';
import { validateVersionedReference } from './operations.mjs';
const validateContract = (contract, value) => validateContractVersion(contract, '1.0.0', value);
const ok = value => ({ ok: true, value });
const fail = (code, path = '') => ({ ok: false, errors: [{ code, path }] });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const contractOf = value => record(value) ? Object.getOwnPropertyDescriptor(value, 'contract')?.value : undefined;
const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
function references(value, path = '', slot = false) {
  if (value === null || typeof value !== 'object') return [];
  if (slot && record(value) && Object.hasOwn(value, 'schema_version') && Object.hasOwn(value, 'content_hash')) return [[path, value]];
  return Object.entries(value).flatMap(([key, child]) => references(child, path ? path + '/' + key : key, key.endsWith('_ref') || key.endsWith('_refs') || key === 'reference' || (slot && Array.isArray(value))));
}
function errorFacts(detail, path) {
  if (detail.code === 'UNKNOWN_USAGE' && detail.usage_state === 'complete') return fail('UNKNOWN_USAGE', path + '/usage_state');
  if (['TIMEOUT', 'UNKNOWN_SIDE_EFFECT'].includes(detail.code) && !['possible', 'unknown'].includes(detail.side_effects)) return fail('UNKNOWN_SIDE_EFFECT', path + '/side_effects');
  return ok(detail);
}

function embeddedErrorFacts(value, path = '', slot = false) {
  if (value === null || typeof value !== 'object') return ok(value);
  if (slot && record(value) && Object.hasOwn(value, 'code') && Object.hasOwn(value, 'usage_state')) return errorFacts(value, path);
  for (const [key, child] of Object.entries(value)) {
    if (['instructions', 'criteria', 'index_labels', 'legend'].includes(key)) continue;
    const result = embeddedErrorFacts(child, path + '/' + key, key === 'error');
    if (!result.ok) return result;
  }
  return ok(value);
}

function boundary(contract, input, context) {
  const parsed = validateContract(contract, input);
  if (!parsed.ok) return parsed;
  try { canonicalJson(context); } catch (error) {
    if (error instanceof ContractError) return fail('INVALID_TRUST_CONTEXT');
    throw error;
  }
  if (!record(context) || !validatePrimitive('UtcTime', context.now).ok || !context.now.endsWith('Z') || context.policy_version !== '1.0.0' || !record(context.references)) return fail('INVALID_TRUST_CONTEXT');
  const scoped = checkTrustedContext(parsed.value, context.scope);
  if (!scoped.ok) return scoped;
  if (parsed.value.policy_version !== context.policy_version) return fail('POLICY_MISMATCH', '/policy_version');
  for (const [path, reference] of references(parsed.value)) {
    const expected = context.references[path];
    if (!validateVersionedReference(expected).ok) return fail('INVALID_TRUST_CONTEXT', '/' + path);
    if (!equal(reference, expected)) return fail('REFERENCE_MISMATCH', '/' + path);
  }
  const errors = embeddedErrorFacts(parsed.value); if (!errors.ok) return errors;
  return parsed;
}

function decimalScale(value) { return value.includes('.') ? value.split('.')[1].length : 0; }
function moneyValid(value) { return decimalScale(value.amount) <= value.scale; }
function compareDecimal(left, right) {
  const scale = Math.max(decimalScale(left), decimalScale(right));
  const scaled = value => {
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole + fraction.padEnd(scale, '0'));
  };
  const a = scaled(left); const b = scaled(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function reservationFacts(value) {
  if (value.decision === 'granted' && (value.held === null || value.consumed === null)) return fail('INVALID_PAYLOAD', '/held');
  if (value.decision !== 'granted' && (value.held !== null || value.consumed !== null)) return fail('INVALID_PAYLOAD', '/held');
  for (const key of ['held', 'consumed']) if (value[key] && !moneyValid(value[key])) return fail('INVALID_MONEY', '/' + key + '/amount');
  if (value.held && value.consumed && (value.held.currency !== value.consumed.currency || compareDecimal(value.consumed.amount, value.held.amount) > 0)) return fail('INVALID_MONEY', '/consumed');
  if (['in_flight', 'uncertain'].includes(value.execution_state) && ['released', 'expired', 'consumed'].includes(value.lifecycle)) return fail('UNCERTAIN_EXECUTION', '/lifecycle');
  if (value.lifecycle === 'consumed' && value.usage_completeness !== 'complete') return fail('UNKNOWN_USAGE', '/usage_completeness');
  if (value.lifecycle === 'consumed' && value.settlement_ref === null) return fail('INVALID_PAYLOAD', '/settlement_ref');
  if (value.execution_state === 'uncertain' && value.lifecycle !== 'uncertain_in_flight') return fail('UNCERTAIN_EXECUTION', '/lifecycle');
  return ok(value);
}

function reservationPrior(context) {
  const prior = validateContract('BudgetReservation', context.prior);
  if (!prior.ok || !reservationFacts(prior.value).ok || !checkTrustedContext(prior.value, context.scope).ok || prior.value.producer.module !== 'cost-intelligence' || !equal(prior.value.authority_ref, context.authority_ref)) return fail('INVALID_TRUST_CONTEXT', '/prior');
  return prior;
}

function reservationContext(context) {
  if (!validatePrimitive('Currency', context.currency).ok || !['not_dispatched', 'in_flight', 'finished', 'uncertain'].includes(context.execution_state) || !['complete', 'incomplete', 'unknown'].includes(context.usage_completeness) || !validateVersionedReference(context.authority_ref).ok || context.authority_ref.contract !== 'cost-intelligence') return fail('INVALID_TRUST_CONTEXT');
  return ok(context);
}

function financeResolved(context, prior, reference) {
  const resolution = context.resolution;
  return record(resolution) && checkTrustedContext(resolution, context.scope).ok &&
    resolution.reservation_id === prior.reservation_id && resolution.billable_attempt_id === prior.billable_attempt_id &&
    ['finished', 'not_dispatched'].includes(resolution.execution_state) && resolution.execution_state === context.execution_state &&
    validateVersionedReference(resolution.reference).ok && resolution.reference.contract === 'FinanceResolution' &&
    reference !== null && reference !== undefined && equal(resolution.reference, reference);
}

function checkReservation(input, context) {
  const parsed = boundary('BudgetReservation', input, context); if (!parsed.ok) return parsed;
  const trusted = reservationContext(context); if (!trusted.ok) return trusted;
  const value = parsed.value;
  if (value.producer.module !== 'cost-intelligence' || !equal(value.authority_ref, context.authority_ref)) return fail('SCOPE_MISMATCH', '/authority_ref');
  const facts = reservationFacts(value); if (!facts.ok) return facts;
  if (value.held && value.held.currency !== context.currency) return fail('CURRENCY_MISMATCH', '/held/currency');
  if (['in_flight', 'uncertain'].includes(context.execution_state) && ['released', 'expired', 'consumed'].includes(value.lifecycle)) return fail('UNCERTAIN_EXECUTION', '/lifecycle');
  if (value.lifecycle === 'expired' && Date.parse(context.now) < Date.parse(value.expires_at)) return fail('INVALID_TRANSITION', '/lifecycle');
  if (context.prior) {
    const old = reservationPrior(context); if (!old.ok) return old;
    if (['in_flight', 'uncertain'].includes(old.value.execution_state) && !['in_flight', 'uncertain'].includes(value.execution_state) && !financeResolved(context, old.value, value.resolution_ref)) return fail('UNCERTAIN_EXECUTION', '/execution_state');
    for (const key of ['reservation_id', 'budget_scope_id', 'logical_operation_id', 'billable_attempt_id', 'idempotency_key']) if (value[key] !== old.value[key]) return fail('IDENTITY_COLLISION', '/' + key);
    if (value.revision < old.value.revision || value.revision > old.value.revision + 1) return fail('STALE_REVISION', '/revision');
    if (value.revision === old.value.revision && !equal(value, old.value)) return fail('REVISION_CONFLICT', '/revision');
    if (['released', 'expired', 'consumed'].includes(old.value.lifecycle) && value.revision !== old.value.revision) return fail('INVALID_TRANSITION', '/lifecycle');
    if (old.value.held && value.held && (!equal(old.value.held, value.held) || (old.value.consumed && value.consumed && compareDecimal(value.consumed.amount, old.value.consumed.amount) < 0))) return fail('INVALID_MONEY', '/held');
  }
  return parsed;
}

function checkReservationCommand(input, context) {
  const allowed = ['ReserveRequest', 'SettleRequest', 'ReleaseRequest', 'QueryRequest'];
  const contract = contractOf(input);
  if (!allowed.includes(contract)) return fail('UNKNOWN_CONTRACT', '/contract');
  const parsed = boundary(contract, input, context); if (!parsed.ok) return parsed;
  const trusted = reservationContext(context); if (!trusted.ok) return trusted;
  const value = parsed.value;
  if (value.currency !== context.currency) return fail('CURRENCY_MISMATCH', '/currency');
  if (context.previous_command) {
    const previous = validateContract(context.previous_command.contract, context.previous_command);
    if (!previous.ok || !allowed.includes(previous.value.contract)) return fail('INVALID_TRUST_CONTEXT', '/previous_command');
    if (previous.value.idempotency_key === value.idempotency_key) return equal(previous.value, value) ? parsed : fail('IDENTITY_COLLISION', '/idempotency_key');
  }
  if (value.contract === 'ReserveRequest') {
    if (!moneyValid(value.requested)) return fail('INVALID_MONEY', '/requested/amount');
    if (value.requested.currency !== context.currency) return fail('CURRENCY_MISMATCH', '/requested/currency');
    if (Date.parse(value.expires_at) <= Date.parse(context.now)) return fail('EXPIRED', '/expires_at');
    return parsed;
  }
  const old = reservationPrior(context); if (!old.ok) return old;
  for (const key of ['reservation_id', 'budget_scope_id', 'logical_operation_id', 'billable_attempt_id']) if (value[key] !== old.value[key]) return fail('IDENTITY_COLLISION', '/' + key);
  if (old.value.held && old.value.held.currency !== value.currency) return fail('CURRENCY_MISMATCH', '/currency');
  if (value.expected_revision !== old.value.revision) return fail('STALE_REVISION', '/expected_revision');
  if (value.contract !== 'QueryRequest' && old.value.decision !== 'granted') return fail('INVALID_TRANSITION', '/reservation_id');
  if (value.contract === 'ReleaseRequest') {
    if (['in_flight', 'uncertain'].includes(context.execution_state) || (['in_flight', 'uncertain'].includes(old.value.execution_state) && !financeResolved(context, old.value, value.resolution_ref))) return fail('UNCERTAIN_EXECUTION', '/reason');
    if (context.usage_completeness !== 'complete' && context.execution_state !== 'not_dispatched') return fail('UNKNOWN_USAGE', '/reason');
    if (value.reason === 'expired' && Date.parse(context.now) < Date.parse(old.value.expires_at)) return fail('INVALID_TRANSITION', '/reason');
  }
  if (value.contract === 'SettleRequest') {
    if (['in_flight', 'uncertain'].includes(context.execution_state)) return fail('UNCERTAIN_EXECUTION', '/usage_ref');
    if (['in_flight', 'uncertain'].includes(old.value.execution_state) && !financeResolved(context, old.value, value.resolution_ref)) return fail('UNCERTAIN_EXECUTION', '/usage_ref');
    if (context.usage_completeness !== 'complete') return fail('UNKNOWN_USAGE', '/usage_ref');
    if (!moneyValid(value.consumed) || !old.value.held || compareDecimal(value.consumed.amount, old.value.held.amount) > 0) return fail('INVALID_MONEY', '/consumed');
    if (value.consumed.currency !== context.currency) return fail('CURRENCY_MISMATCH', '/consumed/currency');
  }
  return parsed;
}

function checkReservationResult(input, context) {
  const allowed = ['ReserveResult', 'SettleResult', 'ReleaseResult', 'QueryResult'];
  const contract = contractOf(input);
  if (!allowed.includes(contract)) return fail('UNKNOWN_CONTRACT', '/contract');
  const parsed = boundary(contract, input, context); if (!parsed.ok) return parsed;
  const value = parsed.value;
  const successful = !['denied', 'unknown', 'unavailable'].includes(value.disposition);
  const request = successful ? checkReservationCommand(context.request, context) : record(context.request) && ['ReserveRequest', 'SettleRequest', 'ReleaseRequest', 'QueryRequest'].includes(context.request.contract) ? boundary(context.request.contract, context.request, context) : fail('INVALID_TRUST_CONTEXT');
  if (!request.ok) return fail('INVALID_TRUST_CONTEXT', '/request');
  const dispositions = { ReserveResult: ['granted', 'denied', 'unknown', 'unavailable', 'duplicate'], SettleResult: ['consumed', 'denied', 'unknown', 'unavailable', 'duplicate', 'held_for_reconciliation'], ReleaseResult: ['released', 'expired', 'denied', 'unknown', 'unavailable', 'duplicate', 'held_for_reconciliation'], QueryResult: ['granted', 'denied', 'unknown', 'unavailable', 'duplicate', 'consumed', 'released', 'expired', 'held_for_reconciliation'] };
  if (!dispositions[value.contract].includes(value.disposition)) return fail('INVALID_TRANSITION', '/disposition');
  if (value.contract !== request.value.contract.replace('Request', 'Result') || value.request_id !== request.value.request_id || value.idempotency_key !== request.value.idempotency_key) return fail('IDENTITY_COLLISION', '/request_id');
  if (value.producer.module !== 'cost-intelligence') return fail('SCOPE_MISMATCH', '/producer/module');
  if (['denied', 'unavailable'].includes(value.disposition) && !value.error) return fail('INVALID_PAYLOAD', '/error');
  if (['granted', 'duplicate', 'consumed', 'released', 'expired', 'held_for_reconciliation'].includes(value.disposition) && !value.reservation) return fail('INVALID_PAYLOAD', '/reservation');
  if (value.reservation) {
    const checked = checkReservation(value.reservation, { ...context, references: Object.fromEntries(Object.entries(context.references).filter(([key]) => key.startsWith('reservation/')).map(([key, ref]) => [key.slice('reservation/'.length), ref])) });
    if (!checked.ok) return checked;
    for (const key of ['budget_scope_id', 'logical_operation_id', 'billable_attempt_id']) if (checked.value[key] !== request.value[key]) return fail('IDENTITY_COLLISION', '/reservation/' + key);
    const lifecycle = { consumed: 'consumed', released: 'released', expired: 'expired', held_for_reconciliation: 'uncertain_in_flight' }[value.disposition];
    if (lifecycle && checked.value.lifecycle !== lifecycle) return fail('INVALID_TRANSITION', '/reservation/lifecycle');
    if (value.disposition === 'granted' && checked.value.decision !== 'granted') return fail('INVALID_TRANSITION', '/reservation/decision');
  }
  return parsed;
}

export function historicalFinanceFixture(contract, value, context) {
  if (contract === 'BudgetReservation') return checkReservation(value, context);
  if (contract.endsWith('Request')) return checkReservationCommand(value, context);
  return checkReservationResult(value, context);
}
