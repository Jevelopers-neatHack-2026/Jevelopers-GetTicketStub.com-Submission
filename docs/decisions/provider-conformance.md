# JEV provider wire conformance

**Status:** Phase A private wire prerequisite; synthetic/offline evidence only. This note does not close AH-05, approve a model/account, enable live execution, or satisfy Finance, tenant-authorization, shared-contract, engine, or release gates.

## Phase A boundary

`src/adapters/jev/` contains private TypeSafe request/response validation, one fixed-target HTTP send, retry recommendation data, and immutable in-memory usage observations. Nothing in this directory is exported by the package entrypoint or installed in an engine/default execution path. The runtime continues to reject `mode: "live"`.

Every fixture and controlled HTTP/DNS response under `tests/fixtures/jev/` is synthetic. Tests replace DNS resolution and `https.request`; they do not contact TypeSafe or another external service. The API key supplied to the private send helper is an explicit internal argument. There is no `.env` reader or credential loader in this phase, and no real credential or spend authority was used.

`createLocalAttemptObservation` returns an immutable object with a random local observation ID and separate logical-operation, opaque billable-attempt, and transport-attempt references. Its `persistence: "memory_only"` label is deliberate. It is neither a durable usage record nor a Finance event, reservation, grant, settlement, or proof that a failed/unknown request incurred no charge.

Phase B must bind dispatch to the assigned canonical authorization/reservation and attempt identities, persist intent before any provider write, persist usage-or-unknown evidence in the existing SQLite store, and prove atomic migration plus process crash/restart and outbox behavior. Phase A adds no journal, database, store extension, or alternate persistence path. Until that integration is reviewed and transferred, the private transport must not be composed into application execution.

## TypeSafe wire target and source facts

The fixed request target is `POST https://api.typesafe.ai:443/v1/systemone` with Bearer authorization and `application/json`. The request body is exactly `{ model, state, questions }`. The response envelope requires `{ model, answers, usage }`; usage contains integer `input_tokens` and `output_tokens`. The response model must match the requested model. The current explicit wire fixture identity is `jev-1.13.0`; this is not a product-selection approval. Moving aliases such as `jev-latest` and `jev-preview` are rejected.

The API documents text-only state as a string, object, or array. Question instructions and structured descriptions can also be strings, objects, or arrays. Noul criteria may describe `true` and/or `false`; Choice criteria are a map with at most 255 options and nullable structured descriptions, with the local validator requiring at least one option; Score criteria are an ordered array of 2–10 structured descriptions.

Questions in one request are evaluated independently against the same state. A later question cannot see a sibling answer from the same request. The wire adapter cannot infer semantic dependencies from arbitrary instructions. A dependent question must be built as a later request after code receives the earlier response; Phase B still needs the canonical durability boundary before claiming that answer is durable.

Sources checked 2026-10-10:

- [TypeSafe API reference](https://docs.typesafe.ai/api)
- [Models](https://docs.typesafe.ai/models)
- [Choice](https://docs.typesafe.ai/primitives/choice)
- [Score](https://docs.typesafe.ai/primitives/score)
- [Noul](https://docs.typesafe.ai/primitives/noul)
- [Question primitives and batching](https://docs.typesafe.ai/primitives)
- [Confidence semantics](https://docs.typesafe.ai/confidence)
- [JavaScript SDK RetryPolicy](https://docs.typesafe.ai/sdk/javascript/api/interfaces/RetryPolicy)

These documents specify wire behavior only. They do not verify account eligibility, live access, idempotency, no-charge error semantics, reservations, or spending authority.

## Validation and bounded parsing policy

Requests are snapshotted from own enumerable data properties only. Proxies, accessors, symbols, cycles, non-finite numbers, unsupported values, and caller `toJSON` behavior are rejected without invoking getters or serializers. The snapshot uses null-prototype maps, then serializes only the bounded copied data.

The local request ceiling is 256 KiB; response bytes are capped at 512 KiB while streaming. The parser bounds nesting to 48, JSON nodes to 12,000, object keys to 4,096, string units to 262,144, and array items to 4,096. UTF-8 decoding is fatal; duplicate JSON members, BOMs, trailing data, non-JSON numbers, and oversized/deep values fail closed. These byte/structure limits are local safety bounds; they do not prove TypeSafe's documented token-context limits.

The response requires an exact model and answer-ID set. Unknown envelope/answer fields fail conformance. Choice must be one of the requested options and have the complete requested distribution, with the selected option at the maximum probability (ties are accepted). Score must have exact zero-based legend/probability keys, a structurally equal description at each level, a finite fractional value in `[0, levelCount - 1]`, and a weighted value consistent with the returned distribution. Every probability and Choice/Score confidence must be finite and in `[0,1]`. No confidence is recomputed or inferred. Noul accepts `[0,1]` including `0.5` and rejects a separate confidence field.

The documented API summary describes Score `legend` values as strings, while the detailed Score documentation permits structured level descriptions and presents matching legends. The validator preserves structured JSON values and checks structural equality by key/value rather than coercing objects to strings. This conservative choice is synthetic-only until live conformance is separately authorized and recorded.

Numerical safety tolerances are local policy, not provider guarantees:

- Probability totals may differ from `1` by at most `0.01` to allow rounded decimal serialization; all members and exact keys are still required.
- Returned Score may differ from its probability-weighted index by at most `0.02` for rounding.
- Choice's selected probability must be within `1e-12` of the maximum so exact ties remain valid despite binary floating-point representation.

Boundary tests cover accepted and rejected values around the first two tolerances. Live fixtures may require a reviewed tolerance change; no automatic adjustment occurs.

Usage is validated independently of answer conformance. If answers are malformed but both token counts are valid safe integers, the local validation result retains that usage with an invalid decision status. Missing or invalid usage is explicitly `unknown`, never fabricated as zero. A malformed/duplicate JSON document cannot safely yield usage, so its observation is unknown. Provider request IDs are optional bounded opaque metadata and never the local observation identity.

## Fixed-surface transport and recovery recommendation

The private transport accepts only a validated wire request, an API-key value, and an optional native `AbortSignal`. It fixes HTTPS, host, port, path, method, headers, SNI, certificate verification, and TLS minimum internally. It does not accept endpoint, host, method, header, proxy, TLS, redirect, retry, or network-injection settings from request/profile/state data. It does not fetch URLs found in the request state.

Before creating an HTTPS request, it resolves A and AAAA once, rejects the destination if any result is not public global unicast, and pins the selected vetted IP in the HTTPS lookup callback. Loopback, private, link-local, unspecified, multicast, documentation, benchmarking, mapped, transition, and other special-purpose ranges are rejected. TLS hostname verification remains for `api.typesafe.ai`; a fresh private Agent avoids environment/global-agent routing. Redirects are not followed.

One monotonic 8-second budget covers DNS, connect, TLS, request write, headers, and body. Abort/deadline tears down DNS/request/socket work and listeners. An abort before the HTTP body write is `not_dispatched`; after a possible write it is an unresolved/unknown dispatch. Response headers are capped at 128 entries and 16 KiB; body bytes are capped during streaming. Non-200 error bodies are discarded, and safe results carry only status, bounded Retry-After, and a sanitized optional provider request ID. The helper issues one HTTP request at most.

`planJevRetry` is pure recommendation data. It proposes at most one additional attempt for 429/529, applies bounded exponential fallback delay starting at 250 ms, respects valid Retry-After seconds/dates, and returns `defer` when the delay exceeds policy or the remaining deadline. An invalid/missing header uses the bounded fallback. It stops on 401/422, exhausted attempts, or pre-dispatch cancellation. 408, other 5xx, timeouts, connection resets, interrupted bodies, and possible-write cancellation stay in review because they do not establish a free attempt. Every result has `dispatchAuthorized: false`; no retry is automatically sent.

## Offline evidence and pending obligations

Run the owned contract suite directly because Phase A does not own `package.json`, `Makefile`, or workflow integration:

```sh
PATH=/Users/completetech/.cache/acv1-toolchains/node-v22.23.3-darwin-arm64/bin:$PATH \
  node --test --test-concurrency=1 tests/decisions/jev-adapter.contract/*.test.js
```

The test names identify `wire_positive`, `wire_adversarial`, `batch_semantics`, `fixed_surface_ssrf`, `deadline_cancel`, `retry_faults`, `durable_evidence`, `privacy_identity`, and `gates`. The durable-evidence tests cover immutable local identity only; they explicitly do not pass crash/reopen, intent, stale lease, or outbox acceptance. That group remains pending Phase B. CI integration and the repository's normal test/build/type commands remain separately required.

No AH-05/JEV, Finance, contract, provider-account, tenant-authorization, engine-injection, evaluation, live, or release gate is closed by these private modules or fixtures. Required downstream artifacts include canonical shared-contract request/result/error/version fixtures and consumer acknowledgment; Finance-approved reservation/attempt-binding and known/unknown usage reconciliation contracts; server-derived tenant authorization; provider account/model/client eligibility evidence plus separately authorized spend; and evaluation-owned thresholds/held-out results. Full AH-05 and downstream handoffs remain open.
