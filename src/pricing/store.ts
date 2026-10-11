import {
  errorEnvelope,
  failure,
  sameScope,
  success,
  validateRequest,
  type ApiResult,
  type ErrorEnvelope,
  type TrustedContextPort,
  type TrustedScope,
  type Validation,
} from '../shared/contracts.js';
import { compare, utcMicros } from './exact.js';
import {
  RegisterFxRateRequestSchema,
  RegisterPricingRuleRequestSchema,
  RegisterRateCardRequestSchema,
  type CatalogWriteReceipt,
  type FxRate,
  type PricingRule,
  type RateCard,
  type RegisterFxRateRequest,
  type RegisterPricingRuleRequest,
  type RegisterRateCardRequest,
  type VersionedReference,
} from './schemas.js';

export interface PricingQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number | null;
}
/** Structural subset implemented by a node-postgres PoolClient. */
export interface PricingTransactionPort {
  query(text: string, values?: readonly unknown[]): Promise<PricingQueryResult>;
  release(): void;
}

/** The host injects an existing pool; pricing never creates a hidden connection. */
export interface PricingDatabasePort {
  connect(): Promise<PricingTransactionPort>;
}

export interface ResolvedContractTime {
  readonly reference: VersionedReference;
  readonly effectiveAt: string;
  readonly verified: true;
}

/** A host authority must resolve contract time from an authorized, versioned source. */
export interface ContractTimeAuthorityPort {
  resolve(scope: TrustedScope, reference: VersionedReference): Promise<ResolvedContractTime | null>;
}

export interface PricingRuntimePorts {
  readonly database: PricingDatabasePort;
  readonly trustedContext: TrustedContextPort;
  readonly clock: { now(): Date };
  readonly contractTimeAuthority?: ContractTimeAuthorityPort;
}

export interface StoredVersion<T> {
  readonly value: T;
  readonly reference: VersionedReference;
  readonly publishedAt: string;
}

export interface PricingCatalogSnapshot {
  readonly rateCards: readonly StoredVersion<RateCard>[];
  readonly rules: readonly StoredVersion<PricingRule>[];
  readonly fxRates: readonly StoredVersion<FxRate>[];
}

const scopeColumns = ['tenant_id', 'project_id', 'environment', 'billing_mode'] as const;

function requestIdOf(value: unknown): string {
  return typeof value === 'object' && value !== null && 'requestId' in value && typeof value.requestId === 'string'
    ? value.requestId : 'unavailable';
}

function asString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString();
  throw new Error('Pricing database returned an unexpected value.');
}

function rowValue(row: Record<string, unknown>, key: string): string {
  return asString(row[key]);
}

function safeError(operation: string, code: ErrorEnvelope['code'], requestId: string, message: string, retryable = false): ErrorEnvelope {
  return errorEnvelope('pricing', operation, code, requestId, message, retryable);
}

function validationFailure(operation: string, requestId: string, message: string): Validation<never> {
  return { ok: false, error: safeError(operation, 'VALIDATION_ERROR', requestId, message) };
}

function idempotencyFailure(operation: string, requestId: string): ErrorEnvelope {
  return safeError(operation, 'IDEMPOTENCY_CONFLICT', requestId, 'The idempotency key is already bound to different pricing content.');
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(object).sort().map(key => [key, normalizeValue(object[key])]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeValue(value));
}

async function hashContent(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return 'sha256:' + hex;
}

function reference(contract: string, id: string, revision: number, contentHash: string): VersionedReference {
  return { contract, schema_version: '1.0.0', id, revision, content_hash: contentHash };
}

function sameReference(left: VersionedReference, right: VersionedReference): boolean {
  return left.contract === right.contract && left.schema_version === right.schema_version && left.id === right.id
    && left.revision === right.revision && left.content_hash === right.content_hash;
}

function scopeValues(scope: TrustedScope): unknown[] {
  return [scope.tenantId, scope.projectId, scope.environment, scope.billingMode];
}

async function authorize(
  scope: TrustedScope,
  ports: PricingRuntimePorts,
  operation: string,
  requestId: string,
): Promise<ErrorEnvelope | null> {
  try {
    const resolved = await ports.trustedContext.resolve(scope);
    if (!resolved || !sameScope(resolved, scope)) {
      return safeError(operation, 'FORBIDDEN_SCOPE', requestId, 'The requested financial scope is not authorized.');
    }
    return null;
  } catch {
    return safeError(operation, 'SOURCE_UNAVAILABLE', requestId, 'Trusted pricing scope is temporarily unavailable.', true);
  }
}

function timestampRangeIsValid(from: string, to: string | null): boolean {
  const start = utcMicros(from);
  const end = to === null ? null : utcMicros(to);
  return start !== null && (to === null || (end !== null && end > start));
}

function decimalParts(value: string): { numerator: bigint; denominator: bigint } {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,18}))?$/.exec(value);
  if (!match) throw new Error('A catalog decimal failed schema validation.');
  const fraction = match[2] ?? '';
  const denominator = 10n ** BigInt(fraction.length);
  return { numerator: BigInt(match[1] ?? '0') * denominator + BigInt(fraction || '0'), denominator };
}

function rateCardSemanticError(card: RateCard): string | null {
  if (!timestampRangeIsValid(card.effectiveFrom, card.effectiveTo) || utcMicros(card.retrievedAt) === null) {
    return 'Rate-card timestamps must be valid UTC instants with a nonempty effective interval.';
  }
  if (card.pricingRuleRef.contract !== 'PricingRule') return 'A rate card must reference a versioned pricing rule.';
  const seenCategories = new Set<string>();
  const seenAliases = new Set<string>([card.modelOrSku]);
  for (const alias of card.aliases) {
    if (seenAliases.has(alias)) return 'A rate card cannot repeat its canonical model or an alias.';
    seenAliases.add(alias);
  }
  for (const unitRate of card.unitRates) {
    if (seenCategories.has(unitRate.category)) return 'Rate-card unit categories must be unique.';
    seenCategories.add(unitRate.category);
    if (decimalParts(unitRate.basisQuantity).numerator === 0n) return 'Every unit rate must declare a positive exact basis quantity.';
    if (unitRate.relation === 'included_subset' && !unitRate.includedIn) {
      return 'Included rate subsets must identify their parent category.';
    }
    if (unitRate.relation !== 'included_subset' && unitRate.includedIn !== undefined) {
      return 'Only included rate subsets may identify a parent category.';
    }
  }
  return null;
}

function ruleSemanticError(rule: PricingRule): string | null {
  if (!timestampRangeIsValid(rule.effectiveFrom, rule.effectiveTo) || utcMicros(rule.retrievedAt) === null) {
    return 'Pricing-rule timestamps must be valid UTC instants with a nonempty effective interval.';
  }
  const byName = new Map(rule.usageUnits.map(unit => [unit.name, unit]));
  if (byName.size !== rule.usageUnits.length) return 'Pricing-rule usage-unit names must be unique.';
  for (const unit of rule.usageUnits) {
    if (unit.treatment === 'charge_total' && (unit.relation !== 'standalone' || unit.category === null)) {
      return 'A directly charged usage unit needs a standalone relation and a rate category.';
    }
    if (unit.treatment === 'charge_residual' && (unit.relation !== 'standalone' || unit.category === null)) {
      return 'A residual usage unit needs a standalone relation and a rate category.';
    }
    if (unit.treatment === 'charge_subset' && (unit.relation !== 'included_subset' || !unit.includedIn || unit.category === null)) {
      return 'A separately rated usage subset needs its parent usage unit and a rate category.';
    }
    if (unit.treatment === 'included' && (unit.relation !== 'included_subset' || !unit.includedIn || unit.category !== null)) {
      return 'An included usage subset must identify its parent and cannot have a separate rate category.';
    }
    if (unit.treatment === 'unsupported' && unit.category !== null) {
      return 'Unsupported usage dimensions cannot map to a rate category.';
    }
    if (unit.includedIn !== undefined) {
      const parent = byName.get(unit.includedIn);
      if (!parent || parent.relation !== 'standalone' || parent.unit !== unit.unit) {
        return 'Usage subsets must name an existing same-unit standalone parent.';
      }
    }
  }
  return null;
}

function fxSemanticError(fx: FxRate): string | null {
  if (!timestampRangeIsValid(fx.effectiveFrom, fx.effectiveTo) || utcMicros(fx.retrievedAt) === null) {
    return 'FX timestamps must be valid UTC instants with a nonempty effective interval.';
  }
  if (fx.sourceCurrency === fx.targetCurrency || /^0(?:\.0+)?$/.test(fx.rate)) {
    return 'FX evidence needs distinct currencies and a positive exact rate.';
  }
  return null;
}

function scopeSql(): string {
  return scopeColumns.map((column, index) => column + ' = $' + (index + 1)).join(' AND ');
}

function parseStored<T>(row: Record<string, unknown>, payloadColumn: string, contract: string): StoredVersion<T> {
  const raw = row[payloadColumn];
  const value = (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
  return {
    value,
    reference: reference(contract, rowValue(row, 'record_id'), Number(row.record_revision), rowValue(row, 'content_hash')),
    publishedAt: rowValue(row, 'published_at'),
  };
}

function useClock(ports: PricingRuntimePorts, operation: string, requestId: string): { now: Date; iso: string } | { error: ErrorEnvelope } {
  try {
    const now = ports.clock.now();
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error('invalid clock');
    return { now, iso: now.toISOString() };
  } catch {
    return { error: safeError(operation, 'SOURCE_UNAVAILABLE', requestId, 'The trusted pricing clock is temporarily unavailable.', true) };
  }
}

async function findIdempotency(
  client: PricingTransactionPort,
  table: string,
  idColumn: string,
  scope: TrustedScope,
  idempotencyKey: string,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    'SELECT request_payload_hash, ' + idColumn + ' AS record_id, record_revision, content_hash FROM cost_intelligence.' + table
      + ' WHERE ' + scopeSql() + ' AND idempotency_key = $5',
    [...scopeValues(scope), idempotencyKey],
  );
  return result.rows[0] ?? null;
}

function existingReceipt(requestId: string, contract: string, row: Record<string, unknown>): CatalogWriteReceipt {
  return {
    schemaVersion: '1.0.0',
    requestId,
    status: 'duplicate',
    reference: reference(contract, rowValue(row, 'record_id'), Number(row.record_revision), rowValue(row, 'content_hash')),
    durableCommit: true,
  };
}

function newReceipt(requestId: string, ref: VersionedReference): CatalogWriteReceipt {
  return { schemaVersion: '1.0.0', requestId, status: 'accepted', reference: ref, durableCommit: true };
}

async function lookupRule(client: PricingTransactionPort, scope: TrustedScope, ref: VersionedReference): Promise<PricingRule | null> {
  const result = await client.query(
    'SELECT rule_payload FROM cost_intelligence.pricing_rule_versions WHERE ' + scopeSql()
      + ' AND rule_id = $5 AND record_revision = $6 AND content_hash = $7',
    [...scopeValues(scope), ref.id, ref.revision, ref.content_hash],
  );
  if (result.rowCount !== 1) return null;
  const raw = result.rows[0]?.rule_payload;
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as PricingRule;
}

async function revisionRows(
  client: PricingTransactionPort,
  table: string,
  idColumn: string,
  scope: TrustedScope,
  id: string,
): Promise<Record<string, unknown>[]> {
  const result = await client.query(
    "SELECT record_revision, to_char(effective_from AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS effective_from,"
      + " to_char(effective_to AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS effective_to FROM cost_intelligence." + table
      + ' WHERE ' + scopeSql() + ' AND ' + idColumn + ' = $5 ORDER BY record_revision FOR UPDATE',
    [...scopeValues(scope), id],
  );
  return [...result.rows];
}

async function validateNextRevision(
  client: PricingTransactionPort,
  table: string,
  idColumn: string,
  scope: TrustedScope,
  id: string,
  revision: number,
  effectiveFrom: string,
  effectiveTo: string | null,
): Promise<string | null> {
  const rows = await revisionRows(client, table, idColumn, scope, id);
  const maxRevision = rows.reduce((maximum, row) => Math.max(maximum, Number(row.record_revision)), 0);
  if (revision !== maxRevision + 1) return 'Catalog revisions must be appended sequentially without gaps.';
  if (rows.length > 0) {
    const previous = rows[rows.length - 1];
    if (!previous) return 'The prior catalog revision could not be read.';
    const previousStart = utcMicros(rowValue(previous, 'effective_from'));
    const nextStart = utcMicros(effectiveFrom);
    const previousEndRaw = previous.effective_to;
    const previousEnd = previousEndRaw === null || previousEndRaw === undefined ? null : utcMicros(asString(previousEndRaw));
    if (previousStart === null || nextStart === null || nextStart <= previousStart) {
      return 'A new catalog revision must begin after its prior revision.';
    }
    if (previousEnd !== null && previousEnd > nextStart) return 'A new revision overlaps the explicit end of its predecessor.';
    if (effectiveTo !== null && utcMicros(effectiveTo)! <= nextStart) return 'A catalog revision has an empty effective interval.';
  }
  return null;
}

async function idempotentConflictOrReplay(
  client: PricingTransactionPort,
  table: string,
  idColumn: string,
  scope: TrustedScope,
  idempotencyKey: string,
  payloadHash: string,
  requestId: string,
  operation: string,
  contract: string,
): Promise<CatalogWriteReceipt | ErrorEnvelope | null> {
  const row = await findIdempotency(client, table, idColumn, scope, idempotencyKey);
  if (!row) return null;
  if (rowValue(row, 'request_payload_hash') !== payloadHash) return idempotencyFailure(operation, requestId);
  return existingReceipt(requestId, contract, row);
}

async function byVersion(
  client: PricingTransactionPort,
  table: string,
  idColumn: string,
  scope: TrustedScope,
  id: string,
  revision: number,
): Promise<Record<string, unknown> | null> {
  const result = await client.query(
    'SELECT record_revision, content_hash FROM cost_intelligence.' + table
      + ' WHERE ' + scopeSql() + ' AND ' + idColumn + ' = $5 AND record_revision = $6',
    [...scopeValues(scope), id, revision],
  );
  return result.rows[0] ?? null;
}

function storedRef(contract: string, id: string, revision: number, hash: string): VersionedReference {
  return reference(contract, id, revision, hash);
}

interface InsertArgs {
  readonly client: PricingTransactionPort;
  readonly table: string;
  readonly scope: TrustedScope;
  readonly actorId: string;
  readonly idColumn: string;
  readonly id: string;
  readonly revision: number;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly contentHash: string;
  readonly publishedAt: string;
  readonly retrievedAt: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly provider?: string | undefined;
  readonly product?: string | undefined;
  readonly source?: string | undefined;
  readonly modelOrSku?: string | undefined;
  readonly aliases?: readonly string[] | undefined;
  readonly contextTier?: string | null | undefined;
  readonly serviceTier?: string | null | undefined;
  readonly reasoningMode?: string | null | undefined;
  readonly toolClass?: string | null | undefined;
  readonly currency?: string | undefined;
  readonly sourceCurrency?: string | undefined;
  readonly targetCurrency?: string | undefined;
  readonly ruleId?: string | undefined;
  readonly ruleRevision?: number | undefined;
  readonly ruleHash?: string | undefined;
  readonly payloadColumn: string;
  readonly payload: unknown;
}

async function insertVersion(args: InsertArgs): Promise<void> {
  const columns = [
    ...scopeColumns,
    'actor_id', args.idColumn, 'record_revision', 'content_hash', 'idempotency_key', 'request_payload_hash',
    'published_at', 'retrieved_at', 'effective_from', 'effective_to',
    ...(args.provider !== undefined ? ['provider'] : []),
    ...(args.product !== undefined ? ['product'] : []),
    ...(args.source !== undefined ? ['usage_source'] : []),
    ...(args.modelOrSku !== undefined ? ['model_or_sku'] : []),
    ...(args.aliases !== undefined ? ['aliases'] : []),
    ...(args.contextTier !== undefined ? ['context_tier'] : []),
    ...(args.serviceTier !== undefined ? ['service_tier'] : []),
    ...(args.reasoningMode !== undefined ? ['reasoning_mode'] : []),
    ...(args.toolClass !== undefined ? ['tool_class'] : []),
    ...(args.currency !== undefined ? ['currency'] : []),
    ...(args.sourceCurrency !== undefined ? ['source_currency'] : []),
    ...(args.targetCurrency !== undefined ? ['target_currency'] : []),
    ...(args.ruleId !== undefined ? ['pricing_rule_id', 'pricing_rule_revision', 'pricing_rule_hash'] : []),
    args.payloadColumn,
  ];
  const values: unknown[] = [
    ...scopeValues(args.scope),
    args.actorId,
    args.id,
    args.revision,
    args.contentHash,
    args.idempotencyKey,
    args.payloadHash,
    args.publishedAt,
    args.retrievedAt,
    args.effectiveFrom,
    args.effectiveTo,
    ...(args.provider !== undefined ? [args.provider] : []),
    ...(args.product !== undefined ? [args.product] : []),
    ...(args.source !== undefined ? [args.source] : []),
    ...(args.modelOrSku !== undefined ? [args.modelOrSku] : []),
    ...(args.aliases !== undefined ? [args.aliases] : []),
    ...(args.contextTier !== undefined ? [args.contextTier] : []),
    ...(args.serviceTier !== undefined ? [args.serviceTier] : []),
    ...(args.reasoningMode !== undefined ? [args.reasoningMode] : []),
    ...(args.toolClass !== undefined ? [args.toolClass] : []),
    ...(args.currency !== undefined ? [args.currency] : []),
    ...(args.sourceCurrency !== undefined ? [args.sourceCurrency] : []),
    ...(args.targetCurrency !== undefined ? [args.targetCurrency] : []),
    ...(args.ruleId !== undefined ? [args.ruleId, args.ruleRevision, args.ruleHash] : []),
    canonicalJson(args.payload),
  ];
  const placeholders = values.map((_, index) => '$' + (index + 1));
  placeholders[columns.length - 1] = '$' + values.length + '::jsonb';
  await args.client.query(
    'INSERT INTO cost_intelligence.' + args.table + ' (' + columns.join(', ') + ') VALUES (' + placeholders.join(', ') + ')',
    values,
  );
}

async function runInsert<T extends { id: string; revision: number; retrievedAt: string; effectiveFrom: string; effectiveTo: string | null }>(args: {
  requestId: string;
  operation: string;
  scope: TrustedScope;
  actorId: string;
  item: T;
  ports: PricingRuntimePorts;
  table: string;
  idColumn: string;
  payloadColumn: string;
  contract: string;
  idempotencyKey: string;
  payload: unknown;
  payloadHash: string;
  contentHash: string;
  provider?: string | undefined;
  product?: string | undefined;
  source?: string | undefined;
  modelOrSku?: string | undefined;
  aliases?: readonly string[] | undefined;
  contextTier?: string | null | undefined;
  serviceTier?: string | null | undefined;
  reasoningMode?: string | null | undefined;
  toolClass?: string | null | undefined;
  currency?: string | undefined;
  sourceCurrency?: string | undefined;
  targetCurrency?: string | undefined;
  ruleId?: string | undefined;
  ruleRevision?: number | undefined;
  ruleHash?: string | undefined;
  lockKey: string;
  validateAppend: (client: PricingTransactionPort) => Promise<string | null>;
}): Promise<ApiResult<CatalogWriteReceipt>> {
  const clock = useClock(args.ports, args.operation, args.requestId);
  if ('error' in clock) return failure(clock.error);
  const retrievedAt = utcMicros(args.item.retrievedAt);
  const nowMicros = BigInt(clock.now.getTime()) * 1000n;
  if (retrievedAt === null || retrievedAt > nowMicros) {
    return failure(safeError(args.operation, 'VALIDATION_ERROR', args.requestId, 'Source retrieval time cannot be invalid or in the future.'));
  }
  let client: PricingTransactionPort | undefined;
  let inTransaction = false;
  try {
    client = await args.ports.database.connect();
    await client.query('BEGIN');
    inTransaction = true;
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [args.lockKey]);
    const replay = await idempotentConflictOrReplay(
      client, args.table, args.idColumn, args.scope, args.idempotencyKey,
      args.payloadHash, args.requestId, args.operation, args.contract,
    );
    if (replay) {
      if ('status' in replay) {
        await client.query('COMMIT');
        inTransaction = false;
        return success(replay);
      }
      await client.query('ROLLBACK');
      inTransaction = false;
      return failure(replay);
    }
    const existing = await byVersion(client, args.table, args.idColumn, args.scope, args.item.id, args.item.revision);
    if (existing) {
      if (rowValue(existing, 'content_hash') === args.contentHash) {
        await client.query('COMMIT');
        inTransaction = false;
        return success({
          schemaVersion: '1.0.0', requestId: args.requestId, status: 'duplicate',
          reference: storedRef(args.contract, args.item.id, args.item.revision, args.contentHash), durableCommit: true,
        });
      }
      await client.query('ROLLBACK');
      inTransaction = false;
      return failure(safeError(args.operation, 'IDEMPOTENCY_CONFLICT', args.requestId, 'A catalog identity and revision are already bound to different immutable content.'));
    }
    const appendError = await args.validateAppend(client);
    if (appendError) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return failure(safeError(args.operation, 'VALIDATION_ERROR', args.requestId, appendError));
    }
    await insertVersion({
      client,
      table: args.table,
      scope: args.scope,
      actorId: args.actorId,
      idColumn: args.idColumn,
      id: args.item.id,
      revision: args.item.revision,
      idempotencyKey: args.idempotencyKey,
      payloadHash: args.payloadHash,
      contentHash: args.contentHash,
      publishedAt: clock.iso,
      retrievedAt: args.item.retrievedAt,
      effectiveFrom: args.item.effectiveFrom,
      effectiveTo: args.item.effectiveTo,
      provider: args.provider,
      product: args.product,
      source: args.source,
      modelOrSku: args.modelOrSku,
      aliases: args.aliases,
      contextTier: args.contextTier,
      serviceTier: args.serviceTier,
      reasoningMode: args.reasoningMode,
      toolClass: args.toolClass,
      currency: args.currency,
      sourceCurrency: args.sourceCurrency,
      targetCurrency: args.targetCurrency,
      ruleId: args.ruleId,
      ruleRevision: args.ruleRevision,
      ruleHash: args.ruleHash,
      payloadColumn: args.payloadColumn,
      payload: args.payload,
    });
    await client.query('COMMIT');
    inTransaction = false;
    return success(newReceipt(args.requestId, storedRef(args.contract, args.item.id, args.item.revision, args.contentHash)));
  } catch {
    if (client && inTransaction) await client.query('ROLLBACK').catch(() => {});
    return failure(safeError(args.operation, 'SOURCE_UNAVAILABLE', args.requestId, 'The immutable pricing catalog is temporarily unavailable.', true));
  } finally {
    client?.release();
  }
}

function validateRegistrationRequest<T>(schema: object, value: unknown, operation: string): Validation<T> {
  return validateRequest(schema as never, value, 'pricing', operation) as Validation<T>;
}

export function validatePricingRuleBoundary(value: unknown): Validation<RegisterPricingRuleRequest> {
  const parsed = validateRegistrationRequest<RegisterPricingRuleRequest>(RegisterPricingRuleRequestSchema, value, 'registerPricingRule');
  if (!parsed.ok) return parsed;
  if (ruleSemanticError(parsed.value.rule)) return validationFailure('registerPricingRule', parsed.value.requestId, 'The versioned pricing rule has invalid usage or inclusion semantics.');
  return parsed;
}

export function validateRateCardBoundary(value: unknown): Validation<RegisterRateCardRequest> {
  const parsed = validateRegistrationRequest<RegisterRateCardRequest>(RegisterRateCardRequestSchema, value, 'registerRateCard');
  if (!parsed.ok) return parsed;
  if (rateCardSemanticError(parsed.value.rateCard)) return validationFailure('registerRateCard', parsed.value.requestId, 'The versioned rate card has invalid interval, alias, unit-basis, or subset semantics.');
  return parsed;
}

export function validateFxRateBoundary(value: unknown): Validation<RegisterFxRateRequest> {
  const parsed = validateRegistrationRequest<RegisterFxRateRequest>(RegisterFxRateRequestSchema, value, 'registerFxRate');
  if (!parsed.ok) return parsed;
  if (fxSemanticError(parsed.value.fxRate)) return validationFailure('registerFxRate', parsed.value.requestId, 'The FX record needs distinct currencies, a positive rate, and a valid interval.');
  return parsed;
}

export async function registerPricingRule(value: RegisterPricingRuleRequest, ports: PricingRuntimePorts): Promise<ApiResult<CatalogWriteReceipt>> {
  const validation = validatePricingRuleBoundary(value);
  if (!validation.ok) return failure(validation.error);
  const request = validation.value;
  const denied = await authorize(request.scope, ports, 'registerPricingRule', request.requestId);
  if (denied) return failure(denied);
  const now = useClock(ports, 'registerPricingRule', request.requestId);
  if ('error' in now) return failure(now.error);
  const item = request.rule;
  if (utcMicros(item.retrievedAt)! > BigInt(now.now.getTime()) * 1000n) {
    return failure(safeError('registerPricingRule', 'VALIDATION_ERROR', request.requestId, 'Source retrieval time cannot be in the future.'));
  }
  const payloadHash = await hashContent({ rule: item });
  const contentHash = await hashContent(item);
  const ref = reference('PricingRule', item.id, item.revision, contentHash);
  return runInsert({
    requestId: request.requestId, operation: 'registerPricingRule', scope: request.scope,
    actorId: request.scope.actorId, item, ports, table: 'pricing_rule_versions', idColumn: 'rule_id',
    payloadColumn: 'rule_payload', contract: 'PricingRule', idempotencyKey: request.idempotencyKey, payload: item, payloadHash, contentHash,
    provider: item.provider, product: item.product, source: item.usageSource,
    lockKey: JSON.stringify([request.scope.tenantId, request.scope.projectId, request.scope.environment, request.scope.billingMode, 'pricing-rule', item.id]),
    validateAppend: client => validateNextRevision(
      client, 'pricing_rule_versions', 'rule_id', request.scope, item.id, item.revision, item.effectiveFrom, item.effectiveTo,
    ),
  }).then(result => {
    if (result.ok && !sameReference(result.value.reference, ref)) return failure(safeError('registerPricingRule', 'SOURCE_UNAVAILABLE', request.requestId, 'The persisted pricing rule reference could not be verified.'));
    return result;
  });
}

function cardSelectorKey(card: RateCard): string {
  return JSON.stringify([card.provider, card.product, card.contextTier, card.serviceTier, card.reasoningMode, card.toolClass]);
}

function modelNames(card: RateCard): Set<string> {
  return new Set([card.modelOrSku, ...card.aliases]);
}

function intervalsOverlap(startA: bigint, endA: bigint | null, startB: bigint, endB: bigint | null): boolean {
  return (endA === null || startB < endA) && (endB === null || startA < endB);
}

async function validateRateCardAppend(
  client: PricingTransactionPort,
  request: RegisterRateCardRequest,
): Promise<string | null> {
  const card = request.rateCard;
  const rule = await lookupRule(client, request.scope, card.pricingRuleRef);
  if (!rule) return 'A rate card must reference an immutable pricing rule already present in this financial scope.';
  if (rule.provider !== card.provider || rule.product !== card.product) return 'The referenced pricing rule must match the rate-card provider and product.';
  const cardStart = utcMicros(card.effectiveFrom);
  const ruleStart = utcMicros(rule.effectiveFrom);
  const cardEnd = card.effectiveTo === null ? null : utcMicros(card.effectiveTo);
  const ruleEnd = rule.effectiveTo === null ? null : utcMicros(rule.effectiveTo);
  if (cardStart === null || ruleStart === null || cardStart < ruleStart
    || (ruleEnd !== null && (cardEnd === null || cardEnd > ruleEnd))) {
    return 'The rate-card effective interval must be contained in its referenced rule interval.';
  }
  const ownRevisions = await revisionRows(client, 'pricing_rate_card_versions', 'card_id', request.scope, card.id);
  const currentError = await validateNextRevision(
    client, 'pricing_rate_card_versions', 'card_id', request.scope, card.id, card.revision, card.effectiveFrom, card.effectiveTo,
  );
  if (currentError) return currentError;
  if (ownRevisions.length > 0) {
    const previous = await client.query(
      'SELECT rate_card_payload FROM cost_intelligence.pricing_rate_card_versions WHERE ' + scopeSql()
        + ' AND card_id = $5 ORDER BY record_revision DESC LIMIT 1',
      [...scopeValues(request.scope), card.id],
    );
    const raw = previous.rows[0]?.rate_card_payload;
    const prior = (typeof raw === 'string' ? JSON.parse(raw) : raw) as RateCard;
    if (cardSelectorKey(prior) !== cardSelectorKey(card) || prior.modelOrSku !== card.modelOrSku || prior.currency !== card.currency) {
      return 'A rate-card identity must retain provider, product, model selector, tier dimensions, and currency across revisions.';
    }
  }
  const allRows = await client.query(
    'SELECT card_id AS record_id, record_revision, content_hash, published_at::text AS published_at, rate_card_payload'
      + ' FROM cost_intelligence.pricing_rate_card_versions WHERE ' + scopeSql() + ' AND provider = $5 AND product = $6',
    [...scopeValues(request.scope), card.provider, card.product],
  );
  const groups = new Map<string, StoredVersion<RateCard>[]>();
  for (const row of allRows.rows) {
    const stored = parseStored<RateCard>(row, 'rate_card_payload', 'RateCard');
    const list = groups.get(stored.value.id) ?? [];
    list.push(stored);
    groups.set(stored.value.id, list);
  }
  const candidateStart = utcMicros(card.effectiveFrom)!;
  const candidateEnd = card.effectiveTo === null ? null : utcMicros(card.effectiveTo)!;
  const candidateModels = modelNames(card);
  for (const [otherId, versions] of groups) {
    if (otherId === card.id) continue;
    versions.sort((left, right) => left.value.revision - right.value.revision);
    for (let index = 0; index < versions.length; index += 1) {
      const existing = versions[index]?.value;
      if (!existing || cardSelectorKey(existing) !== cardSelectorKey(card)) continue;
      const existingModels = modelNames(existing);
      if (![...candidateModels].some(model => existingModels.has(model))) continue;
      const existingStart = utcMicros(existing.effectiveFrom);
      const explicitEnd = existing.effectiveTo === null ? null : utcMicros(existing.effectiveTo);
      const nextStart = versions[index + 1] ? utcMicros(versions[index + 1]!.value.effectiveFrom) : null;
      const existingEnd = explicitEnd === null ? nextStart : nextStart === null || explicitEnd < nextStart ? explicitEnd : nextStart;
      if (existingStart !== null && intervalsOverlap(candidateStart, candidateEnd, existingStart, existingEnd)) {
        return 'Rate-card selection would overlap another immutable model, alias, tier, or service version.';
      }
    }
  }
  return null;
}

export async function registerRateCard(value: RegisterRateCardRequest, ports: PricingRuntimePorts): Promise<ApiResult<CatalogWriteReceipt>> {
  const validation = validateRateCardBoundary(value);
  if (!validation.ok) return failure(validation.error);
  const request = validation.value;
  const denied = await authorize(request.scope, ports, 'registerRateCard', request.requestId);
  if (denied) return failure(denied);
  const card = request.rateCard;
  const payloadHash = await hashContent({ rateCard: card });
  const contentHash = await hashContent(card);
  const ref = reference('RateCard', card.id, card.revision, contentHash);
  return runInsert({
    requestId: request.requestId, operation: 'registerRateCard', scope: request.scope,
    actorId: request.scope.actorId, item: card, ports, table: 'pricing_rate_card_versions', idColumn: 'card_id',
    payloadColumn: 'rate_card_payload', contract: 'RateCard', idempotencyKey: request.idempotencyKey, payload: card, payloadHash, contentHash,
    provider: card.provider, product: card.product, modelOrSku: card.modelOrSku, aliases: card.aliases,
    contextTier: card.contextTier, serviceTier: card.serviceTier, reasoningMode: card.reasoningMode,
    toolClass: card.toolClass, currency: card.currency, ruleId: card.pricingRuleRef.id,
    ruleRevision: card.pricingRuleRef.revision, ruleHash: card.pricingRuleRef.content_hash,
    lockKey: JSON.stringify([request.scope.tenantId, request.scope.projectId, request.scope.environment, request.scope.billingMode, 'rate-card-selector', card.provider, card.product]),
    validateAppend: client => validateRateCardAppend(client, request),
  }).then(result => {
    if (result.ok && !sameReference(result.value.reference, ref)) return failure(safeError('registerRateCard', 'SOURCE_UNAVAILABLE', request.requestId, 'The persisted rate-card reference could not be verified.'));
    return result;
  });
}

async function validateFxRateAppend(client: PricingTransactionPort, scope: TrustedScope, rate: FxRate): Promise<string | null> {
  const result = await client.query(
    'SELECT fx_rate_id AS record_id, record_revision, content_hash, published_at::text AS published_at, fx_rate_payload'
      + ' FROM cost_intelligence.pricing_fx_rate_versions WHERE ' + scopeSql()
      + ' AND source_currency = $5 AND target_currency = $6',
    [...scopeValues(scope), rate.sourceCurrency, rate.targetCurrency],
  );
  const existing = result.rows.map(row => parseStored<FxRate>(row, 'fx_rate_payload', 'FxRate'));
  for (const stored of existing) {
    const prior = stored.value;
    if (prior.id === rate.id) continue;
    const priorStart = utcMicros(prior.effectiveFrom);
    const priorEnd = prior.effectiveTo === null ? null : utcMicros(prior.effectiveTo);
    const candidateStart = utcMicros(rate.effectiveFrom)!;
    const candidateEnd = rate.effectiveTo === null ? null : utcMicros(rate.effectiveTo);
    if (priorStart !== null && intervalsOverlap(candidateStart, candidateEnd, priorStart, priorEnd)) {
      return 'FX selection would overlap another immutable source-to-target currency version.';
    }
  }
  return validateNextRevision(client, 'pricing_fx_rate_versions', 'fx_rate_id', scope, rate.id, rate.revision, rate.effectiveFrom, rate.effectiveTo);
}

export async function registerFxRate(value: RegisterFxRateRequest, ports: PricingRuntimePorts): Promise<ApiResult<CatalogWriteReceipt>> {
  const validation = validateFxRateBoundary(value);
  if (!validation.ok) return failure(validation.error);
  const request = validation.value;
  const denied = await authorize(request.scope, ports, 'registerFxRate', request.requestId);
  if (denied) return failure(denied);
  const fx = request.fxRate;
  const payloadHash = await hashContent({ fxRate: fx });
  const contentHash = await hashContent(fx);
  const ref = reference('FxRate', fx.id, fx.revision, contentHash);
  return runInsert({
    requestId: request.requestId, operation: 'registerFxRate', scope: request.scope,
    actorId: request.scope.actorId, item: fx, ports, table: 'pricing_fx_rate_versions', idColumn: 'fx_rate_id',
    payloadColumn: 'fx_rate_payload', contract: 'FxRate', idempotencyKey: request.idempotencyKey, payload: fx, payloadHash, contentHash,
    sourceCurrency: fx.sourceCurrency, targetCurrency: fx.targetCurrency,
    lockKey: JSON.stringify([request.scope.tenantId, request.scope.projectId, request.scope.environment, request.scope.billingMode, 'fx-selector', fx.sourceCurrency, fx.targetCurrency]),
    validateAppend: client => validateFxRateAppend(client, request.scope, fx),
  }).then(result => {
    if (result.ok && !sameReference(result.value.reference, ref)) return failure(safeError('registerFxRate', 'SOURCE_UNAVAILABLE', request.requestId, 'The persisted FX reference could not be verified.'));
    return result;
  });
}

export async function loadPricingCatalog(
  scope: TrustedScope,
  provider: string,
  product: string,
  targetCurrency: string,
  effectiveAt: string,
  ports: PricingRuntimePorts,
): Promise<PricingCatalogSnapshot> {
  const client = await ports.database.connect();
  let inTransaction = false;
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    inTransaction = true;
    const params = scopeValues(scope);
    const cards = await client.query(
      'SELECT card_id AS record_id, record_revision, content_hash, published_at::text AS published_at, rate_card_payload'
        + ' FROM cost_intelligence.pricing_rate_card_versions WHERE ' + scopeSql()
        + ' AND provider = $5 AND product = $6 AND published_at <= $7::timestamptz AND retrieved_at <= $7::timestamptz'
        + ' ORDER BY card_id, record_revision',
      [...params, provider, product, effectiveAt],
    );
    const rules = await client.query(
      'SELECT rule_id AS record_id, record_revision, content_hash, published_at::text AS published_at, rule_payload'
        + ' FROM cost_intelligence.pricing_rule_versions WHERE ' + scopeSql()
        + ' AND published_at <= $5::timestamptz AND retrieved_at <= $5::timestamptz ORDER BY rule_id, record_revision',
      [...params, effectiveAt],
    );
    const fxRates = await client.query(
      'SELECT fx_rate_id AS record_id, record_revision, content_hash, published_at::text AS published_at, fx_rate_payload'
        + ' FROM cost_intelligence.pricing_fx_rate_versions WHERE ' + scopeSql()
        + ' AND target_currency = $5 AND published_at <= $6::timestamptz AND retrieved_at <= $6::timestamptz'
        + ' ORDER BY fx_rate_id, record_revision',
      [...params, targetCurrency, effectiveAt],
    );
    await client.query('COMMIT');
    inTransaction = false;
    return {
      rateCards: cards.rows.map(row => parseStored<RateCard>(row, 'rate_card_payload', 'RateCard')),
      rules: rules.rows.map(row => parseStored<PricingRule>(row, 'rule_payload', 'PricingRule')),
      fxRates: fxRates.rows.map(row => parseStored<FxRate>(row, 'fx_rate_payload', 'FxRate')),
    };
  } catch (error) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
