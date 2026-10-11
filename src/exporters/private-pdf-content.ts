import { PDFDict, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import type { SemanticFont } from "./private-pdf-fonts.js";
import { requireOutput } from "./private-policy.js";
import { pdfOperations } from "./private-pdf-tokens.js";
import type { PdfToken } from "./private-pdf-tokens.js";
import {
	numbers,
	matrix,
	multiply,
	point,
	boxOf,
	includesBox,
	identityMatrix,
} from "./private-pdf-geometry.js";
import type { Matrix, Box } from "./private-pdf-geometry.js";
import { PdfTextReader, textOperators } from "./private-pdf-text-content.js";
import type { Paint } from "./private-pdf-text-content.js";
export type {
	PaintedGlyph,
	PdfCluster,
	PdfTextLine,
	Paint,
} from "./private-pdf-text-content.js";
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
export function readPdfContent(
	doc: PDFDocument,
	bytes: Uint8Array,
	fonts: ReadonlyMap<string, SemanticFont>,
) {
	let ctm: Matrix = identityMatrix,
		color: readonly number[] = [0, 0, 0],
		clip: Box | null = null,
		path: (readonly [number, number])[] = [],
		clipPending = false;
	const saved: { ctm: Matrix; color: readonly number[]; clip: Box | null }[] =
			[],
		paints: Paint[] = [];
	const reader = new PdfTextReader(fonts);
	let ordinal = 0;
	for (const { op, args } of pdfOperations(bytes)) {
		if (
			["q", "Q", "h", "W", "W*", "n", "f", "f*", "BT", "ET", "EMC"].includes(op)
		)
			requireOutput(
				args.length === 0,
				"OUTPUT_UNSUPPORTED",
				"pdf.extraOperands",
			);
		ordinal++;
		if (textOperators.some((v) => v === op)) {
			requireOutput(
				op !== "BT" || path.length === 0,
				"OUTPUT_UNSUPPORTED",
				"pdf.textPath",
			);
			reader.execute(op, args, { ctm, color, clip });
			continue;
		}
		switch (op) {
			case "q":
				requireOutput(
					!reader.active && saved.length < 32,
					"OUTPUT_UNSUPPORTED",
					"pdf.q",
				);
				saved.push({ ctm, color, clip });
				break;
			case "Q": {
				requireOutput(
					!reader.active && path.length === 0,
					"OUTPUT_UNSUPPORTED",
					"pdf.Q",
				);
				const old = saved.pop();
				requireOutput(
					old !== undefined,
					"OUTPUT_INTEGRITY",
					"pdf.graphicsBalance",
				);
				ctm = old.ctm;
				color = old.color;
				clip = old.clip;
				break;
			}
			case "cm":
				requireOutput(!reader.active, "OUTPUT_UNSUPPORTED", "pdf.textCtm");
				ctm = multiply(ctm, matrix(args));
				break;
			case "rg":
				color = numbers(args, 3);
				requireOutput(
					color.every((v) => v >= 0 && v <= 1),
					"OUTPUT_UNSUPPORTED",
					"pdf.color",
				);
				break;
			case "RG":
				numbers(args, 3);
				break;
			case "gs": {
				const resources = doc
						.getPage(0)
						.node.Resources()
						?.lookup(PDFName.of("ExtGState"), PDFDict),
					g = resources?.lookup(PDFName.of(name(args[0])), PDFDict);
				requireOutput(
					g !== undefined && !g.has(PDFName.of("SMask")),
					"OUTPUT_UNSUPPORTED",
					"pdf.extState",
				);
				for (const key of ["ca", "CA"]) {
					const alpha = g.lookupMaybe(PDFName.of(key), PDFNumber);
					requireOutput(
						!alpha || alpha.asNumber() === 1,
						"OUTPUT_UNSUPPORTED",
						"pdf.opacity",
					);
				}
				const blend = g.lookupMaybe(PDFName.of("BM"), PDFName);
				requireOutput(
					!blend || blend.decodeText() === "Normal",
					"OUTPUT_UNSUPPORTED",
					"pdf.blend",
				);
				break;
			}
			case "re": {
				requireOutput(!reader.active, "OUTPUT_UNSUPPORTED", "pdf.textPath");
				const [x = 0, y = 0, w = 0, h = 0] = numbers(args, 4);
				path.push(point(ctm, x, y), point(ctm, x + w, y + h));
				break;
			}
			case "m":
			case "l": {
				requireOutput(!reader.active, "OUTPUT_UNSUPPORTED", "pdf.textPath");
				const [x = 0, y = 0] = numbers(args, 2);
				path.push(point(ctm, x, y));
				break;
			}
			case "c": {
				requireOutput(!reader.active, "OUTPUT_UNSUPPORTED", "pdf.textPath");
				const n = numbers(args, 6);
				for (let i = 0; i < 6; i += 2)
					path.push(point(ctm, n[i] ?? 0, n[i + 1] ?? 0));
				break;
			}
			case "h":
				requireOutput(path.length > 0, "OUTPUT_INTEGRITY", "pdf.pathClose");
				break;
			case "W":
			case "W*":
				requireOutput(
					path.length === 2 && !clipPending,
					"OUTPUT_UNSUPPORTED",
					"pdf.clipPath",
				);
				clipPending = true;
				break;
			case "n": {
				if (clipPending) {
					const box = boxOf(path);
					requireOutput(
						clip === null || includesBox(clip, box),
						"OUTPUT_UNSUPPORTED",
						"pdf.clipIntersection",
					);
					clip = box;
				}
				path = [];
				clipPending = false;
				break;
			}
			case "f":
			case "f*":
				requireOutput(
					!reader.active && !clipPending,
					"OUTPUT_UNSUPPORTED",
					"pdf.fill",
				);
				paints.push({ box: boxOf(path), color, image: null, ordinal });
				path = [];
				break;
			case "Do":
				requireOutput(!reader.active, "OUTPUT_UNSUPPORTED", "pdf.textImage");
				paints.push({
					box: boxOf([point(ctm, 0, 0), point(ctm, 1, 1)]),
					color,
					image: name(args[0]),
					ordinal,
				});
				break;
			default:
				requireOutput(false, "OUTPUT_UNSUPPORTED", "pdf.operator");
		}
		requireOutput(
			paints.length <= 4096 && path.length <= 8192,
			"OUTPUT_LIMIT",
			"pdf.contentInventory",
		);
	}
	requireOutput(
		!reader.active && saved.length === 0 && path.length === 0 && !clipPending,
		"OUTPUT_INTEGRITY",
		"pdf.balance",
	);
	return { lines: reader.lines, paints };
}
