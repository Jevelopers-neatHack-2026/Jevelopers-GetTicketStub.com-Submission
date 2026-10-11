import { z } from "zod";
import { digestSchema, parse } from "../composition/primitives.js";
import { hash } from "../internal/durability.js";
import type { OutputFile } from "../storage/local-store.js";

export const outputCodes = [
	"OUTPUT_LIMIT",
	"OUTPUT_UNSUPPORTED",
	"OUTPUT_INTEGRITY",
	"OUTPUT_CONTENT",
	"OUTPUT_PREFLIGHT",
	"CSV_SYNTAX",
	"CSV_SCHEMA",
	"CSV_ENCODING",
	"CSV_CHECKPOINT",
	"ROW_SCHEMA",
	"ROW_DUPLICATE",
	"CAPABILITY_DISABLED",
] as const;
export class OutputError extends Error {
	override readonly name = "OutputError";
	constructor(
		readonly code: (typeof outputCodes)[number],
		readonly path: string,
	) {
		super(`${code} at ${path}`);
	}
}
export function requireOutput(
	value: boolean,
	code: OutputError["code"],
	path: string,
): asserts value {
	if (!value) throw new OutputError(code, path);
}
export const outputPolicySchema = z
	.object({
		revision: z.literal("private-output-1"),
		dpi: z.number().int().min(72).max(1200),
		maxPixels: z.number().int().positive().max(40000000),
		maxBytes: z.number().int().positive().max(64000000),
		profile: z.literal("srgb"),
		background: z.literal("opaque-layout-background"),
		pdfStandard: z.literal("plain-pdf"),
		fontPolicy: z.literal("embedded-approved"),
	})
	.strict()
	.readonly();
export type OutputPolicy = z.infer<typeof outputPolicySchema>;
export const defaultOutputPolicy: OutputPolicy = outputPolicySchema.parse({
	revision: "private-output-1",
	dpi: 300,
	maxPixels: 16000000,
	maxBytes: 16000000,
	profile: "srgb",
	background: "opaque-layout-background",
	pdfStandard: "plain-pdf",
	fontPolicy: "embedded-approved",
});
export function resolveOutputPolicy(value: unknown): OutputPolicy {
	return parse(outputPolicySchema, value);
}
export const fileDescriptorSchema = z
	.object({
		name: z.string().min(1).max(128),
		format: z.enum(["svg", "png", "pdf"]),
		mediaType: z.enum(["image/svg+xml", "image/png", "application/pdf"]),
		length: z.number().int().nonnegative(),
		digest: digestSchema,
		widthMm: z.number().positive(),
		heightMm: z.number().positive(),
		widthPx: z.number().int().positive().nullable(),
		heightPx: z.number().int().positive().nullable(),
		dpi: z.number().positive().nullable(),
		profile: z.literal("srgb"),
		alpha: z.boolean(),
		rasterArtwork: z.boolean(),
		text: z.enum(["embedded", "rasterized"]),
		semanticDigest: digestSchema,
	})
	.strict()
	.readonly();
export type FileDescriptor = z.infer<typeof fileDescriptorSchema>;
export function outputFile(name: string, bytes: Uint8Array): OutputFile {
	return {
		name,
		bytes: Uint8Array.from(bytes),
		digest: hash(bytes),
		length: bytes.byteLength,
	};
}
