import { readlink } from "node:fs/promises";
import {
	requireCheck,
	VerificationFailure,
} from "../../dist/src/runtime/errors.js";

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

export async function observeRendererChroots(browser) {
	try {
		const cdp = await browser.newBrowserCDPSession();
		try {
			const value = await cdp.send("SystemInfo.getProcessInfo");
			const renderers = value.processInfo.filter((p) => p.type === "renderer");
			requireCheck(
				renderers.length > 0 &&
					renderers.every((p) => Number.isInteger(p.id) && p.id > 1),
				"SANDBOX_POLICY_FAILURE",
				"Live renderer identity unavailable for chroot observation.",
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
