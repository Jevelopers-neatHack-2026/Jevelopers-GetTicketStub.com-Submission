import type { Brand } from "./brands.js";
export type UsageEvent = {
    readonly [k: string]: unknown;
} & {
    readonly contract: "UsageEvent";
    readonly schema_version: "2.0.0";
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
    readonly usage_event_id: Brand<string, "UsageEventId">;
    readonly logical_operation_id: Brand<string, "LogicalOperationId">;
    readonly provider_attempt_id: Brand<string, "ProviderAttemptId">;
    readonly billable_attempt_id: Brand<string, "BillableAttemptId">;
    readonly transport_attempt_id: Brand<string, "TransportAttemptId">;
    readonly provider_request_id: Brand<string, "ProviderRequestId"> | null;
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
    readonly source_observation_id: Brand<string, "SourceObservationId">;
    readonly provider: string;
    readonly model: string;
    readonly source: "provider_response" | "provider_usage_api" | "trace" | "billing_export" | "other";
    readonly completeness: "unknown" | "incomplete" | "complete";
    readonly usage_units: readonly {
        readonly name: string;
        readonly quantity: Brand<string, "ExactDecimal">;
        readonly scale: number;
        readonly relation: "standalone" | "included_subset" | "unknown_relation";
        readonly included_in?: string;
    }[] | null;
    /**
     * @maxItems 100
     */
    readonly missing_fields: readonly string[];
    readonly valuation: {
        readonly basis: "unknown";
        readonly money: null;
        readonly rate_card_ref: VersionedReference | null;
    } | {
        readonly basis: "estimated" | "provider_confirmed";
        readonly money: Money;
        readonly rate_card_ref: VersionedReference1;
    } | {
        readonly basis: "provider_reported_unsettled";
        readonly money: Money1 & {
            readonly currency: "USD";
        };
        readonly rate_card_ref: null;
        readonly provider_evidence_ref: VersionedReference2 & {
            readonly contract: "ProviderReportedCostEvidence";
            readonly schema_version: "1.0.0";
        };
    };
    readonly outcome: "succeeded" | "failed" | "partial" | "unknown" | "timeout" | "cancelled";
    readonly retry_mapping_ref: VersionedReference3;
    readonly supersedes_observation_id: Brand<string, "SourceObservationId"> | null;
    readonly reconciliation_ref: VersionedReference | null;
};
export interface VersionedReference {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface Money {
    readonly amount: Brand<string, "ExactDecimal">;
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
export interface Money1 {
    readonly amount: Brand<string, "ExactDecimal">;
    readonly currency: Brand<string, "Currency">;
    readonly scale: number;
}
export interface VersionedReference2 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference3 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
