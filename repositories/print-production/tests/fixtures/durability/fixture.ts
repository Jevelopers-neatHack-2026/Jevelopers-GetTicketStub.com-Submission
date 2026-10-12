import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	DurabilityDatabase,
	defaultLimits,
	hash,
	type Limits,
	type Scope,
} from "../../../src/internal/durability.js";
import { LocalArtifactStore } from "../../../src/storage/local-store.js";
import {
	DurableBatchEngine,
	type BatchPlan,
} from "../../../src/jobs/durable-batch.js";
import { ObservationOutbox } from "../../../src/telemetry/observations.js";

export const scope: Scope = {
	tenant: "synthetic-tenant",
	project: "synthetic-project",
};
export const foreign: Scope = {
	tenant: "foreign-tenant",
	project: "synthetic-project",
};
export const sensitive =
	"SYNTHETIC_PRIVATE_NAME_email@example.invalid_token=secret_https://private.invalid/?signature=secret";
export function file(name = "output.bin", text = "synthetic-output") {
	const bytes = Buffer.from(text);
	return { name, bytes, digest: hash(bytes), length: bytes.length };
}
export function plan(key = "batch", count = 2): BatchPlan {
	const request = Buffer.from("opaque-request");
	const pins = Buffer.from("opaque-renderer-template-contract-pins");
	return {
		format: "structured",
		key,
		request,
		requestDigest: hash(request),
		pins,
		pinsDigest: hash(pins),
		rows: Array.from({ length: count }, (_, i) => {
			const bytes = Buffer.from("synthetic-equal-input");
			return { id: `row-${i}`, bytes, digest: hash(bytes) };
		}),
	};
}
export function fixture(limits: Limits = defaultLimits) {
	const root = mkdtempSync(join(tmpdir(), "pp-durability-"));
	const path = join(root, "state.sqlite");
	let now = 1000;
	const db = new DurabilityDatabase(path, limits, () => now);
	const store = new LocalArtifactStore(db);
	const jobs = new DurableBatchEngine(db);
	const outbox = new ObservationOutbox(db);
	return {
		root,
		path,
		db,
		store,
		jobs,
		outbox,
		advance: (ms: number) => {
			now += ms;
		},
		time: () => now,
		[Symbol.dispose]: () => {
			db.close();
			rmSync(root, { recursive: true, force: true });
		},
	};
}
