import { CREATIVE_API_OPERATIONS, CREATIVE_API_VERSIONS } from "creative-engine/api/v1";
import type {
  CreativeApiRequest,
  CreativeApiRequestV1_0,
  CreativeApiRequestV1_2,
  CreativeCompositionCommitInput,
  CreativeCompositionEditPlan,
  CreativeCompositionStoragePort,
  CreativePublicationTransaction,
  CreativeRuntimePorts,
  TrustedCreativeActor,
} from "creative-engine/api/v1";
import type { CompositionEditPlan } from "creative-engine/contracts/approval-handoff";
import type { CreativeVersionStore, VersionScope } from "creative-engine/versions";

const base = {
  contract: "CreativeApiRequest",
  schema_version: "1.2",
  event_id: "event:composition-consumer",
  request_id: "request:composition-consumer",
  tenant_id: "tenant:consumer",
  project_id: "project:consumer",
  correlation_id: "correlation:composition-consumer",
  producer: "composition-public-consumer",
  occurred_at: "2026-10-11T12:00:00.000Z",
  ingested_at: "2026-10-11T12:00:00.000Z",
  environment: "test",
  billing_mode: "simulated",
  source_refs: [] as string[],
} satisfies Omit<CreativeApiRequestV1_2, "operation" | "action_id" | "payload">;

const operation = { operation_id: "operation:title", kind: "set_text", layer_id: "layer:title",
  value: "A reviewed title" } as const satisfies CompositionEditPlan["operations"][number];
const textSizeOperation = { operation_id: "operation:title-size", kind: "set_text_size", layer_id: "layer:title",
  size: { value: "18", unit: "pt" } } as const satisfies CompositionEditPlan["operations"][number];
const layoutOperation = { operation_id: "operation:layout", kind: "set_layer_layout", layer_id: "layer:title",
  layout: { x_milli: 120, y_milli: 80, width_milli: 640, height_milli: 180 } } as const satisfies CompositionEditPlan["operations"][number];
const approvedLogoOperation = { operation_id: "operation:logo", kind: "position_approved_logo", layer_id: "layer:logo",
  asset_id: "asset:approved-logo", layout: { x_milli: 760, y_milli: 820, width_milli: 180, height_milli: 120 } } as const satisfies CompositionEditPlan["operations"][number];
const plan: CreativeCompositionEditPlan = {
  schema_version: "creative.composition-edit.proposal/v1",
  plan_id: "plan:consumer",
  tenant_id: "tenant:consumer",
  project_id: "project:consumer",
  base_design_version_id: "design:consumer",
  base_artwork_sha256: "sha256:artwork",
  base_brief_id: "brief:consumer",
  base_brief_sha256: "sha256:brief",
  base_facts_revision_id: "facts:consumer",
  base_facts_sha256: "sha256:facts",
  base_composition_id: "composition:consumer",
  base_composition_revision_id: "revision:consumer",
  base_composition_sha256: "sha256:composition",
  target_composition_revision_id: "revision:consumer-next",
  operations: [operation, textSizeOperation, layoutOperation, approvedLogoOperation],
  approval_required_after_application: true,
};

const createRequest: CreativeApiRequestV1_2 = { ...base, operation: "composition.create",
  action_id: "action:create", payload: { brief_id: "brief:consumer", design_version_id: "design:consumer" } };
const getRequest: CreativeApiRequestV1_2 = { ...base, operation: "composition.get",
  payload: { brief_id: "brief:consumer", design_version_id: "design:consumer" } };
const updateRequest: CreativeApiRequestV1_2 = { ...base, operation: "composition.update", action_id: "action:update",
  payload: { brief_id: "brief:consumer", design_version_id: "design:consumer", plan } };
const compositionRequests: CreativeApiRequest[] = [createRequest, getRequest, updateRequest];

// The prior approval-handoff contract remains source compatible and can still
// describe an incomplete draft. API 1.2 requires the completed non-empty form.
const oldEmptyPlan: CompositionEditPlan = { ...plan, operations: [] };
const emptyPlanUpdate: CreativeApiRequestV1_2 = { ...base, operation: "composition.update", action_id: "action:empty",
  payload: { brief_id: "brief:consumer", design_version_id: "design:consumer",
    // @ts-expect-error API 1.2 must not admit an empty plan.
    plan: oldEmptyPlan } };
const malformedOperation: CreativeCompositionEditPlan = { ...plan, operations: [{ operation_id: "bad",
  // @ts-expect-error The plan needs a valid typed operation.
  kind: "delete_layer", layer_id: "layer:title" }] };
const malformedCreate: CreativeApiRequestV1_2 = { ...base, operation: "composition.create", action_id: "action:bad-create",
  payload: { brief_id: "brief:consumer", design_version_id: "design:consumer",
    // @ts-expect-error create payloads cannot smuggle an update plan.
    plan } };
const malformedGet: CreativeApiRequestV1_2 = { ...base, operation: "composition.get",
  payload: { brief_id: "brief:consumer", design_version_id: "design:consumer",
    // @ts-expect-error get payloads do not accept update-only fields.
    plan } };
const unsupportedCompositionOperation: CreativeApiRequestV1_2 = { ...base,
  // @ts-expect-error The public API exposes only the three reviewed composition operations.
  operation: "composition.delete",
  action_id: "action:delete", payload: { brief_id: "brief:consumer", design_version_id: "design:consumer" } };

declare const legacyRequest: CreativeApiRequestV1_0;
const preservedLegacyRequest: CreativeApiRequest = legacyRequest;
const unsupportedLegacyComposition: CreativeApiRequestV1_0 = { ...base, schema_version: "1.0",
  // @ts-expect-error Composition operations require the additive 1.2 envelope.
  operation: "composition.create", action_id: "action:legacy-create",
  payload: { brief_id: "brief:consumer", design_version_id: "design:consumer" } };

const scope: VersionScope = { tenant_id: "tenant:consumer", project_id: "project:consumer", brief_id: "brief:consumer" };
declare const store: CreativeVersionStore;
declare const storagePort: CreativeCompositionStoragePort;
const currentStoreValue: ReturnType<CreativeVersionStore["getCurrentComposition"]> =
  store.getCurrentComposition({ scope, design_version_id: "design:consumer" });
const historyStoreValue: ReturnType<CreativeVersionStore["listCompositionRevisions"]> =
  store.listCompositionRevisions({ scope, composition_id: "composition:consumer", limit: 20 });
const currentPortValue: ReturnType<CreativeCompositionStoragePort["getCurrentComposition"]> =
  storagePort.getCurrentComposition({ scope, design_version_id: "design:consumer" });
const currentFence = storagePort.assertCurrentComposition({ scope, composition_id: "composition:consumer",
  design_version_id: "design:consumer", revision_id: "revision:consumer", revision_sha256: "sha256:revision",
  selection_revision: 1 });
const currentFenceStatus: "current" = currentFence.status;
// @ts-expect-error The final local authority fence must be synchronous.
const asynchronousFence: CreativeCompositionStoragePort["assertCurrentComposition"] = async () => currentFence;

const commitInput: CreativeCompositionCommitInput = { scope, actor_id: "actor:consumer", action_id: "action:commit",
  job_id: "job:commit", request_hash: "sha256:request", revision_sha256: "sha256:revision" };
const transaction: CreativePublicationTransaction = { job_id: "job:commit", lease_token: "lease:commit" };
const committed: ReturnType<CreativeVersionStore["commitCompositionRevision"]> =
  store.commitCompositionRevision(commitInput, transaction);

type CompleteIfActive = NonNullable<NonNullable<CreativeRuntimePorts["jobs"]>["completeIfActive"]>;
type SynchronousBeforeCommit = NonNullable<Parameters<CompleteIfActive>[2]>;
const validBeforeCommit: SynchronousBeforeCommit = () => true;
// @ts-expect-error An asynchronous callback reopens the final commit fence.
const asynchronousBeforeCommit: SynchronousBeforeCommit = async () => true;

const publicVersions: readonly string[] = CREATIVE_API_VERSIONS;
const publicOperations: readonly string[] = CREATIVE_API_OPERATIONS;
declare const actor: TrustedCreativeActor;
void [compositionRequests, plan, oldEmptyPlan, emptyPlanUpdate, malformedOperation, malformedCreate, malformedGet,
  unsupportedCompositionOperation, preservedLegacyRequest, unsupportedLegacyComposition, currentStoreValue,
  historyStoreValue, currentPortValue, currentFenceStatus, asynchronousFence, committed, validBeforeCommit,
  asynchronousBeforeCommit, publicVersions, publicOperations, actor];
