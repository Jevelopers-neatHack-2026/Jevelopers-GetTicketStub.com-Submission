import type { CreativeRuntimePorts } from 'creative-engine/api/v1';
import type { CreativeCompositionSha256 } from 'creative-engine/contracts/composition-authority';
import type { CurrentCreativeControlContext } from './index.mjs';
import type { CompositionPrincipal, CompositionControlApply, CreativeCompositionControlPolicy, CreativeCompositionControlProjection } from './composition-projection.mjs';
export interface CompositionPreviewDescriptor {
  readonly revision_id: string; readonly revision_sha256: CreativeCompositionSha256; readonly state_sha256: CreativeCompositionSha256; readonly preview_id: string;
  readonly preview_sha256: CreativeCompositionSha256; readonly byte_length: number; readonly mime_type: 'image/png' | 'image/jpeg' | 'image/webp'; readonly width_px: number; readonly height_px: number;
}
export interface CompositionInitializationReview {
  readonly contract: 'CreativeCompositionInitializationReview'; readonly schema_version: '1.0'; readonly can_initialize: boolean; readonly approval: false; readonly purchase: false; readonly review_sha256: CreativeCompositionSha256;
  readonly base: Readonly<{ tenant_id: string; project_id: string; brief_id: string; brief_sha256: CreativeCompositionSha256; design_version_id: string; design_version_sha256: CreativeCompositionSha256; artwork_sha256: CreativeCompositionSha256; selection_revision: number }>;
}
export interface CompositionInitializeAction { readonly action_version: 'creative-composition-initialize/1.0'; readonly action_id: string; readonly review_sha256: CreativeCompositionSha256; readonly intent: 'initialize' }
export type CompositionCurrentView =
  Readonly<{ ok: true; status: 'current'; projection: CreativeCompositionControlProjection; preview: CompositionPreviewDescriptor; approval: false; purchase: false }> |
  Readonly<{ ok: true; status: 'not_initialized'; review: CompositionInitializationReview; approval: false; purchase: false }> |
  Readonly<{ ok: false; status: 'stale' | 'unavailable'; code: string; approval: false; purchase: false }>;
export type CompositionCompletion = Readonly<{ ok: true; status: 'saved'; historical: boolean; action_id: string; backend_job_id: string; request_sha256: CreativeCompositionSha256;
  revision_id: string; revision_sha256: CreativeCompositionSha256; parent_revision_id: string | null; parent_revision_sha256: CreativeCompositionSha256 | null; state_sha256: CreativeCompositionSha256;
  artwork_sha256: CreativeCompositionSha256; preview: CompositionPreviewDescriptor; approval: false; purchase: false }> |
  Readonly<{ ok: false; status: 'failed' | 'stale' | 'unknown'; code: string; action_id?: string; backend_job_id?: string | null; approval?: false; purchase?: false }>;
export interface ControlsSqliteDatabase {
  readonly isTransaction: boolean;
  exec(sql: string): void;
  prepare(sql: string): { get(...values: (string | number | null)[]): unknown; run(...values: (string | number | null)[]): unknown };
}
export class CompositionControlsAdapter {
  constructor(options: { database: ControlsSqliteDatabase; ports: CreativeRuntimePorts; readContext(principal: CompositionPrincipal): CurrentCreativeControlContext; readPolicy(principal: CompositionPrincipal, context: CurrentCreativeControlContext): CreativeCompositionControlPolicy; now?: () => number });
  current(principal: CompositionPrincipal): Promise<CompositionCurrentView>;
  apply(principal: CompositionPrincipal, action: CompositionControlApply | CompositionInitializeAction): Promise<CompositionCompletion>;
  lookup(principal: CompositionPrincipal, action_id: string): Promise<CompositionCompletion | null>;
  retry(principal: CompositionPrincipal, action_id: string): Promise<CompositionCompletion | null>;
  preview(principal: CompositionPrincipal, expected: Pick<CompositionPreviewDescriptor, 'revision_id' | 'revision_sha256' | 'preview_sha256'>): Promise<Readonly<{ bytes: Uint8Array; metadata: CompositionPreviewDescriptor }> | null>;
  cancel(principal: CompositionPrincipal, action_id: string): Promise<Readonly<{ ok: boolean; status: string; action_id?: string; backend_job_id?: string; approval: false; purchase: false }>>;
}
