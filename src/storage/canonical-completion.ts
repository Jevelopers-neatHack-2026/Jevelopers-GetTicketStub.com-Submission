import { z } from "zod";
import { check, idSchema } from "../internal/durability.js";
import type { DurabilityDatabase, Id } from "../internal/durability.js";
import { observe, eventCapacity } from "../telemetry/observations.js";

const completionSchema = z.object({
	attempt: idSchema,
	operation: idSchema,
	outcome: z.enum([
		"succeeded",
		"failed",
		"retryable",
		"interrupted",
		"cancelled",
	]),
	code: z
		.enum(["RENDER_PERMANENT", "RENDER_RETRYABLE", "INTERRUPTED", "CANCELLED"])
		.nullable(),
	publication: idSchema.nullable(),
});
type Completion = z.infer<typeof completionSchema>;

export function initializeCompletions(db: DurabilityDatabase): void {
	db.sql.exec(
		"CREATE TABLE IF NOT EXISTS canonical_completions(attempt TEXT PRIMARY KEY REFERENCES attempts(id),operation TEXT NOT NULL REFERENCES operations(id),outcome TEXT NOT NULL,code TEXT,publication TEXT REFERENCES publications(id),event TEXT REFERENCES observations(id)); CREATE TRIGGER IF NOT EXISTS canonical_completion_delete BEFORE DELETE ON canonical_completions BEGIN SELECT RAISE(ABORT,'immutable'); END; CREATE TRIGGER IF NOT EXISTS canonical_completion_identity BEFORE UPDATE OF attempt,operation,outcome,code,publication ON canonical_completions BEGIN SELECT RAISE(ABORT,'immutable'); END;",
	);
}

export function completeInTransaction(
	db: DurabilityDatabase,
	completion: Completion,
): void {
	db.requireTransaction();
	const prior = db.sql
		.prepare("SELECT outcome FROM attempts WHERE id=? AND operation=?")
		.get(completion.attempt, completion.operation);
	check(
		prior !== undefined &&
			(prior["outcome"] === null || prior["outcome"] === completion.outcome),
		"INTEGRITY",
	);
	db.sql
		.prepare("UPDATE attempts SET outcome=? WHERE id=? AND outcome IS NULL")
		.run(completion.outcome, completion.attempt);
	db.sql
		.prepare(
			"INSERT OR IGNORE INTO canonical_completions(attempt,operation,outcome,code,publication) VALUES(?,?,?,?,?)",
		)
		.run(
			completion.attempt,
			completion.operation,
			completion.outcome,
			completion.code,
			completion.publication,
		);
}

export function reconcileCompletions(
	db: DurabilityDatabase,
	operation?: Id,
): number {
	return db.transaction(() => {
		if (operation !== undefined) {
			const published = db.sql
				.prepare(
					"SELECT a.id,p.id AS publication FROM attempts a JOIN publications p ON p.operation=a.operation JOIN observations e ON e.publication=p.id AND e.attempt=a.id AND e.kind='published' WHERE a.operation=? AND a.outcome IS NULL LIMIT 1",
				)
				.get(operation);
			if (published)
				completeInTransaction(db, {
					attempt: idSchema.parse(published["id"]),
					operation,
					outcome: "succeeded",
					code: null,
					publication: idSchema.parse(published["publication"]),
				});
		}
		const limit = Math.min(eventCapacity(db), db.limits.pageSize);
		const rows =
			operation === undefined
				? db.sql
						.prepare(
							"SELECT attempt,operation,outcome,code,publication FROM canonical_completions WHERE event IS NULL ORDER BY rowid LIMIT ?",
						)
						.all(limit)
				: db.sql
						.prepare(
							"SELECT attempt,operation,outcome,code,publication FROM canonical_completions WHERE event IS NULL AND operation=? ORDER BY rowid LIMIT ?",
						)
						.all(operation, limit);
		for (const raw of rows) {
			const row = completionSchema.parse(raw);
			const existing = db.sql
				.prepare("SELECT id FROM observations WHERE attempt=? AND kind=?")
				.get(row.attempt, row.outcome);
			const event = existing
				? idSchema.parse(existing["id"])
				: observe(
						db,
						row.operation,
						row.outcome,
						row.attempt,
						row.code,
						row.publication,
					);
			db.sql
				.prepare(
					"UPDATE canonical_completions SET event=? WHERE attempt=? AND event IS NULL",
				)
				.run(event, row.attempt);
		}
		return rows.length;
	});
}

export function failedCompletion(
	operation: Id,
	attempt: Id,
	code: "RENDER_PERMANENT" | "RENDER_RETRYABLE" | "CANCELLED",
): Completion {
	switch (code) {
		case "RENDER_RETRYABLE":
			return {
				operation,
				attempt,
				outcome: "retryable",
				code,
				publication: null,
			};
		case "CANCELLED":
			return {
				operation,
				attempt,
				outcome: "cancelled",
				code,
				publication: null,
			};
		case "RENDER_PERMANENT":
			return { operation, attempt, outcome: "failed", code, publication: null };
	}
}
