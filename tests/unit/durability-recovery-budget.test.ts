import { test } from "node:test";
import assert from "node:assert/strict";
import {
	defaultLimits,
	DurabilityError,
} from "../../src/internal/durability.js";
import { fixture, file, plan, scope } from "../fixtures/durability/fixture.js";
import {
	drain,
	pending,
	seedRecovery,
} from "../fixtures/durability/recovery-budget.js";

for (let initialPending = 0; initialPending <= 10; initialPending++) {
	test(`recovers committed rows in bounded steps when ${initialPending} of ten events are pending`, () => {
		using f = fixture({ ...defaultLimits, maxPendingEvents: 10 });
		const { seeded, healthy } = seedRecovery(f.db, true, 4);
		for (let i = 0; i < initialPending; i++)
			f.jobs.create(scope, plan(`pressure-${i}`, 1));
		const before = f.outbox.list(scope);
		f.advance(defaultLimits.leaseMs);
		assert.equal(f.jobs.claim(scope), null);
		const recovered = Math.floor((10 - initialPending) / 3);
		assert.equal(
			seeded.filter(
				({ job }) => f.jobs.job(scope, job.id).status === "succeeded",
			).length,
			recovered,
		);
		assert.equal(pending(f.db), initialPending + recovered * 3);
		assert.deepEqual(f.outbox.list(scope).slice(0, before.length), before);
		for (let step = 0; step < 3; step++) {
			drain(f.outbox);
			const next = f.jobs.claim(scope);
			assert.ok(pending(f.db) <= 10);
			assert.ok(
				seeded.filter(
					({ job }) => f.jobs.job(scope, job.id).status === "succeeded",
				).length >= recovered,
			);
			if (next) {
				assert.equal(next.job, healthy.id);
				drain(f.outbox);
				f.jobs.complete(scope, next, [file()]);
				break;
			}
		}
		assert.equal(f.jobs.job(scope, healthy.id).status, "succeeded");
		for (const { job, claim, publication } of seeded) {
			assert.ok(publication);
			assert.equal(f.jobs.job(scope, job.id).status, "succeeded");
			assert.equal(
				f.jobs.inventory(scope, job.id)[0]?.publication,
				publication.id,
			);
			assert.equal(f.jobs.progress(scope, job.id).executionAttempts, 1);
			assert.equal(
				f.jobs.store.publication(scope, claim.operation)?.id,
				publication.id,
			);
			assert.equal(
				f.db.sql
					.prepare("SELECT outcome FROM attempts WHERE id=?")
					.get(claim.attempt)?.["outcome"],
				"succeeded",
			);
			const events = f.outbox.list(scope).filter((e) => e.job === job.id);
			assert.equal(
				events.filter(
					(e) =>
						e.attempt === claim.attempt &&
						e.kind === "succeeded" &&
						e.publication === publication.id,
				).length,
				1,
			);
			assert.equal(
				events.filter(
					(e) => e.operation === job.operation && e.kind === "published",
				).length,
				1,
			);
			assert.equal(
				events.filter(
					(e) => e.operation === job.operation && e.kind === "succeeded",
				).length,
				1,
			);
		}
	});
}

for (const exhausted of [false, true]) {
	test(`recovers more interrupted rows than capacity when retries are ${exhausted ? "exhausted" : "available"}`, () => {
		using f = fixture({
			...defaultLimits,
			maxPendingEvents: 10,
			concurrency: 12,
			maxAttempts: exhausted ? 1 : 3,
		});
		const { seeded, healthy } = seedRecovery(f.db, false, 12);
		f.advance(defaultLimits.leaseMs);
		assert.equal(f.jobs.claim(scope), null);
		const firstCount = exhausted ? 5 : 10;
		assert.equal(
			seeded.filter(
				({ job }) => f.jobs.inventory(scope, job.id)[0]?.status !== "running",
			).length,
			firstCount,
		);
		assert.equal(pending(f.db), 10);
		let previous = firstCount;
		for (let step = 0; step < 3; step++) {
			drain(f.outbox);
			const next = f.jobs.claim(scope);
			const count = seeded.filter(
				({ job }) => f.jobs.inventory(scope, job.id)[0]?.status !== "running",
			).length;
			assert.ok(count >= previous);
			previous = count;
			assert.ok(pending(f.db) <= 10);
			if (next) {
				assert.equal(next.job, healthy.id);
				f.jobs.complete(scope, next, [file()]);
				break;
			}
		}
		assert.equal(f.jobs.job(scope, healthy.id).status, "succeeded");
		for (const { job, claim } of seeded) {
			assert.equal(
				f.jobs.inventory(scope, job.id)[0]?.status,
				exhausted ? "failed" : "queued",
			);
			assert.equal(f.jobs.progress(scope, job.id).executionAttempts, 1);
			assert.equal(
				f.db.sql
					.prepare("SELECT outcome FROM attempts WHERE id=?")
					.get(claim.attempt)?.["outcome"],
				"interrupted",
			);
			assert.equal(f.jobs.store.publication(scope, claim.operation), null);
			assert.equal(
				f.db.sql
					.prepare("SELECT state FROM stages WHERE id=?")
					.get(claim.stage)?.["state"],
				"abandoned",
			);
		}
		assert.equal(
			f.db.sql
				.prepare(
					"SELECT COUNT(*) AS n FROM blobs WHERE digest NOT IN(SELECT digest FROM files)",
				)
				.get()?.["n"],
			0,
		);
	});
}

for (const policy of ["atomic", "allow_partial"] as const) {
	test(`reserves finalization events for exhausted recovery under ${policy} policy`, () => {
		using f = fixture({
			...defaultLimits,
			maxPendingEvents: 10,
			maxAttempts: 1,
		});
		const job = f.jobs.create(scope, {
			...plan(`terminal-${policy}`, 2),
			policy,
		});
		const first = f.jobs.claim(scope);
		assert.ok(first);
		f.jobs.complete(scope, first, [file()]);
		drain(f.outbox);
		const last = f.jobs.claim(scope);
		assert.ok(last);
		drain(f.outbox);
		for (let i = 0; i < 8; i++)
			f.jobs.create(scope, plan(`terminal-pressure-${i}`, 1));
		f.advance(defaultLimits.leaseMs);
		assert.equal(f.jobs.claim(scope), null);
		assert.equal(
			f.jobs.job(scope, job.id).status,
			policy === "atomic" ? "failed" : "running",
		);
		assert.equal(pending(f.db), policy === "atomic" ? 10 : 8);
		drain(f.outbox);
		f.jobs.claim(scope);
		assert.equal(
			f.jobs.job(scope, job.id).status,
			policy === "atomic" ? "failed" : "partially_succeeded",
		);
		assert.equal(f.jobs.inventory(scope, job.id)[1]?.status, "failed");
		assert.equal(
			Boolean(f.jobs.store.publication(scope, job.operation)),
			policy === "allow_partial",
		);
	});
}

for (const policy of ["atomic", "allow_partial"] as const) {
	test(`reserves finalization capacity for a committed last row after earlier failure under ${policy}`, () => {
		using f = fixture({ ...defaultLimits, maxPendingEvents: 10 });
		const job = f.jobs.create(scope, { ...plan(`mixed-${policy}`, 2), policy });
		const first = f.jobs.claim(scope);
		assert.ok(first);
		f.jobs.fail(scope, first, false);
		const last = f.jobs.claim(scope);
		assert.ok(last);
		f.store.write(scope, last.stage, file());
		const publication = f.store.publish(scope, last.stage, [file()]);
		drain(f.outbox);
		for (let i = 0; i < 8; i++)
			f.jobs.create(scope, plan(`mixed-pressure-${i}`, 1));
		f.advance(defaultLimits.leaseMs);
		assert.equal(f.jobs.claim(scope), null);
		assert.equal(
			f.jobs.job(scope, job.id).status,
			policy === "atomic" ? "failed" : "running",
		);
		assert.equal(pending(f.db), policy === "atomic" ? 10 : 8);
		drain(f.outbox);
		f.jobs.claim(scope);
		assert.equal(
			f.jobs.job(scope, job.id).status,
			policy === "atomic" ? "failed" : "partially_succeeded",
		);
		assert.equal(
			f.jobs.inventory(scope, job.id)[1]?.publication,
			publication.id,
		);
		assert.equal(
			f.db.sql
				.prepare("SELECT outcome FROM attempts WHERE id=?")
				.get(last.attempt)?.["outcome"],
			"succeeded",
		);
		assert.equal(
			Boolean(f.store.publication(scope, job.operation)),
			policy === "allow_partial",
		);
	});
}

test("resumes recovery at the persisted page boundary before admitting healthy work", () => {
	using f = fixture({ ...defaultLimits, maxPendingEvents: 10, pageSize: 1 });
	const { seeded, healthy } = seedRecovery(f.db, true, 4);
	f.advance(defaultLimits.leaseMs);
	for (let recovered = 1; recovered <= 4; recovered++) {
		assert.equal(f.jobs.claim(scope), null);
		assert.equal(
			seeded.filter(
				({ job }) => f.jobs.job(scope, job.id).status === "succeeded",
			).length,
			recovered,
		);
		assert.equal(pending(f.db), 3);
		drain(f.outbox);
	}
	assert.equal(f.jobs.claim(scope)?.job, healthy.id);
});

for (const fault of ["INTEGRITY", "STORAGE"] as const) {
	test(`propagates ${fault} during recovery without checkpointing the damaged row`, () => {
		using f = fixture({ ...defaultLimits, maxPendingEvents: 10 });
		const { seeded } = seedRecovery(f.db, true, 4);
		const damaged = seeded[1];
		assert.ok(damaged);
		if (fault === "INTEGRITY")
			f.db.sql
				.prepare("UPDATE blobs SET bytes=? WHERE digest=?")
				.run(
					Buffer.alloc(file("output.bin", "budget-output-1").length),
					file("output.bin", "budget-output-1").digest,
				);
		else
			f.db.sql.exec(
				"CREATE TRIGGER recovery_storage_fault BEFORE UPDATE ON attempts WHEN OLD.id='" +
					damaged.claim.attempt +
					"' BEGIN SELECT RAISE(ABORT,'fixture'); END",
			);
		f.advance(defaultLimits.leaseMs);
		assert.throws(
			() => f.jobs.claim(scope),
			(error: unknown) =>
				error instanceof DurabilityError && error.code === fault,
		);
		assert.equal(f.jobs.inventory(scope, damaged.job.id)[0]?.status, "running");
		assert.equal(
			f.db.sql
				.prepare("SELECT outcome FROM attempts WHERE id=?")
				.get(damaged.claim.attempt)?.["outcome"],
			null,
		);
		assert.equal(
			f.outbox
				.list(scope)
				.filter(
					(e) => e.attempt === damaged.claim.attempt && e.kind === "succeeded",
				).length,
			0,
		);
	});
}
