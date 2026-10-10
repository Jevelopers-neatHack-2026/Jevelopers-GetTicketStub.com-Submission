import { z } from "zod";
import {
	check,
	checkedBytes,
	hash,
	identity,
	parse,
	newId,
	idSchema,
	digestSchema,
	scopeKey,
	DurabilityError,
	type DurabilityDatabase,
	type Digest,
	type Id,
	type Scope,
} from "../internal/durability.js";
import { LocalArtifactStore, type OutputFile } from "../storage/local-store.js";
import { observe } from "../telemetry/observations.js";

const policySchema = z.enum(["atomic", "allow_partial"]);
export type BatchPolicy = z.infer<typeof policySchema>;
export type PlanRow = {
	readonly id: string;
	readonly bytes: Uint8Array;
	readonly digest: Digest;
};
export type BatchPlan = {
	readonly format: "structured";
	readonly key: string;
	readonly request: Uint8Array;
	readonly requestDigest: Digest;
	readonly pins: Uint8Array;
	readonly pinsDigest: Digest;
	readonly rows: readonly PlanRow[];
	readonly policy?: BatchPolicy;
};
const rowStatus = z.enum([
	"queued",
	"running",
	"succeeded",
	"failed",
	"cancelled",
]);
const jobSchema = z
	.object({
		id: idSchema,
		operation: idSchema,
		plan: digestSchema,
		pins: digestSchema,
		policy: policySchema,
		status: z.enum([
			"queued",
			"running",
			"succeeded",
			"failed",
			"cancelled",
			"partially_succeeded",
		]),
	})
	.readonly();
export type Job = z.infer<typeof jobSchema>;
const rowSchema = z
	.object({
		job: idSchema,
		ordinal: z.number().int(),
		row_key: digestSchema,
		operation: idSchema,
		digest: digestSchema,
		status: rowStatus,
		fence: z.number().int(),
		attempt: idSchema.nullable(),
		stage: idSchema.nullable(),
		lease: z.number().nullable(),
		due: z.number(),
		attempts: z.number().int(),
		code: z
			.enum([
				"RENDER_PERMANENT",
				"RENDER_RETRYABLE",
				"INTERRUPTED",
				"CANCELLED",
			])
			.nullable(),
		publication: idSchema.nullable(),
	})
	.readonly();
export type RowOutcome = z.infer<typeof rowSchema>;
export type RowClaim = {
	readonly job: Id;
	readonly ordinal: number;
	readonly operation: Id;
	readonly attempt: Id;
	readonly stage: Id;
	readonly fence: number;
	readonly input: Uint8Array;
	readonly pins: Uint8Array;
};
export type RendererPort = (
	claim: RowClaim,
	signal: AbortSignal,
) => Promise<readonly OutputFile[]>;

export class DurableBatchEngine {
	readonly store: LocalArtifactStore;
	constructor(readonly db: DurabilityDatabase) {
		this.store = new LocalArtifactStore(db);
	}
	create(scope: Scope, plan: BatchPlan): Job {
		check(plan.format === "structured", "INVALID_INPUT");
		const policy = parse(policySchema, plan.policy ?? "atomic");
		check(
			plan.rows.length > 0 && plan.rows.length <= this.db.limits.maxRows,
			"LIMIT",
		);
		check(
			plan.rows.reduce(
				(total, row) => total + row.bytes.byteLength,
				plan.request.byteLength + plan.pins.byteLength,
			) <= this.db.limits.maxInputBytes,
			"LIMIT",
		);
		checkedBytes(
			plan.request,
			plan.requestDigest,
			this.db.limits.maxInputBytes,
		);
		const pins = checkedBytes(
			plan.pins,
			plan.pinsDigest,
			this.db.limits.maxInputBytes,
		);
		const rows = plan.rows.map((row) => {
			check(row.id.length > 0 && row.id.length <= 256, "INVALID_INPUT");
			return {
				key: hash(row.id),
				bytes: checkedBytes(
					row.bytes,
					row.digest,
					this.db.limits.maxInputBytes,
				),
				digest: row.digest,
			};
		});
		check(
			new Set(rows.map((row) => row.key)).size === rows.length,
			"INVALID_INPUT",
		);
		const planBytes = Buffer.from(
			JSON.stringify([
				plan.requestDigest,
				plan.pinsDigest,
				policy,
				rows.map((row) => [row.key, row.digest]),
			]),
		);
		const planDigest = hash(planBytes);
		return this.db.transaction(() => {
			const operation = this.store.bindInTransaction(
				scope,
				"private-batch",
				plan.key,
				planBytes,
				planDigest,
			);
			const old = this.db.sql
				.prepare("SELECT * FROM jobs WHERE operation=?")
				.get(operation.id);
			if (old) return parse(jobSchema, old);
			const queued = this.db.sql
				.prepare(
					"SELECT COUNT(*) AS n FROM jobs WHERE status IN('queued','running')",
				)
				.get();
			check(
				typeof queued?.["n"] === "number" &&
					queued["n"] < this.db.limits.maxQueuedJobs,
				"LIMIT",
			);
			const id = newId();
			this.db.sql
				.prepare(
					"INSERT INTO jobs(id,operation,plan,pins,pins_bytes,policy) VALUES(?,?,?,?,?,?)",
				)
				.run(id, operation.id, planDigest, plan.pinsDigest, pins, policy);
			rows.forEach((row, ordinal) => {
				const rowOperation = this.store.bindInTransaction(
					scope,
					"private-row",
					identity([id, row.key]),
					row.bytes,
					row.digest,
				);
				this.db.sql
					.prepare(
						"INSERT INTO rows(job,ordinal,row_key,operation,input,digest) VALUES(?,?,?,?,?,?)",
					)
					.run(id, ordinal, row.key, rowOperation.id, row.bytes, row.digest);
			});
			observe(this.db, operation.id, "planned");
			return {
				id,
				operation: operation.id,
				plan: planDigest,
				pins: plan.pinsDigest,
				policy,
				status: "queued",
			};
		});
	}
	job(scope: Scope, id: Id): Job {
		const row = this.db.sql
			.prepare(
				"SELECT j.* FROM jobs j JOIN operations o ON o.id=j.operation WHERE j.id=? AND o.scope=?",
			)
			.get(id, scopeKey(scope));
		check(row !== undefined, "NOT_FOUND");
		return parse(jobSchema, row);
	}
	inventory(
		scope: Scope,
		id: Id,
		offset = 0,
		limit = this.db.limits.pageSize,
	): readonly RowOutcome[] {
		this.job(scope, id);
		check(
			Number.isSafeInteger(offset) &&
				offset >= 0 &&
				Number.isSafeInteger(limit) &&
				limit > 0 &&
				limit <= this.db.limits.pageSize,
			"LIMIT",
		);
		return this.db.sql
			.prepare(
				"SELECT * FROM rows WHERE job=? ORDER BY ordinal LIMIT ? OFFSET ?",
			)
			.all(id, limit, offset)
			.map((row) => parse(rowSchema, row));
	}
	progress(scope: Scope, id: Id) {
		this.job(scope, id);
		return parse(
			z
				.object({
					total: z.number(),
					completed: z.number(),
					succeeded: z.number(),
					failed: z.number(),
					cancelled: z.number(),
					executionAttempts: z.number(),
				})
				.readonly(),
			this.db.sql
				.prepare(
					"SELECT COUNT(*) AS total, SUM(status IN('succeeded','failed','cancelled')) AS completed,SUM(status='succeeded') AS succeeded,SUM(status='failed') AS failed,SUM(status='cancelled') AS cancelled,SUM(attempts) AS executionAttempts FROM rows WHERE job=?",
				)
				.get(id),
		);
	}
	private endAttempt(
		row: RowOutcome,
		outcome: "succeeded" | "failed" | "retryable" | "interrupted" | "cancelled",
		code: RowOutcome["code"],
		measured: boolean,
	): void {
		check(row.attempt !== null, "INTEGRITY");
		const started = this.db.sql
			.prepare("SELECT started FROM attempts WHERE id=? AND outcome IS NULL")
			.get(row.attempt);
		check(
			started !== undefined && typeof started["started"] === "number",
			"STALE_CLAIM",
		);
		this.db.sql
			.prepare("UPDATE attempts SET outcome=? WHERE id=?")
			.run(outcome, row.attempt);
		const ended = this.db.now();
		observe(
			this.db,
			row.operation,
			outcome,
			row.attempt,
			code,
			row.publication,
			measured && ended >= started["started"]
				? { durationMs: ended - started["started"] }
				: {},
		);
	}
	private recover(scope: Scope): void {
		const expired = this.db.sql
			.prepare(
				"SELECT r.* FROM rows r JOIN jobs j ON j.id=r.job JOIN operations o ON o.id=j.operation WHERE o.scope=? AND r.status='running' AND r.lease<=?",
			)
			.all(scopeKey(scope), this.db.now())
			.map((row) => parse(rowSchema, row));
		for (const row of expired) {
			const publication = this.store.reconcilePublicationInTransaction(
				scope,
				row.operation,
			);
			if (publication) {
				this.db.sql
					.prepare(
						"UPDATE rows SET status='succeeded',publication=?,lease=NULL,fence=fence+1 WHERE job=? AND ordinal=?",
					)
					.run(publication.id, row.job, row.ordinal);
				this.endAttempt(
					{ ...row, publication: publication.id },
					"succeeded",
					null,
					false,
				);
			} else {
				this.endAttempt(row, "interrupted", "INTERRUPTED", false);
				if (row.stage) {
					this.db.sql
						.prepare("DELETE FROM staged_files WHERE stage=?")
						.run(row.stage);
					this.db.sql
						.prepare(
							"UPDATE stages SET state='abandoned' WHERE id=? AND state='open'",
						)
						.run(row.stage);
				}
				const exhausted = row.attempts >= this.db.limits.maxAttempts;
				this.db.sql
					.prepare(
						"UPDATE rows SET status=?,code='INTERRUPTED',lease=NULL,fence=fence+1,due=? WHERE job=? AND ordinal=?",
					)
					.run(
						exhausted ? "failed" : "queued",
						this.db.now() + this.db.limits.backoffMs * 2 ** (row.attempts - 1),
						row.job,
						row.ordinal,
					);
				if (exhausted)
					this.db.sql
						.prepare("UPDATE operations SET status='failed' WHERE id=?")
						.run(row.operation);
			}
			this.finish(scope, row.job);
		}
	}
	claim(scope: Scope): RowClaim | null {
		this.db.transaction(() => {
			const denied = this.db.sql
				.prepare(
					"SELECT j.id FROM jobs j JOIN operations o ON o.id=j.operation WHERE o.scope=? AND j.status IN('queued','running') AND (o.denied=1 OR EXISTS(SELECT 1 FROM rows r JOIN operations ro ON ro.id=r.operation WHERE r.job=j.id AND ro.denied=1))",
				)
				.all(scopeKey(scope));
			for (const job of denied)
				this.requestCancellation(scope, parse(idSchema, job["id"]));
		});
		this.db.transaction(() => {
			const pending = this.db.sql
				.prepare(
					"SELECT c.job FROM cancellations c JOIN jobs j ON j.id=c.job JOIN operations o ON o.id=j.operation WHERE o.scope=? ORDER BY c.rowid",
				)
				.all(scopeKey(scope));
			for (const job of pending)
				this.cancelInTransaction(scope, parse(idSchema, job["job"]));
		});
		return this.db.transaction(() => {
			this.recover(scope);
			const active = this.db.sql
				.prepare(
					"SELECT COUNT(*) AS n FROM rows WHERE status='running' AND lease>?",
				)
				.get(this.db.now());
			check(typeof active?.["n"] === "number", "INTEGRITY");
			if (active["n"] >= this.db.limits.concurrency) return null;
			const raw = this.db.sql
				.prepare(
					"SELECT r.*,j.pins_bytes,j.pins FROM rows r JOIN jobs j ON j.id=r.job JOIN operations o ON o.id=j.operation WHERE o.scope=? AND o.denied=0 AND j.status IN('queued','running') AND r.status='queued' AND r.due<=? ORDER BY j.rowid,r.ordinal LIMIT 1",
				)
				.get(scopeKey(scope), this.db.now());
			if (!raw) return null;
			const row = parse(rowSchema, raw);
			const existing = this.store.publicationInTransaction(
				scope,
				row.operation,
			);
			if (existing) {
				this.db.sql
					.prepare(
						"UPDATE rows SET status='succeeded',publication=? WHERE job=? AND ordinal=?",
					)
					.run(existing.id, row.job, row.ordinal);
				this.finish(scope, row.job);
				return null;
			}
			check(
				raw["input"] instanceof Uint8Array &&
					raw["pins_bytes"] instanceof Uint8Array,
				"INTEGRITY",
			);
			const input = checkedBytes(
				raw["input"],
				row.digest,
				this.db.limits.maxInputBytes,
			);
			const pins = checkedBytes(
				raw["pins_bytes"],
				parse(digestSchema, raw["pins"]),
				this.db.limits.maxInputBytes,
			);
			check(row.attempts < this.db.limits.maxAttempts, "LIMIT");
			const attempt = newId();
			const stage = newId();
			const fence = row.fence + 1;
			this.db.sql
				.prepare("INSERT INTO attempts VALUES(?,?,?,NULL)")
				.run(attempt, row.operation, this.db.now());
			this.db.sql
				.prepare("INSERT INTO stages(id,operation) VALUES(?,?)")
				.run(stage, row.operation);
			this.db.sql
				.prepare(
					"UPDATE rows SET status='running',fence=?,attempt=?,stage=?,lease=?,attempts=attempts+1,code=NULL WHERE job=? AND ordinal=?",
				)
				.run(
					fence,
					attempt,
					stage,
					this.db.now() + this.db.limits.leaseMs,
					row.job,
					row.ordinal,
				);
			this.db.sql
				.prepare("UPDATE jobs SET status='running' WHERE id=?")
				.run(row.job);
			observe(this.db, row.operation, "execution_started", attempt);
			return {
				job: row.job,
				ordinal: row.ordinal,
				operation: row.operation,
				attempt,
				stage,
				fence,
				input,
				pins,
			};
		});
	}
	private fenced(scope: Scope, claim: RowClaim): RowOutcome {
		const job = this.job(scope, claim.job);
		check(this.store.operation(scope, job.operation).denied === 0, "NOT_FOUND");
		check(job.status === "running", "STALE_CLAIM");
		const raw = this.db.sql
			.prepare(
				"SELECT * FROM rows WHERE job=? AND ordinal=? AND operation=? AND attempt=? AND stage=? AND fence=? AND status='running' AND lease>?",
			)
			.get(
				claim.job,
				claim.ordinal,
				claim.operation,
				claim.attempt,
				claim.stage,
				claim.fence,
				this.db.now(),
			);
		check(raw !== undefined, "STALE_CLAIM");
		const row = parse(rowSchema, raw);
		check(this.store.operation(scope, row.operation).denied === 0, "NOT_FOUND");
		return row;
	}
	renew(scope: Scope, claim: RowClaim): void {
		this.db.transaction(() => {
			this.fenced(scope, claim);
			this.db.sql
				.prepare("UPDATE rows SET lease=? WHERE job=? AND ordinal=?")
				.run(this.db.now() + this.db.limits.leaseMs, claim.job, claim.ordinal);
		});
	}
	complete(scope: Scope, claim: RowClaim, files: readonly OutputFile[]): void {
		this.db.transaction(() => {
			const row = this.fenced(scope, claim);
			for (const file of files)
				this.store.writeInTransaction(scope, claim.stage, file);
			const publication = this.store.publishInTransaction(
				scope,
				claim.stage,
				files,
				claim.attempt,
			);
			this.db.sql
				.prepare(
					"UPDATE rows SET status='succeeded',publication=?,lease=NULL WHERE job=? AND ordinal=?",
				)
				.run(publication.id, claim.job, claim.ordinal);
			this.endAttempt(
				{ ...row, publication: publication.id },
				"succeeded",
				null,
				true,
			);
			this.finish(scope, claim.job);
		});
	}
	fail(scope: Scope, claim: RowClaim, retryable: boolean): void {
		this.db.transaction(() => {
			const row = this.fenced(scope, claim);
			const publication = this.store.publicationInTransaction(
				scope,
				row.operation,
			);
			if (publication) {
				this.db.sql
					.prepare(
						"UPDATE rows SET status='succeeded',publication=?,code=NULL,lease=NULL,fence=fence+1 WHERE job=? AND ordinal=?",
					)
					.run(publication.id, row.job, row.ordinal);
				this.endAttempt(
					{ ...row, publication: publication.id },
					"succeeded",
					null,
					false,
				);
				this.finish(scope, row.job);
				return;
			}
			const code = retryable ? "RENDER_RETRYABLE" : "RENDER_PERMANENT";
			const retry = retryable && row.attempts < this.db.limits.maxAttempts;
			this.endAttempt(row, retry ? "retryable" : "failed", code, true);
			this.db.sql
				.prepare(
					"UPDATE rows SET status=?,code=?,lease=NULL,due=? WHERE job=? AND ordinal=?",
				)
				.run(
					retry ? "queued" : "failed",
					code,
					this.db.now() + this.db.limits.backoffMs * 2 ** (row.attempts - 1),
					row.job,
					row.ordinal,
				);
			this.db.sql
				.prepare("DELETE FROM staged_files WHERE stage=?")
				.run(claim.stage);
			this.db.sql
				.prepare("UPDATE stages SET state='abandoned' WHERE id=?")
				.run(claim.stage);
			if (!retry)
				this.db.sql
					.prepare("UPDATE operations SET status='failed' WHERE id=?")
					.run(row.operation);
			this.finish(scope, row.job);
		});
	}
	cancel(scope: Scope, id: Id): void {
		this.db.transaction(() => this.requestCancellation(scope, id));
		this.db.transaction(() => this.cancelInTransaction(scope, id));
	}
	private requestCancellation(scope: Scope, id: Id): void {
		const job = this.job(scope, id);
		if (job.status !== "queued" && job.status !== "running") return;
		this.db.sql
			.prepare("UPDATE jobs SET status='cancelled' WHERE id=?")
			.run(id);
		this.db.sql
			.prepare("UPDATE operations SET status='cancelled' WHERE id=?")
			.run(job.operation);
		this.db.sql
			.prepare(
				"UPDATE rows SET lease=NULL,fence=fence+1 WHERE job=? AND status IN('queued','running')",
			)
			.run(id);
		this.db.sql.prepare("INSERT INTO cancellations(job) VALUES(?)").run(id);
	}
	private cancelInTransaction(scope: Scope, id: Id): void {
		const job = this.job(scope, id);
		if (!this.db.sql.prepare("SELECT 1 FROM cancellations WHERE job=?").get(id))
			return;
		const count = this.db.sql
			.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status!='delivered'")
			.get();
		check(typeof count?.["n"] === "number", "INTEGRITY");
		const capacity = this.db.limits.maxPendingEvents - count["n"];
		if (capacity <= 0) return;
		const rows = this.db.sql
			.prepare(
				"SELECT * FROM rows WHERE job=? AND status IN('queued','running') ORDER BY ordinal LIMIT ?",
			)
			.all(id, capacity)
			.map((row) => parse(rowSchema, row));
		for (const row of rows) {
			const publication = this.store.reconcilePublicationInTransaction(
				scope,
				row.operation,
			);
			if (publication) {
				if (row.status === "running")
					this.endAttempt(
						{ ...row, publication: publication.id },
						"succeeded",
						null,
						false,
					);
				this.db.sql
					.prepare(
						"UPDATE rows SET status='succeeded',publication=?,lease=NULL,fence=fence+1 WHERE job=? AND ordinal=?",
					)
					.run(publication.id, id, row.ordinal);
				continue;
			}
			if (row.status === "running")
				this.endAttempt(row, "cancelled", "CANCELLED", false);
			else observe(this.db, row.operation, "cancelled", null, "CANCELLED");
			this.db.sql
				.prepare(
					"UPDATE rows SET status='cancelled',code='CANCELLED',lease=NULL,fence=fence+1 WHERE job=? AND ordinal=?",
				)
				.run(id, row.ordinal);
			this.db.sql
				.prepare("UPDATE operations SET status='cancelled' WHERE id=?")
				.run(row.operation);
			if (row.stage) {
				this.db.sql
					.prepare("DELETE FROM staged_files WHERE stage=?")
					.run(row.stage);
				this.db.sql
					.prepare(
						"UPDATE stages SET state='abandoned' WHERE id=? AND state='open'",
					)
					.run(row.stage);
			}
		}
		const remaining = this.db.sql
			.prepare(
				"SELECT 1 FROM rows WHERE job=? AND status IN('queued','running') LIMIT 1",
			)
			.get(id);
		if (remaining || rows.length === capacity) return;
		observe(this.db, job.operation, "cancelled", null, "CANCELLED");
		this.db.sql.prepare("DELETE FROM cancellations WHERE job=?").run(id);
	}
	private finish(scope: Scope, id: Id): void {
		const job = this.job(scope, id);
		const pending = this.db.sql
			.prepare(
				"SELECT COUNT(*) AS n FROM rows WHERE job=? AND status IN('queued','running')",
			)
			.get(id);
		if (pending?.["n"] !== 0 || job.status === "cancelled") return;
		const rows = this.db.sql
			.prepare("SELECT * FROM rows WHERE job=? ORDER BY ordinal")
			.all(id)
			.map((row) => parse(rowSchema, row));
		const successes = rows.filter((row) => row.status === "succeeded");
		const status =
			successes.length === rows.length
				? "succeeded"
				: job.policy === "allow_partial" && successes.length > 0
					? "partially_succeeded"
					: "failed";
		let publication: Id | null = null;
		if (status !== "failed") {
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
			const stage = newId();
			this.db.sql
				.prepare("INSERT INTO stages(id,operation) VALUES(?,?)")
				.run(stage, job.operation);
			this.store.writeInTransaction(scope, stage, file);
			publication = this.store.publishInTransaction(scope, stage, [file]).id;
		} else
			this.db.sql
				.prepare("UPDATE operations SET status='failed' WHERE id=?")
				.run(job.operation);
		this.db.sql.prepare("UPDATE jobs SET status=? WHERE id=?").run(status, id);
		observe(this.db, job.operation, status, null, null, publication);
	}
	results(
		scope: Scope,
		id: Id,
		offset = 0,
		limit = this.db.limits.pageSize,
	): readonly RowOutcome[] {
		const job = this.job(scope, id);
		if (job.status !== "succeeded" && job.status !== "partially_succeeded")
			return [];
		return this.inventory(scope, id, offset, limit);
	}
	async runOne(
		scope: Scope,
		renderer: RendererPort,
		signal: AbortSignal,
	): Promise<boolean> {
		if (signal.aborted) return false;
		const claim = this.claim(scope);
		if (!claim) return false;
		let files: readonly OutputFile[];
		try {
			files = await renderer(claim, signal);
		} catch (error) {
			if (signal.aborted) {
				this.cancel(scope, claim.job);
				return true;
			}
			if (error instanceof DurabilityError && error.code === "RENDER_RETRYABLE")
				this.fail(scope, claim, true);
			else this.fail(scope, claim, false);
			return true;
		}
		if (signal.aborted) {
			this.cancel(scope, claim.job);
			return true;
		}
		this.complete(scope, claim, files);
		return true;
	}
}
