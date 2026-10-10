import type { Brand } from "./brands.js";
export interface PartialFailure {
    readonly contract: "PartialFailure";
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
    readonly batch_id: Brand<string, "BatchId">;
    readonly policy_ref: VersionedReference;
    readonly acceptance_policy: "partial" | "all_or_nothing";
    /**
     * @maxItems 100
     */
    readonly successful_item_ids: readonly string[];
    /**
     * @maxItems 100
     */
    readonly failures: readonly {
        readonly item_id: string;
        readonly error: {
            readonly code: "MALFORMED_JSON";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference1;
        } | {
            readonly code: "INVALID_PAYLOAD";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference2;
        } | {
            readonly code: "UNSUPPORTED_VERSION";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference3;
        } | {
            readonly code: "UNKNOWN_ENUM";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference4;
        } | {
            readonly code: "SCOPE_MISMATCH";
            readonly category: "authorization";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference5;
        } | {
            readonly code: "STALE_APPROVAL";
            readonly category: "authorization";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference6;
        } | {
            readonly code: "UNSUPPORTED_CASE";
            readonly category: "unsupported";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference7;
        } | {
            readonly code: "CANCELLED";
            readonly category: "cancellation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference8;
        } | {
            readonly code: "TIMEOUT";
            readonly category: "timeout";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference9;
        } | {
            readonly code: "RATE_LIMIT";
            readonly category: "availability";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference10;
        } | {
            readonly code: "PARTIAL_FAILURE";
            readonly category: "partial";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference11;
        } | {
            readonly code: "UNKNOWN_SIDE_EFFECT";
            readonly category: "uncertainty";
            readonly safe_message: "Outcome remains unknown.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference12;
        } | {
            readonly code: "UNKNOWN_USAGE";
            readonly category: "uncertainty";
            readonly safe_message: "Outcome remains unknown.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference13;
        } | {
            readonly code: "INVALID_TRANSITION";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference14;
        } | {
            readonly code: "STALE_REVISION";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference15;
        } | {
            readonly code: "REVISION_CONFLICT";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference16;
        } | {
            readonly code: "INVALID_BATCH";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference17;
        } | {
            readonly code: "INVALID_DISTRIBUTION";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference18;
        } | {
            readonly code: "INVALID_RECEIPT";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference19;
        } | {
            readonly code: "REFERENCE_MISMATCH";
            readonly category: "authorization";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference20;
        } | {
            readonly code: "UNCERTAIN_EXECUTION";
            readonly category: "uncertainty";
            readonly safe_message: "Outcome remains unknown.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference21;
        } | {
            readonly code: "CURRENCY_MISMATCH";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference22;
        } | {
            readonly code: "INVALID_MONEY";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference23;
        } | {
            readonly code: "PROFILE_UNREPRESENTABLE";
            readonly category: "unsupported";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference24;
        } | {
            readonly code: "CYCLIC_DEPENDENCY";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference25;
        } | {
            readonly code: "DEPENDENT_BATCH";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference26;
        } | {
            readonly code: "POLICY_MISMATCH";
            readonly category: "authorization";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference27;
        } | {
            readonly code: "TERMINAL_JOB";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference28;
        } | {
            readonly code: "IDENTITY_COLLISION";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference29;
        } | {
            readonly code: "OBSERVATION_CONFLICT";
            readonly category: "validation";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference30;
        } | {
            readonly code: "EXPIRED";
            readonly category: "authorization";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference31;
        } | {
            readonly code: "BUDGET_UNAVAILABLE";
            readonly category: "availability";
            readonly safe_message: "Request cannot be completed.";
            readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly operation: string;
            readonly retryable: boolean;
            readonly blocking_condition: "none" | "review" | "authorization" | "budget" | "reconciliation" | "dependency";
            readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
            readonly usage_state: "complete" | "incomplete" | "unknown";
            /**
             * @maxItems 100
             */
            readonly validation_paths: readonly string[];
            readonly diagnostic_ref?: VersionedReference32;
        };
    }[];
    /**
     * @maxItems 100
     */
    readonly unprocessed_item_ids: readonly string[];
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
export interface VersionedReference5 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference6 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference7 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference8 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference9 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference10 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference11 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference12 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference13 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference14 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference15 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference16 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference17 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference18 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference19 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference20 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference21 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference22 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference23 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference24 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference25 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference26 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference27 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference28 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference29 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference30 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference31 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference32 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
