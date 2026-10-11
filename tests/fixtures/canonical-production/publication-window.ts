import { readSync, writeSync } from "node:fs";
import { fixtureHost } from "./host.js";
import { CanonicalState } from "../../../src/storage/canonical-state.js";
import { exportRequest } from "./requests.js";
import { requireCandidate } from "../../../src/api/canonical-values.js";

const root = process.argv[2];
const mode = process.argv[3];
requireCandidate(root !== undefined, "INVALID_INPUT");
await using given = await fixtureHost({ root, preserve: true });
const original = CanonicalState.prototype.publish;
CanonicalState.prototype.publish = function (...args) {
	const publication = original.apply(this, args);
	writeSync(
		1,
		`${JSON.stringify({ publication, attempt: args[2]?.attempt })}\n`,
	);
	readSync(0, Buffer.alloc(1), 0, 1, null);
	return publication;
};
const { operations, context } = given.candidate;
if (mode === "export") {
	CanonicalState.prototype.publish = original;
	const artifact = await operations.composeArtifact(
		context,
		given.records.request,
	);
	requireCandidate(artifact.ok, "INTEGRITY_FAILURE");
	const hook = function (
		this: CanonicalState,
		...args: Parameters<typeof original>
	) {
		const publication = original.apply(this, args);
		writeSync(
			1,
			`${JSON.stringify({ publication, attempt: args[2]?.attempt })}\n`,
		);
		readSync(0, Buffer.alloc(1), 0, 1, null);
		return publication;
	};
	CanonicalState.prototype.publish = hook;
	await operations.exportArtifactBundle(
		context,
		exportRequest(given.records, artifact.value),
	);
} else {
	await operations.composeArtifact(context, given.records.request);
}
