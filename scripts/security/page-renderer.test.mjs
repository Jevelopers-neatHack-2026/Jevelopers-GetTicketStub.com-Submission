import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import {
	createBindingCollector,
	frameProcessIds,
	identifyPageRenderer,
} from "./page-renderer.mjs";

const frame = "a".repeat(32);
const mapping = (id) => ({
	name: "TracingStartedInBrowser",
	args: { data: { frames: [{ frame, processId: id }] } },
});
const noise = () => ({
	name: "RunTask",
	ph: "X",
	args: { ignored: "private" },
});

function sessionFixture(events, options = {}) {
	const session = new EventEmitter();
	const calls = [];
	let frames = 0;
	session.send = async (method, params) => {
		calls.push(method);
		if (method === "Page.getFrameTree")
			return {
				frameTree: {
					frame: {
						id: options.changedFrame && frames++ > 0 ? "b".repeat(32) : frame,
					},
				},
			};
		if (method === "Tracing.start") {
			assert.equal(params.traceConfig.traceBufferSizeInKb, 64);
			return {};
		}
		if (method === "Tracing.end") {
			for (const value of events)
				session.emit("Tracing.dataCollected", { value });
			if (!options.timeout)
				session.emit("Tracing.tracingComplete", {
					dataLossOccurred: options.loss === true,
				});
			return {};
		}
		throw new Error("Unexpected fixed protocol method");
	};
	let detached = false;
	session.detach = async () => {
		detached = true;
	};
	return {
		page: { context: () => ({ newCDPSession: async () => session }) },
		calls,
		session,
		cleaned: () =>
			detached &&
			session.listenerCount("Tracing.dataCollected") === 0 &&
			session.listenerCount("Tracing.tracingComplete") === 0,
	};
}

test("binds a complete lossless trace with over 256 unrelated events within the same 64KiB budget", async () => {
	const events = [...Array.from({ length: 320 }, noise), mapping(42)];
	assert.ok(Buffer.byteLength(JSON.stringify(events)) < 65536);
	const fixture = sessionFixture([events]);
	assert.equal(await identifyPageRenderer(fixture.page), 42);
	assert.equal(fixture.calls.filter((m) => m === "Tracing.start").length, 1);
	assert.equal(fixture.calls.filter((m) => m === "Tracing.end").length, 1);
	assert.deepEqual(fixture.calls, [
		"Page.getFrameTree",
		"Tracing.start",
		"Tracing.end",
		"Page.getFrameTree",
	]);
	assert.equal(fixture.cleaned(), true);
});

test("recognizes pinned deferred process-ready metadata without selecting another frame", () => {
	const ready = {
		name: "ProcessReadyInBrowser",
		args: { data: { frame, processId: 42 } },
	};
	assert.deepEqual(
		frameProcessIds(
			[
				{
					name: "TracingStartedInBrowser",
					args: { data: { frames: [{ frame }] } },
				},
				ready,
			],
			frame,
		),
		[42],
	);
	assert.deepEqual(
		frameProcessIds(
			[{ ...ready, args: { data: { frame: "b".repeat(32), processId: 43 } } }],
			frame,
		),
		[],
	);
});

test("keeps complete trace-byte mapping-event and per-frame limits fail closed", () => {
	for (const [events, reason] of [
		[
			[{ name: "RunTask", args: { secret: "x".repeat(65536) } }, mapping(42)],
			"TRACE_BYTE_LIMIT",
		],
		[Array(257).fill(mapping(42)), "MAPPING_EVENT_LIMIT"],
		[
			[
				{
					name: "TracingStartedInBrowser",
					args: { data: { frames: Array(65).fill({ frame, processId: 42 }) } },
				},
			],
			"FRAME_LIMIT",
		],
	]) {
		const collector = createBindingCollector(frame);
		collector.collect(events);
		assert.equal(collector.result().failure, reason);
	}
	const collector = createBindingCollector(frame);
	collector.collect([mapping(42)]);
	collector.collect([
		{ name: "RunTask", args: { ignored: "x".repeat(33000) } },
	]);
	collector.collect([
		{ name: "RunTask", args: { ignored: "x".repeat(33000) } },
	]);
	assert.equal(collector.result().failure, "TRACE_BYTE_LIMIT");
});

test("rejects data loss missing and ambiguous identities without retrying or leaking trace data", async () => {
	for (const [events, options, reason] of [
		[[mapping(42)], { loss: true }, "TRACE_DATA_LOSS"],
		[[noise()], {}, "NO_FRAME_IDENTITY"],
		[[mapping(42), mapping(43)], {}, "AMBIGUOUS_FRAME_IDENTITY"],
		[
			[{ name: "RunTask", args: { secret: "token".repeat(14000) } }],
			{},
			"TRACE_BYTE_LIMIT",
		],
	]) {
		const fixture = sessionFixture([events], options);
		await assert.rejects(
			identifyPageRenderer(fixture.page),
			(error) =>
				error.code === "SANDBOX_POLICY_FAILURE" &&
				error.message.includes(`[${reason}]`) &&
				!error.message.includes("token"),
		);
		assert.equal(fixture.calls.filter((m) => m === "Tracing.start").length, 1);
		assert.equal(fixture.cleaned(), true);
	}
});

test("rejects a changed root frame after stopping its one trace before detaching", async () => {
	const fixture = sessionFixture([[mapping(42)]], { changedFrame: true });
	await assert.rejects(
		identifyPageRenderer(fixture.page),
		(error) =>
			error.code === "SANDBOX_POLICY_FAILURE" &&
			error.message === "Page root frame changed during trace binding.",
	);
	assert.equal(fixture.calls.filter((m) => m === "Tracing.end").length, 1);
	assert.equal(fixture.cleaned(), true);
});

test("fails closed at the existing trace deadline and removes listeners without another trace", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	const fixture = sessionFixture([[mapping(42)]], { timeout: true });
	const pending = identifyPageRenderer(fixture.page);
	const rejected = assert.rejects(
		pending,
		(error) =>
			error.code === "SANDBOX_POLICY_FAILURE" &&
			error.message.includes("[TRACE_TIMEOUT]"),
	);
	await new Promise(setImmediate);
	t.mock.timers.tick(5000);
	await rejected;
	assert.equal(fixture.calls.filter((m) => m === "Tracing.start").length, 1);
	assert.equal(fixture.calls.filter((m) => m === "Tracing.end").length, 1);
	assert.equal(fixture.cleaned(), true);
});
