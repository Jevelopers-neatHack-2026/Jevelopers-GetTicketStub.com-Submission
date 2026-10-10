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
const MAX_VERSION_PLAINTEXT_BYTES = 512 * 1024;
const MAX_VERSION_SEALED_BYTES = 512 * 1024;

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

function createOpaque() {
  return Object.freeze(Object.create(null));
}

function readSignal(options) {
  if (options === undefined) return undefined;
  const input = ownDataRecord(options, new Set(['signal']));
  if (!input) fail();
  if (input.signal === undefined) return undefined;
  try {
    if (typeof AbortSignal === 'undefined' || !(input.signal instanceof AbortSignal)) fail();
    return input.signal;
  } catch (error) {
    if (error instanceof ReviewHistoryError) throw error;
    fail();
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) fail('REVIEW_ABORTED');
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

export function createCorrectionHistoryStore(options) {
  const config = ownDataRecord(options, new Set([
    'directory', 'resolveTenant', 'resolveActor', 'authorize', 'resolveKey', 'resolveRetention',
    'allowedFields', 'lockedFields', 'now', 'maxRetentionMs', 'maxStoredBytes', 'maxHistories',
    'maxRevisionsPerHistory', 'lockTimeoutMs',
  ]));
  if (!config || typeof config.directory !== 'string' || config.directory.length === 0
    || typeof config.resolveTenant !== 'function' || typeof config.resolveActor !== 'function'
    || typeof config.authorize !== 'function' || typeof config.resolveKey !== 'function'
    || typeof config.resolveRetention !== 'function') fail();

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

  async function withTransaction(info, directory, operation, signal, finalBoundary) {
    let database;
    let open = false;
    let schemaReady = false;
    try {
      const databasePath = path.join(directory, 'history.sqlite');
      let priorStats = null;
      try {
        priorStats = await lstat(databasePath);
        if (priorStats.isSymbolicLink() || !priorStats.isFile()) fail('REVIEW_STORAGE');
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      database = new DatabaseSync(databasePath, { timeout: limits.lockTimeoutMs });
      const openedStats = await lstat(databasePath);
      if (openedStats.isSymbolicLink() || !openedStats.isFile()
        || (priorStats && (openedStats.dev !== priorStats.dev || openedStats.ino !== priorStats.ino))) fail('REVIEW_STORAGE');
      database.exec(`
        PRAGMA journal_mode = DELETE;
        PRAGMA synchronous = FULL;
        PRAGMA secure_delete = ON;
        PRAGMA trusted_schema = OFF;
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
          database.exec('COMMIT');
        } catch (error) {
          try { database.exec('ROLLBACK'); } catch { /* The connection is closed by the outer transaction guard. */ }
          throw error;
        }
      }
      schemaReady = true;
      await chmod(databasePath, 0o600);
      database.exec('BEGIN IMMEDIATE');
      open = true;
      const result = await operation(database);
      if (finalBoundary) await finalBoundary(result);
      throwIfAborted(signal);
      database.exec('COMMIT');
      open = false;
      return result;
    } catch (error) {
      const publicError = mapStorageError(error);
      if (open) {
        try { database.exec('ROLLBACK'); } catch { /* Closing an interrupted connection also rolls back its transaction. */ }
        open = false;
      }
      if (schemaReady && database) {
        try {
          database.exec('BEGIN IMMEDIATE');
          open = true;
          const now = nowMs();
          const expiredEvents = database.prepare("SELECT event_key FROM heads WHERE state = 'available' AND expires_at_ms <= ? LIMIT ?")
            .all(now, limits.maxHistories);
          for (const row of expiredEvents) expireHistory(database, row.event_key, now);
          database.exec('COMMIT');
          open = false;
        } catch (cleanupError) {
          if (open) {
            try { database.exec('ROLLBACK'); } catch { /* Cleanup connection is closed below. */ }
            open = false;
          }
          throw mapStorageError(cleanupError);
        }
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
    return true;
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

  async function findCommittedReplay(info, eventId, eventKey, actorId, operation, idempotencyKey, normalizedInput, indexKey,
    request, action, field) {
    const directory = await tenantDirectory(info);
    const keyHash = keyed(info, indexKey, 'idempotency-key', idempotencyKey);
    const fingerprintValue = fingerprint(indexKey, info, eventKey, actorId, operation, normalizedInput);
    try {
      return await withTransaction(info, directory, async (database) => {
        expireHistory(database, eventKey, nowMs());
        return idempotentReplay(info, database, eventKey, keyHash, fingerprintValue);
      }, undefined, async (replay) => {
        await reauthorizeRequest(info, request, eventId, action, actorId, field);
        if (replay) assertNotExpired(Date.parse(replay.snapshot.expiresAt));
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async function persistVersion({ info, directory, eventId, eventKey, actorId, operation, idempotencyKey,
    normalizedInput, state, parent, retentionHandle, signal, baseVersion, indexKey, request, action, field }) {
    const upperBoundMs = parent?.expires_at_ms;
    const firstRetention = await resolveRetention(info, retentionHandle, upperBoundMs);
    throwIfAborted(signal);
    const expiresAtMs = Math.min(firstRetention.expiresAtMs, upperBoundMs ?? firstRetention.expiresAtMs);
    const retention = Object.freeze({ ...firstRetention, expiresAtMs });
    let finalRetentionExpiresAtMs = retention.expiresAtMs;
    const key = await payloadKeyFor(info);
    const keyHash = keyed(info, indexKey, 'idempotency-key', idempotencyKey);
    const fingerprintValue = fingerprint(indexKey, info, eventKey, actorId, operation, normalizedInput);
    try {
      return await withTransaction(info, directory, async (database) => {
        const transactionTime = nowMs();
        expireHistory(database, eventKey, transactionTime);
        const replay = await idempotentReplay(info, database, eventKey, keyHash, fingerprintValue);
        if (replay) return replay;
        const current = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        throwIfAborted(signal);
        if (operation === 'initialize') {
          if (current?.state === 'expired') fail('REVIEW_EXPIRED');
          if (current?.state === 'available') fail('REVIEW_ALREADY_EXISTS');
        } else {
          if (!current || current.state !== 'available') fail('REVIEW_NOT_FOUND');
          if (current.expires_at_ms <= transactionTime) fail('REVIEW_EXPIRED');
          if (!baseVersion || current.version_id !== baseVersion.versionId
            || current.content_hash !== baseVersion.contentHash) fail('REVIEW_VERSION_CONFLICT');
          if (current.expires_at_ms < expiresAtMs) fail('REVIEW_DENIED');
        }
        const historyCount = database.prepare('SELECT COUNT(*) AS count FROM heads').get().count;
        if (operation === 'initialize' && historyCount >= limits.maxHistories) fail('REVIEW_STORAGE_LIMIT');
        const nextRevision = current?.revision ? current.revision + 1 : 1;
        if (nextRevision > limits.maxRevisionsPerHistory) fail('REVIEW_STORAGE_LIMIT');
        const createdAt = new Date(transactionTime).toISOString();
        const nextState = state.build(nextRevision, keyed(info, indexKey, 'actor', actorId), createdAt);
        const invalidations = [];
        if (current?.state === 'available') {
          const refs = database.prepare(`SELECT r.* FROM downstream_references AS r
            WHERE r.event_key = ? AND r.bound_version_id = ? AND r.bound_content_hash = ?
            AND NOT EXISTS (
              SELECT 1 FROM invalidations AS i
              WHERE i.event_key = r.event_key AND i.reference_hash = r.reference_hash
                AND i.prior_version_id = r.bound_version_id AND i.prior_content_hash = r.bound_content_hash
            ) LIMIT ?`).all(eventKey, current.version_id, current.content_hash, 129);
          if (refs.length > 128) fail('REVIEW_STORAGE_LIMIT');
          for (const refRow of refs) {
            const reference = await decryptReference(info, refRow);
            invalidations.push({
              referenceId: reference.referenceId,
              referenceKind: reference.kind,
              priorVersionId: current.version_id,
              priorContentHash: current.content_hash,
              reason: state.materialChanged ? 'material_projection_changed' : 'new_version_requires_new_binding',
              materialChange: state.materialChanged,
              createdAt,
            });
          }
          invalidations.sort((left, right) => left.referenceId.localeCompare(right.referenceId));
        }
        const snapshot = buildSnapshot({
          eventId,
          eventKey,
          revision: nextRevision,
          parentVersionId: current?.version_id ?? null,
          createdAt,
          retention,
          state: nextState,
          invalidations,
          indexKey,
        });
        const sealed = seal(info, `${eventKey}:${snapshot.versionId}`, 'version', key.keyId, key.key, snapshot);
        if (sealed.byteLength > MAX_VERSION_SEALED_BYTES) fail('REVIEW_STORAGE_LIMIT');
        const priorBytes = database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM versions WHERE state = \'available\'').get().bytes
          + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM downstream_references').get().bytes;
        if (priorBytes + sealed.byteLength > limits.maxStoredBytes) fail('REVIEW_STORAGE_LIMIT');
        throwIfAborted(signal);
        database.prepare(`INSERT INTO versions
          (event_key, revision, version_id, parent_version_id, content_hash, material_hash, expires_at_ms, encryption_key_id, sealed, state)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`).run(
          eventKey,
          snapshot.revision,
          snapshot.versionId,
          snapshot.parentVersionId,
          snapshot.contentHash,
          snapshot.materialHash,
          retention.expiresAtMs,
          key.keyId,
          sealed,
        );
        database.prepare(`INSERT INTO heads (event_key, revision, version_id, content_hash, material_hash, expires_at_ms, state)
          VALUES (?, ?, ?, ?, ?, ?, 'available')
          ON CONFLICT (event_key) DO UPDATE SET revision = excluded.revision, version_id = excluded.version_id,
          content_hash = excluded.content_hash, material_hash = excluded.material_hash,
          expires_at_ms = excluded.expires_at_ms, state = 'available'`).run(
          eventKey,
          snapshot.revision,
          snapshot.versionId,
          snapshot.contentHash,
          snapshot.materialHash,
          retention.expiresAtMs,
        );
        if (current?.state === 'available') {
          for (const invalidation of invalidations) {
            const referenceHash = keyed(info, indexKey, 'reference', invalidation.referenceId);
            database.prepare(`INSERT INTO invalidations
              (event_key, reference_hash, prior_version_id, prior_content_hash, next_version_id, material_change, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
              eventKey,
              referenceHash,
              invalidation.priorVersionId,
              invalidation.priorContentHash,
              snapshot.versionId,
              invalidation.materialChange ? 1 : 0,
              invalidation.reason,
              invalidation.createdAt,
            );
          }
        }
        const usedBytes = database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM versions WHERE state = \'available\'').get().bytes
          + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM downstream_references').get().bytes;
        if (usedBytes > limits.maxStoredBytes) fail('REVIEW_STORAGE_LIMIT');
        database.prepare('INSERT INTO idempotency (event_key, key_hash, fingerprint, version_id) VALUES (?, ?, ?, ?)')
          .run(eventKey, keyHash, fingerprintValue, snapshot.versionId);
        // Recheck the trusted retention decision after staging the new immutable
        // version. An abort or an expired permit here rolls the complete write back.
        const finalRetention = await resolveRetention(info, retentionHandle, upperBoundMs);
        finalRetentionExpiresAtMs = finalRetention.expiresAtMs;
        throwIfAborted(signal);
        if (finalRetention.policyId !== retention.policyId || finalRetention.policyVersion !== retention.policyVersion
          || finalRetention.accessPolicy !== retention.accessPolicy) fail('REVIEW_DENIED');
        if (finalRetention.expiresAtMs < retention.expiresAtMs) fail('REVIEW_DENIED');
        return Object.freeze({ snapshot, replayed: false, invalidations: snapshot.invalidations });
      }, signal, async (result) => {
        await reauthorizeRequest(info, request, eventId, action, actorId, field);
        if (result?.snapshot?.expiresAt) assertNotExpired(Date.parse(result.snapshot.expiresAt));
        if (result?.replayed !== true) {
          assertNotExpired(retention.expiresAtMs);
          assertNotExpired(finalRetentionExpiresAtMs);
        }
      });
    } finally {
      key.key.fill(0);
    }
  }

  async function readHead(info, eventId, request, action = 'read_history') {
    const actorId = await authorizeRequest(info, request, eventId, action);
    const indexKey = await indexKeyFor(info);
    try {
      const eventKey = keyed(info, indexKey, 'event', eventId);
      const directory = await tenantDirectory(info);
      const snapshot = await withTransaction(info, directory, async (database) => {
        const now = nowMs();
        expireHistory(database, eventKey, now);
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available') fail('REVIEW_EXPIRED');
        const row = rowForVersion(database, eventKey, head.version_id);
        return decryptVersion(info, row);
      }, undefined, async (snapshot) => {
        await reauthorizeRequest(info, request, eventId, action, actorId);
        assertNotExpired(Date.parse(snapshot.expiresAt));
      });
      return snapshot;
    } catch (error) {
      throw mapStorageError(error);
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
        normalizedInput, indexKey, request, 'initialize_history');
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
      return await withTransaction(info, directory, async (database) => {
        expireHistory(database, eventKey, nowMs());
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available') fail('REVIEW_EXPIRED');
        const row = rowForVersion(database, eventKey, baseVersionId);
        if (!row || row.content_hash !== baseContentHash) fail('REVIEW_VERSION_CONFLICT');
        return { row, snapshot: await decryptVersion(info, row), directory, eventKey };
      }, undefined, async (base) => {
        await reauthorizeRequest(info, request, eventId, action, actorId, field);
        assertNotExpired(base.row.expires_at_ms);
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  async function applyCorrection(scope, inputValue, request, operationOptions) {
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
        normalizedInput, indexKey, request, 'apply_correction', field);
      throwIfAborted(signal);
      if (replay) return replay;
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
      });
    } finally {
      indexKey.fill(0);
    }
  }

  async function refreshSources(scope, inputValue, request, operationOptions) {
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
        normalizedInput, indexKey, request, 'refresh_source_facts');
      throwIfAborted(signal);
      if (replay) return replay;
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
    try {
      const eventKey = keyed(info, indexKey, 'event', eventId);
      const directory = await tenantDirectory(info);
      return await withTransaction(info, directory, async (database) => {
        expireHistory(database, eventKey, nowMs());
        const row = rowForVersion(database, eventKey, versionId);
        if (!row) fail('REVIEW_NOT_FOUND');
        return decryptVersion(info, row);
      }, undefined, async (snapshot) => {
        await reauthorizeRequest(info, request, eventId, 'read_history_version', actorId);
        assertNotExpired(Date.parse(snapshot.expiresAt));
      });
    } catch (error) {
      throw mapStorageError(error);
    } finally {
      indexKey.fill(0);
    }
  }

  async function listHistory(scope, eventIdValue, request) {
    const info = scopeInfo(scope);
    const eventId = validateEventId(eventIdValue);
    const actorId = await authorizeRequest(info, request, eventId, 'list_history');
    const indexKey = await indexKeyFor(info);
    try {
      const eventKey = keyed(info, indexKey, 'event', eventId);
      const directory = await tenantDirectory(info);
      return await withTransaction(info, directory, async (database) => {
        expireHistory(database, eventKey, nowMs());
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available') fail('REVIEW_EXPIRED');
        const rows = database.prepare("SELECT * FROM versions WHERE event_key = ? AND state = 'available' ORDER BY revision ASC").all(eventKey);
        if (rows.length > limits.maxRevisionsPerHistory) fail('REVIEW_INTEGRITY');
        const snapshots = [];
        for (const row of rows) snapshots.push(await decryptVersion(info, row));
        return Object.freeze(snapshots);
      }, undefined, async (snapshots) => {
        await reauthorizeRequest(info, request, eventId, 'list_history', actorId);
        for (const snapshot of snapshots) assertNotExpired(Date.parse(snapshot.expiresAt));
      });
    } catch (error) {
      throw mapStorageError(error);
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
    try {
      let headExpiryMs;
      const eventKey = keyed(info, indexKey, 'event', eventId);
      const referenceHash = keyed(info, indexKey, 'reference', referenceId);
      const directory = await tenantDirectory(info);
      payloadKey = await payloadKeyFor(info);
      return await withTransaction(info, directory, async (database) => {
        expireHistory(database, eventKey, nowMs());
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available') fail('REVIEW_EXPIRED');
        if (head.version_id !== versionId || head.content_hash !== input.contentHash) fail('REVIEW_VERSION_CONFLICT');
        headExpiryMs = head.expires_at_ms;
        const existing = database.prepare('SELECT * FROM downstream_references WHERE event_key = ? AND reference_hash = ?').get(eventKey, referenceHash);
        if (existing) {
          const prior = await decryptReference(info, existing);
          if (prior.referenceId !== referenceId || prior.kind !== input.kind || prior.boundVersionId !== versionId
            || prior.boundContentHash !== input.contentHash) fail('REVIEW_REFERENCE_CONFLICT');
          return Object.freeze({ referenceId, kind: input.kind, versionId, contentHash: input.contentHash, replayed: true });
        }
        const count = database.prepare('SELECT COUNT(*) AS count FROM downstream_references WHERE event_key = ?').get(eventKey).count;
        if (count >= 128) fail('REVIEW_STORAGE_LIMIT');
        const document = {
          referenceId,
          kind: input.kind,
          boundVersionId: versionId,
          boundContentHash: input.contentHash,
          createdAt: new Date(nowMs()).toISOString(),
        };
        const sealed = seal(info, `${eventKey}:${referenceHash}:${versionId}`, 'reference', payloadKey.keyId, payloadKey.key, document);
        const usedBytes = database.prepare("SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM versions WHERE state = 'available'").get().bytes
          + database.prepare('SELECT COALESCE(SUM(length(sealed)), 0) AS bytes FROM downstream_references').get().bytes;
        if (usedBytes + sealed.byteLength > limits.maxStoredBytes) fail('REVIEW_STORAGE_LIMIT');
        database.prepare(`INSERT INTO downstream_references
          (event_key, reference_hash, bound_version_id, bound_content_hash, encryption_key_id, sealed)
          VALUES (?, ?, ?, ?, ?, ?)`).run(eventKey, referenceHash, versionId, input.contentHash, payloadKey.keyId, sealed);
        return Object.freeze({ referenceId, kind: input.kind, versionId, contentHash: input.contentHash, replayed: false });
      }, undefined, async () => {
        await reauthorizeRequest(info, request, eventId, 'record_downstream_reference', actorId);
        assertNotExpired(headExpiryMs);
      });
    } catch (error) {
      throw mapStorageError(error);
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
    try {
      let headExpiryMs;
      const eventKey = keyed(info, indexKey, 'event', eventId);
      const directory = await tenantDirectory(info);
      return await withTransaction(info, directory, async (database) => {
        expireHistory(database, eventKey, nowMs());
        const head = database.prepare('SELECT * FROM heads WHERE event_key = ?').get(eventKey);
        if (!head) fail('REVIEW_NOT_FOUND');
        if (head.state !== 'available') fail('REVIEW_EXPIRED');
        headExpiryMs = head.expires_at_ms;
        const rows = database.prepare('SELECT * FROM downstream_references WHERE event_key = ? LIMIT 129').all(eventKey);
        if (rows.length > 128) fail('REVIEW_INTEGRITY');
        const output = [];
        for (const row of rows) {
          const reference = await decryptReference(info, row);
          const current = row.bound_version_id === head.version_id && row.bound_content_hash === head.content_hash;
          const invalidationRow = current ? null : database.prepare(`SELECT * FROM invalidations WHERE event_key = ? AND reference_hash = ?
            AND prior_version_id = ? AND prior_content_hash = ?`).get(eventKey, row.reference_hash, row.bound_version_id, row.bound_content_hash);
          if (!current && !invalidationRow) fail('REVIEW_INTEGRITY');
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
        return Object.freeze(output);
      }, undefined, async () => {
        await reauthorizeRequest(info, request, eventId, 'read_downstream_references', actorId);
        assertNotExpired(headExpiryMs);
      });
    } catch (error) {
      throw mapStorageError(error);
    } finally {
      indexKey.fill(0);
    }
  }

  async function purgeExpired(scope, request) {
    const info = scopeInfo(scope);
    const actorId = await authorizeRequest(info, request, null, 'purge_correction_history');
    const directory = await tenantDirectory(info);
    try {
      return await withTransaction(info, directory, async (database) => {
        const now = nowMs();
        const expiredEvents = database.prepare("SELECT event_key FROM heads WHERE state = 'available' AND expires_at_ms <= ? LIMIT ?")
          .all(now, limits.maxHistories);
        let purged = 0;
        for (const row of expiredEvents) if (expireHistory(database, row.event_key, now)) purged += 1;
        return purged;
      }, undefined, async () => {
        await reauthorizeRequest(info, request, null, 'purge_correction_history', actorId);
      });
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  return Object.freeze({
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
}

export const REVIEW_FACT_FIELDS = Object.freeze(Object.keys(FIELD_TYPES));
