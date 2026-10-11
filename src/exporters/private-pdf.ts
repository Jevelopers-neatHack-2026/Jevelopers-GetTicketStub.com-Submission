import { PDFDocument, PDFArray, PDFDict, PDFName, PDFRawStream } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { digest, fingerprint } from "../composition/primitives.js";
import type { PrivateArtifact } from "../composition/private-model.js";
import { requireOutput } from "./private-policy.js";
import { bindPdfSrgb, inspectPdfSrgb } from "./private-pdf-profile.js";

const pt = (mm: number) => (mm * 72) / 25.4;
export async function normalizePdf(
	raw: Uint8Array,
	artifact: PrivateArtifact,
): Promise<Uint8Array> {
	const doc = await PDFDocument.load(raw, { updateMetadata: false });
	requireOutput(doc.getPageCount() === 1, "OUTPUT_INTEGRITY", "pdf.pages");
	const { width, height, trim, bleed } = artifact.model.layout,
		page = doc.getPage(0);
	page.setMediaBox(0, 0, pt(width), pt(height));
	page.setCropBox(0, 0, pt(width), pt(height));
	page.setTrimBox(
		pt(trim.x),
		pt(height - trim.y - trim.height),
		pt(trim.width),
		pt(trim.height),
	);
	page.setBleedBox(
		pt(bleed.x),
		pt(height - bleed.y - bleed.height),
		pt(bleed.width),
		pt(bleed.height),
	);
	const epoch = new Date("2000-01-01T00:00:00Z");
	doc.setCreationDate(epoch);
	doc.setModificationDate(epoch);
	doc.setCreator("private-output-1");
	doc.setProducer("pinned-chromium_private-output-1");
	bindPdfSrgb(doc);
	return doc.save({ useObjectStreams: false });
}
export async function inspectPdf(bytes: Uint8Array, artifact: PrivateArtifact) {
	const doc = await PDFDocument.load(bytes, { updateMetadata: false });
	requireOutput(
		doc.getPageCount() === 1 && !doc.isEncrypted,
		"OUTPUT_INTEGRITY",
		"pdf.pages",
	);
	for (const [, object] of doc.context.enumerateIndirectObjects())
		if (object instanceof PDFDict || object instanceof PDFRawStream)
			for (const [key, value] of (object instanceof PDFRawStream
				? object.dict
				: object
			).entries()) {
				requireOutput(
					![
						"AA",
						"OpenAction",
						"JS",
						"JavaScript",
						"Launch",
						"EmbeddedFiles",
						"AcroForm",
						"RichMedia",
						"Annots",
					].includes(key.decodeText()),
					"OUTPUT_INTEGRITY",
					"pdf.activeContent",
				);
				if (value instanceof PDFName)
					requireOutput(
						![
							"JavaScript",
							"Launch",
							"URI",
							"GoToR",
							"CMYK",
							"DeviceCMYK",
						].includes(value.decodeText()),
						"OUTPUT_UNSUPPORTED",
						"pdf.actionOrColor",
					);
			}
	const page = doc.getPage(0),
		{ width, height, trim, bleed } = artifact.model.layout;
	const boxes = {
		media: page.getMediaBox(),
		crop: page.getCropBox(),
		trim: page.getTrimBox(),
		bleed: page.getBleedBox(),
	};
	const expected = {
		media: { x: 0, y: 0, width: pt(width), height: pt(height) },
		crop: { x: 0, y: 0, width: pt(width), height: pt(height) },
		trim: {
			x: pt(trim.x),
			y: pt(height - trim.y - trim.height),
			width: pt(trim.width),
			height: pt(trim.height),
		},
		bleed: {
			x: pt(bleed.x),
			y: pt(height - bleed.y - bleed.height),
			width: pt(bleed.width),
			height: pt(bleed.height),
		},
	};
	requireOutput(
		fingerprint(boxes) === fingerprint(expected),
		"OUTPUT_INTEGRITY",
		"pdf.boxes",
	);
	const resources = page.node.Resources()?.lookup(PDFName.of("Font"), PDFDict),
		embedded: { name: string; programDigest: string; unicodeDigest: string }[] =
			[];
	if (
		artifact.texts.some(
			(t) => t.state === "measured" && t.formattedValue.length > 0,
		)
	)
		requireOutput(resources !== undefined, "OUTPUT_INTEGRITY", "pdf.fonts");
	for (const [, ref] of resources?.entries() ?? []) {
		const font = doc.context.lookup(ref, PDFDict),
			name = font.get(PDFName.of("BaseFont"));
		requireOutput(name instanceof PDFName, "OUTPUT_INTEGRITY", "pdf.fontName");
		const ps = name.decodeText().replace(/^[A-Z]{6}\+/, "");
		requireOutput(
			artifact.model.fonts.some((f) => f.postscriptName === ps),
			"OUTPUT_INTEGRITY",
			"pdf.fontPolicy",
		);
		const desc = font
			.lookup(PDFName.of("DescendantFonts"), PDFArray)
			.lookup(0, PDFDict)
			.lookup(PDFName.of("FontDescriptor"), PDFDict);
		const program = desc.lookup(PDFName.of("FontFile2")),
			unicode = font.lookup(PDFName.of("ToUnicode"));
		requireOutput(
			program instanceof PDFRawStream &&
				program.getContents().length > 0 &&
				unicode instanceof PDFRawStream &&
				unicode.getContents().length > 0,
			"OUTPUT_INTEGRITY",
			"pdf.embeddedFont",
		);
		embedded.push({
			name: ps,
			programDigest: digest(program.getContents()),
			unicodeDigest: digest(unicode.getContents()),
		});
	}
	const task = getDocument({
		data: Uint8Array.from(bytes),
		useSystemFonts: false,
		disableFontFace: true,
	});
	let extracted: string[];
	try {
		const pdf = await task.promise;
		const text = await (await pdf.getPage(1)).getTextContent();
		extracted = text.items.flatMap((i) =>
			"str" in i && i.str.length ? [i.str] : [],
		);
	} finally {
		await task.destroy();
	}
	const lines = artifact.texts.flatMap((t) =>
		t.state === "measured"
			? t.lines.filter((l) => l.value.length > 0).map((l) => l.value)
			: [],
	);
	const actual = extracted.join("");
	requireOutput(
		lines.every((line) => actual.includes(line)),
		"OUTPUT_CONTENT",
		"pdf.exactUnicodeOrWrapSpaces",
	);
	const profile = inspectPdfSrgb(doc);
	return {
		profile,
		boxes,
		embedded,
		textDigest: fingerprint(extracted),
		semanticDigest: fingerprint({ boxes, embedded, extracted, profile }),
	};
}
