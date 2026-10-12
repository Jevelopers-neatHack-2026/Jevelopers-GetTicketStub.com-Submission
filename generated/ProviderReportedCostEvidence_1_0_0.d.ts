import type { Brand } from "./brands.js";
export interface ProviderReportedCostEvidence {
    readonly contract: "ProviderReportedCostEvidence";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly evidence_id: Brand<string, "EvidenceId">;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly environment: "development" | "test" | "production";
    readonly billing_mode: "live" | "sandbox" | "simulated";
    readonly source_observation_id: Brand<string, "SourceObservationId">;
    readonly provider: string;
    readonly model: string;
    readonly source: "provider_response" | "provider_usage_api" | "trace" | "billing_export" | "other";
    readonly source_observed_at: Brand<string, "UtcTime">;
    readonly source_bytes_hash: Brand<string, "Sha256">;
    readonly source_scope: {
        readonly kind: "per_billable_attempt";
        readonly logical_operation_id: Brand<string, "LogicalOperationId">;
        readonly provider_attempt_id: Brand<string, "ProviderAttemptId">;
        readonly billable_attempt_id: Brand<string, "BillableAttemptId">;
        readonly provider_request_id: Brand<string, "ProviderRequestId"> | null;
    } | {
        readonly kind: "per_key_aggregate";
        readonly aggregate_key: string;
        readonly period_start: Brand<string, "UtcTime">;
        readonly period_end: Brand<string, "UtcTime">;
    };
    readonly reported_cost: {
        readonly state: "known";
        readonly money: Money & {
            readonly currency: "USD";
        };
    } | {
        readonly state: "unknown";
        readonly money: null;
    };
}
export interface Money {
    readonly amount: Brand<string, "ExactDecimal">;
    readonly currency: Brand<string, "Currency">;
    readonly scale: number;
}
