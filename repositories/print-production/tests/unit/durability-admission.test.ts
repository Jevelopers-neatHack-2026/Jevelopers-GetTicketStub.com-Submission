import { test } from "node:test";
import assert from "node:assert/strict";
import { DurabilityError, hash } from "../../src/internal/durability.js";
import type { Publication } from "../../src/storage/local-store.js";
import { fixture, file, plan, scope } from "../fixtures/durability/fixture.js";

for (const state of [
	"bound",
	"open-stage",
	"abandoned-stage",
	"published",
	"denied",
	"denied-published",
] as const) {
	test(`rejects first job admission when its exact operation is already ${state}`, () => {
		// Given equal scoped key and exact plan bytes bound through general storage.
		using f = fixture();
		const batch = plan(`admission-${state}`, 2);
		const bytes = Buffer.from(
			JSON.stringify([
				batch.requestDigest,
				batch.pinsDigest,
				"atomic",
				batch.rows.map((row) => [hash(row.id), row.digest]),
			]),
		);
		const operation = f.store.bind(
			scope,
			"private-batch",
			batch.key,
			bytes,
			hash(bytes),
		);
		const output = file("local-inventory.json", "[]");
		let publication: Publication | undefined;
		if (state !== "bound" && state !== "denied") {
			const stage = f.store.stage(scope, operation.id);
			f.store.write(scope, stage, output);
			if (state === "published" || state === "denied-published")
				publication = f.store.publish(scope, stage, [output]);
			if (state === "abandoned-stage") f.store.abandon(scope, stage);
		}
		if (state === "denied" || state === "denied-published")
			f.store.deny(scope, operation.id);
		const before = {
			operation: f.store.operation(scope, operation.id),
			events: f.outbox.list(scope),
			stages: f.db.sql.prepare("SELECT * FROM stages").all(),
			publications: f.db.sql.prepare("SELECT * FROM publications").all(),
			files: f.db.sql.prepare("SELECT * FROM files").all(),
		};

		// When a new batch tries to acquire that storage operation.
		assert.throws(
			() => f.jobs.create(scope, batch),
			(error: unknown) =>
				error instanceof DurabilityError &&
				error.code === "IDEMPOTENCY_CONFLICT",
		);

		// Then no job, row or observation is admitted; earlier storage survives.
		assert.equal(
			f.db.sql.prepare("SELECT COUNT(*) AS n FROM jobs").get()?.["n"],
			0,
		);
		assert.equal(
			f.db.sql.prepare("SELECT COUNT(*) AS n FROM rows").get()?.["n"],
			0,
		);
		assert.deepEqual(
			{
				operation: f.store.operation(scope, operation.id),
				events: f.outbox.list(scope),
				stages: f.db.sql.prepare("SELECT * FROM stages").all(),
				publications: f.db.sql.prepare("SELECT * FROM publications").all(),
				files: f.db.sql.prepare("SELECT * FROM files").all(),
			},
			before,
		);
		if (publication && state === "published")
			assert.deepEqual(
				Buffer.from(
					f.store.retrieve(scope, publication.id).files[0]?.bytes ?? [],
				),
				output.bytes,
			);
		if (publication && state === "denied-published")
			assert.throws(
				() => f.store.retrieve(scope, publication.id),
				(error: unknown) =>
					error instanceof DurabilityError && error.code === "NOT_FOUND",
			);
	});
}

for (const status of [
	"queued",
	"running",
	"failed",
	"cancelled",
	"succeeded",
	"partially_succeeded",
] as const) {
	test(`reobserves the same admitted job when it is ${status}`, () => {
		// Given a legitimately admitted batch at each supported lifecycle state.
		using f = fixture();
		const batch = {
			...plan(`resubmit-${status}`, 2),
			policy: "allow_partial" as const,
		};
		const job = f.jobs.create(scope, batch);
		if (status === "cancelled") f.jobs.cancel(scope, job.id);
		else if (status !== "queued") {
			const first = f.jobs.claim(scope);
			assert.ok(first);
			if (status !== "running") {
				if (status === "failed") f.jobs.fail(scope, first, false);
				else f.jobs.complete(scope, first, [file()]);
				const second = f.jobs.claim(scope);
				assert.ok(second);
				if (status === "succeeded") f.jobs.complete(scope, second, [file()]);
				else f.jobs.fail(scope, second, false);
			}
		}
		const before = f.jobs.job(scope, job.id);
		assert.equal(before.status, status);
		const rows = f.jobs.inventory(scope, job.id);
		const events = f.outbox.list(scope);
		const publication = f.store.publication(scope, job.operation);

		// When the same scoped key and plan are submitted again.
		const resubmitted = f.jobs.create(scope, batch);

		// Then identity, outcomes, publication and immutable events are unchanged.
		assert.deepEqual(resubmitted, before);
		assert.deepEqual(f.jobs.inventory(scope, job.id), rows);
		assert.deepEqual(f.outbox.list(scope), events);
		assert.deepEqual(f.store.publication(scope, job.operation), publication);
	});
}
