import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { requireOutput } from "./private-policy.js";
export function boundedPdfStream(stream: PDFRawStream, limit: number): Buffer {
	requireOutput(
		stream.getContents().length <= limit,
		"OUTPUT_LIMIT",
		"pdf.compressedBytes",
	);
	const filter = stream.dict.get(PDFName.of("Filter"));
	requireOutput(
		!stream.dict.has(PDFName.of("DecodeParms")),
		"OUTPUT_UNSUPPORTED",
		"pdf.decodeParms",
	);
	if (filter === undefined) return Buffer.from(stream.getContents());
	requireOutput(
		filter instanceof PDFName && filter.decodeText() === "FlateDecode",
		"OUTPUT_UNSUPPORTED",
		"pdf.filter",
	);
	try {
		return inflateSync(stream.getContents(), { maxOutputLength: limit });
	} catch (error) {
		if (error instanceof Error) {
			requireOutput(false, "OUTPUT_INTEGRITY", "pdf.inflate");
		}
		throw error;
	}
}
export function contentStreams(doc: PDFDocument): readonly Buffer[] {
	const value = doc.getPage(0).node.Contents(),
		refs =
			value instanceof PDFArray
				? value.asArray()
				: value === undefined
					? []
					: [value];
	requireOutput(refs.length === 1, "OUTPUT_UNSUPPORTED", "pdf.contentStreams");
	return refs.map((ref) => {
		const stream = doc.context.lookup(ref);
		requireOutput(
			stream instanceof PDFRawStream,
			"OUTPUT_INTEGRITY",
			"pdf.contentStream",
		);
		return boundedPdfStream(stream, 2000000);
	});
}
