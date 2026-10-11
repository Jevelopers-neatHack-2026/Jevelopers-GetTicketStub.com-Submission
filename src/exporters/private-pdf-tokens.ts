import { requireOutput } from "./private-policy.js";
export type PdfToken =
	| number
	| string
	| { readonly name: string }
	| { readonly hex: string }
	| readonly PdfToken[]
	| { readonly dict: Readonly<Record<string, PdfToken>> };
export type PdfOperation = {
	readonly op: string;
	readonly args: readonly PdfToken[];
};
export function pdfTokens(bytes: Uint8Array): readonly PdfToken[] {
	requireOutput(bytes.length <= 2000000, "OUTPUT_LIMIT", "pdf.contentBytes");
	const input = Buffer.from(bytes).toString("latin1");
	let offset = 0,
		count = 0;
	function skip() {
		while (offset < input.length) {
			const c = input[offset] ?? "";
			if (/\s/.test(c) || c.charCodeAt(0) === 0) offset++;
			else if (c === "%") {
				while (offset < input.length && !/[\r\n]/.test(input[offset] ?? ""))
					offset++;
			} else break;
		}
	}
	function read(depth: number): PdfToken {
		requireOutput(
			depth <= 8 && ++count <= 100000,
			"OUTPUT_LIMIT",
			"pdf.tokens",
		);
		skip();
		const c = input[offset++];
		requireOutput(c !== undefined, "OUTPUT_INTEGRITY", "pdf.tokenEnd");
		if (c === "[") {
			const values: PdfToken[] = [];
			skip();
			while (input[offset] !== "]") {
				requireOutput(
					offset < input.length,
					"OUTPUT_INTEGRITY",
					"pdf.arrayEnd",
				);
				values.push(read(depth + 1));
				skip();
			}
			offset++;
			return values;
		}
		if (c === "<") {
			if (input[offset] === "<") {
				offset++;
				const dict: Record<string, PdfToken> = {};
				skip();
				while (input.slice(offset, offset + 2) !== ">>") {
					const key = read(depth + 1);
					requireOutput(
						typeof key === "object" && !Array.isArray(key) && "name" in key,
						"OUTPUT_INTEGRITY",
						"pdf.dictKey",
					);
					requireOutput(
						!(key.name in dict),
						"OUTPUT_INTEGRITY",
						"pdf.dictDuplicate",
					);
					dict[key.name] = read(depth + 1);
					skip();
				}
				offset += 2;
				return { dict };
			}
			const end = input.indexOf(">", offset);
			requireOutput(end >= 0, "OUTPUT_INTEGRITY", "pdf.hexEnd");
			const hex = input.slice(offset, end).replace(/\s/g, "");
			requireOutput(/^[a-fA-F0-9]*$/.test(hex), "OUTPUT_INTEGRITY", "pdf.hex");
			offset = end + 1;
			return { hex: hex.length % 2 ? hex + "0" : hex };
		}
		if (c === "(") {
			let value = "",
				level = 1;
			while (level) {
				requireOutput(
					offset < input.length,
					"OUTPUT_INTEGRITY",
					"pdf.stringEnd",
				);
				let char = input[offset++];
				if (char === "\\") {
					char = input[offset++];
					requireOutput(char !== undefined, "OUTPUT_INTEGRITY", "pdf.escape");
					if (/[0-7]/.test(char)) {
						let oct = char;
						while (oct.length < 3 && /[0-7]/.test(input[offset] ?? "x"))
							oct += input[offset++];
						value += String.fromCharCode(Number.parseInt(oct, 8));
					} else if (char === "\r" || char === "\n") {
						if (char === "\r" && input[offset] === "\n") offset++;
					} else
						value +=
							{ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" }[char] ?? char;
				} else if (char === "(") {
					level++;
					value += char;
				} else if (char === ")") {
					level--;
					if (level) value += char;
				} else value += char;
			}
			return { hex: Buffer.from(value, "latin1").toString("hex") };
		}
		let word = c;
		while (
			offset < input.length &&
			!/[\s\[\]()<>/%]/.test(input[offset] ?? "") &&
			input.charCodeAt(offset) !== 0
		)
			word += input[offset++];
		if (c === "/") {
			requireOutput(
				/^[A-Za-z0-9_.-]+$/.test(word.slice(1)),
				"OUTPUT_UNSUPPORTED",
				"pdf.name",
			);
			return { name: word.slice(1) };
		}
		requireOutput(!/[\[\]()<>]/.test(c), "OUTPUT_UNSUPPORTED", "pdf.delimiter");
		if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(word)) {
			const n = Number(word);
			requireOutput(
				Number.isFinite(n) && Math.abs(n) <= 1000000,
				"OUTPUT_LIMIT",
				"pdf.number",
			);
			return n;
		}
		requireOutput(
			/^[A-Za-z][A-Za-z0-9*]*$/.test(word),
			"OUTPUT_UNSUPPORTED",
			"pdf.word",
		);
		return word;
	}
	const result: PdfToken[] = [];
	skip();
	while (offset < input.length) {
		result.push(read(0));
		skip();
	}
	return result;
}
export function pdfOperations(bytes: Uint8Array): readonly PdfOperation[] {
	const result: PdfOperation[] = [];
	let args: PdfToken[] = [];
	for (const token of pdfTokens(bytes)) {
		if (typeof token === "string") {
			result.push({ op: token, args });
			args = [];
		} else args.push(token);
		requireOutput(
			args.length <= 64 && result.length <= 50000,
			"OUTPUT_LIMIT",
			"pdf.operations",
		);
	}
	requireOutput(args.length === 0, "OUTPUT_INTEGRITY", "pdf.operands");
	return result;
}
export function utf16Hex(hex: string): string {
	const bytes = Buffer.from(hex, "hex");
	requireOutput(
		bytes.length % 2 === 0 && bytes.length <= 16384,
		"OUTPUT_LIMIT",
		"pdf.unicodeBytes",
	);
	let result = "";
	for (let i = 0; i < bytes.length; i += 2) {
		const cp = bytes.readUInt16BE(i);
		if (cp >= 0xd800 && cp <= 0xdbff) {
			requireOutput(i + 3 < bytes.length, "OUTPUT_INTEGRITY", "pdf.surrogate");
			const low = bytes.readUInt16BE(i + 2);
			requireOutput(
				low >= 0xdc00 && low <= 0xdfff,
				"OUTPUT_INTEGRITY",
				"pdf.surrogate",
			);
			result += String.fromCodePoint(
				0x10000 + (cp - 0xd800) * 1024 + low - 0xdc00,
			);
			i += 2;
		} else {
			requireOutput(
				cp < 0xdc00 || cp > 0xdfff,
				"OUTPUT_INTEGRITY",
				"pdf.surrogate",
			);
			result += String.fromCodePoint(cp);
		}
	}
	return result;
}
