import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fixtureHost } from "../fixtures/canonical-production/host.js";
import { exportRequest } from "../fixtures/canonical-production/requests.js";
import {
	DurabilityDatabase,
	defaultLimits,
	hash,
} from "../../src/internal/durability.js";
import { LocalArtifactStore } from "../../src/storage/local-store.js";
import { createCandidateProductionOperations } from "../../src/api/candidate.js";
import {
	ObservationOutbox,
	observe,
} from "../../src/telemetry/observations.js";
import { reconcileCompletions } from "../../src/storage/canonical-completion.js";
import { z } from "zod";

function seed(
	db: DurabilityDatabase,
	scope: Parameters<LocalArtifactStore["bind"]>[0],
	n: number,
) {
	const bytes = Buffer.from("outbox seed");
	const operation = new LocalArtifactStore(db).bind(
		scope,
		"seed",
		"seed",
		bytes,
		hash(bytes),
	);
	db.transaction(() => {
		for (let i = 0; i < n; i++) observe(db, operation.id, "planned");
	});
	return operation.id;
}
function drain(db: DurabilityDatabase) {
	const outbox = new ObservationOutbox(db);
	for (let claim = outbox.claim(); claim !== null; claim = outbox.claim())
		outbox.settle(claim, true);
}
function barrier() {
	let release: (() => void) | undefined;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return {
		promise,
		resolve() {
			assert.ok(release);
			release();
		},
	};
}

for (const occupied of [7, 8, 9, 10])
	test(`handles ${10 - occupied} available outbox slots without losing publication or terminal evidence`, async () => {
		await using given = await fixtureHost();
		using db = new DurabilityDatabase(
			`${given.root}/capacity-${occupied}.sqlite`,
			{ ...defaultLimits, maxPendingEvents: 10 },
			() => Date.parse(given.state.now),
		);
		const host = { ...given.host(), db };
		seed(db, host.private_scope, occupied);
		const candidate = createCandidateProductionOperations(host);
		const when = await candidate.operations.composeArtifact(
			candidate.context,
			given.records.request,
		);
		if (occupied >= 9) {
			assert.ok(!when.ok);
			assert.equal(when.error.code, "RETRYABLE_STORAGE_FAILURE");
			assert.equal(
				db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
				0,
			);
			assert.equal(
				db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
				0,
			);
		} else {
			assert.ok(when.ok, JSON.stringify(when));
			assert.equal(
				db.sql.prepare("SELECT outcome FROM attempts").get()?.["outcome"],
				"succeeded",
			);
			assert.equal(
				db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
				1,
			);
			assert.equal(
				db.sql
					.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status!='delivered'")
					.get()?.["n"],
				10,
			);
			drain(db);
			assert.deepEqual(
				await candidate.operations.composeArtifact(
					candidate.context,
					given.records.request,
				),
				when,
			);
			const events = db.sql
				.prepare("SELECT id FROM observations WHERE kind='succeeded'")
				.all();
			assert.equal(events.length, 1);
			assert.deepEqual(
				await candidate.operations.composeArtifact(
					candidate.context,
					given.records.request,
				),
				when,
			);
			assert.deepEqual(
				db.sql
					.prepare("SELECT id FROM observations WHERE kind='succeeded'")
					.all(),
				events,
			);
			assert.equal(
				db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
				1,
			);
		}
	});

test("classifies an unpublished execution truthfully when another database connection fills the outbox", {
	timeout: 60000,
}, async () => {
	await using given = await fixtureHost();
	const limits = { ...defaultLimits, maxPendingEvents: 10 };
	const path = `${given.root}/concurrent.sqlite`;
	using db = new DurabilityDatabase(path, limits, () =>
		Date.parse(given.state.now),
	);
	using concurrent = new DurabilityDatabase(path, limits, () =>
		Date.parse(given.state.now),
	);
	const started = barrier();
	const release = barrier();
	const backend = given.records.profile.private_permissions;
	let first = true;
	const host = {
		...given.host(),
		db,
		profiles: [
			{
				...given.records.profile,
				private_permissions: {
					...backend,
					async permission(request: Parameters<typeof backend.permission>[0]) {
						if (first) {
							first = false;
							started.resolve();
							await release.promise;
						}
						return backend.permission(request);
					},
				},
			},
		],
	};
	const candidate = createCandidateProductionOperations(host);
	const operation = seed(db, host.private_scope, 7);
	const pending = candidate.operations.composeArtifact(
		candidate.context,
		given.records.request,
	);
	await started.promise;
	concurrent.transaction(() => {
		observe(concurrent, operation, "planned");
		observe(concurrent, operation, "planned");
	});
	release.resolve();
	const when = await pending;
	assert.ok(!when.ok);
	assert.equal(when.error.code, "RETRYABLE_STORAGE_FAILURE");
	assert.equal(
		db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		0,
	);
	assert.equal(
		db.sql.prepare("SELECT outcome FROM attempts").get()?.["outcome"],
		"retryable",
	);
	drain(db);
	assert.equal(reconcileCompletions(db), 1);
	assert.equal(
		db.sql
			.prepare("SELECT kind,code FROM observations WHERE kind='retryable'")
			.get()?.["code"],
		"RENDER_RETRYABLE",
	);
	const retry = await candidate.operations.composeArtifact(
		candidate.context,
		given.records.request,
	);
	assert.ok(retry.ok);
	assert.deepEqual(
		db.sql
			.prepare("SELECT outcome FROM attempts ORDER BY rowid")
			.all()
			.map((row) => row["outcome"]),
		["retryable", "succeeded"],
	);
});

test("returns known committed success when terminal telemetry is unavailable", async () => {
	await using given = await fixtureHost();
	given.db.sql.exec(
		"CREATE TRIGGER reject_terminal BEFORE INSERT ON observations WHEN NEW.kind='succeeded' BEGIN SELECT RAISE(ABORT,'synthetic telemetry outage'); END;",
	);
	const { operations, context } = given.candidate;
	const when = await operations.composeArtifact(context, given.records.request);
	assert.ok(when.ok, JSON.stringify(when));
	assert.equal(
		given.db.sql.prepare("SELECT outcome FROM attempts").get()?.["outcome"],
		"succeeded",
	);
	assert.equal(
		given.db.sql.prepare("SELECT event FROM canonical_completions").get()?.[
			"event"
		],
		null,
	);
	given.db.sql.exec("DROP TRIGGER reject_terminal");
	assert.deepEqual(
		await operations.composeArtifact(context, given.records.request),
		when,
	);
	assert.equal(
		given.db.sql
			.prepare("SELECT COUNT(*) AS n FROM observations WHERE kind='succeeded'")
			.get()?.["n"],
		1,
	);
});

test("retains interrupted and successful attempts when takeover consumes the last outbox slots", {
	timeout: 60000,
}, async () => {
	await using given = await fixtureHost();
	using db = new DurabilityDatabase(
		`${given.root}/takeover.sqlite`,
		{ ...defaultLimits, maxPendingEvents: 10 },
		() => Date.parse(given.state.now),
	);
	const started = barrier();
	const release = barrier();
	const backend = given.records.profile.private_permissions;
	let held = false;
	const firstHost = {
		...given.host(),
		db,
		profiles: [
			{
				...given.records.profile,
				private_permissions: {
					...backend,
					async permission(request: Parameters<typeof backend.permission>[0]) {
						if (!held) {
							held = true;
							started.resolve();
							await release.promise;
						}
						return backend.permission(request);
					},
				},
			},
		],
	};
	seed(db, firstHost.private_scope, 7);
	const first = createCandidateProductionOperations(firstHost);
	const pending = first.operations.composeArtifact(
		first.context,
		given.records.request,
	);
	await started.promise;
	given.state.now = "2026-10-10T12:05:31.000Z";
	const second = createCandidateProductionOperations({ ...given.host(), db });
	const when = await second.operations.composeArtifact(
		second.context,
		given.records.request,
	);
	assert.ok(when.ok, JSON.stringify(when));
	release.resolve();
	assert.deepEqual(await pending, when);
	assert.deepEqual(
		db.sql
			.prepare("SELECT outcome FROM attempts ORDER BY rowid")
			.all()
			.map((row) => row["outcome"]),
		["interrupted", "succeeded"],
	);
	assert.equal(
		db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		1,
	);
	assert.equal(
		db.sql
			.prepare("SELECT COUNT(*) AS n FROM outbox WHERE status!='delivered'")
			.get()?.["n"],
		10,
	);
	drain(db);
	assert.equal(reconcileCompletions(db), 2);
	assert.equal(
		db.sql
			.prepare(
				"SELECT COUNT(*) AS n FROM observations WHERE kind IN('interrupted','succeeded')",
			)
			.get()?.["n"],
		2,
	);
	assert.deepEqual(
		await second.operations.composeArtifact(
			second.context,
			given.records.request,
		),
		when,
	);
	assert.equal(
		db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
		2,
	);
});

test("bounds failed attempts when a host repeatedly rejects unknown values", async () => {
	await using given = await fixtureHost();
	const host = given.host();
	const candidate = createCandidateProductionOperations({
		...host,
		profiles: [
			{
				...given.records.profile,
				private_permissions: {
					...given.records.profile.private_permissions,
					permission: async () => Promise.reject(null),
				},
			},
		],
	});
	for (let i = 0; i < given.db.limits.maxAttempts; i++) {
		const result = await candidate.operations.composeArtifact(
			candidate.context,
			given.records.request,
		);
		assert.ok(!result.ok);
		assert.equal(result.error.code, "INTEGRITY_FAILURE");
	}
	const when = await candidate.operations.composeArtifact(
		candidate.context,
		given.records.request,
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "RETRYABLE_RENDER_FAILURE");
	assert.equal(
		given.db.sql
			.prepare("SELECT COUNT(*) AS n FROM attempts WHERE outcome='failed'")
			.get()?.["n"],
		given.db.limits.maxAttempts,
	);
});

test("durably classifies an expired last attempt when no further execution can be admitted", {
	timeout: 60000,
}, async () => {
	await using given = await fixtureHost();
	const started = barrier();
	const release = barrier();
	let last = false;
	const host = given.host();
	const candidateHost = {
		...host,
		profiles: [
			{
				...given.records.profile,
				private_permissions: {
					...given.records.profile.private_permissions,
					permission: async () => {
						if (last) {
							started.resolve();
							await release.promise;
						}
						return Promise.reject(null);
					},
				},
			},
		],
	};
	const candidate = createCandidateProductionOperations(candidateHost);
	for (let i = 0; i < given.db.limits.maxAttempts - 1; i++) {
		const result = await candidate.operations.composeArtifact(
			candidate.context,
			given.records.request,
		);
		assert.ok(!result.ok);
	}
	last = true;
	const pending = candidate.operations.composeArtifact(
		candidate.context,
		given.records.request,
	);
	await started.promise;
	given.state.now = "2026-10-10T12:05:31.000Z";
	const restarted = createCandidateProductionOperations(host);
	const when = await restarted.operations.composeArtifact(
		restarted.context,
		given.records.request,
	);
	assert.ok(!when.ok);
	assert.equal(when.error.code, "RETRYABLE_RENDER_FAILURE");
	release.resolve();
	const late = await pending;
	assert.ok(!late.ok);
	assert.equal(late.error.code, "INTEGRITY_FAILURE");
	assert.deepEqual(
		given.db.sql
			.prepare("SELECT outcome FROM attempts ORDER BY rowid")
			.all()
			.map((row) => row["outcome"]),
		["failed", "failed", "interrupted"],
	);
	assert.equal(
		given.db.sql
			.prepare(
				"SELECT COUNT(*) AS n FROM observations WHERE kind='interrupted'",
			)
			.get()?.["n"],
		1,
	);
	assert.equal(
		given.db.sql.prepare("SELECT COUNT(*) AS n FROM publications").get()?.["n"],
		0,
	);
});

for (const mode of ["compose", "export"] as const)
	test(`recovers ${mode} publication when a separate process is killed before final telemetry`, {
		timeout: 60000,
	}, async (t) => {
		const root = await mkdtemp(join(tmpdir(), "pp-canonical-window-"));
		t.after(() => rm(root, { recursive: true, force: true }));
		const child = spawn(
			process.execPath,
			[
				new URL(
					"../fixtures/canonical-production/publication-window.js",
					import.meta.url,
				).pathname,
				root,
				mode,
			],
			{ stdio: ["pipe", "pipe", "pipe"] },
		);
		t.after(() => {
			if (child.exitCode === null && child.signalCode === null)
				child.kill("SIGKILL");
		});
		const exited = once(child, "exit");
		const [chunk] = await once(child.stdout, "data", {
			signal: AbortSignal.timeout(50000),
		});
		assert.ok(Buffer.isBuffer(chunk));
		const committed = z
			.object({ publication: z.string(), attempt: z.string() })
			.parse(JSON.parse(chunk.toString()));
		child.kill("SIGKILL");
		const [code, signal] = await exited;
		assert.equal(code, null);
		assert.equal(signal, "SIGKILL");
		await using given = await fixtureHost({ root, preserve: true });
		assert.equal(
			given.db.sql
				.prepare("SELECT outcome FROM attempts WHERE id=?")
				.get(committed.attempt)?.["outcome"],
			"succeeded",
		);
		assert.equal(
			given.db.sql
				.prepare("SELECT event FROM canonical_completions WHERE attempt=?")
				.get(committed.attempt)?.["event"],
			null,
		);
		const before = given.db.sql
			.prepare("SELECT id,set_digest FROM publications ORDER BY rowid")
			.all();
		const { operations, context } = given.candidate;
		const artifact = await operations.composeArtifact(
			context,
			given.records.request,
		);
		assert.ok(artifact.ok, JSON.stringify(artifact));
		if (mode === "export") {
			const exported = await operations.exportArtifactBundle(
				context,
				exportRequest(given.records, artifact.value),
			);
			assert.ok(exported.ok, JSON.stringify(exported));
		}
		assert.deepEqual(
			given.db.sql
				.prepare("SELECT id,set_digest FROM publications ORDER BY rowid")
				.all(),
			before,
		);
		assert.equal(before.length, mode === "export" ? 2 : 1);
		assert.equal(
			given.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
			before.length,
		);
		assert.equal(
			given.db.sql
				.prepare(
					"SELECT COUNT(*) AS n FROM observations WHERE attempt=? AND kind='succeeded'",
				)
				.get(committed.attempt)?.["n"],
			1,
		);
	});
