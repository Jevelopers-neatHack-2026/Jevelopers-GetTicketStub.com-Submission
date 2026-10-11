import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureArtifact } from "../composition/corpus.js";
import {
	DurabilityDatabase,
	defaultLimits,
} from "../../../src/internal/durability.js";
import { DurableBatchEngine } from "../../../src/jobs/durable-batch.js";
import { resolveRowPolicy } from "../../../src/personalization/private-rows.js";
import { defaultOutputPolicy } from "../../../src/exporters/private-policy.js";
import type { BatchContext } from "../../../src/personalization/private-batch.js";
import { ObservationOutbox } from "../../../src/telemetry/observations.js";
import type { Observation } from "../../../src/telemetry/observations.js";
import type { Scope } from "../../../src/internal/durability.js";
export function eventInventory(outbox: ObservationOutbox, scope: Scope) {
	const events: Observation[] = [];
	let after = 0;
	for (;;) {
		const page = outbox.list(scope, after);
		if (!page.length) return events;
		events.push(...page);
		after = page.at(-1)?.sequence ?? after;
	}
}

export function rowPolicy(
	input: Awaited<
		ReturnType<typeof fixtureArtifact>
	>["artifact"]["model"]["input"],
) {
	return resolveRowPolicy(
		{
			revision: "private-rows-1",
			fields: [
				{ field: "name", node: "name", required: true, maxLength: 200 },
				{ field: "detail", node: "detail", required: true, maxLength: 200 },
			],
			maxRows: 100,
			maxBytes: 100000,
		},
		input,
	);
}
export async function batchFixture() {
	const f = await fixtureArtifact("Alice", "Seat 0007");
	const root = mkdtempSync(join(tmpdir(), "pp-output-db-"));
	let now = 1000;
	const db = new DurabilityDatabase(
		join(root, "state.sqlite"),
		{ ...defaultLimits, pageSize: 2, concurrency: 2, leaseMs: 30000 },
		() => now,
	);
	const engine = new DurableBatchEngine(db);
	const context: BatchContext = {
		input: f.artifact.model.input,
		layout: f.layout,
		constraints: f.constraints,
		fonts: f.fonts,
		ports: f.ports,
		now: () => now,
		rows: rowPolicy(f.artifact.model.input),
		output: defaultOutputPolicy,
	};
	return {
		...f,
		root,
		db,
		engine,
		context,
		setNow: (value: number) => {
			now = value;
		},
		[Symbol.dispose]: () => {
			db.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}
export const sampleRows = [
	{ rowId: "row-001", fields: { name: "Zoë O’Connor", detail: "Seat 0007" } },
	{ rowId: "row-002", fields: { name: "D'Arcy 0009", detail: "Seat 0008" } },
];
