import { z } from "zod";
import { recheckPermissions } from "../composition/private-model.js";
import { adaptInput } from "../api/canonical-layout.js";
import { restore, permissionModel } from "../api/canonical-artifacts.js";
import type { CanonicalInputs } from "../api/canonical-inputs.js";
import type { CandidateRuntime } from "../api/canonical-runtime.js";
import { contract, requireCandidate } from "../api/canonical-values.js";
import type { DurableBatchEngine } from "../jobs/durable-batch.js";
import type { Scope, Id } from "../internal/durability.js";

const snapshotSchema = z.object({
	composition: z.unknown(),
	artifact_ref: z.unknown(),
});
export async function refreshBatchPermissions(
	runtime: CandidateRuntime,
	inputs: CanonicalInputs,
	engine: DurableBatchEngine,
	scope: Scope,
	job: Id,
): Promise<void> {
	await recheckPermissions(
		permissionModel(inputs),
		inputs.ports,
		"export",
		Date.parse(runtime.now()),
	);
	for (
		let offset = 0;
		offset < runtime.host.db.limits.maxRows;
		offset += runtime.host.db.limits.pageSize
	) {
		const rows = engine.inventory(scope, job, offset);
		for (const row of rows) {
			if (row.publication === null) continue;
			const files = engine.store.retrieve(scope, row.publication).files;
			const state = files.find((f) => f.name === "canonical-row.json");
			const svg = files.find((f) => f.name === "output.svg");
			requireCandidate(
				state !== undefined && svg !== undefined,
				"INTEGRITY_FAILURE",
				"integrity",
			);
			const snapshot = snapshotSchema.parse(
				JSON.parse(Buffer.from(state.bytes).toString()),
			);
			const composition = contract("Composition", snapshot.composition);
			const ref = contract("ArtifactRef", snapshot.artifact_ref);
			const input = adaptInput(composition, inputs.profile, {
				layout: inputs.layout,
				factValues: inputs.factValues,
				rowId: row.operation,
			});
			const artifact = restore(
				{ ...inputs, input, composition },
				ref,
				Buffer.from(svg.bytes).toString(),
			);
			await recheckPermissions(
				artifact,
				inputs.ports,
				"export",
				Date.parse(runtime.now()),
			);
		}
		if (rows.length < runtime.host.db.limits.pageSize) break;
	}
}
