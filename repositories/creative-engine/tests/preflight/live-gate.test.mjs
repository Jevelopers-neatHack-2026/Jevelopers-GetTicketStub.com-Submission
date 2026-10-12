import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

test('live access gate emits explicit blocked cells and exits before dispatch', () => {
  const result = spawnSync(process.execPath, ['scripts/access-preflight-check.mjs', '--mode', 'live'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 2, result.stderr);
  const gate = JSON.parse(result.stdout);
  assert.equal(gate.target, 'CE-A01');
  assert.equal(gate.mode, 'live');
  assert.equal(gate.status, 'blocked');
  assert.equal(gate.acceptance_allowed, false);
  assert.equal(gate.required_cell_count, 8);
  assert.equal(gate.verified_cell_count, 0);
  assert.equal(gate.provider_dispatches, 0);
  assert.equal(gate.paid_provider_calls, 0);
  assert.equal(gate.provider_credentials_read, false);
  assert.deepEqual(gate.cells.map((cell) => cell.status), Array(8).fill('blocked'));
  // Either provider target satisfies an image cell, so the two are one group per cell, not two separate requirements.
  const generationGroup = 'one_of:openai_generation_account_permission_and_quota|openrouter_generation_account_permission_and_quota';
  const editGroup = 'one_of:openai_edit_account_permission_and_quota|openrouter_edit_account_permission_and_quota';
  assert.ok(gate.missing_owner_evidence.includes(generationGroup));
  assert.ok(gate.missing_owner_evidence.includes(editGroup));
  assert.ok(!gate.missing_owner_evidence.some((item) => /^(openai|openrouter)_/.test(item)), 'no provider is demanded on its own');
  assert.equal(gate.evidence_alternatives_rule, 'any_one_member_satisfies_the_group');
  assert.deepEqual(gate.evidence_alternatives[generationGroup],
    ['openai_generation_account_permission_and_quota', 'openrouter_generation_account_permission_and_quota']);
  assert.deepEqual(gate.evidence_alternatives[editGroup],
    ['openai_edit_account_permission_and_quota', 'openrouter_edit_account_permission_and_quota']);
  assert.deepEqual(gate.cells.find((cell) => cell.cell_id === 'image_generation').missing_evidence,
    [generationGroup, 'external_grant_and_finance_reservation']);
  assert.ok(gate.missing_owner_evidence.includes('external_grant_and_finance_reservation'));
  assert.ok(gate.missing_owner_evidence.includes('accepted_neatlogs_readback_protocol_and_receipt'));
  assert.doesNotMatch(result.stdout, /Bearer\s|sk-[A-Za-z0-9_-]{8,}|@[A-Za-z0-9.-]+\.[A-Z]{2,}/i);
});

test('mock runtime evidence preserves the matrix and identifies synthetic dispatches without claiming acceptance', () => {
  const output = 'build/access-preflight-test-evidence.json';
  const result = spawnSync(process.execPath, ['scripts/access-preflight-check.mjs', '--mode', 'mock', '--out', output], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /8 cells, 4 synthetic adapter dispatches, acceptance pending/);
  const serialized = readFileSync(output, 'utf8');
  const evidence = JSON.parse(serialized);
  assert.equal(evidence.status, 'simulated_or_pending');
  assert.equal(evidence.mode, 'mock');
  assert.equal(evidence.acceptance_allowed, false);
  assert.equal(evidence.required_cell_count, 8);
  assert.equal(evidence.verified_cell_count, 0);
  assert.equal(evidence.paid_provider_calls, 0);
  assert.equal(evidence.provider_credentials_read, false);
  assert.equal(evidence.test_fixture_only.mock_adapter_dispatches, 4);
  assert.equal(evidence.test_fixture_only.actual_network_requests, 0);
  assert.equal(evidence.report.cells.length, 8);
  assert.equal(evidence.report.cells.find((cell) => cell.cell_id === 'image_generation').status, 'simulated');
  assert.equal(evidence.report.cells.find((cell) => cell.cell_id === 'image_edit').status, 'simulated');
  assert.equal(evidence.report.cells.find((cell) => cell.cell_id === 'harness_jev').status, 'blocked');
  assert.deepEqual(evidence.test_fixture_only.scenarios, [
    { provider: 'openai', cell_id: 'image_generation', status: 'simulated' },
    { provider: 'openai', cell_id: 'image_edit', status: 'simulated' },
    { provider: 'openrouter', cell_id: 'image_generation', status: 'simulated' },
    { provider: 'openrouter', cell_id: 'image_edit', status: 'simulated' },
  ]);
  assert.equal(evidence.test_fixture_only.intercepted_openrouter_adapter_requests, 4, 'two intercepted reads for each of the two OpenRouter scenarios');
  for (const cellId of ['image_generation', 'image_edit']) {
    for (const provider of ['openai', 'openrouter']) {
      const row = evidence.test_fixture_only.image_cell_targets[cellId][provider];
      assert.equal(row.status, 'simulated', `${provider} ${cellId}`);
      assert.equal(row.verified, false);
      assert.match(row.configuration_sha256, /^sha256:[a-f0-9]{64}$/);
    }
    const { openai, openrouter } = evidence.test_fixture_only.image_cell_targets[cellId];
    assert.notEqual(openai.configuration_sha256, openrouter.configuration_sha256);
  }
  assert.ok(evidence.input_sha256['src/preflight/openrouter-images.mjs']);
  assert.doesNotMatch(serialized, /Bearer\s|sk-[A-Za-z0-9_-]{8,}|@[A-Za-z0-9.-]+\.[A-Z]{2,}|signature=/i);
});
