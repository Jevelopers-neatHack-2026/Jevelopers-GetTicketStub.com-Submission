import { test } from "node:test";
import assert from "node:assert/strict";
import { DurabilityError, newId } from "../../src/internal/durability.js";
import { fixture, file, plan, scope } from "../fixtures/durability/fixture.js";

for (const status of [
	"queued",
	"running",
	"failed",
	"cancelled",
	"succeeded",
] as const) {
	test(`rejects general storage staging and stale publication for ${status} batch operations`, () => {
		using f = fixture();
		const job = f.jobs.create(scope, plan(`boundary-${status}`, 1));
		const stale = newId();
		f.db.transaction(() =>
			f.db.sql
				.prepare("INSERT INTO stages(id,operation) VALUES(?,?)")
				.run(stale, job.operation),
		);
		if (status !== "queued" && status !== "cancelled") {
			const claim = f.jobs.claim(scope);
			assert.ok(claim);
			if (status === "failed") f.jobs.fail(scope, claim, false);
			if (status === "succeeded") f.jobs.complete(scope, claim, [file()]);
		}
		if (status === "cancelled") f.jobs.cancel(scope, job.id);
		const before = f.outbox.list(scope);
		const stages = f.db.sql.prepare("SELECT COUNT(*) AS n FROM stages").get()?.[
			"n"
		];
		assert.throws(
			() => f.store.stage(scope, job.operation),
			(error: unknown) => error instanceof DurabilityError,
		);
		assert.throws(
			() => f.store.write(scope, stale, file("local-inventory.json", "[]")),
			(error: unknown) => error instanceof DurabilityError,
		);
		assert.throws(
			() => f.store.publish(scope, stale, [file("local-inventory.json", "[]")]),
			(error: unknown) => error instanceof DurabilityError,
		);
		assert.deepEqual(f.outbox.list(scope), before);
		assert.equal(
			f.db.sql.prepare("SELECT COUNT(*) AS n FROM stages").get()?.["n"],
			stages,
		);
		assert.equal(
			f.db.sql.prepare("SELECT 1 FROM staged_files WHERE stage=?").get(stale),
			undefined,
		);
		if (status !== "succeeded")
			assert.equal(f.store.publication(scope, job.operation), null);
	});
}

test("rejects forged batch finalization authority with every row still queued", () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("forged-finalizer", 2));
	const stage = newId();
	f.db.transaction(() => {
		f.db.sql
			.prepare("INSERT INTO stages(id,operation) VALUES(?,?)")
			.run(stage, job.operation);
		assert.throws(
			() =>
				Reflect.apply(f.store.writeInTransaction, f.store, [
					scope,
					stage,
					file("local-inventory.json", "[]"),
					{ stage, operation: job.operation },
				]),
			(error: unknown) =>
				error instanceof DurabilityError && error.code === "STALE_CLAIM",
		);
	});
	assert.equal(f.store.publication(scope, job.operation), null);
});
