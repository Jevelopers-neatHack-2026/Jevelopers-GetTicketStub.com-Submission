import { isDeepStrictEqual } from 'node:util';
import { NEATLOGS_COMPLETION_SPAN_NAME, NEATLOGS_LOCAL_SPAN_NAME } from './neatlogs-sdk-mapper.js';
import {
  NeatlogsOtlpError,
  decodeNeatlogsExportResponse,
  encodeNeatlogsExportRequest
} from './neatlogs-otlp.js';

const SEND_DEFAULTS = Object.freeze({ timeoutMs: 5_000, maxAttempts: 3, retryDelayMs: 500 });
const SEND_BOUNDS = Object.freeze({
  timeoutMs: [100, 15_000],
  maxAttempts: [1, 5],
  retryDelayMs: [0, 5_000]
});
const READBACK_DEFAULTS = Object.freeze({ timeoutMs: 5_000, maxPolls: 10, pollIntervalMs: 2_000 });
const READBACK_BOUNDS = Object.freeze({
  timeoutMs: [100, 15_000],
  maxPolls: [1, 30],
  pollIntervalMs: [0, 10_000]
});
const MAX_RETRY_AFTER_MS = 10_000;
const MAX_READ_BYTES = 256 * 1024;
const MAX_TRACES = 32;

function bounded(options, defaults, bounds) {
  const result = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (options?.[key] === undefined) continue;
    const value = options[key];
    const [minimum, maximum] = bounds[key];
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new TypeError(`Neatlogs option ${key} is out of bounds.`);
    }
    result[key] = value;
  }
  return Object.freeze(result);
}

function sleep(milliseconds, signal) {
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise(resolve => {
    const timer = setTimeout(done, milliseconds);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', done);
      resolve();
    }
    signal?.addEventListener?.('abort', done, { once: true });
  });
}

function retryAfterMs(response, fallback) {
  const header = response.headers?.get?.('retry-after');
  const seconds = Number(header);
  if (header !== null && header !== undefined && Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.ceil(seconds * 1000));
  }
  return fallback;
}

async function readBounded(response) {
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_READ_BYTES) {
    await response.body?.cancel?.();
    throw new NeatlogsOtlpError('RESPONSE_TOO_LARGE');
  }
  if (!response.body?.getReader) return Buffer.from(await response.arrayBuffer());
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_READ_BYTES) {
      await reader.cancel();
      throw new NeatlogsOtlpError('RESPONSE_TOO_LARGE');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk)), total);
}

async function boundedFetch(fetchImpl, url, init, timeoutMs, signal) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal });
    const body = await readBounded(response);
    return { response, body };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.('abort', onAbort);
  }
}

function sendResult(status, fields) {
  // `deliveryConfirmed` stays false here by construction: receiver acceptance
  // is not delivery. Only readback verification can confirm a trace.
  return Object.freeze({ status, deliveryConfirmed: false, ...fields });
}

/**
 * Sends one export plan to the configured regional OTLP/HTTP ingest route.
 * Results:
 * - receiver_accepted: HTTP 2xx and zero rejected spans (still unconfirmed);
 * - partially_rejected / rejected: the receiver refused some or all spans;
 * - outcome_unknown: timeout, network failure, 5xx or an unparseable 2xx, so
 *   the spans may or may not have been stored;
 * - not_configured / aborted: no request was completed.
 * Retries reuse the identical body and deterministic IDs.
 */
export async function sendNeatlogsPlan(config, plan, options = {}) {
  const limits = bounded(options, SEND_DEFAULTS, SEND_BOUNDS);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const signal = options.signal;
  const expectedSpans = plan.traces.length * 2;
  if (plan.traces.length < 1 || plan.traces.length > MAX_TRACES) {
    return sendResult('rejected', { reasonCode: 'INVALID_PLAN', attempts: 0, expectedSpans });
  }
  if (!config?.summary?.ingestReady) {
    return sendResult('not_configured', { reasonCode: 'MISSING_INGEST_KEY', attempts: 0, expectedSpans });
  }
  const body = encodeNeatlogsExportRequest(plan);
  const url = `${config.summary.ingestOrigin}/v1/traces`;
  let attempts = 0;
  let last = { reasonCode: 'NOT_ATTEMPTED', httpStatus: null };
  let anyAmbiguous = false;
  while (attempts < limits.maxAttempts) {
    if (signal?.aborted) {
      return sendResult(anyAmbiguous ? 'outcome_unknown' : 'aborted', {
        reasonCode: 'ABORTED', attempts, expectedSpans, httpStatus: last.httpStatus
      });
    }
    attempts += 1;
    let delay = limits.retryDelayMs * 2 ** (attempts - 1);
    try {
      const { response, body: responseBody } = await boundedFetch(fetchImpl, url, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-protobuf',
          'x-api-key': config.ingestKey()
        },
        body
      }, limits.timeoutMs, signal);
      const httpStatus = response.status;
      if (httpStatus >= 200 && httpStatus < 300) {
        let parsed;
        try {
          parsed = decodeNeatlogsExportResponse(responseBody, response.headers?.get?.('content-type') ?? '');
        } catch (error) {
          return sendResult('outcome_unknown', {
            reasonCode: error?.code ?? 'MALFORMED_RESPONSE', attempts, expectedSpans, httpStatus
          });
        }
        if (parsed.rejectedSpans > 0) {
          return sendResult('partially_rejected', {
            reasonCode: 'RECEIVER_REJECTED_SPANS',
            attempts,
            expectedSpans,
            httpStatus,
            rejectedSpans: Math.min(parsed.rejectedSpans, expectedSpans),
            receiverMessagePresent: parsed.receiverMessagePresent
          });
        }
        return sendResult('receiver_accepted', {
          reasonCode: null,
          attempts,
          expectedSpans,
          httpStatus,
          rejectedSpans: 0,
          receiverMessagePresent: parsed.receiverMessagePresent
        });
      }
      if (httpStatus === 401 || httpStatus === 403) {
        return sendResult('rejected', { reasonCode: 'CREDENTIAL_REJECTED', attempts, expectedSpans, httpStatus });
      }
      if (httpStatus === 429) {
        last = { reasonCode: 'RATE_LIMITED', httpStatus };
        delay = retryAfterMs(response, delay);
      } else if (httpStatus >= 500) {
        anyAmbiguous = true;
        last = { reasonCode: 'RECEIVER_UNAVAILABLE', httpStatus };
      } else {
        return sendResult('rejected', { reasonCode: 'RECEIVER_REFUSED_REQUEST', attempts, expectedSpans, httpStatus });
      }
    } catch (error) {
      if (error?.code === 'RESPONSE_TOO_LARGE') {
        anyAmbiguous = true;
        last = { reasonCode: 'RESPONSE_TOO_LARGE', httpStatus: null };
      } else {
        // A timeout or connection loss after the request was written leaves
        // the remote outcome unknown.
        anyAmbiguous = true;
        last = { reasonCode: signal?.aborted ? 'ABORTED' : 'TRANSPORT_FAILED', httpStatus: null };
      }
    }
    if (attempts < limits.maxAttempts) await sleep(Math.min(delay, MAX_RETRY_AFTER_MS), signal);
  }
  return sendResult(anyAmbiguous ? 'outcome_unknown' : 'not_accepted', {
    reasonCode: last.reasonCode, attempts, expectedSpans, httpStatus: last.httpStatus
  });
}

class ReadbackStop extends Error {
  constructor(code, httpStatus = null) {
    super(code);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

function createReader(config, fetchImpl, limits, signal) {
  const base = `${config.summary.appOrigin}/api/v1/public`;
  return async function get(path, { allowMissing = false } = {}) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      let result;
      try {
        result = await boundedFetch(fetchImpl, `${base}${path}`, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${config.readbackToken()}`,
            'x-project-id': config.summary.projectId
          }
        }, limits.timeoutMs, signal);
      } catch {
        if (attempt === 3 || signal?.aborted) throw new ReadbackStop('READBACK_TRANSPORT_FAILED');
        await sleep(500 * attempt, signal);
        continue;
      }
      const { response, body } = result;
      const status = response.status;
      if (status === 401 || status === 403) throw new ReadbackStop('READBACK_UNAUTHORIZED', status);
      if ((status === 404 || status === 409) && allowMissing) return { status, data: null };
      if (status === 429 || status === 503) {
        if (attempt === 3) throw new ReadbackStop('READBACK_RATE_LIMITED', status);
        await sleep(retryAfterMs(response, 1_000 * attempt), signal);
        continue;
      }
      if (status !== 200) throw new ReadbackStop('READBACK_HTTP_ERROR', status);
      let parsed;
      try {
        parsed = JSON.parse(body.toString('utf8'));
      } catch {
        throw new ReadbackStop('READBACK_MALFORMED_RESPONSE', status);
      }
      if (parsed?.success !== true || parsed.data === null || typeof parsed.data !== 'object') {
        throw new ReadbackStop('READBACK_MALFORMED_RESPONSE', status);
      }
      return { status, data: parsed.data, requestId: typeof parsed.requestId === 'string' ? parsed.requestId : null };
    }
    throw new ReadbackStop('READBACK_TRANSPORT_FAILED');
  };
}

function compareTrace(plan, expected, trace, spans, payload) {
  const problems = [];
  if (trace.traceId !== expected.traceId) problems.push('TRACE_ID_MISMATCH');
  if (trace.sessionId !== expected.sessionId) problems.push('SESSION_ID_MISMATCH');
  if (trace.workflowName !== plan.workflowName) problems.push('WORKFLOW_NAME_MISMATCH');
  const tags = Array.isArray(trace.tags) ? trace.tags : [];
  if (!plan.tags.every(tag => tags.includes(tag))) problems.push('TAGS_MISSING');
  const ids = spans.map(span => span.spanId);
  if (new Set(ids).size !== ids.length) problems.push('DUPLICATE_SPANS_OBSERVED');
  const root = spans.filter(span => span.spanId === expected.rootSpanId);
  if (root.length !== 1 || root[0].parentSpanId !== null
      || root[0].spanName !== NEATLOGS_LOCAL_SPAN_NAME || root[0].traceId !== expected.traceId) {
    problems.push('ROOT_SPAN_MISMATCH');
  }
  const marker = spans.filter(span => span.spanId === expected.markerSpanId);
  if (marker.length > 1 || (marker.length === 1
      && (marker[0].parentSpanId !== expected.rootSpanId
        || marker[0].spanName !== NEATLOGS_COMPLETION_SPAN_NAME))) {
    problems.push('MARKER_SPAN_MISMATCH');
  }
  const unexpected = spans.filter(span => span.spanId !== expected.rootSpanId
    && span.spanId !== expected.markerSpanId);
  if (unexpected.length > 0) problems.push('UNEXPECTED_SPANS');
  let payloadMatches = false;
  const input = payload?.fields?.input;
  if (input?.available === true && input.truncated === false && typeof input.value === 'string') {
    try {
      payloadMatches = isDeepStrictEqual(JSON.parse(input.value), JSON.parse(expected.input));
    } catch {
      payloadMatches = false;
    }
  }
  if (!payloadMatches) problems.push('INPUT_PAYLOAD_MISMATCH');
  return {
    problems,
    markerStored: marker.length === 1,
    spansCount: Number.isSafeInteger(trace.spansCount) ? trace.spansCount : null
  };
}

/**
 * Reads every planned trace back through the Public API with a service-account
 * token bound to the configured project, polling until finalized. A trace is
 * `verified` only when its IDs, session, workflow, tags, span tree and exported
 * input all match what was sent.
 */
export async function readbackNeatlogsPlan(config, plan, options = {}) {
  const limits = bounded(options, READBACK_DEFAULTS, READBACK_BOUNDS);
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const signal = options.signal;
  if (!config?.summary?.readbackReady) {
    return Object.freeze({
      status: 'readback_unavailable',
      reasonCode: config?.summary?.readbackTokenConfigured ? 'MISSING_PROJECT_ID' : 'MISSING_READBACK_TOKEN',
      traces: Object.freeze([])
    });
  }
  const get = createReader(config, fetchImpl, limits, signal);
  try {
    const project = await get('/project');
    if (project.data.id !== config.summary.projectId) {
      return Object.freeze({ status: 'mismatch', reasonCode: 'PROJECT_MISMATCH', traces: Object.freeze([]) });
    }
    const outcomes = new Map(plan.traces.map(trace => [trace.traceId, {
      traceId: trace.traceId,
      rootSpanId: trace.rootSpanId,
      sessionId: trace.sessionId,
      sequence: trace.sequence,
      eventType: trace.eventType,
      revision: trace.revision,
      fence: trace.fence,
      generation: trace.generation ?? 0,
      status: 'pending',
      problems: ['NOT_FOUND'],
      duplicateTraceIds: []
    }]));
    for (let poll = 1; poll <= limits.maxPolls; poll += 1) {
      for (const expected of plan.traces) {
        const outcome = outcomes.get(expected.traceId);
        if (outcome.status === 'verified' || outcome.status === 'mismatch') continue;
        const trace = await get(`/traces/${expected.traceId}`, { allowMissing: true });
        if (trace.data === null) continue;
        outcome.finalizationStatus = trace.data.finalizationStatus ?? null;
        outcome.traceRequestId = trace.requestId;
        if (trace.data.finalizationStatus === 'dlq') {
          Object.assign(outcome, { status: 'mismatch', problems: ['TRACE_DEAD_LETTERED'] });
          continue;
        }
        if (trace.data.finalizationStatus !== 'finalized') {
          outcome.problems = ['NOT_FINALIZED'];
          continue;
        }
        const spans = await get(`/traces/${expected.traceId}/spans?limit=50`, { allowMissing: true });
        const payload = await get(
          `/traces/${expected.traceId}/spans/${expected.rootSpanId}/payload?fields=input`,
          { allowMissing: true }
        );
        if (spans.data === null || payload.data === null) {
          outcome.problems = ['PROJECTION_NOT_READY'];
          continue;
        }
        const comparison = compareTrace(plan, expected, trace.data, spans.data.spans ?? [], payload.data);
        // An earlier generation of the same event that did get stored means
        // the event now exists twice remotely. Report it; do not hide it.
        for (const priorId of expected.priorTraceIds ?? []) {
          const prior = await get(`/traces/${priorId}`, { allowMissing: true });
          if (prior.data !== null) outcome.duplicateTraceIds.push(priorId);
        }
        Object.assign(outcome, {
          status: comparison.problems.length === 0 ? 'verified' : 'mismatch',
          problems: comparison.problems,
          markerStored: comparison.markerStored,
          spansCount: comparison.spansCount,
          workflowName: trace.data.workflowName ?? null,
          tags: Array.isArray(trace.data.tags) ? [...trace.data.tags] : []
        });
      }
      const pending = [...outcomes.values()].some(outcome => outcome.status === 'pending');
      if (!pending || poll === limits.maxPolls) break;
      await sleep(limits.pollIntervalMs, signal);
    }
    // Never found within the poll budget is reported as `missing`: the
    // receiver may have dropped the trace ID, so only a new generation can
    // recover it. Found but unfinalized stays `pending`.
    for (const outcome of outcomes.values()) {
      if (outcome.status === 'pending' && outcome.problems.includes('NOT_FOUND')) outcome.status = 'missing';
    }
    const traces = Object.freeze([...outcomes.values()].map(outcome => Object.freeze({
      ...outcome,
      problems: Object.freeze([...outcome.problems]),
      duplicateTraceIds: Object.freeze([...outcome.duplicateTraceIds])
    })));
    const status = traces.every(trace => trace.status === 'verified')
      ? 'verified'
      : traces.some(trace => trace.status === 'mismatch') ? 'mismatch'
        : traces.some(trace => trace.status === 'pending') ? 'pending' : 'missing';
    const reasonCodes = {
      verified: null, pending: 'NOT_YET_READABLE', missing: 'NOT_FOUND_AFTER_POLLS', mismatch: 'READBACK_MISMATCH'
    };
    return Object.freeze({
      status,
      reasonCode: reasonCodes[status],
      duplicateEventDeliveries: traces.filter(trace => trace.duplicateTraceIds.length > 0).length,
      project: Object.freeze({ id: project.data.id, name: typeof project.data.name === 'string' ? project.data.name : null }),
      traces
    });
  } catch (error) {
    if (error instanceof ReadbackStop) {
      return Object.freeze({
        status: 'readback_failed',
        reasonCode: error.code,
        httpStatus: error.httpStatus,
        traces: Object.freeze([])
      });
    }
    throw error;
  }
}

export const NEATLOGS_LIVE_LIMITS = Object.freeze({
  send: Object.freeze({ defaults: SEND_DEFAULTS, bounds: SEND_BOUNDS }),
  readback: Object.freeze({ defaults: READBACK_DEFAULTS, bounds: READBACK_BOUNDS }),
  maxRetryAfterMs: MAX_RETRY_AFTER_MS,
  maxReadBytes: MAX_READ_BYTES,
  maxTraces: MAX_TRACES
});
