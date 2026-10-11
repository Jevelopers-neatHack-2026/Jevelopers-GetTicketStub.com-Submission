import { pdfTokens, utf16Hex } from "./private-pdf-tokens.js";
import type { PdfToken } from "./private-pdf-tokens.js";
import { requireOutput } from "./private-policy.js";
function hex(token: PdfToken | undefined): string {
	requireOutput(
		typeof token === "object" &&
			token !== null &&
			!Array.isArray(token) &&
			"hex" in token,
		"OUTPUT_INTEGRITY",
		"pdf.cmapHex",
	);
	return token.hex;
}
export function readCmap(bytes: Uint8Array): ReadonlyMap<number, string> {
	const tokens = pdfTokens(bytes),
		map = new Map<number, string>();
	const add = (cid: number, value: string) => {
		requireOutput(
			Number.isInteger(cid) &&
				cid > 0 &&
				cid <= 65535 &&
				!map.has(cid) &&
				map.size < 10000,
			"OUTPUT_INTEGRITY",
			"pdf.cmapEntry",
		);
		map.set(cid, value);
	};
	for (let i = 0; i < tokens.length; i++) {
		const op = tokens[i];
		if (op !== "beginbfchar" && op !== "beginbfrange") continue;
		const n = tokens[i - 1];
		requireOutput(
			typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 10000,
			"OUTPUT_LIMIT",
			"pdf.cmapCount",
		);
		for (let j = 0; j < n; j++) {
			const start = Number.parseInt(hex(tokens[++i]), 16);
			if (op === "beginbfchar") add(start, utf16Hex(hex(tokens[++i])));
			else {
				const end = Number.parseInt(hex(tokens[++i]), 16),
					target = tokens[++i];
				requireOutput(
					end >= start && end - start <= 10000,
					"OUTPUT_LIMIT",
					"pdf.cmapRange",
				);
				if (Array.isArray(target)) {
					requireOutput(
						target.length === end - start + 1,
						"OUTPUT_INTEGRITY",
						"pdf.cmapRangeArray",
					);
					for (let k = start; k <= end; k++)
						add(k, utf16Hex(hex(target[k - start])));
				} else {
					const first = hex(target);
					requireOutput(
						first.length === 4,
						"OUTPUT_UNSUPPORTED",
						"pdf.cmapIncrement",
					);
					for (let k = start; k <= end; k++)
						add(
							k,
							utf16Hex(
								(Number.parseInt(first, 16) + k - start)
									.toString(16)
									.padStart(4, "0"),
							),
						);
				}
			}
		}
		requireOutput(
			tokens[++i] === (op === "beginbfchar" ? "endbfchar" : "endbfrange"),
			"OUTPUT_INTEGRITY",
			"pdf.cmapEnd",
		);
	}
	requireOutput(map.size > 0, "OUTPUT_INTEGRITY", "pdf.cmapEmpty");
	return map;
}
