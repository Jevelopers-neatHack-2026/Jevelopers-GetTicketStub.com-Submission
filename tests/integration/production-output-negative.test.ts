import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";
import { exportPrivateFiles } from "../../src/exporters/private-output.js";
import {
	defaultOutputPolicy,
	OutputError,
	outputFile,
} from "../../src/exporters/private-policy.js";
import { inspectOutputFiles } from "../../src/exporters/private-inspect.js";
import { digest, fingerprint } from "../../src/composition/primitives.js";
import { assemblePrivateArchive } from "../../src/manifests/private-inventory.js";
import { verifyPrivateArchive } from "../../src/manifests/private-verify.js";
import { composeArtifact } from "../../src/composition/private-model.js";
import {
	planRepair,
	resolveRepairPolicy,
	applyRepair,
} from "../../src/repair/private-repair.js";
const localContext = (f: Awaited<ReturnType<typeof fixtureArtifact>>) => ({
	artifact: f.artifact,
	constraints: f.constraints,
	ports: f.ports,
	now: 1000,
	policy: defaultOutputPolicy,
});
test("rejects real output text, dimension, font and file hash substitutions", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact(),
		e = await exportPrivateFiles(localContext(f));
	const verify = (files: typeof e.files) =>
		inspectOutputFiles({
			files,
			artifact: f.artifact,
			policy: e.policy,
			pixelDigest: e.pixelDigest,
		});
	await assert.rejects(
		verify(
			e.files.map((file) =>
				file.name === "output.svg"
					? outputFile(
							file.name,
							Buffer.from(f.artifact.svg.replace("Café", "Other")),
						)
					: file,
			),
		),
		OutputError,
	);
	const pdfFile = e.files.find((file) => file.name === "output.pdf");
	assert.ok(pdfFile);
	const pdf = await PDFDocument.load(pdfFile.bytes);
	pdf.getPage(0).setTrimBox(0, 0, 100, 100);
	const altered = await pdf.save({ useObjectStreams: false });
	await assert.rejects(
		verify(
			e.files.map((file) =>
				file.name === "output.pdf" ? outputFile(file.name, altered) : file,
			),
		),
	);
});
test("rejects added, missing, altered and wrong-lineage existing archive payloads", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact(),
		context = localContext(f),
		e = await exportPrivateFiles(context),
		lineage = {
			batchDigest: null,
			rowDigest: null,
			ordinal: null,
			inputDigest: fingerprint(f.input),
			previewDigest: null,
			repairPolicyDigest: null,
		};
	const a = await assemblePrivateArchive(e, context, lineage),
		trust = {
			manifestDigest: a.manifestDigest,
			archiveDigest: a.archiveDigest,
			lineageDigest: fingerprint(lineage),
		};
	await assert.rejects(
		verifyPrivateArchive({
			files: [...a.files, outputFile("extra.txt", Buffer.from("x"))],
			trust,
			context,
		}),
	);
	await assert.rejects(
		verifyPrivateArchive({
			files: a.files.filter((f) => f.name !== "output.png"),
			trust,
			context,
		}),
	);
	await assert.rejects(
		verifyPrivateArchive({
			files: a.files.map((f) =>
				f.name === "output.png"
					? outputFile(f.name, Buffer.from("tampered"))
					: f,
			),
			trust,
			context,
		}),
	);
	await assert.rejects(
		verifyPrivateArchive({
			files: a.files,
			trust: { ...trust, lineageDigest: digest("wrong") },
			context,
		}),
	);
});
test("blocks stale approval, revoked source, unknown specification and unsupported profile without publication", async () => {
	const f = await fixtureArtifact();
	await assert.rejects(exportPrivateFiles({ ...localContext(f), now: 2001 }));
	f.state.revoked = true;
	await assert.rejects(exportPrivateFiles(localContext(f)));
	f.state.revoked = false;
	await assert.rejects(
		exportPrivateFiles({ ...localContext(f), constraints: null }),
		OutputError,
	);
	await assert.rejects(
		exportPrivateFiles({
			...localContext(f),
			policy: { ...defaultOutputPolicy, dpi: 96 },
		}),
		OutputError,
	);
	const artifact = await composeArtifact(
		f.input,
		{ ...f.layout, profile: "cmyk" },
		f.fonts,
		f.ports,
		1000,
	);
	await assert.rejects(
		exportPrivateFiles({ ...localContext(f), artifact }),
		OutputError,
	);
});
test("blocks low source DPI, hidden required text and overflowing exact names via real preflight", async () => {
	const f = await fixtureArtifact();
	const hidden = await composeArtifact(
		{
			...f.input,
			nodes: f.artifact.model.input.nodes.map((n) =>
				n.id === "name" ? { ...n, visible: false } : n,
			),
		},
		f.layout,
		f.fonts,
		f.ports,
		1000,
	);
	await assert.rejects(
		exportPrivateFiles({ ...localContext(f), artifact: hidden }),
		OutputError,
	);
	const overflow = await fixtureArtifact("W".repeat(200));
	await assert.rejects(exportPrivateFiles(localContext(overflow)), OutputError);
	await assert.rejects(
		exportPrivateFiles({
			...localContext(f),
			constraints: { ...f.constraints, minDpi: 600 },
		}),
		OutputError,
	);
});
test("exports an allowed mechanical repair and escalates a material content change", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact(),
		policy = resolveRepairPolicy({
			revision: "synthetic-normalize-1",
			permissionRef: "synthetic-normalize-permission",
			permission: "mechanical",
			maxTotalAttempts: 1,
			fields: [
				{
					node: "logo",
					minSize: 2,
					maxSize: 7,
					step: 0.25,
					maxAttempts: 1,
					maxMoveMm: 0,
					fallbackOrder: [],
					allowNormalize: true,
				},
			],
		});
	const planned = planRepair(f.artifact, policy, {
		kind: "normalize",
		node: "logo",
	});
	assert.equal(planned.state, "PLANNED");
	if (planned.state !== "PLANNED") return;
	const repaired = await applyRepair(
		f.artifact,
		planned,
		policy,
		f.constraints,
		f.ports,
		1000,
	);
	assert.equal(repaired.state, "APPLIED_DRAFT");
	if (repaired.state !== "APPLIED_DRAFT") return;
	const exported = await exportPrivateFiles({
		...localContext(f),
		artifact: repaired.artifact,
	});
	assert.equal(exported.report.draftReady, true);
	assert.deepEqual(
		repaired.artifact.sourceArtworkHashes,
		f.artifact.sourceArtworkHashes,
	);
	const material = planRepair(f.artifact, policy, {
		kind: "material",
		node: "name",
	});
	assert.equal(material.state, "NEEDS_EXTERNAL_REVIEW");
});
