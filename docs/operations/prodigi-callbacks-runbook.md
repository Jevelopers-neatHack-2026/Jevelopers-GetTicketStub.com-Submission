# Prodigi sandbox callbacks: host runbook

**Status:** the host side is built and covered by offline tests only. It is **off by default** and stays a 404 until the owner turns it on in Preview. Nothing has been registered with Prodigi, no callback has been received, and nothing in this repository has sent a request to Prodigi. Live mode is refused.

Decisions: integration-evals [`planning/decisions/0003-owner-delegated-decisions-2026-10-12.md`](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/decisions/0003-owner-delegated-decisions-2026-10-12.md), rows R1 to R6 and the "Callback registration is blocked" list. Reconciler contract: fulfillment-connectors [`docs/prodigi-callbacks.md`](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/blob/main/docs/prodigi-callbacks.md). Tracker: #27.

## What is in this repository

| Piece | Where | Notes |
| --- | --- | --- |
| Reconciler and sandbox adapter | `src/server/vendor/fulfillment-connectors` | Compiled `dist` files vendored from one pinned fulfillment-connectors commit (`MANIFEST.json`). Refresh with `node scripts/vendor-fulfillment-connectors.mjs <commit>`. The test suite fails if a file drifts. |
| Route | `POST /api/fulfillment/prodigi/callbacks/{token}` (`src/app/api/fulfillment/prodigi/callbacks/[token]/route.ts`, logic in `src/server/fulfillment/prodigi-callback-route.ts`) | 404 when off. The token is the last path segment, checked in constant time by the reconciler before the body or the store is touched. The body is capped at 512 KiB before it is buffered. |
| Durable store | `src/server/fulfillment/prodigi-store.ts` | Order state, replay records (7-day TTL, 10,000 cap, oldest first) and pending reconciliations, each written by compare-and-set, in `TICKETSTUB_DB`. |
| Durable scheduler and worker | `src/server/fulfillment/prodigi-jobs.ts` | `prodigi_jobs` rows due at `now + delayMs`, leased by an in-process worker (1 s loop, 5 min lease), deleted only when the run returns, retried with backoff when it throws. Jobs survive a restart. The worker starts at boot (`src/instrumentation.ts`) when the flag is on. |
| Abandon alerts | `prodigi_alerts`, written by the `onReconcileAbandoned` hook | One row per `dedupeKey`, a `[prodigi] reconcile_abandoned …` log line, and a queued poll (`reconcileOrder`) whose outcome is kept on the row. |
| Order creation | `src/server/fulfillment/prodigi-orders.ts` (`createSandboxOrder`) | The only way this app creates a sandbox order. It sends `callbackUrl` only when the route is on, and calls `trackOrder` as soon as `POST /v4.0/Orders` returns. If that fails, a durable `track` job tracks the order and reads it once. Nothing calls it yet. |
| Migrations | `src/server/fulfillment/prodigi-migrations.ts` | Its own forward-only chain, recorded in `module_schema`. The app's `PRAGMA user_version` chain is not touched. The tables live in the app database, so the existing backup (`VACUUM INTO`) and restore copy them. |

### Why trackOrder runs right after `POST /Orders` and not before it

Prodigi assigns the order ID in the create response, so an order cannot be tracked before the request that carries its `callbackUrl`. The reconciler documents this case: track it "immediately after `POST /Orders` returns, before a callback can matter". A callback that arrives first gets `not_tracked` with a 503, and Prodigi redelivers it.

### Why `callbackUrl` is added at the transport

The vendored adapter's create-order body has no `callbackUrl` field (fulfillment-connectors `mapOrderRequest`: "No callback URL or metadata is sent"). The host adds the field at the `ProdigiHttpPort`, which is the adapter's injection point. Only the body of `POST https://api.sandbox.prodigi.com/v4.0/Orders` changes. A follow-up in fulfillment-connectors could add an optional `callbackUrl` to `ProdigiOrderCreateInput`, after which this wrapper can be dropped.

## Settings

| Name | Value | Where |
| --- | --- | --- |
| `TICKETSTUB_PRODIGI_CALLBACKS` | `off` (default) or `sandbox`. Anything else is off. `live` is refused and logged once. | Preview only |
| `PRODIGI_SANDBOX_CALLBACK_TOKEN` | 32 random bytes, base64url (43 characters). Server secret. | Preview only, one value per environment |
| `PRODIGI_SANDBOX_CALLBACK_TOKEN_PREVIOUS` | The previous token during a rotation. Otherwise unset. | Preview only |
| `PRODIGI_SANDBOX_API_KEY` | Sandbox API key for the authenticated reads (fulfillment-connectors' predeclared binding). | Preview only, once reads are approved |
| `APP_URL` | Existing. Must be the `https://` origin the callback URL is built on. | Already set |

The names are fixed by 0003 R6. The secret references the reconciler uses are `prodigi/sandbox/callback-token` and `prodigi/sandbox/callback-token-previous`.

## HTTP answers

| Situation | Answer |
| --- | --- |
| Flag off, flag `live` or unrecognized, wrong or missing token | 404 `not_found` |
| `reconciled`, `already_reconciled`, `replayed`, `already_terminal`, `ignored_type`, `untracked_expired` | 200 `{ "outcome": … }` |
| `deferred` (a durable job owns the read) | 202 |
| `not_tracked`, `reconcile_failed` | 503 with `Retry-After: 30` |
| Malformed body | 400 `callback_invalid` |
| Body over 512 KiB (correct token only; a wrong token is still a 404) | 413 `callback_oversized` |
| `source` is not the sandbox Orders endpoint | 503 `callback_source_mismatch`, logged |
| Token secret missing or malformed, store down, deadline exceeded | 503 `callbacks_unavailable`, logged |

## Still blocked in code

- **A real `SandboxDecisionVerifier`** (0003 blocker 5). Until one resolves the 0003 record, the host uses a verifier that refuses. Every read and every order fails as `decision_unverified` before a credential is loaded or a request is built. With the flag on, a callback for a tracked order answers 503 `reconcile_failed`, and Prodigi redelivers.
- **Shared limiter and scheduled poller.** The read limiter is the reconciler's in-process default. That is enough for the single Plus Launch process. The poller runs only for abandoned chains, through queued `poll` jobs. There is no periodic sweep of all orders yet.
- **`LocalStatusStore` wiring** (fulfillment-connectors "Not done" item 1) is not done.

## Owner steps, in order

Do each step on **Preview** only. Production keeps the flag unset, and `npm run smoke:production` asserts the route answers 404 there.

1. **Generate and enter the token secret in GoDaddy.** Generate it locally and never paste it into chat, issues or logs:
   `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`.
   In the Preview environment settings, add `PRODIGI_SANDBOX_CALLBACK_TOKEN` with that value. Leave every other secret alone; never bulk-sync, open or copy them. Restart Preview.
2. **Bot-filter exemption.** In GoDaddy's security or bot-filter settings, let non-browser `POST` requests to `/api/fulfillment/prodigi/callbacks/*` through with no JavaScript or CAPTCHA challenge. This is the same open question as `POST /api/payments/stripe/webhook` (0003 checklist). Without it, Prodigi's callbacks never reach the app.
3. **Enable the flag in Preview only.** Set `TICKETSTUB_PRODIGI_CALLBACKS=sandbox` in Preview, then restart. Check:
   - the Preview log shows `[prodigi] sandbox callbacks on; job worker started`;
   - `curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<preview-host>/api/fulfillment/prodigi/callbacks/$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")` prints `404` (a wrong token);
   - Production still prints `404` for the same request, and its log has no `[prodigi]` line.
   After any later GoDaddy publication, run the CLAUDE.md deployment-completion gate as usual. This flag is not one of the four analytics overrides, so do not touch it there.
4. **Confirm the Prodigi dashboard callback URL is empty** (0003 R4). Callbacks are per order only.
5. **Then, once the decision verifier exists (above) and `PRODIGI_SANDBOX_API_KEY` is set in Preview, approve the sandbox order that carries `callbackUrl`** (0003 checklist, last Prodigi item). It goes through `createSandboxOrder` with `sandboxCallsEnabled: true` and the verifier, for `GLOBAL-PHO-4X6` / `US` / `Standard`. That order is the callback registration. Afterwards, confirm the wire format against it (event `type` values including shipments, the exact `source`, the `data` shape, `time` precision, redelivery behavior). Then replace the synthetic bodies in fulfillment-connectors with sanitized recordings (its "Not done" item 4).

## Rotation (every 90 days, and after any suspected exposure)

Prodigi echoes `callbackUrl` in order reads, so treat the token as exposed to anyone with order read access.

1. In one GoDaddy save, copy the current value into `PRODIGI_SANDBOX_CALLBACK_TOKEN_PREVIOUS` and set a newly generated value in `PRODIGI_SANDBOX_CALLBACK_TOKEN` (delete, re-add, restart). New orders get the new URL, because the URL is built from the setting at order time.
2. Watch the log for `callback used the previous token`. Orders created before the switch still call the old URL.
3. When those orders are terminal, or older than the 7-day replay TTL, remove `PRODIGI_SANDBOX_CALLBACK_TOKEN_PREVIOUS` and restart.

## Operating it

- **Turning it off:** unset `TICKETSTUB_PRODIGI_CALLBACKS` (or set `off`) and restart. The route answers 404 and the worker does not start. Queued jobs and alerts stay in the database and resume when the flag is turned back on.
- **Alerts:** `prodigi_alerts` in `TICKETSTUB_DB` (one row per abandoned chain: order ID, reason, error code, attempts, and the poll's outcome). For example, `sqlite3 -readonly "$TICKETSTUB_DB" "SELECT order_id, reason, error_code, poll_status FROM prodigi_alerts ORDER BY created_at DESC LIMIT 20"`. `poll_status` stays `queued` until the poll runs. `read_failed` or `retries_exhausted` there means the order needs a person.
- **Jobs:** `prodigi_jobs`. A row with a large `runs` count and a `last_error` is retrying. The worker logs each failure as `[prodigi] <kind> job <id> … failed (<code>); retrying`.
- Nothing personal is stored or logged. The tables and log lines hold only Prodigi order and event IDs, stages, step states, shipment IDs, times, counts and error codes. The callback body, the recipient, tracking numbers and tokens are never written.

## Tests

`node --test tests/prodigi-callbacks.test.mjs` (part of `npm test`) runs with a network guard imported first and asserts zero network attempts at the end. It covers:

- the route: off → 404 with the body unread; `live` and unrecognized values → 404; a wrong token → 404 with no store access; untracked → 503; good → 200; replay → 200 `replayed`; previous token; oversize (413 with the right token, 404 with a wrong one); malformed → 400; source mismatch → 503;
- store compare-and-set across two connections, pending records only for tracked orders, replay TTL and cap;
- the scheduler: a 202 deferral, `delayMs` honored, restart survival with a second process running the job, lease takeover after a crash, retry on a throw;
- the abandon alert: stored once, logged, poll queued and its outcome recorded, idempotent on `dedupeKey`;
- order creation: `callbackUrl` only when on and only on create, `trackOrder` before returning, a queued `track` job when it fails, and nothing sent on misconfiguration.
