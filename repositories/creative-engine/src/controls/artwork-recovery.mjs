/** Closed presentation of a scoped durable artwork action. It grants no edit,
 * approval or purchase authority and never treats an absent row as rejection. */
import { snapshotControlJson, validId, isRecord } from './schema.mjs';
import { projectApplyResult } from './public-result.mjs';

export const ARTWORK_RECOVERY_VERSION = '1.0';
export const ARTWORK_NON_ADMISSION_CODES = Object.freeze(['validation', 'unsupported_version', 'unknown_field', 'invalid_intent', 'permission',
  'draft_mismatch', 'stale_version', 'stale_schema', 'action_conflict', 'unknown_control', 'invalid_value', 'locked', 'asset_permission',
  'unknown_question', 'follow_up_required', 'no_changes', 'conflict']);
const exact = (x, keys) => isRecord(x) && Object.keys(x).sort().join(',') === [...keys].sort().join(',');
const fail = () => { throw new TypeError('Artwork recovery unavailable'); };

export function assertArtworkRecovery(input, expected) {
  const x = snapshotControlJson(input), scope = snapshotControlJson(expected);
  if (!exact(scope, ['tenant_id', 'project_id', 'action_id']) || !Object.values(scope).every(validId) ||
      !isRecord(x) || !['tenant_id', 'project_id', 'action_id'].every(k => x[k] === scope[k]) ||
      x.contract !== 'CreativeArtworkActionRecovery' || x.schema_version !== ARTWORK_RECOVERY_VERSION || x.approval !== false || x.purchase !== false) fail();
  const common = ['contract', 'schema_version', 'tenant_id', 'project_id', 'action_id', 'ok', 'code', 'status', 'recovery', 'approval', 'purchase'];
  if (x.recovery === 'not_admitted') {
    if (!exact(x, common) || x.ok !== false || x.status !== 'rejected' || !ARTWORK_NON_ADMISSION_CODES.includes(x.code)) fail();
  } else if (x.recovery === 'terminal') {
    if (!['completed', 'failed', 'cancelled'].includes(x.status) || !validId(x.operation_id) || !validId(x.backend_job_id)) fail();
    if (x.status === 'completed') {
      if (!exact(x, [...common, 'operation_id', 'backend_job_id', 'result']) || x.ok !== true || x.code !== 'completed' ||
          !exact(x.result, ['design_version']) || !exact(x.result.design_version, ['design_version_id', 'artifact']) ||
          !exact(x.result.design_version.artifact, ['content_hash']) || !projectApplyResult(x).result) fail();
    } else if (!exact(x, [...common, 'operation_id', 'backend_job_id']) || x.ok !== false || x.code !== x.status || projectApplyResult(x).status !== x.status) fail();
  } else if (x.recovery === 'unknown') {
    const references = ['operation_id', 'backend_job_id'].filter(k => Object.hasOwn(x, k));
    if (!exact(x, [...common, ...references]) || x.ok !== false || x.code !== 'unavailable' || x.status !== 'unknown' ||
        !references.every(k => validId(x[k])) || x.backend_job_id && !x.operation_id) fail();
  } else fail();
  return x;
}
