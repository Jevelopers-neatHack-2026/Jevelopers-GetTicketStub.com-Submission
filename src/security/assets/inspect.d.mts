export type SafeAssetAction = 'transformed' | 'review' | 'reject';

export type SafeAssetDiagnosticCode =
  | 'CANCELLED'
  | 'CONTENT_TYPE_MISMATCH'
  | 'CONTENT_TYPE_REQUIRED'
  | 'DEADLINE_EXCEEDED'
  | 'INVALID_INPUT'
  | 'INVALID_UTF8'
  | 'LIMIT_EXCEEDED'
  | 'SVG_ACTIVE_CONTENT'
  | 'SVG_ENTITY_REFERENCE'
  | 'SVG_MALFORMED'
  | 'SVG_SANITIZED'
  | 'SVG_UNSUPPORTED_DECLARATION'
  | 'SVG_UNSUPPORTED_FEATURE'
  | 'UNSUPPORTED_CONTENT_TYPE'
  | 'UNSUPPORTED_NAMESPACE';

export interface SafeAssetDiagnostic {
  readonly code: SafeAssetDiagnosticCode;
}

export interface SafeAssetInspectionOptions {
  readonly contentType?: string;
  readonly signal?: AbortSignal;
  /** Absolute `performance.now()` deadline in milliseconds. */
  readonly deadlineAtMs?: number;
}

export interface SafeAssetInspectionResult {
  /** Internal sanitizer policy identifier; this is not a permission decision. */
  readonly policyVersion: string;
  readonly action: SafeAssetAction;
  readonly contentType: 'image/svg+xml' | null;
  readonly sourceHash: string | null;
  readonly transformedHash: string | null;
  readonly sourceSize: number | null;
  readonly transformedSize: number | null;
  readonly diagnostics: readonly SafeAssetDiagnostic[];
  /** Return a new, caller-owned byte copy on every call. */
  copyTransformedBytes(): Uint8Array | null;
  /** Check candidate bytes against the immutable transformed snapshot. */
  matchesTransformedBytes(candidate: unknown): boolean;
}

export declare const SAFE_ASSET_POLICY_VERSION: 'svg-static-geometry/1';
export declare const SAFE_ASSET_LIMITS: Readonly<{
  maxSourceBytes: 131072;
  maxTransformedBytes: 524288;
  maxElements: 1024;
  maxDepth: 32;
  maxAttributesPerElement: 24;
  maxTokenLength: 8192;
  maxNameLength: 64;
  maxAttributeValueLength: 4096;
  maxNumericTokenLength: 128;
  maxPointsValues: 256;
  maxCoordinate: 65536;
  maxDimension: 4096;
  maxViewBoxDimension: 16384;
  maxProcessingMs: 250;
}>;

export declare function inspectSafeAssetBytes(
  candidateBytes: unknown,
  options?: SafeAssetInspectionOptions,
): SafeAssetInspectionResult;
