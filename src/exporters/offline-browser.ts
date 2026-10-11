import { chromium, type Browser, type BrowserContext } from "playwright";
import { readFile } from "node:fs/promises";
import {
	classifySandboxLaunchFailure,
	requireCheck,
	VerificationFailure,
} from "../runtime/errors.js";
import type { RuntimePins } from "../runtime/environment.js";
import { sha256 } from "../runtime/resources.js";
import { z } from "zod";

const sandboxRowsSchema = z.record(z.string(), z.string());
const processInfoSchema = z.object({
	processInfo: z.array(
		z.object({ type: z.string(), id: z.number().int().positive() }),
	),
});

export function requireLinuxRendererStatus(status: string) {
	const field = (name: string) =>
		new RegExp(`^${name}:[ \\t]*(.+)$`, "m").exec(status)?.[1]?.trim();
	const uids = field("Uid")?.split(/\s+/).map(Number);
	const pids = field("NSpid")?.split(/\s+/).map(Number);
	const filters = Number(field("Seccomp_filters"));
	requireCheck(
		uids?.length === 4 &&
			uids.every((id) => Number.isInteger(id) && id > 0) &&
			pids !== undefined &&
			pids.length >= 2 &&
			pids.every((id) => Number.isInteger(id) && id > 0) &&
			["CapInh", "CapPrm", "CapEff", "CapAmb"].every((name) =>
				/^0+$/.test(field(name) ?? ""),
			) &&
			field("NoNewPrivs") === "1" &&
			field("Seccomp") === "2" &&
			Number.isInteger(filters) &&
			filters >= 2,
		"SANDBOX_POLICY_FAILURE",
		"Live renderer process lacks the required nested PID namespace and additional seccomp filter.",
	);
	return {
		uid: uids[0],
		pidNamespaceDepth: pids.length,
		seccompFilters: filters,
		noNewPrivileges: true,
		capabilities: "none" as const,
	};
}

export function requireLinuxSandbox(value: unknown) {
	const parsed = sandboxRowsSchema.safeParse(value);
	requireCheck(
		parsed.success,
		"SANDBOX_POLICY_FAILURE",
		"Chromium sandbox status is unavailable or malformed.",
	);
	const rows = parsed.data;
	requireCheck(
		rows["Layer 1 Sandbox"] === "Namespace" &&
			rows["PID namespaces"] === "Yes" &&
			rows["Network namespaces"] === "Yes" &&
			rows["Seccomp-BPF sandbox"] === "Yes" &&
			rows["Seccomp-BPF sandbox supports TSYNC"] === "Yes",
		"SANDBOX_POLICY_FAILURE",
		"Chromium requires active namespace and Seccomp-BPF renderer sandboxes.",
	);
	return {
		kind: "linux-namespace-seccomp" as const,
		source: "chrome://sandbox" as const,
		layer1: "Namespace" as const,
		pidNamespace: true,
		networkNamespace: true,
		seccompBpf: true,
		seccompTsync: true,
	};
}

/** Probe Chromium's zygote-backed sandbox report in this actual browser. */
export async function inspectLinuxSandbox(browser: Browser) {
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await page.goto("chrome://sandbox", { waitUntil: "load" });
		await page.locator("#sandbox-status tr").first().waitFor();
		const sandbox = requireLinuxSandbox(
			await page
				.locator("#sandbox-status tr")
				.evaluateAll((rows) =>
					Object.fromEntries(
						rows.map((row) => [
							row.children[0]?.textContent?.trim(),
							row.children[1]?.textContent?.trim(),
						]),
					),
				),
		);
		const cdp = await browser.newBrowserCDPSession();
		try {
			const processes = processInfoSchema.parse(
				await cdp.send("SystemInfo.getProcessInfo"),
			);
			const renderers = processes.processInfo.filter(
				(item) => item.type === "renderer",
			);
			requireCheck(
				renderers.length > 0,
				"SANDBOX_POLICY_FAILURE",
				"No live renderer was available for sandbox inspection.",
			);
			const rendererProcesses = await Promise.all(
				renderers.map(async ({ id }) =>
					requireLinuxRendererStatus(
						await readFile(`/proc/${id}/status`, "utf8"),
					),
				),
			);
			return { ...sandbox, rendererProcesses };
		} finally {
			await cdp.detach();
		}
	} catch (error) {
		if (error instanceof VerificationFailure) throw error;
		if (error instanceof Error)
			throw new VerificationFailure(
				"SANDBOX_POLICY_FAILURE",
				"Effective Chromium sandbox state could not be observed.",
			);
		throw error;
	} finally {
		await context.close();
	}
}

export async function openOfflineBrowser(pins: RuntimePins): Promise<{
	readonly browser: Browser;
	readonly context: BrowserContext;
	readonly denied: string[];
	readonly binarySha256: string;
	readonly sandbox:
		| Awaited<ReturnType<typeof inspectLinuxSandbox>>
		| { readonly kind: "macos-launch-sandbox-enabled" };
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
	let browser: Browser;
	try {
		browser = await chromium.launch({
			executablePath: executable,
			headless: true,
			chromiumSandbox: true,
			ignoreDefaultArgs: ["--disable-dev-shm-usage"],
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
	} catch (error) {
		if (error instanceof Error)
			throw new VerificationFailure(
				"SANDBOX_POLICY_FAILURE",
				`Sandboxed Chromium launch failed [${classifySandboxLaunchFailure(error).join(",")}]; no unsandboxed fallback is permitted.`,
			);
		throw error;
	}
	try {
		requireCheck(
			browser.version() === pins.browser.version,
			"BROWSER_PIN_MISMATCH",
			"Launched Chromium version differs from its pin.",
		);
		const sandbox =
			process.platform === "linux"
				? await inspectLinuxSandbox(browser)
				: { kind: "macos-launch-sandbox-enabled" as const };
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
		return { browser, context, denied, binarySha256, sandbox };
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
