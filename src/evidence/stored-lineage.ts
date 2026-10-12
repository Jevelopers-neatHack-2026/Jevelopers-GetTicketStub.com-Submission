import { types } from 'node:util';
import { Value } from '@sinclair/typebox/value';
import {
  authorizeFinanceOperation, errorEnvelope, failure,
  type ApiResult, type ErrorEnvelope, type FinanceAuthorizationDecision, type FinanceAuthorizationPort,
  type FinanceOperation,
} from '../shared/contracts.js';
import { bindFinancialDatabaseScope } from '../shared/database-scope.js';
import type { PostgresEvidenceTransactionPort } from './postgres-reader.js';
import {
  IntakeLineageRequestSchema, SnapshotInputLineageRequestSchema,
  type IntakeLineageRequest, type IntakeLineageResult, type SnapshotInputLineageRequest,
  type SnapshotInputLineageResult, type PostgresStoredLineageReader, type PostgresStoredLineageReaderPorts,
} from './stored-lineage-types.js';
import { readIntake, readSnapshotInput, type LineageRow } from './stored-lineage-data.js';

type Request = IntakeLineageRequest | SnapshotInputLineageRequest;
type Result = IntakeLineageResult | SnapshotInputLineageResult;
type AllowedDecision = Extract<FinanceAuthorizationDecision, { status: 'allowed' }>;
const PRIVACY = 'SELECT 1 AS restricted FROM cost_intelligence.financial_privacy_quarantine WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 LIMIT 1';
const TABLE_LOCK = 'LOCK TABLE cost_intelligence.financial_ledger_events, cost_intelligence.financial_privacy_quarantine, cost_intelligence.usage_intake_inbox, cost_intelligence.usage_intake_attempts, cost_intelligence.usage_intake_outbox, cost_intelligence.reporting_snapshots IN ACCESS SHARE MODE';
const ROLE = "SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT pg_has_role(current_user, 'ci_finance_owner', 'MEMBER') AND NOT pg_has_role(current_user, 'ci_finance_migrator', 'MEMBER') AND pg_has_role(current_user, 'ci_finance_runtime', 'MEMBER') AS restricted FROM pg_roles WHERE rolname=current_user";
const HEALTH = 'SELECT e.migrations_ready AND l.migrations_ready AS migrations_ready FROM cost_intelligence.evidence_reader_health e CROSS JOIN cost_intelligence.stored_lineage_reader_health l';

class LineageFailure extends Error {
  constructor(readonly envelope: ErrorEnvelope) { super(envelope.safe_message); }
}

/** Copy bounded plain data before validation or any awaited continuation. */
function snapshot<T>(value: T): T {
  let nodes = 0;
  let characters = 0;
  const visit = (input: unknown, depth: number): unknown => {
    if (++nodes > 8192 || depth > 16) throw new Error();
    if (input === null || typeof input === 'boolean') return input;
    if (typeof input === 'string') {
      characters += input.length;
      if (input.length > 8192 || characters > 262_144) throw new Error();
      return input;
    }
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (typeof input !== 'object' || types.isProxy(input)) throw new Error();
    const array = Array.isArray(input);
    const prototype = Object.getPrototypeOf(input);
    if (array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) throw new Error();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== 'string')) throw new Error();
    if (array) {
      if (input.length > 128 || keys.length !== input.length + 1) throw new Error();
      const copy: unknown[] = [];
      for (let i = 0; i < input.length; i++) {
        const descriptor = descriptors[String(i)];
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) throw new Error();
        copy.push(visit(descriptor.value, depth + 1));
      }
      return Object.freeze(copy);
    }
    if (keys.length > 96) throw new Error();
    const copy: Record<string, unknown> = {};
    for (const key of keys as string[]) {
      const descriptor = descriptors[key]!;
      if (key.length > 128 || !descriptor.enumerable || !('value' in descriptor)) throw new Error();
      Object.defineProperty(copy, key, { value: visit(descriptor.value, depth + 1), enumerable: true });
    }
    return Object.freeze(copy);
  };
  return visit(value, 0) as T;
}

function scalarRows(value: unknown): LineageRow[] {
  if (!value || typeof value !== 'object' || types.isProxy(value)) throw new Error();
  const rows = Object.getOwnPropertyDescriptor(value, 'rows');
  if (!rows || !('value' in rows)) throw new Error();
  const copy = snapshot(rows.value) as unknown;
  if (!Array.isArray(copy) || copy.length > 51) throw new Error();
  for (const row of copy) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error();
    for (const cell of Object.values(row)) if (cell !== null && !['string', 'number', 'boolean'].includes(typeof cell)) throw new Error();
  }
  return copy as LineageRow[];
}

function deadline(unavailable: () => LineageFailure) {
  const expires = performance.now() + 15_000;
  let closed = false;
  const check = () => { if (closed || performance.now() >= expires) { closed = true; throw unavailable(); } };
  return {
    check, close: () => { closed = true; },
    // Only callbacks/acquisition are raced. Never release or reuse a connection
    // while an unresolved SQL operation could still be executing.
    async wait<T>(action: () => Promise<T>, limit = 2_000): Promise<T> {
      check();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { closed = true; reject(unavailable()); }, Math.min(limit, Math.max(1, expires - performance.now())));
        });
        const result = await Promise.race([action(), timeout]);
        check();
        return result;
      } finally { if (timer !== undefined) clearTimeout(timer); }
    },
  };
}

/** Separate bounded metadata reads; no financial, intake, snapshot or export mutation. */
export function createPostgresStoredLineageReader(ports: PostgresStoredLineageReaderPorts): PostgresStoredLineageReader {
  async function execute<T extends Result>(value: unknown, reporting: boolean): Promise<ApiResult<T>> {
    const operation = reporting ? 'readSnapshotInputLineage' : 'readIntakeLineage';
    const invalid = () => new LineageFailure(errorEnvelope('evidence', operation, 'VALIDATION_ERROR', 'stored-lineage-request', 'The stored lineage request is invalid.'));
    let request: Request;
    try {
      const captured = snapshot(value);
      if (!Value.Check(reporting ? SnapshotInputLineageRequestSchema : IntakeLineageRequestSchema, captured)) throw invalid();
      request = captured as Request;
    } catch { return failure(invalid().envelope); }
    const unavailable = () => new LineageFailure(errorEnvelope('evidence', operation, 'SOURCE_UNAVAILABLE', request.requestId, 'Stored lineage or current authorization is temporarily unavailable.', true));
    const changed = () => new LineageFailure(errorEnvelope('evidence', operation, 'FORBIDDEN_SCOPE', request.requestId, 'Current financial authorization changed during the lineage lookup.'));
    const fence = deadline(unavailable);
    let client: PostgresEvidenceTransactionPort | undefined;
    let active = false;
    let discard = false;
    let terminal: LineageFailure | undefined;
    let sql: PostgresEvidenceTransactionPort['query'] | undefined;
    let release: (() => void) | undefined;
    let evict: (() => void) | undefined;
    const stop = (error: unknown) => terminal ??= error instanceof LineageFailure ? error : unavailable();
    try {
      const rawNow = ports.clock.now.bind(ports.clock);
      let lastNow = -Infinity;
      const clock = { now: () => {
        const instant = Date.prototype.getTime.call(rawNow());
        if (!Number.isFinite(instant) || instant < lastNow) throw unavailable();
        lastNow = instant;
        return new Date(instant);
      } };
      const method = ports.financeAuthority?.authorizeCurrent.bind(ports.financeAuthority);
      const authority: FinanceAuthorizationPort | undefined = method === undefined ? undefined : {
        // Snapshot the raw decision BEFORE the shared validator and before a
        // retained host alias can rewrite its principal or grant revision.
        async authorizeCurrent(input) { return snapshot(await method(snapshot(input))); },
      };
      const connect = ports.database.connect.bind(ports.database);
      const operations: FinanceOperation[] = reporting ? ['ledger.readSnapshot', 'reporting.querySummary'] : ['ledger.readSnapshot'];
      let principalPin: string | undefined;
      const decisions = new Map<FinanceOperation, AllowedDecision>();
      const current = () => {
        fence.check();
        const instant = clock.now().getTime();
        for (const decision of decisions.values()) {
          const verified = Date.parse(decision.verifiedAt);
          if (!Number.isFinite(verified) || instant < verified || instant - verified > 60_000 || instant >= Date.parse(decision.expiresAt)) throw changed();
        }
      };
      const renew = async () => {
        if (terminal) throw terminal;
        for (const selected of operations) {
          const auth = await fence.wait(() => authorizeFinanceOperation({ module: 'ledger', requestOperation: 'authorizeFinanceOperation',
            operation: selected, requestId: request.requestId, scope: request.scope, clock, financeAuthority: authority }));
          if (!auth.ok) throw stop(new LineageFailure(auth.error));
          if (auth.decision.status !== 'allowed' || !('principal' in auth.decision)) throw stop(changed());
          const principal = auth.decision.principal;
          const pin = JSON.stringify(principal.kind === 'user'
            ? [principal.kind, principal.actorId, principal.membershipRevision]
            : [principal.kind, principal.actorId, principal.serviceGrantRevision]);
          if (principalPin !== undefined && pin !== principalPin) throw stop(changed());
          principalPin ??= pin;
          decisions.set(selected, auth.decision);
          // A ledger grant can expire while reporting authorization is awaited.
          current();
        }
        current();
      };
      await renew();
      let acquired: PostgresEvidenceTransactionPort | undefined;
      let abandoned = false;
      const acquisition = connect().then(connection => {
        acquired = connection;
        if (abandoned) { try { connection.release(); } catch { /* late cleanup only */ } acquired = undefined; }
        return connection;
      });
      try { client = await fence.wait(() => acquisition, 5_000); }
      catch (error) {
        abandoned = true;
        if (acquired) { try { acquired.release(); } catch { /* safe cleanup */ } acquired = undefined; }
        throw error;
      }
      if (client && typeof client.release === 'function') release = client.release.bind(client);
      if (client && typeof client.discard === 'function') evict = client.discard.bind(client);
      if (!client || typeof client.query !== 'function' || !release || !evict) throw unavailable();
      // Capture driver methods once. No caller method mutation can change this session.
      sql = client.query.bind(client);
      const runSql = sql;
      const query = async (text: string, parameters: readonly unknown[] = []): Promise<LineageRow[]> => {
        await renew();
        let rows: LineageRow[] | undefined;
        let failed = false;
        try { rows = scalarRows(await runSql(text, parameters)); } catch { failed = true; discard = true; }
        await renew();
        if (failed || rows === undefined) throw stop(unavailable());
        return rows;
      };
      active = true;
      await query('BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY');
      await query("SET LOCAL statement_timeout='5000ms'");
      await query("SET LOCAL lock_timeout='2000ms'");
      await query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
      const role = await query(ROLE);
      if (role.length !== 1 || role[0]?.restricted !== true) throw unavailable();
      await bindFinancialDatabaseScope({ query }, request.scope);
      await query(TABLE_LOCK);
      const s = request.scope;
      const partition = [s.tenantId, s.projectId, s.environment, s.billingMode];
      await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ci02-ledger:${s.tenantId}:${s.projectId}:${s.environment}:${s.billingMode}`]);
      const health = await query(HEALTH);
      if (health.length !== 1 || health[0]?.migrations_ready !== true) throw unavailable();
      const privacy = async () => { if ((await query(PRIVACY, partition)).length) throw unavailable(); };
      const session = { query, privacy, partition };
      const result = reporting
        ? await readSnapshotInput(request as SnapshotInputLineageRequest, session)
        : await readIntake(request as IntakeLineageRequest, session);
      const detached = snapshot(result);
      await renew();
      // No external authority/source callback follows gate release. Synchronous
      // current-time checks cover BOTH grants through the final SQL boundaries.
      current();
      let finalPrivacy: LineageRow[];
      try { finalPrivacy = scalarRows(await runSql(PRIVACY, partition)); } catch { discard = true; throw unavailable(); }
      current();
      if (finalPrivacy.length) throw unavailable();
      try { await runSql('COMMIT'); } catch { discard = true; throw unavailable(); }
      active = false;
      current();
      return { ok: true, value: detached as T };
    } catch (error) {
      fence.close();
      if (active && sql) { try { await sql('ROLLBACK'); } catch { discard = true; } }
      return failure(stop(error).envelope);
    } finally {
      fence.close();
      try { if (discard) evict?.(); else release?.(); } catch { /* no driver detail leaves the boundary */ }
    }
  }
  return Object.freeze({
    readIntakeLineage: (value: unknown) => execute<IntakeLineageResult>(value, false),
    readSnapshotInputLineage: (value: unknown) => execute<SnapshotInputLineageResult>(value, true),
  });
}
