import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	PDFDocument,
	PDFOperator,
	PDFOperatorNames,
	PDFHexString,
	PDFName,
	endMarkedContent,
	StandardFonts,
} from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";
import {
	mappingEvidence,
	pageContentBytes,
} from "../fixtures/production-output/pdf-mapping.js";
import { assertEnvironment } from "../../src/runtime/environment.js";
import { openOfflineBrowser } from "../../src/exporters/offline-browser.js";
import { renderFiles } from "../../src/exporters/private-render.js";
import { inspectPdf } from "../../src/exporters/private-pdf.js";
import { defaultOutputPolicy } from "../../src/exporters/private-policy.js";
import {
	recheckPermissions,
	verifyArtifactIdentity,
} from "../../src/composition/private-model.js";
import { digest } from "../../src/composition/primitives.js";
import { resource } from "../../src/runtime/resources.js";
import { fileURLToPath } from "node:url";

let root: string,
	keep = false;
before(async () => {
	const requested = process.env["PP_OUTPUT_EVIDENCE_DIR"];
	keep = requested !== undefined;
	root = requested
		? join(requested, "pdf-mapping")
		: await mkdtemp(join(tmpdir(), "pp-pdf-mapping-"));
	await mkdir(root, { recursive: true });
});
after(async () => {
	if (!keep) await rm(root, { recursive: true, force: true });
});
for (const [id, name, rtl] of [
	["arabic", "مرحبا بالعالم", true],
	[
		"wrap",
		"A long exact attendee name wrapping across multiple measured lines",
		false,
	],
] as const)
	test(`observes actual ${id} PDF mapping while retaining the exact production rejection`, {
		timeout: 30000,
	}, async () => {
		const f = await fixtureArtifact(name, "Seat 0007", rtl);
		verifyArtifactIdentity(f.artifact);
		await recheckPermissions(f.artifact, f.ports, "export", 1000);
		const { pins } = await assertEnvironment(),
			offline = await openOfflineBrowser(pins);
		try {
			const rendered = await renderFiles(
				offline.context,
				f.artifact,
				defaultOutputPolicy,
			);
			assert.ok(rendered.pdf);
			const evidence = await mappingEvidence(rendered.pdf),
				expected = f.artifact.texts.flatMap((t) =>
					t.state === "measured" ? t.lines.map((l) => l.value) : [],
				);
			assert.equal(
				expected.every((line) =>
					evidence.defaultStrings.join("").includes(line),
				),
				false,
			);
			const semantic = await inspectPdf(rendered.pdf, f.artifact);
			assert.deepEqual(semantic.semantics.lines, expected);
			assert.equal(semantic.readerCorroboration.exactLinesMatch, false);
			assert.equal(offline.denied.length, 0);
			assert.equal(f.state.generationCalls, 0);
			const pdfPath = join(root, `${id}.pdf`);
			await writeFile(pdfPath, rendered.pdf);
			await Promise.all([
				writeFile(join(root, `${id}.png`), rendered.png),
				writeFile(join(root, `${id}.svg`), f.artifact.svg),
			]);
			await writeFile(
				join(root, `${id}.json`),
				JSON.stringify(
					{
						mode: "diagnostic-synthetic-not-production",
						executionNonce:
							process.env["PP_DURABILITY_EXECUTION_NONCE"] ?? null,
						expected,
						...evidence,
						sourceArtworkHashes: f.artifact.sourceArtworkHashes,
						networkRequests: offline.denied.length,
						productionExactness: "verified-private-not-approved",
					},
					null,
					2,
				),
			);
		} finally {
			await offline.browser.close();
		}
	});
test("does not treat an ActualText span as exact extraction in the pinned independent reader", async () => {
	const doc = await PDFDocument.create(),
		page = doc.addPage([288, 144]),
		font = await doc.embedFont(StandardFonts.Helvetica),
		replacement = "Original Unicode 0007 ";
	page.pushOperators(
		PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [
			PDFName.of("Span"),
			`<< /ActualText ${PDFHexString.fromText(replacement).toString()} >>`,
		]),
	);
	page.drawText("Displayed glyphs", { x: 20, y: 80, size: 12, font });
	page.pushOperators(endMarkedContent());
	const pdf = await doc.save({ useObjectStreams: false });
	const content = pageContentBytes(await PDFDocument.load(pdf));
	assert.ok(content.toString().includes("/ActualText"));
	const task = getDocument({
		data: Uint8Array.from(pdf),
		useSystemFonts: false,
		disableFontFace: true,
		standardFontDataUrl: fileURLToPath(
			resource("node_modules/pdfjs-dist/standard_fonts/"),
		),
	});
	let extracted: string;
	try {
		const d = await task.promise,
			text = await (await d.getPage(1)).getTextContent({
				includeMarkedContent: true,
			});
		extracted = text.items.flatMap((i) => ("str" in i ? [i.str] : [])).join("");
	} finally {
		await task.destroy();
	}
	assert.equal(extracted, "Displayed glyphs");
	assert.notEqual(extracted, replacement);
	const path = join(root, "actualtext-control.pdf");
	await writeFile(path, pdf);
	await writeFile(
		join(root, "actualtext-control.json"),
		JSON.stringify(
			{
				mode: "diagnostic-synthetic-not-production",
				executionNonce: process.env["PP_DURABILITY_EXECUTION_NONCE"] ?? null,
				replacement,
				extracted,
				fileDigest: digest(pdf),
				readerUsesActualText: false,
				productionExactness: "not-accepted",
			},
			null,
			2,
		),
	);
});
