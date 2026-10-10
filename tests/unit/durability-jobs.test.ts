import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DurabilityDatabase,
	DurabilityError,
	defaultLimits,
	hash,
} from "../../src/internal/durability.js";
import {
	fixture,
	file,
	plan,
	scope,
	foreign,
	sensitive,
} from "../fixtures/durability/fixture.js";

const code = (expected: DurabilityError["code"]) => (error: unknown) =>
	error instanceof DurabilityError && error.code === expected;
test("preserves identical input in distinct rows and defaults to atomic when planned", () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan());
	const rows = f.jobs.inventory(scope, job.id);
	assert.equal(job.policy, "atomic");
	assert.equal(rows.length, 2);
	assert.equal(new Set(rows.map((r) => r.operation)).size, 2);
	assert.equal(new Set(rows.map((r) => r.digest)).size, 1);
	assert.equal(f.jobs.create(scope, plan()).id, job.id);
});
test("rejects duplicate row identities when content differs", () => {
	using f = fixture();
	const original = plan();
	const first = original.rows[0];
	assert.ok(first);
	const bytes = Buffer.from("different");
	assert.throws(
		() =>
			f.jobs.create(scope, {
				...original,
				rows: [first, { id: first.id, bytes, digest: hash(bytes) }],
			}),
		code("INVALID_INPUT"),
	);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM jobs").get()?.["n"],
		0,
	);
});
test("rejects CSV before persisting any structured job", () => {
	using f = fixture();
	const unsupported = { ...plan(), format: "csv" };
	assert.throws(
		() => Reflect.apply(f.jobs.create, f.jobs, [scope, unsupported]),
		code("INVALID_INPUT"),
	);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM jobs").get()?.["n"],
		0,
	);
});
test("rejects changed pins, policy and input on the same batch key", () => {
	using f = fixture();
	const original = plan();
	f.jobs.create(scope, original);
	const pins = Buffer.from("changed-pins");
	const bytes = Buffer.from("changed-row");
	for (const changed of [
		{ ...original, pins, pinsDigest: hash(pins) },
		{ ...original, policy: "allow_partial" as const },
		{ ...original, rows: [{ id: "row-0", bytes, digest: hash(bytes) }] },
	])
		assert.throws(
			() => f.jobs.create(scope, changed),
			code("IDEMPOTENCY_CONFLICT"),
		);
});
test("keeps atomic batch unpublished when any row permanently fails", () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan());
	const a = f.jobs.claim(scope);
	assert.ok(a);
	f.jobs.complete(scope, a, [file()]);
	const b = f.jobs.claim(scope);
	assert.ok(b);
	f.jobs.fail(scope, b, false);
	assert.equal(f.jobs.job(scope, job.id).status, "failed");
	assert.equal(f.store.publication(scope, job.operation), null);
	assert.deepEqual(f.jobs.results(scope, job.id), []);
	assert.deepEqual(
		f.jobs.inventory(scope, job.id).map((r) => r.status),
		["succeeded", "failed"],
	);
});
test("publishes complete row inventory with durable failures when partial policy allows it", () => {
	using f = fixture();
	const job = f.jobs.create(scope, { ...plan(), policy: "allow_partial" });
	const a = f.jobs.claim(scope);
	assert.ok(a);
	f.jobs.complete(scope, a, [file()]);
	const b = f.jobs.claim(scope);
	assert.ok(b);
	f.jobs.fail(scope, b, false);
	assert.equal(f.jobs.job(scope, job.id).status, "partially_succeeded");
	const pub = f.store.publication(scope, job.operation);
	assert.ok(pub);
	const result = f.store.retrieve(scope, pub.id);
	const receipt = result.files[0];
	assert.ok(receipt);
	const rows: unknown = JSON.parse(Buffer.from(receipt.bytes).toString());
	assert.ok(Array.isArray(rows));
	assert.equal(rows.length, 2);
	assert.equal(f.jobs.results(scope, job.id).length, 2);
});
test("fences cancelled in-flight workers and retains completed rows when cancelled", () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("cancel", 3));
	const done = f.jobs.claim(scope);
	assert.ok(done);
	f.jobs.complete(scope, done, [file()]);
	const inflight = f.jobs.claim(scope);
	assert.ok(inflight);
	f.jobs.cancel(scope, job.id);
	assert.throws(
		() => f.jobs.complete(scope, inflight, [file()]),
		code("STALE_CLAIM"),
	);
	assert.equal(f.jobs.claim(scope), null);
	assert.deepEqual(
		f.jobs.inventory(scope, job.id).map((r) => r.status),
		["succeeded", "cancelled", "cancelled"],
	);
	assert.equal(f.store.publication(scope, job.operation), null);
	assert.equal(
		f.store.retrieve(
			scope,
			f.jobs.inventory(scope, job.id)[0]?.publication ?? done.operation,
		).files.length,
		1,
	);
});
test("rejects stale leases while a later attempt publishes once", () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("lease", 1));
	const old = f.jobs.claim(scope);
	assert.ok(old);
	f.advance(defaultLimits.leaseMs);
	assert.equal(f.jobs.claim(scope), null);
	f.advance(defaultLimits.backoffMs);
	const replacement = f.jobs.claim(scope);
	assert.ok(replacement);
	assert.throws(
		() => f.jobs.complete(scope, old, [file()]),
		code("STALE_CLAIM"),
	);
	f.jobs.complete(scope, replacement, [file()]);
	assert.equal(f.jobs.job(scope, job.id).status, "succeeded");
	assert.notEqual(old.attempt, replacement.attempt);
	assert.equal(
		f.db.sql
			.prepare("SELECT COUNT(*) AS n FROM publications WHERE operation=?")
			.get(old.operation)?.["n"],
		1,
	);
});
test("fences direct storage writes and publications after a row lease expires", () => {
	using f = fixture();
	f.jobs.create(scope, plan("direct-fence", 1));
	const claim = f.jobs.claim(scope);
	assert.ok(claim);
	f.store.write(scope, claim.stage, file());
	f.advance(defaultLimits.leaseMs);
	assert.throws(
		() => f.store.write(scope, claim.stage, file("late.bin")),
		code("STALE_CLAIM"),
	);
	assert.throws(
		() => f.store.publish(scope, claim.stage, [file()]),
		code("STALE_CLAIM"),
	);
	assert.equal(f.store.publication(scope, claim.operation), null);
});
test("retains uncertain completed output when cancelled before checkpoint reconciliation", () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("cancel-uncertain", 1));
	const claim = f.jobs.claim(scope);
	assert.ok(claim);
	f.store.write(scope, claim.stage, file());
	const publication = f.store.publish(scope, claim.stage, [file()]);
	f.jobs.cancel(scope, job.id);
	assert.equal(f.jobs.job(scope, job.id).status, "cancelled");
	assert.equal(f.jobs.inventory(scope, job.id)[0]?.status, "succeeded");
	assert.equal(f.jobs.inventory(scope, job.id)[0]?.publication, publication.id);
	assert.equal(f.jobs.claim(scope), null);
});
test("rejects corrupt uncertain output instead of marking a recovered row successful", () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("corrupt-uncertain", 1));
	const claim = f.jobs.claim(scope);
	assert.ok(claim);
	f.store.write(scope, claim.stage, file());
	f.store.publish(scope, claim.stage, [file()]);
	f.db.sql
		.prepare("UPDATE blobs SET bytes=?")
		.run(Buffer.alloc(file().length, 88));
	f.advance(defaultLimits.leaseMs);
	assert.throws(() => f.jobs.claim(scope), code("INTEGRITY"));
	assert.equal(f.jobs.job(scope, job.id).status, "running");
	assert.equal(f.jobs.inventory(scope, job.id)[0]?.status, "running");
	assert.equal(f.store.operation(scope, job.operation).status, "pending");
});
test("maintains terminal progress across execution retries", () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("progress", 2));
	const a = f.jobs.claim(scope);
	assert.ok(a);
	f.jobs.complete(scope, a, [file()]);
	const before = f.jobs.progress(scope, job.id);
	const b = f.jobs.claim(scope);
	assert.ok(b);
	f.jobs.fail(scope, b, true);
	f.advance(defaultLimits.backoffMs);
	const retry = f.jobs.claim(scope);
	assert.ok(retry);
	f.jobs.complete(scope, retry, [file()]);
	const after = f.jobs.progress(scope, job.id);
	assert.equal(before.completed, 1);
	assert.equal(after.completed, 2);
	assert.equal(after.total, 2);
	assert.equal(after.executionAttempts, 3);
	assert.equal(after.failed, 0);
});
test("caps retry attempts with backoff and permanent terminal outcomes", () => {
	using f = fixture({ ...defaultLimits, maxAttempts: 2, backoffMs: 10 });
	const job = f.jobs.create(scope, plan("retry", 1));
	const first = f.jobs.claim(scope);
	assert.ok(first);
	f.jobs.fail(scope, first, true);
	assert.equal(f.jobs.claim(scope), null);
	f.advance(10);
	const second = f.jobs.claim(scope);
	assert.ok(second);
	f.jobs.fail(scope, second, true);
	assert.equal(f.jobs.claim(scope), null);
	assert.equal(f.jobs.job(scope, job.id).status, "failed");
	assert.equal(f.jobs.inventory(scope, job.id)[0]?.attempts, 2);
	assert.deepEqual(
		f.outbox
			.list(scope)
			.filter((e) => ["retryable", "failed"].includes(e.kind))
			.map((e) => e.kind),
		["retryable", "failed", "failed"],
	);
});
test("starts no execution when completed work is read or submitted again", async () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("read", 1));
	let executions = 0;
	await f.jobs.runOne(
		scope,
		async () => {
			executions++;
			return [file()];
		},
		new AbortController().signal,
	);
	const before = f.outbox.list(scope).length;
	f.jobs.create(scope, plan("read", 1));
	f.jobs.results(scope, job.id);
	f.jobs.inventory(scope, job.id);
	await f.jobs.runOne(
		scope,
		async () => {
			executions++;
			return [file()];
		},
		new AbortController().signal,
	);
	assert.equal(executions, 1);
	assert.equal(f.outbox.list(scope).length, before);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
		1,
	);
});
test("enforces queue, row, byte, concurrency and page bounds", () => {
	using f = fixture({
		...defaultLimits,
		maxRows: 2,
		maxInputBytes: 2048,
		maxQueuedJobs: 1,
		concurrency: 1,
		pageSize: 1,
	});
	const job = f.jobs.create(scope, plan());
	assert.throws(() => f.jobs.create(scope, plan("too-many", 3)), code("LIMIT"));
	assert.throws(() => f.jobs.create(scope, plan("queue", 1)), code("LIMIT"));
	const input = Buffer.alloc(2049);
	assert.throws(
		() =>
			f.jobs.create(scope, {
				...plan("bytes", 1),
				request: input,
				requestDigest: hash(input),
			}),
		code("LIMIT"),
	);
	assert.ok(f.jobs.claim(scope));
	assert.equal(f.jobs.claim(scope), null);
	assert.equal(f.jobs.inventory(scope, job.id).length, 1);
	assert.equal(f.jobs.inventory(scope, job.id, 1)[0]?.ordinal, 1);
	assert.throws(() => f.jobs.inventory(scope, job.id, 0, 2), code("LIMIT"));
	assert.throws(() => f.jobs.inventory(foreign, job.id), code("NOT_FOUND"));
});
test("refuses incompatible database configuration and unsupported versions on restart", () => {
	using f = fixture();
	assert.throws(
		() => new DurabilityDatabase(f.path, { ...defaultLimits, concurrency: 8 }),
		code("IDEMPOTENCY_CONFLICT"),
	);
	f.db.sql.exec("UPDATE settings SET version=2");
	assert.throws(
		() => new DurabilityDatabase(f.path),
		code("UNSUPPORTED_VERSION"),
	);
});
test("rolls back publication and row checkpoints when observation backpressure is reached", () => {
	using f = fixture({ ...defaultLimits, maxPendingEvents: 10 });
	const job = f.jobs.create(scope, plan("pressure", 1));
	const claim = f.jobs.claim(scope);
	assert.ok(claim);
	for (let i = 0; i < 8; i++) f.jobs.create(scope, plan(`other-${i}`, 1));
	assert.throws(() => f.jobs.complete(scope, claim, [file()]), code("LIMIT"));
	assert.equal(f.store.publication(scope, claim.operation), null);
	assert.equal(f.jobs.inventory(scope, job.id)[0]?.status, "running");
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		0,
	);
});
test("records safe codes when a renderer throws sensitive third-party errors", async () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("privacy", 1));
	await f.jobs.runOne(
		scope,
		async () => {
			throw new Error(sensitive);
		},
		new AbortController().signal,
	);
	assert.equal(f.jobs.job(scope, job.id).status, "failed");
	assert.ok(!JSON.stringify(f.outbox.list(scope)).includes(sensitive));
	assert.ok(
		!JSON.stringify(f.jobs.inventory(scope, job.id)).includes(sensitive),
	);
});
test("cancels the whole job when a cooperative renderer aborts during execution", async () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("abort", 2));
	const controller = new AbortController();
	await f.jobs.runOne(
		scope,
		async () => {
			controller.abort();
			throw new Error(sensitive);
		},
		controller.signal,
	);
	assert.equal(f.jobs.job(scope, job.id).status, "cancelled");
	assert.deepEqual(
		f.jobs.inventory(scope, job.id).map((row) => row.status),
		["cancelled", "cancelled"],
	);
	assert.equal(f.jobs.claim(scope), null);
});
test("allows another scope to execute when foreign crashed leases have expired", () => {
	using f = fixture({ ...defaultLimits, concurrency: 1 });
	f.jobs.create(foreign, plan("foreign", 1));
	assert.ok(f.jobs.claim(foreign));
	f.advance(defaultLimits.leaseMs);
	f.jobs.create(scope, plan("local", 1));
	assert.ok(f.jobs.claim(scope));
});
