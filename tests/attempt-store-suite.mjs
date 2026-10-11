import assert from "node:assert/strict";
import { chmod, lstat, mkdir, readFile, readdir, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createConnection, createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DurableJsonStore } from "../dist/metering-store.js";
import { AttemptStoreError, createLocalAttemptPersistence } from "../dist/attempt-store.js";
import { ConnectorError } from "../dist/index.js";
import {
  ATTEMPT_MODE,
  ATTEMPT_PROVIDER,
  ATTEMPT_SCOPE,
  makeAttemptRecord,
  makePrivateTempDirectory,
  openAttemptStore,
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

async function withRoot(run) {
  const root = await makePrivateTempDirectory();
  try {
    await run(root);
  } finally {
    await removePrivateTempDirectory(root);
  }
}

async function expectStoreError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.ok(error instanceof AttemptStoreError || error?.code === code);
    assert.equal(error.code, code);
    return true;
  });
}

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
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      runAttemptChild({
        directory,
        record: { ...record, claimId: "parallel-same-key-" + index }
      })
    ));
    assert.ok(results.every((result) => result.code === 0), JSON.stringify(results.map((row) => row.stderr)));
    const outcomes = results.map((result) => JSON.parse(result.stdout.trim()));
    assert.equal(outcomes.filter((result) => result.claimed).length, 1);
    assert.equal(outcomes.filter((result) => !result.claimed).length, 19);
    const store = await openAttemptStore(directory);
    assert.equal((await store.listAttempts(ATTEMPT_SCOPE)).length, 1);
  });
});

test("twenty distinct delivery keys cannot race the same authorization or action", async () => {
  await withRoot(async (root) => {
    const directory = join(root, "attempts");
    const base = makeAttemptRecord();
    const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
      runAttemptChild({
        directory,
        record: {
          ...base,
          idempotencyKey: "parallel-key-" + index,
          claimId: "parallel-action-" + index
        }
      })
    ));
    assert.ok(results.every((result) => result.code === 0), JSON.stringify(results.map((row) => row.stderr)));
    const outcomes = results.map((result) => JSON.parse(result.stdout.trim()));
    assert.equal(outcomes.filter((result) => result.claimed).length, 1);
    assert.equal(outcomes.filter((result) => !result.claimed).length, 19);
    const store = await openAttemptStore(directory);
    assert.equal((await store.listAttempts(ATTEMPT_SCOPE)).length, 1);
  });
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
      const results = await Promise.all(Array.from({ length: 20 }, (_, index) =>
        runAttemptChild({ directory, record: dimension.recordAt(index, base) })
      ));
      assert.ok(results.every((result) => result.code === 0), JSON.stringify(results.map((row) => row.stderr)));
      const outcomes = results.map((result) => JSON.parse(result.stdout.trim()));
      assert.equal(outcomes.filter((result) => result.claimed).length, 1, dimension.name);
      assert.equal(outcomes.filter((result) => !result.claimed).length, 19, dimension.name);
      const reopened = await openAttemptStore(directory);
      assert.equal((await reopened.listAttempts(ATTEMPT_SCOPE)).length, 1, dimension.name);
    }
  });
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
