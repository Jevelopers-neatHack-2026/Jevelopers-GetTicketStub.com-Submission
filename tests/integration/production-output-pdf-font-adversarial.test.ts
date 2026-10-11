import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRawStream } from "pdf-lib";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";
import { exportPrivateFiles } from "../../src/exporters/private-output.js";
import { inspectPdf } from "../../src/exporters/private-pdf.js";
import { boundedPdfStream } from "../../src/exporters/private-pdf-streams.js";
import { defaultOutputPolicy } from "../../src/exporters/private-policy.js";
import { digest, fingerprint } from "../../src/composition/primitives.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
test("rejects wrong/altered embedded programs, missing fonts and changed report bindings", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact("مرحبا بالعالم", "Seat 0007", true),
		e = await exportPrivateFiles({
			artifact: f.artifact,
			constraints: f.constraints,
			ports: f.ports,
			now: 1000,
			policy: defaultOutputPolicy,
		}),
		file = e.files.find((f) => f.name === "output.pdf");
	assert.ok(file);
	const cases = [];
	for (const kind of ["altered", "wrong", "missing"] as const) {
		const doc = await PDFDocument.load(file.bytes),
			fonts = doc
				.getPage(0)
				.node.Resources()
				?.lookup(PDFName.of("Font"), PDFDict);
		assert.ok(fonts);
		const entry = fonts.entries()[0];
		assert.ok(entry);
		const font = doc.context.lookup(entry[1], PDFDict),
			desc = font
				.lookup(PDFName.of("DescendantFonts"), PDFArray)
				.lookup(0, PDFDict)
				.lookup(PDFName.of("FontDescriptor"), PDFDict),
			program = desc.lookup(PDFName.of("FontFile2"));
		assert.ok(program instanceof PDFRawStream);
		if (kind === "missing") desc.delete(PDFName.of("FontFile2"));
		else {
			const bytes =
				kind === "wrong"
					? Buffer.from(f.fonts[0]?.base64 ?? "", "base64")
					: Buffer.from(boundedPdfStream(program, 2000000));
			if (kind === "altered") bytes[100] = (bytes[100] ?? 0) ^ 1;
			desc.set(
				PDFName.of("FontFile2"),
				doc.context.register(doc.context.flateStream(bytes)),
			);
		}
		const changed = await doc.save({ useObjectStreams: false });
		await assert.rejects(inspectPdf(changed, f.artifact));
		cases.push({ id: kind, digest: digest(changed), state: "rejected" });
		const parent = process.env["PP_OUTPUT_EVIDENCE_DIR"];
		if (parent) {
			await mkdir(join(parent, "pdf-semantic"), { recursive: true });
			await writeFile(
				join(parent, "pdf-semantic", `font-${kind}.pdf`),
				changed,
			);
		}
	}
	const { assemblePrivateArchive } = await import(
			"../../src/manifests/private-inventory.js"
		),
		lineage = {
			batchDigest: null,
			rowDigest: null,
			ordinal: null,
			inputDigest: fingerprint(f.input),
			previewDigest: null,
			repairPolicyDigest: null,
		};
	await assert.rejects(
		assemblePrivateArchive(
			{ ...e, report: { ...e.report, reportHash: digest("tampered") } },
			{
				artifact: f.artifact,
				constraints: f.constraints,
				ports: f.ports,
				now: 1000,
				policy: defaultOutputPolicy,
			},
			lineage,
		),
	);
	const parent = process.env["PP_OUTPUT_EVIDENCE_DIR"];
	if (parent)
		await writeFile(
			join(parent, "pdf-semantic", "font-adversarial.json"),
			JSON.stringify(
				{
					mode: "real-font-byte-mutations",
					executionNonce: process.env["PP_DURABILITY_EXECUTION_NONCE"],
					cases,
					reportBinding: "rejected",
				},
				null,
				2,
			),
		);
});
