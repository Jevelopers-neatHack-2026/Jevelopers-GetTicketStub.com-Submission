import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { link, mkdtemp, mkdir, open, readFile, realpath, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createLocalAttemptPersistence } from "../dist/index.js";
import { createLocalAttemptPersistenceForTests } from "../dist/attempt-store.js";

export const ATTEMPT_PROVIDER = "development-deterministic-simulator";
export const ATTEMPT_MODE = "simulated";
export const ATTEMPT_SCOPE = Object.freeze({
  tenantId: "tenant-attempt-store-fixture",
  projectId: "project-attempt-store-fixture"
});

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const attemptStoreModuleUrl = pathToFileURL(resolve(repositoryRoot, "dist/attempt-store.js")).href;

export function makeAttemptRecord(overrides = {}) {
  return {
    providerId: ATTEMPT_PROVIDER,
    tenantId: ATTEMPT_SCOPE.tenantId,
    projectId: ATTEMPT_SCOPE.projectId,
    idempotencyKey: "attempt-key-1",
    claimId: "claim-" + randomUUID(),
    authorizationId: "authorization-1",
    actionId: "action-1",
    authorizationClaimReference: "claim-reference-1",
    requestFingerprint: "sha256:request-1",
    sideEffectState: "unknown",
    budgetReservationState: "not_requested",
    updatedAt: 1_800_000_000_000,
    ...overrides
  };
}

export async function makePrivateTempDirectory(prefix = "fc-attempt-store-") {
  const created = await mkdtemp(join(tmpdir(), prefix));
  return realpath(created);
}

export async function openAttemptStore(directory, overrides = {}) {
  return createLocalAttemptPersistence({
    directory,
    providerId: overrides.providerId ?? ATTEMPT_PROVIDER,
    mode: overrides.mode ?? ATTEMPT_MODE,
    ...(overrides.faultHooks === undefined ? {} : { faultHooks: overrides.faultHooks })
  });
}

export async function openAttemptStoreWithHistoryLimitForTests(directory, historyLimit, overrides = {}) {
  return createLocalAttemptPersistenceForTests({
    directory,
    providerId: overrides.providerId ?? ATTEMPT_PROVIDER,
    mode: overrides.mode ?? ATTEMPT_MODE,
    ...(overrides.faultHooks === undefined ? {} : { faultHooks: overrides.faultHooks })
  }, historyLimit);
}

export async function removePrivateTempDirectory(directory) {
  await rm(directory, { recursive: true, force: true });
}

function childEnvironment(payload) {
  return {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    TMPDIR: tmpdir(),
    FC_ATTEMPT_CHILD_PAYLOAD: JSON.stringify(payload),
    FC_ATTEMPT_MODULE_URL: attemptStoreModuleUrl
  };
}

export async function runAttemptChild(payload, timeoutMs = 30_000) {
  const source = `
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const payload = JSON.parse(process.env.FC_ATTEMPT_CHILD_PAYLOAD);
if (payload.fixtureOutput === "malformed") {
  process.stdout.write("{malformed fixture output}\\n");
  process.exit(0);
}
const imported = await import(process.env.FC_ATTEMPT_MODULE_URL);
const pause = (milliseconds) => new Promise((resolvePause) => setTimeout(resolvePause, milliseconds));
async function waitForGateRelease(path, timeoutMs, timeoutCode) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await readFile(path);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await pause(10);
    }
  }
  const error = new Error(timeoutCode);
  error.code = timeoutCode;
  throw error;
}
async function pauseAtPublicationBarrier(barrier) {
  if (barrier === undefined) return;
  await mkdir(barrier.reachedDirectory, { mode: 0o700 });
  if (barrier.abortAfterSignal === true) process.exit(barrier.exitCode ?? 76);
  await waitForGateRelease(barrier.releaseFile, barrier.timeoutMs, "fixture_publication_barrier_timeout");
}
async function publishReadyRecord(gate) {
  const temporaryFile = gate.temporaryFile ?? gate.readyFile + ".tmp-" + process.pid + "-" + randomUUID();
  const handle = await open(temporaryFile, "wx", 0o600);
  try {
    await pauseAtPublicationBarrier(gate.pauseBeforeWrite);
    const contents = typeof gate.readyContents === "string"
      ? gate.readyContents
      : JSON.stringify({ pid: process.pid, readyAt: Date.now() }) + "\\n";
    await handle.writeFile(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await pauseAtPublicationBarrier(gate.pauseBeforePublish);
  try {
    await link(temporaryFile, gate.readyFile);
  } finally {
    await unlink(temporaryFile);
  }
  if (gate.abortAfterPublish === true) {
    const error = new Error("fixture_abort_after_ready_publish");
    error.code = "fixture_abort_after_ready_publish";
    throw error;
  }
}
const hooks = {};
if (payload.exitAt === "temporary_file_sync") {
  hooks.afterTemporaryFileSync = () => process.exit(73);
} else if (payload.exitAt === "writer_lock") {
  hooks.afterLock = () => process.exit(74);
} else if (payload.afterLockDelayMs !== undefined || payload.gate !== undefined) {
  hooks.afterLock = async () => {
    if (payload.afterLockDelayMs !== undefined) await pause(payload.afterLockDelayMs);
    if (payload.gate === undefined) return;
    await publishReadyRecord(payload.gate);
    await waitForGateRelease(payload.gate.releaseFile, payload.gate.timeoutMs, "fixture_lock_gate_timeout");
  };
}
const reportAttempts = payload.reportAttempts === true || payload.retryStorageBusy !== undefined;
const store = await imported.createLocalAttemptPersistence({
  directory: payload.directory,
  providerId: payload.providerId,
  mode: payload.mode,
  ...(Object.keys(hooks).length === 0 ? {} : { faultHooks: hooks })
});
const attemptLog = [];
const startedAt = performance.now();
const retry = payload.retryStorageBusy;
const retryDeadline = retry === undefined ? undefined : startedAt + retry.deadlineMs;
let result;
let failure;
for (;;) {
  const attemptStartedAt = performance.now();
  if (retryDeadline !== undefined && attemptStartedAt >= retryDeadline) {
    failure = Object.assign(new Error("fixture_retry_deadline"), { code: "fixture_retry_deadline" });
    break;
  }
  try {
    result = await store.claimSubmitAttempt(payload.record);
    attemptLog.push({
      attempt: attemptLog.length + 1,
      outcome: result.claimed ? "claimed" : "conflict",
      elapsedMs: Number((performance.now() - attemptStartedAt).toFixed(3))
    });
    break;
  } catch (error) {
    const code = typeof error?.code === "string" ? error.code : null;
    attemptLog.push({
      attempt: attemptLog.length + 1,
      errorCode: code,
      elapsedMs: Number((performance.now() - attemptStartedAt).toFixed(3))
    });
    if (retry === undefined || code !== "storage_busy") {
      failure = error;
      break;
    }
    const remainingMs = retryDeadline - performance.now();
    if (remainingMs <= 0) {
      failure = Object.assign(new Error("fixture_retry_deadline"), { code: "fixture_retry_deadline" });
      break;
    }
    const childIndex = Number.isSafeInteger(payload.childIndex) ? payload.childIndex : 0;
    const jitterMs = retry.jitterMs ?? 0;
    const jitter = jitterMs === 0 ? 0 : (childIndex * 7 + attemptLog.length * 11) % jitterMs;
    const delayMs = Math.min(retry.delayMs + jitter, remainingMs);
    await pause(delayMs);
  }
}
const elapsedMs = Number((performance.now() - startedAt).toFixed(3));
if (failure !== undefined) {
  if (!reportAttempts) throw failure;
  process.stdout.write(JSON.stringify({
    errorCode: typeof failure?.code === "string" ? failure.code : null,
    errorName: typeof failure?.name === "string" ? failure.name : "Error",
    errorMessage: typeof failure?.message === "string" ? failure.message : String(failure),
    attempts: attemptLog,
    busyAttempts: attemptLog.filter((attempt) => attempt.errorCode === "storage_busy").length,
    elapsedMs
  }) + "\\n");
  process.exitCode = 2;
} else {
  process.stdout.write(JSON.stringify(reportAttempts
    ? {
        result,
        attempts: attemptLog,
        busyAttempts: attemptLog.filter((attempt) => attempt.errorCode === "storage_busy").length,
        elapsedMs
      }
    : result) + "\\n");
}
if (failure === undefined && payload.exitAt === "after_claim") process.exit(75);
`;
  const childPayload = {
    directory: payload.directory,
    providerId: payload.providerId ?? ATTEMPT_PROVIDER,
    mode: payload.mode ?? ATTEMPT_MODE,
    record: payload.record,
    ...(payload.exitAt === undefined ? {} : { exitAt: payload.exitAt }),
    ...(payload.reportAttempts === undefined ? {} : { reportAttempts: payload.reportAttempts }),
    ...(payload.retryStorageBusy === undefined ? {} : { retryStorageBusy: payload.retryStorageBusy }),
    ...(payload.childIndex === undefined ? {} : { childIndex: payload.childIndex }),
    ...(payload.afterLockDelayMs === undefined ? {} : { afterLockDelayMs: payload.afterLockDelayMs }),
    ...(payload.gate === undefined ? {} : { gate: payload.gate }),
    ...(payload.fixtureOutput === undefined ? {} : { fixtureOutput: payload.fixtureOutput })
  };
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      cwd: repositoryRoot,
      env: childEnvironment(childPayload),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectChild(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolveChild({
        code,
        signal,
        stdout: stdout.join(""),
        stderr: stderr.join("")
      });
    });
  });
}

export function uniqueClaimId() {
  return "claim-" + randomUUID();
}
