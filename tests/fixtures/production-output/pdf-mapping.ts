import {
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFRawStream,
	decodePDFRawStream,
} from "pdf-lib";
import { getDocument, OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import assert from "node:assert/strict";
import { digest } from "../../../src/composition/primitives.js";

export async function mappingEvidence(bytes: Uint8Array) {
	const doc = await PDFDocument.load(bytes, { updateMetadata: false });
	const fonts = doc
		.getPage(0)
		.node.Resources()
		?.lookup(PDFName.of("Font"), PDFDict);
	const mappings = (fonts?.entries() ?? []).map(([key, ref]) => {
		const font = doc.context.lookup(ref, PDFDict),
			unicode = font.lookup(PDFName.of("ToUnicode"));
		return {
			resource: key.decodeText(),
			baseFont: String(font.get(PDFName.of("BaseFont"))),
			cmap:
				unicode instanceof PDFRawStream
					? Buffer.from(decodePDFRawStream(unicode).decode()).toString("ascii")
					: null,
		};
	});
	const streams = doc.context
		.enumerateIndirectObjects()
		.flatMap(([ref, object]) => {
			if (!(object instanceof PDFRawStream)) return [];
			if (
				object.dict.has(PDFName.of("Length1")) ||
				object.dict.has(PDFName.of("ColorSpace"))
			)
				return [];
			const decoded = Buffer.from(decodePDFRawStream(object).decode()).toString(
				"ascii",
			);
			return decoded.includes("BT")
				? [
						{
							ref: String(ref),
							digest: digest(decoded),
							textOperations: decoded,
							hasActualText: decoded.includes("/ActualText"),
						},
					]
				: [];
		});
	const task = getDocument({
		data: Uint8Array.from(bytes),
		useSystemFonts: false,
		disableFontFace: true,
	});
	try {
		const pdf = await task.promise,
			page = await pdf.getPage(1);
		const normal = await page.getTextContent(),
			raw = await page.getTextContent({
				disableNormalization: true,
				includeMarkedContent: true,
			});
		const strings = (items: typeof normal.items) =>
			items.flatMap((i) => ("str" in i && i.str.length ? [i.str] : []));
		const operators = await page.getOperatorList();
		return {
			fileDigest: digest(bytes),
			mappings,
			streams,
			defaultStrings: strings(normal.items),
			normalizationDisabledStrings: strings(raw.items),
			paintOperatorsDigest: digest(
				JSON.stringify({
					fnArray: operators.fnArray.filter(
						(n) =>
							n !== OPS.beginMarkedContentProps && n !== OPS.endMarkedContent,
					),
					argsArray: operators.argsArray.filter(
						(_, i) =>
							operators.fnArray[i] !== OPS.beginMarkedContentProps &&
							operators.fnArray[i] !== OPS.endMarkedContent,
					),
				}),
			),
		};
	} finally {
		await task.destroy();
	}
}

export function pageContentBytes(doc: PDFDocument): Buffer {
	const value = doc.getPage(0).node.Contents();
	const streams =
		value instanceof PDFArray
			? value.asArray().map((ref) => {
					const stream = doc.context.lookup(ref);
					assert.ok(stream instanceof PDFRawStream);
					return stream;
				})
			: value instanceof PDFRawStream
				? [value]
				: [];
	return Buffer.concat(
		streams.map((stream) => Buffer.from(decodePDFRawStream(stream).decode())),
	);
}
