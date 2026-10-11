import type { SemanticFont } from "./private-pdf-fonts.js";
import { requireOutput } from "./private-policy.js";
import { decodeActualText } from "./private-pdf-text-types.js";
import type { PdfToken } from "./private-pdf-tokens.js";
import {
	numbers,
	matrix,
	multiply,
	identityMatrix,
} from "./private-pdf-geometry.js";
import type { Matrix, Box } from "./private-pdf-geometry.js";
import type {
	PaintedGlyph,
	PdfCluster,
	PdfTextLine,
} from "./private-pdf-text-types.js";
export type {
	PaintedGlyph,
	PdfCluster,
	PdfTextLine,
	Paint,
} from "./private-pdf-text-types.js";
function name(value: PdfToken | undefined): string {
	requireOutput(
		typeof value === "object" &&
			value !== null &&
			!Array.isArray(value) &&
			"name" in value,
		"OUTPUT_UNSUPPORTED",
		"pdf.nameOperand",
	);
	return value.name;
}
export const textOperators = [
	"BT",
	"Tf",
	"Tm",
	"Td",
	"Tj",
	"BMC",
	"BDC",
	"EMC",
	"ET",
] as const;
export class PdfTextReader {
	readonly lines: PdfTextLine[] = [];
	active = false;
	tm: Matrix = identityMatrix;
	lm: Matrix = identityMatrix;
	font = "";
	size = 0;
	reversed = false;
	closedReversed = false;
	span: { value: string; glyphs: PaintedGlyph[] } | null = null;
	clusters: PdfCluster[] = [];
	glyphs: PaintedGlyph[] = [];
	constructor(readonly fonts: ReadonlyMap<string, SemanticFont>) {}
	execute(
		op: string,
		args: readonly PdfToken[],
		graphics: {
			readonly ctm: Matrix;
			readonly color: readonly number[];
			readonly clip: Box | null;
		},
	): void {
		let text = this.active,
			tm = this.tm,
			lm = this.lm,
			font = this.font,
			size = this.size,
			reversed = this.reversed,
			closedReversed = this.closedReversed,
			span = this.span,
			clusters = this.clusters,
			glyphs = this.glyphs;
		const { ctm, color, clip } = graphics,
			fonts = this.fonts,
			lines = this.lines;
		switch (op) {
			case "BT":
				requireOutput(!text, "OUTPUT_UNSUPPORTED", "pdf.nestedText");
				text = true;
				tm = lm = identityMatrix;
				reversed = false;
				closedReversed = false;
				span = null;
				clusters = [];
				glyphs = [];
				break;
			case "Tf":
				requireOutput(
					text && args.length === 2,
					"OUTPUT_UNSUPPORTED",
					"pdf.Tf",
				);
				font = name(args[0]);
				[size = 0] = numbers(args.slice(1), 1);
				requireOutput(
					size > 0 && size <= 100 && fonts.has(font),
					"OUTPUT_UNSUPPORTED",
					"pdf.fontUse",
				);
				break;
			case "Tm":
				requireOutput(text, "OUTPUT_UNSUPPORTED", "pdf.Tm");
				tm = lm = matrix(args);
				break;
			case "Td": {
				requireOutput(text, "OUTPUT_UNSUPPORTED", "pdf.Td");
				const [x = 0, y = 0] = numbers(args, 2);
				lm = multiply(lm, [1, 0, 0, 1, x, y]);
				tm = lm;
				break;
			}
			case "Tj": {
				requireOutput(
					text && !closedReversed && size > 0 && args.length === 1,
					"OUTPUT_UNSUPPORTED",
					"pdf.Tj",
				);
				const value = args[0];
				requireOutput(
					typeof value === "object" &&
						value !== null &&
						!Array.isArray(value) &&
						"hex" in value &&
						value.hex.length > 0 &&
						value.hex.length % 4 === 0,
					"OUTPUT_UNSUPPORTED",
					"pdf.textCodes",
				);
				const f = fonts.get(font);
				requireOutput(f !== undefined, "OUTPUT_INTEGRITY", "pdf.fontUse");
				for (let i = 0; i < value.hex.length; i += 4) {
					const cid = Number.parseInt(value.hex.slice(i, i + 4), 16);
					requireOutput(
						cid > 0 && f.cmap.has(cid),
						"OUTPUT_CONTENT",
						"pdf.unmappedCid",
					);
					const g = {
						cid,
						font,
						transform: multiply(ctm, tm),
						size,
						color,
						clip,
					};
					glyphs.push(g);
					if (span) span.glyphs.push(g);
					else {
						const unicode = f.cmap.get(cid);
						requireOutput(
							unicode !== undefined && !unicode.includes("\u0000"),
							"OUTPUT_CONTENT",
							"pdf.unmappedUnicode",
						);
						clusters.push({ value: unicode, glyphs: [g], actualText: false });
					}
					tm = multiply(tm, [1, 0, 0, 1, (f.width(cid) * size) / 1000, 0]);
				}
				break;
			}
			case "BMC":
				requireOutput(
					text &&
						!reversed &&
						!span &&
						glyphs.length === 0 &&
						name(args[0]) === "ReversedChars",
					"OUTPUT_UNSUPPORTED",
					"pdf.reversedNesting",
				);
				reversed = true;
				break;
			case "BDC": {
				const dict = args[1];
				requireOutput(
					text &&
						!span &&
						name(args[0]) === "Span" &&
						typeof dict === "object" &&
						dict !== null &&
						!Array.isArray(dict) &&
						"dict" in dict &&
						Object.keys(dict.dict).length === 1,
					"OUTPUT_UNSUPPORTED",
					"pdf.actualTextScope",
				);
				const unicode = decodeActualText(dict.dict["ActualText"]);
				span = { value: unicode, glyphs: [] };
				break;
			}
			case "EMC":
				if (span) {
					requireOutput(
						span.glyphs.length > 0 && span.glyphs.length <= 32,
						"OUTPUT_CONTENT",
						"pdf.emptyCluster",
					);
					clusters.push({
						value: span.value,
						glyphs: span.glyphs,
						actualText: true,
					});
					span = null;
				} else {
					requireOutput(
						reversed && !closedReversed,
						"OUTPUT_INTEGRITY",
						"pdf.markedBalance",
					);
					closedReversed = true;
				}
				break;
			case "ET":
				requireOutput(
					text && !span && (!reversed || closedReversed) && glyphs.length > 0,
					"OUTPUT_UNSUPPORTED",
					"pdf.textBalance",
				);
				lines.push({ clusters, reversed, glyphs });
				text = false;
				break;

			default:
				requireOutput(false, "OUTPUT_UNSUPPORTED", "pdf.textOperator");
		}
		requireOutput(
			glyphs.length <= 10000 && lines.length <= 512,
			"OUTPUT_LIMIT",
			"pdf.textInventory",
		);
		Object.assign(this, {
			active: text,
			tm,
			lm,
			font,
			size,
			reversed,
			closedReversed,
			span,
			clusters,
			glyphs,
		});
	}
}
