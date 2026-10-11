import type { Brand } from "./brands.js";
/**
 * Finance protocol 2.0.0 proposal; cumulative observed cost is separate from immutable authorized capacity. Legacy 1.0.0 bytes are retained without new safety guarantees.
 */
export interface BudgetReservation {
    readonly contract: "BudgetReservation";
    readonly schema_version: "2.0.0";
    readonly policy_version: "1.0.0";
    readonly event_id: Brand<string, "EventId">;
    readonly tenant_id: Brand<string, "TenantId">;
    readonly project_id: Brand<string, "ProjectId">;
    readonly workflow_id?: Brand<string, "WorkflowId">;
    readonly run_id?: Brand<string, "RunId">;
    readonly job_id?: Brand<string, "JobId">;
    readonly artifact_id?: Brand<string, "ArtifactId">;
    readonly design_id?: Brand<string, "DesignId">;
    readonly design_version_id?: Brand<string, "DesignVersionId">;
    readonly order_id?: Brand<string, "OrderId">;
    readonly trace_id?: Brand<string, "TraceId">;
    readonly correlation_id: Brand<string, "CorrelationId">;
    readonly evidence_id?: Brand<string, "EvidenceId">;
    readonly usage_event_id?: Brand<string, "UsageEventId">;
    readonly logical_operation_id: Brand<string, "LogicalOperationId">;
    readonly provider_attempt_id?: Brand<string, "ProviderAttemptId">;
    readonly billable_attempt_id: Brand<string, "BillableAttemptId">;
    readonly transport_attempt_id?: Brand<string, "TransportAttemptId">;
    readonly provider_request_id?: Brand<string, "ProviderRequestId"> | null;
    readonly producer: {
        readonly module: "getticketstub.com" | "agent-harness" | "event-intelligence" | "creative-engine" | "print-production" | "fulfillment-connectors" | "cost-intelligence" | "team-dashboard" | "integration-evals" | "shared-contracts";
        readonly source_revision: Brand<string, "SourceRevision">;
        readonly build_revision: string;
    };
    readonly occurred_at: Brand<string, "UtcTime">;
    readonly observed_at: Brand<string, "UtcTime">;
    readonly ingested_at: Brand<string, "UtcTime">;
    readonly environment: "development" | "test" | "production";
    readonly billing_mode: "live" | "sandbox" | "simulated";
    /**
     * @maxItems 100
     */
    readonly source_refs: readonly {
        readonly kind: "artifact" | "evidence" | "source_observation" | "provider_request" | "manifest";
        readonly id: string;
        readonly content_hash?: Brand<string, "Sha256">;
    }[];
    readonly reservation_id: Brand<string, "ReservationId">;
    readonly budget_scope_id: Brand<string, "BudgetScopeId">;
    readonly decision: "granted" | "partially_granted" | "denied" | "unknown" | "unavailable";
    readonly lifecycle: "held" | "consumed" | "released" | "expired" | "uncertain_in_flight";
    readonly held: Money | null;
    readonly consumed: Money | null;
    readonly expires_at: Brand<string, "UtcTime">;
    readonly revision: Brand<number, "Revision">;
    readonly execution_state: "not_dispatched" | "in_flight" | "finished" | "uncertain";
    readonly usage_completeness: "unknown" | "incomplete" | "complete";
    readonly idempotency_key: string;
    readonly authority_ref: VersionedReference;
    readonly settlement_ref: VersionedReference1 | null;
    readonly resolution_ref?: VersionedReference1 | null;
    readonly finance_protocol_version: "2.0.0";
    readonly requested_capacity: Money1 | null;
    readonly grant_revision: number;
    readonly grant_request_ref: {
        readonly contract: "ReserveRequest";
        readonly schema_version: "2.0.0";
        readonly id: string;
        readonly revision: 1;
        readonly content_hash: Brand<string, "Sha256">;
    };
    readonly dispatch_cap: Money2 | null;
    readonly dispatch_acknowledgement_ref: VersionedReference2 | null;
    readonly overrun: Money3 | null;
    readonly consumption_basis: "cumulative";
    readonly settlement_intent: "none" | "partial" | "final";
    readonly consumption_kind: "regular" | "late_charge" | "correction";
    readonly consumption_evidence_ref: VersionedReference3 | null;
    readonly correction_ref: VersionedReference4 | null;
    /**
     * @maxItems 100
     */
    readonly exception_refs: readonly VersionedReference5[];
    readonly retained_exposure: Money4 | null;
    readonly released_capacity: Money5 | null;
    readonly unreported_exposure: "unknown" | "none";
}
export interface Money {
    readonly amount: Brand<string, "ExactDecimal">;
    readonly currency: Brand<string, "Currency">;
    readonly scale: number;
}
export interface VersionedReference {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference1 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface Money1 {
    readonly amount: Brand<string, "ExactDecimal">;
    readonly currency: Brand<string, "Currency">;
    readonly scale: number;
}
export interface Money2 {
    readonly amount: Brand<string, "ExactDecimal">;
    readonly currency: Brand<string, "Currency">;
    readonly scale: number;
}
export interface VersionedReference2 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface Money3 {
    readonly amount: Brand<string, "ExactDecimal">;
    readonly currency: Brand<string, "Currency">;
    readonly scale: number;
}
export interface VersionedReference3 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference4 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface VersionedReference5 {
    readonly contract: string;
    readonly schema_version: "1.0.0";
    readonly id: string;
    readonly revision: number;
    readonly content_hash: Brand<string, "Sha256">;
}
export interface Money4 {
    readonly amount: Brand<string, "ExactDecimal">;
    readonly currency: Brand<string, "Currency">;
    readonly scale: number;
}
export interface Money5 {
    readonly amount: Brand<string, "ExactDecimal">;
    readonly currency: Brand<string, "Currency">;
    readonly scale: number;
}
