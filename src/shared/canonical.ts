import { canonicalJson, ContractError, validateContract, type ContractMap, type ContractName } from '@jevelopers/shared-contracts';
import { errorEnvelope, type ErrorEnvelope, type Validation } from './contracts.js';

/** Finance's legacy aliases elect this version independently of the SDK registry. */
export const LEGACY_CANONICAL_VERSIONS = Object.freeze({
  UsageEvent: '1.0.0', BudgetReservation: '1.0.0', ReserveRequest: '1.0.0',
  ReserveResult: '1.0.0', SettleRequest: '1.0.0', SettleResult: '1.0.0',
  ReleaseRequest: '1.0.0', ReleaseResult: '1.0.0', QueryRequest: '1.0.0',
  QueryResult: '1.0.0', FinancialSummary: '1.0.0', ErrorEnvelope: '1.0.0',
} as const);

export type LegacyCanonicalName = keyof typeof LEGACY_CANONICAL_VERSIONS;
export type CanonicalValue<K extends ContractName> = K extends LegacyCanonicalName
  ? Extract<ContractMap[K], { schema_version: '1.0.0' }>
  : ContractMap[K];

export type SharedUsageEvent = CanonicalValue<'UsageEvent'>;
export type SharedBudgetReservation = CanonicalValue<'BudgetReservation'>;
export type SharedReserveRequest = CanonicalValue<'ReserveRequest'>;
export type SharedReserveResult = CanonicalValue<'ReserveResult'>;
export type SharedSettleRequest = CanonicalValue<'SettleRequest'>;
export type SharedSettleResult = CanonicalValue<'SettleResult'>;
export type SharedReleaseRequest = CanonicalValue<'ReleaseRequest'>;
export type SharedReleaseResult = CanonicalValue<'ReleaseResult'>;
export type SharedQueryRequest = CanonicalValue<'QueryRequest'>;
export type SharedQueryResult = CanonicalValue<'QueryResult'>;
export type SharedFinancialSummary = CanonicalValue<'FinancialSummary'>;
export type SharedErrorEnvelope = CanonicalValue<'ErrorEnvelope'>;

function hasForeignLegacyVersion(contract: ContractName, value: unknown): boolean {
  if (!Object.hasOwn(LEGACY_CANONICAL_VERSIONS, contract)) return false;
  // Match the SDK's JSON-safety precedence before considering a version election.
  try { canonicalJson(value); } catch (error) {
    if (error instanceof ContractError) return false;
    throw error;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const version = Object.getOwnPropertyDescriptor(value, 'schema_version')?.value;
  return typeof version === 'string'
    && version !== LEGACY_CANONICAL_VERSIONS[contract as LegacyCanonicalName];
}

export function validateCanonical<K extends ContractName>(args: {
  contract: K;
  value: unknown;
  module: string;
  operation: string;
  requestId: string;
}): Validation<CanonicalValue<K>> {
  const result = validateContract(args.contract, args.value);
  const foreignVersion = hasForeignLegacyVersion(args.contract, args.value);
  if (result.ok && !foreignVersion) return { ok: true, value: result.value as CanonicalValue<K> };
  const unsupported = foreignVersion || (!result.ok && result.errors.some(issue => issue.code === 'UNSUPPORTED_VERSION'));
  const error: ErrorEnvelope = errorEnvelope(
    args.module,
    args.operation,
    unsupported ? 'UNSUPPORTED_VERSION' : 'VALIDATION_ERROR',
    args.requestId,
    unsupported ? 'The shared contract version is not supported.' : 'The shared contract payload does not match its pinned schema.',
  );
  return { ok: false, error };
}
