import type { RetrievedDocument } from "../security/index.mjs";

export type ExtractionStatus =
  | "PARTIAL"
  | "NO_ANSWER"
  | "JS_REQUIRED"
  | "ACCESS_RESTRICTED"
  | "UNSUPPORTED_MEDIA"
  | "UNSUPPORTED_ENCODING"
  | "MALFORMED_ENCODING"
  | "RESOURCE_LIMIT"
  | "CANCELED"
  | "INVALID_INPUT";

export type ExtractionTermination = "CANCELED" | "RESOURCE_LIMIT" | "PARSER_DEADLINE" | null;
export type CandidateValue = string | number | boolean | null;
export type ExtractionSourceKind = "canonical" | "open-graph" | "jsonld" | "visible-text" | "noscript-signal";

export interface ExtractionTextRange {
  readonly kind: "text-range";
  /** UTF-8 byte positions in the complete RetrievedDocument source. */
  readonly startByte: number;
  readonly endByte: number;
}

export interface ExtractionCandidateSource {
  readonly kind: ExtractionSourceKind;
  readonly locator: ExtractionTextRange;
  /** RFC 6901 path within an embedded JSON-LD block; descriptive alongside the source byte range. */
  readonly jsonPointer?: string;
  readonly property?: string;
}

export interface ExtractionCandidate {
  readonly field: string;
  /** Exact original UTF-8 source slice selected by source.locator. */
  readonly rawValue: string;
  readonly normalizedValue: CandidateValue;
  readonly source: ExtractionCandidateSource;
  readonly suggestionOnly?: boolean;
  readonly urlSuggestion?: string | null;
  readonly property?: string;
}

export interface ExtractionEntity {
  readonly entityId: string;
  readonly kind: "event" | "organization";
  readonly ordinal: number;
  readonly blockIndex: number;
  readonly jsonPointer: string;
  readonly typeNames: readonly string[];
  readonly source: Readonly<{
    kind: "jsonld";
    locator: ExtractionTextRange;
    jsonPointer: string;
  }> | null;
  readonly candidates: readonly ExtractionCandidate[];
}

export interface ExtractionSource {
  readonly url: string;
  readonly fetchedAt: string;
  readonly contentType: string;
  readonly contentHash: string | null;
}

export interface ExtractionDiagnostic {
  readonly code: string;
  readonly [detail: string]: unknown;
}

export interface ExtractionConflict {
  readonly scope: string;
  readonly field: string;
  readonly candidates: readonly ExtractionCandidate[];
}

export interface ExtractionAmbiguity {
  readonly kind: "multiple_event_occurrences" | "page_metadata_not_assigned_to_event";
  readonly entityIds?: readonly string[];
  readonly candidateCount?: number;
  readonly resolution?: "kept_separate";
}

export interface JsonLdBlock {
  readonly blockIndex: number;
  readonly status: "parsed" | "duplicate_parsed" | "malformed" | "resource_limited";
  readonly locator: ExtractionTextRange;
  readonly eventCount?: number;
  readonly organizationCount?: number;
  readonly duplicateOfBlockIndex?: number;
}

export interface ExtractionLimits {
  readonly maxDocumentBytes: number;
  readonly maxHtmlNodes: number;
  readonly maxHtmlParseErrors: number;
  readonly htmlChunkCodeUnits: number;
  readonly parseTimeoutMs: number;
  readonly traversalYieldEvery: number;
  readonly maxVisibleTextSegments: number;
  readonly maxVisibleTextBytes: number;
  readonly maxStatusSignalCandidates: number;
  readonly maxPageMetadataCandidates: number;
  readonly maxCanonicalSuggestions: number;
  readonly maxNoscriptNodes: number;
  readonly maxNoscriptSignals: number;
  readonly jsRequiredVisibleCharacterLimit: number;
  readonly maxJsonLdBlocks: number;
  readonly maxJsonLdBytes: number;
  readonly maxJsonDepth: number;
  readonly maxJsonNodes: number;
  readonly maxEntities: number;
  readonly maxCandidatesPerEntity: number;
  readonly maxDiagnostics: number;
}

export interface ExtractionOptions {
  readonly signal?: AbortSignal;
  /** Callers can lower default limits; values above the checked-in ceilings are capped. */
  readonly limits?: Partial<ExtractionLimits>;
}

export interface ExtractionResult {
  readonly extractorVersion: string;
  readonly parserVersions: Readonly<{ html: string; htmlStream: string; json: string }>;
  readonly status: ExtractionStatus;
  readonly termination: ExtractionTermination;
  readonly source: ExtractionSource | null;
  readonly sourceHash: string | null;
  readonly canonicalSuggestions: readonly (ExtractionCandidate & { readonly urlSuggestion: string | null })[];
  readonly pageMetadata: readonly (ExtractionCandidate & { readonly property: string })[];
  readonly events: readonly ExtractionEntity[];
  readonly organizations: readonly ExtractionEntity[];
  readonly visibleText: readonly ExtractionCandidate[];
  readonly statusMentions: readonly ExtractionCandidate[];
  readonly accessSignals: readonly ExtractionCandidate[];
  readonly conflicts: readonly ExtractionConflict[];
  readonly ambiguities: readonly ExtractionAmbiguity[];
  readonly jsonLdBlocks: readonly JsonLdBlock[];
  readonly diagnostics: readonly ExtractionDiagnostic[];
}

export declare const DETERMINISTIC_EXTRACTION_VERSION: string;
export declare const EXTRACTION_LIMITS: Readonly<ExtractionLimits>;

/** Internal parser over a completed controlled retrieval result; this performs no retrieval or subresource access. */
export declare function extractDeterministically(
  document: RetrievedDocument,
  options?: ExtractionOptions,
): Promise<ExtractionResult>;
