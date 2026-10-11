import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import pg from 'pg';
import {
  FINANCE_OPERATION_POLICY,
  appendLedgerEvent,
  authorize,
  authorizeFinanceOperation,
  changeBudget,
  estimate,
  estimateV2,
  exportSummary,
  getReconciliation,
  ingestFinancial,
  ingestUsage,
  markDispatched,
  querySummary,
  rebuildLedgerProjection,
  recordExpenseAdjustment,
  registerFxRateV2,
  registerPricingRuleV2,
  registerRateCardV2,
  release,
  safeCsvCell,
  settle,
  startReconciliation,
} from '../../dist/index.js';
import { databaseConfigFromEnvironment } from '../../scripts/test-db-lifecycle.mjs';

const { Pool } = pg;
const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const syntheticAuthorityPath = join(root, 'fixtures/security/authority-cases.json');
const pricingFixturePath = join(root, 'fixtures/pricing/ci03-synthetic-acceptance.json');
const sharedFixtureRoot = join(root, 'node_modules/@jevelopers/shared-contracts/fixtures');
const now = '2026-10-11T03:30:00.000Z';
const scope = {
  tenantId: '123e4567-e89b-42d3-a456-426614174000',
  projectId: '123e4567-e89b-42d3-a456-426614174000',
  environment: 'test', billingMode: 'simulated', actorId: 'ci09-security-actor',
};

function safeScope(value = scope) { return structuredClone(value); }

function allowedDecision(request, options = {}) {
  const principalKind = options.principalKind
    ?? FINANCE_OPERATION_POLICY[request.operation].principalKinds[0];
  const principal = principalKind === 'user'
    ? { kind: 'user', actorId: request.requestedScope.actorId, membershipStatus: 'active', membershipRevision: 'synthetic-membership-1' }
    : { kind: 'service', actorId: request.requestedScope.actorId, serviceStatus: 'active', serviceGrantRevision: 'synthetic-service-grant-1' };
  return {
    status: 'allowed', decisionId: `synthetic-ci09:${request.operation}`,
    operation: request.operation, permission: request.permission, scope: request.requestedScope,
    principal,
    verifiedAt: options.verifiedAt ?? now,
    expiresAt: options.expiresAt ?? '2026-10-11T03:31:00.000Z',
  };
}

function runtimePorts(options = {}) {
  const calls = options.calls ?? [];
  let connects = 0;
  const ports = {
    calls,
    get connects() { return connects; },
    clock: { now: () => new Date(options.clockValue ?? now) },
    storage: { isAvailable: async () => true },
    providerSource: { isAvailable: async () => true },
    trustedContext: { resolve: async requested => requested },
    financeAuthority: options.financeAuthority ?? {
      authorizeCurrent: async request => {
        calls.push(request);
        if (options.deny) return { status: 'denied', operation: request.operation, permission: request.permission };
        return allowedDecision(request, options);
      },
    },
    database: { connect: async () => { connects++; throw new Error('synthetic unavailable database'); } },
  };
  return ports;
}

function versionedRef(contract, id) {
  return { contract, schema_version: '1.0.0', id, revision: 1, content_hash: `sha256:${'a'.repeat(64)}` };
}

function ledgerRequest(targetScope, suffix = randomUUID()) {
  const sourceEventId = `source-${suffix}`;
  const sourceObjectId = `object-${suffix}`;
  const sourceLineId = `line-${suffix}`;
  const logicalOperationId = `logical-${suffix}`;
  const digest = createHash('sha256').update(`ci09:${suffix}`).digest('hex');
  return {
    schemaVersion: '1.0.0', requestId: `request-${suffix}`, idempotencyKey: `idempotency-${suffix}`,
    scope: safeScope(targetScope), eventId: `event-${suffix}`, correlationId: `correlation-${suffix}`,
    producer: { module: 'ci09.synthetic.test', sourceRevision: 'a'.repeat(40), buildRevision: 'security-fixture-1' },
    occurredAt: '2026-10-11T03:00:00.000Z', observedAt: '2026-10-11T03:00:01.000Z',
    evidenceMode: 'mocked', verificationStatus: 'verified', eventType: 'expense', classification: 'direct_cost',
    valuation: 'provider_confirmed', settlementStatus: 'unpaid', reconciliationStatus: 'unmatched', reservationLifecycle: null,
    identities: { logicalOperationId, sourceObservationId: `observation-${suffix}`, reservationId: null },
    postingMapping: {
      schemaVersion: '1.0.0', sourceLineId,
      transportAttemptId: { status: 'known', id: `transport-${suffix}` },
      providerAttemptId: { status: 'known', id: `provider-${suffix}` },
      providerRequestId: { status: 'not_applicable' }, billableAttemptId: { status: 'known', id: `billable-${suffix}` },
    },
    sourceIdentity: {
      source: 'ci09.synthetic', sourceEventId, sourceObjectId, revisionSubjectId: sourceLineId,
      sourceRevision: 'source-revision-1', revisionSequence: 0, contentHash: `sha256:${digest}`,
    },
    usage: { completeness: 'complete', missingFields: [], units: [{ name: 'tokens', quantity: '1', scale: 0, relation: 'standalone' }] },
    money: { amount: '0.37', currency: 'USD', scale: 2 }, sourceRefs: [], dimensions: {}, pricing: null, fxEvidence: null,
    financialEffect: true, reservationAuthorizationEventId: null, supersedesEventId: null, reversesEventId: null,
  };
}

test('operation policy has explicit least-privilege grants, distinct read/action permissions, and no role inheritance', async () => {
  const fixture = JSON.parse(await readFile(syntheticAuthorityPath, 'utf8'));
  assert.equal(fixture.mode, 'synthetic_only');
  assert.equal(fixture.production_trust_root, false);
  const expectedOperations = [
    'metering.ingestUsage', 'pricing.estimate', 'pricing.estimateV2', 'pricing.registerPricingRuleV2',
    'pricing.registerRateCardV2', 'pricing.registerFxRateV2', 'pricing.resolveEvidence', 'budgets.authorize',
    'budgets.markDispatched', 'budgets.settle', 'budgets.release', 'budgets.changeBudget',
    'budgets.recordExpenseAdjustment', 'ledger.ingestFinancial', 'ledger.appendLedgerEvent',
    'ledger.rebuildLedgerProjection', 'ledger.resolveQuarantine', 'ledger.readSnapshot', 'reporting.querySummary',
    'reconciliation.startReconciliation', 'reconciliation.getReconciliation', 'integrations.exportSummary',
  ];
  assert.deepEqual(Object.keys(FINANCE_OPERATION_POLICY).sort(), [...expectedOperations].sort());
  assert.equal(Object.isFrozen(FINANCE_OPERATION_POLICY), true);
  for (const [operation, policy] of Object.entries(FINANCE_OPERATION_POLICY)) {
    assert.equal(Object.isFrozen(policy), true, `${operation} policy is immutable`);
    assert.equal(Object.isFrozen(policy.principalKinds), true, `${operation} principal allowlist is immutable`);
    assert.ok(policy.permission.length > 0, `${operation} has one explicit operation grant`);
    assert.ok(policy.dataClass.length > 0, `${operation} has one explicit output/source classification`);
    assert.ok(policy.principalKinds.length > 0, `${operation} has an explicit principal-kind allowlist`);
    assert.ok(policy.principalKinds.every(kind => kind === 'user' || kind === 'service'));
  }
  assert.equal(FINANCE_OPERATION_POLICY['reporting.querySummary'].permission, 'finance.summary.read');
  assert.equal(FINANCE_OPERATION_POLICY['integrations.exportSummary'].permission, 'finance.summary.export');
  assert.equal(FINANCE_OPERATION_POLICY['budgets.changeBudget'].permission, 'budget.policy.change');
  assert.equal(FINANCE_OPERATION_POLICY['ledger.appendLedgerEvent'].principalKinds.includes('user'), false);
  assert.equal(FINANCE_OPERATION_POLICY['ledger.rebuildLedgerProjection'].principalKinds.includes('user'), false);
  assert.equal(fixture.contexts.application_owner_without_finance.application_role, 'owner');
  assert.deepEqual(fixture.contexts.application_owner_without_finance.permissions, [], 'application owner role conveys no finance grants');

  async function fixtureAuthorization(contextName, operation) {
    const context = fixture.contexts[contextName];
    const fixtureScope = {
      tenantId: context.tenant_id, projectId: context.project_id, environment: context.environment,
      billingMode: context.billing_mode, actorId: context.actor_id,
    };
    const localPermission = FINANCE_OPERATION_POLICY[operation].permission;
    return authorizeFinanceOperation({
      module: 'security', requestOperation: operation, operation, scope: fixtureScope, requestId: `fixture-${contextName}`,
      clock: { now: () => new Date(now) },
      financeAuthority: { authorizeCurrent: async request => {
        const kind = context.principal_kind;
        const active = kind === 'user' ? context.membership_status === 'active' : context.service_status === 'active';
        if (!active || !context.permissions.includes(localPermission)
            || !FINANCE_OPERATION_POLICY[request.operation].principalKinds.includes(kind)
            || JSON.stringify(request.requestedScope) !== JSON.stringify(fixtureScope)) {
          return { status: 'denied', operation: request.operation, permission: request.permission };
        }
        const principal = kind === 'user'
          ? { kind, actorId: context.actor_id, membershipStatus: context.membership_status, membershipRevision: context.membership_revision }
          : { kind, actorId: context.actor_id, serviceStatus: context.service_status, serviceGrantRevision: context.service_grant_revision };
        return {
          status: 'allowed', decisionId: `fixture:${contextName}:${operation}`, operation: request.operation,
          permission: request.permission, scope: fixtureScope, principal, verifiedAt: now, expiresAt: '2026-10-11T03:31:00.000Z',
        };
      } },
    });
  }
  assert.equal((await fixtureAuthorization('finance_reader_a', 'reporting.querySummary')).ok, true);
  assert.equal((await fixtureAuthorization('finance_reader_a', 'budgets.changeBudget')).ok, false, 'summary readers do not inherit budget authority');
  assert.equal((await fixtureAuthorization('finance_reader_a', 'ledger.appendLedgerEvent')).ok, false, 'user readers cannot use service-only ledger grants');
  assert.equal((await fixtureAuthorization('ledger_service_a', 'ledger.appendLedgerEvent')).ok, true);
  assert.equal((await fixtureAuthorization('application_owner_without_finance', 'reporting.querySummary')).ok, false);
  assert.equal((await fixtureAuthorization('revoked_finance_reader', 'reporting.querySummary')).ok, false);

  const calls = [];
  for (const operation of expectedOperations) {
    const targetScope = safeScope({ ...scope, actorId: `actor-${operation}` });
    const auth = await authorizeFinanceOperation({
      module: 'security', requestOperation: operation, operation, scope: targetScope,
      requestId: `policy-${operation}`, clock: { now: () => new Date(now) },
      financeAuthority: { authorizeCurrent: async request => { calls.push(request); return allowedDecision(request); } },
    });
    assert.equal(auth.ok, true, `${operation} accepts only its exact synthetic local grant`);
  }
  assert.equal(calls.length, expectedOperations.length);
  for (let index = 0; index < calls.length; index++) {
    const operation = expectedOperations[index];
    assert.equal(calls[index].operation, operation);
    assert.equal(calls[index].permission, FINANCE_OPERATION_POLICY[operation].permission);
  }

  const sampleRequest = {
    module: 'security', requestOperation: 'appendLedgerEvent', operation: 'ledger.appendLedgerEvent',
    scope, requestId: 'ci09-denial-cases', clock: { now: () => new Date(now) },
  };
  const goodDecision = allowedDecision({
    requestedScope: scope, operation: 'ledger.appendLedgerEvent', permission: FINANCE_OPERATION_POLICY['ledger.appendLedgerEvent'].permission,
  }, { principalKind: 'service' });
  const invalidDecisions = [
    { ...goodDecision, operation: 'ledger.readSnapshot' },
    { ...goodDecision, permission: 'ledger.snapshot.read' },
    { ...goodDecision, scope: { ...scope, tenantId: 'foreign-tenant' } },
    { ...goodDecision, principal: { ...goodDecision.principal, actorId: 'foreign-actor' } },
    { ...goodDecision, principal: { kind: 'user', actorId: scope.actorId, membershipStatus: 'active', membershipRevision: 'm-1' } },
    { ...goodDecision, principal: { ...goodDecision.principal, serviceStatus: 'revoked' } },
    { ...goodDecision, principal: { ...goodDecision.principal, serviceGrantRevision: '' } },
    { ...goodDecision, verifiedAt: '2026-10-11T03:28:59.000Z' },
    { ...goodDecision, expiresAt: now },
    { ...goodDecision, expiresAt: '2026-10-11T03:40:00.000Z' },
  ];
  for (const decision of invalidDecisions) {
    const denied = await authorizeFinanceOperation({
      ...sampleRequest, financeAuthority: { authorizeCurrent: async () => decision },
    });
    assert.equal(denied.ok, false);
    if (!denied.ok) assert.equal(denied.error.code, 'FORBIDDEN_SCOPE');
  }
  for (const financeAuthority of [undefined, { authorizeCurrent: async () => null }, { authorizeCurrent: async () => { throw new Error('private authority detail'); } }]) {
    const unavailable = await authorizeFinanceOperation({ ...sampleRequest, financeAuthority });
    assert.equal(unavailable.ok, false);
    if (!unavailable.ok) {
      assert.equal(unavailable.error.code, 'SOURCE_UNAVAILABLE');
      assert.equal(unavailable.error.safe_message.includes('private authority detail'), false);
    }
  }
  let unknownOperationLookups = 0;
  const unknownOperation = await authorizeFinanceOperation({
    ...sampleRequest, operation: 'toString',
    financeAuthority: { authorizeCurrent: async () => { unknownOperationLookups++; return goodDecision; } },
  });
  assert.equal(unknownOperation.ok, false, 'unknown JavaScript operation values fail closed without an exception');
  if (!unknownOperation.ok) assert.equal(unknownOperation.error.code, 'FORBIDDEN_SCOPE');
  assert.equal(unknownOperationLookups, 0);

  let futurePricingCompatibilityLookups = 0;
  const futurePricingOperation = await authorizeFinanceOperation({
    ...sampleRequest, operation: 'pricing.resolveEvidence',
    pricingCompatibility: async () => { futurePricingCompatibilityLookups++; return null; },
  });
  assert.equal(futurePricingOperation.ok, false, 'legacy pricing compatibility cannot grant a future evidence operation');
  if (!futurePricingOperation.ok) assert.equal(futurePricingOperation.error.code, 'SOURCE_UNAVAILABLE');
  assert.equal(futurePricingCompatibilityLookups, 0);
});

test('all exposed APIs request their operation grant before domain access', async () => {
  const pricing = JSON.parse(await readFile(pricingFixturePath, 'utf8'));
  const usage = JSON.parse(await readFile(join(sharedFixtureRoot, 'UsageEvent.json'), 'utf8')).valid;
  const reserve = JSON.parse(await readFile(join(sharedFixtureRoot, 'ReserveRequest.json'), 'utf8')).valid;
  const settleCanonical = JSON.parse(await readFile(join(sharedFixtureRoot, 'SettleRequest.json'), 'utf8')).valid;
  const releaseCanonical = JSON.parse(await readFile(join(sharedFixtureRoot, 'ReleaseRequest.json'), 'utf8')).valid;
  const summary = JSON.parse(await readFile(join(sharedFixtureRoot, 'FinancialSummary.json'), 'utf8')).valid;
  for (const field of ['tenant_id', 'project_id']) summary[field] = scope[field === 'tenant_id' ? 'tenantId' : 'projectId'];
  summary.environment = scope.environment;
  summary.billing_mode = scope.billingMode;
  const event = structuredClone(usage);
  event.tenant_id = scope.tenantId;
  event.project_id = scope.projectId;
  event.environment = scope.environment;
  event.billing_mode = scope.billingMode;
  event.provider = 'synthetic_provider';
  event.model = 'synthetic_model';
  const v1Estimate = {
    schemaVersion: '1.0.0', requestId: 'security-estimate-v1', idempotencyKey: 'security-estimate-v1-idem',
    scope: safeScope(), usageEvent: event,
    selection: { policy: 'event_time', effectiveAt: event.occurred_at, requestedCurrency: 'USD', rateCardRef: null },
  };
  const v2Estimate = {
    ...v1Estimate, schemaVersion: '2.0.0', requestId: 'security-estimate-v2', idempotencyKey: 'security-estimate-v2-idem',
    selection: {
      policy: 'event_time', effectiveAt: event.occurred_at, product: 'responses', requestedCurrency: 'USD',
      rateCardRef: null, fxRateRef: null, contractTimeEvidenceRef: null, contextTier: null, serviceTier: null,
      reasoningMode: null, toolClass: null, dimensionsEvidenceRef: null,
    },
  };
  const ruleReference = { contract: 'PricingRule', schema_version: '2.0.0', id: pricing.pricing_rule.id, revision: 1, content_hash: `sha256:${'b'.repeat(64)}` };
  const rateCard = { ...structuredClone(pricing.rate_card), pricingRuleRef: ruleReference };
  const common = { schemaVersion: '1.0.0', scope: safeScope() };
  const fixtureRef = versionedRef('SecurityFixture', 'ci09-fixture');
  const reservationId = settleCanonical.reservation_id;
  const attemptBinding = {
    logicalOperationId: reserve.logical_operation_id,
    transportAttemptId: 'ci09-transport', providerRequestId: null,
    providerAttemptId: reserve.billable_attempt_id, billableAttemptId: reserve.billable_attempt_id,
  };
  const budgetAuthorize = {
    ...common, schemaVersion: '1.0.0', requestId: 'security-budget-authorize', idempotencyKey: 'security-budget-authorize-idem',
    canonicalRequest: { ...reserve, tenant_id: scope.tenantId, project_id: scope.projectId },
    estimate: { completeness: 'complete', knownSubtotal: '0.37', currency: 'USD', rateCardRef: null, missingDimensions: [] },
    allowPartialAuthorization: false, attemptBinding,
  };
  const lifecycleBase = {
    ...common, requestId: 'security-lifecycle', idempotencyKey: 'security-lifecycle-idem', reservationId,
    expectedRevision: 1, actorReference: 'ci09-actor-reference', sourceAuthorityRef: fixtureRef, attemptBinding,
  };
  const settleRequest = {
    ...lifecycleBase, action: 'settle', canonicalCommand: { ...settleCanonical, tenant_id: scope.tenantId, project_id: scope.projectId },
    settlement: {
      measure: 'cumulative', finality: 'partial', sequence: 1, cumulativeAmount: '0.2', currency: 'USD',
      usageCompleteness: 'complete', sourceObservationRefs: [fixtureRef], allowObservedOverrun: true,
    },
  };
  const releaseRequest = {
    ...lifecycleBase, action: 'release', canonicalCommand: { ...releaseCanonical, tenant_id: scope.tenantId, project_id: scope.projectId },
    release: { amount: '0.1', currency: 'USD', reason: 'unused-test-hold', proof: 'never_dispatched_fenced', evidenceRefs: [fixtureRef] },
  };
  const dispatchedRequest = {
    ...lifecycleBase, action: 'mark_dispatched', workerLeaseId: 'ci09-worker-lease',
    workerLeaseExpiresAt: '2026-10-11T03:31:00.000Z', dispatchIntentRef: fixtureRef,
  };
  const budgetChange = {
    ...common, requestId: 'security-budget-change', idempotencyKey: 'security-budget-change-idem',
    newLimit: '10.00', currency: 'USD', expectedPolicyRevision: 1, expectedLedgerRevision: 0,
    actorReference: 'ci09-actor-reference', reasonReference: 'ci09-security-fixture',
  };
  const expenseAdjustment = {
    ...common, requestId: 'security-expense-adjustment', idempotencyKey: 'security-expense-adjustment-idem',
    adjustmentId: 'ci09-adjustment', amount: '0.01', currency: 'USD', direction: 'increase_expense',
    expectedLedgerRevision: 0, actorReference: 'ci09-actor-reference', reasonReference: 'ci09-security-fixture',
    originalPostingRef: fixtureRef, sourceReference: 'ci09-safe-reference', sourceContentHash: fixtureRef.content_hash, evidenceMode: 'mocked',
  };
  const financialEvent = {
    schemaVersion: '1.0.0', requestId: 'security-financial-ingest', idempotencyKey: 'security-financial-ingest-idem',
    eventId: 'ci09-financial-event', scope: safeScope(),
    sourceIdentity: { source: 'ci09.synthetic', sourceEventId: 'ci09-source-event', sourceRevision: 'source-1', contentHash: fixtureRef.content_hash },
    correlationId: 'ci09-correlation', occurredAt: now, observedAt: now, ingestedAt: now,
    evidenceMode: 'mocked', verificationStatus: 'verified', classification: 'expense', currency: 'USD', scale: 2,
    settlement: 'unpaid', reconciliation: 'unmatched', sourceRefs: [], dimensions: {}, amount: '0.37', valuation: 'estimated',
  };
  const query = {
    ...common, requestId: 'security-summary', idempotencyKey: 'security-summary-idem',
    period: { start: '2026-10-10T00:00:00Z', end: '2026-10-11T00:00:00Z' }, timezone: 'UTC', pageSize: 10,
    filters: { environments: ['test'], billingModes: ['simulated'] },
  };
  const reconcile = {
    ...common, requestId: 'security-reconciliation', idempotencyKey: 'security-reconciliation-idem',
    sourceSnapshots: [{ name: 'synthetic-source', revision: '1', contentHash: fixtureRef.content_hash, evidenceMode: 'mocked', verificationStatus: 'verified' }],
    windowStart: '2026-10-10T00:00:00Z', windowEnd: '2026-10-11T00:00:00Z', pageSize: 10, requestedBy: 'ci09-security-test',
  };
  const summaryContentHash = `sha256:${'c'.repeat(64)}`;
  const snapshot = {
    schemaVersion: '1.0.0', requestId: 'security-summary-snapshot', snapshotId: 'ci09-summary-snapshot',
    queryContentHash: summaryContentHash, asOf: now, timezone: 'UTC',
    watermark: { watermarkId: 'ci09-watermark', capturedAt: now, sources: [
      { source: 'synthetic-source', revision: '1', observedThrough: now, contentHash: fixtureRef.content_hash, completeness: 'complete' },
    ] },
    filters: { environments: ['test'], billingModes: ['simulated'] }, summaryContentHash,
    summary, hasMore: false, nextCursor: null,
  };
  const exportRequest = {
    ...common, requestId: 'security-export', idempotencyKey: 'security-export-idem', summarySnapshot: snapshot,
    summaryContentHash, destination: 'cfo.ai', format: 'csv', requestedAt: now, evidenceMode: 'mocked', requestedBy: 'ci09-security-test',
  };

  const routes = [
    ['pricing.estimate', () => estimate(v1Estimate, runtimePortsForRoute())],
    ['pricing.estimateV2', () => estimateV2(v2Estimate, runtimePortsForRoute())],
    ['pricing.registerPricingRuleV2', () => registerPricingRuleV2({ ...common, schemaVersion: '2.0.0', requestId: 'security-rule', idempotencyKey: 'security-rule-idem', rule: pricing.pricing_rule }, runtimePortsForRoute())],
    ['pricing.registerRateCardV2', () => registerRateCardV2({ ...common, schemaVersion: '2.0.0', requestId: 'security-card', idempotencyKey: 'security-card-idem', rateCard }, runtimePortsForRoute())],
    ['pricing.registerFxRateV2', () => registerFxRateV2({ ...common, schemaVersion: '2.0.0', requestId: 'security-fx', idempotencyKey: 'security-fx-idem', fxRate: pricing.fx_rate }, runtimePortsForRoute())],
    ['metering.ingestUsage', () => ingestUsage({ ...common, requestId: 'security-usage', idempotencyKey: 'security-usage-idem', usageEvent: event, evidenceMode: 'mocked', verificationStatus: 'verified', evidenceProvenanceRef: 'ci09-synthetic' }, runtimePortsForRoute())],
    ['budgets.authorize', () => authorize(budgetAuthorize, runtimePortsForRoute())],
    ['budgets.markDispatched', () => markDispatched(dispatchedRequest, runtimePortsForRoute())],
    ['budgets.settle', () => settle(settleRequest, runtimePortsForRoute())],
    ['budgets.release', () => release(releaseRequest, runtimePortsForRoute())],
    ['budgets.changeBudget', () => changeBudget(budgetChange, runtimePortsForRoute())],
    ['budgets.recordExpenseAdjustment', () => recordExpenseAdjustment(expenseAdjustment, runtimePortsForRoute())],
    ['ledger.ingestFinancial', () => ingestFinancial(financialEvent, runtimePortsForRoute())],
    ['ledger.appendLedgerEvent', () => appendLedgerEvent(ledgerRequest(scope, 'route-append'), runtimePortsForRoute())],
    ['ledger.rebuildLedgerProjection', () => rebuildLedgerProjection({ schemaVersion: '1.0.0', requestId: 'security-projection', scope: safeScope(), asOf: now }, runtimePortsForRoute())],
    ['reporting.querySummary', () => querySummary(query, runtimePortsForRoute())],
    ['reconciliation.startReconciliation', () => startReconciliation(reconcile, runtimePortsForRoute())],
    ['reconciliation.getReconciliation', () => getReconciliation(reconcile, runtimePortsForRoute())],
    ['integrations.exportSummary', () => exportSummary(exportRequest, runtimePortsForRoute())],
  ];
  function runtimePortsForRoute() { return runtimePorts({ calls: currentCalls }); }
  let currentCalls = [];
  for (const [operation, invoke] of routes) {
    currentCalls = [];
    const result = await invoke();
    assert.ok(currentCalls.length > 0, `${operation} must invoke the current authority; result=${JSON.stringify(result)}`);
    assert.ok(currentCalls.every(call => call.operation === operation), `${operation} must not reuse another operation's permission`);
    assert.ok(currentCalls.every(call => call.permission === FINANCE_OPERATION_POLICY[operation].permission), `${operation} must ask for its exact permission`);
    if (!result.ok) {
      assert.notEqual(result.error.code, 'VALIDATION_ERROR', `${operation} route fixture reaches authorization`);
      assert.ok(result.error.safe_message.length <= 240);
    }
  }
  assert.equal(Object.keys(FINANCE_OPERATION_POLICY).length - 3, routes.length,
    'every currently exposed API is covered; the three explicit future operations have no handler yet');

  const privateMarker = 'CI09_PRIVATE_AUTH_CANARY';
  const deniedCalls = [];
  const deniedPorts = runtimePorts({
    calls: deniedCalls, deny: true,
  });
  const deniedBudgetChange = { ...budgetChange, reasonReference: privateMarker };
  const denied = await changeBudget(deniedBudgetChange, deniedPorts);
  assert.equal(denied.ok, false);
  if (!denied.ok) {
    assert.equal(denied.error.code, 'FORBIDDEN_SCOPE');
    assert.equal(JSON.stringify(denied.error).includes(privateMarker), false);
  }
  assert.equal(deniedPorts.connects, 0, 'denied financial action never reaches persistence');
  assert.equal(safeCsvCell(`=${privateMarker}`).includes(privateMarker), true, 'CSV quoting preserves data after formula neutralization');
});

test('PostgreSQL ledger reads and writes recheck current grants and preserve tenant isolation', async () => {
  assert.ok(process.env.CI_TEST_DB_HOST, 'security suite requires its disposable PostgreSQL harness');
  const pool = new Pool({ ...databaseConfigFromEnvironment('CI_TEST_DB'), max: 8 });
  const clock = { now: () => new Date(now) };
  const tenantA = safeScope({ ...scope, tenantId: `ci09-tenant-a-${randomUUID()}`, projectId: `ci09-project-a-${randomUUID()}`, actorId: 'ci09-ledger-service-a' });
  const tenantB = safeScope({ ...scope, tenantId: `ci09-tenant-b-${randomUUID()}`, projectId: `ci09-project-b-${randomUUID()}`, actorId: 'ci09-ledger-service-b' });
  let active = true;
  let calls = 0;
  let connects = 0;
  const portsFor = expectedScope => ({
    database: { connect: async () => { connects++; return pool.connect(); } },
    trustedContext: { resolve: async requested => requested },
    clock,
    financeAuthority: { authorizeCurrent: async request => {
      calls++;
      if (!active || JSON.stringify(request.requestedScope) !== JSON.stringify(expectedScope)) {
        return { status: 'denied', decisionId: 'synthetic-revoked-or-foreign', operation: request.operation, permission: request.permission };
      }
      return allowedDecision(request, { principalKind: 'service' });
    } },
  });
  try {
    const portsA = portsFor(tenantA);
    const event = ledgerRequest(tenantA, `security-${randomUUID()}`);
    const append = await appendLedgerEvent(event, portsA);
    assert.equal(append.ok, true, append.ok ? '' : append.error.code);
    if (append.ok) assert.equal(append.value.status, 'accepted');
    assert.ok(connects > 0);

    const projectionRequest = { schemaVersion: '1.0.0', requestId: 'ci09-projection-a', scope: tenantA, asOf: '2026-10-11T03:30:00.000Z' };
    const projectionA = await rebuildLedgerProjection(projectionRequest, portsA);
    assert.equal(projectionA.ok, true, projectionA.ok ? '' : projectionA.error.code);
    if (projectionA.ok) {
      assert.equal(projectionA.value.scope.tenantId, tenantA.tenantId);
      assert.equal(projectionA.value.eventCount, 1);
      assert.equal(projectionA.value.amounts[0]?.knownSubtotal, '0.37');
    }

    const foreignBefore = connects;
    const foreignAppend = await appendLedgerEvent(ledgerRequest(tenantB, `foreign-${randomUUID()}`), portsA);
    assert.equal(foreignAppend.ok, false);
    if (!foreignAppend.ok) assert.equal(foreignAppend.error.code, 'FORBIDDEN_SCOPE');
    const foreignRead = await rebuildLedgerProjection({ ...projectionRequest, requestId: 'ci09-projection-foreign', scope: tenantB }, portsA);
    assert.equal(foreignRead.ok, false);
    if (!foreignRead.ok) assert.equal(foreignRead.error.code, 'FORBIDDEN_SCOPE');
    assert.equal(connects, foreignBefore, 'foreign tenant identifiers deny before any row lookup or mutation');

    const portsB = portsFor(tenantB);
    const projectionB = await rebuildLedgerProjection({ ...projectionRequest, requestId: 'ci09-projection-b', scope: tenantB }, portsB);
    assert.equal(projectionB.ok, true, projectionB.ok ? '' : projectionB.error.code);
    if (projectionB.ok) {
      assert.equal(projectionB.value.scope.tenantId, tenantB.tenantId);
      assert.equal(projectionB.value.eventCount, 0, 'tenant B sees no rows from tenant A');
      assert.deepEqual(projectionB.value.amounts, []);
    }

    active = false;
    const beforeRevokedRetry = connects;
    const revokedDuplicate = await appendLedgerEvent(event, portsA);
    assert.equal(revokedDuplicate.ok, false);
    if (!revokedDuplicate.ok) assert.equal(revokedDuplicate.error.code, 'FORBIDDEN_SCOPE');
    const revokedRead = await rebuildLedgerProjection({ ...projectionRequest, requestId: 'ci09-projection-revoked' }, portsA);
    assert.equal(revokedRead.ok, false);
    if (!revokedRead.ok) assert.equal(revokedRead.error.code, 'FORBIDDEN_SCOPE');
    const unsupported = { ...event, schemaVersion: '9.9.9', requestId: 'ci09-revoked-quarantine' };
    const revokedQuarantine = await appendLedgerEvent(unsupported, portsA);
    assert.equal(revokedQuarantine.ok, false);
    if (!revokedQuarantine.ok) assert.equal(revokedQuarantine.error.code, 'FORBIDDEN_SCOPE');
    assert.equal(connects, beforeRevokedRetry, 'revocation blocks duplicate/retry, read, and quarantine paths before database access');
    assert.ok(calls >= 8, 'every API attempt obtained a fresh current decision');
  } finally {
    await pool.end().catch(() => {});
  }
});
