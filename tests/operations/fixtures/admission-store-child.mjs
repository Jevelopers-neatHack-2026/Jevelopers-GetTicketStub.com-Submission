import { writeFileSync } from 'node:fs';
import { DurableWorkflowStore } from '../../../src/internal/durable-store.js';
import { OPERATIONS_STORAGE_CAPABILITY } from '../../../src/internal/private-ops-store-capability.js';
import { operationsStoragePolicy, readOperationsConfig, validateLocalPlanWork } from '../../../src/worker/private/config.js';

const [databasePath, tenantId, projectId, idempotencyKey, planJson, configJson, outputPath] = process.argv.slice(2);
if (![databasePath, tenantId, projectId, idempotencyKey, planJson, configJson, outputPath].every(value => typeof value === 'string')) process.exit(2);
let config;
try { config = readOperationsConfig(JSON.parse(configJson)); } catch { process.exit(2); }
const store = DurableWorkflowStore.open({ databasePath, busyTimeoutMs: config.busyTimeoutMs });
store._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, {
  maxStoreBytes: config.maxStoreBytes,
  maxWalBytes: config.maxWalBytes,
  minFreeDiskBytes: config.minFreeDiskBytes
});
try {
  const work = validateLocalPlanWork({ planJson, limitsJson: '{}' }, 'ops-validation-workflow', config);
  const result = store._operationsAdmit(OPERATIONS_STORAGE_CAPABILITY, {
    tenantId, projectId, idempotencyKey, workJson: work.workJson,
    policy: operationsStoragePolicy(config)
  });
  writeFileSync(outputPath, JSON.stringify({ result }));
} catch {
  process.exitCode = 1;
} finally {
  store.close();
}
