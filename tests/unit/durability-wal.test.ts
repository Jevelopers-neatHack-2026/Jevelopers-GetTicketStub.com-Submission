import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { test, type TestContext } from "node:test";
import { enableDurabilityWal } from "../../src/internal/durability-wal.js";

async function database(t: TestContext): Promise<DatabaseSync> {
	const directory = await mkdtemp(join(tmpdir(), "pp-wal-"));
	const sql = new DatabaseSync(join(directory, "private.sqlite"));
	t.after(async () => {
		sql.close();
		await rm(directory, { recursive: true, force: true });
	});
	return sql;
}

function busy(): Error {
	return Object.assign(new Error("synthetic contention"), {
		code: "ERR_SQLITE_ERROR",
		errcode: 5,
	});
}

function timeout(sql: DatabaseSync): unknown {
	return sql.prepare("PRAGMA busy_timeout").get()?.["timeout"];
}

test("sets WAL and preserves the existing busy timeout", async (t) => {
	const sql = await database(t);
	enableDurabilityWal(sql);
	const mode = sql.prepare("PRAGMA journal_mode").get();
	assert.equal(mode?.["journal_mode"], "wal");
	assert.equal(timeout(sql), 10000);
	sql.exec(
		"CREATE TABLE retained (value TEXT); INSERT INTO retained VALUES('one')",
	);
	enableDurabilityWal(sql);
	const retained = sql.prepare("SELECT value FROM retained").get();
	assert.equal(retained?.["value"], "one");
	assert.equal(timeout(sql), 10000);
});

test("rejects a successful non-WAL result", () => {
	const sql = new DatabaseSync(":memory:");
	try {
		assert.throws(() => enableDurabilityWal(sql), /WAL_UNAVAILABLE/);
		assert.equal(timeout(sql), 10000);
	} finally {
		sql.close();
	}
});

test("does not retry inside an application transaction", async (t) => {
	const sql = await database(t);
	sql.exec("BEGIN");
	assert.throws(() => enableDurabilityWal(sql), /WAL_SETUP_IN_TRANSACTION/);
	assert.equal(sql.isTransaction, true);
	sql.exec("ROLLBACK");
});

for (const phase of ["prepare", "step"] as const) {
	test(`retries one injected BUSY from ${phase}`, async (t) => {
		const sql = await database(t);
		const prepare = sql.prepare.bind(sql);
		let attempts = 0;
		const failure = busy();
		t.mock.method(sql, "prepare", (statement: string) => {
			if (statement === "PRAGMA journal_mode=WAL") {
				attempts++;
				if (attempts === 1 && phase === "prepare") throw failure;
				const prepared = prepare(statement);
				if (attempts === 1 && phase === "step")
					t.mock.method(prepared, "get", () => {
						throw failure;
					});
				return prepared;
			}
			return prepare(statement);
		});
		enableDurabilityWal(sql);
		assert.equal(attempts, 2);
		assert.equal(timeout(sql), 10000);
	});
}

for (const errcode of [6, 26, 517, "5", undefined]) {
	test(`does not retry unsupported code ${String(errcode)}`, async (t) => {
		const sql = await database(t);
		const prepare = sql.prepare.bind(sql);
		const failure = Object.assign(new Error("synthetic failure"), {
			code: "ERR_SQLITE_ERROR",
			errcode,
		});
		let attempts = 0;
		t.mock.method(sql, "prepare", (statement: string) => {
			if (statement === "PRAGMA journal_mode=WAL") {
				attempts++;
				throw failure;
			}
			return prepare(statement);
		});
		assert.throws(
			() => enableDurabilityWal(sql),
			(error) => error === failure,
		);
		assert.equal(attempts, 1);
		assert.equal(timeout(sql), 10000);
	});
}

test("does not retry a non-SQLite exception", async (t) => {
	const sql = await database(t);
	const failure = Object.assign(new Error("synthetic failure"), { errcode: 5 });
	const prepare = t.mock.method(sql, "prepare", () => {
		throw failure;
	});
	assert.throws(
		() => enableDurabilityWal(sql),
		(error) => error === failure,
	);
	assert.equal(prepare.mock.callCount(), 1);
});

test("stops at the deadline and restores the timeout", async (t) => {
	const sql = await database(t);
	const times = [0, 0, 10000];
	t.mock.method(performance, "now", () => times.shift() ?? 10000);
	const wait = t.mock.method(Atomics, "wait", () => "timed-out" as const);
	const prepare = sql.prepare.bind(sql);
	const failure = busy();
	let attempts = 0;
	t.mock.method(sql, "prepare", (statement: string) => {
		if (statement === "PRAGMA journal_mode=WAL") {
			attempts++;
			throw failure;
		}
		return prepare(statement);
	});
	assert.throws(
		() => enableDurabilityWal(sql),
		(error) => error === failure,
	);
	assert.equal(attempts, 1);
	assert.equal(wait.mock.callCount(), 0);
	assert.equal(timeout(sql), 10000);
});

test("does not start another attempt after the deadline", async (t) => {
	const sql = await database(t);
	const times = [0, 0, 9999, 10001];
	t.mock.method(performance, "now", () => times.shift() ?? 10001);
	const wait = t.mock.method(Atomics, "wait", () => "timed-out" as const);
	const failure = busy();
	const prepare = t.mock.method(sql, "prepare", () => {
		throw failure;
	});
	assert.throws(
		() => enableDurabilityWal(sql),
		(error) => error === failure,
	);
	assert.equal(prepare.mock.callCount(), 1);
	assert.equal(wait.mock.callCount(), 1);
	assert.equal(wait.mock.calls[0]?.arguments[3], 1);
});

test("caps attempts even when the clock makes no progress", async (t) => {
	const sql = await database(t);
	t.mock.method(performance, "now", () => 0);
	const wait = t.mock.method(Atomics, "wait", () => "timed-out" as const);
	const failure = busy();
	const prepare = t.mock.method(sql, "prepare", () => {
		throw failure;
	});
	assert.throws(
		() => enableDurabilityWal(sql),
		(error) => error === failure,
	);
	assert.equal(prepare.mock.callCount(), 1000);
	assert.equal(wait.mock.callCount(), 999);
});

test("uses only the remaining SQLite wait budget", async (t) => {
	const sql = await database(t);
	const times = [0, 0, 25, 30, 50, 60];
	t.mock.method(performance, "now", () => times.shift() ?? 60);
	t.mock.method(Atomics, "wait", () => "timed-out" as const);
	const exec = sql.exec.bind(sql);
	const prepare = sql.prepare.bind(sql);
	const commands: string[] = [];
	let attempts = 0;
	t.mock.method(sql, "exec", (statement: string) => {
		commands.push(statement);
		return exec(statement);
	});
	t.mock.method(sql, "prepare", (statement: string) => {
		if (statement === "PRAGMA journal_mode=WAL" && ++attempts < 3) throw busy();
		return prepare(statement);
	});
	enableDurabilityWal(sql);
	assert.equal(attempts, 3);
	assert.deepEqual(commands, [
		"PRAGMA busy_timeout=10000",
		"PRAGMA busy_timeout=9970",
		"PRAGMA busy_timeout=9940",
		"PRAGMA busy_timeout=10000",
	]);
});
