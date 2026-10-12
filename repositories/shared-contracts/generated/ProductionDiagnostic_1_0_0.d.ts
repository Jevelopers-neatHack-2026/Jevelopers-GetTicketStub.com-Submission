import type { Brand } from "./brands.js";
export interface ProductionDiagnostic {
    readonly contract: "ProductionDiagnostic";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
    readonly operation: "composeArtifact" | "personalizeArtifactBatch" | "inspectArtifact" | "exportArtifactBundle" | "compareTemplateCompatibility" | "getArtifactManifestStatus";
    /**
     * @minItems 0
     * @maxItems 32
     */
    readonly reason_codes: readonly ("APPROVAL_INVALID" | "APPROVAL_REVOKED" | "APPROVAL_UNAVAILABLE" | "SPEC_UNKNOWN" | "PRODUCT_MISMATCH" | "DIMENSIONS_MISMATCH" | "BLEED_MISMATCH" | "SAFE_MISMATCH" | "DPI_MISMATCH" | "PROFILE_UNSUPPORTED" | "EXPORT_UNSUPPORTED" | "FONT_UNSUPPORTED" | "TRANSPARENCY_MISMATCH" | "ASPECT_MISMATCH" | "SURFACE_UNSUPPORTED" | "FACTS_UNSUPPORTED" | "PREFLIGHT_FAILED" | "PREVIEW_UNKNOWN" | "ROW_BINDING_MISMATCH" | "SOURCE_MISMATCH" | "POLICY_MISMATCH" | "CALIBRATION_ONLY" | "OWNER_ACCEPTANCE_PENDING" | "CANCELLED" | "SKIPPED_POLICY" | "SKIPPED_CANCELLED" | "INVALID_INPUT" | "HASH_MISMATCH" | "STORAGE_UNAVAILABLE" | "RENDER_UNAVAILABLE" | "EXPIRED" | "STALE" | "NOT_FOUND")[];
}
