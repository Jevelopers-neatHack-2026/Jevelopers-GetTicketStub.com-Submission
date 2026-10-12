import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runIndependentTests } from "../internal/independent-tests.js";
import { hash } from "../internal/durability.js";
import { assertEnvironment } from "../runtime/environment.js";
import { VerificationFailure } from "../runtime/errors.js";

export const storageConformanceScope = {
	mode: "local-storage-adapter-conformance",
	accepted: false,
	live_integration: false,
	handoff_eligibility: "unproven",
	externalState: "external-blocked",
	authority: "injected-test-host",
} as const;

export const storageCanonicalTests = {
	"unit/durability-denial.test.js": 8,
	"unit/canonical-production-boundary.test.js": 16,
	"integration/canonical-production-runtime-record.test.js": 8,
	"integration/canonical-production-idempotency.test.js": 2,
	"integration/canonical-production-export-redelivery.test.js": 4,
	"integration/canonical-production-provenance.test.js": 1,
	"integration/canonical-production-permission-replay.test.js": 5,
	"integration/canonical-production-completion.test.js": 11,
	"integration/canonical-production-review-regressions.test.js": 18,
	"fixtures/durability/canary.js": 1,
} as const;
type IndependentResult = Awaited<ReturnType<typeof runIndependentTests>>;

function scopedExecution(result: IndependentResult) {
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

export async function verifyStorageConformance(
	durability: IndependentResult,
	evidenceDir: string,
) {
	const { receipt: environment } = await assertEnvironment();
	const paths = Object.keys(storageCanonicalTests).map((path) => ({
		path,
		absolute: fileURLToPath(new URL(`../../tests/${path}`, import.meta.url)),
	}));
	const inventory = async () =>
		Promise.all(
			paths.map(async ({ path, absolute }) => ({
				path,
				digest: hash(await readFile(absolute)),
			})),
		);
	const compiledTests = await inventory();
	const canonical = await runIndependentTests({
		paths: paths.map(({ absolute }) => absolute),
		evidenceDir: join(evidenceDir, "canonical"),
		expectedTests: Object.values(storageCanonicalTests).reduce(
			(total, count) => total + count,
			0,
		),
		requiredEvidence: ["canary-executed.json"],
	});
	if (
		hash(JSON.stringify(compiledTests)) !==
		hash(JSON.stringify(await inventory()))
	)
		throw new VerificationFailure(
			"RUNTIME_FAILURE",
			"Storage conformance compiled tests changed during execution.",
		);
	return {
		...storageConformanceScope,
		criteria: ["PP-10A.1", "PP-10A.2", "PP-10A.3", "PP-10A.4", "PP-10A.5"],
		environment,
		compiledTests,
		checks: {
			durability: scopedExecution(durability),
			canonical: scopedExecution(canonical),
		},
	} as const;
}
