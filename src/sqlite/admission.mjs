import { AsyncLocalStorage } from "node:async_hooks";
import { realpathSync, statSync } from "node:fs";

const databaseSchedulers = new WeakMap();
const fileSchedulers = new Map();

function schedulerForIdentity(identity) {
  if (identity.kind === "connection") {
    return { context: new AsyncLocalStorage(), queue: Promise.resolve(), active: false, waiting: 0 };
  }
  let scheduler = fileSchedulers.get(identity.key)?.deref();
  if (!scheduler) {
    scheduler = { context: new AsyncLocalStorage(), queue: Promise.resolve(), active: false, waiting: 0 };
    fileSchedulers.set(identity.key, new WeakRef(scheduler));
  }
  return scheduler;
}

function fileIdentity(database) {
  const rows = database.prepare("PRAGMA database_list").all();
  const main = rows.find((row) => row.name === "main");
  if (!main || typeof main.file !== "string" || main.file.length === 0) return { kind: "connection" };
  const canonicalPath = realpathSync(main.file);
  const stat = statSync(canonicalPath, { bigint: true });
  if (stat.nlink > 1n) throw new Error("sqlite_hard_link_alias");
  return { kind: "file", key: `${stat.dev}:${stat.ino}` };
}

function schedulerFor(database, identityError) {
  const cached = databaseSchedulers.get(database);
  if (cached) return cached;
  let identity;
  try { identity = fileIdentity(database); }
  catch (error) {
    if (typeof identityError === "function") throw identityError(error);
    throw error;
  }
  const scheduler = schedulerForIdentity(identity);
  databaseSchedulers.set(database, scheduler);
  return scheduler;
}

/** Bind a live SQLite connection to the Store's already-verified file identity. */
export function registerSqliteDatabaseConnection(database, fileIdentityKey) {
  if (fileIdentityKey !== undefined) {
    const scheduler = schedulerForIdentity({ kind: "file", key: String(fileIdentityKey) });
    const existing = databaseSchedulers.get(database);
    if (existing && existing !== scheduler) throw new Error("sqlite_database_identity_conflict");
    databaseSchedulers.set(database, scheduler);
  } else {
    schedulerFor(database);
  }
  let registered = true;
  return () => {
    if (!registered) return;
    registered = false;
    databaseSchedulers.delete(database);
  };
}

/**
 * Serialize synchronous database work and bounded async owner callbacks by the
 * opened file identity. Reentrancy belongs to a live owner token, not merely
 * to an AsyncLocalStorage context that may outlive its transaction.
 */
export function runSqliteDatabaseOperation({ database, owner, work, conflictError, identityError }) {
  let scheduler;
  try { scheduler = schedulerFor(database, identityError); }
  catch (error) { return Promise.reject(error); }
  const current = scheduler.context.getStore();
  if (current?.active === true) {
    if (current.scheduler === scheduler && current.owner === owner) {
      return Promise.resolve().then(work);
    }
    return Promise.reject(typeof conflictError === "function" ? conflictError() : new Error("sqlite_operation_conflict"));
  }

  const prior = scheduler.queue;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  scheduler.waiting += 1;
  scheduler.queue = prior.then(() => barrier);
  return prior.then(() => {
    scheduler.waiting -= 1;
    scheduler.active = true;
    const operationOwner = { scheduler, owner, active: true };
    return Promise.resolve().then(() => scheduler.context.run(operationOwner, work)).finally(() => {
      operationOwner.active = false;
      scheduler.active = false;
      release();
    });
  });
}

/** Run constructor/schema work synchronously only while the file queue is idle. */
export function runSqliteDatabaseOperationSync({ database, owner, work, conflictError, identityError }) {
  const scheduler = schedulerFor(database, identityError);
  const current = scheduler.context.getStore();
  if (current?.active === true) {
    if (current.scheduler === scheduler && current.owner === owner) return work();
    throw typeof conflictError === "function" ? conflictError() : new Error("sqlite_operation_conflict");
  }
  if (scheduler.active || scheduler.waiting !== 0) {
    throw typeof conflictError === "function" ? conflictError() : new Error("sqlite_operation_conflict");
  }
  scheduler.active = true;
  const operationOwner = { scheduler, owner, active: true };
  try {
    const result = scheduler.context.run(operationOwner, work);
    if (result !== null && (typeof result === "object" || typeof result === "function") &&
      typeof result.then === "function") {
      throw new TypeError("sqlite_sync_operation_returned_promise");
    }
    return result;
  } finally {
    operationOwner.active = false;
    scheduler.active = false;
  }
}

export function sqliteDatabaseOperationOwnedBy(database, owner, identityError) {
  const scheduler = schedulerFor(database, identityError);
  const current = scheduler.context.getStore();
  return current?.active === true && current.scheduler === scheduler && current.owner === owner;
}

/** Report whether another admitted SQLite callback currently owns this database. */
export function sqliteDatabaseOperationIsActive(database, identityError) {
  return schedulerFor(database, identityError).active;
}
