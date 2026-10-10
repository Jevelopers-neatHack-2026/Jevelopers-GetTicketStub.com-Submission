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
} from "../../src/inspection/index.mjs";
import type { DecisionPortRequest, DecisionPortResult } from "../../src/contracts/decision-port/v1.mjs";
import type { TrustedScope } from "../../src/contracts/creative/v1.mjs";

declare const inspectionInput: InspectCreativeArtifactInput;
declare const rawObservation: unknown;
declare const trustedScope: TrustedScope;
declare const decisionContext: InspectionDecisionContext;
declare const firstRequest: DecisionPortRequest;
declare const firstResult: DecisionPortResult;
declare const routeRequest: DecisionPortRequest;
declare const routeResult: DecisionPortResult;
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
  const batch = createInspectionEvidenceBatch(plan, observation);
  const route = createInspectionRouteBatch(plan, firstRequest, firstResult, trustedScope);
  if (route.status === "ready") {
    const decision = evaluateInspectionDecision(plan, firstRequest, firstResult, routeRequest, routeResult, trustedScope);
    const report: CreativeInspectionReport = createInspectionReport({ deterministic, decision, observations: [observation] });
    evaluateHeldOutFixtures({
      schema_version: "1.0",
      corpus_hash: subjectHash,
      cases: [{ expected_defect: false, predicted_defect: false, report, latency_ms: 1,
        downstream_cost: { status: "unknown" } }],
    });
  }
  validateInspectionDecisionRequest({ ...batch, ...decisionContext,
    contract: "DecisionPortRequest", schema_version: "1.0", tenant_id: deterministic.tenant_id,
    project_id: deterministic.project_id, source_refs: [observation.source.source_ref],
    request_id: decisionContext.request_id, logical_operation_id: decisionContext.logical_operation_id,
    billable_attempt_id: decisionContext.billable_attempt_id, attempt_number: decisionContext.attempt_number,
    attempt_limit: decisionContext.attempt_limit, budget_ref: decisionContext.budget_ref,
    deadline_at: decisionContext.deadline_at, cancellation_ref: decisionContext.cancellation_ref,
    model_policy: decisionContext.model_policy, execution_mode: batch.execution_mode,
    state: batch.state, questions: batch.questions }, trustedScope);
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
