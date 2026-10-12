import assert from "node:assert/strict";
import "./page-renderer.test.mjs";
import { test } from "node:test";
import { rootCategory } from "./renderer-root-diagnostic.mjs";
import { frameProcessIds, identifyPageRenderer } from "./page-renderer.mjs";
import { openOfflineBrowser } from "../../dist/src/exporters/offline-browser.js";
import { loadPins } from "../../dist/src/runtime/environment.js";
import {
	parseRendererGeneration,
	requireStableRendererGeneration,
	requireStableRoot,
	classifyFdinfoDirectoryError,
} from "./renderer-root-identity.mjs";

test("emits only finite root categories without accepting a different root as chroot proof", () => {
	for (const [root, category] of [
		["/proc/42/fdinfo (deleted)", "PROC_FDINFO_DELETED"],
		["/proc/42/fdinfo", "PROC_FDINFO_LINKED"],
		["/", "CONTAINER_ROOT_PATH"],
		["/private/customer?secret=token (deleted)", "OTHER_DELETED_ROOT"],
		["/private/customer?secret=token", "OTHER_ROOT"],
		["x".repeat(4097), "UNAVAILABLE"],
		[undefined, "UNAVAILABLE"],
	])
		assert.equal(rootCategory(root), category);
});

test("binds only the matching frame from pinned browser trace metadata", () => {
	const frame = "a".repeat(32);
	const events = [
		{
			name: "TracingStartedInBrowser",
			args: {
				data: {
					frames: [
						{
							frame,
							processId: 42,
							url: "https://private.invalid?secret=token",
						},
						{ frame: "b".repeat(32), processId: 43 },
						{ frame, processId: "44" },
					],
				},
			},
		},
		{ name: "unknown", args: { data: { frames: [{ frame, processId: 99 }] } } },
	];
	assert.deepEqual(frameProcessIds(events, frame), [42]);
	assert.deepEqual(frameProcessIds(events, "c".repeat(32)), []);
	assert.deepEqual(
		frameProcessIds(
			[
				{
					name: "TracingStartedInBrowser",
					args: { data: { frames: Array(65).fill({ frame, processId: 42 }) } },
				},
			],
			frame,
		),
		[],
	);
});

test("binds the actual fixed page renderer to the real browser process snapshot", async () => {
	const opened = await openOfflineBrowser(await loadPins());
	try {
		const page = await opened.context.newPage();
		await page.setContent(
			"<html><body>Fixed page renderer binding</body></html>",
		);
		const pid = await identifyPageRenderer(page);
		const cdp = await opened.browser.newBrowserCDPSession();
		try {
			const processes = await cdp.send("SystemInfo.getProcessInfo");
			assert.ok(
				processes.processInfo.some(
					(p) => p.type === "renderer" && p.id === pid,
				),
			);
		} finally {
			await cdp.detach();
		}
	} finally {
		await opened.browser.close();
	}
});

test("detects PID reuse zombie and malformed generations without exposing proc text", () => {
	const stat = (pid, state, started) =>
		`${pid} (private ) token=secret) ${state} ${Array(18).fill("0").join(" ")} ${started}`;
	const before = parseRendererGeneration(stat(42, "S", "1234"));
	assert.deepEqual(before, { pid: "42", startTime: "1234" });
	requireStableRendererGeneration(
		before,
		parseRendererGeneration(stat(42, "R", "1234")),
	);
	assert.throws(() =>
		requireStableRendererGeneration(
			before,
			parseRendererGeneration(stat(42, "S", "5678")),
		),
	);
	assert.throws(() =>
		requireStableRendererGeneration(
			before,
			parseRendererGeneration(stat(43, "S", "1234")),
		),
	);
	for (const value of [
		stat(42, "Z", "1234"),
		stat(42, "S", "bad"),
		"private malformed proc stat",
	])
		assert.throws(
			() => parseRendererGeneration(value),
			(error) =>
				error.code === "SANDBOX_POLICY_FAILURE" &&
				!error.message.includes("secret"),
		);
});

test("detects root replacement independently of pathname representation", () => {
	requireStableRoot({ dev: 1n, ino: 2n }, { dev: 1n, ino: 2n });
	assert.throws(() =>
		requireStableRoot({ dev: 1n, ino: 2n }, { dev: 1n, ino: 3n }),
	);
	assert.throws(() =>
		requireStableRoot({ dev: 1n, ino: 2n }, { dev: 2n, ino: 2n }),
	);
});

test("classifies dead fdinfo owners only at the anchored directory stage", () => {
	assert.equal(
		classifyFdinfoDirectoryError(
			Object.assign(new Error("secret=token"), { code: "ESRCH" }),
		),
		"FDINFO_OWNER_GONE_ESRCH",
	);
	assert.equal(
		classifyFdinfoDirectoryError(
			Object.assign(new Error("secret=token"), { code: "ENOENT" }),
		),
		"FDINFO_OWNER_GONE_ENOENT",
	);
	assert.equal(
		classifyFdinfoDirectoryError(
			Object.assign(new Error("secret=token"), { code: "EACCES" }),
		),
		"ACCESS_DENIED",
	);
	assert.equal(
		classifyFdinfoDirectoryError(new Error("secret=token")),
		"UNKNOWN_FAILURE",
	);
});
