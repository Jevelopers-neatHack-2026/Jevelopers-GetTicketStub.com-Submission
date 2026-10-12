import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createScenario, observation, value } from './fixture.mjs';

test('public replay drains one actual durable retry after controlled ledger fault', async () => {
  const s = await createScenario('recovery');
  try {
    // Owner recovery.test.mjs:635 protocol: one fault at the real database port.
    let injectOnce = true;
    const faultPorts = { ...s.ports, database: { connect: async () => {
      const client = await s.pool.connect();
      return {
        query: async (sql, values) => {
          if (injectOnce && /^INSERT INTO cost_intelligence\.financial_ledger_events/i.test(sql)) {
            injectOnce = false;
            throw new Error('evaluation synthetic pre-insert fault');
          }
          return client.query(sql, values);
        },
        release: () => client.release(),
      };
    } } };
    const request = await observation(s.scope);
    const accepted = value(await s.call('ingestUsage', request, faultPorts));
    s.record('owner fixture controlled pre-insert fault', { injected: !injectOnce });
    assert.equal(injectOnce, false);
    assert.equal(accepted.durableCommit, true);
    assert.equal(accepted.outboxStatus, 'retry');
    assert.deepEqual(await s.rows(), { holds: 0, held: '0', inbox: 1, outbox: 1, ledger: 0, amount: '0' });
    const retryRows = await s.pool.query('SELECT status,retry_count,last_error_code FROM cost_intelligence.usage_intake_outbox WHERE tenant_id=$1', [s.scope.tenantId]);
    s.record('observer durable retry state', retryRows.rows);
    assert.deepEqual(retryRows.rows, [{ status: 'retry', retry_count: 1, last_error_code: 'source_unavailable' }]);
    // Owner-controlled fixture adjustment only; all posting is through public replay.
    const adjustment = await s.pool.query(`UPDATE cost_intelligence.usage_intake_outbox SET available_at=$3::timestamptz-interval '1 second'
      WHERE tenant_id=$1 AND project_id=$2`, [s.scope.tenantId, s.scope.projectId, '2026-10-12T04:00:00Z']);
    s.record('owner fixture available_at adjustment', { rows: adjustment.rowCount, clock: '2026-10-12T04:00:00Z' });
    assert.equal(adjustment.rowCount, 1);
    const command = { schemaVersion: '1.0.0', requestId: randomUUID(), scope: s.scope, limit: 10 };
    const replay = value(await s.call('replayUsageOutbox', command));
    assert.equal(replay.scanned, 1);
    assert.equal(replay.posted, 1);
    assert.equal(replay.retried, 0);
    assert.equal(replay.deadLettered, 0);
    assert.equal(replay.durableCommit, true);
    assert.deepEqual(await s.rows(), { holds: 0, held: '0', inbox: 1, outbox: 1, ledger: 1, amount: '0.000003' });
    const postedRows = await s.pool.query('SELECT status FROM cost_intelligence.usage_intake_outbox WHERE tenant_id=$1', [s.scope.tenantId]);
    s.record('observer posted outbox state', postedRows.rows);
    assert.deepEqual(postedRows.rows, [{ status: 'posted' }]);
    const again = value(await s.call('replayUsageOutbox', { ...command, requestId: randomUUID() }));
    assert.equal(again.scanned, 0);
    assert.equal(again.posted, 0);
    const money = await s.pool.query('SELECT trim_scale(amount)::text AS amount,currency FROM cost_intelligence.financial_ledger_events WHERE tenant_id=$1', [s.scope.tenantId]);
    s.record('observer exact amount and currency', money.rows);
    assert.deepEqual(money.rows, [{ amount: '0.000003', currency: 'USD' }]);
    assert.deepEqual(await s.rows(), { holds: 0, held: '0', inbox: 1, outbox: 1, ledger: 1, amount: '0.000003' });
  } catch (error) { s.failure(error); throw error; } finally { await s.close(); }
});
