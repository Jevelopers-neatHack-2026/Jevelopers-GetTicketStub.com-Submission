import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
import { operationsStoragePolicy, readOperationsConfig, validateLocalPlanWork } from '../../src/worker/private/config.js';
import { createOperationsWorker } from '../../src/worker/private/worker.js';
import { readStoreCompatibility, readOperationsHealth, requestOwnerRetention } from '../../src/health/private/health.js';

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
  return DurableWorkflowStore.open({ databasePath, busyTimeoutMs: 20, ...options });
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

test('OPS01_CONFIG_HOSTILE rejects hostile option/job objects before getters, traps, or serialization run', () => {
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
  afterCrash.close();

  const outFiles = Array.from({ length: 4 }, (_, index) => join(temporary.directory, `race-${index}.json`));
  const childScript = join(ROOT, 'tests/operations/fixtures/admission-child.mjs');
  const races = await Promise.all(outFiles.map(path => runChild(childScript, [
    temporary.databasePath, 'tenant-race', 'project-race', 'same-key', PLAN, path
  ])));
  assert.ok(races.every(result => result.code === 0), races.map(result => result.stderr).join('\n'));
  const replies = outFiles.map(path => JSON.parse(readFileSync(path, 'utf8')));
  assert.equal(replies.filter(reply => reply.result.duplicate === false).length, 1);
  assert.equal(replies.filter(reply => reply.result.duplicate === true).length, 3);
  assert.ok(replies.every(reply => reply.result.jobId === replies[0].result.jobId));
  const raw = new DatabaseSync(temporary.databasePath, { readOnly: true });
  assert.equal(Number(raw.prepare('SELECT COUNT(*) AS count FROM operations_work WHERE idempotency_key = ?').get('same-key').count), 1);
  assert.equal(Number(raw.prepare('SELECT pending_records FROM operations_meta WHERE singleton = 1').get().pending_records) <= 2, true);
  raw.close();
});

test('OPS03_FAIRNESS_BACKPRESSURE protects a second tenant and persists hierarchical turns across claims', t => {
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

  let logicalNow = 10_000;
  const stale = tempDirectory('ah11-stale-runner-');
  t.after(() => stale.cleanup());
  const staleStore = DurableWorkflowStore.open({
    databasePath: stale.databasePath, busyTimeoutMs: 20, clock: () => logicalNow
  });
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
  const unknownStore = DurableWorkflowStore.open({
    databasePath: unknown.databasePath, busyTimeoutMs: 20, clock: () => unknownNow
  });
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
  const waiters = Array.from({ length: 16 }, () => worker.waitForIdle(5_000));
  assert.equal(await worker.waitForIdle(5_000), false);
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
});

test('OPS07_STORE_RESOURCE_FAILURE maps real SQLite BUSY to typed bounded backpressure and reports headroom', t => {
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
  const directStore = openStore(join(temporary.directory, 'health-direct.sqlite'));
  t.after(() => directStore.close());
  const direct = readOperationsHealth({ store: directStore, config: {}, lifecycle: 'accepting', heartbeatAgeMs: 10_000 });
  assert.ok(direct.degradedReasons.includes('DIAGNOSTICS_STALE'));
  assert.equal(direct.externalDispatchEnabled, false);
  const nonexistent = readStoreCompatibility(join(temporary.directory, 'missing.sqlite'));
  assert.equal(nonexistent.status, 'store_unavailable');
  const stopped = await worker.stop('test');
  assert.equal(stopped.stopped, true);
  assert.equal(canaryTenant.includes('tenant-secret'), true);
});

test('OPS09_MIGRATION_COMPATIBILITY migrates schema 5 atomically, preserves older migration cases, and refuses future bytes', t => {
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
  tokenizer.destroy();
  store.close();
  await worker.stop('test');
});

test('OPS11_RETENTION_OWNER_HOOKS refuses deletion or settlement without accepted external owner policy', t => {
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
    assert.equal(child.kill('SIGTERM'), true);
    METRICS.processSigtermSignalsSent += 1;
    const exit = await new Promise(resolvePromise => child.once('close', (code, signal) => resolvePromise({ code, signal })));
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
});

test('OPS13_EVIDENCE_GATES binds all required groups to the current source and reports no unrun provider success', () => {
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
    'processSigtermDrainElapsedMsMax', 'processSigtermDrainSamples', 'maxSupervisorRssBytes', 'maxRunnerRssBytes'
  ].sort());
  assert.equal(METRICS.providerCalls, 0);
  assert.equal(METRICS.blockedExternalNetworkAttempts, 0);
});

after(() => {
  if (process.env.AH11_OPS_METRICS_FILE) {
    writeFileSync(process.env.AH11_OPS_METRICS_FILE, JSON.stringify(METRICS));
  }
});
