import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import {
	exportRequest,
	batchRequest,
	statusRequest,
} from "../fixtures/canonical-production/requests.js";
import { createCandidateProductionOperations } from "../../src/api/candidate.js";
import {
	productionContentHash,
	productionReferences,
} from "@jevelopers/shared-contracts/production-operations";
import { contract } from "../../src/api/canonical-values.js";

test("preserves both histories and selects the last committed export when exports run concurrently", {
	timeout: 60000,
}, async () => {
	await using given = await fixtureHost();
	const { operations, context } = given.candidate;
	const artifact = await operations.composeArtifact(
		context,
		given.records.request,
	);
	assert.ok(artifact.ok);
	const base = exportRequest(given.records, artifact.value);
	const requests = [base, { ...base, idempotency_key: "concurrent-export-2" }];
	const when = await Promise.all(
		requests.map((request) =>
			operations.exportArtifactBundle(context, request),
		),
	);
	for (const result of when) assert.ok(result.ok, JSON.stringify(result));
	const bundles = when.flatMap((result) => (result.ok ? [result.value] : []));
	assert.equal(new Set(bundles.map((bundle) => bundle.bundle_ref.id)).size, 2);
	for (let i = 0; i < requests.length; i++) {
		const request = requests[i];
		assert.ok(request);
		assert.deepEqual(
			await operations.exportArtifactBundle(context, request),
			when[i],
		);
	}
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM canonical_exports").get()?.[
			"n"
		],
		2,
	);
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
		3,
	);
	const last = given.db.sql
		.prepare(
			"SELECT r.bytes FROM canonical_exports e JOIN canonical_records r ON r.key='export:'||e.operation ORDER BY e.sequence DESC LIMIT 1",
		)
		.get();
	assert.ok(typeof last?.["bytes"] === "string");
	const stored: unknown = JSON.parse(last["bytes"]);
	assert.ok(typeof stored === "object" && stored !== null && "value" in stored);
	assert.ok(
		typeof stored.value === "object" &&
			stored.value !== null &&
			"commitment" in stored.value,
	);
	const status = await operations.getArtifactManifestStatus(
		context,
		statusRequest(given.records.request, {
			kind: "artifact",
			artifact_ref: artifact.value,
		}),
	);
	assert.ok(status.ok);
	assert.deepEqual(status.value.bundle_ref, stored.value.commitment);
	const changed = await operations.exportArtifactBundle(
		context,
		contract("ExportBundleRequest", { ...base, formats: ["svg"] }),
	);
	assert.ok(!changed.ok);
	assert.equal(changed.error.code, "IDEMPOTENCY_CONFLICT");
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
		3,
	);
});

for (const change of ["row", "policy", "runtime pin"] as const)
	test(`rejects ${change} change under an existing batch key without new row attempts`, {
		timeout: 60000,
	}, async () => {
		await using given = await fixtureHost();
		const request = batchRequest(given.records);
		assert.ok(request.input.kind === "structured");
		const { operations, context } = given.candidate;
		const job = await operations.personalizeArtifactBatch(context, request);
		assert.ok(job.ok);
		const before = given.db.sql
			.prepare("SELECT id,outcome FROM attempts ORDER BY rowid")
			.all();
		let candidate = given.candidate;
		let changed = request;
		if (change === "row")
			changed = {
				...request,
				input: {
					...request.input,
					rows: request.input.rows.map((row, i) =>
						i === 0
							? {
									...row,
									fields: { ...row.fields, name: "Different attendee" },
								}
							: row,
					),
				},
			};
		else if (change === "policy")
			changed = { ...request, acceptance_policy: "allow_partial" };
		else {
			const draft = { ...given.records.runtimeRecord, revision: 2 };
			const record = { ...draft, content_hash: productionContentHash(draft) };
			const runtimeRef = {
				...given.records.composition.runtime_ref,
				revision: 2,
				content_hash: record.content_hash,
			};
			const compDraft = {
				...given.records.composition,
				revision: 2,
				runtime_ref: runtimeRef,
			};
			const composition = {
				...compDraft,
				content_hash: productionContentHash(compDraft),
			};
			changed = {
				...request,
				binding: {
					...request.binding,
					composition_ref: {
						...request.binding.composition_ref,
						revision: 2,
						content_hash: composition.content_hash,
					},
				},
			};
			given.records.records.set(record.id, record);
			given.records.records.set(composition.composition_id, composition);
			const host = given.host();
			const pins = { ...host.context.runtime, runtime_ref: runtimeRef };
			candidate = createCandidateProductionOperations({
				...host,
				context: { ...host.context, runtime: pins },
				external_references: [
					...host.external_references,
					...productionReferences(changed).map(([, ref]) => ref),
					runtimeRef,
				],
			});
		}
		const when = await candidate.operations.personalizeArtifactBatch(
			candidate.context,
			changed,
		);
		assert.ok(!when.ok, JSON.stringify(when));
		assert.equal(when.error.code, "IDEMPOTENCY_CONFLICT");
		assert.deepEqual(
			given.db.sql
				.prepare("SELECT id,outcome FROM attempts ORDER BY rowid")
				.all(),
			before,
		);
	});
