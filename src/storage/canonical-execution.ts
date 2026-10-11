import { newId, idSchema, check } from "../internal/durability.js";
import type { DurabilityDatabase, Id } from "../internal/durability.js";
import { observe, eventCapacity } from "../telemetry/observations.js";
import { requireCandidate } from "../api/canonical-values.js";

export async function executeCanonical<T>(
	db: DurabilityDatabase,
	operation: Id,
	work: (attempt: Id) => Promise<T>,
): Promise<T> {
	const attempt = db.transaction(() => {
		requireCandidate(
			eventCapacity(db) >= 2,
			"RETRYABLE_STORAGE_FAILURE",
			"storage",
		);
		const prior = db.sql
			.prepare(
				"SELECT id,started FROM attempts WHERE operation=? AND outcome IS NULL",
			)
			.get(operation);
		if (prior) {
			check(
				typeof prior["started"] === "number" &&
					db.now() - prior["started"] >= db.limits.leaseMs,
				"IDEMPOTENCY_CONFLICT",
			);
			db.sql
				.prepare(
					"UPDATE attempts SET outcome='interrupted' WHERE id=? AND outcome IS NULL",
				)
				.run(idSchema.parse(prior["id"]));
			observe(
				db,
				operation,
				"interrupted",
				idSchema.parse(prior["id"]),
				"INTERRUPTED",
			);
		}
		const count = db.sql
			.prepare("SELECT COUNT(*) AS n FROM attempts WHERE operation=?")
			.get(operation);
		requireCandidate(
			typeof count?.["n"] === "number" && count["n"] < db.limits.maxAttempts,
			"RETRYABLE_RENDER_FAILURE",
			"render",
		);
		const id = newId();
		db.sql
			.prepare("INSERT INTO attempts VALUES(?,?,?,NULL)")
			.run(id, operation, db.now());
		observe(db, operation, "execution_started", id);
		return id;
	});
	try {
		const result = await work(attempt);
		db.transaction(() => {
			db.sql
				.prepare(
					"UPDATE attempts SET outcome='succeeded' WHERE id=? AND outcome IS NULL",
				)
				.run(attempt);
			observe(db, operation, "succeeded", attempt);
		});
		return result;
	} catch (error) {
		if (!(error instanceof Error)) throw error;
		db.transaction(() => {
			db.sql
				.prepare(
					"UPDATE attempts SET outcome='failed' WHERE id=? AND outcome IS NULL",
				)
				.run(attempt);
			observe(db, operation, "failed", attempt, "RENDER_PERMANENT");
		});
		throw error;
	}
}
