# Decision 0002: Payment provider and webhook handling

- Status: **proposed; owner decision required.** This memo creates no provider account or key and accepts no terms; later tracker claims are noted below. Live checkout stays disabled under this proposal pending the existing launch gates.
- Tracker: [getticketstub.com#27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27), "Decide and implement the payment provider before live checkout". Acceptance: **LIVE-01** (signatures, repeated and reordered events, refunds and refund allocation), FUL-02, FIN-09, FIN-10 in the [acceptance checklist](../acceptance-checklist.md).
- Decider: Product and frontend owner for checkout. The Finance and reliability owner decides revenue and tax treatment.
- Date: 2026-10-11

## Context

Source observations below are pinned to [getticketstub.com `6de6fdf`](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/tree/6de6fdf60ae5365c2fe4b4ab65a43c62a2ab6ca7) and [cost-intelligence `bc570fb`](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/tree/bc570fbb9db005c727c90c0a83fd6b4f99caebe7), observed 2026-10-12 UTC. They describe those revisions, not later main-branch changes or operational acceptance.

- **Tracker update, read 2026-10-12 UTC:** [getticketstub.com#27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27) now records a dated owner direction for Dodo Payments on all-digital orders and Stripe with Link on physical orders ([#64](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/64)); it also reports Dodo test-mode progress in candidate [#66](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/66). These are current tracker statements, not this memo's verification of authorization, eligibility, account setup, implementation or acceptance. The earlier Stripe Checkout alternative below requires reconciliation with the owners and provider eligibility review before implementation. Link works with several Stripe integrations, including Checkout; "Stripe with Link" alone does not select hosted Checkout. This memo does not approve Dodo for physical goods or select a new provider.

- **At the pinned app revision, no payment integration exists.**
  - `src/customer/pages/commerce.ts`: "Nothing here calls a payment, print or shipping API".
  - `POST /api/orders` hardcodes `mode: "sandbox"` and mints a fresh `ord_` id per request with no idempotency key, so a resend can duplicate an order.
  - `orders` is a JSON blob with no status or payment-reference column.
  - Refunds are simulated.
  - Analytics reserves `purchase` and `refund` for an authoritative payment confirmation.
- **No server-side authorized quote exists.** `src/app/api/orders/route.ts` takes `totalMinor` and each line's `totalMinor` from the request body and only range-checks them. `quoteId` is an optional client string that nothing looks up. Quotes are computed in the browser (`quote()` in `commerce.ts`, "a quote is not an authorization"). `FulfillmentQuote` / `OrderAuthorization` exist only in architecture-kit docs. Today the amount *does* come from the browser.
- **The receipt email is sent at order creation.** `POST /api/orders` calls `sendMail(..., receiptMail(order, ...))` right after `createOrder`, before any payment exists.
- **Stripe appears only in docs.** The architecture kit cites Stripe for webhook duplicates and ordering [S5] and for payout mapping [S6]. CFO.ai plan r2 assumes Stripe's US card rate but says it is "not a selected integrated payment provider".
- **We sell physical goods.** Printed stubs ship through Prodigi or fulfillment-connectors. Payment confirmation must gate a supplier order, and an `OrderAuthorization` binds the quote, bundle hash, amount and currency (FUL-02).
- **Host:** one Next.js process on GoDaddy Plus Launch. Preview and Publish share `/private`, so they share the app's SQLite file (`/private/ticketstub.sqlite`). The host's bot filter returned 403 to command-line requests (#27), and a webhook sender is a non-browser client.
- **The ledger cannot post yet.** `cost-intelligence` `ingestFinancial` is a `blockedBoundary` stub until the accounting leaf is delivered, and `0003_financial_ledger.sql` has no dispute or chargeback classification (see Dependencies).

## Options

| Option | Physical goods | Tax / liability | Webhooks |
| --- | --- | --- | --- |
| A. **Stripe Checkout (hosted)**, we are merchant of record | Yes | We own sales-tax registration and filing. Stripe Tax can calculate and collect via `automatic_tax` (check current pricing). | `Stripe-Signature` HMAC-SHA256 over `t.rawBody`. Library tolerance 5 min. Retries up to 3 days in live mode (sandbox: a few retries over hours). No ordering guarantee. Duplicates possible. |
| B. Stripe Managed Payments (Stripe as MoR) | **No.** Digital products only; physical goods are unsupported. | Stripe handles tax in 80+ countries | Same as A |
| C. Paddle (MoR) | **No.** Physical products are prohibited. | Paddle handles tax | `Paddle-Signature: ts=..;h1=..`, HMAC of `ts:rawBody`, 5 s tolerance. Answer within 5 s. No ordering guarantee; use `occurred_at`. |
| D. Lemon Squeezy (MoR) | **No.** "Physical goods of any kind" are prohibited. | LS handles tax | `X-Signature` HMAC-SHA256 hex of the raw body |

All four providers' fees vary by product and region; check current pricing for each. Other non-MoR processors (PayPal, Square, Adyen) were **not assessed**.

The merchant-of-record options (B-D) would cover a future digital-only product, such as a downloadable print file. They cannot sell the shipped print, which is the core SKU.

## Earlier alternative — pending owner reconciliation

**Earlier recommendation: Option A, Stripe Checkout, hosted page, `mode=payment`, one Checkout Session per checkout attempt on a server-authorized quote.** The following rationale and Stripe-specific design remain conditional on reconciliation with the newer tracker direction; they are not an accepted or implementation-ready specification.

- It is the only *reviewed* option that sells shipped goods.
- It matches the existing architecture references.
- Hosted Checkout collects card details on Stripe; fetched Charge snapshots can still contain sensitive card metadata. Minimize retained fields as in step 2.
- Enable Stripe Tax only after the owner decides the tax posture.
- Revisit an MoR (B) only for a separate digital-only SKU.

## Consequences (if the Stripe Checkout alternative is selected)

- We are the seller of record. We are responsible for disputes (including evidence deadlines, usually 7-21 days), refunds policy, customer support, and sales-tax nexus.
- New production secrets: a restricted key and a `whsec_` endpoint secret per environment. Test and live keys stay separate (billing mode `sandbox` vs `live`; FIN-10). Preview must never hold live keys.
- The webhook route must be reachable by Stripe through the host's bot filter. A 403 counts as a failed delivery. Verify this before launch, or route webhooks to a host that accepts them.
- The app DB needs payment columns and inbox tables (below). Sales, fees, refunds, disputes and payouts post to the finance ledger as distinct linked entries (architecture section 7; FIN-09), once the ledger can post.

## Implementation plan (once chosen; prerequisites first)

0. **Prerequisite: server-priced quote store.**
   - Persist a server-priced quote / `OrderAuthorization` (amount, currency, line prices, bundle hash, capability version, expiry) computed on the server, not in the browser.
   - `POST /api/orders` references it by id and **rejects** any order whose lines or total don't match, or whose authorization has expired.
   - Until this exists, nothing below may charge a card.
1. **Order before payment.** All new tables live in the app SQLite DB (`TICKETSTUB_DB`), alongside `orders`.
   - Add an idempotency key to `POST /api/orders` (client-generated UUID, unique index), so a retry returns the same order.
   - Add a `mode` column (`sandbox | live`) to `orders`, `checkout_attempts` and `payment_inbox`, set from the deployment's billing mode.
   - `checkout_attempts(order_id, attempt_n, provider_session_id unique, status, mode)`. Create each Checkout Session server-side from the stored authorization. Pass `client_reference_id` = order id and `metadata.authorization_id`. Use **`order_id:attempt_n`** as the Stripe `Idempotency-Key`: Stripe replays a key's saved response for at least 24 h and errors if its parameters change, so a retry after `checkout.session.expired` needs a new attempt. A unique index allows only one open attempt per order.
   - Move the receipt email and the analytics `purchase` event out of `POST /api/orders` into `fulfillCheckout`, after payment is confirmed (or rely on Stripe receipts). Order creation may send an "order started" note at most.
2. **Webhook ingress** `POST /api/payments/stripe/webhook` (Node runtime; exempt from CSRF and the Origin check):
   - Cap the body size, then read the **raw body** with `await request.text()` before any JSON parse.
   - Verify with `stripe.webhooks.constructEvent(raw, sig, secret)`, default 5-minute tolerance, never 0. Allow two secrets during rotation. Optionally also allowlist Stripe's published webhook IPs (owner action 5).
   - Reject when the signature fails or `livemode` doesn't match the deployment mode.
   - Then `INSERT` into `payment_inbox(event_id PK, type, object_id, mode, received_at, payload_sha256, status, lease_until)`. If the insert conflicts, return 200 (duplicate). Otherwise return 2xx immediately; do not fulfil inline.
   - We use snapshot events with a re-fetch (below), not thin events. Store only the minimum payload fields. Charge snapshots can contain card brand, last4 and fingerprint; treat event metadata as sensitive, and never retain full PAN or CVC in the app, logs or evidence.
3. **Processor** (in-process drain loop; a worker later):
   - Claim atomically and only rows of its own mode: `UPDATE payment_inbox SET status='processing', lease_until=? WHERE status='pending' AND mode=? ... RETURNING`. Expired leases return to `pending`.
   - Preview runs the processor against the shared `/private` DB **only if the owner allows it** (owner action 6). The default is that Preview does not run it until storage is split.
   - **Derive state from re-fetched Stripe objects, never from event order.** For the order, re-fetch with the deployment's own key:
     - the Checkout Session (with `line_items`) and its PaymentIntent and latest Charge;
     - the charge's refunds list (`GET /v1/refunds?charge=`, paginated), because a `charge.refunded` event carries a Charge and may cover several partial refunds;
     - the charge's Disputes.
   - Compute independent payment, refund and dispute dimensions from that snapshot:
     - `payment_state` = `awaiting_payment | paid | failed | expired`, plus `refunded_minor` = sum of refunds whose status is `succeeded` (a refund that later fails drops out of this sum, but does not itself restore authorization to ship);
     - `dispute_state` = `none | open | won | lost`, aggregated across **all** Disputes on the charge (Stripe allows more than one): `open` if any dispute has status `warning_needs_response`, `warning_under_review`, `needs_response` or `under_review`; otherwise `lost` if any is `lost`; otherwise `won` if any is `won`; otherwise `none`. `warning_closed` (an inquiry that closed without becoming a dispute) and `prevented` count as not open. A won dispute returns to `won`, not to a stuck `disputed`.
   - Read the local `state_version` before re-fetching, then conditionally write the derived snapshot only if that version still matches, incrementing it atomically. On conflict, discard the fetched snapshot and re-fetch; do not retry a stale snapshot against a newer version. A stale event triggers current-state derivation, not a forward-only transition. Reversals (failed refund, won dispute) update their own dimensions without automatically granting dispatch authority. Incomplete or conflicting provider reads hold dispatch for reconciliation.
4. **Fulfilment** `fulfillCheckout(sessionId)` (proposed contract; FUL-02/03):
   - The processor and success page (`success_url?session_id={CHECKOUT_SESSION_ID}`) call the same central guard and durable-intent path; the webhook remains the recovery trigger. Both must use the current reconciled snapshot, deployment mode and server authorization, never just the page callback or Session's paid flag.
   - **Central dispatch guard:** require `payment_status` of `paid` (or `no_payment_required` only for an explicitly authorized zero-price order), valid matching amount/currency/bundle/destination/expiry authorization, and `dispute_state` of `none` or `won`. Cancelled orders and fully refunded orders cannot dispatch. Any partial refund conservatively holds dispatch until the owners approve the line-level refund allocation and the app validates a renewed authorization for only the remaining items and amount. Pending, ambiguous or inconsistent refund outcomes also hold. An open dispute holds; a lost dispute goes to the owner. A closed inquiry or won dispute removes only the dispute hold and must still pass every other guard.
   - A refund failure/reversal updates the refund sum and Finance postings, but releases no cancellation, allocation or reconciliation hold by itself. Require reconciled refund evidence and a validated current/renewed authorization before considering dispatch; an ambiguous reversal never automatically ships the original bundle. If submission already occurred, use owner/connector cancellation or reconciliation, never a second purchase to repair payment state.
   - Persist one durable `fulfillment_intent(order_id, mode)` with authorization revision, stable connector submission identity, state and version before external work. Proposed states: `pending` (no send started), `submitted` (a durably recorded attempt has started; acceptance may be unconfirmed), `outcome_unknown` (timeout, interrupted submitted attempt or inconclusive recovery), `completed` (supplier acceptance reconciled to one external order identity; this does not mean shipped). A row's existence is not completion. A completed intent returns its stored external identity and never resubmits.
   - Claim/version the intent atomically. Only its current claimant may advance it, and `fulfillment-connectors` owns the stable submission identity, transport-attempt history, supplier idempotency and recovery fencing. Revalidate the authorization immediately before dispatch. An expired app/inbox lease alone never authorizes a new supplier purchase or releases the in-flight hold. A stale worker cannot submit under a superseded claim; proving that boundary is a connector implementation prerequisite.
   - Crash before send: resume a `pending` intent through the guard using its existing identity. If a send was recorded (`submitted`) but no response committed, classify it as `outcome_unknown` even if the process might have crashed before the actual network call. Resolve the existing identity through fulfillment-connectors before any resubmission. After acceptance then timeout, record the resolved external order and complete the intent without another purchase. Only authoritative evidence of no accepted order, connector-controlled retry of the same identity and a newly passed guard permit another attempt. If that evidence is unavailable, keep the hold and escalate. Concurrent recoverers use the same claimed identity and cannot each buy; a unique app row alone is insufficient.
   - Receipt and analytics delivery have independent durable outbox records keyed by `(mode, order_id, payment_confirmation_revision, notification_kind)` and separate sent/unknown outcomes; re-fetches of the same confirmation reuse that milestone revision and key. Enqueue each once after authoritative payment confirmation is committed, never at order creation or merely because a supplier row exists; a payment receipt must not claim shipment. Notification retries cannot re-enter supplier dispatch. Require downstream idempotency/dedupe under the same key or reconcile an unknown delivery before resending; a local sent flag alone cannot ensure one delivery. A refund discovered before delivery must be reflected in the message/current purchase-reversal analytics policy approved by the owners.
5. **Events to subscribe:**
   - `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
   - `charge.refunded`, `refund.updated`, `refund.failed`
   - `charge.dispute.created`, `charge.dispute.updated` (evidence deadline), `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`
   - nothing else.
6. **Economic dedupe and posting** (blocked until `ingestFinancial` is delivered):
   - Finance owns the versioned mapping from provider objects to economic effects and source lines, exposed through its ingestion contract; do not write directly to Finance tables. PaymentIntent identifies the sale, `re_` identifies a refund, and balance-transaction ids identify fee/dispute source objects, but an object id alone is not an effect key. Preserve mode, source-object identity, distinct source-line/effect identity and source revision so principal and fee on one balance transaction remain separate lines. Several webhook events for the same immutable effect/revision dedupe to one posting (FIN-02); changed evidence follows Finance correction/reversal rules.
   - Disputes: the withdrawal posts as `cash_movement`/`reversal`, the dispute fee as `fee`, and any reinstatement as a reversing `cash_movement`, each linked to the Dispute's `balance_transactions` ids with separate principal/fee/reinstatement source-line identities. The classification needs a dispute/chargeback value that the ledger doesn't have yet (Dependencies).
   - A failed refund after an earlier posting requires a Finance-approved append-only reversal/correction referencing that effective posting and its source evidence, not deletion or mutation of the original. Replaying that reversal produces no additional effect; classification and mapping approval remain Finance prerequisites.
7. **Tests for LIVE-01 (expected design outcomes; execution remains required):**
   - Fixtures for bad signature, stale timestamp, wrong mode, oversize body, duplicate `event.id`, and two events for one object.
   - Full refund before delayed `completed` or page callback: no supplier dispatch. Partial refund before either caller: hold the original bundle until approved allocation and validated remaining authorization; partial refunds summing to the total block dispatch. Refund failure after success: append-only Finance correction/reversal, fresh authorization review, and no automatic dispatch while ambiguous. `async_payment_failed` after `succeeded` re-fetches authoritative state rather than overwriting it by delivery order.
   - Dispute opened then won (funds reinstated), and dispute lost; dispute opened before fulfilment holds it.
   - Session expiry followed by a new attempt; an order whose total doesn't match its authorization is rejected.
   - Preview and Publish processors on one DB never claim each other's rows.
   - Concurrent success page and webhook/recovery: one intent and supplier identity, one reconciled external order, separately deduped receipt/purchase notifications. Crash after intent creation before send: resumable pending intent. Supplier acceptance then timeout (and crash after recording send but before response): outcome unknown, resolve before resubmit, no second purchase. Notification acceptance then timeout: reconcile/dedupe without supplier re-entry. Cancelled order and stale state-version conflict: no dispatch; conflict discards the snapshot and re-fetches.
   - A sandbox run via `stripe listen --forward-to` and `stripe trigger` (sandbox retries are short, so don't rely on them); then a test-mode end-to-end with reconciliation against the ledger.

## Dependencies (not changed by this memo)

- `cost-intelligence`: `ingestFinancial` must be delivered, and `0003_financial_ledger.sql` needs a dispute/chargeback classification (today: `sale`, `sale_refund`, ... but no dispute). This is for its owners to add; this memo does not edit it.
- The quote store in step 0, approved refund allocation/remaining authorization rules, fulfillment-connectors durable dispatch/recovery contract in step 4, and notification outbox/delivery dedupe. The app must consume the owning implementations; this memo implements none of them.

## Owner actions

1. **Reconcile:** confirm the dated Dodo/all-digital and Stripe-with-Link/physical direction in #27, provider eligibility and implementation ownership. Decide whether the earlier hosted Checkout alternative here applies; Link alone is not that choice. If Stripe Checkout is chosen, decide whether Stripe Tax is enabled and in which jurisdictions you register. No provider acceptance or live approval is recorded by this memo.
2. **Account and terms (only if selected):** create or activate the Stripe account under the company legal entity yourself. That includes business verification, bank account for payouts, the Stripe Services Agreement, and the statement descriptor. Agents must not accept terms or enter bank details. Check current pricing.
3. **Policies and disputes:**
   - Publish refund, shipping and support-contact policies on the site; Checkout links to them.
   - **Name a dispute-evidence owner** who watches dispute notices and submits evidence (or accepts) before each deadline, usually 7-21 days. Approve the proposed open-dispute hold, refund allocation/remaining authorization and reversal-review policy before implementation.
4. **Keys and refunds:**
   - **Decide where refunds are issued.** Recommended: the Stripe Dashboard only, so the app key needs Refunds read only. If the app issues refunds, it needs Refunds write and a separate review.
   - Create **test-mode** restricted keys first. Scope: Checkout Sessions write (create; includes read for `line_items`), PaymentIntents read, Charges read, Refunds read, **Disputes read**, **Balance transactions read** (needed for the sale-fee posting in step 6; dispute fees are already on the Dispute object). No Webhook Endpoints permission: register endpoints in the Dashboard.
   - Register the test webhook endpoint, and give the `whsec_` value to the GoDaddy **Preview** environment only.
   - Issue live keys only after LIVE-01 passes and you approve launch.
   - Never paste keys into issues, chat or evidence.
5. **Host:** confirm with GoDaddy that `POST /api/payments/stripe/webhook` from Stripe's published IPs bypasses the bot filter.
6. **Preview processor:** decide whether Preview may run the payment processor against the shared `/private` DB (mode-matched claims make it safe in principle), or must not until Preview and Publish storage are split. Default: not allowed.
7. **Then, after direction/eligibility reconciliation and prerequisite approval:** authorize the quote-store and implementation PRs in getticketstub.com and the LIVE-01 sandbox suite. A separate launch approval is needed to switch to live keys.

## Sources

- Stripe Link (usable with Checkout and other integrations): https://docs.stripe.com/payments/link
- Stripe Charge snapshot fields: https://docs.stripe.com/api/charges/object ; Session payment status: https://docs.stripe.com/api/checkout/sessions/object ; refund status: https://docs.stripe.com/api/refunds/object
- Stripe webhooks (signatures, retries, ordering, duplicates, IP allowlist): https://docs.stripe.com/webhooks
- Stripe event types (`charge.refunded` carries a Charge; dispute events): https://docs.stripe.com/api/events/types
- Stripe disputes lifecycle and fees: https://docs.stripe.com/disputes/how-disputes-work ; responding and `won`/`lost`: https://docs.stripe.com/disputes/responding
- Stripe list refunds by charge: https://docs.stripe.com/api/refunds/list
- Stripe Checkout fulfilment: https://docs.stripe.com/checkout/fulfillment
- Stripe idempotent requests (24 h, parameter mismatch errors): https://docs.stripe.com/api/idempotent_requests
- Stripe restricted keys (None/Read/Write per resource): https://docs.stripe.com/keys/restricted-api-keys
- Stripe Tax: https://docs.stripe.com/tax ; Managed Payments eligibility: https://docs.stripe.com/payments/managed-payments/eligibility
- Paddle signature verification: https://developer.paddle.com/webhooks/signature-verification ; delivery: https://developer.paddle.com/webhooks/about/respond-to-webhooks ; prohibited products: https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle
- Lemon Squeezy signing: https://docs.lemonsqueezy.com/help/webhooks/signing-requests ; prohibited products: https://docs.lemonsqueezy.com/help/getting-started/prohibited-products
- Pricing for every provider: check current pricing (https://stripe.com/pricing).
