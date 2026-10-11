// Node 24 built-ins used by the private durable attempt/outbox store.
import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type DurableJson = null | boolean | number | string | readonly DurableJson[] | {
  readonly [key: string]: DurableJson;
};

export type DurableStoreErrorCode = "invalid_path" | "corrupt_state" | "storage_busy" | "storage_unavailable";

export class DurableStoreError extends Error {
  readonly code: DurableStoreErrorCode;

  constructor(code: DurableStoreErrorCode) {
    super(code);
    this.name = "DurableStoreError";
    this.code = code;
  }
}

interface LockRecord {
  readonly pid: number;
  readonly token: string;
}

interface RuntimeProcess {
  readonly pid: number;
  kill(pid: number, signal: 0): void;
}

/** Deterministic fault points used by the private persistence fixture suite. */
export interface DurableStoreFaultHooks {
  readonly afterLock?: () => void | Promise<void>;
  readonly afterTemporaryFileSync?: () => void | Promise<void>;
}

const processApi = (globalThis as unknown as { readonly process?: RuntimeProcess }).process;
const localQueues = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertJson(value: unknown, seen = new WeakSet<object>()): asserts value is DurableJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite json number");
    return;
  }
  if (typeof value !== "object") throw new TypeError("non-json value");
  if (seen.has(value)) throw new TypeError("cyclic json value");
  seen.add(value);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("accessor or sparse array");
      assertJson(descriptor.value, seen);
    }
  } else {
    if (!isRecord(value)) throw new TypeError("non-plain json object");
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new TypeError("symbol json key");
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor === undefined || !("value" in descriptor)) throw new TypeError("accessor json property");
      if (descriptor.enumerable) assertJson(descriptor.value, seen);
    }
  }
  seen.delete(value);
}

function cloneJson<T extends DurableJson>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

/**
 * Small atomic JSON snapshot store for connector-owned attempt/outbox facts.
 * Every mutation is serialized with a process mutex and an exclusive lock
 * file, then fsynced and atomically renamed before it returns.
 */
export class DurableJsonStore {
  readonly directory: string;
  private readonly statePath: string;
  private readonly lockPath: string;
  private readonly recoveryLockPath: string;
  private readonly initialState: DurableJson;
  private readonly faultHooks: DurableStoreFaultHooks;

  private constructor(directory: string, initialState: DurableJson, faultHooks: DurableStoreFaultHooks) {
    this.directory = resolve(directory);
    this.statePath = join(this.directory, "metering-state.json");
    this.lockPath = join(this.directory, ".metering-writer.lock");
    this.recoveryLockPath = join(this.directory, ".metering-recovery.lock");
    this.initialState = cloneJson(initialState);
    this.faultHooks = faultHooks;
  }

  static async open(directory: string, initialState: DurableJson, faultHooks: DurableStoreFaultHooks = {}): Promise<DurableJsonStore> {
    if (typeof directory !== "string" || directory.trim() === "") throw new DurableStoreError("invalid_path");
    try {
      assertJson(initialState);
      await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
      const store = new DurableJsonStore(directory, initialState, faultHooks);
      const current = await store.read();
      assertJson(current);
      return store;
    } catch (error) {
      if (error instanceof DurableStoreError) throw error;
      if (errorCode(error) === "ENOENT") throw new DurableStoreError("storage_unavailable");
      throw new DurableStoreError("corrupt_state");
    }
  }

  async read(): Promise<DurableJson> {
    try {
      const text = await readFile(this.statePath, "utf8");
      const parsed: unknown = JSON.parse(text);
      assertJson(parsed);
      return cloneJson(parsed);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return cloneJson(this.initialState);
      if (error instanceof DurableStoreError) throw error;
      throw new DurableStoreError("corrupt_state");
    }
  }

  async update<T>(mutate: (current: DurableJson) => { readonly state: DurableJson; readonly result: T }): Promise<T> {
    return this.withLocalQueue(async () => this.withFileLock(async () => {
      const current = await this.read();
      const next = mutate(cloneJson(current));
      assertJson(next.state);
      await this.writeAtomically(next.state);
      return next.result;
    }));
  }

  private async withLocalQueue<T>(work: () => Promise<T>): Promise<T> {
    const key = this.directory;
    const previous = localQueues.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
    const tail = previous.then(() => gate);
    localQueues.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (localQueues.get(key) === tail) localQueues.delete(key);
    }
  }

  private async withFileLock<T>(work: () => Promise<T>): Promise<T> {
    if (processApi === undefined) throw new DurableStoreError("storage_unavailable");
    const token = randomUUID();
    let lock: any;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        lock = await open(this.lockPath, "wx", 0o600);
        await lock.writeFile(JSON.stringify({ pid: processApi.pid, token }), "utf8");
        await lock.sync();
        break;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") {
          if (lock !== undefined) {
            try { await lock.close(); } catch { /* best effort cleanup */ }
            try { await unlink(this.lockPath); } catch { /* best effort cleanup */ }
          }
          throw new DurableStoreError("storage_unavailable");
        }
        const removed = await this.removeOrphanedLock();
        if (!removed || attempt === 2) throw new DurableStoreError("storage_busy");
      }
    }
    if (lock === undefined) throw new DurableStoreError("storage_busy");
    try {
      await this.faultHooks.afterLock?.();
      return await work();
    } finally {
      try { await lock.close(); } catch { /* lock cleanup is guarded by token below */ }
      try {
        const text = await readFile(this.lockPath, "utf8");
        const record: unknown = JSON.parse(text);
        if (isRecord(record) && record.token === token) await unlink(this.lockPath);
      } catch { /* a later transaction will reconcile an orphaned lock */ }
    }
  }

  private async removeOrphanedLock(): Promise<boolean> {
    if (processApi === undefined) return false;
    const recoveryToken = randomUUID();
    let recoveryLock: any;
    try {
      recoveryLock = await open(this.recoveryLockPath, "wx", 0o600);
      await recoveryLock.writeFile(JSON.stringify({ pid: processApi.pid, token: recoveryToken }), "utf8");
      await recoveryLock.sync();
    } catch (error) {
      if (recoveryLock !== undefined) {
        try { await recoveryLock.close(); } catch { /* best effort */ }
        try { await unlink(this.recoveryLockPath); } catch { /* best effort */ }
      }
      // A single reclaimer serializes stale-lock removal. If its own marker is
      // malformed or owned by another worker, fail closed.
      return false;
    }
    try {
      const text = await readFile(this.lockPath, "utf8");
      const parsed: unknown = JSON.parse(text);
      if (!isRecord(parsed) || typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid)) return false;
      try {
        processApi?.kill(parsed.pid, 0);
        return false;
      } catch (error) {
        if (errorCode(error) !== "ESRCH") return false;
        await unlink(this.lockPath);
        return true;
      }
    } catch (error) {
      // A lock that was created but not fully written is intentionally treated
      // as busy. Manual inspection is safer than guessing its owner.
      if (errorCode(error) === "ENOENT") return true;
      return false;
    } finally {
      try { await recoveryLock.close(); } catch { /* stale marker remains fail-closed */ }
      try {
        const text = await readFile(this.recoveryLockPath, "utf8");
        const record: unknown = JSON.parse(text);
        if (isRecord(record) && record.token === recoveryToken) await unlink(this.recoveryLockPath);
      } catch { /* a later attempt fails closed if recovery ownership is uncertain */ }
    }
  }

  private async writeAtomically(value: DurableJson): Promise<void> {
    const temporary = join(this.directory, `.metering-state-${randomUUID()}.tmp`);
    let handle: any;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(JSON.stringify(value), "utf8");
      await handle.sync();
      await this.faultHooks.afterTemporaryFileSync?.();
      await handle.close();
      handle = undefined;
      await rename(temporary, this.statePath);
      const directoryHandle = await open(this.directory, "r");
      try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
    } catch {
      if (handle !== undefined) {
        try { await handle.close(); } catch { /* best effort cleanup */ }
      }
      try { await unlink(temporary); } catch { /* temp may already have been renamed */ }
      throw new DurableStoreError("storage_unavailable");
    }
  }
}
