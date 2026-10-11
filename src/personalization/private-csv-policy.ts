import { z } from "zod";
import { digestSchema, parse, refSchema } from "../composition/primitives.js";
import { requireOutput } from "../exporters/private-policy.js";
import type { PersonalizationRow, RowPolicy } from "./private-rows.js";

export const csvPolicySchema = z
	.object({
		revision: z.literal("private-csv-1_csv-parse-6.1.0"),
		delimiter: z.enum([",", ";", "\t"]),
		newline: z.enum(["\n", "\r\n"]),
		maxBytes: z.number().int().positive().max(4000000),
		maxRows: z.number().int().positive().max(10000),
		maxColumns: z.number().int().positive().max(32),
		maxCellBytes: z.number().int().positive().max(16384),
		rowIdHeader: z.string().min(1).max(128).nullable(),
		mapping: z
			.array(
				z
					.object({ header: z.string().min(1).max(128), field: refSchema })
					.strict()
					.readonly(),
			)
			.min(1)
			.max(32)
			.readonly(),
	})
	.strict()
	.readonly();
export type CsvPolicy = z.infer<typeof csvPolicySchema>;
export const checkpointSchema = z
	.object({
		fileDigest: digestSchema,
		policyDigest: digestSchema,
		offset: z.number().int().nonnegative(),
		records: z.number().int().nonnegative(),
		physicalLine: z.number().int().positive(),
	})
	.strict()
	.refine(
		(value) =>
			value.records > 0 || (value.offset === 0 && value.physicalLine === 1),
	)
	.readonly();
export type CsvCheckpoint = z.infer<typeof checkpointSchema>;
export type CsvRow = {
	readonly row: PersonalizationRow;
	readonly logicalRecord: number;
	readonly physicalLine: number;
	readonly sourcePaths: Readonly<Record<string, string>>;
	readonly checkpoint: CsvCheckpoint;
};
export const csvBaselineCapability = {
	enabled: false,
	reason: "approved launch roster absent",
} as const;
export function requireCsvCapability(enabled: boolean): void {
	requireOutput(enabled, "CAPABILITY_DISABLED", "csv");
}
export function resolveCsvPolicy(value: unknown, rows: RowPolicy): CsvPolicy {
	const p = parse(csvPolicySchema, value);
	const headers = [
		...p.mapping.map((m) => m.header),
		...(p.rowIdHeader === null ? [] : [p.rowIdHeader]),
	];
	requireOutput(
		new Set(headers).size === headers.length &&
			new Set(p.mapping.map((m) => m.field)).size === p.mapping.length,
		"CSV_SCHEMA",
		"mapping.ambiguous",
	);
	requireOutput(
		p.mapping.every((m) => rows.fields.some((f) => f.field === m.field)) &&
			rows.fields
				.filter((f) => f.required)
				.every((f) => p.mapping.some((m) => m.field === f.field)),
		"CSV_SCHEMA",
		"mapping.fields",
	);
	return p;
}
