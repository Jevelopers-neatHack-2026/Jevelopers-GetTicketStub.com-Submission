import assert from 'node:assert/strict';
import test from 'node:test';
import { invokeAgentCreativeDevelopment } from '@jevelopers/agent-harness-runtime/development';

const pins = { application: '1'.repeat(40), agent_harness: '2'.repeat(40), creative_engine: '3'.repeat(40) };

test('development driver delegates to the same host with exact loaded component pins', async () => {
  let calls = 0;
  const host = { environment: 'test', source_manifest: pins,
    async invoke(request) { calls++; assert.equal(request.environment, 'test'); return { status: 'unavailable' }; } };
  const output = await invokeAgentCreativeDevelopment({ host, request: { environment: 'test' }, source_manifest: pins });
  assert.equal(calls, 1); assert.equal(output.evidence_mode, 'development_only');
  assert.equal(output.response.status, 'unavailable');
});

test('production, moving pins and mismatched manifests cannot use the development driver', async () => {
  let calls = 0;
  const host = { environment: 'test', source_manifest: pins, async invoke() { calls++; } };
  for (const options of [
    { host: { ...host, environment: 'production' }, request: { environment: 'production' }, source_manifest: pins },
    { host, request: { environment: 'test' }, source_manifest: { ...pins, agent_harness: 'main' } },
    { host, request: { environment: 'test' }, source_manifest: { ...pins, agent_harness: 'a'.repeat(40) } },
    { host, request: { environment: 'production' }, source_manifest: pins },
  ]) await assert.rejects(invokeAgentCreativeDevelopment(options));
  assert.equal(calls, 0);
});
