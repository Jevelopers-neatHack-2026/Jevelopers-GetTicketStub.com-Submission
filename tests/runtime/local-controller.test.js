import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { DurableWorkflowStore, RuntimeError } from '@jevelopers/agent-harness-runtime';
import { LOCAL_CONTROLLER_STORAGE_CAPABILITY } from '../../src/internal/private-local-store-capability.js';
import {
  buildCompletedCheckpoint,
  buildInitialPrivateCheckpoint,
  runBoundedLocalPlan
} from '../../src/orchestrator/internal/controller.js';
import {
  advanceBudget,
  createBudgetSnapshot,
  createLimitSet,
  getLimitValues,
  recordResultBytes
} from '../../src/orchestrator/internal/limits.js';
import {
  compilePlan,
  executeLocalStep,
  getNextReadyStep
} from '../../src/orchestrator/internal/plan.js';
import { inspectOperation, createDefaultRegistry } from '../../src/tools/internal/registry.js';
import { inspectWorkflowRecovery } from '../../src/recovery/internal/controller.js';
import { spawnFixture, temporaryDatabase, waitForFiles } from './helpers.js';

const PLAN_KIND = 'agent-harness.private-synthetic-plan';
const DEPENDENT_PLAN = JSON.stringify({
  kind: PLAN_KIND,
  version: 1,
  steps: [
    { id: 'second', operation: 'number.add', dependsOn: ['first'], args: { left: { $result: 'first' }, right: 4 } },
    { id: 'first', operation: 'number.add', dependsOn: [], args: { left: 2, right: 3 } }
  ]
});
const SINGLE_PLAN = JSON.stringify({
  kind: PLAN_KIND,
  version: 1,
  steps: [{ id: 'only', operation: 'number.add', dependsOn: [], args: { left: 4, right: 5 } }]
});
const SELF_REHASH_PLAN = JSON.stringify({
  kind: PLAN_KIND,
  version: 1,
  steps: [
    { id: 'second', operation: 'number.add', dependsOn: ['first'], args: { left: { $result: 'first' }, right: 2 } },
    { id: 'first', operation: 'number.add', dependsOn: [], args: { left: 1, right: 2 } }
  ]
});

function mutableClock(startAtMs) {
  let current = startAtMs;
  return { read: () => current, set: value => { current = value; } };
}

function openStore(databasePath, clock = Date.now) {
  let id = 0;
  return DurableWorkflowStore.open({ databasePath, clock, idFactory: () => 'local-controller-' + (++id) });
}

function createRunningWorkflow(store, workflowId, ownerId = 'worker-local', ttlMs = 60_000) {
  store.createWorkflow({
    workflowId,
    checkpoint: { preserved: 'synthetic-original-checkpoint' },
    eventId: workflowId + ':created'
  });
  const lease = store.acquireLease({ workflowId, ownerId, ttlMs, eventId: workflowId + ':lease' });
  const running = store.transitionWorkflow({
    ...lease,
    expectedRevision: 0,
    toState: 'running',
    eventId: workflowId + ':running'
  });
  return { ...lease, revision: running.revision };
}

function storeTestPlan({ workflowId, planJson = SINGLE_PLAN, limitsJson = '{}' }) {
  const limitSet = createLimitSet(limitsJson);
  const plan = compilePlan(planJson, limitSet, undefined, workflowId);
  return { limitSet, plan };
}

function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

function savedResult(plan, stepId, args, output) {
  const inputHash = 'sha256_' + createHash('sha256').update(canonical({
    kind: 'agent-harness.private-local-input.v1',
    stepId,
    planHash: plan.planHash,
    registryVersion: plan.registryVersion,
    runIdentity: plan.runIdentity,
    args
  }), 'utf8').digest('hex');
  const resultHash = 'sha256_' + createHash('sha256').update(canonical({
    kind: 'agent-harness.private-local-result.v1',
    stepId,
    planHash: plan.planHash,
    registryVersion: plan.registryVersion,
    runIdentity: plan.runIdentity,
    inputHash,
    output
  }), 'utf8').digest('hex');
  return {
    stepId,
    planHash: plan.planHash,
    registryVersion: plan.registryVersion,
    runIdentity: plan.runIdentity,
    inputHash,
    resultHash,
    output
  };
}

function rewriteLatestCheckpointJson(databasePath, workflowId, payload) {
  const digest = createHash('sha256').update(payload, 'utf8').digest('hex');
  const database = new DatabaseSync(databasePath);
  database.exec('DROP TRIGGER workflow_checkpoints_no_update');
  const latest = database.prepare(
    'SELECT sequence FROM workflow_checkpoints WHERE workflow_id = ? ORDER BY sequence DESC LIMIT 1'
  ).get(workflowId);
  database.prepare(
    'UPDATE workflow_checkpoints SET payload_json = ?, sha256 = ? WHERE workflow_id = ? AND sequence = ?'
  ).run(payload, digest, workflowId, Number(latest.sequence));
  database.close();
}

function rewriteLatestPrivateCheckpoint(databasePath, workflowId, data) {
  rewriteLatestCheckpointJson(databasePath, workflowId, '{"schemaVersion":2,"data":' + canonical(data) + '}');
}

function makeAdmission(store, lease, planJson = SINGLE_PLAN, limitsJson = '{}', eventId = 'local-test:admit') {
  const workflowId = lease.workflowId;
  const snapshot = store._localControllerSnapshot(LOCAL_CONTROLLER_STORAGE_CAPABILITY, workflowId);
  const { limitSet, plan } = storeTestPlan({ workflowId, planJson, limitsJson });
  const now = store._localControllerNow(LOCAL_CONTROLLER_STORAGE_CAPABILITY);
  const budget = createBudgetSnapshot(limitSet, now, now + getLimitValues(limitSet).maxElapsedMs);
  const stepId = getNextReadyStep(plan, '{}');
  const admissionBudget = advanceBudget(budget, 'step', now, 0, limitSet);
  assert.equal(admissionBudget.allowed, true);
  const controllerState = buildInitialPrivateCheckpoint({
    workflowId,
    planJson,
    plan,
    limitSet,
    baseCheckpointData: snapshot.checkpoint.data,
    budget: admissionBudget.state,
    stepId
  });
  const stored = store._localControllerAdmit(LOCAL_CONTROLLER_STORAGE_CAPABILITY, {
    workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence,
    expectedRevision: snapshot.workflow.revision,
    expectedCheckpointSequence: snapshot.checkpoint.sequence,
    stepId,
    admissionKind: 'step',
    eventId,
    controllerState
  });
  return { stored, state: controllerState, plan, limitSet, stepId };
}

function makeCompletion(store, lease, admission, eventId = 'local-test:complete') {
  const result = executeLocalStep(admission.plan, admission.stepId, admission.state.completedResultsJson);
  const bytes = Buffer.byteLength(JSON.stringify(result.output), 'utf8');
  const byteRecord = recordResultBytes(admission.state.budget, bytes, admission.limitSet);
  assert.equal(byteRecord.allowed, true);
  const now = store._localControllerNow(LOCAL_CONTROLLER_STORAGE_CAPABILITY);
  const budget = Object.freeze({ ...byteRecord.state, lastWallMs: now });
  const controllerState = buildCompletedCheckpoint(admission.state, admission.plan, result, budget);
  const workflow = store.getWorkflow(lease.workflowId);
  const checkpoint = store.getCheckpoint(lease.workflowId);
  const input = {
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence,
    expectedRevision: workflow.revision,
    expectedCheckpointSequence: checkpoint.sequence,
    stepId: admission.stepId,
    eventId,
    controllerState
  };
  return { input, result, controllerState };
}

function fixturePath(name) {
  return join(new URL('./fixtures/', import.meta.url).pathname, name);
}

function spawnWithSignal(scriptPath, args = []) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return { child, done };
}

async function killAtMarker(child, markerPath) {
  await waitForFiles([markerPath]);
  const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
  child.child.kill('SIGKILL');
  const result = await child.done;
  assert.equal(result.signal, 'SIGKILL');
  return { marker, result };
}

function startRaceWorker({ mode, databasePath, workflowId, ownerId, fence, payloadPath, gatePath, workerId, resultPath, newOwnerId }) {
  return spawnFixture(fixturePath('local-controller-race.mjs'), [
    mode,
    databasePath,
    workflowId,
    ownerId,
    String(fence),
    payloadPath,
    gatePath,
    workerId,
    resultPath,
    newOwnerId ?? '-'
  ]);
}

function snapshotDatabase(databasePath) {
  const tables = [
    'workflows', 'workflow_checkpoints', 'workflow_events', 'outbox',
    'operation_attempts', 'transport_attempts', 'response_receipts',
    'attempt_observations', 'immutable_artifacts', 'telemetry_cursors',
    'jev_dispatch_markers', 'jev_provider_observations', 'jev_local_observation_outbox'
  ];
  const db = new DatabaseSync(databasePath);
  try {
    const result = Object.create(null);
    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all().map(row => {
        const output = Object.create(null);
        for (const key of Object.keys(row).sort()) {
          const value = row[key];
          output[key] = ArrayBuffer.isView(value) ? Buffer.from(value).toString('hex') : value;
        }
        return output;
      });
      rows.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
      result[table] = rows;
    }
    result.sqliteSequence = db.prepare('SELECT name, seq FROM sqlite_sequence ORDER BY name').all();
    return JSON.stringify(result);
  } finally {
    db.close();
  }
}

function installWriteFailure(databasePath, table, workflowId, suffix) {
  const trigger = 'fail_local_' + suffix;
  const db = new DatabaseSync(databasePath);
  try {
    const sql = table === 'workflows'
      ? `CREATE TRIGGER ${trigger} AFTER UPDATE ON workflows WHEN NEW.workflow_id = '${workflowId}' AND NEW.checkpoint_sequence > OLD.checkpoint_sequence BEGIN SELECT RAISE(ABORT, 'synthetic local write failure'); END;`
      : table === 'workflow_checkpoints'
        ? `CREATE TRIGGER ${trigger} AFTER INSERT ON workflow_checkpoints WHEN NEW.workflow_id = '${workflowId}' AND NEW.sequence > 1 BEGIN SELECT RAISE(ABORT, 'synthetic local write failure'); END;`
        : table === 'workflow_events'
          ? `CREATE TRIGGER ${trigger} AFTER INSERT ON workflow_events WHEN NEW.workflow_id = '${workflowId}' AND NEW.event_type LIKE 'private_local_%' BEGIN SELECT RAISE(ABORT, 'synthetic local write failure'); END;`
          : `CREATE TRIGGER ${trigger} AFTER INSERT ON outbox WHEN NEW.event_id LIKE 'rollback:%' BEGIN SELECT RAISE(ABORT, 'synthetic local write failure'); END;`;
    db.exec(sql);
  } finally {
    db.close();
  }
  return trigger;
}

function dropTrigger(databasePath, trigger) {
  const db = new DatabaseSync(databasePath);
  try {
    db.exec(`DROP TRIGGER ${trigger}`);
  } finally {
    db.close();
  }
}

function countRows(databasePath, table) {
  const db = new DatabaseSync(databasePath);
  try {
    return Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  } finally {
    db.close();
  }
}

test('the durable controller computes dependent local results and never repeats committed completion', async t => {
  const temporary = temporaryDatabase('bounded-local-controller-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'controller-executable-run');

  const result = await runBoundedLocalPlan({
    store,
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence,
    planJson: DEPENDENT_PLAN
  });
  assert.equal(result.status, 'completed');
  assert.deepEqual(result.results.map(record => record.output), [5, 9]);
  assert.equal(result.stoppingFacts.stepsAdmitted, 2);
  assert.equal(result.stoppingFacts.stepAttempts, 2);
  assert.equal(result.stoppingFacts.localRetries, 0);
  assert.equal(result.stoppingFacts.replans, 0);
  assert.equal(result.stoppingFacts.iterations, 2);
  assert.equal(store.getWorkflow(lease.workflowId).state, 'running');
  assert.equal(store.getWorkflow(lease.workflowId).checkpointSequence, 5);
  assert.equal(store.getCheckpoint(lease.workflowId).data.baseCheckpointData.preserved, 'synthetic-original-checkpoint');
  assert.deepEqual(store.listEvents({ workflowId: lease.workflowId }).slice(-4).map(event => event.type), [
    'private_local_step_admitted',
    'private_local_step_completed',
    'private_local_step_admitted',
    'private_local_step_completed'
  ]);
  assert.equal(store.readOutbox().length, store.listEvents({ workflowId: lease.workflowId }).length);
  assert.equal(countRows(temporary.databasePath, 'operation_attempts'), 0);
  assert.equal(countRows(temporary.databasePath, 'transport_attempts'), 0);
  assert.equal(countRows(temporary.databasePath, 'response_receipts'), 0);

  const eventsBeforeReplay = store.listEvents({ workflowId: lease.workflowId }).length;
  const sameResult = await runBoundedLocalPlan({
    store,
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence
  });
  assert.equal(sameResult.resultHash, result.resultHash, JSON.stringify(sameResult));
  assert.equal(store.listEvents({ workflowId: lease.workflowId }).length, eventsBeforeReplay);
});

test('SQLite reopen rejects rehashed fabricated results and over-limit saved output', async t => {
  const forged = temporaryDatabase('bounded-rehashed-result-');
  t.after(() => forged.cleanup());
  let store = openStore(forged.databasePath);
  t.after(() => store.close());
  const forgedLease = createRunningWorkflow(store, 'rehashed-result-run');
  const valid = await runBoundedLocalPlan({
    store,
    workflowId: forgedLease.workflowId,
    ownerId: forgedLease.ownerId,
    fence: forgedLease.fence,
    planJson: SELF_REHASH_PLAN
  });
  assert.equal(valid.status, 'completed');
  const checkpoint = store.getCheckpoint(forgedLease.workflowId);
  const plan = compilePlan(SELF_REHASH_PLAN, createLimitSet(checkpoint.data.limitsJson), undefined, forgedLease.workflowId);
  const forgedFirst = savedResult(plan, 'first', { left: 1, right: 2 }, 900);
  const forgedSecond = savedResult(plan, 'second', { left: 900, right: 2 }, 902);
  const forgedData = {
    ...checkpoint.data,
    completedResultsJson: JSON.stringify({ first: forgedFirst, second: forgedSecond }),
    budget: { ...checkpoint.data.budget, totalResultBytes: 6 }
  };
  const eventCountBeforeForgery = store.listEvents({ workflowId: forgedLease.workflowId }).length;
  store.close();
  rewriteLatestPrivateCheckpoint(forged.databasePath, forgedLease.workflowId, forgedData);

  store = openStore(forged.databasePath);
  const stopped = await runBoundedLocalPlan({
    store,
    workflowId: forgedLease.workflowId,
    ownerId: forgedLease.ownerId,
    fence: forgedLease.fence
  });
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.reason, 'PLAN_RESULT_IDENTITY_INVALID');
  const inspection = inspectWorkflowRecovery({ store, workflowId: forgedLease.workflowId });
  assert.equal(inspection.kind, 'quarantine');
  assert.equal(inspection.reason, 'LOCAL_RESULT_IDENTITY_INVALID');
  assert.equal(store.listEvents({ workflowId: forgedLease.workflowId }).length, eventCountBeforeForgery);

  store.close();
  const oversized = temporaryDatabase('bounded-saved-result-limit-');
  t.after(() => oversized.cleanup());
  store = openStore(oversized.databasePath);
  t.after(() => store.close());
  const oversizedLease = createRunningWorkflow(store, 'saved-result-limit-run');
  const planJson = JSON.stringify({
    kind: PLAN_KIND,
    version: 1,
    steps: [{ id: 'text', operation: 'text.concat', dependsOn: [], args: { parts: ['abc'] } }]
  });
  const limitsJson = '{"maxResultBytes":2,"maxTotalResultBytes":3}';
  const pending = await runBoundedLocalPlan({
    store,
    workflowId: oversizedLease.workflowId,
    ownerId: oversizedLease.ownerId,
    fence: oversizedLease.fence,
    planJson,
    limitsJson
  });
  assert.equal(pending.status, 'stopped');
  assert.equal(pending.reason, 'PLAN_RESULT_TOO_LARGE');
  const admitted = store.getCheckpoint(oversizedLease.workflowId);
  assert.equal(admitted.data.pendingStepId, 'text');
  assert.equal(admitted.data.budget.totalResultBytes, 0);
  const tightPlan = compilePlan(planJson, createLimitSet(limitsJson), undefined, oversizedLease.workflowId);
  const overLimit = savedResult(tightPlan, 'text', { parts: ['abc'] }, 'abc');
  const oversizedData = {
    ...admitted.data,
    completedResultsJson: JSON.stringify({ text: overLimit }),
    pendingStepId: null
  };
  store.close();
  rewriteLatestPrivateCheckpoint(oversized.databasePath, oversizedLease.workflowId, oversizedData);

  store = openStore(oversized.databasePath);
  const recovered = await runBoundedLocalPlan({
    store,
    workflowId: oversizedLease.workflowId,
    ownerId: oversizedLease.ownerId,
    fence: oversizedLease.fence
  });
  assert.equal(recovered.status, 'stopped');
  assert.equal(recovered.reason, 'PLAN_RESULT_TOO_LARGE');
  const oversizedInspection = inspectWorkflowRecovery({ store, workflowId: oversizedLease.workflowId });
  assert.equal(oversizedInspection.kind, 'quarantine');
  assert.equal(oversizedInspection.reason, 'LOCAL_RESULT_IDENTITY_INVALID');
  assert.equal(store.getCheckpoint(oversizedLease.workflowId).data.budget.totalResultBytes, 0);
});

test('checkpoint JSON rejects duplicate members while retaining generic finite-number compatibility', t => {
  const numeric = temporaryDatabase('bounded-checkpoint-number-compatibility-');
  t.after(() => numeric.cleanup());
  const numericStore = openStore(numeric.databasePath);
  numericStore.createWorkflow({
    workflowId: 'checkpoint-large-finite-number',
    checkpoint: { largeFinite: 1e21 },
    eventId: 'checkpoint-large-finite-number:created'
  });
  assert.equal(numericStore.getCheckpoint('checkpoint-large-finite-number').data.largeFinite, 1e21);
  numericStore.close();

  const duplicate = temporaryDatabase('bounded-checkpoint-duplicate-member-');
  t.after(() => duplicate.cleanup());
  const duplicateStore = openStore(duplicate.databasePath);
  duplicateStore.createWorkflow({
    workflowId: 'checkpoint-duplicate-member',
    checkpoint: { value: 1 },
    eventId: 'checkpoint-duplicate-member:created'
  });
  duplicateStore.close();
  rewriteLatestCheckpointJson(
    duplicate.databasePath,
    'checkpoint-duplicate-member',
    '{"schemaVersion":2,"data":{"value":1,"value":2}}'
  );
  const reopened = openStore(duplicate.databasePath);
  t.after(() => reopened.close());
  assert.throws(
    () => reopened.getCheckpoint('checkpoint-duplicate-member'),
    error => error.code === 'CHECKPOINT_CORRUPT'
  );
});

test('external, provider, privileged, unknown, and injected-mode plans stop before admission in every mode', async t => {
  const operations = [
    ['network.fetch', 'external'],
    ['provider.image', 'provider'],
    ['provider.reason', 'provider'],
    ['system.shell', 'privileged']
  ];
  let sends = 0;
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => { sends += 1; throw new Error('synthetic send counter'); };
  t.after(() => { globalThis.fetch = priorFetch; });

  for (const mode of ['mock', 'recorded', 'sandbox', 'live']) {
    for (const [operation, effect] of operations) {
      const info = inspectOperation(createDefaultRegistry(), operation);
      assert.equal(info.effect, effect);
      assert.equal(info.status, 'unavailable');
      const temporary = temporaryDatabase('bounded-no-capability-');
      t.after(() => temporary.cleanup());
      const store = openStore(temporary.databasePath);
      const lease = createRunningWorkflow(store, `denied-${mode}-${operation.replace('.', '-')}`);
      const before = store.getCheckpoint(lease.workflowId);
      const planJson = JSON.stringify({
        kind: PLAN_KIND,
        version: 1,
        steps: [{ id: 'blocked', operation, dependsOn: [], args: {} }]
      });
      const result = await runBoundedLocalPlan({
        store,
        workflowId: lease.workflowId,
        ownerId: lease.ownerId,
        fence: lease.fence,
        planJson
      });
      assert.equal(result.status, 'stopped');
      assert.equal(result.reason, 'PLAN_EFFECT_UNAVAILABLE');
      assert.equal(store.getCheckpoint(lease.workflowId).sequence, before.sequence);
      assert.equal(countRows(temporary.databasePath, 'operation_attempts'), 0);
      assert.equal(store.listEvents({ workflowId: lease.workflowId }).some(event => event.type.startsWith('private_local_')), false);
      store.close();
    }
  }
  assert.equal(sends, 0);

  const unknown = temporaryDatabase('bounded-unknown-tool-');
  t.after(() => unknown.cleanup());
  const store = openStore(unknown.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'unknown-tool-run');
  const result = await runBoundedLocalPlan({
    store,
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence,
    planJson: JSON.stringify({
      kind: PLAN_KIND,
      version: 1,
      steps: [{ id: 'unknown', operation: 'tool.injected', dependsOn: [], args: {} }]
    })
  });
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'PLAN_UNKNOWN_OPERATION');

  const checkpointBeforeOversize = store.getCheckpoint(lease.workflowId);
  const oversized = await runBoundedLocalPlan({
    store,
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence,
    planJson: SINGLE_PLAN + ' '.repeat(32_769)
  });
  assert.equal(oversized.reason, 'PLAN_TOO_LARGE');
  assert.equal(store.getCheckpoint(lease.workflowId).sha256, checkpointBeforeOversize.sha256);

  const externalPlan = JSON.stringify({
    kind: PLAN_KIND,
    version: 1,
    steps: [{ id: 'blocked', operation: 'network.fetch', dependsOn: [], args: {} }]
  });
  for (const authorityState of ['synthetic-grant', 'synthetic-revocation']) {
    const forgedAuthority = await runBoundedLocalPlan({
      store,
      workflowId: lease.workflowId,
      ownerId: lease.ownerId,
      fence: lease.fence,
      planJson: externalPlan,
      mode: 'mock',
      authorization: { state: authorityState, granted: true },
      opaqueHoldRef: 'not-a-capability',
      cachedRank: 1
    });
    assert.equal(forgedAuthority.reason, 'CONTROLLER_INPUT_INVALID', authorityState);
    assert.equal(store.getCheckpoint(lease.workflowId).sha256, checkpointBeforeOversize.sha256);
  }
  assert.equal(sends, 0);
});

test('the four process-kill boundaries retain counters and never rerun a committed result', async t => {
  const cases = [
    ['before-admission', 0, 1, 0],
    ['after-admission', 1, 2, 1],
    ['after-compute', 1, 2, 1],
    ['after-completion', 1, 1, 0]
  ];
  for (const [stage, expectedAdmitted, expectedAttempts, expectedRetries] of cases) {
    const temporary = temporaryDatabase('bounded-crash-' + stage + '-');
    t.after(() => temporary.cleanup());
    const planPath = join(temporary.directory, 'plan.json');
    const markerPath = join(temporary.directory, 'worker.ready');
    writeFileSync(planPath, SINGLE_PLAN);
    const setupStore = openStore(temporary.databasePath);
    const lease = createRunningWorkflow(setupStore, 'crash-' + stage);
    setupStore.close();

    const worker = spawnWithSignal(fixturePath('local-controller-crash.mjs'), [
      temporary.databasePath,
      lease.workflowId,
      lease.ownerId,
      String(lease.fence),
      planPath,
      markerPath,
      stage
    ]);
    const { marker } = await killAtMarker(worker, markerPath);
    assert.equal(marker.stage, stage);
    if (stage === 'after-compute') assert.match(marker.resultHash, /^sha256_[0-9a-f]{64}$/u);

    const recovered = openStore(temporary.databasePath);
    const beforeEvents = recovered.listEvents({ workflowId: lease.workflowId }).length;
    const result = await runBoundedLocalPlan({
      store: recovered,
      workflowId: lease.workflowId,
      ownerId: lease.ownerId,
      fence: lease.fence,
      planJson: SINGLE_PLAN
    });
    assert.equal(result.status, 'completed', stage);
    assert.equal(result.results[0].output, 9, stage);
    const state = recovered.getCheckpoint(lease.workflowId).data;
    assert.equal(state.budget.stepsAdmitted, expectedAdmitted || 1, stage);
    assert.equal(state.budget.stepAttempts, expectedAttempts, stage);
    assert.equal(state.budget.localRetries, expectedRetries, stage);
    assert.equal(state.budget.replans, 0, stage);
    assert.equal(countRows(temporary.databasePath, 'operation_attempts'), 0, stage);
    assert.equal(countRows(temporary.databasePath, 'transport_attempts'), 0, stage);

    if (stage === 'after-completion') {
      assert.equal(recovered.listEvents({ workflowId: lease.workflowId }).length, beforeEvents);
    }
    const eventsAtCompletion = recovered.listEvents({ workflowId: lease.workflowId }).length;
    const repeated = await runBoundedLocalPlan({
      store: recovered,
      workflowId: lease.workflowId,
      ownerId: lease.ownerId,
      fence: lease.fence
    });
    assert.equal(repeated.resultHash, result.resultHash, stage + ': ' + JSON.stringify(repeated));
    assert.equal(recovered.listEvents({ workflowId: lease.workflowId }).length, eventsAtCompletion, stage);
    recovered.close();
  }
});

test('admission and cancellation races use one durable CAS winner; a stale lease cannot commit', async t => {
  const temporary = temporaryDatabase('bounded-admission-cas-');
  t.after(() => temporary.cleanup());
  const setup = openStore(temporary.databasePath);
  const lease = createRunningWorkflow(setup, 'admission-cas-run');
  const snapshot = setup._localControllerSnapshot(LOCAL_CONTROLLER_STORAGE_CAPABILITY, lease.workflowId);
  const { limitSet, plan } = storeTestPlan({ workflowId: lease.workflowId });
  const now = setup._localControllerNow(LOCAL_CONTROLLER_STORAGE_CAPABILITY);
  const initial = createBudgetSnapshot(limitSet, now, now + getLimitValues(limitSet).maxElapsedMs);
  const stepId = getNextReadyStep(plan, '{}');
  const nextBudget = advanceBudget(initial, 'step', now, 0, limitSet).state;
  const state = buildInitialPrivateCheckpoint({
    workflowId: lease.workflowId,
    planJson: SINGLE_PLAN,
    plan,
    limitSet,
    baseCheckpointData: snapshot.checkpoint.data,
    budget: nextBudget,
    stepId
  });
  const payloadPath = join(temporary.directory, 'admission.json');
  writeFileSync(payloadPath, JSON.stringify({
    expectedRevision: snapshot.workflow.revision,
    expectedCheckpointSequence: snapshot.checkpoint.sequence,
    stepId,
    admissionKind: 'step',
    eventId: 'admission-cas:admit',
    controllerState: state
  }));
  setup.close();

  const gate = join(temporary.directory, 'release-admission-race');
  const workers = [0, 1].map(index => startRaceWorker({
    mode: 'admit',
    databasePath: temporary.databasePath,
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence,
    payloadPath,
    gatePath: gate,
    workerId: 'admit-' + index,
    resultPath: join(temporary.directory, 'admit-' + index + '.json')
  }));
  await waitForFiles([gate + '.admit-0.ready', gate + '.admit-1.ready']);
  writeFileSync(gate, 'go');
  const results = await Promise.all(workers.map(worker => worker.done));
  const records = results.map((result, index) => {
    assert.ok([0, 2].includes(result.code));
    return JSON.parse(readFileSync(join(temporary.directory, 'admit-' + index + '.json'), 'utf8'));
  });
  assert.equal(records.filter(record => record.accepted).length, 1, JSON.stringify({ records, results }));
  assert.equal(records.filter(record => !record.accepted && record.code === 'CONCURRENT_MODIFICATION').length, 1);

  const after = openStore(temporary.databasePath);
  assert.equal(after.getWorkflow(lease.workflowId).checkpointSequence, 2);
  assert.equal(countRows(temporary.databasePath, 'operation_attempts'), 0);
  after.close();
});

test('completion racing cancellation and lease takeover cannot resurrect stale work', async t => {
  const temporary = temporaryDatabase('bounded-cancel-race-');
  t.after(() => temporary.cleanup());
  const setup = openStore(temporary.databasePath);
  const lease = createRunningWorkflow(setup, 'completion-cancel-run');
  const admission = makeAdmission(setup, lease, SINGLE_PLAN, '{}', 'cancel-race:admit');
  const completion = makeCompletion(setup, lease, admission, 'cancel-race:complete');
  const completePath = join(temporary.directory, 'completion.json');
  const cancelPath = join(temporary.directory, 'cancel.json');
  writeFileSync(completePath, JSON.stringify(completion.input));
  writeFileSync(cancelPath, JSON.stringify({
    expectedRevision: completion.input.expectedRevision,
    eventId: 'cancel-race:cancel'
  }));
  setup.close();

  const gate = join(temporary.directory, 'release-cancel-complete');
  const workers = [
    startRaceWorker({
      mode: 'complete', databasePath: temporary.databasePath, workflowId: lease.workflowId,
      ownerId: lease.ownerId, fence: lease.fence, payloadPath: completePath, gatePath: gate,
      workerId: 'complete', resultPath: join(temporary.directory, 'complete-result.json')
    }),
    startRaceWorker({
      mode: 'cancel', databasePath: temporary.databasePath, workflowId: lease.workflowId,
      ownerId: lease.ownerId, fence: lease.fence, payloadPath: cancelPath, gatePath: gate,
      workerId: 'cancel', resultPath: join(temporary.directory, 'cancel-result.json')
    })
  ];
  await waitForFiles([gate + '.complete.ready', gate + '.cancel.ready']);
  writeFileSync(gate, 'go');
  const results = await Promise.all(workers.map(worker => worker.done));
  const records = results.map((result, index) => {
    assert.ok([0, 2].includes(result.code));
    const name = index === 0 ? 'complete-result.json' : 'cancel-result.json';
    return JSON.parse(readFileSync(join(temporary.directory, name), 'utf8'));
  });
  assert.equal(records.filter(record => record.accepted).length, 1);

  const after = openStore(temporary.databasePath);
  const workflow = after.getWorkflow(lease.workflowId);
  const state = after.getCheckpoint(lease.workflowId).data;
  if (workflow.cancellationRequested) {
    assert.equal(workflow.state, 'cancelled');
    assert.equal(state.pendingStepId, 'only');
    assert.equal(state.budget.stepAttempts, 1);
  } else {
    assert.equal(workflow.state, 'running');
    assert.equal(state.pendingStepId, null);
    assert.equal(state.budget.stepAttempts, 1);
    assert.equal(JSON.parse(state.completedResultsJson).only.output, 9);
  }
  const postAdmissionEvents = after.listEvents({ workflowId: lease.workflowId })
    .filter(event => event.eventId === 'cancel-race:complete' || event.eventId === 'cancel-race:cancel');
  assert.equal(postAdmissionEvents.length, 1);
  after.close();

  const takeover = temporaryDatabase('bounded-lease-takeover-');
  t.after(() => takeover.cleanup());
  const expiring = openStore(takeover.databasePath);
  const oldLease = createRunningWorkflow(expiring, 'lease-takeover-run', 'worker-old', 1_000);
  const pending = makeAdmission(expiring, oldLease, SINGLE_PLAN, '{}', 'lease-race:admit');
  const staleCompletion = makeCompletion(expiring, oldLease, pending, 'lease-race:stale-complete');
  const stalePath = join(takeover.directory, 'stale.json');
  const replacementPath = join(takeover.directory, 'replacement.json');
  writeFileSync(stalePath, JSON.stringify(staleCompletion.input));
  writeFileSync(replacementPath, JSON.stringify({ eventId: 'lease-race:replacement' }));
  expiring.close();
  await new Promise(resolve => setTimeout(resolve, 1_100));

  const takeoverGate = join(takeover.directory, 'release-takeover-race');
  const takeoverWorkers = [
    startRaceWorker({
      mode: 'complete', databasePath: takeover.databasePath, workflowId: oldLease.workflowId,
      ownerId: oldLease.ownerId, fence: oldLease.fence, payloadPath: stalePath, gatePath: takeoverGate,
      workerId: 'stale-owner', resultPath: join(takeover.directory, 'stale-result.json')
    }),
    startRaceWorker({
      mode: 'takeover', databasePath: takeover.databasePath, workflowId: oldLease.workflowId,
      ownerId: oldLease.ownerId, fence: oldLease.fence, payloadPath: replacementPath, gatePath: takeoverGate,
      workerId: 'replacement-owner', resultPath: join(takeover.directory, 'replacement-result.json'),
      newOwnerId: 'worker-replacement'
    })
  ];
  await waitForFiles([takeoverGate + '.stale-owner.ready', takeoverGate + '.replacement-owner.ready']);
  writeFileSync(takeoverGate, 'go');
  const takeoverResults = await Promise.all(takeoverWorkers.map(worker => worker.done));
  const takeoverRecords = takeoverResults.map((result, index) => {
    assert.ok([0, 2].includes(result.code));
    const name = index === 0 ? 'stale-result.json' : 'replacement-result.json';
    return JSON.parse(readFileSync(join(takeover.directory, name), 'utf8'));
  });
  assert.equal(takeoverRecords.filter(record => record.accepted).length, 1);
  const newStore = openStore(takeover.databasePath);
  assert.equal(newStore.getWorkflow(oldLease.workflowId).leaseOwner, 'worker-replacement');
  assert.equal(newStore.getCheckpoint(oldLease.workflowId).data.pendingStepId, 'only');
  assert.equal(newStore.getCheckpoint(oldLease.workflowId).data.budget.stepAttempts, 1);
  newStore.close();
});

test('cancellation at admission and post-compute barriers fences local completion', async t => {
  for (const stage of ['after-admission', 'after-compute']) {
    const temporary = temporaryDatabase('bounded-cancel-barrier-' + stage + '-');
    t.after(() => temporary.cleanup());
    const store = openStore(temporary.databasePath);
    t.after(() => store.close());
    const lease = createRunningWorkflow(store, 'cancel-barrier-' + stage);
    const run = runBoundedLocalPlan({
      store,
      workflowId: lease.workflowId,
      ownerId: lease.ownerId,
      fence: lease.fence,
      planJson: SINGLE_PLAN
    });
    let cancellation;
    if (stage === 'after-admission') {
      const workflow = store.getWorkflow(lease.workflowId);
      cancellation = store.requestCancellation({
        ...lease,
        expectedRevision: workflow.revision,
        eventId: 'cancel-barrier:' + stage
      });
    } else {
      // runBoundedLocalPlan has already queued its first setImmediate. This
      // callback runs after that boundary's synchronous computation and before
      // the separately queued pre-commit boundary.
      cancellation = await new Promise(resolve => setImmediate(() => {
        const workflow = store.getWorkflow(lease.workflowId);
        resolve(store.requestCancellation({
          ...lease,
          expectedRevision: workflow.revision,
          eventId: 'cancel-barrier:' + stage
        }));
      }));
    }
    assert.equal(cancellation.accepted, true, stage);
    const result = await run;
    assert.equal(result.status, 'stopped', stage);
    assert.equal(['WORKFLOW_TERMINAL', 'CANCELLATION_REQUESTED'].includes(result.reason), true, stage);
    const workflow = store.getWorkflow(lease.workflowId);
    const checkpoint = store.getCheckpoint(lease.workflowId).data;
    assert.equal(workflow.cancellationRequested, true, stage);
    assert.equal(checkpoint.pendingStepId, 'only', stage);
    assert.equal(checkpoint.budget.stepsAdmitted, 1, stage);
    assert.equal(checkpoint.budget.stepAttempts, 1, stage);
    assert.equal(checkpoint.budget.localRetries, 0, stage);
    assert.equal(checkpoint.completedResultsJson, '{}', stage);
    assert.equal(store.listEvents({ workflowId: lease.workflowId })
      .some(event => event.type === 'private_local_step_completed'), false, stage);
    assert.equal(countRows(temporary.databasePath, 'operation_attempts'), 0, stage);
  }
});

test('limit deadline and clock rollback remain pinned across recovery without counter reset', async t => {
  const temporary = temporaryDatabase('bounded-clock-recovery-');
  t.after(() => temporary.cleanup());
  const clock = mutableClock(10_000);
  let store = openStore(temporary.databasePath, clock.read);
  const lease = createRunningWorkflow(store, 'clock-deadline-run', 'worker-clock');
  const limitsJson = JSON.stringify({ maxElapsedMs: 100, maxLocalRetries: 1, maxStepAttempts: 2 });
  makeAdmission(store, lease, SINGLE_PLAN, limitsJson, 'clock:admit');
  const checkpointBefore = store.getCheckpoint(lease.workflowId).data;
  assert.equal(checkpointBefore.budget.deadlineWallMs, 10_100);
  clock.set(10_100);
  const expired = await runBoundedLocalPlan({
    store,
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence
  });
  assert.equal(expired.status, 'stopped');
  assert.equal(expired.reason, 'DEADLINE_EXCEEDED');
  const checkpointAfter = store.getCheckpoint(lease.workflowId).data;
  assert.equal(checkpointAfter.budget.deadlineWallMs, 10_100);
  assert.equal(checkpointAfter.budget.stepAttempts, 1);
  assert.equal(checkpointAfter.budget.localRetries, 0);
  store.close();

  store = openStore(temporary.databasePath, clock.read);
  clock.set(9_999);
  const rollback = await runBoundedLocalPlan({
    store,
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence
  });
  assert.equal(rollback.reason, 'CLOCK_ROLLBACK');
  assert.equal(store.getCheckpoint(lease.workflowId).data.budget.stepAttempts, 1);
  store.close();

  const noRetry = temporaryDatabase('bounded-no-retry-');
  t.after(() => noRetry.cleanup());
  const retryStore = openStore(noRetry.databasePath, () => 20_000);
  const retryLease = createRunningWorkflow(retryStore, 'no-retry-run', 'worker-no-retry');
  makeAdmission(retryStore, retryLease, SINGLE_PLAN,
    JSON.stringify({ maxLocalRetries: 0, maxStepAttempts: 1 }), 'no-retry:admit');
  const stopped = await runBoundedLocalPlan({
    store: retryStore,
    workflowId: retryLease.workflowId,
    ownerId: retryLease.ownerId,
    fence: retryLease.fence
  });
  assert.equal(stopped.reason, 'LOCAL_RETRY_LIMIT');
  assert.equal(retryStore.getCheckpoint(retryLease.workflowId).data.budget.stepAttempts, 1);
  assert.equal(retryStore.getCheckpoint(retryLease.workflowId).data.budget.localRetries, 0);
  retryStore.close();
});

test('the durable controller stops after final compute crosses the pinned elapsed deadline', async t => {
  const temporary = temporaryDatabase('bounded-final-compute-deadline-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath, () => 40_000);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'final-compute-deadline-run');
  const priorNow = performance.now;
  const samples = [0, 0, 0, 10, 10];
  let index = 0;
  performance.now = () => samples[Math.min(index++, samples.length - 1)];
  let result;
  try {
    result = await runBoundedLocalPlan({
      store,
      workflowId: lease.workflowId,
      ownerId: lease.ownerId,
      fence: lease.fence,
      planJson: SINGLE_PLAN,
      limitsJson: '{"maxElapsedMs":5}'
    });
  } finally {
    performance.now = priorNow;
  }
  assert.equal(result.status, 'stopped');
  assert.equal(result.reason, 'ELAPSED_LIMIT');
  const checkpoint = store.getCheckpoint(lease.workflowId);
  assert.equal(checkpoint.data.pendingStepId, 'only');
  assert.equal(checkpoint.data.budget.stepAttempts, 1);
  assert.equal(JSON.parse(checkpoint.data.completedResultsJson).only, undefined);
  assert.equal(store.listEvents({ workflowId: lease.workflowId }).filter(event => event.type === 'private_local_step_completed').length, 0);

  const commitBoundary = temporaryDatabase('bounded-final-commit-deadline-');
  t.after(() => commitBoundary.cleanup());
  const commitStore = openStore(commitBoundary.databasePath, () => 50_000);
  t.after(() => commitStore.close());
  const commitLease = createRunningWorkflow(commitStore, 'final-commit-deadline-run');
  const commitSamples = [0, 0, 0, 0, 0, 0, 10, 10];
  let commitIndex = 0;
  performance.now = () => commitSamples[Math.min(commitIndex++, commitSamples.length - 1)];
  let commitResult;
  try {
    commitResult = await runBoundedLocalPlan({
      store: commitStore,
      workflowId: commitLease.workflowId,
      ownerId: commitLease.ownerId,
      fence: commitLease.fence,
      planJson: SINGLE_PLAN,
      limitsJson: '{"maxElapsedMs":5}'
    });
  } finally {
    performance.now = priorNow;
  }
  assert.equal(commitResult.status, 'stopped');
  assert.equal(commitResult.reason, 'ELAPSED_LIMIT');
  assert.equal(commitStore.getCheckpoint(commitLease.workflowId).data.pendingStepId, 'only');
  assert.equal(commitStore.getCheckpoint(commitLease.workflowId).data.budget.stepAttempts, 1);
  assert.equal(commitStore.listEvents({ workflowId: commitLease.workflowId })
    .filter(event => event.type === 'private_local_step_completed').length, 0);
});

test('SQL failure after each admission and completion write rolls back the actual file database', async t => {
  const writeTargets = ['workflows', 'workflow_checkpoints', 'workflow_events', 'outbox'];
  for (const target of writeTargets) {
    const temporary = temporaryDatabase('bounded-admission-rollback-' + target + '-');
    t.after(() => temporary.cleanup());
    const store = openStore(temporary.databasePath, () => 30_000);
    const lease = createRunningWorkflow(store, 'admission-rollback-' + target);
    const snapshotBefore = snapshotDatabase(temporary.databasePath);
    const admissionInput = makeAdmissionCandidate(store, lease, SINGLE_PLAN, 'rollback:admit:' + target);
    const beforeCommit = snapshotDatabase(temporary.databasePath);
    const trigger = installWriteFailure(temporary.databasePath, target, lease.workflowId, 'admit_' + target);
    assert.throws(() => store._localControllerAdmit(LOCAL_CONTROLLER_STORAGE_CAPABILITY, admissionInput), error => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(error.code, 'STORE_WRITE_FAILED');
      return true;
    });
    dropTrigger(temporary.databasePath, trigger);
    assert.equal(snapshotDatabase(temporary.databasePath), beforeCommit, 'admission rollback at ' + target);
    assert.equal(beforeCommit, snapshotBefore, 'candidate preparation must be side effect free');
    store.close();
    const reopened = openStore(temporary.databasePath, () => 30_000);
    assert.equal(snapshotDatabase(temporary.databasePath), beforeCommit, 'reopened admission rollback at ' + target);
    reopened.close();
  }

  for (const target of writeTargets) {
    const temporary = temporaryDatabase('bounded-completion-rollback-' + target + '-');
    t.after(() => temporary.cleanup());
    const store = openStore(temporary.databasePath, () => 40_000);
    const lease = createRunningWorkflow(store, 'completion-rollback-' + target);
    const admission = makeAdmission(store, lease, SINGLE_PLAN, '{}', 'rollback:seed-admission:' + target);
    const completion = makeCompletion(store, lease, admission, 'rollback:complete:' + target);
    const beforeCommit = snapshotDatabase(temporary.databasePath);
    const trigger = installWriteFailure(temporary.databasePath, target, lease.workflowId, 'complete_' + target);
    assert.throws(() => store._localControllerComplete(LOCAL_CONTROLLER_STORAGE_CAPABILITY, completion.input), error => {
      assert.ok(error instanceof RuntimeError);
      assert.equal(error.code, 'STORE_WRITE_FAILED');
      return true;
    });
    dropTrigger(temporary.databasePath, trigger);
    assert.equal(snapshotDatabase(temporary.databasePath), beforeCommit, 'completion rollback at ' + target);
    store.close();
    const reopened = openStore(temporary.databasePath, () => 40_000);
    assert.equal(snapshotDatabase(temporary.databasePath), beforeCommit, 'reopened completion rollback at ' + target);
    reopened.close();
  }
});

test('duplicate admission and completion event identities cannot add checkpoints after reopen', t => {
  const temporary = temporaryDatabase('bounded-duplicate-event-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath, () => 50_000);
  const lease = createRunningWorkflow(store, 'duplicate-event-run');
  const initial = snapshotDatabase(temporary.databasePath);
  const conflictingAdmission = makeAdmissionCandidate(
    store,
    lease,
    SINGLE_PLAN,
    lease.workflowId + ':created'
  );
  assert.throws(
    () => store._localControllerAdmit(LOCAL_CONTROLLER_STORAGE_CAPABILITY, conflictingAdmission),
    error => error.code === 'IDEMPOTENCY_CONFLICT'
  );
  assert.equal(snapshotDatabase(temporary.databasePath), initial);

  const admission = makeAdmission(store, lease, SINGLE_PLAN, '{}', 'duplicate-event:admission');
  const completion = makeCompletion(store, lease, admission, lease.workflowId + ':created');
  const beforeCompletionConflict = snapshotDatabase(temporary.databasePath);
  assert.throws(
    () => store._localControllerComplete(LOCAL_CONTROLLER_STORAGE_CAPABILITY, completion.input),
    error => error.code === 'IDEMPOTENCY_CONFLICT'
  );
  assert.equal(snapshotDatabase(temporary.databasePath), beforeCompletionConflict);
  store.close();

  const reopened = openStore(temporary.databasePath, () => 50_000);
  assert.equal(snapshotDatabase(temporary.databasePath), beforeCompletionConflict);
  assert.equal(reopened.getWorkflow(lease.workflowId).checkpointSequence, 2);
  assert.equal(reopened.getCheckpoint(lease.workflowId).data.pendingStepId, 'only');
  assert.equal(reopened.getCheckpoint(lease.workflowId).data.completedResultsJson, '{}');
  assert.equal(countRows(temporary.databasePath, 'operation_attempts'), 0);
  reopened.close();
});

function makeAdmissionCandidate(store, lease, planJson, eventId) {
  const workflowId = lease.workflowId;
  const snapshot = store._localControllerSnapshot(LOCAL_CONTROLLER_STORAGE_CAPABILITY, workflowId);
  const { limitSet, plan } = storeTestPlan({ workflowId, planJson });
  const now = store._localControllerNow(LOCAL_CONTROLLER_STORAGE_CAPABILITY);
  const budget = createBudgetSnapshot(limitSet, now, now + getLimitValues(limitSet).maxElapsedMs);
  const stepId = getNextReadyStep(plan, '{}');
  const advanced = advanceBudget(budget, 'step', now, 0, limitSet);
  return {
    workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence,
    expectedRevision: snapshot.workflow.revision,
    expectedCheckpointSequence: snapshot.checkpoint.sequence,
    stepId,
    admissionKind: 'step',
    eventId,
    controllerState: buildInitialPrivateCheckpoint({
      workflowId,
      planJson,
      plan,
      limitSet,
      baseCheckpointData: snapshot.checkpoint.data,
      budget: advanced.state,
      stepId
    })
  };
}

function makeReadOnlyRecoveryFixture(store, lease) {
  const existing = store.getCheckpoint(lease.workflowId).data;
  const first = store.recordDispatchIntent({
    ...lease,
    expectedRevision: store.getWorkflow(lease.workflowId).revision,
    attemptId: 'attempt-01-reconciled',
    logicalOperationRef: 'synthetic-logical-01',
    authorityHoldRef: 'synthetic-opaque-hold-01',
    transportAttemptId: 'synthetic-transport-01',
    eventId: 'recovery-page:first-intent'
  });
  const receipt = store.recordResponseReceipt({
    ...lease,
    expectedRevision: first.revision,
    attemptId: 'attempt-01-reconciled',
    receiptId: 'offline-fixture-receipt-01',
    outcome: 'no_effect',
    nextState: 'running',
    responseBytes: Buffer.from('offline recovery pagination fixture'),
    nextCheckpoint: existing,
    eventId: 'recovery-page:first-receipt'
  });
  const reconciled = store.reconcilePendingReceipts({
    ...lease,
    expectedRevision: receipt.revision,
    eventIdPrefix: 'recovery-page:first-reconcile'
  });
  store.recordDispatchIntent({
    ...lease,
    expectedRevision: reconciled.revision,
    attemptId: 'attempt-02-unresolved',
    logicalOperationRef: 'synthetic-logical-02',
    authorityHoldRef: 'synthetic-opaque-hold-02',
    transportAttemptId: 'synthetic-transport-02',
    eventId: 'recovery-page:second-intent'
  });
}

test('pending-attempt inspection has stable bounded keyset pages and explicit incompleteness', t => {
  const temporary = temporaryDatabase('bounded-recovery-pages-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'recovery-page-run');
  makeReadOnlyRecoveryFixture(store, lease);

  const first = inspectWorkflowRecovery({ store, workflowId: lease.workflowId, pageSize: 1 });
  assert.equal(first.kind, 'external-reconciliation-required');
  assert.equal(first.attempts.length, 1);
  assert.equal(first.attempts[0].attemptId, 'attempt-01-reconciled');
  assert.equal(first.hasMore, true);
  assert.equal(first.incomplete, true);
  assert.equal(first.nextAfterAttemptId, 'attempt-01-reconciled');
  const second = inspectWorkflowRecovery({
    store,
    workflowId: lease.workflowId,
    pageSize: 1,
    afterAttemptId: first.nextAfterAttemptId,
    workflowRevision: first.workflowRevision
  });
  assert.equal(second.kind, 'external-reconciliation-required');
  assert.equal(second.attempts.length, 1);
  assert.equal(second.attempts[0].attemptId, 'attempt-02-unresolved');
  assert.equal(second.attempts[0].state, 'intent');
  assert.equal(second.hasMore, false);
  assert.equal(second.incomplete, false);

  store.requestCancellation({
    ...lease,
    expectedRevision: store.getWorkflow(lease.workflowId).revision,
    eventId: 'recovery-page:cancel'
  });
  const staleContinuation = inspectWorkflowRecovery({
    store,
    workflowId: lease.workflowId,
    pageSize: 1,
    afterAttemptId: first.nextAfterAttemptId,
    workflowRevision: first.workflowRevision
  });
  assert.equal(staleContinuation.kind, 'stop');
  assert.equal(staleContinuation.reason, 'WORKFLOW_SNAPSHOT_CHANGED');
  assert.equal(staleContinuation.incomplete, true);
});

test('incomplete attempt pages cannot return a local recovery candidate', t => {
  const temporary = temporaryDatabase('bounded-incomplete-local-candidate-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'incomplete-local-candidate-run');
  makeAdmission(store, lease, SINGLE_PLAN, '{}', 'incomplete-local-candidate:admit');

  for (let index = 1; index <= 2; index += 1) {
    const attemptId = `incomplete-attempt-${index}`;
    const intent = store.recordDispatchIntent({
      ...lease,
      expectedRevision: store.getWorkflow(lease.workflowId).revision,
      attemptId,
      logicalOperationRef: `incomplete-logical-${index}`,
      authorityHoldRef: `incomplete-opaque-hold-${index}`,
      transportAttemptId: `incomplete-transport-${index}`,
      eventId: `incomplete-page:${index}:intent`
    });
    const receipt = store.recordResponseReceipt({
      ...lease,
      expectedRevision: intent.revision,
      attemptId,
      receiptId: `incomplete-fixture-receipt-${index}`,
      outcome: 'no_effect',
      nextState: 'running',
      responseBytes: Buffer.from(`synthetic reconciled fixture ${index}`),
      nextCheckpoint: store.getCheckpoint(lease.workflowId).data,
      eventId: `incomplete-page:${index}:receipt`
    });
    store.reconcilePendingReceipts({
      ...lease,
      expectedRevision: receipt.revision,
      eventIdPrefix: `incomplete-page:${index}:reconcile`
    });
  }

  const page = inspectWorkflowRecovery({ store, workflowId: lease.workflowId, pageSize: 1 });
  assert.equal(page.incomplete, true);
  assert.equal(page.hasMore, true);
  assert.equal(page.attempts.length, 1);
  assert.equal(page.kind, 'stop');
  assert.equal(page.reason, 'RECOVERY_INSPECTION_INCOMPLETE');
  assert.equal(page.actionable, false);
});

test('intent, unknown, and response-received attempts remain barriers with bounded evidence', async t => {
  for (const initialState of ['intent', 'outcome_unknown', 'response_received']) {
    const temporary = temporaryDatabase('bounded-external-barrier-' + initialState + '-');
    t.after(() => temporary.cleanup());
    const store = openStore(temporary.databasePath);
    t.after(() => store.close());
    const lease = createRunningWorkflow(store, 'external-barrier-' + initialState);
    const before = store.getWorkflow(lease.workflowId);
    const attemptId = 'external-barrier-attempt-' + initialState;
    const intent = store.recordDispatchIntent({
      ...lease,
      expectedRevision: before.revision,
      attemptId,
      logicalOperationRef: 'external-barrier-logical-' + initialState,
      authorityHoldRef: 'opaque-hold-must-stay-opaque',
      transportAttemptId: 'external-barrier-transport-' + initialState,
      eventId: 'external-barrier:' + initialState + ':intent'
    });
    if (initialState === 'outcome_unknown') {
      store.markOutcomeUnknown({
        ...lease,
        expectedRevision: intent.revision,
        attemptId,
        eventId: 'external-barrier:' + initialState + ':unknown'
      });
    } else if (initialState === 'response_received') {
      // This is an offline state fixture through the existing store API; it is
      // never returned by the private controller or used to settle the hold.
      store.recordResponseReceipt({
        ...lease,
        expectedRevision: intent.revision,
        attemptId,
        receiptId: 'fixture-receipt-response-received',
        outcome: 'completed',
        nextState: 'running',
        responseBytes: Buffer.from('synthetic existing-store response state'),
        nextCheckpoint: store.getCheckpoint(lease.workflowId).data,
        eventId: 'external-barrier:' + initialState + ':receipt'
      });
    }
    const atBarrier = store.getWorkflow(lease.workflowId);
    const checkpointAtBarrier = store.getCheckpoint(lease.workflowId);
    const rowsAtBarrier = {
      attempts: countRows(temporary.databasePath, 'operation_attempts'),
      receipts: countRows(temporary.databasePath, 'response_receipts')
    };

    const blocked = await runBoundedLocalPlan({
      store,
      workflowId: lease.workflowId,
      ownerId: lease.ownerId,
      fence: lease.fence,
      planJson: SINGLE_PLAN,
      limitsJson: '{"maxRecoveryAttemptStates":1}'
    });
    assert.equal(blocked.status, 'external-reconciliation-required', initialState);
    assert.equal(blocked.reason, 'EXTERNAL_OUTCOME_UNRESOLVED', initialState);
    assert.equal(store.getWorkflow(lease.workflowId).revision, atBarrier.revision, initialState);
    assert.equal(store.getCheckpoint(lease.workflowId).sha256, checkpointAtBarrier.sha256, initialState);
    assert.equal(store.getAttempt(attemptId).state, initialState, initialState);
    assert.equal(store.getAttempt(attemptId).authorityHoldRef, 'opaque-hold-must-stay-opaque', initialState);
    assert.deepEqual({
      attempts: countRows(temporary.databasePath, 'operation_attempts'),
      receipts: countRows(temporary.databasePath, 'response_receipts')
    }, rowsAtBarrier, initialState);
    assert.equal(store.listEvents({ workflowId: lease.workflowId }).some(event => event.type.startsWith('private_local_')), false);

    const inspection = inspectWorkflowRecovery({ store, workflowId: lease.workflowId, pageSize: 1 });
    assert.equal(inspection.kind, 'external-reconciliation-required', initialState);
    assert.equal(inspection.actionable, false);
    assert.equal(inspection.attempts.length, 1);
    assert.equal(inspection.attempts[0].state, initialState);
    assert.equal(inspection.attempts[0].receipt === null, initialState !== 'response_received');
    assert.equal(JSON.stringify(inspection).includes('opaque-hold-must-stay-opaque'), false);
    assert.equal(JSON.stringify(inspection).includes('synthetic existing-store response state'), false);
    assert.equal(inspection.incomplete, false);
    if (initialState === 'intent') {
      assert.equal(intent.state, 'awaiting_response');
      assert.equal(before.revision + 1, atBarrier.revision);
    }
  }
});

test('hostile controller inputs and provider-shaped outputs are quarantined without reflection', async t => {
  const temporary = temporaryDatabase('bounded-hostile-controller-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'hostile-controller-run');
  const marker = 'SYNTHETIC_RAW_RESULT_CANARY';
  let getterCalls = 0;
  const hostile = Object.defineProperty({}, 'planJson', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error(marker); }
  });
  const invalid = await runBoundedLocalPlan(hostile);
  assert.equal(invalid.reason, 'CONTROLLER_INPUT_INVALID');
  assert.equal(getterCalls, 0);
  assert.equal(JSON.stringify(invalid).includes(marker), false);

  const admission = makeAdmission(store, lease, SINGLE_PLAN, '{}', 'hostile:admit');
  let outputGetterCalls = 0;
  const providerOutput = Object.defineProperty({
    stepId: admission.stepId,
    planHash: admission.plan.planHash,
    registryVersion: admission.plan.registryVersion,
    runIdentity: admission.plan.runIdentity,
    inputHash: 'sha256_' + '1'.repeat(64),
    resultHash: 'sha256_' + '2'.repeat(64)
  }, 'output', {
    enumerable: true,
    get() { outputGetterCalls += 1; throw new Error(marker); }
  });
  assert.throws(() => buildCompletedCheckpoint(admission.state, admission.plan, providerOutput, admission.state.budget), error => {
    assert.equal(error.code, 'CONTROLLER_INPUT_INVALID');
    assert.equal(error.message.includes(marker), false);
    return true;
  });
  assert.equal(outputGetterCalls, 0);

  const result = executeLocalStep(admission.plan, admission.stepId);
  const poisoned = {
    ...result,
    providerResponse: marker,
    workflowId: 'foreign-workflow'
  };
  assert.throws(() => buildCompletedCheckpoint(admission.state, admission.plan, poisoned, admission.state.budget), error => {
    assert.equal(error.code, 'CONTROLLER_INPUT_INVALID');
    assert.equal(JSON.stringify({ code: error.code, message: error.message }).includes(marker), false);
    return true;
  });
  assert.equal(store.getCheckpoint(lease.workflowId).data.pendingStepId, admission.stepId);
  assert.equal(countRows(temporary.databasePath, 'operation_attempts'), 0);

  const completed = makeCompletion(store, lease, admission, 'hostile:completion-template');
  const workflow = store.getWorkflow(lease.workflowId);
  const checkpoint = store.getCheckpoint(lease.workflowId);
  const selfRehashed = savedResult(admission.plan, admission.stepId, { left: 4, right: 5 }, 900);
  const selfRehashedState = {
    ...completed.controllerState,
    completedResultsJson: JSON.stringify({ [admission.stepId]: selfRehashed }),
    budget: { ...completed.controllerState.budget, totalResultBytes: 3 }
  };
  assert.throws(() => store._localControllerComplete(LOCAL_CONTROLLER_STORAGE_CAPABILITY, {
    ...completed.input,
    expectedRevision: workflow.revision,
    expectedCheckpointSequence: checkpoint.sequence,
    controllerState: selfRehashedState
  }), error => error.code === 'CHECKPOINT_CORRUPT');
  assert.equal(store.getCheckpoint(lease.workflowId).sequence, checkpoint.sequence);
  const replacements = [
    ['planJson', SINGLE_PLAN.replace('"left":4', '"left":3')],
    ['registryVersion', 'registry1_' + '0'.repeat(64)]
  ];
  for (const [key, replacement] of replacements) {
    const tampered = { ...completed.controllerState, [key]: replacement };
    assert.throws(() => store._localControllerComplete(LOCAL_CONTROLLER_STORAGE_CAPABILITY, {
      workflowId: lease.workflowId,
      ownerId: lease.ownerId,
      fence: lease.fence,
      expectedRevision: workflow.revision,
      expectedCheckpointSequence: checkpoint.sequence,
      stepId: admission.stepId,
      eventId: 'hostile:tampered-' + key,
      controllerState: tampered
    }), error => error.code === 'CHECKPOINT_CORRUPT');
  }
  assert.equal(store.getCheckpoint(lease.workflowId).sequence, checkpoint.sequence);
  assert.equal(store.getCheckpoint(lease.workflowId).data.completedResultsJson, '{}');
});

test('AbortSignal proxies are not read as cancellation authority', async t => {
  const temporary = temporaryDatabase('bounded-abort-signal-input-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'abort-signal-input-run');
  const checkpointBefore = store.getCheckpoint(lease.workflowId);
  const eventsBefore = store.listEvents({ workflowId: lease.workflowId }).length;
  const abortedGetter = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get;
  assert.equal(typeof abortedGetter, 'function');

  const controller = new AbortController();
  assert.equal(abortedGetter.call(controller.signal), false);
  controller.abort();
  assert.equal(abortedGetter.call(controller.signal), true);

  let proxyReads = 0;
  const abortedSymbol = Reflect.ownKeys(controller.signal)
    .find(key => typeof key === 'symbol' && String(key) === 'Symbol(kAborted)');
  assert.equal(typeof abortedSymbol, 'symbol');
  const masked = new Proxy(controller.signal, {
    get(target, key) {
      proxyReads += 1;
      if (key === 'aborted' || key === abortedSymbol) return false;
      return Reflect.get(target, key, target);
    }
  });
  assert.equal(masked.aborted, false);
  assert.equal(abortedGetter.call(masked), false);
  const revoked = Proxy.revocable(new AbortController().signal, {});
  revoked.revoke();
  assert.throws(() => abortedGetter.call(revoked.proxy));

  const signals = [new AbortController().signal, controller.signal, masked, revoked.proxy];
  const readsAfterProbes = proxyReads;
  for (const signal of signals) {
    const result = await runBoundedLocalPlan({
      store,
      workflowId: lease.workflowId,
      ownerId: lease.ownerId,
      fence: lease.fence,
      signal
    });
    assert.equal(result.reason, 'CONTROLLER_INPUT_INVALID');
  }
  assert.equal(proxyReads, readsAfterProbes);
  assert.equal(store.getCheckpoint(lease.workflowId).sha256, checkpointBefore.sha256);
  assert.equal(store.listEvents({ workflowId: lease.workflowId }).length, eventsBefore);
});

test('private controller entrypoint is not exported and evidence never enables rollout', async () => {
  const publicApi = await import('@jevelopers/agent-harness-runtime');
  assert.equal(publicApi.runBoundedLocalPlan, undefined);
  assert.equal(publicApi.inspectWorkflowRecovery, undefined);
  assert.equal(publicApi.INJECTED_DECISION_PORT, undefined);
});

test('missing and unsupported controller checkpoints stop without adoption or writes', async t => {
  for (const checkpoint of [
    { preserved: 'generic-legacy-checkpoint' },
    { kind: 'agent-harness.private-bounded-local-checkpoint', version: 1, preserved: 'old-private-version' },
    { kind: 'agent-harness.private-bounded-local-checkpoint-foreign', version: 2, preserved: 'foreign-private-kind' }
  ]) {
    const temporary = temporaryDatabase('bounded-checkpoint-compatibility-');
    t.after(() => temporary.cleanup());
    const store = openStore(temporary.databasePath);
    t.after(() => store.close());
    const workflowId = 'compatibility-' + checkpoint.preserved;
    store.createWorkflow({ workflowId, checkpoint, eventId: workflowId + ':created' });
    const lease = store.acquireLease({ workflowId, ownerId: 'worker-compatibility', ttlMs: 60_000, eventId: workflowId + ':lease' });
    const running = store.transitionWorkflow({
      ...lease,
      expectedRevision: 0,
      toState: 'running',
      eventId: workflowId + ':running'
    });
    const checkpointBefore = store.getCheckpoint(workflowId);
    const eventsBefore = store.listEvents({ workflowId }).length;
    const result = await runBoundedLocalPlan({
      store,
      workflowId,
      ownerId: lease.ownerId,
      fence: lease.fence,
      ...(checkpoint.preserved === 'generic-legacy-checkpoint' ? {} : { planJson: SINGLE_PLAN })
    });
    assert.equal(result.status, 'stopped');
    assert.equal(result.reason, checkpoint.preserved === 'generic-legacy-checkpoint'
      ? 'PLAN_INPUT_REQUIRED'
      : 'CHECKPOINT_UNSUPPORTED');
    assert.equal(store.getWorkflow(workflowId).revision, running.revision);
    assert.equal(store.getCheckpoint(workflowId).sha256, checkpointBefore.sha256);
    assert.equal(store.listEvents({ workflowId }).length, eventsBefore);
    assert.equal(countRows(temporary.databasePath, 'operation_attempts'), 0);
  }

  const missing = temporaryDatabase('bounded-checkpoint-missing-plan-');
  t.after(() => missing.cleanup());
  const store = openStore(missing.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'missing-plan-run');
  const checkpointBefore = store.getCheckpoint(lease.workflowId);
  const result = await runBoundedLocalPlan({
    store,
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence
  });
  assert.equal(result.reason, 'PLAN_INPUT_REQUIRED');
  assert.equal(store.getCheckpoint(lease.workflowId).sha256, checkpointBefore.sha256);
});
