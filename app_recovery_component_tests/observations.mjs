import assert from 'node:assert/strict';
import { lstat, realpath, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { digest } from './custody.mjs';

const hashOptional = value => value === undefined ? null : digest(value);
const safeLabel = value => { assert.match(value, /^[a-z_]{1,100}$/); return value; };
export function projectRow(row) {
  const observations = row.observations ?? [];
  assert.ok(Array.isArray(observations) && observations.length <= 100);
  if (row.dispatch_ack) assert.ok(Number.isSafeInteger(row.dispatch_ack.owner_revision) && row.dispatch_ack.owner_revision >= 0);
  if (row.intake_receipt) assert.equal(typeof row.intake_receipt.durableCommit, 'boolean');
  const ids = observations.map(item => { assert.equal(typeof item.source_observation_id, 'string'); return digest(item.source_observation_id); });
  return {
    attempt_sha256: digest(row.attempt.billable_attempt_id), state: safeLabel(row.state),
    observation_count: observations.length, unique_observation_count: new Set(ids).size,
    observation_ids_sha256: ids, observation_sha256: observations.map(digest),
    first_observation_sha256: hashOptional(row.observation),
    usage_request_sha256: hashOptional(row.usage_request), dispatch_command_sha256: hashOptional(row.dispatch_command),
    intake_receipt_sha256: hashOptional(row.intake_receipt),
    recovery_reason: row.recovery_reason ? safeLabel(row.recovery_reason) : null,
    recovery_reasons: (row.recovery_reasons ?? []).map(safeLabel),
    dispatch_ack: row.dispatch_ack ? { status: safeLabel(row.dispatch_ack.status), owner_revision: row.dispatch_ack.owner_revision } : null,
    intake: row.intake_receipt ? { status: safeLabel(row.intake_receipt.status), outbox_status: safeLabel(row.intake_receipt.outboxStatus), durable_commit: row.intake_receipt.durableCommit } : null,
  };
}
export function validateObservations(result) {
  assert.equal(result.observation_basis, 'direct_post_exit_sqlite');
  assert.equal(result.concurrent.length, 1);
  const concurrent = result.concurrent[0];
  assert.equal(concurrent.observation_count, 4); assert.equal(concurrent.unique_observation_count, 4);
  assert.equal(concurrent.first_observation_sha256, concurrent.observation_sha256[0]);
  assert.equal(concurrent.state, 'held_for_reconciliation');
  assert.equal(concurrent.usage_request_sha256, digest({ fixture: 'opaque original request bytes' }));
  for (const reason of ['original_unknown', 'finance_lifecycle_unavailable', 'concurrent_unknown', 'public_settlement_unavailable', 'public_release_unavailable']) assert.ok(concurrent.recovery_reasons.includes(reason));
  assert.equal(result.recovery.length, 6);
  const retry = result.recovery.filter(row => row.intake?.outbox_status === 'retry');
  const pending = result.recovery.filter(row => row.intake?.outbox_status === 'pending');
  assert.equal(retry.length, 1); assert.equal(pending.length, 1);
  assert.equal(retry[0].observation_count, 2); assert.equal(retry[0].unique_observation_count, 2);
  assert.deepEqual(retry[0].dispatch_ack, { status: 'replay', owner_revision: 2 });
  assert.ok(retry[0].recovery_reasons.includes('concurrent_owner_replay_unknown'));
  for (const row of [...retry, ...pending]) {
    assert.equal(row.state, 'held_for_reconciliation'); assert.equal(row.intake.durable_commit, true);
    for (const field of ['usage_request_sha256', 'dispatch_command_sha256', 'intake_receipt_sha256']) assert.match(row[field], /^[a-f0-9]{64}$/);
  }
  assert.equal(pending[0].recovery_reason, 'usage_outbox_pending');
}
export async function collectObservations(tmp) {
  const { DatabaseSync } = await import('node:sqlite');
  const dirs = (await readdir(tmp)).filter(name => /^ticketstub-creative-host-[A-Za-z0-9]+$/.test(name));
  assert.equal(dirs.length, 1, 'one private owner fixture directory required');
  const root = join(tmp, dirs[0]);
  assert.equal((await lstat(root)).isDirectory(), true); assert.equal(await realpath(root), root);
  const result = { observation_basis: 'direct_post_exit_sqlite', byte_preservation_basis: 'owner_assertion_except_known_concurrent_request', concurrent: [], recovery: [] };
  for (const [key, file] of [['concurrent', 'concurrent-recovery.sqlite'], ['recovery', 'recovery.sqlite']]) {
    const path = join(root, file); const stat = await lstat(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 16 * 1024 * 1024);
    assert.equal(await realpath(path), path);
    for (const suffix of ['-wal', '-shm', '-journal']) {
      const sidecar = `${path}${suffix}`;
      try {
        const entry = await lstat(sidecar);
        assert.ok(entry.isFile() && !entry.isSymbolicLink() && entry.size <= 16 * 1024 * 1024);
        assert.equal(await realpath(sidecar), sidecar);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF;');
      assert.equal(db.prepare("SELECT type FROM sqlite_schema WHERE name='ticketstub_creative_attempts'").get()?.type, 'table');
      const rows = db.prepare('SELECT state FROM ticketstub_creative_attempts LIMIT 101').all();
      assert.ok(rows.length <= 100);
      result[key] = rows.map(({ state }) => { assert.ok(state.length <= 1024 * 1024); return projectRow(JSON.parse(state)); });
    } finally { db.close(); }
  }
  validateObservations(result);
  return result;
}
