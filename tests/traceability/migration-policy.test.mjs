import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { FINANCE_CORE_MIGRATIONS, EXPECTED_MIGRATIONS } from '../migrations/migration-catalog.mjs';
import { hasDestructiveMigrationStatement, hasUnapprovedDestructiveMigrationStatement } from '../migrations/sql-safety.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const name = '0014_evidence_reader_indexes.sql';
const sql = await readFile(join(root, 'migrations', name), 'utf8');
const cleanup = "EXECUTE 'DROP POLICY ci10_expected_ledger_policy ON cost_intelligence.financial_ledger_events';";

test('migration catalog includes every checked-in feature while the Finance core stays separate', async () => {
  const names = (await readdir(join(root, 'migrations'))).filter(file => file.endsWith('.sql')).sort();
  assert.deepEqual(names, EXPECTED_MIGRATIONS);
  assert.equal(FINANCE_CORE_MIGRATIONS.length, 10);
  assert.ok(EXPECTED_MIGRATIONS.includes(name));
  assert.equal(FINANCE_CORE_MIGRATIONS.includes(name), false);
});

test('all exact reviewed migrations pass the conservative safety scan before database startup', async () => {
  for (const file of EXPECTED_MIGRATIONS) {
    const source = await readFile(join(root, 'migrations', file), 'utf8');
    const replacements = file === '0009_usage_intake.sql'
      ? [{ schema: 'cost_intelligence', table: 'financial_projection_quantities', constraint: 'financial_projection_quantities_key' }]
      : [];
    assert.equal(hasUnapprovedDestructiveMigrationStatement(file, source, replacements), false, file);
  }
});

test('only the exact reviewed temporary cleanup receives an exception to the unchanged generic guard', () => {
  assert.equal(hasDestructiveMigrationStatement(sql), true, 'the generic DROP guard remains conservative');
  assert.equal(hasUnapprovedDestructiveMigrationStatement(name, sql), false);
  assert.equal(hasUnapprovedDestructiveMigrationStatement('unreviewed.sql', sql), true);
  assert.equal(hasUnapprovedDestructiveMigrationStatement(name, sql + '\n'), true, 'a changed whole-file fingerprint is not approved');
});

const mutations = [
  ['renamed policy', source => source.replaceAll('ci10_expected_ledger_policy', 'existing_live_policy')],
  ['different protected table', source => source.replaceAll('cost_intelligence.financial_ledger_events', 'cost_intelligence.financial_source_revision_heads')],
  ['missing paired CREATE', source => source.replace(/  EXECUTE \$policy\$CREATE POLICY ci10_expected_ledger_policy[\s\S]+?\$policy\$;/, '')],
  ['cleanup moved outside its transaction block', source => source.replace(cleanup, '').replace('END $core_policies$;', `END $core_policies$;\n${cleanup}`)],
  ['appended live policy removal', source => source + "\nDROP POLICY financial_ledger_events_scope_policy ON cost_intelligence.financial_ledger_events;\n"],
  ['appended table removal', source => source + '\nDROP TABLE cost_intelligence.financial_ledger_events;\n'],
  ['appended dynamic truncate', source => source + "\nDO $$ BEGIN EXECUTE 'TRUNCATE cost_intelligence.financial_ledger_events'; END $$;\n"],
];
for (const [label, mutate] of mutations) {
  test(`temporary cleanup allowance refuses ${label}`, () => {
    const changed = mutate(sql);
    assert.notEqual(changed, sql, 'the adversarial control must actually mutate the reviewed source');
    assert.equal(hasUnapprovedDestructiveMigrationStatement(name, changed), true);
  });
}

test('unrelated destructive SQL remains refused and append-only trigger declarations remain allowed', () => {
  for (const source of [
    'DROP TABLE cost_intelligence.financial_ledger_events;',
    "DO $$ BEGIN EXECUTE 'DROP POLICY other_policy ON cost_intelligence.financial_ledger_events'; END $$;",
    'TRUNCATE cost_intelligence.financial_ledger_events;',
  ]) assert.equal(hasUnapprovedDestructiveMigrationStatement(name, source), true);
  assert.equal(hasUnapprovedDestructiveMigrationStatement('other.sql',
    'CREATE TRIGGER guard BEFORE TRUNCATE ON schema.table FOR EACH STATEMENT EXECUTE FUNCTION guard_fn();'), false);
});
