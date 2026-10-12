import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DurabilityError,
	hash,
	scopeKey,
} from "../../src/internal/durability.js";
import {
	canonicalJson,
	evidencePageSchemaId,
	readEvidencePage,
	verifyEvidencePage,
} from "../../src/telemetry/evidence-page.js";
import {
	fixture,
	file,
	plan,
	scope,
	foreign,
	sensitive,
} from "../fixtures/durability/fixture.js";

const invalid = (error: unknown) =>
	error instanceof DurabilityError && error.code === "INVALID_INPUT";
function seedJob(f: ReturnType<typeof fixture>, key = "batch") {
	f.jobs.create(scope, plan(key, 2));
	const claim = f.jobs.claim(scope);
	assert.ok(claim);
	f.jobs.complete(scope, claim, [file()]);
}
function outboxState(f: ReturnType<typeof fixture>) {
	return {
		outbox: f.db.sql.prepare("SELECT * FROM outbox ORDER BY rowid").all(),
		transports: f.db.sql.prepare("SELECT * FROM transports").all(),
	};
}

test("envelope states staged, unmapped, non-authoritative provenance with a verifiable digest", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	assert.equal(page.schema, evidencePageSchemaId);
	assert.equal(page.version, 1);
	assert.deepEqual(
		{ ...page.provenance, note: undefined },
		{
			staged: true,
			local: true,
			mapped: false,
			authoritative: false,
			delivered: false,
			note: undefined,
		},
	);
	assert.equal(page.scopeDigest, scopeKey(scope));
	assert.equal(page.integrity.algorithm, "sha256");
	const { integrity, ...payload } = page;
	assert.equal(integrity.payloadDigest, hash(canonicalJson(payload)));
	assert.equal(verifyEvidencePage(page), true);
	assert.equal(
		verifyEvidencePage({
			...page,
			observations: page.observations.slice(1),
		}),
		false,
	);
	assert.equal(
		verifyEvidencePage({
			...page,
			provenance: { ...page.provenance, authoritative: true as never },
		}),
		false,
	);
});

test("repeated reads are byte-stable and carry recorded references and provenance", () => {
	using f = fixture();
	seedJob(f);
	const a = readEvidencePage(f.outbox, scope);
	const b = readEvidencePage(f.outbox, scope);
	assert.equal(JSON.stringify(a), JSON.stringify(b));
	const source = f.outbox.list(scope);
	assert.ok(source.length > 0);
	assert.equal(a.observations.length, source.length);
	a.observations.forEach((o, i) => {
		const s = source[i];
		assert.ok(s);
		assert.equal(o.observationId, s.id);
		assert.equal(o.operationId, s.operation);
		assert.equal(o.executionAttemptId, s.attempt);
		assert.equal(o.jobId, s.job);
		assert.equal(o.rowKeyDigest, s.row);
		assert.equal(o.publicationId, s.publication);
		assert.equal(o.environment, "local");
		assert.equal(o.billingMode, "unclassified");
		assert.equal(o.producerBuildDigest, null);
		assert.equal(o.stagingVersion, 1);
	});
	assert.ok(a.observations.some((o) => o.executionAttemptId !== null));
	assert.ok(a.observations.some((o) => o.jobId !== null));
});

test("preserves unknown measurements and never substitutes zero", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	const planned = page.observations.filter((o) => o.kind === "planned");
	assert.ok(planned.length > 0);
	for (const o of planned) {
		assert.deepEqual(o.metrics.duration, {
			unit: "millisecond",
			value: null,
			completeness: "unknown",
		});
		assert.deepEqual(o.metrics.outputBytes, {
			unit: "byte",
			value: null,
			completeness: "unknown",
		});
	}
	const measured = page.observations.filter(
		(o) => o.metrics.duration.completeness === "measured",
	);
	assert.ok(measured.length > 0);
	for (const o of page.observations) {
		for (const m of Object.values(o.metrics))
			assert.equal(m.value === null, m.completeness === "unknown");
	}
});

test("paginates without skipping or duplicating and binds cursors to scope", () => {
	using f = fixture();
	seedJob(f, "one");
	seedJob(f, "two");
	const all = f.outbox.list(scope).map((e) => e.id);
	assert.ok(all.length > 3);
	const seen: string[] = [];
	let cursor: string | null = null;
	let pages = 0;
	do {
		const page = readEvidencePage(f.outbox, scope, { cursor, limit: 3 });
		assert.ok(page.observations.length <= 3);
		assert.equal(verifyEvidencePage(page), true);
		seen.push(...page.observations.map((o) => o.observationId));
		cursor = page.nextCursor;
		pages++;
	} while (cursor !== null && pages < 100);
	assert.deepEqual(seen, all);
	assert.equal(pages, Math.ceil(all.length / 3));
	const first = readEvidencePage(f.outbox, scope, { limit: 3 });
	assert.ok(first.nextCursor);
	assert.throws(
		() => readEvidencePage(f.outbox, foreign, { cursor: first.nextCursor }),
		invalid,
	);
	for (const bad of ["", "7", "v1:x:1", `v1:${scopeKey(scope)}:-1`])
		assert.throws(
			() => readEvidencePage(f.outbox, scope, { cursor: bad }),
			invalid,
		);
	assert.throws(
		() => readEvidencePage(f.outbox, scope, { limit: 0 }),
		(e) => e instanceof DurabilityError && e.code === "LIMIT",
	);
	const empty = readEvidencePage(f.outbox, foreign);
	assert.deepEqual(empty.observations, []);
	assert.equal(empty.nextCursor, null);
});

test("isolates scopes", () => {
	using f = fixture();
	seedJob(f);
	const mine = readEvidencePage(f.outbox, scope);
	const theirs = readEvidencePage(f.outbox, foreign);
	assert.equal(theirs.observations.length, 0);
	assert.notEqual(theirs.scopeDigest, mine.scopeDigest);
	assert.ok(mine.observations.every((o) => o.observationId));
});

test("reading evidence leaves outbox delivery state and transports unchanged", () => {
	using f = fixture();
	seedJob(f);
	const claim = f.outbox.claim();
	assert.ok(claim);
	const before = outboxState(f);
	readEvidencePage(f.outbox, scope);
	readEvidencePage(f.outbox, scope, { limit: 1 });
	assert.deepEqual(outboxState(f), before);
	f.outbox.settle(claim, true);
	const settled = outboxState(f);
	readEvidencePage(f.outbox, scope);
	assert.deepEqual(outboxState(f), settled);
});

test("exports no raw input, names, scope strings, URLs or secrets", () => {
	using f = fixture();
	const bytes = Buffer.from(sensitive);
	const op = f.store.bind(scope, "export", sensitive, bytes, hash(bytes));
	const stage = f.store.stage(scope, op.id);
	f.store.write(scope, stage, file());
	f.store.publish(scope, stage, [file()]);
	seedJob(f);
	const text = JSON.stringify(readEvidencePage(f.outbox, scope));
	for (const leak of [
		sensitive,
		"SYNTHETIC_PRIVATE_NAME",
		scope.tenant,
		scope.project,
		"https://",
		"secret",
		"output.bin",
		"row-0",
	])
		assert.equal(text.includes(leak), false, leak);
	assert.deepEqual(
		Object.keys(readEvidencePage(f.outbox, scope).observations[0] ?? {}).sort(),
		[
			"billingMode",
			"code",
			"environment",
			"executionAttemptId",
			"jobId",
			"kind",
			"metrics",
			"observationId",
			"operationId",
			"producerBuildDigest",
			"publicationId",
			"recordedAtMs",
			"requestDigest",
			"rowKeyDigest",
			"sequence",
			"stagingVersion",
		],
	);
});
