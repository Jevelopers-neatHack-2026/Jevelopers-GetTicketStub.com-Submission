import type { Brand } from "./brands.js";
export interface PersonalizationSchema {
    readonly contract: "PersonalizationSchema";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly schema_id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
    /**
     * @minItems 1
     * @maxItems 32
     */
    readonly fields: readonly {
        readonly field_id: string;
        readonly slot_id: string;
        readonly required: boolean;
        readonly maximum_utf16_units: number;
        readonly source_policy: "row_display" | "approved_fact_readonly";
    }[];
    readonly limits: {
        readonly maximum_rows: number;
        readonly maximum_canonical_bytes: number;
        readonly maximum_fields: number;
    };
}
