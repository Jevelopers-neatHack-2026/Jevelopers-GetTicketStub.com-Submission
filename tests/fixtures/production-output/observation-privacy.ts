import assert from "node:assert/strict";
import { z } from "zod";
import {
	idSchema,
	digestSchema,
	codes,
} from "../../../src/internal/durability.js";
import { observationKinds } from "../../../src/telemetry/observations.js";

export const privateObservationPrivacyRevision =
	"private-observation-test-privacy-1";
const measurement = <U extends "byte" | "millisecond" | "row">(unit: U) =>
	z
		.object({
			unit: z.literal(unit),
			value: z.number().nonnegative().nullable(),
			completeness: z.enum(["measured", "unknown"]),
		})
		.strict();
const observation = z
	.object({
		sequence: z.number().int().positive(),
		id: idSchema,
		operation: idSchema,
		attempt: idSchema.nullable(),
		kind: z.enum(observationKinds),
		code: z.enum(codes).nullable(),
		publication: idSchema.nullable(),
		bytes: z.number().nonnegative().nullable(),
		duration_ms: z.number().nonnegative().nullable(),
		recorded: z.number().finite(),
		scope: digestSchema,
		request: digestSchema,
		job: idSchema.nullable(),
		row: digestSchema.nullable(),
		row_count: z.number().int().nonnegative().nullable(),
		stagingVersion: z.literal(1),
		environment: z.literal("local"),
		billingMode: z.literal("unclassified"),
		producerBuildDigest: z.null(),
		metrics: z
			.object({
				outputBytes: measurement("byte"),
				duration: measurement("millisecond"),
				rows: measurement("row"),
			})
			.strict(),
	})
	.strict();

export function assertObservationPrivacy(value: unknown): void {
	const parsed = z.array(observation).min(1).safeParse(value);
	assert.ok(parsed.success, "Private Observation field/type privacy rejected.");
	for (const event of parsed.data) {
		for (const [metric, value] of [
			[event.metrics.outputBytes, event.bytes],
			[event.metrics.duration, event.duration_ms],
			[event.metrics.rows, event.row_count],
		] as const) {
			assert.equal(metric.value, value);
			assert.equal(
				metric.completeness,
				value === null ? "unknown" : "measured",
			);
		}
	}
}
