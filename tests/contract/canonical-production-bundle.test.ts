import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import type {
	ArtifactFile,
	ProductionBundleRef,
} from "@jevelopers/shared-contracts";
import {
	verifyProductionBundleFiles,
	verifyProductionZip,
} from "@jevelopers/shared-contracts/production-operations";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import type { FixtureHost } from "../fixtures/canonical-production/host.js";
import { exportRequest } from "../fixtures/canonical-production/requests.js";
import { LocalArtifactStore } from "../../src/storage/local-store.js";
import type { StoredFile } from "../../src/storage/local-store.js";
import { idSchema } from "../../src/internal/durability.js";
import { packZip } from "../../src/exporters/private-zip.js";
import { outputFile } from "../../src/exporters/private-policy.js";
import {
	canonicalFile,
	payloadBudget,
} from "../../src/manifests/canonical-files.js";
import { CandidateFailure } from "../../src/api/canonical-values.js";

let given: FixtureHost,
	commitment: ProductionBundleRef,
	files: readonly StoredFile[],
	manifest: StoredFile;
before(async () => {
	given = await fixtureHost();
	const composed = await given.candidate.operations.composeArtifact(
		given.candidate.context,
		given.records.request,
	);
	assert.ok(composed.ok, JSON.stringify(composed));
	const exported = await given.candidate.operations.exportArtifactBundle(
		given.candidate.context,
		exportRequest(given.records, composed.value),
	);
	assert.ok(exported.ok, JSON.stringify(exported));
	commitment = exported.value;
	const raw = given.db.sql
		.prepare("SELECT bytes FROM canonical_records WHERE key=?")
		.get(`bundle:${composed.value.artifact_ref.id}`);
	const published = z
		.object({ publication: z.string() })
		.parse(JSON.parse(z.object({ bytes: z.string() }).parse(raw).bytes));
	files = new LocalArtifactStore(given.db).retrieve(
		given.host().private_scope,
		idSchema.parse(published.publication),
	).files;
	const item = files.find((f) => f.name === "manifest.json");
	assert.ok(item);
	manifest = item;
});
after(async () => {
	await given?.[Symbol.asyncDispose]();
});
function verify(
	input: readonly { readonly filename: string; readonly bytes: Uint8Array }[],
	trust = commitment,
) {
	return verifyProductionBundleFiles(input, {
		scope: given.records.scope,
		trusted_commitment: trust,
	});
}

test("verifies the exact real canonical all-file bundle while keeping supplier eligibility blocked", () => {
	const when = verify(files.map((f) => ({ filename: f.name, bytes: f.bytes })));
	assert.ok(when.ok);
	assert.equal(when.value.integrity, "passed");
	assert.equal(when.value.eligibility, "blocked");
	assert.equal(commitment.file_set.length, files.length);
	assert.ok(
		commitment.file_set.every((f) =>
			files.some(
				(actual) =>
					actual.name === f.filename &&
					`sha256:${actual.digest}` === f.byte_hash,
			),
		),
	);
});
for (const corruption of ["missing", "extra", "tampered", "duplicate"] as const)
	test(`rejects ${corruption} shipped payload bytes`, () => {
		const observed = files.map((f) => ({
			filename: f.name,
			bytes: Uint8Array.from(f.bytes),
		}));
		const first = observed[0];
		assert.ok(first);
		const input =
			corruption === "missing"
				? observed.slice(1)
				: corruption === "extra"
					? [...observed, { filename: "extra.json", bytes: Buffer.from("{}") }]
					: corruption === "duplicate"
						? [first, ...observed.slice(0, -1)]
						: observed.map((f, index) =>
								index === 0
									? {
											...f,
											bytes: Buffer.concat([f.bytes, Buffer.from("tampered")]),
										}
									: f,
							);
		const when = verify(input);
		assert.ok(!when.ok);
	});
test("rejects a trusted row scope that is not bound by the real manifest", () => {
	const when = verify(
		files.map((f) => ({ filename: f.name, bytes: f.bytes })),
		{
			...commitment,
			row_scope: {
				job_ref: {
					contract: "JobRef",
					schema_version: "1.0.0",
					policy_version: "1.0.0",
					job_ref: {
						contract: "JobStatus",
						schema_version: "1.0.0",
						id: "123e4567-e89b-42d3-a456-000000000998",
						revision: 1,
						content_hash: commitment.bundle_ref.content_hash,
					},
					batch_input_hash: commitment.bundle_ref.content_hash,
				},
				row_id: "wrong-row",
				ordinal: 0,
				input_hash: commitment.bundle_ref.content_hash,
			},
		},
	);
	assert.ok(!when.ok);
});
for (const corruption of ["missing", "extra", "tampered"] as const)
	test(`rejects ${corruption} actual ZIP entries independently of outer file verification`, () => {
		const payloads = files.filter(
			(f) =>
				!["manifest.json", "archive.zip", "detached.json"].includes(f.name),
		);
		const changed =
			corruption === "missing"
				? payloads.slice(1)
				: corruption === "extra"
					? [...payloads, { ...manifest, name: "extra.json" }]
					: payloads.map((file, index) =>
							index === 0
								? outputFile(file.name, Uint8Array.from(file.bytes).reverse())
								: file,
						);
		const zip = packZip(changed, manifest);
		const expected: readonly ArtifactFile[] = commitment.file_set.filter(
			(f) => !["archive", "detached"].includes(f.role),
		);
		const when = verifyProductionZip(zip.bytes, expected);
		assert.ok(!when.ok);
	});
test("enforces entry bounds before accepting an oversized descriptor", () => {
	assert.throws(
		() => canonicalFile({ ...manifest, length: 8388609 }, "lineage"),
		CandidateFailure,
	);
});
test("preserves lower private file-count bounds before ZIP allocation", () => {
	assert.throws(
		() =>
			payloadBudget(
				Array.from({ length: 62 }, () => manifest),
				given.db.limits,
			),
		CandidateFailure,
	);
});
