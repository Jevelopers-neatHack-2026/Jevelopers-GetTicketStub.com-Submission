import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import {
  HARNESS_TELEMETRY_KEY_NAME,
  TICKETSTUB_EVENT_SPEC,
  TicketstubIntakeError,
  createTicketstubHarnessExporter,
  createTicketstubTokenizer,
  parseHarnessTelemetryKey,
  ticketstubOutboxEntry,
  validateTicketstubEvent
} from '@jevelopers/agent-harness-runtime/ticketstub';
import { NEATLOGS_DELIVERY_QUEUE_LIMITS as NEATLOGS_OUTBOX_LIMITS } from '../../../src/observability/private/neatlogs-delivery-queue.js';
import {
  FAKE_INGEST_KEY,
  FAKE_PROJECT_ID,
  FAKE_READ_TOKEN,
  fakeNeatlogs
} from '../../observability/neatlogs-delivery-queue/fake-neatlogs.js';

const KEY_HEX = '3c'.repeat(32);
const REQUEST_ID = 'req_SYNTHETICcanary01';
const ACTOR_REF = '0123456789abcdef';
const PROJECT_REF = 'fedcba9876543210';

let scratch;
let counter = 0;
before(() => { scratch = mkdtempSync(join(tmpdir(), 'ticketstub-intake-')); });
after(() => rmSync(scratch, { recursive: true, force: true }));

function event(overrides = {}) {
  return {
    schema: 'ticketstub.event/1',
    type: 'art_ready',
    at: 1_760_000_000_000,
    requestId: REQUEST_ID,
    actor: 'account',
    actorRef: ACTOR_REF,
    projectRef: PROJECT_REF,
    mode: 'live',
    fields: { provider: 'live' },
    ...overrides
  };
}

const SAMPLE_FIELDS = {
  intake_submitted: { source: 'link' },
  intake_rejected: { code: 'unreadable_link' },
  research_started: { source: 'ticketmaster', facts: 4 },
  fact_corrected: { fact: '00112233aabbccdd', versions: 2 },
  art_requested: { first: true },
  art_ready: { provider: 'procedural' },
  art_failed: { code: 'provider_timeout' },
  art_limit: { retryAt: 1_760_000_100_000 },
  version_selected: { version: '00112233aabbccdd', versions: 3 },
  share_created: { share: '00112233aabbccdd' },
  share_revoked: { revoked: true },
  gift_created: { share: '00112233aabbccdd', messageChars: 40 },
  order_placed: { order: '00112233aabbccdd', lines: 1, totalMinor: 2500 },
  order_blocked: { code: 'payment_unavailable' },
  signin_link_sent: { reason: 'save', delivery: 'mail' },
  signed_in: { fresh: false },
  claim_redeemed: { status: 'claimed' },
  storage_unavailable: { code: 'sqlite_busy', route: 'api_art' }
};

function env(overrides = {}) {
  return {
    [HARNESS_TELEMETRY_KEY_NAME]: KEY_HEX,
    NEATLOGS_INGEST_KEY: FAKE_INGEST_KEY,
    NEATLOGS_READ_TOKEN: FAKE_READ_TOKEN,
    NEATLOGS_PROJECT_ID: FAKE_PROJECT_ID,
    ...overrides
  };
}

function dbPath() {
  counter += 1;
  return join(scratch, `outbox-${counter}.sqlite`);
}

describe('ticketstub.event/1 contract', () => {
  test('accepts every event type with its own fields', () => {
    assert.deepEqual(Object.keys(SAMPLE_FIELDS).sort(), Object.keys(TICKETSTUB_EVENT_SPEC).sort());
    for (const [type, fields] of Object.entries(SAMPLE_FIELDS)) {
      assert.equal(validateTicketstubEvent(event({ type, fields })).type, type);
    }
    const anonymous = event({ actor: 'anonymous', actorRef: undefined, projectRef: undefined });
    delete anonymous.actorRef;
    delete anonymous.projectRef;
    assert.equal(validateTicketstubEvent(anonymous).actor, 'anonymous');
  });

  test('refuses anything outside the contract instead of repairing it', () => {
    const cases = [
      [event({ schema: 'ticketstub.event/2' }), 'UNSUPPORTED_SCHEMA'],
      [event({ type: 'page_viewed' }), 'INVALID_EVENT'],
      [event({ fields: { provider: 'live', prompt: 'hello' } }), 'INVALID_EVENT'],
      [event({ fields: { provider: 'dall-e' } }), 'INVALID_EVENT'],
      [event({ type: 'art_failed', fields: { code: 'person@example.invalid' } }), 'INVALID_EVENT'],
      [event({ type: 'art_failed', fields: { code: 'a'.repeat(30) } }), 'INVALID_EVENT'],
      [event({ type: 'order_placed', fields: { order: 'ORDER-123', lines: 1, totalMinor: 1 } }), 'INVALID_EVENT'],
      [event({ type: 'order_placed', fields: { order: '00112233aabbccdd', lines: -1, totalMinor: 1 } }), 'INVALID_EVENT'],
      [event({ type: 'fact_corrected', fields: { factId: '00112233aabbccdd', versions: 2 } }), 'INVALID_EVENT'],
      [event({ actor: 'anonymous' }), 'INVALID_EVENT'],
      [event({ actorRef: 'not-a-ref' }), 'INVALID_EVENT'],
      [event({ requestId: 'https://x.invalid/?a=b' }), 'INVALID_EVENT'],
      [event({ mode: 'demo' }), 'INVALID_EVENT'],
      [event({ email: 'person@example.invalid' }), 'INVALID_EVENT'],
      [event({ at: -1 }), 'INVALID_EVENT'],
      [[], 'INVALID_EVENT']
    ];
    for (const [value, code] of cases) {
      assert.throws(() => validateTicketstubEvent(value), error => error instanceof TicketstubIntakeError && error.code === code);
    }
  });

  test('snapshots own data properties and rejects accessors without invoking them', () => {
    let getterCalls = 0;
    const accessorEvent = event();
    Object.defineProperty(accessorEvent, 'requestId', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return REQUEST_ID;
      }
    });
    assert.throws(() => validateTicketstubEvent(accessorEvent), { code: 'INVALID_EVENT' });
    assert.equal(getterCalls, 0);

    const accessorFields = { provider: 'live' };
    Object.defineProperty(accessorFields, 'provider', {
      enumerable: true,
      configurable: true,
      get() {
        getterCalls += 1;
        return 'live';
      }
    });
    assert.throws(() => validateTicketstubEvent(event({ type: 'art_ready', fields: accessorFields })), { code: 'INVALID_EVENT' });
    assert.equal(getterCalls, 0);

    const hostileProxy = new Proxy(event(), { get() { throw new Error('property read must not occur'); } });
    assert.equal(validateTicketstubEvent(hostileProxy).requestId, REQUEST_ID);
    const throwingProxy = new Proxy(event(), { ownKeys() { throw new Error('hostile proxy trap'); } });
    assert.throws(() => validateTicketstubEvent(throwingProxy), { code: 'INVALID_EVENT' });

    const symbolEvent = event();
    symbolEvent[Symbol('hidden')] = 'value';
    assert.throws(() => validateTicketstubEvent(symbolEvent), { code: 'INVALID_EVENT' });
    const nonEnumerableEvent = event();
    Object.defineProperty(nonEnumerableEvent, 'hidden', { value: 'value' });
    assert.throws(() => validateTicketstubEvent(nonEnumerableEvent), { code: 'INVALID_EVENT' });
  });
});

describe('tokenization', () => {
  test('the key must be 32 to 64 bytes of hex', () => {
    for (const bad of [undefined, '', 'zz'.repeat(32), '3c'.repeat(31), '3c'.repeat(65)]) {
      assert.throws(() => parseHarnessTelemetryKey(bad), { code: 'INVALID_TELEMETRY_KEY' });
    }
    assert.equal(parseHarnessTelemetryKey(` ${KEY_HEX} `).length, 32);
  });

  test('exported entries carry tokens, never the request ID or the producer refs', () => {
    const tokenize = createTicketstubTokenizer(parseHarnessTelemetryKey(KEY_HEX));
    const references = [];
    for (const [type, fields] of Object.entries(SAMPLE_FIELDS)) {
      const spec = TICKETSTUB_EVENT_SPEC[type];
      for (const [field, value] of Object.entries(fields)) {
        if (spec[field] === 'ref') references.push({ type, field, value });
      }
    }
    assert.deepEqual(references.map(({ type, field }) => `${type}.${field}`).sort(), [
      'fact_corrected.fact', 'gift_created.share', 'order_placed.order',
      'share_created.share', 'version_selected.version'
    ]);
    const entry = ticketstubOutboxEntry(event({ type: 'fact_corrected', fields: SAMPLE_FIELDS.fact_corrected }), tokenize);
    const text = JSON.stringify(entry);
    for (const raw of [REQUEST_ID, ACTOR_REF, PROJECT_REF, ...references.map(reference => reference.value)]) {
      assert.equal(text.includes(raw), false, `exported entry must not contain ${raw}`);
    }
    const input = JSON.parse(entry.input);
    assert.equal(input.schema, 'agent-harness.ticketstub-intake.v1');
    assert.equal(input.type, 'fact_corrected');
    assert.deepEqual(input.fields, {
      fact: tokenize('ticketstub.ref', 'fact_corrected\u0000fact\u000000112233aabbccdd'),
      versions: 2
    });
    assert.match(input.requestToken, /^tok1_[0-9a-f]{64}$/);
    assert.equal(entry.sessionId, input.projectToken, 'a project groups its events');

    for (const reference of references) {
      const referenceEntry = ticketstubOutboxEntry(event({
        type: reference.type,
        fields: SAMPLE_FIELDS[reference.type]
      }), tokenize);
      const referenceInput = JSON.parse(referenceEntry.input);
      assert.match(referenceInput.fields[reference.field], /^tok1_[0-9a-f]{64}$/);
      assert.equal(JSON.stringify(referenceInput.fields).includes(reference.value), false);
    }
    assert.notEqual(
      tokenize('ticketstub.ref', 'fact_corrected\u0000fact\u000000112233aabbccdd'),
      tokenize('ticketstub.ref', 'share_created\u0000share\u000000112233aabbccdd'),
      'the same reference value has a distinct token in each type/field domain'
    );

    // Stable under one key, unlinkable under another.
    assert.equal(ticketstubOutboxEntry(event({ type: 'fact_corrected', fields: SAMPLE_FIELDS.fact_corrected }), tokenize).eventToken, entry.eventToken);
    const other = createTicketstubTokenizer(parseHarnessTelemetryKey('7d'.repeat(32)));
    assert.notEqual(ticketstubOutboxEntry(event({ type: 'fact_corrected', fields: SAMPLE_FIELDS.fact_corrected }), other).eventToken, entry.eventToken);
  });

  test('without a project, the request groups the events', () => {
    const tokenize = createTicketstubTokenizer(parseHarnessTelemetryKey(KEY_HEX));
    const loose = event();
    delete loose.projectRef;
    const entry = ticketstubOutboxEntry(loose, tokenize);
    assert.equal(entry.sessionId, JSON.parse(entry.input).requestToken);
  });
});

describe('host exporter', () => {
  test('creation refuses missing configuration with a code and no value', () => {
    assert.throws(() => createTicketstubHarnessExporter({ env: env({ [HARNESS_TELEMETRY_KEY_NAME]: '' }), databasePath: dbPath() }),
      { code: 'INVALID_TELEMETRY_KEY' });
    const noIngest = env();
    delete noIngest.NEATLOGS_INGEST_KEY;
    assert.throws(() => createTicketstubHarnessExporter({ env: noIngest, databasePath: dbPath() }), { code: 'MISSING_INGEST_KEY' });
    try {
      createTicketstubHarnessExporter({ env: env({ NEATLOGS_READ_TOKEN: 'bad value with spaces' }), databasePath: dbPath() });
      assert.fail('expected a configuration error');
    } catch (error) {
      assert.equal(error.code, 'INVALID_CREDENTIAL');
      assert.equal(String(error.message).includes('bad value'), false);
    }
  });

  test('accepts, delivers and verifies one request of real-shaped events end to end', async () => {
    const clock = { now: 10_000 };
    const neatlogs = fakeNeatlogs();
    const exporter = createTicketstubHarnessExporter({
      env: env(), databasePath: dbPath(), fetch: neatlogs.fetchImpl, clock: () => clock.now,
      tags: ['ticketstub@abcdef1'], drainDelayMs: 60_000
    });
    try {
      const referenceEvents = Object.entries(TICKETSTUB_EVENT_SPEC).flatMap(([type, spec]) => {
        const fields = SAMPLE_FIELDS[type];
        return Object.entries(fields).some(([field]) => spec[field] === 'ref')
          ? [event({ type, fields })]
          : [];
      });
      const events = [
        event({ type: 'art_requested', fields: { first: true } }),
        event({ type: 'art_ready', fields: { provider: 'live' } }),
        ...referenceEvents,
        event({ type: 'art_ready', fields: { provider: 'live', prompt: 'leak' } })
      ];
      const accepted = exporter.accept(events);
      assert.deepEqual({ ...accepted }, { accepted: 2 + referenceEvents.length, duplicates: 0, refused: 0, invalid: 1 });
      assert.deepEqual({ ...exporter.accept(events.slice(0, 2)) }, { accepted: 0, duplicates: 2, refused: 0, invalid: 0 });

      const first = await exporter.drain();
      assert.equal(first.sent, 2 + referenceEvents.length);
      clock.now += NEATLOGS_OUTBOX_LIMITS.defaults.readbackDelayMs;
      const second = await exporter.drain();
      assert.equal(second.verified, 2 + referenceEvents.length);

      const status = exporter.status();
      assert.equal(status.outbox.counts.verified, 2 + referenceEvents.length);
      assert.equal(status.counters.invalid, 1);
      const traces = [...neatlogs.stored.values()];
      assert.equal(traces.length, 2 + referenceEvents.length);
      for (const trace of traces) {
        assert.equal(trace.workflowName, 'agent-harness.ticketstub-events');
        assert.deepEqual(trace.tags, ['ticketstub', 'ticketstub@abcdef1']);
        assert.equal(trace.attributes['agent_harness.source'], 'ticketstub');
      }
      assert.equal(new Set(traces.map(trace => trace.sessionId)).size, 1, 'one project, one session');
      const wire = Buffer.concat(neatlogs.bodies).toString('latin1');
      const rawFieldRefs = referenceEvents.flatMap(reference => Object.entries(reference.fields)
        .filter(([field]) => TICKETSTUB_EVENT_SPEC[reference.type][field] === 'ref')
        .map(([, value]) => value));
      for (const raw of [REQUEST_ID, ACTOR_REF, PROJECT_REF, ...rawFieldRefs, 'leak', FAKE_INGEST_KEY, KEY_HEX]) {
        assert.equal(wire.includes(raw), false, `wire body must not contain ${raw.slice(0, 8)}…`);
      }
      for (const trace of traces) {
        for (const raw of rawFieldRefs) assert.equal(trace.input.includes(raw), false);
      }
      assert.equal(JSON.stringify(status).includes(KEY_HEX), false);
      assert.equal(JSON.stringify(exporter.summary).includes(FAKE_INGEST_KEY), false);
    } finally {
      await exporter.close();
    }
    assert.throws(() => exporter.accept([event()]), { code: 'CLOSED' });
  });

  test('a scheduled drain runs on its own and never throws into the host', async () => {
    const neatlogs = fakeNeatlogs({ ingestStatus: () => 500 });
    const exporter = createTicketstubHarnessExporter({
      env: env(), databasePath: dbPath(), fetch: neatlogs.fetchImpl, drainDelayMs: 0
    });
    try {
      exporter.accept([event()]);
      for (let i = 0; i < 250 && exporter.status().counters.drains === 0; i += 1) {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      const status = exporter.status();
      assert.equal(status.counters.drains, 1);
      assert.equal(status.lastDrain.sendStatus, 'outcome_unknown');
      assert.equal(status.outbox.counts.queued, 1, 'kept for a later retry');
    } finally {
      await exporter.close();
    }
  });
});
