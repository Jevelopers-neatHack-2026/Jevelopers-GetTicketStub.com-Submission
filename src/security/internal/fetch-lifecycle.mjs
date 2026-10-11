import { AsyncLocalStorage } from 'node:async_hooks';

const contexts = new AsyncLocalStorage();
const provenDocuments = new WeakMap();
const LIFECYCLE_HOOKS = new Set([
  'beforeHop', 'onDispatchIntent', 'onResponseHeaders', 'onKnownZero', 'onDecodeStart', 'onBodyComplete',
]);
const LIFECYCLE_OPTIONS = new Set([
  'decodedTextBytesPerResponse', 'decodedMediaBytesPerResponse',
  'gzipChunkSize', 'gzipReadableHighWaterMark', 'gzipWritableHighWaterMark',
  'totalMilliseconds',
]);

function exactDataRecord(value, allowed) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
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

export function runWithSafeFetchLifecycle(fetcher, hooks, options, operation) {
  const hookInput = exactDataRecord(hooks, LIFECYCLE_HOOKS);
  const optionInput = exactDataRecord(options, LIFECYCLE_OPTIONS);
  if (!fetcher || typeof fetcher !== 'object' || !hookInput || !optionInput || typeof operation !== 'function') {
    throw new TypeError('private retrieval lifecycle unavailable');
  }
  for (const [name, callback] of Object.entries(hookInput)) {
    if (typeof callback !== 'function') throw new TypeError('private retrieval lifecycle unavailable');
  }
  for (const [name, value] of Object.entries(optionInput)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('private retrieval lifecycle unavailable');
    if (name === 'totalMilliseconds' && value > 30_000) throw new TypeError('private retrieval lifecycle unavailable');
    if (name === 'gzipChunkSize' && value > 4_096) throw new TypeError('private retrieval lifecycle unavailable');
    if (name === 'gzipReadableHighWaterMark' && value > 4_096) throw new TypeError('private retrieval lifecycle unavailable');
    if (name === 'gzipWritableHighWaterMark' && value > 4_096) throw new TypeError('private retrieval lifecycle unavailable');
  }
  return contexts.run(Object.freeze({ fetcher, hooks: hookInput, options: optionInput }), operation);
}

export function safeFetchLifecycleFor(fetcher) {
  const context = contexts.getStore();
  return context?.fetcher === fetcher ? context : null;
}

export function recordSafeFetchProvenance(document, provenance) {
  if (!document || typeof document !== 'object' || !provenance || typeof provenance !== 'object') return;
  const copied = Object.freeze({
    requestedUrl: provenance.requestedUrl,
    finalUrl: provenance.finalUrl,
    redirectChain: Object.freeze([...provenance.redirectChain]),
    hops: Object.freeze(provenance.hops.map((hop) => Object.freeze({
      url: hop.url,
      statusCode: hop.statusCode,
      dispatchIntent: hop.dispatchIntent,
      responseReceived: hop.responseReceived,
      bodyComplete: hop.bodyComplete,
      decodedBytes: hop.decodedBytes,
    }))),
  });
  provenDocuments.set(document, copied);
}

export function safeFetchProvenance(document) {
  if (!document || typeof document !== 'object') return null;
  return provenDocuments.get(document) ?? null;
}
