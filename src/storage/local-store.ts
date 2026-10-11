import { z } from "zod";
import {
	check,
	checkedBytes,
	hash,
	identity,
	parse,
	newId,
	scopeKey,
	idSchema,
	digestSchema,
	type DurabilityDatabase,
	type Digest,
	type Id,
	type Scope,
} from "../internal/durability.js";
import { observe } from "../telemetry/observations.js";
import {
	checkBatchFinalization,
	type BatchFinalizationPermit,
} from "../internal/batch-finalization.js";

const operationSchema = z.object({
	id: idSchema,
	scope: digestSchema,
	request: digestSchema,
	status: z.enum(["pending", "completed", "failed", "cancelled"]),
	denied: z.number(),
});
export type Operation = z.infer<typeof operationSchema>;
const publicationSchema = z
	.object({ id: idSchema, operation: idSchema, set_digest: digestSchema })
	.readonly();
export type Publication = z.infer<typeof publicationSchema>;
const filenameSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
	.refine((value) => !value.includes(".."));
const fileSchema = z
	.object({
		name: filenameSchema,
		digest: digestSchema,
		length: z.number().int().nonnegative(),
		bytes: z.instanceof(Uint8Array),
	})
	.readonly();
export type StoredFile = z.infer<typeof fileSchema>;
export type OutputFile = {
	readonly name: string;
	readonly bytes: Uint8Array;
	readonly digest: Digest;
	readonly length: number;
};

export class LocalArtifactStore {
	constructor(readonly db: DurabilityDatabase) {}
	bind(
		scope: Scope,
		operation: string,
		key: string,
		bytes: Uint8Array,
		digest: Digest,
	): Operation {
		return this.db.transaction(() =>
			this.bindInTransaction(scope, operation, key, bytes, digest),
		);
	}
	bindInTransaction(
		scope: Scope,
		operation: string,
		key: string,
		bytes: Uint8Array,
		digest: Digest,
	): Operation {
		this.db.requireTransaction();
		const scoped = scopeKey(scope);
		check(
			operation.length > 0 &&
				operation.length <= 128 &&
				key.length > 0 &&
				key.length <= 256,
			"INVALID_INPUT",
		);
		checkedBytes(bytes, digest, this.db.limits.maxInputBytes);
		const mapping = identity([operation, key]);
		const old = this.db.sql
			.prepare(
				"SELECT id,scope,request,status,denied FROM operations WHERE scope=? AND key=?",
			)
			.get(scoped, mapping);
		if (old) {
			const record = parse(operationSchema, old);
			check(record.request === digest, "IDEMPOTENCY_CONFLICT");
			return record;
		}
		const id = newId();
		this.db.sql
			.prepare("INSERT INTO operations(id,scope,key,request) VALUES(?,?,?,?)")
			.run(id, scoped, mapping, digest);
		return { id, scope: scoped, request: digest, status: "pending", denied: 0 };
	}
	operation(scope: Scope, id: Id): Operation {
		const record = this.db.sql
			.prepare(
				"SELECT id,scope,request,status,denied FROM operations WHERE id=? AND scope=?",
			)
			.get(parse(idSchema, id), scopeKey(scope));
		check(record !== undefined, "NOT_FOUND");
		return parse(operationSchema, record);
	}
	private checkAccess(scope: Scope, id: Id): Operation {
		const operation = this.operation(scope, id);
		check(operation.denied === 0, "NOT_FOUND");
		const parent = this.db.sql
			.prepare(
				"SELECT o.denied FROM rows r JOIN jobs j ON j.id=r.job JOIN operations o ON o.id=j.operation WHERE r.operation=?",
			)
			.get(id);
		check(parent === undefined || parent["denied"] === 0, "NOT_FOUND");
		return operation;
	}
	stage(scope: Scope, operation: Id): Id {
		return this.db.transaction(() => {
			const record = this.operation(scope, operation);
			check(record.denied === 0, "NOT_FOUND");
			check(record.status === "pending", "WRITE_ONCE");
			check(
				this.db.sql
					.prepare(
						"SELECT 1 FROM rows WHERE operation=? UNION ALL SELECT 1 FROM jobs WHERE operation=?",
					)
					.get(operation, operation) === undefined,
				"STALE_CLAIM",
			);
			const n = this.db.sql
				.prepare(
					"SELECT COUNT(*) AS n FROM stages WHERE operation=? AND state='open'",
				)
				.get(operation);
			check(
				typeof n?.["n"] === "number" && n["n"] < this.db.limits.maxAttempts,
				"LIMIT",
			);
			const id = newId();
			this.db.sql
				.prepare("INSERT INTO stages(id,operation) VALUES(?,?)")
				.run(id, operation);
			return id;
		});
	}
	write(scope: Scope, stage: Id, file: OutputFile): void {
		this.db.transaction(() => this.writeInTransaction(scope, stage, file));
	}
	writeInTransaction(
		scope: Scope,
		stage: Id,
		file: OutputFile,
		permit?: BatchFinalizationPermit,
	): void {
		this.db.requireTransaction();
		const name = parse(filenameSchema, file.name);
		const row = this.db.sql
			.prepare("SELECT operation FROM stages WHERE id=? AND state='open'")
			.get(stage);
		check(row !== undefined, "WRITE_ONCE");
		const operation = this.checkAccess(
			scope,
			parse(idSchema, row["operation"]),
		);
		check(
			operation.status === "pending" && operation.denied === 0,
			"WRITE_ONCE",
		);
		this.checkStageFence(stage, operation.id, permit);
		if (permit)
			check(
				file.name === permit.file.name &&
					file.digest === permit.file.digest &&
					file.length === permit.file.length,
				"INTEGRITY",
			);
		const bytes = checkedBytes(
			file.bytes,
			file.digest,
			this.db.limits.maxOutputBytes,
		);
		check(file.length === bytes.length, "INTEGRITY");
		const oldFile = this.db.sql
			.prepare("SELECT digest FROM staged_files WHERE stage=? AND name=?")
			.get(stage, name);
		if (oldFile) {
			check(oldFile["digest"] === file.digest, "WRITE_ONCE");
			this.verifyBlob(file.digest);
			return;
		}
		const size = this.db.sql
			.prepare(
				"SELECT COUNT(*) AS n,COALESCE(SUM(b.length),0) AS total FROM staged_files f JOIN blobs b ON b.digest=f.digest WHERE f.stage=?",
			)
			.get(stage);
		check(
			typeof size?.["n"] === "number" &&
				typeof size["total"] === "number" &&
				size["n"] < this.db.limits.maxFiles &&
				size["total"] + bytes.length <= this.db.limits.maxOutputBytes,
			"LIMIT",
		);
		const old = this.db.sql
			.prepare("SELECT digest FROM blobs WHERE digest=?")
			.get(file.digest);
		if (old) this.verifyBlob(file.digest);
		else
			this.db.sql
				.prepare("INSERT INTO blobs VALUES(?,?,?)")
				.run(file.digest, bytes.length, bytes);
		this.db.sql
			.prepare("INSERT INTO staged_files VALUES(?,?,?)")
			.run(stage, name, file.digest);
	}
	private verifyBlob(digest: Digest): StoredFile["bytes"] {
		const row = this.db.sql
			.prepare("SELECT bytes,length FROM blobs WHERE digest=?")
			.get(digest);
		check(
			row !== undefined &&
				row["bytes"] instanceof Uint8Array &&
				typeof row["length"] === "number",
			"INTEGRITY",
		);
		check(
			row["bytes"].length === row["length"] && hash(row["bytes"]) === digest,
			"INTEGRITY",
		);
		return row["bytes"];
	}
	publish(
		scope: Scope,
		stage: Id,
		expected: readonly {
			readonly name: string;
			readonly digest: Digest;
			readonly length: number;
		}[],
	): Publication {
		return this.db.transaction(() =>
			this.publishInTransaction(scope, stage, expected),
		);
	}
	publishInTransaction(
		scope: Scope,
		stage: Id,
		expected: readonly {
			readonly name: string;
			readonly digest: Digest;
			readonly length: number;
		}[],
		attempt: Id | null = null,
		permit?: BatchFinalizationPermit,
	): Publication {
		this.db.requireTransaction();
		const row = this.db.sql
			.prepare("SELECT operation,state FROM stages WHERE id=?")
			.get(stage);
		check(row !== undefined, "NOT_FOUND");
		const operation = this.checkAccess(
			scope,
			parse(idSchema, row["operation"]),
		);
		check(operation.denied === 0, "NOT_FOUND");
		if (
			this.db.sql
				.prepare("SELECT 1 FROM jobs WHERE operation=?")
				.get(operation.id)
		) {
			this.checkStageFence(stage, operation.id, permit);
			check(
				permit !== undefined &&
					expected.length === 1 &&
					expected[0]?.name === permit.file.name &&
					expected[0]?.digest === permit.file.digest &&
					expected[0]?.length === permit.file.length,
				"INTEGRITY",
			);
		}
		check(
			expected.length > 0 && expected.length <= this.db.limits.maxFiles,
			"LIMIT",
		);
		const names = expected.map((f) => parse(filenameSchema, f.name));
		check(new Set(names).size === names.length, "INVALID_INPUT");
		const inventory = expected
			.map((f) => [f.name, parse(digestSchema, f.digest), f.length])
			.sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en"));
		const setDigest = hash(JSON.stringify(inventory));
		const old = this.publicationInTransaction(scope, operation.id);
		if (old) {
			check(old.set_digest === setDigest, "WRITE_ONCE");
			return old;
		}
		check(
			operation.status === "pending" && row["state"] === "open",
			"WRITE_ONCE",
		);
		this.checkStageFence(stage, operation.id, permit);
		const files = this.db.sql
			.prepare(
				"SELECT f.name,f.digest,b.length,b.bytes FROM staged_files f JOIN blobs b ON b.digest=f.digest WHERE f.stage=? ORDER BY f.name",
			)
			.all(stage)
			.map((f) => parse(fileSchema, f));
		check(files.length === expected.length, "INTEGRITY");
		let total = 0;
		for (const f of files) {
			const e = expected.find((e) => e.name === f.name);
			check(
				e !== undefined && e.digest === f.digest && e.length === f.length,
				"INTEGRITY",
			);
			this.verifyBlob(f.digest);
			total += f.length;
		}
		const id = newId();
		this.db.sql
			.prepare("INSERT INTO publications VALUES(?,?,?)")
			.run(id, operation.id, setDigest);
		this.db.sql
			.prepare(
				"INSERT INTO files SELECT ?,name,digest FROM staged_files WHERE stage=?",
			)
			.run(id, stage);
		this.db.sql
			.prepare(
				"UPDATE operations SET status='completed' WHERE id=? AND status='pending'",
			)
			.run(operation.id);
		this.db.sql
			.prepare("UPDATE stages SET state='published' WHERE id=?")
			.run(stage);
		observe(this.db, operation.id, "published", attempt, null, id, {
			bytes: total,
		});
		return { id, operation: operation.id, set_digest: setDigest };
	}
	publicationInTransaction(scope: Scope, operation: Id): Publication | null {
		this.checkAccess(scope, operation);
		return this.reconcilePublicationInTransaction(scope, operation);
	}
	reconcilePublicationInTransaction(
		scope: Scope,
		operation: Id,
	): Publication | null {
		this.db.requireTransaction();
		this.operation(scope, operation);
		const row = this.db.sql
			.prepare("SELECT * FROM publications WHERE operation=?")
			.get(operation);
		if (!row) return null;
		const publication = parse(publicationSchema, row);
		this.verifiedFiles(publication);
		return publication;
	}
	private verifiedFiles(publication: Publication): readonly StoredFile[] {
		const files = this.db.sql
			.prepare(
				"SELECT f.name,f.digest,b.length,b.bytes FROM files f JOIN blobs b ON b.digest=f.digest WHERE f.publication=? ORDER BY f.name",
			)
			.all(publication.id)
			.map((file) => parse(fileSchema, file));
		for (const file of files) this.verifyBlob(file.digest);
		const digest = hash(
			JSON.stringify(
				files
					.map((file) => [file.name, file.digest, file.length])
					.sort((a, b) => String(a[0]).localeCompare(String(b[0]), "en")),
			),
		);
		check(digest === publication.set_digest, "INTEGRITY");
		return files;
	}
	private checkStageFence(
		stage: Id,
		operation: Id,
		permit?: BatchFinalizationPermit,
	): void {
		if (
			this.db.sql.prepare("SELECT 1 FROM jobs WHERE operation=?").get(operation)
		) {
			checkBatchFinalization(this.db, { stage, operation }, permit);
			return;
		}
		const row = this.db.sql
			.prepare(
				"SELECT r.stage,r.status,r.lease,o.denied FROM rows r JOIN jobs j ON j.id=r.job JOIN operations o ON o.id=j.operation WHERE r.operation=?",
			)
			.get(operation);
		if (!row) return;
		check(
			row["stage"] === stage &&
				row["status"] === "running" &&
				typeof row["lease"] === "number" &&
				row["lease"] > this.db.now() &&
				row["denied"] === 0,
			"STALE_CLAIM",
		);
	}
	publication(scope: Scope, operation: Id): Publication | null {
		return this.db.transaction(() =>
			this.publicationInTransaction(scope, operation),
		);
	}
	retrieve(
		scope: Scope,
		id: Id,
	): {
		readonly publication: Publication;
		readonly files: readonly StoredFile[];
		readonly handoffEligible: false;
	} {
		return this.db.transaction(() => {
			const row = this.db.sql
				.prepare(
					"SELECT p.* FROM publications p JOIN operations o ON o.id=p.operation WHERE p.id=? AND o.scope=? AND o.denied=0",
				)
				.get(id, scopeKey(scope));
			check(row !== undefined, "NOT_FOUND");
			const publication = parse(publicationSchema, row);
			this.checkAccess(scope, publication.operation);
			const files = this.verifiedFiles(publication);
			return { publication, files, handoffEligible: false };
		});
	}
	deny(scope: Scope, operation: Id): void {
		this.db.transaction(() => {
			this.operation(scope, operation);
			this.db.sql
				.prepare("UPDATE operations SET denied=1 WHERE id=?")
				.run(operation);
		});
	}
	abandon(scope: Scope, stage: Id): void {
		this.db.transaction(() => this.abandonInTransaction(scope, stage));
	}
	abandonInTransaction(scope: Scope, stage: Id): void {
		this.db.requireTransaction();
		const row = this.db.sql
			.prepare("SELECT operation,state FROM stages WHERE id=?")
			.get(stage);
		check(
			row !== undefined &&
				(row["state"] === "open" || row["state"] === "abandoned"),
			"WRITE_ONCE",
		);
		this.operation(scope, parse(idSchema, row["operation"]));
		this.db.sql.prepare("DELETE FROM staged_files WHERE stage=?").run(stage);
		this.db.sql
			.prepare("UPDATE stages SET state='abandoned' WHERE id=?")
			.run(stage);
		this.db.sql
			.prepare(
				"DELETE FROM blobs WHERE digest IN (SELECT b.digest FROM blobs b WHERE NOT EXISTS(SELECT 1 FROM staged_files s WHERE s.digest=b.digest) AND NOT EXISTS(SELECT 1 FROM files f WHERE f.digest=b.digest) LIMIT ?)",
			)
			.run(this.db.limits.maxFiles);
	}
}
