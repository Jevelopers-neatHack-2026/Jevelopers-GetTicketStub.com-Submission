import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";
import {
	runIndependentTests,
	independentTestEnvironment,
	durabilityTestFiles,
	durabilityProcessEvidence,
} from "../../src/internal/independent-tests.js";
import { VerificationFailure } from "../../src/runtime/errors.js";
import { fixture } from "../fixtures/durability/fixture.js";

const canary = fileURLToPath(
	new URL("../fixtures/durability/canary.js", import.meta.url),
);
const runner = fileURLToPath(
	new URL("../fixtures/durability/canary-runner.js", import.meta.url),
);

test("isolates inherited Node test context while preserving application environment", () => {
	const environment = {
		NODE_TEST_CONTEXT: "child-v8",
		NODE_TEST_SENTINEL: "test-worker",
		APPLICATION_MARKER: "retained",
	};
	assert.deepEqual(independentTestEnvironment(environment), {
		APPLICATION_MARKER: "retained",
	});
});

test("executes a passing canary with fresh evidence from nested node --test", async () => {
	using f = fixture();
	const result = await runIndependentTests({
		paths: [canary],
		evidenceDir: process.env["PP_DURABILITY_RUNNER_EVIDENCE_DIR"] ?? f.root,
		requiredEvidence: ["canary-executed.json"],
	});
	assert.equal(result.tests, 1);
	assert.equal(result.passed, 1);
	assert.ok(result.command.includes("--test-concurrency=4"));
	const evidence: unknown = JSON.parse(
		await readFile(join(result.evidenceDir, "canary-executed.json"), "utf8"),
	);
	assert.ok(
		typeof evidence === "object" &&
			evidence !== null &&
			"executed" in evidence &&
			evidence.executed === true,
	);
	assert.ok(
		"executionNonce" in evidence &&
			evidence.executionNonce === result.executionNonce,
	);
});

test("propagates a deliberately failing child canary from nested node --test", async () => {
	using f = fixture();
	await assert.rejects(
		runIndependentTests({
			paths: [canary],
			evidenceDir: f.root,
			requiredEvidence: ["canary-executed.json"],
			environment: { ...process.env, PP_DURABILITY_CANARY_FAIL: "1" },
		}),
		(error: unknown) =>
			error instanceof VerificationFailure && error.code === "RUNTIME_FAILURE",
	);
	const executions = await readdir(f.root);
	assert.equal(
		executions.filter((name) => name.startsWith("execution-")).length,
		1,
	);
});

test("executes and propagates canary failure through a normal CLI child", () => {
	using f = fixture();
	const environment = independentTestEnvironment();
	const success = execFileSync(
		process.execPath,
		[runner, join(f.root, "success")],
		{ env: environment, encoding: "utf8" },
	);
	const receipt: unknown = JSON.parse(success);
	assert.ok(
		typeof receipt === "object" &&
			receipt !== null &&
			"tests" in receipt &&
			receipt.tests === 1,
	);
	const failure = spawnSync(
		process.execPath,
		[runner, join(f.root, "failure")],
		{
			env: { ...environment, PP_DURABILITY_CANARY_FAIL: "1" },
			encoding: "utf8",
		},
	);
	assert.equal(failure.status, 1);
	assert.equal(failure.stdout, "");
	assert.match(failure.stderr, /RUNTIME_FAILURE/);
});

test("rejects passing output when required execution evidence is missing", async () => {
	using f = fixture();
	await assert.rejects(
		runIndependentTests({
			paths: [canary],
			evidenceDir: f.root,
			requiredEvidence: ["missing-execution.json"],
		}),
		(error: unknown) =>
			error instanceof VerificationFailure && error.code === "RUNTIME_FAILURE",
	);
});

for (const suite of [
	"artifact-storage",
	"restart-recovery",
	"metering-traces",
] as const) {
	test(`executes ${suite} unit regressions and killed-process checks from nested node --test`, {
		timeout: 30000,
	}, async () => {
		using f = fixture();
		const result = await runIndependentTests({
			paths: durabilityTestFiles[suite].map((path) =>
				fileURLToPath(new URL(`../${path}`, import.meta.url)),
			),
			evidenceDir: process.env["PP_DURABILITY_RUNNER_EVIDENCE_DIR"] ?? f.root,
			requiredEvidence: durabilityProcessEvidence,
		});
		assert.ok(result.tests >= 30);
		assert.equal(result.tests, result.passed);
		const killed: unknown = JSON.parse(
			await readFile(
				join(result.evidenceDir, "cancel-budget-kill.json"),
				"utf8",
			),
		);
		assert.ok(
			typeof killed === "object" &&
				killed !== null &&
				"killedSignal" in killed &&
				killed.killedSignal === "SIGKILL",
		);
	});
}

test("rejects an empty test selection before spawning another runner", async () => {
	using f = fixture();
	await assert.rejects(
		runIndependentTests({
			paths: [],
			evidenceDir: f.root,
			requiredEvidence: [],
		}),
		(error: unknown) =>
			error instanceof VerificationFailure && error.code === "RUNTIME_FAILURE",
	);
});

test("rejects a passing child when fewer tests than expected actually execute", async () => {
	using f = fixture();
	await assert.rejects(
		runIndependentTests({
			paths: [canary],
			evidenceDir: f.root,
			expectedTests: 2,
			requiredEvidence: ["canary-executed.json"],
		}),
		(error: unknown) =>
			error instanceof VerificationFailure && error.code === "RUNTIME_FAILURE",
	);
});

test("supports explicit evidence environment and schemas for later composition suite integration", async () => {
	using f = fixture();
	const result = await runIndependentTests({
		paths: [
			fileURLToPath(
				new URL(
					"../fixtures/durability/composition-shaped-canary.js",
					import.meta.url,
				),
			),
		],
		evidenceDir: f.root,
		expectedTests: 1,
		evidenceEnvironment: {
			directoryVariable: "PP_COMPOSITION_EVIDENCE_DIR",
			nonceVariable: "PP_COMPOSITION_EXECUTION_NONCE",
		},
		requiredEvidence: [
			{
				path: "content-integrity.json",
				schema: z.object({
					mode: z.literal("synthetic-draft-only"),
					executed: z.literal(true),
				}),
			},
		],
	});
	assert.equal(result.tests, 1);
	assert.equal(result.expectedTests, 1);
	assert.equal(result.artifacts[0]?.path, "content-integrity.json");
	assert.match(result.artifacts[0]?.digest ?? "", /^[a-f0-9]{64}$/);
});
