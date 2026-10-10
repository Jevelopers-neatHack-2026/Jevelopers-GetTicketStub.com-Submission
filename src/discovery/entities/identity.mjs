const SCHEMA = 'ei-entity-observation-internal/v1';
const DECISION_SCHEMA = 'ei-entity-identity-decision-internal/v1';
const ENTITY_KINDS = new Set(['organization', 'performer', 'venue', 'person', 'event_series']);
const ORIGINS = new Set(['sourced', 'customer_supplied']);
const SHA256 = /^[a-f0-9]{64}$/;

export class EntityIdentityError extends Error {
  constructor(code = 'IDENTITY_INVALID_INPUT') {
    super(code);
    this.name = 'EntityIdentityError';
    this.code = code;
  }
}

function invalid() {
  throw new EntityIdentityError();
}

function ownRecord(value, allowed) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length > allowed.size) return null;
    const copy = Object.create(null);
    for (const key of keys) {
      if (typeof key !== 'string' || !allowed.has(key)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      copy[key] = descriptor.value;
    }
    return copy;
  } catch {
    return null;
  }
}

function ownArray(value, maximum) {
  try {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
    if (!lengthDescriptor || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value > maximum) return null;
    const length = lengthDescriptor.value;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== length + 1 || !keys.includes('length')) return null;
    const copy = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      copy.push(descriptor.value);
    }
    return copy;
  } catch {
    return null;
  }
}

function boundedText(value, maximum = 512) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value.trim().length > 0 && !value.includes('\0');
}

function safeId(value) {
  return boundedText(value, 160) && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function validateLocator(value) {
  const locator = ownRecord(value, new Set(['kind', 'startByte', 'endByte', 'pointer']));
  if (!locator) return null;
  if (locator.kind === 'text-range') {
    if (Object.hasOwn(locator, 'pointer') || !Number.isSafeInteger(locator.startByte) || !Number.isSafeInteger(locator.endByte)
      || locator.startByte < 0 || locator.endByte <= locator.startByte || locator.endByte > 1_000_000_000) return null;
    return { kind: 'text-range', startByte: locator.startByte, endByte: locator.endByte };
  }
  if (locator.kind === 'json-pointer') {
    if (Object.hasOwn(locator, 'startByte') || Object.hasOwn(locator, 'endByte') || !boundedText(locator.pointer, 512) && locator.pointer !== '') return null;
    if (!/^(?:\/(?:[^~/]|~[01])*)*$/.test(locator.pointer)) return null;
    return { kind: 'json-pointer', pointer: locator.pointer };
  }
  return null;
}

function validateSourceReference(value, expectedValue) {
  const input = ownRecord(value, new Set(['evidenceId', 'contentHash', 'locator', 'field', 'value']));
  if (!input || !safeId(input.evidenceId) || typeof input.contentHash !== 'string' || !SHA256.test(input.contentHash)
    || !boundedText(input.field, 120) || typeof input.value !== 'string' || input.value !== expectedValue) return null;
  const locator = validateLocator(input.locator);
  if (!locator) return null;
  return {
    evidenceId: input.evidenceId,
    contentHash: input.contentHash,
    locator,
    field: input.field,
    value: input.value,
  };
}

function sourceReferenceKey(reference) {
  return JSON.stringify([reference.evidenceId, reference.contentHash, reference.locator, reference.field, reference.value]);
}

function validateClaim(value, allowed) {
  const input = ownRecord(value, allowed);
  if (!input || !boundedText(input.value, 512) || !ORIGINS.has(input.origin)) return null;
  const sourceValues = ownArray(input.supports, 8);
  if (!sourceValues || sourceValues.length === 0) return null;
  const supports = [];
  const seen = new Set();
  for (const sourceValue of sourceValues) {
    const support = validateSourceReference(sourceValue, input.value);
    if (!support) return null;
    const key = sourceReferenceKey(support);
    if (!seen.has(key)) {
      supports.push(support);
      seen.add(key);
    }
  }
  return { value: input.value, origin: input.origin, supports };
}

function validateClaimArray(value, maximum, allowed) {
  const values = ownArray(value, maximum);
  if (!values) return null;
  const claims = [];
  for (const claimValue of values) {
    const claim = validateClaim(claimValue, allowed);
    if (!claim) return null;
    claims.push(claim);
  }
  return claims;
}

function snapshotCandidate(value) {
  const input = ownRecord(value, new Set(['schema', 'candidateId', 'kind', 'names', 'identifiers']));
  if (!input || input.schema !== SCHEMA || !safeId(input.candidateId) || !ENTITY_KINDS.has(input.kind)) invalid();

  const names = Object.hasOwn(input, 'names')
    ? validateClaimArray(input.names, 24, new Set(['value', 'origin', 'supports']))
    : [];
  const identifierValues = Object.hasOwn(input, 'identifiers') ? ownArray(input.identifiers, 24) : [];
  if (!names || !identifierValues) invalid();
  const identifiers = [];
  for (const identifierValue of identifierValues) {
    const identifier = ownRecord(identifierValue, new Set(['namespace', 'value', 'origin', 'supports']));
    if (!identifier || !boundedText(identifier.namespace, 100) || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(identifier.namespace)
      || identifier.namespace !== identifier.namespace.toLowerCase()) invalid();
    const claim = validateClaim(identifier, new Set(['namespace', 'value', 'origin', 'supports']));
    if (!claim) invalid();
    identifiers.push({ namespace: identifier.namespace, ...claim });
  }
  return { schema: SCHEMA, candidateId: input.candidateId, kind: input.kind, names, identifiers };
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function normalizedLabel(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function namesSimilar(left, right) {
  const leftNames = new Set(left.names.map((claim) => normalizedLabel(claim.value)).filter(Boolean));
  const rightNames = new Set(right.names.map((claim) => normalizedLabel(claim.value)).filter(Boolean));
  for (const leftName of leftNames) {
    for (const rightName of rightNames) {
      if (leftName === rightName) return true;
      const leftWords = new Set(leftName.split(' '));
      const rightWords = new Set(rightName.split(' '));
      let intersection = 0;
      for (const word of leftWords) if (rightWords.has(word)) intersection += 1;
      const union = new Set([...leftWords, ...rightWords]).size;
      if (union > 0 && intersection * 2 >= union) return true;
    }
  }
  return false;
}

function sharedSourceReference(left, right) {
  const rightKeys = new Set(right.supports.map(sourceReferenceKey));
  return left.supports.some((reference) => rightKeys.has(sourceReferenceKey(reference)));
}

function duplicateHashes(candidates) {
  const idsByHash = new Map();
  for (const candidate of candidates) {
    for (const claim of [...candidate.names, ...candidate.identifiers]) {
      for (const support of claim.supports) {
        const ids = idsByHash.get(support.contentHash) ?? new Set();
        ids.add(support.evidenceId);
        idsByHash.set(support.contentHash, ids);
      }
    }
  }
  return [...idsByHash].filter(([, ids]) => ids.size > 1).map(([hash]) => hash).sort();
}

function candidateSourceIntegrityConflict(candidates) {
  const hashByEvidence = new Map();
  const valueByPosition = new Map();
  for (const candidate of candidates) {
    for (const claim of [...candidate.names, ...candidate.identifiers]) {
      for (const support of claim.supports) {
        const previousHash = hashByEvidence.get(support.evidenceId);
        if (previousHash && previousHash !== support.contentHash) return true;
        hashByEvidence.set(support.evidenceId, support.contentHash);
        const key = JSON.stringify([support.evidenceId, support.locator, support.field]);
        const previous = valueByPosition.get(key);
        const current = JSON.stringify([support.field, support.value]);
        if (previous && previous !== current) return true;
        valueByPosition.set(key, current);
      }
    }
  }
  return false;
}

function allSourceReferences(candidates) {
  const byKey = new Map();
  for (const candidate of candidates) {
    for (const claim of [...candidate.names, ...candidate.identifiers]) {
      for (const support of claim.supports) byKey.set(sourceReferenceKey(support), support);
    }
  }
  return [...byKey.values()].sort((left, right) => {
    const leftKey = sourceReferenceKey(left);
    const rightKey = sourceReferenceKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function identityDecision(candidates, relation, reasons, duplicates) {
  const ordered = [...candidates].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  return freezeDeep({
    schema: DECISION_SCHEMA,
    candidateIds: ordered.map((candidate) => candidate.candidateId),
    relation,
    reasonCodes: [...new Set(reasons)].sort(),
    sourceAuthority: 'not_evaluated',
    duplicateContentHashes: duplicates,
    provenanceReferences: allSourceReferences(ordered),
    candidates: ordered,
  });
}

/**
 * Compare two evidence-backed entity observations. This function never creates
 * or persists an entity; only an exact identifier claim tied to the same
 * evidence position can produce a source-bound same-entity candidate.
 */
export function compareEntityIdentity(leftValue, rightValue) {
  try {
    const left = snapshotCandidate(leftValue);
    const right = snapshotCandidate(rightValue);
    if (left.candidateId === right.candidateId) invalid();
    const candidates = [left, right];
    const duplicates = duplicateHashes(candidates);
    if (left.kind !== right.kind) return identityDecision(candidates, 'review', ['entity_kind_mismatch'], duplicates);
    if (candidateSourceIntegrityConflict(candidates)) return identityDecision(candidates, 'review', ['source_reference_conflict'], duplicates);

    for (const candidate of candidates) {
      const valuesByNamespace = new Map();
      for (const identifier of candidate.identifiers) {
        const values = valuesByNamespace.get(identifier.namespace) ?? new Set();
        values.add(identifier.value.trim());
        valuesByNamespace.set(identifier.namespace, values);
      }
      if ([...valuesByNamespace.values()].some((values) => values.size > 1)) {
        return identityDecision(candidates, 'review', ['candidate_identifier_conflict'], duplicates);
      }
    }

    const groupByNamespace = (identifiers) => {
      const grouped = new Map();
      for (const identifier of identifiers) {
        const group = grouped.get(identifier.namespace) ?? [];
        group.push(identifier);
        grouped.set(identifier.namespace, group);
      }
      return grouped;
    };
    const leftByNamespace = groupByNamespace(left.identifiers);
    const rightByNamespace = groupByNamespace(right.identifiers);
    const commonNamespaces = [...leftByNamespace.keys()].filter((namespace) => rightByNamespace.has(namespace)).sort();
    const mismatches = commonNamespaces.filter((namespace) => leftByNamespace.get(namespace)[0].value.trim()
      !== rightByNamespace.get(namespace)[0].value.trim());
    if (mismatches.length > 0) {
      return identityDecision(candidates, 'different_entity_candidate', ['identifier_value_mismatch'], duplicates);
    }

    const matchingIdentifiers = commonNamespaces.flatMap((namespace) => leftByNamespace.get(namespace).flatMap((leftIdentifier) =>
      rightByNamespace.get(namespace).map((rightIdentifier) => [leftIdentifier, rightIdentifier])));
    const sourceBoundMatch = matchingIdentifiers.some(([leftIdentifier, rightIdentifier]) => leftIdentifier.origin === rightIdentifier.origin
      && leftIdentifier.value.trim() === rightIdentifier.value.trim() && sharedSourceReference(leftIdentifier, rightIdentifier));
    if (sourceBoundMatch) return identityDecision(candidates, 'same_entity_candidate', ['shared_source_bound_identifier'], duplicates);
    if (matchingIdentifiers.length > 0) {
      return identityDecision(candidates, 'review', ['identifier_match_without_shared_source_position'], duplicates);
    }
    if (duplicates.length > 0) return identityDecision(candidates, 'review', ['duplicate_content_is_not_independent_support'], duplicates);
    if (namesSimilar(left, right)) return identityDecision(candidates, 'review', ['name_similarity_without_strong_identity'], duplicates);
    return identityDecision(candidates, 'unknown', ['no_shared_strong_identity_evidence'], duplicates);
  } catch (error) {
    if (error instanceof EntityIdentityError) throw error;
    throw new EntityIdentityError();
  }
}
