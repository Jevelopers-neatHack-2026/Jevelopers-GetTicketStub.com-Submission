import type { Brand } from "./brands.js";
export interface ProductionBundle {
    readonly contract: "ProductionBundle";
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
    readonly bundle_id: Brand<string, "BundleId">;
    readonly bundle_version: number;
    readonly bundle_hash: Brand<string, "Sha256">;
    readonly handoff_ref: VersionedReference;
    readonly approval_ref: VersionedReference1;
    readonly renderer_ref: VersionedReference2;
    readonly template_ref: VersionedReference3;
    /**
     * @minItems 1
     * @maxItems 32
     */
    readonly font_refs: readonly [
        VersionedReference4,
        ...readonly VersionedReference4[]
    ];
    readonly spec_ref: VersionedReference5;
    readonly print_spec: {
        readonly product_id: string;
        readonly variant_id: string;
        readonly width: number;
        readonly height: number;
        readonly unit: "mm" | "inches" | "pixels";
        readonly bleed: number;
    };
    readonly composition: {
        readonly facts_hash: Brand<string, "Sha256">;
        readonly barcode_hash: Brand<string, "Sha256">;
        readonly composition_hash: Brand<string, "Sha256">;
        readonly source_artwork_hash: Brand<string, "Sha256">;
        readonly displayed_preview_hash: Brand<string, "Sha256">;
        readonly composed_preview_hash: Brand<string, "Sha256">;
    };
    /**
     * @minItems 1
     * @maxItems 100
     */
    readonly files: readonly [
        ArtifactFile,
        ...readonly ArtifactFile[]
    ];
    readonly preflight: {
        readonly status: "passed" | "failed" | "unsupported" | "unknown";
        readonly report_ref: VersionedReference6;
        /**
         * @minItems 0
         * @maxItems 32
         */
        readonly reasons: readonly ("font_missing" | "dimensions" | "bleed" | "missing_output" | "unsupported_product" | "unmeasured")[];
    };
    /**
     * @minItems 0
     * @maxItems 100
     */
    readonly usage_refs: readonly VersionedReference4[];
    /**
     * @minItems 0
     * @maxItems 100
     */
    readonly decision_refs: readonly VersionedReference4[];
    readonly composition_ref: VersionedReference7;
    readonly facts_ref: VersionedReference8;
    readonly composed_preview_ref: VersionedReference9;
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
export interface ArtifactFile {
    readonly artifact_id: Brand<string, "ArtifactId">;
    readonly filename: string;
    readonly role: "source_artwork" | "display_preview" | "composed_preview" | "print_output";
    readonly byte_hash: Brand<string, "Sha256">;
    readonly byte_size: number;
    readonly media_type: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
    readonly width: number;
    readonly height: number;
    readonly unit: "pixels" | "mm" | "inches";
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
