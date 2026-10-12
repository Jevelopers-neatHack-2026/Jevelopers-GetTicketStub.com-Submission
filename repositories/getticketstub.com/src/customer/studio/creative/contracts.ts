// creative-engine v1.0 contract shapes, only the parts the studio uses. Field names and enums are exact.
//
// Source: Jevelopers-neatHack-2026/creative-engine, branch origin/impl/creative-brief-integrated
//   src/contracts/creative/v1.d.mts   (CommonEnvelope, CreativeBrief, EditPlan, DesignVersion, DesignControlSchema)
//   src/api/v1.d.mts                  (CreativeApiRequest, TrustedCreativeActor, CreativeApiErrorShape)
//   src/controls/index.d.mts          (creative-controls/1.1 inner schema, RejectionCode)
//   docs/api/creative-api.md          (envelope rules), fixtures/contracts/creative/*.json (shapes checked by scripts/check-creative-adapter.mjs)
// Status upstream: local consumer proposals, MODE=live not implemented, owner agreements pending. Nothing here calls the engine.

export type Environment = "development" | "test" | "production";
export type BillingMode = "live" | "sandbox" | "simulated";
export type SectionPresence = "absent" | "unknown" | "present";

/** A value we cannot supply yet. Always starts with PENDING_ so it can never be mistaken for a real hash, id or approval. */
export type Pending<K extends string = string> = `PENDING_${K}`;
export const pending = <K extends string>(what: K): Pending<K> => `PENDING_${what}`;
export const isPending = (v: unknown): v is Pending => typeof v === "string" && v.startsWith("PENDING_");

export type Sha256 = `sha256:${string}`;
export type HashOrPending = Sha256 | Pending;

export interface CommonEnvelope {
  contract: string;
  schema_version: string;
  event_id: string;
  tenant_id: string;
  project_id: string;
  correlation_id: string;
  producer: string;
  occurred_at: string;
  ingested_at: string;
  environment: Environment;
  billing_mode: BillingMode;
  source_refs: string[];
}

export interface PresenceSection<T> {
  presence: SectionPresence;
  items: T[];
}

export type PermissionStatus = "granted" | "denied" | "unknown";
export interface ResearchPermission {
  asset_id: string;
  action: "reproduce" | "modify" | "publish" | "display";
  status: PermissionStatus;
  evidence_refs: string[];
}

export interface CreativeBrief extends CommonEnvelope {
  contract: "CreativeBrief";
  schema_version: "1.0";
  brief_id: string;
  research_package_ref: {
    contract: "EventIntelligencePackage";
    schema_version: string;
    package_id: string;
    content_hash: HashOrPending;
  };
  source_identity: Array<{ source_id: string; uri: string }>;
  facts: {
    verified: Array<{ fact_id: string; key: string; value: unknown; provenance_refs: string[] }>;
    unresolved: Array<{
      fact_id: string;
      key: string;
      status: "conflicting" | "unknown";
      candidate_values?: unknown[];
      provenance_refs: string[];
    }>;
  };
  preferences: PresenceSection<{ preference_id: string; value: string }>;
  interpretations: PresenceSection<{ interpretation_id: string; text: string; basis?: string }>;
  permissions: PresenceSection<ResearchPermission>;
  locks: PresenceSection<{ lock_id: string; field: string; value_hash: HashOrPending; reason: string }>;
}

export type EditAction = "concept.generate" | "image.edit" | "composition.update" | "correction.apply";

export type EditStep =
  | { step_id: string; action: "concept.generate"; source_refs: string[];
      parameters: { brief_id: string; variant_count: number; style_ref?: string } }
  | { step_id: string; action: "image.edit"; source_refs: string[];
      parameters: { design_version_id: string; artifact_id: string; instruction: string; mask_source_ref?: string } }
  | { step_id: string; action: "composition.update"; source_refs: string[];
      parameters: { design_version_id: string; changes: Array<{ field: string; value: unknown; asset_id?: string }> } }
  | { step_id: string; action: "correction.apply"; source_refs: string[];
      parameters: { design_version_id: string; fact_id: string; replacement_value: unknown; evidence_refs: string[] } };

export interface EditPlan extends CommonEnvelope {
  contract: "EditPlan";
  schema_version: "1.0";
  plan_id: string;
  base: { brief_hash: HashOrPending; design_hash: HashOrPending; design_version_id?: string };
  operation: EditAction;
  steps: EditStep[];
  expected_result: {
    contract: "DesignVersion";
    schema_version: "1.0";
    parent_version_id: string;
    artifact_kind: "image";
  };
  invalidates: string[];
}

export interface DesignVersion extends CommonEnvelope {
  contract: "DesignVersion";
  schema_version: "1.0";
  brief_id?: string;
  design_version_id: string;
  parent_version_id: string | null;
  brief_hash: HashOrPending;
  artifact: { artifact_id: string; content_hash: HashOrPending; media_type: string };
  design_hash?: HashOrPending;
  provider?: string;
  model?: string;
  usage_status?: string;
}

export interface DesignControlSchema extends CommonEnvelope {
  contract: "DesignControlSchema";
  schema_version: "1.0";
  control_contract: "creative-controls";
  control_schema_version: "1.0" | "1.1";
  expected_versions: { brief: string; design: string; composition: string };
  control_schema_hash: HashOrPending;
}

// creative-controls/1.1 inner schema. Upstream today only emits kind "select" with value_type "string" and
// four fixed fields (name_size, layout, logo_position, style). The other kinds below are our proposal.
export type ControlRoute = "composition.update" | "artwork.edit";
export type ControlKind = "select" | "multi_select" | "toggle" | "text" | "range";
export type ControlValueType = "string" | "integer" | "boolean" | "string[]";
export type ControlValue = string | number | boolean | string[];

export interface ControlOption {
  value: string | number;
  label: string;
}

export interface Control {
  id: string;
  label: string;
  kind: ControlKind;
  value_type: ControlValueType;
  field: string;
  route: ControlRoute;
  options?: ControlOption[];
  min?: number;
  max?: number;
  max_length?: number;
  default_value: ControlValue;
  locked: boolean;
  asset_id?: string;
}

export interface ControlSchema {
  schema_version: "creative-controls/1.1";
  contract_status: "local-consumer-proposal";
  tenant_id: string;
  project_id: string;
  brief_id: string;
  expected_versions: { brief: string; design: string; composition: string };
  controls: Control[];
  follow_up_questions: never[];
  submit_intent: "apply";
  approval: false;
  purchase: false;
}

export type RejectionCode =
  | "validation" | "unknown_control" | "invalid_value" | "locked" | "no_changes" | "unavailable";

export type CreativeOperation =
  | "generate" | "edit" | "inspect" | "list" | "compare" | "restore" | "cancel" | "handoff" | "job.status"
  | "brief.create" | "brief.invalidate";

export interface CreativeApiRequestEnvelope {
  contract: "CreativeApiRequest";
  schema_version: "1.0";
  event_id: string;
  request_id: string;
  tenant_id: string;
  project_id: string;
  correlation_id: string;
  producer: string;
  occurred_at: string;
  ingested_at: string;
  environment: Environment;
  billing_mode: BillingMode;
  source_refs: string[];
}

export interface BriefCreatePayload {
  customer_preferences?: Array<{ preference_id: string; value: string }>;
  artistic_intent?: Array<{ interpretation_id: string; text: string }>;
  additional_required_fact_keys?: string[];
  fact_corrections?: Array<{ fact_id: string; proposed_value: unknown }>;
  locked_fields?: Array<{ field: string; reason: string }>;
  expected_brief_hash?: string;
}

export type CreativeApiRequest =
  | (CreativeApiRequestEnvelope & { operation: "generate"; action_id: string;
      payload: { brief_id: string; plan: EditPlan } })
  | (CreativeApiRequestEnvelope & { operation: "edit"; action_id: string;
      payload: { brief_id: string; design_version_id: string; plan: EditPlan; selection_mode?: "advance" | "branch" } })
  | (CreativeApiRequestEnvelope & { operation: "inspect"; action_id: string;
      payload: { brief_id: string; design_version_id: string } })
  | (CreativeApiRequestEnvelope & { operation: "list"; action_id?: string;
      payload: { brief_id: string; limit?: number; cursor?: string } })
  | (CreativeApiRequestEnvelope & { operation: "compare"; action_id?: string;
      payload: { brief_id: string; left_design_version_id: string; right_design_version_id: string } })
  | (CreativeApiRequestEnvelope & { operation: "restore"; action_id: string;
      payload: { brief_id: string; target_design_version_id: string; expected_selection_revision: number } })
  | (CreativeApiRequestEnvelope & { operation: "cancel"; action_id: string; payload: { job_id: string } })
  | (CreativeApiRequestEnvelope & { operation: "handoff"; action_id: string;
      payload: { brief_id: string; design_version_id: string; approval_ref: string; destination_ref: string } })
  | (CreativeApiRequestEnvelope & { operation: "job.status"; action_id?: string; payload: { job_id: string } })
  | (CreativeApiRequestEnvelope & { operation: "brief.create"; action_id: string; payload: BriefCreatePayload })
  | (CreativeApiRequestEnvelope & { operation: "brief.invalidate"; action_id: string; payload: { event_id: string } });

export type PayloadOf<O extends CreativeOperation> = Extract<CreativeApiRequest, { operation: O }>["payload"];

/** Supplied by the application, never by the request body (docs/api/creative-api.md "Trust and ownership"). */
export interface TrustedCreativeActor {
  tenant_id: string;
  project_id: string;
  actor_id: string;
  expires_at: string | Pending;
  permissions: string[];
  budget_scope_id: string | Pending;
  budget_policy_version: string | Pending;
}

export type CreativeErrorCode =
  | "invalid_request" | "unsupported_version" | "unauthorized" | "permission_denied"
  | "scope_denied" | "not_found" | "conflict" | "stale_version" | "unavailable"
  | "cancelled" | "review_required" | "budget_unavailable" | "failed";

export interface CreativeApiErrorShape {
  code: CreativeErrorCode;
  operation: CreativeOperation | "unknown";
  module: "creative-engine.api";
  field: string;
  retryable: boolean;
  message: string;
  diagnostic_ref: string;
}
