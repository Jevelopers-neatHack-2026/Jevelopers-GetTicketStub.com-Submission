import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  createProjectedStoreEvents,
  createTemporaryDirectory,
  readJson,
  spawnNodeFixture,
  SYNTHETIC_CANARIES,
  writeRecords
} from './helpers.js';

async function waitForPath(path, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error('The isolated child did not reach its crash barrier.');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

test('killing preparation before and after capture leaves workflow events and the telemetry cursor replayable', async t => {
  const temporary = createTemporaryDirectory();
  t.after(() => temporary.cleanup());
  const { store, records, rawEventCount } = createProjectedStoreEvents(join(temporary.directory, 'workflow.sqlite'));
  t.after(() => store.close());
  const recordsPath = writeRecords(temporary.directory, records);
  const outboxBefore = store.readOutbox();
  assert.equal(store.getTelemetryCursor(), 0);
  assert.equal(outboxBefore.length, rawEventCount);

  for (const phase of ['before', 'after']) {
    const readyPath = join(temporary.directory, `${phase}.ready`);
    const outputPath = join(temporary.directory, `${phase}.capture.json`);
    const child = spawnNodeFixture('restart-capture-child.mjs', [
      phase, recordsPath, readyPath, outputPath
    ], { timeoutMs: 15_000 });
    await waitForPath(readyPath);
    child.child.kill('SIGKILL');
    const execution = await child.done;
    assert.equal(execution.signal, 'SIGKILL');
    for (const canary of SYNTHETIC_CANARIES) {
      assert.equal(execution.stdout.includes(canary), false);
      assert.equal(execution.stderr.includes(canary), false);
    }
    if (phase === 'before') {
      assert.equal(existsSync(outputPath), false);
    } else {
      assert.equal(existsSync(outputPath), true);
      const captured = readJson(outputPath);
      assert.equal(captured.mode, 'offline-synthetic-real-sdk');
      assert.equal(captured.remoteIngestionVerified, false);
      assert.equal(captured.sponsorAcceptance, false);
      assert.equal(captured.entireEnabled, false);
      assert.equal(captured.telemetryCursorAdvanced, false);
      assert.equal(captured.financeAcknowledgement, false);
      const serialized = JSON.stringify(captured);
      for (const canary of SYNTHETIC_CANARIES) assert.equal(serialized.includes(canary), false);
    }
    assert.equal(store.getTelemetryCursor(), 0);
    assert.equal(store.readEventPage({ afterSequence: 0, limit: 32 }).events.length, rawEventCount);
    assert.deepEqual(store.readOutbox(), outboxBefore);
  }
});
