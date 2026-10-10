import type { Brand } from "./brands.js";
export interface EvidenceProjection {
    readonly contract: "EvidenceProjection";
    readonly schema_version: "1.0.0";
    readonly policy_version: "1.0.0";
    readonly evidence_id: Brand<string, "PublicEvidenceId">;
    readonly environment: "development" | "test" | "production";
    readonly billing_mode: "live" | "sandbox" | "simulated";
    readonly outcome: "passed" | "failed" | "blocked" | "unknown";
    readonly component: {
        readonly name: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
        readonly source_revision: Brand<string, "SourceRevision">;
    };
}
