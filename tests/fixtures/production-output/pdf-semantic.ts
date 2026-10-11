import assert from "node:assert/strict";
import { PDFDocument, PDFRawStream, PDFName } from "pdf-lib";
import {
	boundedPdfStream,
	contentStreams,
} from "../../../src/exporters/private-pdf-streams.js";
export async function changeContent(
	bytes: Uint8Array,
	edit: (text: string) => string,
): Promise<Uint8Array> {
	const doc = await PDFDocument.load(bytes, { updateMetadata: false }),
		source = contentStreams(doc)[0];
	assert.ok(source);
	const updated = edit(source.toString("latin1"));
	assert.notEqual(updated, source.toString("latin1"));
	const stream = doc.context.flateStream(updated);
	doc.getPage(0).node.set(PDFName.of("Contents"), doc.context.register(stream));
	return doc.save({ useObjectStreams: false });
}
export async function changeCmap(
	bytes: Uint8Array,
	edit: (text: string) => string,
): Promise<Uint8Array> {
	const doc = await PDFDocument.load(bytes, { updateMetadata: false });
	let changed = false;
	for (const [ref, object] of doc.context.enumerateIndirectObjects())
		if (
			object instanceof PDFRawStream &&
			!object.dict.has(PDFName.of("ColorSpace"))
		) {
			const raw = boundedPdfStream(object, 2000000);
			if (raw.toString("ascii").includes("begincmap")) {
				const old = raw.toString("ascii"),
					updated = edit(old);
				if (updated !== old) {
					doc.context.assign(ref, doc.context.flateStream(updated));
					changed = true;
					break;
				}
			}
		}
	assert.ok(changed);
	return doc.save({ useObjectStreams: false });
}
