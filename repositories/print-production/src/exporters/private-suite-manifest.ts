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
		"production-output-observation-privacy",
	],
	"csv-personalization": [
		"production-output-csv",
		"production-output-observation-privacy",
	],
	exporters: [
		"production-output-containers",
		"production-output-pdf-bounds",
		"production-output-observation-privacy",
	],
	manifests: [
		"production-output-containers",
		"production-output-pdf-bounds",
		"production-output-observation-privacy",
	],
	"integration-production": [
		"production-output-independent-diagnostics",
		"production-output-observation-privacy",
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
	personalization: 51,
	"csv-personalization": 43,
	exporters: 51,
	manifests: 51,
	"integration-production": 85,
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
