import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { catalog, assertFixture } from '../scripts/contracts.mjs';
import { readJson, root } from '../scripts/generate.mjs';
import { validateContract, parseContract, checkCommerceEvidence, commerceContentHash, projectEvaluationEvidence } from '../generated/index.mjs';
for (const entry of (await catalog()).filter(entry => entry.state === 'commerce_evidence_candidate')) {
  const manifest = await readJson(entry.fixtures);
  for (const fixture of manifest.cases) test(entry.name + ' / ' + fixture.id, () => {
    // Given exact wire data and a separate server/current-record context.
    const value = { ...structuredClone(manifest.valid), ...fixture.set };
    for (const key of fixture.remove ?? []) delete value[key];
    // When the actual package boundary evaluates the fixture.
    let result;
    switch (fixture.mode) {
      case 'commerce_evidence': {
        const context = structuredClone(fixture.context);
        if (context.artifact_bytes) context.artifact_bytes = Object.fromEntries(Object.entries(context.artifact_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
        result = checkCommerceEvidence(entry.name, value, context); break;
      }
      case 'parse': result = parseContract(entry.name, fixture.json); break;
      case undefined: result = validateContract(entry.name, value); break;
      default: throw new Error('Unknown fixture mode');
    }
    // Then success or the exact typed rejection/path must match.
    assertFixture(result, fixture.expected);
  });
}
const evidence = await readJson('fixtures/EvaluationEvidence.json');
const handoff = await readJson('fixtures/ArtifactHandoffManifest.json');

test('public evaluation projection excludes private artifacts, measurements and lineage', () => {
  // Given a real validated contribution record containing private references and metrics.
  const context = evidence.cases.find(c => c.id === 'semantic-positive').context;
  // When the allowlisted public projection is created.
  const result = projectEvaluationEvidence(evidence.valid, context);
  // Then only the foundation projection fields survive, with no global acceptance claim.
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.value).sort(), ['contract', 'schema_version', 'policy_version', 'evidence_id', 'environment', 'billing_mode', 'outcome', 'component'].sort());
  assert.equal(Object.hasOwn(result.value, 'acceptance_ids'), false);
  assert.equal(Object.hasOwn(result.value, 'artifacts'), false);
  assert.equal(Object.hasOwn(result.value, 'metrics'), false);
});

test('handoff identity survives locator renewal but binds access policy and artwork', () => {
  // Given an immutable manifest with mutable access locator and expiry.
  const original = handoff.valid;
  // When each declared scope is hashed.
  const renewed = commerceContentHash({ ...original, access: { ...original.access, expires_at: '2026-10-10T14:00:00Z', locator_ref: { ...original.access.locator_ref, id: '123e4567-e89b-42d3-a456-000000000999' } } }, 'manifest_hash');
  const changedPolicy = commerceContentHash({ ...original, access: { ...original.access, policy_ref: { ...original.access.policy_ref, id: '123e4567-e89b-42d3-a456-000000000999' } } }, 'manifest_hash');
  // Then only the documented access fields are excluded from the digest.
  assert.equal(renewed, original.manifest_hash);
  assert.notEqual(changedPolicy, original.manifest_hash);
});

test('a forged accepted approval cannot make a rejection fixture green', () => {
  // Given the display-only handoff rejection, when its result is incorrectly accepted,
  // then the negative harness itself detects the authority-binding regression.
  const expected = handoff.cases.find(c => c.id === 'same_hash_wrong_display_only').expected;
  assert.throws(() => assertFixture({ ok: true, value: handoff.valid }, expected));
});

test('an unmeasured record cannot project a passed outcome', () => {
  // Given an explicit unmeasured contribution with null measurement.
  const fixture = evidence.cases.find(c => c.id === 'unmeasured');
  const value = { ...evidence.valid, ...fixture.set };
  // When projected, then unknown/unmeasured remains unknown rather than zero/pass.
  const projected = projectEvaluationEvidence(value, fixture.context);
  assert.equal(projected.ok, true);
  assert.equal(projected.value.outcome, 'unknown');
});

for (const [name, body, diagnostic] of [
  ['receipt authority confusion', "import type {ApprovalReceipt,ArtifactConsumptionReceipt} from 'PUBLIC_API';declare const consumed:ArtifactConsumptionReceipt;const approval:ApprovalReceipt=consumed;", 'TS2740'],
  ['float purchase ceiling', "import type {OrderAuthorization} from 'PUBLIC_API';declare const auth:OrderAuthorization;const amount:OrderAuthorization['maximum']['amount']=1.2;", 'TS2322'],
  ['global acceptance forgery', "import type {EvaluationEvidence} from 'PUBLIC_API';const scope:EvaluationEvidence['claim_scope']='global_verified';", 'TS2322']
]) test('generated types reject ' + name, async () => {
  // Given a real downstream type consumer with the named boundary violation.
  const directory = await mkdtemp(join(tmpdir(), 'commerce-evidence-types-'));
  const path = join(directory, 'consumer.mts');
  await writeFile(path, body.replace('PUBLIC_API', root + 'generated/index.js'));
  try {
    // When the pinned compiler checks the actual public declarations.
    const result = spawnSync(process.execPath, [root + 'node_modules/typescript/bin/tsc', '--strict', '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', path], { encoding: 'utf8' });
    // Then the machine-level misuse is rejected without assertions or suppression.
    assert.equal(result.status, 2); assert.ok(result.stdout.includes(diagnostic), result.stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
