import {
  CREATIVE_API_OPERATIONS,
  CREATIVE_API_VERSION,
  CreativeApiError,
  createCreativeApi,
  createCreativeRuntime,
} from "creative-engine/api/v1";
import type {
  CreativeApiRequest,
  CreativeApiRequestEnvelope,
  CreativeApiRequestV1_0,
  CreativeApiRequestV1_1,
  CreativeApiRequestV1_1Envelope,
  CreativeApiResponse,
  CreativeConceptBatchResult,
  CreativeConceptLineage,
  OpenAIConceptConfiguration,
  OpenRouterConceptCapabilities,
  OpenRouterConceptConfiguration,
  CreativeConceptNativePlan,
  CreativeConceptProviderInput,
  CreativeConceptReferenceInspection,
  CreativeConceptReferenceManifest,
  CreativeConceptReferencePreflight,
  CreativeConceptStoragePort,
  CreativeContextFence,
  CreativeProviderRouteInput,
  CreativeRuntimePorts,
  DecisionDispatchInput,
  DispatchAuthorizationInput,
  DispatchAuthorizationResult,
  InspectionInput,
  ProviderInput,
  ProviderUsageRecord,
  TrustedCreativeActor,
  UsageRecord,
} from "creative-engine/api/v1";
import type { CreativeVersionRuntimeStorage, CreativeVersionStore } from "creative-engine/versions";
import type { EditPlan } from "creative-engine/contracts/creative/v1";
import type { MeteredDispatchContext } from "creative-engine/contracts/metering";

const base = (event_id: string): CreativeApiRequestEnvelope => ({
  contract: "CreativeApiRequest",
  schema_version: CREATIVE_API_VERSION,
  event_id,
  request_id: `request:${event_id}`,
  tenant_id: "tenant-fixture",
  project_id: "project-fixture",
  correlation_id: `correlation:${event_id}`,
  producer: "api-type-consumer-fixture",
  occurred_at: "2026-10-10T12:00:00.000Z",
  ingested_at: "2026-10-10T12:00:00.000Z",
  environment: "test",
  billing_mode: "simulated",
  source_refs: ["source-fixture"],
});

const generatePlan: EditPlan = {
  contract: "EditPlan",
  schema_version: "1.0",
  event_id: "plan-event-generate",
  tenant_id: "tenant-fixture",
  project_id: "project-fixture",
  correlation_id: "plan-correlation-generate",
  producer: "api-type-consumer-fixture",
  occurred_at: "2026-10-10T12:00:00.000Z",
  ingested_at: "2026-10-10T12:00:00.000Z",
  environment: "test",
  billing_mode: "simulated",
  source_refs: ["source-fixture"],
  plan_id: "plan-generate",
  base: { brief_hash: `sha256:${"a".repeat(64)}`, design_hash: `sha256:${"b".repeat(64)}` },
  operation: "concept.generate",
  steps: [{ step_id: "generate-step", action: "concept.generate", source_refs: ["source-fixture"],
    parameters: { brief_id: "brief-fixture", variant_count: 1 } }],
  expected_result: { contract: "DesignVersion", schema_version: "1.0", parent_version_id: "root:brief-fixture", artifact_kind: "image" },
  invalidates: [],
};

const editPlan: EditPlan = {
  ...generatePlan,
  plan_id: "plan-edit",
  base: { ...generatePlan.base, design_version_id: "design-fixture" },
  operation: "image.edit",
  steps: [{ step_id: "edit-step", action: "image.edit", source_refs: ["source-fixture"],
    parameters: { design_version_id: "design-fixture", artifact_id: "artifact-fixture", instruction: "Adjust contrast." } }],
  expected_result: { ...generatePlan.expected_result, parent_version_id: "design-fixture" },
};

const requests: CreativeApiRequest[] = [
  { ...base("generate"), operation: "generate", action_id: "action-generate", payload: { brief_id: "brief-fixture", plan: generatePlan } },
  { ...base("edit"), operation: "edit", action_id: "action-edit", payload: { brief_id: "brief-fixture", design_version_id: "design-fixture", plan: editPlan } },
  { ...base("inspect"), operation: "inspect", action_id: "action-inspect", payload: { brief_id: "brief-fixture", design_version_id: "design-fixture" } },
  { ...base("list"), operation: "list", payload: { brief_id: "brief-fixture", limit: 20 } },
  { ...base("compare"), operation: "compare", payload: { brief_id: "brief-fixture", left_design_version_id: "design-a", right_design_version_id: "design-b" } },
  { ...base("restore"), operation: "restore", action_id: "action-restore", payload: {
    brief_id: "brief-fixture", target_design_version_id: "design-a", expected_selection_revision: 4 } },
  { ...base("cancel"), operation: "cancel", action_id: "action-cancel", payload: { job_id: "job-fixture" } },
  { ...base("handoff"), operation: "handoff", action_id: "action-handoff", payload: {
    brief_id: "brief-fixture", design_version_id: "design-fixture", approval_ref: "approval-fixture", destination_ref: "destination-fixture" } },
  { ...base("job-status"), operation: "job.status", payload: { job_id: "job-fixture" } },
];

const conceptsBase = (event_id: string): CreativeApiRequestV1_1Envelope => ({
  ...base(event_id),
  schema_version: "1.1",
});
const conceptsRequest: CreativeApiRequestV1_1 = {
  ...conceptsBase("concepts-create"),
  operation: "concepts.create",
  action_id: "action-concepts-create",
  payload: {
    brief_id: "brief-fixture",
    plan_id: "concept-plan-fixture",
    requested_count: 2,
    references: [
      { asset_id: "asset-a", role_ref: "role:front" },
      { asset_id: "asset-b", role_ref: "role:detail" },
    ],
  },
};

const trustedActor: TrustedCreativeActor = {
  actor_id: "actor-fixture",
  tenant_id: "tenant-fixture",
  project_id: "project-fixture",
  expires_at: "2026-10-11T00:00:00.000Z",
  permissions: ["creative.read", "creative.generate", "creative.edit", "creative.restore", "creative.cancel", "creative.handoff"],
  budget_scope_id: "budget-fixture",
  budget_policy_version: "budget-policy/1",
};
const api = createCreativeApi();
const apiAlias = createCreativeRuntime();
const generateRequest = requests.find((request) => request.operation === "generate");
const jobStatusRequest = requests.find((request) => request.operation === "job.status");
if (!generateRequest || !jobStatusRequest) throw new Error("Legacy request fixtures must include generate and job.status.");
const response: Promise<CreativeApiResponse> = api.invoke(trustedActor, generateRequest);
const aliasResponse: Promise<CreativeApiResponse> = apiAlias.invoke(trustedActor, jobStatusRequest);
const conceptsInvocation: Promise<CreativeApiResponse> = api.invoke(trustedActor, conceptsRequest);

function consumeConceptLineage(lineage: CreativeConceptLineage): string {
  const adapter = lineage.adapter_snapshot;
  if (adapter.provider_name === "openai") {
    const directConfiguration: OpenAIConceptConfiguration = adapter.configuration;
    const directSize: string = directConfiguration.size;
    return `${adapter.model}:${directSize}`;
  }
  const providerTag: string = adapter.provider_tag;
  const capabilities: OpenRouterConceptCapabilities = adapter.capabilities;
  const routerConfiguration: OpenRouterConceptConfiguration = adapter.configuration;
  // A valid OpenRouter profile may have no optional image parameters at all.
  const noOptionalSize: string | undefined = routerConfiguration.resolution;
  // @ts-expect-error OpenRouter's declared profile has no direct size field.
  const unsupportedSize: string = routerConfiguration.size;
  void unsupportedSize;
  // @ts-expect-error OpenRouter lineage does not claim direct OpenAI moderation settings.
  const unsupportedModeration: string = routerConfiguration.moderation;
  void unsupportedModeration;
  return `${adapter.model}:${providerTag}:${capabilities.generation}:${noOptionalSize ?? "empty"}`;
}

export function consumeSuccessfulConceptLineages(response: CreativeApiResponse): readonly string[] {
  if (response.ok !== true || response.schema_version !== "1.1" ||
      !response.result || response.result.contract !== "CreativeConceptBatchResult") return [];
  return response.result.candidates.map((candidate) => consumeConceptLineage(candidate.creative_concept_lineage));
}
type CompleteIfActive = NonNullable<CreativeRuntimePorts["jobs"]>["completeIfActive"];
type SynchronousBeforeCommit = NonNullable<Parameters<CompleteIfActive>[2]>;
const validFinalFence: SynchronousBeforeCommit = () => true;
// @ts-expect-error Final publication authority must be rechecked synchronously before COMMIT.
const asyncFinalFence: SynchronousBeforeCommit = async () => true;
void validFinalFence;
void asyncFinalFence;
declare const conceptResult: CreativeConceptBatchResult;
const conceptStatus: CreativeConceptBatchResult["status"] = conceptResult.status;
// @ts-expect-error The v1.1 concepts arm is not assignable to the strict legacy v1.0 union.
const conceptsAsLegacy: CreativeApiRequestV1_0 = conceptsRequest;
const v1_1Generate: CreativeApiRequestV1_1 = {
  ...conceptsBase("v11-generate"),
  // @ts-expect-error v1.1 admits only concepts.create.
  operation: "generate",
  action_id: "action-v11-generate",
  payload: { brief_id: "brief-fixture", plan_id: "plan-fixture", requested_count: 1, references: [] },
};
const forgedConceptSettlement: CreativeApiRequestV1_1 = {
  ...conceptsRequest,
  payload: {
    ...conceptsRequest.payload,
    // @ts-expect-error Settlement evidence is private C03 output and is not a caller request field.
    financial_exposure_status: "settled",
  },
};
const publicError = new CreativeApiError("unavailable", "job.status", "jobs.get", { retryable: true });

const authorizationInput: DispatchAuthorizationInput = {
  scope: { tenant_id: "tenant-fixture", project_id: "project-fixture", job_id: "job-fixture" },
  actor_id: trustedActor.actor_id,
  job_id: "job-fixture",
  lease_token: "lease-fixture",
  action_id: "action-fixture",
  operation: "generate",
  billable_attempt_id: "attempt-fixture",
  transport_attempt_id: "transport-fixture",
  context_fence: { brief_id: "brief-fixture", brief_hash: `sha256:${"a".repeat(64)}`,
    expected_current_design_version_id: null, expected_current_design_hash: null },
};
const authorizationResult: DispatchAuthorizationResult = { status: "authorized", dispatch_intent_ref: "intent-fixture" };
declare const meteredDispatch: MeteredDispatchContext;
const immutableReservationReference: string = meteredDispatch.reservation_ref;
// @ts-expect-error reservation_ref is a read-only authority value.
meteredDispatch.reservation_ref = "caller-forged-reservation";

declare const decisionDispatch: DecisionDispatchInput;
const initialDecisionTransportId: string = decisionDispatch.transport_attempt_id;
const decisionRetryIntent: Promise<string> = decisionDispatch.recordTransportAttempt("transport:jev-retry");
declare const inspectionDispatch: InspectionInput;
const initialInspectionTransportId: string = inspectionDispatch.transport_attempt_id;
const inspectionTransportIntent: Promise<string> = inspectionDispatch.recordTransportAttempt(initialInspectionTransportId);
const inspectionReservationReference: string = inspectionDispatch.reservation_ref;
// @ts-expect-error reservation_ref is a read-only authority value.
inspectionDispatch.reservation_ref = "caller-forged-reservation";
declare const providerDispatch: ProviderInput;
const providerReservationReference: string = providerDispatch.reservation_ref;
// @ts-expect-error reservation_ref is a read-only authority value.
providerDispatch.reservation_ref = "caller-forged-reservation";
const legacyProviderPlan: EditPlan = providerDispatch.plan;
const nativeConceptPlan: CreativeConceptNativePlan = {
  operation: "concept.generate",
  brief_id: "brief-fixture",
  source_refs: ["source-one", "source-two"],
  steps: [{ action: "concept.generate", source_refs: ["source-one", "source-two"],
    parameters: { variant_count: 1 } }],
};
declare const possiblySingleSourcePlan: CreativeConceptNativePlan;
// @ts-expect-error Distinct source pages may be one or two, so index 1 is not guaranteed.
const unguardedSecondSourcePage: string = possiblySingleSourcePlan.source_refs[1];
// @ts-expect-error The native plan step has the same one-or-two source-page cardinality.
const unguardedSecondStepSourcePage: string = possiblySingleSourcePlan.steps[0].source_refs[1];
// @ts-expect-error The native plan does not fabricate the full EditPlan envelope or parent base.
const nativePlanAsLegacyEditPlan: EditPlan = nativeConceptPlan;
const oneSourceNativeConceptPlan: CreativeConceptNativePlan = {
  ...nativeConceptPlan,
  source_refs: ["source-one"],
  steps: [{ action: "concept.generate", source_refs: ["source-one"], parameters: { variant_count: 1 } }],
};
function sourcePages(reference: CreativeConceptNativePlan["source_refs"]): string[] {
  const first: string = reference[0];
  if (reference.length === 2) return [first, reference[1]];
  return [first];
}
const twoPlanPages = sourcePages(nativeConceptPlan.source_refs);
const twoStepPages = sourcePages(nativeConceptPlan.steps[0].source_refs);
const onePlanPage = sourcePages(oneSourceNativeConceptPlan.source_refs);
const oneStepPage = sourcePages(oneSourceNativeConceptPlan.steps[0].source_refs);
declare const conceptProviderDispatch: CreativeConceptProviderInput;
const nativePlanBrief: string = conceptProviderDispatch.plan.brief_id;
// @ts-expect-error Parentless native plan has no selected parent base.
const fabricatedParentHash: string = conceptProviderDispatch.plan.base.brief_hash;
const conceptRouteInput: CreativeProviderRouteInput = { scope: providerDispatch.scope,
  actor_id: providerDispatch.actor_id, operation: "edit", plan: nativeConceptPlan };
const legacyRouteInput: CreativeProviderRouteInput = { scope: providerDispatch.scope,
  actor_id: providerDispatch.actor_id, operation: "edit", plan: providerDispatch.plan };
type ProviderResolveRoute = NonNullable<CreativeRuntimePorts["provider"]>["resolveRoute"];
const routePlanReader: ProviderResolveRoute = (input) => {
  if (input.operation === "generate") {
    const fullPlan: EditPlan = input.plan;
    const briefHash: string = fullPlan.base.brief_hash;
    void briefHash;
  } else if ("contract" in input.plan) {
    const selectedDesignHash: string = input.plan.base.design_hash;
    void selectedDesignHash;
  } else {
    const nativeSourcePages = sourcePages(input.plan.source_refs);
    const nativeStepPages = sourcePages(input.plan.steps[0].source_refs);
    void [nativeSourcePages, nativeStepPages];
  }
  return { retry_mapping_ref: "retry:fixture", provider: providerDispatch.attempt.provider };
};
type ProviderEdit = NonNullable<CreativeRuntimePorts["provider"]>["edit"];
declare const providerOutput: Awaited<ReturnType<NonNullable<CreativeRuntimePorts["provider"]>["generate"]>>;
const providerEditReader: ProviderEdit = async (input) => {
  if (!("contract" in input.plan)) {
    const nativePlan: CreativeConceptNativePlan = input.plan;
    const nativeSourcePages = sourcePages(nativePlan.source_refs);
    const nativeStepPages = sourcePages(nativePlan.steps[0].source_refs);
    void [nativeSourcePages, nativeStepPages];
  } else {
    const legacyPlan: EditPlan = input.plan;
    const selectedDesignHash: string = legacyPlan.base.design_hash;
    void selectedDesignHash;
  }
  return providerOutput;
};
const rawProviderUsage: ProviderUsageRecord = {
  input_tokens: 12,
  output_tokens: 24,
  total_tokens: 36,
  input_tokens_details: { cached_tokens: 3 },
  output_tokens_details: { reasoning_tokens: 4 },
  provider_request_id: "provider-request-fixture",
  transport_attempt_id: initialInspectionTransportId,
  completeness: "complete",
};
const privacyFilteredUsage: UsageRecord = { completeness: "complete", input_tokens: 1, output_tokens: 2,
  provider_request_id: "provider-request-fixture", transport_attempt_id: initialInspectionTransportId };
const publicationFence: CreativeContextFence = { brief_id: "brief-fixture", brief_hash: `sha256:${"a".repeat(64)}`,
  design_version_id: "design-fixture", design_hash: `sha256:${"b".repeat(64)}`,
  expected_current_design_version_id: "design-fixture", expected_current_design_hash: `sha256:${"b".repeat(64)}` };

declare const preflightReference: CreativeConceptReferencePreflight;
// @ts-expect-error Dimensions are created by native decoding and are unavailable at preflight entry.
const predecodePixelCount: number = preflightReference.width * preflightReference.height;
declare const inspectedReference: CreativeConceptReferenceInspection;
const decodedPixelCount: number = inspectedReference.width * inspectedReference.height;
declare const finalReferenceManifest: CreativeConceptReferenceManifest;
const firstManifestReference = finalReferenceManifest.references[0];
if (!firstManifestReference) throw new Error("A validated concept manifest contains two authorized references.");
const finalManifestWidth: number = firstManifestReference.width;

declare const conceptBatch: Parameters<CreativeConceptStoragePort["beginConceptBatch"]>[0]["batch"];
declare const conceptBatchResult: CreativeConceptBatchResult;
const conceptStorageImplementer: CreativeConceptStoragePort = {
  beginConceptBatch(input) { return { status: "created", batch: input.batch, batch_status: "running" }; },
  appendConceptEvent() { return { status: "recorded", batch: conceptBatch, batch_status: "running" }; },
  recordConceptDispatchBinding(input) { return { status: "recorded", transport_attempt_id: input.transport_attempt_id,
    target_binding_sha256: input.target_binding_sha256 }; },
  stageConceptResponse(input) { return { status: "staged", stage_ref: "stage-fixture", content_hash: input.content_hash }; },
  getConceptBatch() { return null; },
  getConceptResponseStage() { return null; },
  prepareConceptArtifactObjects(input) { return { action_id: input.action_id, artifacts: input.concept_ids.map((concept_id) => ({
    concept_id, content_hash: `sha256:${"c".repeat(64)}`, byte_length: 1, status: "object_durable" })) }; },
  publishConceptBatch() { return conceptBatchResult; },
  getConceptVersions() { return []; },
};
declare const runtimePorts: CreativeRuntimePorts;
const optionalConceptBegin: CreativeConceptStoragePort["beginConceptBatch"] | undefined =
  runtimePorts.storage?.beginConceptBatch;
declare const versionStore: CreativeVersionStore;
declare const versionStorage: CreativeVersionRuntimeStorage;
declare const beginConceptInput: Parameters<CreativeConceptStoragePort["beginConceptBatch"]>[0];
declare const appendConceptInput: Parameters<CreativeConceptStoragePort["appendConceptEvent"]>[0];
declare const dispatchBindingInput: Parameters<CreativeConceptStoragePort["recordConceptDispatchBinding"]>[0];
declare const stagedResponseInput: Parameters<CreativeConceptStoragePort["stageConceptResponse"]>[0];
declare const conceptReadInput: Parameters<CreativeConceptStoragePort["getConceptBatch"]>[0];
declare const responseStageReadInput: Parameters<CreativeConceptStoragePort["getConceptResponseStage"]>[0];
declare const artifactPreparationInput: Parameters<CreativeConceptStoragePort["prepareConceptArtifactObjects"]>[0];
declare const conceptPublishInput: Parameters<CreativeConceptStoragePort["publishConceptBatch"]>[0];
declare const conceptTransaction: Parameters<CreativeConceptStoragePort["publishConceptBatch"]>[1];
declare const conceptVersionsReadInput: Parameters<CreativeConceptStoragePort["getConceptVersions"]>[0];
const storedBegin: ReturnType<CreativeVersionStore["beginConceptBatch"]> = versionStore.beginConceptBatch(beginConceptInput);
const storedAppend: ReturnType<CreativeVersionStore["appendConceptEvent"]> = versionStore.appendConceptEvent(appendConceptInput);
const storedBinding: ReturnType<CreativeVersionStore["recordConceptDispatchBinding"]> = versionStore.recordConceptDispatchBinding(dispatchBindingInput);
const storedStage: ReturnType<CreativeVersionStore["stageConceptResponse"]> = versionStore.stageConceptResponse(stagedResponseInput);
const storedBatch: ReturnType<CreativeVersionStore["getConceptBatch"]> = versionStore.getConceptBatch(conceptReadInput);
const storedResponseStage: ReturnType<CreativeVersionStore["getConceptResponseStage"]> = versionStore.getConceptResponseStage(responseStageReadInput);
const storedObjects: ReturnType<CreativeVersionStore["prepareConceptArtifactObjects"]> = versionStore.prepareConceptArtifactObjects(artifactPreparationInput);
const publishedBatch: ReturnType<CreativeVersionStore["publishConceptBatch"]> = versionStore.publishConceptBatch(conceptPublishInput, conceptTransaction);
const storedVersions: ReturnType<CreativeVersionStore["getConceptVersions"]> = versionStore.getConceptVersions(conceptVersionsReadInput);
const runtimeConceptBatch: ReturnType<CreativeVersionRuntimeStorage["getConceptBatch"]> = versionStorage.getConceptBatch(conceptReadInput);
const runtimeBegin: Promise<Awaited<ReturnType<CreativeVersionStore["beginConceptBatch"]>>> = versionStorage.beginConceptBatch(beginConceptInput);
const runtimeAppend: Promise<Awaited<ReturnType<CreativeVersionStore["appendConceptEvent"]>>> = versionStorage.appendConceptEvent(appendConceptInput);
const runtimeBinding: Promise<Awaited<ReturnType<CreativeVersionStore["recordConceptDispatchBinding"]>>> =
  versionStorage.recordConceptDispatchBinding(dispatchBindingInput);
const runtimeStage: Promise<Awaited<ReturnType<CreativeVersionStore["stageConceptResponse"]>>> = versionStorage.stageConceptResponse(stagedResponseInput);
const runtimeBatch: Promise<Awaited<ReturnType<CreativeVersionStore["getConceptBatch"]>>> = versionStorage.getConceptBatch(conceptReadInput);
const runtimeResponseStage: Promise<Awaited<ReturnType<CreativeVersionStore["getConceptResponseStage"]>>> =
  versionStorage.getConceptResponseStage(responseStageReadInput);
const runtimeObjects: Promise<Awaited<ReturnType<CreativeVersionStore["prepareConceptArtifactObjects"]>>> =
  versionStorage.prepareConceptArtifactObjects(artifactPreparationInput);
const runtimePublication: Promise<Awaited<ReturnType<CreativeVersionStore["publishConceptBatch"]>>> =
  versionStorage.publishConceptBatch(conceptPublishInput, conceptTransaction);
const runtimeVersions: Promise<Awaited<ReturnType<CreativeVersionStore["getConceptVersions"]>>> =
  versionStorage.getConceptVersions(conceptVersionsReadInput);
declare const nativeProvider: ReturnType<typeof import("creative-engine/models").createOpenAIImagesProvider>;
declare const nativePreflightInput: Parameters<typeof nativeProvider.inspectConceptReferences>[0];
const nativePreflightOutput: Promise<readonly CreativeConceptReferenceInspection[]> =
  nativeProvider.inspectConceptReferences(nativePreflightInput);
const nativeConceptEditOutput = nativeProvider.edit(conceptProviderDispatch);

void [CREATIVE_API_OPERATIONS, requests, conceptsInvocation, conceptStatus, conceptsAsLegacy,
  v1_1Generate, forgedConceptSettlement, response, aliasResponse, publicError, authorizationInput,
  authorizationResult, immutableReservationReference, initialDecisionTransportId, decisionRetryIntent,
  initialInspectionTransportId, inspectionTransportIntent, inspectionReservationReference, providerReservationReference,
  rawProviderUsage, privacyFilteredUsage, publicationFence, predecodePixelCount, decodedPixelCount,
  finalManifestWidth, conceptStorageImplementer, conceptBatch, optionalConceptBegin, storedBegin,
  storedAppend, storedBinding, storedStage, storedBatch, storedResponseStage, storedObjects,
  publishedBatch, storedVersions, runtimeConceptBatch, nativePreflightOutput, nativeConceptEditOutput,
  runtimeBegin, runtimeAppend, runtimeBinding, runtimeStage, runtimeBatch, runtimeResponseStage,
  runtimeObjects, runtimePublication, runtimeVersions, unguardedSecondSourcePage, unguardedSecondStepSourcePage,
  twoPlanPages, twoStepPages, onePlanPage, oneStepPage, providerEditReader,
  legacyProviderPlan, nativeConceptPlan, nativePlanAsLegacyEditPlan, nativePlanBrief,
  fabricatedParentHash, conceptRouteInput, legacyRouteInput, routePlanReader];
