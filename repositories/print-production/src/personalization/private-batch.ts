import { canonical, fingerprint, parse } from "../composition/primitives.js";
import type {
	CompositionInput,
	CompositionPorts,
} from "../composition/private-model.js";
import type {
	PrivateLayout,
	ResolvedConstraints,
} from "../templates/private-layout.js";
import type { PinnedFont } from "../typography/private-text.js";
import { DurableBatchEngine } from "../jobs/durable-batch.js";
import type { BatchPolicy, Job } from "../jobs/durable-batch.js";
import { hash } from "../internal/durability.js";
import type { Id, Scope } from "../internal/durability.js";
import {
	plannedRowSchema,
	planRows,
	resolveRowPolicy,
} from "./private-rows.js";
import type { RowPolicy } from "./private-rows.js";
import type { CsvRow } from "./private-csv-policy.js";
import type { OutputPolicy } from "../exporters/private-policy.js";
import { requireOutput } from "../exporters/private-policy.js";
import { rowDiagnostic } from "./private-batch-renderer.js";

export type BatchContext = {
	readonly input: CompositionInput;
	readonly layout: PrivateLayout;
	readonly constraints: ResolvedConstraints | null;
	readonly fonts: readonly PinnedFont[];
	readonly ports: CompositionPorts;
	readonly now: () => number;
	readonly rows: RowPolicy;
	readonly output: OutputPolicy;
};
export function pinBytes(context: BatchContext): Buffer {
	return Buffer.from(
		canonical({
			input: context.input,
			layout: context.layout,
			constraints: context.constraints,
			fonts: context.fonts.map((f) => f.descriptor),
			rows: context.rows,
			output: context.output,
		}),
	);
}
export function createPrivateBatch(request: {
	readonly engine: DurableBatchEngine;
	readonly key: string;
	readonly context: BatchContext;
	readonly rows: unknown;
	readonly csvRows?: readonly CsvRow[];
	readonly policy?: BatchPolicy;
}): Job {
	const { engine, context } = request,
		policy = resolveRowPolicy(context.rows, context.input),
		rows = planRows(request.rows, policy).map((row, index) => {
			const csv = request.csvRows?.[index];
			if (!csv) return row;
			requireOutput(
				fingerprint(row.row) === fingerprint(csv.row),
				"OUTPUT_INTEGRITY",
				"csv.rowJoin",
			);
			return {
				...row,
				csv: {
					checkpoint: csv.checkpoint,
					logicalRecord: csv.logicalRecord,
					physicalLine: csv.physicalLine,
					sourcePaths: csv.sourcePaths,
				},
			};
		});
	requireOutput(
		request.csvRows === undefined || request.csvRows.length === rows.length,
		"OUTPUT_INTEGRITY",
		"csv.rowCount",
	);
	const pins = pinBytes(context),
		bytes = Buffer.from(
			canonical({
				privateBatchVersion: 1,
				rows: rows.map((r) => [
					r.row.rowId,
					r.inputDigest,
					r.errors,
					"csv" in r ? r.csv : null,
				]),
				policy: request.policy ?? "atomic",
			}),
		);
	return engine.create(context.input.scope, {
		format: "structured",
		key: request.key,
		request: bytes,
		requestDigest: hash(bytes),
		pins,
		pinsDigest: hash(pins),
		policy: request.policy ?? "atomic",
		rows: rows.map((r) => {
			const bytes = Buffer.from(canonical(r));
			return { id: r.row.rowId, bytes, digest: hash(bytes) };
		}),
	});
}
export function privateResultPage(
	engine: DurableBatchEngine,
	scope: Scope,
	job: Id,
	offset = 0,
) {
	const state = engine.job(scope, job).status;
	const available = state === "succeeded" || state === "partially_succeeded";
	return engine.inventory(scope, job, offset).map((outcome) => {
		const raw = engine.db.sql
			.prepare("SELECT input FROM rows WHERE job=? AND ordinal=?")
			.get(job, outcome.ordinal);
		requireOutput(
			raw?.["input"] instanceof Uint8Array,
			"OUTPUT_INTEGRITY",
			"result.input",
		);
		const planned = parse(
			plannedRowSchema,
			JSON.parse(Buffer.from(raw["input"]).toString()),
		);
		const diagnostic =
			outcome.attempt === null
				? null
				: rowDiagnostic(engine.store, scope, {
						job: outcome.job,
						ordinal: outcome.ordinal,
						attempt: outcome.attempt,
					});
		const record =
			outcome.publication === null || !available
				? null
				: engine.store.retrieve(scope, outcome.publication);
		const digest =
			record?.files.find((f) => f.name === "archive.zip")?.digest ?? null;
		return {
			rowId: planned.row.rowId,
			ordinal: outcome.ordinal,
			inputDigest: planned.inputDigest,
			csv: planned.csv ?? null,
			job: outcome.job,
			operation: outcome.operation,
			publication: available ? outcome.publication : null,
			archiveDigest: digest,
			status: outcome.status,
			errors: diagnostic
				? [{ code: diagnostic.code, path: diagnostic.path }]
				: planned.errors.length
					? planned.errors
					: outcome.code === null
						? []
						: [{ code: outcome.code, path: "execution" }],
			handoffEligible: false as const,
		};
	});
}

export {
	privateBatchRenderer,
	runPrivateBatch,
} from "./private-batch-renderer.js";
