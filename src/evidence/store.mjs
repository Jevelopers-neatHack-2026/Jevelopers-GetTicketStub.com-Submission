import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  chmod,
  lstat,
  mkdir,
} from 'node:fs/promises';
import path from 'node:path';

const SUPPORTED_SOURCE_KINDS = new Set(['external', 'customer_supplied']);
const FACT_STATUSES = new Set(['sourced', 'inferred', 'customer_supplied', 'missing', 'conflicting']);
const FACT_ORIGINS = new Set(['sourced', 'inferred', 'customer_supplied']);
const FACT_PRECISIONS = new Set(['date', 'local_datetime', 'instant', 'unknown']);
const ERROR_MESSAGES = Object.freeze({
  EVIDENCE_DENIED: 'evidence access denied',
  EVIDENCE_INVALID: 'invalid evidence record',
  EVIDENCE_NOT_FOUND: 'evidence record not found',
  EVIDENCE_EXPIRED: 'evidence payload expired',
  EVIDENCE_BUSY: 'evidence store is busy',
  EVIDENCE_INTEGRITY: 'evidence integrity check failed',
  EVIDENCE_KEY_UNAVAILABLE: 'evidence encryption key unavailable',
  EVIDENCE_STORAGE: 'evidence storage operation failed',
});
const TENANT_SCOPES = new WeakMap();
const EVIDENCE_HANDLES = new WeakMap();
const POSITION_HANDLES = new WeakMap();
const FACT_HANDLES = new WeakMap();
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, Symbol.toStringTag).get;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'length').get;
const TYPED_ARRAY_SET = Uint8Array.prototype.set;
const TENANT_QUEUES = new Map();

export class EvidenceStoreError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.EVIDENCE_STORAGE);
    this.name = 'EvidenceStoreError';
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'EVIDENCE_STORAGE';
  }
}

function fail(code) {
  throw new EvidenceStoreError(code);
}

function isRecord(value) {
  if (value === null || typeof value !== 'object') return false;
  try {
    if (Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function ownDataRecord(value, allowedKeys) {
  if (!isRecord(value)) return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))) return null;
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
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

function copyBytes(value, maximum, allowEmpty = false) {
  try {
    if (typeof value === 'string') {
      if (!isWellFormed(value)) fail('EVIDENCE_INVALID');
      const bytes = Buffer.from(value, 'utf8');
      if ((!allowEmpty && bytes.length === 0) || bytes.length > maximum) fail('EVIDENCE_INVALID');
      return bytes;
    }
    if (TYPED_ARRAY_TAG_GETTER.call(value) !== 'Uint8Array') fail('EVIDENCE_INVALID');
    const length = TYPED_ARRAY_LENGTH_GETTER.call(value);
    if (!Number.isSafeInteger(length) || (!allowEmpty && length === 0) || length > maximum) fail('EVIDENCE_INVALID');
    const bytes = new Uint8Array(length);
    TYPED_ARRAY_SET.call(bytes, value);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } catch (error) {
    if (error instanceof EvidenceStoreError) throw error;
    fail('EVIDENCE_INVALID');
  }
}

function safeArray(value, maximumLength) {
  if (!Array.isArray(value) || value.length > maximumLength) return null;
  try {
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || keys.some((key) => key !== 'length' && (!Number.isSafeInteger(Number(key)) || String(Number(key)) !== key || Number(key) < 0 || Number(key) >= value.length))) return null;
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      result.push(descriptor.value);
    }
    return result;
  } catch {
    return null;
  }
}

function cloneJsonValue(value, depth = 0, budget = { nodes: 0 }) {
  budget.nodes += 1;
  if (budget.nodes > 2000 || depth > 12) fail('EVIDENCE_INVALID');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 4000 || !isWellFormed(value)) fail('EVIDENCE_INVALID');
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('EVIDENCE_INVALID');
    return value;
  }
  if (Array.isArray(value)) {
    const items = safeArray(value, 250);
    if (!items) fail('EVIDENCE_INVALID');
    return items.map((item) => cloneJsonValue(item, depth + 1, budget));
  }
  if (isRecord(value)) {
    let keys;
    try { keys = Reflect.ownKeys(value); } catch { fail('EVIDENCE_INVALID'); }
    if (keys.length > 250 || keys.some((key) => typeof key !== 'string' || key === '__proto__' || key === 'constructor' || key === 'prototype')) fail('EVIDENCE_INVALID');
    const result = Object.create(null);
    for (const key of keys) {
      if (key.length > 120 || !isWellFormed(key)) fail('EVIDENCE_INVALID');
      let descriptor;
      try { descriptor = Object.getOwnPropertyDescriptor(value, key); } catch { fail('EVIDENCE_INVALID'); }
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('EVIDENCE_INVALID');
      result[key] = cloneJsonValue(descriptor.value, depth + 1, budget);
    }
    return result;
  }
  fail('EVIDENCE_INVALID');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validTimestamp(value) {
  return typeof value === 'string'
    && value.length <= 64
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
    && Number.isFinite(Date.parse(value));
}

function validateUrl(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || !isWellFormed(value)) fail('EVIDENCE_INVALID');
  let parsed;
  try { parsed = new URL(value); } catch { fail('EVIDENCE_INVALID'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) fail('EVIDENCE_INVALID');
  return parsed;
}

function normalizeSourceUrl(value) {
  const parsed = validateUrl(value);
  parsed.hash = '';
  return parsed.href;
}

function copyLocator(value) {
  const input = ownDataRecord(value, new Set(['kind', 'startByte', 'endByte', 'pointer']));
  if (!input || typeof input.kind !== 'string') fail('EVIDENCE_INVALID');
  if (input.kind === 'text-range') {
    if (!Number.isSafeInteger(input.startByte) || input.startByte < 0
      || !Number.isSafeInteger(input.endByte) || input.endByte <= input.startByte) fail('EVIDENCE_INVALID');
    return Object.freeze({ kind: 'text-range', startByte: input.startByte, endByte: input.endByte });
  }
  if (input.kind === 'json-pointer') {
    if (typeof input.pointer !== 'string' || input.pointer.length > 2048 || !isWellFormed(input.pointer)) fail('EVIDENCE_INVALID');
    if (input.pointer !== '' && !input.pointer.startsWith('/')) fail('EVIDENCE_INVALID');
    if (/~(?![01])/.test(input.pointer)) fail('EVIDENCE_INVALID');
    return Object.freeze({ kind: 'json-pointer', pointer: input.pointer });
  }
  fail('EVIDENCE_INVALID');
}

function resolveJsonPointer(root, pointer) {
  if (pointer === '') return root;
  const pieces = pointer.slice(1).split('/').map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  let value = root;
  for (const piece of pieces) {
    if (Array.isArray(value)) {
      if (!/^(?:0|[1-9]\d*)$/.test(piece)) fail('EVIDENCE_INVALID');
      const index = Number(piece);
      if (index >= value.length || !Object.hasOwn(value, index)) fail('EVIDENCE_INVALID');
      value = value[index];
    } else if (isRecord(value) && Object.hasOwn(value, piece)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, piece);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('EVIDENCE_INVALID');
      value = descriptor.value;
    } else {
      fail('EVIDENCE_INVALID');
    }
  }
  return value;
}

function checkSnapshot(sourceBytes, locator, snapshotBytes) {
  if (locator.kind === 'text-range') {
    if (locator.endByte > sourceBytes.byteLength) fail('EVIDENCE_INVALID');
    const selected = sourceBytes.subarray(locator.startByte, locator.endByte);
    if (!selected.equals(snapshotBytes)) fail('EVIDENCE_INVALID');
    try { new TextDecoder('utf-8', { fatal: true }).decode(selected); } catch { fail('EVIDENCE_INVALID'); }
    return;
  }
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes); } catch { fail('EVIDENCE_INVALID'); }
  let parsed;
  try { parsed = JSON.parse(text); } catch { fail('EVIDENCE_INVALID'); }
  let selected;
  try { selected = resolveJsonPointer(parsed, locator.pointer); } catch { fail('EVIDENCE_INVALID'); }
  let serialized;
  try { serialized = JSON.stringify(selected); } catch { fail('EVIDENCE_INVALID'); }
  if (typeof serialized !== 'string' || !Buffer.from(serialized, 'utf8').equals(snapshotBytes)) fail('EVIDENCE_INVALID');
}

function makeOpaque() {
  return Object.freeze(Object.create(null));
}

function safePublicError(error) {
  if (error instanceof EvidenceStoreError) return error;
  return new EvidenceStoreError('EVIDENCE_STORAGE');
}

async function withLocalTenantQueue(key, operation) {
  const previous = TENANT_QUEUES.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  TENANT_QUEUES.set(key, current);
  await previous.catch(() => {});
  try {
    return await operation();
  } finally {
    release();
    if (TENANT_QUEUES.get(key) === current) TENANT_QUEUES.delete(key);
  }
}

async function withTenantLock(directory, timeoutMs, operation) {
  return withLocalTenantQueue(directory, async () => {
    let database;
    let transactionOpen = false;
    try {
      const databasePath = path.join(directory, 'evidence.sqlite');
      let priorStats = null;
      try {
        priorStats = await lstat(databasePath);
        if (priorStats.isSymbolicLink() || !priorStats.isFile()) fail('EVIDENCE_STORAGE');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      database = new DatabaseSync(databasePath, { timeout: timeoutMs });
      const openedStats = await lstat(databasePath);
      if (openedStats.isSymbolicLink() || !openedStats.isFile()
        || (priorStats && (openedStats.dev !== priorStats.dev || openedStats.ino !== priorStats.ino))) fail('EVIDENCE_STORAGE');
      database.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = FULL;
        PRAGMA secure_delete = ON;
        PRAGMA trusted_schema = OFF;
        CREATE TABLE IF NOT EXISTS evidence_manifest (
          tenant_hash TEXT PRIMARY KEY NOT NULL,
          document TEXT NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS sealed_bundles (
          kind TEXT NOT NULL CHECK (kind IN ('evidence', 'fact')),
          id TEXT NOT NULL,
          sealed BLOB NOT NULL,
          PRIMARY KEY (kind, id)
        ) STRICT;
      `);
      await chmod(databasePath, 0o600);
      database.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
      const result = await operation(database);
      database.exec('COMMIT');
      transactionOpen = false;
      return result;
    } catch (error) {
      if (transactionOpen) {
        try { database.exec('ROLLBACK'); } catch { /* SQLite rolls back on close after process errors. */ }
      }
      if (error?.errcode === 5 || error?.errcode === 6 || error?.code === 'ERR_SQLITE_BUSY') fail('EVIDENCE_BUSY');
      throw error;
    } finally {
      database?.close();
    }
  });
}

function emptyManifest(tenantHash) {
  return { schemaVersion: 1, tenantHash, records: Object.create(null), families: Object.create(null), facts: Object.create(null) };
}

function validateManifest(value, tenantHash) {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.tenantHash !== tenantHash
    || !isRecord(value.records) || !isRecord(value.families) || !isRecord(value.facts)) fail('EVIDENCE_INTEGRITY');
  return value;
}

function encodeSealedPayload(tenantHash, id, kind, data, keyId, keyBytes) {
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
    const aad = Buffer.from(`event-intelligence:evidence:v1:${tenantHash}:${kind}:${id}`, 'utf8');
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    const envelope = {
      version: 1,
      keyId,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    return Buffer.from(JSON.stringify(envelope), 'utf8');
  } catch {
    fail('EVIDENCE_STORAGE');
  }
}

function decodeSealedEnvelope(envelopeBytes, tenantHash, id, kind) {
  let envelope;
  try { envelope = JSON.parse(envelopeBytes.toString('utf8')); } catch { fail('EVIDENCE_INTEGRITY'); }
  const safe = ownDataRecord(envelope, new Set(['version', 'keyId', 'iv', 'tag', 'ciphertext']));
  if (!safe || safe.version !== 1 || typeof safe.keyId !== 'string'
    || typeof safe.iv !== 'string' || typeof safe.tag !== 'string' || typeof safe.ciphertext !== 'string') fail('EVIDENCE_INTEGRITY');
  return safe;
}

function decryptSealedPayload(envelope, tenantHash, id, kind, keyBytes) {
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyBytes, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(`event-intelligence:evidence:v1:${tenantHash}:${kind}:${id}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    fail('EVIDENCE_INTEGRITY');
  }
}

function validateKeyResult(value, requestedKeyId) {
  const safe = ownDataRecord(value, new Set(['keyId', 'key']));
  if (!safe || typeof safe.keyId !== 'string' || safe.keyId.length < 1 || safe.keyId.length > 128
    || !/^[A-Za-z0-9._-]+$/.test(safe.keyId)) fail('EVIDENCE_KEY_UNAVAILABLE');
  if (requestedKeyId !== undefined && safe.keyId !== requestedKeyId) fail('EVIDENCE_KEY_UNAVAILABLE');
  if (typeof safe.key === 'string') fail('EVIDENCE_KEY_UNAVAILABLE');
  const key = copyBytes(safe.key, 64, false);
  if (key.length !== 32) fail('EVIDENCE_KEY_UNAVAILABLE');
  return { keyId: safe.keyId, key };
}

function validateRetentionResult(value, nowMs, maximumMs, upperBoundMs = Number.POSITIVE_INFINITY) {
  const safe = ownDataRecord(value, new Set(['expiresAtMs', 'policyId', 'policyVersion', 'accessPolicy']));
  if (!safe || !Number.isSafeInteger(safe.expiresAtMs) || safe.expiresAtMs <= nowMs || safe.expiresAtMs > 8_640_000_000_000_000
    || typeof safe.policyId !== 'string' || safe.policyId.length < 1 || safe.policyId.length > 120
    || typeof safe.policyVersion !== 'string' || safe.policyVersion.length < 1 || safe.policyVersion.length > 64
    || safe.accessPolicy !== 'tenant_private') fail('EVIDENCE_DENIED');
  const maxExpiry = nowMs + maximumMs;
  if (!Number.isSafeInteger(maxExpiry)) fail('EVIDENCE_INVALID');
  const expiresAtMs = Math.min(safe.expiresAtMs, maxExpiry, upperBoundMs);
  if (expiresAtMs <= nowMs) fail('EVIDENCE_DENIED');
  return Object.freeze({
    expiresAtMs,
    policyId: safe.policyId,
    policyVersion: safe.policyVersion,
    accessPolicy: 'tenant_private',
  });
}

function stableHmac(key, value) {
  return createHmac('sha256', key).update(value, 'utf8').digest('hex');
}

function frozenMetadata(record) {
  if (record.state === 'expired') return Object.freeze({ evidenceId: record.id, state: 'expired', positionCount: 0 });
  return Object.freeze({
    evidenceId: record.id,
    version: record.version,
    previousEvidenceId: record.previousId,
    contentHash: record.contentHash,
    duplicateGroupId: record.duplicateGroupId,
    retrievedAt: record.retrievedAt,
    createdAt: record.createdAt,
    expiresAt: new Date(record.expiresAtMs).toISOString(),
    policyId: record.policyId,
    policyVersion: record.policyVersion,
    accessPolicy: 'tenant_private',
    state: record.state,
    positionCount: record.positionIds?.length ?? 0,
  });
}

function validUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function scopeInfo(scope) {
  const info = TENANT_SCOPES.get(scope);
  if (!info) fail('EVIDENCE_DENIED');
  return info;
}

function evidenceInfo(scope, handle) {
  const info = scopeInfo(scope);
  const reference = EVIDENCE_HANDLES.get(handle);
  if (!reference || reference.tenantHash !== info.tenantHash || reference.tenantId !== info.tenantId) fail('EVIDENCE_DENIED');
  return { ...info, evidenceId: reference.evidenceId };
}

function newEvidenceHandle(info, evidenceId) {
  const handle = makeOpaque();
  EVIDENCE_HANDLES.set(handle, Object.freeze({ tenantId: info.tenantId, tenantHash: info.tenantHash, evidenceId }));
  return handle;
}

function newPositionHandle(info, evidenceId, positionId, sourceKind) {
  const handle = makeOpaque();
  POSITION_HANDLES.set(handle, Object.freeze({ tenantId: info.tenantId, tenantHash: info.tenantHash, evidenceId, positionId, sourceKind }));
  return handle;
}

function newFactHandle(info, factId) {
  const handle = makeOpaque();
  FACT_HANDLES.set(handle, Object.freeze({ tenantId: info.tenantId, tenantHash: info.tenantHash, factId }));
  return handle;
}

function validateFactField(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 160 || !/^[A-Za-z0-9_.:-]+$/.test(value)) fail('EVIDENCE_INVALID');
  return value;
}

function validateMethod(value, required) {
  if (value === undefined && !required) return null;
  const safe = ownDataRecord(value, new Set(['name', 'version']));
  if (!safe || typeof safe.name !== 'string' || safe.name.length < 1 || safe.name.length > 120
    || typeof safe.version !== 'string' || safe.version.length < 1 || safe.version.length > 64) fail('EVIDENCE_INVALID');
  return Object.freeze({ name: safe.name, version: safe.version });
}

function extractValue(input) {
  const value = ownDataRecord(input, new Set([
    'rawValue', 'normalizedValue', 'precision', 'field', 'status', 'supports', 'method', 'reason', 'candidates', 'originStatus',
  ]));
  if (!value || !Object.hasOwn(value, 'rawValue') || !Object.hasOwn(value, 'normalizedValue')) fail('EVIDENCE_INVALID');
  const rawValue = cloneJsonValue(value.rawValue);
  const normalizedValue = cloneJsonValue(value.normalizedValue);
  let precision;
  if (Object.hasOwn(value, 'precision')) {
    if (!FACT_PRECISIONS.has(value.precision)) fail('EVIDENCE_INVALID');
    precision = value.precision;
  }
  return Object.freeze({ rawValue, normalizedValue, ...(precision ? { precision } : {}) });
}

function extractSupports(value, maximum = 64) {
  const items = safeArray(value, maximum);
  if (!items) fail('EVIDENCE_INVALID');
  const result = [];
  for (const item of items) {
    const support = ownDataRecord(item, new Set(['evidence', 'position', 'contentHash']));
    if (!support || !isDigest(support.contentHash)) fail('EVIDENCE_INVALID');
    result.push(support);
  }
  return result;
}

function freezeFact(value) {
  return deepFreeze(value);
}

export function createEvidenceStore(options) {
  const config = ownDataRecord(options, new Set([
    'directory', 'resolveTenant', 'resolveKey', 'resolveRetention', 'authorizePrivateAccess', 'consumePrivatePayload',
    'now', 'maxSourceBytes', 'maxPositionBytes', 'maxPositionCount', 'maxStoredPayloadBytes', 'maxRetentionMs',
    'lockTimeoutMs',
  ]));
  if (!config || typeof config.directory !== 'string' || config.directory.length === 0
    || typeof config.resolveTenant !== 'function' || typeof config.resolveKey !== 'function'
    || typeof config.resolveRetention !== 'function') fail('EVIDENCE_INVALID');
  if (config.authorizePrivateAccess !== undefined && typeof config.authorizePrivateAccess !== 'function') fail('EVIDENCE_INVALID');
  if (config.consumePrivatePayload !== undefined && typeof config.consumePrivatePayload !== 'function') fail('EVIDENCE_INVALID');
  const limits = {
    now: config.now ?? (() => Date.now()),
    maxSourceBytes: config.maxSourceBytes ?? 5 * 1024 * 1024,
    maxPositionBytes: config.maxPositionBytes ?? 64 * 1024,
    maxPositionCount: config.maxPositionCount ?? 128,
    maxStoredPayloadBytes: config.maxStoredPayloadBytes ?? 512 * 1024,
    maxRetentionMs: config.maxRetentionMs ?? 30 * 24 * 60 * 60 * 1000,
    lockTimeoutMs: config.lockTimeoutMs ?? 5_000,
  };
  for (const [key, value] of Object.entries(limits)) {
    if (key !== 'now' && (!Number.isSafeInteger(value) || value <= 0)) fail('EVIDENCE_INVALID');
  }
  if (typeof limits.now !== 'function') fail('EVIDENCE_INVALID');

  const rootDirectory = path.resolve(config.directory);

  function currentTime() {
    let time;
    try { time = limits.now(); } catch { fail('EVIDENCE_STORAGE'); }
    if (!Number.isSafeInteger(time) || time < 0) fail('EVIDENCE_STORAGE');
    return time;
  }

  async function tenantDirectory(info) {
    try {
      await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
      const rootStats = await lstat(rootDirectory);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) fail('EVIDENCE_STORAGE');
      await chmod(rootDirectory, 0o700);
      const directory = path.join(rootDirectory, info.tenantHash);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const stats = await lstat(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) fail('EVIDENCE_STORAGE');
      await chmod(directory, 0o700);
      return directory;
    } catch (error) {
      throw safePublicError(error);
    }
  }

  async function readManifest(database, tenantHash) {
    try {
      const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash);
      if (!row) return emptyManifest(tenantHash);
      if (Buffer.byteLength(row.document, 'utf8') > 16 * 1024 * 1024) fail('EVIDENCE_INTEGRITY');
      let value;
      try { value = JSON.parse(row.document); } catch { fail('EVIDENCE_INTEGRITY'); }
      return validateManifest(value, tenantHash);
    } catch (error) {
      throw safePublicError(error);
    }
  }

  async function writeManifest(database, manifest) {
    try {
      const document = JSON.stringify(manifest);
      if (Buffer.byteLength(document, 'utf8') > 16 * 1024 * 1024) fail('EVIDENCE_STORAGE');
      database.prepare(`INSERT INTO evidence_manifest (tenant_hash, document) VALUES (?, ?)
        ON CONFLICT (tenant_hash) DO UPDATE SET document = excluded.document`).run(manifest.tenantHash, document);
    } catch (error) {
      throw safePublicError(error);
    }
  }

  async function resolveKey(info, purpose, keyId) {
    try {
      const resolved = await config.resolveKey(Object.freeze({ tenantId: info.tenantId, purpose, ...(keyId ? { keyId } : {}) }));
      return validateKeyResult(resolved, keyId);
    } catch (error) {
      if (error instanceof EvidenceStoreError) throw error;
      fail('EVIDENCE_KEY_UNAVAILABLE');
    }
  }

  async function encryptBundle(info, id, kind, data) {
    const key = await resolveKey(info, kind === 'evidence' ? 'payload' : 'fact');
    try {
      return {
        keyId: key.keyId,
        bytes: encodeSealedPayload(info.tenantHash, id, kind, data, key.keyId, key.key),
      };
    } finally {
      key.key.fill(0);
    }
  }

  async function decryptBundle(info, id, kind, database, expectedKeyId) {
    let row;
    try { row = database.prepare('SELECT sealed FROM sealed_bundles WHERE kind = ? AND id = ?').get(kind, id); } catch (error) {
      throw safePublicError(error);
    }
    if (!row) fail('EVIDENCE_INTEGRITY');
    const envelopeBytes = Buffer.from(row.sealed);
    const envelope = decodeSealedEnvelope(envelopeBytes, info.tenantHash, id, kind);
    if (expectedKeyId && envelope.keyId !== expectedKeyId) fail('EVIDENCE_INTEGRITY');
    const key = await resolveKey(info, kind === 'evidence' ? 'payload' : 'fact', envelope.keyId);
    try {
      return decryptSealedPayload(envelope, info.tenantHash, id, kind, key.key);
    } finally {
      key.key.fill(0);
    }
  }

  async function authorize(info, request, action, evidenceIds, factIds = []) {
    if (typeof config.authorizePrivateAccess !== 'function') fail('EVIDENCE_DENIED');
    let result;
    try {
      result = await config.authorizePrivateAccess(Object.freeze({
        tenantId: info.tenantId,
        request,
        action,
        evidenceIds: Object.freeze([...new Set(evidenceIds)]),
        factIds: Object.freeze([...new Set(factIds)]),
      }));
    } catch {
      fail('EVIDENCE_DENIED');
    }
    if (result !== true) fail('EVIDENCE_DENIED');
  }

  async function resolveRetention(info, kind, nowMs, sourceKind, upperBoundMs, retentionHandle) {
    let result;
    try {
      result = await config.resolveRetention(Object.freeze({
        tenantId: info.tenantId,
        kind,
        sourceKind,
        nowMs,
        ...(Number.isSafeInteger(upperBoundMs) ? { sourceExpiresAtMs: upperBoundMs } : {}),
        ...(retentionHandle !== undefined ? { retentionHandle } : {}),
      }));
    } catch {
      fail('EVIDENCE_DENIED');
    }
    return validateRetentionResult(result, nowMs, limits.maxRetentionMs, upperBoundMs);
  }

  async function expireRecords(database, manifest, nowMs) {
    let changed = false;
    for (const record of Object.values(manifest.records)) {
      if (record.state === 'available' && record.expiresAtMs <= nowMs) {
        record.state = 'expired';
        for (const key of [
          'familyId', 'version', 'previousId', 'contentHash', 'duplicateGroupId', 'retrievedAt', 'createdAt', 'createdAtMs',
          'retrievedAtMs', 'expiresAtMs', 'policyId', 'policyVersion', 'sourceKeyId', 'sourceKeyHmac',
          'encryptionKeyId', 'positionIds', 'positionHashes',
        ]) delete record[key];
        database.prepare('DELETE FROM sealed_bundles WHERE kind = ? AND id = ?').run('evidence', record.id);
        changed = true;
      }
    }
    for (const fact of Object.values(manifest.facts)) {
      if (fact.state === 'available' && fact.expiresAtMs <= nowMs) {
        fact.state = 'expired';
        for (const key of [
          'status', 'createdAt', 'createdAtMs', 'expiresAtMs', 'policyId', 'policyVersion', 'encryptionKeyId',
          'supportEvidenceIds', 'supportContentHashes',
        ]) delete fact[key];
        database.prepare('DELETE FROM sealed_bundles WHERE kind = ? AND id = ?').run('fact', fact.id);
        changed = true;
      }
    }
    for (const [familyId, family] of Object.entries(manifest.families)) {
      family.recordIds = family.recordIds.filter((id) => manifest.records[id]?.state === 'available');
      if (family.recordIds.length === 0) delete manifest.families[familyId];
      else {
        for (const id of family.recordIds) {
          const record = manifest.records[id];
          if (record.previousId && manifest.records[record.previousId]?.state === 'expired') delete record.previousId;
        }
      }
    }
    if (changed) await writeManifest(database, manifest);
    return changed;
  }

  async function commitNewBundle(database, kind, id, sealedBytes) {
    try {
      database.prepare('INSERT INTO sealed_bundles (kind, id, sealed) VALUES (?, ?, ?)').run(kind, id, sealedBytes);
    } catch (error) {
      throw safePublicError(error);
    }
  }

  async function createScope(request) {
    let tenantId;
    try { tenantId = await config.resolveTenant(request); } catch { fail('EVIDENCE_DENIED'); }
    if (typeof tenantId !== 'string' || tenantId.length < 1 || tenantId.length > 256 || !isWellFormed(tenantId)) fail('EVIDENCE_DENIED');
    const tenantHash = digest(Buffer.from(`event-intelligence:tenant:v1:${tenantId}`, 'utf8'));
    const scope = makeOpaque();
    TENANT_SCOPES.set(scope, Object.freeze({ tenantId, tenantHash }));
    return scope;
  }

  async function ingestEvidence(scope, inputValue) {
    const info = scopeInfo(scope);
    const input = ownDataRecord(inputValue, new Set([
      'sourceUrl', 'canonicalUrl', 'redirectChain', 'content', 'contentType', 'retrievedAt', 'sourceKind', 'positions', 'retentionHandle',
    ]));
    if (!input || typeof input.sourceUrl !== 'string' || !SUPPORTED_SOURCE_KINDS.has(input.sourceKind)
      || !validTimestamp(input.retrievedAt) || typeof input.contentType !== 'string'
      || input.contentType.length < 1 || input.contentType.length > 160 || !/^[\x20-\x7e]+$/.test(input.contentType)
      || !input.retentionHandle || typeof input.retentionHandle !== 'object') fail('EVIDENCE_INVALID');
    validateUrl(input.sourceUrl);
    const originalUrl = input.sourceUrl;
    const canonicalUrl = input.canonicalUrl === undefined ? normalizeSourceUrl(originalUrl) : normalizeSourceUrl(input.canonicalUrl);
    const redirectChainInput = input.redirectChain === undefined ? [] : safeArray(input.redirectChain, 20);
    if (!redirectChainInput) fail('EVIDENCE_INVALID');
    const redirectChain = redirectChainInput.map((item) => validateUrl(item).href);
    const sourceBytes = copyBytes(input.content, limits.maxSourceBytes);
    const sourceContentHash = digest(sourceBytes);
    const positionInputs = safeArray(input.positions, limits.maxPositionCount);
    if (!positionInputs) {
      sourceBytes.fill(0);
      fail('EVIDENCE_INVALID');
    }
    const positions = [];
    let positionTotal = 0;
    try {
      for (const item of positionInputs) {
        const position = ownDataRecord(item, new Set(['locator', 'content']));
        if (!position || !Object.hasOwn(position, 'locator') || !Object.hasOwn(position, 'content')) fail('EVIDENCE_INVALID');
        const locator = copyLocator(position.locator);
        const bytes = copyBytes(position.content, limits.maxPositionBytes);
        positionTotal += bytes.byteLength;
        if (positionTotal > limits.maxStoredPayloadBytes) fail('EVIDENCE_INVALID');
        checkSnapshot(sourceBytes, locator, bytes);
        positions.push({ id: randomUUID(), locator, contentHash: digest(bytes), bytes });
      }
      if (positions.length === 0) fail('EVIDENCE_INVALID');
    } catch (error) {
      sourceBytes.fill(0);
      for (const position of positions) position.bytes.fill(0);
      throw error instanceof EvidenceStoreError ? error : new EvidenceStoreError('EVIDENCE_INVALID');
    }
    let activeIndexKey;
    try {
      const sourceKind = input.sourceKind;
      const nowMs = currentTime();
      const retrievedAtMs = Date.parse(input.retrievedAt);
      const retention = await resolveRetention(info, 'evidence', nowMs, sourceKind, undefined, input.retentionHandle);
      activeIndexKey = await resolveKey(info, 'source-index');
      const sourceIdentity = `${sourceKind}\u0000${normalizeSourceUrl(canonicalUrl)}`;
      const directory = await tenantDirectory(info);
      return await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        const matchingFamily = Object.values(manifest.families).find((family) =>
          family.sourceKeyId === activeIndexKey.keyId
            ? family.sourceKeyHmac === stableHmac(activeIndexKey.key, sourceIdentity)
            : false);
        let family = matchingFamily;
        if (!family) {
          for (const candidate of Object.values(manifest.families)) {
            if (candidate.sourceKeyId === activeIndexKey.keyId) continue;
            const oldIndexKey = await resolveKey(info, 'source-index', candidate.sourceKeyId);
            try {
              if (candidate.sourceKeyHmac === stableHmac(oldIndexKey.key, sourceIdentity)) {
                family = candidate;
                break;
              }
            } finally {
              oldIndexKey.key.fill(0);
            }
          }
        }
        const priorIds = family ? [...family.recordIds] : [];
        const latestId = priorIds.at(-1);
        const latest = latestId ? manifest.records[latestId] : null;
        if (latest?.state === 'available' && latest.contentHash === sourceContentHash) {
          const existing = await decryptBundle(info, latest.id, 'evidence', database, latest.encryptionKeyId);
          const evidence = newEvidenceHandle(info, latest.id);
          const positionHandles = existing.positions.map((position) => newPositionHandle(info, latest.id, position.id, sourceKind));
          sourceBytes.fill(0);
          for (const position of positions) position.bytes.fill(0);
          return Object.freeze({ evidence, positions: Object.freeze(positionHandles), created: false, metadata: frozenMetadata(latest) });
        }
        const familyId = family?.id ?? randomUUID();
        const evidenceId = randomUUID();
        const version = family ? (family.versionCount ?? priorIds.length) + 1 : 1;
        const positionIds = positions.map((position) => position.id);
        const positionHashes = Object.fromEntries(positions.map((position) => [position.id, position.contentHash]));
        const bundle = {
          schemaVersion: 1,
          source: {
            sourceUrl: originalUrl,
            canonicalUrl,
            redirectChain,
            contentType: input.contentType,
            sourceKind,
            retrievedAt: input.retrievedAt,
            retrievedAtMs,
            contentHash: sourceContentHash,
          },
          positions: positions.map((position) => ({
            id: position.id,
            locator: position.locator,
            contentHash: position.contentHash,
            content: position.bytes.toString('base64'),
          })),
        };
        const sealed = await encryptBundle(info, evidenceId, 'evidence', bundle);
        const nowIso = new Date(nowMs).toISOString();
        const duplicateGroupId = digest(Buffer.from(`event-intelligence:duplicate:v1:${info.tenantHash}:${sourceContentHash}`, 'utf8'));
        const record = {
          id: evidenceId,
          version,
          previousId: latest?.id ?? null,
          contentHash: sourceContentHash,
          duplicateGroupId,
          retrievedAt: input.retrievedAt,
          createdAt: nowIso,
          createdAtMs: nowMs,
          retrievedAtMs,
          expiresAtMs: retention.expiresAtMs,
          policyId: retention.policyId,
          policyVersion: retention.policyVersion,
          state: 'available',
          encryptionKeyId: sealed.keyId,
          positionIds,
          positionHashes,
        };
        await commitNewBundle(database, 'evidence', evidenceId, sealed.bytes);
        manifest.records[evidenceId] = record;
        if (!family) {
          family = {
            id: familyId,
            sourceKeyId: activeIndexKey.keyId,
            sourceKeyHmac: stableHmac(activeIndexKey.key, sourceIdentity),
            versionCount: 0,
            recordIds: [],
          };
          manifest.families[familyId] = family;
        }
        family.recordIds.push(evidenceId);
        family.versionCount = version;
        await writeManifest(database, manifest);
        const evidence = newEvidenceHandle(info, evidenceId);
        const positionHandles = positions.map((position) => newPositionHandle(info, evidenceId, position.id, sourceKind));
        return Object.freeze({ evidence, positions: Object.freeze(positionHandles), created: true, metadata: frozenMetadata(record) });
      });
    } catch (error) {
      throw safePublicError(error);
    } finally {
      sourceBytes.fill(0);
      for (const position of positions) position.bytes.fill(0);
      activeIndexKey?.key.fill(0);
    }
  }

  async function lookupEvidence(scope, evidenceId) {
    const info = scopeInfo(scope);
    if (!validUuid(evidenceId)) fail('EVIDENCE_NOT_FOUND');
    const directory = await tenantDirectory(info);
    try {
      return await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        if (!manifest.records[evidenceId]) fail('EVIDENCE_NOT_FOUND');
        return newEvidenceHandle(info, evidenceId);
      });
    } catch (error) {
      throw safePublicError(error);
    }
  }

  async function getEvidenceMetadata(scope, handle) {
    const info = evidenceInfo(scope, handle);
    const directory = await tenantDirectory(info);
    try {
      return await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        const record = manifest.records[info.evidenceId];
        if (!record) fail('EVIDENCE_NOT_FOUND');
        return frozenMetadata(record);
      });
    } catch (error) {
      throw safePublicError(error);
    }
  }

  async function listEvidencePositions(scope, handle, request) {
    const info = evidenceInfo(scope, handle);
    await authorize(info, request, 'list_evidence_positions', [info.evidenceId]);
    const directory = await tenantDirectory(info);
    try {
      return await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        const record = manifest.records[info.evidenceId];
        if (!record) fail('EVIDENCE_NOT_FOUND');
        if (record.state !== 'available') fail('EVIDENCE_EXPIRED');
        const bundle = await decryptBundle(info, record.id, 'evidence', database, record.encryptionKeyId);
        return Object.freeze(bundle.positions.map((position) => Object.freeze({
          handle: newPositionHandle(info, record.id, position.id, bundle.source.sourceKind),
          locator: deepFreeze(cloneJsonValue(position.locator)),
          contentHash: position.contentHash,
        })));
      });
    } catch (error) {
      throw safePublicError(error);
    }
  }

  async function withPrivatePayload(scope, handle, request) {
    const info = evidenceInfo(scope, handle);
    if (typeof config.consumePrivatePayload !== 'function') fail('EVIDENCE_DENIED');
    await authorize(info, request, 'read_private_evidence', [info.evidenceId]);
    const directory = await tenantDirectory(info);
    let privateBundle;
    try {
      privateBundle = await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        const record = manifest.records[info.evidenceId];
        if (!record) fail('EVIDENCE_NOT_FOUND');
        if (record.state !== 'available') fail('EVIDENCE_EXPIRED');
        const bundle = await decryptBundle(info, record.id, 'evidence', database, record.encryptionKeyId);
        const publicMeta = frozenMetadata(record);
        return { bundle, publicMeta, expiresAtMs: record.expiresAtMs };
      });
    } catch (error) {
      throw safePublicError(error);
    }
    if (currentTime() >= privateBundle.expiresAtMs) {
      await purgeExpired(scope);
      fail('EVIDENCE_EXPIRED');
    }
    const positions = privateBundle.bundle.positions.map((position) => Object.freeze({
      locator: deepFreeze(cloneJsonValue(position.locator)),
      contentHash: position.contentHash,
      content: Buffer.from(position.content, 'base64'),
    }));
    try {
      return await config.consumePrivatePayload(Object.freeze({
        tenantId: info.tenantId,
        evidenceId: info.evidenceId,
        metadata: privateBundle.publicMeta,
        source: deepFreeze(cloneJsonValue(privateBundle.bundle.source)),
        positions: Object.freeze(positions),
        request,
      }));
    } catch {
      fail('EVIDENCE_DENIED');
    } finally {
      for (const position of positions) position.content.fill(0);
    }
  }

  async function parseFactInput(inputValue) {
    const allowed = new Set(['field', 'status', 'rawValue', 'normalizedValue', 'precision', 'supports', 'method', 'reason', 'candidates']);
    const input = ownDataRecord(inputValue, allowed);
    if (!input || typeof input.field !== 'string' || !FACT_STATUSES.has(input.status)) fail('EVIDENCE_INVALID');
    const field = validateFactField(input.field);
    if (input.status === 'missing') {
      if (['rawValue', 'normalizedValue', 'precision', 'supports', 'method', 'candidates'].some((key) => Object.hasOwn(input, key))) fail('EVIDENCE_INVALID');
      if (input.reason !== undefined && (typeof input.reason !== 'string' || input.reason.length > 120 || !/^[A-Za-z0-9_.:-]+$/.test(input.reason))) fail('EVIDENCE_INVALID');
      return { field, status: 'missing', reason: input.reason ?? 'not_observed' };
    }
    if (input.status === 'conflicting') {
      if (['rawValue', 'normalizedValue', 'precision', 'supports', 'method', 'reason'].some((key) => Object.hasOwn(input, key))) fail('EVIDENCE_INVALID');
      const candidates = safeArray(input.candidates, 32);
      if (!candidates || candidates.length < 2) fail('EVIDENCE_INVALID');
      const parsedCandidates = candidates.map((candidate) => {
        const item = ownDataRecord(candidate, new Set(['originStatus', 'rawValue', 'normalizedValue', 'precision', 'supports', 'method']));
        if (!item || !FACT_ORIGINS.has(item.originStatus)) fail('EVIDENCE_INVALID');
        const value = extractValue(item);
        const method = validateMethod(item.method, item.originStatus === 'inferred');
        const supports = extractSupports(item.supports);
        if (supports.length === 0) fail('EVIDENCE_INVALID');
        return { originStatus: item.originStatus, ...value, method, supports };
      });
      return { field, status: 'conflicting', candidates: parsedCandidates };
    }
    if (Object.hasOwn(input, 'reason') || Object.hasOwn(input, 'candidates')) fail('EVIDENCE_INVALID');
    const value = extractValue(input);
    const method = validateMethod(input.method, input.status === 'inferred');
    const supports = extractSupports(input.supports);
    if (supports.length === 0) fail('EVIDENCE_INVALID');
    return { field, status: input.status, ...value, method, supports };
  }

  async function appendFact(scope, inputValue, request) {
    const info = scopeInfo(scope);
    const parsed = await parseFactInput(inputValue);
    const allSupports = parsed.status === 'conflicting'
      ? parsed.candidates.flatMap((candidate) => candidate.supports)
      : parsed.supports ?? [];
    const supportRefs = allSupports.map((support) => {
      const evidence = EVIDENCE_HANDLES.get(support.evidence);
      const position = POSITION_HANDLES.get(support.position);
      if (!evidence || !position || evidence.tenantHash !== info.tenantHash || position.tenantHash !== info.tenantHash
        || evidence.evidenceId !== position.evidenceId || !isDigest(support.contentHash)) fail('EVIDENCE_INVALID');
      return { support, evidenceId: evidence.evidenceId, positionId: position.positionId, sourceKind: position.sourceKind };
    });
    const evidenceIds = supportRefs.map((reference) => reference.evidenceId);
    await authorize(info, request, 'validate_fact_support', evidenceIds);
    const directory = await tenantDirectory(info);
    try {
      return await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        const nowMs = currentTime();
        await expireRecords(database, manifest, nowMs);
        for (const reference of supportRefs) {
          const record = manifest.records[reference.evidenceId];
          if (!record) fail('EVIDENCE_INVALID');
          if (record.state !== 'available' || record.expiresAtMs <= nowMs) fail('EVIDENCE_EXPIRED');
          if (reference.support.contentHash !== record.contentHash) fail('EVIDENCE_INVALID');
          if (!record.positionIds.includes(reference.positionId)) fail('EVIDENCE_INVALID');
          const bundle = await decryptBundle(info, record.id, 'evidence', database, record.encryptionKeyId);
          const position = bundle.positions.find((candidate) => candidate.id === reference.positionId);
          if (!position || !record.positionHashes[reference.positionId]
            || position.contentHash !== record.positionHashes[reference.positionId]
            || digest(Buffer.from(position.content, 'base64')) !== position.contentHash) fail('EVIDENCE_INTEGRITY');
          if (bundle.source.sourceKind !== reference.sourceKind) fail('EVIDENCE_INTEGRITY');
          const receivedLocator = POSITION_HANDLES.get(reference.support.position);
          if (!receivedLocator || receivedLocator.positionId !== position.id) fail('EVIDENCE_INVALID');
          if (reference.sourceKind === 'customer_supplied'
            && parsed.status !== 'customer_supplied' && parsed.status !== 'conflicting') fail('EVIDENCE_INVALID');
          reference.duplicateGroupId = record.duplicateGroupId;
        }
        if (parsed.status === 'customer_supplied' && !supportRefs.some((reference) => reference.sourceKind === 'customer_supplied')) fail('EVIDENCE_INVALID');
        if (parsed.status === 'conflicting') {
          for (const candidate of parsed.candidates) {
            const candidateRefs = candidate.supports.map((support) => supportRefs.find((reference) => reference.support === support)).filter(Boolean);
            if (candidateRefs.length !== candidate.supports.length) fail('EVIDENCE_INVALID');
            if (candidate.originStatus === 'customer_supplied' && !candidateRefs.some((reference) => reference.sourceKind === 'customer_supplied')) fail('EVIDENCE_INVALID');
            if (candidate.originStatus !== 'customer_supplied' && candidateRefs.some((reference) => reference.sourceKind === 'customer_supplied')) fail('EVIDENCE_INVALID');
          }
        }
        const supportingRecords = [...new Set(evidenceIds)].map((id) => manifest.records[id]);
        const supportExpiry = supportingRecords.length ? Math.min(...supportingRecords.map((record) => record.expiresAtMs)) : undefined;
        const factRetention = await resolveRetention(info, 'fact', nowMs, parsed.status, supportExpiry);
        const factId = randomUUID();
        const normalized = serializeFactForStorage(parsed, supportRefs);
        const sealed = await encryptBundle(info, factId, 'fact', normalized);
        const factMetadata = {
          id: factId,
          status: parsed.status,
          state: 'available',
          createdAt: new Date(nowMs).toISOString(),
          createdAtMs: nowMs,
          expiresAtMs: factRetention.expiresAtMs,
          policyId: factRetention.policyId,
          policyVersion: factRetention.policyVersion,
          encryptionKeyId: sealed.keyId,
          supportEvidenceIds: [...new Set(evidenceIds)],
          supportContentHashes: [...new Set(supportRefs.map((reference) => reference.support.contentHash))],
        };
        await commitNewBundle(database, 'fact', factId, sealed.bytes);
        manifest.facts[factId] = factMetadata;
        await writeManifest(database, manifest);
        return newFactHandle(info, factId);
      });
    } catch (error) {
      throw safePublicError(error);
    }
  }

  function serializeFactForStorage(parsed, supportRefs) {
    const refs = supportRefs.map((reference) => ({
      evidenceId: reference.evidenceId,
      positionId: reference.positionId,
      contentHash: reference.support.contentHash,
      sourceKind: reference.sourceKind,
      duplicateGroupId: reference.duplicateGroupId,
    }));
    if (parsed.status === 'missing') return { field: parsed.field, status: parsed.status, reason: parsed.reason, supports: [] };
    if (parsed.status === 'conflicting') {
      let offset = 0;
      const candidates = parsed.candidates.map((candidate) => {
        const supports = candidate.supports.map(() => refs[offset++]);
        return { ...candidate, supports };
      });
      return { field: parsed.field, status: parsed.status, candidates };
    }
    return { ...parsed, supports: refs };
  }

  function publicFact(info, factId, stored) {
    const reviveSupport = (support) => Object.freeze({
      evidence: newEvidenceHandle(info, support.evidenceId),
      position: newPositionHandle(info, support.evidenceId, support.positionId, support.sourceKind),
      contentHash: support.contentHash,
      duplicateGroupId: support.duplicateGroupId,
      independence: 'unknown',
    });
    if (stored.status === 'missing') return freezeFact({ factId, field: stored.field, status: 'missing', reason: stored.reason, supports: Object.freeze([]) });
    if (stored.status === 'conflicting') {
      return freezeFact({
        factId,
        field: stored.field,
        status: 'conflicting',
        candidates: stored.candidates.map((candidate) => ({
          originStatus: candidate.originStatus,
          rawValue: candidate.rawValue,
          normalizedValue: candidate.normalizedValue,
          ...(candidate.precision ? { precision: candidate.precision } : {}),
          ...(candidate.method ? { method: candidate.method } : {}),
          supports: candidate.supports.map(reviveSupport),
        })),
      });
    }
    return freezeFact({
      factId,
      field: stored.field,
      status: stored.status,
      rawValue: stored.rawValue,
      normalizedValue: stored.normalizedValue,
      ...(stored.precision ? { precision: stored.precision } : {}),
      ...(stored.method ? { method: stored.method } : {}),
      supports: stored.supports.map(reviveSupport),
    });
  }

  async function lookupFact(scope, factId) {
    const info = scopeInfo(scope);
    if (!validUuid(factId)) fail('EVIDENCE_NOT_FOUND');
    const directory = await tenantDirectory(info);
    try {
      return await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        if (!manifest.facts[factId]) fail('EVIDENCE_NOT_FOUND');
        return newFactHandle(info, factId);
      });
    } catch (error) {
      throw safePublicError(error);
    }
  }

  async function readFact(scope, handle, request) {
    const info = scopeInfo(scope);
    const reference = FACT_HANDLES.get(handle);
    if (!reference || reference.tenantHash !== info.tenantHash || reference.tenantId !== info.tenantId) fail('EVIDENCE_DENIED');
    const directory = await tenantDirectory(info);
    let factMetadata;
    try {
      factMetadata = await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        const fact = manifest.facts[reference.factId];
        if (!fact) fail('EVIDENCE_NOT_FOUND');
        if (fact.state !== 'available') fail('EVIDENCE_EXPIRED');
        return fact;
      });
    } catch (error) {
      throw safePublicError(error);
    }
    await authorize(info, request, 'read_fact', factMetadata.supportEvidenceIds, [reference.factId]);
    try {
      return await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        const current = manifest.facts[reference.factId];
        if (!current || current.state !== 'available') fail('EVIDENCE_EXPIRED');
        const stored = await decryptBundle(info, current.id, 'fact', database, current.encryptionKeyId);
        return publicFact(info, current.id, stored);
      });
    } catch (error) {
      throw safePublicError(error);
    }
  }

  async function listFacts(scope, request) {
    const info = scopeInfo(scope);
    const directory = await tenantDirectory(info);
    let factIds;
    let evidenceIds;
    try {
      ({ factIds, evidenceIds } = await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        const active = Object.values(manifest.facts).filter((fact) => fact.state === 'available');
        if (active.length > 1000) fail('EVIDENCE_INVALID');
        return {
          factIds: active.map((fact) => fact.id),
          evidenceIds: active.flatMap((fact) => fact.supportEvidenceIds),
        };
      }));
    } catch (error) {
      throw safePublicError(error);
    }
    await authorize(info, request, 'list_facts', evidenceIds, factIds);
    try {
      return await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        const result = [];
        for (const factId of factIds) {
          const fact = manifest.facts[factId];
          if (fact?.state !== 'available') continue;
          result.push(publicFact(info, factId, await decryptBundle(info, factId, 'fact', database, fact.encryptionKeyId)));
        }
        return Object.freeze(result);
      });
    } catch (error) {
      throw safePublicError(error);
    }
  }

  async function purgeExpired(scope) {
    const info = scopeInfo(scope);
    const directory = await tenantDirectory(info);
    try {
      return await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        const beforeEvidence = Object.values(manifest.records).filter((record) => record.state === 'available' && record.expiresAtMs <= currentTime()).length;
        const beforeFacts = Object.values(manifest.facts).filter((fact) => fact.state === 'available' && fact.expiresAtMs <= currentTime()).length;
        await expireRecords(database, manifest, currentTime());
        return beforeEvidence + beforeFacts;
      });
    } catch (error) {
      throw safePublicError(error);
    }
  }

  async function integritySnapshot(scope) {
    const info = scopeInfo(scope);
    const directory = await tenantDirectory(info);
    try {
      return await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        const row = database.prepare('SELECT COUNT(*) AS count FROM sealed_bundles').get();
        return Object.freeze({
          availableEvidence: Object.values(manifest.records).filter((record) => record.state === 'available').length,
          expiredEvidence: Object.values(manifest.records).filter((record) => record.state === 'expired').length,
          availableFacts: Object.values(manifest.facts).filter((fact) => fact.state === 'available').length,
          expiredFacts: Object.values(manifest.facts).filter((fact) => fact.state === 'expired').length,
          encryptedPayloadRecords: row.count,
        });
      });
    } catch (error) {
      throw safePublicError(error);
    }
  }

  return Object.freeze({
    scopeForAuthenticatedRequest: createScope,
    ingestEvidence,
    lookupEvidence,
    getEvidenceMetadata,
    listEvidencePositions,
    withPrivatePayload,
    appendFact,
    lookupFact,
    readFact,
    listFacts,
    purgeExpired,
    integritySnapshot,
  });
}
