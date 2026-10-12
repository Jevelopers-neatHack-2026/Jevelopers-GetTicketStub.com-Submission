import type { CreativeCompositionRevision, CreativeCompositionLayout, CreativeCompositionTextSize, CreativeCompositionSha256 } from 'creative-engine/contracts/composition-authority';
import type { CompositionEditPlan } from 'creative-engine/contracts/approval-handoff';
export const COMPOSITION_CONTROL_VERSION: 'creative-composition-controls/1.0';
export const COMPOSITION_APPLY_VERSION: 'creative-composition-apply/1.0';
export class CompositionControlsError extends TypeError { constructor(code: string, field: string); readonly code: string; readonly field: string }
export interface CompositionPrincipal { readonly actor_id: string; readonly tenant_id: string; readonly project_id: string }
export type CompositionCategoryField = 'name_size' | 'layout' | 'logo_position' | 'layout_emphasis';
export interface CompositionSizeBounds { readonly min_value: string; readonly max_value: string; readonly units: readonly ('pt' | 'px')[] }
export interface CompositionCategories { name_size: 'small' | 'medium' | 'large'; layout: 'centered' | 'stacked'; logo_position: 'top' | 'bottom'; layout_emphasis: 'balanced' | 'name' }
export interface CreativeCompositionControlPolicy {
  readonly contract: 'CreativeCompositionControlPolicy'; readonly schema_version: '1.0'; readonly policy_id: string; readonly policy_version: string;
  readonly targets: Readonly<{ name_layer_id: string; layout_layer_id: string; logo_layer_id: string; logo_asset_id: string }>;
  readonly name_sizes: Readonly<Record<CompositionCategories['name_size'], NonNullable<CreativeCompositionTextSize>>>;
  readonly layouts: Readonly<Record<'centered' | 'stacked_balanced' | 'stacked_name', NonNullable<CreativeCompositionLayout>>>;
  readonly logos: Readonly<Record<CompositionCategories['logo_position'], NonNullable<CreativeCompositionLayout>>>;
  readonly locked_fields: readonly CompositionCategoryField[]; readonly text_limit: number; readonly allow_text: boolean; readonly size_bounds: CompositionSizeBounds; readonly checked_at: number; readonly expires_at: number;
}
export interface CompositionProjectionBase {
  readonly tenant_id: string; readonly project_id: string; readonly brief_id: string; readonly composition_id: string; readonly revision_id: string;
  readonly revision_sha256: CreativeCompositionSha256; readonly state_sha256: CreativeCompositionSha256; readonly design_version_id: string;
  readonly design_version_sha256: CreativeCompositionSha256; readonly artwork_sha256: CreativeCompositionSha256; readonly selection_revision: number;
  readonly edit_policy_sha256: CreativeCompositionSha256; readonly control_policy_sha256: CreativeCompositionSha256; readonly preview_sha256: CreativeCompositionSha256;
}
export type CompositionCategory = { [F in CompositionCategoryField]: Readonly<{ field: F; current_value: CompositionCategories[F] | null; options: readonly CompositionCategories[F][]; locked: boolean }> &
  (F extends 'layout_emphasis' ? Readonly<{ when: { readonly field: 'layout'; readonly value: 'stacked' }; required: true }> : {}) }[CompositionCategoryField];
export interface CompositionExactControls {
  readonly text: Readonly<{ layer_id: string; value: string; max_length: number; locked: boolean }>;
  readonly text_size: Readonly<{ layer_id: string; value: CreativeCompositionTextSize; locked: boolean; bounds: CompositionSizeBounds }>;
  readonly layout: Readonly<{ layer_id: string; value: CreativeCompositionLayout; locked: boolean }>;
  readonly logo: Readonly<{ layer_id: string; asset_id: string; value: CreativeCompositionLayout; locked: boolean }>;
}
export interface CreativeCompositionControlProjection {
  readonly contract: 'CreativeCompositionControlProjection'; readonly schema_version: typeof COMPOSITION_CONTROL_VERSION; readonly base: CompositionProjectionBase;
  readonly categories: readonly CompositionCategory[]; readonly exact_controls: CompositionExactControls; readonly expires_at: number;
  readonly approval: false; readonly purchase: false; readonly projection_sha256: CreativeCompositionSha256;
}
export interface CompositionControlDraft {
  readonly categories: Readonly<Partial<CompositionCategories>>;
  readonly exact: Readonly<Partial<{ text: string; text_size: NonNullable<CreativeCompositionTextSize>; layout: NonNullable<CreativeCompositionLayout>; logo: NonNullable<CreativeCompositionLayout> }>>;
}
export interface CompositionControlApply {
  readonly action_version: typeof COMPOSITION_APPLY_VERSION; readonly action_id: string; readonly projection_sha256: CreativeCompositionSha256; readonly intent: 'apply'; readonly draft: CompositionControlDraft;
}
export function validateCompositionControlPolicy(input: unknown): CreativeCompositionControlPolicy;
export function createCompositionControlProjection(input: Readonly<{ revision: CreativeCompositionRevision; preview_bytes: Uint8Array; policy: CreativeCompositionControlPolicy; principal: CompositionPrincipal; selection_revision: number; can_apply: boolean; now_ms: number }>): CreativeCompositionControlProjection;
export function createCompositionControlPlan(input: Readonly<{ revision: CreativeCompositionRevision; policy: CreativeCompositionControlPolicy; projection: CreativeCompositionControlProjection; action: CompositionControlApply }>): CompositionEditPlan;
