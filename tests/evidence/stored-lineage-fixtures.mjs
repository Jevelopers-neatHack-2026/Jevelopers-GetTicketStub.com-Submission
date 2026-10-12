// Explicitly synthetic stored metadata. Model transport is not PostgreSQL proof.
import { createPostgresStoredLineageReader } from '../../dist/index.js';
import { scope, decision, now, hash, partition } from './postgres-fixtures.mjs';
export { scope, decision, now, hash, partition };
export const intakeRequest = (s = scope(), selector = { kind: 'source_observation', sourceObservationId: 'observation-1' }) =>
  ({ schemaVersion: '1.0.0', requestId: 'stored-intake-read', scope: s, selector });
export const snapshotRequest = (s = scope(), snapshotId = hash('snapshot-1'), postingEventId = 'event-1') =>
  ({ schemaVersion: '1.0.0', requestId: 'stored-snapshot-read', scope: s, snapshotId, postingEventId });
const scoped = s => ({ tenant_id: s.tenantId, project_id: s.projectId, environment: s.environment, billing_mode: s.billingMode });

export function intakeRow(s = scope(), override = {}) {
  return {
    ...scoped(s), source_observation_id: 'observation-1', input_event_id: 'event-1',
    logical_operation_id: 'logical-1', provider_attempt_id: 'provider-1', billable_attempt_id: 'billable-1',
    transport_attempt_id: 'transport-1', provider_request_id: null,
    source_name: 'provider_response', completeness: 'incomplete', valuation_basis: 'estimated', attempt_revision_accepted: true,
    payload_sha256: hash('normalized-1'), idempotency_sha256: hash('idempotency-1'), provenance_sha256: hash('provenance-reference-1'),
    outbox_observation_id: 'observation-1', outbox_billable_attempt_id: 'billable-1', outbox_status: 'posted',
    outbox_pointer: 'event-1', outbox_event_id: 'event-1', outbox_event_hash: hash('ledger-1'),
    outbox_source_content_hash: hash('normalized-1'),
    outbox_logical_operation_id: 'logical-1', outbox_source_observation_id: 'observation-1',
    outbox_billable_status: 'known', outbox_billable_id: 'billable-1', outbox_provider_status: 'known', outbox_provider_id: 'provider-1',
    attempt_billable_id: 'billable-1', attempt_logical_id: 'logical-1', attempt_provider_id: 'provider-1',
    first_observation_id: 'observation-1', current_observation_id: 'observation-1',
    revision_sequence: 0, attempt_status: 'posted', attempt_completeness: 'incomplete', attempt_valuation_basis: 'estimated',
    current_pointer: 'event-1', current_event_id: 'event-1', current_event_hash: hash('ledger-1'),
    current_source_observation_id: 'observation-1', current_source_content_hash: hash('normalized-1'),
    head_observation_id: 'observation-1', head_payload_sha256: hash('normalized-1'),
    head_billable_id: 'billable-1', head_logical_id: 'logical-1', head_provider_id: 'provider-1',
    current_logical_operation_id: 'logical-1', current_billable_status: 'known', current_billable_id: 'billable-1',
    current_provider_status: 'known', current_provider_id: 'provider-1',
    first_billable_id: 'billable-1', first_logical_id: 'logical-1', first_provider_id: 'provider-1',
    latest_billable_id: 'billable-1', latest_logical_id: 'logical-1', latest_provider_id: 'provider-1',
    ...override,
  };
}
export const noPosting = prefix => ({
  [prefix + '_pointer']: null, [prefix + '_event_id']: null, [prefix + '_event_hash']: null,
  [prefix + '_logical_operation_id']: null, [prefix + '_billable_status']: null, [prefix + '_billable_id']: null,
  [prefix + '_provider_status']: null, [prefix + '_provider_id']: null,
  ...(prefix === 'outbox' ? { outbox_source_observation_id: null, outbox_source_content_hash: null } : {}),
  ...(prefix === 'current' ? { current_source_observation_id: null, current_source_content_hash: null,
    head_observation_id: null, head_payload_sha256: null, head_billable_id: null, head_logical_id: null, head_provider_id: null } : {}),
});
export const snapshotRow = (s = scope(), override = {}) => ({
  ...scoped(s), snapshot_id: hash('snapshot-1'), query_content_hash: hash('query-1'),
  encoding: '2.0.0', captured_at: now, watermark_id: hash('watermark-1'), input_count: 1, metadata_valid: true,
  ...override,
});
export const inputRow = (override = {}) => ({ input_count: 1, distinct_ids: 1, inputs_valid: true, selected_count: 1, selected_hash: hash('ledger-1'), ...override });
export const postingRow = (s = scope(), override = {}) => ({ ...scoped(s), event_id: 'event-1', event_hash: hash('ledger-1'), ...override });

export function model(override = {}) {
  const state = {
    calls: [], queries: [], connections: 0, releases: 0, discards: 0, committed: false, dataReads: 0,
    denied: false, revision: 'synthetic-revision-1', kind: 'service', milliseconds: Date.parse(now),
    restrictedRole: true, healthy: true, quarantined: false,
    intakeRows: [intakeRow()], snapshotRows: [snapshotRow()], inputRows: [inputRow()], postingRows: [postingRow()],
    ...override,
  };
  const client = {
    release() { state.releases++; },
    discard() { state.discards++; },
    async query(sql, values = []) {
      state.queries.push({ sql, values: structuredClone(values) });
      await state.beforeQuery?.(sql, values, state);
      let rows = [];
      if (sql.includes('FROM pg_roles')) rows = [{ restricted: state.restrictedRole }];
      else if (sql.includes('stored_lineage_reader_health')) rows = [{ migrations_ready: state.healthy }];
      else if (sql.startsWith('SELECT 1 AS restricted')) rows = state.quarantined ? [{ restricted: 1 }] : [];
      else if (sql.startsWith('SELECT i.tenant_id')) {
        state.dataReads++;
        rows = state.intakeRows.filter(row => partition({ tenantId: row.tenant_id, projectId: row.project_id, environment: row.environment, billingMode: row.billing_mode }).every((v, i) => v === values[i]));
        rows = rows.filter(row => sql.includes('AND o.ledger_event_id=$5') ? row.outbox_pointer === values[4] : row.source_observation_id === values[4]);
        rows = rows.toSorted((a, b) => a.source_observation_id < b.source_observation_id ? -1 : a.source_observation_id > b.source_observation_id ? 1 : 0).slice(0, values[5]);
      } else if (sql.startsWith('SELECT s.tenant_id')) { state.dataReads++; rows = state.snapshotRows; }
      else if (sql.startsWith('SELECT count(*)::integer AS input_count')) { state.dataReads++; rows = state.inputRows; }
      else if (sql.startsWith('SELECT tenant_id,project_id')) { state.dataReads++; rows = state.postingRows; }
      else if (sql === 'COMMIT') state.committed = true;
      const result = { rows };
      await state.afterQuery?.(sql, values, state, result);
      return result;
    },
  };
  const ports = {
    clock: { now: () => new Date(state.milliseconds) },
    database: { async connect() { state.connections++; return state.acquire ? state.acquire(client) : client; } },
    financeAuthority: { async authorizeCurrent(input) {
      state.calls.push({ operation: input.operation, permission: input.permission, dataReads: state.dataReads, committed: state.committed });
      if (state.authority) return state.authority(input, state);
      if (state.denied) return { status: 'denied', operation: input.operation, permission: input.permission };
      return decision(input, state.revision, state.kind);
    } },
  };
  return { state, client, ports, reader: createPostgresStoredLineageReader(ports) };
}
