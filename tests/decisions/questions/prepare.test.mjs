import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IDENTITY_DEPENDENT_QUESTION_IDS,
  INDEPENDENT_QUESTION_IDS,
  QuestionPreparationError,
  prepareDependentQuestions,
  prepareIndependentQuestions
} from '../../../src/decisions/questions/index.mjs';

function source(observationRef, sourceRef, candidateRef, text, extra = {}) {
  return {
    observationRef,
    kind: 'source_text',
    sourceRef,
    candidateRef,
    language: 'en',
    text,
    ...extra
  };
}

function claimEvidence() {
  return {
    observationRef: 'obs-claim-date',
    kind: 'claim_evidence_text',
    sourceRef: 'source-a',
    candidateRef: 'candidate-a',
    fieldRef: 'event.date',
    claimText: '2026-11-12 at 19:30 America/New_York',
    language: 'en',
    text: 'The listing says November 12 at 7:30 PM Eastern.',
    retentionTags: ['date', 'time_zone']
  };
}

function visual() {
  return {
    observationRef: 'obs-visual-role',
    kind: 'structured_visual_observation',
    sourceRef: 'source-a',
    language: 'en',
    text: 'A structured observer describes the visible asset as event poster artwork.',
    visual: {
      observerRef: 'observer-1',
      observerModel: 'vision-model-1',
      regionRef: 'region-1',
      assetHash: 'a'.repeat(64),
      uncertainty: 'low'
    }
  };
}

function fullIndependentEvidence() {
  return [
    source('obs-source-a', 'source-a', 'candidate-a', 'The event page lists November 12 at 7 PM in Seattle, at the original venue.', {
      retentionTags: ['event_identity', 'date', 'time_zone']
    }),
    source('obs-source-b', 'source-b', 'candidate-b', 'A separate page lists November 13 at 8 PM in Vancouver, a changed venue, and a new annual edition.', {
      retentionTags: ['date', 'time_zone', 'venue', 'tour_city', 'annual_edition', 'cancellation', 'reschedule']
    }),
    claimEvidence(),
    visual()
  ];
}

function completion(plan, observationRef = 'obs-identity-completed') {
  return {
    observationRef,
    kind: 'completed_question_observation',
    language: 'en',
    text: 'Caller asserts the identity stage completed; this is not a provider result or authenticated decision.',
    completion: {
      questionId: 'Q-EI-IDENTITY:v1',
      predecessorPlanHash: plan.planHash
    }
  };
}

function question(plan, id) {
  return plan.questions.find((item) => item.questionId === id);
}

function rejectsWithCode(fn, code) {
  assert.throws(fn, (error) => error instanceof QuestionPreparationError && error.code === code);
}

test('empty, singleton, unknown-language, and multilingual observations have bounded explicit eligibility', () => {
  const empty = prepareIndependentQuestions([]);
  assert.equal(empty.preparationStatus, 'blocked');
  assert.equal(empty.readinessStatus, 'blocked');
  assert.ok(empty.readinessBlockers.includes('no_observations_supplied'));
  assert.deepEqual(empty.eligibleQuestionIds, []);
  assert.deepEqual(empty.requiredQuestionIds, INDEPENDENT_QUESTION_IDS);

  const singleton = prepareIndependentQuestions([source('obs-one', 'source-one', 'candidate-one', 'A source describes one event.')]);
  assert.equal(question(singleton, 'Q-EI-SOURCE-TYPE:v1').eligible, true);
  assert.equal(question(singleton, 'Q-EI-RELEVANCE:v1').eligible, true);
  assert.equal(question(singleton, 'Q-EI-INJECTION:v1').eligible, true);
  assert.equal(question(singleton, 'Q-EI-IDENTITY:v1').eligible, false);
  assert.ok(question(singleton, 'Q-EI-IDENTITY:v1').reasonCodes.includes('fewer_than_two_occurrence_candidates'));
  assert.equal(question(singleton, 'Q-EI-BRAND-ROLE:v1').eligible, false);

  const unknownLanguage = prepareIndependentQuestions([
    source('obs-und', 'source-und', 'candidate-und', 'An observation without a language decision.', { language: 'und' })
  ]);
  assert.ok(question(unknownLanguage, 'Q-EI-RELEVANCE:v1').reasonCodes.includes('language_unknown'));
  assert.ok(question(unknownLanguage, 'Q-EI-INJECTION:v1').reasonCodes.includes('language_unknown'));

  const multilingual = prepareIndependentQuestions([
    source('obs-fr', 'source-fr', 'candidate-fr', 'Le lieu de l’événement est la salle principale.', { language: 'fr' })
  ]);
  assert.equal(question(multilingual, 'Q-EI-RELEVANCE:v1').eligible, true);
  assert.equal(question(multilingual, 'Q-EI-RELEVANCE:v1').reviewRequired, true);
  assert.ok(question(multilingual, 'Q-EI-RELEVANCE:v1').reviewReasons.includes('non_english_or_multilingual_input_requires_review'));
});

test('permutations yield identical immutable plans and all critical evidence remains available', () => {
  const evidence = fullIndependentEvidence();
  const plan = prepareIndependentQuestions(evidence);
  const permutation = prepareIndependentQuestions([...evidence].reverse());
  assert.deepEqual(plan.eligibleQuestionIds, INDEPENDENT_QUESTION_IDS);
  assert.equal(plan.planHash, permutation.planHash);
  assert.equal(plan.stateHash, permutation.stateHash);
  assert.deepEqual(plan.state.observations.map((record) => record.observationRef), [
    'obs-claim-date', 'obs-source-a', 'obs-source-b', 'obs-visual-role'
  ]);
  assert.equal(plan.state.observations.find((record) => record.observationRef === 'obs-source-b').text,
    'A separate page lists November 13 at 8 PM in Vancouver, a changed venue, and a new annual edition.');
  assert.equal(plan.state.observations.find((record) => record.observationRef === 'obs-source-a').text,
    'The event page lists November 12 at 7 PM in Seattle, at the original venue.');
  assert.deepEqual(plan.preservedCriticalEvidence.map((record) => record.observationRef), [
    'obs-claim-date', 'obs-source-a', 'obs-source-b'
  ]);
  assert.deepEqual(plan.preservedCriticalEvidence.at(-1).tags, ['annual_edition', 'cancellation', 'date', 'reschedule', 'time_zone', 'tour_city', 'venue']);
  assert.ok(plan.state.observations.every((record) => /^[a-f0-9]{64}$/.test(record.textHash)));
  assert.ok(plan.state.observations.every((record) => /^[a-f0-9]{64}$/.test(record.recordHash)));
  assert.ok(Object.isFrozen(plan));
  assert.ok(Object.isFrozen(plan.state));
  assert.ok(Object.isFrozen(plan.state.observations));
  assert.ok(Object.isFrozen(plan.state.observations[0]));

  evidence[0].text = 'Changed after preparation.';
  assert.equal(plan.state.observations.find((record) => record.observationRef === 'obs-source-a').text,
    'The event page lists November 12 at 7 PM in Seattle, at the original venue.');
  assert.throws(() => { plan.state.observations[0].text = 'mutated'; }, TypeError);
  assert.equal(plan.executionStatus, 'not_dispatched');
  assert.equal(plan.promotionStatus, 'unpromoted');
  assert.equal(plan.readinessStatus, 'blocked');
  assert.ok(plan.readinessBlockers.includes('accepted_injected_decision_port_contract_missing'));
  assert.equal(plan.limits.byteCapsAreTokenizerGuarantee, false);
  assert.equal(plan.limits.tokenCountProven, false);
});

test('dependent questions require an immutable later snapshot tied to completed identity input', () => {
  const base = fullIndependentEvidence();
  const identityPlan = prepareIndependentQuestions(base);
  assert.equal(question(identityPlan, 'Q-EI-IDENTITY:v1').eligible, true);

  const dependent = prepareDependentQuestions([...base, completion(identityPlan)], identityPlan);
  assert.deepEqual(dependent.requiredQuestionIds, IDENTITY_DEPENDENT_QUESTION_IDS);
  assert.deepEqual(dependent.eligibleQuestionIds, IDENTITY_DEPENDENT_QUESTION_IDS);
  assert.notEqual(dependent.stateHash, identityPlan.stateHash);
  assert.notEqual(dependent.planHash, identityPlan.planHash);
  assert.equal(dependent.sourceEvidenceHash, identityPlan.sourceEvidenceHash);
  assert.equal(dependent.state.predecessor.predecessorPlanHash, identityPlan.planHash);
  assert.equal(dependent.state.predecessor.predecessorStateHash, identityPlan.stateHash);
  assert.equal(dependent.state.predecessor.completionAssertion, 'caller_asserted_for_preparation_only');
  assert.equal(dependent.executionStatus, 'not_dispatched');
  assert.equal(dependent.readinessStatus, 'blocked');

  const missingPredecessor = prepareDependentQuestions([...base, completion(identityPlan)], null);
  assert.deepEqual(missingPredecessor.eligibleQuestionIds, []);
  assert.ok(missingPredecessor.readinessBlockers.includes('completed_identity_observation_required'));
  assert.equal(question(missingPredecessor, 'Q-EI-FACT-SUPPORT:v1').eligible, false);

  const duplicateCompletion = prepareDependentQuestions([
    ...base,
    completion(identityPlan, 'obs-identity-one'),
    completion(identityPlan, 'obs-identity-two')
  ], identityPlan);
  assert.ok(duplicateCompletion.readinessBlockers.includes('exactly_one_completed_identity_observation_required'));
  assert.equal(question(duplicateCompletion, 'Q-EI-CONFLICT:v1').eligible, false);

  const changedBase = [...base, source('obs-extra', 'source-extra', 'candidate-extra', 'Evidence changed after identity preparation.')];
  const changed = prepareDependentQuestions([...changedBase, completion(identityPlan)], identityPlan);
  assert.ok(changed.readinessBlockers.includes('source_evidence_snapshot_changed'));
  assert.deepEqual(changed.eligibleQuestionIds, []);
});

test('input accessors, proxies, malformed Unicode, credentials, and invalid records fail closed', () => {
  const accessor = {
    observationRef: 'obs-accessor', kind: 'source_text', sourceRef: 'source-a', language: 'en'
  };
  Object.defineProperty(accessor, 'text', { enumerable: true, get() { throw new Error('must not run'); } });
  rejectsWithCode(() => prepareIndependentQuestions([accessor]), 'INVALID_INPUT');

  const proxy = new Proxy(source('obs-proxy', 'source-a', 'candidate-a', 'Valid-looking text.'), {
    getPrototypeOf() { throw new Error('blocked proxy trap'); }
  });
  rejectsWithCode(() => prepareIndependentQuestions([proxy]), 'INVALID_INPUT');

  rejectsWithCode(() => prepareIndependentQuestions([
    source('obs-surrogate', 'source-a', 'candidate-a', '\ud800')
  ]), 'INVALID_INPUT');
  rejectsWithCode(() => prepareIndependentQuestions([
    source('obs-secret', 'source-a', 'candidate-a', 'Contact us with api_key=abcdef0123456789 for access.')
  ]), 'SENSITIVE_CONTENT');
  rejectsWithCode(() => prepareIndependentQuestions([
    source('obs-unknown-key', 'source-a', 'candidate-a', 'Text.', { extra: 'unrecognized field' })
  ]), 'INVALID_INPUT');
  rejectsWithCode(() => prepareIndependentQuestions([
    source('obs-whitespace', 'source-a', 'candidate-a', ' \t \n ')
  ]), 'INVALID_INPUT');
});

test('UTF-8 byte limits are enforced without truncating accepted text', () => {
  const exactLimit = '🙂'.repeat(1_024);
  const exact = prepareIndependentQuestions([source('obs-unicode-limit', 'source-a', 'candidate-a', exactLimit)]);
  assert.equal(Buffer.byteLength(exact.state.observations[0].text, 'utf8'), 4_096);
  assert.equal(exact.state.observations[0].text, exactLimit);

  rejectsWithCode(() => prepareIndependentQuestions([
    source('obs-field-limit', 'source-a', 'candidate-a', '🙂'.repeat(1_025))
  ]), 'RESOURCE_LIMIT_EXCEEDED');

  const overTotal = ['a', 'b', 'c', 'd'].map((letter, index) =>
    source(`obs-total-${index}`, `source-${letter}`, `candidate-${letter}`, letter.repeat(2_501))
  );
  rejectsWithCode(() => prepareIndependentQuestions(overTotal), 'RESOURCE_LIMIT_EXCEEDED');

  const tooMany = Array.from({ length: 33 }, (_, index) =>
    source(`obs-many-${index}`, `source-${index}`, `candidate-${index}`, 'x')
  );
  rejectsWithCode(() => prepareIndependentQuestions(tooMany), 'RESOURCE_LIMIT_EXCEEDED');

  const oversizedSnapshot = Array.from({ length: 32 }, (_, index) => ({
    observationRef: `obs-${String(index).padStart(3, '0')}-` + 'o'.repeat(70),
    kind: 'source_text',
    sourceRef: `source-${String(index).padStart(3, '0')}-` + 's'.repeat(70),
    candidateRef: `candidate-${String(index).padStart(3, '0')}-` + 'c'.repeat(70),
    fieldRef: `field-${String(index).padStart(3, '0')}-` + 'f'.repeat(70),
    language: 'en',
    text: 'x',
    retentionTags: ['date', 'venue', 'rights']
  }));
  rejectsWithCode(() => prepareIndependentQuestions(oversizedSnapshot), 'RESOURCE_LIMIT_EXCEEDED');
});

test('predecessor mutation and excessive depth cannot turn a caller assertion into a completed decision', () => {
  const base = fullIndependentEvidence();
  const identityPlan = prepareIndependentQuestions(base);
  const cyclic = { schema: 'ei-jev-question-plan-internal/v1' };
  cyclic.extra = cyclic;
  const cycleResult = prepareDependentQuestions([...base, completion(identityPlan)], cyclic);
  assert.ok(cycleResult.readinessBlockers.includes('predecessor_plan_invalid'));

  let deeplyNested = {};
  for (let index = 0; index < 20; index += 1) deeplyNested = { nested: deeplyNested };
  const deepResult = prepareDependentQuestions([...base, completion(identityPlan)], { ...deeplyNested });
  assert.ok(deepResult.readinessBlockers.includes('predecessor_plan_invalid'));

  const wrongCompletion = completion(identityPlan);
  wrongCompletion.completion.predecessorPlanHash = '0'.repeat(64);
  const wrongResult = prepareDependentQuestions([...base, wrongCompletion], identityPlan);
  assert.ok(wrongResult.readinessBlockers.includes('completed_identity_observation_must_reference_predecessor'));
});
