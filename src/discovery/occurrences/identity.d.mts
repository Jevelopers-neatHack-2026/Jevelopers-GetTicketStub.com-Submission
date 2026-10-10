export type OccurrenceOrigin = 'sourced' | 'customer_supplied';
export type OccurrencePrecision = 'date' | 'local_datetime' | 'instant' | 'unknown';

export type OccurrenceEvidenceLocator =
  | { readonly kind: 'text-range'; readonly startByte: number; readonly endByte: number }
  | { readonly kind: 'json-pointer'; readonly pointer: string };

export interface OccurrenceEvidenceReference {
  readonly evidenceId: string;
  readonly contentHash: string;
  readonly locator: OccurrenceEvidenceLocator;
  /** The original evidence fact field; retained exactly. */
  readonly field: string;
  /** The exact source-backed fact value; it is not replaced by a model label. */
  readonly value: string;
}

export interface SupportedOccurrenceClaim {
  readonly value: string;
  readonly origin: OccurrenceOrigin;
  readonly supports: readonly OccurrenceEvidenceReference[];
}

export interface SupportedTemporalClaim extends SupportedOccurrenceClaim {
  readonly precision: OccurrencePrecision;
}

export interface OccurrenceFacts {
  readonly title?: readonly SupportedOccurrenceClaim[];
  readonly series?: readonly SupportedOccurrenceClaim[];
  readonly edition?: readonly SupportedOccurrenceClaim[];
  readonly city?: readonly SupportedOccurrenceClaim[];
  readonly venue?: readonly SupportedOccurrenceClaim[];
  readonly start?: readonly SupportedTemporalClaim[];
  readonly end?: readonly SupportedTemporalClaim[];
  readonly status?: readonly (SupportedOccurrenceClaim & {
    readonly value: 'scheduled' | 'canceled' | 'postponed' | 'rescheduled';
  })[];
}

export interface OccurrenceObservation {
  readonly schema: 'ei-occurrence-observation-internal/v1';
  readonly candidateId: string;
  readonly facts: OccurrenceFacts;
}

export type OccurrenceIdentityRelation =
  | 'same_occurrence_candidate'
  | 'different_occurrence_candidate'
  | 'review'
  | 'unknown';

export type OccurrenceTransitionKind = 'canceled' | 'rescheduled';

export interface OccurrenceTransitionInput {
  readonly predecessorId: string;
  readonly successorId: string | null;
  readonly transition: OccurrenceTransitionKind;
  /** Must point to source-backed status facts matching the transition. */
  readonly supports: readonly OccurrenceEvidenceReference[];
}

export interface OccurrenceTransition extends OccurrenceTransitionInput {
  readonly schema: 'ei-occurrence-transition-internal/v1';
  /** Deterministic content hash, not an authenticated issuer signature. */
  readonly id: string;
}

export interface OccurrenceIdentityDecision {
  readonly schema: 'ei-occurrence-identity-decision-internal/v1';
  readonly candidateIds: readonly [string, string];
  readonly relation: OccurrenceIdentityRelation;
  readonly reasonCodes: readonly string[];
  readonly conflictFields: readonly string[];
  /** Source authority is deliberately not determined by identity comparison. */
  readonly sourceAuthority: 'not_evaluated';
  /** Equal bytes at different evidence IDs are exposed as duplicates, not corroboration. */
  readonly duplicateContentHashes: readonly string[];
  readonly provenanceReferences: readonly OccurrenceEvidenceReference[];
  readonly candidates: readonly [Readonly<OccurrenceObservation>, Readonly<OccurrenceObservation>];
  readonly transitionLinks: readonly OccurrenceTransition[];
}

export declare class OccurrenceIdentityError extends Error {
  readonly code: 'IDENTITY_INVALID_INPUT';
  constructor(code?: 'IDENTITY_INVALID_INPUT');
}

/** Create an immutable, source-backed cancellation or reschedule record. */
export declare function createOccurrenceTransition(input: OccurrenceTransitionInput): OccurrenceTransition;

/**
 * Compare two occurrence candidates without merging or altering either one.
 * Date precision and time-zone representation remain exactly as supplied.
 */
export declare function compareOccurrenceIdentity(
  left: OccurrenceObservation,
  right: OccurrenceObservation,
  options?: { readonly transitions?: readonly OccurrenceTransition[] },
): OccurrenceIdentityDecision;
