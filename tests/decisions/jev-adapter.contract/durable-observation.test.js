import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import https from 'node:https';
import { Resolver } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import './network-guard.js';
import {
  DurableWorkflowStore,
  INTERNAL_SCHEMA_VERSION,
  RuntimeError,
  projectTelemetryEvent
} from '@jevelopers/agent-harness-runtime';
import { sendJevOnce } from '../../../src/adapters/jev/http-transport.js';
import { temporaryDatabase, spawnFixture } from '../../runtime/helpers.js';
import { runPrivateJevTestAttempt } from './private-orchestrator.js';
import { recordSyntheticMetric } from './synthetic-metrics.js';

const API_KEY_FIXTURE = 'synthetic-offline-key';
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_REQUEST_AND_ERROR_CANARY';

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../../fixtures/jev/${name}`, import.meta.url), 'utf8'));
}

function fixtureBytes(name) {
  return readFileSync(new URL(`../../fixtures/jev/${name}`, import.meta.url));
}

function openStore(databasePath, clock = () => 1000) {
  let sequence = 0;
  return DurableWorkflowStore.open({
    databasePath,
    clock,
    idFactory: () => `jev-test-generated-${++sequence}`
  });
}

function createRunningWorkflow(store, workflowId, ttlMs = 1000) {
  store.createWorkflow({
    workflowId,
    checkpoint: { step: 'before-private-test-send', privateMarker: PRIVATE_MARKER },
    eventId: `${workflowId}:created`
  });
  const lease = store.acquireLease({
    workflowId,
    ownerId: `${workflowId}-worker`,
    ttlMs,
    eventId: `${workflowId}:lease`
  });
  const running = store.transitionWorkflow({
    ...lease,
    expectedRevision: lease.revision,
    toState: 'running',
    eventId: `${workflowId}:running`
  });
  return { ...lease, revision: running.revision };
}

function intentInput(lease, attemptId, transportAttemptId = `transport-${attemptId}`) {
  return {
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence,
    expectedRevision: lease.revision,
    attemptId,
    logicalOperationRef: `logical-${attemptId}`,
    authorityHoldRef: `synthetic-local-bookkeeping:hold-${attemptId}`,
    transportAttemptId
  };
}

function setupAttempt(store, lease, attemptId, transportAttemptId = `transport-${attemptId}`) {
  const intent = store.recordDispatchIntent({
    ...intentInput(lease, attemptId, transportAttemptId),
    eventId: `intent-${attemptId}`
  });
  return {
    intent,
    marker: store.recordJevDispatchMarker({
      workflowId: lease.workflowId,
      ownerId: lease.ownerId,
      fence: lease.fence,
      expectedRevision: intent.revision,
      attemptId,
      transportAttemptId
    }),
    logicalOperationRef: `logical-${attemptId}`,
    transportAttemptId,
    attemptId,
    workflowId: lease.workflowId
  };
}

function observation(identity, fields = {}) {
  return {
    workflowId: identity.workflowId,
    logicalOperationRef: identity.logicalOperationRef,
    attemptId: identity.attemptId,
    transportAttemptId: identity.transportAttemptId,
    sourceObservationRef: fields.sourceObservationRef ?? `source-${identity.attemptId}`,
    dispatchCertainty: fields.dispatchCertainty ?? 'response_received',
    requestedModel: 'jev-1.13.0',
    resolvedModel: Object.hasOwn(fields, 'resolvedModel') ? fields.resolvedModel : 'jev-1.13.0',
    providerRequestId: fields.providerRequestId ?? null,
    decisionConformance: fields.decisionConformance ?? 'invalid',
    usage: fields.usage ?? { kind: 'known', inputTokens: 83, outputTokens: 19 }
  };
}

function controlledTransport(t, { status = 200, body = fixtureBytes('positive-response.json'), headers = {} } = {}) {
  const calls = { resolve4: 0, resolve6: 0, requests: 0, writes: 0 };
  t.mock.method(Resolver.prototype, 'resolve4', host => {
    assert.equal(host, 'api.typesafe.ai');
    calls.resolve4 += 1;
    recordSyntheticMetric('controlled_dns_resolve4');
    return Promise.resolve(['93.184.216.34']);
  });
  t.mock.method(Resolver.prototype, 'resolve6', host => {
    assert.equal(host, 'api.typesafe.ai');
    calls.resolve6 += 1;
    recordSyntheticMetric('controlled_dns_resolve6');
    return Promise.resolve([]);
  });
  t.mock.method(https, 'request', (options, callback) => {
    calls.requests += 1;
    recordSyntheticMetric('controlled_https_request');
    assert.equal(options.protocol, 'https:');
    assert.equal(options.hostname, 'api.typesafe.ai');
    assert.equal(options.port, 443);
    assert.equal(options.path, '/v1/systemone');
    assert.equal(options.method, 'POST');
    const request = new EventEmitter();
    request.destroyed = false;
    request.destroy = () => { request.destroyed = true; };
    request.end = () => {
      calls.writes += 1;
      recordSyntheticMetric('controlled_https_write');
      const response = new EventEmitter();
      response.statusCode = status;
      response.headers = Object.assign(Object.create(null), {
        'content-type': 'application/json',
        'content-length': String(body.length),
        ...headers
      });
      response.rawHeaders = Object.entries(response.headers).flatMap(([key, value]) => [key, value]);
      setImmediate(() => {
        callback(response);
        if (body.length > 0) response.emit('data', Buffer.from(body));
        response.emit('end');
      });
      return request;
    };
    const socket = new EventEmitter();
    socket.encrypted = true;
    socket.authorized = false;
    socket.secureConnecting = true;
    socket.destroyed = false;
    socket.destroy = () => { socket.destroyed = true; };
    setImmediate(() => {
      request.emit('socket', socket);
      socket.secureConnecting = false;
      socket.authorized = true;
      socket.emit('secureConnect');
    });
    return request;
  });
  return calls;
}

async function runControlled(store, lease, attemptId, transport, overrides = {}) {
  const input = intentInput(lease, attemptId, transport);
  return runPrivateJevTestAttempt({
    store,
    ...input,
    request: fixture('positive-request.json'),
    apiKey: API_KEY_FIXTURE,
    testOnlySend: ({ request, apiKey }) => sendJevOnce({ request, apiKey }),
    ...overrides
  });
}

function fixturePath(name) {
  return new URL(`./fixtures/${name}`, import.meta.url).pathname;
}

function spawnCrashFixture(scriptPath, args) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    stdio: 'ignore'
  });
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  return { done };
}

function countRows(databasePath, table) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
  } finally {
    database.close();
  }
}

function sqliteSnapshot(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const normalize = value => value instanceof Uint8Array
      ? { bytesHex: Buffer.from(value).toString('hex') }
      : typeof value === 'bigint'
        ? value.toString()
        : value;
    const objects = database.prepare(`
      SELECT type, name, tbl_name, sql FROM sqlite_master
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name
    `).all();
    const tableNames = database.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name
    `).all().map(row => row.name);
    const tables = Object.create(null);
    for (const name of tableNames) {
      const quoted = '"' + name.replaceAll('"', '""') + '"';
      const rows = database.prepare(`SELECT * FROM ${quoted}`).all().map(row => {
        const normalized = Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalize(value)]));
        return { encoded: JSON.stringify(normalized), row: normalized };
      }).sort((left, right) => left.encoded.localeCompare(right.encoded)).map(item => item.row);
      tables[name] = rows;
    }
    return {
      userVersion: Number(database.prepare('PRAGMA user_version').get().user_version),
      objects,
      tables
    };
  } finally {
    database.close();
  }
}

function removeV5Tables(database) {
  database.exec(`
    DROP TABLE jev_local_observation_outbox;
    DROP TABLE jev_provider_observations;
    DROP TABLE jev_dispatch_markers;
  `);
}

test('durable_evidence: valid synthetic transport persists intent, marker, usage, event, and local outbox without decision promotion', async t => {
  const temporary = temporaryDatabase('jev-durable-valid-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'jev-valid-run');
  const initialCheckpoint = store.getCheckpoint(lease.workflowId);
  const calls = controlledTransport(t);

  const result = await runControlled(store, lease, 'jev-valid-attempt', 'jev-valid-transport');
  assert.equal(result.dispatched, true);
  assert.equal(result.transportResult.kind, 'response');
  assert.equal(result.transportResult.validation.kind, 'valid');
  assert.equal(result.observation.usage.kind, 'known');
  assert.equal(result.persistedObservation.duplicate, false);
  assert.equal(calls.requests, 1);
  assert.equal(calls.writes, 1);
  assert.deepEqual(calls, { resolve4: 1, resolve6: 1, requests: 1, writes: 1 });

  const stored = store.getJevProviderObservation(result.observation.sourceObservationRef);
  assert.deepEqual(stored.usage, { kind: 'known', inputTokens: 83, outputTokens: 19 });
  assert.equal(stored.workflowId, lease.workflowId);
  assert.equal(stored.logicalOperationRef, 'logical-jev-valid-attempt');
  assert.equal(stored.attemptId, 'jev-valid-attempt');
  assert.equal(stored.transportAttemptId, 'jev-valid-transport');
  assert.equal(stored.requestedModel, 'jev-1.13.0');
  assert.equal(stored.resolvedModel, 'jev-1.13.0');
  assert.equal(store.getAttempt('jev-valid-attempt').state, 'intent');
  assert.equal(store.getAttempt('jev-valid-attempt').authorityHoldRef, 'synthetic-local-bookkeeping:hold-jev-valid-attempt');
  assert.deepEqual(store.getWorkflow(lease.workflowId), {
    workflowId: lease.workflowId,
    state: 'awaiting_response',
    revision: result.intent.revision,
    fence: lease.fence,
    leaseOwner: lease.ownerId,
    leaseExpiresAtMs: lease.expiresAtMs,
    cancellationRequested: false,
    checkpointSequence: 1
  });
  assert.deepEqual(store.getCheckpoint(lease.workflowId), initialCheckpoint);
  assert.throws(() => store.getReceipt('jev-valid-attempt'), error => error.code === 'ATTEMPT_NOT_FOUND');

  const events = store.listEvents({ workflowId: lease.workflowId });
  assert.deepEqual(events.slice(-3).map(event => event.type), [
    'dispatch_intent_persisted',
    'jev_dispatch_may_have_started',
    'jev_local_observation_recorded'
  ]);
  assert.ok(events.at(-3).sequence < events.at(-2).sequence);
  assert.ok(events.at(-2).sequence < events.at(-1).sequence);
  const page = store.readJevObservationDeliveryPage({ afterSequence: 0, limit: 1 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].deliveryIntent, 'local_only_not_finance_acceptance');
  assert.equal(page.items[0].eventId, result.persistedObservation.eventId);
  assert.equal(page.items[0].usage.kind, 'known');
  assert.doesNotMatch(JSON.stringify(page), new RegExp(`${PRIVATE_MARKER}|${API_KEY_FIXTURE}|synthetic-local-bookkeeping`));

  const pageEventId = page.items[0].eventId;
  assert.deepEqual(store.acknowledgeJevObservationDelivery(pageEventId), {
    acknowledged: true, duplicate: false
  });
  assert.deepEqual(store.acknowledgeJevObservationDelivery(pageEventId), {
    acknowledged: true, duplicate: true
  });
  assert.equal(calls.requests, 1);
  assert.equal(calls.writes, 1);
  assert.doesNotMatch(JSON.stringify(result), /synthetic-offline-key|answers|private response/u);

  let tokenizeCalls = 0;
  assert.throws(() => projectTelemetryEvent(events.at(-1), () => {
    tokenizeCalls += 1;
    return 'tok1_' + '0'.repeat(64);
  }), error => error.code === 'TELEMETRY_INVALID_INPUT');
  assert.equal(tokenizeCalls, 0);
  assert.equal(INTERNAL_SCHEMA_VERSION, 5);
});

test('durable_evidence: malformed decisions keep independently valid usage and missing usage remains unknown', async t => {
  const invalid = fixture('positive-response.json');
  invalid.answers.routing.choice = 'not-a-registered-choice';
  const temporary = temporaryDatabase('jev-durable-malformed-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'jev-malformed-run');
  controlledTransport(t, { body: Buffer.from(JSON.stringify(invalid)) });
  const result = await runControlled(store, lease, 'jev-malformed-attempt', 'jev-malformed-transport');
  assert.equal(result.transportResult.validation.kind, 'invalid');
  assert.deepEqual(store.getJevProviderObservation(result.observation.sourceObservationRef).usage, {
    kind: 'known', inputTokens: 83, outputTokens: 19
  });

  t.mock.restoreAll();
  const unknownTemporary = temporaryDatabase('jev-durable-unknown-');
  t.after(() => unknownTemporary.cleanup());
  const unknownStore = openStore(unknownTemporary.databasePath);
  t.after(() => unknownStore.close());
  const unknownLease = createRunningWorkflow(unknownStore, 'jev-unknown-run');
  controlledTransport(t, {
    status: 529,
    body: Buffer.from('SYNTHETIC_PROVIDER_ERROR_BODY private response material'),
    headers: { 'retry-after': '5', 'x-typesafe-request-id': 'req-synthetic-overload' }
  });
  const unknown = await runControlled(unknownStore, unknownLease, 'jev-unknown-attempt', 'jev-unknown-transport');
  assert.equal(unknown.transportResult.kind, 'http_error');
  assert.equal(unknown.transportResult.status, 529);
  assert.equal(unknown.observation.usage.kind, 'unknown');
  assert.equal(unknown.observation.usage.reason, 'possible_dispatch');
  assert.equal(unknown.observation.providerRequestId, 'req-synthetic-overload');
  assert.equal(unknownStore.getJevProviderObservation(unknown.observation.sourceObservationRef).usage.kind, 'unknown');
  assert.doesNotMatch(JSON.stringify(unknown.observation), /SYNTHETIC_PROVIDER_ERROR_BODY|private response material|synthetic-offline-key/u);
  assert.equal(unknownStore.getAttempt('jev-unknown-attempt').state, 'intent');
  assert.equal(unknownStore.getWorkflow(unknownLease.workflowId).state, 'awaiting_response');
});

test('durable_evidence: post-response persistence failure keeps the attempt unresolved and recovery never resends', async t => {
  const temporary = temporaryDatabase('jev-post-response-persist-failure-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'jev-post-response-failure-run');
  const calls = controlledTransport(t);
  const raw = new DatabaseSync(temporary.databasePath);
  raw.exec(`CREATE TRIGGER fail_jev_observation_outbox BEFORE INSERT ON jev_local_observation_outbox
    BEGIN SELECT RAISE(ABORT, 'synthetic observation delivery persistence failure'); END;`);
  await assert.rejects(
    runControlled(store, lease, 'jev-post-response-failure-attempt', 'jev-post-response-failure-transport'),
    error => error instanceof RuntimeError && error.code === 'STORE_WRITE_FAILED'
  );
  raw.exec('DROP TRIGGER fail_jev_observation_outbox;');
  raw.close();

  assert.equal(calls.requests, 1);
  assert.equal(calls.writes, 1);
  assert.equal(store.getAttempt('jev-post-response-failure-attempt').state, 'intent');
  assert.ok(store.getJevDispatchMarker('jev-post-response-failure-transport'));
  assert.equal(countRows(temporary.databasePath, 'jev_provider_observations'), 0);
  assert.equal(countRows(temporary.databasePath, 'jev_local_observation_outbox'), 0);

  const currentRevision = store.getWorkflow(lease.workflowId).revision;
  await assert.rejects(
    runControlled(store, { ...lease, revision: currentRevision },
      'jev-post-response-failure-attempt', 'jev-post-response-failure-transport'),
    error => error instanceof RuntimeError && error.code === 'OUTCOME_UNRESOLVED'
  );
  assert.equal(calls.requests, 1);
  assert.equal(calls.writes, 1);

  const recovery = store.recordJevProviderObservation(observation({
    workflowId: lease.workflowId,
    logicalOperationRef: 'logical-jev-post-response-failure-attempt',
    attemptId: 'jev-post-response-failure-attempt',
    transportAttemptId: 'jev-post-response-failure-transport'
  }, {
    sourceObservationRef: 'jev-post-response-failure-recovered',
    dispatchCertainty: 'possible',
    resolvedModel: null,
    decisionConformance: 'unavailable',
    usage: { kind: 'unknown', reason: 'recovered_after_crash' }
  }));
  assert.equal(recovery.duplicate, false);
  assert.deepEqual(store.getJevProviderObservation('jev-post-response-failure-recovered').usage, {
    kind: 'unknown', reason: 'recovered_after_crash'
  });
  assert.equal(store.getWorkflow(lease.workflowId).state, 'awaiting_response');
  assert.equal(store.getAttempt('jev-post-response-failure-attempt').state, 'intent');
  assert.equal(store.getAttempt('jev-post-response-failure-attempt').authorityHoldRef,
    'synthetic-local-bookkeeping:hold-jev-post-response-failure-attempt');
  assert.equal(calls.writes, 1);
});

test('durable_evidence: failure before durable intent or pre-send marker performs zero controlled sends', async t => {
  const temporary = temporaryDatabase('jev-no-send-before-intent-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'jev-no-intent-run');
  const raw = new DatabaseSync(temporary.databasePath);
  raw.exec(`CREATE TRIGGER fail_jev_intent BEFORE INSERT ON operation_attempts
    BEGIN SELECT RAISE(ABORT, 'synthetic intent persistence failure'); END;`);
  let sends = 0;
  await assert.rejects(runControlled(store, lease, 'jev-no-intent-attempt', 'jev-no-intent-transport', {
    testOnlySend: async () => { sends += 1; return { kind: 'response' }; }
  }), error => error instanceof RuntimeError && error.code === 'STORE_WRITE_FAILED');
  assert.equal(sends, 0);
  assert.equal(store.getWorkflow(lease.workflowId).state, 'running');
  assert.equal(countRows(temporary.databasePath, 'operation_attempts'), 0);
  raw.exec('DROP TRIGGER fail_jev_intent;');
  raw.exec(`CREATE TRIGGER fail_jev_intent_event BEFORE INSERT ON workflow_events
    WHEN NEW.event_type = 'dispatch_intent_persisted'
    BEGIN SELECT RAISE(ABORT, 'synthetic intent event persistence failure'); END;`);
  await assert.rejects(runControlled(store, lease, 'jev-no-intent-event-attempt', 'jev-no-intent-event-transport', {
    testOnlySend: async () => { sends += 1; return { kind: 'response' }; }
  }), error => error instanceof RuntimeError && error.code === 'STORE_WRITE_FAILED');
  assert.equal(sends, 0);
  assert.equal(store.getWorkflow(lease.workflowId).state, 'running');
  assert.equal(countRows(temporary.databasePath, 'operation_attempts'), 0);
  raw.exec('DROP TRIGGER fail_jev_intent_event;');
  raw.exec(`CREATE TRIGGER fail_jev_marker BEFORE INSERT ON jev_dispatch_markers
    BEGIN SELECT RAISE(ABORT, 'synthetic marker persistence failure'); END;`);
  await assert.rejects(runControlled(store, lease, 'jev-marker-fail-attempt', 'jev-marker-fail-transport', {
    testOnlySend: async () => { sends += 1; return { kind: 'response' }; }
  }), error => error instanceof RuntimeError && error.code === 'STORE_WRITE_FAILED');
  assert.equal(sends, 0);
  assert.equal(store.getAttempt('jev-marker-fail-attempt').state, 'intent');
  assert.equal(store.getJevDispatchMarker('jev-marker-fail-transport'), null);
  raw.exec('DROP TRIGGER fail_jev_marker;');
  raw.exec(`CREATE TRIGGER fail_jev_marker_event BEFORE INSERT ON workflow_events
    WHEN NEW.event_type = 'jev_dispatch_may_have_started'
    BEGIN SELECT RAISE(ABORT, 'synthetic dispatch event persistence failure'); END;`);
  const eventsBeforeMarkerEventFailure = store.listEvents({ workflowId: lease.workflowId });
  assert.throws(() => store.recordJevDispatchMarker({
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence,
    expectedRevision: store.getWorkflow(lease.workflowId).revision,
    attemptId: 'jev-marker-fail-attempt',
    transportAttemptId: 'jev-marker-fail-transport'
  }), error => error instanceof RuntimeError && error.code === 'STORE_WRITE_FAILED');
  assert.equal(sends, 0);
  assert.equal(store.getAttempt('jev-marker-fail-attempt').state, 'intent');
  assert.equal(store.getJevDispatchMarker('jev-marker-fail-transport'), null);
  assert.deepEqual(store.listEvents({ workflowId: lease.workflowId }), eventsBeforeMarkerEventFailure);
  raw.exec('DROP TRIGGER fail_jev_marker_event;');
  raw.close();

  const recovered = store.recordJevProviderObservation(observation({
    workflowId: lease.workflowId,
    logicalOperationRef: 'logical-jev-marker-fail-attempt',
    attemptId: 'jev-marker-fail-attempt',
    transportAttemptId: 'jev-marker-fail-transport'
  }, {
    sourceObservationRef: 'jev-marker-failure-recovered',
    dispatchCertainty: 'not_dispatched',
    resolvedModel: null,
    decisionConformance: 'unavailable',
    usage: { kind: 'unknown', reason: 'not_dispatched' }
  }));
  assert.equal(recovered.duplicate, false);
  assert.equal(store.getAttempt('jev-marker-fail-attempt').authorityHoldRef, 'synthetic-local-bookkeeping:hold-jev-marker-fail-attempt');
});

test('durable_evidence: SQLite process crashes recover conservatively at each send and observation boundary', async t => {
  for (const stage of [
    'before-dispatch',
    'after-possible-write',
    'after-response-before-observation',
    'after-observation-commit'
  ]) {
    const temporary = temporaryDatabase(`jev-crash-${stage}-`);
    t.after(() => temporary.cleanup());
    const child = spawnCrashFixture(fixturePath('crash-phases.mjs'), [temporary.databasePath, stage]);
    const result = await child.done;
    assert.equal(result.signal, 'SIGKILL', stage);

    const store = openStore(temporary.databasePath);
    t.after(() => store.close());
    const before = store.getWorkflow('crash-jev-workflow');
    assert.equal(before.state, 'awaiting_response');
    assert.equal(store.getCheckpoint('crash-jev-workflow').data.privateMarker, 'SYNTHETIC_CRASH_SOURCE');
    assert.equal(store.getAttempt('crash-jev-billable').authorityHoldRef, 'synthetic-local-bookkeeping:crash-hold');
    assert.throws(() => store.getReceipt('crash-jev-billable'), error => error.code === 'ATTEMPT_NOT_FOUND');
    const marker = store.getJevDispatchMarker('crash-jev-transport');
    if (stage === 'before-dispatch') assert.equal(marker, null);
    else assert.ok(marker);

    if (stage === 'after-observation-commit') {
      assert.deepEqual(store.getJevProviderObservation('crash-jev-observation').usage, {
        kind: 'known', inputTokens: 83, outputTokens: 19
      });
    } else {
      const certainty = marker ? 'possible' : 'not_dispatched';
      const usageReason = marker ? 'recovered_after_crash' : 'not_dispatched';
      const recovery = store.recordJevProviderObservation(observation({
        workflowId: 'crash-jev-workflow',
        logicalOperationRef: 'crash-jev-logical',
        attemptId: 'crash-jev-billable',
        transportAttemptId: 'crash-jev-transport'
      }, {
        sourceObservationRef: `recovered-${stage}`,
        dispatchCertainty: certainty,
        resolvedModel: null,
        decisionConformance: 'unavailable',
        usage: { kind: 'unknown', reason: usageReason }
      }));
      assert.equal(recovery.duplicate, false);
      assert.deepEqual(store.getJevProviderObservation(recovery.sourceObservationRef).usage, {
        kind: 'unknown', reason: usageReason
      });
    }
    assert.deepEqual(store.getWorkflow('crash-jev-workflow'), before);
    assert.equal(store.getAttempt('crash-jev-billable').state, 'intent');
    assert.equal(store.readJevObservationDeliveryPage({ limit: 5 }).items.length, 1);
  }
});

test('durable_evidence: immutable unknown and later-known observations retain separate identities and replay locally', t => {
  const temporary = temporaryDatabase('jev-observation-history-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'jev-history-run');
  const identity = setupAttempt(store, lease, 'jev-history-attempt', 'jev-history-transport');
  const unknownInput = observation(identity, {
    sourceObservationRef: 'jev-history-unknown-source',
    dispatchCertainty: 'possible',
    resolvedModel: null,
    decisionConformance: 'unavailable',
    usage: { kind: 'unknown', reason: 'possible_dispatch' }
  });
  const unknownWrite = store.recordJevProviderObservation(unknownInput);
  const duplicate = store.recordJevProviderObservation(unknownInput);
  assert.equal(unknownWrite.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.eventId, unknownWrite.eventId);
  assert.equal(countRows(temporary.databasePath, 'jev_provider_observations'), 1);
  assert.equal(countRows(temporary.databasePath, 'jev_local_observation_outbox'), 1);
  assert.throws(() => store.recordJevProviderObservation({
    ...unknownInput,
    usage: { kind: 'known', inputTokens: 83, outputTokens: 19 },
    dispatchCertainty: 'response_received',
    resolvedModel: 'jev-1.13.0',
    decisionConformance: 'invalid'
  }), error => error.code === 'OBSERVATION_IDENTITY_CONFLICT');

  const knownInput = observation(identity, {
    sourceObservationRef: 'jev-history-later-known-source',
    dispatchCertainty: 'response_received',
    providerRequestId: 'req-later-synthetic',
    decisionConformance: 'invalid',
    usage: { kind: 'known', inputTokens: 83, outputTokens: 19 }
  });
  const knownWrite = store.recordJevProviderObservation(knownInput);
  assert.equal(knownWrite.duplicate, false);
  assert.deepEqual(store.getJevProviderObservation('jev-history-unknown-source').usage, {
    kind: 'unknown', reason: 'possible_dispatch'
  });
  assert.deepEqual(store.getJevProviderObservation('jev-history-later-known-source').usage, {
    kind: 'known', inputTokens: 83, outputTokens: 19
  });

  const firstPage = store.readJevObservationDeliveryPage({ limit: 1 });
  const replayPage = store.readJevObservationDeliveryPage({ limit: 1 });
  assert.equal(firstPage.items[0].eventId, unknownWrite.eventId);
  assert.equal(replayPage.items[0].eventId, unknownWrite.eventId);
  assert.deepEqual(store.acknowledgeJevObservationDelivery(unknownWrite.eventId), {
    acknowledged: true, duplicate: false
  });
  assert.deepEqual(store.acknowledgeJevObservationDelivery(unknownWrite.eventId), {
    acknowledged: true, duplicate: true
  });
  const secondPage = store.readJevObservationDeliveryPage({ afterSequence: firstPage.nextAfterSequence, limit: 1 });
  assert.equal(secondPage.items[0].eventId, knownWrite.eventId);
  assert.equal(store.readJevObservationDeliveryPage({ limit: 1 }).items[0].eventId, knownWrite.eventId);
  assert.equal(countRows(temporary.databasePath, 'jev_provider_observations'), 2);
  assert.equal(countRows(temporary.databasePath, 'jev_local_observation_outbox'), 2);
  assert.equal(store.getWorkflow(lease.workflowId).state, 'awaiting_response');
  assert.equal(store.getAttempt(identity.attemptId).authorityHoldRef, 'synthetic-local-bookkeeping:hold-jev-history-attempt');
});

test('durable_evidence: local observations survive cancellation and lease recovery without workflow promotion or hold release', t => {
  const temporary = temporaryDatabase('jev-late-observation-');
  t.after(() => temporary.cleanup());
  let currentTime = 1000;
  const store = openStore(temporary.databasePath, () => currentTime);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'jev-late-run', 10);
  const identity = setupAttempt(store, lease, 'jev-late-attempt', 'jev-late-transport');
  const cancellation = store.requestCancellation({
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence,
    expectedRevision: identity.intent.revision,
    eventId: 'jev-late-cancel'
  });
  assert.equal(cancellation.state, 'reconciliation_pending');
  currentTime = 2000;
  const recoveryLease = store.acquireLease({
    workflowId: lease.workflowId,
    ownerId: 'jev-late-recovery-worker',
    ttlMs: 1000,
    eventId: 'jev-late-recovery-lease'
  });
  assert.ok(recoveryLease.fence > lease.fence);
  assert.equal(store.getAttempt(identity.attemptId).state, 'outcome_unknown');
  const before = {
    workflow: store.getWorkflow(lease.workflowId),
    checkpoint: store.getCheckpoint(lease.workflowId),
    attempt: store.getAttempt(identity.attemptId)
  };
  assert.throws(() => store.recordJevDispatchMarker({
    workflowId: lease.workflowId,
    ownerId: lease.ownerId,
    fence: lease.fence,
    expectedRevision: before.workflow.revision,
    attemptId: identity.attemptId,
    transportAttemptId: identity.transportAttemptId
  }), error => error.code === 'STALE_FENCE');
  const late = store.recordJevProviderObservation(observation(identity, {
    sourceObservationRef: 'jev-late-recovered-usage',
    dispatchCertainty: 'response_received',
    decisionConformance: 'invalid',
    usage: { kind: 'known', inputTokens: 83, outputTokens: 19 }
  }));
  assert.equal(late.duplicate, false);
  assert.deepEqual({
    workflow: store.getWorkflow(lease.workflowId),
    checkpoint: store.getCheckpoint(lease.workflowId),
    attempt: store.getAttempt(identity.attemptId)
  }, before);
  assert.equal(store.getJevProviderObservation('jev-late-recovered-usage').usage.kind, 'known');
});

test('durable_evidence: cross-boundary storage failures roll back event, fact, and local outbox together', t => {
  const temporary = temporaryDatabase('jev-storage-rollback-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'jev-rollback-run');
  const identity = setupAttempt(store, lease, 'jev-rollback-attempt', 'jev-rollback-transport');
  const raw = new DatabaseSync(temporary.databasePath);
  const failPoints = [
    ['fail_jev_fact', 'BEFORE INSERT ON jev_provider_observations'],
    ['fail_jev_event', "BEFORE INSERT ON workflow_events WHEN NEW.event_type = 'jev_local_observation_recorded'"],
    ['fail_jev_standard_outbox', "BEFORE INSERT ON outbox WHEN NEW.event_id GLOB 'jev-local-observation-v1:*'"],
    ['fail_jev_local_outbox', 'BEFORE INSERT ON jev_local_observation_outbox']
  ];
  for (const [triggerName, triggerTarget] of failPoints) {
    const before = {
      events: store.listEvents({ workflowId: lease.workflowId }),
      outbox: store.readOutbox(),
      workflow: store.getWorkflow(lease.workflowId),
      checkpoint: store.getCheckpoint(lease.workflowId),
      attempt: store.getAttempt(identity.attemptId),
      observationCount: countRows(temporary.databasePath, 'jev_provider_observations'),
      deliveryCount: countRows(temporary.databasePath, 'jev_local_observation_outbox')
    };
    raw.exec(`CREATE TRIGGER ${triggerName} ${triggerTarget}
      BEGIN SELECT RAISE(ABORT, 'synthetic transaction boundary failure'); END;`);
    assert.throws(() => store.recordJevProviderObservation(observation(identity, {
      sourceObservationRef: `rollback-${triggerName}`
    })), error => error instanceof RuntimeError && error.code === 'STORE_WRITE_FAILED');
    raw.exec(`DROP TRIGGER ${triggerName};`);
    assert.deepEqual({
      events: store.listEvents({ workflowId: lease.workflowId }),
      outbox: store.readOutbox(),
      workflow: store.getWorkflow(lease.workflowId),
      checkpoint: store.getCheckpoint(lease.workflowId),
      attempt: store.getAttempt(identity.attemptId),
      observationCount: countRows(temporary.databasePath, 'jev_provider_observations'),
      deliveryCount: countRows(temporary.databasePath, 'jev_local_observation_outbox')
    }, before);
  }
  raw.close();
});

test('privacy_identity: bounded identity snapshots reject accessors, proxies, and cross-workflow binding before persistence', t => {
  const temporary = temporaryDatabase('jev-safe-input-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const lease = createRunningWorkflow(store, 'jev-safe-input-run');
  const identity = setupAttempt(store, lease, 'jev-safe-input-attempt', 'jev-safe-input-transport');
  let getterCalls = 0;
  const accessor = observation(identity);
  Object.defineProperty(accessor, 'providerRequestId', {
    enumerable: true,
    get() { getterCalls += 1; throw new Error(PRIVATE_MARKER); }
  });
  assert.throws(() => store.recordJevProviderObservation(accessor), error => error.code === 'INVALID_INPUT');
  const proxy = new Proxy(observation(identity), {
    ownKeys() { getterCalls += 1; throw new Error(PRIVATE_MARKER); }
  });
  assert.throws(() => store.recordJevProviderObservation(proxy), error => error.code === 'INVALID_INPUT');
  assert.equal(getterCalls, 0);
  assert.throws(() => store.recordJevProviderObservation({
    ...observation(identity), workflowId: 'jev-other-workflow', sourceObservationRef: 'jev-cross-workflow'
  }), error => error.code === 'OBSERVATION_IDENTITY_CONFLICT');
  assert.throws(() => store.recordJevProviderObservation({
    ...observation(identity),
    sourceObservationRef: 'jev-invalid-request-id',
    providerRequestId: 'req\nSYNTHETIC_SECRET'
  }), error => error.code === 'INVALID_INPUT');
  assert.throws(() => store.recordJevProviderObservation({
    ...observation(identity),
    sourceObservationRef: 'jev-inconsistent-unknown-reason',
    dispatchCertainty: 'not_dispatched',
    resolvedModel: null,
    decisionConformance: 'unavailable',
    usage: { kind: 'unknown', reason: 'possible_dispatch' }
  }), error => error.code === 'INVALID_INPUT');
  assert.equal(countRows(temporary.databasePath, 'jev_provider_observations'), 0);
  assert.equal(store.getWorkflow(lease.workflowId).state, 'awaiting_response');
});

test('durable_evidence: multiprocess duplicate and conflicting identities serialize without collapsing attempts', async t => {
  for (const mode of ['duplicate', 'conflict']) {
    const temporary = temporaryDatabase(`jev-multiprocess-${mode}-`);
    t.after(() => temporary.cleanup());
    const store = openStore(temporary.databasePath);
    const lease = createRunningWorkflow(store, 'concurrent-jev-workflow');
    const identity = setupAttempt(store, lease, 'concurrent-jev-attempt', 'concurrent-jev-transport');
    store.close();
    if (mode === 'duplicate') {
      const children = await Promise.all([
        spawnFixture(fixturePath('record-observation.mjs'), [temporary.databasePath, '19']).done,
        spawnFixture(fixturePath('record-observation.mjs'), [temporary.databasePath, '19']).done
      ]);
      const statuses = children.map(child => JSON.parse(child.stdout.trim()).status).sort();
      assert.deepEqual(statuses, ['duplicate', 'inserted']);
    } else {
      const children = await Promise.all([
        spawnFixture(fixturePath('record-observation.mjs'), [temporary.databasePath, '19']).done,
        spawnFixture(fixturePath('record-observation.mjs'), [temporary.databasePath, '20']).done
      ]);
      const results = children.map(child => JSON.parse(child.stdout.trim()));
      assert.equal(results.filter(item => item.status === 'inserted').length, 1);
      assert.equal(results.filter(item => item.status === 'error' && item.code === 'OBSERVATION_IDENTITY_CONFLICT').length, 1);
    }
    const reopened = openStore(temporary.databasePath);
    t.after(() => reopened.close());
    assert.equal(countRows(temporary.databasePath, 'jev_provider_observations'), 1);
    assert.equal(reopened.readJevObservationDeliveryPage({ limit: 2 }).items.length, 1);
    assert.equal(reopened.getAttempt(identity.attemptId).state, 'intent');
  }
});

test('privacy_identity: identical payload observations under separate workflows remain separate local facts', t => {
  const temporary = temporaryDatabase('jev-identical-payload-identities-');
  t.after(() => temporary.cleanup());
  const store = openStore(temporary.databasePath);
  t.after(() => store.close());
  const leftLease = createRunningWorkflow(store, 'jev-identical-left');
  const left = setupAttempt(store, leftLease, 'jev-identical-left-attempt', 'jev-identical-left-transport');
  const rightLease = createRunningWorkflow(store, 'jev-identical-right');
  const right = setupAttempt(store, rightLease, 'jev-identical-right-attempt', 'jev-identical-right-transport');
  const leftWrite = store.recordJevProviderObservation(observation(left, { sourceObservationRef: 'jev-identical-left-source' }));
  const rightWrite = store.recordJevProviderObservation(observation(right, { sourceObservationRef: 'jev-identical-right-source' }));
  assert.equal(leftWrite.duplicate, false);
  assert.equal(rightWrite.duplicate, false);
  assert.notEqual(leftWrite.eventId, rightWrite.eventId);
  assert.equal(countRows(temporary.databasePath, 'jev_provider_observations'), 2);
  assert.notEqual(store.getJevProviderObservation('jev-identical-left-source').workflowId,
    store.getJevProviderObservation('jev-identical-right-source').workflowId);
});

test('migration: v4 to v5 preserves workflows, receipts, events, outbox, and telemetry cursor; rollback keeps v4 untouched', t => {
  const temporary = temporaryDatabase('jev-v4-migration-');
  t.after(() => temporary.cleanup());
  let store = openStore(temporary.databasePath);
  const lease = createRunningWorkflow(store, 'jev-v4-preservation');
  const intent = store.recordDispatchIntent({
    ...lease,
    expectedRevision: lease.revision,
    attemptId: 'jev-v4-preserved-attempt',
    logicalOperationRef: 'jev-v4-preserved-logical-operation',
    authorityHoldRef: 'synthetic-local-bookkeeping:jev-v4-preserved-hold',
    transportAttemptId: 'jev-v4-preserved-transport',
    eventId: 'jev-v4-preserved-intent'
  });
  const receipt = store.recordResponseReceipt({
    ...lease,
    expectedRevision: intent.revision,
    attemptId: 'jev-v4-preserved-attempt',
    receiptId: 'jev-v4-preserved-receipt',
    outcome: 'completed',
    nextState: 'succeeded',
    responseBytes: Buffer.from('synthetic-v4-response-receipt'),
    nextCheckpoint: { step: 'preserved-v4-pending-receipt' },
    eventId: 'jev-v4-preserved-response'
  });
  store.advanceTelemetryCursor({ expectedSequence: 0, nextSequence: 1 });
  const before = {
    workflow: store.getWorkflow(lease.workflowId),
    checkpoint: store.getCheckpoint(lease.workflowId),
    attempt: store.getAttempt('jev-v4-preserved-attempt'),
    receipt: store.getReceipt('jev-v4-preserved-attempt'),
    events: store.listEvents({ workflowId: lease.workflowId }),
    outbox: store.readOutbox(),
    cursor: store.getTelemetryCursor(),
    receiptResult: receipt
  };
  store.close();
  let raw = new DatabaseSync(temporary.databasePath);
  removeV5Tables(raw);
  raw.exec('PRAGMA user_version = 4;');
  raw.close();
  store = openStore(temporary.databasePath);
  t.after(() => store.close());
  assert.equal(INTERNAL_SCHEMA_VERSION, 5);
  assert.deepEqual({
    workflow: store.getWorkflow(lease.workflowId),
    checkpoint: store.getCheckpoint(lease.workflowId),
    attempt: store.getAttempt('jev-v4-preserved-attempt'),
    receipt: store.getReceipt('jev-v4-preserved-attempt'),
    events: store.listEvents({ workflowId: lease.workflowId }),
    outbox: store.readOutbox(),
    cursor: store.getTelemetryCursor(),
    receiptResult: receipt
  }, before);
  assert.equal(countRows(temporary.databasePath, 'jev_dispatch_markers'), 0);
  assert.equal(countRows(temporary.databasePath, 'jev_provider_observations'), 0);
  store.close();

  const rollback = temporaryDatabase('jev-v4-migration-rollback-');
  t.after(() => rollback.cleanup());
  const rollbackStore = openStore(rollback.databasePath);
  const rollbackLease = createRunningWorkflow(rollbackStore, 'jev-v4-rollback');
  const rollbackIntent = rollbackStore.recordDispatchIntent({
    ...rollbackLease,
    expectedRevision: rollbackLease.revision,
    attemptId: 'jev-v4-rollback-attempt',
    logicalOperationRef: 'jev-v4-rollback-logical-operation',
    authorityHoldRef: 'synthetic-local-bookkeeping:jev-v4-rollback-hold',
    transportAttemptId: 'jev-v4-rollback-transport',
    eventId: 'jev-v4-rollback-intent'
  });
  rollbackStore.recordResponseReceipt({
    ...rollbackLease,
    expectedRevision: rollbackIntent.revision,
    attemptId: 'jev-v4-rollback-attempt',
    receiptId: 'jev-v4-rollback-receipt',
    outcome: 'completed',
    nextState: 'succeeded',
    responseBytes: Buffer.from('synthetic-v4-rollback-receipt'),
    nextCheckpoint: { step: 'preserve-rollback-receipt' },
    eventId: 'jev-v4-rollback-response'
  });
  rollbackStore.advanceTelemetryCursor({ expectedSequence: 0, nextSequence: 1 });
  const rollbackBefore = {
    workflow: rollbackStore.getWorkflow(rollbackLease.workflowId),
    checkpoint: rollbackStore.getCheckpoint(rollbackLease.workflowId),
    attempt: rollbackStore.getAttempt('jev-v4-rollback-attempt'),
    receipt: rollbackStore.getReceipt('jev-v4-rollback-attempt'),
    events: rollbackStore.listEvents({ workflowId: rollbackLease.workflowId }),
    outbox: rollbackStore.readOutbox(),
    cursor: rollbackStore.getTelemetryCursor()
  };
  rollbackStore.close();
  raw = new DatabaseSync(rollback.databasePath);
  removeV5Tables(raw);
  raw.exec(`
    CREATE TABLE jev_provider_observations (marker TEXT NOT NULL);
    INSERT INTO jev_provider_observations VALUES ('preserve-v4-conflict-marker');
    PRAGMA user_version = 4;
  `);
  raw.close();
  const beforeFailedMigration = sqliteSnapshot(rollback.databasePath);
  assert.throws(() => openStore(rollback.databasePath), error => error instanceof RuntimeError);
  assert.deepEqual(sqliteSnapshot(rollback.databasePath), beforeFailedMigration);
  raw = new DatabaseSync(rollback.databasePath, { readOnly: true });
  assert.equal(Number(raw.prepare('PRAGMA user_version').get().user_version), 4);
  assert.equal(raw.prepare('SELECT marker FROM jev_provider_observations').get().marker, 'preserve-v4-conflict-marker');
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='jev_dispatch_markers'").get().count, 0);
  assert.equal(raw.prepare("SELECT last_sequence FROM telemetry_cursors WHERE consumer_id = 'internal-telemetry-v1'").get().last_sequence, 1);
  const rollbackCheckpoint = raw.prepare(
    "SELECT payload_json, sha256 FROM workflow_checkpoints WHERE workflow_id = 'jev-v4-rollback'"
  ).get();
  assert.deepEqual(JSON.parse(rollbackCheckpoint.payload_json).data, rollbackBefore.checkpoint.data);
  assert.equal(rollbackCheckpoint.sha256, rollbackBefore.checkpoint.sha256);
  assert.equal(raw.prepare("SELECT response_sha256 FROM response_receipts WHERE receipt_id = 'jev-v4-rollback-receipt'").get().response_sha256,
    rollbackBefore.receipt.responseSha256);
  assert.equal(raw.prepare("SELECT COUNT(*) AS count FROM workflow_events WHERE workflow_id = 'jev-v4-rollback'").get().count,
    rollbackBefore.events.length);
  raw.close();
});
