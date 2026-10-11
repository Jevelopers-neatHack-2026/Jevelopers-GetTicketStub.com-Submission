import { test } from "node:test";
import assert from "node:assert/strict";
import {
	batchFixture,
	eventInventory,
} from "../fixtures/production-output/fixture.js";
import { resolveCsvPolicy } from "../../src/personalization/private-csv.js";
import { createPrivateCsvBatch } from "../../src/personalization/private-csv-batch.js";
import {
	privateResultPage,
	runPrivateBatch,
} from "../../src/personalization/private-batch.js";
import { digest } from "../../src/composition/primitives.js";
import { ObservationOutbox } from "../../src/telemetry/observations.js";

const source = async function* (bytes: Uint8Array) {
	for (let i = 0; i < bytes.length; i += 11) yield bytes.subarray(i, i + 11);
};
test("conditionally imports a real CSV through composition, storage and privacy-safe durable redelivery", {
	timeout: 30000,
}, async () => {
	using f = await batchFixture();
	const bytes = Buffer.from(
			"id,attendee,seat\r\na,Zoë,0007\r\nb,D'Arcy,0008\r\n",
		),
		csvPolicy = resolveCsvPolicy(
			{
				revision: "private-csv-1_csv-parse-6.1.0",
				delimiter: ",",
				newline: "\r\n",
				maxBytes: 10000,
				maxRows: 100,
				maxColumns: 3,
				maxCellBytes: 1000,
				rowIdHeader: "id",
				mapping: [
					{ header: "attendee", field: "name" },
					{ header: "seat", field: "detail" },
				],
			},
			f.context.rows,
		);
	const job = await createPrivateCsvBatch({
		enabled: true,
		engine: f.engine,
		key: "csv",
		context: f.context,
		source: source(bytes),
		fileDigest: digest(bytes),
		csvPolicy,
	});
	await runPrivateBatch({
		engine: f.engine,
		context: f.context,
		signal: new AbortController().signal,
	});
	assert.equal(f.engine.job(f.context.input.scope, job.id).status, "succeeded");
	const rows = privateResultPage(f.engine, f.context.input.scope, job.id);
	assert.deepEqual(
		rows.map((r) => r.csv?.logicalRecord),
		[1, 2],
	);
	assert.equal(rows[1]?.csv?.checkpoint.offset, bytes.length);
	assert.ok(
		rows.every(
			(r) => r.csv?.checkpoint.fileDigest === digest(bytes) && r.archiveDigest,
		),
	);
	const outbox = new ObservationOutbox(f.db),
		first = outbox.claim();
	assert.ok(first);
	outbox.settle(first, false);
	f.setNow(2001);
	const second = outbox.claim();
	assert.ok(second);
	assert.equal(second.event.id, first.event.id);
	assert.notEqual(second.transport, first.transport);
	outbox.settle(second, true);
	const events = eventInventory(outbox, f.context.input.scope);
	const serialized = JSON.stringify(events);
	assert.equal(serialized.includes("Zoë"), false);
	assert.equal(serialized.includes("0007"), false);
	assert.ok(
		events.some(
			(e) => e.kind === "execution_started" && e.attempt && e.job === job.id,
		),
	);
	assert.equal(f.state.generationCalls, 0);
});
test("creates no job when disabled CSV, changed digest or malformed syntax fails before scheduling", async () => {
	using f = await batchFixture();
	const bytes = Buffer.from("id,attendee,seat\r\na,Alice,0007\r\n"),
		csvPolicy = resolveCsvPolicy(
			{
				revision: "private-csv-1_csv-parse-6.1.0",
				delimiter: ",",
				newline: "\r\n",
				maxBytes: 10000,
				maxRows: 100,
				maxColumns: 3,
				maxCellBytes: 1000,
				rowIdHeader: "id",
				mapping: [
					{ header: "attendee", field: "name" },
					{ header: "seat", field: "detail" },
				],
			},
			f.context.rows,
		);
	const request = {
		engine: f.engine,
		key: "invalid",
		context: f.context,
		fileDigest: digest(bytes),
		csvPolicy,
	};
	await assert.rejects(
		createPrivateCsvBatch({
			...request,
			enabled: false,
			source: source(bytes),
		}),
	);
	await assert.rejects(
		createPrivateCsvBatch({
			...request,
			enabled: true,
			source: source(bytes),
			fileDigest: digest("different"),
		}),
	);
	await assert.rejects(
		createPrivateCsvBatch({
			...request,
			enabled: true,
			source: source(Buffer.from('id,attendee,seat\r\na,"Alice,0007')),
		}),
	);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM jobs").get()?.["n"],
		0,
	);
});
