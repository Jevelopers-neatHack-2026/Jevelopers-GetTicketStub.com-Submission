import {
	DurabilityDatabase,
	DurabilityError,
	hash,
	parse,
	idSchema,
	limitsSchema,
} from "../../../src/internal/durability.js";
import {
	LocalArtifactStore,
	type Publication,
} from "../../../src/storage/local-store.js";
import { DurableBatchEngine } from "../../../src/jobs/durable-batch.js";
import { ObservationOutbox } from "../../../src/telemetry/observations.js";
import { file, plan, scope } from "./fixture.js";
import { seedRecovery } from "./recovery-budget.js";

const [path, mode, time = "1000", stageArg] = process.argv.slice(2);
if (!path || !mode) throw new Error("fixture arguments required");
const limits = process.env["PP_DURABILITY_TEST_LIMITS"];
const db = new DurabilityDatabase(
	path,
	limits ? parse(limitsSchema, JSON.parse(limits)) : undefined,
	() => Number(time),
);
const store = new LocalArtifactStore(db);
const jobs = new DurableBatchEngine(db);
const outbox = new ObservationOutbox(db);
const park = (value: unknown): never => {
	process.send?.({ kind: "checkpoint", value });
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
	throw new Error("fixture interrupted");
};
const main = () => {
	switch (mode) {
		case "recovery-seed-uncertain":
		case "recovery-seed-interrupted": {
			const committed = mode === "recovery-seed-uncertain";
			const { seeded, healthy } = seedRecovery(
				db,
				committed,
				committed ? 4 : 12,
			);
			return park({
				healthy: healthy.id,
				seeded: seeded.map(({ job, claim, publication }) => ({
					job: job.id,
					operation: claim.operation,
					attempt: claim.attempt,
					stage: claim.stage,
					publication: publication?.id ?? null,
				})),
			});
		}
		case "recovery-step": {
			const claim = jobs.claim(scope);
			return park({ job: claim?.job ?? null });
		}
		case "storage-race": {
			const bytes = Buffer.from("opaque");
			const operation = store.bind(
				scope,
				"export",
				"same-key",
				bytes,
				hash(bytes),
			);
			let publication: Publication | null;
			try {
				const stage = store.stage(scope, operation.id);
				const output = file();
				store.write(scope, stage, output);
				publication = store.publish(scope, stage, [output]);
			} catch (error) {
				if (!(error instanceof DurabilityError) || error.code !== "WRITE_ONCE")
					throw error;
				publication = store.publication(scope, operation.id);
			}
			if (!publication) throw new Error("fixture publication absent");
			process.send?.({
				kind: "result",
				value: { operation: operation.id, publication: publication.id },
			});
			break;
		}
		case "storage-before":
		case "storage-byte-transaction":
		case "storage-stage":
		case "storage-transaction":
		case "storage-commit": {
			const bytes = Buffer.from("opaque");
			const operation = store.bind(
				scope,
				"export",
				"crash",
				bytes,
				hash(bytes),
			);
			const stage = store.stage(scope, operation.id);
			const output = file();
			if (mode === "storage-before") park({ operation: operation.id, stage });
			if (mode === "storage-byte-transaction")
				db.transaction(() => {
					store.writeInTransaction(scope, stage, output);
					park({ operation: operation.id, stage });
				});
			store.write(scope, stage, output);
			if (mode === "storage-stage") park({ operation: operation.id, stage });
			if (mode === "storage-transaction")
				db.transaction(() => {
					const publication = store.publishInTransaction(scope, stage, [
						output,
					]);
					park({ operation: operation.id, stage, publication: publication.id });
				});
			const publication = store.publish(scope, stage, [output]);
			return park({
				operation: operation.id,
				stage,
				publication: publication.id,
			});
		}
		case "job-race": {
			const claim = jobs.claim(scope);
			if (claim) jobs.complete(scope, claim, [file()]);
			process.send?.({ kind: "result", value: claim });
			break;
		}
		case "job-denied": {
			const job = jobs.create(scope, plan("denied-process", 1));
			const claim = jobs.claim(scope);
			if (!claim) throw new Error("fixture claim absent");
			store.write(scope, claim.stage, file());
			store.deny(scope, claim.operation);
			return park({ job: job.id, claim });
		}
		case "job-gc-stage":
		case "job-gc-fail":
		case "job-gc-cancel": {
			const job = jobs.create(scope, plan("gc-process", 1));
			const claim = jobs.claim(scope);
			if (!claim) throw new Error("fixture claim absent");
			for (const output of [
				file(),
				file("live.bin", "shared-live"),
				file("unique.bin", "unique-process-gc"),
			])
				store.write(scope, claim.stage, output);
			if (mode === "job-gc-fail") jobs.fail(scope, claim, false);
			if (mode === "job-gc-cancel") jobs.cancel(scope, job.id);
			return park({ job: job.id, claim });
		}
		case "job-cancel-budget": {
			const job = jobs.create(scope, plan("cancel-budget-process", 10));
			const claim = jobs.claim(scope);
			if (!claim) throw new Error("fixture claim absent");
			store.write(scope, claim.stage, file());
			for (let i = 0; i < 8; i++) jobs.create(scope, plan(`pressure-${i}`, 1));
			jobs.cancel(scope, job.id);
			return park({ job: job.id, claim });
		}
		case "job-claim":
		case "job-stage":
		case "job-transaction":
		case "job-complete":
		case "job-uncertain": {
			const job = jobs.create(scope, plan("crash-job", 1));
			const claim = jobs.claim(scope);
			if (!claim) throw new Error("fixture claim absent");
			if (mode === "job-claim") park({ job: job.id, claim });
			store.write(scope, claim.stage, file());
			if (mode === "job-stage") park({ job: job.id, claim });
			if (mode === "job-transaction")
				db.transaction(() => {
					const publication = store.publishInTransaction(
						scope,
						claim.stage,
						[file()],
						claim.attempt,
					);
					park({ job: job.id, claim, publication: publication.id });
				});
			if (mode === "job-uncertain") {
				const publication = store.publish(scope, claim.stage, [file()]);
				park({ job: job.id, claim, publication: publication.id });
			}
			jobs.complete(scope, claim, [file()]);
			return park({ job: job.id, claim });
		}
		case "outbox-claim":
		case "outbox-settle":
		case "outbox-accepted": {
			const claim = outbox.claim();
			if (!claim) throw new Error("fixture event absent");
			if (mode === "outbox-settle") outbox.settle(claim, true);
			if (mode === "outbox-accepted") {
				db.sql.exec(
					"CREATE TABLE IF NOT EXISTS test_only_sink(event TEXT PRIMARY KEY)",
				);
				db.sql
					.prepare("INSERT OR IGNORE INTO test_only_sink VALUES(?)")
					.run(claim.event.id);
			}
			return park(claim);
		}
		case "publish-existing": {
			const stage = parse(idSchema, stageArg);
			const operation = db.sql
				.prepare(
					"SELECT o.status FROM stages s JOIN operations o ON o.id=s.operation WHERE s.id=?",
				)
				.get(stage);
			if (operation?.["status"] === "pending")
				store.write(scope, stage, file());
			const publication = store.publish(scope, stage, [file()]);
			process.send?.({ kind: "result", value: publication });
			break;
		}
		default:
			throw new Error("fixture mode unsupported");
	}
	db.close();
};
if (mode.endsWith("-race")) {
	process.once("message", main);
	process.send?.({ kind: "ready" });
} else main();
