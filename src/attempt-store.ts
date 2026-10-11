import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { link, lstat, mkdir, open, readFile, realpath, unlink } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { DurableJsonStore, DurableStoreError, type DurableJson, type DurableStoreFaultHooks } from "./metering-store.js";
import type { AttemptPersistence, ProviderMode, SubmitAttemptRecord, TrustedScope } from "./types.js";

const STORE_FORMAT = "fc-attempt-store/1";
const COMMIT_MARKER_FORMAT = "fc-attempt-store-commit/1";
const STATE_DIRECTORY = ".attempt-store-v1";
const COMMIT_MARKER = ".attempt-store-committed.json";
const MAX_ID_LENGTH = 1024;
const MAX_HISTORY_LENGTH = 1_000_000;

type StoreErrorCode =
  | "invalid_path"
  | "invalid_record"
  | "binding_mismatch"
  | "access_denied"
  | "corrupt_state"
  | "unsupported_version"
  | "storage_busy"
  | "storage_unavailable"
  | "identity_conflict"
  | "claim_missing"
  | "claim_owner_mismatch"
  | "immutable_binding"
  | "stale_update";

export class AttemptStoreError extends Error {
  readonly code: StoreErrorCode;

  constructor(code: StoreErrorCode) {
    super(code);
    this.name = "AttemptStoreError";
    this.code = code;
  }
}

export interface LocalAttemptPersistenceOptions {
  /** Dedicated, canonical, absolute local directory. It must not be a symlink. */
  readonly directory: string;
  /** Immutable store partition. Use a separate store for each provider and mode. */
  readonly providerId: string;
  readonly mode: ProviderMode;
  /**
   * Fault injection is only for isolated process-crash tests. Do not supply it
   * in an application runtime.
   */
  readonly faultHooks?: DurableStoreFaultHooks;
}

interface StoreBinding {
  readonly providerId: string;
  readonly mode: ProviderMode;
  readonly ownerUid: number | null;
}

interface AttemptHistoryRow {
  readonly revision: number;
  readonly recordedAt: number;
  readonly event: "claimed" | "updated";
  readonly sideEffectState: SubmitAttemptRecord["sideEffectState"];
  readonly budgetReservationState: SubmitAttemptRecord["budgetReservationState"];
  readonly hasBudgetReservationReference: boolean;
  readonly hasProviderRequestId: boolean;
}

interface StoredAttempt {
  readonly immutableDigest: string;
  readonly record: SubmitAttemptRecord;
  readonly revision: number;
  readonly history: readonly AttemptHistoryRow[];
}

interface AttemptStoreState {
  readonly format: typeof STORE_FORMAT;
  readonly binding: StoreBinding;
  readonly entries: readonly StoredAttempt[];
}

export interface AttemptHistory {
  readonly revision: number;
  readonly recordedAt: number;
  readonly event: "claimed" | "updated";
  readonly sideEffectState: SubmitAttemptRecord["sideEffectState"];
  readonly budgetReservationState: SubmitAttemptRecord["budgetReservationState"];
  readonly hasBudgetReservationReference: boolean;
  readonly hasProviderRequestId: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyDataProperties(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string" || !allowed.has(key))) return false;
  if (required.some((key) => !Object.hasOwn(value, key))) return false;
  for (const key of keys) {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || !descriptor.enumerable) return false;
  }
  return true;
}

function validText(value: unknown, maximum = MAX_ID_LENGTH): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= maximum && !value.includes("\0");
}

function ownerUid(): number | null {
  const uidReader = (process as NodeJS.Process & { getuid?: () => number }).getuid;
  return typeof uidReader === "function" ? uidReader() : null;
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function mapStorageError(error: unknown): AttemptStoreError {
  if (error instanceof AttemptStoreError) return error;
  if (error instanceof DurableStoreError) {
    switch (error.code) {
      case "invalid_path": return new AttemptStoreError("invalid_path");
      case "corrupt_state": return new AttemptStoreError("corrupt_state");
      case "storage_busy": return new AttemptStoreError("storage_busy");
      case "storage_unavailable": return new AttemptStoreError("storage_unavailable");
    }
  }
  const code = errorCode(error);
  if (code === "EACCES" || code === "EPERM") return new AttemptStoreError("access_denied");
  if (code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP") return new AttemptStoreError("invalid_path");
  return new AttemptStoreError("storage_unavailable");
}

async function assertNoSymlinkAncestors(path: string): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  let cursor = root;
  const components = absolute.slice(root.length).split(sep).filter(Boolean);
  for (const component of components) {
    cursor = join(cursor, component);
    let metadata;
    try {
      metadata = await lstat(cursor);
    } catch (error) {
      if (errorCode(error) === "ENOENT") return;
      throw mapStorageError(error);
    }
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new AttemptStoreError("invalid_path");
  }
}

async function ensurePrivateDirectory(path: string, expectedUid: number | null): Promise<string> {
  const absolute = resolve(path);
  try {
    await assertNoSymlinkAncestors(absolute);
    await mkdir(absolute, { recursive: true, mode: 0o700 });
    return await assertPrivateDirectory(absolute, expectedUid);
  } catch (error) {
    throw mapStorageError(error);
  }
}

async function assertPrivateDirectory(path: string, expectedUid: number | null): Promise<string> {
  const absolute = resolve(path);
  try {
    await assertNoSymlinkAncestors(absolute);
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new AttemptStoreError("invalid_path");
    if (expectedUid !== null && metadata.uid !== expectedUid) throw new AttemptStoreError("access_denied");
    if (process.platform !== "win32" && ((metadata.mode & 0o077) !== 0 || (metadata.mode & 0o200) === 0)) {
      throw new AttemptStoreError("access_denied");
    }
    if (await realpath(absolute) !== absolute) throw new AttemptStoreError("invalid_path");
    return absolute;
  } catch (error) {
    throw mapStorageError(error);
  }
}

async function assertManagedFile(path: string, expectedUid: number | null): Promise<void> {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new AttemptStoreError("invalid_path");
    if (expectedUid !== null && metadata.uid !== expectedUid) throw new AttemptStoreError("access_denied");
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new AttemptStoreError("access_denied");
    }
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    throw mapStorageError(error);
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw mapStorageError(error);
  }
}

function managedFileExistsSync(path: string, expectedUid: number | null): boolean {
  try {
    const metadata = lstatSync(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) throw new AttemptStoreError("invalid_path");
    if (expectedUid !== null && metadata.uid !== expectedUid) throw new AttemptStoreError("access_denied");
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) {
      throw new AttemptStoreError("access_denied");
    }
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw mapStorageError(error);
  }
}

function validateCommitMarker(text: string, expected: StoreBinding): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AttemptStoreError("corrupt_state");
  }
  if (!isPlainRecord(parsed)) throw new AttemptStoreError("corrupt_state");
  if (typeof parsed.format === "string" && parsed.format.startsWith("fc-attempt-store-commit/") &&
    parsed.format !== COMMIT_MARKER_FORMAT) throw new AttemptStoreError("unsupported_version");
  if (!hasOnlyDataProperties(parsed, ["format", "providerId", "mode", "ownerUid", "committed"]) ||
    parsed.format !== COMMIT_MARKER_FORMAT || !validText(parsed.providerId) ||
    (parsed.mode !== "simulated" && parsed.mode !== "sandbox") ||
    !(parsed.ownerUid === null || (Number.isSafeInteger(parsed.ownerUid) && (parsed.ownerUid as number) >= 0)) ||
    parsed.committed !== true) throw new AttemptStoreError("corrupt_state");
  if (parsed.providerId !== expected.providerId || parsed.mode !== expected.mode ||
    parsed.ownerUid !== expected.ownerUid) throw new AttemptStoreError("binding_mismatch");
}

async function hasCommitMarker(path: string, expected: StoreBinding): Promise<boolean> {
  await assertManagedFile(path, expected.ownerUid);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw mapStorageError(error);
  }
  validateCommitMarker(text, expected);
  return true;
}

function hasCommitMarkerSync(path: string, expected: StoreBinding): boolean {
  if (!managedFileExistsSync(path, expected.ownerUid)) return false;
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw mapStorageError(error);
  }
  validateCommitMarker(text, expected);
  return true;
}

async function writeCommitMarker(path: string, directory: string, binding: StoreBinding): Promise<void> {
  const marker = JSON.stringify({
    format: COMMIT_MARKER_FORMAT,
    providerId: binding.providerId,
    mode: binding.mode,
    ownerUid: binding.ownerUid,
    committed: true
  });
  const temporaryPath = join(directory, ".attempt-store-commit-" + randomUUID() + ".tmp");
  let handle;
  try {
    handle = await open(temporaryPath, "wx", 0o600);
    await handle.writeFile(marker, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      // link publishes the fully written marker atomically without replacing
      // a marker another first-claim process has already committed.
      await link(temporaryPath, path);
    } catch (error) {
      if (errorCode(error) === "EEXIST" && await hasCommitMarker(path, binding)) return;
      throw error;
    }
    const directoryHandle = await open(directory, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }
  } catch (error) {
    if (handle !== undefined) {
      try {
        await handle.close();
      } catch {
        // The final marker is published only after its contents are synced.
      }
    }
    throw mapStorageError(error);
  } finally {
    try {
      await unlink(temporaryPath);
    } catch {
      // An orphaned unique temporary marker is ignored by future opens.
    }
  }
}

function normalizeScope(value: TrustedScope): TrustedScope {
  if (!isPlainRecord(value) || !hasOnlyDataProperties(value, ["tenantId", "projectId"]) ||
    !validText(value.tenantId) || !validText(value.projectId)) {
    throw new AttemptStoreError("invalid_record");
  }
  return { tenantId: value.tenantId, projectId: value.projectId };
}

function normalizeRecord(value: SubmitAttemptRecord): SubmitAttemptRecord {
  if (!isPlainRecord(value) || !hasOnlyDataProperties(value, [
    "providerId", "tenantId", "projectId", "idempotencyKey", "claimId",
    "authorizationId", "actionId", "authorizationClaimReference", "requestFingerprint",
    "sideEffectState", "budgetReservationState", "updatedAt"
  ], ["budgetReservationReference", "providerRequestId"])) {
    throw new AttemptStoreError("invalid_record");
  }
  const strings = [
    value.providerId, value.tenantId, value.projectId, value.idempotencyKey, value.claimId,
    value.authorizationId, value.actionId, value.authorizationClaimReference, value.requestFingerprint
  ];
  if (!strings.every((item) => validText(item)) ||
    !["not_dispatched", "possible", "confirmed", "unknown"].includes(String(value.sideEffectState)) ||
    !["not_requested", "pending", "reserved", "denied", "unknown"].includes(String(value.budgetReservationState)) ||
    typeof value.updatedAt !== "number" || !Number.isSafeInteger(value.updatedAt) || value.updatedAt < 0) {
    throw new AttemptStoreError("invalid_record");
  }
  if (Object.hasOwn(value, "budgetReservationReference") && !validText(value.budgetReservationReference)) {
    throw new AttemptStoreError("invalid_record");
  }
  if (Object.hasOwn(value, "providerRequestId") && !validText(value.providerRequestId)) {
    throw new AttemptStoreError("invalid_record");
  }
  if ((value.budgetReservationState === "reserved") !== Object.hasOwn(value, "budgetReservationReference")) {
    throw new AttemptStoreError("invalid_record");
  }
  if ((value.sideEffectState === "confirmed") !== Object.hasOwn(value, "providerRequestId")) {
    throw new AttemptStoreError("invalid_record");
  }
  return {
    providerId: value.providerId,
    tenantId: value.tenantId,
    projectId: value.projectId,
    idempotencyKey: value.idempotencyKey,
    claimId: value.claimId,
    authorizationId: value.authorizationId,
    actionId: value.actionId,
    authorizationClaimReference: value.authorizationClaimReference,
    requestFingerprint: value.requestFingerprint,
    sideEffectState: value.sideEffectState as SubmitAttemptRecord["sideEffectState"],
    budgetReservationState: value.budgetReservationState as SubmitAttemptRecord["budgetReservationState"],
    ...(Object.hasOwn(value, "budgetReservationReference")
      ? { budgetReservationReference: value.budgetReservationReference as string }
      : {}),
    ...(Object.hasOwn(value, "providerRequestId") ? { providerRequestId: value.providerRequestId as string } : {}),
    updatedAt: value.updatedAt
  };
}

function immutableDigest(record: SubmitAttemptRecord): string {
  const identity = [
    record.providerId, record.tenantId, record.projectId, record.idempotencyKey, record.claimId,
    record.authorizationId, record.actionId, record.authorizationClaimReference, record.requestFingerprint
  ];
  return createHash("sha256").update(JSON.stringify(identity), "utf8").digest("hex");
}

function historyRow(record: SubmitAttemptRecord, revision: number, event: "claimed" | "updated"): AttemptHistoryRow {
  return {
    revision,
    recordedAt: record.updatedAt,
    event,
    sideEffectState: record.sideEffectState,
    budgetReservationState: record.budgetReservationState,
    hasBudgetReservationReference: Object.hasOwn(record, "budgetReservationReference"),
    hasProviderRequestId: Object.hasOwn(record, "providerRequestId")
  };
}

function sameScope(record: SubmitAttemptRecord, scope: TrustedScope): boolean {
  return record.tenantId === scope.tenantId && record.projectId === scope.projectId;
}

function sameIdempotency(record: SubmitAttemptRecord, other: SubmitAttemptRecord): boolean {
  return record.providerId === other.providerId &&
    record.tenantId === other.tenantId &&
    record.projectId === other.projectId &&
    record.idempotencyKey === other.idempotencyKey;
}

function sameAction(record: SubmitAttemptRecord, other: SubmitAttemptRecord): boolean {
  return record.providerId === other.providerId &&
    record.tenantId === other.tenantId &&
    record.projectId === other.projectId &&
    record.actionId === other.actionId;
}

function sameAuthorization(record: SubmitAttemptRecord, other: SubmitAttemptRecord): boolean {
  return record.providerId === other.providerId && record.authorizationId === other.authorizationId;
}

function effectRank(state: SubmitAttemptRecord["sideEffectState"]): number {
  switch (state) {
    case "not_dispatched": return 0;
    case "unknown": return 1;
    case "possible": return 2;
    case "confirmed": return 3;
  }
}

function canAdvanceBudget(
  current: SubmitAttemptRecord["budgetReservationState"],
  next: SubmitAttemptRecord["budgetReservationState"]
): boolean {
  if (current === next) return true;
  if (current === "not_requested") return next === "pending";
  if (current === "pending") return next === "reserved" || next === "denied" || next === "unknown";
  return false;
}

function parseHistoryRow(value: unknown): AttemptHistoryRow {
  if (!isPlainRecord(value) || !hasOnlyDataProperties(value, [
    "revision", "recordedAt", "event", "sideEffectState", "budgetReservationState",
    "hasBudgetReservationReference", "hasProviderRequestId"
  ])) throw new AttemptStoreError("corrupt_state");
  if (!Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
    !Number.isSafeInteger(value.recordedAt) || (value.recordedAt as number) < 0 ||
    (value.event !== "claimed" && value.event !== "updated") ||
    !["not_dispatched", "possible", "confirmed", "unknown"].includes(String(value.sideEffectState)) ||
    !["not_requested", "pending", "reserved", "denied", "unknown"].includes(String(value.budgetReservationState)) ||
    typeof value.hasBudgetReservationReference !== "boolean" ||
    typeof value.hasProviderRequestId !== "boolean") throw new AttemptStoreError("corrupt_state");
  const row: AttemptHistoryRow = {
    revision: value.revision as number,
    recordedAt: value.recordedAt as number,
    event: value.event,
    sideEffectState: value.sideEffectState as AttemptHistoryRow["sideEffectState"],
    budgetReservationState: value.budgetReservationState as AttemptHistoryRow["budgetReservationState"],
    hasBudgetReservationReference: value.hasBudgetReservationReference,
    hasProviderRequestId: value.hasProviderRequestId
  };
  if ((row.sideEffectState === "confirmed") !== row.hasProviderRequestId ||
    (row.budgetReservationState === "reserved") !== row.hasBudgetReservationReference) {
    throw new AttemptStoreError("corrupt_state");
  }
  return row;
}

function parseStoredAttempt(value: unknown): StoredAttempt {
  if (!isPlainRecord(value) || !hasOnlyDataProperties(value, ["immutableDigest", "record", "revision", "history"]) ||
    !validText(value.immutableDigest, 128) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 ||
    !Array.isArray(value.history) || value.history.length === 0 || value.history.length > MAX_HISTORY_LENGTH) {
    throw new AttemptStoreError("corrupt_state");
  }
  const record = normalizeRecord(value.record as SubmitAttemptRecord);
  const history = value.history.map(parseHistoryRow);
  if (value.immutableDigest !== immutableDigest(record) || value.revision !== history.length - 1) {
    throw new AttemptStoreError("corrupt_state");
  }
  for (let index = 0; index < history.length; index += 1) {
    const row = history[index];
    if (row === undefined || row.revision !== index || row.event !== (index === 0 ? "claimed" : "updated")) {
      throw new AttemptStoreError("corrupt_state");
    }
    if (index > 0) {
      const previous = history[index - 1];
      if (previous === undefined || row.recordedAt < previous.recordedAt ||
        effectRank(row.sideEffectState) < effectRank(previous.sideEffectState) ||
        !canAdvanceBudget(previous.budgetReservationState, row.budgetReservationState) ||
        (previous.hasBudgetReservationReference && !row.hasBudgetReservationReference) ||
        (previous.hasProviderRequestId && !row.hasProviderRequestId)) {
        throw new AttemptStoreError("corrupt_state");
      }
    }
  }
  const last = history.at(-1);
  if (last === undefined || last.recordedAt !== record.updatedAt ||
    last.sideEffectState !== record.sideEffectState ||
    last.budgetReservationState !== record.budgetReservationState ||
    last.hasBudgetReservationReference !== Object.hasOwn(record, "budgetReservationReference") ||
    last.hasProviderRequestId !== Object.hasOwn(record, "providerRequestId")) {
    throw new AttemptStoreError("corrupt_state");
  }
  return {
    immutableDigest: value.immutableDigest,
    record,
    revision: value.revision as number,
    history
  };
}

function parseState(value: unknown, expected: StoreBinding): AttemptStoreState {
  if (!isPlainRecord(value)) throw new AttemptStoreError("corrupt_state");
  if (typeof value.format === "string" && value.format.startsWith("fc-attempt-store/") && value.format !== STORE_FORMAT) {
    throw new AttemptStoreError("unsupported_version");
  }
  if (!hasOnlyDataProperties(value, ["format", "binding", "entries"]) || value.format !== STORE_FORMAT ||
    !Array.isArray(value.entries)) throw new AttemptStoreError("corrupt_state");
  if (!isPlainRecord(value.binding) || !hasOnlyDataProperties(value.binding, ["providerId", "mode", "ownerUid"]) ||
    !validText(value.binding.providerId) ||
    (value.binding.mode !== "simulated" && value.binding.mode !== "sandbox") ||
    !(value.binding.ownerUid === null || (Number.isSafeInteger(value.binding.ownerUid) && (value.binding.ownerUid as number) >= 0))) {
    throw new AttemptStoreError("corrupt_state");
  }
  if (value.binding.providerId !== expected.providerId || value.binding.mode !== expected.mode ||
    value.binding.ownerUid !== expected.ownerUid) throw new AttemptStoreError("binding_mismatch");
  const entries = value.entries.map(parseStoredAttempt);
  const keys = new Set<string>();
  const actions = new Set<string>();
  const authorizations = new Set<string>();
  for (const entry of entries) {
    const record = entry.record;
    if (record.providerId !== expected.providerId) throw new AttemptStoreError("corrupt_state");
    const key = JSON.stringify([record.providerId, record.tenantId, record.projectId, record.idempotencyKey]);
    const action = JSON.stringify([record.providerId, record.tenantId, record.projectId, record.actionId]);
    const authorization = JSON.stringify([record.providerId, record.authorizationId]);
    if (keys.has(key) || actions.has(action) || authorizations.has(authorization)) {
      throw new AttemptStoreError("corrupt_state");
    }
    keys.add(key);
    actions.add(action);
    authorizations.add(authorization);
  }
  return { format: STORE_FORMAT, binding: expected, entries };
}

function stateFor(binding: StoreBinding): AttemptStoreState {
  return { format: STORE_FORMAT, binding, entries: [] };
}

function publicHistory(history: readonly AttemptHistoryRow[]): readonly AttemptHistory[] {
  return history.map((row) => ({ ...row }));
}

export class LocalAttemptPersistence implements AttemptPersistence {
  readonly directory: string;
  readonly mode: ProviderMode;
  readonly providerId: string;
  private readonly binding: StoreBinding;
  private readonly stateDirectory: string;
  private readonly statePath: string;
  private readonly commitMarkerPath: string;
  private readonly writerLockPath: string;
  private readonly recoveryLockPath: string;
  private readonly store: DurableJsonStore;

  private constructor(directory: string, stateDirectory: string, binding: StoreBinding, store: DurableJsonStore) {
    this.directory = directory;
    this.stateDirectory = stateDirectory;
    this.statePath = join(stateDirectory, "metering-state.json");
    this.commitMarkerPath = join(directory, COMMIT_MARKER);
    this.writerLockPath = join(stateDirectory, ".metering-writer.lock");
    this.recoveryLockPath = join(stateDirectory, ".metering-recovery.lock");
    this.binding = binding;
    this.providerId = binding.providerId;
    this.mode = binding.mode;
    this.store = store;
  }

  static async open(options: LocalAttemptPersistenceOptions): Promise<LocalAttemptPersistence> {
    if (options === null || typeof options !== "object" || !isAbsolute(options.directory) ||
      !validText(options.providerId) || (options.mode !== "simulated" && options.mode !== "sandbox")) {
      throw new AttemptStoreError("invalid_path");
    }
    const uid = ownerUid();
    const directory = await ensurePrivateDirectory(options.directory, uid);
    const binding: StoreBinding = { providerId: options.providerId, mode: options.mode, ownerUid: uid };
    const commitMarkerPath = join(directory, COMMIT_MARKER);
    const markerPresent = await hasCommitMarker(commitMarkerPath, binding);
    const expectedStateDirectory = join(directory, STATE_DIRECTORY);
    const stateDirectoryPresent = await pathExists(expectedStateDirectory);
    if (markerPresent && !stateDirectoryPresent) throw new AttemptStoreError("corrupt_state");
    const stateDirectory = stateDirectoryPresent
      ? await assertPrivateDirectory(expectedStateDirectory, uid)
      : await ensurePrivateDirectory(expectedStateDirectory, uid);
    await assertManagedFile(commitMarkerPath, uid);
    await assertManagedFile(join(stateDirectory, "metering-state.json"), uid);
    await assertManagedFile(join(stateDirectory, ".metering-writer.lock"), uid);
    await assertManagedFile(join(stateDirectory, ".metering-recovery.lock"), uid);
    let store: DurableJsonStore;
    try {
      store = await DurableJsonStore.open(stateDirectory, stateFor(binding) as unknown as DurableJson, options.faultHooks);
    } catch (error) {
      throw mapStorageError(error);
    }
    const persistence = new LocalAttemptPersistence(directory, stateDirectory, binding, store);
    await persistence.assertManagedPathsSafe();
    await persistence.readState();
    return persistence;
  }

  async getSubmitAttempt(providerId: string, scopeValue: TrustedScope, idempotencyKey: string): Promise<SubmitAttemptRecord | undefined> {
    this.assertProvider(providerId);
    const scope = normalizeScope(scopeValue);
    if (!validText(idempotencyKey)) throw new AttemptStoreError("invalid_record");
    const state = await this.readState();
    const entry = state.entries.find((candidate) => sameScope(candidate.record, scope) &&
      candidate.record.providerId === providerId && candidate.record.idempotencyKey === idempotencyKey);
    return entry === undefined ? undefined : normalizeRecord(entry.record);
  }

  async claimSubmitAttempt(recordValue: SubmitAttemptRecord): Promise<{
    readonly claimed: boolean;
    readonly existing?: SubmitAttemptRecord;
  }> {
    const record = normalizeRecord(recordValue);
    this.assertProvider(record.providerId);
    const result = await this.updateState<{ readonly claimed: boolean; readonly existing?: SubmitAttemptRecord }>((state) => {
      const matches = state.entries.filter((entry) =>
        sameIdempotency(entry.record, record) ||
        sameAction(entry.record, record) ||
        sameAuthorization(entry.record, record)
      );
      if (matches.length > 1) throw new AttemptStoreError("corrupt_state");
      const existing = matches[0];
      if (existing !== undefined) {
        return {
          state,
          result: {
            claimed: false,
            ...(sameScope(existing.record, record) ? { existing: normalizeRecord(existing.record) } : {})
          }
        };
      }
      const initialHistory = [historyRow(record, 0, "claimed")];
      const entry: StoredAttempt = {
        immutableDigest: immutableDigest(record),
        record,
        revision: 0,
        history: initialHistory
      };
      return {
        state: { ...state, entries: [...state.entries, entry] },
        result: { claimed: true }
      };
    });
    return result;
  }

  async saveSubmitAttempt(recordValue: SubmitAttemptRecord): Promise<void> {
    const record = normalizeRecord(recordValue);
    this.assertProvider(record.providerId);
    await this.updateState((state) => {
      const index = state.entries.findIndex((entry) => sameIdempotency(entry.record, record));
      if (index < 0) throw new AttemptStoreError("claim_missing");
      const existing = state.entries[index];
      if (existing === undefined) throw new AttemptStoreError("corrupt_state");
      if (existing.record.claimId !== record.claimId) throw new AttemptStoreError("claim_owner_mismatch");
      if (existing.immutableDigest !== immutableDigest(record)) throw new AttemptStoreError("immutable_binding");
      this.assertForwardUpdate(existing.record, record);
      if (JSON.stringify(existing.record) === JSON.stringify(record)) return { state, result: undefined };
      const revision = existing.revision + 1;
      if (!Number.isSafeInteger(revision) || revision > MAX_HISTORY_LENGTH) throw new AttemptStoreError("storage_unavailable");
      const nextEntry: StoredAttempt = {
        immutableDigest: existing.immutableDigest,
        record,
        revision,
        history: [...existing.history, historyRow(record, revision, "updated")]
      };
      const entries = state.entries.slice();
      entries[index] = nextEntry;
      return { state: { ...state, entries }, result: undefined };
    });
  }

  /** Read-only operator view, limited to one trusted tenant/project scope. */
  async listAttempts(scopeValue: TrustedScope): Promise<readonly SubmitAttemptRecord[]> {
    const scope = normalizeScope(scopeValue);
    const state = await this.readState();
    return state.entries
      .filter((entry) => sameScope(entry.record, scope))
      .map((entry) => normalizeRecord(entry.record));
  }

  /** Private state-transition history for one scoped idempotency key. */
  async attemptHistory(scopeValue: TrustedScope, idempotencyKey: string): Promise<readonly AttemptHistory[]> {
    const scope = normalizeScope(scopeValue);
    if (!validText(idempotencyKey)) throw new AttemptStoreError("invalid_record");
    const state = await this.readState();
    const entry = state.entries.find((candidate) => sameScope(candidate.record, scope) &&
      candidate.record.idempotencyKey === idempotencyKey);
    return entry === undefined ? [] : publicHistory(entry.history);
  }

  private assertProvider(providerId: string): void {
    if (!validText(providerId)) throw new AttemptStoreError("invalid_record");
    if (providerId !== this.binding.providerId) throw new AttemptStoreError("binding_mismatch");
  }

  private assertForwardUpdate(current: SubmitAttemptRecord, next: SubmitAttemptRecord): void {
    if (next.updatedAt < current.updatedAt || effectRank(next.sideEffectState) < effectRank(current.sideEffectState) ||
      !canAdvanceBudget(current.budgetReservationState, next.budgetReservationState)) {
      throw new AttemptStoreError("stale_update");
    }
    if (Object.hasOwn(current, "budgetReservationReference") &&
      current.budgetReservationReference !== next.budgetReservationReference) {
      throw new AttemptStoreError("immutable_binding");
    }
    if (Object.hasOwn(current, "providerRequestId") && current.providerRequestId !== next.providerRequestId) {
      throw new AttemptStoreError("immutable_binding");
    }
  }

  private async assertManagedPathsSafe(): Promise<void> {
    const safeRoot = await assertPrivateDirectory(this.directory, this.binding.ownerUid);
    const safeStateDirectory = await assertPrivateDirectory(this.stateDirectory, this.binding.ownerUid);
    if (safeRoot !== this.directory || safeStateDirectory !== this.stateDirectory ||
      basename(this.stateDirectory) !== STATE_DIRECTORY || dirname(this.stateDirectory) !== this.directory) {
      throw new AttemptStoreError("invalid_path");
    }
    await assertManagedFile(this.statePath, this.binding.ownerUid);
    await assertManagedFile(this.commitMarkerPath, this.binding.ownerUid);
    await assertManagedFile(this.writerLockPath, this.binding.ownerUid);
    await assertManagedFile(this.recoveryLockPath, this.binding.ownerUid);
  }

  private async readState(): Promise<AttemptStoreState> {
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        await this.assertManagedPathsSafe();
        const state = parseState(await this.store.read(), this.binding);
        const statePathExists = await pathExists(this.statePath);
        const markerPresent = await hasCommitMarker(this.commitMarkerPath, this.binding);
        if ((!statePathExists && state.entries.length > 0) ||
          (markerPresent && (!statePathExists || state.entries.length === 0))) {
          // A first-claim rename and its marker can complete between the
          // snapshot read and these path checks. Re-read before diagnosing
          // persistent loss or an empty committed snapshot as corruption.
          if (attempt < 2) continue;
          throw new AttemptStoreError("corrupt_state");
        }
        if (!markerPresent && state.entries.length > 0) {
          await writeCommitMarker(this.commitMarkerPath, this.directory, this.binding);
        }
        return state;
      }
      throw new AttemptStoreError("corrupt_state");
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  private async updateState<T>(mutate: (state: AttemptStoreState) => { readonly state: AttemptStoreState; readonly result: T }): Promise<T> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        await this.assertManagedPathsSafe();
        const committed = await this.store.update((value) => {
          const current = parseState(value, this.binding);
          this.assertMutationSnapshot(current);
          const changed = mutate(current);
          return {
            state: changed.state as unknown as DurableJson,
            result: { mutationResult: changed.result, hasEntries: changed.state.entries.length > 0 }
          };
        });
        if (committed.hasEntries) await writeCommitMarker(this.commitMarkerPath, this.directory, this.binding);
        return committed.mutationResult;
      } catch (error) {
        const mapped = mapStorageError(error);
        if (mapped.code !== "storage_busy" || attempt === 99) throw mapped;
        await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 10));
      }
    }
    throw new AttemptStoreError("storage_busy");
  }

  private assertMutationSnapshot(state: AttemptStoreState): void {
    const snapshotPresent = managedFileExistsSync(this.statePath, this.binding.ownerUid);
    const markerPresent = hasCommitMarkerSync(this.commitMarkerPath, this.binding);
    if ((!snapshotPresent && state.entries.length > 0) ||
      (markerPresent && (!snapshotPresent || state.entries.length === 0))) {
      throw new AttemptStoreError("corrupt_state");
    }
  }
}

export async function createLocalAttemptPersistence(
  options: LocalAttemptPersistenceOptions
): Promise<LocalAttemptPersistence> {
  return LocalAttemptPersistence.open(options);
}
