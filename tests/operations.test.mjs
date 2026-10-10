import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { catalog, assertFixture } from '../scripts/contracts.mjs';
import { readJson, root } from '../scripts/generate.mjs';
import { validateContract, parseContract, checkTrustedContext, hashManifest, checkOperation, compareUsageIdentity, adaptScoreProfile, bindDecisionPort, validateVersionedReference } from '../generated/index.mjs';

const entries = (await catalog()).filter(entry => entry.state === 'operations_candidate');
for (const entry of entries) {
  const manifest = await readJson(entry.fixtures);
  for (const fixture of manifest.cases) test(entry.name + ' / ' + fixture.id, () => {
    // Given a versioned canonical fixture and separately supplied server expectations.
    const payload = structuredClone(manifest.valid);
    for (const key of fixture.remove ?? []) delete payload[key];
    Object.assign(payload, fixture.set ?? {});
    // When the selected structural or semantic public boundary handles the fixture.
    let result;
    switch (fixture.mode) {
      case 'semantic': result = checkOperation(entry.name, payload, fixture.context); break;
      case 'relationship': result = compareUsageIdentity(fixture.prior, payload); break;
      case 'parse': result = parseContract(entry.name, fixture.json); break;
      case undefined: result = validateContract(entry.name, payload); break;
      default: throw new Error('Unknown fixture mode');
    }
    // Then the exact success or typed rejection matches the fixture's expectation.
    assertFixture(result, fixture.expected);
  });
}

const requestFixture = await readJson('fixtures/DecisionPortRequest.json');
const resultFixture = await readJson('fixtures/DecisionPortResult.json');
const decisionContext = resultFixture.cases.find(fixture => fixture.id === 'semantic-positive').context;

test('scope expectations remain independent when a domain payload forges tenant identity', () => {
  // Given a server expectation independent of the incoming record.
  const serverScope = { tenant_id: '123e4567-e89b-42d3-a456-426614174000', project_id: '123e4567-e89b-42d3-a456-426614174000' };
  const incoming = { ...requestFixture.valid, tenant_id: '123e4567-e89b-42d3-a456-426614174099' };
  // When the same scope helper is used with a non-CommonEnvelope discriminator.
  const result = checkTrustedContext(incoming, serverScope);
  // Then the independent expectation rejects forged scope.
  assert.deepEqual(result, { ok: false, errors: [{ code: 'SCOPE_MISMATCH', path: '/tenant_id' }] });
});

test('semantic negative harness detects an incorrectly accepted scope violation', () => {
  // Given a semantic scope-rejection fixture, when a validator incorrectly accepts it,
  // then the coverage harness cannot produce a false green.
  const fixture = requestFixture.cases.find(fixture => fixture.id === 'forged-tenant');
  assert.throws(() => assertFixture({ ok: true, value: requestFixture.valid }, fixture.expected));
});

test('explicit Score profile adaptation round trips structured content without owner acceptance', () => {
  // Given structured inert descriptions, including a nested object and array.
  const source = { ...requestFixture.valid.questions.score_1, criteria: [{ level: 'low', examples: ['one', 'two'] }, ['high']] };
  // When the explicit adapter encodes and decodes the profile.
  const encoded = adaptScoreProfile(source, 'ei-string-v1');
  assert.equal(encoded.ok, true);
  const decoded = adaptScoreProfile(encoded.value.target, 'structured-index-v1');
  // Then all original fields survive and migration acceptance remains false.
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.value.target, source);
  assert.deepEqual(encoded.value.source, source);
  assert.equal(decoded.value.accepted_migration, false);
});

test('opaque legacy Score text is rejected rather than silently normalized', () => {
  // Given the EI profile with non-JSON opaque criteria and legend text.
  const source = { ...requestFixture.valid.questions.score_1, profile: 'ei-string-v1', criteria: 'Opaque producer criteria', index_labels: ['low', 'high'], legacy_legend: 'Opaque producer legend' };
  // When a structured conversion is requested, then its explicit typed refusal is returned.
  assert.deepEqual(adaptScoreProfile(source, 'structured-index-v1'), { ok: false, errors: [{ code: 'PROFILE_UNREPRESENTABLE', path: '/criteria' }] });
});

test('versioned references reject unsupported major versions', () => {
  // Given an unsupported version in an immutable reference, when parsed, then version negotiation fails.
  const reference = { ...requestFixture.valid.state_ref, schema_version: '2.0.0' };
  assert.deepEqual(validateVersionedReference(reference), { ok: false, errors: [{ code: 'UNSUPPORTED_VERSION', path: '/schema_version' }] });
});

test('injected port rejects forged scope before invoking its supplied implementation', async () => {
  // Given a fake implementation and independently supplied server context.
  let calls = 0;
  const port = bindDecisionPort(() => { calls++; return resultFixture.valid; });
  // When a forged request reaches the port.
  const result = await port.decide({ ...requestFixture.valid, project_id: '123e4567-e89b-42d3-a456-426614174099' }, decisionContext);
  // Then there is no dispatch, paid retry or usable result.
  assert.equal(result.ok, false); assert.equal(calls, 0);
});

test('injected port protects its request and policy snapshots from callback mutation', async () => {
  // Given a callback that attempts to replace caller policy with a privileged candidate.
  const input = structuredClone(requestFixture.valid);
  let protectedSnapshots = false;
  const port = bindDecisionPort((request, context) => {
    protectedSnapshots = Object.isFrozen(request.questions.choice_1) && Object.isFrozen(context.allowed_candidates.choice_1);
    assert.throws(() => context.allowed_candidates.choice_1.push('publish'), TypeError);
    return resultFixture.valid;
  });
  // When a valid request is dispatched to that explicit fake callback.
  const result = await port.decide(input, decisionContext);
  // Then the original request/policy remain unchanged and the valid result is checked.
  assert.equal(result.ok, true); assert.equal(protectedSnapshots, true);
  assert.deepEqual(input, requestFixture.valid);
});

test('inert instructions resembling a reference cannot become an authority lookup', () => {
  // Given an inert description whose data happens to resemble a versioned reference.
  const request = structuredClone(requestFixture.valid);
  request.questions.score_1.instructions = { schema_version: '1.0.0', id: 'not-an-authority', content_hash: 'private-text' };
  // When its real authority references are separately bound.
  const result = checkOperation('DecisionPortRequest', request, decisionContext);
  // Then inert data is preserved without being reinterpreted as access/authority.
  assert.equal(result.ok, true);
});

test('decision confidence and attempts cannot override server policy', () => {
  // Given a caller lowering a review threshold under an unchanged policy reference.
  const request = structuredClone(requestFixture.valid);
  request.questions.choice_1.minimum_confidence = 0;
  // When checked against the independently supplied policy, then the override is rejected.
  assert.deepEqual(checkOperation('DecisionPortRequest', request, decisionContext), { ok: false, errors: [{ code: 'POLICY_MISMATCH', path: '/questions/choice_1/minimum_confidence' }] });
});

test('an expired or declined current budget cannot dispatch the injected decision', async () => {
  // Given an expired finance record and a request whose own deadline remains later.
  let calls = 0;
  const port = bindDecisionPort(() => { calls++; return resultFixture.valid; });
  const context = { ...decisionContext, budget: { ...decisionContext.budget, expires_at: '2026-10-10T11:00:00Z' } };
  // When the request crosses the port, then no callback runs on stale capacity.
  const result = await port.decide(requestFixture.valid, context);
  assert.deepEqual(result, { ok: false, errors: [{ code: 'BUDGET_UNAVAILABLE', path: '/budget_ref' }] });
  assert.equal(calls, 0);
});

test('foundation schema bytes remain pinned while operations reference their primitives', async () => {
  // Given the immutable foundation baselines, when compared to current source bytes,
  // then the new group has not silently rewritten existing contracts.
  const { createHash } = await import('node:crypto');
  const baselines = await readJson('compatibility/baselines.json');
  for (const baseline of baselines.schemas.filter(row => ['CommonEnvelope', 'EvidenceProjection'].includes(row.contract))) {
    assert.equal(createHash('sha256').update(await readFile(root + baseline.path)).digest('hex'), baseline.sha256);
  }
});

for (const [name, body, diagnostic] of [
  ['Noul confidence', "import type { DecisionPortResult } from 'PUBLIC_API'; type Answer = Extract<DecisionPortResult['answers'][string], {readonly status: 'answered' | 'review'}>['answer']; type Noul = Extract<Answer, {readonly type: 'noul'}>; declare const answer: Noul; answer.confidence;", 'TS2339'],
  ['probability string', "import type { DecisionPortResult } from 'PUBLIC_API'; type Answer = Extract<DecisionPortResult['answers'][string], {readonly status: 'answered' | 'review'}>['answer']; type Choice = Extract<Answer, {readonly type: 'choice'}>; const value: Choice['probabilities'] = {go: '0.8'};", 'TS2322'],
  ['mutable question map', "import type { DecisionPortRequest } from 'PUBLIC_API'; declare const value: DecisionPortRequest; value.questions['new'] = value.questions['old'];", 'TS2542']
]) test('generated consumer types reject ' + name, async () => {
  // Given an actual downstream consumer with the named contract violation.
  const directory = await mkdtemp(join(tmpdir(), 'shared-contracts-operations-type-'));
  const path = join(directory, 'consumer.mts');
  await writeFile(path, body.replace('PUBLIC_API', root + 'generated/index.js'));
  try {
    // When the pinned compiler checks the public declaration boundary.
    const result = spawnSync(process.execPath, [root + 'node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--noUncheckedIndexedAccess', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', path], { encoding: 'utf8' });
    // Then it rejects the machine behavior without a prose/type suppression test.
    assert.equal(result.status, 2);
    assert.ok(result.stdout.includes(diagnostic), result.stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
