import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createScenario, observation, owner, policy, unpriced, value } from './fixture.mjs';

test('durable unknown intake blocks uncovered admission and isolates scope', async () => {
  const s = await createScenario('unknown-intake');
  const foreign = await createScenario('scope-isolation');
  try {
    const policyRef = await policy(s);
    const request = unpriced(await observation(s.scope));
    const accepted = value(await s.call('ingestUsage', request));
    assert.equal(accepted.status, 'accepted');
    assert.equal(accepted.durableCommit, true);
    assert.equal(accepted.outboxStatus, 'awaiting_evidence');
    assert.equal(value(await s.call('ingestUsage', request)).status, 'duplicate');
    const denied = value(await s.call('authorize', owner.reservationRequest(s.scope, s.fixture, { policyRef })));
    assert.equal(denied.status, 'unavailable');
    assert.equal(denied.finance, undefined);
    assert.deepEqual(await s.rows(), { holds: 0, held: '0', inbox: 1, outbox: 1, ledger: 0, amount: '0' });
    const foreignPolicy = await policy(foreign);
    const other = owner.reservationRequest(foreign.scope, foreign.fixture, { policyRef: foreignPolicy,
      logicalOperationId: request.usageEvent.logical_operation_id, billableAttemptId: request.usageEvent.billable_attempt_id });
    other.attemptBinding.providerAttemptId = request.usageEvent.provider_attempt_id;
    other.attemptBinding.transportAttemptId = request.usageEvent.transport_attempt_id;
    assert.equal(value(await foreign.call('authorize', other)).status, 'authorized');
    assert.deepEqual(await foreign.rows(), { holds: 1, held: '0.75', inbox: 0, outbox: 0, ledger: 0, amount: '0' });
    assert.equal(value(await s.call('authorize', owner.reservationRequest(s.scope, s.fixture, { policyRef }))).status, 'unavailable');
    assert.deepEqual(await s.rows(), { holds: 0, held: '0', inbox: 1, outbox: 1, ledger: 0, amount: '0' });
  } catch (error) { s.failure(error); throw error; } finally { await s.close(); await foreign.close(); }
});

test('exact matching hold covers unknown exposure once', async () => {
  const s = await createScenario('covered-intake');
  try {
    const policyRef = await policy(s);
    const request = owner.reservationRequest(s.scope, s.fixture, { policyRef });
    request.attemptBinding.providerAttemptId = randomUUID();
    request.attemptBinding.transportAttemptId = randomUUID();
    const grant = value(await s.call('authorize', request));
    assert.equal(grant.status, 'authorized');
    const intake = unpriced(await observation(s.scope, request.attemptBinding));
    const accepted = value(await s.call('ingestUsage', intake));
    assert.equal(accepted.outboxStatus, 'awaiting_evidence');
    assert.equal(accepted.durableCommit, true);
    assert.equal(value(await s.call('ingestUsage', intake)).status, 'duplicate');
    const replay = value(await s.call('authorize', request));
    assert.equal(replay.reservationId, grant.reservationId);
    assert.equal(replay.historicalReplay, true);
    assert.equal(replay.finance, undefined);
    assert.deepEqual(await s.rows(), { holds: 1, held: '0.75', inbox: 1, outbox: 1, ledger: 0, amount: '0' });
    const next = value(await s.call('authorize', owner.reservationRequest(s.scope, s.fixture, { policyRef, amount: '0.25' })));
    assert.equal(next.status, 'authorized');
    assert.equal(next.availableAmount, '0');
    assert.deepEqual(await s.rows(), { holds: 2, held: '1', inbox: 1, outbox: 1, ledger: 0, amount: '0' });
  } catch (error) { s.failure(error); throw error; } finally { await s.close(); }
});
