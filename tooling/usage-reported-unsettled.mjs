import {
  canonicalJson,
  checkTrustedContext,
  ContractError,
  hashBytes,
  validateContractVersion,
  validatePrimitive
} from './runtime.mjs';
import { DefinitionVersionedReference } from '../generated/validators.mjs';

const EVIDENCE_HASH_DOMAIN = 'ProviderReportedCostEvidence/1.0.0\0';
const ok = value => ({ ok: true, value });
const fail = (code, path = '') => ({ ok: false, errors: [{ code, path }] });
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const equal = (left, right) => canonicalJson(left) === canonicalJson(right);
const decimalScale = value => value.includes('.') ? value.split('.')[1].length : 0;
const moneyValid = money => decimalScale(money.amount) <= money.scale;
const allowedEnvironments = ['development', 'test', 'production'];
const allowedBillingModes = ['live', 'sandbox', 'simulated'];

function versionedReference(value) {
  return DefinitionVersionedReference(value);
}

function referenceForEvidence(evidence) {
  return {
    contract: 'ProviderReportedCostEvidence',
    schema_version: '1.0.0',
    id: evidence.evidence_id,
    revision: evidence.revision,
    content_hash: evidence.content_hash
  };
}

function safeNow(value) {
  return validatePrimitive('UtcTime', value).ok && value.endsWith('Z');
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
      const visited = new Set();
      let current = name;
      while (Object.hasOwn(parent, current)) {
        if (visited.has(current)) return fail('INVALID_PAYLOAD', '/usage_units');
        visited.add(current);
        current = parent[current];
      }
    }
  }
  return ok(value);
}

export function providerReportedCostEvidenceContentHash(value) {
  if (!record(value)) throw new ContractError('INVALID_PAYLOAD');
  canonicalJson(value);
  const content = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'content_hash'));
  return hashBytes(new TextEncoder().encode(EVIDENCE_HASH_DOMAIN + canonicalJson(content)));
}

export function checkProviderReportedCostEvidence(input) {
  const parsed = validateContractVersion('ProviderReportedCostEvidence', '1.0.0', input);
  if (!parsed.ok) return parsed;
  try {
    const value = parsed.value;
    if (value.content_hash !== providerReportedCostEvidenceContentHash(value)) return fail('INVALID_PAYLOAD', '/content_hash');
    if (value.reported_cost.state === 'known' && !moneyValid(value.reported_cost.money)) return fail('INVALID_MONEY', '/reported_cost/money/amount');
    if (value.source_scope.kind === 'per_key_aggregate' && Date.parse(value.source_scope.period_start) >= Date.parse(value.source_scope.period_end)) {
      return fail('INVALID_PAYLOAD', '/source_scope/period_end');
    }
    return ok(value);
  } catch (error) {
    if (error instanceof ContractError) return fail(error.code);
    throw error;
  }
}

export function compareReportedUnsettledUsageIdentity(left, right) {
  const a = validateContractVersion('UsageEvent', '2.0.0', left);
  const b = validateContractVersion('UsageEvent', '2.0.0', right);
  if (!a.ok) return a;
  if (!b.ok) return b;
  if (a.value.valuation.basis !== 'provider_reported_unsettled' || b.value.valuation.basis !== 'provider_reported_unsettled') {
    return fail('UNSUPPORTED_CASE', '/valuation/basis');
  }
  const first = a.value;
  const next = b.value;
  const firstFacts = reportedUsageFacts(first);
  const nextFacts = reportedUsageFacts(next);
  if (!firstFacts.ok) return firstFacts;
  if (!nextFacts.ok) return nextFacts;
  for (const key of ['tenant_id', 'project_id']) {
    if (first[key] !== next[key]) return fail('SCOPE_MISMATCH', '/' + key);
  }
  if (first.supersedes_observation_id === next.source_observation_id &&
      next.supersedes_observation_id === first.source_observation_id) {
    return fail('IDENTITY_COLLISION', '/supersedes_observation_id');
  }
  const sameObservation = first.source_observation_id === next.source_observation_id;
  const executionKeys = [
    'logical_operation_id', 'provider_attempt_id', 'billable_attempt_id',
    'provider_request_id', 'provider', 'model', 'source', 'environment', 'billing_mode'
  ];
  if (sameObservation) {
    if (!equal(first.producer, next.producer)) return fail('IDENTITY_COLLISION', '/producer');
    for (const key of [...executionKeys, 'usage_event_id']) {
      if (first[key] !== next[key]) return fail('IDENTITY_COLLISION', '/' + key);
    }
    const deliveryFields = new Set(['event_id', 'correlation_id', 'ingested_at', 'transport_attempt_id']);
    for (const key of new Set([...Object.keys(first), ...Object.keys(next)])) {
      if (deliveryFields.has(key)) continue;
      const inFirst = Object.hasOwn(first, key);
      const inNext = Object.hasOwn(next, key);
      if (inFirst !== inNext || (inFirst && !equal(first[key], next[key]))) {
        return fail('OBSERVATION_CONFLICT', '/' + key);
      }
    }
    // The source-bound observed_at and other report fields are immutable; only transport/envelope delivery fields may vary.
    return ok('duplicate_observation');
  }
  if (first.billable_attempt_id !== next.billable_attempt_id) {
    if (next.supersedes_observation_id !== null) return fail('IDENTITY_COLLISION', '/supersedes_observation_id');
    return ok('distinct_billable_attempt');
  }
  for (const key of executionKeys) {
    if (first[key] !== next[key]) return fail('IDENTITY_COLLISION', '/' + key);
  }
  if (next.supersedes_observation_id === first.source_observation_id) return ok('superseding_observation');
  if (first.supersedes_observation_id === next.source_observation_id) return ok('superseded_observation');
  if (next.supersedes_observation_id !== null) return fail('IDENTITY_COLLISION', '/supersedes_observation_id');
  for (const key of ['usage_units', 'missing_fields', 'valuation', 'completeness', 'outcome']) {
    if (!equal(first[key], next[key])) return fail('OBSERVATION_CONFLICT', '/' + key);
  }
  return ok('same_execution');
}

function reportedUsageFacts(value) {
  const usage = usageFacts(value);
  if (!usage.ok) return usage;
  if (!moneyValid(value.valuation.money)) return fail('INVALID_MONEY', '/valuation/money/amount');
  if (value.supersedes_observation_id === value.source_observation_id) {
    return fail('IDENTITY_COLLISION', '/supersedes_observation_id');
  }
  return ok(value);
}

export function checkReportedUnsettledUsageEvent(input, context) {
  const parsed = validateContractVersion('UsageEvent', '2.0.0', input);
  if (!parsed.ok) return parsed;
  try {
    canonicalJson(context);
  } catch (error) {
    if (error instanceof ContractError) return fail('INVALID_TRUST_CONTEXT');
    throw error;
  }
  if (!record(context) || !safeNow(context.now) || context.policy_version !== '1.0.0' || !record(context.references)) {
    return fail('INVALID_TRUST_CONTEXT');
  }
  if (!allowedEnvironments.includes(context.environment) || !allowedBillingModes.includes(context.billing_mode)) {
    return fail('INVALID_TRUST_CONTEXT');
  }
  const value = parsed.value;
  if (value.policy_version !== context.policy_version) return fail('POLICY_MISMATCH', '/policy_version');
  const scoped = checkTrustedContext(value, context.scope);
  if (!scoped.ok) return scoped;
  if (value.environment !== context.environment || value.billing_mode !== context.billing_mode) return fail('SCOPE_MISMATCH', '/billing_mode');
  if (value.valuation.basis !== 'provider_reported_unsettled') return fail('UNSUPPORTED_CASE', '/valuation/basis');
  if (value.valuation.rate_card_ref !== null) return fail('INVALID_PAYLOAD', '/valuation/rate_card_ref');
  if (value.reconciliation_ref !== null) return fail('INVALID_PAYLOAD', '/reconciliation_ref');
  const facts = reportedUsageFacts(value);
  if (!facts.ok) return facts;
  const retryReference = context.references.retry_mapping_ref;
  if (!versionedReference(retryReference)) return fail('INVALID_TRUST_CONTEXT', '/retry_mapping_ref');
  if (!equal(value.retry_mapping_ref, retryReference)) return fail('REFERENCE_MISMATCH', '/retry_mapping_ref');

  const lookup = context.evidence_lookup;
  if (!record(lookup) || !['resolved', 'missing', 'revoked', 'unverified'].includes(lookup.status)) {
    return fail('INVALID_TRUST_CONTEXT', '/evidence_lookup');
  }
  if (!versionedReference(lookup.expected_reference)) return fail('INVALID_TRUST_CONTEXT', '/evidence_lookup/expected_reference');
  if (!equal(value.valuation.provider_evidence_ref, lookup.expected_reference)) {
    return fail('REFERENCE_MISMATCH', '/valuation/provider_evidence_ref');
  }
  if (lookup.status !== 'resolved') return fail('INVALID_TRUST_CONTEXT', '/evidence_lookup/status');
  if (!safeNow(lookup.resolved_at) || Date.parse(lookup.resolved_at) > Date.parse(context.now)) {
    return fail('INVALID_TRUST_CONTEXT', '/evidence_lookup/resolved_at');
  }
  const evidenceResult = checkProviderReportedCostEvidence(lookup.record);
  if (!evidenceResult.ok) return evidenceResult;
  const evidence = evidenceResult.value;
  if (!validatePrimitive('Sha256', lookup.source_bytes_hash).ok || lookup.source_bytes_hash !== evidence.source_bytes_hash) {
    return fail('REFERENCE_MISMATCH', '/evidence_lookup/source_bytes_hash');
  }
  const recordReference = referenceForEvidence(evidence);
  if (!equal(recordReference, lookup.expected_reference)) return fail('REFERENCE_MISMATCH', '/evidence_lookup/record');
  if (evidence.source_scope.kind !== 'per_billable_attempt') return fail('UNSUPPORTED_CASE', '/evidence_lookup/record/source_scope');
  if (evidence.reported_cost.state !== 'known') return fail('UNKNOWN_USAGE', '/evidence_lookup/record/reported_cost');
  if (Date.parse(value.occurred_at) > Date.parse(context.now) ||
      Date.parse(value.observed_at) > Date.parse(context.now) ||
      Date.parse(value.ingested_at) > Date.parse(context.now) ||
      Date.parse(evidence.source_observed_at) > Date.parse(context.now) ||
      Date.parse(lookup.resolved_at) < Date.parse(evidence.source_observed_at)) {
    return fail('INVALID_TRUST_CONTEXT', '/now');
  }
  if (value.observed_at !== evidence.source_observed_at) return fail('REFERENCE_MISMATCH', '/observed_at');

  const association = evidence.source_scope;
  for (const key of ['tenant_id', 'project_id', 'environment', 'billing_mode', 'source_observation_id', 'provider', 'model', 'source']) {
    if (value[key] !== evidence[key]) return fail(key === 'tenant_id' || key === 'project_id' ? 'SCOPE_MISMATCH' : 'REFERENCE_MISMATCH', '/' + key);
  }
  for (const key of ['logical_operation_id', 'provider_attempt_id', 'billable_attempt_id', 'provider_request_id']) {
    if (value[key] !== association[key]) return fail('IDENTITY_COLLISION', '/' + key);
  }
  if (!equal(value.valuation.money, evidence.reported_cost.money)) return fail('OBSERVATION_CONFLICT', '/valuation/money');
  if (value.supersedes_observation_id !== null && !context.prior) return fail('INVALID_TRUST_CONTEXT', '/prior');
  if (context.prior) {
    const relationship = compareReportedUnsettledUsageIdentity(context.prior, value);
    if (!relationship.ok) return relationship;
    if (relationship.value === 'superseded_observation') return fail('STALE_REVISION', '/source_observation_id');
  }
  return parsed;
}
