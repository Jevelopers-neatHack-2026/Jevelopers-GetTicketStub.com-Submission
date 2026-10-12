import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { types as utilTypes } from 'node:util';

const AUTHORITIES = new WeakMap();
const CONTROLLERS = new WeakMap();
const RELEASE_CHECKS = new WeakMap();
const GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const GET_PROTOTYPE_OF = Object.getPrototypeOf;
const HAS_OWN = Object.hasOwn;
const FUNCTION_TO_STRING = Function.prototype.toString;
const APPLY = Reflect.apply;
const NATIVE_PROMISE_SPECIES = Symbol.species;
const IS_PROXY = utilTypes.isProxy;
const IS_PROMISE = utilTypes.isPromise;
const NATIVE_PROMISE_THEN = Promise.prototype.then;
const NATIVE_PROMISE_SOURCE = APPLY(FUNCTION_TO_STRING, Promise, []);
const NATIVE_PROMISE_SPECIES_GETTER = GET_OWN_PROPERTY_DESCRIPTOR(Promise, NATIVE_PROMISE_SPECIES).get;
const NATIVE_PROMISE_SPECIES_SOURCE = APPLY(FUNCTION_TO_STRING, NATIVE_PROMISE_SPECIES_GETTER, []);

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

function supportedNativePromise(value) {
  try {
    if (IS_PROXY(value) || !IS_PROMISE(value)
      || GET_OWN_PROPERTY_DESCRIPTOR(value, 'constructor') !== undefined) return false;
    const prototype = GET_PROTOTYPE_OF(value);
    if (!prototype || IS_PROXY(prototype)) return false;
    const constructorDescriptor = GET_OWN_PROPERTY_DESCRIPTOR(prototype, 'constructor');
    if (!constructorDescriptor || !HAS_OWN(constructorDescriptor, 'value')) return false;
    const constructor = constructorDescriptor.value;
    if (typeof constructor !== 'function' || IS_PROXY(constructor)) return false;
    const constructorPrototype = GET_OWN_PROPERTY_DESCRIPTOR(constructor, 'prototype');
    if (!constructorPrototype || !HAS_OWN(constructorPrototype, 'value')
      || constructorPrototype.value !== prototype
      || APPLY(FUNCTION_TO_STRING, constructor, []) !== NATIVE_PROMISE_SOURCE) return false;
    const species = GET_OWN_PROPERTY_DESCRIPTOR(constructor, NATIVE_PROMISE_SPECIES);
    return species !== undefined
      && typeof species.get === 'function'
      && !IS_PROXY(species.get)
      && species.set === undefined
      && species.enumerable === false
      && APPLY(FUNCTION_TO_STRING, species.get, []) === NATIVE_PROMISE_SPECIES_SOURCE;
  } catch {
    return false;
  }
}

/** Attach handlers only to ordinary native promises whose species path is verified. */
export function subscribeToSupportedNativePromise(value, onFulfilled, onRejected) {
  if (!supportedNativePromise(value) || typeof onRejected !== 'function'
    || (onFulfilled !== undefined && typeof onFulfilled !== 'function')) return false;
  try {
    APPLY(NATIVE_PROMISE_THEN, value, [onFulfilled, onRejected]);
    return true;
  } catch {
    // A malformed promise remains denied; never inspect its own then accessor.
    return false;
  }
}

export function observeNativeRejectedPromise(value) {
  let nativePromise = false;
  try { nativePromise = IS_PROMISE(value); } catch { return false; }
  if (!nativePromise) return false;
  subscribeToSupportedNativePromise(value, undefined, () => {});
  return true;
}

export function hasThenableBehavior(value) {
  if ((typeof value !== 'object' || value === null) && typeof value !== 'function') return false;
  if (observeNativeRejectedPromise(value)) return true;
  try {
    let current = value;
    for (let depth = 0; current !== null && depth < 64; depth += 1) {
      if (IS_PROXY(current)) return true;
      const descriptor = GET_OWN_PROPERTY_DESCRIPTOR(current, 'then');
      if (descriptor) {
        if (!HAS_OWN(descriptor, 'value')) return true;
        return typeof descriptor.value === 'function';
      }
      current = GET_PROTOTYPE_OF(current);
    }
    return current !== null;
  } catch {
    // Do not execute hostile accessors or proxy traps to decide whether to deny.
    return true;
  }
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
    if (hasThenableBehavior(result) || state.revoked
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
