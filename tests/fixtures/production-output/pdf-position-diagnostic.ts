import { create } from "fontkit";
import { fingerprint } from "../../../src/composition/primitives.js";
import type { PrivateArtifact } from "../../../src/composition/private-model.js";
import { canonicalGlyphMatches } from "../../../src/exporters/private-unicode-glyph-relations.js";
import { point } from "../../../src/exporters/private-pdf-geometry.js";
import type { Matrix } from "../../../src/exporters/private-pdf-geometry.js";
import type { SemanticFont } from "../../../src/exporters/private-pdf-fonts.js";
import type { PdfTextLine } from "../../../src/exporters/private-pdf-text-types.js";
import { requireOutput } from "../../../src/exporters/private-policy.js";
import type { validatePdfLine } from "../../../src/exporters/private-pdf-line.js";

export type PositionSource = Parameters<typeof validatePdfLine>[0]["source"];
export function sourceLines(
	artifact: PrivateArtifact,
): readonly PositionSource[] {
	return artifact.model.input.nodes.flatMap((node) => {
		if (node.kind !== "text" || !node.visible) return [];
		const text = artifact.texts.find(
			(v) =>
				v.field.fieldRef === node.field.fieldRef &&
				v.field.rowRef === node.field.rowRef,
		);
		requireOutput(
			text?.state === "measured" && !text.overflow,
			"OUTPUT_CONTENT",
			"pdf.diagnosticSource",
		);
		return text.lines
			.filter((line) => line.value.length > 0)
			.map((line) => ({ node, text, line }));
	});
}
export function positionDiagnostic(request: {
	readonly artifact: PrivateArtifact;
	readonly source: PositionSource;
	readonly actual: PdfTextLine;
	readonly fonts: ReadonlyMap<string, SemanticFont>;
}) {
	const { artifact, source, actual, fonts } = request;
	requireOutput(
		actual.glyphs.length <= 256 && actual.clusters.length <= 256,
		"OUTPUT_LIMIT",
		"pdf.diagnosticGlyphs",
	);
	const pin = artifact.fontBytes.find(
		(v) => v.descriptor.digest === source.text.font.digest,
	);
	requireOutput(pin !== undefined, "OUTPUT_INTEGRITY", "pdf.diagnosticFont");
	const font = create(Buffer.from(pin.base64, "base64"));
	requireOutput(
		"layout" in font,
		"OUTPUT_UNSUPPORTED",
		"pdf.diagnosticCollection",
	);
	const values = actual.clusters.map((cluster) => {
		const glyph = cluster.glyphs[0];
		const intrinsic = glyph
			? fonts.get(glyph.font)?.cmap.get(glyph.cid)
			: undefined;
		return cluster.actualText &&
			cluster.glyphs.length === 1 &&
			intrinsic !== undefined &&
			canonicalGlyphMatches(intrinsic, cluster.value)
			? intrinsic
			: cluster.value;
	});
	const input = (actual.reversed ? [...values].reverse() : values).join("");
	const run = font.layout(
		input,
		undefined,
		undefined,
		source.text.field.language,
		source.text.field.direction,
	);
	requireOutput(
		run.glyphs.length <= 256,
		"OUTPUT_LIMIT",
		"pdf.diagnosticShaping",
	);
	const pt = 72 / 25.4,
		t = source.node.transform,
		angle = (t.rotation * Math.PI) / 180;
	const world: Matrix = [
		pt * t.scaleX * Math.cos(angle),
		-pt * t.scaleX * Math.sin(angle),
		pt * t.scaleY * Math.sin(angle),
		pt * t.scaleY * Math.cos(angle),
		pt * t.x,
		artifact.model.layout.height * pt - pt * t.y,
	];
	const anchor = {
		x: source.line.x,
		baseline: source.line.baseline,
		floor64X: Math.floor(source.line.x * 64) / 64,
		floor64Baseline: Math.floor(source.line.baseline * 64) / 64,
	};
	let penX = 0,
		penY = 0;
	const shaped = run.glyphs.map((glyph, index) => {
		const position = run.positions[index];
		requireOutput(
			position !== undefined,
			"OUTPUT_INTEGRITY",
			"pdf.diagnosticPosition",
		);
		const scale = source.node.field.sizeMm / font.unitsPerEm;
		const modelOriginMm = [
			anchor.floor64X + (penX + position.xOffset) * scale,
			anchor.floor64Baseline - (penY + position.yOffset) * scale,
		] as const;
		const expectedOriginPt = point(world, modelOriginMm[0], -modelOriginMm[1]);
		const record = {
			index,
			gid: glyph.id,
			advanceWidth: glyph.advanceWidth,
			outlineCommands: glyph.path.commands.length,
			bbox:
				glyph.path.commands.length === 0
					? null
					: {
							minX: glyph.bbox.minX,
							minY: glyph.bbox.minY,
							maxX: glyph.bbox.maxX,
							maxY: glyph.bbox.maxY,
						},
			penFontUnits: [penX, penY],
			position,
			modelOriginMm,
			expectedOriginPt,
			existingTolerancePt: (pt * (index + 1)) / 65536 + 0.0001,
		};
		penX += position.xAdvance;
		penY += position.yAdvance;
		return record;
	});
	const observations = actual.glyphs.map((glyph, index) => {
		const embedded = fonts.get(glyph.font);
		requireOutput(
			embedded !== undefined,
			"OUTPUT_INTEGRITY",
			"pdf.diagnosticResource",
		);
		const expected = shaped[index];
		const previous = actual.glyphs[index - 1];
		const sameCount = shaped.length === actual.glyphs.length;
		return {
			index,
			cid: glyph.cid,
			gid: embedded.gid(glyph.cid),
			size: glyph.size,
			matrix: glyph.transform,
			clip: glyph.clip,
			color: glyph.color,
			pdfWidth1000: embedded.width(glyph.cid),
			embeddedAdvance: embedded.embedded.getGlyph(glyph.cid).advanceWidth,
			fontProgramDigest: embedded.programDigest,
			sourceFontDigest: embedded.sourceDigest,
			displacementPt: previous
				? [
						glyph.transform[4] - previous.transform[4],
						glyph.transform[5] - previous.transform[5],
					]
				: null,
			deltaPt:
				sameCount && expected
					? [
							glyph.transform[4] - expected.expectedOriginPt[0],
							glyph.transform[5] - expected.expectedOriginPt[1],
						]
					: null,
			basisDelta: glyph.transform
				.slice(0, 4)
				.map((v, i) => v - (world[i] ?? 0)),
		};
	});
	const literal = (
		actual.reversed ? [...actual.clusters].reverse() : actual.clusters
	)
		.map((v) => v.value)
		.join("");
	const result = {
		model:
			"fontkit-design-advance-baseline_floor64_displacement65536; diagnostic-only",
		sourceLineDigest: fingerprint(source.line.value),
		actualLiteralDigest: fingerprint(literal),
		shapingInputDigest: fingerprint(input),
		exactLiteral: literal === source.line.value,
		reversed: actual.reversed,
		sourceTransform: t,
		sourceWorld: world,
		anchor,
		sourceAdvanceMm: source.line.advance,
		sourceBounds: source.line.bounds,
		sizeMm: source.node.field.sizeMm,
		font: {
			digest: pin.descriptor.digest,
			unitsPerEm: font.unitsPerEm,
			ascent: font.ascent,
			descent: font.descent,
			lineGap: font.lineGap,
			bbox: {
				minX: font.bbox.minX,
				minY: font.bbox.minY,
				maxX: font.bbox.maxX,
				maxY: font.bbox.maxY,
			},
		},
		comparison:
			shaped.length === actual.glyphs.length
				? "one-to-one"
				: "composed-outlines-required",
		shaped,
		actual: observations,
	};
	requireOutput(
		Buffer.byteLength(JSON.stringify(result)) <= 262144,
		"OUTPUT_LIMIT",
		"pdf.diagnosticBytes",
	);
	return result;
}
