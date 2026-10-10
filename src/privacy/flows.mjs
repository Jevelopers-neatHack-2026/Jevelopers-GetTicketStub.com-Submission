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

const FACT_FIELDS = Object.freeze(['event_name', 'event_date', 'venue']);
const SELECTION_FIELDS = new Set(['cacheValues', 'telemetryValues', 'decisionValues', 'creativeValues']);
const MAX_SELECTION_LENGTH = 10_000;

function copyFacts(facts) {
  const copy = Object.create(null);
  for (let index = 0; index < FACT_FIELDS.length; index += 1) {
    const key = FACT_FIELDS[index];
    if (!Object.hasOwn(facts, key)) continue;
    const descriptor = Object.getOwnPropertyDescriptor(facts, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'string') throw deny();
    copy[key] = descriptor.value;
  }
  return copy;
}

function renderDerivative(boundary, scope, derivative) {
  const data = boundary.exportDerivative(scope, derivative);
  const provenance = Object.create(null);
  provenance.modality = data.modality;
  provenance.trust = data.trust;
  const output = Object.create(null);
  output.recordId = data.recordId;
  output.facts = copyFacts(data.facts);
  output.provenance = provenance;
  return output;
}

function copyTelemetry(value) {
  const categories = [];
  const sourceCategories = value.redactionCategories;
  for (let index = 0; index < sourceCategories.length; index += 1) categories[index] = sourceCategories[index];
  const output = Object.create(null);
  output.recordId = value.recordId;
  output.state = value.state;
  output.modality = value.modality;
  output.trust = value.trust;
  output.reasonCode = value.reasonCode;
  output.redactionCategories = categories;
  return output;
}

function copyEvidence(value) {
  const provenance = Object.create(null);
  provenance.modality = value.provenance.modality;
  provenance.trust = value.provenance.trust;
  const output = Object.create(null);
  output.recordId = value.recordId;
  output.facts = copyFacts(value.facts);
  output.provenance = provenance;
  return output;
}

function copyCreativeEvidence(value) {
  const evidence = Object.create(null);
  evidence.modality = value.evidence.modality;
  evidence.trust = value.evidence.trust;
  const output = Object.create(null);
  output.recordId = value.recordId;
  output.eventFacts = copyFacts(value.eventFacts);
  output.evidence = evidence;
  return output;
}

function readSelectionObject(value) {
  try {
    if (value === undefined) return Object.create(null);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw deny();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) throw deny();
    const keys = Reflect.ownKeys(value);
    const output = Object.create(null);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      if (typeof key !== 'string' || !SELECTION_FIELDS.has(key)) throw deny();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw deny();
      output[key] = descriptor.value;
    }
    return output;
  } catch {
    throw deny();
  }
}

function readSelectionArray(value) {
  try {
    if (value === undefined) return [];
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) throw deny();
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = lengthDescriptor?.value;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(length) || length < 0 || length > MAX_SELECTION_LENGTH) throw deny();
    const keys = Reflect.ownKeys(value);
    for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
      const key = keys[keyIndex];
      if (key === 'length') continue;
      if (typeof key !== 'string') throw deny();
      const arrayIndex = Number(key);
      if (!Number.isSafeInteger(arrayIndex) || arrayIndex < 0 || String(arrayIndex) !== key || arrayIndex >= length) throw deny();
    }
    const output = new Array(length);
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw deny();
      output[index] = descriptor.value;
    }
    return output;
  } catch {
    throw deny();
  }
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
    // Check the issuer-backed tenant capability before touching caller-controlled data,
    // including the empty-selection case.
    partitionFor(scope);
    try {
      const selected = readSelectionObject(selections);
      const cacheValues = readSelectionArray(selected.cacheValues);
      const telemetryValues = readSelectionArray(selected.telemetryValues);
      const decisionValues = readSelectionArray(selected.decisionValues);
      const creativeValues = readSelectionArray(selected.creativeValues);
      const cache = new Array(cacheValues.length);
      const telemetry = new Array(telemetryValues.length);
      const decisionsOutput = new Array(decisionValues.length);
      const creative = new Array(creativeValues.length);
      for (let index = 0; index < cacheValues.length; index += 1) {
        cache[index] = renderDerivative(boundary, scope, cacheValues[index]);
      }
      for (let index = 0; index < telemetryValues.length; index += 1) {
        telemetry[index] = copyTelemetry(telemetryPayload(scope, telemetryValues[index]));
      }
      for (let index = 0; index < decisionValues.length; index += 1) {
        decisionsOutput[index] = copyEvidence(decisionPayload(scope, decisionValues[index]));
      }
      for (let index = 0; index < creativeValues.length; index += 1) {
        creative[index] = copyCreativeEvidence(creativePayload(scope, creativeValues[index]));
      }
      const output = Object.create(null);
      output.cache = cache;
      output.telemetry = telemetry;
      output.decisions = decisionsOutput;
      output.creative = creative;
      return JSON.stringify(output);
    } catch {
      throw deny();
    }
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
