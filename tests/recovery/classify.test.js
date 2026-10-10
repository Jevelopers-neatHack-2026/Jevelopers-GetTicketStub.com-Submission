import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  advanceBudget,
  createBudgetSnapshot,
  createLimitSet,
  serializeLimitSet
} from '../../src/orchestrator/internal/limits.js';
import {
  compilePlan,
  executeLocalStep
} from '../../src/orchestrator/internal/plan.js';
import {
  classifyRecovery,
  PRIVATE_CHECKPOINT_KIND
} from '../../src/recovery/internal/classify.js';

const PLAN_KIND = 'agent-harness.private-synthetic-plan';
const WORKFLOW_ID = 'wf-private-test-01';

function makePlanJson() {
  return JSON.stringify({
    kind: PLAN_KIND,
    version: 1,
    steps: [
      {
        id: 'second',
        operation: 'number.add',
        dependsOn: ['first'],
        args: { left: { $result: 'first' }, right: 2 }
      },
      {
        id: 'first',
        operation: 'number.add',
        dependsOn: [],
        args: { left: 1, right: 2 }
      }
    ]
  });
}

function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

function privateData({
  workflowId = WORKFLOW_ID,
  planJson = makePlanJson(),
  limitSet = createLimitSet(),
  budget,
  completedResultsJson = '{}',
  pendingStepId = null,
  version = 2,
  lastAdmissionKind = 'step',
  lastAdmissionStepId,
  kind = PRIVATE_CHECKPOINT_KIND,
  limitsJson,
  limitsHash,
  planHash,
  registryVersion,
  runIdentity
} = {}) {
  const plan = compilePlan(planJson, limitSet, undefined, workflowId);
  let inferredLastStep = lastAdmissionStepId;
  if (inferredLastStep === undefined) {
    if (pendingStepId !== null) inferredLastStep = pendingStepId;
    else {
      const resultIds = Object.keys(JSON.parse(completedResultsJson));
      inferredLastStep = resultIds.at(-1) ?? null;
    }
  }
  return {
    kind,
    version,
    workflowId,
    planJson,
    planHash: planHash ?? plan.planHash,
    registryVersion: registryVersion ?? plan.registryVersion,
    runIdentity: runIdentity ?? plan.runIdentity,
    limitsJson: limitsJson ?? serializeLimitSet(limitSet),
    limitsHash: limitsHash ?? limitSet.hash,
    budget: budget ?? createBudgetSnapshot(limitSet, 1_000, 31_000),
    completedResultsJson,
    pendingStepId,
    lastAdmissionKind,
    lastAdmissionStepId: inferredLastStep,
    baseCheckpointData: {}
  };
}

function recoverySnapshot({
  data = privateData(),
  workflowId = WORKFLOW_ID,
  state = 'running',
  revision = 4,
  checkpointSequence = 2,
  before = {},
  after = {},
  checkpointSequenceOverride,
  schemaVersion = 2,
  sha256,
  checkpoint = true,
  attemptStates = [],
  observedAtMs = 1_000
} = {}) {
  const beforeWorkflow = {
    workflowId,
    state,
    revision,
    checkpointSequence,
    cancellationRequested: false,
    ...before
  };
  const afterWorkflow = {
    ...beforeWorkflow,
    ...after
  };
  const checkpointRecord = checkpoint
    ? {
      sequence: checkpointSequenceOverride ?? afterWorkflow.checkpointSequence,
      schemaVersion,
      data,
      sha256: sha256 ?? createHash('sha256')
        .update('{"schemaVersion":2,"data":' + canonical(data), 'utf8')
        .update('}', 'utf8')
        .digest('hex')
    }
    : null;
  return JSON.stringify({
    before: beforeWorkflow,
    after: afterWorkflow,
    checkpoint: checkpointRecord,
    externalAttemptStates: attemptStates,
    observedAtMs
  });
}

function checkpointWithData(data, overrides = {}) {
  return recoverySnapshot({ data, ...overrides });
}

function readyRunIdentity(workflowId = WORKFLOW_ID) {
  const plan = compilePlan(makePlanJson(), undefined, undefined, workflowId);
  return plan;
}

test('recovery classifies pending pure local work as a candidate without executing it', () => {
  const limits = createLimitSet();
  let budget = createBudgetSnapshot(limits, 1_000, 31_000);
  budget = advanceBudget(budget, 'step', 1_000, 0, limits).state;
  const data = privateData({
    limitSet: limits,
    budget,
    pendingStepId: 'first'
  });
  const result = classifyRecovery(checkpointWithData(data, { observedAtMs: 1_001 }));

  assert.deepEqual(result, {
    kind: 'local-replay-candidate',
    reason: 'PURE_LOCAL_REPLAY_WITH_NEW_ALLOWANCE_REQUIRED',
    actionable: false
  });
});

test('recovery reports ready work and committed results as evidence without promoting them', () => {
  const plan = readyRunIdentity();
  const ready = classifyRecovery(checkpointWithData(privateData()));
  assert.equal(ready.kind, 'local-ready-candidate');
  assert.equal(ready.actionable, false);

  const first = executeLocalStep(plan, 'first');
  const resultsAfterFirst = JSON.stringify({ first });
  const second = executeLocalStep(plan, 'second', resultsAfterFirst);
  let budget = createBudgetSnapshot(createLimitSet(), 1_000, 31_000);
  budget = advanceBudget(budget, 'step', 1_000, 0).state;
  budget = advanceBudget(budget, 'step', 1_000, 0).state;
  const complete = classifyRecovery(checkpointWithData(privateData({
    budget,
    completedResultsJson: JSON.stringify({ first, second })
  })));
  assert.deepEqual(complete, {
    kind: 'durable-evidence-present',
    reason: 'ALL_LOCAL_RESULTS_MATCH_PINNED_IDENTITIES',
    actionable: false
  });
});

test('an unresolved external effect is a barrier even when the checkpoint is absent', () => {
  for (const state of ['intent', 'outcome_unknown', 'response_received']) {
    const result = classifyRecovery(recoverySnapshot({
      checkpoint: false,
      attemptStates: [state]
    }));
    assert.equal(result.kind, 'external-reconciliation-required');
    assert.equal(result.reason, 'EXTERNAL_OUTCOME_UNRESOLVED');
    assert.equal(result.actionable, false);
  }
  assert.equal(classifyRecovery(recoverySnapshot({
    state: 'reconciliation_pending',
    checkpoint: false
  })).kind, 'external-reconciliation-required');
  assert.equal(classifyRecovery(recoverySnapshot({
    state: 'awaiting_response',
    checkpoint: false
  })).kind, 'external-reconciliation-required');
});

test('missing, old, future, corrupt, and foreign checkpoints stop without adoption', () => {
  assert.equal(classifyRecovery(recoverySnapshot({ checkpoint: false })).reason, 'CHECKPOINT_MISSING');
  assert.equal(classifyRecovery(recoverySnapshot({ schemaVersion: 1 })).reason, 'CHECKPOINT_UNSUPPORTED');
  assert.equal(classifyRecovery(recoverySnapshot({ schemaVersion: 3 })).reason, 'CHECKPOINT_UNSUPPORTED');

  const corrupt = recoverySnapshot({ sha256: '0'.repeat(64) });
  assert.equal(classifyRecovery(corrupt).reason, 'CHECKPOINT_CORRUPT');

  const foreign = privateData({ kind: 'generic-workflow-checkpoint' });
  assert.equal(classifyRecovery(checkpointWithData(foreign)).reason, 'CHECKPOINT_FOREIGN');

  const unsupported = privateData({ version: 3 });
  assert.equal(classifyRecovery(checkpointWithData(unsupported)).reason, 'CHECKPOINT_UNSUPPORTED');
  const oldPrivate = privateData({ version: 1 });
  assert.equal(classifyRecovery(checkpointWithData(oldPrivate)).reason, 'CHECKPOINT_UNSUPPORTED');

  const differentWorkflow = privateData({ workflowId: 'wf-other' });
  assert.equal(
    classifyRecovery(checkpointWithData(differentWorkflow)).reason,
    'CHECKPOINT_FOREIGN_WORKFLOW'
  );
});

test('corrupt plan, limit, budget, and checkpoint identities fail closed', () => {
  const wrongPlan = privateData({ planHash: 'plan1_' + '0'.repeat(64) });
  assert.equal(classifyRecovery(checkpointWithData(wrongPlan)).reason, 'CHECKPOINT_CORRUPT');

  const wrongRegistry = privateData({ registryVersion: 'registry1_' + '0'.repeat(64) });
  assert.equal(classifyRecovery(checkpointWithData(wrongRegistry)).reason, 'CHECKPOINT_CORRUPT');

  const wrongBudget = privateData({
    budget: {
      ...createBudgetSnapshot(createLimitSet(), 1_000, 31_000),
      stepsAdmitted: 99
    }
  });
  assert.equal(classifyRecovery(checkpointWithData(wrongBudget)).reason, 'BUDGET_INVALID');

  const wrongLimits = privateData({ limitsJson: '{"maxSteps":1}' });
  assert.equal(classifyRecovery(checkpointWithData(wrongLimits)).reason, 'LIMITS_INVALID');
});

test('terminal, review, cancelled, and cancellation-requested workflows cannot be resumed', () => {
  for (const state of ['succeeded', 'failed', 'cancelled']) {
    assert.equal(classifyRecovery(recoverySnapshot({ state })).reason, 'WORKFLOW_TERMINAL');
  }
  assert.equal(
    classifyRecovery(recoverySnapshot({ state: 'review_required' })).reason,
    'REVIEW_REQUIRED_IS_TERMINAL_FOR_THIS_CONTROLLER'
  );
  assert.equal(
    classifyRecovery(recoverySnapshot({ after: { cancellationRequested: true } })).reason,
    'CANCELLATION_REQUESTED'
  );
  assert.equal(
    classifyRecovery(recoverySnapshot({ state: 'queued' })).reason,
    'WORKFLOW_NOT_RUNNING'
  );
});

test('revision, state, checkpoint-sequence, and wall-clock drift stop stale recovery', () => {
  assert.equal(
    classifyRecovery(recoverySnapshot({ after: { revision: 5 } })).reason,
    'WORKFLOW_SNAPSHOT_CHANGED'
  );
  assert.equal(
    classifyRecovery(recoverySnapshot({ after: { checkpointSequence: 3 } })).reason,
    'WORKFLOW_SNAPSHOT_CHANGED'
  );
  assert.equal(
    classifyRecovery(recoverySnapshot({ observedAtMs: 999 })).reason,
    'CLOCK_ROLLBACK'
  );
  assert.equal(
    classifyRecovery(recoverySnapshot({ observedAtMs: 31_000 })).reason,
    'DEADLINE_EXCEEDED'
  );
});

test('foreign workflow results and provider-shaped result data are quarantined', () => {
  const otherPlan = compilePlan(makePlanJson(), undefined, undefined, 'wf-other');
  const otherResult = executeLocalStep(otherPlan, 'first');
  const crossWorkflowData = privateData({
    completedResultsJson: JSON.stringify({ first: otherResult })
  });
  const crossWorkflow = classifyRecovery(checkpointWithData(crossWorkflowData));
  assert.deepEqual(crossWorkflow, {
    kind: 'quarantine',
    reason: 'LOCAL_RESULT_IDENTITY_INVALID',
    actionable: false
  });

  const providerShapedData = privateData({
    completedResultsJson: JSON.stringify({
      first: {
        stepId: 'first',
        planHash: readyRunIdentity().planHash,
        registryVersion: readyRunIdentity().registryVersion,
        runIdentity: readyRunIdentity().runIdentity,
        inputHash: 'sha256_' + '0'.repeat(64),
        resultHash: 'sha256_' + '0'.repeat(64),
        output: 3,
        providerResponse: { usage: 0 }
      }
    })
  });
  const providerShaped = classifyRecovery(checkpointWithData(providerShapedData));
  assert.deepEqual(providerShaped, {
    kind: 'quarantine',
    reason: 'LOCAL_RESULT_IDENTITY_INVALID',
    actionable: false
  });
});

test('accessor, proxy, and raw provider values are not copied into recovery diagnostics', () => {
  let reads = 0;
  const proxy = new Proxy({}, {
    get() {
      reads += 1;
      return 'running';
    },
    ownKeys() {
      reads += 1;
      return [];
    }
  });
  const result = classifyRecovery(proxy);
  assert.equal(result.kind, 'stop');
  assert.equal(result.reason, 'RECOVERY_INPUT_INVALID');
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(reads, 0);

  const raw = '{"providerResponse":"customer-secret","api_key":"secret"}';
  const safe = classifyRecovery(raw);
  assert.equal(JSON.stringify(safe).includes('customer-secret'), false);
  assert.equal(JSON.stringify(safe).includes('api_key'), false);
});

test('unknown external attempt states stop rather than being treated as completed', () => {
  const result = classifyRecovery(recoverySnapshot({ attemptStates: ['provider-done?'] }));
  assert.deepEqual(result, {
    kind: 'stop',
    reason: 'ATTEMPT_SNAPSHOT_INVALID',
    actionable: false
  });
});
