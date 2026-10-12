import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FinanceV2ConnectedView, FinanceV2View, checkFinanceV2Page, type FinanceV2CanonicalReference, type FinanceV2SyntheticReadPort, type FinanceV2TrustedReferences, type OpaqueProductScope } from '../../src/views/finance-v2';
import { financeV2Fixture } from '../../src/views/finance-v2/fixtures';
import { hostFixture } from '../../integration/fixture-host/conformance';

/**
 * SYNTHETIC_CONFORMANCE_ONLY. The pages are reviewed synthetic Finance-producer outputs committed byte for byte; nothing here is a live grant, production data
 * or an owner/production acknowledgement. Every host expectation below is a literal stated in this test, never read from the page under test.
 */
const DIR = 'tests/fixtures/finance-v2-conformance/';
const bytes = (name: string): Buffer => readFileSync(DIR + name);
const sha256 = (data: Buffer | string): string => createHash('sha256').update(data).digest('hex');
const json = <T = any>(name: string): T => JSON.parse(bytes(name).toString('utf8')) as T; // eslint-disable-line @typescript-eslint/no-explicit-any

const PINS = {
  'producer-v2-page.json': 'c272b9b8d25f3d73bed228554f95b448d3951bc2bb9b8defcabc4d633249ac3d',
  'producer-budget-v2-page.json': '5887fede39b86791972fcb57f35f549ec5869a2108a4f18a3a07bb7e61abfe85',
  'producer-unknown-simulated-v2-page.json': 'a2fc429439d1a7488ed037ce499acb1d97aaf614997fd1d17afb1bebdfcf4755',
  'producer-v1-page.json': '0b9b7210c515d05af66eea0f48c9fd1b79b737bb60230dcf67b23b4588447be3',
  'ie-ci06-pg-page.json': '4462b866d69c9da2d5f92086f89c6cec8cb898d4af08d9e2ac8e94c9cbb21e03',
  'definition-registry.json': '577ce8801855db08ba393f115c00ac670df3a47a5cc9e9a5a78f8b0132cb34e1',
  'schemas/FinancialSummaryPageSchema.json': '862900ad30b1e5684c98852cb93f0010eb73504d2fd9f58018673c9334ddf814',
  'source/schema-v2.ts': '0400a033d1bf13cf047cda507639126b362e99c1bb26348ad3b233758aa38fdb',
  'source/query-export-handoff.json': 'eca74fe6fd34b9631fcb3022f3417425ef94580043a67fce4832b52fa6993da9',
} as const;

type Expectation = Readonly<{ file: keyof typeof PINS; scope: OpaqueProductScope; snapshot: string; query: string; summary: string }>;
const actorId = 'synthetic-reporting-service';
const EXPECTED: Readonly<Record<'base' | 'budget' | 'unknown' | 'pg', Expectation>> = {
  base: { file: 'producer-v2-page.json', scope: { tenantId: '11111111-1111-4111-8111-111111111111', projectId: '22222222-2222-4222-8222-222222222222', environment: 'test', billingMode: 'live', actorId },
    snapshot: 'sha256:4cb761b1942d9eef9a1f79230e97da0dee11f608b4d903a0074b401f7c63915c', query: 'sha256:7288e98f5ac9273db9d8f0aa50e42b4531935e4900e92f11a40ad76a358dda12', summary: 'sha256:e0465f3ee6f6715fd4e2ac107571bc19dc58eb718eddbda08be936d6c4a7685a' },
  budget: { file: 'producer-budget-v2-page.json', scope: { tenantId: '7c30a51a-c065-472b-817e-3adf250e0880', projectId: '1f48d2f8-7496-40c2-8ee6-a7dd60528d58', environment: 'test', billingMode: 'live', actorId },
    snapshot: 'sha256:afd6bfaff7b9b39c01760e21b67a15412f5116b88f3f931d87ba72763f65d884', query: 'sha256:bab15333c609c7ade7199175c8118e24e8e50095c5f56801f87faa70dfd2cb2a', summary: 'sha256:13900b597734b68c2480765eb4df038a7509b707b2798ff12f723392ba6a7f4a' },
  unknown: { file: 'producer-unknown-simulated-v2-page.json', scope: { tenantId: '1e61a0e5-d091-4213-a6e1-ba3a95f42bf7', projectId: '222a194b-afc4-44ea-9217-2db0bb62da30', environment: 'test', billingMode: 'simulated', actorId },
    snapshot: 'sha256:699b8545b69300dd290ea6828bec88cd109ec6af4783d1b86fb292e3f844af78', query: 'sha256:cf56d6609c4230f4c387813a90cce0dab768fef574b71d53aaee48baa36c0ada', summary: 'sha256:6a9b080dddfe044c29f88660875647b1952fb12401491222995ecafa3620b54c' },
  pg: { file: 'ie-ci06-pg-page.json', scope: { tenantId: 'd7ed6030-1573-4b28-9da8-3a543d9b0689', projectId: '9e29cbea-816a-4cee-8bea-f6084c4be9c7', environment: 'test', billingMode: 'live', actorId },
    snapshot: 'sha256:9a0c1845f1bfd9b4da4c5639fba7a9972a123bca214729153cd175995c977715', query: 'sha256:e22bc18cd309a4c9f7e99b8086619cb35cfe2d7768a4fa531f63bdc147d066d0', summary: 'sha256:f4f55d6902c9f0213b1407ac0a44135d490051ed5b28ceb4f7b845bf5120347d' },
};
const V1 = { file: 'producer-v1-page.json', snapshot: 'sha256:c5e4651418bd5d0178528e1c44ca1938b1a283da4d4c2276463e58eac1033bf0' } as const;

/** The host-side trust step: references come from a registry whose digest is pinned independently of any page, never from a page. Fails closed. */
function trustedReferencesFrom(registry: Buffer | undefined): FinanceV2TrustedReferences {
  if (registry === undefined || registry.length === 0) throw new Error('registry missing');
  if (sha256(registry) !== PINS['definition-registry.json']) throw new Error('registry digest differs from the pin');
  const parsed = JSON.parse(registry.toString('utf8')) as { metrics: Record<string, { reference: FinanceV2CanonicalReference }>; policy: { reference: FinanceV2CanonicalReference } };
  return { metrics: Object.fromEntries(Object.entries(parsed.metrics).map(([name, entry]) => [name, entry.reference])), policy: parsed.policy.reference };
}
const trusted = () => trustedReferencesFrom(bytes('definition-registry.json'));

const accept = (key: keyof typeof EXPECTED, page: unknown = json(EXPECTED[key].file)) => {
  const e = EXPECTED[key];
  return checkFinanceV2Page(page, e.scope, e.snapshot, { queryContentHash: e.query, summaryContentHash: e.summary, references: trusted() });
};
const view = (key: keyof typeof EXPECTED, name: 'budget' | 'breakdown' | 'transactions' | 'transaction-detail', extra: { detailId?: string; page?: unknown } = {}) => {
  const e = EXPECTED[key];
  return render(<FinanceV2View mode="SYNTHETIC_PROPOSAL" view={name} input={{ status: 'ready', page: extra.page ?? json(e.file) }} expectedScope={e.scope} expectedSnapshotId={e.snapshot}
    expectedQueryContentHash={e.query} expectedSummaryContentHash={e.summary} {...(extra.detailId ? { detailId: extra.detailId } : {})} />);
};
const region = (name: string) => screen.getByRole('region', { name });
const clone = (key: keyof typeof EXPECTED) => structuredClone(json(EXPECTED[key].file));

describe('committed artifacts and pins (portable: no /tmp, no skips)', () => {
  it.each(Object.entries(PINS))('%s hashes to its pinned digest', (file, digest) => { expect(sha256(bytes(file))).toBe(digest); });
  it('keeps PROVENANCE.json in step with the literal pins in this test', () => {
    const provenance = json('PROVENANCE.json') as { classification: string; producer: { revision: string; treePrefix: string }; handoff: { ownerReceipt: string; acceptance: string; producerFullCi: string }; committed: { path: string; sha256: string }[] };
    expect(provenance.classification).toBe('SYNTHETIC_CONFORMANCE_ONLY');
    expect(provenance.producer).toEqual({ revision: '22a3237dd44f376017969ac881586ff396f19cf8', treePrefix: '4f8dcc', treeNote: expect.any(String) });
    expect(provenance.handoff.ownerReceipt).toMatch(/issues\/2#issuecomment-6123320849$/u);
    expect(provenance.handoff.acceptance).toBe('Finance-owner accepted SYNTHETIC_CONFORMANCE_ONLY');
    expect(provenance.handoff.producerFullCi).toMatch(/^FAIL/u);
    expect(Object.fromEntries(provenance.committed.map((item) => [item.path, item.sha256]))).toEqual(PINS);
    expect(Object.keys(PINS)).toHaveLength(9);
  });
  it('keeps the fixture-host literals equal to the literals stated in this test', () => {
    for (const [key, name] of [['base', 'conformance-base'], ['budget', 'conformance-budget'], ['unknown', 'conformance-unknown-simulated'], ['pg', 'conformance-pg']] as const) {
      const host = hostFixture(name); const e = EXPECTED[key];
      expect({ scope: host.expectedScope, snapshot: host.expectedSnapshotId, query: host.expectedQueryContentHash, summary: host.expectedSummaryContentHash }, name).toEqual({ scope: e.scope, snapshot: e.snapshot, query: e.query, summary: e.summary });
      expect(host.input, name).toEqual({ status: 'ready', page: json(e.file) });
      expect(host.expectedReferences, name).toEqual(trusted());
    }
    expect(hostFixture('conformance-v1-refused').input).toEqual({ status: 'ready', page: json(V1.file) });
  });
  it('detects a one-byte change in a committed page', () => {
    const tampered = Buffer.from(bytes('producer-unknown-simulated-v2-page.json'));
    tampered[tampered.length - 2] = tampered[tampered.length - 2]! ^ 1;
    expect(sha256(tampered)).not.toBe(PINS['producer-unknown-simulated-v2-page.json']);
  });
  it('pins a page schema that requires exactly the members the guard requires and is closed', () => {
    const schema = json('schemas/FinancialSummaryPageSchema.json') as { required: string[]; additionalProperties: boolean; 'x-schema-completeness': string };
    expect(schema.additionalProperties).toBe(false);
    expect(schema['x-schema-completeness']).toBe('partial_wrapper_requires_combined_validation');
    expect(Object.keys(json(EXPECTED.unknown.file)).sort()).toEqual([...schema.required].sort());
  });
});

describe('trusted references come from the pinned registry, not the payload', () => {
  it('builds references from the registry and fails closed when it is missing, empty or its digest differs', () => {
    expect(Object.keys(trusted().metrics)).toEqual(['expense', 'gross_sales', 'net_sales', 'direct_costs', 'contribution', 'cash_receipts', 'cash_payouts']);
    expect(() => trustedReferencesFrom(undefined)).toThrow('registry missing');
    expect(() => trustedReferencesFrom(Buffer.alloc(0))).toThrow('registry missing');
    expect(() => trustedReferencesFrom(Buffer.from(bytes('definition-registry.json').toString('utf8').replace('"revision": 1', '"revision": 2')))).toThrow('digest differs');
  });
  it('accepts each page whose canonical references equal the registry', () => {
    for (const key of ['base', 'budget', 'unknown', 'pg'] as const) expect(accept(key), key).toMatchObject({ ok: true });
    expect((json(EXPECTED.unknown.file) as { canonicalSummaries: unknown[] }).canonicalSummaries.length).toBeGreaterThan(0);
  });
  it('refuses a metric definition reference whose hash, revision, id, contract or schema version the registry does not state', () => {
    for (const [field, value] of [['content_hash', 'sha256:' + '0'.repeat(64)], ['revision', 2], ['id', '00000000-0000-4000-8000-000000000000'], ['contract', 'cost-intelligence.reporting.other'], ['schema_version', '9.9.9']] as const) {
      const page = clone('unknown'); page.canonicalSummaries[0].metrics.expense.definition_ref[field] = value;
      expect(accept('unknown', page), field).toEqual({ ok: false, code: 'REFERENCE_MISMATCH', path: '/canonicalSummaries/0/metrics/expense/definition_ref' });
    }
  });
  it('refuses a swapped metric reference, an extra reference member, a missing reference and a tampered policy reference', () => {
    const swapped = clone('unknown'); const m = swapped.canonicalSummaries[0].metrics; [m.expense.definition_ref, m.net_sales.definition_ref] = [m.net_sales.definition_ref, m.expense.definition_ref];
    expect(accept('unknown', swapped)).toMatchObject({ ok: false, code: 'REFERENCE_MISMATCH', path: '/canonicalSummaries/0/metrics/expense/definition_ref' });
    const extra = clone('unknown'); extra.canonicalSummaries[0].metrics.net_sales.definition_ref.note = 'self-vouching';
    expect(accept('unknown', extra)).toMatchObject({ ok: false, code: 'REFERENCE_MISMATCH', path: '/canonicalSummaries/0/metrics/net_sales/definition_ref' });
    const missing = clone('unknown'); delete missing.canonicalSummaries[0].metrics.cash_payouts.definition_ref;
    expect(accept('unknown', missing)).toMatchObject({ ok: false, code: 'REFERENCE_MISMATCH', path: '/canonicalSummaries/0/metrics/cash_payouts/definition_ref' });
    const policy = clone('unknown'); policy.canonicalSummaries[0].policy_ref.content_hash = 'sha256:' + 'f'.repeat(64);
    expect(accept('unknown', policy)).toEqual({ ok: false, code: 'REFERENCE_MISMATCH', path: '/canonicalSummaries/0/policy_ref' });
  });
  it('refuses an unknown metric name, including prototype-shaped names, instead of resolving it through the registry object', () => {
    const invented = clone('unknown'); invented.canonicalSummaries[0].metrics.inventedMetric = invented.canonicalSummaries[0].metrics.expense;
    expect(accept('unknown', invented)).toMatchObject({ ok: false, code: 'REFERENCE_MISMATCH', path: '/canonicalSummaries/0/metrics/inventedMetric/definition_ref' });
    const text = bytes(EXPECTED.unknown.file).toString('utf8').replace('"gross_sales": {', '"__proto__": {').replace('"net_sales": {', '"constructor": {');
    expect(accept('unknown', JSON.parse(text))).toMatchObject({ ok: false, code: 'REFERENCE_MISMATCH' });
  });
  it('does not bind references when the host supplies none (the page is never its own authority)', () => {
    const e = EXPECTED.unknown; const page = clone('unknown'); page.canonicalSummaries[0].policy_ref.content_hash = 'sha256:' + 'f'.repeat(64);
    expect(checkFinanceV2Page(page, e.scope, e.snapshot, { queryContentHash: e.query, summaryContentHash: e.summary }).ok).toBe(true);
    expect(accept('unknown', page).ok).toBe(false);
  });
});

describe('the explicit simulated ReportingAmount shape (actual unknown-simulated artifact)', () => {
  it('carries partial simulated expense: known subtotal 5, total null, unknown count 1, and unknown actual expense', () => {
    const page = json(EXPECTED.unknown.file).summary.currencies[0];
    expect(page.simulated.expense).toEqual({ status: 'partial', knownSubtotal: '5', total: null, unknownCount: 1 });
    expect(page.metrics.expense).toEqual({ status: 'unknown', knownSubtotal: null, total: null, unknownCount: 0 });
  });
  it('hydrates simulated expense as partial 5, total unknown, count 1, never a scalar and never zero', () => {
    view('unknown', 'breakdown');
    const row = within(within(region('USD simulated')).getByRole('table', { name: 'USD simulated amounts' })).getByRole('rowheader', { name: 'Simulated expense' }).closest('tr')!;
    expect(within(row).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['partial', '5 USD', 'Amount unknown', '1']);
    const gross = within(region('USD simulated')).getByRole('rowheader', { name: 'Simulated gross sales' }).closest('tr')!;
    expect(within(gross).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['unknown', 'Amount unknown', 'Amount unknown', '0']);
  });
  it('keeps the actual expense unknown (null) apart from the simulated 5 and from confirmed 0', () => {
    view('unknown', 'breakdown');
    const expense = within(screen.getByRole('table', { name: 'USD parent totals' })).getByRole('rowheader', { name: 'expense' }).closest('tr')!;
    expect(within(expense).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['unknown', 'Amount unknown', 'Amount unknown', '0']);
    const valuation = within(screen.getByRole('table', { name: 'USD valuation' }));
    expect(within(valuation.getByRole('rowheader', { name: 'Confirmed' }).closest('tr')!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['known', '0 USD', '0 USD', '0']);
    expect(region('USD valuation and reconciliation')).toHaveTextContent('Unknown valuation count1');
    expect(region('USD valuation and reconciliation')).toHaveTextContent('Reconciliation unmatched2');
  });
  it('refuses the earlier proposal shape (scalar simulated strings) under its own code rather than reading it as this 2.0.0', () => {
    const legacy = clone('unknown'); legacy.summary.currencies[0].simulated = { expense: '5', grossSales: '0', netSales: '0', directCosts: '5' };
    expect(accept('unknown', legacy)).toEqual({ ok: false, code: 'LEGACY_PROPOSAL_SHAPE', path: '/summary/currencies/0/simulated/expense' });
    view('unknown', 'breakdown', { page: legacy });
    expect(screen.getByRole('alert')).toHaveTextContent('LEGACY_PROPOSAL_SHAPE');
    expect(document.body.textContent).not.toMatch(/Simulated expense/u);
  });
  it.each([
    ['a number', 5], ['null', null], ['an empty object', {}], ['an unknown status', { status: 'zero', knownSubtotal: '0', total: '0', unknownCount: 0 }],
    ['a negative unknown count', { status: 'partial', knownSubtotal: '5', total: null, unknownCount: -1 }], ['a fractional unknown count', { status: 'partial', knownSubtotal: '5', total: null, unknownCount: 1.5 }],
    ['a numeric subtotal', { status: 'partial', knownSubtotal: 5, total: null, unknownCount: 1 }], ['an undefined total', { status: 'partial', knownSubtotal: '5', unknownCount: 1 }],
  ] as const)('refuses simulated expense as %s with an exact path', (_label, value) => {
    const page = clone('unknown'); page.summary.currencies[0].simulated.expense = value;
    const result = accept('unknown', page);
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code: 'INVALID_SHAPE' });
    expect((result as { path: string }).path).toMatch(/^\/summary\/currencies\/0\/simulated\/expense(\/|$)/u);
  });
});

describe('actual artifacts hydrate the budget, breakdown and detail views with exact strings', () => {
  it('budget: exact limit, held, remaining capacity and policy reference; advisory only; lifecycle apart from ledger', () => {
    view('budget', 'budget');
    const card = region('USD budget advisory');
    const pair = (title: string) => within(card).getByRole('heading', { name: `USD ${title}` }).closest('section')!;
    expect(pair('limit')).toHaveTextContent('1 USD');
    expect(pair('held')).toHaveTextContent('0.75 USD');
    expect(pair('remaining authorized capacity (advisory)')).toHaveTextContent('0.25 USD');
    expect(pair('remaining authorized capacity (advisory)')).toHaveTextContent('Not spend authority');
    expect(pair('ledger expense')).toHaveTextContent('0 USD');
    expect(pair('lifecycle consumed')).toHaveTextContent('It is not ledger expense');
    expect(card).toHaveTextContent('d8def504-7c33-4c2c-b33d-a428739d0dd4 revision 1 (sha256:122f70413f215f2cd0c897f6464d936a1b3c8f6038b642c88a9c714d64e1c583)');
    expect(card).toHaveTextContent('No unresolved exposure reported');
  });
  it('budget with no limit or capacity reads unknown, not zero, and shows unresolved exposure', () => {
    view('unknown', 'budget');
    const card = region('USD budget advisory');
    expect(within(card).getByRole('heading', { name: 'USD limit' }).closest('section')).toHaveTextContent('Amount unknown');
    expect(within(card).getByRole('heading', { name: 'USD remaining authorized capacity (advisory)' }).closest('section')).toHaveTextContent('Amount unknown');
    expect(card).toHaveTextContent('Yes: exposure is unresolved');
    expect(card).toHaveTextContent('No policy reference delivered');
  });
  it('breakdown: two currencies stay separate, 18-digit and negative strings are verbatim, nothing is combined', () => {
    view('base', 'breakdown');
    const usd = region('USD cost breakdown'); const eur = region('EUR cost breakdown');
    expect(usd).not.toHaveTextContent('EUR'); expect(eur).not.toHaveTextContent('USD');
    expect(eur).toHaveTextContent('-2 EUR');
    expect(within(screen.getByRole('table', { name: 'EUR parent totals' })).getByRole('rowheader', { name: 'expense' }).closest('tr')).toHaveTextContent('partial');
    expect(document.body.textContent).toContain('1.000000000000000001 USD');
    expect(screen.queryAllByRole('heading', { name: /combined|converted|grand total/iu })).toHaveLength(0);
  });
  it('transactions: producer detail count and hasMore are shown, and only the delivered page is listed', () => {
    view('base', 'transactions');
    expect(region('Transaction list')).toHaveTextContent('Detail count (producer)6');
    expect(region('Transaction list')).toHaveTextContent('Yes. Only the delivered page is shown');
    expect(region('Transaction list')).toHaveTextContent(/Next cursor(?!None)/u);
  });
  it('detail: the first unknown-simulated detail shows simulated 5 beside actual 0 with its snapshot-bound parent totals', () => {
    const detail = json(EXPECTED.unknown.file).details[0];
    view('unknown', 'transaction-detail', { detailId: detail.detailId });
    expect(region('Transaction record')).toHaveTextContent('5 USD');
    const metrics = region('Detail metrics');
    expect(within(metrics).getAllByRole('term').map((term) => term.textContent)).toEqual(['expense', 'grossSales', 'netSales', 'directCosts', 'contribution', 'cashReceipts', 'cashPayouts', 'simulatedGrossSales', 'simulatedNetSales', 'simulatedDirectCosts', 'simulatedExpense']);
    expect(metrics).toHaveTextContent('expense0 USD');
    expect(metrics).toHaveTextContent('simulatedExpense5 USD');
    expect(region('USD parent totals for this snapshot')).toHaveTextContent('This detail is not added to them');
  });
  it('detail: the unknown-valuation detail has a null amount shown as unknown, not zero', () => {
    const detail = json(EXPECTED.unknown.file).details[1];
    view('unknown', 'transaction-detail', { detailId: detail.detailId });
    expect(region('Transaction record')).toHaveTextContent('Amount unknown');
    expect(region('Detail states')).toHaveTextContent('unknown');
  });
  it('labels every view SYNTHETIC_CONFORMANCE with pending definitions and no production acknowledgement, and shows the snapshot identity and watermark', () => {
    view('pg', 'breakdown');
    expect(screen.getByRole('note')).toHaveTextContent('SYNTHETIC_CONFORMANCE');
    expect(screen.getByRole('note')).toHaveTextContent('not a production acknowledgement');
    const snapshot = region('Snapshot and scope');
    for (const text of [EXPECTED.pg.snapshot, EXPECTED.pg.query, EXPECTED.pg.summary, EXPECTED.pg.scope.tenantId, 'PENDING FINANCE-OWNER SIGN-OFF', 'proposal_only_owner_ack_pending', 'ci08-reporting-policy-2.0.0', 'sha256:a41061a3f46b3a33c330a25597c8fb9bdd55241793d9bde3a2fcb6ab3ab1704f', 'immutable_finance_inputs partial']) expect(snapshot).toHaveTextContent(text);
  });
  it('keeps the CFO export disabled on every view with no success claim', () => {
    for (const name of ['budget', 'breakdown', 'transactions'] as const) {
      const { unmount } = view('base', name);
      expect(within(region('CFO export')).getByRole('button', { name: 'Export unavailable' })).toBeDisabled();
      expect(document.body.textContent).not.toMatch(/\.csv|export (started|complete|succeeded)|downloaded/iu);
      unmount();
    }
  });
});

describe('malformed, forged and unsupported artifacts are refused and show no amounts', () => {
  const noAmounts = () => expect(document.body.textContent).not.toMatch(/\d+ (USD|EUR)/u);
  it('refuses the v1 producer page as an unsupported major', () => {
    const e = EXPECTED.unknown;
    expect(checkFinanceV2Page(json(V1.file), e.scope, V1.snapshot)).toEqual({ ok: false, code: 'UNSUPPORTED_VERSION', path: '/schemaVersion' });
  });
  it.each([
    ['forged tenant', (p: any) => { p.scope.tenantId = '99999999-9999-4999-8999-999999999999'; }, 'SCOPE_MISMATCH', '/scope/tenantId'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['tenant and project swapped', (p: any) => { [p.scope.tenantId, p.scope.projectId] = [p.scope.projectId, p.scope.tenantId]; }, 'SCOPE_MISMATCH', '/scope/tenantId'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['forged environment', (p: any) => { p.scope.environment = 'prod'; }, 'SCOPE_MISMATCH', '/scope/environment'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['forged billing mode', (p: any) => { p.scope.billingMode = 'live'; }, 'SCOPE_MISMATCH', '/scope/billingMode'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['forged actor', (p: any) => { p.scope.actorId = 'someone-else'; }, 'SCOPE_MISMATCH', '/scope/actorId'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['forged snapshot', (p: any) => { p.snapshotId = 'sha256:' + 'a'.repeat(64); }, 'SNAPSHOT_MISMATCH', '/snapshotId'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['forged query hash', (p: any) => { p.queryContentHash = 'sha256:' + 'b'.repeat(64); }, 'QUERY_HASH_MISMATCH', '/queryContentHash'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['forged summary hash', (p: any) => { p.summaryContentHash = 'sha256:' + 'c'.repeat(64); }, 'SUMMARY_HASH_MISMATCH', '/summaryContentHash'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['unsupported minor', (p: any) => { p.schemaVersion = '2.1.0'; }, 'UNSUPPORTED_VERSION', '/schemaVersion'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['invented top-level member', (p: any) => { p.grant = 'finance.summary.export'; }, 'INVALID_SHAPE', '/grant'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['missing filters', (p: any) => { delete p.filters; }, 'INVALID_SHAPE', '/filters'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['missing watermark', (p: any) => { delete p.watermark; }, 'INVALID_SHAPE', '/watermark'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['malformed watermark id', (p: any) => { p.watermark.watermarkId = 'sha256:short'; }, 'INVALID_SHAPE', '/watermark/watermarkId'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['empty watermark sources', (p: any) => { p.watermark.sources = []; }, 'INVALID_SHAPE', '/watermark/sources'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['missing canonical summaries', (p: any) => { delete p.canonicalSummaries; }, 'INVALID_SHAPE', '/canonicalSummaries'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['unknown mapping status', (p: any) => { p.canonicalMappingStatus = 'accepted'; }, 'INVALID_SHAPE', '/canonicalMappingStatus'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['scale 6', (p: any) => { p.summary.currencies[0].scale = 6; }, 'INVALID_SHAPE', '/summary/currencies/0/scale'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['scalar actual total', (p: any) => { p.summary.currencies[0].metrics.expense = '5'; }, 'INVALID_SHAPE', '/summary/currencies/0/metrics/expense'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['detail currency absent from the summary', (p: any) => { p.details[0].currency = 'JPY'; }, 'SNAPSHOT_MISMATCH', '/details/0/currency'], // eslint-disable-line @typescript-eslint/no-explicit-any
    ['advisory flag false', (p: any) => { p.summary.budgets[0].advisoryOnly = false; }, 'INVALID_SHAPE', '/summary/budgets/0/advisoryOnly'], // eslint-disable-line @typescript-eslint/no-explicit-any
  ] as const)('%s is refused as %s at %s, in the guard and in the rendered view', (_label, mutate, code, path) => {
    const page = clone('unknown'); mutate(page);
    expect(accept('unknown', page)).toEqual({ ok: false, code, path });
    view('unknown', 'breakdown', { page });
    expect(screen.getByRole('alert')).toHaveTextContent(code);
    expect(screen.getByRole('alert')).toHaveTextContent(path);
    noAmounts();
  });
  it.each([null, undefined, 'page', 7, [], {}, true])('refuses a non-page value %j', (value) => { expect(checkFinanceV2Page(value, EXPECTED.unknown.scope).ok).toBe(false); });
  it('refuses malformed JSON text handed in place of a parsed page', () => { expect(accept('unknown', bytes(EXPECTED.unknown.file).toString('utf8').slice(0, 200)).ok).toBe(false); });
  it('cross-binding: a valid page presented under another artifact\'s host expectation is refused', () => {
    const e = EXPECTED.budget;
    expect(checkFinanceV2Page(json(EXPECTED.unknown.file), e.scope, e.snapshot, { queryContentHash: e.query, summaryContentHash: e.summary })).toMatchObject({ ok: false, code: 'SCOPE_MISMATCH' });
  });
});

describe('registry-pinned references bind through the view props and the async read port', () => {
  const portOf = (page: unknown): FinanceV2SyntheticReadPort => ({ kind: 'SYNTHETIC_PROPOSAL', read: async () => ({ status: 'ready', page }) });
  const connected = (key: keyof typeof EXPECTED, page: unknown, references: FinanceV2TrustedReferences | null = trusted(), view: 'breakdown' | 'budget' = 'breakdown') => {
    const e = EXPECTED[key];
    return render(<FinanceV2ConnectedView mode="SYNTHETIC_PROPOSAL" view={view} port={portOf(page)} availability={{ status: 'available' }} scope={e.scope} authorization={{ revision: '1', token: async () => 'token' }}
      expectedSnapshotId={e.snapshot} expectedQueryContentHash={e.query} expectedSummaryContentHash={e.summary} {...(references ? { expectedReferences: references } : {})} />);
  };
  it('FinanceV2View refuses a forged policy reference when the host supplies the pinned references, and shows the exact refusal path', () => {
    const page = clone('unknown'); page.canonicalSummaries[0].policy_ref.revision = 9;
    const e = EXPECTED.unknown;
    render(<FinanceV2View mode="SYNTHETIC_PROPOSAL" view="breakdown" input={{ status: 'ready', page }} expectedScope={e.scope} expectedSnapshotId={e.snapshot} expectedQueryContentHash={e.query} expectedSummaryContentHash={e.summary} expectedReferences={trusted()} />);
    expect(screen.getByRole('alert')).toHaveTextContent('REFERENCE_MISMATCH');
    expect(screen.getByRole('alert')).toHaveTextContent('/canonicalSummaries/0/policy_ref');
    expect(document.body.textContent).not.toMatch(/\d+ (USD|EUR)/u);
  });
  it('the connected view hydrates every actual artifact through the port with the registry references bound', async () => {
    for (const key of ['base', 'budget', 'unknown', 'pg'] as const) {
      const { unmount } = connected(key, json(EXPECTED[key].file));
      expect(await screen.findByRole('note'), key).toHaveTextContent('SYNTHETIC_CONFORMANCE');
      expect(screen.queryByText('Report refused'), key).toBeNull();
      unmount();
    }
  });
  it('the connected view refuses a forged definition reference from the port and shows no amounts', async () => {
    const page = clone('unknown'); page.canonicalSummaries[0].metrics.expense.definition_ref.content_hash = 'sha256:' + '0'.repeat(64);
    connected('unknown', page);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Report refused');
    expect(alert).toHaveTextContent('REFERENCE_MISMATCH');
    expect(alert).toHaveTextContent('/canonicalSummaries/0/metrics/expense/definition_ref');
    expect(document.body.textContent).not.toMatch(/\d+ (USD|EUR)/u);
  });
  it('the connected view refuses the earlier proposal shape from the port', async () => {
    const legacy = clone('unknown'); legacy.summary.currencies[0].simulated = { expense: '5', grossSales: '0', netSales: '0', directCosts: '5' };
    connected('unknown', legacy);
    expect(await screen.findByRole('alert')).toHaveTextContent('LEGACY_PROPOSAL_SHAPE');
  });
  it('without host references nothing is bound, so a page cannot vouch for itself (documented limit, not an acceptance)', async () => {
    const page = clone('unknown'); page.canonicalSummaries[0].policy_ref.content_hash = 'sha256:' + 'f'.repeat(64);
    connected('unknown', page, null);
    expect(await screen.findByRole('note')).toHaveTextContent('SYNTHETIC_CONFORMANCE');
  });
  it('changing the pinned references invalidates a settled answer instead of showing it', async () => {
    const page = json(EXPECTED.unknown.file); const e = EXPECTED.unknown;
    const props = (references: FinanceV2TrustedReferences) => ({ mode: 'SYNTHETIC_PROPOSAL' as const, view: 'breakdown' as const, port: portOf(page), availability: { status: 'available' as const }, scope: e.scope,
      authorization: { revision: '1', token: async () => 'token' }, expectedSnapshotId: e.snapshot, expectedQueryContentHash: e.query, expectedSummaryContentHash: e.summary, expectedReferences: references });
    const stable = props(trusted());
    const { rerender } = render(<FinanceV2ConnectedView {...stable} />);
    expect(await screen.findByRole('note')).toBeInTheDocument();
    rerender(<FinanceV2ConnectedView {...stable} expectedReferences={{ ...trusted(), policy: { ...trusted().policy, revision: 99 } }} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('REFERENCE_MISMATCH');
  });
});

describe('fixture-host routes serve the actual produced pages (SYNTHETIC_CONFORMANCE)', () => {
  it('hydrates each host fixture through the same guard with host-owned expectations, and refuses the v1 page', () => {
    for (const name of ['conformance-base', 'conformance-budget', 'conformance-unknown-simulated', 'conformance-pg'] as const) {
      const f = hostFixture(name);
      expect(f.input.status === 'ready' && checkFinanceV2Page(f.input.page, f.expectedScope, f.expectedSnapshotId, { queryContentHash: f.expectedQueryContentHash, summaryContentHash: f.expectedSummaryContentHash, ...(f.expectedReferences ? { references: f.expectedReferences } : {}) }).ok, name).toBe(true);
    }
    const v1 = hostFixture('conformance-v1-refused');
    expect(v1.input.status === 'ready' && checkFinanceV2Page(v1.input.page, v1.expectedScope, v1.expectedSnapshotId)).toEqual({ ok: false, code: 'UNSUPPORTED_VERSION', path: '/schemaVersion' });
  });
  it('keeps every earlier synthetic fixture route (host fixtures delegate unchanged to the proposal fixtures)', () => {
    const f = hostFixture('ready');
    expect(f.input).toEqual(financeV2Fixture('ready').input);
    expect(f.expectedReferences).toBeUndefined();
    expect(f.expectedSnapshotId).toBe(financeV2Fixture('ready').expectedSnapshotId);
  });
});

describe('no browser arithmetic over the conformance data (source)', () => {
  it('does not parse, sum, round or compare money in the view or the guard', () => {
    for (const file of ['src/views/finance-v2/FinanceV2Views.tsx', 'src/views/finance-v2/check.ts']) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/parseFloat|parseInt|Number\(|BigInt|Decimal|\.reduce\(|toFixed|Math\.|Intl\.NumberFormat|toLocaleString/u);
    }
  });
});
