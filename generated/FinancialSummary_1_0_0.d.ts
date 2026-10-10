import type { Brand } from "./brands.js";
export interface FinancialSummary {
    readonly contract: "FinancialSummary";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly event_id: Brand<string, "EventId">;
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly workflow_id?: Brand<string, "WorkflowId">;
    readonly run_id?: Brand<string, "RunId">;
    readonly job_id?: Brand<string, "JobId">;
    readonly artifact_id?: Brand<string, "ArtifactId">;
    readonly design_id?: Brand<string, "DesignId">;
    readonly design_version_id?: Brand<string, "DesignVersionId">;
    readonly order_id?: Brand<string, "OrderId">;
    readonly trace_id?: Brand<string, "TraceId">;
    readonly correlation_id: Brand<string, "CorrelationId">;
    readonly evidence_id?: Brand<string, "EvidenceId">;
    readonly usage_event_id?: Brand<string, "UsageEventId">;
    readonly logical_operation_id?: Brand<string, "LogicalOperationId">;
    readonly provider_attempt_id?: Brand<string, "ProviderAttemptId">;
    readonly billable_attempt_id?: Brand<string, "BillableAttemptId">;
    readonly transport_attempt_id?: Brand<string, "TransportAttemptId">;
    readonly provider_request_id?: Brand<string, "ProviderRequestId"> | null;
    readonly producer: {
        readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
        readonly source_revision: Brand<string, "SourceRevision">;
        readonly build_revision: string;
    };
    readonly occurred_at: Brand<string, "UtcTime">;
    readonly observed_at: Brand<string, "UtcTime">;
    readonly ingested_at: Brand<string, "UtcTime">;
    readonly environment: "development" | "test" | "production";
    readonly billing_mode: "live" | "sandbox" | "simulated";
    /**
     * @maxItems 100
     */
    readonly source_refs: readonly {
        readonly kind: "artifact" | "evidence" | "source_observation" | "provider_request" | "manifest";
        readonly id: string;
        readonly content_hash?: Brand<string, "Sha256">;
    }[];
    readonly summary_id: Brand<string, "SummaryId">;
    readonly revision: Brand<number, "Revision">;
    readonly period: {
        readonly start: Brand<string, "UtcTime">;
        readonly end: Brand<string, "UtcTime">;
    };
    readonly currency: Brand<string, "Currency">;
    readonly scale: number;
    readonly rounding: "none" | "half_even" | "half_up" | "towards_zero";
    readonly rounding_boundary: "none" | "ledger_posting" | "reporting_only";
    readonly valuation_basis: "unknown" | "estimated" | "provider_confirmed";
    readonly settlement: "unpaid" | "partly_paid" | "paid";
    readonly reconciliation: "unmatched" | "matched" | "exception";
    readonly reservation_state: "none" | "held" | "consumed" | "released" | "uncertain";
    readonly completeness: "unknown" | "incomplete" | "complete";
    /**
     * @minItems 1
     * @maxItems 3
     */
    readonly included_environments: [
        "development" | "test" | "production"
    ] | [
        "development" | "test" | "production",
        "development" | "test" | "production"
    ] | [
        "development" | "test" | "production",
        "development" | "test" | "production",
        "development" | "test" | "production"
    ];
    /**
     * @minItems 1
     * @maxItems 3
     */
    readonly included_billing_modes: [
        "live" | "sandbox" | "simulated"
    ] | [
        "live" | "sandbox" | "simulated",
        "live" | "sandbox" | "simulated"
    ] | [
        "live" | "sandbox" | "simulated",
        "live" | "sandbox" | "simulated",
        "live" | "sandbox" | "simulated"
    ];
    readonly coverage: {
        readonly observed: number;
        readonly expected: number | null;
        /**
         * @maxItems 100
         */
        readonly missing_sources: readonly string[];
    };
    readonly metrics: {
        readonly [k: string]: {
            readonly status: "known";
            readonly definition_ref: VersionedReference;
            readonly value: SignedMoney;
            /**
             * @maxItems 100
             */
            readonly source_refs: readonly VersionedReference1[];
        } | {
            readonly status: "unknown";
            readonly definition_ref: VersionedReference2;
            readonly value: null;
            /**
             * @maxItems 100
             */
            readonly source_refs: readonly VersionedReference1[];
        };
    };
    /**
     * @maxItems 100
     */
    readonly original_amounts: readonly SignedMoney1[];
    readonly conversion_ref: VersionedReference1 | null;
    readonly policy_ref: VersionedReference3;
    /**
     * @maxItems 100
     */
    readonly rate_card_refs: readonly VersionedReference1[];
    /**
     * @maxItems 100
     */
    readonly financial_event_refs: readonly {
        readonly kind: "refund" | "credit" | "reversal" | "payment" | "usage";
        readonly reference: VersionedReference4;
    }[];
}
export interface VersionedReference {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface SignedMoney {
    readonly amount: Brand<string, "SignedDecimal">;
    readonly currency: Brand<string, "Currency">;
    readonly scale: number;
}
export interface VersionedReference1 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference2 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface SignedMoney1 {
    readonly amount: Brand<string, "SignedDecimal">;
    readonly currency: Brand<string, "Currency">;
    readonly scale: number;
}
export interface VersionedReference3 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference4 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
