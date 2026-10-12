import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
	defaultLimits,
	idSchema,
	type Limits,
} from "../../src/internal/durability.js";
import {
	fixture,
	file,
	scope,
	sensitive,
} from "../fixtures/durability/fixture.js";
import { drain, pending } from "../fixtures/durability/recovery-budget.js";
import { evidence } from "../fixtures/durability/evidence.js";
import { independentTestEnvironment } from "../../src/internal/independent-tests.js";

async function killedCheckpoint(
	path: string,
	mode: string,
	time: number,
	limits: Limits,
): Promise<unknown> {
	const child = fork(
		fileURLToPath(new URL("../fixtures/durability/worker.js", import.meta.url)),
		[path, mode, String(time)],
		{
			execPath: process.execPath,
			stdio: ["ignore", "ignore", "pipe", "ipc"],
			timeout: 15000,
			killSignal: "SIGKILL",
			env: {
				...independentTestEnvironment(),
				PP_DURABILITY_TEST_LIMITS: JSON.stringify(limits),
			},
		},
	);
	let stderr = "";
	child.stderr?.on("data", (data: Buffer) => {
		stderr += data.toString();
	});
	const exited = new Promise<{
		readonly code: number | null;
		readonly signal: NodeJS.Signals | null;
	}>((resolve, reject) => {
		child.once("error", reject);
		child.once("exit", (code, signal) => resolve({ code, signal }));
	});
	try {
		const message = await new Promise<unknown>((resolve, reject) => {
			child.once("message", resolve);
			child.once("error", reject);
			child.once("exit", () =>
				reject(new Error(`checkpoint absent: ${stderr}`)),
			);
		});
		assert.equal(child.kill("SIGKILL"), true);
		assert.equal((await exited).signal, "SIGKILL");
		return message;
	} finally {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill("SIGKILL");
			await exited;
		}
	}
}

for (const committed of [false, true]) {
	test(`persists bounded ${committed ? "committed" : "interrupted"} recovery across killed workers and separate process restarts`, {
		timeout: 20000,
	}, async () => {
		const limits = {
			...defaultLimits,
			maxPendingEvents: 10,
			concurrency: committed ? 4 : 12,
			maxAttempts: committed ? 3 : 1,
		};
		using f = fixture(limits);
		const seed = z
			.object({
				value: z.object({
					healthy: idSchema,
					seeded: z.array(
						z.object({
							job: idSchema,
							operation: idSchema,
							attempt: idSchema,
							stage: idSchema,
							publication: idSchema.nullable(),
						}),
					),
				}),
			})
			.parse(
				await killedCheckpoint(
					f.path,
					`recovery-seed-${committed ? "uncertain" : "interrupted"}`,
					f.time(),
					limits,
				),
			).value;
		const originalEvents = f.outbox.list(scope);
		f.advance(limits.leaseMs);
		const snapshots = [];
		let completed = 0;
		for (let step = 0; step < 4; step++) {
			const message = z
				.object({ value: z.object({ job: idSchema.nullable() }) })
				.parse(
					await killedCheckpoint(f.path, "recovery-step", f.time(), limits),
				).value;
			const progress = seed.seeded.map((row) =>
				f.jobs.progress(scope, row.job),
			);
			const nextCompleted = progress.reduce(
				(total, p) => total + p.completed,
				0,
			);
			assert.ok(nextCompleted >= completed);
			completed = nextCompleted;
			assert.ok(pending(f.db) <= 10);
			if (step === 0) {
				assert.equal(message.job, null);
				assert.equal(completed, committed ? 3 : 5);
				assert.equal(pending(f.db), committed ? 9 : 10);
			}
			snapshots.push({
				step,
				progress,
				pending: pending(f.db),
				claim: message,
			});
			assert.deepEqual(
				f.outbox.list(scope).slice(0, originalEvents.length),
				originalEvents,
			);
			if (message.job !== null) {
				assert.equal(message.job, seed.healthy);
				break;
			}
			drain(f.outbox);
		}
		assert.equal(completed, seed.seeded.length);
		assert.equal(f.jobs.job(scope, seed.healthy).status, "running");
		for (const row of seed.seeded) {
			const outcome = f.jobs.inventory(scope, row.job)[0];
			assert.equal(outcome?.status, committed ? "succeeded" : "failed");
			assert.equal(outcome?.publication, row.publication);
			assert.equal(f.jobs.progress(scope, row.job).executionAttempts, 1);
			assert.equal(
				f.db.sql
					.prepare("SELECT outcome FROM attempts WHERE id=?")
					.get(row.attempt)?.["outcome"],
				committed ? "succeeded" : "interrupted",
			);
			if (row.publication) {
				assert.equal(
					f.store.publication(scope, row.operation)?.id,
					row.publication,
				);
				assert.equal(f.store.retrieve(scope, row.publication).files.length, 1);
			} else assert.equal(f.store.publication(scope, row.operation), null);
			const rowEvents = f.outbox
				.list(scope)
				.filter(
					(e) =>
						e.attempt === row.attempt &&
						e.kind === (committed ? "succeeded" : "interrupted"),
				);
			assert.equal(rowEvents.length, 1);
			assert.equal(rowEvents[0]?.publication, row.publication);
			assert.equal(rowEvents[0]?.duration_ms, null);
		}
		assert.equal(
			f.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
			committed ? 8 : 0,
		);
		assert.equal(
			f.db.sql
				.prepare(
					"SELECT COUNT(*) AS n FROM blobs WHERE digest NOT IN(SELECT digest FROM files)",
				)
				.get()?.["n"],
			0,
		);
		const retained = {
			killedSignal: "SIGKILL",
			seeded: seed,
			snapshots,
			observations: f.outbox.list(scope),
		};
		assert.equal(JSON.stringify(retained).includes(sensitive), false);
		assert.equal(
			JSON.stringify(retained).includes(Buffer.from(file().bytes).toString()),
			false,
		);
		evidence(
			`recovery-budget-${committed ? "committed" : "interrupted"}`,
			retained,
		);
	});
}
