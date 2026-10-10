import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DurabilityDatabase,
	defaultLimits,
	hash,
} from "../../src/internal/durability.js";
import { LocalArtifactStore } from "../../src/storage/local-store.js";
import { fixture, file, plan, scope } from "../fixtures/durability/fixture.js";

for (const transition of ["fail", "cancel", "recover"] as const) {
	test(`reclaims only unreachable bytes after ${transition} and repeated restart cleanup`, () => {
		using f = fixture();
		const input = Buffer.from("opaque");
		const published = f.store.bind(
			scope,
			"export",
			"published",
			input,
			hash(input),
		);
		const pubStage = f.store.stage(scope, published.id);
		const shared = file("shared.bin", "shared-published");
		f.store.write(scope, pubStage, shared);
		const publication = f.store.publish(scope, pubStage, [shared]);
		const pending = f.store.bind(
			scope,
			"export",
			"pending",
			input,
			hash(input),
		);
		const liveStage = f.store.stage(scope, pending.id);
		const live = file("live.bin", "shared-still-staged");
		f.store.write(scope, liveStage, live);
		const job = f.jobs.create(scope, plan(`gc-${transition}`, 1));
		const claim = f.jobs.claim(scope);
		assert.ok(claim);
		const unique = file("unique.bin", `unique-${transition}`);
		for (const output of [shared, live, unique])
			f.store.write(scope, claim.stage, output);
		if (transition === "fail") f.jobs.fail(scope, claim, false);
		if (transition === "cancel") f.jobs.cancel(scope, job.id);
		if (transition === "recover") {
			f.advance(defaultLimits.leaseMs);
			f.jobs.claim(scope);
		}
		assert.equal(
			f.db.sql
				.prepare("SELECT state FROM stages WHERE id=?")
				.get(claim.stage)?.["state"],
			"abandoned",
		);
		assert.equal(
			f.db.sql.prepare("SELECT 1 FROM blobs WHERE digest=?").get(unique.digest),
			undefined,
		);
		using restart = new DurabilityDatabase(f.path);
		const store = new LocalArtifactStore(restart);
		store.abandon(scope, claim.stage);
		store.abandon(scope, claim.stage);
		assert.deepEqual(
			Buffer.from(store.retrieve(scope, publication.id).files[0]?.bytes ?? []),
			shared.bytes,
		);
		const livePublication = store.publish(scope, liveStage, [live]);
		assert.deepEqual(
			Buffer.from(
				store.retrieve(scope, livePublication.id).files[0]?.bytes ?? [],
			),
			live.bytes,
		);
		assert.equal(
			restart.sql.prepare("SELECT COUNT(*) AS n FROM blobs").get()?.["n"],
			2,
		);
	});
}

test("collects legacy abandoned orphan bytes idempotently without removing live references", () => {
	using f = fixture();
	const input = Buffer.from("opaque");
	const operation = f.store.bind(scope, "export", "legacy", input, hash(input));
	const stage = f.store.stage(scope, operation.id);
	f.store.write(scope, stage, file());
	f.db.transaction(() => {
		f.db.sql.prepare("DELETE FROM staged_files WHERE stage=?").run(stage);
		f.db.sql
			.prepare("UPDATE stages SET state='abandoned' WHERE id=?")
			.run(stage);
	});
	f.store.abandon(scope, stage);
	f.store.abandon(scope, stage);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM blobs").get()?.["n"],
		0,
	);
});
