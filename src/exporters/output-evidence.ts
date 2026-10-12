import { z } from "zod";
import { semanticRequirements } from "./private-suite-manifest.js";

export const outputIntegrationTestPaths = [
	"integration/production-output-flow.test.js",
	"integration/production-output-formats.test.js",
	"integration/production-output-negative.test.js",
	"integration/production-output-csv-flow.test.js",
	"integration/production-output-process.test.js",
	"integration/production-output-receipt.test.js",
	"integration/production-output-pdf-mapping.test.js",
	"integration/production-output-pdf-semantic.test.js",
	"integration/production-output-pdf-font-adversarial.test.js",
	"fixtures/production-output/canary.js",
] as const;

export const exporterReproducibilityRequirement = {
	path: "exporter-reproducibility.json",
	schema: z.object({
		mode: z.literal("independent-browser-normalized-byte-comparison"),
		byteEquality: z.literal(true),
		semanticEquality: z.literal(true),
		pixelEquality: z.literal(true),
		handoffEligible: z.literal(false),
		files: z
			.array(
				z
					.object({
						firstDigest: z.string().regex(/^[a-f0-9]{64}$/),
						secondDigest: z.string().regex(/^[a-f0-9]{64}$/),
					})
					.refine((f) => f.firstDigest === f.secondDigest),
			)
			.length(3),
	}),
};

export const outputEvidenceRequirements: readonly {
	readonly path: string;
	readonly schema: z.ZodType;
}[] = [
	{
		path: "production-output-canary.json",
		schema: z.object({ executed: z.literal(true) }),
	},
	{
		path: "corpus-index.json",
		schema: z.object({
			mode: z.literal("synthetic-private-local"),
			handoffEligible: z.literal(false),
			artifacts: z
				.array(z.object({ name: z.string(), digest: z.string() }))
				.min(6),
		}),
	},
	{
		path: "output-process-restart.json",
		schema: z.object({
			mode: z.literal("real-process-private-synthetic"),
			executionAttempts: z.literal(2),
			interruptedAttempt: z.string().uuid(),
		}),
	},
	{
		path: "pdf-mapping/arabic.json",
		schema: z.object({
			mode: z.literal("diagnostic-synthetic-not-production"),
			productionExactness: z.literal("verified-private-not-approved"),
			networkRequests: z.literal(0),
			fileDigest: z.string().regex(/^[a-f0-9]{64}$/),
			expected: z.array(z.string()).min(1),
		}),
	},
	{
		path: "pdf-mapping/wrap.json",
		schema: z.object({
			mode: z.literal("diagnostic-synthetic-not-production"),
			productionExactness: z.literal("verified-private-not-approved"),
			networkRequests: z.literal(0),
			fileDigest: z.string().regex(/^[a-f0-9]{64}$/),
			expected: z.array(z.string()).min(1),
		}),
	},
	{
		path: "pdf-mapping/actualtext-control.json",
		schema: z.object({
			mode: z.literal("diagnostic-synthetic-not-production"),
			readerUsesActualText: z.literal(false),
			productionExactness: z.literal("not-accepted"),
		}),
	},
	...semanticRequirements,
	{
		path: "csv-flow-state.json",
		schema: z.object({
			mode: z.literal("finite-csv-test-stage"),
			phase: z.literal("completed"),
			generationCalls: z.literal(0),
			privacyVerified: z.literal(true),
			privacyRevision: z.literal("private-observation-test-privacy-1"),
		}),
	},
];
