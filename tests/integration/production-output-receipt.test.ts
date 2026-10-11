import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFDict, PDFName, PDFArray } from "pdf-lib";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";
import { exportPrivateFiles } from "../../src/exporters/private-output.js";
import { assemblePrivateArchive } from "../../src/manifests/private-inventory.js";
import {
	defaultOutputPolicy,
	outputFile,
	OutputError,
} from "../../src/exporters/private-policy.js";
import { inspectOutputFiles } from "../../src/exporters/private-inspect.js";
import { fingerprint } from "../../src/composition/primitives.js";

test("rejects copied, fabricated or mutated render receipts at archive consumption", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact(),
		context = {
			artifact: f.artifact,
			constraints: f.constraints,
			ports: f.ports,
			now: 1000,
			policy: defaultOutputPolicy,
		},
		exported = await exportPrivateFiles(context),
		lineage = {
			batchDigest: null,
			rowDigest: null,
			ordinal: null,
			inputDigest: fingerprint(f.input),
			previewDigest: null,
			repairPolicyDigest: null,
		};
	await assert.rejects(
		assemblePrivateArchive({ ...exported }, context, lineage),
		(error) =>
			error instanceof OutputError && error.path === "export.issuedReceipt",
	);
	const png = exported.files.find((f) => f.name === "output.png");
	assert.ok(png);
	png.bytes[100] = (png.bytes[100] ?? 0) ^ 1;
	await assert.rejects(
		assemblePrivateArchive(exported, context, lineage),
		(error) =>
			error instanceof OutputError && error.path === "export.issuedReceipt",
	);
});
test("independently rejects removed fonts or color profiles from actual PDF bytes", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact(),
		exported = await exportPrivateFiles({
			artifact: f.artifact,
			constraints: f.constraints,
			ports: f.ports,
			now: 1000,
			policy: defaultOutputPolicy,
		}),
		file = exported.files.find((f) => f.name === "output.pdf");
	assert.ok(file);
	const doc = await PDFDocument.load(file.bytes),
		fonts = doc
			.getPage(0)
			.node.Resources()
			?.lookup(PDFName.of("Font"), PDFDict);
	assert.ok(fonts);
	const entry = fonts.entries()[0];
	assert.ok(entry);
	const font = doc.context.lookup(entry[1], PDFDict),
		descriptor = font
			.lookup(PDFName.of("DescendantFonts"), PDFArray)
			.lookup(0, PDFDict)
			.lookup(PDFName.of("FontDescriptor"), PDFDict);
	descriptor.delete(PDFName.of("FontFile2"));
	const badFont = await doc.save({ useObjectStreams: false }),
		verify = async (bytes: Uint8Array) =>
			inspectOutputFiles({
				files: exported.files.map((f) =>
					f.name === "output.pdf" ? outputFile(f.name, bytes) : f,
				),
				artifact: f.artifact,
				policy: defaultOutputPolicy,
				pixelDigest: exported.pixelDigest,
			});
	await assert.rejects(verify(badFont));
	const profileDoc = await PDFDocument.load(file.bytes);
	profileDoc
		.getPage(0)
		.node.Resources()
		?.lookup(PDFName.of("ColorSpace"), PDFDict)
		.delete(PDFName.of("DefaultRGB"));
	await assert.rejects(
		verify(await profileDoc.save({ useObjectStreams: false })),
	);
});
