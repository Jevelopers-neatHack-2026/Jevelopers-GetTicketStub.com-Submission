import assert from 'node:assert/strict';

export const expectedFiles = ['admission.test.mjs', 'intake.test.mjs', 'recovery.test.mjs'];
export const expectedCases = ['admission', 'lifecycle-unavailable', 'unknown-intake', 'scope-isolation', 'covered-intake', 'recovery'];

export function validateReceipt(receipt, pin) {
  assert.equal(receipt.kind, 'synthetic-issuer-component-development');
  assert.equal(receipt.source, pin.revision);
  assert.equal(receipt.platform, 'linux');
  assert.equal(receipt.node, `v${pin.node}`);
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.container.image, pin.postgres);
  assert.match(receipt.container.id, /^[a-f0-9]{64}$/);
  assert.equal(receipt.container.started, true);
  assert.equal(receipt.container.removed, true);
  assert.equal(receipt.container.cleanupConfirmed, true);
  assert.equal(receipt.database.markerValidated, true);
  assert.equal(receipt.database.rolesCleaned, true);
  assert.match(receipt.database.server, /^16\./);
  assert.deepEqual(receipt.database.migrations, pin.migrations.map(row => ({ ...row, applied: true })));
  assert.deepEqual(receipt.database.installedMigrations, pin.migrations.map(row => ({ version: row.name.replace(/\.sql$/, ''), checksum_sha256: row.sha256 })));
  assert.deepEqual(receipt.database.roles.map(role => role.kind), ['runtime', 'migrator']);
  for (const role of receipt.database.roles) {
    for (const flag of ['rolsuper', 'rolcreatedb', 'rolcreaterole', 'rolreplication', 'rolbypassrls']) assert.equal(role[flag], false);
    assert.equal(role.rolcanlogin, true);
    assert.equal(role.member, true);
    assert.equal(role.current_user, role.rolname);
    assert.equal(role.session_user, role.rolname);
    assert.equal(role.non_owner, true);
    assert.equal(role.group, `ci_finance_${role.kind}`);
  }
  assert.deepEqual(receipt.tests.map(test => test.file), expectedFiles);
  let count = 0;
  for (const test of receipt.tests) {
    assert.equal(test.result.passed, true);
    assert.equal(test.result.exitCode, 0);
    assert.ok(test.result.registeredTestCaseCount > 0);
    assert.equal(test.result.completedTestCaseCount, test.result.registeredTestCaseCount);
    assert.equal(test.result.passedTestCaseCount, test.result.registeredTestCaseCount);
    for (const field of ['failedTestCaseCount', 'skippedTestCaseCount', 'todoTestCaseCount']) assert.equal(test.result[field], 0);
    assert.equal(test.result.fileSummary.success, true);
    for (const field of ['failed', 'skipped', 'todo', 'cancelled']) assert.equal(test.result.fileSummary.counts[field], 0);
    assert.equal(test.result.fileSummary.counts.tests, test.result.registeredTestCaseCount);
    assert.equal(test.result.fileSummary.counts.passed, test.result.registeredTestCaseCount);
    count += test.result.passedTestCaseCount;
  }
  assert.equal(count, 5);
  assert.deepEqual(receipt.cases, expectedCases);
  assert.equal(receipt.adoptionAccepted, false);
}
