import { Value } from '@sinclair/typebox/value';
import { bindFinancialDatabaseScope } from '../shared/database-scope.js';
import {
  authorizeFinanceOperation, errorEnvelope, failure,
  type ApiResult, type Clock, type ErrorEnvelope, type FinanceAuthorizationDecision,
  type FinanceAuthorizationPort, type TrustedScope,
} from '../shared/contracts.js';
import type { LedgerQueryResult } from '../ledger/store.js';
import {
  PostingEvidenceRequestSchema, ReverseEvidenceRequestSchema, lookupPostingEvidence,
  lookupByOperationalReference, validateEvidenceReference, REVERSE_LOOKUP_KINDS,
  type EvidenceLedgerRecord, type EvidenceLinkStorePort, type EvidenceStoreRead,
  type PostingEvidence, type PostingEvidenceRequest, type ReverseEvidence, type ReverseEvidenceRequest,
} from './index.js';

export interface PostgresEvidenceTransactionPort {
  query(text: string, values?: readonly unknown[]): Promise<LedgerQueryResult>;
  release(): void;
  /** MUST evict/destroy the connection; a node-postgres wrapper calls PoolClient.release(true). */
  discard(): void;
}

export interface PostgresEvidenceDatabasePort {
  connect(): Promise<PostgresEvidenceTransactionPort>;
}

export interface PostgresEvidenceReaderPorts {
  /** Restricted host-managed ci_finance_runtime pool with finite connection/query transport timeouts. */
  readonly database: PostgresEvidenceDatabasePort;
  readonly clock: Clock;
  readonly financeAuthority?: FinanceAuthorizationPort;
}

/** Only authorized lookup methods are exposed; a transaction-bound store cannot escape its lookup. */
export interface PostgresEvidenceReader {
  lookupPostingEvidence(value: unknown): Promise<ApiResult<PostingEvidence>>;
  lookupByOperationalReference(value: unknown): Promise<ApiResult<ReverseEvidence>>;
}

type Request = PostingEvidenceRequest | ReverseEvidenceRequest;
type Row = Record<string, unknown>;
const MAX_ROWS = 51;

// Explicit scalar projection: neither financial amounts nor event_payload nor
// arbitrary source/dimension/pricing objects cross this adapter's SQL boundary.
const COLUMNS = `e.tenant_id, e.project_id, e.environment, e.billing_mode,
  e.event_id, e.event_type, e.classification, e.financial_effect, e.correlation_id,
  e.logical_operation_id, e.source_observation_id, e.reservation_id,
  e.transport_attempt_id, e.transport_attempt_status, e.provider_attempt_id, e.provider_attempt_status,
  e.provider_request_id, e.provider_request_status, e.billable_attempt_id, e.billable_attempt_status,
  e.dimensions->>'provider' AS provider, jsonb_typeof(e.dimensions->'provider') AS provider_type,
  e.dimensions->>'workflowId' AS workflow_id, jsonb_typeof(e.dimensions->'workflowId') AS workflow_type,
  e.dimensions->>'jobId' AS job_id, jsonb_typeof(e.dimensions->'jobId') AS job_type,
  jsonb_typeof(e.pricing) AS pricing_type,
  e.pricing->>'policyVersion' AS policy_version, e.pricing->>'ruleVersion' AS rule_version,
  jsonb_typeof(e.pricing->'policyVersion') AS policy_version_type,
  jsonb_typeof(e.pricing->'ruleVersion') AS rule_version_type,
  jsonb_typeof(e.pricing->'rateCardRef') AS rate_card_type,
  e.pricing->'rateCardRef'->>'contract' AS rate_card_contract,
  jsonb_typeof(e.pricing->'rateCardRef'->'contract') AS rate_card_contract_type,
  e.pricing->'rateCardRef'->>'id' AS rate_card_id,
  jsonb_typeof(e.pricing->'rateCardRef'->'id') AS rate_card_id_type,
  e.pricing->'rateCardRef'->>'revision' AS rate_card_revision,
  jsonb_typeof(e.pricing->'rateCardRef'->'revision') AS rate_card_revision_type,
  e.pricing->'rateCardRef'->>'content_hash' AS rate_card_hash,
  jsonb_typeof(e.pricing->'rateCardRef'->'content_hash') AS rate_card_hash_type,
  e.supersedes_event_id, e.reverses_event_id`;
const PARTITION = 'e.tenant_id=$1 AND e.project_id=$2 AND e.environment=$3 AND e.billing_mode=$4';
const PRIVACY = 'SELECT 1 AS restricted FROM cost_intelligence.financial_privacy_quarantine WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 LIMIT 1';

class ReadFailure extends Error {
  constructor(readonly envelope: ErrorEnvelope) { super(envelope.safe_message); }
}

function readDeadline(unavailable: () => ReadFailure) {
  const expires = performance.now() + 15_000;
  let closed = false;
  const check = () => { if (closed || performance.now() >= expires) { closed = true; throw unavailable(); } };
  return {
    check,
    close: () => { closed = true; },
    // Race callbacks/acquisition only. Never race a live SQL transaction or
    // release its connection while an unresolved query could still continue.
    async wait<T>(operation: () => Promise<T>, limitMs = 2_000): Promise<T> {
      check();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { closed = true; reject(unavailable()); }, Math.min(limitMs, Math.max(1, expires - performance.now())));
        });
        const result = await Promise.race([operation(), timeout]);
        check();
        return result;
      } finally { if (timer !== undefined) clearTimeout(timer); }
    },
  };
}

/** Bounded scalar rows, detached before any authority await. */
function snapshotRows(value: unknown): Row[] {
  if (!value || typeof value !== 'object' || !('rows' in value) || !Array.isArray(value.rows)
    || value.rows.length > MAX_ROWS || Object.keys(value.rows).length !== value.rows.length) throw new Error();
  let characters = 0;
  return value.rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row) || Object.keys(row).length > 64) throw new Error();
    const copy: Row = {};
    for (const [key, cell] of Object.entries(row)) {
      if (key.length > 64 || (cell !== null && !['string', 'number', 'boolean'].includes(typeof cell))) throw new Error();
      if (typeof cell === 'string' && cell.length > 4096) throw new Error();
      if (typeof cell === 'number' && !Number.isFinite(cell)) throw new Error();
      characters += key.length + (typeof cell === 'string' ? cell.length : 32);
      if (characters > 262_144) throw new Error();
      Object.defineProperty(copy, key, { value: cell, enumerable: true });
    }
    return Object.freeze(copy);
  });
}

function record(row: Row): EvidenceLedgerRecord {
  const jsonString = (field: string, typeField: string, optional = false): string | null => {
    if (optional && row[field] === null && row[typeField] === null) return null;
    if (typeof row[field] !== 'string' || row[typeField] !== 'string') throw new Error();
    return row[field];
  };
  const identity = (name: string): EvidenceLedgerRecord['transportAttempt'] => {
    const status = row[`${name}_status`];
    const id = row[`${name}_id`];
    if (status === 'known' && typeof id === 'string') return { status, id };
    if ((status === 'unknown' || status === 'not_applicable') && id === null) return { status };
    throw new Error();
  };
  const provider = jsonString('provider', 'provider_type', true);
  const workflowId = jsonString('workflow_id', 'workflow_type', true);
  const jobId = jsonString('job_id', 'job_type', true);
  let pricing: EvidenceLedgerRecord['pricing'] = null;
  if (row.pricing_type !== null) {
    if (row.pricing_type !== 'object') throw new Error();
    let rateCardRef: NonNullable<EvidenceLedgerRecord['pricing']>['rateCardRef'] = null;
    if (row.rate_card_type !== 'null') {
      if (row.rate_card_type !== 'object' || row.rate_card_revision_type !== 'number' || typeof row.rate_card_revision !== 'string') throw new Error();
      if (!/^(0|[1-9][0-9]*)(\.0+)?$/.test(row.rate_card_revision)) throw new Error();
      const revision = Number(row.rate_card_revision);
      if (!Number.isSafeInteger(revision) || revision < 0) throw new Error();
      rateCardRef = { contract: jsonString('rate_card_contract', 'rate_card_contract_type')!,
        id: jsonString('rate_card_id', 'rate_card_id_type')!, revision,
        content_hash: jsonString('rate_card_hash', 'rate_card_hash_type')! };
    }
    pricing = { policyVersion: jsonString('policy_version', 'policy_version_type')!,
      ruleVersion: jsonString('rule_version', 'rule_version_type')!, rateCardRef };
  }
  // The public projection handles malformed/unsafe strings as explicit gaps.
  // Wrong stored JSON types refuse; ->> must never manufacture a string/id.
  return {
    scope: { tenantId: row.tenant_id as string, projectId: row.project_id as string,
      environment: row.environment as TrustedScope['environment'], billingMode: row.billing_mode as TrustedScope['billingMode'] },
    eventId: row.event_id as string, eventType: row.event_type as string, classification: row.classification as string,
    financialEffect: row.financial_effect as boolean, correlationId: row.correlation_id as string,
    logicalOperationId: row.logical_operation_id as string, sourceObservationId: row.source_observation_id as string,
    reservationId: row.reservation_id as string | null,
    transportAttempt: identity('transport_attempt'), providerAttempt: identity('provider_attempt'),
    providerRequest: identity('provider_request'), billableAttempt: identity('billable_attempt'),
    provider, workflowId, jobId, pricing,
    supersedesEventId: row.supersedes_event_id as string | null, reversesEventId: row.reverses_event_id as string | null,
  };
}

/**
 * Read existing ledger refs using the current public evidence policy. Opens no
 * connection at construction, writes no financial data and exposes no raw store.
 */
export function createPostgresEvidenceReader(ports: PostgresEvidenceReaderPorts): PostgresEvidenceReader {
  async function execute<T extends PostingEvidence | ReverseEvidence>(value: unknown, reverse: boolean): Promise<ApiResult<T>> {
    const operation = reverse ? 'lookupByOperationalReference' : 'lookupPostingEvidence';
    const invalid = () => new ReadFailure(errorEnvelope('evidence', operation, 'VALIDATION_ERROR', 'evidence-request', 'The evidence lookup request is invalid.'));
    let request: Request;
    try {
      if (!Value.Check(reverse ? ReverseEvidenceRequestSchema : PostingEvidenceRequestSchema, value)) throw invalid();
      request = Value.Clone(value) as Request;
      Object.freeze(request.scope);
      if ('reference' in request) {
        const reference = validateEvidenceReference(request.reference);
        if (!reference.ok || reference.value.status !== 'resolved') throw invalid();
        // Preserve legacy unsupported-kind validation without opening a database.
        if (!REVERSE_LOOKUP_KINDS.some(kind => kind === reference.value.kind)) throw invalid();
        Object.freeze(request.reference);
      }
      Object.freeze(request);
    } catch { return failure(invalid().envelope); }

    const unavailable = () => new ReadFailure(errorEnvelope('evidence', operation, 'SOURCE_UNAVAILABLE', request.requestId, 'Evidence storage or current authorization is temporarily unavailable.', true));
    const changed = () => new ReadFailure(errorEnvelope('evidence', 'authorizeFinanceOperation', 'FORBIDDEN_SCOPE', request.requestId, 'Current financial authorization changed during the evidence lookup.'));
    const deadline = readDeadline(unavailable);
    let terminal: ReadFailure | undefined;
    let client: PostgresEvidenceTransactionPort | undefined;
    let active = false;
    let discard = false;
    const stop = (error: unknown) => { terminal ??= error instanceof ReadFailure ? error : unavailable(); return terminal; };
    try {
      const rawNow = ports.clock.now.bind(ports.clock);
      let lastNow = -Infinity;
      const clock = { now: () => {
        const instant = Date.prototype.getTime.call(rawNow());
        if (!Number.isFinite(instant) || instant < lastNow) throw unavailable();
        lastNow = instant;
        return new Date(instant);
      } };
      const authority = ports.financeAuthority;
      const method = authority?.authorizeCurrent.bind(authority);
      // The method is captured once. The raw response is private
      // BEFORE shared validation, including the legacy handler's renewals.
      const rawAuthority: FinanceAuthorizationPort | undefined = method === undefined ? undefined : {
        async authorizeCurrent(input) {
          return structuredClone(await method(input));
        },
      };
      const connect = ports.database.connect.bind(ports.database);
      let pinnedPrincipal: string | undefined;
      let currentGrant: Extract<FinanceAuthorizationDecision, { readonly status: 'allowed' }> | undefined;
      const current = () => {
        deadline.check();
        const instant = clock.now().getTime();
        if (currentGrant === undefined) throw changed();
        const verified = Date.parse(currentGrant.verifiedAt);
        if (instant < verified || instant - verified > 60_000 || instant >= Date.parse(currentGrant.expiresAt)) throw changed();
      };
      const renew = async (): Promise<FinanceAuthorizationDecision> => {
        if (terminal) throw terminal;
        const result = await deadline.wait(() => authorizeFinanceOperation({ module: 'ledger', requestOperation: 'authorizeFinanceOperation',
          operation: 'ledger.readSnapshot', requestId: request.requestId, scope: request.scope, clock, financeAuthority: rawAuthority }));
        if (!result.ok) throw stop(new ReadFailure(result.error));
        if (result.decision.status !== 'allowed' || !('principal' in result.decision)) throw stop(changed());
        const principal = result.decision.principal;
        const revision = JSON.stringify(principal.kind === 'user'
          ? [principal.kind, principal.actorId, principal.membershipRevision]
          : [principal.kind, principal.actorId, principal.serviceGrantRevision]);
        if (pinnedPrincipal !== undefined && pinnedPrincipal !== revision) throw stop(changed());
        pinnedPrincipal ??= revision;
        currentGrant = result.decision;
        current();
        return result.decision;
      };
      await renew();
      if ('reference' in request && request.reference.status === 'resolved'
        && request.reference.kind !== 'provider_request' && request.reference.namespace !== 'cost-intelligence') {
        // These namespaces are valid evidence vocabulary, but this native
        // ledger reader has no accepted foreign source index or mapping.
        throw unavailable();
      }
      // A client which resolves after abandonment is released once and never
      // receives BEGIN. Active SQL is governed by finite host driver timeouts.
      let acquired: PostgresEvidenceTransactionPort | undefined;
      let abandoned = false;
      const acquisition = connect().then(result => {
        acquired = result;
        if (abandoned) { try { result.release(); } catch { /* safe late cleanup */ } acquired = undefined; }
        return result;
      });
      try { client = await deadline.wait(() => acquisition, 5_000); }
      catch (error) {
        abandoned = true;
        if (acquired) { try { acquired.release(); } catch { /* safe acquisition cleanup */ } acquired = undefined; }
        throw error;
      }
      if (!client || typeof client.query !== 'function' || typeof client.release !== 'function' || typeof client.discard !== 'function') throw unavailable();
      await renew();
      const connected = client;
      const query = async (sql: string, parameters: readonly unknown[] = []): Promise<Row[]> => {
        await renew();
        deadline.check();
        let rows: Row[] | undefined;
        let failed = false;
        try { rows = snapshotRows(await connected.query(sql, parameters)); } catch { failed = true; discard = true; }
        // Failed/malformed database responses also cross an awaited boundary.
        await renew();
        deadline.check();
        if (failed || rows === undefined) throw stop(unavailable());
        return rows;
      };
      active = true;
      await query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
      await query("SET LOCAL statement_timeout='5000ms'");
      await query("SET LOCAL lock_timeout='2000ms'");
      await query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
      const role = await query("SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT pg_has_role(current_user, 'ci_finance_owner', 'MEMBER') AND NOT pg_has_role(current_user, 'ci_finance_migrator', 'MEMBER') AND pg_has_role(current_user, 'ci_finance_runtime', 'MEMBER') AS restricted FROM pg_roles WHERE rolname=current_user");
      if (role.length !== 1 || role[0]?.restricted !== true) throw stop(unavailable());
      await bindFinancialDatabaseScope({ query }, request.scope);
      const scope = request.scope;
      const partition = [scope.tenantId, scope.projectId, scope.environment, scope.billingMode];
      // Hold the relied-on relations before attesting their policy catalog;
      // ALTER POLICY cannot swap those guards between health and a data read.
      await query('LOCK TABLE cost_intelligence.financial_ledger_events, cost_intelligence.financial_privacy_quarantine IN ACCESS SHARE MODE');
      // Existing audit_legacy_financial_privacy participates in this gate.
      // PR43 owns the separate fence for privileged direct quarantine inserts.
      await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ci02-ledger:${scope.tenantId}:${scope.projectId}:${scope.environment}:${scope.billingMode}`]);
      const health = await query('SELECT migrations_ready FROM cost_intelligence.evidence_reader_health');
      if (health.length !== 1 || health[0]?.migrations_ready !== true) throw stop(unavailable());
      const privacy = async () => { if ((await query(PRIVACY, partition)).length !== 0) throw stop(unavailable()); };
      await privacy();

      const read = async <R>(action: () => Promise<R>): Promise<EvidenceStoreRead<R>> => {
        try { if (terminal) throw terminal; return { status: 'ok', value: await action() }; }
        catch (error) { stop(error); return { status: 'unavailable' }; }
      };
      const sameScope = (candidate: TrustedScope) => candidate.tenantId === scope.tenantId && candidate.projectId === scope.projectId
        && candidate.environment === scope.environment && candidate.billingMode === scope.billingMode && candidate.actorId === scope.actorId;
      const select = async (predicate: string, parameters: readonly unknown[], limit: number) => {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw stop(unavailable());
        await privacy();
        const rows = await query(`SELECT ${COLUMNS} FROM cost_intelligence.financial_ledger_events e WHERE ${PARTITION} AND ${predicate} ORDER BY e.event_id LIMIT $${parameters.length + 5}`, [...partition, ...parameters, limit + 1]);
        const records = rows.slice(0, limit).map(record);
        if (records.some(item => item.scope.tenantId !== scope.tenantId || item.scope.projectId !== scope.projectId
          || item.scope.environment !== scope.environment || item.scope.billingMode !== scope.billingMode)) throw stop(unavailable());
        return { records, truncated: rows.length > limit };
      };
      const store: EvidenceLinkStorePort = {
        getPosting: (candidate, eventId) => read(async () => {
          if (!sameScope(candidate)) throw changed();
          const found = await select('e.event_id=$5', [eventId], 1);
          if (found.truncated || found.records.some(item => item.eventId !== eventId)) throw unavailable();
          return found.records[0] ?? null;
        }),
        listByLogicalOperation: (candidate, logicalOperationId, limit) => read(async () => {
          if (!sameScope(candidate)) throw changed();
          // Existing usage_observation ledger rows only. The intake inbox is
          // not fabricated into a second financial or usage ledger record.
          return select("e.logical_operation_id=$5 AND e.event_type='usage_observation'", [logicalOperationId], limit);
        }),
        findByReference: (candidate, reference, limit) => read(async () => {
          if (!sameScope(candidate)) throw changed();
          const columns = { logical_operation: 'logical_operation_id', source_observation: 'source_observation_id',
            reservation: 'reservation_id', correlation: 'correlation_id' } as const;
          if (reference.kind === 'workflow' || reference.kind === 'job') {
            const key = reference.kind === 'workflow' ? 'workflowId' : 'jobId';
            return select('e.dimensions @> $5::jsonb', [JSON.stringify({ [key]: reference.id })], limit);
          }
          if (reference.kind === 'provider_request') return select("e.provider_request_status='known' AND e.provider_request_id=$5 AND lower(e.dimensions->>'provider')=$6", [reference.id, reference.namespace.slice('provider:'.length)], limit);
          if (reference.kind === 'billable_attempt' || reference.kind === 'transport_attempt' || reference.kind === 'provider_attempt') {
            return select(`e.${reference.kind}_status='known' AND e.${reference.kind}_id=$5`, [reference.id], limit);
          }
          const column = columns[reference.kind];
          return select(`e.${column}=$5`, [reference.id], limit);
        }),
      };
      // The legacy authorization helper still validates every decision. This
      // adapter additionally shares ONE principal pin with the whole lifecycle.
      const guardedAuthority: FinanceAuthorizationPort = { async authorizeCurrent() {
        try { return await renew(); } catch (error) { stop(error); return null; }
      } };
      const result = reverse
        ? await lookupByOperationalReference(request, { store, clock, financeAuthority: guardedAuthority })
        : await lookupPostingEvidence(request, { store, clock, financeAuthority: guardedAuthority });
      if (terminal) throw terminal;
      if (!result.ok) throw new ReadFailure(result.error);
      const detached = Value.Clone(result) as ApiResult<T>;
      await renew();
      // Final READ COMMITTED privacy observation while the same gate is held.
      // No external authorization/source await follows COMMIT's gate release.
      current();
      let finalPrivacy: Row[];
      try { finalPrivacy = snapshotRows(await connected.query(PRIVACY, partition)); }
      catch { discard = true; throw unavailable(); }
      current();
      if (finalPrivacy.length !== 0) throw stop(unavailable());
      try { await connected.query('COMMIT'); } catch { discard = true; throw unavailable(); }
      active = false;
      current();
      return detached;
    } catch (error) {
      deadline.close();
      if (active && client) {
        try { await client.query('ROLLBACK'); } catch { discard = true; }
      }
      return failure(stop(error).envelope);
    } finally {
      deadline.close();
      if (client) { try { if (discard) client.discard(); else client.release(); } catch { /* no driver detail leaves the boundary */ } }
    }
  }
  return Object.freeze({
    lookupPostingEvidence: (value: unknown) => execute<PostingEvidence>(value, false),
    lookupByOperationalReference: (value: unknown) => execute<ReverseEvidence>(value, true),
  });
}
