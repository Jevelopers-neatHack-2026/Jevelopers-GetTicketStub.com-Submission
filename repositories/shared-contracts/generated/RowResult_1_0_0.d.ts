import type { Brand } from "./brands.js";
export type ProductionError = {
    readonly [k: string]: unknown;
} & {
    readonly contract: "ProductionError";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly module: "print-production";
    readonly operation: "composeArtifact" | "personalizeArtifactBatch" | "inspectArtifact" | "exportArtifactBundle" | "compareTemplateCompatibility" | "getArtifactManifestStatus";
    readonly code: "INVALID_INPUT" | "UNSUPPORTED_VERSION" | "UNSUPPORTED_PRODUCT" | "INCOMPATIBLE_TEMPLATE" | "APPROVAL_INVALID" | "APPROVAL_REVOKED" | "APPROVAL_UNAVAILABLE" | "ASSET_MISSING" | "HASH_MISMATCH" | "PREFLIGHT_FAILED" | "IDEMPOTENCY_CONFLICT" | "NOT_FOUND" | "FORBIDDEN" | "RETRYABLE_STORAGE_FAILURE" | "RETRYABLE_RENDER_FAILURE" | "OUTPUT_UNSUPPORTED" | "ROW_SCHEMA" | "ROW_DUPLICATE" | "CAPABILITY_DISABLED" | "CANCELLED" | "INTEGRITY_FAILURE";
    readonly retryable: boolean;
    readonly safe_message: string;
    readonly diagnostic_ref: {
        readonly state: "persisted";
        readonly tenant_id: Brand<string, "TenantId">;
        readonly project_id: Brand<string, "ProjectId">;
        readonly reference: ({
            readonly contract: "DesignVersion" | "ArtifactHandoffManifest" | "ApprovalReceipt" | "PrintSpec" | "FulfillmentCapabilitySnapshot" | "EventIntelligencePackage" | "JobStatus" | "UsageEvent" | "DecisionReceipt" | "EvaluationEvidence" | "TemplateSpec" | "Composition" | "PersonalizationSchema" | "ProductionPolicy" | "ProductionRuntime" | "ProductionResource" | "PreflightReport" | "ProductionDiagnostic" | "CsvDialect" | "CsvMapping" | "CsvCheckpoint" | "BatchResult";
            readonly schema_version: "1.0.0";
            readonly id: string;
            readonly revision: number;
            readonly content_hash: Brand<string, "Sha256">;
        } | {
            readonly contract: "ArtifactFile" | "ProductionBundle";
            readonly schema_version: "2.0.0";
            readonly id: string;
            readonly revision: number;
            readonly content_hash: Brand<string, "Sha256">;
        } | {
            readonly contract: "ProductionBundleDetached";
            readonly schema_version: "1.0.0";
            readonly id: string;
            readonly revision: number;
            readonly content_hash: Brand<string, "Sha256">;
        }) & {
            readonly contract: "ProductionDiagnostic";
            readonly schema_version: "1.0.0";
        };
    } | {
        readonly state: "unavailable";
        readonly tenant_id: Brand<string, "TenantId">;
        readonly project_id: Brand<string, "ProjectId">;
        readonly correlation_id: Brand<string, "CorrelationId">;
        readonly reason_code: "STORAGE_UNAVAILABLE";
    };
    readonly blocking_condition: "input" | "version" | "product" | "template" | "approval" | "asset" | "preflight" | "conflict" | "access" | "storage" | "render" | "output" | "row" | "capability" | "cancelled" | "integrity";
    readonly side_effects: "none" | "possible" | "confirmed" | "unknown";
    readonly usage_state: "unknown" | "incomplete" | "complete";
    readonly field_path?: "" | "/contract" | "/schema_version" | "/policy_version" | "/binding" | "/input" | "/input/rows" | "/formats" | "/artifact_ref" | "/target" | "/files" | "/preflight" | "/coordinate_geometry" | "/slots" | "/values" | "/row_scope" | "/counts" | "/diagnostic_ref";
    readonly row_id?: string;
    readonly details?: {
        /**
         * @minItems 0
         * @maxItems 32
         */
        readonly reason_codes: readonly ("APPROVAL_INVALID" | "APPROVAL_REVOKED" | "APPROVAL_UNAVAILABLE" | "SPEC_UNKNOWN" | "PRODUCT_MISMATCH" | "DIMENSIONS_MISMATCH" | "BLEED_MISMATCH" | "SAFE_MISMATCH" | "DPI_MISMATCH" | "PROFILE_UNSUPPORTED" | "EXPORT_UNSUPPORTED" | "FONT_UNSUPPORTED" | "TRANSPARENCY_MISMATCH" | "ASPECT_MISMATCH" | "SURFACE_UNSUPPORTED" | "FACTS_UNSUPPORTED" | "PREFLIGHT_FAILED" | "PREVIEW_UNKNOWN" | "ROW_BINDING_MISMATCH" | "SOURCE_MISMATCH" | "POLICY_MISMATCH" | "CALIBRATION_ONLY" | "OWNER_ACCEPTANCE_PENDING" | "CANCELLED" | "SKIPPED_POLICY" | "SKIPPED_CANCELLED" | "INVALID_INPUT" | "HASH_MISMATCH" | "STORAGE_UNAVAILABLE" | "RENDER_UNAVAILABLE" | "EXPIRED" | "STALE" | "NOT_FOUND")[];
        readonly expected_contract?: "DesignVersion" | "ArtifactHandoffManifest" | "ApprovalReceipt" | "PrintSpec" | "FulfillmentCapabilitySnapshot" | "EventIntelligencePackage" | "JobStatus" | "UsageEvent" | "DecisionReceipt" | "EvaluationEvidence" | "TemplateSpec" | "Composition" | "PersonalizationSchema" | "ProductionPolicy" | "ProductionRuntime" | "ProductionResource" | "PreflightReport" | "ProductionDiagnostic" | "CsvDialect" | "CsvMapping" | "CsvCheckpoint" | "BatchResult" | "ArtifactFile" | "ProductionBundle" | "ProductionBundleDetached";
        readonly expected_version?: "1.0.0" | "2.0.0";
    };
};
export interface RowResult {
    readonly contract: "RowResult";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly job: JobRef;
    readonly row_id: string;
    readonly ordinal: number;
    readonly input_hash: Brand<string, "Sha256">;
    readonly status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "skipped";
    readonly skip_reason: ("SKIPPED_POLICY" | "SKIPPED_CANCELLED") | null;
    readonly artifact_ref: ArtifactRef | null;
    readonly bundle_ref: ProductionBundleRef | null;
    /**
     * @minItems 0
     * @maxItems 32
     */
    readonly errors: readonly ProductionError[];
    readonly source_position: {
        readonly file_hash: Brand<string, "Sha256">;
        readonly logical_record: number;
        readonly physical_line: number;
        readonly source_paths: {
            readonly [k: string]: string;
        };
    } | null;
    readonly eligibility: Eligibility1;
}
export interface JobRef {
    readonly contract: "JobRef";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly job_ref: ({
        readonly contract: "DesignVersion" | "ArtifactHandoffManifest" | "ApprovalReceipt" | "PrintSpec" | "FulfillmentCapabilitySnapshot" | "EventIntelligencePackage" | "JobStatus" | "UsageEvent" | "DecisionReceipt" | "EvaluationEvidence" | "TemplateSpec" | "Composition" | "PersonalizationSchema" | "ProductionPolicy" | "ProductionRuntime" | "ProductionResource" | "PreflightReport" | "ProductionDiagnostic" | "CsvDialect" | "CsvMapping" | "CsvCheckpoint" | "BatchResult";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ArtifactFile" | "ProductionBundle";
        readonly schema_version: "2.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ProductionBundleDetached";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    }) & {
        readonly contract: "JobStatus";
        readonly schema_version: "1.0.0";
    };
    readonly batch_input_hash: Brand<string, "Sha256">;
}
export interface ArtifactRef {
    readonly contract: "ArtifactRef";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly artifact_ref: ({
        readonly contract: "DesignVersion" | "ArtifactHandoffManifest" | "ApprovalReceipt" | "PrintSpec" | "FulfillmentCapabilitySnapshot" | "EventIntelligencePackage" | "JobStatus" | "UsageEvent" | "DecisionReceipt" | "EvaluationEvidence" | "TemplateSpec" | "Composition" | "PersonalizationSchema" | "ProductionPolicy" | "ProductionRuntime" | "ProductionResource" | "PreflightReport" | "ProductionDiagnostic" | "CsvDialect" | "CsvMapping" | "CsvCheckpoint" | "BatchResult";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ArtifactFile" | "ProductionBundle";
        readonly schema_version: "2.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ProductionBundleDetached";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    }) & {
        readonly contract: "ArtifactFile";
        readonly schema_version: "2.0.0";
    };
    readonly composition_ref: ({
        readonly contract: "DesignVersion" | "ArtifactHandoffManifest" | "ApprovalReceipt" | "PrintSpec" | "FulfillmentCapabilitySnapshot" | "EventIntelligencePackage" | "JobStatus" | "UsageEvent" | "DecisionReceipt" | "EvaluationEvidence" | "TemplateSpec" | "Composition" | "PersonalizationSchema" | "ProductionPolicy" | "ProductionRuntime" | "ProductionResource" | "PreflightReport" | "ProductionDiagnostic" | "CsvDialect" | "CsvMapping" | "CsvCheckpoint" | "BatchResult";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ArtifactFile" | "ProductionBundle";
        readonly schema_version: "2.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ProductionBundleDetached";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    }) & {
        readonly contract: "Composition";
        readonly schema_version: "1.0.0";
    };
    readonly private_revision_hash: Brand<string, "Sha256">;
    /**
     * @minItems 1
     * @maxItems 100
     */
    readonly source_artwork_hashes: readonly Brand<string, "Sha256">[];
    readonly render_hash: Brand<string, "Sha256">;
    readonly preview_ref: (({
        readonly contract: "DesignVersion" | "ArtifactHandoffManifest" | "ApprovalReceipt" | "PrintSpec" | "FulfillmentCapabilitySnapshot" | "EventIntelligencePackage" | "JobStatus" | "UsageEvent" | "DecisionReceipt" | "EvaluationEvidence" | "TemplateSpec" | "Composition" | "PersonalizationSchema" | "ProductionPolicy" | "ProductionRuntime" | "ProductionResource" | "PreflightReport" | "ProductionDiagnostic" | "CsvDialect" | "CsvMapping" | "CsvCheckpoint" | "BatchResult";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ArtifactFile" | "ProductionBundle";
        readonly schema_version: "2.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ProductionBundleDetached";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    }) & {
        readonly contract: "ArtifactFile";
        readonly schema_version: "2.0.0";
    }) | null;
}
export interface ProductionBundleRef {
    readonly contract: "ProductionBundleRef";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly bundle_ref: ({
        readonly contract: "DesignVersion" | "ArtifactHandoffManifest" | "ApprovalReceipt" | "PrintSpec" | "FulfillmentCapabilitySnapshot" | "EventIntelligencePackage" | "JobStatus" | "UsageEvent" | "DecisionReceipt" | "EvaluationEvidence" | "TemplateSpec" | "Composition" | "PersonalizationSchema" | "ProductionPolicy" | "ProductionRuntime" | "ProductionResource" | "PreflightReport" | "ProductionDiagnostic" | "CsvDialect" | "CsvMapping" | "CsvCheckpoint" | "BatchResult";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ArtifactFile" | "ProductionBundle";
        readonly schema_version: "2.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ProductionBundleDetached";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    }) & {
        readonly contract: "ProductionBundle";
        readonly schema_version: "2.0.0";
    };
    /**
     * @minItems 4
     * @maxItems 100
     */
    readonly file_set: readonly ArtifactFile[];
    readonly detached_ref: ({
        readonly contract: "DesignVersion" | "ArtifactHandoffManifest" | "ApprovalReceipt" | "PrintSpec" | "FulfillmentCapabilitySnapshot" | "EventIntelligencePackage" | "JobStatus" | "UsageEvent" | "DecisionReceipt" | "EvaluationEvidence" | "TemplateSpec" | "Composition" | "PersonalizationSchema" | "ProductionPolicy" | "ProductionRuntime" | "ProductionResource" | "PreflightReport" | "ProductionDiagnostic" | "CsvDialect" | "CsvMapping" | "CsvCheckpoint" | "BatchResult";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ArtifactFile" | "ProductionBundle";
        readonly schema_version: "2.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ProductionBundleDetached";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    }) & {
        readonly contract: "ProductionBundleDetached";
        readonly schema_version: "1.0.0";
    };
    readonly row_scope: {
        readonly job_ref: JobRef1;
        readonly row_id: string;
        readonly ordinal: number;
        readonly input_hash: Brand<string, "Sha256">;
    } | null;
    readonly composition_ref: ({
        readonly contract: "DesignVersion" | "ArtifactHandoffManifest" | "ApprovalReceipt" | "PrintSpec" | "FulfillmentCapabilitySnapshot" | "EventIntelligencePackage" | "JobStatus" | "UsageEvent" | "DecisionReceipt" | "EvaluationEvidence" | "TemplateSpec" | "Composition" | "PersonalizationSchema" | "ProductionPolicy" | "ProductionRuntime" | "ProductionResource" | "PreflightReport" | "ProductionDiagnostic" | "CsvDialect" | "CsvMapping" | "CsvCheckpoint" | "BatchResult";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ArtifactFile" | "ProductionBundle";
        readonly schema_version: "2.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ProductionBundleDetached";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    }) & {
        readonly contract: "Composition";
        readonly schema_version: "1.0.0";
    };
    readonly eligibility: Eligibility;
}
export interface ArtifactFile {
    readonly contract: "ArtifactFile";
    readonly schema_version: "2.0.0";
    readonly policy_version: "1.0.0";
    readonly artifact_id: string;
    readonly filename: string;
    readonly role: "source_artwork" | "display_preview" | "composed_preview" | "print_output" | "preflight_report" | "profile" | "lineage" | "manifest" | "archive" | "detached";
    readonly byte_hash: Brand<string, "Sha256">;
    readonly byte_size: number;
    readonly media_type: "image/svg+xml" | "image/png" | "image/jpeg" | "image/webp" | "application/pdf" | "application/json" | "application/zip" | "application/vnd.iccprofile";
    readonly geometry: {
        readonly width_nm: string;
        readonly height_nm: string;
        readonly width_px: number | null;
        readonly height_px: number | null;
        readonly effective_dpi: number | null;
    } | null;
    readonly profile_ref: (({
        readonly contract: "DesignVersion" | "ArtifactHandoffManifest" | "ApprovalReceipt" | "PrintSpec" | "FulfillmentCapabilitySnapshot" | "EventIntelligencePackage" | "JobStatus" | "UsageEvent" | "DecisionReceipt" | "EvaluationEvidence" | "TemplateSpec" | "Composition" | "PersonalizationSchema" | "ProductionPolicy" | "ProductionRuntime" | "ProductionResource" | "PreflightReport" | "ProductionDiagnostic" | "CsvDialect" | "CsvMapping" | "CsvCheckpoint" | "BatchResult";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ArtifactFile" | "ProductionBundle";
        readonly schema_version: "2.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ProductionBundleDetached";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    }) & {
        readonly contract: "ProductionResource";
        readonly schema_version: "1.0.0";
    }) | null;
    readonly characteristics: {
        readonly raster_artwork: boolean;
        readonly text: "embedded" | "rasterized" | "none";
        readonly vector_content: boolean;
        readonly alpha: boolean;
    } | null;
    readonly semantic_hash: Brand<string, "Sha256"> | null;
}
export interface JobRef1 {
    readonly contract: "JobRef";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly job_ref: ({
        readonly contract: "DesignVersion" | "ArtifactHandoffManifest" | "ApprovalReceipt" | "PrintSpec" | "FulfillmentCapabilitySnapshot" | "EventIntelligencePackage" | "JobStatus" | "UsageEvent" | "DecisionReceipt" | "EvaluationEvidence" | "TemplateSpec" | "Composition" | "PersonalizationSchema" | "ProductionPolicy" | "ProductionRuntime" | "ProductionResource" | "PreflightReport" | "ProductionDiagnostic" | "CsvDialect" | "CsvMapping" | "CsvCheckpoint" | "BatchResult";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ArtifactFile" | "ProductionBundle";
        readonly schema_version: "2.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    } | {
        readonly contract: "ProductionBundleDetached";
        readonly schema_version: "1.0.0";
        readonly id: string;
        readonly revision: number;
        readonly content_hash: Brand<string, "Sha256">;
    }) & {
        readonly contract: "JobStatus";
        readonly schema_version: "1.0.0";
    };
    readonly batch_input_hash: Brand<string, "Sha256">;
}
export interface Eligibility {
    readonly state: "eligible" | "blocked" | "unknown";
    /**
     * @minItems 0
     * @maxItems 32
     */
    readonly reason_codes: readonly ("APPROVAL_INVALID" | "APPROVAL_REVOKED" | "APPROVAL_UNAVAILABLE" | "SPEC_UNKNOWN" | "PRODUCT_MISMATCH" | "DIMENSIONS_MISMATCH" | "BLEED_MISMATCH" | "SAFE_MISMATCH" | "DPI_MISMATCH" | "PROFILE_UNSUPPORTED" | "EXPORT_UNSUPPORTED" | "FONT_UNSUPPORTED" | "TRANSPARENCY_MISMATCH" | "ASPECT_MISMATCH" | "SURFACE_UNSUPPORTED" | "FACTS_UNSUPPORTED" | "PREFLIGHT_FAILED" | "PREVIEW_UNKNOWN" | "ROW_BINDING_MISMATCH" | "SOURCE_MISMATCH" | "POLICY_MISMATCH" | "CALIBRATION_ONLY" | "OWNER_ACCEPTANCE_PENDING" | "CANCELLED" | "SKIPPED_POLICY" | "SKIPPED_CANCELLED" | "INVALID_INPUT" | "HASH_MISMATCH" | "STORAGE_UNAVAILABLE" | "RENDER_UNAVAILABLE" | "EXPIRED" | "STALE" | "NOT_FOUND")[];
    readonly checked_at: Brand<string, "UtcTime">;
    readonly evidence_mode: "simulated" | "offline" | "sandbox" | "live";
    readonly handoff_eligible: boolean;
}
export interface Eligibility1 {
    readonly state: "eligible" | "blocked" | "unknown";
    /**
     * @minItems 0
     * @maxItems 32
     */
    readonly reason_codes: readonly ("APPROVAL_INVALID" | "APPROVAL_REVOKED" | "APPROVAL_UNAVAILABLE" | "SPEC_UNKNOWN" | "PRODUCT_MISMATCH" | "DIMENSIONS_MISMATCH" | "BLEED_MISMATCH" | "SAFE_MISMATCH" | "DPI_MISMATCH" | "PROFILE_UNSUPPORTED" | "EXPORT_UNSUPPORTED" | "FONT_UNSUPPORTED" | "TRANSPARENCY_MISMATCH" | "ASPECT_MISMATCH" | "SURFACE_UNSUPPORTED" | "FACTS_UNSUPPORTED" | "PREFLIGHT_FAILED" | "PREVIEW_UNKNOWN" | "ROW_BINDING_MISMATCH" | "SOURCE_MISMATCH" | "POLICY_MISMATCH" | "CALIBRATION_ONLY" | "OWNER_ACCEPTANCE_PENDING" | "CANCELLED" | "SKIPPED_POLICY" | "SKIPPED_CANCELLED" | "INVALID_INPUT" | "HASH_MISMATCH" | "STORAGE_UNAVAILABLE" | "RENDER_UNAVAILABLE" | "EXPIRED" | "STALE" | "NOT_FOUND")[];
    readonly checked_at: Brand<string, "UtcTime">;
    readonly evidence_mode: "simulated" | "offline" | "sandbox" | "live";
    readonly handoff_eligible: boolean;
}
