import { z } from "zod";
import type { ArtifactStatusRequest } from "@jevelopers/shared-contracts";
import { DurableBatchEngine } from "../jobs/durable-batch.js";
import { scopeSchema, idSchema } from "../internal/durability.js";
import type { CandidateRuntime } from "../api/canonical-runtime.js";
import { blocked, resourceRef } from "../api/canonical-preflight.js";
import { resolveInputs } from "../api/canonical-inputs.js";
import {
	contentHash,
	contract,
	requireCandidate,
	same,
	version,
} from "../api/canonical-values.js";
const planSchema = z
	.object({ private_scope: scopeSchema, request: z.unknown() })
	.strict();
const jobRecordSchema = z
	.object({ plan: planSchema, result: z.unknown() })
	.strict();
export async function jobStatus(
	runtime: CandidateRuntime,
	request: ArtifactStatusRequest,
) {
	requireCandidate(request.target.kind === "job", "INVALID_INPUT");
	const raw = runtime.state.get(`job:${request.target.job_ref.job_ref.id}`);
	requireCandidate(raw !== null, "NOT_FOUND", "access");
	const record = jobRecordSchema.parse(raw);
	const original = contract("PersonalizeBatchRequest", record.plan.request);
	await resolveInputs(runtime, original.binding);
	const jobRef = contract("JobRef", record.result);
	requireCandidate(same(jobRef, request.target.job_ref), "HASH_MISMATCH");
	const engine = new DurableBatchEngine(runtime.host.db);
	const job = engine.job(
		record.plan.private_scope,
		idSchema.parse(jobRef.job_ref.id),
	);
	const progress = engine.progress(record.plan.private_scope, job.id);
	const status =
		job.status === "succeeded"
			? "completed"
			: job.status === "partially_succeeded"
				? "partial"
				: job.status === "queued" || job.status === "running"
					? "processing"
					: job.status;
	const proof = runtime.state.get(
		`job-evidence:${job.id}:${contentHash({ job, progress })}`,
	);
	return contract("ArtifactManifestStatus", {
		contract: "ArtifactManifestStatus",
		...version,
		target: request.target,
		status,
		bundle_ref: null,
		batch: null,
		integrity: "unknown",
		eligibility: blocked(runtime),
		evidence_refs:
			proof === null
				? []
				: [contract("ProductionResource", proof)].map(resourceRef),
	});
}
