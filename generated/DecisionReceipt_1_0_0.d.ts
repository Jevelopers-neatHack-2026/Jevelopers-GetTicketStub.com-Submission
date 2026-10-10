import type { Brand } from "./brands.js";
export type InertValue = string | number | boolean | null | readonly InertValue1[] | {
    readonly [k: string]: InertValue2;
};
export type InertValue1 = string | number | boolean | null | readonly InertValue1[] | {
    readonly [k: string]: InertValue2;
};
export type InertValue2 = string | number | boolean | null | readonly InertValue1[] | {
    readonly [k: string]: InertValue2;
};
export interface DecisionReceipt {
    readonly contract: "DecisionReceipt";
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
    readonly logical_operation_id: Brand<string, "LogicalOperationId">;
    readonly provider_attempt_id?: Brand<string, "ProviderAttemptId">;
    readonly billable_attempt_id: Brand<string, "BillableAttemptId">;
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
    readonly receipt_id: Brand<string, "DecisionReceiptId">;
    readonly request_id: Brand<string, "RequestId">;
    readonly batch_id: Brand<string, "BatchId">;
    readonly request_hash: Brand<string, "Sha256">;
    readonly result_hash: Brand<string, "Sha256">;
    readonly question_hashes: {
        readonly [k: string]: Brand<string, "Sha256">;
    };
    readonly answer_hashes: {
        readonly [k: string]: Brand<string, "Sha256">;
    };
    readonly model_ref: VersionedReference;
    readonly policy_ref: VersionedReference1;
    readonly state_ref: VersionedReference2;
    readonly normalized_result: DecisionPortResult;
    readonly decided_at: Brand<string, "UtcTime">;
    readonly usage_ref: VersionedReference5 | null;
    readonly review_reason: "none" | "low_confidence" | "uncertain" | "partial" | "unavailable" | "timeout" | "cancelled" | "malformed" | "abstain";
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
export interface DecisionPortResult {
    readonly contract: "DecisionPortResult";
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
    readonly logical_operation_id: Brand<string, "LogicalOperationId">;
    readonly provider_attempt_id?: Brand<string, "ProviderAttemptId">;
    readonly billable_attempt_id: Brand<string, "BillableAttemptId">;
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
    readonly request_id: Brand<string, "RequestId">;
    readonly batch_id: Brand<string, "BatchId">;
    readonly model_ref: VersionedReference3;
    readonly policy_ref: VersionedReference4;
    readonly acceptance_policy: "partial" | "all_or_nothing";
    readonly status: "complete" | "partial" | "review" | "unknown" | "abstain" | "unavailable" | "timeout" | "cancelled" | "malformed";
    readonly answers: {
        readonly [k: string]: {
            readonly status: "answered" | "review";
            readonly answer: {
                readonly type: "choice";
                readonly choice: string;
                readonly probabilities: {
                    readonly [k: string]: number;
                };
                readonly confidence: number;
            } | {
                readonly type: "score";
                readonly profile: "structured-index-v1";
                readonly score: number;
                readonly legend: {
                    readonly [k: string]: InertValue;
                };
                readonly probabilities: {
                    readonly [k: string]: number;
                };
                readonly confidence: number;
            } | {
                readonly type: "score";
                readonly profile: "ei-string-v1";
                readonly score: number;
                readonly legend: string;
                readonly probabilities: {
                    readonly [k: string]: number;
                };
                readonly confidence: number;
            } | {
                readonly type: "noul";
                readonly noul: number;
            };
            readonly reason_code: "none" | "low_confidence" | "uncertain_probability";
        } | {
            readonly status: "unknown" | "abstain" | "unavailable" | "timeout" | "cancelled" | "malformed";
            readonly reason_code: "missing_data" | "policy" | "provider" | "deadline" | "cancelled" | "invalid_response";
        };
    };
    readonly usage_ref: VersionedReference5 | null;
    readonly usage_completeness: "complete" | "incomplete" | "unknown";
    readonly execution_state: "not_dispatched" | "in_flight" | "finished" | "uncertain";
    readonly error: ({
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
        readonly diagnostic_ref?: VersionedReference6;
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
        readonly diagnostic_ref?: VersionedReference7;
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
        readonly diagnostic_ref?: VersionedReference8;
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
        readonly diagnostic_ref?: VersionedReference9;
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
        readonly diagnostic_ref?: VersionedReference10;
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
        readonly diagnostic_ref?: VersionedReference11;
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
        readonly diagnostic_ref?: VersionedReference12;
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
        readonly diagnostic_ref?: VersionedReference13;
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
        readonly diagnostic_ref?: VersionedReference14;
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
        readonly diagnostic_ref?: VersionedReference15;
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
        readonly diagnostic_ref?: VersionedReference16;
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
        readonly diagnostic_ref?: VersionedReference17;
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
        readonly diagnostic_ref?: VersionedReference18;
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
        readonly diagnostic_ref?: VersionedReference19;
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
        readonly diagnostic_ref?: VersionedReference20;
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
        readonly diagnostic_ref?: VersionedReference21;
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
        readonly diagnostic_ref?: VersionedReference22;
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
        readonly diagnostic_ref?: VersionedReference23;
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
        readonly diagnostic_ref?: VersionedReference24;
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
        readonly diagnostic_ref?: VersionedReference25;
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
        readonly diagnostic_ref?: VersionedReference26;
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
        readonly diagnostic_ref?: VersionedReference27;
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
        readonly diagnostic_ref?: VersionedReference28;
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
        readonly diagnostic_ref?: VersionedReference29;
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
        readonly diagnostic_ref?: VersionedReference30;
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
        readonly diagnostic_ref?: VersionedReference31;
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
        readonly diagnostic_ref?: VersionedReference32;
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
        readonly diagnostic_ref?: VersionedReference33;
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
        readonly diagnostic_ref?: VersionedReference34;
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
        readonly diagnostic_ref?: VersionedReference35;
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
        readonly diagnostic_ref?: VersionedReference36;
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
        readonly diagnostic_ref?: VersionedReference37;
    }) | null;
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
export interface VersionedReference33 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference34 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference35 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference36 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference37 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
