import {
  closeSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, writeSync
} from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { DurableWorkflowStore } from '../../internal/durable-store.js';
import { createHmacTokenizer, createTelemetryExporter } from '../../internal/telemetry.js';
import { loadNeatlogsConfig, scrubNeatlogsEnvironment } from './neatlogs-config.js';
import {
  canonicalNeatlogsInput,
  deterministicNeatlogsIds,
  encodeNeatlogsExportRequest,
  NEATLOGS_LIVE_WORKFLOW_NAME,
  nextNeatlogsGeneration,
  parseNeatlogsJson,
  planNeatlogsExport,
  validateNeatlogsTags
} from './neatlogs-otlp.js';
import { readbackNeatlogsPlan, sendNeatlogsPlan } from './neatlogs-live.js';
import { validateNeatlogsSourceRecords } from './neatlogs-sdk-mapper.js';

// Durable local outbox between the harness TelemetryExporter and the Neatlogs
// OTLP sender. The exporter's sink contract is local and short (<= 500 ms,
// retried on timeout), so the sink only appends a validated batch of
// already-projected records to this outbox. Network delivery happens later in
// `drainNeatlogsOutbox`, which records each batch's send and readback state.
//
// Batch state: pending_send -> receiver_accepted -> verified | pending | missing
// | mismatch | readback_failed. Retryable send outcomes (outcome_unknown,
// not_accepted, aborted) stay pending_send and resend identical IDs.

export const NEATLOGS_OUTBOX_SCHEMA = 'agent-harness.neatlogs.outbox-batch.v1';
const BATCH_FILE = /^batch-(\d{12})-(\d{12})\.json$/;
const MAX_BATCH_FILE_BYTES = 128 * 1024;
const MAX_BATCHES_PER_DRAIN = 32;
const RETRYABLE_SEND = new Set(['outcome_unknown', 'not_accepted', 'aborted', 'not_configured']);
const TERMINAL_READBACK = new Set(['verified', 'mismatch']);
const REVISION = /^[0-9a-f]{40}$/;
const MODE = /^[a-z][a-z0-9-]{0,31}$/;

export class NeatlogsOutboxError extends Error {
  constructor(code) {
    super(`Neatlogs outbox operation failed (${code}).`);
    this.name = 'NeatlogsOutboxError';
    this.code = code;
  }
}

function pad(sequence) {
  return String(sequence).padStart(12, '0');
}

function writeDurably(path, text) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, path);
  let dirFd;
  try {
    dirFd = openSync(resolve(path, '..'), 'r');
    fsyncSync(dirFd);
  } catch {
    // Directory fsync is best effort on platforms that refuse it.
  } finally {
    if (dirFd !== undefined) closeSync(dirFd);
  }
}

function readBatch(path) {
  const stats = statSync(path);
  if (!stats.isFile() || stats.size > MAX_BATCH_FILE_BYTES) throw new NeatlogsOutboxError('BATCH_INVALID');
  const batch = parseNeatlogsJson(readFileSync(path, 'utf8'));
  if (batch?.schema !== NEATLOGS_OUTBOX_SCHEMA || typeof batch.state !== 'string') {
    throw new NeatlogsOutboxError('BATCH_INVALID');
  }
  batch.records = validateNeatlogsSourceRecords(batch.records);
  return batch;
}

function recordsJson(records) {
  return JSON.stringify(records.map(record => ({ ...record })));
}

/**
 * Tags for a trace emitted by the harness runtime itself. Never includes
 * `evidence:synthetic`; the harness dependency mode is recorded explicitly.
 */
export function runtimeNeatlogsTags({ revision, harnessMode }) {
  if (typeof revision !== 'string' || !REVISION.test(revision)
      || typeof harnessMode !== 'string' || !MODE.test(harnessMode)) {
    throw new NeatlogsOutboxError('INVALID_TAG_INPUT');
  }
  return validateNeatlogsTags([
    `agent-harness@${revision}`,
    'evidence:runtime',
    `harness-mode:${harnessMode}`
  ]);
}

/**
 * Returns a TelemetryExporter sink that durably appends each accepted batch to
 * `directory`. It performs no network I/O, so it fits the exporter's bounded
 * sink contract. Records already stored are accepted again without
 * rewriting; a record that differs from the stored copy is refused.
 */
export function createNeatlogsOutboxSink({ directory }) {
  if (typeof directory !== 'string' || directory.length === 0) throw new NeatlogsOutboxError('INVALID_DIRECTORY');
  const root = resolve(directory);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return function neatlogsOutboxSink(records, { signal } = {}) {
    if (signal?.aborted) return { accepted: false, acceptedCount: 0 };
    const validated = validateNeatlogsSourceRecords(records);
    // A retry after a sink timeout can carry a page that has grown since the
    // first attempt. Records already in the outbox must match exactly; only
    // the uncovered suffix is written, so no event is stored twice.
    const stored = new Map();
    for (const existingPath of listNeatlogsOutbox(root)) {
      const [, firstText, lastText] = BATCH_FILE.exec(existingPath.slice(root.length + 1));
      if (Number(lastText) < validated[0].sequence || Number(firstText) > validated.at(-1).sequence) continue;
      for (const record of readBatch(existingPath).records) stored.set(record.sequence, record);
    }
    const fresh = [];
    for (const record of validated) {
      const existing = stored.get(record.sequence);
      if (existing === undefined) fresh.push(record);
      else if (recordsJson([existing]) !== recordsJson([record])) throw new NeatlogsOutboxError('BATCH_CONFLICT');
      else if (fresh.length > 0) throw new NeatlogsOutboxError('BATCH_CONFLICT');
    }
    if (fresh.length === 0) return { accepted: true, acceptedCount: validated.length };
    const first = fresh[0].sequence;
    const last = fresh.at(-1).sequence;
    const path = join(root, `batch-${pad(first)}-${pad(last)}.json`);
    writeDurably(path, `${JSON.stringify({
      schema: NEATLOGS_OUTBOX_SCHEMA,
      state: 'pending_send',
      firstSequence: first,
      lastSequence: last,
      records: fresh.map(record => ({ ...record })),
      plan: null,
      send: null,
      readback: null
    }, null, 2)}\n`);
    return { accepted: true, acceptedCount: validated.length };
  };
}

export function listNeatlogsOutbox(directory) {
  const root = resolve(directory);
  return readdirSync(root)
    .filter(name => BATCH_FILE.test(name))
    .sort()
    .map(name => join(root, name));
}

function serializablePlan(plan) {
  return {
    workflowName: plan.workflowName,
    tags: [...plan.tags],
    traces: plan.traces.map(trace => ({
      traceId: trace.traceId,
      rootSpanId: trace.rootSpanId,
      markerSpanId: trace.markerSpanId,
      generation: trace.generation,
      sessionId: trace.sessionId,
      sequence: trace.sequence,
      eventType: trace.eventType
    }))
  };
}

/**
 * Rebuilds the readback plan from the batch's validated records. IDs and the
 * canonical input are derived again rather than trusted from the file.
 */
export function readbackPlanFromRecords(records, tags, generations = {}) {
  const validated = validateNeatlogsSourceRecords(records);
  const traces = validated.map(record => {
    const generation = generations[record.sequence] ?? 0;
    return Object.freeze({
      ...deterministicNeatlogsIds(record.eventId, generation),
      generation,
      priorTraceIds: Object.freeze(Array.from({ length: generation },
        (_, prior) => deterministicNeatlogsIds(record.eventId, prior).traceId)),
      sessionId: record.workflowId,
      eventToken: record.eventId,
      sequence: record.sequence,
      revision: record.revision,
      eventType: record.eventType,
      fence: record.fence,
      input: canonicalNeatlogsInput(record),
      record
    });
  });
  return Object.freeze({
    workflowName: NEATLOGS_LIVE_WORKFLOW_NAME,
    tags: validateNeatlogsTags(tags),
    traces: Object.freeze(traces)
  });
}

function storedGenerations(batch) {
  const generations = {};
  for (const trace of batch.plan?.traces ?? []) generations[trace.sequence] = trace.generation;
  return generations;
}

/** Returns which forbidden strings (raw IDs, credentials) occur in the outbound body. */
export function outboundLeakFindings(plan, forbidden = []) {
  const text = `${JSON.stringify(serializablePlan(plan))}\n${plan.traces.map(t => t.input).join('\n')}\n`
    + encodeNeatlogsExportRequest(plan).toString('latin1');
  const findings = [];
  forbidden.forEach((value, index) => {
    if (typeof value === 'string' && value.length > 0 && text.includes(value)) findings.push(`forbidden_${index}`);
  });
  return findings;
}

async function captureEnvelope(records, captureTimeoutMs) {
  // Imported lazily so the pinned SDK sees an environment already scrubbed of NEATLOGS_*.
  const { createNeatlogsSdkCapture } = await import('./neatlogs-sdk-capture.js');
  const capture = createNeatlogsSdkCapture({ timeoutMs: captureTimeoutMs });
  try {
    const result = await capture.prepare(records);
    if (result.status !== 'captured_local') throw new NeatlogsOutboxError(`CAPTURE_${result.reasonCode ?? 'FAILED'}`);
    return result.envelope;
  } finally {
    await capture.close();
  }
}

/**
 * Sends pending outbox batches through the PR #38 OTLP sender and, when asked,
 * verifies accepted batches through the Public API readback. Every state
 * change is written back to the batch file before the next network call.
 */
export async function drainNeatlogsOutbox({
  directory,
  config,
  tags,
  forbidden = [],
  send = true,
  readback = false,
  recover = false,
  fetch: fetchImpl,
  sendOptions = {},
  readbackOptions = {},
  captureTimeoutMs = 500
}) {
  const validatedTags = validateNeatlogsTags(tags);
  if (validatedTags.includes('evidence:synthetic')) throw new NeatlogsOutboxError('SYNTHETIC_TAG_REFUSED');
  const secrets = [];
  try { secrets.push(config.ingestKey()); } catch { /* not configured */ }
  try { secrets.push(config.readbackToken()); } catch { /* not configured */ }
  const scan = [...forbidden, ...secrets];
  const results = [];
  const paths = listNeatlogsOutbox(directory).slice(0, MAX_BATCHES_PER_DRAIN);
  for (const path of paths) {
    const batch = readBatch(path);
    const persist = () => writeDurably(path, `${JSON.stringify(batch, null, 2)}\n`);
    if (send && batch.state === 'pending_send') {
      const envelope = await captureEnvelope(batch.records, captureTimeoutMs);
      const plan = planNeatlogsExport(envelope, { tags: validatedTags });
      const findings = outboundLeakFindings(plan, scan);
      if (findings.length > 0) {
        batch.state = 'blocked';
        batch.send = { status: 'rejected', reasonCode: 'LEAK_GATE_FAILED', findings, attempts: 0 };
        persist();
        results.push({ path, state: batch.state });
        continue;
      }
      batch.plan = serializablePlan(plan);
      const result = await sendNeatlogsPlan(config, plan, {
        ...sendOptions, ...(fetchImpl ? { fetch: fetchImpl } : {})
      });
      batch.send = { ...result, sentAt: new Date().toISOString() };
      batch.state = result.status === 'receiver_accepted' ? 'receiver_accepted'
        : RETRYABLE_SEND.has(result.status) ? 'pending_send' : result.status;
      persist();
    }
    // Opt-in recovery, same semantics as the PR #38 verifier: only traces that
    // were 404 for the whole bounded readback window are re-sent, once, under
    // the next delivery generation. A delayed earlier generation can still
    // appear, so the duplicate risk is recorded rather than hidden.
    if (send && recover && batch.state === 'missing' && batch.plan) {
      const missing = (batch.readback?.traces ?? []).filter(trace => trace.status === 'missing').map(trace => trace.traceId);
      const envelope = await captureEnvelope(batch.records, captureTimeoutMs);
      const fresh = planNeatlogsExport(envelope, { tags: batch.plan.tags });
      const current = storedGenerations(batch);
      // Put each trace back at its stored generation, then advance the missing ones by one.
      const atCurrent = Object.freeze({ ...fresh, traces: Object.freeze(fresh.traces.map(trace => {
        const generation = current[trace.sequence] ?? 0;
        if (generation === 0) return trace;
        return Object.freeze({
          ...trace,
          ...deterministicNeatlogsIds(trace.eventToken, generation),
          generation,
          priorTraceIds: Object.freeze(Array.from({ length: generation },
            (_, prior) => deterministicNeatlogsIds(trace.eventToken, prior).traceId))
        });
      })) });
      const wanted = atCurrent.traces.filter(trace => missing.includes(trace.traceId)).map(trace => trace.traceId);
      if (wanted.length !== missing.length || wanted.length === 0) throw new NeatlogsOutboxError('RECOVERY_PLAN_MISMATCH');
      const regenerated = nextNeatlogsGeneration(atCurrent, wanted);
      const findings = outboundLeakFindings(regenerated, scan);
      if (findings.length > 0) {
        batch.state = 'blocked';
        batch.recovery = { regeneratedFrom: wanted, regeneratedTo: [], send: { status: 'rejected', reasonCode: 'LEAK_GATE_FAILED', findings, attempts: 0 } };
        persist();
        results.push({ path, state: batch.state, batch });
        continue;
      }
      const result = await sendNeatlogsPlan(config, regenerated, {
        ...sendOptions, ...(fetchImpl ? { fetch: fetchImpl } : {})
      });
      const byOld = new Map(regenerated.traces.map((trace, index) => [wanted[index], trace]));
      batch.recovery = {
        regeneratedFrom: wanted,
        regeneratedTo: regenerated.traces.map(trace => trace.traceId),
        basis: 'NOT_OBSERVED_WITHIN_BOUNDED_POLL_WINDOW',
        duplicateDeliveryRisk: 'PRIOR_GENERATION_MAY_APPEAR_LATER',
        send: { ...result, sentAt: new Date().toISOString() }
      };
      if (result.status === 'receiver_accepted') {
        batch.plan = {
          ...batch.plan,
          traces: batch.plan.traces.map(trace => {
            const next = byOld.get(trace.traceId);
            return next ? { ...trace, traceId: next.traceId, rootSpanId: next.rootSpanId,
              markerSpanId: next.markerSpanId, generation: next.generation } : trace;
          })
        };
        batch.state = 'receiver_accepted';
      }
      persist();
    }
    if (readback && batch.state !== 'pending_send' && batch.state !== 'blocked'
        && batch.send?.status === 'receiver_accepted' && !TERMINAL_READBACK.has(batch.state)) {
      const plan = readbackPlanFromRecords(batch.records, batch.plan?.tags ?? validatedTags, storedGenerations(batch));
      if (batch.plan && JSON.stringify(serializablePlan(plan).traces.map(t => t.traceId))
          !== JSON.stringify(batch.plan.traces.map(t => t.traceId))) {
        throw new NeatlogsOutboxError('PLAN_IDENTITY_MISMATCH');
      }
      const result = await readbackNeatlogsPlan(config, plan, {
        ...readbackOptions, ...(fetchImpl ? { fetch: fetchImpl } : {})
      });
      // The project UUID is configuration, not evidence; keep it out of the outbox.
      const { project: _project, ...withoutProject } = result;
      batch.readback = { ...withoutProject, readAt: new Date().toISOString() };
      batch.state = result.status;
      persist();
    }
    results.push({ path, state: batch.state, batch });
  }
  return Object.freeze(results);
}

/**
 * Explicit opt-in. Returns `{ enabled: false }` unless `enabled === true`, so
 * nothing is read or exported by default. When enabled, configuration comes
 * only from `loadNeatlogsConfig` (explicit env object plus optional named env
 * file), the NEATLOGS_* names are scrubbed from `scrubEnv`, and an ingest key
 * is required.
 */
export function loadNeatlogsTelemetryOptIn({ enabled = false, env = {}, envFile = null, scrubEnv = null } = {}) {
  if (enabled !== true) return Object.freeze({ enabled: false });
  const config = loadNeatlogsConfig({ env, envFile });
  if (scrubEnv) scrubNeatlogsEnvironment(scrubEnv);
  if (!config.summary.ingestReady) throw new NeatlogsOutboxError('INGEST_NOT_CONFIGURED');
  return Object.freeze({ enabled: true, config });
}

/**
 * Builds the harness's existing durable TelemetryExporter over its own store
 * connection, with the Neatlogs outbox as its sink, ready to pass to
 * `createOperationsWorker({ telemetry })`. Tokens use a per-process random
 * HMAC key: they are stable within one run (session = workflow token) and are
 * not linkable across runs. The caller closes the returned store after the
 * worker has stopped.
 */
export function createNeatlogsOperationsTelemetry({ databasePath, outboxDirectory, busyTimeoutMs = 20, limits }) {
  const sink = createNeatlogsOutboxSink({ directory: outboxDirectory });
  const store = DurableWorkflowStore.open({ databasePath, busyTimeoutMs });
  const tokenizer = createHmacTokenizer(randomBytes(32));
  let exporter;
  try {
    exporter = createTelemetryExporter({ store, tokenizer, sink, ...(limits ? { limits } : {}) });
  } catch (error) {
    tokenizer.destroy();
    store.close();
    throw error;
  }
  return Object.freeze({
    exporter,
    close() {
      tokenizer.destroy();
      store.close();
    }
  });
}
