import { canonicalBatchRenderer } from "./canonical-renderer.js";
import { evidence } from "../api/canonical-preflight.js";
import { refreshBatchPermissions } from "./canonical-permissions.js";
export { jobStatus } from "./canonical-status.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
	JobRef,
	PersonalizeBatchRequest,
} from "@jevelopers/shared-contracts";
import { checkPersonalizationPlan } from "@jevelopers/shared-contracts/production-operations";
import { DurableBatchEngine } from "../jobs/durable-batch.js";
import { hash, scopeSchema } from "../internal/durability.js";
import type { CandidateRuntime } from "../api/canonical-runtime.js";
import { resolveInputs } from "../api/canonical-inputs.js";
import {
	checked,
	contentHash,
	contract,
	jsonBytes,
	requireCandidate,
	version,
} from "../api/canonical-values.js";

const planSchema = z
	.object({ private_scope: scopeSchema, request: z.unknown() })
	.strict();
export async function personalize(
	runtime: CandidateRuntime,
	request: PersonalizeBatchRequest,
): Promise<JobRef> {
	requireCandidate(
		request.input.kind === "structured",
		"CAPABILITY_DISABLED",
		"capability",
	);
	const inputs = await resolveInputs(runtime, request.binding);
	const planned = checked(
		checkPersonalizationPlan(request, {
			scope: runtime.context.scope,
			template: inputs.template,
			policy: inputs.personalization,
		}),
		"ROW_SCHEMA",
	);
	const operation = runtime.bind("personalizeArtifactBatch", request);
	const prior = runtime.state.get(`batch-plan:${operation.id}`);
	const plan =
		prior === null
			? {
					private_scope: {
						tenant: runtime.host.private_scope.tenant,
						project: randomUUID(),
					},
					request,
				}
			: planSchema.parse(prior);
	if (prior === null) runtime.state.put(`batch-plan:${operation.id}`, plan);
	const original = contract("PersonalizeBatchRequest", plan.request);
	const privateScope = scopeSchema.parse(plan.private_scope);
	const engine = new DurableBatchEngine(runtime.host.db);
	const requestBytes = jsonBytes({
		digest: runtime.semantic("personalizeArtifactBatch", request),
		planned,
	});
	const pins = jsonBytes({
		runtime: runtime.context.runtime,
		layout: inputs.composition.resolved_layout_commitment,
	});
	const job = engine.create(privateScope, {
		format: "structured",
		key: operation.id,
		request: requestBytes,
		requestDigest: hash(requestBytes),
		pins,
		pinsDigest: hash(pins),
		policy: planned.acceptance_policy,
		rows: planned.rows.map((row) => {
			const bytes = jsonBytes(row);
			return { id: row.row_id, bytes, digest: hash(bytes) };
		}),
	});
	const result = contract("JobRef", {
		contract: "JobRef",
		...version,
		job_ref: {
			contract: "JobStatus",
			schema_version: "1.0.0",
			id: job.id,
			revision: 1,
			content_hash: contentHash({
				plan: job.plan,
				pins: job.pins,
				scope: runtime.context.scope,
			}),
		},
		batch_input_hash: contentHash(request.input),
	});
	runtime.state.put(`job:${job.id}`, {
		plan: { private_scope: privateScope, request: original },
		result,
	});
	runtime.registerValue(result);
	if (prior !== null)
		await refreshBatchPermissions(
			runtime,
			inputs,
			engine,
			privateScope,
			job.id,
		);
	const signal = runtime.host.batch_signal;
	if (signal.aborted) engine.cancel(privateScope, job.id);
	while (
		await engine.runOne(
			privateScope,
			canonicalBatchRenderer(runtime, {
				reference: result,
				id: job.id,
				pins,
				request: original,
				rows: planned.rows,
			}),
			signal,
		)
	) {}
	const finished = engine.job(privateScope, job.id),
		progress = engine.progress(privateScope, job.id);
	const evidenceKey = `job-evidence:${job.id}:${contentHash({ job: finished, progress })}`;
	if (runtime.state.get(evidenceKey) === null)
		runtime.state.put(
			evidenceKey,
			evidence(runtime, {
				consumer_pin: inputs.contractPin,
				contract_candidate: inputs.contractPin.version,
				job: finished,
				progress,
				canonical_publication: "blocked",
				reason: "visible RowResult requires eligibility=eligible",
				original_request_hash: contentHash(original),
			}),
		);
	return result;
}
