import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { createOperationsWorker } from '../../../src/worker/private/worker.js';

const [databasePath, jobId] = process.argv.slice(2);
if (![databasePath, jobId].every(value => typeof value === 'string' && value.length > 0)) process.exit(2);

const scope = { tenantId: 'signal-tenant', projectId: 'signal-project' };
let worker = null;
let stopped = false;
let stage = 'restart_start';
const elapsedMs = startedAt => {
  const elapsed = performance.now() - startedAt;
  return Number.isFinite(elapsed) && elapsed >= 0 ? Number(elapsed.toFixed(3)) : null;
};

try {
  worker = createOperationsWorker({ databasePath, ownerId: 'review-worker-restart' });
  const restartStartedAt = performance.now();
  const loop = worker.start();
  const deadline = Date.now() + 8_000;
  let completed = null;
  stage = 'restart_wait';
  while (Date.now() < deadline) {
    completed = worker.readScopedWorkPage({ trustedSyntheticScope: scope, limit: 10 }).items
      .find(item => item.jobId === jobId);
    if (completed?.state === 'completed') break;
    await delay(10);
  }
  if (completed?.state !== 'completed') {
    throw new Error('restart_wait');
  }
  const restartWorkElapsedMs = elapsedMs(restartStartedAt);
  const finalStopStartedAt = performance.now();
  stage = 'restart_stop';
  const finalStop = await worker.stop('test');
  stopped = true;
  await loop;
  const finalStopElapsedMs = elapsedMs(finalStopStartedAt);
  if (!finalStop.stopped || !finalStop.childrenReaped || !finalStop.storeClosed) {
    throw new Error('restart_stop');
  }
  stage = 'restart_verify';
  const final = new DatabaseSync(databasePath, { readOnly: true });
  let completedJob;
  let completedWorkflow;
  let finalAttempts;
  try {
    completedJob = final.prepare('SELECT state, generation, fence_token FROM operations_work WHERE job_id=?').get(jobId);
    completedWorkflow = final.prepare('SELECT state, fence_token FROM workflows WHERE workflow_id=(SELECT workflow_id FROM operations_work WHERE job_id=?)').get(jobId);
    finalAttempts = Number(final.prepare('SELECT COUNT(*) AS count FROM operation_attempts').get().count);
  } finally {
    final.close();
  }
  if (completedJob?.state !== 'completed' || completedWorkflow?.state !== 'succeeded'
      || finalAttempts !== 0) {
    throw new Error('restart_verify');
  }
  process.stdout.write(`${JSON.stringify({
    event: 'restarted', providerCalls: 0,
    phaseElapsedMs: { restartWorkElapsedMs, finalStopElapsedMs },
    afterRestart: {
      state: completedJob.state, workflowState: completedWorkflow.state,
      generation: Number(completedJob.generation), fence: Number(completedWorkflow.fence_token)
    },
    attemptCount: finalAttempts
  })}\n`);
} catch {
  const safeStage = ['restart_start', 'restart_wait', 'restart_stop', 'restart_verify'].includes(stage)
    ? stage : 'unknown';
  process.stderr.write(`AH11_OPS_OPS06_RESTART_FAILURE stage=${safeStage} errorClass=error\n`);
  process.exitCode = 1;
} finally {
  if (!stopped && worker !== null) {
    try { if (worker.lifecycle !== 'stopped') await worker.stop('test'); } catch {}
  }
}
