import { validateContract, validateContractVersion, validatePrimitive, checkTrustedContext, canonicalJson, hashManifest, ContractError } from './runtime.mjs';
import { DefinitionVersionedReference, DefinitionDecisionQuestion } from '../generated/validators.mjs';
import { checkFinanceReservation, checkFinanceCommand, checkFinanceResult, checkFinanceDispatch } from './finance-v2.mjs';
export { errorRegistry } from '../generated/error-registry.mjs';

const ok = value => ({ ok: true, value });
const fail = (code, path = '') => ({ ok: false, errors: [{ code, path }] });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const contractOf = value => record(value) ? Object.getOwnPropertyDescriptor(value, 'contract')?.value : undefined;
const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
const keysEqual = (left, right) => left.length === right.length && new Set(left).size === left.length && left.every(key => right.includes(key));
const terminal = new Set(['succeeded', 'failed', 'cancelled']);
const transitions = {
  queued: ['queued', 'running', 'blocked', 'cancel-requested', 'cancelled', 'failed'],
  running: ['running', 'waiting-for-review', 'blocked', 'cancel-requested', 'cancelled', 'succeeded', 'failed'],
  'waiting-for-review': ['waiting-for-review', 'running', 'blocked', 'cancel-requested', 'cancelled', 'failed'],
  blocked: ['blocked', 'queued', 'running', 'cancel-requested', 'cancelled', 'failed'],
  'cancel-requested': ['cancel-requested', 'cancelled', 'succeeded', 'failed']
};

export function validateVersionedReference(value) {
  try { canonicalJson(value); } catch (error) {
    if (error instanceof ContractError) return fail('INVALID_PAYLOAD');
    throw error;
  }
  if (record(value) && typeof value.schema_version === 'string' && value.schema_version !== '1.0.0') return fail('UNSUPPORTED_VERSION', '/schema_version');
  if (!DefinitionVersionedReference(value)) return fail('INVALID_PAYLOAD');
  return ok(value);
}

function references(value, path = '', slot = false) {
  if (!record(value) && !Array.isArray(value)) return [];
  if (slot && record(value) && Object.hasOwn(value, 'schema_version') && Object.hasOwn(value, 'id') && Object.hasOwn(value, 'content_hash')) return [[path, value]];
  return Object.entries(value).flatMap(([key, child]) => ['instructions', 'criteria', 'index_labels', 'legend'].includes(key) ? [] : references(child, path ? path + '/' + key : key, key.endsWith('_ref') || key.endsWith('_refs') || key === 'reference' || key === 'prior_answers' || (slot && (Array.isArray(value) || path === 'prior_answers'))));
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

function boundary(contract, input, context, version) {
  const parsed = version ? validateContractVersion(contract, version, input) : validateContract(contract, input);
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

export function checkErrorEnvelope(input, context) {
  const parsed = boundary('ErrorEnvelope', input, context);
  if (!parsed.ok) return parsed;
  const detail = parsed.value.error;
  if (['TIMEOUT', 'UNKNOWN_SIDE_EFFECT'].includes(detail.code) && !['possible', 'unknown'].includes(detail.side_effects)) return fail('UNKNOWN_SIDE_EFFECT', '/error/side_effects');
  if (detail.code === 'UNKNOWN_USAGE' && detail.usage_state === 'complete') return fail('UNKNOWN_USAGE', '/error/usage_state');
  return parsed;
}

export function checkPartialFailure(input, context) {
  const parsed = boundary('PartialFailure', input, context);
  if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (!Array.isArray(context.item_ids) || !context.item_ids.length || !keysEqual(context.item_ids, [...new Set(context.item_ids)])) return fail('INVALID_TRUST_CONTEXT');
  if (value.acceptance_policy !== context.acceptance_policy) return fail('POLICY_MISMATCH', '/acceptance_policy');
  const ids = [...value.successful_item_ids, ...value.failures.map(item => item.item_id), ...value.unprocessed_item_ids];
  if (!keysEqual(ids, context.item_ids)) return fail('INVALID_BATCH', '/failures');
  if (!value.failures.length && !value.unprocessed_item_ids.length) return fail('INVALID_BATCH', '/failures');
  if (value.acceptance_policy === 'all_or_nothing' && value.successful_item_ids.length) return fail('INVALID_BATCH', '/successful_item_ids');
  for (let index = 0; index < value.failures.length; index++) {
    const detail = value.failures[index].error;
    if (detail.code === 'TIMEOUT' && detail.side_effects === 'none') return fail('UNKNOWN_SIDE_EFFECT', '/failures/' + index + '/error');
  }
  return parsed;
}

function jobFacts(value) {
  if (value.error) { const error = errorFacts(value.error, '/error'); if (!error.ok) return error; }
  if (value.progress.completed !== null && value.progress.total !== null && value.progress.completed > value.progress.total) return fail('INVALID_PAYLOAD', '/progress/completed');
  if (value.state === 'succeeded' && (value.outcome !== 'succeeded' || !value.result_refs.length)) return fail('INVALID_TRANSITION', '/outcome');
  if (value.state === 'failed' && value.outcome !== 'failed') return fail('INVALID_TRANSITION', '/outcome');
  if (value.state === 'failed' && value.error === null) return fail('INVALID_PAYLOAD', '/error');
  if (value.state === 'cancelled' && value.outcome !== 'cancelled') return fail('INVALID_TRANSITION', '/outcome');
  if (!terminal.has(value.state) && ['succeeded', 'failed', 'cancelled'].includes(value.outcome)) return fail('INVALID_TRANSITION', '/outcome');
  if (value.state === 'cancel-requested' && value.outcome === 'cancelled') return fail('INVALID_TRANSITION', '/outcome');
  return ok(value);
}

function priorJob(context) {
  if (!record(context.prior) || !['JobStatus', 'JobProgress'].includes(context.prior.contract)) return fail('INVALID_TRUST_CONTEXT', '/prior');
  const prior = validateContract(context.prior.contract, context.prior);
  if (!prior.ok || !jobFacts(prior.value).ok || !checkTrustedContext(prior.value, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/prior');
  return prior;
}

export function checkJobUpdate(input, context) {
  const suppliedContract = contractOf(input);
  const contract = ['JobStatus', 'JobProgress'].includes(suppliedContract) ? suppliedContract : 'JobStatus';
  const parsed = boundary(contract, input, context);
  if (!parsed.ok) return parsed;
  const facts = jobFacts(parsed.value); if (!facts.ok) return facts;
  const old = priorJob(context); if (!old.ok) return old;
  const value = parsed.value, prior = old.value;
  for (const key of ['job_id', 'workflow_id', 'run_id']) if (value[key] !== prior[key]) return fail('SCOPE_MISMATCH', '/' + key);
  const lease = context.lease_attempt_id ?? prior.lease_attempt_id;
  if (!validatePrimitive('LeaseAttemptId', lease).ok) return fail('INVALID_TRUST_CONTEXT', '/lease_attempt_id');
  if (value.lease_attempt_id !== lease) return fail('SCOPE_MISMATCH', '/lease_attempt_id');
  if (value.revision < prior.revision) return fail('STALE_REVISION', '/revision');
  if (value.revision === prior.revision) return equal(value, prior) ? parsed : fail('REVISION_CONFLICT', '/revision');
  if (value.revision !== prior.revision + 1) return fail('STALE_REVISION', '/revision');
  if (value.event_id === prior.event_id) return fail('IDENTITY_COLLISION', '/event_id');
  if (terminal.has(prior.state)) return fail('TERMINAL_JOB', '/state');
  if (!transitions[prior.state].includes(value.state)) return fail('INVALID_TRANSITION', '/state');
  if (value.progress.unit !== prior.progress.unit || (value.progress.completed !== null && prior.progress.completed !== null && value.progress.completed < prior.progress.completed)) return fail('STALE_REVISION', '/progress');
  if (prior.execution_state === 'uncertain' && value.execution_state === 'not_dispatched') return fail('UNCERTAIN_EXECUTION', '/execution_state');
  return parsed;
}

export function checkCancellation(input, context) {
  const parsed = boundary('Cancellation', input, context); if (!parsed.ok) return parsed;
  const old = priorJob(context); if (!old.ok) return old;
  if (parsed.value.job_id !== old.value.job_id) return fail('SCOPE_MISMATCH', '/job_id');
  if (Date.parse(parsed.value.requested_at) > Date.parse(context.now)) return fail('INVALID_PAYLOAD', '/requested_at');
  if (context.previous_command) {
    const previous = validateContract(context.previous_command.contract, context.previous_command);
    if (!previous.ok) return fail('INVALID_TRUST_CONTEXT', '/previous_command');
    if (previous.value.idempotency_key === parsed.value.idempotency_key) return equal(previous.value, parsed.value) ? parsed : fail('IDENTITY_COLLISION', '/idempotency_key');
  }
  if (parsed.value.expected_revision !== old.value.revision) return fail('STALE_REVISION', '/expected_revision');
  if (terminal.has(old.value.state)) return fail('TERMINAL_JOB', '/command');
  return parsed;
}

export function checkJobAcknowledgement(input, context) {
  const parsed = boundary('JobCommandAcknowledgement', input, context); if (!parsed.ok) return parsed;
  const old = priorJob(context); if (!old.ok) return old;
  const value = parsed.value, prior = old.value;
  if (value.job_id !== prior.job_id) return fail('SCOPE_MISMATCH', '/job_id');
  if ((value.disposition === 'rejected') !== (value.error !== null)) return fail('INVALID_PAYLOAD', '/error');
  if (value.expected_revision !== prior.revision) return fail('STALE_REVISION', '/expected_revision');
  if (value.command === 'resume' && terminal.has(prior.state) && value.disposition !== 'rejected') return fail('TERMINAL_JOB', '/command');
  if (value.disposition === 'duplicate') {
    if (!context.previous_command || !['Cancellation', 'JobCommandAcknowledgement'].includes(context.previous_command.contract)) return fail('INVALID_TRUST_CONTEXT', '/previous_command');
    if (!validateContract(context.previous_command.contract, context.previous_command).ok || !checkTrustedContext(context.previous_command, context.scope).ok) return fail('INVALID_TRUST_CONTEXT', '/previous_command');
    if (value.request_id !== context.previous_command.request_id || value.idempotency_key !== context.previous_command.idempotency_key || value.command !== context.previous_command.command) return fail('IDENTITY_COLLISION', '/request_id');
  }
  if (value.revision < prior.revision || value.revision > prior.revision + 1) return fail('STALE_REVISION', '/revision');
  if (value.job_ref && (value.job_ref.contract !== 'JobStatus' || value.job_ref.id !== value.job_id || value.job_ref.revision !== value.revision)) return fail('REFERENCE_MISMATCH', '/job_ref');
  if (['uncertain', 'in_flight'].includes(prior.execution_state) && value.execution_state === 'not_dispatched') return fail('UNCERTAIN_EXECUTION', '/execution_state');
  return parsed;
}

function usageFacts(value) {
  if (value.completeness === 'unknown' && value.usage_units !== null) return fail('UNKNOWN_USAGE', '/usage_units');
  if (value.completeness !== 'unknown' && value.usage_units === null) return fail('INVALID_PAYLOAD', '/usage_units');
  if (value.completeness === 'complete' && value.missing_fields.length) return fail('INVALID_PAYLOAD', '/missing_fields');
  if (value.completeness === 'complete' && value.usage_units.length === 0) return fail('INVALID_PAYLOAD', '/usage_units');
  if (value.completeness === 'incomplete' && !value.missing_fields.length) return fail('INVALID_PAYLOAD', '/missing_fields');
  if (value.usage_units) {
    const names = value.usage_units.map(unit => unit.name);
    if (new Set(names).size !== names.length) return fail('INVALID_PAYLOAD', '/usage_units');
    for (let index = 0; index < value.usage_units.length; index++) {
      const unit = value.usage_units[index];
      if (decimalScale(unit.quantity) > unit.scale) return fail('INVALID_MONEY', '/usage_units/' + index + '/quantity');
      if (unit.relation === 'included_subset' && (!unit.included_in || unit.included_in === unit.name || !names.includes(unit.included_in))) return fail('INVALID_PAYLOAD', '/usage_units/' + index + '/included_in');
      if (unit.relation !== 'included_subset' && Object.hasOwn(unit, 'included_in')) return fail('INVALID_PAYLOAD', '/usage_units/' + index + '/included_in');
    }
    const parent = Object.fromEntries(value.usage_units.filter(unit => unit.relation === 'included_subset').map(unit => [unit.name, unit.included_in]));
    for (const name of names) {
      const visited = new Set(); let current = name;
      while (Object.hasOwn(parent, current)) { if (visited.has(current)) return fail('INVALID_PAYLOAD', '/usage_units'); visited.add(current); current = parent[current]; }
    }
  }
  if (value.valuation.money && !moneyValid(value.valuation.money)) return fail('INVALID_MONEY', '/valuation/money/amount');
  return ok(value);
}

export function compareUsageIdentity(left, right) {
  const a = validateContractVersion('UsageEvent', '1.0.0', left), b = validateContractVersion('UsageEvent', '1.0.0', right);
  if (!a.ok) return a; if (!b.ok) return b;
  if (!usageFacts(a.value).ok || !usageFacts(b.value).ok) return fail('INVALID_PAYLOAD');
  for (const key of ['tenant_id', 'project_id']) if (a.value[key] !== b.value[key]) return fail('SCOPE_MISMATCH', '/' + key);
  const sameObservation = a.value.source_observation_id === b.value.source_observation_id;
  const executionKeys = ['logical_operation_id', 'provider_attempt_id', 'billable_attempt_id', 'provider', 'model', 'environment', 'billing_mode'];
  if (sameObservation) {
    for (const key of [...executionKeys, 'usage_event_id', 'provider_request_id']) if (a.value[key] !== b.value[key]) return fail('IDENTITY_COLLISION', '/' + key);
    for (const key of ['usage_units', 'valuation', 'completeness', 'outcome', 'supersedes_observation_id']) if (!equal(a.value[key], b.value[key])) return fail('OBSERVATION_CONFLICT', '/' + key);
    return ok('duplicate_observation');
  }
  if (a.value.billable_attempt_id !== b.value.billable_attempt_id) {
    if (b.value.supersedes_observation_id !== null) return fail('IDENTITY_COLLISION', '/supersedes_observation_id');
    return ok('distinct_billable_attempt');
  }
  for (const key of executionKeys) if (a.value[key] !== b.value[key]) return fail('IDENTITY_COLLISION', '/' + key);
  if (b.value.supersedes_observation_id !== null) return b.value.supersedes_observation_id === a.value.source_observation_id ? ok('superseding_observation') : fail('IDENTITY_COLLISION', '/supersedes_observation_id');
  return ok('same_execution');
}

export function checkUsageEvent(input, context) {
  const parsed = boundary('UsageEvent', input, context, '1.0.0'); if (!parsed.ok) return parsed;
  if (!['development', 'test', 'production'].includes(context.environment) || !['live', 'sandbox', 'simulated'].includes(context.billing_mode)) return fail('INVALID_TRUST_CONTEXT');
  if (parsed.value.environment !== context.environment || parsed.value.billing_mode !== context.billing_mode) return fail('SCOPE_MISMATCH', '/billing_mode');
  const facts = usageFacts(parsed.value); if (!facts.ok) return facts;
  if (parsed.value.supersedes_observation_id !== null && !context.prior) return fail('INVALID_TRUST_CONTEXT', '/prior');
  if (context.prior) { const relationship = compareUsageIdentity(context.prior, parsed.value); if (!relationship.ok) return relationship; }
  return parsed;
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

export function checkReservation(input, context) {
  if (!record(input) || input.schema_version !== '2.0.0') return fail('UNSUPPORTED_VERSION', '/schema_version');
  return checkFinanceReservation(input, context);
}
export function checkReservationCommand(input, context) {
  if (!record(input) || input.schema_version !== '2.0.0') return fail('UNSUPPORTED_VERSION', '/schema_version');
  return checkFinanceCommand(input, context);
}
export function checkReservationResult(input, context) {
  if (!record(input) || input.schema_version !== '2.0.0') return fail('UNSUPPORTED_VERSION', '/schema_version');
  return checkFinanceResult(input, context);
}

export function checkFinancialSummary(input, context) {
  const parsed = boundary('FinancialSummary', input, context); if (!parsed.ok) return parsed;
  const value = parsed.value;
  if (!validatePrimitive('Currency', context.currency).ok || !Array.isArray(context.included_environments) || !Array.isArray(context.included_billing_modes)) return fail('INVALID_TRUST_CONTEXT');
  if (value.producer.module !== 'cost-intelligence') return fail('SCOPE_MISMATCH', '/producer/module');
  if (value.currency !== context.currency) return fail('CURRENCY_MISMATCH', '/currency');
  if (!keysEqual(value.included_environments, context.included_environments) || !keysEqual(value.included_billing_modes, context.included_billing_modes)) return fail('SCOPE_MISMATCH', '/included_billing_modes');
  if (Date.parse(value.period.start) >= Date.parse(value.period.end)) return fail('INVALID_PAYLOAD', '/period/end');
  if (value.coverage.expected !== null && value.coverage.observed > value.coverage.expected) return fail('INVALID_PAYLOAD', '/coverage/observed');
  if (value.completeness === 'complete' && (value.coverage.expected === null || value.coverage.observed !== value.coverage.expected || value.coverage.missing_sources.length)) return fail('INVALID_PAYLOAD', '/coverage');
  if (value.rounding === 'none' && value.rounding_boundary !== 'none') return fail('POLICY_MISMATCH', '/rounding_boundary');
  for (const [name, metric] of Object.entries(value.metrics)) {
    if (metric.status === 'known' && (!moneyValid(metric.value) || metric.value.currency !== value.currency || metric.value.scale !== value.scale)) return fail('INVALID_MONEY', '/metrics/' + name + '/value');
    if (metric.status === 'unknown' && value.completeness === 'complete') return fail('UNKNOWN_USAGE', '/metrics/' + name);
  }
  for (let index = 0; index < value.original_amounts.length; index++) {
    const money = value.original_amounts[index];
    if (!moneyValid(money)) return fail('INVALID_MONEY', '/original_amounts/' + index);
    if (money.currency !== value.currency && value.conversion_ref === null) return fail('CURRENCY_MISMATCH', '/conversion_ref');
  }
  return parsed;
}

function decisionFacts(value, context, dispatch) {
  if (!Array.isArray(context.allowed_question_ids) || !record(context.allowed_candidates) || !Array.isArray(context.allowed_score_profiles) || !record(context.question_policies) || !Number.isSafeInteger(context.attempt_limit) || context.attempt_limit < 1 || context.attempt_limit > 100) return fail('INVALID_TRUST_CONTEXT');
  const ids = Object.keys(value.questions);
  if (!keysEqual(ids, context.allowed_question_ids)) return fail('INVALID_BATCH', '/questions');
  if (value.attempt_limit !== context.attempt_limit) return fail('POLICY_MISMATCH', '/attempt_limit');
  if (value.attempt_number > value.attempt_limit) return fail('POLICY_MISMATCH', '/attempt_number');
  if (dispatch && Date.parse(value.deadline_at) <= Date.parse(context.now)) return fail('EXPIRED', '/deadline_at');
  if (value.model_ref.contract !== 'model' || value.policy_ref.contract !== 'policy' || value.budget_ref.contract !== 'BudgetReservation' || value.state_ref.contract !== 'DecisionState') return fail('REFERENCE_MISMATCH', '/model_ref');
  const budget = validateContractVersion('BudgetReservation', '1.0.0', context.budget);
  if (!budget.ok || !reservationFacts(budget.value).ok || !checkTrustedContext(budget.value, context.scope).ok || budget.value.producer.module !== 'cost-intelligence' || budget.value.authority_ref.contract !== 'cost-intelligence') return fail('INVALID_TRUST_CONTEXT', '/budget');
  for (const key of ['environment', 'billing_mode']) {
    const expected = context[key] ?? budget.value[key];
    if (budget.value[key] !== expected) return fail('INVALID_TRUST_CONTEXT', '/budget/' + key);
    if (value[key] !== expected) return fail('SCOPE_MISMATCH', '/' + key);
  }
  if (dispatch && (budget.value.decision !== 'granted' || budget.value.lifecycle !== 'held' || budget.value.execution_state !== 'not_dispatched' || Date.parse(budget.value.expires_at) <= Date.parse(context.now))) return fail('BUDGET_UNAVAILABLE', '/budget_ref');
  if (!record(context.finance_context) || !record(context.finance_context.current_reservation)) return fail('INVALID_TRUST_CONTEXT', '/finance_context');
  const current = dispatch ? checkFinanceDispatch(context.finance_context.current_reservation, context.finance_context) : checkFinanceReservation(context.finance_context.current_reservation, context.finance_context);
  if (!current.ok || !checkTrustedContext(current.value, context.scope).ok || current.value.decision !== 'granted') return fail('INVALID_TRUST_CONTEXT', '/finance_context');
  for (const key of ['reservation_id', 'revision', 'budget_scope_id', 'logical_operation_id', 'billable_attempt_id', 'environment', 'billing_mode', 'held', 'consumed', 'authority_ref', 'expires_at']) if (!equal(budget.value[key], current.value[key])) return fail('INVALID_TRUST_CONTEXT', '/budget_projection');
  for (const key of ['logical_operation_id', 'billable_attempt_id']) if (value[key] !== budget.value[key]) return fail('IDENTITY_COLLISION', '/' + key);
  if (value.budget_ref.id !== budget.value.reservation_id || value.budget_ref.revision !== budget.value.revision) return fail('REFERENCE_MISMATCH', '/budget_ref');
  if (dispatch && (budget.value.decision !== 'granted' || budget.value.lifecycle !== 'held' || budget.value.execution_state !== 'not_dispatched' || Date.parse(budget.value.expires_at) <= Date.parse(context.now))) return fail('BUDGET_UNAVAILABLE', '/budget_ref');
  const visiting = new Set(), visited = new Set();
  function cycle(id) {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of value.questions[id].depends_on) if (Object.hasOwn(value.questions, dependency) && cycle(dependency)) return true;
    visiting.delete(id); visited.add(id); return false;
  }
  if (ids.some(cycle)) return fail('CYCLIC_DEPENDENCY', '/questions');
  for (const id of ids) {
    const question = value.questions[id], path = '/questions/' + id;
    const policy = context.question_policies[id];
    if (!record(policy)) return fail('INVALID_TRUST_CONTEXT', path + '/policy');
    if (question.type === 'noul') {
      if (policy.type !== 'noul' || !record(policy.uncertain_band) || !equal(policy.uncertain_band, question.uncertain_band)) return fail('POLICY_MISMATCH', path + '/uncertain_band');
    } else if (policy.type !== 'confidence' || typeof policy.minimum_confidence !== 'number' || policy.minimum_confidence !== question.minimum_confidence) return fail('POLICY_MISMATCH', path + '/minimum_confidence');
    for (const dependency of question.depends_on) {
      if (Object.hasOwn(value.questions, dependency)) return fail('DEPENDENT_BATCH', path + '/depends_on');
      if (!Object.hasOwn(value.prior_answers, dependency)) return fail('REFERENCE_MISMATCH', path + '/depends_on');
    }
    switch (question.type) {
      case 'choice': {
        const approved = context.allowed_candidates[id];
        if (!Array.isArray(approved) || !approved.length || new Set(approved).size !== approved.length) return fail('INVALID_TRUST_CONTEXT', path + '/eligible_candidate_ids');
        if (!keysEqual(Object.keys(question.criteria), question.eligible_candidate_ids) || question.eligible_candidate_ids.some(candidate => !approved.includes(candidate))) return fail('POLICY_MISMATCH', path + '/eligible_candidate_ids');
        break;
      }
      case 'score':
        if (!context.allowed_score_profiles.includes(question.profile)) return fail('POLICY_MISMATCH', path + '/profile');
        if (question.profile === 'ei-string-v1' && !Array.isArray(question.index_labels)) return fail('INVALID_PAYLOAD', path + '/index_labels');
        break;
      case 'noul':
        if (question.uncertain_band.lower >= question.uncertain_band.upper) return fail('POLICY_MISMATCH', path + '/uncertain_band');
        break;
      default: return fail('UNKNOWN_ENUM', path + '/type');
    }
  }
  const depended = new Set(ids.flatMap(id => value.questions[id].depends_on));
  if (Object.keys(value.prior_answers).some(id => !depended.has(id))) return fail('INVALID_BATCH', '/prior_answers');
  return ok(value);
}

export function checkDecisionRequest(input, context) {
  const parsed = boundary('DecisionPortRequest', input, context); if (!parsed.ok) return parsed;
  return decisionFacts(parsed.value, context, true);
}

function distribution(value, expected) {
  return keysEqual(Object.keys(value), expected) && Math.abs(Object.values(value).reduce((sum, probability) => sum + probability, 0) - 1) <= 0.000001;
}

export function checkDecisionResult(request, input, context) {
  const requestParsed = boundary('DecisionPortRequest', request, context); if (!requestParsed.ok) return requestParsed;
  const requestChecked = decisionFacts(requestParsed.value, context, false); if (!requestChecked.ok) return requestChecked;
  const parsed = boundary('DecisionPortResult', input, context); if (!parsed.ok) return parsed;
  const value = parsed.value, req = requestParsed.value;
  for (const key of ['environment', 'billing_mode']) if (value[key] !== req[key]) return fail('SCOPE_MISMATCH', '/' + key);
  for (const key of ['request_id', 'batch_id', 'logical_operation_id', 'billable_attempt_id', 'acceptance_policy']) if (value[key] !== req[key]) return fail('IDENTITY_COLLISION', '/' + key);
  for (const key of ['model_ref', 'policy_ref']) if (!equal(value[key], req[key])) return fail('REFERENCE_MISMATCH', '/' + key);
  const ids = Object.keys(req.questions);
  if (!keysEqual(Object.keys(value.answers), ids)) return fail('INVALID_BATCH', '/answers');
  for (const id of ids) {
    const question = req.questions[id], answerRecord = value.answers[id], path = '/answers/' + id;
    if (!Object.hasOwn(answerRecord, 'answer')) continue;
    const answer = answerRecord.answer;
    if (answer.type !== question.type) return fail('INVALID_PAYLOAD', path + '/answer/type');
    let review = false, reason = 'none';
    switch (question.type) {
      case 'choice': {
        if (!question.eligible_candidate_ids.includes(answer.choice)) return fail('POLICY_MISMATCH', path + '/answer/choice');
        if (!distribution(answer.probabilities, question.eligible_candidate_ids)) return fail('INVALID_DISTRIBUTION', path + '/answer/probabilities');
        if (answer.probabilities[answer.choice] < Math.max(...Object.values(answer.probabilities)) - 1e-12) return fail('INVALID_DISTRIBUTION', path + '/answer/choice');
        review = answer.confidence < question.minimum_confidence; reason = review ? 'low_confidence' : 'none';
        break;
      }
      case 'score': {
        if (answer.profile !== question.profile) return fail('PROFILE_UNREPRESENTABLE', path + '/answer/profile');
        const levels = question.profile === 'structured-index-v1' ? question.criteria : question.index_labels;
        const indices = levels.map((_, index) => String(index));
        if (!distribution(answer.probabilities, indices)) return fail('INVALID_DISTRIBUTION', path + '/answer/probabilities');
        if (question.profile === 'structured-index-v1') {
          if (!keysEqual(Object.keys(answer.legend), indices) || indices.some(index => !equal(answer.legend[index], levels[Number(index)]))) return fail('INVALID_PAYLOAD', path + '/answer/legend');
        } else if (answer.legend !== question.legacy_legend) return fail('INVALID_PAYLOAD', path + '/answer/legend');
        const weighted = indices.reduce((sum, index) => sum + Number(index) * answer.probabilities[index], 0);
        if (answer.score < 0 || answer.score > levels.length - 1 || Math.abs(answer.score - weighted) > 0.000001) return fail('INVALID_DISTRIBUTION', path + '/answer/score');
        review = answer.confidence < question.minimum_confidence; reason = review ? 'low_confidence' : 'none';
        break;
      }
      case 'noul':
        review = answer.noul >= question.uncertain_band.lower && answer.noul <= question.uncertain_band.upper; reason = review ? 'uncertain_probability' : 'none';
        break;
      default: return fail('UNKNOWN_ENUM', path + '/answer/type');
    }
    if (answerRecord.status !== (review ? 'review' : 'answered') || answerRecord.reason_code !== reason) return fail('POLICY_MISMATCH', path + '/status');
  }
  const statuses = Object.values(value.answers).map(answer => answer.status);
  const answered = statuses.filter(status => ['answered', 'review'].includes(status)).length;
  if (req.acceptance_policy === 'all_or_nothing' && answered > 0 && answered < ids.length) return fail('INVALID_BATCH', '/acceptance_policy');
  const expectedStatus = answered === ids.length ? statuses.includes('review') ? 'review' : 'complete' : new Set(statuses).size === 1 ? statuses[0] : 'partial';
  if (value.status !== expectedStatus) return fail('INVALID_BATCH', '/status');
  if (value.usage_completeness === 'complete' && value.usage_ref === null) return fail('INVALID_PAYLOAD', '/usage_ref');
  if (value.status === 'timeout' && (!value.error || value.error.code !== 'TIMEOUT' || value.error.side_effects === 'none')) return fail('UNKNOWN_SIDE_EFFECT', '/error');
  if (['complete', 'review'].includes(value.status) && Date.parse(value.occurred_at) > Date.parse(req.deadline_at)) return fail('EXPIRED', '/occurred_at');
  return parsed;
}

export function checkDecisionReceipt(input, context) {
  const parsed = boundary('DecisionReceipt', input, context); if (!parsed.ok) return parsed;
  const result = checkDecisionResult(context.request, context.result, context); if (!result.ok) return fail('INVALID_TRUST_CONTEXT', '/result');
  const req = context.request, value = parsed.value;
  for (const key of ['environment', 'billing_mode']) if (value[key] !== req[key]) return fail('SCOPE_MISMATCH', '/' + key);
  for (const key of ['request_id', 'batch_id', 'logical_operation_id', 'billable_attempt_id']) if (value[key] !== req[key]) return fail('INVALID_RECEIPT', '/' + key);
  if (!equal(value.normalized_result, context.result)) return fail('INVALID_RECEIPT', '/normalized_result');
  if (value.request_hash !== hashManifest(req)) return fail('INVALID_RECEIPT', '/request_hash');
  if (value.result_hash !== hashManifest(context.result)) return fail('INVALID_RECEIPT', '/result_hash');
  const ids = Object.keys(req.questions);
  if (!keysEqual(Object.keys(value.question_hashes), ids) || !keysEqual(Object.keys(value.answer_hashes), ids)) return fail('INVALID_RECEIPT', '/question_hashes');
  for (const id of ids) {
    if (value.question_hashes[id] !== hashManifest(req.questions[id])) return fail('INVALID_RECEIPT', '/question_hashes/' + id);
    if (value.answer_hashes[id] !== hashManifest(context.result.answers[id])) return fail('INVALID_RECEIPT', '/answer_hashes/' + id);
  }
  for (const key of ['model_ref', 'policy_ref', 'state_ref']) if (!equal(value[key], req[key])) return fail('INVALID_RECEIPT', '/' + key);
  if (!equal(value.usage_ref, context.result.usage_ref)) return fail('INVALID_RECEIPT', '/usage_ref');
  if (Date.parse(value.decided_at) < Date.parse(req.occurred_at) || Date.parse(value.decided_at) > Date.parse(context.now)) return fail('INVALID_RECEIPT', '/decided_at');
  const reviewReason = { complete: 'none', review: Object.values(context.result.answers).some(answer => answer.reason_code === 'uncertain_probability') ? 'uncertain' : 'low_confidence', partial: 'partial', unknown: 'uncertain', abstain: 'abstain', unavailable: 'unavailable', timeout: 'timeout', cancelled: 'cancelled', malformed: 'malformed' }[context.result.status];
  if (value.review_reason !== reviewReason) return fail('INVALID_RECEIPT', '/review_reason');
  return parsed;
}

export function adaptScoreProfile(question, target) {
  // Conversion is explicit and preserves the complete source; it is never owner acceptance.
  try { canonicalJson(question); } catch (error) {
    if (error instanceof ContractError) return fail('INVALID_PAYLOAD');
    throw error;
  }
  if (!DefinitionDecisionQuestion(question)) return fail('INVALID_PAYLOAD');
  if (!record(question) || question.type !== 'score' || !['ei-string-v1', 'structured-index-v1'].includes(question.profile) || !['ei-string-v1', 'structured-index-v1'].includes(target)) return fail('PROFILE_UNREPRESENTABLE', '/profile');
  if (question.profile === target) return ok({ source: question, target: question, schema_version: '1.0.0', accepted_migration: false });
  let converted;
  if (question.profile === 'structured-index-v1') {
    if (!Array.isArray(question.criteria) || question.criteria.length < 2 || question.criteria.length > 10) return fail('PROFILE_UNREPRESENTABLE', '/criteria');
    converted = { ...question, profile: 'ei-string-v1', criteria: canonicalJson(question.criteria), index_labels: question.criteria, legacy_legend: canonicalJson(Object.fromEntries(question.criteria.map((level, index) => [String(index), level]))) };
  } else {
    let decoded, legend;
    try { decoded = JSON.parse(question.criteria); legend = JSON.parse(question.legacy_legend); } catch (error) {
      if (error instanceof SyntaxError) return fail('PROFILE_UNREPRESENTABLE', '/criteria');
      throw error;
    }
    if (!Array.isArray(decoded) || !Array.isArray(question.index_labels) || !record(legend) || !equal(decoded, question.index_labels) || canonicalJson(decoded) !== question.criteria || canonicalJson(legend) !== question.legacy_legend || !equal(legend, Object.fromEntries(decoded.map((level, index) => [String(index), level])))) return fail('PROFILE_UNREPRESENTABLE', '/criteria');
    const { index_labels, legacy_legend, ...source } = question;
    converted = { ...source, profile: 'structured-index-v1', criteria: decoded };
  }
  return ok({ source: question, target: converted, schema_version: '1.0.0', accepted_migration: false });
}

export function bindDecisionPort(handler) {
  if (typeof handler !== 'function') throw new ContractError('INVALID_PAYLOAD');
  return Object.freeze({ async decide(request, context) {
    const parsed = checkDecisionRequest(request, context); if (!parsed.ok) return parsed;
    const freeze = value => {
      if (value !== null && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
      return value;
    };
    const immutableRequest = freeze(structuredClone(parsed.value)), immutableContext = freeze(structuredClone(context));
    const result = await handler(immutableRequest, immutableContext);
    return checkDecisionResult(immutableRequest, result, immutableContext);
  } });
}

export function checkOperation(contract, input, context) {
  switch (contract) {
    case 'ErrorEnvelope': return checkErrorEnvelope(input, context);
    case 'PartialFailure': return checkPartialFailure(input, context);
    case 'JobStatus': case 'JobProgress': return checkJobUpdate(input, context);
    case 'Cancellation': return checkCancellation(input, context);
    case 'JobCommandAcknowledgement': return checkJobAcknowledgement(input, context);
    case 'UsageEvent': return checkUsageEvent(input, context);
    case 'BudgetReservation': return checkReservation(input, context);
    case 'ReserveRequest': case 'SettleRequest': case 'ReleaseRequest': case 'QueryRequest': return checkReservationCommand(input, context);
    case 'ReserveResult': case 'SettleResult': case 'ReleaseResult': case 'QueryResult': return checkReservationResult(input, context);
    case 'FinancialSummary': return checkFinancialSummary(input, context);
    case 'DecisionPortRequest': return checkDecisionRequest(input, context);
    case 'DecisionPortResult': return checkDecisionResult(context?.request, input, context);
    case 'DecisionReceipt': return checkDecisionReceipt(input, context);
    default: return fail('UNKNOWN_CONTRACT', '/contract');
  }
}
