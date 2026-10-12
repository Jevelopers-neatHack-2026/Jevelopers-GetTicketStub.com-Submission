import type { FinanceV2Input, FinanceV2TrustedReferences, OpaqueProductScope } from '@jevelopers/team-dashboard';
import producerV2 from '../../tests/fixtures/finance-v2-conformance/producer-v2-page.json';
import producerBudget from '../../tests/fixtures/finance-v2-conformance/producer-budget-v2-page.json';
import producerUnknownSimulated from '../../tests/fixtures/finance-v2-conformance/producer-unknown-simulated-v2-page.json';
import producerV1 from '../../tests/fixtures/finance-v2-conformance/producer-v1-page.json';
import producerPg from '../../tests/fixtures/finance-v2-conformance/ie-ci06-pg-page.json';
import registry from '../../tests/fixtures/finance-v2-conformance/definition-registry.json';
import { financeV2Fixture, financeV2FixtureNames, syntheticQueryContentHash, syntheticSummaryContentHash, type FinanceV2FixtureName } from '../../src/views/finance-v2/fixtures';

/**
 * SYNTHETIC_CONFORMANCE_ONLY fixture-host data: the reviewed synthetic Finance-producer pages, hydrated through the same read port and views as the other
 * fixtures. Not live Finance data, not a grant, not a production acknowledgement. The identities below are host literals stated independently of each page;
 * `tests/components/finance-v2-conformance.test.tsx` re-hashes the committed files and checks these literals against its own.
 */
export const conformanceFixtureNames = ['conformance-base', 'conformance-budget', 'conformance-unknown-simulated', 'conformance-pg', 'conformance-v1-refused', 'conformance-forged-policy'] as const;
export type ConformanceFixtureName = (typeof conformanceFixtureNames)[number];
export type HostFixtureName = FinanceV2FixtureName | ConformanceFixtureName;
export const hostFixtureNames: readonly HostFixtureName[] = [...financeV2FixtureNames, ...conformanceFixtureNames];

const actorId = 'synthetic-reporting-service';
const scope = (tenantId: string, projectId: string, billingMode: string): OpaqueProductScope => ({ tenantId, projectId, environment: 'test', billingMode, actorId });
export type HostFixture = Readonly<{
  input: FinanceV2Input; expectedScope: OpaqueProductScope; expectedSnapshotId: string; expectedQueryContentHash: string; expectedSummaryContentHash: string;
  expectedReferences?: FinanceV2TrustedReferences;
}>;

/** Trusted references come from the committed registry (whose digest the conformance test pins), never from the page being displayed. */
export const registryReferences: FinanceV2TrustedReferences = {
  metrics: Object.fromEntries(Object.entries(registry.metrics).map(([name, entry]) => [name, entry.reference])),
  policy: registry.policy.reference,
};
const conformance = (page: unknown, expectedScope: OpaqueProductScope, snapshot: string, query: string, summary: string): HostFixture =>
  ({ input: { status: 'ready', page }, expectedScope, expectedSnapshotId: snapshot, expectedQueryContentHash: query, expectedSummaryContentHash: summary, expectedReferences: registryReferences });

export function hostFixture(name: HostFixtureName): HostFixture {
  switch (name) {
    case 'conformance-base': return conformance(producerV2, scope('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'live'),
      'sha256:4cb761b1942d9eef9a1f79230e97da0dee11f608b4d903a0074b401f7c63915c', 'sha256:7288e98f5ac9273db9d8f0aa50e42b4531935e4900e92f11a40ad76a358dda12', 'sha256:e0465f3ee6f6715fd4e2ac107571bc19dc58eb718eddbda08be936d6c4a7685a');
    case 'conformance-budget': return conformance(producerBudget, scope('7c30a51a-c065-472b-817e-3adf250e0880', '1f48d2f8-7496-40c2-8ee6-a7dd60528d58', 'live'),
      'sha256:afd6bfaff7b9b39c01760e21b67a15412f5116b88f3f931d87ba72763f65d884', 'sha256:bab15333c609c7ade7199175c8118e24e8e50095c5f56801f87faa70dfd2cb2a', 'sha256:13900b597734b68c2480765eb4df038a7509b707b2798ff12f723392ba6a7f4a');
    case 'conformance-unknown-simulated': return conformance(producerUnknownSimulated, scope('1e61a0e5-d091-4213-a6e1-ba3a95f42bf7', '222a194b-afc4-44ea-9217-2db0bb62da30', 'simulated'),
      'sha256:699b8545b69300dd290ea6828bec88cd109ec6af4783d1b86fb292e3f844af78', 'sha256:cf56d6609c4230f4c387813a90cce0dab768fef574b71d53aaee48baa36c0ada', 'sha256:6a9b080dddfe044c29f88660875647b1952fb12401491222995ecafa3620b54c');
    case 'conformance-pg': return conformance(producerPg, scope('d7ed6030-1573-4b28-9da8-3a543d9b0689', '9e29cbea-816a-4cee-8bea-f6084c4be9c7', 'live'),
      'sha256:9a0c1845f1bfd9b4da4c5639fba7a9972a123bca214729153cd175995c977715', 'sha256:e22bc18cd309a4c9f7e99b8086619cb35cfe2d7768a4fa531f63bdc147d066d0', 'sha256:f4f55d6902c9f0213b1407ac0a44135d490051ed5b28ceb4f7b845bf5120347d');
    case 'conformance-v1-refused': return conformance(producerV1, scope('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'live'),
      'sha256:c5e4651418bd5d0178528e1c44ca1938b1a283da4d4c2276463e58eac1033bf0', 'sha256:' + '0'.repeat(64), 'sha256:' + '0'.repeat(64));
    // The unknown-simulated page with its policy reference rewritten inside the payload. The host's registry-derived references must still win and refuse it.
    case 'conformance-forged-policy': {
      const forged = structuredClone(producerUnknownSimulated) as typeof producerUnknownSimulated;
      forged.canonicalSummaries[0]!.policy_ref.content_hash = 'sha256:' + 'f'.repeat(64);
      return conformance(forged, scope('1e61a0e5-d091-4213-a6e1-ba3a95f42bf7', '222a194b-afc4-44ea-9217-2db0bb62da30', 'simulated'),
        'sha256:699b8545b69300dd290ea6828bec88cd109ec6af4783d1b86fb292e3f844af78', 'sha256:cf56d6609c4230f4c387813a90cce0dab768fef574b71d53aaee48baa36c0ada', 'sha256:6a9b080dddfe044c29f88660875647b1952fb12401491222995ecafa3620b54c');
    }
    default: {
      const fixture = financeV2Fixture(name);
      return { ...fixture, expectedQueryContentHash: syntheticQueryContentHash, expectedSummaryContentHash: syntheticSummaryContentHash };
    }
  }
}
