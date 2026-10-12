# Offline generation/edit API fixtures

This repository-owned interface answers the [IE-07 dependency request](https://github.com/Jevelopers-neatHack-2026/creative-engine/issues/12#issuecomment-6128374845) from [integration-evals #17](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/17). It runs the existing public Creative API, durable version/API ports, telemetry outbox and native OpenAI Images adapter against intercepted synthetic transport and authority ports. It produces actual API envelopes and retained image bytes for an evaluator to inspect. It is a local fixture interface, not a shared-contracts schema or an external acceptance decision.

## Command and prerequisites

Use a checkout of the exact reviewed Creative commit, Node **22.23.3** or **24.15.0**, and its locked dependencies. The native image decoder must be installed from `src/models/codec-runtime/package-lock.json`; use the repository bootstrap procedure in an authorized environment. Running this fixture does not install dependencies, read provider credentials, contact a provider, or spend money. The fixture helper requires an explicit intercepted `fetchImpl`; it cannot fall back to ambient `fetch`.

From the checkout root:

```sh
mkdir -p build
node scripts/creative-api-fixture.mjs --scenario all --out build/ie07-offline-packet-node22
```

The equivalent npm entry point is:

```sh
npm run fixture:creative-api -- --scenario missing-usage --out build/ie07-missing-usage-node22
```

`--out` must name a **new directory** whose parent already exists. The command refuses an existing directory, file or symlink. It never overwrites or deletes a previous packet. Use a different path for each revision/runtime/repeat, and retain earlier failures. Absolute output paths are also supported. The CLI creates directories with mode `0700` and files with mode `0600`, subject to the host filesystem's semantics.

Exit `0` means every requested fixture reached its declared expected outcome. A structured negative API result can be an expected fixture outcome. Exit `1` means invalid invocation, unavailable prerequisites, failed fixture assertions, source changes during execution, or another command failure. If execution fails after the output directory is created, partial outputs and `failure.json` remain available. A missing scenario packet is not a pass.

CI runs all scenarios on both pinned Node versions and retains `build/ie07-offline-fixture/` in the Creative API evidence artifact. A CI upload or passing producer fixture alone is not an integration-evals consumer ACK.

## Scenario controls and expected boundaries

Each scenario first generates a parent through the native adapter, then requests an edit of that exact immutable version using one authorized synthetic reference. Generation and edit share a journey correlation ID while retaining distinct action, job, billable-attempt, reservation and transport identities. Fault injection targets the **edit**; generation is the successful baseline.

| `--scenario` | Intercepted edit behavior | Expected public API / publication | Synthetic financial evidence |
|---|---|---|---|
| `success` | One valid PNG plus bounded usage | Completed edit; two immutable versions with exact parent link | Two mapped observations and settlements |
| `malformed-output` | Valid JSON containing bytes that are not an image, with bounded usage | Structured `unavailable`; parent remains the sole published version | Supplied usage remains mapped and the failed attempt settles; no successful artwork is fabricated |
| `empty-output` | Empty `data` array with bounded usage | Structured `unavailable`; no child publication | Same known-usage failed-attempt behavior |
| `timeout-ambiguous` | `TimeoutError` after the actual local dispatch acknowledgement | Structured `unavailable`; no child publication or automatic retry | No fabricated provider usage/receipt; reservation held for reconciliation |
| `refusal` | HTTP 400 with a synthetic `content_policy_violation`, without usage | Structured `unavailable`; refusal body retained; no child publication | No fabricated usage observation; reservation held for reconciliation |
| `missing-usage` | Valid image without a `usage` field | Structured `unavailable`; response retained but no child publication | Actual unknown observation and reconciliation hold |
| `duplicate-response` | Successful edit followed by the identical completed API request | Exact durable result with `replayed: true`; no extra publication | No duplicate native dispatch, reservation, observation or settlement |
| `cancellation-late-completion` | Hold edit response, invoke public API cancellation, then return the late response | Actual cancellation envelope and structured `cancelled` edit; late bytes remain unpublished | Actual partial observation and reconciliation hold |
| `unsupported-settings` | Unsupported edit-plan parameter | `invalid_request` before edit reservation or transport | Only the baseline generation is reserved and settled |

`duplicate-response` exercises public API response replay; it does not invent a provider webhook/delivery protocol. `timeout-ambiguous` is an intercepted transport failure after acknowledgement, not evidence of a real remote timeout. `unsupported-settings` covers the public edit-plan schema; it is not a claim about every model configuration. No image quality, mask geometry, style Apply, approval, production handoff, external Finance or live-provider criterion is cleared by these scenarios.

## Retained packet and immutable inputs

The output directory contains:

- `source-inputs.json`: exact Git commit/tree, observed worktree status, source/fixture file hashes, a canonical input-manifest digest, exact Node executable hash, Node/SQLite/platform/architecture and locked decoder package details. The command compares source identity and input hashes again after execution. Runtime dependency directories are excluded from source file inventories; their lockfiles remain included.
- `index.json`: one result per requested scenario, with separate fixture outcome and expected API outcome, plus packet file hashes.
- `<scenario>/packet.json`: actual API requests/responses, correlated preparation/transport identities, selected model/configuration, permission verifier inputs/results, Finance fixture events, available usage or its actual absence, durable job/private attribution projections, and published DesignVersion metadata.
- `<scenario>/*.png` and response JSON: exact immutable published image bytes, exact multipart parent/reference input bytes and intercepted response bodies. The packet binds every file by hash. A returned response image can remain unpublished after a failure or cancellation.
- `manifest.json`: exact byte length and SHA-256 for each retained output file other than the manifest itself. The command prints the manifest SHA-256 in its final JSON receipt.

The candidate model is `gpt-image-2.5-sunburst-2026-09-08`; the fixture configuration is `quality=low`, `size=16x16`, `output_format=png`, `background=opaque`, `moderation=auto`. This is an explicit **synthetic fixture pin**, not an owner selection or evidence of model entitlement. Generation and edit responses contain deterministic locally generated opaque PNGs with distinct blue-channel values, so their output byte hashes differ. The synthetic source assets, permission proofs, capability/credential ports, Finance replies and mock usage-profile mapping all retain explicit provenance. Even the synthetic credential token is omitted from the packet. Synthetic receipt IDs are identified as synthetic; an absent receipt or usage observation is left absent.

The temporary SQLite/object directory is unique to each scenario and is closed and removed before a successful fixture returns. Only the caller-owned packet directory remains. The command does not clean up earlier packets, install dependencies, provision credentials or modify foreign repositories. An unexpected failure preserves available diagnostics and still closes/removes the owned temporary store.

## Module consumers

An evaluator with a pinned checkout can call the same scenario composition without importing a test file:

```js
import { runCreativeApiScenario } from "./fixtures/models/creative-api-scenarios.mjs";

const { packet, files } = await runCreativeApiScenario({ scenario: "missing-usage" });
// packet contains actual API results; files is Map<relativeName, Buffer>.
// The temporary SQLite/object directory is already closed and removed.
```

`fixtures/models/creative-api-fixture.mjs` also exports the setup shared by the existing API integration tests: `createCreativeApiFixture`, `createNativeProvider`, `mockOwnerUsageProfileAuthority`, and request helpers. `createCreativeApiFixture()` returns the actual `api`, `ports`, `store` and trusted fixture inputs; always `await fixture.close()` in `finally`. Its initial provider is the legacy synthetic seed provider used by existing tests. Use `createNativeProvider` with an explicitly intercepted fetch and install the shared mock usage authority to exercise the native image path, or use the complete scenario composition above. If a caller supplies a root, it remains caller-owned: `close()` closes the store and leaves that directory intact for deliberate recovery/cleanup. Do not point this helper at customer or production data.

These modules are repository fixtures, deliberately absent from the production npm exports/package. The installed Concepts consumer copies the shared setup byte-for-byte alongside its fixtures and resolves runtime imports through the installed public package. The existing integration suite retains its original assertions and uses the same shared setup.

## Review and acceptance

Verify with `node --test tests/models/creative-api-fixture-consumer.test.mjs`, the full `make check TARGET=image-adapter MODE=mock`, `make build`, and `make check TARGET=concepts MODE=mock` for the installed Concepts package consumer. Producer-side consumer tests validate packet bytes, parent links, correlation, usage/hold behavior and safe output handling. They do not substitute for an independently executed integration-evals validator.

Refs [creative-engine #12](https://github.com/Jevelopers-neatHack-2026/creative-engine/issues/12), [#11](https://github.com/Jevelopers-neatHack-2026/creative-engine/issues/11), and [integration-evals #17](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/17). Creative review/adoption of the exact source and integration-evals ingestion/ACK remain distinct decisions. Real provider/rights/Finance authority, recorded live-origin evidence and exact externally approved handoff remain with their accountable owners; this fixture does not close those gates.
