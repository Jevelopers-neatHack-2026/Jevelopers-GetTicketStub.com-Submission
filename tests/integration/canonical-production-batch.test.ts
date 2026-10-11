import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import {
	batchRequest,
	statusRequest,
} from "../fixtures/canonical-production/requests.js";
import { DurableBatchEngine } from "../../src/jobs/durable-batch.js";
import { scopeSchema, idSchema } from "../../src/internal/durability.js";
import { contract, checked } from "../../src/api/canonical-values.js";
import {
	verifyProductionBundleFiles,
	checkRowResult,
	validateProductionResult,
} from "@jevelopers/shared-contracts/production-operations";
import type { FixtureHost } from "../fixtures/canonical-production/host.js";
import type { JobRef } from "@jevelopers/shared-contracts";

function localJob(f: FixtureHost, ref: JobRef) {
	const raw = f.db.sql
		.prepare("SELECT bytes FROM canonical_records WHERE key=?")
		.get(`job:${ref.job_ref.id}`);
	const record = z
		.object({ plan: z.object({ private_scope: scopeSchema }) })
		.parse(JSON.parse(z.object({ bytes: z.string() }).parse(raw).bytes));
	return {
		engine: new DurableBatchEngine(f.db),
		scope: record.plan.private_scope,
		id: idSchema.parse(ref.job_ref.id),
	};
}
test("renders multiple exact canonical rows through real durable jobs and reuses them after restart", {
	timeout: 60000,
}, async () => {
	await using given = await fixtureHost();
	const request = batchRequest(given.records);
	const result = await given.candidate.operations.personalizeArtifactBatch(
		given.candidate.context,
		request,
	);
	assert.ok(result.ok, JSON.stringify(result));
	assert.ok(result.value.contract === "JobRef");
	assert.ok(
		validateProductionResult(
			"personalizeArtifactBatch",
			result,
			given.records.scope,
		).ok,
	);
	const local = localJob(given, result.value);
	assert.equal(local.engine.job(local.scope, local.id).status, "succeeded");
	assert.equal(
		local.engine.progress(local.scope, local.id).executionAttempts,
		2,
	);
	for (const row of local.engine.results(local.scope, local.id)) {
		assert.ok(row.publication);
		const files = local.engine.store.retrieve(
			local.scope,
			row.publication,
		).files;
		const snapshot = files.find((f) => f.name === "canonical-row.json");
		assert.ok(snapshot);
		const saved = z
			.object({
				bundle_ref: z.unknown(),
				artifact_ref: z.unknown(),
				row: z.object({
					row_id: z.string(),
					ordinal: z.number(),
					input_hash: z.string(),
				}),
				canonical_publication: z.literal("blocked"),
			})
			.parse(JSON.parse(Buffer.from(snapshot.bytes).toString()));
		const bundle = contract("ProductionBundleRef", saved.bundle_ref);
		const verified = checked(
			verifyProductionBundleFiles(
				files
					.filter((f) => f.name !== "canonical-row.json")
					.map((f) => ({ filename: f.name, bytes: f.bytes })),
				{ scope: given.records.scope, trusted_commitment: bundle },
			),
		);
		assert.equal(verified.integrity, "passed");
		assert.equal(verified.eligibility, "blocked");
		assert.equal(bundle.row_scope?.row_id, saved.row.row_id);
		assert.equal(bundle.row_scope?.ordinal, row.ordinal);
		assert.equal(bundle.row_scope?.input_hash, saved.row.input_hash);
		const svg = files.find((f) => f.name === "output.svg");
		assert.ok(svg);
		assert.ok(
			Buffer.from(svg.bytes)
				.toString()
				.includes(row.ordinal === 0 ? "Serial 000123" : "Serial 000024"),
		);
		assert.ok(
			Buffer.from(svg.bytes)
				.toString()
				.includes(row.ordinal === 0 ? "Zoë O’Connor" : "Café Áda"),
		);
		assert.ok(request.input.kind === "structured");
		const blockedRow = contract("RowResult", {
			contract: "RowResult",
			schema_version: "1.0.0",
			policy_version: "1.0.0",
			...given.records.scope,
			job: result.value,
			row_id: saved.row.row_id,
			ordinal: saved.row.ordinal,
			input_hash: saved.row.input_hash,
			status: "succeeded",
			skip_reason: null,
			artifact_ref: saved.artifact_ref,
			bundle_ref: bundle,
			errors: [],
			source_position: null,
			eligibility: bundle.eligibility,
		});
		const projection = checkRowResult(blockedRow, {
			scope: given.records.scope,
			job: result.value,
			original_rows: request.input.rows,
		});
		assert.ok(!projection.ok);
		assert.equal(projection.errors[0]?.code, "INVALID_PUBLICATION");
	}
	const before = given.db.sql
		.prepare("SELECT COUNT(*) AS n FROM observations")
		.get();
	const restarted = given.restart();
	const replay = await restarted.operations.personalizeArtifactBatch(
		restarted.context,
		request,
	);
	assert.deepEqual(replay, result);
	assert.deepEqual(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM observations").get(),
		before,
	);
	const status = await restarted.operations.getArtifactManifestStatus(
		restarted.context,
		statusRequest(given.records.request, {
			kind: "job",
			job_ref: result.value,
		}),
	);
	assert.ok(status.ok, JSON.stringify(status));
	assert.equal(status.value.status, "completed");
	assert.equal(status.value.batch, null);
	assert.equal(status.value.eligibility.handoff_eligible, false);
	assert.deepEqual(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM observations").get(),
		before,
	);
});
for (const policy of ["atomic", "allow_partial"] as const)
	test(`preserves real ${policy} publication behavior when one row fails private layout`, {
		timeout: 60000,
	}, async () => {
		await using given = await fixtureHost();
		const original = batchRequest(given.records, policy);
		assert.ok(original.input.kind === "structured");
		const request = {
			...original,
			input: {
				...original.input,
				rows: original.input.rows.map((row, index) =>
					index === 1
						? { ...row, fields: { ...row.fields, name: "Invalid\u0000name" } }
						: row,
				),
			},
		};
		const when = await given.candidate.operations.personalizeArtifactBatch(
			given.candidate.context,
			request,
		);
		assert.ok(when.ok, JSON.stringify(when));
		assert.ok(when.value.contract === "JobRef");
		const local = localJob(given, when.value);
		assert.equal(
			local.engine.job(local.scope, local.id).status,
			policy === "atomic" ? "failed" : "partially_succeeded",
		);
		const progress = local.engine.progress(local.scope, local.id);
		assert.equal(progress.succeeded, 1);
		assert.equal(progress.failed, 1);
		assert.equal(
			local.engine
				.results(local.scope, local.id)
				.filter((row) => row.status === "succeeded").length,
			policy === "atomic" ? 0 : 1,
		);
	});
test("cancels a durable canonical batch before any execution when the host aborts", async () => {
	await using given = await fixtureHost();
	given.controller.abort();
	const when = await given.candidate.operations.personalizeArtifactBatch(
		given.candidate.context,
		batchRequest(given.records),
	);
	assert.ok(when.ok, JSON.stringify(when));
	assert.ok(when.value.contract === "JobRef");
	const local = localJob(given, when.value);
	assert.equal(local.engine.job(local.scope, local.id).status, "cancelled");
	assert.equal(
		local.engine.progress(local.scope, local.id).executionAttempts,
		0,
	);
});
