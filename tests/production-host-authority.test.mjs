import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { commerceContentHash } from '../tooling/commerce-evidence.mjs';
import { checkProductionHostRequest, checkProductionHostApproval, productionReferences } from '../tooling/production-operations.mjs';
import { readProduction, clone, calibration } from './production-seeds.mjs';
const request = await readProduction('ComposeArtifactRequest');
const receipt = JSON.parse(await readFile(new URL('../fixtures/ApprovalReceipt.json', import.meta.url), 'utf8')).valid;
const now = '2026-10-10T12:00:00Z';
const host = { scope: { tenant_id: receipt.tenant_id, project_id: receipt.project_id }, authority: { actor_id: receipt.actor_id, audience: receipt.audience }, policy_version: '1.0.0' };
const observation = { receipt, status: 'valid', checked_at: now };
test('valid independent host authority binds a returned approval observation', () => assert.equal(checkProductionHostApproval(observation, host, receipt.binding, now).ok, true));
for (const field of ['actor_id', 'audience']) {
  test('missing host ' + field + ' returns a typed failure', () => {
    const context = clone(host); delete context.authority[field];
    assert.equal(checkProductionHostApproval(observation, context, receipt.binding, now).errors[0].code, 'INVALID_TRUST_CONTEXT');
  });
  test('foreign host ' + field + ' rejects the same receipt', () => {
    const context = clone(host); context.authority[field] = field === 'actor_id' ? 'foreign_actor' : 'event-intelligence';
    assert.equal(checkProductionHostApproval(observation, context, receipt.binding, now).ok, false);
  });
  test('self-rehashed spoofed receipt ' + field + ' cannot change the host expectation', () => {
    const input = clone(observation); input.receipt[field] = field === 'actor_id' ? 'spoofed_actor' : 'event-intelligence';
    input.receipt.receipt_hash = commerceContentHash(input.receipt, 'receipt_hash');
    assert.equal(checkProductionHostApproval(input, host, receipt.binding, now).ok, false);
  });
}
for (const mode of ['missing-authority', 'missing-actor', 'bad-actor', 'bad-audience', 'missing-scope', 'request-forged-actor', 'request-forged-audience']) test(mode + ' rejects before host callbacks or reference access', () => {
  let calls = 0;
  const context = clone(host), input = clone(request);
  context.references = { resolve() { calls++; } }; context.authorization = { verify() { calls++; } };
  if (mode === 'missing-authority') delete context.authority;
  if (mode === 'missing-actor') delete context.authority.actor_id;
  if (mode === 'bad-actor') context.authority.actor_id = 'untrusted actor';
  if (mode === 'bad-audience') context.authority.audience = 'unregistered-audience';
  if (mode === 'missing-scope') delete context.scope;
  if (mode === 'request-forged-actor') input.actor_id = host.authority.actor_id;
  if (mode === 'request-forged-audience') input.audience = host.authority.audience;
  const references = new Proxy({}, { get() { calls++; return undefined; } });
  const result = checkProductionHostRequest('composeArtifact', input, context, references);
  if (result.ok) context.references.resolve();
  assert.equal(result.ok, false); assert.equal(calls, 0);
});
test('valid host and request cross the pure boundary without invoking any port', () => {
  const refs = Object.fromEntries(productionReferences(request));
  assert.equal(checkProductionHostRequest('composeArtifact', request, { ...host, scope: calibration.scope }, refs).ok, true);
});
