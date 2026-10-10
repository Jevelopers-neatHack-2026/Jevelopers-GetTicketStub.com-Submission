import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	probeBrowserLaunch,
	summarizeBrowserDebug,
} from "./browser-launch-probe.mjs";

test("observes the pinned Playwright launch lifecycle without exposing its command", () => {
	const log =
		"pw:browser <launching> /private/chrome --secret=token\npw:browser <launched> pid=42\npw:browser [pid=42] <process did exit: exitCode=null, signal=SIGTRAP>\n";
	const result = summarizeBrowserDebug(log);
	assert.equal(result.playwrightLaunchObserved, true);
	assert.equal(result.playwrightExitObserved, true);
	assert.deepEqual(result.processSignals, ["SIGTRAP"]);
	assert.ok(!JSON.stringify(result).includes("token"));
});

test("distinguishes a Chrome credential failure from its downstream zygote failure", () => {
	const log = [
		'pw:browser [pid=42][err] [42:42:1010/000000.000:FATAL:credentials.cc:56] Check failed: sys_chroot("/private/customer") == 0. : Operation not permitted (1)',
		"pw:browser [pid=42][err] [42:42:1010/000000.001:FATAL:zygote_host_impl_linux.cc:202] Failed to receive boot message from zygote",
	].join("\n");
	const result = summarizeBrowserDebug(log);
	assert.deepEqual(result.categories, ["ZYGOTE_START_FAILURE"]);
	assert.deepEqual(result.zygoteStages, ["BOOT_MESSAGE"]);
	assert.deepEqual(result.observations, [
		{
			source: "SANDBOX_CREDENTIALS",
			severity: "FATAL",
			operations: ["CHROOT"],
			errnos: ["EPERM"],
		},
		{ source: "ZYGOTE_HOST", severity: "FATAL", operations: [], errnos: [] },
	]);
	assert.equal(result.chromeStderrObserved, true);
	assert.ok(!JSON.stringify(result).includes("/private"));
});

test("does not classify command stdout unframed or unknown diagnostic content", () => {
	const log = [
		"pw:browser <launching> /private/chrome --argument='No usable sandbox!'",
		"pw:browser [pid=42][out] No usable sandbox!",
		"No usable sandbox!",
		"pw:browser [pid=42][err] secret=token unrecognized diagnostic",
		"pw:browser [pid=42][err] [42:42:1010/000000.000:FATAL:private.cc:1] secret=token",
	].join("\n");
	const result = summarizeBrowserDebug(log);
	assert.deepEqual(result.categories, ["UNKNOWN_LAUNCH_FAILURE"]);
	assert.deepEqual(result.observations, []);
	assert.equal(result.unclassifiedSevereLine, true);
	assert.ok(!JSON.stringify(result).includes("token"));
});

test("recognizes only allowlisted Chromium source paths without returning a path", () => {
	const result = summarizeBrowserDebug(
		'pw:browser [pid=42][err] [42:42:1010/000000.000:FATAL:sandbox/linux/services/credentials.cc:56] Check failed: sys_chroot("/private") == 0.\npw:browser [pid=42][err] [42:42:1010/000000.000:FATAL:private/credentials.cc:56] Permission denied',
	);
	assert.deepEqual(result.observations, [
		{
			source: "SANDBOX_CREDENTIALS",
			severity: "FATAL",
			operations: ["CHROOT"],
			errnos: [],
		},
	]);
	assert.equal(result.unclassifiedSevereLine, true);
	assert.ok(!JSON.stringify(result).includes("/"));
});

test("bounds classification and deduplicates only safe enum observations", () => {
	const line =
		"pw:browser [pid=42][err] [42:42:1010/000000.000:ERROR:platform_thread_posix.cc:1] pthread_create: Operation not permitted (1)";
	const result = summarizeBrowserDebug(
		`${line}\n${line}\n${"x".repeat(65536)}\npw:browser [pid=42][err] No usable sandbox!`,
	);
	assert.deepEqual(result.categories, ["THREAD_CREATE_DENIED"]);
	assert.equal(result.observations.length, 1);
	assert.deepEqual(
		summarizeBrowserDebug(
			`pw:browser [pid=42][err] No usable sandbox! ${"x".repeat(2048)}`,
		).categories,
		["UNKNOWN_LAUNCH_FAILURE"],
	);
});

test("captures the real adapter launch lifecycle with debug output confined to the subprocess", async () => {
	const original = process.env.DEBUG;
	const originalFile = process.env.DEBUG_FILE;
	const directory = await mkdtemp(join(tmpdir(), "pp01a-debug-sink-test-"));
	const debugFile = join(directory, "must-not-be-written.log");
	process.env.DEBUG_FILE = debugFile;
	try {
		const result = await probeBrowserLaunch();
		assert.equal(result.playwrightLaunchObserved, true);
		assert.equal(result.playwrightExitObserved, true);
		assert.equal(result.truncated, false);
		assert.equal(result.cleanupFailed, false);
		assert.ok(["SUCCEEDED", "SANDBOX_POLICY_FAILURE"].includes(result.outcome));
		assert.equal(process.env.DEBUG, original);
		assert.equal(result.provenance, "PLAYWRIGHT_BROWSER_DEBUG_STDERR");
		await assert.rejects(readFile(debugFile), { code: "ENOENT" });
	} finally {
		if (originalFile === undefined) delete process.env.DEBUG_FILE;
		else process.env.DEBUG_FILE = originalFile;
		await rm(directory, { recursive: true, force: true });
	}
});
