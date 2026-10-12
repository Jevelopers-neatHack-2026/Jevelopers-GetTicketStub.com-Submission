// Synthetic metadata shared by model and actual-PostgreSQL reader regressions.
import { createHash, randomUUID } from 'node:crypto';

export const now = '2026-10-12T16:00:00.000Z';
export const scope = (overrides = {}) => ({ tenantId: 'ci10-tenant', projectId: 'ci10-project',
  environment: 'test', billingMode: 'simulated', actorId: 'ci10-actor', ...overrides });
export const uniqueScope = () => scope({ tenantId: `ci10-${randomUUID()}`, projectId: `ci10-${randomUUID()}` });
export const partition = s => [s.tenantId, s.projectId, s.environment, s.billingMode];
export const hash = text => 'sha256:' + createHash('sha256').update(text).digest('hex');
export const postingRequest = (s = scope(), eventId = 'evt-posting') => ({ schemaVersion: '1.0.0', requestId: 'ci10-read', scope: s, eventId });
export const reverseRequest = (kind = 'logical_operation', id = 'operation-1', namespace = 'cost-intelligence', s = scope()) => ({
  schemaVersion: '1.0.0', requestId: 'ci10-reverse', scope: s, reference: { status: 'resolved', kind, namespace, id },
});
export const decision = (input, revision = 'ci10-synthetic-grant-1', kind = 'service') => ({
  status: 'allowed', decisionId: 'ci10-synthetic-decision', operation: input.operation, permission: input.permission,
  scope: { ...input.requestedScope }, principal: kind === 'service'
    ? { kind, actorId: input.requestedScope.actorId, serviceStatus: 'active', serviceGrantRevision: revision }
    : { kind, actorId: input.requestedScope.actorId, membershipStatus: 'active', membershipRevision: revision },
  verifiedAt: now, expiresAt: '2026-10-12T16:01:00.000Z',
});
export const hostAuthority = (state = {}) => ({ async authorizeCurrent(input) {
  state.authorizations = (state.authorizations ?? 0) + 1;
  if (state.denied) return { status: 'denied', operation: input.operation, permission: input.permission };
  return decision(input, state.revision ?? 'ci10-synthetic-grant-1');
} });

export function row(s = scope(), overrides = {}) {
  return {
    tenant_id: s.tenantId, project_id: s.projectId, environment: s.environment, billing_mode: s.billingMode,
    event_id: 'evt-posting', event_type: 'expense', classification: 'direct_cost', financial_effect: true,
    correlation_id: 'correlation-1', logical_operation_id: 'operation-1', source_observation_id: 'observation-posting', reservation_id: null,
    transport_attempt_id: 'transport-1', transport_attempt_status: 'known', provider_attempt_id: null, provider_attempt_status: 'unknown',
    provider_request_id: 'request-1', provider_request_status: 'known', billable_attempt_id: 'billable-1', billable_attempt_status: 'known',
    provider: 'OpenAI', provider_type: 'string', workflow_id: 'workflow-1', workflow_type: 'string', job_id: 'job-1', job_type: 'string',
    pricing_type: 'object', policy_version: 'policy-1', policy_version_type: 'string', rule_version: 'rule-1', rule_version_type: 'string',
    rate_card_type: 'object', rate_card_contract: 'RateCard', rate_card_contract_type: 'string',
    rate_card_id: 'rate-1', rate_card_id_type: 'string', rate_card_revision: '0', rate_card_revision_type: 'number',
    rate_card_hash: hash('ci10-synthetic-rate'), rate_card_hash_type: 'string',
    supersedes_event_id: null, reverses_event_id: null,
    ...overrides,
  };
}

export function ledgerRequest(s, overrides = {}) {
  const id = overrides.eventId ?? `event-${randomUUID()}`;
  const operation = overrides.logicalOperationId ?? `operation-${randomUUID()}`;
  const subject = `line-${id}`;
  const observation = overrides.eventType === 'usage_observation';
  const request = {
    schemaVersion: '1.0.0', requestId: `request-${id}`, idempotencyKey: `idempotency-${id}`, scope: s,
    eventId: id, correlationId: `correlation-${operation}`,
    producer: { module: 'ci10.synthetic.test', sourceRevision: 'a'.repeat(40), buildRevision: 'ci10-fixture-1' },
    occurredAt: '2026-10-12T15:00:00.000Z', observedAt: '2026-10-12T15:00:01.000Z',
    evidenceMode: 'mocked', verificationStatus: 'verified',
    eventType: observation ? 'usage_observation' : 'expense', classification: observation ? 'usage_memo' : 'direct_cost',
    valuation: observation ? 'unknown' : 'estimated', settlementStatus: 'unpaid', reconciliationStatus: 'unmatched',
    reservationLifecycle: null, reservationAuthorizationEventId: null,
    identities: { logicalOperationId: operation, sourceObservationId: `observation-${id}`, reservationId: null },
    postingMapping: { schemaVersion: '1.0.0', sourceLineId: subject,
      transportAttemptId: { status: 'known', id: `transport-${id}` },
      providerAttemptId: { status: 'known', id: `provider-attempt-${id}` }, providerRequestId: { status: 'known', id: `provider-request-${id}` },
      billableAttemptId: { status: 'known', id: `billable-${id}` } },
    sourceIdentity: { source: 'ci10-synthetic', sourceEventId: `source-${id}`, sourceObjectId: `source-object-${id}`,
      revisionSubjectId: subject, sourceRevision: 'fixture-1', revisionSequence: 0, contentHash: hash(`ci10-source-${id}`) },
    usage: { completeness: 'complete', missingFields: [], units: [{ name: 'tokens', quantity: '1', scale: 0, relation: 'standalone' }] },
    money: { amount: observation ? null : '0.01', currency: 'USD', scale: 2 },
    sourceRefs: [], dimensions: { provider: 'OpenAI', workflowId: `workflow-${operation}`, jobId: `job-${operation}` },
    pricing: observation ? null : { policyVersion: 'policy-1', ruleVersion: 'rule-1', rateCardRef: {
      contract: 'RateCard', schema_version: '1.0.0', id: 'ci10-rate', revision: 0, content_hash: hash('ci10-synthetic-rate'),
    } }, fxEvidence: null, financialEffect: !observation, supersedesEventId: null, reversesEventId: null,
  };
  const { logicalOperationId: _, ...rest } = overrides;
  return { ...request, ...rest };
}

export const clock = { now: () => new Date(now) };
export const ledgerPorts = (database, s) => ({ database, clock, trustedContext: { resolve: async () => ({ ...s }) }, financeAuthority: hostAuthority() });
export const readerPorts = (database, state = {}) => ({ database, clock, financeAuthority: hostAuthority(state) });

export async function checked(promise) {
  const result = await promise;
  if (!result.ok) throw new Error(`Expected synthetic success, got ${result.error.code}: ${result.error.safe_message}`);
  return result.value;
}
export async function refused(promise, code = 'SOURCE_UNAVAILABLE') {
  const result = await promise;
  if (result.ok || result.error.code !== code || Object.hasOwn(result, 'value')) throw new Error(`Expected ${code} with no value`);
  return result;
}
