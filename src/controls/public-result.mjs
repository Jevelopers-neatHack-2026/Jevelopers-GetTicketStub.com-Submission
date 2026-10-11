/** Browser consumer projections. These validate presentation, never authority. */
import { snapshotControlJson, isRecord, validId } from './schema.mjs';

const hash = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const statuses = ['queued', 'pending', 'running', 'unknown', 'failed', 'completed', 'cancelled', 'ready'];
function snapshot(value) {
  try { const data = snapshotControlJson(value); return isRecord(data) ? data : {}; }
  catch { return {}; }
}
function selection(value) {
  return isRecord(value) && validId(value.design_version_id) && Number.isSafeInteger(value.revision) && value.revision > 0 ?
    { design_version_id: value.design_version_id, revision: value.revision } : undefined;
}
function artwork(value) {
  return isRecord(value) && validId(value.design_version_id) && isRecord(value.artifact) && hash(value.artifact.content_hash) ?
    { design_version_id: value.design_version_id, artifact: { content_hash: value.artifact.content_hash } } : undefined;
}
export function projectCounters(input) {
  const data = snapshot(input), counts = data.counters;
  if (!isRecord(counts) || !['jobs', 'jev_calls', 'image_calls'].every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0)) return undefined;
  return { jobs: counts.jobs, jev_calls: counts.jev_calls, image_calls: counts.image_calls };
}
export function projectApplyResult(input) {
  const data = snapshot(input), operation = validId(data.operation_id) ? data.operation_id : undefined;
  const invalidReference = Object.hasOwn(data, 'operation_id') && !operation;
  const design = artwork(data.result?.design_version);
  const invalidArtwork = data.result?.design_version !== undefined && (!design || !validId(data.backend_job_id));
  return {
    ok: data.ok === true && Boolean(operation) && !invalidReference && !invalidArtwork,
    // Unsafe/malformed references have fixed local guidance, even if the code
    // would otherwise imply a known predispatch-only outcome.
    code: invalidReference || invalidArtwork ? undefined : typeof data.code === 'string' ? data.code : undefined,
    operation_id: invalidArtwork ? undefined : operation,
    status: operation && !invalidArtwork && statuses.includes(data.status) ? data.status : undefined,
    backend_error: data.backend_error !== undefined && data.backend_error !== null,
    pending_bridge: ['creative.composition.consume/1', 'creative.compound.consume/1'].includes(data.pending_bridge) ? data.pending_bridge : undefined,
    ...(design && validId(data.backend_job_id) ? { backend_job_id: data.backend_job_id, result: { design_version: design } } : {}),
  };
}
export function projectHistoryList(input) {
  const data = snapshot(input), selected = selection(data.selection), items = data.result?.items;
  if (data.ok !== true || !selected || !Array.isArray(items) || items.length > 200) return undefined;
  const projected = items.map(artwork);
  return projected.every(Boolean) ? { selection: selected, items: projected } : undefined;
}
export function projectHistoryResult(input, restore) {
  const data = snapshot(input);
  const result = restore ? selection(data.result?.selection) :
    hash(data.result?.left?.artifact?.content_hash) && hash(data.result?.right?.artifact?.content_hash) ?
      { left: data.result.left.artifact.content_hash, right: data.result.right.artifact.content_hash } : undefined;
  return { ok: data.ok === true && Boolean(result), error: { code: typeof data.error?.code === 'string' ? data.error.code : undefined }, result };
}
