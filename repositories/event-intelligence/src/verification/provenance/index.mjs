const ports = new WeakSet();
const privatePort = new WeakMap();

function unavailable() {
  return new Error('provenance port unavailable');
}

/**
 * Narrow internal consumer port for extracted fact provenance. It deliberately
 * delegates storage, tenant checks, support validation, and retention to the
 * durable evidence store; it does not define a public package or wire schema.
 */
export function createProvenancePort(evidenceStore) {
  if (!evidenceStore || typeof evidenceStore !== 'object'
    || typeof evidenceStore.appendFact !== 'function'
    || typeof evidenceStore.lookupFact !== 'function'
    || typeof evidenceStore.readFact !== 'function'
    || typeof evidenceStore.listFacts !== 'function') {
    throw new TypeError('durable evidence store required');
  }
  const port = Object.freeze({
    record(scope, fact, request) {
      const store = privatePort.get(port);
      if (!store) throw unavailable();
      return store.appendFact(scope, fact, request);
    },
    lookup(scope, factId) {
      const store = privatePort.get(port);
      if (!store) throw unavailable();
      return store.lookupFact(scope, factId);
    },
    read(scope, factHandle, request) {
      const store = privatePort.get(port);
      if (!store) throw unavailable();
      return store.readFact(scope, factHandle, request);
    },
    list(scope, request) {
      const store = privatePort.get(port);
      if (!store) throw unavailable();
      return store.listFacts(scope, request);
    },
  });
  privatePort.set(port, evidenceStore);
  ports.add(port);
  return port;
}

export function isProvenancePort(value) {
  return Boolean(value && typeof value === 'object' && ports.has(value));
}
