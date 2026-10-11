import { create } from "fontkit";
import { requireOutput } from "./private-policy.js";
import { point, includesBox, boxOf } from "./private-pdf-geometry.js";
import type { Matrix } from "./private-pdf-geometry.js";
import { compareComposedOutlines } from "./private-pdf-outlines.js";
import { canonicalGlyphMatches } from "./private-unicode-glyph-relations.js";
import type { SemanticFont } from "./private-pdf-fonts.js";
import type { PdfTextLine } from "./private-pdf-text-content.js";
import type {
	PrivateArtifact,
	LayoutNode,
} from "../composition/private-model.js";
import type { TextLayout, TextLine } from "../typography/private-text.js";
type SourceLine = {
	readonly node: Extract<LayoutNode, { kind: "text" }>;
	readonly text: Extract<TextLayout, { state: "measured" }>;
	readonly line: TextLine;
};
export function validatePdfLine(request: {
	readonly source: SourceLine;
	readonly line: PdfTextLine;
	readonly fonts: ReadonlyMap<string, SemanticFont>;
	readonly artifact: PrivateArtifact;
	readonly index: number;
}) {
	const { source, line, fonts, artifact, index } = request,
		pt = 72 / 25.4,
		height = artifact.model.layout.height * pt;

	requireOutput(source !== undefined, "OUTPUT_CONTENT", "pdf.lineCount");
	const values = line.clusters.map((c) => c.value),
		parsedValue = (line.reversed ? [...values].reverse() : values).join("");
	requireOutput(
		parsedValue === source.line.value &&
			line.reversed === (source.text.field.direction === "rtl"),
		"OUTPUT_CONTENT",
		"pdf.literalText",
	);
	const pinned = artifact.fontBytes.find(
		(f) => f.descriptor.digest === source.text.font.digest,
	);
	requireOutput(pinned !== undefined, "OUTPUT_INTEGRITY", "pdf.sourceFont");
	const font = create(Buffer.from(pinned.base64, "base64"));
	requireOutput("layout" in font, "OUTPUT_UNSUPPORTED", "pdf.fontCollection");
	const glyphValues = line.clusters.map((c) => {
		if (!c.actualText || c.glyphs.length !== 1) return c.value;
		const g = c.glyphs[0];
		const intrinsic = g ? fonts.get(g.font)?.cmap.get(g.cid) : undefined;
		return intrinsic !== undefined && canonicalGlyphMatches(intrinsic, c.value)
			? intrinsic
			: c.value;
	});
	const glyphInput = (
		line.reversed ? [...glyphValues].reverse() : glyphValues
	).join("");
	const run = font.layout(
		glyphInput,
		undefined,
		undefined,
		source.text.field.language,
		source.text.field.direction,
	);
	const t = source.node.transform,
		a = (t.rotation * Math.PI) / 180,
		world: Matrix = [
			pt * t.scaleX * Math.cos(a),
			-pt * t.scaleX * Math.sin(a),
			pt * t.scaleY * Math.sin(a),
			pt * t.scaleY * Math.cos(a),
			pt * t.x,
			height - pt * t.y,
		];
	if (run.glyphs.length !== line.glyphs.length) {
		requireOutput(
			line.clusters.some((c) => c.actualText),
			"OUTPUT_CONTENT",
			"pdf.glyphCount",
		);
		for (const g of line.glyphs) {
			const f = fonts.get(g.font);
			requireOutput(
				f?.sourceDigest === pinned.descriptor.digest &&
					g.size === source.node.field.sizeMm,
				"OUTPUT_CONTENT",
				"pdf.paintedGlyph",
			);
			const color = [1, 3, 5].map(
				(i) =>
					Number.parseInt(source.node.field.color.slice(i, i + 2), 16) / 255,
			);
			requireOutput(
				g.color.every((v, i) => Math.abs(v - (color[i] ?? NaN)) < 0.0001),
				"OUTPUT_CONTENT",
				"pdf.glyphColor",
			);
		}
		compareComposedOutlines({
			source: font,
			run,
			glyphs: line.glyphs,
			fonts,
			world,
			anchor: [
				Math.floor(source.line.x * 64) / 64,
				Math.floor(source.line.baseline * 64) / 64,
			],
			size: source.node.field.sizeMm,
		});
		const box = {
			x: source.line.bounds.x * pt,
			y: height - (source.line.bounds.y + source.line.bounds.height) * pt,
			width: source.line.bounds.width * pt,
			height: source.line.bounds.height * pt,
		};
		for (const g of line.glyphs)
			requireOutput(
				g.clip === null || includesBox(g.clip, box),
				"OUTPUT_CONTENT",
				"pdf.textClip",
			);

		return {
			box,
			proof: {
				parsedValue,
				lineOrdinal: index,
				composedGlyphs: line.glyphs.map((g) => ({
					cid: g.cid,
					font: g.font,
					transform: g.transform,
					size: g.size,
				})),
				fontDigest: pinned.descriptor.digest,
			},
		};
	}
	let penX = 0,
		penY = 0;
	const bpoints: (readonly [number, number])[] = [],
		cpByGlyph: string[] = [];
	for (const [gindex, glyph] of line.glyphs.entries()) {
		const shaped = run.glyphs[gindex],
			position = run.positions[gindex],
			embedded = fonts.get(glyph.font);
		requireOutput(
			shaped !== undefined && position !== undefined && embedded !== undefined,
			"OUTPUT_CONTENT",
			"pdf.glyphInventory",
		);
		requireOutput(
			embedded.sourceDigest === pinned.descriptor.digest &&
				embedded.gid(glyph.cid) === shaped.id &&
				glyph.size === source.node.field.sizeMm,
			"OUTPUT_CONTENT",
			"pdf.paintedGlyph",
		);
		const scale = source.node.field.sizeMm / font.unitsPerEm,
			x =
				Math.floor(source.line.x * 64) / 64 + (penX + position.xOffset) * scale,
			y =
				Math.floor(source.line.baseline * 64) / 64 -
				(penY + position.yOffset) * scale;
		const [px, py] = point(world, x, -y);
		const serializedTolerance = (pt * (gindex + 1)) / 65536 + 0.0001;
		requireOutput(
			glyph.transform
				.slice(0, 4)
				.every((v, i) => Math.abs(v - (world[i] ?? NaN)) < 0.0005) &&
				Math.abs(glyph.transform[4] - px) < serializedTolerance &&
				Math.abs(glyph.transform[5] - py) < serializedTolerance,
			"OUTPUT_CONTENT",
			"pdf.glyphPosition",
		);
		const color = [1, 3, 5].map(
			(i) => Number.parseInt(source.node.field.color.slice(i, i + 2), 16) / 255,
		);
		requireOutput(
			glyph.color.every((v, i) => Math.abs(v - (color[i] ?? NaN)) < 0.0001),
			"OUTPUT_CONTENT",
			"pdf.glyphColor",
		);
		if (shaped.path.commands.length > 0) {
			const b = shaped.bbox,
				points = [
					point(glyph.transform, b.minX * scale, b.minY * scale),
					point(glyph.transform, b.maxX * scale, b.maxY * scale),
				];
			bpoints.push(...points);
			requireOutput(
				glyph.clip === null || includesBox(glyph.clip, boxOf(points)),
				"OUTPUT_CONTENT",
				"pdf.textClip",
			);
		}
		cpByGlyph.push(String.fromCodePoint(...shaped.codePoints));
		penX += position.xAdvance;
		penY += position.yAdvance;
	}
	let offset = 0;
	for (const cluster of line.clusters) {
		const cps = cpByGlyph
			.slice(offset, offset + cluster.glyphs.length)
			.filter((c) => c.length > 0);
		requireOutput(
			cps.join("") === cluster.value ||
				canonicalGlyphMatches(cps.join(""), cluster.value),
			"OUTPUT_CONTENT",
			"pdf.clusterBinding",
		);
		offset += cluster.glyphs.length;
	}
	const box = boxOf(bpoints);

	return {
		box,
		proof: {
			parsedValue,
			lineOrdinal: index,
			glyphs: line.glyphs.map((g) => ({
				cid: g.cid,
				font: g.font,
				transform: g.transform,
				size: g.size,
			})),
			clusters: line.clusters.map((c) => ({
				value: c.value,
				glyphCount: c.glyphs.length,
				actualText: c.actualText,
			})),
			fontDigest: pinned.descriptor.digest,
		},
	};
}
