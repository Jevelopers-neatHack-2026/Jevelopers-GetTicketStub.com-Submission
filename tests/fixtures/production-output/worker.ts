import { z } from "zod";
import { join } from "node:path";
import {
	DurabilityDatabase,
	defaultLimits,
} from "../../../src/internal/durability.js";
import { DurableBatchEngine } from "../../../src/jobs/durable-batch.js";
import { scope } from "../composition/corpus.js";
const [root] = z.tuple([z.string().min(1)]).parse(process.argv.slice(2));
const db = new DurabilityDatabase(
		join(root, "state.sqlite"),
		{ ...defaultLimits, pageSize: 2, concurrency: 2, leaseMs: 30000 },
		() => 1000,
	),
	engine = new DurableBatchEngine(db);
const claim = engine.claim(scope);
if (!claim) throw new Error("Missing planned output row");
process.stdout.write(
	JSON.stringify({
		claimed: true,
		job: claim.job,
		ordinal: claim.ordinal,
		attempt: claim.attempt,
	}) + "\n",
);
process.stdin.resume();
