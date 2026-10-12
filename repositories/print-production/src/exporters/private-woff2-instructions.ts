import { requireOutput } from "./private-policy.js";
class WoffCursor {
	offset = 0;
	constructor(readonly bytes: Buffer) {}
	take(n: number): Buffer {
		requireOutput(
			Number.isInteger(n) && n >= 0 && this.offset + n <= this.bytes.length,
			"OUTPUT_INTEGRITY",
			"pdf.woff2Stream",
		);
		const b = this.bytes.subarray(this.offset, this.offset + n);
		this.offset += n;
		return b;
	}
	byte(): number {
		return this.take(1)[0] ?? 0;
	}
	word(): number {
		return this.take(2).readUInt16BE();
	}
	integer(): number {
		const code = this.byte();
		return code === 253
			? this.word()
			: code === 254
				? 506 + this.byte()
				: code === 255
					? 253 + this.byte()
					: code;
	}
}
export function woffInstructions(glyf: Buffer): ReadonlyMap<number, Buffer> {
	requireOutput(
		glyf.length >= 36 &&
			glyf.readUInt16BE() === 0 &&
			(glyf.readUInt16BE(2) & 0xfffe) === 0,
		"OUTPUT_UNSUPPORTED",
		"pdf.woff2GlyfHeader",
	);
	const count = glyf.readUInt16BE(4);
	requireOutput(count > 0 && count <= 10000, "OUTPUT_LIMIT", "pdf.woff2Glyphs");
	let offset = 36;
	const streams = Array.from({ length: 7 }, (_, i) => {
		const size = glyf.readUInt32BE(8 + 4 * i);
		requireOutput(
			offset + size <= glyf.length,
			"OUTPUT_INTEGRITY",
			"pdf.woff2Substream",
		);
		const c = new WoffCursor(glyf.subarray(offset, offset + size));
		offset += size;
		return c;
	});
	const [contours, points, flags, coordinates, components, , instructions] =
		streams;
	requireOutput(
		contours !== undefined &&
			points !== undefined &&
			flags !== undefined &&
			coordinates !== undefined &&
			components !== undefined &&
			instructions !== undefined,
		"OUTPUT_INTEGRITY",
		"pdf.woff2Streams",
	);
	const result = new Map<number, Buffer>();
	for (let gid = 0; gid < count; gid++) {
		const n = contours.take(2).readInt16BE();
		let size = 0;
		if (n > 0) {
			requireOutput(n <= 10000, "OUTPUT_LIMIT", "pdf.woff2Contours");
			let total = 0;
			for (let c = 0; c < n; c++) total += points.integer();
			requireOutput(total <= 65535, "OUTPUT_LIMIT", "pdf.woff2Points");
			for (let p = 0; p < total; p++) {
				const flag = flags.byte() & 127;
				coordinates.take(flag < 84 ? 1 : flag < 120 ? 2 : flag < 124 ? 3 : 4);
			}
			size = coordinates.integer();
		} else if (n === -1) {
			let component = 0,
				more = true,
				haveInstructions = false;
			while (more) {
				requireOutput(
					++component <= 128,
					"OUTPUT_LIMIT",
					"pdf.woff2Components",
				);
				const f = components.word();
				components.take(
					2 + (f & 1 ? 4 : 2) + (f & 8 ? 2 : f & 64 ? 4 : f & 128 ? 8 : 0),
				);
				more = Boolean(f & 32);
				haveInstructions ||= Boolean(f & 256);
			}
			if (haveInstructions) size = coordinates.integer();
		} else requireOutput(n === 0, "OUTPUT_UNSUPPORTED", "pdf.woff2Contours");
		result.set(gid, instructions.take(size));
	}
	for (const stream of [
		contours,
		points,
		flags,
		coordinates,
		components,
		instructions,
	])
		requireOutput(
			stream.offset === stream.bytes.length,
			"OUTPUT_INTEGRITY",
			"pdf.woff2StreamEnd",
		);
	return result;
}
