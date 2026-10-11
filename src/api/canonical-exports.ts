import { z } from "zod";
import type {
	ArtifactRef,
	ExportBundleRequest,
} from "@jevelopers/shared-contracts";
import { verifyProductionBundleFiles } from "@jevelopers/shared-contracts/production-operations";
import { exportPrivateFiles } from "../exporters/private-output.js";
import { finalFileEvidence } from "../preflight/private-inspection.js";
import { assembleCanonicalBundle } from "../manifests/canonical-bundle.js";
import { executeCanonical } from "../storage/canonical-execution.js";
import { candidateOutputPolicy } from "./canonical-output-policy.js";
import type { CandidateRuntime } from "./canonical-runtime.js";
import { readArtifact } from "./canonical-artifacts.js";
import {
	checked,
	contract,
	requireCandidate,
	same,
} from "./canonical-values.js";

const publicationSchema = z
	.object({
		publication: z.string(),
		value: z
			.object({
				commitment: z.unknown(),
				report: z.unknown(),
				evidence: z.array(z.unknown()),
			})
			.strict(),
	})
	.strict();
export async function exportBundle(
	runtime: CandidateRuntime,
	request: ExportBundleRequest,
) {
	const stored = await readArtifact(runtime, request.artifact_ref);
	for (const [given, expected] of [
		[request.approval_ref, stored.inputs.approval_ref],
		[request.spec_ref, stored.inputs.composition.spec_ref],
		[request.capability_ref, stored.inputs.composition.capability_ref],
		[request.output_policy_ref, stored.inputs.composition.policy_refs.output],
	] as const)
		requireCandidate(same(given, expected), "HASH_MISMATCH");
	requireCandidate(
		same(request.formats, stored.inputs.layout.exports),
		"OUTPUT_UNSUPPORTED",
		"output",
	);
	const operation = runtime.bind("exportArtifactBundle", request);
	const prior = runtime.state.get(`export:${operation.id}`);
	if (prior !== null) return readBundleRecord(runtime, prior).commitment;
	return executeCanonical(runtime.host.db, operation.id, async (attempt) => {
		const exported = await exportPrivateFiles({
			artifact: stored.artifact,
			constraints: stored.inputs.profile.constraints,
			ports: stored.inputs.ports,
			now: Date.parse(runtime.now()),
			policy: candidateOutputPolicy(stored.inputs.profile.output_policy),
		});
		const result = assembleCanonicalBundle(runtime, {
			exported,
			inputs: stored.inputs,
			artifact: request.artifact_ref,
			correlation_id: request.correlation_id,
			attempt,
		});
		const record = {
			commitment: result.commitment,
			report: result.report,
			evidence: exported.evidence,
		};
		runtime.state.publish(operation.id, result.files, {
			attempt,
			records: [
				[`export:${operation.id}`, record],
				[`bundle:${request.artifact_ref.artifact_ref.id}`, record],
			],
		});
		runtime.registerValue(result.commitment);
		return result.commitment;
	});
}
export function readBundle(runtime: CandidateRuntime, artifact: ArtifactRef) {
	const raw = runtime.state.get(`bundle:${artifact.artifact_ref.id}`);
	if (raw === null) return null;
	return readBundleRecord(runtime, raw);
}
function readBundleRecord(runtime: CandidateRuntime, raw: unknown) {
	const record = publicationSchema.parse(raw);
	const commitment = contract("ProductionBundleRef", record.value.commitment);
	const files = runtime.state.read(record.publication);
	const verification = checked(
		verifyProductionBundleFiles(
			files.map((f) => ({ filename: f.name, bytes: f.bytes })),
			{ scope: runtime.context.scope, trusted_commitment: commitment },
		),
		"INTEGRITY_FAILURE",
	);
	const report = contract("PreflightReport", record.value.report);
	requireCandidate(
		same(report.report_ref, verification.bundle.preflight.report_ref),
		"HASH_MISMATCH",
	);
	const evidence = record.value.evidence.map((value) => {
		const stored = z
			.object({ bindingHash: z.string() })
			.passthrough()
			.parse(value);
		const parsed = finalFileEvidence(
			Object.fromEntries(
				Object.entries(stored).filter(([key]) => key !== "bindingHash"),
			),
		);
		requireCandidate(
			parsed.bindingHash === stored.bindingHash,
			"HASH_MISMATCH",
		);
		return parsed;
	});
	return { commitment, verification, files, report, evidence };
}
