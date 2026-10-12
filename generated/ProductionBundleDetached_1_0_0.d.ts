import type { Brand } from "./brands.js";
export interface ProductionBundleDetached {
    readonly contract: "ProductionBundleDetached";
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
    readonly manifest: ArtifactFile;
    readonly archive: ArtifactFile1;
    readonly lineage_hash: Brand<string, "Sha256">;
    readonly payload_set_hash: Brand<string, "Sha256">;
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
export interface ArtifactFile1 {
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
