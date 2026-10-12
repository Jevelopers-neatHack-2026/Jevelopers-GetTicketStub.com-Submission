import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
	runIndependentTests,
	durabilityTestFiles,
	durabilityExpectedTests,
	durabilityProcessEvidence,
} from "../internal/independent-tests.js";
import { hash } from "../internal/durability.js";
import { assertEnvironment } from "../runtime/environment.js";
import { VerificationFailure } from "../runtime/errors.js";
import {
	measureStorageCustody,
	requireStorageCustody,
} from "./storage-custody.js";

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

async function requireExecutionCustody(result: IndependentResult) {
	for (const artifact of result.artifacts) {
		const raw = await readFile(join(result.evidenceDir, artifact.path), "utf8");
		if (
			hash(raw) !== artifact.digest ||
			!z
				.object({ executionNonce: z.literal(result.executionNonce) })
				.safeParse(JSON.parse(raw)).success
		)
			throw new VerificationFailure(
				"RUNTIME_FAILURE",
				"Storage execution evidence changed or was replayed.",
			);
	}
}

export async function verifyStorageConformance(evidenceDir: string) {
	if (!z.string().min(1).safeParse(evidenceDir).success)
		throw new VerificationFailure(
			"RUNTIME_FAILURE",
			"Storage conformance owns execution; an evidence directory is required.",
		);
	const { receipt: environment } = await assertEnvironment();
	const originalPaths = [
		...durabilityTestFiles["artifact-storage"],
		"fixtures/durability/canary.js",
	];
	const canonicalPaths = Object.keys(storageCanonicalTests);
	const allPaths = [...originalPaths, ...canonicalPaths];
	const absolute = (path: string) =>
		fileURLToPath(new URL(`../../tests/${path}`, import.meta.url));
	const custody = await measureStorageCustody(allPaths);
	const durability = await runIndependentTests({
		paths: originalPaths.map(absolute),
		evidenceDir,
		expectedTests: durabilityExpectedTests["artifact-storage"] + 1,
		requiredEvidence: [...durabilityProcessEvidence, "canary-executed.json"],
	});
	requireStorageCustody(custody, await measureStorageCustody(allPaths));
	await requireExecutionCustody(durability);
	const canonical = await runIndependentTests({
		paths: canonicalPaths.map(absolute),
		evidenceDir: join(evidenceDir, "canonical"),
		expectedTests: Object.values(storageCanonicalTests).reduce(
			(total, count) => total + count,
			0,
		),
		requiredEvidence: ["canary-executed.json"],
	});
	requireStorageCustody(custody, await measureStorageCustody(allPaths));
	await requireExecutionCustody(durability);
	await requireExecutionCustody(canonical);
	const conformance = {
		...storageConformanceScope,
		criteria: ["PP-10A.1", "PP-10A.2", "PP-10A.3", "PP-10A.4", "PP-10A.5"],
		environment,
		...custody,
		checks: {
			durability: scopedExecution(durability),
			canonical: scopedExecution(canonical),
		},
	} as const;
	return { durability, conformance } as const;
}
