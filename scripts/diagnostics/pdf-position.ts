import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { fixtureArtifact } from "../../tests/fixtures/composition/corpus.js";
import {
	sourceLines,
	positionDiagnostic,
} from "../../tests/fixtures/production-output/pdf-position-diagnostic.js";
import { assertEnvironment } from "../../src/runtime/environment.js";
import { VerificationFailure } from "../../src/runtime/errors.js";
import { openOfflineBrowser } from "../../src/exporters/offline-browser.js";
import { renderFiles } from "../../src/exporters/private-render.js";
import {
	defaultOutputPolicy,
	OutputError,
	requireOutput,
} from "../../src/exporters/private-policy.js";
import { readSemanticFonts } from "../../src/exporters/private-pdf-fonts.js";
import { readPdfContent } from "../../src/exporters/private-pdf-content.js";
import { contentStreams } from "../../src/exporters/private-pdf-streams.js";
import { pdfSourceGraph } from "../../src/exporters/private-pdf-source-graph.js";
import { inspectPdf } from "../../src/exporters/private-pdf.js";
import { digest, fingerprint } from "../../src/composition/primitives.js";
import { domPositions } from "./pdf-dom-position.js";
import { readResource } from "../../src/runtime/resources.js";

const variants = [
	{ id: "arabic", value: "مرحبا بالعالم", rtl: true },
	{
		id: "wrap",
		value: "A long exact attendee name wrapping across multiple measured lines",
		rtl: false,
	},
	{ id: "combining", value: "Café Ångström", rtl: false },
	{ id: "ligatures", value: "office affinity ffi fi fl", rtl: false },
	{ id: "multiline", value: "Anne\nMarie", rtl: false },
	{ id: "literal", value: "<b>Zoë</b> & 0009", rtl: false },
] as const;
async function run() {
	requireOutput(
		process.argv.length === 3 && process.argv[2] !== undefined,
		"OUTPUT_UNSUPPORTED",
		"pdf.diagnosticArguments",
	);
	const root = resolve(process.argv[2]),
		executionNonce = randomUUID();
	await mkdir(root, { recursive: true });
	const { pins, receipt } = await assertEnvironment();
	const sourceFiles = await Promise.all(
		[
			"src/exporters/private-pdf-line.ts",
			"src/exporters/private-pdf-geometry.ts",
			"src/exporters/private-pdf-outlines.ts",
			"src/exporters/private-pdf-source.ts",
			"tests/fixtures/production-output/pdf-position-diagnostic.ts",
			"scripts/diagnostics/pdf-position.ts",
			"scripts/diagnostics/pdf-dom-position.ts",
		].map(async (path) => ({ path, digest: digest(await readResource(path)) })),
	);
	const { browser, context, denied, binarySha256, sandbox } =
		await openOfflineBrowser(pins);
	const results = [];
	try {
		for (const variant of variants) {
			const f = await fixtureArtifact(variant.value, "Seat 0007", variant.rtl);
			const rendered = await renderFiles(
				context,
				f.artifact,
				defaultOutputPolicy,
			);
			const dom = await domPositions(context, f.artifact);
			requireOutput(
				rendered.pdf !== null && denied.length === 0,
				"OUTPUT_INTEGRITY",
				"pdf.diagnosticRender",
			);
			await writeFile(join(root, `${variant.id}.pdf`), rendered.pdf);
			await writeFile(join(root, `${variant.id}.png`), rendered.png);
			const doc = await PDFDocument.load(rendered.pdf, {
				updateMetadata: false,
			});
			const graphDigest = pdfSourceGraph(doc),
				fonts = readSemanticFonts(doc, f.artifact);
			const content = contentStreams(doc)[0];
			requireOutput(
				content !== undefined,
				"OUTPUT_INTEGRITY",
				"pdf.diagnosticStream",
			);
			const actual = readPdfContent(doc, content, fonts),
				expected = sourceLines(f.artifact);
			requireOutput(
				actual.lines.length === expected.length && expected.length <= 16,
				"OUTPUT_LIMIT",
				"pdf.diagnosticLines",
			);
			const lines = actual.lines.map((line, index) => {
				const source = expected[index];
				requireOutput(
					source !== undefined,
					"OUTPUT_INTEGRITY",
					"pdf.diagnosticLine",
				);
				return positionDiagnostic({
					artifact: f.artifact,
					source,
					actual: line,
					fonts,
				});
			});
			let inspection: {
				readonly state: "passed" | "rejected";
				readonly code: string | null;
				readonly path: string | null;
			};
			try {
				await inspectPdf(rendered.pdf, f.artifact);
				inspection = { state: "passed", code: null, path: null };
			} catch (error) {
				if (!(error instanceof OutputError)) throw error;
				inspection = {
					state: "rejected",
					code: error.code,
					path: error.path.slice(0, 128),
				};
			}
			const data = {
				schema: "synthetic-pdf-position-diagnostic-1",
				executionNonce,
				fixture: variant.id,
				profile: receipt.profile,
				platform: receipt.platform,
				node: receipt.node,
				npm: receipt.npm,
				icu: receipt.icu,
				unicode: receipt.unicode,
				locale: receipt.locale,
				timezone: receipt.timezone,
				image: receipt.image,
				pinsDigest: fingerprint(pins),
				sourceFiles,
				environmentReceiptDigest: fingerprint(receipt),
				browserDigest: binarySha256,
				sandboxDigest: fingerprint(sandbox),
				sourceDigest: fingerprint(f.input),
				sourceSvgDigest: digest(f.artifact.svg),
				compositionHash: f.artifact.compositionHash,
				rendererProof: rendered.proof,
				fileDigest: digest(rendered.pdf),
				pngDigest: digest(rendered.png),
				pixelDigest: rendered.pixelDigest,
				graphDigest,
				contentDigest: digest(content),
				dom,
				lines,
				inspection,
				networkRequests: denied.length,
				generationCalls: f.state.generationCalls,
				handoffEligible: false,
			};
			const json = JSON.stringify(data, null, 2);
			requireOutput(
				Buffer.byteLength(json) <= 1048576,
				"OUTPUT_LIMIT",
				"pdf.diagnosticFile",
			);
			await writeFile(join(root, `${variant.id}.json`), json);
			results.push({
				fixture: variant.id,
				inspection,
				fileDigest: data.fileDigest,
				diagnosticDigest: digest(json),
			});
		}
	} finally {
		await browser.close();
	}
	const summary = {
		schema: "synthetic-pdf-position-diagnostic-index-1",
		executionNonce,
		profile: receipt.profile,
		results,
		fixtureCount: 6,
		passed: results.filter((v) => v.inspection.state === "passed").length,
		networkRequests: denied.length,
		productionAttemptCreated: false,
		acceptanceChanged: false,
	};
	await writeFile(join(root, "index.json"), JSON.stringify(summary, null, 2));
	console.log(JSON.stringify(summary));
	process.exitCode = summary.passed === 6 ? 0 : 1;
}
try {
	await run();
} catch (error) {
	console.error(
		JSON.stringify({
			schema: "synthetic-pdf-position-diagnostic-failure-1",
			code:
				error instanceof OutputError || error instanceof VerificationFailure
					? error.code
					: "DIAGNOSTIC_UNEXPECTED",
			acceptanceChanged: false,
		}),
	);
	process.exitCode = 1;
}
