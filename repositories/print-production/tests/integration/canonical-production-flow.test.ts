import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { LocalArtifactStore } from "../../src/storage/local-store.js";
import { idSchema } from "../../src/internal/durability.js";
import {
	verifyProductionBundleFiles,
	validateProductionResult,
} from "@jevelopers/shared-contracts/production-operations";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import {
	exportRequest,
	inspectRequest,
	statusRequest,
	compareRequest,
} from "../fixtures/canonical-production/requests.js";
import { checked, contract } from "../../src/api/canonical-values.js";
import { z } from "zod";

test("composes a real ticket, exports canonical bytes, inspects and rereads after durable restart", {
	timeout: 60000,
}, async () => {
	await using given = await fixtureHost();
	const { operations, context } = given.candidate;
	const composed = await operations.composeArtifact(
		context,
		given.records.request,
	);
	assert.ok(composed.ok, JSON.stringify(composed));
	assert.ok(
		validateProductionResult("composeArtifact", composed, context.scope).ok,
	);
	const exported = await operations.exportArtifactBundle(
		context,
		exportRequest(given.records, composed.value),
	);
	assert.ok(exported.ok, JSON.stringify(exported));
	const store = new LocalArtifactStore(given.db);
	const row = given.db.sql
		.prepare("SELECT bytes FROM canonical_records WHERE key=?")
		.get(`bundle:${composed.value.artifact_ref.id}`);
	const bound = z
		.object({ publication: z.string() })
		.parse(JSON.parse(z.object({ bytes: z.string() }).parse(row).bytes));
	const actual = store.retrieve(
		given.host().private_scope,
		idSchema.parse(bound.publication),
	).files;
	const verified = checked(
		verifyProductionBundleFiles(
			actual.map((f) => ({ filename: f.name, bytes: f.bytes })),
			{ scope: context.scope, trusted_commitment: exported.value },
		),
	);
	assert.equal(verified.integrity, "passed");
	assert.equal(verified.eligibility, "blocked");
	assert.equal(exported.value.eligibility.handoff_eligible, false);
	assert.equal(verified.bundle.schema_version, "2.0.0");
	const png = actual.find((f) => f.name === "output.png"),
		svg = actual.find((f) => f.name === "output.svg");
	assert.ok(png && svg);
	assert.equal(PNG.sync.read(Buffer.from(png.bytes)).width, 1200);
	assert.ok(
		Buffer.from(svg.bytes).toString().includes("Seat 0007 • Serial 000123"),
	);
	assert.ok(Buffer.from(svg.bytes).toString().includes("Zoë O’Connor"));
	const inspected = await operations.inspectArtifact(
		context,
		inspectRequest(given.records, composed.value),
	);
	assert.ok(inspected.ok, JSON.stringify(inspected));
	assert.equal(inspected.value.body.status, "passed");
	assert.equal(inspected.value.body.checked_files.length, 3);
	assert.ok(
		inspected.value.body.checked_files.every(
			(file) =>
				file.checks.length === 5 &&
				file.checks.every((check) => check.state === "passed"),
		),
	);
	assert.ok(
		validateProductionResult("inspectArtifact", inspected, context.scope).ok,
	);
	const before = given.db.sql
		.prepare("SELECT COUNT(*) AS n FROM observations")
		.get();
	const restarted = given.restart();
	const status = await restarted.operations.getArtifactManifestStatus(
		restarted.context,
		statusRequest(given.records.request, {
			kind: "artifact",
			artifact_ref: composed.value,
		}),
	);
	assert.ok(status.ok, JSON.stringify(status));
	assert.equal(status.value.integrity, "passed");
	assert.deepEqual(status.value.bundle_ref, exported.value);
	assert.deepEqual(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM observations").get(),
		before,
	);
	const replay = await restarted.operations.composeArtifact(
		restarted.context,
		given.records.request,
	);
	assert.deepEqual(replay, composed);
	assert.deepEqual(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM observations").get(),
		before,
	);
	const replayExport = await restarted.operations.exportArtifactBundle(
		restarted.context,
		exportRequest(given.records, composed.value),
	);
	assert.deepEqual(replayExport, exported);
	assert.deepEqual(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM observations").get(),
		before,
	);
	assert.equal(given.state.supplierCalls + given.state.generationCalls, 0);
	const evidenceDir = process.env["PP_CANONICAL_EVIDENCE_DIR"];
	if (evidenceDir) {
		await mkdir(evidenceDir, { recursive: true });
		for (const file of actual)
			await writeFile(join(evidenceDir, file.name), file.bytes);
		await writeFile(
			join(evidenceDir, "trusted-commitment.json"),
			JSON.stringify(exported.value, null, 2),
		);
	}
	given.state.revoked = true;
	const revoked = await restarted.operations.getArtifactManifestStatus(
		restarted.context,
		statusRequest(given.records.request, {
			kind: "artifact",
			artifact_ref: composed.value,
		}),
	);
	assert.ok(!revoked.ok);
	assert.equal(revoked.error.code, "APPROVAL_REVOKED");
});

test("compares real mapped template constraints against the synthetic canonical specification", async () => {
	await using given = await fixtureHost();
	const when = await given.candidate.operations.compareTemplateCompatibility(
		given.candidate.context,
		compareRequest(given.records),
	);
	assert.ok(when.ok, JSON.stringify(when));
	assert.equal(when.value.state, "supported");
	assert.equal(when.value.reapproval, false);
	assert.deepEqual(when.value.changed_constraints, []);
	assert.ok(
		validateProductionResult(
			"compareTemplateCompatibility",
			when,
			given.records.scope,
		).ok,
	);
});

test("rejects changed composition idempotency after real durable publication", async () => {
	await using given = await fixtureHost();
	const first = await given.candidate.operations.composeArtifact(
		given.candidate.context,
		given.records.request,
	);
	assert.ok(first.ok);
	const changed = contract("ComposeArtifactRequest", {
		...given.records.request,
		binding: {
			...given.records.request.binding,
			values: {
				...given.records.request.binding.values,
				name: { kind: "display", value: "Different" },
			},
		},
	});
	const when = await given.candidate.operations.composeArtifact(
		given.candidate.context,
		changed,
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "HASH_MISMATCH");
});
