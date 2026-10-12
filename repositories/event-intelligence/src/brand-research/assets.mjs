import { createHash } from 'node:crypto';
import { types as utilTypes } from 'node:util';
import { deriveQuestionTargetRef, prepareIndependentQuestions } from '../decisions/questions/prepare.mjs';
import { inspectSafeAssetBytes, SAFE_ASSET_LIMITS } from '../security/assets/inspect.mjs';
import { parseAndValidateUrl } from '../security/url-policy.mjs';

const EMPTY_SELECTION = Object.freeze({ facts: Object.freeze([]) });
const DISCOVERY_RESULTS = new WeakSet();
const BRAND_ROLE_QUESTION_ID = 'Q-EI-BRAND-ROLE:v1';
const DISCOVERY_INPUT_KEYS = new Set([
  'store', 'scope', 'request', 'discovery', 'candidateId', 'assetDocument', 'observation', 'signal',
]);
const ASSET_DOCUMENT_KEYS = new Set(['url', 'contentType', 'bytes', 'fetchedAt', 'redirects']);
const OBSERVATION_KEYS = new Set([
  'kind', 'observationRef', 'sourceRef', 'candidateRef', 'language', 'text', 'retentionTags', 'visual',
]);
const VISUAL_KEYS = new Set(['observerRef', 'observerModel', 'regionRef', 'assetHash', 'uncertainty']);
const RETENTION_TAGS = new Set([
  'event_identity', 'occurrence', 'tour_city', 'annual_edition', 'date', 'time_zone',
  'venue', 'cancellation', 'reschedule', 'rights', 'safety',
]);
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype);
const TYPED_ARRAY_LENGTH_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'length').get;
const TYPED_ARRAY_BYTE_OFFSET_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'byteOffset').get;
const TYPED_ARRAY_BUFFER_GETTER = Object.getOwnPropertyDescriptor(TYPED_ARRAY_PROTOTYPE, 'buffer').get;
const ARRAY_BUFFER_LENGTH_GETTER = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength').get;
const TYPED_ARRAY_SET = Uint8Array.prototype.set;
const SHA256_HEX = /^[a-f0-9]{64}$/;

export class BrandRoleQuestionPreparationError extends Error {
  constructor(code = 'INVALID_INPUT') {
    super('Brand-role question preparation input is invalid or unavailable.');
    this.name = 'BrandRoleQuestionPreparationError';
    this.code = code;
  }
}

function failPreparation(code = 'INVALID_INPUT') {
  throw new BrandRoleQuestionPreparationError(code);
}

function snapshotRecord(value, allowedKeys, requiredKeys = []) {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value) || utilTypes.isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))) return null;
    const copy = Object.create(null);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      copy[key] = descriptor.value;
    }
    if (requiredKeys.some((key) => !Object.hasOwn(copy, key))) return null;
    return copy;
  } catch {
    return null;
  }
}

function snapshotStringArray(value, maximum, allowedValues) {
  try {
    if (!Array.isArray(value) || utilTypes.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, 'value') || !Number.isSafeInteger(lengthDescriptor.value)) return null;
    const length = lengthDescriptor.value;
    if (length > maximum || keys.length !== length + 1 || keys.some((key) => typeof key !== 'string')) return null;
    const output = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true
        || typeof descriptor.value !== 'string' || !allowedValues.has(descriptor.value)) return null;
      output.push(descriptor.value);
    }
    return Object.freeze(output);
  } catch {
    return null;
  }
}

function copyByteSnapshot(value, maximumBytes) {
  if (utilTypes.isProxy(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Uint8Array.prototype && prototype !== Buffer.prototype) return null;
    const length = Reflect.apply(TYPED_ARRAY_LENGTH_GETTER, value, []);
    const byteOffset = Reflect.apply(TYPED_ARRAY_BYTE_OFFSET_GETTER, value, []);
    const backing = Reflect.apply(TYPED_ARRAY_BUFFER_GETTER, value, []);
    const backingLength = Reflect.apply(ARRAY_BUFFER_LENGTH_GETTER, backing, []);
    if (!Number.isSafeInteger(length) || length < 1 || length > maximumBytes
      || !Number.isSafeInteger(byteOffset) || byteOffset < 0
      || !Number.isSafeInteger(backingLength) || byteOffset + length > backingLength) return null;
    const copy = new Uint8Array(length);
    Reflect.apply(TYPED_ARRAY_SET, copy, [value]);
    return copy;
  } catch {
    return null;
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function sameLocator(left, right) {
  if (!left || !right || left.kind !== right.kind) return false;
  if (left.kind === 'text-range') return left.startByte === right.startByte && left.endByte === right.endByte;
  if (left.kind === 'json-pointer') return left.pointer === right.pointer;
  return false;
}

function sameStoredCandidate(discovered, stored, position, index) {
  return discovered.candidateId === stored.candidateId
    && stored.positionIndex === index
    && discovered.sourceForm === stored.sourceForm
    && discovered.field === stored.field
    && discovered.relationHint === stored.relationHint
    && JSON.stringify(discovered.association) === JSON.stringify(stored.association)
    && sameLocator(discovered.locator, stored.locator)
    && sameLocator(discovered.locator, position?.locator)
    && discovered.excerptHash === stored.excerptHash
    && discovered.excerptHash === position?.contentHash
    && discovered.excerptKind === stored.excerptKind
    && discovered.normalizedSuggestion === stored.normalizedSuggestion
    && discovered.fetchSuggestion === stored.fetchSuggestion
    && discovered.quarantineReason === stored.quarantineReason
    && discovered.role === 'unknown'
    && discovered.permission === 'unknown'
    && discovered.inspection === 'pending';
}

function snapshotObservation(value) {
  const record = snapshotRecord(value, OBSERVATION_KEYS, [
    'kind', 'observationRef', 'sourceRef', 'candidateRef', 'language', 'text', 'visual',
  ]);
  if (!record || record.kind !== 'structured_visual_observation') return null;
  const visual = snapshotRecord(record.visual, VISUAL_KEYS, [
    'observerRef', 'observerModel', 'regionRef', 'assetHash', 'uncertainty',
  ]);
  if (!visual) return null;
  const retentionTags = record.retentionTags === undefined
    ? undefined
    : snapshotStringArray(record.retentionTags, 11, RETENTION_TAGS);
  if (record.retentionTags !== undefined && retentionTags === null) return null;
  return Object.freeze({
    kind: record.kind,
    observationRef: record.observationRef,
    sourceRef: record.sourceRef,
    candidateRef: record.candidateRef,
    language: record.language,
    text: record.text,
    ...(retentionTags !== undefined ? { retentionTags } : {}),
    visual: Object.freeze({
      observerRef: visual.observerRef,
      observerModel: visual.observerModel,
      regionRef: visual.regionRef,
      assetHash: visual.assetHash,
      uncertainty: visual.uncertainty,
    }),
  });
}

export async function discoverAssetCandidates({ store, scope, document, retentionHandle, request, signal }) {
  if (!store || typeof store.ingestAssetSourceEvidence !== 'function'
    || typeof store.materializeSelected !== 'function') throw new TypeError('asset source store is unavailable');

  const stored = await store.ingestAssetSourceEvidence(
    scope,
    Object.freeze({ document, retentionHandle }),
    request,
    signal,
  );
  if (!stored || stored.outcome !== 'stored') return stored;

  const materialized = await store.materializeSelected(scope, Object.freeze({
    ...EMPTY_SELECTION,
    evidence: Object.freeze([stored.evidence]),
  }), request, signal);
  if (!materialized || materialized.evidence.length !== 1 || materialized.facts.length !== 0) {
    throw new Error('asset source readback failed');
  }
  const evidence = materialized.evidence[0];
  const provenance = evidence.source.assetSource;
  if (evidence.metadata.representation !== 'asset-source-excerpt'
    || !provenance || evidence.source.contentHash !== evidence.metadata.contentHash
    || evidence.source.contentHash !== stored.metadata.contentHash
    || provenance.sourceKind !== 'external'
    || evidence.positions.length !== stored.positions.length
    || provenance.candidates.length !== evidence.positions.length) {
    throw new Error('asset source readback failed');
  }

  const candidates = provenance.candidates.map((candidate, index) => {
    const position = evidence.positions[index];
    const issuedPosition = stored.positions[index];
    if (!position || !issuedPosition || candidate.positionIndex !== index
      || JSON.stringify(candidate.locator) !== JSON.stringify(position.locator)
      || candidate.excerptHash !== position.contentHash) throw new Error('asset source readback failed');
    return Object.freeze({
      candidateId: candidate.candidateId,
      sourceForm: candidate.sourceForm,
      field: candidate.field,
      relationHint: candidate.relationHint,
      association: candidate.association,
      locator: candidate.locator,
      excerptHash: candidate.excerptHash,
      ...(candidate.excerptKind !== undefined ? { excerptKind: candidate.excerptKind } : {}),
      normalizedSuggestion: candidate.normalizedSuggestion,
      fetchSuggestion: candidate.fetchSuggestion,
      quarantineReason: candidate.quarantineReason,
      role: 'unknown',
      permission: 'unknown',
      inspection: 'pending',
      position: position.handle,
    });
  });

  const result = Object.freeze({
    outcome: 'stored',
    evidence: evidence.handle,
    metadata: evidence.metadata,
    sourceHash: evidence.source.contentHash,
    created: stored.created,
    completeness: provenance.completeness,
    limitations: provenance.limitations,
    candidates: Object.freeze(candidates),
  });
  DISCOVERY_RESULTS.add(result);
  return result;
}

/**
 * Bind a caller-supplied structured visual observation to one current stored
 * source candidate and to a fresh local SVG inspection. The supplied document
 * metadata and observer fields remain caller assertions; this function does
 * not fetch bytes, prove acquisition, persist an asset version, dispatch a
 * question, or grant role or permission.
 */
export async function prepareBrandRoleQuestionFromAssetCandidate(inputValue) {
  const input = snapshotRecord(inputValue, DISCOVERY_INPUT_KEYS, [
    'store', 'scope', 'request', 'discovery', 'candidateId', 'assetDocument', 'observation',
  ]);
  if (!input || !DISCOVERY_RESULTS.has(input.discovery)
    || typeof input.candidateId !== 'string' || input.candidateId.length < 1 || input.candidateId.length > 256) {
    failPreparation('INVALID_INPUT');
  }
  if (utilTypes.isProxy(input.store) || input.store === null || typeof input.store !== 'object') failPreparation('INVALID_INPUT');
  const materializeDescriptor = Object.getOwnPropertyDescriptor(input.store, 'materializeSelected');
  if (!materializeDescriptor || !Object.hasOwn(materializeDescriptor, 'value')
    || typeof materializeDescriptor.value !== 'function') failPreparation('INVALID_INPUT');

  const sourceCandidates = input.discovery.candidates.filter((candidate) => candidate.candidateId === input.candidateId);
  if (sourceCandidates.length === 0) failPreparation('CANDIDATE_NOT_FOUND');
  if (sourceCandidates.length !== 1) failPreparation('CANDIDATE_AMBIGUOUS');
  const discoveredCandidate = sourceCandidates[0];
  if (discoveredCandidate.quarantineReason !== null || discoveredCandidate.fetchSuggestion === null) {
    failPreparation('CANDIDATE_NOT_FETCHABLE');
  }

  const assetDocument = snapshotRecord(input.assetDocument, ASSET_DOCUMENT_KEYS, [
    'url', 'contentType', 'bytes', 'fetchedAt', 'redirects',
  ]);
  if (!assetDocument || typeof assetDocument.url !== 'string' || assetDocument.url.length > 2_048
    || typeof assetDocument.contentType !== 'string'
    || assetDocument.contentType.length < 1 || assetDocument.contentType.length > 128
    || !/^[\x20-\x7e]+$/.test(assetDocument.contentType)
    || typeof assetDocument.fetchedAt !== 'string' || assetDocument.fetchedAt.length > 64
    || !Number.isFinite(Date.parse(assetDocument.fetchedAt))
    || !Number.isSafeInteger(assetDocument.redirects) || assetDocument.redirects < 0) {
    failPreparation('INVALID_INPUT');
  }
  if (assetDocument.url !== discoveredCandidate.fetchSuggestion || assetDocument.redirects !== 0) {
    failPreparation('ASSET_DOCUMENT_MISMATCH');
  }
  try {
    if (parseAndValidateUrl(assetDocument.url).url.href !== assetDocument.url) failPreparation('ASSET_DOCUMENT_MISMATCH');
  } catch (error) {
    if (error instanceof BrandRoleQuestionPreparationError) throw error;
    failPreparation('ASSET_DOCUMENT_MISMATCH');
  }

  const observation = snapshotObservation(input.observation);
  if (!observation) failPreparation('INVALID_INPUT');
  const sourceBytes = copyByteSnapshot(assetDocument.bytes, SAFE_ASSET_LIMITS.maxSourceBytes);
  if (!sourceBytes) failPreparation('INVALID_INPUT');
  let transformedBytes;
  try {
    // Own the caller's bytes before the asynchronous host-store reauthorization
    // so a caller cannot swap the inspected payload while readback is pending.
    const selected = await Reflect.apply(materializeDescriptor.value, input.store, [
      input.scope,
      Object.freeze({ evidence: Object.freeze([input.discovery.evidence]), facts: Object.freeze([]) }),
      input.request,
      input.signal,
    ]);
    if (!selected || selected.evidence.length !== 1 || selected.facts.length !== 0) failPreparation('CURRENT_SOURCE_MISMATCH');
    const currentEvidence = selected.evidence[0];
    const currentSource = currentEvidence.source;
    const currentMetadata = currentEvidence.metadata;
    const provenance = currentSource.assetSource;
    if (currentMetadata.state !== 'available'
      || currentMetadata.representation !== 'asset-source-excerpt'
      || currentMetadata.evidenceId !== input.discovery.metadata.evidenceId
      || currentMetadata.version !== input.discovery.metadata.version
      || currentMetadata.contentHash !== input.discovery.sourceHash
      || currentMetadata.derivationDigest !== input.discovery.metadata.derivationDigest
      || currentSource.contentHash !== input.discovery.sourceHash
      || !provenance || provenance.sourceKind !== 'external'
      || currentEvidence.positions.length !== provenance.candidates.length
      || provenance.candidates.length !== input.discovery.candidates.length) {
      failPreparation('CURRENT_SOURCE_MISMATCH');
    }
    const currentCandidateMatches = provenance.candidates
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => candidate.candidateId === input.candidateId);
    if (currentCandidateMatches.length === 0) failPreparation('CANDIDATE_NOT_FOUND');
    if (currentCandidateMatches.length !== 1) failPreparation('CANDIDATE_AMBIGUOUS');
    const { candidate: currentCandidate, index: candidateIndex } = currentCandidateMatches[0];
    const originalIndex = input.discovery.candidates.indexOf(discoveredCandidate);
    if (originalIndex !== candidateIndex
      || !sameStoredCandidate(discoveredCandidate, currentCandidate, currentEvidence.positions[candidateIndex], candidateIndex)) {
      failPreparation('CANDIDATE_POSITION_MISMATCH');
    }

    const inspection = inspectSafeAssetBytes(sourceBytes, {
      contentType: assetDocument.contentType,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    });
    if (inspection.action === 'review') failPreparation('ASSET_INSPECTION_REVIEW');
    if (inspection.action !== 'transformed' || inspection.contentType !== 'image/svg+xml'
      || !SHA256_HEX.test(inspection.sourceHash ?? '') || !SHA256_HEX.test(inspection.transformedHash ?? '')
      || inspection.sourceHash !== sha256(sourceBytes)) {
      failPreparation('ASSET_INSPECTION_REJECTED');
    }
    transformedBytes = inspection.copyTransformedBytes();
    if (!transformedBytes || !inspection.matchesTransformedBytes(transformedBytes)
      || sha256(transformedBytes) !== inspection.transformedHash) failPreparation('ASSET_INSPECTION_REJECTED');

    if (observation.sourceRef !== currentMetadata.evidenceId || observation.candidateRef !== input.candidateId) {
      failPreparation('OBSERVATION_BINDING_MISMATCH');
    }
    if (observation.visual.assetHash !== inspection.transformedHash) failPreparation('ASSET_HASH_MISMATCH');

    let targetRef;
    let plan;
    try {
      targetRef = deriveQuestionTargetRef(BRAND_ROLE_QUESTION_ID, [observation.observationRef]);
      plan = prepareIndependentQuestions([observation], [Object.freeze({
        questionId: BRAND_ROLE_QUESTION_ID,
        targetRef,
        observationRefs: Object.freeze([observation.observationRef]),
      })]);
    } catch {
      failPreparation('QUESTION_BINDING_FAILED');
    }
    const question = plan.questions.find((item) => item.questionId === BRAND_ROLE_QUESTION_ID);
    if (!question || question.targetBinding?.targetRef !== targetRef
      || question.targetBinding.candidateRefs.length !== 0
      || question.targetBinding.observationRefs.length !== 1
      || question.targetBinding.observationRefs[0] !== observation.observationRef
      || question.targetState?.evidence.length !== 1
      || question.targetState.evidence[0].candidateRef !== input.candidateId) {
      failPreparation('QUESTION_BINDING_FAILED');
    }

    return Object.freeze({
      sourceBinding: Object.freeze({
        evidenceId: currentMetadata.evidenceId,
        evidenceVersion: currentMetadata.version,
        pageSourceHash: currentSource.contentHash,
        derivationDigest: currentMetadata.derivationDigest,
        candidateId: currentCandidate.candidateId,
        positionIndex: candidateIndex,
        locator: currentCandidate.locator,
        candidateExcerptHash: currentCandidate.excerptHash,
      }),
      assetInspection: Object.freeze({
        contentType: inspection.contentType,
        policyVersion: inspection.policyVersion,
        assetBytesSourceHash: inspection.sourceHash,
        transformedBytesHash: inspection.transformedHash,
        transformedBytesMatchInspection: true,
        acquisitionProvenance: 'caller_supplied_unverified',
      }),
      questionBinding: Object.freeze({
        questionId: BRAND_ROLE_QUESTION_ID,
        candidateId: input.candidateId,
        registryVersion: plan.registryVersion,
        registrySchemaVersion: plan.registrySchemaVersion,
        registryHash: plan.registryHash,
        definitionHash: question.definitionHash,
        targetRef,
        targetBindingHash: question.targetBindingHash,
        observationRef: observation.observationRef,
        observerMetadataProvenance: 'caller_asserted_unverified',
      }),
      discoveryCandidateStatus: Object.freeze({
        role: discoveredCandidate.role,
        permission: discoveredCandidate.permission,
        inspection: discoveredCandidate.inspection,
      }),
      plan,
    });
  } finally {
    sourceBytes.fill(0);
    transformedBytes?.fill(0);
  }
}
