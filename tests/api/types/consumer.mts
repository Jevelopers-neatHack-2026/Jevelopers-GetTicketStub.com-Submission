import {
  CreativeApiError,
  createCreativeApi,
  type CreativeApiRequest,
  type CreativeApiResponse,
  type CreativeRuntimePorts,
  type InspectionPortOutput,
  type TrustedCreativeActor,
} from "../../../src/api/v1.mjs";
import type { EditPlan } from "../../../src/contracts/creative/v1.mjs";
import { CreativeVersionStore } from "../../../src/versions/index.mjs";

declare const ports: CreativeRuntimePorts;
declare const principal: TrustedCreativeActor;
declare const request: CreativeApiRequest;
declare const plan: EditPlan;

const client = createCreativeApi({ ports, now: () => Date.now(), idFactory: () => "consumer-id" });
const response: Promise<CreativeApiResponse> = client.invoke(principal, request);
const rawInspection: InspectionPortOutput = {
  status: "complete",
  observer: { type: "model", id: "typecheck-inspector", model_id: "fixture-vision/1.0" },
  uncertainty: { status: "unknown", note: "not_independently_measured" },
  findings: [],
  usage: { completeness: "complete", input_tokens: 2, output_tokens: 4 },
};
const rawInspect: NonNullable<CreativeRuntimePorts["inspection"]>["inspect"] = async () => rawInspection;
const error = new CreativeApiError("unavailable", "generate", "provider", { retryable: true });
const code: string = error.code;
const stepCount: number = plan.steps.length;

void response;
void code;
void stepCount;
void rawInspect;

declare const versionStore: CreativeVersionStore;
const briefReadWithoutMigration = versionStore.getBrief({
  scope: { tenant_id: "tenant", project_id: "project" }, brief_id: "brief",
}, { allowLegacyHistoryBackfill: false });
const briefUsabilityWithoutMigration = versionStore.isBriefUsable({
  scope: { tenant_id: "tenant", project_id: "project" }, brief_id: "brief",
}, { allowLegacyHistoryBackfill: false });
void briefReadWithoutMigration;
void briefUsabilityWithoutMigration;
