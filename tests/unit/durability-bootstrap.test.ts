import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	defaultLimits,
	DurabilityDatabase,
	DurabilityError,
} from "../../src/internal/durability.js";

const moduleUrl = new URL("../../src/internal/durability.js", import.meta.url);
const environment = Object.fromEntries(
	Object.entries(process.env).filter(([key]) => !key.startsWith("NODE_TEST_")),
);
const workerSource = `
import { DurabilityDatabase, DurabilityError } from ${JSON.stringify(moduleUrl.href)};
process.send({ ready: true });
process.once("message", () => {
  let database;
  try {
    database = new DurabilityDatabase(process.argv[1]);
    database.transaction(() => {
      database.sql.prepare(
        "INSERT INTO operations(id,scope,key,request) VALUES(?,?,?,?)"
      ).run(process.argv[2], "synthetic-scope", process.argv[2], "synthetic-request");
    });
    process.send({
      ok: true,
      journal: database.sql.prepare("PRAGMA journal_mode").get().journal_mode,
      timeout: database.sql.prepare("PRAGMA busy_timeout").get().timeout,
      foreignKeys: database.sql.prepare("PRAGMA foreign_keys").get().foreign_keys,
      synchronous: database.sql.prepare("PRAGMA synchronous").get().synchronous,
    });
  } catch (error) {
    process.send({ ok: false, code: error instanceof DurabilityError ? error.code : "UNEXPECTED" });
    process.exitCode = 1;
  } finally {
    database?.close();
    process.disconnect();
  }
});
`;

function worker(path: string, id: string) {
	const child = spawn(
		process.execPath,
		["--input-type=module", "--eval", workerSource, path, id],
		{
			env: environment,
			stdio: ["ignore", "ignore", "ignore", "ipc"],
			timeout: 20000,
		},
	);
	let result: unknown;
	const ready = new Promise<void>((resolve, reject) => {
		child.once("message", (message) => {
			if (
				typeof message === "object" &&
				message !== null &&
				"ready" in message &&
				message.ready === true
			)
				resolve();
			else reject(new Error("BOOTSTRAP_CHILD_PROTOCOL"));
		});
		child.once("error", reject);
		child.once("exit", () => reject(new Error("BOOTSTRAP_CHILD_EXIT")));
	});
	child.on("message", (message) => {
		result = message;
	});
	const done = new Promise<{
		code: number | null;
		signal: NodeJS.Signals | null;
		result: unknown;
	}>((resolve) => {
		child.once("exit", (code, signal) => resolve({ code, signal, result }));
		child.once("error", () => {
			resolve({ code: null, signal: null, result: "SPAWN_FAILED" });
		});
	});
	return { child, ready, done };
}

test("cold opens preserve every concurrent writer", async () => {
	for (let round = 0; round < 4; round++) {
		const directory = await mkdtemp(join(tmpdir(), "pp-bootstrap-"));
		const path = join(directory, "private.sqlite");
		const workers: ReturnType<typeof worker>[] = [];
		try {
			for (let i = 0; i < 8; i++) workers.push(worker(path, `row-${i}`));
			await Promise.all(workers.map((entry) => entry.ready));
			for (const { child } of workers) child.send("start");
			const results = await Promise.all(workers.map((entry) => entry.done));
			for (const result of results)
				assert.deepEqual(result, {
					code: 0,
					signal: null,
					result: {
						ok: true,
						journal: "wal",
						timeout: 10000,
						foreignKeys: 1,
						synchronous: 2,
					},
				});
			const database = new DurabilityDatabase(path);
			try {
				const rows = database.sql.prepare("SELECT COUNT(*) n FROM operations");
				const settings = database.sql.prepare("SELECT COUNT(*) n FROM settings");
				const integrity = database.sql.prepare("PRAGMA integrity_check").get();
				assert.equal(rows.get()?.["n"], 8);
				assert.equal(settings.get()?.["n"], 1);
				assert.equal(integrity?.["integrity_check"], "ok");
			} finally {
				database.close();
			}
		} finally {
			for (const { child } of workers)
				if (child.exitCode === null && child.signalCode === null)
					child.kill("SIGKILL");
			await Promise.all(workers.map((entry) => entry.done));
			await rm(directory, { recursive: true, force: true });
		}
	}
});

test("bootstrap retains settings and version conflicts", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "pp-bootstrap-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const path = join(directory, "private.sqlite");
	const original = new DurabilityDatabase(path);
	original.close();
	assert.throws(
		() => new DurabilityDatabase(path, { ...defaultLimits, maxRows: 999 }),
		(error) =>
			error instanceof DurabilityError && error.code === "IDEMPOTENCY_CONFLICT",
	);
	const reopened = new DurabilityDatabase(path);
	reopened.sql.exec("UPDATE settings SET version=99 WHERE id=1");
	reopened.close();
	assert.throws(
		() => new DurabilityDatabase(path),
		(error) =>
			error instanceof DurabilityError && error.code === "UNSUPPORTED_VERSION",
	);
});

test("corrupt storage stays unchanged and fails closed", async (t) => {
	const directory = await mkdtemp(join(tmpdir(), "pp-bootstrap-"));
	t.after(() => rm(directory, { recursive: true, force: true }));
	const path = join(directory, "private.sqlite");
	const bytes = Buffer.from("synthetic-not-a-database");
	await writeFile(path, bytes, { mode: 0o600 });
	assert.throws(
		() => new DurabilityDatabase(path),
		(error) => error instanceof DurabilityError && error.code === "STORAGE",
	);
	assert.deepEqual(await readFile(path), bytes);
});
