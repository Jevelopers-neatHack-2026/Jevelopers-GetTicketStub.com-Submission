import type { Brand } from "./brands.js";
export interface ResearchBatchReceipt {
    readonly contract: "ResearchBatchReceipt";
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
    readonly receipt_id: Brand<string, "ResearchBatchReceiptId">;
    readonly batch_id: Brand<string, "BatchId">;
    /**
     * @minItems 1
     * @maxItems 64
     */
    readonly request_ids: readonly [
        Brand<string, "RequestId">,
        ...readonly Brand<string, "RequestId">[]
    ];
    /**
     * @minItems 1
     * @maxItems 64
     */
    readonly request_receipt_refs: readonly [
        VersionedReference,
        ...readonly VersionedReference[]
    ];
    /**
     * @minItems 0
     * @maxItems 64
     */
    readonly answer_receipt_refs: readonly VersionedReference[];
    readonly acceptance_policy: "partial" | "all_or_nothing";
    /**
     * @minItems 0
     * @maxItems 64
     */
    readonly successful_request_ids: readonly Brand<string, "RequestId">[];
    /**
     * @minItems 0
     * @maxItems 64
     */
    readonly failed_request_ids: readonly Brand<string, "RequestId">[];
    /**
     * @minItems 0
     * @maxItems 64
     */
    readonly pending_request_ids: readonly Brand<string, "RequestId">[];
    readonly policy_ref: VersionedReference1;
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
