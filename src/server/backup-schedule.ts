import "server-only";
import { BackupBusy, runScheduledBackup } from "./backup";
import { filesDir } from "./files";
import { dbPath, persistence, storageAvailable } from "./index";

// Weekly backup, inside the app. Every hour the server checks whether the newest finished backup under
// <db folder>/backups is older than TICKETSTUB_BACKUP_EVERY_DAYS (default 7; 0 or "off" turns it off),
// and takes one if so. The check reads the disk, so a restart or deploy never resets the clock, and the
// shared file lock means Preview and Publish (one /private on Plus Launch) don't both take it.
// Only with TICKETSTUB_DB and TICKETSTUB_FILES set: a default-path dev server never backs up on its own.
// Nothing is deleted; prune old backups by hand.

const FIRST_CHECK_MS = 60_000;
const CHECK_EVERY_MS = 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

const g = globalThis as unknown as { __ticketstubBackupSchedule?: true };

export function backupEveryDays(): number {
  const raw = process.env.TICKETSTUB_BACKUP_EVERY_DAYS?.trim().toLowerCase();
  if (!raw) return 7;
  if (raw === "off") return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 7;
}

export function checkScheduledBackup(): void {
  const days = backupEveryDays();
  if (!days || persistence() !== "configured" || !storageAvailable()) return;
  try {
    const m = runScheduledBackup({ dbFile: dbPath(), filesDir: filesDir(), everyMs: days * DAY_MS });
    if (m) console[m.ok ? "log" : "warn"](`[backup] scheduled ${m.id} ${m.ok ? "ok" : `not ok (integrity ${m.database.integrity}, missing ${m.missing.length})`}, ${m.files.length} files`);
  } catch (e) {
    if (e instanceof BackupBusy) return; // the other process has it
    console.error("[backup] scheduled backup failed:", e instanceof Error ? e.message : "unknown");
  }
}

export function startBackupSchedule(): void {
  if (g.__ticketstubBackupSchedule || !backupEveryDays()) return;
  g.__ticketstubBackupSchedule = true;
  setTimeout(checkScheduledBackup, FIRST_CHECK_MS).unref();
  setInterval(checkScheduledBackup, CHECK_EVERY_MS).unref();
}
