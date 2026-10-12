import type { Font, GlyphRun } from "fontkit";
import type { PaintedGlyph } from "./private-pdf-content.js";
import type { SemanticFont } from "./private-pdf-fonts.js";
import { point } from "./private-pdf-geometry.js";
import type { Matrix } from "./private-pdf-geometry.js";
import { requireOutput } from "./private-policy.js";
import { pdfGlyphAdvance } from "./private-pdf-font-position.js";
type Contour = { commands: string[]; points: (readonly [number, number])[] };
function contours(font: Font, id: number, m: Matrix, scale: number): Contour[] {
	const result: Contour[] = [];
	let current: Contour | null = null;
	for (const c of font.getGlyph(id).path.commands) {
		if (c.command === "moveTo") {
			current = { commands: [], points: [] };
			result.push(current);
		}
		requireOutput(current !== null, "OUTPUT_INTEGRITY", "pdf.contour");
		current.commands.push(c.command);
		for (let i = 0; i < c.args.length; i += 2)
			current.points.push(
				point(m, (c.args[i] ?? 0) * scale, (c.args[i + 1] ?? 0) * scale),
			);
	}
	return result;
}
export function compareComposedOutlines(request: {
	readonly source: Font;
	readonly run: GlyphRun;
	readonly glyphs: readonly PaintedGlyph[];
	readonly fonts: ReadonlyMap<string, SemanticFont>;
	readonly world: Matrix;
	readonly anchor: readonly [number, number];
	readonly size: number;
}): void {
	const { source, run, glyphs, fonts, world, anchor, size } = request,
		scale = size / source.unitsPerEm,
		expected: Contour[] = [],
		actual: Contour[] = [];
	let x = 0,
		y = 0;
	for (const [i, g] of run.glyphs.entries()) {
		const p = run.positions[i];
		requireOutput(p !== undefined, "OUTPUT_INTEGRITY", "pdf.positions");
		const [px, py] = point(
			world,
			anchor[0] + x + p.xOffset * scale,
			-anchor[1] + y + p.yOffset * scale,
		);
		expected.push(
			...contours(
				source,
				g.id,
				[world[0], world[1], world[2], world[3], px, py],
				scale,
			),
		);
		x += pdfGlyphAdvance(g, p.xAdvance, {
			sizeMm: size,
			unitsPerEm: source.unitsPerEm,
			freetype: process.platform === "linux",
		});
		y += p.yAdvance * scale;
	}
	for (const g of glyphs) {
		const f = fonts.get(g.font);
		requireOutput(
			(f !== undefined && f.source === source) ||
				(f !== undefined && f.source.unitsPerEm === source.unitsPerEm),
			"OUTPUT_INTEGRITY",
			"pdf.composedFont",
		);
		actual.push(...contours(f.embedded, g.cid, g.transform, scale));
	}
	const order = (a: Contour, b: Contour) => {
		const ax = a.points[0]?.[0] ?? 0,
			bx = b.points[0]?.[0] ?? 0,
			ay = a.points[0]?.[1] ?? 0,
			by = b.points[0]?.[1] ?? 0;
		return Math.abs(ax - bx) > 0.01 ? ax - bx : ay - by;
	};
	expected.sort(order);
	actual.sort(order);
	requireOutput(
		expected.length === actual.length,
		"OUTPUT_CONTENT",
		"pdf.composedContours",
	);
	const tolerance = ((glyphs.length + 1) * 72) / 25.4 / 65536 + 0.0001;
	for (const [i, a] of actual.entries()) {
		const e = expected[i];
		requireOutput(
			e !== undefined &&
				a.commands.join(",") === e.commands.join(",") &&
				a.points.length === e.points.length,
			"OUTPUT_CONTENT",
			"pdf.composedOutline",
		);
		for (const [j, p] of a.points.entries()) {
			const q = e.points[j];
			requireOutput(
				q !== undefined &&
					Math.abs(p[0] - q[0]) < tolerance &&
					Math.abs(p[1] - q[1]) < tolerance,
				"OUTPUT_CONTENT",
				"pdf.composedPosition",
			);
		}
	}
	requireOutput(
		run.glyphs.filter((g) => g.path.commands.length === 0).length ===
			glyphs.filter(
				(g) =>
					fonts.get(g.font)?.embedded.getGlyph(g.cid).path.commands.length ===
					0,
			).length,
		"OUTPUT_CONTENT",
		"pdf.composedSpaces",
	);
}
