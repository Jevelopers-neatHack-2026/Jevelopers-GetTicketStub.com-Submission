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
import { IndependentTestFailure } from "../internal/independent-diagnostics.js";
import { VerificationFailure } from "../runtime/errors.js";
import { verifyStorageConformance } from "./storage-suite.js";
export { suiteNames, suiteRegistry } from "./private-suite-registry.js";
import type { SuiteName } from "./private-suite-registry.js";
export type { SuiteName } from "./private-suite-registry.js";

import {
	compositionTestFiles,
	outputTestFiles,
	compositionExpectedTests,
	outputExpectedTests,
	semanticRequirements,
} from "./private-suite-manifest.js";
export {
	compositionExpectedTests,
	outputExpectedTests,
} from "./private-suite-manifest.js";
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
				"integration/production-output-pdf-mapping.test.js",
				"integration/production-output-pdf-semantic.test.js",
				"integration/production-output-pdf-font-adversarial.test.js",
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
			];
			requiredEvidence.push(...semanticRequirements);
			requiredEvidence.push({
				path: "csv-flow-state.json",
				schema: z.object({
					mode: z.literal("finite-csv-test-stage"),
					phase: z.literal("completed"),
					generationCalls: z.literal(0),
					privacyVerified: z.literal(true),
					privacyRevision: z.literal("private-observation-test-privacy-1"),
				}),
			});
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
		const conformance =
			suite === "artifact-storage"
				? await verifyStorageConformance(result, root)
				: undefined;
		await writeFile(
			receipt,
			JSON.stringify(
				{
					state: "passed-private-mechanisms",
					...result,
					externalState: "external-blocked",
					...(conformance ? { conformance } : {}),
				},
				null,
				2,
			),
		);
		return conformance;
	} catch (error) {
		if (error instanceof Error) {
			await writeFile(
				receipt,
				JSON.stringify(
					{
						state: "failed-private-mechanisms",
						externalState: "external-blocked",
						code: "RUNTIME_FAILURE",
						...(error instanceof IndependentTestFailure
							? { diagnostic: error.diagnostic }
							: {}),
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
