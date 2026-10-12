import { startReconciliation, getReconciliation, startCoverageDryRun, getCoverageDryRun, createPostgresCoverageRunStore } from '@jevelopers/cost-intelligence';
import type { ApiResult, RuntimePorts, ReconciliationRequest, ReconciliationRun, ReconciliationResult } from '@jevelopers/cost-intelligence';
import type { CoverageImportRecord, CoverageEntry, CoverageDryRunRequest, CoverageDryRunReadRequest, CoverageDryRunSummary, CoverageDryRunPage, ReconciliationCoveragePorts, PostgresCoverageDatabasePort, PostgresCoverageTransactionPort } from '@jevelopers/cost-intelligence/reconciliation';
import type { PostgresCoverageDatabasePort as RootCoverageDatabasePort } from '@jevelopers/cost-intelligence';

declare const legacy: ReconciliationRequest;
declare const legacyPorts: RuntimePorts;
declare const start: CoverageDryRunRequest;
declare const read: CoverageDryRunReadRequest;
declare const ports: ReconciliationCoveragePorts;
declare let imported: CoverageImportRecord;
declare let entry: CoverageEntry;
declare const database: PostgresCoverageDatabasePort;
declare const transaction: PostgresCoverageTransactionPort;
const rootDatabase: RootCoverageDatabasePort = database;
const postgresStore = createPostgresCoverageRunStore(rootDatabase);
transaction.discard();
// @ts-expect-error A release-only legacy pool cannot guarantee physical eviction.
createPostgresCoverageRunStore({ connect: async () => ({ query: transaction.query, release: transaction.release }) });

const legacyStart: Promise<ApiResult<ReconciliationRun>> = startReconciliation(legacy, legacyPorts);
const legacyRead: Promise<ApiResult<ReconciliationResult>> = getReconciliation(legacy, legacyPorts);
const coverageStart: Promise<ApiResult<CoverageDryRunSummary>> = startCoverageDryRun(start, ports);
const coverageRead: Promise<ApiResult<CoverageDryRunPage>> = getCoverageDryRun(read, ports);
// @ts-expect-error A coverage-only result is not a financial reconciliation result.
const inventedVariance: Promise<ApiResult<ReconciliationResult>> = getCoverageDryRun(read, ports);
// @ts-expect-error The import state is a finite vocabulary, not arbitrary strings.
imported.retrievalStatus = 'completed_and_billed';
// @ts-expect-error A provider grant cannot be inferred from an evidence mode.
imported.evidenceMode = 'authorized_live';
// @ts-expect-error Source verification status preserves its finite contract.
imported.verificationStatus = 'approved_by_caller';
// @ts-expect-error Coverage diagnostics cannot imply completed matching.
entry.gaps = ['financially_reconciled'];
// @ts-expect-error Coverage-only version does not support apply.
start.mode = 'apply';
// @ts-expect-error Legacy schema stays 1.0.0.
legacy.schemaVersion = '2.0.0';
void [legacyStart, legacyRead, coverageStart, coverageRead, inventedVariance, postgresStore];
