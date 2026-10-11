import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
	runIndependentTests,
	durabilityTestFiles,
	durabilityExpectedTests,
	durabilityProcessEvidence,
} from "../internal/independent-tests.js";
import { VerificationFailure } from "../runtime/errors.js";
export { suiteNames, suiteRegistry } from "./private-suite-registry.js";
import type { SuiteName } from "./private-suite-registry.js";
export type { SuiteName } from "./private-suite-registry.js";

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
	],
	"csv-personalization": ["production-output-csv"],
	exporters: ["production-output-containers"],
	manifests: ["production-output-containers"],
	"integration-production": [
		"production-output-rows",
		"production-output-csv",
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
	personalization: 32,
	"csv-personalization": 29,
	exporters: 29,
	manifests: 29,
	"integration-production": 58,
} as const;
export async function runPrivateSuite(suite: SuiteName, evidenceDir: string) {
	const root = join(evidenceDir, suite, "local"),
		receipt = join(evidenceDir, `${suite}-local.json`);
	await mkdir(root, { recursive: true });
	await rm(receipt, { force: true });
	try {
		let paths: readonly string[],
			requiredEvidence: (
				| string
				| { readonly path: string; readonly schema: z.ZodType }
			)[],
			expectedTests: number;
		let directoryVariable: string;
		if (suite in compositionTestFiles) {
			const key = z
				.enum([
					"templates",
					"composition",
					"typography",
					"approved-assets",
					"preflight",
					"bounded-repair",
				])
				.parse(suite);
			paths = [
				...compositionTestFiles[key].map((f) => `unit/${f}.test.js`),
				"integration/composition-render.test.js",
				"integration/composition-integrity.test.js",
				"fixtures/production-output/canary.js",
			];
			directoryVariable = "PP_COMPOSITION_EVIDENCE_DIR";
			requiredEvidence = [
				{
					path: "attendee-001/evidence.json",
					schema: z.object({
						mode: z.literal("synthetic-draft-only"),
						networkRequests: z.literal(0),
						metrics: z.array(z.object({ value: z.string() })).min(1),
					}),
				},
				{
					path: "attendee-001/content-integrity.json",
					schema: z.object({
						scope: z.literal("synthetic-only"),
						generationCalls: z.literal(0),
						report: z.object({ handoffEligible: z.literal(false) }),
					}),
				},
				{
					path: "production-output-canary.json",
					schema: z.object({ executed: z.literal(true) }),
				},
			];
			expectedTests = compositionExpectedTests[key];
		} else if (suite in durabilityTestFiles) {
			const key = z
				.enum(["artifact-storage", "restart-recovery", "metering-traces"])
				.parse(suite);
			paths = [...durabilityTestFiles[key], "fixtures/durability/canary.js"];
			directoryVariable = "PP_DURABILITY_EVIDENCE_DIR";
			requiredEvidence = [...durabilityProcessEvidence, "canary-executed.json"];
			expectedTests = durabilityExpectedTests[key] + 1;
		} else {
			const key = z
				.enum([
					"personalization",
					"csv-personalization",
					"exporters",
					"manifests",
					"integration-production",
				])
				.parse(suite);
			paths = [
				...outputTestFiles[key].map((f) => `unit/${f}.test.js`),
				"integration/production-output-flow.test.js",
				"integration/production-output-formats.test.js",
				"integration/production-output-negative.test.js",
				"integration/production-output-csv-flow.test.js",
				"integration/production-output-process.test.js",
				"integration/production-output-receipt.test.js",
				"fixtures/production-output/canary.js",
			];
			directoryVariable = "PP_OUTPUT_EVIDENCE_DIR";
			requiredEvidence = [
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
			];
			expectedTests = outputExpectedTests[key];
		}
		const result = await runIndependentTests({
			paths: paths.map((p) =>
				fileURLToPath(new URL(`../../tests/${p}`, import.meta.url)),
			),
			evidenceDir: root,
			requiredEvidence,
			evidenceEnvironment: { directoryVariable },
			expectedTests,
		});
		await writeFile(
			receipt,
			JSON.stringify(
				{
					state: "passed-private-mechanisms",
					...result,
					externalState: "external-blocked",
				},
				null,
				2,
			),
		);
	} catch (error) {
		if (error instanceof Error) {
			await writeFile(
				receipt,
				JSON.stringify(
					{
						state: "failed-private-mechanisms",
						externalState: "external-blocked",
						code: "RUNTIME_FAILURE",
					},
					null,
					2,
				),
			);
			throw new VerificationFailure(
				"RUNTIME_FAILURE",
				"Private tests failed or fresh evidence is incomplete; external gates remain blocked.",
			);
		}
		throw error;
	}
}
