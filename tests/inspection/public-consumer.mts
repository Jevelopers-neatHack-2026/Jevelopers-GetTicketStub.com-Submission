import {
  INSPECTION_LIMITS,
  INSPECTION_POLICY_VERSION,
  INSPECTION_QUESTION_SCHEMA_VERSION,
  REPAIR_LIMITS,
  InspectionError,
  canonicalInspectionSubjectHash,
  copyInspectionArtifactBytes,
  createInspectionDecisionPlan,
  createInspectionEvidenceBatch,
  createInspectionReport,
  createInspectionRouteBatch,
  createSqliteInspectionRepairController,
  deterministicDecisionObservation,
  evaluateHeldOutFixtures,
  evaluateInspectionDecision,
  inspectCreativeArtifact,
  validateInspectionDecisionRequest,
  validateVisualObservation,
} from "../../src/inspection/index.mjs";
import type {
  CreativeInspectionReport,
  CreativeVisualObservation,
  DeterministicInspection,
  InspectionDecisionContext,
  InspectCreativeArtifactInput,
  InspectionErrorShape,
  InspectionQuestionPlan,
  InspectionRouteDecisionContext,
  InspectionTrustedScope,
} from "../../src/inspection/index.mjs";
import type { DecisionPortRequest, DecisionPortResult } from "../../src/contracts/decision-port/v1.mjs";

declare const inspectionInput: InspectCreativeArtifactInput;
declare const rawObservation: unknown;
declare const trustedScope: InspectionTrustedScope;
declare const decisionContext: InspectionDecisionContext;
declare const firstResult: DecisionPortResult;
declare const routeResult: DecisionPortResult;
declare const routeDecisionContext: InspectionRouteDecisionContext;
declare const database: unknown;

const deterministic: DeterministicInspection = inspectCreativeArtifact(inspectionInput);
const artifactCopy: Uint8Array = copyInspectionArtifactBytes(deterministic);
const subjectHash: string = canonicalInspectionSubjectHash(deterministic);
const observation: CreativeVisualObservation = validateVisualObservation(rawObservation, deterministic);
const decisionObservation = deterministicDecisionObservation(observation);
const planResult = createInspectionDecisionPlan({ deterministic, observation, decision_context: decisionContext });
const errorShape: InspectionErrorShape = new InspectionError("invalid_request", "artifact_bytes", "Bounded example.");
const errorContract: "CreativeDeterministicInspection" = errorShape.contract;
const publicConstants = [INSPECTION_LIMITS.maxArtifactBytes, REPAIR_LIMITS.maxRepairs,
  INSPECTION_POLICY_VERSION, INSPECTION_QUESTION_SCHEMA_VERSION, errorContract] as const;

if (planResult.status === "ready") {
  const plan: InspectionQuestionPlan = planResult;
  const firstRequest: DecisionPortRequest = createInspectionEvidenceBatch(plan, observation);
  validateInspectionDecisionRequest(firstRequest, trustedScope);
  const route = createInspectionRouteBatch(plan, firstRequest, firstResult, trustedScope, routeDecisionContext);
  if ("contract" in route && route.contract === "DecisionPortRequest") {
    const decision = evaluateInspectionDecision(plan, firstRequest, firstResult, route, routeResult, trustedScope);
    const report: CreativeInspectionReport = createInspectionReport({ deterministic, decision, observations: [observation] });
    evaluateHeldOutFixtures({
      schema_version: "1.0",
      corpus_hash: subjectHash,
      cases: [{ expected_defect: false, predicted_defect: false, report, latency_ms: 1,
        downstream_cost: { status: "unknown" } }],
    });
  }
}

const repairController = createSqliteInspectionRepairController({ database });
repairController.startInspection({ scope: { ...trustedScope, brief_id: "brief-1", design_version_id: "design-1" },
  inspection_id: "inspection-1", brief_hash: subjectHash, design_hash: subjectHash });
repairController.recordRepairClaim({ scope: { ...trustedScope, brief_id: "brief-1", design_version_id: "design-1" },
  inspection_id: "inspection-1", action_id: "repair-1", request_hash: subjectHash,
  repair_action: "image.edit", simulated_units: 1 });

void artifactCopy;
void decisionObservation;
void publicConstants;
