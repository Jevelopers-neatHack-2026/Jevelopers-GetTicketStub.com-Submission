import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { hashManifest } from '../generated/index.mjs';
import { createProductionError, adaptProductionErrorToV1, translateProductionGeometry, checkPersonalizationSchema, verifyProductionBundleFiles, verifyProductionZip, compareProductionIdempotency } from '../tooling/production-operations.mjs';

const read = async name => JSON.parse(await readFile(new URL('../fixtures/' + name + '.json', import.meta.url), 'utf8'));
const cal = await read('ProductionCalibration'), eligibility = (await read('ProductionEligibilityCalibration')).valid;
const error = (await read('ProductionError')).valid, envelope = (await read('CommonEnvelope')).valid;
Object.assign(envelope, cal.scope);
const copy = structuredClone;
const bases = {
  errorCreate: { value: 'ROW_SCHEMA', context: { scope: cal.scope, operation: 'personalizeArtifactBatch', correlation_id: envelope.correlation_id, side_effects: 'possible', usage_state: 'incomplete' } },
  errorAdapter: { value: error, context: { scope: cal.scope, envelope, blocking_condition: 'review' } },
  geometry: { value: eligibility.context.spec, context: { scope: cal.scope, maximum_nm: '2000000000' } }
};
const routes = {
  errorCreate: input => createProductionError(input.value, input.context),
  errorAdapter: input => adaptProductionErrorToV1(input.value, input.context),
  geometry: input => translateProductionGeometry(input.value, input.context)
};
const refused = result => { assert.equal(result.ok, false); assert.ok(Array.isArray(result.errors)); };
test('SC-CHK-024 controls preserve exact independent-review hashes', () => {
  assert.equal(hashManifest(bases.errorCreate), 'sha256:2bd06b10637fe0975eb7c17d504db7e8b618d79e1f795213c7773161b3a85bb0');
  assert.equal(hashManifest(bases.errorAdapter), 'sha256:cf8bf1412c6cee8965b8abf0b5598f19aae766978e05b45abd6dc95e8eb42ea8');
  assert.equal(hashManifest(bases.geometry), 'sha256:ef2c2a7e79a1e004ad44a1a155289110c91d39c95986aaa8032568f59361842a');
});
for (const [route, call] of Object.entries(routes)) {
  test('SC-CHK-024 supported control / ' + route, () => assert.equal(call(copy(bases[route])).ok, true));
  for (const value of [undefined, null, false, {}, []]) test('SC-CHK-024 malformed context / ' + route + ' / ' + String(value), () => {
    const input = copy(bases[route]); input.context = value;
    refused(call(input));
  });
}
for (const template of [undefined, null, false, {}, []]) test('personalization refuses malformed template context / ' + String(template), () => refused(checkPersonalizationSchema(copy(cal.personalization), template)));
test('personalization preserves its independently supplied template control', () => assert.equal(checkPersonalizationSchema(copy(cal.personalization), copy(cal.template)).ok, true));
test('error creation rejects a non-coercible code', () => refused(createProductionError({ toString: null, valueOf: null }, copy(bases.errorCreate.context))));
for (const code of ['__proto__', 'constructor', 'toString']) test('error creation rejects inherited registry code / ' + code, () => refused(createProductionError(code, copy(bases.errorCreate.context))));

const observed = () => Object.entries(cal.byte_files).map(([filename, bytes]) => ({ filename, bytes: Buffer.from(bytes, 'base64') }));
const byteContext = () => ({ scope: copy(cal.scope), trusted_commitment: copy(cal.trusted_commitment) });
const bundle = JSON.parse(Buffer.from(cal.byte_files['manifest.json'], 'base64'));
const expected = () => copy([...bundle.files, cal.trusted_commitment.file_set.find(file => file.role === 'manifest')]);
const zip = Buffer.from(cal.byte_files['archive.zip'], 'base64');
test('SC-CHK-025 exact observed byte control remains integrity-only', () => {
  const result = verifyProductionBundleFiles(observed(), byteContext());
  assert.equal(result.ok, true); assert.equal(result.value.integrity, 'passed'); assert.equal(result.value.eligibility, 'blocked');
});
test('SC-CHK-025 exact ZIP control stays valid', () => assert.equal(verifyProductionZip(zip, expected()).ok, true));
for (const value of [undefined, null, false, {}, [], { filename: 1 }, { filename: 'manifest.json', bytes: null }]) test('SC-CHK-025 refuses malformed observed file / ' + String(value), () => {
  const input = observed(); input[0] = value;
  refused(verifyProductionBundleFiles(input, byteContext()));
});
test('SC-CHK-025 refuses a sparse observed inventory', () => {
  const input = observed(); delete input[0];
  refused(verifyProductionBundleFiles(input, byteContext()));
});
for (const value of [undefined, null, false, {}, [], { filename: 1 }]) test('SC-CHK-025 refuses malformed ZIP descriptor / ' + String(value), () => {
  const input = expected(); input[0] = value;
  refused(verifyProductionZip(zip, input));
});
test('SC-CHK-025 refuses a sparse ZIP inventory', () => {
  const input = expected(); delete input[0];
  refused(verifyProductionZip(zip, input));
});

const tuple = { ...cal.scope, operation: 'composeArtifact', idempotency_key: 'review-key', digest: hashManifest({ synthetic: true }) };
test('SC-CHK-026 genuine equal tuples do not authorize replay', () => assert.deepEqual(compareProductionIdempotency(copy(tuple), copy(tuple)), { ok: true, value: { relationship: 'same_input', replay_authorized: false } }));
for (const value of [undefined, null, false, {}, [], 0, '']) for (const side of ['input', 'prior']) test('SC-CHK-026 rejects malformed tuple / ' + side + ' / ' + String(value), () => refused(compareProductionIdempotency(side === 'input' ? value : copy(tuple), side === 'prior' ? value : copy(tuple))));
test('SC-CHK-026 two empty tuples cannot establish identity', () => refused(compareProductionIdempotency({}, {})));
for (const field of ['tenant_id', 'project_id', 'operation', 'idempotency_key', 'digest']) {
  test('SC-CHK-026 rejects missing tuple field / ' + field, () => { const input = copy(tuple); delete input[field]; refused(compareProductionIdempotency(input, copy(tuple))); });
  test('SC-CHK-026 rejects null tuple field / ' + field, () => { const input = copy(tuple); input[field] = null; refused(compareProductionIdempotency(input, copy(tuple))); });
}
for (const [field, value] of [['operation', 'notAnOperation'], ['idempotency_key', 'bad key'], ['idempotency_key', 'review-key\n'], ['digest', 'not-a-hash'], ['digest', tuple.digest + '\n'], ['tenant_id', 'not-an-id']]) test('SC-CHK-026 refuses invalid tuple value / ' + field + ' / ' + JSON.stringify(value), () => {
  const input = copy(tuple); input[field] = value;
  refused(compareProductionIdempotency(input, copy(input)));
});
for (const field of ['tenant_id', 'project_id', 'operation', 'idempotency_key']) test('SC-CHK-026 valid namespace mismatch remains NOT_FOUND / ' + field, () => {
  const prior = copy(tuple);
  prior[field] = field.endsWith('_id') ? '123e4567-e89b-42d3-a456-000000009999' : field === 'operation' ? 'inspectArtifact' : 'other-key';
  assert.equal(compareProductionIdempotency(copy(tuple), prior).errors[0].code, 'NOT_FOUND');
});
test('SC-CHK-026 valid digest mismatch remains IDEMPOTENCY_CONFLICT', () => assert.equal(compareProductionIdempotency(copy(tuple), { ...tuple, digest: hashManifest({ different: true }) }).errors[0].code, 'IDEMPOTENCY_CONFLICT'));
for (const recipe of ['cycle', 'hidden', 'symbol']) test('SC-CHK-026 refuses noncanonical tuple / ' + recipe, () => {
  const input = copy(tuple);
  if (recipe === 'cycle') input.extra = input;
  else if (recipe === 'hidden') Object.defineProperty(input, 'extra', { value: 1, enumerable: false });
  else input[Symbol('extra')] = 1;
  refused(compareProductionIdempotency(input, copy(tuple)));
});
test('idempotency comparison preserves unrelated programming errors', () => {
  const error = new Error('intentional test error'), input = new Proxy(copy(tuple), { ownKeys() { throw error; } });
  assert.throws(() => compareProductionIdempotency(input, copy(tuple)), actual => actual === error);
});
test('template validation preserves unrelated programming errors', () => {
  const error = new Error('intentional test error'), template = new Proxy(copy(cal.template), { ownKeys() { throw error; } });
  assert.throws(() => checkPersonalizationSchema(copy(cal.personalization), template), actual => actual === error);
});
test('error creation preserves unrelated programming errors', () => {
  const error = new Error('intentional test error'), context = copy(bases.errorCreate.context);
  context.diagnostic_ref = new Proxy({ state: 'unavailable' }, { ownKeys() { throw error; } });
  assert.throws(() => createProductionError('ROW_SCHEMA', context), actual => actual === error);
});
