import {
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFRawStream,
	decodePDFRawStream,
} from "pdf-lib";
import { digest } from "../composition/primitives.js";
import { requireOutput } from "./private-policy.js";
export const skiaSrgbDigest =
	"d9f822e8083f2f4d1c91e887454be5f75e8c7144b2853408f361e3c4a7a6b36d";
function inspectProfile(stream: PDFRawStream): string {
	const bytes = Buffer.from(decodePDFRawStream(stream).decode());
	requireOutput(
		bytes.length === 536 &&
			bytes.readUInt32BE() === bytes.length &&
			bytes.toString("ascii", 36, 40) === "acsp" &&
			bytes.toString("ascii", 16, 20) === "RGB " &&
			digest(bytes) === skiaSrgbDigest,
		"OUTPUT_UNSUPPORTED",
		"pdf.srgbProfilePin",
	);
	return digest(bytes);
}
export function bindPdfSrgb(doc: PDFDocument): void {
	const found = doc.context
		.enumerateIndirectObjects()
		.find(
			([, object]) =>
				object instanceof PDFRawStream && object.dict.has(PDFName.of("N")),
		);
	requireOutput(
		found !== undefined && found[1] instanceof PDFRawStream,
		"OUTPUT_UNSUPPORTED",
		"pdf.srgbMissing",
	);
	inspectProfile(found[1]);
	const resources = doc.getPage(0).node.Resources();
	requireOutput(resources !== undefined, "OUTPUT_INTEGRITY", "pdf.resources");
	const spaces =
		resources.lookupMaybe(PDFName.of("ColorSpace"), PDFDict) ??
		doc.context.obj({});
	spaces.set(
		PDFName.of("DefaultRGB"),
		doc.context.obj([PDFName.of("ICCBased"), found[0]]),
	);
	resources.set(PDFName.of("ColorSpace"), spaces);
}
export function inspectPdfSrgb(doc: PDFDocument) {
	const spaces = doc
		.getPage(0)
		.node.Resources()
		?.lookup(PDFName.of("ColorSpace"), PDFDict);
	requireOutput(spaces !== undefined, "OUTPUT_INTEGRITY", "pdf.defaultRGB");
	const defaultRgb = spaces.lookup(PDFName.of("DefaultRGB"), PDFArray);
	requireOutput(
		defaultRgb.lookup(0, PDFName).decodeText() === "ICCBased",
		"OUTPUT_UNSUPPORTED",
		"pdf.defaultRGB",
	);
	const profileDigest = inspectProfile(defaultRgb.lookup(1, PDFRawStream));
	for (const [, object] of doc.context.enumerateIndirectObjects())
		if (
			object instanceof PDFRawStream &&
			object.dict.has(PDFName.of("ColorSpace"))
		) {
			const color = object.dict.lookup(PDFName.of("ColorSpace"));
			if (color instanceof PDFName)
				requireOutput(
					color.decodeText() === "DeviceRGB" ||
						color.decodeText() === "DeviceGray",
					"OUTPUT_UNSUPPORTED",
					"pdf.imageColor",
				);
			else {
				requireOutput(
					color instanceof PDFArray &&
						color.lookup(0, PDFName).decodeText() === "ICCBased",
					"OUTPUT_UNSUPPORTED",
					"pdf.imageColor",
				);
				inspectProfile(color.lookup(1, PDFRawStream));
			}
		}
	return {
		profileDigest,
		vectorColors: "ICC-default-RGB",
		imageColors: "ICC-sRGB-or-gray",
		pdfStandard: "plain-pdf",
	};
}
