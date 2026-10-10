import { createHash } from 'node:crypto';

const OBSERVATION_SCHEMA = 'ei-occurrence-observation-internal/v1';
const DECISION_SCHEMA = 'ei-occurrence-identity-decision-internal/v1';
const TRANSITION_SCHEMA = 'ei-occurrence-transition-internal/v1';
const ORIGINS = new Set(['sourced', 'customer_supplied']);
const FACT_FIELDS = ['title', 'series', 'edition', 'city', 'venue', 'start', 'end', 'status'];
const NON_TEMPORAL_FIELDS = new Set(['title', 'series', 'edition', 'city', 'venue', 'status']);
const STATUS_VALUES = new Set(['scheduled', 'canceled', 'postponed', 'rescheduled']);
const SHA256 = /^[a-f0-9]{64}$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;
const INSTANT_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2})$/;

export class OccurrenceIdentityError extends Error {
  constructor(code = 'IDENTITY_INVALID_INPUT') {
    super(code);
    this.name = 'OccurrenceIdentityError';
    this.code = code;
  }
}

function invalid() {
  throw new OccurrenceIdentityError();
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

function validCalendarDate(value) {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day >= 1 && day <= days[month - 1];
}

function validClock(hourValue, minuteValue, secondValue) {
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  const second = secondValue === undefined ? 0 : Number(secondValue);
  return hour <= 23 && minute <= 59 && second <= 59;
}

function validTemporal(value, precision) {
  if (!boundedText(value, 100)) return false;
  if (precision === 'date') return validCalendarDate(value);
  if (precision === 'local_datetime') {
    const match = LOCAL_DATE_TIME_RE.exec(value);
    return Boolean(match && validCalendarDate(match[1]) && validClock(match[2], match[3], match[4]));
  }
  if (precision === 'instant') {
    const match = INSTANT_RE.exec(value);
    if (!match || !validCalendarDate(match[1]) || !validClock(match[2], match[3], match[4])) return false;
    if (match[6] === 'Z') return true;
    const hours = Number(match[6].slice(1, 3));
    const minutes = Number(match[6].slice(4, 6));
    return hours <= 14 && minutes <= 59 && !(hours === 14 && minutes !== 0);
  }
  return precision === 'unknown';
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
    if (Object.hasOwn(locator, 'startByte') || Object.hasOwn(locator, 'endByte')
      || typeof locator.pointer !== 'string' || locator.pointer.length > 512) return null;
    if (locator.pointer !== '' && (!locator.pointer.trim() || !/^(?:\/(?:[^~/]|~[01])*)*$/.test(locator.pointer))) return null;
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

function validateClaim(value, field, temporal) {
  const allowed = temporal
    ? new Set(['value', 'precision', 'origin', 'supports'])
    : new Set(['value', 'origin', 'supports']);
  const input = ownRecord(value, allowed);
  if (!input || !ORIGINS.has(input.origin) || !boundedText(input.value, temporal ? 100 : 512)) return null;
  if (temporal && !validTemporal(input.value, input.precision)) return null;
  if (!temporal && field === 'status' && !STATUS_VALUES.has(input.value)) return null;
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
  return {
    value: input.value,
    origin: input.origin,
    ...(temporal ? { precision: input.precision } : {}),
    supports,
  };
}

function snapshotCandidate(value) {
  const input = ownRecord(value, new Set(['schema', 'candidateId', 'facts']));
  if (!input || input.schema !== OBSERVATION_SCHEMA || !safeId(input.candidateId)) invalid();
  const factsInput = ownRecord(input.facts, new Set(FACT_FIELDS));
  if (!factsInput) invalid();
  const facts = {};
  for (const field of FACT_FIELDS) {
    const claimValues = Object.hasOwn(factsInput, field) ? ownArray(factsInput[field], 16) : [];
    if (!claimValues) invalid();
    const claims = [];
    for (const claimValue of claimValues) {
      const claim = validateClaim(claimValue, field, field === 'start' || field === 'end');
      if (!claim) invalid();
      claims.push(claim);
    }
    facts[field] = claims;
  }
  return { schema: OBSERVATION_SCHEMA, candidateId: input.candidateId, facts };
}

function freezeDeep(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function validateTransitionInput(value) {
  const input = ownRecord(value, new Set(['schema', 'id', 'predecessorId', 'successorId', 'transition', 'supports']));
  if (!input || input.schema !== TRANSITION_SCHEMA || !safeId(input.predecessorId)
    || (input.successorId !== null && !safeId(input.successorId))
    || !['canceled', 'rescheduled'].includes(input.transition)) return null;
  if (input.transition === 'canceled' && input.successorId !== null) return null;
  if (input.transition === 'rescheduled' && (!input.successorId || input.successorId === input.predecessorId)) return null;
  const sourceValues = ownArray(input.supports, 16);
  if (!sourceValues || sourceValues.length === 0) return null;
  const supports = [];
  for (const sourceValue of sourceValues) {
    const expectedValue = input.transition === 'canceled' ? 'canceled' : 'rescheduled';
    const source = validateSourceReference(sourceValue, expectedValue);
    if (!source || source.field !== 'status') return null;
    supports.push(source);
  }
  const canonical = canonicalTransition({
    predecessorId: input.predecessorId,
    successorId: input.successorId,
    transition: input.transition,
    supports,
  });
  if (input.id !== canonical.id) return null;
  return canonical;
}

function canonicalTransition({ predecessorId, successorId, transition, supports }) {
  const orderedSupports = [...supports].sort((left, right) => {
    const leftKey = sourceReferenceKey(left);
    const rightKey = sourceReferenceKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const content = JSON.stringify({
    schema: TRANSITION_SCHEMA,
    predecessorId,
    successorId,
    transition,
    supports: orderedSupports,
  });
  const id = `transition:${createHash('sha256').update(content).digest('hex')}`;
  return freezeDeep({ schema: TRANSITION_SCHEMA, id, predecessorId, successorId, transition, supports: orderedSupports });
}

function allClaims(candidate) {
  return FACT_FIELDS.flatMap((field) => candidate.facts[field].map((claim) => ({ field, claim })));
}

function allSourceReferences(candidates, transitions = []) {
  const byKey = new Map();
  for (const candidate of candidates) {
    for (const { claim } of allClaims(candidate)) {
      for (const support of claim.supports) byKey.set(sourceReferenceKey(support), support);
    }
  }
  for (const transition of transitions) {
    for (const support of transition.supports) byKey.set(sourceReferenceKey(support), support);
  }
  return [...byKey.values()].sort((left, right) => {
    const leftKey = sourceReferenceKey(left);
    const rightKey = sourceReferenceKey(right);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}

function duplicateContentHashes(candidates, transitions = []) {
  const idsByHash = new Map();
  for (const candidate of candidates) {
    for (const { claim } of allClaims(candidate)) {
      for (const support of claim.supports) {
        const ids = idsByHash.get(support.contentHash) ?? new Set();
        ids.add(support.evidenceId);
        idsByHash.set(support.contentHash, ids);
      }
    }
  }
  for (const transition of transitions) {
    for (const support of transition.supports) {
      const ids = idsByHash.get(support.contentHash) ?? new Set();
      ids.add(support.evidenceId);
      idsByHash.set(support.contentHash, ids);
    }
  }
  return [...idsByHash].filter(([, ids]) => ids.size > 1).map(([hash]) => hash).sort();
}

function sourceReferenceConflict(candidates, transitions = []) {
  const hashByEvidence = new Map();
  const valueByPositionField = new Map();
  for (const candidate of candidates) {
    for (const { claim } of allClaims(candidate)) {
      for (const support of claim.supports) {
        const previousHash = hashByEvidence.get(support.evidenceId);
        if (previousHash && previousHash !== support.contentHash) return true;
        hashByEvidence.set(support.evidenceId, support.contentHash);
        const key = JSON.stringify([support.evidenceId, support.locator, support.field]);
        const previousValue = valueByPositionField.get(key);
        if (previousValue !== undefined && previousValue !== support.value) return true;
        valueByPositionField.set(key, support.value);
      }
    }
  }
  for (const transition of transitions) {
    for (const support of transition.supports) {
      const previousHash = hashByEvidence.get(support.evidenceId);
      if (previousHash && previousHash !== support.contentHash) return true;
      hashByEvidence.set(support.evidenceId, support.contentHash);
      const key = JSON.stringify([support.evidenceId, support.locator, support.field]);
      const previousValue = valueByPositionField.get(key);
      if (previousValue !== undefined && previousValue !== support.value) return true;
      valueByPositionField.set(key, support.value);
    }
  }
  return false;
}

function fieldValueKey(field, claim) {
  if (field === 'start' || field === 'end') return `${claim.precision}\u0000${claim.value}`;
  if (field === 'status') return claim.value;
  return claim.value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function internalConflictFields(candidate) {
  return FACT_FIELDS.filter((field) => new Set(candidate.facts[field].map((claim) => fieldValueKey(field, claim))).size > 1);
}

function uniqueClaim(candidate, field) {
  const claims = candidate.facts[field];
  if (claims.length === 0) return null;
  return claims[0];
}

function normalizedLabel(value) {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}

function sharedSourceClaim(left, right) {
  if (left.origin !== right.origin || left.value !== right.value) return false;
  if (left.precision !== right.precision) return false;
  const rightKeys = new Set(right.supports.map(sourceReferenceKey));
  return left.supports.some((support) => rightKeys.has(sourceReferenceKey(support)));
}

function sharedOccurrenceObservation(left, right) {
  const leftTitle = uniqueClaim(left, 'title');
  const rightTitle = uniqueClaim(right, 'title');
  if (!leftTitle || !rightTitle || !sharedSourceClaim(leftTitle, rightTitle)) return false;
  for (const field of ['start', 'edition']) {
    const leftClaim = uniqueClaim(left, field);
    const rightClaim = uniqueClaim(right, field);
    if (leftClaim && rightClaim && sharedSourceClaim(leftClaim, rightClaim)
      && (field !== 'start' || leftClaim.precision !== 'unknown')) return true;
  }
  return false;
}

function dateRelation(left, right) {
  if (!left || !right) return null;
  if (left.precision === 'unknown' || right.precision === 'unknown') return 'date_precision_unknown';
  if (left.precision !== right.precision) return 'date_precision_mismatch';
  if (left.value === right.value) return null;
  if (left.precision === 'date') return 'date_day_mismatch';
  if (left.precision === 'instant') return 'instant_mismatch';
  return 'local_datetime_mismatch';
}

function relatedTransitions(left, right, transitions) {
  const related = [];
  for (const transition of transitions) {
    if (transition.transition === 'rescheduled'
      && ((transition.predecessorId === left.candidateId && transition.successorId === right.candidateId)
        || (transition.predecessorId === right.candidateId && transition.successorId === left.candidateId))) related.push(transition);
    if (transition.transition === 'canceled'
      && (transition.predecessorId === left.candidateId || transition.predecessorId === right.candidateId)) {
      const sourceKeys = new Set(transition.supports.map(sourceReferenceKey));
      const cancellationClaimIsLinked = [left, right].some((candidate) => candidate.facts.status.some((claim) =>
        claim.value === 'canceled' && claim.supports.some((support) => sourceKeys.has(sourceReferenceKey(support)))));
      if (cancellationClaimIsLinked) related.push(transition);
    }
  }
  return related.sort((leftLink, rightLink) => leftLink.id < rightLink.id ? -1 : leftLink.id > rightLink.id ? 1 : 0);
}

function decision(candidates, relation, reasons, conflicts, duplicates, transitions = []) {
  const ordered = [...candidates].sort((left, right) => left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0);
  const orderedTransitions = [...transitions].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return freezeDeep({
    schema: DECISION_SCHEMA,
    candidateIds: ordered.map((candidate) => candidate.candidateId),
    relation,
    reasonCodes: [...new Set(reasons)].sort(),
    conflictFields: [...new Set(conflicts)].sort(),
    sourceAuthority: 'not_evaluated',
    duplicateContentHashes: duplicates,
    provenanceReferences: allSourceReferences(ordered, orderedTransitions),
    candidates: ordered,
    transitionLinks: orderedTransitions,
  });
}

/**
 * Preserve the source-backed predecessor/successor relationship as an
 * immutable record. A link describes a reported transition; it cannot make a
 * page official or make two scheduled occurrences identical.
 */
export function createOccurrenceTransition(value) {
  try {
    const input = ownRecord(value, new Set(['predecessorId', 'successorId', 'transition', 'supports']));
    if (!input || !safeId(input.predecessorId)
      || (input.successorId !== null && !safeId(input.successorId))
      || !['canceled', 'rescheduled'].includes(input.transition)) invalid();
    if (input.transition === 'canceled' && input.successorId !== null) invalid();
    if (input.transition === 'rescheduled' && (!input.successorId || input.successorId === input.predecessorId)) invalid();
    const sourceValues = ownArray(input.supports, 16);
    if (!sourceValues || sourceValues.length === 0) invalid();
    const supports = sourceValues.map((sourceValue) => {
      const valueText = input.transition === 'canceled' ? 'canceled' : 'rescheduled';
      const source = validateSourceReference(sourceValue, valueText);
      if (!source || source.field !== 'status') invalid();
      return source;
    });
    return canonicalTransition({
      predecessorId: input.predecessorId,
      successorId: input.successorId,
      transition: input.transition,
      supports,
    });
  } catch (error) {
    if (error instanceof OccurrenceIdentityError) throw error;
    throw new OccurrenceIdentityError();
  }
}

/** Compare occurrence candidates without merging them or changing their facts. */
export function compareOccurrenceIdentity(leftValue, rightValue, options = {}) {
  try {
    const left = snapshotCandidate(leftValue);
    const right = snapshotCandidate(rightValue);
    if (left.candidateId === right.candidateId) invalid();
    const optionRecord = ownRecord(options, new Set(['transitions']));
    if (!optionRecord) invalid();
    const transitionValues = Object.hasOwn(optionRecord, 'transitions') ? ownArray(optionRecord.transitions, 64) : [];
    if (!transitionValues) invalid();
    const transitions = transitionValues.map(validateTransitionInput);
    if (transitions.some((transition) => !transition)) invalid();

    const candidates = [left, right];
    const attachedTransitions = relatedTransitions(left, right, transitions);
    const duplicates = duplicateContentHashes(candidates, attachedTransitions);
    const transitionKinds = new Set(attachedTransitions.map((transition) => transition.transition));
    const hasReschedule = transitionKinds.has('rescheduled');
    const hasCancellation = transitionKinds.has('canceled');
    const transitionReasons = [
      ...(hasReschedule ? ['explicit_reschedule_successor_link'] : []),
      ...(hasCancellation ? ['explicit_cancellation_evidence'] : []),
      ...(hasReschedule && hasCancellation ? ['conflicting_transition_links'] : []),
    ];
    if (sourceReferenceConflict(candidates, attachedTransitions)) {
      return decision(candidates, 'review', ['source_reference_conflict', ...transitionReasons], [], duplicates, attachedTransitions);
    }

    const internalConflicts = [...new Set([...internalConflictFields(left), ...internalConflictFields(right)])].sort();
    if (internalConflicts.length > 0) {
      return decision(candidates, 'review', ['candidate_fact_conflict', ...transitionReasons], internalConflicts, duplicates, attachedTransitions);
    }

    const conflicts = [];
    const distinctReasons = [];
    const reasons = [];
    const leftCity = uniqueClaim(left, 'city');
    const rightCity = uniqueClaim(right, 'city');
    if (leftCity && rightCity && normalizedLabel(leftCity.value) !== normalizedLabel(rightCity.value)) {
      distinctReasons.push('city_mismatch');
      conflicts.push('city');
    }

    const leftEdition = uniqueClaim(left, 'edition');
    const rightEdition = uniqueClaim(right, 'edition');
    if (leftEdition && rightEdition && normalizedLabel(leftEdition.value) !== normalizedLabel(rightEdition.value)) {
      distinctReasons.push('edition_mismatch');
      conflicts.push('edition');
    }

    const startRelation = dateRelation(uniqueClaim(left, 'start'), uniqueClaim(right, 'start'));
    if (startRelation === 'date_day_mismatch') {
      distinctReasons.push(startRelation);
      conflicts.push('start');
    } else if (startRelation) {
      reasons.push(startRelation);
      conflicts.push('start');
    }

    const leftVenue = uniqueClaim(left, 'venue');
    const rightVenue = uniqueClaim(right, 'venue');
    if (leftVenue && rightVenue && normalizedLabel(leftVenue.value) !== normalizedLabel(rightVenue.value)) {
      reasons.push('venue_conflict');
      conflicts.push('venue');
    }

    const leftStatus = uniqueClaim(left, 'status');
    const rightStatus = uniqueClaim(right, 'status');
    if (leftStatus && rightStatus && leftStatus.value !== rightStatus.value) {
      reasons.push('status_conflict');
      conflicts.push('status');
    }

    const leftTitle = uniqueClaim(left, 'title');
    const rightTitle = uniqueClaim(right, 'title');
    if (leftTitle && rightTitle && normalizedLabel(leftTitle.value) !== normalizedLabel(rightTitle.value)) {
      reasons.push('title_conflict');
      conflicts.push('title');
    }

    const leftSeries = uniqueClaim(left, 'series');
    const rightSeries = uniqueClaim(right, 'series');
    if (leftSeries && rightSeries && normalizedLabel(leftSeries.value) !== normalizedLabel(rightSeries.value)) {
      reasons.push('series_conflict');
      conflicts.push('series');
    }

    const leftEnd = uniqueClaim(left, 'end');
    const rightEnd = uniqueClaim(right, 'end');
    const endRelation = dateRelation(leftEnd, rightEnd);
    if (endRelation) {
      reasons.push(`end_${endRelation}`);
      conflicts.push('end');
    }

    if (attachedTransitions.length > 0) {
      const relation = hasReschedule && !hasCancellation && internalConflicts.length === 0
        ? 'different_occurrence_candidate'
        : 'review';
      return decision(candidates, relation, [...transitionReasons, ...distinctReasons, ...reasons], conflicts, duplicates, attachedTransitions);
    }
    if (distinctReasons.length > 0) return decision(candidates, 'different_occurrence_candidate', [...distinctReasons, ...reasons], conflicts, duplicates);
    if (reasons.length > 0) return decision(candidates, 'review', reasons, conflicts, duplicates);
    if (sharedOccurrenceObservation(left, right)) {
      return decision(candidates, 'same_occurrence_candidate', ['shared_source_bound_occurrence_facts'], [], duplicates);
    }
    if (duplicates.length > 0) {
      return decision(candidates, 'review', ['duplicate_content_is_not_independent_support'], [], duplicates);
    }
    if (leftTitle && rightTitle && normalizedLabel(leftTitle.value) === normalizedLabel(rightTitle.value)) {
      return decision(candidates, 'review', ['compatible_facts_without_shared_source_identity'], [], duplicates);
    }
    const anyFacts = candidates.some((candidate) => FACT_FIELDS.some((field) => candidate.facts[field].length > 0));
    return decision(candidates, anyFacts ? 'review' : 'unknown', [anyFacts ? 'insufficient_identity_evidence' : 'no_occurrence_facts'], [], duplicates);
  } catch (error) {
    if (error instanceof OccurrenceIdentityError) throw error;
    throw new OccurrenceIdentityError();
  }
}
