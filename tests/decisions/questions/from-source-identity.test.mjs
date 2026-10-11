import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createEvidenceStore } from '../../../src/evidence/store.mjs';
import { compareOccurrenceIdentity } from '../../../src/discovery/occurrences/identity.mjs';
import { composeSourceIdentity } from '../../../src/discovery/identity/from-extraction.mjs';
import {
  QuestionPreparationError,
  SourceIdentityQuestionPreparationError,
  prepareIdentityQuestionFromComposition
} from '../../../src/decisions/questions/index.mjs';

const QUESTION_ID = 'Q-EI-IDENTITY:v1';

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function eventPage({ city, startDate, status = 'https://schema.org/EventScheduled', name = 'Garden Light Festival' }) {
  const event = {
    '@type': 'Event',
    name,
    series: 'Garden Light Tour',
    edition: '2027',
    startDate,
    endDate: '2027-08-02',
    eventStatus: status,
    location: { name: `Hall ${city}`, address: { addressLocality: city } }
  };
  return Buffer.from(`<!doctype html><script type="application/ld+json">${JSON.stringify(event)}</script>`);
}

function document(bytes, url) {
  return {
    url,
    contentType: 'text/html; charset=utf-8',
    fetchedAt: '2026-10-11T16:00:00.000Z',
    redirects: 0,
    bytes
  };
}

async function createHarness(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ei-question-preparation-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const permits = new WeakMap();
  const createPermit = (tenantId = 'tenant-a', durationMs = 120_000) => {
    const permit = Object.freeze(Object.create(null));
    permits.set(permit, { tenantId, expiresAtMs: Date.now() + durationMs });
    return permit;
  };
  const store = createEvidenceStore({
    directory,
    resolveTenant: (request) => request?.principal?.tenantId,
    resolveKey({ tenantId, purpose, keyId }) {
      const expectedKeyId = `${purpose}-test-v1`;
      if (keyId && keyId !== expectedKeyId) throw new Error('Unexpected test key identifier');
      return { keyId: expectedKeyId, key: createHash('sha256').update(`${tenantId}:${purpose}:test-key`).digest() };
    },
    resolveRetention({ tenantId, kind, nowMs, sourceExpiresAtMs, retentionHandle }) {
      if (kind === 'evidence') {
        const permit = permits.get(retentionHandle);
        if (!permit || permit.tenantId !== tenantId) throw new Error('Invalid test retention permit');
        return { expiresAtMs: permit.expiresAtMs, policyId: 'test-private', policyVersion: '1', accessPolicy: 'tenant_private' };
      }
      return {
        expiresAtMs: sourceExpiresAtMs ?? nowMs + 60_000,
        policyId: 'test-private-fact',
        policyVersion: '1',
        accessPolicy: 'tenant_private'
      };
    },
    authorizePrivateAccess: ({ tenantId, request }) => request?.principal?.tenantId === tenantId && request.allowPrivate === true,
    authorizePrivateAccessCurrent: ({ tenantId, request }) => request?.principal?.tenantId === tenantId && request.allowPrivate === true,
    maxSourceBytes: 2 * 1024 * 1024,
    maxPositionBytes: 64 * 1024,
    maxPositionCount: 128,
    maxStoredPayloadBytes: 512 * 1024,
    maxRetentionMs: 180_000
  });
  return { store, createPermit };
}

async function compose(t, events) {
  const harness = await createHarness(t);
  const request = { principal: { tenantId: 'tenant-a' }, allowPrivate: true };
  const result = await composeSourceIdentity({
    sources: events.map(({ bytes, url }) => ({
      document: document(Buffer.from(bytes), url),
      retentionHandle: harness.createPermit()
    })),
    request,
    evidenceStore: harness.store
  });
  return result;
}

function candidateForCity(composition, city) {
  const candidate = composition.occurrenceCandidates.find((item) => item.facts.city?.some((claim) => claim.value === city));
  assert.ok(candidate, `composer output contains a candidate for ${city}`);
  return candidate;
}

function languageMap(composition, value = 'en') {
  return Object.fromEntries(composition.sources.filter((source) => source.evidence)
    .map((source) => [source.evidence.evidenceId, value]));
}

function prepare(composition, candidateIds, languageByEvidenceId = languageMap(composition)) {
  return prepareIdentityQuestionFromComposition(composition, { candidateIds, languageByEvidenceId });
}

function cloneComposition(composition, patch) {
  return { ...composition, ...patch };
}

function changedCandidate(composition, candidateId, transform) {
  const original = composition.occurrenceCandidates.find((item) => item.candidateId === candidateId);
  assert.ok(original);
  const replacement = transform(original);
  return cloneComposition(composition, {
    occurrenceCandidates: composition.occurrenceCandidates.map((candidate) => candidate.candidateId === candidateId ? replacement : candidate)
  });
}

function selectedQuestion(plan) {
  return plan.questions.find((question) => question.questionId === QUESTION_ID);
}

function assertBlockedPlan(plan, pair) {
  assert.equal(plan.candidateOnly, true);
  assert.equal(plan.readinessStatus, 'blocked');
  assert.equal(plan.executionStatus, 'not_dispatched');
  assert.equal(plan.promotionStatus, 'unpromoted');
  assert.equal(plan.decisionPortContractStatus, 'unavailable');
  assert.equal(plan.authorityScope.sourceOfficialnessGranted, false);
  assert.equal(plan.authorityScope.verifiedFactStatusGranted, false);
  assert.equal(plan.authorityScope.budgetGranted, false);
  assert.equal(plan.authorityScope.promotionGranted, false);
  assert.deepEqual(selectedQuestion(plan).targetBinding.candidateRefs, [...pair].sort());
}

function claimGroupProjection(binding, group) {
  const candidate = binding.selectedCandidates.find((item) => item.candidateId === group.candidateId);
  const unique = new Map();
  for (const claim of candidate.facts) {
    if (!claim.supports.some((support) => support.evidenceId === group.evidenceId && support.contentHash === group.contentHash)) continue;
    const projection = {
      field: claim.field,
      value: claim.value,
      origin: claim.origin,
      ...(claim.precision ? { precision: claim.precision } : {}),
      retentionTags: claim.retentionTags
    };
    unique.set(stableJsonTest(projection), projection);
  }
  return [...unique.values()].sort((left, right) => stableJsonTest(left).localeCompare(stableJsonTest(right), 'en'));
}

function stableJsonTest(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJsonTest).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonTest(value[key])}`).join(',')}}`;
}

function groupCoreFor(group) {
  return {
    candidateId: group.candidateId,
    evidenceId: group.evidenceId,
    contentHash: group.contentHash,
    languageLabel: group.languageLabel,
    claims: group.claims
  };
}

test('prepares the explicitly selected composer pair while retaining date, city, status, and source provenance', async (t) => {
  const leftBytes = eventPage({ city: 'Seattle', startDate: '2027-08-01', status: 'https://schema.org/EventCancelled' });
  const rightBytes = eventPage({ city: 'Vancouver', startDate: '2027-08-01T20:00:00-07:00', status: 'https://schema.org/EventRescheduled' });
  const composition = await compose(t, [
    { bytes: leftBytes, url: 'https://events.example.test/seattle' },
    { bytes: rightBytes, url: 'https://events.example.test/vancouver' }
  ]);
  const left = candidateForCity(composition, 'Seattle');
  const right = candidateForCity(composition, 'Vancouver');
  const pair = [left.candidateId, right.candidateId].sort();
  const result = prepare(composition, [right.candidateId, left.candidateId]);
  const question = selectedQuestion(result.plan);

  assertBlockedPlan(result.plan, pair);
  assert.equal(question.eligible, true);
  assert.ok(question.reasonCodes.length === 0);
  assert.equal(result.plan.preparationStatus, 'prepared');
  assert.equal(result.plan.state.observations.length, 2);
  assert.deepEqual(result.sourceIdentityBinding.candidateIds, pair);
  assert.equal(result.sourceIdentityBinding.questionId, QUESTION_ID);
  assert.equal(result.sourceIdentityBinding.localReviewOnly, true);
  assert.equal(result.sourceIdentityBinding.sourceAuthority, 'not_evaluated');
  assert.equal(result.sourceIdentityBinding.transitionLinks.length, 0);
  assert.deepEqual(result.sourceIdentityBinding.unresolvedTransitions.map(({ transition }) => transition).sort(), ['canceled', 'rescheduled']);
  assert.deepEqual(result.sourceIdentityBinding.comparison.conflictFields, ['city', 'start', 'status', 'venue']);
  assert.equal(result.sourceIdentityBinding.comparison.relation, 'different_occurrence_candidate');
  assert.equal(result.sourceIdentityBinding.observationGroups.length, 2);
  for (const group of result.sourceIdentityBinding.observationGroups) {
    assert.deepEqual(group.claims, claimGroupProjection(result.sourceIdentityBinding, group));
    assert.deepEqual(JSON.parse(group.text), group.claims);
    const expectedReference = `source-identity-${createHash('sha256')
      .update('event-intelligence:source-identity-question-group:v1\0', 'utf8')
      .update(stableJsonTest(groupCoreFor(group)), 'utf8').digest('hex')}`;
    assert.equal(group.observationRef, expectedReference);
    const observation = result.plan.state.observations.find((item) => item.observationRef === group.observationRef);
    assert.ok(observation);
    assert.equal(observation.sourceRef, group.evidenceId);
    assert.equal(observation.candidateRef, group.candidateId);
    assert.equal(observation.text, group.text);
    assert.equal(observation.claimText, group.text);
  }
  assert.ok(result.sourceIdentityBinding.observationGroups.every((group) => group.claims.some((claim) => claim.field === 'city')));

  const cityGroup = result.sourceIdentityBinding.observationGroups.find((group) => group.claims.some((claim) => claim.field === 'city'));
  const droppedCity = { ...cityGroup, claims: cityGroup.claims.filter((claim) => claim.field !== 'city') };
  assert.notDeepEqual(droppedCity.claims, claimGroupProjection(result.sourceIdentityBinding, droppedCity),
    'cross-checking the group against the immutable per-field support map detects a dropped critical claim');
  const droppedCityReference = `source-identity-${createHash('sha256')
    .update('event-intelligence:source-identity-question-group:v1\0', 'utf8')
    .update(stableJsonTest(groupCoreFor(droppedCity)), 'utf8').digest('hex')}`;
  assert.notEqual(droppedCityReference, droppedCity.observationRef);
  const droppedSupportMap = {
    ...result.sourceIdentityBinding,
    selectedCandidates: result.sourceIdentityBinding.selectedCandidates.map((candidate) => candidate.candidateId === cityGroup.candidateId
      ? { ...candidate, facts: candidate.facts.map((claim) => claim.field === 'city' ? { ...claim, supports: [] } : claim) }
      : candidate)
  };
  assert.notDeepEqual(cityGroup.claims, claimGroupProjection(droppedSupportMap, cityGroup),
    'cross-checking group text against the immutable support map detects a dropped critical source reference');

  const dateClaims = result.sourceIdentityBinding.selectedCandidates.flatMap((candidate) => candidate.facts.filter((claim) => claim.field === 'start'));
  assert.deepEqual(dateClaims.map((claim) => claim.precision).sort(), ['date', 'instant']);
  const cityClaims = result.sourceIdentityBinding.selectedCandidates.flatMap((candidate) => candidate.facts.filter((claim) => claim.field === 'city'));
  assert.deepEqual(cityClaims.map((claim) => claim.value).sort(), ['Seattle', 'Vancouver']);
  assert.ok(result.plan.preservedCriticalEvidence.some((item) => item.tags.includes('date')));
  assert.ok(result.plan.preservedCriticalEvidence.some((item) => item.tags.includes('tour_city')));
  assert.ok(result.plan.preservedCriticalEvidence.some((item) => item.tags.includes('cancellation')));
  assert.ok(result.plan.preservedCriticalEvidence.some((item) => item.tags.includes('reschedule')));
  assert.equal(result.sourceIdentityBinding.bindingHashes.sourceEvidenceHash, result.plan.sourceEvidenceHash);
  assert.equal(result.sourceIdentityBinding.bindingHashes.targetBindingHash, question.targetBindingHash);
  assert.equal(result.sourceIdentityBinding.bindingHashes.targetStateHash, question.targetStateHash);
  assert.equal(result.sourceIdentityBinding.bindingHashes.questionInstanceHash, question.questionInstanceHash);
  assert.equal(result.sourceIdentityBinding.bindingHashes.planHash, result.plan.planHash);
  assert.match(result.sourceIdentityBinding.digest, /^[a-f0-9]{64}$/);
  assert.ok(result.sourceIdentityBinding.utf8Bytes <= result.sourceIdentityBinding.limits.maxUtf8Bytes);
  assert.ok(Object.isFrozen(result.sourceIdentityBinding));
  assert.ok(Object.isFrozen(result.sourceIdentityBinding.selectedCandidates[0].facts));
});

test('pair order, support order, and caller-language map order do not change the prepared hashes', async (t) => {
  const composition = await compose(t, [
    { bytes: eventPage({ city: 'Seattle', startDate: '2027-08-01' }), url: 'https://events.example.test/seattle' },
    { bytes: eventPage({ city: 'Vancouver', startDate: '2027-08-02' }), url: 'https://events.example.test/vancouver' }
  ]);
  const left = candidateForCity(composition, 'Seattle');
  const right = candidateForCity(composition, 'Vancouver');
  const pair = [left.candidateId, right.candidateId].sort();
  const language = languageMap(composition);
  const reversedLanguage = Object.fromEntries(Object.entries(language).reverse());
  const baseline = prepare(composition, pair, language);
  const reversedPair = prepare(composition, [...pair].reverse(), reversedLanguage);
  assert.equal(reversedPair.plan.planHash, baseline.plan.planHash);
  assert.equal(reversedPair.sourceIdentityBinding.digest, baseline.sourceIdentityBinding.digest);

  const titleClaim = left.facts.title[0];
  const otherTitleSupport = right.facts.title[0].supports[0];
  assert.equal(titleClaim.value, otherTitleSupport.value);
  const augmented = { ...titleClaim, supports: [titleClaim.supports[0], otherTitleSupport] };
  const leftWithTwoSupports = {
    ...left,
    facts: { ...left.facts, title: [augmented, ...left.facts.title.slice(1)] }
  };
  const rightUnchanged = right;
  const pairDecision = compareOccurrenceIdentity(
    pair[0] === left.candidateId ? leftWithTwoSupports : rightUnchanged,
    pair[1] === right.candidateId ? rightUnchanged : leftWithTwoSupports
  );
  const supportOrderA = cloneComposition(composition, {
    occurrenceCandidates: composition.occurrenceCandidates.map((candidate) => candidate.candidateId === left.candidateId ? leftWithTwoSupports : candidate),
    occurrenceDecisions: [pairDecision]
  });
  const reversedSupports = { ...augmented, supports: [...augmented.supports].reverse() };
  const leftReverse = {
    ...left,
    facts: { ...left.facts, title: [reversedSupports, ...left.facts.title.slice(1)] }
  };
  const reverseDecision = compareOccurrenceIdentity(
    pair[0] === left.candidateId ? leftReverse : rightUnchanged,
    pair[1] === right.candidateId ? rightUnchanged : leftReverse
  );
  const supportOrderB = cloneComposition(composition, {
    occurrenceCandidates: composition.occurrenceCandidates.map((candidate) => candidate.candidateId === left.candidateId ? leftReverse : candidate),
    occurrenceDecisions: [reverseDecision]
  });
  const first = prepare(supportOrderA, pair, language);
  const second = prepare(supportOrderB, pair, language);
  assert.equal(first.plan.planHash, second.plan.planHash);
  assert.equal(first.sourceIdentityBinding.digest, second.sourceIdentityBinding.digest);
  assert.equal(first.sourceIdentityBinding.selectedCandidates.find((candidate) => candidate.candidateId === left.candidateId)
    .facts.find((claim) => claim.field === 'title').supports.length, 2);
});

test('equal-byte evidence remains distinct and is marked duplicate rather than independent corroboration', async (t) => {
  const bytes = eventPage({ city: 'Portland', startDate: '2027-08-01' });
  const composition = await compose(t, [
    { bytes, url: 'https://one.example.test/event' },
    { bytes, url: 'https://two.example.test/event' }
  ]);
  const pair = composition.occurrenceCandidates.map((candidate) => candidate.candidateId).sort();
  const result = prepare(composition, pair);
  const supports = result.sourceIdentityBinding.selectedCandidates.flatMap((candidate) => candidate.facts.flatMap((claim) => claim.supports));
  const fullHash = digest(bytes);

  assert.equal(new Set(supports.map((support) => support.evidenceId)).size, 2);
  assert.ok(supports.every((support) => support.contentHash === fullHash));
  assert.equal(new Set(supports.map((support) => support.duplicateGroupId)).size, 1);
  assert.deepEqual(result.sourceIdentityBinding.comparison.duplicateContentHashes, [fullHash]);
  assert.equal(result.plan.authorityScope.independentVerificationGranted, false);
  assert.ok(!('independence' in supports[0]));
  assertBlockedPlan(result.plan, pair);
});

test('missing language is unknown and known non-English language keeps review behavior', async (t) => {
  const composition = await compose(t, [
    { bytes: eventPage({ city: 'Seattle', startDate: '2027-08-01' }), url: 'https://events.example.test/seattle' },
    { bytes: eventPage({ city: 'Vancouver', startDate: '2027-08-02' }), url: 'https://events.example.test/vancouver' }
  ]);
  const pair = [candidateForCity(composition, 'Seattle').candidateId, candidateForCity(composition, 'Vancouver').candidateId];
  const missing = prepare(composition, pair, {});
  assert.equal(selectedQuestion(missing.plan).eligible, false);
  assert.ok(selectedQuestion(missing.plan).reasonCodes.includes('language_unknown'));
  assertBlockedPlan(missing.plan, pair);

  const nonEnglish = prepare(composition, pair, languageMap(composition, 'fr'));
  assert.equal(selectedQuestion(nonEnglish.plan).eligible, true);
  assert.equal(selectedQuestion(nonEnglish.plan).reviewRequired, true);
  assert.ok(selectedQuestion(nonEnglish.plan).reviewReasons.includes('non_english_or_multilingual_input_requires_review'));
  assert.ok(nonEnglish.sourceIdentityBinding.selectedCandidates.flatMap((candidate) => candidate.facts)
    .flatMap((claim) => claim.supports).every((support) => support.languageLabel === 'fr'));
});

test('missing, altered, cross-composition, malformed, customer-supplied, and unknown references fail closed', async (t) => {
  const composition = await compose(t, [
    { bytes: eventPage({ city: 'Seattle', startDate: '2027-08-01' }), url: 'https://events.example.test/seattle' },
    { bytes: eventPage({ city: 'Vancouver', startDate: '2027-08-02' }), url: 'https://events.example.test/vancouver' }
  ]);
  const left = candidateForCity(composition, 'Seattle');
  const right = candidateForCity(composition, 'Vancouver');
  const pair = [left.candidateId, right.candidateId];
  const firstClaim = left.facts.title[0];
  const reject = (value, ids = pair) => assert.throws(() => prepare(value, ids, {}), SourceIdentityQuestionPreparationError);

  reject(composition, [left.candidateId, left.candidateId]);
  reject(composition, [left.candidateId, 'event-unknown']);
  reject(changedCandidate(composition, left.candidateId, (candidate) => ({ ...candidate, facts: { ...candidate.facts, title: [{ ...firstClaim, supports: [{ ...firstClaim.supports[0], evidenceId: '00000000-0000-4000-8000-000000000000' }] }] } })));
  reject(changedCandidate(composition, left.candidateId, (candidate) => ({ ...candidate, facts: { ...candidate.facts, title: [{ ...firstClaim, supports: [{ ...firstClaim.supports[0], contentHash: '0'.repeat(64) }] }] } })));
  reject(changedCandidate(composition, left.candidateId, (candidate) => ({ ...candidate, facts: { ...candidate.facts, title: [{ ...firstClaim, supports: [{ ...firstClaim.supports[0], field: 'startDate' }] }] } })));
  reject(changedCandidate(composition, left.candidateId, (candidate) => ({ ...candidate, facts: { ...candidate.facts, title: [{ ...firstClaim, value: 'Changed title' }] } })));
  reject(changedCandidate(composition, left.candidateId, (candidate) => ({ ...candidate, facts: { ...candidate.facts, title: [{ ...firstClaim, origin: 'customer_supplied' }] } })));
  reject(changedCandidate(composition, left.candidateId, (candidate) => ({
    ...candidate,
    facts: { ...candidate.facts, title: [{ ...firstClaim, supports: [{ ...firstClaim.supports[0], locator: { kind: 'text-range', startByte: 0, endByte: 512 * 1024 + 1 } }] }] }
  })));

  const missingSummary = cloneComposition(composition, {
    sources: composition.sources.map((source) => source.evidence?.evidenceId === firstClaim.supports[0].evidenceId
      ? { ...source, evidence: null }
      : source)
  });
  reject(missingSummary);
  const noAuthority = { ...composition, tenantId: 'tenant-a', sourceAuthority: 'official' };
  reject(noAuthority);
  reject(cloneComposition(composition, { transitionLinks: [{}] }));
  assert.throws(() => prepare(composition, pair, { [firstClaim.supports[0].evidenceId]: 'en\ud800' }), SourceIdentityQuestionPreparationError);
  assert.throws(() => prepare(composition, pair, Object.defineProperty({}, 'candidateIds', { enumerable: true, get() { throw new Error('getter must not run'); } })), SourceIdentityQuestionPreparationError);

  let proxyTrapCount = 0;
  const throwingTraps = {
    get() { proxyTrapCount += 1; throw new Error('get trap must not run'); },
    getPrototypeOf() { proxyTrapCount += 1; throw new Error('prototype trap must not run'); },
    ownKeys() { proxyTrapCount += 1; throw new Error('ownKeys trap must not run'); },
    getOwnPropertyDescriptor() { proxyTrapCount += 1; throw new Error('descriptor trap must not run'); }
  };
  const trapped = new Proxy(composition, throwingTraps);
  reject(trapped);
  const nestedRecordProxy = new Proxy(composition.sources[0], throwingTraps);
  reject(cloneComposition(composition, {
    sources: composition.sources.map((source, index) => index === 0 ? nestedRecordProxy : source)
  }));
  const nestedArrayProxy = new Proxy(composition.occurrenceCandidates, throwingTraps);
  reject(cloneComposition(composition, { occurrenceCandidates: nestedArrayProxy }));
  const revoked = Proxy.revocable(composition.occurrenceCandidates[0], {});
  revoked.revoke();
  reject(cloneComposition(composition, {
    occurrenceCandidates: [revoked.proxy, ...composition.occurrenceCandidates.slice(1)]
  }));
  assert.equal(proxyTrapCount, 0);
});

test('language metadata is bounded at eight source IDs before descriptor copying', async (t) => {
  const composition = await compose(t, [
    { bytes: eventPage({ city: 'Seattle', startDate: '2027-08-01' }), url: 'https://events.example.test/seattle' },
    { bytes: eventPage({ city: 'Vancouver', startDate: '2027-08-02' }), url: 'https://events.example.test/vancouver' }
  ]);
  const pair = [candidateForCity(composition, 'Seattle').candidateId, candidateForCity(composition, 'Vancouver').candidateId];
  const languageByEvidenceId = Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`evidence-extra-${index}`, 'en']));
  assert.throws(() => prepare(composition, pair, languageByEvidenceId), (error) => {
    assert.ok(error instanceof SourceIdentityQuestionPreparationError);
    assert.equal(error.code, 'RESOURCE_LIMIT_EXCEEDED');
    return true;
  });
});

test('expired-looking retrieval metadata remains provenance and does not claim current authorization', async (t) => {
  const composition = await compose(t, [
    { bytes: eventPage({ city: 'Seattle', startDate: '2027-08-01' }), url: 'https://events.example.test/seattle' },
    { bytes: eventPage({ city: 'Vancouver', startDate: '2027-08-02' }), url: 'https://events.example.test/vancouver' }
  ]);
  const pair = [candidateForCity(composition, 'Seattle').candidateId, candidateForCity(composition, 'Vancouver').candidateId];
  const evidenceId = composition.occurrenceCandidates.find((candidate) => candidate.candidateId === pair[0]).facts.title[0].supports[0].evidenceId;
  const stale = cloneComposition(composition, {
    sources: composition.sources.map((source) => source.evidence?.evidenceId === evidenceId
      ? { ...source, evidence: { ...source.evidence, expiresAt: '2000-01-01T00:00:00.000Z' } }
      : source)
  });
  const result = prepare(stale, pair);
  const summary = result.sourceIdentityBinding.sourceEvidence.find((item) => item.evidenceId === evidenceId);
  assert.equal(summary.expiresAt, '2000-01-01T00:00:00.000Z');
  assert.equal(result.plan.readinessStatus, 'blocked');
  assert.equal(result.sourceIdentityBinding.sourceAuthority, 'not_evaluated');
});

function syntheticSupport(evidence, pointer, value) {
  return {
    evidenceId: evidence.evidenceId,
    contentHash: evidence.contentHash,
    locator: { kind: 'json-pointer', pointer },
    field: 'name',
    value
  };
}

function syntheticPairComposition(composition, pair, { perCandidate = 16, pointerBytes = 8, valueBytes = 0, extraSeries = false } = {}) {
  const byId = new Map(composition.occurrenceCandidates.map((candidate) => [candidate.candidateId, candidate]));
  const summaries = composition.sources.map((source) => source.evidence).filter(Boolean);
  const candidates = pair.map((candidateId, candidateIndex) => {
    const summary = summaries.find((item) => item.evidenceId === byId.get(candidateId).facts.title[0].supports[0].evidenceId);
    const titleCount = perCandidate;
    const title = Array.from({ length: titleCount }, (_, index) => {
      const label = `Title ${candidateIndex}-${index}`;
      const value = valueBytes ? label.padEnd(valueBytes, 'x') : label;
      return {
      value,
      origin: 'sourced',
      supports: [syntheticSupport(summary, `/${'p'.repeat(pointerBytes - 1)}${index}`, value)]
    };
    });
    const facts = { title };
    if (extraSeries && candidateIndex === 0) {
      facts.series = [{
        value: 'Garden Light Tour',
        origin: 'sourced',
        supports: [
          {
            evidenceId: summary.evidenceId,
            contentHash: summary.contentHash,
            locator: { kind: 'json-pointer', pointer: '/series' },
            field: 'series',
            value: 'Garden Light Tour'
          }
        ]
      }];
    }
    return { schema: 'ei-occurrence-observation-internal/v1', candidateId, facts };
  });
  const decision = compareOccurrenceIdentity(candidates[0], candidates[1]);
  return cloneComposition(composition, {
    occurrenceCandidates: composition.occurrenceCandidates.map((candidate) => candidates.find((item) => item.candidateId === candidate.candidateId) ?? candidate),
    occurrenceDecisions: [decision]
  });
}

test('groups 32 supported claims by their exact candidate and evidence identity without treating them as independent sources', async (t) => {
  const composition = await compose(t, [
    { bytes: eventPage({ city: 'Seattle', startDate: '2027-08-01' }), url: 'https://events.example.test/seattle' },
    { bytes: eventPage({ city: 'Vancouver', startDate: '2027-08-02' }), url: 'https://events.example.test/vancouver' }
  ]);
  const pair = [candidateForCity(composition, 'Seattle').candidateId, candidateForCity(composition, 'Vancouver').candidateId].sort();
  const atCap = syntheticPairComposition(composition, pair);
  const result = prepare(atCap, pair);
  assert.equal(result.plan.state.observations.length, 2);
  assert.equal(result.sourceIdentityBinding.selectedCandidates.reduce((sum, candidate) => sum + candidate.facts.length, 0), 32);
  assert.equal(result.sourceIdentityBinding.observationGroups.length, 2);
  assert.equal(result.sourceIdentityBinding.limits.maxObservations, 32);
  assertBlockedPlan(result.plan, pair);

  const over = syntheticPairComposition(composition, pair, { perCandidate: 9, valueBytes: 512 });
  assert.throws(() => prepare(over, pair), (error) => {
    assert.ok(error instanceof SourceIdentityQuestionPreparationError);
    assert.equal(error.code, 'RESOURCE_LIMIT_EXCEEDED');
    return true;
  });
});

test('rejects the first selected projection whose immutable sidecar exceeds 65,536 UTF-8 bytes', async (t) => {
  const composition = await compose(t, [
    { bytes: eventPage({ city: 'Seattle', startDate: '2027-08-01' }), url: 'https://events.example.test/seattle' },
    { bytes: eventPage({ city: 'Vancouver', startDate: '2027-08-02' }), url: 'https://events.example.test/vancouver' }
  ]);
  const pair = [candidateForCity(composition, 'Seattle').candidateId, candidateForCity(composition, 'Vancouver').candidateId].sort();
  const oversized = syntheticPairComposition(composition, pair, { perCandidate: 16, pointerBytes: 510 });
  assert.throws(() => prepare(oversized, pair), (error) => {
    assert.ok(error instanceof SourceIdentityQuestionPreparationError);
    assert.equal(error.code, 'RESOURCE_LIMIT_EXCEEDED');
    return true;
  });
});

test('rejects a sensitive source value through the maintained question parser', async (t) => {
  const composition = await compose(t, [
    { bytes: eventPage({ city: 'Seattle', startDate: '2027-08-01', name: 'password=abcdefghijklmnop' }), url: 'https://events.example.test/seattle' },
    { bytes: eventPage({ city: 'Vancouver', startDate: '2027-08-02' }), url: 'https://events.example.test/vancouver' }
  ]);
  const pair = composition.occurrenceCandidates.map((candidate) => candidate.candidateId).sort();
  assert.throws(() => prepare(composition, pair), (error) => {
    assert.ok(error instanceof QuestionPreparationError);
    assert.equal(error.code, 'SENSITIVE_CONTENT');
    return true;
  });
});
