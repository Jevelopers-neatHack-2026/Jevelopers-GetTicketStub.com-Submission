import type { Brand } from "./brands.js";
export interface ProductionPolicy {
    readonly contract: "ProductionPolicy";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
    readonly kind: "formatting" | "layout" | "output" | "repair" | "warning" | "proof" | "inspection";
    readonly commitment: Brand<string, "Sha256">;
    readonly formatting: {
        readonly locale: string;
        readonly timezone: string;
    } | null;
    readonly output: {
        readonly color_space: "sRGB";
        readonly pdf_profile: "plain";
        readonly minimum_dpi: number;
        /**
         * @minItems 1
         * @maxItems 3
         */
        readonly formats: readonly ("svg" | "png" | "pdf")[];
    } | null;
}
