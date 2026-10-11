import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
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
  const source = [
    "const payload = JSON.parse(process.env.FC_ATTEMPT_CHILD_PAYLOAD);",
    "const imported = await import(process.env.FC_ATTEMPT_MODULE_URL);",
    "const hooks = payload.exitAt === \"temporary_file_sync\"",
    "  ? { afterTemporaryFileSync: () => process.exit(73) }",
    "  : payload.exitAt === \"writer_lock\" ? { afterLock: () => process.exit(74) } : undefined;",
    "const store = await imported.createLocalAttemptPersistence({",
    "  directory: payload.directory,",
    "  providerId: payload.providerId,",
    "  mode: payload.mode,",
    "  ...(hooks === undefined ? {} : { faultHooks: hooks })",
    "});",
    "const result = await store.claimSubmitAttempt(payload.record);",
    "process.stdout.write(JSON.stringify(result) + \"\\n\");",
    "if (payload.exitAt === \"after_claim\") process.exit(75);"
  ].join("\n");
  const childPayload = {
    directory: payload.directory,
    providerId: payload.providerId ?? ATTEMPT_PROVIDER,
    mode: payload.mode ?? ATTEMPT_MODE,
    record: payload.record,
    ...(payload.exitAt === undefined ? {} : { exitAt: payload.exitAt })
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
