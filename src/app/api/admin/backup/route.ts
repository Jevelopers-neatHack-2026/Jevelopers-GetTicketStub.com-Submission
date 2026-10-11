import { BackupBusy, createBackup, listBackups, withBackupLock } from "@/server/backup";
import { getRequestContext, requireCapability } from "@/server/context";
import { filesDir } from "@/server/files";
import { HttpError, checkOrigin, json, limit, route } from "@/server/http";
import { dbPath, requireStorage } from "@/server/index";

// Staff only (admin.view, from ADMIN_EMAILS); anyone else gets the same 404 as a path that isn't there.
// POST writes a consistent backup of the database and art to <db folder>/backups/<id>/ and answers its
// manifest: table row counts and file hashes, never row contents. GET lists the finished backups.
// Backups stay on the host's private disk. Nothing here deletes one; retention is by hand.
// src/server/backup-schedule.ts takes the same backup weekly; the shared lock keeps the two apart.

export const GET = route(async (req: Request) => {
  requireCapability(await getRequestContext(req), "admin.view");
  return json({ backups: listBackups(dbPath()) });
});

export const POST = route(async (req: Request) => {
  checkOrigin(req);
  const ctx = await getRequestContext(req);
  requireCapability(ctx, "admin.view");
  requireStorage();
  limit(`backup:${ctx.actor.kind === "account" ? ctx.actor.id : "x"}`, 6, 60 * 60_000);
  let manifest;
  try {
    manifest = withBackupLock(dbPath(), () => createBackup({ dbFile: dbPath(), filesDir: filesDir() }));
  } catch (e) {
    if (e instanceof BackupBusy) throw new HttpError(409, "backup_running", "A backup is already running.");
    throw e;
  }
  return json({ backup: manifest }, { status: manifest.ok ? 201 : 500 });
});
