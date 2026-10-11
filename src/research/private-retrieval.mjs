import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { SafeFetcher, RetrievalError } from '../security/controlled-fetch.mjs';
import { runWithSafeFetchLifecycle, safeFetchProvenance } from '../security/internal/fetch-lifecycle.mjs';
import { composeSourceIdentity, SourceIdentityCompositionError } from '../discovery/identity/from-extraction.mjs';
import { compareEntityIdentity } from '../discovery/entities/identity.mjs';
import { compareOccurrenceIdentity } from '../discovery/occurrences/identity.mjs';

const PRIVATE_DRAFT_SCHEMA = 'ei-private-retrieval-draft/v1';
const MAX_ADMISSIONS = 8;
const MAX_SELECTED_EVIDENCE = 8;
const MAX_SELECTED_FACTS = 128;
const MAX_AGGREGATE_IDENTITY_CANDIDATES = 23;
const MAX_AGGREGATE_COMPARISONS = 256;
const DECODED_BUFFER_MARGIN_BYTES = 64 * 1024;
const GZIP_CHUNK_BYTES = 4 * 1024;
// Source-pinned conservative accounting: native output (1x), Gunzip readable
// queue (2x), output writable queue (2x), output readable queue (2x), async
// iterator aggregate (2x), and the accumulator copy (2x), all in 4 KiB units.
const DECODED_INFLIGHT_BOUND_BYTES = 11 * GZIP_CHUNK_BYTES;
if (DECODED_INFLIGHT_BOUND_BYTES >= DECODED_BUFFER_MARGIN_BYTES) {
  throw new Error('private decoded stream bound exceeds its accepted-byte margin');
}
const TEXT_ACCEPTED_BYTES = 20 * 1024 * 1024 - DECODED_BUFFER_MARGIN_BYTES;
const MEDIA_ACCEPTED_BYTES = 10 * 1024 * 1024 - DECODED_BUFFER_MARGIN_BYTES;
const CANCELLATION_REASONS = new Set([
  'cancelled', 'budget_denied', 'deadline', 'access_restricted', 'adequate_facts', 'review_required',
]);
const STOP_LIMITATIONS = new Map([
  ['attempt_limit', 'transport_attempt_limit'],
  ['depth_limit', 'frontier_depth_limit'],
  ['fanout_limit', 'candidate_fanout_limit'],
]);
const ABORTED_GETTER = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const ADD_EVENT_LISTENER = EventTarget.prototype.addEventListener;
const REMOVE_EVENT_LISTENER = EventTarget.prototype.removeEventListener;

export class PrivateRetrievalError extends Error {
  constructor(code) {
    super(code === 'INVALID_INPUT' ? 'Private retrieval input is invalid.' : 'Private retrieval could not be authorized.');
    this.name = 'PrivateRetrievalError';
    this.code = code;
  }
}

function fail(code = 'INVALID_INPUT') {
  throw new PrivateRetrievalError(code);
}

function plainDataRecord(value, allowed) {
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

function exactMethods(value, names) {
  try {
    if (!value || typeof value !== 'object') return null;
    const result = Object.create(null);
    for (const name of names) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name);
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'function') return null;
      result[name] = descriptor.value.bind(value);
    }
    return result;
  } catch {
    return null;
  }
}

function ownArray(value, maximum) {
  try {
    if (!Array.isArray(value) || value.length > maximum) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.length !== value.length + 1 || !keys.includes('length')) return null;
    const copy = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.enumerable !== true) return null;
      copy.push(descriptor.value);
    }
    return copy;
  } catch {
    return null;
  }
}

function repeatedDecode(value) {
  let current = value;
  for (let depth = 0; depth < 4; depth += 1) {
    let decoded;
    try { decoded = decodeURIComponent(current.replaceAll('+', '%20')); }
    catch { return null; }
    if (decoded === current) return current;
    current = decoded;
  }
  try {
    return decodeURIComponent(current.replaceAll('+', '%20')) === current ? current : null;
  } catch {
    return null;
  }
}

function sensitiveKey(value) {
  return /(?:token|key|auth|code|signature|sig|secret|session|password|credential|invite|ticket|admission)/i.test(value);
}

function urlHasSensitiveMaterial(value) {
  try {
    if (typeof value !== 'string' || value.length > 8_192) return true;
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return true;
    for (const key of parsed.searchParams.keys()) {
      const decoded = repeatedDecode(key);
      if (decoded === null || sensitiveKey(decoded)) return true;
    }
    const fragment = parsed.hash.slice(1);
    if (fragment === '') return false;
    const decodedFragment = repeatedDecode(fragment);
    if (decodedFragment === null || sensitiveKey(decodedFragment)) return true;
    for (const component of decodedFragment.split(/[&;]/)) {
      const key = repeatedDecode(component.split('=', 1)[0]);
      if (key === null || sensitiveKey(key)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

function snapshotRunInput(value) {
  const input = plainDataRecord(value, new Set([
    'frontier', 'evidenceStore', 'safeFetcher', 'request', 'runId', 'seeds', 'limits',
    'retentionHandleFor', 'authorizeCurrent', 'signal',
  ]));
  if (!input || typeof input.runId !== 'string' || input.runId.length < 1 || input.runId.length > 96
    || input.request === null || (typeof input.request !== 'object' && typeof input.request !== 'function')
    || typeof input.retentionHandleFor !== 'function' || typeof input.authorizeCurrent !== 'function') fail();
  try { ABORTED_GETTER.call(input.signal); } catch {
    if (input.signal !== undefined) fail();
  }
  const seedValues = ownArray(input.seeds, 10);
  if (!seedValues || seedValues.length < 1) fail();
  const seeds = seedValues.map((value) => {
    const seed = plainDataRecord(value, new Set(['url', 'sourceRefs']));
    if (!seed || typeof seed.url !== 'string' || urlHasSensitiveMaterial(seed.url)) fail();
    const sourceRefs = seed.sourceRefs === undefined ? undefined : ownArray(seed.sourceRefs, 4);
    if (seed.sourceRefs !== undefined && !sourceRefs) fail();
    const copiedRefs = sourceRefs?.map((reference) => {
      const ref = plainDataRecord(reference, new Set(['evidenceId', 'contentHash', 'locator', 'field', 'value']));
      if (!ref || ref.value !== seed.url || typeof ref.evidenceId !== 'string'
        || typeof ref.contentHash !== 'string' || typeof ref.field !== 'string') fail();
      return { ...ref };
    });
    return { url: seed.url, ...(copiedRefs ? { sourceRefs: copiedRefs } : {}) };
  });
  const rawLimits = input.limits === undefined ? Object.create(null)
    : plainDataRecord(input.limits, new Set([
      'maxDepth', 'maxTransportAttemptAdmissions', 'maxInFlightLeases', 'durationMs', 'maxSuggestionsPerCompletion',
    ]));
  if (!rawLimits) fail();
  const limits = {
    maxDepth: rawLimits.maxDepth ?? 2,
    maxTransportAttemptAdmissions: rawLimits.maxTransportAttemptAdmissions ?? MAX_ADMISSIONS,
    maxInFlightLeases: rawLimits.maxInFlightLeases ?? 4,
    durationMs: rawLimits.durationMs ?? 30_000,
    maxSuggestionsPerCompletion: rawLimits.maxSuggestionsPerCompletion ?? 16,
  };
  if (!Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 0 || limits.maxDepth > 2
    || !Number.isSafeInteger(limits.maxTransportAttemptAdmissions) || limits.maxTransportAttemptAdmissions < 1
      || limits.maxTransportAttemptAdmissions > MAX_ADMISSIONS
    || !Number.isSafeInteger(limits.maxInFlightLeases) || limits.maxInFlightLeases < 1 || limits.maxInFlightLeases > 4
    || !Number.isSafeInteger(limits.durationMs) || limits.durationMs < 1 || limits.durationMs > 30_000
    || !Number.isSafeInteger(limits.maxSuggestionsPerCompletion) || limits.maxSuggestionsPerCompletion < 1
      || limits.maxSuggestionsPerCompletion > 16) fail();
  const frontier = exactMethods(input.frontier, [
    'scopeForAuthenticatedRequest', 'createRun', 'claimNext', 'admitTransportHop',
    'markTransportDispatchIntent', 'markTransportResponseReceived', 'settleTransportHopKnownZero',
    'settleTransportHopBodyComplete', 'markTransportHopUnknown', 'getTransportProgress',
    'completeCandidate', 'markUnresolved', 'stopRun', 'sealPrivateDraft', 'getSnapshot',
  ]);
  const evidenceStore = exactMethods(input.evidenceStore, [
    'scopeForAuthenticatedRequest', 'ingestEvidence', 'appendFact', 'ingestDerivedPdfEvidence', 'ingestAssetSourceEvidence',
    'lookupEvidence', 'lookupFact', 'materializeSelected', 'beginPrivateRunReceipt',
    'finalizePrivateRunReceipt', 'readPrivateRunReceipt',
  ]);
  if (!frontier || !evidenceStore || !(input.safeFetcher instanceof SafeFetcher)) fail();
  return {
    ...input, seeds, limits, frontier, evidenceStore,
    workerId: `private-retrieval-${randomUUID()}`,
  };
}

function signalAborted(signal) {
  if (signal === undefined) return false;
  try { return ABORTED_GETTER.call(signal); } catch { return true; }
}

function addAbortListener(signal, callback) {
  Reflect.apply(ADD_EVENT_LISTENER, signal, ['abort', callback, { once: true }]);
}

function removeAbortListener(signal, callback) {
  try { Reflect.apply(REMOVE_EVENT_LISTENER, signal, ['abort', callback]); } catch { /* Native signal validated at entry. */ }
}

async function awaitAbortableOperation(operation, signal, abortError) {
  if (signalAborted(signal)) throw abortError();
  let onAbort;
  const aborted = new Promise((_, reject) => {
    onAbort = () => reject(abortError());
    addAbortListener(signal, onAbort);
  });
  try {
    if (signalAborted(signal)) throw abortError();
    const pending = Promise.resolve().then(() => {
      if (signalAborted(signal)) throw abortError();
      return operation();
    });
    return await Promise.race([pending, aborted]);
  } finally {
    removeAbortListener(signal, onAbort);
  }
}

async function awaitAbortableHostCallback(callback, args, signal, abortError) {
  return awaitAbortableOperation(() => callback(...args), signal, abortError);
}

async function awaitBoundedCleanup(operation, timeoutMs = 250) {
  let timer;
  const pending = Promise.resolve().then(operation).catch(() => {});
  const timeout = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  try { await Promise.race([pending, timeout]); }
  finally { clearTimeout(timer); }
}

async function awaitAbortableCleanup(operation, timeoutMs = 250) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    await awaitBoundedCleanup(() => operation(controller.signal), timeoutMs + 25);
  } finally {
    clearTimeout(timer);
    if (!controller.signal.aborted) controller.abort();
  }
}

function authorized(input, stage) {
  try {
    return input.authorizeCurrent(input.request, Object.freeze({ runId: input.runId, stage })) === true;
  } catch {
    return false;
  }
}

function snapshotHasBlockingStop(snapshot) {
  return snapshot.stopReasons.some((entry) => CANCELLATION_REASONS.has(entry.reason));
}

function stopLimitation(snapshot, limitations) {
  for (const entry of snapshot.stopReasons) {
    const mapped = STOP_LIMITATIONS.get(entry.reason);
    if (mapped) limitations.add(mapped);
  }
}

function safeFailureCode(error) {
  if (error instanceof RetrievalError) return error.code;
  if (error instanceof SourceIdentityCompositionError) return error.code;
  if (typeof error?.code === 'string' && /^[A-Z_]{3,40}$/.test(error.code)) return error.code;
  return 'UNAVAILABLE';
}

function limitationFor(code) {
  if (code === 'UNSUPPORTED_MEDIA') return 'unsupported_media';
  if (code === 'RESOURCE_LIMIT') return 'resource_limit';
  if (code === 'MALFORMED_ENCODING' || code === 'UNSUPPORTED_ENCODING') return 'malformed_or_unsupported_encoding';
  if (code === 'NO_IDENTITY_CANDIDATES') return 'no_supported_identity_or_link_candidates';
  if (code === 'EXTRACTION_UNUSABLE' || code === 'ACCESS_RESTRICTED') return 'source_incomplete_or_access_restricted';
  if (code === 'EVIDENCE_EXPIRED') return 'selected_evidence_expired_or_revoked';
  if (code === 'EVIDENCE_KEY_UNAVAILABLE') return 'selected_evidence_key_unavailable';
  if (code === 'DEADLINE_EXCEEDED') return 'deadline_exceeded';
  if (code === 'CANCELED') return 'cancelled';
  if (code === 'POLICY_DENIED' || code === 'DNS_FAILURE') return 'safe_fetch_policy_or_dns_denied';
  return 'source_unavailable';
}

function validateProvenance(document, provenance, initialUrl, hops) {
  if (!provenance || provenance.requestedUrl !== initialUrl || provenance.finalUrl !== document.url
    || !Array.isArray(provenance.redirectChain) || provenance.redirectChain.length !== document.redirects
    || !Array.isArray(provenance.hops) || provenance.hops.length !== document.redirects + 1
    || provenance.hops.length !== hops.length || provenance.hops.some((hop, index) => {
      const admitted = hops[index];
      return !admitted || hop.url !== admitted.url || hop.dispatchIntent !== true || hop.responseReceived !== true
        || (index < hops.length - 1
          ? hop.bodyComplete !== false || hop.decodedBytes !== null
          : hop.bodyComplete !== true || hop.decodedBytes !== document.bytes.byteLength);
    })) return false;
  for (let index = 0; index < provenance.redirectChain.length; index += 1) {
    if (provenance.redirectChain[index] !== hops[index + 1]?.url) return false;
  }
  return true;
}

function factFingerprint(fact) {
  return JSON.stringify({
    factId: fact.factId,
    field: fact.field,
    status: fact.status,
    rawValue: fact.rawValue,
    normalizedValue: fact.normalizedValue,
    precision: fact.precision,
    supports: (fact.supports ?? []).map((support) => ({
      contentHash: support.contentHash,
      duplicateGroupId: support.duplicateGroupId,
      independence: support.independence,
    })),
  });
}

function digestJson(value) {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function receiptCandidate(candidate) {
  return Object.freeze({
    candidateId: candidate.candidateId,
    canonicalUrl: candidate.canonicalUrl,
    depth: candidate.depth,
    seed: candidate.seed,
    sourceRefs: Object.freeze(candidate.sourceRefs.map((reference) => Object.freeze({ ...reference }))),
  });
}

function emptyIdentityResult() {
  return Object.freeze({
    entityCandidates: Object.freeze([]),
    occurrenceCandidates: Object.freeze([]),
    transitionLinks: Object.freeze([]),
    unresolvedTransitions: Object.freeze([]),
  });
}

function compareAllPairs(values, compare) {
  const comparisonCount = values.length * (values.length - 1) / 2;
  if (!Number.isSafeInteger(comparisonCount) || comparisonCount > MAX_AGGREGATE_COMPARISONS) {
    throw new PrivateRetrievalError('RESOURCE_LIMIT');
  }
  const decisions = [];
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) decisions.push(compare(values[left], values[right]));
  }
  return Object.freeze(decisions);
}

function aggregateIdentity(candidateResults) {
  const entityCandidates = candidateResults.flatMap((item) => item.entityCandidates);
  const occurrenceCandidates = candidateResults.flatMap((item) => item.occurrenceCandidates);
  if (entityCandidates.length > MAX_AGGREGATE_IDENTITY_CANDIDATES
    || occurrenceCandidates.length > MAX_AGGREGATE_IDENTITY_CANDIDATES) {
    throw new PrivateRetrievalError('RESOURCE_LIMIT');
  }
  return Object.freeze({
    entityCandidates: Object.freeze(entityCandidates),
    occurrenceCandidates: Object.freeze(occurrenceCandidates),
    entityDecisions: compareAllPairs(entityCandidates, compareEntityIdentity),
    occurrenceDecisions: compareAllPairs(occurrenceCandidates, compareOccurrenceIdentity),
    transitionLinks: Object.freeze(candidateResults.flatMap((item) => item.transitionLinks)),
    unresolvedTransitions: Object.freeze(candidateResults.flatMap((item) => item.unresolvedTransitions)),
  });
}

function projection(identity, selectedEvidence, selectedFacts, progress, limitations) {
  const facts = selectedFacts;
  const evidenceById = new Map(selectedEvidence.map((item) => [item.metadata.evidenceId, item]));
  const sources = [...evidenceById.values()].map((item) => Object.freeze({
    evidenceId: item.metadata.evidenceId,
    version: item.metadata.version,
    representation: item.metadata.representation ?? 'raw',
    sourceUrl: item.source.sourceUrl,
    canonicalUrl: item.source.canonicalUrl,
    redirectChain: Object.freeze([...item.source.redirectChain]),
    contentType: item.source.contentType,
    retrievedAt: item.source.retrievedAt,
    contentHash: item.source.contentHash,
    sourceAuthority: 'not_evaluated',
    ...(item.source.derivedPdf ? {
      pdf: Object.freeze({
        pageCount: item.source.derivedPdf.pages.length,
        textPageCount: item.source.derivedPdf.pages.filter((page) => page.textPresence === 'text-present').length,
        textBoxCount: item.source.derivedPdf.textBoxCount,
        completeness: 'incomplete',
        requiresInspection: true,
      }),
    } : {}),
    ...(item.source.assetSource ? {
      assetCandidates: Object.freeze(item.source.assetSource.candidates.map((candidate) => Object.freeze({
        candidateId: candidate.candidateId,
        sourceForm: candidate.sourceForm,
        field: candidate.field,
        association: candidate.association,
        locator: candidate.locator,
        excerptHash: candidate.excerptHash,
        normalizedSuggestion: candidate.normalizedSuggestion,
        fetchSuggestion: candidate.fetchSuggestion,
        quarantineReason: candidate.quarantineReason,
        role: 'unknown',
        permission: 'unknown',
        inspection: 'pending',
        sourceRef: Object.freeze({
          evidenceId: item.metadata.evidenceId,
          contentHash: item.source.contentHash,
          locator: candidate.locator,
          field: candidate.field,
        }),
      }))),
      assetCompleteness: item.source.assetSource.completeness,
      assetLimitations: Object.freeze([...item.source.assetSource.limitations]),
    } : {}),
  }));
  const occurrenceCandidates = identity.occurrenceCandidates;
  const entityCandidates = identity.entityCandidates;
  const occurrenceDecisions = identity.occurrenceDecisions;
  const entityDecisions = identity.entityDecisions;
  const conflicts = Object.freeze([
    ...occurrenceDecisions.filter((decision) => decision.conflictFields.length > 0).map((decision) => Object.freeze({
      kind: 'occurrence_identity', candidateIds: decision.candidateIds, reasonCodes: decision.reasonCodes,
      fields: decision.conflictFields, decision,
    })),
    ...entityDecisions.filter((decision) => decision.relation === 'review'
      && decision.reasonCodes.some((reason) => reason.endsWith('_conflict'))).map((decision) => Object.freeze({
      kind: 'entity_identity', candidateIds: decision.candidateIds, reasonCodes: decision.reasonCodes, decision,
    })),
  ]);
  const linkCandidates = progress.candidates.filter((candidate) => candidate.depth > 0).map((candidate) => Object.freeze({
    candidateId: candidate.candidateId,
    url: candidate.canonicalUrl,
    depth: candidate.depth,
    sourceRefs: candidate.sourceRefs,
    sourceAuthority: 'not_evaluated',
  }));
  return Object.freeze({
    schema: PRIVATE_DRAFT_SCHEMA,
    status: facts.length > 0 ? 'draft' : 'incomplete',
    completeness: 'incomplete',
    facts: Object.freeze(facts),
    occurrenceCandidates: Object.freeze(occurrenceCandidates),
    entityCandidates: Object.freeze(entityCandidates),
    occurrenceDecisions: Object.freeze(occurrenceDecisions),
    entityDecisions: Object.freeze(entityDecisions),
    transitionLinks: identity.transitionLinks,
    unresolvedTransitions: identity.unresolvedTransitions,
    sources: Object.freeze(sources),
    linkCandidates: Object.freeze(linkCandidates),
    conflicts,
    sourceAuthority: 'not_evaluated',
    rights: 'not_evaluated',
    usage: 'unknown',
    limitations: Object.freeze([...limitations].sort()),
    progress: Object.freeze({
      state: progress.state,
      stopReason: progress.stopReason,
      stopReasons: Object.freeze(progress.stopReasons.map((entry) => entry.reason)),
      completedCandidates: progress.candidates.filter((candidate) => candidate.state === 'completed').length,
      remainingCandidates: progress.candidates.filter((candidate) => candidate.state === 'queued' || candidate.state === 'leased').length,
      transportAttemptAdmissions: progress.counters.transportAttemptAdmissions,
    }),
  });
}

/**
 * Private offline retrieval composition. It accepts only source URLs and app-issued
 * host callbacks; fetched documents and caller-provided extraction/provenance are not inputs.
 */
export async function runPrivateRetrieval(value) {
  const input = snapshotRunInput(value);
  const runConfigHash = digestJson({ runId: input.runId, seeds: input.seeds, limits: input.limits });
  const limitations = new Set([
    'source_authority_not_evaluated', 'rights_not_evaluated', 'billable_usage_unknown', 'provider_and_external_egress_not_measured',
  ]);
  const candidateResults = [];
  const outputFacts = new Map();
  const evidenceIds = new Set();
  const activeHops = new Map();
  const controller = new AbortController();
  const runStartedAt = performance.now();
  let deadlineAtMonotonic = runStartedAt + input.limits.durationMs;
  let deadlineTimer;
  let scope;
  let evidenceScope;
  let runCreated = false;
  let watcherOpen = false;
  let watcherPromise = Promise.resolve();
  let watcherDrained = false;
  let localStopPromise = Promise.resolve();
  let externalAbort = false;
  let stopCause = null;
  let deadlineStopStarted = false;
  let runFailure = null;
  const abortError = () => new RetrievalError(stopCause === 'deadline' ? 'DEADLINE_EXCEEDED' : 'CANCELED');
  const persistStop = (reason) => {
    if (!runCreated) return;
    const cleanup = new AbortController();
    const timer = setTimeout(() => cleanup.abort(), 500);
    const pending = Promise.resolve().then(() => input.frontier.stopRun(scope, input.runId, reason, cleanup.signal))
      .catch(() => {}).finally(() => {
        clearTimeout(timer);
        if (!cleanup.signal.aborted) cleanup.abort();
      });
    localStopPromise = Promise.all([localStopPromise, pending]).then(() => undefined);
  };
  const abortForStop = (reason) => {
    if (stopCause === null) stopCause = reason;
    if (!controller.signal.aborted) controller.abort();
  };
  const triggerDeadline = () => {
    if (stopCause === null) stopCause = 'deadline';
    if (!controller.signal.aborted) controller.abort();
    if (!deadlineStopStarted) {
      deadlineStopStarted = true;
      persistStop('deadline');
    }
  };
  const armDeadline = () => {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    const remainingMs = deadlineAtMonotonic - performance.now();
    if (remainingMs <= 0) {
      triggerDeadline();
      return;
    }
    deadlineTimer = setTimeout(triggerDeadline, Math.ceil(remainingMs));
  };
  const checkDeadline = () => {
    if (performance.now() >= deadlineAtMonotonic) triggerDeadline();
    if (controller.signal.aborted) throw abortError();
  };
  const awaitOperation = async (operation) => {
    checkDeadline();
    return await awaitAbortableOperation(operation, controller.signal, abortError);
  };
  armDeadline();
  const onExternalAbort = () => {
    externalAbort = true;
    if (stopCause === null) stopCause = 'cancelled';
    if (!controller.signal.aborted) controller.abort();
    persistStop('cancelled');
  };
  if (input.signal !== undefined) {
    addAbortListener(input.signal, onExternalAbort);
    if (signalAborted(input.signal)) onExternalAbort();
  }
  try {
    checkDeadline();
    if (controller.signal.aborted) return incompleteResult(input.runId, stopCause === 'deadline' ? 'incomplete' : 'cancelled',
      [stopCause === 'deadline' ? 'deadline_exceeded' : 'cancelled']);
    if (!authorized(input, 'start')) return incompleteResult(input.runId, 'denied', ['authorization_denied']);
    scope = await awaitOperation(() => input.frontier.scopeForAuthenticatedRequest(input.request));
    evidenceScope = await awaitOperation(() => input.evidenceStore.scopeForAuthenticatedRequest(input.request));
    const initial = await awaitOperation(() => {
      const creating = input.frontier.createRun(scope, {
        runId: input.runId,
        seeds: input.seeds,
        limits: input.limits,
      }, controller.signal);
      void Promise.resolve(creating).then(() => {
        runCreated = true;
        if (controller.signal.aborted) persistStop(stopCause === 'deadline' ? 'deadline' : 'cancelled');
      }, () => {});
      return creating;
    });
    if (!Number.isSafeInteger(initial.deadlineAtMs)) throw new RetrievalError('FRONTIER_UNAVAILABLE');
    deadlineAtMonotonic = Math.min(deadlineAtMonotonic,
      performance.now() + Math.max(0, initial.deadlineAtMs - Date.now()));
    armDeadline();
    runCreated = true;
    if (controller.signal.aborted) persistStop(stopCause === 'deadline' ? 'deadline' : 'cancelled');

    watcherOpen = true;
    watcherPromise = (async () => {
      while (watcherOpen) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        if (!watcherOpen) break;
        try {
          const snapshot = await awaitOperation(() => input.frontier.getSnapshot(scope, input.runId, controller.signal));
          if (snapshotHasBlockingStop(snapshot)) {
            const blocking = snapshot.stopReasons.find((entry) => CANCELLATION_REASONS.has(entry.reason));
            if (blocking) abortForStop(blocking.reason);
            break;
          }
        } catch {
          if (controller.signal.aborted) break;
          runFailure = 'frontier_unavailable';
          if (!controller.signal.aborted) controller.abort();
          break;
        }
      }
    })();

    const readActiveSnapshot = async () => {
      checkDeadline();
      const snapshot = await awaitOperation(() => input.frontier.getSnapshot(scope, input.runId, controller.signal));
      if (snapshotHasBlockingStop(snapshot)) {
        const blocking = snapshot.stopReasons.find((entry) => CANCELLATION_REASONS.has(entry.reason));
        if (blocking) abortForStop(blocking.reason);
        throw abortError();
      }
      return snapshot;
    };

    const retainReceipt = (receipt) => {
      for (const evidenceId of receipt.evidenceIds) evidenceIds.add(evidenceId);
      for (const fact of receipt.facts) outputFacts.set(fact.factId, fact);
      for (const limitation of receipt.limitations) limitations.add(limitation);
      const identity = receipt.identity;
      if (identity.entityCandidates.length > 0 || identity.occurrenceCandidates.length > 0
        || identity.transitionLinks.length > 0 || identity.unresolvedTransitions.length > 0) {
        candidateResults.push(identity);
      }
    };

    const recoverDurableReceipts = async () => {
      const snapshot = await readActiveSnapshot();
      const durableCandidates = snapshot.candidates.filter((candidate) =>
        candidate.state === 'completed' || candidate.state === 'leased');
      for (const candidate of durableCandidates) {
        if (!authorized(input, 'candidate')) {
          limitations.add('authorization_revoked');
          runFailure = 'authorization_revoked';
          return;
        }
        let receipt;
        try {
          receipt = await awaitOperation(() => input.evidenceStore.readPrivateRunReceipt(evidenceScope, {
            runId: input.runId,
            configHash: runConfigHash,
            candidate: receiptCandidate(candidate),
          }, input.request, controller.signal));
        } catch (error) {
          const code = stopCause === 'deadline' ? 'DEADLINE_EXCEEDED' : safeFailureCode(error);
          limitations.add(limitationFor(code));
          limitations.add('private_receipt_unavailable');
          runFailure = 'private_receipt_unavailable';
          return;
        }
        if (receipt.state !== 'complete') {
          limitations.add(`private_receipt_${receipt.state}`);
          if (candidate.state === 'leased' && receipt.state !== 'mismatch') {
            const reason = candidate.admittedAttemptCount > 0
              ? 'dispatch_state_unknown' : 'cancelled_before_dispatch';
            limitations.add(reason);
            if (candidate.activeLease?.claimKey && candidate.activeLease?.workerId) {
              try {
                const priorClaim = await awaitOperation(() => input.frontier.claimNext(scope, input.runId, {
                  workerId: candidate.activeLease.workerId,
                  claimKey: candidate.activeLease.claimKey,
                }, controller.signal));
                if (priorClaim.state === 'claimed') {
                  await awaitOperation(() => input.frontier.markUnresolved(scope, input.runId, {
                    leaseToken: priorClaim.leaseToken,
                    reason,
                  }, controller.signal));
                }
              } catch {
                // Keep the explicit uncertainty even if the durable lease cannot be resolved now.
              }
            }
          }
          runFailure = 'private_receipt_unavailable';
          return;
        }
        if (candidate.state === 'completed' && candidate.completionOutcome !== receipt.outcome) {
          limitations.add('private_receipt_completion_mismatch');
          runFailure = 'private_receipt_unavailable';
          return;
        }
        if (candidate.state === 'leased') {
          if (candidate.activeLease?.claimKey !== receipt.claim.claimKey) {
            limitations.add('private_receipt_claim_mismatch');
            runFailure = 'private_receipt_unavailable';
            return;
          }
          const priorClaim = await awaitOperation(() => input.frontier.claimNext(scope, input.runId, {
            workerId: receipt.claim.workerId,
            claimKey: receipt.claim.claimKey,
          }, controller.signal));
          if (priorClaim.state !== 'claimed' && priorClaim.state !== 'completed') {
            limitations.add('private_receipt_completion_unavailable');
            runFailure = 'private_receipt_unavailable';
            return;
          }
          if (priorClaim.leaseToken !== receipt.claim.leaseToken || priorClaim.candidate.candidateId !== candidate.candidateId) {
            limitations.add('private_receipt_claim_mismatch');
            runFailure = 'private_receipt_unavailable';
            return;
          }
          if (priorClaim.state === 'claimed') {
            await awaitOperation(() => input.frontier.completeCandidate(scope, input.runId, {
              leaseToken: receipt.claim.leaseToken,
              completionKey: receipt.completionKey,
              outcome: receipt.outcome,
              suggestions: receipt.suggestions,
            }, controller.signal));
          }
        }
        retainReceipt(receipt);
      }
    };

    await recoverDurableReceipts();

    const processClaim = async (claim) => {
      const candidate = claim.candidate;
      const priorLimitations = new Set(limitations);
      const candidateEvidenceIds = new Set();
      const candidateFacts = [];
      const claimBinding = Object.freeze({
        claimKey: claim.claimKey,
        workerId: claim.workerId,
        leaseToken: claim.leaseToken,
      });
      const completionKey = `complete:${claim.leaseToken}:${randomUUID()}`;
      let snapshot = await readActiveSnapshot();
      const candidateSnapshot = snapshot.candidates.find((item) => item.candidateId === candidate.candidateId);
      if (!candidateSnapshot || candidateSnapshot.canonicalUrl !== candidate.canonicalUrl
        || candidateSnapshot.depth !== candidate.depth) throw new RetrievalError('TRANSPORT_FAILURE');
      const candidateBinding = receiptCandidate(candidateSnapshot);
      const receiptBinding = Object.freeze({
        runId: input.runId,
        configHash: runConfigHash,
        candidate: candidateBinding,
      });
      const observation = snapshot.observations.find((item) => item.targetCandidateId === candidate.candidateId);
      const suppliedUrl = observation?.suppliedUrl;
      if (typeof suppliedUrl !== 'string' || urlHasSensitiveMaterial(suppliedUrl)) {
        throw new PrivateRetrievalError('INVALID_INPUT');
      }
      if (!authorized(input, 'candidate')) {
        abortForStop('access_restricted');
        persistStop('access_restricted');
        throw new RetrievalError('POLICY_DENIED');
      }
      const pendingReceipt = await awaitOperation(() => input.evidenceStore.beginPrivateRunReceipt(evidenceScope, {
        ...receiptBinding,
        claim: claimBinding,
      }, input.request, controller.signal));
      if (pendingReceipt.state !== 'pending' || pendingReceipt.created !== true) {
        const reason = candidateSnapshot.admittedAttemptCount > 0
          ? 'dispatch_state_unknown' : 'cancelled_before_dispatch';
        limitations.add(pendingReceipt.state === 'pending'
          ? 'private_receipt_pending' : 'private_receipt_already_exists');
        limitations.add(reason);
        await awaitOperation(() => input.frontier.markUnresolved(scope, input.runId, {
          leaseToken: claim.leaseToken,
          reason,
        }, controller.signal));
        return;
      }
      const hopRecords = [];
      let previousAttemptKey;
      let completeDocument;
      let selectedOutcome = 'failed';
      let selectedSuggestions = [];
      let selectedResult;
      let pdfRecord;
      let assetRecord;
      let failure = null;
      const stateForHop = (index) => hopRecords[index];
      const checkNoBlockingStop = async () => {
        checkDeadline();
        const current = await awaitOperation(() => input.frontier.getSnapshot(scope, input.runId, controller.signal));
        if (snapshotHasBlockingStop(current)) {
          const blocking = current.stopReasons.find((entry) => CANCELLATION_REASONS.has(entry.reason));
          if (blocking) abortForStop(blocking.reason);
          throw abortError();
        }
      };
      const hooks = {
        async beforeHop({ url, hopIndex }) {
          if (urlHasSensitiveMaterial(url)) throw new RetrievalError('POLICY_DENIED');
          await checkNoBlockingStop();
          const attemptKey = `hop:${claim.leaseToken}:${hopIndex}:${randomUUID()}`;
          const admission = await awaitOperation(() => input.frontier.admitTransportHop(scope, input.runId, {
            leaseToken: claim.leaseToken,
            attemptKey,
            kind: hopIndex === 0 ? 'initial' : 'redirect',
            ...(hopIndex > 0 ? { previousAttemptKey } : {}),
            url,
          }, controller.signal));
          if (admission.state === 'denied') {
            if (admission.reason === 'decoded_budget') {
              abortForStop('budget_denied');
              persistStop('budget_denied');
              limitations.add('decoded_response_budget_exhausted');
              throw new RetrievalError('RESOURCE_LIMIT');
            }
            if (admission.reason === 'attempt_limit') {
              limitations.add('transport_attempt_limit');
              throw new RetrievalError('REQUEST_LIMIT');
            }
            throw new RetrievalError('CANCELED');
          }
          if (admission.state !== 'admitted') {
            // A historical admission is state inspection, never authorization to fetch again.
            limitations.add('transport_state_unknown');
            throw new RetrievalError('CANCELED');
          }
          const record = { attemptKey, url, state: 'reserved', decodeStarted: false, bodyComplete: false };
          hopRecords[hopIndex] = record;
          activeHops.set(attemptKey, record);
          previousAttemptKey = attemptKey;
          await checkNoBlockingStop();
        },
        async onDispatchIntent({ hopIndex }) {
          const record = stateForHop(hopIndex);
          if (!record) throw new RetrievalError('CANCELED');
          await checkNoBlockingStop();
          await awaitOperation(() => input.frontier.markTransportDispatchIntent(scope, input.runId, {
            leaseToken: claim.leaseToken, attemptKey: record.attemptKey,
          }, controller.signal));
          record.state = 'dispatch_intent';
          await checkNoBlockingStop();
        },
        async onResponseHeaders({ hopIndex }) {
          const record = stateForHop(hopIndex);
          if (!record) throw new RetrievalError('CANCELED');
          await checkNoBlockingStop();
          await awaitOperation(() => input.frontier.markTransportResponseReceived(scope, input.runId, {
            leaseToken: claim.leaseToken, attemptKey: record.attemptKey,
          }, controller.signal));
          record.state = 'response_received';
        },
        async onKnownZero({ hopIndex }) {
          const record = stateForHop(hopIndex);
          if (!record || record.decodeStarted || record.bodyComplete) return;
          await awaitOperation(() => input.frontier.settleTransportHopKnownZero(scope, input.runId, {
            leaseToken: claim.leaseToken, attemptKey: record.attemptKey,
          }, controller.signal));
          record.state = 'known_zero';
          activeHops.delete(record.attemptKey);
        },
        async onDecodeStart({ hopIndex }) {
          const record = stateForHop(hopIndex);
          if (!record) throw new RetrievalError('CANCELED');
          record.decodeStarted = true;
        },
        async onBodyComplete({ hopIndex, decodedBytes }) {
          const record = stateForHop(hopIndex);
          if (!record || !record.decodeStarted || record.bodyComplete) throw new RetrievalError('TRANSPORT_FAILURE');
          await awaitOperation(() => input.frontier.settleTransportHopBodyComplete(scope, input.runId, {
            leaseToken: claim.leaseToken, attemptKey: record.attemptKey,
          }, decodedBytes, controller.signal));
          record.bodyComplete = true;
          record.state = 'body_complete';
          activeHops.delete(record.attemptKey);
        },
      };
      try {
        checkDeadline();
        const fetchRemainingMs = Math.floor(deadlineAtMonotonic - performance.now());
        if (fetchRemainingMs < 1) {
          triggerDeadline();
          throw abortError();
        }
        completeDocument = await runWithSafeFetchLifecycle(input.safeFetcher, hooks, {
          decodedTextBytesPerResponse: TEXT_ACCEPTED_BYTES,
          decodedMediaBytesPerResponse: MEDIA_ACCEPTED_BYTES,
          gzipChunkSize: GZIP_CHUNK_BYTES,
          gzipReadableHighWaterMark: GZIP_CHUNK_BYTES,
          gzipWritableHighWaterMark: GZIP_CHUNK_BYTES,
          totalMilliseconds: Math.min(30_000, fetchRemainingMs),
        }, () => SafeFetcher.prototype.fetch.call(input.safeFetcher, suppliedUrl, { signal: controller.signal }));
        const provenance = safeFetchProvenance(completeDocument);
        if (!validateProvenance(completeDocument, provenance, candidate.canonicalUrl, hopRecords)) {
          limitations.add('transport_provenance_unavailable');
          throw new RetrievalError('TRANSPORT_FAILURE');
        }
        if (completeDocument.contentType === 'application/pdf') {
          const retentionHandle = await awaitAbortableHostCallback(input.retentionHandleFor, [input.request, Object.freeze({
            runId: input.runId, sourceUrl: suppliedUrl, canonicalUrl: completeDocument.url,
          })], controller.signal, abortError);
          await checkNoBlockingStop();
          if (!retentionHandle || typeof retentionHandle !== 'object') throw new RetrievalError('POLICY_DENIED');
          const stored = await awaitOperation(() => input.evidenceStore.ingestDerivedPdfEvidence(evidenceScope, {
            sourceUrl: suppliedUrl,
            canonicalUrl: provenance.finalUrl,
            redirectChain: provenance.redirectChain,
            content: completeDocument.bytes,
            contentType: completeDocument.contentType,
            retrievedAt: completeDocument.fetchedAt,
            sourceKind: 'external',
            retentionHandle,
          }, input.request, controller.signal));
          if (stored.outcome === 'stored') {
            pdfRecord = { evidenceId: stored.metadata.evidenceId, role: 'pdf' };
          } else {
            limitations.add(stored.outcome === 'no-text' ? 'pdf_requires_inspection' : 'pdf_derivation_incomplete');
          }
          limitations.add('pdf_identity_extraction_not_supported');
          selectedOutcome = 'no_links';
        } else if (completeDocument.contentType.startsWith('image/')) {
          limitations.add('asset_bytes_not_inspected_or_promoted');
          selectedOutcome = 'failed';
        } else {
          const retentionHandle = await awaitAbortableHostCallback(input.retentionHandleFor, [input.request, Object.freeze({
            runId: input.runId, sourceUrl: suppliedUrl, canonicalUrl: provenance.finalUrl,
          })], controller.signal, abortError);
          await checkNoBlockingStop();
          if (!retentionHandle || typeof retentionHandle !== 'object') throw new RetrievalError('POLICY_DENIED');
          const trustedDocument = Object.freeze({
            url: provenance.finalUrl,
            requestedUrl: suppliedUrl,
            redirectChain: provenance.redirectChain,
            contentType: completeDocument.contentType,
            fetchedAt: completeDocument.fetchedAt,
            redirects: completeDocument.redirects,
            bytes: completeDocument.bytes,
          });
          selectedResult = await awaitOperation(() => composeSourceIdentity({
            sources: [{ document: trustedDocument, retentionHandle }],
            request: input.request,
            evidenceStore: input.evidenceStore,
            signal: controller.signal,
          }));
          const composedSource = selectedResult.sources[0];
          if (composedSource?.evidence?.evidenceId) {
            candidateEvidenceIds.add(composedSource.evidence.evidenceId);
          }
          if (selectedResult.facts.length + outputFacts.size > MAX_SELECTED_FACTS) {
            limitations.add('selected_fact_limit');
            abortForStop('budget_denied');
            persistStop('budget_denied');
            throw new RetrievalError('RESOURCE_LIMIT');
          }
          candidateFacts.push(...selectedResult.facts);
          selectedSuggestions = selectedResult.linkCandidates.map((link) => ({
            url: link.url,
            sourceRefs: [{
              evidenceId: link.sourceRef.evidenceId,
              contentHash: link.sourceRef.contentHash,
              locator: link.sourceRef.locator,
              field: link.sourceRef.field,
              value: link.url,
            }],
          }));
          if (selectedResult.linkCandidatesOmitted > 0) limitations.add('some_link_candidates_omitted_by_policy_or_parser_limit');
          const extraction = composedSource?.extraction;
          if (extraction?.jsRequired === true) limitations.add('dynamic_rendering_required');
          if (extraction?.status === 'PARTIAL' && extraction?.termination !== null) limitations.add('extraction_incomplete');
          if (selectedSuggestions.length > 0) selectedOutcome = 'links_observed';
          else selectedOutcome = 'no_links';
          if (composedSource?.evidence?.evidenceId && composedSource?.extraction?.assetSources?.length > 0) {
            if (completeDocument.redirects !== 0) {
              limitations.add('asset_source_evidence_requires_redirect_free_source');
            } else if (evidenceIds.size < MAX_SELECTED_EVIDENCE) {
              const assetHandle = await awaitAbortableHostCallback(input.retentionHandleFor, [input.request, Object.freeze({
                runId: input.runId, sourceUrl: suppliedUrl, canonicalUrl: provenance.finalUrl, representation: 'asset-source-excerpt',
              })], controller.signal, abortError);
              await checkNoBlockingStop();
              if (!assetHandle || typeof assetHandle !== 'object') throw new RetrievalError('POLICY_DENIED');
              const asset = await awaitOperation(() => input.evidenceStore.ingestAssetSourceEvidence(evidenceScope, {
                document: {
                  url: suppliedUrl,
                  contentType: completeDocument.contentType,
                  bytes: completeDocument.bytes,
                  fetchedAt: completeDocument.fetchedAt,
                  redirects: 0,
                },
                retentionHandle: assetHandle,
              }, input.request, controller.signal));
              if (asset.outcome === 'stored') {
                assetRecord = { evidenceId: asset.metadata.evidenceId, role: 'asset-source-excerpt' };
                candidateEvidenceIds.add(asset.metadata.evidenceId);
              } else {
                limitations.add(`asset_source_${asset.code.toLowerCase()}`);
              }
            } else {
              limitations.add('asset_source_selection_limit');
            }
          }
        }
      } catch (error) {
        failure = error;
        const code = stopCause === 'deadline' ? 'DEADLINE_EXCEEDED' : safeFailureCode(error);
        limitations.add(limitationFor(code));
        if (code === 'DEADLINE_EXCEEDED') {
          triggerDeadline();
        }
        if (code === 'POLICY_DENIED' && !controller.signal.aborted) {
          abortForStop('access_restricted');
          persistStop('access_restricted');
        }
      } finally {
        if (completeDocument?.bytes && ArrayBuffer.isView(completeDocument.bytes)) completeDocument.bytes.fill(0);
        for (const record of hopRecords) {
          if (!record || !activeHops.has(record.attemptKey)) continue;
          try {
            if (record.state === 'reserved') {
              // The beforeHop hook did not complete, so no DNS/socket/body path began.
              if (controller.signal.aborted) {
                await awaitAbortableCleanup((signal) => input.frontier.settleTransportHopKnownZero(scope, input.runId, {
                  leaseToken: claim.leaseToken, attemptKey: record.attemptKey,
                }, signal));
              } else {
                await awaitOperation(() => input.frontier.settleTransportHopKnownZero(scope, input.runId, {
                  leaseToken: claim.leaseToken, attemptKey: record.attemptKey,
                }, controller.signal));
              }
            } else if (record.state === 'dispatch_intent' || record.state === 'response_received') {
              if (controller.signal.aborted) {
                await awaitAbortableCleanup((signal) => input.frontier.markTransportHopUnknown(scope, input.runId, {
                  leaseToken: claim.leaseToken, attemptKey: record.attemptKey,
                }, signal));
              } else {
                await awaitOperation(() => input.frontier.markTransportHopUnknown(scope, input.runId, {
                  leaseToken: claim.leaseToken, attemptKey: record.attemptKey,
                }, controller.signal));
              }
            }
          } catch { /* Persisted full reservation remains conservative when settlement cannot be proven. */ }
          activeHops.delete(record.attemptKey);
        }
      }

      if (controller.signal.aborted) {
        const hasAdmissions = candidate.admittedAttemptCount > 0 || hopRecords.length > 0;
        await awaitAbortableCleanup((signal) => input.frontier.markUnresolved(scope, input.runId, {
          leaseToken: claim.leaseToken,
          reason: hasAdmissions ? 'dispatch_state_unknown' : 'cancelled_before_dispatch',
        }, signal));
        throw abortError();
      }

      if (failure && !completeDocument && failure.code === 'REQUEST_LIMIT' && candidate.admittedAttemptCount === 0) {
        // The durable run limit already records this stop. Leave the lease unresolved rather than invent a completion.
        limitations.add('candidate_not_dispatched_before_attempt_limit');
        return;
      }

      const outcome = failure
        ? (failure.code === 'POLICY_DENIED' ? 'access_restricted' : 'failed')
        : selectedOutcome;
      if (pdfRecord) candidateEvidenceIds.add(pdfRecord.evidenceId);
      if (assetRecord) candidateEvidenceIds.add(assetRecord.evidenceId);
      if (candidateEvidenceIds.size > MAX_SELECTED_EVIDENCE || candidateFacts.length > MAX_SELECTED_FACTS) {
        limitations.add('candidate_receipt_selection_limit');
        throw new RetrievalError('RESOURCE_LIMIT');
      }
      const candidateIdentity = selectedResult?.sources[0]?.evidence?.evidenceId
        ? Object.freeze({
          entityCandidates: selectedResult.entityCandidates,
          occurrenceCandidates: selectedResult.occurrenceCandidates,
          transitionLinks: selectedResult.transitionLinks,
          unresolvedTransitions: selectedResult.unresolvedTransitions,
        })
        : emptyIdentityResult();
      const candidateSuggestions = failure ? [] : selectedSuggestions;
      const evidenceHandles = [];
      for (const evidenceId of candidateEvidenceIds) {
        evidenceHandles.push(await awaitOperation(() => input.evidenceStore.lookupEvidence(evidenceScope, evidenceId, controller.signal)));
      }
      const factHandles = [];
      for (const fact of candidateFacts) {
        factHandles.push(await awaitOperation(() => input.evidenceStore.lookupFact(evidenceScope, fact.factId, controller.signal)));
      }
      const candidateLimitations = [...limitations].filter((value) => !priorLimitations.has(value));
      await awaitOperation(() => input.evidenceStore.finalizePrivateRunReceipt(evidenceScope, {
        ...receiptBinding,
        claim: claimBinding,
        completion: {
          completionKey,
          outcome,
          suggestions: candidateSuggestions,
          limitations: candidateLimitations,
          identity: candidateIdentity,
        },
        selection: { evidence: evidenceHandles, facts: factHandles },
      }, input.request, controller.signal));
      for (const evidenceId of candidateEvidenceIds) evidenceIds.add(evidenceId);
      for (const fact of candidateFacts) outputFacts.set(fact.factId, fact);
      if (selectedResult?.sources[0]?.evidence?.evidenceId) candidateResults.push(candidateIdentity);
      await awaitOperation(() => input.frontier.completeCandidate(scope, input.runId, {
        leaseToken: claim.leaseToken,
        completionKey,
        outcome,
        suggestions: candidateSuggestions,
      }, controller.signal));
    };

    while (!controller.signal.aborted && !runFailure) {
      const current = await readActiveSnapshot();
      stopLimitation(current, limitations);
      if (current.state !== 'active' && current.stopReason !== 'attempt_limit') break;
      if (evidenceIds.size >= MAX_SELECTED_EVIDENCE) {
        limitations.add('selected_evidence_limit');
        break;
      }
      if (!authorized(input, 'candidate')) {
        abortForStop('access_restricted');
        persistStop('access_restricted');
        limitations.add('authorization_revoked');
        break;
      }
      const claim = await awaitOperation(() => input.frontier.claimNext(scope, input.runId, {
        workerId: input.workerId,
        claimKey: `claim:${input.workerId}:${randomUUID()}`,
      }, controller.signal));
      if (claim.state === 'claimed') {
        if (claim.replayed) {
          // A restart may observe old durable claims. Their lease never grants redispatch.
          limitations.add('prior_claim_not_replayed');
          await awaitOperation(() => input.frontier.markUnresolved(scope, input.runId, {
            leaseToken: claim.leaseToken,
            reason: claim.candidate.admittedAttemptCount > 0 ? 'dispatch_state_unknown' : 'cancelled_before_dispatch',
          }, controller.signal));
          continue;
        }
        try { await processClaim(claim); }
        catch (error) {
          const code = stopCause === 'deadline' ? 'DEADLINE_EXCEEDED' : safeFailureCode(error);
          limitations.add(limitationFor(code));
          if (code === 'CANCELED' || code === 'DEADLINE_EXCEEDED' || controller.signal.aborted) {
            await awaitAbortableCleanup((signal) => input.frontier.markUnresolved(scope, input.runId, {
              leaseToken: claim.leaseToken,
              reason: claim.candidate.admittedAttemptCount > 0 ? 'dispatch_state_unknown' : 'cancelled_before_dispatch',
            }, signal));
            break;
          }
          if (code === 'INVALID_INPUT') {
            runFailure = 'invalid_frontier_candidate';
            break;
          }
        }
        continue;
      }
      if (claim.state === 'waiting') {
        limitations.add(claim.reason === 'in_flight_limit' ? 'other_worker_in_flight' : 'frontier_waiting');
      } else if (claim.state === 'stopped' && claim.reason === 'attempt_limit') {
        limitations.add('transport_attempt_limit');
      } else if (claim.state === 'stopped' && !['frontier_exhausted', 'depth_limit', 'fanout_limit'].includes(claim.reason)) {
        limitations.add('frontier_stopped');
      }
      break;
    }

    await awaitOperation(() => localStopPromise);
    const finalSnapshot = await awaitOperation(() => input.frontier.getSnapshot(scope, input.runId, controller.signal));
    stopLimitation(finalSnapshot, limitations);
    if (externalAbort || snapshotHasBlockingStop(finalSnapshot) || controller.signal.aborted) {
      if (stopCause === 'deadline') return incompleteWithProgress(input.runId, finalSnapshot, [...limitations, 'deadline_exceeded']);
      return incompleteResult(input.runId, 'cancelled', [...limitations, 'cancelled']);
    }
    if (runFailure) return incompleteResult(input.runId, 'incomplete', [...limitations, runFailure]);
    const transport = await awaitOperation(() => input.frontier.getTransportProgress(scope, input.runId, controller.signal));
    const hasLeased = finalSnapshot.candidates.some((candidate) => candidate.state === 'leased');
    if (transport.reservedBytes > 0 || hasLeased || finalSnapshot.candidates.some((candidate) => candidate.state === 'unresolved')) {
      limitations.add('transport_state_unknown_or_unresolved_work');
      return incompleteWithProgress(input.runId, finalSnapshot, [...limitations]);
    }
    if (evidenceIds.size === 0) return incompleteWithProgress(input.runId, finalSnapshot, [...limitations]);
    if (evidenceIds.size > MAX_SELECTED_EVIDENCE || outputFacts.size > MAX_SELECTED_FACTS) {
      limitations.add('selected_materialization_limit');
      return incompleteWithProgress(input.runId, finalSnapshot, [...limitations]);
    }
    let identity;
    try { identity = aggregateIdentity(candidateResults); }
    catch {
      limitations.add('aggregate_identity_limit');
      return incompleteWithProgress(input.runId, finalSnapshot, [...limitations]);
    }
    const evidenceHandles = [];
    for (const evidenceId of evidenceIds) {
      evidenceHandles.push(await awaitOperation(() => input.evidenceStore.lookupEvidence(evidenceScope, evidenceId, controller.signal)));
    }
    const factHandles = [];
    for (const factId of outputFacts.keys()) {
      factHandles.push(await awaitOperation(() => input.evidenceStore.lookupFact(evidenceScope, factId, controller.signal)));
    }
    await awaitOperation(() => localStopPromise);
    checkDeadline();
    watcherOpen = false;
    await awaitOperation(() => watcherPromise);
    watcherDrained = true;
    const release = await awaitOperation(() => input.frontier.sealPrivateDraft(scope, input.runId, controller.signal));
    if (release.state !== 'sealed' && release.state !== 'already_sealed') {
      limitations.add(release.reason === 'transport_uncertain' ? 'transport_state_unknown_or_unresolved_work' : 'release_seal_denied');
      return incompleteWithProgress(input.runId, finalSnapshot, [...limitations]);
    }
    if (!authorized(input, 'release')) {
      limitations.add('authorization_revoked');
      return incompleteWithProgress(input.runId, finalSnapshot, [...limitations]);
    }
    const materialized = await awaitOperation(() => input.evidenceStore.materializeSelected(evidenceScope, {
      evidence: evidenceHandles,
      facts: factHandles,
    }, input.request, controller.signal));
    checkDeadline();
    if (controller.signal.aborted || !authorized(input, 'release')) {
      limitations.add(controller.signal.aborted ? 'cancelled' : 'authorization_revoked');
      return incompleteWithProgress(input.runId, finalSnapshot, [...limitations]);
    }
    const actualFacts = new Map(materialized.facts.map((fact) => [fact.factId, fact]));
    if (actualFacts.size !== outputFacts.size || materialized.evidence.length < evidenceIds.size
      || [...outputFacts].some(([factId, fact]) => factFingerprint(actualFacts.get(factId) ?? {}) !== factFingerprint(fact))) {
      limitations.add('final_selected_snapshot_mismatch');
      return incompleteWithProgress(input.runId, finalSnapshot, [...limitations]);
    }
    const actualEvidence = new Set(materialized.evidence.map((item) => item.metadata.evidenceId));
    if ([...evidenceIds].some((id) => !actualEvidence.has(id))) {
      limitations.add('final_selected_snapshot_mismatch');
      return incompleteWithProgress(input.runId, finalSnapshot, [...limitations]);
    }
    const draft = projection(identity, materialized.evidence, materialized.facts, finalSnapshot, limitations);
    return draft;
  } catch (error) {
    const code = stopCause === 'deadline' ? 'DEADLINE_EXCEEDED' : safeFailureCode(error);
    limitations.add(limitationFor(code));
    if (code === 'DEADLINE_EXCEEDED') {
      triggerDeadline();
      await awaitBoundedCleanup(() => localStopPromise);
      return incompleteResult(input.runId, 'incomplete', [...limitations, 'deadline_exceeded']);
    }
    if (code === 'CANCELED' || externalAbort) return incompleteResult(input.runId, 'cancelled', [...limitations, 'cancelled']);
    return incompleteResult(input.runId, 'incomplete', [...limitations]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    watcherOpen = false;
    if (!watcherDrained) void watcherPromise.catch(() => {});
    if (input.signal !== undefined) removeAbortListener(input.signal, onExternalAbort);
  }
}

function incompleteResult(runId, status, limitations) {
  return Object.freeze({
    schema: PRIVATE_DRAFT_SCHEMA,
    runId,
    status,
    completeness: 'incomplete',
    draft: null,
    limitations: Object.freeze([...new Set(limitations)].sort()),
  });
}

function incompleteWithProgress(runId, snapshot, limitations) {
  return Object.freeze({
    schema: PRIVATE_DRAFT_SCHEMA,
    runId,
    status: 'incomplete',
    completeness: 'incomplete',
    draft: null,
    limitations: Object.freeze([...new Set(limitations)].sort()),
    progress: Object.freeze({
      state: snapshot.state,
      stopReason: snapshot.stopReason,
      stopReasons: Object.freeze(snapshot.stopReasons.map((entry) => entry.reason)),
      completedCandidates: snapshot.candidates.filter((candidate) => candidate.state === 'completed').length,
      remainingCandidates: snapshot.candidates.filter((candidate) => candidate.state === 'queued' || candidate.state === 'leased').length,
      transportAttemptAdmissions: snapshot.counters.transportAttemptAdmissions,
    }),
  });
}
