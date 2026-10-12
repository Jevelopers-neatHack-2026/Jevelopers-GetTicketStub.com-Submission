import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { expectedFiles, expectedCases, validateReceipt } from './receipt.mjs';
const pin = JSON.parse(await readFile(new URL('../contracts/finance-producer-pin.json', import.meta.url), 'utf8'));

// Explicit validator-unit input only; these are never written as PostgreSQL evidence.
function fixture() {
  return {
    kind: 'synthetic-issuer-component-development', source: pin.revision, platform: 'linux', node: `v${pin.node}`,
    status: 'passed', adoptionAccepted: false, cases: expectedCases,
    container: { image: pin.postgres, id: 'a'.repeat(64), started: true, removed: true, cleanupConfirmed: true },
    database: { markerValidated: true, rolesCleaned: true, server: '16.0',
      migrations: pin.migrations.map(row => ({ ...row, applied: true })),
      installedMigrations: pin.migrations.map(row => ({ version: row.name.replace(/\.sql$/, ''), checksum_sha256: row.sha256 })),
      roles: ['runtime', 'migrator'].map(kind => ({ kind, rolname: `fixture_${kind}`, current_user: `fixture_${kind}`, session_user: `fixture_${kind}`, non_owner: true, group: `ci_finance_${kind}`, rolcanlogin: true, member: true,
        rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false })) },
    tests: expectedFiles.map((file, index) => ({ file, result: { passed: true, exitCode: 0, registeredTestCaseCount: index === 2 ? 1 : 2,
      completedTestCaseCount: index === 2 ? 1 : 2, passedTestCaseCount: index === 2 ? 1 : 2,
      failedTestCaseCount: 0, skippedTestCaseCount: 0, todoTestCaseCount: 0, fileSummary: { success: true, counts: { tests: index === 2 ? 1 : 2, passed: index === 2 ? 1 : 2, failed: 0, skipped: 0, todo: 0, cancelled: 0 } } } })),
  };
}

test('receipt parser accepts a complete synthetic validator fixture', () => {
  assert.doesNotThrow(() => validateReceipt(fixture(), pin));
});

const mutations = {
  'unexecuted Darwin evidence': r => { r.platform = 'darwin'; },
  'source drift': r => { r.source = '0'.repeat(40); },
  'missing test file': r => { r.tests.pop(); },
  'empty case set': r => { r.cases = []; },
  'empty test suite': r => { r.tests[0].result.registeredTestCaseCount = 0; },
  'skipped test': r => { r.tests[0].result.skippedTestCaseCount = 1; },
  'failed test': r => { r.tests[0].result.failedTestCaseCount = 1; },
  'cancelled test': r => { r.tests[0].result.fileSummary.counts.cancelled = 1; },
  'uncertain cleanup': r => { r.container.cleanupConfirmed = false; },
  'retained container': r => { r.container.removed = false; },
  'retained roles': r => { r.database.rolesCleaned = false; },
  'wrong login': r => { r.database.roles[0].current_user = 'owner'; },
  'runtime owner': r => { r.database.roles[0].non_owner = false; },
  'privileged runtime': r => { r.database.roles[0].rolsuper = true; },
  'missing migration': r => { r.database.migrations.pop(); },
  'changed migration': r => { r.database.installedMigrations[0].checksum_sha256 = '0'.repeat(64); },
  'wrong PostgreSQL': r => { r.database.server = '17.0'; },
  'adoption promotion': r => { r.adoptionAccepted = true; },
};
for (const [name, mutate] of Object.entries(mutations)) test(`receipt parser rejects ${name}`, () => {
  const receipt = fixture();
  mutate(receipt);
  assert.throws(() => validateReceipt(receipt, pin));
});
