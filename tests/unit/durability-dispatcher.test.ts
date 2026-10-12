import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { dispatchVerification } from "../../scripts/verify/dispatcher.js";
import { independentTestEnvironment } from "../../src/internal/independent-tests.js";
import { diagnosticSchema } from "../../src/internal/independent-diagnostics.js";
import { fixture } from "../fixtures/durability/fixture.js";

const expected = {
	"artifact-storage": 80,
	"restart-recovery": 103,
	"metering-traces": 59,
} as const;
const localSchema = z.object({
	state: z.literal("passed-private-mechanisms"),
	tests: z.number(),
	passed: z.number(),
	expectedTests: z.number(),
	executionNonce: z.string(),
	evidenceDir: z.string(),
	exitCode: z.literal(0),
	artifacts: z.array(
		z.object({ path: z.string(), digest: z.string().regex(/^[a-f0-9]{64}$/) }),
	),
});
const cli = fileURLToPath(
	new URL("../../scripts/verify/cli.js", import.meta.url),
);

for (const suite of [
	"artifact-storage",
	"restart-recovery",
	"metering-traces",
] as const) {
	test(`runs complete checks with the registered local scope for ${suite}`, {
		timeout: 360000,
	}, async () => {
		using f = fixture();
		const exit = await dispatchVerification({
			suite,
			mode: "offline",
			evidenceDir: f.root,
		});
		assert.equal(exit, suite === "artifact-storage" ? 0 : 1);
		const receipt: unknown = JSON.parse(
			await readFile(join(f.root, `${suite}.json`), "utf8"),
		);
		const local = localSchema.parse(
			JSON.parse(await readFile(join(f.root, `${suite}-local.json`), "utf8")),
		);
		assert.ok(
			typeof receipt === "object" && receipt !== null && "status" in receipt,
		);
		if (suite === "artifact-storage") {
			assert.equal(receipt.status, "passed");
			assert.ok("result" in receipt);
			const result = z
				.object({
					mode: z.literal("local-storage-adapter-conformance"),
					accepted: z.literal(false),
					live_integration: z.literal(false),
					handoff_eligibility: z.literal("unproven"),
					externalState: z.literal("external-blocked"),
					checks: z.object({
						durability: z.object({
							tests: z.literal(80),
							passed: z.literal(80),
						}),
						canonical: z.object({
							tests: z.literal(74),
							passed: z.literal(74),
						}),
					}),
				})
				.parse(receipt.result);
			assert.equal(result.accepted, false);
			assert.ok(!JSON.stringify(receipt).includes(f.root));
			assert.ok(!JSON.stringify(receipt).includes(process.cwd()));
		} else {
			assert.equal(receipt.status, "failed");
			assert.ok("externalState" in receipt);
			assert.equal(receipt.externalState, "external-blocked");
		}
		assert.equal(local.exitCode, 0);
		assert.equal(local.tests, expected[suite]);
		assert.equal(local.passed, expected[suite]);
		assert.equal(local.expectedTests, expected[suite]);
		assert.equal(local.artifacts.length, 25);
		const killed = z
			.object({
				killedSignal: z.literal("SIGKILL"),
				executionNonce: z.literal(local.executionNonce),
			})
			.parse(
				JSON.parse(
					await readFile(
						join(local.evidenceDir, "cancel-budget-kill.json"),
						"utf8",
					),
				),
			);
		assert.equal(killed.killedSignal, "SIGKILL");
		const canary = z
			.object({
				executed: z.literal(true),
				executionNonce: z.literal(local.executionNonce),
			})
			.parse(
				JSON.parse(
					await readFile(
						join(local.evidenceDir, "canary-executed.json"),
						"utf8",
					),
				),
			);
		assert.equal(canary.executed, true);
	});

	test(`normal CLI executes expected tests with the registered local scope for ${suite}`, {
		timeout: 360000,
	}, async () => {
		using f = fixture();
		const result = spawnSync(
			process.execPath,
			[cli, "--suite", suite, "--mode", "offline", "--evidence-dir", f.root],
			{ env: independentTestEnvironment(), timeout: 350000, encoding: "utf8" },
		);
		assert.ifError(result.error);
		const decoded: unknown = JSON.parse(
			await readFile(join(f.root, `${suite}-local.json`), "utf8"),
		);
		const { diagnostic } = z
			.object({ diagnostic: diagnosticSchema.optional() })
			.parse(decoded);
		assert.equal(
			result.status,
			suite === "artifact-storage" ? 0 : 1,
			JSON.stringify(diagnostic),
		);
		const local = localSchema.parse(decoded);
		assert.equal(local.tests, expected[suite]);
		assert.equal(local.passed, expected[suite]);
		assert.ok((await readdir(local.evidenceDir)).includes("job-gc-stage.json"));
	});
}

for (const nested of [false, true]) {
	test(`propagates child canary failure and invalidates an earlier passing receipt from ${nested ? "nested tests" : "normal CLI"}`, {
		timeout: 20000,
	}, async () => {
		using f = fixture();
		const path = join(f.root, "artifact-storage-local.json");
		await writeFile(
			path,
			JSON.stringify({
				state: "passed-private-mechanisms",
				executionNonce: "stale",
			}),
		);
		if (nested) {
			const prior = process.env["PP_DURABILITY_CANARY_FAIL"];
			try {
				process.env["PP_DURABILITY_CANARY_FAIL"] = "1";
				assert.equal(
					await dispatchVerification({
						suite: "artifact-storage",
						mode: "offline",
						evidenceDir: f.root,
					}),
					1,
				);
			} finally {
				if (prior === undefined)
					delete process.env["PP_DURABILITY_CANARY_FAIL"];
				else process.env["PP_DURABILITY_CANARY_FAIL"] = prior;
			}
		} else {
			const result = spawnSync(
				process.execPath,
				[
					cli,
					"--suite",
					"artifact-storage",
					"--mode",
					"offline",
					"--evidence-dir",
					f.root,
				],
				{
					env: {
						...independentTestEnvironment(),
						PP_DURABILITY_CANARY_FAIL: "1",
					},
					timeout: 15000,
				},
			);
			assert.ifError(result.error);
			assert.equal(result.status, 1);
		}
		const outer = z
			.object({
				status: z.literal("failed"),
				externalState: z.literal("external-blocked"),
				failure: z.object({ code: z.literal("RUNTIME_FAILURE") }),
			})
			.parse(
				JSON.parse(
					await readFile(join(f.root, "artifact-storage.json"), "utf8"),
				),
			);
		assert.equal(outer.failure.code, "RUNTIME_FAILURE");
		const local = z
			.object({
				state: z.literal("failed-private-mechanisms"),
				code: z.literal("RUNTIME_FAILURE"),
			})
			.parse(JSON.parse(await readFile(path, "utf8")));
		assert.equal(local.state, "failed-private-mechanisms");
		const executions = (
			await readdir(join(f.root, "artifact-storage", "local"))
		).filter((name) => name.startsWith("execution-"));
		assert.equal(executions.length, 1);
		const execution = executions[0];
		assert.ok(execution);
		const canary = z
			.object({ executed: z.literal(true) })
			.parse(
				JSON.parse(
					await readFile(
						join(
							f.root,
							"artifact-storage",
							"local",
							execution,
							"canary-executed.json",
						),
						"utf8",
					),
				),
			);
		assert.equal(canary.executed, true);
	});
}
