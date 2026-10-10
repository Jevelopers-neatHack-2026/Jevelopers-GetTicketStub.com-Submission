import { isPrivacyBoundary } from './boundary.mjs';

function opaque() {
  return Object.freeze(Object.create(null));
}

function deny() {
  return new Error('private evidence unavailable');
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

function safeDiagnostic(boundary, scope, result) {
  return boundary.diagnostics(scope, result);
}

function renderDerivative(boundary, scope, derivative) {
  const data = boundary.exportDerivative(scope, derivative);
  return {
    recordId: data.recordId,
    facts: { ...data.facts },
    provenance: { modality: data.modality, trust: data.trust },
  };
}

function freezePayload(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezePayload(child);
    Object.freeze(value);
  }
  return value;
}

export function createPrivacyFlows(boundary) {
  if (!isPrivacyBoundary(boundary)) {
    throw new TypeError('privacy boundary instance required');
  }

  const caches = new Map();
  const telemetry = [];
  const telemetryRecords = new WeakMap();
  const decisions = new WeakMap();
  const creativeOutputs = new WeakMap();

  function partitionFor(scope) {
    return boundary.scopePartition(scope);
  }

  function cacheFor(scope, create = false) {
    const partition = partitionFor(scope);
    let cache = caches.get(partition);
    if (!cache && create) {
      cache = new Map();
      caches.set(partition, cache);
    }
    return cache;
  }

  const cache = Object.freeze({
    put(scope, key, derivative) {
      if (typeof key !== 'string' || key.length === 0 || key.length > 180 || !isWellFormed(key)) throw deny();
      boundary.exportDerivative(scope, derivative);
      cacheFor(scope, true).set(key, derivative);
    },
    get(scope, key) {
      if (typeof key !== 'string') return undefined;
      const value = cacheFor(scope)?.get(key);
      if (value) boundary.exportDerivative(scope, value);
      return value;
    },
    snapshot(scope) {
      return Object.freeze([...(cacheFor(scope)?.values() ?? [])]);
    },
    clear(scope) {
      caches.delete(partitionFor(scope));
    },
  });

  const diagnostic = Object.freeze({
    record(scope, result) {
      const safe = safeDiagnostic(boundary, scope, result);
      const record = opaque();
      telemetryRecords.set(record, Object.freeze({
        partition: partitionFor(scope),
        value: Object.freeze({
          recordId: safe.recordId,
          state: safe.state,
          modality: safe.modality,
          trust: safe.trust,
          reasonCode: safe.reasonCode,
          redactionCategories: Object.freeze([...safe.redactionCategories]),
        }),
      }));
      telemetry.push(record);
      return record;
    },
    snapshot(scope) {
      const partition = partitionFor(scope);
      return Object.freeze(telemetry.filter((record) => telemetryRecords.get(record)?.partition === partition));
    },
  });

  function makeDecisionState(scope, derivative) {
    const partition = partitionFor(scope);
    const payload = renderDerivative(boundary, scope, derivative);
    const state = opaque();
    decisions.set(state, Object.freeze({ partition, payload: freezePayload(payload) }));
    return state;
  }

  function makeCreativePayload(scope, derivative) {
    const partition = partitionFor(scope);
    const payload = renderDerivative(boundary, scope, derivative);
    const result = opaque();
    creativeOutputs.set(result, Object.freeze({ partition, payload: freezePayload({
      recordId: payload.recordId,
      eventFacts: { ...payload.facts },
      evidence: { ...payload.provenance },
    }) }));
    return result;
  }

  function decisionPayload(scope, state) {
    const data = decisions.get(state);
    if (!data || data.partition !== partitionFor(scope)) throw deny();
    return data.payload;
  }

  function creativePayload(scope, payload) {
    const data = creativeOutputs.get(payload);
    if (!data || data.partition !== partitionFor(scope)) throw deny();
    return data.payload;
  }

  function telemetryPayload(scope, record) {
    const data = telemetryRecords.get(record);
    if (!data || data.partition !== partitionFor(scope)) throw deny();
    return data.value;
  }

  function serialize(scope, selections = {}) {
    if (selections === null || typeof selections !== 'object' || Array.isArray(selections)) throw deny();
    const allowed = new Set(['cacheValues', 'telemetryValues', 'decisionValues', 'creativeValues']);
    const keys = Reflect.ownKeys(selections);
    if (keys.some((key) => typeof key !== 'string' || !allowed.has(key))) throw deny();
    const selected = Object.create(null);
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(selections, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw deny();
      selected[key] = descriptor.value;
    }
    const valuesFor = (key) => {
      const value = selected[key] ?? [];
      if (!Array.isArray(value)) throw deny();
      return value;
    };
    const cacheValues = valuesFor('cacheValues').map((item) => renderDerivative(boundary, scope, item));
    const telemetryValues = valuesFor('telemetryValues').map((item) => telemetryPayload(scope, item));
    const decisionValues = valuesFor('decisionValues').map((item) => decisionPayload(scope, item));
    const creativeValues = valuesFor('creativeValues').map((item) => creativePayload(scope, item));
    return JSON.stringify({ cache: cacheValues, telemetry: telemetryValues, decisions: decisionValues, creative: creativeValues });
  }

  return Object.freeze({
    cache,
    diagnostic,
    makeDecisionState,
    makeCreativePayload,
    decisionPayload,
    creativePayload,
    serialize,
  });
}
