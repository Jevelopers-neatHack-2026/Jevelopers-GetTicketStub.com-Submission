import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createEiQuestionInventory,
  renderEiQuestionInventory,
  validateEiQuestionInventory
} from '../../../tools/export_ei_question_inventory.mjs';
import { QUESTION_REGISTRY } from '../../../src/decisions/questions/index.mjs';

const artifactUrl = new URL('../../../evals/jev/ei-question-inventory.json', import.meta.url);
const artifactText = readFileSync(artifactUrl, 'utf8');
const artifact = JSON.parse(artifactText);

function copy(value) {
  return structuredClone(value);
}

function assertInvalid(candidate, reason = 'unsupported candidate mutation') {
  assert.throws(() => validateEiQuestionInventory(candidate), /exact pinned EI candidate crosswalk/, reason);
}

test('the checked-in candidate inventory maps exactly five EI families to the pinned definitions', () => {
  assert.equal(validateEiQuestionInventory(artifact), true);
  assert.deepEqual(artifact.families.map((family) => family.family), [
    'source_classification',
    'relevance_ranking',
    'entity_matching',
    'factual_conflict_triage',
    'injection_signal'
  ]);
  assert.equal(new Set(artifact.families.map((family) => family.family)).size, 5);

  const actualDefinitions = new Map(QUESTION_REGISTRY.map((definition) => [definition.questionId, definition]));
  const questionIds = artifact.families.flatMap((family) => family.definitions.map((definition) => definition.questionId));
  assert.equal(new Set(questionIds).size, 6);
  for (const family of artifact.families) {
    assert.deepEqual(family.requiredQuestionIds, family.definitions.map((definition) => definition.questionId));
    for (const definition of family.definitions) {
      assert.equal(definition.definitionSha256, actualDefinitions.get(definition.questionId).definitionHash);
      assert.equal(definition.approvalStatus, 'pending_owner_review');
      assert.equal(definition.ownerApprovalAuthenticated, false);
      assert.equal(definition.promotionStatus, 'unpromoted');
    }
  }
  assert.deepEqual(artifact.families.find((family) => family.family === 'factual_conflict_triage').definitions.map(({ questionId, stage }) => ({ questionId, stage })), [
    { questionId: 'Q-EI-FACT-SUPPORT:v1', stage: 'identity-dependent' },
    { questionId: 'Q-EI-CONFLICT:v1', stage: 'identity-dependent' }
  ]);
  assert.equal(artifact.families.find((family) => family.family === 'injection_signal').definitions[0].primitive, 'noul');
  assert.match(artifact.families.find((family) => family.family === 'injection_signal').mappingLimits.join(' '), /presence probability only/i);
  assert.deepEqual(artifact.excludedDefinitions.map(({ questionId, family, ownerRole }) => ({ questionId, family, ownerRole })), [
    { questionId: 'Q-EI-BRAND-ROLE:v1', family: 'brand_asset_classification', ownerRole: 'Creative and fulfillment' }
  ]);
});

test('rendering is byte-stable and carries the explicit reviewed source and policy pins', () => {
  assert.equal(renderEiQuestionInventory(artifact), artifactText);
  assert.equal(renderEiQuestionInventory(createEiQuestionInventory()), artifactText);
  assert.equal(artifact.sourcePins.eventIntelligenceRevision, 'f811af3bf418c58bd8a13ebe16e837920ed93cf4');
  assert.equal(artifact.sourcePins.registry.registryVersion, '2.1.0-draft.1');
  assert.equal(artifact.sourcePins.registry.schemaVersion, '2.0.0');
  assert.equal(artifact.sourcePins.registry.registryHash, '1712152fd52a657ac93a308771d173fb1e355a02f3a866e505895d95775cf8f8');
  assert.equal(artifact.sourcePins.policy.policyStatus, 'proposed_unapproved');
  assert.equal(artifact.sourcePins.policy.configuredRegistryVersion, '1.0.0');
  assert.equal(artifact.sourcePins.policy.configuredRegistryVersionStatus, 'does_not_match_unreconciled_draft');
  assert.equal(artifact.status, 'candidate_pending_owner_review');
  assert.equal(artifact.ownerApprovalAuthenticated, false);
  assert.equal(artifact.promotionStatus, 'unpromoted');
});

test('the family mapper rejects an incomplete registry source definition set', () => {
  const missingIdentity = QUESTION_REGISTRY.filter((definition) => definition.questionId !== 'Q-EI-IDENTITY:v1');
  assert.throws(() => createEiQuestionInventory(missingIdentity), /missing, added, or reordered/);
});

test('validation rejects unknown, duplicate, missing, or mismatched family mappings', () => {
  const unknownFamily = copy(artifact);
  unknownFamily.families[0].family = 'unknown_family';
  assertInvalid(unknownFamily);

  const duplicateFamily = copy(artifact);
  duplicateFamily.families[1] = copy(duplicateFamily.families[0]);
  assertInvalid(duplicateFamily);

  const missingFamily = copy(artifact);
  missingFamily.families.pop();
  assertInvalid(missingFamily);

  const unknownQuestion = copy(artifact);
  unknownQuestion.families[0].requiredQuestionIds[0] = 'Q-EI-NOT-REAL:v1';
  assertInvalid(unknownQuestion);

  const duplicateQuestion = copy(artifact);
  duplicateQuestion.families[0].requiredQuestionIds.push('Q-EI-SOURCE-TYPE:v1');
  assertInvalid(duplicateQuestion);

  const missingDefinition = copy(artifact);
  missingDefinition.families[3].definitions.pop();
  assertInvalid(missingDefinition);
});

test('validation rejects stale pins, definition substitution, and Creative-owned brand mapping', () => {
  for (const [mutate, path] of [
    [(value) => { value.sourcePins.eventIntelligenceRevision = 'a38c2004b65f84a2e2a48a4ce201005f2eb5b130'; }, 'revision'],
    [(value) => { value.sourcePins.registry.sourceSha256 = '0'.repeat(64); }, 'registry source hash'],
    [(value) => { value.sourcePins.registry.registryVersion = '2.1.0'; }, 'registry version'],
    [(value) => { value.sourcePins.registry.schemaVersion = '2.1.0'; }, 'schema version'],
    [(value) => { value.sourcePins.registry.registryHash = '0'.repeat(64); }, 'registry hash'],
    [(value) => { value.sourcePins.policy.sourceSha256 = '0'.repeat(64); }, 'policy source hash'],
    [(value) => { value.sourcePins.policy.policyStatus = 'approved'; }, 'policy approval state'],
    [(value) => { value.families[0].definitions[0].definitionSha256 = '0'.repeat(64); }, 'definition hash']
  ]) {
    const stale = copy(artifact);
    mutate(stale);
    assertInvalid(stale, path);
  }

  const brandAddedToEi = copy(artifact);
  brandAddedToEi.families[0].requiredQuestionIds.push('Q-EI-BRAND-ROLE:v1');
  brandAddedToEi.families[0].definitions.push(copy(artifact.excludedDefinitions[0]));
  assertInvalid(brandAddedToEi);
});

test('validation rejects approval, promotion, threshold, dataset, model, routing, and paid-authorization claims', () => {
  const mutations = [
    (value) => { value.ownerApprovalAuthenticated = true; },
    (value) => { value.families[0].definitions[0].approvalStatus = 'approved'; },
    (value) => { value.promotionStatus = 'promoted'; },
    (value) => { value.approvedThreshold = 0.9; },
    (value) => { value.datasetId = 'approved-dataset'; },
    (value) => { value.splitHashes = ['0'.repeat(64)]; },
    (value) => { value.modelSelection = 'jev-candidate'; },
    (value) => { value.activeRouting = true; },
    (value) => { value.paidExecutionAllowed = true; },
    (value) => { value.ownerAcknowledgment = { status: 'accepted' }; }
  ];

  for (const mutate of mutations) {
    const unsupportedClaim = copy(artifact);
    mutate(unsupportedClaim);
    assertInvalid(unsupportedClaim);
  }
});
