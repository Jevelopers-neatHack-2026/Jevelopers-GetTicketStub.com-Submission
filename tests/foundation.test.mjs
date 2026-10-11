import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { canonicalJson, hashBytes, hashManifest, validateContract, parseContract, validatePrimitive, checkTrustedContext, projectEvidence, ContractError } from '../generated/index.mjs';
import { readJson, root, outputs, compiler } from '../scripts/generate.mjs';
import { execute, catalog, runFixtures, assertFixture, classifications, consumerChecks } from '../scripts/contracts.mjs';
import { schemaImpact } from '../scripts/compatibility.mjs';

const common = await readJson('fixtures/CommonEnvelope.json');
const evidence = await readJson('fixtures/EvidenceProjection.json');

test('parsing rejects duplicate JSON members instead of losing hash-bound data', () => {
  // Given duplicate scope fields, including an escaped spelling of the same key.
  const json = '{"tenant_id":"first","tenant_\\u0069d":"second"}';
  // When parsed, then a malformed error occurs before discarded data can validate.
  assert.deepEqual(parseContract('CommonEnvelope', json), { ok: false, errors: [{ code: 'MALFORMED_JSON', path: '' }] });
});

test('parsing preserves valid empty and nested JSON containers', () => {
  // Given a valid wire fixture containing an empty source_refs array.
  const json = JSON.stringify(common.valid);
  // When parsed, then the exact schema value survives token inspection.
  assert.deepEqual(parseContract('CommonEnvelope', json), { ok: true, value: common.valid });
});

for (const [description, before, after, expected] of [
  ['required addition', { type: 'object', required: [] }, { type: 'object', required: ['tenant_id'] }, 'required_addition'],
  ['field removal', { properties: { name: { type: 'string' } } }, { properties: {} }, 'field_removal'],
  ['unsafe enum addition', { enum: ['a'] }, { enum: ['a', 'b'] }, 'unsafe_enum_change'],
  ['numeric narrowing', { type: 'number', maximum: 1 }, { type: 'number', maximum: 0.5 }, 'constraint_or_semantic_change']
]) test('compatibility classifies ' + description + ' as breaking or unproven', () => {
  // Given a wire change affecting old consumers, when classified, then it requires review.
  const result = schemaImpact(before, after);
  assert.equal(result.impact, 'breaking_or_unproven');
  assert.ok(result.changes.some(change => change.code === expected));
});

test('compatibility permits documentation changes without changing wire behavior', () => {
  // Given identical constraints with changed documentation, when classified, then wire compatibility holds.
  assert.deepEqual(schemaImpact({ type: 'number', description: 'a' }, { type: 'number', description: 'b' }), { impact: 'compatible_documentation', changes: [] });
});

test('compatibility treats a payload field named description as wire data', () => {
  // Given a real field sharing the name of a schema annotation, when changed, then it remains breaking.
  const before = { properties: { description: { type: 'string' } } };
  const after = { properties: { description: { type: 'number' } } };
  assert.equal(schemaImpact(before, after).impact, 'breaking_or_unproven');
});

test('compiler supports two synthetic schema versions together', () => {
  // Given independently identified synthetic old and current schemas, not accepted public versions.
  const ajv = compiler();
  for (const version of ['1.0.0', '2.0.0']) ajv.addSchema({ $id: 'urn:test:' + version, type: 'object', required: ['schema_version'], properties: { schema_version: { const: version } } });
  // When each exact version is selected in the same compiler.
  const results = ['1.0.0', '2.0.0'].map(version => ajv.getSchema('urn:test:' + version)({ schema_version: version }));
  // Then neither schema shadows the other.
  assert.deepEqual(results, [true, true]);
});

for (const entry of (await catalog()).filter(entry => entry.state === 'foundation_candidate')) {
  test('fixtures reject malformed inputs with expected codes and paths for ' + entry.name, async () => {
    // Given the canonical positive and negative fixture manifest.
    // When each fixture crosses the package boundary.
    const failures = await runFixtures(entry);
    // Then every expected result, including rejection, matches.
    assert.deepEqual(failures, []);
  });
}

test('negative fixture assertion fails when a validator incorrectly accepts the input', () => {
  // Given a required rejection and a falsely accepting validator result.
  const expected = { ok: false, code: 'INVALID_PAYLOAD', path: '/tenant_id' };
  // When the harness checks the result, then it rejects the false green.
  assert.throws(() => assertFixture({ ok: true, value: {} }, expected));
});

test('validation preserves frozen values and does not add defaults', () => {
  // Given an immutable valid envelope without optional IDs.
  const input = Object.freeze(structuredClone(common.valid));
  // When validated.
  const parsed = validateContract('CommonEnvelope', input);
  // Then the exact object returns with no inserted fields.
  assert.deepEqual(parsed, { ok: true, value: input });
  assert.equal(parsed.value, input);
  assert.equal(Object.hasOwn(input, 'provider_request_id'), false);
});

test('unknown version names cannot resolve inherited registry members', () => {
  // Given an attacker-controlled exact version resembling a prototype property.
  const input = { ...common.valid, schema_version: '__proto__' };
  // When validated, then unsupported version is returned instead of invoking a prototype.
  assert.deepEqual(validateContract('CommonEnvelope', input), { ok: false, errors: [{ code: 'UNSUPPORTED_VERSION', path: '/schema_version' }] });
});

test('unknown contracts fail closed', () => {
  // Given an absent domain export, when validated, then no generic envelope substitutes.
  assert.deepEqual(validateContract('NoSuchContract', common.valid), { ok: false, errors: [{ code: 'UNKNOWN_CONTRACT', path: '/contract' }] });
});

test('safe errors omit arbitrary submitted values and unknown field names', () => {
  // Given sensitive data placed in an arbitrary key and value.
  const input = { ...evidence.valid, 'SYNTHETIC-PRIVATE-KEY': 'SYNTHETIC-PRIVATE-VALUE' };
  // When validated.
  const result = validateContract('EvidenceProjection', input);
  // Then only a fixed code, parent path and keyword remain.
  assert.deepEqual(result, { ok: false, errors: [{ code: 'INVALID_PAYLOAD', path: '', keyword: 'additionalProperties' }] });
});

test('scope checks reject omitted or malformed authenticated expectations', () => {
  // Given valid payload scope and an empty trusted-context object.
  // When checked, then payload values cannot become their own expectations.
  assert.deepEqual(checkTrustedContext(common.valid, {}), { ok: false, errors: [{ code: 'INVALID_TRUST_CONTEXT', path: '' }] });
});

test('unknown trusted expectation fields cannot be silently ignored', () => {
  // Given an expectation outside the declared scope-check API.
  const expected = { tenant_id: common.valid.tenant_id, project_id: common.valid.project_id, approval: true };
  // When checked, then it fails rather than appearing to verify approval.
  assert.deepEqual(checkTrustedContext(common.valid, expected), { ok: false, errors: [{ code: 'INVALID_TRUST_CONTEXT', path: '' }] });
});

test('identity fields survive research creative production and usage evidence propagation', () => {
  // Given a synthetic common envelope with distinct identity concepts.
  const input = { ...common.valid, ...common.cases.find(entry => entry.id === 'valid-full').set };
  const expectedIds = Object.fromEntries(Object.entries(input).filter(([key]) => key.endsWith('_id')));
  // When each producer validates the same propagated common identities.
  const results = ['event-intelligence', 'creative-engine', 'print-production', 'cost-intelligence', 'integration-evals'].map(module => validateContract('CommonEnvelope', { ...input, producer: { ...input.producer, module } }));
  // Then no identity is dropped, substituted or fabricated.
  for (const result of results) {
    assert.equal(result.ok, true);
    assert.deepEqual(Object.fromEntries(Object.entries(result.value).filter(([key]) => key.endsWith('_id'))), expectedIds);
  }
});

test('evidence projection recursively excludes nested private and additive fields', () => {
  // Given synthetic credentials, raw prompts and signed locations at several levels.
  const input = { ...evidence.valid, customer: { prompt: 'SYNTHETIC' }, tenant_id: common.valid.tenant_id, source_refs: [{ uri: 'https://example.invalid/?token=SYNTHETIC' }], component: { ...evidence.valid.component, auth: { token: 'SYNTHETIC' }, private_locator: 'file:///private/customer', diagnostics: [{ message: 'PRIVATE' }] } };
  // When projected.
  const result = projectEvidence(input);
  // Then the entire output equals the independent public fixture.
  assert.deepEqual(result, { ok: true, value: evidence.valid });
});

test('projection does not invoke accessors in allowed fields', () => {
  // Given a getter that would perform a side effect if read.
  let reads = 0;
  const input = { ...evidence.valid };
  Object.defineProperty(input, 'component', { get() { reads++; return evidence.valid.component; } });
  // When projected.
  const result = projectEvidence(input);
  // Then a typed rejection occurs without invoking the getter.
  assert.equal(result.ok, false);
  assert.equal(reads, 0);
});

test('canonical JSON preserves finite probabilities and fractional scores', () => {
  // Given finite fractions required by DecisionPort and numeric controls.
  const input = { score: 1.43, confidence: 0.25, controls: [0.001, 1e-7, -0] };
  // When canonically serialized.
  const json = canonicalJson(input);
  // Then finite numeric values keep deterministic ECMAScript spelling.
  assert.equal(json, '{"confidence":0.25,"controls":[0.001,1e-7,0],"score":1.43}');
});

test('schema validation permits finite fractions after canonical inspection', () => {
  // Given a representative future numeric contract compiled by the same toolchain.
  const ajv = compiler();
  const validator = ajv.compile({ type: 'object', additionalProperties: false, required: ['confidence', 'score'], properties: { confidence: { type: 'number', minimum: 0, maximum: 1 }, score: { type: 'number' } } });
  const input = { confidence: 0.25, score: 1.43 };
  // When the exact foundation's canonical serialization feeds schema validation.
  const accepted = validator(JSON.parse(canonicalJson(input)));
  // Then finite fractional values remain accepted without a domain-schema claim.
  assert.equal(accepted, true);
});

test('canonical JSON sorts nested objects and preserves Unicode and array order', () => {
  // Given intentionally unsorted nested keys and distinct Unicode spellings.
  const input = { z: ['e\u0301', '\u00e9'], a: { z: 2, a: 1 } };
  // When serialized, then keys sort and original Unicode/array order survive.
  assert.equal(canonicalJson(input), '{"a":{"a":1,"z":2},"z":["e\u0301","\u00e9"]}');
});

for (const [name, input, code] of [
  ['NaN', NaN, 'NON_CANONICAL_NUMBER'], ['Infinity', Infinity, 'NON_CANONICAL_NUMBER'],
  ['unsafe integer', 9007199254740992, 'NON_CANONICAL_NUMBER'], ['undefined', { a: undefined }, 'NON_JSON_VALUE'],
  ['bigint', 1n, 'NON_JSON_VALUE'], ['lone surrogate', '\ud800', 'INVALID_UNICODE'],
  ['date', new Date(0), 'NON_JSON_VALUE'], ['sparse array', new Array(1), 'NON_JSON_VALUE']
]) test('canonical JSON rejects ' + name, () => {
  // Given a value JSON would discard or misrepresent.
  // When serialized, then its typed rejection is preserved.
  assert.throws(() => canonicalJson(input), error => error instanceof ContractError && error.code === code);
});

test('canonical JSON rejects cycles', () => {
  // Given a cyclic graph, when serialized, then no recursive hang or partial hash occurs.
  const input = {}; input.self = input;
  assert.throws(() => canonicalJson(input), error => error instanceof ContractError && error.code === 'CYCLIC_VALUE');
});

test('byte hashing rejects non-byte input with its declared typed error', () => {
  // Given a string rather than the exact bytes required by the public API.
  // When hashed, then the public ContractError reports INVALID_BYTES at the root.
  assert.throws(() => hashBytes('hello'), error => error instanceof ContractError && error.code === 'INVALID_BYTES' && error.path === '');
});

test('byte hashing matches the SHA256 known vector', () => {
  // Given the UTF8 bytes for hello, when hashed, then the standard digest is produced.
  assert.equal(hashBytes(new TextEncoder().encode('hello')), 'sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
});

test('manifest hashes ignore key insertion order but bind changed values', () => {
  // Given two equivalent maps and a changed score.
  const inputs = [{ a: 1, b: 0.25 }, { b: 0.25, a: 1 }, { a: 1, b: 0.26 }];
  // When hashed.
  const hashes = inputs.map(hashManifest);
  // Then ordering has no effect while bound content changes the digest.
  assert.equal(hashes[0], hashes[1]); assert.notEqual(hashes[0], hashes[2]);
});

for (const [value, accepted] of [['0.000001', true], ['12.3400', true], [0.000001, false], ['1e-6', false], ['01.2', false], ['-1', false]]) test('exact decimal ' + JSON.stringify(value) + ' is ' + (accepted ? 'accepted' : 'rejected'), () => {
  // Given a monetary boundary value, when parsed, then precision rules are enforced.
  assert.equal(validatePrimitive('ExactDecimal', value).ok, accepted);
});

test('field-classification audit finds unclassified nested fields', () => {
  // Given a classified parent and an unclassified child in an array item.
  const schema = { properties: { data: { 'x-classification': 'restricted', items: { properties: { token: { type: 'string' } } } } } };
  // When audited, then a nested omission cannot hide behind its parent class.
  assert.deepEqual(classifications(schema, ['public', 'internal', 'restricted', 'secret']), [{ code: 'UNCLASSIFIED_FIELD', path: '/data/*/token' }]);
});

test('full catalog schema checks cover every now-implemented named export', async () => {
  // Given all locally implemented candidates, when the full gate runs, then no export is omitted.
  const result = await execute('check', {});
  assert.equal(result.status, 'passed');
  assert.equal(result.checked, (await catalog()).length);
  assert.deepEqual(result.failures, []);
});

for (const [flag, code] of [['require-owner', 'BLOCKED_OWNER_ACCEPTANCE'], ['require-consumer-pins', 'BLOCKED_CONSUMER_PIN']]) test('inventory flag ' + flag + ' fails on missing release evidence', async () => {
  // Given an explicitly incomplete release, when the named requirement is enabled, then failure is explicit.
  const result = await execute('inventory', { [flag]: true });
  assert.ok(result.failures.some(entry => entry.code === code));
});

for (const flag of ['require-fixtures', 'require-docs', 'require-field-classification']) test('inventory ' + flag + ' covers every implemented candidate', async () => {
  // Given real local schema/type/fixture artifacts, when checked, then complete coverage passes.
  const result = await execute('inventory', { [flag]: true });
  assert.deepEqual(result.failures, []);
  assert.equal(result.checked, (await catalog()).length);
});

test('missing fixture source still fails closed after all planned exports exist', async () => {
  // Given an absent artifact, when the fixture gate reads it, then no default/skipped pass replaces it.
  assert.deepEqual(await runFixtures({ name: 'NoSuchContract', fixtures: 'fixtures/NoSuchContract.json' }), [{ code: 'MISSING_FIXTURES', contract: 'NoSuchContract' }]);
});

test('policy-only classification gate does not claim domain coverage', async () => {
  // Given a complete taxonomy but no domain leaves, when the policy-only gate runs, then that limited policy succeeds.
  const result = await execute('inventory', { 'require-field-classification': true, 'policy-only': true });
  assert.deepEqual(result.failures, []);
});

test('consumer checks fail for every missing checkout without fetching', async () => {
  // Given nine discovery pins with no local paths, when run, then each checkout remains blocked.
  const result = await consumerChecks(await readJson('compatibility/consumers.json'));
  assert.equal(result.records.length, 0);
  assert.equal(result.failures.filter(entry => entry.code === 'BLOCKED_MISSING_CHECKOUT').length, 9);
});

test('generation exactly reproduces all tracked output bytes', async () => {
  // Given committed candidate generated files, when regenerated in memory, then every byte matches.
  const generated = await outputs();
  for (const [path, content] of generated) assert.equal(await readFile(root + 'generated/' + path, 'utf8'), content);
});

for (const args of [['check', '--help'], ['check', '--contract', 'CommonEnvelope'], ['check', '--contract', 'NoSuchContract'], ['check', '--bogus'], ['check', '--contract'], ['inventory', '--policy-only']]) test('CLI handles ' + args.join(' '), () => {
  // Given a real CLI invocation, when executed, then its status matches the requested boundary.
  const result = spawnSync(process.execPath, ['scripts/contracts.mjs', ...args], { cwd: root, encoding: 'utf8' });
  const success = args.includes('--help') || args.includes('CommonEnvelope');
  assert.equal(result.status, success ? 0 : 1);
});

test('TypeScript consumer rejects mixed scoped IDs', async () => {
  // Given an actual consumer source that assigns a ProjectId to TenantId.
  const directory = await mkdtemp(join(tmpdir(), 'shared-contracts-type-'));
  const source = join(directory, 'consumer.mts');
  await writeFile(source, `import type { ProjectId, TenantId } from ${JSON.stringify(root + 'generated/index.js')};\ndeclare const project: ProjectId;\nconst tenant: TenantId = project;\n`);
  try {
    // When the same pinned TypeScript compiler checks that consumer.
    const result = spawnSync(process.execPath, [root + 'node_modules/typescript/bin/tsc', '--noEmit', '--strict', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', source], { encoding: 'utf8' });
    // Then the compiler rejects the assignment at the ID seam.
    assert.equal(result.status, 2);
    assert.ok(result.stdout.includes('TS2322'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});
