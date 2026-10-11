import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { catalog, assertFixture } from '../scripts/contracts.mjs';
import { readJson, root } from '../scripts/generate.mjs';
import { validateContract, parseContract, checkResearchCreative, adaptResearchPackage, researchContentHash } from '../generated/index.mjs';
for (const entry of (await catalog()).filter(entry => entry.state === 'research_creative_candidate')) {
  const manifest = await readJson(entry.fixtures);
  for (const fixture of manifest.cases) test(entry.name + ' / ' + fixture.id, () => {
    // Given a static wire fixture and independently supplied server expectations.
    const value = { ...structuredClone(manifest.valid), ...fixture.set };
    for (const key of fixture.remove ?? []) delete value[key];
    // When the requested public boundary parses or compares the record.
    let result;
    switch (fixture.mode) {
      case 'research_creative': {
        const context = structuredClone(fixture.context);
        if (context.artifact_bytes) context.artifact_bytes = Object.fromEntries(Object.entries(context.artifact_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
        result = checkResearchCreative(entry.name, value, context);
        break;
      }
      case 'parse': result = parseContract(entry.name, fixture.json); break;
      case undefined: result = validateContract(entry.name, value); break;
      default: throw new Error('Unknown fixture mode');
    }
    // Then the exact success or typed error/path is checked, never skipped.
    assertFixture(result, fixture.expected);
  });
}
const packageFixture = await readJson('fixtures/EventIntelligencePackage.json');
const canonical = packageFixture.valid;
const awaitableControls = await readJson('fixtures/DesignControlSchema.json');

test('explicit alias adapter preserves the entire source without treating it as accepted migration', () => {
  // Given the same immutable content under a proposed alias.
  const source = { ...canonical, contract: 'ResearchPackage' };
  // When explicitly adapted.
  const result = adaptResearchPackage(source, 'canonical-alias-1.0.0');
  // Then content/identity/hash are preserved, with no accepted-owner assertion.
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.candidate, canonical);
  assert.deepEqual(result.value.source, source);
  assert.equal(result.value.accepted_migration, false);
});

for (const version of ['1.0', '1.1']) test('lossless asset-free legacy profile ' + version + ' retains provenance and extra source data', () => {
  // Given a complete representable legacy proposal and separately provided canonical bindings.
  const candidate = { ...canonical, asset_candidates: [], approved_assets: [] };
  candidate.package_hash = researchContentHash(candidate, 'package_hash');
  const source = { contract: 'ResearchPackage', schema_version: version, tenant_id: candidate.tenant_id, project_id: candidate.project_id, package_id: candidate.package_id, source_identity: candidate.sources.map(source => ({ source_id: source.source_id, uri: source.url, retrieved_at: source.retrieved_at, content_hash: source.content_hash })), facts: candidate.facts.map(fact => ({ fact_id: fact.fact_id, key: fact.key, status: 'verified', value: fact.value, candidate_values: [], provenance: fact.provenance })), assets: { presence: 'absent', items: [] }, permissions: { presence: 'absent', items: [] }, extra_metadata: { private_note: 'synthetic' } };
  // When a named version/profile conversion is explicitly requested.
  const result = adaptResearchPackage(source, 'creative-local-' + version, candidate);
  // Then the complete original survives alongside the fully typed candidate.
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.source, source);
  assert.deepEqual(result.value.candidate, candidate);
  assert.equal(result.value.accepted_migration, false);
});

test('legacy missing status or permission-bearing conversion cannot be silently promoted', () => {
  // Given an unrepresentable legacy fact with no explicit state.
  const source = { contract: 'ResearchPackage', schema_version: '1.0', tenant_id: canonical.tenant_id, project_id: canonical.project_id, package_id: canonical.package_id, source_identity: [], facts: [{ key: 'title', value: 'unknown origin' }] };
  // When adapted, then its typed refusal prevents invented facts/approval.
  assert.equal(adaptResearchPackage(source, 'creative-local-1.0', canonical).ok, false);
});

test('all declarative control kinds enforce defaults without injecting them', () => {
  // Given a trusted schema containing numeric, enum, boolean and text controls.
  const fixture = awaitableControls;
  const value = structuredClone(fixture.valid), context = structuredClone(fixture.cases.find(c => c.id === 'semantic-positive').context);
  const base = value.controls[0];
  value.controls = [base,
    { control_id: 'color', label: 'Color', description: '', action: 'set_value', required: true, enabled: true, default_presence: 'present', kind: 'enum', values: ['blue', 'green'], default_value: 'blue' },
    { control_id: 'visible', label: 'Visible', description: '', action: 'set_value', required: false, enabled: true, default_presence: 'present', kind: 'boolean', default_value: false },
    { control_id: 'caption', label: 'Caption', description: '', action: 'set_value', required: false, enabled: false, default_presence: 'absent', kind: 'text', max_length: 80, default_value: null }
  ];
  value.control_schema_hash = researchContentHash(value, 'control_schema_hash');
  context.allowed_controls = Object.fromEntries(value.controls.map(control => [control.control_id, structuredClone(control)]));
  const before = structuredClone(value);
  // When the complete declarative schema is checked.
  const result = checkResearchCreative('DesignControlSchema', value, context);
  // Then all types/default states remain exact and no default is inserted.
  assert.equal(result.ok, true);
  assert.deepEqual(value, before);
});
test('invalid trusted numeric bounds fail even when no default exists', () => {
  // Given a malformed numeric definition, mirrored by a broken server allowlist.
  const value = structuredClone(awaitableControls.valid), context = structuredClone(awaitableControls.cases.find(c => c.id === 'semantic-positive').context);
  value.controls[0] = { ...value.controls[0], minimum: 2, maximum: 1, default_presence: 'absent', default_value: null };
  value.control_schema_hash = researchContentHash(value, 'control_schema_hash');
  context.allowed_controls = { saturation: value.controls[0] };
  // When checked, then server metadata cannot bypass structural semantic sanity.
  assert.deepEqual(checkResearchCreative('DesignControlSchema', value, context), { ok: false, errors: [{ code: 'INVALID_PAYLOAD', path: '/controls/0/minimum' }] });
});

test('negative scope fixture fails if its validator incorrectly accepts forged input', () => {
  // Given an independent rejection expectation, when an accepting result is substituted,
  // then the harness detects the lost boundary rather than reporting green.
  const expected = packageFixture.cases.find(c => c.id === 'forged-scope').expected;
  assert.throws(() => assertFixture({ ok: true, value: canonical }, expected));
});

for (const [name, body, code] of [
  ['readonly facts', "import type {EventIntelligencePackage} from 'PUBLIC_API';declare const value:EventIntelligencePackage;value.facts.push(value.facts[0]);", 'TS2339'],
  ['invented control action', "import type {Control} from 'PUBLIC_API';const action:Control['action']='publish';", 'TS2322'],
  ['opaque package ID confusion', "import type {PackageId, TenantId} from 'PUBLIC_API';declare const value:PackageId;const tenant:TenantId=value;", 'TS2322']
]) test('generated types reject ' + name, async () => {
  // Given an actual violating consumer of the generated package interface.
  const directory = await mkdtemp(join(tmpdir(), 'shared-research-types-'));
  const path = join(directory, 'consumer.mts');
  await writeFile(path, body.replace('PUBLIC_API', root + 'generated/index.js'));
  try {
    // When the pinned compiler checks that consumer.
    const result = spawnSync(process.execPath, [root + 'node_modules/typescript/bin/tsc', '--strict', '--noEmit', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', path], { encoding: 'utf8' });
    // Then the concrete ID/action/mutation seam is rejected.
    assert.equal(result.status, 2);
    assert.ok(result.stdout.includes(code), result.stdout);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
