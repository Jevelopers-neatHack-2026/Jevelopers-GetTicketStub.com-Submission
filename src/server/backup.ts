import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { FILE_NAME } from "./files";

// A consistent copy of the database and the art, side by side under <db folder>/backups/<stamp>/.
// The database goes first, through VACUUM INTO: one read transaction on a second connection, so it holds
// every committed row, including ones still in the WAL, and the app keeps writing while it runs. Art is
// content-hashed and written before any row points at it, so copying the folder afterwards covers every
// file the snapshot references; each copy is re-hashed against its own name. No downtime, nothing deleted.

export const BACKUP_SCHEMA = "ticketstub.backup/1";
/** GoDaddy's File Manager refuses a single download at or above 25 MB. */
export const DOWNLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

export interface BackupFile {
  name: string;
  bytes: number;
  sha256: string;
}

export interface BackupManifest {
  schema: typeof BACKUP_SCHEMA;
  id: string;
  createdAt: string;
  database: BackupFile & { integrity: string; tables: Record<string, number> };
  files: BackupFile[];
  /** Art the snapshot points at that was not on disk. Empty in a good backup. */
  missing: string[];
  /** Every file is under the File Manager's per-download limit. */
  downloadable: boolean;
  ok: boolean;
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const quote = (s: string) => `'${s.replaceAll("'", "''")}'`;
const ident = (s: string) => `"${s.replaceAll('"', '""')}"`;
const ART_REF = /\/api\/files\/([a-f0-9]{64}\.(?:png|jpg|webp))/g;

export const backupsDir = (dbFile: string) => join(dirname(resolve(/*turbopackIgnore: true*/ dbFile)), "backups");

/** Integrity, row counts and the art names a database file references. Opens the file on its own connection. */
export function inspectDatabase(file: string): { integrity: string; tables: Record<string, number>; artRefs: Set<string> } {
  const db = new DatabaseSync(file);
  try {
    const integrity = (db.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[]).map((r) => r.integrity_check).join("; ");
    const tables: Record<string, number> = {};
    const artRefs = new Set<string>();
    const names = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[];
    for (const { name } of names) {
      tables[name] = Number((db.prepare(`SELECT count(*) AS n FROM ${ident(name)}`).get() as { n: number }).n);
      const cols = db.prepare(`SELECT name FROM pragma_table_info(${quote(name)})`).all() as { name: string }[];
      for (const c of cols) {
        const rows = db.prepare(`SELECT ${ident(c.name)} AS v FROM ${ident(name)} WHERE instr(CAST(${ident(c.name)} AS TEXT), '/api/files/') > 0`).all() as { v: unknown }[];
        for (const { v } of rows) for (const m of String(v).matchAll(ART_REF)) artRefs.add(m[1]);
      }
    }
    return { integrity, tables, artRefs };
  } finally {
    db.close();
  }
}

export function createBackup(opts: { dbFile: string; filesDir: string; now?: Date }): BackupManifest {
  const now = opts.now ?? new Date();
  const id = `${now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}-${randomBytes(3).toString("hex")}`;
  const root = backupsDir(opts.dbFile);
  const partial = join(root, `${id}.partial`);
  mkdirSync(join(partial, "files"), { recursive: true });
  try {
    return finish(opts, id, now, root, partial);
  } catch (e) {
    rmSync(partial, { recursive: true, force: true }); // our own half-written folder, never an earlier backup
    throw e;
  }
}

function finish(opts: { dbFile: string; filesDir: string }, id: string, now: Date, root: string, partial: string): BackupManifest {

  // 1. Database. A second connection, so the app's connection and its transactions are untouched.
  const dbOut = join(partial, "ticketstub.sqlite");
  const src = new DatabaseSync(resolve(/*turbopackIgnore: true*/ opts.dbFile));
  try {
    src.exec("PRAGMA busy_timeout = 5000");
    src.exec(`VACUUM INTO ${quote(dbOut)}`);
  } finally {
    src.close();
  }
  const dbBytes = readFileSync(dbOut);
  const { integrity, tables, artRefs } = inspectDatabase(dbOut);

  // 2. Art, after the snapshot. A copy whose bytes don't hash to its name is left out and reported missing.
  const files: BackupFile[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(resolve(/*turbopackIgnore: true*/ opts.filesDir)).filter((n) => FILE_NAME.test(n)).sort();
  } catch {
    /* no art folder yet */
  }
  for (const name of names) {
    const to = join(partial, "files", name);
    copyFileSync(join(resolve(/*turbopackIgnore: true*/ opts.filesDir), name), to);
    const bytes = readFileSync(to);
    const hash = sha256(bytes);
    if (hash === name.slice(0, 64)) files.push({ name, bytes: bytes.length, sha256: hash });
  }
  const have = new Set(files.map((f) => f.name));
  const missing = [...artRefs].filter((n) => !have.has(n)).sort();

  const manifest: BackupManifest = {
    schema: BACKUP_SCHEMA,
    id,
    createdAt: now.toISOString(),
    database: { name: "ticketstub.sqlite", bytes: dbBytes.length, sha256: sha256(dbBytes), integrity, tables },
    files,
    missing,
    downloadable: dbBytes.length < DOWNLOAD_LIMIT_BYTES && files.every((f) => f.bytes < DOWNLOAD_LIMIT_BYTES),
    ok: integrity === "ok" && missing.length === 0,
  };
  writeFileSync(join(partial, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  renameSync(partial, join(root, id)); // only a finished backup carries a plain id
  return manifest;
}

/** Finished backups, newest first. Unfinished `.partial` folders are skipped. */
export function listBackups(dbFile: string): Pick<BackupManifest, "id" | "createdAt" | "ok" | "downloadable">[] {
  const root = backupsDir(dbFile);
  let ids: string[] = [];
  try {
    ids = readdirSync(root).filter((n) => !n.endsWith(".partial") && statSync(join(root, n)).isDirectory());
  } catch {
    return [];
  }
  const out = [];
  for (const id of ids) {
    try {
      const m = JSON.parse(readFileSync(join(root, id, "manifest.json"), "utf8")) as BackupManifest;
      out.push({ id: m.id, createdAt: m.createdAt, ok: m.ok, downloadable: m.downloadable });
    } catch {
      /* not a backup */
    }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
