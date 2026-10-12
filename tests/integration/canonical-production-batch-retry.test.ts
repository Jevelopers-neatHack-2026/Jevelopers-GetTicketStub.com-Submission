import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
	createProductionError,
	verifyProductionBundleFiles,
} from "@jevelopers/shared-contracts/production-operations";
import type { ProductionError } from "@jevelopers/shared-contracts/production-operations";
import { createCandidateProductionOperations } from "../../src/api/candidate.js";
import { checked, contract } from "../../src/api/canonical-values.js";
import { DurableBatchEngine } from "../../src/jobs/durable-batch.js";
import { idSchema, scopeSchema } from "../../src/internal/durability.js";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import type { FixtureHost } from "../fixtures/canonical-production/host.js";
import { batchRequest } from "../fixtures/canonical-production/requests.js";

const retryableCodes = [
	"RETRYABLE_STORAGE_FAILURE",
	"RETRYABLE_RENDER_FAILURE",
	"APPROVAL_UNAVAILABLE",
] as const;
function singleRow(
	given: FixtureHost,
	policy: "atomic" | "allow_partial" = "atomic",
) {
	const request = batchRequest(given.records, policy);
	assert.ok(request.input.kind === "structured");
	return {
		...request,
		input: { ...request.input, rows: request.input.rows.slice(0, 1) },
	};
}
function row(given: FixtureHost) {
	const rows = given.db.sql.prepare("SELECT * FROM rows").all();
	assert.equal(rows.length, 1);
	const value = rows[0];
	assert.ok(value);
	return value;
}
function advance(given: FixtureHost, ms: number) {
	given.state.now = new Date(Date.parse(given.state.now) + ms).toISOString();
}
function failingCandidate(
	given: FixtureHost,
	failure: () => ProductionError["code"] | null,
) {
	const host = given.host();
	return createCandidateProductionOperations({
		...host,
		context: {
			...host.context,
			references: {
				async resolve(ref, scope) {
					if (
						given.db.sql
							.prepare("SELECT 1 FROM rows WHERE status='running'")
							.get()
					) {
						const code = failure();
						if (code)
							return {
								ok: false,
								error: checked(
									createProductionError(code, {
										scope: given.records.scope,
										correlation_id: given.records.request.correlation_id,
										operation: "personalizeArtifactBatch",
									}),
								),
							};
					}
					return host.context.references.resolve(ref, scope);
				},
			},
		},
	});
}
function submit(
	candidate: ReturnType<typeof createCandidateProductionOperations>,
	request: ReturnType<typeof singleRow>,
) {
	return candidate.operations.personalizeArtifactBatch(
		candidate.context,
		request,
	);
}
for (const code of retryableCodes)
	for (const policy of ["atomic", "allow_partial"] as const)
		test(`resumes ${policy} canonical ${code} after claim with a distinct attempt and one real row publication`, {
			timeout: 60000,
		}, async () => {
			await using given = await fixtureHost();
			const request = singleRow(given, policy);
			let injections = 0;
			const candidate = failingCandidate(given, () =>
				++injections === 1 ? code : null,
			);
			const first = await submit(candidate, request);
			assert.ok(first.ok, JSON.stringify(first));
			assert.equal(first.value.contract, "JobRef");
			const queued = row(given);
			assert.equal(queued["status"], "queued");
			assert.equal(queued["code"], "RENDER_RETRYABLE");
			assert.equal(queued["attempts"], 1);
			assert.equal(
				queued["due"],
				Date.parse(given.state.now) + given.db.limits.backoffMs,
			);
			assert.equal(
				given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.[
					"n"
				],
				0,
			);
			assert.deepEqual(
				given.db.sql
					.prepare("SELECT outcome FROM attempts")
					.all()
					.map((a) => a["outcome"]),
				["retryable"],
			);
			const restarted = given.restart();
			advance(given, given.db.limits.backoffMs - 1);
			assert.deepEqual(await submit(restarted, request), first);
			assert.deepEqual(row(given), queued);
			advance(given, 1);
			assert.deepEqual(await submit(restarted, request), first);
			const completed = row(given);
			assert.equal(completed["status"], "succeeded");
			assert.equal(completed["operation"], queued["operation"]);
			assert.equal(completed["row_key"], queued["row_key"]);
			assert.equal(completed["attempts"], 2);
			assert.notEqual(completed["attempt"], queued["attempt"]);
			assert.notEqual(completed["stage"], queued["stage"]);
			assert.deepEqual(
				given.db.sql
					.prepare("SELECT outcome FROM attempts ORDER BY rowid")
					.all()
					.map((a) => a["outcome"]),
				["retryable", "succeeded"],
			);
			assert.equal(
				given.db.sql
					.prepare("SELECT COUNT(*) AS n FROM publications WHERE operation=?")
					.get(completed["operation"] ?? null)?.["n"],
				1,
			);
			const record = z
				.object({ plan: z.object({ private_scope: scopeSchema }) })
				.parse(
					JSON.parse(
						z
							.object({ bytes: z.string() })
							.parse(
								given.db.sql
									.prepare("SELECT bytes FROM canonical_records WHERE key=?")
									.get(`job:${completed["job"]}`),
							).bytes,
					),
				);
			const engine = new DurableBatchEngine(given.db),
				scope = record.plan.private_scope;
			const files = engine.store.retrieve(
				scope,
				idSchema.parse(completed["publication"]),
			).files;
			const snapshot = files.find((f) => f.name === "canonical-row.json");
			assert.ok(snapshot);
			const saved = z
				.object({
					bundle_ref: z.unknown(),
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
			assert.equal(bundle.row_scope?.row_id, "row-001");
			assert.deepEqual(
				files
					.map((f) => f.name)
					.filter((name) => name.startsWith("output."))
					.sort(),
				["output.pdf", "output.png", "output.svg"],
			);
			const svg = files.find((f) => f.name === "output.svg");
			assert.ok(svg);
			assert.ok(Buffer.from(svg.bytes).toString().includes("Serial 000123"));
			assert.equal(
				engine.job(scope, idSchema.parse(completed["job"])).status,
				"succeeded",
			);
			assert.equal(
				engine.progress(scope, idSchema.parse(completed["job"]))
					.executionAttempts,
				2,
			);
			const observations = given.db.sql
				.prepare(
					"SELECT kind,code,attempt FROM observations WHERE operation=? ORDER BY sequence",
				)
				.all(completed["operation"] ?? null);
			assert.deepEqual(
				observations.map((o) => o["kind"]),
				[
					"execution_started",
					"retryable",
					"execution_started",
					"published",
					"succeeded",
				],
			);
			assert.equal(observations[1]?.["code"], "RENDER_RETRYABLE");
			assert.equal(observations[1]?.["attempt"], queued["attempt"]);
			assert.equal(observations[3]?.["attempt"], completed["attempt"]);
			assert.equal(observations[4]?.["attempt"], completed["attempt"]);
			const before = given.db.sql
				.prepare("SELECT COUNT(*) AS n FROM observations")
				.get();
			assert.deepEqual(await submit(given.restart(), request), first);
			assert.deepEqual(row(given), completed);
			assert.deepEqual(
				given.db.sql.prepare("SELECT COUNT(*) AS n FROM observations").get(),
				before,
			);
			assert.equal(given.state.supplierCalls + given.state.generationCalls, 0);
		});
for (const code of retryableCodes)
	test(`bounds repeated canonical ${code} at maxAttempts with exponential backoff`, async () => {
		await using given = await fixtureHost();
		const request = singleRow(given);
		let result: Awaited<ReturnType<typeof submit>> | undefined;
		for (let attempt = 1; attempt <= given.db.limits.maxAttempts; attempt++) {
			const candidate = failingCandidate(given, () => code);
			const when = await submit(candidate, request);
			assert.ok(when.ok, JSON.stringify(when));
			if (result) assert.deepEqual(when, result);
			result = when;
			const current = row(given);
			assert.equal(current["attempts"], attempt);
			assert.equal(
				current["status"],
				attempt === given.db.limits.maxAttempts ? "failed" : "queued",
			);
			assert.equal(current["code"], "RENDER_RETRYABLE");
			const backoff = given.db.limits.backoffMs * 2 ** (attempt - 1);
			assert.equal(current["due"], Date.parse(given.state.now) + backoff);
			given.restart();
			advance(given, backoff);
		}
		const before = row(given);
		assert.deepEqual(await submit(given.restart(), request), result);
		assert.deepEqual(row(given), before);
		assert.deepEqual(
			given.db.sql
				.prepare("SELECT outcome FROM attempts ORDER BY rowid")
				.all()
				.map((a) => a["outcome"]),
			["retryable", "retryable", "failed"],
		);
		assert.equal(
			given.db.sql.prepare("SELECT status FROM jobs").get()?.["status"],
			"failed",
		);
		assert.equal(
			given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.[
				"n"
			],
			0,
		);
	});
for (const code of [
	"APPROVAL_INVALID",
	"APPROVAL_REVOKED",
	"INTEGRITY_FAILURE",
	"HASH_MISMATCH",
	"INVALID_INPUT",
] as const)
	test(`keeps canonical ${code} terminal after claim and healthy restart`, async () => {
		await using given = await fixtureHost();
		const request = singleRow(given);
		const candidate = failingCandidate(given, () => code);
		const when = await submit(candidate, request);
		assert.ok(when.ok, JSON.stringify(when));
		const failed = row(given);
		assert.equal(failed["status"], "failed");
		assert.equal(failed["code"], "RENDER_PERMANENT");
		assert.equal(failed["attempts"], 1);
		advance(given, given.db.limits.backoffMs);
		assert.deepEqual(await submit(given.restart(), request), when);
		assert.deepEqual(row(given), failed);
		assert.equal(
			given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.[
				"n"
			],
			0,
		);
	});
for (const failure of [
	"private token=synthetic-secret",
	{
		code: "RETRYABLE_STORAGE_FAILURE",
		retryable: true,
		message: "private token=synthetic-secret",
	},
])
	test(`contains unknown ${typeof failure} rejection without retrying or exposing raw data`, async () => {
		await using given = await fixtureHost();
		const candidate = failingCandidate(given, () => {
			throw failure;
		});
		const when = await submit(candidate, singleRow(given));
		assert.ok(when.ok, JSON.stringify(when));
		assert.equal(row(given)["status"], "failed");
		assert.equal(row(given)["code"], "RENDER_PERMANENT");
		const evidence = given.db.sql
			.prepare(
				"SELECT bytes FROM canonical_records UNION ALL SELECT code FROM observations",
			)
			.all();
		assert.ok(!JSON.stringify({ when, evidence }).includes("synthetic-secret"));
		assert.equal(
			given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.[
				"n"
			],
			0,
		);
	});
test("cancellation during canonical retryable resolution fences the claimed row without requeueing", async () => {
	await using given = await fixtureHost();
	const candidate = failingCandidate(given, () => {
		given.controller.abort();
		return "RETRYABLE_STORAGE_FAILURE";
	});
	const request = singleRow(given);
	const when = await submit(candidate, request);
	assert.ok(when.ok, JSON.stringify(when));
	const cancelled = row(given);
	assert.equal(cancelled["status"], "cancelled");
	assert.equal(cancelled["attempts"], 1);
	assert.equal(
		given.db.sql.prepare("SELECT outcome FROM attempts").get()?.["outcome"],
		"cancelled",
	);
	advance(given, given.db.limits.backoffMs);
	assert.deepEqual(await submit(given.restart(), request), when);
	assert.deepEqual(row(given), cancelled);
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		0,
	);
});
