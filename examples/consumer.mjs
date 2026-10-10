import assert from 'node:assert/strict';
import { validateContract, checkTrustedContext, projectEvidence, canonicalJson, hashManifest, validatePrimitive } from '@jevelopers/shared-contracts';
import fixture from '@jevelopers/shared-contracts/fixtures/CommonEnvelope.json' with { type: 'json' };
import evidenceFixture from '@jevelopers/shared-contracts/fixtures/EvidenceProjection.json' with { type: 'json' };

const parsed = validateContract('CommonEnvelope', fixture.valid);
assert.equal(parsed.ok, true);
if (!parsed.ok) throw new Error('Fixture did not parse');
// Independently supplied synthetic server context; production obtains it from its authenticated adapter.
const authenticatedExpectations = { tenant_id: '123e4567-e89b-42d3-a456-426614174000', project_id: '123e4567-e89b-42d3-a456-426614174000' };
assert.equal(checkTrustedContext(parsed.value, authenticatedExpectations).ok, true);
assert.deepEqual(checkTrustedContext({ ...parsed.value, tenant_id: '123e4567-e89b-42d3-a456-426614174001' }, authenticatedExpectations), { ok: false, errors: [{ code: 'SCOPE_MISMATCH', path: '/tenant_id' }] });
const rejected = validateContract('CommonEnvelope', { ...fixture.valid, schema_version: '2.0.0' });
assert.equal(rejected.ok, false);
if (rejected.ok) throw new Error('Unsupported version accepted');
assert.deepEqual(rejected.errors, [{ code: 'UNSUPPORTED_VERSION', path: '/schema_version' }]);
const projected = projectEvidence({ ...evidenceFixture.valid, credentials: 'SYNTHETIC', component: { ...evidenceFixture.valid.component, private_locator: 'https://example.invalid/?token=SYNTHETIC', nested: { prompt: 'PRIVATE' } } });
assert.equal(projected.ok, true);
if (!projected.ok) throw new Error('Projection rejected');
assert.deepEqual(projected.value, evidenceFixture.valid);
assert.equal(canonicalJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
assert.equal(hashManifest(projected.value), hashManifest(evidenceFixture.valid));
assert.equal(validatePrimitive('ExactDecimal', '0.000001').ok, true);
assert.equal(validatePrimitive('ExactDecimal', 0.000001).ok, false);
console.log(JSON.stringify({ status: 'passed', node: process.version, dependency_mode: 'offline_installed_archive', cases: ['valid_import', 'scope', 'unsupported_version', 'nested_projection', 'hash', 'exact_decimal'] }));
