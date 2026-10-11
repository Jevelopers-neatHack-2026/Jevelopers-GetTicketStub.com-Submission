import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { candidateRoot, artifactPath, assertExecutionComplete, assertPinnedBytes, readPinnedSource, runCandidateCompatibility, verifySchemaClosure } from './run-candidate-compatibility.mjs';
import { evaluateFixture, fixturePayload } from './candidate-harness.mjs';
import { researchContentHash } from '../../contracts/research-contract-v1/candidate-upstream/tooling/research-creative.mjs';

test('the pinned EI candidate runs every required offline fixture without skipped rows', async () => {
  const actual = await runCandidateCompatibility();
  const committed = JSON.parse(await readFile(artifactPath, 'utf8'));
  assert.deepEqual(actual, committed);
  assert.equal(actual.classification, 'candidate_only_unaccepted_compatibility_evidence');
  assert.equal(actual.outcome.expected_cases, 257);
  assert.equal(actual.outcome.executed_cases, 257);
  assert.equal(actual.outcome.passed_cases, 257);
  assert.equal(actual.outcome.failed_cases, 0);
  assert.equal(actual.outcome.skipped_cases, 0);
  assert.equal(actual.input_integrity.schema_reference_unresolved_count, 0);
  assert.equal(actual.cases.length, 257);
  assert.ok(actual.cases.every(row => row.matched));
  assert.equal(actual.outcome.supplemental_sc_chk_011_cases, 20);
  assert.equal(actual.supplemental_research_reference_cases.length, 20);
  assert.ok(actual.supplemental_research_reference_cases.every(row => row.matched));
});

test('candidate and EI issue version semantics remain visibly distinct', async () => {
  const actual = await runCandidateCompatibility();
  assert.deepEqual(actual.selected_candidate.version_behavior, {
    candidate_unsupported_version_error: 'UNSUPPORTED_VERSION',
    EI_issue_required_unknown_schema_error: 'UNSUPPORTED_SCHEMA',
    candidate_unknown_additive_fields: 'reject',
    EI_issue_compatibility_expectation: 'preserve old-minor and additive fields',
    candidate_policy: 'exact_semver; accepted_schema_versions is empty'
  });
  const versionCase = actual.cases.find(row => row.contract === 'DecisionPortRequest' && row.case === 'unsupported-version');
  const additiveCase = actual.cases.find(row => row.contract === 'DecisionPortRequest' && row.case === 'additive_field');
  assert.equal(versionCase.actual.errors[0].code, 'UNSUPPORTED_VERSION');
  assert.equal(additiveCase.actual.errors[0].code, 'INVALID_PAYLOAD');
});

test('missing, changed, unresolved, skipped and unsupported inputs fail closed', async () => {
  assert.throws(() => assertPinnedBytes(Buffer.from('drift'), '0'.repeat(64), 'negative-control'), /Pinned source hash mismatch/);
  await assert.rejects(
    readPinnedSource(path.join(candidateRoot, 'fixtures/__required_missing__.json'), '0'.repeat(64), 'negative-missing-file'),
    /Missing pinned input/
  );
  assert.throws(() => assertExecutionComplete({ expectedCases: 257, executedCases: 256, failedCases: 0, skippedCases: 1 }), /execution incomplete/);
  assert.throws(() => assertExecutionComplete({ expectedCases: 0, executedCases: 0, failedCases: 0, skippedCases: 0 }), /nonzero/);
  assert.throws(() => verifySchemaClosure([{ $id: 'https://schemas.jevelopers.org/Only/1.0.0', $ref: 'https://schemas.jevelopers.org/Missing/1.0.0' }]), /Unresolved schema references/);
  assert.throws(() => evaluateFixture('ResearchRequest', { valid: {} }, { mode: 'unsupported_stub' }), /Unsupported EI fixture mode/);
});

test('synthetic unknown, timeout, cancellation, abstain and unavailable outcomes stay data-only', async () => {
  const actual = await runCandidateCompatibility();
  const noulConfidence = actual.cases.find(row => row.contract === 'DecisionPortResult' && row.case === 'noul-confidence-forbidden');
  assert.equal(noulConfidence.expected.code, 'INVALID_PAYLOAD');
  assert.equal(noulConfidence.expected.path, '/answers/noul_1/answer');
  assert.equal(noulConfidence.matched, true);
  const cyclic = actual.cases.find(row => row.contract === 'DecisionPortRequest' && row.case === 'cyclic-batch');
  assert.equal(cyclic.expected.code, 'CYCLIC_DEPENDENCY');
  assert.equal(cyclic.matched, true);
  const dependent = actual.cases.find(row => row.contract === 'DecisionPortRequest' && row.case === 'dependent-siblings');
  assert.equal(dependent.expected.code, 'DEPENDENT_BATCH');
  assert.equal(dependent.matched, true);
  for (const caseId of [
    'unusable-unknown-known-accounting',
    'unusable-abstain-known-accounting',
    'unusable-unavailable-known-accounting',
    'unusable-timeout-known-accounting',
    'unusable-cancelled-known-accounting',
    'unusable-malformed-known-accounting'
  ]) {
    const row = actual.cases.find(candidate => candidate.contract === 'DecisionPortResult' && candidate.case === caseId);
    assert.ok(row, `missing required data outcome ${caseId}`);
    assert.equal(row.matched, true);
  }
  assert.ok(actual.selected_candidate.accepted_schema_versions.length === 0);
});

test('parent reference mutations detect a removed pinned record-reference comparison', async () => {
  const helperPath = path.join(candidateRoot, 'tooling/research-creative.mjs');
  const helperSource = await readFile(helperPath, 'utf8');
  const comparison = ' || !recordReference(v.parent_ref, old.value, { id: old.value.package_id, revision: old.value.package_version, content_hash: old.value.package_hash })';
  assert.equal(helperSource.split(comparison).length - 1, 1, 'pinned parent comparison anchor must occur exactly once');

  const mutantPath = path.join(candidateRoot, 'tooling', `research-creative-mutant-${process.pid}-${randomUUID()}.mjs`);
  await writeFile(mutantPath, helperSource.replace(comparison, ''), 'utf8');
  try {
    const mutatedHelper = await import(pathToFileURL(mutantPath).href);
    const manifest = JSON.parse(await readFile(path.join(candidateRoot, 'fixtures/EventIntelligencePackage.json'), 'utf8'));
    const fixture = manifest.cases.find(row => row.id === 'parent-linked-new-version');
    assert.ok(fixture, 'required pinned parent fixture must exist');

    for (const mutation of ['stale-digest', 'wrong-revision']) {
      const payload = fixturePayload(manifest, fixture);
      const context = structuredClone(fixture.context);
      const ref = payload.parent_ref;
      if (mutation === 'stale-digest') ref.content_hash = `sha256:${'f'.repeat(64)}`;
      else ref.revision += 1;
      context.references.parent_ref = structuredClone(ref);
      payload.package_hash = researchContentHash(payload, 'package_hash');

      const correct = evaluateFixture('EventIntelligencePackage', manifest, fixture, { payload: structuredClone(payload), context: structuredClone(context) });
      assert.ok(!correct.ok && correct.errors.some(error => error.code === 'STALE_REVISION' && error.path === '/parent_ref'), `${mutation} must reach the parent binding check`);
      const withoutParentBinding = mutatedHelper.checkResearchCreative('EventIntelligencePackage', payload, context);
      assert.equal(withoutParentBinding.ok, true, `${mutation} must expose removal of the parent recordReference comparison`);
    }
  } finally {
    await rm(mutantPath, { force: true });
  }
});
