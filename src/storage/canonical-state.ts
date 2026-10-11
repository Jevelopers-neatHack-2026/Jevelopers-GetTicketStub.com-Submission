import { z } from "zod";
import { canonicalJson } from "@jevelopers/shared-contracts";
import { productionReferences } from "@jevelopers/shared-contracts/production-operations";
import type { ProductionReferenceValue } from "@jevelopers/shared-contracts/production-operations";
import { LocalArtifactStore } from "./local-store.js";
import type { OutputFile } from "./local-store.js";
import { hash, idSchema, scopeKey, check } from "../internal/durability.js";
import type { DurabilityDatabase, Scope, Id } from "../internal/durability.js";
import {
	CandidateFailure,
	requireCandidate,
	reference,
	same,
} from "../api/canonical-values.js";

const record = z.object({ bytes: z.string(), digest: z.string() }).strict();
export class CanonicalState {
	readonly store: LocalArtifactStore;
	constructor(
		readonly db: DurabilityDatabase,
		readonly scope: Scope,
	) {
		this.store = new LocalArtifactStore(db);
		db.sql.exec(
			"CREATE TABLE IF NOT EXISTS canonical_records(scope TEXT NOT NULL,key TEXT NOT NULL,bytes TEXT NOT NULL,digest TEXT NOT NULL,PRIMARY KEY(scope,key)); CREATE TRIGGER IF NOT EXISTS canonical_record_update BEFORE UPDATE ON canonical_records BEGIN SELECT RAISE(ABORT,'immutable'); END; CREATE TRIGGER IF NOT EXISTS canonical_record_delete BEFORE DELETE ON canonical_records BEGIN SELECT RAISE(ABORT,'immutable'); END;",
		);
	}
	put(key: string, value: unknown): void {
		const bytes = canonicalJson(value),
			digest = hash(bytes);
		requireCandidate(
			Buffer.byteLength(bytes) <= this.db.limits.maxInputBytes,
			"INVALID_INPUT",
		);
		const prior = this.get(key);
		if (prior !== null) {
			requireCandidate(same(prior, value), "IDEMPOTENCY_CONFLICT", "conflict");
			return;
		}
		this.db.sql
			.prepare("INSERT INTO canonical_records VALUES(?,?,?,?)")
			.run(scopeKey(this.scope), key, bytes, digest);
	}
	get(key: string): unknown {
		const raw = this.db.sql
			.prepare(
				"SELECT bytes,digest FROM canonical_records WHERE scope=? AND key=?",
			)
			.get(scopeKey(this.scope), key);
		if (!raw) return null;
		const stored = record.parse(raw);
		requireCandidate(
			hash(stored.bytes) === stored.digest,
			"INTEGRITY_FAILURE",
			"integrity",
		);
		return JSON.parse(stored.bytes);
	}
	register(ref: ProductionReferenceValue): void {
		this.put(`reference:${ref.contract}:${ref.id}:${ref.revision}`, ref);
	}
	expectations(
		value: unknown,
	): Readonly<Record<string, ProductionReferenceValue>> {
		return Object.fromEntries(
			productionReferences(value).map(([path, ref]) => {
				const trusted = this.get(
					`reference:${ref.contract}:${ref.id}:${ref.revision}`,
				);
				if (trusted === null) throw new CandidateFailure("NOT_FOUND", "access");
				return [path, reference(trusted)];
			}),
		);
	}
	bind(operation: string, key: string, bytes: Uint8Array) {
		return this.store.bind(this.scope, operation, key, bytes, hash(bytes));
	}
	publish(
		operation: Id,
		files: readonly OutputFile[],
		publicationMetadata: {
			readonly records?: readonly (readonly [string, unknown])[];
			readonly attempt?: Id;
		} = {},
	): Id {
		const stage = this.store.stage(this.scope, operation);
		return this.db.transaction(() => {
			if (publicationMetadata.attempt) {
				const active = this.db.sql
					.prepare(
						"SELECT id FROM attempts WHERE operation=? AND outcome IS NULL ORDER BY rowid DESC LIMIT 1",
					)
					.get(operation);
				check(
					active?.["id"] === publicationMetadata.attempt,
					"IDEMPOTENCY_CONFLICT",
				);
			}
			for (const file of files)
				this.store.writeInTransaction(this.scope, stage, file);
			const publication = this.store.publishInTransaction(
				this.scope,
				stage,
				files,
				publicationMetadata.attempt ?? null,
			).id;
			for (const [key, value] of publicationMetadata.records ?? [])
				this.put(key, { publication, value });
			return publication;
		});
	}
	read(publication: string) {
		return this.store.retrieve(this.scope, idSchema.parse(publication)).files;
	}
}
