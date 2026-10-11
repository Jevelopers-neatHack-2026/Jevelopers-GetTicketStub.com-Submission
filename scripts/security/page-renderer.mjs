import {
	requireCheck,
	VerificationFailure,
} from "../../dist/src/runtime/errors.js";

export function frameProcessIds(events, frameId) {
	const ids = [];
	for (const event of events.slice(0, 256)) {
		if (event.name !== "TracingStartedInBrowser") continue;
		const frames = event.args?.data?.frames;
		if (!Array.isArray(frames) || frames.length > 64) continue;
		for (const frame of frames) {
			if (
				frame.frame === frameId &&
				Number.isInteger(frame.processId) &&
				frame.processId > 1
			)
				ids.push(frame.processId);
		}
	}
	return [...new Set(ids)];
}

/** Pinned Chromium trace metadata binds this page's root frame to an OS PID. */
export async function identifyPageRenderer(page) {
	try {
		const cdp = await page.context().newCDPSession(page);
		let tracing = false;
		let timer;
		const ids = new Set();
		let overLimit = false;
		let count = 0;
		try {
			const { frameTree } = await cdp.send("Page.getFrameTree");
			const frameId = frameTree.frame.id;
			requireCheck(
				typeof frameId === "string" && /^[A-Fa-f0-9]{32}$/.test(frameId),
				"SANDBOX_POLICY_FAILURE",
				"Page root frame identity unavailable.",
			);
			const collect = ({ value }) => {
				count += value.length;
				if (count > 256) {
					overLimit = true;
					return;
				}
				for (const id of frameProcessIds(value, frameId)) ids.add(id);
			};
			cdp.on("Tracing.dataCollected", collect);
			let finish;
			const complete = new Promise((resolve) => {
				finish = resolve;
			});
			cdp.once("Tracing.tracingComplete", ({ dataLossOccurred }) => {
				overLimit ||= dataLossOccurred === true;
				finish(true);
			});
			await cdp.send("Tracing.start", {
				transferMode: "ReportEvents",
				traceConfig: {
					recordMode: "recordUntilFull",
					traceBufferSizeInKb: 64,
					includedCategories: ["disabled-by-default-devtools.timeline"],
					excludedCategories: ["*"],
				},
			});
			tracing = true;
			await cdp.send("Tracing.end");
			const ended = await Promise.race([
				complete,
				new Promise((resolve) => {
					timer = setTimeout(() => resolve(false), 5000);
				}),
			]);
			tracing = false;
			cdp.off("Tracing.dataCollected", collect);
			requireCheck(
				ended === true && !overLimit && ids.size === 1,
				"SANDBOX_POLICY_FAILURE",
				"Unique page renderer identity could not be observed within trace bounds.",
			);
			return [...ids][0];
		} finally {
			clearTimeout(timer);
			if (tracing) await cdp.send("Tracing.end");
			await cdp.detach();
		}
	} catch (error) {
		if (error instanceof VerificationFailure) throw error;
		throw new VerificationFailure(
			"SANDBOX_POLICY_FAILURE",
			"Page renderer binding could not be observed.",
		);
	}
}
