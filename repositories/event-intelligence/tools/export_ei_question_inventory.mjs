import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  QUESTION_POLICY,
  QUESTION_REGISTRY,
  QUESTION_REGISTRY_HASH,
  QUESTION_REGISTRY_SCHEMA_VERSION,
  QUESTION_REGISTRY_VERSION
} from '../src/decisions/questions/index.mjs';

const REPOSITORY_ROOT = new URL('../', import.meta.url);
const INVENTORY_URL = new URL('../evals/jev/ei-question-inventory.json', import.meta.url);

// These pins describe the reviewed pre-inventory EI snapshot. They are fixed
// inputs so rendering never depends on the generated commit's own Git HEAD.
const REVIEWED_SOURCE_REVISION = 'f811af3bf418c58bd8a13ebe16e837920ed93cf4';
const EXPECTED_REGISTRY_SOURCE_SHA256 = 'a3f83d4c528a399092c11ed8d27670121fff287f0c71ef1c098f64e31d1b0880';
const EXPECTED_POLICY_SOURCE_SHA256 = '37789e4679067716dd1a40664624bf594eebdf762e96964617afb155b1a841e8';
const EXPECTED_REGISTRY_VERSION = '2.1.0-draft.1';
const EXPECTED_SCHEMA_VERSION = '2.0.0';
const EXPECTED_REGISTRY_HASH = '1712152fd52a657ac93a308771d173fb1e355a02f3a866e505895d95775cf8f8';
const EXPECTED_POLICY = Object.freeze({
  policyId: 'jev-ei-promotion',
  policyVersion: '1.0.0',
  policyStatus: 'proposed_unapproved',
  configuredRegistryVersion: '1.0.0',
  configuredRegistryVersionStatus: 'does_not_match_unreconciled_draft'
});

const REGISTRY_IDS = Object.freeze([
  'Q-EI-SOURCE-TYPE:v1',
  'Q-EI-RELEVANCE:v1',
  'Q-EI-INJECTION:v1',
  'Q-EI-IDENTITY:v1',
  'Q-EI-FACT-SUPPORT:v1',
  'Q-EI-CONFLICT:v1',
  'Q-EI-BRAND-ROLE:v1'
]);

const FAMILY_SPECS = Object.freeze([
  {
    family: 'source_classification',
    requiredQuestionIds: ['Q-EI-SOURCE-TYPE:v1'],
    mappingLimits: [
      'The rubric describes page role; it does not establish source authority, officialness, accuracy, or permission.'
    ]
  },
  {
    family: 'relevance_ranking',
    requiredQuestionIds: ['Q-EI-RELEVANCE:v1'],
    mappingLimits: [
      'The four ordered levels include background and critical; mapping to the older policy classes and metrics is unreconciled.',
      'A relevance score cannot discard evidence; identity, schedule, permission, and contradictory evidence must remain available.'
    ]
  },
  {
    family: 'entity_matching',
    requiredQuestionIds: ['Q-EI-IDENTITY:v1'],
    mappingLimits: [
      'This compares two scheduled-occurrence candidates; it is not generic entity deduplication and cannot merge records.'
    ]
  },
  {
    family: 'factual_conflict_triage',
    requiredQuestionIds: ['Q-EI-FACT-SUPPORT:v1', 'Q-EI-CONFLICT:v1'],
    mappingLimits: [
      'Both questions are identity-dependent and require a completed identity observation.',
      'Keep fact support and conflict as separate stages and preserve their separate claim/field target units.'
    ]
  },
  {
    family: 'injection_signal',
    requiredQuestionIds: ['Q-EI-INJECTION:v1'],
    mappingLimits: [
      'Noul supplies presence probability only; do not add confidence or abstention fields or turn this signal into a capability gate.'
    ]
  }
]);

const EXPECTED_DEFINITION_HASHES = Object.freeze({
  'Q-EI-SOURCE-TYPE:v1': '9bba7e837dd3d91c69666eb25acecd43767c68627f773f0d5426b68faca5d261',
  'Q-EI-RELEVANCE:v1': 'f9c7bd2fa425d388fe5cc2ffa119992d529787d02bc9c87382f10b09b2fb426f',
  'Q-EI-INJECTION:v1': 'e47287b34bf28ed144b1b19fe79ce1020ceb3c4e8f608aeab8b2cae4fbf46e46',
  'Q-EI-IDENTITY:v1': '51e55cc6087d2b421ae1eb4ee130569b7361dc01c210c7c7757b0a8756e7f050',
  'Q-EI-FACT-SUPPORT:v1': 'c6099d477c5d37110865ac39f630f1a026611f01dfd713509d06a7155a4d457b',
  'Q-EI-CONFLICT:v1': 'fff29d319dcf3d387a4a4d2220f29b7a6b6e3f103c15697c933b6ae3ef35fb40',
  'Q-EI-BRAND-ROLE:v1': 'fce9dadfd91f08e2098262cd831a3a108a73f10edb2ee1c040cf87b3d1525d3e'
});

const ACCEPTANCE_TRACE = Object.freeze([
  {
    requirement: 'EI-06',
    issue: 16,
    acceptanceIds: ['AGT-01', 'AGT-04', 'EVAL-02', 'FIN-01', 'FIN-03', 'FIN-04'],
    result: 'partial_owner_inventory_only'
  },
  {
    requirement: 'EI-07',
    issue: 17,
    acceptanceIds: ['AGT-01', 'AGT-04', 'EVAL-02', 'FIN-01'],
    result: 'partial_owner_inventory_only'
  },
  {
    requirement: 'JEV-EI-01',
    issue: null,
    acceptanceIds: ['AGT-01', 'AGT-04', 'AGT-05', 'ART-05', 'CON-01', 'CON-02', 'CON-03', 'EVAL-02', 'FIN-01', 'FIN-03', 'FIN-04'],
    result: 'trace_only_not_acceptance_evidence'
  }
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertSourcePins() {
  const registryBytes = readFileSync(new URL('src/decisions/questions/registry.mjs', REPOSITORY_ROOT));
  const policyBytes = readFileSync(new URL('evals/policies/promotion-v1.json', REPOSITORY_ROOT));

  assert.equal(sha256(registryBytes), EXPECTED_REGISTRY_SOURCE_SHA256, 'question registry source hash changed; review and repin before export');
  assert.equal(sha256(policyBytes), EXPECTED_POLICY_SOURCE_SHA256, 'promotion policy source hash changed; review and repin before export');
  assert.equal(QUESTION_REGISTRY_VERSION, EXPECTED_REGISTRY_VERSION, 'question registry version changed; review and repin before export');
  assert.equal(QUESTION_REGISTRY_SCHEMA_VERSION, EXPECTED_SCHEMA_VERSION, 'question schema version changed; review and repin before export');
  assert.equal(QUESTION_REGISTRY_HASH, EXPECTED_REGISTRY_HASH, 'question registry hash changed; review and repin before export');
  assert.deepEqual(QUESTION_POLICY, {
    ...EXPECTED_POLICY,
    policyDocumentHash: EXPECTED_POLICY_SOURCE_SHA256
  }, 'promotion policy state changed; review and repin before export');
}

function mapDefinitions(registry) {
  assert.ok(Array.isArray(registry), 'registry definitions must be an array');
  const ids = registry.map((definition) => definition?.questionId);
  assert.equal(new Set(ids).size, ids.length, 'registry contains duplicate question IDs');
  assert.deepEqual(ids, REGISTRY_IDS, 'registry definitions are missing, added, or reordered from the reviewed seven-question set');

  const byId = new Map(registry.map((definition) => [definition.questionId, definition]));
  for (const id of REGISTRY_IDS) {
    const definition = byId.get(id);
    assert.ok(definition, `registry definition is missing: ${id}`);
    assert.equal(definition.definitionHash, EXPECTED_DEFINITION_HASHES[id], `definition hash changed: ${id}`);
    assert.equal(definition.approvalStatus, 'pending_owner_review', `definition approval state changed: ${id}`);
    assert.equal(definition.ownerApprovalAuthenticated, false, `definition owner approval state changed: ${id}`);
    assert.equal(definition.promotionStatus, 'unpromoted', `definition promotion state changed: ${id}`);
  }

  return FAMILY_SPECS.map((spec) => ({
    family: spec.family,
    ownerRole: 'Agent and research',
    status: 'candidate_pending_owner_review',
    requiredQuestionIds: [...spec.requiredQuestionIds],
    definitions: spec.requiredQuestionIds.map((questionId) => {
      const definition = byId.get(questionId);
      assert.ok(definition, `family ${spec.family} is missing definition ${questionId}`);
      return {
        questionId,
        definitionSha256: definition.definitionHash,
        stage: definition.stage,
        primitive: definition.primitive,
        approvalStatus: definition.approvalStatus,
        ownerApprovalAuthenticated: definition.ownerApprovalAuthenticated,
        promotionStatus: definition.promotionStatus
      };
    }),
    mappingLimits: [...spec.mappingLimits]
  }));
}

export function createEiQuestionInventory(registry = QUESTION_REGISTRY) {
  assertSourcePins();
  const families = mapDefinitions(registry);

  return {
    artifactType: 'ei-jev-question-family-inventory',
    artifactVersion: '1.0.0',
    status: 'candidate_pending_owner_review',
    ownerRole: 'Agent and research',
    ownerApprovalAuthenticated: false,
    promotionStatus: 'unpromoted',
    sourcePins: {
      eventIntelligenceRevision: REVIEWED_SOURCE_REVISION,
      revisionPinMethod: 'explicit_reviewed_snapshot; does not infer the generated commit Git HEAD',
      registry: {
        sourcePath: 'src/decisions/questions/registry.mjs',
        sourceSha256: EXPECTED_REGISTRY_SOURCE_SHA256,
        registryVersion: EXPECTED_REGISTRY_VERSION,
        schemaVersion: EXPECTED_SCHEMA_VERSION,
        registryHash: EXPECTED_REGISTRY_HASH
      },
      policy: {
        sourcePath: 'evals/policies/promotion-v1.json',
        sourceSha256: EXPECTED_POLICY_SOURCE_SHA256,
        policyId: EXPECTED_POLICY.policyId,
        policyVersion: EXPECTED_POLICY.policyVersion,
        policyStatus: EXPECTED_POLICY.policyStatus,
        configuredRegistryVersion: EXPECTED_POLICY.configuredRegistryVersion,
        configuredRegistryVersionStatus: EXPECTED_POLICY.configuredRegistryVersionStatus
      },
      harnessTargetContext: {
        repository: 'agent-harness',
        revision: 'f55c409602e6b67008e7462174bb77de97667c85',
        path: 'evals/jev/promotion-targets.json',
        blobSha1: 'd05e630b65a9930313c0116a6ee46fb3bd30d3af',
        contentSha256: '184d5f4b764b0b26218b5fa03b27e44364514f99e5443b0ea813206f2d9311a1',
        familyKeys: FAMILY_SPECS.map((spec) => spec.family),
        requiredQuestionIdsState: 'empty_in_target',
        definitionRevision: null,
        use: 'context_only; does not imply Harness consumption or acceptance'
      }
    },
    families,
    excludedDefinitions: [
      {
        questionId: 'Q-EI-BRAND-ROLE:v1',
        family: 'brand_asset_classification',
        ownerRole: 'Creative and fulfillment',
        reason: 'Creative owns this family; its definition remains in EI registry but is excluded from the five EI family mappings.'
      }
    ],
    acceptanceTrace: ACCEPTANCE_TRACE.map((entry) => ({ ...entry, acceptanceIds: [...entry.acceptanceIds] })),
    ownerRoleBoundaries: [
      { acceptanceIds: ['AGT-01', 'AGT-04', 'AGT-05'], ownerRole: 'Agent and research' },
      { acceptanceIds: ['ART-05'], ownerRole: 'Creative and fulfillment' },
      { acceptanceIds: ['EVAL-02', 'FIN-01', 'FIN-03', 'FIN-04'], ownerRole: 'Finance and reliability' },
      { acceptanceIds: ['CON-01', 'CON-02', 'CON-03'], ownerRoleStatus: 'existing contract and consumer owner roles unchanged' }
    ],
    limitations: [
      'Candidate mapping only; it is not owner approval, owner acknowledgment, external contract acceptance, active routing, or issue closure.',
      'Acceptance IDs are trace references only and do not establish any global criterion as complete.',
      'No approved thresholds, dataset or split hashes, model selection, cost decision, evaluation result, or paid-execution authorization is supplied.'
    ]
  };
}

export function validateEiQuestionInventory(inventory) {
  const expected = createEiQuestionInventory();
  assert.deepStrictEqual(inventory, expected, 'inventory does not match the exact pinned EI candidate crosswalk');
  return true;
}

export function renderEiQuestionInventory(inventory = createEiQuestionInventory()) {
  validateEiQuestionInventory(inventory);
  return `${JSON.stringify(inventory, null, 2)}\n`;
}

function runCli(argv) {
  if (argv.length !== 1 || !['--write', '--check'].includes(argv[0])) {
    throw new Error('Usage: node tools/export_ei_question_inventory.mjs --write|--check');
  }

  if (argv[0] === '--write') {
    mkdirSync(new URL('../evals/jev/', import.meta.url), { recursive: true });
    writeFileSync(INVENTORY_URL, renderEiQuestionInventory(), 'utf8');
    process.stdout.write('Wrote pinned EI JEV candidate inventory.\n');
    return;
  }

  const actualBytes = readFileSync(INVENTORY_URL, 'utf8');
  const inventory = JSON.parse(actualBytes);
  validateEiQuestionInventory(inventory);
  assert.equal(actualBytes, renderEiQuestionInventory(inventory), 'inventory bytes are not the deterministic exported representation');
  process.stdout.write('EI JEV candidate inventory is valid and deterministic.\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
