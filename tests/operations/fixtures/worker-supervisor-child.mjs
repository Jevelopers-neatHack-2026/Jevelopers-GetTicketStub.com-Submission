import { createOperationsWorker } from '../../../src/worker/private/worker.js';

const [databasePath, ownerId, idempotencyKey = 'worker-crash-recovery'] = process.argv.slice(2);
if (![databasePath, ownerId, idempotencyKey].every(value => typeof value === 'string' && value.length > 0)) {
  process.exit(2);
}

const scope = { tenantId: 'worker-crash-tenant', projectId: 'worker-crash-project' };
const planJson = JSON.stringify({
  kind: 'agent-harness.private-synthetic-plan', version: 1,
  steps: Array.from({ length: 32 }, (_, index) => ({
    id: `cr${String(index).padStart(2, '0')}`,
    operation: 'text.concat',
    dependsOn: index % 12 === 0 ? [] : [`cr${String(index - 1).padStart(2, '0')}`],
    args: { parts: index % 12 === 0 ? ['x'.repeat(512)] : [{ $result: `cr${String(index - 1).padStart(2, '0')}` }, ''] }
  }))
});

let worker;
try {
  worker = createOperationsWorker({ databasePath, ownerId });
  worker.installSignalHandlers();
  const loop = worker.start();
  const submitted = worker.submitSyntheticWork({
    trustedSyntheticScope: scope,
    idempotencyKey,
    planJson
  });
  if (!submitted.accepted) throw new Error(`Work admission failed: ${submitted.reasonCode ?? submitted.code ?? 'unknown'}`);
  process.stdout.write(`${JSON.stringify({ event: 'ready', ownerId, ...submitted, providerCalls: 0 })}\n`);
  await loop;
  const stopped = await worker.stop('signal');
  process.stdout.write(`${JSON.stringify({ event: 'stopped', ownerId, stopped, providerCalls: 0 })}\n`);
  process.exitCode = stopped.stopped ? 0 : 2;
} catch (error) {
  process.stderr.write(`Worker supervisor fixture failed: ${error?.message ?? 'unknown'}\n`);
  try { if (worker && worker.lifecycle !== 'stopped') await worker.stop('test'); } catch {}
  process.exitCode = 1;
}
