import type {
  ProviderReportedCostEvidence_1_0_0,
  UsageEvent_1_0_0,
  UsageEvent_2_0_0
} from '../generated/index.js';
import type {
  ProviderReportedUnsettledValuation,
  ProviderEvidenceLookup,
  UsageReportedContext
} from '../tooling/usage-reported-unsettled-api.js';
import { checkReportedUnsettledUsageEvent, providerReportedCostEvidenceContentHash } from '../tooling/usage-reported-unsettled-api.js';
import type { UsageContext } from '../generated/operations.js';

type Assert<T extends true> = T;
type Equal<Left, Right> = (<T>() => T extends Left ? 1 : 2) extends (<T>() => T extends Right ? 1 : 2) ? true : false;

type DirectValuation = Assert<Equal<ProviderReportedUnsettledValuation['rate_card_ref'], null>>;
type DirectUsdCurrency = Assert<ProviderReportedUnsettledValuation['money']['currency'] extends 'USD' ? true : false>;
type RejectsOtherCurrency = Assert<'EUR' extends ProviderReportedUnsettledValuation['money']['currency'] ? false : true>;
type DirectAmountNotNullable = Assert<null extends ProviderReportedUnsettledValuation['money'] ? false : true>;
type EvidenceUnknownMoneyNull = Assert<Equal<Extract<ProviderReportedCostEvidence_1_0_0['reported_cost'], {readonly state:'unknown'}>['money'], null>>;
type PerAttemptRequestNullable = Assert<null extends Extract<ProviderReportedCostEvidence_1_0_0['source_scope'], {readonly kind:'per_billable_attempt'}>['provider_request_id'] ? true : false>;
type AggregateHasNoAttemptID = Assert<'billable_attempt_id' extends keyof Extract<ProviderReportedCostEvidence_1_0_0['source_scope'], {readonly kind:'per_key_aggregate'}> ? false : true>;
type V1CannotRepresentNewBasis = Assert<Extract<UsageEvent_1_0_0['valuation'], {readonly basis:'provider_reported_unsettled'}> extends never ? true : false>;
type V1HelperPriorRemainsPinned = Assert<Equal<UsageContext['prior'], UsageEvent_1_0_0 | undefined>>;
type CandidateContextUsesV2 = Assert<Equal<UsageReportedContext['prior'], UsageEvent_2_0_0 | undefined>>;
type LookupHasNoVerificationBoolean = Assert<'verified' extends keyof ProviderEvidenceLookup ? false : true>;
type EvidenceIdentityReadonly = Assert<Equal<Pick<ProviderReportedCostEvidence_1_0_0,'evidence_id'>, {readonly evidence_id:ProviderReportedCostEvidence_1_0_0['evidence_id']}>>;

export type UsageReportedUnsettledTypeChecks = readonly [
  DirectValuation,
  DirectUsdCurrency,
  RejectsOtherCurrency,
  DirectAmountNotNullable,
  EvidenceUnknownMoneyNull,
  PerAttemptRequestNullable,
  AggregateHasNoAttemptID,
  V1CannotRepresentNewBasis,
  V1HelperPriorRemainsPinned,
  CandidateContextUsesV2,
  LookupHasNoVerificationBoolean,
  EvidenceIdentityReadonly
];

export function typedCandidateBoundary(value: unknown, context: UsageReportedContext): UsageEvent_2_0_0 | undefined {
  const result = checkReportedUnsettledUsageEvent(value, context);
  return result.ok ? result.value : undefined;
}
export type CandidateEvidenceHashInput = Parameters<typeof providerReportedCostEvidenceContentHash>[0];
