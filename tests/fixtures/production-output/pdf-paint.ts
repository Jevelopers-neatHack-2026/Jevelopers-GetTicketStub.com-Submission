import assert from "node:assert/strict";
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import {
	contentStreams,
	boundedPdfStream,
} from "../../../src/exporters/private-pdf-streams.js";

export type PaintAttack = {
	readonly id: string;
	readonly mutate: (doc: PDFDocument, content: string) => void;
};
const content =
	(edit: (s: string) => string): PaintAttack["mutate"] =>
	(doc, source) => {
		const changed = edit(source);
		assert.notEqual(changed, source);
		doc
			.getPage(0)
			.node.set(
				PDFName.of("Contents"),
				doc.context.register(doc.context.flateStream(changed)),
			);
	};
const page =
	(key: string, value: number): PaintAttack["mutate"] =>
	(doc) => {
		doc.getPage(0).node.set(PDFName.of(key), doc.context.obj(value));
	};
const state =
	(key: string, value: number): PaintAttack["mutate"] =>
	(doc) => {
		const states = doc
			.getPage(0)
			.node.Resources()
			?.lookup(PDFName.of("ExtGState"), PDFDict);
		assert.ok(states && states.entries().length);
		for (const [, ref] of states.entries())
			doc.context
				.lookup(ref, PDFDict)
				.set(PDFName.of(key), doc.context.obj(value));
	};
const images =
	(
		edit: (doc: PDFDocument, image: PDFRawStream) => void,
	): PaintAttack["mutate"] =>
	(doc) => {
		let count = 0;
		for (const [, object] of doc.context.enumerateIndirectObjects())
			if (
				object instanceof PDFRawStream &&
				object.dict.get(PDFName.of("Subtype"))?.toString() === "/Image"
			) {
				edit(doc, object);
				count++;
			}
		assert.ok(count);
	};
export const paintAttacks: readonly PaintAttack[] = [
	{
		id: "clip-text-line",
		mutate: content((s) =>
			s.replaceAll("0 0 1200 600 re\nW* n", "0 0 m\n1200 600 l\nW* n"),
		),
	},
	{
		id: "clip-raster-empty",
		mutate: content((s) =>
			s.replace(
				"1200 0 0 -600 0 600 cm",
				"0 0 1 1 re W n\n1200 0 0 -600 0 600 cm",
			),
		),
	},
	{
		id: "wrong-vector-shape",
		mutate: content((s) => s.replace("5 5 90 90 re", "5 5 1 1 re")),
	},
	...(
		[
			"raster-over-text",
			"raster-over-text-partial",
			"raster-over-logo",
		] as const
	).map(
		(id): PaintAttack => ({
			id,
			mutate: content((s) => {
				const block =
					/q\n0 0 1200 600 re\nW\* n\nq\n1200 0 0 -600 0 600 cm[\s\S]*?\/X4 Do\nQ\nQ/.exec(
						s,
					)?.[0];
				assert.ok(block);
				const moved =
					id === "raster-over-text"
						? block
						: block.replace(
								"0 0 1200 600 re",
								id === "raster-over-text-partial"
									? "80 70 600 140 re"
									: "1000 80 100 100 re",
							);
				return s.replace(block, "") + "\n" + moved;
			}),
		}),
	),
	{
		id: "clip-vector-empty",
		mutate: content((s) =>
			s.replace("5 5 90 90 re\nf", "q 5 5 1 1 re W n\n5 5 90 90 re\nf\nQ"),
		),
	},
	{
		id: "clip-degenerate",
		mutate: content((s) =>
			s.replaceAll("0 0 1200 600 re\nW* n", "0 0 1200 0 re\nW* n"),
		),
	},
	{
		id: "missing-vector-paint",
		mutate: content((s) => {
			let count = 0;
			return s.replace(/\bf\*?\b/g, () => (++count === 1 ? "f" : "n"));
		}),
	},
	{ id: "rotate-page", mutate: page("Rotate", 180) },
	{
		id: "invert-image",
		mutate: images((doc, image) =>
			image.dict.set(PDFName.of("Decode"), doc.context.obj([1, 0, 1, 0, 1, 0])),
		),
	},
	{
		id: "transfer-white",
		mutate: (doc) => {
			const states = doc
				.getPage(0)
				.node.Resources()
				?.lookup(PDFName.of("ExtGState"), PDFDict);
			assert.ok(states);
			for (const [, ref] of states.entries())
				doc.context.lookup(ref, PDFDict).set(
					PDFName.of("TR"),
					doc.context.register(
						doc.context.obj({
							FunctionType: 2,
							Domain: [0, 1],
							C0: [1],
							C1: [1],
							N: 1,
						}),
					),
				);
		},
	},
	{
		id: "clip-as-line",
		mutate: content((s) =>
			s.replace(
				/(\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) (\d+(?:\.\d+)?) re\nW\*/,
				(_all, x: string, y: string, w: string, h: string) =>
					`${x} ${y} m\n${+x + +w} ${+y + +h} l\nW*`,
			),
		),
	},
	{
		id: "missing-logo-rectangle",
		mutate: content((s) => s.replace("5 5 90 90 re\nf", "5 5 90 90 re\nn")),
	},
	{
		id: "missing-logo-circle",
		mutate: content((s) => s.replace("h\nf", "h\nn")),
	},
	{
		id: "missing-separator",
		mutate: content((s) => s.replace("7 25 86 .5 re\nf", "7 25 86 .5 re\nn")),
	},
	{
		id: "shift-logo",
		mutate: content((s) => s.replace("5 5 90 90 re", "6 5 90 90 re")),
	},
	{
		id: "change-logo-path",
		mutate: content((s) => s.replace("75 50 m", "74 50 m")),
	},
	{
		id: "change-separator",
		mutate: content((s) => s.replace("7 25 86 .5 re", "7 25 85 .5 re")),
	},
	{
		id: "extra-logo-paint",
		mutate: content((s) =>
			s.replace("5 5 90 90 re\nf", "5 5 90 90 re\nf\n5 5 90 90 re\nf"),
		),
	},
	{
		id: "extra-paint-allowed-color",
		mutate: content((s) => s + "\nq .0745 .298 .4039 rg 20 80 30 1 re f Q\n"),
	},
	{
		id: "vector-wrong-color",
		mutate: content((s) =>
			s.replace("1 1 1 rg\n75 50 m", ".0745 .298 .4039 rg\n75 50 m"),
		),
	},
	{
		id: "changed-image-bytes",
		mutate: images((doc, image) => {
			const bytes = boundedPdfStream(image, 48000000);
			bytes[0] = (bytes[0] ?? 0) ^ 1;
			const replacement = PDFRawStream.of(
				image.dict.clone(),
				doc.context.flateStream(bytes).getContents(),
			);
			for (const [ref, object] of doc.context.enumerateIndirectObjects())
				if (object === image) doc.context.assign(ref, replacement);
		}),
	},
	{ id: "missing-image", mutate: content((s) => s.replace("/X4 Do", "")) },
	{
		id: "extra-image",
		mutate: content((s) => s.replace("/X4 Do", "/X4 Do\n/X4 Do")),
	},
	{
		id: "image-mirror",
		mutate: content((s) =>
			s.replace("1200 0 0 -600 0 600 cm", "-1200 0 0 -600 1200 600 cm"),
		),
	},
	{
		id: "image-shift",
		mutate: content((s) =>
			s.replace("1200 0 0 -600 0 600 cm", "1200 0 0 -600 1 600 cm"),
		),
	},
	{
		id: "image-colorspace",
		mutate: images((_doc, image) =>
			image.dict.set(PDFName.of("ColorSpace"), PDFName.of("DeviceGray")),
		),
	},
	{
		id: "image-mask",
		mutate: images((doc, image) =>
			image.dict.set(
				PDFName.of("Mask"),
				doc.context.obj([0, 255, 0, 255, 0, 255]),
			),
		),
	},
	{
		id: "image-interpolation",
		mutate: images((doc, image) =>
			image.dict.set(PDFName.of("Interpolate"), doc.context.obj(true)),
		),
	},
	{ id: "alpha-fill", mutate: state("ca", 0.1) },
	{ id: "alpha-stroke", mutate: state("CA", 0.1) },
	{
		id: "blend",
		mutate: (doc) => {
			const states = doc
				.getPage(0)
				.node.Resources()
				?.lookup(PDFName.of("ExtGState"), PDFDict);
			assert.ok(states);
			for (const [, ref] of states.entries())
				doc.context
					.lookup(ref, PDFDict)
					.set(PDFName.of("BM"), PDFName.of("Multiply"));
		},
	},
	{
		id: "transfer-secondary",
		mutate: (doc) => {
			const states = doc
				.getPage(0)
				.node.Resources()
				?.lookup(PDFName.of("ExtGState"), PDFDict);
			assert.ok(states);
			for (const [, ref] of states.entries())
				doc.context
					.lookup(ref, PDFDict)
					.set(PDFName.of("TR2"), PDFName.of("Default"));
		},
	},
	{ id: "page-rotate-90", mutate: page("Rotate", 90) },
	{ id: "page-unit", mutate: page("UserUnit", 2) },
	{
		id: "inherited-rotate",
		mutate: (doc) => {
			const parent = doc.getPage(0).node.Parent();
			assert.ok(parent);
			parent.set(PDFName.of("Rotate"), doc.context.obj(180));
		},
	},
	{
		id: "inherited-matrix",
		mutate: content((s) => "-1 0 0 -1 288 144 cm\n" + s),
	},
	{
		id: "clip-shrink",
		mutate: content((s) =>
			s.replace("0 0 1200 600 re\nW*", "0 0 600 600 re\nW*"),
		),
	},
	{ id: "clip-winding", mutate: content((s) => s.replace("W* n", "W n")) },
	{
		id: "state-reset",
		mutate: content((s) => s.replace("Q\nQ\nq", "Q\nQ\nq\n1 0 0 rg")),
	},
	{
		id: "optional-content",
		mutate: (doc) =>
			doc.catalog.set(
				PDFName.of("OCProperties"),
				doc.context.obj({ D: { BaseState: "OFF" } }),
			),
	},
];
export async function mutatePaint(
	bytes: Uint8Array,
	attack: PaintAttack,
): Promise<Uint8Array> {
	const doc = await PDFDocument.load(bytes, { updateMetadata: false });
	const stream = contentStreams(doc)[0];
	assert.ok(stream);
	attack.mutate(doc, stream.toString("latin1"));
	return doc.save({ useObjectStreams: false });
}
