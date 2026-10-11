import { validateContract, validateContractVersion, parseContract, parseContractVersion, checkTrustedContext, canonicalJson, hashBytes } from './runtime.mjs';
import { checkOperation, compareUsageIdentity } from './operations.mjs';
import { checkResearchCreative } from './research-creative.mjs';
import { checkCommerceEvidence } from './commerce-evidence.mjs';
import { historicalFinanceFixture } from './historical-finance-fixtures.mjs';
import { checkPrintSpec, checkFulfillmentCapabilitySnapshot } from './capability.mjs';

export const fixtureCategories = Object.freeze(['minimal', 'full', 'missing', 'type', 'enum', 'malformed_json', 'unsupported_version', 'unknown_field', 'unknown_critical', 'additive_field', 'retained_encoding']);
const digest = value => hashBytes(new TextEncoder().encode(canonicalJson(value)));

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

export function fixturePayload(manifest, fixture) {
  const payload = structuredClone(manifest.valid);
  for (const key of fixture.remove ?? []) delete payload[key];
  Object.assign(payload, fixture.set ?? {});
  return payload;
}

export function evaluateFixture(contract, manifest, fixture) {
  const payload = fixturePayload(manifest, fixture);
  if (fixture.mode === 'capability') return contract === 'PrintSpec' ? checkPrintSpec(payload, fixture.context) : checkFulfillmentCapabilitySnapshot(payload, fixture.context);
  if (fixture.mode === 'commerce_evidence' || fixture.mode === 'research_creative') {
    const context = structuredClone(fixture.context);
    if (context.artifact_bytes) context.artifact_bytes = Object.fromEntries(Object.entries(context.artifact_bytes).map(([id, bytes]) => [id, Uint8Array.from(bytes)]));
    return fixture.mode === 'commerce_evidence' ? checkCommerceEvidence(contract, payload, context) : checkResearchCreative(contract, payload, context);
  }
  if (fixture.mode === 'semantic') {
    if (manifest.schema_version === '1.0.0' && ['BudgetReservation', 'ReserveRequest', 'ReserveResult', 'SettleRequest', 'SettleResult', 'ReleaseRequest', 'ReleaseResult', 'QueryRequest', 'QueryResult'].includes(contract)) return historicalFinanceFixture(contract, payload, fixture.context);
    return checkOperation(contract, payload, fixture.context);
  }
  if (fixture.mode === 'relationship') return compareUsageIdentity(fixture.prior, payload);
  if (fixture.mode === 'context') return checkTrustedContext(payload, fixture.expected_context);
  if (fixture.mode === 'parse') return parseContractVersion(contract, fixture.consumer_version ?? manifest.schema_version, fixture.json);
  if (fixture.mode && fixture.mode !== 'structural') throw new Error('Unknown fixture mode');
  return validateContractVersion(contract, fixture.consumer_version ?? manifest.schema_version, payload);
}

/** Package-owned representative adapters; independent fixture contexts are not live authority. */
export function runCanonicalFixtures(contract, manifest) {
  const failures = [], records = [], ids = new Set(), categories = new Set();
  if (manifest.contract !== contract || manifest.policy_version !== '1.0.0' || manifest.schema_version !== manifest.valid?.schema_version || !Array.isArray(manifest.cases)) {
    return { failures: [{ code: 'INVALID_FIXTURE_MANIFEST', contract }], records };
  }
  for (const fixture of manifest.cases) {
    categories.add(fixture.category);
    if (typeof fixture.id !== 'string' || ids.has(fixture.id) || fixture.policy_version !== manifest.policy_version) {
      failures.push({ code: 'INVALID_FIXTURE_CASE', contract, case: typeof fixture.id === 'string' ? fixture.id : null });
      continue;
    }
    ids.add(fixture.id);
    try {
      const result = evaluateFixture(contract, manifest, fixture);
      assertFixture(result, fixture.expected);
      let canonical_sha256 = null;
      if (result.ok && fixture.mode !== 'relationship') {
        const bytes = canonicalJson(result.value);
        const roundtrip = parseContract(contract, bytes);
        assertFixture(roundtrip, { ok: true, value: result.value });
        if (canonicalJson(roundtrip.value) !== bytes) throw new Error('Serialization drift');
        canonical_sha256 = digest(roundtrip.value);
      }
      records.push({ contract, version: result.ok && result.value?.schema_version ? result.value.schema_version : fixture.consumer_version ?? manifest.schema_version, case: fixture.id, category: fixture.category, policy_version: fixture.policy_version, mode: fixture.mode ?? 'structural', expected: fixture.expected.ok ? { ok: true } : { ok: false, code: fixture.expected.code, path: fixture.expected.path }, canonical_sha256 });
      if (manifest.schema_version === '1.0.0' && fixture.mode === 'semantic' && ['BudgetReservation', 'ReserveRequest', 'ReserveResult', 'SettleRequest', 'SettleResult', 'ReleaseRequest', 'ReleaseResult', 'QueryRequest', 'QueryResult'].includes(contract)) {
        records.at(-1).profile = 'historical_finance_characterization';
        records.at(-1).operational_authority = false;
      }
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      failures.push({ code: 'FIXTURE_MISMATCH', contract, case: fixture.id });
    }
  }
  for (const category of fixtureCategories) if (!categories.has(category)) failures.push({ code: 'MISSING_FIXTURE_CATEGORY', contract, category });
  return { failures, records };
}
