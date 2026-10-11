import { z } from "zod";
import { productionContentHash } from "@jevelopers/shared-contracts/production-operations";
import type {
	JobRef,
	PersonalizeBatchRequest,
} from "@jevelopers/shared-contracts";
import type { RendererPort } from "../jobs/durable-batch.js";
import { hash, type Id } from "../internal/durability.js";
import { composeArtifact } from "../composition/private-model.js";
import { exportPrivateFiles } from "../exporters/private-output.js";
import { outputFile } from "../exporters/private-policy.js";
import { assembleCanonicalBundle } from "../manifests/canonical-bundle.js";
import type { CandidateRuntime } from "../api/canonical-runtime.js";
import { resolveInputs } from "../api/canonical-inputs.js";
import { adaptInput, layoutCommitment } from "../api/canonical-layout.js";
import { artifactReference } from "../api/canonical-artifacts.js";
import { candidateOutputPolicy } from "../api/canonical-output-policy.js";
import {
	contentHash,
	jsonBytes,
	requireCandidate,
	sha,
	same,
} from "../api/canonical-values.js";
const rowSchema = z
	.object({
		row_id: z.string(),
		ordinal: z.number().int(),
		input_hash: z.string(),
		fields: z.record(z.string(), z.string()),
	})
	.strict();
export function canonicalBatchRenderer(
	runtime: CandidateRuntime,
	job: {
		readonly reference: JobRef;
		readonly id: Id;
		readonly pins: Uint8Array;
		readonly request: PersonalizeBatchRequest;
		readonly rows: readonly Readonly<ReturnType<typeof rowSchema.parse>>[];
	},
): RendererPort {
	return async (claim, abort) => {
		abort.throwIfAborted();
		requireCandidate(
			claim.job === job.id && hash(claim.pins) === hash(job.pins),
			"INTEGRITY_FAILURE",
			"integrity",
		);
		const row = rowSchema.parse(
			JSON.parse(Buffer.from(claim.input).toString()),
		);
		const current = await resolveInputs(runtime, job.request.binding);
		requireCandidate(
			row.ordinal === claim.ordinal && same(job.rows[claim.ordinal], row),
			"HASH_MISMATCH",
		);
		const values = Object.fromEntries(
			Object.entries(row.fields).map(([key, value]) => [
				key,
				{ kind: "display" as const, value },
			]),
		);
		const initial = {
			...current.composition,
			composition_id: claim.operation,
			revision: 1,
			values,
			input_binding_hash: contentHash({
				values,
				fact_bindings: current.composition.fact_bindings,
				facts_ref: current.composition.facts_ref,
				formatting: current.composition.policy_refs.formatting,
			}),
		};
		const privateInput = adaptInput(initial, current.profile, {
			layout: current.layout,
			factValues: current.factValues,
			rowId: claim.operation,
		});
		const withLayout = {
			...initial,
			resolved_layout_commitment: layoutCommitment(
				privateInput,
				current.profile,
				current.layout,
			),
		};
		const composition = {
			...withLayout,
			content_hash: productionContentHash(withLayout),
		};
		const artifact = await composeArtifact(
			privateInput,
			current.layout,
			current.profile.fonts.map((f) => f.font),
			current.ports,
			Date.parse(runtime.now()),
		);
		const artifactRef = artifactReference(
			artifact,
			{
				contract: "Composition",
				schema_version: "1.0.0",
				id: composition.composition_id,
				revision: 1,
				content_hash: composition.content_hash,
			},
			claim.operation,
		);
		const exported = await exportPrivateFiles({
			artifact,
			constraints: current.profile.constraints,
			ports: current.ports,
			now: Date.parse(runtime.now()),
			policy: candidateOutputPolicy(current.profile.output_policy),
		});
		const bundle = assembleCanonicalBundle(runtime, {
			exported,
			inputs: { ...current, composition, input: privateInput },
			artifact: artifactRef,
			correlation_id: job.request.correlation_id,
			attempt: claim.attempt,
			row_scope: {
				job_ref: job.reference,
				row_id: row.row_id,
				ordinal: row.ordinal,
				input_hash: sha(row.input_hash),
			},
		});
		abort.throwIfAborted();
		return [
			...bundle.files,
			outputFile(
				"canonical-row.json",
				jsonBytes({
					row,
					composition,
					artifact_ref: artifactRef,
					bundle_ref: bundle.commitment,
					canonical_publication: "blocked",
					reason: "OWNER_ACCEPTANCE_PENDING",
				}),
			),
		];
	};
}
