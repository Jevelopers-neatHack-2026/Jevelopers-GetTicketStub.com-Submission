import { test } from "node:test";
import assert from "node:assert/strict";
import {
	classifySandboxLaunchFailure,
	failureReceipt,
	VerificationFailure,
} from "../../src/runtime/errors.js";

const stderr = (line: string) =>
	new Error(
		`browserType.launch: Target page, context or browser has been closed\nCall log:\n  - <launching> /private/fixture/chrome --argument=https://private.invalid/token\n  - [pid=42][err] ${line}\n`,
	);

for (const [category, line] of [
	[
		"SANDBOX_UNAVAILABLE",
		"[42:42:1010/000000:FATAL:zygote_host_impl_linux.cc:130] No usable sandbox! See https://private.invalid/token",
	],
	[
		"NAMESPACE_CREATE_DENIED",
		"Failed to move to new namespace: PID namespaces supported, Network namespace supported, but failed: errno = Operation not permitted",
	],
	[
		"NAMESPACE_ID_MAP_FAILURE",
		'Check failed: NamespaceUtils::WriteToIdMapFile("/proc/self/uid_map", uid_)',
	],
	[
		"THREAD_CREATE_DENIED",
		"[42:42:ERROR:platform_thread_posix.cc:1] pthread_create: Operation not permitted (1)",
	],
	[
		"THREAD_RESOURCE_EXHAUSTED",
		"pthread_create: Resource temporarily unavailable (11)",
	],
	[
		"CRASHPAD_DATABASE_REQUIRED",
		"chrome_crashpad_handler: --database is required",
	],
	["CRASHPAD_START_FAILURE", "crashpad handler couldn't start"],
	[
		"FILESYSTEM_READ_ONLY",
		"mkdir /private/customer-path: Read-only file system (30)",
	],
	[
		"FILESYSTEM_ACCESS_DENIED",
		"open /private/customer-path: Permission denied (13)",
	],
	[
		"PROFILE_LOCK_FAILURE",
		"Failed to create a ProcessSingleton for your profile directory. /private/customer-path",
	],
	[
		"ROOT_USER_FORBIDDEN",
		"Running as root without --no-sandbox is not supported",
	],
	["ZYGOTE_START_FAILURE", "Failed to launch zygote process"],
	[
		"SECCOMP_INSTALL_FAILURE",
		"Failed to install seccomp filter: Invalid argument",
	],
] as const) {
	test(`emits only ${category} when a known Chrome stderr signature is observed`, () => {
		assert.deepEqual(classifySandboxLaunchFailure(stderr(line)), [category]);
	});
}

test("keeps launch reason unknown when diagnostic text has no Chrome stderr provenance", () => {
	for (const value of [
		undefined,
		"No usable sandbox!",
		new Error("No usable sandbox!"),
		new Error("<launching> /private/chrome --url='No usable sandbox!'"),
		new Error("[pid=42][out] No usable sandbox!"),
		stderr("Operation not permitted"),
		stderr("unrecognized launch failure with secret=do-not-record"),
	])
		assert.deepEqual(classifySandboxLaunchFailure(value), [
			"UNKNOWN_LAUNCH_FAILURE",
		]);
});

test("bounds classification when oversized raw errors or lines are supplied", () => {
	assert.deepEqual(
		classifySandboxLaunchFailure(
			new Error(`${"x".repeat(65536)}\n  - [pid=42][err] No usable sandbox!`),
		),
		["UNKNOWN_LAUNCH_FAILURE"],
	);
	assert.deepEqual(
		classifySandboxLaunchFailure(
			stderr(`No usable sandbox! ${"x".repeat(2048)}`),
		),
		["UNKNOWN_LAUNCH_FAILURE"],
	);
});

test("retains multiple observed categories without guessing the enforcing layer", () => {
	const error = stderr(
		"No usable sandbox!\n  - [pid=42][err] pthread_create: Operation not permitted (1)",
	);
	assert.deepEqual(classifySandboxLaunchFailure(error), [
		"SANDBOX_UNAVAILABLE",
		"THREAD_CREATE_DENIED",
	]);
});

test("sanitizes hostile paths URLs secrets and extra error properties in a classified receipt", () => {
	const error = stderr(
		"mkdir /private/customer-path?secret=token: Read-only file system (30)",
	);
	Object.assign(error, {
		cause: "secret=token",
		extra: "https://private.invalid",
	});
	const receipt = failureReceipt(
		new VerificationFailure(
			"SANDBOX_POLICY_FAILURE",
			`Sandboxed Chromium launch failed [${classifySandboxLaunchFailure(error).join(",")}]; no unsandboxed fallback is permitted.`,
		),
	);
	assert.deepEqual(receipt, {
		code: "SANDBOX_POLICY_FAILURE",
		message:
			"Sandboxed Chromium launch failed [FILESYSTEM_READ_ONLY]; no unsandboxed fallback is permitted.",
	});
	const serialized = JSON.stringify(receipt);
	for (const privateValue of [
		"/private",
		"https://",
		"token",
		"secret",
		"cause",
		"extra",
	])
		assert.ok(!serialized.includes(privateValue));
});
