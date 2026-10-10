import { test } from "node:test";
import assert from "node:assert/strict";
import {
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
import { evidence } from "../fixtures/durability/evidence.js";

const code = (expected: DurabilityError["code"]) => (error: unknown) =>
	error instanceof DurabilityError && error.code === expected;
function seed(f: ReturnType<typeof fixture>) {
	const bytes = Buffer.from(sensitive);
	const op = f.store.bind(scope, "export", sensitive, bytes, hash(bytes));
	const stage = f.store.stage(scope, op.id);
	f.store.write(scope, stage, file());
	return f.store.publish(scope, stage, [file()]);
}
test("retains event identity through outage and transport redelivery", async () => {
	using f = fixture();
	seed(f);
	const seen: string[] = [];
	const sink = async (event: { readonly id: string }) => {
		seen.push(event.id);
		throw new Error(sensitive);
	};
	await f.outbox.deliverOne(sink, new AbortController().signal);
	assert.equal(f.outbox.claim(), null);
	f.advance(defaultLimits.backoffMs);
	const retry = f.outbox.claim();
	assert.ok(retry);
	seen.push(retry.event.id);
	f.outbox.settle(retry, true);
	assert.equal(new Set(seen).size, 1);
	assert.equal(f.outbox.claim(), null);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM transports").get()?.["n"],
		2,
	);
	assert.equal(f.outbox.list(scope).length, 1);
});
test("uses a new execution attempt for retries while readings emit no new event", () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("retry", 1));
	const a = f.jobs.claim(scope);
	assert.ok(a);
	f.jobs.fail(scope, a, true);
	f.advance(defaultLimits.backoffMs);
	const b = f.jobs.claim(scope);
	assert.ok(b);
	f.jobs.complete(scope, b, [file()]);
	const before = f.outbox.list(scope);
	f.jobs.create(scope, plan("retry", 1));
	f.jobs.results(scope, job.id);
	assert.notEqual(a.attempt, b.attempt);
	assert.equal(before.filter((e) => e.kind === "execution_started").length, 2);
	assert.deepEqual(f.outbox.list(scope), before);
	assert.ok(
		before
			.filter((e) => e.kind === "succeeded" && e.attempt)
			.every((e) => e.duration_ms !== null),
	);
	assert.ok(
		before
			.filter((e) => e.kind === "planned")
			.every((e) => e.duration_ms === null && e.bytes === null),
	);
});
test("fences expired transport acknowledgments and retains exhausted events", () => {
	using f = fixture({
		...defaultLimits,
		maxDeliveryAttempts: 2,
		backoffMs: 10,
	});
	seed(f);
	const a = f.outbox.claim();
	assert.ok(a);
	f.advance(defaultLimits.leaseMs);
	const b = f.outbox.claim();
	assert.ok(b);
	assert.throws(() => f.outbox.settle(a, true), code("STALE_CLAIM"));
	f.outbox.settle(b, false);
	assert.equal(f.outbox.claim(), null);
	assert.equal(
		f.db.sql.prepare("SELECT status FROM outbox").get()?.["status"],
		"exhausted",
	);
	f.outbox.requeue(b.event.id);
	const c = f.outbox.claim();
	assert.ok(c);
	assert.equal(c.event.id, a.event.id);
	assert.equal(f.outbox.list(scope).length, 1);
});
test("makes observation records immutable and scope-bound", () => {
	using f = fixture();
	seed(f);
	assert.throws(() => f.db.sql.exec("UPDATE observations SET kind='failed'"));
	assert.throws(() => f.db.sql.exec("DELETE FROM observations"));
	assert.deepEqual(f.outbox.list(foreign), []);
});
test("excludes sensitive input, scope and third-party messages from observations", async () => {
	using f = fixture();
	seed(f);
	await f.outbox.deliverOne(async () => {
		throw new Error(sensitive);
	}, new AbortController().signal);
	const serialized = JSON.stringify({
		observations: f.outbox.list(scope),
		transport: f.db.sql.prepare("SELECT * FROM transports").all(),
	});
	for (const marker of [
		sensitive,
		"email@example.invalid",
		"token=secret",
		"https://private.invalid",
		"synthetic-tenant",
		"synthetic-project",
	])
		assert.ok(!serialized.includes(marker), marker);
	const event = f.outbox.list(scope)[0];
	assert.ok(event);
	assert.equal(event.bytes, file().length);
	assert.equal(event.duration_ms, null);
	evidence("privacy", {
		serializedDigest: hash(serialized),
		sourceObservationIds: f.outbox.list(scope).map((item) => item.id),
		sensitiveMarkerPresent: false,
		rawInputsIncluded: false,
		thirdPartyMessagesIncluded: false,
	});
});
test("bounds concurrent transport claims while preserving all queued events", () => {
	using f = fixture({ ...defaultLimits, concurrency: 1 });
	seed(f);
	f.jobs.create(scope, plan("second", 1));
	const first = f.outbox.claim();
	assert.ok(first);
	assert.equal(f.outbox.claim(), null);
	f.outbox.settle(first, true);
	assert.ok(f.outbox.claim());
	assert.equal(f.outbox.list(scope).length, 2);
});
test("records retryable transport state when an in-flight delivery is aborted", async () => {
	using f = fixture();
	seed(f);
	const controller = new AbortController();
	await f.outbox.deliverOne(async () => {
		controller.abort();
	}, controller.signal);
	assert.equal(
		f.db.sql.prepare("SELECT status FROM outbox").get()?.["status"],
		"pending",
	);
	assert.equal(f.outbox.list(scope).length, 1);
	assert.equal(
		f.db.sql.prepare("SELECT outcome FROM transports").get()?.["outcome"],
		"retryable",
	);
});
