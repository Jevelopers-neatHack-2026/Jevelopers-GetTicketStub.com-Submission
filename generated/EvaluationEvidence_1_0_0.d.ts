import type { Brand } from "./brands.js";
export interface EvaluationEvidence {
    readonly contract: "EvaluationEvidence";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly event_id: Brand<string, "EventId">;
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly workflow_id?: Brand<string, "WorkflowId">;
    readonly run_id: Brand<string, "RunId">;
    readonly job_id?: Brand<string, "JobId">;
    readonly artifact_id?: Brand<string, "ArtifactId">;
    readonly design_id?: Brand<string, "DesignId">;
    readonly design_version_id?: Brand<string, "DesignVersionId">;
    readonly order_id?: Brand<string, "OrderId">;
    readonly trace_id?: Brand<string, "TraceId">;
    readonly correlation_id: Brand<string, "CorrelationId">;
    readonly evidence_id: Brand<string, "EvidenceId">;
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
    readonly scenario_id: string;
    readonly evidence_hash: Brand<string, "Sha256">;
    /**
     * @minItems 1
     * @maxItems 100
     */
    readonly acceptance_ids: readonly [
        ("ARC-01" | "ARC-02" | "CON-01" | "CON-02" | "CON-03" | "AGT-01" | "AGT-02" | "AGT-03" | "AGT-04" | "AGT-05" | "ART-01" | "ART-02" | "ART-03" | "ART-04" | "ART-05" | "FUL-01" | "FUL-02" | "FUL-03" | "FUL-04" | "FIN-01" | "FIN-02" | "FIN-03" | "FIN-04" | "FIN-05" | "FIN-06" | "FIN-07" | "FIN-08" | "FIN-09" | "FIN-10" | "BUD-01" | "BUD-02" | "BUD-03" | "BUD-04" | "DASH-01" | "DASH-02" | "DASH-03" | "DASH-04" | "EVAL-01" | "EVAL-02" | "EVAL-03" | "EVAL-04" | "SPN-01" | "SPN-02" | "SPN-03" | "LIVE-01" | "LIVE-02" | "LIVE-03"),
        ...readonly ("ARC-01" | "ARC-02" | "CON-01" | "CON-02" | "CON-03" | "AGT-01" | "AGT-02" | "AGT-03" | "AGT-04" | "AGT-05" | "ART-01" | "ART-02" | "ART-03" | "ART-04" | "ART-05" | "FUL-01" | "FUL-02" | "FUL-03" | "FUL-04" | "FIN-01" | "FIN-02" | "FIN-03" | "FIN-04" | "FIN-05" | "FIN-06" | "FIN-07" | "FIN-08" | "FIN-09" | "FIN-10" | "BUD-01" | "BUD-02" | "BUD-03" | "BUD-04" | "DASH-01" | "DASH-02" | "DASH-03" | "DASH-04" | "EVAL-01" | "EVAL-02" | "EVAL-03" | "EVAL-04" | "SPN-01" | "SPN-02" | "SPN-03" | "LIVE-01" | "LIVE-02" | "LIVE-03")[]
    ];
    readonly claim_scope: "contribution_only";
    readonly status: "planned" | "passed" | "failed" | "blocked" | "unmeasured" | "unknown";
    /**
     * @minItems 1
     * @maxItems 20
     */
    readonly components: readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ] | readonly [
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        },
        {
            readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
            readonly source_revision: Brand<string, "SourceRevision">;
        }
    ];
    /**
     * @minItems 1
     * @maxItems 100
     */
    readonly contracts: readonly [
        {
            readonly reference: VersionedReference;
            readonly source_revision: Brand<string, "SourceRevision">;
            readonly schema_hash: Brand<string, "Sha256">;
        },
        ...readonly {
            readonly reference: VersionedReference;
            readonly source_revision: Brand<string, "SourceRevision">;
            readonly schema_hash: Brand<string, "Sha256">;
        }[]
    ];
    /**
     * @minItems 1
     * @maxItems 20
     */
    readonly tools: readonly [
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ] | readonly [
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        },
        {
            readonly name: string;
            readonly version: string;
        }
    ];
    readonly input: {
        readonly input_id: string;
        readonly content_hash: Brand<string, "Sha256">;
        readonly fixture_id: string;
        readonly fixture_hash: Brand<string, "Sha256">;
    };
    readonly provider_mode: "none" | "mock" | "sandbox" | "live" | "unknown";
    readonly dependency_mode: "pinned_fixture" | "mock" | "actual_integration" | "unknown";
    readonly started_at: Brand<string, "UtcTime">;
    readonly finished_at: Brand<string, "UtcTime"> | null;
    /**
     * @minItems 0
     * @maxItems 100
     */
    readonly commands: readonly {
        readonly command_id: string;
        readonly program: "node" | "npm" | "python" | "tool";
        readonly invocation: "generate" | "contracts:check" | "contracts:fixtures" | "contracts:compat" | "build" | "typecheck" | "test" | "test:installed" | "scenario";
        readonly exit_code: number | null;
        readonly status: "planned" | "passed" | "failed" | "blocked" | "unknown";
    }[];
    /**
     * @minItems 0
     * @maxItems 100
     */
    readonly metrics: readonly {
        readonly metric_id: string;
        readonly unit: "ms" | "bytes" | "count" | "ratio" | "decimal";
        readonly measurement_status: "measured" | "unmeasured" | "unknown";
        readonly value: (number | Brand<string, "ExactDecimal">) | null;
        readonly basis: "observed" | "baseline_delta" | "none";
    }[];
    readonly baseline_ref: VersionedReference1 | null;
    /**
     * @minItems 0
     * @maxItems 100
     */
    readonly artifacts: readonly {
        readonly artifact_id: string;
        readonly content_hash: Brand<string, "Sha256">;
        readonly access: "public_sanitized" | "private_reference";
        readonly reference: VersionedReference2;
    }[];
    /**
     * @minItems 0
     * @maxItems 20
     */
    readonly limitations: readonly [
    ] | readonly [
        "owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ] | readonly [
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown"),
        ("owner_pending" | "consumer_pending" | "live_provider_not_run" | "unmeasured" | "incomplete_coverage" | "external_authority" | "unknown")
    ];
    /**
     * @minItems 0
     * @maxItems 100
     */
    readonly decision_refs: readonly VersionedReference1[];
    /**
     * @minItems 0
     * @maxItems 100
     */
    readonly usage_refs: readonly VersionedReference1[];
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
