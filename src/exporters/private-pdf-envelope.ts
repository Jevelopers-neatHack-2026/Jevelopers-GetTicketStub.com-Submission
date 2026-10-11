import { requireOutput } from "./private-policy.js";

export function checkPdfEnvelope(bytes: Uint8Array): void {
	requireOutput(
		bytes.length > 0 && bytes.length <= 16000000,
		"OUTPUT_LIMIT",
		"pdf.fileBytes",
	);
	const source = Buffer.from(bytes).toString("latin1");
	const tail = /\nstartxref\n(\d+)\n%%EOF$/.exec(source.slice(-128));
	requireOutput(
		tail?.[1] !== undefined,
		"OUTPUT_UNSUPPORTED",
		"pdf.envelopeTrailer",
	);
	const xrefOffset = Number(tail[1]);
	const table = /^xref\n0 (\d+)\n/.exec(
		source.slice(xrefOffset, xrefOffset + 40),
	);
	requireOutput(
		table?.[1] !== undefined && xrefOffset > 0,
		"OUTPUT_UNSUPPORTED",
		"pdf.envelopeXref",
	);
	const count = Number(table[1]);
	requireOutput(
		count > 1 && count <= 4097,
		"OUTPUT_LIMIT",
		"pdf.envelopeObjects",
	);
	const rowStart = xrefOffset + table[0].length,
		offsets: number[] = [];
	for (let i = 0; i < count; i++) {
		const row = source.slice(rowStart + i * 20, rowStart + (i + 1) * 20);
		requireOutput(
			/^\d{10} \d{5} [nf] \n$/.test(row),
			"OUTPUT_UNSUPPORTED",
			"pdf.envelopeXrefRow",
		);
		if (i === 0)
			requireOutput(
				row === "0000000000 65535 f \n",
				"OUTPUT_INTEGRITY",
				"pdf.envelopeFreeObject",
			);
		else {
			const offset = Number(row.slice(0, 10));
			requireOutput(
				row.slice(11) === "00000 n \n" &&
					offset > (offsets.at(-1) ?? 0) &&
					offset < xrefOffset &&
					source.startsWith(`${i} 0 obj\n`, offset),
				"OUTPUT_UNSUPPORTED",
				"pdf.envelopeObjectOffset",
			);
			offsets.push(offset);
		}
	}
	const sections = [...offsets, xrefOffset];
	for (const [i, start] of sections.entries()) {
		const end = sections[i + 1] ?? source.length;
		const object = source.slice(start, end);
		let depth = 0,
			literal = 0,
			escaped = false;
		for (let n = object.indexOf("\n") + 1; n < object.length; n++) {
			const char = object[n];
			if (literal) {
				if (!escaped && char === "(") literal++;
				if (!escaped && char === ")") literal--;
				escaped = !escaped && char === "\\";
				requireOutput(
					literal <= 32,
					"OUTPUT_LIMIT",
					"pdf.envelopeLiteralDepth",
				);
				continue;
			}
			if (char === "(") {
				literal = 1;
				continue;
			}
			if (char === "<" && object[n + 1] !== "<") {
				const close = object.indexOf(">", n + 1);
				requireOutput(close >= 0, "OUTPUT_INTEGRITY", "pdf.envelopeHex");
				n = close;
				continue;
			}
			if (char === "[" || object.slice(n, n + 2) === "<<") {
				depth++;
				if (char === "<") n++;
			} else if (char === "]" || object.slice(n, n + 2) === ">>") {
				depth--;
				if (char === ">") n++;
			}
			requireOutput(
				depth >= 0 && depth <= 32,
				"OUTPUT_LIMIT",
				"pdf.envelopeDepth",
			);
			if (depth === 0 && object.startsWith("stream\n", n)) {
				const lengths = [...object.slice(0, n).matchAll(/\/Length (\d+)\n/g)];
				requireOutput(
					lengths.length === 1 && lengths[0]?.[1] !== undefined,
					"OUTPUT_UNSUPPORTED",
					"pdf.envelopeStreamLength",
				);
				const length = Number(lengths[0][1]),
					after = n + 7 + length;
				requireOutput(
					length <= 16000000 && object.startsWith("\nendstream\nendobj", after),
					"OUTPUT_INTEGRITY",
					"pdf.envelopeStreamEnd",
				);
				n = after + 10;
			}
		}
		requireOutput(
			depth === 0 &&
				literal === 0 &&
				(i === offsets.length || object.endsWith("endobj\n\n")),
			"OUTPUT_INTEGRITY",
			"pdf.envelopeBalance",
		);
	}
}
