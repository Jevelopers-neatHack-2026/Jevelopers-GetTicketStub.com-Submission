import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { hash } from "./durability.js";
import { VerificationFailure } from "../runtime/errors.js";

export function independentTestEnvironment(
	environment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	return Object.fromEntries(
		Object.entries(environment).filter(
			([key]) => !key.startsWith("NODE_TEST_"),
		),
	);
}

export const durabilityProcessEvidence = [
	"storage-process-race.json",
	"job-process-race.json",
	"storage-byte-transaction.json",
	"job-stage.json",
	"job-uncertain.json",
	"uncertain-fail-false.json",
	"uncertain-fail-true.json",
	"cancel-budget-kill.json",
	"denied-worker-kill.json",
	"job-gc-stage.json",
	"job-gc-fail.json",
	"job-gc-cancel.json",
] as const;

export const durabilityTestFiles = {
	"artifact-storage": [
		"unit/durability-storage.test.js",
		"unit/durability-batch-boundary.test.js",
		"unit/durability-cleanup.test.js",
		"integration/durability-process.test.js",
	],
	"restart-recovery": [
		"unit/durability-jobs.test.js",
		"unit/durability-publication.test.js",
		"unit/durability-denial.test.js",
		"unit/durability-cancellation.test.js",
		"unit/durability-cleanup.test.js",
		"unit/durability-batch-boundary.test.js",
		"integration/durability-process.test.js",
	],
	"metering-traces": [
		"unit/durability-telemetry.test.js",
		"unit/durability-publication.test.js",
		"unit/durability-cancellation.test.js",
		"integration/durability-process.test.js",
	],
} as const;

export async function runIndependentTests(options: {
	readonly paths: readonly string[];
	readonly evidenceDir: string;
	readonly requiredEvidence: readonly string[];
	readonly environment?: NodeJS.ProcessEnv;
}) {
	if (options.paths.length === 0)
		throw new VerificationFailure(
			"RUNTIME_FAILURE",
			"Independent private test paths are required.",
		);
	const executionNonce = randomUUID();
	await mkdir(options.evidenceDir, { recursive: true });
	const evidenceDir = await mkdtemp(join(options.evidenceDir, "execution-"));
	const command = [
		process.execPath,
		"--test",
		"--test-reporter=tap",
		...options.paths,
	];
	try {
		const result = await promisify(execFile)(
			process.execPath,
			command.slice(1),
			{
				env: {
					...independentTestEnvironment(options.environment),
					PP_DURABILITY_EVIDENCE_DIR: evidenceDir,
					PP_DURABILITY_EXECUTION_NONCE: executionNonce,
				},
				timeout: 60000,
				maxBuffer: 4 * 1024 * 1024,
			},
		);
		const count = (name: string) =>
			Number(
				result.stdout.match(new RegExp(`^# ${name} (\\d+)$`, "m"))?.[1] ?? NaN,
			);
		const tests = count("tests");
		const passed = count("pass");
		if (
			!(
				tests > 0 &&
				passed === tests &&
				["fail", "cancelled", "skipped", "todo"].every(
					(name) => count(name) === 0,
				)
			)
		)
			throw new VerificationFailure(
				"RUNTIME_FAILURE",
				"Independent private tests did not execute a complete passing run.",
			);
		for (const name of options.requiredEvidence) {
			const evidence: unknown = JSON.parse(
				await readFile(join(evidenceDir, name), "utf8"),
			);
			if (
				!z
					.object({ executionNonce: z.literal(executionNonce) })
					.safeParse(evidence).success
			)
				throw new VerificationFailure(
					"RUNTIME_FAILURE",
					"Independent private test execution evidence is absent or stale.",
				);
		}
		return {
			command,
			exitCode: 0,
			tests,
			passed,
			executionNonce,
			evidenceDir,
			stdoutDigest: hash(result.stdout),
			stderrDigest: hash(result.stderr),
		} as const;
	} catch (error) {
		if (error instanceof Error)
			throw new VerificationFailure(
				"RUNTIME_FAILURE",
				"Independent private tests failed or execution evidence is incomplete.",
			);
		throw error;
	}
}
