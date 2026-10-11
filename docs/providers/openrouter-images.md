# OpenRouter Images adapter

`createOpenRouterImagesProvider` (public through `creative-engine/models`) is an image provider adapter that sits **alongside** the direct [OpenAI Images adapter](openai-images.md). It uses the same injected capability, authorization, Finance, credential, prompt and asset ports, the same C03 metering, CE08 version and CE11 telemetry boundaries, and the same shared validation core (`src/models/image-adapter-core.mjs`). It does **not** establish account access, model entitlement, price, or quality, and it selects no model.

Status: **implemented offline against intercepted transport only**. No request to OpenRouter has been made; account access, entitlement, and live behavior are unverified (see [external gates](#external-gates-that-remain-open)).

## Sourced facts

Checked against the official OpenRouter documentation on 2026-10-11:

- [Image Generation guide](https://openrouter.ai/docs/guides/overview/multimodal/image-generation)
- [TypeScript SDK Images reference](https://openrouter.ai/docs/client-sdks/typescript/sdks/images/README)
- [Errors and debugging](https://openrouter.ai/docs/api/reference/errors-and-debugging)
- [Usage accounting](https://openrouter.ai/docs/guides/administration/usage-accounting)

Only these documented facts are relied on:

| Topic | Documented fact | Consequence in this adapter |
| --- | --- | --- |
| Endpoint | `POST https://openrouter.ai/api/v1/images`, `Authorization: Bearer <key>`, `Content-Type: application/json`. | Exactly one such request per invocation. |
| Request | `model` and `prompt` are required; `n` (1-10), `resolution` (`512`, `768`, `1K`, `1.5K`, `2K`, `4K`), `aspect_ratio`, `size`, `quality`, `output_format` (`png`, `jpeg`, `webp`, `svg`), `background`, `output_compression` (0-100), `seed`, `stream`, `input_references`, `user`, `session_id`, `trace`, `provider`. | Only `model`, `prompt`, `n: 1`, `stream: false`, `provider`, validated options, and (edit) `input_references` are sent. |
| References | `input_references: [{type: "image_url", image_url: {url}}]`; `url` is HTTP(S) or a base64 data URL. The allowed count is per model (a range descriptor, for example 0 to 16). There is **no edit endpoint and no mask parameter**, and the documentation does not say the first reference is treated as the pixel parent. | Edit is a separate, reference-guided capability. Masks are rejected. Only data URLs built from validated asset-port bytes are sent. |
| Routing | `provider.only/order/ignore/sort/allow_fallbacks/options`; `allow_fallbacks` defaults to **true**; account-wide provider settings merge with request settings. | `provider: {only: [<pinned tag>], allow_fallbacks: false}` always; never `sort`, `order`, `ignore` or `options`. Account-level merging is an external configuration gate (G2). |
| Discovery | Per-model `supported_parameters` descriptors (`enum`, `range`, `boolean`; an absent key means unsupported). | Discovery is a catalog, not entitlement, quota, or price. The host copies the relevant descriptors into the profile. |
| Response | `{created, data: [{b64_json, media_type?}], usage?}`; `media_type` may be omitted. No generation or request id is documented for this endpoint. | Decoded and inspected locally; no provider request reference is read or fabricated. |
| Usage | `usage` is returned "when available": `prompt_tokens`, `completion_tokens`, `total_tokens`, optional `cost` (USD per the image guide), `cost_details` (`upstream_inference_cost`, `upstream_inference_prompt_cost`, `upstream_inference_completions_cost`), `is_byok`. | Missing usage or cost is unknown, never zero. |
| Billing | Described as all-or-nothing; failed generations are not billed (`502`). A client disconnect may still finish upstream. Errors can arrive with HTTP 200 and an `error` body. | An unobserved outcome after transport start stays unknown and the C03 hold is retained. A documented non-billing statement never releases a reservation locally. |
| Errors | `{error: {code, message, metadata?}}`; `400`, `401`, `402`, `403` (permission, guardrail, moderation; moderation metadata echoes `flagged_input`), `404`, `408`, `413`, `429`, `500`, `502`, `503`, `524`, `529`. | Mapped below; provider text and metadata are never retained. |

## Supported and unsupported

Supported (offline): generation; reference-guided edit from the selected immutable parent plus manifest references; parentless concepts from exactly the authorized references; the options `aspect_ratio`, `quality`, `background`, `output_format` (`png`, `jpeg`, `webp`), `resolution`, `output_compression`, each only when the profile declares it.

Unsupported (rejected before credential resolution or transport, or never sent): masks and inpainting; chat-completions image modalities; streaming; `n > 1`; SVG output; `seed`, `size`, `user`, `session_id`, `trace`, `HTTP-Referer`, `X-Title`; provider `sort`, `order`, `ignore`, `options`; provider fallback; automatic retry; URL output; arbitrary reference URLs or caller-supplied bytes; local price arithmetic; model selection; account setup; and any live call.

## Host profile

There are no built-in default models. The host passes an explicit profile:

```js
createOpenRouterImagesProvider({
  model_id: "author/slug",                 // chosen by the host, never defaulted
  provider_tag: "pinned-provider-tag",     // sent as provider.only with allow_fallbacks:false
  capabilities: { generation: true, edit: { max_input_references: 4 } },  // edit may be false
  supported_parameters: { aspect_ratio: { type: "enum", values: ["1:1", "16:9"] }, /* ... */ },
  configuration: { aspect_ratio: "1:1", output_format: "png", background: "opaque" },
  capabilityPort, authorizationPort, credentialPort, promptPort, assetPort, fetchImpl, now, idFactory, retryPolicy,
});
```

- `generation` and `edit` are declared separately. A generation-only profile denies edit and an edit-only profile denies generation; neither implies the other. `resolveRoute`, `getConceptConfiguration` and dispatch all deny an undeclared operation with `operation_permission_denied` before any port, credential, or transport work.
- `edit.max_input_references` counts every `input_references` entry, the parent included. Edit with a parent plus manifest references, or concepts with their references, that exceed it are rejected with `unsupported_operation` before credential resolution.
- Every configuration key must be declared in `supported_parameters` and its value must be in the declared enum or range. Transparent background requires a pinned `png` or `webp` output; `output_compression` requires a pinned `jpeg` or `webp` output. Undeclared keys, SVG, and out-of-range values are rejected at construction.
- The entire profile (model, provider tag, capabilities, declared parameters, configuration) is hashed into `configuration_sha256`, and the target binding records `service: "openrouter"`, the exact endpoint, model, `provider_tag`, the pinned routing, the operation, and `operation_kind`.

## Wire contract

One `POST` with headers `authorization` and `content-type` only, `redirect: "error"`, `cache: "no-store"`, the request signal, and a JSON body of `model`, `prompt`, `n: 1`, `stream: false`, `provider`, the validated options (in a fixed order), and, for edit only, `input_references`.

- Generation sends no `input_references`.
- Edit sends the immutable selected parent first, then manifest references in manifest order, each as `data:<mime>;base64,...` built only from asset-port bytes that were checked against the manifest hash, format, and dimensions. A mask source is rejected. The adapter does not tell the model which reference is the parent; the host prompt renderer owns that wording, and OpenRouter does not document parent preservation.
- Concepts (parentless) send only the two authorized references. No parent is fabricated.

## Edit semantics and `operation_kind`

OpenRouter edit is **reference-guided image-to-image**. It is not the direct adapter's masked/parent edit. The target binding therefore records `operation_kind: "image_reference_edit"` (generation records the metered `image_generation`) plus `edit_semantics: "reference_guided"` and `metered_operation_kind: "image_edit"` (the unchanged C03 kind of the attempt). Until the owner accepts that reference-guided edit satisfies CE-07/ART-01 (G5), masked edit stays direct-OpenAI-only.

## Output validation and dimensions

The response must contain exactly one `data` item with canonical base64. It is decoded and inspected with the same bounded PNG/JPEG/WebP decoder the direct adapter uses (full pixel decode, 50 MiB and 16.7 megapixel limits). SVG, unknown formats, corrupt or oversize bytes, a second image, a data URL in place of base64, or a `media_type` that does not equal the decoded format (when present) reject the response with nothing published. A transparent request requires an alpha channel; a pinned `output_format` must equal the decoded format.

Dimension choice: OpenRouter models may not allow pinning an exact pixel size, so exact size is **not** required. Output must be between 16 pixels and the decoder maximum per side and within the pixel budget. If the profile pins `aspect_ratio` as `W:H`, the decoded size must match it within one pixel of rounding (`|w*H - h*W| <= max(W, H)`). `resolution` is only a request hint because the documentation does not define it in pixels. This is consistent with how the runtime and version store consume output: they use the dimensions decoded from the stored bytes (the bounded decoder result), never an adapter-declared size.

## Usage and cost

Usage is a raw allowlisted observation with `completeness: "unknown"` and `missing_fields`; the adapter maps `prompt_tokens` to `input_tokens` and `completion_tokens` to `output_tokens` so the existing normalized token profile can consume them, and keeps `total_tokens`, `cost`, `cost_details`, and `is_byok`.

- Missing `usage`, a missing counter, or a missing `cost` is listed in `missing_fields` (`usage`, `usage.cost`, ...) and is never zero. A reported zero stays distinct from absent.
- `cost` is preserved as `{amount, currency: "USD", provenance: "provider_reported_unsettled"}` with a decimal string of at most nine fractional digits. It is the provider's report only: it is never used as settlement, never converted to a rate, and never makes an observation complete. Finance must decide credits versus USD, BYOK, and the reconciliation source (G4).
- More than 32 usage fields, accessor-backed fields, or proxies are rejected; the bounded counters are kept as an observation and nothing publishes.
- The default usage profile maps nothing, so output stays unpublished and the C03 hold stays until an owner-supplied `usage_profile_authority` maps the observation. A usage map can mark an observation complete only when no field other than the adapter's `usage.profile_mapping_pending` marker is missing, so an absent `cost` keeps the hold.
- The private usage attribution table stores the same bounded record with the `cost` fields (OpenRouter rows only).

The Images response documents no generation or request id. The adapter does not read response headers for one, so the public provider request reference is **absent** (not fabricated) and no raw-id attribution row is created. Reconciliation against OpenRouter must be designed with Finance (G4).

## Errors

Every failure uses a fixed message and the existing error vocabulary. The error body, `message`, `metadata`, and in particular `metadata.flagged_input` are inspected locally for classification only and never copied. Requests are never retried and never fall back to another provider.

| Provider result | Code | Outcome | Notes |
| --- | --- | --- | --- |
| 400, other 4xx | `provider_request_failed` | failed | hard stop |
| 401 | `authentication_denied` | failed | hard stop |
| 402 | `provider_quota_exhausted` | failed | hard stop; no retry advice (OpenRouter documents `Retry-After` only for the in-flight budget limit) |
| 403 with moderation metadata | `moderation_blocked` | failed | hard stop; flagged input never retained |
| 403 otherwise | `operation_permission_denied` | failed | hard stop |
| 404 | `model_capability_unavailable` | failed | hard stop |
| 413 | `provider_request_failed` | failed | hard stop |
| 408, 524 | `provider_outcome_unknown` | unknown | hold retained |
| 429 | `provider_rate_limited` | failed | advisory retry decision only |
| 503 | `provider_request_failed` | failed | advisory retry decision only |
| 500, 502, 529 | `provider_request_failed` | failed | |
| other 5xx | `provider_request_failed` | unknown | conservative |
| HTTP 200 with `error` | classified by `error.code` as above; an unrecognized code is `provider_request_failed` / unknown | | the accompanying image is ignored |
| transport rejection after send, abort, deadline after send | `provider_transport_unknown` / `provider_outcome_unknown` | unknown | hold retained |

The advisory retry decision is `automatic_retry: false`; an eligible next attempt needs a fresh grant, capability and Finance authorization, a new billable identity, a new reservation and a new transport identity. A failed outcome reported by the adapter does not by itself release the C03 reservation: through the API the hold is still retained for reconciliation. The 500/529/429/503 "failed" classification follows the CE-03-OR issue; the documentation states non-billing only for 502, so Finance owner acceptance (G4) should confirm it.

## Credentials

The adapter never reads an environment variable and has no fallback to `OPENAI_*`, `OPENROUTER_API_KEY`, or the customer app's `TICKETSTUB_ART_OPENROUTER_API_KEY`. The trusted host injects the key through the credential port, which is bound to the tenant/project, the exact target binding, and the grant:

```text
CREATIVE_ENGINE_OPENROUTER_API_KEY   # placeholder host variable name; the host's secret loader reads it, never this package
```

That key must be a separate creative-engine key (G1). The adapter validates that the resolved credential binding names `service: "openrouter"`, the granted account/project references, the grant, and the target hash, and that it has not expired. The bearer token appears only in the single request header; it is never placed in an error, telemetry, evidence, or log. Tests assert this with a canary value.

## Runtime and store integration

The runtime, the concepts contract and the version store use an explicit allowlist (`src/models/image-routes.mjs`) instead of the hard-coded `"openai"` provider name and OpenAI edit endpoint. An entry names the exact provider, its exact endpoints, the concept mapping reference, and the target-binding operation kind of its edit. Every other check is unchanged and applies to both providers: scope, brief and rights, lineage, approval, lease and deadline, cancellation, the dispatch intent and final fence, Finance, and attribution. The `openai` entry keeps its exact previous values.

Store notes: private attribution tables accept only the allowlisted provider names; databases created with the older `CHECK(provider_name='openai')` are rebuilt in place (rows, keys, foreign keys and immutability triggers preserved; `user_version` is unchanged). Routed model ids with a slash (`author/slug`) are accepted for dispatch and attribution records. The `cost` fields are accepted in the private usage record only for OpenRouter rows; the direct OpenAI usage allowlist is unchanged.

## External gates that remain open

- G1. A creative-engine OpenRouter account or workspace, credits, key limits, and a separate key issued and injected by the trusted host.
- G2. Owner-selected model id and provider tag, with separately verified generation and edit/reference entitlement, and account-wide provider settings that do not override pinning.
- G3. Authorized, budgeted live smoke for generation and for edit (separate grants) with sanitized evidence.
- G4. Finance/C03 acceptance of reported `cost` semantics (credits versus USD, BYOK, reconciliation source) and of the missing generation id.
- G5. Owner acceptance that reference-guided edit satisfies CE-07/ART-01.
- G6. Deployment host composition, secret storage, and native codec qualification (tracked in getticketstub.com#27).

## Verify

```sh
make build
make check TARGET=openrouter-image-adapter MODE=mock
make check TARGET=openrouter-image-adapter MODE=live   # exits 2, zero dispatches, reads no credential
make check TARGET=image-adapter MODE=mock
make check TARGET=all MODE=mock
```

The mock target runs the intercepted adapter, API/C03/CE08/CE11 integration, store tests and the strict `creative-engine/models` type check on the Node 22.23.3 and 24.15.0 matrix. Its evidence file is an input inventory, not a test receipt. Mock success is not live evidence.
