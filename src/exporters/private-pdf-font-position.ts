import type { Glyph } from "fontkit";

type PdfFontScale = {
	readonly sizeMm: number;
	readonly unitsPerEm: number;
	readonly freetype: boolean;
};

export function pdfGlyphAdvance(
	glyph: Pick<Glyph, "advanceWidth">,
	advance: number,
	font: PdfFontScale,
): number {
	const scale = font.sizeMm / font.unitsPerEm;
	if (!font.freetype) return advance * scale;
	const size = Math.fround(font.sizeMm),
		size26 = Math.max(64, Math.trunc(size * 64)),
		scale16 = Math.floor(
			(size26 * 65536 + Math.floor(font.unitsPerEm / 2)) / font.unitsPerEm,
		),
		linear = Math.fround(
			Math.floor((glyph.advanceWidth * scale16 + 32) / 64) / 65536,
		),
		chosenSize = Math.fround(
			Math.fround(font.unitsPerEm * Math.fround(scale16 / 65536)) / 64,
		),
		nominal =
			size < 1 ? Math.fround(linear * Math.fround(size / chosenSize)) : linear;
	return (
		Math.trunc(Math.fround(nominal * 65536)) / 65536 +
		(advance - glyph.advanceWidth) * scale
	);
}
