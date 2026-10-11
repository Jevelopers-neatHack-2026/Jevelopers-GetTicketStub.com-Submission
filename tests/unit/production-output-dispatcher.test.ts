import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { dispatchVerification } from "../../scripts/verify/dispatcher.js";
import {
	compositionExpectedTests,
	outputExpectedTests,
} from "../../src/exporters/private-suite.js";
const receiptSchema = z.object({
	state: z.literal("passed-private-mechanisms"),
	tests: z.number(),
	passed: z.number(),
	expectedTests: z.number(),
	executionNonce: z.string().uuid(),
	evidenceDir: z.string(),
	artifacts: z.array(
		z.object({ path: z.string(), digest: z.string().regex(/^[a-f0-9]{64}$/) }),
	),
});
for (const suite of ["templates", "personalization"] as const)
	test(`executes genuine isolated ${suite} tests and fresh artifacts under inherited test context`, {
		timeout: 60000,
	}, async () => {
		const root = await mkdtemp(join(tmpdir(), "pp-output-dispatcher-")),
			previous = process.env["PP_OUTPUT_CANARY_FAIL"];
		try {
			assert.equal(
				await dispatchVerification({
					suite,
					mode: "offline",
					evidenceDir: root,
				}),
				1,
			);
			const local = receiptSchema.parse(
				JSON.parse(await readFile(join(root, `${suite}-local.json`), "utf8")),
			);
			const expected =
				suite === "templates"
					? compositionExpectedTests.templates
					: outputExpectedTests.personalization;
			assert.equal(local.tests, expected);
			assert.equal(local.passed, expected);
			assert.equal(local.expectedTests, expected);
			assert.ok(
				local.artifacts.some((a) => a.path === "production-output-canary.json"),
			);
			const outer = z
				.object({
					status: z.literal("failed"),
					externalState: z.literal("external-blocked"),
				})
				.parse(JSON.parse(await readFile(join(root, `${suite}.json`), "utf8")));
			assert.equal(outer.status, "failed");
			process.env["PP_OUTPUT_CANARY_FAIL"] = "1";
			assert.equal(
				await dispatchVerification({
					suite,
					mode: "offline",
					evidenceDir: root,
				}),
				1,
			);
			const failed = z
				.object({
					state: z.literal("failed-private-mechanisms"),
					code: z.literal("RUNTIME_FAILURE"),
				})
				.parse(
					JSON.parse(await readFile(join(root, `${suite}-local.json`), "utf8")),
				);
			assert.equal(failed.code, "RUNTIME_FAILURE");
		} finally {
			if (previous === undefined) delete process.env["PP_OUTPUT_CANARY_FAIL"];
			else process.env["PP_OUTPUT_CANARY_FAIL"] = previous;
			await rm(root, { recursive: true, force: true });
		}
	});
