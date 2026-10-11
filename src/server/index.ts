import "server-only";
import { openDatabase, SqliteStorage } from "./sqlite";
import type { Storage } from "./storage";

// One connection per process (the V6 suffix makes a hot-reloaded dev server pick up a new storage class). The global survives dev hot reloads so we don't reopen the file each time.
const g = globalThis as unknown as { __ticketstubStorageV6?: Storage };

export function getStorage(): Storage {
  g.__ticketstubStorageV6 ??= new SqliteStorage(openDatabase(process.env.TICKETSTUB_DB ?? "./data/ticketstub.sqlite"));
  return g.__ticketstubStorageV6;
}
