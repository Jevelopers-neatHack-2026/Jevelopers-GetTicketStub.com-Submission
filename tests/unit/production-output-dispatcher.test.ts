import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { dispatchVerification } from "../../scripts/verify/dispatcher.js";
import {
	compositionExpectedTests,
	outputExpectedTests,
} from "../../src/exporters/private-suite.js";
import { diagnosticSchema } from "../../src/internal/independent-diagnostics.js";
import { assertPrivateExecution } from "../fixtures/production-output/dispatcher-proof.js";

const expectedCounts = {
	...compositionExpectedTests,
	personalization: outputExpectedTests.personalization,
} as const;
const suites = [
	"templates",
	"composition",
	"typography",
	"approved-assets",
	"preflight",
	"bounded-repair",
	"personalization",
] as const;
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
const sha256 = (bytes: string | Uint8Array) =>
	createHash("sha256").update(bytes).digest("hex");
let root: string,
	keep = false;
before(async () => {
	const requested = process.env["PP_OUTPUT_EVIDENCE_DIR"];
	if (requested)
		await mkdir(join(requested, "nested-dispatcher"), { recursive: true });
	root = await mkdtemp(
		join(
			requested ? join(requested, "nested-dispatcher") : tmpdir(),
			"pp-output-dispatcher-",
		),
	);
	keep = requested !== undefined;
});
after(async () => {
	if (!keep) await rm(root, { recursive: true, force: true });
});

for (const suite of suites) {
	test(`executes genuine isolated ${suite} tests and fresh artifacts under inherited test context`, {
		timeout: 60000,
	}, async () => {
		const directory = join(root, suite);
		assert.equal(
			await dispatchVerification({
				suite,
				mode: "offline",
				evidenceDir: directory,
			}),
			1,
		);
		const raw = await readFile(join(directory, `${suite}-local.json`), "utf8");
		await assertPrivateExecution(suite, directory);
		const local = receiptSchema.parse(JSON.parse(raw));
		assert.equal(local.tests, expectedCounts[suite]);
		assert.equal(local.passed, expectedCounts[suite]);
		assert.equal(local.expectedTests, expectedCounts[suite]);
		for (const artifact of local.artifacts) {
			assert.equal(
				sha256(await readFile(join(local.evidenceDir, artifact.path))),
				artifact.digest,
			);
		}
		const canary = z
			.object({
				executed: z.literal(true),
				executionNonce: z.literal(local.executionNonce),
			})
			.parse(
				JSON.parse(
					await readFile(
						join(local.evidenceDir, "production-output-canary.json"),
						"utf8",
					),
				),
			);
		assert.equal(canary.executed, true);
		const outer = z
			.object({
				status: z.literal("failed"),
				externalState: z.literal("external-blocked"),
				failure: z.object({ code: z.literal("SUITE_UNIMPLEMENTED") }),
			})
			.parse(
				JSON.parse(await readFile(join(directory, `${suite}.json`), "utf8")),
			);
		assert.equal(outer.status, "failed");
		await writeFile(
			join(directory, "passing-proof.json"),
			JSON.stringify({ ...local, receiptDigest: sha256(raw) }, null, 2),
		);
	});
	test(`invalidates the actual earlier ${suite} receipt after a genuine failed child canary`, {
		timeout: 60000,
	}, async () => {
		const directory = join(root, suite);
		const prior = receiptSchema.parse(
			JSON.parse(await readFile(join(directory, "passing-proof.json"), "utf8")),
		);
		const previous = process.env["PP_OUTPUT_CANARY_FAIL"];
		try {
			process.env["PP_OUTPUT_CANARY_FAIL"] = "1";
			assert.equal(
				await dispatchVerification({
					suite,
					mode: "offline",
					evidenceDir: directory,
				}),
				1,
			);
		} finally {
			if (previous === undefined) delete process.env["PP_OUTPUT_CANARY_FAIL"];
			else process.env["PP_OUTPUT_CANARY_FAIL"] = previous;
		}
		const failed = z
			.object({
				state: z.literal("failed-private-mechanisms"),
				code: z.literal("RUNTIME_FAILURE"),
				diagnostic: diagnosticSchema,
			})
			.parse(
				JSON.parse(
					await readFile(join(directory, `${suite}-local.json`), "utf8"),
				),
			);
		assert.equal(failed.diagnostic.reason, "child-exit");
		assert.equal(failed.diagnostic.exitCode, 1);
		assert.equal(failed.diagnostic.expectedTests, expectedCounts[suite]);
		assert.equal(failed.diagnostic.counts["tests"], expectedCounts[suite]);
		assert.equal(failed.diagnostic.counts["pass"], expectedCounts[suite] - 1);
		assert.equal(failed.diagnostic.counts["fail"], 1);
		for (const key of ["cancelled", "skipped", "todo"] as const)
			assert.equal(failed.diagnostic.counts[key], 0);
		assert.equal(failed.diagnostic.failures.length, 1);
		assert.equal(
			failed.diagnostic.failures[0]?.nameDigest,
			sha256("executes an independent production output canary"),
		);
		assert.notEqual(failed.diagnostic.executionNonce, prior.executionNonce);
		await assert.rejects(
			assertPrivateExecution(suite, directory),
			(error: unknown) => {
				assert.ok(error instanceof Error);
				const finite = z
					.object({ suite: z.literal(suite), diagnostic: diagnosticSchema })
					.parse(JSON.parse(error.message));
				assert.deepEqual(finite.diagnostic, failed.diagnostic);
				return true;
			},
		);
		const outer = z
			.object({
				status: z.literal("failed"),
				failure: z.object({ code: z.literal("RUNTIME_FAILURE") }),
			})
			.parse(
				JSON.parse(await readFile(join(directory, `${suite}.json`), "utf8")),
			);
		assert.equal(outer.failure.code, "RUNTIME_FAILURE");
	});
}
