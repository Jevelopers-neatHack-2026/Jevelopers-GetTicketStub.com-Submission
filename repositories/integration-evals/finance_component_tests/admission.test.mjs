import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createScenario, current, owner, policy, publicPorts, value } from './fixture.mjs';

test('public admission keeps one exact hold and rejects stale authority', async () => {
  // Given: a public policy and owner synthetic issuers over restricted PostgreSQL.
  const s = await createScenario('admission');
  try {
    const policyRef = await policy(s);
    const request = owner.reservationRequest(s.scope, s.fixture, { policyRef });
    // When: admit 0.75, inspect, revalidate, replay, and revoke the same authority.
    const grant = value(await s.call('authorize', request));
    assert.equal(grant.status, 'authorized');
    assert.equal(grant.heldAmount, '0.75');
    assert.equal(grant.finance.held_amount.amount, '0.75');
    assert.equal(grant.finance.authorized_cap.amount, '0.75');
    assert.equal(grant.finance.held_amount.currency, 'USD');
    assert.equal(grant.finance.authorized_cap.currency, 'USD');
    assert.equal(grant.finance.tenant_id, s.scope.tenantId);
    assert.equal(grant.finance.project_id, s.scope.projectId);
    assert.equal(grant.finance.grant_ref, request.authorityBinding.grantRef);
    assert.equal(grant.finance.lease_ref, request.authorityBinding.leaseRef);
    assert.equal(grant.finance.billable_attempt_id, request.attemptBinding.billableAttemptId);
    assert.equal(grant.finance.target_binding_sha256, request.authorityBinding.targetBindingSha256);
    assert.equal(grant.finance.budget_scope_id, request.canonicalRequest.budget_scope_id);
    const snapshot = value(await s.call('getReservationSnapshot', {
      schemaVersion: '1.0.0', requestId: randomUUID(), scope: s.scope, reservationId: grant.reservationId,
    }));
    assert.equal(snapshot.dispatchEligible, false);
    assert.equal(snapshot.finance, undefined);
    const query = current(s.scope, request, grant.reservationId);
    const refreshed = value(await s.call('revalidateAuthorization', query));
    assert.equal(refreshed.status, 'authorized');
    assert.equal(refreshed.finance.held_amount.amount, '0.75');
    const replay = value(await s.call('authorize', request));
    assert.equal(replay.historicalReplay, true);
    assert.equal(replay.reservationId, grant.reservationId);
    assert.equal(replay.finance, undefined);
    const changed = value(await s.call('revalidateAuthorization', {
      ...query, authorityBinding: { ...query.authorityBinding, targetBindingSha256: `sha256:${'c'.repeat(64)}` },
    }));
    assert.equal(changed.status, 'denied');
    assert.equal(changed.finance, undefined);
    const revoked = publicPorts(s.pool, s.scope, { reservationAuthority: { verifyCurrent: async () => null } });
    const denied = value(await s.call('revalidateAuthorization', query, revoked));
    assert.equal(denied.status, 'denied');
    assert.equal(denied.finance, undefined);
    // Then: independent SQL sees exactly one retained hold and no monetary effect.
    assert.deepEqual(await s.rows(), { holds: 1, held: '0.75', inbox: 0, outbox: 0, ledger: 0, amount: '0' });
  } catch (error) { s.failure(error); throw error; } finally { await s.close(); }
});

test('public settlement and release remain explicitly unavailable', async () => {
  const s = await createScenario('lifecycle-unavailable');
  try {
    const policyRef = await policy(s);
    const request = owner.reservationRequest(s.scope, s.fixture, { policyRef });
    const grant = value(await s.call('authorize', request));
    const commands = [
      ['settle', owner.settleCommand(s.scope, grant.reservationId, 1, { cumulativeAmount: '0.25', attemptBinding: request.attemptBinding })],
      ['release', owner.releaseCommand(s.scope, grant.reservationId, 1, { amount: '0.75', attemptBinding: request.attemptBinding })],
    ];
    for (const [operation, command] of commands) {
      const result = await s.call(operation, command);
      assert.equal(result.ok, false);
      assert.equal(result.error.code, 'BUDGET_UNAVAILABLE');
    }
    assert.deepEqual(await s.rows(), { holds: 1, held: '0.75', inbox: 0, outbox: 0, ledger: 0, amount: '0' });
  } catch (error) { s.failure(error); throw error; } finally { await s.close(); }
});
