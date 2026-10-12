import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
    if (specifier.startsWith("@/")) {
      const file = fileURLToPath(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url));
      if (existsSync(file)) return { url: pathToFileURL(file).href, shortCircuit: true };
    }
    if (specifier.startsWith(".") && context.parentURL) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(fileURLToPath(url))) return { url: url.href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith(".ts")) return {
      format: "module", shortCircuit: true,
      source: ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    };
    return nextLoad(url, context);
  },
});

const dir = mkdtempSync(join(tmpdir(), "ticketstub-backup-test-"));
process.env.TICKETSTUB_DB = join(dir, "ticketstub.sqlite");
process.env.TICKETSTUB_FILES = join(dir, "files");
const { createBackup, listBackups, backupsDir, withBackupLock, BackupBusy, backupDue, runScheduledBackup } = await import("../src/server/backup.ts");
const { backupEveryDays } = await import("../src/server/backup-schedule.ts");
const backupRoute = await import("../src/app/api/admin/backup/route.ts");

const sha = (b) => createHash("sha256").update(b).digest("hex");
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex");

test("a backup holds rows still in the WAL, and the art they point at, byte for byte", () => {
  mkdirSync(process.env.TICKETSTUB_FILES, { recursive: true });
  const art = `${sha(PNG)}.png`;
  writeFileSync(join(process.env.TICKETSTUB_FILES, art), PNG);

  // The app's connection stays open with checkpoints off, so the main file lags the WAL, as on the host.
  const app = new DatabaseSync(process.env.TICKETSTUB_DB);
  app.exec("PRAGMA journal_mode = WAL");
  app.exec("PRAGMA wal_autocheckpoint = 0");
  app.exec("CREATE TABLE stubs (id TEXT PRIMARY KEY, json TEXT)");
  const put = app.prepare("INSERT INTO stubs VALUES (?, ?)");
  for (let i = 0; i < 50; i++) put.run(`synthetic_${i}`, JSON.stringify({ art: i === 7 ? `/api/files/${art}` : null, pad: "x".repeat(2000) }));
  assert.ok(statSync(`${process.env.TICKETSTUB_DB}-wal`).size > statSync(process.env.TICKETSTUB_DB).size, "the rows are in the WAL");

  const m = createBackup({ dbFile: process.env.TICKETSTUB_DB, filesDir: process.env.TICKETSTUB_FILES });
  assert.equal(m.ok, true);
  assert.equal(m.database.integrity, "ok");
  assert.equal(m.database.tables.stubs, 50);
  assert.deepEqual(m.missing, []);
  assert.deepEqual(m.files, [{ name: art, bytes: PNG.length, sha256: sha(PNG) }]);

  const out = join(backupsDir(process.env.TICKETSTUB_DB), m.id);
  const copy = new DatabaseSync(join(out, "ticketstub.sqlite"));
  assert.equal(copy.prepare("SELECT json FROM stubs WHERE id = 'synthetic_7'").get().json.includes(art), true);
  copy.close();
  assert.equal(sha(readFileSync(join(out, "ticketstub.sqlite"))), m.database.sha256);
  assert.deepEqual(readFileSync(join(out, "files", art)), PNG);
  assert.deepEqual(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")), m);
  assert.deepEqual(readdirSync(backupsDir(process.env.TICKETSTUB_DB)).filter((n) => n.endsWith(".partial")), []);
  app.close();
});

test("art the snapshot references but the disk lacks makes the backup not ok", () => {
  const app = new DatabaseSync(process.env.TICKETSTUB_DB);
  app.prepare("INSERT INTO stubs VALUES (?, ?)").run("synthetic_lost", JSON.stringify({ art: `/api/files/${"0".repeat(64)}.png` }));
  const m = createBackup({ dbFile: process.env.TICKETSTUB_DB, filesDir: process.env.TICKETSTUB_FILES });
  app.close();
  assert.equal(m.ok, false);
  assert.deepEqual(m.missing, [`${"0".repeat(64)}.png`]);
  assert.equal(listBackups(process.env.TICKETSTUB_DB).length, 2);
});

test("the route is a 404 for anyone who is not staff", async () => {
  const headers = { origin: "http://localhost", host: "localhost" };
  const post = await backupRoute.POST(new Request("http://localhost/api/admin/backup", { method: "POST", headers }));
  assert.equal(post.status, 404);
  const get = await backupRoute.GET(new Request("http://localhost/api/admin/backup", { headers }));
  assert.equal(get.status, 404);
  const foreign = await backupRoute.POST(new Request("http://localhost/api/admin/backup", { method: "POST", headers: { ...headers, origin: "https://evil.example" } }));
  assert.equal(foreign.status, 403);
});

const DAY = 24 * 60 * 60_000;

test("a scheduled backup runs only when the newest is a week old", () => {
  const db = process.env.TICKETSTUB_DB;
  const newest = Date.parse(listBackups(db)[0].createdAt);
  assert.equal(backupDue(db, newest + 6 * DAY, 7 * DAY), false);
  assert.equal(runScheduledBackup({ dbFile: db, filesDir: process.env.TICKETSTUB_FILES, everyMs: 7 * DAY, now: new Date(newest + 6 * DAY) }), null);
  const before = listBackups(db).length;
  const m = runScheduledBackup({ dbFile: db, filesDir: process.env.TICKETSTUB_FILES, everyMs: 7 * DAY, now: new Date(newest + 7 * DAY) });
  assert.ok(m && m.database.integrity === "ok");
  assert.equal(listBackups(db).length, before + 1);
  assert.equal(backupDue(db, newest + 8 * DAY, 7 * DAY), false, "the clock restarts from the new backup");
});

test("the lock keeps two backups apart, and a stale lock is taken over", () => {
  const db = process.env.TICKETSTUB_DB;
  assert.throws(() => withBackupLock(db, () => withBackupLock(db, () => 1)), BackupBusy);
  assert.equal(existsSync(join(backupsDir(db), ".lock")), false, "released after an error");
  writeFileSync(join(backupsDir(db), ".lock"), "999999 old");
  const old = new Date(Date.now() - 31 * 60_000);
  utimesSync(join(backupsDir(db), ".lock"), old, old);
  assert.equal(withBackupLock(db, () => "ran"), "ran");
});

test("TICKETSTUB_BACKUP_EVERY_DAYS: default 7, 0 or off disables", () => {
  const was = process.env.TICKETSTUB_BACKUP_EVERY_DAYS;
  for (const [v, want] of [[undefined, 7], ["", 7], ["3", 3], ["0", 0], ["off", 0], ["nope", 7]]) {
    if (v === undefined) delete process.env.TICKETSTUB_BACKUP_EVERY_DAYS;
    else process.env.TICKETSTUB_BACKUP_EVERY_DAYS = v;
    assert.equal(backupEveryDays(), want, String(v));
  }
  if (was === undefined) delete process.env.TICKETSTUB_BACKUP_EVERY_DAYS;
  else process.env.TICKETSTUB_BACKUP_EVERY_DAYS = was;
});
