import { createOperationsWorker } from '../../../src/worker/private/worker.js';

const [databasePath, tenantId, projectId, idempotencyKey, planJson, outputPath] = process.argv.slice(2);
if (![databasePath, tenantId, projectId, idempotencyKey, planJson, outputPath].every(value => typeof value === 'string')) {
  process.exit(2);
}
const worker = createOperationsWorker({ databasePath, ownerId: `ops-worker:${process.pid}` });
void worker.start();
try {
  const result = worker.submitSyntheticWork({
    trustedSyntheticScope: { tenantId, projectId },
    idempotencyKey,
    planJson
  });
  const stopped = await worker.stop('test');
  await import('node:fs/promises').then(({ writeFile }) => writeFile(outputPath, JSON.stringify({ result, stopped })));
  process.exitCode = stopped.stopped ? 0 : 2;
} catch {
  await worker.stop('test');
  process.exitCode = 2;
}
