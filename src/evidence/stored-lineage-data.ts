import { Value } from '@sinclair/typebox/value';
import type { TrustedScope } from '../shared/contracts.js';
import {
  IntakeLineageResultSchema, SnapshotInputLineageResultSchema,
  type IntakeLineageRequest, type IntakeLineageResult,
  type SnapshotInputLineageRequest, type SnapshotInputLineageResult,
} from './stored-lineage-types.js';

// Internal SQL projection. Neither this session nor arbitrary queries are exported
// by the public evidence barrel/factory.
export type LineageRow = Record<string, string | number | boolean | null>;
export type LineageReadSession = {
  query(sql: string, parameters?: readonly unknown[]): Promise<LineageRow[]>;
  privacy(): Promise<void>;
  partition: readonly string[];
};
const MAX_OBSERVATIONS = 50;
const hash = (value: unknown): value is string => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:=+-]{0,255}$/.test(value);
function samePartition(row: LineageRow, scope: TrustedScope): boolean {
  return row.tenant_id === scope.tenantId && row.project_id === scope.projectId
    && row.environment === scope.environment && row.billing_mode === scope.billingMode;
}
function postingReference(row: LineageRow, prefix: string): { eventId: string; eventHash: string } | null {
  const pointer = row[`${prefix}_pointer`];
  const eventId = row[`${prefix}_event_id`];
  const eventHash = row[`${prefix}_event_hash`];
  if (pointer === null) {
    if (eventId !== null || eventHash !== null) throw new Error();
    return null;
  }
  // Existing FK binds global event_id only. A pointer whose scoped join fails
  // is inconsistent lineage, not an ordinary unposted observation.
  if (!id(pointer) || eventId !== pointer || !hash(eventHash)) throw new Error();
  return { eventId: pointer, eventHash };
}

const INTAKE_COLUMNS = `i.tenant_id,i.project_id,i.environment,i.billing_mode,
  i.source_observation_id,i.event_id AS input_event_id,i.logical_operation_id,i.provider_attempt_id,
  i.billable_attempt_id,i.transport_attempt_id,i.provider_request_id,i.source_name,i.completeness,i.valuation_basis,
  i.attempt_revision_accepted,i.payload_sha256,i.idempotency_sha256,i.provenance_sha256,
  o.source_observation_id AS outbox_observation_id,o.billable_attempt_id AS outbox_billable_attempt_id,
  o.status AS outbox_status,o.ledger_event_id AS outbox_pointer,
  direct.event_id AS outbox_event_id,direct.event_hash AS outbox_event_hash,
  direct.source_content_hash AS outbox_source_content_hash,
  direct.logical_operation_id AS outbox_logical_operation_id,direct.source_observation_id AS outbox_source_observation_id,
  direct.billable_attempt_status AS outbox_billable_status,direct.billable_attempt_id AS outbox_billable_id,
  direct.provider_attempt_status AS outbox_provider_status,direct.provider_attempt_id AS outbox_provider_id,
  a.billable_attempt_id AS attempt_billable_id,a.logical_operation_id AS attempt_logical_id,a.provider_attempt_id AS attempt_provider_id,
  a.first_observation_id,a.current_observation_id,a.revision_sequence,a.status AS attempt_status,
  a.completeness AS attempt_completeness,a.valuation_basis AS attempt_valuation_basis,a.current_ledger_event_id AS current_pointer,
  head.event_id AS current_event_id,head.event_hash AS current_event_hash,
  head.source_observation_id AS current_source_observation_id,head.source_content_hash AS current_source_content_hash,
  head_input.source_observation_id AS head_observation_id,head_input.payload_sha256 AS head_payload_sha256,
  head_input.billable_attempt_id AS head_billable_id,head_input.logical_operation_id AS head_logical_id,head_input.provider_attempt_id AS head_provider_id,
  head.logical_operation_id AS current_logical_operation_id,head.billable_attempt_status AS current_billable_status,head.billable_attempt_id AS current_billable_id,
  head.provider_attempt_status AS current_provider_status,head.provider_attempt_id AS current_provider_id,
  first.billable_attempt_id AS first_billable_id,first.logical_operation_id AS first_logical_id,first.provider_attempt_id AS first_provider_id,
  latest.billable_attempt_id AS latest_billable_id,latest.logical_operation_id AS latest_logical_id,latest.provider_attempt_id AS latest_provider_id`;
const INTAKE_FROM = `FROM cost_intelligence.usage_intake_inbox i
  LEFT JOIN cost_intelligence.usage_intake_outbox o ON o.tenant_id=i.tenant_id AND o.project_id=i.project_id AND o.environment=i.environment AND o.billing_mode=i.billing_mode AND o.source_observation_id=i.source_observation_id
  LEFT JOIN cost_intelligence.usage_intake_attempts a ON a.tenant_id=i.tenant_id AND a.project_id=i.project_id AND a.environment=i.environment AND a.billing_mode=i.billing_mode AND a.billable_attempt_id=i.billable_attempt_id
  LEFT JOIN cost_intelligence.usage_intake_inbox first ON first.tenant_id=i.tenant_id AND first.project_id=i.project_id AND first.environment=i.environment AND first.billing_mode=i.billing_mode AND first.source_observation_id=a.first_observation_id
  LEFT JOIN cost_intelligence.usage_intake_inbox latest ON latest.tenant_id=i.tenant_id AND latest.project_id=i.project_id AND latest.environment=i.environment AND latest.billing_mode=i.billing_mode AND latest.source_observation_id=a.current_observation_id
  LEFT JOIN cost_intelligence.financial_ledger_events direct ON direct.tenant_id=i.tenant_id AND direct.project_id=i.project_id AND direct.environment=i.environment AND direct.billing_mode=i.billing_mode AND direct.event_id=o.ledger_event_id
  LEFT JOIN cost_intelligence.financial_ledger_events head ON head.tenant_id=i.tenant_id AND head.project_id=i.project_id AND head.environment=i.environment AND head.billing_mode=i.billing_mode AND head.event_id=a.current_ledger_event_id
  LEFT JOIN cost_intelligence.usage_intake_inbox head_input ON head_input.tenant_id=i.tenant_id AND head_input.project_id=i.project_id AND head_input.environment=i.environment AND head_input.billing_mode=i.billing_mode AND head_input.source_observation_id=head.source_observation_id
  WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.environment=$3 AND i.billing_mode=$4`;

export async function readIntake(request: IntakeLineageRequest, session: LineageReadSession): Promise<IntakeLineageResult> {
  const direct = request.selector.kind === 'posting_event';
  const selectedId = request.selector.kind === 'posting_event' ? request.selector.eventId : request.selector.sourceObservationId;
  await session.privacy();
  const rows = await session.query(`SELECT ${INTAKE_COLUMNS} ${INTAKE_FROM}
    AND ${direct ? 'o.ledger_event_id=$5' : 'i.source_observation_id=$5'}
    ORDER BY i.source_observation_id COLLATE "C" LIMIT $6`, [...session.partition, selectedId, direct ? MAX_OBSERVATIONS + 1 : 2]);
  if ((!direct && rows.length > 1) || new Set(rows.map(row => row.source_observation_id)).size !== rows.length) throw new Error();
  const observations = rows.slice(0, MAX_OBSERVATIONS).map(row => {
    if (!samePartition(row, request.scope) || (direct ? row.outbox_pointer !== selectedId : row.source_observation_id !== selectedId)
      || row.outbox_observation_id !== row.source_observation_id || row.outbox_billable_attempt_id !== row.billable_attempt_id
      || row.attempt_billable_id !== row.billable_attempt_id || row.attempt_logical_id !== row.logical_operation_id
      || row.attempt_provider_id !== row.provider_attempt_id
      || row.first_billable_id !== row.billable_attempt_id || row.first_logical_id !== row.logical_operation_id || row.first_provider_id !== row.provider_attempt_id
      || row.latest_billable_id !== row.billable_attempt_id || row.latest_logical_id !== row.logical_operation_id || row.latest_provider_id !== row.provider_attempt_id) throw new Error();
    const outbox = postingReference(row, 'outbox');
    const current = postingReference(row, 'current');
    if (row.outbox_status === 'posted' && outbox === null) throw new Error();
    if (row.attempt_status === 'posted' && current === null) throw new Error();
    if (outbox && (row.outbox_logical_operation_id !== row.logical_operation_id || row.outbox_source_observation_id !== row.source_observation_id
      || row.outbox_source_content_hash !== row.payload_sha256
      || row.outbox_billable_status !== 'known' || row.outbox_billable_id !== row.billable_attempt_id
      || row.outbox_provider_status !== 'known' || row.outbox_provider_id !== row.provider_attempt_id)) throw new Error();
    if (current && (row.current_logical_operation_id !== row.logical_operation_id
      || row.current_billable_status !== 'known' || row.current_billable_id !== row.billable_attempt_id
      || row.current_provider_status !== 'known' || row.current_provider_id !== row.provider_attempt_id
      || !id(row.current_source_observation_id) || row.head_observation_id !== row.current_source_observation_id
      || row.head_payload_sha256 !== row.current_source_content_hash || !hash(row.head_payload_sha256)
      || row.head_billable_id !== row.billable_attempt_id || row.head_logical_id !== row.logical_operation_id
      || row.head_provider_id !== row.provider_attempt_id)) throw new Error();
    return {
      sourceObservationId: row.source_observation_id, inputEventId: row.input_event_id,
      logicalOperationId: row.logical_operation_id, providerAttemptId: row.provider_attempt_id,
      billableAttemptId: row.billable_attempt_id, transportAttemptId: row.transport_attempt_id, providerRequestId: row.provider_request_id,
      source: row.source_name, completeness: row.completeness, valuationBasis: row.valuation_basis,
      attemptRevisionAccepted: row.attempt_revision_accepted,
      commitments: { normalizedPayloadHash: row.payload_sha256, idempotencyHash: row.idempotency_sha256,
        provenanceReferenceHash: row.provenance_sha256, verification: 'stored_commitments_only' },
      outbox: { status: row.outbox_status, posting: outbox },
      currentAttempt: { firstObservationId: row.first_observation_id, currentObservationId: row.current_observation_id,
        revisionSequence: row.revision_sequence, status: row.attempt_status, completeness: row.attempt_completeness,
        valuationBasis: row.attempt_valuation_basis, posting: current },
    };
  });
  const result = { schemaVersion: '1.0.0', requestId: request.requestId, scope: request.scope, selector: request.selector,
    status: observations.length ? 'found' : 'not_found', observations, truncated: rows.length > MAX_OBSERVATIONS,
    verification: 'stored_reference_match', billingAuthority: false,
    gaps: ['no_match_is_not_proof_of_zero_usage', 'original_source_bytes_not_verified', 'current_attempt_is_not_observation_finality',
      ...(rows.length > MAX_OBSERVATIONS ? ['result_limit_reached'] : [])] };
  if (!Value.Check(IntakeLineageResultSchema, result)) throw new Error();
  return result as IntakeLineageResult;
}

// Read recognized scalar metadata only. Full mixed financial snapshot content
// stays in PostgreSQL; its stored identity/hash is not a new canonical-rehash proof.
const SNAPSHOT_METADATA = `SELECT s.tenant_id,s.project_id,s.environment,s.billing_mode,s.snapshot_id,s.query_content_hash,
  s.snapshot_content->>'encoding' AS encoding,s.snapshot_content->>'asOf' AS captured_at,
  s.snapshot_content->'watermark'->>'watermarkId' AS watermark_id,
  CASE WHEN jsonb_typeof(s.snapshot_content->'inputEvidence'->'ledger')='array' THEN jsonb_array_length(s.snapshot_content->'inputEvidence'->'ledger') ELSE NULL END AS input_count,
  (jsonb_typeof(s.snapshot_content->'encoding')='string'
    AND s.snapshot_content->>'encoding' IN ('1.0.0','2.0.0')
    AND s.snapshot_content->'normalizedQuery'->>'encoding'=s.snapshot_content->>'encoding'
    AND s.snapshot_content->'normalizedQuery'->>'schemaVersion'='2.0.0'
    AND s.snapshot_content->'normalizedQuery'->>'policyVersion'='ci08-reporting-policy-2.0.0'
    AND s.snapshot_content->'scope'=jsonb_build_object('tenantId',$1::text,'projectId',$2::text,'environment',$3::text,'billingMode',$4::text,'actorId',$6::text)
    AND s.snapshot_content->'normalizedQuery'->'scope'=s.snapshot_content->'scope'
    AND s.query_content_hash=s.snapshot_content->>'queryContentHash'
    AND jsonb_typeof(s.snapshot_content->'queryContentHash')='string'
    AND jsonb_typeof(s.snapshot_content->'asOf')='string'
    AND s.as_of=(s.snapshot_content->>'asOf')::timestamptz
    AND s.snapshot_content->'normalizedQuery'->>'asOf'=s.snapshot_content->>'asOf'
    AND jsonb_typeof(s.snapshot_content->'watermark'->'watermarkId')='string'
    AND jsonb_typeof(s.snapshot_content->'inputEvidence')='object'
    AND jsonb_typeof(s.snapshot_content->'inputEvidence'->'ledger')='array') AS metadata_valid
  FROM cost_intelligence.reporting_snapshots s
  WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.environment=$3 AND s.billing_mode=$4 AND s.snapshot_id=$5 LIMIT 2`;
const SNAPSHOT_INPUTS = `SELECT count(*)::integer AS input_count,
  count(DISTINCT r.item->>'eventId')::integer AS distinct_ids,
  COALESCE(bool_and(COALESCE(jsonb_typeof(r.item)='object'
    AND (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(r.item)='object' THEN r.item ELSE '{}'::jsonb END))=2
    AND jsonb_typeof(r.item->'eventId')='string' AND (r.item->>'eventId') ~ '^[A-Za-z0-9][A-Za-z0-9._:=+-]{0,255}$'
    AND jsonb_typeof(r.item->'eventHash')='string' AND (r.item->>'eventHash') ~ '^sha256:[a-f0-9]{64}$',false)),true) AS inputs_valid,
  count(*) FILTER (WHERE r.item->>'eventId'=$6)::integer AS selected_count,
  max(r.item->>'eventHash') FILTER (WHERE r.item->>'eventId'=$6) AS selected_hash
  FROM cost_intelligence.reporting_snapshots s
  CROSS JOIN LATERAL jsonb_array_elements(s.snapshot_content->'inputEvidence'->'ledger') r(item)
  WHERE s.tenant_id=$1 AND s.project_id=$2 AND s.environment=$3 AND s.billing_mode=$4 AND s.snapshot_id=$5`;

export async function readSnapshotInput(request: SnapshotInputLineageRequest, session: LineageReadSession): Promise<SnapshotInputLineageResult> {
  const result: SnapshotInputLineageResult = {
    schemaVersion: '1.0.0', requestId: request.requestId, scope: request.scope,
    snapshotId: request.snapshotId, postingEventId: request.postingEventId, status: 'snapshot_not_found',
    snapshot: null, posting: null, matchedInput: null,
    verification: 'stored_reference_match', wholeSnapshotHashVerified: false, inputMeaning: 'recorded_input_only', billingAuthority: false,
    gaps: ['whole_snapshot_content_not_rehashed', 'input_inclusion_is_not_period_total_contribution',
      'export_discovery_not_integrated', 'no_match_is_not_proof_of_zero_usage'],
  };
  await session.privacy();
  const headers = await session.query(SNAPSHOT_METADATA, [...session.partition, request.snapshotId, request.scope.actorId]);
  if (!headers.length) return result;
  const header = headers[0]!;
  if (headers.length !== 1 || !samePartition(header, request.scope) || header.snapshot_id !== request.snapshotId || header.metadata_valid !== true
    || !hash(header.query_content_hash) || !hash(header.watermark_id) || !Number.isSafeInteger(header.input_count)
    || (header.input_count as number) < 0 || (header.input_count as number) > 50_000) throw new Error();
  result.snapshot = { snapshotId: request.snapshotId, encoding: header.encoding as '1.0.0' | '2.0.0',
    queryContentHash: header.query_content_hash, watermarkId: header.watermark_id, capturedAt: header.captured_at as string,
    ledgerInputCount: header.input_count as number };
  await session.privacy();
  const rows = await session.query(SNAPSHOT_INPUTS, [...session.partition, request.snapshotId, request.postingEventId]);
  const inputs = rows[0];
  if (rows.length !== 1 || !inputs || inputs.inputs_valid !== true || inputs.input_count !== header.input_count
    || inputs.distinct_ids !== inputs.input_count || !Number.isSafeInteger(inputs.selected_count)
    || (inputs.selected_count !== 0 && inputs.selected_count !== 1)
    || (inputs.selected_count === 0 ? inputs.selected_hash !== null : !hash(inputs.selected_hash))) throw new Error();
  const ledger = await session.query('SELECT tenant_id,project_id,environment,billing_mode,event_id,event_hash FROM cost_intelligence.financial_ledger_events WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND event_id=$5 LIMIT 2', [...session.partition, request.postingEventId]);
  if (ledger.length > 1) throw new Error();
  const actual = ledger[0];
  if (!actual) {
    // A recorded input that no longer resolves in its original partition is a
    // broken stored relation, not an ordinary absent posting.
    if (inputs.selected_count !== 0) throw new Error();
    result.status = 'posting_not_found';
  } else {
    if (!samePartition(actual, request.scope) || actual.event_id !== request.postingEventId || !hash(actual.event_hash)) throw new Error();
    result.posting = { eventId: request.postingEventId, eventHash: actual.event_hash };
    if (inputs.selected_count === 1) {
      if (inputs.selected_hash !== actual.event_hash) throw new Error();
      result.status = 'recorded_input';
      result.matchedInput = { ...result.posting };
    } else result.status = 'not_recorded_input';
  }
  if (!Value.Check(SnapshotInputLineageResultSchema, result)) throw new Error();
  return result;
}
