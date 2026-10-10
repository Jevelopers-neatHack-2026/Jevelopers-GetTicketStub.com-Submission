import { test } from "node:test";
import assert from "node:assert/strict";
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
	DurabilityDatabase,
	defaultLimits,
	parse,
	idSchema,
	hash,
	type Limits,
} from "../../src/internal/durability.js";
import { LocalArtifactStore } from "../../src/storage/local-store.js";
import { DurableBatchEngine } from "../../src/jobs/durable-batch.js";
import { ObservationOutbox } from "../../src/telemetry/observations.js";
import { fixture, file, plan, scope } from "../fixtures/durability/fixture.js";
import { evidence } from "../fixtures/durability/evidence.js";

const worker = fileURLToPath(
	new URL("../fixtures/durability/worker.js", import.meta.url),
);
function child(
	path: string,
	mode: string,
	time = 1000,
	argument?: string,
	limits: Limits = defaultLimits,
) {
	const process = fork(
		worker,
		[path, mode, String(time), ...(argument ? [argument] : [])],
		{
			execPath: globalThis.process.execPath,
			stdio: ["ignore", "ignore", "pipe", "ipc"],
			timeout: 15000,
			killSignal: "SIGKILL",
			env: {
				...globalThis.process.env,
				PP_DURABILITY_TEST_LIMITS: JSON.stringify(limits),
			},
		},
	);
	const exited = new Promise<{
		readonly code: number | null;
		readonly signal: NodeJS.Signals | null;
	}>((resolve, reject) => {
		process.once("error", reject);
		process.once("exit", (code, signal) => resolve({ code, signal }));
	});
	let stderr = "";
	process.stderr?.on("data", (data: Buffer) => {
		stderr += data.toString();
	});
	let readySignal: () => void = () => {
		throw new Error("fixture ready unavailable");
	};
	const ready = new Promise<void>((resolve) => {
		readySignal = resolve;
	});
	const message = new Promise<unknown>((resolve, reject) => {
		process.on("message", (value) => {
			const kind = parse(z.object({ kind: z.string() }), value).kind;
			if (kind === "ready") readySignal();
			else resolve(value);
		});
		process.once("error", reject);
		process.once("exit", () =>
			reject(new Error(`worker exited before message: ${stderr}`)),
		);
	});
	return { process, exited, message, ready };
}
async function releaseRace(
	a: ReturnType<typeof child>,
	b: ReturnType<typeof child>,
) {
	await Promise.all([a.ready, b.ready]);
	a.process.send({ kind: "go" });
	b.process.send({ kind: "go" });
}
async function kill(
	process: ChildProcess,
	exited: Promise<{ readonly signal: NodeJS.Signals | null }>,
) {
	assert.equal(process.kill("SIGKILL"), true);
	assert.equal((await exited).signal, "SIGKILL");
}

test("serializes same-key publication across real concurrent Node processes", {
	timeout: 20000,
}, async () => {
	using f = fixture();
	const a = child(f.path, "storage-race");
	const b = child(f.path, "storage-race");
	await releaseRace(a, b);
	const results = await Promise.all([a.message, b.message]);
	assert.deepEqual(results[0], results[1]);
	assert.equal((await a.exited).code, 0);
	assert.equal((await b.exited).code, 0);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM operations").get()?.["n"],
		1,
	);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		1,
	);
	assert.equal(f.outbox.list(scope).length, 1);
	evidence("storage-process-race", {
		results,
		observations: f.outbox.list(scope),
		publications: f.db.sql.prepare("SELECT * FROM publications").all(),
	});
});
test("claims each row once across real concurrent worker processes", {
	timeout: 20000,
}, async () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("concurrent", 2));
	const a = child(f.path, "job-race");
	const b = child(f.path, "job-race");
	await releaseRace(a, b);
	await Promise.all([a.message, b.message]);
	assert.equal((await a.exited).code, 0);
	assert.equal((await b.exited).code, 0);
	assert.equal(f.jobs.job(scope, job.id).status, "succeeded");
	assert.deepEqual(
		f.jobs.inventory(scope, job.id).map((r) => r.attempts),
		[1, 1],
	);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
		2,
	);
	evidence("job-process-race", {
		job: f.jobs.job(scope, job.id),
		rows: f.jobs.inventory(scope, job.id),
		observations: f.outbox.list(scope),
	});
});
test("executes one row once when two real processes race its claim", {
	timeout: 20000,
}, async () => {
	using f = fixture();
	const job = f.jobs.create(scope, plan("one-concurrent", 1));
	const a = child(f.path, "job-race");
	const b = child(f.path, "job-race");
	await releaseRace(a, b);
	const messages = await Promise.all([a.message, b.message]);
	assert.equal((await a.exited).code, 0);
	assert.equal((await b.exited).code, 0);
	const values = messages.map(
		(message) => parse(z.object({ value: z.unknown() }), message).value,
	);
	assert.equal(values.filter((v) => v !== null).length, 1);
	assert.equal(f.jobs.job(scope, job.id).status, "succeeded");
	assert.equal(f.jobs.inventory(scope, job.id)[0]?.attempts, 1);
});
for (const mode of [
	"storage-before",
	"storage-byte-transaction",
	"storage-stage",
	"storage-transaction",
	"storage-commit",
] as const) {
	test(`recovers publication after a killed process at ${mode}`, {
		timeout: 20000,
	}, async () => {
		using f = fixture();
		const running = child(f.path, mode);
		const message = parse(
			z.object({
				value: z.object({
					operation: idSchema,
					stage: idSchema,
					publication: idSchema.optional(),
				}),
			}),
			await running.message,
		);
		await kill(running.process, running.exited);
		using restart = new DurabilityDatabase(f.path);
		const store = new LocalArtifactStore(restart);
		const before = store.publication(scope, message.value.operation);
		if (mode === "storage-commit") {
			assert.equal(before?.id, message.value.publication);
			assert.equal(
				store.retrieve(
					scope,
					message.value.publication ?? message.value.operation,
				).files.length,
				1,
			);
		} else {
			assert.equal(before, null);
			assert.equal(new ObservationOutbox(restart).list(scope).length, 0);
		}
		const publisher = child(
			f.path,
			"publish-existing",
			1000,
			message.value.stage,
		);
		await publisher.message;
		assert.equal((await publisher.exited).code, 0);
		assert.equal(
			f.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
			1,
		);
		assert.equal(f.outbox.list(scope).length, 1);
		evidence(mode, {
			killedSignal: "SIGKILL",
			checkpoint: message,
			before,
			after: store.publication(scope, message.value.operation),
			observations: f.outbox.list(scope),
		});
	});
}
for (const mode of [
	"job-claim",
	"job-stage",
	"job-transaction",
	"job-complete",
	"job-uncertain",
] as const) {
	test(`resumes complete row inventory after a killed process at ${mode}`, {
		timeout: 20000,
	}, async () => {
		using f = fixture();
		const running = child(f.path, mode);
		const message = parse(
			z.object({ value: z.object({ job: idSchema }) }),
			await running.message,
		);
		await kill(running.process, running.exited);
		const recoveryTime = 1000 + defaultLimits.leaseMs + defaultLimits.backoffMs;
		using restart = new DurabilityDatabase(
			f.path,
			undefined,
			() => recoveryTime,
		);
		const jobs = new DurableBatchEngine(restart);
		let claim = jobs.claim(scope);
		if (!claim && mode !== "job-complete" && mode !== "job-uncertain") {
			const next = child(
				f.path,
				"job-race",
				recoveryTime + defaultLimits.backoffMs,
			);
			await next.ready;
			next.process.send({ kind: "go" });
			await next.message;
			assert.equal((await next.exited).code, 0);
		} else if (claim) jobs.complete(scope, claim, [file()]);
		const rows = jobs.inventory(scope, message.value.job);
		assert.equal(rows.length, 1);
		assert.equal(rows[0]?.status, "succeeded");
		assert.equal(jobs.job(scope, message.value.job).status, "succeeded");
		assert.equal(
			rows[0]?.attempts,
			mode === "job-complete" || mode === "job-uncertain" ? 1 : 2,
		);
		assert.equal(
			f.db.sql
				.prepare("SELECT COUNT(*) AS n FROM publications WHERE operation=?")
				.get(rows[0]?.operation ?? message.value.job)?.["n"],
			1,
		);
		assert.equal(jobs.claim(scope), null);
		const count = f.db.sql
			.prepare("SELECT COUNT(*) AS n FROM attempts")
			.get()?.["n"];
		jobs.results(scope, message.value.job);
		assert.equal(
			f.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
			count,
		);
		evidence(mode, {
			killedSignal: "SIGKILL",
			job: jobs.job(scope, message.value.job),
			rows,
			attemptCount: count,
			observations: new ObservationOutbox(restart).list(scope),
		});
	});
}
for (const mode of [
	"outbox-claim",
	"outbox-settle",
	"outbox-accepted",
] as const) {
	test(`retains outbox identity after a killed transport process at ${mode}`, {
		timeout: 20000,
	}, async () => {
		using f = fixture();
		const input = Buffer.from("opaque");
		const op = f.store.bind(
			scope,
			"export",
			"outbox-crash",
			input,
			hash(input),
		);
		const stage = f.store.stage(scope, op.id);
		f.store.write(scope, stage, file());
		f.store.publish(scope, stage, [file()]);
		const running = child(f.path, mode);
		const message = parse(
			z.object({
				value: z.object({
					event: z.object({ id: idSchema }),
					transport: idSchema,
				}),
			}),
			await running.message,
		);
		await kill(running.process, running.exited);
		using restart = new DurabilityDatabase(
			f.path,
			undefined,
			() => 1000 + defaultLimits.leaseMs,
		);
		const outbox = new ObservationOutbox(restart);
		const redelivery = outbox.claim();
		if (mode !== "outbox-settle") {
			assert.ok(redelivery);
			assert.equal(redelivery.event.id, message.value.event.id);
			assert.notEqual(redelivery.transport, message.value.transport);
			if (mode === "outbox-accepted") {
				restart.sql
					.prepare("INSERT OR IGNORE INTO test_only_sink VALUES(?)")
					.run(redelivery.event.id);
				assert.equal(
					restart.sql
						.prepare("SELECT COUNT(*) AS n FROM test_only_sink")
						.get()?.["n"],
					1,
				);
			}
			outbox.settle(redelivery, true);
		} else assert.equal(redelivery, null);
		assert.equal(outbox.list(scope).length, 1);
		assert.equal(outbox.claim(), null);
		evidence(mode, {
			killedSignal: "SIGKILL",
			sourceEvent: message.value.event.id,
			initialTransport: message.value.transport,
			redelivery,
			observations: outbox.list(scope),
		});
	});
}

for (const retryable of [false, true]) {
	test(`reconciles committed publication after SIGKILL and restart before fail(${retryable})`, async () => {
		using f = fixture();
		const running = child(f.path, "job-uncertain");
		const checkpoint = parse(
			z.object({
				value: z.object({
					job: idSchema,
					publication: idSchema,
					claim: z.object({
						job: idSchema,
						ordinal: z.number(),
						operation: idSchema,
						attempt: idSchema,
						stage: idSchema,
						fence: z.number(),
					}),
				}),
			}),
			await running.message,
		).value;
		await kill(running.process, running.exited);
		using restart = new DurabilityDatabase(f.path, undefined, () => 1001);
		const jobs = new DurableBatchEngine(restart);
		const before = new ObservationOutbox(restart).list(scope);
		jobs.fail(
			scope,
			{ ...checkpoint.claim, input: Buffer.alloc(0), pins: Buffer.alloc(0) },
			retryable,
		);
		const row = jobs.inventory(scope, checkpoint.job)[0];
		assert.equal(jobs.job(scope, checkpoint.job).status, "succeeded");
		assert.equal(row?.publication, checkpoint.publication);
		assert.equal(row?.attempts, 1);
		assert.equal(jobs.claim(scope), null);
		const events = new ObservationOutbox(restart).list(scope);
		assert.deepEqual(events.slice(0, before.length), before);
		assert.ok(
			events.some(
				(e) =>
					e.kind === "succeeded" &&
					e.attempt === checkpoint.claim.attempt &&
					e.publication === checkpoint.publication,
			),
		);
		assert.equal(
			restart.sql
				.prepare("SELECT outcome FROM attempts WHERE id=?")
				.get(checkpoint.claim.attempt)?.["outcome"],
			"succeeded",
		);
		evidence(`uncertain-fail-${retryable}`, {
			killedSignal: "SIGKILL",
			checkpoint,
			row,
			observations: events,
		});
	});
}

test("retains the cancellation fence after killing a worker with a full outbox", async () => {
	const limits = { ...defaultLimits, maxPendingEvents: 10 };
	using f = fixture(limits);
	const running = child(f.path, "job-cancel-budget", 1000, undefined, limits);
	const checkpoint = parse(
		z.object({
			value: z.object({
				job: idSchema,
				claim: z.object({ stage: idSchema, operation: idSchema }),
			}),
		}),
		await running.message,
	).value;
	await kill(running.process, running.exited);
	using restart = new DurabilityDatabase(f.path, limits, () => 1001);
	const jobs = new DurableBatchEngine(restart);
	const store = new LocalArtifactStore(restart);
	const outbox = new ObservationOutbox(restart);
	assert.equal(jobs.job(scope, checkpoint.job).status, "cancelled");
	assert.throws(() => store.publish(scope, checkpoint.claim.stage, [file()]));
	for (let round = 0; round < 3; round++) {
		for (;;) {
			const event = outbox.claim();
			if (!event) break;
			outbox.settle(event, true);
		}
		jobs.cancel(scope, checkpoint.job);
	}
	assert.ok(
		jobs
			.inventory(scope, checkpoint.job)
			.every((row) => row.status === "cancelled"),
	);
	assert.equal(
		outbox
			.list(scope)
			.filter((e) => e.job === checkpoint.job && e.kind === "cancelled").length,
		11,
	);
	evidence("cancel-budget-kill", {
		killedSignal: "SIGKILL",
		checkpoint,
		rows: jobs.inventory(scope, checkpoint.job),
		observations: outbox.list(scope),
	});
});

test("recovers healthy same-scope work after killing a denied worker", async () => {
	using f = fixture();
	const running = child(f.path, "job-denied");
	const checkpoint = parse(
		z.object({
			value: z.object({
				job: idSchema,
				claim: z.object({ stage: idSchema, operation: idSchema }),
			}),
		}),
		await running.message,
	).value;
	await kill(running.process, running.exited);
	using restart = new DurabilityDatabase(
		f.path,
		undefined,
		() => 1000 + defaultLimits.leaseMs,
	);
	const jobs = new DurableBatchEngine(restart);
	const healthy = jobs.create(scope, plan("healthy-after-denied-kill", 1));
	const claim = jobs.claim(scope);
	assert.equal(claim?.job, healthy.id);
	assert.ok(claim);
	jobs.complete(scope, claim, [file()]);
	jobs.cancel(scope, checkpoint.job);
	assert.equal(jobs.inventory(scope, checkpoint.job)[0]?.status, "cancelled");
	assert.throws(() =>
		new LocalArtifactStore(restart).publish(scope, checkpoint.claim.stage, [
			file(),
		]),
	);
	evidence("denied-worker-kill", {
		killedSignal: "SIGKILL",
		checkpoint,
		denied: jobs.inventory(scope, checkpoint.job),
		healthy: jobs.job(scope, healthy.id),
	});
});
