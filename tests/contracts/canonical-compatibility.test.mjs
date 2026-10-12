import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateContract } from '@jevelopers/shared-contracts';
import * as direct from '../../dist/shared/canonical.js';
import * as publicContracts from '../../dist/shared/index.js';

const names = ['UsageEvent', 'BudgetReservation', 'ReserveRequest', 'ReserveResult', 'SettleRequest', 'SettleResult', 'ReleaseRequest', 'ReleaseResult', 'QueryRequest', 'QueryResult', 'FinancialSummary', 'ErrorEnvelope'];
const args = (contract, value) => ({ contract, value, module: 'compatibility', operation: 'legacy', requestId: 'PRIVATE_REQUEST_CANARY' });
const fixture = async contract => JSON.parse(await readFile(new URL(`../../node_modules/@jevelopers/shared-contracts/fixtures/${contract}.json`, import.meta.url), 'utf8'));
function refusal(result, code) {
  assert.equal(result.ok, false);
  const { diagnostic_ref, ...stable } = result.error;
  assert.deepEqual(stable, { schemaVersion: '1.0.0', module: 'compatibility', operation: 'legacy', code, retryable: false,
    safe_message: code === 'UNSUPPORTED_VERSION' ? 'The shared contract version is not supported.' : 'The shared contract payload does not match its pinned schema.' });
  assert.match(diagnostic_ref, /^ci1:[0-9a-f-]{36}$/);
  assert.ok(!JSON.stringify(result).includes('PRIVATE_REQUEST_CANARY'));
}

test('public contracts barrel shares the immutable twelve-alias legacy election', () => {
  assert.equal(publicContracts.validateCanonical, direct.validateCanonical);
  assert.equal(publicContracts.LEGACY_CANONICAL_VERSIONS, direct.LEGACY_CANONICAL_VERSIONS);
  assert.deepEqual(Object.keys(direct.LEGACY_CANONICAL_VERSIONS), names);
  assert.ok(Object.isFrozen(direct.LEGACY_CANONICAL_VERSIONS));
  for (const name of names) assert.equal(direct.LEGACY_CANONICAL_VERSIONS[name], '1.0.0');
  assert.throws(() => { direct.LEGACY_CANONICAL_VERSIONS.ReserveRequest = '2.0.0'; }, TypeError);
});

test('all unchanged original structural fixture oracles retain exact legacy translations', async () => {
  let count = 0;
  for (const name of names) {
    const f = await fixture(name);
    const positive = publicContracts.validateCanonical(args(name, f.valid));
    assert.equal(positive.ok, true, name);
    assert.equal(positive.value, f.valid, `${name}: preserve original value identity`);
    for (const c of f.cases) {
      if (c.mode && c.mode !== 'structural') continue;
      const value = structuredClone(f.valid);
      for (const key of c.remove ?? []) delete value[key];
      Object.assign(value, c.set ?? {});
      const result = publicContracts.validateCanonical(args(name, value));
      assert.equal(result.ok, c.expected.ok, `${name}/${c.id}`);
      if (!result.ok) refusal(result, c.expected.code === 'UNSUPPORTED_VERSION' ? 'UNSUPPORTED_VERSION' : 'VALIDATION_ERROR');
      count++;
    }
  }
  assert.equal(count, 100, 'unchanged baseline structural case count');
});

for (const name of names) test(`${name}: foreign well-formed version is unsupported before schema dispatch`, async () => {
  const f = await fixture(name);
  for (const version of ['2.0.0', '1.0.1', '99.0.0', '']) {
    refusal(publicContracts.validateCanonical(args(name, { ...f.valid, schema_version: version })), 'UNSUPPORTED_VERSION');
    refusal(publicContracts.validateCanonical(args(name, { schema_version: version })), 'UNSUPPORTED_VERSION');
  }
});

test('JSON safety and malformed version errors retain precedence without invoking getters', async () => {
  const f = await fixture('ReserveRequest');
  for (const value of [null, [], {}, { schema_version: null }, { schema_version: 2 }, { ...f.valid, schema_version: '2.0.0', extra: undefined },
    { ...f.valid, schema_version: '2.0.0', extra: '\ud800' }, { ...f.valid, schema_version: '2.0.0', extra: NaN },
    Object.assign(Object.create({}), f.valid, { schema_version: '2.0.0' })]) {
    refusal(publicContracts.validateCanonical(args('ReserveRequest', value)), 'VALIDATION_ERROR');
  }
  const cyclic = { ...f.valid, schema_version: '2.0.0' }; cyclic.extra = cyclic;
  refusal(publicContracts.validateCanonical(args('ReserveRequest', cyclic)), 'VALIDATION_ERROR');
  const symbol = { ...f.valid, schema_version: '2.0.0', [Symbol('private')]: 'hidden' };
  refusal(publicContracts.validateCanonical(args('ReserveRequest', symbol)), 'VALIDATION_ERROR');
  let reads = 0;
  const accessor = { ...f.valid }; Object.defineProperty(accessor, 'schema_version', { enumerable: true, get() { reads++; return '2.0.0'; } });
  refusal(publicContracts.validateCanonical(args('ReserveRequest', accessor)), 'VALIDATION_ERROR');
  assert.equal(reads, 0);
  const original = new Error('original-proxy-exception');
  const throwing = new Proxy({}, { getPrototypeOf() { throw original; } });
  assert.throws(() => publicContracts.validateCanonical(args('ReserveRequest', throwing)), error => error === original);
});

test('unmapped SDK names and unknown contracts retain original dispatch', async () => {
  const f = await fixture('Cancellation');
  const expected = validateContract('Cancellation', f.valid);
  const actual = publicContracts.validateCanonical(args('Cancellation', f.valid));
  assert.equal(expected.ok, true); assert.equal(actual.ok, true); assert.equal(actual.value, f.valid);
  refusal(publicContracts.validateCanonical(args('not-a-contract', { schema_version: '2.0.0' })), 'VALIDATION_ERROR');
});

test('public declarations preserve legacy return types and separate native Finance2 types', async () => {
  const directory = new URL('../../artifacts/canonical-compatibility-types/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const consumer = new URL('consumer.mts', directory);
  const aliasNames = ['UsageEvent','BudgetReservation','ReserveRequest','ReserveResult','SettleRequest','SettleResult','ReleaseRequest','ReleaseResult','QueryRequest','QueryResult','FinancialSummary','ErrorEnvelope'];
  const checks = aliasNames.map(name => `type ${name}Same = Assert<Equal<api.Shared${name}, ContractMap['${name}']>>;\ntype ${name}Version = Assert<Equal<api.Shared${name}['schema_version'], '1.0.0'>>;`).join('\n');
  await writeFile(consumer, `import * as api from '../../dist/shared/index.js';\nimport type { ContractMap } from '@jevelopers/shared-contracts';\nimport type { FinancialSummaryPageV2 } from '../../dist/reporting/index.js';\ntype Assert<T extends true> = T;\ntype Equal<A,B> = (<T>()=>T extends A?1:2) extends (<T>()=>T extends B?1:2) ? true : false;\n${checks}\ndeclare const result: ReturnType<typeof api.validateCanonical<'ReserveRequest'>>;\nif(result.ok){ const legacy: ContractMap['ReserveRequest'] = result.value; const version: '1.0.0' = result.value.schema_version; }\n// @ts-expect-error legacy election cannot widen to version 2\nconst foreign: api.SharedReserveRequest['schema_version'] = '2.0.0';\ntype NativeVersion = Assert<Equal<FinancialSummaryPageV2['schemaVersion'],'2.0.0'>>;\n`);
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('../../node_modules/typescript/bin/tsc', import.meta.url)), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', fileURLToPath(consumer)], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
