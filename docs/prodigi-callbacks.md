# Prodigi callbacks and authenticated reconciliation

**Status:** implemented and covered by offline fixtures only. Callbacks are disabled by default. Nothing has been registered with Prodigi, no callback has been received from Prodigi, and no request has been sent to Prodigi. Live mode is refused.

Tracker: getticketstub.com #27 ("supplier callback authenticity, replay protection and authenticated reconciliation/polling") and [FC-07](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/13). This module builds on the [Prodigi sandbox adapter](prodigi-sandbox.md).

## What Prodigi documents

From the public v4 reference, [Callbacks](https://www.prodigi.com/print-api/docs/reference/#callbacks) and [Order object](https://www.prodigi.com/print-api/docs/reference/#order-object) (checked 2026-10-11):

- Callbacks go to a public URL set globally in the dashboard's merchant settings, or per order through `callbackUrl` ("Your callback URL, where we send callback events"). They are sent when an order's stage changes or a shipment is made.
- Each callback is a CloudEvents 1.0 JSON object. `id` is unique and starts with `evt_`. `type` is `com.prodigi.` + the responsible object + the path to the changed nested object + `#` + the new value. The only complete type string on the page is `com.prodigi.order.status.stage.changed#InProgress`. `source` points at the producing environment's Orders endpoint: `https://api.sandbox.prodigi.com/v4.0/Orders/` for sandbox and `https://api.prodigi.com/v4.0/Orders/` for live (the example JSON uses `http://`). `subject` is the order ID. `time` is when the event was generated, which "may differ from the actual delivery time … because callbacks are queued". `data` is "the complete order object at the point the callback was created" (the example nests it as `data.order`).
- The order stages are `InProgress`, `Complete` and `Cancelled`. Callbacks are also sent "when a shipment is made", but **no shipment event type string is documented.**
- **The reference documents no callback signature, HMAC, signing secret, authentication header, source IP list, retry or redelivery policy.** Prodigi callbacks are therefore unsigned, and this module never treats a callback as provider-authenticated.
- `GET /v4.0/orders/{prodigi_order_id}` with the `X-API-Key` header is the authenticated read. The response echoes `callbackUrl`.

## Trust model

| Step | What it proves | Implementation |
| --- | --- | --- |
| 1. URL capability token | The sender knows the token in the callback URL that the host registered. Anonymous internet traffic is rejected. It does **not** prove the sender is Prodigi: the URL is visible to anyone who can read the order through the API, and to logs on the path. | The host's HTTP handler extracts the token from the URL and passes it as `presentedToken`. The server-held value is resolved at call time through `withServerSecret` and a `ServerSecretSource`, then compared in constant time over SHA-256 digests. A stored token that is missing, shorter than 43 or longer than 512 characters, or outside printable ASCII (`[\x21-\x7E]`) fails closed as `callback_token_unavailable`. A missing or wrong presented token is `callback_forged`, before any store access or provider read. |
| 2. Untrusted hint | Nothing about order state. | `parseProdigiCallbackEvent` keeps only `id`, `subject`, `type` (and the stage named by a `stage.changed#` type) and `time`. `source` must be the sandbox Orders endpoint (`http` or `https`, case-insensitive, optional trailing order ID); a live or foreign source is `callback_invalid`. `data` is only checked for a matching `id` (or `data.order.id`); the recipient and everything else are discarded unread. Intake goes through the existing `ingestProviderCallback` with no verifier, so the observation is `unverified` with `authoritativeMutationAllowed: false`. |
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

**Principle.** A callback is only an untrusted "go look" hint. The host gets a 2xx only when (a) a successful authenticated read that **started after this callback was received** has been applied, or (b) a durable job that will perform such a read is persisted in the store. Coverage is decided only on our own clock (the receipt time stamped when `handleCallback` is entered). Prodigi's event `time` is never compared with our clock for coverage, so Prodigi clock skew and queueing delay cannot suppress a callback.

`handleCallback` runs these steps in order. Nothing is written for an event until a covering read succeeds.

1. **Receipt.** The receipt time (our clock) and an in-process sequence number are stamped first.
2. **Token gate**, as above.
3. **Type filter.** Any well-formed `com.prodigi.order.*` type (stage changes, shipments, anything else about the order) may trigger one bounded read. Only `stage.changed#<Stage>` types carry a `claimedStage`. Other objects (`com.prodigi.invoice.*` and so on) are `ignored_type`, with no store access and no read. Reads are bounded by single-flight, the per-order interval and the limiter, so the type is no longer an amplification defense.
4. **Tracking.** An order that was never registered with `trackOrder` is `not_tracked` (503). Nothing is stored and nothing is read, so a callback that races `trackOrder` is redelivered. Once the event's `time` is older than `untrackedAckAfterMs` (default 24 h; 0 disables), the answer is `untracked_expired` (200) instead. **The host must call `trackOrder` before it sets `callbackUrl` on an order (or immediately after `POST /Orders` returns, before a callback can matter), and must track existing orders before enabling a dashboard-wide callback URL.**
   - Why 24 h: the `trackOrder` race lasts seconds, so a 24 h cutoff never acknowledges a callback that tracking would have made useful. It stops orders created outside this application (for example with the global dashboard URL) from being redelivered forever under Prodigi's undocumented retry policy. Acknowledging an untracked callback changes nothing, so a forged old `time` gains a sender nothing.
5. **Replay check (read-only).** An event ID already recorded for this scope and order is `replayed`.
6. **Suppression from authoritative state only.**
   - A tracked order in a terminal stage with no conflict is `already_terminal`.
   - If the stored `confirmedAt` (start time, our clock, of the latest applied or unchanged read, from any worker) is strictly after the receipt time, and the state has reached any claimed stage, the event is covered: it is recorded and answered `already_reconciled`.
7. **At most one quick read that starts after receipt.**
   - A read already in flight that started **before** this callback was received cannot cover it. The callback joins the **next** read: it is merged into the order's pending record (one follow-up job for the whole burst) and answered `deferred`.
   - A read in flight that started after receipt is joined.
   - If the order was read less than `minReadIntervalMs` ago, or the limiter has no capacity, no read starts and the callback is deferred into the order's single follow-up job. The interval coalesces bursts; it never drops a callback.
   - Otherwise one read starts now. A promptly delivered callback (event `time` ≈ now) is therefore read in-request and answered `reconciled`/200.
   - The read is awaited until shortly before `requestDeadlineMs`. If it has not finished, it keeps running and still applies, and the callback is deferred.
   - If the read was applied or unchanged **and** reached the claimed stage, the event is recorded and the outcome is `reconciled`. A `terminal_conflict` is also `reconciled`. A stale or regressed read, or one that has not reached the claimed stage yet (Prodigi read lag), is deferred for a follow-up read.
   - If the read fails, the outcome is `reconcile_failed`. A retryable failure (`rate_limited`, `provider_unavailable`, `timeout`, `read_budget_exhausted`, `store_unavailable`) also records a pending job.
   - Any successful read (in-request, job or poll) also clears the order's pending record if it covers it, and records the event IDs merged into it, so their redeliveries are `replayed`.

The whole call has a hard deadline of `requestDeadlineMs`, and `deadline_exceeded` is thrown if, for example, the store hangs. No backoff sleep ever runs inside the request.

A forged stage claim (for example `#Complete` while the order is `InProgress`) is never acknowledged as reconciled from a read that does not show the stage. It only buys a bounded follow-up chain, which ends as `reconcile_abandoned` with reason `claim_unconfirmed`.

### Host HTTP status mapping

Every result carries `recommendedHttpStatus` (and `retryAfterSeconds` with 503). Prodigi's redelivery behavior is undocumented, so a 5xx is used wherever redelivery is wanted.

| Outcome or error | Meaning | Answer |
| --- | --- | --- |
| `reconciled` | This request's read (started after receipt) was applied and reached any claimed stage | 200 |
| `already_reconciled` | Another read that started after receipt was already applied | 200 |
| `replayed` | The event ID was already covered | 200 |
| `already_terminal` | The authoritative state is terminal | 200 |
| `ignored_type` | Not a `com.prodigi.order.*` type | 200 |
| `untracked_expired` | Never tracked, and older than `untrackedAckAfterMs` | 200 |
| `deferred` | A pending record owing a covering read is persisted in the store and a job owns it | 202 if `scheduler.durable` is true, otherwise 503 with `Retry-After` |
| `not_tracked` | Order not (yet) tracked; nothing stored | 503 with `Retry-After` |
| `reconcile_failed` | The read failed, or no job could be recorded (`maxPendingJobs`, scheduler refused) | 503 with `Retry-After` |
| `callback_forged`, `callbacks_disabled` | Wrong token, or callbacks off | 404 (don't reveal the endpoint) |
| `callback_invalid` | Malformed body, or a `source` other than the sandbox Orders endpoint | 400 |
| `callback_oversized` | Body over the limit | 413 |
| `callback_token_unavailable`, `store_unavailable`, `deadline_exceeded` | Server-side problem | 503 |

A 503 for a callback that was only deferred makes Prodigi redeliver. That is harmless: the redelivery is `replayed` once the follow-up read covered it, or it merges into the pending record.

## Read amplification bounds

- **Type filter:** types for objects other than `order` cause no read.
- **Single-flight:** concurrent callbacks received before a read starts share it. Callbacks received during a read join the next read. The poller and scheduled jobs join in-flight reads too.
- **Minimum interval:** `minReadIntervalMs` (default 5 s) between reads of one order in a process. Inside the window callbacks are coalesced into the order's single pending job, never dropped.
- **Read limiter:** `readLimiter` (default `createProdigiReadLimiter()`) applies to every read and is called with the tenant ID. Globally: 4 concurrent reads, a burst of 10, 2 per second sustained. Per tenant: half of each (2 concurrent, a burst of 5, 1 per second) by default (`tenantMaxConcurrent`, `tenantBurst`, `tenantRefillPerSecond`). A read needs a global and a tenant token, so one tenant's burst (for example a token holder replaying callbacks for that tenant's own orders) cannot use more than its share and other tenants keep reading. At most 10,000 tenant buckets are kept, least recently used first. Inject one shared limiter across reconcilers (and a cross-process one in production).
- **Per-read timeout:** `readTimeoutMs` (default 30 s) aborts a read that never returns, so it cannot hold a limiter slot forever.
- **Bounded background work:** at most one pending record per order, at most `maxPendingJobs` (default 1000) live records per scope **counted from the store**, and each chain stops at its retry budget.

## Background reconciliation

### Durable pending records

Deferral state lives in the store (`ProdigiPendingReconciliation`), not in process memory:

| Field | Meaning |
| --- | --- |
| `coverAfter` | Newest receipt time (our clock) of a callback merged into the record. Only a read that starts strictly after it covers the record. |
| `requiredStage` | Highest stage claimed by a merged callback. The covering read must reach it. |
| `eventIds` | Up to 32 merged event IDs, recorded as reconciled when the record is cleared. |
| `firstReceivedAt` | Start of the chain; the retry horizon is measured from it. |
| `attempt`, `dueAt` | The currently scheduled job. |
| `staleAt` | `dueAt + pendingJobGraceMs` (default max(120 s, 2 × `readTimeoutMs`)). After it the record is orphaned (its job was lost, for example an in-process timer after a restart): it no longer counts toward `maxPendingJobs`, and the next callback replaces it and schedules a fresh job, carrying its requirement and event IDs. |

- A callback that finds a live record merges its receipt time, claimed stage and event ID into it with compare-and-set and schedules nothing. That is safe to acknowledge: whichever worker runs the job clears the record only if its read started after the stored `coverAfter`, atomically, so a callback merged during the read keeps the record and forces another read.
- A callback that finds no live record creates one and calls `scheduler.schedule(job)`. If the scheduler throws, the record is rolled back and the answer is `reconcile_failed`.
- Jobs (`ProdigiReconcileJob`: `key`, `orderId`, `attempt`, `delayMs`, `coverAfter`, `requiredStage`) carry the order and the receipt time they must cover. The worker running the job uses the stored record, which may be newer.
- A job whose record is gone is `obsolete` (another read covered it) and reads nothing. A job older than the record's attempt is `superseded`, so duplicate jobs collapse. Queues must not drop a job in favor of an older one for the same `key`.

The default scheduler is in-process timers (`durable: false`; `close()` cancels them). A host with a durable queue implements `{ durable: true, schedule(job) }` and calls `runScheduledReconciliation(job)` on any worker when the job is due. If that call throws (for example `store_unavailable`), the queue must retry the job.

### Job runs

A job run clears the record and reads nothing if the order is untracked or terminal, or if the stored state already covers the record. Otherwise it reads once (subject to the same interval, limiter and single-flight rules; an in-flight read that started before `coverAfter` is not joined). A covering read clears the record (`applied`/`unchanged`). A retryable failure, a non-covering result, a newer merged callback or a deferral reschedules `attempt + 1`.

### Retry budget and `reconcile_abandoned`

`jobRetryPolicy` (`initialDelayMs`, `maxDelayMs`, `maxAttempts`, `horizonMs`) sets the chain's budget. Each delay is fully jittered: uniform in (0, `min(maxDelayMs, initialDelayMs × 2^(attempt−1))`], and at least the order's remaining read interval.

| Scheduler | `initialDelayMs` | `maxDelayMs` | `maxAttempts` | `horizonMs` |
| --- | --- | --- | --- | --- |
| durable (`durable: true`) | 2000 | 300000 | 40 | 3600000 (1 h) |
| in-process (default) | `pollPolicy.initialDelayMs` | `pollPolicy.maxDelayMs` | `pollPolicy.maxAttempts` | 600000 |

Bounds: `initialDelayMs` 1–600000, `maxDelayMs` `initialDelayMs`–3600000, `maxAttempts` 1–1000, `horizonMs` 1000–86400000. With the durable defaults the horizon binds first, so a chain keeps retrying for about an hour. `jobRetryBudget()` returns the effective values.

A chain that gives up never drops silently. It deletes the record and emits a `ProdigiReconcileAbandonedEvent` (`outcome: "reconcile_abandoned"`, `scope`, `orderId`, `reason`, `attempts`, `coverAfter`, `requiredStage`, `firstReceivedAt`, `abandonedAt`, optional `errorCode`) to the injected `onReconcileAbandoned` hook. The `runScheduledReconciliation` result also reports `reconcile_abandoned` with the `reason`. Reasons:

- `horizon_exceeded` / `retries_exhausted`: the budget ran out on retryable failures or non-covering reads.
- `read_failed`: a non-retryable failure (for example `authentication_failed`, `sandbox_calls_disabled` or `reader_error`).
- `claim_unconfirmed`: reads succeeded but never showed the claimed stage. Either Prodigi lagged for the whole budget, or the claim was forged.
- `schedule_failed`: the scheduler refused the next job.

**Poller contract:** the host must wire `onReconcileAbandoned` (strongly recommended whenever `scheduler.durable` is true) to enqueue the order for the poller (`reconcileOrder`) and to alert. A 202 told Prodigi not to redeliver, so this hook and the poller are what own the event after abandonment. Errors the hook throws are swallowed, and the run result still reports the outcome.

## Polling

`reconcileOrder(orderId)` is a separate entry point for a scheduled poller and for orders reported by `reconcile_abandoned`. It works with callbacks disabled and is not meant for a request handler. Only `rate_limited`, `provider_unavailable`, `timeout`, `store_unavailable` (a transient store failure while applying) and a local `read_budget_exhausted` are retried. Backoff uses full jitter: the delay before attempt n+1 is drawn uniformly from (0, `min(maxDelayMs, initialDelayMs × 2^(n−1))`]. `backoffSchedule()` returns the caps. A successful poll also clears a pending record it covers.

| Setting | Default | Bounds |
| --- | --- | --- |
| `initialDelayMs` | 1000 | 1–60000 |
| `maxDelayMs` | 60000 | `initialDelayMs`–300000 |
| `maxAttempts` | 5 | 1–10 |

When all attempts fail with a retryable error, the result is `retries_exhausted`. Any other failure stops at once as `read_failed`. That includes `authentication_failed`, `not_found`, `invalid_response`, `sandbox_calls_disabled`, `decision_unverified`, `aborted`, and `reader_error`, which covers unknown, non-adapter errors from the reader such as programming faults. A read whose order ID differs from the requested one is not applied. Failures never change the stored state.

## Ordering

`decideProdigiOrdering` gates every authenticated read before it is written. The checks run in this order:

1. The same content is `unchanged`. This still records `confirmedAt`.
2. `Complete` versus `Cancelled`, in either direction, is a `terminal_conflict` **regardless of `lastUpdated`**, so a stale read never masks the contradiction. The conflict is recorded and the stored stage is kept.
3. A strictly older `lastUpdated` is `stale`.
4. Moving from a terminal stage back to `InProgress`, any step going backwards (`NotStarted` < `InProgress`/`Error` < `Complete`), or a previously seen shipment disappearing, is `regression`.

Writes use compare-and-set on a revision. On contention the decision is re-evaluated against the fresh state (up to four rounds). After that it fails as `store_unavailable`.

## Store and retention

`ProdigiReconciliationStore` is the durable interface. It has seven methods: `hasEvent`, `recordEvent`, `getOrder`, `compareAndSetOrder`, `getPendingReconciliation`, `compareAndSetPendingReconciliation` (`next: null` deletes) and `countPendingReconciliations` (live records, `staleAt > now`, in one scope).

- **Nothing is written for an untracked order.** Unknown-order callbacks cost one `getOrder`.
- **Replay records** are written only after a covering read was applied. They carry `expiresAt = now + replayTtlMs`, where `replayTtlMs` defaults to 7 days, with bounds of 1 minute to 30 days. A store must drop a record once it expires, and may also enforce a capacity bound with oldest-first eviction. Eviction is safe: a replay record only saves a read. A failed `recordEvent` after a successful apply is ignored for the same reason.
- Both compare-and-set methods must be atomic across workers and restarts.
- `createInMemoryProdigiReconciliationStore({ maxReplayRecords = 10000, clock })` is a single-process reference for tests and local development. It expires records lazily and on each write, and caps them oldest-first. It is not durable and is not atomic across processes. It writes pending records only for tracked orders. Per-order in-process bookkeeping in the reconciler (read times for the interval) is capped at 10,000 entries, oldest first, and exists only for tracked orders. No pending-job state is kept in process memory.

## Gates

- `mode` must be `"sandbox"`. `"live"` throws `live_refused`, and any other value throws `invalid_config`.
- `callbacksEnabled` must be exactly `true` (the default is off). Otherwise `handleCallback` throws `callbacks_disabled` without reading a secret or the body. Enabling it requires `secrets` and `callbackTokenReference`.
- The CloudEvent `source` must be the sandbox Orders endpoint.
- The raw body limit defaults to 512 KiB, with a 1 MiB maximum. `requestDeadlineMs` defaults to 2 s, with bounds of 50 ms to 10 s.
- Errors use fixed codes and messages. Results and abandonment events contain no token, API key, recipient, tracking number or raw body.

## Shared change

The callback ID pattern in `ingestProviderCallback` now allows `_` after the first character. Without it, Prodigi's documented `evt_…` and `ord_…` IDs would be rejected. The rest of the pattern is unchanged. Trusted-scope identifiers still exclude `_`.

## Tests

`npm run test:prodigi-callbacks` (also part of `npm test`) runs `tests/prodigi-callback-suite.mjs` with the sandbox network guard preloaded. The guard blocks fetch, http/https, net and tls, and the suite asserts zero attempts. All provider reads go through the real `ProdigiSandboxClient` over a recording HTTP port, so the guard is belt-and-braces. Regression cases cover each review finding:

- **Coverage on our own clock (N2/N3):** prompt delivery (event time = now) is reconciled in-request with 200; Prodigi clock skew of +10 s and −10 s; a provider clock 10 s behind ours (P3c); read lag, where the first read returns the old stage and the follow-up gets the new one; a lagging read triggered earlier that cannot suppress the genuine `#Complete` (P3b); callbacks arriving during an in-flight read join one follow-up read; a repeated status is never suppressed.
- **Durable deferral (N1):** two reconcilers share one store and durable queue, the job runs on the other worker and clears the stored record, and a callback an hour later is still read; a callback merged while the other worker's read is in flight keeps the record and forces another read; `maxPendingJobs` is counted from the store across workers, orphaned records stop counting, and the next callback replaces one with a fresh job.
- **Order types (N4):** shipment types trigger a bounded read; other objects are ignored.
- **Retry budget (N5):** durable defaults; a 1 h outage ends in `reconcile_abandoned` (`horizon_exceeded`) delivered to the hook; a non-retryable failure in a job (`read_failed`); an unconfirmed forged claim (`claim_unconfirmed`).
- **Fairness (N6):** tenant A's 12-callback burst is held to its sub-budget and tenant B is still reconciled; unit checks of per-tenant concurrency and refill.
- **Store blips (N7):** a CAS failure while applying is `store_unavailable`, retried by a job and by the poller.
- **Nits:** `source` validation (live, foreign, look-alike and missing sources), `data.order.id`, `untracked_expired` after the configured age.
- **Earlier findings:** a callback before `trackOrder`, then redelivered; failed reads returning 503, then a redelivery and a background retry; a forged `#Complete` followed by the genuine one; 20 invented types cause zero reads and zero store calls; 20 documented callbacks against a failing provider cause at most `maxAttempts` reads; the limiter bounds reads across 20 orders; concurrent callbacks share a single flight; 1,000 unknown orders leave zero stored entries; replay TTL and cap; a hung read and a hung store are both cut off at the in-request deadline; unknown reader errors are not retried; an older `Cancelled` after `Complete` is a conflict; stored-token checks; previous-token rotation.

The suite also keeps its earlier coverage: disabled-by-default (with the real reader and secret source wired in), live refusal, bounds, parsing, forged tokens, callback content never applied, ordering, polling backoff, compare-and-set contention with real interleaving, and store failure. The CloudEvent bodies are synthetic, not recordings.

## Not done

1. **A durable, cross-process store, scheduler, limiter and poller.** Back `ProdigiReconciliationStore` (including the pending-record methods) with atomic persistence, provide a durable `scheduler` (then deferred callbacks are answered with 202), a shared `readLimiter`, and a poller fed by `onReconcileAbandoned`. Wire reconciled observations into `LocalStatusStore` through its `TrustedStatusLookup` port.
2. **The host HTTP route.** Extract the token from the path, enforce TLS and the body limit before buffering, and answer with `recommendedHttpStatus` and the error mapping above.
3. **Callback registration.** Order creation still sends no `callbackUrl`, and nothing is set in the dashboard. Registering a URL is an owner step, and it needs the token secret provisioned first.
4. **Confirming the wire format.** Against an owner-approved sandbox order, check the event `type` values (including the shipment type), the exact `source`, the `data` shape, the precision of `time`, and redelivery behavior. Then replace the synthetic bodies with sanitized recordings.
5. **Provider-side authenticity.** If Prodigi ever documents signing, implement it as a `CallbackVerifier`. Until then, callbacks stay unverified hints.
6. Live mode stays out of scope.
