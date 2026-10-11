import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	batchFixture,
	sampleRows,
	eventInventory,
} from "../fixtures/production-output/fixture.js";
import {
	createPrivateBatch,
	privateBatchRenderer,
} from "../../src/personalization/private-batch.js";
import { ObservationOutbox } from "../../src/telemetry/observations.js";
import { independentTestEnvironment } from "../../src/internal/independent-tests.js";

test("resumes actual personalized output after a worker is killed with a durable claim", {
	timeout: 30000,
}, async () => {
	using f = await batchFixture();
	const job = createPrivateBatch({
		engine: f.engine,
		key: "killed",
		context: f.context,
		rows: [sampleRows[0]],
	});
	const child = spawn(
		process.execPath,
		[
			fileURLToPath(
				new URL("../fixtures/production-output/worker.js", import.meta.url),
			),
			f.root,
		],
		{ env: independentTestEnvironment(), stdio: ["pipe", "pipe", "pipe"] },
	);
	try {
		const [raw] = await once(child.stdout, "data");
		const claimed = z
			.object({
				claimed: z.literal(true),
				job: z.string(),
				ordinal: z.literal(0),
				attempt: z.string(),
			})
			.parse(JSON.parse(z.instanceof(Buffer).parse(raw).toString()));
		assert.equal(claimed.job, job.id);
		const exited = once(child, "exit");
		assert.equal(child.kill("SIGKILL"), true);
		await exited;
		f.setNow(32000);
		assert.equal(f.engine.claim(f.context.input.scope), null);
		f.setNow(34000);
		await f.engine.runOne(
			f.context.input.scope,
			privateBatchRenderer({ ...f.context, now: () => 1000 }, f.engine.store),
			new AbortController().signal,
		);
		assert.equal(
			f.engine.job(f.context.input.scope, job.id).status,
			"succeeded",
		);
		assert.equal(
			f.engine.progress(f.context.input.scope, job.id).executionAttempts,
			2,
		);
		const events = eventInventory(
			new ObservationOutbox(f.db),
			f.context.input.scope,
		);
		assert.ok(
			events.some(
				(e) => e.attempt === claimed.attempt && e.kind === "interrupted",
			),
		);
		assert.ok(events.some((e) => e.kind === "succeeded" && e.publication));
		const directory = process.env["PP_OUTPUT_EVIDENCE_DIR"];
		if (directory)
			await writeFile(
				join(directory, "output-process-restart.json"),
				JSON.stringify({
					mode: "real-process-private-synthetic",
					job: job.id,
					interruptedAttempt: claimed.attempt,
					executionAttempts: 2,
					eventDigests: events.map((e) => e.request),
					executionNonce: process.env["PP_DURABILITY_EXECUTION_NONCE"],
				}),
			);
	} finally {
		if (child.exitCode === null && child.signalCode === null)
			child.kill("SIGKILL");
	}
});
