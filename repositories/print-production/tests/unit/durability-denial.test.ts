import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DurabilityDatabase,
	DurabilityError,
	defaultLimits,
} from "../../src/internal/durability.js";
import { DurableBatchEngine } from "../../src/jobs/durable-batch.js";
import { LocalArtifactStore } from "../../src/storage/local-store.js";
import { fixture, file, plan, scope } from "../fixtures/durability/fixture.js";

for (const state of ["queued", "running", "committed", "completed"] as const) {
	for (const target of ["row", "job"] as const) {
		test(`fences denied ${target} with ${state} row through restart while healthy scope work progresses`, () => {
			using f = fixture();
			const job = f.jobs.create(scope, plan(`denied-${target}-${state}`, 1));
			const claim = state === "queued" ? null : f.jobs.claim(scope);
			if (state !== "queued") assert.ok(claim);
			if (claim && state === "committed") {
				f.store.write(scope, claim.stage, file());
				f.store.publish(scope, claim.stage, [file()]);
			}
			if (claim && state === "completed")
				f.jobs.complete(scope, claim, [file()]);
			const row = f.jobs.inventory(scope, job.id)[0];
			assert.ok(row);
			f.store.deny(scope, target === "row" ? row.operation : job.operation);
			const healthy = f.jobs.create(
				scope,
				plan(`healthy-${state}-${target}`, 1),
			);
			using restart = new DurabilityDatabase(
				f.path,
				undefined,
				() => f.time() + defaultLimits.leaseMs,
			);
			const jobs = new DurableBatchEngine(restart);
			const store = new LocalArtifactStore(restart);
			const next = jobs.claim(scope);
			assert.equal(next?.job, healthy.id);
			assert.ok(next);
			jobs.complete(scope, next, [file()]);
			jobs.cancel(scope, job.id);
			assert.equal(jobs.job(scope, healthy.id).status, "succeeded");
			const inventory = jobs.inventory(scope, job.id);
			assert.equal(inventory.length, 1);
			assert.equal(
				inventory[0]?.status,
				state === "completed" || state === "committed"
					? "succeeded"
					: "cancelled",
			);
			assert.throws(
				() => store.publication(scope, row.operation),
				(error: unknown) =>
					error instanceof DurabilityError && error.code === "NOT_FOUND",
			);
			const publication = inventory[0]?.publication;
			if (publication)
				assert.throws(
					() => store.retrieve(scope, publication),
					(error: unknown) =>
						error instanceof DurabilityError && error.code === "NOT_FOUND",
				);
			if (claim)
				assert.throws(
					() => store.publish(scope, claim.stage, [file()]),
					(error: unknown) => error instanceof DurabilityError,
				);
			assert.equal(jobs.claim(scope), null);
		});
	}
}
