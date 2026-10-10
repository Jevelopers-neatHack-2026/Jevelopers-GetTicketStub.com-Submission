# Provider access readiness

This runbook describes the local, stdlib-only prerequisite profile for ACV1-ACCESS. It records provider configuration and sanitized account evidence. It does not implement provider calls, replace shared-contracts, or verify the complete Agent & Creative v1 acceptance gate.

## Run the offline profile check

From the repository root:

```sh
python3 tools/verify_provider_readiness.py --profile fixtures/provider-profile.json --mode offline
```

The committed fixture is intentionally incomplete. A valid fixture with pending external prerequisites prints deterministic JSON and exits `2`; that is the expected result for this fixture. `network_accessed` is always `false` for the current tool. The report includes the fixture ID, component Git revision and dirty-tree indicator, independent capability cells, blocked consumers, owner role, next action, evidence still needed, dependency mode, and typed diagnostics.

Exit codes:

| Code | Meaning |
| --- | --- |
| `0` | Reserved for a future reviewed readiness result; this prerequisite-only version does not emit it. |
| `1` | Profile is invalid, unsafe, unsupported, or has mismatched identity evidence. |
| `2` | Profile is well-formed but access, eligibility, configuration, or downstream live evidence remains pending or denied. |
| `3` | Requested metadata or live mode is unsupported; no provider request was made. |

CI expects exit `2` from the pending fixture and separately requires the offline adversarial suite to pass. After both checks pass, it uploads the sanitized JSON report as a seven-day `provider-readiness-report` artifact. Passing those tests establishes only that the local validator handles its inputs as specified.

## Credential handling

The checker accepts only environment-variable reference names. It enumerates process-environment names and checks the name set; it never indexes, prints, hashes, or logs credential values. It does not load `.env` files. A credential reference that is blank, malformed, or a placeholder is rejected. Presence is not authentication: the checker cannot distinguish an empty environment variable from a non-empty one, and it does not claim that a key is valid or entitled for an operation.

The fixture records `TYPESAFE_API_KEY` as the TypeSafe server-injection name from the assigned packet. Account/project identity, value, and entitlement remain unknown. Do not add key values or customer records to a profile, test, CI variable, report, issue, or commit.

The offline check rejects unknown fields, inline credential fields, non-HTTPS or non-allowlisted endpoints, unsupported provider/model identifier forms, unapproved moving aliases, stale identity evidence, and account/project/model mismatches. Diagnostic messages do not echo rejected values. The provider endpoint allowlist is local verifier policy; it is not a domain contract.

## Modes

### `offline`

Reads only the specified local profile. It makes no network calls and does not infer account eligibility, authentication, inference, image generation, sponsor availability, or metering from configured names or fixture data.

### `metadata`

Currently returns `METADATA_MODE_UNSUPPORTED` and exit `3`. No authorized nonbillable metadata adapter or account context is established here, so it makes no request even if a credential variable happens to exist. The profile format can record a future sanitized metadata result, including its exact endpoint, account/project identity, requested model where applicable, revalidation dates, and an external evidence reference. A model-list or authentication observation remains separate from a successful inference/image run.

### `live`

Currently never dispatches a request. Without external authorization and a reservation reference it returns `LIVE_AUTHORIZATION_MISSING`; with those records it still returns `LIVE_EXECUTOR_UNSUPPORTED`. No reservation protocol, authority, amount, price, or spend target is invented here. A future live implementation requires a separately reviewed authorization path and may not use subscription access as an API billing fallback.

## Independent capability cells

The profile keeps these v1 obligations separate:

- **JEV:** TypeSafe API configuration and account eligibility. The official API requires an explicit model and reports the resolved model in inference responses. The model guide documents moving aliases; the current documented `jev-1.13.0` is reference material only and is not selected in the fixture. A model listing does not prove versioned inference access.
- **GPT Image engine integration:** API family, endpoint, model/snapshot, organization/project access, and the actual creative-engine generation receipt remain unselected or pending. No API billing route is chosen.
- **Codex development image execution:** The explicit preference is `codex_subscription` through Codex built-in image generation with `gpt-image-2`. OpenAI's current Learn page says built-in image generation uses `gpt-image-2` and counts toward general Codex usage limits; availability and limits depend on plan and workspace settings. This development execution surface does not configure a creative-engine API adapter, establish organization API eligibility, create a metering record, or satisfy the actual image-generation acceptance gate.
- **Planner/reasoning provider and generative evaluation baseline:** Each has its own unselected provider, endpoint, model, account/project, quota, owner-approved future usage budget, and live-test owner. Neither is inferred from GPT Image or JEV access.
- **Neatlogs:** Workspace and scoped access remain pending. SPN-01 requires an actual Neatlogs artifact tied to an evaluated application run; documentation and key presence are not that artifact.
- **Entire:** Applicability/configuration and actual provenance remain pending. SPN-02 requires a real checkpoint or repository provenance artifact linked to relevant component revisions; a local profile or ordinary Git commit is not that artifact.

Each capability records its own environment, billing mode, and quota status/evidence. Those values remain unknown in the committed fixture. Planner/reasoning and the generative baseline also have separate pending budget and reservation-protocol references and a live-test owner role. No numeric spend target or API billing fallback is selected here.

The report distinguishes configuration status, administrator eligibility, metadata observation, and downstream live-capability evidence. `observed` means an external record is entered in the profile; this checker does not independently authenticate the record or the account. A downstream implementation leaf owns its actual provider/sponsor receipt.

## Evidence references reviewed

Provider documentation was inspected on 2026-10-10. These sources explain interfaces and documented behavior, not account entitlement or live service availability:

- TypeSafe [API reference](https://docs.typesafe.ai/api) and [models](https://docs.typesafe.ai/models): explicit request model; response model identity; account model listing and aliases.
- OpenAI [API image generation guide](https://developers.openai.com/api/docs/guides/image-generation) and [Codex/ChatGPT Learn image generation](https://learn.chatgpt.com/docs/image-generation): API generation is a programmatic path; built-in Codex generation uses `gpt-image-2`, counts against general Codex usage limits, and has plan/workspace-dependent availability.
- Neatlogs [Public API](https://docs.neatlogs.com/api-reference) and [quickstart](https://docs.neatlogs.com/docs/quickstart/introduction): scoped service-account/project context and application trace instrumentation are documented; this repository has no confirmed workspace or actual trace.
- Entire [CLI documentation](https://github.com/entireio/cli) and [security/privacy notes](https://github.com/entireio/cli/blob/main/docs/security-and-privacy.md): checkpoints carry agent session context in repository storage; this repository has no confirmed installation/configuration or sponsor artifact.

The authoritative acceptance meanings and owner roles remain in `integration-evals/planning/acceptance-checklist.json`. The maintained shared-contract catalog is design documentation, not an implemented schema. This runbook/profile does not copy or replace canonical domain contracts. CON-03, SPN-01, and SPN-02 remain owned and evaluated as the central checklist specifies; this prerequisite contribution cannot verify those global criteria.
