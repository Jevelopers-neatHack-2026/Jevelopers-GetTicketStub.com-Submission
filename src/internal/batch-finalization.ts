import { z } from "zod";
import {
	check,
	parse,
	newId,
	hash,
	idSchema,
	digestSchema,
	codes,
	type DurabilityDatabase,
	type Id,
	type Scope,
} from "./durability.js";
import type { Job } from "../jobs/durable-batch.js";
import type {
	LocalArtifactStore,
	OutputFile,
	Publication,
} from "../storage/local-store.js";

export type BatchFinalizationPermit = {
	readonly stage: Id;
	readonly operation: Id;
	readonly file: OutputFile;
};
const active = new WeakMap<BatchFinalizationPermit, DurabilityDatabase>();
const terminalRow = z.object({
	ordinal: z.number().int().nonnegative(),
	row_key: digestSchema,
	operation: idSchema,
	status: z.enum(["succeeded", "failed", "cancelled"]),
	publication: idSchema.nullable(),
	attempt: idSchema.nullable(),
	code: z.enum(codes).nullable(),
});

export function checkBatchFinalization(
	db: DurabilityDatabase,
	binding: { readonly stage: Id; readonly operation: Id },
	permit?: BatchFinalizationPermit,
): void {
	db.requireTransaction();
	check(
		permit !== undefined &&
			active.get(permit) === db &&
			permit.stage === binding.stage &&
			permit.operation === binding.operation,
		"STALE_CLAIM",
	);
	const job = db.sql
		.prepare(
			"SELECT j.status,o.status AS operation_status,o.denied FROM jobs j JOIN operations o ON o.id=j.operation WHERE j.operation=?",
		)
		.get(binding.operation);
	check(
		job !== undefined &&
			(job["status"] === "queued" || job["status"] === "running") &&
			job["operation_status"] === "pending" &&
			job["denied"] === 0,
		"STALE_CLAIM",
	);
}

export function publishBatchInventory(
	store: LocalArtifactStore,
	scope: Scope,
	job: Job,
): Publication {
	const db = store.db;
	db.requireTransaction();
	const rows = db.sql
		.prepare("SELECT * FROM rows WHERE job=? ORDER BY ordinal")
		.all(job.id)
		.map((row) => parse(terminalRow, row));
	check(rows.length > 0 && rows.length <= db.limits.maxRows, "INTEGRITY");
	const successes = rows.filter((row) => row.status === "succeeded");
	check(
		job.policy === "atomic"
			? successes.length === rows.length
			: successes.length > 0,
		"STALE_CLAIM",
	);
	for (const row of rows) {
		const operation = store.operation(scope, row.operation);
		check(operation.denied === 0, "NOT_FOUND");
		if (row.status === "succeeded") {
			const publication = store.reconcilePublicationInTransaction(
				scope,
				row.operation,
			);
			check(
				publication !== null &&
					publication.id === row.publication &&
					operation.status === "completed",
				"INTEGRITY",
			);
			check(
				row.attempt !== null &&
					db.sql
						.prepare(
							"SELECT 1 FROM attempts a JOIN observations e ON e.attempt=a.id WHERE a.id=? AND a.operation=? AND a.outcome='succeeded' AND e.operation=? AND e.kind='succeeded' AND e.publication=?",
						)
						.get(row.attempt, row.operation, row.operation, publication.id) !==
						undefined,
				"INTEGRITY",
			);
		} else check(row.publication === null, "INTEGRITY");
	}
	const bytes = Buffer.from(
		JSON.stringify(
			rows.map((row) => ({
				ordinal: row.ordinal,
				row: row.row_key,
				status: row.status,
				publication: row.publication,
				code: row.code,
			})),
		),
	);
	const file = {
		name: "local-inventory.json",
		bytes,
		digest: hash(bytes),
		length: bytes.length,
	};
	const permit: BatchFinalizationPermit = {
		stage: newId(),
		operation: job.operation,
		file,
	};
	active.set(permit, db);
	try {
		checkBatchFinalization(db, permit, permit);
		db.sql
			.prepare("INSERT INTO stages(id,operation) VALUES(?,?)")
			.run(permit.stage, job.operation);
		store.writeInTransaction(scope, permit.stage, file, permit);
		return store.publishInTransaction(
			scope,
			permit.stage,
			[file],
			null,
			permit,
		);
	} finally {
		active.delete(permit);
	}
}
