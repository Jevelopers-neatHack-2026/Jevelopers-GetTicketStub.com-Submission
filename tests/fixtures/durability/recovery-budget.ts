import assert from "node:assert/strict";
import {
	hash,
	type DurabilityDatabase,
} from "../../../src/internal/durability.js";
import { DurableBatchEngine } from "../../../src/jobs/durable-batch.js";
import { ObservationOutbox } from "../../../src/telemetry/observations.js";
import { file, plan, scope, sensitive } from "./fixture.js";

export function drain(outbox: ObservationOutbox): void {
	for (;;) {
		const event = outbox.claim();
		if (!event) return;
		outbox.settle(event, true);
	}
}

export function pending(db: DurabilityDatabase): number {
	const count = db.sql
		.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status!='delivered'")
		.get()?.["n"];
	assert.equal(typeof count, "number");
	assert.ok(typeof count === "number");
	return count;
}

export function seedRecovery(
	db: DurabilityDatabase,
	committed: boolean,
	count: number,
) {
	const jobs = new DurableBatchEngine(db);
	const outbox = new ObservationOutbox(db);
	const seeded = Array.from({ length: count }, (_, i) => {
		const request = Buffer.from(sensitive);
		const bytes = Buffer.from(`${sensitive}-${i}`);
		const job = jobs.create(scope, {
			...plan(`budget-${i}`, 1),
			request,
			requestDigest: hash(request),
			rows: [{ id: `${sensitive}-${i}`, bytes, digest: hash(bytes) }],
		});
		const claim = jobs.claim(scope);
		assert.ok(claim);
		const output = file("output.bin", `budget-output-${i}`);
		jobs.store.write(scope, claim.stage, output);
		const publication = committed
			? jobs.store.publish(scope, claim.stage, [output])
			: null;
		drain(outbox);
		return { job, claim, publication };
	});
	const healthy = jobs.create(scope, plan("healthy-after-recovery", 1));
	drain(outbox);
	return { seeded, healthy };
}
