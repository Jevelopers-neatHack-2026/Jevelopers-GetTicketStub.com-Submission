import type { Font } from "fontkit";
import { sfntTables, glyphInstructions } from "./private-sfnt.js";
import { requireOutput } from "./private-policy.js";
import { readWoff2Reference } from "./private-woff2-reference.js";
export function verifyFontProgram(
	bytes: Uint8Array,
	embedded: Font,
	approved: { readonly font: Font; readonly bytes: Uint8Array },
): void {
	const source = approved.font,
		sourceBytes = approved.bytes;
	const actual = sfntTables(bytes),
		subset = source.createSubset(),
		ids: number[] = [];
	if (source.type === "WOFF2") {
		const reference = readWoff2Reference(sourceBytes);
		for (const name of ["cvt ", "prep", "fpgm"]) {
			const expected = reference.hints.get(name) ?? Buffer.alloc(0),
				observed = actual.get(name) ?? Buffer.alloc(0);
			requireOutput(
				expected.equals(observed),
				"OUTPUT_INTEGRITY",
				"pdf.woff2HintProgram",
			);
		}
		for (let gid = 0; gid < embedded.numGlyphs; gid++) {
			const glyph = embedded.getGlyph(gid);
			if (
				gid !== 0 &&
				glyph.path.commands.length === 0 &&
				glyph.advanceWidth === 0
			)
				continue;
			requireOutput(
				glyphInstructions(actual, gid).equals(
					reference.instructions.get(gid) ?? Buffer.alloc(0),
				),
				"OUTPUT_INTEGRITY",
				"pdf.woff2GlyphInstructions",
			);
		}
		return;
	}
	for (let i = 0; i < embedded.numGlyphs; i++) {
		const g = embedded.getGlyph(i);
		if (i === 0 || g.path.commands.length > 0 || g.advanceWidth > 0) {
			subset.includeGlyph(source.getGlyph(i));
			ids.push(i);
		}
	}
	const reference = sfntTables(subset.encode(), true);
	for (const name of ["cvt ", "prep", "fpgm"]) {
		const a = actual.get(name),
			b = reference.get(name);
		requireOutput(
			a === undefined ? b === undefined : b !== undefined && a.equals(b),
			"OUTPUT_INTEGRITY",
			"pdf.hintProgram",
		);
	}
	for (const [index, gid] of ids.entries())
		requireOutput(
			glyphInstructions(actual, gid).equals(
				glyphInstructions(reference, index),
			),
			"OUTPUT_INTEGRITY",
			`pdf.glyphInstructions.${gid}.${index}`,
		);
}
