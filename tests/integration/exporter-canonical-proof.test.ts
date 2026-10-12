import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
	parseProductionCanonicalBytes,
	productionArchiveLimits,
	verifyProductionBundleFiles,
} from "@jevelopers/shared-contracts/production-operations";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import {
	exportRequest,
	inspectRequest,
} from "../fixtures/canonical-production/requests.js";
import { LocalArtifactStore } from "../../src/storage/local-store.js";
import { contract } from "../../src/api/canonical-values.js";
import { idSchema, hash } from "../../src/internal/durability.js";
import { packZip, inspectZip } from "../../src/exporters/private-zip.js";

test("retains real supplied canonical manifest, read-path byte bounds, ZIP reproducibility and blocked eligibility", {
	timeout: 30000,
}, async () => {
	// Given the real candidate with injected local authority. When exporting and reading its publication.
	await using given = await fixtureHost();
	const requested = process.env["PP_OUTPUT_EVIDENCE_DIR"];
	const directory =
		requested ?? (await mkdtemp(join(tmpdir(), "pp-exporter-proof-")));
	try {
		const composed = await given.candidate.operations.composeArtifact(
			given.candidate.context,
			given.records.request,
		);
		assert.ok(composed.ok);
		const exported = await given.candidate.operations.exportArtifactBundle(
			given.candidate.context,
			exportRequest(given.records, composed.value),
		);
		assert.ok(exported.ok);
		const raw = given.db.sql
			.prepare("SELECT bytes FROM canonical_records WHERE key=?")
			.get(`bundle:${composed.value.artifact_ref.id}`);
		const published = z
			.object({ publication: z.string() })
			.parse(JSON.parse(z.object({ bytes: z.string() }).parse(raw).bytes));
		const files = new LocalArtifactStore(given.db).retrieve(
			given.host().private_scope,
			idSchema.parse(published.publication),
		).files;
		// Then genuine SQLite views have intrinsic metadata and their actual hashes match the publication.
		for (const file of files) {
			for (const field of ["byteLength", "byteOffset", "buffer", "length"])
				assert.equal(Object.hasOwn(file.bytes, field), false);
			assert.equal(file.bytes.byteLength, file.length);
			assert.equal(hash(file.bytes), file.digest);
		}
		const manifest = files.find((f) => f.name === "manifest.json");
		const archive = files.find((f) => f.name === "archive.zip");
		assert.ok(manifest && archive);
		assert.ok(manifest.length > 1);
		assert.equal(
			parseProductionCanonicalBytes(
				"ProductionBundle",
				"2.0.0",
				manifest.bytes,
				1,
			).ok,
			false,
		);
		const parsed = parseProductionCanonicalBytes(
			"ProductionBundle",
			"2.0.0",
			manifest.bytes,
			productionArchiveLimits.manifest_bytes,
		);
		assert.ok(parsed.ok);
		const payloads = files.filter(
			(f) =>
				!["manifest.json", "archive.zip", "detached.json"].includes(f.name),
		);
		const repacked = packZip(payloads, manifest);
		assert.deepEqual(repacked.bytes, Uint8Array.from(archive.bytes));
		assert.deepEqual(
			packZip([...payloads].reverse(), manifest).bytes,
			repacked.bytes,
		);
		const zipEntries = await inspectZip(archive.bytes, [...payloads, manifest]);
		assert.deepEqual(
			zipEntries.map((f) => f.name),
			[...payloads, manifest].map((f) => f.name).sort(),
		);
		const zippedManifest = zipEntries.find((f) => f.name === "manifest.json");
		assert.ok(zippedManifest);
		assert.deepEqual(zippedManifest.bytes, Uint8Array.from(manifest.bytes));
		const verified = verifyProductionBundleFiles(
			files.map((f) => ({ filename: f.name, bytes: f.bytes })),
			{ scope: given.records.scope, trusted_commitment: exported.value },
		);
		assert.ok(verified.ok);
		assert.equal(verified.value.integrity, "passed");
		assert.equal(verified.value.eligibility, "blocked");
		const inspection = await given.candidate.operations.inspectArtifact(
			given.candidate.context,
			inspectRequest(given.records, composed.value),
		);
		assert.ok(inspection.ok);
		assert.equal(inspection.value.body.status, "passed");
		const restarted = given.restart();
		const reread = await restarted.operations.exportArtifactBundle(
			restarted.context,
			exportRequest(given.records, composed.value),
		);
		assert.ok(reread.ok, JSON.stringify(reread));
		assert.deepEqual(reread.value, exported.value);
		await mkdir(join(directory, "bundle"), { recursive: true });
		for (const file of files) {
			await writeFile(join(directory, "bundle", file.name), file.bytes);
			assert.equal(
				hash(await readFile(join(directory, "bundle", file.name))),
				file.digest,
			);
		}
		await writeFile(
			join(directory, "canonical-exporter-proof.json"),
			JSON.stringify(
				{
					executionNonce: process.env["PP_DURABILITY_EXECUTION_NONCE"] ?? null,
					mode: "synthetic-canonical-local-byte-proof",
					accepted: false,
					live_integration: false,
					integrity: verified.value.integrity,
					eligibility: verified.value.eligibility,
					byteRoute: "fresh-output-buffers-and-sqlite-reads",
					commitment: contract("ProductionBundleRef", exported.value),
					artifacts: files.map(({ name, digest, length }) => ({
						name,
						digest,
						length,
					})),
					zipDigest: hash(repacked.bytes),
					suppliedManifestDigest: manifest.digest,
					zipEntryOrder: zipEntries.map((f) => f.name),
					preflight: inspection.value,
					repeatedPublication: "identical-after-restart",
					zipReproducibility: "byte-identical-repack-of-same-supplied-manifest",
					canonicalManifestRebuildEquality: "not-claimed-random-identifiers",
					legacyMetadata:
						"SC-PFB-PARENT-LEGACY009 remains unresolved for arbitrary SDK input",
				},
				null,
				2,
			),
		);
	} finally {
		if (!requested) await rm(directory, { recursive: true, force: true });
	}
});
