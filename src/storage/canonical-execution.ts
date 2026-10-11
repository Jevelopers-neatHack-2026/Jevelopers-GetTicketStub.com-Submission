import {
	newId,
	idSchema,
	check,
	DurabilityError,
} from "../internal/durability.js";
import type { DurabilityDatabase, Id } from "../internal/durability.js";
import { observe, eventCapacity } from "../telemetry/observations.js";
import { classify } from "../api/canonical-error.js";
import {
	completeInTransaction,
	failedCompletion,
	reconcileCompletions,
} from "./canonical-completion.js";

export async function executeCanonical<T>(
	db: DurabilityDatabase,
	operation: Id,
	work: (attempt: Id) => Promise<T>,
	recover: () => Promise<T>,
): Promise<T> {
	const admission = db.transaction(() => {
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
			completeInTransaction(db, {
				operation,
				attempt: idSchema.parse(prior["id"]),
				outcome: "interrupted",
				code: "INTERRUPTED",
				publication: null,
			});
		}
		const count = db.sql
			.prepare("SELECT COUNT(*) AS n FROM attempts WHERE operation=?")
			.get(operation);
		check(typeof count?.["n"] === "number", "INTEGRITY");
		if (count["n"] >= db.limits.maxAttempts)
			return { ok: false, code: "RENDER_RETRYABLE" } as const;
		if (eventCapacity(db) < 2) return { ok: false, code: "STORAGE" } as const;
		const id = newId();
		db.sql
			.prepare("INSERT INTO attempts VALUES(?,?,?,NULL)")
			.run(id, operation, db.now());
		observe(db, operation, "execution_started", id);
		return { ok: true, id } as const;
	});
	if (!admission.ok) {
		reconcileAvailable(db, operation);
		throw new DurabilityError(admission.code);
	}
	const attempt = admission.id;
	let result: T;
	try {
		result = await work(attempt);
	} catch (error) {
		const published = db.sql
			.prepare("SELECT id FROM publications WHERE operation=?")
			.get(operation);
		if (published) return recover();
		const failure = classify(error);
		db.transaction(() => {
			const current = db.sql
				.prepare("SELECT outcome FROM attempts WHERE id=?")
				.get(attempt);
			check(current !== undefined, "INTEGRITY");
			if (current["outcome"] === null)
				completeInTransaction(
					db,
					failedCompletion(
						operation,
						attempt,
						failure.code === "RETRYABLE_RENDER_FAILURE" ||
							failure.code === "RETRYABLE_STORAGE_FAILURE"
							? "RENDER_RETRYABLE"
							: failure.code === "CANCELLED"
								? "CANCELLED"
								: "RENDER_PERMANENT",
					),
				);
		});
		reconcileAvailable(db, operation);
		throw failure;
	}
	reconcileAvailable(db, operation);
	return result;
}

export function reconcileAvailable(
	db: DurabilityDatabase,
	operation?: Id,
): boolean {
	try {
		reconcileCompletions(db, operation);
		return true;
	} catch {
		return false;
	}
}
