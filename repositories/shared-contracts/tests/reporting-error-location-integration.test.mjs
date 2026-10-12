import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSchemas, evaluate, loadAjv2020, readSchemas } from '../proposals/reporting-v1/validate.mjs';

// Real strict Ajv and committed synthetic fixtures; missing pinned Ajv is a
// failure, never a skip or a fallback to the unit-test doubles.
const RUNNER = fileURLToPath(new URL('../proposals/reporting-v1/validate.mjs', import.meta.url));
const FIXTURES = new URL('../proposals/reporting-v1/fixtures.json', import.meta.url);
const CASE = 'query.neg.currency_lowercase';

function tampered() {
  const fx = JSON.parse(readFileSync(FIXTURES, 'utf8'));
  const index = fx.cases.findIndex((c) => c.id === CASE);
  assert.ok(index >= 0, 'the committed negative must exist');
  assert.equal(fx.cases[index].error_at, '/currency');
  fx.cases[index].error_at = '/currenc'; // not a JSON-pointer ancestor of /currency
  return { fx, ordinal: index + 1 };
}

test('real Ajv rejects a fixture expectation truncated inside a property name', () => {
  const { Ajv2020 } = loadAjv2020(process.env.SC_AJV_ROOT);
  const validators = compileSchemas(Ajv2020, readSchemas());
  const { fx, ordinal } = tampered();
  const result = evaluate(fx, validators);
  assert.equal(result.counts.cases, 199);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.passed, 198);
  assert.deepEqual(result.failures.map((f) => [f.ordinal, f.reason]), [[ordinal, 'error_location_mismatch']]);
});

test('CLI fails the same wrong-location fixture and preserves the real corpus positive control', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sc-error-location-'));
  try {
    const { fx, ordinal } = tampered();
    const file = join(dir, 'tampered.json');
    writeFileSync(file, JSON.stringify(fx));
    const env = { SC_AJV_ROOT: process.env.SC_AJV_ROOT };
    const run = spawnSync(process.execPath, [RUNNER, file], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(run.error, undefined);
    assert.equal(run.status, 1, run.stderr);
    assert.equal(run.stderr, '');
    const result = JSON.parse(run.stdout);
    assert.equal(result.failed, 1);
    assert.deepEqual(result.failures.map((f) => [f.ordinal, f.reason]), [[ordinal, 'error_location_mismatch']]);
    assert.ok(!run.stdout.includes(CASE));
    assert.ok(!run.stdout.includes(dir));
    const control = spawnSync(process.execPath, [RUNNER], { env, encoding: 'utf8', timeout: 60000 });
    assert.equal(control.error, undefined);
    assert.equal(control.status, 0, control.stderr);
    assert.equal(JSON.parse(control.stdout).passed, 199);
    assert.equal(JSON.parse(control.stdout).failed, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
