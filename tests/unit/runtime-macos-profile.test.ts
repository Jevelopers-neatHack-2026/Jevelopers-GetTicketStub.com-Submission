import { test } from "node:test";
import assert from "node:assert/strict";
import { macosProfileMismatchMessage } from "../../src/runtime/environment.js";

const pinned = {
	platform: "darwin",
	arch: "arm64",
	osRelease: "25.6.0",
	osVersion: "26.6.2",
};

test("names the pinned and observed macOS profiles and the authoritative evidence", () => {
	// Given a newer macOS host. When the mismatch message is built. Then it explains both sides.
	const message = macosProfileMismatchMessage(pinned, {
		arch: "arm64",
		osRelease: "27.0.0",
		osVersion: "27.0.1",
	});
	assert.ok(
		message.startsWith(
			"macOS calibration profile differs from its recorded pin",
		),
	);
	assert.ok(message.includes("pinned macOS 26.6.2 / Darwin 25.6.0 / arm64"));
	assert.ok(message.includes("host macOS 27.0.1 / Darwin 27.0.0 / arm64"));
	assert.ok(message.includes("Linux CI runtime workflow is the authoritative"));
	assert.ok(message.includes("docs/runtime/README.md"));
});

test("never echoes unbounded or unexpected host strings", () => {
	// Given hostile observed values. When the message is built. Then only fixed placeholders appear.
	const message = macosProfileMismatchMessage(pinned, {
		arch: "arm64\n/Users/someone",
		osRelease: "x".repeat(64),
		osVersion: "27.0.1 (secret)",
	});
	assert.ok(!message.includes("/Users/"));
	assert.ok(!message.includes("secret"));
	assert.ok(!message.includes("x".repeat(33)));
	assert.ok(
		message.includes(
			"host macOS unrecognized / Darwin unrecognized / unrecognized",
		),
	);
});
