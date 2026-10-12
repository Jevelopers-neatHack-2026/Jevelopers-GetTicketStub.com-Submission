import { test } from "node:test";
import assert from "node:assert/strict";
import { batchFixture } from "../fixtures/production-output/fixture.js";
import {
	createPrivateBatch,
	privateResultPage,
	runPrivateBatch,
} from "../../src/personalization/private-batch.js";
test("persists a genuine failed preflight diagnostic without publishing a completed batch", {
	timeout: 30000,
}, async () => {
	using f = await batchFixture();
	const job = createPrivateBatch({
		engine: f.engine,
		key: "unsupported-pdf",
		context: f.context,
		rows: [
			{
				rowId: "wrap",
				fields: {
					name: "W".repeat(200),
					detail: "0007",
				},
			},
		],
	});
	await runPrivateBatch({
		engine: f.engine,
		context: f.context,
		signal: new AbortController().signal,
	});
	assert.equal(f.engine.job(f.context.input.scope, job.id).status, "failed");
	const before = f.db.sql
		.prepare("SELECT COUNT(*) AS n FROM observations")
		.get();
	const rows = privateResultPage(f.engine, f.context.input.scope, job.id);
	assert.equal(rows[0]?.status, "failed");
	assert.equal(rows[0]?.publication, null);
	assert.equal(rows[0]?.archiveDigest, null);
	assert.deepEqual(rows[0]?.errors, [
		{ code: "OUTPUT_PREFLIGHT", path: "model" },
	]);
	assert.deepEqual(
		privateResultPage(f.engine, f.context.input.scope, job.id),
		rows,
	);
	assert.deepEqual(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM observations").get(),
		before,
	);
});
test("bounds a large durable plan, renders a page and cancels the remaining rows", {
	timeout: 30000,
}, async () => {
	using f = await batchFixture();
	const rows = Array.from({ length: 100 }, (_, i) => ({
		rowId: `large-${i}`,
		fields: { name: "Alice", detail: "0007" },
	}));
	const job = createPrivateBatch({
		engine: f.engine,
		key: "large",
		context: f.context,
		rows,
	});
	const { privateBatchRenderer } = await import(
		"../../src/personalization/private-batch.js"
	);
	await Promise.all([
		f.engine.runOne(
			f.context.input.scope,
			privateBatchRenderer(f.context, f.engine.store),
			new AbortController().signal,
		),
		f.engine.runOne(
			f.context.input.scope,
			privateBatchRenderer(f.context, f.engine.store),
			new AbortController().signal,
		),
	]);
	assert.equal(f.engine.progress(f.context.input.scope, job.id).succeeded, 2);
	assert.equal(
		privateResultPage(f.engine, f.context.input.scope, job.id).length,
		2,
	);
	f.engine.cancel(f.context.input.scope, job.id);
	assert.equal(f.engine.progress(f.context.input.scope, job.id).cancelled, 98);
	assert.equal(f.engine.results(f.context.input.scope, job.id).length, 0);
});
