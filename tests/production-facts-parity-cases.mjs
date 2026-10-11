import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const clone = value => structuredClone(value);
const uuid = number => '123e4567-e89b-42d3-a456-' + String(number).padStart(12, '0');
const compact = result => result.ok ? { ok: true } : result;
const at = (value, path) => path.split('/').filter(Boolean).reduce((current, key) => current[key], value);
function set(value, path, next) {
  const parts = path.split('/').filter(Boolean), key = parts.pop();
  const parent = parts.reduce((current, part) => current[part], value);
  if (next === undefined) delete parent[key]; else parent[key] = next;
}
// Independent test enumeration, checked against the complete schema graph in the test.
export const factsReferenceSlots = [
  ['parent_ref', 'EventIntelligencePackage'], ['request_ref', 'ResearchRequest'],
  ['request_receipt_ref', 'ResearchRequestReceipt'], ['answer_receipt_refs/*', 'ResearchAnswerReceipt'],
  ['batch_receipt_ref', 'ResearchBatchReceipt'], ['sources/*/retention_ref', null],
  ['sources/*/access_ref', null], ['facts/*/provenance/*/evidence_ref', null],
  ['approved_assets/*/artifact_ref', 'Artifact'], ['approved_assets/*/approval_ref', 'ApprovalReference'],
  ['policy_ref', null], ['decision_refs/*', null], ['usage_refs/*', null]
];
export function testReferences(value, path = '', slot = false) {
  if (value === null || typeof value !== 'object') return [];
  if (slot && !Array.isArray(value) && Object.hasOwn(value, 'id') && Object.hasOwn(value, 'schema_version') && Object.hasOwn(value, 'content_hash')) return [[path, value]];
  return Object.entries(value).flatMap(([key, child]) => ['value', 'candidate_values'].includes(key) ? [] : testReferences(child, path ? path + '/' + key : key, key.endsWith('_ref') || key.endsWith('_refs') || (slot && Array.isArray(value))));
}
export async function productionFactsParityCases(root = fileURLToPath(new URL('..', import.meta.url))) {
  const api = await import(pathToFileURL(resolve(root, 'generated/index.mjs')));
  const production = await import(pathToFileURL(resolve(root, 'tooling/production-operations.mjs')));
  const fixture = JSON.parse(await readFile(resolve(root, 'fixtures/EventIntelligencePackage.json'), 'utf8'));
  const d = JSON.parse(await readFile(resolve(root, 'fixtures/ProductionCalibration.json'), 'utf8'));
  const bundleFixture = JSON.parse(await readFile(resolve(root, 'fixtures/ProductionBundle.2_0_0.json'), 'utf8'));
  const artifactFixture = JSON.parse(await readFile(resolve(root, 'fixtures/ArtifactRef.json'), 'utf8'));
  const base = clone(d.facts.package), research = clone(fixture.cases.find(row => row.id === 'semantic-positive').context);
  research.scope = clone(d.scope);
  for (const approval of Object.values(research.approvals)) Object.assign(approval, d.scope);
  base.sources.push({ ...clone(base.sources[0]), source_id: 'source_2' });
  base.facts.push({ ...clone(base.facts[0]), fact_id: uuid(801), key: 'subtitle' });
  for (const fact of base.facts) fact.provenance.push({ ...clone(fact.provenance[0]), source_id: 'source_2' });
  base.answer_receipt_refs.push({ ...clone(base.answer_receipt_refs[0]), id: uuid(802) });
  base.asset_candidates.push({ ...clone(base.asset_candidates[0]), asset_id: uuid(803), source_id: 'source_2' });
  base.approved_assets.push({ ...clone(base.approved_assets[0]), asset_id: uuid(803), artifact_ref: { ...clone(base.approved_assets[0].artifact_ref), id: uuid(803) }, approval_ref: { ...clone(base.approved_assets[0].approval_ref), id: uuid(804) } });
  research.approvals[uuid(804)] = { ...clone(research.approvals[base.approved_assets[0].approval_ref.id]), subject_id: uuid(803), reference: clone(base.approved_assets[1].approval_ref) };
  base.decision_refs = [clone(base.policy_ref), { ...clone(base.policy_ref), id: uuid(805) }];
  base.usage_refs = [clone(base.policy_ref), { ...clone(base.policy_ref), id: uuid(806) }];
  base.package_version = 2; research.prior_package = clone(d.facts.package); base.parent_ref = clone(d.facts.reference);
  const rows = [];
  function add(id, change, expected = true, options = {}) {
    const pkg = clone(base), context = clone(research), value = clone(d.composition);
    change(pkg, context);
    for (const [index, fact] of pkg.facts.entries()) if (options.staleFact !== index) fact.fact_hash = api.researchContentHash(fact, 'fact_hash');
    pkg.package_hash = api.researchContentHash(pkg, 'package_hash');
    if (options.stalePackage) pkg.package_hash = api.hashManifest('stale package');
    context.references = Object.fromEntries(testReferences(pkg).map(([path, reference]) => [path, clone(reference)]));
    // These are separate, explicitly synthetic lookup/approval fixtures, never production authority.
    for (const asset of pkg.approved_assets) {
      const verification = context.approvals[asset.approval_ref?.id];
      if (verification) { verification.reference = clone(asset.approval_ref); verification.subject_hash = asset.transformed_hash ?? asset.original_hash; }
    }
    const reference = { ...clone(d.facts.reference), revision: pkg.package_version, content_hash: pkg.package_hash };
    value.facts_ref = clone(reference);
    value.input_binding_hash = api.hashManifest({ values: value.values, fact_bindings: value.fact_bindings, facts_ref: value.facts_ref, formatting: value.policy_refs.formatting });
    value.content_hash = production.productionContentHash(value);
    const composition = { scope: clone(d.scope), template: clone(d.template), personalization: clone(d.personalization), facts: { package: pkg, reference }, expected_references: Object.fromEntries(production.productionReferences(value)), expected_resolved_layout_commitment: value.resolved_layout_commitment, expected_policy_refs: clone(value.policy_refs), expected_font_refs: clone(value.font_refs), expected_runtime_ref: clone(value.runtime_ref), asset_bytes: clone(d.asset_bytes) };
    const input = clone({ value, context: composition, researchContext: context, bundle: bundleFixture.valid, artifact: artifactFixture.valid });
    rows.push({ id: 'facts-parity/' + id, input, input_hash: api.hashManifest(input), expected: { research: options.research ?? expected, facts: expected, integrity: expected, composition: options.composition ?? expected }, path: options.path ?? '' });
  }
  add('complete-canonical', () => {});
  const paths = testReferences(base);
  for (const [path] of paths) {
    const slot = factsReferenceSlots.find(([pattern]) => pattern === path.replace(/\/\d+(?=\/|$)/g, '/*'));
    if (!slot) throw Error('Unaccounted reference path ' + path);
    for (const [field, next] of [['schema_version', '2.0.0'], ['schema_version', '9.0.0'], ['id', 'not-uuid'], ['revision', -1], ['revision', 1.5], ['revision', '1'], ['content_hash', 'not-hash'], ['contract', 'invalid kind!']]) {
      add(path + '/' + field + '/' + next, pkg => set(pkg, path + '/' + field, next), false, { path: '/' + path + '/' + field });
    }
    for (const field of ['contract', 'schema_version', 'id', 'revision', 'content_hash']) add(path + '/missing-' + field, pkg => set(pkg, path + '/' + field, undefined), false, { path: '/' + path });
    add(path + '/extra-property', pkg => set(pkg, path + '/extra', true), false, { path: '/' + path });
    add(path + '/null-descriptor', pkg => set(pkg, path, null), path === 'parent_ref', { research: false, path: '/' + path });
    if (slot[1]) for (const kind of ['OrderAuthorization', 'ArtifactRef', 'UnknownSemanticKind']) add(path + '/wrong-kind/' + kind, pkg => set(pkg, path + '/contract', kind), false, { path: '/' + path });
    else add(path + '/supported-generic-kind', pkg => set(pkg, path + '/contract', 'OrderAuthorization'));
    add(path + '/supported-rebound-tuple', (pkg, context) => {
      const ref = at(pkg, path); ref.revision = 0; ref.content_hash = api.hashManifest('synthetic independent descriptor');
      if (path === 'parent_ref') { ref.revision = context.prior_package.package_version; ref.content_hash = context.prior_package.package_hash; }
    });
  }
  for (const prefix of ['sources/0/url', 'sources/1/url', 'asset_candidates/0/discovery_url', 'asset_candidates/1/discovery_url']) {
    for (const url of ['https://user:secret@events.example.invalid/a', 'https://events.example.invalid/a#fragment', 'https://[broken', 'https:///']) add(prefix + '/invalid-url/' + url, pkg => set(pkg, prefix, url), false, { path: '/' + prefix });
    add(prefix + '/http-control', pkg => set(pkg, prefix, 'http://events.example.invalid/a'));
  }
  add('own-stale-digest', () => {}, false, { stalePackage: true, path: '/package_hash' });
  for (const index of [0, 1]) {
    add('fact' + index + '/stale-inner-digest', pkg => { pkg.facts[index].value = 'changed fact'; }, false, { staleFact: index, path: '/facts/' + index + '/fact_hash' });
    add('fact' + index + '/bad-source', pkg => { pkg.facts[index].provenance[1].source_id = 'absent'; }, false, { path: '/facts/' + index });
    add('fact' + index + '/bad-retrieval', pkg => { pkg.facts[index].provenance[1].retrieved_at = '2026-10-10T11:54:00Z'; }, false, { path: '/facts/' + index });
  }
  for (const [id, mutate] of [
    ['duplicate-source', p => p.sources.push(clone(p.sources[0]))], ['duplicate-fact-id', p => { p.facts[1].fact_id = p.facts[0].fact_id; }],
    ['duplicate-fact-key', p => { p.facts[1].key = p.facts[0].key; }], ['duplicate-candidate', p => p.asset_candidates.push(clone(p.asset_candidates[0]))],
    ['duplicate-approved', p => p.approved_assets.push(clone(p.approved_assets[0]))], ['candidate-source', p => { p.asset_candidates[1].source_id = 'absent'; }]
  ]) add(id, mutate, false);
  for (const field of ['asset_id', 'revision', 'original_hash', 'transformed_hash']) add('approved-candidate-mismatch/' + field, p => { p.approved_assets[1][field] = field === 'asset_id' ? uuid(899) : field === 'revision' ? 9 : api.hashManifest('mismatch'); }, false);
  for (const [status, value, candidates, expected] of [
    ['known', 'known', [], true], ['known', null, [], false], ['known', 'known', ['candidate'], false],
    ['unknown', null, [], true], ['unknown', 'value', [], false], ['unknown', null, ['candidate'], false],
    ['conflicting', null, ['one', 'two'], true], ['conflicting', null, ['one'], false], ['conflicting', null, ['one', 'one'], false],
    ['conflicting', 'value', ['one', 'two'], false], ['review', null, [], true], ['review', 'value', ['candidate'], true]
  ]) add('status/' + status + '/' + JSON.stringify([value, candidates]), p => { p.readiness = 'review'; Object.assign(p.facts[1], { status, value, candidate_values: candidates }); }, expected);
  for (const basis of ['sourced', 'heuristic', 'not_measured']) for (const value of [null, 0, 1]) add('confidence/' + basis + '/' + value, p => { p.facts[1].confidence = { basis, value }; }, (basis === 'not_measured') === (value === null));
  add('ready-unresolved', p => { Object.assign(p.facts[1], { status: 'unknown', value: null }); }, false);
  add('empty-optional-arrays', p => { p.asset_candidates = []; p.approved_assets = []; p.decision_refs = []; p.usage_refs = []; });
  add('transformed-assets', p => { for (let i = 0; i < 2; i++) p.asset_candidates[i].transformed_hash = p.approved_assets[i].transformed_hash = api.hashManifest('transformed'); });
  add('historical-expiry', p => { p.expires_at = '2020-01-01T00:00:00Z'; }, true, { research: false });
  add('delivery-only-rebound', p => { p.observed_at = '2030-01-01T00:00:00Z'; p.source_refs = [{ kind: 'artifact', id: 'opaque-external', content_hash: api.hashManifest('delivery') }]; });
  add('inert-reference-looking-value', p => { p.facts[1].value = { artifact_ref: { contract: 'OrderAuthorization', schema_version: '9.0.0', id: 'inert', content_hash: 'inert' } }; });
  for (const value of [true, false, 0, 1.25, '', [], ['text', false, 0], {}, { nested: [null, { label: 'inert' }] }]) add('inert-value/' + JSON.stringify(value), p => { p.facts[1].value = value; });
  for (const use of ['display', 'reproduce', 'modify', 'publish']) add('asset-use/' + use, (p, context) => { p.approved_assets[1].intended_use = use; context.approvals[p.approved_assets[1].approval_ref.id].intended_use = use; });
  add('rehashed-inner-fact-and-outer', p => { p.facts[1].value = 'new supported content'; });
  add('initial-null-parent', (p, context) => { p.package_version = 1; p.parent_ref = null; delete context.prior_package; });
  add('source-content-preimage-unresolved', p => { p.sources[1].content_hash = api.hashManifest('opaque preimage'); });
  add('artifact-preimage-unresolved', p => { p.approved_assets[1].artifact_ref.content_hash = api.hashManifest('opaque Artifact target'); });
  add('generic-policy-preimage-unresolved', p => { p.policy_ref.content_hash = api.hashManifest('opaque policy target'); });
  add('future-source-time-is-external', p => { p.sources[1].retrieved_at = '2030-01-01T00:00:00Z'; for (const fact of p.facts) fact.provenance[1].retrieved_at = p.sources[1].retrieved_at; }, true, { research: false });
  for (const field of ['schema_version', 'policy_version']) add('unsupported-own-' + field, p => { p[field] = '9.0.0'; }, false, { path: '/' + field });
  for (const [field, item, maximum] of [['sources', base.sources[0], 100], ['facts', base.facts[1], 64], ['asset_candidates', base.asset_candidates[0], 100], ['approved_assets', base.approved_assets[0], 100], ['answer_receipt_refs', base.answer_receipt_refs[0], 64], ['decision_refs', base.policy_ref, 100], ['usage_refs', base.policy_ref, 100]]) {
    add('array-upper-bound/' + field, p => { p[field] = Array.from({ length: maximum + 1 }, () => clone(item)); }, false, { path: '/' + field });
  }
  add('nested-provenance-upper-bound', p => { p.facts[1].provenance = Array.from({ length: 21 }, () => clone(p.facts[1].provenance[0])); }, false, { path: '/facts/1/provenance' });
  add('nested-candidate-values-upper-bound', p => { p.facts[1].candidate_values = Array.from({ length: 11 }, (_, index) => index); }, false, { path: '/facts/1/candidate_values' });
  return rows;
}
export function runProductionFactsParityCase(api, production, row) {
  const { value, context, researchContext, bundle, artifact } = clone(row.input), pkg = context.facts.package;
  const hydrated = { ...context, asset_bytes: Object.fromEntries(Object.entries(context.asset_bytes).map(([id, bytes]) => [id, Buffer.from(bytes, 'base64')])) };
  return { research: compact(api.checkEventIntelligencePackage(pkg, researchContext)), facts: compact(production.checkProductionFacts(pkg, context.scope)), integrity: compact(production.checkProductionValueIntegrity('EventIntelligencePackage', pkg, context.scope)), composition: compact(production.checkComposition(value, hydrated)), eligibility: compact(production.checkProductionBundleEligibility(bundle, { scope: context.scope, composition: value, composition_context: hydrated, artifact_ref: artifact, now: '2026-10-10T12:00:00Z' })) };
}
