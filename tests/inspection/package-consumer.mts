import {
  INSPECTION_LIMITS,
  INSPECTION_POLICY_VERSION,
  InspectionError,
  inspectCreativeArtifact,
  type CreativeInspectionReport,
  type InspectCreativeArtifactInput,
} from "creative-engine/inspection";

declare const input: InspectCreativeArtifactInput;
const deterministic = inspectCreativeArtifact(input);
const policy: string = INSPECTION_POLICY_VERSION;
const maxPixels: number = INSPECTION_LIMITS.maxPixels;
const error = new InspectionError("invalid_request", "artifact_bytes", "Bounded message.");
declare const report: CreativeInspectionReport;

void [deterministic, policy, maxPixels, error, report];
