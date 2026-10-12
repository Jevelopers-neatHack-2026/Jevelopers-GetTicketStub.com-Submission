import type {
	ArtifactRef,
	ComposeArtifactRequest,
	ExportBundleRequest,
	InspectArtifactRequest,
	CompareTemplateRequest,
	ArtifactStatusRequest,
	PersonalizeBatchRequest,
} from "@jevelopers/shared-contracts";
import type { SyntheticRecords } from "./records.js";
import { version } from "../../../src/api/canonical-values.js";

export function exportRequest(
	records: SyntheticRecords,
	artifact: ArtifactRef,
): ExportBundleRequest {
	return {
		contract: "ExportBundleRequest",
		...version,
		request_id: records.request.request_id,
		correlation_id: records.request.correlation_id,
		artifact_ref: artifact,
		spec_ref: records.request.binding.spec_ref,
		capability_ref: records.request.binding.capability_ref,
		approval_ref: records.request.binding.approval_ref,
		formats: records.template.export_formats,
		output_policy_ref: records.composition.policy_refs.output,
		idempotency_key: "canonical-export-1",
	};
}
export function inspectRequest(
	records: SyntheticRecords,
	artifact: ArtifactRef,
): InspectArtifactRequest {
	return {
		contract: "InspectArtifactRequest",
		...version,
		request_id: records.request.request_id,
		correlation_id: records.request.correlation_id,
		artifact_ref: artifact,
		spec_ref: records.request.binding.spec_ref,
		capability_ref: records.request.binding.capability_ref,
		inspection_policy_ref: records.composition.policy_refs.output,
	};
}
export function statusRequest(
	request: ComposeArtifactRequest,
	target: ArtifactStatusRequest["target"],
): ArtifactStatusRequest {
	return {
		contract: "ArtifactStatusRequest",
		...version,
		request_id: request.request_id,
		correlation_id: request.correlation_id,
		target,
	};
}
export function compareRequest(
	records: SyntheticRecords,
): CompareTemplateRequest {
	return {
		contract: "CompareTemplateRequest",
		...version,
		request_id: records.request.request_id,
		correlation_id: records.request.correlation_id,
		source_template_ref: records.request.binding.template_ref,
		target_template_ref: records.request.binding.template_ref,
		spec_ref: records.request.binding.spec_ref,
		capability_ref: records.request.binding.capability_ref,
	};
}
export function batchRequest(
	records: SyntheticRecords,
	policy: "atomic" | "allow_partial" = "atomic",
): PersonalizeBatchRequest {
	return {
		contract: "PersonalizeBatchRequest",
		...version,
		request_id: records.request.request_id,
		correlation_id: records.request.correlation_id,
		binding: records.request.binding,
		input: {
			kind: "structured",
			row_schema_ref: records.template.personalization_schema_ref,
			rows: [
				{
					row_id: "row-001",
					fields: { name: "Zoë O’Connor", detail: "Seat 0007 • Serial 000123" },
				},
				{
					row_id: "row-002",
					fields: { name: "Café Áda", detail: "Seat 0001 • Serial 000024" },
				},
			],
		},
		acceptance_policy: policy,
		idempotency_key: "canonical-batch-1",
	};
}
