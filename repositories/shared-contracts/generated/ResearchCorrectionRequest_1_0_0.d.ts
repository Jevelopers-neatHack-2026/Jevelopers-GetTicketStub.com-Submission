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
export interface ResearchCorrectionRequest {
    readonly contract: "ResearchCorrectionRequest";
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
    readonly request_id: Brand<string, "RequestId">;
    readonly idempotency_key: string;
    readonly expected_package_ref: VersionedReference;
    readonly actor_ref: VersionedReference1;
    readonly authority_ref: VersionedReference2;
    readonly mode: "proposed";
    /**
     * @minItems 1
     * @maxItems 64
     */
    readonly changes: readonly [
        {
            readonly fact_id: Brand<string, "FactId">;
            readonly status: "known" | "unknown" | "conflicting" | "review";
            readonly value: InertValue | null;
            /**
             * @minItems 0
             * @maxItems 10
             */
            readonly candidate_values: readonly [
            ] | readonly [
                InertValue
            ] | readonly [
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ];
            /**
             * @minItems 1
             * @maxItems 20
             */
            readonly provenance: readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ];
        },
        ...readonly {
            readonly fact_id: Brand<string, "FactId">;
            readonly status: "known" | "unknown" | "conflicting" | "review";
            readonly value: InertValue | null;
            /**
             * @minItems 0
             * @maxItems 10
             */
            readonly candidate_values: readonly [
            ] | readonly [
                InertValue
            ] | readonly [
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ] | readonly [
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue,
                InertValue
            ];
            /**
             * @minItems 1
             * @maxItems 20
             */
            readonly provenance: readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ] | readonly [
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                },
                {
                    readonly source_id: string;
                    readonly retrieved_at: Brand<string, "UtcTime">;
                    readonly evidence_ref: VersionedReference3;
                }
            ];
        }[]
    ];
    /**
     * @minItems 1
     * @maxItems 64
     */
    readonly evidence_refs: readonly [
        VersionedReference4,
        ...readonly VersionedReference4[]
    ];
    readonly policy_ref: VersionedReference5;
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
