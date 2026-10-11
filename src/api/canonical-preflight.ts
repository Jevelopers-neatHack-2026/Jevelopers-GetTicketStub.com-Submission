import { randomUUID } from "node:crypto";
import type {
	ArtifactFile,
	ArtifactRef,
	PreflightReport,
	ProductionResource,
} from "@jevelopers/shared-contracts";
import {
	productionContentHash,
	checkProductionPreflight,
} from "@jevelopers/shared-contracts/production-operations";
import { inspectArtifact as inspectPrivate } from "../preflight/private-inspection.js";
import type { FinalFileEvidence } from "../preflight/private-inspection.js";
import type { CandidateRuntime } from "./canonical-runtime.js";
import type { CanonicalInputs } from "./canonical-inputs.js";
import {
	byteHash,
	contentHash,
	contract,
	jsonBytes,
	sha,
	version,
	checked,
} from "./canonical-values.js";

export function blocked(
	runtime: CandidateRuntime,
): PreflightReport["eligibility"] {
	return {
		state: "blocked",
		reason_codes: ["OWNER_ACCEPTANCE_PENDING"],
		checked_at: runtime.now(),
		evidence_mode: runtime.context.evidence_mode,
		handoff_eligible: false,
	};
}
export function evidence(
	runtime: CandidateRuntime,
	value: unknown,
): ProductionResource {
	const raw = contract("ProductionResource", {
		contract: "ProductionResource",
		...version,
		...runtime.context.scope,
		id: randomUUID(),
		revision: 1,
		kind: "lineage",
		byte_hash: byteHash(jsonBytes(value)),
		license_ref: null,
		content_hash: sha(`sha256:${"0".repeat(64)}`),
	});
	const record = { ...raw, content_hash: productionContentHash(raw) };
	runtime.state.put(`evidence:${record.id}`, { record, value });
	return record;
}
export function resourceRef(value: ProductionResource) {
	return {
		contract: "ProductionResource" as const,
		schema_version: "1.0.0" as const,
		id: value.id,
		revision: value.revision,
		content_hash: value.content_hash,
	};
}
export function projectPreflight(
	runtime: CandidateRuntime,
	request: {
		readonly artifact: ArtifactRef;
		readonly inputs: CanonicalInputs;
		readonly report: Awaited<ReturnType<typeof inspectPrivate>>;
		readonly fileEvidence: readonly FinalFileEvidence[];
		readonly files: readonly ArtifactFile[];
	},
): PreflightReport {
	const { artifact, inputs, report, fileEvidence, files } = request;
	const proof = resourceRef(evidence(runtime, { report, fileEvidence, files }));
	const parser = inputs.composition.runtime_ref;
	const body: PreflightReport["body"] = {
		artifact_ref: artifact,
		spec_ref: inputs.composition.spec_ref,
		rule_ref: runtime.host.inspection_policy_ref,
		status: report.draftReady
			? "passed"
			: report.modelReady
				? "unknown"
				: "failed",
		model_ready: report.modelReady,
		files_ready: report.filesReady,
		checked_files: fileEvidence.map((file) => ({
			file_hash: sha(`sha256:${file.fileDigest}`),
			parser_ref: parser,
			checks: file.checks.map((check) => ({
				name: check.name,
				state: check.state,
				evidence_ref: proof,
			})),
			composition_hash: artifact.composition_ref.content_hash,
			render_hash: artifact.render_hash,
			semantic_hash:
				files.find((f) => f.byte_hash === sha(`sha256:${file.fileDigest}`))
					?.semantic_hash ?? null,
		})),
		findings: report.findings
			.filter((f) => f.state === "failed" || f.state === "unsupported")
			.map((finding) => ({
				code: "PREFLIGHT_FAILED",
				severity: finding.severity,
				state: finding.state,
				field_path: "/preflight",
				rule_ref: runtime.host.inspection_policy_ref,
				spec_ref: inputs.composition.spec_ref,
				unit: "state",
				observed: finding.code,
				expected: "private preflight rule passed",
				repair_eligible: finding.repairEligible,
				evidence_ref: proof,
			})),
	};
	const value = contract("PreflightReport", {
		contract: "PreflightReport",
		...version,
		report_ref: {
			contract: "PreflightReport",
			schema_version: "1.0.0",
			id: randomUUID(),
			revision: 1,
			content_hash: contentHash(body),
		},
		body,
		eligibility: blocked(runtime),
	});
	if (value.body.status === "passed")
		checked(
			checkProductionPreflight(value, {
				artifact_ref: artifact,
				spec_ref: inputs.composition.spec_ref,
				rule_ref: runtime.host.inspection_policy_ref,
				parser_ref: parser,
				files,
			}),
			"PREFLIGHT_FAILED",
		);
	runtime.state.put(`preflight:${value.report_ref.id}`, value);
	return value;
}
