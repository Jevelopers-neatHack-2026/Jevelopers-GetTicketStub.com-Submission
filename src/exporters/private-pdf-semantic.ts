import { PDFDocument } from "pdf-lib";
import { digest, fingerprint } from "../composition/primitives.js";
import { verifyArtifactIdentity } from "../composition/private-model.js";
import type { PrivateArtifact } from "../composition/private-model.js";
import { requireOutput } from "./private-policy.js";
import { readSemanticFonts } from "./private-pdf-fonts.js";
import { readPdfContent } from "./private-pdf-content.js";
import { contentStreams } from "./private-pdf-streams.js";
import type { Box } from "./private-pdf-geometry.js";
import { validatePdfLine } from "./private-pdf-line.js";
import { verifyPdfPaint } from "./private-pdf-paint.js";
import { unicodeGlyphReference } from "./private-unicode-glyph-relations.js";

import { pdfSemanticRevision } from "./private-pdf-semantic-identity.js";
export { pdfSemanticRevision } from "./private-pdf-semantic-identity.js";
export async function inspectPdfSemantics(
	bytes: Uint8Array,
	artifact: PrivateArtifact,
) {
	requireOutput(
		bytes.length <= 16000000 && bytes.length > 0,
		"OUTPUT_LIMIT",
		"pdf.fileBytes",
	);
	const identity = verifyArtifactIdentity(artifact),
		doc = await PDFDocument.load(bytes, { updateMetadata: false });
	requireOutput(
		doc.getPageCount() === 1 &&
			!doc.isEncrypted &&
			doc.context.enumerateIndirectObjects().length <= 4096,
		"OUTPUT_UNSUPPORTED",
		"pdf.documentDialect",
	);
	const fonts = readSemanticFonts(doc, artifact),
		content = readPdfContent(
			doc,
			contentStreams(doc)[0] ?? new Uint8Array(),
			fonts,
		),
		expected = artifact.model.input.nodes.flatMap((node) => {
			if (node.kind !== "text" || !node.visible) return [];
			const text = artifact.texts.find(
				(t) =>
					t.field.fieldRef === node.field.fieldRef &&
					t.field.rowRef === node.field.rowRef,
			);
			requireOutput(
				text?.state === "measured" && !text.overflow,
				"OUTPUT_CONTENT",
				"pdf.sourceText",
			);
			return text.lines
				.filter((l) => l.value.length > 0)
				.map((line) => ({ node, text, line }));
		});
	requireOutput(
		content.lines.length === expected.length,
		"OUTPUT_CONTENT",
		"pdf.textObjectCount",
	);
	const proofs: unknown[] = [],
		boxes: Box[] = [];
	for (const [index, line] of content.lines.entries()) {
		const source = expected[index];
		requireOutput(source !== undefined, "OUTPUT_CONTENT", "pdf.lineCount");
		const result = validatePdfLine({ source, line, fonts, artifact, index });
		boxes.push(result.box);
		proofs.push(result.proof);
	}
	verifyPdfPaint(doc, content.paints, artifact, boxes);
	return {
		inspectorRevision: pdfSemanticRevision,
		fileDigest: digest(bytes),
		artifactIdentityDigest: identity,
		sourceRenderDigest: artifact.renderHash,
		lines: content.lines.map((l) =>
			(l.reversed ? [...l.clusters].reverse() : l.clusters)
				.map((c) => c.value)
				.join(""),
		),
		proofDigest: fingerprint(proofs),
		fontPrograms: [...fonts.values()].map((f) => ({
			sourceDigest: f.sourceDigest,
			programDigest: f.programDigest,
		})),
		clusterCount: content.lines.reduce((n, l) => n + l.clusters.length, 0),
		glyphCount: content.lines.reduce((n, l) => n + l.glyphs.length, 0),
		semanticDigest: fingerprint({
			unicodeGlyphReference,
			revision: pdfSemanticRevision,
			proofs,
			paints: content.paints,
		}),
	};
}
