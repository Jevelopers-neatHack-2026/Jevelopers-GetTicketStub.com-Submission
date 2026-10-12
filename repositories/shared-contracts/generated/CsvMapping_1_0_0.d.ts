import type { Brand } from "./brands.js";
export interface CsvMapping {
    readonly contract: "CsvMapping";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
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
     * @maxItems 32
     */
    readonly headers: readonly string[];
    readonly field_mapping: {
        readonly [k: string]: string;
    };
    readonly row_id_header: string;
}
