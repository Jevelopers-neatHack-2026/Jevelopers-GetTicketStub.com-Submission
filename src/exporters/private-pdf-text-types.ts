import type { Matrix, Box } from "./private-pdf-geometry.js";
import type { PdfToken } from "./private-pdf-tokens.js";
import { utf16Hex } from "./private-pdf-tokens.js";
import { requireOutput } from "./private-policy.js";
export type PaintedGlyph = {
	readonly cid: number;
	readonly font: string;
	readonly transform: Matrix;
	readonly size: number;
	readonly color: readonly number[];
	readonly clip: Box | null;
};
export type PdfCluster = {
	readonly value: string;
	readonly glyphs: readonly PaintedGlyph[];
	readonly actualText: boolean;
};
export type PdfTextLine = {
	readonly clusters: readonly PdfCluster[];
	readonly reversed: boolean;
	readonly glyphs: readonly PaintedGlyph[];
};
export type Paint = {
	readonly box: Box;
	readonly color: readonly number[];
	readonly image: string | null;
	readonly ordinal: number;
};

export function decodeActualText(token: PdfToken | undefined): string {
	const value = token;
	requireOutput(
		typeof value === "object" &&
			value !== null &&
			!Array.isArray(value) &&
			"hex" in value,
		"OUTPUT_UNSUPPORTED",
		"pdf.actualTextEncoding",
	);
	const data = Buffer.from(value.hex, "hex");
	let unicode: string;
	if (value.hex.startsWith("FEFF")) unicode = utf16Hex(value.hex.slice(4));
	else {
		requireOutput(
			[...data].every((b) => b >= 32 && b <= 126),
			"OUTPUT_UNSUPPORTED",
			"pdf.pdfDocEncoding",
		);
		unicode = data.toString("ascii");
	}
	requireOutput(
		[...unicode].length > 0 &&
			[...unicode].length <= 16 &&
			!unicode.includes("\u0000"),
		"OUTPUT_UNSUPPORTED",
		"pdf.actualTextLength",
	);

	return unicode;
}
