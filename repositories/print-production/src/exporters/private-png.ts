import { crc32 } from "node:zlib";
import { PNG } from "pngjs";
import { digest, fingerprint } from "../composition/primitives.js";
import type { OutputPolicy } from "./private-policy.js";
import { requireOutput } from "./private-policy.js";

function chunk(type: string, data: Uint8Array): Buffer {
	const bytes = Buffer.alloc(data.length + 12);
	bytes.writeUInt32BE(data.length);
	bytes.write(type, 4, "ascii");
	bytes.set(data, 8);
	bytes.writeUInt32BE(
		crc32(bytes.subarray(4, bytes.length - 4)),
		bytes.length - 4,
	);
	return bytes;
}
export function normalizePng(raw: Uint8Array, dpi: number): Buffer {
	const decoded = PNG.sync.read(Buffer.from(raw));
	const encoded = PNG.sync.write(decoded, { colorType: 2, inputColorType: 6 });
	const physical = Buffer.alloc(9);
	physical.writeUInt32BE(Math.round(dpi / 0.0254), 0);
	physical.writeUInt32BE(Math.round(dpi / 0.0254), 4);
	physical[8] = 1;
	return Buffer.concat([
		encoded.subarray(0, 33),
		chunk("sRGB", Uint8Array.of(0)),
		chunk("pHYs", physical),
		encoded.subarray(33),
	]);
}
export function inspectPng(
	bytes: Uint8Array,
	expected: {
		readonly widthMm: number;
		readonly heightMm: number;
		readonly policy: OutputPolicy;
		readonly pixelDigest: string;
	},
) {
	const b = Buffer.from(bytes),
		{ policy } = expected;
	requireOutput(
		b.length <= policy.maxBytes &&
			b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
		"OUTPUT_INTEGRITY",
		"png.signature",
	);
	let offset = 8;
	const chunks = new Map<string, Buffer[]>();
	while (offset < b.length) {
		requireOutput(offset + 12 <= b.length, "OUTPUT_INTEGRITY", "png.chunk");
		const size = b.readUInt32BE(offset),
			end = offset + 12 + size,
			type = b.toString("ascii", offset + 4, offset + 8);
		requireOutput(
			end <= b.length &&
				crc32(b.subarray(offset + 4, end - 4)) === b.readUInt32BE(end - 4),
			"OUTPUT_INTEGRITY",
			"png.crc",
		);
		requireOutput(
			["IHDR", "sRGB", "pHYs", "IDAT", "IEND"].includes(type),
			"OUTPUT_UNSUPPORTED",
			"png.chunkType",
		);
		chunks.set(type, [
			...(chunks.get(type) ?? []),
			b.subarray(offset + 8, end - 4),
		]);
		offset = end;
	}
	const header = chunks.get("IHDR")?.[0];
	requireOutput(
		header !== undefined &&
			header.length === 13 &&
			chunks.get("IHDR")?.length === 1,
		"OUTPUT_INTEGRITY",
		"png.header",
	);
	const width = header.readUInt32BE(),
		height = header.readUInt32BE(4);
	requireOutput(
		width === Math.round((expected.widthMm * policy.dpi) / 25.4) &&
			height === Math.round((expected.heightMm * policy.dpi) / 25.4) &&
			width * height <= policy.maxPixels,
		"OUTPUT_INTEGRITY",
		"png.dimensions",
	);
	const physical = chunks.get("pHYs")?.[0],
		profile = chunks.get("sRGB")?.[0];
	requireOutput(
		physical !== undefined &&
			physical.length === 9 &&
			physical[8] === 1 &&
			physical.readUInt32BE() === Math.round(policy.dpi / 0.0254) &&
			physical.readUInt32BE(4) === Math.round(policy.dpi / 0.0254) &&
			chunks.get("pHYs")?.length === 1,
		"OUTPUT_INTEGRITY",
		"png.dpi",
	);
	requireOutput(
		profile?.length === 1 &&
			profile[0] === 0 &&
			chunks.get("sRGB")?.length === 1 &&
			chunks.get("IEND")?.length === 1,
		"OUTPUT_INTEGRITY",
		"png.profile",
	);
	const decoded = PNG.sync.read(b);
	requireOutput(
		digest(decoded.data) === expected.pixelDigest,
		"OUTPUT_CONTENT",
		"png.pixels",
	);
	for (let i = 3; i < decoded.data.length; i += 4)
		requireOutput(decoded.data[i] === 255, "OUTPUT_INTEGRITY", "png.alpha");
	return {
		width,
		height,
		pixelDigest: digest(decoded.data),
		physicalDigest: digest(physical),
		semanticDigest: fingerprint({
			width,
			height,
			pixels: digest(decoded.data),
			dpi: policy.dpi,
			profile: "srgb",
		}),
	};
}
