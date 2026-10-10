import assert from 'node:assert/strict';
import https from 'node:https';
import { Resolver } from 'node:dns/promises';
import { EventEmitter } from 'node:events';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import '../../decisions/jev-adapter.contract/network-guard.js';
import { DurableWorkflowStore } from '../../../src/internal/durable-store.js';
import { sendJevOnce } from '../../../src/adapters/jev/http-transport.js';
import { runPrivateJevTestAttempt } from '../../decisions/jev-adapter.contract/private-orchestrator.js';
import { recordSyntheticMetric } from '../../decisions/jev-adapter.contract/synthetic-metrics.js';

const [databasePath, phase, markerPath, resultPath, metricsPath] = process.argv.slice(2);
if (!['before-marker', 'after-marker-before-bytes', 'after-write', 'response-before-observation', 'observation-before-checkpoint'].includes(phase)
    || ![databasePath, markerPath, resultPath, metricsPath].every(value => typeof value === 'string')) process.exit(2);

const API_KEY_FIXTURE = 'synthetic-offline-key';
const REQUEST = JSON.parse(await readFile(new URL('../../fixtures/jev/positive-request.json', import.meta.url), 'utf8'));
const RESPONSE = await readFile(new URL('../../fixtures/jev/positive-response.json', import.meta.url));
const workflowId = `ops-jev-${process.pid}`;
const ownerId = `${workflowId}-worker`;
let abortController = new AbortController();
let releasePhase;
const phaseRelease = new Promise(resolve => { releasePhase = resolve; });
let termSeen = false;
const metrics = { controlled_dns_resolve4: 0, controlled_dns_resolve6: 0, controlled_https_request: 0, controlled_https_write: 0, blocked_external_network_attempt: 0 };
const keepalive = setInterval(() => {}, 1_000);
async function publishMarker(value) {
  const temporaryPath = `${markerPath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(value), { flag: 'wx' });
  await rename(temporaryPath, markerPath);
}
const record = name => {
  metrics[name] += 1;
  recordSyntheticMetric(name);
};

process.once('SIGTERM', () => {
  termSeen = true;
  abortController.abort();
  releasePhase();
});

t:
{
  const store = DurableWorkflowStore.open({ databasePath, clock: () => 1000, busyTimeoutMs: 20 });
  store.createWorkflow({ workflowId, checkpoint: { local: 'synthetic-before-send' }, eventId: `${workflowId}:created` });
  const lease = store.acquireLease({ workflowId, ownerId, ttlMs: 60_000, eventId: `${workflowId}:lease` });
  const running = store.transitionWorkflow({
    ...lease,
    expectedRevision: lease.revision,
    toState: 'running',
    eventId: `${workflowId}:running`
  });
  const current = { ...lease, revision: running.revision };

  Resolver.prototype.resolve4 = host => {
    assert.equal(host, 'api.typesafe.ai');
    record('controlled_dns_resolve4');
    return Promise.resolve(['93.184.216.34']);
  };
  Resolver.prototype.resolve6 = host => {
    assert.equal(host, 'api.typesafe.ai');
    record('controlled_dns_resolve6');
    return Promise.resolve([]);
  };
  https.request = (options, callback) => {
    record('controlled_https_request');
    assert.equal(options.protocol, 'https:');
    assert.equal(options.hostname, 'api.typesafe.ai');
    const request = new EventEmitter();
    request.destroyed = false;
    request.destroy = () => { request.destroyed = true; };
    request.end = () => {
      record('controlled_https_write');
      if (phase === 'after-write') {
        void publishMarker({ phase, stage: 'possible-write' }).catch(() => {});
        return;
      }
      const response = new EventEmitter();
      response.statusCode = 200;
      response.headers = Object.assign(Object.create(null), {
        'content-type': 'application/json', 'content-length': String(RESPONSE.length)
      });
      response.rawHeaders = Object.entries(response.headers).flatMap(([key, value]) => [key, value]);
      setImmediate(() => {
        callback(response);
        response.emit('data', RESPONSE);
        response.emit('end');
      });
    };
    const socket = new EventEmitter();
    socket.encrypted = true;
    socket.authorized = false;
    socket.secureConnecting = true;
    socket.destroyed = false;
    socket.destroy = () => { socket.destroyed = true; };
    setImmediate(() => request.emit('socket', socket));
    setImmediate(() => {
      socket.secureConnecting = false;
      socket.authorized = true;
      socket.emit('secureConnect');
    });
    return request;
  };

  const summary = { phase, workflowId, attemptCount: 0, markerCount: 0, observationCount: 0, termSeen: false };
  if (phase === 'before-marker') {
    await publishMarker({ phase, stage: 'workflow-before-marker' });
    await phaseRelease;
  } else {
    const originalRecord = store.recordJevProviderObservation.bind(store);
    if (phase === 'response-before-observation') {
      store.recordJevProviderObservation = observation => (async () => {
        await publishMarker({ phase, stage: 'response-before-observation' });
        await phaseRelease;
        return originalRecord(observation);
      })();
    }
    const sender = async ({ request, apiKey }) => {
      if (phase === 'after-marker-before-bytes') {
        await publishMarker({ phase, stage: 'marker-before-bytes' });
        await phaseRelease;
      }
      if (phase === 'after-write') {
        // This actual existing transport receives the owned child's native AbortSignal.
        return sendJevOnce({ request, apiKey, signal: abortController.signal });
      }
      if (phase === 'response-before-observation' || phase === 'observation-before-checkpoint') {
        return sendJevOnce({ request, apiKey, signal: abortController.signal });
      }
      return sendJevOnce({ request, apiKey, signal: abortController.signal });
    };
    const attempt = await runPrivateJevTestAttempt({
      store,
      workflowId,
      ownerId,
      fence: current.fence,
      expectedRevision: current.revision,
      attemptId: `ops-attempt-${phase}`,
      logicalOperationRef: `ops-logical-${phase}`,
      transportAttemptId: `ops-transport-${phase}`,
      authorityHoldRef: `synthetic-local-bookkeeping:hold-${phase}`,
      request: REQUEST,
      apiKey: API_KEY_FIXTURE,
      testOnlySend: sender
    });
    if (phase === 'response-before-observation') await phaseRelease;
    if (attempt.persistedObservation instanceof Promise) await attempt.persistedObservation;
    const rows = new DatabaseSync(databasePath, { readOnly: true });
    try {
      summary.attemptCount = Number(rows.prepare('SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id = ?').get(workflowId).count);
      summary.markerCount = Number(rows.prepare('SELECT COUNT(*) AS count FROM jev_dispatch_markers WHERE workflow_id = ?').get(workflowId).count);
    } finally { rows.close(); }
    summary.observationCount = store.readJevObservationDeliveryPage({ afterSequence: 0, limit: 10 }).items
      .filter(item => item.workflowId === workflowId).length;
    summary.dispatchCertainty = attempt.observation?.dispatchCertainty ?? null;
    if (phase === 'observation-before-checkpoint') {
      await publishMarker({ phase, stage: 'observation-before-checkpoint' });
      await phaseRelease;
    }
  }

  summary.termSeen = termSeen;
  summary.controlledHttpsRequests = metrics.controlled_https_request;
  summary.controlledHttpsWrites = metrics.controlled_https_write;
  summary.blockedExternalNetworkAttempts = metrics.blocked_external_network_attempt;
  const raw = new DatabaseSync(databasePath, { readOnly: true });
  try {
    summary.opaqueHoldRetained = Number(raw.prepare(
      'SELECT COUNT(*) AS count FROM operation_attempts WHERE workflow_id = ? AND authority_hold_ref IS NOT NULL'
    ).get(workflowId).count) > 0;
  } finally { raw.close(); }
  await writeFile(metricsPath, JSON.stringify(metrics));
  await writeFile(resultPath, JSON.stringify(summary));
store.close();
}

clearInterval(keepalive);
process.exitCode = 0;
