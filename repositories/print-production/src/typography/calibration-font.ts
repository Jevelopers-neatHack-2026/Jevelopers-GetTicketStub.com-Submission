import { create } from "fontkit";
import { requireCheck, VerificationFailure } from "../runtime/errors.js";
import type { RuntimePins } from "../runtime/environment.js";
import { readResource, sha256 } from "../runtime/resources.js";

export async function loadCalibrationFont(
	pins: RuntimePins,
	lines: readonly string[],
	size: number,
) {
	let bytes: Buffer;
	let license: Buffer;
	try {
		bytes = await readResource(pins.font.file);
		license = await readResource(pins.font.license);
	} catch (error) {
		if (error instanceof Error)
			throw new VerificationFailure(
				"FONT_PIN_MISMATCH",
				"Pinned font or license is unavailable.",
			);
		throw error;
	}
	requireCheck(
		sha256(bytes) === pins.font.sha256 &&
			sha256(license) === pins.font.licenseSha256,
		"FONT_PIN_MISMATCH",
		"Font or font license hash differs from the lock.",
	);
	const font = create(bytes);
	requireCheck(
		"layout" in font,
		"FONT_UNSUPPORTED",
		"Calibration requires a single font face.",
	);
	for (const line of lines) {
		for (const char of line) {
			const point = char.codePointAt(0);
			requireCheck(
				point !== undefined && font.hasGlyphForCodePoint(point),
				"FONT_UNSUPPORTED",
				"Calibration corpus has an unsupported code point.",
			);
		}
		requireCheck(
			font.layout(line).glyphs.every((glyph) => glyph.id !== 0),
			"FONT_UNSUPPORTED",
			"Shaping produced a missing glyph.",
		);
	}
	requireCheck(
		font.layout("office").glyphs.length < "office".length,
		"CALIBRATION_FAILURE",
		"Font must shape the office ligature.",
	);
	requireCheck(
		font.layout("AV").advanceWidth <
			font.layout("A").advanceWidth + font.layout("V").advanceWidth,
		"CALIBRATION_FAILURE",
		"Font must kern the AV pair.",
	);
	return {
		bytes,
		postscriptName: font.postscriptName,
		expectedWidths: lines.map(
			(line) => (font.layout(line).advanceWidth * size) / font.unitsPerEm,
		),
		glyphCounts: lines.map((line) => font.layout(line).glyphs.length),
		sha256: pins.font.sha256,
	};
}
