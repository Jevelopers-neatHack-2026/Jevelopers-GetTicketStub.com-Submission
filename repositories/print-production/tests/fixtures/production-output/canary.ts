import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
test("executes an independent production output canary", () => {
	const directory =
		process.env["PP_OUTPUT_EVIDENCE_DIR"] ??
		process.env["PP_COMPOSITION_EVIDENCE_DIR"];
	assert.ok(directory);
	mkdirSync(directory, { recursive: true });
	writeFileSync(
		join(directory, "production-output-canary.json"),
		JSON.stringify({
			executed: true,
			executionNonce: process.env["PP_DURABILITY_EXECUTION_NONCE"],
		}),
	);
	assert.notEqual(
		process.env["PP_OUTPUT_CANARY_FAIL"],
		"1",
		"INTENTIONAL_OUTPUT_CANARY_FAILURE",
	);
});
