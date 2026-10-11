import { test } from "node:test";
import assert from "node:assert/strict";
import { DurabilityError, hash } from "../../src/internal/durability.js";
import {
	fixture,
	file,
	scope,
	foreign,
} from "../fixtures/durability/fixture.js";

const isCode = (code: DurabilityError["code"]) => (error: unknown) =>
	error instanceof DurabilityError && error.code === code;
test("re-observes completed IDs and publishes a complete output set when retried", () => {
	using f = fixture();
	const input = Buffer.from("opaque");
	const op = f.store.bind(scope, "export", "key", input, hash(input));
	const stage = f.store.stage(scope, op.id);
	const a = file();
	const b = file("manifest.bin", "manifest");
	f.store.write(scope, stage, a);
	f.store.write(scope, stage, b);
	const pub = f.store.publish(scope, stage, [b, a]);
	const repeated = f.store.bind(scope, "export", "key", input, hash(input));
	assert.equal(repeated.id, op.id);
	assert.equal(repeated.status, "completed");
	assert.equal(f.store.publish(scope, stage, [a, b]).id, pub.id);
	assert.equal(f.store.retrieve(scope, pub.id).files.length, 2);
	assert.equal(f.store.retrieve(scope, pub.id).handoffEligible, false);
	assert.equal(f.outbox.list(scope).length, 1);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM attempts").get()?.["n"],
		0,
	);
});
test("conflicts on changed opaque requests when the scoped key is reused", () => {
	using f = fixture();
	const original = Buffer.from("one");
	f.store.bind(scope, "export", "key", original, hash(original));
	const changed = Buffer.from("two");
	assert.throws(
		() => f.store.bind(scope, "export", "key", changed, hash(changed)),
		isCode("IDEMPOTENCY_CONFLICT"),
	);
});
test("separates logical operations and scopes when physical bytes are equal", () => {
	using f = fixture();
	const input = Buffer.from("opaque");
	const a = f.store.bind(scope, "export", "one", input, hash(input));
	const b = f.store.bind(scope, "export", "two", input, hash(input));
	const c = f.store.bind(foreign, "export", "one", input, hash(input));
	const publications = [a, b, c].map((op, i) => {
		const s = i === 2 ? foreign : scope;
		const stage = f.store.stage(s, op.id);
		f.store.write(s, stage, file());
		return f.store.publish(s, stage, [file()]);
	});
	assert.equal(new Set(publications.map((p) => p.id)).size, 3);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM blobs").get()?.["n"],
		1,
	);
	assert.throws(
		() => f.store.retrieve(foreign, publications[0]?.id ?? a.id),
		isCode("NOT_FOUND"),
	);
	assert.throws(() => f.store.operation(foreign, a.id), isCode("NOT_FOUND"));
});
test("keeps incomplete stages invisible when publication lacks expected files", () => {
	using f = fixture();
	const input = Buffer.from("opaque");
	const op = f.store.bind(scope, "export", "key", input, hash(input));
	const stage = f.store.stage(scope, op.id);
	f.store.write(scope, stage, file());
	assert.throws(
		() => f.store.publish(scope, stage, [file(), file("missing.bin")]),
		isCode("INTEGRITY"),
	);
	assert.equal(f.store.publication(scope, op.id), null);
	assert.equal(f.outbox.list(scope).length, 0);
});
test("rejects unsafe filenames and wrong byte claims when staging", () => {
	using f = fixture();
	const input = Buffer.from("opaque");
	const op = f.store.bind(scope, "export", "key", input, hash(input));
	const stage = f.store.stage(scope, op.id);
	for (const name of [
		"../secret",
		"/absolute",
		"a/b",
		"a\\b",
		"..",
		"bad\u0000name",
	])
		assert.throws(
			() => f.store.write(scope, stage, file(name)),
			isCode("INVALID_INPUT"),
		);
	assert.throws(
		() => f.store.write(scope, stage, { ...file(), length: 123 }),
		isCode("INTEGRITY"),
	);
	assert.throws(
		() => f.store.write(scope, stage, { ...file(), digest: hash("wrong") }),
		isCode("INTEGRITY"),
	);
});
test("enforces write-once content when an existing name changes", () => {
	using f = fixture();
	const input = Buffer.from("opaque");
	const op = f.store.bind(scope, "export", "key", input, hash(input));
	const stage = f.store.stage(scope, op.id);
	f.store.write(scope, stage, file());
	assert.throws(
		() => f.store.write(scope, stage, file("output.bin", "changed")),
		isCode("WRITE_ONCE"),
	);
});
test("detects stored byte and output-set tampering on retrieval", () => {
	using f = fixture();
	const input = Buffer.from("opaque");
	const op = f.store.bind(scope, "export", "key", input, hash(input));
	const stage = f.store.stage(scope, op.id);
	f.store.write(scope, stage, file());
	const pub = f.store.publish(scope, stage, [file()]);
	f.db.sql
		.prepare("UPDATE blobs SET bytes=?")
		.run(Buffer.alloc(file().length, 88));
	assert.throws(() => f.store.retrieve(scope, pub.id), isCode("INTEGRITY"));
});
test("detects missing files from a published output set", () => {
	using f = fixture();
	const input = Buffer.from("opaque");
	const op = f.store.bind(scope, "export", "set", input, hash(input));
	const stage = f.store.stage(scope, op.id);
	f.store.write(scope, stage, file());
	const pub = f.store.publish(scope, stage, [file()]);
	f.db.sql.prepare("DELETE FROM files WHERE publication=?").run(pub.id);
	assert.throws(() => f.store.retrieve(scope, pub.id), isCode("INTEGRITY"));
});
test("denies revoked access while retaining immutable output bytes", () => {
	using f = fixture();
	const input = Buffer.from("opaque");
	const op = f.store.bind(scope, "export", "key", input, hash(input));
	const stage = f.store.stage(scope, op.id);
	f.store.write(scope, stage, file());
	const pub = f.store.publish(scope, stage, [file()]);
	f.store.deny(scope, op.id);
	assert.throws(() => f.store.retrieve(scope, pub.id), isCode("NOT_FOUND"));
	const bytes = f.db.sql.prepare("SELECT bytes FROM blobs").get()?.["bytes"];
	assert.ok(bytes instanceof Uint8Array);
	assert.equal(Buffer.from(bytes).toString(), file().bytes.toString());
});
test("cleans abandoned stages without deleting completed bytes", () => {
	using f = fixture();
	const input = Buffer.from("opaque");
	const op = f.store.bind(scope, "export", "one", input, hash(input));
	const stage = f.store.stage(scope, op.id);
	f.store.write(scope, stage, file());
	const pub = f.store.publish(scope, stage, [file()]);
	const other = f.store.bind(scope, "export", "two", input, hash(input));
	const abandoned = f.store.stage(scope, other.id);
	f.store.write(scope, abandoned, file("extra.bin", "orphan"));
	f.store.abandon(scope, abandoned);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM blobs").get()?.["n"],
		1,
	);
	assert.equal(f.store.retrieve(scope, pub.id).files.length, 1);
	assert.throws(
		() => f.store.publish(scope, abandoned, [file("extra.bin", "orphan")]),
		isCode("WRITE_ONCE"),
	);
});
test("rejects mutation helpers outside a durable transaction", () => {
	using f = fixture();
	const input = Buffer.from("opaque");
	assert.throws(
		() =>
			f.store.bindInTransaction(scope, "export", "unsafe", input, hash(input)),
		isCode("STORAGE"),
	);
	assert.equal(
		f.db.sql.prepare("SELECT COUNT(*) AS n FROM operations").get()?.["n"],
		0,
	);
});
