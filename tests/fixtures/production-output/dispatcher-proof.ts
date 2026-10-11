import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
	compositionExpectedTests,
	outputExpectedTests,
} from "../../../src/exporters/private-suite.js";
import type { SuiteName } from "../../../scripts/verify/dispatcher.js";
import { durabilityExpectedTests } from "../../../src/internal/independent-tests.js";
import { diagnosticSchema } from "../../../src/internal/independent-diagnostics.js";

const expected = {
	...compositionExpectedTests,
	...outputExpectedTests,
	"artifact-storage": durabilityExpectedTests["artifact-storage"] + 1,
	"restart-recovery": durabilityExpectedTests["restart-recovery"] + 1,
	"metering-traces": durabilityExpectedTests["metering-traces"] + 1,
};
const receiptSchema = z.discriminatedUnion("state", [
	z.object({
		state: z.literal("passed-private-mechanisms"),
		tests: z.number(),
		passed: z.number(),
		expectedTests: z.number(),
		exitCode: z.literal(0),
		executionNonce: z.string().uuid(),
		evidenceDir: z.string(),
		artifacts: z
			.array(
				z.object({
					path: z.string(),
					digest: z.string().regex(/^[a-f0-9]{64}$/),
				}),
			)
			.min(1),
	}),
	z.object({
		state: z.literal("failed-private-mechanisms"),
		diagnostic: diagnosticSchema.optional(),
	}),
]);

export async function assertPrivateExecution(
	suite: SuiteName,
	directory: string,
) {
	if (suite === "runtime" || suite === "api-contracts" || suite === "release")
		return;
	let decoded: unknown;
	try {
		decoded = JSON.parse(
			await readFile(join(directory, `${suite}-local.json`), "utf8"),
		);
	} catch (error) {
		if (error instanceof Error)
			assert.fail("Private execution receipt could not be decoded.");
		throw error;
	}
	const parsed = receiptSchema.safeParse(decoded);
	assert.ok(parsed.success, "Private execution receipt schema is invalid.");
	const receipt = parsed.data;
	if (receipt.state === "failed-private-mechanisms") {
		assert.fail(
			JSON.stringify({ suite, diagnostic: receipt.diagnostic ?? null }),
		);
	}
	assert.equal(receipt.tests, expected[suite]);
	assert.equal(receipt.passed, expected[suite]);
	assert.equal(receipt.expectedTests, expected[suite]);
	for (const artifact of receipt.artifacts) {
		const bytes: Uint8Array = await readFile(
			join(receipt.evidenceDir, artifact.path),
		);
		assert.equal(
			createHash("sha256").update(bytes).digest("hex"),
			artifact.digest,
		);
	}
	const canaryName =
		suite === "artifact-storage" ||
		suite === "restart-recovery" ||
		suite === "metering-traces"
			? "canary-executed.json"
			: "production-output-canary.json";
	z.object({
		executed: z.literal(true),
		executionNonce: z.literal(receipt.executionNonce),
	}).parse(
		JSON.parse(await readFile(join(receipt.evidenceDir, canaryName), "utf8")),
	);
}
