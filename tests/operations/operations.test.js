import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { after, test } from 'node:test';
import {
  createHmacTokenizer,
  createTelemetryExporter,
  DurableWorkflowStore,
  INTERNAL_SCHEMA_VERSION,
  TelemetryExporter,
  projectTelemetryEvent
} from '@jevelopers/agent-harness-runtime';
import { OPERATIONS_STORAGE_CAPABILITY } from '../../src/internal/private-ops-store-capability.js';
import { runtimeError } from '../../src/internal/errors.js';
import { operationsStoragePolicy, readOperationsConfig, validateLocalPlanWork } from '../../src/worker/private/config.js';
import { createOperationsWorker } from '../../src/worker/private/worker.js';
import { readStoreCompatibility, readOperationsHealth, requestOwnerRetention } from '../../src/health/private/health.js';
import { runBoundedLocalPlan } from '../../src/orchestrator/internal/controller.js';
import { buildSafeFailureDiagnostics } from './failure-diagnostics.js';

const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const PLAN = JSON.stringify({
  kind: 'agent-harness.private-synthetic-plan',
  version: 1,
  steps: [{ id: 'sum', operation: 'number.add', dependsOn: [], args: { left: 20, right: 22 } }]
});
const PLAN_TWO = JSON.stringify({
  kind: 'agent-harness.private-synthetic-plan',
  version: 1,
  steps: [{ id: 'sum', operation: 'number.add', dependsOn: [], args: { left: 21, right: 22 } }]
});
const METRICS = {
  processRuns: 0,
  processSigtermSignalsSent: 0,
  processSigintSignalsSent: 0,
  processSigkillSignalsSent: 0,
  controlledDnsResolve4: 0,
  controlledDnsResolve6: 0,
  controlledHttpsRequests: 0,
  controlledHttpsWrites: 0,
  blockedExternalNetworkAttempts: 0,
  providerCalls: 0,
  ownedRunnerStarts: 0,
  ownedRunnerTermSignals: 0,
  ownedRunnerKillSignals: 0,
  ownedRunnerShutdownElapsedMsMax: 0,
  ownedRunnerShutdownSamples: 0,
  processSigtermDrainElapsedMsMax: 0,
  processSigtermDrainSamples: 0,
  processCloseElapsedMsMax: 0,
  processCloseSamples: 0,
  runnerDeadlineCloseElapsedMsMax: 0,
  runnerDeadlineCloseSamples: 0,
  storeHighWaterBytes: 0,
  storeReservedHighWaterBytes: 0,
  databaseHighWaterBytes: 0,
  walHighWaterBytes: 0,
  shmHighWaterBytes: 0,
  freeSpaceLowWaterBytes: Number.MAX_SAFE_INTEGER,
  pendingEventHighWaterRecords: 0,
  reservedEventHighWaterSlots: 0,
  resourceHighWaterSamples: 0,
  ownedRunnerCountHighWater: 0,
  supervisorOpenFileDescriptors: 0,
  runnerOpenFileDescriptors: 0,
  maxSupervisorRssBytes: 0,
  maxRunnerRssBytes: 0
};

function tempDirectory(prefix = 'ah11-ops-') {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  return {
    directory,
    databasePath: join(directory, 'workflow.sqlite'),
    cleanup() { rmSync(directory, { recursive: true, force: true }); }
  };
}

function openStore(databasePath, options = {}) {
  const store = DurableWorkflowStore.open({ databasePath, busyTimeoutMs: 20, ...options });
  const config = readOperationsConfig();
  store._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, {
    maxStoreBytes: config.maxStoreBytes,
    maxWalBytes: config.maxWalBytes,
    minFreeDiskBytes: config.minFreeDiskBytes
  });
  return store;
}

function admit(store, tenantId, projectId, idempotencyKey, work = PLAN, configInput = undefined) {
  const config = readOperationsConfig(configInput);
  const validated = validateLocalPlanWork({ planJson: work, limitsJson: '{}' }, 'ops-validation-workflow', config);
  return store._operationsAdmit(OPERATIONS_STORAGE_CAPABILITY, {
    tenantId,
    projectId,
    idempotencyKey,
    workJson: validated.workJson,
    policy: operationsStoragePolicy(config)
  });
}

function recoverySnapshot(databasePath, jobId, nextJobId, workflowId, attemptId) {
  const raw = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const work = raw.prepare(`SELECT tenant_id, project_id, state, worker_id, runner_pid,
      generation, fence_token, lease_expires_ms, work_bytes,
      reserved_event_slots, reserved_disk_bytes, reason_code
      FROM operations_work WHERE job_id=?`).get(jobId);
    const nextWork = raw.prepare(`SELECT state, worker_id, generation, fence_token, work_bytes,
      reserved_event_slots, reserved_disk_bytes
      FROM operations_work WHERE job_id=?`).get(nextJobId);
    const workflow = raw.prepare(`SELECT state, revision, fence_token, cancellation_requested,
      lease_owner, lease_expires_ms FROM workflows WHERE workflow_id=?`).get(workflowId);
    const meta = raw.prepare(`SELECT pending_records, pending_bytes, in_flight,
      reserved_event_slots, reserved_disk_bytes FROM operations_meta WHERE singleton=1`).get();
    const tenant = raw.prepare(`SELECT pending_records, in_flight FROM operations_tenants WHERE tenant_id=?`)
      .get(work.tenant_id);
    const nextTenant = raw.prepare(`SELECT pending_records, in_flight FROM operations_tenants WHERE tenant_id=?`)
      .get('public-next-tenant');
    const project = raw.prepare(`SELECT pending_records, in_flight FROM operations_projects
      WHERE tenant_id=? AND project_id=?`).get(work.tenant_id, work.project_id);
    const attempt = attemptId === null ? null : raw.prepare(`SELECT state, authority_hold_ref
      FROM operation_attempts WHERE attempt_id=?`).get(attemptId) ?? null;
    const events = Object.fromEntries(raw.prepare(`SELECT event_type, COUNT(*) AS count
      FROM workflow_events WHERE workflow_id=? GROUP BY event_type ORDER BY event_type`)
      .all(workflowId).map(row => [row.event_type, Number(row.count)]));
    const allWork = raw.prepare(`SELECT job_id, tenant_id, project_id, state, worker_id, runner_pid,
      generation, fence_token, lease_expires_ms, work_bytes, reserved_event_slots, reserved_disk_bytes
      FROM operations_work ORDER BY job_id`).all().map(row => ({ ...row,
      generation: Number(row.generation), fence_token: row.fence_token === null ? null : Number(row.fence_token),
      lease_expires_ms: row.lease_expires_ms === null ? null : Number(row.lease_expires_ms),
      work_bytes: Number(row.work_bytes), reserved_event_slots: Number(row.reserved_event_slots),
      reserved_disk_bytes: Number(row.reserved_disk_bytes) }));
    const allTenants = raw.prepare(`SELECT tenant_id, pending_records, pending_bytes, in_flight
      FROM operations_tenants ORDER BY tenant_id`).all().map(row => ({ ...row,
      pending_records: Number(row.pending_records), pending_bytes: Number(row.pending_bytes),
      in_flight: Number(row.in_flight) }));
    const allProjects = raw.prepare(`SELECT tenant_id, project_id, pending_records, pending_bytes, in_flight
      FROM operations_projects ORDER BY tenant_id, project_id`).all().map(row => ({ ...row,
      pending_records: Number(row.pending_records), pending_bytes: Number(row.pending_bytes),
      in_flight: Number(row.in_flight) }));
    const reservationTotals = raw.prepare(`SELECT
      (SELECT SUM(reserved_disk_bytes) FROM operations_work) AS work_disk,
      (SELECT SUM(reserved_event_slots) FROM operations_work) AS work_events`).get();
    return {
      work: { ...work, generation: Number(work.generation), fence_token: Number(work.fence_token),
        lease_expires_ms: work.lease_expires_ms === null ? null : Number(work.lease_expires_ms),
        work_bytes: Number(work.work_bytes),
        reserved_event_slots: Number(work.reserved_event_slots), reserved_disk_bytes: Number(work.reserved_disk_bytes) },
      nextWork: { ...nextWork, generation: Number(nextWork.generation), fence_token: Number(nextWork.fence_token),
        work_bytes: Number(nextWork.work_bytes),
        reserved_event_slots: Number(nextWork.reserved_event_slots), reserved_disk_bytes: Number(nextWork.reserved_disk_bytes) },
      workflow: { ...workflow, revision: Number(workflow.revision), fence_token: Number(workflow.fence_token),
        lease_expires_ms: workflow.lease_expires_ms === null ? null : Number(workflow.lease_expires_ms) },
      meta: { ...meta, pending_records: Number(meta.pending_records), pending_bytes: Number(meta.pending_bytes),
        in_flight: Number(meta.in_flight), reserved_event_slots: Number(meta.reserved_event_slots),
        reserved_disk_bytes: Number(meta.reserved_disk_bytes) },
      tenant: { ...tenant, pending_records: Number(tenant.pending_records), in_flight: Number(tenant.in_flight) },
      nextTenant: { ...nextTenant, pending_records: Number(nextTenant.pending_records), in_flight: Number(nextTenant.in_flight) },
      project: { ...project, pending_records: Number(project.pending_records), in_flight: Number(project.in_flight) },
      attempt: attempt ? { ...attempt } : null,
      events,
      allWork,
      allTenants,
      allProjects,
      reservationTotals: { work_disk: Number(reservationTotals.work_disk), work_events: Number(reservationTotals.work_events) }
    };
  } finally {
    raw.close();
  }
}

async function assertUnknownRecoveryFailsClosedAtResourceBoundary() {
  const directory = tempDirectory('ah11-unknown-recovery-resource-floor-');
  const configInput = {
    workerCount: 1, maxInFlightGlobal: 1, maxInFlightTenant: 1, maxInFlightProject: 1
  };
  const config = readOperationsConfig(configInput);
  const policy = operationsStoragePolicy(config);
  let now = 120_000;
  let store = openStore(directory.databasePath, { clock: () => now });
  try {
    const expired = admit(store, 'public-expired-tenant', 'public-expired-project',
      'resource-floor-expired', PLAN, configInput);
    const next = admit(store, 'public-next-tenant', 'public-next-project',
      'resource-floor-next', PLAN, configInput);
    const later = admit(store, 'public-next-tenant', 'public-later-project',
      'resource-floor-later', PLAN, configInput);
    const prior = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'resource-floor-prior-owner', policy
    }).claim;
    assert.equal(prior.jobId, expired.jobId);
    store.close();
    store = null;
    const attemptId = 'resource-floor-attempt';
    const holdRef = 'resource-floor-synthetic-hold';
    crashAfterPublicWorkflowMutation(directory.databasePath, {
      mutation: 'unknown', now, workflowId: prior.workflowId, ownerId: prior.ownerId,
      fence: prior.fence, revision: prior.revision, attemptId, holdRef
    });
    now = prior.leaseExpiresAtMs + 1;
    const beforeFailure = recoverySnapshot(directory.databasePath, expired.jobId, next.jobId,
      expired.workflowId, attemptId);
    assert.equal(beforeFailure.meta.reserved_disk_bytes, beforeFailure.reservationTotals.work_disk);
    assert.ok(beforeFailure.meta.reserved_disk_bytes > 16_777_216,
      'three accepted jobs reserve more than the minimum permitted store ceiling');
    assert.equal(beforeFailure.allWork.find(row => row.job_id === later.jobId).state, 'queued');

    let restricted = openStore(directory.databasePath, { clock: () => now });
    try {
      restricted._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, {
        maxStoreBytes: 16_777_216,
        maxWalBytes: config.maxWalBytes,
        minFreeDiskBytes: config.minFreeDiskBytes
      });
      assert.throws(() => restricted._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
        ownerId: 'resource-floor-failing-recovery', policy, recoverableJobIds: [expired.jobId]
      }), error => error.code === 'STORE_WRITE_FAILED');
      assert.deepEqual(recoverySnapshot(directory.databasePath, expired.jobId, next.jobId,
        expired.workflowId, attemptId), beforeFailure,
      'capacity refusal must roll back workflow, work, events, counters, and every reservation');
    } finally {
      restricted.close();
      restricted = null;
    }

    const retry = openStore(directory.databasePath, { clock: () => now });
    let stillQueuedJob;
    try {
      const recovered = retry._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
        ownerId: 'resource-floor-retry-owner', policy, recoverableJobIds: [expired.jobId]
      });
      assert.ok([next.jobId, later.jobId].includes(recovered.claim?.jobId));
      stillQueuedJob = recovered.claim.jobId === next.jobId ? later : next;
      const afterRetry = recoverySnapshot(directory.databasePath, expired.jobId, recovered.claim.jobId,
        expired.workflowId, attemptId);
      assert.equal(afterRetry.work.state, 'unknown');
      assert.equal(afterRetry.attempt.state, 'outcome_unknown');
      assert.equal(afterRetry.attempt.authority_hold_ref, holdRef);
      assert.equal(afterRetry.allWork.find(row => row.job_id === stillQueuedJob.jobId).state, 'queued');
      assert.equal(afterRetry.meta.pending_records, 3);
      assert.equal(afterRetry.meta.in_flight, 1);
      assert.equal(afterRetry.meta.reserved_disk_bytes, afterRetry.reservationTotals.work_disk);
      assert.equal(afterRetry.meta.reserved_event_slots, afterRetry.reservationTotals.work_events);
      assert.equal(afterRetry.events.operations_work_unknown, 1);
      assert.equal(retry._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
        ownerId: 'resource-floor-repeated-recovery', policy, recoverableJobIds: [expired.jobId]
      }), null);
      assert.deepEqual(recoverySnapshot(directory.databasePath, expired.jobId, recovered.claim.jobId,
        expired.workflowId, attemptId), afterRetry,
      'a repeated recovery does not charge capacity or duplicate the durable unknown event');
    } finally {
      retry.close();
    }
    const independentlyReopened = openStore(directory.databasePath, { clock: () => now });
    try {
      assert.equal(independentlyReopened._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
        tenantId: 'public-expired-tenant', projectId: 'public-expired-project', jobId: expired.jobId
      }).state, 'unknown');
      assert.equal(independentlyReopened.getAttempt(attemptId).authorityHoldRef, holdRef);
      assert.equal(independentlyReopened._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
        tenantId: 'public-next-tenant',
        projectId: stillQueuedJob.jobId === later.jobId ? 'public-later-project' : 'public-next-project',
        jobId: stillQueuedJob.jobId
      }).state, 'queued');
    } finally {
      independentlyReopened.close();
    }
  } finally {
    try { store?.close(); } catch {}
    directory.cleanup();
  }
}

function crashAfterPublicWorkflowMutation(databasePath, payload) {
  const source = `
import { writeSync } from 'node:fs';
import { DurableWorkflowStore } from '@jevelopers/agent-harness-runtime';
const [databasePath, payloadText] = process.argv.slice(1);
const input = JSON.parse(payloadText);
const store = DurableWorkflowStore.open({ databasePath, busyTimeoutMs: 20, clock: () => input.now });
const lease = { workflowId: input.workflowId, ownerId: input.ownerId, fence: input.fence };
let result;
if (input.mutation === 'unknown' || input.mutation === 'intent') {
  const intent = store.recordDispatchIntent({ ...lease, expectedRevision: input.revision,
    attemptId: input.attemptId, logicalOperationRef: input.attemptId + '-logical',
    authorityHoldRef: input.holdRef, transportAttemptId: input.attemptId + '-transport',
    eventId: input.attemptId + '-intent' });
  result = input.mutation === 'intent' ? intent : store.markOutcomeUnknown({ ...lease,
    expectedRevision: intent.revision, attemptId: input.attemptId, eventId: input.attemptId + '-unknown' });
} else if (input.mutation === 'succeeded' || input.mutation === 'failed') {
  result = store.transitionWorkflow({ ...lease, expectedRevision: input.revision,
    toState: input.mutation, eventId: input.attemptId + '-transition' });
} else if (input.mutation === 'cancelled') {
  result = store.requestCancellation({ ...lease, expectedRevision: input.revision,
    eventId: input.attemptId + '-cancel' });
} else {
  throw new Error('unsupported synthetic workflow mutation');
}
writeSync(1, JSON.stringify({ mutation: input.mutation, result }) + '\\n');
process.kill(process.pid, 'SIGKILL');
`;
  METRICS.processRuns += 1;
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', source,
    databasePath, JSON.stringify(payload)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 8_000,
    env: baseEnvironment()
  });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  assert.equal(child.status, null);
  METRICS.processSigkillSignalsSent += 1;
  const lines = child.stdout.trim().split(/\r?\n/u);
  assert.equal(lines.length, 1, child.stderr);
  return JSON.parse(lines[0]);
}

async function assertExpiredCurrentFenceReconciles(t, {
  caseName,
  mutation,
  expectedWorkflowState,
  expectedWorkflowStateAfterRecovery = expectedWorkflowState,
  expectedWorkState,
  expectedEventType,
  expectedAttemptState = null,
  afterRecovery
}) {
  const directory = tempDirectory('ah11-public-expired-reconciliation-');
  const configInput = {
    workerCount: 1, maxInFlightGlobal: 1, maxInFlightTenant: 1, maxInFlightProject: 1
  };
  const policy = operationsStoragePolicy(readOperationsConfig(configInput));
  let now = 110_000;
  let store = openStore(directory.databasePath, { clock: () => now });
  try {
    const expired = admit(store, 'public-expired-tenant', 'public-expired-project', `${caseName}-expired`, PLAN, configInput);
    const prior = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: `${caseName}-prior-owner`, policy
    }).claim;
    assert.equal(prior.jobId, expired.jobId);
    const queued = admit(store, 'public-next-tenant', 'public-next-project', `${caseName}-queued`, PLAN, configInput);
    store.close();
    store = null;
    const attemptId = mutation === 'unknown' || mutation === 'intent' ? `${caseName}-attempt` : null;
    const holdRef = attemptId ? `${caseName}-synthetic-hold` : null;
    const mutationResult = crashAfterPublicWorkflowMutation(directory.databasePath, {
      mutation, now, workflowId: prior.workflowId, ownerId: prior.ownerId,
      fence: prior.fence, revision: prior.revision, attemptId, holdRef
    });
    assert.equal(mutationResult.mutation, mutation);
    if (mutation === 'cancelled') {
      assert.equal(mutationResult.result.accepted, true);
      assert.equal(mutationResult.result.state, 'cancelled');
    }
    const beforeRecovery = recoverySnapshot(directory.databasePath, expired.jobId, queued.jobId,
      expired.workflowId, attemptId);
    assert.equal(beforeRecovery.work.state, 'running');
    assert.equal(beforeRecovery.work.worker_id, prior.ownerId);
    assert.equal(beforeRecovery.work.generation, prior.generation);
    assert.equal(beforeRecovery.work.fence_token, prior.fence);
    assert.equal(beforeRecovery.work.lease_expires_ms, prior.leaseExpiresAtMs);
    assert.equal(beforeRecovery.workflow.state, expectedWorkflowState);
    assert.equal(beforeRecovery.workflow.fence_token, prior.fence);
    assert.equal(beforeRecovery.meta.pending_records, 2);
    assert.equal(beforeRecovery.meta.pending_bytes, beforeRecovery.work.work_bytes + beforeRecovery.nextWork.work_bytes);
    assert.equal(beforeRecovery.meta.in_flight, 1);
    assert.equal(beforeRecovery.tenant.pending_records, 1);
    assert.equal(beforeRecovery.tenant.in_flight, 1);
    assert.equal(beforeRecovery.project.pending_records, 1);
    assert.equal(beforeRecovery.nextTenant.in_flight, 0);
    assert.equal(beforeRecovery.nextWork.state, 'queued');
    assert.ok(beforeRecovery.work.reserved_disk_bytes > 0);
    assert.ok(beforeRecovery.work.reserved_event_slots > 0);
    assert.equal(beforeRecovery.meta.reserved_disk_bytes, beforeRecovery.reservationTotals.work_disk);
    assert.equal(beforeRecovery.meta.reserved_event_slots, beforeRecovery.reservationTotals.work_events);
    if (mutation === 'cancelled') {
      assert.equal(beforeRecovery.workflow.lease_owner, null, 'the public cancellation API must clear the workflow lease');
      assert.equal(beforeRecovery.workflow.lease_expires_ms, null);
    } else {
      assert.equal(beforeRecovery.workflow.lease_owner, prior.ownerId);
      assert.equal(beforeRecovery.workflow.lease_expires_ms, prior.leaseExpiresAtMs);
    }
    if (attemptId) {
      assert.deepEqual(beforeRecovery.attempt, {
        state: mutation === 'unknown' ? 'outcome_unknown' : 'intent', authority_hold_ref: holdRef
      });
    }
    now = prior.leaseExpiresAtMs + 1;
    let reopened = openStore(directory.databasePath, { clock: () => now });
    const expiredClaims = reopened._operationsExpiredClaims(OPERATIONS_STORAGE_CAPABILITY, { policy });
    assert.equal(expiredClaims.incomplete, false);
    assert.equal(expiredClaims.items[0].jobId, expired.jobId);
    try {
      const recovery = reopened._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
        ownerId: `${caseName}-recovery-owner`, policy, recoverableJobIds: [expired.jobId]
      });
      assert.equal(recovery.claim?.jobId, queued.jobId,
        'reconciliation must release only the expired generation before the next tenant claims');

      const workflow = reopened.getWorkflow(expired.workflowId);
      assert.equal(workflow.state, expectedWorkflowStateAfterRecovery);
      assert.equal(workflow.fence, prior.fence);
      if (expectedAttemptState) {
        assert.equal(workflow.cancellationRequested, false);
        const attempt = reopened.getAttempt(attemptId);
        assert.equal(attempt.state, expectedAttemptState);
        assert.equal(attempt.authorityHoldRef, holdRef);
      }
      const recoveredSnapshot = recoverySnapshot(directory.databasePath, expired.jobId, queued.jobId,
        expired.workflowId, attemptId);
      assert.equal(recoveredSnapshot.work.state, expectedWorkState);
      assert.equal(recoveredSnapshot.work.worker_id, null);
      assert.equal(recoveredSnapshot.work.runner_pid, null);
      assert.equal(recoveredSnapshot.work.lease_expires_ms, null);
      assert.equal(recoveredSnapshot.work.generation, prior.generation);
      assert.equal(recoveredSnapshot.work.fence_token, prior.fence);
      assert.equal(recoveredSnapshot.workflow.state, expectedWorkflowStateAfterRecovery);
      assert.equal(recoveredSnapshot.workflow.lease_owner, null);
      assert.equal(recoveredSnapshot.workflow.lease_expires_ms, null);
      assert.equal(recoveredSnapshot.nextWork.state, 'running');
      assert.equal(recoveredSnapshot.nextWork.worker_id, recovery.claim.ownerId);
      const unresolved = expectedWorkState === 'unknown';
      const expectedPending = unresolved ? 2 : 1;
      assert.equal(recoveredSnapshot.meta.pending_records, expectedPending);
      assert.equal(recoveredSnapshot.meta.pending_bytes, unresolved
        ? beforeRecovery.meta.pending_bytes
        : beforeRecovery.meta.pending_bytes - beforeRecovery.work.work_bytes);
      assert.equal(recoveredSnapshot.meta.in_flight, 1);
      assert.equal(recoveredSnapshot.tenant.pending_records, unresolved ? 1 : 0);
      assert.equal(recoveredSnapshot.tenant.in_flight, 0);
      assert.equal(recoveredSnapshot.project.pending_records, unresolved ? 1 : 0);
      assert.equal(recoveredSnapshot.nextTenant.in_flight, 1);
      assert.equal(recoveredSnapshot.project.in_flight, 0);
      assert.equal(recoveredSnapshot.meta.reserved_disk_bytes, recoveredSnapshot.reservationTotals.work_disk);
      assert.equal(recoveredSnapshot.meta.reserved_event_slots, recoveredSnapshot.reservationTotals.work_events);
      if (unresolved) {
        assert.equal(recoveredSnapshot.work.reserved_disk_bytes,
          beforeRecovery.work.reserved_disk_bytes - 16_384,
          'clearing the expired workflow lease consumes one bounded lifecycle-write reserve');
        assert.equal(recoveredSnapshot.work.reserved_event_slots, beforeRecovery.work.reserved_event_slots - 1,
          'the durable unknown event consumes one reserved event slot while the opaque hold remains');
        assert.equal(recoveredSnapshot.nextWork.reserved_disk_bytes,
          beforeRecovery.nextWork.reserved_disk_bytes - 16_384,
          'the queued tenant claim consumes its own lifecycle-write reserve');
        assert.equal(recoveredSnapshot.nextWork.reserved_event_slots,
          beforeRecovery.nextWork.reserved_event_slots - 1,
          'the next claim event consumes its own reserved slot');
        assert.equal(recoveredSnapshot.meta.reserved_disk_bytes,
          beforeRecovery.meta.reserved_disk_bytes
            - (beforeRecovery.work.reserved_disk_bytes - recoveredSnapshot.work.reserved_disk_bytes)
            - (beforeRecovery.nextWork.reserved_disk_bytes - recoveredSnapshot.nextWork.reserved_disk_bytes));
        assert.equal(recoveredSnapshot.meta.reserved_event_slots,
          beforeRecovery.meta.reserved_event_slots
            - (beforeRecovery.work.reserved_event_slots - recoveredSnapshot.work.reserved_event_slots)
            - (beforeRecovery.nextWork.reserved_event_slots - recoveredSnapshot.nextWork.reserved_event_slots));
        assert.equal(recoveredSnapshot.attempt.authority_hold_ref, holdRef);
      } else {
        assert.equal(recoveredSnapshot.work.reserved_disk_bytes, 0);
        assert.equal(recoveredSnapshot.work.reserved_event_slots, 0);
      }
      assert.equal(recoveredSnapshot.events[expectedEventType] ?? 0, (beforeRecovery.events[expectedEventType] ?? 0) + 1);
      assert.equal(Object.values(recoveredSnapshot.events).reduce((sum, value) => sum + value, 0),
        Object.values(beforeRecovery.events).reduce((sum, value) => sum + value, 0) + 1,
        'recovery appends exactly one workflow event');
      reopened.close();

      const independentlyReopened = openStore(directory.databasePath, { clock: () => now });
      try {
        assert.equal(independentlyReopened._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
          tenantId: 'public-expired-tenant', projectId: 'public-expired-project', jobId: expired.jobId
        }).state, expectedWorkState);
        assert.equal(independentlyReopened.getWorkflow(expired.workflowId).state, expectedWorkflowStateAfterRecovery);
        assert.deepEqual(recoverySnapshot(directory.databasePath, expired.jobId, queued.jobId,
          expired.workflowId, attemptId), recoveredSnapshot, 'a second independent reopen must preserve the reconciled snapshot');
        assert.equal(independentlyReopened._operationsExpiredClaims(OPERATIONS_STORAGE_CAPABILITY, { policy }).items.length, 0);
        assert.equal(independentlyReopened._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
          ownerId: `${caseName}-repeat-recovery`, policy, recoverableJobIds: [expired.jobId]
        }), null, 'repeated recovery cannot duplicate terminal/unknown events or bypass occupied caps');
        if (expectedAttemptState) {
          assert.equal(independentlyReopened.getAttempt(attemptId).authorityHoldRef, holdRef);
        }
      } finally {
        independentlyReopened.close();
      }
      await afterRecovery?.({ databasePath: directory.databasePath, caseName, expired, queued, prior, now, attemptId, holdRef });
    } finally {
      try { reopened.close(); } catch {}
    }
  } finally {
    try { store?.close(); } catch {}
    directory.cleanup();
  }
}

function planAtWorkByteLength(targetBytes, seedPlan = PLAN, configInput = undefined) {
  const config = readOperationsConfig(configInput);
  const initial = validateLocalPlanWork({ planJson: seedPlan, limitsJson: '{}' }, 'ops-validation-workflow', config);
  const paddingBytes = targetBytes - initial.bytes;
  assert.ok(paddingBytes >= 0, 'The selected work shape must fit below the requested boundary.');
  const padded = validateLocalPlanWork({
    planJson: seedPlan + ' '.repeat(paddingBytes), limitsJson: '{}'
  }, 'ops-validation-workflow', config);
  assert.equal(padded.bytes, targetBytes);
  return padded;
}

async function runChild(script, args, { timeoutMs = 8_000, env = {} } = {}) {
  METRICS.processRuns += 1;
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        TMPDIR: process.env.TMPDIR ?? '/tmp',
        NODE_NO_WARNINGS: '1',
        ...env
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => {
      try {
        if (child.kill('SIGKILL')) METRICS.processSigkillSignalsSent += 1;
      } catch {}
      reject(new Error(`Owned test process exceeded ${timeoutMs} ms.`));
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ child, code, signal, stdout, stderr });
    });
  });
}

function startOwnedChild(script, args, { timeoutMs = 8_000, env = {} } = {}) {
  METRICS.processRuns += 1;
  const child = spawn(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      TMPDIR: process.env.TMPDIR ?? '/tmp',
      NODE_NO_WARNINGS: '1',
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = new Promise(resolvePromise => {
    child.once('error', error => resolvePromise({ child, error, code: null, signal: null, stdout, stderr }));
    child.once('close', (code, signal) => resolvePromise({ child, code, signal, stdout, stderr }));
  });
  const timeout = setTimeout(() => {
    try {
      if (child.kill('SIGKILL')) METRICS.processSigkillSignalsSent += 1;
    } catch {}
  }, timeoutMs);
  void closed.then(() => clearTimeout(timeout));
  return { child, closed };
}

async function waitForPath(path, child, timeoutMs = 6_000) {
  const end = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`The owned fixture exited before its barrier (exit=${child.exitCode}; signal=${child.signalCode}).`);
    }
    if (Date.now() >= end) throw new Error('The owned fixture did not reach its barrier.');
    await new Promise(resolvePromise => setTimeout(resolvePromise, 5));
  }
}

async function waitForCloseBounded(closed, timeoutMs) {
  let timer;
  const timeout = new Promise(resolvePromise => {
    timer = setTimeout(() => resolvePromise(null), timeoutMs);
  });
  const closeResult = await Promise.race([closed, timeout]);
  clearTimeout(timer);
  return closeResult;
}

function ownedProcessGroupMembers(groupId) {
  const result = spawnSync('pgrep', ['-g', String(groupId)], { encoding: 'utf8' });
  if (result.status === 1) return [];
  if (result.status !== 0) throw new Error('The isolated fixture process group could not be inspected.');
  return result.stdout.trim().split(/\s+/u).filter(Boolean).map(Number);
}

async function waitForOwnedProcessGroupEmpty(groupId, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (ownedProcessGroupMembers(groupId).length === 0) return true;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
  }
  return ownedProcessGroupMembers(groupId).length === 0;
}

async function cleanupOwnedProcessGroup(child, closed) {
  if (!Number.isSafeInteger(child.pid) || child.pid < 2) return false;
  const groupId = child.pid;
  try { process.kill(-groupId, 'SIGCONT'); } catch {}
  try { process.kill(-groupId, 'SIGTERM'); } catch {}
  await waitForCloseBounded(closed, 1_000);
  if (await waitForOwnedProcessGroupEmpty(groupId, 1_000)) return true;
  try { process.kill(-groupId, 'SIGCONT'); } catch {}
  try { process.kill(-groupId, 'SIGKILL'); } catch {}
  await waitForCloseBounded(closed, 1_000);
  return waitForOwnedProcessGroupEmpty(groupId, 1_000);
}

function readRunnerPidFromOwnedDatabase(databasePath, idempotencyKey) {
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = database.prepare(
        'SELECT runner_pid FROM operations_work WHERE idempotency_key=?'
      ).get(idempotencyKey);
      return Number.isSafeInteger(Number(row?.runner_pid)) && Number(row.runner_pid) > 1
        ? Number(row.runner_pid) : null;
    } finally {
      database.close();
    }
  } catch {
    return null;
  }
}

function processGroupId(pid) {
  const result = spawnSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const value = Number(result.stdout.trim());
  return Number.isSafeInteger(value) && value > 1 ? value : null;
}

async function waitForPidExit(pid, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { process.kill(pid, 0); } catch (error) {
      if (error?.code === 'ESRCH') return true;
      throw error;
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
  }
  try { process.kill(pid, 0); } catch (error) { return error?.code === 'ESRCH'; }
  return false;
}

async function killOwnedChildAndReap(child, closed) {
  let sent = false;
  try { sent = child.kill('SIGKILL'); } catch {}
  if (sent) METRICS.processSigkillSignalsSent += 1;
  let closeResult = await waitForCloseBounded(closed, 1_000);
  if (!closeResult && child.exitCode === null && child.signalCode === null) {
    try {
      if (child.kill('SIGKILL')) METRICS.processSigkillSignalsSent += 1;
    } catch {}
    closeResult = await waitForCloseBounded(closed, 1_000);
  }
  return closeResult;
}

async function waitForStatus(worker, scope, jobId, expected, timeoutMs = 6_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const page = worker.readScopedWorkPage({ trustedSyntheticScope: scope, limit: 100 });
    const item = page.items.find(row => row.jobId === jobId);
    if (item?.state === expected) return item;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
  }
  throw new Error(`The durable job did not reach ${expected}.`);
}

function baseEnvironment() {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', TMPDIR: process.env.TMPDIR ?? '/tmp', NODE_NO_WARNINGS: '1' };
}

function unusedProcessId() {
  for (let candidate = 2_000_000_000; candidate < 2_000_001_000; candidate += 1) {
    try {
      process.kill(candidate, 0);
    } catch (error) {
      if (error?.code === 'ESRCH') return candidate;
    }
  }
  throw new Error('The fixture could not find an unused process identifier.');
}

function countOpenFileDescriptors(pid) {
  if (process.platform === 'linux') {
    try { return readdirSync(`/proc/${pid}/fd`).length; } catch { return null; }
  }
  if (process.platform !== 'darwin') return null;
  const result = spawnSync('/usr/sbin/lsof', ['-nP', '-p', String(pid), '-Fn'], { encoding: 'utf8', maxBuffer: 1_048_576 });
  if (result.status !== 0) return null;
  return result.stdout.split(/\r?\n/u).filter(line => /^f[^n]/u.test(line)).length;
}

test('OPS01_CONFIG_HOSTILE rejects hostile option/job objects before getters, traps, or serialization run', async t => {
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, 'mode', { enumerable: true, get() { getterCalls += 1; return 'mock'; } });
  assert.throws(() => readOperationsConfig(accessor), /configuration/u);
  assert.equal(getterCalls, 0);

  let proxyTrapCalls = 0;
  const proxy = new Proxy({}, { ownKeys() { proxyTrapCalls += 1; throw new Error('canary'); } });
  assert.throws(() => readOperationsConfig(proxy), /configuration/u);
  assert.equal(proxyTrapCalls, 0);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.throws(() => readOperationsConfig(revoked.proxy), /configuration/u);
  assert.throws(() => readOperationsConfig({ mode: 'live' }), /mock/u);

  let stringifyCalls = 0;
  const hostileConfig = { mode: 'mock', toJSON() { stringifyCalls += 1; return {}; } };
  assert.throws(() => readOperationsConfig(hostileConfig), /configuration/u);
  assert.equal(stringifyCalls, 0);
  assert.throws(() => validateLocalPlanWork({ planJson: '{"kind":"x","kind":"y"}', limitsJson: '{}' }, 'x'));
  assert.equal(INTERNAL_SCHEMA_VERSION, 6);

  const boundary = readOperationsConfig({ maxJobBytes: 65_536 });
  assert.equal(boundary.maxJobBytes, 65_536);
  assert.throws(() => readOperationsConfig({ maxJobBytes: 65_537 }), /configuration/u);

  awaitTestCase();
  function awaitTestCase() {
    // Kept synchronous so hostile values are rejected before any persistence API exists.
    const symbolConfig = { maxJobBytes: 36_864 };
    symbolConfig[Symbol('private-marker')] = 'must-not-be-reflected';
    assert.throws(() => readOperationsConfig(symbolConfig), /configuration/u);
    const cyclic = { mode: 'mock' };
    cyclic.self = cyclic;
    assert.throws(() => readOperationsConfig(cyclic), /configuration/u);
    const deeplyNested = { maxJobBytes: 36_864, extension: { nested: { value: 1 } } };
    assert.throws(() => readOperationsConfig(deeplyNested), /configuration/u);
  }

  await t.test('OPS01.C01 accepts the exact UTF-8 work limit and rejects one byte over before admission', () => {
    const exactPlan = PLAN + ' '.repeat(32_768 - Buffer.byteLength(PLAN, 'utf8'));
    assert.equal(Buffer.byteLength(exactPlan, 'utf8'), 32_768);
    assert.ok(validateLocalPlanWork({ planJson: exactPlan, limitsJson: '{}' }, 'ops01-boundary').bytes > 0);
    assert.throws(() => validateLocalPlanWork({ planJson: `${exactPlan} `, limitsJson: '{}' }, 'ops01-over-boundary'));
  });

  await t.test('OPS01.C02 rejects unsafe counters and hostile job/health records before side effects', async t => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => readOperationsConfig({ maxQueueRecords: value }), /configuration/u);
    }
    assert.throws(() => readOperationsConfig({ unrecognizedLimit: 1 }), /configuration/u);
    const symbolic = { maxQueueRecords: 2 };
    symbolic[Symbol('private-marker')] = 'must-not-be-copied';
    assert.throws(() => readOperationsConfig(symbolic), /configuration/u);

    let workGetterCalls = 0;
    const accessorWork = {};
    Object.defineProperty(accessorWork, 'planJson', {
      enumerable: true, get() { workGetterCalls += 1; return PLAN; }
    });
    assert.throws(() => validateLocalPlanWork(accessorWork, 'ops01-hostile-work'));
    const revokedWork = Proxy.revocable({ planJson: PLAN }, {});
    revokedWork.revoke();
    assert.throws(() => validateLocalPlanWork(revokedWork.proxy, 'ops01-revoked-work'));
    let workToJsonCalls = 0;
    assert.throws(() => validateLocalPlanWork({ planJson: PLAN, toJSON() { workToJsonCalls += 1; return {}; } }, 'ops01-json-work'));
    assert.equal(workGetterCalls, 0);
    assert.equal(workToJsonCalls, 0);

    const hostileDir = tempDirectory('ah11-hostile-health-record-');
    t.after(() => hostileDir.cleanup());
    const hostileWorker = createOperationsWorker({ databasePath: hostileDir.databasePath, ownerId: 'review-worker-hostile-health' });
    t.after(async () => { if (hostileWorker.lifecycle !== 'stopped') await hostileWorker.stop('test'); });
    void hostileWorker.start();
    let healthGetterCalls = 0;
    const hostileHealth = {};
    Object.defineProperty(hostileHealth, 'heartbeatAgeMs', {
      enumerable: true, get() { healthGetterCalls += 1; return 0; }
    });
    assert.throws(() => readOperationsHealth(hostileHealth), /health input/u);
    const revokedHealth = Proxy.revocable({}, {});
    revokedHealth.revoke();
    assert.throws(() => readOperationsHealth(revokedHealth.proxy), /health input/u);
    let requestGetterCalls = 0;
    const hostileRequest = {};
    Object.defineProperty(hostileRequest, 'trustedSyntheticScope', {
      enumerable: true, get() { requestGetterCalls += 1; return { tenantId: 'forged', projectId: 'forged' }; }
    });
    assert.throws(() => hostileWorker.submitSyntheticWork(hostileRequest), /operations request/u);
    assert.equal(healthGetterCalls, 0);
    assert.equal(requestGetterCalls, 0);
    const check = new DatabaseSync(hostileDir.databasePath, { readOnly: true });
    assert.equal(Number(check.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count), 0);
    assert.equal(Number(check.prepare('SELECT pending_records FROM operations_meta WHERE singleton=1').get().pending_records), 0);
    check.close();
  });
});

test('OPS02_ATOMIC_ADMISSION commits scope, workflow, queue, quota, event, and outbox together across processes', async t => {
  const temporary = tempDirectory('ah11-admission-race-');
  t.after(() => temporary.cleanup());
  const initial = openStore(temporary.databasePath);
  initial.close();

  const crash = await runChild(join(ROOT, 'tests/operations/fixtures/admission-commit-crash-child.mjs'), [
    temporary.databasePath, 'tenant-crash', 'project-crash', 'lost-ack', PLAN
  ]);
  assert.equal(crash.signal, 'SIGKILL');
  const afterCrash = openStore(temporary.databasePath);
  const recovered = admit(afterCrash, 'tenant-crash', 'project-crash', 'lost-ack');
  assert.equal(recovered.accepted, true);
  assert.equal(recovered.duplicate, true);
  assert.throws(() => admit(afterCrash, 'tenant-crash', 'project-crash', 'lost-ack', PLAN_TWO),
    error => error.code === 'IDEMPOTENCY_CONFLICT');
  const afterCrashRaw = new DatabaseSync(temporary.databasePath, { readOnly: true });
  assert.equal(Number(afterCrashRaw.prepare('SELECT COUNT(*) AS count FROM operations_work WHERE idempotency_key=?').get('lost-ack').count), 1);
  afterCrashRaw.close();
  afterCrash.close();

  const childScript = join(ROOT, 'tests/operations/fixtures/admission-child.mjs');
  const unlockedRace = tempDirectory('ah11-admission-unlocked-race-');
  t.after(() => unlockedRace.cleanup());
  const unlockedStore = openStore(unlockedRace.databasePath);
  unlockedStore.close();
  const unlockedOutFiles = Array.from({ length: 4 }, (_, index) => join(unlockedRace.directory, `race-${index}.json`));
  const unlockedProgressFiles = unlockedOutFiles.map(path => `${path}.progress.json`);
  const unlockedGatePath = join(unlockedRace.directory, 'race-release');
  const unlockedRetryGatePath = join(unlockedRace.directory, 'race-retry-release');
  const unlockedAdmissions = [];
  const unlockedReadyPids = [];
  let unlockedChildrenReaped = false;
  let unlockedRaces;
  try {
    for (let index = 0; index < unlockedOutFiles.length; index += 1) {
      const readyPath = join(unlockedRace.directory, `race-${index}.ready.json`);
      const running = startOwnedChild(childScript, [
        unlockedRace.databasePath, 'tenant-unlocked', 'project-unlocked', 'same-key', PLAN,
        unlockedOutFiles[index], readyPath, unlockedGatePath,
        unlockedProgressFiles[index], unlockedRetryGatePath
      ]);
      unlockedAdmissions.push(running);
      await waitForPath(readyPath, running.child, 5_000);
      const ready = JSON.parse(readFileSync(readyPath, 'utf8'));
      assert.equal(ready.storeOpen, true);
      assert.ok(Number.isSafeInteger(ready.pid) && ready.pid > 1);
      unlockedReadyPids.push(ready.pid);
    }
    assert.equal(new Set(unlockedReadyPids).size, unlockedOutFiles.length);
    writeFileSync(unlockedGatePath, 'release', { flag: 'wx', mode: 0o600 });
    writeFileSync(unlockedRetryGatePath, 'release', { flag: 'wx', mode: 0o600 });
    unlockedRaces = await Promise.all(unlockedAdmissions.map(running => running.closed));
    unlockedChildrenReaped = unlockedRaces.every(result => result.error || result.code !== null || result.signal !== null);
  } finally {
    if (!unlockedChildrenReaped) {
      const cleanup = await Promise.all(unlockedAdmissions.map(async running => {
        if (running.child.exitCode !== null || running.child.signalCode !== null) return true;
        return Boolean(await killOwnedChildAndReap(running.child, running.closed));
      }));
      unlockedChildrenReaped = cleanup.every(Boolean);
      assert.equal(unlockedChildrenReaped, true, 'all ordinary-race children are reaped on assertion failure');
    }
  }
  const unlockedReplies = unlockedOutFiles.map(path => {
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  });
  const unlockedSafeSummary = unlockedReplies.map((reply, index) => ({
    childStatus: unlockedRaces[index]?.code === 0 ? 'EXIT_0'
      : unlockedRaces[index]?.signal ? 'SIGNAL' : 'NONZERO',
    stopped: reply?.stopped === true,
    attempts: Array.isArray(reply?.attempts) ? reply.attempts.map(attempt => ({
      accepted: attempt?.accepted === true,
      duplicate: attempt?.duplicate === true ? true : attempt?.duplicate === false ? false : null,
      code: ['OPS_BACKPRESSURE', 'OPS_UNAVAILABLE'].includes(attempt?.code) ? attempt.code : null,
      reasonCode: ['STORE_BUSY', 'STORE_UNAVAILABLE', 'WORKER_NOT_ACCEPTING', 'SCOPE_CAPACITY',
        'GLOBAL_QUEUE_FULL', 'TENANT_QUEUE_FULL', 'PROJECT_QUEUE_FULL', 'RESOURCE_PROBE_UNAVAILABLE',
        'WAL_HEADROOM_LOW', 'STORE_CAPACITY', 'DISK_HEADROOM_LOW', 'TELEMETRY_BACKLOG_HIGH']
        .includes(attempt?.reasonCode) ? attempt.reasonCode : null,
      retryAfterMs: Number.isSafeInteger(attempt?.retryAfterMs) ? attempt.retryAfterMs : null
    })) : []
  }));
  const unlockedRetryChainsAreCoherent = unlockedReplies.every(reply => {
    const attempts = reply?.attempts;
    if (!Array.isArray(attempts) || attempts.length < 1 || attempts.length > 5) return false;
    return attempts.every((attempt, index) => attempt.accepted === true
      ? index === attempts.length - 1
      : index < attempts.length - 1 && attempt.code === 'OPS_BACKPRESSURE'
        && attempt.reasonCode === 'STORE_BUSY'
        && Number.isSafeInteger(attempt.retryAfterMs) && attempt.retryAfterMs >= 25 && attempt.retryAfterMs <= 5_000);
  });
  const unlockedFreshCount = unlockedReplies.filter(reply => reply?.result?.accepted === true
    && reply.result.duplicate === false).length;
  const unlockedDuplicateCount = unlockedReplies.filter(reply => reply?.result?.accepted === true
    && reply.result.duplicate === true).length;
  const unlockedRaw = new DatabaseSync(unlockedRace.databasePath, { readOnly: true });
  const unlockedRows = unlockedRaw.prepare(`SELECT job_id, workflow_id FROM operations_work
    WHERE tenant_id=? AND project_id=? AND idempotency_key=?`)
    .all('tenant-unlocked', 'project-unlocked', 'same-key');
  unlockedRaw.close();
  const unlockedOneIdentity = unlockedRows.length === 1 && unlockedReplies.every(reply =>
    reply?.result?.jobId === unlockedRows[0].job_id && reply.result.workflowId === unlockedRows[0].workflow_id);
  t.diagnostic(`OPS02 ordinary unlocked admission race ${JSON.stringify({
    children: unlockedSafeSummary,
    retryChainsAreCoherent: unlockedRetryChainsAreCoherent,
    freshReplies: unlockedFreshCount,
    duplicateReplies: unlockedDuplicateCount,
    durableMatchingRows: unlockedRows.length,
    oneStableIdentity: unlockedOneIdentity
  })}`);
  assert.ok(unlockedReplies.every(reply => reply !== null && reply.stopped === true
    && reply.outcome === 'accepted_and_stopped'), JSON.stringify(unlockedSafeSummary));
  assert.ok(unlockedRaces.every(result => result.code === 0), JSON.stringify(unlockedSafeSummary));
  assert.equal(unlockedRetryChainsAreCoherent, true, JSON.stringify(unlockedSafeSummary));
  assert.equal(unlockedFreshCount, 1, JSON.stringify(unlockedSafeSummary));
  assert.equal(unlockedDuplicateCount, 3, JSON.stringify(unlockedSafeSummary));
  assert.equal(unlockedRows.length, 1, JSON.stringify(unlockedSafeSummary));
  assert.equal(unlockedOneIdentity, true, JSON.stringify(unlockedSafeSummary));

  const outFiles = Array.from({ length: 4 }, (_, index) => join(temporary.directory, `race-${index}.json`));
  const progressFiles = outFiles.map(path => `${path}.progress.json`);
  const admissionGatePath = join(temporary.directory, 'race-release');
  const admissionRetryGatePath = join(temporary.directory, 'race-retry-release');
  const runningAdmissions = [];
  const readyPids = [];
  let admissionChildrenReaped = false;
  let admissionLock = null;
  let admissionLockHeld = false;
  let initialBusyRepliesObserved = false;
  let races;
  try {
    for (let index = 0; index < outFiles.length; index += 1) {
      const readyPath = join(temporary.directory, `race-${index}.ready.json`);
      const running = startOwnedChild(childScript, [
        temporary.databasePath, 'tenant-race', 'project-race', 'same-key', PLAN,
        outFiles[index], readyPath, admissionGatePath, progressFiles[index], admissionRetryGatePath
      ]);
      runningAdmissions.push(running);
      await waitForPath(readyPath, running.child, 5_000);
      const ready = JSON.parse(readFileSync(readyPath, 'utf8'));
      assert.equal(ready.storeOpen, true);
      assert.ok(Number.isSafeInteger(ready.pid) && ready.pid > 1);
      readyPids.push(ready.pid);
    }
    assert.equal(new Set(readyPids).size, outFiles.length);
    admissionLock = new DatabaseSync(temporary.databasePath, { timeout: 0 });
    admissionLock.exec('BEGIN IMMEDIATE');
    admissionLockHeld = true;
    writeFileSync(admissionGatePath, 'release', { flag: 'wx', mode: 0o600 });
    const firstBusy = attempt => attempt?.accepted === false
      && attempt.code === 'OPS_BACKPRESSURE' && attempt.reasonCode === 'STORE_BUSY'
      && Number.isSafeInteger(attempt.retryAfterMs) && attempt.retryAfterMs >= 25 && attempt.retryAfterMs <= 5_000;
    const initialDeadline = Date.now() + 5_000;
    while (Date.now() < initialDeadline) {
      const progress = progressFiles.map(path => {
        if (!existsSync(path)) return null;
        try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
      });
      if (progress.every(item => firstBusy(item?.attempts?.[0]))) {
        initialBusyRepliesObserved = true;
        break;
      }
      await new Promise(resolveWait => setTimeout(resolveWait, 2));
    }
    admissionLock.exec('ROLLBACK');
    admissionLockHeld = false;
    admissionLock.close();
    admissionLock = null;
    writeFileSync(admissionRetryGatePath, 'release', { flag: 'wx', mode: 0o600 });
    races = await Promise.all(runningAdmissions.map(running => running.closed));
    admissionChildrenReaped = races.every(result => result.error || result.code !== null || result.signal !== null);
  } finally {
    if (admissionLockHeld) {
      try { admissionLock.exec('ROLLBACK'); } catch {}
    }
    try { admissionLock?.close(); } catch {}
    if (!admissionChildrenReaped) {
      const cleanup = await Promise.all(runningAdmissions.map(async running => {
        if (running.child.exitCode !== null || running.child.signalCode !== null) return true;
        return Boolean(await killOwnedChildAndReap(running.child, running.closed));
      }));
      admissionChildrenReaped = cleanup.every(Boolean);
      assert.equal(admissionChildrenReaped, true, 'all staged admission children are reaped on assertion failure');
    }
  }
  const replies = outFiles.map(path => {
    if (!existsSync(path)) return null;
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
  });
  const safeReplySummary = replies.map((reply, index) => ({
    childStatus: races[index]?.code === 0 ? 'EXIT_0'
      : races[index]?.signal ? 'SIGNAL' : 'NONZERO',
    stopped: reply?.stopped === true,
    outcome: ['accepted_and_stopped', 'not_accepted_or_stop_incomplete', 'child_error'].includes(reply?.outcome)
      ? reply.outcome : 'MISSING_OR_INVALID',
    attempts: Array.isArray(reply?.attempts) ? reply.attempts.map(attempt => ({
      accepted: attempt?.accepted === true,
      duplicate: attempt?.duplicate === true ? true : attempt?.duplicate === false ? false : null,
      code: ['OPS_BACKPRESSURE', 'OPS_UNAVAILABLE'].includes(attempt?.code) ? attempt.code : null,
      reasonCode: typeof attempt?.reasonCode === 'string'
        && ['STORE_BUSY', 'STORE_UNAVAILABLE', 'WORKER_NOT_ACCEPTING', 'SCOPE_CAPACITY',
          'GLOBAL_QUEUE_FULL', 'TENANT_QUEUE_FULL', 'PROJECT_QUEUE_FULL',
          'RESOURCE_PROBE_UNAVAILABLE', 'WAL_HEADROOM_LOW', 'STORE_CAPACITY',
          'DISK_HEADROOM_LOW', 'TELEMETRY_BACKLOG_HIGH', 'OTHER_REASON'].includes(attempt.reasonCode)
        ? attempt.reasonCode : null,
      retryAfterMs: Number.isSafeInteger(attempt?.retryAfterMs)
        && attempt.retryAfterMs >= 0 && attempt.retryAfterMs <= 5_000 ? attempt.retryAfterMs : null
    })) : [],
    finalAccepted: reply?.result?.accepted === true,
    finalDuplicate: reply?.result?.duplicate === true ? true
      : reply?.result?.duplicate === false ? false : null
  }));
  const initialOutcomesAreContractual = replies.every(reply => {
    const initial = reply?.attempts?.[0];
    return initial?.accepted === true
      || (initial?.accepted === false && initial.code === 'OPS_BACKPRESSURE'
        && initial.reasonCode === 'STORE_BUSY'
        && Number.isSafeInteger(initial.retryAfterMs) && initial.retryAfterMs >= 25 && initial.retryAfterMs <= 5_000);
  });
  const retryChainsAreBounded = replies.every(reply => {
    const attempts = reply?.attempts;
    if (!Array.isArray(attempts) || attempts.length < 1 || attempts.length > 5) return false;
    return attempts.every((attempt, index) => attempt.accepted === true
      ? index === attempts.length - 1
      : index < attempts.length - 1 && attempt.code === 'OPS_BACKPRESSURE'
        && attempt.reasonCode === 'STORE_BUSY'
        && Number.isSafeInteger(attempt.retryAfterMs) && attempt.retryAfterMs >= 25 && attempt.retryAfterMs <= 5_000);
  });
  const allChildrenRetriedAfterLockRelease = replies.every(reply => {
    const attempts = reply?.attempts;
    return Array.isArray(attempts) && attempts.length >= 2
      && attempts[0].accepted === false && attempts[0].code === 'OPS_BACKPRESSURE'
      && attempts[0].reasonCode === 'STORE_BUSY'
      && attempts.at(-1).accepted === true;
  });
  const durableSnapshot = () => {
    const raw = new DatabaseSync(temporary.databasePath, { readOnly: true });
    try {
      const rows = raw.prepare(`SELECT job_id, workflow_id, state, generation, fence_token
        FROM operations_work WHERE tenant_id=? AND project_id=? AND idempotency_key=?`)
        .all('tenant-race', 'project-race', 'same-key');
      const meta = raw.prepare(`SELECT pending_records, pending_bytes, in_flight,
        reserved_event_slots, reserved_disk_bytes FROM operations_meta WHERE singleton=1`).get();
      const tenant = raw.prepare(`SELECT pending_records, pending_bytes, in_flight
        FROM operations_tenants WHERE tenant_id=?`).get('tenant-race');
      const project = raw.prepare(`SELECT pending_records, pending_bytes, in_flight
        FROM operations_projects WHERE tenant_id=? AND project_id=?`).get('tenant-race', 'project-race');
      const eventCount = rows.length === 1
        ? Number(raw.prepare('SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=?').get(rows[0].workflow_id).count)
        : null;
      return {
        rows: rows.map(row => ({ ...row,
          generation: Number(row.generation), fence_token: Number(row.fence_token) })),
        meta: Object.fromEntries(Object.entries(meta).map(([key, value]) => [key, Number(value)])),
        tenant: tenant ? Object.fromEntries(Object.entries(tenant).map(([key, value]) => [key, Number(value)])) : null,
        project: project ? Object.fromEntries(Object.entries(project).map(([key, value]) => [key, Number(value)])) : null,
        eventCount
      };
    } finally {
      raw.close();
    }
  };
  const beforeReplay = durableSnapshot();
  const oneFreshReply = replies.filter(reply => reply?.result?.accepted === true
    && reply.result.duplicate === false).length === 1;
  const threeDuplicateReplies = replies.filter(reply => reply?.result?.accepted === true
    && reply.result.duplicate === true).length === 3;
  const oneStableIdentity = beforeReplay.rows.length === 1 && replies.every(reply =>
    reply?.result?.jobId === beforeReplay.rows[0]?.job_id
      && reply.result.workflowId === beforeReplay.rows[0]?.workflow_id);
  const controlledBusyReplyCount = replies.filter(reply =>
    reply?.attempts?.[0]?.accepted === false
      && reply.attempts[0].code === 'OPS_BACKPRESSURE'
      && reply.attempts[0].reasonCode === 'STORE_BUSY').length;
  const durableSummary = {
    matchingRows: beforeReplay.rows.length,
    pendingRecords: beforeReplay.meta.pending_records,
    pendingBytes: beforeReplay.meta.pending_bytes,
    inFlight: beforeReplay.meta.in_flight,
    tenantPendingRecords: beforeReplay.tenant?.pending_records ?? null,
    projectPendingRecords: beforeReplay.project?.pending_records ?? null,
    workflowEvents: beforeReplay.eventCount
  };
  t.diagnostic(`OPS02 admission race ${JSON.stringify({
    children: safeReplySummary,
    initialBusyRepliesObserved,
    initialOutcomesAreContractual,
    retryChainsAreBounded,
    allChildrenRetriedAfterLockRelease,
    controlledBusyReplyCount,
    oneFreshReply,
    threeDuplicateReplies,
    oneStableIdentity,
    durable: durableSummary
  })}`);
  assert.ok(replies.every(reply => reply !== null), 'every staged child writes a bounded outcome record');
  assert.ok(races.every(result => result.code === 0), JSON.stringify(safeReplySummary));
  assert.ok(replies.every(reply => reply.stopped === true && reply.outcome === 'accepted_and_stopped'), JSON.stringify(safeReplySummary));
  assert.equal(initialBusyRepliesObserved, true, JSON.stringify(safeReplySummary));
  assert.equal(initialOutcomesAreContractual, true, JSON.stringify(safeReplySummary));
  assert.equal(retryChainsAreBounded, true, JSON.stringify(safeReplySummary));
  assert.equal(controlledBusyReplyCount, outFiles.length, JSON.stringify(safeReplySummary));
  assert.equal(allChildrenRetriedAfterLockRelease, true, JSON.stringify(safeReplySummary));
  assert.equal(oneFreshReply, true, JSON.stringify(safeReplySummary));
  assert.equal(threeDuplicateReplies, true, JSON.stringify(safeReplySummary));
  assert.equal(oneStableIdentity, true, JSON.stringify(safeReplySummary));
  assert.equal(beforeReplay.rows.length, 1, JSON.stringify(safeReplySummary));
  assert.ok(beforeReplay.meta.pending_records <= 2, JSON.stringify(safeReplySummary));

  const reopenedStore = openStore(temporary.databasePath);
  const replay = admit(reopenedStore, 'tenant-race', 'project-race', 'same-key');
  reopenedStore.close();
  const afterReplay = durableSnapshot();
  const reopenStable = replay.accepted === true && replay.duplicate === true
    && replay.jobId === beforeReplay.rows[0].job_id
    && replay.workflowId === beforeReplay.rows[0].workflow_id
    && replay.state === beforeReplay.rows[0].state
    && JSON.stringify(afterReplay) === JSON.stringify(beforeReplay);
  t.diagnostic(`OPS02 admission reopen ${JSON.stringify({
    replayAccepted: replay.accepted === true,
    replayDuplicate: replay.duplicate === true,
    sameJob: replay.jobId === beforeReplay.rows[0].job_id,
    sameWorkflow: replay.workflowId === beforeReplay.rows[0].workflow_id,
    sameState: replay.state === beforeReplay.rows[0].state,
    countersStable: JSON.stringify(afterReplay.meta) === JSON.stringify(beforeReplay.meta),
    tenantCountersStable: JSON.stringify(afterReplay.tenant) === JSON.stringify(beforeReplay.tenant),
    projectCountersStable: JSON.stringify(afterReplay.project) === JSON.stringify(beforeReplay.project),
    workflowEventsStable: afterReplay.eventCount === beforeReplay.eventCount,
    matchingRowsBefore: beforeReplay.rows.length,
    matchingRowsAfter: afterReplay.rows.length
  })}`);
  assert.equal(reopenStable, true, JSON.stringify({
    ...durableSummary,
    replayAccepted: replay.accepted === true,
    replayDuplicate: replay.duplicate === true,
    countersStable: JSON.stringify(afterReplay.meta) === JSON.stringify(beforeReplay.meta),
    eventsStable: afterReplay.eventCount === beforeReplay.eventCount
  }));

  await t.test('OPS02.C01 applies exact UTF-8 scope caps to first and existing rows', () => {
    const quota = {
      maxQueueRecords: 4, maxPerTenantRecords: 2, maxPerProjectRecords: 1,
      maxQueueBytes: 65_536, maxPerTenantBytes: 32_768,
      maxPerProjectBytes: 16_384, maxEventBacklog: 1_024
    };
    const projectBoundary = tempDirectory('ah11-project-boundary-');
    t.after(() => projectBoundary.cleanup());
    const projectStore = openStore(projectBoundary.databasePath);
    const exactProject = planAtWorkByteLength(16_384, PLAN, quota);
    assert.equal(admit(projectStore, 'tenant-first', 'project-first', 'exact-project', exactProject.work.planJson, quota).accepted, true);
    const rawProject = new DatabaseSync(projectBoundary.databasePath, { readOnly: true });
    assert.equal(Number(rawProject.prepare('SELECT pending_bytes FROM operations_projects WHERE tenant_id=? AND project_id=?').get('tenant-first', 'project-first').pending_bytes), 16_384);
    rawProject.close();
    projectStore.close();

    const overProject = tempDirectory('ah11-project-over-');
    t.after(() => overProject.cleanup());
    const overProjectStore = openStore(overProject.databasePath);
    const over = planAtWorkByteLength(16_385, PLAN, quota);
    const rejected = admit(overProjectStore, 'tenant-first', 'project-first', 'over-project', over.work.planJson, quota);
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reasonCode, 'PROJECT_QUEUE_FULL');
    const afterReject = new DatabaseSync(overProject.databasePath, { readOnly: true });
    assert.equal(Number(afterReject.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count), 0);
    assert.equal(Number(afterReject.prepare('SELECT reserved_disk_bytes FROM operations_meta WHERE singleton=1').get().reserved_disk_bytes), 0);
    assert.equal(Number(afterReject.prepare('SELECT COUNT(*) AS count FROM operations_projects').get().count), 0);
    afterReject.close();
    overProjectStore.close();

    const tenantBoundary = tempDirectory('ah11-tenant-boundary-');
    t.after(() => tenantBoundary.cleanup());
    const tenantStore = openStore(tenantBoundary.databasePath);
    const half = planAtWorkByteLength(16_384, PLAN, quota);
    assert.equal(admit(tenantStore, 'tenant-shared', 'project-one', 'tenant-half-one', half.work.planJson, quota).accepted, true);
    assert.equal(admit(tenantStore, 'tenant-shared', 'project-two', 'tenant-half-two', half.work.planJson, quota).accepted, true);
    const tenantOverflow = admit(tenantStore, 'tenant-shared', 'project-three', 'tenant-overflow', PLAN, quota);
    assert.equal(tenantOverflow.accepted, false);
    assert.equal(tenantOverflow.reasonCode, 'TENANT_QUEUE_FULL');
    const tenantRaw = new DatabaseSync(tenantBoundary.databasePath, { readOnly: true });
    assert.equal(Number(tenantRaw.prepare('SELECT pending_bytes FROM operations_tenants WHERE tenant_id=?').get('tenant-shared').pending_bytes), 32_768);
    assert.equal(Number(tenantRaw.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count), 2);
    tenantRaw.close();
    tenantStore.close();

    const firstScopeOver = tempDirectory('ah11-tenant-first-over-');
    t.after(() => firstScopeOver.cleanup());
    const firstStore = openStore(firstScopeOver.databasePath);
    const tooLarge = planAtWorkByteLength(32_769, PLAN, quota);
    const firstReject = admit(firstStore, 'tenant-new', 'project-new', 'first-too-large', tooLarge.work.planJson, quota);
    assert.equal(firstReject.accepted, false);
    assert.equal(firstReject.reasonCode, 'TENANT_QUEUE_FULL');
    const firstRaw = new DatabaseSync(firstScopeOver.databasePath, { readOnly: true });
    assert.equal(Number(firstRaw.prepare('SELECT COUNT(*) AS count FROM operations_tenants').get().count), 0);
    assert.equal(Number(firstRaw.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count), 0);
    firstRaw.close();
    firstStore.close();

    const multibyte = tempDirectory('ah11-multibyte-boundary-');
    t.after(() => multibyte.cleanup());
    const unicodePlan = JSON.stringify({
      kind: 'agent-harness.private-synthetic-plan', version: 1,
      steps: [{ id: 'text', operation: 'text.concat', dependsOn: [], args: { parts: ['é'.repeat(300)] } }]
    });
    const unicodeWork = planAtWorkByteLength(16_384, unicodePlan, quota);
    assert.ok(unicodeWork.workJson.includes('é'));
    const unicodeStore = openStore(multibyte.databasePath);
    assert.equal(admit(unicodeStore, 'tenant-unicode', 'project-unicode', 'unicode-exact', unicodeWork.work.planJson, quota).accepted, true);
    const unicodeRaw = new DatabaseSync(multibyte.databasePath, { readOnly: true });
    assert.equal(Number(unicodeRaw.prepare('SELECT work_bytes FROM operations_work').get().work_bytes), 16_384);
    unicodeRaw.close();
    unicodeStore.close();
  });

  await t.test('OPS02.C02 races distinct global/project record and byte caps across processes', async t => {
    const capDirectory = tempDirectory('ah11-global-cap-race-');
    t.after(() => capDirectory.cleanup());
    const config = {
      maxQueueRecords: 2, maxPerTenantRecords: 1, maxPerProjectRecords: 1,
      maxQueueBytes: 65_536, maxPerTenantBytes: 32_768, maxPerProjectBytes: 16_384,
      maxTenants: 16, maxProjects: 128, maxEventBacklog: 1_024
    };
    const store = openStore(capDirectory.databasePath);
    assert.equal(admit(store, 'tenant-seed', 'project-seed', 'seed', PLAN, config).accepted, true);
    store.close();
    const outputs = [join(capDirectory.directory, 'cap-a.json'), join(capDirectory.directory, 'cap-b.json')];
    const script = join(ROOT, 'tests/operations/fixtures/admission-store-child.mjs');
    const races = await Promise.all(outputs.map((output, index) => runChild(script, [
      capDirectory.databasePath, `tenant-cap-${index}`, `project-cap-${index}`, `cap-key-${index}`,
      PLAN, JSON.stringify(config), output
    ])));
    assert.ok(races.every(result => result.code === 0), races.map(result => result.stderr).join('\n'));
    const outcomes = outputs.map(path => JSON.parse(readFileSync(path, 'utf8')).result);
    assert.equal(outcomes.filter(result => result.accepted).length, 1);
    assert.equal(outcomes.filter(result => !result.accepted && result.reasonCode === 'GLOBAL_QUEUE_FULL').length, 1);
    const reopened = openStore(capDirectory.databasePath);
    const raw = new DatabaseSync(capDirectory.databasePath, { readOnly: true });
    assert.equal(Number(raw.prepare('SELECT pending_records FROM operations_meta WHERE singleton=1').get().pending_records), 2);
    assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count), 2);
    raw.close();
    reopened.close();

    const projectBytes = tempDirectory('ah11-project-byte-race-');
    t.after(() => projectBytes.cleanup());
    const bytePolicy = {
      maxQueueRecords: 8, maxPerTenantRecords: 4, maxPerProjectRecords: 4,
      maxQueueBytes: 65_536, maxPerTenantBytes: 32_768, maxPerProjectBytes: 16_384,
      maxTenants: 8, maxProjects: 32, maxEventBacklog: 2_048
    };
    const seedStore = openStore(projectBytes.databasePath);
    const seedWork = planAtWorkByteLength(8_000, PLAN, bytePolicy);
    const contenderWork = planAtWorkByteLength(5_000, PLAN, bytePolicy);
    assert.equal(admit(seedStore, 'tenant-byte-race', 'project-byte-race', 'byte-seed', seedWork.work.planJson, bytePolicy).accepted, true);
    seedStore.close();
    const byteOutputs = [join(projectBytes.directory, 'byte-a.json'), join(projectBytes.directory, 'byte-b.json')];
    const byteScript = join(ROOT, 'tests/operations/fixtures/admission-store-child.mjs');
    const byteRace = await Promise.all(byteOutputs.map((output, index) => runChild(byteScript, [
      projectBytes.databasePath, 'tenant-byte-race', 'project-byte-race', `byte-race-${index}`,
      contenderWork.work.planJson, JSON.stringify(bytePolicy), output
    ])));
    assert.ok(byteRace.every(result => result.code === 0), byteRace.map(result => result.stderr).join('\n'));
    const byteResults = byteOutputs.map(path => JSON.parse(readFileSync(path, 'utf8')).result);
    assert.equal(byteResults.filter(result => result.accepted).length, 1);
    assert.equal(byteResults.filter(result => !result.accepted && result.reasonCode === 'PROJECT_QUEUE_FULL').length, 1);
    const byteReopened = openStore(projectBytes.databasePath);
    const byteRaw = new DatabaseSync(projectBytes.databasePath, { readOnly: true });
    assert.equal(Number(byteRaw.prepare('SELECT pending_bytes FROM operations_projects WHERE tenant_id=? AND project_id=?')
      .get('tenant-byte-race', 'project-byte-race').pending_bytes), 13_000);
    assert.equal(Number(byteRaw.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count), 2);
    byteRaw.close();
    byteReopened.close();

    const firstScopeBytes = tempDirectory('ah11-first-project-byte-race-');
    t.after(() => firstScopeBytes.cleanup());
    const firstBytePolicy = {
      maxQueueRecords: 8, maxPerTenantRecords: 4, maxPerProjectRecords: 4,
      maxQueueBytes: 65_536, maxPerTenantBytes: 32_768, maxPerProjectBytes: 16_384,
      maxTenants: 8, maxProjects: 32, maxEventBacklog: 2_048
    };
    const firstByteInit = openStore(firstScopeBytes.databasePath);
    firstByteInit.close();
    const firstByteWork = planAtWorkByteLength(10_000, PLAN, firstBytePolicy);
    const firstByteOutputs = [join(firstScopeBytes.directory, 'first-a.json'), join(firstScopeBytes.directory, 'first-b.json')];
    const firstByteRace = await Promise.all(firstByteOutputs.map((output, index) => runChild(byteScript, [
      firstScopeBytes.databasePath, 'tenant-new-byte-race', 'project-new-byte-race', `first-byte-${index}`,
      firstByteWork.work.planJson, JSON.stringify(firstBytePolicy), output
    ])));
    assert.ok(firstByteRace.every(result => result.code === 0), firstByteRace.map(result => result.stderr).join('\n'));
    const firstByteResults = firstByteOutputs.map(path => JSON.parse(readFileSync(path, 'utf8')).result);
    assert.equal(firstByteResults.filter(result => result.accepted).length, 1);
    assert.equal(firstByteResults.filter(result => !result.accepted && result.reasonCode === 'PROJECT_QUEUE_FULL').length, 1);
    const firstByteDb = openStore(firstScopeBytes.databasePath);
    const firstByteSnapshot = new DatabaseSync(firstScopeBytes.databasePath, { readOnly: true });
    assert.equal(Number(firstByteSnapshot.prepare('SELECT pending_bytes FROM operations_projects WHERE tenant_id=? AND project_id=?')
      .get('tenant-new-byte-race', 'project-new-byte-race').pending_bytes), 10_000);
    assert.equal(Number(firstByteSnapshot.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count), 1);
    assert.equal(Number(firstByteSnapshot.prepare('SELECT reserved_disk_bytes FROM operations_meta WHERE singleton=1').get().reserved_disk_bytes) > 0, true);
    firstByteSnapshot.close();
    firstByteDb.close();

    const projectRecords = tempDirectory('ah11-project-record-race-');
    t.after(() => projectRecords.cleanup());
    const recordPolicy = {
      maxQueueRecords: 8, maxPerTenantRecords: 4, maxPerProjectRecords: 2,
      maxQueueBytes: 65_536, maxPerTenantBytes: 32_768, maxPerProjectBytes: 16_384,
      maxTenants: 8, maxProjects: 32, maxEventBacklog: 2_048
    };
    const recordStore = openStore(projectRecords.databasePath);
    assert.equal(admit(recordStore, 'tenant-record-race', 'project-record-race', 'record-seed', PLAN, recordPolicy).accepted, true);
    recordStore.close();
    const recordOutputs = [join(projectRecords.directory, 'record-a.json'), join(projectRecords.directory, 'record-b.json')];
    const recordRace = await Promise.all(recordOutputs.map((output, index) => runChild(byteScript, [
      projectRecords.databasePath, 'tenant-record-race', 'project-record-race', `project-record-${index}`,
      PLAN, JSON.stringify(recordPolicy), output
    ])));
    assert.ok(recordRace.every(result => result.code === 0), recordRace.map(result => result.stderr).join('\n'));
    const recordResults = recordOutputs.map(path => JSON.parse(readFileSync(path, 'utf8')).result);
    assert.equal(recordResults.filter(result => result.accepted).length, 1);
    assert.equal(recordResults.filter(result => !result.accepted && result.reasonCode === 'PROJECT_QUEUE_FULL').length, 1);
    const recordReopened = openStore(projectRecords.databasePath);
    const recordSnapshot = new DatabaseSync(projectRecords.databasePath, { readOnly: true });
    assert.equal(Number(recordSnapshot.prepare('SELECT pending_records FROM operations_projects WHERE tenant_id=? AND project_id=?')
      .get('tenant-record-race', 'project-record-race').pending_records), 2);
    assert.equal(Number(recordSnapshot.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count), 2);
    recordSnapshot.close();
    recordReopened.close();

    const globalBytes = tempDirectory('ah11-global-byte-race-');
    t.after(() => globalBytes.cleanup());
    const globalBytePolicy = {
      maxQueueRecords: 8, maxPerTenantRecords: 4, maxPerProjectRecords: 2,
      maxQueueBytes: 65_536, maxPerTenantBytes: 32_768, maxPerProjectBytes: 16_384,
      maxTenants: 8, maxProjects: 32, maxEventBacklog: 2_048
    };
    const globalByteStore = openStore(globalBytes.databasePath);
    const seedGlobalWork = planAtWorkByteLength(16_000, PLAN, globalBytePolicy);
    for (const index of [0, 1, 2]) {
      assert.equal(admit(globalByteStore, `tenant-global-byte-${index}`, `project-global-byte-${index}`,
        `global-byte-seed-${index}`, seedGlobalWork.work.planJson, globalBytePolicy).accepted, true);
    }
    globalByteStore.close();
    const globalContender = planAtWorkByteLength(10_000, PLAN, globalBytePolicy);
    const globalOutputs = [join(globalBytes.directory, 'global-a.json'), join(globalBytes.directory, 'global-b.json')];
    const globalRace = await Promise.all(globalOutputs.map((output, index) => runChild(byteScript, [
      globalBytes.databasePath, `tenant-global-contender-${index}`, `project-global-contender-${index}`,
      `global-byte-contender-${index}`, globalContender.work.planJson, JSON.stringify(globalBytePolicy), output
    ])));
    assert.ok(globalRace.every(result => result.code === 0), globalRace.map(result => result.stderr).join('\n'));
    const globalResults = globalOutputs.map(path => JSON.parse(readFileSync(path, 'utf8')).result);
    assert.equal(globalResults.filter(result => result.accepted).length, 1);
    assert.equal(globalResults.filter(result => !result.accepted && result.reasonCode === 'GLOBAL_QUEUE_FULL').length, 1);
    const globalReopened = openStore(globalBytes.databasePath);
    const globalSnapshot = new DatabaseSync(globalBytes.databasePath, { readOnly: true });
    assert.equal(Number(globalSnapshot.prepare('SELECT pending_bytes FROM operations_meta WHERE singleton=1').get().pending_bytes), 58_000);
    assert.equal(Number(globalSnapshot.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count), 4);
    globalSnapshot.close();
    globalReopened.close();
  });

  await t.test('OPS02.C03 rolls admission and local completion back at each durable write boundary', async t => {
    const admissionPoints = [
      ['operations_tenants', 'INSERT', ''], ['operations_projects', 'INSERT', ''],
      ['workflows', 'INSERT', ''], ['workflow_checkpoints', 'INSERT', ''],
      ['operations_work', 'INSERT', ''],
      ['operations_meta', 'UPDATE', ' WHEN NEW.pending_records > OLD.pending_records'],
      ['operations_tenants', 'UPDATE', ''], ['operations_projects', 'UPDATE', ''],
      ['workflow_events', 'INSERT', ''], ['outbox', 'INSERT', '']
    ];
    for (const [table, action, condition] of admissionPoints) {
      const item = tempDirectory('ah11-admission-rollback-');
      t.after(() => item.cleanup());
      const store = openStore(item.databasePath);
      const triggerDb = new DatabaseSync(item.databasePath);
      triggerDb.exec(`CREATE TRIGGER injected_failure BEFORE ${action} ON ${table}${condition} BEGIN SELECT RAISE(ABORT, 'injected durable write failure'); END`);
      assert.throws(() => admit(store, 'tenant-rollback', 'project-rollback', 'rollback', PLAN));
      triggerDb.close();
      store.close();
      const reopened = openStore(item.databasePath);
      const raw = new DatabaseSync(item.databasePath, { readOnly: true });
      for (const tableName of ['operations_tenants', 'operations_projects', 'operations_work', 'workflows', 'workflow_checkpoints', 'workflow_events', 'outbox']) {
        assert.equal(Number(raw.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count), 0, `${table}.${action} left partial ${tableName} state`);
      }
      assert.deepEqual({ ...raw.prepare('SELECT pending_records, pending_bytes, in_flight, reserved_event_slots, reserved_disk_bytes FROM operations_meta WHERE singleton=1').get() }, {
        pending_records: 0, pending_bytes: 0, in_flight: 0, reserved_event_slots: 0, reserved_disk_bytes: 0
      });
      raw.close();
      reopened.close();
    }

    const completionPoints = [
      ['workflows', 'UPDATE', ' WHEN NEW.checkpoint_sequence = 3'],
      ['workflow_checkpoints', 'INSERT', ' WHEN NEW.sequence = 3'],
      ['workflow_events', 'INSERT', " WHEN NEW.event_type = 'private_local_step_completed'"],
      ['outbox', 'INSERT', " WHEN (SELECT event_type FROM workflow_events WHERE sequence=NEW.event_sequence) = 'private_local_step_completed'"]
    ];
    for (const [table, action, condition] of completionPoints) {
      const item = tempDirectory('ah11-completion-rollback-');
      t.after(() => item.cleanup());
      const store = openStore(item.databasePath);
      const accepted = admit(store, 'tenant-completion', 'project-completion', `completion-${table}`, PLAN);
      const ownerId = 'review-worker';
      const claimed = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
        ownerId, policy: operationsStoragePolicy(readOperationsConfig())
      });
      assert.equal(claimed.claim.jobId, accepted.jobId);
      const currentClaim = store._operationsReadClaim(OPERATIONS_STORAGE_CAPABILITY, {
        jobId: accepted.jobId, ownerId, generation: claimed.claim.generation, fence: claimed.claim.fence
      });
      const triggerDb = new DatabaseSync(item.databasePath);
      triggerDb.exec(`CREATE TRIGGER injected_failure BEFORE ${action} ON ${table}${condition} BEGIN SELECT RAISE(ABORT, 'injected completion write failure'); END`);
      const result = await runBoundedLocalPlan({
        store, workflowId: accepted.workflowId, ownerId, fence: claimed.claim.fence,
        planJson: currentClaim.work.planJson, limitsJson: currentClaim.work.limitsJson
      });
      assert.equal(result.status, 'stopped');
      triggerDb.close();
      store.close();
      const reopened = openStore(item.databasePath);
      const workflow = reopened.getWorkflow(accepted.workflowId);
      const checkpoint = reopened.getCheckpoint(accepted.workflowId);
      assert.equal(workflow.revision, 2);
      assert.equal(workflow.checkpointSequence, 2);
      assert.equal(checkpoint.sequence, 2);
      assert.equal(checkpoint.data.kind, 'agent-harness.private-bounded-local-checkpoint');
      const raw = new DatabaseSync(item.databasePath, { readOnly: true });
      assert.equal(Number(raw.prepare("SELECT COUNT(*) AS count FROM workflow_events WHERE event_type='private_local_step_completed'").get().count), 0);
      assert.equal(Number(raw.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get().in_flight), 1);
      raw.close();
      reopened._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
        jobId: accepted.jobId, ownerId, generation: claimed.claim.generation,
        fence: claimed.claim.fence, outcome: 'stopped'
      });
      reopened.close();
    }
  });

  await t.test('OPS02.C05 rolls terminal queue, quota, workflow, event, and outbox writes back together', async t => {
    const finishPoints = [
      ['workflows', 'UPDATE', " WHEN NEW.state = 'succeeded'"],
      ['workflow_events', 'INSERT', " WHEN NEW.event_type = 'operations_work_completed'"],
      ['outbox', 'INSERT', " WHEN (SELECT event_type FROM workflow_events WHERE sequence=NEW.event_sequence) = 'operations_work_completed'"],
      ['operations_work', 'UPDATE', " WHEN NEW.state = 'completed'"],
      ['operations_meta', 'UPDATE', ' WHEN NEW.pending_records < OLD.pending_records'],
      ['operations_tenants', 'UPDATE', ' WHEN NEW.pending_records < OLD.pending_records'],
      ['operations_projects', 'UPDATE', ' WHEN NEW.pending_records < OLD.pending_records']
    ];
    for (const [table, action, condition] of finishPoints) {
      const item = tempDirectory('ah11-finish-rollback-');
      t.after(() => item.cleanup());
      const store = openStore(item.databasePath);
      const accepted = admit(store, 'tenant-finish', 'project-finish', `finish-${table}`, PLAN);
      const ownerId = 'review-worker-finish';
      const policy = operationsStoragePolicy(readOperationsConfig());
      const claim = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, { ownerId, policy }).claim;
      const current = store._operationsReadClaim(OPERATIONS_STORAGE_CAPABILITY, {
        jobId: accepted.jobId, ownerId, generation: claim.generation, fence: claim.fence
      });
      const result = await runBoundedLocalPlan({
        store, workflowId: accepted.workflowId, ownerId, fence: claim.fence,
        planJson: current.work.planJson, limitsJson: current.work.limitsJson
      });
      assert.equal(result.status, 'completed');
      const snapshot = () => {
        const raw = new DatabaseSync(item.databasePath, { readOnly: true });
        const value = {
          workflow: raw.prepare('SELECT state, revision, fence_token, lease_owner, lease_expires_ms, cancellation_requested, checkpoint_sequence FROM workflows WHERE workflow_id=?').get(accepted.workflowId),
          checkpoint: raw.prepare('SELECT sequence, payload_json, sha256 FROM workflow_checkpoints WHERE workflow_id=? ORDER BY sequence DESC LIMIT 1').get(accepted.workflowId),
          work: raw.prepare('SELECT state, worker_id, generation, fence_token, runner_pid, reserved_event_slots, reserved_disk_bytes FROM operations_work WHERE job_id=?').get(accepted.jobId),
          meta: raw.prepare('SELECT pending_records, pending_bytes, in_flight, reserved_event_slots, reserved_disk_bytes FROM operations_meta WHERE singleton=1').get(),
          tenant: raw.prepare('SELECT pending_records, pending_bytes, in_flight FROM operations_tenants WHERE tenant_id=?').get('tenant-finish'),
          project: raw.prepare('SELECT pending_records, pending_bytes, in_flight FROM operations_projects WHERE tenant_id=? AND project_id=?').get('tenant-finish', 'project-finish'),
          events: Number(raw.prepare('SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=?').get(accepted.workflowId).count),
          outbox: Number(raw.prepare('SELECT COUNT(*) AS count FROM outbox').get().count)
        };
        raw.close();
        return JSON.parse(JSON.stringify(value));
      };
      const before = snapshot();
      const triggerDb = new DatabaseSync(item.databasePath);
      triggerDb.exec(`CREATE TRIGGER injected_finish_failure BEFORE ${action} ON ${table}${condition} BEGIN SELECT RAISE(ABORT, 'injected terminal write failure'); END`);
      assert.throws(() => store._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
        jobId: accepted.jobId, ownerId, generation: claim.generation,
        fence: claim.fence, outcome: 'completed', childExited: true
      }));
      triggerDb.close();
      store.close();
      const reopened = openStore(item.databasePath);
      assert.deepEqual(snapshot(), before, `${table}.${action} did not restore the exact pre-finish durable snapshot`);
      reopened.close();
    }
  });

  await t.test('OPS02.C04 rejects a second worker with a different quota policy before it can share the store', async t => {
    const item = tempDirectory('ah11-policy-mismatch-');
    t.after(() => item.cleanup());
    const firstWorker = createOperationsWorker({ databasePath: item.databasePath, ownerId: 'review-worker-policy-a' });
    t.after(async () => { if (firstWorker.lifecycle !== 'stopped') await firstWorker.stop('test'); });
    assert.throws(() => createOperationsWorker({
      databasePath: item.databasePath,
      ownerId: 'review-worker-policy-b',
      config: { maxInFlightTenant: 1 }
    }), error => error.code === 'INVALID_INPUT');
    assert.equal(firstWorker.lifecycle, 'starting');
    const stopped = await firstWorker.stop('test');
    assert.equal(stopped.stopped, true);
    const raw = new DatabaseSync(item.databasePath, { readOnly: true });
    assert.equal(raw.prepare('SELECT policy_json FROM operations_meta WHERE singleton=1').get().policy_json !== null, true);
    assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count), 0);
    raw.close();
  });


});

test('OPS03_FAIRNESS_BACKPRESSURE protects a second tenant and persists hierarchical turns across claims', async t => {
  const temporary = tempDirectory('ah11-fairness-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const config = readOperationsConfig();
  const scopesByWorkflow = new Map();
  for (let index = 0; index < 8; index += 1) {
    const a1 = admit(store, 'tenant-a', 'project-a1', `a1-${index}`);
    const a2 = admit(store, 'tenant-a', 'project-a2', `a2-${index}`);
    assert.equal(a1.accepted, true);
    assert.equal(a2.accepted, true);
    scopesByWorkflow.set(a1.workflowId, 'tenant-a/project-a1');
    scopesByWorkflow.set(a2.workflowId, 'tenant-a/project-a2');
  }
  const blockedA = admit(store, 'tenant-a', 'project-a1', 'a1-overflow');
  assert.deepEqual({ accepted: blockedA.accepted, code: blockedA.code, reasonCode: blockedA.reasonCode }, {
    accepted: false, code: 'OPS_BACKPRESSURE', reasonCode: 'TENANT_QUEUE_FULL'
  });
  const secondTenant = admit(store, 'tenant-b', 'project-b1', 'b1-first');
  assert.equal(secondTenant.accepted, true);
  scopesByWorkflow.set(secondTenant.workflowId, 'tenant-b/project-b1');

  const turns = [];
  for (let turn = 0; turn < 4; turn += 1) {
    const selected = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: `ops-worker:fair-${turn}`,
      policy: operationsStoragePolicy(config)
    });
    assert.ok(selected?.claim);
    turns.push(scopesByWorkflow.get(selected.claim.workflowId));
    const row = store._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'tenant-a', projectId: 'project-a1', jobId: 'absent'
    });
    assert.equal(row, null);
    store._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: selected.claim.jobId, ownerId: selected.claim.ownerId,
      generation: selected.claim.generation, fence: selected.claim.fence, outcome: 'shutdown'
    });
  }
  assert.deepEqual(turns, ['tenant-a/project-a1', 'tenant-b/project-b1', 'tenant-a/project-a2', 'tenant-b/project-b1']);

  const small = readOperationsConfig({
    maxQueueBytes: 65_536, maxPerTenantBytes: 32_768, maxPerProjectBytes: 16_384,
    maxJobBytes: 36_864
  });
  const largePlan = PLAN + ' '.repeat(15_000);
  const byteStore = openStore(join(temporary.directory, 'bytes.sqlite'));
  t.after(() => byteStore.close());
  assert.equal(admit(byteStore, 'tenant-bytes', 'project-bytes', 'bytes-1', largePlan, small).accepted, true);
  const byteBackpressure = admit(byteStore, 'tenant-bytes', 'project-bytes', 'bytes-2', largePlan, small);
  assert.equal(byteBackpressure.code, 'OPS_BACKPRESSURE');
  assert.equal(byteBackpressure.reasonCode, 'PROJECT_QUEUE_FULL');

  await t.test('OPS03.C01 continuously refills both tenants, skips a blocked tenant head, and bounds hierarchical dispatch order', async t => {
    const loadDir = tempDirectory('ah11-fairness-continuous-');
    t.after(() => loadDir.cleanup());
    const limits = readOperationsConfig({
      workerCount: 2, maxQueueRecords: 16, maxPerTenantRecords: 8, maxPerProjectRecords: 4,
      maxQueueBytes: 1_048_576, maxPerTenantBytes: 524_288, maxPerProjectBytes: 262_144,
      maxTenants: 8, maxProjects: 32, maxInFlightGlobal: 2,
      maxInFlightTenant: 1, maxInFlightProject: 1
    });
    const loadStore = openStore(loadDir.databasePath);
    t.after(() => loadStore.close());
    const policy = operationsStoragePolicy(limits);
    const scopeNames = new Map();
    const add = (tenantId, projectId, key) => {
      const accepted = admit(loadStore, tenantId, projectId, key, PLAN, limits);
      assert.equal(accepted.accepted, true, `${tenantId}/${projectId}/${key}`);
      scopeNames.set(accepted.workflowId, `${tenantId}/${projectId}`);
      return accepted;
    };
    for (let index = 0; index < 4; index += 1) {
      add('tenant-a', 'project-a1', `flood-a1-${index}`);
      add('tenant-a', 'project-a2', `flood-a2-${index}`);
      add('tenant-b', 'project-b1', `flood-b-${index}`);
    }
    const first = loadStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, { ownerId: 'review-worker-a', policy }).claim;
    assert.equal(scopeNames.get(first.workflowId), 'tenant-a/project-a1');
    const second = loadStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, { ownerId: 'review-worker-b', policy }).claim;
    assert.equal(scopeNames.get(second.workflowId), 'tenant-b/project-b1');
    assert.equal(loadStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, { ownerId: 'review-worker-c', policy }), null);
    for (const claim of [first, second]) {
      loadStore._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
        jobId: claim.jobId, ownerId: claim.ownerId, generation: claim.generation,
        fence: claim.fence, outcome: 'shutdown'
      });
    }

    const order = [];
    let admissionNumber = 0;
    for (let turn = 0; turn < 24; turn += 1) {
      const selected = loadStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
        ownerId: `review-worker-fair-${turn}`, policy
      }).claim;
      assert.ok(selected);
      const scopeName = scopeNames.get(selected.workflowId);
      order.push(scopeName);
      const acceptedWork = loadStore._operationsReadClaim(OPERATIONS_STORAGE_CAPABILITY, {
        jobId: selected.jobId, ownerId: selected.ownerId,
        generation: selected.generation, fence: selected.fence
      });
      const result = await runBoundedLocalPlan({
        store: loadStore, workflowId: selected.workflowId, ownerId: selected.ownerId,
        fence: selected.fence, planJson: acceptedWork.work.planJson, limitsJson: acceptedWork.work.limitsJson
      });
      assert.equal(result.status, 'completed');
      loadStore._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
        jobId: selected.jobId, ownerId: selected.ownerId, generation: selected.generation,
        fence: selected.fence, outcome: 'completed', childExited: true
      });
      const [tenantId, projectId] = scopeName.split('/');
      add(tenantId, projectId, `flood-refill-${admissionNumber++}`);
    }
    assert.equal(order.filter(name => name.startsWith('tenant-a/')).length, 12);
    assert.equal(order.filter(name => name.startsWith('tenant-b/')).length, 12);
    for (let index = 0; index < order.length; index += 1) {
      assert.notEqual(order[index], order[index + 1], `The dispatcher exceeded its one-turn tenant gap at ${index}.`);
    }
    const aProjects = order.filter(name => name.startsWith('tenant-a/'));
    assert.deepEqual(aProjects.slice(0, 6), [
      'tenant-a/project-a2', 'tenant-a/project-a1', 'tenant-a/project-a2',
      'tenant-a/project-a1', 'tenant-a/project-a2', 'tenant-a/project-a1'
    ]);
    for (let drain = 0; drain < 12; drain += 1) {
      const selected = loadStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
        ownerId: `review-worker-drain-${drain}`, policy
      }).claim;
      assert.ok(selected);
      const acceptedWork = loadStore._operationsReadClaim(OPERATIONS_STORAGE_CAPABILITY, {
        jobId: selected.jobId, ownerId: selected.ownerId,
        generation: selected.generation, fence: selected.fence
      });
      const result = await runBoundedLocalPlan({
        store: loadStore, workflowId: selected.workflowId, ownerId: selected.ownerId,
        fence: selected.fence, planJson: acceptedWork.work.planJson, limitsJson: acceptedWork.work.limitsJson
      });
      assert.equal(result.status, 'completed');
      loadStore._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
        jobId: selected.jobId, ownerId: selected.ownerId, generation: selected.generation,
        fence: selected.fence, outcome: 'completed', childExited: true
      });
    }
    assert.equal(loadStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, { ownerId: 'review-worker-empty', policy }), null);
    add('tenant-a', 'project-a1', 'after-empty-a');
    add('tenant-b', 'project-b1', 'after-empty-b');
    assert.ok(loadStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, { ownerId: 'review-worker-refill', policy }).claim);
  });

  await t.test('OPS03.C02 scope metadata caps stay explicit and do not claim to provide fair admission', () => {
    const metadataDir = tempDirectory('ah11-scope-metadata-cap-');
    t.after(() => metadataDir.cleanup());
    const capPolicy = readOperationsConfig({
      maxQueueRecords: 2, maxPerTenantRecords: 1, maxPerProjectRecords: 1,
      maxQueueBytes: 65_536, maxPerTenantBytes: 32_768, maxPerProjectBytes: 16_384,
      maxTenants: 2, maxProjects: 2
    });
    const metadataStore = openStore(metadataDir.databasePath);
    t.after(() => metadataStore.close());
    assert.equal(admit(metadataStore, 'tenant-meta-a', 'project-meta-a', 'meta-a', PLAN, capPolicy).accepted, true);
    assert.equal(admit(metadataStore, 'tenant-meta-b', 'project-meta-b', 'meta-b', PLAN, capPolicy).accepted, true);
    const tenantLimit = admit(metadataStore, 'tenant-meta-c', 'project-meta-c', 'meta-c', PLAN, capPolicy);
    assert.deepEqual({ accepted: tenantLimit.accepted, code: tenantLimit.code, reasonCode: tenantLimit.reasonCode }, {
      accepted: false, code: 'OPS_BACKPRESSURE', reasonCode: 'SCOPE_CAPACITY'
    });
    const projectLimit = admit(metadataStore, 'tenant-meta-a', 'project-meta-c', 'meta-project', PLAN, capPolicy);
    assert.deepEqual({ accepted: projectLimit.accepted, code: projectLimit.code, reasonCode: projectLimit.reasonCode }, {
      accepted: false, code: 'OPS_BACKPRESSURE', reasonCode: 'SCOPE_CAPACITY'
    });
    const rawMetadata = new DatabaseSync(metadataDir.databasePath, { readOnly: true });
    assert.equal(Number(rawMetadata.prepare('SELECT COUNT(*) AS count FROM operations_tenants').get().count), 2);
    assert.equal(Number(rawMetadata.prepare('SELECT COUNT(*) AS count FROM operations_projects').get().count), 2);
    rawMetadata.close();
  });

  await t.test('OPS03.C03 a local telemetry callback can reenter worker APIs without nesting admission or shutdown', async t => {
    const callbackDir = tempDirectory('ah11-fairness-reentrant-callback-');
    t.after(() => callbackDir.cleanup());
    const callbackStore = openStore(callbackDir.databasePath);
    t.after(() => callbackStore.close());
    const tokenizer = createHmacTokenizer(Buffer.alloc(32, 31));
    t.after(() => tokenizer.destroy());
    let callbackWorker;
    let callbackLoop;
    let nestedStop;
    let callbackAdmission;
    let callbackHealth;
    let sameStartLoop = false;
    let callbackCount = 0;
    const exporter = createTelemetryExporter({
      store: callbackStore,
      tokenizer,
      sink: async records => {
        callbackCount += 1;
        if (callbackCount === 1) {
          callbackAdmission = callbackWorker.submitSyntheticWork({
            trustedSyntheticScope: { tenantId: 'reentrant-tenant', projectId: 'reentrant-project' },
            idempotencyKey: 'reentrant-admission', planJson: PLAN
          });
          callbackHealth = callbackWorker.health();
          sameStartLoop = callbackWorker.start() === callbackLoop;
          nestedStop = callbackWorker.stop('signal');
        }
        return { accepted: true, acceptedCount: records.length };
      },
      limits: { queueRecords: 8, queueBytes: 8192, batchSize: 8, maxAttempts: 1,
        retryDelayMs: 0, sinkTimeoutMs: 100, maxBatchesPerFlush: 2, maxPolicyDropsPerFlush: 2 }
    });
    callbackWorker = createOperationsWorker({
      databasePath: callbackDir.databasePath, ownerId: 'review-worker-reentrant-callback', telemetry: exporter
    });
    t.after(async () => { if (callbackWorker.lifecycle !== 'stopped') await callbackWorker.stop('test'); });
    callbackLoop = callbackWorker.start();
    const first = callbackWorker.submitSyntheticWork({
      trustedSyntheticScope: { tenantId: 'reentrant-tenant', projectId: 'reentrant-project' },
      idempotencyKey: 'reentrant-seed', planJson: PLAN
    });
    assert.equal(first.accepted, true);
    assert.equal((await waitForStatus(callbackWorker,
      { tenantId: 'reentrant-tenant', projectId: 'reentrant-project' }, first.jobId, 'completed')).state, 'completed');
    const flush = exporter.flush();
    const flushResult = await flush;
    assert.equal(callbackCount, 1);
    assert.equal(flushResult.lastErrorCode, null);
    assert.equal(callbackAdmission?.accepted, true);
    assert.equal(sameStartLoop, true);
    assert.equal(callbackHealth?.state, 'accepting');
    assert.ok(nestedStop instanceof Promise);
    const stopResult = await nestedStop;
    await callbackLoop;
    assert.equal(stopResult.stopped, true);
    const reopened = openStore(callbackDir.databasePath);
    const acceptedDuringCallback = reopened._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'reentrant-tenant', projectId: 'reentrant-project', jobId: callbackAdmission.jobId
    });
    assert.equal(acceptedDuringCallback.state, 'queued');
    const raw = new DatabaseSync(callbackDir.databasePath, { readOnly: true });
    assert.equal(Number(raw.prepare('SELECT pending_records FROM operations_meta WHERE singleton=1').get().pending_records), 1);
    assert.equal(Number(raw.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get().in_flight), 0);
    raw.close();
    reopened.close();
  });

  await t.test('OPS03.C04 a slow blocked tenant does not hold a second worker slot from eligible fast work', async t => {
    const mixedDir = tempDirectory('ah11-fairness-mixed-speed-');
    t.after(() => mixedDir.cleanup());
    const mixedWorker = createOperationsWorker({
      databasePath: mixedDir.databasePath, ownerId: 'review-worker-mixed-speed',
      config: { workerCount: 2, maxInFlightGlobal: 2, maxInFlightTenant: 1,
        maxInFlightProject: 1, pollIntervalMs: 10 }
    });
    t.after(async () => { if (mixedWorker.lifecycle !== 'stopped') await mixedWorker.stop('test'); });
    void mixedWorker.start();
    const slowScope = { tenantId: 'mixed-tenant-a', projectId: 'mixed-project-a1' };
    const fastScope = { tenantId: 'mixed-tenant-b', projectId: 'mixed-project-b1' };
    const slowPlan = JSON.stringify({
      kind: 'agent-harness.private-synthetic-plan', version: 1,
      steps: Array.from({ length: 32 }, (_, index) => ({
        id: `m${String(index).padStart(2, '0')}`, operation: 'text.concat',
        dependsOn: index % 12 === 0 ? [] : [`m${String(index - 1).padStart(2, '0')}`],
        args: { parts: index % 12 === 0 ? ['x'.repeat(512)] : [{ $result: `m${String(index - 1).padStart(2, '0')}` }, ''] }
      }))
    });
    const slow = mixedWorker.submitSyntheticWork({ trustedSyntheticScope: slowScope, idempotencyKey: 'mixed-slow', planJson: slowPlan });
    assert.equal(slow.accepted, true);
    const startDeadline = Date.now() + 3_000;
    while (Date.now() < startDeadline && mixedWorker.activeChildCount === 0) await new Promise(resolvePromise => setTimeout(resolvePromise, 2));
    assert.equal(mixedWorker.activeChildCount, 1);
    const runners = spawnSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' });
    assert.equal(runners.status, 0, runners.stderr);
    const runnerPid = Number(runners.stdout.trim().split(/\s+/u).at(-1));
    assert.ok(Number.isSafeInteger(runnerPid) && runnerPid > 1);
    assert.equal(process.kill(runnerPid, 'SIGSTOP'), true);
    const slow2 = mixedWorker.submitSyntheticWork({ trustedSyntheticScope: slowScope, idempotencyKey: 'mixed-slow-queued', planJson: PLAN });
    const fast = mixedWorker.submitSyntheticWork({ trustedSyntheticScope: fastScope, idempotencyKey: 'mixed-fast', planJson: PLAN });
    assert.equal(slow2.accepted, true);
    assert.equal(fast.accepted, true);
    const fastStatus = await waitForStatus(mixedWorker, fastScope, fast.jobId, 'completed', 4_000);
    assert.equal(fastStatus.state, 'completed');
    const slowStatus = mixedWorker.readScopedWorkPage({ trustedSyntheticScope: slowScope, limit: 4 }).items;
    assert.equal(slowStatus.find(item => item.jobId === slow.jobId)?.state, 'running');
    assert.equal(slowStatus.find(item => item.jobId === slow2.jobId)?.state, 'queued');
    const raw = new DatabaseSync(mixedDir.databasePath, { readOnly: true });
    const inFlight = Number(raw.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get().in_flight);
    assert.equal(inFlight, 1);
    assert.ok(inFlight <= 2);
    raw.close();
    try { process.kill(runnerPid, 'SIGCONT'); } catch {}
    const stopped = await mixedWorker.stop('test');
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.childrenReaped, true);
  });
});

test('OPS04_REAL_SIGTERM_JEV_TELEMETRY preserves each controlled transport boundary without a second transport', async t => {
  const temporary = tempDirectory('ah11-jev-sigterm-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  store.close();
  const phases = [
    'before-marker', 'after-marker-before-bytes', 'after-write',
    'response-before-observation', 'observation-before-checkpoint'
  ];
  const results = [];
  for (const phase of phases) {
    const marker = join(temporary.directory, `${phase}.marker`);
    const resultPath = join(temporary.directory, `${phase}.json`);
    const metricsPath = join(temporary.directory, `${phase}.metrics.jsonl`);
    const child = spawn(process.execPath, [
      join(ROOT, 'tests/operations/fixtures/jev-sigterm-child.mjs'),
      temporary.databasePath, phase, marker, resultPath, metricsPath
    ], { cwd: ROOT, env: { ...baseEnvironment(), JEV_OFFLINE_METRICS_FILE: metricsPath }, stdio: ['ignore', 'ignore', 'pipe'] });
    let childStderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { childStderr += chunk; });
    let closeResult;
    const closed = new Promise(resolvePromise => child.once('close', (code, signal) => {
      closeResult = { code, signal };
      resolvePromise(closeResult);
    }));
    try {
        await waitForPath(marker, child);
        const barrier = JSON.parse(readFileSync(marker, 'utf8'));
        assert.equal(barrier.phase, phase);
        const sigtermSentAt = performance.now();
        const sent = child.kill('SIGTERM');
        assert.equal(sent, true, `${phase}; exit=${child.exitCode}; signal=${child.signalCode}; result=${existsSync(resultPath)}`);
        if (sent) METRICS.processSigtermSignalsSent += 1;
        closeResult = await waitForCloseBounded(closed, 3_000);
        if (!closeResult) {
          closeResult = await killOwnedChildAndReap(child, closed);
          assert.ok(closeResult, `The owned ${phase} child did not close within its signal budget.`);
          throw new Error(`The controlled JEV child did not drain after SIGTERM at ${phase}.`);
        }
        const drainElapsedMs = Math.max(0, performance.now() - sigtermSentAt);
        METRICS.processSigtermDrainElapsedMsMax = Math.max(METRICS.processSigtermDrainElapsedMsMax, drainElapsedMs);
        METRICS.processSigtermDrainSamples += 1;
        METRICS.processCloseElapsedMsMax = Math.max(METRICS.processCloseElapsedMsMax, drainElapsedMs);
        METRICS.processCloseSamples += 1;
        assert.ok(drainElapsedMs <= 3_000, `${phase} SIGTERM drain exceeded its aggregate deadline.`);
        METRICS.processRuns += 1;
        assert.equal(closeResult.code, 0, `${phase}: child stderr=${childStderr.slice(0, 2048)}`);
        const result = JSON.parse(readFileSync(resultPath, 'utf8'));
        assert.equal(result.termSeen, true);
        assert.equal(result.blockedExternalNetworkAttempts, 0);
        assert.equal(result.opaqueHoldRetained, phase !== 'before-marker');
        if (phase === 'before-marker') {
          assert.equal(result.attemptCount, 0);
          assert.equal(result.markerCount, 0);
          assert.equal(result.controlledHttpsWrites, 0);
        } else {
          assert.equal(result.attemptCount, 1);
          assert.equal(result.markerCount, 1);
          assert.equal(result.observationCount, 1);
        }
        if (phase === 'after-write') {
          assert.equal(result.dispatchCertainty, 'possible');
          assert.equal(result.controlledHttpsWrites, 1);
        }
        if (phase === 'after-marker-before-bytes') assert.equal(result.controlledHttpsWrites, 0);
        if (phase === 'response-before-observation' || phase === 'observation-before-checkpoint') {
          assert.equal(result.dispatchCertainty, 'response_received');
        }
        for (const [key, value] of Object.entries(JSON.parse(readFileSync(metricsPath, 'utf8').split('\n').filter(Boolean).join('\n')))) {
          if (key === 'controlled_dns_resolve4') METRICS.controlledDnsResolve4 += value;
          if (key === 'controlled_dns_resolve6') METRICS.controlledDnsResolve6 += value;
          if (key === 'controlled_https_request') METRICS.controlledHttpsRequests += value;
          if (key === 'controlled_https_write') METRICS.controlledHttpsWrites += value;
          if (key === 'blocked_external_network_attempt') METRICS.blockedExternalNetworkAttempts += value;
        }
        results.push(result);
    } finally {
      if (!closeResult) {
        closeResult = await killOwnedChildAndReap(child, closed);
        assert.ok(closeResult, `The owned ${phase} child could not be reaped during test cleanup.`);
      }
    }
  }
  assert.equal(results.length, 5);
  assert.equal(METRICS.providerCalls, 0);
  assert.equal(METRICS.controlledHttpsRequests, 3);
  assert.equal(METRICS.controlledHttpsWrites, 3);
  await t.test('OPS04.C01 composes the existing sole JEV transport with owned worker shutdown, telemetry outage, reopen, and higher-fence restart', () => {
    for (const result of results) {
      assert.equal(result.operationsWorkerStopped, true, result.phase);
      assert.equal(result.ownedRunnerReaped, true, result.phase);
      assert.equal(result.operationsWorkStateAfterStop, 'queued', result.phase);
      assert.equal(result.operationsInFlightAfterStop, 0, result.phase);
      assert.equal(result.telemetryCursor, 0, result.phase);
      assert.ok(result.telemetryPendingRecords > 0, result.phase);
      assert.equal(result.telemetrySinkCalls, 1, result.phase);
      assert.equal(result.operationsRestarted, true, result.phase);
      assert.equal(result.operationsWorkflowStateAfterRestart, 'succeeded', result.phase);
      assert.ok(result.operationsFenceAfterRestart > result.operationsFenceBeforeRestart, result.phase);
      assert.ok(result.operationsGenerationAfterRestart > result.operationsGenerationBeforeRestart, result.phase);
      assert.equal(result.providerAttemptCountAfterRestart, result.attemptCount, result.phase);
      assert.equal(result.blockedExternalNetworkAttempts, 0, result.phase);
      assert.ok(result.controlledHttpsWrites <= 1, result.phase);
    }
  });
  await t.test('OPS04.C02 fixture assertion failure after pausing the owned runner executes bounded finally cleanup', async t => {
    const failureDir = tempDirectory('ah11-jev-fixture-failure-');
    t.after(() => failureDir.cleanup());
    const markerDirectory = join(failureDir.directory, 'marker-is-a-directory');
    mkdirSync(markerDirectory);
    const resultPath = join(failureDir.directory, 'failure-result.json');
    const metricsPath = join(failureDir.directory, 'failure-metrics.json');
    const child = spawn(process.execPath, [
      join(ROOT, 'tests/operations/fixtures/jev-sigterm-child.mjs'),
      join(failureDir.directory, 'failure.sqlite'), 'failure-after-runner-pause',
      markerDirectory, resultPath, metricsPath
    ], { cwd: ROOT, env: { ...baseEnvironment(), JEV_OFFLINE_METRICS_FILE: metricsPath }, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr += chunk; });
    const closed = new Promise(resolvePromise => child.once('close', (code, signal) => resolvePromise({ code, signal })));
    let runnerPid = null;
    let ownedGroupEmpty = false;
    try {
      const runnerMarker = `${metricsPath}.runner`;
      await waitForPath(runnerMarker, child, 5_000);
      runnerPid = Number(JSON.parse(readFileSync(runnerMarker, 'utf8')).runnerPid);
      assert.ok(Number.isSafeInteger(runnerPid) && runnerPid > 1);
      const exit = await waitForCloseBounded(closed, 3_000);
      assert.ok(exit, `The failing owned fixture did not close within its bound: ${stderr.slice(0, 2048)}`);
      assert.equal(exit.code, 1, stderr.slice(0, 2048));
      assert.match(stderr, /EISDIR/u);
      assert.equal(existsSync(resultPath), false);
      assert.equal(existsSync(metricsPath), false);
      assert.equal(existsSync(`${markerDirectory}.${child.pid}.tmp`), false);
      assert.deepEqual(readdirSync(markerDirectory), []);
      assert.throws(() => process.kill(runnerPid, 0), error => error.code === 'ESRCH');
      const raw = new DatabaseSync(join(failureDir.directory, 'failure.sqlite'), { readOnly: true });
      const job = raw.prepare("SELECT job_id, workflow_id, state, runner_pid FROM operations_work WHERE idempotency_key='jev-composition-failure-after-runner-pause'").get();
      assert.equal(job.state, 'queued');
      assert.equal(job.runner_pid, null);
      assert.deepEqual({ ...raw.prepare('SELECT pending_records, in_flight FROM operations_meta WHERE singleton=1').get() }, {
        pending_records: 1, in_flight: 0
      });
      assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id=?').get(job.workflow_id).count), 0);
      raw.close();
      ownedGroupEmpty = await waitForOwnedProcessGroupEmpty(child.pid);
      assert.equal(ownedGroupEmpty, true, 'the fixture group is empty before outer cleanup');
    } finally {
      if (!ownedGroupEmpty) {
        ownedGroupEmpty = await cleanupOwnedProcessGroup(child, closed);
        assert.equal(ownedGroupEmpty, true, 'the dedicated fixture process group is reaped');
      }
    }

    for (const markerMode of ['missing', 'partial']) {
      const mode = `failure-runner-marker-${markerMode}`;
      const markerDir = tempDirectory(`ah11-jev-marker-${markerMode}-`);
      t.after(() => markerDir.cleanup());
      const databasePath = join(markerDir.directory, 'marker-control.sqlite');
      const markerPath = join(markerDir.directory, 'marker-control.json');
      const resultPath = join(markerDir.directory, 'marker-result.json');
      const metricsPath = join(markerDir.directory, 'marker-metrics.json');
      const child = spawn(process.execPath, [
        join(ROOT, 'tests/operations/fixtures/jev-sigterm-child.mjs'),
        databasePath, mode, markerPath, resultPath, metricsPath
      ], { cwd: ROOT, env: { ...baseEnvironment(), JEV_OFFLINE_METRICS_FILE: metricsPath }, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', chunk => { stderr += chunk; });
      const closed = new Promise(resolvePromise => child.once('close', (code, signal) => resolvePromise({ code, signal })));
      let runnerPid = null;
      let ownedGroupEmpty = false;
      try {
        await waitForPath(markerPath, child, 5_000);
        assert.deepEqual(JSON.parse(readFileSync(markerPath, 'utf8')), {
          phase: mode, stage: 'runner-marker-ready'
        });
        const runnerMarker = `${metricsPath}.runner`;
        if (markerMode === 'missing') assert.equal(existsSync(runnerMarker), false);
        else assert.equal(readFileSync(runnerMarker, 'utf8'), '{"runnerPid":');
        assert.throws(() => JSON.parse(readFileSync(runnerMarker, 'utf8')),
          markerMode === 'missing' ? error => error.code === 'ENOENT' : SyntaxError);
        assert.equal(runnerPid, null, 'marker failure occurs before runner PID assignment');

        runnerPid = readRunnerPidFromOwnedDatabase(databasePath, `jev-composition-${mode}`);
        assert.ok(Number.isSafeInteger(runnerPid) && runnerPid > 1);
        assert.equal(processGroupId(runnerPid), child.pid, 'durable runner PID belongs to this isolated fixture group');
        assert.equal(child.kill('SIGTERM'), true);
        const exit = await waitForCloseBounded(closed, 3_000);
        assert.ok(exit, `The marker-failure fixture did not close within its bound: ${stderr.slice(0, 2_048)}`);
        assert.equal(exit.code, 1, stderr.slice(0, 2_048));
        assert.match(stderr, /Injected (?:partial|missing) runner marker failure/u);
        assert.equal(await waitForPidExit(runnerPid), true, 'fixture finally reaps the exact durable runner PID');
        ownedGroupEmpty = await waitForOwnedProcessGroupEmpty(child.pid);
        assert.equal(ownedGroupEmpty, true, 'no owned descendants remain before outer cleanup');

        const reopened = new DatabaseSync(databasePath, { readOnly: true });
        const job = reopened.prepare(
          'SELECT job_id, workflow_id, state, runner_pid FROM operations_work WHERE idempotency_key=?'
        ).get(`jev-composition-${mode}`);
        assert.equal(job.state, 'queued');
        assert.equal(job.runner_pid, null);
        assert.deepEqual({ ...reopened.prepare(
          'SELECT pending_records, in_flight FROM operations_meta WHERE singleton=1'
        ).get() }, { pending_records: 1, in_flight: 0 });
        assert.equal(Number(reopened.prepare(
          'SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id=?'
        ).get(job.workflow_id).count), 0);
        reopened.close();
        assert.equal(existsSync(resultPath), false);
        assert.equal(existsSync(metricsPath), false);
      } finally {
        if (!ownedGroupEmpty) {
          ownedGroupEmpty = await cleanupOwnedProcessGroup(child, closed);
          assert.equal(ownedGroupEmpty, true, 'the dedicated marker-failure process group is reaped');
        }
      }
    }
  });
  const reopened = openStore(temporary.databasePath);
  for (const result of results.filter(item => item.attemptCount > 0)) {
    const attempt = reopened.getAttempt(`ops-attempt-${result.phase}`);
    assert.equal(attempt.authorityHoldRef, `synthetic-local-bookkeeping:hold-${result.phase}`);
  }
  reopened.close();
});

test('OPS05_LOCAL_CRASH_CANCEL_FENCE executes and checkpoints an actual child plan, then rejects stale cancellation', async t => {
  const temporary = tempDirectory('ah11-worker-run-');
  t.after(() => temporary.cleanup());
  const scope = { tenantId: 'synthetic-tenant-resume', projectId: 'synthetic-project-resume' };
  const worker = createOperationsWorker({ databasePath: temporary.databasePath, ownerId: 'ops-worker:resume' });
  t.after(async () => { await worker.stop('test'); });
  void worker.start();
  const submitted = worker.submitSyntheticWork({ trustedSyntheticScope: scope, idempotencyKey: 'resume-1', planJson: PLAN });
  assert.equal(submitted.accepted, true);
  const done = await waitForStatus(worker, scope, submitted.jobId, 'completed');
  assert.equal(done.state, 'completed');
  const duplicate = worker.submitSyntheticWork({ trustedSyntheticScope: scope, idempotencyKey: 'resume-1', planJson: PLAN });
  assert.equal(duplicate.jobId, submitted.jobId);
  assert.equal(duplicate.duplicate, true);
  assert.throws(() => worker.cancelSyntheticWork({
    trustedSyntheticScope: scope, jobId: submitted.jobId, expectedGeneration: Math.max(0, done.generation - 1)
  }), error => error.code === 'CONCURRENT_MODIFICATION');
  const repeatedCompletedCancel = worker.cancelSyntheticWork({
    trustedSyntheticScope: scope, jobId: submitted.jobId, expectedGeneration: done.generation
  });
  assert.deepEqual(repeatedCompletedCancel, { accepted: false, state: 'completed', generation: done.generation });
  const stopped = await worker.stop('test');
  assert.equal(stopped.stopped, true);
  assert.equal(worker.activeChildCount, 0);

  const reopened = openStore(temporary.databasePath);
  const workflow = reopened.getWorkflow(submitted.workflowId);
  const checkpoint = reopened.getCheckpoint(submitted.workflowId);
  assert.equal(workflow.state, 'succeeded');
  assert.equal(JSON.parse(checkpoint.data.completedResultsJson).sum.output, 42);
  reopened.close();
  assert.equal(METRICS.providerCalls, 0);

  await t.test('OPS05.C01 reaps an uncooperative owned child at its monotonic deadline and settles an expired current fence', async t => {
    const deadlineDir = tempDirectory('ah11-runtime-deadline-');
    t.after(() => deadlineDir.cleanup());
    const deadlineWorker = createOperationsWorker({
      databasePath: deadlineDir.databasePath,
      ownerId: 'review-worker',
      config: { maxJobRuntimeMs: 250, childKillGraceMs: 40, childReapReserveMs: 200, shutdownTimeoutMs: 1_000 }
    });
    const stopWorker = async () => { if (deadlineWorker.lifecycle !== 'stopped') await deadlineWorker.stop('test'); };
    t.after(stopWorker);
    void deadlineWorker.start();
    const deadlineScope = { tenantId: 'deadline-tenant', projectId: 'deadline-project' };
    const deadlinePlan = JSON.stringify({
      kind: 'agent-harness.private-synthetic-plan', version: 1,
      steps: Array.from({ length: 32 }, (_, index) => ({
        id: `d${String(index).padStart(2, '0')}`, operation: 'text.concat',
        dependsOn: index % 12 === 0 ? [] : [`d${String(index - 1).padStart(2, '0')}`],
        args: { parts: index % 12 === 0 ? ['x'.repeat(512)] : [{ $result: `d${String(index - 1).padStart(2, '0')}` }, ''] }
      }))
    });
    const accepted = deadlineWorker.submitSyntheticWork({
      trustedSyntheticScope: deadlineScope, idempotencyKey: 'deadline-child', planJson: deadlinePlan,
      limitsJson: JSON.stringify({ maxElapsedMs: 200, maxStepMs: 50 })
    });
    assert.equal(accepted.accepted, true);
    const childDeadline = Date.now() + 3_000;
    while (Date.now() < childDeadline && deadlineWorker.activeChildCount === 0) await new Promise(resolvePromise => setTimeout(resolvePromise, 1));
    assert.equal(deadlineWorker.activeChildCount, 1);
    const pgrep = spawnSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' });
    assert.equal(pgrep.status, 0, pgrep.stderr);
    const runnerPid = Number(pgrep.stdout.trim().split(/\s+/u).at(-1));
    assert.ok(Number.isSafeInteger(runnerPid) && runnerPid > 1);
    const deadlineObservedAt = performance.now();
    assert.equal(process.kill(runnerPid, 'SIGSTOP'), true);
    const leaseDb = new DatabaseSync(deadlineDir.databasePath);
    leaseDb.prepare('UPDATE workflows SET lease_expires_ms = 0 WHERE workflow_id = ?').run(accepted.workflowId);
    leaseDb.close();
    const parked = await waitForStatus(deadlineWorker, deadlineScope, accepted.jobId, 'parked', 2_000);
    while (deadlineWorker.activeChildCount !== 0 && Date.now() < childDeadline + 2_000) await new Promise(resolvePromise => setTimeout(resolvePromise, 2));
    assert.equal(deadlineWorker.activeChildCount, 0);
    const actualCloseElapsedMs = performance.now() - deadlineObservedAt;
    METRICS.runnerDeadlineCloseElapsedMsMax = Math.max(METRICS.runnerDeadlineCloseElapsedMsMax, actualCloseElapsedMs);
    METRICS.runnerDeadlineCloseSamples += 1;
    assert.ok(actualCloseElapsedMs < 1_500, `Owned child close took ${actualCloseElapsedMs} ms after deadline monitoring began.`);
    assert.equal(parked.reasonCode, 'LOCAL_EXECUTION_STOPPED');
    assert.throws(() => process.kill(runnerPid, 0), error => error.code === 'ESRCH');
    assert.equal(deadlineWorker.health().process.lastSafeErrorCode, 'OPS_RUNNER_DEADLINE');
    const stopped = await deadlineWorker.stop('test');
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.childrenReaped, true);
    const reopened = openStore(deadlineDir.databasePath);
    const workflow = reopened.getWorkflow(accepted.workflowId);
    const checkpoint = reopened.getCheckpoint(accepted.workflowId);
    const raw = new DatabaseSync(deadlineDir.databasePath, { readOnly: true });
    assert.equal(workflow.state, 'review_required');
    assert.equal(workflow.leaseOwner, null);
    assert.equal(raw.prepare('SELECT state FROM operations_work WHERE job_id = ?').get(accepted.jobId).state, 'parked');
    assert.equal(Number(raw.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get().in_flight), 0);
    assert.equal(Number(raw.prepare('SELECT pending_records FROM operations_meta WHERE singleton=1').get().pending_records), 1);
    assert.equal(Number(raw.prepare('SELECT reserved_disk_bytes FROM operations_meta WHERE singleton=1').get().reserved_disk_bytes) > 0, true);
    assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id=?').get(accepted.workflowId).count), 0);
    assert.equal(checkpoint.sequence, 1);
    raw.close();
    reopened.close();
  });

  await t.test('OPS05.C02 active cancellation commits one coherent terminal state after actual child exit and reopen', async t => {
    const cancelDir = tempDirectory('ah11-active-cancel-');
    t.after(() => cancelDir.cleanup());
    const cancelWorker = createOperationsWorker({ databasePath: cancelDir.databasePath, ownerId: 'review-worker' });
    t.after(async () => { if (cancelWorker.lifecycle !== 'stopped') await cancelWorker.stop('test'); });
    void cancelWorker.start();
    const cancelScope = { tenantId: 'cancel-tenant', projectId: 'cancel-project' };
    const cancelPlan = JSON.stringify({
      kind: 'agent-harness.private-synthetic-plan', version: 1,
      steps: Array.from({ length: 32 }, (_, index) => ({
        id: `c${String(index).padStart(2, '0')}`, operation: 'text.concat',
        dependsOn: index % 12 === 0 ? [] : [`c${String(index - 1).padStart(2, '0')}`],
        args: { parts: index % 12 === 0 ? ['x'.repeat(512)] : [{ $result: `c${String(index - 1).padStart(2, '0')}` }, ''] }
      }))
    });
    const accepted = cancelWorker.submitSyntheticWork({
      trustedSyntheticScope: cancelScope, idempotencyKey: 'cancel-running', planJson: cancelPlan
    });
    assert.equal(accepted.accepted, true);
    const childDeadline = Date.now() + 3_000;
    while (Date.now() < childDeadline && cancelWorker.activeChildCount === 0) await new Promise(resolvePromise => setTimeout(resolvePromise, 1));
    assert.equal(cancelWorker.activeChildCount, 1);
    const pgrep = spawnSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' });
    assert.equal(pgrep.status, 0, pgrep.stderr);
    const runnerPid = Number(pgrep.stdout.trim().split(/\s+/u).at(-1));
    assert.ok(Number.isSafeInteger(runnerPid) && runnerPid > 1);
    assert.equal(process.kill(runnerPid, 'SIGSTOP'), true);
    const requested = cancelWorker.cancelSyntheticWork({
      trustedSyntheticScope: cancelScope, jobId: accepted.jobId, expectedGeneration: 1
    });
    assert.deepEqual(requested, {
      accepted: true, state: 'cancellation_requested', generation: 1,
      ownerId: 'review-worker', fence: 1
    });
    const during = new DatabaseSync(cancelDir.databasePath, { readOnly: true });
    assert.equal(during.prepare('SELECT state, cancellation_requested FROM workflows WHERE workflow_id=?').get(accepted.workflowId).state, 'running');
    assert.equal(during.prepare('SELECT cancellation_requested FROM workflows WHERE workflow_id=?').get(accepted.workflowId).cancellation_requested, 1);
    assert.equal(during.prepare('SELECT state FROM operations_work WHERE job_id=?').get(accepted.jobId).state, 'running');
    during.close();
    assert.equal(process.kill(runnerPid, 'SIGCONT'), true);
    const cancelled = await waitForStatus(cancelWorker, cancelScope, accepted.jobId, 'cancelled', 3_000);
    assert.equal(cancelled.generation, 1);
    assert.equal(cancelWorker.activeChildCount, 0);
    const stopped = await cancelWorker.stop('test');
    assert.equal(stopped.stopped, true);
    const reopened = openStore(cancelDir.databasePath);
    const workflow = reopened.getWorkflow(accepted.workflowId);
    const raw = new DatabaseSync(cancelDir.databasePath, { readOnly: true });
    assert.equal(workflow.state, 'cancelled');
    assert.equal(workflow.cancellationRequested, true);
    assert.equal(raw.prepare('SELECT state FROM operations_work WHERE job_id=?').get(accepted.jobId).state, 'cancelled');
    assert.deepEqual({ ...raw.prepare('SELECT pending_records, pending_bytes, in_flight FROM operations_meta WHERE singleton=1').get() }, {
      pending_records: 0, pending_bytes: 0, in_flight: 0
    });
    assert.equal(Number(raw.prepare("SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=? AND event_type='operations_work_cancelled'").get(accepted.workflowId).count), 1);
    const beforeRepeated = Number(raw.prepare('SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=?').get(accepted.workflowId).count);
    raw.close();
    const repeated = reopened._operationsCancel(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: cancelScope.tenantId, projectId: cancelScope.projectId,
      jobId: accepted.jobId, expectedGeneration: 1
    });
    assert.deepEqual(repeated, { accepted: false, state: 'cancelled', generation: 1 });
    const afterRepeated = new DatabaseSync(cancelDir.databasePath, { readOnly: true });
    assert.equal(Number(afterRepeated.prepare('SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=?').get(accepted.workflowId).count), beforeRepeated);
    afterRepeated.close();
    reopened.close();
  });

  await t.test('OPS05.C03 queued cancellation is durable and idempotent without creating a claim', () => {
    const queuedDir = tempDirectory('ah11-queued-cancel-');
    t.after(() => queuedDir.cleanup());
    const queuedStore = openStore(queuedDir.databasePath);
    t.after(() => queuedStore.close());
    const queued = admit(queuedStore, 'tenant-queued-cancel', 'project-queued-cancel', 'queued-cancel');
    const cancelled = queuedStore._operationsCancel(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'tenant-queued-cancel', projectId: 'project-queued-cancel',
      jobId: queued.jobId, expectedGeneration: 0
    });
    assert.deepEqual(cancelled, { accepted: true, state: 'cancelled', generation: 0 });
    assert.equal(queuedStore.getWorkflow(queued.workflowId).state, 'cancelled');
    assert.deepEqual(queuedStore._operationsCancel(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'tenant-queued-cancel', projectId: 'project-queued-cancel',
      jobId: queued.jobId, expectedGeneration: 0
    }), { accepted: false, state: 'cancelled', generation: 0 });
    const raw = new DatabaseSync(queuedDir.databasePath, { readOnly: true });
    assert.deepEqual({ ...raw.prepare('SELECT pending_records, pending_bytes, in_flight, reserved_event_slots, reserved_disk_bytes FROM operations_meta WHERE singleton=1').get() }, {
      pending_records: 0, pending_bytes: 0, in_flight: 0, reserved_event_slots: 0, reserved_disk_bytes: 0
    });
    raw.close();
  });

  await t.test('OPS05.C04 accepted nonprefixed and maximum-length owner IDs execute in the actual child runner', async t => {
    const invalidOwnerPath = join(temporary.directory, 'invalid-owner.sqlite');
    assert.throws(() => createOperationsWorker({ databasePath: invalidOwnerPath, ownerId: 'r'.repeat(129) }), /identity/u);
    assert.equal(existsSync(invalidOwnerPath), false);
    for (const [index, ownerId] of ['review-worker', 'r'.repeat(128)].entries()) {
      const ownerDir = tempDirectory(`ah11-owner-domain-${index}-`);
      t.after(() => ownerDir.cleanup());
      const ownerWorker = createOperationsWorker({ databasePath: ownerDir.databasePath, ownerId });
      t.after(async () => { if (ownerWorker.lifecycle !== 'stopped') await ownerWorker.stop('test'); });
      void ownerWorker.start();
      const ownerScope = { tenantId: `owner-tenant-${index}`, projectId: `owner-project-${index}` };
      const ownerJob = ownerWorker.submitSyntheticWork({
        trustedSyntheticScope: ownerScope, idempotencyKey: `owner-${index}`, planJson: PLAN
      });
      assert.equal(ownerJob.accepted, true);
      const finished = await waitForStatus(ownerWorker, ownerScope, ownerJob.jobId, 'completed');
      assert.equal(finished.state, 'completed');
      const stopResult = await ownerWorker.stop('test');
      assert.equal(stopResult.stopped, true);
      const reopened = openStore(ownerDir.databasePath);
      assert.equal(reopened.getWorkflow(ownerJob.workflowId).state, 'succeeded');
      assert.equal(reopened._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
        tenantId: ownerScope.tenantId, projectId: ownerScope.projectId, jobId: ownerJob.jobId
      }).state, 'completed');
      reopened.close();
    }
  });

  await t.test('OPS05.C05 expired cleanup from a superseded owner cannot mutate a newer claim', () => {
    const ownerDir = tempDirectory('ah11-superseded-owner-');
    t.after(() => ownerDir.cleanup());
    let ownerNow = 30_000;
    const ownerStore = openStore(ownerDir.databasePath, { clock: () => ownerNow });
    t.after(() => ownerStore.close());
    const accepted = admit(ownerStore, 'fence-tenant', 'fence-project', 'fence-race');
    const policy = operationsStoragePolicy(readOperationsConfig());
    const oldClaim = ownerStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'review-worker-old-owner', policy
    }).claim;
    ownerStore._operationsSetRunnerPid(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: oldClaim.jobId, ownerId: oldClaim.ownerId,
      generation: oldClaim.generation, fence: oldClaim.fence, runnerPid: unusedProcessId()
    });
    ownerNow = oldClaim.leaseExpiresAtMs + 1;
    assert.equal(ownerStore._operationsExpiredClaims(OPERATIONS_STORAGE_CAPABILITY, { policy }).items[0].jobId, accepted.jobId);
    const newer = ownerStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'review-worker-new-owner', policy, recoverableJobIds: [accepted.jobId]
    }).claim;
    assert.equal(newer.generation, oldClaim.generation + 1);
    assert.equal(newer.fence, oldClaim.fence + 1);
    assert.throws(() => ownerStore._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: oldClaim.jobId, ownerId: oldClaim.ownerId,
      generation: oldClaim.generation, fence: oldClaim.fence, outcome: 'stopped', childExited: true
    }), error => error.code === 'STALE_FENCE');
    const current = new DatabaseSync(ownerDir.databasePath, { readOnly: true });
    const row = current.prepare('SELECT state, worker_id, generation, fence_token FROM operations_work WHERE job_id=?').get(accepted.jobId);
    assert.deepEqual({ ...row }, {
      state: 'running', worker_id: 'review-worker-new-owner',
      generation: newer.generation, fence_token: newer.fence
    });
    assert.equal(Number(current.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get().in_flight), 1);
    current.close();
  });

  await t.test('OPS05.C09 expired recovery reuses an occupied global slot before another tenant claims', () => {
    const recoveryDir = tempDirectory('ah11-global-recovery-slot-');
    t.after(() => recoveryDir.cleanup());
    const configInput = {
      workerCount: 1, maxInFlightGlobal: 1, maxInFlightTenant: 1, maxInFlightProject: 1
    };
    const config = readOperationsConfig(configInput);
    const policy = operationsStoragePolicy(config);
    let now = 50_000;
    const store = openStore(recoveryDir.databasePath, { clock: () => now });
    t.after(() => store.close());
    const first = admit(store, 'tenant-a', 'project-a', 'expired-slot-a', PLAN, configInput);
    const oldClaim = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'review-owner-a', policy
    }).claim;
    assert.equal(oldClaim.jobId, first.jobId);
    const oldRunnerPid = unusedProcessId();
    store._operationsSetRunnerPid(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: oldClaim.jobId, ownerId: oldClaim.ownerId,
      generation: oldClaim.generation, fence: oldClaim.fence, runnerPid: oldRunnerPid
    });
    const second = admit(store, 'tenant-b', 'project-b', 'expired-slot-b', PLAN, configInput);

    now = oldClaim.leaseExpiresAtMs + 1;
    assert.throws(() => process.kill(oldRunnerPid, 0), error => error.code === 'ESRCH');
    const expired = store._operationsExpiredClaims(OPERATIONS_STORAGE_CAPABILITY, { policy });
    assert.equal(expired.incomplete, false);
    assert.equal(expired.items[0].jobId, first.jobId);
    assert.equal(expired.items[0].runnerPid, oldRunnerPid);
    assert.equal(store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'review-owner-b', policy
    }), null);

    const recovered = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'review-owner-b', policy, recoverableJobIds: [first.jobId]
    });
    assert.equal(recovered.claim.jobId, first.jobId);
    assert.equal(recovered.claim.generation, oldClaim.generation + 1);
    assert.equal(recovered.claim.fence, oldClaim.fence + 1);
    const afterRecovery = new DatabaseSync(recoveryDir.databasePath, { readOnly: true });
    assert.equal(afterRecovery.prepare('SELECT state FROM operations_work WHERE job_id=?').get(second.jobId).state, 'queued');
    assert.deepEqual({ ...afterRecovery.prepare('SELECT pending_records, in_flight FROM operations_meta WHERE singleton=1').get() }, {
      pending_records: 2, in_flight: 1
    });
    assert.deepEqual({ ...afterRecovery.prepare('SELECT in_flight FROM operations_tenants WHERE tenant_id=?').get('tenant-a') }, { in_flight: 1 });
    assert.deepEqual({ ...afterRecovery.prepare('SELECT in_flight FROM operations_tenants WHERE tenant_id=?').get('tenant-b') }, { in_flight: 0 });
    afterRecovery.close();
    store.close();

    const reopened = openStore(recoveryDir.databasePath, { clock: () => now });
    assert.equal(reopened._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'tenant-a', projectId: 'project-a', jobId: first.jobId
    }).state, 'running');
    assert.equal(reopened._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'tenant-b', projectId: 'project-b', jobId: second.jobId
    }).state, 'queued');
    const reopenedDb = new DatabaseSync(recoveryDir.databasePath, { readOnly: true });
    assert.deepEqual({ ...reopenedDb.prepare('SELECT pending_records, in_flight FROM operations_meta WHERE singleton=1').get() }, {
      pending_records: 2, in_flight: 1
    });
    assert.equal(reopened._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'review-owner-after-reopen', policy, recoverableJobIds: [first.jobId]
    }), null, 'An exact recovery ID cannot claim queued work while the reclaimed lease occupies the global slot.');
    reopenedDb.close();
    reopened.close();
  });

  await t.test('OPS05.C10 expired cancellation recovery atomically cancels workflow and releases reservations', () => {
    const recoveryDir = tempDirectory('ah11-cancel-expired-recovery-');
    t.after(() => recoveryDir.cleanup());
    const configInput = {
      workerCount: 1, maxInFlightGlobal: 1, maxInFlightTenant: 1, maxInFlightProject: 1
    };
    const config = readOperationsConfig(configInput);
    const policy = operationsStoragePolicy(config);
    let now = 70_000;
    const store = openStore(recoveryDir.databasePath, { clock: () => now });
    t.after(() => store.close());
    const accepted = admit(store, 'cancel-tenant', 'cancel-project', 'cancel-expired', PLAN, configInput);
    const claim = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'review-cancel-owner', policy
    }).claim;
    const runnerPid = unusedProcessId();
    store._operationsSetRunnerPid(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: claim.jobId, ownerId: claim.ownerId,
      generation: claim.generation, fence: claim.fence, runnerPid
    });
    assert.deepEqual(store._operationsCancel(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'cancel-tenant', projectId: 'cancel-project',
      jobId: accepted.jobId, expectedGeneration: claim.generation
    }), {
      accepted: true, state: 'cancellation_requested', generation: claim.generation,
      ownerId: claim.ownerId, fence: claim.fence
    });
    now = claim.leaseExpiresAtMs + 1;
    assert.equal(store._operationsExpiredClaims(OPERATIONS_STORAGE_CAPABILITY, { policy }).items[0].jobId, accepted.jobId);
    assert.equal(store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'review-cancel-recovery', policy, recoverableJobIds: [accepted.jobId]
    }), null);

    store.close();
    const reopened = openStore(recoveryDir.databasePath, { clock: () => now });
    t.after(() => reopened.close());
    const workflow = reopened.getWorkflow(accepted.workflowId);
    assert.equal(workflow.state, 'cancelled');
    assert.equal(workflow.cancellationRequested, true);
    assert.equal(workflow.leaseOwner, null);
    assert.equal(workflow.leaseExpiresAtMs, null);
    const raw = new DatabaseSync(recoveryDir.databasePath, { readOnly: true });
    assert.deepEqual({ ...raw.prepare('SELECT state, worker_id, runner_pid, lease_expires_ms, reserved_event_slots, reserved_disk_bytes FROM operations_work WHERE job_id=?').get(accepted.jobId) }, {
      state: 'cancelled', worker_id: null, runner_pid: null, lease_expires_ms: null,
      reserved_event_slots: 0, reserved_disk_bytes: 0
    });
    assert.deepEqual({ ...raw.prepare('SELECT pending_records, pending_bytes, in_flight, reserved_event_slots, reserved_disk_bytes FROM operations_meta WHERE singleton=1').get() }, {
      pending_records: 0, pending_bytes: 0, in_flight: 0, reserved_event_slots: 0, reserved_disk_bytes: 0
    });
    assert.equal(Number(raw.prepare("SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=? AND event_type='operations_work_cancelled' AND from_state='running' AND to_state='cancelled'").get(accepted.workflowId).count), 1);
    assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id=?').get(accepted.workflowId).count), 0);
    raw.close();
    reopened.close();
    const afterCloseReopen = openStore(recoveryDir.databasePath, { clock: () => now });
    assert.equal(afterCloseReopen.getWorkflow(accepted.workflowId).state, 'cancelled');
    assert.equal(afterCloseReopen.getWorkflow(accepted.workflowId).leaseOwner, null);
    assert.equal(afterCloseReopen._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'cancel-tenant', projectId: 'cancel-project', jobId: accepted.jobId
    }).state, 'cancelled');
    afterCloseReopen.close();
  });

  await t.test('OPS05.C11 exact expired-row recovery cannot bypass a tenant cap across projects', () => {
    const recoveryDir = tempDirectory('ah11-tenant-recovery-slot-');
    t.after(() => recoveryDir.cleanup());
    const configInput = {
      workerCount: 2, maxInFlightGlobal: 2, maxInFlightTenant: 1, maxInFlightProject: 1
    };
    const config = readOperationsConfig(configInput);
    const policy = operationsStoragePolicy(config);
    let now = 60_000;
    const store = openStore(recoveryDir.databasePath, { clock: () => now });
    t.after(() => store.close());
    const expired = admit(store, 'tenant-a', 'project-a-first', 'tenant-expired', PLAN, configInput);
    const prior = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'tenant-slot-owner', policy
    }).claim;
    assert.equal(prior.jobId, expired.jobId);
    const queued = admit(store, 'tenant-a', 'project-z-queued', 'tenant-queued', PLAN, configInput);
    now = prior.leaseExpiresAtMs + 1;
    const recovered = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'tenant-slot-recovery', policy, recoverableJobIds: [expired.jobId]
    });
    assert.equal(recovered.claim.jobId, expired.jobId);
    assert.equal(recovered.claim.generation, prior.generation + 1);
    const raw = new DatabaseSync(recoveryDir.databasePath, { readOnly: true });
    assert.equal(raw.prepare('SELECT state FROM operations_work WHERE job_id=?').get(queued.jobId).state, 'queued');
    assert.deepEqual({ ...raw.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get() }, { in_flight: 1 });
    assert.deepEqual({ ...raw.prepare('SELECT in_flight FROM operations_tenants WHERE tenant_id=?').get('tenant-a') }, { in_flight: 1 });
    assert.deepEqual({ ...raw.prepare('SELECT in_flight FROM operations_projects WHERE tenant_id=? AND project_id=?').get('tenant-a', 'project-a-first') }, { in_flight: 1 });
    assert.deepEqual({ ...raw.prepare('SELECT in_flight FROM operations_projects WHERE tenant_id=? AND project_id=?').get('tenant-a', 'project-z-queued') }, { in_flight: 0 });
    raw.close();
    store.close();
    const reopened = openStore(recoveryDir.databasePath, { clock: () => now });
    assert.equal(reopened._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'tenant-slot-after-reopen', policy, recoverableJobIds: [expired.jobId]
    }), null);
    reopened.close();
  });

  await t.test('OPS05.C12 two actual SQLite connections race exact expired recoveries under all three caps', async t => {
    const recoveryDir = tempDirectory('ah11-concurrent-recovery-');
    t.after(() => recoveryDir.cleanup());
    const configInput = {
      workerCount: 2, maxInFlightGlobal: 2, maxInFlightTenant: 1, maxInFlightProject: 1
    };
    const config = readOperationsConfig(configInput);
    const policy = operationsStoragePolicy(config);
    let now = 80_000;
    const store = openStore(recoveryDir.databasePath, { clock: () => now });
    t.after(() => store.close());
    const first = admit(store, 'tenant-a', 'project-a', 'race-expired-a', PLAN, configInput);
    const second = admit(store, 'tenant-b', 'project-b', 'race-expired-b', PLAN, configInput);
    const third = admit(store, 'tenant-c', 'project-c', 'race-queued-c', PLAN, configInput);
    const firstClaim = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, { ownerId: 'race-original-a', policy }).claim;
    const secondClaim = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, { ownerId: 'race-original-b', policy }).claim;
    assert.equal(firstClaim.jobId, first.jobId);
    assert.equal(secondClaim.jobId, second.jobId);
    now = Math.max(firstClaim.leaseExpiresAtMs, secondClaim.leaseExpiresAtMs) + 1;
    store.close();

    const gatePath = join(recoveryDir.directory, 'release-recovery-race');
    const processes = [
      { ownerId: 'race-recovery-a', jobId: first.jobId },
      { ownerId: 'race-recovery-b', jobId: second.jobId }
    ].map(({ ownerId, jobId }) => {
      const readyPath = join(recoveryDir.directory, `${ownerId}.ready`);
      const child = spawn(process.execPath, [
        join(ROOT, 'tests/operations/fixtures/recovery-claim-child.mjs'),
        recoveryDir.databasePath, String(now), ownerId, jobId, readyPath, gatePath, JSON.stringify(configInput)
      ], { cwd: ROOT, env: baseEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const closed = new Promise(resolvePromise => child.once('close', (code, signal) => resolvePromise({ code, signal })));
      return { ownerId, jobId, readyPath, child, closed, get stdout() { return stdout; }, get stderr() { return stderr; } };
    });
    METRICS.processRuns += processes.length;
    try {
      for (const processInfo of processes) await waitForPath(processInfo.readyPath, processInfo.child, 5_000);
      writeFileSync(gatePath, 'released');
      const exits = await Promise.all(processes.map(async processInfo =>
        waitForCloseBounded(processInfo.closed, 5_000)));
      assert.ok(exits.every(Boolean), 'Both independent claim processes must close within their bound.');
      for (const [index, processInfo] of processes.entries()) {
        assert.equal(exits[index].code, 0, processInfo.stderr);
        assert.deepEqual(JSON.parse(processInfo.stdout.trim()), {
          ownerId: processInfo.ownerId,
          claim: { jobId: processInfo.jobId, generation: 2, fence: 2 },
          incomplete: false,
          ownedRunnerCount: 0
        });
      }
    } finally {
      if (!existsSync(gatePath)) writeFileSync(gatePath, 'released');
      for (const processInfo of processes) {
        if (processInfo.child.exitCode === null && processInfo.child.signalCode === null) {
          try { processInfo.child.kill('SIGKILL'); } catch {}
          await waitForCloseBounded(processInfo.closed, 1_000);
        }
      }
    }

    const check = openStore(recoveryDir.databasePath, { clock: () => now });
    const after = new DatabaseSync(recoveryDir.databasePath, { readOnly: true });
    assert.deepEqual({ ...after.prepare('SELECT pending_records, in_flight FROM operations_meta WHERE singleton=1').get() }, {
      pending_records: 3, in_flight: 2
    });
    assert.deepEqual({ ...after.prepare('SELECT in_flight FROM operations_tenants WHERE tenant_id=?').get('tenant-a') }, { in_flight: 1 });
    assert.deepEqual({ ...after.prepare('SELECT in_flight FROM operations_tenants WHERE tenant_id=?').get('tenant-b') }, { in_flight: 1 });
    assert.deepEqual({ ...after.prepare('SELECT in_flight FROM operations_tenants WHERE tenant_id=?').get('tenant-c') }, { in_flight: 0 });
    for (const job of [first, second]) {
      const row = after.prepare('SELECT state, generation, fence_token FROM operations_work WHERE job_id=?').get(job.jobId);
      assert.deepEqual({ ...row }, { state: 'running', generation: 2, fence_token: 2 });
      assert.equal(Number(after.prepare("SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=? AND event_type='operations_work_claimed'").get(job.workflowId).count), 2);
    }
    assert.equal(after.prepare('SELECT state FROM operations_work WHERE job_id=?').get(third.jobId).state, 'queued');
    after.close();
    assert.equal(check._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'race-repeat-no-extra-slot', policy, recoverableJobIds: [first.jobId, second.jobId]
    }), null);
    check.close();
    const reopened = openStore(recoveryDir.databasePath, { clock: () => now });
    assert.equal(reopened._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'tenant-c', projectId: 'project-c', jobId: third.jobId
    }).state, 'queued');
    reopened.close();

    // Two independent supervisors must serialize the terminal-public-API
    // cleanup and let exactly one claim the next tenant at a cap of one.
    const terminalRaceDir = tempDirectory('ah11-terminal-recovery-race-');
    t.after(() => terminalRaceDir.cleanup());
    const terminalConfigInput = {
      workerCount: 1, maxInFlightGlobal: 1, maxInFlightTenant: 1, maxInFlightProject: 1
    };
    const terminalConfig = readOperationsConfig(terminalConfigInput);
    const terminalPolicy = operationsStoragePolicy(terminalConfig);
    let terminalNow = 90_000;
    const terminalStore = openStore(terminalRaceDir.databasePath, { clock: () => terminalNow });
    const terminal = admit(terminalStore, 'public-expired-tenant', 'public-expired-project',
      'terminal-race-expired', PLAN, terminalConfigInput);
    const terminalPrior = terminalStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'terminal-race-prior-owner', policy: terminalPolicy
    }).claim;
    const nextTenantJob = admit(terminalStore, 'public-next-tenant', 'public-next-project',
      'terminal-race-next', PLAN, terminalConfigInput);
    terminalStore.close();
    const terminalCrash = crashAfterPublicWorkflowMutation(terminalRaceDir.databasePath, {
      mutation: 'succeeded', now: terminalNow, workflowId: terminalPrior.workflowId,
      ownerId: terminalPrior.ownerId, fence: terminalPrior.fence, revision: terminalPrior.revision,
      attemptId: 'terminal-race-transition', holdRef: null
    });
    assert.equal(terminalCrash.mutation, 'succeeded');
    terminalNow = terminalPrior.leaseExpiresAtMs + 1;
    const terminalGate = join(terminalRaceDir.directory, 'release-terminal-recovery-race');
    const terminalSupervisors = ['terminal-race-supervisor-a', 'terminal-race-supervisor-b'].map(ownerId => {
      const readyPath = join(terminalRaceDir.directory, `${ownerId}.ready`);
      const child = spawn(process.execPath, [
        join(ROOT, 'tests/operations/fixtures/recovery-claim-child.mjs'),
        terminalRaceDir.databasePath, String(terminalNow), ownerId, terminal.jobId,
        readyPath, terminalGate, JSON.stringify(terminalConfigInput)
      ], { cwd: ROOT, env: baseEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      const closed = new Promise(resolvePromise => child.once('close', (code, signal) => resolvePromise({ code, signal })));
      return { ownerId, readyPath, child, closed, get stdout() { return stdout; }, get stderr() { return stderr; } };
    });
    METRICS.processRuns += terminalSupervisors.length;
    try {
      for (const supervisor of terminalSupervisors) await waitForPath(supervisor.readyPath, supervisor.child, 5_000);
      writeFileSync(terminalGate, 'released');
      const outcomes = await Promise.all(terminalSupervisors.map(async supervisor => ({
        supervisor, exit: await waitForCloseBounded(supervisor.closed, 5_000)
      })));
      assert.ok(outcomes.every(item => item.exit), 'Both terminal recovery supervisors must finish within the bound.');
      const results = outcomes.map(({ supervisor, exit }) => {
        assert.equal(exit.code, 0, supervisor.stderr);
        const result = JSON.parse(supervisor.stdout.trim());
        assert.equal(result.ownerId, supervisor.ownerId);
        assert.equal(result.incomplete, false);
        assert.equal(result.ownedRunnerCount, 0);
        return result;
      });
      assert.equal(results.filter(result => result.claim?.jobId === nextTenantJob.jobId).length, 1,
        'exactly one supervisor can claim the queued next tenant');
      assert.equal(results.filter(result => result.claim === null).length, 1,
        'the losing supervisor observes the committed terminal reconciliation and occupied cap');
    } finally {
      if (!existsSync(terminalGate)) writeFileSync(terminalGate, 'released');
      for (const supervisor of terminalSupervisors) {
        if (supervisor.child.exitCode === null && supervisor.child.signalCode === null) {
          try { supervisor.child.kill('SIGKILL'); } catch {}
          await waitForCloseBounded(supervisor.closed, 1_000);
        }
      }
    }
    const terminalRaw = new DatabaseSync(terminalRaceDir.databasePath, { readOnly: true });
    try {
      assert.equal(terminalRaw.prepare('SELECT state FROM operations_work WHERE job_id=?').get(terminal.jobId).state,
        'completed');
      assert.deepEqual({ ...terminalRaw.prepare(`SELECT pending_records, in_flight,
        reserved_event_slots, reserved_disk_bytes FROM operations_meta WHERE singleton=1`).get() }, {
        pending_records: 1, in_flight: 1,
        reserved_event_slots: Number(terminalRaw.prepare('SELECT reserved_event_slots FROM operations_work WHERE job_id=?')
          .get(nextTenantJob.jobId).reserved_event_slots),
        reserved_disk_bytes: Number(terminalRaw.prepare('SELECT reserved_disk_bytes FROM operations_work WHERE job_id=?')
          .get(nextTenantJob.jobId).reserved_disk_bytes)
      });
      assert.equal(Number(terminalRaw.prepare(`SELECT COUNT(*) AS count FROM workflow_events
        WHERE workflow_id=? AND event_type='operations_work_completed'`).get(terminal.workflowId).count), 1);
      assert.equal(terminalRaw.prepare('SELECT state FROM operations_work WHERE job_id=?').get(nextTenantJob.jobId).state,
        'running');
    } finally {
      terminalRaw.close();
    }
    const terminalReopen = openStore(terminalRaceDir.databasePath, { clock: () => terminalNow });
    assert.equal(terminalReopen.getWorkflow(terminal.workflowId).leaseOwner, null);
    assert.equal(terminalReopen._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'public-expired-tenant', projectId: 'public-expired-project', jobId: terminal.jobId
    }).state, 'completed');
    terminalReopen.close();
  });

  await t.test('OPS05.C13 expired cancellation reconciliation releases capacity before later queued work', () => {
    const recoveryDir = tempDirectory('ah11-cancel-recovery-next-claim-');
    t.after(() => recoveryDir.cleanup());
    const configInput = { workerCount: 1, maxInFlightGlobal: 1, maxInFlightTenant: 1, maxInFlightProject: 1 };
    const config = readOperationsConfig(configInput);
    const policy = operationsStoragePolicy(config);
    let now = 90_000;
    const store = openStore(recoveryDir.databasePath, { clock: () => now });
    t.after(() => store.close());
    const expired = admit(store, 'a-tenant', 'a-project', 'cancel-before-queued', PLAN, configInput);
    const prior = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, { ownerId: 'cancel-prior-owner', policy }).claim;
    const queued = admit(store, 'z-tenant', 'z-project', 'queued-after-cancel', PLAN, configInput);
    assert.equal(store._operationsCancel(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'a-tenant', projectId: 'a-project', jobId: expired.jobId,
      expectedGeneration: prior.generation
    }).accepted, true);
    now = prior.leaseExpiresAtMs + 1;
    const next = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'queued-after-cancel-owner', policy, recoverableJobIds: [expired.jobId]
    });
    assert.equal(next.claim.jobId, queued.jobId);
    const raw = new DatabaseSync(recoveryDir.databasePath, { readOnly: true });
    assert.deepEqual({ ...raw.prepare('SELECT state, cancellation_requested, lease_owner, lease_expires_ms FROM workflows WHERE workflow_id=?').get(expired.workflowId) }, {
      state: 'cancelled', cancellation_requested: 1, lease_owner: null, lease_expires_ms: null
    });
    assert.equal(raw.prepare('SELECT state FROM operations_work WHERE job_id=?').get(expired.jobId).state, 'cancelled');
    assert.equal(raw.prepare('SELECT state FROM operations_work WHERE job_id=?').get(queued.jobId).state, 'running');
    assert.deepEqual({ ...raw.prepare('SELECT pending_records, in_flight FROM operations_meta WHERE singleton=1').get() }, {
      pending_records: 1, in_flight: 1
    });
    assert.deepEqual({ ...raw.prepare('SELECT in_flight FROM operations_tenants WHERE tenant_id=?').get('a-tenant') }, { in_flight: 0 });
    assert.deepEqual({ ...raw.prepare('SELECT in_flight FROM operations_tenants WHERE tenant_id=?').get('z-tenant') }, { in_flight: 1 });
    assert.equal(Number(raw.prepare("SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=? AND event_type='operations_work_cancelled'").get(expired.workflowId).count), 1);
    raw.close();
  });

  await t.test('OPS05.C14 unknown expired work keeps its hold and releases only its local slot before queued work', () => {
    const recoveryDir = tempDirectory('ah11-unknown-recovery-next-claim-');
    t.after(() => recoveryDir.cleanup());
    const configInput = { workerCount: 1, maxInFlightGlobal: 1, maxInFlightTenant: 1, maxInFlightProject: 1 };
    const config = readOperationsConfig(configInput);
    const policy = operationsStoragePolicy(config);
    let now = 100_000;
    const store = openStore(recoveryDir.databasePath, { clock: () => now });
    t.after(() => store.close());
    const expired = admit(store, 'a-tenant', 'a-project', 'unknown-before-queued', PLAN, configInput);
    const prior = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, { ownerId: 'unknown-prior-owner', policy }).claim;
    store.recordDispatchIntent({
      workflowId: prior.workflowId, ownerId: prior.ownerId, fence: prior.fence,
      expectedRevision: prior.revision, attemptId: 'unknown-recovery-attempt',
      logicalOperationRef: 'unknown-recovery-logical',
      authorityHoldRef: 'synthetic-local-bookkeeping:unknown-recovery-hold',
      transportAttemptId: 'unknown-recovery-transport', eventId: 'unknown-recovery-intent'
    });
    const queued = admit(store, 'z-tenant', 'z-project', 'queued-after-unknown', PLAN, configInput);
    assert.equal(store._operationsCancel(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'a-tenant', projectId: 'a-project', jobId: expired.jobId,
      expectedGeneration: prior.generation
    }).accepted, true);
    now = prior.leaseExpiresAtMs + 1;
    const next = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'queued-after-unknown-owner', policy, recoverableJobIds: [expired.jobId]
    });
    assert.equal(next.claim.jobId, queued.jobId);
    const unknown = store._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'a-tenant', projectId: 'a-project', jobId: expired.jobId
    });
    assert.equal(unknown.state, 'unknown');
    assert.equal(store.getWorkflow(expired.workflowId).state, 'reconciliation_pending');
    assert.equal(store.getWorkflow(expired.workflowId).cancellationRequested, true);
    const attempt = store.getAttempt('unknown-recovery-attempt');
    assert.equal(attempt.state, 'intent');
    assert.equal(attempt.authorityHoldRef, 'synthetic-local-bookkeeping:unknown-recovery-hold');
    const raw = new DatabaseSync(recoveryDir.databasePath, { readOnly: true });
    const reservations = raw.prepare(`SELECT
      (SELECT SUM(reserved_disk_bytes) FROM operations_work) AS work_disk,
      (SELECT SUM(reserved_event_slots) FROM operations_work) AS work_events,
      reserved_disk_bytes, reserved_event_slots FROM operations_meta WHERE singleton=1`).get();
    assert.equal(Number(reservations.reserved_disk_bytes), Number(reservations.work_disk));
    assert.equal(Number(reservations.reserved_event_slots), Number(reservations.work_events));
    assert.equal(Number(raw.prepare('SELECT reserved_disk_bytes FROM operations_work WHERE job_id=?').get(expired.jobId).reserved_disk_bytes) > 0, true);
    assert.equal(Number(raw.prepare('SELECT reserved_event_slots FROM operations_work WHERE job_id=?').get(expired.jobId).reserved_event_slots) > 0, true);
    assert.equal(Number(raw.prepare("SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=? AND event_type='operations_work_unknown'").get(expired.workflowId).count), 1);
    raw.close();
    store._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: next.claim.jobId, ownerId: next.claim.ownerId,
      generation: next.claim.generation, fence: next.claim.fence, outcome: 'stopped', childExited: true
    });
    assert.equal(store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'no-unknown-redispatch', policy, recoverableJobIds: [expired.jobId]
    }), null);
    assert.equal(store.getAttempt('unknown-recovery-attempt').authorityHoldRef,
      'synthetic-local-bookkeeping:unknown-recovery-hold');
    assert.equal(store._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'a-tenant', projectId: 'a-project', jobId: expired.jobId
    }).state, 'unknown');
  });

  await t.test('OPS05.C15 expired current-fence outcome-unknown work reconciles after reopen without releasing its hold', async t => {
    await assertExpiredCurrentFenceReconciles(t, {
      caseName: 'public-unknown',
      mutation: 'unknown',
      expectedWorkflowState: 'reconciliation_pending',
      expectedWorkState: 'unknown',
      expectedEventType: 'operations_work_unknown',
      expectedAttemptState: 'outcome_unknown',
      async afterRecovery({ databasePath, caseName, expired, queued, now, attemptId, holdRef }) {
        let lateStore = openStore(databasePath, { clock: () => now });
        try {
          const lateLease = lateStore.acquireLease({
            workflowId: expired.workflowId, ownerId: `${caseName}-late-owner`, ttlMs: 5_000,
            eventId: `${caseName}-late-lease`
          });
          const receipt = lateStore.recordResponseReceipt({
            workflowId: expired.workflowId, ownerId: lateLease.ownerId, fence: lateLease.fence,
            expectedRevision: lateLease.revision, attemptId,
            receiptId: `${caseName}-late-receipt`, outcome: 'completed', nextState: 'succeeded',
            responseBytes: Buffer.from('synthetic late result receipt'),
            nextCheckpoint: lateStore.getCheckpoint(expired.workflowId).data,
            eventId: `${caseName}-late-response`
          });
          assert.ok(receipt.receiptId.endsWith('-late-receipt'));
          const lateSnapshot = recoverySnapshot(databasePath, expired.jobId, queued.jobId,
            expired.workflowId, attemptId);
          assert.equal(lateSnapshot.work.state, 'unknown');
          assert.equal(lateSnapshot.work.reserved_disk_bytes > 0, true);
          assert.equal(lateSnapshot.work.reserved_event_slots > 0, true);
          assert.equal(lateSnapshot.meta.pending_records, 2);
          assert.equal(lateSnapshot.meta.in_flight, 1);
          assert.equal(lateSnapshot.attempt.state, 'response_received');
          assert.equal(lateSnapshot.attempt.authority_hold_ref, holdRef);
          assert.equal(lateSnapshot.workflow.state, 'reconciliation_pending');
          lateStore.close();
          lateStore = null;
          const lateReopen = openStore(databasePath, { clock: () => now });
          try {
            assert.equal(lateReopen._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
              tenantId: 'public-expired-tenant', projectId: 'public-expired-project', jobId: expired.jobId
            }).state, 'unknown');
            assert.equal(lateReopen.getAttempt(attemptId).state, 'response_received');
            assert.equal(lateReopen.getAttempt(attemptId).authorityHoldRef, holdRef);
            assert.equal(recoverySnapshot(databasePath, expired.jobId, queued.jobId,
              expired.workflowId, attemptId).work.reserved_disk_bytes,
            lateSnapshot.work.reserved_disk_bytes);
          } finally {
            lateReopen.close();
          }
        } finally {
          try { lateStore?.close(); } catch {}
        }
      }
    });

    // A committed dispatch intent is the complementary unresolved control: it
    // enters recovery from awaiting_response and remains an intent until an
    // authoritative local receipt exists.
    await assertExpiredCurrentFenceReconciles(t, {
      caseName: 'public-intent-control',
      mutation: 'intent',
      expectedWorkflowState: 'awaiting_response',
      expectedWorkflowStateAfterRecovery: 'reconciliation_pending',
      expectedWorkState: 'unknown',
      expectedEventType: 'operations_work_unknown',
      expectedAttemptState: 'intent'
    });
    await assertUnknownRecoveryFailsClosedAtResourceBoundary();
  });

  await t.test('OPS05.C16 expired succeeded current-fence work reconciles to completed after reopen', async t => {
    await assertExpiredCurrentFenceReconciles(t, {
      caseName: 'public-succeeded',
      mutation: 'succeeded',
      expectedWorkflowState: 'succeeded',
      expectedWorkState: 'completed',
      expectedEventType: 'operations_work_completed'
    });
  });

  await t.test('OPS05.C17 expired failed current-fence work reconciles to failed after reopen', async t => {
    await assertExpiredCurrentFenceReconciles(t, {
      caseName: 'public-failed',
      mutation: 'failed',
      expectedWorkflowState: 'failed',
      expectedWorkState: 'failed',
      expectedEventType: 'operations_work_failed'
    });
  });

  await t.test('OPS05.C18 expired cancellation with cleared workflow lease reconciles after reopen', async t => {
    await assertExpiredCurrentFenceReconciles(t, {
      caseName: 'public-cancelled',
      mutation: 'cancelled',
      expectedWorkflowState: 'cancelled',
      expectedWorkState: 'cancelled',
      expectedEventType: 'operations_work_cancelled'
    });
  });

  await t.test('OPS05.C06 cancellation of already-reconciliation-pending unknown work persists its flag without settling its hold', () => {
    const unknownDir = tempDirectory('ah11-reconciliation-cancel-');
    t.after(() => unknownDir.cleanup());
    let unknownNow = 40_000;
    const unknownStore = openStore(unknownDir.databasePath, { clock: () => unknownNow });
    const accepted = admit(unknownStore, 'unknown-cancel-tenant', 'unknown-cancel-project', 'unknown-cancel');
    const policy = operationsStoragePolicy(readOperationsConfig());
    const claim = unknownStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'review-worker-unknown-owner', policy
    }).claim;
    unknownStore._operationsSetRunnerPid(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: claim.jobId, ownerId: claim.ownerId, generation: claim.generation,
      fence: claim.fence, runnerPid: unusedProcessId()
    });
    unknownStore.recordDispatchIntent({
      workflowId: claim.workflowId, ownerId: claim.ownerId, fence: claim.fence,
      expectedRevision: claim.revision, attemptId: 'unknown-cancel-attempt',
      logicalOperationRef: 'unknown-cancel-logical', authorityHoldRef: 'synthetic-local-bookkeeping:unknown-cancel-hold',
      transportAttemptId: 'unknown-cancel-transport', eventId: 'unknown-cancel-intent'
    });
    unknownNow = claim.leaseExpiresAtMs + 1;
    unknownStore._operationsExpiredClaims(OPERATIONS_STORAGE_CAPABILITY, { policy });
    assert.equal(unknownStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'review-worker-unknown-recovery', policy, recoverableJobIds: [accepted.jobId]
    }), null);
    assert.equal(unknownStore.getWorkflow(accepted.workflowId).state, 'reconciliation_pending');
    const cancellation = unknownStore._operationsCancel(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'unknown-cancel-tenant', projectId: 'unknown-cancel-project',
      jobId: accepted.jobId, expectedGeneration: claim.generation
    });
    assert.deepEqual(cancellation, { accepted: true, state: 'unknown', generation: claim.generation });
    const once = new DatabaseSync(unknownDir.databasePath, { readOnly: true });
    const workflow = unknownStore.getWorkflow(accepted.workflowId);
    assert.equal(workflow.state, 'reconciliation_pending');
    assert.equal(workflow.cancellationRequested, true);
    assert.equal(once.prepare('SELECT state FROM operations_work WHERE job_id=?').get(accepted.jobId).state, 'unknown');
    assert.equal(unknownStore.getAttempt('unknown-cancel-attempt').state, 'intent');
    assert.equal(unknownStore.getAttempt('unknown-cancel-attempt').authorityHoldRef,
      'synthetic-local-bookkeeping:unknown-cancel-hold');
    const eventCount = Number(once.prepare('SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=?').get(accepted.workflowId).count);
    const reservation = Number(once.prepare('SELECT reserved_disk_bytes FROM operations_meta WHERE singleton=1').get().reserved_disk_bytes);
    once.close();
    const repeated = unknownStore._operationsCancel(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'unknown-cancel-tenant', projectId: 'unknown-cancel-project',
      jobId: accepted.jobId, expectedGeneration: claim.generation
    });
    assert.deepEqual(repeated, { accepted: true, state: 'unknown', generation: claim.generation });
    unknownStore.close();
    const reopened = openStore(unknownDir.databasePath, { clock: () => unknownNow });
    assert.equal(reopened.getWorkflow(accepted.workflowId).cancellationRequested, true);
    assert.equal(reopened.getAttempt('unknown-cancel-attempt').authorityHoldRef,
      'synthetic-local-bookkeeping:unknown-cancel-hold');
    const after = new DatabaseSync(unknownDir.databasePath, { readOnly: true });
    assert.equal(Number(after.prepare('SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=?').get(accepted.workflowId).count), eventCount);
    assert.equal(Number(after.prepare('SELECT reserved_disk_bytes FROM operations_meta WHERE singleton=1').get().reserved_disk_bytes), reservation);
    assert.equal(Number(after.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get().in_flight), 0);
    after.close();
    reopened.close();
  });

  await t.test('OPS05.C07 parked cancellation rejects stale generations and commits one terminal event', () => {
    const parkedDir = tempDirectory('ah11-parked-cancel-');
    t.after(() => parkedDir.cleanup());
    const parkedStore = openStore(parkedDir.databasePath);
    t.after(() => parkedStore.close());
    const accepted = admit(parkedStore, 'parked-tenant', 'parked-project', 'parked-cancel');
    const ownerId = 'review-worker-parked';
    const claim = parkedStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId, policy: operationsStoragePolicy(readOperationsConfig())
    }).claim;
    const parked = parkedStore._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: accepted.jobId, ownerId, generation: claim.generation,
      fence: claim.fence, outcome: 'stopped', childExited: true
    });
    assert.equal(parked.state, 'parked');
    assert.equal(parkedStore.getWorkflow(accepted.workflowId).state, 'review_required');
    assert.throws(() => parkedStore._operationsCancel(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'parked-tenant', projectId: 'parked-project', jobId: accepted.jobId,
      expectedGeneration: claim.generation - 1
    }), error => error.code === 'CONCURRENT_MODIFICATION');
    const cancelled = parkedStore._operationsCancel(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'parked-tenant', projectId: 'parked-project', jobId: accepted.jobId,
      expectedGeneration: claim.generation
    });
    assert.deepEqual(cancelled, { accepted: true, state: 'cancelled', generation: claim.generation });
    assert.equal(parkedStore.getWorkflow(accepted.workflowId).state, 'cancelled');
    const raw = new DatabaseSync(parkedDir.databasePath, { readOnly: true });
    assert.equal(Number(raw.prepare("SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=? AND event_type='operations_work_cancelled'").get(accepted.workflowId).count), 1);
    raw.close();
  });

  await t.test('OPS05.C08 actual supervisor crash preserves a committed step and two restarted workers claim it once', async t => {
    const crashDir = tempDirectory('ah11-worker-crash-race-');
    t.after(() => crashDir.cleanup());
    const fixture = join(ROOT, 'tests/operations/fixtures/worker-supervisor-child.mjs');
    const children = new Set();
    const runnerPids = new Set();
    const openFixture = (ownerId, idempotencyKey = 'worker-crash-recovery') => {
      const child = spawn(process.execPath, [fixture, crashDir.databasePath, ownerId, idempotencyKey], {
        cwd: ROOT, env: baseEnvironment(), stdio: ['ignore', 'pipe', 'pipe']
      });
      METRICS.processRuns += 1;
      children.add(child);
      let output = '';
      const records = [];
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => {
        output += chunk;
        const lines = output.split(/\r?\n/u);
        output = lines.pop() ?? '';
        for (const line of lines) {
          try { records.push(JSON.parse(line)); } catch {}
        }
      });
      child.stderr.on('data', chunk => { output += chunk; });
      const closed = new Promise(resolvePromise => child.once('close', (code, signal) => {
        children.delete(child);
        resolvePromise({ code, signal });
      }));
      const ready = (async () => {
        const deadline = Date.now() + 8_000;
        while (Date.now() < deadline) {
          const record = records.find(item => item.event === 'ready');
          if (record) return record;
          if (child.exitCode !== null || child.signalCode !== null) break;
          await new Promise(resolvePromise => setTimeout(resolvePromise, 2));
        }
        throw new Error(`The owned supervisor did not publish its admission: ${output}`);
      })();
      return { child, closed, ready, records };
    };
    const waitUntil = async (predicate, timeoutMs, message) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = predicate();
        if (result) return result;
        await new Promise(resolvePromise => setTimeout(resolvePromise, 2));
      }
      throw new Error(message);
    };
    const pidIsGone = pid => {
      try {
        process.kill(pid, 0);
        const ps = spawnSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' });
        return ps.status !== 0 || /^Z/u.test(ps.stdout.trim());
      } catch (error) {
        return error?.code === 'ESRCH';
      }
    };
    t.after(async () => {
      for (const pid of runnerPids) {
        try { process.kill(pid, 'SIGCONT'); } catch {}
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
      for (const child of children) {
        try { child.kill('SIGKILL'); } catch {}
      }
      await Promise.all([...children].map(child => new Promise(resolvePromise => {
        if (child.exitCode !== null || child.signalCode !== null) return resolvePromise();
        child.once('close', resolvePromise);
        setTimeout(resolvePromise, 1_500).unref();
      })));
    });

    const oldOwner = 'ops-worker:crashed-supervisor';
    const crashed = openFixture(oldOwner);
    const admitted = await crashed.ready;
    assert.equal(admitted.accepted, true);
    const inspect = new DatabaseSync(crashDir.databasePath, { readOnly: true });
    const committed = await waitUntil(() => {
      const row = inspect.prepare(`
        SELECT w.state, w.runner_pid, w.generation, w.fence_token,
          f.state AS workflow_state, f.checkpoint_sequence,
          c.payload_json
        FROM operations_work w JOIN workflows f ON f.workflow_id=w.workflow_id
        JOIN workflow_checkpoints c ON c.workflow_id=f.workflow_id AND c.sequence=f.checkpoint_sequence
        WHERE w.job_id=?
      `).get(admitted.jobId);
      if (!row || row.state !== 'running' || !Number.isSafeInteger(row.runner_pid)
          || row.checkpoint_sequence < 2 || row.workflow_state !== 'running') return null;
      try {
        const payload = JSON.parse(row.payload_json);
        const state = payload.data ?? payload;
        const completed = JSON.parse(state.completedResultsJson ?? '{}');
        return Object.keys(completed).length > 0 ? { row, completedCount: Object.keys(completed).length } : null;
      } catch { return null; }
    }, 8_000, 'The actual runner did not durably commit a local step before the crash barrier.');
    const oldRunnerPid = Number(committed.row.runner_pid);
    runnerPids.add(oldRunnerPid);
    assert.equal(process.kill(oldRunnerPid, 'SIGSTOP'), true);
    const priorGeneration = Number(committed.row.generation);
    const priorFence = Number(committed.row.fence_token);
    assert.ok(priorGeneration >= 1);
    assert.ok(priorFence >= 1);
    const beforeCrash = {
      state: committed.row.state,
      workflowState: committed.row.workflow_state,
      checkpointSequence: Number(committed.row.checkpoint_sequence),
      committedStepCount: committed.completedCount,
      generation: priorGeneration,
      fence: priorFence,
      inFlight: Number(inspect.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get().in_flight),
      attempts: Number(inspect.prepare('SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id=?').get(admitted.workflowId).count)
    };
    assert.equal(beforeCrash.inFlight, 1);
    assert.equal(beforeCrash.attempts, 0);

    const crashStartedAt = performance.now();
    assert.equal(crashed.child.kill('SIGKILL'), true);
    METRICS.processSigkillSignalsSent += 1;
    const supervisorClose = await waitForCloseBounded(crashed.closed, 2_000);
    assert.ok(supervisorClose);
    assert.equal(supervisorClose.signal, 'SIGKILL');
    const supervisorCloseElapsedMs = performance.now() - crashStartedAt;
    METRICS.processCloseElapsedMsMax = Math.max(METRICS.processCloseElapsedMsMax, supervisorCloseElapsedMs);
    METRICS.processCloseSamples += 1;
    assert.equal(process.kill(oldRunnerPid, 'SIGKILL'), true);
    METRICS.processSigkillSignalsSent += 1;
    const runnerCloseStartedAt = performance.now();
    const runnerGone = await waitUntil(() => pidIsGone(oldRunnerPid), 3_000,
      'The exact orphaned runner PID did not exit after its explicit SIGKILL.');
    assert.equal(runnerGone, true);
    const runnerCloseElapsedMs = performance.now() - runnerCloseStartedAt;
    METRICS.processCloseElapsedMsMax = Math.max(METRICS.processCloseElapsedMsMax, runnerCloseElapsedMs);
    METRICS.processCloseSamples += 1;
    runnerPids.delete(oldRunnerPid);
    inspect.close();

    const recoveryClock = new DatabaseSync(crashDir.databasePath);
    recoveryClock.prepare('UPDATE workflows SET lease_expires_ms=0 WHERE workflow_id=?').run(admitted.workflowId);
    recoveryClock.prepare('UPDATE operations_work SET lease_expires_ms=0 WHERE job_id=?').run(admitted.jobId);
    recoveryClock.close();
    const afterCrashDb = new DatabaseSync(crashDir.databasePath, { readOnly: true });
    const crashedRows = afterCrashDb.prepare(`
      SELECT w.state, w.runner_pid, w.generation, f.state AS workflow_state, f.checkpoint_sequence
      FROM operations_work w JOIN workflows f ON f.workflow_id=w.workflow_id WHERE w.job_id=?
    `).get(admitted.jobId);
    assert.equal(crashedRows.state, 'running');
    assert.equal(crashedRows.workflow_state, 'running');
    assert.equal(Number(crashedRows.generation), priorGeneration);
    assert.equal(Number(afterCrashDb.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get().in_flight), 1);
    assert.equal(Number(afterCrashDb.prepare('SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id=?').get(admitted.workflowId).count), 0);
    afterCrashDb.close();

    const raceA = openFixture('ops-worker:recovery-race-a');
    const raceB = openFixture('ops-worker:recovery-race-b');
    const [readyA, readyB] = await Promise.all([raceA.ready, raceB.ready]);
    assert.equal(readyA.jobId, admitted.jobId);
    assert.equal(readyB.jobId, admitted.jobId);
    assert.equal(readyA.duplicate, true);
    assert.equal(readyB.duplicate, true);
    const completeDb = new DatabaseSync(crashDir.databasePath, { readOnly: true });
    let finalRow;
    try {
      finalRow = await waitUntil(() => {
      const row = completeDb.prepare(`
        SELECT w.state, w.worker_id, w.runner_pid, w.generation, w.fence_token,
          f.state AS workflow_state, f.fence_token AS workflow_fence, f.checkpoint_sequence
        FROM operations_work w JOIN workflows f ON f.workflow_id=w.workflow_id WHERE w.job_id=?
      `).get(admitted.jobId);
      return row?.state === 'completed' ? row : null;
      }, 12_000, 'The restarted worker race did not finish the admitted local plan.');
    } catch (error) {
      const row = completeDb.prepare(`
        SELECT w.state, w.worker_id, w.runner_pid, w.generation, w.fence_token, w.lease_expires_ms, w.reason_code,
          f.state AS workflow_state, f.fence_token AS workflow_fence, f.lease_owner, f.lease_expires_ms AS workflow_lease,
          f.checkpoint_sequence
        FROM operations_work w JOIN workflows f ON f.workflow_id=w.workflow_id WHERE w.job_id=?
      `).get(admitted.jobId);
      const events = completeDb.prepare('SELECT event_type, revision, fence_token FROM workflow_events WHERE workflow_id=? ORDER BY sequence').all(admitted.workflowId);
      const meta = completeDb.prepare('SELECT pending_records, in_flight, reserved_disk_bytes FROM operations_meta WHERE singleton=1').get();
      const latestPayload = JSON.parse(completeDb.prepare('SELECT payload_json FROM workflow_checkpoints WHERE workflow_id=? ORDER BY sequence DESC LIMIT 1').get(admitted.workflowId).payload_json);
      const latestState = latestPayload.data ?? latestPayload;
      throw new Error(`${error.message} ${JSON.stringify({ row, meta, events, checkpoint: {
        pendingStepId: latestState.pendingStepId, budget: latestState.budget,
        resultCount: Object.keys(JSON.parse(latestState.completedResultsJson ?? '{}')).length,
        resultBytes: Buffer.byteLength(latestState.completedResultsJson ?? '', 'utf8')
      }, readyA, readyB, raceAExit: raceA.child.exitCode, raceBExit: raceB.child.exitCode })}`);
    }
    const claimCount = Number(completeDb.prepare("SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=? AND event_type='operations_work_claimed'").get(admitted.workflowId).count);
    const attemptCount = Number(completeDb.prepare('SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id=?').get(admitted.workflowId).count);
    const counters = completeDb.prepare('SELECT pending_records, pending_bytes, in_flight, reserved_event_slots, reserved_disk_bytes FROM operations_meta WHERE singleton=1').get();
    const checkpointPayload = JSON.parse(completeDb.prepare('SELECT payload_json FROM workflow_checkpoints WHERE workflow_id=? ORDER BY sequence DESC LIMIT 1').get(admitted.workflowId).payload_json);
    const checkpointState = checkpointPayload.data ?? checkpointPayload;
    const finalResults = JSON.parse(checkpointState.completedResultsJson);
    assert.equal(finalRow.workflow_state, 'succeeded');
    assert.equal(Number(finalRow.generation), priorGeneration + 1);
    assert.equal(Number(finalRow.fence_token), priorFence + 1);
    assert.equal(Number(finalRow.workflow_fence), priorFence + 1);
    assert.equal(claimCount, 2, 'One initial and one recovered claim event must exist; the competing owner cannot claim twice.');
    assert.equal(attemptCount, 0);
    assert.equal(Object.keys(finalResults).length, 32);
    assert.deepEqual({ ...counters }, {
      pending_records: 0, pending_bytes: 0, in_flight: 0, reserved_event_slots: 0, reserved_disk_bytes: 0
    });
    completeDb.close();
    const racersSignalAt = performance.now();
    for (const supervisor of [raceA, raceB]) {
      assert.equal(supervisor.child.kill('SIGTERM'), true);
      METRICS.processSigtermSignalsSent += 1;
    }
    const closedRacers = await Promise.all([raceA.closed, raceB.closed]);
    assert.deepEqual(closedRacers.map(item => item.code), [0, 0]);
    const racersCloseElapsedMs = performance.now() - racersSignalAt;
    METRICS.processCloseElapsedMsMax = Math.max(METRICS.processCloseElapsedMsMax, racersCloseElapsedMs);
    METRICS.processCloseSamples += 2;
    const reopened = openStore(crashDir.databasePath);
    const finalWorkflow = reopened.getWorkflow(admitted.workflowId);
    const finalCheckpoint = reopened.getCheckpoint(admitted.workflowId);
    const finalEventCount = reopened.listEvents({ workflowId: admitted.workflowId }).length;
    assert.throws(() => reopened._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: admitted.jobId, ownerId: oldOwner, generation: priorGeneration,
      fence: priorFence, outcome: 'stopped', childExited: true
    }), error => error.code === 'STALE_FENCE');
    assert.equal(reopened.listEvents({ workflowId: admitted.workflowId }).length, finalEventCount);
    assert.equal(finalWorkflow.state, 'succeeded');
    assert.equal(Object.keys(JSON.parse(finalCheckpoint.data.completedResultsJson)).length, 32);
    reopened.close();
    assert.ok(supervisorCloseElapsedMs < 2_000);
    assert.ok(runnerCloseElapsedMs < 3_000);
    assert.ok(racersCloseElapsedMs < 2_000);
  });

  let logicalNow = 10_000;
  const stale = tempDirectory('ah11-stale-runner-');
  t.after(() => stale.cleanup());
  const staleStore = openStore(stale.databasePath, { clock: () => logicalNow });
  t.after(() => staleStore.close());
  const policy = operationsStoragePolicy(readOperationsConfig());
  const liveWork = admit(staleStore, 'tenant-a', 'project-a', 'stale-live-pid');
  const deadWork = admit(staleStore, 'tenant-b', 'project-b', 'stale-dead-pid');
  const liveClaim = staleStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
    ownerId: 'ops-worker:crashed-live', policy
  }).claim;
  const deadClaim = staleStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
    ownerId: 'ops-worker:crashed-dead', policy
  }).claim;
  staleStore._operationsSetRunnerPid(OPERATIONS_STORAGE_CAPABILITY, {
    jobId: liveClaim.jobId, ownerId: liveClaim.ownerId,
    generation: liveClaim.generation, fence: liveClaim.fence, runnerPid: process.pid
  });
  staleStore._operationsSetRunnerPid(OPERATIONS_STORAGE_CAPABILITY, {
    jobId: deadClaim.jobId, ownerId: deadClaim.ownerId,
    generation: deadClaim.generation, fence: deadClaim.fence, runnerPid: unusedProcessId()
  });
  logicalNow = Math.max(liveClaim.leaseExpiresAtMs, deadClaim.leaseExpiresAtMs) + 1;
  const staleHealth = readOperationsHealth({
    store: staleStore, config: {}, lifecycle: 'accepting', heartbeatAgeMs: 10
  });
  assert.ok(staleHealth.degradedReasons.includes('LEASE_STALE'));
  assert.equal(staleHealth.staleLeases.count, 2);
  const freshRecoveryCandidates = staleStore._operationsExpiredClaims(OPERATIONS_STORAGE_CAPABILITY, { policy });
  assert.equal(freshRecoveryCandidates.items.length, 2);
  assert.equal(freshRecoveryCandidates.items.find(item => item.jobId === liveWork.jobId).runnerPid, process.pid);
  assert.equal(staleStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
    ownerId: 'ops-worker:without-exit-proof', policy, recoverableJobIds: []
  }), null);
  const reclaimed = staleStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
    ownerId: 'ops-worker:restarted', policy, recoverableJobIds: [deadWork.jobId]
  }).claim;
  assert.equal(reclaimed.jobId, deadWork.jobId);
  assert.equal(reclaimed.generation, deadClaim.generation + 1);
  assert.equal(reclaimed.fence, deadClaim.fence + 1);
  staleStore._operationsReadClaim(OPERATIONS_STORAGE_CAPABILITY, {
    jobId: reclaimed.jobId, ownerId: reclaimed.ownerId,
    generation: reclaimed.generation, fence: reclaimed.fence
  });
  assert.throws(() => staleStore._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
    jobId: deadClaim.jobId, ownerId: deadClaim.ownerId,
    generation: deadClaim.generation, fence: deadClaim.fence, outcome: 'stopped', childExited: true
  }), error => error.code === 'STALE_FENCE');
  staleStore._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
    jobId: reclaimed.jobId, ownerId: reclaimed.ownerId,
    generation: reclaimed.generation, fence: reclaimed.fence, outcome: 'shutdown'
  });
  const staleCounts = new DatabaseSync(stale.databasePath, { readOnly: true });
  assert.equal(Number(staleCounts.prepare('SELECT in_flight FROM operations_meta WHERE singleton = 1').get().in_flight), 1);
  assert.equal(staleCounts.prepare('SELECT runner_pid FROM operations_work WHERE job_id = ?').get(deadWork.jobId).runner_pid, null);
  assert.equal(staleCounts.prepare('SELECT runner_pid FROM operations_work WHERE job_id = ?').get(liveWork.jobId).runner_pid, process.pid);
  staleCounts.close();

  let unknownNow = 20_000;
  const unknown = tempDirectory('ah11-stale-unknown-');
  t.after(() => unknown.cleanup());
  const unknownStore = openStore(unknown.databasePath, { clock: () => unknownNow });
  t.after(() => unknownStore.close());
  const uncertainWork = admit(unknownStore, 'tenant-unknown', 'project-unknown', 'stale-unknown-effect');
  const uncertainClaim = unknownStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
    ownerId: 'ops-worker:unknown-before-crash', policy
  }).claim;
  unknownStore._operationsSetRunnerPid(OPERATIONS_STORAGE_CAPABILITY, {
    jobId: uncertainClaim.jobId, ownerId: uncertainClaim.ownerId,
    generation: uncertainClaim.generation, fence: uncertainClaim.fence, runnerPid: unusedProcessId()
  });
  unknownStore.recordDispatchIntent({
    workflowId: uncertainClaim.workflowId,
    ownerId: uncertainClaim.ownerId,
    fence: uncertainClaim.fence,
    expectedRevision: uncertainClaim.revision,
    attemptId: 'ops-unknown-attempt',
    logicalOperationRef: 'ops-unknown-logical-operation',
    authorityHoldRef: 'synthetic-local-bookkeeping:ops-unknown-hold',
    transportAttemptId: 'ops-unknown-transport',
    eventId: 'ops-unknown-intent'
  });
  unknownNow = uncertainClaim.leaseExpiresAtMs + 1;
  const unknownCandidate = unknownStore._operationsExpiredClaims(OPERATIONS_STORAGE_CAPABILITY, { policy });
  assert.equal(unknownCandidate.items[0].jobId, uncertainWork.jobId);
  const blockedClaim = unknownStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
    ownerId: 'ops-worker:unknown-restart', policy, recoverableJobIds: [uncertainWork.jobId]
  });
  assert.equal(blockedClaim?.claim ?? null, null);
  const unknownRows = new DatabaseSync(unknown.databasePath, { readOnly: true });
  assert.equal(unknownRows.prepare('SELECT state FROM operations_work WHERE job_id = ?').get(uncertainWork.jobId).state, 'unknown');
  assert.equal(Number(unknownRows.prepare('SELECT in_flight FROM operations_meta WHERE singleton = 1').get().in_flight), 0);
  assert.equal(unknownStore.getAttempt('ops-unknown-attempt').state, 'intent');
  assert.equal(unknownStore.getAttempt('ops-unknown-attempt').authorityHoldRef, 'synthetic-local-bookkeeping:ops-unknown-hold');
  unknownRows.close();
  assert.equal(METRICS.providerCalls, 0);
});

test('OPS06_UNCOOPERATIVE_REENTRANT sends signals only to owned children and escalates with bounded reaping', async t => {
  const temporary = tempDirectory('ah11-worker-signal-');
  t.after(() => temporary.cleanup());
  const worker = createOperationsWorker({
    databasePath: temporary.databasePath,
    ownerId: 'ops-worker:signal',
    config: { childKillGraceMs: 40, childReapReserveMs: 250, shutdownTimeoutMs: 1_000 }
  });
  assert.throws(() => createOperationsWorker({
    databasePath: join(temporary.directory, 'callback-rejected.sqlite'), executor: () => true
  }));
  t.after(async () => { await worker.stop('test'); });
  void worker.start();
  const submitted = worker.submitSyntheticWork({
    trustedSyntheticScope: { tenantId: 'signal-tenant', projectId: 'signal-project' },
    idempotencyKey: 'signal-long',
    planJson: JSON.stringify({
      kind: 'agent-harness.private-synthetic-plan', version: 1,
      steps: Array.from({ length: 32 }, (_, index) => ({
        id: `s${String(index).padStart(2, '0')}`,
        operation: 'text.concat',
        dependsOn: index % 12 === 0 ? [] : [`s${String(index - 1).padStart(2, '0')}`],
        args: { parts: index % 12 === 0 ? ['x'.repeat(512)] : [{ $result: `s${String(index - 1).padStart(2, '0')}` }, ''] }
      }))
    })
  });
  assert.equal(submitted.accepted, true);
  const deadline = Date.now() + 3_000;
  let ownedPid = null;
  while (Date.now() < deadline && worker.activeChildCount === 0) await new Promise(resolvePromise => setTimeout(resolvePromise, 1));
  assert.equal(worker.activeChildCount, 1);
  const pgrep = spawnSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' });
  if (pgrep.status === 0) ownedPid = Number(pgrep.stdout.trim().split(/\s+/u).at(-1));
  assert.ok(Number.isSafeInteger(ownedPid) && ownedPid > 1);
  METRICS.ownedRunnerStarts += 1;
  const supervisorRssBytes = worker.health().process.rssBytes;
  METRICS.maxSupervisorRssBytes = Math.max(METRICS.maxSupervisorRssBytes, supervisorRssBytes);
  if (Number.isSafeInteger(ownedPid) && ownedPid > 1) {
    const rss = spawnSync('ps', ['-o', 'rss=', '-p', String(ownedPid)], { encoding: 'utf8' });
    const rssKilobytes = Number(rss.stdout.trim());
    if (rss.status === 0 && Number.isSafeInteger(rssKilobytes) && rssKilobytes > 0) {
      METRICS.maxRunnerRssBytes = Math.max(METRICS.maxRunnerRssBytes, rssKilobytes * 1024);
    }
  }
  assert.ok(METRICS.maxSupervisorRssBytes > 0);
  assert.ok(METRICS.maxRunnerRssBytes > 0);
  if (Number.isSafeInteger(ownedPid) && ownedPid > 1) {
    try { process.kill(ownedPid, 'SIGSTOP'); } catch { ownedPid = null; }
  }
  const waiters = Array.from({ length: 16 }, () => worker.waitForOwnedChildrenIdle(5_000));
  assert.equal(await worker.waitForOwnedChildrenIdle(5_000), false);
  const stopping = worker.stop('signal');
  assert.strictEqual(worker.stop('signal'), stopping);
  const rejectedDuringStop = worker.submitSyntheticWork({
    trustedSyntheticScope: { tenantId: 'signal-tenant', projectId: 'signal-project' },
    idempotencyKey: 'after-stop', planJson: PLAN
  });
  assert.equal(rejectedDuringStop.code, 'OPS_UNAVAILABLE');
  const stopped = await stopping;
  METRICS.ownedRunnerTermSignals += 1;
  METRICS.ownedRunnerKillSignals += stopped.escalatedChildren;
  METRICS.ownedRunnerShutdownElapsedMsMax = Math.max(METRICS.ownedRunnerShutdownElapsedMsMax, stopped.elapsedMs);
  METRICS.ownedRunnerShutdownSamples += 1;
  assert.deepEqual(await Promise.all(waiters), Array(16).fill(false));
  if (Number.isSafeInteger(ownedPid) && ownedPid > 1) {
    try { process.kill(ownedPid, 'SIGCONT'); } catch {}
  }
  assert.equal(stopped.childrenReaped, true);
  assert.equal(stopped.childCount, 0);
  assert.ok(stopped.escalatedChildren >= 1);
  assert.ok(stopped.elapsedMs <= 1_000);
  assert.equal(worker.activeChildCount, 0);
  assert.throws(() => worker.start());

  await t.test('OPS06.C02 waitForOwnedChildrenIdle reports process-idle while durable accepted work remains queued', async t => {
    const idleDir = tempDirectory('ah11-owned-idle-semantics-');
    t.after(() => idleDir.cleanup());
    const idleWorker = createOperationsWorker({ databasePath: idleDir.databasePath, ownerId: 'review-worker-idle' });
    t.after(async () => { if (idleWorker.lifecycle !== 'stopped') await idleWorker.stop('test'); });
    const idleStore = openStore(idleDir.databasePath);
    t.after(() => idleStore.close());
    const queued = admit(idleStore, 'idle-tenant', 'idle-project', 'idle-queued');
    assert.equal(queued.accepted, true);
    assert.equal(await idleWorker.waitForOwnedChildrenIdle(1), true);
    const durable = idleStore._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'idle-tenant', projectId: 'idle-project', jobId: queued.jobId
    });
    assert.equal(durable.state, 'queued');
    assert.equal(Number(new DatabaseSync(idleDir.databasePath, { readOnly: true })
      .prepare('SELECT pending_records FROM operations_meta WHERE singleton=1').get().pending_records), 1);
    await idleWorker.stop('test');
  });

  await t.test('OPS06.C01 actual repeated mixed signals share one cleanup and close the owned process', async t => {
  const flushMarker = join(temporary.directory, 'repeated-signal-flush.json');
  const signalChild = spawn(process.execPath, [
    join(ROOT, 'tests/operations/fixtures/repeated-signal-child.mjs'),
    join(temporary.directory, 'repeated-signal.sqlite'), flushMarker
  ], { cwd: ROOT, env: baseEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
  METRICS.processRuns += 1;
  let signalChildClosed = false;
  t.after(async () => {
    if (!signalChildClosed) await killOwnedChildAndReap(signalChild, closed);
  });
  let signalOutput = '';
  let ready = false;
  signalChild.stdout.setEncoding('utf8');
  signalChild.stdout.on('data', chunk => {
    signalOutput += chunk;
    ready ||= signalOutput.includes('"event":"ready"');
  });
  signalChild.stderr.setEncoding('utf8');
  signalChild.stderr.on('data', chunk => { signalOutput += chunk; });
  const closed = new Promise(resolvePromise => signalChild.once('close', (code, signal) => resolvePromise({ code, signal })));
  const readyDeadline = Date.now() + 5_000;
  while (!ready && Date.now() < readyDeadline && signalChild.exitCode === null) await new Promise(resolvePromise => setTimeout(resolvePromise, 5));
  assert.equal(ready, true, signalOutput);
  const firstSignalAt = performance.now();
  assert.equal(signalChild.kill('SIGTERM'), true);
  METRICS.processSigtermSignalsSent += 1;
  await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  assert.equal(signalChild.kill('SIGINT'), true);
  METRICS.processSigintSignalsSent += 1;
  await waitForPath(flushMarker, signalChild, 2_000);
  await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
  assert.equal(signalChild.kill('SIGTERM'), true);
  METRICS.processSigtermSignalsSent += 1;
  const signalExit = await waitForCloseBounded(closed, 2_000);
  signalChildClosed = Boolean(signalExit);
  if (!signalExit) await killOwnedChildAndReap(signalChild, closed);
  assert.ok(signalExit, signalOutput);
  const processCloseElapsedMs = performance.now() - firstSignalAt;
  METRICS.processCloseElapsedMsMax = Math.max(METRICS.processCloseElapsedMsMax, processCloseElapsedMs);
  METRICS.processCloseSamples += 1;
  assert.equal(signalExit.code, 0, signalOutput);
  const stoppedLine = signalOutput.split(/\r?\n/u).find(line => line.includes('"event":"stopped"'));
  assert.ok(stoppedLine, signalOutput);
  const stoppedRecord = JSON.parse(stoppedLine);
  assert.equal(stoppedRecord.stopped.stopped, true);
  assert.equal(stoppedRecord.stopped.childrenReaped, true);
  assert.equal(stoppedRecord.stopped.storeClosed, true);
  assert.equal(stoppedRecord.sinkCalls, 1);
  assert.equal(stoppedRecord.providerCalls, 0);
  assert.equal(stoppedRecord.workAfterStop.state, 'queued');
  assert.equal(stoppedRecord.afterRestart.state, 'completed');
  assert.equal(stoppedRecord.afterRestart.workflowState, 'succeeded');
  assert.ok(stoppedRecord.afterRestart.fence > stoppedRecord.workAfterStop.fence);
  assert.equal(stoppedRecord.attemptCount, 0);
  assert.ok(processCloseElapsedMs < 1_500, `Actual process close took ${processCloseElapsedMs} ms.`);
    await t.test('OPS06.C03 clears the losing shutdown timer and distinguishes stop return from process close', () => {
      assert.ok(processCloseElapsedMs >= stoppedRecord.stopped.elapsedMs,
        'The parent-observed process close must include at least the worker stop-return interval.');
      assert.ok(processCloseElapsedMs < 1_500);
      assert.equal(stoppedRecord.telemetry.cursor, 0);
      assert.ok(stoppedRecord.telemetry.pendingRecords > 0);
      assert.equal(stoppedRecord.sinkCalls, 1);
    });
  });
});

test('OPS07_STORE_RESOURCE_FAILURE maps real SQLite BUSY to typed bounded backpressure and reports headroom', async t => {
  const temporary = tempDirectory('ah11-store-busy-');
  t.after(() => temporary.cleanup());
  const worker = createOperationsWorker({ databasePath: temporary.databasePath, ownerId: 'ops-worker:busy' });
  t.after(async () => { await worker.stop('test'); });
  void worker.start();
  const lock = new DatabaseSync(temporary.databasePath, { timeout: 20 });
  lock.exec('BEGIN IMMEDIATE');
  const result = worker.submitSyntheticWork({
    trustedSyntheticScope: { tenantId: 'busy-tenant', projectId: 'busy-project' },
    idempotencyKey: 'busy-1', planJson: PLAN
  });
  assert.deepEqual({ accepted: result.accepted, code: result.code, reasonCode: result.reasonCode }, {
    accepted: false, code: 'OPS_BACKPRESSURE', reasonCode: 'STORE_BUSY'
  });
  lock.exec('ROLLBACK');
  lock.close();
  const health = worker.health();
  METRICS.maxSupervisorRssBytes = Math.max(METRICS.maxSupervisorRssBytes, health.process.rssBytes);
  assert.ok(Number.isSafeInteger(health.resources.freeBytes));
  assert.ok(health.resources.freeBytes > health.resources.minimumFreeBytes);
  assert.equal(health.process.workerCount, 4);
  assert.equal(worker.readScopedWorkPage({ trustedSyntheticScope: { tenantId: 'busy-tenant', projectId: 'busy-project' } }).items.length, 0);

  await t.test('OPS07.C01 reserves a concurrent valid 32-step lifecycle before admission and bounds DB, WAL, SHM, events, and reopen state', async t => {
    const nearCap = tempDirectory('ah11-lifecycle-reservation-');
    t.after(() => nearCap.cleanup());
    const nearCapConfig = readOperationsConfig({
      workerCount: 2, maxInFlightGlobal: 2, maxInFlightTenant: 1,
      maxStoreBytes: 67_108_864, maxWalBytes: 16_777_216, busyTimeoutMs: 100
    });
    const capacityWorker = createOperationsWorker({
      databasePath: nearCap.databasePath, ownerId: 'review-worker', config: nearCapConfig
    });
    t.after(async () => { if (capacityWorker.lifecycle !== 'stopped') await capacityWorker.stop('test'); });
    void capacityWorker.start();
    const planJson = JSON.stringify({
      kind: 'agent-harness.private-synthetic-plan', version: 1,
      steps: Array.from({ length: 32 }, (_, index) => ({
        id: `h${String(index).padStart(2, '0')}`, operation: 'text.concat',
        dependsOn: index % 12 === 0 ? [] : [`h${String(index - 1).padStart(2, '0')}`],
        args: { parts: index % 12 === 0 ? ['x'.repeat(512)] : [{ $result: `h${String(index - 1).padStart(2, '0')}` }, ''] }
      }))
    });
    const scopeA = { tenantId: 'highwater-tenant-a', projectId: 'highwater-project-a' };
    const scopeB = { tenantId: 'highwater-tenant-b', projectId: 'highwater-project-b' };
    const first = capacityWorker.submitSyntheticWork({ trustedSyntheticScope: scopeA, idempotencyKey: 'highwater-a', planJson });
    const second = capacityWorker.submitSyntheticWork({ trustedSyntheticScope: scopeB, idempotencyKey: 'highwater-b', planJson });
    assert.equal(first.accepted, true);
    assert.equal(second.accepted, true);
    const thirdScope = { tenantId: 'highwater-tenant-c', projectId: 'highwater-project-c' };
    const rejected = capacityWorker.submitSyntheticWork({ trustedSyntheticScope: thirdScope, idempotencyKey: 'highwater-c', planJson });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reasonCode, 'STORE_CAPACITY');
    assert.ok(capacityWorker.health().degradedReasons.includes('STORE_CAPACITY'));
    assert.equal(capacityWorker.readScopedWorkPage({ trustedSyntheticScope: thirdScope }).items.length, 0);

    const concurrentDeadline = Date.now() + 3_000;
    while (capacityWorker.activeChildCount < 2 && Date.now() < concurrentDeadline) {
      await new Promise(resolvePromise => setTimeout(resolvePromise, 2));
    }
    assert.equal(capacityWorker.activeChildCount, 2);
    const ownedChildren = spawnSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' });
    assert.equal(ownedChildren.status, 0, ownedChildren.stderr);
    const runnerPids = ownedChildren.stdout.trim().split(/\s+/u).map(Number).filter(pid => {
      const command = spawnSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
      return command.status === 0 && command.stdout.includes('runner.js');
    });
    assert.equal(runnerPids.length, 2);
    METRICS.ownedRunnerCountHighWater = Math.max(METRICS.ownedRunnerCountHighWater, runnerPids.length);
    const supervisorFdCount = countOpenFileDescriptors(process.pid);
    assert.ok(Number.isSafeInteger(supervisorFdCount) && supervisorFdCount > 0);
    METRICS.supervisorOpenFileDescriptors = Math.max(METRICS.supervisorOpenFileDescriptors, supervisorFdCount);
    for (const pid of runnerPids) {
      const fdCount = countOpenFileDescriptors(pid);
      assert.ok(Number.isSafeInteger(fdCount) && fdCount > 0);
      METRICS.runnerOpenFileDescriptors = Math.max(METRICS.runnerOpenFileDescriptors, fdCount);
    }

    const updateHighWater = () => {
      const health = capacityWorker.health();
      const actual = health.resources.storeBytes;
      const reserved = health.resources.reservedCompletionBytes;
      METRICS.storeHighWaterBytes = Math.max(METRICS.storeHighWaterBytes, actual);
      METRICS.storeReservedHighWaterBytes = Math.max(METRICS.storeReservedHighWaterBytes, actual + reserved);
      METRICS.databaseHighWaterBytes = Math.max(METRICS.databaseHighWaterBytes, health.resources.databaseBytes);
      METRICS.walHighWaterBytes = Math.max(METRICS.walHighWaterBytes, health.resources.walBytes);
      METRICS.shmHighWaterBytes = Math.max(METRICS.shmHighWaterBytes, health.resources.shmBytes);
      METRICS.freeSpaceLowWaterBytes = Math.min(METRICS.freeSpaceLowWaterBytes, health.resources.freeBytes);
      METRICS.pendingEventHighWaterRecords = Math.max(METRICS.pendingEventHighWaterRecords, health.telemetry.pendingRecords);
      METRICS.reservedEventHighWaterSlots = Math.max(METRICS.reservedEventHighWaterSlots, health.telemetry.reservedEventSlots);
      METRICS.resourceHighWaterSamples += 1;
      assert.ok(actual + reserved <= nearCapConfig.maxStoreBytes,
        `Actual store plus retained lifecycle reservation ${actual + reserved} exceeded ${nearCapConfig.maxStoreBytes}.`);
      assert.ok(health.resources.walBytes <= nearCapConfig.maxWalBytes);
      assert.ok(health.telemetry.pendingRecords + health.telemetry.reservedEventSlots <= nearCapConfig.maxEventBacklog);
    };
    const deadline = Date.now() + 20_000;
    let rowA;
    let rowB;
    while (Date.now() < deadline) {
      updateHighWater();
      rowA = capacityWorker.readScopedWorkPage({ trustedSyntheticScope: scopeA }).items.find(row => row.jobId === first.jobId);
      rowB = capacityWorker.readScopedWorkPage({ trustedSyntheticScope: scopeB }).items.find(row => row.jobId === second.jobId);
      if (rowA?.state === 'completed' && rowB?.state === 'completed') break;
      await new Promise(resolvePromise => setTimeout(resolvePromise, 25));
    }
    const completionDiagnostic = JSON.stringify({ rowA, rowB, health: capacityWorker.health() });
    assert.equal(rowA?.state, 'completed', completionDiagnostic);
    assert.equal(rowB?.state, 'completed', completionDiagnostic);
    updateHighWater();
    const stopped = await capacityWorker.stop('test');
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.childrenReaped, true);
    const reopened = openStore(nearCap.databasePath);
    for (const [scope, item] of [[scopeA, first], [scopeB, second]]) {
      const status = reopened._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
        tenantId: scope.tenantId, projectId: scope.projectId, jobId: item.jobId
      });
      assert.equal(status.state, 'completed');
      const checkpoint = reopened.getCheckpoint(item.workflowId);
      assert.equal(Object.keys(JSON.parse(checkpoint.data.completedResultsJson)).length, 32);
      assert.equal(reopened.getWorkflow(item.workflowId).state, 'succeeded');
    }
    const raw = new DatabaseSync(nearCap.databasePath, { readOnly: true });
    assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM operation_attempts').get().count), 0);
    assert.equal(Number(raw.prepare(`SELECT COUNT(*) AS count FROM operations_work WHERE state='completed' AND reserved_disk_bytes=0 AND reserved_event_slots=0`).get().count), 2);
    assert.equal(Number(raw.prepare('SELECT pending_records FROM operations_meta WHERE singleton=1').get().pending_records), 0);
    assert.equal(Number(raw.prepare('SELECT reserved_disk_bytes FROM operations_meta WHERE singleton=1').get().reserved_disk_bytes), 0);
    raw.close();
    const finalHealth = readOperationsHealth({ store: reopened, config: nearCapConfig, lifecycle: 'accepting', heartbeatAgeMs: 10 });
    assert.ok(finalHealth.resources.storeBytes <= nearCapConfig.maxStoreBytes);
    assert.ok(finalHealth.resources.walBytes <= nearCapConfig.maxWalBytes);
    reopened.close();
  });

  await t.test('OPS07.C02 injected SQLite write failure leaves the prior durable snapshot intact', () => {
    const failureDir = tempDirectory('ah11-resource-write-failure-');
    t.after(() => failureDir.cleanup());
    const failureStore = openStore(failureDir.databasePath);
    const baseline = new DatabaseSync(failureDir.databasePath, { readOnly: true });
    const before = {
      workflows: Number(baseline.prepare('SELECT COUNT(*) AS count FROM workflows').get().count),
      events: Number(baseline.prepare('SELECT COUNT(*) AS count FROM workflow_events').get().count),
      work: Number(baseline.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count)
    };
    baseline.close();
    const trigger = new DatabaseSync(failureDir.databasePath);
    trigger.exec("CREATE TRIGGER disk_failure BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT, 'injected local write failure'); END");
    assert.throws(() => admit(failureStore, 'failure-tenant', 'failure-project', 'write-fail'));
    trigger.close();
    failureStore.close();
    const reopened = openStore(failureDir.databasePath);
    const after = new DatabaseSync(failureDir.databasePath, { readOnly: true });
    assert.deepEqual({
      workflows: Number(after.prepare('SELECT COUNT(*) AS count FROM workflows').get().count),
      events: Number(after.prepare('SELECT COUNT(*) AS count FROM workflow_events').get().count),
      work: Number(after.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count),
      ...after.prepare('SELECT pending_records, pending_bytes, in_flight, reserved_event_slots, reserved_disk_bytes FROM operations_meta WHERE singleton=1').get()
    }, { ...before, pending_records: 0, pending_bytes: 0, in_flight: 0, reserved_event_slots: 0, reserved_disk_bytes: 0 });
    after.close();
    reopened.close();
  });

  await t.test('OPS07.C03 indexed page-plus-one reports bounded incomplete visibility', () => {
    const pageDir = tempDirectory('ah11-page-plus-one-');
    t.after(() => pageDir.cleanup());
    const pageStore = openStore(pageDir.databasePath);
    t.after(() => pageStore.close());
    for (let index = 0; index < 3; index += 1) {
      assert.equal(admit(pageStore, 'page-tenant', 'page-project', `page-${index}`).accepted, true);
    }
    const first = pageStore._operationsReadPage(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'page-tenant', projectId: 'page-project', limit: 2
    });
    assert.equal(first.items.length, 2);
    assert.equal(first.hasMore, true);
    assert.equal(first.incomplete, true);
    assert.equal(first.nextAfterJobId, first.items[1].jobId);
    const second = pageStore._operationsReadPage(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'page-tenant', projectId: 'page-project', afterJobId: first.nextAfterJobId, limit: 2
    });
    assert.equal(second.items.length, 1);
    assert.equal(second.hasMore, false);
    assert.equal(second.incomplete, false);
    assert.notEqual(first.items[0].jobId, second.items[0].jobId);
    const raw = new DatabaseSync(pageDir.databasePath, { readOnly: true });
    const plan = raw.prepare(`EXPLAIN QUERY PLAN SELECT job_id FROM operations_work INDEXED BY operations_work_scope_page_idx
      WHERE tenant_id=? AND project_id=? AND (? IS NULL OR job_id>?) ORDER BY job_id COLLATE BINARY LIMIT ?`)
      .all('page-tenant', 'page-project', null, null, 3).map(row => row.detail).join(' ');
    assert.match(plan, /operations_work_scope_page_idx/u);
    assert.doesNotMatch(plan, /SCAN operations_work\b/u);
    raw.close();
  });

  await t.test('OPS07.C04 stop reports incomplete durable cleanup while a second SQLite writer lock spans child reap', async t => {
    const busyStop = tempDirectory('ah11-busy-stop-recovery-');
    t.after(() => busyStop.cleanup());
    const shutdownConfig = {
      workerCount: 1, maxInFlightGlobal: 1, maxInFlightTenant: 1, maxInFlightProject: 1,
      shutdownTimeoutMs: 1_000, childKillGraceMs: 100, childReapReserveMs: 200,
      busyTimeoutMs: 20, pollIntervalMs: 5
    };
    const worker = createOperationsWorker({
      databasePath: busyStop.databasePath, ownerId: 'busy-stop-worker', config: shutdownConfig
    });
    t.after(async () => { if (worker.lifecycle !== 'stopped') await worker.stop('test'); });
    void worker.start();
    const scope = { tenantId: 'busy-stop-tenant', projectId: 'busy-stop-project' };
    const planJson = JSON.stringify({
      kind: 'agent-harness.private-synthetic-plan', version: 1,
      steps: Array.from({ length: 32 }, (_, index) => ({
        id: `b${String(index).padStart(2, '0')}`, operation: 'text.concat',
        dependsOn: index % 12 === 0 ? [] : [`b${String(index - 1).padStart(2, '0')}`],
        args: { parts: index % 12 === 0 ? ['x'.repeat(512)] : [{ $result: `b${String(index - 1).padStart(2, '0')}` }, ''] }
      }))
    });
    const accepted = worker.submitSyntheticWork({
      trustedSyntheticScope: scope, idempotencyKey: 'busy-stop-held-work', planJson
    });
    assert.equal(accepted.accepted, true);
    const raw = new DatabaseSync(busyStop.databasePath, { readOnly: true });
    t.after(() => { try { raw.close(); } catch {} });
    const runnerDeadline = Date.now() + 3_000;
    let runnerPid = null;
    while (Date.now() < runnerDeadline && runnerPid === null) {
      const row = raw.prepare('SELECT state, runner_pid FROM operations_work WHERE job_id=?').get(accepted.jobId);
      if (row?.state === 'running' && Number.isSafeInteger(row.runner_pid)) runnerPid = row.runner_pid;
      else await new Promise(resolvePromise => setTimeout(resolvePromise, 1));
    }
    assert.ok(Number.isSafeInteger(runnerPid) && runnerPid > 1);
    assert.equal(process.kill(runnerPid, 'SIGSTOP'), true);
    const writerLock = new DatabaseSync(busyStop.databasePath, { timeout: 20 });
    writerLock.exec('BEGIN IMMEDIATE');
    let firstStop;
    try {
      firstStop = await worker.stop('test');
      assert.equal(firstStop.stopped, false);
      assert.equal(firstStop.childrenReaped, true);
      assert.equal(firstStop.durableCleanupComplete, false);
      assert.equal(firstStop.pendingDurableCleanupCount, 1);
      assert.equal(firstStop.storeClosed, false);
      assert.ok(firstStop.elapsedMs <= firstStop.budgetMs + 100);
      const retained = raw.prepare(`SELECT state, runner_pid FROM operations_work WHERE job_id=?`).get(accepted.jobId);
      assert.equal(retained.state, 'running');
      assert.equal(retained.runner_pid, runnerPid);
      assert.throws(() => process.kill(runnerPid, 0), error => error.code === 'ESRCH');
      assert.equal(Number(raw.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get().in_flight), 1);
    } finally {
      try { writerLock.exec('ROLLBACK'); } catch {}
      writerLock.close();
    }

    const recoveredStop = await worker.stop('test');
    assert.equal(recoveredStop.stopped, true);
    assert.equal(recoveredStop.durableCleanupComplete, true);
    assert.equal(recoveredStop.pendingDurableCleanupCount, 0);
    assert.equal(recoveredStop.storeClosed, true);
    const recovered = openStore(busyStop.databasePath);
    const queuedRow = recovered._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: scope.tenantId, projectId: scope.projectId, jobId: accepted.jobId
    });
    assert.equal(queuedRow.state, 'queued');
    assert.equal(raw.prepare('SELECT runner_pid FROM operations_work WHERE job_id=?').get(accepted.jobId).runner_pid, null);
    assert.equal(Number(raw.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get().in_flight), 0);
    recovered.close();

    const restart = createOperationsWorker({
      databasePath: busyStop.databasePath, ownerId: 'busy-stop-restart', config: shutdownConfig
    });
    t.after(async () => { if (restart.lifecycle !== 'stopped') await restart.stop('test'); });
    void restart.start();
    const completed = await waitForStatus(restart, scope, accepted.jobId, 'completed', 8_000);
    assert.equal(completed.state, 'completed');
    const restartStop = await restart.stop('test');
    assert.equal(restartStop.stopped, true);
    raw.close();
  });
  await t.test('OPS07.C05 the CLI stays open after an incomplete stop and succeeds after a second signal', async t => {
    const cliStop = tempDirectory('ah11-cli-incomplete-stop-');
    t.after(() => cliStop.cleanup());
    const scope = { tenantId: 'cli-busy-tenant', projectId: 'cli-busy-project' };
    const setup = openStore(cliStop.databasePath);
    const planJson = JSON.stringify({
      kind: 'agent-harness.private-synthetic-plan', version: 1,
      steps: Array.from({ length: 32 }, (_, index) => ({
        id: `c${String(index).padStart(2, '0')}`, operation: 'text.concat',
        dependsOn: index % 12 === 0 ? [] : [`c${String(index - 1).padStart(2, '0')}`],
        args: { parts: index % 12 === 0 ? ['x'.repeat(512)] : [{ $result: `c${String(index - 1).padStart(2, '0')}` }, ''] }
      }))
    });
    const accepted = admit(setup, scope.tenantId, scope.projectId, 'cli-busy-work', planJson);
    assert.equal(accepted.accepted, true);
    setup.close();

    const child = spawn(process.execPath, [
      join(ROOT, 'src/worker/private/worker.js'), '--mode', 'mock', '--database-path', cliStop.databasePath
    ], { cwd: ROOT, env: baseEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    METRICS.processRuns += 1;
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    let closeResult = null;
    const closed = new Promise(resolvePromise => child.once('close', (code, signal) => {
      closeResult = { code, signal };
      resolvePromise(closeResult);
    }));
    const raw = new DatabaseSync(cliStop.databasePath, { readOnly: true });
    t.after(() => { try { raw.close(); } catch {} });
    let runnerPid = null;
    let writerLock = null;
    try {
      const runnerDeadline = Date.now() + 4_000;
      while (Date.now() < runnerDeadline && runnerPid === null) {
        const row = raw.prepare('SELECT state, runner_pid FROM operations_work WHERE job_id=?').get(accepted.jobId);
        if (row?.state === 'running' && Number.isSafeInteger(row.runner_pid)) runnerPid = row.runner_pid;
        else await new Promise(resolvePromise => setTimeout(resolvePromise, 2));
      }
      assert.ok(Number.isSafeInteger(runnerPid) && runnerPid > 1, stderr);
      assert.equal(process.kill(runnerPid, 'SIGSTOP'), true);
      writerLock = new DatabaseSync(cliStop.databasePath, { timeout: 20 });
      writerLock.exec('BEGIN IMMEDIATE');
      assert.equal(child.kill('SIGTERM'), true);
      const incompleteDeadline = Date.now() + 10_000;
      while (!stdout.split(/\r?\n/u).some(line => {
        try { return JSON.parse(line).event === 'operations_worker_stop_incomplete'; } catch { return false; }
      }) && Date.now() < incompleteDeadline && child.exitCode === null) {
        await new Promise(resolvePromise => setTimeout(resolvePromise, 10));
      }
      const incomplete = stdout.split(/\r?\n/u).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).find(record => record?.event === 'operations_worker_stop_incomplete');
      assert.ok(incomplete, `${stdout}\n${stderr}`);
      assert.equal(incomplete.stopped, false);
      assert.equal(incomplete.storeClosed, false);
      assert.equal(child.exitCode, null, 'CLI remains alive while its store and retry signal handler are needed');
      const retained = raw.prepare('SELECT state, runner_pid FROM operations_work WHERE job_id=?').get(accepted.jobId);
      assert.equal(retained.state, 'running');
      assert.equal(retained.runner_pid, runnerPid);

      writerLock.exec('ROLLBACK');
      writerLock.close();
      writerLock = null;
      assert.equal(child.kill('SIGTERM'), true);
      const finalClose = await waitForCloseBounded(closed, 3_000);
      assert.ok(finalClose, `${stdout}\n${stderr}`);
      assert.deepEqual(finalClose, { code: 0, signal: null });
      const records = stdout.split(/\r?\n/u).map(line => {
        try { return JSON.parse(line); } catch { return null; }
      }).filter(Boolean);
      assert.equal(records.filter(record => record.event === 'operations_worker_stop_incomplete').length, 1);
      const finalRecord = records.find(record => record.event === 'operations_worker_stopped');
      assert.equal(finalRecord?.stopped, true);
      assert.equal(finalRecord?.storeClosed, true);
      const settled = raw.prepare('SELECT state, runner_pid FROM operations_work WHERE job_id=?').get(accepted.jobId);
      assert.equal(settled.state, 'queued');
      assert.equal(settled.runner_pid, null);
      assert.equal(Number(raw.prepare('SELECT in_flight FROM operations_meta WHERE singleton=1').get().in_flight), 0);
    } finally {
      try { writerLock?.exec('ROLLBACK'); } catch {}
      try { writerLock?.close(); } catch {}
      if (runnerPid !== null) {
        try { process.kill(runnerPid, 'SIGCONT'); } catch {}
      }
      if (!closeResult && child.exitCode === null && child.signalCode === null) {
        const reaped = await killOwnedChildAndReap(child, closed);
        assert.ok(reaped, 'the test reaped its owned CLI child');
      }
    }
  });
});

test('OPS08_HEALTH_FAIL_CLOSED reports unavailable authority, provider, stale data, and secret-free status', async t => {
  const temporary = tempDirectory('ah11-health-');
  t.after(() => temporary.cleanup());
  const worker = createOperationsWorker({ databasePath: temporary.databasePath, ownerId: 'ops-worker:health' });
  t.after(async () => { await worker.stop('test'); });
  const canaryTenant = 'tenant-secret-canary-never-health';
  const canaryProject = 'project-private-canary-never-health';
  void worker.start();
  const canaryJob = worker.submitSyntheticWork({
    trustedSyntheticScope: { tenantId: canaryTenant, projectId: canaryProject },
    idempotencyKey: 'health-canary', planJson: PLAN
  });
  assert.equal(canaryJob.accepted, true);
  const before = worker.health();
  assert.equal(before.ready, false);
  assert.equal(before.externalReady, false);
  assert.equal(before.externalDispatchEnabled, false);
  assert.doesNotMatch(JSON.stringify(before), /tenant-secret-canary|project-private-canary|workflow.sqlite/u);
  const readyLocal = worker.health();
  METRICS.maxSupervisorRssBytes = Math.max(METRICS.maxSupervisorRssBytes, readyLocal.process.rssBytes);
  assert.equal(readyLocal.externalReady, false);
  const directStorePath = join(temporary.directory, 'health-direct.sqlite');
  const directStore = openStore(directStorePath);
  t.after(() => directStore.close());
  const direct = readOperationsHealth({ store: directStore, config: {}, lifecycle: 'accepting', heartbeatAgeMs: 10_000 });
  assert.ok(direct.degradedReasons.includes('DIAGNOSTICS_STALE'));
  assert.equal(direct.externalDispatchEnabled, false);
  const nonexistent = readStoreCompatibility(join(temporary.directory, 'missing.sqlite'));
  assert.equal(nonexistent.status, 'store_unavailable');

  await t.test('OPS08.C01 health truth table reports lifecycle, stale data, unavailable authority/provider, lease, unknown, and telemetry states', () => {
    const starting = readOperationsHealth({ store: directStore, config: {}, lifecycle: 'starting', heartbeatAgeMs: 10 });
    assert.equal(starting.state, 'starting');
    assert.equal(starting.live, false);
    assert.equal(starting.localReady, false);
    const acceptingStale = readOperationsHealth({ store: directStore, config: {}, lifecycle: 'accepting', heartbeatAgeMs: 10_000 });
    assert.equal(acceptingStale.state, 'degraded');
    assert.ok(acceptingStale.degradedReasons.includes('DIAGNOSTICS_STALE'));
    assert.ok(acceptingStale.degradedReasons.includes('POLICY_UNCONFIGURED'));
    const stopping = readOperationsHealth({ store: directStore, config: {}, lifecycle: 'stopping', heartbeatAgeMs: 10 });
    assert.equal(stopping.state, 'stopping');
    assert.ok(stopping.degradedReasons.includes('SHUTTING_DOWN'));
    const telemetryBad = readOperationsHealth({
      store: directStore, config: {}, lifecycle: 'accepting', heartbeatAgeMs: 10,
      telemetrySinkState: 'unavailable', telemetrySinkFailed: true, telemetrySinkPendingRecords: 2
    });
    assert.equal(telemetryBad.localReady, false);
    assert.ok(telemetryBad.degradedReasons.includes('TELEMETRY_SINK_UNAVAILABLE'));
    assert.ok(telemetryBad.degradedReasons.includes('TELEMETRY_SINK_ERROR'));
    assert.equal(telemetryBad.authority.status, 'authority_unavailable');
    assert.equal(telemetryBad.provider.status, 'provider_unavailable');
    assert.equal(telemetryBad.externalReady, false);
    assert.equal(telemetryBad.externalDispatchEnabled, false);
    const stoppedHealth = readOperationsHealth({ store: directStore, config: {}, lifecycle: 'stopped', heartbeatAgeMs: 10 });
    assert.equal(stoppedHealth.state, 'stopped');
    assert.equal(stoppedHealth.localReady, false);

    const futureVersionDb = new DatabaseSync(directStorePath);
    futureVersionDb.exec('PRAGMA user_version=99');
    futureVersionDb.close();
    const futureSchema = readOperationsHealth({ store: directStore, config: {}, lifecycle: 'accepting', heartbeatAgeMs: 10 });
    assert.ok(futureSchema.degradedReasons.includes('SCHEMA_UNSUPPORTED'));
    assert.equal(futureSchema.localReady, false);
    const restoreSchemaDb = new DatabaseSync(directStorePath);
    restoreSchemaDb.exec('PRAGMA user_version=6');
    restoreSchemaDb.close();

    let now = 50_000;
    const leaseDir = tempDirectory('ah11-health-lease-state-');
    t.after(() => leaseDir.cleanup());
    const leaseStore = openStore(leaseDir.databasePath, { clock: () => now });
    t.after(() => leaseStore.close());
    const accepted = admit(leaseStore, 'health-tenant', 'health-project', 'health-stale-lease');
    const policy = operationsStoragePolicy(readOperationsConfig());
    const claim = leaseStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, { ownerId: 'review-worker-health', policy }).claim;
    leaseStore._operationsSetRunnerPid(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: claim.jobId, ownerId: claim.ownerId, generation: claim.generation,
      fence: claim.fence, runnerPid: unusedProcessId()
    });
    leaseStore.recordDispatchIntent({
      workflowId: claim.workflowId, ownerId: claim.ownerId, fence: claim.fence,
      expectedRevision: claim.revision, attemptId: 'health-unknown-attempt',
      logicalOperationRef: 'health-unknown-logical', authorityHoldRef: 'synthetic-local-bookkeeping:health-hold',
      transportAttemptId: 'health-unknown-transport', eventId: 'health-unknown-intent'
    });
    now = claim.leaseExpiresAtMs + 1;
    const leaseHealth = readOperationsHealth({ store: leaseStore, config: {}, lifecycle: 'accepting', heartbeatAgeMs: 10 });
    assert.ok(leaseHealth.degradedReasons.includes('LEASE_STALE'));
    const unknownHealth = readOperationsHealth({ store: leaseStore, config: {}, lifecycle: 'accepting', heartbeatAgeMs: 10 });
    assert.ok(unknownHealth.degradedReasons.includes('RECONCILIATION_PENDING'));
    assert.equal(unknownHealth.reconciliation.count, 1);
    assert.equal(unknownHealth.externalDispatchEnabled, false);
    assert.equal(leaseStore.getWorkflow(accepted.workflowId).state, 'awaiting_response');
  });

  await t.test('OPS08.C02 saturated event reservations match admission and stop before any accepted row', () => {
    const eventDir = tempDirectory('ah11-event-headroom-');
    t.after(() => eventDir.cleanup());
    const config = readOperationsConfig({
      maxQueueRecords: 2, maxPerTenantRecords: 1, maxPerProjectRecords: 1,
      maxQueueBytes: 65_536, maxPerTenantBytes: 32_768,
      maxPerProjectBytes: 16_384, maxEventBacklog: 1_024
    });
    const seed = DurableWorkflowStore.open({ databasePath: eventDir.databasePath, busyTimeoutMs: 20 });
    for (let index = 0; index < 1_024; index += 1) {
      seed.createWorkflow({ workflowId: `event-headroom-${index}`, checkpoint: { index }, eventId: `event-headroom-${index}` });
    }
    seed.close();
    const eventWorker = createOperationsWorker({ databasePath: eventDir.databasePath, ownerId: 'review-worker-event-cap', config });
    t.after(async () => { if (eventWorker.lifecycle !== 'stopped') await eventWorker.stop('test'); });
    void eventWorker.start();
    const health = eventWorker.health();
    assert.equal(health.localReady, false);
    assert.ok(health.degradedReasons.includes('TELEMETRY_BACKLOG_HIGH'));
    const rejected = eventWorker.submitSyntheticWork({
      trustedSyntheticScope: { tenantId: 'event-cap-tenant', projectId: 'event-cap-project' },
      idempotencyKey: 'event-cap-reject', planJson: PLAN
    });
    assert.equal(rejected.accepted, false);
    assert.equal(rejected.reasonCode, 'TELEMETRY_BACKLOG_HIGH');
    assert.equal(eventWorker.readScopedWorkPage({ trustedSyntheticScope: { tenantId: 'event-cap-tenant', projectId: 'event-cap-project' } }).items.length, 0);
    const raw = new DatabaseSync(eventDir.databasePath, { readOnly: true });
    assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM operations_work').get().count), 0);
    assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM workflow_events').get().count), 1_024);
    raw.close();
    const stopped = eventWorker.stop('test');
    return stopped.then(result => assert.equal(result.stopped, true));
  });

  await t.test('OPS08.C03 actual concurrency saturation is reported separately from minimum-admission readiness', async t => {
    const saturatedDir = tempDirectory('ah11-health-saturated-worker-');
    t.after(() => saturatedDir.cleanup());
    const saturatedWorker = createOperationsWorker({
      databasePath: saturatedDir.databasePath, ownerId: 'review-worker-saturated-health',
      config: { workerCount: 1, maxInFlightGlobal: 1, maxInFlightTenant: 1,
        maxInFlightProject: 1, pollIntervalMs: 10 }
    });
    t.after(async () => { if (saturatedWorker.lifecycle !== 'stopped') await saturatedWorker.stop('test'); });
    void saturatedWorker.start();
    const scope = { tenantId: 'saturated-health-tenant', projectId: 'saturated-health-project' };
    const planJson = JSON.stringify({
      kind: 'agent-harness.private-synthetic-plan', version: 1,
      steps: Array.from({ length: 32 }, (_, index) => ({
        id: `z${String(index).padStart(2, '0')}`, operation: 'text.concat',
        dependsOn: index % 12 === 0 ? [] : [`z${String(index - 1).padStart(2, '0')}`],
        args: { parts: index % 12 === 0 ? ['x'.repeat(512)] : [{ $result: `z${String(index - 1).padStart(2, '0')}` }, ''] }
      }))
    });
    const accepted = saturatedWorker.submitSyntheticWork({ trustedSyntheticScope: scope, idempotencyKey: 'health-saturated', planJson });
    assert.equal(accepted.accepted, true);
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline && saturatedWorker.activeChildCount === 0) await new Promise(resolvePromise => setTimeout(resolvePromise, 2));
    assert.equal(saturatedWorker.activeChildCount, 1);
    const children = spawnSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' });
    assert.equal(children.status, 0, children.stderr);
    const runnerPid = Number(children.stdout.trim().split(/\s+/u).at(-1));
    assert.ok(Number.isSafeInteger(runnerPid) && runnerPid > 1);
    assert.equal(process.kill(runnerPid, 'SIGSTOP'), true);
    const saturatedHealthDeadline = Date.now() + 1_000;
    let health = saturatedWorker.health();
    while (Date.now() < saturatedHealthDeadline && health.state !== 'saturated') {
      await new Promise(resolvePromise => setTimeout(resolvePromise, 2));
      health = saturatedWorker.health();
    }
    assert.equal(health.state, 'saturated');
    assert.equal(health.localReady, true, 'The local queue can still admit a minimum bounded job while all child slots are occupied.');
    assert.equal(health.externalDispatchEnabled, false);
    const stopped = await saturatedWorker.stop('test');
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.childrenReaped, true);
  });
  const stopped = await worker.stop('test');
  assert.equal(stopped.stopped, true);
  assert.equal(canaryTenant.includes('tenant-secret'), true);
});

test('OPS09_MIGRATION_COMPATIBILITY migrates schema 5 atomically, preserves older migration cases, and refuses future bytes', async t => {
  assert.equal(INTERNAL_SCHEMA_VERSION, 6);
  const temporary = tempDirectory('ah11-migration-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  store.createWorkflow({ workflowId: 'preserve-schema5-workflow', checkpoint: { value: Number.MAX_VALUE, marker: 'opaque-preserved' }, eventId: 'preserve-created' });
  store.close();
  const old = new DatabaseSync(temporary.databasePath);
  old.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TRIGGER operations_event_reservation;
    DROP TRIGGER operations_work_payload_immutable;
    DROP INDEX operations_attempts_workflow_state_idx;
    DROP INDEX operations_attempts_state_workflow_idx;
    DROP INDEX operations_work_scope_page_idx;
    DROP INDEX operations_work_lease_idx;
    DROP TABLE operations_work;
    DROP TABLE operations_projects;
    DROP TABLE operations_tenants;
    DROP TABLE operations_meta;
    PRAGMA user_version = 5;
  `);
  old.close();
  assert.equal(readStoreCompatibility(temporary.databasePath).status, 'migration_required');
  const migrated = openStore(temporary.databasePath);
  assert.deepEqual(migrated.getCheckpoint('preserve-schema5-workflow').data, { value: Number.MAX_VALUE, marker: 'opaque-preserved' });
  migrated.close();
  const raw = new DatabaseSync(temporary.databasePath, { readOnly: true });
  assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 6);
  assert.equal(Number(raw.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='operations_work'").get().count), 1);
  raw.close();

  const rollbackPath = join(temporary.directory, 'rollback.sqlite');
  const newer = openStore(rollbackPath);
  newer.close();
  const conflicting = new DatabaseSync(rollbackPath);
  conflicting.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TRIGGER operations_event_reservation;
    DROP TRIGGER operations_work_payload_immutable;
    DROP INDEX operations_attempts_workflow_state_idx;
    DROP INDEX operations_attempts_state_workflow_idx;
    DROP INDEX operations_work_scope_page_idx;
    DROP INDEX operations_work_lease_idx;
    DROP TABLE operations_work;
    DROP TABLE operations_projects;
    DROP TABLE operations_tenants;
    DROP TABLE operations_meta;
    CREATE TABLE operations_meta (sentinel TEXT NOT NULL);
    INSERT INTO operations_meta VALUES ('rollback-preserved');
    PRAGMA user_version = 5;
  `);
  const beforeObjects = conflicting.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all().map(row => ({ ...row }));
  conflicting.close();
  assert.throws(() => openStore(rollbackPath));
  const after = new DatabaseSync(rollbackPath, { readOnly: true });
  assert.equal(after.prepare('PRAGMA user_version').get().user_version, 5);
  assert.deepEqual(after.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all().map(row => ({ ...row })), beforeObjects);
  assert.equal(after.prepare('SELECT sentinel FROM operations_meta').get().sentinel, 'rollback-preserved');
  after.close();

  const futurePath = join(temporary.directory, 'future.sqlite');
  const future = new DatabaseSync(futurePath);
  future.exec("CREATE TABLE future_marker (value TEXT); INSERT INTO future_marker VALUES ('preserve'); PRAGMA user_version=99;");
  future.close();
  const bytes = readFileSync(futurePath);
  assert.equal(readStoreCompatibility(futurePath).status, 'schema_unsupported');
  assert.throws(() => openStore(futurePath), error => error.code === 'UNSUPPORTED_SCHEMA_VERSION');
  assert.deepEqual(readFileSync(futurePath), bytes);
  await t.test('OPS09.C01 maps the supported schema upgrade, rollback, future refusal, and retained envelope controls', () => {
    assert.equal(readStoreCompatibility(temporary.databasePath).status, 'supported');
    assert.equal(readStoreCompatibility(rollbackPath).status, 'migration_required');
    assert.equal(readStoreCompatibility(futurePath).status, 'schema_unsupported');
    const unchanged = new DatabaseSync(temporary.databasePath, { readOnly: true });
    assert.equal(unchanged.prepare('PRAGMA user_version').get().user_version, 6);
    unchanged.close();
    assert.match(readFileSync(join(ROOT, 'tests/runtime/durability.test.js'), 'utf8'), /v1 checkpoint migration/u);
    assert.equal(INTERNAL_SCHEMA_VERSION, 6);
  });

  await t.test('OPS09.C02 migrates populated schema 6 without changing queued, running, unknown, or terminal custody', async t => {
    const retained = tempDirectory('ah11-v6-policy-binding-migration-');
    t.after(() => retained.cleanup());
    let now = 90_000;
    const source = DurableWorkflowStore.open({
      databasePath: retained.databasePath, busyTimeoutMs: 20, clock: () => now
    });
    source._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, {
      maxStoreBytes: readOperationsConfig().maxStoreBytes,
      maxWalBytes: readOperationsConfig().maxWalBytes,
      minFreeDiskBytes: readOperationsConfig().minFreeDiskBytes
    });
    const defaultPolicy = operationsStoragePolicy(readOperationsConfig());

    const running = admit(source, 'migration-running-tenant', 'migration-running-project', 'migration-running');
    const runningClaim = source._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'migration-running-owner', policy: defaultPolicy
    }).claim;
    source._operationsSetRunnerPid(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: running.jobId, ownerId: runningClaim.ownerId, generation: runningClaim.generation,
      fence: runningClaim.fence, runnerPid: unusedProcessId()
    });

    const unknown = admit(source, 'migration-unknown-tenant', 'migration-unknown-project', 'migration-unknown');
    const unknownClaim = source._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'migration-unknown-owner', policy: defaultPolicy
    }).claim;
    source._operationsSetRunnerPid(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: unknown.jobId, ownerId: unknownClaim.ownerId, generation: unknownClaim.generation,
      fence: unknownClaim.fence, runnerPid: unusedProcessId()
    });
    source.recordDispatchIntent({
      workflowId: unknown.workflowId, ownerId: unknownClaim.ownerId, fence: unknownClaim.fence,
      expectedRevision: unknownClaim.revision, attemptId: 'migration-unknown-attempt',
      logicalOperationRef: 'migration-unknown-logical',
      authorityHoldRef: 'synthetic-local-bookkeeping:migration-unknown-hold',
      transportAttemptId: 'migration-unknown-transport', eventId: 'migration-unknown-intent'
    });
    now = unknownClaim.leaseExpiresAtMs + 1;
    const expired = source._operationsExpiredClaims(OPERATIONS_STORAGE_CAPABILITY, { policy: defaultPolicy });
    assert.ok(expired.items.some(item => item.jobId === unknown.jobId));
    assert.equal(source._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'migration-unknown-recovery', policy: defaultPolicy, recoverableJobIds: [unknown.jobId]
    }), null);

    const terminal = admit(source, 'migration-terminal-tenant', 'migration-terminal-project', 'migration-terminal');
    const terminalClaim = source._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'migration-terminal-owner', policy: defaultPolicy
    }).claim;
    const terminalWork = source._operationsReadClaim(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: terminal.jobId, ownerId: terminalClaim.ownerId,
      generation: terminalClaim.generation, fence: terminalClaim.fence
    });
    const localResult = await runBoundedLocalPlan({
      store: source, workflowId: terminal.workflowId, ownerId: terminalClaim.ownerId,
      fence: terminalClaim.fence, planJson: terminalWork.work.planJson,
      limitsJson: terminalWork.work.limitsJson
    });
    assert.equal(localResult.status, 'completed');
    source._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: terminal.jobId, ownerId: terminalClaim.ownerId,
      generation: terminalClaim.generation, fence: terminalClaim.fence,
      outcome: 'completed', childExited: true
    });

    const queued = admit(source, 'migration-queued-tenant', 'migration-queued-project', 'migration-queued');
    source.close();

    const snapshot = databasePath => {
      const db = new DatabaseSync(databasePath, { readOnly: true });
      const rows = (sql, ...params) => db.prepare(sql).all(...params).map(row => ({ ...row }));
      const value = {
        meta: rows(`SELECT pending_records, pending_bytes, in_flight, reserved_event_slots,
          reserved_disk_bytes, last_tenant_id FROM operations_meta WHERE singleton=1`),
        tenants: rows('SELECT * FROM operations_tenants ORDER BY tenant_id'),
        projects: rows('SELECT * FROM operations_projects ORDER BY tenant_id, project_id'),
        work: rows(`SELECT job_id, workflow_id, tenant_id, project_id, idempotency_key, work_json,
          work_bytes, work_sha256, limits_version, state, generation, worker_id, runner_pid,
          fence_token, lease_expires_ms, created_at_ms, updated_at_ms, reserved_event_slots,
          reserved_disk_bytes, reason_code FROM operations_work ORDER BY job_id`),
        workflows: rows('SELECT * FROM workflows ORDER BY workflow_id'),
        checkpoints: rows('SELECT * FROM workflow_checkpoints ORDER BY workflow_id, sequence'),
        events: rows('SELECT * FROM workflow_events ORDER BY sequence'),
        outbox: rows('SELECT * FROM outbox ORDER BY event_sequence'),
        attempts: rows('SELECT * FROM operation_attempts ORDER BY attempt_id'),
        cursors: rows('SELECT * FROM telemetry_cursors ORDER BY consumer_id')
      };
      db.close();
      return JSON.parse(JSON.stringify(value));
    };
    const beforeMigration = snapshot(retained.databasePath);
    const legacy = new DatabaseSync(retained.databasePath);
    legacy.exec('ALTER TABLE operations_meta DROP COLUMN policy_json; PRAGMA user_version=6;');
    legacy.close();
    assert.equal(readStoreCompatibility(retained.databasePath).status, 'migration_required');

    const incompatible = DurableWorkflowStore.open({ databasePath: retained.databasePath, busyTimeoutMs: 20 });
    const narrowConfig = readOperationsConfig({
      maxQueueRecords: 2, maxPerTenantRecords: 1, maxPerProjectRecords: 1,
      maxQueueBytes: 65_536, maxPerTenantBytes: 32_768, maxPerProjectBytes: 16_384,
      maxTenants: 2, maxProjects: 2, maxInFlightGlobal: 1,
      maxInFlightTenant: 1, maxInFlightProject: 1
    });
    assert.throws(() => incompatible._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, {
      maxStoreBytes: narrowConfig.maxStoreBytes, maxWalBytes: narrowConfig.maxWalBytes,
      minFreeDiskBytes: narrowConfig.minFreeDiskBytes,
      policy: operationsStoragePolicy(narrowConfig)
    }), error => error.code === 'INVALID_INPUT');
    incompatible.close();
    const unbound = new DatabaseSync(retained.databasePath, { readOnly: true });
    assert.equal(unbound.prepare('SELECT policy_json FROM operations_meta WHERE singleton=1').get().policy_json, null);
    unbound.close();

    const resumed = createOperationsWorker({
      databasePath: retained.databasePath, ownerId: 'migration-resumed-worker'
    });
    assert.equal(readStoreCompatibility(retained.databasePath).status, 'supported');
    const afterMigration = snapshot(retained.databasePath);
    const withoutReservationCounters = value => {
      const copy = JSON.parse(JSON.stringify(value));
      for (const row of copy.meta) {
        delete row.reserved_disk_bytes;
        delete row.reserved_event_slots;
      }
      for (const row of copy.work) {
        delete row.reserved_disk_bytes;
        delete row.reserved_event_slots;
      }
      return copy;
    };
    assert.deepEqual(withoutReservationCounters(afterMigration), withoutReservationCounters(beforeMigration));
    const rebound = new DatabaseSync(retained.databasePath, { readOnly: true });
    const reservationState = rebound.prepare(`
      SELECT m.reserved_disk_bytes AS meta_disk, m.reserved_event_slots AS meta_events,
        SUM(w.reserved_disk_bytes) AS work_disk, SUM(w.reserved_event_slots) AS work_events
      FROM operations_meta m CROSS JOIN operations_work w WHERE m.singleton=1
    `).get();
    assert.equal(Number(reservationState.meta_disk), Number(reservationState.work_disk));
    assert.equal(Number(reservationState.meta_events), Number(reservationState.work_events));
    rebound.close();
    const check = new DatabaseSync(retained.databasePath, { readOnly: true });
    assert.deepEqual(check.prepare('SELECT job_id, state, runner_pid FROM operations_work ORDER BY job_id').all().map(row => ({ ...row })), [
      { job_id: queued.jobId, state: 'queued', runner_pid: null },
      { job_id: running.jobId, state: 'running', runner_pid: check.prepare('SELECT runner_pid FROM operations_work WHERE job_id=?').get(running.jobId).runner_pid },
      { job_id: terminal.jobId, state: 'completed', runner_pid: null },
      { job_id: unknown.jobId, state: 'unknown', runner_pid: null }
    ].sort((left, right) => left.job_id.localeCompare(right.job_id)));
    assert.equal(check.prepare('SELECT state FROM operation_attempts WHERE attempt_id=?').get('migration-unknown-attempt').state, 'intent');
    assert.equal(check.prepare('SELECT authority_hold_ref FROM operation_attempts WHERE attempt_id=?').get('migration-unknown-attempt').authority_hold_ref,
      'synthetic-local-bookkeeping:migration-unknown-hold');
    check.close();
    const stopped = await resumed.stop('test');
    assert.equal(stopped.stopped, true);

    const rollbackPath = join(retained.directory, 'v6-rollback.sqlite');
    const rollbackSource = DurableWorkflowStore.open({ databasePath: rollbackPath, busyTimeoutMs: 20 });
    rollbackSource.close();
    const damaged = new DatabaseSync(rollbackPath);
    damaged.exec('PRAGMA foreign_keys=OFF; ALTER TABLE operations_meta DROP COLUMN policy_json; DROP TABLE operations_work;');
    const beforeRollback = damaged.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all().map(row => ({ ...row }));
    damaged.close();
    assert.throws(() => DurableWorkflowStore.open({ databasePath: rollbackPath, busyTimeoutMs: 20 }));
    const afterRollback = new DatabaseSync(rollbackPath, { readOnly: true });
    assert.equal(afterRollback.prepare('PRAGMA user_version').get().user_version, 6);
    assert.deepEqual(afterRollback.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all().map(row => ({ ...row })), beforeRollback);
    assert.equal(Number(afterRollback.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('operations_meta') WHERE name='policy_json'").get().count), 0);
    afterRollback.close();
  });

  await t.test('OPS09.C03 upgrades actual predecessor reservations atomically and keeps blocked work recoverable', async t => {
    const fixtureDirectory = tempDirectory('ah11-v6-actual-reservation-migration-');
    t.after(() => fixtureDirectory.cleanup());
    const fixturePath = join(ROOT, 'tests/operations/fixtures/legacy-v6-populated-32-step.sqlite');
    const originalConfig = readOperationsConfig();
    const originalPolicy = operationsStoragePolicy(originalConfig);
    const fixtureManifest = JSON.parse(readFileSync(join(ROOT,
      'tests/operations/fixtures/legacy-v6-states/fixture-manifest.json'), 'utf8'));
    const fixtureEntry = fixtureManifest.fixtures.find(fixture => fixture.path ===
      'tests/operations/fixtures/legacy-v6-populated-32-step.sqlite');
    const fixtureBytes = readFileSync(fixturePath);
    assert.equal(fixtureBytes.byteLength, fixtureEntry?.bytes);
    assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), fixtureEntry?.sha256);
    const copyFixture = name => {
      const path = join(fixtureDirectory.directory, name);
      copyFileSync(fixturePath, path);
      return path;
    };
    const readRetained = path => {
      const db = new DatabaseSync(path, { readOnly: true });
      const policyColumn = Number(db.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('operations_meta') WHERE name='policy_json'").get().count) === 1;
      const result = {
        version: Number(db.prepare('PRAGMA user_version').get().user_version),
        meta: { ...db.prepare(`SELECT pending_records, in_flight, reserved_disk_bytes, reserved_event_slots,
          ${policyColumn ? 'policy_json' : 'NULL AS policy_json'} FROM operations_meta WHERE singleton=1`).get() },
        work: { ...db.prepare('SELECT job_id, workflow_id, state, generation, reserved_disk_bytes, reserved_event_slots FROM operations_work').get() },
        workflow: { ...db.prepare('SELECT state, checkpoint_sequence, cancellation_requested, lease_owner, lease_expires_ms FROM workflows').get() }
      };
      db.close();
      return result;
    };
    const resourceInput = (config, policy) => ({
      maxStoreBytes: config.maxStoreBytes,
      maxWalBytes: config.maxWalBytes,
      minFreeDiskBytes: config.minFreeDiskBytes,
      policy
    });

    const completionPath = copyFixture('legacy-v6-completes.sqlite');
    const original = readRetained(completionPath);
    assert.equal(original.version, 6);
    assert.equal(original.meta.policy_json, null);
    assert.equal(Number(original.meta.reserved_disk_bytes), 524_288);
    assert.equal(original.work.state, 'queued');
    const completion = DurableWorkflowStore.open({ databasePath: completionPath, busyTimeoutMs: 20 });
    completion._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, resourceInput(originalConfig, originalPolicy));
    const rebound = readRetained(completionPath);
    assert.equal(rebound.meta.policy_json !== null, true);
    assert.ok(Number(rebound.meta.reserved_disk_bytes) > Number(original.meta.reserved_disk_bytes));
    assert.equal(Number(rebound.meta.reserved_disk_bytes), Number(rebound.work.reserved_disk_bytes));
    assert.equal(rebound.work.state, 'queued');
    const claim = completion._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'legacy-v6-migration-worker', policy: originalPolicy
    }).claim;
    const work = completion._operationsReadClaim(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: claim.jobId, ownerId: claim.ownerId, generation: claim.generation, fence: claim.fence
    });
    const localResult = await runBoundedLocalPlan({
      store: completion, workflowId: claim.workflowId, ownerId: claim.ownerId,
      fence: claim.fence, planJson: work.work.planJson, limitsJson: work.work.limitsJson
    });
    assert.equal(localResult.status, 'completed');
    assert.equal(localResult.results.length, 32);
    completion._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: claim.jobId, ownerId: claim.ownerId, generation: claim.generation,
      fence: claim.fence, outcome: 'completed', childExited: true
    });
    completion.close();
    const completed = DurableWorkflowStore.open({ databasePath: completionPath, busyTimeoutMs: 20 });
    const completedRow = completed._operationsGetScopedJob(OPERATIONS_STORAGE_CAPABILITY, {
      tenantId: 'legacy-v6-fixture-tenant', projectId: 'legacy-v6-fixture-project',
      jobId: original.work.job_id
    });
    assert.equal(completedRow.state, 'completed');
    const completedDb = new DatabaseSync(completionPath, { readOnly: true });
    assert.equal(completedDb.prepare('SELECT state FROM workflows WHERE workflow_id=?').get(original.work.workflow_id).state, 'succeeded');
    assert.deepEqual({ ...completedDb.prepare('SELECT pending_records, in_flight, reserved_disk_bytes, reserved_event_slots FROM operations_meta WHERE singleton=1').get() }, {
      pending_records: 0, in_flight: 0, reserved_disk_bytes: 0, reserved_event_slots: 0
    });
    completedDb.close();
    completed.close();

    const capacityPath = copyFixture('legacy-v6-capacity-refusal.sqlite');
    const capacityBefore = readRetained(capacityPath);
    const capacityStore = DurableWorkflowStore.open({ databasePath: capacityPath, busyTimeoutMs: 20 });
    const narrowConfig = readOperationsConfig({ maxStoreBytes: 16_777_216 });
    const narrowPolicy = operationsStoragePolicy(narrowConfig);
    assert.throws(() => capacityStore._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY,
      resourceInput(narrowConfig, narrowPolicy)), error => error.code === 'INVALID_INPUT');
    const capacityAfter = readRetained(capacityPath);
    assert.equal(capacityAfter.meta.policy_json, null);
    assert.equal(Number(capacityAfter.meta.reserved_disk_bytes), Number(capacityBefore.meta.reserved_disk_bytes));
    assert.equal(Number(capacityAfter.work.reserved_disk_bytes), Number(capacityBefore.work.reserved_disk_bytes));
    assert.equal(capacityAfter.work.state, capacityBefore.work.state);
    assert.equal(capacityAfter.workflow.state, capacityBefore.workflow.state);
    capacityStore._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY,
      resourceInput(originalConfig, originalPolicy));
    assert.equal(readRetained(capacityPath).meta.policy_json !== null, true);
    capacityStore.close();

    const rollbackPath = copyFixture('legacy-v6-write-rollback.sqlite');
    const rollbackBefore = readRetained(rollbackPath);
    const rollbackStore = DurableWorkflowStore.open({ databasePath: rollbackPath, busyTimeoutMs: 20 });
    const injected = new DatabaseSync(rollbackPath);
    injected.exec(`CREATE TRIGGER injected_legacy_reservation_failure
      BEFORE UPDATE OF reserved_disk_bytes ON operations_meta
      WHEN NEW.reserved_disk_bytes > OLD.reserved_disk_bytes
      BEGIN SELECT RAISE(ABORT, 'synthetic retained-reservation write failure'); END;`);
    injected.close();
    assert.throws(() => rollbackStore._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY,
      resourceInput(originalConfig, originalPolicy)), error => error.code === 'STORE_WRITE_FAILED');
    const rollbackAfterFailure = readRetained(rollbackPath);
    assert.equal(rollbackAfterFailure.meta.policy_json, null);
    assert.equal(Number(rollbackAfterFailure.meta.reserved_disk_bytes), Number(rollbackBefore.meta.reserved_disk_bytes));
    assert.equal(Number(rollbackAfterFailure.work.reserved_disk_bytes), Number(rollbackBefore.work.reserved_disk_bytes));
    assert.equal(rollbackAfterFailure.work.state, rollbackBefore.work.state);
    assert.equal(rollbackAfterFailure.workflow.state, rollbackBefore.workflow.state);
    const removeInjection = new DatabaseSync(rollbackPath);
    removeInjection.exec('DROP TRIGGER injected_legacy_reservation_failure;');
    removeInjection.close();
    rollbackStore._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY,
      resourceInput(originalConfig, originalPolicy));
    assert.equal(readRetained(rollbackPath).meta.policy_json !== null, true);
    rollbackStore.close();
  });

  await t.test('OPS09.C04 real predecessor binaries bind custody and resume eligible expired running work', async t => {
    const fixtureDirectory = tempDirectory('ah11-v6-state-migration-');
    t.after(() => fixtureDirectory.cleanup());
    const config = readOperationsConfig();
    const policy = operationsStoragePolicy(config);
    const fixtures = new Map([
      ['queued', 'queued'], ['running', 'running'], ['partial-running', 'running'], ['partial', 'parked'],
      ['parked', 'parked'], ['unknown', 'unknown'], ['terminal', 'completed'], ['empty', null]
    ]);
    const fixtureManifest = JSON.parse(readFileSync(join(ROOT,
      'tests/operations/fixtures/legacy-v6-states/fixture-manifest.json'), 'utf8'));
    assert.equal(fixtureManifest.sourceRevision, 'af8ddbcd3543d8576c23bc43a6af5d1d4ae40544');
    assert.equal(fixtureManifest.sourceTree, 'e9f697d1c46b46b42920da2138421ee1e97f19b9');
    assert.equal(fixtureManifest.sourceFiles.find(file => file.path === 'src/internal/durable-store.js')?.sha256,
      'ee231508165fcd5038adce6c806797062edd0c46610094d09d641a7cefece611');
    assert.equal(fixtureManifest.sourceFiles.find(file => file.path === 'src/orchestrator/internal/controller.js')?.sha256,
      'c094162ab276c92532d9f7a7a294c47d03da3475a93f65c89e790253847e9c55');
    assert.equal(fixtureManifest.sourceFiles.find(file => file.path === 'src/worker/private/config.js')?.sha256,
      'aaec3c53ba02213564cbb543ed0615ece8389993d20ca9aa97157d55559114ae');
    const fixtureByPath = new Map(fixtureManifest.fixtures.map(fixture => [fixture.path, fixture]));
    const snapshot = databasePath => {
      const db = new DatabaseSync(databasePath, { readOnly: true });
      const rows = sql => db.prepare(sql).all().map(row => ({ ...row }));
      const hasPolicy = Number(db.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('operations_meta') WHERE name='policy_json'").get().count) === 1;
      const result = {
        version: Number(db.prepare('PRAGMA user_version').get().user_version),
        meta: rows(`SELECT pending_records, pending_bytes, in_flight, reserved_event_slots,
          reserved_disk_bytes, last_tenant_id, ${hasPolicy ? 'policy_json' : 'NULL AS policy_json'}
          FROM operations_meta WHERE singleton=1`),
        tenants: rows('SELECT * FROM operations_tenants ORDER BY tenant_id'),
        projects: rows('SELECT * FROM operations_projects ORDER BY tenant_id, project_id'),
        work: rows('SELECT * FROM operations_work ORDER BY job_id'),
        workflows: rows('SELECT * FROM workflows ORDER BY workflow_id'),
        checkpoints: rows('SELECT * FROM workflow_checkpoints ORDER BY workflow_id, sequence'),
        events: rows('SELECT * FROM workflow_events ORDER BY sequence'),
        outbox: rows('SELECT * FROM outbox ORDER BY event_sequence'),
        attempts: rows('SELECT * FROM operation_attempts ORDER BY attempt_id'),
        cursors: rows('SELECT * FROM telemetry_cursors ORDER BY consumer_id')
      };
      db.close();
      return JSON.parse(JSON.stringify(result));
    };
    const retainedPayload = value => {
      const copy = JSON.parse(JSON.stringify(value));
      delete copy.meta[0]?.policy_json;
      for (const row of copy.meta) {
        delete row.reserved_disk_bytes;
        delete row.reserved_event_slots;
      }
      for (const row of copy.work) {
        delete row.reserved_disk_bytes;
        delete row.reserved_event_slots;
      }
      return copy;
    };

    for (const [fixtureName, expectedState] of fixtures) {
      const sourcePath = join(ROOT, 'tests/operations/fixtures/legacy-v6-states', `legacy-v6-${fixtureName}.sqlite`);
      const databasePath = join(fixtureDirectory.directory, `migrated-${fixtureName}.sqlite`);
      const relativeSourcePath = `tests/operations/fixtures/legacy-v6-states/legacy-v6-${fixtureName}.sqlite`;
      const fixtureEntry = fixtureByPath.get(relativeSourcePath);
      const fixtureBytes = readFileSync(sourcePath);
      assert.ok(fixtureEntry, fixtureName);
      assert.equal(fixtureBytes.byteLength, fixtureEntry.bytes, fixtureName);
      assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), fixtureEntry.sha256, fixtureName);
      copyFileSync(sourcePath, databasePath);
      assert.equal(readStoreCompatibility(databasePath).status, 'migration_required', fixtureName);
      const before = snapshot(databasePath);
      assert.equal(before.version, 6, fixtureName);
      assert.equal(before.meta[0].policy_json, null, fixtureName);
      assert.equal(before.work[0]?.state ?? null, expectedState, fixtureName);
      if (fixtureName === 'partial' || fixtureName === 'partial-running') {
        const checkpoint = before.checkpoints.filter(row => row.workflow_id === before.work[0].workflow_id)
          .sort((left, right) => Number(right.sequence) - Number(left.sequence))[0];
        assert.ok(checkpoint, 'predecessor partial checkpoint exists');
        const retainedCheckpoint = JSON.parse(checkpoint.payload_json);
        assert.equal(retainedCheckpoint.schemaVersion, 2);
        assert.equal(JSON.parse(retainedCheckpoint.data.completedResultsJson).one.output, 5);
        assert.equal(before.work[0].state, fixtureName === 'partial-running' ? 'running' : 'parked');
      }
      if (fixtureName === 'unknown') {
        assert.equal(before.attempts[0].state, 'intent');
        assert.equal(before.attempts[0].authority_hold_ref, 'synthetic-local-bookkeeping:legacy-unknown-hold');
      }
      if (fixtureName === 'running') assert.equal(before.work[0].runner_pid, 2_147_483_647);

      const store = DurableWorkflowStore.open({ databasePath, busyTimeoutMs: 20 });
      store._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, {
        maxStoreBytes: config.maxStoreBytes, maxWalBytes: config.maxWalBytes,
        minFreeDiskBytes: config.minFreeDiskBytes, policy
      });
      const after = snapshot(databasePath);
      assert.equal(readStoreCompatibility(databasePath).status, 'supported', fixtureName);
      assert.equal(after.version, 6, fixtureName);
      assert.notEqual(after.meta[0].policy_json, null, fixtureName);
      assert.deepEqual(retainedPayload(after), retainedPayload(before), fixtureName);
      const activeRows = after.work.filter(row => ['queued', 'running', 'parked', 'unknown'].includes(row.state));
      assert.equal(Number(after.meta[0].reserved_disk_bytes), activeRows.reduce((sum, row) => sum + Number(row.reserved_disk_bytes), 0), fixtureName);
      assert.equal(Number(after.meta[0].reserved_event_slots), activeRows.reduce((sum, row) => sum + Number(row.reserved_event_slots), 0), fixtureName);
      if (activeRows.length > 0) {
        assert.ok(Number(after.meta[0].reserved_disk_bytes) >= Number(before.meta[0].reserved_disk_bytes), fixtureName);
        assert.ok(Number(after.meta[0].reserved_event_slots) >= Number(before.meta[0].reserved_event_slots), fixtureName);
      }
      if (fixtureName === 'unknown') {
        assert.equal(after.attempts[0].state, 'intent');
        assert.equal(after.attempts[0].authority_hold_ref, 'synthetic-local-bookkeeping:legacy-unknown-hold');
      }
      store.close();

      const reopened = DurableWorkflowStore.open({ databasePath, busyTimeoutMs: 20 });
      const afterReopen = snapshot(databasePath);
      assert.deepEqual(afterReopen, after, fixtureName);
      if (fixtureName === 'running') {
        reopened._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, {
          maxStoreBytes: config.maxStoreBytes, maxWalBytes: config.maxWalBytes,
          minFreeDiskBytes: config.minFreeDiskBytes, policy
        });
        const expired = reopened._operationsExpiredClaims(OPERATIONS_STORAGE_CAPABILITY, { policy });
        assert.ok(expired.items.some(item => item.jobId === after.work[0].job_id));
        const recovered = reopened._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
          ownerId: 'legacy-v6-running-recovery', policy, recoverableJobIds: [after.work[0].job_id]
        });
        assert.equal(recovered.claim.jobId, after.work[0].job_id);
        const work = reopened._operationsReadClaim(OPERATIONS_STORAGE_CAPABILITY, {
          jobId: recovered.claim.jobId, ownerId: recovered.claim.ownerId,
          generation: recovered.claim.generation, fence: recovered.claim.fence
        });
        const localResult = await runBoundedLocalPlan({
          store: reopened, workflowId: recovered.claim.workflowId, ownerId: recovered.claim.ownerId,
          fence: recovered.claim.fence, planJson: work.work.planJson, limitsJson: work.work.limitsJson
        });
        assert.equal(localResult.status, 'completed');
        reopened._operationsFinish(OPERATIONS_STORAGE_CAPABILITY, {
          jobId: recovered.claim.jobId, ownerId: recovered.claim.ownerId,
          generation: recovered.claim.generation, fence: recovered.claim.fence,
          outcome: 'completed', childExited: true
        });
        const completed = snapshot(databasePath);
        assert.equal(completed.work[0].state, 'completed');
        assert.equal(completed.work[0].runner_pid, null);
        assert.equal(completed.work[0].reserved_disk_bytes, 0);
        assert.equal(completed.work[0].reserved_event_slots, 0);
        assert.equal(completed.work[0].generation, 2);
        assert.equal(completed.work[0].fence_token, 2);
        assert.equal(completed.work[0] && completed.work[0].workflow_id, after.work[0].workflow_id);
        assert.equal(Number(completed.meta[0].pending_records), 0);
        assert.equal(Number(completed.meta[0].in_flight), 0);
        assert.equal(Number(completed.meta[0].reserved_disk_bytes), 0);
        assert.equal(Number(completed.meta[0].reserved_event_slots), 0);
        reopened.close();
        const completedReopen = DurableWorkflowStore.open({ databasePath, busyTimeoutMs: 20 });
        assert.deepEqual(snapshot(databasePath), completed);
        completedReopen.close();
      } else {
        reopened.close();
      }
    }
  });

  await t.test('OPS09.C05 a later legacy-row reservation failure rolls back earlier row upgrades and retries cleanly', t => {
    const fixtureDirectory = tempDirectory('ah11-v6-multi-row-rollback-');
    t.after(() => fixtureDirectory.cleanup());
    const config = readOperationsConfig();
    const policy = operationsStoragePolicy(config);
    const databasePath = join(fixtureDirectory.directory, 'multi-row.sqlite');
    const fixturePath = join(ROOT, 'tests/operations/fixtures/legacy-v6-states/legacy-v6-multi.sqlite');
    const manifest = JSON.parse(readFileSync(join(ROOT,
      'tests/operations/fixtures/legacy-v6-states/fixture-manifest.json'), 'utf8'));
    const entry = manifest.fixtures.find(fixture => fixture.path === 'tests/operations/fixtures/legacy-v6-states/legacy-v6-multi.sqlite');
    const fixtureBytes = readFileSync(fixturePath);
    assert.equal(fixtureBytes.byteLength, entry?.bytes);
    assert.equal(createHash('sha256').update(fixtureBytes).digest('hex'), entry?.sha256);
    copyFileSync(fixturePath, databasePath);
    const snapshot = () => {
      const db = new DatabaseSync(databasePath, { readOnly: true });
      const rows = sql => db.prepare(sql).all().map(row => ({ ...row }));
      const hasPolicy = Number(db.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('operations_meta') WHERE name='policy_json'").get().count) === 1;
      const result = {
        version: Number(db.prepare('PRAGMA user_version').get().user_version),
        meta: rows(`SELECT pending_records, pending_bytes, in_flight, reserved_event_slots,
          reserved_disk_bytes, last_tenant_id, ${hasPolicy ? 'policy_json' : 'NULL AS policy_json'}
          FROM operations_meta WHERE singleton=1`),
        tenants: rows('SELECT * FROM operations_tenants ORDER BY tenant_id'),
        projects: rows('SELECT * FROM operations_projects ORDER BY tenant_id, project_id'),
        work: rows(`SELECT job_id, state, generation, worker_id, runner_pid, fence_token,
          lease_expires_ms, reserved_event_slots, reserved_disk_bytes FROM operations_work ORDER BY job_id`),
        workflows: rows('SELECT * FROM workflows ORDER BY workflow_id'),
        checkpoints: rows('SELECT * FROM workflow_checkpoints ORDER BY workflow_id, sequence'),
        events: rows('SELECT * FROM workflow_events ORDER BY sequence'),
        outbox: rows('SELECT * FROM outbox ORDER BY event_sequence'),
        attempts: rows('SELECT * FROM operation_attempts ORDER BY attempt_id')
      };
      db.close();
      return JSON.parse(JSON.stringify(result));
    };
    const before = snapshot();
    assert.equal(before.version, 6);
    assert.equal(before.meta[0].policy_json, null);
    assert.equal(before.work.length, 2);
    assert.ok(before.work.every(row => row.state === 'queued' && Number(row.reserved_disk_bytes) === 524_288));
    const failingJobId = before.work[1].job_id;
    const store = DurableWorkflowStore.open({ databasePath, busyTimeoutMs: 20 });
    const injected = new DatabaseSync(databasePath);
    injected.exec(`CREATE TRIGGER injected_later_legacy_row_failure
      BEFORE UPDATE OF reserved_disk_bytes ON operations_work
      WHEN NEW.job_id = '${failingJobId}' AND NEW.reserved_disk_bytes > OLD.reserved_disk_bytes
      BEGIN SELECT RAISE(ABORT, 'synthetic second-row reservation failure'); END;`);
    injected.close();
    assert.throws(() => store._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, {
      maxStoreBytes: config.maxStoreBytes, maxWalBytes: config.maxWalBytes,
      minFreeDiskBytes: config.minFreeDiskBytes, policy
    }), error => error.code === 'STORE_WRITE_FAILED');
    assert.deepEqual(snapshot(), before, 'a successful first-row increase and aggregate counters roll back together');

    const removeInjection = new DatabaseSync(databasePath);
    removeInjection.exec('DROP TRIGGER injected_later_legacy_row_failure;');
    removeInjection.close();
    store._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, {
      maxStoreBytes: config.maxStoreBytes, maxWalBytes: config.maxWalBytes,
      minFreeDiskBytes: config.minFreeDiskBytes, policy
    });
    const rebound = snapshot();
    assert.notEqual(rebound.meta[0].policy_json, null);
    assert.ok(rebound.work.every(row => row.state === 'queued'
      && Number(row.reserved_disk_bytes) > 524_288 && Number(row.reserved_event_slots) >= 94));
    assert.equal(Number(rebound.meta[0].reserved_disk_bytes), rebound.work.reduce((sum, row) => sum + Number(row.reserved_disk_bytes), 0));
    assert.equal(Number(rebound.meta[0].reserved_event_slots), rebound.work.reduce((sum, row) => sum + Number(row.reserved_event_slots), 0));
    store.close();
    const reopened = DurableWorkflowStore.open({ databasePath, busyTimeoutMs: 20 });
    assert.deepEqual(snapshot(), rebound);
    reopened.close();
  });
});

test('OPS10_TELEMETRY_JEV_CUSTODY projects real worker events and retains cursor during a hung sink', async t => {
  const temporary = tempDirectory('ah11-telemetry-');
  t.after(() => temporary.cleanup());
  const worker = createOperationsWorker({ databasePath: temporary.databasePath, ownerId: 'ops-worker:telemetry' });
  t.after(async () => { await worker.stop('test'); });
  void worker.start();
  const accepted = worker.submitSyntheticWork({
    trustedSyntheticScope: { tenantId: 'telemetry-sensitive-tenant', projectId: 'telemetry-sensitive-project' },
    idempotencyKey: 'trace-worker-event', planJson: PLAN
  });
  assert.equal(accepted.accepted, true);
  const page = worker.readScopedWorkPage({ trustedSyntheticScope: { tenantId: 'telemetry-sensitive-tenant', projectId: 'telemetry-sensitive-project' }, limit: 10 });
  const event = new DatabaseSync(temporary.databasePath, { readOnly: true });
  const rawEvent = event.prepare("SELECT sequence, event_id, workflow_id, revision, event_type, from_state, to_state, fence_token, occurred_at_ms FROM workflow_events WHERE event_type = 'operations_work_admitted' ORDER BY sequence DESC LIMIT 1").get();
  event.close();
  const projected = projectTelemetryEvent({
    sequence: Number(rawEvent.sequence), eventId: rawEvent.event_id, workflowId: rawEvent.workflow_id,
    revision: Number(rawEvent.revision), type: rawEvent.event_type, fromState: rawEvent.from_state,
    toState: rawEvent.to_state, fence: Number(rawEvent.fence_token), occurredAtMs: Number(rawEvent.occurred_at_ms)
  }, (kind, value) => `tok1_${createHash('sha256').update(`${kind}:${value}`).digest('hex')}`);
  assert.equal(projected.eventType, 'operations_work_admitted');
  assert.doesNotMatch(JSON.stringify(projected), /telemetry-sensitive|ops-job:|ops-workflow:/u);
  assert.equal(page.items.length, 1);

  const store = openStore(join(temporary.directory, 'sink.sqlite'));
  t.after(() => store.close());
  const tokenizer = createHmacTokenizer(Buffer.alloc(32, 7));
  const exporter = createTelemetryExporter({
    store,
    tokenizer,
    sink: () => new Promise(() => {}),
    limits: { queueRecords: 4, queueBytes: 4096, batchSize: 4, maxAttempts: 1, retryDelayMs: 0, sinkTimeoutMs: 40, maxBatchesPerFlush: 1, maxPolicyDropsPerFlush: 1 }
  });
  assert.ok(exporter instanceof TelemetryExporter);
  const sinkWorker = createOperationsWorker({ databasePath: join(temporary.directory, 'sink.sqlite'), ownerId: 'ops-worker:sink', telemetry: exporter });
  t.after(async () => { await sinkWorker.stop('test'); });
  void sinkWorker.start();
  const sinkAccepted = sinkWorker.submitSyntheticWork({
    trustedSyntheticScope: { tenantId: 'sink-tenant', projectId: 'sink-project' }, idempotencyKey: 'sink-hung', planJson: PLAN
  });
  assert.equal(sinkAccepted.accepted, true);
  await waitForStatus(sinkWorker, { tenantId: 'sink-tenant', projectId: 'sink-project' }, sinkAccepted.jobId, 'completed');
  const stopResult = await sinkWorker.stop('signal');
  assert.equal(stopResult.stopped, true);
  assert.equal(stopResult.telemetryClosed, true);
  const closed = exporter.diagnostics();
  assert.equal(closed.cursor, 0);
  assert.ok(closed.pendingRecords > 0);
  assert.equal(closed.lastErrorCode, 'TELEMETRY_SINK_TIMEOUT');
  assert.equal(store.getTelemetryCursor('internal-telemetry-v1'), 0);
  await t.test('OPS10.C01 a hung sink leaves its cursor and pending outbox unchanged', () => {
    const diagnostics = exporter.diagnostics();
    assert.equal(diagnostics.cursor, 0);
    assert.ok(diagnostics.pendingRecords > 0);
    assert.equal(diagnostics.lastErrorCode, 'TELEMETRY_SINK_TIMEOUT');
    assert.equal(store.getTelemetryCursor('internal-telemetry-v1'), 0);
    assert.equal(sinkWorker.health().externalDispatchEnabled, false);
  });
  tokenizer.destroy();
  store.close();
  await worker.stop('test');
});

test('OPS11_RETENTION_OWNER_HOOKS refuses deletion or settlement without accepted external owner policy', async t => {
  const temporary = tempDirectory('ah11-retention-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  store.createWorkflow({ workflowId: 'retention-immutable', checkpoint: { value: 'keep' }, eventId: 'retention-created' });
  const before = store.getCheckpoint('retention-immutable');
  const response = requestOwnerRetention(store, {
    ownerRole: 'Finance and reliability', policyVersion: 'policy-v1', recordClass: 'local-events', maximumItems: 10
  });
  assert.equal(response.accepted, false);
  assert.equal(response.status, 'retention_not_configured');
  assert.equal(response.deletionPerformed, false);
  assert.equal(response.settlementPerformed, false);
  assert.deepEqual(store.getCheckpoint('retention-immutable'), before);
  await t.test('OPS11.C01 absent owner policy preserves immutable data and does not settle a hold', () => {
    assert.equal(response.status, 'retention_not_configured');
    assert.equal(response.deletionPerformed, false);
    assert.equal(response.settlementPerformed, false);
    assert.deepEqual(store.getCheckpoint('retention-immutable'), before);
    assert.equal(store.getWorkflow('retention-immutable').state, 'queued');
  });

  await t.test('OPS11.C02 cursor gaps, undelivered evidence, backups, and unknown holds remain owner-controlled', () => {
    const custodyDir = tempDirectory('ah11-retention-custody-');
    t.after(() => custodyDir.cleanup());
    let now = 80_000;
    const custodyStore = openStore(custodyDir.databasePath, { clock: () => now });
    t.after(() => custodyStore.close());
    const accepted = admit(custodyStore, 'retention-tenant', 'retention-project', 'retention-unknown');
    const policy = operationsStoragePolicy(readOperationsConfig());
    const claim = custodyStore._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
      ownerId: 'review-worker-retention-unknown', policy
    }).claim;
    custodyStore._operationsSetRunnerPid(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: claim.jobId, ownerId: claim.ownerId, generation: claim.generation,
      fence: claim.fence, runnerPid: unusedProcessId()
    });
    custodyStore.recordDispatchIntent({
      workflowId: accepted.workflowId, ownerId: claim.ownerId, fence: claim.fence,
      expectedRevision: claim.revision, attemptId: 'retention-unknown-attempt',
      logicalOperationRef: 'retention-unknown-logical', authorityHoldRef: 'synthetic-local-bookkeeping:retention-hold',
      transportAttemptId: 'retention-unknown-transport', eventId: 'retention-unknown-intent'
    });
    now = claim.leaseExpiresAtMs + 1;
    custodyStore._operationsExpiredClaims(OPERATIONS_STORAGE_CAPABILITY, { policy });
    const cursorBefore = custodyStore.getTelemetryCursor('internal-telemetry-v1');
    const pendingBefore = custodyStore.countEventRowsAfter(cursorBefore, 1_000);
    const checkpointBefore = custodyStore.getCheckpoint(accepted.workflowId);
    const request = requestOwnerRetention(custodyStore, {
      ownerRole: 'Finance and reliability', policyVersion: 'unaccepted-v1',
      recordClass: 'unknown-attempts-and-events', maximumItems: 100
    });
    assert.equal(request.accepted, false);
    assert.equal(request.status, 'retention_not_configured');
    assert.equal(request.deletionPerformed, false);
    assert.equal(request.settlementPerformed, false);
    custodyStore.close();
    const reopened = openStore(custodyDir.databasePath);
    assert.equal(reopened.getTelemetryCursor('internal-telemetry-v1'), cursorBefore);
    assert.deepEqual(reopened.countEventRowsAfter(cursorBefore, 1_000), pendingBefore);
    assert.deepEqual(reopened.getCheckpoint(accepted.workflowId), checkpointBefore);
    assert.equal(reopened.getAttempt('retention-unknown-attempt').state, 'intent');
    assert.equal(reopened.getAttempt('retention-unknown-attempt').authorityHoldRef,
      'synthetic-local-bookkeeping:retention-hold');
    assert.equal(reopened.getWorkflow(accepted.workflowId).state, 'awaiting_response');
    const raw = new DatabaseSync(custodyDir.databasePath, { readOnly: true });
    assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id=?').get(accepted.workflowId).count), pendingBefore.count);
    raw.close();
    reopened.close();
  });
});

test('OPS12_RUNBOOK_CLEAN_START starts, health-checks, SIGTERMs, reopens, and restarts the documented worker', async t => {
  const temporary = tempDirectory('ah11-runbook-');
  t.after(() => temporary.cleanup());
  const workerScript = join(ROOT, 'src/worker/private/worker.js');
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const child = spawn(process.execPath, [workerScript, '--mode', 'mock', '--database-path', temporary.databasePath], {
      cwd: ROOT, env: baseEnvironment(), stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { output += chunk; });
    const started = new Promise((resolvePromise, reject) => {
      const timer = setTimeout(() => reject(new Error('Documented worker startup exceeded its bound.')), 5_000);
      const check = () => {
        if (output.includes('operations_worker_started')) { clearTimeout(timer); resolvePromise(); }
      };
      child.stdout.on('data', check);
      child.once('error', reject);
      check();
    });
    await started;
    const closed = new Promise(resolvePromise => child.once('close', (code, signal) => resolvePromise({ code, signal })));
    let processClosed = false;
    t.after(async () => {
      if (!processClosed) await killOwnedChildAndReap(child, closed);
    });
    const closeStartedAt = performance.now();
    assert.equal(child.kill('SIGTERM'), true);
    METRICS.processSigtermSignalsSent += 1;
    const exit = await closed;
    processClosed = true;
    const processCloseElapsedMs = performance.now() - closeStartedAt;
    METRICS.processCloseElapsedMsMax = Math.max(METRICS.processCloseElapsedMsMax, processCloseElapsedMs);
    METRICS.processCloseSamples += 1;
    METRICS.processRuns += 1;
    assert.equal(exit.code, 0);
    assert.match(output, /"event":"operations_worker_stopped"/u);
    assert.match(output, /"childrenReaped":true/u);
    assert.equal(readStoreCompatibility(temporary.databasePath).status, 'supported');
  }
  const store = openStore(temporary.databasePath);
  const health = readOperationsHealth({ store, config: {}, lifecycle: 'accepting', heartbeatAgeMs: 10 });
  assert.equal(health.externalDispatchEnabled, false);
  assert.equal(health.authority.status, 'authority_unavailable');
  assert.equal(health.provider.status, 'provider_unavailable');
  store.close();
  await t.test('OPS12.C01 executes busy, unavailable, future-schema, stuck-review, and unknown-hold recovery in a child process', async t => {
    const transcriptPath = join(temporary.directory, 'recovery-cases.jsonl');
    const result = await runChild(join(ROOT, 'tests/operations/runbook-recovery-cases.mjs'), [transcriptPath], { timeoutMs: 20_000 });
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout.trim()), { cases: 5, passed: 5, providerCalls: 0 });
    const records = readFileSync(transcriptPath, 'utf8').trim().split(/\r?\n/u).map(line => JSON.parse(line));
    assert.deepEqual(records.map(record => record.case), [
      'busy_store_spans_stop', 'store_unavailable', 'future_schema',
      'stuck_runner_review_escalation', 'unknown_hold_restart_escalation'
    ]);
    assert.ok(records.every(record => record.outcome === 'pass' && record.providerCalls === 0));
    assert.equal(records.find(record => record.case === 'future_schema').originalBytesPreserved, true);
    assert.equal(records.find(record => record.case === 'stuck_runner_review_escalation').childReaped, true);
    assert.equal(records.find(record => record.case === 'unknown_hold_restart_escalation').holdRetained, true);
  });
});

test('OPS13_EVIDENCE_GATES binds all required groups to the current source and reports no unrun provider success', async t => {
  const source = readFileSync(join(ROOT, 'src/worker/private/worker.js'), 'utf8');
  const fixture = readFileSync(join(ROOT, 'tests/operations/fixtures/jev-sigterm-child.mjs'), 'utf8');
  const evidenceVerifier = readFileSync(join(ROOT, 'tests/operations/verify-fixture.js'), 'utf8');
  assert.match(source, /externalDispatchEnabled: false/u);
  assert.match(source, /SIGKILL/u);
  assert.match(source, /_operationsFinish/u);
  assert.match(fixture, /runPrivateJevTestAttempt/u);
  assert.match(fixture, /sendJevOnce\(\{ request, apiKey, signal: abortController\.signal \}\)/u);
  assert.doesNotMatch(source, /fetch\(|https\.request|Resolver\(/u);
  assert.match(evidenceVerifier, /merge-base/u);
  assert.match(evidenceVerifier, /executedHead:\s*startHead/u);
  assert.doesNotMatch(evidenceVerifier, /baseHead:\s*['"]f02f38a6/u);
  assert.deepEqual(Object.keys(METRICS).sort(), [
      'blockedExternalNetworkAttempts', 'controlledDnsResolve4', 'controlledDnsResolve6',
    'controlledHttpsRequests', 'controlledHttpsWrites', 'processRuns', 'processSigkillSignalsSent',
    'processSigtermSignalsSent', 'providerCalls', 'ownedRunnerStarts', 'ownedRunnerTermSignals',
    'ownedRunnerKillSignals', 'ownedRunnerShutdownElapsedMsMax', 'ownedRunnerShutdownSamples',
      'processSigtermDrainElapsedMsMax', 'processSigtermDrainSamples', 'processCloseElapsedMsMax',
      'processCloseSamples', 'runnerDeadlineCloseElapsedMsMax', 'runnerDeadlineCloseSamples',
      'storeHighWaterBytes', 'storeReservedHighWaterBytes', 'databaseHighWaterBytes', 'walHighWaterBytes',
      'shmHighWaterBytes', 'freeSpaceLowWaterBytes', 'pendingEventHighWaterRecords',
      'reservedEventHighWaterSlots', 'resourceHighWaterSamples',
      'ownedRunnerCountHighWater', 'supervisorOpenFileDescriptors', 'runnerOpenFileDescriptors',
      'processSigintSignalsSent', 'maxSupervisorRssBytes', 'maxRunnerRssBytes'
  ].sort());
  assert.equal(METRICS.providerCalls, 0);
  assert.equal(METRICS.blockedExternalNetworkAttempts, 0);
  await t.test('OPS13.C01 verifier binds explicit local case IDs, clean pins, process/resource metrics, and upload members', () => {
    assert.match(evidenceVerifier, /REQUIRED_LOCAL_CASES/u);
    assert.match(evidenceVerifier, /missingLocalCases/u);
    assert.match(evidenceVerifier, /processCloseElapsedMs/u);
    assert.match(evidenceVerifier, /runnerDeadlineCloseElapsedMsMax/u);
    assert.match(evidenceVerifier, /resourceHighWaterSamples/u);
    const workflow = readFileSync(join(ROOT, '.github/workflows/runtime-foundation.yml'), 'utf8');
    assert.match(workflow, /include-hidden-files: true/u);
    assert.match(workflow, /if-no-files-found: error/u);
    assert.doesNotMatch(workflow, /AH-11-OPS-\*/u);
    assert.match(evidenceVerifier, /EXPECTED_UPLOAD_MEMBERS/u);
    assert.match(evidenceVerifier, /uploadUsesExactAllowlist/u);
    assert.match(evidenceVerifier, /requiredEvidenceSetComplete/u);
    assert.match(evidenceVerifier, /diagnosticsIncludedInUpload/u);
    assert.match(evidenceVerifier, /failure-diagnostics\.js/u);
    const controls = [
      ['assertion', 'ASSERTION_FAILURE'],
      ['busy', 'SQLITE_BUSY'],
      ['runtime-busy', 'SQLITE_BUSY'],
      ['node-busy', 'SQLITE_BUSY'],
      ['node-locked', 'SQLITE_BUSY'],
      ['node-unsupported', 'UNCLASSIFIED_FAILURE'],
      ['wrapped-runtime-busy', 'ASSERTION_FAILURE'],
      ['parse', 'JSON_PARSE'],
      ['timeout', 'CHILD_TIMEOUT']
    ];
    const diagnosticsByMode = new Map();
    for (const [mode, expectedCode] of controls) {
      const result = spawnSync(process.execPath, [
        join(ROOT, 'tests/operations/fixtures/failure-diagnostic-child.mjs'), mode
      ], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: mode === 'timeout' ? 1_000 : 5_000,
        maxBuffer: 64 * 1024
      });
      assert.ok(result.status !== 0 || result.signal !== null || result.error, `${mode} control must fail`);
      const diagnostic = buildSafeFailureDiagnostics({
        scenario: 'OPS13.C01',
        phase: 'diagnostic-control',
        stage: 'node-test-runner',
        status: result.status,
        signal: result.signal,
        error: result.error,
        stdout: result.stdout,
        stderr: result.stderr
      });
      assert.equal(diagnostic.records.length, 1, mode);
      assert.equal(diagnostic.records[0].failureCode, expectedCode, mode);
      assert.deepEqual(diagnostic.records[0].assertionContext, mode === 'timeout'
        ? { actualValueKind: null, expectedValueKind: null }
        : { actualValueKind: 'string', expectedValueKind: 'string' }, mode);
      assert.equal(diagnostic.records[0].sourceLocation,
        mode === 'timeout' ? 'redacted' : 'tests/operations/operations.test.js:4400:9', mode);
      const safeBytes = JSON.stringify(diagnostic);
      assert.ok(Buffer.byteLength(safeBytes, 'utf8') <= 2_048, mode);
      assert.doesNotMatch(safeBytes, /SYNTHETIC_PRIVATE_DIAGNOSTIC_CANARY_96d|file:\/\/|\/Users\//u, mode);
      diagnosticsByMode.set(mode, diagnostic.records[0]);
    }
    assert.equal(diagnosticsByMode.get('runtime-busy').errorClass, 'RuntimeError');
    assert.equal(diagnosticsByMode.get('runtime-busy').errorCode, 'STORE_BUSY');
    assert.equal(diagnosticsByMode.get('node-busy').sqlitePrimaryCode, 5);
    assert.equal(diagnosticsByMode.get('node-locked').sqlitePrimaryCode, 6);
    assert.equal(diagnosticsByMode.get('node-unsupported').sqlitePrimaryCode, null);
    assert.deepEqual(diagnosticsByMode.get('wrapped-runtime-busy').nestedStorageCause, {
      failureCode: 'SQLITE_BUSY', errorClass: 'RuntimeError',
      errorCode: 'STORE_BUSY', sqlitePrimaryCode: null
    });
    assert.equal(diagnosticsByMode.get('wrapped-runtime-busy').failureCode, 'ASSERTION_FAILURE');

    const ordinaryChild = spawnSync(process.execPath, [
      '--test', '--test-reporter=tap',
      join(ROOT, 'tests/operations/fixtures/ordinary-diagnostic-child.mjs')
    ], { cwd: ROOT, env: baseEnvironment(), encoding: 'utf8', timeout: 5_000, maxBuffer: 64 * 1024 });
    assert.equal(ordinaryChild.status, 1);
    assert.equal(ordinaryChild.signal, null);
    const ordinaryDiagnostics = buildSafeFailureDiagnostics({
      scenario: 'OPS13.C01', phase: 'diagnostic-control', stage: 'node-test-runner',
      status: ordinaryChild.status, signal: ordinaryChild.signal, error: ordinaryChild.error,
      stdout: ordinaryChild.stdout, stderr: ordinaryChild.stderr
    });
    assert.equal(ordinaryDiagnostics.records.length, 3);
    assert.ok(ordinaryDiagnostics.records.every(record => record.failureCode === 'ASSERTION_FAILURE'));
    assert.ok(ordinaryDiagnostics.records.every(record => record.errorClass === 'AssertionError'));
    assert.ok(ordinaryDiagnostics.records.every(record => record.errorCode === 'ERR_ASSERTION'));
    assert.ok(ordinaryDiagnostics.records.every(record => record.nestedStorageCause === null));
    assert.ok(Buffer.byteLength(JSON.stringify(ordinaryDiagnostics), 'utf8') <= 2_048);

    const structuralControls = [
      {
        id: 'cause-map-runtime-busy',
        body: '  cause:\n    name: RuntimeError\n    code: STORE_BUSY',
        expected: { failureCode: 'SQLITE_BUSY', errorClass: 'RuntimeError', errorCode: 'STORE_BUSY', sqlitePrimaryCode: null }
      },
      {
        id: 'error-marker-runtime-busy',
        body: "  error:\n    RuntimeError:\n      name: 'RuntimeError'\n      code: 'STORE_BUSY',",
        expected: { failureCode: 'SQLITE_BUSY', errorClass: 'RuntimeError', errorCode: 'STORE_BUSY', sqlitePrimaryCode: null }
      },
      {
        id: 'marker-split-runtime',
        body: '  cause:\n    RuntimeError:\n      name: RuntimeError\n    unrelated:\n      code: STORE_BUSY',
        expected: null
      },
      {
        id: 'marker-split-native',
        body: '  cause:\n    Error:\n      name: Error\n      code: ERR_SQLITE_ERROR\n    unrelated:\n      errcode: 5',
        expected: null
      },
      {
        id: 'marker-empty-then-unrelated',
        body: '  cause:\n    RuntimeError:\n    unrelated:\n      name: RuntimeError\n      code: STORE_BUSY',
        expected: null
      },
      {
        id: 'cause-map-node-extended-262',
        body: '  cause:\n    name: Error\n    code: ERR_SQLITE_ERROR\n    errcode: 262,',
        expected: { failureCode: 'SQLITE_BUSY', errorClass: 'Error', errorCode: 'ERR_SQLITE_ERROR', sqlitePrimaryCode: 6 }
      },
      {
        id: 'scalar-block-error',
        body: '  error: |-\n    RuntimeError:\n      code: STORE_BUSY',
        expected: null
      },
      {
        id: 'split-fields-across-siblings',
        body: '  cause:\n    first:\n      name: RuntimeError\n    second:\n      code: STORE_BUSY',
        expected: null
      },
      {
        id: 'split-native-fields-across-siblings',
        body: '  cause:\n    first:\n      name: Error\n      code: ERR_SQLITE_ERROR\n    second:\n      errcode: 5',
        expected: null
      },
      {
        id: 'native-fields-under-unrelated-detail',
        body: '  cause:\n    name: Error\n    code: ERR_SQLITE_ERROR\n    details:\n      errcode: 5',
        expected: null
      },
      {
        id: 'unsupported-native-primary',
        body: '  cause:\n    name: Error\n    code: ERR_SQLITE_ERROR\n    errcode: 1',
        expected: null
      },
      {
        id: 'marker-duplicate-code-field',
        body: '  cause:\n    RuntimeError:\n      name: RuntimeError\n      code: STORE_BUSY\n      code: STORE_BUSY',
        expected: null
      },
      {
        id: 'marker-malformed-scalar-value',
        body: '  cause:\n    RuntimeError: |\n      name: RuntimeError\n      code: STORE_BUSY',
        expected: null
      }
    ];
    for (const control of structuralControls) {
      const diagnostic = buildSafeFailureDiagnostics({
        scenario: 'OPS13.C01', phase: 'diagnostic-control', stage: 'node-test-runner',
        status: 1,
        stdout: `not ok 1 - ${control.id}\n  ---\n  name: AssertionError\n  code: ERR_ASSERTION\n${control.body}\n  ...\n`
      });
      assert.equal(diagnostic.records.length, 1, control.id);
      assert.equal(diagnostic.records[0].failureCode, 'ASSERTION_FAILURE', control.id);
      assert.deepEqual(diagnostic.records[0].nestedStorageCause, control.expected, control.id);
    }

    const typedBusy = runtimeError({
      module: 'state', operation: 'write', code: 'STORE_BUSY', retryable: true,
      safe_message: 'SYNTHETIC_PRIVATE_DIAGNOSTIC_CANARY_96d'
    });
    const typedDiagnostic = buildSafeFailureDiagnostics({
      scenario: 'OPS13.C01', phase: 'diagnostic-control', stage: 'node-test-runner',
      status: 1, error: typedBusy
    });
    assert.equal(typedDiagnostic.records[0].failureCode, 'SQLITE_BUSY');
    assert.equal(typedDiagnostic.records[0].errorClass, 'RuntimeError');
    assert.equal(typedDiagnostic.records[0].errorCode, 'STORE_BUSY');
    assert.doesNotMatch(JSON.stringify(typedDiagnostic), /SYNTHETIC_PRIVATE_DIAGNOSTIC_CANARY_96d/u);

    const temporary = tempDirectory('ah11-diagnostic-node-sqlite-');
    const blocker = new DatabaseSync(temporary.databasePath, { timeout: 0 });
    const contender = new DatabaseSync(temporary.databasePath, { timeout: 0 });
    try {
      blocker.exec('CREATE TABLE diagnostic_lock (id INTEGER PRIMARY KEY)');
      blocker.exec('BEGIN IMMEDIATE');
      let sqliteBusy;
      try {
        contender.exec('BEGIN IMMEDIATE');
      } catch (error) {
        sqliteBusy = error;
      }
      assert.ok(sqliteBusy instanceof Error);
      assert.equal(sqliteBusy.code, 'ERR_SQLITE_ERROR');
      assert.equal(sqliteBusy.errcode & 0xff, 5);
      const sqliteDiagnostic = buildSafeFailureDiagnostics({
        scenario: 'OPS13.C01', phase: 'diagnostic-control', stage: 'node-test-runner',
        status: 1, error: sqliteBusy
      });
      assert.equal(sqliteDiagnostic.records[0].failureCode, 'SQLITE_BUSY');
      assert.equal(sqliteDiagnostic.records[0].sqlitePrimaryCode, 5);
      assert.doesNotMatch(JSON.stringify(sqliteDiagnostic), /\/Users\//u);
    } finally {
      try { blocker.exec('ROLLBACK'); } catch {}
      try { contender.exec('ROLLBACK'); } catch {}
      contender.close();
      blocker.close();
      temporary.cleanup();
    }
    assert.equal(METRICS.providerCalls, 0);
  });
});

after(() => {
  if (process.env.AH11_OPS_METRICS_FILE) {
    writeFileSync(process.env.AH11_OPS_METRICS_FILE, JSON.stringify(METRICS));
  }
});
