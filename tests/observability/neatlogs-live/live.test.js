import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { inspect } from 'node:util';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import {
  DurableWorkflowStore,
  createHmacTokenizer,
  projectTelemetryEvent
} from '@jevelopers/agent-harness-runtime';
import {
  NeatlogsConfigError,
  loadNeatlogsConfig,
  readNeatlogsEnvFile,
  scrubNeatlogsEnvironment
} from '../../../src/observability/private/neatlogs-config.js';
import {
  decodeNeatlogsExportResponse,
  deterministicNeatlogsIds,
  encodeNeatlogsExportRequest,
  nextNeatlogsGeneration,
  planNeatlogsExport
} from '../../../src/observability/private/neatlogs-otlp.js';
import { readbackNeatlogsPlan, sendNeatlogsPlan } from '../../../src/observability/private/neatlogs-live.js';
import { createNeatlogsSdkCapture } from '../../../src/observability/private/neatlogs-sdk-capture.js';

const require = createRequire(import.meta.url);
const otlpRoot = require(resolve('node_modules/@opentelemetry/otlp-transformer/build/src/generated/root.js'));
const ExportRequest = otlpRoot.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;
const ExportResponse = otlpRoot.opentelemetry.proto.collector.trace.v1.ExportTraceServiceResponse;

const INGEST_KEY = 'synthetic-ingest-key-0123456789abcdef';
const READ_TOKEN = 'synthetic-readback-token-0123456789abcdef';
const PROJECT_ID = '00000000-0000-4000-8000-000000000001';
const REVISION = 'a'.repeat(40);
const CANARIES = Object.freeze([
  'SYNTHETIC_RAW_ID_CANARY_test',
  'SYNTHETIC_PRIVATE_URL_CANARY_https://private.invalid/x?token=y',
  'SYNTHETIC_EMAIL_CANARY_person@example.invalid',
  'SYNTHETIC_CUSTOMER_TEXT_CANARY_test'
]);

let scratch;
let plan;

function configured(overrides = {}) {
  return loadNeatlogsConfig({
    env: {
      NEATLOGS_API_KEY: INGEST_KEY,
      NEATLOGS_TOKEN: READ_TOKEN,
      NEATLOGS_PROJECT_ID: PROJECT_ID,
      ...overrides
    }
  });
}

function response(status, body = '', headers = {}) {
  return new Response(body === null ? null : body, { status, headers });
}

function recordingFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init, calls.length);
  };
  return { fetchImpl, calls };
}

async function buildPlan() {
  let generated = 0;
  const store = DurableWorkflowStore.open({
    databasePath: join(scratch, 'store.sqlite'),
    clock: () => 5_000,
    idFactory: () => `generated-${randomUUID()}-${++generated}`
  });
  const tokenizer = createHmacTokenizer(Buffer.alloc(32, 0x3c));
  try {
    const workflowId = `workflow:${CANARIES[0]}`;
    store.createWorkflow({
      workflowId,
      eventId: 'event:created',
      checkpoint: { url: CANARIES[1], email: CANARIES[2], text: CANARIES[3] }
    });
    const lease = store.acquireLease({ workflowId, ownerId: 'w', ttlMs: 10_000, eventId: 'event:lease' });
    store.transitionWorkflow({ ...lease, expectedRevision: 0, toState: 'running', eventId: 'event:run' });
    const page = store.readEventPage({ afterSequence: 0, limit: 32 });
    const tokenize = tokenizer.tokenize.bind(tokenizer);
    const records = page.events.map(event => projectTelemetryEvent(event, tokenize));
    const capture = createNeatlogsSdkCapture({ timeoutMs: 500 });
    try {
      const result = await capture.prepare(records);
      assert.equal(result.status, 'captured_local');
      return planNeatlogsExport(result.envelope, { tags: [`agent-harness@${REVISION}`, 'evidence:synthetic'] });
    } finally {
      await capture.close();
    }
  } finally {
    tokenizer.destroy?.();
    store.close();
  }
}

function readbackServer({
  finalizeAfter = 1, spans = 'both', tags, inputFor, projectId = PROJECT_ID,
  served = plan, droppedIds = [], alsoStored = []
} = {}) {
  const polls = new Map();
  return recordingFetch((url) => {
    const path = new URL(url).pathname.replace('/api/v1/public', '');
    const ok = data => response(200, JSON.stringify({ success: true, requestId: 'req_test', data }), {
      'content-type': 'application/json'
    });
    if (path === '/project') return ok({ id: projectId, name: 'Synthetic project' });
    const match = /^\/traces\/([0-9a-f]{32})(\/spans(?:\/([0-9a-f]{16})\/payload)?)?$/.exec(path);
    if (alsoStored.includes(match?.[1]) && !match[2]) {
      return ok({ traceId: match[1], finalizationStatus: 'finalized' });
    }
    const trace = served.traces.find(item => item.traceId === match?.[1]);
    if (!trace || droppedIds.includes(trace.traceId)) {
      return response(404, '{}', { 'content-type': 'application/problem+json' });
    }
    if (!match[2]) {
      const count = (polls.get(trace.traceId) ?? 0) + 1;
      polls.set(trace.traceId, count);
      return ok({
        traceId: trace.traceId,
        sessionId: trace.sessionId,
        workflowName: served.workflowName,
        traceName: 'agent_harness.workflow_event',
        tags: tags ?? [...served.tags],
        spansCount: spans === 'duplicate' ? 3 : 2,
        finalizationStatus: count >= finalizeAfter ? 'finalized' : 'pending'
      });
    }
    if (!match[3]) {
      const list = [{
        traceId: trace.traceId, spanId: trace.rootSpanId, parentSpanId: null,
        spanName: 'agent_harness.workflow_event', spanType: 'WORKFLOW'
      }];
      if (spans !== 'root-only') {
        list.push({
          traceId: trace.traceId, spanId: trace.markerSpanId, parentSpanId: trace.rootSpanId,
          spanName: 'neatlogs.trace.complete', spanType: 'INTERNAL'
        });
      }
      if (spans === 'duplicate') list.push({ ...list[0] });
      return ok({ spans: list, page: { hasMore: false, limit: 50, nextCursor: null } });
    }
    return ok({
      fields: {
        input: {
          available: true,
          truncated: false,
          mimeType: 'application/json',
          value: inputFor ? inputFor(trace) : trace.input
        }
      }
    });
  });
}

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'neatlogs-live-test-'));
  plan = await buildPlan();
});

after(() => rmSync(scratch, { recursive: true, force: true }));

describe('configuration', () => {
  test('loads only documented names, prefers process values and redacts output', () => {
    const file = join(scratch, 'neatlogs.env');
    writeFileSync(file, [
      '# comment',
      `NEATLOGS_API_KEY="${INGEST_KEY}"`,
      `export NEATLOGS_PROJECT_ID=${PROJECT_ID}`,
      'NEATLOGS_TOKEN=',
      'UNRELATED_SECRET=should-not-be-read',
      ''
    ].join('\n'));
    assert.deepEqual(Object.keys(readNeatlogsEnvFile(file)).sort(), [
      'NEATLOGS_API_KEY', 'NEATLOGS_PROJECT_ID', 'NEATLOGS_TOKEN'
    ]);
    const config = loadNeatlogsConfig({ env: { NEATLOGS_TOKEN: READ_TOKEN }, envFile: file });
    assert.equal(config.summary.region, 'us');
    assert.equal(config.summary.ingestReady, true);
    assert.equal(config.summary.readbackReady, true);
    assert.equal(config.ingestKey(), INGEST_KEY);
    assert.equal(config.readbackToken(), READ_TOKEN);
    for (const rendered of [JSON.stringify(config), inspect(config), String(Object.values(config.summary))]) {
      assert.ok(!rendered.includes(INGEST_KEY));
      assert.ok(!rendered.includes(READ_TOKEN));
    }
  });

  test('derives EU origins and refuses mixed regions or malformed values', () => {
    const eu = configured({ NEATLOGS_ENDPOINT: 'https://eu.ingest.neatlogs.com/v1/traces' });
    assert.equal(eu.summary.region, 'eu');
    assert.equal(eu.summary.appOrigin, 'https://eu.app.neatlogs.com');
    assert.throws(() => configured({
      NEATLOGS_ENDPOINT: 'https://eu.ingest.neatlogs.com',
      NEATLOGS_HOST: 'https://app.neatlogs.com'
    }), error => error instanceof NeatlogsConfigError && error.code === 'REGION_MISMATCH');
    assert.throws(() => configured({ NEATLOGS_HOST: 'http://app.neatlogs.com' }),
      error => error.code === 'INVALID_ORIGIN');
    assert.throws(() => configured({ NEATLOGS_PROJECT_ID: 'not-a-uuid' }),
      error => error.code === 'INVALID_PROJECT_ID');
    assert.throws(() => configured({ NEATLOGS_API_KEY: 'has space in it 0123456789' }),
      error => error.code === 'INVALID_CREDENTIAL' && !error.message.includes('space'));
  });

  test('scrubs recognized names from an environment object', () => {
    const env = { NEATLOGS_API_KEY: INGEST_KEY, NEATLOGS_HOST: 'https://app.neatlogs.com', PATH: '/bin' };
    assert.deepEqual([...scrubNeatlogsEnvironment(env)], ['NEATLOGS_API_KEY', 'NEATLOGS_HOST']);
    assert.deepEqual(env, { PATH: '/bin' });
  });
});

describe('export encoding', () => {
  test('encodes a valid OTLP request with deterministic IDs and no raw content', () => {
    const body = encodeNeatlogsExportRequest(plan);
    for (const canary of CANARIES) assert.ok(!body.toString('latin1').includes(canary));
    const decoded = ExportRequest.toObject(ExportRequest.decode(body), { longs: String, bytes: String });
    const spans = decoded.resourceSpans[0].scopeSpans.flatMap(scope => scope.spans);
    assert.equal(spans.length, plan.traces.length * 2);
    for (const trace of plan.traces) {
      assert.deepEqual(deterministicNeatlogsIds(trace.eventToken), {
        traceId: trace.traceId, rootSpanId: trace.rootSpanId, markerSpanId: trace.markerSpanId
      });
      const root = spans.find(span => Buffer.from(span.spanId, 'base64').toString('hex') === trace.rootSpanId);
      const attributes = Object.fromEntries(root.attributes.map(item => [item.key, Object.values(item.value)[0]]));
      assert.equal(Buffer.from(root.traceId, 'base64').toString('hex'), trace.traceId);
      assert.equal(root.parentSpanId, undefined);
      assert.equal(attributes['neatlogs.session.id'], trace.sessionId);
      assert.equal(attributes['neatlogs.workflow.input'], trace.input);
      assert.equal(attributes['neatlogs.tags'], plan.tags.join(','));
      assert.equal(attributes['agent_harness.telemetry.event_token'], trace.eventToken);
      const marker = spans.find(span => Buffer.from(span.spanId, 'base64').toString('hex') === trace.markerSpanId);
      assert.equal(Buffer.from(marker.parentSpanId, 'base64').toString('hex'), trace.rootSpanId);
    }
    assert.deepEqual(encodeNeatlogsExportRequest(plan), body, 'retries resend identical bytes');
  });

  test('decodes full success, partial rejection and malformed responses strictly', () => {
    assert.deepEqual({ ...decodeNeatlogsExportResponse(Buffer.alloc(0), '') },
      { rejectedSpans: 0, receiverMessagePresent: false });
    const partial = ExportResponse.encode({ partialSuccess: { rejectedSpans: 2, errorMessage: 'nope' } }).finish();
    assert.deepEqual({ ...decodeNeatlogsExportResponse(partial, 'application/x-protobuf') },
      { rejectedSpans: 2, receiverMessagePresent: true });
    assert.equal(decodeNeatlogsExportResponse(
      Buffer.from('{"partialSuccess":{"rejectedSpans":"1"}}'), 'application/json').rejectedSpans, 1);
    assert.throws(() => decodeNeatlogsExportResponse(Buffer.from([0x0a, 0x05]), 'application/x-protobuf'),
      error => error.code === 'MALFORMED_RESPONSE');
    assert.throws(() => decodeNeatlogsExportResponse(Buffer.from('<html>'), 'text/html'),
      error => error.code === 'UNEXPECTED_RESPONSE_TYPE');
  });

  test('delivery generations keep generation 0 stable and give new IDs after a loss', () => {
    const trace = plan.traces[0];
    assert.deepEqual(deterministicNeatlogsIds(trace.eventToken, 0), deterministicNeatlogsIds(trace.eventToken));
    const next = nextNeatlogsGeneration(plan, [trace.traceId]);
    assert.equal(next.traces.length, 1);
    const moved = next.traces[0];
    assert.equal(moved.generation, 1);
    assert.deepEqual([...moved.priorTraceIds], [trace.traceId]);
    assert.notEqual(moved.traceId, trace.traceId);
    assert.notEqual(moved.rootSpanId, trace.rootSpanId);
    assert.deepEqual(deterministicNeatlogsIds(trace.eventToken, 1), {
      traceId: moved.traceId, rootSpanId: moved.rootSpanId, markerSpanId: moved.markerSpanId
    });
    assert.equal(moved.input, trace.input, 'content and session are unchanged');
    assert.equal(moved.sessionId, trace.sessionId);
    const third = nextNeatlogsGeneration(next, [moved.traceId]).traces[0];
    assert.deepEqual([...third.priorTraceIds], [trace.traceId, moved.traceId]);
    assert.throws(() => deterministicNeatlogsIds(trace.eventToken, 4), error => error.code === 'INVALID_GENERATION');
    assert.throws(() => nextNeatlogsGeneration(plan, ['f'.repeat(32)]), error => error.code === 'UNKNOWN_TRACE');
  });

  test('refuses envelopes that are not complete sanitized captures', () => {
    assert.throws(() => planNeatlogsExport({ spans: [], rootSpanCount: 0, remoteIngestionVerified: false }),
      error => error.code === 'INVALID_ENVELOPE');
    assert.throws(() => planNeatlogsExport({ spans: [], rootSpanCount: 0, remoteIngestionVerified: false },
      { tags: ['Bad,Tag'] }), error => error.code === 'INVALID_TAGS');
  });
});

describe('send', () => {
  test('makes no request without an ingest key', async () => {
    const { fetchImpl, calls } = recordingFetch(() => response(200));
    const result = await sendNeatlogsPlan(loadNeatlogsConfig({ env: {} }), plan, { fetch: fetchImpl });
    assert.equal(result.status, 'not_configured');
    assert.equal(calls.length, 0);
  });

  test('receiver acceptance is reported without claiming delivery', async () => {
    const { fetchImpl, calls } = recordingFetch(() => response(200, null));
    const result = await sendNeatlogsPlan(configured(), plan, { fetch: fetchImpl });
    assert.equal(result.status, 'receiver_accepted');
    assert.equal(result.deliveryConfirmed, false);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://ingest.neatlogs.com/v1/traces');
    assert.equal(calls[0].init.headers['x-api-key'], INGEST_KEY);
    assert.equal(calls[0].init.redirect, 'error');
    assert.ok(!JSON.stringify(result).includes(INGEST_KEY));
  });

  test('partial rejection is never folded into success', async () => {
    const body = ExportResponse.encode({ partialSuccess: { rejectedSpans: 1 } }).finish();
    const { fetchImpl } = recordingFetch(() => response(200, body, { 'content-type': 'application/x-protobuf' }));
    const result = await sendNeatlogsPlan(configured(), plan, { fetch: fetchImpl });
    assert.equal(result.status, 'partially_rejected');
    assert.equal(result.rejectedSpans, 1);
  });

  test('credential rejection stops immediately', async () => {
    const { fetchImpl, calls } = recordingFetch(() => response(401, 'unauthorized'));
    const result = await sendNeatlogsPlan(configured(), plan, { fetch: fetchImpl, retryDelayMs: 0 });
    assert.equal(result.status, 'rejected');
    assert.equal(result.reasonCode, 'CREDENTIAL_REJECTED');
    assert.equal(calls.length, 1);
  });

  test('retries 5xx with identical bytes, then reports an unknown outcome', async () => {
    const { fetchImpl, calls } = recordingFetch(() => response(503, 'busy'));
    const result = await sendNeatlogsPlan(configured(), plan, { fetch: fetchImpl, retryDelayMs: 0, maxAttempts: 3 });
    assert.equal(result.status, 'outcome_unknown');
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[1].init.body, calls[0].init.body);
  });

  test('a timeout is an unknown outcome and a later success is still unconfirmed', async () => {
    const hang = (url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    const timedOut = await sendNeatlogsPlan(configured(), plan, {
      fetch: hang, timeoutMs: 100, maxAttempts: 1
    });
    assert.equal(timedOut.status, 'outcome_unknown');
    assert.equal(timedOut.reasonCode, 'TRANSPORT_FAILED');
    const { fetchImpl } = recordingFetch((url, init, count) => count === 1 ? hang(url, init) : response(200, null));
    const recovered = await sendNeatlogsPlan(configured(), plan, {
      fetch: fetchImpl, timeoutMs: 100, maxAttempts: 2, retryDelayMs: 0
    });
    assert.equal(recovered.status, 'receiver_accepted');
    assert.equal(recovered.deliveryConfirmed, false);
  });

  test('honors bounded Retry-After on 429 and reports not_accepted', async () => {
    const { fetchImpl, calls } = recordingFetch(() => response(429, '', { 'retry-after': '0' }));
    const result = await sendNeatlogsPlan(configured(), plan, { fetch: fetchImpl, maxAttempts: 2 });
    assert.equal(result.status, 'not_accepted');
    assert.equal(calls.length, 2);
  });

  test('an abort before sending makes no request', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl, calls } = recordingFetch(() => response(200));
    const result = await sendNeatlogsPlan(configured(), plan, { fetch: fetchImpl, signal: controller.signal });
    assert.equal(result.status, 'aborted');
    assert.equal(calls.length, 0);
  });
});

describe('readback', () => {
  test('is unavailable without a service-account token and project', async () => {
    const result = await readbackNeatlogsPlan(configured({ NEATLOGS_TOKEN: '' }), plan);
    assert.equal(result.status, 'readback_unavailable');
    assert.equal(result.reasonCode, 'MISSING_READBACK_TOKEN');
  });

  test('verifies IDs, session, tags, span tree and input after finalization', async () => {
    const { fetchImpl, calls } = readbackServer({ finalizeAfter: 2 });
    const result = await readbackNeatlogsPlan(configured(), plan, { fetch: fetchImpl, pollIntervalMs: 0 });
    assert.equal(result.status, 'verified');
    assert.equal(result.traces.length, plan.traces.length);
    assert.ok(result.traces.every(trace => trace.markerStored));
    const first = calls[0];
    assert.equal(first.url, 'https://app.neatlogs.com/api/v1/public/project');
    assert.equal(first.init.headers.authorization, `Bearer ${READ_TOKEN}`);
    assert.equal(first.init.headers['x-project-id'], PROJECT_ID);
    assert.ok(!JSON.stringify(result).includes(READ_TOKEN));
  });

  test('accepts a receiver that does not store the completion marker as a span', async () => {
    const { fetchImpl } = readbackServer({ spans: 'root-only' });
    const result = await readbackNeatlogsPlan(configured(), plan, { fetch: fetchImpl, pollIntervalMs: 0 });
    assert.equal(result.status, 'verified');
    assert.ok(result.traces.every(trace => trace.markerStored === false));
  });

  test('stays pending, never verified, while traces are not finalized', async () => {
    const { fetchImpl } = readbackServer({ finalizeAfter: 99 });
    const result = await readbackNeatlogsPlan(configured(), plan, {
      fetch: fetchImpl, pollIntervalMs: 0, maxPolls: 2
    });
    assert.equal(result.status, 'pending');
  });

  test('flags duplicate spans, missing tags, altered input and the wrong project', async () => {
    const duplicate = await readbackNeatlogsPlan(configured(), plan, {
      fetch: readbackServer({ spans: 'duplicate' }).fetchImpl, pollIntervalMs: 0
    });
    assert.equal(duplicate.status, 'mismatch');
    assert.ok(duplicate.traces[0].problems.includes('DUPLICATE_SPANS_OBSERVED'));
    const tags = await readbackNeatlogsPlan(configured(), plan, {
      fetch: readbackServer({ tags: [] }).fetchImpl, pollIntervalMs: 0
    });
    assert.ok(tags.traces[0].problems.includes('TAGS_MISSING'));
    const input = await readbackNeatlogsPlan(configured(), plan, {
      fetch: readbackServer({ inputFor: () => '{"changed":true}' }).fetchImpl, pollIntervalMs: 0
    });
    assert.ok(input.traces[0].problems.includes('INPUT_PAYLOAD_MISMATCH'));
    const project = await readbackNeatlogsPlan(configured(), plan, {
      fetch: readbackServer({ projectId: '00000000-0000-4000-8000-000000000002' }).fetchImpl, pollIntervalMs: 0
    });
    assert.equal(project.reasonCode, 'PROJECT_MISMATCH');
  });

  test('reports never-found traces as missing, not pending', async () => {
    const dropped = plan.traces[2].traceId;
    const result = await readbackNeatlogsPlan(configured(), plan, {
      fetch: readbackServer({ droppedIds: [dropped] }).fetchImpl, pollIntervalMs: 0, maxPolls: 2
    });
    assert.equal(result.status, 'missing');
    assert.equal(result.reasonCode, 'NOT_FOUND_AFTER_POLLS');
    assert.deepEqual(result.traces.filter(trace => trace.status === 'missing').map(trace => trace.traceId), [dropped]);
    assert.equal(result.traces.filter(trace => trace.status === 'verified').length, plan.traces.length - 1);
  });

  test('verifies a regenerated trace and reports an event stored under two generations', async () => {
    const lost = plan.traces[2];
    const regenerated = nextNeatlogsGeneration(plan, [lost.traceId]);
    const clean = await readbackNeatlogsPlan(configured(), regenerated, {
      fetch: readbackServer({ served: regenerated }).fetchImpl, pollIntervalMs: 0
    });
    assert.equal(clean.status, 'verified');
    assert.equal(clean.duplicateEventDeliveries, 0);
    const doubled = await readbackNeatlogsPlan(configured(), regenerated, {
      fetch: readbackServer({ served: regenerated, alsoStored: [lost.traceId] }).fetchImpl, pollIntervalMs: 0
    });
    assert.equal(doubled.status, 'verified');
    assert.equal(doubled.duplicateEventDeliveries, 1);
    assert.deepEqual([...doubled.traces[0].duplicateTraceIds], [lost.traceId]);
  });

  test('stops on authorization failure', async () => {
    const { fetchImpl, calls } = recordingFetch(() => response(403, '{}'));
    const result = await readbackNeatlogsPlan(configured(), plan, { fetch: fetchImpl });
    assert.equal(result.status, 'readback_failed');
    assert.equal(result.reasonCode, 'READBACK_UNAUTHORIZED');
    assert.equal(calls.length, 1);
  });
});
