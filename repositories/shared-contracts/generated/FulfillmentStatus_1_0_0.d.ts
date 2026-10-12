import type { Brand } from "./brands.js";
export interface FulfillmentStatus {
    readonly contract: "FulfillmentStatus";
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
    readonly order_id: Brand<string, "OrderId">;
    readonly trace_id?: Brand<string, "TraceId">;
    readonly correlation_id: Brand<string, "CorrelationId">;
    readonly evidence_id?: Brand<string, "EvidenceId">;
    readonly usage_event_id?: Brand<string, "UsageEventId">;
    readonly logical_operation_id?: Brand<string, "LogicalOperationId">;
    readonly provider_attempt_id: Brand<string, "ProviderAttemptId">;
    readonly billable_attempt_id: Brand<string, "BillableAttemptId">;
    readonly transport_attempt_id: Brand<string, "TransportAttemptId">;
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
    readonly provider: string;
    readonly supplier_order_id: string | null;
    readonly bundle_ref: VersionedReference;
    readonly authorization_ref: VersionedReference1;
    readonly external_idempotency_key: string;
    readonly source_observation_id: Brand<string, "SourceObservationId">;
    readonly revision: number;
    readonly normalized_status: "created" | "submission_pending" | "unknown" | "accepted" | "rejected" | "in_production" | "shipped" | "fulfilled" | "cancel_requested" | "cancelled" | "cancel_rejected";
    readonly provider_status: string;
    readonly last_known_status: ("created" | "submission_pending" | "unknown" | "accepted" | "rejected" | "in_production" | "shipped" | "fulfilled" | "cancel_requested" | "cancelled" | "cancel_rejected") | null;
    readonly submission_outcome: "not_submitted" | "accepted" | "rejected" | "unknown";
    readonly execution_uncertainty: "known" | "in_flight" | "unknown";
    readonly cancellation: "not_requested" | "requested" | "confirmed" | "rejected" | "unknown";
    readonly effective_at: Brand<string, "UtcTime">;
    readonly error_ref: VersionedReference2 | null;
    /**
     * @minItems 0
     * @maxItems 100
     */
    readonly usage_refs: readonly VersionedReference2[];
}
export interface VersionedReference {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
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
