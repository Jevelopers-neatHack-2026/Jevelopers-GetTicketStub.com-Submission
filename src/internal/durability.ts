import { createHash, randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { constants, openSync, closeSync, fchmodSync, statSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { z } from "zod";

export const digestSchema = z
	.string()
	.regex(/^[a-f0-9]{64}$/)
	.brand("PrivateDigest");
export type Digest = z.infer<typeof digestSchema>;
export const idSchema = z.string().uuid().brand("PrivateId");
export type Id = z.infer<typeof idSchema>;
export const scopeSchema = z
	.object({
		tenant: z.string().min(1).max(256),
		project: z.string().min(1).max(256),
	})
	.strict()
	.readonly();
/** Callers must authenticate and authorize scope before entering this private adapter. */
export type Scope = z.infer<typeof scopeSchema>;
export const codes = [
	"INVALID_INPUT",
	"IDEMPOTENCY_CONFLICT",
	"NOT_FOUND",
	"INTEGRITY",
	"WRITE_ONCE",
	"STALE_CLAIM",
	"LIMIT",
	"UNSUPPORTED_VERSION",
	"STORAGE",
	"RENDER_PERMANENT",
	"RENDER_RETRYABLE",
	"CANCELLED",
	"INTERRUPTED",
] as const;
export type Code = (typeof codes)[number];
export class DurabilityError extends Error {
	override readonly name = "DurabilityError";
	constructor(readonly code: Code) {
		super(code);
	}
}
export function check(value: boolean, code: Code): asserts value {
	if (!value) throw new DurabilityError(code);
}
export function parse<S extends z.ZodType>(
	schema: S,
	value: unknown,
): z.output<S> {
	const result = schema.safeParse(value);
	if (!result.success) throw new DurabilityError("INVALID_INPUT");
	return result.data;
}
export function hash(bytes: Uint8Array | string): Digest {
	return digestSchema.parse(createHash("sha256").update(bytes).digest("hex"));
}
export function identity(parts: readonly string[]): Digest {
	return hash(JSON.stringify(parts));
}
export function scopeKey(scope: Scope): Digest {
	const s = parse(scopeSchema, scope);
	return identity([s.tenant, s.project]);
}
export function newId(): Id {
	return idSchema.parse(randomUUID());
}
export function checkedBytes(
	bytes: Uint8Array,
	digest: Digest,
	limit: number,
): Buffer {
	check(bytes.byteLength <= limit, "LIMIT");
	check(hash(bytes) === parse(digestSchema, digest), "INTEGRITY");
	return Buffer.from(bytes);
}
export const limitsSchema = z
	.object({
		maxRows: z.number().int().min(1).max(10000),
		maxInputBytes: z.number().int().positive(),
		maxOutputBytes: z.number().int().positive(),
		maxFiles: z.number().int().min(1).max(1000),
		maxQueuedJobs: z.number().int().positive(),
		concurrency: z.number().int().min(1).max(128),
		maxAttempts: z.number().int().min(1).max(20),
		leaseMs: z.number().int().min(1).max(3600000),
		backoffMs: z.number().int().min(1).max(3600000),
		maxPendingEvents: z.number().int().min(10),
		maxDeliveryAttempts: z.number().int().min(1).max(20),
		pageSize: z.number().int().min(1).max(1000),
	})
	.strict()
	.readonly();
export type Limits = z.infer<typeof limitsSchema>;
export const defaultLimits: Limits = Object.freeze({
	maxRows: 1000,
	maxInputBytes: 4 * 1024 * 1024,
	maxOutputBytes: 16 * 1024 * 1024,
	maxFiles: 64,
	maxQueuedJobs: 100,
	concurrency: 4,
	maxAttempts: 3,
	leaseMs: 30000,
	backoffMs: 1000,
	maxPendingEvents: 10000,
	maxDeliveryAttempts: 5,
	pageSize: 100,
});

const schema = `
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL, limits TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, scope TEXT NOT NULL, key TEXT NOT NULL, request TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', denied INTEGER NOT NULL DEFAULT 0, UNIQUE(scope,key));
CREATE TABLE IF NOT EXISTS stages (id TEXT PRIMARY KEY, operation TEXT NOT NULL REFERENCES operations(id), state TEXT NOT NULL DEFAULT 'open');
CREATE TABLE IF NOT EXISTS blobs (digest TEXT PRIMARY KEY, length INTEGER NOT NULL, bytes BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS staged_files (stage TEXT NOT NULL REFERENCES stages(id), name TEXT NOT NULL, digest TEXT NOT NULL REFERENCES blobs(digest), PRIMARY KEY(stage,name));
CREATE TABLE IF NOT EXISTS publications (id TEXT PRIMARY KEY, operation TEXT UNIQUE NOT NULL REFERENCES operations(id), set_digest TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files (publication TEXT NOT NULL REFERENCES publications(id), name TEXT NOT NULL, digest TEXT NOT NULL REFERENCES blobs(digest), PRIMARY KEY(publication,name));
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, operation TEXT UNIQUE NOT NULL REFERENCES operations(id), plan TEXT NOT NULL, pins TEXT NOT NULL, pins_bytes BLOB NOT NULL, policy TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued');
CREATE TABLE IF NOT EXISTS rows (job TEXT NOT NULL REFERENCES jobs(id), ordinal INTEGER NOT NULL, row_key TEXT NOT NULL, operation TEXT UNIQUE NOT NULL REFERENCES operations(id), input BLOB NOT NULL, digest TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', fence INTEGER NOT NULL DEFAULT 0, attempt TEXT, stage TEXT REFERENCES stages(id), lease INTEGER, due INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, code TEXT, publication TEXT REFERENCES publications(id), PRIMARY KEY(job,ordinal), UNIQUE(job,row_key));
CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, operation TEXT NOT NULL REFERENCES operations(id), started INTEGER NOT NULL, outcome TEXT);
CREATE TABLE IF NOT EXISTS observations (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, operation TEXT NOT NULL REFERENCES operations(id), attempt TEXT REFERENCES attempts(id), kind TEXT NOT NULL, code TEXT, publication TEXT REFERENCES publications(id), bytes INTEGER, duration_ms INTEGER, recorded INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS immutable_observation_update BEFORE UPDATE ON observations BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_observation_delete BEFORE DELETE ON observations BEGIN SELECT RAISE(ABORT,'immutable'); END;
CREATE TABLE IF NOT EXISTS outbox (event TEXT PRIMARY KEY REFERENCES observations(id), status TEXT NOT NULL DEFAULT 'pending', fence INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, lease INTEGER, due INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS transports (id TEXT PRIMARY KEY, event TEXT NOT NULL REFERENCES observations(id), fence INTEGER NOT NULL, outcome TEXT NOT NULL DEFAULT 'uncertain');
`;

export class DurabilityDatabase {
	readonly sql: DatabaseSync;
	readonly limits: Limits;
	constructor(
		path: string,
		limits: Limits = defaultLimits,
		private readonly clock: () => number = Date.now,
	) {
		this.limits = parse(limitsSchema, limits);
		try {
			check(
				isAbsolute(path) && (statSync(dirname(path)).mode & 0o077) === 0,
				"INVALID_INPUT",
			);
			const descriptor = openSync(
				path,
				constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
				0o600,
			);
			try {
				fchmodSync(descriptor, 0o600);
			} finally {
				closeSync(descriptor);
			}
			this.sql = new DatabaseSync(path);
		} catch (error) {
			if (error instanceof DurabilityError) throw error;
			throw new DurabilityError("STORAGE");
		}
		try {
			this.sql.exec(
				"PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;",
			);
			this.transaction(() => {
				this.sql.exec(schema);
				const stored = this.sql
					.prepare("SELECT version,limits FROM settings WHERE id=1")
					.get();
				if (stored) {
					check(stored["version"] === 1, "UNSUPPORTED_VERSION");
					check(
						stored["limits"] === JSON.stringify(this.limits),
						"IDEMPOTENCY_CONFLICT",
					);
				} else
					this.sql
						.prepare("INSERT INTO settings VALUES(1,1,?)")
						.run(JSON.stringify(this.limits));
			});
		} catch (error) {
			this.sql.close();
			if (error instanceof DurabilityError) throw error;
			throw new DurabilityError("STORAGE");
		}
	}
	now(): number {
		const now = this.clock();
		check(Number.isSafeInteger(now) && now >= 0, "INVALID_INPUT");
		return now;
	}
	requireTransaction(): void {
		check(this.sql.isTransaction, "STORAGE");
	}
	transaction<T>(work: () => T): T {
		try {
			this.sql.exec("BEGIN IMMEDIATE");
			try {
				const result = work();
				this.sql.exec("COMMIT");
				return result;
			} catch (error) {
				this.sql.exec("ROLLBACK");
				throw error;
			}
		} catch (error) {
			if (error instanceof DurabilityError) throw error;
			throw new DurabilityError("STORAGE");
		}
	}
	close(): void {
		this.sql.close();
	}
	[Symbol.dispose](): void {
		this.close();
	}
}
