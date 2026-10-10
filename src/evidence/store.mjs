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
import { lstatSync } from 'node:fs';
import path from 'node:path';
import { types as utilTypes } from 'node:util';
import { readTextPdf, PDF_TEXT_READER_LIMITS } from '../extraction/pdf/index.mjs';
import { PDF_DECODER_VERSION, PDF_READER_CONFIG_VERSION } from '../extraction/pdf/constants.mjs';

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
  EVIDENCE_CANCELLED: 'evidence materialization cancelled',
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
const NATIVE_PROMISE_THEN = Promise.prototype.then;
const ABORT_SIGNAL_ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const TENANT_QUEUES = new Map();
const SELECTED_BATCH_LIMITS = Object.freeze({
  evidenceCount: 8,
  factCount: 128,
  positionCount: 128,
  sealedBytes: 8 * 1024 * 1024,
  evidenceSealedBytes: 4 * 1024 * 1024,
  factSealedBytes: 512 * 1024,
  decryptedBytes: 8 * 1024 * 1024,
  evidenceDecryptedBytes: 4 * 1024 * 1024,
  factBytes: 2 * 1024 * 1024,
  factRecordBytes: 256 * 1024,
  positionBytes: 1024 * 1024,
  evidencePositionBytes: 512 * 1024,
  positionRecordBytes: 64 * 1024,
  provenanceBytes: 512 * 1024,
  factMetadataBytes: 512 * 1024,
  supportReferences: 4_096,
});
const PDF_DERIVED_REPRESENTATION = 'pdf-derived-text';
const PDF_DERIVED_BUNDLE_VERSION = 2;
const PDF_DERIVATION_BINDING_VERSION = 1;
const PDF_DERIVED_DEFAULT_TIMEOUT_MS = 15_000;
const PDF_DERIVED_CONTENT_TYPE = 'application/pdf';
const PDF_DERIVED_MAX_SOURCE_BYTES = 5 * 1024 * 1024;

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

function cloneJsonValue(value, depth = 0, budget = { nodes: 0, bytes: 0, maximumBytes: Number.POSITIVE_INFINITY }) {
  budget.nodes += 1;
  if (budget.nodes > 2000 || depth > 12) fail('EVIDENCE_INVALID');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length > 4000 || !isWellFormed(value)) fail('EVIDENCE_INVALID');
    budget.bytes += Buffer.byteLength(value, 'utf8');
    if (!Number.isSafeInteger(budget.bytes) || budget.bytes > budget.maximumBytes) fail('EVIDENCE_INVALID');
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
      budget.bytes += Buffer.byteLength(key, 'utf8');
      if (!Number.isSafeInteger(budget.bytes) || budget.bytes > budget.maximumBytes) fail('EVIDENCE_INVALID');
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

function wipePrivateTree(value) {
  if (Array.isArray(value)) {
    for (const item of value) wipePrivateTree(item);
    for (let index = 0; index < value.length; index += 1) value[index] = null;
    return;
  }
  if (!isRecord(value)) return;
  for (const key of Object.keys(value)) {
    wipePrivateTree(value[key]);
    value[key] = null;
  }
}

function copySynchronousConsumerResult(value) {
  if (value === undefined) return value;
  const copied = cloneJsonValue(value);
  // Preserve normal array iteration and methods while preventing Promise
  // resolution from reading an inherited Array.prototype.then after the final
  // authorization gate. JSON arrays cannot carry own properties, so this inert
  // non-enumerable property is part of the trusted copy only.
  if (Array.isArray(copied)) {
    Object.defineProperty(copied, 'then', {
      value: undefined,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }
  return deepFreeze(copied);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function validTimestamp(value) {
  if (typeof value !== 'string' || value.length > 64) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/i.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = secondText === undefined ? 0 : Number(secondText);
  if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (day < 1 || day > daysInMonth[month - 1]) return false;
  if (zone.toUpperCase() !== 'Z'
    && (Number(offsetHourText) > 23 || Number(offsetMinuteText) > 59)) return false;
  return Number.isFinite(Date.parse(value));
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

function copyStoredLocator(value, representation) {
  if (representation === PDF_DERIVED_REPRESENTATION) {
    const input = ownDataRecord(value, new Set([
      'kind', 'pageIndex', 'textIndex', 'x', 'y', 'width', 'height', 'pageWidth', 'pageHeight',
      'rotation', 'coordinateSystem', 'geometry',
    ]));
    if (!input || input.kind !== 'pdf-text-box'
      || !Number.isSafeInteger(input.pageIndex) || input.pageIndex < 0
      || !Number.isSafeInteger(input.textIndex) || input.textIndex < 0
      || ![input.x, input.y, input.width, input.height, input.pageWidth, input.pageHeight].every(Number.isFinite)
      || input.x < 0 || input.y < 0 || input.width < 0 || input.height < 0
      || input.pageWidth <= 0 || input.pageHeight <= 0
      || ![0, 90, 180, 270].includes(input.rotation)
      || input.coordinateSystem !== 'viewport-points-top-left'
      || input.geometry !== 'approximate-text-item') fail('EVIDENCE_INTEGRITY');
    return Object.freeze({
      kind: 'pdf-text-box', pageIndex: input.pageIndex, textIndex: input.textIndex,
      x: input.x, y: input.y, width: input.width, height: input.height,
      pageWidth: input.pageWidth, pageHeight: input.pageHeight, rotation: input.rotation,
      coordinateSystem: input.coordinateSystem, geometry: input.geometry,
    });
  }
  return copyLocator(value);
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

function newMaterializationBudget() {
  return {
    sealedBytes: 0,
    decryptedBytes: 0,
    factBytes: 0,
    positionBytes: 0,
    provenanceBytes: 0,
    factMetadataBytes: 0,
    supportReferences: 0,
  };
}

function chargeBudget(budget, field, amount, maximum) {
  if (!Number.isSafeInteger(amount) || amount < 0
    || !Number.isSafeInteger(budget[field] + amount) || budget[field] + amount > maximum) fail('EVIDENCE_INVALID');
  budget[field] += amount;
}

function addProvenanceBytes(budget, amount) {
  chargeBudget(budget, 'provenanceBytes', amount, SELECTED_BATCH_LIMITS.provenanceBytes);
}

function base64DecodedByteLength(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail('EVIDENCE_INTEGRITY');
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const result = (value.length / 4) * 3 - padding;
  if (!Number.isSafeInteger(result) || result <= 0) fail('EVIDENCE_INTEGRITY');
  return result;
}

function observeNativeRejectedPromise(value) {
  if (!utilTypes.isPromise(value)) return;
  try {
    // Observe only a genuine native Promise. Do not assimilate arbitrary thenables.
    Reflect.apply(NATIVE_PROMISE_THEN, value, [undefined, () => {}]);
  } catch {
    // The final authorization hook still fails closed if observation is unavailable.
  }
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
  if (!isRecord(value) || ![1, 2].includes(value.schemaVersion) || value.tenantHash !== tenantHash
    || !isRecord(value.records) || !isRecord(value.families) || !isRecord(value.facts)) fail('EVIDENCE_INTEGRITY');
  for (const record of Object.values(value.records)) {
    if (!isRecord(record)) continue;
    if (value.schemaVersion === 1 && Object.hasOwn(record, 'representation')) fail('EVIDENCE_INTEGRITY');
    if (record.representation !== undefined
      && (value.schemaVersion !== 2 || record.representation !== PDF_DERIVED_REPRESENTATION
        || !isDigest(record.derivationDigest))) fail('EVIDENCE_INTEGRITY');
    if (record.representation === undefined && Object.hasOwn(record, 'derivationDigest')) fail('EVIDENCE_INTEGRITY');
  }
  for (const family of Object.values(value.families)) {
    if (isRecord(family) && family.representation !== undefined
      && family.representation !== PDF_DERIVED_REPRESENTATION) fail('EVIDENCE_INTEGRITY');
  }
  return value;
}

function encodeSealedPayload(tenantHash, id, kind, serialized, keyId, keyBytes) {
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
    const aad = Buffer.from(`event-intelligence:evidence:v1:${tenantHash}:${kind}:${id}`, 'utf8');
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([cipher.update(serialized, 'utf8'), cipher.final()]);
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
    || safe.keyId.length < 1 || safe.keyId.length > 128 || !/^[A-Za-z0-9._-]+$/.test(safe.keyId)
    || typeof safe.iv !== 'string' || safe.iv.length !== 16 || !/^[A-Za-z0-9+/]{16}$/.test(safe.iv)
    || typeof safe.tag !== 'string' || safe.tag.length !== 24 || !/^[A-Za-z0-9+/]{22}==$/.test(safe.tag)
    || typeof safe.ciphertext !== 'string') fail('EVIDENCE_INTEGRITY');
  base64DecodedByteLength(safe.ciphertext);
  return safe;
}

function decryptSealedPayload(envelope, tenantHash, id, kind, keyBytes, expectedPlaintextBytes) {
  let ciphertext;
  let plaintext;
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyBytes, Buffer.from(envelope.iv, 'base64'));
    decipher.setAAD(Buffer.from(`event-intelligence:evidence:v1:${tenantHash}:${kind}:${id}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    ciphertext = Buffer.from(envelope.ciphertext, 'base64');
    if (expectedPlaintextBytes !== undefined && ciphertext.byteLength !== expectedPlaintextBytes) fail('EVIDENCE_INTEGRITY');
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (expectedPlaintextBytes !== undefined && plaintext.byteLength !== expectedPlaintextBytes) fail('EVIDENCE_INTEGRITY');
    return JSON.parse(plaintext.toString('utf8'));
  } catch {
    fail('EVIDENCE_INTEGRITY');
  } finally {
    ciphertext?.fill(0);
    plaintext?.fill(0);
  }
}

function readSealedBundle(database, kind, id) {
  try {
    const maximum = kind === 'evidence'
      ? SELECTED_BATCH_LIMITS.evidenceSealedBytes
      : SELECTED_BATCH_LIMITS.factSealedBytes;
    const length = database.prepare('SELECT length(sealed) AS bytes FROM sealed_bundles WHERE kind = ? AND id = ?').get(kind, id);
    if (!length) fail('EVIDENCE_INTEGRITY');
    if (!Number.isSafeInteger(length.bytes) || length.bytes <= 0) fail('EVIDENCE_INTEGRITY');
    if (length.bytes > maximum) fail('EVIDENCE_INVALID');
    const row = database.prepare('SELECT sealed FROM sealed_bundles WHERE kind = ? AND id = ?').get(kind, id);
    if (!row || row.sealed.byteLength !== length.bytes) fail('EVIDENCE_INTEGRITY');
    return Buffer.from(row.sealed);
  } catch (error) {
    throw safePublicError(error);
  }
}

function preflightSelectedSealedBundleLengths(database, kind, ids, budget) {
  const maximum = kind === 'evidence'
    ? SELECTED_BATCH_LIMITS.evidenceSealedBytes
    : SELECTED_BATCH_LIMITS.factSealedBytes;
  const lengths = new Map();
  for (let start = 0; start < ids.length; start += 500) {
    const chunk = ids.slice(start, start + 500);
    const placeholders = chunk.map(() => '?').join(',');
    let rows;
    try {
      rows = database.prepare(`SELECT id, length(sealed) AS bytes FROM sealed_bundles WHERE kind = ? AND id IN (${placeholders})`)
        .all(kind, ...chunk);
    } catch (error) {
      throw safePublicError(error);
    }
    for (const row of rows) {
      if (!chunk.includes(row.id) || lengths.has(row.id)) fail('EVIDENCE_INTEGRITY');
      if (!Number.isSafeInteger(row.bytes) || row.bytes <= 0) fail('EVIDENCE_INTEGRITY');
      if (row.bytes > maximum) fail('EVIDENCE_INVALID');
      chargeBudget(budget, 'sealedBytes', row.bytes, SELECTED_BATCH_LIMITS.sealedBytes);
      lengths.set(row.id, row.bytes);
    }
  }
  if (lengths.size !== ids.length) fail('EVIDENCE_INTEGRITY');
  return lengths;
}

function copySelectedSealedBundles(database, kind, records, lengths) {
  for (const record of records) {
    try {
      const row = database.prepare('SELECT sealed FROM sealed_bundles WHERE kind = ? AND id = ?').get(kind, record.id);
      if (!row || row.sealed.byteLength !== lengths.get(record.id)) fail('EVIDENCE_INTEGRITY');
      record.sealed = Buffer.from(row.sealed);
    } catch (error) {
      throw safePublicError(error);
    }
  }
}

async function decryptSealedBundle(info, id, kind, sealedBytes, expectedKeyId, resolveKey, budget) {
  if (sealedBytes.byteLength > (kind === 'evidence'
    ? SELECTED_BATCH_LIMITS.evidenceSealedBytes
    : SELECTED_BATCH_LIMITS.factSealedBytes)) fail('EVIDENCE_INVALID');
  const envelope = decodeSealedEnvelope(sealedBytes, info.tenantHash, id, kind);
  if (expectedKeyId && envelope.keyId !== expectedKeyId) fail('EVIDENCE_INTEGRITY');
  const plaintextBytes = base64DecodedByteLength(envelope.ciphertext);
  if (kind === 'evidence') {
    if (plaintextBytes > SELECTED_BATCH_LIMITS.evidenceDecryptedBytes) fail('EVIDENCE_INVALID');
  } else {
    if (plaintextBytes > SELECTED_BATCH_LIMITS.factRecordBytes) fail('EVIDENCE_INVALID');
    chargeBudget(budget, 'factBytes', plaintextBytes, SELECTED_BATCH_LIMITS.factBytes);
  }
  chargeBudget(budget, 'decryptedBytes', plaintextBytes, SELECTED_BATCH_LIMITS.decryptedBytes);
  const key = await resolveKey(info, kind === 'evidence' ? 'payload' : 'fact', envelope.keyId);
  try {
    return decryptSealedPayload(envelope, info.tenantHash, id, kind, key.key, plaintextBytes);
  } finally {
    key.key.fill(0);
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
    previousEvidenceId: record.previousId ?? null,
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
    ...(record.representation === PDF_DERIVED_REPRESENTATION ? {
      representation: PDF_DERIVED_REPRESENTATION,
      derivationDigest: record.derivationDigest,
    } : {}),
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

function newPositionHandle(info, evidenceId, positionId, sourceKind, representation = 'raw') {
  const handle = makeOpaque();
  POSITION_HANDLES.set(handle, Object.freeze({ tenantId: info.tenantId, tenantHash: info.tenantHash, evidenceId, positionId, sourceKind, representation }));
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

function extractValue(input, cloneBudget) {
  const value = ownDataRecord(input, new Set([
    'rawValue', 'normalizedValue', 'precision', 'field', 'status', 'supports', 'method', 'reason', 'candidates', 'originStatus',
  ]));
  if (!value || !Object.hasOwn(value, 'rawValue') || !Object.hasOwn(value, 'normalizedValue')) fail('EVIDENCE_INVALID');
  const rawValue = cloneJsonValue(value.rawValue, 0, cloneBudget);
  const normalizedValue = cloneJsonValue(value.normalizedValue, 0, cloneBudget);
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
    'directory', 'resolveTenant', 'resolveKey', 'resolveRetention', 'authorizePrivateAccess',
    'authorizePrivateAccessCurrent', 'consumePrivatePayload',
    'now', 'maxSourceBytes', 'maxPositionBytes', 'maxPositionCount', 'maxStoredPayloadBytes', 'maxRetentionMs',
    'lockTimeoutMs',
  ]));
  if (!config || typeof config.directory !== 'string' || config.directory.length === 0
    || typeof config.resolveTenant !== 'function' || typeof config.resolveKey !== 'function'
    || typeof config.resolveRetention !== 'function') fail('EVIDENCE_INVALID');
  if (config.authorizePrivateAccess !== undefined && typeof config.authorizePrivateAccess !== 'function') fail('EVIDENCE_INVALID');
  if (config.authorizePrivateAccessCurrent !== undefined && typeof config.authorizePrivateAccessCurrent !== 'function') fail('EVIDENCE_INVALID');
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
      const length = database.prepare('SELECT length(CAST(document AS BLOB)) AS bytes FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash);
      if (!length) return emptyManifest(tenantHash);
      if (!Number.isSafeInteger(length.bytes) || length.bytes <= 0) fail('EVIDENCE_INTEGRITY');
      if (length.bytes > 16 * 1024 * 1024) fail('EVIDENCE_INTEGRITY');
      const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(tenantHash);
      if (!row || Buffer.byteLength(row.document, 'utf8') !== length.bytes) fail('EVIDENCE_INTEGRITY');
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
    let serialized;
    try { serialized = JSON.stringify(data); } catch { fail('EVIDENCE_INVALID'); }
    if (typeof serialized !== 'string') fail('EVIDENCE_INVALID');
    const plaintextBytes = Buffer.byteLength(serialized, 'utf8');
    const maximum = kind === 'evidence'
      ? SELECTED_BATCH_LIMITS.evidenceDecryptedBytes
      : SELECTED_BATCH_LIMITS.factRecordBytes;
    if (plaintextBytes <= 0 || plaintextBytes > maximum) fail('EVIDENCE_INVALID');
    const key = await resolveKey(info, kind === 'evidence' ? 'payload' : 'fact');
    try {
      return {
        keyId: key.keyId,
        bytes: encodeSealedPayload(info.tenantHash, id, kind, serialized, key.keyId, key.key),
      };
    } finally {
      key.key.fill(0);
    }
  }

  async function decryptBundle(info, id, kind, database, expectedKeyId) {
    const envelopeBytes = readSealedBundle(database, kind, id);
    try {
      const envelope = decodeSealedEnvelope(envelopeBytes, info.tenantHash, id, kind);
      if (expectedKeyId && envelope.keyId !== expectedKeyId) fail('EVIDENCE_INTEGRITY');
      const plaintextBytes = base64DecodedByteLength(envelope.ciphertext);
      const maximum = kind === 'evidence'
        ? SELECTED_BATCH_LIMITS.evidenceDecryptedBytes
        : SELECTED_BATCH_LIMITS.factRecordBytes;
      if (plaintextBytes > maximum) fail('EVIDENCE_INVALID');
      const key = await resolveKey(info, kind === 'evidence' ? 'payload' : 'fact', envelope.keyId);
      try {
        return decryptSealedPayload(envelope, info.tenantHash, id, kind, key.key, plaintextBytes);
      } finally {
        key.key.fill(0);
      }
    } finally {
      envelopeBytes.fill(0);
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

  function authorizeCurrent(info, request, action, evidenceIds, factIds = []) {
    if (typeof config.authorizePrivateAccessCurrent !== 'function') fail('EVIDENCE_DENIED');
    let result;
    try {
      result = config.authorizePrivateAccessCurrent(Object.freeze({
        tenantId: info.tenantId,
        request,
        action,
        evidenceIds: Object.freeze([...new Set(evidenceIds)]),
        factIds: Object.freeze([...new Set(factIds)]),
      }));
    } catch {
      fail('EVIDENCE_DENIED');
    }
    if (result !== true) {
      observeNativeRejectedPromise(result);
      fail('EVIDENCE_DENIED');
    }
  }

  function checkCancellation(signal) {
    if (signal === undefined) return;
    try {
      if (Reflect.apply(ABORT_SIGNAL_ABORTED_GETTER, signal, [])) fail('EVIDENCE_CANCELLED');
    } catch (error) {
      if (error instanceof EvidenceStoreError) throw error;
      fail('EVIDENCE_INVALID');
    }
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
          'encryptionKeyId', 'positionIds', 'positionHashes', 'representation', 'derivationDigest',
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

  async function persistExpirySweep(info, directory) {
    await withTenantLock(directory, limits.lockTimeoutMs, async (database) => {
      const manifest = await readManifest(database, info.tenantHash);
      await expireRecords(database, manifest, currentTime());
    });
  }

  async function withExpiryCleanup(info, directory, operation) {
    try {
      return await operation();
    } catch (operationError) {
      // The operation transaction has already rolled back. Persist only a fresh
      // expiry sweep in its own transaction, so a failed mutation never commits.
      try {
        await persistExpirySweep(info, directory);
      } catch (cleanupError) {
        throw safePublicError(cleanupError);
      }
      throw operationError;
    }
  }

  async function withExpiryAwareTenantLock(info, directory, operation) {
    return withExpiryCleanup(info, directory, () => withTenantLock(directory, limits.lockTimeoutMs, operation));
  }

  function makeFinalStateVerifier(info, directory, evidenceIds, factIds) {
    const databasePath = path.join(directory, 'evidence.sqlite');
    let database;
    try {
      const uniqueEvidenceIds = [...new Set(evidenceIds)];
      const uniqueFactIds = [...new Set(factIds)];
      const before = lstatSync(databasePath);
      if (before.isSymbolicLink() || !before.isFile()) fail('EVIDENCE_STORAGE');
      database = new DatabaseSync(databasePath, { readOnly: true, timeout: limits.lockTimeoutMs });
      const after = lstatSync(databasePath);
      if (after.isSymbolicLink() || !after.isFile() || before.dev !== after.dev || before.ino !== after.ino) {
        fail('EVIDENCE_STORAGE');
      }
      database.exec('PRAGMA trusted_schema = OFF');
      const manifestLengthStatement = database.prepare(
        'SELECT length(CAST(document AS BLOB)) AS bytes FROM evidence_manifest WHERE tenant_hash = ?',
      );
      const manifestStatement = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?');
      const totalBundleCountStatement = database.prepare('SELECT COUNT(*) AS count FROM sealed_bundles');
      const prepareCountStatements = (kind, ids) => {
        const batches = [];
        for (let offset = 0; offset < ids.length; offset += 500) {
          const values = ids.slice(offset, offset + 500);
          batches.push({
            statement: database.prepare(`SELECT COUNT(*) AS count FROM sealed_bundles WHERE kind = '${kind}' AND id IN (${values.map(() => '?').join(',')})`),
            values,
          });
        }
        return batches;
      };
      const evidenceCountStatements = prepareCountStatements('evidence', uniqueEvidenceIds);
      const factCountStatements = prepareCountStatements('fact', uniqueFactIds);
      const countRows = (batches) => batches.reduce((total, batch) => total + Number(batch.statement.get(...batch.values).count), 0);
      return {
        check(snapshot) {
          let row;
          let evidenceBundleCount;
          let factBundleCount;
          let totalBundleCount;
          try {
            database.exec('BEGIN');
            const length = manifestLengthStatement.get(info.tenantHash);
            if (length && (!Number.isSafeInteger(length.bytes) || length.bytes <= 0 || length.bytes > 16 * 1024 * 1024)) {
              fail('EVIDENCE_INTEGRITY');
            }
            row = manifestStatement.get(info.tenantHash);
            if (length && (!row || Buffer.byteLength(row.document, 'utf8') !== length.bytes)) fail('EVIDENCE_INTEGRITY');
            if (!length && row) fail('EVIDENCE_INTEGRITY');
            evidenceBundleCount = countRows(evidenceCountStatements);
            factBundleCount = countRows(factCountStatements);
            totalBundleCount = Number(totalBundleCountStatement.get().count);
            database.exec('COMMIT');
          } catch (error) {
            try { database.exec('ROLLBACK'); } catch { /* rollback may follow a failed BEGIN or COMMIT */ }
            if (error instanceof EvidenceStoreError) throw error;
            if (error?.errcode === 5 || error?.errcode === 6 || error?.code === 'ERR_SQLITE_BUSY') fail('EVIDENCE_BUSY');
            fail('EVIDENCE_STORAGE');
          }
          if (!row) {
            if (snapshot.manifestPresentAtSnapshot !== false
              || snapshot.evidence.length !== 0 || snapshot.facts.length !== 0 || totalBundleCount !== 0) {
              fail('EVIDENCE_INTEGRITY');
            }
            return;
          }
          if (evidenceBundleCount !== uniqueEvidenceIds.length || factBundleCount !== uniqueFactIds.length) {
            fail('EVIDENCE_EXPIRED');
          }
          let parsed;
          try { parsed = JSON.parse(row.document); } catch { fail('EVIDENCE_INTEGRITY'); }
          const manifest = validateManifest(parsed, info.tenantHash);
          const sameValues = (left, right, fields) => fields.every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field]));
          for (const expected of snapshot.evidence) {
            const current = manifest.records[expected.id];
            if (!current || current.state !== 'available') fail('EVIDENCE_EXPIRED');
            if (!sameValues(expected, current, [
              'id', 'state', 'version', 'contentHash', 'duplicateGroupId', 'retrievedAt',
              'createdAt', 'createdAtMs', 'retrievedAtMs', 'expiresAtMs', 'policyId', 'policyVersion',
              'encryptionKeyId', 'positionIds', 'positionHashes', 'representation', 'derivationDigest',
            ])) fail('EVIDENCE_INTEGRITY');
            const expectedPreviousId = expected.previousId ?? null;
            const currentPreviousId = current.previousId ?? null;
            const samePreviousId = expectedPreviousId === currentPreviousId;
            const expiredPredecessorWasUnlinked = expectedPreviousId !== null
              && currentPreviousId === null
              && manifest.records[expectedPreviousId]?.state === 'expired';
            if (!samePreviousId && !expiredPredecessorWasUnlinked) fail('EVIDENCE_INTEGRITY');
            // The public metadata must reflect the persisted, expiry-cleaned
            // linkage that passed this final check.
            expected.previousId = currentPreviousId;
          }
          for (const expected of snapshot.facts) {
            const current = manifest.facts[expected.id];
            if (!current || current.state !== 'available') fail('EVIDENCE_EXPIRED');
            if (!sameValues(expected, current, [
              'id', 'status', 'state', 'createdAt', 'createdAtMs', 'expiresAtMs', 'policyId', 'policyVersion',
              'encryptionKeyId', 'supportEvidenceIds', 'supportContentHashes',
            ])) fail('EVIDENCE_INTEGRITY');
          }
          const publicationTime = currentTime();
          if (snapshot.evidence.some((record) => record.expiresAtMs <= publicationTime)
            || snapshot.facts.some((fact) => fact.expiresAtMs <= publicationTime)) fail('EVIDENCE_EXPIRED');
        },
        close() {
          database?.close();
          database = null;
        },
      };
    } catch (error) {
      database?.close();
      if (error instanceof EvidenceStoreError) throw error;
      if (error?.errcode === 5 || error?.errcode === 6 || error?.code === 'ERR_SQLITE_BUSY') fail('EVIDENCE_BUSY');
      fail('EVIDENCE_STORAGE');
    }
  }

  async function commitNewBundle(database, kind, id, sealedBytes) {
    try {
      database.prepare('INSERT INTO sealed_bundles (kind, id, sealed) VALUES (?, ?, ?)').run(kind, id, sealedBytes);
    } catch (error) {
      throw safePublicError(error);
    }
  }

  function copyEvidenceRecord(record, positionLimit = limits.maxPositionCount, budget) {
    if (!isRecord(record) || record.state !== 'available' || !validUuid(record.id)
      || !Number.isSafeInteger(record.expiresAtMs) || !Number.isSafeInteger(record.version)
      || !isDigest(record.contentHash) || !isDigest(record.duplicateGroupId)
      || !validTimestamp(record.retrievedAt) || !Number.isSafeInteger(record.retrievedAtMs)
      || !Number.isSafeInteger(record.createdAtMs) || typeof record.encryptionKeyId !== 'string'
      || record.encryptionKeyId.length < 1 || record.encryptionKeyId.length > 128) {
      fail('EVIDENCE_INTEGRITY');
    }
    if ((record.representation !== undefined
      && (record.representation !== PDF_DERIVED_REPRESENTATION || !isDigest(record.derivationDigest)))
      || (record.representation === undefined && Object.hasOwn(record, 'derivationDigest'))) fail('EVIDENCE_INTEGRITY');
    const effectivePositionLimit = Math.min(limits.maxPositionCount, positionLimit);
    if (!Array.isArray(record.positionIds)) fail('EVIDENCE_INTEGRITY');
    if (record.positionIds.length > limits.maxPositionCount) fail('EVIDENCE_INTEGRITY');
    if (record.positionIds.length > effectivePositionLimit) fail('EVIDENCE_INVALID');
    const positionIds = safeArray(record.positionIds, effectivePositionLimit);
    if (!positionIds || positionIds.length === 0 || positionIds.some((id) => !validUuid(id))) fail('EVIDENCE_INTEGRITY');
    if (!isRecord(record.positionHashes)) fail('EVIDENCE_INTEGRITY');
    const positionHashKeys = Object.keys(record.positionHashes);
    if (positionHashKeys.length !== positionIds.length
      || positionHashKeys.some((id) => !positionIds.includes(id))) fail('EVIDENCE_INTEGRITY');
    const positionHashes = Object.create(null);
    for (const id of positionIds) {
      const descriptor = Object.getOwnPropertyDescriptor(record.positionHashes, id);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !isDigest(descriptor.value)) fail('EVIDENCE_INTEGRITY');
      positionHashes[id] = descriptor.value;
    }
    if (budget) {
      const metadataBytes = 256 + Buffer.byteLength(record.id + record.contentHash + record.duplicateGroupId
        + record.retrievedAt + (record.createdAt ?? '') + (record.policyId ?? '') + (record.policyVersion ?? '')
        + record.encryptionKeyId, 'utf8')
        + positionIds.length * (36 + 64);
      addProvenanceBytes(budget, metadataBytes);
    }
    return {
      id: record.id,
      state: record.state,
      version: record.version,
      previousId: record.previousId ?? null,
      contentHash: record.contentHash,
      duplicateGroupId: record.duplicateGroupId,
      retrievedAt: record.retrievedAt,
      createdAt: record.createdAt,
      createdAtMs: record.createdAtMs,
      retrievedAtMs: record.retrievedAtMs,
      expiresAtMs: record.expiresAtMs,
      policyId: record.policyId,
      policyVersion: record.policyVersion,
      encryptionKeyId: record.encryptionKeyId,
      positionIds,
      positionHashes: cloneJsonValue(positionHashes),
      ...(record.representation === PDF_DERIVED_REPRESENTATION ? {
        representation: PDF_DERIVED_REPRESENTATION,
        derivationDigest: record.derivationDigest,
      } : {}),
    };
  }

  function copyFactRecord(record, budget) {
    if (!isRecord(record) || record.state !== 'available' || !validUuid(record.id)
      || !FACT_STATUSES.has(record.status) || !Number.isSafeInteger(record.expiresAtMs)
      || !Number.isSafeInteger(record.createdAtMs) || typeof record.encryptionKeyId !== 'string') fail('EVIDENCE_INTEGRITY');
    if (!Array.isArray(record.supportEvidenceIds) || !Array.isArray(record.supportContentHashes)) fail('EVIDENCE_INTEGRITY');
    const metadataEntries = record.supportEvidenceIds.length + record.supportContentHashes.length;
    const metadataBytes = 192 + Buffer.byteLength(record.id + record.status + record.encryptionKeyId
      + (record.policyId ?? '') + (record.policyVersion ?? ''), 'utf8')
      + record.supportEvidenceIds.length * 36 + record.supportContentHashes.length * 64;
    if (metadataEntries > 4_096) fail('EVIDENCE_INTEGRITY');
    if (budget) {
      chargeBudget(budget, 'factMetadataBytes', metadataBytes, SELECTED_BATCH_LIMITS.factMetadataBytes);
      chargeBudget(budget, 'supportReferences', metadataEntries, SELECTED_BATCH_LIMITS.supportReferences);
      addProvenanceBytes(budget, metadataBytes);
    }
    const supportEvidenceIds = safeArray(record.supportEvidenceIds, 2_048);
    const supportContentHashes = safeArray(record.supportContentHashes, 2_048);
    if (!supportEvidenceIds || supportEvidenceIds.some((id) => !validUuid(id))
      || !supportContentHashes || supportContentHashes.some((hash) => !isDigest(hash))) fail('EVIDENCE_INTEGRITY');
    return {
      id: record.id,
      status: record.status,
      state: record.state,
      createdAt: record.createdAt,
      createdAtMs: record.createdAtMs,
      expiresAtMs: record.expiresAtMs,
      policyId: record.policyId,
      policyVersion: record.policyVersion,
      encryptionKeyId: record.encryptionKeyId,
      supportEvidenceIds,
      supportContentHashes,
    };
  }

  function materializeEvidenceBundle(info, record, bundle, budget) {
    const representation = record.representation ?? 'raw';
    if (representation !== 'raw' && representation !== PDF_DERIVED_REPRESENTATION) fail('EVIDENCE_INTEGRITY');
    if (!isRecord(bundle)
      || bundle.schemaVersion !== (representation === PDF_DERIVED_REPRESENTATION ? PDF_DERIVED_BUNDLE_VERSION : 1)
      || (representation === PDF_DERIVED_REPRESENTATION
        ? bundle.representation !== PDF_DERIVED_REPRESENTATION || record.derivationDigest !== bundle.derivationDigest
        : Object.hasOwn(bundle, 'representation') || Object.hasOwn(bundle, 'derivedPdf') || Object.hasOwn(bundle, 'derivationDigest'))) {
      fail('EVIDENCE_INTEGRITY');
    }
    const storedSource = ownDataRecord(bundle.source, new Set([
      'sourceUrl', 'canonicalUrl', 'redirectChain', 'contentType', 'sourceKind', 'retrievedAt', 'retrievedAtMs', 'contentHash',
    ]));
    if (!storedSource || !SUPPORTED_SOURCE_KINDS.has(storedSource.sourceKind)
      || typeof storedSource.sourceUrl !== 'string' || typeof storedSource.canonicalUrl !== 'string'
      || typeof storedSource.contentType !== 'string' || storedSource.contentType.length < 1
      || storedSource.contentType.length > 160 || !/^[\x20-\x7e]+$/.test(storedSource.contentType)
      || !validTimestamp(storedSource.retrievedAt) || storedSource.retrievedAt !== record.retrievedAt
      || storedSource.retrievedAtMs !== record.retrievedAtMs || !isDigest(storedSource.contentHash)
      || storedSource.contentHash !== record.contentHash) fail('EVIDENCE_INTEGRITY');
    validateUrl(storedSource.sourceUrl);
    validateUrl(storedSource.canonicalUrl);
    const redirects = safeArray(storedSource.redirectChain, 20);
    if (!redirects || redirects.some((url) => typeof url !== 'string')) fail('EVIDENCE_INTEGRITY');
    for (const url of redirects) validateUrl(url);

    const sourceDescriptorBytes = 256 + Buffer.byteLength(
      storedSource.sourceUrl + storedSource.canonicalUrl + storedSource.contentType
        + storedSource.sourceKind + storedSource.retrievedAt + storedSource.contentHash,
      'utf8',
    ) + redirects.reduce((sum, url) => sum + Buffer.byteLength(url, 'utf8'), 0);
    addProvenanceBytes(budget, sourceDescriptorBytes);

    let derivedPdf = null;
    let pageMetadata = null;
    if (representation === PDF_DERIVED_REPRESENTATION) {
      if (storedSource.contentType.toLowerCase().split(';', 1)[0].trim() !== PDF_DERIVED_CONTENT_TYPE) fail('EVIDENCE_INTEGRITY');
      const stored = ownDataRecord(bundle.derivedPdf, new Set([
        'bindingVersion', 'decoder', 'completeness', 'requiresInspection', 'limits', 'pages', 'textBoxCount', 'derivationDigest',
      ]));
      const decoder = ownDataRecord(stored?.decoder, new Set(['name', 'version', 'configVersion']));
      const rawLimits = ownDataRecord(stored?.limits, new Set([
        'maxInputBytes', 'maxPages', 'maxPagePoints', 'maxTextCodeUnits', 'maxTextItemCodeUnits',
        'maxTextItems', 'maxOutputBytes', 'addressSpaceBytes', 'maxCpuSeconds', 'maxWallMilliseconds',
      ]));
      const pageValues = safeArray(stored?.pages, PDF_TEXT_READER_LIMITS.maxPages);
      if (!stored || stored.bindingVersion !== PDF_DERIVATION_BINDING_VERSION
        || !decoder || decoder.name !== 'pdfjs-dist' || decoder.version !== PDF_DECODER_VERSION
        || decoder.configVersion !== PDF_READER_CONFIG_VERSION
        || stored.completeness !== 'incomplete-text-only' || stored.requiresInspection !== true
        || !rawLimits || !pageValues || pageValues.length < 1
        || !Number.isSafeInteger(stored.textBoxCount) || stored.textBoxCount < 1
        || stored.textBoxCount > PDF_TEXT_READER_LIMITS.maxTextItems
        || stored.derivationDigest !== record.derivationDigest || !isDigest(stored.derivationDigest)) fail('EVIDENCE_INTEGRITY');
      const limitEntries = Object.entries(rawLimits);
      if (limitEntries.length !== 10 || limitEntries.some(([key, value]) =>
        !Number.isSafeInteger(value) || value <= 0 || value > PDF_TEXT_READER_LIMITS[key === 'addressSpaceBytes'
          ? 'maxAddressSpaceBytes' : key === 'maxWallMilliseconds' ? 'maxTimeoutMs' : key])) fail('EVIDENCE_INTEGRITY');
      const limitsCopy = Object.fromEntries(limitEntries);
      pageMetadata = pageValues.map((value, index) => {
        const page = ownDataRecord(value, new Set([
          'pageIndex', 'width', 'height', 'rotation', 'coordinateSystem', 'textPresence', 'requiresInspection', 'textBoxCount',
        ]));
        if (!page || page.pageIndex !== index || ![page.width, page.height].every(Number.isFinite)
          || page.width <= 0 || page.height <= 0
          || page.width > PDF_TEXT_READER_LIMITS.maxPagePoints || page.height > PDF_TEXT_READER_LIMITS.maxPagePoints
          || ![0, 90, 180, 270].includes(page.rotation)
          || page.coordinateSystem !== 'viewport-points-top-left'
          || !['text-present', 'no-embedded-text'].includes(page.textPresence)
          || page.requiresInspection !== true
          || !Number.isSafeInteger(page.textBoxCount) || page.textBoxCount < 0
          || page.textBoxCount > PDF_TEXT_READER_LIMITS.maxTextItems
          || (page.textBoxCount === 0) !== (page.textPresence === 'no-embedded-text')) fail('EVIDENCE_INTEGRITY');
        return {
          pageIndex: page.pageIndex, width: page.width, height: page.height, rotation: page.rotation,
          coordinateSystem: page.coordinateSystem, textPresence: page.textPresence,
          requiresInspection: true, textBoxCount: page.textBoxCount,
        };
      });
      if (pageMetadata.reduce((sum, page) => sum + page.textBoxCount, 0) !== stored.textBoxCount
        || stored.textBoxCount !== record.positionIds.length) fail('EVIDENCE_INTEGRITY');
      derivedPdf = {
        bindingVersion: stored.bindingVersion,
        decoder: { name: decoder.name, version: decoder.version, configVersion: decoder.configVersion },
        completeness: stored.completeness,
        requiresInspection: true,
        limits: limitsCopy,
        pages: pageMetadata,
        textBoxCount: stored.textBoxCount,
        derivationDigest: stored.derivationDigest,
      };
      addProvenanceBytes(budget, Buffer.byteLength(JSON.stringify(derivedPdf), 'utf8'));
    }

    const bundledPositions = safeArray(bundle.positions, Math.min(limits.maxPositionCount, SELECTED_BATCH_LIMITS.positionCount));
    if (!bundledPositions || bundledPositions.length !== record.positionIds.length) fail('EVIDENCE_INTEGRITY');
    const positionById = new Map();
    let recordPositionBytes = 0;
    const seenPageText = new Set();
    for (const value of bundledPositions) {
      const stored = ownDataRecord(value, new Set(['id', 'locator', 'contentHash', 'content']));
      if (!stored || !validUuid(stored.id) || !isDigest(stored.contentHash) || typeof stored.content !== 'string'
        || positionById.has(stored.id)) fail('EVIDENCE_INTEGRITY');
      const positionBytes = base64DecodedByteLength(stored.content);
      if (positionBytes > Math.min(limits.maxPositionBytes, SELECTED_BATCH_LIMITS.positionRecordBytes)) fail('EVIDENCE_INVALID');
      recordPositionBytes += positionBytes;
      if (!Number.isSafeInteger(recordPositionBytes)
        || recordPositionBytes > Math.min(limits.maxStoredPayloadBytes, SELECTED_BATCH_LIMITS.evidencePositionBytes)) fail('EVIDENCE_INVALID');
      chargeBudget(budget, 'positionBytes', positionBytes, SELECTED_BATCH_LIMITS.positionBytes);
      const locator = copyStoredLocator(stored.locator, representation);
      if (representation === PDF_DERIVED_REPRESENTATION) {
        const page = pageMetadata[locator.pageIndex];
        if (!page || locator.textIndex >= page.textBoxCount || locator.pageWidth !== page.width
          || locator.pageHeight !== page.height || locator.rotation !== page.rotation
          || locator.coordinateSystem !== page.coordinateSystem
          || locator.x + locator.width > page.width + 0.01 || locator.y + locator.height > page.height + 0.01) fail('EVIDENCE_INTEGRITY');
        const key = `${locator.pageIndex}:${locator.textIndex}`;
        if (seenPageText.has(key)) fail('EVIDENCE_INTEGRITY');
        seenPageText.add(key);
      }
      const locatorBytes = Buffer.byteLength(JSON.stringify(locator), 'utf8');
      addProvenanceBytes(budget, locatorBytes + 128);
      const bytes = Buffer.from(stored.content, 'base64');
      try {
        if (bytes.toString('base64') !== stored.content || bytes.byteLength !== positionBytes
          || digest(bytes) !== stored.contentHash || record.positionHashes[stored.id] !== stored.contentHash) fail('EVIDENCE_INTEGRITY');
      } finally {
        bytes.fill(0);
      }
      positionById.set(stored.id, { locator, contentHash: stored.contentHash });
    }
    if (record.positionIds.some((id) => !positionById.has(id))) fail('EVIDENCE_INTEGRITY');
    if (representation === PDF_DERIVED_REPRESENTATION) {
      for (const page of pageMetadata) {
        for (let textIndex = 0; textIndex < page.textBoxCount; textIndex += 1) {
          if (!seenPageText.has(`${page.pageIndex}:${textIndex}`)) fail('EVIDENCE_INTEGRITY');
        }
      }
      const derivationMaterial = {
        bindingVersion: derivedPdf.bindingVersion,
        sourceContentHash: storedSource.contentHash,
        decoder: derivedPdf.decoder,
        completeness: derivedPdf.completeness,
        requiresInspection: derivedPdf.requiresInspection,
        limits: derivedPdf.limits,
        pages: pageMetadata,
        positions: record.positionIds.map((id) => {
          const position = positionById.get(id);
          return { locator: position.locator, contentHash: position.contentHash };
        }),
      };
      if (digest(Buffer.from(JSON.stringify(derivationMaterial), 'utf8')) !== record.derivationDigest) fail('EVIDENCE_INTEGRITY');
    }
    const positions = record.positionIds.map((id) => {
      const position = positionById.get(id);
      return Object.freeze({
        handle: newPositionHandle(info, record.id, id, storedSource.sourceKind, representation),
        locator: deepFreeze(cloneJsonValue(position.locator)),
        contentHash: position.contentHash,
      });
    });
    return Object.freeze({
      handle: newEvidenceHandle(info, record.id),
      metadata: frozenMetadata(record),
      source: deepFreeze({
        sourceUrl: storedSource.sourceUrl,
        canonicalUrl: storedSource.canonicalUrl,
        redirectChain: [...redirects],
        contentType: storedSource.contentType,
        sourceKind: storedSource.sourceKind,
        retrievedAt: storedSource.retrievedAt,
        retrievedAtMs: storedSource.retrievedAtMs,
        contentHash: storedSource.contentHash,
        ...(derivedPdf ? { derivedPdf: deepFreeze(cloneJsonValue(derivedPdf)) } : {}),
      }),
      positions: Object.freeze(positions),
    });
  }

  function collectFactSupports(record, stored, budget) {
    if (!isRecord(stored) || stored.status !== record.status) fail('EVIDENCE_INTEGRITY');
    const supports = [];
    const takeSupports = (value, maximum) => {
      if (!Array.isArray(value) || value.length > maximum) fail('EVIDENCE_INTEGRITY');
      // Charge before copying or constructing public support handles. Repeated
      // references count each time because each one occupies returned memory.
      chargeBudget(budget, 'supportReferences', value.length, SELECTED_BATCH_LIMITS.supportReferences);
      return safeArray(value, maximum);
    };
    if (stored.status === 'missing') {
      if (Object.hasOwn(stored, 'supports') && (!Array.isArray(stored.supports) || stored.supports.length !== 0)) fail('EVIDENCE_INTEGRITY');
    } else if (stored.status === 'conflicting') {
      const candidates = safeArray(stored.candidates, 32);
      if (!candidates || candidates.length < 2) fail('EVIDENCE_INTEGRITY');
      for (const candidate of candidates) {
        const safeCandidate = ownDataRecord(candidate, new Set(['originStatus', 'rawValue', 'normalizedValue', 'precision', 'method', 'supports']));
        if (!safeCandidate || !FACT_ORIGINS.has(safeCandidate.originStatus)) fail('EVIDENCE_INTEGRITY');
        const candidateSupports = takeSupports(safeCandidate.supports, 64);
        if (!candidateSupports || candidateSupports.length === 0) fail('EVIDENCE_INTEGRITY');
        supports.push(...candidateSupports);
      }
    } else {
      const factSupports = takeSupports(stored.supports, 64);
      if (!factSupports || factSupports.length === 0) fail('EVIDENCE_INTEGRITY');
      supports.push(...factSupports);
    }
    const evidenceIds = new Set();
    const hashes = new Set();
    for (const supportValue of supports) {
      const support = ownDataRecord(supportValue, new Set([
        'evidenceId', 'positionId', 'contentHash', 'sourceKind', 'duplicateGroupId',
      ]));
      if (!support || !validUuid(support.evidenceId) || !validUuid(support.positionId)
        || !isDigest(support.contentHash) || !SUPPORTED_SOURCE_KINDS.has(support.sourceKind)
        || !isDigest(support.duplicateGroupId)) fail('EVIDENCE_INTEGRITY');
      addProvenanceBytes(budget, 192 + Buffer.byteLength(
        support.evidenceId + support.positionId + support.contentHash + support.sourceKind + support.duplicateGroupId,
        'utf8',
      ));
      evidenceIds.add(support.evidenceId);
      hashes.add(support.contentHash);
    }
    if (JSON.stringify([...evidenceIds].sort()) !== JSON.stringify([...record.supportEvidenceIds].sort())
      || JSON.stringify([...hashes].sort()) !== JSON.stringify([...record.supportContentHashes].sort())) fail('EVIDENCE_INTEGRITY');
    return supports;
  }

  function validateMaterializedFact(record, stored, evidenceById, budget) {
    const supports = collectFactSupports(record, stored, budget);
    for (const supportValue of supports) {
      const support = ownDataRecord(supportValue, new Set([
        'evidenceId', 'positionId', 'contentHash', 'sourceKind', 'duplicateGroupId',
      ]));
      const evidence = evidenceById.get(support.evidenceId);
      const supportedPosition = evidence?.positions.find((position) => POSITION_HANDLES.get(position.handle)?.positionId === support.positionId);
      const supportedPositionInfo = supportedPosition ? POSITION_HANDLES.get(supportedPosition.handle) : null;
      if (!evidence || evidence.metadata.contentHash !== support.contentHash
        || evidence.metadata.duplicateGroupId !== support.duplicateGroupId
        || evidence.source.sourceKind !== support.sourceKind
        || !supportedPositionInfo || supportedPositionInfo.representation !== 'raw') {
        fail('EVIDENCE_INTEGRITY');
      }
    }
  }

  async function materializeSelectedInternal(scope, selectionValue, request, signal, action, returnMode = 'selected', evidenceLimit = 8) {
    const info = scopeInfo(scope);
    checkCancellation(signal);
    const budget = newMaterializationBudget();
    const selection = ownDataRecord(selectionValue, new Set(['evidence', 'facts']));
    if (!selection) fail('EVIDENCE_INVALID');
    const evidenceHandles = safeArray(selection.evidence, SELECTED_BATCH_LIMITS.evidenceCount);
    const factHandles = safeArray(selection.facts, SELECTED_BATCH_LIMITS.factCount);
    if (!evidenceHandles || !factHandles || evidenceHandles.length + factHandles.length === 0) fail('EVIDENCE_INVALID');
    const explicitEvidenceIds = [];
    const factIds = [];
    for (const handle of evidenceHandles) {
      const evidence = evidenceInfo(scope, handle);
      explicitEvidenceIds.push(evidence.evidenceId);
    }
    for (const handle of factHandles) {
      const fact = FACT_HANDLES.get(handle);
      if (!fact || fact.tenantHash !== info.tenantHash || fact.tenantId !== info.tenantId) fail('EVIDENCE_DENIED');
      factIds.push(fact.factId);
    }
    if (new Set(explicitEvidenceIds).size !== explicitEvidenceIds.length || new Set(factIds).size !== factIds.length) fail('EVIDENCE_INVALID');

    const directory = await tenantDirectory(info);
    let snapshot;
    let finalVerifier;
    try {
      snapshot = await withExpiryAwareTenantLock(info, directory, async (database) => {
        const factRecords = [];
        const evidenceRecords = [];
        let transferred = false;
        try {
          const manifest = await readManifest(database, info.tenantHash);
          await expireRecords(database, manifest, currentTime());
          const evidenceIds = [...explicitEvidenceIds];
          for (const factId of factIds) {
            const current = manifest.facts[factId];
            if (!current) fail('EVIDENCE_NOT_FOUND');
            if (current.state !== 'available') fail('EVIDENCE_EXPIRED');
            const copied = copyFactRecord(current, budget);
            factRecords.push(copied);
            for (const evidenceId of copied.supportEvidenceIds) {
              if (!evidenceIds.includes(evidenceId)) evidenceIds.push(evidenceId);
              if (evidenceIds.length > evidenceLimit) fail('EVIDENCE_INVALID');
            }
          }
          if (evidenceIds.length > evidenceLimit || new Set(evidenceIds).size !== evidenceIds.length) fail('EVIDENCE_INVALID');
          let selectedPositionCount = 0;
          const effectivePositionLimit = Math.min(limits.maxPositionCount, SELECTED_BATCH_LIMITS.positionCount);
          for (const evidenceId of evidenceIds) {
            const current = manifest.records[evidenceId];
            if (!current) fail('EVIDENCE_NOT_FOUND');
            if (current.state !== 'available') fail('EVIDENCE_EXPIRED');
            const copied = copyEvidenceRecord(current, effectivePositionLimit - selectedPositionCount, budget);
            selectedPositionCount += copied.positionIds.length;
            if (selectedPositionCount > effectivePositionLimit) fail('EVIDENCE_INVALID');
            evidenceRecords.push(copied);
          }
          const evidenceLengths = preflightSelectedSealedBundleLengths(
            database,
            'evidence',
            evidenceRecords.map((record) => record.id),
            budget,
          );
          const factLengths = preflightSelectedSealedBundleLengths(
            database,
            'fact',
            factRecords.map((record) => record.id),
            budget,
          );
          copySelectedSealedBundles(database, 'evidence', evidenceRecords, evidenceLengths);
          copySelectedSealedBundles(database, 'fact', factRecords, factLengths);
          const nowMs = currentTime();
          if (evidenceRecords.some((record) => record.expiresAtMs <= nowMs)
            || factRecords.some((record) => record.expiresAtMs <= nowMs)) fail('EVIDENCE_EXPIRED');
          transferred = true;
          return { evidence: evidenceRecords, facts: factRecords, budget };
        } finally {
          if (!transferred) {
            for (const record of evidenceRecords) record.sealed?.fill(0);
            for (const record of factRecords) record.sealed?.fill(0);
          }
        }
      });

      checkCancellation(signal);
      const evidenceIds = snapshot.evidence.map((record) => record.id);
      await authorize(info, request, action, evidenceIds, factIds);
      checkCancellation(signal);

      const evidenceViews = [];
      const evidenceById = new Map();
      for (const record of snapshot.evidence) {
        const bundle = await decryptSealedBundle(info, record.id, 'evidence', record.sealed, record.encryptionKeyId, resolveKey, snapshot.budget);
        try {
          checkCancellation(signal);
          const view = materializeEvidenceBundle(info, record, bundle, snapshot.budget);
          evidenceViews.push(view);
          evidenceById.set(record.id, view);
        } finally {
          // The decrypted JSON tree contains base64 position content; discard it as
          // soon as the public metadata and opaque position handles are made.
          wipePrivateTree(bundle);
        }
      }
      const factViews = [];
      for (const record of snapshot.facts) {
        const stored = await decryptSealedBundle(info, record.id, 'fact', record.sealed, record.encryptionKeyId, resolveKey, snapshot.budget);
        try {
          checkCancellation(signal);
          validateMaterializedFact(record, stored, evidenceById, snapshot.budget);
          factViews.push(publicFact(info, record.id, stored));
        } finally {
          wipePrivateTree(stored);
        }
      }

      checkCancellation(signal);
      finalVerifier = makeFinalStateVerifier(info, directory, evidenceIds, factIds);
      // This is the final host authorization decision. Everything that can await,
      // including key resolution, has completed; no DB/write lock is held.
      authorizeCurrent(info, request, action, evidenceIds, factIds);
      // Keep this synchronous tail together: current persisted state, every selected
      // record's retention deadline, cancellation, then immutable result release.
      finalVerifier.check(snapshot);
      checkCancellation(signal);
      const refreshedEvidenceViews = evidenceViews.map((view) => {
        const record = snapshot.evidence.find((candidate) => candidate.id === view.metadata.evidenceId);
        if (!record) fail('EVIDENCE_INTEGRITY');
        return Object.freeze({ ...view, metadata: frozenMetadata(record) });
      });
      const materialized = deepFreeze({ evidence: refreshedEvidenceViews, facts: factViews });
      if (returnMode === 'fact') return materialized.facts[0];
      if (returnMode === 'positions') return materialized.evidence[0].positions;
      return materialized;
    } catch (error) {
      try { await persistExpirySweep(info, directory); } catch (cleanupError) { throw safePublicError(cleanupError); }
      throw safePublicError(error);
    } finally {
      finalVerifier?.close();
      for (const record of snapshot?.evidence ?? []) record.sealed.fill(0);
      for (const record of snapshot?.facts ?? []) record.sealed.fill(0);
    }
  }

  async function materializeSelected(scope, selection, request, signal) {
    return materializeSelectedInternal(scope, selection, request, signal, 'materialize_selected');
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
      return await withExpiryAwareTenantLock(info, directory, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        const transactionTime = currentTime();
        await expireRecords(database, manifest, transactionTime);
        if (retention.expiresAtMs <= transactionTime) fail('EVIDENCE_EXPIRED');
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
          if (currentTime() >= latest.expiresAtMs) fail('EVIDENCE_EXPIRED');
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
        if (retention.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
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
        if (retention.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
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
        if (retention.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
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

  async function ingestDerivedPdfEvidence(scope, inputValue, request, signal) {
    const info = scopeInfo(scope);
    const input = ownDataRecord(inputValue, new Set([
      'sourceUrl', 'canonicalUrl', 'redirectChain', 'content', 'contentType', 'retrievedAt', 'sourceKind',
      'retentionHandle', 'readerOptions',
    ]));
    if (!input || typeof input.sourceUrl !== 'string' || !SUPPORTED_SOURCE_KINDS.has(input.sourceKind)
      || !validTimestamp(input.retrievedAt) || typeof input.contentType !== 'string'
      || input.contentType.length < 1 || input.contentType.length > 160 || !/^[\x20-\x7e]+$/.test(input.contentType)
      || input.contentType.toLowerCase().split(';', 1)[0].trim() !== PDF_DERIVED_CONTENT_TYPE
      || !input.retentionHandle || typeof input.retentionHandle !== 'object') fail('EVIDENCE_INVALID');
    validateUrl(input.sourceUrl);
    const sourceUrl = input.sourceUrl;
    const canonicalUrl = input.canonicalUrl === undefined ? normalizeSourceUrl(sourceUrl) : normalizeSourceUrl(input.canonicalUrl);
    const redirectsInput = input.redirectChain === undefined ? [] : safeArray(input.redirectChain, 20);
    if (!redirectsInput) fail('EVIDENCE_INVALID');
    const redirectChain = redirectsInput.map((item) => validateUrl(item).href);
    const readerInput = input.readerOptions === undefined
      ? Object.create(null)
      : ownDataRecord(input.readerOptions, new Set(['timeoutMs', 'maxTextCodeUnits', 'maxOutputBytes']));
    if (!readerInput) fail('EVIDENCE_INVALID');
    const sourceLimit = Math.min(limits.maxSourceBytes, PDF_DERIVED_MAX_SOURCE_BYTES, PDF_TEXT_READER_LIMITS.maxInputBytes);
    // A PDF source is the exact fetched byte stream. Accepting text here would
    // re-encode bytes and make the stored source digest describe a conversion,
    // not the original document supplied by the fetch boundary.
    if (!(input.content instanceof Uint8Array)) fail('EVIDENCE_INVALID');
    const sourceBytes = copyBytes(input.content, sourceLimit);
    const sourceContentHash = digest(sourceBytes);
    const retrievedAtMs = Date.parse(input.retrievedAt);
    const retentionStartMs = currentTime();
    let retention;
    let activeIndexKey;
    let payloadKey;
    let sealedBytes;
    const historicalIndexKeys = [];
    let positions = [];
    let directoryForCleanup;
    try {
      checkCancellation(signal);
      // Resolve the source's already-authorized retention deadline before starting
      // the killable decoder. Decode time never resets or extends this deadline.
      retention = await resolveRetention(info, 'evidence', retentionStartMs, input.sourceKind, undefined, input.retentionHandle);
      if (retention.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
      const timeoutMs = readerInput.timeoutMs ?? PDF_DERIVED_DEFAULT_TIMEOUT_MS;
      const effectiveTextLimit = Math.min(
        PDF_TEXT_READER_LIMITS.maxTextCodeUnits,
        limits.maxStoredPayloadBytes,
        SELECTED_BATCH_LIMITS.evidenceDecryptedBytes,
      );
      const effectiveOutputLimit = Math.min(
        PDF_TEXT_READER_LIMITS.maxOutputBytes,
        SELECTED_BATCH_LIMITS.evidenceDecryptedBytes,
        Math.max(4_096, limits.maxStoredPayloadBytes),
      );
      const maxTextCodeUnits = readerInput.maxTextCodeUnits ?? effectiveTextLimit;
      const maxOutputBytes = readerInput.maxOutputBytes ?? effectiveOutputLimit;
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > PDF_TEXT_READER_LIMITS.maxTimeoutMs
        || !Number.isSafeInteger(maxTextCodeUnits) || maxTextCodeUnits < 1
        || maxTextCodeUnits > effectiveTextLimit
        || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 4_096
        || maxOutputBytes > effectiveOutputLimit) fail('EVIDENCE_INVALID');

      let readResult;
      try {
        readResult = await readTextPdf(sourceBytes, { signal, timeoutMs, maxTextCodeUnits, maxOutputBytes });
      } catch {
        checkCancellation(signal);
        if (retention.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
        return Object.freeze({ outcome: 'rejected', code: 'DECODER_FAILURE' });
      }
      checkCancellation(signal);
      if (retention.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
      if (!readResult || readResult.kind === 'rejected') {
        const code = readResult?.code;
        return Object.freeze({ outcome: 'rejected', code: typeof code === 'string' ? code : 'DECODER_FAILURE' });
      }
      if (readResult.documentSha256 !== sourceContentHash || readResult.decoder?.name !== 'pdfjs-dist'
        || readResult.decoder.version !== PDF_DECODER_VERSION || readResult.decoder.configVersion !== PDF_READER_CONFIG_VERSION
        || readResult.networkAttemptCount !== 0 || readResult.completeness !== 'incomplete-text-only'
        || readResult.requiresInspection !== true || !isRecord(readResult.limits)) fail('EVIDENCE_INTEGRITY');
      if (readResult.kind === 'no-text') {
        if (readResult.code !== 'NO_EMBEDDED_TEXT') fail('EVIDENCE_INTEGRITY');
        return Object.freeze({ outcome: 'no-text', code: 'NO_EMBEDDED_TEXT', requiresInspection: true });
      }
      if (readResult.kind !== 'observation') fail('EVIDENCE_INTEGRITY');

      const pageInputs = safeArray(readResult.pages, PDF_TEXT_READER_LIMITS.maxPages);
      if (!pageInputs || pageInputs.length < 1) fail('EVIDENCE_INTEGRITY');
      const pageMetadata = [];
      positions = [];
      let positionBytesTotal = 0;
      const positionMaximum = Math.min(limits.maxPositionCount, SELECTED_BATCH_LIMITS.positionCount);
      const positionByteMaximum = Math.min(limits.maxPositionBytes, SELECTED_BATCH_LIMITS.positionRecordBytes);
      const totalByteMaximum = Math.min(limits.maxStoredPayloadBytes, SELECTED_BATCH_LIMITS.evidencePositionBytes);
      for (let pageIndex = 0; pageIndex < pageInputs.length; pageIndex += 1) {
        const page = ownDataRecord(pageInputs[pageIndex], new Set([
          'pageIndex', 'width', 'height', 'rotation', 'coordinateSystem', 'textPresence', 'requiresInspection', 'textBoxes',
        ]));
        const boxes = safeArray(page?.textBoxes, PDF_TEXT_READER_LIMITS.maxTextItems);
        if (!page || page.pageIndex !== pageIndex || ![page.width, page.height].every(Number.isFinite)
          || page.width <= 0 || page.height <= 0 || page.width > PDF_TEXT_READER_LIMITS.maxPagePoints
          || page.height > PDF_TEXT_READER_LIMITS.maxPagePoints || ![0, 90, 180, 270].includes(page.rotation)
          || page.coordinateSystem !== 'viewport-points-top-left' || page.requiresInspection !== true
          || !['text-present', 'no-embedded-text'].includes(page.textPresence) || !boxes
          || (boxes.length > 0 && page.textPresence !== 'text-present')
          || (boxes.length === 0 && page.textPresence !== 'no-embedded-text')) fail('EVIDENCE_INTEGRITY');
        pageMetadata.push({
          pageIndex, width: page.width, height: page.height, rotation: page.rotation,
          coordinateSystem: page.coordinateSystem, textPresence: page.textPresence,
          requiresInspection: true, textBoxCount: boxes.length,
        });
        for (let textIndex = 0; textIndex < boxes.length; textIndex += 1) {
          const box = ownDataRecord(boxes[textIndex], new Set(['x', 'y', 'width', 'height', 'text', 'geometry']));
          if (!box || typeof box.text !== 'string' || box.text.length === 0 || !isWellFormed(box.text)
            || box.text.length > PDF_TEXT_READER_LIMITS.maxTextItemCodeUnits || box.geometry !== 'approximate-text-item'
            || ![box.x, box.y, box.width, box.height].every(Number.isFinite)
            || box.x < 0 || box.y < 0 || box.width < 0 || box.height < 0
            || box.x + box.width > page.width + 0.01 || box.y + box.height > page.height + 0.01) fail('EVIDENCE_INTEGRITY');
          if (positions.length >= positionMaximum) fail('EVIDENCE_INVALID');
          const content = Buffer.from(box.text, 'utf8');
          if (content.toString('utf8') !== box.text || content.byteLength > positionByteMaximum) {
            content.fill(0);
            fail('EVIDENCE_INVALID');
          }
          positionBytesTotal += content.byteLength;
          if (!Number.isSafeInteger(positionBytesTotal) || positionBytesTotal > totalByteMaximum) {
            content.fill(0);
            fail('EVIDENCE_INVALID');
          }
          const locator = Object.freeze({
            kind: 'pdf-text-box', pageIndex, textIndex,
            x: box.x, y: box.y, width: box.width, height: box.height,
            pageWidth: page.width, pageHeight: page.height, rotation: page.rotation,
            coordinateSystem: page.coordinateSystem, geometry: box.geometry,
          });
          positions.push({ id: randomUUID(), locator, contentHash: digest(content), bytes: content });
        }
      }
      if (positions.length === 0) fail('EVIDENCE_INTEGRITY');

      const limitsCopy = {
        maxInputBytes: readResult.limits.maxInputBytes,
        maxPages: readResult.limits.maxPages,
        maxPagePoints: readResult.limits.maxPagePoints,
        maxTextCodeUnits: readResult.limits.maxTextCodeUnits,
        maxTextItemCodeUnits: readResult.limits.maxTextItemCodeUnits,
        maxTextItems: readResult.limits.maxTextItems,
        maxOutputBytes: readResult.limits.maxOutputBytes,
        addressSpaceBytes: readResult.limits.addressSpaceBytes,
        maxCpuSeconds: readResult.limits.maxCpuSeconds,
        maxWallMilliseconds: readResult.limits.maxWallMilliseconds,
      };
      if (Object.values(limitsCopy).some((value) => !Number.isSafeInteger(value) || value <= 0)) fail('EVIDENCE_INTEGRITY');
      const derivedPdf = {
        bindingVersion: PDF_DERIVATION_BINDING_VERSION,
        decoder: { name: readResult.decoder.name, version: readResult.decoder.version, configVersion: readResult.decoder.configVersion },
        completeness: readResult.completeness,
        requiresInspection: true,
        limits: limitsCopy,
        pages: pageMetadata,
        textBoxCount: positions.length,
      };
      const derivationMaterial = {
        bindingVersion: derivedPdf.bindingVersion,
        sourceContentHash,
        decoder: derivedPdf.decoder,
        completeness: derivedPdf.completeness,
        requiresInspection: derivedPdf.requiresInspection,
        limits: derivedPdf.limits,
        pages: pageMetadata,
        positions: positions.map((position) => ({ locator: position.locator, contentHash: position.contentHash })),
      };
      const derivationDigest = digest(Buffer.from(JSON.stringify(derivationMaterial), 'utf8'));
      derivedPdf.derivationDigest = derivationDigest;
      const sourceProvenance = {
        sourceUrl, canonicalUrl, redirectChain, contentType: input.contentType,
        sourceKind: input.sourceKind, retrievedAt: input.retrievedAt, retrievedAtMs, contentHash: sourceContentHash,
      };
      const provenanceBytes = Buffer.byteLength(JSON.stringify({ source: sourceProvenance, derivedPdf }), 'utf8')
        + positions.reduce((sum, position) => sum + Buffer.byteLength(JSON.stringify(position.locator), 'utf8') + 128, 0);
      if (!Number.isSafeInteger(provenanceBytes) || provenanceBytes > SELECTED_BATCH_LIMITS.provenanceBytes) fail('EVIDENCE_INVALID');
      const positionIds = positions.map((position) => position.id);
      const positionHashes = Object.fromEntries(positions.map((position) => [position.id, position.contentHash]));
      const bundle = {
        schemaVersion: PDF_DERIVED_BUNDLE_VERSION,
        representation: PDF_DERIVED_REPRESENTATION,
        derivationDigest,
        source: sourceProvenance,
        derivedPdf,
        positions: positions.map((position) => ({
          id: position.id, locator: position.locator, contentHash: position.contentHash, content: position.bytes.toString('base64'),
        })),
      };
      const serialized = JSON.stringify(bundle);
      if (Buffer.byteLength(serialized, 'utf8') > SELECTED_BATCH_LIMITS.evidenceDecryptedBytes) fail('EVIDENCE_INVALID');

      const action = 'ingest_derived_pdf_evidence';
      activeIndexKey = await resolveKey(info, 'source-index');
      const derivedIdentity = `event-intelligence:source-family:pdf-derived:v1\u0000${input.sourceKind}\u0000${normalizeSourceUrl(canonicalUrl)}`;
      const currentFamilyHmac = stableHmac(activeIndexKey.key, derivedIdentity);
      const directory = await tenantDirectory(info);
      directoryForCleanup = directory;
      const snapshot = await withExpiryAwareTenantLock(info, directory, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        const row = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(info.tenantHash);
        return { document: row?.document ?? null };
      });
      let manifest = snapshot.document === null ? emptyManifest(info.tenantHash) : validateManifest(JSON.parse(snapshot.document), info.tenantHash);
      const derivedFamilies = Object.values(manifest.families).filter((family) => family.representation === PDF_DERIVED_REPRESENTATION);
      if (derivedFamilies.length > 256) fail('EVIDENCE_BUSY');
      let family = derivedFamilies.find((candidate) => candidate.sourceKeyId === activeIndexKey.keyId
        && candidate.sourceKeyHmac === currentFamilyHmac);
      if (!family) {
        for (const candidate of derivedFamilies) {
          if (candidate.sourceKeyId === activeIndexKey.keyId) continue;
          const oldIndexKey = await resolveKey(info, 'source-index', candidate.sourceKeyId);
          historicalIndexKeys.push(oldIndexKey.key);
          if (candidate.sourceKeyHmac === stableHmac(oldIndexKey.key, derivedIdentity)) {
            family = candidate;
            break;
          }
        }
      }
      const familyRecordIds = family ? safeArray(family.recordIds, 100_000) : [];
      if (!familyRecordIds) fail('EVIDENCE_INTEGRITY');
      const existingRecord = familyRecordIds.map((id) => manifest.records[id]).find((candidate) =>
        candidate?.state === 'available' && candidate.representation === PDF_DERIVED_REPRESENTATION
          && candidate.contentHash === sourceContentHash && candidate.derivationDigest === derivationDigest);
      if (existingRecord) {
        const existingSnapshot = copyEvidenceRecord(existingRecord, limits.maxPositionCount);
        await authorize(info, request, action, [existingRecord.id]);
        checkCancellation(signal);
        authorizeCurrent(info, request, action, [existingRecord.id]);
        checkCancellation(signal);
        const finalNow = currentTime();
        if (existingRecord.expiresAtMs <= finalNow) fail('EVIDENCE_EXPIRED');
        if (existingRecord.expiresAtMs > retention.expiresAtMs) fail('EVIDENCE_DENIED');
        const databasePath = path.join(directory, 'evidence.sqlite');
        let database;
        let transactionOpen = false;
        try {
          const before = lstatSync(databasePath);
          if (before.isSymbolicLink() || !before.isFile()) fail('EVIDENCE_STORAGE');
          database = new DatabaseSync(databasePath, { timeout: limits.lockTimeoutMs });
          const after = lstatSync(databasePath);
          if (after.isSymbolicLink() || !after.isFile() || before.dev !== after.dev || before.ino !== after.ino) fail('EVIDENCE_STORAGE');
          database.exec('PRAGMA trusted_schema = OFF; BEGIN IMMEDIATE');
          transactionOpen = true;
          // DatabaseSync may block while another process owns the write lock.
          // Re-evaluate the privacy deadline only after acquiring that lock.
          checkCancellation(signal);
          if (existingRecord.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
          const currentRow = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(info.tenantHash);
          if ((currentRow?.document ?? null) !== snapshot.document) fail('EVIDENCE_BUSY');
          const bundleCount = Number(database.prepare('SELECT COUNT(*) AS count FROM sealed_bundles WHERE kind = ? AND id = ?').get('evidence', existingRecord.id).count);
          if (bundleCount !== 1) fail('EVIDENCE_EXPIRED');
          checkCancellation(signal);
          if (existingRecord.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
          database.exec('COMMIT');
          transactionOpen = false;
        } catch (error) {
          if (transactionOpen) { try { database.exec('ROLLBACK'); } catch { /* rollback on close */ } }
          if (error?.errcode === 5 || error?.errcode === 6 || error?.code === 'ERR_SQLITE_BUSY') fail('EVIDENCE_BUSY');
          throw error;
        } finally {
          database?.close();
        }
        checkCancellation(signal);
        if (existingRecord.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
        return Object.freeze({
          outcome: 'stored', evidence: newEvidenceHandle(info, existingRecord.id),
          positions: Object.freeze(existingSnapshot.positionIds.map((id) => newPositionHandle(info, existingRecord.id, id, input.sourceKind, PDF_DERIVED_REPRESENTATION))),
          created: false, metadata: frozenMetadata(existingSnapshot),
        });
      }

      const activeFamily = family;
      const latestId = activeFamily?.recordIds.at(-1);
      const latest = latestId ? manifest.records[latestId] : null;
      const evidenceId = randomUUID();
      payloadKey = await resolveKey(info, 'payload');
      sealedBytes = encodeSealedPayload(info.tenantHash, evidenceId, 'evidence', serialized, payloadKey.keyId, payloadKey.key);
      await authorize(info, request, action, [evidenceId]);
      checkCancellation(signal);
      authorizeCurrent(info, request, action, [evidenceId]);
      checkCancellation(signal);
      const finalNow = currentTime();
      if (retention.expiresAtMs <= finalNow) fail('EVIDENCE_EXPIRED');
      const nowIso = new Date(finalNow).toISOString();
      const version = activeFamily ? (activeFamily.versionCount ?? activeFamily.recordIds.length) + 1 : 1;
      const familyId = activeFamily?.id ?? randomUUID();
      const record = {
        id: evidenceId,
        version,
        previousId: latest?.id ?? null,
        contentHash: sourceContentHash,
        duplicateGroupId: digest(Buffer.from(`event-intelligence:duplicate:v1:${info.tenantHash}:${sourceContentHash}`, 'utf8')),
        retrievedAt: input.retrievedAt,
        createdAt: nowIso,
        createdAtMs: finalNow,
        retrievedAtMs,
        expiresAtMs: retention.expiresAtMs,
        policyId: retention.policyId,
        policyVersion: retention.policyVersion,
        state: 'available',
        encryptionKeyId: payloadKey.keyId,
        positionIds,
        positionHashes,
        representation: PDF_DERIVED_REPRESENTATION,
        derivationDigest,
      };

      const databasePath = path.join(directory, 'evidence.sqlite');
      let database;
      let transactionOpen = false;
      try {
        const before = lstatSync(databasePath);
        if (before.isSymbolicLink() || !before.isFile()) fail('EVIDENCE_STORAGE');
        database = new DatabaseSync(databasePath, { timeout: limits.lockTimeoutMs });
        const after = lstatSync(databasePath);
        if (after.isSymbolicLink() || !after.isFile() || before.dev !== after.dev || before.ino !== after.ino) fail('EVIDENCE_STORAGE');
        database.exec('PRAGMA trusted_schema = OFF; BEGIN IMMEDIATE');
        transactionOpen = true;
        // A busy timeout can consume most or all of the remaining retention
        // period. The earlier authorization/preparation timestamp is not a
        // valid basis for a write after this synchronous lock acquisition.
        checkCancellation(signal);
        if (retention.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
        const currentRow = database.prepare('SELECT document FROM evidence_manifest WHERE tenant_hash = ?').get(info.tenantHash);
        if ((currentRow?.document ?? null) !== snapshot.document) fail('EVIDENCE_BUSY');
        const currentManifest = snapshot.document === null
          ? emptyManifest(info.tenantHash)
          : validateManifest(JSON.parse(currentRow.document), info.tenantHash);
        if (currentManifest.records[evidenceId]) fail('EVIDENCE_BUSY');
        currentManifest.schemaVersion = PDF_DERIVED_BUNDLE_VERSION;
        currentManifest.records[evidenceId] = record;
        let currentFamily = activeFamily ? currentManifest.families[activeFamily.id] : null;
        if (activeFamily && !currentFamily) fail('EVIDENCE_BUSY');
        if (!currentFamily) {
          currentFamily = {
            id: familyId,
            representation: PDF_DERIVED_REPRESENTATION,
            sourceKeyId: activeIndexKey.keyId,
            sourceKeyHmac: currentFamilyHmac,
            versionCount: 0,
            recordIds: [],
          };
          currentManifest.families[familyId] = currentFamily;
        }
        if (currentFamily.representation !== PDF_DERIVED_REPRESENTATION) fail('EVIDENCE_INTEGRITY');
        currentFamily.recordIds.push(evidenceId);
        currentFamily.versionCount = version;
        const document = JSON.stringify(currentManifest);
        if (Buffer.byteLength(document, 'utf8') > 16 * 1024 * 1024) fail('EVIDENCE_STORAGE');
        database.prepare('INSERT INTO sealed_bundles (kind, id, sealed) VALUES (?, ?, ?)').run('evidence', evidenceId, sealedBytes);
        database.prepare(`INSERT INTO evidence_manifest (tenant_hash, document) VALUES (?, ?)
          ON CONFLICT (tenant_hash) DO UPDATE SET document = excluded.document`).run(info.tenantHash, document);
        // The same synchronous store clock is checked after payload and
        // manifest work, immediately before commit, so an expiring wait or
        // write cannot publish a record past its already-authorized deadline.
        checkCancellation(signal);
        if (retention.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
        database.exec('COMMIT');
        transactionOpen = false;
      } catch (error) {
        if (transactionOpen) { try { database.exec('ROLLBACK'); } catch { /* rollback on close */ } }
        if (error?.errcode === 5 || error?.errcode === 6 || error?.code === 'ERR_SQLITE_BUSY') fail('EVIDENCE_BUSY');
        throw error;
      } finally {
        database?.close();
      }
      checkCancellation(signal);
      if (retention.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
      return Object.freeze({
        outcome: 'stored', evidence: newEvidenceHandle(info, evidenceId),
        positions: Object.freeze(positions.map((position) => newPositionHandle(info, evidenceId, position.id, input.sourceKind, PDF_DERIVED_REPRESENTATION))),
        created: true, metadata: frozenMetadata(record),
      });
    } catch (error) {
      if (error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED') {
        if (directoryForCleanup) {
          try { await persistExpirySweep(info, directoryForCleanup); } catch (cleanupError) { throw safePublicError(cleanupError); }
        }
      }
      throw safePublicError(error);
    } finally {
      sourceBytes.fill(0);
      for (const position of positions) position.bytes.fill(0);
      sealedBytes?.fill(0);
      activeIndexKey?.key.fill(0);
      payloadKey?.key.fill(0);
      for (const key of historicalIndexKeys) key.fill(0);
    }
  }

  async function lookupEvidence(scope, evidenceId) {
    const info = scopeInfo(scope);
    if (!validUuid(evidenceId)) fail('EVIDENCE_NOT_FOUND');
    const directory = await tenantDirectory(info);
    try {
      return await withExpiryAwareTenantLock(info, directory, async (database) => {
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
      return await withExpiryAwareTenantLock(info, directory, async (database) => {
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
    return materializeSelectedInternal(
      scope,
      { evidence: [handle], facts: [] },
      request,
      undefined,
      'list_evidence_positions',
      'positions',
    );
  }

  async function withPrivatePayload(scope, handle, request) {
    const info = evidenceInfo(scope, handle);
    if (typeof config.consumePrivatePayload !== 'function') fail('EVIDENCE_DENIED');
    const directory = await tenantDirectory(info);
    const budget = newMaterializationBudget();
    let snapshot;
    let bundle;
    let finalVerifier;
    let positions = [];
    try {
      snapshot = await withExpiryAwareTenantLock(info, directory, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        await expireRecords(database, manifest, currentTime());
        const record = manifest.records[info.evidenceId];
        if (!record) fail('EVIDENCE_NOT_FOUND');
        if (record.state !== 'available') fail('EVIDENCE_EXPIRED');
        const copied = copyEvidenceRecord(record, Math.min(limits.maxPositionCount, SELECTED_BATCH_LIMITS.positionCount), budget);
        const sealed = readSealedBundle(database, 'evidence', record.id);
        if (copied.expiresAtMs <= currentTime()) fail('EVIDENCE_EXPIRED');
        return { ...copied, sealed, budget };
      });
      await authorize(info, request, 'read_private_evidence', [info.evidenceId]);
      bundle = await decryptSealedBundle(info, info.evidenceId, 'evidence', snapshot.sealed, snapshot.encryptionKeyId, resolveKey, budget);
      const view = materializeEvidenceBundle(info, snapshot, bundle, budget);
      let privatePayloadBytes = 0;
      positions = bundle.positions.map((position) => {
        const contentBytes = base64DecodedByteLength(position.content);
        privatePayloadBytes += contentBytes;
        if (!Number.isSafeInteger(privatePayloadBytes)
          || privatePayloadBytes > Math.min(limits.maxStoredPayloadBytes, SELECTED_BATCH_LIMITS.evidencePositionBytes)) fail('EVIDENCE_INVALID');
        return Object.freeze({
          locator: deepFreeze(cloneJsonValue(position.locator)),
          contentHash: position.contentHash,
          content: Buffer.from(position.content, 'base64'),
        });
      });
      finalVerifier = makeFinalStateVerifier(info, directory, [info.evidenceId], []);
      authorizeCurrent(info, request, 'read_private_evidence', [info.evidenceId]);
      finalVerifier.check({ evidence: [snapshot], facts: [] });
      if (currentTime() >= snapshot.expiresAtMs) fail('EVIDENCE_EXPIRED');
      let consumed;
      try {
        consumed = config.consumePrivatePayload(Object.freeze({
          tenantId: info.tenantId,
          evidenceId: info.evidenceId,
          metadata: frozenMetadata(snapshot),
          source: view.source,
          positions: Object.freeze(positions),
          request,
        }));
      } catch {
        fail('EVIDENCE_DENIED');
      }
      if (utilTypes.isPromise(consumed)) {
        observeNativeRejectedPromise(consumed);
        fail('EVIDENCE_DENIED');
      }
      try {
        consumed = copySynchronousConsumerResult(consumed);
      } catch {
        fail('EVIDENCE_DENIED');
      }
      // The trusted consumer is synchronous, but it can reenter the host and
      // mutate the request or the persisted record. Revalidate before returning
      // its result, with no awaited work or write transaction held.
      authorizeCurrent(info, request, 'read_private_evidence', [info.evidenceId]);
      finalVerifier.check({ evidence: [snapshot], facts: [] });
      if (currentTime() >= snapshot.expiresAtMs) fail('EVIDENCE_EXPIRED');
      return consumed;
    } catch (error) {
      if (error instanceof EvidenceStoreError && error.code === 'EVIDENCE_EXPIRED') {
        try { await persistExpirySweep(info, directory); } catch (cleanupError) { throw safePublicError(cleanupError); }
      } else if (!(error instanceof EvidenceStoreError)) {
        try { await persistExpirySweep(info, directory); } catch (cleanupError) { throw safePublicError(cleanupError); }
      }
      throw safePublicError(error);
    } finally {
      for (const position of positions) position.content.fill(0);
      snapshot?.sealed.fill(0);
      if (bundle) wipePrivateTree(bundle);
      finalVerifier?.close();
    }
  }

  async function parseFactInput(inputValue) {
    const allowed = new Set(['field', 'status', 'rawValue', 'normalizedValue', 'precision', 'supports', 'method', 'reason', 'candidates']);
    const input = ownDataRecord(inputValue, allowed);
    if (!input || typeof input.field !== 'string' || !FACT_STATUSES.has(input.status)) fail('EVIDENCE_INVALID');
    const field = validateFactField(input.field);
    const valueBudget = { nodes: 0, bytes: 0, maximumBytes: SELECTED_BATCH_LIMITS.factRecordBytes };
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
        const value = extractValue(item, valueBudget);
        const method = validateMethod(item.method, item.originStatus === 'inferred');
        const supports = extractSupports(item.supports);
        if (supports.length === 0) fail('EVIDENCE_INVALID');
        return { originStatus: item.originStatus, ...value, method, supports };
      });
      return { field, status: 'conflicting', candidates: parsedCandidates };
    }
    if (Object.hasOwn(input, 'reason') || Object.hasOwn(input, 'candidates')) fail('EVIDENCE_INVALID');
    const value = extractValue(input, valueBudget);
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
        || evidence.evidenceId !== position.evidenceId || position.representation !== 'raw'
        || !isDigest(support.contentHash)) fail('EVIDENCE_INVALID');
      return { support, evidenceId: evidence.evidenceId, positionId: position.positionId, sourceKind: position.sourceKind };
    });
    const evidenceIds = supportRefs.map((reference) => reference.evidenceId);
    await authorize(info, request, 'validate_fact_support', evidenceIds);
    const directory = await tenantDirectory(info);
    try {
      return await withExpiryAwareTenantLock(info, directory, async (database) => {
        const manifest = await readManifest(database, info.tenantHash);
        const nowMs = currentTime();
        await expireRecords(database, manifest, nowMs);
        for (const reference of supportRefs) {
          const record = manifest.records[reference.evidenceId];
          if (!record) fail('EVIDENCE_INVALID');
          if (record.state !== 'available' || record.expiresAtMs <= nowMs) fail('EVIDENCE_EXPIRED');
          if (record.representation !== undefined) fail('EVIDENCE_INVALID');
          if (reference.support.contentHash !== record.contentHash) fail('EVIDENCE_INVALID');
          if (!record.positionIds.includes(reference.positionId)) fail('EVIDENCE_INVALID');
          const bundle = await decryptBundle(info, record.id, 'evidence', database, record.encryptionKeyId);
          if (currentTime() >= record.expiresAtMs) fail('EVIDENCE_EXPIRED');
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
        const retentionCheck = currentTime();
        if (factRetention.expiresAtMs <= retentionCheck
          || supportingRecords.some((record) => record.state !== 'available' || record.expiresAtMs <= retentionCheck)) fail('EVIDENCE_EXPIRED');
        const factId = randomUUID();
        const normalized = serializeFactForStorage(parsed, supportRefs);
        const sealed = await encryptBundle(info, factId, 'fact', normalized);
        const beforeInsert = currentTime();
        if (factRetention.expiresAtMs <= beforeInsert
          || supportingRecords.some((record) => record.state !== 'available' || record.expiresAtMs <= beforeInsert)) fail('EVIDENCE_EXPIRED');
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
        const beforeManifest = currentTime();
        if (factRetention.expiresAtMs <= beforeManifest
          || supportingRecords.some((record) => record.state !== 'available' || record.expiresAtMs <= beforeManifest)) fail('EVIDENCE_EXPIRED');
        manifest.facts[factId] = factMetadata;
        await writeManifest(database, manifest);
        const beforeReturn = currentTime();
        if (factRetention.expiresAtMs <= beforeReturn
          || supportingRecords.some((record) => record.state !== 'available' || record.expiresAtMs <= beforeReturn)) fail('EVIDENCE_EXPIRED');
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
          rawValue: cloneJsonValue(candidate.rawValue),
          normalizedValue: cloneJsonValue(candidate.normalizedValue),
          ...(candidate.precision ? { precision: candidate.precision } : {}),
          ...(candidate.method ? { method: cloneJsonValue(candidate.method) } : {}),
          supports: candidate.supports.map(reviveSupport),
        })),
      });
    }
    return freezeFact({
      factId,
      field: stored.field,
      status: stored.status,
      rawValue: cloneJsonValue(stored.rawValue),
      normalizedValue: cloneJsonValue(stored.normalizedValue),
      ...(stored.precision ? { precision: stored.precision } : {}),
      ...(stored.method ? { method: cloneJsonValue(stored.method) } : {}),
      supports: stored.supports.map(reviveSupport),
    });
  }

  async function lookupFact(scope, factId) {
    const info = scopeInfo(scope);
    if (!validUuid(factId)) fail('EVIDENCE_NOT_FOUND');
    const directory = await tenantDirectory(info);
    try {
      return await withExpiryAwareTenantLock(info, directory, async (database) => {
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
    return materializeSelectedInternal(
      scope,
      { evidence: [], facts: [handle] },
      request,
      undefined,
      'read_fact',
      'fact',
      limits.maxPositionCount,
    );
  }

  async function listFacts(scope, request) {
    const info = scopeInfo(scope);
    const budget = newMaterializationBudget();
    const directory = await tenantDirectory(info);
    let snapshot;
    let finalVerifier;
    let factIds = [];
    let evidenceIds = [];
    try {
      snapshot = await withExpiryAwareTenantLock(info, directory, async (database) => {
        const facts = [];
        let transferred = false;
        try {
          const manifestPresentAtSnapshot = Boolean(database.prepare(
            'SELECT 1 AS present FROM evidence_manifest WHERE tenant_hash = ?',
          ).get(info.tenantHash));
          const manifest = await readManifest(database, info.tenantHash);
          await expireRecords(database, manifest, currentTime());
          const active = Object.values(manifest.facts).filter((fact) => fact.state === 'available');
          if (active.length > 1000) fail('EVIDENCE_INVALID');
          for (const fact of active) facts.push(copyFactRecord(fact, budget));
          const lengths = preflightSelectedSealedBundleLengths(database, 'fact', facts.map((fact) => fact.id), budget);
          copySelectedSealedBundles(database, 'fact', facts, lengths);
          const nowMs = currentTime();
          if (facts.some((fact) => fact.expiresAtMs <= nowMs)) fail('EVIDENCE_EXPIRED');
          transferred = true;
          return {
            facts,
            evidenceIds: [...new Set(facts.flatMap((fact) => fact.supportEvidenceIds))],
            budget,
            manifestPresentAtSnapshot,
          };
        } finally {
          if (!transferred) for (const fact of facts) fact.sealed?.fill(0);
        }
      });
      factIds = snapshot.facts.map((fact) => fact.id);
      evidenceIds = snapshot.evidenceIds;
    } catch (error) {
      throw safePublicError(error);
    }
    try {
      await authorize(info, request, 'list_facts', evidenceIds, factIds);
      const result = [];
      for (const fact of snapshot.facts) {
        const stored = await decryptSealedBundle(info, fact.id, 'fact', fact.sealed, fact.encryptionKeyId, resolveKey, snapshot.budget);
        try {
          collectFactSupports(fact, stored, snapshot.budget);
          result.push(publicFact(info, fact.id, stored));
        } finally {
          wipePrivateTree(stored);
        }
      }
      finalVerifier = makeFinalStateVerifier(info, directory, evidenceIds, factIds);
      authorizeCurrent(info, request, 'list_facts', evidenceIds, factIds);
      finalVerifier.check({
        evidence: [],
        facts: snapshot.facts,
        manifestPresentAtSnapshot: snapshot.manifestPresentAtSnapshot,
      });
      return deepFreeze(result);
    } catch (error) {
      try { await persistExpirySweep(info, directory); } catch (cleanupError) { throw safePublicError(cleanupError); }
      throw safePublicError(error);
    } finally {
      finalVerifier?.close();
      for (const fact of snapshot?.facts ?? []) fact.sealed.fill(0);
    }
  }

  async function purgeExpired(scope) {
    const info = scopeInfo(scope);
    const directory = await tenantDirectory(info);
    try {
      return await withExpiryAwareTenantLock(info, directory, async (database) => {
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
      return await withExpiryAwareTenantLock(info, directory, async (database) => {
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
    ingestDerivedPdfEvidence,
    lookupEvidence,
    getEvidenceMetadata,
    listEvidencePositions,
    materializeSelected,
    withPrivatePayload,
    appendFact,
    lookupFact,
    readFact,
    listFacts,
    purgeExpired,
    integritySnapshot,
  });
}
