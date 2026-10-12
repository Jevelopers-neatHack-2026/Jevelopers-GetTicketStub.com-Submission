import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const AUTHORITIES = new WeakMap();
const CONTROLLERS = new WeakMap();
const RELEASE_CHECKS = new WeakMap();

export class PrivateAssetReleaseError extends Error {
  constructor(code = 'ASSET_RELEASE_AUTHORITY_DENIED') {
    super('Controlled asset release authority is unavailable.');
    this.name = 'PrivateAssetReleaseError';
    this.code = code;
  }
}

function fail() {
  throw new PrivateAssetReleaseError();
}

function dataRecord(value, allowed) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) return null;
    const result = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return null;
  }
}

function validCandidateIds(value) {
  try {
    if (!Array.isArray(value) || value.length > 8 || Reflect.ownKeys(value).length !== value.length + 1) return null;
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      const id = descriptor?.value;
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true
        || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(id)) return null;
      result.push(id);
    }
    if (new Set(result).size !== result.length) return null;
    return result.sort();
  } catch {
    return null;
  }
}

function thenable(value) {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false;
  try { return typeof value.then === 'function'; } catch { return true; }
}

export function createPrivateAssetReleaseAuthority({
  tenantId,
  runId,
  policyDigest,
  expiresAtMonotonic,
}) {
  if (typeof tenantId !== 'string' || tenantId.length < 1 || tenantId.length > 256
    || typeof runId !== 'string' || runId.length < 1 || runId.length > 96
    || typeof policyDigest !== 'string' || !/^[a-f0-9]{64}$/.test(policyDigest)
    || !Number.isFinite(expiresAtMonotonic) || expiresAtMonotonic <= performance.now()) fail();

  const authority = Object.freeze(Object.create(null));
  const state = {
    id: randomUUID(),
    tenantId,
    runId,
    policyDigest,
    expiresAtMonotonic,
    candidateIds: null,
    revoked: false,
    revocationReason: null,
    finalizing: false,
    consumed: false,
    released: false,
  };
  AUTHORITIES.set(authority, state);

  const controller = Object.create(null);
  CONTROLLERS.set(controller, authority);
  Object.defineProperties(controller, {
    revoke: {
      enumerable: true,
      value(reason = 'host_authority_revoked') {
        return revokePrivateAssetReleaseAuthority(authority, reason);
      },
    },
  });
  return Object.freeze(controller);
}

export function isPrivateAssetReleaseAuthority(value) {
  return AUTHORITIES.has(value);
}

export function isPrivateAssetReleaseController(value) {
  return CONTROLLERS.has(value);
}

export function privateAssetReleaseAuthorityForController(controller) {
  return CONTROLLERS.get(controller) ?? null;
}

export function privateAssetReleaseControllerMatches(controller, binding) {
  const authority = CONTROLLERS.get(controller);
  const state = AUTHORITIES.get(authority);
  const record = dataRecord(binding, new Set(['tenantId', 'runId', 'policyDigest', 'deadlineAtMonotonic']));
  if (!state || !record || (record.tenantId !== undefined && typeof record.tenantId !== 'string')
    || typeof record.runId !== 'string' || typeof record.policyDigest !== 'string'
    || !Number.isFinite(record.deadlineAtMonotonic)) return false;
  return !state.revoked && !state.consumed
    && (record.tenantId === undefined || state.tenantId === record.tenantId)
    && state.runId === record.runId
    && state.policyDigest === record.policyDigest
    && performance.now() < Math.min(state.expiresAtMonotonic, record.deadlineAtMonotonic);
}

export function revokePrivateAssetReleaseController(controller, reason) {
  const authority = CONTROLLERS.get(controller);
  return authority ? revokePrivateAssetReleaseAuthority(authority, reason) : null;
}

export function bindPrivateAssetReleaseCandidates(authority, binding) {
  const state = AUTHORITIES.get(authority);
  const record = dataRecord(binding, new Set(['tenantId', 'runId', 'policyDigest', 'candidateIds']));
  const candidateIds = record && validCandidateIds(record.candidateIds);
  if (!state || !record || !candidateIds || record.tenantId !== state.tenantId
    || record.runId !== state.runId || record.policyDigest !== state.policyDigest
    || state.revoked || state.consumed || state.finalizing) fail();
  if (state.candidateIds !== null && JSON.stringify(state.candidateIds) !== JSON.stringify(candidateIds)) fail();
  state.candidateIds = candidateIds;
}

export function createPrivateAssetReleaseCheck(state) {
  const check = Object.freeze(Object.create(null));
  RELEASE_CHECKS.set(check, state);
  return check;
}

export function privateAssetReleaseCheckState(check) {
  return RELEASE_CHECKS.get(check) ?? null;
}

export function takePrivateAssetReleaseCheck(check) {
  const state = RELEASE_CHECKS.get(check) ?? null;
  if (state) RELEASE_CHECKS.delete(check);
  return state;
}

export function revokePrivateAssetReleaseAuthority(authority, reason = 'host_authority_revoked') {
  const state = AUTHORITIES.get(authority);
  if (!state) return null;
  state.revoked = true;
  state.revocationReason = typeof reason === 'string' && /^[a-z0-9_:-]{1,80}$/i.test(reason)
    ? reason : 'host_authority_revoked';
  return state.released ? 'after_release' : 'before_release';
}

export function finalizePrivateAssetRelease(authority, binding, callback) {
  const state = AUTHORITIES.get(authority);
  const record = dataRecord(binding, new Set([
    'tenantId', 'runId', 'policyDigest', 'deadlineAtMonotonic', 'candidateIds',
  ]));
  const candidateIds = record && validCandidateIds(record.candidateIds);
  if (!state || !record || typeof callback !== 'function' || !candidateIds
    || record.tenantId !== state.tenantId || record.runId !== state.runId
    || record.policyDigest !== state.policyDigest
    || !Number.isFinite(record.deadlineAtMonotonic)
    || JSON.stringify(candidateIds) !== JSON.stringify(state.candidateIds)
    || state.revoked || state.consumed || state.finalizing
    || performance.now() >= Math.min(state.expiresAtMonotonic, record.deadlineAtMonotonic)) fail();

  // This is the single synchronous release point. JavaScript callbacks and
  // queued work cannot interleave with this bounded stack frame. Reentrant
  // revocation marks the in-flight authority and makes the projection fail;
  // later revocation is classified as after_release.
  state.consumed = true;
  state.finalizing = true;
  try {
    const result = callback();
    if (thenable(result) || state.revoked
      || performance.now() >= Math.min(state.expiresAtMonotonic, record.deadlineAtMonotonic)) fail();
    state.released = true;
    return result;
  } finally {
    state.finalizing = false;
  }
}

export function privateAssetReleaseAuthorityValidDuringFinalization(authority, binding) {
  const state = AUTHORITIES.get(authority);
  const record = dataRecord(binding, new Set([
    'tenantId', 'runId', 'policyDigest', 'deadlineAtMonotonic', 'candidateIds',
  ]));
  const candidateIds = record && validCandidateIds(record.candidateIds);
  return Boolean(state && record && candidateIds && state.consumed && state.finalizing
    && !state.revoked && state.tenantId === record.tenantId && state.runId === record.runId
    && state.policyDigest === record.policyDigest
    && JSON.stringify(candidateIds) === JSON.stringify(state.candidateIds)
    && performance.now() < Math.min(state.expiresAtMonotonic, record.deadlineAtMonotonic));
}
