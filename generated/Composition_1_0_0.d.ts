import type { Brand } from "./brands.js";
export interface Composition {
    readonly contract: "Composition";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly composition_id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
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
    /**
     * @minItems 1
     * @maxItems 100
     */
    readonly asset_uses: readonly {
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
    /**
     * @minItems 0
     * @maxItems 32
     */
    readonly fact_bindings: readonly {
        readonly slot_id: string;
        readonly fact_key: string;
        readonly value_hash: Brand<string, "Sha256">;
    }[];
    readonly policy_refs: {
        readonly formatting: ({
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
        readonly layout: ({
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
        readonly output: ({
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
        readonly repair: (({
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
    };
    /**
     * @minItems 1
     * @maxItems 16
     */
    readonly font_refs: readonly (({
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
    })[];
    readonly runtime_ref: ({
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
    readonly resolved_layout_commitment: Brand<string, "Sha256">;
    readonly input_binding_hash: Brand<string, "Sha256">;
    readonly barcode: {
        readonly state: "absent";
        readonly reason: "not_applicable" | "not_requested";
    } | {
        readonly state: "bound";
        readonly symbology: "qr" | "code128";
        readonly input_hash: Brand<string, "Sha256">;
        readonly slot_id: string;
    };
    /**
     * @minItems 1
     * @maxItems 256
     */
    readonly slot_bindings: readonly {
        readonly slot_id: string;
        readonly source: {
            readonly kind: "asset";
            readonly asset_ref: {
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
        } | {
            readonly kind: "value";
            readonly field_id: string;
        } | {
            readonly kind: "fact";
            readonly fact_key: string;
        } | {
            readonly kind: "policy";
            readonly policy_ref: {
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
    }[];
}
