import { existsSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { DurableWorkflowStore } from '../../../src/internal/index.js';
import { OPERATIONS_STORAGE_CAPABILITY } from '../../../src/internal/private-ops-store-capability.js';
import { operationsStoragePolicy, readOperationsConfig } from '../../../src/worker/private/config.js';

const [databasePath, nowText, ownerId, recoverableJobId, readyPath, gatePath, configText] = process.argv.slice(2);
if (![databasePath, nowText, ownerId, recoverableJobId, readyPath, gatePath, configText]
  .every(value => typeof value === 'string' && value.length > 0)) process.exit(2);

let store;
try {
  const config = readOperationsConfig(JSON.parse(configText));
  const policy = operationsStoragePolicy(config);
  store = DurableWorkflowStore.open({ databasePath, busyTimeoutMs: 100 });
  store._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, {
    maxStoreBytes: config.maxStoreBytes,
    maxWalBytes: config.maxWalBytes,
    minFreeDiskBytes: config.minFreeDiskBytes
  });
  writeFileSync(readyPath, JSON.stringify({ processId: process.pid }));
  const deadline = Date.now() + 5_000;
  while (!existsSync(gatePath) && Date.now() < deadline) await delay(2);
  if (!existsSync(gatePath)) throw new Error('The recovery race gate was not released.');
  const outcome = store._operationsClaim(OPERATIONS_STORAGE_CAPABILITY, {
    ownerId,
    policy,
    recoverableJobIds: [recoverableJobId]
  });
  process.stdout.write(JSON.stringify({
    ownerId,
    claim: outcome?.claim ? {
      jobId: outcome.claim.jobId,
      generation: outcome.claim.generation,
      fence: outcome.claim.fence
    } : null,
    incomplete: Boolean(outcome?.incomplete),
    ownedRunnerCount: 0
  }) + '\n');
} catch (error) {
  process.stderr.write(`${typeof error?.code === 'string' ? error.code : 'RECOVERY_RACE_FAILED'}\n`);
  process.exitCode = 1;
} finally {
  try { store?.close(); } catch {}
}
