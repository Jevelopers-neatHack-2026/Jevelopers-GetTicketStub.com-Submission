import {
	requireCheck,
	VerificationFailure,
} from "../../dist/src/runtime/errors.js";
import { identifyPageRenderer } from "./page-renderer.mjs";
import { captureRendererRoot } from "./renderer-root-capture.mjs";

export function requireRendererChroot(evidence) {
	requireCheck(
		evidence !== null &&
			typeof evidence === "object" &&
			["PROC_FDINFO_LINKED", "PROC_FDINFO_DELETED"].includes(
				evidence.rootCategory,
			) &&
			evidence.filesystem === "PROCFS" &&
			evidence.rootIdentity === "DISTINCT_CONTAINER_ROOT" &&
			["FDINFO_OWNER_GONE_ESRCH", "FDINFO_OWNER_GONE_ENOENT"].includes(
				evidence.rootDirectory,
			) &&
			evidence.namespaceSeccomp === "ACCEPTED" &&
			evidence.processLiveness === "STABLE" &&
			evidence.rootStability === "STABLE",
		"SANDBOX_POLICY_FAILURE",
		"Renderer filesystem root does not satisfy the live proc-fdinfo isolation invariant.",
	);
	return {
		kind: "proc-fdinfo-isolated-root",
		source: "live-page-bound-proc-root",
		rootCategory: evidence.rootCategory,
		filesystem: "PROCFS",
		rootIdentity: "DISTINCT_CONTAINER_ROOT",
		rootDirectory: evidence.rootDirectory,
		namespaceSeccomp: "ACCEPTED",
		processLiveness: "STABLE",
		rootStability: "STABLE",
	};
}

export async function observeRendererChroots(browser, page) {
	try {
		const cdp = await browser.newBrowserCDPSession();
		const captures = [];
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
			for (const p of renderers) captures.push(await captureRendererRoot(p.id));
			const finalTarget = await identifyPageRenderer(page);
			const finalSnapshot = await cdp.send("SystemInfo.getProcessInfo");
			const finalIds = finalSnapshot.processInfo
				.filter((p) => p.type === "renderer")
				.map((p) => p.id)
				.sort((a, b) => a - b);
			const initialIds = renderers.map((p) => p.id).sort((a, b) => a - b);
			requireCheck(
				finalTarget === targetPid &&
					JSON.stringify(finalIds) === JSON.stringify(initialIds),
				"SANDBOX_POLICY_FAILURE",
				"Renderer page binding or process snapshot changed during root observation.",
			);
			const processes = await Promise.all(
				captures.map(async (capture, index) => ({
					...(await capture.verify()),
					relevance:
						renderers[index].id === targetPid
							? "TARGET_PAGE_RENDERER"
							: "OTHER_RENDERER",
				})),
			);
			console.log(
				JSON.stringify({
					rendererRootDiagnostic: {
						schemaVersion: 2,
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
			return processes.map((process) => ({
				...requireRendererChroot(process),
				relevance: process.relevance,
			}));
		} finally {
			try {
				await Promise.all(captures.map((capture) => capture.close()));
			} finally {
				await cdp.detach();
			}
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
