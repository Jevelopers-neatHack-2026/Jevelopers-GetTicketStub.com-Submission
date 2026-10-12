import type { Brand } from "./brands.js";
export interface DesignControlSchema {
    readonly contract: "DesignControlSchema";
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
    readonly control_schema_id: Brand<string, "ControlSchemaId">;
    readonly control_schema_hash: Brand<string, "Sha256">;
    readonly control_schema_version: "1.0.0";
    readonly design_ref: VersionedReference;
    readonly policy_ref: VersionedReference1;
    /**
     * @minItems 1
     * @maxItems 64
     */
    readonly controls: readonly [
        ({
            readonly control_id: string;
            readonly label: string;
            readonly description: string;
            readonly action: "set_value";
            readonly required: boolean;
            readonly enabled: boolean;
            readonly default_presence: "absent" | "present";
            readonly kind: "number";
            readonly unit: "ratio" | "degrees" | "pixels" | "mm";
            readonly minimum: number;
            readonly maximum: number;
            readonly step: number;
            readonly default_value: number | null;
        } | {
            readonly control_id: string;
            readonly label: string;
            readonly description: string;
            readonly action: "set_value";
            readonly required: boolean;
            readonly enabled: boolean;
            readonly default_presence: "absent" | "present";
            readonly kind: "enum";
            /**
             * @minItems 1
             * @maxItems 64
             */
            readonly values: readonly [
                string,
                ...readonly string[]
            ];
            readonly default_value: string | null;
        } | {
            readonly control_id: string;
            readonly label: string;
            readonly description: string;
            readonly action: "set_value";
            readonly required: boolean;
            readonly enabled: boolean;
            readonly default_presence: "absent" | "present";
            readonly kind: "boolean";
            readonly default_value: boolean | null;
        } | {
            readonly control_id: string;
            readonly label: string;
            readonly description: string;
            readonly action: "set_value";
            readonly required: boolean;
            readonly enabled: boolean;
            readonly default_presence: "absent" | "present";
            readonly kind: "text";
            readonly max_length: number;
            readonly default_value: string | null;
        }),
        ...readonly ({
            readonly control_id: string;
            readonly label: string;
            readonly description: string;
            readonly action: "set_value";
            readonly required: boolean;
            readonly enabled: boolean;
            readonly default_presence: "absent" | "present";
            readonly kind: "number";
            readonly unit: "ratio" | "degrees" | "pixels" | "mm";
            readonly minimum: number;
            readonly maximum: number;
            readonly step: number;
            readonly default_value: number | null;
        } | {
            readonly control_id: string;
            readonly label: string;
            readonly description: string;
            readonly action: "set_value";
            readonly required: boolean;
            readonly enabled: boolean;
            readonly default_presence: "absent" | "present";
            readonly kind: "enum";
            /**
             * @minItems 1
             * @maxItems 64
             */
            readonly values: readonly [
                string,
                ...readonly string[]
            ];
            readonly default_value: string | null;
        } | {
            readonly control_id: string;
            readonly label: string;
            readonly description: string;
            readonly action: "set_value";
            readonly required: boolean;
            readonly enabled: boolean;
            readonly default_presence: "absent" | "present";
            readonly kind: "boolean";
            readonly default_value: boolean | null;
        } | {
            readonly control_id: string;
            readonly label: string;
            readonly description: string;
            readonly action: "set_value";
            readonly required: boolean;
            readonly enabled: boolean;
            readonly default_presence: "absent" | "present";
            readonly kind: "text";
            readonly max_length: number;
            readonly default_value: string | null;
        })[]
    ];
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
