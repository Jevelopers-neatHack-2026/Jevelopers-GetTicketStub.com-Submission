import assert from 'node:assert/strict';
import https from 'node:https';
import { Resolver } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import '../../decisions/jev-adapter.contract/network-guard.js';
import { createHmacTokenizer, createTelemetryExporter, DurableWorkflowStore } from '../../../src/internal/index.js';
import { sendJevOnce } from '../../../src/adapters/jev/http-transport.js';
import { runPrivateJevTestAttempt } from '../../decisions/jev-adapter.contract/private-orchestrator.js';
import { recordSyntheticMetric } from '../../decisions/jev-adapter.contract/synthetic-metrics.js';
import { createOperationsWorker } from '../../../src/worker/private/worker.js';

const [databasePath, phase, markerPath, resultPath, metricsPath] = process.argv.slice(2);
if (!['before-marker', 'after-marker-before-bytes', 'after-write', 'response-before-observation', 'observation-before-checkpoint', 'failure-after-runner-pause', 'failure-runner-marker-missing', 'failure-runner-marker-partial'].includes(phase)
    || ![databasePath, markerPath, resultPath, metricsPath].every(value => typeof value === 'string')) process.exit(2);

const API_KEY_FIXTURE = 'synthetic-offline-key';
const REQUEST = JSON.parse(await readFile(new URL('../../fixtures/jev/positive-request.json', import.meta.url), 'utf8'));
const RESPONSE = await readFile(new URL('../../fixtures/jev/positive-response.json', import.meta.url));
const workflowId = `ops-jev-${process.pid}`;
const ownerId = `${workflowId}-worker`;
let abortController = new AbortController();
let releasePhase;
const phaseRelease = new Promise(resolve => { releasePhase = resolve; });
let termSeen = false;
let operationsWorker;
let operationsLoop;
let operationsStopPromise;
let removeOperationsSignals;
let restartedWorker;
let store;
let tokenizer;
let exporter;
let sinkCalls = 0;
let runnerPid;
const metrics = { controlled_dns_resolve4: 0, controlled_dns_resolve6: 0, controlled_https_request: 0, controlled_https_write: 0, blocked_external_network_attempt: 0 };
const keepalive = setInterval(() => {}, 1_000);
async function publishMarker(value) {
  const temporaryPath = `${markerPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), { flag: 'wx' });
  try {
    await rename(temporaryPath, markerPath);
  } catch (error) {
    try { await unlink(temporaryPath); } catch {}
    throw error;
  }
}
async function publishRunnerMarker() {
  const path = `${metricsPath}.runner`;
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ runnerPid, fixturePid: process.pid }), { flag: 'wx' });
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    try { await unlink(temporaryPath); } catch {}
    throw error;
  }
}
async function waitWithin(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise).then(() => true, () => true),
      new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function stopOwnedWorker(worker) {
  if (!worker || worker.lifecycle === 'stopped') return;
  let stopping;
  try { stopping = worker.stop('test'); } catch { return; }
  if (await waitWithin(stopping, 2_000)) return;
  if (runnerPid) {
    try { process.kill(runnerPid, 'SIGCONT'); } catch {}
    try { process.kill(runnerPid, 'SIGKILL'); } catch {}
  }
  await waitWithin(stopping, 500);
}
const record = name => {
  metrics[name] += 1;
  recordSyntheticMetric(name);
};

const onSigterm = () => {
  termSeen = true;
  abortController.abort();
  releasePhase();
  if (operationsWorker && !operationsStopPromise) operationsStopPromise = operationsWorker.stop('signal');
};
process.on('SIGTERM', onSigterm);

try {
t:
{
  store = DurableWorkflowStore.open({ databasePath, clock: () => 1000, busyTimeoutMs: 20 });
  tokenizer = createHmacTokenizer(Buffer.alloc(32, 29));
  exporter = createTelemetryExporter({
    store,
    tokenizer,
    sink: () => {
      sinkCalls += 1;
      return new Promise(() => {});
    },
    limits: {
      queueRecords: 8, queueBytes: 8192, batchSize: 8, maxAttempts: 1,
      retryDelayMs: 0, sinkTimeoutMs: 350, maxBatchesPerFlush: 1,
      maxPolicyDropsPerFlush: 1
    }
  });
  operationsWorker = createOperationsWorker({
    databasePath, ownerId: 'review-worker-jev-composition', telemetry: exporter,
    config: { shutdownTimeoutMs: 1_500, childKillGraceMs: 40, childReapReserveMs: 200 }
  });
  removeOperationsSignals = operationsWorker.installSignalHandlers();
  operationsLoop = operationsWorker.start();
  const localPlan = JSON.stringify({
    kind: 'agent-harness.private-synthetic-plan', version: 1,
    steps: Array.from({ length: 32 }, (_, index) => ({
      id: `w${String(index).padStart(2, '0')}`, operation: 'text.concat',
      dependsOn: index % 12 === 0 ? [] : [`w${String(index - 1).padStart(2, '0')}`],
      args: { parts: index % 12 === 0 ? ['x'.repeat(512)] : [{ $result: `w${String(index - 1).padStart(2, '0')}` }, ''] }
    }))
  });
  const localScope = { tenantId: 'composition-tenant', projectId: 'composition-project' };
  const localWork = operationsWorker.submitSyntheticWork({
    trustedSyntheticScope: localScope, idempotencyKey: `jev-composition-${phase}`, planJson: localPlan
  });
  if (!localWork.accepted) throw new Error('The real operations worker did not accept the bounded local plan.');
  const runnerDeadline = Date.now() + 5_000;
  while (operationsWorker.activeChildCount === 0 && Date.now() < runnerDeadline) await new Promise(resolve => setTimeout(resolve, 2));
  if (operationsWorker.activeChildCount !== 1) throw new Error('The real operations runner child did not start.');
  const pgrep = spawnSync('pgrep', ['-P', String(process.pid)], { encoding: 'utf8' });
  if (pgrep.status !== 0) throw new Error('The owned operations runner PID was unavailable.');
  runnerPid = Number(pgrep.stdout.trim().split(/\s+/u).at(-1));
  if (!Number.isSafeInteger(runnerPid) || runnerPid < 2 || !process.kill(runnerPid, 'SIGSTOP')) {
    throw new Error('The JEV composition fixture could not pause its actual owned runner.');
  }
  if (phase === 'failure-runner-marker-partial') {
    await writeFile(`${metricsPath}.runner`, '{"runnerPid":');
    await publishMarker({ phase, stage: 'runner-marker-ready' });
    await phaseRelease;
    throw new Error('Injected partial runner marker failure.');
  }
  if (phase === 'failure-runner-marker-missing') {
    await publishMarker({ phase, stage: 'runner-marker-ready' });
    await phaseRelease;
    throw new Error('Injected missing runner marker failure.');
  }
  await publishRunnerMarker();
  if (phase === 'failure-after-runner-pause') {
    await publishMarker({ phase, stage: 'force-rename-failure-after-runner-pause' });
  }
  store.createWorkflow({ workflowId, checkpoint: { local: 'synthetic-before-send' }, eventId: `${workflowId}:created` });
  const lease = store.acquireLease({ workflowId, ownerId, ttlMs: 60_000, eventId: `${workflowId}:lease` });
  const running = store.transitionWorkflow({
    ...lease,
    expectedRevision: lease.revision,
    toState: 'running',
    eventId: `${workflowId}:running`
  });
  const current = { ...lease, revision: running.revision };

  Resolver.prototype.resolve4 = host => {
    assert.equal(host, 'api.typesafe.ai');
    record('controlled_dns_resolve4');
    return Promise.resolve(['93.184.216.34']);
  };
  Resolver.prototype.resolve6 = host => {
    assert.equal(host, 'api.typesafe.ai');
    record('controlled_dns_resolve6');
    return Promise.resolve([]);
  };
  https.request = (options, callback) => {
    record('controlled_https_request');
    assert.equal(options.protocol, 'https:');
    assert.equal(options.hostname, 'api.typesafe.ai');
    const request = new EventEmitter();
    request.destroyed = false;
    request.destroy = () => { request.destroyed = true; };
    request.end = () => {
      record('controlled_https_write');
      if (phase === 'after-write') {
        void publishMarker({ phase, stage: 'possible-write' }).catch(() => {});
        return;
      }
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = Object.assign(Object.create(null), {
        'content-type': 'application/json', 'content-length': String(RESPONSE.length)
      });
      response.rawHeaders = Object.entries(response.headers).flatMap(([key, value]) => [key, value]);
      setImmediate(() => {
        callback(response);
        response.emit('data', RESPONSE);
        response.emit('end');
      });
    };
    const socket = new EventEmitter();
    socket.encrypted = true;
    socket.authorized = false;
    socket.secureConnecting = true;
    socket.destroyed = false;
    socket.destroy = () => { socket.destroyed = true; };
    setImmediate(() => request.emit('socket', socket));
    setImmediate(() => {
      socket.secureConnecting = false;
      socket.authorized = true;
      socket.emit('secureConnect');
    });
    return request;
  };

  const summary = { phase, workflowId, attemptCount: 0, markerCount: 0, observationCount: 0, termSeen: false };
  if (phase === 'before-marker') {
    await publishMarker({ phase, stage: 'workflow-before-marker' });
    await phaseRelease;
  } else {
    const originalRecord = store.recordJevProviderObservation.bind(store);
    if (phase === 'response-before-observation') {
      store.recordJevProviderObservation = observation => (async () => {
        await publishMarker({ phase, stage: 'response-before-observation' });
        await phaseRelease;
        return originalRecord(observation);
      })();
    }
    const sender = async ({ request, apiKey }) => {
      if (phase === 'after-marker-before-bytes') {
        await publishMarker({ phase, stage: 'marker-before-bytes' });
        await phaseRelease;
      }
      if (phase === 'after-write') {
        // This actual existing transport receives the owned child's native AbortSignal.
        return sendJevOnce({ request, apiKey, signal: abortController.signal });
      }
      if (phase === 'response-before-observation' || phase === 'observation-before-checkpoint') {
        return sendJevOnce({ request, apiKey, signal: abortController.signal });
      }
      return sendJevOnce({ request, apiKey, signal: abortController.signal });
    };
    const attempt = await runPrivateJevTestAttempt({
      store,
      workflowId,
      ownerId,
      fence: current.fence,
      expectedRevision: current.revision,
      attemptId: `ops-attempt-${phase}`,
      logicalOperationRef: `ops-logical-${phase}`,
      transportAttemptId: `ops-transport-${phase}`,
      authorityHoldRef: `synthetic-local-bookkeeping:hold-${phase}`,
      request: REQUEST,
      apiKey: API_KEY_FIXTURE,
      testOnlySend: sender
    });
    if (phase === 'response-before-observation') await phaseRelease;
    if (attempt.persistedObservation instanceof Promise) await attempt.persistedObservation;
    const rows = new DatabaseSync(databasePath, { readOnly: true });
    try {
      summary.attemptCount = Number(rows.prepare('SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id = ?').get(workflowId).count);
      summary.markerCount = Number(rows.prepare('SELECT COUNT(*) AS count FROM jev_dispatch_markers WHERE workflow_id = ?').get(workflowId).count);
    } finally { rows.close(); }
    summary.observationCount = store.readJevObservationDeliveryPage({ afterSequence: 0, limit: 10 }).items
      .filter(item => item.workflowId === workflowId).length;
    summary.dispatchCertainty = attempt.observation?.dispatchCertainty ?? null;
    if (phase === 'observation-before-checkpoint') {
      await publishMarker({ phase, stage: 'observation-before-checkpoint' });
      await phaseRelease;
    }
  }

  summary.termSeen = termSeen;
  summary.controlledHttpsRequests = metrics.controlled_https_request;
  summary.controlledHttpsWrites = metrics.controlled_https_write;
  summary.blockedExternalNetworkAttempts = metrics.blocked_external_network_attempt;
  const raw = new DatabaseSync(databasePath, { readOnly: true });
  try {
    summary.opaqueHoldRetained = Number(raw.prepare(
      'SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id = ? AND authority_hold_ref IS NOT NULL'
    ).get(workflowId).count) > 0;
  } finally { raw.close(); }

  if (!operationsStopPromise) throw new Error('SIGTERM did not request operations-worker shutdown.');
  const stopped = await operationsStopPromise;
  await operationsLoop;
  if (!stopped.stopped || !stopped.childrenReaped || !stopped.storeClosed || sinkCalls !== 1) {
    throw new Error('Combined worker, child, and telemetry shutdown did not finish within its owner bounds.');
  }
  const telemetry = exporter.diagnostics();
  if (telemetry.cursor !== 0 || telemetry.pendingRecords <= 0) {
    throw new Error('The telemetry outage did not retain its cursor and pending event records.');
  }
  const stoppedOps = new DatabaseSync(databasePath, { readOnly: true });
  const stoppedWork = stoppedOps.prepare(
    'SELECT job_id, state, generation, fence_token FROM operations_work WHERE idempotency_key=?'
  ).get(`jev-composition-${phase}`);
  const stoppedCounters = stoppedOps.prepare(
    'SELECT pending_records, in_flight FROM operations_meta WHERE singleton=1'
  ).get();
  const attemptsAfterStop = Number(stoppedOps.prepare(
    'SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id=?'
  ).get(workflowId).count);
  stoppedOps.close();
  summary.telemetryCursor = telemetry.cursor;
  summary.telemetryPendingRecords = telemetry.pendingRecords;
  summary.telemetrySinkCalls = sinkCalls;
  summary.operationsWorkerStopped = stopped.stopped;
  summary.ownedRunnerReaped = stopped.childrenReaped;
  summary.operationsWorkStateAfterStop = stoppedWork?.state ?? null;
  summary.operationsFenceBeforeRestart = Number(stoppedWork?.fence_token ?? 0);
  summary.operationsGenerationBeforeRestart = Number(stoppedWork?.generation ?? 0);
  summary.operationsInFlightAfterStop = Number(stoppedCounters.in_flight);
  summary.providerAttemptCountAfterStop = attemptsAfterStop;
  if (stoppedWork?.state !== 'queued' || Number(stoppedCounters.in_flight) !== 0
      || attemptsAfterStop !== summary.attemptCount) {
    throw new Error('Worker cleanup changed queue accounting or provider-attempt history.');
  }

  restartedWorker = createOperationsWorker({ databasePath, ownerId: 'review-worker-jev-composition-restart' });
  restartedWorker.start();
  const restartDeadline = Date.now() + 8_000;
  let resumed;
  while (Date.now() < restartDeadline) {
    resumed = restartedWorker.readScopedWorkPage({ trustedSyntheticScope: localScope, limit: 10 }).items
      .find(item => item.jobId === localWork.jobId);
    if (resumed?.state === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  if (resumed?.state !== 'completed') throw new Error('Restart did not resume the same bounded local plan.');
  const restartStop = await restartedWorker.stop('test');
  const finalOps = new DatabaseSync(databasePath, { readOnly: true });
  const finalWork = finalOps.prepare('SELECT state, generation, fence_token FROM operations_work WHERE job_id=?').get(localWork.jobId);
  const finalWorkflow = finalOps.prepare('SELECT state, fence_token FROM workflows WHERE workflow_id=?').get(resumed.workflowId);
  const attemptsAfterRestart = Number(finalOps.prepare(
    'SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id=?'
  ).get(workflowId).count);
  finalOps.close();
  summary.operationsRestarted = restartStop.stopped && finalWork.state === 'completed';
  summary.operationsWorkflowStateAfterRestart = finalWorkflow.state;
  summary.operationsFenceAfterRestart = Number(finalWork.fence_token);
  summary.operationsGenerationAfterRestart = Number(finalWork.generation);
  summary.providerAttemptCountAfterRestart = attemptsAfterRestart;
  if (!summary.operationsRestarted || finalWorkflow.state !== 'succeeded'
      || summary.operationsFenceAfterRestart <= summary.operationsFenceBeforeRestart
      || summary.operationsGenerationAfterRestart <= summary.operationsGenerationBeforeRestart
      || attemptsAfterRestart !== summary.attemptCount || metrics.controlled_https_write > 1) {
    throw new Error('Restart or higher-fence composition violated the JEV/local-work identity bounds.');
  }
  await writeFile(metricsPath, JSON.stringify(metrics));
  await writeFile(resultPath, JSON.stringify(summary));
  store.close();
}
} finally {
  releasePhase();
  abortController.abort();
  clearInterval(keepalive);
  process.removeListener('SIGTERM', onSigterm);
  try { removeOperationsSignals?.(); } catch {}
  await stopOwnedWorker(operationsWorker);
  await stopOwnedWorker(restartedWorker);
  if (operationsLoop) await waitWithin(operationsLoop, 500);
  if (operationsStopPromise) await waitWithin(operationsStopPromise, 500);
  try { store?.close(); } catch {}
  try { tokenizer?.destroy(); } catch {}
}
process.exitCode = 0;
