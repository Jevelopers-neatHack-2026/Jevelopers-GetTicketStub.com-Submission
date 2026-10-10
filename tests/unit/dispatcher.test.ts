import { test } from "node:test";
import assert from "node:assert/strict";
import { parseArguments, suiteNames } from "../../scripts/verify/dispatcher.js";
import { loadPins, parsePins } from "../../src/runtime/environment.js";
import {
	VerificationFailure,
	failureReceipt,
} from "../../src/runtime/errors.js";

test("rejects missing tool pins when the pin file is incomplete", () => {
	// Given incomplete mandatory identities. When parsed. Then no default is inferred.
	assert.throws(
		() => parsePins({ node: "24.21.0" }),
		(error: unknown) =>
			error instanceof VerificationFailure &&
			error.code === "TOOL_PIN_MISMATCH",
	);
});

test("rejects absent compiler pins when the tools map is empty", async () => {
	// Given an otherwise valid lock with absent tools. When parsed. Then the compiler cannot be skipped.
	const pins = await loadPins();
	assert.throws(
		() => parsePins({ ...pins, tools: {} }),
		(error: unknown) =>
			error instanceof VerificationFailure &&
			error.code === "TOOL_PIN_MISMATCH",
	);
});

for (const args of [
	[],
	["--suite"],
	["--suite", "unknown", "--mode", "offline", "--evidence-dir", "out"],
	["--suite", "runtime", "--mode", "online", "--evidence-dir", "out"],
	["--suite", "runtime", "--mode", "offline"],
	[
		"--suite",
		"runtime",
		"--suite",
		"runtime",
		"--mode",
		"offline",
		"--evidence-dir",
		"out",
	],
	[
		"--suite",
		"runtime",
		"--mode",
		"offline",
		"--evidence-dir",
		"out",
		"--extra",
		"value",
	],
]) {
	test(`rejects incomplete or unknown arguments when given ${JSON.stringify(args)}`, () => {
		// Given invalid argv. When parsed. Then reject with a typed failure.
		assert.throws(
			() => parseArguments(args),
			(error: unknown) =>
				error instanceof VerificationFailure &&
				error.code === "INVALID_ARGUMENTS",
		);
	});
}
test("parses each registered suite when all required flags are present", () => {
	// Given the mandatory suite list. When parsed. Then every suite dispatches by name.
	const parsed = suiteNames.map((suite) =>
		parseArguments([
			"--suite",
			suite,
			"--mode",
			"offline",
			"--evidence-dir",
			"out",
		]),
	);
	assert.deepEqual(
		parsed.map((item) => item.suite),
		suiteNames,
	);
});
test("sanitizes third-party exceptions when receipt is serialized", () => {
	// Given an exception containing sensitive values. When converted. Then no value survives.
	const failure = failureReceipt(
		new Error("/Users/example/private customer@example.com token=secret"),
	);
	assert.deepEqual(failure, {
		code: "RUNTIME_FAILURE",
		message: "Runtime operation failed; no unsanitized exception was recorded.",
	});
});
