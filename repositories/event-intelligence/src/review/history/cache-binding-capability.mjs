const CAPABILITIES = new WeakSet();

/** Internal capability shared only by the private correction/cache composition modules. */
export function issueCorrectionCacheBindingCapability() {
  const capability = Object.freeze(Object.create(null));
  CAPABILITIES.add(capability);
  return capability;
}

export function isCorrectionCacheBindingCapability(value) {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    && CAPABILITIES.has(value);
}
