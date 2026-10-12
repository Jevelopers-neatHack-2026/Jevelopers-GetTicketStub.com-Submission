import { DatabaseSync } from 'node:sqlite';
import {
  NEATLOGS_LIVE_WORKFLOW_NAME,
  canonicalNeatlogsInput,
  deterministicNeatlogsIds,
  validateNeatlogsTags
} from './neatlogs-otlp.js';
import { mapNeatlogsSourceRecord } from './neatlogs-sdk-mapper.js';
import { readbackNeatlogsPlan, sendNeatlogsPlan } from './neatlogs-live.js';

// Durable Neatlogs outbox: the "sent, awaiting readback" state that lets the
// telemetry cursor and other producers hand events to the network path.
//
// Producers enqueue entries with a local SQLite insert, which is fast and
// idempotent by event token, so a cursor sink can acknowledge within its
// 500 ms budget. A separate drain sends queued entries, records receiver
// acceptance as `sent` (never as delivered), and, when a readback token is
// configured, reads them back: `verified` settles an entry, a trace that stays
// unreadable past the missing window moves to the next delivery generation,
// and a mismatch or exhausted generations settle it as `failed`.

export const NEATLOGS_OUTBOX_SCHEMA_VERSION = 1;
export const NEATLOGS_TICKETSTUB_WORKFLOW_NAME = 'agent-harness.ticketstub-events';
const WORKFLOW_NAMES = new Set([NEATLOGS_LIVE_WORKFLOW_NAME, NEATLOGS_TICKETSTUB_WORKFLOW_NAME]);
const TOKEN = /^tok1_[0-9a-f]{64}$/;
const EVENT_TYPE = /^[a-z][a-z0-9_]{0,63}$/;
const ATTRIBUTE_KEY = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,5}$/;
const MAX_ATTRIBUTES = 24;
const MAX_ATTRIBUTE_STRING = 256;
const MAX_INPUT_BYTES = 4096;
const MAX_GENERATION = 3;
const MAX_BATCH = 32;
const MAX_SEND_ATTEMPTS = 8;
const DAY_MS = 24 * 3_600_000;

const DEFAULTS = Object.freeze({
  maxUnsettled: 5_000,
  retentionMs: 7 * DAY_MS,
  readbackDelayMs: 30_000,
  missingAfterMs: 10 * 60_000,
  pendingGiveUpMs: DAY_MS,
  retryBaseMs: 30_000,
  retryMaxMs: 30 * 60_000,
  drainLeaseMs: 2 * 60_000,
  maxBatchesPerDrain: 4
});

export class NeatlogsOutboxError extends Error {
  constructor(code) {
    super(`Neatlogs outbox operation failed (${code}).`);
    this.name = 'NeatlogsOutboxError';
    this.code = code;
  }
}

function positiveInteger(value, fallback, maximum) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new NeatlogsOutboxError('INVALID_OPTION');
  }
  return value;
}

function validAttributeValue(value) {
  if (typeof value === 'string') return value.length <= MAX_ATTRIBUTE_STRING;
  if (typeof value === 'boolean') return true;
  return Number.isSafeInteger(value) && value >= 0;
}

/**
 * Checks one entry before it is stored. Entries carry only HMAC tokens, a
 * fixed event type, canonical input JSON and allow-listed scalar attributes;
 * Neatlogs-reserved attribute names are refused so a producer cannot alter
 * the trace envelope.
 */
export function validateNeatlogsOutboxEntry(entry) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new NeatlogsOutboxError('INVALID_ENTRY');
  }
  const { eventToken, workflowName, sessionId, eventType, input, attributes, occurredAtMs } = entry;
  if (typeof eventToken !== 'string' || !TOKEN.test(eventToken)
      || typeof sessionId !== 'string' || !TOKEN.test(sessionId)
      || !WORKFLOW_NAMES.has(workflowName)
      || typeof eventType !== 'string' || !EVENT_TYPE.test(eventType)
      || typeof input !== 'string' || Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES
      || !Number.isSafeInteger(occurredAtMs) || occurredAtMs <= 0
      || !Array.isArray(attributes) || attributes.length > MAX_ATTRIBUTES) {
    throw new NeatlogsOutboxError('INVALID_ENTRY');
  }
  const keys = new Set();
  for (const pair of attributes) {
    if (!Array.isArray(pair) || pair.length !== 2) throw new NeatlogsOutboxError('INVALID_ENTRY');
    const [key, value] = pair;
    if (typeof key !== 'string' || !ATTRIBUTE_KEY.test(key) || key.startsWith('neatlogs.')
        || keys.has(key) || !validAttributeValue(value)) {
      throw new NeatlogsOutboxError('INVALID_ENTRY');
    }
    keys.add(key);
  }
  try {
    JSON.parse(input);
  } catch {
    throw new NeatlogsOutboxError('INVALID_ENTRY');
  }
  return Object.freeze({
    eventToken, workflowName, sessionId, eventType, input,
    attributes: Object.freeze(attributes.map(([key, value]) => Object.freeze([key, value]))),
    occurredAtMs
  });
}

/**
 * Converts one projected `agent-harness.telemetry.v1` record into an outbox
 * entry with the same input and attributes the live verifier exports.
 * Returns null for record types the Neatlogs mapper does not export.
 */
export function harnessTelemetryOutboxEntry(record) {
  let attributes;
  try {
    attributes = Object.entries(mapNeatlogsSourceRecord(record));
  } catch {
    return null;
  }
  return validateNeatlogsOutboxEntry({
    eventToken: record.eventId,
    workflowName: NEATLOGS_LIVE_WORKFLOW_NAME,
    sessionId: record.workflowId,
    eventType: record.eventType,
    input: canonicalNeatlogsInput(record),
    attributes,
    occurredAtMs: record.occurredAtMs
  });
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS neatlogs_outbox_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS neatlogs_outbox (
  position INTEGER PRIMARY KEY AUTOINCREMENT,
  event_token TEXT NOT NULL UNIQUE,
  workflow_name TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  input TEXT NOT NULL,
  attributes TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  enqueued_at_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('queued', 'sent', 'verified', 'failed')),
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation BETWEEN 0 AND ${MAX_GENERATION}),
  prior_trace_ids TEXT NOT NULL DEFAULT '[]',
  duplicate_trace_ids TEXT NOT NULL DEFAULT '[]',
  trace_id TEXT NOT NULL,
  send_attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at_ms INTEGER NOT NULL,
  sent_at_ms INTEGER,
  last_status TEXT,
  last_reason TEXT,
  settled_at_ms INTEGER
) STRICT;
CREATE INDEX IF NOT EXISTS neatlogs_outbox_due ON neatlogs_outbox (state, next_attempt_at_ms, position);
CREATE INDEX IF NOT EXISTS neatlogs_outbox_sent ON neatlogs_outbox (state, sent_at_ms, position);
`;

function rowTrace(row, nowMs) {
  const ids = deterministicNeatlogsIds(row.event_token, row.generation);
  const startNs = nowMs * 1e6;
  return Object.freeze({
    ...ids,
    generation: row.generation,
    priorTraceIds: Object.freeze(JSON.parse(row.prior_trace_ids)),
    sessionId: row.session_id,
    eventToken: row.event_token,
    sequence: row.position,
    revision: 0,
    eventType: row.event_type,
    fence: 0,
    input: row.input,
    attributes: Object.freeze(JSON.parse(row.attributes)),
    // Span times are the send time; the event's own time is in the input.
    root: Object.freeze({ start: startNs, end: startNs + 1e6 }),
    marker: Object.freeze({ start: startNs + 1e6, end: startNs + 1e6 })
  });
}

function planFor(rows, tags, nowMs) {
  return Object.freeze({
    workflowName: rows[0].workflow_name,
    tags,
    traces: Object.freeze(rows.map(row => rowTrace(row, nowMs)))
  });
}

function groupByWorkflow(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.workflow_name)) groups.set(row.workflow_name, []);
    groups.get(row.workflow_name).push(row);
  }
  return [...groups.values()];
}

export class NeatlogsOutbox {
  #db;
  #clock;
  #options;
  #closed = false;

  constructor(db, clock, options) {
    this.#db = db;
    this.#clock = clock;
    this.#options = options;
  }

  /**
   * Opens (creating if needed) the outbox database at an explicit file path.
   * The outbox is separate from the durable workflow store so it can be used
   * by a host process that does not own a harness store.
   */
  static open({ databasePath, clock = Date.now, ...options } = {}) {
    if (typeof databasePath !== 'string' || databasePath.length === 0 || databasePath === ':memory:'
        || databasePath.startsWith('file:')) {
      throw new NeatlogsOutboxError('DURABILITY_REQUIRES_FILE');
    }
    if (typeof clock !== 'function') throw new NeatlogsOutboxError('INVALID_OPTION');
    const resolved = Object.freeze({
      maxUnsettled: positiveInteger(options.maxUnsettled, DEFAULTS.maxUnsettled, 100_000),
      retentionMs: positiveInteger(options.retentionMs, DEFAULTS.retentionMs, 90 * DAY_MS),
      readbackDelayMs: positiveInteger(options.readbackDelayMs, DEFAULTS.readbackDelayMs, DAY_MS),
      missingAfterMs: positiveInteger(options.missingAfterMs, DEFAULTS.missingAfterMs, DAY_MS),
      pendingGiveUpMs: positiveInteger(options.pendingGiveUpMs, DEFAULTS.pendingGiveUpMs, 30 * DAY_MS),
      retryBaseMs: positiveInteger(options.retryBaseMs, DEFAULTS.retryBaseMs, DAY_MS),
      retryMaxMs: positiveInteger(options.retryMaxMs, DEFAULTS.retryMaxMs, DAY_MS),
      drainLeaseMs: positiveInteger(options.drainLeaseMs, DEFAULTS.drainLeaseMs, DAY_MS),
      maxBatchesPerDrain: positiveInteger(options.maxBatchesPerDrain, DEFAULTS.maxBatchesPerDrain, 32)
    });
    let db;
    try {
      db = new DatabaseSync(databasePath);
      db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
      db.exec('BEGIN IMMEDIATE');
      db.exec(SCHEMA_SQL);
      const version = db.prepare("SELECT value FROM neatlogs_outbox_meta WHERE key = 'schema_version'").get();
      if (!version) {
        db.prepare("INSERT INTO neatlogs_outbox_meta (key, value) VALUES ('schema_version', ?)")
          .run(String(NEATLOGS_OUTBOX_SCHEMA_VERSION));
      } else if (version.value !== String(NEATLOGS_OUTBOX_SCHEMA_VERSION)) {
        db.exec('ROLLBACK');
        db.close();
        throw new NeatlogsOutboxError('UNSUPPORTED_SCHEMA_VERSION');
      }
      db.exec('COMMIT');
    } catch (error) {
      if (error instanceof NeatlogsOutboxError) throw error;
      try { db?.close(); } catch {}
      throw new NeatlogsOutboxError('STORE_OPEN_FAILED');
    }
    return new NeatlogsOutbox(db, clock, resolved);
  }

  get options() {
    return this.#options;
  }

  now() {
    const value = this.#clock();
    if (!Number.isSafeInteger(value) || value <= 0) throw new NeatlogsOutboxError('INVALID_CLOCK');
    return value;
  }

  #open() {
    if (this.#closed) throw new NeatlogsOutboxError('STORE_CLOSED');
    return this.#db;
  }

  #transaction(work) {
    const db = this.#open();
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work(db);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
  }

  /**
   * Stores entries that are not already present. Re-enqueueing the same event
   * token is a no-op, so at-least-once producers do not create duplicates.
   */
  enqueue(entries) {
    if (!Array.isArray(entries)) throw new NeatlogsOutboxError('INVALID_ENTRY');
    const validated = entries.map(validateNeatlogsOutboxEntry);
    const now = this.now();
    return this.#transaction(db => {
      const unsettled = db.prepare(
        "SELECT COUNT(*) AS n FROM neatlogs_outbox WHERE state IN ('queued', 'sent')"
      ).get().n;
      const insert = db.prepare(`INSERT OR IGNORE INTO neatlogs_outbox (
        event_token, workflow_name, session_id, event_type, input, attributes, occurred_at_ms,
        enqueued_at_ms, state, generation, trace_id, next_attempt_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`);
      let accepted = 0;
      let duplicates = 0;
      let refused = 0;
      for (const entry of validated) {
        if (unsettled + accepted >= this.#options.maxUnsettled) {
          refused += 1;
          continue;
        }
        const { traceId } = deterministicNeatlogsIds(entry.eventToken, 0);
        const result = insert.run(
          entry.eventToken, entry.workflowName, entry.sessionId, entry.eventType, entry.input,
          JSON.stringify(entry.attributes), entry.occurredAtMs, now, traceId, now
        );
        if (result.changes === 1) accepted += 1;
        else duplicates += 1;
      }
      return Object.freeze({ accepted, duplicates, refused });
    });
  }

  /** Takes the cross-process drain lease; false when another drain holds it. */
  acquireDrainLease(ownerId) {
    const now = this.now();
    return this.#transaction(db => {
      const row = db.prepare("SELECT value FROM neatlogs_outbox_meta WHERE key = 'drain_lease'").get();
      if (row) {
        const lease = JSON.parse(row.value);
        if (lease.owner !== ownerId && lease.expiresAtMs > now) return false;
      }
      db.prepare(`INSERT INTO neatlogs_outbox_meta (key, value) VALUES ('drain_lease', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
        .run(JSON.stringify({ owner: ownerId, expiresAtMs: now + this.#options.drainLeaseMs }));
      return true;
    });
  }

  releaseDrainLease(ownerId) {
    this.#transaction(db => {
      const row = db.prepare("SELECT value FROM neatlogs_outbox_meta WHERE key = 'drain_lease'").get();
      if (row && JSON.parse(row.value).owner === ownerId) {
        db.prepare("DELETE FROM neatlogs_outbox_meta WHERE key = 'drain_lease'").run();
      }
    });
  }

  dueForSend(limit = MAX_BATCH) {
    return this.#open().prepare(`SELECT * FROM neatlogs_outbox
      WHERE state = 'queued' AND next_attempt_at_ms <= ? ORDER BY position LIMIT ?`)
      .all(this.now(), Math.min(limit, MAX_BATCH));
  }

  dueForReadback(limit = MAX_BATCH) {
    return this.#open().prepare(`SELECT * FROM neatlogs_outbox
      WHERE state = 'sent' AND sent_at_ms <= ? ORDER BY sent_at_ms, position LIMIT ?`)
      .all(this.now() - this.#options.readbackDelayMs, Math.min(limit, MAX_BATCH));
  }

  /** Records one send result for the rows that were in the request. */
  recordSend(rows, result) {
    const now = this.now();
    this.#transaction(db => {
      const sent = db.prepare(`UPDATE neatlogs_outbox SET state = 'sent', sent_at_ms = ?,
        send_attempts = send_attempts + 1, last_status = ?, last_reason = ? WHERE position = ? AND state = 'queued'`);
      const retry = db.prepare(`UPDATE neatlogs_outbox SET send_attempts = send_attempts + 1,
        next_attempt_at_ms = ?, last_status = ?, last_reason = ? WHERE position = ? AND state = 'queued'`);
      const failed = db.prepare(`UPDATE neatlogs_outbox SET state = 'failed', settled_at_ms = ?,
        send_attempts = send_attempts + 1, last_status = ?, last_reason = ? WHERE position = ? AND state = 'queued'`);
      for (const row of rows) {
        const reason = result.reasonCode ?? null;
        // Acceptance, including a partial rejection, is settled by readback;
        // only readback can say which spans were stored.
        if (result.status === 'receiver_accepted' || result.status === 'partially_rejected') {
          sent.run(now, result.status, reason, row.position);
        } else if (row.send_attempts + 1 >= MAX_SEND_ATTEMPTS) {
          failed.run(now, result.status, reason ?? 'SEND_ATTEMPTS_EXHAUSTED', row.position);
        } else {
          const delay = Math.min(this.#options.retryBaseMs * 2 ** row.send_attempts, this.#options.retryMaxMs);
          retry.run(now + delay, result.status, reason, row.position);
        }
      }
    });
  }

  /** Applies a readback outcome to one sent row. Returns the resulting action. */
  recordReadback(row, outcome) {
    const now = this.now();
    return this.#transaction(db => {
      const current = db.prepare("SELECT * FROM neatlogs_outbox WHERE position = ? AND state = 'sent' AND trace_id = ?")
        .get(row.position, row.trace_id);
      if (!current) return 'stale';
      const duplicates = JSON.stringify([...(outcome.duplicateTraceIds ?? [])]);
      const settle = (state, reason) => {
        db.prepare(`UPDATE neatlogs_outbox SET state = ?, settled_at_ms = ?, last_status = ?, last_reason = ?,
          duplicate_trace_ids = ? WHERE position = ?`)
          .run(state, now, `readback_${outcome.status}`, reason, duplicates, row.position);
        return state;
      };
      const age = now - current.sent_at_ms;
      if (outcome.status === 'verified') return settle('verified', null);
      if (outcome.status === 'mismatch') return settle('failed', outcome.problems?.[0] ?? 'READBACK_MISMATCH');
      if (outcome.status === 'missing' && age >= this.#options.missingAfterMs) {
        if (current.generation >= MAX_GENERATION) return settle('failed', 'MISSING_AFTER_LAST_GENERATION');
        const generation = current.generation + 1;
        const { traceId } = deterministicNeatlogsIds(current.event_token, generation);
        const prior = JSON.stringify([...JSON.parse(current.prior_trace_ids), current.trace_id]);
        db.prepare(`UPDATE neatlogs_outbox SET state = 'queued', generation = ?, trace_id = ?, prior_trace_ids = ?,
          send_attempts = 0, next_attempt_at_ms = ?, sent_at_ms = NULL, last_status = 'readback_missing',
          last_reason = 'NOT_FOUND_AFTER_WINDOW' WHERE position = ?`)
          .run(generation, traceId, prior, now, row.position);
        return 'regenerated';
      }
      if (age >= this.#options.pendingGiveUpMs) return settle('failed', 'NOT_FINALIZED_IN_TIME');
      db.prepare('UPDATE neatlogs_outbox SET last_status = ? WHERE position = ?')
        .run(`readback_${outcome.status}`, row.position);
      return 'waiting';
    });
  }

  /** Deletes settled rows older than the retention period. */
  prune() {
    const cutoff = this.now() - this.#options.retentionMs;
    return this.#transaction(db => db.prepare(
      "DELETE FROM neatlogs_outbox WHERE state IN ('verified', 'failed') AND settled_at_ms < ?"
    ).run(cutoff).changes);
  }

  /** Counts by state plus the most recent trace IDs per state. Holds no content. */
  diagnostics({ recent = 5 } = {}) {
    const db = this.#open();
    const counts = { queued: 0, sent: 0, verified: 0, failed: 0 };
    for (const row of db.prepare('SELECT state, COUNT(*) AS n FROM neatlogs_outbox GROUP BY state').all()) {
      counts[row.state] = row.n;
    }
    const latest = db.prepare(`SELECT trace_id, workflow_name, event_type, state, generation, last_status, last_reason,
      duplicate_trace_ids FROM neatlogs_outbox ORDER BY position DESC LIMIT ?`).all(Math.min(recent, 50));
    return Object.freeze({
      counts: Object.freeze(counts),
      latest: Object.freeze(latest.map(row => Object.freeze({
        traceId: row.trace_id,
        workflowName: row.workflow_name,
        eventType: row.event_type,
        state: row.state,
        generation: row.generation,
        lastStatus: row.last_status,
        lastReason: row.last_reason,
        duplicateTraceIds: Object.freeze(JSON.parse(row.duplicate_trace_ids))
      })))
    });
  }

  close() {
    if (this.#closed) return;
    this.#closed = true;
    this.#db.close();
  }
}

/**
 * A `TelemetryExporter` sink that stores projected records in the outbox.
 * The cursor advances once the local insert commits; the network send and its
 * readback happen later in `drainNeatlogsOutbox`. Record types the Neatlogs
 * mapper does not export are acknowledged without an outbox row.
 */
export function createNeatlogsOutboxSink(outbox) {
  if (!(outbox instanceof NeatlogsOutbox)) throw new NeatlogsOutboxError('INVALID_OUTBOX');
  return function neatlogsOutboxSink(records) {
    const entries = records.map(harnessTelemetryOutboxEntry).filter(entry => entry !== null);
    if (entries.length > 0) {
      const result = outbox.enqueue(entries);
      if (result.refused > 0) throw new NeatlogsOutboxError('OUTBOX_FULL');
    }
    return { accepted: true, acceptedCount: records.length };
  };
}

/**
 * One bounded pass over the outbox: readback of sent rows (when a readback
 * token is configured), then sending of due rows, then pruning. Never throws
 * for network trouble; the returned summary carries only counts and codes.
 */
export async function drainNeatlogsOutbox(outbox, config, options = {}) {
  const tags = validateNeatlogsTags(options.tags ?? []);
  const ownerId = options.ownerId ?? `drain-${process.pid}`;
  const summary = {
    leased: false, sent: 0, sendRequests: 0, retried: 0, failed: 0,
    verified: 0, regenerated: 0, waiting: 0, readbackStatus: null, sendStatus: null, pruned: 0
  };
  if (!outbox.acquireDrainLease(ownerId)) return Object.freeze(summary);
  summary.leased = true;
  try {
    if (config?.summary?.readbackReady) {
      const rows = outbox.dueForReadback();
      for (const group of groupByWorkflow(rows)) {
        const plan = planFor(group, tags, outbox.now());
        const result = await readbackNeatlogsPlan(config, plan, {
          fetch: options.fetch, sleep: options.sleep, signal: options.signal, maxPolls: 1
        });
        summary.readbackStatus = result.status;
        if (result.status === 'readback_failed' || result.status === 'readback_unavailable') break;
        if (result.status === 'mismatch' && result.reasonCode === 'PROJECT_MISMATCH') break;
        const byTrace = new Map(result.traces.map(trace => [trace.traceId, trace]));
        for (const row of group) {
          const outcome = byTrace.get(row.trace_id);
          if (!outcome) continue;
          const action = outbox.recordReadback(row, outcome);
          if (action === 'verified') summary.verified += 1;
          else if (action === 'failed') summary.failed += 1;
          else if (action === 'regenerated') summary.regenerated += 1;
          else if (action === 'waiting') summary.waiting += 1;
        }
      }
    }
    if (config?.summary?.ingestReady) {
      for (let batch = 0; batch < outbox.options.maxBatchesPerDrain; batch += 1) {
        const rows = outbox.dueForSend();
        if (rows.length === 0) break;
        let anyAccepted = false;
        for (const group of groupByWorkflow(rows)) {
          const result = await sendNeatlogsPlan(config, planFor(group, tags, outbox.now()), {
            fetch: options.fetch, sleep: options.sleep, signal: options.signal,
            maxAttempts: options.maxSendAttempts ?? 2
          });
          summary.sendRequests += 1;
          summary.sendStatus = result.status;
          outbox.recordSend(group, result);
          if (result.status === 'receiver_accepted' || result.status === 'partially_rejected') {
            summary.sent += group.length;
            anyAccepted = true;
          } else {
            summary.retried += group.length;
          }
        }
        if (!anyAccepted) break;
      }
    }
    summary.pruned = outbox.prune();
  } finally {
    outbox.releaseDrainLease(ownerId);
  }
  return Object.freeze(summary);
}

export const NEATLOGS_OUTBOX_LIMITS = Object.freeze({
  defaults: DEFAULTS,
  maxBatch: MAX_BATCH,
  maxGeneration: MAX_GENERATION,
  maxSendAttempts: MAX_SEND_ATTEMPTS,
  maxAttributes: MAX_ATTRIBUTES,
  maxInputBytes: MAX_INPUT_BYTES
});
