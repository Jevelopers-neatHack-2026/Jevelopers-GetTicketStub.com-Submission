import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runIndependentTests } from "../internal/independent-tests.js";
import { assertEnvironment } from "../runtime/environment.js";
import { VerificationFailure } from "../runtime/errors.js";
import {
	measureStorageCustody,
	requireStorageCustody,
} from "./storage-custody.js";
import {
	outputTestFiles,
	outputExpectedTests,
} from "./private-suite-manifest.js";
import {
	outputIntegrationTestPaths,
	outputEvidenceRequirements,
	exporterReproducibilityRequirement,
} from "./output-evidence.js";
import {
	measureExporterEvidence,
	requireExporterEvidence,
} from "./exporter-evidence.js";

export const exporterConformanceScope = {
	mode: "local-exporter-adapter-conformance",
	accepted: false,
	live_integration: false,
	handoff_eligibility: "unproven",
	externalState: "external-blocked",
	authority: "injected-test-host",
	knownLegacyByteMetadata: {
		id: "SC-PFB-PARENT-LEGACY009",
		version: "0.9.7",
		state: "upstream-unresolved",
		scope:
			"Fresh internal export buffers and SQLite reads only; arbitrary SDK typed-array validation is not proven safe.",
	},
} as const;

export const exporterOutputPaths = [
	...outputTestFiles.exporters.map((f) => `unit/${f}.test.js`),
	...outputIntegrationTestPaths,
];
export const exporterCanonicalTests = {
	"contract/canonical-production-bundle.test.js": 11,
	"integration/exporter-canonical-proof.test.js": 1,
	"fixtures/production-output/canary.js": 1,
} as const;
type Execution = Awaited<ReturnType<typeof runIndependentTests>>;
function scopedExecution(result: Execution) {
	return {
		exitCode: result.exitCode,
		tests: result.tests,
		passed: result.passed,
		expectedTests: result.expectedTests,
		executionNonce: result.executionNonce,
		artifacts: result.artifacts,
		stdoutDigest: result.stdoutDigest,
		stderrDigest: result.stderrDigest,
	};
}

export async function verifyExporterConformance(evidenceDir: string) {
	if (!z.string().min(1).safeParse(evidenceDir).success)
		throw new VerificationFailure(
			"RUNTIME_FAILURE",
			"Exporter conformance owns execution; an evidence directory is required.",
		);
	const { receipt: environment } = await assertEnvironment();
	const canonicalPaths = Object.keys(exporterCanonicalTests);
	const allPaths = [...exporterOutputPaths, ...canonicalPaths];
	const absolute = (path: string) =>
		fileURLToPath(new URL(`../../tests/${path}`, import.meta.url));
	const custody = await measureStorageCustody(allPaths);
	const output = await runIndependentTests({
		paths: exporterOutputPaths.map(absolute),
		evidenceDir,
		expectedTests: outputExpectedTests.exporters,
		requiredEvidence: [
			...outputEvidenceRequirements,
			exporterReproducibilityRequirement,
		],
		evidenceEnvironment: { directoryVariable: "PP_OUTPUT_EVIDENCE_DIR" },
	});
	requireStorageCustody(custody, await measureStorageCustody(allPaths));
	await requireExporterEvidence(output);
	const outputEvidence = await measureExporterEvidence(output.evidenceDir);
	const canonical = await runIndependentTests({
		paths: canonicalPaths.map(absolute),
		evidenceDir: join(evidenceDir, "canonical"),
		expectedTests: Object.values(exporterCanonicalTests).reduce(
			(total, count) => total + count,
			0,
		),
		requiredEvidence: [
			{
				path: "production-output-canary.json",
				schema: z.object({ executed: z.literal(true) }),
			},
			"canonical-exporter-proof.json",
		],
		evidenceEnvironment: { directoryVariable: "PP_OUTPUT_EVIDENCE_DIR" },
	});
	requireStorageCustody(custody, await measureStorageCustody(allPaths));
	await requireExporterEvidence(output);
	await requireExporterEvidence(canonical);
	const currentOutput = await measureExporterEvidence(output.evidenceDir);
	if (JSON.stringify(outputEvidence) !== JSON.stringify(currentOutput))
		throw new VerificationFailure(
			"RUNTIME_FAILURE",
			"Exporter output evidence changed during canonical execution.",
		);
	const canonicalEvidence = await measureExporterEvidence(
		canonical.evidenceDir,
	);
	const proof = JSON.parse(
		await readFile(
			join(canonical.evidenceDir, "canonical-exporter-proof.json"),
			"utf8",
		),
	);
	const conformance = {
		...exporterConformanceScope,
		criteria: [
			"PP-09A.1",
			"PP-09A.2",
			"PP-09A.3",
			"PP-09A.4",
			"PP-09A.5",
			"PP-09A.6",
		],
		environment,
		...custody,
		checks: {
			output: scopedExecution(output),
			canonical: scopedExecution(canonical),
		},
		evidence: { output: outputEvidence, canonical: canonicalEvidence },
		canonicalProofDigest: canonical.artifacts.find(
			(a) => a.path === "canonical-exporter-proof.json",
		)?.digest,
		byteRoute: z
			.object({ byteRoute: z.literal("fresh-output-buffers-and-sqlite-reads") })
			.parse(proof).byteRoute,
	};
	return { output, conformance } as const;
}
