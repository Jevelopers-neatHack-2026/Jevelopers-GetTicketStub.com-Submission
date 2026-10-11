import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";
import { exportPrivateFiles } from "../../src/exporters/private-output.js";
import {
	defaultOutputPolicy,
	outputFile,
} from "../../src/exporters/private-policy.js";
import { digest, fingerprint } from "../../src/composition/primitives.js";
import { assemblePrivateArchive } from "../../src/manifests/private-inventory.js";
import { retrievePrivateArchive } from "../../src/manifests/private-verify.js";
import { batchFixture } from "../fixtures/production-output/fixture.js";

let root: string,
	keep = false;
before(async () => {
	const requested = process.env["PP_OUTPUT_EVIDENCE_DIR"];
	keep = requested !== undefined;
	root = requested ?? (await mkdtemp(join(tmpdir(), "pp-output-flow-")));
	await mkdir(root, { recursive: true });
});
after(async () => {
	if (!keep) await rm(root, { recursive: true, force: true });
});
const localContext = (f: Awaited<ReturnType<typeof fixtureArtifact>>) => ({
	artifact: f.artifact,
	constraints: f.constraints,
	ports: f.ports,
	now: 1000,
	policy: defaultOutputPolicy,
});
test("renders actual enabled files and verifies a durable archive read-only with exact detached hashes", {
	timeout: 30000,
}, async () => {
	using f = await batchFixture();
	const context = localContext(f),
		exported = await exportPrivateFiles(context);
	const lineage = {
		batchDigest: null,
		rowDigest: digest("synthetic-row"),
		ordinal: 0,
		inputDigest: fingerprint(f.input),
		previewDigest: null,
		repairPolicyDigest: null,
	};
	const archive = await assemblePrivateArchive(exported, context, lineage),
		trust = {
			manifestDigest: archive.manifestDigest,
			archiveDigest: archive.archiveDigest,
			lineageDigest: fingerprint(lineage),
		};
	const operation = f.engine.store.bind(
		f.context.input.scope,
		"private-output",
		"archive",
		Buffer.from(archive.manifestDigest),
		digestToStorage(archive.manifestDigest),
	);
	const stage = f.engine.store.stage(f.context.input.scope, operation.id);
	for (const file of archive.files)
		f.engine.store.write(f.context.input.scope, stage, file);
	const publication = f.engine.store.publish(
		f.context.input.scope,
		stage,
		archive.files,
	);
	const before = f.db.sql
		.prepare("SELECT COUNT(*) AS count FROM observations")
		.get();
	const request = {
		store: f.engine.store,
		scope: f.context.input.scope,
		publication: publication.id,
		trust,
		context,
	};
	const first = await retrievePrivateArchive(request),
		second = await retrievePrivateArchive(request);
	assert.deepEqual(first, second);
	assert.deepEqual(
		f.db.sql.prepare("SELECT COUNT(*) AS count FROM observations").get(),
		before,
	);
	assert.equal(first.handoffEligible, false);
	assert.equal(first.readiness, "external-blocked");
	const png = exported.files.find((f) => f.name === "output.png");
	assert.ok(png);
	assert.equal(PNG.sync.read(Buffer.from(png.bytes)).width, 1200);
	assert.equal(exported.report.draftReady, true);
	assert.equal(exported.networkRequests, 0);
	assert.equal(f.state.generationCalls, 0);
	assert.ok(f.artifact.svg.includes(Buffer.from(f.art).toString("base64")));
	assert.equal(archive.inventory.source.includes("Zoë"), false);
	assert.equal(archive.inventory.source.includes("Alice"), false);
	await Promise.all(
		archive.files.map((file) => writeFile(join(root, file.name), file.bytes)),
	);
	await writeFile(
		join(root, "corpus-index.json"),
		JSON.stringify(
			{
				mode: "synthetic-private-local",
				handoffEligible: false,
				executionNonce: process.env["PP_DURABILITY_EXECUTION_NONCE"] ?? null,
				artifacts: archive.files.map((f) => ({
					name: f.name,
					digest: f.digest,
					length: f.length,
				})),
				manifestDigest: archive.manifestDigest,
				archiveDigest: archive.archiveDigest,
				sourceDigest: archive.inventory.sourceDigest,
				reportDigest: exported.report.reportHash,
				descriptors: exported.descriptors,
				environment: exported.environment,
				browser: exported.browser,
				realModules: [
					"composition",
					"assets",
					"preflight",
					"offline-browser",
					"sqlite-storage",
					"zip-parser",
				],
				simulatedPorts: ["permission", "composition-approval", "specification"],
				externalPins: {
					canonical: null,
					fulfillment: null,
					app: null,
					finance: null,
				},
			},
			null,
			2,
		),
	);
	f.state.revoked = true;
	await assert.rejects(retrievePrivateArchive(request));
	f.state.revoked = false;
	f.engine.store.deny(f.context.input.scope, operation.id);
	await assert.rejects(retrievePrivateArchive(request));
});
function digestToStorage(value: string) {
	return outputFile("request", Buffer.from(value)).digest;
}
