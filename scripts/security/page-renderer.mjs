import {
	requireCheck,
	VerificationFailure,
} from "../../dist/src/runtime/errors.js";

export function createBindingCollector(frameId) {
	const ids = new Set();
	let bytes = 0;
	let mappings = 0;
	let failure;
	return {
		collect(events) {
			if (failure) return;
			if (!Array.isArray(events)) {
				failure = "MALFORMED_TRACE";
				return;
			}
			try {
				bytes += Buffer.byteLength(JSON.stringify(events), "utf8");
			} catch (error) {
				failure = "MALFORMED_TRACE";
				return;
			}
			if (bytes > 65536) {
				failure = "TRACE_BYTE_LIMIT";
				return;
			}
			for (const event of events) {
				if (
					!event ||
					![
						"TracingStartedInBrowser",
						"ProcessReadyInBrowser",
						"FrameCommittedInBrowser",
					].includes(event.name)
				)
					continue;
				if (++mappings > 256) {
					failure = "MAPPING_EVENT_LIMIT";
					return;
				}
				const data = event.args?.data;
				const frames =
					event.name === "TracingStartedInBrowser" ? data?.frames : [data];
				if (!Array.isArray(frames)) continue;
				if (frames.length > 64) {
					failure = "FRAME_LIMIT";
					return;
				}
				for (const frame of frames) {
					if (
						frame?.frame === frameId &&
						Number.isInteger(frame.processId) &&
						frame.processId > 1
					)
						ids.add(frame.processId);
				}
			}
		},
		result() {
			return { ids: [...ids], failure };
		},
	};
}

export function frameProcessIds(events, frameId) {
	const collector = createBindingCollector(frameId);
	collector.collect(events);
	const result = collector.result();
	return result.failure ? [] : result.ids;
}

/** Pinned Chromium trace metadata binds this page's root frame to an OS PID. */
export async function identifyPageRenderer(page) {
	try {
		const cdp = await page.context().newCDPSession(page);
		let tracing = false;
		let endSent = false;
		let timer;
		let collect;
		let onComplete;
		try {
			const { frameTree } = await cdp.send("Page.getFrameTree");
			const frameId = frameTree.frame.id;
			requireCheck(
				typeof frameId === "string" && /^[A-Fa-f0-9]{32}$/.test(frameId),
				"SANDBOX_POLICY_FAILURE",
				"Page root frame identity unavailable.",
			);
			const collector = createBindingCollector(frameId);
			collect = ({ value }) => collector.collect(value);
			cdp.on("Tracing.dataCollected", collect);
			let finish;
			const complete = new Promise((resolve) => {
				finish = resolve;
			});
			let dataLoss = false;
			onComplete = ({ dataLossOccurred }) => {
				dataLoss = dataLossOccurred === true;
				finish(true);
			};
			cdp.once("Tracing.tracingComplete", onComplete);
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
			// Pinned OnRecordingEnabled emits the frame tree before start replies.
			// End immediately; renderer RPCs inside this window add unrelated events.
			await cdp.send("Tracing.end");
			endSent = true;
			const ended = await Promise.race([
				complete,
				new Promise((resolve) => {
					timer = setTimeout(() => resolve(false), 5000);
				}),
			]);
			tracing = false;
			const result = collector.result();
			const failure =
				result.failure ??
				(ended !== true
					? "TRACE_TIMEOUT"
					: dataLoss
						? "TRACE_DATA_LOSS"
						: result.ids.length === 0
							? "NO_FRAME_IDENTITY"
							: result.ids.length !== 1
								? "AMBIGUOUS_FRAME_IDENTITY"
								: undefined);
			requireCheck(
				failure === undefined,
				"SANDBOX_POLICY_FAILURE",
				`Unique page renderer identity could not be observed within trace bounds [${failure}].`,
			);
			const confirmed = await cdp.send("Page.getFrameTree");
			requireCheck(
				confirmed.frameTree.frame.id === frameId,
				"SANDBOX_POLICY_FAILURE",
				"Page root frame changed during trace binding.",
			);
			return result.ids[0];
		} finally {
			clearTimeout(timer);
			if (collect) cdp.off("Tracing.dataCollected", collect);
			if (onComplete) cdp.off("Tracing.tracingComplete", onComplete);
			try {
				if (tracing && !endSent) await cdp.send("Tracing.end");
			} finally {
				await cdp.detach();
			}
		}
	} catch (error) {
		if (error instanceof VerificationFailure) throw error;
		throw new VerificationFailure(
			"SANDBOX_POLICY_FAILURE",
			"Page renderer binding could not be observed.",
		);
	}
}
