// Offline OpenRouter adapter harness. Every port and the transport are synthetic: there is no
// credential, no network, and no paid provider call. A synthetic bearer canary is injected through
// the credential port so tests can prove it never reaches an error, telemetry, or evidence value.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createOpenRouterImagesProvider } from "../../src/models/index.mjs";
import { makePng } from "./png.mjs";

export const OR_MODEL = "synthetic-lab/image-model-offline";
export const OR_PROVIDER_TAG = "synthetic-provider";
export const OR_ENDPOINT = "https://openrouter.ai/api/v1/images";
export const NOW = Date.parse("2026-10-11T18:00:00.000Z");
export const TEST_HASH = `sha256:${"a".repeat(64)}`;
export const CREDENTIAL_CANARY = "synthetic-offline-openrouter-canary-7f3a9c";
export const HASH = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

export const SUPPORTED_PARAMETERS = Object.freeze({
  aspect_ratio: { type: "enum", values: ["1:1", "16:9"] },
  quality: { type: "enum", values: ["auto", "low", "high"] },
  background: { type: "enum", values: ["auto", "opaque", "transparent"] },
  output_format: { type: "enum", values: ["png", "jpeg", "webp"] },
  resolution: { type: "enum", values: ["1K", "2K"] },
  output_compression: { type: "range", min: 0, max: 100 },
});

export function orProfile(overrides = {}) {
  return {
    model_id: OR_MODEL,
    provider_tag: OR_PROVIDER_TAG,
    capabilities: { generation: true, edit: { max_input_references: 3 } },
    supported_parameters: SUPPORTED_PARAMETERS,
    configuration: { aspect_ratio: "1:1", quality: "low", output_format: "png", background: "opaque" },
    ...overrides,
  };
}

export function orInput(operation = "generate", overrides = {}) {
  const controller = new AbortController();
  const attempt = {
    schema_version: "creative.metering.proposal/v1",
    logical_operation_id: "logical-image-001",
    billable_attempt_id: "billable-image-001",
    retry_mapping_ref: "openrouter-images/retry-policy-v1",
    environment: "test",
    billing_mode: "simulated",
    operation_kind: operation === "generate" ? "image_generation" : "image_edit",
    tenant_id: "tenant-test",
    project_id: "creative-project-test",
    budget_scope_id: "budget-test",
    budget: { scope_id: "budget-test", policy_version: "offline-fixture-v1" },
    provider: { name: "openrouter", model: OR_MODEL, endpoint: OR_ENDPOINT, sdk: { name: "native-fetch", version: process.versions.node } },
  };
  const plan = operation === "generate"
    ? { operation: "concept.generate", steps: [{ action: "image.generate", parameters: {} }] }
    : { operation: "image.edit", source_refs: [], steps: [{ action: "image.edit", parameters: {
      design_version_id: "design-version-01", artifact_id: "parent-artifact-01", instruction: "Make the sky blue." } }] };
  return {
    scope: { tenant_id: attempt.tenant_id, project_id: attempt.project_id },
    actor_id: "actor-test",
    job_id: "job-test",
    attempt,
    brief: { brief_id: "brief-test", preferences: { items: [] } },
    base_design: operation === "edit" ? { design_version_id: "design-version-01", artifact: {
      artifact_id: "parent-artifact-01", content_hash: HASH(makePng()), media_type: "image/png" } } : null,
    plan,
    transport_attempt_id: "transport-image-001",
    dispatch_intent_ref: "dispatch-image-001",
    reservation_ref: "reservation-image-001",
    deadline_at: new Date(NOW + 60_000).toISOString(),
    signal: controller.signal,
    controller,
    recordTransportAttempt: async (id) => { assert.equal(id, "transport-image-001"); return "dispatch-image-001"; },
    revalidateDispatch: async (binding) => {
      assert.equal(binding.transport_attempt_id, "transport-image-001");
      assert.match(binding.target_binding_sha256, /^sha256:[a-f0-9]{64}$/);
      return "dispatch-image-001";
    },
    ...overrides,
  };
}

export function orAuthorityPorts({ mutateCapability, mutateAuthority, events = [] } = {}) {
  const capabilityFor = (args) => {
    const value = {
      status: "verified", eligible: true, operation_permission: "allowed", quota_status: "available", service: "openrouter",
      account_ref: "or-workspace-fixture-01", project_ref: "or-key-fixture-01",
      tenant_id: args.scope.tenant_id, project_id: args.scope.project_id, budget_scope_id: args.attempt.budget_scope_id,
      operation: args.operation, model: args.model, target_binding_sha256: args.target_binding_sha256,
      expires_at: new Date(NOW + 600_000).toISOString(), evidence_ref: "capability-proof-01", evidence_sha256: TEST_HASH,
      revoked: false,
    };
    return mutateCapability ? mutateCapability(value, args) : value;
  };
  const authorityFor = (args) => {
    const grant = {
      service: "openrouter", grant_ref: "grant-fixture-01", account_ref: "or-workspace-fixture-01", project_ref: "or-key-fixture-01",
      tenant_id: args.scope.tenant_id, project_id: args.scope.project_id, target_binding_sha256: args.target_binding_sha256,
      operation: args.operation, model: args.target_binding.model, permission: "allowed", revoked: false,
      expires_at: new Date(NOW + 600_000).toISOString(), evidence_ref: "grant-evidence-01", evidence_sha256: TEST_HASH,
    };
    const finance = {
      status: "held", revoked: false, reservation_ref: args.reservation_ref, billable_attempt_id: args.billable_attempt_id,
      budget_scope_id: args.budget_scope_id, lease_ref: "finance-lease-01", grant_ref: grant.grant_ref,
      account_ref: grant.account_ref, project_ref: grant.project_ref, tenant_id: args.scope.tenant_id, project_id: args.scope.project_id,
      provider: "openrouter", model: args.target_binding.model, operation: args.operation, target_binding_sha256: args.target_binding_sha256,
      held_amount: { amount: "0.75", currency: "USD" }, authorized_cap: { amount: "1.00", currency: "USD" },
      expires_at: new Date(NOW + 600_000).toISOString(), evidence_ref: "finance-evidence-01", evidence_sha256: TEST_HASH,
    };
    const value = { status: "authorized", revoked: false, grant, finance };
    return mutateAuthority ? mutateAuthority(value, args) : value;
  };
  return {
    capabilityPort: {
      async verify(args) { events.push("capability.verify"); return capabilityFor(args); },
      async revalidate(args) { events.push("capability.revalidate"); return capabilityFor(args); },
    },
    authorizationPort: { async revalidate(args) { events.push(`authority.${args.phase}`); return authorityFor(args); } },
  };
}

export function orCredentialPort(events = []) {
  return {
    async resolveCredential(args) {
      events.push("credential.resolve");
      return {
        status: "resolved", token: CREDENTIAL_CANARY,
        binding: { service: "openrouter", account_ref: args.account_ref, project_ref: args.project_ref,
          grant_ref: args.grant_ref, target_binding_sha256: args.target_binding_sha256 },
        provider_scope: { organization_id: args.account_ref, project_id: args.project_ref },
        expires_at: new Date(NOW + 300_000).toISOString(),
        evidence: { ref: "credential-evidence-01", sha256: TEST_HASH },
      };
    },
  };
}

export function orResponse(bytes = makePng(), { usage, media_type, extra } = {}) {
  const item = { b64_json: bytes.toString("base64"), ...(media_type === undefined ? {} : { media_type }) };
  return new Response(JSON.stringify({ created: 1760205600, data: [item], ...(usage === undefined ? {} : { usage }), ...(extra ?? {}) }), {
    status: 200, headers: { "content-type": "application/json" } });
}

export const FULL_USAGE = Object.freeze({ prompt_tokens: 12, completion_tokens: 34, total_tokens: 46, cost: 0.04,
  cost_details: { upstream_inference_cost: 0.035 }, is_byok: false });

export function orHarness(options = {}) {
  const { operation = "generate", profile = {}, outputBytes = makePng(), media_type,
    fetchImpl, ports = {}, now = () => NOW, inputOverride = {}, assetPort, promptPort } = options;
  const usage = Object.hasOwn(options, "usage") ? options.usage : FULL_USAGE;
  const events = ports.events ?? [];
  const authority = orAuthorityPorts({ events, ...ports });
  const requests = [];
  const provider = createOpenRouterImagesProvider({
    ...orProfile(profile),
    ...authority,
    credentialPort: orCredentialPort(events),
    promptPort: promptPort ?? { render: async () => "A synthetic offline test image." },
    assetPort,
    fetchImpl: async (url, init) => {
      events.push("fetch.called");
      requests.push({ url, init });
      return fetchImpl ? fetchImpl(url, init) : orResponse(outputBytes, { usage, media_type });
    },
    now,
    idFactory: () => "generated-artifact-01",
  });
  return { provider, ctx: orInput(operation, inputOverride), events, requests, get fetchCount() { return requests.length; } };
}
