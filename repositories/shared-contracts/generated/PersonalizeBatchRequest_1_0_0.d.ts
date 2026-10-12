import type { Brand } from "./brands.js";
export interface PersonalizeBatchRequest {
    readonly contract: "PersonalizeBatchRequest";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly request_id: Brand<string, "EventId">;
    readonly correlation_id: Brand<string, "CorrelationId">;
    readonly binding: {
        readonly design_ref: ({
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
            readonly contract: "DesignVersion";
            readonly schema_version: "1.0.0";
        };
        readonly handoff_ref: ({
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
            readonly contract: "ArtifactHandoffManifest";
            readonly schema_version: "1.0.0";
        };
        readonly facts_ref: {
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
        /**
         * @minItems 1
         * @maxItems 100
         */
        readonly asset_refs: readonly {
            readonly asset_ref: ({
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
            readonly permission_ref: ({
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
                readonly contract: "ApprovalReceipt";
                readonly schema_version: "1.0.0";
            };
            readonly purpose: "artwork" | "overlay";
            readonly normalization_policy_ref: (({
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
            }) | null;
        }[];
        readonly approval_ref: ({
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
            readonly contract: "ApprovalReceipt";
            readonly schema_version: "1.0.0";
        };
        readonly template_ref: ({
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
            readonly contract: "TemplateSpec";
            readonly schema_version: "1.0.0";
        };
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
        readonly capability_ref: ({
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
            readonly contract: "FulfillmentCapabilitySnapshot";
            readonly schema_version: "1.0.0";
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
        readonly formatting_policy_ref: ({
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
        readonly repair_policy_ref: (({
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
        }) | null;
        readonly values: {
            readonly [k: string]: {
                readonly kind: "display";
                readonly value: string;
            } | {
                readonly kind: "datetime";
                readonly value: Brand<string, "UtcTime">;
                readonly timezone: string;
                readonly locale: string;
                readonly format_policy_ref: {
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
            };
        };
    };
    readonly input: {
        readonly kind: "structured";
        readonly row_schema_ref: ({
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
            readonly contract: "PersonalizationSchema";
            readonly schema_version: "1.0.0";
        };
        /**
         * @minItems 1
         * @maxItems 10000
         */
        readonly rows: readonly {
            readonly row_id: string;
            readonly fields: {
                readonly [k: string]: string;
            };
        }[];
    } | {
        readonly kind: "csv";
        readonly file_ref: ({
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
        readonly dialect_ref: ({
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
            readonly contract: "CsvDialect";
            readonly schema_version: "1.0.0";
        };
        readonly mapping_ref: ({
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
            readonly contract: "CsvMapping";
            readonly schema_version: "1.0.0";
        };
        readonly checkpoint_ref?: ({
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
            readonly contract: "CsvCheckpoint";
            readonly schema_version: "1.0.0";
        };
    };
    readonly acceptance_policy?: "atomic" | "allow_partial";
    readonly idempotency_key: string;
}
