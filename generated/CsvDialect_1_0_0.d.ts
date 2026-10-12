import type { Brand } from "./brands.js";
export interface CsvDialect {
    readonly contract: "CsvDialect";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
    readonly encoding: "utf-8";
    readonly bom: "forbidden" | "optional" | "required";
    readonly delimiter: "," | ";" | "\t";
    readonly quote: '"';
    readonly newline: "lf" | "crlf";
    readonly header: "required";
    readonly maximum_record_bytes: number;
}
