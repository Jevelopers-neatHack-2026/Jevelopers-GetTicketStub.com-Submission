import { z } from "zod";
export const compositionTestFiles = {
	templates: ["composition-model", "composition-image-scale"],
	composition: [
		"composition-model",
		"composition-image-scale",
		"composition-visibility",
	],
	typography: ["composition-model", "composition-text-scale"],
	"approved-assets": ["composition-assets", "composition-image-scale"],
	preflight: [
		"composition-preflight",
		"composition-visibility",
		"composition-text-scale",
		"composition-image-scale",
		"composition-report-provenance",
	],
	"bounded-repair": [
		"composition-repair",
		"composition-text-scale",
		"composition-report-provenance",
	],
} as const;
export const outputTestFiles = {
	personalization: [
		"production-output-rows",
		"production-output-batch",
		"production-output-diagnostics",
		"production-output-independent-diagnostics",
	],
	"csv-personalization": ["production-output-csv"],
	exporters: ["production-output-containers", "production-output-pdf-bounds"],
	manifests: ["production-output-containers", "production-output-pdf-bounds"],
	"integration-production": [
		"production-output-independent-diagnostics",
		"production-output-rows",
		"production-output-csv",
		"production-output-pdf-bounds",
		"production-output-containers",
		"production-output-batch",
		"production-output-diagnostics",
	],
} as const;
export const compositionExpectedTests = {
	templates: 67,
	composition: 79,
	typography: 69,
	"approved-assets": 77,
	preflight: 82,
	"bounded-repair": 55,
} as const;
export const outputExpectedTests = {
	personalization: 47,
	"csv-personalization": 40,
	exporters: 48,
	manifests: 48,
	"integration-production": 81,
} as const;
export const semanticRequirements = [
	{
		path: "pdf-semantic/arabic.json",
		schema: z.object({
			mode: z.literal("verified-private-pdf-semantic-not-approved"),
			networkRequests: z.literal(0),
			semantics: z.object({
				glyphCount: z.number().positive(),
				clusterCount: z.number().positive(),
			}),
		}),
	},
	{
		path: "pdf-semantic/wrap.json",
		schema: z.object({
			mode: z.literal("verified-private-pdf-semantic-not-approved"),
			networkRequests: z.literal(0),
		}),
	},
	{
		path: "pdf-semantic/adversarial.json",
		schema: z.object({
			mode: z.literal("real-pdf-byte-mutations"),
			cases: z.array(z.object({ state: z.literal("rejected") })).min(13),
		}),
	},
	{
		path: "pdf-semantic/font-adversarial.json",
		schema: z.object({
			mode: z.literal("real-font-byte-mutations"),
			cases: z.array(z.object({ state: z.literal("rejected") })).length(3),
			reportBinding: z.literal("rejected"),
		}),
	},
];
