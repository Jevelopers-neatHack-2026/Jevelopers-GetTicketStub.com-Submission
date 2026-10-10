import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	probeBrowserLaunch,
	summarizeBrowserDebug,
} from "./browser-launch-probe.mjs";
import catalog from "./chromium-launch-sources.json" with { type: "json" };
import { loadPins } from "../../dist/src/runtime/environment.js";

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

test("emits an upstream-validated previously unmapped source and line without its message", () => {
	const result = summarizeBrowserDebug(
		"pw:browser [pid=42][err] [42:42:1010/000000.000:ERROR:dbus/bus.cc:408] secret=token /private/customer https://private.invalid",
	);
	assert.equal(result.unclassifiedSevereLine, true);
	assert.equal(result.unvalidatedSevereLine, false);
	assert.deepEqual(result.sourceSites, [
		{
			basename: "bus.cc",
			line: 408,
			severity: "ERROR",
			cause: "UNKNOWN_CAUSE",
		},
	]);
	for (const value of ["secret", "token", "/private", "https://", "dbus/"])
		assert.ok(!JSON.stringify(result).includes(value));
});

test("rejects arbitrary source names paths line bounds and unframed locations", () => {
	for (const location of [
		"customer_secret.cc:42",
		"private/credentials.cc:56",
		"/private/credentials.cc:56",
		"https://private.invalid/credentials.cc:56",
		"credentials.cc:0",
		"credentials.cc:-1",
		"credentials.cc:100000",
		"credentials.cc:99999",
		"credentials.cc:1secret",
		"credentials.cc:00056",
	]) {
		const result = summarizeBrowserDebug(
			`pw:browser [pid=42][err] [42:42:1010/000000.000:FATAL:${location}] secret=token`,
		);
		assert.deepEqual(result.sourceSites, []);
		assert.equal(result.unvalidatedSevereLine, true);
		assert.ok(!JSON.stringify(result).includes("secret"));
	}
	assert.deepEqual(
		summarizeBrowserDebug(
			"[42:42:1010/000000.000:FATAL:credentials.cc:56] secret=token",
		).sourceSites,
		[],
	);
});

test("accepts pinned build-relative source paths and deduplicates validated sites", () => {
	const line =
		"pw:browser [pid=42][err] [42:42:1010/000000.000:FATAL:../../content/zygote/zygote_linux.cc:588] secret=token";
	assert.deepEqual(summarizeBrowserDebug(`${line}\n${line}`).sourceSites, [
		{
			basename: "zygote_linux.cc",
			line: 588,
			severity: "FATAL",
			cause: "UNKNOWN_CAUSE",
		},
	]);
});

test("reports only source-backed raw-check categories without inventing a source location", () => {
	const result = summarizeBrowserDebug(
		[
			'pw:browser [pid=42][err] Check failed: NamespaceUtils::WriteToIdMapFile("/proc/self/uid_map", uid_)',
			"pw:browser [pid=42][err] LaunchProcess: failed to execvp:",
			"pw:browser [pid=42][err] /private/executable secret=token",
			"pw:browser [pid=42][out] Check failed: NamespaceUtils::DenySetgroups()",
			'pw:browser [pid=42][err] Check failed: NamespaceUtils::WriteToIdMapFile("/private/customer", uid_)',
		].join("\n"),
	);
	assert.deepEqual(result.startupCauses, [
		"NAMESPACE_UID_MAP_FAILURE",
		"PREEXEC_EXECVP_FAILURE",
	]);
	assert.deepEqual(result.sourceSites, []);
	assert.ok(!JSON.stringify(result).includes("/"));
	assert.ok(!JSON.stringify(result).includes("token"));
});

test("distinguishes reported zygote child exit classes from the parent browser signal", () => {
	for (const [code, cause] of [
		["-1", "ZYGOTE_CHILD_TERMINATED_BY_SIGNAL"],
		["1", "ZYGOTE_CHILD_EXIT_1"],
		["127", "ZYGOTE_CHILD_EXIT_127"],
		["42", "ZYGOTE_CHILD_EXIT_OTHER"],
	]) {
		const result = summarizeBrowserDebug(
			`pw:browser [pid=42][err] [42:42:1010/000000.000:FATAL:content/browser/zygote_host/zygote_host_impl_linux.cc:228] Zygote process exited prematurely with exit code ${code}\npw:browser [pid=42] <process did exit: exitCode=null, signal=SIGABRT>`,
		);
		assert.equal(result.sourceSites[0].cause, cause);
		assert.deepEqual(result.processSignals, ["SIGABRT"]);
	}
});

test("keeps the source catalog tied to the accepted browser with bounded canonical names", async () => {
	assert.equal(catalog.browserVersion, (await loadPins()).browser.version);
	assert.equal(
		catalog.chromiumCommit,
		"f842f52ef39fd97b449eb27cff414bf05a98ddce",
	);
	for (const source of catalog.sources) {
		assert.match(source.path, /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)+\.cc$/);
		assert.match(source.blob, /^[a-f0-9]{40}$/);
		assert.ok(
			Number.isInteger(source.lines) &&
				source.lines > 0 &&
				source.lines < 100000,
		);
	}
});
