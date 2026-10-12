# Prodigi callbacks and authenticated reconciliation

**Status:** implemented and covered by offline fixtures only. Callbacks are disabled by default. Nothing has been registered with Prodigi, no callback has been received from Prodigi, and no request has been sent to Prodigi. Live mode is refused.

Tracker: getticketstub.com #27 ("supplier callback authenticity, replay protection and authenticated reconciliation/polling") and [FC-07](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/13). This module builds on the [Prodigi sandbox adapter](prodigi-sandbox.md).

## What Prodigi documents

From the public v4 reference, [Callbacks](https://www.prodigi.com/print-api/docs/reference/#callbacks) and [Order object](https://www.prodigi.com/print-api/docs/reference/#order-object) (checked 2026-10-11):

- Callbacks go to a public URL set globally in the dashboard's merchant settings, or per order through `callbackUrl` ("Your callback URL, where we send callback events"). They are sent when an order's stage changes or a shipment is made.
- Each callback is a CloudEvents 1.0 JSON object. `id` is unique and starts with `evt_`. `type` starts with `com.prodigi`. The only complete type string on the page is `com.prodigi.order.status.stage.changed#InProgress`. `subject` is the order ID. `time` is when the event was generated, which "may differ from the actual delivery time … because callbacks are queued". `data` is "the complete order object at the point the callback was created".
- The order stages are `InProgress`, `Complete` and `Cancelled`. **No shipment event type string is documented.**
- **The reference documents no callback signature, HMAC, signing secret, authentication header, source IP list, retry or redelivery policy.** Prodigi callbacks are therefore unsigned, and this module never treats a callback as provider-authenticated.
- `GET /v4.0/orders/{prodigi_order_id}` with the `X-API-Key` header is the authenticated read. The response echoes `callbackUrl`.

## Trust model

| Step | What it proves | Implementation |
| --- | --- | --- |
| 1. URL capability token | The sender knows the token in the callback URL that the host registered. Anonymous internet traffic is rejected. It does **not** prove the sender is Prodigi: the URL is visible to anyone who can read the order through the API, and to logs on the path. | The host's HTTP handler extracts the token from the URL and passes it as `presentedToken`. The server-held value is resolved at call time through `withServerSecret` and a `ServerSecretSource`, then compared in constant time over SHA-256 digests. A stored token that is missing, shorter than 43 or longer than 512 characters, or outside printable ASCII (`[\x21-\x7E]`) fails closed as `callback_token_unavailable`. A missing or wrong presented token is `callback_forged`, before any store access or provider read. |
| 2. Untrusted hint | Nothing about order state. | `parseProdigiCallbackEvent` keeps only `id`, `subject`, `type` (and the stage named by a `stage.changed#` type) and `time`. `data` is only checked for a matching `id`; the recipient and everything else are discarded unread. Intake goes through the existing `ingestProviderCallback` with no verifier, so the observation is `unverified` with `authoritativeMutationAllowed: false`. |
| 3. Authenticated read | The order's state. | Reads go through `ProdigiSandboxClient.getOrder`, which carries every sandbox gate (calls enabled, `sandbox_call_permitted` policy for `PRODIGI_SANDBOX_ADAPTER_ID`, verified owner decision, sandbox credential via `prodigi/sandbox/api-key`). Only this read can change stored state. |

The callback token is **host-injected configuration**. This repository predeclares no binding, reference name or environment variable for it. The host supplies a sandbox-class `SecretReferenceBinding` (whose variable name must contain a `SANDBOX` token, under the existing resolver rules) and passes its reference as `callbackTokenReference`. The tests use a test-only binding.

### Token requirements and rotation

- Generate the token from at least 256 bits of CSPRNG output, for example 32 random bytes encoded as base64url (43 characters). The 43-character floor is a length check only: it cannot measure entropy, so the generator is what matters.
- Because Prodigi echoes `callbackUrl` in order reads, treat the token as exposed to anyone with order read access. Rotate it on a schedule and after any suspected exposure:
  1. Provision the new value under a new secret reference. Configure it as `callbackTokenReference` and move the old reference to `previousCallbackTokenReference`. Both are accepted, and results report `tokenGeneration: "current"` or `"previous"`.
  2. Update the dashboard callback URL, and any per-order `callbackUrl` the application sets, to the new token.
  3. Watch for `tokenGeneration: "previous"`. Orders created before the switch keep their old per-order `callbackUrl`, so keep the previous reference until those orders are terminal or have passed the replay TTL.
  4. Remove `previousCallbackTokenReference` and delete the old secret.
- A configured previous reference that does not resolve never matches. It does not affect the current token.

## Callback handling

`handleCallback` runs these steps in order. Nothing is written for an event until step 6 succeeds.

1. **Token gate**, as above.
2. **Allowlist.** Only the types in `PRODIGI_CALLBACK_EVENT_TYPES` (`com.prodigi.order.status.stage.changed#InProgress`, `#Complete` and `#Cancelled`) can trigger a read. Any other well-formed `com.prodigi.*` type is `ignored_type`, with no store access and no read. Shipment types are left out until one is confirmed against a sandbox recording. Partial shipments are picked up by the next stage callback or by polling.
3. **Tracking.** An order that was never registered with `trackOrder` is `not_tracked`. Nothing is stored and nothing is read, so a callback that races `trackOrder` (Prodigi can fire `InProgress` right after `POST /Orders`) is redelivered and reconciled later.
4. **Replay check (read-only).** An event ID already recorded for this scope and order is `replayed`.
5. **Suppression from authoritative state only.**
   - A tracked order in a terminal stage with no conflict is `already_terminal`.
   - The state carries `confirmedAt`, the local start time of the latest authenticated read that was applied or matched the stored state. An event with `time + coverageSkewMs <= confirmedAt` is already reflected, so it is `already_reconciled`. A future `time` is clamped to now, so a forged far-future time cannot dodge coverage. The event type is never a dedupe key, so a forged `#Complete` cannot suppress the genuine one.
6. **At most one quick read.**
   - If a read for the order is in flight, the callback joins it (single-flight).
   - If the order was read less than `minReadIntervalMs` ago, or the global `ProdigiReadLimiter` has no capacity, no read starts. A background job is scheduled instead (`deferred`).
   - The read is awaited until shortly before `requestDeadlineMs`. If it has not finished by then, it keeps running and still applies, and a job is scheduled (`deferred`).
   - If the read was applied or unchanged and its `confirmedAt` covers the event, the event ID is recorded and the outcome is `reconciled`. A `terminal_conflict` is also recorded as `reconciled`. A stale or regressed read, or a shared read that started before the event, does not cover it, so a job is scheduled.
   - If the read fails, the outcome is `reconcile_failed`. A retryable failure also schedules a background job.

The whole call has a hard deadline of `requestDeadlineMs`, and `deadline_exceeded` is thrown if, for example, the store hangs. No backoff sleep ever runs inside the request.

### Host HTTP status mapping

Every result carries `recommendedHttpStatus` (and `retryAfterSeconds` with 503). Prodigi's redelivery behavior is undocumented, so a 5xx is used wherever redelivery is wanted.

| Outcome or error | Meaning | Answer |
| --- | --- | --- |
| `reconciled`, `replayed`, `already_reconciled`, `already_terminal`, `ignored_type` | Handled, or nothing to do | 200 |
| `deferred` | A background read is scheduled | 202 if `scheduler.durable` is true, otherwise 503 with `Retry-After` |
| `not_tracked` | Order not (yet) tracked; nothing stored | 503 with `Retry-After` |
| `reconcile_failed` | The read failed, or a job could not be scheduled | 503 with `Retry-After` |
| `callback_forged`, `callbacks_disabled` | Wrong token, or callbacks off | 404 (don't reveal the endpoint) |
| `callback_invalid` | Malformed body | 400 |
| `callback_oversized` | Body over the limit | 413 |
| `callback_token_unavailable`, `store_unavailable`, `deadline_exceeded` | Server-side problem | 503 |

A 503 for a callback that was only deferred makes Prodigi redeliver. That is harmless: the redelivery is either covered by then, or it joins the pending job.

## Read amplification bounds

- **Allowlist:** invented types cause no read.
- **Single-flight:** concurrent callbacks for one order share one read. The poller and scheduled jobs join in-flight reads too.
- **Minimum interval:** `minReadIntervalMs` (default 5 s) between callback-triggered reads of one order. Inside the window a callback is coalesced into the order's single pending job.
- **Global limiter:** `readLimiter` (default `createProdigiReadLimiter()`: 4 concurrent reads, a burst of 10, 2 per second sustained) applies to every read. Inject a shared, cross-process limiter in production.
- **Per-read timeout:** `readTimeoutMs` (default 30 s) aborts a read that never returns, so it cannot hold a limiter slot forever.
- **Bounded background work:** at most one pending job per order, at most `maxPendingJobs` (default 1000) per process, and each job chain stops after `pollPolicy.maxAttempts`.

## Background reconciliation

Jobs (`ProdigiReconcileJob`: `key`, `orderId`, `attempt`, `delayMs`, `eventTime`) go to the `scheduler` port. The default is in-process timers, which are `durable: false` and lost on restart; `close()` cancels them. A host with a durable queue implements `{ durable: true, schedule(job) }`, coalesces jobs on `job.key`, and calls `runScheduledReconciliation(job)` when a job is due.

A job run reads nothing if the order is untracked, terminal or already covered. Otherwise it reads once (subject to the same interval, limiter and single-flight rules). On a retryable failure, a non-covering result or a deferral, it reschedules `attempt + 1` until `maxAttempts`. A non-retryable failure (including `reader_error`) stops.

## Polling

`reconcileOrder(orderId)` is a separate entry point for a scheduled poller. It works with callbacks disabled and is not meant for a request handler. Only `rate_limited`, `provider_unavailable`, `timeout` and a local `read_budget_exhausted` are retried. Backoff uses full jitter: the delay before attempt n+1 is drawn uniformly from (0, `min(maxDelayMs, initialDelayMs × 2^(n−1))`]. The same caps apply to background jobs. `backoffSchedule()` returns the caps.

| Setting | Default | Bounds |
| --- | --- | --- |
| `initialDelayMs` | 1000 | 1–60000 |
| `maxDelayMs` | 60000 | `initialDelayMs`–300000 |
| `maxAttempts` | 5 | 1–10 |

When all attempts fail with a retryable error, the result is `retries_exhausted`. Any other failure stops at once as `read_failed`. That includes `authentication_failed`, `not_found`, `invalid_response`, `sandbox_calls_disabled`, `decision_unverified`, `aborted`, and `reader_error`, which covers unknown, non-adapter errors such as programming faults. A read whose order ID differs from the requested one is not applied. Failures never change the stored state.

## Ordering

`decideProdigiOrdering` gates every authenticated read before it is written. The checks run in this order:

1. The same content is `unchanged`. This still records `confirmedAt`.
2. `Complete` versus `Cancelled`, in either direction, is a `terminal_conflict` **regardless of `lastUpdated`**, so a stale read never masks the contradiction. The conflict is recorded and the stored stage is kept.
3. A strictly older `lastUpdated` is `stale`.
4. Moving from a terminal stage back to `InProgress`, any step going backwards (`NotStarted` < `InProgress`/`Error` < `Complete`), or a previously seen shipment disappearing, is `regression`.

Writes use compare-and-set on a revision. On contention the decision is re-evaluated against the fresh state (up to four rounds). After that it fails as `store_unavailable`.

## Store and retention

`ProdigiReconciliationStore` has four methods: `hasEvent`, `recordEvent`, `getOrder` and `compareAndSetOrder`.

- **Nothing is written for an untracked order.** Unknown-order callbacks cost one `getOrder`.
- **Replay records** are written only after a covering read was applied. They carry `expiresAt = now + replayTtlMs`, where `replayTtlMs` defaults to 7 days, with bounds of 1 minute to 30 days. A store must drop a record once it expires, and may also enforce a capacity bound with oldest-first eviction. Eviction is safe: a replay record only saves a coverage check, and an evicted event is still covered by `confirmedAt`. A failed `recordEvent` after a successful apply is ignored for the same reason.
- `compareAndSetOrder` must be atomic across workers and restarts.
- `createInMemoryProdigiReconciliationStore({ maxReplayRecords = 10000, clock })` is a single-process reference for tests and local development. It expires records lazily and on each write, and caps them oldest-first. It is not durable and is not atomic across processes. Order entries are kept until the host removes tracking. Per-order in-process bookkeeping in the reconciler is capped at 10,000 entries, oldest first, and exists only for tracked orders.

## Gates

- `mode` must be `"sandbox"`. `"live"` throws `live_refused`, and any other value throws `invalid_config`.
- `callbacksEnabled` must be exactly `true` (the default is off). Otherwise `handleCallback` throws `callbacks_disabled` without reading a secret or the body. Enabling it requires `secrets` and `callbackTokenReference`.
- The raw body limit defaults to 512 KiB, with a 1 MiB maximum. `requestDeadlineMs` defaults to 2 s, with bounds of 50 ms to 10 s.
- Errors use fixed codes and messages. Results contain no token, API key, recipient, tracking number or raw body.

## Shared change

The callback ID pattern in `ingestProviderCallback` now allows `_` after the first character. Without it, Prodigi's documented `evt_…` and `ord_…` IDs would be rejected. The rest of the pattern is unchanged. Trusted-scope identifiers still exclude `_`.

## Tests

`npm run test:prodigi-callbacks` (also part of `npm test`) runs `tests/prodigi-callback-suite.mjs` with the sandbox network guard preloaded. The guard blocks fetch, http/https, net and tls, and the suite asserts zero attempts. All provider reads go through the real `ProdigiSandboxClient` over a recording HTTP port, so the guard is belt-and-braces. Regression cases cover each review finding:

- **Lost callbacks:** a callback arriving before `trackOrder`, then redelivered; failed reads returning 503, then a redelivery and a background retry.
- **Status suppression:** a forged `#Complete` followed by the genuine `#Complete`; a repeated status that is suppressed only when it is covered.
- **Read amplification:** 20 invented types cause zero reads and zero store calls; 20 documented callbacks against a failing provider cause at most `maxAttempts` reads; the global limiter bounds reads across 20 orders; concurrent callbacks share a single flight.
- **Storage:** 1,000 unknown orders leave zero stored entries and no in-process state; replay records honor their TTL and cap.
- **Deadlines:** a hung read and a hung store are both cut off at the in-request deadline.
- **Smaller fixes:** unknown reader errors are not retried; an older `Cancelled` after `Complete` is a conflict, not stale; stored tokens that are overlong or non-printable are rejected; previous-token rotation works.

The suite also keeps its earlier coverage: disabled-by-default (with the real reader and secret source wired in), live refusal, bounds, parsing, forged tokens, callback content never applied, ordering, polling backoff, compare-and-set contention with real interleaving, and store failure. The CloudEvent bodies are synthetic, not recordings.

## Not done

1. **A durable, cross-process store, scheduler and limiter.** Back `ProdigiReconciliationStore` with atomic persistence, provide a durable `scheduler` (then deferred callbacks can be answered with 202) and a shared `readLimiter`. Wire reconciled observations into `LocalStatusStore` through its `TrustedStatusLookup` port.
2. **The host HTTP route.** Extract the token from the path, enforce TLS and the body limit before buffering, and answer with `recommendedHttpStatus` and the error mapping above.
3. **Callback registration.** Order creation still sends no `callbackUrl`, and nothing is set in the dashboard. Registering a URL is an owner step, and it needs the token secret provisioned first.
4. **Confirming the wire format.** Against an owner-approved sandbox order, check the event `type` values (including any shipment type, before adding it to the allowlist), the precision of `time`, and redelivery behavior. Then replace the synthetic bodies with sanitized recordings.
5. **Provider-side authenticity.** If Prodigi ever documents signing, implement it as a `CallbackVerifier`. Until then, callbacks stay unverified hints.
6. Live mode stays out of scope.
