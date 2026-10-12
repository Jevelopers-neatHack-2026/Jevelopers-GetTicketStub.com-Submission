import type { CreativeCompositionControlProjection, CompositionControlDraft } from './composition-projection.mjs';
import type { CompositionPreviewDescriptor, CompositionCurrentView, CompositionCompletion, CompositionHistoryView, CompositionDraftReview } from './composition-integration.mjs';
export function assertCompositionDraftReview(value: unknown, projection: CreativeCompositionControlProjection, draft: CompositionControlDraft): CompositionDraftReview;
export function assertCompositionPreview(value: unknown): CompositionPreviewDescriptor;
export function assertCompositionProjection(value: unknown): CreativeCompositionControlProjection;
export function assertCompositionCurrent(value: unknown): CompositionCurrentView;
export function assertCompositionCompletion(value: unknown, action_id: string): CompositionCompletion;
export function verifyCompositionProjectionHash(projection: CreativeCompositionControlProjection, subtle: { digest(algorithm: string, input: Uint8Array): Promise<ArrayBuffer> }): Promise<boolean>;

export function assertCompositionHistoryIdentity(value: unknown): import('creative-engine/api/v1').CreativeCompositionHistoryResult;
export function assertCompositionHistory(value: unknown): CompositionHistoryView;
