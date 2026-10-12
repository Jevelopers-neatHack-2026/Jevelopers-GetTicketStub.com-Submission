import { test } from "node:test";
import assert from "node:assert/strict";
import {
	defaultLimits,
	DurabilityError,
} from "../../src/internal/durability.js";
import { fixture, file, plan, scope } from "../fixtures/durability/fixture.js";

for (const failure of ["permanent", "retryable", "exhausted"] as const) {
	test(`reconciles verified committed output before ${failure} failure`, () => {
		// Given a committed publication whose row checkpoint is uncertain.
		using f = fixture({
			...defaultLimits,
			maxAttempts: failure === "exhausted" ? 1 : 3,
		});
		const job = f.jobs.create(scope, plan(failure, 1));
		const claim = f.jobs.claim(scope);
		assert.ok(claim);
		f.store.write(scope, claim.stage, file());
		const publication = f.store.publish(scope, claim.stage, [file()]);
		const before = f.outbox.list(scope);
		// When the worker reports failure after the storage commit.
		f.jobs.fail(scope, claim, failure !== "permanent");
		// Then existing success wins, with the actual execution joined to output.
		const row = f.jobs.inventory(scope, job.id)[0];
		assert.equal(f.jobs.job(scope, job.id).status, "succeeded");
		assert.equal(row?.status, "succeeded");
		assert.equal(row?.publication, publication.id);
		assert.equal(row?.code, null);
		assert.equal(f.store.operation(scope, claim.operation).status, "completed");
		assert.equal(
			f.store.publication(scope, claim.operation)?.id,
			publication.id,
		);
		assert.equal(f.store.retrieve(scope, publication.id).files.length, 1);
		assert.deepEqual(f.outbox.list(scope).slice(0, before.length), before);
		const success = f.outbox
			.list(scope)
			.filter((e) => e.operation === claim.operation && e.kind === "succeeded");
		assert.equal(success.length, 1);
		assert.equal(success[0]?.attempt, claim.attempt);
		assert.equal(success[0]?.publication, publication.id);
		assert.equal(success[0]?.job, job.id);
		assert.equal(success[0]?.row, row?.row_key);
		assert.equal(
			f.db.sql
				.prepare("SELECT outcome FROM attempts WHERE id=?")
				.get(claim.attempt)?.["outcome"],
			"succeeded",
		);
		f.advance(defaultLimits.leaseMs + defaultLimits.backoffMs);
		assert.equal(f.jobs.claim(scope), null);
		assert.equal(f.jobs.progress(scope, job.id).executionAttempts, 1);
		assert.equal(
			f.db.sql
				.prepare("SELECT COUNT(*) AS n FROM publications WHERE operation=?")
				.get(claim.operation)?.["n"],
			1,
		);
	});
}

test("rejects corrupt committed output before failure reconciliation", () => {
	// Given committed output whose bytes were corrupted.
	using f = fixture();
	const job = f.jobs.create(scope, plan("corrupt-failure", 1));
	const claim = f.jobs.claim(scope);
	assert.ok(claim);
	f.store.write(scope, claim.stage, file());
	f.store.publish(scope, claim.stage, [file()]);
	f.db.sql
		.prepare("UPDATE blobs SET bytes=?")
		.run(Buffer.alloc(file().length, 88));
	const before = f.outbox.list(scope);
	// When failure attempts to reconcile the publication.
	assert.throws(
		() => f.jobs.fail(scope, claim, false),
		(error: unknown) =>
			error instanceof DurabilityError && error.code === "INTEGRITY",
	);
	// Then no successful or failed checkpoint is invented.
	assert.equal(f.jobs.inventory(scope, job.id)[0]?.status, "running");
	assert.deepEqual(f.outbox.list(scope), before);
});
