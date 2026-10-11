import type { Brand } from "./brands.js";
export interface PreflightReport {
    readonly contract: "PreflightReport";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly report_ref: ({
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
        readonly contract: "PreflightReport";
        readonly schema_version: "1.0.0";
    };
    readonly body: {
        readonly artifact_ref: ArtifactRef;
        readonly spec_ref: ({
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
            readonly contract: "PrintSpec";
            readonly schema_version: "1.0.0";
        };
        readonly rule_ref: ({
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
            readonly contract: "ProductionPolicy";
            readonly schema_version: "1.0.0";
        };
        readonly status: "passed" | "failed" | "unsupported" | "unknown";
        /**
         * @minItems 0
         * @maxItems 100
         */
        readonly checked_files: readonly {
            readonly file_hash: Brand<string, "Sha256">;
            readonly parser_ref: ({
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
                readonly contract: "ProductionRuntime";
                readonly schema_version: "1.0.0";
            };
            /**
             * @minItems 1
             * @maxItems 5
             */
            readonly checks: readonly {
                readonly name: "dimensions" | "content" | "fonts" | "container" | "profile";
                readonly state: "passed" | "failed" | "unsupported" | "unknown";
                readonly evidence_ref: {
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
                };
            }[];
            readonly composition_hash: Brand<string, "Sha256">;
            readonly render_hash: Brand<string, "Sha256">;
            readonly semantic_hash: Brand<string, "Sha256"> | null;
        }[];
        /**
         * @minItems 0
         * @maxItems 1000
         */
        readonly findings: readonly {
            readonly code: "APPROVAL_INVALID" | "APPROVAL_REVOKED" | "APPROVAL_UNAVAILABLE" | "SPEC_UNKNOWN" | "PRODUCT_MISMATCH" | "DIMENSIONS_MISMATCH" | "BLEED_MISMATCH" | "SAFE_MISMATCH" | "DPI_MISMATCH" | "PROFILE_UNSUPPORTED" | "EXPORT_UNSUPPORTED" | "FONT_UNSUPPORTED" | "TRANSPARENCY_MISMATCH" | "ASPECT_MISMATCH" | "SURFACE_UNSUPPORTED" | "FACTS_UNSUPPORTED" | "PREFLIGHT_FAILED" | "PREVIEW_UNKNOWN" | "ROW_BINDING_MISMATCH" | "SOURCE_MISMATCH" | "POLICY_MISMATCH" | "CALIBRATION_ONLY" | "OWNER_ACCEPTANCE_PENDING" | "CANCELLED" | "SKIPPED_POLICY" | "SKIPPED_CANCELLED" | "INVALID_INPUT" | "HASH_MISMATCH" | "STORAGE_UNAVAILABLE" | "RENDER_UNAVAILABLE" | "EXPIRED" | "STALE" | "NOT_FOUND";
            readonly severity: "hard_failure" | "repairable" | "warning" | "information";
            readonly state: "passed" | "failed" | "unsupported" | "unknown";
            readonly field_path: "" | "/contract" | "/schema_version" | "/policy_version" | "/binding" | "/input" | "/input/rows" | "/formats" | "/artifact_ref" | "/target" | "/files" | "/preflight" | "/coordinate_geometry" | "/slots" | "/values" | "/row_scope" | "/counts" | "/diagnostic_ref";
            readonly rule_ref: ({
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
                readonly contract: "ProductionPolicy";
                readonly schema_version: "1.0.0";
            };
            readonly spec_ref: (({
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
                readonly contract: "PrintSpec";
                readonly schema_version: "1.0.0";
            }) | null;
            readonly unit: "nm" | "dpi" | "count" | "digest" | "state";
            readonly observed: (number | string) | null;
            readonly expected: number | string;
            readonly repair_eligible: boolean;
            readonly evidence_ref: {
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
            };
        }[];
        readonly model_ready: boolean;
        readonly files_ready: boolean;
    };
    readonly eligibility: Eligibility;
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
