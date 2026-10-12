import { createHmac, randomUUID } from 'node:crypto';
import { loadNeatlogsConfig } from '../../observability/private/neatlogs-config.js';
import {
  NEATLOGS_TICKETSTUB_WORKFLOW_NAME,
  NeatlogsOutbox,
  drainNeatlogsOutbox,
  validateNeatlogsOutboxEntry
} from '../../observability/private/neatlogs-outbox.js';
import { validateNeatlogsTags } from '../../observability/private/neatlogs-otlp.js';

// TicketStub hand-off: the customer app gives the harness its already
// sanitized product events (schema ticketstub.event/1), and the harness
// records them in its durable Neatlogs outbox and delivers them.
//
// The harness does not trust the producer's sanitizer. Every event is checked
// again against this copy of the ticketstub.event/1 contract and refused, not
// repaired, when anything is outside it. Request IDs and the producer's
// 16-hex refs are replaced by HMAC tokens under a server-held key, so what
// reaches Neatlogs cannot be joined back to TicketStub IDs without that key.

export const TICKETSTUB_EVENT_SCHEMA = 'ticketstub.event/1';
export const TICKETSTUB_INTAKE_SCHEMA = 'agent-harness.ticketstub-intake.v1';
export const HARNESS_TELEMETRY_KEY_NAME = 'AGENT_HARNESS_TELEMETRY_KEY';

const ENUM = values => Object.freeze(values);
/** Field kinds per event type, matching getticketstub.com src/server/events.ts. */
export const TICKETSTUB_EVENT_SPEC = Object.freeze({
  intake_submitted: Object.freeze({ source: ENUM(['link', 'search']) }),
  intake_rejected: Object.freeze({ code: 'code' }),
  research_started: Object.freeze({ source: ENUM(['fixture', 'link', 'ticketmaster']), facts: 'count' }),
  fact_corrected: Object.freeze({ fact: 'ref', versions: 'count' }),
  art_requested: Object.freeze({ first: 'flag' }),
  art_ready: Object.freeze({ provider: ENUM(['procedural', 'image', 'simulated', 'live']) }),
  art_failed: Object.freeze({ code: 'code' }),
  art_limit: Object.freeze({ retryAt: 'ts' }),
  version_selected: Object.freeze({ version: 'ref', versions: 'count' }),
  share_created: Object.freeze({ share: 'ref' }),
  share_revoked: Object.freeze({ revoked: 'flag' }),
  gift_created: Object.freeze({ share: 'ref', messageChars: 'count' }),
  order_placed: Object.freeze({ order: 'ref', lines: 'count', totalMinor: 'count' }),
  order_blocked: Object.freeze({ code: 'code' }),
  signin_link_sent: Object.freeze({ reason: ENUM(['save', 'checkout', 'claim']), delivery: ENUM(['mail', 'sandbox']) }),
  signed_in: Object.freeze({ fresh: 'flag' }),
  claim_redeemed: Object.freeze({ status: ENUM(['claimed', 'already']) }),
  storage_unavailable: Object.freeze({ code: 'code', route: 'code' })
});

const EVENT_KEYS = new Set(['schema', 'type', 'at', 'requestId', 'actor', 'actorRef', 'projectRef', 'mode', 'fields']);
const REF = /^[a-f0-9]{16}$/;
const CODE = /^[a-z][a-z0-9_]{0,47}$/;
const REQUEST_ID = /^[A-Za-z0-9_.-]{8,64}$/;
const MAX_COUNT = 1_000_000_000;
const MAX_EVENTS_PER_CALL = 256;
const EMAIL = /[^\s@"]+@[^\s@"]+\.[^\s@"]+/;
const URLISH = /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|[?&][\w.%-]+=)/i;
const TOKENISH = /[A-Za-z0-9_-]{24,}/;
const KEY_HEX = /^(?:[0-9a-f]{2}){32,64}$/;

export class TicketstubIntakeError extends Error {
  constructor(code) {
    super(`TicketStub intake failed (${code}).`);
    this.name = 'TicketstubIntakeError';
    this.code = code;
  }
}

function plainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function clean(value) {
  return !EMAIL.test(value) && !URLISH.test(value) && !TOKENISH.test(value);
}

function fits(kind, value) {
  if (typeof kind !== 'string') return typeof value === 'string' && kind.includes(value);
  switch (kind) {
    case 'ref': return typeof value === 'string' && REF.test(value);
    case 'code': return typeof value === 'string' && CODE.test(value) && clean(value);
    case 'count': return Number.isSafeInteger(value) && value >= 0 && value <= MAX_COUNT;
    case 'ts': return Number.isSafeInteger(value) && value > 0 && value < 8.64e15;
    case 'flag': return typeof value === 'boolean';
    default: return false;
  }
}

/**
 * Validates one ticketstub.event/1 event. Returns a normalized copy, or
 * throws `TicketstubIntakeError` with code `INVALID_EVENT` or
 * `UNSUPPORTED_SCHEMA`. Unknown keys, unknown fields and values outside a
 * field's kind are refused.
 */
export function validateTicketstubEvent(event) {
  if (!plainRecord(event)) throw new TicketstubIntakeError('INVALID_EVENT');
  if (event.schema !== TICKETSTUB_EVENT_SCHEMA) throw new TicketstubIntakeError('UNSUPPORTED_SCHEMA');
  for (const key of Object.keys(event)) {
    if (!EVENT_KEYS.has(key)) throw new TicketstubIntakeError('INVALID_EVENT');
  }
  const spec = Object.hasOwn(TICKETSTUB_EVENT_SPEC, event.type) ? TICKETSTUB_EVENT_SPEC[event.type] : null;
  const actorOk = ['account', 'guest', 'anonymous'].includes(event.actor);
  if (!spec || !Number.isSafeInteger(event.at) || event.at <= 0 || event.at >= 8.64e15
      || typeof event.requestId !== 'string' || !REQUEST_ID.test(event.requestId)
      || !actorOk || !['sandbox', 'live'].includes(event.mode) || !plainRecord(event.fields)) {
    throw new TicketstubIntakeError('INVALID_EVENT');
  }
  if (event.actorRef !== undefined
      && (event.actor === 'anonymous' || typeof event.actorRef !== 'string' || !REF.test(event.actorRef))) {
    throw new TicketstubIntakeError('INVALID_EVENT');
  }
  if (event.projectRef !== undefined && (typeof event.projectRef !== 'string' || !REF.test(event.projectRef))) {
    throw new TicketstubIntakeError('INVALID_EVENT');
  }
  const fields = {};
  for (const key of Object.keys(event.fields).sort()) {
    if (!Object.hasOwn(spec, key) || !fits(spec[key], event.fields[key])) {
      throw new TicketstubIntakeError('INVALID_EVENT');
    }
    fields[key] = event.fields[key];
  }
  return Object.freeze({
    schema: TICKETSTUB_EVENT_SCHEMA,
    type: event.type,
    at: event.at,
    requestId: event.requestId,
    actor: event.actor,
    ...(event.actorRef !== undefined ? { actorRef: event.actorRef } : {}),
    ...(event.projectRef !== undefined ? { projectRef: event.projectRef } : {}),
    mode: event.mode,
    fields: Object.freeze(fields)
  });
}

/** Parses the server-held tokenization key: 64 to 128 lowercase hex characters (32 to 64 bytes). */
export function parseHarnessTelemetryKey(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!KEY_HEX.test(text)) throw new TicketstubIntakeError('INVALID_TELEMETRY_KEY');
  return Buffer.from(text, 'hex');
}

const TOKEN_KINDS = new Set([
  'ticketstub.event', 'ticketstub.request', 'ticketstub.actor', 'ticketstub.project'
]);

export function createTicketstubTokenizer(keyBytes) {
  if (!Buffer.isBuffer(keyBytes) || keyBytes.length < 32 || keyBytes.length > 64) {
    throw new TicketstubIntakeError('INVALID_TELEMETRY_KEY');
  }
  const key = Buffer.from(keyBytes);
  return function tokenize(kind, value) {
    if (!TOKEN_KINDS.has(kind) || typeof value !== 'string') throw new TicketstubIntakeError('TOKENIZE_FAILED');
    return 'tok1_' + createHmac('sha256', key).update(kind, 'utf8').update('\0', 'utf8')
      .update(value, 'utf8').digest('hex');
  };
}

/**
 * Builds the outbox entry for one validated event. The exported input holds
 * the event type, time, mode, actor kind, fields, and tokens in place of the
 * request ID and refs. One session groups a project's events (or, without a
 * project, one request's events).
 */
export function ticketstubOutboxEntry(event, tokenize) {
  const valid = validateTicketstubEvent(event);
  const request = tokenize('ticketstub.request', valid.requestId);
  const actor = valid.actorRef === undefined ? null : tokenize('ticketstub.actor', valid.actorRef);
  const project = valid.projectRef === undefined ? null : tokenize('ticketstub.project', valid.projectRef);
  const input = JSON.stringify({
    schema: TICKETSTUB_INTAKE_SCHEMA,
    source: TICKETSTUB_EVENT_SCHEMA,
    type: valid.type,
    at: valid.at,
    mode: valid.mode,
    actor: valid.actor,
    actorToken: actor,
    projectToken: project,
    requestToken: request,
    fields: valid.fields
  });
  return validateNeatlogsOutboxEntry({
    eventToken: tokenize('ticketstub.event', JSON.stringify(valid)),
    workflowName: NEATLOGS_TICKETSTUB_WORKFLOW_NAME,
    sessionId: project ?? request,
    eventType: valid.type,
    input,
    attributes: [
      ['agent_harness.source', 'ticketstub'],
      ['ticketstub.event_type', valid.type],
      ['ticketstub.mode', valid.mode],
      ['ticketstub.actor', valid.actor]
    ],
    occurredAtMs: valid.at
  });
}

/**
 * The host-facing exporter. The host passes an explicit environment object
 * (normally a copy of its server environment) and an explicit outbox file
 * path. `accept` is synchronous and local; `drain` does the network work.
 * Configuration problems throw at creation with a code and never a value.
 */
export function createTicketstubHarnessExporter({
  env, databasePath, tags = [], fetch, clock, outboxOptions = {}, drainDelayMs = 2_000
} = {}) {
  if (env === null || typeof env !== 'object') throw new TicketstubIntakeError('MISSING_ENV');
  const tokenize = createTicketstubTokenizer(parseHarnessTelemetryKey(env[HARNESS_TELEMETRY_KEY_NAME]));
  const config = loadNeatlogsConfig({ env });
  if (!config.summary.ingestReady) throw new TicketstubIntakeError('MISSING_INGEST_KEY');
  const validatedTags = validateNeatlogsTags(['ticketstub', ...tags.filter(tag => tag !== 'ticketstub')]);
  if (!Number.isSafeInteger(drainDelayMs) || drainDelayMs < 0 || drainDelayMs > 60_000) {
    throw new TicketstubIntakeError('INVALID_OPTION');
  }
  const outbox = NeatlogsOutbox.open({ databasePath, ...(clock ? { clock } : {}), ...outboxOptions });
  const ownerId = `ticketstub-${randomUUID()}`;
  const counters = { accepted: 0, duplicates: 0, refused: 0, invalid: 0, drains: 0, drainErrors: 0 };
  let timer = null;
  let running = null;
  let closed = false;
  let lastDrain = null;

  async function drain() {
    if (closed) return null;
    if (running) return running;
    running = (async () => {
      try {
        lastDrain = await drainNeatlogsOutbox(outbox, config, { tags: validatedTags, fetch, ownerId });
        counters.drains += 1;
        return lastDrain;
      } catch {
        counters.drainErrors += 1;
        return null;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function scheduleDrain(delayMs = drainDelayMs) {
    if (closed || timer) return;
    timer = setTimeout(() => {
      timer = null;
      void drain().then(() => {
        // Keep going while work remains (retries, readback windows).
        const { counts } = outbox.diagnostics({ recent: 0 });
        if (counts.queued + counts.sent > 0) scheduleDrain(Math.max(drainDelayMs, 15_000));
      }, () => {});
    }, delayMs);
    timer.unref?.();
  }

  return Object.freeze({
    summary: Object.freeze({
      workflowName: NEATLOGS_TICKETSTUB_WORKFLOW_NAME,
      tags: validatedTags,
      neatlogs: config.summary
    }),
    /** Validates and stores events; returns counts. Never sends inline. */
    accept(events) {
      if (closed) throw new TicketstubIntakeError('CLOSED');
      if (!Array.isArray(events) || events.length > MAX_EVENTS_PER_CALL) {
        throw new TicketstubIntakeError('INVALID_BATCH');
      }
      const entries = [];
      let invalid = 0;
      for (const event of events) {
        try {
          entries.push(ticketstubOutboxEntry(event, tokenize));
        } catch {
          invalid += 1;
        }
      }
      const stored = entries.length > 0 ? outbox.enqueue(entries) : { accepted: 0, duplicates: 0, refused: 0 };
      counters.accepted += stored.accepted;
      counters.duplicates += stored.duplicates;
      counters.refused += stored.refused;
      counters.invalid += invalid;
      if (stored.accepted > 0) scheduleDrain();
      return Object.freeze({ ...stored, invalid });
    },
    drain,
    scheduleDrain,
    status() {
      return Object.freeze({
        counters: Object.freeze({ ...counters }),
        outbox: outbox.diagnostics(),
        lastDrain
      });
    },
    async close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      if (running) await running;
      outbox.close();
    }
  });
}
