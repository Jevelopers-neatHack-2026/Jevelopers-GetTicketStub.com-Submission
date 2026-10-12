import { assertArtworkRecovery, ARTWORK_RECOVERY_VERSION, projectApplyResult, type ArtworkRecovery, type ArtworkRecoveryIdentity, type CreativeControlsAdapter, type TrustedPrincipal } from '../../../src/controls/index.mjs';
type IsAny<T> = 0 extends (1 & T) ? true : false;
const recoveryAny: IsAny<ReturnType<typeof assertArtworkRecovery>> = false;
declare const input: unknown, principal: TrustedPrincipal, adapter: CreativeControlsAdapter;
const identity: ArtworkRecoveryIdentity = { tenant_id: 'tenant', project_id: 'project', action_id: 'style_typed' };
const result = assertArtworkRecovery(input, identity);
const typed: ArtworkRecovery | null = await adapter.applyReviewedArtwork(principal, input);
const read: ArtworkRecovery | null = await adapter.readArtworkAction(principal, identity.action_id);
const retry: ArtworkRecovery | null = await adapter.retryArtworkAction(principal, identity.action_id);
const version: typeof ARTWORK_RECOVERY_VERSION = result.schema_version;
if (result.recovery === 'terminal' && result.status === 'completed') {
  const id: string = result.result.design_version.design_version_id;
  const compatible: string | undefined = projectApplyResult(result).result?.design_version.design_version_id;
  void [id, compatible];
}
if (result.recovery === 'not_admitted') {
  const rejected: false = result.ok;
  // @ts-expect-error non-admission never presents an admitted operation
  result.operation_id;
  void rejected;
}
const base = { ...identity, contract: 'CreativeArtworkActionRecovery' as const, schema_version: ARTWORK_RECOVERY_VERSION, approval: false as const, purchase: false as const };
// @ts-expect-error a raw backend failure cannot imply negative admission
const invented: ArtworkRecovery = { ...base, ok: false, recovery: 'not_admitted', status: 'rejected', code: 'backend_failed' };
// @ts-expect-error failed and cancelled statuses cannot contradict their codes
const contradiction: ArtworkRecovery = { ...base, ok: false, recovery: 'terminal', status: 'failed', code: 'cancelled', operation_id: 'op', backend_job_id: 'job' };
// @ts-expect-error unknown cannot carry an unbound backend job identity
const unbound: ArtworkRecovery = { ...base, ok: false, recovery: 'unknown', status: 'unknown', code: 'unavailable', backend_job_id: 'job' };
// @ts-expect-error recovery has no approval authority
const approval: ArtworkRecovery = { ...result, approval: true };
void [recoveryAny, typed, read, retry, version, invented, contradiction, unbound, approval];
