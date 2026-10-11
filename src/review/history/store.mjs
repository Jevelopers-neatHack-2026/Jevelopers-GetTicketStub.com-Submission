import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { types as utilTypes } from 'node:util';
import { isCorrectionCacheBindingCapability } from './cache-binding-capability.mjs';
import { beginLocalBoundary, localBoundaryEffectiveNow, monotonicTimestampNs } from '../../private/boundary-guard.mjs';

const FIELD_TYPES = Object.freeze({
  event_name: 'text',
  event_date: 'date',
  venue: 'text',
  event_status: 'event_status',
});
const REQUIRED_FIELDS = Object.freeze(['event_name', 'event_date', 'venue']);
const FACT_STATES = new Set(['sourced', 'inferred', 'missing', 'conflicting']);
const SOURCE_STATES = new Set(['sourced', 'inferred']);
const EVENT_STATUSES = new Set(['scheduled', 'cancelled', 'postponed', 'rescheduled', 'completed']);
const ERROR_MESSAGES = Object.freeze({
  REVIEW_DENIED: 'correction history access denied',
  REVIEW_INVALID: 'invalid correction history input',
  REVIEW_NOT_FOUND: 'correction history not found',
  REVIEW_EXPIRED: 'correction history expired',
  REVIEW_BUSY: 'correction history is busy',
  REVIEW_INTEGRITY: 'correction history integrity check failed',
  REVIEW_KEY_UNAVAILABLE: 'correction history key unavailable',
  REVIEW_STORAGE: 'correction history storage failed',
  REVIEW_STORAGE_LIMIT: 'correction history storage limit reached',
  REVIEW_VERSION_CONFLICT: 'correction history version conflict',
  REVIEW_IDEMPOTENCY_CONFLICT: 'correction history idempotency conflict',
  REVIEW_ALREADY_EXISTS: 'correction history already exists',
  REVIEW_FIELD_NOT_ALLOWED: 'correction field is not allowed',
  REVIEW_FIELD_LOCKED: 'correction field is locked',
  REVIEW_REFERENCE_CONFLICT: 'downstream reference conflict',
  REVIEW_ABORTED: 'correction history operation cancelled',
});
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, Symbol.toStringTag).get;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'length').get;
const TYPED_ARRAY_SET = Uint8Array.prototype.set;
const TYPED_ARRAY_FILL = Uint8Array.prototype.fill;
const REFLECT_APPLY = Reflect.apply;
const UTIL_TYPES_IS_PROXY = utilTypes.isProxy;
const MAX_TIME = 8_640_000_000_000_000;
const MAX_VERSION_PLAINTEXT_BYTES = 512 * 1024;
const MAX_VERSION_SEALED_BYTES = 512 * 1024;
const TENANT_DATABASE_QUEUES = new Map();
const HISTORY_BINDING_PORTS = new WeakMap();
const ABORT_SIGNAL_ABORTED_GETTER = typeof AbortSignal === 'function'
  ? Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted')?.get
  : undefined;

export class ReviewHistoryError extends Error {
  constructor(code = 'REVIEW_STORAGE') {
    const validCode = typeof code === 'string' && Object.hasOwn(ERROR_MESSAGES, code);
    super(validCode ? ERROR_MESSAGES[code] : ERROR_MESSAGES.REVIEW_STORAGE);
    this.name = 'ReviewHistoryError';
    this.code = validCode ? code : 'REVIEW_STORAGE';
  }
}

function fail(code = 'REVIEW_INVALID') {
  throw new ReviewHistoryError(code);
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
    const output = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    return null;
  }
}

function safeArray(value, maximumLength) {
  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value')) return null;
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximumLength) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes('length') || keys.some((key) => key !== 'length'
      && (!Number.isSafeInteger(Number(key)) || String(Number(key)) !== key
        || Number(key) < 0 || Number(key) >= length))) return null;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      output.push(descriptor.value);
    }
    return output;
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
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value).digest('hex');
}

function asKeyBytes(value) {
  try {
    if (TYPED_ARRAY_TAG_GETTER.call(value) !== 'Uint8Array') fail('REVIEW_KEY_UNAVAILABLE');
    const length = TYPED_ARRAY_LENGTH_GETTER.call(value);
    if (length !== 32) fail('REVIEW_KEY_UNAVAILABLE');
    const copy = new Uint8Array(length);
    TYPED_ARRAY_SET.call(copy, value);
    return Buffer.from(copy.buffer, copy.byteOffset, copy.byteLength);
  } catch (error) {
    if (error instanceof ReviewHistoryError) throw error;
    fail('REVIEW_KEY_UNAVAILABLE');
  }
}

function validSafeString(value, minimum, maximum) {
  return typeof value === 'string' && value.length >= minimum && value.length <= maximum
    && isWellFormed(value) && !/[\u0000-\u001f\u007f]/u.test(value);
}

function validateEventId(value) {
  if (!validSafeString(value, 1, 180) || value.trim() !== value) fail();
  return value;
}

function validateIdentifier(value, maximum = 180) {
  if (!validSafeString(value, 1, maximum) || value.trim() !== value) fail();
  return value;
}

function validDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function utcMilliseconds(year, month, day, hour, minute, second = 0) {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function localParts(formatter, epochMs) {
  const values = Object.create(null);
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (part.type !== 'literal') values[part.type] = Number(part.value);
  }
  return values;
}

function localDateTimeExists(value, timeZone) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const target = {
    year: Number(yearText), month: Number(monthText), day: Number(dayText),
    hour: Number(hourText), minute: Number(minuteText), second: 0,
  };
  const naiveEpoch = utcMilliseconds(target.year, target.month, target.day, target.hour, target.minute);
  try {
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    const offsets = new Set();
    // Sample both sides of nearby transitions. Candidate instants are accepted
    // only when the zone formats them back to the exact requested wall time.
    for (let offsetHours = -48; offsetHours <= 48; offsetHours += 3) {
      const sampleEpoch = naiveEpoch + offsetHours * 60 * 60 * 1000;
      const parts = localParts(formatter, sampleEpoch);
      if (!Number.isInteger(parts.year) || !Number.isInteger(parts.month) || !Number.isInteger(parts.day)
        || !Number.isInteger(parts.hour) || !Number.isInteger(parts.minute) || !Number.isInteger(parts.second)) return false;
      const renderedEpoch = utcMilliseconds(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second);
      offsets.add(renderedEpoch - sampleEpoch);
    }
    for (const offset of offsets) {
      const candidateEpoch = naiveEpoch - offset;
      const parts = localParts(formatter, candidateEpoch);
      if (parts.year === target.year && parts.month === target.month && parts.day === target.day
        && parts.hour === target.hour && parts.minute === target.minute && parts.second === 0) return true;
    }
    return false;
  } catch {
    return false;
  }
}

function validateDateValue(value) {
  const input = ownDataRecord(value, new Set(['precision', 'value', 'timeZone']));
  if (!input || typeof input.precision !== 'string' || typeof input.value !== 'string') fail();
  if (input.precision === 'date') {
    if (Object.hasOwn(input, 'timeZone') || !validDate(input.value)) fail();
    return Object.freeze({ precision: 'date', value: input.value });
  }
  if (input.precision === 'local_datetime') {
    const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(input.value);
    if (!match || !validDate(match[1]) || typeof input.timeZone !== 'string'
      || input.timeZone.length > 100 || !isWellFormed(input.timeZone)
      || !localDateTimeExists(input.value, input.timeZone)) fail();
    return Object.freeze({ precision: 'local_datetime', value: input.value, timeZone: input.timeZone });
  }
  if (input.precision === 'instant') {
    if (Object.hasOwn(input, 'timeZone')
      || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?Z$/.test(input.value)
      || !Number.isFinite(Date.parse(input.value))) fail();
    const datePart = input.value.slice(0, 10);
    if (!validDate(datePart)) fail();
    return Object.freeze({ precision: 'instant', value: input.value });
  }
  fail();
}

function validateFieldValue(field, value) {
  if (field === 'event_date') return validateDateValue(value);
  if (field === 'event_status') {
    if (typeof value !== 'string' || !EVENT_STATUSES.has(value)) fail();
    return value;
  }
  if (field === 'event_name') {
    if (!validSafeString(value, 1, 240) || value.trim() !== value) fail();
    return value;
  }
  if (field === 'venue') {
    if (!validSafeString(value, 1, 400) || value.trim() !== value) fail();
    return value;
  }
  fail('REVIEW_FIELD_NOT_ALLOWED');
}

function fieldKey(value, allowedFields) {
  if (typeof value !== 'string' || !Object.hasOwn(FIELD_TYPES, value) || !allowedFields.has(value)) {
    fail('REVIEW_FIELD_NOT_ALLOWED');
  }
  return value;
}

function evidenceReferences(value) {
  const entries = safeArray(value, 32);
  if (!entries) fail();
  const refs = entries.map((entry) => {
    const ref = ownDataRecord(entry, new Set(['evidenceId', 'contentHash']));
    if (!ref || !validSafeString(ref.evidenceId, 1, 180)
      || typeof ref.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(ref.contentHash)) fail();
    return Object.freeze({ evidenceId: ref.evidenceId, contentHash: ref.contentHash });
  });
  const seen = new Set();
  for (const ref of refs) {
    const key = `${ref.evidenceId}\u0000${ref.contentHash}`;
    if (seen.has(key)) fail();
    seen.add(key);
  }
  return refs.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)
    || left.contentHash.localeCompare(right.contentHash));
}

function sourceFact(value, field) {
  const input = ownDataRecord(value, new Set(['status', 'value', 'sourceEvidence', 'candidates']));
  if (!input || typeof input.status !== 'string' || !FACT_STATES.has(input.status)) fail();
  if (input.status === 'missing') {
    if (Object.keys(input).length !== 1) fail();
    return { status: 'missing', claims: [] };
  }
  if (input.status === 'conflicting') {
    if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'candidates')) fail();
    const candidates = safeArray(input.candidates, 32);
    if (!candidates || candidates.length < 2) fail();
    const claims = candidates.map((candidateValue) => {
      const candidate = ownDataRecord(candidateValue, new Set(['originStatus', 'value', 'sourceEvidence']));
      if (!candidate || !SOURCE_STATES.has(candidate.originStatus) || !Object.hasOwn(candidate, 'value')) fail();
      const sourceEvidence = evidenceReferences(candidate.sourceEvidence);
      if (sourceEvidence.length === 0) fail();
      return {
        originStatus: candidate.originStatus,
        value: validateFieldValue(field, candidate.value),
        sourceEvidence,
      };
    });
    claims.sort((left, right) => canonical(left).localeCompare(canonical(right)));
    return { status: 'conflicting', claims };
  }
  if (!Object.hasOwn(input, 'value') || !Object.hasOwn(input, 'sourceEvidence')
    || Object.keys(input).length !== 3 || !SOURCE_STATES.has(input.status)) fail();
  const sourceEvidence = evidenceReferences(input.sourceEvidence);
  if (sourceEvidence.length === 0) fail();
  return {
    status: input.status,
    claims: [{
      originStatus: input.status,
      value: validateFieldValue(field, input.value),
      sourceEvidence,
    }],
  };
}

function sourceFacts(value, allowedFields) {
  const input = ownDataRecord(value, new Set(Object.keys(FIELD_TYPES)));
  if (!input) fail();
  const output = Object.create(null);
  for (const field of Object.keys(FIELD_TYPES)) {
    if (Object.hasOwn(input, field)) output[field] = sourceFact(input[field], field);
  }
  for (const field of Object.keys(output)) fieldKey(field, allowedFields);
  return output;
}

function validateRetentionDecision(value, nowMs, upperBoundMs, maximumRetentionMs) {
  const decision = ownDataRecord(value, new Set(['expiresAtMs', 'policyId', 'policyVersion', 'accessPolicy']));
  if (!decision || !Number.isSafeInteger(decision.expiresAtMs) || decision.expiresAtMs <= nowMs
    || decision.expiresAtMs > nowMs + maximumRetentionMs
    || (Number.isSafeInteger(upperBoundMs) && decision.expiresAtMs > upperBoundMs)
    || !validSafeString(decision.policyId, 1, 120)
    || !validSafeString(decision.policyVersion, 1, 64)
    || decision.accessPolicy !== 'tenant_private') fail('REVIEW_DENIED');
  return Object.freeze({
    expiresAtMs: decision.expiresAtMs,
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    accessPolicy: 'tenant_private',
  });
}

function validateKeyResult(value, requestedKeyId) {
  const key = ownDataRecord(value, new Set(['keyId', 'key']));
  if (!key || !validSafeString(key.keyId, 1, 128) || !/^[A-Za-z0-9._-]+$/.test(key.keyId)
    || (requestedKeyId !== undefined && key.keyId !== requestedKeyId)) fail('REVIEW_KEY_UNAVAILABLE');
  const keyBytes = asKeyBytes(key.key);
  try { TYPED_ARRAY_FILL.call(key.key, 0); } catch { /* Resolver-owned immutable buffers are outside this module's control. */ }
  return { keyId: key.keyId, key: keyBytes };
}

function seal(info, id, kind, keyId, keyBytes, document) {
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyBytes, iv);
    cipher.setAAD(Buffer.from(`event-intelligence:review-history:v1:${info.tenantHash}:${kind}:${id}`, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(canonical(document), 'utf8'), cipher.final()]);
    return Buffer.from(JSON.stringify({
      version: 1,
      keyId,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    }), 'utf8');
  } catch {
    fail('REVIEW_STORAGE');
  }
}

function openSealed(info, id, kind, expectedKeyId, keyBytes, sealedBytes) {
  let envelope;
  try { envelope = JSON.parse(Buffer.from(sealedBytes).toString('utf8')); } catch { fail('REVIEW_INTEGRITY'); }
  const value = ownDataRecord(envelope, new Set(['version', 'keyId', 'iv', 'tag', 'ciphertext']));
  if (!value || value.version !== 1 || value.keyId !== expectedKeyId
    || typeof value.iv !== 'string' || typeof value.tag !== 'string' || typeof value.ciphertext !== 'string') fail('REVIEW_INTEGRITY');
  try {
    const decipher = createDecipheriv('aes-256-gcm', keyBytes, Buffer.from(value.iv, 'base64'));
    decipher.setAAD(Buffer.from(`event-intelligence:review-history:v1:${info.tenantHash}:${kind}:${id}`, 'utf8'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(plaintext);
  } catch {
    fail('REVIEW_INTEGRITY');
  }
}

function mapStorageError(error) {
  try {
    if (error instanceof ReviewHistoryError) return error;
    const errcode = error && (typeof error === 'object' || typeof error === 'function')
      ? Object.getOwnPropertyDescriptor(error, 'errcode') : undefined;
    const code = error && (typeof error === 'object' || typeof error === 'function')
      ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    if ((errcode && Object.hasOwn(errcode, 'value') && (errcode.value === 5 || errcode.value === 6))
      || (code && Object.hasOwn(code, 'value') && code.value === 'ERR_SQLITE_BUSY')) return new ReviewHistoryError('REVIEW_BUSY');
  } catch { /* Untrusted thrown values are converted to the fixed public storage error. */ }
  return new ReviewHistoryError('REVIEW_STORAGE');
}

function mapBindingCallbackError(error) {
  try {
    if (error && (typeof error === 'object' || typeof error === 'function')) {
      const name = Object.getOwnPropertyDescriptor(error, 'name');
      const code = Object.getOwnPropertyDescriptor(error, 'code');
      if (name?.value === 'ScopedReuseError' && typeof code?.value === 'string'
        && ['REUSE_DENIED', 'REUSE_INVALID', 'REUSE_NOT_FOUND', 'REUSE_BUSY', 'REUSE_STORAGE',
          'REUSE_INTEGRITY', 'REUSE_KEY_UNAVAILABLE', 'REUSE_CAPACITY', 'REUSE_POLICY_UNAVAILABLE'].includes(code.value)) return error;
    }
  } catch { /* Convert untrusted thrown values to the fixed history storage error. */ }
  return mapStorageError(error);
}

function createOpaque() {
  return Object.freeze(Object.create(null));
}

function abortableWait(promise, signal) {
  if (signal === undefined) return promise;
  throwIfAborted(signal);
  let abort;
  const aborted = new Promise((resolve, reject) => {
    abort = () => reject(new ReviewHistoryError('REVIEW_ABORTED'));
    signal.addEventListener('abort', abort, { once: true });
  });
  return Promise.race([promise, aborted]).finally(() => signal.removeEventListener('abort', abort));
}

async function withTenantDatabaseQueue(directory, operation, signal = undefined) {
  const previous = TENANT_DATABASE_QUEUES.get(directory) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  TENANT_DATABASE_QUEUES.set(directory, current);
  const ready = previous.catch(() => {});
  let acquired = false;
  try {
    await abortableWait(ready, signal);
    throwIfAborted(signal);
    acquired = true;
    return await operation();
  } finally {
    if (acquired) {
      release();
      if (TENANT_DATABASE_QUEUES.get(directory) === current) TENANT_DATABASE_QUEUES.delete(directory);
    } else {
      ready.finally(() => {
        release();
        if (TENANT_DATABASE_QUEUES.get(directory) === current) TENANT_DATABASE_QUEUES.delete(directory);
      });
    }
  }
}

function readAborted(signal) {
  if (typeof ABORT_SIGNAL_ABORTED_GETTER !== 'function') fail();
  try {
    // Node 22's native getter reads AbortSignal state through reflectable symbols.
    // Reject proxies first because their get traps can hide an actual abort.
    if (UTIL_TYPES_IS_PROXY(signal)) fail();
    return REFLECT_APPLY(ABORT_SIGNAL_ABORTED_GETTER, signal, []);
  } catch {
    fail();
  }
}

function readSignal(options) {
  if (options === undefined) return undefined;
  const input = ownDataRecord(options, new Set(['signal']));
  if (!input) fail();
  if (input.signal === undefined) return undefined;
  readAborted(input.signal);
  return input.signal;
}

function throwIfAborted(signal) {
  if (signal !== undefined && readAborted(signal)) fail('REVIEW_ABORTED');
}

function fieldView(field, record) {
  const claims = record.sourceClaims;
  const groups = new Map();
  for (const claim of claims) {
    const key = canonical(claim.value);
    let group = groups.get(key);
    if (!group) {
      group = { value: claim.value, originStatus: claim.originStatus, sourceEvidence: new Map(), latestSourceRevision: claim.sourceRevision };
      groups.set(key, group);
    }
    if (claim.originStatus === 'sourced') group.originStatus = 'sourced';
    group.latestSourceRevision = Math.max(group.latestSourceRevision, claim.sourceRevision);
    for (const ref of claim.sourceEvidence) group.sourceEvidence.set(`${ref.evidenceId}\u0000${ref.contentHash}`, ref);
  }
  const candidates = [...groups.values()].map((group) => ({
    value: group.value,
    originStatus: group.originStatus,
    sourceEvidence: [...group.sourceEvidence.values()].sort((left, right) => left.evidenceId.localeCompare(right.evidenceId)
      || left.contentHash.localeCompare(right.contentHash)),
    latestSourceRevision: group.latestSourceRevision,
  })).sort((left, right) => canonical(left.value).localeCompare(canonical(right.value)));
  const output = {
    field,
    status: 'missing',
    sourceClaims: claims,
    correctionHistory: record.correctionHistory,
    ...(record.currentCorrection ? { currentCorrection: record.currentCorrection } : {}),
  };
  if (record.currentCorrection) {
    output.status = 'customer_supplied';
    output.value = record.currentCorrection.value;
    output.sourceCandidates = candidates;
    output.disagreements = candidates.filter((candidate) => canonical(candidate.value) !== canonical(output.value));
    return output;
  }
  if (candidates.length === 1) {
    output.status = candidates[0].originStatus;
    output.value = candidates[0].value;
    output.sourceEvidence = candidates[0].sourceEvidence;
  } else if (candidates.length > 1) {
    output.status = 'conflicting';
    output.candidates = candidates;
  }
  return output;
}

function buildQuestions(eventKey, fieldViews, indexKey) {
  const questions = [];
  for (const field of REQUIRED_FIELDS) {
    const view = fieldViews[field];
    if (view.status === 'missing') {
      questions.push({
        id: `q_${hmac(indexKey, `missing:${eventKey}:${field}`).slice(0, 24)}`,
        code: 'MISSING_REQUIRED_FACT',
        field,
        expectedType: FIELD_TYPES[field],
        state: 'open',
        sourceEvidence: [],
      });
    }
  }
  for (const field of Object.keys(FIELD_TYPES)) {
    const view = fieldViews[field];
    if (view.status === 'conflicting') {
      const signature = view.candidates.map(({ value, originStatus, sourceEvidence }) => ({ value, originStatus, sourceEvidence }));
      const latestSourceRevision = Math.max(...view.candidates.map((candidate) => candidate.latestSourceRevision));
      const answered = view.currentCorrection && view.currentCorrection.revision > latestSourceRevision;
      questions.push({
        id: `q_${hmac(indexKey, `conflict:${eventKey}:${field}:${canonical(signature)}`).slice(0, 24)}`,
        code: 'CONFLICTING_SOURCE_FACTS',
        field,
        expectedType: FIELD_TYPES[field],
        state: answered ? 'answered_customer_supplied' : 'open',
        candidates: view.candidates,
        sourceEvidence: [...new Map(view.candidates.flatMap((candidate) => candidate.sourceEvidence)
          .map((ref) => [`${ref.evidenceId}\u0000${ref.contentHash}`, ref])).values()],
      });
    }
    if (view.status === 'customer_supplied' && view.sourceCandidates?.length > 1) {
      const signature = view.sourceCandidates.map(({ value, originStatus, sourceEvidence }) => ({ value, originStatus, sourceEvidence }));
      const latestSourceRevision = Math.max(...view.sourceCandidates.map((candidate) => candidate.latestSourceRevision));
      const answered = view.currentCorrection && view.currentCorrection.revision > latestSourceRevision;
      questions.push({
        id: `q_${hmac(indexKey, `conflict:${eventKey}:${field}:${canonical(signature)}`).slice(0, 24)}`,
        code: 'CONFLICTING_SOURCE_FACTS',
        field,
        expectedType: FIELD_TYPES[field],
        state: answered ? 'answered_customer_supplied' : 'open',
        candidates: view.sourceCandidates,
        sourceEvidence: [...new Map(view.sourceCandidates.flatMap((candidate) => candidate.sourceEvidence)
          .map((ref) => [`${ref.evidenceId}\u0000${ref.contentHash}`, ref])).values()],
      });
    }
    if (view.status === 'customer_supplied' && view.disagreements?.length > 0) {
      const lateDisagreements = view.disagreements.filter((candidate) => candidate.latestSourceRevision
        > view.currentCorrection.revision);
      if (lateDisagreements.length > 0) {
        const signature = lateDisagreements.map(({ value, originStatus, sourceEvidence }) => ({ value, originStatus, sourceEvidence }));
        questions.push({
          id: `q_${hmac(indexKey, `refresh-conflict:${eventKey}:${field}:${canonical(signature)}`).slice(0, 24)}`,
          code: 'SOURCE_REFRESH_REVIEW',
          field,
          expectedType: FIELD_TYPES[field],
          state: 'open',
          candidates: lateDisagreements,
          sourceEvidence: [...new Map(lateDisagreements.flatMap((candidate) => candidate.sourceEvidence)
            .map((ref) => [`${ref.evidenceId}\u0000${ref.contentHash}`, ref])).values()],
        });
      }
    }
  }
  return questions.sort((left, right) => left.field.localeCompare(right.field) || left.code.localeCompare(right.code));
}

function materialProjection(fieldViews, questions) {
  const fields = Object.create(null);
  for (const field of Object.keys(FIELD_TYPES)) {
    const view = fieldViews[field];
    fields[field] = {
      status: view.status,
      ...(Object.hasOwn(view, 'value') ? { value: view.value } : {}),
      sourceClaims: view.sourceClaims.map((claim) => ({
        originStatus: claim.originStatus,
        value: claim.value,
        sourceEvidence: claim.sourceEvidence,
        sourceRevision: claim.sourceRevision,
      })),
      ...(view.disagreements ? { disagreements: view.disagreements } : {}),
    };
  }
  return { fields, questions };
}

function buildSnapshot({ eventId, eventKey, revision, parentVersionId, createdAt, retention, state, invalidations, indexKey }) {
  const fields = Object.create(null);
  for (const field of Object.keys(FIELD_TYPES)) fields[field] = fieldView(field, state.fields[field]);
  const questions = buildQuestions(eventKey, fields, indexKey);
  const materialHash = sha256(canonical(materialProjection(fields, questions)));
  const snapshot = {
    schemaVersion: 1,
    eventId,
    revision,
    versionId: randomUUID(),
    parentVersionId,
    createdAt,
    expiresAt: new Date(retention.expiresAtMs).toISOString(),
    retentionPolicy: { id: retention.policyId, version: retention.policyVersion },
    fields,
    questions,
    invalidations,
    materialHash,
  };
  snapshot.contentHash = sha256(canonical(snapshot));
  if (Buffer.byteLength(canonical(snapshot), 'utf8') > MAX_VERSION_PLAINTEXT_BYTES) fail('REVIEW_STORAGE_LIMIT');
  return deepFreeze(snapshot);
}

function sourceStateFromFacts(facts, revision) {
  const fields = Object.create(null);
  for (const field of Object.keys(FIELD_TYPES)) {
    const input = facts[field] ?? { status: 'missing', claims: [] };
    const sourceClaims = input.claims.map((claim) => ({
      originStatus: claim.originStatus,
      value: claim.value,
      sourceEvidence: claim.sourceEvidence,
      sourceRevision: revision,
    }));
    fields[field] = { sourceClaims, correctionHistory: [] };
  }
  return { fields };
}

function appendSourceFacts(state, facts, revision) {
  for (const [field, input] of Object.entries(facts)) {
    if (input.status === 'missing') continue;
    const target = state.fields[field];
    for (const claim of input.claims) {
      const normalized = {
        originStatus: claim.originStatus,
        value: claim.value,
        sourceEvidence: claim.sourceEvidence,
        sourceRevision: revision,
      };
      const existing = target.sourceClaims.some((item) => item.originStatus === normalized.originStatus
        && canonical(item.value) === canonical(normalized.value)
        && canonical(item.sourceEvidence) === canonical(normalized.sourceEvidence));
      if (!existing) target.sourceClaims.push(normalized);
      if (target.sourceClaims.length > 128) fail('REVIEW_STORAGE_LIMIT');
    }
  }
}

function readSnapshot(document, row) {
  const withoutHash = isRecord(document)
    ? Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'contentHash'))
    : null;
  if (!withoutHash || document.schemaVersion !== 1 || document.versionId !== row.version_id
    || document.revision !== row.revision || document.parentVersionId !== row.parent_version_id
    || document.contentHash !== row.content_hash || document.materialHash !== row.material_hash
    || sha256(canonical(withoutHash)) !== row.content_hash || document.contentHash !== sha256(canonical(withoutHash))) {
    fail('REVIEW_INTEGRITY');
  }
  return deepFreeze(document);
}

function advanceHistoryClock(database, observedNow) {
  const previous = database.prepare("SELECT value FROM correction_cache_meta WHERE key = 'clock_max_ms'").get();
  const maximum = previous ? Number(previous.value) : null;
  if (previous && (!Number.isSafeInteger(maximum) || maximum < 0)) fail('REVIEW_INTEGRITY');
  if (maximum !== null && observedNow < maximum) fail('REVIEW_DENIED');
  if (maximum === null || observedNow > maximum) {
    database.prepare(`INSERT INTO correction_cache_meta (key, value) VALUES ('clock_max_ms', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(String(observedNow));
  }
}

export function createCorrectionHistoryStore(options) {
  const config = ownDataRecord(options, new Set([
    'directory', 'resolveTenant', 'resolveActor', 'authorize', 'authorizeBoundary', 'resolveKey', 'resolveRetention',
    'allowedFields', 'lockedFields', 'now', 'maxRetentionMs', 'maxStoredBytes', 'maxHistories',
    'maxRevisionsPerHistory', 'lockTimeoutMs',
  ]));
  if (!config || typeof config.directory !== 'string' || config.directory.length === 0
    || typeof config.resolveTenant !== 'function' || typeof config.resolveActor !== 'function'
    || typeof config.authorize !== 'function' || typeof config.resolveKey !== 'function'
    || typeof config.resolveRetention !== 'function' || typeof config.authorizeBoundary !== 'function') fail();

  const allowedFieldsArray = config.allowedFields ?? Object.keys(FIELD_TYPES);
  const lockedFieldsArray = config.lockedFields;
  const allowedEntries = safeArray(allowedFieldsArray, 16);
  const lockedEntries = safeArray(lockedFieldsArray, 16);
  if (!allowedEntries || allowedEntries.length === 0 || !lockedEntries
    || allowedEntries.some((item) => typeof item !== 'string' || !Object.hasOwn(FIELD_TYPES, item))
    || lockedEntries.some((item) => typeof item !== 'string' || !Object.hasOwn(FIELD_TYPES, item))) fail();
  const allowedFields = new Set(allowedEntries);
  const lockedFields = new Set(lockedEntries);
  const lockedOutsideAllowlist = [...lockedFields].some((field) => !allowedFields.has(field));
  if (lockedOutsideAllowlist) fail();

  const limits = {
    now: config.now ?? (() => Date.now()),
    maxRetentionMs: config.maxRetentionMs ?? 30 * 24 * 60 * 60 * 1000,
    maxStoredBytes: config.maxStoredBytes ?? 64 * 1024 * 1024,
    maxHistories: config.maxHistories ?? 1000,
    maxRevisionsPerHistory: config.maxRevisionsPerHistory ?? 200,
    lockTimeoutMs: config.lockTimeoutMs ?? 5_000,
  };
  if (typeof limits.now !== 'function') fail();
  for (const [name, value] of Object.entries(limits)) {
    if (name !== 'now' && (!Number.isSafeInteger(value) || value <= 0)) fail();
  }
  const rootDirectory = path.resolve(config.directory);
  const scopeRecords = new WeakMap();

  function nowMs() {
    let value;
    try { value = limits.now(); } catch { fail('REVIEW_STORAGE'); }
    if (!Number.isSafeInteger(value) || value < 0) fail('REVIEW_STORAGE');
    return value;
  }

  function boundaryFor(info, actorId, eventId, action, field, request, details, mustBeBeforeMs = undefined) {
    const safeDetails = Object.freeze({ ...details });
    return Object.freeze({
      input: Object.freeze({ request, tenantId: info.tenantId, actorId, eventId,
        action, field: field ?? null, details: safeDetails }),
      ...(mustBeBeforeMs === undefined ? {} : { mustBeBeforeMs }),
    });
  }

  function scopeInfo(scope) {
    const info = scopeRecords.get(scope);
    if (!info) fail('REVIEW_DENIED');
    return info;
  }

  async function createScope(request) {
    let tenantId;
    try { tenantId = await config.resolveTenant(request); } catch { fail('REVIEW_DENIED'); }
    if (!validSafeString(tenantId, 1, 256)) fail('REVIEW_DENIED');
    const tenantHash = sha256(`event-intelligence:review-tenant:v1:${tenantId}`);
    const scope = createOpaque();
    scopeRecords.set(scope, Object.freeze({ tenantId, tenantHash }));
    return scope;
  }

  async function authorizeRequest(info, request, eventId, action, field) {
    let tenantId;
    let actorId;
    try {
      tenantId = await config.resolveTenant(request);
      actorId = await config.resolveActor(request);
    } catch {
      fail('REVIEW_DENIED');
    }
    if (tenantId !== info.tenantId || !validSafeString(actorId, 1, 180)) fail('REVIEW_DENIED');
    let authorized;
    try {
      authorized = await config.authorize(Object.freeze({
        tenantId: info.tenantId,
        actorId,
        eventId: eventId ?? null,
        action,
        ...(field ? { field } : {}),
        request,
      }));
    } catch {
      fail('REVIEW_DENIED');
    }
    if (authorized !== true) fail('REVIEW_DENIED');
    return actorId;
  }

  async function reauthorizeRequest(info, request, eventId, action, expectedActorId, field) {
    let tenantId;
    let actorId;
    try {
      tenantId = await config.resolveTenant(request);
      actorId = await config.resolveActor(request);
    } catch {
      fail('REVIEW_DENIED');
    }
    if (tenantId !== info.tenantId || actorId !== expectedActorId || !validSafeString(actorId, 1, 180)) fail('REVIEW_DENIED');
    const authorization = () => Object.freeze({
      tenantId,
      actorId,
      eventId: eventId ?? null,
      action,
      ...(field ? { field } : {}),
      request,
    });
    let firstDecision;
    try { firstDecision = await config.authorize(authorization()); } catch { fail('REVIEW_DENIED'); }
    if (firstDecision !== true) fail('REVIEW_DENIED');
    let finalTenantId;
    let finalActorId;
    try {
      finalTenantId = await config.resolveTenant(request);
      finalActorId = await config.resolveActor(request);
    } catch {
      fail('REVIEW_DENIED');
    }
    if (finalTenantId !== tenantId || finalActorId !== actorId) fail('REVIEW_DENIED');
    let finalDecision;
    try { finalDecision = await config.authorize(authorization()); } catch { fail('REVIEW_DENIED'); }
    if (finalDecision !== true) fail('REVIEW_DENIED');
  }

  function assertNotExpired(expiresAtMs) {
    if (!Number.isSafeInteger(expiresAtMs) || nowMs() >= expiresAtMs) fail('REVIEW_EXPIRED');
  }

  async function resolveKey(info, purpose, keyId) {
    try {
      const value = await config.resolveKey(Object.freeze({
        tenantId: info.tenantId,
        purpose,
        ...(keyId ? { keyId } : {}),
      }));
      return validateKeyResult(value, keyId);
    } catch {
      fail('REVIEW_KEY_UNAVAILABLE');
    }
  }

  async function resolveRetention(info, handle, upperBoundMs) {
    if (!handle || typeof handle !== 'object') fail('REVIEW_DENIED');
    const observedAt = nowMs();
    let value;
    try {
      value = await config.resolveRetention(Object.freeze({
        tenantId: info.tenantId,
        kind: 'correction_history',
        nowMs: observedAt,
        ...(Number.isSafeInteger(upperBoundMs) ? { sourceExpiresAtMs: upperBoundMs } : {}),
        retentionHandle: handle,
      }));
    } catch {
      fail('REVIEW_DENIED');
    }
    return validateRetentionDecision(value, observedAt, upperBoundMs, limits.maxRetentionMs);
  }

  async function tenantDirectory(info) {
    try {
      await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
      const rootStats = await lstat(rootDirectory);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) fail('REVIEW_STORAGE');
      await chmod(rootDirectory, 0o700);
      const directory = path.join(rootDirectory, info.tenantHash);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const stats = await lstat(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory()) fail('REVIEW_STORAGE');
      await chmod(directory, 0o700);
      return directory;
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async function withTransaction(info, directory, operation, signal, finalBoundary, transactionOptions = undefined) {
    const timeoutMs = transactionOptions?.timeoutMs ?? limits.lockTimeoutMs;
    return withTenantDatabaseQueue(directory,
      () => withTransactionUnlocked(info, directory, operation, signal, finalBoundary, {
        timeoutMs,
        sync: transactionOptions?.sync === true,
        beforeBegin: transactionOptions?.beforeBegin,
        boundary: transactionOptions?.boundary,
      }),
      signal);
  }

  async function withBindingTransaction(info, directory, operation, signal, beforeBegin, boundary) {
    const delays = [2, 4, 8, 12, 20, 30, 40];
    const startedAt = monotonicTimestampNs();
    for (let attempt = 0; ; attempt += 1) {
      throwIfAborted(signal);
      try {
        return await withTransaction(info, directory, operation, signal, undefined,
          { timeoutMs: 0, sync: true, beforeBegin, boundary });
      } catch (error) {
        if (!(error instanceof ReviewHistoryError) || error.code !== 'REVIEW_BUSY' || attempt >= delays.length) throw error;
        const elapsed = monotonicTimestampNs() - startedAt;
        const remaining = limits.lockTimeoutMs - Number((elapsed + 999_999n) / 1_000_000n);
        if (remaining <= 0) throw error;
        await abortableWait(new Promise((resolve) => setTimeout(resolve, Math.min(delays[attempt], remaining))), signal);
      }
    }
  }

  async function withAuthorizedRevisionTransaction(info, directory, operation, signal, beforeBegin, boundary) {
    // Revision commits with a current authorization check must use an async zero-timeout
    // retry loop: a synchronous SQLite busy wait could outlive the authorization decision.
    const startedAt = monotonicTimestampNs();
    const delays = [2, 4, 8, 12, 20, 30, 40];
    for (let attempt = 0; ; attempt += 1) {
      throwIfAborted(signal);
      try {
        // The final asynchronous authorization is preparation only. The synchronous
        // combined boundary guard runs after queue/filesystem/SQLite preparation.
        return await withTransaction(info, directory, operation, signal, undefined,
          { timeoutMs: 0, sync: true, beforeBegin, boundary });
      } catch (error) {
        if (!(error instanceof ReviewHistoryError) || error.code !== 'REVIEW_BUSY') throw error;
        const elapsed = monotonicTimestampNs() - startedAt;
        const remaining = limits.lockTimeoutMs - Number((elapsed + 999_999n) / 1_000_000n);
        if (remaining <= 0) throw error;
        const delay = Math.min(delays[Math.min(attempt, delays.length - 1)], remaining);
        await abortableWait(new Promise((resolve) => setTimeout(resolve, delay)), signal);
      }
    }
  }

  async function throwAfterExpiredCleanup(info, directory, eventKey, error, signal = undefined, cleanup = undefined) {
    const publicError = mapStorageError(error);
    if (publicError.code === 'REVIEW_EXPIRED' && cleanup?.boundary) {
      try {
        await withBindingTransaction(info, directory, (database, time) => {
          expireHistory(database, eventKey, time.effectiveNow);
        }, signal, cleanup.beforeBegin, cleanup.boundary);
      } catch { /* Expiry remains fail-closed even when retention cleanup is deferred. */ }
    }
    throw publicError;
  }

  async function guardHistoryDisclosure({ info, directory, eventId, eventKey, actorId, request, action,
    field = undefined, snapshot, value = snapshot, details = {}, expiresAtMs, signal, verify,
    allowPendingOperation = undefined }) {
    const boundary = boundaryFor(info, actorId, eventId, 'private_profile.read', field, request, {
      sourceAction: action,
      versionId: snapshot?.versionId ?? null,
      contentHash: snapshot?.contentHash ?? null,
      expiresAtMs,
      ...details,
    }, expiresAtMs);
    return withBindingTransaction(info, directory, (database, time) => {
      if (time.effectiveNow >= expiresAtMs) fail('REVIEW_EXPIRED');
      const state = database.prepare('SELECT phase, operation_id, fence FROM correction_cache_state WHERE event_key = ?').get(eventKey);
      if (state && state.phase !== 'complete') {
        const exactPending = allowPendingOperation && state.phase === allowPendingOperation.phase
          && state.operation_id === allowPendingOperation.operationId && state.fence === allowPendingOperation.fence;
        if (!exactPending) fail('REVIEW_BUSY');
      }
      verify(database, time);
      return value;
    }, signal, () => reauthorizeRequest(info, request, eventId, action, actorId, field), boundary);
  }

  async function withTransactionUnlocked(info, directory, operation, signal, finalBoundary, transactionOptions) {
    let database;
    let open = false;
    let preBeginRejected = false;
    try {
      const databasePath = path.join(directory, 'history.sqlite');
      let priorStats = null;
      try {
        priorStats = await lstat(databasePath);
        if (priorStats.isSymbolicLink() || !priorStats.isFile()) fail('REVIEW_STORAGE');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      database = new DatabaseSync(databasePath, { timeout: transactionOptions.timeoutMs });
      if (transactionOptions.timeoutMs === 0) database.exec('PRAGMA busy_timeout = 0');
      const openedStats = await lstat(databasePath);
      if (openedStats.isSymbolicLink() || !openedStats.isFile()
        || (priorStats && (openedStats.dev !== priorStats.dev || openedStats.ino !== priorStats.ino))) fail('REVIEW_STORAGE');
      database.exec(`
        PRAGMA synchronous = FULL;
        PRAGMA secure_delete = ON;
        PRAGMA trusted_schema = OFF;
      `);
      const journalMode = database.prepare('PRAGMA journal_mode').get()?.journal_mode;
      if (journalMode !== 'delete') database.exec('PRAGMA journal_mode = DELETE');
      const schemaTables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all().map((row) => row.name));
      const schemaReady = ['versions', 'heads', 'idempotency', 'downstream_references', 'invalidations',
        'correction_cache_state', 'correction_cache_bindings', 'correction_cache_operations', 'correction_cache_meta']
        .every((name) => schemaTables.has(name))
        && database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'correction_cache_bindings_expiry'").get() !== undefined;
      if (!schemaReady) database.exec(`
        CREATE TABLE IF NOT EXISTS versions (
          event_key TEXT NOT NULL,
          revision INTEGER NOT NULL,
          version_id TEXT,
          parent_version_id TEXT,
          content_hash TEXT,
          material_hash TEXT,
          expires_at_ms INTEGER,
          encryption_key_id TEXT,
          sealed BLOB,
          state TEXT NOT NULL CHECK (state IN ('available', 'expired')),
          PRIMARY KEY (event_key, revision),
          UNIQUE (event_key, version_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS heads (
          event_key TEXT PRIMARY KEY NOT NULL,
          revision INTEGER,
          version_id TEXT,
          content_hash TEXT,
          material_hash TEXT,
          expires_at_ms INTEGER,
          state TEXT NOT NULL CHECK (state IN ('available', 'expired'))
        ) STRICT;
        CREATE TABLE IF NOT EXISTS idempotency (
          event_key TEXT NOT NULL,
          key_hash TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          version_id TEXT NOT NULL,
          PRIMARY KEY (event_key, key_hash)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS downstream_references (
          event_key TEXT NOT NULL,
          reference_hash TEXT NOT NULL,
          bound_version_id TEXT NOT NULL,
          bound_content_hash TEXT NOT NULL,
          encryption_key_id TEXT NOT NULL,
          sealed BLOB NOT NULL,
          PRIMARY KEY (event_key, reference_hash)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS invalidations (
          event_key TEXT NOT NULL,
          reference_hash TEXT NOT NULL,
          prior_version_id TEXT NOT NULL,
          prior_content_hash TEXT NOT NULL,
          next_version_id TEXT NOT NULL,
          material_change INTEGER NOT NULL CHECK (material_change IN (0, 1)),
          reason TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (event_key, reference_hash, prior_version_id, prior_content_hash)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS correction_cache_state (
          event_key TEXT PRIMARY KEY NOT NULL,
          operation_id TEXT NOT NULL,
          operation_hash TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          binding_id TEXT,
          fence INTEGER NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('bind', 'correction', 'source_refresh')),
          phase TEXT NOT NULL CHECK (phase IN ('pending_bind', 'pending_correction', 'history_committed', 'cache_invalidating', 'complete')),
          base_version_id TEXT,
          base_content_hash TEXT,
          target_version_id TEXT,
          target_content_hash TEXT,
          updated_at_ms INTEGER NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS correction_cache_bindings (
          event_key TEXT NOT NULL,
          binding_hash TEXT NOT NULL,
          bound_version_id TEXT NOT NULL,
          bound_content_hash TEXT NOT NULL,
          expires_at_ms INTEGER NOT NULL,
          encryption_key_id TEXT NOT NULL,
          sealed BLOB NOT NULL,
          last_invalidation_operation_id TEXT,
          last_invalidation_target_version_id TEXT,
          last_invalidation_target_hash TEXT,
          PRIMARY KEY (event_key, binding_hash)
        ) STRICT;
        CREATE INDEX IF NOT EXISTS correction_cache_bindings_expiry
          ON correction_cache_bindings (expires_at_ms, event_key, binding_hash);
        CREATE TABLE IF NOT EXISTS correction_cache_operations (
          event_key TEXT NOT NULL,
          operation_hash TEXT NOT NULL,
          fingerprint TEXT NOT NULL,
          operation_id TEXT NOT NULL,
          binding_id TEXT,
          kind TEXT NOT NULL CHECK (kind IN ('bind', 'correction', 'source_refresh')),
          target_version_id TEXT,
          target_content_hash TEXT,
          PRIMARY KEY (event_key, operation_hash)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS correction_cache_meta (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        ) STRICT;
      `);
      const versionIdColumn = database.prepare('PRAGMA table_info(versions)').all()
        .find((column) => column.name === 'version_id');
      if (versionIdColumn?.notnull) {
        database.exec('BEGIN IMMEDIATE');
        try {
          database.exec(`
            CREATE TABLE versions_expiry_migration (
              event_key TEXT NOT NULL,
              revision INTEGER NOT NULL,
              version_id TEXT,
              parent_version_id TEXT,
              content_hash TEXT,
              material_hash TEXT,
              expires_at_ms INTEGER,
              encryption_key_id TEXT,
              sealed BLOB,
              state TEXT NOT NULL CHECK (state IN ('available', 'expired')),
              PRIMARY KEY (event_key, revision),
              UNIQUE (event_key, version_id)
            ) STRICT;
            INSERT INTO versions_expiry_migration SELECT * FROM versions;
            DROP TABLE versions;
            ALTER TABLE versions_expiry_migration RENAME TO versions;
          `);
          normalizeExpiredTombstones(database);
          database.exec('COMMIT');
        } catch (error) {
          try { database.exec('ROLLBACK'); } catch { /* The connection is closed by the outer transaction guard. */ }
          throw error;
        }
      }
      await chmod(databasePath, 0o600);
      if (transactionOptions.beforeBegin) {
        try {
          await transactionOptions.beforeBegin();
        } catch (error) {
          preBeginRejected = true;
          throw error;
        }
      }
      let boundaryToken;
      if (transactionOptions.boundary) {
        preBeginRejected = true;
        boundaryToken = beginLocalBoundary(config.authorizeBoundary, transactionOptions.boundary.input,
          () => fail('REVIEW_DENIED'));
      }
      const guardedTransactionNow = boundaryToken?.nowMs ?? nowMs();
      const effectiveTransactionNow = boundaryToken ? localBoundaryEffectiveNow(boundaryToken) : guardedTransactionNow;
      if (!Number.isSafeInteger(effectiveTransactionNow) || effectiveTransactionNow < guardedTransactionNow
        || effectiveTransactionNow > MAX_TIME) fail(boundaryToken ? 'REVIEW_EXPIRED' : 'REVIEW_STORAGE');
      if (transactionOptions.boundary?.mustBeBeforeMs !== undefined
        && effectiveTransactionNow >= transactionOptions.boundary.mustBeBeforeMs) fail('REVIEW_EXPIRED');
      throwIfAborted(signal);
      database.exec('BEGIN IMMEDIATE');
      open = true;
      advanceHistoryClock(database, guardedTransactionNow);
      preBeginRejected = false;
      const transactionTime = Object.freeze({ now: guardedTransactionNow, effectiveNow: effectiveTransactionNow });
      const result = transactionOptions.sync ? operation(database, transactionTime)
        : await operation(database, transactionTime);
      if (transactionOptions.sync && result && typeof result.then === 'function') fail('REVIEW_STORAGE');
      if (finalBoundary) await finalBoundary(result);
      throwIfAborted(signal);
      if (boundaryToken) {
        const effectiveCommitNow = localBoundaryEffectiveNow(boundaryToken);
        if (!Number.isSafeInteger(effectiveCommitNow) || effectiveCommitNow < guardedTransactionNow
          || effectiveCommitNow > MAX_TIME
          || (transactionOptions.boundary?.mustBeBeforeMs !== undefined
            && effectiveCommitNow >= transactionOptions.boundary.mustBeBeforeMs)) fail('REVIEW_EXPIRED');
      }
      database.exec('COMMIT');
      open = false;
      return result;
    } catch (error) {
      const publicError = mapStorageError(error);
      if (open) {
        try { database.exec('ROLLBACK'); } catch { /* Closing an interrupted connection also rolls back its transaction. */ }
        open = false;
      }
      throw publicError;
    } finally {
      database?.close();
    }
  }

  function keyed(info, indexKey, kind, value) {
    return hmac(indexKey, `event-intelligence:review-index:v1:${info.tenantHash}:${kind}:${value}`);
  }

  async function indexKeyFor(info) {
    const resolved = await resolveKey(info, 'correction_index');
    return resolved.key;
  }

  async function payloadKeyFor(info, keyId) {
    const resolved = await resolveKey(info, 'correction_payload', keyId);
    return resolved;
  }

  function expireHistory(database, eventKey, now) {
    const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
    if (!head || head.state === 'expired' || head.expires_at_ms > now) return false;
    database.prepare(`UPDATE versions SET version_id = NULL, parent_version_id = NULL, content_hash = NULL, material_hash = NULL,
      expires_at_ms = NULL, encryption_key_id = NULL, sealed = NULL, state = 'expired' WHERE event_key = ?`).run(eventKey);
    database.prepare(`UPDATE heads SET revision = NULL, version_id = NULL, content_hash = NULL,
      material_hash = NULL, expires_at_ms = NULL, state = 'expired' WHERE event_key = ?`).run(eventKey);
    database.prepare('DELETE FROM idempotency WHERE event_key = ?').run(eventKey);
    database.prepare('DELETE FROM downstream_references WHERE event_key = ?').run(eventKey);
    database.prepare('DELETE FROM invalidations WHERE event_key = ?').run(eventKey);
    database.prepare('DELETE FROM correction_cache_bindings WHERE event_key = ?').run(eventKey);
    database.prepare('DELETE FROM correction_cache_state WHERE event_key = ?').run(eventKey);
    database.prepare('DELETE FROM correction_cache_operations WHERE event_key = ?').run(eventKey);
    return true;
  }

  function normalizeExpiredTombstones(database) {
    database.exec(`
      UPDATE versions SET version_id = NULL, parent_version_id = NULL, content_hash = NULL, material_hash = NULL,
        expires_at_ms = NULL, encryption_key_id = NULL, sealed = NULL
        WHERE state = 'expired' AND (version_id IS NOT NULL OR parent_version_id IS NOT NULL OR content_hash IS NOT NULL
          OR material_hash IS NOT NULL OR expires_at_ms IS NOT NULL OR encryption_key_id IS NOT NULL OR sealed IS NOT NULL);
      UPDATE versions SET version_id = NULL, parent_version_id = NULL, content_hash = NULL, material_hash = NULL,
        expires_at_ms = NULL, encryption_key_id = NULL, sealed = NULL, state = 'expired'
        WHERE event_key IN (SELECT event_key FROM heads WHERE state = 'expired')
          AND (state != 'expired' OR version_id IS NOT NULL OR parent_version_id IS NOT NULL OR content_hash IS NOT NULL
            OR material_hash IS NOT NULL OR expires_at_ms IS NOT NULL OR encryption_key_id IS NOT NULL OR sealed IS NOT NULL);
      UPDATE heads SET revision = NULL, version_id = NULL, content_hash = NULL, material_hash = NULL,
        expires_at_ms = NULL WHERE state = 'expired'
          AND (revision IS NOT NULL OR version_id IS NOT NULL OR content_hash IS NOT NULL
            OR material_hash IS NOT NULL OR expires_at_ms IS NOT NULL);
      DELETE FROM idempotency WHERE event_key IN (SELECT event_key FROM heads WHERE state = 'expired');
      DELETE FROM downstream_references WHERE event_key IN (SELECT event_key FROM heads WHERE state = 'expired');
      DELETE FROM invalidations WHERE event_key IN (SELECT event_key FROM heads WHERE state = 'expired');
      DELETE FROM correction_cache_bindings WHERE event_key IN (SELECT event_key FROM heads WHERE state = 'expired');
      DELETE FROM correction_cache_state WHERE event_key IN (SELECT event_key FROM heads WHERE state = 'expired');
      DELETE FROM correction_cache_operations WHERE event_key IN (SELECT event_key FROM heads WHERE state = 'expired');
    `);
  }

  function rowForVersion(database, eventKey, versionId) {
    return database.prepare(`SELECT * FROM versions WHERE event_key = ? AND version_id = ? AND state = 'available'`).get(eventKey, versionId);
  }

  async function decryptVersion(info, row) {
    if (!row || row.state !== 'available' || !row.encryption_key_id || !row.sealed) fail('REVIEW_NOT_FOUND');
    const key = await payloadKeyFor(info, row.encryption_key_id);
    try {
      const document = openSealed(info, `${row.event_key}:${row.version_id}`, 'version', key.keyId, key.key, row.sealed);
      return readSnapshot(document, row);
    } finally {
      key.key.fill(0);
    }
  }

  async function decryptReference(info, row) {
    const key = await payloadKeyFor(info, row.encryption_key_id);
    try {
      const document = openSealed(info, `${row.event_key}:${row.reference_hash}:${row.bound_version_id}`, 'reference', key.keyId, key.key, row.sealed);
      const ref = ownDataRecord(document, new Set(['referenceId', 'kind', 'boundVersionId', 'boundContentHash', 'createdAt']));
      if (!ref || ref.boundVersionId !== row.bound_version_id || ref.boundContentHash !== row.bound_content_hash) fail('REVIEW_INTEGRITY');
      return deepFreeze(ref);
    } finally {
      key.key.fill(0);
    }
  }

  async function idempotentReplay(info, database, eventKey, keyHash, fingerprint) {
    const existing = database.prepare('SELECT fingerprint, version_id FROM idempotency WHERE event_key = ? AND key_hash = ?').get(eventKey, keyHash);
    if (!existing) return null;
    if (existing.fingerprint !== fingerprint) fail('REVIEW_IDEMPOTENCY_CONFLICT');
    const row = rowForVersion(database, eventKey, existing.version_id);
    if (!row) fail('REVIEW_EXPIRED');
    const snapshot = await decryptVersion(info, row);
    assertNotExpired(row.expires_at_ms);
    return Object.freeze({ snapshot, replayed: true, invalidations: snapshot.invalidations });
  }

  function fingerprint(indexKey, info, eventKey, actorId, operation, normalizedInput) {
    const actorHash = keyed(info, indexKey, 'actor', actorId);
    return hmac(indexKey, canonical({
      tenantHash: info.tenantHash,
      eventKey,
      actorHash,
      operation,
      input: normalizedInput,
    }));
  }

  function recordBindingTargetInTransaction(database, bindingOperation, targetVersionId, targetContentHash, now) {
    const { context, operation } = bindingOperation;
    const current = database.prepare('SELECT * FROM correction_cache_state WHERE event_key = ?').get(context.eventKey);
    if (!current || current.operation_id !== operation.operationId || current.fence !== operation.fence
      || !['pending_correction', 'history_committed', 'cache_invalidating'].includes(current.phase)
      || current.base_version_id !== operation.baseVersionId || current.base_content_hash !== operation.baseContentHash) fail('REVIEW_BUSY');
    const head = database.prepare('SELECT version_id, content_hash FROM heads WHERE event_key = ?').get(context.eventKey);
    if (!head || head.version_id !== targetVersionId || head.content_hash !== targetContentHash) fail('REVIEW_VERSION_CONFLICT');
    if (current.phase !== 'pending_correction') {
      if (current.target_version_id !== targetVersionId || current.target_content_hash !== targetContentHash) fail('REVIEW_INTEGRITY');
      return;
    }
    database.prepare(`UPDATE correction_cache_state SET phase = 'history_committed', target_version_id = ?,
      target_content_hash = ?, updated_at_ms = ? WHERE event_key = ? AND operation_id = ? AND fence = ?`)
      .run(targetVersionId, targetContentHash, now, context.eventKey, operation.operationId, operation.fence);
    database.prepare(`UPDATE correction_cache_operations SET target_version_id = ?, target_content_hash = ?
      WHERE event_key = ? AND operation_hash = ? AND operation_id = ?`)
      .run(targetVersionId, targetContentHash, context.eventKey, current.operation_hash, operation.operationId);
  }

  async function recordBindingHistoryTarget(bindingOperation, snapshot) {
    const { context } = bindingOperation;
    await withBindingTransaction(context.info, context.directory, (database, time) => {
      recordBindingTargetInTransaction(database, bindingOperation, snapshot.versionId, snapshot.contentHash, time.now);
    }, undefined, () => reauthorizeRequest(context.info, context.request, context.eventId,
      context.action, context.actorId, context.field), boundaryFor(context.info, context.actorId, context.eventId,
      'review.history.cache_operation_state', context.field, context.request, {
        operationId: bindingOperation.operation.operationId,
        fence: bindingOperation.operation.fence,
        targetVersionId: snapshot.versionId,
        targetContentHash: snapshot.contentHash,
      }));
  }

  async function findCommittedReplay(info, eventId, eventKey, actorId, operation, idempotencyKey, normalizedInput, indexKey,
    request, action, field, signal = undefined, bindingOperation = undefined) {
    const directory = await tenantDirectory(info);
    const keyHash = keyed(info, indexKey, 'idempotency-key', idempotencyKey);
    const fingerprintValue = fingerprint(indexKey, info, eventKey, actorId, operation, normalizedInput);
    try {
      const raw = await withTransaction(info, directory, (database, time) => {
        const receipt = database.prepare('SELECT fingerprint, version_id FROM idempotency WHERE event_key = ? AND key_hash = ?')
          .get(eventKey, keyHash);
        if (!receipt) return null;
        if (receipt.fingerprint !== fingerprintValue) fail('REVIEW_IDEMPOTENCY_CONFLICT');
        const row = rowForVersion(database, eventKey, receipt.version_id);
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        const state = database.prepare(`SELECT phase, operation_id, fence, base_version_id, base_content_hash,
          target_version_id, target_content_hash FROM correction_cache_state WHERE event_key = ?`).get(eventKey);
        return row && head ? { row, head, state } : null;
      }, undefined, undefined, { sync: true });
      if (!raw) return null;
      if (raw.head.state !== 'available' || raw.head.expires_at_ms <= nowMs()) fail('REVIEW_EXPIRED');
      const snapshot = await decryptVersion(info, raw.row);
      const replay = Object.freeze({ snapshot, replayed: true, invalidations: snapshot.invalidations });
      await reauthorizeRequest(info, request, eventId, action, actorId, field);
      let allowPendingOperation;
      if (bindingOperation && raw.state?.phase !== 'complete') {
        const operationValue = bindingOperation.operation;
        if (!operationValue || !['history_committed', 'cache_invalidating'].includes(operationValue.phase)
          || raw.state?.operation_id !== operationValue.operationId || raw.state?.fence !== operationValue.fence
          || raw.state?.phase !== operationValue.phase || raw.state?.base_version_id !== operationValue.baseVersionId
          || raw.state?.base_content_hash !== operationValue.baseContentHash
          || raw.state?.target_version_id !== snapshot.versionId
          || raw.state?.target_content_hash !== snapshot.contentHash) fail('REVIEW_BUSY');
        allowPendingOperation = { operationId: operationValue.operationId, fence: operationValue.fence,
          phase: operationValue.phase };
      }
      return await guardHistoryDisclosure({ info, directory, eventId, eventKey, actorId, request, action, field,
        snapshot, value: replay, expiresAtMs: Math.min(raw.head.expires_at_ms, raw.row.expires_at_ms),
        details: { replayed: true, operation, ...(allowPendingOperation ? {
          bindingOperationId: allowPendingOperation.operationId,
          bindingOperationFence: allowPendingOperation.fence,
          bindingOperationPhase: allowPendingOperation.phase,
        } : {}) },
        allowPendingOperation,
        verify(database, time) {
          const row = rowForVersion(database, eventKey, snapshot.versionId);
          const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
          const state = database.prepare(`SELECT phase, operation_id, fence, base_version_id, base_content_hash,
            target_version_id, target_content_hash FROM correction_cache_state WHERE event_key = ?`).get(eventKey);
          if (!row || row.state !== 'available' || row.content_hash !== snapshot.contentHash
            || row.expires_at_ms !== raw.row.expires_at_ms || row.expires_at_ms <= time.effectiveNow
            || !head || head.state !== 'available' || head.version_id !== raw.head.version_id
            || head.content_hash !== raw.head.content_hash || head.expires_at_ms !== raw.head.expires_at_ms
            || head.expires_at_ms <= time.effectiveNow
            || (allowPendingOperation && (!state || state.phase !== allowPendingOperation.phase
              || state.operation_id !== allowPendingOperation.operationId || state.fence !== allowPendingOperation.fence
              || state.target_version_id !== snapshot.versionId || state.target_content_hash !== snapshot.contentHash))) fail('REVIEW_VERSION_CONFLICT');
        } });
    } catch (error) {
      return throwAfterExpiredCleanup(info, directory, eventKey, error, signal, {
        beforeBegin: () => reauthorizeRequest(info, request, eventId, 'purge_correction_history', actorId),
        boundary: boundaryFor(info, actorId, eventId, 'review.history.retention_purge', undefined, request,
          { reason: 'expired_history_replay' }),
      });
    }
  }

  async function persistVersion({ info, directory, eventId, eventKey, actorId, operation, idempotencyKey,
    normalizedInput, state, parent, retentionHandle, signal, baseVersion, indexKey, request, action, field, bindingOperation }) {
    const upperBoundMs = parent?.expires_at_ms;
    const firstRetention = await resolveRetention(info, retentionHandle, upperBoundMs);
    throwIfAborted(signal);
    const expiresAtMs = Math.min(firstRetention.expiresAtMs, upperBoundMs ?? firstRetention.expiresAtMs);
    const retention = Object.freeze({ ...firstRetention, expiresAtMs });
    const key = await payloadKeyFor(info);
    const keyHash = keyed(info, indexKey, 'idempotency-key', idempotencyKey);
    const fingerprintValue = fingerprint(indexKey, info, eventKey, actorId, operation, normalizedInput);
    try {
      const preflight = await withTransaction(info, directory, (database, time) => {
        const now = time.now;
        const current = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        const replayRow = database.prepare('SELECT fingerprint, version_id FROM idempotency WHERE event_key = ? AND key_hash = ?')
          .get(eventKey, keyHash);
        if (current?.state === 'available' && current.expires_at_ms <= now) fail('REVIEW_EXPIRED');
        let refRows = [];
        if (!replayRow && current?.state === 'available') {
          refRows = database.prepare(`SELECT r.* FROM downstream_references AS r
            WHERE r.event_key = ? AND r.bound_version_id = ? AND r.bound_content_hash = ?
            AND NOT EXISTS (SELECT 1 FROM invalidations AS i WHERE i.event_key = r.event_key
              AND i.reference_hash = r.reference_hash AND i.prior_version_id = r.bound_version_id
              AND i.prior_content_hash = r.bound_content_hash) ORDER BY r.reference_hash LIMIT 129`)
            .all(eventKey, current.version_id, current.content_hash);
        }
        return { current, replayRow, refRows };
      }, signal, undefined, { sync: true });
      if (preflight.replayRow) {
        if (preflight.replayRow.fingerprint !== fingerprintValue) fail('REVIEW_IDEMPOTENCY_CONFLICT');
        const replay = await withTransaction(info, directory, (database) => {
          const row = rowForVersion(database, eventKey, preflight.replayRow.version_id);
          return row ? { row, head: database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey) } : null;
        }, signal, undefined, { sync: true });
        if (!replay?.row || !replay.head || replay.head.state !== 'available') fail('REVIEW_EXPIRED');
        const snapshot = await decryptVersion(info, replay.row);
        await reauthorizeRequest(info, request, eventId, action, actorId, field);
        assertNotExpired(replay.head.expires_at_ms);
        assertNotExpired(Date.parse(snapshot.expiresAt));
        if (bindingOperation) await recordBindingHistoryTarget(bindingOperation, snapshot);
        return Object.freeze({ snapshot, replayed: true, invalidations: snapshot.invalidations });
      }
      if (operation === 'initialize') {
        if (preflight.current?.state === 'expired') fail('REVIEW_EXPIRED');
        if (preflight.current?.state === 'available') fail('REVIEW_ALREADY_EXISTS');
      } else {
        if (!preflight.current) fail('REVIEW_NOT_FOUND');
        if (preflight.current.state !== 'available') fail(preflight.current.state === 'expired' ? 'REVIEW_EXPIRED' : 'REVIEW_NOT_FOUND');
        if (!baseVersion || preflight.current.version_id !== baseVersion.versionId
          || preflight.current.content_hash !== baseVersion.contentHash) fail('REVIEW_VERSION_CONFLICT');
        if (preflight.current.expires_at_ms < expiresAtMs) fail('REVIEW_DENIED');
      }
      if (preflight.refRows.length > 128) fail('REVIEW_STORAGE_LIMIT');
      const references = [];
      for (const row of preflight.refRows) references.push(await decryptReference(info, row));
      const finalRetention = await resolveRetention(info, retentionHandle, upperBoundMs);
      throwIfAborted(signal);
      if (finalRetention.policyId !== retention.policyId || finalRetention.policyVersion !== retention.policyVersion
        || finalRetention.accessPolicy !== retention.accessPolicy || finalRetention.expiresAtMs < retention.expiresAtMs) fail('REVIEW_DENIED');
      const finalExpiresAtMs = Math.min(retention.expiresAtMs, finalRetention.expiresAtMs);
      assertNotExpired(finalExpiresAtMs);
      throwIfAborted(signal);
      const authorizeBeforeBegin = async () => {
        throwIfAborted(signal);
        await reauthorizeRequest(info, request, eventId, action, actorId, field);
        throwIfAborted(signal);
      };
      const boundaryAction = operation === 'initialize' ? 'review.history.initialize'
        : operation === 'correction' ? 'review.history.apply_correction' : 'review.history.refresh_source_facts';
      const boundary = boundaryFor(info, actorId, eventId, boundaryAction, field, request, {
        operation,
        idempotencyFingerprint: fingerprintValue,
        baseVersionId: baseVersion?.versionId ?? null,
        baseContentHash: baseVersion?.contentHash ?? null,
        retentionExpiresAtMs: finalExpiresAtMs,
        bindingOperationId: bindingOperation?.operation.operationId ?? null,
        bindingFence: bindingOperation?.operation.fence ?? null,
      }, finalExpiresAtMs);
      const transaction = (database, time) => {
        const transactionTime = time.now;
        const effectiveNow = time.effectiveNow;
        const existingReplay = database.prepare('SELECT fingerprint, version_id FROM idempotency WHERE event_key = ? AND key_hash = ?')
          .get(eventKey, keyHash);
        if (existingReplay) {
          if (existingReplay.fingerprint !== fingerprintValue) fail('REVIEW_IDEMPOTENCY_CONFLICT');
          const row = rowForVersion(database, eventKey, existingReplay.version_id);
          if (!row) fail('REVIEW_EXPIRED');
          const currentHead = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
          if (bindingOperation) recordBindingTargetInTransaction(database, bindingOperation, row.version_id, row.content_hash, transactionTime);
          return Object.freeze({ replayVersionId: row.version_id, replayContentHash: row.content_hash,
            replayHeadExpiry: currentHead?.expires_at_ms, replayed: true });
        }
        const current = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (current?.state === 'available' && current.expires_at_ms <= effectiveNow) fail('REVIEW_EXPIRED');
        if (operation === 'initialize') {
          if (current?.state === 'expired') fail('REVIEW_EXPIRED');
          if (current?.state === 'available' || preflight.current?.state === 'available') fail('REVIEW_ALREADY_EXISTS');
        } else {
          if (!current) fail('REVIEW_NOT_FOUND');
          if (current.state !== 'available') fail(current.state === 'expired' ? 'REVIEW_EXPIRED' : 'REVIEW_NOT_FOUND');
          if (!baseVersion || current.version_id !== baseVersion.versionId || current.content_hash !== baseVersion.contentHash
            || current.version_id !== preflight.current?.version_id || current.content_hash !== preflight.current?.content_hash) fail('REVIEW_VERSION_CONFLICT');
          if (current.expires_at_ms < finalExpiresAtMs) fail('REVIEW_DENIED');
        }
        if (effectiveNow >= finalExpiresAtMs) fail('REVIEW_EXPIRED');
        if (bindingOperation) {
          const fence = database.prepare('SELECT operation_id, fence, phase, base_version_id, base_content_hash FROM correction_cache_state WHERE event_key = ?')
            .get(eventKey);
          if (!fence || fence.operation_id !== bindingOperation.operation.operationId
            || fence.fence !== bindingOperation.operation.fence || fence.phase !== 'pending_correction'
            || fence.base_version_id !== baseVersion?.versionId || fence.base_content_hash !== baseVersion?.contentHash) fail('REVIEW_BUSY');
        }
        const historyCount = database.prepare('SELECT COUNT(*) AS count FROM heads').get().count;
        if (operation === 'initialize' && historyCount >= limits.maxHistories) fail('REVIEW_STORAGE_LIMIT');
        const nextRevision = current?.revision ? current.revision + 1 : 1;
        if (nextRevision > limits.maxRevisionsPerHistory) fail('REVIEW_STORAGE_LIMIT');
        const createdAt = new Date(transactionTime).toISOString();
        const nextState = state.build(nextRevision, keyed(info, indexKey, 'actor', actorId), createdAt);
        const invalidations = references.map((reference) => ({
          referenceId: reference.referenceId,
          referenceKind: reference.kind,
          priorVersionId: current.version_id,
          priorContentHash: current.content_hash,
          reason: state.materialChanged ? 'material_projection_changed' : 'new_version_requires_new_binding',
          materialChange: state.materialChanged,
          createdAt,
        })).sort((left, right) => left.referenceId.localeCompare(right.referenceId));
        const snapshot = buildSnapshot({ eventId, eventKey, revision: nextRevision,
          parentVersionId: current?.version_id ?? null, createdAt,
          retention: Object.freeze({ ...retention, expiresAtMs: finalExpiresAtMs }), state: nextState,
          invalidations, indexKey });
        const sealed = seal(info, `${eventKey}:${snapshot.versionId}`, 'version', key.keyId, key.key, snapshot);
        if (sealed.byteLength > MAX_VERSION_SEALED_BYTES) fail('REVIEW_STORAGE_LIMIT');
        const liveBytes = database.prepare("SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM versions WHERE state = 'available'").get().bytes
          + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM downstream_references').get().bytes
          + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM correction_cache_bindings').get().bytes;
        if (liveBytes + sealed.byteLength > limits.maxStoredBytes) fail('REVIEW_STORAGE_LIMIT');
        const currentRefs = current?.state === 'available' ? database.prepare(`SELECT r.* FROM downstream_references AS r
          WHERE r.event_key = ? AND r.bound_version_id = ? AND r.bound_content_hash = ?
          AND NOT EXISTS (SELECT 1 FROM invalidations AS i WHERE i.event_key = r.event_key
            AND i.reference_hash = r.reference_hash AND i.prior_version_id = r.bound_version_id
            AND i.prior_content_hash = r.bound_content_hash) ORDER BY r.reference_hash LIMIT 129`)
          .all(eventKey, current.version_id, current.content_hash) : [];
        if (currentRefs.length !== preflight.refRows.length || currentRefs.some((row, index) => {
          const prior = preflight.refRows[index];
          return !prior || row.reference_hash !== prior.reference_hash || row.bound_version_id !== prior.bound_version_id
            || row.bound_content_hash !== prior.bound_content_hash || row.encryption_key_id !== prior.encryption_key_id
            || !Buffer.from(row.sealed).equals(Buffer.from(prior.sealed));
        })) fail('REVIEW_BUSY');
        database.prepare(`INSERT INTO versions
          (event_key, revision, version_id, parent_version_id, content_hash, material_hash, expires_at_ms, encryption_key_id, sealed, state)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`).run(eventKey, snapshot.revision,
          snapshot.versionId, snapshot.parentVersionId, snapshot.contentHash, snapshot.materialHash,
          finalExpiresAtMs, key.keyId, sealed);
        database.prepare(`INSERT INTO heads (event_key, revision, version_id, content_hash, material_hash, expires_at_ms, state)
          VALUES (?, ?, ?, ?, ?, ?, 'available') ON CONFLICT (event_key) DO UPDATE SET revision = excluded.revision,
          version_id = excluded.version_id, content_hash = excluded.content_hash, material_hash = excluded.material_hash,
          expires_at_ms = excluded.expires_at_ms, state = 'available'`)
          .run(eventKey, snapshot.revision, snapshot.versionId, snapshot.contentHash, snapshot.materialHash, finalExpiresAtMs);
        if (current?.state === 'available') {
          for (const invalidation of invalidations) {
            database.prepare(`INSERT INTO invalidations
              (event_key, reference_hash, prior_version_id, prior_content_hash, next_version_id, material_change, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
              .run(eventKey, keyed(info, indexKey, 'reference', invalidation.referenceId), invalidation.priorVersionId,
                invalidation.priorContentHash, snapshot.versionId, invalidation.materialChange ? 1 : 0,
                invalidation.reason, invalidation.createdAt);
          }
        }
        database.prepare('INSERT INTO idempotency (event_key, key_hash, fingerprint, version_id) VALUES (?, ?, ?, ?)')
          .run(eventKey, keyHash, fingerprintValue, snapshot.versionId);
        const usedBytes = database.prepare("SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM versions WHERE state = 'available'").get().bytes
          + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM downstream_references').get().bytes
          + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM correction_cache_bindings').get().bytes;
        if (usedBytes > limits.maxStoredBytes) fail('REVIEW_STORAGE_LIMIT');
        if (bindingOperation) recordBindingTargetInTransaction(database, bindingOperation, snapshot.versionId, snapshot.contentHash, transactionTime);
        return Object.freeze({ snapshot, replayed: false, invalidations: snapshot.invalidations });
      };
      const result = bindingOperation
        ? await withBindingTransaction(info, directory, transaction, signal, authorizeBeforeBegin, boundary)
        : await withAuthorizedRevisionTransaction(info, directory, transaction, signal, authorizeBeforeBegin, boundary);
      if (result.replayed) {
        const replay = await withTransaction(info, directory, (database) => {
          const row = rowForVersion(database, eventKey, result.replayVersionId);
          return row ? { row, head: database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey) } : null;
        }, signal, undefined, { sync: true });
        if (!replay?.row || !replay.head || replay.head.state !== 'available') fail('REVIEW_EXPIRED');
        const snapshot = await decryptVersion(info, replay.row);
        await reauthorizeRequest(info, request, eventId, action, actorId, field);
        const value = Object.freeze({ snapshot, replayed: true, invalidations: snapshot.invalidations });
        const pending = bindingOperation ? {
          operationId: bindingOperation.operation.operationId,
          fence: bindingOperation.operation.fence,
          phase: 'history_committed',
          baseVersionId: bindingOperation.operation.baseVersionId,
          baseContentHash: bindingOperation.operation.baseContentHash,
          targetVersionId: snapshot.versionId,
          targetContentHash: snapshot.contentHash,
        } : undefined;
        return await guardHistoryDisclosure({ info, directory, eventId, eventKey, actorId, request, action, field,
          snapshot, value, expiresAtMs: Math.min(replay.head.expires_at_ms, replay.row.expires_at_ms),
          details: { operation, replayed: true, ...(pending ? { bindingOperationId: pending.operationId,
            bindingOperationFence: pending.fence, bindingOperationPhase: pending.phase } : {}) },
          allowPendingOperation: pending,
          verify(database, time) {
            const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
            const row = rowForVersion(database, eventKey, snapshot.versionId);
            if (!head || head.state !== 'available' || head.version_id !== snapshot.versionId
              || head.content_hash !== snapshot.contentHash || head.expires_at_ms !== replay.head.expires_at_ms
              || head.expires_at_ms <= time.effectiveNow || !row || row.state !== 'available'
              || row.content_hash !== snapshot.contentHash || row.expires_at_ms !== replay.row.expires_at_ms
              || row.expires_at_ms <= time.effectiveNow) fail('REVIEW_VERSION_CONFLICT');
          } });
      }
      await reauthorizeRequest(info, request, eventId, action, actorId, field);
      const snapshot = result.snapshot;
      const pending = bindingOperation ? {
        operationId: bindingOperation.operation.operationId,
        fence: bindingOperation.operation.fence,
        phase: 'history_committed',
        baseVersionId: bindingOperation.operation.baseVersionId,
        baseContentHash: bindingOperation.operation.baseContentHash,
        targetVersionId: snapshot.versionId,
        targetContentHash: snapshot.contentHash,
      } : undefined;
      return await guardHistoryDisclosure({ info, directory, eventId, eventKey, actorId, request, action, field,
        snapshot, value: result, expiresAtMs: Date.parse(snapshot.expiresAt),
        details: { operation, replayed: false, ...(pending ? { bindingOperationId: pending.operationId,
          bindingOperationFence: pending.fence, bindingOperationPhase: pending.phase } : {}) },
        allowPendingOperation: pending,
        verify(database, time) {
          const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
          const row = rowForVersion(database, eventKey, snapshot.versionId);
          if (!head || head.state !== 'available' || head.version_id !== snapshot.versionId
            || head.content_hash !== snapshot.contentHash || head.expires_at_ms !== Date.parse(snapshot.expiresAt)
            || head.expires_at_ms <= time.effectiveNow || !row || row.state !== 'available'
            || row.content_hash !== snapshot.contentHash || row.expires_at_ms !== head.expires_at_ms
            || row.expires_at_ms <= time.effectiveNow) fail('REVIEW_VERSION_CONFLICT');
        } });
    } catch (error) {
      return throwAfterExpiredCleanup(info, directory, eventKey, error, signal, {
        beforeBegin: () => reauthorizeRequest(info, request, eventId, 'purge_correction_history', actorId),
        boundary: boundaryFor(info, actorId, eventId, 'review.history.retention_purge', undefined, request,
          { reason: 'expired_history_revision_or_replay' }),
      });
    } finally {
      key.key.fill(0);
    }
  }

  async function readHead(info, eventId, request, action = 'read_history') {
    const actorId = await authorizeRequest(info, request, eventId, action);
    const indexKey = await indexKeyFor(info);
    let eventKey;
    let directory;
    try {
      eventKey = keyed(info, indexKey, 'event', eventId);
      directory = await tenantDirectory(info);
      const raw = await withTransaction(info, directory, (database, time) => {
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available') fail('REVIEW_EXPIRED');
        if (head.expires_at_ms <= time.now) fail('REVIEW_EXPIRED');
        const row = rowForVersion(database, eventKey, head.version_id);
        if (!row) fail('REVIEW_INTEGRITY');
        return { head, row };
      }, undefined, undefined, { sync: true });
      const snapshot = await decryptVersion(info, raw.row);
      await reauthorizeRequest(info, request, eventId, action, actorId);
      return await guardHistoryDisclosure({ info, directory, eventId, eventKey, actorId, request, action,
        snapshot, expiresAtMs: raw.head.expires_at_ms, verify(database, time) {
          const current = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
          const row = rowForVersion(database, eventKey, snapshot.versionId);
          if (!current || current.state !== 'available' || current.version_id !== snapshot.versionId
            || current.content_hash !== snapshot.contentHash || current.expires_at_ms !== raw.head.expires_at_ms
            || !row || row.content_hash !== snapshot.contentHash || row.state !== 'available'
            || row.expires_at_ms <= time.effectiveNow) fail('REVIEW_VERSION_CONFLICT');
        } });
    } catch (error) {
      const cleanup = eventKey && directory ? {
        beforeBegin: () => reauthorizeRequest(info, request, eventId, 'purge_correction_history', actorId),
        boundary: boundaryFor(info, actorId, eventId, 'review.history.retention_purge', undefined, request,
          { reason: 'expired_history_read' }),
      } : undefined;
      return throwAfterExpiredCleanup(info, directory, eventKey, error, undefined, cleanup);
    } finally {
      indexKey.fill(0);
    }
  }

  async function createHistory(scope, inputValue, request, operationOptions) {
    const info = scopeInfo(scope);
    const input = ownDataRecord(inputValue, new Set(['eventId', 'sourceFacts', 'idempotencyKey', 'retentionHandle']));
    if (!input || typeof input.eventId !== 'string' || !Object.hasOwn(input, 'sourceFacts')) fail();
    const eventId = validateEventId(input.eventId);
    const actorId = await authorizeRequest(info, request, eventId, 'initialize_history');
    const facts = sourceFacts(input.sourceFacts, allowedFields);
    const idempotencyKey = validateIdentifier(input.idempotencyKey, 180);
    const signal = readSignal(operationOptions);
    throwIfAborted(signal);
    const indexKey = await indexKeyFor(info);
    try {
      const eventKey = keyed(info, indexKey, 'event', eventId);
      const directory = await tenantDirectory(info);
      const normalizedInput = { eventId, sourceFacts: facts };
      const replay = await findCommittedReplay(info, eventId, eventKey, actorId, 'initialize', idempotencyKey,
        normalizedInput, indexKey, request, 'initialize_history', undefined, signal);
      throwIfAborted(signal);
      if (replay) return replay;
      const result = await persistVersion({
        info,
        directory,
        eventId,
        eventKey,
        actorId,
        operation: 'initialize',
        idempotencyKey,
        normalizedInput,
        state: {
          materialChanged: true,
          build(revision) {
            return sourceStateFromFacts(facts, revision);
          },
        },
        parent: null,
        retentionHandle: input.retentionHandle,
        signal,
        indexKey,
        request,
        action: 'initialize_history',
      });
      return result;
    } finally {
      indexKey.fill(0);
    }
  }

  async function loadBase(info, eventId, baseVersionId, baseContentHash, indexKey, request, action, actorId, field) {
    const eventKey = keyed(info, indexKey, 'event', eventId);
    const directory = await tenantDirectory(info);
    try {
      const raw = await withTransaction(info, directory, (database, time) => {
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available') fail('REVIEW_EXPIRED');
        if (head.expires_at_ms <= time.now) fail('REVIEW_EXPIRED');
        const row = rowForVersion(database, eventKey, baseVersionId);
        if (!row || row.content_hash !== baseContentHash) fail('REVIEW_VERSION_CONFLICT');
        return { row, headExpiryMs: head.expires_at_ms };
      }, undefined, undefined, { sync: true });
      const snapshot = await decryptVersion(info, raw.row);
      await reauthorizeRequest(info, request, eventId, action, actorId, field);
      assertNotExpired(raw.row.expires_at_ms);
      assertNotExpired(raw.headExpiryMs);
      return { row: raw.row, snapshot, directory, eventKey };
    } catch (error) {
      return throwAfterExpiredCleanup(info, directory, eventKey, error, undefined, {
        beforeBegin: () => reauthorizeRequest(info, request, eventId, 'purge_correction_history', actorId),
        boundary: boundaryFor(info, actorId, eventId, 'review.history.retention_purge', field, request,
          { reason: 'expired_history_base_read', sourceAction: action }),
      });
    }
  }

  async function applyCorrection(scope, inputValue, request, operationOptions, internalBinding = undefined) {
    const info = scopeInfo(scope);
    const input = ownDataRecord(inputValue, new Set([
      'eventId', 'baseVersionId', 'baseContentHash', 'field', 'value', 'idempotencyKey', 'retentionHandle',
    ]));
    if (!input || !Object.hasOwn(input, 'eventId') || !Object.hasOwn(input, 'baseVersionId')
      || !Object.hasOwn(input, 'baseContentHash') || !Object.hasOwn(input, 'field') || !Object.hasOwn(input, 'value')) fail();
    const eventId = validateEventId(input.eventId);
    const actorId = await authorizeRequest(info, request, eventId, 'apply_correction', typeof input.field === 'string' ? input.field : undefined);
    const field = fieldKey(input.field, allowedFields);
    if (lockedFields.has(field)) fail('REVIEW_FIELD_LOCKED');
    const value = validateFieldValue(field, input.value);
    const baseVersionId = validateIdentifier(input.baseVersionId);
    if (typeof input.baseContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.baseContentHash)) fail();
    const idempotencyKey = validateIdentifier(input.idempotencyKey, 180);
    const signal = readSignal(operationOptions);
    throwIfAborted(signal);
    const indexKey = await indexKeyFor(info);
    const eventKey = keyed(info, indexKey, 'event', eventId);
    try {
      const normalizedInput = { eventId, baseVersionId, baseContentHash: input.baseContentHash, field, value };
      const replay = await findCommittedReplay(info, eventId, eventKey, actorId, 'correction', idempotencyKey,
        normalizedInput, indexKey, request, 'apply_correction', field, signal, internalBinding);
      throwIfAborted(signal);
      if (replay) {
        if (internalBinding) await recordBindingHistoryTarget(internalBinding, replay.snapshot);
        return replay;
      }
      const base = await loadBase(info, eventId, baseVersionId, input.baseContentHash, indexKey,
        request, 'apply_correction', actorId, field);
      const fields = base.snapshot.fields;
      const nextFieldState = Object.create(null);
      for (const currentField of Object.keys(FIELD_TYPES)) {
        const current = fields[currentField];
        nextFieldState[currentField] = {
          sourceClaims: current.sourceClaims,
          correctionHistory: [...current.correctionHistory],
          ...(current.currentCorrection ? { currentCorrection: current.currentCorrection } : {}),
        };
      }
      const materialChangedBefore = base.snapshot.materialHash;
      const priorCorrectionHistory = nextFieldState[field].correctionHistory;
      const correction = {
        origin: 'customer_supplied',
        value,
        field,
      };
      const state = {
        materialChanged: true,
        build(revision, actorHash, createdAt) {
          const correctionRecord = {
            ...correction,
            actorFingerprint: actorHash,
            revision,
            createdAt,
          };
          const target = nextFieldState[field];
          target.currentCorrection = correctionRecord;
          target.correctionHistory = [...priorCorrectionHistory, correctionRecord];
          if (target.correctionHistory.length > 200) fail('REVIEW_STORAGE_LIMIT');
          const stateValue = { fields: Object.create(null) };
          for (const currentField of Object.keys(FIELD_TYPES)) {
            const current = nextFieldState[currentField];
            stateValue.fields[currentField] = {
              sourceClaims: [...current.sourceClaims],
              correctionHistory: [...current.correctionHistory],
              ...(current.currentCorrection ? { currentCorrection: current.currentCorrection } : {}),
            };
          }
          const candidateViews = Object.create(null);
          for (const currentField of Object.keys(FIELD_TYPES)) candidateViews[currentField] = fieldView(currentField, stateValue.fields[currentField]);
          const questions = buildQuestions(eventKey, candidateViews, indexKey);
          state.materialChanged = sha256(canonical(materialProjection(candidateViews, questions))) !== materialChangedBefore;
          return stateValue;
        },
      };
      return await persistVersion({
        info,
        directory: base.directory,
        eventId,
        eventKey,
        actorId,
        operation: 'correction',
        idempotencyKey,
        normalizedInput,
        state,
        parent: base.row,
        baseVersion: { versionId: baseVersionId, contentHash: input.baseContentHash },
        retentionHandle: input.retentionHandle,
        signal,
        indexKey,
        request,
        action: 'apply_correction',
        field,
        bindingOperation: internalBinding,
      });
    } finally {
      indexKey.fill(0);
    }
  }

  async function refreshSources(scope, inputValue, request, operationOptions, internalBinding = undefined) {
    const info = scopeInfo(scope);
    const input = ownDataRecord(inputValue, new Set([
      'eventId', 'baseVersionId', 'baseContentHash', 'sourceFacts', 'idempotencyKey', 'retentionHandle',
    ]));
    if (!input || !Object.hasOwn(input, 'eventId') || !Object.hasOwn(input, 'baseVersionId')
      || !Object.hasOwn(input, 'baseContentHash') || !Object.hasOwn(input, 'sourceFacts')) fail();
    const eventId = validateEventId(input.eventId);
    const actorId = await authorizeRequest(info, request, eventId, 'refresh_source_facts');
    const baseVersionId = validateIdentifier(input.baseVersionId);
    if (typeof input.baseContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.baseContentHash)) fail();
    const facts = sourceFacts(input.sourceFacts, allowedFields);
    const idempotencyKey = validateIdentifier(input.idempotencyKey, 180);
    const signal = readSignal(operationOptions);
    throwIfAborted(signal);
    const indexKey = await indexKeyFor(info);
    const eventKey = keyed(info, indexKey, 'event', eventId);
    try {
      const normalizedInput = { eventId, baseVersionId, baseContentHash: input.baseContentHash, sourceFacts: facts };
      const replay = await findCommittedReplay(info, eventId, eventKey, actorId, 'source_refresh', idempotencyKey,
        normalizedInput, indexKey, request, 'refresh_source_facts', undefined, signal, internalBinding);
      throwIfAborted(signal);
      if (replay) {
        if (internalBinding) await recordBindingHistoryTarget(internalBinding, replay.snapshot);
        return replay;
      }
      const base = await loadBase(info, eventId, baseVersionId, input.baseContentHash, indexKey,
        request, 'refresh_source_facts', actorId);
      const nextFieldState = Object.create(null);
      for (const field of Object.keys(FIELD_TYPES)) {
        const current = base.snapshot.fields[field];
        nextFieldState[field] = {
          sourceClaims: [...current.sourceClaims],
          correctionHistory: [...current.correctionHistory],
          ...(current.currentCorrection ? { currentCorrection: current.currentCorrection } : {}),
        };
      }
      const beforeMaterialHash = base.snapshot.materialHash;
      const state = {
        materialChanged: true,
        build(revision, actorHash, createdAt) {
          void actorHash;
          const next = { fields: Object.create(null) };
          for (const field of Object.keys(FIELD_TYPES)) {
            next.fields[field] = {
              sourceClaims: [...nextFieldState[field].sourceClaims],
              correctionHistory: [...nextFieldState[field].correctionHistory],
              ...(nextFieldState[field].currentCorrection ? { currentCorrection: nextFieldState[field].currentCorrection } : {}),
            };
          }
          appendSourceFacts(next, facts, revision);
          const views = Object.create(null);
          for (const field of Object.keys(FIELD_TYPES)) views[field] = fieldView(field, next.fields[field]);
          const questions = buildQuestions(eventKey, views, indexKey);
          state.materialChanged = sha256(canonical(materialProjection(views, questions))) !== beforeMaterialHash;
          return next;
        },
      };
      return await persistVersion({
        info,
        directory: base.directory,
        eventId,
        eventKey,
        actorId,
        operation: 'source_refresh',
        idempotencyKey,
        normalizedInput,
        state,
        parent: base.row,
        baseVersion: { versionId: baseVersionId, contentHash: input.baseContentHash },
        retentionHandle: input.retentionHandle,
        signal,
        indexKey,
        request,
        action: 'refresh_source_facts',
        bindingOperation: internalBinding,
      });
    } finally {
      indexKey.fill(0);
    }
  }

  async function getHistory(scope, eventIdValue, request) {
    const info = scopeInfo(scope);
    const eventId = validateEventId(eventIdValue);
    return readHead(info, eventId, request);
  }

  async function getHistoryVersion(scope, eventIdValue, versionIdValue, request) {
    const info = scopeInfo(scope);
    const eventId = validateEventId(eventIdValue);
    const versionId = validateIdentifier(versionIdValue);
    const actorId = await authorizeRequest(info, request, eventId, 'read_history_version');
    const indexKey = await indexKeyFor(info);
    let eventKey;
    let directory;
    try {
      eventKey = keyed(info, indexKey, 'event', eventId);
      directory = await tenantDirectory(info);
      const raw = await withTransaction(info, directory, (database, time) => {
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available') fail('REVIEW_EXPIRED');
        if (head.expires_at_ms <= time.now) fail('REVIEW_EXPIRED');
        const row = rowForVersion(database, eventKey, versionId);
        if (!row) fail('REVIEW_NOT_FOUND');
        if (row.expires_at_ms <= time.now) fail('REVIEW_EXPIRED');
        return { head, row };
      }, undefined, undefined, { sync: true });
      const snapshot = await decryptVersion(info, raw.row);
      await reauthorizeRequest(info, request, eventId, 'read_history_version', actorId);
      return await guardHistoryDisclosure({ info, directory, eventId, eventKey, actorId, request,
        action: 'read_history_version', snapshot,
        expiresAtMs: Math.min(raw.head.expires_at_ms, raw.row.expires_at_ms),
        verify(database, time) {
          const current = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
          const row = rowForVersion(database, eventKey, versionId);
          if (!current || current.state !== 'available' || current.expires_at_ms !== raw.head.expires_at_ms
            || current.expires_at_ms <= time.effectiveNow || !row || row.content_hash !== snapshot.contentHash
            || row.expires_at_ms !== raw.row.expires_at_ms || row.expires_at_ms <= time.effectiveNow) fail('REVIEW_VERSION_CONFLICT');
        } });
    } catch (error) {
      return throwAfterExpiredCleanup(info, directory, eventKey, error, undefined, eventKey && directory ? {
        beforeBegin: () => reauthorizeRequest(info, request, eventId, 'purge_correction_history', actorId),
        boundary: boundaryFor(info, actorId, eventId, 'review.history.retention_purge', undefined, request,
          { reason: 'expired_history_version_read' }),
      } : undefined);
    } finally {
      indexKey.fill(0);
    }
  }

  async function listHistory(scope, eventIdValue, request) {
    const info = scopeInfo(scope);
    const eventId = validateEventId(eventIdValue);
    const actorId = await authorizeRequest(info, request, eventId, 'list_history');
    const indexKey = await indexKeyFor(info);
    let eventKey;
    let directory;
    try {
      eventKey = keyed(info, indexKey, 'event', eventId);
      directory = await tenantDirectory(info);
      const raw = await withTransaction(info, directory, (database, time) => {
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available') fail('REVIEW_EXPIRED');
        if (head.expires_at_ms <= time.now) fail('REVIEW_EXPIRED');
        const rows = database.prepare("SELECT * FROM versions WHERE event_key = ? AND state = 'available' ORDER BY revision ASC").all(eventKey);
        if (rows.length > limits.maxRevisionsPerHistory) fail('REVIEW_INTEGRITY');
        return { head, rows };
      }, undefined, undefined, { sync: true });
      const snapshots = [];
      for (const row of raw.rows) snapshots.push(await decryptVersion(info, row));
      const frozenSnapshots = Object.freeze(snapshots);
      await reauthorizeRequest(info, request, eventId, 'list_history', actorId);
      return await guardHistoryDisclosure({ info, directory, eventId, eventKey, actorId, request,
        action: 'list_history', snapshot: { versionId: raw.head.version_id, contentHash: raw.head.content_hash },
        value: frozenSnapshots, expiresAtMs: raw.head.expires_at_ms,
        details: { versionCount: raw.rows.length, versionIds: raw.rows.map((row) => row.version_id) },
        verify(database, time) {
          const current = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
          if (!current || current.state !== 'available' || current.version_id !== raw.head.version_id
            || current.content_hash !== raw.head.content_hash || current.expires_at_ms !== raw.head.expires_at_ms
            || current.expires_at_ms <= time.effectiveNow) fail('REVIEW_VERSION_CONFLICT');
          for (const expected of raw.rows) {
            const row = rowForVersion(database, eventKey, expected.version_id);
            if (!row || row.content_hash !== expected.content_hash || row.revision !== expected.revision
              || row.expires_at_ms !== expected.expires_at_ms || row.expires_at_ms <= time.effectiveNow) fail('REVIEW_VERSION_CONFLICT');
          }
        } });
    } catch (error) {
      return throwAfterExpiredCleanup(info, directory, eventKey, error, undefined, eventKey && directory ? {
        beforeBegin: () => reauthorizeRequest(info, request, eventId, 'purge_correction_history', actorId),
        boundary: boundaryFor(info, actorId, eventId, 'review.history.retention_purge', undefined, request,
          { reason: 'expired_history_list' }),
      } : undefined);
    } finally {
      indexKey.fill(0);
    }
  }

  async function registerDownstreamReference(scope, inputValue, request) {
    const info = scopeInfo(scope);
    const input = ownDataRecord(inputValue, new Set(['eventId', 'versionId', 'contentHash', 'referenceId', 'kind']));
    if (!input || !Object.hasOwn(input, 'eventId') || !Object.hasOwn(input, 'versionId')
      || !Object.hasOwn(input, 'contentHash') || !Object.hasOwn(input, 'referenceId') || !Object.hasOwn(input, 'kind')) fail();
    const eventId = validateEventId(input.eventId);
    const actorId = await authorizeRequest(info, request, eventId, 'record_downstream_reference');
    const versionId = validateIdentifier(input.versionId);
    if (typeof input.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.contentHash)) fail();
    const referenceId = validateIdentifier(input.referenceId);
    if (!['approval_reference', 'handoff_reference', 'consumer_reference'].includes(input.kind)) fail();
    const indexKey = await indexKeyFor(info);
    let payloadKey;
    let eventKey;
    let directory;
    try {
      eventKey = keyed(info, indexKey, 'event', eventId);
      const referenceHash = keyed(info, indexKey, 'reference', referenceId);
      directory = await tenantDirectory(info);
      const preflight = await withTransaction(info, directory, (database, time) => {
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available' || head.expires_at_ms <= time.now) fail('REVIEW_EXPIRED');
        if (head.version_id !== versionId || head.content_hash !== input.contentHash) fail('REVIEW_VERSION_CONFLICT');
        const compositionState = database.prepare('SELECT phase FROM correction_cache_state WHERE event_key = ?').get(eventKey);
        if (compositionState && compositionState.phase !== 'complete') fail('REVIEW_BUSY');
        const existing = database.prepare('SELECT * FROM downstream_references WHERE event_key = ? AND reference_hash = ?').get(eventKey, referenceHash);
        return { head, existing };
      }, undefined, undefined, { sync: true });
      if (preflight.existing) {
        const prior = await decryptReference(info, preflight.existing);
        if (prior.referenceId !== referenceId || prior.kind !== input.kind || prior.boundVersionId !== versionId
          || prior.boundContentHash !== input.contentHash) fail('REVIEW_REFERENCE_CONFLICT');
        await reauthorizeRequest(info, request, eventId, 'record_downstream_reference', actorId);
        const boundary = boundaryFor(info, actorId, eventId, 'private_profile.read', undefined, request, {
          sourceAction: 'record_downstream_reference', referenceId, kind: input.kind, versionId,
          contentHash: input.contentHash, replayed: true,
        }, preflight.head.expires_at_ms);
        return await withBindingTransaction(info, directory, (database, time) => {
          const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
          const current = database.prepare('SELECT * FROM downstream_references WHERE event_key = ? AND reference_hash = ?')
            .get(eventKey, referenceHash);
          if (!head || head.state !== 'available' || head.version_id !== versionId
            || head.content_hash !== input.contentHash || head.expires_at_ms !== preflight.head.expires_at_ms
            || head.expires_at_ms <= time.effectiveNow || !current || current.bound_version_id !== versionId
            || current.bound_content_hash !== input.contentHash || current.encryption_key_id !== preflight.existing.encryption_key_id
            || !Buffer.from(current.sealed).equals(Buffer.from(preflight.existing.sealed))) fail('REVIEW_BUSY');
          return Object.freeze({ referenceId, kind: input.kind, versionId, contentHash: input.contentHash, replayed: true });
        }, undefined, () => reauthorizeRequest(info, request, eventId, 'record_downstream_reference', actorId), boundary);
      }
      payloadKey = await payloadKeyFor(info);
      const boundary = boundaryFor(info, actorId, eventId, 'review.history.cache_bind_reference', undefined, request, {
        referenceId, referenceKind: input.kind, versionId, contentHash: input.contentHash,
      }, preflight.head.expires_at_ms);
      return await withBindingTransaction(info, directory, (database, time) => {
        const compositionState = database.prepare('SELECT phase FROM correction_cache_state WHERE event_key = ?').get(eventKey);
        if (compositionState && compositionState.phase !== 'complete') fail('REVIEW_BUSY');
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available' || head.expires_at_ms <= time.effectiveNow) fail('REVIEW_EXPIRED');
        if (head.version_id !== versionId || head.content_hash !== input.contentHash) fail('REVIEW_VERSION_CONFLICT');
        if (head.version_id !== preflight.head.version_id || head.content_hash !== preflight.head.content_hash
          || head.expires_at_ms !== preflight.head.expires_at_ms) fail('REVIEW_BUSY');
        if (database.prepare('SELECT 1 FROM downstream_references WHERE event_key = ? AND reference_hash = ?')
          .get(eventKey, referenceHash)) fail('REVIEW_BUSY');
        const count = database.prepare('SELECT COUNT(*) AS count FROM downstream_references WHERE event_key = ?').get(eventKey).count;
        if (count >= 128) fail('REVIEW_STORAGE_LIMIT');
        const document = {
          referenceId,
          kind: input.kind,
          boundVersionId: versionId,
          boundContentHash: input.contentHash,
          createdAt: new Date(time.now).toISOString(),
        };
        const sealed = seal(info, `${eventKey}:${referenceHash}:${versionId}`, 'reference', payloadKey.keyId, payloadKey.key, document);
        const usedBytes = database.prepare("SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM versions WHERE state = 'available'").get().bytes
          + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM downstream_references').get().bytes
          + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM correction_cache_bindings').get().bytes;
        if (usedBytes + sealed.byteLength > limits.maxStoredBytes) fail('REVIEW_STORAGE_LIMIT');
        database.prepare(`INSERT INTO downstream_references
          (event_key, reference_hash, bound_version_id, bound_content_hash, encryption_key_id, sealed)
          VALUES (?, ?, ?, ?, ?, ?)`).run(eventKey, referenceHash, versionId, input.contentHash, payloadKey.keyId, sealed);
        return Object.freeze({ referenceId, kind: input.kind, versionId, contentHash: input.contentHash, replayed: false });
      }, undefined, () => reauthorizeRequest(info, request, eventId, 'record_downstream_reference', actorId), boundary);
    } catch (error) {
      const cleanup = eventKey && directory ? {
        beforeBegin: () => reauthorizeRequest(info, request, eventId, 'purge_correction_history', actorId),
        boundary: boundaryFor(info, actorId, eventId, 'review.history.retention_purge', undefined, request,
          { reason: 'expired_downstream_reference_write' }),
      } : undefined;
      return throwAfterExpiredCleanup(info, directory, eventKey, error, undefined, cleanup);
    } finally {
      indexKey.fill(0);
      payloadKey?.key.fill(0);
    }
  }

  async function listDownstreamReferences(scope, eventIdValue, request) {
    const info = scopeInfo(scope);
    const eventId = validateEventId(eventIdValue);
    const actorId = await authorizeRequest(info, request, eventId, 'read_downstream_references');
    const indexKey = await indexKeyFor(info);
    let eventKey;
    let directory;
    try {
      eventKey = keyed(info, indexKey, 'event', eventId);
      directory = await tenantDirectory(info);
      const raw = await withTransaction(info, directory, (database, time) => {
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available' || head.expires_at_ms <= time.now) fail('REVIEW_EXPIRED');
        const rows = database.prepare('SELECT * FROM downstream_references WHERE event_key = ? LIMIT 129').all(eventKey);
        if (rows.length > 128) fail('REVIEW_INTEGRITY');
        const references = rows.map((row) => {
          const current = row.bound_version_id === head.version_id && row.bound_content_hash === head.content_hash;
          const invalidation = current ? null : database.prepare(`SELECT * FROM invalidations WHERE event_key = ? AND reference_hash = ?
            AND prior_version_id = ? AND prior_content_hash = ?`).get(eventKey, row.reference_hash, row.bound_version_id, row.bound_content_hash);
          if (!current && !invalidation) fail('REVIEW_INTEGRITY');
          return { row, current, invalidation };
        });
        return { head, references };
      }, undefined, undefined, { sync: true });
      const output = [];
      for (const { row, current, invalidationRow } of raw.references) {
        const reference = await decryptReference(info, row);
        output.push(Object.freeze({
          referenceId: reference.referenceId,
          kind: reference.kind,
          boundVersionId: reference.boundVersionId,
          boundContentHash: reference.boundContentHash,
          state: current ? 'bound_to_version' : 'invalidated',
          ...(invalidationRow ? {
            invalidatedByVersionId: invalidationRow.next_version_id,
            reason: invalidationRow.reason,
            materialChange: Boolean(invalidationRow.material_change),
          } : {}),
        }));
      }
      output.sort((left, right) => left.referenceId.localeCompare(right.referenceId));
      const result = Object.freeze(output);
      await reauthorizeRequest(info, request, eventId, 'read_downstream_references', actorId);
      return await guardHistoryDisclosure({ info, directory, eventId, eventKey, actorId, request,
        action: 'read_downstream_references', snapshot: { versionId: raw.head.version_id, contentHash: raw.head.content_hash },
        value: result, expiresAtMs: raw.head.expires_at_ms,
        details: { referenceCount: raw.references.length },
        verify(database, time) {
          const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
          if (!head || head.state !== 'available' || head.version_id !== raw.head.version_id
            || head.content_hash !== raw.head.content_hash || head.expires_at_ms !== raw.head.expires_at_ms
            || head.expires_at_ms <= time.effectiveNow) fail('REVIEW_VERSION_CONFLICT');
          for (const { row, invalidationRow } of raw.references) {
            const current = database.prepare('SELECT * FROM downstream_references WHERE event_key = ? AND reference_hash = ?')
              .get(eventKey, row.reference_hash);
            if (!current || current.bound_version_id !== row.bound_version_id || current.bound_content_hash !== row.bound_content_hash
              || current.encryption_key_id !== row.encryption_key_id || !Buffer.from(current.sealed).equals(Buffer.from(row.sealed))) fail('REVIEW_VERSION_CONFLICT');
            if (invalidationRow) {
              const invalidation = database.prepare(`SELECT * FROM invalidations WHERE event_key = ? AND reference_hash = ?
                AND prior_version_id = ? AND prior_content_hash = ?`).get(eventKey, row.reference_hash, row.bound_version_id, row.bound_content_hash);
              if (!invalidation || invalidation.next_version_id !== invalidationRow.next_version_id
                || invalidation.reason !== invalidationRow.reason) fail('REVIEW_VERSION_CONFLICT');
            }
          }
        } });
    } catch (error) {
      const cleanup = eventKey && directory ? {
        beforeBegin: () => reauthorizeRequest(info, request, eventId, 'purge_correction_history', actorId),
        boundary: boundaryFor(info, actorId, eventId, 'review.history.retention_purge', undefined, request,
          { reason: 'expired_downstream_reference_read' }),
      } : undefined;
      return throwAfterExpiredCleanup(info, directory, eventKey, error, undefined, cleanup);
    } finally {
      indexKey.fill(0);
    }
  }

  async function purgeExpired(scope, request) {
    const info = scopeInfo(scope);
    const actorId = await authorizeRequest(info, request, null, 'purge_correction_history');
    const directory = await tenantDirectory(info);
    try {
      const purged = await withBindingTransaction(info, directory, (database, time) => {
        const now = time.effectiveNow;
        normalizeExpiredTombstones(database);
        database.prepare('DELETE FROM correction_cache_bindings WHERE expires_at_ms <= ?').run(now);
        const expiredEvents = database.prepare("SELECT event_key FROM heads WHERE state = 'available' AND expires_at_ms <= ? LIMIT ?")
          .all(now, limits.maxHistories);
        let purged = 0;
        for (const row of expiredEvents) if (expireHistory(database, row.event_key, now)) purged += 1;
        return purged;
      }, undefined, () => reauthorizeRequest(info, request, null, 'purge_correction_history', actorId),
      boundaryFor(info, actorId, null, 'review.history.retention_purge', undefined, request,
        { scope: 'tenant', maximumHistories: limits.maxHistories }));
      return purged;
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async function bindingContext(scope, request, eventIdValue, action, field = undefined) {
    const info = scopeInfo(scope);
    const eventId = validateEventId(eventIdValue);
    const actorId = await authorizeRequest(info, request, eventId, action, field);
    const indexKey = await indexKeyFor(info);
    let transferred = false;
    try {
      const eventKey = keyed(info, indexKey, 'event', eventId);
      const directory = await tenantDirectory(info);
      const context = Object.freeze({ scope, info, eventId, actorId, indexKey, eventKey, directory, request, action, field });
      transferred = true;
      return context;
    } finally {
      if (!transferred) indexKey.fill(0);
    }
  }

  function disposeBindingContext(context) {
    context.indexKey.fill(0);
  }

  async function bindingReadHead(context, request = context.request, action = context.action) {
    try {
      await reauthorizeRequest(context.info, request, context.eventId, action, context.actorId, context.field);
      const raw = await withTransaction(context.info, context.directory, (database, time) => {
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(context.eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available' || head.expires_at_ms <= time.now) fail('REVIEW_EXPIRED');
        const row = rowForVersion(database, context.eventKey, head.version_id);
        if (!row) fail('REVIEW_INTEGRITY');
        return { head, row };
      }, undefined, undefined, { sync: true });
      const snapshot = await decryptVersion(context.info, raw.row);
      await reauthorizeRequest(context.info, request, context.eventId, action, context.actorId, context.field);
      const result = Object.freeze({ snapshot, expiresAtMs: raw.head.expires_at_ms, eventKey: context.eventKey });
      return await guardHistoryDisclosure({ info: context.info, directory: context.directory,
        eventId: context.eventId, eventKey: context.eventKey, actorId: context.actorId, request, action,
        field: context.field, snapshot, value: result, expiresAtMs: raw.head.expires_at_ms,
        verify(database, time) {
          const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(context.eventKey);
          const row = rowForVersion(database, context.eventKey, snapshot.versionId);
          if (!head || head.state !== 'available' || head.version_id !== snapshot.versionId
            || head.content_hash !== snapshot.contentHash || head.expires_at_ms !== raw.head.expires_at_ms
            || head.expires_at_ms <= time.effectiveNow || !row || row.content_hash !== snapshot.contentHash
            || row.expires_at_ms <= time.effectiveNow) fail('REVIEW_VERSION_CONFLICT');
        } });
    } catch (error) {
      return throwAfterExpiredCleanup(context.info, context.directory, context.eventKey, error, undefined, {
        beforeBegin: () => reauthorizeRequest(context.info, request, context.eventId, 'purge_correction_history', context.actorId),
        boundary: boundaryFor(context.info, context.actorId, context.eventId, 'review.history.retention_purge', undefined, request,
          { reason: 'expired_binding_head_read' }),
      });
    }
  }

  async function bindingPreflightBindHead(context, operationKeyValue, normalizedInput, request = context.request) {
    const operationKey = validateIdentifier(operationKeyValue, 180);
    if (!isRecord(normalizedInput)) fail('REVIEW_INVALID');
    try {
      await reauthorizeRequest(context.info, request, context.eventId, 'read_history', context.actorId);
      const operationHash = keyed(context.info, context.indexKey, 'binding-operation', operationKey);
      const operationFingerprint = fingerprint(context.indexKey, context.info, context.eventKey, context.actorId,
        'correction_cache_bind', normalizedInput);
      const raw = await withBindingTransaction(context.info, context.directory, (database, time) => {
        const now = time.now;
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(context.eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available' || head.expires_at_ms <= now) fail('REVIEW_EXPIRED');
        const receipt = database.prepare(`SELECT * FROM correction_cache_operations
          WHERE event_key = ? AND operation_hash = ?`).get(context.eventKey, operationHash);
        const state = database.prepare('SELECT * FROM correction_cache_state WHERE event_key = ?').get(context.eventKey);
        if (receipt) {
          if (receipt.kind !== 'bind' || receipt.fingerprint !== operationFingerprint) fail('REVIEW_IDEMPOTENCY_CONFLICT');
          if (receipt.target_version_id) {
            const target = rowForVersion(database, context.eventKey, receipt.target_version_id);
            if (!target || target.expires_at_ms <= now) fail('REVIEW_EXPIRED');
            return { row: target, head, state, receipt, expiresAtMs: target.expires_at_ms };
          }
          if (!state || state.operation_id !== receipt.operation_id || state.phase !== 'pending_bind'
            || state.base_version_id !== head.version_id || state.base_content_hash !== head.content_hash) fail('REVIEW_BUSY');
          const base = rowForVersion(database, context.eventKey, state.base_version_id);
          if (!base || base.content_hash !== state.base_content_hash) fail('REVIEW_INTEGRITY');
          return { row: base, head, state, receipt, expiresAtMs: base.expires_at_ms };
        }
        if (state && state.phase !== 'complete') fail('REVIEW_BUSY');
        const row = rowForVersion(database, context.eventKey, head.version_id);
        if (!row || row.content_hash !== head.content_hash) fail('REVIEW_INTEGRITY');
        if (row.expires_at_ms <= now) fail('REVIEW_EXPIRED');
        return { row, head, state, receipt: null, expiresAtMs: row.expires_at_ms };
      });
      const snapshot = await decryptVersion(context.info, raw.row);
      await reauthorizeRequest(context.info, request, context.eventId, 'read_history', context.actorId);
      const result = Object.freeze({ snapshot, expiresAtMs: raw.expiresAtMs, eventKey: context.eventKey });
      const allowPendingOperation = raw.state?.phase === 'pending_bind' ? {
        operationId: raw.state.operation_id, fence: raw.state.fence, phase: 'pending_bind',
      } : undefined;
      return await guardHistoryDisclosure({ info: context.info, directory: context.directory,
        eventId: context.eventId, eventKey: context.eventKey, actorId: context.actorId, request,
        action: 'read_history', snapshot, value: result,
        expiresAtMs: Math.min(raw.expiresAtMs, raw.head.expires_at_ms),
        details: { bindingOperationId: allowPendingOperation?.operationId ?? null,
          bindingOperationFence: allowPendingOperation?.fence ?? null },
        allowPendingOperation,
        verify(database, time) {
          const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(context.eventKey);
          const row = rowForVersion(database, context.eventKey, snapshot.versionId);
          if (!head || head.state !== 'available' || head.version_id !== raw.head.version_id
            || head.content_hash !== raw.head.content_hash || head.expires_at_ms !== raw.head.expires_at_ms
            || head.expires_at_ms <= time.effectiveNow || !row || row.content_hash !== snapshot.contentHash
            || row.expires_at_ms !== raw.row.expires_at_ms || row.expires_at_ms <= time.effectiveNow) fail('REVIEW_VERSION_CONFLICT');
        } });
    } catch (error) {
      return throwAfterExpiredCleanup(context.info, context.directory, context.eventKey, error, undefined, {
        beforeBegin: () => reauthorizeRequest(context.info, request, context.eventId, 'purge_correction_history', context.actorId),
        boundary: boundaryFor(context.info, context.actorId, context.eventId, 'review.history.retention_purge', undefined, request,
          { reason: 'expired_binding_preflight_read' }),
      });
    }
  }

  async function bindingReadVersion(context, versionIdValue, request = context.request, action = 'read_history_version',
    pendingOperation = undefined) {
    const versionId = validateIdentifier(versionIdValue);
    try {
      await reauthorizeRequest(context.info, request, context.eventId, action, context.actorId, context.field);
      const raw = await withTransaction(context.info, context.directory, (database, time) => {
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(context.eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available' || head.expires_at_ms <= time.now) fail('REVIEW_EXPIRED');
        const selected = rowForVersion(database, context.eventKey, versionId);
        if (!selected) fail('REVIEW_NOT_FOUND');
        if (selected.expires_at_ms <= time.now) fail('REVIEW_EXPIRED');
        const state = database.prepare(`SELECT phase, operation_id, fence, base_version_id, base_content_hash,
          target_version_id, target_content_hash FROM correction_cache_state WHERE event_key = ?`).get(context.eventKey);
        return { head, row: selected, state };
      }, undefined, undefined, { sync: true });
      const snapshot = await decryptVersion(context.info, raw.row);
      await reauthorizeRequest(context.info, request, context.eventId, action, context.actorId, context.field);
      let allowPendingOperation;
      if (pendingOperation !== undefined) {
        const pending = ownDataRecord(pendingOperation, new Set([
          'operationId', 'fence', 'kind', 'phase', 'baseVersionId', 'baseContentHash', 'targetVersionId', 'targetContentHash',
        ]));
        if (!pending || !validSafeString(pending.operationId, 1, 180) || !Number.isSafeInteger(pending.fence)
          || pending.fence < 1 || !['bind', 'correction', 'source_refresh'].includes(pending.kind)
          || !['pending_bind', 'pending_correction', 'history_committed', 'cache_invalidating'].includes(pending.phase)
          || !validSafeString(pending.baseVersionId, 1, 180) || !/^[a-f0-9]{64}$/.test(pending.baseContentHash)
          || (pending.phase === 'pending_bind' && pending.kind !== 'bind')
          || (pending.phase !== 'pending_bind' && pending.kind === 'bind')
          || (pending.targetVersionId !== undefined && pending.targetVersionId !== null
            && !validSafeString(pending.targetVersionId, 1, 180))
          || (pending.targetContentHash !== undefined && pending.targetContentHash !== null
            && !/^[a-f0-9]{64}$/.test(pending.targetContentHash))) fail('REVIEW_DENIED');
        if (!raw.state || raw.state.phase !== pending.phase || raw.state.operation_id !== pending.operationId
          || raw.state.fence !== pending.fence || raw.state.base_version_id !== pending.baseVersionId
          || raw.state.base_content_hash !== pending.baseContentHash) fail('REVIEW_BUSY');
        const pendingVersionId = pending.phase === 'pending_bind' || pending.phase === 'pending_correction'
          ? pending.baseVersionId : pending.targetVersionId;
        if (!pendingVersionId || versionId !== pendingVersionId
          || (pending.targetVersionId !== undefined && pending.targetVersionId !== null
            && raw.state.target_version_id !== pending.targetVersionId)
          || (pending.targetContentHash !== undefined && pending.targetContentHash !== null
            && raw.state.target_content_hash !== pending.targetContentHash)) fail('REVIEW_BUSY');
        allowPendingOperation = { operationId: pending.operationId, fence: pending.fence, phase: pending.phase };
      }
      return await guardHistoryDisclosure({ info: context.info, directory: context.directory,
        eventId: context.eventId, eventKey: context.eventKey, actorId: context.actorId, request, action,
        details: allowPendingOperation ? {
          bindingOperationId: allowPendingOperation.operationId,
          bindingOperationFence: allowPendingOperation.fence,
          bindingOperationPhase: allowPendingOperation.phase,
        } : {},
        field: context.field, snapshot, expiresAtMs: Math.min(raw.head.expires_at_ms, raw.row.expires_at_ms),
        allowPendingOperation,
        verify(database, time) {
          const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(context.eventKey);
          const state = database.prepare(`SELECT phase, operation_id, fence, base_version_id, base_content_hash,
            target_version_id, target_content_hash FROM correction_cache_state WHERE event_key = ?`).get(context.eventKey);
          const row = rowForVersion(database, context.eventKey, versionId);
          if (!head || head.state !== 'available' || head.expires_at_ms !== raw.head.expires_at_ms
            || head.expires_at_ms <= time.effectiveNow || !row || row.content_hash !== snapshot.contentHash
            || row.expires_at_ms !== raw.row.expires_at_ms || row.expires_at_ms <= time.effectiveNow
            || head.version_id !== raw.head.version_id || head.content_hash !== raw.head.content_hash
            || (allowPendingOperation && (!state || state.phase !== allowPendingOperation.phase
              || state.operation_id !== allowPendingOperation.operationId || state.fence !== allowPendingOperation.fence
              || state.base_version_id !== pendingOperation.baseVersionId
              || state.base_content_hash !== pendingOperation.baseContentHash))) fail('REVIEW_VERSION_CONFLICT');
        } });
    } catch (error) {
      return throwAfterExpiredCleanup(context.info, context.directory, context.eventKey, error, undefined, {
        beforeBegin: () => reauthorizeRequest(context.info, request, context.eventId, 'purge_correction_history', context.actorId),
        boundary: boundaryFor(context.info, context.actorId, context.eventId, 'review.history.retention_purge', undefined, request,
          { reason: 'expired_binding_version_read' }),
      });
    }
  }

  async function beginBindingOperation(context, specValue, request, signal) {
    throwIfAborted(signal);
    const spec = ownDataRecord(specValue, new Set([
      'kind', 'operationKey', 'normalizedInput', 'baseVersionId', 'baseContentHash', 'action', 'field',
    ]));
    if (!spec || !['bind', 'correction', 'source_refresh'].includes(spec.kind)
      || !validSafeString(spec.operationKey, 1, 180) || !isRecord(spec.normalizedInput)
      || ((spec.baseVersionId === undefined) !== (spec.baseContentHash === undefined))
      || (spec.baseVersionId !== undefined && (!validSafeString(spec.baseVersionId, 1, 180)
        || typeof spec.baseContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(spec.baseContentHash)))
      || (spec.kind !== 'bind' && spec.baseVersionId === undefined)
      || !validSafeString(spec.action, 1, 80)
      || (spec.field !== undefined && !validSafeString(spec.field, 1, 80))) fail();
    await reauthorizeRequest(context.info, request, context.eventId, spec.action, context.actorId, spec.field);
    throwIfAborted(signal);
    const operationHash = keyed(context.info, context.indexKey, 'binding-operation', spec.operationKey);
    const operationFingerprint = fingerprint(context.indexKey, context.info, context.eventKey, context.actorId,
      `correction_cache_${spec.kind}`, spec.normalizedInput);
    const phase = spec.kind === 'bind' ? 'pending_bind' : 'pending_correction';
    const candidate = await withTransaction(context.info, context.directory, (database, time) => {
      const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(context.eventKey);
      if (!head || head.state !== 'available') fail(head ? 'REVIEW_EXPIRED' : 'REVIEW_NOT_FOUND');
      if (head.expires_at_ms <= time.now) fail('REVIEW_EXPIRED');
      const receipt = database.prepare('SELECT * FROM correction_cache_operations WHERE event_key = ? AND operation_hash = ?')
        .get(context.eventKey, operationHash);
      const state = database.prepare('SELECT * FROM correction_cache_state WHERE event_key = ?').get(context.eventKey);
      const baseVersionId = spec.baseVersionId ?? head.version_id;
      const baseContentHash = spec.baseContentHash ?? head.content_hash;
      return { head, receipt, state, baseVersionId, baseContentHash };
    }, signal, undefined, { sync: true });
    if (!candidate.receipt?.target_version_id
      && (candidate.head.version_id !== candidate.baseVersionId || candidate.head.content_hash !== candidate.baseContentHash)) {
      fail('REVIEW_VERSION_CONFLICT');
    }
    if (candidate.receipt && (candidate.receipt.fingerprint !== operationFingerprint || candidate.receipt.kind !== spec.kind)) {
      fail('REVIEW_IDEMPOTENCY_CONFLICT');
    }
    const resumesPending = candidate.receipt && !candidate.receipt.target_version_id
      && candidate.state?.operation_id === candidate.receipt.operation_id && candidate.state.phase !== 'complete';
    const candidateOperationId = candidate.receipt?.operation_id ?? randomUUID();
    const candidateFence = resumesPending ? candidate.state.fence + 1
      : candidate.receipt?.target_version_id ? Math.max(1, candidate.state?.fence ?? 1)
        : (candidate.state?.fence ?? 0) + 1;
    const boundaryAction = spec.kind === 'bind' ? 'review.history.cache_bind_begin' : 'review.history.revision_begin';
    const boundary = boundaryFor(context.info, context.actorId, context.eventId, boundaryAction, spec.field, request, {
      operationId: candidateOperationId,
      fence: candidateFence,
      operationFingerprint,
      kind: spec.kind,
      baseVersionId: candidate.baseVersionId,
      baseContentHash: candidate.baseContentHash,
      expiresAtMs: candidate.head.expires_at_ms,
    }, candidate.head.expires_at_ms);
    return withBindingTransaction(context.info, context.directory, (database, time) => {
      const now = time.now;
      const effectiveNow = time.effectiveNow;
      const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(context.eventKey);
      if (!head || head.state !== 'available') fail(head ? 'REVIEW_EXPIRED' : 'REVIEW_NOT_FOUND');
      if (head.version_id !== candidate.head.version_id || head.content_hash !== candidate.head.content_hash
        || head.expires_at_ms !== candidate.head.expires_at_ms || head.expires_at_ms <= effectiveNow) fail('REVIEW_BUSY');
      const baseVersionId = spec.baseVersionId ?? head.version_id;
      const baseContentHash = spec.baseContentHash ?? head.content_hash;
      const receipt = database.prepare('SELECT * FROM correction_cache_operations WHERE event_key = ? AND operation_hash = ?')
        .get(context.eventKey, operationHash);
      const state = database.prepare('SELECT * FROM correction_cache_state WHERE event_key = ?').get(context.eventKey);
      if ((receipt?.operation_id ?? null) !== (candidate.receipt?.operation_id ?? null)
        || (receipt?.fingerprint ?? null) !== (candidate.receipt?.fingerprint ?? null)
        || (state?.operation_id ?? null) !== (candidate.state?.operation_id ?? null)
        || (state?.fence ?? null) !== (candidate.state?.fence ?? null)
        || (state?.phase ?? null) !== (candidate.state?.phase ?? null)) fail('REVIEW_BUSY');
      if (receipt) {
        if (receipt.fingerprint !== operationFingerprint || receipt.kind !== spec.kind) fail('REVIEW_IDEMPOTENCY_CONFLICT');
        if (state?.operation_id === receipt.operation_id && state.phase !== 'complete') {
          const expectedHead = ['history_committed', 'cache_invalidating'].includes(state.phase)
            ? state.target_version_id : state.base_version_id;
          if (expectedHead && head.version_id !== expectedHead) fail('REVIEW_VERSION_CONFLICT');
          const nextFence = candidateFence;
          database.prepare('UPDATE correction_cache_state SET fence = ?, updated_at_ms = ? WHERE event_key = ? AND operation_id = ? AND fence = ?')
            .run(nextFence, now, context.eventKey, state.operation_id, state.fence);
          return Object.freeze({ operationId: receipt.operation_id, bindingId: receipt.binding_id, fence: nextFence,
            kind: spec.kind, phase: state.phase, baseVersionId: state.base_version_id, baseContentHash: state.base_content_hash,
            targetVersionId: state.target_version_id, targetContentHash: state.target_content_hash, replayed: false });
        }
        if (receipt.target_version_id) {
          return Object.freeze({ operationId: receipt.operation_id, bindingId: receipt.binding_id,
            fence: state?.fence ?? 0, kind: spec.kind, phase: 'complete', baseVersionId: spec.baseVersionId,
            baseContentHash: spec.baseContentHash, targetVersionId: receipt.target_version_id,
            targetContentHash: receipt.target_content_hash, replayed: true });
        }
        fail('REVIEW_BUSY');
      }
      if (state && state.phase !== 'complete') fail('REVIEW_BUSY');
      if (head.version_id !== baseVersionId || head.content_hash !== baseContentHash) fail('REVIEW_VERSION_CONFLICT');
      if (head.expires_at_ms <= effectiveNow) fail('REVIEW_EXPIRED');
      const count = database.prepare('SELECT COUNT(*) AS count FROM correction_cache_operations WHERE event_key = ?').get(context.eventKey).count;
      if (count >= limits.maxRevisionsPerHistory + 128) fail('REVIEW_STORAGE_LIMIT');
      const operationId = candidateOperationId;
      const bindingId = spec.kind === 'bind' ? randomUUID() : null;
      const fence = candidateFence;
      database.prepare(`INSERT INTO correction_cache_operations
        (event_key, operation_hash, fingerprint, operation_id, binding_id, kind, target_version_id, target_content_hash)
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL)`).run(context.eventKey, operationHash, operationFingerprint,
        operationId, bindingId, spec.kind);
      database.prepare(`INSERT INTO correction_cache_state
        (event_key, operation_id, operation_hash, fingerprint, binding_id, fence, kind, phase,
         base_version_id, base_content_hash, target_version_id, target_content_hash, updated_at_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
        ON CONFLICT(event_key) DO UPDATE SET operation_id = excluded.operation_id,
          operation_hash = excluded.operation_hash, fingerprint = excluded.fingerprint, binding_id = excluded.binding_id,
          fence = excluded.fence, kind = excluded.kind, phase = excluded.phase,
          base_version_id = excluded.base_version_id, base_content_hash = excluded.base_content_hash,
          target_version_id = NULL, target_content_hash = NULL, updated_at_ms = excluded.updated_at_ms`)
        .run(context.eventKey, operationId, operationHash, operationFingerprint, bindingId, fence,
          spec.kind, phase, baseVersionId, baseContentHash, now);
      return Object.freeze({ operationId, bindingId, fence, kind: spec.kind, phase,
        baseVersionId, baseContentHash,
        targetVersionId: null, targetContentHash: null, replayed: false });
    }, signal, () => reauthorizeRequest(context.info, request, context.eventId,
      spec.action, context.actorId, spec.field), boundary);
  }

  function validateBindingRevisionInput(context, kind, inputValue) {
    if (!context || !['correction', 'source_refresh'].includes(kind)) fail('REVIEW_INVALID');
    const allowed = kind === 'correction'
      ? new Set(['eventId', 'baseVersionId', 'baseContentHash', 'field', 'value', 'idempotencyKey', 'retentionHandle'])
      : new Set(['eventId', 'baseVersionId', 'baseContentHash', 'sourceFacts', 'idempotencyKey', 'retentionHandle']);
    const input = ownDataRecord(inputValue, allowed);
    if (!input || !Object.hasOwn(input, 'eventId') || !Object.hasOwn(input, 'baseVersionId')
      || !Object.hasOwn(input, 'baseContentHash') || !Object.hasOwn(input, 'idempotencyKey')) fail('REVIEW_INVALID');
    if (validateEventId(input.eventId) !== context.eventId) fail('REVIEW_INVALID');
    validateIdentifier(input.baseVersionId);
    if (typeof input.baseContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.baseContentHash)) fail('REVIEW_INVALID');
    validateIdentifier(input.idempotencyKey, 180);
    if (kind === 'correction') {
      const field = fieldKey(input.field, allowedFields);
      if (lockedFields.has(field)) fail('REVIEW_FIELD_LOCKED');
      validateFieldValue(field, input.value);
    } else {
      if (!Object.hasOwn(input, 'sourceFacts')) fail('REVIEW_INVALID');
      sourceFacts(input.sourceFacts, allowedFields);
    }
    return true;
  }

  async function bindingApplyHistoryOperation(context, operation, input, request, signal) {
    const options = signal === undefined ? undefined : Object.freeze({ signal });
    if (operation.kind === 'correction') return applyCorrection(context.scope, input, request, options, { context, operation });
    if (operation.kind === 'source_refresh') return refreshSources(context.scope, input, request, options, { context, operation });
    fail('REVIEW_INVALID');
  }

  async function bindingAddCacheProfile(context, operation, profile) {
    const input = ownDataRecord(profile, new Set([
      'profileRef', 'cacheVersion', 'scopeKind', 'identity', 'pins', 'cacheBindingHash', 'cacheSourceContentHash',
      'historyProjectionHash', 'cacheExpiresAtMs', 'historyExpiresAtMs',
    ]));
    if (!operation || operation.kind !== 'bind' || !operation.bindingId || !input
      || !validSafeString(input.profileRef, 1, 128) || !Number.isSafeInteger(input.cacheVersion) || input.cacheVersion < 1
      || input.scopeKind !== 'tenant_private' || !isRecord(input.identity) || !isRecord(input.pins)
      || typeof input.cacheBindingHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.cacheBindingHash)
      || typeof input.cacheSourceContentHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.cacheSourceContentHash)
      || typeof input.historyProjectionHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.historyProjectionHash)
      || !Number.isSafeInteger(input.cacheExpiresAtMs) || !Number.isSafeInteger(input.historyExpiresAtMs)) fail();
    await reauthorizeRequest(context.info, context.request, context.eventId, 'record_downstream_reference', context.actorId);
    const payloadKey = await payloadKeyFor(context.info);
    try {
      const bindingHash = keyed(context.info, context.indexKey, 'binding', operation.bindingId);
      const referenceHash = keyed(context.info, context.indexKey, 'reference', operation.bindingId);
      const expiresAtMs = Math.min(input.cacheExpiresAtMs, input.historyExpiresAtMs);
      if (expiresAtMs <= nowMs()) fail('REVIEW_EXPIRED');
      const bindingPayload = {
        schemaVersion: 1,
        bindingId: operation.bindingId,
        operationId: operation.operationId,
        eventId: context.eventId,
        historyVersionId: operation.baseVersionId,
        historyContentHash: operation.baseContentHash,
        historyProjectionHash: input.historyProjectionHash,
        profileRef: input.profileRef,
        cacheVersion: input.cacheVersion,
        scopeKind: input.scopeKind,
        cacheBindingHash: input.cacheBindingHash,
        identity: input.identity,
        pins: input.pins,
        cacheSourceContentHash: input.cacheSourceContentHash,
        cacheExpiresAtMs: input.cacheExpiresAtMs,
        historyExpiresAtMs: input.historyExpiresAtMs,
        expiresAtMs,
      };
      const sealedBinding = seal(context.info, `${context.eventKey}:${bindingHash}:${operation.baseVersionId}`,
        'cache_binding', payloadKey.keyId, payloadKey.key, bindingPayload);
      const referencePayload = {
        referenceId: operation.bindingId,
        kind: 'consumer_reference',
        boundVersionId: operation.baseVersionId,
        boundContentHash: operation.baseContentHash,
        createdAt: new Date(nowMs()).toISOString(),
      };
      const sealedReference = seal(context.info, `${context.eventKey}:${referenceHash}:${operation.baseVersionId}`,
        'reference', payloadKey.keyId, payloadKey.key, referencePayload);
      const boundary = boundaryFor(context.info, context.actorId, context.eventId,
        'review.history.cache_bind_reference', undefined, context.request, {
          operationId: operation.operationId,
          fence: operation.fence,
          bindingId: operation.bindingId,
          profileRef: input.profileRef,
          cacheVersion: input.cacheVersion,
          cacheBindingHash: input.cacheBindingHash,
          identity: input.identity,
          pins: input.pins,
          cacheSourceContentHash: input.cacheSourceContentHash,
          historyVersionId: operation.baseVersionId,
          historyContentHash: operation.baseContentHash,
          expiresAtMs,
        }, expiresAtMs);
      await withBindingTransaction(context.info, context.directory, (database, time) => {
        const now = time.now;
        const effectiveNow = time.effectiveNow;
        const state = database.prepare('SELECT * FROM correction_cache_state WHERE event_key = ?').get(context.eventKey);
        if (!state || state.operation_id !== operation.operationId || state.fence !== operation.fence
          || state.phase !== 'pending_bind') fail('REVIEW_BUSY');
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(context.eventKey);
        if (!head || head.state !== 'available' || head.version_id !== operation.baseVersionId
          || head.content_hash !== operation.baseContentHash || head.expires_at_ms <= effectiveNow) fail('REVIEW_VERSION_CONFLICT');
        if (database.prepare('SELECT 1 AS found FROM correction_cache_bindings WHERE event_key = ? AND binding_hash = ?')
          .get(context.eventKey, bindingHash)) fail('REVIEW_REFERENCE_CONFLICT');
        const refCount = database.prepare('SELECT COUNT(*) AS count FROM downstream_references WHERE event_key = ?').get(context.eventKey).count;
        if (refCount >= 128) fail('REVIEW_STORAGE_LIMIT');
        const usedBytes = database.prepare("SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM versions WHERE state = 'available'").get().bytes
          + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM downstream_references').get().bytes
          + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM correction_cache_bindings').get().bytes;
        if (usedBytes + sealedBinding.byteLength + sealedReference.byteLength > limits.maxStoredBytes) fail('REVIEW_STORAGE_LIMIT');
        database.prepare(`INSERT INTO downstream_references
          (event_key, reference_hash, bound_version_id, bound_content_hash, encryption_key_id, sealed)
          VALUES (?, ?, ?, ?, ?, ?)`).run(context.eventKey, referenceHash, operation.baseVersionId,
          operation.baseContentHash, payloadKey.keyId, sealedReference);
        database.prepare(`INSERT INTO correction_cache_bindings
          (event_key, binding_hash, bound_version_id, bound_content_hash, expires_at_ms, encryption_key_id, sealed,
           last_invalidation_operation_id, last_invalidation_target_version_id, last_invalidation_target_hash)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL)`)
          .run(context.eventKey, bindingHash, operation.baseVersionId, operation.baseContentHash, expiresAtMs,
            payloadKey.keyId, sealedBinding);
        database.prepare(`UPDATE correction_cache_state SET phase = 'complete', target_version_id = ?,
          target_content_hash = ?, updated_at_ms = ? WHERE event_key = ? AND operation_id = ? AND fence = ?`)
          .run(operation.baseVersionId, operation.baseContentHash, now, context.eventKey, operation.operationId, operation.fence);
        database.prepare(`UPDATE correction_cache_operations SET target_version_id = ?, target_content_hash = ?
          WHERE event_key = ? AND operation_hash = ? AND operation_id = ?`)
          .run(operation.baseVersionId, operation.baseContentHash, context.eventKey, state.operation_hash, operation.operationId);
      }, undefined, () => reauthorizeRequest(context.info, context.request, context.eventId,
        'record_downstream_reference', context.actorId), boundary);
      return Object.freeze({ bindingId: operation.bindingId, profileRef: input.profileRef, replayed: false });
    } finally {
      payloadKey.key.fill(0);
    }
  }

  async function bindingRows(context, versionId = undefined, contentHash = undefined) {
    const rows = await withBindingTransaction(context.info, context.directory, (database, time) => {
      database.prepare('DELETE FROM correction_cache_bindings WHERE event_key = ? AND expires_at_ms <= ?')
        .run(context.eventKey, time.effectiveNow);
      if (versionId === undefined) return database.prepare('SELECT * FROM correction_cache_bindings WHERE event_key = ? ORDER BY binding_hash')
        .all(context.eventKey);
      return database.prepare(`SELECT * FROM correction_cache_bindings WHERE event_key = ? AND bound_version_id = ?
        AND bound_content_hash = ? ORDER BY binding_hash`).all(context.eventKey, versionId, contentHash);
    }, undefined, () => reauthorizeRequest(context.info, context.request, context.eventId,
      context.action, context.actorId, context.field), boundaryFor(context.info, context.actorId, context.eventId,
      'review.history.retention_purge', context.field, context.request, {
        expiredBindingsOnly: true,
        versionId: versionId ?? null,
        contentHash: contentHash ?? null,
      }));
    const output = [];
    for (const row of rows) {
      const key = await payloadKeyFor(context.info, row.encryption_key_id);
      try {
        const document = openSealed(context.info,
          `${context.eventKey}:${row.binding_hash}:${row.bound_version_id}`, 'cache_binding', key.keyId, key.key, row.sealed);
        const binding = ownDataRecord(document, new Set([
          'schemaVersion', 'bindingId', 'operationId', 'eventId', 'historyVersionId', 'historyContentHash',
          'historyProjectionHash', 'profileRef', 'cacheVersion', 'scopeKind', 'cacheBindingHash', 'identity', 'pins',
          'cacheSourceContentHash', 'cacheExpiresAtMs', 'historyExpiresAtMs', 'expiresAtMs',
        ]));
        if (!binding || binding.schemaVersion !== 1 || binding.eventId !== context.eventId
          || binding.historyVersionId !== row.bound_version_id || binding.historyContentHash !== row.bound_content_hash
          || keyed(context.info, context.indexKey, 'binding', binding.bindingId) !== row.binding_hash
          || !validSafeString(binding.profileRef, 1, 128) || binding.scopeKind !== 'tenant_private'
          || typeof binding.cacheBindingHash !== 'string' || !/^[a-f0-9]{64}$/.test(binding.cacheBindingHash)
          || !Number.isSafeInteger(binding.cacheExpiresAtMs) || !Number.isSafeInteger(binding.historyExpiresAtMs)
          || !Number.isSafeInteger(binding.expiresAtMs)
          || binding.expiresAtMs !== Math.min(binding.cacheExpiresAtMs, binding.historyExpiresAtMs)
          || binding.expiresAtMs !== row.expires_at_ms) fail('REVIEW_INTEGRITY');
        deepFreeze(binding);
        output.push(Object.freeze({ ...binding, bindingHash: row.binding_hash,
          referenceHash: keyed(context.info, context.indexKey, 'reference', binding.bindingId),
          lastInvalidationOperationId: row.last_invalidation_operation_id,
          lastInvalidationTargetVersionId: row.last_invalidation_target_version_id,
          lastInvalidationTargetHash: row.last_invalidation_target_hash,
          sealed: Buffer.from(row.sealed) }));
      } finally {
        key.key.fill(0);
      }
    }
    return Object.freeze(output);
  }

  async function markBindingInvalidated(context, operation, binding) {
    await withBindingTransaction(context.info, context.directory, (database, time) => {
      const state = database.prepare('SELECT * FROM correction_cache_state WHERE event_key = ?').get(context.eventKey);
      if (!state || state.operation_id !== operation.operationId || state.fence !== operation.fence
        || !['history_committed', 'cache_invalidating'].includes(state.phase)
        || state.target_version_id !== operation.targetVersionId || state.target_content_hash !== operation.targetContentHash) fail('REVIEW_BUSY');
      const result = database.prepare(`UPDATE correction_cache_bindings SET last_invalidation_operation_id = ?,
        last_invalidation_target_version_id = ?, last_invalidation_target_hash = ?
        WHERE event_key = ? AND binding_hash = ? AND bound_version_id = ? AND bound_content_hash = ?`)
        .run(operation.operationId, operation.targetVersionId, operation.targetContentHash, context.eventKey,
          binding.bindingHash, operation.baseVersionId, operation.baseContentHash);
      if (result.changes !== 1) {
        const current = database.prepare(`SELECT last_invalidation_operation_id, last_invalidation_target_version_id,
          last_invalidation_target_hash FROM correction_cache_bindings WHERE event_key = ? AND binding_hash = ?`)
          .get(context.eventKey, binding.bindingHash);
        if (!current || current.last_invalidation_operation_id !== operation.operationId
          || current.last_invalidation_target_version_id !== operation.targetVersionId
          || current.last_invalidation_target_hash !== operation.targetContentHash) fail('REVIEW_INTEGRITY');
      }
      database.prepare("UPDATE correction_cache_state SET phase = 'cache_invalidating', updated_at_ms = ? WHERE event_key = ? AND operation_id = ? AND fence = ?")
        .run(time.now, context.eventKey, operation.operationId, operation.fence);
    }, undefined, () => reauthorizeRequest(context.info, context.request, context.eventId,
      context.action, context.actorId, context.field), boundaryFor(context.info, context.actorId, context.eventId,
      'review.history.cache_operation_state', context.field, context.request, {
        operationId: operation.operationId,
        fence: operation.fence,
        phase: 'cache_invalidating',
        bindingId: binding.bindingId,
        profileRef: binding.profileRef,
        priorVersionId: binding.historyVersionId,
        priorContentHash: binding.historyContentHash,
        targetVersionId: operation.targetVersionId,
        targetContentHash: operation.targetContentHash,
      }));
  }

  async function finishBindingOperation(context, operation) {
    return withBindingTransaction(context.info, context.directory, (database, time) => {
      const state = database.prepare('SELECT * FROM correction_cache_state WHERE event_key = ?').get(context.eventKey);
      if (!state || state.operation_id !== operation.operationId || state.fence !== operation.fence) fail('REVIEW_BUSY');
      if (operation.kind === 'bind') {
        if (state.phase !== 'complete') fail('REVIEW_BUSY');
        return Object.freeze({ completed: true });
      }
      if (!['history_committed', 'cache_invalidating'].includes(state.phase)
        || state.target_version_id !== operation.targetVersionId || state.target_content_hash !== operation.targetContentHash) fail('REVIEW_BUSY');
      const pending = database.prepare(`SELECT COUNT(*) AS count FROM correction_cache_bindings
        WHERE event_key = ? AND bound_version_id = ? AND bound_content_hash = ?
          AND (last_invalidation_operation_id IS NOT ? OR last_invalidation_target_version_id IS NOT ?
            OR last_invalidation_target_hash IS NOT ?)`)
        .get(context.eventKey, operation.baseVersionId, operation.baseContentHash, operation.operationId,
          operation.targetVersionId, operation.targetContentHash).count;
      if (pending !== 0) fail('REVIEW_BUSY');
      database.prepare("UPDATE correction_cache_state SET phase = 'complete', updated_at_ms = ? WHERE event_key = ? AND operation_id = ? AND fence = ?")
        .run(time.now, context.eventKey, operation.operationId, operation.fence);
      database.prepare(`UPDATE correction_cache_operations SET target_version_id = ?, target_content_hash = ?
        WHERE event_key = ? AND operation_hash = ? AND operation_id = ?`)
        .run(operation.targetVersionId, operation.targetContentHash, context.eventKey, state.operation_hash, operation.operationId);
      return Object.freeze({ completed: true });
    }, undefined, () => reauthorizeRequest(context.info, context.request, context.eventId,
      context.action, context.actorId, context.field), boundaryFor(context.info, context.actorId, context.eventId,
      'review.history.cache_operation_state', context.field, context.request, {
        operationId: operation.operationId,
        fence: operation.fence,
        kind: operation.kind,
        phase: 'complete',
        baseVersionId: operation.baseVersionId,
        baseContentHash: operation.baseContentHash,
        targetVersionId: operation.targetVersionId ?? null,
        targetContentHash: operation.targetContentHash ?? null,
      }));
  }

  async function prepareBindingFence(context) {
    const databasePath = path.join(context.directory, 'history.sqlite');
    let before;
    try {
      before = await lstat(databasePath);
      if (before.isSymbolicLink() || !before.isFile()) fail('REVIEW_STORAGE');
    } catch (error) { throw mapStorageError(error); }
    let database;
    try {
      database = new DatabaseSync(databasePath, { timeout: 0 });
      database.exec('PRAGMA busy_timeout = 0');
      const after = await lstat(databasePath);
      if (after.isSymbolicLink() || !after.isFile() || before.dev !== after.dev || before.ino !== after.ino) fail('REVIEW_STORAGE');
    } catch (error) {
      database?.close();
      throw mapStorageError(error);
    }
    let closed = false;
    return Object.freeze({
      run(operationId, fence, allowedPhases, callback, observedNow, effectiveNow = observedNow, signal = undefined) {
        if (closed || typeof callback !== 'function' || !Number.isSafeInteger(observedNow)
          || !Number.isSafeInteger(effectiveNow) || effectiveNow < observedNow) fail('REVIEW_STORAGE');
        try {
          throwIfAborted(signal);
          database.exec('BEGIN IMMEDIATE');
          advanceHistoryClock(database, observedNow);
          const state = database.prepare('SELECT * FROM correction_cache_state WHERE event_key = ?').get(context.eventKey);
          if (!state || state.operation_id !== operationId || state.fence !== fence || !allowedPhases.includes(state.phase)) fail('REVIEW_BUSY');
          if (state.phase === 'pending_bind') {
            const head = database.prepare('SELECT state, expires_at_ms FROM heads WHERE event_key = ?').get(context.eventKey);
            if (!head || head.state !== 'available' || head.expires_at_ms <= effectiveNow) fail('REVIEW_EXPIRED');
          }
          const result = callback(database);
          if (result && typeof result.then === 'function') fail('REVIEW_STORAGE');
          throwIfAborted(signal);
          database.exec('COMMIT');
          return result;
        } catch (error) {
          try { database.exec('ROLLBACK'); } catch { /* Closing the handle also rolls back. */ }
          throw mapBindingCallbackError(error);
        }
      },
      read(expected, callback) {
        if (closed || typeof callback !== 'function' || !expected
          || !validSafeString(expected.bindingHash, 1, 128)
          || !validSafeString(expected.referenceHash, 1, 128)
          || !validSafeString(expected.versionId, 1, 180)
          || !/^[a-f0-9]{64}$/.test(expected.contentHash)
          || !Buffer.isBuffer(expected.sealed) || !Number.isSafeInteger(expected.nowMs)
          || !Number.isSafeInteger(expected.effectiveNowMs) || expected.effectiveNowMs < expected.nowMs) fail('REVIEW_STORAGE');
        try {
          throwIfAborted(expected.signal);
          database.exec('BEGIN IMMEDIATE');
          advanceHistoryClock(database, expected.nowMs);
          const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(context.eventKey);
          const state = database.prepare('SELECT phase FROM correction_cache_state WHERE event_key = ?').get(context.eventKey);
          const binding = database.prepare(`SELECT * FROM correction_cache_bindings WHERE event_key = ? AND binding_hash = ?`)
            .get(context.eventKey, expected.bindingHash);
          const reference = database.prepare(`SELECT * FROM downstream_references WHERE event_key = ? AND reference_hash = ?`)
            .get(context.eventKey, expected.referenceHash);
          if (!head || head.state !== 'available' || head.version_id !== expected.versionId
            || head.content_hash !== expected.contentHash || head.expires_at_ms <= expected.effectiveNowMs
            || (state && state.phase !== 'complete') || !binding
            || binding.bound_version_id !== expected.versionId || binding.bound_content_hash !== expected.contentHash
            || binding.expires_at_ms <= expected.effectiveNowMs || !Buffer.from(binding.sealed).equals(expected.sealed)
            || !reference || reference.bound_version_id !== expected.versionId
            || reference.bound_content_hash !== expected.contentHash) fail('REVIEW_BUSY');
          const result = callback();
          if (result && typeof result.then === 'function') fail('REVIEW_STORAGE');
          throwIfAborted(expected.signal);
          database.exec('COMMIT');
          return result;
        } catch (error) {
          try { database.exec('ROLLBACK'); } catch { /* Closing the handle also rolls back. */ }
          throw mapBindingCallbackError(error);
        }
      },
      close() {
        if (closed) return;
        closed = true;
        database.close();
      },
    });
  }

  const api = Object.freeze({
    scopeForAuthenticatedRequest: createScope,
    createHistory,
    getHistory,
    getHistoryVersion,
    listHistory,
    applyCorrection,
    refreshSources,
    registerDownstreamReference,
    listDownstreamReferences,
    purgeExpired,
  });
  HISTORY_BINDING_PORTS.set(api, Object.freeze({
    context: bindingContext,
    disposeContext: disposeBindingContext,
    readHead: bindingReadHead,
    preflightBindHead: bindingPreflightBindHead,
    readVersion: bindingReadVersion,
    validateOperationInput: validateBindingRevisionInput,
    beginOperation: beginBindingOperation,
    applyOperation: bindingApplyHistoryOperation,
    addCacheProfile: bindingAddCacheProfile,
    bindings: bindingRows,
    markInvalidated: markBindingInvalidated,
    finishOperation: finishBindingOperation,
    prepareFence: prepareBindingFence,
    now: nowMs,
  }));
  return api;
}

export function getCorrectionHistoryBindingPort(store, capability) {
  if (!isCorrectionCacheBindingCapability(capability)) fail('REVIEW_DENIED');
  const port = HISTORY_BINDING_PORTS.get(store);
  if (!port) fail('REVIEW_DENIED');
  return port;
}

export const REVIEW_FACT_FIELDS = Object.freeze(Object.keys(FIELD_TYPES));
