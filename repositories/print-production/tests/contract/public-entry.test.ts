import { test } from "node:test";
import assert from "node:assert/strict";

test("imports the compiled ESM package when consumed through its declared export", async () => {
	// Given the emitted package. When imported by package name. Then only local runtime API exists.
	const api = await import("@jevelopers/print-production");
	assert.deepEqual(Object.keys(api).sort(), [
		"VerificationFailure",
		"renderCalibration",
		"verifyRuntime",
	]);
	assert.equal(typeof api.renderCalibration, "function");
	assert.equal(typeof api.verifyRuntime, "function");
});
