import {
	PDFDict,
	PDFDocument,
	PDFName,
	PDFNumber,
	PDFRawStream,
} from "pdf-lib";
import { PNG } from "pngjs";
import { digest, transformed } from "../composition/primitives.js";
import type {
	PrivateArtifact,
	LayoutNode,
} from "../composition/private-model.js";
import type { Paint } from "./private-pdf-content.js";
import type { Box } from "./private-pdf-geometry.js";
import { includesBox, intersects } from "./private-pdf-geometry.js";
import { requireOutput } from "./private-policy.js";
import { boundedPdfStream } from "./private-pdf-streams.js";
import { imagePlacement } from "../composition/private-model.js";

export function verifyPdfPaint(
	doc: PDFDocument,
	paints: readonly Paint[],
	artifact: PrivateArtifact,
	textBoxes: readonly Box[],
): void {
	const pt = 72 / 25.4,
		h = artifact.model.layout.height,
		page = {
			x: 0,
			y: 0,
			width: artifact.model.layout.width * pt,
			height: h * pt,
		};
	const toPdf = (r: Box) => ({
		x: r.x * pt,
		y: (h - r.y - r.height) * pt,
		width: r.width * pt,
		height: r.height * pt,
	});
	const vectors = artifact.model.input.nodes.flatMap((n) => {
		if (!n.visible) return [];
		if (n.kind === "shape")
			return [
				{ box: toPdf(transformed(n.box, n.transform)), colors: [n.fill] },
			];
		if (n.kind !== "overlay") return [];
		const asset = artifact.assets.find((a) => a.binding.ref === n.asset.ref);
		requireOutput(asset !== undefined, "OUTPUT_INTEGRITY", "pdf.vectorAsset");
		if (asset.mime !== "image/svg+xml") return [];
		const colors = [
			...Buffer.from(asset.sourceBase64, "base64")
				.toString()
				.matchAll(/fill="(#[0-9a-fA-F]{6})"/g),
		].map((m) => m[1]);
		return [{ box: toPdf(transformed(n.box, n.transform)), colors }];
	});
	const colorMatches = (actual: readonly number[], hex: string) =>
		[1, 3, 5].every(
			(v, i) =>
				Math.abs(
					(actual[i] ?? NaN) - Number.parseInt(hex.slice(v, v + 2), 16) / 255,
				) < 0.0001,
		);
	const rasterNodes = artifact.model.input.nodes.filter(
		(n): n is Extract<LayoutNode, { kind: "artwork" | "overlay" }> =>
			n.visible && (n.kind === "artwork" || n.kind === "overlay"),
	);
	let images = 0,
		backgrounds = 0;
	for (const paint of paints) {
		if (paint.image === null) {
			if (
				backgrounds === 0 &&
				paint === paints[0] &&
				includesBox(page, paint.box) &&
				includesBox(paint.box, page) &&
				colorMatches(paint.color, artifact.model.layout.background)
			) {
				backgrounds++;
				continue;
			}
			requireOutput(
				!textBoxes.some((b) => intersects(b, paint.box)) &&
					vectors.some(
						(v) =>
							includesBox(v.box, paint.box) &&
							v.colors.some(
								(c) => c !== undefined && colorMatches(paint.color, c),
							),
					),
				"OUTPUT_CONTENT",
				"pdf.unrelatedPaint",
			);
			continue;
		}
		const object = doc
			.getPage(0)
			.node.Resources()
			?.lookup(PDFName.of("XObject"), PDFDict)
			.lookup(PDFName.of(paint.image));
		requireOutput(
			object instanceof PDFRawStream &&
				object.dict.lookup(PDFName.of("Subtype"), PDFName).decodeText() ===
					"Image" &&
				!object.dict.has(PDFName.of("SMask")),
			"OUTPUT_UNSUPPORTED",
			"pdf.nestedXObject",
		);
		const width = object.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber(),
			height = object.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber();
		requireOutput(
			width * height <= 16000000 &&
				object.dict
					.lookup(PDFName.of("BitsPerComponent"), PDFNumber)
					.asNumber() === 8,
			"OUTPUT_LIMIT",
			"pdf.imagePixels",
		);
		const bytes = boundedPdfStream(object, 48000000),
			node = rasterNodes.find((n) => {
				const asset = artifact.assets.find(
					(a) => a.binding.ref === n.asset.ref,
				);
				return (
					asset?.mime === "image/png" &&
					asset.width === width &&
					asset.height === height
				);
			});
		requireOutput(
			node !== undefined &&
				(node.kind === "artwork" || node.kind === "overlay"),
			"OUTPUT_CONTENT",
			"pdf.rasterBinding",
		);
		const asset = artifact.assets.find((a) => a.binding.ref === node.asset.ref);
		requireOutput(asset !== undefined, "OUTPUT_INTEGRITY", "pdf.rasterAsset");
		const png = PNG.sync.read(Buffer.from(asset.sourceBase64, "base64")),
			rgb = Buffer.alloc(width * height * 3);
		for (let i = 0; i < width * height; i++) {
			requireOutput(
				png.data[i * 4 + 3] === 255,
				"OUTPUT_UNSUPPORTED",
				"pdf.sourceAlpha",
			);
			rgb[i * 3] = png.data[i * 4] ?? 0;
			rgb[i * 3 + 1] = png.data[i * 4 + 1] ?? 0;
			rgb[i * 3 + 2] = png.data[i * 4 + 2] ?? 0;
		}
		requireOutput(
			digest(bytes) === digest(rgb),
			"OUTPUT_CONTENT",
			"pdf.rasterPixels",
		);
		const placement = toPdf(
			transformed(imagePlacement(node, asset), node.transform),
		);
		requireOutput(
			includesBox(placement, paint.box) && includesBox(paint.box, placement),
			"OUTPUT_CONTENT",
			"pdf.rasterPlacement",
		);
		images++;
	}
	requireOutput(
		backgrounds === 1 &&
			images === artifact.assets.filter((a) => a.mime === "image/png").length,
		"OUTPUT_CONTENT",
		"pdf.paintInventory",
	);
}
