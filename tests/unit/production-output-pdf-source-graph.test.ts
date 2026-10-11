import { test } from "node:test";
import assert from "node:assert/strict";
import {
	PDFDocument,
	PDFDict,
	PDFName,
	PDFRawStream,
	PDFRef,
	PDFString,
} from "pdf-lib";
import { deflateSync } from "node:zlib";
import { pdfSourceGraph } from "../../src/exporters/private-pdf-source-graph.js";
import { checkPdfEnvelope } from "../../src/exporters/private-pdf-envelope.js";
import {
	OutputError,
	resolveOutputPolicy,
	defaultOutputPolicy,
} from "../../src/exporters/private-policy.js";

test("paint graph is independent of object numbers and encoded compression but binds exact values", async () => {
	const a = await PDFDocument.create(),
		b = await PDFDocument.create();
	a.addPage([288, 144]);
	b.context.register(b.context.obj({ Unused: 1 }));
	b.addPage([288, 144]);
	const paint = Buffer.from("q 1 0 0 rg 0 0 10 10 re f Q\n".repeat(1000));
	const dictionary = (doc: PDFDocument) =>
		doc.context.obj({ Filter: "FlateDecode" });
	const compressedA = deflateSync(paint, { level: 1 }),
		compressedB = deflateSync(paint, { level: 9 });
	assert.notDeepEqual(compressedA, compressedB);
	a.getPage(0).node.set(
		PDFName.of("Contents"),
		a.context.register(PDFRawStream.of(dictionary(a), compressedA)),
	);
	b.getPage(0).node.set(
		PDFName.of("Contents"),
		b.context.register(PDFRawStream.of(dictionary(b), compressedB)),
	);
	assert.equal(pdfSourceGraph(a), pdfSourceGraph(b));
	b.getPage(0).node.set(PDFName.of("Rotate"), b.context.obj(180));
	assert.notEqual(pdfSourceGraph(a), pdfSourceGraph(b));
});
test("rejects cycles, unresolved references and excessive graph depth", async () => {
	for (const kind of ["cycle", "depth", "page-cycle", "unresolved"] as const) {
		const doc = await PDFDocument.create();
		doc.addPage([288, 144]);
		const leaf = doc.getPage(0).node;
		const root = PDFDict.withContext(doc.context);
		if (kind === "cycle")
			root.set(PDFName.of("Again"), doc.context.register(root));
		else if (kind === "depth") {
			let node = root;
			for (let n = 0; n < 34; n++) {
				const child = PDFDict.withContext(doc.context);
				node.set(PDFName.of("Next"), child);
				node = child;
			}
		} else if (kind === "unresolved")
			root.set(PDFName.of("Missing"), PDFRef.of(999));
		else {
			const pages = doc.catalog.lookup(PDFName.of("Pages"), PDFDict);
			pages.set(
				PDFName.of("Kids"),
				doc.context.obj([doc.catalog.get(PDFName.of("Pages"))]),
			);
		}
		leaf.set(PDFName.of("Resources"), root);
		assert.throws(
			() => pdfSourceGraph(doc),
			(e) => e instanceof OutputError,
		);
	}
});
test("rejects unsupported stream decode, graph decompression and object inventory excess", async () => {
	const doc = await PDFDocument.create();
	doc.addPage([288, 144]);
	const stream = doc.context.flateStream("q Q");
	stream.dict.set(
		PDFName.of("DecodeParms"),
		doc.context.obj({ Predictor: 12 }),
	);
	doc.getPage(0).node.set(PDFName.of("Contents"), doc.context.register(stream));
	assert.throws(
		() => pdfSourceGraph(doc),
		(e) => e instanceof OutputError,
	);
	for (let i = 0; i < 4097; i++)
		doc.context.register(doc.context.obj({ Index: i }));
	assert.throws(
		() => pdfSourceGraph(doc),
		(e) => e instanceof OutputError && e.path === "pdf.graphObjects",
	);
	const bomb = doc.context.flateStream(new Uint8Array(48000001));
	doc
		.getPage(0)
		.node.set(
			PDFName.of("Contents"),
			doc.context.register(PDFRawStream.of(bomb.dict, bomb.getContents())),
		);
	assert.throws(
		() => pdfSourceGraph(doc),
		(e) => e instanceof OutputError,
	);
});
test("rejects stale output and inspector policy identities", () => {
	assert.throws(() =>
		resolveOutputPolicy({
			...defaultOutputPolicy,
			revision: "private-output-2",
		}),
	);
	assert.throws(() =>
		resolveOutputPolicy({
			...defaultOutputPolicy,
			pdfSemanticInspector:
				"private-pdf-semantic-1_chromium-156_pdf-lib-1.17.1_fontkit-2.0.4",
		}),
	);
});

test("bounds repeated large resolved scalar values as well as decoded stream bytes", async () => {
	const doc = await PDFDocument.create();
	doc.addPage([288, 144]);
	const value = doc.context.register(PDFString.of("x".repeat(1000000)));
	doc
		.getPage(0)
		.node.set(
			PDFName.of("Resources"),
			doc.context.obj({ Repeated: Array.from({ length: 65 }, () => value) }),
		);
	assert.throws(
		() => pdfSourceGraph(doc),
		(e) => e instanceof OutputError && e.path === "pdf.graphBytes",
	);
});

test("bounds the raw envelope before parser recovery or recursive object parsing", async () => {
	const doc = await PDFDocument.create();
	doc.addPage([288, 144]);
	const bytes = await doc.save({ useObjectStreams: false });
	checkPdfEnvelope(bytes);
	const raw = Buffer.from(bytes).toString("latin1");
	const nestedTrailer = Buffer.from(
		raw.replace("\ntrailer\n", `\ntrailer\n${"[".repeat(33)}${"]".repeat(33)}`),
		"latin1",
	);
	assert.throws(
		() => checkPdfEnvelope(nestedTrailer),
		(e) => e instanceof OutputError && e.path === "pdf.envelopeDepth",
	);
	for (const changed of [
		raw + "\n%%EOF",
		raw.replace(/xref\n0 \d+\n/, "xref\n0 4098\n"),
		raw.replace("00000 n \n", "00001 n \n"),
	])
		assert.throws(
			() => checkPdfEnvelope(Buffer.from(changed, "latin1")),
			(e) => e instanceof OutputError,
		);
});
