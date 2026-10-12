// Restores a backup from POST /api/admin/backup into a new, empty folder, never over a live one, and proves it:
// every file re-hashes to the manifest, the database passes integrity_check and has the manifest's row counts,
// and every art file the database references is present. Then it prints how to start an isolated server on it.
// Run: node scripts/restore-backup.mjs <backup folder with manifest.json> <new empty target folder>
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [from, to] = process.argv.slice(2).map((p) => p && resolve(p));
if (!from || !to) {
  console.error("usage: node scripts/restore-backup.mjs <backup folder> <new empty target folder>");
  process.exit(2);
}
const fail = (msg) => {
  console.error(`FAIL ${msg}`);
  process.exit(1);
};
if (to.startsWith("/private/") && !to.startsWith("/private/tmp/") && !to.startsWith("/private/var/")) fail(`refusing a target under the host's /private: ${to}`);
for (const live of [process.env.TICKETSTUB_DB, process.env.TICKETSTUB_FILES].filter(Boolean)) {
  if (to === resolve(live) || to.startsWith(resolve(live, "..") + "/") || resolve(live).startsWith(to + "/")) fail(`refusing a target that overlaps TICKETSTUB_DB or TICKETSTUB_FILES: ${to}`);
}
if (existsSync(to) && readdirSync(to).length) fail(`target is not empty: ${to}`);

const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const manifest = JSON.parse(readFileSync(join(from, "manifest.json"), "utf8"));
if (manifest.schema !== "ticketstub.backup/1") fail(`unknown manifest schema ${manifest.schema}`);
if (!manifest.ok) fail(`the backup itself was not ok (missing: ${manifest.missing.join(", ") || "none"})`);

let passed = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fail(`${name}${detail ? `: ${detail}` : ""}`);
  passed++;
  console.log(`PASS ${name}`);
};

// The backup as downloaded, before anything is copied.
check("database bytes match the manifest", sha(join(from, manifest.database.name)) === manifest.database.sha256);
for (const f of manifest.files) check(`art ${f.name.slice(0, 12)}… matches the manifest`, sha(join(from, "files", f.name)) === f.sha256 && f.sha256 === f.name.slice(0, 64));

mkdirSync(join(to, "files"), { recursive: true });
const dbFile = join(to, "ticketstub.sqlite");
copyFileSync(join(from, manifest.database.name), dbFile);
for (const f of manifest.files) copyFileSync(join(from, "files", f.name), join(to, "files", f.name));

// The restored copy.
check("restored database bytes match", sha(dbFile) === manifest.database.sha256);
for (const f of manifest.files) check(`restored art ${f.name.slice(0, 12)}… re-hashes to its name`, sha(join(to, "files", f.name)) === f.sha256);
const db = new DatabaseSync(dbFile);
const integrity = db.prepare("PRAGMA integrity_check").all().map((r) => r.integrity_check).join("; ");
check("integrity_check is ok", integrity === "ok", integrity);
for (const [table, n] of Object.entries(manifest.database.tables)) {
  const got = Number(db.prepare(`SELECT count(*) AS n FROM "${table.replaceAll('"', '""')}"`).get().n);
  check(`${table} has ${n} rows`, got === n, `found ${got}`);
}
db.close();

console.log(`\n${passed} checks passed. Restored to ${to}`);
console.log(`Start it isolated (no mail, provider or payment keys; demo mode):
  env -i PATH="$PATH" HOME="$HOME" NODE_ENV=production TICKETSTUB_RUNTIME_MODE=demo \\
    TICKETSTUB_DB=${dbFile} TICKETSTUB_FILES=${join(to, "files")} npm start -- --port 3999`);
