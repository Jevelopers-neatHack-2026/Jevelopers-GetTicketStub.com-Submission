import { test } from "node:test";
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
		const rendererChroots = await observeRendererChroots(opened.browser);
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
