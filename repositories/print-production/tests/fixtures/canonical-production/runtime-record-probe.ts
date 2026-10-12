import { readFile } from "node:fs/promises";
import { z } from "zod";
import { fixtureHost } from "./host.js";
import { createCandidateProductionOperations } from "../../../src/api/candidate.js";
import {
	contract,
	requireCandidate,
} from "../../../src/api/canonical-values.js";
import { DurabilityDatabase } from "../../../src/internal/durability.js";
import { productionReferences } from "@jevelopers/shared-contracts/production-operations";

const path = process.argv[2];
requireCandidate(path !== undefined, "INVALID_INPUT");
const snapshot = z
	.object({
		record: z.unknown(),
		composition: z.unknown(),
		request: z.unknown(),
		pins: z.unknown(),
	})
	.parse(JSON.parse(await readFile(path, "utf8")));
await using given = await fixtureHost();
using db = new DurabilityDatabase(
	`${given.root}/retained-runtime.sqlite`,
	undefined,
	() => Date.parse(given.state.now),
);
const record = contract("ProductionRuntime", snapshot.record);
const composition = contract("Composition", snapshot.composition);
const request = contract("ComposeArtifactRequest", snapshot.request);
const pins = contract("ProductionExecutionPins", snapshot.pins);
given.records.records.set(record.id, record);
given.records.records.set(composition.composition_id, composition);
const host = given.host();
const candidate = createCandidateProductionOperations({
	...host,
	db,
	producer: { ...host.producer, source_revision: record.source_revision },
	context: { ...host.context, runtime: pins },
	external_references: [
		...productionReferences(request),
		...productionReferences(composition),
		...productionReferences(given.records.template),
		...productionReferences(pins),
	].map(([, ref]) => ref),
});
const result = await candidate.operations.composeArtifact(
	candidate.context,
	request,
);
process.stdout.write(
	`${JSON.stringify({ result, publications: db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"] })}\n`,
);
