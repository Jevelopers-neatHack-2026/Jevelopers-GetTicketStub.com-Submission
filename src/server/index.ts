import "server-only";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { filesDir } from "./files";
import { HttpError } from "./http";
import { openDatabase, SqliteStorage } from "./sqlite";
import type { Storage } from "./storage";

// Storage is probed once per process. Where the platform gives us no writable disk, the app falls back to
// device-only mode: pages still render, API routes that need storage answer 503, and nothing crashes.
export type StorageStatus = { state: "available" } | { state: "unavailable"; reason: string };

interface Slot {
  storage: Storage | null;
  status: StorageStatus;
}

// One connection per process (the V8 suffix makes a hot-reloaded dev server pick up new storage code). The global survives dev hot reloads so we don't reopen the file each time.
const g = globalThis as unknown as { __ticketstubStorageV8?: Slot };

const dbPath = () => process.env.TICKETSTUB_DB?.trim() || "./data/ticketstub.sqlite";

/** Whether the two paths were set on purpose. "default-path" on a host with no persistent volume means data resets on each deploy. */
export const persistence = (): "configured" | "default-path" =>
  process.env.TICKETSTUB_DB?.trim() && process.env.TICKETSTUB_FILES?.trim() ? "configured" : "default-path";

function reasonOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === "EACCES" || code === "EPERM" || code === "EROFS") return "not writable";
  if (code === "ENOTDIR" || code === "EEXIST" || code === "ENOENT") return "path not usable";
  if (typeof code === "string" && /^[A-Z0-9_]{3,32}$/.test(code)) return code.toLowerCase();
  return "probe failed";
}

function probe(): Slot {
  try {
    // Files directory: create it, write a file, read it back, remove it.
    const dir = filesDir();
    mkdirSync(dir, { recursive: true });
    const mark = join(dir, `.probe-${process.pid}-${randomBytes(4).toString("hex")}`);
    writeFileSync(mark, "ok");
    const back = readFileSync(mark, "utf8");
    rmSync(mark, { force: true });
    if (back !== "ok") throw new Error("files probe mismatch");
    // Database: open it (creating its directory), then write and read a probe table.
    const db = openDatabase(dbPath());
    try {
      db.exec("CREATE TABLE IF NOT EXISTS _probe (v TEXT)");
      db.exec("DELETE FROM _probe");
      db.exec("INSERT INTO _probe (v) VALUES ('ok')");
      const row = db.prepare("SELECT v FROM _probe").get() as { v?: string } | undefined;
      db.exec("DELETE FROM _probe");
      if (row?.v !== "ok") throw new Error("db probe mismatch");
    } catch (e) {
      try {
        db.close();
      } catch {
        /* already unusable */
      }
      throw e;
    }
    console.log(`[storage] ok, persistence ${persistence()}${persistence() === "default-path" ? " (set TICKETSTUB_DB and TICKETSTUB_FILES to a persistent volume, or data resets on each deploy)" : ""}`);
    return { storage: new SqliteStorage(db), status: { state: "available" } };
  } catch (e) {
    const reason = reasonOf(e);
    console.warn(`[storage] unavailable (${reason}); running device-only, saving is off`);
    return { storage: null, status: { state: "unavailable", reason } };
  }
}

const slot = (): Slot => (g.__ticketstubStorageV8 ??= probe());

export const storageStatus = (): StorageStatus => slot().status;
export const storageAvailable = (): boolean => slot().status.state === "available";

export const storageUnavailable = () => new HttpError(503, "storage_unavailable", "Saving is off on this preview.");

/** Throws 503 `storage_unavailable` when the probe failed. Routes that need storage call this first. */
export function requireStorage(): void {
  if (!storageAvailable()) throw storageUnavailable();
}

export function getStorage(): Storage {
  const { storage } = slot();
  if (!storage) throw storageUnavailable();
  return storage;
}
