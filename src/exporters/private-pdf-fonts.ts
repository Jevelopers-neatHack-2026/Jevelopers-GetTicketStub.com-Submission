import {
	PDFArray,
	PDFDict,
	PDFDocument,
	PDFName,
	PDFNumber,
	PDFRawStream,
} from "pdf-lib";
import { create } from "fontkit";
import type { Font } from "fontkit";
import type { PrivateArtifact } from "../composition/private-model.js";
import { digest, fingerprint } from "../composition/primitives.js";
import { requireOutput } from "./private-policy.js";
import { boundedPdfStream } from "./private-pdf-streams.js";
import { readCmap } from "./private-pdf-cmap.js";
import { verifyFontProgram } from "./private-pdf-font-program.js";
import { checkSfntStructure } from "./private-sfnt.js";
export type SemanticFont = {
	readonly source: Font;
	readonly embedded: Font;
	readonly sourceDigest: string;
	readonly programDigest: string;
	readonly cmap: ReadonlyMap<number, string>;
	readonly intrinsic: ReadonlyMap<number, string>;
	readonly gid: (cid: number) => number;
	readonly width: (cid: number) => number;
};
function stream(dict: PDFDict, key: string): PDFRawStream {
	const value = dict.lookup(PDFName.of(key));
	requireOutput(
		value instanceof PDFRawStream,
		"OUTPUT_INTEGRITY",
		"pdf.fontStream",
	);
	return value;
}
export function readSemanticFonts(
	doc: PDFDocument,
	artifact: PrivateArtifact,
): ReadonlyMap<string, SemanticFont> {
	const resources = doc
		.getPage(0)
		.node.Resources()
		?.lookup(PDFName.of("Font"), PDFDict);
	requireOutput(
		resources !== undefined,
		"OUTPUT_INTEGRITY",
		"pdf.fontResources",
	);
	requireOutput(
		resources.entries().length <= 16,
		"OUTPUT_LIMIT",
		"pdf.fontCount",
	);
	const fonts = new Map<string, SemanticFont>();
	for (const [resource, ref] of resources.entries()) {
		const top = doc.context.lookup(ref, PDFDict);
		requireOutput(
			top.lookup(PDFName.of("Subtype"), PDFName).decodeText() === "Type0" &&
				top.lookup(PDFName.of("Encoding"), PDFName).decodeText() ===
					"Identity-H",
			"OUTPUT_UNSUPPORTED",
			"pdf.fontDialect",
		);
		const descendants = top.lookup(PDFName.of("DescendantFonts"), PDFArray);
		requireOutput(
			descendants.size() === 1,
			"OUTPUT_UNSUPPORTED",
			"pdf.descendantCount",
		);
		const cidFont = descendants.lookup(0, PDFDict);
		requireOutput(
			cidFont.lookup(PDFName.of("Subtype"), PDFName).decodeText() ===
				"CIDFontType2",
			"OUTPUT_UNSUPPORTED",
			"pdf.fontSubtype",
		);
		const name = top
				.lookup(PDFName.of("BaseFont"), PDFName)
				.decodeText()
				.replace(/^[A-Z]{6}\+/, ""),
			pin = artifact.fontBytes.find(
				(f) => f.descriptor.postscriptName === name,
			);
		requireOutput(pin !== undefined, "OUTPUT_INTEGRITY", "pdf.approvedFont");
		const descriptor = cidFont.lookup(PDFName.of("FontDescriptor"), PDFDict),
			program = boundedPdfStream(stream(descriptor, "FontFile2"), 2000000),
			original = create(Buffer.from(pin.base64, "base64")),
			embedded = (checkSfntStructure(program), create(program));
		requireOutput(
			"layout" in original &&
				"layout" in embedded &&
				original.unitsPerEm === embedded.unitsPerEm &&
				embedded.numGlyphs <= original.numGlyphs,
			"OUTPUT_INTEGRITY",
			"pdf.fontProgram",
		);
		const intrinsic = new Map<number, string>();
		for (const cp of original.characterSet) {
			const id = original.glyphForCodePoint(cp).id;
			if (!intrinsic.has(id)) intrinsic.set(id, String.fromCodePoint(cp));
		}
		const cmap = readCmap(boundedPdfStream(stream(top, "ToUnicode"), 200000));
		const mapping = cidFont.lookup(PDFName.of("CIDToGIDMap"));
		requireOutput(
			mapping instanceof PDFName && mapping.decodeText() === "Identity",
			"OUTPUT_UNSUPPORTED",
			"pdf.cidToGid",
		);
		const widths = new Map<number, number>(),
			w = cidFont.lookupMaybe(PDFName.of("W"), PDFArray),
			defaultWidth =
				cidFont.lookupMaybe(PDFName.of("DW"), PDFNumber)?.asNumber() ?? 1000;
		if (w)
			for (let i = 0; i < w.size(); ) {
				const start = w.lookup(i++, PDFNumber).asNumber(),
					next = w.lookup(i++);
				if (next instanceof PDFArray) {
					for (let j = 0; j < next.size(); j++)
						widths.set(start + j, next.lookup(j, PDFNumber).asNumber());
				} else {
					requireOutput(
						next instanceof PDFNumber,
						"OUTPUT_INTEGRITY",
						"pdf.widthRange",
					);
					const end = next.asNumber(),
						width = w.lookup(i++, PDFNumber).asNumber();
					requireOutput(end - start <= 10000, "OUTPUT_LIMIT", "pdf.widthRange");
					for (let j = start; j <= end; j++) widths.set(j, width);
				}
			}
		for (let id = 1; id < embedded.numGlyphs; id++) {
			const glyph = embedded.getGlyph(id);
			if (glyph.path.commands.length === 0 && glyph.advanceWidth === 0)
				continue;
			const source = original.getGlyph(id);
			requireOutput(
				fingerprint(glyph.path.commands) ===
					fingerprint(source.path.commands) &&
					glyph.advanceWidth === source.advanceWidth,
				"OUTPUT_INTEGRITY",
				"pdf.fontOutline",
			);
		}
		verifyFontProgram(program, embedded, {
			font: original,
			bytes: Buffer.from(pin.base64, "base64"),
		});
		for (const [cid, value] of cmap) {
			const expected = intrinsic.get(cid) ?? "\u0000";
			requireOutput(
				value === expected &&
					(widths.get(cid) ?? defaultWidth) ===
						(original.getGlyph(cid).advanceWidth * 1000) / original.unitsPerEm,
				"OUTPUT_CONTENT",
				"pdf.toUnicodeIntrinsic",
			);
		}
		fonts.set(resource.decodeText(), {
			source: original,
			embedded,
			sourceDigest: pin.descriptor.digest,
			programDigest: digest(program),
			intrinsic,
			cmap,
			gid: (cid) => cid,
			width: (cid) => widths.get(cid) ?? defaultWidth,
		});
	}
	return fonts;
}
