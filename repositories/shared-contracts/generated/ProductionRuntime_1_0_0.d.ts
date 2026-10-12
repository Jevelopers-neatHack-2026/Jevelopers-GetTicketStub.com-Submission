import type { Brand } from "./brands.js";
export interface ProductionRuntime {
    readonly contract: "ProductionRuntime";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
    readonly source_revision: Brand<string, "SourceRevision">;
    readonly renderer_commitment: Brand<string, "Sha256">;
    readonly parser_commitment: Brand<string, "Sha256">;
}
