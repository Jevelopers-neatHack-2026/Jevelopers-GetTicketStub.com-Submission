import { DurableWorkflowStore } from '../../internal/durable-store.js';
import { OPERATIONS_STORAGE_CAPABILITY } from '../../internal/private-ops-store-capability.js';
import { runBoundedLocalPlan } from '../../orchestrator/internal/controller.js';

function safeArgs(args) {
  if (args.length !== 9) return null;
  const [databasePath, jobId, ownerId, generationText, fenceText, busyTimeoutText,
    maxStoreBytesText, maxWalBytesText, minFreeDiskBytesText] = args;
  const generation = Number(generationText);
  const fence = Number(fenceText);
  const busyTimeoutMs = Number(busyTimeoutText);
  const maxStoreBytes = Number(maxStoreBytesText);
  const maxWalBytes = Number(maxWalBytesText);
  const minFreeDiskBytes = Number(minFreeDiskBytesText);
  if (typeof databasePath !== 'string' || databasePath.length === 0 || databasePath.length > 1024
      || !/^ops-job:[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(jobId)
      || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(ownerId)
      || !Number.isSafeInteger(generation) || generation < 1
      || !Number.isSafeInteger(fence) || fence < 1
      || !Number.isSafeInteger(busyTimeoutMs) || busyTimeoutMs < 1 || busyTimeoutMs > 250
      || !Number.isSafeInteger(maxStoreBytes) || maxStoreBytes < 16_777_216 || maxStoreBytes > 1_073_741_824
      || !Number.isSafeInteger(maxWalBytes) || maxWalBytes < 1_048_576 || maxWalBytes > 134_217_728
      || !Number.isSafeInteger(minFreeDiskBytes) || minFreeDiskBytes < 1_048_576 || minFreeDiskBytes > 1_073_741_824) return null;
  return { databasePath, jobId, ownerId, generation, fence, busyTimeoutMs,
    maxStoreBytes, maxWalBytes, minFreeDiskBytes };
}

const args = safeArgs(process.argv.slice(2));
if (!args) {
  process.exitCode = 2;
} else {
  let store;
  try {
    store = DurableWorkflowStore.open({
      databasePath: args.databasePath,
      busyTimeoutMs: args.busyTimeoutMs
    });
    store._operationsSetResourceCeilings(OPERATIONS_STORAGE_CAPABILITY, {
      maxStoreBytes: args.maxStoreBytes,
      maxWalBytes: args.maxWalBytes,
      minFreeDiskBytes: args.minFreeDiskBytes
    });
    const claim = store._operationsReadClaim(OPERATIONS_STORAGE_CAPABILITY, {
      jobId: args.jobId,
      ownerId: args.ownerId,
      generation: args.generation,
      fence: args.fence
    });
    const result = await runBoundedLocalPlan({
      store,
      workflowId: claim.workflowId,
      ownerId: claim.ownerId,
      fence: claim.fence,
      planJson: claim.work.planJson,
      limitsJson: claim.work.limitsJson
    });
    process.exitCode = result?.status === 'completed' ? 0 : 2;
  } catch {
    process.exitCode = 2;
  } finally {
    try {
      store?.close();
    } catch {
      process.exitCode = 2;
    }
  }
}
