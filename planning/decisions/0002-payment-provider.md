# Decision 0002: Payment provider and webhook handling

- Status: **proposed; owner decision required.** No provider account, key, or terms acceptance exists. Live checkout stays disabled.
- Tracker: [getticketstub.com#27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27), "Decide and implement the payment provider before live checkout". Acceptance: **LIVE-01** (signatures, repeated and reordered events, refunds and refund allocation), FUL-02, FIN-09, FIN-10 in the [acceptance checklist](../acceptance-checklist.md).
- Decider: Product and frontend owner for checkout. The Finance and reliability owner decides revenue and tax treatment.
- Date: 2026-10-11

## Context

- **No payment code exists.**
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

## Recommendation

**Option A: Stripe Checkout, hosted page, `mode=payment`, one Checkout Session per checkout attempt on a server-authorized quote.**

- It is the only *reviewed* option that sells shipped goods.
- It matches the existing architecture references.
- Hosted Checkout keeps card data off our host (lowest PCI scope).
- Enable Stripe Tax only after the owner decides the tax posture.
- Revisit an MoR (B) only for a separate digital-only SKU.

## Consequences

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
   - We use snapshot events with a re-fetch (below), not thin events. Store only the minimum payload fields; no card data exists in events.
3. **Processor** (in-process drain loop; a worker later):
   - Claim atomically and only rows of its own mode: `UPDATE payment_inbox SET status='processing', lease_until=? WHERE status='pending' AND mode=? ... RETURNING`. Expired leases return to `pending`.
   - Preview runs the processor against the shared `/private` DB **only if the owner allows it** (owner action 6). The default is that Preview does not run it until storage is split.
   - **Derive state from re-fetched Stripe objects, never from event order.** For the order, re-fetch with the deployment's own key:
     - the Checkout Session (with `line_items`) and its PaymentIntent and latest Charge;
     - the charge's refunds list (`GET /v1/refunds?charge=`, paginated), because a `charge.refunded` event carries a Charge and may cover several partial refunds;
     - the charge's Disputes.
   - Compute two independent fields from that snapshot:
     - `payment_state` = `awaiting_payment | paid | failed | expired`, plus `refunded_minor` = sum of refunds whose status is `succeeded` (a refund that later fails drops out, so the order returns to fully paid);
     - `dispute_state` = `none | open | won | lost`, aggregated across **all** Disputes on the charge (Stripe allows more than one): `open` if any dispute has status `warning_needs_response`, `warning_under_review`, `needs_response` or `under_review`; otherwise `lost` if any is `lost`; otherwise `won` if any is `won`; otherwise `none`. `warning_closed` (an inquiry that closed without becoming a dispute) and `prevented` count as not open. A won dispute returns to `won`, not to a stuck `disputed`.
   - Write the derived snapshot with a compare-and-set on a `state_version` (or the fetched objects' fingerprint), not a forward-only ordering. A stale event just re-derives the same state; a reversal (failed refund, won dispute) is applied, not discarded.
4. **Fulfilment** `fulfillCheckout(sessionId)`:
   - Safe to call repeatedly and concurrently.
   - Runs only when `payment_status` is `paid` (or `no_payment_required`) **and** `dispute_state` is not `open`. A dispute opened before the supplier order holds fulfilment only while it is open; a closed inquiry or a won dispute releases it, and a lost one goes to the owner.
   - Writes a unique `fulfillment(order_id)` row before it submits to the supplier, then sends the receipt and `purchase` event.
   - Is called both by the processor and by the success page (`success_url?session_id={CHECKOUT_SESSION_ID}`). The webhook remains the guarantee.
5. **Events to subscribe:**
   - `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
   - `charge.refunded`, `refund.updated`, `refund.failed`
   - `charge.dispute.created`, `charge.dispute.updated` (evidence deadline), `charge.dispute.closed`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`
   - nothing else.
6. **Economic dedupe and posting** (blocked until `ingestFinancial` is delivered):
   - Ledger entries are keyed by Stripe object id, not event id, because Stripe may emit two events for one effect: PaymentIntent for the sale, `re_` id for each refund, and balance-transaction id for fees and dispute money movements. A replayed effect produces no new posting (FIN-02 pattern).
   - Disputes: the withdrawal posts as `cash_movement`/`reversal`, the dispute fee as `fee`, and any reinstatement as a reversing `cash_movement`, each keyed by the Dispute's `balance_transactions` ids. The classification needs a dispute/chargeback value that the ledger doesn't have yet (Dependencies).
7. **Tests for LIVE-01:**
   - Fixtures for bad signature, stale timestamp, wrong mode, oversize body, duplicate `event.id`, and two events for one object.
   - `refund` before `completed`, `async_payment_failed` after `succeeded`, partial refunds summing to the total, and a refund that fails after succeeding.
   - Dispute opened then won (funds reinstated), and dispute lost; dispute opened before fulfilment holds it.
   - Session expiry followed by a new attempt; an order whose total doesn't match its authorization is rejected.
   - Preview and Publish processors on one DB never claim each other's rows.
   - A concurrent success page and webhook.
   - A sandbox run via `stripe listen --forward-to` and `stripe trigger` (sandbox retries are short, so don't rely on them); then a test-mode end-to-end with reconciliation against the ledger.

## Dependencies (not changed by this memo)

- `cost-intelligence`: `ingestFinancial` must be delivered, and `0003_financial_ledger.sql` needs a dispute/chargeback classification (today: `sale`, `sale_refund`, ... but no dispute). This is for its owners to add; this memo does not edit it.
- The quote store in step 0.

## Owner actions

1. **Decide:** Stripe Checkout (recommended) or another option. Also decide whether Stripe Tax is enabled and in which jurisdictions you register.
2. **Account and terms:** create or activate the Stripe account under the company legal entity yourself. That includes business verification, bank account for payouts, the Stripe Services Agreement, and the statement descriptor. Agents must not accept terms or enter bank details. Check current pricing.
3. **Policies and disputes:**
   - Publish refund, shipping and support-contact policies on the site; Checkout links to them.
   - **Name a dispute-evidence owner** who watches dispute notices and submits evidence (or accepts) before each deadline, usually 7-21 days. Decide whether an open dispute holds fulfilment.
4. **Keys and refunds:**
   - **Decide where refunds are issued.** Recommended: the Stripe Dashboard only, so the app key needs Refunds read only. If the app issues refunds, it needs Refunds write and a separate review.
   - Create **test-mode** restricted keys first. Scope: Checkout Sessions write (create; includes read for `line_items`), PaymentIntents read, Charges read, Refunds read, **Disputes read**, **Balance transactions read** (needed for the sale-fee posting in step 6; dispute fees are already on the Dispute object). No Webhook Endpoints permission: register endpoints in the Dashboard.
   - Register the test webhook endpoint, and give the `whsec_` value to the GoDaddy **Preview** environment only.
   - Issue live keys only after LIVE-01 passes and you approve launch.
   - Never paste keys into issues, chat or evidence.
5. **Host:** confirm with GoDaddy that `POST /api/payments/stripe/webhook` from Stripe's published IPs bypasses the bot filter.
6. **Preview processor:** decide whether Preview may run the payment processor against the shared `/private` DB (mode-matched claims make it safe in principle), or must not until Preview and Publish storage are split. Default: not allowed.
7. **Then:** authorize the quote-store and implementation PRs in getticketstub.com and the LIVE-01 sandbox suite. A separate launch approval is needed to switch to live keys.

## Sources

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
