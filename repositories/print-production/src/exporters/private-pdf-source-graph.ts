import {
	PDFArray,
	PDFBool,
	PDFDict,
	PDFHexString,
	PDFName,
	PDFNull,
	PDFNumber,
	PDFRawStream,
	PDFRef,
	PDFString,
} from "pdf-lib";
import type { PDFDocument, PDFObject } from "pdf-lib";
import { digest, fingerprint } from "../composition/primitives.js";
import { requireOutput } from "./private-policy.js";
import { boundedPdfStream } from "./private-pdf-streams.js";

export function pdfSourceGraph(doc: PDFDocument): string {
	requireOutput(
		doc.context.enumerateIndirectObjects().length <= 4096,
		"OUTPUT_LIMIT",
		"pdf.graphObjects",
	);
	let visits = 0,
		decodedBytes = 0;
	const active = new Set<PDFObject>();
	const resolve = (value: PDFObject): PDFObject => {
		const result = value instanceof PDFRef ? doc.context.lookup(value) : value;
		requireOutput(
			result !== undefined,
			"OUTPUT_INTEGRITY",
			"pdf.graphReference",
		);
		return result;
	};
	const walk = (value: PDFObject, depth: number): string => {
		requireOutput(
			++visits <= 20000 && depth <= 32,
			"OUTPUT_LIMIT",
			"pdf.graphDepth",
		);
		const object = resolve(value);
		requireOutput(!active.has(object), "OUTPUT_UNSUPPORTED", "pdf.graphCycle");
		active.add(object);
		let result: string;
		if (object instanceof PDFRawStream) {
			const bytes = boundedPdfStream(object, 48000000);
			decodedBytes += bytes.length;
			requireOutput(decodedBytes <= 64000000, "OUTPUT_LIMIT", "pdf.graphBytes");
			const dictionary = object.dict.clone();
			// Length describes encoded storage, not painting. Filter and DecodeParms
			// remain bound; boundedPdfStream rejects unsupported encodings.
			dictionary.delete(PDFName.of("Length"));
			result = fingerprint([
				"stream",
				walk(dictionary, depth + 1),
				digest(bytes),
			]);
		} else if (object instanceof PDFDict) {
			result = fingerprint([
				"dict",
				object
					.entries()
					.sort(([a], [b]) => a.toString().localeCompare(b.toString(), "en"))
					.map(([key, child]) => {
						const name = key.toString();
						decodedBytes += name.length;
						requireOutput(
							decodedBytes <= 64000000,
							"OUTPUT_LIMIT",
							"pdf.graphBytes",
						);
						return [name, walk(child, depth + 1)];
					}),
			]);
		} else if (object instanceof PDFArray) {
			result = fingerprint([
				"array",
				object.asArray().map((v) => walk(v, depth + 1)),
			]);
		} else {
			requireOutput(
				object === PDFNull ||
					object instanceof PDFBool ||
					object instanceof PDFName ||
					object instanceof PDFNumber ||
					object instanceof PDFString ||
					object instanceof PDFHexString,
				"OUTPUT_UNSUPPORTED",
				"pdf.graphObject",
			);
			if (object instanceof PDFNumber)
				requireOutput(
					Number.isFinite(object.asNumber()),
					"OUTPUT_INTEGRITY",
					"pdf.graphNumber",
				);
			const scalar = object.toString();
			decodedBytes += scalar.length;
			requireOutput(decodedBytes <= 64000000, "OUTPUT_LIMIT", "pdf.graphBytes");
			result = fingerprint(["scalar", scalar]);
		}
		active.delete(object);
		return result;
	};
	const catalog = doc.catalog.clone(),
		page = PDFDict.withContext(doc.context);
	let node = resolve(doc.catalog.get(PDFName.of("Pages")) ?? PDFNull);
	const ancestors = new Set<PDFObject>();
	let parent: PDFObject | undefined;
	for (let depth = 0; ; depth++) {
		requireOutput(
			depth <= 32 && node instanceof PDFDict && !ancestors.has(node),
			"OUTPUT_UNSUPPORTED",
			"pdf.pageTree",
		);
		ancestors.add(node);
		const parentValue = node.get(PDFName.of("Parent"));
		requireOutput(
			parentValue === undefined
				? parent === undefined
				: resolve(parentValue) === parent,
			"OUTPUT_INTEGRITY",
			"pdf.pageParent",
		);
		const type = node.lookup(PDFName.of("Type"));
		requireOutput(type instanceof PDFName, "OUTPUT_INTEGRITY", "pdf.pageType");
		if (type.decodeText() === "Page") {
			for (const [key, value] of node.entries())
				if (key.decodeText() !== "Parent") page.set(key, value);
			break;
		}
		requireOutput(
			type.decodeText() === "Pages",
			"OUTPUT_UNSUPPORTED",
			"pdf.pageType",
		);
		for (const [key, value] of node.entries()) {
			const name = key.decodeText();
			requireOutput(
				[
					"Type",
					"Count",
					"Kids",
					"Parent",
					"Resources",
					"MediaBox",
					"CropBox",
					"Rotate",
				].includes(name),
				"OUTPUT_UNSUPPORTED",
				"pdf.pageInheritance",
			);
			if (["Resources", "MediaBox", "CropBox", "Rotate"].includes(name))
				page.set(key, value);
		}
		const count = node.lookup(PDFName.of("Count")),
			kids = node.lookup(PDFName.of("Kids"));
		requireOutput(
			count instanceof PDFNumber &&
				count.asNumber() === 1 &&
				kids instanceof PDFArray &&
				kids.size() === 1,
			"OUTPUT_UNSUPPORTED",
			"pdf.pageInventory",
		);
		parent = node;
		node = resolve(kids.get(0));
	}
	catalog.delete(PDFName.of("Pages"));
	return fingerprint({ catalog: walk(catalog, 0), page: walk(page, 0) });
}
