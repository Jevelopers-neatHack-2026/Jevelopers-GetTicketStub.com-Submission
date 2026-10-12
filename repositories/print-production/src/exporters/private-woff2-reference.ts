import { brotliDecompressSync } from "node:zlib";
import { requireOutput } from "./private-policy.js";
import { woffInstructions } from "./private-woff2-instructions.js";
const tags = [
	"cmap",
	"head",
	"hhea",
	"hmtx",
	"maxp",
	"name",
	"OS/2",
	"post",
	"cvt ",
	"fpgm",
	"glyf",
	"loca",
	"prep",
	"CFF ",
	"VORG",
	"EBDT",
	"EBLC",
	"gasp",
	"hdmx",
	"kern",
	"LTSH",
	"PCLT",
	"VDMX",
	"vhea",
	"vmtx",
	"BASE",
	"GDEF",
	"GPOS",
	"GSUB",
	"EBSC",
	"JSTF",
	"MATH",
	"CBDT",
	"CBLC",
	"COLR",
	"CPAL",
	"SVG ",
	"sbix",
	"acnt",
	"avar",
	"bdat",
	"bloc",
	"bsln",
	"cvar",
	"fdsc",
	"feat",
	"fmtx",
	"fvar",
	"gvar",
	"hsty",
	"just",
	"lcar",
	"mort",
	"morx",
	"opbd",
	"prop",
	"trak",
	"Zapf",
	"Silf",
	"Glat",
	"Gloc",
	"Feat",
	"Sill",
] as const;
export function readWoff2Reference(bytes: Uint8Array) {
	const b = Buffer.from(bytes);
	requireOutput(
		b.length >= 48 &&
			b.length <= 2000000 &&
			b.toString("ascii", 0, 4) === "wOF2" &&
			b.readUInt32BE(8) === b.length &&
			b.readUInt32BE(16) <= 2000000,
		"OUTPUT_UNSUPPORTED",
		"pdf.woff2Header",
	);
	let pos = 48;
	const base128 = () => {
		let n = 0;
		for (let i = 0; i < 5; i++) {
			requireOutput(pos < b.length, "OUTPUT_INTEGRITY", "pdf.woff2Directory");
			const v = b[pos++] ?? 0;
			requireOutput(
				!(i === 0 && v === 128) && n <= 0x1ffffff,
				"OUTPUT_INTEGRITY",
				"pdf.woff2Base128",
			);
			n = n * 128 + (v & 127);
			if (!(v & 128)) return n;
		}
		requireOutput(false, "OUTPUT_INTEGRITY", "pdf.woff2Base128");
		return 0;
	};
	const count = b.readUInt16BE(12);
	requireOutput(count > 0 && count <= 32, "OUTPUT_LIMIT", "pdf.woff2Tables");
	let offset = 0,
		glyf: { offset: number; length: number } | null = null;
	const hints = new Map<string, { offset: number; length: number }>();
	for (let i = 0; i < count; i++) {
		const flags = b[pos++] ?? 0,
			index = flags & 63;
		let tag: string | undefined = tags[index];
		if (index === 63) {
			tag = b.toString("ascii", pos, pos + 4);
			pos += 4;
		}
		requireOutput(tag !== undefined, "OUTPUT_UNSUPPORTED", "pdf.woff2Tag");
		const original = base128(),
			transformed =
				tag === "glyf" || tag === "loca"
					? flags >>> 6 === 0
					: flags >>> 6 !== 0,
			length = transformed ? base128() : original;
		if (tag === "glyf") {
			requireOutput(
				transformed,
				"OUTPUT_UNSUPPORTED",
				"pdf.woff2GlyfTransform",
			);
			glyf = { offset, length };
		}
		if (["cvt ", "fpgm", "prep"].includes(tag)) {
			requireOutput(
				!transformed,
				"OUTPUT_UNSUPPORTED",
				"pdf.woff2HintTransform",
			);
			hints.set(tag, { offset, length });
		}
		offset += length;
	}
	requireOutput(
		glyf !== null && offset <= 2000000 && pos + b.readUInt32BE(20) <= b.length,
		"OUTPUT_LIMIT",
		"pdf.woff2Compressed",
	);
	const decoded = brotliDecompressSync(
		b.subarray(pos, pos + b.readUInt32BE(20)),
		{ maxOutputLength: 2000000 },
	);
	requireOutput(
		decoded.length === offset && glyf.length >= 36,
		"OUTPUT_UNSUPPORTED",
		"pdf.woff2Instructions",
	);
	return {
		instructions: woffInstructions(
			decoded.subarray(glyf.offset, glyf.offset + glyf.length),
		),
		hints: new Map(
			[...hints].map(([name, r]) => [
				name,
				decoded.subarray(r.offset, r.offset + r.length),
			]),
		),
	};
}
