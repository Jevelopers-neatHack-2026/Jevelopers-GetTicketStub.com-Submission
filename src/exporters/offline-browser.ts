import { chromium, type Browser, type BrowserContext } from "playwright";
import { readFile } from "node:fs/promises";
import { requireCheck, VerificationFailure } from "../runtime/errors.js";
import type { RuntimePins } from "../runtime/environment.js";
import { sha256 } from "../runtime/resources.js";

export async function openOfflineBrowser(pins: RuntimePins): Promise<{
	readonly browser: Browser;
	readonly context: BrowserContext;
	readonly denied: string[];
	readonly binarySha256: string;
}> {
	const executable = chromium.executablePath();
	let binarySha256: string;
	try {
		binarySha256 = sha256(await readFile(executable));
	} catch (error) {
		if (error instanceof Error)
			throw new VerificationFailure(
				"BROWSER_PIN_MISMATCH",
				"Pinned browser binary is unavailable; run browser:install.",
			);
		throw error;
	}
	const expectedHash =
		process.platform === "darwin"
			? pins.browser.executableSha256.darwin
			: pins.browser.executableSha256.linux;
	requireCheck(
		binarySha256 === expectedHash,
		"BROWSER_PIN_MISMATCH",
		"Browser executable bytes differ from the accepted platform pin.",
	);
	const browser = await chromium.launch({
		executablePath: executable,
		headless: true,
		chromiumSandbox: process.platform !== "linux",
		args: [
			"--disable-background-networking",
			"--disable-component-update",
			"--disable-domain-reliability",
			"--disable-sync",
			"--no-pings",
			"--host-resolver-rules=MAP * ~NOTFOUND",
			"--force-color-profile=srgb",
		],
	});
	try {
		requireCheck(
			browser.version() === pins.browser.version,
			"BROWSER_PIN_MISMATCH",
			"Launched Chromium version differs from its pin.",
		);
		const context = await browser.newContext({
			viewport: { width: 384, height: 192 },
			deviceScaleFactor: 1,
			locale: pins.locale,
			timezoneId: pins.timezone,
			offline: true,
			serviceWorkers: "block",
			acceptDownloads: false,
			javaScriptEnabled: false,
			colorScheme: "light",
			reducedMotion: "reduce",
		});
		// Mutable request accumulator; only resource type is recorded, never its URL.
		const denied: string[] = [];
		await context.route("**/*", async (route) => {
			denied.push(route.request().resourceType());
			await route.abort("blockedbyclient");
		});
		await context.routeWebSocket("**/*", (socket) => {
			denied.push("websocket");
			socket.close();
		});
		return { browser, context, denied, binarySha256 };
	} catch (error) {
		await browser.close();
		throw error;
	}
}

export async function probeNetwork(
	context: BrowserContext,
	denied: string[],
): Promise<void> {
	const page = await context.newPage();
	const before = denied.length;
	try {
		await page.setContent("<html><body></body></html>");
		const results = await page.evaluate(async () => {
			const request = fetch(
				"http://127.0.0.1:9/calibration-network-probe",
			).then(
				() => false,
				() => true,
			);
			const font = new FontFace(
				"DeniedRemoteFont",
				"url(https://fonts.invalid/calibration.woff2)",
			)
				.load()
				.then(
					() => false,
					() => true,
				);
			return Promise.all([request, font]);
		});
		requireCheck(
			results.every(Boolean) && denied.length - before === 2,
			"NETWORK_POLICY_FAILURE",
			"Both outbound fetch and remote font must be intercepted and denied.",
		);
	} finally {
		await page.close();
	}
}
