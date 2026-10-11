import type {
	ArtifactStatusRequest,
	CompareTemplateRequest,
	InspectArtifactRequest,
} from "@jevelopers/shared-contracts";
import { compareProductionTemplates } from "@jevelopers/shared-contracts/production-operations";
import { inspectArtifact as inspectPrivate } from "../preflight/private-inspection.js";
import { compareTemplateCompatibility } from "../templates/private-layout.js";
import type { CandidateRuntime } from "./canonical-runtime.js";
import { readArtifact } from "./canonical-artifacts.js";
import { readBundle } from "./canonical-exports.js";
import { adaptLayout } from "./canonical-layout.js";
import { blocked, projectPreflight } from "./canonical-preflight.js";
import {
	checked,
	contract,
	requireCandidate,
	same,
	version,
} from "./canonical-values.js";

export async function inspect(
	runtime: CandidateRuntime,
	request: InspectArtifactRequest,
) {
	const stored = await readArtifact(runtime, request.artifact_ref);
	requireCandidate(
		same(request.spec_ref, stored.inputs.composition.spec_ref) &&
			same(request.capability_ref, stored.inputs.composition.capability_ref) &&
			same(request.inspection_policy_ref, runtime.host.inspection_policy_ref),
		"HASH_MISMATCH",
	);
	const bundle = readBundle(runtime, request.artifact_ref);
	const report = await inspectPrivate(
		stored.artifact,
		stored.inputs.profile.constraints,
		stored.inputs.ports,
		Date.parse(runtime.now()),
		bundle?.evidence ?? [],
	);
	return projectPreflight(runtime, {
		artifact: request.artifact_ref,
		inputs: stored.inputs,
		report,
		fileEvidence: bundle?.evidence ?? [],
		files: bundle?.commitment.file_set ?? [],
	});
}
export async function compare(
	runtime: CandidateRuntime,
	request: CompareTemplateRequest,
) {
	const prior = await runtime.resolve(request.source_template_ref),
		current = await runtime.resolve(request.target_template_ref);
	requireCandidate(
		same(request.spec_ref, current.spec_ref) &&
			same(request.capability_ref, current.capability_ref),
		"HASH_MISMATCH",
	);
	await runtime.resolve(request.spec_ref);
	await runtime.resolve(request.capability_ref);
	const delta = checked(
		compareProductionTemplates(prior, current, runtime.context.scope),
	);
	const profile = runtime.profile(request.target_template_ref);
	const result = compareTemplateCompatibility(
		adaptLayout(
			prior,
			runtime.profile(request.source_template_ref),
			runtime.context.scope,
		),
		adaptLayout(current, profile, runtime.context.scope),
		profile.constraints,
	);
	const fields: Readonly<Record<string, readonly string[]>> = {
		coordinate_geometry: ["canvas", "trim", "bleed", "safe"],
		orientation: ["orientation"],
		minimum_effective_dpi: ["dpi"],
		export_formats: ["formats"],
		font_refs: ["fonts"],
		slots: ["slots"],
		spec_ref: ["spec"],
		capability_ref: ["capability"],
	};
	return contract("CompatibilityReport", {
		contract: "CompatibilityReport",
		...version,
		source_template_ref: request.source_template_ref,
		target_template_ref: request.target_template_ref,
		capability_ref: request.capability_ref,
		spec_ref: request.spec_ref,
		state: result.state,
		reasons: result.reasons,
		changed_constraints: [
			...new Set(
				delta.changed_fields.flatMap((field) => fields[field] ?? ["policies"]),
			),
		],
		relayout: delta.relayout || result.relayout,
		reapproval: delta.reapproval || result.reapproval,
	});
}
export async function artifactStatus(
	runtime: CandidateRuntime,
	request: ArtifactStatusRequest,
) {
	requireCandidate(request.target.kind === "artifact", "INVALID_INPUT");
	await readArtifact(runtime, request.target.artifact_ref);
	const bundle = readBundle(runtime, request.target.artifact_ref);
	return contract("ArtifactManifestStatus", {
		contract: "ArtifactManifestStatus",
		...version,
		target: request.target,
		status: "completed",
		bundle_ref: bundle?.commitment ?? null,
		batch: null,
		integrity: bundle ? "passed" : "unknown",
		eligibility: blocked(runtime),
		evidence_refs: bundle ? [bundle.report.report_ref] : [],
	});
}
