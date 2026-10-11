import { readlink } from "node:fs/promises";
import {
	requireCheck,
	VerificationFailure,
} from "../../dist/src/runtime/errors.js";
import { identifyPageRenderer } from "./page-renderer.mjs";
import { observeRootDiagnostic } from "./renderer-root-diagnostic.mjs";

export function requireRendererChroot(root) {
	requireCheck(
		typeof root === "string" &&
			/^\/proc\/[1-9]\d*\/fdinfo(?:\/)? \(deleted\)$/.test(root),
		"SANDBOX_POLICY_FAILURE",
		"Renderer filesystem root is not Chromium's deleted proc-fdinfo chroot.",
	);
	return {
		kind: "deleted-proc-fdinfo-chroot",
		source: "live-renderer-proc-root",
	};
}

export async function observeRendererChroots(browser, page) {
	try {
		const cdp = await browser.newBrowserCDPSession();
		try {
			const targetPid = await identifyPageRenderer(page);
			const value = await cdp.send("SystemInfo.getProcessInfo");
			const renderers = value.processInfo.filter((p) => p.type === "renderer");
			requireCheck(
				renderers.length > 0 &&
					renderers.length <= 16 &&
					renderers.every((p) => Number.isInteger(p.id) && p.id > 1),
				"SANDBOX_POLICY_FAILURE",
				"Live renderer identity unavailable for chroot observation.",
			);
			const processes = await Promise.all(
				renderers.map((p) => observeRootDiagnostic(p.id, targetPid)),
			);
			console.log(
				JSON.stringify({
					rendererRootDiagnostic: {
						schemaVersion: 1,
						provenance: "LIVE_PROC_ROOT_AND_PINNED_FRAME_TRACE",
						targetBinding: renderers.some((p) => p.id === targetPid)
							? "OBSERVED"
							: "UNAVAILABLE",
						processes,
					},
				}),
			);
			requireCheck(
				renderers.some((p) => p.id === targetPid),
				"SANDBOX_POLICY_FAILURE",
				"Bound page renderer is absent from the process snapshot.",
			);
			return await Promise.all(
				renderers.map(async (p) =>
					requireRendererChroot(await readlink(`/proc/${p.id}/root`)),
				),
			);
		} finally {
			await cdp.detach();
		}
	} catch (error) {
		if (error instanceof VerificationFailure) throw error;
		const reason =
			error instanceof Error && "code" in error
				? error.code === "EACCES" || error.code === "EPERM"
					? "ACCESS_DENIED"
					: error.code === "ENOENT"
						? "PROCESS_OR_ROOT_UNAVAILABLE"
						: "UNKNOWN_FAILURE"
				: "UNKNOWN_FAILURE";
		throw new VerificationFailure(
			"SANDBOX_POLICY_FAILURE",
			`Live renderer filesystem isolation could not be observed [${reason}].`,
		);
	}
}
