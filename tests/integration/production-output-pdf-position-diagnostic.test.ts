import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";
import { fixtureArtifact } from "../fixtures/composition/corpus.js";
import {
	sourceLines,
	positionDiagnostic,
} from "../fixtures/production-output/pdf-position-diagnostic.js";
import { exportPrivateFiles } from "../../src/exporters/private-output.js";
import {
	defaultOutputPolicy,
	OutputError,
} from "../../src/exporters/private-policy.js";
import { readSemanticFonts } from "../../src/exporters/private-pdf-fonts.js";
import { readPdfContent } from "../../src/exporters/private-pdf-content.js";
import { contentStreams } from "../../src/exporters/private-pdf-streams.js";
import { validatePdfLine } from "../../src/exporters/private-pdf-line.js";
import type { PdfTextLine } from "../../src/exporters/private-pdf-text-types.js";
import type { Matrix } from "../../src/exporters/private-pdf-geometry.js";

test("captures real synthetic PDF coordinates and retains strict wrong/missing/inverted/shifted geometry rejection", {
	timeout: 30000,
}, async () => {
	const f = await fixtureArtifact("Alice", "Seat 0007");
	const exported = await exportPrivateFiles({
		artifact: f.artifact,
		constraints: f.constraints,
		ports: f.ports,
		now: 1000,
		policy: defaultOutputPolicy,
	});
	const file = exported.files.find((v) => v.name === "output.pdf");
	assert.ok(file);
	const doc = await PDFDocument.load(file.bytes),
		fonts = readSemanticFonts(doc, f.artifact),
		bytes = contentStreams(doc)[0];
	assert.ok(bytes);
	const actual = readPdfContent(doc, bytes, fonts).lines[0],
		source = sourceLines(f.artifact)[0];
	assert.ok(actual && source);
	const diagnostic = positionDiagnostic({
		artifact: f.artifact,
		source,
		actual,
		fonts,
	});
	assert.equal(diagnostic.exactLiteral, true);
	assert.equal(diagnostic.actual.length, actual.glyphs.length);
	assert.equal(diagnostic.font.digest, source.text.font.digest);
	assert.ok(
		diagnostic.actual.every((v) =>
			v.deltaPt?.every((d) => Math.abs(d) < 0.001),
		),
	);
	assert.ok(!JSON.stringify(diagnostic).includes("Alice"));
	assert.equal(f.state.generationCalls, 0);
	assert.equal(exported.report.draftReady, true);
	const detail = readPdfContent(doc, bytes, fonts).lines[1],
		detailSource = sourceLines(f.artifact)[1];
	assert.ok(detail && detailSource);
	const detailDiagnostic = positionDiagnostic({
		artifact: f.artifact,
		source: detailSource,
		actual: detail,
		fonts,
	});
	assert.ok(
		detailDiagnostic.shaped.some(
			(glyph) => glyph.outlineCommands === 0 && glyph.bbox === null,
		),
	);
	const first = actual.glyphs[0];
	assert.ok(first);
	const cases: readonly [string, PdfTextLine][] = [
		[
			"wrong",
			{
				...actual,
				glyphs: [{ ...first, cid: 0x13 }, ...actual.glyphs.slice(1)],
			},
		],
		["missing", { ...actual, glyphs: actual.glyphs.slice(1) }],
		...["inverted", "shifted"].map((id): [string, PdfTextLine] => {
			const matrix: Matrix = [
				id === "inverted" ? -first.transform[0] : first.transform[0],
				first.transform[1],
				first.transform[2],
				first.transform[3],
				first.transform[4] + (id === "shifted" ? 1 : 0),
				first.transform[5],
			];
			return [
				id,
				{
					...actual,
					glyphs: [{ ...first, transform: matrix }, ...actual.glyphs.slice(1)],
				},
			];
		}),
	];
	for (const [id, line] of cases) {
		assert.throws(
			() =>
				validatePdfLine({
					artifact: f.artifact,
					source,
					line,
					fonts,
					index: 0,
				}),
			(e) => e instanceof OutputError,
			id,
		);
		const captured = positionDiagnostic({
			artifact: f.artifact,
			source,
			actual: line,
			fonts,
		});
		assert.deepEqual(captured.actual[0]?.matrix, line.glyphs[0]?.transform);
		if (id === "shifted")
			assert.ok((captured.actual[0]?.deltaPt?.[0] ?? 0) > 0.9);
		if (id === "missing")
			assert.equal(captured.comparison, "composed-outlines-required");
	}
	assert.throws(
		() =>
			positionDiagnostic({
				artifact: f.artifact,
				source,
				actual: { ...actual, glyphs: Array.from({ length: 257 }, () => first) },
				fonts,
			}),
		(e) => e instanceof OutputError && e.code === "OUTPUT_LIMIT",
	);
});
