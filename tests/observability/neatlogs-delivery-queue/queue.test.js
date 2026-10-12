import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { after, before, describe, test } from 'node:test';
import { loadNeatlogsConfig } from '../../../src/observability/private/neatlogs-config.js';
import { deterministicNeatlogsIds } from '../../../src/observability/private/neatlogs-otlp.js';
import {
  NEATLOGS_DELIVERY_QUEUE_LIMITS as NEATLOGS_OUTBOX_LIMITS,
  NeatlogsDeliveryQueue as NeatlogsOutbox,
  NeatlogsDeliveryQueueError as NeatlogsOutboxError,
  drainNeatlogsDeliveryQueue as drainNeatlogsOutbox,
  validateNeatlogsQueueEntry as validateNeatlogsOutboxEntry
} from '../../../src/observability/private/neatlogs-delivery-queue.js';
import { FAKE_INGEST_KEY, FAKE_PROJECT_ID, FAKE_READ_TOKEN, fakeNeatlogs } from './fake-neatlogs.js';

const CANARY = 'SYNTHETIC_QUEUE_CANARY_person@example.invalid';
const token = n => `tok1_${n.toString(16).padStart(64, '0')}`;

let scratch;
let counter = 0;
before(() => { scratch = mkdtempSync(join(tmpdir(), 'neatlogs-delivery-queue-')); });
after(() => rmSync(scratch, { recursive: true, force: true }));

function dbPath() {
  counter += 1;
  return join(scratch, `outbox-${counter}.sqlite`);
}

function config({ readback = true } = {}) {
  return loadNeatlogsConfig({
    env: {
      NEATLOGS_API_KEY: FAKE_INGEST_KEY,
      ...(readback ? { NEATLOGS_TOKEN: FAKE_READ_TOKEN, NEATLOGS_PROJECT_ID: FAKE_PROJECT_ID } : {})
    }
  });
}

function entry(n, overrides = {}) {
  return {
    eventToken: token(n),
    workflowName: 'agent-harness.ticketstub-events',
    sessionId: token(1000 + n),
    eventType: 'art_ready',
    input: JSON.stringify({ n }),
    attributes: [['agent_harness.source', 'ticketstub'], ['ticketstub.event_type', 'art_ready']],
    occurredAtMs: 1_000 + n,
    ...overrides
  };
}

function clockAt(start) {
  const clock = { now: start };
  clock.fn = () => clock.now;
  return clock;
}

const noSleep = async () => true;

describe('entries', () => {
  test('refuses reserved, malformed or oversized content', () => {
    for (const bad of [
      entry(1, { eventToken: 'raw-id' }),
      entry(1, { sessionId: CANARY }),
      entry(1, { workflowName: 'other' }),
      entry(1, { eventType: 'Bad Type' }),
      entry(1, { input: 'not json' }),
      entry(1, { input: JSON.stringify({ x: 'y'.repeat(NEATLOGS_OUTBOX_LIMITS.maxInputBytes) }) }),
      entry(1, { attributes: [['neatlogs.session.id', 'x']] }),
      entry(1, { attributes: [['agent_harness.source', 'a'], ['agent_harness.source', 'b']] }),
      entry(1, { attributes: [['agent_harness.value', -1]] }),
      entry(1, { attributes: [['agent_harness.value', 'x'.repeat(300)]] }),
      entry(1, { occurredAtMs: 0 })
    ]) {
      assert.throws(() => validateNeatlogsOutboxEntry(bad), NeatlogsOutboxError);
    }
    assert.equal(validateNeatlogsOutboxEntry(entry(1)).eventToken, token(1));
  });

  test('requires a file-backed database', () => {
    assert.throws(() => NeatlogsOutbox.open({ databasePath: ':memory:' }), { code: 'DURABILITY_REQUIRES_FILE' });
  });

  test('enqueue is idempotent by event token and bounded', () => {
    const outbox = NeatlogsOutbox.open({ databasePath: dbPath(), maxUnsettled: 2 });
    try {
      assert.deepEqual({ ...outbox.enqueue([entry(1), entry(1)]) }, { accepted: 1, duplicates: 1, refused: 0 });
      assert.deepEqual({ ...outbox.enqueue([entry(1), entry(2), entry(3)]) }, { accepted: 1, duplicates: 1, refused: 1 });
      assert.equal(outbox.diagnostics().counts.queued, 2);
    } finally {
      outbox.close();
    }
  });

  test('refuses a database written by a newer schema', () => {
    const path = dbPath();
    NeatlogsOutbox.open({ databasePath: path }).close();
    const raw = new DatabaseSync(path);
    raw.prepare("UPDATE neatlogs_delivery_queue_meta SET value = '99' WHERE key = 'schema_version'").run();
    raw.close();
    assert.throws(() => NeatlogsOutbox.open({ databasePath: path }), { code: 'UNSUPPORTED_SCHEMA_VERSION' });
  });
});

describe('drain', () => {
  test('sends, records acceptance as sent, then verifies by readback', async () => {
    const clock = clockAt(10_000);
    const outbox = NeatlogsOutbox.open({ databasePath: dbPath(), clock: clock.fn });
    const neatlogs = fakeNeatlogs();
    try {
      outbox.enqueue([entry(1), entry(2)]);
      const first = await drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep, tags: ['evidence:synthetic'] });
      assert.equal(first.sent, 2);
      assert.equal(first.sendRequests, 1);
      assert.equal(first.verified, 0, 'readback waits for the readback delay');
      assert.equal(outbox.diagnostics().counts.sent, 2);

      clock.now += NEATLOGS_OUTBOX_LIMITS.defaults.readbackDelayMs;
      const second = await drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep, tags: ['evidence:synthetic'] });
      assert.equal(second.verified, 2);
      assert.equal(second.readbackStatus, 'verified');
      const { counts, latest } = outbox.diagnostics();
      assert.equal(counts.verified, 2);
      assert.equal(latest[0].traceId, deterministicNeatlogsIds(token(2)).traceId);

      const stored = neatlogs.stored.get(deterministicNeatlogsIds(token(1)).traceId);
      assert.equal(stored.workflowName, 'agent-harness.ticketstub-events');
      assert.equal(stored.input, JSON.stringify({ n: 1 }));
      assert.equal(stored.attributes['ticketstub.event_type'], 'art_ready');
      assert.deepEqual(stored.tags, ['evidence:synthetic']);
      const ingest = neatlogs.calls.find(call => call.path === '/v1/traces');
      assert.equal(ingest.headers['x-api-key'], FAKE_INGEST_KEY);
    } finally {
      outbox.close();
    }
  });

  test('without a readback token, rows stay sent and are never claimed as delivered', async () => {
    const clock = clockAt(10_000);
    const outbox = NeatlogsOutbox.open({ databasePath: dbPath(), clock: clock.fn });
    const neatlogs = fakeNeatlogs();
    try {
      outbox.enqueue([entry(1)]);
      await drainNeatlogsOutbox(outbox, config({ readback: false }), { fetch: neatlogs.fetchImpl, sleep: noSleep });
      clock.now += 3_600_000;
      const result = await drainNeatlogsOutbox(outbox, config({ readback: false }), { fetch: neatlogs.fetchImpl, sleep: noSleep });
      assert.equal(result.readbackStatus, null);
      assert.equal(outbox.diagnostics().counts.sent, 1);
      assert.equal(outbox.diagnostics().counts.verified, 0);
    } finally {
      outbox.close();
    }
  });

  test('a lost first delivery waits out the window, then moves to the next generation and verifies', async () => {
    const clock = clockAt(10_000);
    const outbox = NeatlogsOutbox.open({ databasePath: dbPath(), clock: clock.fn });
    const lostId = deterministicNeatlogsIds(token(7)).traceId;
    const neatlogs = fakeNeatlogs({ loseFirstDelivery: [lostId] });
    const drain = () => drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep });
    try {
      outbox.enqueue([entry(7)]);
      await drain();
      clock.now += NEATLOGS_OUTBOX_LIMITS.defaults.readbackDelayMs;
      const early = await drain();
      assert.equal(early.waiting, 1, 'not yet past the missing window');
      assert.equal(outbox.diagnostics().counts.sent, 1);

      clock.now += NEATLOGS_OUTBOX_LIMITS.defaults.missingAfterMs;
      const regenerated = await drain();
      assert.equal(regenerated.regenerated, 1);
      assert.equal(regenerated.sent, 1, 'the next generation is sent in the same pass');
      const nextId = deterministicNeatlogsIds(token(7), 1).traceId;
      assert.equal(outbox.diagnostics().latest[0].traceId, nextId);
      assert.equal(outbox.diagnostics().latest[0].generation, 1);

      clock.now += NEATLOGS_OUTBOX_LIMITS.defaults.readbackDelayMs;
      const verified = await drain();
      assert.equal(verified.verified, 1);
      assert.deepEqual([...outbox.diagnostics().latest[0].duplicateTraceIds], []);
      assert.ok(neatlogs.stored.has(nextId));
      assert.equal(neatlogs.stored.has(lostId), false);
    } finally {
      outbox.close();
    }
  });

  test('a trace missing after the last generation is settled as failed', async () => {
    const clock = clockAt(10_000);
    const outbox = NeatlogsOutbox.open({ databasePath: dbPath(), clock: clock.fn });
    const ids = [0, 1, 2, 3].map(g => deterministicNeatlogsIds(token(9), g).traceId);
    const neatlogs = fakeNeatlogs({ loseFirstDelivery: ids });
    try {
      outbox.enqueue([entry(9)]);
      for (let round = 0; round < 6; round += 1) {
        await drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep });
        clock.now += NEATLOGS_OUTBOX_LIMITS.defaults.missingAfterMs + NEATLOGS_OUTBOX_LIMITS.defaults.readbackDelayMs;
      }
      const [row] = outbox.diagnostics().latest;
      assert.equal(row.state, 'failed');
      assert.equal(row.lastReason, 'MISSING_AFTER_LAST_GENERATION');
      assert.equal(row.generation, 3);
    } finally {
      outbox.close();
    }
  });

  test('an unknown outcome is retried with backoff and gives up after the attempt limit', async () => {
    const clock = clockAt(10_000);
    const outbox = NeatlogsOutbox.open({ databasePath: dbPath(), clock: clock.fn });
    const neatlogs = fakeNeatlogs({ ingestStatus: () => 503 });
    try {
      outbox.enqueue([entry(3)]);
      const first = await drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep });
      assert.equal(first.retried, 1);
      assert.equal(first.sendStatus, 'outcome_unknown');
      const again = await drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep });
      assert.equal(again.sendRequests, 0, 'backoff holds the row until it is due');
      for (let round = 0; round < NEATLOGS_OUTBOX_LIMITS.maxSendAttempts; round += 1) {
        clock.now += NEATLOGS_OUTBOX_LIMITS.defaults.retryMaxMs;
        await drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep });
      }
      const [row] = outbox.diagnostics().latest;
      assert.equal(row.state, 'failed');
      assert.equal(row.lastStatus, 'outcome_unknown');
    } finally {
      outbox.close();
    }
  });

  test('a readback mismatch settles the row as failed', async () => {
    const clock = clockAt(10_000);
    const outbox = NeatlogsOutbox.open({ databasePath: dbPath(), clock: clock.fn });
    const neatlogs = fakeNeatlogs();
    try {
      outbox.enqueue([entry(4)]);
      await drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep });
      neatlogs.stored.get(deterministicNeatlogsIds(token(4)).traceId).input = '{"altered":true}';
      clock.now += NEATLOGS_OUTBOX_LIMITS.defaults.readbackDelayMs;
      const result = await drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep });
      assert.equal(result.failed, 1);
      assert.equal(outbox.diagnostics().latest[0].lastReason, 'INPUT_PAYLOAD_MISMATCH');
    } finally {
      outbox.close();
    }
  });

  test('a held drain lease keeps a second drain from sending', async () => {
    const path = dbPath();
    const a = NeatlogsOutbox.open({ databasePath: path });
    const b = NeatlogsOutbox.open({ databasePath: path });
    const neatlogs = fakeNeatlogs();
    try {
      a.enqueue([entry(5)]);
      assert.equal(a.acquireDrainLease('owner-a'), true);
      const blocked = await drainNeatlogsOutbox(b, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep, ownerId: 'owner-b' });
      assert.equal(blocked.leased, false);
      assert.equal(neatlogs.calls.length, 0);
      a.releaseDrainLease('owner-a');
      const sent = await drainNeatlogsOutbox(b, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep, ownerId: 'owner-b' });
      assert.equal(sent.sent, 1);
    } finally {
      a.close();
      b.close();
    }
  });

  test('settled rows are pruned after retention', async () => {
    const clock = clockAt(10_000);
    const outbox = NeatlogsOutbox.open({ databasePath: dbPath(), clock: clock.fn });
    const neatlogs = fakeNeatlogs();
    try {
      outbox.enqueue([entry(6)]);
      await drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep });
      clock.now += NEATLOGS_OUTBOX_LIMITS.defaults.readbackDelayMs;
      await drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep });
      clock.now += NEATLOGS_OUTBOX_LIMITS.defaults.retentionMs + 1;
      const result = await drainNeatlogsOutbox(outbox, config(), { fetch: neatlogs.fetchImpl, sleep: noSleep });
      assert.equal(result.pruned, 1);
      assert.equal(outbox.diagnostics().counts.verified, 0);
    } finally {
      outbox.close();
    }
  });
});
