import assert from "node:assert/strict";
import test from "node:test";
import * as inspection from "creative-engine/inspection";

test("the package inspection subpath exports every declared symbol and its matching error constructor", () => {
  for (const name of [
    "INSPECTION_LIMITS", "INSPECTION_POLICY_VERSION", "INSPECTION_QUESTION_SCHEMA_VERSION", "REPAIR_LIMITS",
    "InspectionError", "canonicalInspectionSubjectHash", "copyInspectionArtifactBytes", "createInspectionDecisionPlan",
    "createInspectionEvidenceBatch", "createInspectionReport", "createInspectionRouteBatch",
    "createSqliteInspectionRepairController", "deterministicDecisionObservation", "evaluateHeldOutFixtures",
    "evaluateInspectionDecision", "inspectCreativeArtifact", "validateInspectionDecisionRequest", "validateVisualObservation",
  ]) assert.equal(Object.hasOwn(inspection, name), true, `missing runtime export ${name}`);
  const error = new inspection.InspectionError("invalid_request", "artifact_bytes", "Bounded message.");
  assert.ok(error instanceof Error);
  assert.equal(error.code, "invalid_request");
  assert.equal(error.contract, "CreativeDeterministicInspection");
  assert.equal(error.field, "artifact_bytes");
});
