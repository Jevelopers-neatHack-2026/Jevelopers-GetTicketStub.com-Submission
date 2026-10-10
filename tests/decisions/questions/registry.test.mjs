import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  QUESTION_IDS,
  QUESTION_POLICY,
  QUESTION_REGISTRY,
  QUESTION_REGISTRY_HASH,
  QUESTION_REGISTRY_SCHEMA_VERSION,
  QUESTION_REGISTRY_VERSION,
  getQuestionDefinition
} from '../../../src/decisions/questions/index.mjs';

const policyBytes = readFileSync(new URL('../../../evals/policies/promotion-v1.json', import.meta.url));
const policy = JSON.parse(policyBytes.toString('utf8'));
const labelsBytes = readFileSync(new URL('../../../evals/corpus/labels.jsonl', import.meta.url));
const corpusManifestBytes = readFileSync(new URL('../../../evals/corpus/manifest.json', import.meta.url));
const corpusLabels = labelsBytes.toString('utf8').trim().split('\n').map((line) => JSON.parse(line));
const corpusManifest = JSON.parse(corpusManifestBytes.toString('utf8'));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const mandatedIds = [
  'Q-EI-SOURCE-TYPE:v1',
  'Q-EI-RELEVANCE:v1',
  'Q-EI-INJECTION:v1',
  'Q-EI-IDENTITY:v1',
  'Q-EI-FACT-SUPPORT:v1',
  'Q-EI-CONFLICT:v1',
  'Q-EI-BRAND-ROLE:v1'
];

test('registry contains the seven versioned questions and exact TypeSafe primitive rubrics', () => {
  assert.deepEqual(QUESTION_IDS, mandatedIds);
  assert.equal(new Set(QUESTION_IDS).size, 7);
  assert.equal(QUESTION_REGISTRY_VERSION, '2.0.0-draft.1');
  assert.equal(QUESTION_REGISTRY_SCHEMA_VERSION, '1.0.0');
  assert.equal(QUESTION_REGISTRY.length, 7);

  const expected = new Map([
    ['Q-EI-SOURCE-TYPE:v1', ['choice', ['event_page', 'company_page', 'venue_page', 'listing', 'news', 'social', 'other', 'unknown']]],
    ['Q-EI-RELEVANCE:v1', ['score', ['irrelevant', 'background', 'relevant', 'critical']]],
    ['Q-EI-INJECTION:v1', ['noul', ['presence_probability_0_to_1']]],
    ['Q-EI-IDENTITY:v1', ['choice', ['same_occurrence', 'different_occurrence', 'unknown']]],
    ['Q-EI-FACT-SUPPORT:v1', ['choice', ['supported', 'contradicted', 'insufficient', 'unknown']]],
    ['Q-EI-CONFLICT:v1', ['choice', ['consistent', 'conflicting', 'insufficient', 'review']]],
    ['Q-EI-BRAND-ROLE:v1', ['choice', ['favicon', 'logo', 'poster', 'photo', 'unrelated', 'unknown']]]
  ]);

  for (const question of QUESTION_REGISTRY) {
    const [primitive, labels] = expected.get(question.questionId);
    assert.equal(question.primitive, primitive);
    assert.equal(question.question.type, primitive);
    assert.deepEqual(question.outputLabels, labels);
    assert.ok(question.question.instructions.length > 30);
    assert.ok(question.question.criteria);
    assert.equal(question.ownerRole, 'Agent and research');
    assert.equal(question.modelCandidate, 'jev-1.13.0');
    assert.equal(question.modelCandidateStatus, 'candidate_only_not_accepted_runtime_pin');
    assert.equal(question.modelInputMode, 'text_only_structured_observations_no_raw_images');
    assert.equal(question.policyDocumentHash, sha256(policyBytes));
    assert.equal(question.requiredForV1, true);
    assert.equal(question.requiredWhenApplicable, true);
    assert.equal(question.canBeOmittedOnlyWhenIneligible, true);
    assert.equal(question.ownerApprovalAuthenticated, false);
    assert.equal(question.promotionStatus, 'unpromoted');
    assert.equal(question.outputIsRecommendationOnly, true);
    assert.equal(question.grantsVerifiedFactStatus, false);
    assert.equal(question.grantsOfficialSourceStatus, false);
    assert.equal(question.grantsRightsOrPermission, false);
    assert.equal(question.grantsCapabilitiesOrBudget, false);
    assert.equal(question.grantsIndependentVerification, false);
    assert.match(question.definitionHash, /^[a-f0-9]{64}$/);
    assert.match(question.labelSetSha256, /^[a-f0-9]{64}$/);
    assert.match(question.corpusManifestSha256, /^[a-f0-9]{64}$/);
    assert.equal(question.labelSetSha256, sha256(labelsBytes));
    assert.equal(question.corpusManifestSha256, sha256(corpusManifestBytes));

    const policyQuestion = policy.required_questions.find((entry) => entry.id === question.questionId);
    assert.ok(policyQuestion, question.questionId);
    assert.deepEqual(question.policyLabelSet.classes, policyQuestion.classes);
    assert.deepEqual(question.policyLabelSet.requiredMetrics, policyQuestion.required_metrics);
    assert.deepEqual(question.policyLabelSet.metricDefinitions, policyQuestion.metric_definitions);
    assert.deepEqual(question.policyLabelSet.minimumSamplesPerClass, policyQuestion.minimum_samples_per_class);
    assert.deepEqual(question.thresholds.candidateValues, policyQuestion.candidate_thresholds);
    assert.equal(question.thresholds.sourceRef, 'evals/policies/promotion-v1.json#/required_questions/' + policy.required_questions.indexOf(policyQuestion) + '/candidate_thresholds');
    assert.equal(question.thresholds.status, 'proposed_unapproved_existing_values_preserved');
    assert.equal(question.labelReconciliation.status, 'blocked_pending_agent_and_research_owner_review');
    assert.deepEqual(question.labelReconciliation.existingPolicyLabels, policyQuestion.classes);
    assert.deepEqual(question.labelReconciliation.requiredQuestionLabels, labels);
    assert.deepEqual(question.labelReconciliation.existingPolicyMetrics, policyQuestion.required_metrics);
    assert.deepEqual(question.labelReconciliation.affectedMetrics, policyQuestion.required_metrics);
    assert.equal(question.labelReconciliation.existingPolicyDenominator, policyQuestion.denominator);
    assert.ok(question.labelReconciliation.semanticMismatch.length > 20);
    assert.ok(question.labelReconciliation.affectedMetrics.length > 0);
    assert.ok(question.labelReconciliation.affectedDenominator.length > 20);
    assert.ok(question.labelReconciliation.ownerAction.length > 20);
    assert.ok(Object.isFrozen(question));
    assert.ok(Object.isFrozen(question.question));

    if (primitive === 'choice') {
      assert.deepEqual(Object.keys(question.question.criteria), labels);
      assert.ok(Object.values(question.question.criteria).every((value) => typeof value === 'string' && value.length > 10));
    } else if (primitive === 'score') {
      assert.deepEqual(question.question.criteria.map((level) => level.split(' — ')[0]), labels);
      assert.ok(question.question.criteria.every((level) => level.length > 20));
    } else {
      assert.deepEqual(Object.keys(question.question.criteria), ['true', 'false']);
      assert.ok(Object.values(question.question.criteria).every((value) => typeof value === 'string' && value.length > 10));
    }
  }
});

test('policy mismatch is explicit and does not silently reuse the configured registry version', () => {
  assert.equal(QUESTION_POLICY.policyId, 'jev-ei-promotion');
  assert.equal(QUESTION_POLICY.policyVersion, '1.0.0');
  assert.equal(QUESTION_POLICY.policyStatus, 'proposed_unapproved');
  assert.equal(QUESTION_POLICY.configuredRegistryVersion, '1.0.0');
  assert.equal(QUESTION_POLICY.configuredRegistryVersionStatus, 'does_not_match_unreconciled_draft');
  assert.match(QUESTION_POLICY.policyDocumentHash, /^[a-f0-9]{64}$/);
  assert.notEqual(QUESTION_REGISTRY_VERSION, QUESTION_POLICY.configuredRegistryVersion);
  assert.match(QUESTION_REGISTRY_HASH, /^[a-f0-9]{64}$/);
  assert.equal(getQuestionDefinition('Q-EI-SOURCE-TYPE:v1').questionId, 'Q-EI-SOURCE-TYPE:v1');
  assert.equal(getQuestionDefinition('Q-EI-NOT-REAL:v1'), null);

  const sourceType = getQuestionDefinition('Q-EI-SOURCE-TYPE:v1');
  assert.match(sourceType.labelReconciliation.semanticMismatch, /page role/i);
  assert.match(sourceType.question.instructions, /official|authoritative/i);
  const relevance = getQuestionDefinition('Q-EI-RELEVANCE:v1');
  assert.ok(relevance.question.criteria.some((level) => level.startsWith('critical')));
  const injection = getQuestionDefinition('Q-EI-INJECTION:v1');
  assert.match(injection.question.instructions, /miss cannot expand capabilities/i);
  const brandRole = getQuestionDefinition('Q-EI-BRAND-ROLE:v1');
  assert.match(brandRole.question.instructions, /permission|rights/i);
  assert.match(getQuestionDefinition('Q-EI-IDENTITY:v1').question.instructions, /never merges|never merge/i);
  assert.match(getQuestionDefinition('Q-EI-FACT-SUPPORT:v1').question.instructions, /recommendation/i);
  assert.match(getQuestionDefinition('Q-EI-CONFLICT:v1').question.instructions, /cannot resolve|cannot.*overwrite/i);
  assert.match(relevance.question.instructions, /high score does not establish source authority/i);
});

test('the referenced corpus stays the old synthetic smoke label set and is not silently relabeled', () => {
  assert.equal(corpusManifest.corpus_version, 'jev-ei-synthetic-smoke-fixture-1.0.0');
  assert.equal(corpusManifest.dataset_mode, 'synthetic_smoke_fixture_only');
  assert.deepEqual(corpusManifest.case_counts, { calibration: 10, held_out: 10 });
  assert.equal(corpusLabels.length, 20);

  for (const item of corpusLabels) {
    for (const id of mandatedIds) {
      const policyQuestion = policy.required_questions.find((question) => question.id === id);
      assert.ok(policyQuestion.classes.includes(item.labels[id]), `${item.case_id} / ${id} remains in the current policy taxonomy`);
    }
  }

  const identity = getQuestionDefinition('Q-EI-IDENTITY:v1');
  assert.ok(identity.policyLabelSet.classes.includes('uncertain'));
  assert.ok(identity.outputLabels.includes('unknown'));
  assert.equal(identity.labelReconciliation.status, 'blocked_pending_agent_and_research_owner_review');
});
