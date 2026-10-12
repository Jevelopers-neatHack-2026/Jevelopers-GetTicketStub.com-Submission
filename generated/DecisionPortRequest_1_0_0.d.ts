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
export type InertValue3 = string | number | boolean | null | readonly InertValue1[] | {
    readonly [k: string]: InertValue2;
};
export type InertValue4 = string | number | boolean | null | readonly InertValue1[] | {
    readonly [k: string]: InertValue2;
};
export type InertValue5 = string | number | boolean | null | readonly InertValue1[] | {
    readonly [k: string]: InertValue2;
};
export type InertValue6 = string | number | boolean | null | readonly InertValue1[] | {
    readonly [k: string]: InertValue2;
};
export type InertValue7 = string | number | boolean | null | readonly InertValue1[] | {
    readonly [k: string]: InertValue2;
};
export type InertValue8 = string | number | boolean | null | readonly InertValue1[] | {
    readonly [k: string]: InertValue2;
};
export type InertValue9 = string | number | boolean | null | readonly InertValue1[] | {
    readonly [k: string]: InertValue2;
};
export interface DecisionPortRequest {
    readonly contract: "DecisionPortRequest";
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
    readonly attempt_number: number;
    readonly attempt_limit: number;
    readonly deadline_at: Brand<string, "UtcTime">;
    readonly cancellation_ref: VersionedReference;
    readonly model_ref: VersionedReference1;
    readonly policy_ref: VersionedReference2;
    readonly budget_ref: VersionedReference3;
    readonly state_ref: VersionedReference4;
    readonly execution_mode: "independent_batch";
    readonly acceptance_policy: "partial" | "all_or_nothing";
    readonly prior_answers: {
        readonly [k: string]: VersionedReference5;
    };
    readonly questions: {
        readonly [k: string]: {
            readonly type: "choice";
            readonly instructions: InertValue;
            /**
             * @maxItems 24
             */
            readonly depends_on: readonly string[];
            readonly criteria: {
                readonly [k: string]: InertValue3;
            };
            /**
             * @minItems 1
             * @maxItems 255
             */
            readonly eligible_candidate_ids: readonly [
                string,
                ...readonly string[]
            ];
            readonly minimum_confidence: number;
        } | {
            readonly type: "score";
            readonly profile: "structured-index-v1";
            readonly instructions: InertValue4;
            /**
             * @maxItems 24
             */
            readonly depends_on: readonly string[];
            /**
             * @minItems 2
             * @maxItems 10
             */
            readonly criteria: readonly [
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ];
            readonly minimum_confidence: number;
        } | {
            readonly type: "score";
            readonly profile: "ei-string-v1";
            readonly instructions: InertValue6;
            /**
             * @maxItems 24
             */
            readonly depends_on: readonly string[];
            readonly criteria: string;
            /**
             * @minItems 2
             * @maxItems 10
             */
            readonly index_labels: readonly [
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ] | readonly [
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5,
                InertValue5
            ];
            readonly legacy_legend: string;
            readonly minimum_confidence: number;
        } | {
            readonly type: "noul";
            readonly instructions: InertValue7;
            /**
             * @maxItems 24
             */
            readonly depends_on: readonly string[];
            readonly criteria: {
                readonly true: InertValue8;
                readonly false: InertValue9;
            };
            readonly uncertain_band: {
                readonly lower: number;
                readonly upper: number;
            };
        };
    };
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
