import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DurableJsonStore } from "../dist/metering-store.js";
import { ATTEMPT_STORE_MAX_HISTORY_LENGTH_FOR_TESTS } from "../dist/attempt-store.js";
import { AttemptStoreError, ConnectorError } from "../dist/index.js";
import {
  ATTEMPT_MODE,
  ATTEMPT_PROVIDER,
  ATTEMPT_SCOPE,
  makeAttemptRecord,
  makePrivateTempDirectory,
  openAttemptStore,
  openAttemptStoreWithHistoryLimitForTests,
  removePrivateTempDirectory,
  runAttemptChild
} from "./attempt-store-fixtures.mjs";
import {
  MOCK_BUNDLE,
  MOCK_SCOPE,
  createMockHarness,
  envelope,
  makeQuoteCommand,
  makeSubmitCommand
} from "./mock-fixtures.mjs";

const cases = [];
const thisDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(thisDirectory, "..");

function test(name, run) {
  cases.push({ name, run });
}

async function withRoot(run, { retainOnFailure = false } = {}) {
  const root = await makePrivateTempDirectory();
  let succeeded = false;
  try {
    await run(root);
    succeeded = true;
  } catch (error) {
    if (retainOnFailure) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${message}\nsynthetic fixture retained at ${root}`, { cause: error });
    }
    throw error;
  } finally {
    if (succeeded || !retainOnFailure) await removePrivateTempDirectory(root);
  }
}

async function expectStoreError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AttemptStoreError || error?.code === code);
    assert.equal(error.code, code);
    return true;
  });
}

async function expectMissingPath(path) {
  await assert.rejects(lstat(path), (error) => error?.code === "ENOENT");
}

function statePaths(directory) {
  return {
    snapshot: join(directory, ".attempt-store-v1", "metering-state.json"),
    marker: join(directory, ".attempt-store-committed.json")
  };
}

const CONTENTION_RETRY = Object.freeze({ deadlineMs: 12_000, delayMs: 15, jitterMs: 25 });

function errorDetails(error) {
  return {
    name: typeof error?.name === "string" ? error.name : "Error",
    code: typeof error?.code === "string" ? error.code : null,
    message: typeof error?.message === "string" ? error.message : String(error)
  };
}

async function fileEvidence(path) {
  try {
    const bytes = await readFile(path);
    return {
      present: true,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { present: false };
    return { present: null, error: errorDetails(error) };
  }
}

async function readBytesOrMissing(path) {
  try {
    return await readFile(path);
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function waitForFile(path, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
    }
  }
  throw Object.assign(new Error("fixture_ready_deadline"), { code: "fixture_ready_deadline" });
}

function parseChildReport(child) {
  try {
    const lines = child.stdout.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length !== 1) return { value: undefined, error: `expected one JSON line, received ${lines.length}` };
    return { value: JSON.parse(lines[0]), error: undefined };
  } catch (error) {
    return { value: undefined, error: errorDetails(error) };
  }
}

async function captureContentionState(directory, { providerId = ATTEMPT_PROVIDER, scope = ATTEMPT_SCOPE } = {}) {
  const paths = statePaths(directory);
  const files = {
    snapshot: await fileEvidence(paths.snapshot),
    marker: await fileEvidence(paths.marker)
  };
  try {
    const store = await openAttemptStore(directory, { providerId });
    const records = await store.listAttempts(scope);
    const histories = await Promise.all(records.map(async (record) => ({
      idempotencyKey: record.idempotencyKey,
      rows: await store.attemptHistory(scope, record.idempotencyKey)
    })));
    return { files, records, histories, error: undefined };
  } catch (error) {
    return { files, records: undefined, histories: undefined, error: errorDetails(error) };
  }
}

async function persistFixtureDiagnostic(localPath, fileName, value) {
  const contents = JSON.stringify(value, null, 2) + "\n";
  await writeFile(localPath, contents, { mode: 0o600 });
  const diagnosticDirectory = process.env.FC_ATTEMPT_CONTENTION_DIAGNOSTICS_DIR;
  if (diagnosticDirectory === undefined || diagnosticDirectory.length === 0) return localPath;
  await mkdir(diagnosticDirectory, { recursive: true, mode: 0o700 });
  const retainedPath = join(diagnosticDirectory, fileName);
  await writeFile(retainedPath, contents, { mode: 0o600 });
  return retainedPath;
}

async function runConvergentClaims({ label, directory, records, afterLockDelayMs }) {
  const startedAt = performance.now();
  const childResults = await Promise.allSettled(records.map((record, childIndex) => runAttemptChild({
    directory,
    record,
    childIndex,
    reportAttempts: true,
    retryStorageBusy: CONTENTION_RETRY,
    ...(afterLockDelayMs === undefined ? {} : { afterLockDelayMs })
  })));
  const children = childResults.map((settled, childIndex) => {
    if (settled.status === "rejected") {
      return { childIndex, status: "rejected", error: errorDetails(settled.reason) };
    }
    const child = settled.value;
    const parsed = parseChildReport(child);
    return {
      childIndex,
      status: "fulfilled",
      code: child.code,
      signal: child.signal,
      stdout: child.stdout,
      stderr: child.stderr,
      parsed: parsed.value,
      parseError: parsed.error
    };
  });
  const finalState = await captureContentionState(directory);
  const elapsedMs = Number((performance.now() - startedAt).toFixed(3));
  const diagnosticsPath = join(directory, "attempt-contention-diagnostics.json");
  const diagnostics = {
    label,
    afterLockDelayMs: afterLockDelayMs ?? 0,
    fixtureRetryDeadlineMs: CONTENTION_RETRY.deadlineMs,
    childWatchdogMs: 30_000,
    elapsedMs,
    childResults: children,
    reopenedState: finalState
  };
  await persistFixtureDiagnostic(
    diagnosticsPath,
    `convergence-${label.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}.json`,
    diagnostics
  );

  const issues = [];
  if (records.length !== 20) issues.push(`expected 20 requested children, received ${records.length}`);
  if (children.length !== 20) issues.push(`expected 20 settled children, received ${children.length}`);
  if (elapsedMs >= CONTENTION_RETRY.deadlineMs) issues.push(`overall race exceeded ${CONTENTION_RETRY.deadlineMs}ms fixture deadline`);
  const parsedChildren = children.filter((child) => child.status === "fulfilled");
  if (parsedChildren.length !== 20) issues.push(`only ${parsedChildren.length} child processes returned normally`);
  for (const child of children) {
    if (child.status !== "fulfilled") continue;
    if (child.code !== 0) issues.push(`child ${child.childIndex} exited ${child.code} signal=${child.signal}`);
    if (child.signal !== null) issues.push(`child ${child.childIndex} received signal ${child.signal}`);
    if (child.stderr !== "") issues.push(`child ${child.childIndex} wrote stderr`);
    if (child.parseError !== undefined) issues.push(`child ${child.childIndex} output was malformed`);
    if (child.parsed?.errorCode !== undefined) issues.push(`child ${child.childIndex} failed with ${child.parsed.errorCode}`);
    const attempts = child.parsed?.attempts;
    if (!Array.isArray(attempts) || attempts.length === 0) {
      issues.push(`child ${child.childIndex} omitted its attempt log`);
    } else {
      if (attempts.some((attempt) => attempt.errorCode !== undefined && attempt.errorCode !== "storage_busy")) {
        issues.push(`child ${child.childIndex} logged an error other than storage_busy`);
      }
      if (attempts.some((attempt) => !Number.isFinite(attempt.elapsedMs) || attempt.elapsedMs < 0)) {
        issues.push(`child ${child.childIndex} logged invalid timing`);
      }
      if (child.parsed?.busyAttempts !== attempts.filter((attempt) => attempt.errorCode === "storage_busy").length) {
        issues.push(`child ${child.childIndex} busy-attempt count does not match its log`);
      }
      if (!Number.isFinite(child.parsed?.elapsedMs) || child.parsed.elapsedMs > CONTENTION_RETRY.deadlineMs) {
        issues.push(`child ${child.childIndex} exceeded its fixture retry deadline`);
      }
    }
    if (typeof child.parsed?.result?.claimed !== "boolean") {
      issues.push(`child ${child.childIndex} did not return a valid claim/conflict result`);
    }
  }
  const outcomes = parsedChildren.map((child) => child.parsed?.result).filter((result) => result !== undefined);
  const winners = outcomes.filter((outcome) => outcome.claimed === true);
  const conflicts = outcomes.filter((outcome) => outcome.claimed === false);
  if (winners.length !== 1) issues.push(`expected one owner, received ${winners.length}`);
  if (conflicts.length !== 19) issues.push(`expected nineteen conflicts, received ${conflicts.length}`);
  if (!Array.isArray(finalState.records)) issues.push("final store could not be reopened");
  else if (finalState.records.length !== 1) issues.push(`expected one reopened record, received ${finalState.records.length}`);
  if (finalState.error !== undefined) issues.push(`final reopen failed: ${finalState.error.code ?? finalState.error.message}`);
  if (winners.length === 1 && Array.isArray(finalState.records) && finalState.records.length === 1) {
    const winnerIndex = outcomes.findIndex((outcome) => outcome.claimed === true);
    const stored = finalState.records[0];
    const winnerRecord = records[winnerIndex];
    if (JSON.stringify(stored) !== JSON.stringify(winnerRecord)) issues.push("reopened owner does not match its immutable submitted record");
    if (stored.claimId !== winnerRecord.claimId ||
      stored.requestFingerprint !== winnerRecord.requestFingerprint ||
      stored.authorizationClaimReference !== winnerRecord.authorizationClaimReference ||
      stored.actionId !== winnerRecord.actionId || stored.authorizationId !== winnerRecord.authorizationId) {
      issues.push("reopened owner, fingerprint, action, authorization, or claim reference changed");
    }
    for (const child of parsedChildren) {
      const result = child.parsed?.result;
      if (result?.claimed === false && JSON.stringify(result.existing) !== JSON.stringify(stored)) {
        issues.push(`child ${child.childIndex} conflict does not point to the immutable retained owner`);
      }
      if (result?.claimed === true && result.existing !== undefined) {
        issues.push(`child ${child.childIndex} owner result unexpectedly includes an existing record`);
      }
    }
  }
  assert.deepEqual(issues, [], `${label}; complete child/store evidence: ${diagnosticsPath}`);
  return { children, finalState, elapsedMs };
}

function makeInvalidStateInputs(hookCalls) {
  return [
    { name: "empty array", value: [] },
    { name: "single-element array", value: ["unknown"] },
    { name: "nested single-element array", value: [["unknown"]] },
    { name: "boxed string", value: new String("unknown") },
    { name: "ordinary object", value: {} },
    { name: "null-prototype object", value: Object.create(null) },
    {
      name: "Symbol.toPrimitive object",
      value: {
        [Symbol.toPrimitive]() {
          hookCalls.count += 1;
          return "unknown";
        }
      }
    },
    {
      name: "toString object",
      value: {
        toString() {
          hookCalls.count += 1;
          return "unknown";
        },
        valueOf() {
          hookCalls.count += 1;
          return "unknown";
        }
      }
    },
    { name: "number", value: 1 },
    { name: "boolean", value: false },
    { name: "null", value: null },
    { name: "unknown primitive string", value: "future_state" }
  ];
}

const JSON_INVALID_ENUM_VALUES = [
  { name: "empty array", value: [] },
  { name: "single-element array", value: ["unknown"] },
  { name: "nested single-element array", value: [["unknown"]] },
  { name: "ordinary object", value: {} },
  { name: "number", value: 1 },
  { name: "boolean", value: false },
  { name: "null", value: null },
  { name: "unknown primitive string", value: "future_state" }
];

async function expectConnectorError(promise, code, sideEffectState) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof ConnectorError);
    assert.equal(error.code, code);
    if (sideEffectState !== undefined) assert.equal(error.sideEffectState, sideEffectState);
    return true;
  });
}

async function prepareSubmit(harness, overrides = {}) {
  const quoteResponse = await harness.runtime.quote(
    envelope(makeQuoteCommand(MOCK_BUNDLE, { fixture: "synthetic destination" })),
    MOCK_SCOPE
  );
  return makeSubmitCommand(quoteResponse.value, MOCK_BUNDLE, overrides);
}

async function attachAttemptStore(harness, directory) {
  const persistence = await openAttemptStore(directory, {
    providerId: harness.simulator.adapter.descriptor.providerId,
    mode: "simulated"
  });
  harness.dependencies.persistence = persistence;
  return persistence;
}

async function localSocketError() {
  return new Promise((resolveSocket) => {
    const socket = createConnection({ host: "127.0.0.1", port: 9 });
    const timer = setTimeout(() => {
      socket.destroy();
      resolveSocket("timeout");
    }, 2_000);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.destroy();
      resolveSocket("connected");
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      resolveSocket(error.code ?? error.name);
    });
  });
}

async function localNetworkPositiveControl() {
  const server = createServer((socket) => socket.end("local-only"));
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const response = await new Promise((resolveResponse, rejectResponse) => {
    const socket = createConnection({ host: "127.0.0.1", port: address.port });
    const chunks = [];
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.once("end", () => resolveResponse(chunks.join("")));
    socket.once("error", rejectResponse);
  });
  await new Promise((resolveClose, rejectClose) => server.close((error) => error ? rejectClose(error) : resolveClose()));
  assert.equal(response, "local-only");
}

test("a scoped claim and its state history survive reopening the real JSON store", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const first = await openAttemptStore(directory);
    const record = makeAttemptRecord();
    assert.deepEqual(await first.claimSubmitAttempt(record), { claimed: true });
    await first.saveSubmitAttempt({ ...record, budgetReservationState: "pending", updatedAt: record.updatedAt + 1 });
    const second = await openAttemptStore(directory);
    assert.deepEqual(await second.getSubmitAttempt(record.providerId, ATTEMPT_SCOPE, record.idempotencyKey), {
      ...record,
      budgetReservationState: "pending",
      updatedAt: record.updatedAt + 1
    });
    assert.deepEqual(await second.attemptHistory(ATTEMPT_SCOPE, record.idempotencyKey).then((history) =>
      history.map((row) => [row.revision, row.event, row.budgetReservationState])),
    [[0, "claimed", "not_requested"], [1, "updated", "pending"]]);
    assert.equal((await second.listAttempts(ATTEMPT_SCOPE)).length, 1);
    assert.equal(await second.getSubmitAttempt(record.providerId, {
      tenantId: "another-tenant",
      projectId: "another-project"
    }, record.idempotencyKey), undefined);
  });
});

test("history capacity allows the final valid row, keeps exact repeats safe, and rejects overflow before writing", async () => {
  assert.equal(ATTEMPT_STORE_MAX_HISTORY_LENGTH_FOR_TESTS, 1_000_000);
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const store = await openAttemptStoreWithHistoryLimitForTests(directory, 3);
    const record = makeAttemptRecord();
    await store.claimSubmitAttempt(record);
    const pending = { ...record, budgetReservationState: "pending", updatedAt: record.updatedAt + 1 };
    await store.saveSubmitAttempt(pending);
    const possible = { ...pending, sideEffectState: "possible", updatedAt: record.updatedAt + 2 };
    await store.saveSubmitAttempt(possible);

    const paths = statePaths(directory);
    const snapshotAtCapacity = await readFile(paths.snapshot, "utf8");
    const markerAtCapacity = await readFile(paths.marker, "utf8");
    assert.equal(JSON.parse(snapshotAtCapacity).entries[0].history.length, 3);

    await store.saveSubmitAttempt(possible);
    assert.equal(await readFile(paths.snapshot, "utf8"), snapshotAtCapacity);
    assert.equal(await readFile(paths.marker, "utf8"), markerAtCapacity);

    const overCapacity = {
      ...possible,
      sideEffectState: "confirmed",
      providerRequestId: "capacity-provider-request",
      budgetReservationState: "reserved",
      budgetReservationReference: "capacity-reservation-reference",
      updatedAt: record.updatedAt + 3
    };
    await expectStoreError(store.saveSubmitAttempt(overCapacity), "storage_unavailable");
    assert.equal(await readFile(paths.snapshot, "utf8"), snapshotAtCapacity);
    assert.equal(await readFile(paths.marker, "utf8"), markerAtCapacity);

    const reopened = await openAttemptStoreWithHistoryLimitForTests(directory, 3);
    assert.deepEqual(await reopened.getSubmitAttempt(record.providerId, ATTEMPT_SCOPE, record.idempotencyKey), possible);
    assert.equal((await reopened.attemptHistory(ATTEMPT_SCOPE, record.idempotencyKey)).length, 3);
  });
});

test("committed empty or missing snapshots cannot be reclaimed by reads, claims, or saves", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "empty-committed");
    const store = await openAttemptStore(directory);
    const record = makeAttemptRecord();
    await store.claimSubmitAttempt(record);
    const statePath = join(directory, ".attempt-store-v1", "metering-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.entries = [];
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
    const corruptBytes = await readFile(statePath, "utf8");
    const replacement = { ...record, claimId: "replacement-owner" };
    await expectStoreError(
      store.getSubmitAttempt(record.providerId, ATTEMPT_SCOPE, record.idempotencyKey),
      "corrupt_state"
    );
    await expectStoreError(store.claimSubmitAttempt(replacement), "corrupt_state");
    await expectStoreError(
      store.saveSubmitAttempt({ ...record, updatedAt: record.updatedAt + 1 }),
      "corrupt_state"
    );
    await expectStoreError(openAttemptStore(directory), "corrupt_state");
    assert.equal(await readFile(statePath, "utf8"), corruptBytes);
  });
});

test("a committed snapshot removed after lock acquisition blocks a second owner without rewriting evidence", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "missing-committed");
    const statePath = join(directory, ".attempt-store-v1", "metering-state.json");
    let removeOnNextLock = false;
    const store = await openAttemptStore(directory, {
      faultHooks: {
        afterLock: async () => {
          if (!removeOnNextLock) return;
          removeOnNextLock = false;
          await unlink(statePath);
        }
      }
    });
    const record = makeAttemptRecord();
    await store.claimSubmitAttempt(record);
    const markerPath = join(directory, ".attempt-store-committed.json");
    const markerBytes = await readFile(markerPath, "utf8");
    removeOnNextLock = true;
    await expectStoreError(
      store.claimSubmitAttempt({ ...record, claimId: "owner-after-state-loss" }),
      "corrupt_state"
    );
    await assert.rejects(readFile(statePath), (error) => error?.code === "ENOENT");
    assert.equal(await readFile(markerPath, "utf8"), markerBytes);
    await expectStoreError(openAttemptStore(directory), "corrupt_state");
    assert.equal(await readFile(markerPath, "utf8"), markerBytes);
  });
});

test("a first claim between snapshot read and marker validation is re-read without false corruption", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "read-first-claim-race");
    const reader = await openAttemptStore(directory);
    const writer = await openAttemptStore(directory);
    const record = makeAttemptRecord();
    const originalRead = DurableJsonStore.prototype.read;
    let pauseNextRead = true;
    let announceRead;
    const readPaused = new Promise((resolvePause) => { announceRead = resolvePause; });
    let resumeRead;
    const readResume = new Promise((resolveResume) => { resumeRead = resolveResume; });
    DurableJsonStore.prototype.read = async function () {
      const snapshot = await originalRead.call(this);
      if (pauseNextRead) {
        pauseNextRead = false;
        announceRead();
        await readResume;
      }
      return snapshot;
    };
    try {
      const pendingRead = reader.getSubmitAttempt(record.providerId, ATTEMPT_SCOPE, record.idempotencyKey);
      await readPaused;
      assert.deepEqual(await writer.claimSubmitAttempt(record), { claimed: true });
      resumeRead();
      assert.deepEqual(await pendingRead, record);
      assert.deepEqual(
        await reader.getSubmitAttempt(record.providerId, ATTEMPT_SCOPE, record.idempotencyKey),
        record
      );
    } finally {
      DurableJsonStore.prototype.read = originalRead;
      resumeRead();
    }
  });
});

test("authorization and logical-action claims remain unique across changed keys and renewed authorizations", async () => {
  await withRoot(async (root) => {
    const store = await openAttemptStore(join(root, "attempts"));
    const first = makeAttemptRecord({
      sideEffectState: "confirmed",
      providerRequestId: "private-provider-request",
      budgetReservationState: "reserved",
      budgetReservationReference: "private-reservation"
    });
    assert.deepEqual(await store.claimSubmitAttempt(first), { claimed: true });
    const sameScopeAuthorization = makeAttemptRecord({
      idempotencyKey: "same-scope-authorization-key",
      claimId: "claim-same-scope-authorization",
      authorizationId: first.authorizationId,
      actionId: "action-same-scope-authorization",
      requestFingerprint: "sha256:same-scope-authorization"
    });
    const sameScopeAuthorizationResult = await store.claimSubmitAttempt(sameScopeAuthorization);
    assert.equal(sameScopeAuthorizationResult.claimed, false);
    assert.deepEqual(sameScopeAuthorizationResult.existing, first);
    const assertForeignConflictIsPrivate = (conflict) => {
      assert.equal(conflict.claimed, false);
      assert.equal(Object.hasOwn(conflict, "existing"), false);
      const serialized = JSON.stringify(conflict);
      for (const privateField of [
        first.tenantId,
        first.projectId,
        first.idempotencyKey,
        first.claimId,
        first.authorizationId,
        first.actionId,
        first.authorizationClaimReference,
        first.requestFingerprint,
        first.budgetReservationReference,
        first.providerRequestId
      ]) {
        assert.equal(serialized.includes(privateField), false);
      }
    };
    const renewedAuthorization = makeAttemptRecord({
      idempotencyKey: "new-delivery-key",
      claimId: "claim-renewed",
      authorizationId: "authorization-renewed",
      authorizationClaimReference: "claim-reference-renewed",
      actionId: first.actionId,
      requestFingerprint: "sha256:renewed-request"
    });
    const reused = await store.claimSubmitAttempt(renewedAuthorization);
    assert.equal(reused.claimed, false);
    assert.equal(reused.existing?.claimId, first.claimId);
    const authorizationInOtherScope = makeAttemptRecord({
      tenantId: "tenant-other",
      projectId: "project-other",
      idempotencyKey: "other-scope-key",
      claimId: "claim-other-scope",
      authorizationId: first.authorizationId,
      actionId: "action-other-scope"
    });
    const authReuse = await store.claimSubmitAttempt(authorizationInOtherScope);
    assertForeignConflictIsPrivate(authReuse);
    const sameTenantDifferentProject = makeAttemptRecord({
      tenantId: ATTEMPT_SCOPE.tenantId,
      projectId: "project-other",
      idempotencyKey: "other-project-key",
      claimId: "claim-other-project",
      authorizationId: first.authorizationId,
      actionId: "action-other-project"
    });
    const projectReuse = await store.claimSubmitAttempt(sameTenantDifferentProject);
    assertForeignConflictIsPrivate(projectReuse);
    const separateScope = makeAttemptRecord({
      tenantId: "tenant-other",
      projectId: "project-other",
      idempotencyKey: "other-independent-key",
      claimId: "claim-other-independent",
      authorizationId: "authorization-other-independent",
      actionId: "action-other-independent"
    });
    assert.deepEqual(await store.claimSubmitAttempt(separateScope), { claimed: true });
    assert.equal((await store.listAttempts(ATTEMPT_SCOPE)).length, 1);
  });
});

test("same-key changed fingerprints stay bound to the first payload", async () => {
  await withRoot(async (root) => {
    const store = await openAttemptStore(join(root, "attempts"));
    const first = makeAttemptRecord();
    assert.deepEqual(await store.claimSubmitAttempt(first), { claimed: true });
    const changed = { ...first, claimId: "claim-new", requestFingerprint: "sha256:changed-payload" };
    const result = await store.claimSubmitAttempt(changed);
    assert.equal(result.claimed, false);
    assert.equal(result.existing?.requestFingerprint, first.requestFingerprint);
    assert.deepEqual(await store.getSubmitAttempt(first.providerId, ATTEMPT_SCOPE, first.idempotencyKey), first);
  });
});

test("stale updates cannot erase uncertain effects, reservation holds, references, or immutable owner binding", async () => {
  await withRoot(async (root) => {
    const store = await openAttemptStore(join(root, "attempts"));
    const first = makeAttemptRecord();
    await store.claimSubmitAttempt(first);
    const pending = { ...first, budgetReservationState: "pending", updatedAt: first.updatedAt + 1 };
    await store.saveSubmitAttempt(pending);
    const reserved = {
      ...pending,
      budgetReservationState: "reserved",
      budgetReservationReference: "synthetic-reservation-reference",
      updatedAt: first.updatedAt + 2
    };
    await store.saveSubmitAttempt(reserved);
    const possible = { ...reserved, sideEffectState: "possible", updatedAt: first.updatedAt + 3 };
    await store.saveSubmitAttempt(possible);
    await expectStoreError(
      store.saveSubmitAttempt({ ...pending, updatedAt: first.updatedAt + 4 }),
      "stale_update"
    );
    await expectStoreError(
      store.saveSubmitAttempt({ ...possible, actionId: "rewritten-action", updatedAt: first.updatedAt + 4 }),
      "immutable_binding"
    );
    await expectStoreError(
      store.saveSubmitAttempt({ ...possible, budgetReservationReference: "rewritten-reference", updatedAt: first.updatedAt + 4 }),
      "immutable_binding"
    );
    const laterRetry = makeAttemptRecord({
      idempotencyKey: "key-after-retention-window",
      claimId: "claim-after-window",
      authorizationId: "authorization-after-window",
      authorizationClaimReference: "claim-after-window-reference",
      actionId: first.actionId,
      requestFingerprint: "sha256:later",
      updatedAt: Number.MAX_SAFE_INTEGER
    });
    const retry = await store.claimSubmitAttempt(laterRetry);
    assert.equal(retry.claimed, false);
    assert.equal(retry.existing?.budgetReservationReference, reserved.budgetReservationReference);
    const reopened = await openAttemptStore(join(root, "attempts"));
    const final = await reopened.getSubmitAttempt(first.providerId, ATTEMPT_SCOPE, first.idempotencyKey);
    assert.equal(final?.sideEffectState, "possible");
    assert.equal(final?.budgetReservationState, "reserved");
    assert.equal(final?.budgetReservationReference, reserved.budgetReservationReference);
  });
});

test("twenty independent processes atomically converge on one duplicate idempotency claim", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const record = makeAttemptRecord();
    const records = Array.from({ length: 20 }, (_, index) => ({
      ...record,
      claimId: "parallel-same-key-" + index
    }));
    await runConvergentClaims({ label: "same idempotency key", directory, records });
  }, { retainOnFailure: true });
});

test("twenty distinct delivery keys cannot race the same authorization or action", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const base = makeAttemptRecord();
    const records = Array.from({ length: 20 }, (_, index) => ({
      ...base,
      idempotencyKey: "parallel-key-" + index,
      claimId: "parallel-action-" + index
    }));
    await runConvergentClaims({ label: "distinct delivery keys sharing authorization and action", directory, records });
  }, { retainOnFailure: true });
});

test("twenty independent processes enforce action and authorization fences separately", async () => {
  await withRoot(async (root) => {
    const dimensions = [
      {
        name: "same-action-distinct-authorizations",
        recordAt(index, base) {
          return {
            ...base,
            idempotencyKey: "action-key-" + index,
            claimId: "action-claim-" + index,
            authorizationId: "action-authorization-" + index
          };
        }
      },
      {
        name: "same-authorization-distinct-actions",
        recordAt(index, base) {
          return {
            ...base,
            idempotencyKey: "authorization-key-" + index,
            claimId: "authorization-claim-" + index,
            actionId: "authorization-action-" + index
          };
        }
      }
    ];
    for (const dimension of dimensions) {
      const directory = join(root, dimension.name);
      const base = makeAttemptRecord();
      const records = Array.from({ length: 20 }, (_, index) => dimension.recordAt(index, base));
      await runConvergentClaims({ label: dimension.name, directory, records });
    }
  }, { retainOnFailure: true });
});

test("twenty-process action and authorization fences converge under deterministic 100ms lock delays", async () => {
  await withRoot(async (root) => {
    const dimensions = [
      {
        name: "delayed-same-action-distinct-authorizations",
        recordAt(index, base) {
          return {
            ...base,
            idempotencyKey: "delayed-action-key-" + index,
            claimId: "delayed-action-claim-" + index,
            authorizationId: "delayed-action-authorization-" + index
          };
        }
      },
      {
        name: "delayed-same-authorization-distinct-actions",
        recordAt(index, base) {
          return {
            ...base,
            idempotencyKey: "delayed-authorization-key-" + index,
            claimId: "delayed-authorization-claim-" + index,
            actionId: "delayed-authorization-action-" + index
          };
        }
      }
    ];
    for (const dimension of dimensions) {
      const directory = join(root, dimension.name);
      const base = makeAttemptRecord();
      const records = Array.from({ length: 20 }, (_, index) => dimension.recordAt(index, base));
      await runConvergentClaims({
        label: dimension.name,
        directory,
        records,
        afterLockDelayMs: 100
      });
    }
  }, { retainOnFailure: true });
});

test("a one-shot storage_busy exhaustion preserves a live owner and resolves only after release", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const store = await openAttemptStore(directory);
    const priorRecord = makeAttemptRecord({
      idempotencyKey: "prior-committed-record",
      claimId: "prior-committed-owner",
      authorizationId: "prior-committed-authorization",
      actionId: "prior-committed-action"
    });
    const ownerRecord = makeAttemptRecord({
      idempotencyKey: "gated-owner-record",
      claimId: "gated-owner-claim",
      authorizationId: "gated-owner-authorization",
      actionId: "gated-owner-action"
    });
    assert.deepEqual(await store.claimSubmitAttempt(priorRecord), { claimed: true });
    const paths = statePaths(directory);
    const readyFile = join(root, "writer-lock-ready.json");
    const releaseFile = join(root, "writer-lock-release");
    const ownerRun = runAttemptChild({
      directory,
      record: ownerRecord,
      reportAttempts: true,
      gate: { readyFile, releaseFile, timeoutMs: 20_000 }
    }).then((value) => ({ status: "fulfilled", value }), (error) => ({ status: "rejected", error: errorDetails(error) }));

    let readyText;
    let gateInfo;
    let lockBefore;
    let lockAfter;
    let snapshotBefore;
    let snapshotAfter;
    let markerBefore;
    let markerAfter;
    let contender;
    let contenderReport;
    let contenderParseError;
    let deadlineContender;
    let deadlineReport;
    let deadlineParseError;
    let recordsWhileLocked;
    let sameIdentityAfterRelease;
    let sameIdentityError;
    let ownerOutcome;
    let operationError;
    try {
      readyText = await waitForFile(readyFile, 5_000);
      gateInfo = JSON.parse(readyText);
      lockBefore = await readFile(join(directory, ".attempt-store-v1", ".metering-writer.lock"));
      snapshotBefore = await readBytesOrMissing(paths.snapshot);
      markerBefore = await readBytesOrMissing(paths.marker);
      contender = await runAttemptChild({ directory, record: ownerRecord, reportAttempts: true });
      const parsedContender = parseChildReport(contender);
      contenderReport = parsedContender.value;
      contenderParseError = parsedContender.error;
      deadlineContender = await runAttemptChild({
        directory,
        record: ownerRecord,
        reportAttempts: true,
        retryStorageBusy: { deadlineMs: 200, delayMs: 10, jitterMs: 0 }
      });
      const parsedDeadline = parseChildReport(deadlineContender);
      deadlineReport = parsedDeadline.value;
      deadlineParseError = parsedDeadline.error;
      snapshotAfter = await readBytesOrMissing(paths.snapshot);
      markerAfter = await readBytesOrMissing(paths.marker);
      lockAfter = await readBytesOrMissing(join(directory, ".attempt-store-v1", ".metering-writer.lock"));
      recordsWhileLocked = await store.listAttempts(ATTEMPT_SCOPE);
    } catch (error) {
      operationError = errorDetails(error);
    } finally {
      await writeFile(releaseFile, "release\n", { mode: 0o600 }).catch(() => undefined);
      ownerOutcome = await ownerRun;
    }

    try {
      sameIdentityAfterRelease = await store.claimSubmitAttempt(ownerRecord);
    } catch (error) {
      sameIdentityError = errorDetails(error);
    }
    const finalState = await captureContentionState(directory);
    const diagnosticsPath = join(root, "one-shot-exhaustion-diagnostics.json");
    const diagnostics = {
      ownerRecord,
      readyText,
      gateInfo,
      operationError,
      ownerOutcome,
      contender: contender === undefined ? undefined : {
        code: contender.code,
        signal: contender.signal,
        stdout: contender.stdout,
        stderr: contender.stderr,
        parsed: contenderReport,
        parseError: contenderParseError
      },
      deadlineContender: deadlineContender === undefined ? undefined : {
        code: deadlineContender.code,
        signal: deadlineContender.signal,
        stdout: deadlineContender.stdout,
        stderr: deadlineContender.stderr,
        parsed: deadlineReport,
        parseError: deadlineParseError
      },
      lockBefore: lockBefore === undefined ? undefined : { text: lockBefore.toString("utf8"), sha256: createHash("sha256").update(lockBefore).digest("hex") },
      lockAfter: lockAfter === undefined ? undefined : { text: lockAfter.toString("utf8"), sha256: createHash("sha256").update(lockAfter).digest("hex") },
      snapshotBefore: snapshotBefore === undefined ? undefined : { byteLength: snapshotBefore.byteLength, sha256: createHash("sha256").update(snapshotBefore).digest("hex") },
      snapshotAfter: snapshotAfter === undefined ? undefined : { byteLength: snapshotAfter.byteLength, sha256: createHash("sha256").update(snapshotAfter).digest("hex") },
      markerBefore: markerBefore === undefined ? undefined : { byteLength: markerBefore.byteLength, sha256: createHash("sha256").update(markerBefore).digest("hex") },
      markerAfter: markerAfter === undefined ? undefined : { byteLength: markerAfter.byteLength, sha256: createHash("sha256").update(markerAfter).digest("hex") },
      snapshotUnchanged: snapshotBefore === undefined ? snapshotAfter === undefined : snapshotBefore.equals(snapshotAfter),
      markerUnchanged: markerBefore === undefined ? markerAfter === undefined : markerBefore.equals(markerAfter),
      lockUnchanged: lockBefore === undefined ? lockAfter === undefined : lockBefore.equals(lockAfter),
      recordsWhileLocked,
      sameIdentityAfterRelease,
      sameIdentityError,
      reopenedState: finalState
    };
    await persistFixtureDiagnostic(diagnosticsPath, "one-shot-exhaustion-diagnostics.json", diagnostics);

    const issues = [];
    if (operationError !== undefined) issues.push(`gate/contender collection failed: ${operationError.code ?? operationError.message}`);
    if (gateInfo?.pid === undefined) issues.push("live-lock owner did not report its pid");
    if (lockBefore === undefined || JSON.parse(lockBefore.toString("utf8")).pid !== gateInfo?.pid) issues.push("writer lock was not held by the gated child");
    if (lockAfter === undefined || lockBefore === undefined || !lockBefore.equals(lockAfter)) issues.push("gated writer lock changed during one-shot exhaustion");
    if (snapshotBefore === undefined || snapshotAfter === undefined || !snapshotBefore.equals(snapshotAfter)) issues.push("snapshot bytes changed during one-shot exhaustion");
    if (markerBefore === undefined || markerAfter === undefined || !markerBefore.equals(markerAfter)) issues.push("commit-marker bytes changed during one-shot exhaustion");
    if (contender?.code !== 2 || contender.signal !== null) issues.push("one-shot contender did not fail normally");
    if (contenderParseError !== undefined) issues.push("one-shot contender output was malformed");
    if (contenderReport?.errorCode !== "storage_busy") issues.push(`one-shot contender returned ${contenderReport?.errorCode ?? "no error code"}`);
    if (!Array.isArray(contenderReport?.attempts) || contenderReport.attempts.length !== 1 || contenderReport.attempts[0]?.errorCode !== "storage_busy") {
      issues.push("one-shot contender did not record exactly one storage_busy attempt");
    }
    if (deadlineContender?.code !== 2 || deadlineContender.signal !== null || deadlineParseError !== undefined) {
      issues.push("bounded retry contender did not fail with a structured deadline report");
    }
    if (deadlineReport?.errorCode !== "fixture_retry_deadline" || deadlineReport?.result !== undefined) {
      issues.push("unresolved storage_busy was not converted into fixture_retry_deadline");
    }
    if (!Array.isArray(deadlineReport?.attempts) || deadlineReport.attempts.length === 0 ||
      deadlineReport.attempts.some((attempt) => attempt.errorCode !== "storage_busy") || deadlineReport.busyAttempts !== deadlineReport.attempts.length) {
      issues.push("fixture retry continued for a non-storage_busy error or omitted its busy log");
    }
    if (!Number.isFinite(deadlineReport?.elapsedMs) || deadlineReport.elapsedMs >= 5_000) {
      issues.push("fixture retry did not stop within the finite exhaustion bound");
    }
    if (!Array.isArray(recordsWhileLocked) || recordsWhileLocked.length !== 1 || recordsWhileLocked[0]?.claimId !== priorRecord.claimId) {
      issues.push("the gated claim appeared before its owner was released");
    }
    if (ownerOutcome?.status !== "fulfilled" || ownerOutcome.value.code !== 0) issues.push("gated owner did not complete after release");
    else {
      const parsedOwner = parseChildReport(ownerOutcome.value);
      if (parsedOwner.error !== undefined || parsedOwner.value?.result?.claimed !== true) issues.push("gated owner did not claim its record after release");
    }
    if (sameIdentityError !== undefined || sameIdentityAfterRelease?.claimed !== false ||
      JSON.stringify(sameIdentityAfterRelease?.existing) !== JSON.stringify(ownerRecord)) {
      issues.push("the consumed same identity did not resolve to its owner after release");
    }
    if (!Array.isArray(finalState.records) || finalState.records.length !== 2 ||
      !finalState.records.some((record) => record.claimId === priorRecord.claimId) ||
      !finalState.records.some((record) => record.claimId === ownerRecord.claimId)) {
      issues.push("reopened state does not contain exactly the prior and gated owner records");
    }
    assert.deepEqual(issues, [], `one-shot storage exhaustion evidence: ${diagnosticsPath}`);
  }, { retainOnFailure: true });
});

test("fixture retry diagnostics reject deadline, nonbusy errors, malformed output, and abnormal exits", async () => {
  await withRoot(async (root) => {
    const otherError = await runAttemptChild({
      directory: join(root, "other-error"),
      record: makeAttemptRecord({ sideEffectState: "not-a-declared-state" }),
      reportAttempts: true,
      retryStorageBusy: CONTENTION_RETRY
    });
    const malformed = await runAttemptChild({
      directory: join(root, "malformed-output"),
      record: makeAttemptRecord(),
      reportAttempts: true,
      fixtureOutput: "malformed"
    });
    const abnormal = await runAttemptChild({
      directory: join(root, "abnormal-exit"),
      record: makeAttemptRecord(),
      reportAttempts: true,
      exitAt: "after_claim"
    });
    const otherErrorReport = parseChildReport(otherError);
    const malformedReport = parseChildReport(malformed);
    const abnormalReport = parseChildReport(abnormal);
    const diagnosticsPath = join(root, "fixture-failure-controls.json");
    const diagnostics = {
      otherError: {
        code: otherError.code,
        signal: otherError.signal,
        stdout: otherError.stdout,
        stderr: otherError.stderr,
        parsed: otherErrorReport.value,
        parseError: otherErrorReport.error
      },
      malformed: {
        code: malformed.code,
        signal: malformed.signal,
        stdout: malformed.stdout,
        stderr: malformed.stderr,
        parsed: malformedReport.value,
        parseError: malformedReport.error
      },
      abnormal: {
        code: abnormal.code,
        signal: abnormal.signal,
        stdout: abnormal.stdout,
        stderr: abnormal.stderr,
        parsed: abnormalReport.value,
        parseError: abnormalReport.error
      }
    };
    await persistFixtureDiagnostic(diagnosticsPath, "fixture-failure-controls.json", diagnostics);

    const issues = [];
    if (otherError.code !== 2 || otherError.signal !== null || otherErrorReport.error !== undefined) {
      issues.push("nonbusy storage error did not produce a structured failure");
    }
    if (otherErrorReport.value?.errorCode !== "invalid_record" || otherErrorReport.value?.result !== undefined) {
      issues.push("fixture retry accepted or misclassified a non-storage_busy error");
    }
    if (!Array.isArray(otherErrorReport.value?.attempts) || otherErrorReport.value.attempts.length !== 1 ||
      otherErrorReport.value.attempts[0]?.errorCode !== "invalid_record" || otherErrorReport.value.busyAttempts !== 0) {
      issues.push("fixture retry continued after invalid_record");
    }
    if (malformed.code !== 0 || malformed.signal !== null || malformedReport.error === undefined || malformedReport.value !== undefined) {
      issues.push("malformed child output was accepted");
    }
    if (abnormal.code !== 75 || abnormal.signal !== null || abnormalReport.error !== undefined ||
      abnormalReport.value?.result?.claimed !== true) {
      issues.push("abnormal child exit was accepted as a settled convergence result");
    }
    assert.deepEqual(issues, [], `fixture child failure evidence: ${diagnosticsPath}`);
  }, { retainOnFailure: true });
});

test("runtime lock exhaustion remains not_dispatched with no budget or provider effects", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const harness = createMockHarness({ meteringDirectory: join(root, "metering") });
    const providerId = harness.simulator.adapter.descriptor.providerId;
    const store = await attachAttemptStore(harness, directory);
    const command = await prepareSubmit(harness);
    const ownerRecord = makeAttemptRecord({
      providerId,
      tenantId: MOCK_SCOPE.tenantId,
      projectId: MOCK_SCOPE.projectId,
      idempotencyKey: "runtime-lock-owner-key",
      claimId: "runtime-lock-owner-claim",
      authorizationId: "runtime-lock-owner-authorization",
      actionId: "runtime-lock-owner-action"
    });
    const readyFile = join(root, "runtime-writer-lock-ready.json");
    const releaseFile = join(root, "runtime-writer-lock-release");
    const ownerRun = runAttemptChild({
      directory,
      providerId,
      record: ownerRecord,
      reportAttempts: true,
      gate: { readyFile, releaseFile, timeoutMs: 20_000 }
    }).then((value) => ({ status: "fulfilled", value }), (error) => ({ status: "rejected", error: errorDetails(error) }));

    let gateInfo;
    let runtimeError;
    let runtimeSideEffect;
    let runtimeElapsedMs;
    let budgetCalls = 0;
    let dispatches;
    let runtimeClaimWhileLocked;
    let ownerLockWhileLocked;
    let ownerOutcome;
    let operationError;
    const originalAuthorize = harness.dependencies.budgetClient.authorize.bind(harness.dependencies.budgetClient);
    harness.dependencies.budgetClient.authorize = async (...args) => {
      budgetCalls += 1;
      return originalAuthorize(...args);
    };
    try {
      gateInfo = JSON.parse(await waitForFile(readyFile, 5_000));
      const startedAt = performance.now();
      try {
        await harness.runtime.submit(envelope(command), MOCK_SCOPE);
      } catch (error) {
        runtimeError = errorDetails(error);
        runtimeSideEffect = error?.sideEffectState;
      }
      runtimeElapsedMs = Number((performance.now() - startedAt).toFixed(3));
      dispatches = harness.simulator.dispatchCounters().submit;
      runtimeClaimWhileLocked = await store.getSubmitAttempt(providerId, MOCK_SCOPE, command.idempotencyKey);
      ownerLockWhileLocked = await readBytesOrMissing(join(directory, ".attempt-store-v1", ".metering-writer.lock"));
    } catch (error) {
      operationError = errorDetails(error);
    } finally {
      await writeFile(releaseFile, "release\n", { mode: 0o600 }).catch(() => undefined);
      ownerOutcome = await ownerRun;
    }
    const runtimeClaimAfterRelease = await store.getSubmitAttempt(providerId, MOCK_SCOPE, command.idempotencyKey)
      .then((record) => ({ record }), (error) => ({ error: errorDetails(error) }));
    const finalState = await captureContentionState(directory, { providerId, scope: MOCK_SCOPE });
    const diagnosticsPath = join(root, "runtime-contention-diagnostics.json");
    const diagnostics = {
      gateInfo,
      operationError,
      runtimeError,
      runtimeSideEffect,
      runtimeElapsedMs,
      budgetCalls,
      submitDispatches: dispatches,
      runtimeClaimWhileLocked,
      runtimeClaimAfterRelease,
      ownerLockWhileLocked: ownerLockWhileLocked === undefined ? undefined : {
        text: ownerLockWhileLocked.toString("utf8"),
        sha256: createHash("sha256").update(ownerLockWhileLocked).digest("hex")
      },
      ownerOutcome,
      reopenedState: finalState
    };
    await persistFixtureDiagnostic(diagnosticsPath, "runtime-contention-diagnostics.json", diagnostics);

    const issues = [];
    if (operationError !== undefined) issues.push(`runtime lock collection failed: ${operationError.code ?? operationError.message}`);
    if (gateInfo?.pid === undefined) issues.push("runtime lock owner did not report its pid");
    if (runtimeError?.code !== "persistence_unavailable") issues.push(`runtime returned ${runtimeError?.code ?? "no error"}`);
    if (runtimeSideEffect !== "not_dispatched") issues.push(`runtime side effect was ${runtimeSideEffect ?? "unknown"}`);
    if (budgetCalls !== 0) issues.push(`budget authorize was called ${budgetCalls} times`);
    if (dispatches !== 0) issues.push(`provider submit dispatched ${dispatches} times`);
    if (runtimeClaimWhileLocked !== undefined) issues.push("runtime claim exists while another child owns the live lock");
    if (ownerLockWhileLocked === undefined || JSON.parse(ownerLockWhileLocked.toString("utf8")).pid !== gateInfo?.pid) {
      issues.push("runtime exhaustion did not preserve the live child lock owner");
    }
    if (ownerOutcome?.status !== "fulfilled" || ownerOutcome.value.code !== 0) issues.push("runtime lock owner did not complete after release");
    if (runtimeClaimAfterRelease?.error !== undefined || runtimeClaimAfterRelease?.record !== undefined) {
      issues.push("runtime created a claim after lock release");
    }
    if (!Array.isArray(finalState.records) || finalState.records.length !== 1 || finalState.records[0]?.claimId !== ownerRecord.claimId) {
      issues.push("reopened runtime store contains an unexpected claim");
    }
    assert.deepEqual(issues, [], `runtime persistence failure evidence: ${diagnosticsPath}`);
  }, { retainOnFailure: true });
});

test("real runtime, simulator, durable metering, and attempt store preserve accepted-timeout ambiguity after restart and key expiry", async () => {
  await withRoot(async (root) => {
    const attemptsDirectory = join(root, "attempts");
    const meteringDirectory = join(root, "metering");
    const first = createMockHarness({
      faults: [{ operation: "submit", kind: "accepted_then_timeout" }],
      quoteTtlMs: 10_000,
      idempotencyTtlMs: 100,
      meteringDirectory
    });
    const firstStore = await attachAttemptStore(first, attemptsDirectory);
    const command = await prepareSubmit(first);
    await expectConnectorError(
      first.runtime.submit(envelope(command), MOCK_SCOPE),
      "ambiguous_submission",
      "possible"
    );
    assert.equal(first.simulator.dispatchCounters().submit, 1);
    assert.equal(first.simulator.orders().length, 1);
    assert.equal(first.simulator.snapshot().billingEvidence[0].charged, false);
    const persisted = await firstStore.getSubmitAttempt(
      first.simulator.adapter.descriptor.providerId,
      MOCK_SCOPE,
      command.idempotencyKey
    );
    assert.equal(persisted?.sideEffectState, "possible");
    assert.equal(persisted?.budgetReservationState, "reserved");
    assert.ok(persisted?.budgetReservationReference);

    const restarted = createMockHarness({
      simulatorSnapshot: first.simulator.snapshot(),
      runtimeStore: first.store,
      meteringDirectory
    });
    const reopenedStore = await attachAttemptStore(restarted, attemptsDirectory);
    const recorder = await restarted.dependencies.metering(MOCK_SCOPE);
    const replay = await recorder.replayPending();
    assert.deepEqual(replay.failures, []);
    const beforeRetry = await recorder.snapshot();
    assert.ok(beforeRetry.outbox.length > 0);
    await expectConnectorError(
      restarted.runtime.submit(envelope({ ...command, requestFingerprint: "sha256:changed-payload" }), MOCK_SCOPE),
      "idempotency_conflict",
      "possible"
    );
    assert.equal(restarted.simulator.dispatchCounters().submit, 1);

    const acceptedGeneration = restarted.simulator.snapshot().idempotencyHistory[0];
    assert.ok(acceptedGeneration !== undefined);
    restarted.simulator.advanceTime(101);
    assert.ok(restarted.simulator.now() > acceptedGeneration.expiresAt);
    const renewedDelivery = { ...command, idempotencyKey: "new-key-after-provider-expiry" };
    await expectConnectorError(
      restarted.runtime.submit(envelope(renewedDelivery), MOCK_SCOPE),
      "ambiguous_submission",
      "possible"
    );
    assert.equal(restarted.simulator.dispatchCounters().submit, 1);
    assert.equal(restarted.simulator.orders().length, 1);
    const afterRetry = await recorder.snapshot();
    assert.equal(afterRetry.outbox.length, beforeRetry.outbox.length);
    const stillHeld = await reopenedStore.getSubmitAttempt(
      restarted.simulator.adapter.descriptor.providerId,
      MOCK_SCOPE,
      command.idempotencyKey
    );
    assert.equal(stillHeld?.sideEffectState, "possible");
    assert.equal(stillHeld?.budgetReservationState, "reserved");
    assert.equal(stillHeld?.budgetReservationReference, persisted?.budgetReservationReference);
    assert.equal(restarted.runtime.audit().liveModeSupported, false);
  });
});

test("child death after an fsynced partial snapshot leaves the prior record intact and allows safe recovery", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const parent = await openAttemptStore(directory);
    const committed = makeAttemptRecord({ idempotencyKey: "committed-before-crash" });
    await parent.claimSubmitAttempt(committed);
    const interrupted = makeAttemptRecord({
      idempotencyKey: "interrupted-before-rename",
      authorizationId: "authorization-interrupted",
      actionId: "action-interrupted"
    });
    const child = await runAttemptChild({ directory, record: interrupted, exitAt: "temporary_file_sync" });
    assert.equal(child.code, 73);
    const reopened = await openAttemptStore(directory);
    assert.deepEqual(
      await reopened.getSubmitAttempt(committed.providerId, ATTEMPT_SCOPE, committed.idempotencyKey),
      committed
    );
    assert.equal(await reopened.getSubmitAttempt(interrupted.providerId, ATTEMPT_SCOPE, interrupted.idempotencyKey), undefined);
    assert.deepEqual(await reopened.claimSubmitAttempt(interrupted), { claimed: true });
    assert.equal((await reopened.listAttempts(ATTEMPT_SCOPE)).length, 2);
    const names = await readdir(join(directory, ".attempt-store-v1"));
    assert.ok(names.some((name) => name.endsWith(".tmp")));
  });
});

test("real child exit after claim commit and while holding a writer lock recover without an expiry lease", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const committed = makeAttemptRecord({ idempotencyKey: "commit-then-process-exit" });
    const exitedAfterCommit = await runAttemptChild({ directory, record: committed, exitAt: "after_claim" });
    assert.equal(exitedAfterCommit.code, 75);
    const reopened = await openAttemptStore(directory);
    assert.equal((await reopened.getSubmitAttempt(committed.providerId, ATTEMPT_SCOPE, committed.idempotencyKey))?.claimId,
      committed.claimId);

    const interrupted = makeAttemptRecord({
      idempotencyKey: "writer-died-before-transaction",
      authorizationId: "authorization-writer-crash",
      actionId: "action-writer-crash"
    });
    const exitedUnderLock = await runAttemptChild({ directory, record: interrupted, exitAt: "writer_lock" });
    assert.equal(exitedUnderLock.code, 74);
    assert.deepEqual(await reopened.claimSubmitAttempt(interrupted), { claimed: true });
    assert.equal((await reopened.listAttempts(ATTEMPT_SCOPE)).length, 2);
  });
});

test("corrupt and unsupported snapshots fail closed without rewriting retained bytes", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const store = await openAttemptStore(directory);
    const record = makeAttemptRecord();
    await store.claimSubmitAttempt(record);
    const statePath = join(directory, ".attempt-store-v1", "metering-state.json");
    const committedBytes = await readFile(statePath);
    await unlink(statePath);
    await expectStoreError(openAttemptStore(directory), "corrupt_state");
    await writeFile(statePath, committedBytes, { mode: 0o600 });
    const corrupt = "{ definitely not json";
    await writeFile(statePath, corrupt, { mode: 0o600 });
    await expectStoreError(openAttemptStore(directory), "corrupt_state");
    assert.equal(await readFile(statePath, "utf8"), corrupt);

    const unsupportedRoot = join(root, "unsupported");
    await mkdir(join(unsupportedRoot, ".attempt-store-v1"), { recursive: true, mode: 0o700 });
    const unsupportedPath = join(unsupportedRoot, ".attempt-store-v1", "metering-state.json");
    const unsupported = JSON.stringify({
      format: "fc-attempt-store/999",
      binding: { providerId: ATTEMPT_PROVIDER, mode: ATTEMPT_MODE, ownerUid: process.getuid?.() ?? null },
      entries: []
    });
    await writeFile(unsupportedPath, unsupported, { mode: 0o600 });
    await expectStoreError(openAttemptStore(unsupportedRoot), "unsupported_version");
    assert.equal(await readFile(unsupportedPath, "utf8"), unsupported);
  });
});

test("initial, intermediate, and final history rows enforce all state-reference biconditionals", async () => {
  await withRoot(async (root) => {
    const violations = [
      {
        name: "confirmed_without_provider_request_id",
        mutate(row) {
          row.sideEffectState = "confirmed";
          row.hasProviderRequestId = false;
        }
      },
      {
        name: "provider_request_id_without_confirmed",
        mutate(row) {
          row.sideEffectState = "possible";
          row.hasProviderRequestId = true;
        }
      },
      {
        name: "reserved_without_reservation_reference",
        mutate(row) {
          row.budgetReservationState = "reserved";
          row.hasBudgetReservationReference = false;
        }
      },
      {
        name: "reservation_reference_without_reserved",
        mutate(row) {
          row.budgetReservationState = "pending";
          row.hasBudgetReservationReference = true;
        }
      }
    ];
    let caseNumber = 0;
    for (const position of [0, 1, 2]) {
      for (const violation of violations) {
        const directory = join(root, "history-case-" + caseNumber);
        caseNumber += 1;
        const store = await openAttemptStore(directory);
        const record = makeAttemptRecord();
        await store.claimSubmitAttempt(record);
        const pending = {
          ...record,
          sideEffectState: "possible",
          budgetReservationState: "pending",
          updatedAt: record.updatedAt + 1
        };
        await store.saveSubmitAttempt(pending);
        await store.saveSubmitAttempt({
          ...pending,
          sideEffectState: "confirmed",
          providerRequestId: "history-provider-request",
          budgetReservationState: "reserved",
          budgetReservationReference: "history-reservation-reference",
          updatedAt: record.updatedAt + 2
        });
        const statePath = join(directory, ".attempt-store-v1", "metering-state.json");
        const state = JSON.parse(await readFile(statePath, "utf8"));
        violation.mutate(state.entries[0].history[position]);
        const corruptBytes = JSON.stringify(state);
        await writeFile(statePath, corruptBytes, { mode: 0o600 });
        await expectStoreError(openAttemptStore(directory), "corrupt_state");
        assert.equal(await readFile(statePath, "utf8"), corruptBytes);
      }
    }
    assert.equal(caseNumber, 12);
  });
});

test("claim and save require exact primitive enum strings before storage mutation", async () => {
  await withRoot(async (root) => {
    const hookCalls = { count: 0 };
    const invalidValues = makeInvalidStateInputs(hookCalls);
    const fields = ["sideEffectState", "budgetReservationState"];
    let caseNumber = 0;
    for (const field of fields) {
      for (const invalid of invalidValues) {
        const claimDirectory = join(root, `invalid-claim-${caseNumber}`);
        const claimStore = await openAttemptStore(claimDirectory);
        const invalidClaim = makeAttemptRecord({
          idempotencyKey: `invalid-claim-key-${caseNumber}`,
          claimId: `invalid-claim-owner-${caseNumber}`,
          authorizationId: `invalid-claim-auth-${caseNumber}`,
          actionId: `invalid-claim-action-${caseNumber}`,
          [field]: invalid.value
        });
        await expectStoreError(claimStore.claimSubmitAttempt(invalidClaim), "invalid_record");
        assert.equal(await claimStore.getSubmitAttempt(
          invalidClaim.providerId,
          ATTEMPT_SCOPE,
          invalidClaim.idempotencyKey
        ), undefined, `${field}: ${invalid.name} claim was not recorded`);
        const claimPaths = statePaths(claimDirectory);
        await expectMissingPath(claimPaths.snapshot);
        await expectMissingPath(claimPaths.marker);
        assert.equal(hookCalls.count, 0, `${field}: ${invalid.name} invoked a coercion hook`);

        const saveDirectory = join(root, `invalid-save-${caseNumber}`);
        const saveStore = await openAttemptStore(saveDirectory);
        const original = makeAttemptRecord({
          idempotencyKey: `invalid-save-key-${caseNumber}`,
          claimId: `invalid-save-owner-${caseNumber}`,
          authorizationId: `invalid-save-auth-${caseNumber}`,
          actionId: `invalid-save-action-${caseNumber}`
        });
        assert.deepEqual(await saveStore.claimSubmitAttempt(original), { claimed: true });
        const savePaths = statePaths(saveDirectory);
        const snapshotBefore = await readFile(savePaths.snapshot);
        const markerBefore = await readFile(savePaths.marker);
        await expectStoreError(saveStore.saveSubmitAttempt({
          ...original,
          [field]: invalid.value,
          updatedAt: original.updatedAt + 1
        }), "invalid_record");
        assert.deepEqual(await readFile(savePaths.snapshot), snapshotBefore, `${field}: ${invalid.name} changed snapshot`);
        assert.deepEqual(await readFile(savePaths.marker), markerBefore, `${field}: ${invalid.name} changed commit marker`);
        assert.deepEqual(
          await saveStore.getSubmitAttempt(original.providerId, ATTEMPT_SCOPE, original.idempotencyKey),
          original
        );
        assert.equal((await saveStore.attemptHistory(ATTEMPT_SCOPE, original.idempotencyKey)).length, 1);
        assert.equal(hookCalls.count, 0, `${field}: ${invalid.name} invoked a coercion hook`);
        caseNumber += 1;
      }
    }
    assert.equal(caseNumber, fields.length * invalidValues.length);
  });
});

test("all valid primitive state enums remain usable in claims, saves, history, and restart", async () => {
  await withRoot(async (root) => {
    const effectStates = ["not_dispatched", "possible", "confirmed", "unknown"];
    const budgetStates = ["not_requested", "pending", "reserved", "denied", "unknown"];
    for (const [index, state] of effectStates.entries()) {
      const directory = join(root, `valid-effect-claim-${index}`);
      const record = makeAttemptRecord({
        idempotencyKey: `valid-effect-key-${index}`,
        claimId: `valid-effect-owner-${index}`,
        authorizationId: `valid-effect-auth-${index}`,
        actionId: `valid-effect-action-${index}`,
        sideEffectState: state,
        ...(state === "confirmed" ? { providerRequestId: "valid-provider-request" } : {})
      });
      assert.deepEqual(await (await openAttemptStore(directory)).claimSubmitAttempt(record), { claimed: true });
      const reopened = await openAttemptStore(directory);
      assert.deepEqual(await reopened.getSubmitAttempt(record.providerId, ATTEMPT_SCOPE, record.idempotencyKey), record);
      assert.equal((await reopened.attemptHistory(ATTEMPT_SCOPE, record.idempotencyKey))[0].sideEffectState, state);
    }
    for (const [index, state] of budgetStates.entries()) {
      const directory = join(root, `valid-budget-claim-${index}`);
      const record = makeAttemptRecord({
        idempotencyKey: `valid-budget-key-${index}`,
        claimId: `valid-budget-owner-${index}`,
        authorizationId: `valid-budget-auth-${index}`,
        actionId: `valid-budget-action-${index}`,
        budgetReservationState: state,
        ...(state === "reserved" ? { budgetReservationReference: "valid-reservation-reference" } : {})
      });
      assert.deepEqual(await (await openAttemptStore(directory)).claimSubmitAttempt(record), { claimed: true });
      const reopened = await openAttemptStore(directory);
      assert.deepEqual(await reopened.getSubmitAttempt(record.providerId, ATTEMPT_SCOPE, record.idempotencyKey), record);
      assert.equal((await reopened.attemptHistory(ATTEMPT_SCOPE, record.idempotencyKey))[0].budgetReservationState, state);
    }

    const effectDirectory = join(root, "valid-effect-history");
    const effectStore = await openAttemptStore(effectDirectory);
    const effectRecord = makeAttemptRecord({
      sideEffectState: "not_dispatched",
      idempotencyKey: "valid-effect-history-key",
      claimId: "valid-effect-history-owner",
      authorizationId: "valid-effect-history-auth",
      actionId: "valid-effect-history-action"
    });
    await effectStore.claimSubmitAttempt(effectRecord);
    const effectUnknown = { ...effectRecord, sideEffectState: "unknown", budgetReservationState: "pending", updatedAt: effectRecord.updatedAt + 1 };
    await effectStore.saveSubmitAttempt(effectUnknown);
    const effectPossible = { ...effectUnknown, sideEffectState: "possible", updatedAt: effectRecord.updatedAt + 2 };
    await effectStore.saveSubmitAttempt(effectPossible);
    const effectConfirmed = {
      ...effectPossible,
      sideEffectState: "confirmed",
      providerRequestId: "valid-effect-history-provider",
      updatedAt: effectRecord.updatedAt + 3
    };
    await effectStore.saveSubmitAttempt(effectConfirmed);
    const effectHistory = await (await openAttemptStore(effectDirectory))
      .attemptHistory(ATTEMPT_SCOPE, effectRecord.idempotencyKey);
    assert.deepEqual(effectHistory.map((row) => row.sideEffectState), [
      "not_dispatched", "unknown", "possible", "confirmed"
    ]);

    for (const [index, terminal] of ["reserved", "denied", "unknown"].entries()) {
      const directory = join(root, `valid-budget-history-${index}`);
      const store = await openAttemptStore(directory);
      const record = makeAttemptRecord({
        idempotencyKey: `valid-budget-history-key-${index}`,
        claimId: `valid-budget-history-owner-${index}`,
        authorizationId: `valid-budget-history-auth-${index}`,
        actionId: `valid-budget-history-action-${index}`
      });
      await store.claimSubmitAttempt(record);
      const pending = { ...record, budgetReservationState: "pending", updatedAt: record.updatedAt + 1 };
      await store.saveSubmitAttempt(pending);
      await store.saveSubmitAttempt({
        ...pending,
        budgetReservationState: terminal,
        ...(terminal === "reserved" ? { budgetReservationReference: "valid-history-reservation" } : {}),
        updatedAt: record.updatedAt + 2
      });
      const history = await (await openAttemptStore(directory)).attemptHistory(ATTEMPT_SCOPE, record.idempotencyKey);
      assert.deepEqual(history.map((row) => row.budgetReservationState), ["not_requested", "pending", terminal]);
    }
  });
});

test("persisted records and every history position reject non-string enums without rewriting bytes", async () => {
  await withRoot(async (root) => {
    const fields = ["sideEffectState", "budgetReservationState"];
    let caseNumber = 0;
    for (const field of fields) {
      for (const invalid of JSON_INVALID_ENUM_VALUES) {
        const directory = join(root, `invalid-record-state-${caseNumber}`);
        const store = await openAttemptStore(directory);
        const record = makeAttemptRecord();
        await store.claimSubmitAttempt(record);
        const paths = statePaths(directory);
        const state = JSON.parse(await readFile(paths.snapshot, "utf8"));
        state.entries[0].record[field] = JSON.parse(JSON.stringify(invalid.value));
        const corruptBytes = JSON.stringify(state);
        await writeFile(paths.snapshot, corruptBytes, { mode: 0o600 });
        const markerBefore = await readFile(paths.marker);
        await expectStoreError(openAttemptStore(directory), "corrupt_state");
        assert.equal(await readFile(paths.snapshot, "utf8"), corruptBytes, `${field} record: ${invalid.name} was rewritten`);
        assert.deepEqual(await readFile(paths.marker), markerBefore, `${field} record: ${invalid.name} changed marker`);
        caseNumber += 1;
      }
      for (const [position, positionName] of [[0, "initial"], [1, "middle"], [2, "final"]]) {
        for (const invalid of JSON_INVALID_ENUM_VALUES) {
          const directory = join(root, `invalid-history-state-${caseNumber}`);
          const store = await openAttemptStore(directory);
          const record = makeAttemptRecord();
          await store.claimSubmitAttempt(record);
          const middle = {
            ...record,
            sideEffectState: "possible",
            budgetReservationState: "pending",
            updatedAt: record.updatedAt + 1
          };
          await store.saveSubmitAttempt(middle);
          await store.saveSubmitAttempt({
            ...middle,
            sideEffectState: "confirmed",
            providerRequestId: "valid-history-provider-request",
            budgetReservationState: "reserved",
            budgetReservationReference: "valid-history-reservation-reference",
            updatedAt: record.updatedAt + 2
          });
          const paths = statePaths(directory);
          const state = JSON.parse(await readFile(paths.snapshot, "utf8"));
          state.entries[0].history[position][field] = JSON.parse(JSON.stringify(invalid.value));
          const corruptBytes = JSON.stringify(state);
          await writeFile(paths.snapshot, corruptBytes, { mode: 0o600 });
          const markerBefore = await readFile(paths.marker);
          await expectStoreError(openAttemptStore(directory), "corrupt_state");
          assert.equal(
            await readFile(paths.snapshot, "utf8"),
            corruptBytes,
            `${field} ${positionName} history: ${invalid.name} was rewritten`
          );
          assert.deepEqual(await readFile(paths.marker), markerBefore, `${field} ${positionName} history: ${invalid.name} changed marker`);
          caseNumber += 1;
        }
      }
    }
    assert.equal(caseNumber, fields.length * JSON_INVALID_ENUM_VALUES.length * 4);
  });
});

test("symlinked roots and state files fail closed without following the external target", async () => {
  const targetRoot = await makePrivateTempDirectory();
  const aliasRoot = join(dirname(targetRoot), "fc-attempt-alias-" + process.pid);
  const externalRoot = await makePrivateTempDirectory();
  const storeRoot = join(targetRoot, "attempts");
  const outsideFile = join(externalRoot, "outside-state.json");
  try {
    await symlink(targetRoot, aliasRoot);
    await expectStoreError(openAttemptStore(aliasRoot), "invalid_path");
    await mkdir(join(storeRoot, ".attempt-store-v1"), { recursive: true, mode: 0o700 });
    const statePath = join(storeRoot, ".attempt-store-v1", "metering-state.json");
    const sentinel = "external state must remain untouched";
    await writeFile(outsideFile, sentinel, { mode: 0o600 });
    await symlink(outsideFile, statePath);
    await expectStoreError(openAttemptStore(storeRoot), "invalid_path");
    assert.equal(await readFile(outsideFile, "utf8"), sentinel);
    assert.equal((await lstat(statePath)).isSymbolicLink(), true);
  } finally {
    await rm(aliasRoot, { force: true });
    await removePrivateTempDirectory(targetRoot);
    await removePrivateTempDirectory(externalRoot);
  }
});

test("read-only storage returns a safe access failure and does not alter an external sentinel", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const outside = join(root, "outside-sentinel.txt");
    const sentinel = "outside the attempt store";
    await writeFile(outside, sentinel, { mode: 0o600 });
    const store = await openAttemptStore(directory);
    const stateDirectory = join(directory, ".attempt-store-v1");
    await chmod(stateDirectory, 0o500);
    const attempt = makeAttemptRecord();
    await expectStoreError(store.claimSubmitAttempt(attempt), "access_denied");
    await chmod(stateDirectory, 0o700);
    assert.equal(await readFile(outside, "utf8"), sentinel);
    assert.equal(await store.getSubmitAttempt(attempt.providerId, ATTEMPT_SCOPE, attempt.idempotencyKey), undefined);
  });
});

test("provider, mode, and tenant partitions are immutable and mismatches fail closed", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const store = await openAttemptStore(directory);
    const record = makeAttemptRecord();
    await store.claimSubmitAttempt(record);
    await expectStoreError(openAttemptStore(directory, { providerId: "another-provider" }), "binding_mismatch");
    await expectStoreError(openAttemptStore(directory, { mode: "sandbox" }), "binding_mismatch");
    await expectStoreError(
      store.getSubmitAttempt("another-provider", ATTEMPT_SCOPE, record.idempotencyKey),
      "binding_mismatch"
    );
    assert.deepEqual(await store.getSubmitAttempt(record.providerId, ATTEMPT_SCOPE, record.idempotencyKey), record);
    const statePath = join(directory, ".attempt-store-v1", "metering-state.json");
    const state = JSON.parse(await readFile(statePath, "utf8"));
    state.binding.ownerUid = (process.getuid?.() ?? 0) + 1;
    await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
    await expectStoreError(openAttemptStore(directory), "binding_mismatch");
  });
});

if (process.argv.includes("--positive-network-control")) {
  await localNetworkPositiveControl();
  process.stdout.write(JSON.stringify({ control: "local_loopback_positive", status: "passed", externalConnections: 0 }) + "\n");
} else if (process.argv.includes("--network-denial-control")) {
  const code = await localSocketError();
  assert.equal(code, "EPERM");
  process.stdout.write(JSON.stringify({ control: "sandbox_network_denial", errorCode: code, status: "passed" }) + "\n");
} else {
  if (process.env.FC_ATTEMPT_EXPECT_NETWORK_DENIAL === "1") {
    test("OS network policy returns EPERM for a real loopback socket attempt", async () => {
      assert.equal(await localSocketError(), "EPERM");
    });
  }
  for (const item of cases) {
    try {
      await item.run();
      item.status = "passed";
    } catch (error) {
      item.status = "failed";
      item.message = error instanceof Error ? error.message : String(error);
    }
  }
  const passed = cases.filter((item) => item.status === "passed").length;
  const failed = cases.length - passed;
  const report = {
    schemaVersion: "fulfillment-attempt-store-suite/1",
    suite: "attempt-store",
    mode: "simulated",
    billing_mode: "simulated",
    externalProviderCalls: 0,
    networkDeniedByOs: process.env.FC_ATTEMPT_EXPECT_NETWORK_DENIAL === "1",
    status: failed === 0 ? "passed" : "failed",
    passed,
    failed,
    results: cases.map(({ name, status, message }) => ({ name, status, ...(message === undefined ? {} : { message }) }))
  };
  process.stdout.write(JSON.stringify(report) + "\n");
  if (failed !== 0) process.exitCode = 1;
}
