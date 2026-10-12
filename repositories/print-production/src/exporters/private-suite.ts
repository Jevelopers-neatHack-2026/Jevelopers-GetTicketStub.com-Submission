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
import { VerificationFailure, failureReceipt } from "../runtime/errors.js";
import { verifyStorageConformance } from "./storage-suite.js";
import { verifyExporterConformance } from "./exporter-suite.js";
import {
	outputEvidenceRequirements,
	outputIntegrationTestPaths,
} from "./output-evidence.js";
export { suiteNames, suiteRegistry } from "./private-suite-registry.js";
import type { SuiteName } from "./private-suite-registry.js";
export type { SuiteName } from "./private-suite-registry.js";

import {
	compositionTestFiles,
	outputTestFiles,
	compositionExpectedTests,
	outputExpectedTests,
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
		const exporter =
			suite === "exporters" ? await verifyExporterConformance(root) : undefined;
		const storage =
			suite === "artifact-storage"
				? await verifyStorageConformance(root)
				: undefined;
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
				...outputIntegrationTestPaths,
			];
			directoryVariable = "PP_OUTPUT_EVIDENCE_DIR";
			requiredEvidence = [...outputEvidenceRequirements];
			expectedTests = outputExpectedTests[key];
		}
		const result =
			storage?.durability ??
			exporter?.output ??
			(await runIndependentTests({
				paths: paths.map((p) =>
					fileURLToPath(new URL(`../../tests/${p}`, import.meta.url)),
				),
				evidenceDir: root,
				requiredEvidence,
				evidenceEnvironment: { directoryVariable },
				expectedTests,
			}));
		const conformance = storage?.conformance ?? exporter?.conformance;
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
						...(suite === "artifact-storage" || suite === "exporters"
							? { failure: failureReceipt(error) }
							: {}),
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
