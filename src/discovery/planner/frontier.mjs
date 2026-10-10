import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseAndValidateUrl } from '../../security/url-policy.mjs';

const SCHEMA_VERSION = 1;
const MAX_SEEDS = 10;
const MAX_DEPTH = 2;
const MAX_ATTEMPT_ADMISSIONS = 30;
const MAX_IN_FLIGHT = 4;
const MAX_DURATION_MS = 120_000;
const MAX_SUGGESTIONS = 16;
const MAX_SOURCE_REFS = 4;
const MAX_RUNS_PER_TENANT = 128;
const MAX_DATABASE_BYTES = 64 * 1024 * 1024;
const MAX_DATABASE_PAGES = 16_384;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const MAX_SQLITE_TIMEOUT_MS = 10_000;
const HEX_SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const DEFAULT_LIMITS = Object.freeze({
  maxDepth: 2,
  maxTransportAttemptAdmissions: 30,
  maxInFlightLeases: 4,
  durationMs: 120_000,
  maxSuggestionsPerCompletion: 16,
});

const ERROR_MESSAGES = Object.freeze({
  FRONTIER_INVALID_INPUT: 'invalid frontier input',
  FRONTIER_DENIED: 'frontier access denied',
  FRONTIER_NOT_FOUND: 'frontier run not found',
  FRONTIER_CONFLICT: 'frontier state conflict',
  FRONTIER_STOPPED: 'frontier run is stopped',
  FRONTIER_STALE_LEASE: 'frontier lease is stale',
  FRONTIER_BUSY: 'frontier store is busy',
  FRONTIER_STORAGE_LIMIT: 'frontier storage limit reached',
  FRONTIER_VERSION: 'unsupported frontier state version',
  FRONTIER_STORAGE: 'frontier storage operation failed',
});

const STOP_REASONS = new Set([
  'cancelled',
  'budget_denied',
  'access_restricted',
  'deadline',
  'attempt_limit',
  'frontier_exhausted',
  'depth_limit',
  'fanout_limit',
  'unresolved_work',
  'adequate_facts',
  'review_required',
]);

const GLOBAL_HALT_REASONS = new Set([
  'cancelled', 'budget_denied', 'access_restricted', 'deadline', 'attempt_limit',
  'unresolved_work', 'adequate_facts', 'review_required',
]);

export class DiscoveryFrontierError extends Error {
  constructor(code = 'FRONTIER_STORAGE') {
    const safeCode = typeof code === 'string' && Object.hasOwn(ERROR_MESSAGES, code)
      ? code : 'FRONTIER_STORAGE';
    super(ERROR_MESSAGES[safeCode]);
    this.name = 'DiscoveryFrontierError';
    this.code = safeCode;
  }
}

function fail(code = 'FRONTIER_INVALID_INPUT') {
  throw new DiscoveryFrontierError(code);
}

function isWellFormed(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function ownRecord(value, allowedKeys) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))) return null;
    const copy = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return null;
  }
}

function ownArray(value, maximumLength) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !Number.isSafeInteger(lengthDescriptor.value)
      || lengthDescriptor.value < 0 || lengthDescriptor.value > maximumLength) return null;
    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes('length')) return null;
    const copied = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      copied.push(descriptor.value);
    }
    return copied;
  } catch {
    return null;
  }
}

function validText(value, maximum, { allowEmpty = false } = {}) {
  return typeof value === 'string'
    && value.length <= maximum
    && (allowEmpty || value.length > 0)
    && !value.includes('\0')
    && isWellFormed(value);
}

function validId(value, maximum = 128) {
  return validText(value, maximum) && SAFE_ID.test(value);
}

function stableCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableJson(value) {
  const json = JSON.stringify(value);
  if (typeof json !== 'string' || Buffer.byteLength(json, 'utf8') > MAX_JSON_BYTES) fail();
  return json;
}

function digest(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function candidateId(tenantHash, runId, canonicalUrl) {
  return digest(`event-intelligence:frontier-candidate:v1\0${tenantHash}\0${runId}\0${canonicalUrl}`);
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeUrl(raw) {
  if (!validText(raw, 8_192)) fail();
  try {
    const parsed = parseAndValidateUrl(raw);
    return { suppliedUrl: raw, canonicalUrl: parsed.url.href };
  } catch {
    fail();
  }
}

function normalizeLocator(value) {
  const locator = ownRecord(value, new Set(['kind', 'startByte', 'endByte', 'pointer']));
  if (!locator || typeof locator.kind !== 'string') fail();
  if (locator.kind === 'text-range') {
    if (Object.hasOwn(locator, 'pointer')
      || !Number.isSafeInteger(locator.startByte) || locator.startByte < 0
      || !Number.isSafeInteger(locator.endByte) || locator.endByte <= locator.startByte) fail();
    return { kind: 'text-range', startByte: locator.startByte, endByte: locator.endByte };
  }
  if (locator.kind === 'json-pointer') {
    if (Object.hasOwn(locator, 'startByte') || Object.hasOwn(locator, 'endByte')
      || !validText(locator.pointer, 2_048, { allowEmpty: true })
      || (locator.pointer !== '' && !locator.pointer.startsWith('/'))
      || /~(?![01])/.test(locator.pointer)) fail();
    return { kind: 'json-pointer', pointer: locator.pointer };
  }
  fail();
}

function normalizeSourceReference(value, exactUrl) {
  const input = ownRecord(value, new Set(['evidenceId', 'contentHash', 'locator', 'field', 'value']));
  if (!input || !validId(input.evidenceId, 160) || typeof input.contentHash !== 'string'
    || !HEX_SHA256.test(input.contentHash)
    || !validText(input.field, 160) || !validText(input.value, 8_192) || input.value !== exactUrl) fail();
  return {
    evidenceId: input.evidenceId,
    contentHash: input.contentHash,
    locator: normalizeLocator(input.locator),
    field: input.field,
    value: input.value,
  };
}

function normalizeReferences(value, exactUrl, { required, maximum = MAX_SOURCE_REFS } = {}) {
  const raw = value === undefined && !required ? [] : ownArray(value, maximum);
  if (!raw || (required && raw.length === 0)) fail();
  const references = raw.map((reference) => normalizeSourceReference(reference, exactUrl));
  references.sort((left, right) => stableCompare(stableJson(left), stableJson(right)));
  return references;
}

function normalizeSeed(value) {
  const input = ownRecord(value, new Set(['url', 'sourceRefs']));
  if (!input) fail();
  const url = normalizeUrl(input.url);
  const sourceRefs = normalizeReferences(input.sourceRefs, url.suppliedUrl, { required: false });
  return { ...url, sourceRefs };
}

function normalizeSuggestion(value) {
  const input = ownRecord(value, new Set(['url', 'label', 'sourceRefs']));
  if (!input) fail();
  const url = normalizeUrl(input.url);
  const label = input.label === undefined ? null : input.label;
  if (input.label !== undefined && !validText(label, 512)) fail();
  const sourceRefs = normalizeReferences(input.sourceRefs, url.suppliedUrl, { required: true });
  return { ...url, label, sourceRefs };
}

function normalizeLimits(value) {
  if (value === undefined) return { ...DEFAULT_LIMITS };
  const limits = ownRecord(value, new Set(Object.keys(DEFAULT_LIMITS)));
  if (!limits) fail();
  const merged = { ...DEFAULT_LIMITS, ...limits };
  if (!Number.isSafeInteger(merged.maxDepth) || merged.maxDepth < 0 || merged.maxDepth > MAX_DEPTH
    || !Number.isSafeInteger(merged.maxTransportAttemptAdmissions) || merged.maxTransportAttemptAdmissions < 1
      || merged.maxTransportAttemptAdmissions > MAX_ATTEMPT_ADMISSIONS
    || !Number.isSafeInteger(merged.maxInFlightLeases) || merged.maxInFlightLeases < 1
      || merged.maxInFlightLeases > MAX_IN_FLIGHT
    || !Number.isSafeInteger(merged.durationMs) || merged.durationMs < 1 || merged.durationMs > MAX_DURATION_MS
    || !Number.isSafeInteger(merged.maxSuggestionsPerCompletion) || merged.maxSuggestionsPerCompletion < 1
      || merged.maxSuggestionsPerCompletion > MAX_SUGGESTIONS) fail();
  return merged;
}

function normalizeRunInput(value) {
  const input = ownRecord(value, new Set(['runId', 'seeds', 'limits']));
  if (!input || !validId(input.runId, 96)) fail();
  const seedsRaw = ownArray(input.seeds, MAX_SEEDS);
  if (!seedsRaw || seedsRaw.length < 1) fail();
  const seeds = seedsRaw.map(normalizeSeed);
  seeds.sort((left, right) => stableCompare(stableJson(left), stableJson(right)));
  const limits = normalizeLimits(input.limits);
  const config = { schema: 'ei-private-bounded-frontier/v1', runId: input.runId, seeds, limits };
  return { runId: input.runId, seeds, limits, config, configJson: stableJson(config), configHash: digest(stableJson(config)) };
}

function normalizeWorkerInput(value) {
  const input = ownRecord(value, new Set(['workerId', 'claimKey']));
  if (!input || !validId(input.workerId, 96) || !validId(input.claimKey, 128)) fail();
  return input;
}

function normalizeAttemptInput(value) {
  const input = ownRecord(value, new Set(['leaseToken', 'attemptKey', 'kind', 'previousAttemptKey', 'url']));
  if (!input || !validId(input.leaseToken, 64) || !validId(input.attemptKey, 128)
    || !['initial', 'retry', 'redirect'].includes(input.kind)) fail();
  const url = normalizeUrl(input.url);
  const previousAttemptKey = input.previousAttemptKey;
  if (input.kind === 'initial') {
    if (previousAttemptKey !== undefined) fail();
  } else if (!validId(previousAttemptKey, 128)) fail();
  return { ...input, ...url, previousAttemptKey: previousAttemptKey ?? null };
}

function normalizeCompletionInput(value) {
  const input = ownRecord(value, new Set(['leaseToken', 'completionKey', 'outcome', 'suggestions', 'truncatedCount']));
  if (!input || !validId(input.leaseToken, 64) || !validId(input.completionKey, 128)
    || !['links_observed', 'no_links', 'failed', 'access_restricted'].includes(input.outcome)) fail();
  const suggestionsRaw = ownArray(input.suggestions, MAX_SUGGESTIONS);
  if (!suggestionsRaw) fail();
  const suggestions = suggestionsRaw.map(normalizeSuggestion);
  suggestions.sort((left, right) => stableCompare(stableJson(left), stableJson(right)));
  const truncatedCount = input.truncatedCount ?? 0;
  if (!Number.isSafeInteger(truncatedCount) || truncatedCount < 0 || truncatedCount > 1_000_000) fail();
  if ((input.outcome !== 'links_observed' && (suggestions.length > 0 || truncatedCount > 0))) fail();
  return { leaseToken: input.leaseToken, completionKey: input.completionKey, outcome: input.outcome, suggestions, truncatedCount };
}

function normalizeUnresolvedInput(value) {
  const input = ownRecord(value, new Set(['leaseToken', 'reason']));
  if (!input || !validId(input.leaseToken, 64)
    || !['worker_lost', 'dispatch_state_unknown', 'cancelled_before_dispatch'].includes(input.reason)) fail();
  return input;
}

function isBusy(error) {
  return error?.errcode === 5 || error?.errcode === 6 || error?.code === 'ERR_SQLITE_BUSY';
}

function safeStorageError(error) {
  if (error instanceof DiscoveryFrontierError) return error;
  if (error?.errcode === 13 || error?.code === 'ERR_SQLITE_FULL') {
    return new DiscoveryFrontierError('FRONTIER_STORAGE_LIMIT');
  }
  return new DiscoveryFrontierError(isBusy(error) ? 'FRONTIER_BUSY' : 'FRONTIER_STORAGE');
}

function schemaSql() {
  return `
    CREATE TABLE IF NOT EXISTS frontier_runs (
      tenant_hash TEXT NOT NULL,
      run_id TEXT NOT NULL,
      config_hash TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at_ms INTEGER NOT NULL,
      deadline_at_ms INTEGER NOT NULL,
      last_clock_ms INTEGER NOT NULL,
      max_depth INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      max_in_flight INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      max_suggestions INTEGER NOT NULL,
      attempts_admitted INTEGER NOT NULL DEFAULT 0,
      next_observation_sequence INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL CHECK (status IN ('active', 'halted', 'exhausted')),
      halt_reason TEXT,
      PRIMARY KEY (tenant_hash, run_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS frontier_candidates (
      tenant_hash TEXT NOT NULL,
      run_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      best_depth INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('queued', 'leased', 'completed', 'unresolved', 'depth_limited')),
      is_seed INTEGER NOT NULL CHECK (is_seed IN (0, 1)),
      attempts_admitted INTEGER NOT NULL DEFAULT 0,
      last_attempt_key TEXT,
      lease_token TEXT,
      lease_worker_id TEXT,
      PRIMARY KEY (tenant_hash, run_id, candidate_id),
      UNIQUE (tenant_hash, run_id, canonical_url),
      FOREIGN KEY (tenant_hash, run_id) REFERENCES frontier_runs (tenant_hash, run_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS frontier_claim_order
      ON frontier_candidates (tenant_hash, run_id, state, best_depth, canonical_url COLLATE BINARY);
    CREATE TABLE IF NOT EXISTS frontier_claims (
      tenant_hash TEXT NOT NULL,
      run_id TEXT NOT NULL,
      claim_key TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      lease_token TEXT NOT NULL,
      worker_id TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('leased', 'completed', 'unresolved')),
      resolution_reason TEXT,
      PRIMARY KEY (tenant_hash, run_id, claim_key),
      UNIQUE (tenant_hash, run_id, lease_token),
      FOREIGN KEY (tenant_hash, run_id, candidate_id)
        REFERENCES frontier_candidates (tenant_hash, run_id, candidate_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS frontier_attempts (
      tenant_hash TEXT NOT NULL,
      run_id TEXT NOT NULL,
      attempt_key TEXT NOT NULL,
      attempt_sequence INTEGER NOT NULL,
      candidate_id TEXT NOT NULL,
      claim_key TEXT NOT NULL,
      lease_token TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('initial', 'retry', 'redirect')),
      previous_attempt_key TEXT,
      canonical_url TEXT NOT NULL,
      admitted_at_ms INTEGER NOT NULL,
      PRIMARY KEY (tenant_hash, run_id, attempt_key),
      UNIQUE (tenant_hash, run_id, attempt_sequence),
      FOREIGN KEY (tenant_hash, run_id, claim_key)
        REFERENCES frontier_claims (tenant_hash, run_id, claim_key),
      FOREIGN KEY (tenant_hash, run_id, candidate_id)
        REFERENCES frontier_candidates (tenant_hash, run_id, candidate_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS frontier_observations (
      tenant_hash TEXT NOT NULL,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('seed', 'link')),
      parent_candidate_id TEXT,
      target_candidate_id TEXT NOT NULL,
      supplied_url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      depth INTEGER NOT NULL,
      label TEXT,
      source_refs_json TEXT NOT NULL,
      disposition TEXT NOT NULL CHECK (disposition IN (
        'seed', 'duplicate', 'cycle', 'depth_limit', 'queued', 'retained_after_stop'
      )),
      outcome TEXT,
      PRIMARY KEY (tenant_hash, run_id, sequence),
      FOREIGN KEY (tenant_hash, run_id, parent_candidate_id)
        REFERENCES frontier_candidates (tenant_hash, run_id, candidate_id),
      FOREIGN KEY (tenant_hash, run_id, target_candidate_id)
        REFERENCES frontier_candidates (tenant_hash, run_id, candidate_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS frontier_completions (
      tenant_hash TEXT NOT NULL,
      run_id TEXT NOT NULL,
      completion_key TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      lease_token TEXT NOT NULL,
      outcome TEXT NOT NULL,
      PRIMARY KEY (tenant_hash, run_id, completion_key),
      FOREIGN KEY (tenant_hash, run_id, candidate_id)
        REFERENCES frontier_candidates (tenant_hash, run_id, candidate_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS frontier_stops (
      tenant_hash TEXT NOT NULL,
      run_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      occurred_at_ms INTEGER NOT NULL,
      PRIMARY KEY (tenant_hash, run_id, reason),
      FOREIGN KEY (tenant_hash, run_id) REFERENCES frontier_runs (tenant_hash, run_id)
    ) STRICT;
  `;
}

async function ensureDirectory(directory) {
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stats = await lstat(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) fail('FRONTIER_STORAGE');
    await chmod(directory, 0o700);
  } catch (error) {
    if (error instanceof DiscoveryFrontierError) throw error;
    throw safeStorageError(error);
  }
}

function safeIntegerTime(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('FRONTIER_STORAGE');
  return value;
}

async function openDatabase(directory, tenantHash, timeoutMs) {
  const tenantDirectory = path.join(directory, tenantHash);
  await ensureDirectory(tenantDirectory);
  const databasePath = path.join(tenantDirectory, 'frontier.sqlite');
  let priorStats = null;
  try {
    priorStats = await lstat(databasePath);
    if (priorStats.isSymbolicLink() || !priorStats.isFile()) fail('FRONTIER_STORAGE');
  } catch (error) {
    if (error instanceof DiscoveryFrontierError) throw error;
    if (error?.code !== 'ENOENT') throw safeStorageError(error);
  }
  let database;
  try {
    database = new DatabaseSync(databasePath, { timeout: timeoutMs });
    const openedStats = await lstat(databasePath);
    if (openedStats.isSymbolicLink() || !openedStats.isFile()
      || (priorStats && (openedStats.dev !== priorStats.dev || openedStats.ino !== priorStats.ino))) {
      fail('FRONTIER_STORAGE');
    }
    database.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA synchronous = FULL;
      PRAGMA secure_delete = ON;
      PRAGMA trusted_schema = OFF;
      PRAGMA foreign_keys = ON;
      PRAGMA max_page_count = ${MAX_DATABASE_PAGES};
    `);
    const version = database.prepare('PRAGMA user_version').get().user_version;
    if (version !== 0 && version !== SCHEMA_VERSION) fail('FRONTIER_VERSION');
    database.exec(schemaSql());
    if (version === 0) database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    await chmod(databasePath, 0o600);
    const pageSize = database.prepare('PRAGMA page_size').get().page_size;
    const pageCount = database.prepare('PRAGMA page_count').get().page_count;
    if (!Number.isSafeInteger(pageSize) || !Number.isSafeInteger(pageCount)
      || pageSize * pageCount > MAX_DATABASE_BYTES) fail('FRONTIER_STORAGE_LIMIT');
    return database;
  } catch (error) {
    try { database?.close(); } catch { /* Close failures do not replace the bounded error. */ }
    throw safeStorageError(error);
  }
}

function pageBytes(database) {
  const size = database.prepare('PRAGMA page_size').get().page_size;
  const count = database.prepare('PRAGMA page_count').get().page_count;
  if (!Number.isSafeInteger(size) || !Number.isSafeInteger(count)) fail('FRONTIER_STORAGE');
  return size * count;
}

function transaction(database, callback) {
  let open = false;
  try {
    database.exec('BEGIN IMMEDIATE');
    open = true;
    const result = callback(database);
    if (pageBytes(database) > MAX_DATABASE_BYTES) fail('FRONTIER_STORAGE_LIMIT');
    database.exec('COMMIT');
    open = false;
    return result;
  } catch (error) {
    if (open) {
      try { database.exec('ROLLBACK'); } catch { /* SQLite rolls back when the connection closes. */ }
    }
    throw safeStorageError(error);
  }
}

function getRun(database, tenantHash, runId) {
  const run = database.prepare(`SELECT * FROM frontier_runs WHERE tenant_hash = ? AND run_id = ?`)
    .get(tenantHash, runId);
  if (!run) fail('FRONTIER_NOT_FOUND');
  return run;
}

function recordStop(database, tenantHash, runId, reason, nowMs, halt = GLOBAL_HALT_REASONS.has(reason)) {
  if (!STOP_REASONS.has(reason)) fail('FRONTIER_STORAGE');
  database.prepare(`INSERT OR IGNORE INTO frontier_stops (tenant_hash, run_id, reason, occurred_at_ms)
    VALUES (?, ?, ?, ?)`).run(tenantHash, runId, reason, nowMs);
  if (halt) {
    database.prepare(`UPDATE frontier_runs SET status = CASE WHEN status = 'active' THEN 'halted' ELSE status END,
      halt_reason = CASE WHEN status = 'active' THEN ? ELSE halt_reason END
      WHERE tenant_hash = ? AND run_id = ?`).run(reason, tenantHash, runId);
  }
}

function advanceClock(database, tenantHash, run, readClock) {
  let current;
  try { current = safeIntegerTime(readClock()); } catch { fail('FRONTIER_STORAGE'); }
  const nowMs = Math.max(run.last_clock_ms, current);
  database.prepare(`UPDATE frontier_runs SET last_clock_ms = ? WHERE tenant_hash = ? AND run_id = ?`)
    .run(nowMs, tenantHash, run.run_id);
  const updated = { ...run, last_clock_ms: nowMs };
  if (nowMs >= run.deadline_at_ms && run.status === 'active') {
    recordStop(database, tenantHash, run.run_id, 'deadline', nowMs, true);
    updated.status = 'halted';
    updated.halt_reason = 'deadline';
  }
  return updated;
}

function candidateRow(database, tenantHash, runId, id) {
  return database.prepare(`SELECT * FROM frontier_candidates
    WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`).get(tenantHash, runId, id);
}

function hasPath(database, tenantHash, runId, startId, targetId) {
  if (startId === targetId) return true;
  const rows = database.prepare(`SELECT parent_candidate_id, target_candidate_id
    FROM frontier_observations WHERE tenant_hash = ? AND run_id = ? AND kind = 'link'`)
    .all(tenantHash, runId);
  const edges = new Map();
  for (const row of rows) {
    const children = edges.get(row.parent_candidate_id) ?? [];
    children.push(row.target_candidate_id);
    edges.set(row.parent_candidate_id, children);
  }
  const pending = [startId];
  const visited = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === targetId) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const child of edges.get(current) ?? []) pending.push(child);
  }
  return false;
}

function insertCandidate(database, tenantHash, runId, canonicalUrl, depth, isSeed, maxDepth) {
  const id = candidateId(tenantHash, runId, canonicalUrl);
  let candidate = database.prepare(`SELECT * FROM frontier_candidates
    WHERE tenant_hash = ? AND run_id = ? AND canonical_url = ?`).get(tenantHash, runId, canonicalUrl);
  const existed = Boolean(candidate);
  if (!candidate) {
    const state = depth > maxDepth ? 'depth_limited' : 'queued';
    database.prepare(`INSERT INTO frontier_candidates
      (tenant_hash, run_id, candidate_id, canonical_url, best_depth, state, is_seed)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(tenantHash, runId, id, canonicalUrl, depth, state, isSeed ? 1 : 0);
    candidate = candidateRow(database, tenantHash, runId, id);
  } else {
    const bestDepth = Math.min(candidate.best_depth, depth);
    const nextState = candidate.state === 'depth_limited' && bestDepth <= maxDepth ? 'queued' : candidate.state;
    database.prepare(`UPDATE frontier_candidates SET best_depth = ?, is_seed = ? OR is_seed,
      state = ? WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
      .run(bestDepth, isSeed ? 1 : 0, nextState, tenantHash, runId, id);
    candidate = candidateRow(database, tenantHash, runId, id);
  }
  return { candidate, existed };
}

function insertObservation(database, tenantHash, run, { kind, parentCandidateId = null, suppliedUrl,
  canonicalUrl, depth, label = null, sourceRefs, outcome = null }) {
  const { candidate, existed } = insertCandidate(database, tenantHash, run.run_id, canonicalUrl,
    depth, kind === 'seed', run.max_depth);
  let disposition;
  if (kind === 'seed') {
    disposition = existed ? 'duplicate' : 'seed';
  } else if (hasPath(database, tenantHash, run.run_id, candidate.candidate_id, parentCandidateId)) {
    disposition = 'cycle';
  } else if (depth > run.max_depth) {
    disposition = 'depth_limit';
  } else if (existed) {
    disposition = 'duplicate';
  } else if (run.status !== 'active') {
    disposition = 'retained_after_stop';
  } else {
    disposition = 'queued';
  }
  if (disposition === 'depth_limit') {
    recordStop(database, tenantHash, run.run_id, 'depth_limit', run.last_clock_ms, false);
  }
  const currentSequence = database.prepare(`SELECT next_observation_sequence FROM frontier_runs
    WHERE tenant_hash = ? AND run_id = ?`).get(tenantHash, run.run_id).next_observation_sequence;
  database.prepare(`INSERT INTO frontier_observations
    (tenant_hash, run_id, sequence, kind, parent_candidate_id, target_candidate_id, supplied_url,
     canonical_url, depth, label, source_refs_json, disposition, outcome)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(tenantHash, run.run_id, currentSequence, kind, parentCandidateId, candidate.candidate_id,
      suppliedUrl, canonicalUrl, depth, label, stableJson(sourceRefs), disposition, outcome);
  database.prepare(`UPDATE frontier_runs SET next_observation_sequence = ?
    WHERE tenant_hash = ? AND run_id = ?`).run(currentSequence + 1, tenantHash, run.run_id);
  return { candidate, disposition };
}

function safeJsonParse(value) {
  try {
    const parsed = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || !Array.isArray(parsed)) fail('FRONTIER_STORAGE');
    return parsed;
  } catch (error) {
    if (error instanceof DiscoveryFrontierError) throw error;
    fail('FRONTIER_STORAGE');
  }
}

function snapshotInTransaction(database, tenantHash, runId) {
  const run = getRun(database, tenantHash, runId);
  const candidateRows = database.prepare(`SELECT * FROM frontier_candidates
    WHERE tenant_hash = ? AND run_id = ? ORDER BY best_depth, canonical_url COLLATE BINARY, candidate_id COLLATE BINARY`)
    .all(tenantHash, runId);
  const observationRows = database.prepare(`SELECT * FROM frontier_observations
    WHERE tenant_hash = ? AND run_id = ?`).all(tenantHash, runId);
  const attemptRows = database.prepare(`SELECT attempt_key, attempt_sequence, candidate_id, kind,
    previous_attempt_key, canonical_url, admitted_at_ms FROM frontier_attempts
    WHERE tenant_hash = ? AND run_id = ? ORDER BY attempt_sequence`).all(tenantHash, runId);
  const stopRows = database.prepare(`SELECT reason, occurred_at_ms FROM frontier_stops
    WHERE tenant_hash = ? AND run_id = ? ORDER BY reason COLLATE BINARY`).all(tenantHash, runId);
  const completionRows = database.prepare(`SELECT candidate_id, outcome FROM frontier_completions
    WHERE tenant_hash = ? AND run_id = ?`).all(tenantHash, runId);
  const completionByCandidate = new Map(completionRows.map((row) => [row.candidate_id, row.outcome]));
  const observations = observationRows.map((row) => ({
    kind: row.kind,
    parentCandidateId: row.parent_candidate_id,
    targetCandidateId: row.target_candidate_id,
    suppliedUrl: row.supplied_url,
    canonicalUrl: row.canonical_url,
    depth: row.depth,
    ...(row.label === null ? {} : { untrustedLabel: row.label }),
    sourceRefs: safeJsonParse(row.source_refs_json),
    disposition: row.disposition,
    ...(row.outcome === null ? {} : { outcome: row.outcome }),
    sourceAuthority: 'not_evaluated',
  }));
  observations.sort((left, right) => stableCompare(
    stableJson([left.kind, left.parentCandidateId ?? '', left.canonicalUrl, left.suppliedUrl,
      stableJson(left.sourceRefs), left.untrustedLabel ?? '', left.disposition, left.outcome ?? '']),
    stableJson([right.kind, right.parentCandidateId ?? '', right.canonicalUrl, right.suppliedUrl,
      stableJson(right.sourceRefs), right.untrustedLabel ?? '', right.disposition, right.outcome ?? '']),
  ));
  const allReferences = observations.flatMap((item) => item.sourceRefs);
  const refsByCandidate = new Map();
  for (const observation of observations) {
    const references = refsByCandidate.get(observation.targetCandidateId) ?? [];
    references.push(...observation.sourceRefs);
    refsByCandidate.set(observation.targetCandidateId, references);
  }
  const candidates = candidateRows.map((row) => {
    const references = refsByCandidate.get(row.candidate_id) ?? [];
    const uniqueReferences = [...new Map(references.map((reference) => [stableJson(reference), reference])).values()];
    uniqueReferences.sort((left, right) => stableCompare(stableJson(left), stableJson(right)));
    const candidateClaim = database.prepare(`SELECT claim_key, worker_id, state, resolution_reason
      FROM frontier_claims WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
      .get(tenantHash, runId, row.candidate_id);
    return {
      candidateId: row.candidate_id,
      canonicalUrl: row.canonical_url,
      depth: row.best_depth,
      state: row.state,
      seed: row.is_seed === 1,
      admittedAttemptCount: row.attempts_admitted,
      ...(completionByCandidate.has(row.candidate_id)
        ? { completionOutcome: completionByCandidate.get(row.candidate_id) } : {}),
      ...(candidateClaim?.state === 'leased'
        ? { activeLease: { claimKey: candidateClaim.claim_key, workerId: candidateClaim.worker_id } } : {}),
      ...(candidateClaim?.state === 'unresolved' ? { unresolvedReason: candidateClaim.resolution_reason } : {}),
      sourceRefs: uniqueReferences,
      sourceAuthority: 'not_evaluated',
    };
  });
  const refsByHash = new Map();
  for (const reference of allReferences) {
    const evidenceIds = refsByHash.get(reference.contentHash) ?? new Set();
    evidenceIds.add(reference.evidenceId);
    refsByHash.set(reference.contentHash, evidenceIds);
  }
  const duplicateContentGroups = [...refsByHash.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([contentHash, ids]) => ({
      contentHash,
      evidenceIds: [...ids].sort(stableCompare),
      independence: 'unknown',
    }))
    .sort((left, right) => stableCompare(left.contentHash, right.contentHash));
  const stops = stopRows.map((row) => ({ reason: row.reason, occurredAtMs: row.occurred_at_ms }));
  const settings = JSON.parse(run.config_json).limits;
  const terminalStop = run.halt_reason
    ?? (run.status === 'exhausted' ? (stops[stops.length - 1]?.reason ?? null) : null);
  return deepFreeze({
    schema: 'ei-private-bounded-frontier/v1',
    runId,
    createdAtMs: run.created_at_ms,
    deadlineAtMs: run.deadline_at_ms,
    lastObservedClockMs: run.last_clock_ms,
    state: run.status,
    stopReason: terminalStop,
    stopReasons: stops,
    limits: settings,
    counters: {
      seedInputs: observations.filter((item) => item.kind === 'seed').length,
      uniqueCandidates: candidates.length,
      transportAttemptAdmissions: run.attempts_admitted,
      inFlightLeases: candidates.filter((candidate) => candidate.state === 'leased').length,
    },
    candidates,
    observations,
    attempts: attemptRows.map((row) => ({
      attemptKey: row.attempt_key,
      sequence: row.attempt_sequence,
      candidateId: row.candidate_id,
      kind: row.kind,
      previousAttemptKey: row.previous_attempt_key,
      canonicalUrl: row.canonical_url,
      admittedAtMs: row.admitted_at_ms,
    })),
    duplicateContentGroups,
    sourceAuthority: 'not_evaluated',
    independentCorroboration: 'not_evaluated',
    usageStatus: 'unknown',
    budgetAuthority: 'not_evaluated',
    transportDispatch: 'not_implemented',
    readiness: 'blocked_no_transport_adapter',
  });
}

function expireOrExhaust(database, tenantHash, run, readClock) {
  const updated = advanceClock(database, tenantHash, run, readClock);
  if (updated.status !== 'active') return updated;
  if (updated.attempts_admitted >= updated.max_attempts) {
    recordStop(database, tenantHash, updated.run_id, 'attempt_limit', updated.last_clock_ms, true);
    return { ...updated, status: 'halted', halt_reason: 'attempt_limit' };
  }
  const counts = database.prepare(`SELECT
    SUM(CASE WHEN state = 'queued' THEN 1 ELSE 0 END) AS queued,
    SUM(CASE WHEN state = 'leased' THEN 1 ELSE 0 END) AS leased,
    SUM(CASE WHEN state = 'depth_limited' THEN 1 ELSE 0 END) AS depth_limited
    FROM frontier_candidates WHERE tenant_hash = ? AND run_id = ?`).get(tenantHash, updated.run_id);
  if ((counts.queued ?? 0) === 0 && (counts.leased ?? 0) === 0) {
    const reason = (counts.depth_limited ?? 0) > 0 ? 'depth_limit' : 'frontier_exhausted';
    recordStop(database, tenantHash, updated.run_id, reason, updated.last_clock_ms, false);
    database.prepare(`UPDATE frontier_runs SET status = 'exhausted', halt_reason = ?
      WHERE tenant_hash = ? AND run_id = ?`).run(reason, tenantHash, updated.run_id);
    return { ...updated, status: 'exhausted', halt_reason: reason };
  }
  return updated;
}

function getClaimByToken(database, tenantHash, runId, leaseToken) {
  return database.prepare(`SELECT * FROM frontier_claims
    WHERE tenant_hash = ? AND run_id = ? AND lease_token = ?`).get(tenantHash, runId, leaseToken);
}

function claimResult(database, tenantHash, runId, claim, replayed) {
  const candidate = candidateRow(database, tenantHash, runId, claim.candidate_id);
  return deepFreeze({
    state: claim.state === 'leased' ? 'claimed' : claim.state,
    replayed,
    claimKey: claim.claim_key,
    leaseToken: claim.lease_token,
    workerId: claim.worker_id,
    candidate: {
      candidateId: candidate.candidate_id,
      canonicalUrl: candidate.canonical_url,
      depth: candidate.best_depth,
      admittedAttemptCount: candidate.attempts_admitted,
    },
  });
}

function appendStopSnapshot(database, tenantHash, runId, reason, nowMs, halt) {
  recordStop(database, tenantHash, runId, reason, nowMs, halt);
}

export function createDiscoveryFrontierStore(options) {
  const config = ownRecord(options, new Set(['directory', 'resolveTenant', 'now', 'lockTimeoutMs']));
  if (!config || !validText(config.directory, 4_096) || !path.isAbsolute(config.directory)
    || typeof config.resolveTenant !== 'function'
    || (config.now !== undefined && typeof config.now !== 'function')) fail();
  const lockTimeoutMs = config.lockTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(lockTimeoutMs) || lockTimeoutMs < 1 || lockTimeoutMs > MAX_SQLITE_TIMEOUT_MS) fail();
  const directory = path.resolve(config.directory);
  const now = config.now ?? Date.now;
  const tenantScopes = new WeakMap();
  let closed = false;

  function assertOpen() {
    if (closed) fail('FRONTIER_STORAGE');
  }

  async function withScope(scope, operation) {
    assertOpen();
    let scopeInfo;
    try { scopeInfo = tenantScopes.get(scope); } catch { scopeInfo = undefined; }
    if (!scopeInfo) fail('FRONTIER_DENIED');
    const database = await openDatabase(directory, scopeInfo.tenantHash, lockTimeoutMs);
    try {
      assertOpen();
      return transaction(database, (db) => operation(db, scopeInfo));
    } catch (error) {
      throw safeStorageError(error);
    } finally {
      try { database.close(); } catch { /* The public result does not expose driver details. */ }
    }
  }

  async function scopeForAuthenticatedRequest(request) {
    assertOpen();
    let tenantId;
    try { tenantId = await config.resolveTenant(request); } catch { fail('FRONTIER_DENIED'); }
    if (!validText(tenantId, 256)) fail('FRONTIER_DENIED');
    const tenantHash = digest(`event-intelligence:tenant:v1:${tenantId}`);
    const scope = Object.freeze(Object.create(null));
    tenantScopes.set(scope, { tenantHash });
    return scope;
  }

  async function createRun(scope, value) {
    const input = normalizeRunInput(value);
    return withScope(scope, (database, { tenantHash }) => {
      const prior = database.prepare(`SELECT config_hash FROM frontier_runs
        WHERE tenant_hash = ? AND run_id = ?`).get(tenantHash, input.runId);
      if (prior) {
        if (prior.config_hash !== input.configHash) fail('FRONTIER_CONFLICT');
        const run = getRun(database, tenantHash, input.runId);
        expireOrExhaust(database, tenantHash, run, now);
        return snapshotInTransaction(database, tenantHash, input.runId);
      }
      const storedCount = database.prepare(`SELECT COUNT(*) AS count FROM frontier_runs WHERE tenant_hash = ?`)
        .get(tenantHash).count;
      if (storedCount >= MAX_RUNS_PER_TENANT) fail('FRONTIER_STORAGE_LIMIT');
      let clockNow;
      try { clockNow = safeIntegerTime(now()); } catch { fail('FRONTIER_STORAGE'); }
      const deadline = clockNow + input.limits.durationMs;
      if (!Number.isSafeInteger(deadline)) fail('FRONTIER_INVALID_INPUT');
      database.prepare(`INSERT INTO frontier_runs
        (tenant_hash, run_id, config_hash, config_json, created_at_ms, deadline_at_ms, last_clock_ms,
         max_depth, max_attempts, max_in_flight, duration_ms, max_suggestions, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`)
        .run(tenantHash, input.runId, input.configHash, input.configJson, clockNow, deadline, clockNow,
          input.limits.maxDepth, input.limits.maxTransportAttemptAdmissions, input.limits.maxInFlightLeases,
          input.limits.durationMs, input.limits.maxSuggestionsPerCompletion);
      const run = getRun(database, tenantHash, input.runId);
      for (const seed of input.seeds) {
        insertObservation(database, tenantHash, run, {
          kind: 'seed', suppliedUrl: seed.suppliedUrl, canonicalUrl: seed.canonicalUrl,
          depth: 0, sourceRefs: seed.sourceRefs,
        });
      }
      return snapshotInTransaction(database, tenantHash, input.runId);
    });
  }

  async function claimNext(scope, runIdValue, workerValue) {
    if (!validId(runIdValue, 96)) fail();
    const worker = normalizeWorkerInput(workerValue);
    return withScope(scope, (database, { tenantHash }) => {
      let run = getRun(database, tenantHash, runIdValue);
      run = expireOrExhaust(database, tenantHash, run, now);
      const prior = database.prepare(`SELECT * FROM frontier_claims
        WHERE tenant_hash = ? AND run_id = ? AND claim_key = ?`).get(tenantHash, runIdValue, worker.claimKey);
      if (prior) {
        if (prior.worker_id !== worker.workerId) fail('FRONTIER_CONFLICT');
        return claimResult(database, tenantHash, runIdValue, prior, true);
      }
      if (run.status !== 'active') return deepFreeze({ state: 'stopped', reason: run.halt_reason ?? 'frontier_exhausted' });
      const inFlight = database.prepare(`SELECT COUNT(*) AS count FROM frontier_candidates
        WHERE tenant_hash = ? AND run_id = ? AND state = 'leased'`).get(tenantHash, runIdValue).count;
      if (inFlight >= run.max_in_flight) return deepFreeze({ state: 'waiting', reason: 'in_flight_limit' });
      const eligible = database.prepare(`SELECT * FROM frontier_candidates
        WHERE tenant_hash = ? AND run_id = ? AND state = 'queued' AND best_depth <= ?`)
        .all(tenantHash, runIdValue, run.max_depth)
        .sort((left, right) => left.best_depth - right.best_depth
          || stableCompare(left.canonical_url, right.canonical_url)
          || stableCompare(left.candidate_id, right.candidate_id));
      if (eligible.length === 0) {
        run = expireOrExhaust(database, tenantHash, run, now);
        return deepFreeze({ state: run.status === 'active' ? 'waiting' : 'empty',
          reason: run.halt_reason ?? 'frontier_exhausted' });
      }
      const candidate = eligible[0];
      const token = randomUUID();
      database.prepare(`UPDATE frontier_candidates SET state = 'leased', lease_token = ?, lease_worker_id = ?
        WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ? AND state = 'queued'`)
        .run(token, worker.workerId, tenantHash, runIdValue, candidate.candidate_id);
      database.prepare(`INSERT INTO frontier_claims
        (tenant_hash, run_id, claim_key, candidate_id, lease_token, worker_id, state)
        VALUES (?, ?, ?, ?, ?, ?, 'leased')`)
        .run(tenantHash, runIdValue, worker.claimKey, candidate.candidate_id, token, worker.workerId);
      const claim = database.prepare(`SELECT * FROM frontier_claims
        WHERE tenant_hash = ? AND run_id = ? AND claim_key = ?`).get(tenantHash, runIdValue, worker.claimKey);
      return claimResult(database, tenantHash, runIdValue, claim, false);
    });
  }

  async function admitAttempt(scope, runIdValue, value) {
    if (!validId(runIdValue, 96)) fail();
    const input = normalizeAttemptInput(value);
    return withScope(scope, (database, { tenantHash }) => {
      let run = getRun(database, tenantHash, runIdValue);
      run = advanceClock(database, tenantHash, run, now);
      const previous = database.prepare(`SELECT * FROM frontier_attempts
        WHERE tenant_hash = ? AND run_id = ? AND attempt_key = ?`)
        .get(tenantHash, runIdValue, input.attemptKey);
      if (previous) {
        const same = previous.lease_token === input.leaseToken
          && previous.kind === input.kind
          && previous.previous_attempt_key === input.previousAttemptKey
          && previous.canonical_url === input.canonicalUrl;
        if (!same) fail('FRONTIER_CONFLICT');
        return deepFreeze({ state: 'already_admitted', attemptKey: previous.attempt_key,
          sequence: previous.attempt_sequence, admittedAtMs: previous.admitted_at_ms });
      }
      const claim = getClaimByToken(database, tenantHash, runIdValue, input.leaseToken);
      const candidate = claim ? candidateRow(database, tenantHash, runIdValue, claim.candidate_id) : null;
      if (!claim || claim.state !== 'leased' || !candidate || candidate.state !== 'leased'
        || candidate.lease_token !== input.leaseToken) fail('FRONTIER_STALE_LEASE');
      if (run.status !== 'active') return deepFreeze({ state: 'denied', reason: run.halt_reason ?? 'frontier_exhausted' });
      if (run.attempts_admitted >= run.max_attempts) {
        appendStopSnapshot(database, tenantHash, runIdValue, 'attempt_limit', run.last_clock_ms, true);
        return deepFreeze({ state: 'denied', reason: 'attempt_limit' });
      }
      const latest = database.prepare(`SELECT * FROM frontier_attempts WHERE tenant_hash = ? AND run_id = ?
        AND candidate_id = ? ORDER BY attempt_sequence DESC LIMIT 1`)
        .get(tenantHash, runIdValue, candidate.candidate_id);
      if (input.kind === 'initial') {
        if (latest || input.canonicalUrl !== candidate.canonical_url) fail('FRONTIER_CONFLICT');
      } else {
        if (!latest || latest.attempt_key !== input.previousAttemptKey || latest.lease_token !== input.leaseToken) {
          fail('FRONTIER_CONFLICT');
        }
        if (input.kind === 'retry' && latest.canonical_url !== input.canonicalUrl) fail('FRONTIER_CONFLICT');
        if (input.kind === 'redirect') {
          if (latest.canonical_url === input.canonicalUrl) fail('FRONTIER_CONFLICT');
          const seen = database.prepare(`SELECT 1 AS found FROM frontier_attempts
            WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ? AND canonical_url = ? LIMIT 1`)
            .get(tenantHash, runIdValue, candidate.candidate_id, input.canonicalUrl);
          if (seen) fail('FRONTIER_CONFLICT');
        }
      }
      const sequence = run.attempts_admitted + 1;
      database.prepare(`INSERT INTO frontier_attempts
        (tenant_hash, run_id, attempt_key, attempt_sequence, candidate_id, claim_key, lease_token,
         kind, previous_attempt_key, canonical_url, admitted_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(tenantHash, runIdValue, input.attemptKey, sequence, candidate.candidate_id, claim.claim_key,
          input.leaseToken, input.kind, input.previousAttemptKey, input.canonicalUrl, run.last_clock_ms);
      database.prepare(`UPDATE frontier_runs SET attempts_admitted = ?
        WHERE tenant_hash = ? AND run_id = ?`).run(sequence, tenantHash, runIdValue);
      database.prepare(`UPDATE frontier_candidates SET attempts_admitted = attempts_admitted + 1,
        last_attempt_key = ? WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
        .run(input.attemptKey, tenantHash, runIdValue, candidate.candidate_id);
      if (sequence >= run.max_attempts) {
        recordStop(database, tenantHash, runIdValue, 'attempt_limit', run.last_clock_ms, true);
      }
      return deepFreeze({ state: 'admitted', attemptKey: input.attemptKey,
        sequence, admittedAtMs: run.last_clock_ms, stopAfterThisAdmission: sequence >= run.max_attempts });
    });
  }

  async function completeCandidate(scope, runIdValue, value) {
    if (!validId(runIdValue, 96)) fail();
    const input = normalizeCompletionInput(value);
    const payloadHash = digest(stableJson({ outcome: input.outcome, suggestions: input.suggestions,
      truncatedCount: input.truncatedCount }));
    return withScope(scope, (database, { tenantHash }) => {
      let run = getRun(database, tenantHash, runIdValue);
      run = advanceClock(database, tenantHash, run, now);
      const priorCompletion = database.prepare(`SELECT * FROM frontier_completions
        WHERE tenant_hash = ? AND run_id = ? AND completion_key = ?`)
        .get(tenantHash, runIdValue, input.completionKey);
      if (priorCompletion) {
        if (priorCompletion.payload_hash !== payloadHash || priorCompletion.lease_token !== input.leaseToken) {
          fail('FRONTIER_CONFLICT');
        }
        return snapshotInTransaction(database, tenantHash, runIdValue);
      }
      const claim = getClaimByToken(database, tenantHash, runIdValue, input.leaseToken);
      const candidate = claim ? candidateRow(database, tenantHash, runIdValue, claim.candidate_id) : null;
      if (!claim || claim.state !== 'leased' || !candidate || candidate.state !== 'leased'
        || candidate.lease_token !== input.leaseToken) fail('FRONTIER_STALE_LEASE');
      if (candidate.attempts_admitted < 1) fail('FRONTIER_CONFLICT');
      if (input.suggestions.length > run.max_suggestions) fail();
      const observedCount = database.prepare(`SELECT COUNT(*) AS count FROM frontier_observations
        WHERE tenant_hash = ? AND run_id = ?`).get(tenantHash, runIdValue).count;
      if (observedCount + input.suggestions.length > MAX_SEEDS + MAX_ATTEMPT_ADMISSIONS * MAX_SUGGESTIONS) {
        fail('FRONTIER_STORAGE_LIMIT');
      }
      database.prepare(`INSERT INTO frontier_completions
        (tenant_hash, run_id, completion_key, payload_hash, candidate_id, lease_token, outcome)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(tenantHash, runIdValue, input.completionKey, payloadHash, candidate.candidate_id,
          input.leaseToken, input.outcome);
      database.prepare(`UPDATE frontier_candidates SET state = 'completed', lease_token = NULL, lease_worker_id = NULL
        WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
        .run(tenantHash, runIdValue, candidate.candidate_id);
      database.prepare(`UPDATE frontier_claims SET state = 'completed'
        WHERE tenant_hash = ? AND run_id = ? AND claim_key = ?`).run(tenantHash, runIdValue, claim.claim_key);
      for (const suggestion of input.suggestions) {
        const parent = candidateRow(database, tenantHash, runIdValue, candidate.candidate_id);
        insertObservation(database, tenantHash, { ...run, status: run.status }, {
          kind: 'link', parentCandidateId: candidate.candidate_id,
          suppliedUrl: suggestion.suppliedUrl, canonicalUrl: suggestion.canonicalUrl,
          depth: parent.best_depth + 1, label: suggestion.label, sourceRefs: suggestion.sourceRefs,
          outcome: input.outcome,
        });
      }
      if (input.truncatedCount > 0) recordStop(database, tenantHash, runIdValue, 'fanout_limit', run.last_clock_ms, false);
      if (input.outcome === 'access_restricted') recordStop(database, tenantHash, runIdValue, 'access_restricted', run.last_clock_ms, true);
      const updated = getRun(database, tenantHash, runIdValue);
      expireOrExhaust(database, tenantHash, updated, now);
      return snapshotInTransaction(database, tenantHash, runIdValue);
    });
  }

  async function markUnresolved(scope, runIdValue, value) {
    if (!validId(runIdValue, 96)) fail();
    const input = normalizeUnresolvedInput(value);
    return withScope(scope, (database, { tenantHash }) => {
      const run = advanceClock(database, tenantHash, getRun(database, tenantHash, runIdValue), now);
      const claim = getClaimByToken(database, tenantHash, runIdValue, input.leaseToken);
      if (!claim) fail('FRONTIER_STALE_LEASE');
      if (claim.state === 'unresolved') {
        if (claim.resolution_reason !== input.reason) fail('FRONTIER_CONFLICT');
        return snapshotInTransaction(database, tenantHash, runIdValue);
      }
      if (claim.state !== 'leased') fail('FRONTIER_STALE_LEASE');
      const candidate = candidateRow(database, tenantHash, runIdValue, claim.candidate_id);
      if (input.reason === 'cancelled_before_dispatch' && candidate.attempts_admitted !== 0) {
        fail('FRONTIER_CONFLICT');
      }
      database.prepare(`UPDATE frontier_claims SET state = 'unresolved', resolution_reason = ?
        WHERE tenant_hash = ? AND run_id = ? AND claim_key = ?`)
        .run(input.reason, tenantHash, runIdValue, claim.claim_key);
      database.prepare(`UPDATE frontier_candidates SET state = 'unresolved', lease_token = NULL, lease_worker_id = NULL
        WHERE tenant_hash = ? AND run_id = ? AND candidate_id = ?`)
        .run(tenantHash, runIdValue, claim.candidate_id);
      recordStop(database, tenantHash, runIdValue, 'unresolved_work', run.last_clock_ms, true);
      return snapshotInTransaction(database, tenantHash, runIdValue);
    });
  }

  async function stopRun(scope, runIdValue, reason) {
    if (!validId(runIdValue, 96)
      || !['cancelled', 'budget_denied', 'access_restricted', 'adequate_facts', 'review_required'].includes(reason)) fail();
    return withScope(scope, (database, { tenantHash }) => {
      const run = advanceClock(database, tenantHash, getRun(database, tenantHash, runIdValue), now);
      recordStop(database, tenantHash, runIdValue, reason, run.last_clock_ms, true);
      return snapshotInTransaction(database, tenantHash, runIdValue);
    });
  }

  async function getSnapshot(scope, runIdValue) {
    if (!validId(runIdValue, 96)) fail();
    return withScope(scope, (database, { tenantHash }) => {
      const run = getRun(database, tenantHash, runIdValue);
      expireOrExhaust(database, tenantHash, run, now);
      return snapshotInTransaction(database, tenantHash, runIdValue);
    });
  }

  return Object.freeze({
    scopeForAuthenticatedRequest,
    createRun,
    claimNext,
    admitAttempt,
    completeCandidate,
    markUnresolved,
    stopRun,
    getSnapshot,
    close() { closed = true; },
  });
}
