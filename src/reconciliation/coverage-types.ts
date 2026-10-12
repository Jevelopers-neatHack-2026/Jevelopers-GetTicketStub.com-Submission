import { createHash } from 'node:crypto';
import { Type, type Static, type TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { TrustedScopeSchema, CurrencySchema, type Clock, type ErrorCode, type ErrorEnvelope, type FinanceAuthorizationPort, type TrustedScope } from '../shared/contracts.js';

const Id = Type.String({ pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$', maxLength: 128 });
const Hash = Type.String({ pattern: '^sha256:[a-f0-9]{64}$' });
const Timestamp = Type.String({ format: 'date-time', maxLength: 40 });
const NullableId = Type.Union([Id, Type.Null()]);
const Partition = Type.Pick(TrustedScopeSchema, ['tenantId', 'projectId', 'environment', 'billingMode']);
/** contentHash binds canonical normalized record bytes, distinct from the original sourceArtifactHash. */
const Ref = Type.Object({ sourceId: Id, importId: Id, revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), contentHash: Hash }, { additionalProperties: false });
export const CoverageSnapshotReferenceSchema = Ref;
export type CoverageSnapshotReference = Static<typeof Ref>;

/** Finance-owned normalized metadata, not a provider wire format or a source-authentication assertion. */
export const CoverageImportRecordSchema = Type.Object({
  schemaVersion: Type.Literal('1.0.0'), sourceId: Id, importId: Id,
  revision: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }), predecessorHash: Type.Union([Hash, Type.Null()]),
  scope: Partition, sourceAccountRef: NullableId, sourceProjectRef: NullableId,
  currency: Type.Union([CurrencySchema, Type.Null()]),
  periodStart: Timestamp, periodEnd: Timestamp, timeZone: Type.String({ minLength: 1, maxLength: 64, pattern: '^[A-Za-z0-9_+/-]+$' }),
  coverageStart: Type.Union([Timestamp, Type.Null()]), coverageEnd: Type.Union([Timestamp, Type.Null()]),
  sourceArtifactHash: Type.Union([Hash, Type.Null()]), adapterVersion: Id, sourceSchemaVersion: Id,
  cursorRef: NullableId, retrievedAt: Timestamp,
  retrievalStatus: Type.Union((['complete', 'no_data', 'delayed', 'incomplete', 'explicit_zero', 'failed'] as const).map(value => Type.Literal(value))),
  recordCount: Type.Union([Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }), Type.Null()]),
  zeroEvidenceRef: NullableId,
  evidenceMode: Type.Union((['mocked', 'sandbox', 'live'] as const).map(value => Type.Literal(value))),
  verificationStatus: Type.Union((['verified', 'unverified', 'unknown'] as const).map(value => Type.Literal(value))),
}, { additionalProperties: false });
export type CoverageImportRecord = Static<typeof CoverageImportRecordSchema>;

const Base = { schemaVersion: Type.Literal('2.0.0'), mode: Type.Literal('coverage_only'), requestId: Id, scope: TrustedScopeSchema };
export const CoverageDryRunRequestSchema = Type.Object({
  ...Base, idempotencyKey: Id, windowStart: Timestamp, windowEnd: Timestamp,
  sourceSnapshots: Type.Array(Ref, { minItems: 1, maxItems: 100, uniqueItems: true }),
}, { additionalProperties: false });
export type CoverageDryRunRequest = Static<typeof CoverageDryRunRequestSchema>;
export const CoverageDryRunReadRequestSchema = Type.Object({
  ...Base, runId: Hash, pageSize: Type.Integer({ minimum: 1, maximum: 100 }),
  cursor: Type.Optional(Type.String({ pattern: '^[0-9]{1,3}:sha256:[a-f0-9]{64}$', maxLength: 75 })),
}, { additionalProperties: false });
export type CoverageDryRunReadRequest = Static<typeof CoverageDryRunReadRequestSchema>;

const UnavailableStages = Type.Object({
  matching: Type.Literal('unavailable'), financialVariance: Type.Literal('unavailable'),
  apply: Type.Literal('unavailable'), settlement: Type.Literal('unavailable'),
}, { additionalProperties: false });
export const CoverageDryRunSummarySchema = Type.Object({
  schemaVersion: Type.Literal('2.0.0'), mode: Type.Literal('coverage_only'), status: Type.Literal('needs_review'),
  runId: Hash, inputHash: Hash, ruleVersion: Type.Literal('ci07-coverage-1.0.0'), createdAt: Timestamp,
  sourceCount: Type.Integer({ minimum: 1, maximum: 100 }),
  ownerReference: TrustedScopeSchema.properties.actorId, nextAction: Type.Literal('review_coverage_and_supply_matching_and_apply_dependencies'),
  unavailableStages: UnavailableStages, financialEffects: Type.Literal(false), billingAuthority: Type.Literal(false),
}, { additionalProperties: false });
export type CoverageDryRunSummary = Static<typeof CoverageDryRunSummarySchema>;
export const CoverageDryRunPageSchema = Type.Object({
  ...CoverageDryRunSummarySchema.properties,
  coverage: Type.Array(Type.Object({
    reference: Ref, record: CoverageImportRecordSchema,
    gaps: Type.Array(Type.Union((['source_account_unknown', 'source_project_unknown', 'currency_unknown', 'source_not_verified', 'incomplete_coverage', 'outside_requested_window', 'overlapping_coverage', 'revision_requires_review'] as const).map(value => Type.Literal(value))), { uniqueItems: true }),
  }, { additionalProperties: false }), { maxItems: 100 }),
  nextCursor: Type.Union([Type.String({ pattern: '^[0-9]{1,3}:sha256:[a-f0-9]{64}$' }), Type.Null()]),
}, { additionalProperties: false });
export type CoverageDryRunPage = Static<typeof CoverageDryRunPageSchema>;
export type CoverageEntry = CoverageDryRunPage['coverage'][number];

export interface CoverageImportReaderPort {
  /** Server-owned adapter: independently read the exact immutable import, verify its original artifact commitment and current source access. Never mount a caller-provided resolver or copy request flags as verification. */
  resolve(reference: CoverageSnapshotReference, scope: TrustedScope): Promise<{ readonly status: 'available'; readonly record: unknown } | { readonly status: 'unavailable' }>;
}
export interface CoverageStoredRun {
  readonly scope: TrustedScope;
  readonly idempotencyKey: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly summary: CoverageDryRunSummary;
  readonly coverage: readonly CoverageEntry[];
}
export interface CoverageStoreAccess {
  readonly scope: TrustedScope;
  /** Must be called inside the transaction immediately before writes/commit, after reads, and even on replay/not-found paths. Throws a safe refusal when current authority changes. */
  readonly renew: () => Promise<void>;
}
export interface CoverageRunStorePort {
  createOrReplay(run: CoverageStoredRun, access: CoverageStoreAccess): Promise<CoverageStoredRun>;
  read(runId: string, access: CoverageStoreAccess): Promise<CoverageStoredRun | null>;
}
export interface ReconciliationCoveragePorts {
  readonly clock: Clock;
  readonly financeAuthority?: FinanceAuthorizationPort;
  readonly coverageSource?: CoverageImportReaderPort;
  readonly coverageStore?: CoverageRunStorePort;
}

export class CoverageFailure extends Error {
  constructor(readonly code: ErrorCode, readonly safeMessage: string, readonly retryable = false, readonly envelope?: ErrorEnvelope) { super(safeMessage); }
}

/** Bounded plain JSON snapshots prevent accessors, retained aliases and mutable scope from crossing an await. */
export function coverageSnapshot<T>(input: T): T {
  let nodes = 0;
  let bytes = 0;
  const consume = (amount: number) => { bytes += amount; if (bytes > 512 * 1024) throw new Error('Invalid snapshot size.'); };
  function copy(value: unknown, depth: number): unknown {
    if (++nodes > 30_000 || depth > 16) throw new Error('Invalid snapshot size.');
    if (value === null || typeof value === 'boolean') { consume(5); return value; }
    if (typeof value === 'number' && Number.isFinite(value)) { consume(32); return value; }
    if (typeof value === 'string' && value.length <= 4096) { consume(new TextEncoder().encode(JSON.stringify(value)).byteLength); return value; }
    if (typeof value !== 'object' || value === null) throw new Error('Invalid snapshot value.');
    const array = Array.isArray(value);
    const proto = Object.getPrototypeOf(value);
    if (proto !== (array ? Array.prototype : Object.prototype) && proto !== null) throw new Error('Invalid snapshot object.');
    const keys = Reflect.ownKeys(value);
    consume(2 + keys.length);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
      if (!Number.isInteger(length) || (length as number) < 0 || (length as number) > 1024 || keys.length !== (length as number) + 1) throw new Error('Invalid array length.');
      for (let i = 0; i < (length as number); i++) if (!Object.hasOwn(value, String(i))) throw new Error('Sparse arrays are invalid.');
    }
    if (keys.length > (array ? 1025 : 64) || keys.some(key => typeof key !== 'string' || key.length > 128)) throw new Error('Invalid snapshot keys.');
    const result: Record<string, unknown> | unknown[] = array ? [] : Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (array && key === 'length') continue;
      if (!array) consume(new TextEncoder().encode(JSON.stringify(key)).byteLength + 1);
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new Error('Invalid snapshot property.');
      if (array && !/^(0|[1-9][0-9]*)$/.test(key as string)) throw new Error('Invalid array property.');
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true });
    }
    return Object.freeze(result);
  }
  const result = copy(input, 0) as T;
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 512 * 1024) throw new Error('Invalid snapshot size.');
  return result;
}
export function coverageCanonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(coverageCanonical).join(',') + ']';
  if (typeof value === 'object' && value !== null) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + coverageCanonical((value as Record<string, unknown>)[key])).join(',') + '}';
  return JSON.stringify(value) as string;
}
export function coverageHash(value: unknown): string { return 'sha256:' + createHash('sha256').update(coverageCanonical(value), 'utf8').digest('hex'); }
export function coveragePartition(scope: TrustedScope | CoverageImportRecord['scope']) { return { tenantId: scope.tenantId, projectId: scope.projectId, environment: scope.environment, billingMode: scope.billingMode }; }
export function coverageSamePartition(a: TrustedScope | CoverageImportRecord['scope'], b: TrustedScope | CoverageImportRecord['scope']): boolean { return coverageCanonical(coveragePartition(a)) === coverageCanonical(coveragePartition(b)); }
export function coverageCheck<T>(schema: TSchema, value: unknown): value is T { try { return Value.Check(schema, value); } catch { return false; } }
export function coverageRecordValid(record: CoverageImportRecord): boolean {
  if (!coverageCheck(CoverageImportRecordSchema, record) || !Number.isFinite(Date.parse(record.periodStart)) || !Number.isFinite(Date.parse(record.periodEnd)) || Date.parse(record.periodStart) >= Date.parse(record.periodEnd) || !Number.isFinite(Date.parse(record.retrievedAt))) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: record.timeZone }); } catch { return false; }
  if ((record.coverageStart === null) !== (record.coverageEnd === null)) return false;
  if (record.coverageStart !== null && (Date.parse(record.coverageStart) >= Date.parse(record.coverageEnd!) || Date.parse(record.coverageStart) < Date.parse(record.periodStart) || Date.parse(record.coverageEnd!) > Date.parse(record.periodEnd))) return false;
  if (record.revision === 1 && record.predecessorHash !== null) return false;
  if (record.revision > 1 && record.predecessorHash === null) return false;
  if (record.retrievalStatus === 'explicit_zero') return record.recordCount === 0 && record.zeroEvidenceRef !== null && record.sourceArtifactHash !== null && record.coverageStart !== null;
  if (record.zeroEvidenceRef !== null) return false;
  if (['no_data', 'delayed', 'failed'].includes(record.retrievalStatus)) return record.recordCount === null && record.coverageStart === null;
  return record.retrievalStatus !== 'complete' || (record.recordCount !== null && record.recordCount > 0 && record.sourceArtifactHash !== null && record.coverageStart !== null);
}
