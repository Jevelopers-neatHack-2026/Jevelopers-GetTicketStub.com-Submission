import { createHash } from 'node:crypto';
import { checkTrustedContext, canonicalJson, hashBytes, parseContractVersion, validateContractVersion } from '../../contracts/research-contract-v1/candidate-upstream/tooling/runtime.mjs';
import { checkOperation } from '../../contracts/research-contract-v1/candidate-upstream/tooling/operations.mjs';
import { checkResearchCreative } from '../../contracts/research-contract-v1/candidate-upstream/tooling/research-creative.mjs';

const digest = value => hashBytes(new TextEncoder().encode(canonicalJson(value)));
const canonicalDigest = value => `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;

// This is the bounded EI-only extraction of fixturePayload/assertFixture/evaluateFixture
// from the exact pinned tooling/fixture-harness.mjs. It deliberately omits the
// unrelated commerce, production, capability, and historical-finance routes.
export function fixturePayload(manifest, fixture) {
  const payload = structuredClone(manifest.valid);
  for (const key of fixture.remove ?? []) delete payload[key];
  Object.assign(payload, fixture.set ?? {});
  return payload;
}

export function assertFixture(result, expected) {
  if (!expected || typeof expected.ok !== 'boolean') throw new Error('Invalid fixture expectation');
  if (expected.ok) {
    if (!result.ok) throw new Error('Positive fixture rejected');
    if (Object.hasOwn(expected, 'value') && canonicalJson(result.value) !== canonicalJson(expected.value)) throw new Error('Fixture value mismatch');
    if (expected.canonical_sha256 && digest(result.value) !== expected.canonical_sha256) throw new Error('Canonical fixture hash mismatch');
  } else if (typeof expected.code !== 'string' || typeof expected.path !== 'string' || result.ok || !Array.isArray(result.errors) || !result.errors.some(error => error.code === expected.code && error.path === expected.path)) {
    throw new Error('Negative fixture did not produce expected code/path');
  }
}

export function evaluateFixture(contract, manifest, fixture, input = {}) {
  const payload = input.payload ?? fixturePayload(manifest, fixture);
  if (fixture.mode === 'research_creative') return checkResearchCreative(contract, payload, input.context ?? structuredClone(fixture.context));
  if (fixture.mode === 'semantic') return checkOperation(contract, payload, input.context ?? structuredClone(fixture.context));
  if (fixture.mode === 'context') return checkTrustedContext(payload, input.context ?? structuredClone(fixture.expected_context));
  if (fixture.mode === 'parse') return parseContractVersion(contract, fixture.consumer_version ?? manifest.schema_version, fixture.json);
  if (fixture.mode && fixture.mode !== 'structural') throw new Error(`Unsupported EI fixture mode: ${fixture.mode}`);
  return validateContractVersion(contract, fixture.consumer_version ?? manifest.schema_version, payload);
}

export function canonicalFixtureDigest(value) {
  return canonicalDigest(value);
}
