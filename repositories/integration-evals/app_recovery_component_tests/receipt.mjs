import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256 } from './custody.mjs';
import { validateObservations } from './observations.mjs';

export const expectedTests = [
  'host configuration and private authority records fail closed; credentials remain separate',
  'direct studio provider failures are explicit and never publish simulated success',
  'Finance-first barrier denies paid routes and direct admission without a runtime override; read state remains available',
  'recovery writers preserve concurrent observations and holds across request instances sharing SQLite',
  'real Finance SQL qualifies only existing command replay, current custody and pending intake holds; paid adoption stays blocked',
];
export const pgDiagnostic = '# Finance-first unavailable: zero Product admissions/provider writes; real SQL exact persisted dispatch replay ACK only';
export const pgUnavailable = { rows: 'unavailable', balances: 'unavailable', roles: 'unavailable', migrations: 'unavailable', server: 'unavailable', financial_postings: 'unavailable', role_cleanup: 'unavailable' };
export function parseTap(text) {
  assert.equal(typeof text, 'string');
  assert.ok(!/^\s*not ok\b|^(?:ok|not ok) .*#\s*(SKIP|TODO)\b|Bail out!/im.test(text), 'failed or skipped TAP');
  const cases = [...text.matchAll(/^ok (\d+) - (.+)$/gm)].map(match => ({ id: Number(match[1]), name: match[2] }));
  assert.deepEqual(cases, expectedTests.map((name, index) => ({ id: index + 1, name })));
  for (const [key, count] of Object.entries({ tests: 5, suites: 0, pass: 5, fail: 0, cancelled: 0, skipped: 0, todo: 0 })) {
    assert.deepEqual([...text.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))].map(match => Number(match[1])), [count]);
  }
  assert.deepEqual(text.match(/^1\.\.\d+$/gm), ['1..5']);
  assert.match(text, /# Finance-first unavailable: zero Product admissions\/provider writes; real SQL exact persisted dispatch replay ACK only/);
  return cases;
}
export function sanitizedTap(text) {
  return text.split('\n').map(line => line.startsWith(pgDiagnostic) ? pgDiagnostic : line).filter(line => line === pgDiagnostic || line === 'TAP version 13' || /^1\.\.\d+$/.test(line)
    || /^# (tests|suites|pass|fail|cancelled|skipped|todo|duration_ms) [\d.]+$/.test(line)
    || expectedTests.some(name => line === `# Subtest: ${name}` || new RegExp(`^(?:not )?ok \\d+ - `).test(line) && line.slice(line.indexOf(' - ') + 3) === name))
    .join('\n') + '\n';
}
export function validateReceipt(receipt, pin) {
  assert.equal(receipt.kind, 'app-recovery-component-development');
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.source, pin.revision); assert.equal(receipt.tree, pin.tree);
  assert.equal(receipt.mode, 'synthetic-owner-fixtures');
  assert.equal(receipt.paid_execution_enabled, false); assert.equal(receipt.adoption_accepted, false);
  assert.equal(receipt.platform, 'linux'); assert.equal(receipt.node, `v${pin.node}`);
  assert.equal(receipt.command.exitCode, 0); assert.equal(receipt.command.failure, null); assert.equal(receipt.command.groupAbsent, true);
  assert.deepEqual(receipt.tests, expectedTests.map((name, index) => ({ id: index + 1, name })));
  assert.deepEqual(receipt.postgres, { observation_basis: 'owner_assertion', independent: pgUnavailable });
  assert.equal(receipt.sqlite.validated, true); assert.equal(receipt.sqlite.artifact, 'sqlite-observations.json');
  assert.match(receipt.sqlite.sha256, /^[a-f0-9]{64}$/);
  assert.equal(receipt.cleanup.confirmed, true); assert.equal(receipt.cleanup.unknown.length, 0);
  assert.equal(receipt.cleanup.owned.length, 1); assert.equal(receipt.cleanup.private_removed, true);
}

export async function validateRecordedReceipt(output, pin) {
  const receipt = JSON.parse(await readFile(join(output, 'receipt.json'), 'utf8'));
  validateReceipt(receipt, pin);
  assert.deepEqual(parseTap(await readFile(join(output, 'owner.tap'), 'utf8')), receipt.tests);
  const sqlite = await readFile(join(output, receipt.sqlite.artifact));
  assert.equal(sha256(sqlite), receipt.sqlite.sha256);
  validateObservations(JSON.parse(sqlite));
  assert.deepEqual(JSON.parse(await readFile(join(output, 'cleanup.json'), 'utf8')), receipt.cleanup);
}
