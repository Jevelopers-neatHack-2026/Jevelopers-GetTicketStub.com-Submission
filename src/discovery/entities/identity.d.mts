export type EntityKind = 'organization' | 'performer' | 'venue' | 'person' | 'event_series';
export type IdentityOrigin = 'sourced' | 'customer_supplied';

export type EvidenceLocator =
  | { readonly kind: 'text-range'; readonly startByte: number; readonly endByte: number }
  | { readonly kind: 'json-pointer'; readonly pointer: string };

/** Stable references projected from already validated evidence metadata and positions. */
export interface IdentityEvidenceReference {
  readonly evidenceId: string;
  readonly contentHash: string;
  readonly locator: EvidenceLocator;
  /** The original evidence fact field; retained exactly. */
  readonly field: string;
  /** The exact source-backed fact value; it is not replaced by a model label. */
  readonly value: string;
}

export interface SupportedEntityClaim {
  readonly value: string;
  readonly origin: IdentityOrigin;
  readonly supports: readonly IdentityEvidenceReference[];
}

export interface EntityObservation {
  readonly schema: 'ei-entity-observation-internal/v1';
  readonly candidateId: string;
  readonly kind: EntityKind;
  readonly names?: readonly SupportedEntityClaim[];
  readonly identifiers?: readonly (SupportedEntityClaim & { readonly namespace: string })[];
}

export type EntityIdentityRelation =
  | 'same_entity_candidate'
  | 'different_entity_candidate'
  | 'review'
  | 'unknown';

export interface EntityIdentityDecision {
  readonly schema: 'ei-entity-identity-decision-internal/v1';
  readonly candidateIds: readonly [string, string];
  readonly relation: EntityIdentityRelation;
  readonly reasonCodes: readonly string[];
  /** Source authority is deliberately not determined by identity comparison. */
  readonly sourceAuthority: 'not_evaluated';
  /** Equal bytes at different evidence IDs are exposed as duplicates, not corroboration. */
  readonly duplicateContentHashes: readonly string[];
  readonly provenanceReferences: readonly IdentityEvidenceReference[];
  readonly candidates: readonly [Readonly<EntityObservation>, Readonly<EntityObservation>];
}

export declare class EntityIdentityError extends Error {
  readonly code: 'IDENTITY_INVALID_INPUT';
  constructor(code?: 'IDENTITY_INVALID_INPUT');
}

/**
 * Compare entity candidates without mutating or persisting either one. A
 * same-entity candidate requires a shared exact identifier claim and source
 * position. Names, URLs, and branding cannot produce that relation.
 */
export declare function compareEntityIdentity(
  left: EntityObservation,
  right: EntityObservation,
): EntityIdentityDecision;
