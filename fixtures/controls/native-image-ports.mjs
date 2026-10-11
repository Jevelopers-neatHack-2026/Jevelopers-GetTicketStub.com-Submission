/** Explicit offline MOCK authority. The public native provider owns validation,
 * multipart encoding, dispatch fencing, decoding and private attribution.
 * These injected ports confer no real membership, provider access or Finance hold. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { createOpenAIImagesProvider } from 'creative-engine/models';
import { canonicalHash } from 'creative-engine/contracts';
import { chunk } from '../models/png.mjs';

export const MOCK_MODEL = 'gpt-image-2.5-sunburst-2026-09-08';
const sha = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const PROFILE = Object.freeze({ mode: 'mock', profile: 'controls-native-offline/1', model: MOCK_MODEL,
  meaning: 'Synthetic token subsets only; no production owner agreement or local valuation' });

// Valid, distinct encoded pixels for generation and each intercepted edit.
export function nativePng(sequence) {
  const header = Buffer.alloc(13); header.writeUInt32BE(16, 0); header.writeUInt32BE(16, 4); header[8] = 8; header[9] = 6;
  const rows = Buffer.alloc(65 * 16);
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 16; x += 1) {
    const i = y * 65 + 1 + x * 4;
    rows[i] = (x * 13 + sequence * 17) & 255; rows[i + 1] = (y * 17 + sequence * 11) & 255;
    rows[i + 2] = (127 + sequence * 23) & 255; rows[i + 3] = 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

export function nativeImagePorts({ store, getBrief, counters, policy, reservations, wait, now, format = 'png' }) {
  assert.ok(['png', 'jpeg', 'webp'].includes(format));
  const captures = [];
  const evidence = canonicalHash({ authority: 'MOCK controls host authority', profile: PROFILE });
  const expires = () => new Date(now() + 10 * 60_000).toISOString();
  const capability = async input => {
    await wait('native-capability');
    return { status: 'verified', eligible: true, revoked: policy.can_apply === false,
      operation_permission: 'allowed', quota_status: 'available', service: 'openai', account_ref: 'org-synthetic', project_ref: 'proj-synthetic',
      tenant_id: input.scope.tenant_id, project_id: input.scope.project_id, budget_scope_id: input.attempt.budget_scope_id,
      operation: input.operation, model: input.model, target_binding_sha256: input.target_binding_sha256,
      expires_at: expires(), evidence_ref: 'fixture:MOCK-native-capability', evidence_sha256: evidence };
  };
  const provider = createOpenAIImagesProvider({ model_id: MOCK_MODEL,
    configuration: { quality: 'low', size: '16x16', output_format: format, background: 'opaque', moderation: 'auto' },
    capabilityPort: { verify: capability, revalidate: capability },
    authorizationPort: { async revalidate(input) {
      await wait(input.phase === 'post_transport_ack' ? 'native-post-ack' : 'native-authorization');
      const reservation = reservations.get(input.reservation_ref);
      const revoked = policy.can_apply === false || !reservation || reservation.status !== 'held' || reservation.billable_attempt_id !== input.billable_attempt_id;
      const grant = { service: 'openai', grant_ref: 'fixture-mock-grant', account_ref: 'org-synthetic', project_ref: 'proj-synthetic',
        tenant_id: input.scope.tenant_id, project_id: input.scope.project_id, target_binding_sha256: input.target_binding_sha256,
        operation: input.operation, model: MOCK_MODEL, permission: 'allowed', revoked, expires_at: expires(),
        evidence_ref: 'fixture:MOCK-native-grant', evidence_sha256: evidence };
      return { status: 'authorized', revoked, grant, finance: { status: revoked ? 'revoked' : 'held', revoked,
        reservation_ref: input.reservation_ref, billable_attempt_id: input.billable_attempt_id, budget_scope_id: input.budget_scope_id,
        lease_ref: reservation?.lease_id ?? 'fixture-missing-lease', grant_ref: grant.grant_ref,
        account_ref: grant.account_ref, project_ref: grant.project_ref, tenant_id: grant.tenant_id, project_id: grant.project_id,
        provider: 'openai', model: MOCK_MODEL, operation: input.operation, target_binding_sha256: input.target_binding_sha256,
        held_amount: { amount: '1.00', currency: 'USD' }, authorized_cap: { amount: '2.00', currency: 'USD' },
        expires_at: expires(), evidence_ref: 'fixture:MOCK-local-reservation', evidence_sha256: evidence } };
    } },
    credentialPort: { async resolveCredential(input) {
      await wait('native-credential');
      return { status: 'resolved', token: 'synthetic-offline-token', binding: { service: 'openai', account_ref: input.account_ref,
        project_ref: input.project_ref, grant_ref: input.grant_ref, target_binding_sha256: input.target_binding_sha256 },
        provider_scope: { organization_id: input.account_ref, project_id: input.project_ref }, expires_at: expires(),
        evidence: { ref: 'fixture:MOCK-in-memory-credential', sha256: evidence } };
    } },
    promptPort: { async render(input) {
      return `Synthetic offline artwork fixture. Operation ${input.operation}. Typed plan hash ${canonicalHash(input.plan)}.`;
    } },
    assetPort: { async readArtifact(input) {
      const brief = getBrief();
      const design = store.getCurrentDesignVersion({ scope: input.scope, brief_id: brief.brief_id });
      assert.equal(design.artifact.artifact_id, input.artifact_id); assert.equal(design.artifact.content_hash, input.content_hash);
      assert.equal(design.artifact.media_type, input.media_type);
      const bytes = await store.getArtifactBytes({ scope: input.scope, brief_id: brief.brief_id, design_version_id: design.design_version_id });
      await wait('native-asset'); return bytes;
    } },
    fetchImpl: async (url, init) => {
      const endpoint = String(url); assert.equal(init.method, 'POST');
      assert.ok(['https://api.openai.com/v1/images/generations', 'https://api.openai.com/v1/images/edits'].includes(endpoint));
      const operation = endpoint.endsWith('/edits') ? 'edit' : 'generate';
      let parent;
      if (operation === 'edit') {
        assert.ok(init.body instanceof FormData); const files = init.body.getAll('image[]'); assert.equal(files.length, 1);
        const bytes = Buffer.from(await files[0].arrayBuffer()); parent = { content_hash: sha(bytes), media_type: files[0].type, byte_length: bytes.length };
      } else { const body = JSON.parse(init.body); assert.equal(body.model, MOCK_MODEL); assert.equal(body.n, 1); }
      counters.image_calls += 1;
      const bytes = format === 'png' ? nativePng(captures.length + 1) :
        readFileSync(new URL(`../models/valid-16x16.${format === 'jpeg' ? 'jpg' : 'webp'}`, import.meta.url));
      captures.push({ operation, endpoint_kind: operation === 'edit' ? 'images.edits' : 'images.generations', method: 'POST',
        ...(parent ? { parent } : {}), output: { content_hash: sha(bytes), media_type: `image/${format}`, byte_length: bytes.length } });
      await wait('provider');
      const usage = { input_tokens: 12, output_tokens: 8, total_tokens: 20,
        input_tokens_details: { image_tokens: 10, text_tokens: 2 }, output_tokens_details: { image_tokens: 7, text_tokens: 1 } };
      if (policy.native_fault === 'usage-extension') usage.unmapped_dimension = 1;
      if (policy.native_fault === 'malformed-usage') usage.input_tokens = -1;
      const output = policy.native_fault === 'corrupt-output' ? bytes.subarray(0, 40) : bytes;
      return new Response(JSON.stringify({ data: [{ b64_json: output.toString('base64') }], usage }),
        { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'req-controls-private-synthetic' } });
    }, now,
  });
  const usageAuthority = { async mapProviderUsage(input) {
    await wait('usage-map');
    const raw = input.rawUsage, attempt = input.attempt;
    if (policy.map_native_usage === false || attempt.provider.name !== 'openai' || attempt.provider.model !== MOCK_MODEL ||
        raw.transport_attempt_id !== input.transportAttemptId || raw.completeness !== 'unknown' ||
        JSON.stringify(raw.missing_fields) !== JSON.stringify(['usage.profile_mapping_pending'])) return { status: 'unknown' };
    const units = [['input_tokens', raw.input_tokens, 'total_tokens'], ['output_tokens', raw.output_tokens, 'total_tokens'],
      ['total_tokens', raw.total_tokens], ['input_tokens_details.image_tokens', raw.input_tokens_details?.image_tokens, 'input_tokens'],
      ['input_tokens_details.text_tokens', raw.input_tokens_details?.text_tokens, 'input_tokens'],
      ['output_tokens_details.image_tokens', raw.output_tokens_details?.image_tokens, 'output_tokens'],
      ['output_tokens_details.text_tokens', raw.output_tokens_details?.text_tokens, 'output_tokens']];
    if (units.some(([, quantity]) => !Number.isSafeInteger(quantity) || quantity < 0)) return { status: 'unknown' };
    return { status: 'mapped', profile_ref: 'mock-owner-profile:controls-native-offline/1', profile_sha256: canonicalHash(PROFILE),
      raw_usage_sha256: input.rawUsageSha256, target_binding_sha256: input.targetBindingSha256, attempt_binding_sha256: input.attemptBindingSha256,
      observation: { schema_version: 'creative.metering.proposal/v1', tenant_id: attempt.tenant_id, project_id: attempt.project_id,
        budget_scope_id: attempt.budget_scope_id, logical_operation_id: attempt.logical_operation_id, billable_attempt_id: attempt.billable_attempt_id,
        source_observation_id: input.sourceObservationId, source: 'provider_response', provider_name: attempt.provider.name, model: attempt.provider.model,
        ...(raw.provider_request_id ? { provider_request_id: raw.provider_request_id } : {}), transport_attempt_id: input.transportAttemptId,
        environment: attempt.environment, billing_mode: attempt.billing_mode, completeness: 'complete', missing_fields: [],
        usage_units: units.map(([name, quantity, included_in]) => ({ name, quantity: String(quantity),
          relation: included_in ? 'included_subset' : 'standalone', ...(included_in ? { included_in } : {}) })) } };
  } };
  return { provider, usageAuthority, captures, profile: PROFILE };
}
