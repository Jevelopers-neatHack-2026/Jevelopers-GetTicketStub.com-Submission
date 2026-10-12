import { Type, type Static } from '@sinclair/typebox';
import { TrustedScopeSchema, type ApiResult } from '../shared/contracts.js';
import type { PostgresEvidenceReaderPorts } from './postgres-reader.js';

/** Finance-local metadata contract. This adds no canonical vocabulary or grant. */
export const STORED_LINEAGE_SCHEMA_VERSION = '1.0.0' as const;
const Id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:=+-]{0,255}$', maxLength: 256 });
const Hash = Type.String({ pattern: '^sha256:[a-f0-9]{64}$', maxLength: 71 });
const RequestId = Type.String({ minLength: 1, maxLength: 128 });
const object = <T extends Parameters<typeof Type.Object>[0]>(properties: T) => Type.Object(properties, { additionalProperties: false });
const nullable = <T extends Parameters<typeof Type.Union>[0][number]>(schema: T) => Type.Union([schema, Type.Null()]);
const literals = <T extends string>(values: readonly T[]) => Type.Union(values.map(value => Type.Literal(value)));
const completeness = literals(['unknown', 'incomplete', 'complete'] as const);
const valuation = literals(['unknown', 'estimated', 'provider_confirmed'] as const);
const posting = object({ eventId: Id, eventHash: Hash });
const selector = Type.Union([
  object({ kind: Type.Literal('posting_event'), eventId: Id }),
  object({ kind: Type.Literal('source_observation'), sourceObservationId: Id }),
]);

export const IntakeLineageRequestSchema = object({
  schemaVersion: Type.Literal(STORED_LINEAGE_SCHEMA_VERSION), requestId: RequestId,
  scope: TrustedScopeSchema, selector,
});
export type IntakeLineageRequest = Static<typeof IntakeLineageRequestSchema>;

const observation = object({
  sourceObservationId: Id,
  /** The incoming event identity is not proof that a ledger event was posted. */
  inputEventId: Id, logicalOperationId: Id, providerAttemptId: Id,
  billableAttemptId: Id, transportAttemptId: Id, providerRequestId: nullable(Id),
  source: literals(['provider_response', 'provider_usage_api', 'trace', 'billing_export', 'other'] as const),
  completeness, valuationBasis: valuation, attemptRevisionAccepted: Type.Boolean(),
  commitments: object({
    normalizedPayloadHash: Hash, idempotencyHash: Hash, provenanceReferenceHash: Hash,
    verification: Type.Literal('stored_commitments_only'),
  }),
  outbox: object({
    status: literals(['awaiting_evidence', 'pending', 'retry', 'posted', 'duplicate', 'suppressed', 'dead_letter'] as const),
    posting: nullable(posting),
  }),
  currentAttempt: object({
    firstObservationId: Id, currentObservationId: Id,
    revisionSequence: Type.Integer({ minimum: 0, maximum: 2147483647 }),
    status: literals(['awaiting_evidence', 'pending', 'posted', 'retry', 'dead_letter'] as const),
    completeness, valuationBasis: valuation, posting: nullable(posting),
  }),
});

export const IntakeLineageResultSchema = object({
  schemaVersion: Type.Literal(STORED_LINEAGE_SCHEMA_VERSION), requestId: RequestId,
  scope: TrustedScopeSchema, selector,
  status: literals(['found', 'not_found'] as const),
  observations: Type.Array(observation, { maxItems: 50 }),
  truncated: Type.Boolean(),
  verification: Type.Literal('stored_reference_match'),
  billingAuthority: Type.Literal(false),
  gaps: Type.Array(literals([
    'no_match_is_not_proof_of_zero_usage', 'original_source_bytes_not_verified',
    'current_attempt_is_not_observation_finality', 'result_limit_reached',
  ] as const), { uniqueItems: true, maxItems: 4 }),
});
export type IntakeLineageResult = Static<typeof IntakeLineageResultSchema>;

export const SnapshotInputLineageRequestSchema = object({
  schemaVersion: Type.Literal(STORED_LINEAGE_SCHEMA_VERSION), requestId: RequestId,
  scope: TrustedScopeSchema, snapshotId: Hash, postingEventId: Id,
});
export type SnapshotInputLineageRequest = Static<typeof SnapshotInputLineageRequestSchema>;

export const SnapshotInputLineageResultSchema = object({
  schemaVersion: Type.Literal(STORED_LINEAGE_SCHEMA_VERSION), requestId: RequestId,
  scope: TrustedScopeSchema, snapshotId: Hash, postingEventId: Id,
  status: literals(['recorded_input', 'not_recorded_input', 'snapshot_not_found', 'posting_not_found'] as const),
  snapshot: nullable(object({
    snapshotId: Hash, encoding: literals(['1.0.0', '2.0.0'] as const),
    queryContentHash: Hash, watermarkId: Hash, capturedAt: Type.String({ format: 'date-time', maxLength: 40 }),
    ledgerInputCount: Type.Integer({ minimum: 0, maximum: 50_000 }),
  })),
  posting: nullable(posting),
  matchedInput: nullable(posting),
  verification: Type.Literal('stored_reference_match'),
  wholeSnapshotHashVerified: Type.Literal(false),
  inputMeaning: Type.Literal('recorded_input_only'),
  billingAuthority: Type.Literal(false),
  gaps: Type.Array(literals([
    'whole_snapshot_content_not_rehashed', 'input_inclusion_is_not_period_total_contribution',
    'export_discovery_not_integrated', 'no_match_is_not_proof_of_zero_usage',
  ] as const), { uniqueItems: true, maxItems: 4 }),
});
export type SnapshotInputLineageResult = Static<typeof SnapshotInputLineageResultSchema>;

export type PostgresStoredLineageReaderPorts = PostgresEvidenceReaderPorts;
/** Transaction, mutation and unguarded storage capabilities are never returned. */
export interface PostgresStoredLineageReader {
  readIntakeLineage(value: unknown): Promise<ApiResult<IntakeLineageResult>>;
  readSnapshotInputLineage(value: unknown): Promise<ApiResult<SnapshotInputLineageResult>>;
}
