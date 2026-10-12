import { authorizeFinanceOperation, errorEnvelope, failure, type ApiResult, type FinanceAuthorizationPort, type FinanceAuthorizationPrincipal, type TrustedScope } from '../shared/contracts.js';
import { coverageDeadline } from './coverage-deadline.js';
import {
  CoverageDryRunRequestSchema, CoverageDryRunReadRequestSchema, CoverageDryRunPageSchema, CoverageDryRunSummarySchema,
  CoverageFailure, coverageSnapshot, coverageCheck, coverageCanonical, coverageHash, coveragePartition, coverageSamePartition, coverageRecordValid,
  type CoverageDryRunRequest, type CoverageDryRunReadRequest, type CoverageDryRunSummary, type CoverageDryRunPage,
  type CoverageImportRecord, type CoverageEntry, type CoverageStoredRun, type ReconciliationCoveragePorts,
} from './coverage-types.js';

const unavailable = () => new CoverageFailure('SOURCE_UNAVAILABLE', 'Coverage source or storage is unavailable.', true);
const invalid = () => new CoverageFailure('VALIDATION_ERROR', 'The coverage-only reconciliation request is invalid.');
const denied = () => new CoverageFailure('FORBIDDEN_SCOPE', 'Current reconciliation authority changed or does not cover this operation.');
const same = (a: unknown, b: unknown) => coverageCanonical(a) === coverageCanonical(b);
export const coverageRunIdentity = (scope: TrustedScope, idempotencyKey: string) => coverageHash({ scope: coveragePartition(scope), idempotencyKey });
const ordered = <T>(values: readonly T[]) => [...values].sort((a, b) => coverageCanonical(a) < coverageCanonical(b) ? -1 : coverageCanonical(a) > coverageCanonical(b) ? 1 : 0);
export const coverageInputHash = (request: Pick<CoverageDryRunRequest, 'scope' | 'windowStart' | 'windowEnd' | 'sourceSnapshots'>) => coverageHash({ ruleVersion: 'ci07-coverage-1.0.0', scope: request.scope, windowStart: request.windowStart, windowEnd: request.windowEnd, sourceSnapshots: ordered(request.sourceSnapshots) });

function validate<T extends CoverageDryRunRequest | CoverageDryRunReadRequest>(value: unknown, read: boolean): T {
  let detached: unknown;
  try { detached = coverageSnapshot(value); } catch { throw invalid(); }
  if (typeof detached === 'object' && detached !== null && 'schemaVersion' in detached && detached.schemaVersion !== '2.0.0') throw new CoverageFailure('UNSUPPORTED_VERSION', 'This coverage-only boundary supports version 2.0.0.');
  if (!coverageCheck(read ? CoverageDryRunReadRequestSchema : CoverageDryRunRequestSchema, detached)) throw invalid();
  const request = detached as T;
  if ('windowStart' in request && (!Number.isFinite(Date.parse(request.windowStart)) || !Number.isFinite(Date.parse(request.windowEnd)) || Date.parse(request.windowStart) >= Date.parse(request.windowEnd))) throw invalid();
  return request;
}
export function validateCoverageDryRunRequestBoundary(value: unknown): ApiResult<CoverageDryRunRequest> { try { return { ok: true, value: validate<CoverageDryRunRequest>(value, false) }; } catch (error) { return refusal(error, false); } }
export function validateCoverageDryRunReadRequestBoundary(value: unknown): ApiResult<CoverageDryRunReadRequest> { try { return { ok: true, value: validate<CoverageDryRunReadRequest>(value, true) }; } catch (error) { return refusal(error, true); } }
export function validateCoverageImportRecordBoundary(value: unknown): ApiResult<CoverageImportRecord> {
  try { const record = coverageSnapshot(value) as CoverageImportRecord; if (!coverageRecordValid(record)) throw invalid(); return { ok: true, value: record }; } catch (error) { return refusal(error instanceof CoverageFailure ? error : invalid(), false); }
}
/** Hashes normalized metadata only. This neither reads original source bytes nor authenticates a provider. */
export function getCoverageImportContentHash(value: unknown): ApiResult<string> {
  const checked = validateCoverageImportRecordBoundary(value);
  return checked.ok ? { ok: true, value: coverageHash(checked.value) } : checked;
}

function guard(request: { requestId: string; scope: TrustedScope }, ports: ReconciliationCoveragePorts, read: boolean) {
  // Detach the raw response before shared validation. The helper and subsequent
  // continuity check must observe the same immutable decision, even across microtasks.
  const clock = { now: ports.clock.now.bind(ports.clock) };
  const authorizeCurrent = ports.financeAuthority?.authorizeCurrent.bind(ports.financeAuthority);
  const authority: FinanceAuthorizationPort | undefined = authorizeCurrent
    ? { authorizeCurrent: async command => coverageSnapshot(await authorizeCurrent(command)) }
    : undefined;
  const deadline = coverageDeadline();
  let principal: FinanceAuthorizationPrincipal | undefined;
  const renew = async () => {
    const result = await deadline.wait(() => authorizeFinanceOperation({ module: 'reconciliation', requestOperation: read ? 'getCoverageDryRun' : 'startCoverageDryRun',
      operation: read ? 'reconciliation.getReconciliation' : 'reconciliation.startReconciliation', scope: request.scope,
      requestId: request.requestId, clock, financeAuthority: authority }));
    if (!result.ok) throw new CoverageFailure(result.error.code, result.error.safe_message, result.error.retryable, result.error);
    if (!('principal' in result.decision) || result.decision.status !== 'allowed') throw denied();
    const current = coverageSnapshot(result.decision.principal);
    if (principal && !same(principal, current)) throw denied();
    principal ??= current;
  };
  return { renew, clock, sourceRead: <T>(operation: () => Promise<T>) => deadline.wait(operation) };
}

function buildCoverage(request: CoverageDryRunRequest, records: readonly CoverageImportRecord[]): CoverageEntry[] {
  const entries: CoverageEntry[] = records.map(record => {
    const gaps: CoverageEntry['gaps'] = [];
    if (record.sourceAccountRef === null) gaps.push('source_account_unknown');
    if (record.sourceProjectRef === null) gaps.push('source_project_unknown');
    if (record.currency === null) gaps.push('currency_unknown');
    if (record.verificationStatus !== 'verified') gaps.push('source_not_verified');
    if (!['complete', 'explicit_zero'].includes(record.retrievalStatus) || record.coverageStart === null
      || Date.parse(record.coverageStart) > Date.parse(request.windowStart) || Date.parse(record.coverageEnd!) < Date.parse(request.windowEnd)) gaps.push('incomplete_coverage');
    if (Date.parse(record.periodStart) < Date.parse(request.windowStart) || Date.parse(record.periodEnd) > Date.parse(request.windowEnd)) gaps.push('outside_requested_window');
    if (record.revision > 1) gaps.push('revision_requires_review');
    return { reference: { sourceId: record.sourceId, importId: record.importId, revision: record.revision, contentHash: coverageHash(record) }, record, gaps };
  });
  for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
    const a = entries[i]!; const b = entries[j]!;
    if (a.record.sourceAccountRef !== null && a.record.sourceProjectRef !== null && a.record.currency !== null
      && same([a.record.sourceId, a.record.sourceAccountRef, a.record.sourceProjectRef, a.record.currency], [b.record.sourceId, b.record.sourceAccountRef, b.record.sourceProjectRef, b.record.currency])
      && a.record.coverageStart !== null && b.record.coverageStart !== null
      && Date.parse(a.record.coverageStart) < Date.parse(b.record.coverageEnd!) && Date.parse(b.record.coverageStart) < Date.parse(a.record.coverageEnd!)) {
      if (!a.gaps.includes('overlapping_coverage')) a.gaps.push('overlapping_coverage');
      if (!b.gaps.includes('overlapping_coverage')) b.gaps.push('overlapping_coverage');
    }
  }
  return ordered(entries);
}

/** Reject malformed/aliased store output before it can disclose protected evidence. */
export function validateCoverageStoredRun(value: unknown, scope: TrustedScope): CoverageStoredRun {
  let run: CoverageStoredRun;
  try { run = coverageSnapshot(value) as CoverageStoredRun; } catch { throw unavailable(); }
  if (!run || typeof run !== 'object' || Object.keys(run).some(key => !['scope', 'idempotencyKey', 'windowStart', 'windowEnd', 'summary', 'coverage'].includes(key)) || !run.scope || !coverageSamePartition(scope, run.scope)
    || !coverageCheck(CoverageDryRunPageSchema, { ...run.summary, coverage: run.coverage, nextCursor: null })
    || run.summary.runId !== coverageRunIdentity(run.scope, run.idempotencyKey)
    || run.summary.sourceCount !== run.coverage.length) throw unavailable();
  const reconstructed = { schemaVersion: '2.0.0', mode: 'coverage_only', requestId: 'stored-validation', scope: run.scope, idempotencyKey: run.idempotencyKey,
    windowStart: run.windowStart, windowEnd: run.windowEnd, sourceSnapshots: run.coverage.map(entry => entry.reference) };
  if (!coverageCheck(CoverageDryRunRequestSchema, reconstructed) || Date.parse(run.windowStart) >= Date.parse(run.windowEnd)
    || coverageInputHash(reconstructed as CoverageDryRunRequest) !== run.summary.inputHash || run.summary.ownerReference !== run.scope.actorId) throw unavailable();
  const identities = run.coverage.map(entry => coverageCanonical([entry.reference.sourceId, entry.reference.importId, entry.reference.revision]));
  if (new Set(identities).size !== identities.length) throw unavailable();
  for (const entry of run.coverage) if (!coverageRecordValid(entry.record) || !coverageSamePartition(scope, entry.record.scope)
    || !same(entry.reference, { sourceId: entry.record.sourceId, importId: entry.record.importId, revision: entry.record.revision, contentHash: coverageHash(entry.record) })) throw unavailable();
  if (!same(run.coverage, buildCoverage(reconstructed as CoverageDryRunRequest, run.coverage.map(entry => entry.record)))) throw unavailable();
  return run;
}

function refusal(error: unknown, read: boolean): ApiResult<never> {
  const operation = read ? 'getCoverageDryRun' : 'startCoverageDryRun';
  if (error instanceof CoverageFailure) return failure(error.envelope ?? errorEnvelope('reconciliation', operation, error.code, 'coverage-request', error.safeMessage, error.retryable));
  return failure(errorEnvelope('reconciliation', operation, 'SOURCE_UNAVAILABLE', 'coverage-request', 'Coverage source or storage is unavailable.', true));
}
async function protectedStoreRead<T>(read: () => Promise<T>, renew: () => Promise<void>): Promise<T> {
  let result: T | undefined;
  let fault: unknown;
  let failed = false;
  try { result = coverageSnapshot(await read()); } catch (error) { failed = true; fault = error; }
  // A rejected or malformed response still crosses an asynchronous protected boundary.
  await renew();
  if (failed) throw fault instanceof CoverageFailure ? fault : unavailable();
  return result as T;
}

export async function startCoverageDryRun(value: CoverageDryRunRequest, ports: ReconciliationCoveragePorts): Promise<ApiResult<CoverageDryRunSummary>> {
  try {
    const request = validate<CoverageDryRunRequest>(value, false);
    const access = guard(request, ports, false);
    const reader = ports.coverageSource?.resolve.bind(ports.coverageSource);
    const create = ports.coverageStore?.createOrReplay.bind(ports.coverageStore);
    await access.renew();
    if (!reader || !create) throw unavailable();
    const records: CoverageImportRecord[] = [];
    for (const reference of ordered(request.sourceSnapshots)) {
      let resolved: Awaited<ReturnType<NonNullable<typeof reader>>> | undefined;
      try { resolved = coverageSnapshot(await access.sourceRead(() => reader(reference, request.scope))); } catch { /* Recheck current access even after failed source reads. */ }
      await access.renew();
      if (!resolved || resolved.status !== 'available') throw unavailable();
      const record = resolved.record as CoverageImportRecord;
      if (!coverageRecordValid(record) || !coverageSamePartition(request.scope, record.scope)
        || !same(reference, { sourceId: record.sourceId, importId: record.importId, revision: record.revision, contentHash: coverageHash(record) })) throw unavailable();
      records.push(record);
    }
    const coverage = buildCoverage(request, records);
    // Conflicting bytes under one source/import revision cannot be hidden in one request.
    const identities = coverage.map(entry => coverageCanonical([entry.reference.sourceId, entry.reference.importId, entry.reference.revision]));
    if (new Set(identities).size !== identities.length) throw new CoverageFailure('IDEMPOTENCY_CONFLICT', 'The import identity has conflicting content.');
    const now = access.clock.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable();
    const summary: CoverageDryRunSummary = { schemaVersion: '2.0.0', mode: 'coverage_only', status: 'needs_review',
      runId: coverageRunIdentity(request.scope, request.idempotencyKey), inputHash: coverageInputHash(request), ruleVersion: 'ci07-coverage-1.0.0',
      createdAt: now.toISOString(), sourceCount: coverage.length, ownerReference: request.scope.actorId,
      nextAction: 'review_coverage_and_supply_matching_and_apply_dependencies',
      unavailableStages: { matching: 'unavailable', financialVariance: 'unavailable', apply: 'unavailable', settlement: 'unavailable' }, financialEffects: false, billingAuthority: false };
    const candidate = coverageSnapshot({ scope: request.scope, idempotencyKey: request.idempotencyKey, windowStart: request.windowStart, windowEnd: request.windowEnd, summary, coverage });
    await access.renew();
    const stored = validateCoverageStoredRun(await protectedStoreRead(() => create(candidate, { scope: request.scope, renew: access.renew }), access.renew), request.scope);
    if (stored.summary.inputHash !== summary.inputHash || stored.summary.runId !== summary.runId) throw unavailable();
    return { ok: true, value: stored.summary };
  } catch (error) { return refusal(error, false); }
}

export async function getCoverageDryRun(value: CoverageDryRunReadRequest, ports: ReconciliationCoveragePorts): Promise<ApiResult<CoverageDryRunPage>> {
  try {
    const request = validate<CoverageDryRunReadRequest>(value, true);
    const access = guard(request, ports, true);
    const read = ports.coverageStore?.read.bind(ports.coverageStore);
    await access.renew();
    if (!read) throw unavailable();
    const result = await protectedStoreRead(() => read(request.runId, { scope: request.scope, renew: access.renew }), access.renew);
    if (result === null) throw new CoverageFailure('SOURCE_UNAVAILABLE', 'The coverage run is unavailable in this scope.');
    const run = validateCoverageStoredRun(result, request.scope);
    if (run.summary.runId !== request.runId) throw unavailable();
    const cursor = (offset: number) => `${offset}:${coverageHash({ scope: request.scope, runId: request.runId, inputHash: run.summary.inputHash, pageSize: request.pageSize, offset })}`;
    let offset = 0;
    if (request.cursor !== undefined) {
      offset = Number(request.cursor.split(':', 1)[0]);
      if (offset < 1 || offset >= run.coverage.length || offset % request.pageSize !== 0 || cursor(offset) !== request.cursor) throw invalid();
    }
    const end = Math.min(offset + request.pageSize, run.coverage.length);
    const page = coverageSnapshot({ ...run.summary, coverage: run.coverage.slice(offset, end), nextCursor: end < run.coverage.length ? cursor(end) : null });
    await access.renew();
    return { ok: true, value: page };
  } catch (error) { return refusal(error, true); }
}
