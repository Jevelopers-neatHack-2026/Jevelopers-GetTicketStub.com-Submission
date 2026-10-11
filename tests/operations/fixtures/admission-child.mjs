import { existsSync, renameSync, writeFileSync } from 'node:fs';
import { createOperationsWorker } from '../../../src/worker/private/worker.js';

const [databasePath, tenantId, projectId, idempotencyKey, planJson, outputPath, readyPath, releasePath] = process.argv.slice(2);
if (![databasePath, tenantId, projectId, idempotencyKey, planJson, outputPath, readyPath, releasePath]
  .every(value => typeof value === 'string')) {
  process.exit(2);
}
const worker = createOperationsWorker({ databasePath, ownerId: `ops-worker:${process.pid}` });
let didStop = false;
try {
  const readyTemporaryPath = `${readyPath}.${process.pid}.tmp`;
  writeFileSync(readyTemporaryPath, JSON.stringify({ storeOpen: true, pid: process.pid }), { flag: 'wx', mode: 0o600 });
  renameSync(readyTemporaryPath, readyPath);
  const releaseDeadline = Date.now() + 5_000;
  while (!existsSync(releasePath)) {
    if (Date.now() >= releaseDeadline) throw new Error('The bounded admission release gate expired.');
    await new Promise(resolveWait => setTimeout(resolveWait, 2));
  }
  void worker.start();
  const result = worker.submitSyntheticWork({
    trustedSyntheticScope: { tenantId, projectId },
    idempotencyKey,
    planJson
  });
  const stopResult = await worker.stop('test');
  didStop = stopResult.stopped;
  await import('node:fs/promises').then(({ writeFile }) => writeFile(outputPath, JSON.stringify({ result, stopped: stopResult })));
  process.exitCode = stopResult.stopped ? 0 : 2;
} catch {
  process.exitCode = 2;
} finally {
  if (!didStop) {
    try { await worker.stop('test'); } catch {}
  }
}
