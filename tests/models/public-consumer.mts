import {
  createOpenAIImagesProvider,
  evaluateOpenAIImageRetry,
  inspectOpenAIImageBytes,
  normalizeOpenAIImageUsage,
  type OpenAIImagesInput,
  type OpenAIImagesOutput,
  type OpenAIImageAuthorizationRequest,
} from "creative-engine/models";
import type { PrivateProviderUsageAttribution } from "creative-engine/api/v1";
import type { TrustedProviderUsageProfileAuthority } from "creative-engine/telemetry";
import type { UsageObservation } from "creative-engine/contracts/metering";

const provider = createOpenAIImagesProvider({
  model_id: "gpt-image-2.5-sunburst-2026-09-08",
  configuration: { quality: "high", size: "1024x1024", output_format: "png", background: "opaque", moderation: "auto" },
  capabilityPort: { verify: async (_input) => ({}), revalidate: async (_input) => ({}) },
  authorizationPort: { revalidate: async (_input) => ({}) },
  credentialPort: { resolveCredential: async (_input) => ({}) },
  promptPort: { render: async (_input) => "local fixture" },
  fetchImpl: async (_input, _init) => new Response("{}"),
});

export async function consume(input: OpenAIImagesInput): Promise<OpenAIImagesOutput> {
  const route = provider.resolveRoute({ operation: "generate" });
  const output = await provider.generate(input);
  const detailCount: number | undefined = output.usage.input_tokens_details?.image_tokens;
  const totalCount: number | undefined = output.usage.total_tokens;
  const transportId: string | undefined = output.usage.transport_attempt_id;
  void route.provider.model;
  void detailCount;
  void totalCount;
  void transportId;
  return output;
}

export function consumeAuthorizationBinding(input: OpenAIImageAuthorizationRequest) {
  const prompt: `sha256:${string}` = input.target_binding.prompt_sha256;
  const operationInput: `sha256:${string}` = input.target_binding.input_sha256;
  const parent: `sha256:${string}` | undefined = input.target_binding.parent_artifact_sha256;
  return { prompt, operationInput, parent };
}

export async function consumeImageBytes(bytes: Uint8Array) {
  const info = await inspectOpenAIImageBytes(bytes);
  const usage = normalizeOpenAIImageUsage({ input_tokens: 12, output_tokens: 8 }, { transport_attempt_id: "transport-01" });
  const retry = evaluateOpenAIImageRetry({ attempt_number: 1, started_at: new Date(0).toISOString(),
    now_at: new Date(1000).toISOString(), deadline_at: new Date(100_000).toISOString(), retry_after: "1" });
  return { format: info.format, width: info.width, usage, retry };
}

export const ownerUsageProfile: TrustedProviderUsageProfileAuthority = {
  mapProviderUsage(input) {
    const exactAttempt: string = input.attempt.billable_attempt_id;
    const exactTarget: `sha256:${string}` = input.targetBindingSha256;
    const reservation: string = input.reservationRef;
    const dispatch: string = input.dispatchIntentRef;
    void exactAttempt;
    void exactTarget;
    void reservation;
    void dispatch;
    const observation: UsageObservation = {
      schema_version: "creative.metering.proposal/v1",
      tenant_id: input.attempt.tenant_id,
      project_id: input.attempt.project_id,
      budget_scope_id: input.attempt.budget_scope_id,
      logical_operation_id: input.attempt.logical_operation_id,
      billable_attempt_id: input.attempt.billable_attempt_id,
      source_observation_id: input.sourceObservationId,
      source: "provider_response",
      provider_name: input.attempt.provider.name,
      model: input.attempt.provider.model,
      transport_attempt_id: input.transportAttemptId,
      environment: input.attempt.environment,
      billing_mode: input.attempt.billing_mode,
      completeness: "unknown",
      missing_fields: ["profile_not_selected"],
    };
    return {
      status: "mapped",
      profile_ref: "owner-profile/illustrative",
      profile_sha256: `sha256:${"0".repeat(64)}`,
      raw_usage_sha256: input.rawUsageSha256,
      target_binding_sha256: input.targetBindingSha256,
      attempt_binding_sha256: input.attemptBindingSha256,
      observation,
    };
  },
};

export function retainPrivateUsage(input: PrivateProviderUsageAttribution) {
  const target: `sha256:${string}` = input.target_binding_sha256;
  const count: number | undefined = input.usage.total_tokens;
  return { target, count };
}

// ---- OpenRouter Images adapter public types ----
import {
  OPENROUTER_IMAGES_ENDPOINT,
  OpenRouterImagesProviderError,
  createOpenRouterImagesProvider,
  normalizeOpenRouterImageUsage,
  type OpenRouterImageAuthorizationRequest,
  type OpenRouterImageCapabilities,
  type OpenRouterImageProviderOptions,
  type OpenRouterImagesOutput,
} from "creative-engine/models";

const openRouterCapabilities: OpenRouterImageCapabilities = { generation: true, edit: { max_input_references: 4 } };
const generationOnly: OpenRouterImageCapabilities = { generation: true, edit: false };
// @ts-expect-error edit must be an explicit maximum or false, never a bare boolean
const invalidCapabilities: OpenRouterImageCapabilities = { generation: true, edit: true };

const openRouterOptions: OpenRouterImageProviderOptions = {
  model_id: "synthetic-lab/image-model-offline",
  provider_tag: "synthetic-provider",
  capabilities: openRouterCapabilities,
  supported_parameters: {
    aspect_ratio: { type: "enum", values: ["1:1", "16:9"] },
    output_format: { type: "enum", values: ["png", "webp"] },
    output_compression: { type: "range", min: 0, max: 100 },
  },
  configuration: { aspect_ratio: "16:9", output_format: "webp", output_compression: 80 },
  capabilityPort: { verify: async (_input) => ({}), revalidate: async (_input) => ({}) },
  authorizationPort: { revalidate: async (_input) => ({}) },
  credentialPort: { resolveCredential: async (_input) => ({}) },
  promptPort: { render: async (_input) => "local fixture" },
  fetchImpl: async (_input, _init) => new Response("{}"),
};

const openRouterProvider = createOpenRouterImagesProvider(openRouterOptions);
// @ts-expect-error the SVG output path is not an accepted configuration value
const svgConfiguration: OpenRouterImageProviderOptions["configuration"] = { output_format: "svg" };
// @ts-expect-error mask and user/session identifiers are not part of the configuration
const maskConfiguration: OpenRouterImageProviderOptions["configuration"] = { mask: "x", user: "tenant" };

export async function consumeOpenRouter(input: OpenAIImagesInput): Promise<OpenRouterImagesOutput> {
  const route = openRouterProvider.resolveRoute({ operation: "edit" });
  const output = await openRouterProvider.edit(input);
  const cost = output.usage.cost;
  const amount: string | undefined = cost?.amount;
  const currency: "USD" | undefined = cost?.currency;
  const provenance: "provider_reported_unsettled" | undefined = cost?.provenance;
  const inputTokens: number | undefined = output.usage.input_tokens;
  const missing: readonly string[] = output.usage.missing_fields;
  const endpoint: "https://openrouter.ai/api/v1/images" = OPENROUTER_IMAGES_ENDPOINT;
  void [route.provider.name, amount, currency, provenance, inputTokens, missing, endpoint, generationOnly, invalidCapabilities, svgConfiguration, maskConfiguration];
  return output;
}

export function consumeOpenRouterBinding(input: OpenRouterImageAuthorizationRequest) {
  const service: "openrouter" = input.target_binding.service;
  const tag: string = input.target_binding.provider_tag;
  const kind: "image_generation" | "image_reference_edit" = input.target_binding.operation_kind;
  const routing: false = input.target_binding.provider_routing.allow_fallbacks;
  return { service, tag, kind, routing };
}

export function consumeOpenRouterError(error: unknown): string | undefined {
  if (error instanceof OpenRouterImagesProviderError) {
    const code: string = error.code;
    const costProvenance: "provider_reported_unsettled" | undefined = error.usage?.cost?.provenance;
    void costProvenance;
    return code;
  }
  return normalizeOpenRouterImageUsage({ prompt_tokens: 1 }, { transport_attempt_id: "transport-01" }).transport_attempt_id;
}

// ---- Runtime port and attribution types admit both allowlisted native providers ----
import type {
  CreativeConceptDispatchTargetBinding,
  CreativeRuntimePorts,
  PrivateProviderRequestAttribution,
} from "creative-engine/api/v1";

export const openRouterRuntimeProvider: NonNullable<CreativeRuntimePorts["provider"]> = openRouterProvider;
export const openAIRuntimeProvider: NonNullable<CreativeRuntimePorts["provider"]> = provider;

export function consumeConceptBinding(binding: CreativeConceptDispatchTargetBinding): string {
  if (binding.service === "openrouter") {
    const kind: "image_reference_edit" = binding.operation_kind;
    const tag: string = binding.provider_tag;
    const endpoint: "https://openrouter.ai/api/v1/images" = binding.endpoint;
    return `${kind}${tag}${endpoint}`;
  }
  const kind: "image_edit" = binding.operation_kind;
  return kind;
}

export function consumeAttributionProvider(input: PrivateProviderRequestAttribution): "openai" | "openrouter" {
  return input.provider;
}
