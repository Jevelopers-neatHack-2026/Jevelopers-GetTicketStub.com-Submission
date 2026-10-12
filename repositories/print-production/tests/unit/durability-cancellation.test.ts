import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DurabilityDatabase,
	DurabilityError,
	defaultLimits,
} from "../../src/internal/durability.js";
import { DurableBatchEngine } from "../../src/jobs/durable-batch.js";
import { LocalArtifactStore } from "../../src/storage/local-store.js";
import { ObservationOutbox } from "../../src/telemetry/observations.js";
import { fixture, file, plan, scope } from "../fixtures/durability/fixture.js";

for (const full of [false, true]) {
	test(`fences ten rows immediately and completes cancellation across drain/restart with ${full ? "full" : "empty"} ten-event budget`, () => {
		const limits = { ...defaultLimits, maxPendingEvents: 10 };
		using f = fixture(limits);
		const job = f.jobs.create(scope, plan(`cancel-${full}`, 10));
		const claim = f.jobs.claim(scope);
		assert.ok(claim);
		f.store.write(scope, claim.stage, file());
		if (full)
			for (let i = 0; i < 8; i++)
				f.jobs.create(scope, plan(`pressure-${i}`, 1));
		else
			for (;;) {
				const event = f.outbox.claim();
				if (!event) break;
				f.outbox.settle(event, true);
			}
		const before = f.outbox.list(scope);
		f.jobs.cancel(scope, job.id);
		assert.equal(f.jobs.job(scope, job.id).status, "cancelled");
		assert.throws(
			() => f.store.publish(scope, claim.stage, [file()]),
			(error: unknown) => error instanceof DurabilityError,
		);
		assert.throws(
			() => f.jobs.complete(scope, claim, [file()]),
			(error: unknown) =>
				error instanceof DurabilityError && error.code === "STALE_CLAIM",
		);
		using restart = new DurabilityDatabase(f.path, limits, f.time);
		const jobs = new DurableBatchEngine(restart);
		const store = new LocalArtifactStore(restart);
		const outbox = new ObservationOutbox(restart);
		for (let round = 0; round < 4; round++) {
			const pending = restart.sql
				.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status!='delivered'")
				.get()?.["n"];
			assert.ok(typeof pending === "number" && pending <= 10);
			for (;;) {
				const event = outbox.claim();
				if (!event) break;
				outbox.settle(event, true);
			}
			jobs.cancel(scope, job.id);
		}
		assert.ok(
			jobs.inventory(scope, job.id).every((row) => row.status === "cancelled"),
		);
		const events = outbox.list(scope);
		assert.deepEqual(events.slice(0, before.length), before);
		assert.equal(
			events.filter(
				(event) => event.job === job.id && event.kind === "cancelled",
			).length,
			11,
		);
		assert.equal(store.publication(scope, claim.operation), null);
		assert.equal(
			restart.sql
				.prepare("SELECT outcome FROM attempts WHERE id=?")
				.get(claim.attempt)?.["outcome"],
			"cancelled",
		);
		assert.equal(
			restart.sql.prepare("SELECT COUNT(*) AS n FROM cancellations").get()?.[
				"n"
			],
			0,
		);
	});
}
