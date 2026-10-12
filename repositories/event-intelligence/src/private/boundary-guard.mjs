import { types as utilTypes } from 'node:util';

const isProxy = utilTypes.isProxy;
const isPromise = utilTypes.isPromise;
const promiseThen = Promise.prototype.then;
const apply = Reflect.apply;
const monotonicNowNs = process.hrtime.bigint.bind(process.hrtime);
const MAX_TIME = 8_640_000_000_000_000;
const PERMIT_KEYS = Object.freeze([
  'authorized', 'tenantId', 'actorId', 'eventId', 'action', 'field', 'nowMs',
]);
const permitStartedAt = new WeakMap();

function consumeRejectedPromise(value) {
  try {
    if (isPromise(value)) apply(promiseThen, value, [undefined, () => {}]);
  } catch { /* The callback is denied even if Promise rejection handling is malformed. */ }
}

function permitValues(value, input) {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null || isProxy(value)) return null;
  try {
    if (isPromise(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== PERMIT_KEYS.length || keys.some((key) => typeof key !== 'string' || !PERMIT_KEYS.includes(key))) return null;
    const values = Object.create(null);
    for (const key of PERMIT_KEYS) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      values[key] = descriptor.value;
    }
    if (values.authorized !== true
      || values.tenantId !== input.tenantId
      || values.actorId !== input.actorId
      || values.eventId !== input.eventId
      || values.action !== input.action
      || values.field !== input.field
      || !Number.isSafeInteger(values.nowMs) || values.nowMs < 0 || values.nowMs > MAX_TIME) return null;
    return values;
  } catch {
    return null;
  }
}

/**
 * Calls the trusted host boundary guard synchronously and returns a private, one-call
 * permit token. `deny` must throw the store's fixed public denial error.
 * @param {Function} guard
 * @param {object} input
 * @param {Function} deny
 */
export function beginLocalBoundary(guard, input, deny) {
  const startedAtNs = monotonicNowNs();
  if (typeof guard !== 'function' || isProxy(guard)) return deny();
  let result;
  try { result = guard(input); } catch { return deny(); }
  const values = permitValues(result, input);
  if (!values) {
    consumeRejectedPromise(result);
    return deny();
  }
  const token = Object.freeze({ nowMs: values.nowMs });
  permitStartedAt.set(token, startedAtNs);
  return token;
}

/** Returns a conservative integer-millisecond monotonic duration, or null on failure. */
export function monotonicElapsedMs(startedAtNs) {
  if (typeof startedAtNs !== 'bigint') return null;
  try {
    const elapsedNs = monotonicNowNs() - startedAtNs;
    if (elapsedNs < 0n) return null;
    const elapsedMs = Number((elapsedNs + 999_999n) / 1_000_000n);
    return Number.isSafeInteger(elapsedMs) ? elapsedMs : null;
  } catch {
    return null;
  }
}

/** Returns the authoritative sample plus conservative elapsed time, only for expiry checks. */
export function localBoundaryEffectiveNow(token) {
  if (!token || typeof token !== 'object') return null;
  const startedAtNs = permitStartedAt.get(token);
  const elapsedMs = monotonicElapsedMs(startedAtNs);
  if (elapsedMs === null) return null;
  const effectiveNowMs = token.nowMs + elapsedMs;
  return Number.isSafeInteger(effectiveNowMs) && effectiveNowMs <= MAX_TIME ? effectiveNowMs : null;
}

/** Captured monotonic timestamp for bounded async retry deadlines. */
export function monotonicTimestampNs() {
  return monotonicNowNs();
}
