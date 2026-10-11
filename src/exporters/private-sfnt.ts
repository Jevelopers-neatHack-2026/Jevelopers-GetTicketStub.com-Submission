import { requireOutput } from "./private-policy.js";
export function sfntTables(
	bytes: Uint8Array,
	reference = false,
): ReadonlyMap<string, Buffer> {
	const b = Buffer.from(bytes);
	requireOutput(
		b.length >= 12 &&
			b.length <= 2000000 &&
			(b.readUInt32BE() === 0x00010000 ||
				(reference && b.readUInt32BE() === 0x74727565)),
		"OUTPUT_UNSUPPORTED",
		"pdf.sfntHeader",
	);
	const count = b.readUInt16BE(4);
	requireOutput(
		count > 0 && count <= 32 && 12 + count * 16 <= b.length,
		"OUTPUT_LIMIT",
		"pdf.sfntTables",
	);
	const result = new Map<string, Buffer>();
	for (let i = 0; i < count; i++) {
		const p = 12 + i * 16,
			name = b.toString("ascii", p, p + 4),
			checksum = b.readUInt32BE(p + 4),
			offset = b.readUInt32BE(p + 8),
			length = b.readUInt32BE(p + 12);
		requireOutput(
			!result.has(name) &&
				offset >= 12 + count * 16 &&
				offset + length <= b.length,
			"OUTPUT_INTEGRITY",
			"pdf.sfntTableRange",
		);
		const data = b.subarray(offset, offset + length);
		let sum = 0;
		for (let j = 0; j < data.length; j += 4) {
			let v = 0;
			for (let k = 0; k < 4; k++)
				v =
					(v * 256 +
						(name === "head" && j + k >= 8 && j + k < 12
							? 0
							: (data[j + k] ?? 0))) >>>
					0;
			sum = (sum + v) >>> 0;
		}
		requireOutput(
			reference || sum === checksum,
			"OUTPUT_INTEGRITY",
			"pdf.sfntChecksum",
		);
		result.set(name, data);
	}
	return result;
}
export function glyphInstructions(
	t: ReadonlyMap<string, Buffer>,
	gid: number,
): Buffer {
	const head = t.get("head"),
		loca = t.get("loca"),
		glyf = t.get("glyf");
	requireOutput(
		head !== undefined &&
			head.length >= 54 &&
			loca !== undefined &&
			glyf !== undefined,
		"OUTPUT_INTEGRITY",
		"pdf.glyfTables",
	);
	const long = head.readInt16BE(50) === 1,
		unit = long ? 4 : 2;
	requireOutput(
		(gid + 2) * unit <= loca.length,
		"OUTPUT_INTEGRITY",
		"pdf.locaIndex",
	);
	const start = long
			? loca.readUInt32BE(gid * unit)
			: loca.readUInt16BE(gid * unit) * 2,
		end = long
			? loca.readUInt32BE((gid + 1) * unit)
			: loca.readUInt16BE((gid + 1) * unit) * 2;
	requireOutput(
		end >= start && end <= glyf.length,
		"OUTPUT_INTEGRITY",
		"pdf.glyfRange",
	);
	if (end === start) return Buffer.alloc(0);
	const g = glyf.subarray(start, end);
	requireOutput(g.length >= 10, "OUTPUT_INTEGRITY", "pdf.glyfHeader");
	const contours = g.readInt16BE();
	let offset = 10,
		flags = 0;
	if (contours >= 0) {
		requireOutput(contours <= 10000, "OUTPUT_LIMIT", "pdf.contours");
		offset += contours * 2;
	} else {
		let components = 0;
		do {
			requireOutput(
				++components <= 128 && offset + 4 <= g.length,
				"OUTPUT_LIMIT",
				"pdf.components",
			);
			flags = g.readUInt16BE(offset);
			offset +=
				4 +
				(flags & 1 ? 4 : 2) +
				(flags & 8 ? 2 : flags & 64 ? 4 : flags & 128 ? 8 : 0);
		} while (flags & 32);
		if (!(flags & 256)) return Buffer.alloc(0);
	}
	requireOutput(offset + 2 <= g.length, "OUTPUT_INTEGRITY", "pdf.instructions");
	const length = g.readUInt16BE(offset);
	requireOutput(
		offset + 2 + length <= g.length,
		"OUTPUT_INTEGRITY",
		"pdf.instructions",
	);
	return g.subarray(offset + 2, offset + 2 + length);
}

export function checkSfntStructure(bytes: Uint8Array): void {
	const t = sfntTables(bytes),
		maxp = t.get("maxp"),
		head = t.get("head"),
		loca = t.get("loca"),
		glyf = t.get("glyf");
	requireOutput(
		maxp !== undefined &&
			maxp.length >= 6 &&
			head !== undefined &&
			head.length >= 54 &&
			loca !== undefined &&
			glyf !== undefined,
		"OUTPUT_INTEGRITY",
		"pdf.sfntStructure",
	);
	const count = maxp.readUInt16BE(4),
		long = head.readInt16BE(50) === 1,
		unit = long ? 4 : 2;
	requireOutput(
		count > 0 && count <= 10000 && loca.length >= (count + 1) * unit,
		"OUTPUT_LIMIT",
		"pdf.sfntGlyphCount",
	);
	const edges: number[][] = [];
	for (let id = 0; id < count; id++) {
		const start = long
				? loca.readUInt32BE(id * unit)
				: loca.readUInt16BE(id * unit) * 2,
			end = long
				? loca.readUInt32BE((id + 1) * unit)
				: loca.readUInt16BE((id + 1) * unit) * 2;
		requireOutput(
			end >= start && end <= glyf.length,
			"OUTPUT_INTEGRITY",
			"pdf.glyfRange",
		);
		const refs: number[] = [];
		edges.push(refs);
		if (end === start) continue;
		const g = glyf.subarray(start, end);
		requireOutput(g.length >= 10, "OUTPUT_INTEGRITY", "pdf.glyfHeader");
		if (g.readInt16BE() < 0) {
			let p = 10,
				f = 0;
			do {
				requireOutput(
					p + 4 <= g.length && refs.length < 128,
					"OUTPUT_LIMIT",
					"pdf.glyfComponents",
				);
				f = g.readUInt16BE(p);
				const target = g.readUInt16BE(p + 2);
				requireOutput(target < count, "OUTPUT_INTEGRITY", "pdf.componentRef");
				refs.push(target);
				p += 4 + (f & 1 ? 4 : 2) + (f & 8 ? 2 : f & 64 ? 4 : f & 128 ? 8 : 0);
			} while (f & 32);
		}
		glyphInstructions(t, id);
	}
	const states = new Map<number, number>();
	function visit(id: number, depth: number): void {
		requireOutput(
			depth <= 16 && states.get(id) !== 1,
			"OUTPUT_UNSUPPORTED",
			"pdf.glyphCycle",
		);
		if (states.get(id) === 2) return;
		states.set(id, 1);
		for (const next of edges[id] ?? []) visit(next, depth + 1);
		states.set(id, 2);
	}
	for (let id = 0; id < count; id++) visit(id, 0);
}
