// Runs once when the server starts. Node only: the weekly backup needs the disk.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackupSchedule } = await import("./server/backup-schedule");
    startBackupSchedule();
  }
}
