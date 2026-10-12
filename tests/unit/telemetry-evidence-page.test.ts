import { test } from "node:test";
import assert from "node:assert/strict";
import {
	DurabilityError,
	hash,
	scopeKey,
} from "../../src/internal/durability.js";
import {
	canonicalJson,
	evidencePayloadDigest,
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
			deliveryStatus: "not_included",
			note: undefined,
		},
	);
	assert.equal("delivered" in page.provenance, false);
	assert.match(page.provenance.note, /no delivery claim/);
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

test("projects metrics explicitly so unexpected runtime fields never leak", () => {
	using f = fixture();
	seedJob(f);
	const real = f.outbox.list(scope);
	const leak = "https://private.invalid/?signature=secret";
	const injected = real.map((event) => ({
		...event,
		metrics: {
			outputBytes: { ...event.metrics.outputBytes, privateUrl: leak },
			duration: { ...event.metrics.duration, privateUrl: leak },
			rows: { ...event.metrics.rows, privateUrl: leak },
		},
	}));
	f.outbox.list = () => injected;
	const page = readEvidencePage(f.outbox, scope);
	const text = JSON.stringify(page);
	assert.equal(text.includes(leak), false);
	assert.equal(text.includes("privateUrl"), false);
	assert.equal(verifyEvidencePage(page), true);
	page.observations.forEach((o, i) => {
		const m = real[i]?.metrics;
		assert.ok(m);
		assert.deepEqual(o.metrics, m);
		for (const metric of Object.values(o.metrics))
			assert.deepEqual(Object.keys(metric), ["unit", "value", "completeness"]);
	});
});

test("canonicalization fails closed on non-JSON and malformed values", () => {
	const reject = (value: unknown) =>
		assert.throws(() => canonicalJson(value), invalid);
	reject(undefined);
	reject({ a: undefined });
	reject([undefined]);
	reject(Number.NaN);
	reject({ a: Number.POSITIVE_INFINITY });
	reject(() => 1);
	reject(Symbol("x"));
	reject(1n);
	reject(new Array(2));
	reject([1, , 3]);
	const extra = [1, 2];
	(extra as unknown as Record<string, unknown>)["x"] = 1;
	reject(extra);
	const cycle: Record<string, unknown> = {};
	cycle["self"] = cycle;
	reject(cycle);
	const arrayCycle: unknown[] = [];
	arrayCycle.push(arrayCycle);
	reject(arrayCycle);
	reject({
		get a() {
			return 1;
		},
	});
	reject({ [Symbol("k")]: 1 });
	reject(new Date(0));
	reject(new Map());
	reject(Object.defineProperty({}, "hidden", { value: 1, enumerable: false }));
	// shared (non-cyclic) references are fine and deterministic
	const shared = { v: 1 };
	assert.equal(
		canonicalJson({ b: shared, a: [shared] }),
		'{"a":[{"v":1}],"b":{"v":1}}',
	);
	assert.equal(canonicalJson(Object.create(null)), "{}");
});

test("verification returns false without throwing for malformed or mutated pages", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	assert.ok(page.observations.length > 1);
	const sparse = new Array(page.observations.length);
	sparse[0] = page.observations[0];
	assert.equal(verifyEvidencePage({ ...page, observations: sparse }), false);
	const hole = [...page.observations];
	delete hole[1];
	assert.equal(verifyEvidencePage({ ...page, observations: hole }), false);
	assert.equal(
		verifyEvidencePage({ ...page, nextCursor: undefined as never }),
		false,
	);
	assert.equal(verifyEvidencePage({ ...page, after: Number.NaN }), false);
	const cyclic = { ...page, observations: [] as unknown[] };
	cyclic.observations.push(cyclic);
	assert.equal(verifyEvidencePage(cyclic as never), false);
	assert.equal(
		verifyEvidencePage({ ...page, integrity: null as never }),
		false,
	);
	assert.equal(verifyEvidencePage(null as never), false);
	assert.throws(
		() => evidencePayloadDigest({ ...page, observations: sparse } as never),
		invalid,
	);
	assert.equal(verifyEvidencePage(page), true);
});

test("verification never invokes getters at the root or nested levels", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	let calls = 0;
	const getter = (value: unknown) => ({
		enumerable: true,
		configurable: true,
		get: () => {
			calls++;
			return value;
		},
	});
	const rootAfter = Object.defineProperty(
		{ ...page },
		"after",
		getter(page.after),
	);
	const integrityGetter = Object.defineProperty(
		{ ...page },
		"integrity",
		getter(page.integrity),
	);
	const nestedIntegrity = {
		...page,
		integrity: Object.defineProperty(
			{ ...page.integrity },
			"payloadDigest",
			getter(page.integrity.payloadDigest),
		),
	};
	const nestedObservation = {
		...page,
		observations: [
			Object.defineProperty(
				{ ...page.observations[0] },
				"sequence",
				getter(page.observations[0]?.sequence),
			),
			...page.observations.slice(1),
		],
	};
	for (const malformed of [
		rootAfter,
		integrityGetter,
		nestedIntegrity,
		nestedObservation,
	])
		assert.equal(verifyEvidencePage(malformed as never), false);
	assert.equal(calls, 0);
	assert.equal(verifyEvidencePage(page), true);
});

test("verification preserves own __proto__ keys instead of dropping them", () => {
	using f = fixture();
	seedJob(f);
	const page = readEvidencePage(f.outbox, scope);
	for (const value of [null, 17]) {
		const forged = JSON.parse(
			JSON.stringify(page).replace(/^\{/, `{"__proto__":${value},`),
		);
		assert.equal(Object.hasOwn(forged, "__proto__"), true);
		assert.equal(forged.integrity.payloadDigest, page.integrity.payloadDigest);
		assert.equal(verifyEvidencePage(forged), false);
	}
	assert.equal(verifyEvidencePage(JSON.parse(JSON.stringify(page))), true);
	assert.equal(verifyEvidencePage(page), true);
});
