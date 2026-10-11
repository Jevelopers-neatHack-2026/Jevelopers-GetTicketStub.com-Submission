import assert from 'node:assert/strict';
import { validateContract, checkOperation, compareUsageIdentity, bindDecisionPort, adaptScoreProfile } from '@jevelopers/shared-contracts';
import { checkDecisionRequest } from '@jevelopers/shared-contracts/operations';
import usage from '@jevelopers/shared-contracts/fixtures/UsageEvent.json' with { type: 'json' };
import request from '@jevelopers/shared-contracts/fixtures/DecisionPortRequest.json' with { type: 'json' };
import result from '@jevelopers/shared-contracts/fixtures/DecisionPortResult.json' with { type: 'json' };
import receipt from '@jevelopers/shared-contracts/fixtures/DecisionReceipt.json' with { type: 'json' };
import release from '@jevelopers/shared-contracts/fixtures/ReleaseRequest.2_0_0.json' with { type: 'json' };

// Synthetic server expectations are independent of the caller input. Production injects
// authenticated scope, current finance state, policy and reference lookups from its adapters.
const serverScope = { tenant_id: '123e4567-e89b-42d3-a456-426614174000', project_id: '123e4567-e89b-42d3-a456-426614174000' };
const serverContext = structuredClone(result.cases.find(entry => entry.id === 'semantic-positive').context);
serverContext.scope = serverScope;
const accepted = checkDecisionRequest(request.valid, serverContext);
assert.equal(accepted.ok, true);
const forged = checkDecisionRequest({ ...request.valid, tenant_id: '123e4567-e89b-42d3-a456-426614174099' }, serverContext);
assert.deepEqual(forged, { ok: false, errors: [{ code: 'SCOPE_MISMATCH', path: '/tenant_id' }] });

let calls = 0;
const port = bindDecisionPort(async () => { calls++; return result.valid; });
assert.equal((await port.decide(request.valid, serverContext)).ok, true);
assert.equal((await port.decide({ ...request.valid, tenant_id: '123e4567-e89b-42d3-a456-426614174099' }, serverContext)).ok, false);
assert.equal(calls, 1);

const usageContext = structuredClone(usage.cases.find(entry => entry.id === 'semantic-positive').context);
usageContext.scope = serverScope;
assert.equal(checkOperation('UsageEvent', { ...usage.valid, outcome: 'timeout' }, usageContext).ok, true);
assert.deepEqual(compareUsageIdentity(usage.valid, { ...usage.valid, transport_attempt_id: '123e4567-e89b-42d3-a456-426614174098' }), { ok: true, value: 'duplicate_observation' });
const separate = { ...usage.valid, billable_attempt_id: '123e4567-e89b-42d3-a456-426614174097', source_observation_id: '123e4567-e89b-42d3-a456-426614174096', usage_event_id: '123e4567-e89b-42d3-a456-426614174095', provider_attempt_id: '123e4567-e89b-42d3-a456-426614174094' };
assert.deepEqual(compareUsageIdentity(usage.valid, separate), { ok: true, value: 'distinct_billable_attempt' });

const receiptContext = structuredClone(receipt.cases.find(entry => entry.id === 'semantic-positive').context);
receiptContext.scope = serverScope;
assert.equal(checkOperation('DecisionReceipt', receipt.valid, receiptContext).ok, true);
assert.equal(checkOperation('DecisionReceipt', { ...receipt.valid, request_hash: 'sha256:' + '1'.repeat(64) }, receiptContext).ok, false);
const unresolved = release.cases.find(entry => entry.id === 'unsafe-transition-unknown');
assert.deepEqual(checkOperation('ReleaseRequest', { ...release.valid, ...unresolved.set }, { ...unresolved.context, scope: serverScope }), { ok: false, errors: [{ code: 'UNCERTAIN_EXECUTION', path: '/reason' }] });

const adapted = adaptScoreProfile(request.valid.questions.score_1, 'ei-string-v1');
assert.equal(adapted.ok, true);
if (!adapted.ok) throw new Error('Adapter did not parse');
const roundTrip = adaptScoreProfile(adapted.value.target, 'structured-index-v1');
assert.equal(roundTrip.ok, true);
if (!roundTrip.ok) throw new Error('Adapter did not round trip');
assert.deepEqual(roundTrip.value.target, request.valid.questions.score_1);
assert.equal(roundTrip.value.accepted_migration, false);
assert.equal(validateContract('DecisionPortResult', result.valid).ok, true);
console.log(JSON.stringify({ status: 'passed', node: process.version, dependency_mode: 'offline_installed_operations', provider_calls: 0, cases: ['scoped_decision', 'forged_scope', 'injected_port', 'known_usage_timeout', 'billing_identity', 'receipt_hash_binding', 'uncertain_release', 'explicit_profile_adapter'] }));
