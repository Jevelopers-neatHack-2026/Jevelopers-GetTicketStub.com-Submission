import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  IDENTITY_DEPENDENT_QUESTION_IDS,
  INDEPENDENT_QUESTION_IDS,
  QuestionPreparationError,
  deriveQuestionTargetRef,
  getQuestionDefinition,
  prepareDependentQuestions,
  prepareIndependentQuestions
} from '../../../src/decisions/questions/index.mjs';

const canonical = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(canonical).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

function target(questionId, observationRefs, options = {}) {
  const targetOptions = {};
  if (options.fieldRef !== undefined) targetOptions.fieldRef = options.fieldRef;
  if (options.candidateRefs !== undefined) targetOptions.candidateRefs = options.candidateRefs;
  return {
    questionId,
    targetRef: deriveQuestionTargetRef(questionId, observationRefs, targetOptions),
    observationRefs,
    ...(options.contextObservationRefs ? { contextObservationRefs: options.contextObservationRefs } : {}),
    ...(options.fieldRef !== undefined ? { fieldRef: options.fieldRef } : {}),
    ...(options.candidateRefs !== undefined ? { candidateRefs: options.candidateRefs } : {})
  };
}

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
    source('obs-source-b', 'source-b', 'candidate-b', 'A news article reports a separate November 13 event at 8 PM in Vancouver, a changed venue, and a new annual edition.', {
      retentionTags: ['date', 'time_zone', 'venue', 'tour_city', 'annual_edition', 'cancellation', 'reschedule']
    }),
    claimEvidence(),
    visual()
  ];
}

function independentTargets(evidence = fullIndependentEvidence()) {
  const byRef = new Map(evidence.map((item) => [item.observationRef, item]));
  const sources = evidence.filter((item) => item.kind === 'source_text');
  const candidates = [...new Set(sources.map((item) => item.candidateRef).filter(Boolean))];
  const visual = evidence.find((item) => item.kind === 'structured_visual_observation');
  return [
    target('Q-EI-SOURCE-TYPE:v1', [sources[0].observationRef]),
    target('Q-EI-RELEVANCE:v1', [sources[0].observationRef]),
    target('Q-EI-INJECTION:v1', [sources[0].observationRef]),
    target('Q-EI-IDENTITY:v1', sources.filter((item) => candidates.includes(item.candidateRef)).map((item) => item.observationRef), { candidateRefs: candidates }),
    ...(visual ? [target('Q-EI-BRAND-ROLE:v1', [visual.observationRef])] : [])
  ];
}

function dependentTargets(identityPlan, evidence, completionRef = 'obs-identity-completed') {
  const completionState = evidence.find((item) => item.observationRef === completionRef);
  const claimRecords = evidence.filter((item) => item.kind === 'claim_evidence_text');
  const candidateRef = claimRecords[0]?.candidateRef;
  const fieldRef = claimRecords[0]?.fieldRef;
  const contextObservationRefs = completionState ? [completionRef] : [];
  return [
    target('Q-EI-FACT-SUPPORT:v1', [claimRecords[0].observationRef], { fieldRef, candidateRefs: [candidateRef], contextObservationRefs }),
    target('Q-EI-CONFLICT:v1', claimRecords.map((item) => item.observationRef), { fieldRef, candidateRefs: [candidateRef], contextObservationRefs })
  ];
}

function rehashPlan(plan) {
  const { planHash: _oldPlanHash, ...core } = plan;
  plan.planHash = sha256(canonical(core));
  return plan;
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

  const singletonObservation = source('obs-one', 'source-one', 'candidate-one', 'A source describes one event.');
  const singleton = prepareIndependentQuestions([singletonObservation], independentTargets([singletonObservation]));
  assert.equal(question(singleton, 'Q-EI-SOURCE-TYPE:v1').eligible, true);
  assert.equal(question(singleton, 'Q-EI-RELEVANCE:v1').eligible, true);
  assert.equal(question(singleton, 'Q-EI-INJECTION:v1').eligible, true);
  assert.equal(question(singleton, 'Q-EI-IDENTITY:v1').eligible, false);
  assert.ok(question(singleton, 'Q-EI-IDENTITY:v1').reasonCodes.includes('identity_requires_exactly_two_candidates'));
  assert.equal(question(singleton, 'Q-EI-BRAND-ROLE:v1').eligible, false);

  const unknownObservation = source('obs-und', 'source-und', 'candidate-und', 'An observation without a language decision.', { language: 'und' });
  const unknownLanguage = prepareIndependentQuestions([unknownObservation], independentTargets([unknownObservation]));
  assert.ok(question(unknownLanguage, 'Q-EI-RELEVANCE:v1').reasonCodes.includes('language_unknown'));
  assert.ok(question(unknownLanguage, 'Q-EI-INJECTION:v1').reasonCodes.includes('language_unknown'));

  const multilingualObservation = source('obs-fr', 'source-fr', 'candidate-fr', 'Le lieu de l’événement est la salle principale.', { language: 'fr' });
  const multilingual = prepareIndependentQuestions([multilingualObservation], independentTargets([multilingualObservation]));
  assert.equal(question(multilingual, 'Q-EI-RELEVANCE:v1').eligible, true);
  assert.equal(question(multilingual, 'Q-EI-RELEVANCE:v1').reviewRequired, true);
  assert.ok(question(multilingual, 'Q-EI-RELEVANCE:v1').reviewReasons.includes('non_english_or_multilingual_input_requires_review'));
});

test('permutations yield identical immutable plans and all critical evidence remains available', () => {
  const evidence = fullIndependentEvidence();
  const targets = independentTargets(evidence);
  const plan = prepareIndependentQuestions(evidence, targets);
  const permutation = prepareIndependentQuestions([...evidence].reverse(), [...targets].reverse().map((binding) => ({
    ...binding,
    observationRefs: [...binding.observationRefs].reverse(),
    candidateRefs: binding.candidateRefs ? [...binding.candidateRefs].reverse() : undefined
  })));
  assert.deepEqual(plan.eligibleQuestionIds, INDEPENDENT_QUESTION_IDS);
  assert.equal(plan.planHash, permutation.planHash);
  assert.equal(plan.stateHash, permutation.stateHash);
  for (const id of INDEPENDENT_QUESTION_IDS) {
    assert.equal(question(plan, id).targetBindingHash, question(permutation, id).targetBindingHash);
  }
  assert.deepEqual(plan.state.observations.map((record) => record.observationRef), [
    'obs-claim-date', 'obs-source-a', 'obs-source-b', 'obs-visual-role'
  ]);
  assert.equal(plan.state.observations.find((record) => record.observationRef === 'obs-source-b').text,
    'A news article reports a separate November 13 event at 8 PM in Vancouver, a changed venue, and a new annual edition.');
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
  assert.ok(plan.questions.every((item) => item.targetBinding !== null));
  assert.ok(plan.questions.every((item) => item.questionInstanceHash.length === 64));
  assert.equal(question(plan, 'Q-EI-SOURCE-TYPE:v1').targetState.evidence.length, 1);
  assert.equal(question(plan, 'Q-EI-IDENTITY:v1').targetBinding.candidateRefs.length, 2);
});

test('dependent questions require an immutable later snapshot tied to completed identity input', () => {
  const base = fullIndependentEvidence();
  const independentBindings = independentTargets(base);
  const identityPlan = prepareIndependentQuestions(base, independentBindings);
  assert.equal(question(identityPlan, 'Q-EI-IDENTITY:v1').eligible, true);

  const dependentEvidence = [...base, completion(identityPlan)];
  const dependent = prepareDependentQuestions(dependentEvidence, identityPlan, dependentTargets(identityPlan, dependentEvidence));
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

  const missingPredecessor = prepareDependentQuestions(dependentEvidence, null, dependentTargets(identityPlan, dependentEvidence));
  assert.deepEqual(missingPredecessor.eligibleQuestionIds, []);
  assert.ok(missingPredecessor.readinessBlockers.includes('completed_identity_observation_required'));
  assert.equal(question(missingPredecessor, 'Q-EI-FACT-SUPPORT:v1').eligible, false);

  const duplicateEvidence = [
    ...base,
    completion(identityPlan, 'obs-identity-one'),
    completion(identityPlan, 'obs-identity-two')
  ];
  const duplicateCompletion = prepareDependentQuestions(duplicateEvidence, identityPlan, dependentTargets(identityPlan, duplicateEvidence));
  assert.ok(duplicateCompletion.readinessBlockers.includes('exactly_one_completed_identity_observation_required'));
  assert.equal(question(duplicateCompletion, 'Q-EI-CONFLICT:v1').eligible, false);

  const changedBase = [...base, source('obs-extra', 'source-extra', 'candidate-extra', 'Evidence changed after identity preparation.')];
  const changedEvidence = [...changedBase, completion(identityPlan)];
  const changed = prepareDependentQuestions(changedEvidence, identityPlan, dependentTargets(identityPlan, changedEvidence));
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
  const identityPlan = prepareIndependentQuestions(base, independentTargets(base));
  const dependentEvidence = [...base, completion(identityPlan)];
  const dependentBindings = dependentTargets(identityPlan, dependentEvidence);
  const cyclic = { schema: 'ei-jev-question-plan-internal/v2' };
  cyclic.extra = cyclic;
  const cycleResult = prepareDependentQuestions(dependentEvidence, cyclic, dependentBindings);
  assert.ok(cycleResult.readinessBlockers.includes('predecessor_plan_invalid'));

  let deeplyNested = {};
  for (let index = 0; index < 20; index += 1) deeplyNested = { nested: deeplyNested };
  const deepResult = prepareDependentQuestions(dependentEvidence, { ...deeplyNested }, dependentBindings);
  assert.ok(deepResult.readinessBlockers.includes('predecessor_plan_invalid'));

  const wrongCompletion = completion(identityPlan);
  wrongCompletion.completion.predecessorPlanHash = '0'.repeat(64);
  const wrongEvidence = [...base, wrongCompletion];
  const wrongResult = prepareDependentQuestions(wrongEvidence, identityPlan, dependentTargets(identityPlan, wrongEvidence));
  assert.ok(wrongResult.readinessBlockers.includes('completed_identity_observation_must_reference_predecessor'));
});

test('every primitive answer is bound to one explicit target while the complete observation snapshot is retained', () => {
  const secondVisual = {
    ...visual(),
    observationRef: 'obs-visual-logo',
    text: 'A structured observer describes a company logo.',
    visual: { ...visual().visual, assetHash: 'b'.repeat(64), regionRef: 'region-logo' }
  };
  const evidence = [...fullIndependentEvidence(), secondVisual];
  const bindings = independentTargets(evidence).map((binding) => binding.questionId === 'Q-EI-BRAND-ROLE:v1'
    ? target(binding.questionId, ['obs-visual-role'])
    : binding);
  const plan = prepareIndependentQuestions(evidence, bindings);
  assert.equal(plan.state.observations.length, evidence.length);
  assert.deepEqual(plan.state.observations.map((item) => item.observationRef), [
    'obs-claim-date', 'obs-source-a', 'obs-source-b', 'obs-visual-logo', 'obs-visual-role'
  ]);
  const brand = question(plan, 'Q-EI-BRAND-ROLE:v1');
  assert.deepEqual(brand.targetBinding.observationRefs, ['obs-visual-role']);
  assert.equal(brand.targetState.evidence.length, 1);
  assert.equal(brand.targetState.evidence[0].recordHash, plan.state.observations.find((item) => item.observationRef === 'obs-visual-role').recordHash);
  assert.equal(plan.state.observations.some((item) => item.observationRef === 'obs-visual-logo'), true);

  const secondBrandPlan = prepareIndependentQuestions(evidence, bindings.map((binding) => binding.questionId === 'Q-EI-BRAND-ROLE:v1'
    ? target(binding.questionId, ['obs-visual-logo'])
    : binding));
  assert.notEqual(brand.targetBindingHash, question(secondBrandPlan, 'Q-EI-BRAND-ROLE:v1').targetBindingHash);
  assert.notEqual(brand.questionInstanceHash, question(secondBrandPlan, 'Q-EI-BRAND-ROLE:v1').questionInstanceHash);
  assert.notEqual(plan.planHash, secondBrandPlan.planHash);
});

test('passage levels, page roles, candidate pairs, and conflicts use per-target instances without collection answers', () => {
  const passageA = { ...source('passage-a', 'source-a', 'candidate-a', 'A direct event page identifies the scheduled event.'), kind: 'passage_text' };
  const passageB = { ...source('passage-b', 'source-b', 'candidate-b', 'A background article mentions the event history.'), kind: 'passage_text' };
  const evidence = [...fullIndependentEvidence(), passageA, passageB];
  const baseBindings = independentTargets(evidence);
  const relevanceA = prepareIndependentQuestions(evidence, baseBindings.map((binding) => binding.questionId === 'Q-EI-RELEVANCE:v1'
    ? target(binding.questionId, ['passage-a'])
    : binding));
  const relevanceB = prepareIndependentQuestions(evidence, baseBindings.map((binding) => binding.questionId === 'Q-EI-RELEVANCE:v1'
    ? target(binding.questionId, ['passage-b'])
    : binding));
  assert.deepEqual(question(relevanceA, 'Q-EI-RELEVANCE:v1').targetBinding.observationRefs, ['passage-a']);
  assert.deepEqual(question(relevanceB, 'Q-EI-RELEVANCE:v1').targetBinding.observationRefs, ['passage-b']);
  assert.notEqual(question(relevanceA, 'Q-EI-RELEVANCE:v1').targetBindingHash, question(relevanceB, 'Q-EI-RELEVANCE:v1').targetBindingHash);

  const pageA = prepareIndependentQuestions(evidence, baseBindings.map((binding) => binding.questionId === 'Q-EI-SOURCE-TYPE:v1'
    ? target(binding.questionId, ['obs-source-a'])
    : binding));
  const pageB = prepareIndependentQuestions(evidence, baseBindings.map((binding) => binding.questionId === 'Q-EI-SOURCE-TYPE:v1'
    ? target(binding.questionId, ['obs-source-b'])
    : binding));
  assert.deepEqual(question(pageA, 'Q-EI-SOURCE-TYPE:v1').targetBinding.observationRefs, ['obs-source-a']);
  assert.deepEqual(question(pageB, 'Q-EI-SOURCE-TYPE:v1').targetBinding.observationRefs, ['obs-source-b']);
  assert.notEqual(question(pageA, 'Q-EI-SOURCE-TYPE:v1').targetStateHash, question(pageB, 'Q-EI-SOURCE-TYPE:v1').targetStateHash);

  const thirdCandidate = source('obs-source-c', 'source-c', 'candidate-c', 'A separate source confirms this same November 12 Seattle occurrence.');
  const threeCandidates = [...evidence, thirdCandidate];
  const threeBindings = independentTargets(threeCandidates).map((binding) => binding.questionId === 'Q-EI-IDENTITY:v1'
    ? target(binding.questionId, ['obs-source-a', 'obs-source-b', 'obs-source-c'], { candidateRefs: ['candidate-a', 'candidate-b', 'candidate-c'] })
    : binding);
  const threePlan = prepareIndependentQuestions(threeCandidates, threeBindings);
  assert.equal(question(threePlan, 'Q-EI-IDENTITY:v1').eligible, false);
  assert.ok(question(threePlan, 'Q-EI-IDENTITY:v1').reasonCodes.includes('identity_requires_exactly_two_candidates'));
  assert.equal(threePlan.state.observations.some((item) => item.observationRef === 'obs-source-c'), true);
  assert.match(threePlan.state.observations.find((item) => item.observationRef === 'obs-source-a').text, /November 12.*Seattle/);
  assert.match(threePlan.state.observations.find((item) => item.observationRef === 'obs-source-b').text, /November 13.*Vancouver/);
  assert.match(threePlan.state.observations.find((item) => item.observationRef === 'obs-source-c').text, /same November 12 Seattle/);

  const contradictory = {
    ...claimEvidence(),
    observationRef: 'obs-claim-date-conflict',
    claimText: '2026-11-12 at 20:30 America/New_York',
    text: 'The listing says November 12 at 7:30 PM Eastern.'
  };
  const claimEvidenceSet = [...fullIndependentEvidence(), contradictory];
  const identityBindings = independentTargets(claimEvidenceSet);
  const identityPlan = prepareIndependentQuestions(claimEvidenceSet, identityBindings);
  const dependentEvidence = [...claimEvidenceSet, completion(identityPlan)];
  const completeConflictBinding = target('Q-EI-CONFLICT:v1', ['obs-claim-date', 'obs-claim-date-conflict'], {
    fieldRef: 'event.date', candidateRefs: ['candidate-a'], contextObservationRefs: ['obs-identity-completed']
  });
  const incompleteConflictBinding = target('Q-EI-CONFLICT:v1', ['obs-claim-date'], {
    fieldRef: 'event.date', candidateRefs: ['candidate-a'], contextObservationRefs: ['obs-identity-completed']
  });
  const dependent = prepareDependentQuestions(dependentEvidence, identityPlan, [
    target('Q-EI-FACT-SUPPORT:v1', ['obs-claim-date'], {
      fieldRef: 'event.date', candidateRefs: ['candidate-a'], contextObservationRefs: ['obs-identity-completed']
    }),
    completeConflictBinding
  ]);
  assert.equal(question(dependent, 'Q-EI-CONFLICT:v1').eligible, true);
  assert.deepEqual(question(dependent, 'Q-EI-CONFLICT:v1').targetBinding.observationRefs, ['obs-claim-date', 'obs-claim-date-conflict']);
  const incomplete = prepareDependentQuestions(dependentEvidence, identityPlan, [
    target('Q-EI-FACT-SUPPORT:v1', ['obs-claim-date'], {
      fieldRef: 'event.date', candidateRefs: ['candidate-a'], contextObservationRefs: ['obs-identity-completed']
    }),
    incompleteConflictBinding
  ]);
  assert.ok(question(incomplete, 'Q-EI-CONFLICT:v1').reasonCodes.includes('all_comparable_field_evidence_required'));

  const supportedTargetPlan = prepareDependentQuestions(dependentEvidence, identityPlan, [
    target('Q-EI-FACT-SUPPORT:v1', ['obs-claim-date'], {
      fieldRef: 'event.date', candidateRefs: ['candidate-a'], contextObservationRefs: ['obs-identity-completed']
    })
  ]);
  const contradictedTargetPlan = prepareDependentQuestions(dependentEvidence, identityPlan, [
    target('Q-EI-FACT-SUPPORT:v1', ['obs-claim-date-conflict'], {
      fieldRef: 'event.date', candidateRefs: ['candidate-a'], contextObservationRefs: ['obs-identity-completed']
    })
  ]);
  assert.equal(question(supportedTargetPlan, 'Q-EI-FACT-SUPPORT:v1').eligible, true);
  assert.equal(question(contradictedTargetPlan, 'Q-EI-FACT-SUPPORT:v1').eligible, true);
  assert.deepEqual(question(supportedTargetPlan, 'Q-EI-FACT-SUPPORT:v1').targetBinding.observationRefs, ['obs-claim-date']);
  assert.deepEqual(question(contradictedTargetPlan, 'Q-EI-FACT-SUPPORT:v1').targetBinding.observationRefs, ['obs-claim-date-conflict']);
  assert.equal(dependentEvidence.find((item) => item.observationRef === 'obs-claim-date').claimText, '2026-11-12 at 19:30 America/New_York');
  assert.match(dependentEvidence.find((item) => item.observationRef === 'obs-claim-date').text, /7:30 PM Eastern/);
  assert.equal(dependentEvidence.find((item) => item.observationRef === 'obs-claim-date-conflict').claimText, '2026-11-12 at 20:30 America/New_York');
  assert.match(dependentEvidence.find((item) => item.observationRef === 'obs-claim-date-conflict').text, /7:30 PM Eastern/);
  assert.notEqual(question(supportedTargetPlan, 'Q-EI-FACT-SUPPORT:v1').targetBindingHash, question(contradictedTargetPlan, 'Q-EI-FACT-SUPPORT:v1').targetBindingHash);
});

test('target bindings reject missing, unknown, duplicate, mismatched, and unbounded fanout inputs', () => {
  const evidence = fullIndependentEvidence();
  const allTargets = independentTargets(evidence);
  const missing = prepareIndependentQuestions(evidence, allTargets.filter((binding) => binding.questionId !== 'Q-EI-SOURCE-TYPE:v1'));
  assert.equal(question(missing, 'Q-EI-SOURCE-TYPE:v1').eligible, false);
  assert.ok(question(missing, 'Q-EI-SOURCE-TYPE:v1').reasonCodes.includes('target_binding_missing'));

  rejectsWithCode(() => prepareIndependentQuestions(evidence, [target('Q-EI-SOURCE-TYPE:v1', ['unknown-ref'])]), 'UNKNOWN_TARGET_REFERENCE');
  rejectsWithCode(() => prepareIndependentQuestions(evidence, [target('Q-EI-SOURCE-TYPE:v1', ['obs-source-a', 'obs-source-a'])]), 'INVALID_TARGET_BINDING');
  rejectsWithCode(() => prepareIndependentQuestions(evidence, [
    allTargets[0], { ...allTargets[0] }
  ]), 'DUPLICATE_TARGET_BINDING');
  rejectsWithCode(() => prepareIndependentQuestions(evidence, [{ ...allTargets[0], targetRef: `qtarget-${'0'.repeat(64)}` }]), 'MISMATCHED_TARGET_REFERENCE');
  rejectsWithCode(() => prepareIndependentQuestions(evidence, [
    ...allTargets,
    target('Q-EI-SOURCE-TYPE:v1', ['obs-source-b'])
  ]), 'RESOURCE_LIMIT_EXCEEDED');
  rejectsWithCode(() => prepareIndependentQuestions(evidence, [{
    ...target('Q-EI-SOURCE-TYPE:v1', ['obs-source-a']),
    contextObservationRefs: ['unknown-context']
  }]), 'UNKNOWN_TARGET_REFERENCE');
  rejectsWithCode(() => prepareIndependentQuestions(evidence, [
    { ...target('Q-EI-SOURCE-TYPE:v1', ['obs-source-a']), observationRefs: undefined }
  ]), 'INVALID_INPUT');

  const targetAccessor = target('Q-EI-SOURCE-TYPE:v1', ['obs-source-a']);
  Object.defineProperty(targetAccessor, 'targetRef', { enumerable: true, get() { throw new Error('must not run'); } });
  rejectsWithCode(() => prepareIndependentQuestions(evidence, [targetAccessor]), 'INVALID_INPUT');
});

test('rehashed predecessor flags, copied hashes, and structural edits cannot manufacture identity eligibility', () => {
  const singleton = claimEvidence();
  singleton.observationRef = 'obs-singleton-claim';
  const singleTarget = target('Q-EI-IDENTITY:v1', ['obs-singleton-claim'], { candidateRefs: ['candidate-a'] });
  const original = prepareIndependentQuestions([singleton], [singleTarget]);
  assert.equal(question(original, 'Q-EI-IDENTITY:v1').eligible, false);
  const forged = structuredClone(original);
  forged.eligibleQuestionIds.push('Q-EI-IDENTITY:v1');
  const forgedIdentity = forged.questions.find((item) => item.questionId === 'Q-EI-IDENTITY:v1');
  forgedIdentity.eligible = true;
  forgedIdentity.reasonCodes = [];
  forgedIdentity.question = getQuestionDefinition('Q-EI-IDENTITY:v1').question;
  forged.preparationStatus = 'prepared';
  rehashPlan(forged);
  const dependentEvidence = [singleton, completion(forged)];
  const attempted = prepareDependentQuestions(dependentEvidence, forged, [
    target('Q-EI-FACT-SUPPORT:v1', [singleton.observationRef], {
      fieldRef: singleton.fieldRef, candidateRefs: [singleton.candidateRef], contextObservationRefs: ['obs-identity-completed']
    })
  ]);
  assert.ok(attempted.readinessBlockers.includes('predecessor_plan_invalid'));
  assert.deepEqual(attempted.eligibleQuestionIds, []);

  const unknown = source('obs-und-id-a', 'source-a', 'candidate-a', 'One unknown-language candidate.', { language: 'und' });
  const known = source('obs-und-id-b', 'source-b', 'candidate-b', 'One known-language candidate.');
  const unknownBindings = independentTargets([unknown, known]);
  const unknownPlan = prepareIndependentQuestions([unknown, known], unknownBindings);
  assert.equal(question(unknownPlan, 'Q-EI-IDENTITY:v1').eligible, false);
  const unknownForged = structuredClone(unknownPlan);
  unknownForged.eligibleQuestionIds.push('Q-EI-IDENTITY:v1');
  const unknownIdentity = unknownForged.questions.find((item) => item.questionId === 'Q-EI-IDENTITY:v1');
  unknownIdentity.eligible = true;
  unknownIdentity.reasonCodes = [];
  unknownIdentity.question = getQuestionDefinition('Q-EI-IDENTITY:v1').question;
  unknownForged.preparationStatus = 'prepared';
  rehashPlan(unknownForged);
  const unknownEvidence = [unknown, known, completion(unknownForged)];
  const unknownAttempt = prepareDependentQuestions(unknownEvidence, unknownForged, []);
  assert.ok(unknownAttempt.readinessBlockers.includes('predecessor_plan_invalid'));

  const validIdentityPlan = prepareIndependentQuestions(fullIndependentEvidence(), independentTargets(fullIndependentEvidence()));
  const changedContent = structuredClone(validIdentityPlan);
  const changedIdentity = changedContent.questions.find((item) => item.questionId === 'Q-EI-IDENTITY:v1');
  changedIdentity.question.instructions = 'A caller-authored replacement question.';
  rehashPlan(changedContent);
  const contentEvidence = [...fullIndependentEvidence(), completion(changedContent)];
  const changedContentAttempt = prepareDependentQuestions(contentEvidence, changedContent, []);
  assert.ok(changedContentAttempt.readinessBlockers.includes('predecessor_plan_invalid'));

  const changedStructure = structuredClone(validIdentityPlan);
  changedStructure.requiredQuestionIds.reverse();
  rehashPlan(changedStructure);
  const structuralEvidence = [...fullIndependentEvidence(), completion(changedStructure)];
  const structuralAttempt = prepareDependentQuestions(structuralEvidence, changedStructure, []);
  assert.ok(structuralAttempt.readinessBlockers.includes('predecessor_plan_invalid'));
});

test('serialized valid predecessors remain usable; completion refs must be unique and linked', () => {
  const base = fullIndependentEvidence();
  const identityPlan = prepareIndependentQuestions(base, independentTargets(base));
  const serialized = JSON.parse(JSON.stringify(identityPlan));
  const dependentEvidence = [...base, completion(serialized)];
  const dependent = prepareDependentQuestions(dependentEvidence, serialized, dependentTargets(serialized, dependentEvidence));
  assert.deepEqual(dependent.eligibleQuestionIds, IDENTITY_DEPENDENT_QUESTION_IDS);
  assert.equal(dependent.state.predecessor.completionAssertion, 'caller_asserted_for_preparation_only');
  assert.equal(dependent.executionStatus, 'not_dispatched');
  assert.equal(dependent.promotionStatus, 'unpromoted');

  const missingCompletion = prepareDependentQuestions(base, serialized, dependentTargets(serialized, base));
  assert.ok(missingCompletion.readinessBlockers.includes('exactly_one_completed_identity_observation_required'));
  assert.deepEqual(missingCompletion.eligibleQuestionIds, []);

  const duplicateEvidence = [...base, completion(serialized, 'obs-completion-a'), completion(serialized, 'obs-completion-b')];
  const duplicate = prepareDependentQuestions(duplicateEvidence, serialized, dependentTargets(serialized, duplicateEvidence));
  assert.ok(duplicate.readinessBlockers.includes('exactly_one_completed_identity_observation_required'));
  assert.deepEqual(duplicate.eligibleQuestionIds, []);

  const wrong = completion(serialized);
  wrong.completion.predecessorPlanHash = '0'.repeat(64);
  const wrongEvidence = [...base, wrong];
  const wrongPlan = prepareDependentQuestions(wrongEvidence, serialized, dependentTargets(serialized, wrongEvidence));
  assert.ok(wrongPlan.readinessBlockers.includes('completed_identity_observation_must_reference_predecessor'));
  assert.deepEqual(wrongPlan.eligibleQuestionIds, []);
});
