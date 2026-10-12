import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { providerReportedCostEvidenceContentHash } from '../tooling/usage-reported-unsettled.mjs';

export const clone = value => structuredClone(value);
const fixture = JSON.parse(readFileSync(new URL('../fixtures/UsageEvent.2_0_0.json', import.meta.url), 'utf8'));
export const v1Fixture = JSON.parse(readFileSync(new URL('../fixtures/UsageEvent.json', import.meta.url), 'utf8'));
export const valid = () => ({ value: clone(fixture.valid), context: clone(fixture.context) });
export const evidenceReference = evidence => ({
  contract: 'ProviderReportedCostEvidence',
  schema_version: '1.0.0',
  id: evidence.evidence_id,
  revision: evidence.revision,
  content_hash: evidence.content_hash
});
export function updateEvidence(seed, update) {
  const evidence = clone(seed.context.evidence_lookup.record);
  update(evidence);
  evidence.content_hash = providerReportedCostEvidenceContentHash(evidence);
  const reference = evidenceReference(evidence);
  seed.value.valuation.provider_evidence_ref = reference;
  seed.context.evidence_lookup = { ...seed.context.evidence_lookup, expected_reference: reference, record: evidence, source_bytes_hash: evidence.source_bytes_hash };
  return seed;
}
export function expectFailure(result, code, path) {
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(error => error.code === code && error.path === path), JSON.stringify(result.errors));
}
