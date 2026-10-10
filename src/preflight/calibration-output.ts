import { PNG } from "pngjs";
import { PDFDocument, PDFDict, PDFName, PDFArray, PDFRawStream } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { requireCheck } from "../runtime/errors.js";
import { sha256 } from "../runtime/resources.js";

export type CalibrationDimensions = {
	readonly widthPx: number;
	readonly heightPx: number;
	readonly widthPt: number;
	readonly heightPt: number;
	readonly lines: readonly string[];
};

export async function inspectCalibration(
	pngBytes: Uint8Array,
	pdfBytes: Uint8Array,
	expected: CalibrationDimensions,
) {
	const png = PNG.sync.read(Buffer.from(pngBytes));
	requireCheck(
		png.width === expected.widthPx && png.height === expected.heightPx,
		"DIMENSION_MISMATCH",
		"PNG dimensions differ from the calibration profile.",
	);
	const pixel = (x: number, y: number) => [
		...png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 4),
	];
	requireCheck(
		JSON.stringify(pixel(280, 110)) === "[0,0,224,255]" &&
			JSON.stringify(pixel(340, 110)) === "[224,0,0,255]" &&
			JSON.stringify(pixel(2, 2)) === "[255,255,255,255]",
		"CONTENT_MISMATCH",
		"Physical color rulers or white background are missing.",
	);
	const inkCounts = [30, 60, 90].map((baseline) => {
		let ink = 0;
		for (let y = baseline - 20; y < baseline + 2; y++) {
			for (let x = 12; x < 256; x++) {
				const offset = (y * png.width + x) * 4;
				if ((png.data[offset] ?? 255) < 128) ink++;
			}
		}
		return ink;
	});
	requireCheck(
		inkCounts.every((count) => count > 100),
		"CONTENT_MISMATCH",
		"Every text line must contain rendered ink.",
	);
	const task = getDocument({
		data: Uint8Array.from(pdfBytes),
		useSystemFonts: false,
		disableFontFace: true,
	});
	try {
		const pdf = await task.promise;
		requireCheck(
			pdf.numPages === 1,
			"DIMENSION_MISMATCH",
			"Calibration PDF must contain exactly one page.",
		);
		const page = await pdf.getPage(1);
		const viewport = page.getViewport({ scale: 1 });
		requireCheck(
			viewport.width === expected.widthPt &&
				viewport.height === expected.heightPt &&
				page.rotate === 0,
			"DIMENSION_MISMATCH",
			"PDF page dimensions or rotation differ from the profile.",
		);
		const content = await page.getTextContent();
		const rows: { y: number; parts: { x: number; text: string }[] }[] = [];
		for (const item of content.items) {
			if (!("str" in item) || item.str.length === 0) continue;
			const x = item.transform[4];
			const y = item.transform[5];
			requireCheck(
				x !== undefined && y !== undefined,
				"CONTENT_MISMATCH",
				"PDF text position is missing.",
			);
			let row = rows.find((candidate) => Math.abs(candidate.y - y) < 0.00001);
			if (!row) {
				row = { y, parts: [] };
				rows.push(row);
			}
			row.parts.push({ x, text: item.str });
		}
		const lines = rows
			.sort((a, b) => b.y - a.y)
			.map((row) =>
				row.parts
					.sort((a, b) => a.x - b.x)
					.map((part) => part.text)
					.join("")
					.normalize("NFC"),
			);
		requireCheck(
			JSON.stringify(lines) ===
				JSON.stringify(expected.lines.map((line) => line.normalize("NFC"))),
			"CONTENT_MISMATCH",
			"Independently parsed PDF text differs from the calibration corpus.",
		);
		const parsed = await PDFDocument.load(pdfBytes, { updateMetadata: false });
		const fontResources = parsed
			.getPage(0)
			.node.Resources()
			?.lookup(PDFName.of("Font"), PDFDict);
		requireCheck(
			fontResources !== undefined && fontResources.entries().length === 1,
			"FONT_FALLBACK",
			"PDF must reference exactly one embedded calibration font.",
		);
		const embeddedFonts = [];
		for (const [, reference] of fontResources.entries()) {
			const font = parsed.context.lookup(reference, PDFDict);
			const name = font.get(PDFName.of("BaseFont"));
			requireCheck(
				name instanceof PDFName &&
					/^[A-Z]{6}\+NotoSans-Regular$/.test(name.decodeText()),
				"FONT_FALLBACK",
				"PDF references an unexpected font.",
			);
			const descendants = font.lookup(PDFName.of("DescendantFonts"), PDFArray);
			const descriptor = descendants
				.lookup(0, PDFDict)
				.lookup(PDFName.of("FontDescriptor"), PDFDict);
			const program = descriptor.lookup(PDFName.of("FontFile2"));
			requireCheck(
				program instanceof PDFRawStream && program.getContents().length > 0,
				"FONT_FALLBACK",
				"PDF font program must be embedded.",
			);
			embeddedFonts.push(name.decodeText());
		}
		const epoch = new Date("2000-01-01T00:00:00Z");
		parsed.setCreationDate(epoch);
		parsed.setModificationDate(epoch);
		const normalizedPdf = await parsed.save({ useObjectStreams: false });
		const semantic = {
			widthPt: viewport.width,
			heightPt: viewport.height,
			pages: pdf.numPages,
			lines,
		};
		return {
			widthPx: png.width,
			heightPx: png.height,
			...semantic,
			inkCounts,
			embeddedFonts,
			pngByteSha256: sha256(pngBytes),
			pngPixelSha256: sha256(png.data),
			pdfByteSha256: sha256(pdfBytes),
			pdfNormalizedByteSha256: sha256(normalizedPdf),
			pdfSemanticSha256: sha256(JSON.stringify(semantic)),
			normalizedPdf,
		};
	} finally {
		await task.destroy();
	}
}
