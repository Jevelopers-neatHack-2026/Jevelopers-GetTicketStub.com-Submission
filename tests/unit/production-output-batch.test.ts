import { test } from "node:test";
import assert from "node:assert/strict";
import {
	batchFixture,
	sampleRows,
} from "../fixtures/production-output/fixture.js";
import {
	createPrivateBatch,
	privateBatchRenderer,
	privateResultPage,
	runPrivateBatch,
} from "../../src/personalization/private-batch.js";
import {
	DurabilityDatabase,
	DurabilityError,
	defaultLimits,
} from "../../src/internal/durability.js";
import { DurableBatchEngine } from "../../src/jobs/durable-batch.js";
import { join } from "node:path";

test("executes a real structured batch and pages exact durable artifact joins", {
	timeout: 30000,
}, async () => {
	using f = await batchFixture();
	const job = createPrivateBatch({
		engine: f.engine,
		key: "happy",
		context: f.context,
		rows: sampleRows,
	});
	await runPrivateBatch({
		engine: f.engine,
		context: f.context,
		signal: new AbortController().signal,
	});
	assert.equal(f.engine.job(f.context.input.scope, job.id).status, "succeeded");
	const page = privateResultPage(f.engine, f.context.input.scope, job.id);
	assert.deepEqual(
		page.map((r) => r.rowId),
		sampleRows.map((r) => r.rowId),
	);
	assert.ok(
		page.every(
			(r) =>
				r.publication &&
				r.archiveDigest &&
				r.status === "succeeded" &&
				!r.handoffEligible,
		),
	);
	assert.equal(
		f.engine.progress(f.context.input.scope, job.id).executionAttempts,
		2,
	);
	assert.equal(f.state.generationCalls, 0);
});
for (const policy of ["atomic", "allow_partial"] as const)
	test(`records an invalid row without eligible omission under ${policy}`, {
		timeout: 30000,
	}, async () => {
		using f = await batchFixture();
		const good = sampleRows[0];
		assert.ok(good);
		const job = createPrivateBatch({
			engine: f.engine,
			key: policy,
			context: f.context,
			rows: [good, { rowId: "bad", fields: { name: 7, detail: "0008" } }],
			policy,
		});
		await runPrivateBatch({
			engine: f.engine,
			context: f.context,
			signal: new AbortController().signal,
		});
		assert.equal(
			f.engine.job(f.context.input.scope, job.id).status,
			policy === "atomic" ? "failed" : "partially_succeeded",
		);
		const rows = privateResultPage(f.engine, f.context.input.scope, job.id);
		assert.equal(rows[1]?.status, "failed");
		assert.ok(rows[1]?.errors.some((e) => e.path === "fields.name"));
		assert.equal(Boolean(rows[0]?.publication), policy === "allow_partial");
		assert.equal(
			f.engine.store.publication(f.context.input.scope, job.operation) !== null,
			policy === "allow_partial",
		);
		assert.deepEqual(f.engine.progress(f.context.input.scope, job.id), {
			total: 2,
			completed: 2,
			succeeded: 1,
			failed: 1,
			cancelled: 0,
			executionAttempts: 2,
		});
	});
test("returns the same job for repeated input and rejects changed input under the same key", async () => {
	using f = await batchFixture();
	const request = {
		engine: f.engine,
		key: "same",
		context: f.context,
		rows: sampleRows,
	};
	const a = createPrivateBatch(request),
		b = createPrivateBatch(request);
	assert.equal(a.id, b.id);
	assert.throws(
		() =>
			createPrivateBatch({
				...request,
				rows: [{ rowId: "row-001", fields: { name: "Bob", detail: "0007" } }],
			}),
		(error) =>
			error instanceof DurabilityError && error.code === "IDEMPOTENCY_CONFLICT",
	);
});
test("blocks changed template pins when a resumed worker consumes a row", async () => {
	using f = await batchFixture();
	createPrivateBatch({
		engine: f.engine,
		key: "pins",
		context: f.context,
		rows: sampleRows,
	});
	const claim = f.engine.claim(f.context.input.scope);
	assert.ok(claim);
	await assert.rejects(
		privateBatchRenderer(
			{
				...f.context,
				output: { ...f.context.output, dpi: 600 },
			},
			f.engine.store,
		)(claim, new AbortController().signal),
	);
});
test("enforces engine concurrency and cancellation before real work publishes", async () => {
	using f = await batchFixture();
	const job = createPrivateBatch({
		engine: f.engine,
		key: "cancel",
		context: f.context,
		rows: [
			...sampleRows,
			{ rowId: "row-003", fields: { name: "Alice", detail: "0009" } },
		],
	});
	assert.ok(f.engine.claim(f.context.input.scope));
	assert.ok(f.engine.claim(f.context.input.scope));
	assert.equal(f.engine.claim(f.context.input.scope), null);
	f.engine.cancel(f.context.input.scope, job.id);
	assert.equal(f.engine.job(f.context.input.scope, job.id).status, "cancelled");
	assert.equal(f.engine.progress(f.context.input.scope, job.id).cancelled, 3);
	assert.ok(
		privateResultPage(f.engine, f.context.input.scope, job.id).every(
			(r) => r.publication === null,
		),
	);
});
test("reopens a real durable database and resumes an interrupted exact row", {
	timeout: 30000,
}, async () => {
	using f = await batchFixture();
	const job = createPrivateBatch({
		engine: f.engine,
		key: "resume",
		context: f.context,
		rows: [sampleRows[0]],
	});
	assert.ok(f.engine.claim(f.context.input.scope));
	let restartClock = 32000;
	const db = new DurabilityDatabase(
		join(f.root, "state.sqlite"),
		{ ...defaultLimits, pageSize: 2, concurrency: 2, leaseMs: 30000 },
		() => restartClock,
	);
	try {
		const engine = new DurableBatchEngine(db);
		engine.claim(f.context.input.scope);
		restartClock = 34000;
		await engine.runOne(
			f.context.input.scope,
			privateBatchRenderer(f.context, f.engine.store),
			new AbortController().signal,
		);
		assert.equal(engine.job(f.context.input.scope, job.id).status, "succeeded");
		assert.equal(
			engine.progress(f.context.input.scope, job.id).executionAttempts,
			2,
		);
	} finally {
		db.close();
	}
});
test("rejects cross-scope inventory access without exposing row IDs", async () => {
	using f = await batchFixture();
	const job = createPrivateBatch({
		engine: f.engine,
		key: "scope",
		context: f.context,
		rows: sampleRows,
	});
	assert.throws(
		() =>
			privateResultPage(
				f.engine,
				{ tenant: "other", project: "synthetic-project" },
				job.id,
			),
		(error) => error instanceof DurabilityError && error.code === "NOT_FOUND",
	);
});
