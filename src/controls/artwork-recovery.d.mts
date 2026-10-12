import type { ArtworkReference } from './public-result.mjs';
export const ARTWORK_RECOVERY_VERSION: '1.0';
export type ArtworkNonAdmissionCode = 'validation' | 'unsupported_version' | 'unknown_field' | 'invalid_intent' | 'permission'
  | 'draft_mismatch' | 'stale_version' | 'stale_schema' | 'action_conflict' | 'unknown_control' | 'invalid_value' | 'locked'
  | 'asset_permission' | 'unknown_question' | 'follow_up_required' | 'no_changes' | 'conflict';
export const ARTWORK_NON_ADMISSION_CODES: readonly ArtworkNonAdmissionCode[];
export interface ArtworkRecoveryIdentity { readonly tenant_id: string; readonly project_id: string; readonly action_id: string }
interface ArtworkRecoveryBase extends ArtworkRecoveryIdentity {
  readonly contract: 'CreativeArtworkActionRecovery'; readonly schema_version: typeof ARTWORK_RECOVERY_VERSION;
  readonly approval: false; readonly purchase: false;
}
export type ArtworkRecovery = ArtworkRecoveryBase & (
  Readonly<{ ok: false; code: ArtworkNonAdmissionCode; status: 'rejected'; recovery: 'not_admitted' }> |
  (Readonly<{ ok: false; code: 'unavailable'; status: 'unknown'; recovery: 'unknown' }> &
    (Readonly<{ operation_id?: never; backend_job_id?: never }> | Readonly<{ operation_id: string; backend_job_id?: string }>)) |
  Readonly<{ ok: false; code: 'failed'; status: 'failed'; recovery: 'terminal'; operation_id: string; backend_job_id: string }> |
  Readonly<{ ok: false; code: 'cancelled'; status: 'cancelled'; recovery: 'terminal'; operation_id: string; backend_job_id: string }> |
  Readonly<{ ok: true; code: 'completed'; status: 'completed'; recovery: 'terminal'; operation_id: string; backend_job_id: string;
    result: Readonly<{ design_version: ArtworkReference }> }>);
export function assertArtworkRecovery(input: unknown, expected: ArtworkRecoveryIdentity): ArtworkRecovery;
