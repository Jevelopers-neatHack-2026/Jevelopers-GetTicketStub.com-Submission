import { z } from "zod";
import {
	canonical,
	digest,
	digestSchema,
	fingerprint,
	parse,
	refSchema,
} from "../composition/primitives.js";
import type { CompositionInput } from "../composition/private-model.js";
import { OutputError, requireOutput } from "../exporters/private-policy.js";
import { checkpointSchema } from "./private-csv-policy.js";

export const rowPolicySchema = z
	.object({
		revision: z.literal("private-rows-1"),
		fields: z
			.array(
				z
					.object({
						field: refSchema,
						node: refSchema,
						required: z.boolean(),
						maxLength: z.number().int().min(1).max(4096),
					})
					.strict()
					.readonly(),
			)
			.min(1)
			.max(32)
			.readonly(),
		maxRows: z.number().int().min(1).max(10000),
		maxBytes: z.number().int().positive().max(4000000),
	})
	.strict()
	.readonly();
export type RowPolicy = z.infer<typeof rowPolicySchema>;
export const rowSchema = z
	.object({
		rowId: refSchema,
		fields: z.record(refSchema, z.string().max(4096)),
	})
	.strict()
	.readonly();
export type PersonalizationRow = z.infer<typeof rowSchema>;
export const plannedRowSchema = z
	.object({
		row: rowSchema,
		ordinal: z.number().int().nonnegative(),
		inputDigest: digestSchema,
		csv: z
			.object({
				checkpoint: checkpointSchema,
				logicalRecord: z.number().int().positive(),
				physicalLine: z.number().int().positive(),
				sourcePaths: z.record(z.string(), z.string().max(256)),
			})
			.strict()
			.readonly()
			.optional(),
		errors: z
			.array(
				z
					.object({ code: z.literal("ROW_SCHEMA"), path: z.string().max(256) })
					.strict()
					.readonly(),
			)
			.readonly(),
	})
	.strict()
	.readonly();
export type PlannedRow = z.infer<typeof plannedRowSchema>;
export function resolveRowPolicy(
	value: unknown,
	input: CompositionInput,
): RowPolicy {
	const policy = parse(rowPolicySchema, value);
	requireOutput(
		new Set(policy.fields.map((f) => f.field)).size === policy.fields.length &&
			new Set(policy.fields.map((f) => f.node)).size === policy.fields.length,
		"ROW_SCHEMA",
		"mapping.duplicates",
	);
	for (const field of policy.fields) {
		const node = input.nodes.find((n) => n.id === field.node);
		requireOutput(
			node?.kind === "text" &&
				node.field.fieldRef === field.field &&
				node.field.source.kind === "display",
			"ROW_SCHEMA",
			`mapping.${field.field}`,
		);
	}
	return policy;
}
export function planRows(
	value: unknown,
	policy: RowPolicy,
): readonly PlannedRow[] {
	const rows = parse(
		z
			.array(
				z
					.object({
						rowId: refSchema,
						fields: z.record(refSchema, z.unknown()),
					})
					.strict()
					.readonly(),
			)
			.min(1)
			.max(policy.maxRows),
		value,
	);
	requireOutput(
		Buffer.byteLength(canonical(rows)) <= policy.maxBytes,
		"OUTPUT_LIMIT",
		"rows.bytes",
	);
	requireOutput(
		new Set(rows.map((r) => r.rowId)).size === rows.length,
		"ROW_DUPLICATE",
		"rows.rowId",
	);
	return rows.map((row, ordinal) => {
		const errors: { code: "ROW_SCHEMA"; path: string }[] = [];
		const fields: Record<string, string> = {};
		for (const [name, value] of Object.entries(row.fields)) {
			if (typeof value === "string" && value.length <= 4096)
				fields[name] = value;
			else errors.push({ code: "ROW_SCHEMA", path: `fields.${name}` });
		}
		for (const name of Object.keys(row.fields))
			if (!policy.fields.some((f) => f.field === name))
				errors.push({ code: "ROW_SCHEMA", path: `fields.${name}` });
		for (const field of policy.fields) {
			const value = fields[field.field];
			if (
				(field.required && (value === undefined || value.length === 0)) ||
				(value !== undefined && value.length > field.maxLength)
			)
				errors.push({ code: "ROW_SCHEMA", path: `fields.${field.field}` });
		}
		return {
			row: { rowId: row.rowId, fields },
			ordinal,
			inputDigest: fingerprint(row),
			errors,
		};
	});
}
export function personalizeInput(
	input: CompositionInput,
	planned: PlannedRow,
	policy: RowPolicy,
): CompositionInput {
	const first = planned.errors[0];
	if (first) throw new OutputError(first.code, first.path);
	return {
		...input,
		nodes: input.nodes.map((node) => {
			if (node.kind !== "text") return node;
			const mapping = policy.fields.find((f) => f.node === node.id);
			if (!mapping) return node;
			const value = planned.row.fields[mapping.field] ?? "";
			return {
				...node,
				field: {
					...node.field,
					rowRef: planned.row.rowId,
					sourceRef: refSchema.parse(
						`row-${digest(planned.row.rowId).slice(0, 32)}`,
					),
					sourceDigest: digest(value),
					source: { kind: "display" as const, value },
				},
			};
		}),
	};
}
