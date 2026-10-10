import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmod, lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { types as utilTypes } from 'node:util';
import { isPrivacyBoundary } from '../../privacy/boundary.mjs';

const ERROR_MESSAGES = Object.freeze({
  REUSE_DENIED: 'reuse access denied',
  REUSE_INVALID: 'invalid reuse record',
  REUSE_NOT_FOUND: 'reuse record not found',
  REUSE_BUSY: 'reuse store is busy',
  REUSE_STORAGE: 'reuse storage operation failed',
  REUSE_INTEGRITY: 'reuse integrity check failed',
  REUSE_KEY_UNAVAILABLE: 'reuse encryption key unavailable',
  REUSE_CAPACITY: 'reuse storage capacity reached',
  REUSE_POLICY_UNAVAILABLE: 'trusted reuse policy unavailable',
});
const SCOPES = new WeakMap();
const LOCAL_QUEUES = new Map();
const TRUSTED_ERRORS = new WeakSet();
const FACT_FIELDS = Object.freeze(['event_name', 'event_date', 'venue']);
const PIN_FIELDS = Object.freeze(['schemaVersion', 'extractorVersion', 'questionSetVersion', 'policyHash', 'modelVersion']);
const IDENTITY_FIELDS = Object.freeze(['occurrenceId', 'entityId', 'editionId']);
const LINEAGE_FIELDS = new Set([
  'logicalOperationId', 'billableAttemptId', 'transportAttemptId', 'providerRequestId',
  'observationIds', 'usageEventIds', 'status',
]);
const PERMISSION_FIELDS = new Set(['reference', 'contentHash', 'version', 'use']);
const PRIVATE_FACT_FIELDS = new Set(['status', 'value', 'reason', 'supportRefs', 'candidates']);
const MAX_TIME = 8_640_000_000_000_000;
const MAX_INVALIDATION_RECORD_BYTES = 2_048;
const IS_PROXY = utilTypes.isProxy;
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_TAG_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, Symbol.toStringTag).get;
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'length').get;
const UINT8_ARRAY_SET = Uint8Array.prototype.set;

export class ScopedReuseError extends Error {
  constructor(code) {
    super(ERROR_MESSAGES[code] ?? ERROR_MESSAGES.REUSE_STORAGE);
    this.name = 'ScopedReuseError';
    this.code = Object.hasOwn(ERROR_MESSAGES, code) ? code : 'REUSE_STORAGE';
    TRUSTED_ERRORS.add(this);
  }
}

function fail(code) {
  const error = new ScopedReuseError(code);
  TRUSTED_ERRORS.add(error);
  throw error;
}

function opaque() {
  return Object.freeze(Object.create(null));
}

function record(value, allowed) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) return null;
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

function safeArrayValues(value, maximum) {
  try {
    if (!Array.isArray(value)) fail('REUSE_INVALID');
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(length)
      || length < 0 || length > maximum) fail('REUSE_INVALID');
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes('length')) fail('REUSE_INVALID');
    const values = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) fail('REUSE_INVALID');
      values.push(descriptor.value);
    }
    return values;
  } catch (error) {
    if (TRUSTED_ERRORS.has(error)) throw error;
    fail('REUSE_INVALID');
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

function string(value, maximum = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum && isWellFormed(value);
}

function mac(key, value) {
  return createHmac('sha256', key).update(value).digest('hex');
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function timestamp(value) {
  if (!string(value, 64) || !Number.isFinite(Date.parse(value))) fail('REUSE_INVALID');
  return Date.parse(value);
}

function effectiveRetrievedAt(payload, observation) {
  if (Number.isSafeInteger(observation?.retrievedAtMs)
    && (observation.status !== 'body_changed' || observation.contentHash === payload.contentHash)) {
    return observation.retrievedAtMs;
  }
  return payload.retrievedAtMs;
}

function iso(value) {
  try { return new Date(value).toISOString(); } catch { fail('REUSE_INTEGRITY'); }
}

function signalAborted(signal) {
  if (signal === undefined) return false;
  try {
    if (IS_PROXY(signal)) fail('REUSE_INVALID');
    return ABORTED_GETTER.call(signal);
  } catch (error) {
    if (TRUSTED_ERRORS.has(error)) throw error;
    fail('REUSE_INVALID');
  }
}

function copyFacts(value, publicOnly = false) {
  const allowed = publicOnly ? new Set(FACT_FIELDS) : new Set(FACT_FIELDS);
  const input = record(value, allowed);
  if (!input || Object.keys(input).length === 0) fail('REUSE_INVALID');
  const output = Object.create(null);
  for (const field of FACT_FIELDS) {
    if (!Object.hasOwn(input, field)) continue;
    const item = input[field];
    if (publicOnly) {
      if (!string(item, 180)) fail('REUSE_INVALID');
      if (field === 'event_date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(item) || Number.isNaN(Date.parse(`${item}T00:00:00Z`))
          || new Date(`${item}T00:00:00Z`).toISOString().slice(0, 10) !== item) fail('REUSE_INVALID');
      }
      output[field] = item;
      continue;
    }
    const fact = record(item, PRIVATE_FACT_FIELDS);
    if (!fact || !['sourced', 'inferred', 'customer_supplied', 'conflicting', 'missing'].includes(fact.status)) fail('REUSE_INVALID');
    const copy = Object.create(null);
    copy.status = fact.status;
    if (fact.value !== undefined) {
      if (!string(fact.value, 1000)) fail('REUSE_INVALID');
      copy.value = fact.value;
    }
    if (fact.reason !== undefined) {
      if (!string(fact.reason, 1000)) fail('REUSE_INVALID');
      copy.reason = fact.reason;
    }
    if (fact.supportRefs !== undefined) copy.supportRefs = boundedRefList(fact.supportRefs, 64);
    if (fact.status === 'conflicting') {
      if (copy.value !== undefined) fail('REUSE_INVALID');
      const candidateValues = safeArrayValues(fact.candidates, 16);
      if (candidateValues.length < 2) fail('REUSE_INVALID');
      const candidates = [];
      for (const candidateValue of candidateValues) {
        const candidate = record(candidateValue, new Set(['status', 'value', 'supportRefs']));
        if (!candidate || !['sourced', 'inferred', 'customer_supplied'].includes(candidate.status)
          || !string(candidate.value, 1000)) fail('REUSE_INVALID');
        candidates.push(freeze({ status: candidate.status, value: candidate.value, supportRefs: boundedRefList(candidate.supportRefs ?? [], 64) }));
      }
      copy.candidates = Object.freeze(candidates);
    } else if (fact.candidates !== undefined) fail('REUSE_INVALID');
    if (fact.status === 'missing' && copy.value !== undefined) fail('REUSE_INVALID');
    if (fact.status !== 'missing' && fact.status !== 'conflicting' && copy.value === undefined) fail('REUSE_INVALID');
    output[field] = freeze(copy);
  }
  if (Object.keys(output).length === 0) fail('REUSE_INVALID');
  return freeze(output);
}

function boundedRefList(value, maximum = 128) {
  const values = safeArrayValues(value, maximum);
  if (values.some((item) => !string(item, 512))) fail('REUSE_INVALID');
  return Object.freeze(values);
}

function identity(value) {
  const input = record(value, new Set(IDENTITY_FIELDS));
  if (!input || IDENTITY_FIELDS.some((field) => !string(input[field]))) fail('REUSE_INVALID');
  return freeze({ occurrenceId: input.occurrenceId, entityId: input.entityId, editionId: input.editionId });
}

function pins(value) {
  const input = record(value, new Set(PIN_FIELDS));
  if (!input || PIN_FIELDS.some((field) => !string(input[field]))) fail('REUSE_INVALID');
  if (!/^[a-f0-9]{64}$/.test(input.policyHash)) fail('REUSE_INVALID');
  return freeze({
    schemaVersion: input.schemaVersion,
    extractorVersion: input.extractorVersion,
    questionSetVersion: input.questionSetVersion,
    policyHash: input.policyHash,
    modelVersion: input.modelVersion,
  });
}

function hashValue(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) fail('REUSE_INVALID');
  return value;
}

function validatePermissions(value) {
  const values = safeArrayValues(value, 128);
  const output = [];
  for (const valueItem of values) {
    const permission = record(valueItem, PERMISSION_FIELDS);
    if (!permission || !string(permission.reference) || typeof permission.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(permission.contentHash)
      || !Number.isSafeInteger(permission.version) || permission.version < 1 || !string(permission.use, 80)) fail('REUSE_INVALID');
    output.push(freeze({
      reference: permission.reference,
      contentHash: permission.contentHash,
      version: permission.version,
      use: permission.use,
    }));
  }
  return Object.freeze(output);
}

function validateLineage(value) {
  const input = record(value, LINEAGE_FIELDS);
  if (!input) fail('REUSE_INVALID');
  const output = Object.create(null);
  for (const field of ['logicalOperationId', 'billableAttemptId', 'transportAttemptId', 'providerRequestId']) {
    if (input[field] !== undefined && input[field] !== null) {
      if (!string(input[field], 512)) fail('REUSE_INVALID');
      output[field] = input[field];
    }
  }
  for (const field of ['observationIds', 'usageEventIds']) {
    if (input[field] !== undefined) output[field] = boundedRefList(input[field]);
  }
  output.status = input.status === 'complete'
    && typeof output.logicalOperationId === 'string'
    && typeof output.billableAttemptId === 'string'
    && ((output.transportAttemptId && output.transportAttemptId.length > 0) || (output.providerRequestId && output.providerRequestId.length > 0))
    && Array.isArray(output.usageEventIds) && output.usageEventIds.length > 0
    ? 'complete'
    : 'unknown';
  return freeze(output);
}

function copyIndex(input) {
  const parsedIdentity = identity(input.identity);
  const parsedPins = pins(input.pins);
  const contentHash = hashValue(input.contentHash);
  return { identity: parsedIdentity, pins: parsedPins, contentHash };
}

function safeError(error) {
  if (error && (typeof error === 'object' || typeof error === 'function') && TRUSTED_ERRORS.has(error)) return error;
  try {
    const errcode = Object.getOwnPropertyDescriptor(error, 'errcode')?.value;
    const code = Object.getOwnPropertyDescriptor(error, 'code')?.value;
    if (errcode === 5 || errcode === 6 || code === 'ERR_SQLITE_BUSY') return new ScopedReuseError('REUSE_BUSY');
  } catch { /* Return a generic error without consulting caller properties. */ }
  return new ScopedReuseError('REUSE_STORAGE');
}

function publicBoundary(operation) {
  return async (...args) => {
    try {
      return await operation(...args);
    } catch (error) {
      if (error && (typeof error === 'object' || typeof error === 'function') && TRUSTED_ERRORS.has(error)) throw error;
      fail('REUSE_INVALID');
    }
  };
}

async function withLocalQueue(key, operation) {
  const previous = LOCAL_QUEUES.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  LOCAL_QUEUES.set(key, current);
  await previous.catch(() => {});
  try { return await operation(); } finally {
    release();
    if (LOCAL_QUEUES.get(key) === current) LOCAL_QUEUES.delete(key);
  }
}

export function createScopedReuseStore(options) {
  const config = record(options, new Set([
    'directory', 'resolveTenant', 'resolveActor', 'authorizeAction', 'authorizeCurrentRequest', 'resolveKey', 'resolveRetention',
    'verifySourceObservation', 'verifyAdmissionOutcome', 'authorizePublicPublication', 'resolvePrivateProfileReferences', 'verifyPermission', 'resolveLineage', 'consumeOriginalLineage',
    'resolveInvalidationConsumers', 'deliverInvalidation', 'verifyInvalidationAcknowledgement',
    'now', 'maxEntryBytes', 'maxEntries', 'maxFlights', 'maxPrivateLinks', 'maxObservationsPerEntry', 'maxOutboxEntries',
    'maxOutboxAttempts', 'maxRetentionMs', 'lockTimeoutMs', 'defaultFreshnessTtlMs', 'maxStoreBytes',
  ]));
  if (!config || !string(config.directory, 4096) || typeof config.resolveTenant !== 'function'
    || typeof config.resolveActor !== 'function' || typeof config.authorizeAction !== 'function'
    || typeof config.authorizeCurrentRequest !== 'function'
    || typeof config.resolveKey !== 'function' || typeof config.resolveRetention !== 'function') fail('REUSE_INVALID');
  for (const name of ['verifySourceObservation', 'verifyAdmissionOutcome', 'authorizePublicPublication', 'resolvePrivateProfileReferences', 'verifyPermission', 'resolveLineage', 'consumeOriginalLineage', 'resolveInvalidationConsumers', 'deliverInvalidation', 'verifyInvalidationAcknowledgement']) {
    if (config[name] !== undefined && typeof config[name] !== 'function') fail('REUSE_INVALID');
  }
  const limits = {
    now: config.now ?? (() => Date.now()),
    maxEntryBytes: config.maxEntryBytes ?? 128 * 1024,
    maxEntries: config.maxEntries ?? 2000,
    maxFlights: config.maxFlights ?? 5000,
    maxPrivateLinks: config.maxPrivateLinks ?? 5000,
    maxObservationsPerEntry: config.maxObservationsPerEntry ?? 128,
    maxOutboxEntries: config.maxOutboxEntries ?? 10_000,
    maxOutboxAttempts: config.maxOutboxAttempts ?? 8,
    maxRetentionMs: config.maxRetentionMs ?? 30 * 24 * 60 * 60 * 1000,
    lockTimeoutMs: config.lockTimeoutMs ?? 5_000,
    defaultFreshnessTtlMs: config.defaultFreshnessTtlMs ?? 24 * 60 * 60 * 1000,
    maxStoreBytes: config.maxStoreBytes ?? 512 * 1024 * 1024,
  };
  if (typeof limits.now !== 'function' || limits.maxEntryBytes < MAX_INVALIDATION_RECORD_BYTES) fail('REUSE_INVALID');
  for (const [key, value] of Object.entries(limits)) {
    if (key !== 'now' && (!Number.isSafeInteger(value) || value <= 0)) fail('REUSE_INVALID');
  }
  const rootDirectory = path.resolve(config.directory);
  const storeAuthority = Object.freeze(Object.create(null));

  function currentTime() {
    let value;
    try { value = limits.now(); } catch { fail('REUSE_STORAGE'); }
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_TIME) fail('REUSE_STORAGE');
    return value;
  }

  async function authenticatedScope(request) {
    const { tenantId, actorId } = await resolvePrincipal(request);
    const scope = opaque();
    SCOPES.set(scope, Object.freeze({ tenantId, actorId, storeAuthority }));
    return scope;
  }

  async function resolvePrincipal(request) {
    let tenantId;
    let actorId;
    let confirmedTenantId;
    let confirmedActorId;
    try {
      tenantId = await config.resolveTenant(request);
      actorId = await config.resolveActor(request);
      confirmedTenantId = await config.resolveTenant(request);
      confirmedActorId = await config.resolveActor(request);
    } catch { fail('REUSE_DENIED'); }
    if (!string(tenantId, 256) || !string(actorId, 256)
      || tenantId !== confirmedTenantId || actorId !== confirmedActorId) fail('REUSE_DENIED');
    return { tenantId, actorId };
  }

  function scopeInfo(scope) {
    const info = SCOPES.get(scope);
    if (!info || info.storeAuthority !== storeAuthority) fail('REUSE_DENIED');
    return info;
  }

  async function authorize(info, request, action, details = {}) {
    const before = await resolvePrincipal(request);
    if (before.tenantId !== info.tenantId || before.actorId !== info.actorId) fail('REUSE_DENIED');
    let allowed = false;
    try {
      allowed = (await config.authorizeAction(Object.freeze({
        tenantId: before.tenantId,
        actorId: before.actorId,
        action,
        request,
        details: Object.freeze({ ...details }),
      }))) === true;
    } catch { fail('REUSE_DENIED'); }
    if (!allowed) fail('REUSE_DENIED');
    const after = await resolvePrincipal(request);
    if (after.tenantId !== info.tenantId || after.actorId !== info.actorId) fail('REUSE_DENIED');
  }

  async function authorizeCurrentRequest(info, request, action, details = {}) {
    let allowed = false;
    try {
      allowed = (await config.authorizeCurrentRequest(Object.freeze({
        expectedTenantId: info.tenantId,
        expectedActorId: info.actorId,
        action,
        request,
        details: Object.freeze({ ...details }),
      }))) === true;
    } catch { fail('REUSE_DENIED'); }
    if (!allowed) fail('REUSE_DENIED');
  }

  function authorizationGuard(info, request, action, signal) {
    return async () => {
      await authorize(info, request, action);
      if (signalAborted(signal)) fail('REUSE_DENIED');
    };
  }

  async function resolveKey(info, purpose, keyId, guard) {
    try {
      const raw = await config.resolveKey(Object.freeze({
        tenantId: info?.tenantId ?? null,
        scope: info ? 'tenant_private' : 'public_profile',
        purpose,
        ...(keyId ? { keyId } : {}),
      }));
      if (guard) await guard();
      // Read the key holder's own data slots; never invoke caller supplied getters.
      let resolvedKeyId;
      let resolvedKey;
      try {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('REUSE_KEY_UNAVAILABLE');
        const ownKeys = Reflect.ownKeys(raw);
        if (ownKeys.length !== 2 || ownKeys.some((key) => !['keyId', 'key'].includes(key))) fail('REUSE_KEY_UNAVAILABLE');
        const idDescriptor = Object.getOwnPropertyDescriptor(raw, 'keyId');
        const keyDescriptor = Object.getOwnPropertyDescriptor(raw, 'key');
        if (!idDescriptor || !Object.hasOwn(idDescriptor, 'value') || !keyDescriptor || !Object.hasOwn(keyDescriptor, 'value')) fail('REUSE_KEY_UNAVAILABLE');
        resolvedKeyId = idDescriptor.value;
        resolvedKey = keyDescriptor.value;
      } catch { fail('REUSE_KEY_UNAVAILABLE'); }
      let length;
      try {
        if (TYPED_ARRAY_TAG_GETTER.call(resolvedKey) !== 'Uint8Array') fail('REUSE_KEY_UNAVAILABLE');
        length = TYPED_ARRAY_LENGTH_GETTER.call(resolvedKey);
      } catch { fail('REUSE_KEY_UNAVAILABLE'); }
      if (!string(resolvedKeyId, 128) || length !== 32 || (keyId && resolvedKeyId !== keyId)) fail('REUSE_KEY_UNAVAILABLE');
      const keyCopy = new Uint8Array(32);
      try { UINT8_ARRAY_SET.call(keyCopy, resolvedKey); } catch { fail('REUSE_KEY_UNAVAILABLE'); }
      return { keyId: resolvedKeyId, key: Buffer.from(keyCopy) };
    } catch (error) {
      if (error && (typeof error === 'object' || typeof error === 'function') && TRUSTED_ERRORS.has(error)) throw error;
      fail('REUSE_KEY_UNAVAILABLE');
    }
  }

  async function indexInfo(info, scopeKind, guard) {
    const indexInfoValue = scopeKind === 'public_profile' ? null : info;
    const keyInfo = await resolveKey(indexInfoValue, 'index', undefined, guard);
    const tenantPart = indexInfoValue ? mac(keyInfo.key, `tenant:${indexInfoValue.tenantId}`) : 'public-profile-v1';
    return { keyInfo, partitionHash: tenantPart, scopeKind };
  }

  function seal(key, keyId, partitionHash, kind, id, value) {
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(Buffer.from(`event-intelligence:scoped-reuse:v1:${kind}:${partitionHash}:${id}:${keyId}`, 'utf8'));
      const plaintext = Buffer.from(stable(value), 'utf8');
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.from(JSON.stringify({ version: 1, keyId, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') }), 'utf8');
    } catch { fail('REUSE_STORAGE'); }
  }

  function sealBounded(key, keyId, partitionHash, kind, id, value, maximum = limits.maxEntryBytes) {
    const sealed = seal(key, keyId, partitionHash, kind, id, value);
    if (sealed.byteLength > maximum) fail('REUSE_CAPACITY');
    return sealed;
  }

  function unseal(key, partitionHash, kind, id, bytes, expectedKeyId) {
    if (!bytes || !Number.isSafeInteger(bytes.byteLength) || bytes.byteLength > limits.maxEntryBytes) fail('REUSE_INTEGRITY');
    let envelope;
    try { envelope = JSON.parse(Buffer.from(bytes).toString('utf8')); } catch { fail('REUSE_INTEGRITY'); }
    if (!envelope || envelope.version !== 1 || typeof envelope.keyId !== 'string' || (expectedKeyId && envelope.keyId !== expectedKeyId)
      || typeof envelope.iv !== 'string' || typeof envelope.tag !== 'string' || typeof envelope.ciphertext !== 'string') fail('REUSE_INTEGRITY');
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decipher.setAAD(Buffer.from(`event-intelligence:scoped-reuse:v1:${kind}:${partitionHash}:${id}:${envelope.keyId}`, 'utf8'));
      decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      const plain = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, 'base64')), decipher.final()]);
      return JSON.parse(plain.toString('utf8'));
    } catch { fail('REUSE_INTEGRITY'); }
  }

  async function openStoreDatabase() {
    let database;
    try {
      await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
      const rootStats = await lstat(rootDirectory);
      if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) fail('REUSE_STORAGE');
      await chmod(rootDirectory, 0o700);
      const databasePath = path.join(rootDirectory, 'scoped-reuse.sqlite');
      let prior = null;
      try {
        prior = await lstat(databasePath);
        if (prior.isSymbolicLink() || !prior.isFile()) fail('REUSE_STORAGE');
      } catch (error) { if (error?.code !== 'ENOENT') throw error; }
      database = new DatabaseSync(databasePath, { timeout: limits.lockTimeoutMs });
      const opened = await lstat(databasePath);
      if (opened.isSymbolicLink() || !opened.isFile() || (prior && (opened.dev !== prior.dev || opened.ino !== prior.ino))) fail('REUSE_STORAGE');
      database.exec(`
          PRAGMA journal_mode = DELETE;
          PRAGMA synchronous = FULL;
          PRAGMA secure_delete = ON;
          PRAGMA trusted_schema = OFF;
          CREATE TABLE IF NOT EXISTS reuse_meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT;
          CREATE TABLE IF NOT EXISTS reuse_entries (
            entry_id TEXT PRIMARY KEY NOT NULL,
            scope_kind TEXT NOT NULL CHECK (scope_kind IN ('tenant_private', 'public_profile')),
            partition_hash TEXT NOT NULL,
            identity_hash TEXT NOT NULL,
            cache_key_hash TEXT NOT NULL,
            content_hash_mac TEXT NOT NULL,
            pins_hash TEXT NOT NULL,
            version INTEGER NOT NULL,
            created_at_ms INTEGER NOT NULL,
            expires_at_ms INTEGER NOT NULL,
            eligible INTEGER NOT NULL CHECK (eligible IN (0, 1)),
            payload_key_id TEXT NOT NULL,
            payload BLOB NOT NULL,
            payload_bytes INTEGER NOT NULL,
            payload_purged INTEGER NOT NULL DEFAULT 0 CHECK (payload_purged IN (0, 1))
          ) STRICT;
          CREATE INDEX IF NOT EXISTS reuse_lookup ON reuse_entries (scope_kind, partition_hash, cache_key_hash, eligible, version DESC);
          CREATE INDEX IF NOT EXISTS reuse_identity ON reuse_entries (scope_kind, partition_hash, identity_hash, eligible);
          CREATE TABLE IF NOT EXISTS reuse_observations (
            observation_id TEXT PRIMARY KEY NOT NULL,
            entry_id TEXT NOT NULL,
            sequence INTEGER NOT NULL,
            observed_at_ms INTEGER NOT NULL,
            status TEXT NOT NULL,
            payload_key_id TEXT NOT NULL,
            payload BLOB NOT NULL,
            UNIQUE(entry_id, sequence)
          ) STRICT;
          CREATE INDEX IF NOT EXISTS reuse_observation_latest ON reuse_observations (entry_id, sequence DESC);
          CREATE TABLE IF NOT EXISTS reuse_private_links (
            link_id TEXT PRIMARY KEY NOT NULL,
            tenant_partition_hash TEXT NOT NULL,
            public_entry_id TEXT NOT NULL,
            payload_key_id TEXT NOT NULL,
            payload BLOB NOT NULL,
            UNIQUE (tenant_partition_hash, public_entry_id)
          ) STRICT;
          CREATE INDEX IF NOT EXISTS reuse_private_link_lookup ON reuse_private_links (tenant_partition_hash, public_entry_id);
          CREATE TABLE IF NOT EXISTS reuse_consumer_refs (
            entry_id TEXT NOT NULL,
            scope_kind TEXT NOT NULL,
            partition_hash TEXT NOT NULL,
            consumer_hash TEXT NOT NULL,
            payload_key_id TEXT NOT NULL,
            payload BLOB NOT NULL,
            PRIMARY KEY (entry_id, consumer_hash)
          ) STRICT;
          CREATE TABLE IF NOT EXISTS reuse_flights (
            flight_key TEXT PRIMARY KEY NOT NULL,
            scope_kind TEXT NOT NULL,
            partition_hash TEXT NOT NULL,
            admission_id TEXT NOT NULL,
            state TEXT NOT NULL CHECK (state IN ('active', 'unknown', 'completed', 'not_dispatched')),
            created_at_ms INTEGER NOT NULL,
            lease_expires_at_ms INTEGER NOT NULL,
            payload_key_id TEXT NOT NULL,
            payload BLOB NOT NULL
          ) STRICT;
          CREATE TABLE IF NOT EXISTS reuse_outbox (
            event_id TEXT PRIMARY KEY NOT NULL,
            entry_id TEXT NOT NULL,
            scope_kind TEXT NOT NULL,
            partition_hash TEXT NOT NULL,
            status TEXT NOT NULL CHECK (status IN ('pending', 'delivering', 'failed', 'delivered')),
            attempt_count INTEGER NOT NULL,
            next_attempt_at_ms INTEGER NOT NULL,
            has_consumer INTEGER NOT NULL DEFAULT 1 CHECK (has_consumer IN (0, 1)),
            active_attempt_id TEXT,
            payload_key_id TEXT NOT NULL,
            payload BLOB NOT NULL,
            payload_bytes INTEGER NOT NULL
          ) STRICT;
          CREATE INDEX IF NOT EXISTS reuse_outbox_pending ON reuse_outbox (scope_kind, partition_hash, status, next_attempt_at_ms);
      `);
      const outboxColumns = database.prepare('PRAGMA table_info(reuse_outbox)').all();
      if (!outboxColumns.some((column) => column.name === 'active_attempt_id')) {
        database.exec('ALTER TABLE reuse_outbox ADD COLUMN active_attempt_id TEXT');
      }
      if (!outboxColumns.some((column) => column.name === 'has_consumer')) {
        database.exec('ALTER TABLE reuse_outbox ADD COLUMN has_consumer INTEGER NOT NULL DEFAULT 1 CHECK (has_consumer IN (0, 1))');
      }
      const entryColumns = database.prepare('PRAGMA table_info(reuse_entries)').all();
      if (!entryColumns.some((column) => column.name === 'payload_purged')) {
        database.exec('ALTER TABLE reuse_entries ADD COLUMN payload_purged INTEGER NOT NULL DEFAULT 0 CHECK (payload_purged IN (0, 1))');
      }
      await chmod(databasePath, 0o600);
      return database;
    } catch (error) {
      database?.close();
      throw safeError(error);
    }
  }

  async function prepareStoreDatabase() {
    return withLocalQueue(rootDirectory, openStoreDatabase);
  }

  async function withDatabase(operation) {
    return withLocalQueue(rootDirectory, async () => {
      let database;
      let transactionOpen = false;
      try {
        database = await openStoreDatabase();
        database.exec('BEGIN IMMEDIATE');
        transactionOpen = true;
        const currentMax = database.prepare("SELECT value FROM reuse_meta WHERE key = 'clock_max_ms'").get();
        const now = currentTime();
        const previousMax = currentMax ? Number(currentMax.value) : null;
        if (currentMax && (!Number.isSafeInteger(previousMax) || previousMax < 0 || previousMax > MAX_TIME)) fail('REUSE_INTEGRITY');
        const clockRollback = Boolean(currentMax && now < previousMax);
        if (!clockRollback && (!currentMax || now > previousMax)) {
          database.prepare("INSERT INTO reuse_meta (key, value) VALUES ('clock_max_ms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(now));
        }
        const result = operation(database, { now, clockRollback });
        database.exec('COMMIT');
        transactionOpen = false;
        return result;
      } catch (error) {
        if (transactionOpen) {
          try { database.exec('ROLLBACK'); } catch { /* SQLite also rolls back when the connection closes. */ }
        }
        throw safeError(error);
      } finally {
        database?.close();
      }
    });
  }

  function usedPayloadBytes(database) {
    return database.prepare(`
      SELECT
        (SELECT COALESCE(SUM(payload_bytes), 0) FROM reuse_entries) +
        (SELECT COALESCE(SUM(length(payload)), 0) FROM reuse_observations) +
        (SELECT COALESCE(SUM(length(payload)), 0) FROM reuse_private_links) +
        (SELECT COALESCE(SUM(length(payload)), 0) FROM reuse_consumer_refs) +
        (SELECT COALESCE(SUM(length(payload)), 0) FROM reuse_flights) +
        (SELECT COALESCE(SUM(payload_bytes), 0) FROM reuse_outbox) AS total
    `).get().total;
  }

  function reservationState(database) {
    const eligibleEntries = database.prepare('SELECT entry_id FROM reuse_entries WHERE eligible = 1').all();
    let reserved = 0;
    for (const entry of eligibleEntries) {
      const refs = database.prepare('SELECT COUNT(*) AS count FROM reuse_consumer_refs WHERE entry_id = ?').get(entry.entry_id).count;
      reserved += Math.max(1, refs);
    }
    return reserved;
  }

  function reservedOutboxGrowthBytes(database) {
    return database.prepare(`SELECT COALESCE(SUM(MAX(0, ? - payload_bytes)), 0) AS bytes
      FROM reuse_outbox WHERE has_consumer = 1 AND status IN ('pending', 'delivering') AND attempt_count < ?`)
      .get(MAX_INVALIDATION_RECORD_BYTES, limits.maxOutboxAttempts).bytes;
  }

  function ensureStorageCapacity(database, newBytes, replacedBytes = 0, additionalReservations = 0, additionalOutboxGrowth = 0, outboxGrowthCredit = 0) {
    const used = usedPayloadBytes(database);
    const reserved = reservationState(database) + additionalReservations;
    const retryGrowth = Math.max(0, reservedOutboxGrowthBytes(database) + additionalOutboxGrowth - outboxGrowthCredit);
    const outboxCount = database.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count;
    if (outboxCount + reserved > limits.maxOutboxEntries
      || used - replacedBytes + newBytes + reserved * MAX_INVALIDATION_RECORD_BYTES + retryGrowth > limits.maxStoreBytes) fail('REUSE_CAPACITY');
  }

  function assertOutboxHeadroom(database, additionalReservations = 0) {
    const reserved = reservationState(database);
    const outboxCount = database.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count;
    const totalReserved = reserved + additionalReservations;
    if (outboxCount + totalReserved > limits.maxOutboxEntries
      || usedPayloadBytes(database) + totalReserved * MAX_INVALIDATION_RECORD_BYTES + reservedOutboxGrowthBytes(database) > limits.maxStoreBytes) fail('REUSE_CAPACITY');
  }

  async function resolveRetention(info, kind, nowMs, requestedExpiry = null) {
    let result;
    try {
      result = await config.resolveRetention(Object.freeze({
        tenantId: info?.tenantId ?? null,
        kind,
        nowMs,
        requestedExpiryMs: requestedExpiry,
      }));
    } catch { fail('REUSE_POLICY_UNAVAILABLE'); }
    const decision = record(result, new Set(['expiresAtMs', 'policyId', 'policyVersion']));
    if (!decision || !Number.isSafeInteger(decision.expiresAtMs) || decision.expiresAtMs <= nowMs
      || decision.expiresAtMs - nowMs > limits.maxRetentionMs || !string(decision.policyId, 128)
      || !string(decision.policyVersion, 128)) fail('REUSE_POLICY_UNAVAILABLE');
    if (requestedExpiry !== null && decision.expiresAtMs > requestedExpiry) fail('REUSE_POLICY_UNAVAILABLE');
    return Object.freeze({ expiresAtMs: decision.expiresAtMs, policyId: decision.policyId, policyVersion: decision.policyVersion });
  }

  async function verifyObservation(info, request, expectedHash, rawObservation, purpose) {
    if (typeof config.verifySourceObservation !== 'function') fail('REUSE_POLICY_UNAVAILABLE');
    let result;
    try {
      result = await config.verifySourceObservation(Object.freeze({
        tenantId: info?.tenantId ?? null,
        actorId: info?.actorId ?? null,
        request,
        purpose,
        expectedContentHash: expectedHash,
        observation: rawObservation,
      }));
    } catch { fail('REUSE_POLICY_UNAVAILABLE'); }
    const parsed = record(result, new Set(['status', 'contentHash', 'retrievedAt', 'validatedAt', 'sourceVersion', 'attemptLineage']));
    if (!parsed || !['body_changed', 'not_modified', 'removed', 'outage', 'evidence_lost'].includes(parsed.status)
      || (parsed.sourceVersion !== undefined && parsed.sourceVersion !== null && !string(parsed.sourceVersion, 128))) fail('REUSE_POLICY_UNAVAILABLE');
    if (parsed.status === 'body_changed' || parsed.status === 'not_modified') {
      if (typeof parsed.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(parsed.contentHash)) fail('REUSE_POLICY_UNAVAILABLE');
    }
    if (purpose === 'initial' && parsed.contentHash !== expectedHash) fail('REUSE_POLICY_UNAVAILABLE');
    if (purpose === 'revalidate' && parsed.status === 'body_changed' && parsed.contentHash === expectedHash) fail('REUSE_POLICY_UNAVAILABLE');
    const validatedAtMs = timestamp(parsed.validatedAt);
    const retrievedAtMs = parsed.retrievedAt === undefined ? null : timestamp(parsed.retrievedAt);
    if (parsed.status === 'body_changed' && retrievedAtMs === null) fail('REUSE_POLICY_UNAVAILABLE');
    if (parsed.status === 'not_modified' && retrievedAtMs !== null) fail('REUSE_POLICY_UNAVAILABLE');
    if (parsed.status !== 'body_changed' && parsed.status !== 'not_modified' && retrievedAtMs !== null) fail('REUSE_POLICY_UNAVAILABLE');
    if (parsed.status === 'not_modified' && parsed.contentHash !== expectedHash) fail('REUSE_POLICY_UNAVAILABLE');
    return freeze({
      status: parsed.status,
      contentHash: parsed.contentHash ?? null,
      retrievedAtMs,
      validatedAtMs,
      sourceVersion: parsed.sourceVersion ?? 'unknown',
      attemptLineage: validateLineage(parsed.attemptLineage ?? { status: 'unknown' }),
    });
  }

  async function resolveLineage(info, request, descriptor) {
    if (typeof config.resolveLineage !== 'function') return validateLineage({ status: 'unknown' });
    let result;
    try {
      result = await config.resolveLineage(Object.freeze({ tenantId: info?.tenantId ?? null, actorId: info?.actorId ?? null, request, descriptor }));
    } catch { return validateLineage({ status: 'unknown' }); }
    try { return validateLineage(result); } catch { return validateLineage({ status: 'unknown' }); }
  }

  async function resolveConsumers(info, request, descriptor) {
    if (typeof config.resolveInvalidationConsumers !== 'function') return Object.freeze([]);
    let refs;
    try {
      refs = await config.resolveInvalidationConsumers(Object.freeze({ tenantId: info?.tenantId ?? null, actorId: info?.actorId ?? null, request, descriptor }));
    } catch { fail('REUSE_POLICY_UNAVAILABLE'); }
    try { return boundedRefList(refs, 64); } catch { fail('REUSE_POLICY_UNAVAILABLE'); }
  }

  function nextVersion(database, scopeKind, partitionHash, identityHash) {
    const row = database.prepare('SELECT MAX(version) AS version FROM reuse_entries WHERE scope_kind = ? AND partition_hash = ? AND identity_hash = ?').get(scopeKind, partitionHash, identityHash);
    return (row?.version ?? 0) + 1;
  }

  function decryptEntry(info, entry, kind = 'entry') {
    return unseal(info.payloadKey.key, entry.partition_hash, kind, entry.entry_id, entry.payload, entry.payload_key_id);
  }

  async function keyParts(info, scopeKind, index, guard) {
    const keys = await indexInfo(info, scopeKind, guard);
    const identityHash = mac(keys.keyInfo.key, stable(index.identity));
    const contentMac = mac(keys.keyInfo.key, index.contentHash);
    const pinsHash = mac(keys.keyInfo.key, stable(index.pins));
    const cacheKeyHash = mac(keys.keyInfo.key, stable({ identity: index.identity, contentHash: index.contentHash, pins: index.pins }));
    const payloadKey = await resolveKey(scopeKind === 'public_profile' ? null : info, 'payload', undefined, guard);
    return { ...keys, identityHash, contentMac, pinsHash, cacheKeyHash, payloadKey };
  }

  function insertObservation(database, entryId, partitionHash, payloadKeyId, payloadKey, observation, sequence = null) {
    const latest = database.prepare('SELECT MAX(sequence) AS sequence, COUNT(*) AS count FROM reuse_observations WHERE entry_id = ?').get(entryId);
    if (latest.count >= limits.maxObservationsPerEntry) fail('REUSE_CAPACITY');
    const seq = sequence ?? ((latest.sequence ?? 0) + 1);
    const observationId = randomUUID();
    const payload = sealBounded(payloadKey, payloadKeyId, partitionHash, 'observation', observationId, observation);
    ensureStorageCapacity(database, payload.byteLength);
    database.prepare('INSERT INTO reuse_observations (observation_id, entry_id, sequence, observed_at_ms, status, payload_key_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(observationId, entryId, seq, observation.validatedAtMs, observation.status, payloadKeyId, payload);
  }

  function latestIdentityObservation(database, scopeKind, partitionHash, identityHash) {
    return database.prepare(`SELECT o.observation_id, o.observed_at_ms, o.status, o.payload_key_id, o.payload,
        e.content_hash_mac, e.entry_id, e.version
      FROM reuse_observations o JOIN reuse_entries e ON e.entry_id = o.entry_id
      WHERE e.scope_kind = ? AND e.partition_hash = ? AND e.identity_hash = ?
      ORDER BY o.observed_at_ms DESC, e.version DESC, o.sequence DESC LIMIT 1`)
      .get(scopeKind, partitionHash, identityHash);
  }

  function checkInitialObservationOrder(database, keys, scopeKind, observation) {
    const latest = latestIdentityObservation(database, scopeKind, keys.partitionHash, keys.identityHash);
    if (!latest) return false;
    if (observation.validatedAtMs < latest.observed_at_ms) fail('REUSE_POLICY_UNAVAILABLE');
    if (observation.validatedAtMs > latest.observed_at_ms) return false;
    if (latest.status === 'body_changed' && latest.content_hash_mac === keys.contentMac
      && latest.payload_key_id === keys.payloadKey.keyId) {
      const prior = unseal(keys.payloadKey.key, keys.partitionHash, 'observation', latest.observation_id, latest.payload, latest.payload_key_id);
      const expected = {
        status: observation.status,
        contentHash: observation.contentHash,
        retrievedAtMs: observation.retrievedAtMs,
        bodyObservedAtMs: observation.status === 'body_changed' ? observation.retrievedAtMs : null,
        validatedAtMs: observation.validatedAtMs,
        sourceVersion: observation.sourceVersion,
        attemptLineage: observation.attemptLineage,
      };
      if (sameObservationIdentity(prior, expected)) return true;
    }
    fail('REUSE_POLICY_UNAVAILABLE');
  }

  function sameObservationIdentity(left, right) {
    const observedBodyTime = (observation) => observation.bodyObservedAtMs
      ?? (observation.status === 'body_changed' ? observation.retrievedAtMs : null);
    return left.status === right.status
      && left.contentHash === right.contentHash
      && left.retrievedAtMs === right.retrievedAtMs
      && observedBodyTime(left) === observedBodyTime(right)
      && left.validatedAtMs === right.validatedAtMs
      && left.sourceVersion === right.sourceVersion
      && stable(left.attemptLineage) === stable(right.attemptLineage);
  }

  function eventPayload(entry, payload, reason, consumerRef, now, indexKey) {
    return {
      eventId: randomUUID(),
      reason,
      entryRef: entry.entry_id,
      contentHash: entry.scope_kind === 'public_profile'
        ? mac(indexKey, `public-content:${payload.contentHash}`)
        : payload.contentHash,
      version: entry.version,
      consumerRef,
      createdAtMs: now,
    };
  }

  function assertConsumersRevocable(consumers, keys, partitionHash) {
    const probeId = 'f'.repeat(36);
    for (const consumerRef of consumers) {
      if (consumerRef === null) continue;
      const base = {
        eventId: probeId,
        reason: 'policy_version_change',
        entryRef: 'e'.repeat(36),
        contentHash: 'f'.repeat(64),
        version: Number.MAX_SAFE_INTEGER,
        consumerRef,
        createdAtMs: MAX_TIME,
      };
      sealBounded(keys.payloadKey.key, keys.payloadKey.keyId, partitionHash, 'outbox', probeId, base, MAX_INVALIDATION_RECORD_BYTES);
      sealBounded(keys.payloadKey.key, keys.payloadKey.keyId, partitionHash, 'outbox', probeId, {
        ...base,
        deliveryAttemptId: 'd'.repeat(36),
        deliveryAttemptNumber: Number.MAX_SAFE_INTEGER,
      }, MAX_INVALIDATION_RECORD_BYTES);
    }
  }

  function registeredConsumers(database, entry, payload, keys) {
    const refs = new Set(payload.consumers ?? []);
    const rows = database.prepare('SELECT * FROM reuse_consumer_refs WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?').all(entry.entry_id, entry.scope_kind, entry.partition_hash);
    for (const row of rows) {
      const refKey = row.payload_key_id === keys.payloadKey.keyId ? keys.payloadKey : null;
      const key = refKey;
      if (!key) fail('REUSE_KEY_UNAVAILABLE');
      const content = unseal(key.key, row.partition_hash, 'consumer_ref', `${entry.entry_id}:${row.consumer_hash}`, row.payload, row.payload_key_id);
      if (!content || !string(content.consumerRef)) fail('REUSE_INTEGRITY');
      refs.add(content.consumerRef);
    }
    return Object.freeze([...refs]);
  }

  function registerConsumers(database, entryId, scopeKind, keys, refs) {
    let prior = database.prepare('SELECT COUNT(*) AS count FROM reuse_consumer_refs').get().count;
    const existingForEntry = database.prepare('SELECT consumer_hash FROM reuse_consumer_refs WHERE entry_id = ?').all(entryId);
    const existingHashes = new Set(existingForEntry.map((row) => row.consumer_hash));
    const newHashes = new Set(refs.map((consumerRef) => mac(keys.keyInfo.key, consumerRef)).filter((consumerHash) => !existingHashes.has(consumerHash)));
    const existingReservation = Math.max(1, existingHashes.size);
    const nextReservation = Math.max(1, existingHashes.size + newHashes.size);
    assertOutboxHeadroom(database, nextReservation - existingReservation);
    for (const consumerRef of refs) {
      const consumerHash = mac(keys.keyInfo.key, consumerRef);
      const exists = database.prepare('SELECT 1 AS found FROM reuse_consumer_refs WHERE entry_id = ? AND consumer_hash = ?').get(entryId, consumerHash);
      if (exists) continue;
      if (prior >= limits.maxOutboxEntries) fail('REUSE_CAPACITY');
      const payload = sealBounded(keys.payloadKey.key, keys.payloadKey.keyId, keys.partitionHash, 'consumer_ref', `${entryId}:${consumerHash}`, { consumerRef });
      const currentCount = database.prepare('SELECT COUNT(*) AS count FROM reuse_consumer_refs WHERE entry_id = ?').get(entryId).count;
      const reservationDelta = Math.max(1, currentCount + 1) - Math.max(1, currentCount);
      ensureStorageCapacity(database, payload.byteLength, 0, reservationDelta);
      database.prepare('INSERT INTO reuse_consumer_refs (entry_id, scope_kind, partition_hash, consumer_hash, payload_key_id, payload) VALUES (?, ?, ?, ?, ?, ?)')
        .run(entryId, scopeKind, keys.partitionHash, consumerHash, keys.payloadKey.keyId, payload);
      prior += 1;
    }
  }

  function enqueueInvalidations(database, entry, payload, reason, consumers, now, keys) {
    const count = database.prepare('SELECT COUNT(*) AS count FROM reuse_outbox').get().count;
    const targetRefs = consumers.length > 0 ? consumers : [null];
    const reserved = reservationState(database);
    if (count + targetRefs.length + reserved > limits.maxOutboxEntries) fail('REUSE_CAPACITY');
    const prepared = [];
    for (const consumerRef of targetRefs) {
      const event = eventPayload(entry, payload, reason, consumerRef, now, keys.keyInfo.key);
      const sealed = sealBounded(keys.payloadKey.key, keys.payloadKey.keyId, entry.partition_hash, 'outbox', event.eventId, event, MAX_INVALIDATION_RECORD_BYTES);
      prepared.push({ event, consumerRef, sealed });
    }
    const eventBytes = prepared.reduce((total, item) => total + item.sealed.byteLength, 0);
    const retryGrowth = prepared.reduce((total, item) => total + MAX_INVALIDATION_RECORD_BYTES - item.sealed.byteLength, 0);
    ensureStorageCapacity(database, eventBytes, 0, 0, retryGrowth);
    for (const { event, consumerRef, sealed } of prepared) {
      database.prepare('INSERT INTO reuse_outbox (event_id, entry_id, scope_kind, partition_hash, status, attempt_count, next_attempt_at_ms, has_consumer, payload_key_id, payload, payload_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(event.eventId, entry.entry_id, entry.scope_kind, entry.partition_hash, 'pending', 0, now, consumerRef === null ? 0 : 1,
          keys.payloadKey.keyId, sealed, sealed.byteLength);
    }
  }

  function invalidateEntry(database, info, entry, payload, reason, consumers, now, keys) {
    if (!entry || entry.eligible !== 1 || !payload) return false;
    const current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?')
      .get(entry.entry_id, entry.scope_kind, entry.partition_hash);
    if (!current || current.eligible !== 1 || current.version !== entry.version
      || current.payload_bytes !== entry.payload_bytes || current.payload_purged === 1) return false;
    const changed = database.prepare('UPDATE reuse_entries SET eligible = 0 WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ? AND eligible = 1 AND version = ? AND payload_purged = 0')
      .run(current.entry_id, current.scope_kind, current.partition_hash, current.version);
    if (changed.changes !== 1) return false;
    const allConsumers = registeredConsumers(database, current, payload, keys);
    enqueueInvalidations(database, current, payload, reason, allConsumers, now, keys);
    return true;
  }

  function expireEntry(database, info, entry, payload, now, keys) {
    if (!entry || entry.expires_at_ms > now) return false;
    let transitioned = false;
    if (entry.eligible === 1) {
      if (!payload) fail('REUSE_INTEGRITY');
      transitioned = invalidateEntry(database, info, entry, payload, 'retention_expired', payload.consumers ?? [], now, keys);
    }
    if (entry.payload_purged !== 1) {
      const purged = database.prepare('UPDATE reuse_entries SET payload = ?, payload_bytes = 0, payload_purged = 1 WHERE entry_id = ? AND payload_purged = 0')
        .run(Buffer.alloc(0), entry.entry_id);
      transitioned ||= purged.changes === 1;
    }
    database.prepare('DELETE FROM reuse_observations WHERE entry_id = ?').run(entry.entry_id);
    database.prepare('DELETE FROM reuse_private_links WHERE public_entry_id = ?').run(entry.entry_id);
    database.prepare('DELETE FROM reuse_consumer_refs WHERE entry_id = ?').run(entry.entry_id);
    return transitioned;
  }

  async function maybePermissions(info, request, payload, use, now) {
    if (!Array.isArray(payload.permissions) || payload.permissions.length === 0) {
      return payload.kind === 'public' && use === 'fact_read' ? { status: 'not_asserted', valid: true } : { status: 'unverified', valid: false };
    }
    if (typeof config.verifyPermission !== 'function') return { status: 'unverified', valid: false };
    let validUntilMs = MAX_TIME;
    for (const permission of payload.permissions) {
      if (permission.contentHash !== payload.contentHash || permission.use !== use) return { status: 'use_or_hash_mismatch', valid: false };
      let result;
      try {
        result = await config.verifyPermission(Object.freeze({
          tenantId: info?.tenantId ?? null,
          actorId: info?.actorId ?? null,
          request,
          reference: permission.reference,
          contentHash: permission.contentHash,
          version: permission.version,
          use,
          nowMs: now,
        }));
      } catch { return { status: 'unverified', valid: false }; }
      if (info) {
        const action = payload.kind === 'public' ? 'public_profile.read' : 'private_profile.read';
        await authorize(info, request, action);
      }
      const decision = permissionDecision(result, permission, currentTime());
      if (!decision.valid) return decision;
      validUntilMs = Math.min(validUntilMs, decision.validUntilMs);
    }
    if (currentTime() >= validUntilMs) return { status: 'expired', valid: false };
    return { status: 'valid', valid: true, validUntilMs };
  }

  async function verifyStoredPermissions(info, request, payload, authorizationAction, now) {
    if (!Array.isArray(payload.permissions) || payload.permissions.length === 0) return { status: 'not_asserted', valid: true };
    if (typeof config.verifyPermission !== 'function') return { status: 'unverified', valid: false };
    let validUntilMs = MAX_TIME;
    for (const permission of payload.permissions) {
      if (permission.contentHash !== payload.contentHash) return { status: 'use_or_hash_mismatch', valid: false };
      let result;
      try {
        result = await config.verifyPermission(Object.freeze({
          tenantId: info?.tenantId ?? null,
          actorId: info?.actorId ?? null,
          request,
          reference: permission.reference,
          contentHash: permission.contentHash,
          version: permission.version,
          use: permission.use,
          nowMs: now,
        }));
      } catch { return { status: 'unverified', valid: false }; }
      if (info) await authorize(info, request, authorizationAction);
      const decision = permissionDecision(result, permission, currentTime());
      if (!decision.valid) return decision;
      validUntilMs = Math.min(validUntilMs, decision.validUntilMs);
    }
    if (currentTime() >= validUntilMs) return { status: 'expired', valid: false };
    return { status: 'valid', valid: true, validUntilMs };
  }

  function permissionDecision(result, permission, now) {
    if (typeof result === 'string') {
      if (result === 'revoked' || result === 'expired') return { status: result, valid: false };
      return { status: 'unverified', valid: false };
    }
    const parsed = record(result, new Set(['status', 'reference', 'contentHash', 'version', 'use', 'validUntilMs']));
    if (!parsed || parsed.status !== 'valid' || parsed.reference !== permission.reference
      || parsed.contentHash !== permission.contentHash || parsed.version !== permission.version || parsed.use !== permission.use) {
      return { status: parsed?.status === 'revoked' || parsed?.status === 'expired' ? parsed.status : 'unverified', valid: false };
    }
    if (!Number.isSafeInteger(parsed.validUntilMs) || parsed.validUntilMs > MAX_TIME) return { status: 'unverified', valid: false };
    if (parsed.validUntilMs <= now) return { status: 'expired', valid: false };
    return { status: 'valid', valid: true, validUntilMs: parsed.validUntilMs };
  }

  async function storeProfile(info, request, scopeKind, input, publicFacts, external = {}) {
    const index = copyIndex(input);
    const parsedIdentity = index.identity;
    const parsedPins = index.pins;
    const now = currentTime();
    if (signalAborted(external.signal)) fail('REUSE_DENIED');
    const observation = await verifyObservation(info, request, index.contentHash, input.observation, 'initial');
    await authorize(info, request, scopeKind === 'public_profile' ? 'public_profile.publish' : 'private_profile.write');
    if (signalAborted(external.signal)) fail('REUSE_DENIED');
    if (observation.status !== 'body_changed') fail('REUSE_POLICY_UNAVAILABLE');
    if (observation.retrievedAtMs > observation.validatedAtMs || observation.validatedAtMs > now + 60_000) fail('REUSE_POLICY_UNAVAILABLE');
    const retention = await resolveRetention(info, scopeKind, now, input.expiresAtMs ?? null);
    await authorize(info, request, scopeKind === 'public_profile' ? 'public_profile.publish' : 'private_profile.write');
    if (signalAborted(external.signal)) fail('REUSE_DENIED');
    const ttlMs = input.freshnessTtlMs ?? limits.defaultFreshnessTtlMs;
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > retention.expiresAtMs - now) fail('REUSE_INVALID');
    let privateReferences = { permissions: [], sourceRefs: [], correctionRefs: [] };
    if (typeof config.resolvePrivateProfileReferences === 'function') {
      let references;
      try {
        references = await config.resolvePrivateProfileReferences(Object.freeze({
          tenantId: info.tenantId,
          actorId: info.actorId,
          request,
          kind: scopeKind,
          identity: parsedIdentity,
          contentHash: index.contentHash,
          projection: publicFacts,
        }));
      } catch { fail('REUSE_POLICY_UNAVAILABLE'); }
      const parsed = record(references, new Set(['permissions', 'sourceRefs', 'correctionRefs']));
      if (!parsed) fail('REUSE_POLICY_UNAVAILABLE');
      privateReferences = {
        permissions: validatePermissions(parsed.permissions ?? []),
        sourceRefs: boundedRefList(parsed.sourceRefs ?? []),
        correctionRefs: boundedRefList(parsed.correctionRefs ?? []),
      };
      await authorize(info, request, scopeKind === 'public_profile' ? 'public_profile.publish' : 'private_profile.write');
      if (signalAborted(external.signal)) fail('REUSE_DENIED');
    }
    const permissions = validatePermissions(scopeKind === 'public_profile' ? (external.publicPermissions ?? []) : privateReferences.permissions);
    const lineage = await resolveLineage(info, request, Object.freeze({
      kind: scopeKind,
      identity: parsedIdentity,
      contentHash: index.contentHash,
      version: 1,
      observation: observation.status,
    }));
    await authorize(info, request, scopeKind === 'public_profile' ? 'public_profile.publish' : 'private_profile.write');
    if (signalAborted(external.signal)) fail('REUSE_DENIED');
    const consumers = await resolveConsumers(info, request, Object.freeze({
      identity: parsedIdentity,
      contentHash: index.contentHash,
      scopeKind,
      ...(scopeKind === 'public_profile' ? { publicSafeOnly: true } : {}),
    }));
    await authorize(info, request, scopeKind === 'public_profile' ? 'public_profile.publish' : 'private_profile.write');
    if (signalAborted(external.signal)) fail('REUSE_DENIED');
    const writeAction = scopeKind === 'public_profile' ? 'public_profile.publish' : 'private_profile.write';
    const keys = await keyParts(info, scopeKind, index, async () => {
      await authorize(info, request, writeAction);
      if (signalAborted(external.signal)) fail('REUSE_DENIED');
    });
    assertConsumersRevocable(consumers, keys, keys.partitionHash);
    const scoped = { ...keys, scopeKind, index, info };
    const profileRef = randomUUID();
    const entryPayload = freeze({
      kind: scopeKind === 'public_profile' ? 'public' : 'private',
      identity: parsedIdentity,
      pins: parsedPins,
      contentHash: index.contentHash,
      facts: publicFacts,
      sourceVersion: observation.sourceVersion,
      retrievedAtMs: observation.retrievedAtMs,
      initialValidatedAtMs: observation.validatedAtMs,
      freshnessTtlMs: ttlMs,
      permissions,
      sourceRefs: scopeKind === 'tenant_private' ? privateReferences.sourceRefs : Object.freeze([]),
      correctionRefs: scopeKind === 'tenant_private' ? privateReferences.correctionRefs : Object.freeze([]),
      lineage: scopeKind === 'tenant_private' ? lineage : validateLineage({ status: 'unknown' }),
      consumers,
      retentionPolicy: retention,
      rights: 'not_asserted',
    });
    const serializedBytes = Buffer.byteLength(stable(entryPayload), 'utf8');
    if (serializedBytes > limits.maxEntryBytes) fail('REUSE_CAPACITY');
    const ciphertext = sealBounded(keys.payloadKey.key, keys.payloadKey.keyId, keys.partitionHash, 'entry', profileRef, entryPayload);
    let privateLinkKeys = null;
    if (scopeKind === 'public_profile') {
      privateLinkKeys = await indexInfo(info, 'tenant_private');
      await authorize(info, request, 'public_profile.publish');
      if (signalAborted(external.signal)) fail('REUSE_DENIED');
      privateLinkKeys.payloadKey = await resolveKey(info, 'payload');
      await authorize(info, request, 'public_profile.publish');
      if (signalAborted(external.signal)) fail('REUSE_DENIED');
    }
    const privateLinkPayload = scopeKind === 'public_profile' ? {
      sourceRecordId: external.sourceRecordId ?? null,
      contentHash: index.contentHash,
      identity: parsedIdentity,
      sourceRefs: privateReferences.sourceRefs,
      correctionRefs: privateReferences.correctionRefs,
      permissions: privateReferences.permissions,
      lineage,
    } : null;
    if (privateLinkPayload && Buffer.byteLength(stable(privateLinkPayload), 'utf8') > limits.maxEntryBytes) fail('REUSE_CAPACITY');
    if (scopeKind === 'public_profile') {
      await authorize(info, request, 'public_profile.publish');
      if (signalAborted(external.signal)) fail('REUSE_DENIED');
    }
    const result = await withDatabase((database, time) => {
      if (time.clockRollback || signalAborted(external.signal)) fail('REUSE_DENIED');
      const existing = database.prepare('SELECT * FROM reuse_entries WHERE scope_kind = ? AND partition_hash = ? AND cache_key_hash = ? AND eligible = 1 ORDER BY version DESC LIMIT 1')
        .get(scopeKind, keys.partitionHash, keys.cacheKeyHash);
      const duplicateInitialObservation = checkInitialObservationOrder(database, keys, scopeKind, observation);
      if (existing) {
        if (existing.expires_at_ms <= time.now) {
          const oldPayload = decryptEntry(scoped, existing);
          expireEntry(database, info, existing, oldPayload, time.now, keys);
          return Object.freeze({ status: 'expired', profileRef: existing.entry_id, version: existing.version, freshness: 'unavailable', originalLineageStatus: 'unknown' });
        }
        const oldPayload = decryptEntry(scoped, existing);
        if (!duplicateInitialObservation) {
          insertObservation(database, existing.entry_id, existing.partition_hash, keys.payloadKey.keyId, keys.payloadKey.key,
            { status: 'body_changed', retrievedAtMs: observation.retrievedAtMs, bodyObservedAtMs: observation.retrievedAtMs, validatedAtMs: observation.validatedAtMs, contentHash: index.contentHash, sourceVersion: observation.sourceVersion, attemptLineage: observation.attemptLineage });
        }
        registerConsumers(database, existing.entry_id, scopeKind, keys, consumers);
        let originalLineageStatus = oldPayload.lineage?.status ?? 'unknown';
        if (privateLinkPayload) {
          const priorLink = database.prepare('SELECT link_id FROM reuse_private_links WHERE tenant_partition_hash = ? AND public_entry_id = ?')
            .get(privateLinkKeys.partitionHash, existing.entry_id);
          if (priorLink) {
            originalLineageStatus = 'unknown';
          } else {
            const tenantLinkId = randomUUID();
            const linkPayload = { ...privateLinkPayload, version: existing.version, expiresAtMs: existing.expires_at_ms };
            const linkCiphertext = sealBounded(privateLinkKeys.payloadKey.key, privateLinkKeys.payloadKey.keyId, privateLinkKeys.partitionHash, 'private_link', tenantLinkId, linkPayload);
            if (database.prepare('SELECT COUNT(*) AS count FROM reuse_private_links').get().count >= limits.maxPrivateLinks) fail('REUSE_CAPACITY');
            ensureStorageCapacity(database, linkCiphertext.byteLength);
            database.prepare('INSERT INTO reuse_private_links (link_id, tenant_partition_hash, public_entry_id, payload_key_id, payload) VALUES (?, ?, ?, ?, ?)')
              .run(tenantLinkId, privateLinkKeys.partitionHash, existing.entry_id, privateLinkKeys.payloadKey.keyId, linkCiphertext);
            originalLineageStatus = lineage.status;
          }
        }
        return Object.freeze({ status: 'existing', profileRef: existing.entry_id, version: existing.version, freshness: 'body_retrieved_unchanged', originalLineageStatus });
      }
      const current = database.prepare('SELECT * FROM reuse_entries WHERE scope_kind = ? AND partition_hash = ? AND identity_hash = ? AND eligible = 1 ORDER BY version DESC')
        .all(scopeKind, keys.partitionHash, keys.identityHash);
      const historicalCap = database.prepare('SELECT MIN(expires_at_ms) AS expires_at_ms FROM reuse_entries WHERE scope_kind = ? AND partition_hash = ? AND identity_hash = ? AND cache_key_hash = ?')
        .get(scopeKind, keys.partitionHash, keys.identityHash, keys.cacheKeyHash).expires_at_ms;
      const fixedExpiry = historicalCap === null ? retention.expiresAtMs : Math.min(retention.expiresAtMs, historicalCap);
      if (fixedExpiry <= time.now) fail('REUSE_POLICY_UNAVAILABLE');
      for (const oldEntry of current) {
        const oldPayload = decryptEntry(scoped, oldEntry);
        const reason = oldEntry.content_hash_mac !== keys.contentMac ? 'material_fact_change'
          : oldEntry.pins_hash !== keys.pinsHash ? 'policy_version_change' : 'superseded_profile';
        invalidateEntry(database, info, oldEntry, oldPayload, reason, oldPayload.consumers ?? [], time.now, keys);
      }
      const entryCount = database.prepare('SELECT COUNT(*) AS count FROM reuse_entries').get().count;
      if (entryCount >= limits.maxEntries) fail('REUSE_CAPACITY');
      const version = nextVersion(database, scopeKind, keys.partitionHash, keys.identityHash);
      const fixedRetention = Object.freeze({ ...retention, expiresAtMs: fixedExpiry });
      const versionedPayload = freeze({ ...entryPayload, retentionPolicy: fixedRetention, version });
      const sealed = sealBounded(keys.payloadKey.key, keys.payloadKey.keyId, keys.partitionHash, 'entry', profileRef, versionedPayload);
      ensureStorageCapacity(database, sealed.byteLength);
      database.prepare('INSERT INTO reuse_entries (entry_id, scope_kind, partition_hash, identity_hash, cache_key_hash, content_hash_mac, pins_hash, version, created_at_ms, expires_at_ms, eligible, payload_key_id, payload, payload_bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)')
        .run(profileRef, scopeKind, keys.partitionHash, keys.identityHash, keys.cacheKeyHash, keys.contentMac, keys.pinsHash, version, time.now, fixedExpiry, keys.payloadKey.keyId, sealed, sealed.byteLength);
      registerConsumers(database, profileRef, scopeKind, keys, consumers);
      insertObservation(database, profileRef, keys.partitionHash, keys.payloadKey.keyId, keys.payloadKey.key,
        { status: 'body_changed', retrievedAtMs: observation.retrievedAtMs, validatedAtMs: observation.validatedAtMs, contentHash: index.contentHash, sourceVersion: observation.sourceVersion, attemptLineage: observation.attemptLineage });
      if (privateLinkPayload) {
        const tenantLinkId = randomUUID();
        const linkPayload = { ...privateLinkPayload, version, expiresAtMs: fixedExpiry };
        const linkCiphertext = sealBounded(privateLinkKeys.payloadKey.key, privateLinkKeys.payloadKey.keyId, privateLinkKeys.partitionHash, 'private_link', tenantLinkId, linkPayload);
        if (database.prepare('SELECT COUNT(*) AS count FROM reuse_private_links').get().count >= limits.maxPrivateLinks) fail('REUSE_CAPACITY');
        ensureStorageCapacity(database, linkCiphertext.byteLength);
        database.prepare('INSERT INTO reuse_private_links (link_id, tenant_partition_hash, public_entry_id, payload_key_id, payload) VALUES (?, ?, ?, ?, ?)')
          .run(tenantLinkId, privateLinkKeys.partitionHash, profileRef, privateLinkKeys.payloadKey.keyId, linkCiphertext);
      }
      return Object.freeze({ status: 'stored', profileRef, version, freshness: 'fresh', originalLineageStatus: lineage.status, rights: 'not_asserted' });
    });
    await authorize(info, request, scopeKind === 'public_profile' ? 'public_profile.publish' : 'private_profile.write');
    if (signalAborted(external.signal)) fail('REUSE_DENIED');
    if (result.status === 'stored' || result.status === 'existing') {
      const headState = await withDatabase((database, time) => {
        if (time.clockRollback) return 'clock_rollback';
        const current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?')
          .get(result.profileRef, scopeKind, keys.partitionHash);
        const head = database.prepare('SELECT entry_id, expires_at_ms FROM reuse_entries WHERE scope_kind = ? AND partition_hash = ? AND identity_hash = ? AND eligible = 1 ORDER BY version DESC LIMIT 1')
          .get(scopeKind, keys.partitionHash, keys.identityHash);
        if (!current || current.eligible !== 1 || !head || head.entry_id !== current.entry_id) return 'not_current_head';
        if (current.expires_at_ms <= time.now || head.expires_at_ms <= time.now) {
          const currentPayload = decryptEntry(scoped, current);
          expireEntry(database, info, current, currentPayload, time.now, keys);
          return 'expired';
        }
        return 'current';
      });
      await authorize(info, request, scopeKind === 'public_profile' ? 'public_profile.publish' : 'private_profile.write');
      if (signalAborted(external.signal)) fail('REUSE_DENIED');
      if (headState === 'expired') {
        return Object.freeze({ status: 'expired', profileRef: result.profileRef, version: result.version, freshness: 'unavailable', originalLineageStatus: 'unknown' });
      }
      if (headState !== 'current') fail('REUSE_DENIED');
    }
    return result;
  }

  async function putPrivateProfile(scope, request, inputValue) {
    const info = scopeInfo(scope);
    const input = record(inputValue, new Set(['identity', 'contentHash', 'pins', 'facts', 'observation', 'freshnessTtlMs', 'expiresAtMs', 'signal']));
    if (!input) fail('REUSE_INVALID');
    const facts = copyFacts(input.facts);
    copyIndex(input);
    await authorize(info, request, 'private_profile.write');
    return storeProfile(info, request, 'tenant_private', input, facts, { signal: input.signal });
  }

  async function publishReviewedPublicProfile(scope, request, inputValue) {
    const info = scopeInfo(scope);
    const input = record(inputValue, new Set([
      'boundary', 'boundaryScope', 'derivative', 'identity', 'contentHash', 'pins', 'observation', 'freshnessTtlMs', 'expiresAtMs', 'signal',
    ]));
    if (!input || !isPrivacyBoundary(input.boundary) || !input.boundaryScope || !input.derivative
      || typeof config.authorizePublicPublication !== 'function') fail('REUSE_POLICY_UNAVAILABLE');
    const parsedIdentity = identity(input.identity);
    const contentHash = hashValue(input.contentHash);
    const parsedPins = pins(input.pins);
    let exported;
    try { exported = input.boundary.exportDerivative(input.boundaryScope, input.derivative); } catch { fail('REUSE_DENIED'); }
    const facts = copyFacts(exported.facts, true);
    await authorize(info, request, 'public_profile.publish');
    let attestation;
    try {
      attestation = await config.authorizePublicPublication(Object.freeze({
        tenantId: info.tenantId,
        actorId: info.actorId,
        request,
        boundaryTrust: exported.trust,
        facts,
        identity: parsedIdentity,
        contentHash,
        boundaryScope: input.boundaryScope,
        sourceRecordId: exported.recordId,
      }));
    } catch { fail('REUSE_POLICY_UNAVAILABLE'); }
    await authorize(info, request, 'public_profile.publish');
    if (signalAborted(input.signal)) fail('REUSE_DENIED');
    const approval = record(attestation, new Set(['status', 'contentHash', 'identity', 'publicPermissions']));
    if (!approval || approval.status !== 'approved' || approval.contentHash !== contentHash
      || stable(identity(approval.identity)) !== stable(parsedIdentity)) fail('REUSE_POLICY_UNAVAILABLE');
    const publicPermissions = validatePermissions(approval.publicPermissions ?? []);
    return storeProfile(info, request, 'public_profile', {
      identity: parsedIdentity,
      contentHash,
      pins: parsedPins,
      observation: input.observation,
      freshnessTtlMs: input.freshnessTtlMs,
      expiresAtMs: input.expiresAtMs,
      signal: input.signal,
    }, facts, { publicPermissions, sourceRecordId: exported.recordId, signal: input.signal });
  }

  function eligibility(row, payload, observation, now, clockRollback, pinsMatch) {
    if (clockRollback) return { status: 'unavailable', reason: 'clock_rollback' };
    if (row.eligible !== 1) return { status: 'unavailable', reason: 'invalidated' };
    if (!pinsMatch) return { status: 'stale', reason: 'policy_hash_stale' };
    if (row.expires_at_ms <= now || payload.retentionPolicy?.expiresAtMs <= now) return { status: 'unavailable', reason: 'expired' };
    if (observation.status === 'removed') return { status: 'unavailable', reason: 'source_removed' };
    if (observation.status === 'evidence_lost') return { status: 'unavailable', reason: 'evidence_lost' };
    if (observation.status === 'outage') return { status: 'unavailable', reason: 'source_outage' };
    if (observation.status === 'body_changed' && observation.contentHash !== payload.contentHash) return { status: 'stale', reason: 'body_changed' };
    if (!Number.isSafeInteger(observation.validatedAtMs) || observation.validatedAtMs > now + 60_000) return { status: 'unavailable', reason: 'invalid_validation_time' };
    if (now - observation.validatedAtMs >= payload.freshnessTtlMs) return { status: 'stale', reason: 'ttl_expired' };
    return { status: 'fresh', reason: null };
  }

  async function readCurrentFreshness(info, request, scopeKind, row, entryPayload, keys, readGuard, pinsMatch, linkedPrivateRef = null) {
    const snapshot = () => withDatabase((database, time) => {
      let current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?')
        .get(row.entry_id, scopeKind, row.partition_hash);
      if (!time.clockRollback && current && current.expires_at_ms <= time.now && current.payload_purged !== 1) {
        expireEntry(database, info, current, current.eligible === 1 ? entryPayload : null, time.now, keys);
        current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?')
          .get(row.entry_id, scopeKind, row.partition_hash);
      }
      const head = database.prepare('SELECT entry_id, expires_at_ms FROM reuse_entries WHERE scope_kind = ? AND partition_hash = ? AND identity_hash = ? AND eligible = 1 ORDER BY version DESC LIMIT 1')
        .get(scopeKind, row.partition_hash, row.identity_hash);
      const observation = current?.eligible === 1
        ? database.prepare('SELECT * FROM reuse_observations WHERE entry_id = ? ORDER BY sequence DESC LIMIT 1').get(row.entry_id)
        : null;
      const privateLink = linkedPrivateRef === null ? null
        : database.prepare('SELECT link_id, payload_key_id, payload, length(payload) AS payload_bytes FROM reuse_private_links WHERE public_entry_id = ? AND tenant_partition_hash = ?')
          .get(row.entry_id, linkedPrivateRef.partitionHash);
      return { now: time.now, clockRollback: time.clockRollback, current, head, observation, privateLink };
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const first = await snapshot();
      if (first.clockRollback) return { state: { status: 'unavailable', reason: 'clock_rollback' }, now: first.now };
      if (!first.current || first.current.eligible !== 1 || !first.head || first.head.entry_id !== row.entry_id) {
        return { state: { status: 'unavailable', reason: first.current?.expires_at_ms <= first.now ? 'expired' : 'invalidated' }, now: first.now };
      }
      if (first.current.expires_at_ms <= first.now) return { state: { status: 'unavailable', reason: 'expired' }, now: first.now };
      if (!first.observation) return { state: { status: 'unavailable', reason: 'observation_missing' }, now: first.now };
      const observationKey = first.observation.payload_key_id === keys.payloadKey.keyId
        ? keys.payloadKey
        : await resolveKey(scopeKind === 'public_profile' ? null : info, 'payload', first.observation.payload_key_id, readGuard);
      const observation = unseal(observationKey.key, row.partition_hash, 'observation', first.observation.observation_id,
        first.observation.payload, first.observation.payload_key_id);
      const final = await snapshot();
      if (final.clockRollback) return { state: { status: 'unavailable', reason: 'clock_rollback' }, now: final.now };
      if (!final.current || final.current.eligible !== 1 || !final.head || final.head.entry_id !== row.entry_id) {
        return { state: { status: 'unavailable', reason: final.current?.expires_at_ms <= final.now ? 'expired' : 'invalidated' }, now: final.now };
      }
      if (final.current.version !== first.current.version || final.current.payload_bytes !== first.current.payload_bytes
        || !final.observation || final.observation.sequence !== first.observation.sequence
        || final.observation.observation_id !== first.observation.observation_id) continue;
      if (linkedPrivateRef && (!final.privateLink || final.privateLink.link_id !== linkedPrivateRef.linkId
        || final.privateLink.payload_key_id !== linkedPrivateRef.payloadKeyId
        || final.privateLink.payload_bytes !== linkedPrivateRef.payloadBytes)) {
        return { state: { status: 'unavailable', reason: 'invalidated' }, now: final.now };
      }
      const state = eligibility(final.current, entryPayload, observation, final.now, false, pinsMatch);
      return { state, now: final.now, observation, current: final.current, head: final.head, privateLink: final.privateLink };
    }
    return { state: { status: 'unavailable', reason: 'observation_changed' }, now: currentTime() };
  }

  async function finalizeCurrentFreshness(info, request, action, scopeKind, row, entryPayload, keys, readGuard,
    pinsMatch, linkedPrivateRef, permissionCheck, complete) {
    const entryInfo = scopeKind === 'public_profile' ? null : info;
    const snapshot = () => withDatabase((database, time) => {
      let current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?')
        .get(row.entry_id, scopeKind, row.partition_hash);
      if (!time.clockRollback && current && current.expires_at_ms <= time.now && current.payload_purged !== 1) {
        expireEntry(database, entryInfo, current, current.eligible === 1 ? entryPayload : null, time.now, keys);
        current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?')
          .get(row.entry_id, scopeKind, row.partition_hash);
      }
      const head = database.prepare('SELECT entry_id, expires_at_ms FROM reuse_entries WHERE scope_kind = ? AND partition_hash = ? AND identity_hash = ? AND eligible = 1 ORDER BY version DESC LIMIT 1')
        .get(scopeKind, row.partition_hash, row.identity_hash);
      const observation = current?.eligible === 1
        ? database.prepare('SELECT * FROM reuse_observations WHERE entry_id = ? ORDER BY sequence DESC LIMIT 1').get(row.entry_id)
        : null;
      const privateLink = linkedPrivateRef === null ? null
        : database.prepare('SELECT link_id, payload_key_id, payload, length(payload) AS payload_bytes FROM reuse_private_links WHERE public_entry_id = ? AND tenant_partition_hash = ?')
          .get(row.entry_id, linkedPrivateRef.partitionHash);
      return { now: time.now, clockRollback: time.clockRollback, current, head, observation, privateLink };
    });
    const finishEarly = (state, now) => complete({ state, now }, undefined);
    const first = await snapshot();
    if (first.clockRollback) return finishEarly({ status: 'unavailable', reason: 'clock_rollback' }, first.now);
    if (!first.current || first.current.eligible !== 1 || !first.head || first.head.entry_id !== row.entry_id) {
      return finishEarly({ status: 'unavailable', reason: first.current?.expires_at_ms <= first.now ? 'expired' : 'invalidated' }, first.now);
    }
    if (first.current.expires_at_ms <= first.now) return finishEarly({ status: 'unavailable', reason: 'expired' }, first.now);
    if (!sameStoredEntry(first.current, row)) return finishEarly({ status: 'unavailable', reason: 'observation_changed' }, first.now);
    if (!first.observation) return finishEarly({ status: 'unavailable', reason: 'observation_missing' }, first.now);
    if (linkedPrivateRef && (!first.privateLink || first.privateLink.link_id !== linkedPrivateRef.linkId
      || first.privateLink.payload_key_id !== linkedPrivateRef.payloadKeyId
      || first.privateLink.payload_bytes !== linkedPrivateRef.payloadBytes
      || !Buffer.from(first.privateLink.payload).equals(Buffer.from(linkedPrivateRef.payload)))) {
      return finishEarly({ status: 'unavailable', reason: 'invalidated' }, first.now);
    }
    const observationKey = first.observation.payload_key_id === keys.payloadKey.keyId
      ? keys.payloadKey
      : await resolveKey(scopeKind === 'public_profile' ? null : info, 'payload', first.observation.payload_key_id, readGuard);
    const observation = unseal(observationKey.key, row.partition_hash, 'observation', first.observation.observation_id,
      first.observation.payload, first.observation.payload_key_id);

    // Finish asynchronous filesystem, key, permission and legacy authorization work before
    // the combined current-principal/exact-action host decision.
    // The connection is open but has no transaction while trusted host callbacks run.
    const database = await prepareStoreDatabase();
    let transactionOpen = false;
    let final;
    let finalPermissionState;
    try {
      if (permissionCheck) finalPermissionState = await permissionCheck();
      await authorize(info, request, action, { profileRef: row.entry_id });
      await authorizeCurrentRequest(info, request, action, { profileRef: row.entry_id });
      database.exec('BEGIN IMMEDIATE');
      transactionOpen = true;
      const currentMax = database.prepare("SELECT value FROM reuse_meta WHERE key = 'clock_max_ms'").get();
      const now = currentTime();
      const previousMax = currentMax ? Number(currentMax.value) : null;
      if (currentMax && (!Number.isSafeInteger(previousMax) || previousMax < 0 || previousMax > MAX_TIME)) fail('REUSE_INTEGRITY');
      const clockRollback = Boolean(currentMax && now < previousMax);
      if (!clockRollback && (!currentMax || now > previousMax)) {
        database.prepare("INSERT INTO reuse_meta (key, value) VALUES ('clock_max_ms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(now));
      }
      let current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?')
        .get(row.entry_id, scopeKind, row.partition_hash);
      if (!clockRollback && current && current.expires_at_ms <= now && current.payload_purged !== 1) {
        expireEntry(database, entryInfo, current, current.eligible === 1 ? entryPayload : null, now, keys);
        current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?')
          .get(row.entry_id, scopeKind, row.partition_hash);
      }
      const head = database.prepare('SELECT entry_id, expires_at_ms FROM reuse_entries WHERE scope_kind = ? AND partition_hash = ? AND identity_hash = ? AND eligible = 1 ORDER BY version DESC LIMIT 1')
        .get(scopeKind, row.partition_hash, row.identity_hash);
      const latestObservation = current?.eligible === 1
        ? database.prepare('SELECT * FROM reuse_observations WHERE entry_id = ? ORDER BY sequence DESC LIMIT 1').get(row.entry_id)
        : null;
      const privateLink = linkedPrivateRef === null ? null
        : database.prepare('SELECT link_id, payload_key_id, payload, length(payload) AS payload_bytes FROM reuse_private_links WHERE public_entry_id = ? AND tenant_partition_hash = ?')
          .get(row.entry_id, linkedPrivateRef.partitionHash);
      let state;
      if (clockRollback) {
        state = { status: 'unavailable', reason: 'clock_rollback' };
      } else if (!current || current.eligible !== 1 || !head || head.entry_id !== row.entry_id) {
        state = { status: 'unavailable', reason: current?.expires_at_ms <= now ? 'expired' : 'invalidated' };
      } else if (current.expires_at_ms <= now) {
        state = { status: 'unavailable', reason: 'expired' };
      } else if (!sameStoredEntry(current, first.current) || !sameStoredObservation(latestObservation, first.observation)) {
        state = { status: 'unavailable', reason: 'observation_changed' };
      } else if (linkedPrivateRef && !sameStoredPrivateLink(privateLink, first.privateLink)) {
        state = { status: 'unavailable', reason: 'invalidated' };
      } else if (!latestObservation) {
        state = { status: 'unavailable', reason: 'observation_missing' };
      } else {
        state = eligibility(current, entryPayload, observation, now, false, pinsMatch);
      }
      final = { state, now, observation, current, head, privateLink, permissionState: finalPermissionState };
      database.exec('COMMIT');
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        try { database.exec('ROLLBACK'); } catch { /* SQLite also rolls back when the connection closes. */ }
      }
      throw safeError(error);
    } finally {
      database.close();
    }
    // Internal completion only builds the result or invokes the authorized Finance callback.
    // It runs synchronously after the persisted snapshot and outside any SQLite transaction.
    return await complete(final, finalPermissionState);
  }

  function sameStoredEntry(left, right) {
    return Boolean(left && right && left.entry_id === right.entry_id && left.scope_kind === right.scope_kind
      && left.partition_hash === right.partition_hash && left.identity_hash === right.identity_hash
      && left.version === right.version && left.expires_at_ms === right.expires_at_ms
      && left.eligible === right.eligible && left.payload_key_id === right.payload_key_id
      && left.payload_bytes === right.payload_bytes && left.payload_purged === right.payload_purged
      && Buffer.from(left.payload).equals(Buffer.from(right.payload)));
  }

  function sameStoredObservation(left, right) {
    return Boolean(left && right && left.observation_id === right.observation_id && left.entry_id === right.entry_id
      && left.sequence === right.sequence && left.observed_at_ms === right.observed_at_ms && left.status === right.status
      && left.payload_key_id === right.payload_key_id && Buffer.from(left.payload).equals(Buffer.from(right.payload)));
  }

  function sameStoredPrivateLink(left, right) {
    return Boolean(left && right && left.link_id === right.link_id && left.payload_key_id === right.payload_key_id
      && left.payload_bytes === right.payload_bytes && Buffer.from(left.payload).equals(Buffer.from(right.payload)));
  }

  async function lookupProfile(scope, request, scopeKind, lookupValue, use = 'fact_read') {
    const info = scope ? scopeInfo(scope) : null;
    const lookup = record(lookupValue, new Set(['identity', 'contentHash', 'pins']));
    if (!lookup) fail('REUSE_INVALID');
    const index = copyIndex(lookup);
    const readAction = `${scopeKind === 'public_profile' ? 'public' : 'private'}_profile.read`;
    if (info) await authorize(info, request, readAction);
    const keys = await keyParts(info, scopeKind, index, async () => {
      if (info) await authorize(info, request, readAction);
    });
    const candidate = await withDatabase((database, time) => {
      if (time.clockRollback) return { clockRollback: true };
      const exact = database.prepare('SELECT * FROM reuse_entries WHERE scope_kind = ? AND partition_hash = ? AND cache_key_hash = ? ORDER BY version DESC LIMIT 1')
        .get(scopeKind, keys.partitionHash, keys.cacheKeyHash);
      const row = exact ?? database.prepare('SELECT * FROM reuse_entries WHERE scope_kind = ? AND partition_hash = ? AND identity_hash = ? ORDER BY version DESC LIMIT 1')
        .get(scopeKind, keys.partitionHash, keys.identityHash);
      if (!row) return null;
      if (row.eligible !== 1) return { row, now: time.now, payloadKey: null, invalidated: true, clockRollback: false };
      const payloadKey = keys.payloadKey.keyId === row.payload_key_id ? keys.payloadKey : null;
      return { row, now: time.now, payloadKey, clockRollback: false };
    });
    if (!candidate) return Object.freeze({ status: 'miss' });
    if (candidate.clockRollback) return Object.freeze({ status: 'unavailable', reason: 'clock_rollback' });
    const row = candidate.row;
    if (candidate.invalidated) {
      if (row.expires_at_ms <= candidate.now && row.payload_purged !== 1) {
        await withDatabase((database, time) => {
          const current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?')
            .get(row.entry_id, scopeKind, row.partition_hash);
          expireEntry(database, info, current, null, time.now, keys);
        });
      }
      if (info) await authorize(info, request, `${scopeKind === 'public_profile' ? 'public' : 'private'}_profile.read`);
      return Object.freeze({ status: 'unavailable', reason: 'invalidated', profileRef: row.entry_id });
    }
    const readGuard = authorizationGuard(info, request, readAction);
    const payloadKey = candidate.payloadKey ?? await resolveKey(scopeKind === 'public_profile' ? null : info, 'payload', row.payload_key_id, readGuard);
    const entryPayload = unseal(payloadKey.key, row.partition_hash, 'entry', row.entry_id, row.payload, row.payload_key_id);
    const latest = await withDatabase((database) => {
      const observationRow = database.prepare('SELECT * FROM reuse_observations WHERE entry_id = ? ORDER BY sequence DESC LIMIT 1').get(row.entry_id);
      if (!observationRow) fail('REUSE_INTEGRITY');
      return observationRow;
    });
    const observationKey = latest.payload_key_id === payloadKey.keyId ? payloadKey : await resolveKey(scopeKind === 'public_profile' ? null : info, 'payload', latest.payload_key_id, readGuard);
    const observation = unseal(observationKey.key, row.partition_hash, 'observation', latest.observation_id, latest.payload, latest.payload_key_id);
    const identityMatches = stable(entryPayload.identity) === stable(index.identity);
    const contentMatches = entryPayload.contentHash === index.contentHash;
    const pinsMatch = row.pins_hash === keys.pinsHash && stable(entryPayload.pins) === stable(index.pins);
    const state = !identityMatches
      ? { status: 'stale', reason: 'identity_version_mismatch' }
      : !contentMatches
        ? { status: 'stale', reason: 'content_hash_mismatch' }
        : eligibility(row, entryPayload, observation, candidate.now, false, pinsMatch);
    if (state.status !== 'fresh') {
      if (state.reason === 'expired') {
        await withDatabase((database, time) => {
          const current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ?').get(row.entry_id);
          expireEntry(database, info, current, entryPayload, time.now, keys);
        });
      } else if (state.reason === 'source_removed' || state.reason === 'evidence_lost') {
        const consumers = entryPayload.consumers ?? [];
        await withDatabase((database, time) => {
          const current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ?').get(row.entry_id);
          invalidateEntry(database, info, current, entryPayload, state.reason, consumers, time.now, keys);
        });
      }
      if (info) await authorize(info, request, `${scopeKind === 'public_profile' ? 'public' : 'private'}_profile.read`);
      return Object.freeze({ status: state.status, reason: state.reason, profileRef: row.entry_id });
    }
    const permissionState = await maybePermissions(info, request, entryPayload, use, candidate.now);
    if (info) await authorize(info, request, `${scopeKind === 'public_profile' ? 'public' : 'private'}_profile.read`);
    const invalidatePermission = async (state) => {
      if (state.status !== 'revoked' && state.status !== 'expired') return;
      await withDatabase((database, time) => {
        const current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ?').get(row.entry_id);
        invalidateEntry(database, info, current, entryPayload, `permission_${state.status}`, entryPayload.consumers ?? [], time.now, keys);
      });
      if (info) await authorize(info, request, readAction);
    };
    if (!permissionState.valid) {
      await invalidatePermission(permissionState);
      return Object.freeze({ status: 'ineligible', reason: `permission_${permissionState.status}`, profileRef: row.entry_id });
    }
    const finalState = await readCurrentFreshness(info, request, scopeKind, row, entryPayload, keys, readGuard, pinsMatch);
    if (finalState.state.status !== 'fresh') {
      if (info) await authorize(info, request, `${scopeKind === 'public_profile' ? 'public' : 'private'}_profile.read`);
      return Object.freeze({ status: finalState.state.status, reason: finalState.state.reason, profileRef: row.entry_id });
    }
    const preFinalPermissionState = await maybePermissions(info, request, entryPayload, use, currentTime());
    if (!preFinalPermissionState.valid) {
      await invalidatePermission(preFinalPermissionState);
      return Object.freeze({ status: 'ineligible', reason: `permission_${preFinalPermissionState.status}`, profileRef: row.entry_id });
    }
    if (info) await authorize(info, request, readAction);
    const finalized = await finalizeCurrentFreshness(info, request, readAction, scopeKind, row, entryPayload, keys,
      readGuard, pinsMatch, null,
      () => maybePermissions(info, request, entryPayload, use, currentTime()),
      (finalCheck, finalPermissionState) => {
        if (finalPermissionState && !finalPermissionState.valid) {
          return { kind: 'permission', state: finalPermissionState };
        }
        if (finalCheck.state.status !== 'fresh') {
          return { kind: 'result', result: Object.freeze({
            status: finalCheck.state.status, reason: finalCheck.state.reason, profileRef: row.entry_id,
          }) };
        }
        if (!finalPermissionState?.valid) {
          return { kind: 'permission', state: finalPermissionState ?? { status: 'unverified' } };
        }
        if (finalPermissionState.validUntilMs !== undefined && finalPermissionState.validUntilMs <= finalCheck.now) {
          return { kind: 'permission', state: { status: 'expired' } };
        }
        const finalObservation = finalCheck.observation;
        if (scopeKind === 'public_profile') {
          return { kind: 'result', result: Object.freeze({
            status: 'hit',
            profileRef: row.entry_id,
            version: row.version,
            facts: entryPayload.facts,
            trust: 'untrusted_external',
            rights: 'not_asserted',
            permissionStatus: finalPermissionState.status,
            retrievedAt: iso(effectiveRetrievedAt(entryPayload, finalObservation)),
            validatedAt: iso(finalObservation.validatedAtMs),
            expiresAt: iso(row.expires_at_ms),
            originalLineageStatus: entryPayload.lineage?.status ?? 'unknown',
          }) };
        }
        return { kind: 'result', result: Object.freeze({
          status: 'hit',
          profileRef: row.entry_id,
          version: row.version,
          facts: entryPayload.facts,
          trust: 'tenant_private',
          permissionStatus: finalPermissionState.status,
          retrievedAt: iso(effectiveRetrievedAt(entryPayload, finalObservation)),
          validatedAt: iso(finalObservation.validatedAtMs),
          expiresAt: iso(row.expires_at_ms),
          originalLineageStatus: entryPayload.lineage?.status ?? 'unknown',
        }) };
      });
    if (finalized.kind === 'permission') {
      await invalidatePermission(finalized.state);
      return Object.freeze({ status: 'ineligible', reason: `permission_${finalized.state.status}`, profileRef: row.entry_id });
    }
    return finalized.result;
  }

  async function getPrivateProfile(scope, request, lookup) {
    scopeInfo(scope);
    return lookupProfile(scope, request, 'tenant_private', lookup, 'cache_read');
  }

  async function getPublicProfile(scope, request, lookup) {
    scopeInfo(scope);
    return lookupProfile(scope, request, 'public_profile', lookup, 'fact_read');
  }

  function entryRefFor(scope, ref) {
    if (typeof ref !== 'string' || !/^[0-9a-f-]{36}$/.test(ref)) fail('REUSE_NOT_FOUND');
    void scope;
    return ref;
  }

  async function loadEntry(info, scopeKind, ref, guard) {
    const keys = await indexInfo(info, scopeKind, guard);
    const row = await withDatabase((database) => database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?').get(ref, scopeKind, keys.partitionHash));
    if (!row) fail('REUSE_NOT_FOUND');
    const payloadKey = await resolveKey(scopeKind === 'public_profile' ? null : info, 'payload', row.payload_key_id, guard);
    return { row, keys: { ...keys, payloadKey }, payloadKey, payload: unseal(payloadKey.key, row.partition_hash, 'entry', row.entry_id, row.payload, row.payload_key_id) };
  }

  async function observe(scope, request, inputValue) {
    const info = scopeInfo(scope);
    const input = record(inputValue, new Set(['profileRef', 'scopeKind', 'observation']));
    if (!input || !['tenant_private', 'public_profile'].includes(input.scopeKind)) fail('REUSE_INVALID');
    const ref = entryRefFor(scope, input.profileRef);
    await authorize(info, request, 'freshness.observe');
    const { row, keys, payloadKey, payload } = await loadEntry(info, input.scopeKind, ref, authorizationGuard(info, request, 'freshness.observe'));
    await authorize(info, request, 'freshness.observe', { profileRef: ref });
    const preflightNow = currentTime();
    if (row.eligible !== 1) fail('REUSE_DENIED');
    if (row.expires_at_ms <= preflightNow) {
      await withDatabase((database, time) => expireEntry(database, info, row, payload, time.now, keys));
      await authorize(info, request, 'freshness.observe', { profileRef: ref });
      fail('REUSE_DENIED');
    }
    const observationGuard = authorizationGuard(info, request, 'freshness.observe');
    const last = await withDatabase((database) => database.prepare('SELECT * FROM reuse_observations WHERE entry_id = ? ORDER BY sequence DESC LIMIT 1').get(ref));
    if (!last) fail('REUSE_INTEGRITY');
    const lastPayloadKey = last.payload_key_id === payloadKey.keyId
      ? payloadKey
      : await resolveKey(input.scopeKind === 'public_profile' ? null : info, 'payload', last.payload_key_id, observationGuard);
    const rawCurrent = unseal(lastPayloadKey.key, row.partition_hash, 'observation', last.observation_id, last.payload, last.payload_key_id);
    const verified = await verifyObservation(info, request, payload.contentHash, input.observation, 'revalidate');
    await authorize(info, request, 'freshness.observe', { profileRef: ref });
    if (verified.status === 'not_modified' && verified.contentHash !== payload.contentHash) fail('REUSE_POLICY_UNAVAILABLE');
    if (verified.status === 'body_changed' && verified.retrievedAtMs > verified.validatedAtMs) fail('REUSE_POLICY_UNAVAILABLE');
    if (verified.validatedAtMs < rawCurrent.validatedAtMs) fail('REUSE_POLICY_UNAVAILABLE');
    const now = currentTime();
    if (verified.validatedAtMs > now + 60_000) fail('REUSE_POLICY_UNAVAILABLE');
    const next = {
      status: verified.status,
      contentHash: verified.contentHash,
      retrievedAtMs: effectiveRetrievedAt(payload, rawCurrent),
      bodyObservedAtMs: verified.status === 'body_changed' ? verified.retrievedAtMs : null,
      validatedAtMs: verified.validatedAtMs,
      sourceVersion: verified.sourceVersion,
      attemptLineage: verified.attemptLineage,
      previousObservationStatus: rawCurrent.status,
    };
    const result = await withDatabase((database, time) => {
      if (time.clockRollback) return Object.freeze({ status: 'unavailable', reason: 'clock_rollback' });
      const current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?')
        .get(ref, input.scopeKind, keys.partitionHash);
      if (!current || current.version !== row.version || current.payload_bytes !== row.payload_bytes) {
        return Object.freeze({ status: 'unavailable', reason: 'observation_changed' });
      }
      if (current.eligible !== 1) return Object.freeze({ status: 'unavailable', reason: 'invalidated' });
      if (current.expires_at_ms <= time.now) {
        expireEntry(database, info, current, payload, time.now, { ...keys, payloadKey });
        return Object.freeze({ status: 'unavailable', reason: 'expired' });
      }
      const currentLast = database.prepare('SELECT * FROM reuse_observations WHERE entry_id = ? ORDER BY sequence DESC LIMIT 1').get(ref);
      if (!currentLast || currentLast.sequence !== last.sequence || currentLast.observation_id !== last.observation_id) {
        return Object.freeze({ status: 'unavailable', reason: 'observation_changed' });
      }
      const identityLatest = latestIdentityObservation(database, input.scopeKind, keys.partitionHash, current.identity_hash);
      if (!identityLatest || verified.validatedAtMs < identityLatest.observed_at_ms) {
        return Object.freeze({ status: 'unavailable', reason: 'observation_changed' });
      }
      if (verified.validatedAtMs === identityLatest.observed_at_ms) {
        if (identityLatest.entry_id !== ref || !sameObservationIdentity(rawCurrent, next)) fail('REUSE_POLICY_UNAVAILABLE');
        return Object.freeze({
          status: verified.status,
          profileRef: ref,
          invalidated: false,
          duplicateObservation: true,
          retrievedAt: iso(effectiveRetrievedAt(payload, rawCurrent)),
          validatedAt: iso(rawCurrent.validatedAtMs),
          usageLineage: rawCurrent.attemptLineage.status,
        });
      }
      const count = database.prepare('SELECT COUNT(*) AS count FROM reuse_observations WHERE entry_id = ?').get(ref).count;
      if (count >= limits.maxObservationsPerEntry) fail('REUSE_CAPACITY');
      insertObservation(database, ref, row.partition_hash, payloadKey.keyId, payloadKey.key, next, currentLast.sequence + 1);
      let invalidated = false;
      if (verified.status !== 'not_modified' && verified.status !== 'outage') {
        const reason = verified.status === 'body_changed' ? 'source_body_changed' : verified.status;
        invalidated = invalidateEntry(database, info, current, payload, reason, payload.consumers ?? [], time.now, { ...keys, payloadKey });
      }
      return Object.freeze({ status: verified.status, profileRef: ref, invalidated, retrievedAt: iso(effectiveRetrievedAt(payload, rawCurrent)), validatedAt: iso(verified.validatedAtMs), usageLineage: verified.attemptLineage.status });
    });
    await authorize(info, request, 'freshness.observe', { profileRef: ref });
    if (result.status === 'unavailable' && result.reason !== 'clock_rollback') fail('REUSE_BUSY');
    return result;
  }

  async function withPrivateLineage(scope, request, profileRef) {
    const info = scopeInfo(scope);
    const ref = entryRefFor(scope, profileRef);
    if (typeof config.consumeOriginalLineage !== 'function') fail('REUSE_POLICY_UNAVAILABLE');
    await authorize(info, request, 'finance.read_original_lineage', { profileRef: ref });
    const keys = await indexInfo(info, 'tenant_private', authorizationGuard(info, request, 'finance.read_original_lineage'));
    await authorize(info, request, 'finance.read_original_lineage', { profileRef: ref });
    const located = await withDatabase((database, time) => {
      const entry = database.prepare("SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = 'tenant_private' AND partition_hash = ?").get(ref, keys.partitionHash);
      if (entry) return { kind: 'private_entry', row: entry, now: time.now, clockRollback: time.clockRollback };
      const link = database.prepare('SELECT * FROM reuse_private_links WHERE public_entry_id = ? AND tenant_partition_hash = ?').get(ref, keys.partitionHash);
      if (!link) return null;
      const parent = database.prepare("SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = 'public_profile'").get(ref);
      return { kind: 'public_link', row: link, parent, now: time.now, clockRollback: time.clockRollback };
    });
    if (!located || located.clockRollback) fail('REUSE_DENIED');
    const lineageGuard = authorizationGuard(info, request, 'finance.read_original_lineage');
    if (located.kind === 'private_entry' && located.row.eligible !== 1) fail('REUSE_DENIED');
    if (located.kind === 'public_link' && (!located.parent || located.parent.eligible !== 1)) {
      await withDatabase((database) => database.prepare('DELETE FROM reuse_private_links WHERE link_id = ?').run(located.row.link_id));
      await authorize(info, request, 'finance.read_original_lineage', { profileRef: ref });
      fail('REUSE_DENIED');
    }
    const key = await resolveKey(info, 'payload', located.row.payload_key_id, lineageGuard);
    await authorize(info, request, 'finance.read_original_lineage', { profileRef: ref });
    const payload = unseal(key.key, keys.partitionHash, located.kind === 'private_entry' ? 'entry' : 'private_link', located.kind === 'private_entry' ? ref : located.row.link_id, located.row.payload, located.row.payload_key_id);
    const deadline = located.kind === 'private_entry' ? located.row.expires_at_ms : payload.expiresAtMs;
    let publicParentPayload = null;
    let publicParentKeys = null;
    if (located.kind === 'public_link' && located.parent.expires_at_ms <= located.now) {
      publicParentKeys = await indexInfo(null, 'public_profile', lineageGuard);
      const publicKey = await resolveKey(null, 'payload', located.parent.payload_key_id, lineageGuard);
      publicParentKeys.payloadKey = publicKey;
      publicParentPayload = unseal(publicKey.key, located.parent.partition_hash, 'entry', located.parent.entry_id, located.parent.payload, located.parent.payload_key_id);
      await withDatabase((database, time) => {
        const current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ?').get(ref);
        expireEntry(database, null, current, publicParentPayload, time.now, publicParentKeys);
      });
      await authorize(info, request, 'finance.read_original_lineage', { profileRef: ref });
      fail('REUSE_DENIED');
    }
    if (deadline !== null && deadline <= located.now) {
      if (located.kind === 'private_entry' && located.row.eligible === 1) {
        const keyBundle = { ...keys, payloadKey: key };
        await withDatabase((database, time) => expireEntry(database, info, located.row, payload, time.now, keyBundle));
      } else if (located.kind === 'public_link') {
        await withDatabase((database) => database.prepare('DELETE FROM reuse_private_links WHERE link_id = ?').run(located.row.link_id));
      }
      await authorize(info, request, 'finance.read_original_lineage', { profileRef: ref });
      fail('REUSE_DENIED');
    }
    const permissionNow = currentTime();
    const permissionState = await verifyStoredPermissions(info, request, payload, 'finance.read_original_lineage', permissionNow);
    if (!permissionState.valid) {
      if (permissionState.status === 'revoked' || permissionState.status === 'expired') {
        if (located.kind === 'private_entry') {
          await withDatabase((database, time) => {
            const current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ?').get(ref);
            invalidateEntry(database, info, current, payload, `permission_${permissionState.status}`, payload.consumers ?? [], time.now, { ...keys, payloadKey: key });
          });
        } else {
          publicParentKeys ??= await indexInfo(null, 'public_profile', lineageGuard);
          if (!publicParentKeys.payloadKey) publicParentKeys.payloadKey = await resolveKey(null, 'payload', located.parent.payload_key_id, lineageGuard);
          publicParentPayload ??= unseal(publicParentKeys.payloadKey.key, located.parent.partition_hash, 'entry', located.parent.entry_id, located.parent.payload, located.parent.payload_key_id);
          await withDatabase((database, time) => {
            const current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ?').get(ref);
            invalidateEntry(database, null, current, publicParentPayload, `permission_${permissionState.status}`, publicParentPayload.consumers ?? [], time.now, publicParentKeys);
          });
        }
      }
      await authorize(info, request, 'finance.read_original_lineage', { profileRef: ref });
      fail('REUSE_DENIED');
    }
    let handoffFreshness;
    if (located.kind === 'private_entry') {
      handoffFreshness = await readCurrentFreshness(info, request, 'tenant_private', located.row, payload,
        { ...keys, payloadKey: key }, lineageGuard, true);
    } else {
      publicParentKeys ??= await indexInfo(null, 'public_profile', lineageGuard);
      if (!publicParentKeys.payloadKey) publicParentKeys.payloadKey = await resolveKey(null, 'payload', located.parent.payload_key_id, lineageGuard);
      publicParentPayload ??= unseal(publicParentKeys.payloadKey.key, located.parent.partition_hash, 'entry', located.parent.entry_id,
        located.parent.payload, located.parent.payload_key_id);
      handoffFreshness = await readCurrentFreshness(null, request, 'public_profile', located.parent, publicParentPayload,
        publicParentKeys, lineageGuard, true);
    }
    if (!handoffFreshness || handoffFreshness.state.status !== 'fresh') fail('REUSE_DENIED');
    await authorize(info, request, 'finance.read_original_lineage', { profileRef: ref });
    const preFinalPermissionState = await verifyStoredPermissions(info, request, payload, 'finance.read_original_lineage', currentTime());
    if (!preFinalPermissionState.valid) fail('REUSE_DENIED');
    await authorize(info, request, 'finance.read_original_lineage', { profileRef: ref });
    if (located.kind === 'public_link') {
      publicParentKeys ??= await indexInfo(null, 'public_profile', lineageGuard);
      if (!publicParentKeys.payloadKey) publicParentKeys.payloadKey = await resolveKey(null, 'payload', located.parent.payload_key_id, lineageGuard);
      publicParentPayload ??= unseal(publicParentKeys.payloadKey.key, located.parent.partition_hash, 'entry', located.parent.entry_id,
        located.parent.payload, located.parent.payload_key_id);
    }
    const finalRow = located.kind === 'private_entry' ? located.row : located.parent;
    const finalScopeKind = located.kind === 'private_entry' ? 'tenant_private' : 'public_profile';
    const finalPayload = located.kind === 'private_entry' ? payload : publicParentPayload;
    const finalKeys = located.kind === 'private_entry' ? { ...keys, payloadKey: key } : publicParentKeys;
    const finalFreshness = await finalizeCurrentFreshness(info, request, 'finance.read_original_lineage', finalScopeKind,
      finalRow, finalPayload, finalKeys, lineageGuard, true,
      located.kind === 'public_link' ? {
        partitionHash: keys.partitionHash,
        linkId: located.row.link_id,
        payloadKeyId: located.row.payload_key_id,
        payload: located.row.payload,
        payloadBytes: located.row.payload.byteLength,
      } : null,
      () => verifyStoredPermissions(info, request, payload, 'finance.read_original_lineage', currentTime()),
      async (finalCheck, finalPermissionState) => {
        if (!finalCheck || finalCheck.state.status !== 'fresh' || !finalPermissionState?.valid) fail('REUSE_DENIED');
        const handoffTime = finalCheck.now;
        if (deadline !== null && handoffTime >= deadline) fail('REUSE_DENIED');
        if (finalPermissionState.validUntilMs !== undefined && handoffTime >= finalPermissionState.validUntilMs) fail('REUSE_DENIED');
        let response;
        try {
          // Invoke the trusted host handoff synchronously after the final snapshot; the DB is closed.
          response = config.consumeOriginalLineage(Object.freeze({
            tenantId: info.tenantId,
            actorId: info.actorId,
            request,
            profileRef: ref,
            scope: 'tenant_private',
            contentHash: payload.contentHash,
            version: located.kind === 'private_entry' ? located.row.version : payload.version,
            lineage: payload.lineage ?? validateLineage({ status: 'unknown' }),
            sourceRefs: payload.sourceRefs ?? Object.freeze([]),
            correctionRefs: payload.correctionRefs ?? Object.freeze([]),
            permissions: payload.permissions ?? Object.freeze([]),
          }));
          response = await response;
        } catch { fail('REUSE_POLICY_UNAVAILABLE'); }
        await authorize(info, request, 'finance.read_original_lineage', { profileRef: ref });
        const safe = record(response, new Set(['status', 'logicalOperationBound', 'billedAttemptCount', 'usageObservationCount']));
        if (!safe || !['linked', 'incomplete', 'unavailable'].includes(safe.status)
          || typeof safe.logicalOperationBound !== 'boolean'
          || !Number.isSafeInteger(safe.billedAttemptCount) || safe.billedAttemptCount < 0
          || !Number.isSafeInteger(safe.usageObservationCount) || safe.usageObservationCount < 0) fail('REUSE_POLICY_UNAVAILABLE');
        return Object.freeze({
          status: safe.status,
          logicalOperationBound: safe.logicalOperationBound,
          billedAttemptCount: safe.billedAttemptCount,
          usageObservationCount: safe.usageObservationCount,
          allocationAuthority: 'finance_external',
        });
      });
    return finalFreshness;
  }

  async function invalidate(scope, request, inputValue) {
    const info = scopeInfo(scope);
    const input = record(inputValue, new Set(['profileRef', 'scopeKind', 'reason']));
    if (!input || !['tenant_private', 'public_profile'].includes(input.scopeKind)
      || !['material_fact_change', 'rights_revocation', 'evidence_lost', 'permission_expiry'].includes(input.reason)) fail('REUSE_INVALID');
    const ref = entryRefFor(scope, input.profileRef);
    await authorize(info, request, 'cache.invalidate');
    const { row, keys, payload, payloadKey } = await loadEntry(info, input.scopeKind, ref, authorizationGuard(info, request, 'cache.invalidate'));
    return withDatabase((database, time) => Object.freeze({
      invalidated: invalidateEntry(database, info, row, payload, input.reason, payload.consumers ?? [], time.now, { ...keys, payloadKey }),
      profileRef: ref,
      version: row.version,
    }));
  }

  async function admitOperation(scope, request, inputValue) {
    const info = scopeInfo(scope);
    const input = record(inputValue, new Set(['identity', 'pins', 'mode', 'leaseMs']));
    if (!input || !['reuse', 'fresh'].includes(input.mode)) fail('REUSE_INVALID');
    const parsedIdentity = identity(input.identity);
    const parsedPins = pins(input.pins);
    const leaseMs = input.leaseMs ?? 60_000;
    if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 15 * 60_000) fail('REUSE_INVALID');
    await authorize(info, request, 'operation.admit');
    const operationGuard = authorizationGuard(info, request, 'operation.admit');
    const keys = await indexInfo(info, 'tenant_private', operationGuard);
    const baseKey = mac(keys.keyInfo.key, stable({
      scopeKind: 'tenant_private',
      partitionHash: keys.partitionHash,
      indexKeyId: keys.keyInfo.keyId,
      identity: parsedIdentity,
      pins: parsedPins,
    }));
    const flightKey = input.mode === 'fresh' ? mac(keys.keyInfo.key, `${baseKey}:fresh:${randomUUID()}`) : baseKey;
    const payloadKey = await resolveKey(info, 'payload', undefined, operationGuard);
    const outcome = await withDatabase((database, time) => {
      if (time.clockRollback) return Object.freeze({ status: 'unavailable', reason: 'clock_rollback' });
      if (input.mode === 'reuse') {
        const existing = database.prepare('SELECT * FROM reuse_flights WHERE flight_key = ? AND scope_kind = ? AND partition_hash = ?')
          .get(flightKey, 'tenant_private', keys.partitionHash);
        if (existing) {
          if (existing.state === 'active' && existing.lease_expires_at_ms <= time.now) {
            database.prepare("UPDATE reuse_flights SET state = 'unknown' WHERE flight_key = ? AND scope_kind = ? AND partition_hash = ? AND state = 'active'")
              .run(flightKey, 'tenant_private', keys.partitionHash);
            return Object.freeze({ status: 'needs_reconciliation', admissionRef: existing.admission_id, usage: 'unknown' });
          }
          return Object.freeze({ status: existing.state === 'active' ? 'in_flight' : existing.state === 'unknown' ? 'needs_reconciliation' : 'already_completed', admissionRef: existing.admission_id, usage: existing.state === 'unknown' ? 'unknown' : 'unresolved' });
        }
      }
      if (database.prepare('SELECT COUNT(*) AS count FROM reuse_flights').get().count >= limits.maxFlights) fail('REUSE_CAPACITY');
      const admissionId = randomUUID();
      const payload = { identity: parsedIdentity, pins: parsedPins, mode: input.mode, usage: 'unknown', attemptLineage: validateLineage({ status: 'unknown' }) };
      const sealed = sealBounded(payloadKey.key, payloadKey.keyId, keys.partitionHash, 'flight', admissionId, payload);
      ensureStorageCapacity(database, sealed.byteLength);
      database.prepare('INSERT INTO reuse_flights (flight_key, scope_kind, partition_hash, admission_id, state, created_at_ms, lease_expires_at_ms, payload_key_id, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(flightKey, 'tenant_private', keys.partitionHash, admissionId, 'active', time.now, time.now + leaseMs, payloadKey.keyId, sealed);
      return Object.freeze({ status: input.mode === 'fresh' ? 'refresh_unresolved' : 'admitted', admissionRef: admissionId, usage: 'unknown', providerTransport: 'not_implemented' });
    });
    await authorize(info, request, 'operation.admit');
    return outcome;
  }

  async function reconcileAdmission(scope, request, inputValue) {
    const info = scopeInfo(scope);
    const input = record(inputValue, new Set(['admissionRef', 'outcome']));
    if (!input || !string(input.admissionRef, 64) || !['completed', 'unknown', 'not_dispatched'].includes(input.outcome)) fail('REUSE_INVALID');
    await authorize(info, request, 'operation.reconcile');
    const reconcileGuard = authorizationGuard(info, request, 'operation.reconcile');
    const keys = await indexInfo(info, 'tenant_private', reconcileGuard);
    const row = await withDatabase((database) => database.prepare('SELECT * FROM reuse_flights WHERE admission_id = ? AND scope_kind = ? AND partition_hash = ?').get(input.admissionRef, 'tenant_private', keys.partitionHash));
    if (!row) fail('REUSE_NOT_FOUND');
    if (row.state !== 'unknown' && row.state !== 'active') return Object.freeze({ status: row.state, usage: 'unknown' });
    if (typeof config.verifyAdmissionOutcome !== 'function') fail('REUSE_POLICY_UNAVAILABLE');
    const payloadKey = await resolveKey(info, 'payload', row.payload_key_id, reconcileGuard);
    await authorize(info, request, 'operation.reconcile', { admissionRef: input.admissionRef });
    let raw;
    try {
      raw = await config.verifyAdmissionOutcome(Object.freeze({
        tenantId: info.tenantId,
        actorId: info.actorId,
        request,
        admissionRef: input.admissionRef,
        existingState: row.state,
        requestedOutcome: input.outcome,
      }));
    } catch { fail('REUSE_POLICY_UNAVAILABLE'); }
    await authorize(info, request, 'operation.reconcile', { admissionRef: input.admissionRef });
    const attestation = record(raw, new Set(['outcome', 'attemptLineage']));
    if (!attestation || attestation.outcome !== input.outcome) fail('REUSE_POLICY_UNAVAILABLE');
    const lineage = validateLineage(attestation.attemptLineage ?? { status: 'unknown' });
    return withDatabase((database) => {
      const current = database.prepare('SELECT * FROM reuse_flights WHERE admission_id = ? AND scope_kind = ? AND partition_hash = ?')
        .get(input.admissionRef, 'tenant_private', keys.partitionHash);
      if (!current) fail('REUSE_NOT_FOUND');
      if (current.state !== 'unknown' && current.state !== 'active') return Object.freeze({ status: current.state, usage: 'unknown', duplicateCompletion: true });
      const existingPayload = unseal(payloadKey.key, current.partition_hash, 'flight', current.admission_id, current.payload, current.payload_key_id);
      const mergedLineage = input.outcome === 'unknown' && lineage.status !== 'complete' && existingPayload.attemptLineage?.billableAttemptId
        ? existingPayload.attemptLineage
        : lineage;
      const updatedPayload = { ...existingPayload, attemptLineage: mergedLineage, usage: 'unknown' };
      const sealed = sealBounded(payloadKey.key, payloadKey.keyId, current.partition_hash, 'flight', current.admission_id, updatedPayload);
      ensureStorageCapacity(database, sealed.byteLength, current.payload.byteLength);
      const state = input.outcome === 'completed' ? 'completed' : input.outcome === 'not_dispatched' ? 'not_dispatched' : 'unknown';
      database.prepare('UPDATE reuse_flights SET state = ?, payload_key_id = ?, payload = ? WHERE admission_id = ? AND scope_kind = ? AND partition_hash = ?')
        .run(state, payloadKey.keyId, sealed, input.admissionRef, 'tenant_private', keys.partitionHash);
      return Object.freeze({ status: state, usage: 'unknown', lineage: mergedLineage.status, holdDisposition: 'finance_reconciliation_required' });
    });
  }

  async function dispatchPendingInvalidations(scope, request, maximum = 20, scopeKind = 'tenant_private', signal = undefined) {
    const info = scopeInfo(scope);
    if (!['tenant_private', 'public_profile'].includes(scopeKind)) fail('REUSE_INVALID');
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 100) fail('REUSE_INVALID');
    if (signalAborted(signal)) fail('REUSE_DENIED');
    await authorize(info, request, scopeKind === 'public_profile' ? 'outbox.dispatch_public' : 'outbox.dispatch');
    if (typeof config.deliverInvalidation !== 'function' || typeof config.verifyInvalidationAcknowledgement !== 'function') {
      return Object.freeze({ attempted: 0, delivered: 0, pending: true, reason: 'consumer_port_unavailable' });
    }
    const dispatchGuard = authorizationGuard(info, request, scopeKind === 'public_profile' ? 'outbox.dispatch_public' : 'outbox.dispatch', signal);
    const baseKeys = await indexInfo(info, scopeKind, dispatchGuard);
    const keys = { ...baseKeys, payloadKey: await resolveKey(scopeKind === 'public_profile' ? null : info, 'payload', undefined, dispatchGuard) };
    let attempted = 0;
    let delivered = 0;
    const skippedEvents = new Set();
    let scanned = 0;
    while (attempted < maximum && scanned < 1_000) {
      const row = await withDatabase((database, time) => {
        const exclusions = [...skippedEvents];
        const excludedSql = exclusions.length ? `AND event_id NOT IN (${exclusions.map(() => '?').join(',')})` : '';
        const candidate = database.prepare(`SELECT * FROM reuse_outbox WHERE scope_kind = ? AND partition_hash = ?
          AND status IN ('pending', 'delivering') AND has_consumer = 1 AND attempt_count < ? AND next_attempt_at_ms <= ?
          ${excludedSql} ORDER BY next_attempt_at_ms, event_id LIMIT 1`)
          .get(scopeKind, keys.partitionHash, limits.maxOutboxAttempts, time.now, ...exclusions);
        if (!candidate) return null;
        const priorKey = candidate.payload_key_id === keys.payloadKey.keyId ? keys.payloadKey : null;
        return { candidate, now: time.now, payloadKeyId: candidate.payload_key_id, payloadKey: priorKey };
      });
      if (!row) break;
      scanned += 1;
      await dispatchGuard();
      const payloadKey = row.payloadKey ?? await resolveKey(scopeKind === 'public_profile' ? null : info, 'payload', row.payloadKeyId, dispatchGuard);
      const event = unseal(payloadKey.key, row.candidate.partition_hash, 'outbox', row.candidate.event_id, row.candidate.payload, row.candidate.payload_key_id);
      if (!event.consumerRef) {
        skippedEvents.add(row.candidate.event_id);
        continue;
      }
      await dispatchGuard();
      const deliveryAttemptId = randomUUID();
      const attempt = await withDatabase((database, time) => {
        if (signalAborted(signal)) fail('REUSE_DENIED');
        const current = database.prepare('SELECT status, attempt_count, next_attempt_at_ms, has_consumer FROM reuse_outbox WHERE event_id = ?').get(row.candidate.event_id);
        if (!current || !['pending', 'delivering'].includes(current.status) || current.has_consumer !== 1
          || current.attempt_count >= limits.maxOutboxAttempts
          || current.attempt_count !== row.candidate.attempt_count || current.next_attempt_at_ms > time.now) return null;
        const nextAttempt = current.attempt_count + 1;
        const stored = { ...event, deliveryAttemptId, deliveryAttemptNumber: nextAttempt };
        const sealed = sealBounded(payloadKey.key, payloadKey.keyId, row.candidate.partition_hash, 'outbox', row.candidate.event_id, stored, MAX_INVALIDATION_RECORD_BYTES);
        ensureStorageCapacity(database, sealed.byteLength, row.candidate.payload_bytes, 0, 0,
          Math.max(0, sealed.byteLength - row.candidate.payload_bytes));
        const claimed = database.prepare("UPDATE reuse_outbox SET status = 'delivering', attempt_count = ?, next_attempt_at_ms = ?, active_attempt_id = ?, payload = ?, payload_key_id = ?, payload_bytes = ? WHERE event_id = ? AND status = ? AND has_consumer = 1 AND attempt_count = ? AND attempt_count < ? AND next_attempt_at_ms <= ?")
          .run(nextAttempt, time.now + Math.min(60_000, 250 * (2 ** (nextAttempt - 1))), deliveryAttemptId, sealed, payloadKey.keyId, sealed.byteLength,
            row.candidate.event_id, current.status, current.attempt_count, limits.maxOutboxAttempts, time.now);
        if (claimed.changes !== 1) return null;
        return nextAttempt;
      });
      if (attempt === null) {
        skippedEvents.add(row.candidate.event_id);
        continue;
      }
      const expected = Object.freeze({
        eventId: row.candidate.event_id,
        consumerRef: event.consumerRef,
        entryRef: event.entryRef,
        contentHash: event.contentHash,
        version: event.version,
        deliveryAttemptId,
        attemptNumber: attempt,
        reason: event.reason,
      });
      try {
        await dispatchGuard();
      } catch (error) {
        await withDatabase((database) => {
          database.prepare(`UPDATE reuse_outbox SET status = ?, attempt_count = ?, next_attempt_at_ms = ?,
            has_consumer = ?, active_attempt_id = ?, payload_key_id = ?, payload = ?, payload_bytes = ?
            WHERE event_id = ? AND status = 'delivering' AND attempt_count = ? AND active_attempt_id = ?`)
            .run(row.candidate.status, row.candidate.attempt_count, row.candidate.next_attempt_at_ms,
              row.candidate.has_consumer, row.candidate.active_attempt_id, row.candidate.payload_key_id,
              row.candidate.payload, row.candidate.payload_bytes, row.candidate.event_id, attempt, deliveryAttemptId);
        });
        throw error;
      }
      attempted += 1;
      let ack;
      try { ack = await config.deliverInvalidation(expected); } catch { ack = null; }
      await dispatchGuard();
      let valid = false;
      try { valid = (await config.verifyInvalidationAcknowledgement(Object.freeze({ expected, acknowledgement: ack, tenantId: info.tenantId, actorId: info.actorId }))) === true; } catch { valid = false; }
      await dispatchGuard();
      await withDatabase((database) => {
        if (valid) {
          const updated = database.prepare("UPDATE reuse_outbox SET status = 'delivered', active_attempt_id = NULL WHERE event_id = ? AND status = 'delivering' AND attempt_count = ? AND active_attempt_id = ?")
            .run(row.candidate.event_id, attempt, deliveryAttemptId);
          if (updated.changes === 1) delivered += 1;
        } else if (attempt >= limits.maxOutboxAttempts) {
          database.prepare("UPDATE reuse_outbox SET status = 'failed', active_attempt_id = NULL WHERE event_id = ? AND status = 'delivering' AND attempt_count = ? AND active_attempt_id = ?").run(row.candidate.event_id, attempt, deliveryAttemptId);
        } else {
          database.prepare("UPDATE reuse_outbox SET status = 'pending', active_attempt_id = NULL WHERE event_id = ? AND status = 'delivering' AND attempt_count = ? AND active_attempt_id = ?").run(row.candidate.event_id, attempt, deliveryAttemptId);
        }
      });
    }
    const remaining = await withDatabase((database) => database.prepare('SELECT COUNT(*) AS count FROM reuse_outbox WHERE scope_kind = ? AND partition_hash = ? AND status != \'delivered\'').get(scopeKind, keys.partitionHash).count);
    return Object.freeze({ attempted, delivered, pending: remaining > 0, unresolvedCount: remaining, deliveryKind: 'injected_host_callback' });
  }

  async function outboxSnapshot(scope, request, scopeKind = 'tenant_private') {
    const info = scopeInfo(scope);
    if (!['tenant_private', 'public_profile'].includes(scopeKind)) fail('REUSE_INVALID');
    await authorize(info, request, scopeKind === 'public_profile' ? 'outbox.read_public' : 'outbox.read');
    const keys = await indexInfo(info, scopeKind, authorizationGuard(info, request, scopeKind === 'public_profile' ? 'outbox.read_public' : 'outbox.read'));
    return withDatabase((database) => {
      const rows = database.prepare('SELECT status, COUNT(*) AS count FROM reuse_outbox WHERE scope_kind = ? AND partition_hash = ? GROUP BY status').all(scopeKind, keys.partitionHash);
      const result = { pending: 0, delivering: 0, failed: 0, delivered: 0, unresolved: 0, readiness: 'blocked_pending_external_ack' };
      for (const row of rows) result[row.status] = row.count;
      result.unresolved = result.pending + result.delivering + result.failed;
      if (result.unresolved === 0) result.readiness = 'external_consumer_unverified';
      return Object.freeze(result);
    });
  }

  async function integritySnapshot(scope, request) {
    const info = scopeInfo(scope);
    await authorize(info, request, 'cache.snapshot');
    const snapshotGuard = authorizationGuard(info, request, 'cache.snapshot');
    const baseKeys = await indexInfo(info, 'tenant_private', snapshotGuard);
    const keys = { ...baseKeys, payloadKey: await resolveKey(info, 'payload', undefined, snapshotGuard) };
    return withDatabase((database, time) => {
      const entries = database.prepare("SELECT COUNT(*) AS count, SUM(CASE WHEN eligible = 1 THEN 1 ELSE 0 END) AS eligible, SUM(payload_bytes) AS bytes FROM reuse_entries WHERE scope_kind = 'tenant_private' AND partition_hash = ?").get(keys.partitionHash);
      const outbox = database.prepare("SELECT status, COUNT(*) AS count FROM reuse_outbox WHERE scope_kind = 'tenant_private' AND partition_hash = ? GROUP BY status").all(keys.partitionHash);
      const flights = database.prepare("SELECT state, COUNT(*) AS count FROM reuse_flights WHERE scope_kind = 'tenant_private' AND partition_hash = ? GROUP BY state").all(keys.partitionHash);
      return Object.freeze({
        entryCount: entries.count,
        eligibleEntryCount: entries.eligible ?? 0,
        encryptedPayloadBytes: entries.bytes ?? 0,
        outbox: Object.freeze(Object.fromEntries(outbox.map((item) => [item.status, item.count]))),
        flights: Object.freeze(Object.fromEntries(flights.map((item) => [item.state, item.count]))),
        clock: time.clockRollback ? 'rollback_detected' : 'trusted',
      });
    });
  }

  async function purgeExpired(scope, request, scopeKind = 'tenant_private') {
    const info = scopeInfo(scope);
    if (!['tenant_private', 'public_profile'].includes(scopeKind)) fail('REUSE_INVALID');
    const action = scopeKind === 'public_profile' ? 'cache.retention.purge_public' : 'cache.retention.purge';
    await authorize(info, request, action);
    const purgeGuard = authorizationGuard(info, request, action);
    const baseKeys = await indexInfo(info, scopeKind, purgeGuard);
    const keys = { ...baseKeys, payloadKey: await resolveKey(scopeKind === 'public_profile' ? null : info, 'payload', undefined, purgeGuard) };
    const rows = await withDatabase((database, time) => database.prepare('SELECT * FROM reuse_entries WHERE scope_kind = ? AND partition_hash = ? AND expires_at_ms <= ? AND payload_purged = 0 ORDER BY expires_at_ms, entry_id LIMIT 500')
      .all(scopeKind, keys.partitionHash, time.now));
    let purged = 0;
    for (const row of rows) {
      const payloadKey = row.eligible === 1
        ? (row.payload_key_id === keys.payloadKey.keyId ? keys.payloadKey : await resolveKey(scopeKind === 'public_profile' ? null : info, 'payload', row.payload_key_id, purgeGuard))
        : null;
      await authorize(info, request, action);
      const payload = row.eligible === 1
        ? unseal(payloadKey.key, row.partition_hash, 'entry', row.entry_id, row.payload, row.payload_key_id)
        : null;
      await withDatabase((database, time) => {
        const current = database.prepare('SELECT * FROM reuse_entries WHERE entry_id = ? AND scope_kind = ? AND partition_hash = ?')
          .get(row.entry_id, scopeKind, keys.partitionHash);
        if (expireEntry(database, scopeKind === 'public_profile' ? null : info, current, payload, time.now, { ...keys, payloadKey: payloadKey ?? keys.payloadKey })) purged += 1;
      });
    }
    return Object.freeze({ purged, retainedOutboxPending: (await outboxSnapshot(scope, request, scopeKind)).unresolved });
  }

  return Object.freeze({
    scopeForAuthenticatedRequest: publicBoundary(authenticatedScope),
    putPrivateProfile: publicBoundary(putPrivateProfile),
    publishReviewedPublicProfile: publicBoundary(publishReviewedPublicProfile),
    getPrivateProfile: publicBoundary(getPrivateProfile),
    getPublicProfile: publicBoundary(getPublicProfile),
    observe: publicBoundary(observe),
    invalidate: publicBoundary(invalidate),
    admitOperation: publicBoundary(admitOperation),
    reconcileAdmission: publicBoundary(reconcileAdmission),
    withPrivateLineage: publicBoundary(withPrivateLineage),
    dispatchPendingInvalidations: publicBoundary(dispatchPendingInvalidations),
    outboxSnapshot: publicBoundary(outboxSnapshot),
    integritySnapshot: publicBoundary(integritySnapshot),
    purgeExpired: publicBoundary(purgeExpired),
  });
}
