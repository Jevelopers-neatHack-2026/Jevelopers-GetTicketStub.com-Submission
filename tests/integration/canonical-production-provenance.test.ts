import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import {
	exportRequest,
	batchRequest,
} from "../fixtures/canonical-production/requests.js";
import { LocalArtifactStore } from "../../src/storage/local-store.js";
import { DurableBatchEngine } from "../../src/jobs/durable-batch.js";
import { idSchema, scopeSchema } from "../../src/internal/durability.js";
import type { StoredFile } from "../../src/storage/local-store.js";
import { readResource } from "../../src/runtime/resources.js";

test("records the actual consumer pin in base and both row bundles and batch evidence", {
	timeout: 60000,
}, async () => {
	await using given = await fixtureHost();
	const expected: unknown = JSON.parse(
		(
			await readResource("vendor/shared-contracts/candidate-pin.json")
		).toString(),
	);
	const pin = z
		.object({
			version: z.literal("0.9.7"),
			accepted: z.literal(false),
			source_revision: z.string(),
			archive_sha256: z.string(),
		})
		.parse(expected);
	const { operations, context } = given.candidate;
	const artifact = await operations.composeArtifact(
		context,
		given.records.request,
	);
	assert.ok(artifact.ok);
	const base = await operations.exportArtifactBundle(
		context,
		exportRequest(given.records, artifact.value),
	);
	assert.ok(base.ok);
	const raw = given.db.sql
		.prepare("SELECT bytes FROM canonical_records WHERE key=?")
		.get(`bundle:${artifact.value.artifact_ref.id}`);
	const stored = z
		.object({ publication: idSchema })
		.parse(JSON.parse(z.object({ bytes: z.string() }).parse(raw).bytes));
	const inventories: (readonly StoredFile[])[] = [
		new LocalArtifactStore(given.db).retrieve(
			given.host().private_scope,
			stored.publication,
		).files,
	];
	const batch = await operations.personalizeArtifactBatch(
		context,
		batchRequest(given.records),
	);
	assert.ok(batch.ok && batch.value.contract === "JobRef");
	const jobRaw = given.db.sql
		.prepare("SELECT bytes FROM canonical_records WHERE key=?")
		.get(`job:${batch.value.job_ref.id}`);
	const job = z
		.object({ plan: z.object({ private_scope: scopeSchema }) })
		.parse(JSON.parse(z.object({ bytes: z.string() }).parse(jobRaw).bytes));
	const engine = new DurableBatchEngine(given.db);
	for (const row of engine.inventory(
		job.plan.private_scope,
		idSchema.parse(batch.value.job_ref.id),
	)) {
		assert.ok(row.publication);
		inventories.push(
			engine.store.retrieve(job.plan.private_scope, row.publication).files,
		);
	}
	assert.equal(inventories.length, 3);
	for (const files of inventories) {
		const lineage = files.find((file) => file.name === "lineage.json");
		assert.ok(lineage);
		const when = z
			.object({
				contract_candidate: z.string(),
				accepted: z.boolean(),
				live_integration: z.boolean(),
				consumer_pin: z.unknown(),
			})
			.parse(JSON.parse(Buffer.from(lineage.bytes).toString()));
		assert.equal(when.contract_candidate, pin.version);
		assert.equal(when.accepted, false);
		assert.equal(when.live_integration, false);
		assert.deepEqual(when.consumer_pin, expected);
	}
	const proofRaw = given.db.sql
		.prepare(
			"SELECT bytes FROM canonical_records WHERE key LIKE 'job-evidence:%'",
		)
		.get();
	const proof = z
		.object({ byte_hash: z.string() })
		.parse(JSON.parse(z.object({ bytes: z.string() }).parse(proofRaw).bytes));
	const all = given.db.sql
		.prepare("SELECT bytes FROM canonical_records WHERE key LIKE 'evidence:%'")
		.all()
		.map((row) => JSON.parse(z.object({ bytes: z.string() }).parse(row).bytes));
	const evidence = all
		.map((value) =>
			z
				.object({
					record: z.object({ byte_hash: z.string() }),
					value: z.unknown(),
				})
				.parse(value),
		)
		.find((value) => value.record.byte_hash === proof.byte_hash);
	assert.ok(evidence);
	const body = z
		.object({ consumer_pin: z.unknown(), contract_candidate: z.string() })
		.parse(evidence.value);
	assert.deepEqual(body.consumer_pin, expected);
	assert.equal(body.contract_candidate, pin.version);
});
