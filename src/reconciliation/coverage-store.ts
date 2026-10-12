import { bindFinancialDatabaseScope } from '../shared/database-scope.js';
import type { LedgerTransactionPort } from '../ledger/store.js';
import { CoverageFailure, coverageSnapshot, coverageSamePartition, coverageRecordValid, coverageHash, type CoverageImportRecord, type CoverageStoredRun, type CoverageRunStorePort, type CoverageStoreAccess } from './coverage-types.js';
import { validateCoverageStoredRun } from './coverage-runtime.js';
import { coverageDeadline } from './coverage-deadline.js';

export interface PostgresCoverageTransactionPort extends LedgerTransactionPort {
  /** MUST physically evict the connection; a node-postgres adapter calls PoolClient.release(true). */
  discard(): void;
}

export interface PostgresCoverageDatabasePort {
  /** Restricted host-managed pool with finite connection and query transport timeouts. */
  connect(): Promise<PostgresCoverageTransactionPort>;
}

/** Host supplies a restricted ci_finance_runtime adapter; no hidden connection, credentials or migration execution. */
export function createPostgresCoverageRunStore(database: PostgresCoverageDatabasePort): CoverageRunStorePort {
  const connect = database.connect.bind(database);
  const invalidStorage = () => new CoverageFailure('SOURCE_UNAVAILABLE', 'Coverage storage returned invalid evidence.', true);
  function storedRun(row: Record<string, unknown> | undefined, access: CoverageStoreAccess): CoverageStoredRun {
    const run = validateCoverageStoredRun(row?.run_content, access.scope);
    if (!row || row.tenant_id !== run.scope.tenantId || row.project_id !== run.scope.projectId || row.environment !== run.scope.environment || row.billing_mode !== run.scope.billingMode
      || row.run_id !== run.summary.runId || row.idempotency_key !== run.idempotencyKey || row.input_hash !== run.summary.inputHash) throw invalidStorage();
    return run;
  }
  async function transaction<T>(access: CoverageStoreAccess, action: (query: (sql: string, values?: readonly unknown[]) => Promise<{ rows: readonly Record<string, unknown>[] }>) => Promise<T>): Promise<T> {
    const scope = coverageSnapshot(access.scope);
    const deadline = coverageDeadline();
    const renew = () => deadline.wait(access.renew);
    let client: PostgresCoverageTransactionPort | undefined;
    let sql: PostgresCoverageTransactionPort['query'] | undefined;
    let release: (() => void) | undefined;
    let discard: (() => void) | undefined;
    let active = false;
    let discardRequired = false;
    try {
      await renew();
      // Bound only acquisition, before any transaction exists. A late client is
      // released exactly once and never receives BEGIN or another SQL command.
      let acquired: PostgresCoverageTransactionPort | undefined;
      let abandoned = false;
      const acquisition = connect().then(result => {
        acquired = result;
        if (abandoned) { try { result.release(); } catch { /* Safe late cleanup. */ } acquired = undefined; }
        return result;
      });
      try { client = await deadline.wait(() => acquisition, 5_000); }
      catch (error) {
        abandoned = true;
        if (acquired) { try { acquired.release(); } catch { /* Safe bounded-acquisition cleanup. */ } acquired = undefined; }
        throw error;
      }
      if (client && typeof client.release === 'function') release = client.release.bind(client);
      if (client && typeof client.discard === 'function') discard = client.discard.bind(client);
      if (!client || typeof client.query !== 'function' || !release || !discard) throw invalidStorage();
      // Capture the driver methods before an authorization await. Cleanup must
      // use the same connection capabilities as the transaction it protects.
      sql = client.query.bind(client);
      const runSql = sql;
      const execute = async (text: string, values?: readonly unknown[]) => {
        try {
          const result = await runSql(text, values);
          const rows = coverageSnapshot(result.rows);
          if (!Array.isArray(rows)) throw invalidStorage();
          return { rows };
        } catch (error) {
          // A rejected/synchronous driver call or malformed acknowledgement
          // cannot establish safe pool reuse, even when rollback later succeeds.
          discardRequired = true;
          throw error;
        }
      };
      await renew();
      const query = async (text: string, values?: readonly unknown[]) => {
        if (text.startsWith('INSERT ')) await renew();
        deadline.check();
        const result = await execute(text, values);
        deadline.check();
        await renew();
        return result;
      };
      // BEGIN may reach PostgreSQL before its acknowledgement is lost.
      active = true;
      await execute('BEGIN');
      await renew();
      await query("SET LOCAL statement_timeout='5000ms'");
      await query("SET LOCAL lock_timeout='2000ms'");
      await query("SET LOCAL idle_in_transaction_session_timeout='5000ms'");
      const role = await query("SELECT NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT pg_has_role(current_user, 'ci_finance_owner', 'MEMBER') AND NOT pg_has_role(current_user, 'ci_finance_migrator', 'MEMBER') AND pg_has_role(current_user, 'ci_finance_runtime', 'MEMBER') AS restricted FROM pg_roles WHERE rolname=current_user");
      if (role.rows[0]?.restricted !== true) throw invalidStorage();
      await bindFinancialDatabaseScope({ query }, scope);
      // This gate coordinates with the existing controlled audit protocol, including replay and read.
      // A fence for privileged direct quarantine inserts is a separate PR43 prerequisite.
      await query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`ci02-ledger:${scope.tenantId}:${scope.projectId}:${scope.environment}:${scope.billingMode}`]);
      const health = await query('SELECT migrations_ready FROM cost_intelligence.reconciliation_coverage_health');
      if (health.rows[0]?.migrations_ready !== true) throw new CoverageFailure('SOURCE_UNAVAILABLE', 'Coverage storage migrations are unavailable.', true);
      const quarantine = await query('SELECT 1 AS quarantined FROM cost_intelligence.financial_privacy_quarantine WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 LIMIT 1', [scope.tenantId, scope.projectId, scope.environment, scope.billingMode]);
      if (quarantine.rows.length !== 0) throw new CoverageFailure('SOURCE_UNAVAILABLE', 'Coverage evidence is unavailable for this scope.', true);
      const result = coverageSnapshot(await action(query));
      await renew();
      // Renewal precedes COMMIT but is not a cross-system atomic revocation transaction.
      await execute('COMMIT');
      active = false;
      await renew();
      return result;
    } catch (error) {
      deadline.close();
      if (active && sql) {
        try {
          const rolledBack = await sql('ROLLBACK');
          if (!Array.isArray(rolledBack.rows) || rolledBack.rows.length !== 0) discardRequired = true;
        } catch { discardRequired = true; }
      }
      // Cleanup errors never replace the original validated refusal.
      if (error instanceof CoverageFailure) throw error;
      throw new CoverageFailure('SOURCE_UNAVAILABLE', 'Coverage storage is temporarily unavailable.', true);
    } finally {
      deadline.close();
      try { if (discardRequired || !release) discard?.(); else release(); }
      catch { /* No driver or cleanup details leave the boundary. */ }
    }
  }

  return Object.freeze({
    async createOrReplay(value: CoverageStoredRun, suppliedAccess: CoverageStoreAccess): Promise<CoverageStoredRun> {
      const access = { scope: coverageSnapshot(suppliedAccess.scope), renew: suppliedAccess.renew };
      const run = validateCoverageStoredRun(value, access.scope);
      return transaction(access, async query => {
        const scope = access.scope;
        const partition = [scope.tenantId, scope.projectId, scope.environment, scope.billingMode];
        const prior = await query('SELECT tenant_id,project_id,environment,billing_mode,run_id,idempotency_key,input_hash,run_content FROM cost_intelligence.reconciliation_coverage_runs WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND idempotency_key=$5', [...partition, run.idempotencyKey]);
        if (prior.rows.length) {
          const existing = storedRun(prior.rows[0], access);
          if (existing.summary.inputHash !== run.summary.inputHash || existing.summary.runId !== run.summary.runId) throw new CoverageFailure('IDEMPOTENCY_CONFLICT', 'The reconciliation idempotency key has different immutable inputs.');
          return existing;
        }
        // Global-in-partition import identities cannot change normalized facts across different run keys.
        for (const entry of run.coverage) {
          const ref = entry.reference;
          const binding = [...partition, ref.sourceId, ref.importId, ref.revision];
          const imported = await query('SELECT tenant_id,project_id,environment,billing_mode,source_id,import_id,revision,content_hash,record_content FROM cost_intelligence.reconciliation_coverage_imports WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND source_id=$5 AND import_id=$6 AND revision=$7', binding);
          if (imported.rows.length) {
            const row = imported.rows[0]!;
            const record = row.record_content as CoverageImportRecord;
            if (!coverageRecordValid(record) || !coverageSamePartition(record.scope, scope) || row.tenant_id !== record.scope.tenantId || row.project_id !== record.scope.projectId
              || row.environment !== record.scope.environment || row.billing_mode !== record.scope.billingMode || row.source_id !== record.sourceId || row.import_id !== record.importId
              || String(row.revision) !== String(record.revision) || row.content_hash !== coverageHash(record)) throw invalidStorage();
            if (row.content_hash !== ref.contentHash) throw new CoverageFailure('IDEMPOTENCY_CONFLICT', 'The import identity has different immutable normalized content.');
          } else {
            await query('INSERT INTO cost_intelligence.reconciliation_coverage_imports (tenant_id,project_id,environment,billing_mode,source_id,import_id,revision,content_hash,record_content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)', [...binding, ref.contentHash, JSON.stringify(entry.record)]);
          }
        }
        await query('INSERT INTO cost_intelligence.reconciliation_coverage_runs (tenant_id,project_id,environment,billing_mode,run_id,idempotency_key,input_hash,run_content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [...partition, run.summary.runId, run.idempotencyKey, run.summary.inputHash, JSON.stringify(run)]);
        return run;
      });
    },
    async read(runId: string, suppliedAccess: CoverageStoreAccess): Promise<CoverageStoredRun | null> {
      const access = { scope: coverageSnapshot(suppliedAccess.scope), renew: suppliedAccess.renew };
      return transaction(access, async query => {
        const scope = access.scope;
        const result = await query('SELECT tenant_id,project_id,environment,billing_mode,run_id,idempotency_key,input_hash,run_content FROM cost_intelligence.reconciliation_coverage_runs WHERE tenant_id=$1 AND project_id=$2 AND environment=$3 AND billing_mode=$4 AND run_id=$5', [scope.tenantId, scope.projectId, scope.environment, scope.billingMode, runId]);
        if (!result.rows.length) return null;
        const run = storedRun(result.rows[0], access);
        if (!coverageSamePartition(run.scope, scope) || run.summary.runId !== runId) throw new CoverageFailure('SOURCE_UNAVAILABLE', 'Coverage storage returned invalid evidence.', true);
        return run;
      });
    },
  });
}
