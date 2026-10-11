import { z } from "zod";
import {
	canonical,
	digest,
	fingerprint,
	parse,
} from "../composition/primitives.js";
import type { Scope } from "../internal/durability.js";
import { composeArtifact } from "../composition/private-model.js";
import { CompositionError } from "../composition/primitives.js";
import { DurableBatchEngine } from "../jobs/durable-batch.js";
import type { RendererPort, RowClaim } from "../jobs/durable-batch.js";
import { hash, identity, scopeKey, idSchema } from "../internal/durability.js";
import {
	OutputError,
	outputFile,
	requireOutput,
} from "../exporters/private-policy.js";
import { exportPrivateFiles } from "../exporters/private-output.js";
import { assemblePrivateArchive } from "../manifests/private-inventory.js";
import { plannedRowSchema, personalizeInput } from "./private-rows.js";
import { pinBytes } from "./private-batch.js";
import type { BatchContext } from "./private-batch.js";
import { LocalArtifactStore } from "../storage/local-store.js";
export function privateBatchRenderer(
	context: BatchContext,
	store: LocalArtifactStore,
): RendererPort {
	const pins = pinBytes(context);
	return async (claim, signal) => {
		signal.throwIfAborted();
		requireOutput(
			hash(claim.pins) === hash(pins),
			"OUTPUT_INTEGRITY",
			"batch.pins",
		);
		const planned = parse(
			plannedRowSchema,
			JSON.parse(Buffer.from(claim.input).toString()),
		);
		requireOutput(
			planned.ordinal === claim.ordinal &&
				(planned.errors.length > 0 ||
					planned.inputDigest === fingerprint(planned.row)),
			"OUTPUT_INTEGRITY",
			"batch.row",
		);
		try {
			const input = personalizeInput(context.input, planned, context.rows);
			const artifact = await composeArtifact(
				input,
				context.layout,
				context.fonts,
				context.ports,
				context.now(),
			);
			const exported = await exportPrivateFiles({
				artifact,
				constraints: context.constraints,
				ports: context.ports,
				now: context.now(),
				policy: context.output,
			});
			signal.throwIfAborted();
			const archive = await assemblePrivateArchive(
				exported,
				{
					artifact,
					constraints: context.constraints,
					ports: context.ports,
					now: context.now(),
					policy: context.output,
				},
				{
					batchDigest: fingerprint({
						job: claim.job,
						pins: digest(claim.pins),
					}),
					jobRef: claim.job,
					rowOperationRef: claim.operation,
					rowDigest: digest(planned.row.rowId),
					ordinal: planned.ordinal,
					inputDigest: planned.inputDigest,
					previewDigest: null,
					repairPolicyDigest: null,
					...(planned.csv
						? {
								csvFileDigest: planned.csv.checkpoint.fileDigest,
								csvPolicyDigest: planned.csv.checkpoint.policyDigest,
							}
						: {}),
				},
			);
			return archive.files;
		} catch (error) {
			if (error instanceof OutputError || error instanceof CompositionError) {
				const bytes = Buffer.from(
					canonical({
						privateDiagnosticVersion: 1,
						job: claim.job,
						ordinal: claim.ordinal,
						attempt: claim.attempt,
						inputDigest: planned.inputDigest,
						state: "failed",
						code: error.code,
						path: error.path,
						handoffEligible: false,
					}),
				);
				const operation = store.bind(
					context.input.scope,
					"private-output-diagnostic",
					identity([claim.job, String(claim.ordinal), claim.attempt]),
					bytes,
					hash(bytes),
				);
				const stage = store.stage(context.input.scope, operation.id),
					file = outputFile("diagnostic.json", bytes);
				store.write(context.input.scope, stage, file);
				store.publish(context.input.scope, stage, [file]);
			}
			throw error;
		}
	};
}
export async function runPrivateBatch(request: {
	readonly engine: DurableBatchEngine;
	readonly context: BatchContext;
	readonly signal: AbortSignal;
}) {
	const renderer = privateBatchRenderer(request.context, request.engine.store);
	while (!request.signal.aborted) {
		const results = await Promise.all(
			Array.from({ length: request.engine.db.limits.concurrency }, () =>
				request.engine.runOne(
					request.context.input.scope,
					renderer,
					request.signal,
				),
			),
		);
		if (results.every((r) => !r)) return;
	}
}

export function rowDiagnostic(
	store: LocalArtifactStore,
	scope: Scope,
	row: Pick<RowClaim, "job" | "ordinal" | "attempt">,
) {
	const operation = store.db.sql
		.prepare("SELECT id FROM operations WHERE scope=? AND key=?")
		.get(
			scopeKey(scope),
			identity([
				"private-output-diagnostic",
				identity([row.job, String(row.ordinal), row.attempt]),
			]),
		);
	if (!operation) return null;
	const publication = store.publication(scope, idSchema.parse(operation["id"]));
	requireOutput(
		publication !== null,
		"OUTPUT_INTEGRITY",
		"diagnostic.publication",
	);
	const file = store
		.retrieve(scope, publication.id)
		.files.find((f) => f.name === "diagnostic.json");
	requireOutput(file !== undefined, "OUTPUT_INTEGRITY", "diagnostic.file");
	return parse(
		z
			.object({
				privateDiagnosticVersion: z.literal(1),
				job: idSchema,
				ordinal: z.number().int(),
				attempt: idSchema,
				inputDigest: z.string().regex(/^[a-f0-9]{64}$/),
				state: z.literal("failed"),
				code: z.string().max(100),
				path: z.string().max(256),
				handoffEligible: z.literal(false),
			})
			.strict()
			.readonly(),
		JSON.parse(Buffer.from(file.bytes).toString()),
	);
}
