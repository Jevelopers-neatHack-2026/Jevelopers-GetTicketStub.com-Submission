import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { parse as csvParser } from "csv-parse";
import { z } from "zod";
import {
	digestSchema,
	fingerprint,
	parse,
	refSchema,
} from "../composition/primitives.js";
import { OutputError, requireOutput } from "../exporters/private-policy.js";
import { checkpointSchema } from "./private-csv-policy.js";
import type { CsvPolicy, CsvCheckpoint, CsvRow } from "./private-csv-policy.js";
export {
	csvPolicySchema,
	csvBaselineCapability,
	requireCsvCapability,
	resolveCsvPolicy,
} from "./private-csv-policy.js";
export type { CsvPolicy, CsvCheckpoint, CsvRow } from "./private-csv-policy.js";

const recordSchema = z.object({
	record: z.array(z.string()),
	info: z.object({
		bytes: z.number().int(),
		lines: z.number().int(),
		records: z.number().int(),
	}),
});
// Full stream replay validates the digest and record boundary before accepting a checkpoint.
// Pulling one record at a time keeps parsing/backpressure bounded; callers must await exhaustion before publication.
export async function* parseCsv(options: {
	readonly source: AsyncIterable<Uint8Array>;
	readonly fileDigest: string;
	readonly policy: CsvPolicy;
	readonly checkpoint?: CsvCheckpoint;
	readonly signal?: AbortSignal;
}): AsyncGenerator<CsvRow> {
	const expected = digestSchema.parse(options.fileDigest),
		p = options.policy,
		policyDigest = fingerprint(p);
	const checkpoint = options.checkpoint
		? parse(checkpointSchema, options.checkpoint)
		: null;
	requireOutput(
		!checkpoint ||
			(checkpoint.fileDigest === expected &&
				checkpoint.policyDigest === policyDigest),
		"CSV_CHECKPOINT",
		"identity",
	);
	const sha = createHash("sha256"),
		decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
	let bytes = 0,
		complete = false;
	const source = Readable.from(
		(async function* () {
			try {
				for await (const chunk of options.source) {
					options.signal?.throwIfAborted();
					bytes += chunk.byteLength;
					requireOutput(bytes <= p.maxBytes, "OUTPUT_LIMIT", "csv.bytes");
					sha.update(chunk);
					decoder.decode(chunk, { stream: true });
					yield chunk;
				}
				decoder.decode();
				requireOutput(
					sha.digest("hex") === expected,
					"CSV_CHECKPOINT",
					"fileDigest",
				);
				complete = true;
			} catch (error) {
				if (error instanceof TypeError)
					throw new OutputError("CSV_ENCODING", "utf8");
				throw error;
			}
		})(),
		{ highWaterMark: 1 },
	);
	const parserOptions = {
		bom: true,
		delimiter: p.delimiter,
		record_delimiter: p.newline,
		quote: '"',
		escape: '"',
		info: true,
		relax_column_count: false,
		skip_empty_lines: false,
		trim: false,
		max_record_size: p.maxColumns * p.maxCellBytes,
		readableHighWaterMark: 1,
		writableHighWaterMark: 1,
	};
	const parser = csvParser(parserOptions);
	source.on("error", (error) => parser.destroy(error));
	source.pipe(parser);
	let headers: readonly string[] | null = null,
		resumed = checkpoint === null || checkpoint.records === 0;
	try {
		for await (const raw of parser) {
			options.signal?.throwIfAborted();
			const { record, info } = recordSchema.parse(raw);
			requireOutput(
				record.length <= p.maxColumns &&
					record.every((c) => Buffer.byteLength(c) <= p.maxCellBytes),
				"OUTPUT_LIMIT",
				"csv.cells",
			);
			if (headers === null) {
				headers = record;
				requireOutput(
					new Set(headers).size === headers.length &&
						headers.every((h) => h.length > 0),
					"CSV_SCHEMA",
					"headers.duplicates",
				);
				const required = [
					...p.mapping.map((m) => m.header),
					...(p.rowIdHeader === null ? [] : [p.rowIdHeader]),
				];
				requireOutput(
					required.length === headers.length &&
						required.every((h) => headers?.includes(h)),
					"CSV_SCHEMA",
					"headers.mapping",
				);
				continue;
			}
			const logical = info.records - 1;
			requireOutput(logical <= p.maxRows, "OUTPUT_LIMIT", "csv.rows");
			const next = {
				fileDigest: expected,
				policyDigest,
				offset: info.bytes,
				records: logical,
				physicalLine: info.lines,
			};
			if (checkpoint && logical <= checkpoint.records) {
				if (logical === checkpoint.records) {
					requireOutput(
						fingerprint(next) === fingerprint(checkpoint),
						"CSV_CHECKPOINT",
						"boundary",
					);
					resumed = true;
				}
				continue;
			}
			requireOutput(resumed, "CSV_CHECKPOINT", "boundary");
			const fields: Record<string, string> = {},
				sourcePaths: Record<string, string> = {};
			for (const m of p.mapping) {
				const cell = record[headers.indexOf(m.header)];
				requireOutput(cell !== undefined, "CSV_SYNTAX", "columns");
				fields[m.field] = cell;
				sourcePaths[m.field] = `headers.${m.header}`;
			}
			const rowId =
				p.rowIdHeader === null
					? `csv-${expected.slice(0, 24)}-${logical}`
					: record[headers.indexOf(p.rowIdHeader)];
			requireOutput(rowId !== undefined, "CSV_SCHEMA", "rowId");
			yield {
				row: { rowId: refSchema.parse(rowId), fields },
				logicalRecord: logical,
				physicalLine: info.lines,
				sourcePaths,
				checkpoint: next,
			};
		}
		requireOutput(
			complete && headers !== null && resumed,
			"CSV_CHECKPOINT",
			"complete",
		);
	} catch (error) {
		if (error instanceof OutputError) throw error;
		if (
			error instanceof Error &&
			"code" in error &&
			typeof error.code === "string" &&
			error.code.startsWith("CSV_")
		)
			throw new OutputError("CSV_SYNTAX", error.code);
		throw error;
	} finally {
		source.destroy();
		parser.destroy();
	}
}
export function csvErrorReport(rows: readonly (readonly string[])[]): string {
	return (
		rows
			.map((row) =>
				row
					.map(
						(value) =>
							`"${(/^[\s]*[=+@-]/u.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`,
					)
					.join(","),
			)
			.join("\r\n") + "\r\n"
	);
}
