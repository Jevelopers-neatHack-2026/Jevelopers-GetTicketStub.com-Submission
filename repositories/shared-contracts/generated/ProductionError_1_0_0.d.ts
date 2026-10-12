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
