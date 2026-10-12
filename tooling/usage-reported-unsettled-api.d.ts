import type {
  ErrorEnvelope,
  ProviderReportedCostEvidence_1_0_0,
  TrustedContext,
  UtcTime,
  UsageEvent_2_0_0,
  ValidationCode
} from '../generated/index.js';

export type UsageReportedCode = ValidationCode | ErrorEnvelope['error']['code'];
export type UsageReportedResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly { readonly code: UsageReportedCode; readonly path: string; readonly keyword?: string }[] };

export type ProviderReportedUnsettledValuation =
  Extract<UsageEvent_2_0_0['valuation'], { readonly basis: 'provider_reported_unsettled' }>;
export type ProviderEvidenceReference = ProviderReportedUnsettledValuation['provider_evidence_ref'];
export type ProviderEvidenceLookup =
  | {
      readonly status: 'resolved';
      readonly expected_reference: ProviderEvidenceReference;
      readonly record: ProviderReportedCostEvidence_1_0_0;
      readonly source_bytes_hash: ProviderReportedCostEvidence_1_0_0['source_bytes_hash'];
      readonly resolved_at: UtcTime;
    }
  | {
      readonly status: 'missing' | 'revoked' | 'unverified';
      readonly expected_reference: ProviderEvidenceReference;
      readonly resolved_at: UtcTime;
    };

export type UsageReportedContext = {
  readonly scope: TrustedContext;
  readonly now: UtcTime;
  readonly policy_version: '1.0.0';
  readonly environment: UsageEvent_2_0_0['environment'];
  readonly billing_mode: UsageEvent_2_0_0['billing_mode'];
  readonly references: Readonly<Record<string, NonNullable<ErrorEnvelope['error']['diagnostic_ref']>>>;
  readonly evidence_lookup: ProviderEvidenceLookup;
  readonly prior?: UsageEvent_2_0_0;
};

export type UsageReportedRelationship =
  | 'duplicate_observation'
  | 'superseding_observation'
  | 'superseded_observation'
  | 'same_execution'
  | 'distinct_billable_attempt';

export declare function providerReportedCostEvidenceContentHash(
  value: Omit<ProviderReportedCostEvidence_1_0_0, 'content_hash'> | ProviderReportedCostEvidence_1_0_0
): ProviderReportedCostEvidence_1_0_0['content_hash'];
export declare function checkProviderReportedCostEvidence(
  value: unknown
): UsageReportedResult<ProviderReportedCostEvidence_1_0_0>;
export declare function checkReportedUnsettledUsageEvent(
  value: unknown,
  context: UsageReportedContext
): UsageReportedResult<UsageEvent_2_0_0>;
export declare function compareReportedUnsettledUsageIdentity(
  left: unknown,
  right: unknown
): UsageReportedResult<UsageReportedRelationship>;
