import { readFile } from 'node:fs/promises';
import { adaptFulfillmentCatalogV1, checkPrintSpecBinding, translatePrintSpecToLegacy } from '@jevelopers/shared-contracts/capability';
import { validateContract, versions } from '@jevelopers/shared-contracts';
import { runCanonicalFixtures } from '@jevelopers/shared-contracts/fixture-harness';

const source = JSON.parse(await readFile(new URL(import.meta.resolve('@jevelopers/shared-contracts/compatibility/capability-source-fixtures.json')), 'utf8'));
const context = { trusted_scope: { tenant_id: '123e4567-e89b-42d3-a456-426614174001', project_id: '123e4567-e89b-42d3-a456-426614174002' }, now: '2026-10-10T10:30:00.000Z' };
for (const raw of [source.alpha, source.beta]) {
  const adapted = adaptFulfillmentCatalogV1(raw, context);
  if (!adapted.ok) throw new Error('Synthetic field migration failed');
  const snapshot = adapted.value;
  if (!validateContract('FulfillmentCapabilitySnapshot', snapshot).ok) throw new Error('Installed schema validation failed');
  const bound = checkPrintSpecBinding(snapshot.products[0], snapshot, { ...context, capture_identity: snapshot.capture_identity, content_identity: snapshot.content_identity });
  if (!bound.ok || bound.value.constraints.geometry.trim.state !== 'unknown') throw new Error('Exact consistency or unknown geometry lost');
  const blocked = translatePrintSpecToLegacy(bound.value, 'ProductionBundle/1.0.0');
  if (blocked.ok || blocked.errors[0].code !== 'LEGACY_UNREPRESENTABLE') throw new Error('Legacy loss was accepted');
}
for (const contract of ['PrintSpec', 'FulfillmentCapabilitySnapshot']) {
  const fixture = JSON.parse(await readFile(new URL(import.meta.resolve('@jevelopers/shared-contracts/fixtures/' + contract + '.json')), 'utf8'));
  if (runCanonicalFixtures(contract, fixture).failures.length) throw new Error('Installed capability fixtures failed');
  if (!versions[contract]['1.0.0']) throw new Error('Installed export missing');
}
console.log(JSON.stringify({ capability_imports: 'passed', source_fixtures: 2, provider_calls: 0, eligibility: 'not_claimed', legacy_translation: 'blocked' }));
