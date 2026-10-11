import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as candidateValidators from '../../contracts/research-contract-v1/candidate-upstream/generated/validators.mjs';
import {
  assertFixture,
  canonicalFixtureDigest,
  evaluateFixture,
  fixturePayload
} from './candidate-harness.mjs';
import { canonicalJson, hashManifest, parseContract } from '../../contracts/research-contract-v1/candidate-upstream/tooling/runtime.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const candidateRoot = path.join(repoRoot, 'tests/contracts/research-contract-v1/candidate-upstream');
export const artifactPath = path.join(repoRoot, 'tests/contracts/research-contract-v1/candidate-validation.json');
const requiredCount = 257;
const expectedContracts = [
  'CommonEnvelope',
  'ErrorEnvelope',
  'ResearchRequest',
  'EventIntelligencePackage',
  'DecisionPortRequest',
  'DecisionPortResult',
  'ResearchRequestReceipt',
  'ResearchAnswerReceipt',
  'ResearchBatchReceipt',
  'ResearchCorrectionRequest',
  'ResearchCorrectionReceipt',
  'ResearchInvalidation'
];

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const gitBlobSha1 = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const rel = absolute => path.relative(repoRoot, absolute).split(path.sep).join('/');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const fileHash = async file => sha256(await readFile(file));
const fail = message => { throw new Error(message); };

export function assertPinnedBytes(bytes, expectedSha256, label) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) fail(`Missing pinned input bytes for ${label}`);
  const actual = sha256(bytes);
  if (actual !== expectedSha256) fail(`Pinned source hash mismatch for ${label}`);
  return actual;
}

export async function readPinnedSource(file, expectedSha256, label) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`Missing pinned input for ${label}`);
    throw error;
  }
  assertPinnedBytes(bytes, expectedSha256, label);
  return bytes;
}

export function assertExecutionComplete({ expectedCases, executedCases, failedCases, skippedCases }) {
  if (!Number.isInteger(expectedCases) || expectedCases <= 0) fail('Required case count must be nonzero');
  if (executedCases !== expectedCases || failedCases !== 0 || skippedCases !== 0) {
    fail(`Required case execution incomplete: expected=${expectedCases}, executed=${executedCases}, failed=${failedCases}, skipped=${skippedCases}`);
  }
}
const schemaFiles = async () => {
  const { readdir } = await import('node:fs/promises');
  const walk = async dir => {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(entries.map(entry => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : entry.isFile() && entry.name.endsWith('.json') ? [full] : [];
    }));
    return nested.flat();
  };
  return (await walk(path.join(candidateRoot, 'schemas'))).sort();
};

function pointerTarget(root, fragment) {
  if (!fragment || fragment === '#') return root;
  const pointer = fragment.startsWith('#/') ? fragment.slice(2) : fragment.startsWith('/') ? fragment.slice(1) : null;
  if (pointer === null) return undefined;
  return pointer.split('/').map(part => part.replaceAll('~1', '/').replaceAll('~0', '~')).reduce((value, part) => value?.[part], root);
}

function actualSummary(result) {
  if (result?.ok === true) return { ok: true };
  if (result?.ok !== false || !Array.isArray(result.errors)) fail('Candidate returned a non-contract result');
  return {
    ok: false,
    errors: result.errors.map(error => ({
      code: error.code,
      path: error.path,
      ...(error.keyword ? { keyword: error.keyword } : {})
    }))
  };
}

function expectedSummary(expected) {
  return expected.ok
    ? { ok: true, ...(expected.canonical_sha256 ? { canonical_sha256: expected.canonical_sha256 } : {}) }
    : { ok: false, code: expected.code, path: expected.path };
}

function expectedMatches(actual, expected) {
  if (expected.ok) return actual.ok;
  return !actual.ok && actual.errors.some(error => error.code === expected.code && error.path === expected.path);
}

function assertNoMutation(before, after, label) {
  if (canonicalJson(before) !== canonicalJson(after)) fail(`Candidate mutated ${label}`);
}

export function verifySchemaClosure(schemas) {
  const byId = new Map(schemas.map(schema => [schema.$id, schema]));
  const unresolved = [];
  let references = 0;
  const visit = (value, from) => {
    if (Array.isArray(value)) return value.forEach(child => visit(child, from));
    if (!value || typeof value !== 'object') return;
    if (typeof value.$ref === 'string') {
      references += 1;
      const [targetId, fragment = ''] = value.$ref.split('#', 2);
      const target = targetId ? byId.get(targetId) : schemas.find(schema => schema.$id === from);
      if (!target || pointerTarget(target, fragment) === undefined) unresolved.push({ from, ref: value.$ref });
    }
    for (const child of Object.values(value)) visit(child, from);
  };
  for (const schema of schemas) visit(schema, schema.$id);
  if (unresolved.length) fail(`Unresolved schema references: ${canonicalJson(unresolved)}`);
  return references;
}

async function pinnedHashMap() {
  const pins = await json(path.join(candidateRoot, 'audit-inputs/source-pins.json'));
  if (pins.current_head?.commit !== 'b47defaaf630c9d64dcc315c6c4d49fadd194587' || pins.independently_reviewed_head?.commit !== '795608ef8d1d91f5fed2dfd77206572adb3970e8') {
    fail('Shared-contracts source and review basis pins changed');
  }
  if (pins.research_schemas.length !== 12 || pins.research_fixtures.length !== 12 ||
      [...pins.research_schemas, ...pins.research_fixtures].some(row => row.same_bytes_at_reviewed_and_current !== true)) {
    fail('Expected all 12 candidate schemas and fixtures to be pinned unchanged at reviewed and current heads');
  }
  const rows = [...pins.research_schemas, ...pins.research_fixtures, ...pins.research_executable_context, ...pins.crosscut_support];
  const map = new Map(rows.map(row => [row.path, row.sha256.replace(/^sha256:/, '')]));
  const rowsByPath = new Map(rows.map(row => [row.path, row]));
  return { pins, map, rowsByPath };
}

async function verifyPinnedSources(map, rowsByPath) {
  const selectedPaths = [
    ...expectedContracts.map(contract => `schemas/${contract}/1.0.0.json`),
    ...expectedContracts.map(contract => `fixtures/${contract}.json`),
    'compatibility/research-reference-findings.json',
    'compatibility/version-policy.json',
    'generated/registry.mjs',
    'tooling/runtime.mjs',
    'tooling/operations.mjs',
    'tooling/research-creative.mjs',
    'tooling/fixture-harness.mjs',
    'tests/research-reference-cases.mjs',
    'tests/research-reference-consistency.test.mjs',
    'tests/research-batch-cases.mjs',
    'tests/research-batch-semantics.test.mjs'
  ];
  const checked = [];
  for (const sourcePath of selectedPaths) {
    const expected = map.get(sourcePath);
    if (!expected) fail(`Missing source pin for ${sourcePath}`);
    const bytes = await readPinnedSource(path.join(candidateRoot, sourcePath), expected, sourcePath);
    const row = rowsByPath.get(sourcePath);
    if (!row?.current_git_blob || gitBlobSha1(bytes) !== row.current_git_blob) fail(`Pinned git blob mismatch for ${sourcePath}`);
    checked.push({ path: sourcePath, sha256: expected, git_blob: row.current_git_blob });
  }
  return checked;
}

async function verifyTransitiveInputs(pins, rowsByPath) {
  const dependencyPins = await json(path.join(candidateRoot, 'audit-inputs/transitive-dependency-pins.json'));
  if (dependencyPins.source_commit !== pins.current_head.commit || dependencyPins.repository !== pins.repository) fail('Transitive dependency snapshot identity mismatch');
  const generator = rowsByPath.get(dependencyPins.generator_source.path);
  if (!generator || generator.sha256.replace(/^sha256:/, '') !== dependencyPins.generator_source.sha256 || generator.current_git_blob !== dependencyPins.generator_source.git_blob) {
    fail('Candidate generator source pin mismatch');
  }
  const checked = [];
  for (const item of dependencyPins.files) {
    const bytes = await readPinnedSource(path.join(candidateRoot, item.path), item.sha256, item.path);
    const blob = gitBlobSha1(bytes);
    if (blob !== item.git_blob) fail(`Transitive dependency git blob mismatch for ${item.path}`);
    checked.push({ path: item.path, sha256: item.sha256, git_blob: blob });
  }
  const pkg = await json(path.join(repoRoot, 'package.json'));
  const lock = await json(path.join(repoRoot, 'package-lock.json'));
  const ajv = lock.packages?.['node_modules/ajv'];
  if (pkg.devDependencies?.ajv !== '8.17.1' || ajv?.version !== '8.17.1' || !ajv.integrity || ajv.dev !== true) {
    fail('Ajv test-only dependency is not exactly pinned in package and lock files');
  }
  return { dependencyPins, checked, ajv: { version: ajv.version, integrity: ajv.integrity, dev: ajv.dev } };
}

async function runResearchReferenceSupplement() {
  const bindings = [
    { contract: 'ResearchAnswerReceipt', fixture: 'semantic-positive', field: 'package_ref', expected: { 'stale-digest': ['INVALID_RECEIPT', '/package_ref'], 'wrong-contract': ['INVALID_RECEIPT', '/package_ref'], 'wrong-version': ['INVALID_PAYLOAD', '/package_ref/schema_version'], 'wrong-revision': ['INVALID_RECEIPT', '/package_ref'] } },
    { contract: 'EventIntelligencePackage', fixture: 'parent-linked-new-version', field: 'parent_ref', expected: { 'stale-digest': ['REFERENCE_MISMATCH', '/package_hash'], 'wrong-contract': ['REFERENCE_MISMATCH', '/parent_ref'], 'wrong-version': ['INVALID_PAYLOAD', '/parent_ref/schema_version'], 'wrong-revision': ['REFERENCE_MISMATCH', '/package_hash'] } },
    { contract: 'ResearchCorrectionRequest', fixture: 'semantic-positive', field: 'expected_package_ref', expected: { 'stale-digest': ['STALE_REVISION', '/expected_package_ref'], 'wrong-contract': ['REFERENCE_MISMATCH', '/expected_package_ref'], 'wrong-version': ['INVALID_PAYLOAD', '/expected_package_ref/schema_version'], 'wrong-revision': ['STALE_REVISION', '/expected_package_ref'] } },
    { contract: 'ResearchCorrectionReceipt', fixture: 'externally-accepted-new-version', field: 'new_package_ref', expected: { 'stale-digest': ['INVALID_RECEIPT', '/new_package_ref'], 'wrong-contract': ['REFERENCE_MISMATCH', '/new_package_ref'], 'wrong-version': ['INVALID_PAYLOAD', '/new_package_ref/schema_version'], 'wrong-revision': ['INVALID_RECEIPT', '/new_package_ref'] } }
  ];
  const rows = [];
  for (const binding of bindings) {
    const manifest = await json(path.join(candidateRoot, `fixtures/${binding.contract}.json`));
    const fixture = manifest.cases.find(row => row.id === binding.fixture);
    if (!fixture) fail(`Missing SC-CHK-011 source fixture ${binding.contract}/${binding.fixture}`);
    const basePayload = fixturePayload(manifest, fixture);
    const baseContext = structuredClone(fixture.context);
    const exact = evaluateFixture(binding.contract, manifest, fixture, { payload: structuredClone(basePayload), context: structuredClone(baseContext) });
    const exactExpected = { ok: true };
    assertFixture(exact, exactExpected);
    rows.push({
      source_finding: 'SC-CHK-011',
      id: `${binding.contract}/${binding.field}/record-exact`,
      expected: exactExpected,
      actual: actualSummary(exact),
      input_sha256: hashManifest({ contract: binding.contract, fixture: binding.fixture, payload: basePayload, context: baseContext }),
      matched: true
    });
    for (const mutation of ['stale-digest', 'wrong-contract', 'wrong-version', 'wrong-revision']) {
      const payload = structuredClone(basePayload);
      const context = structuredClone(baseContext);
      const ref = payload[binding.field];
      if (mutation === 'stale-digest') ref.content_hash = `sha256:${'f'.repeat(64)}`;
      if (mutation === 'wrong-contract') ref.contract = 'OrderAuthorization';
      if (mutation === 'wrong-version') ref.schema_version = '9.0.0';
      if (mutation === 'wrong-revision') ref.revision += 1;
      context.references[binding.field] = structuredClone(ref);
      if (binding.field === 'expected_package_ref') context.correction_authority.expected_package_ref = structuredClone(ref);
      const result = evaluateFixture(binding.contract, manifest, fixture, { payload, context });
      const [code, errorPath] = binding.expected[mutation];
      const expected = { ok: false, code, path: errorPath };
      assertFixture(result, expected);
      rows.push({
        source_finding: 'SC-CHK-011',
        id: `${binding.contract}/${binding.field}/${mutation}`,
        expected,
        actual: actualSummary(result),
        input_sha256: hashManifest({ contract: binding.contract, fixture: binding.fixture, mutation, payload, context }),
        matched: true
      });
    }
  }
  if (rows.length !== 20 || rows.some(row => !row.matched)) fail('SC-CHK-011 selected research-reference matrix incomplete');
  return rows;
}

export async function runCandidateCompatibility() {
  const { pins, map, rowsByPath } = await pinnedHashMap();
  const selectedSourceHashes = await verifyPinnedSources(map, rowsByPath);
  const transitiveInputs = await verifyTransitiveInputs(pins, rowsByPath);
  const schemaPaths = await schemaFiles();
  if (schemaPaths.length !== 15) fail(`Expected 15 pinned schemas in the narrow closure; found ${schemaPaths.length}`);
  const schemas = await Promise.all(schemaPaths.map(json));
  const referenceCount = verifySchemaClosure(schemas);
  for (const contract of expectedContracts) {
    const schema = schemas.find(candidate => candidate.$id === `https://schemas.jevelopers.org/${contract}/1.0.0`);
    const exportName = `${contract}_1_0_0`;
    if (!schema || typeof candidateValidators[exportName] !== 'function') fail(`Missing compiled candidate schema for ${contract}`);
  }
  for (const exportName of ['BudgetReservation_1_0_0', 'BudgetReservation_2_0_0', 'ReserveRequest_2_0_0', 'DefinitionVersionedReference', 'DefinitionDecisionQuestion']) {
    if (typeof candidateValidators[exportName] !== 'function') fail(`Missing pinned helper schema export ${exportName}`);
  }

    const fixtureHashes = [];
  const records = [];
  const failedCases = [];
  const contractCounts = {};
  for (const contract of expectedContracts) {
    const fixturePath = path.join(candidateRoot, `fixtures/${contract}.json`);
    const manifest = await json(fixturePath);
    const pinnedManifestSha = map.get(`fixtures/${contract}.json`);
    if (!pinnedManifestSha || await fileHash(fixturePath) !== pinnedManifestSha) fail(`Fixture manifest pin mismatch for ${contract}`);
    if (manifest.contract !== contract || manifest.schema_version !== '1.0.0' || manifest.policy_version !== '1.0.0' || !Array.isArray(manifest.cases)) {
      fail(`Invalid pinned fixture manifest for ${contract}`);
    }
    if (manifest.status !== (contract === 'CommonEnvelope' ? 'synthetic_foundation_candidate' : 'synthetic_candidate_owner_review_pending')) {
      fail(`Fixture metadata status changed for ${contract}`);
    }
    fixtureHashes.push({ contract, path: rel(fixturePath), sha256: pinnedManifestSha, status: manifest.status, schema_version: manifest.schema_version, policy_version: manifest.policy_version, case_count: manifest.cases.length });
    const ids = new Set();
    contractCounts[contract] = manifest.cases.length;
    for (const fixture of manifest.cases) {
      if (!fixture.id || ids.has(fixture.id) || fixture.policy_version !== manifest.policy_version) fail(`Invalid/duplicate fixture row ${contract}/${fixture.id}`);
      ids.add(fixture.id);
      const payload = fixturePayload(manifest, fixture);
      const contextForEvaluation = fixture.mode === 'context'
        ? structuredClone(fixture.expected_context)
        : fixture.context === undefined ? undefined : structuredClone(fixture.context);
      const contextBefore = contextForEvaluation === undefined ? null : structuredClone(contextForEvaluation);
      const payloadBefore = structuredClone(payload);
      const actualRaw = evaluateFixture(contract, manifest, fixture, { payload, context: contextForEvaluation });
      assertNoMutation(payloadBefore, payload, `${contract}/${fixture.id} payload`);
      if (contextBefore !== null) assertNoMutation(contextBefore, contextForEvaluation, `${contract}/${fixture.id} context`);
      const actual = actualSummary(actualRaw);
      let matched = expectedMatches(actual, fixture.expected);
      try {
        assertFixture(actualRaw, fixture.expected);
      } catch (error) {
        matched = false;
        failedCases.push({ contract, case: fixture.id, message: error.message });
      }
      if (!matched && !failedCases.some(row => row.contract === contract && row.case === fixture.id)) {
        failedCases.push({ contract, case: fixture.id, message: 'Actual typed result did not match pinned expectation' });
      }
      let roundtrip = null;
      if (actualRaw.ok) {
        const bytes = canonicalJson(actualRaw.value);
        const reparsed = parseContract(contract, bytes);
        assertFixture(reparsed, { ok: true, value: actualRaw.value });
        if (canonicalJson(reparsed.value) !== bytes) fail(`Round-trip serialization drift for ${contract}/${fixture.id}`);
        roundtrip = { ok: true, canonical_sha256: canonicalFixtureDigest(reparsed.value) };
      }
      records.push({
        contract,
        case: fixture.id,
        category: fixture.category,
        mode: fixture.mode ?? 'structural',
        expected: expectedSummary(fixture.expected),
        actual,
        matched,
        ...(roundtrip ? { roundtrip } : {}),
        ...(actualRaw.ok ? { actual_canonical_sha256: canonicalFixtureDigest(actualRaw.value) } : {})
      });
    }
  }

  const policyHash = map.get('compatibility/version-policy.json');
  const policyActual = await fileHash(path.join(candidateRoot, 'compatibility/version-policy.json'));
  if (!policyHash || policyHash !== policyActual) fail('Version policy source pin mismatch');
  const matrix = await json(path.join(candidateRoot, 'audit-inputs/candidate-fixture-matrix.json'));
  if (matrix.count_summary?.schema_documents !== 12 || matrix.count_summary?.fixture_manifests !== 12 || matrix.count_summary?.total_fixture_cases !== requiredCount || matrix.fixtures?.length !== 12) {
    fail('Pinned fixture matrix scope differs from the required 12 schemas/12 manifests/257 cases');
  }
  if (Object.keys(matrix.schema_policy?.candidate_research_versions ?? {}).length !== 12 ||
      Object.values(matrix.schema_policy.candidate_research_versions).some(versions => canonicalJson(versions) !== '["1.0.0"]')) {
    fail('Candidate matrix version scope changed');
  }
  const requiredCategories = ['minimal', 'full', 'missing', 'type', 'enum', 'malformed_json', 'unsupported_version', 'unknown_field', 'unknown_critical', 'additive_field', 'retained_encoding'];
  const observedCategories = [...new Set(records.map(record => record.category))].sort();
  const missingCategories = requiredCategories.filter(category => !observedCategories.includes(category));
  if (missingCategories.length) fail(`Required fixture categories absent: ${missingCategories.join(', ')}`);
  const count = records.length;
  const passed = records.filter(record => record.matched).length;
  const failed = count - passed;
  assertExecutionComplete({ expectedCases: requiredCount, executedCases: count, failedCases: failed, skippedCases: 0 });
  if (failedCases.length !== 0) fail(`Candidate fixture mismatches: ${canonicalJson(failedCases)}`);

  const financeSupport = [];
  for (const relative of ['schemas/BudgetReservation/1.0.0.json', 'schemas/BudgetReservation/2.0.0.json', 'schemas/ReserveRequest/2.0.0.json']) {
    const file = path.join(candidateRoot, relative);
    financeSupport.push({ path: rel(file), sha256: await fileHash(file) });
  }
  const scChk011Rows = await runResearchReferenceSupplement();

  return {
    artifact_version: '1.0.0',
    classification: 'candidate_only_unaccepted_compatibility_evidence',
    mode: 'offline_fixture_compatibility',
    repository: pins.repository,
    selected_candidate: {
      pull_request: pins.pull_request,
      base_commit: pins.base.commit,
      reviewed_basis_commit: pins.independently_reviewed_head.commit,
      current_candidate_commit: pins.current_head.commit,
      current_candidate_status: 'open_draft_unapproved',
      accepted_schema_versions: [],
      version_behavior: {
        candidate_unsupported_version_error: 'UNSUPPORTED_VERSION',
        EI_issue_required_unknown_schema_error: 'UNSUPPORTED_SCHEMA',
        candidate_unknown_additive_fields: 'reject',
        EI_issue_compatibility_expectation: 'preserve old-minor and additive fields',
        candidate_policy: 'exact_semver; accepted_schema_versions is empty'
      }
    },
    validator_harness: {
      source: 'exact pinned raw JSON schemas in this artifact',
      implementation: 'test-only schema adapter using Ajv 8.17.1 and the candidate generator exact Draft 2020-12 compiler options and uuid/utc-time formats',
      adapted_surface: 'schema compilation adapter only; candidate runtime, registry, operations, finance-v2 and research-creative helpers are exact pinned bytes',
      related_test_harness: 'EI-only extraction of fixturePayload/assertFixture/evaluateFixture; excluded commerce, production, capability, and historical-finance fixture routes'
    },
    input_integrity: {
      source_pins_json_sha256: await fileHash(path.join(candidateRoot, 'audit-inputs/source-pins.json')),
      fixture_matrix_sha256: await fileHash(path.join(candidateRoot, 'audit-inputs/candidate-fixture-matrix.json')),
      version_policy_sha256: policyActual,
      schema_documents: await Promise.all(schemas.map(async (schema, index) => ({ path: rel(schemaPaths[index]), id: schema.$id, sha256: await fileHash(schemaPaths[index]) }))),
      schema_reference_count: referenceCount,
      schema_reference_unresolved_count: 0,
      selected_source_pins: selectedSourceHashes,
      generator_source_pin: rowsByPath.get('scripts/generate.mjs'),
      transitive_dependencies: transitiveInputs.checked,
      test_only_validator_dependency: transitiveInputs.ajv,
      finance_support_schemas: financeSupport
    },
    outcome: {
      expected_cases: requiredCount,
      executed_cases: count,
      passed_cases: passed,
      failed_cases: failed,
      skipped_cases: 0,
      contract_case_counts: contractCounts,
      required_categories: requiredCategories,
      observed_categories: observedCategories,
      fixture_manifests: fixtureHashes,
      supplemental_sc_chk_011_cases: scChk011Rows.length,
      failures: failedCases
    },
    cases: records,
    supplemental_research_reference_cases: scChk011Rows
  };
}

if (process.argv.includes('--write')) {
  const result = await runCandidateCompatibility();
  await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${rel(artifactPath)} ${result.outcome.passed_cases}/${result.outcome.executed_cases} cases passed\n`);
}
