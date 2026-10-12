# Prodigi callbacks and authenticated reconciliation

**Status:** implemented and covered by offline fixtures only. Callbacks are disabled by default. Nothing has been registered with Prodigi, no callback has been received from Prodigi, and no request has been sent to Prodigi. Live mode is refused.

Tracker: getticketstub.com #27 ("supplier callback authenticity, replay protection and authenticated reconciliation/polling") and [FC-07](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/13). This module builds on the [Prodigi sandbox adapter](prodigi-sandbox.md).

## What Prodigi documents

From the public v4 reference, [Callbacks](https://www.prodigi.com/print-api/docs/reference/#callbacks) and [Order object](https://www.prodigi.com/print-api/docs/reference/#order-object) (checked 2026-10-11):

- Callbacks go to a public URL set globally in the dashboard's merchant settings, or per order through `callbackUrl` ("Your callback URL, where we send callback events"). They are sent when an order's stage changes or a shipment is made.
- Each callback is a CloudEvents 1.0 JSON object. `id` is unique and starts with `evt_`. `type` starts with `com.prodigi` (for example `com.prodigi.order.status.stage.changed#InProgress`). `subject` is the order ID. `time` is when the event was generated, which "may differ from the actual delivery time … because callbacks are queued". `data` is "the complete order object at the point the callback was created".
- **The reference documents no callback signature, HMAC, signing secret, authentication header, source IP list, or retry policy.** Prodigi callbacks are therefore unsigned, and this module never treats a callback as provider-authenticated.
- `GET /v4.0/orders/{prodigi_order_id}` with the `X-API-Key` header is the authenticated read. The response echoes `callbackUrl`.

## Trust model

| Step | What it proves | Implementation |
| --- | --- | --- |
| 1. URL capability token | The sender knows the token in the callback URL that the host registered. Anonymous internet traffic is rejected. It does **not** prove the sender is Prodigi: the URL is visible to anyone who can read the order through the API, and to logs on the path. | The host's HTTP handler extracts the token from the URL and passes it as `presentedToken`. The server-held value is resolved at call time through `withServerSecret` and a `ServerSecretSource`, then compared in constant time over SHA-256 digests. A missing value, or one shorter than 32 characters, fails closed (`callback_token_unavailable`). A missing or wrong token is `callback_forged`, before any claim, store read or provider read. |
| 2. Untrusted hint | Nothing about order state. | `parseProdigiCallbackEvent` keeps only `id`, `subject`, `type` (and the stage named by a `stage.changed#` type) and `time`. `data` is only checked for a matching `id`; the recipient and everything else are discarded unread. Intake goes through the existing `ingestProviderCallback` with no verifier, so the observation is `unverified` with `authoritativeMutationAllowed: false`. |
| 3. Authenticated read | The order's state. | `reconcileOrder` reads the order through `ProdigiSandboxClient.getOrder`, which carries every sandbox gate (calls enabled, verified owner decision, sandbox credential via `prodigi/sandbox/api-key`). Only this read can change stored state. |

The callback token is **host-injected configuration**. This repository predeclares no binding, reference name or environment variable for it. The host supplies a sandbox-class `SecretReferenceBinding` (whose variable name must contain a `SANDBOX` token, under the existing resolver rules) and passes its reference as `callbackTokenReference`. The tests use a test-only binding.

## Replay, duplicates and ordering

`ProdigiReconciliationStore` is the idempotency and state port:

- `claimEvent` is keyed on trusted scope (tenant and project), order ID and event ID. A repeat is `replayed`, even when the body changed. A new event ID with an already-claimed event `type` for the same order is `duplicate_status`. Neither one triggers a read. Scheduled polling still covers anything a coalesced event might have signalled, such as a second shipment.
- Callbacks for an order the application did not register with `trackOrder` are `untracked_order` and trigger no read.
- A hint that names an earlier stage than the reconciled one (for example `InProgress` arriving after `Complete`) is `stale_hint`. A hint for an order already in a terminal stage is `already_terminal`. Neither triggers a read.
- `decideProdigiOrdering` gates every authenticated read before it is written:
  - The same content is `unchanged`.
  - A strictly older `lastUpdated` is `stale`.
  - Moving from `Complete` or `Cancelled` back to `InProgress`, any step going backwards (`NotStarted` < `InProgress`/`Error` < `Complete`), or a previously seen shipment disappearing is `regression`.
  - `Complete` versus `Cancelled` is a `terminal_conflict`. The conflict is recorded and the stored stage is kept, because a timestamp never selects the winner.
- Writes use compare-and-set on a revision. On contention the decision is re-evaluated against the fresh state (up to four rounds), then fails as `store_unavailable`.

`createInMemoryProdigiReconciliationStore` is a single-process reference for tests and local development. It is not durable and is not atomic across processes.

## Polling

`reconcileOrder(orderId)` works with callbacks disabled, so it can serve as scheduled polling. Only `rate_limited`, `provider_unavailable` and `timeout` are retried. The delay before attempt n+1 is `min(maxDelayMs, initialDelayMs × 2^(n−1))`:

| Setting | Default | Bounds |
| --- | --- | --- |
| `initialDelayMs` | 1000 | 1–60000 |
| `maxDelayMs` | 60000 | `initialDelayMs`–300000 |
| `maxAttempts` | 5 | 1–10 |

When all attempts fail with a retryable error the result is `retries_exhausted`. Any other failure, such as `authentication_failed`, `not_found`, `invalid_response`, `sandbox_calls_disabled` or `decision_unverified`, stops at once as `read_failed`. A read whose order ID differs from the requested one is not applied. Failures never change the stored state.

## Gates

- `mode` must be `"sandbox"`. `"live"` throws `live_refused`, and any other value throws `invalid_config`.
- `callbacksEnabled` must be exactly `true` (the default is off). Otherwise `handleCallback` throws `callbacks_disabled` without reading a secret or the body. Enabling it requires `secrets` and `callbackTokenReference`.
- The raw body limit defaults to 512 KiB, with a 1 MiB maximum.
- Errors use fixed codes and messages. Results contain no token, API key, recipient or raw body.

## Shared change

The callback ID pattern in `ingestProviderCallback` now allows `_` after the first character. Without it, Prodigi's documented `evt_…` and `ord_…` IDs would be rejected. The rest of the pattern is unchanged.

## Tests

`npm run test:prodigi-callbacks` (also part of `npm test`) runs `tests/prodigi-callback-suite.mjs`. It replaces `globalThis.fetch` with a guard and asserts zero network use. Provider reads go through the real `ProdigiSandboxClient` over a recording HTTP port. The suite covers:

- disabled-by-default and live refusal
- bounded configuration
- CloudEvent parsing, malformed events and PII discard
- forged, missing and weak tokens
- callback content never applied
- untracked orders and oversized bodies
- replayed and duplicate callbacks, and scope isolation
- reordered callbacks after `Complete`
- stale, regressed and terminal-conflict reads
- backoff, attempt exhaustion and non-retryable stops
- compare-and-set contention and store failure

The CloudEvent bodies are synthetic, not recordings.

## Not done

1. **A durable, cross-process store.** Back `ProdigiReconciliationStore` with atomic persistence, for example on the existing durable JSON store pattern, and wire reconciled observations into `LocalStatusStore` through its `TrustedStatusLookup` port.
2. **The host HTTP route.** Extract the token from the path, enforce TLS and the body limit before buffering, and return 2xx for `replayed` and `duplicate_status` so Prodigi stops redelivering. Prodigi's redelivery behavior is undocumented.
3. **Callback registration.** Order creation still sends no `callbackUrl`, and nothing is set in the dashboard. Registering a URL is an owner step, and it needs the token secret provisioned first.
4. **Confirming the wire format.** Check event `type` values (shipment events beyond the documented example), `time` precision and redelivery against an owner-approved sandbox order, then replace the synthetic bodies with sanitized recordings.
5. **Provider-side authenticity.** If Prodigi ever documents signing, implement it as a `CallbackVerifier`. Until then, callbacks stay unverified hints.
6. Live mode stays out of scope.
