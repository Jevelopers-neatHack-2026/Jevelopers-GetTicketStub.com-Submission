import { test } from "node:test";
import { once } from "node:events";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
	inspectLinuxSandbox,
	openOfflineBrowser,
} from "../../dist/src/exporters/offline-browser.js";
import {
	loadPins,
	observeLinuxContainerSecurity,
} from "../../dist/src/runtime/environment.js";
import { VerificationFailure } from "../../dist/src/runtime/errors.js";
import { observeRendererChroots } from "./renderer-chroot.mjs";
import { captureRendererRoot } from "./renderer-root-capture.mjs";

assert.equal(process.platform, "linux");

test("observes active sandbox and private IPC in the real Linux browser", async () => {
	const container = await observeLinuxContainerSecurity();
	const opened = await openOfflineBrowser(await loadPins());
	try {
		const page = await opened.context.newPage();
		await page.setContent(
			"<html><body>Fixed renderer chroot probe</body></html>",
		);
		assert.equal(opened.sandbox.kind, "linux-namespace-seccomp");
		assert.ok(opened.sandbox.rendererProcesses.length > 0);
		assert.notEqual(container.ipcNamespace, container.hostNamespaces.ipc);
		assert.deepEqual(container.interfaces, ["lo"]);
		const rendererChroots = await observeRendererChroots(opened.browser, page);
		console.log(
			JSON.stringify({
				linuxSecurity: { container, sandbox: opened.sandbox, rendererChroots },
			}),
		);
	} finally {
		await opened.browser.close();
	}
});

test("rejects an actual browser when its renderer sandbox is deliberately disabled", async () => {
	const browser = await chromium.launch({
		executablePath: chromium.executablePath(),
		chromiumSandbox: false,
	});
	try {
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.setContent(
			"<html><body>Fixed unsandboxed negative probe</body></html>",
		);
		await assert.rejects(
			observeRendererChroots(browser, page),
			(error) =>
				error instanceof VerificationFailure &&
				error.code === "SANDBOX_POLICY_FAILURE" &&
				error.message ===
					"Renderer filesystem root does not satisfy the live proc-fdinfo isolation invariant.",
		);
		await assert.rejects(
			inspectLinuxSandbox(browser),
			(error) =>
				error instanceof VerificationFailure &&
				error.code === "SANDBOX_POLICY_FAILURE",
		);
	} finally {
		await browser.close();
	}
});

test("rejects a genuinely exited process after acquiring proc and root anchors", async () => {
	const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
		stdio: "ignore",
	});
	let capture;
	try {
		await once(child, "spawn");
		capture = await captureRendererRoot(child.pid);
		const exited = once(child, "exit");
		child.kill("SIGTERM");
		await exited;
		await assert.rejects(
			capture.verify(),
			(error) =>
				error instanceof VerificationFailure &&
				error.code === "SANDBOX_POLICY_FAILURE" &&
				[
					"Renderer process or anchored root became unavailable during observation.",
					"Renderer process generation is stale or unavailable.",
				].includes(error.message),
		);
	} finally {
		try {
			await capture?.close();
		} finally {
			child.kill("SIGKILL");
		}
	}
});

test("fails closed without retry when a real sandboxed launch cannot start", async (t) => {
	const launch = chromium.launch.bind(chromium);
	let attempts = 0;
	t.mock.method(chromium, "launch", (options) => {
		attempts++;
		return launch({
			...options,
			args: [
				...options.args,
				"--disable-namespace-sandbox",
				"--disable-setuid-sandbox",
			],
		});
	});
	await assert.rejects(
		openOfflineBrowser(await loadPins()),
		(error) =>
			error instanceof VerificationFailure &&
			error.code === "SANDBOX_POLICY_FAILURE",
	);
	assert.equal(attempts, 1);
});
