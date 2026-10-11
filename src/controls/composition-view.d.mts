import type { CreativeCompositionControlProjection } from './composition-projection.mjs';
import type { CompositionPreviewDescriptor, CompositionCurrentView, CompositionCompletion } from './composition-integration.mjs';
export function assertCompositionPreview(value: unknown): CompositionPreviewDescriptor;
export function assertCompositionProjection(value: unknown): CreativeCompositionControlProjection;
export function assertCompositionCurrent(value: unknown): CompositionCurrentView;
export function assertCompositionCompletion(value: unknown, action_id: string): CompositionCompletion;
export function verifyCompositionProjectionHash(projection: CreativeCompositionControlProjection, subtle: { digest(algorithm: string, input: Uint8Array): Promise<ArrayBuffer> }): Promise<boolean>;
