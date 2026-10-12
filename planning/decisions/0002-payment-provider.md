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
- **Stripe appears only in docs.** The architecture kit cites Stripe for webhook duplicates and ordering [S5] and for payout mapping [S6]. CFO.ai plan r2 assumes Stripe's US card rate but says it is "not a selected integrated payment provider".
- **We sell physical goods.** Printed stubs ship through Prodigi or fulfillment-connectors. Payment confirmation must gate a supplier order, and an `OrderAuthorization` binds the quote, bundle hash, amount and currency (FUL-02).
- **Host:** one Next.js process on GoDaddy Plus Launch; Preview and Publish share `/private`. The host's bot filter returned 403 to command-line requests (#27), and a webhook sender is a non-browser client.

## Options

| Option | Physical goods | Tax / liability | Webhooks |
| --- | --- | --- | --- |
| A. **Stripe Checkout (hosted)**, we are merchant of record | Yes | We own sales-tax registration and filing. Stripe Tax can calculate and collect via `automatic_tax` (check current pricing). | `Stripe-Signature` HMAC-SHA256 over `t.rawBody`. Library tolerance 5 min. Retries up to 3 days in live mode. No ordering guarantee. Duplicates possible. |
| B. Stripe Managed Payments (Stripe as MoR) | **No.** Digital products only; physical goods are unsupported. | Stripe handles tax in 80+ countries | Same as A |
| C. Paddle (MoR) | **No.** Physical products are prohibited. | Paddle handles tax | `Paddle-Signature: ts=..;h1=..`, HMAC of `ts:rawBody`, 5 s tolerance. Answer within 5 s. No ordering guarantee; use `occurred_at`. |
| D. Lemon Squeezy (MoR) | **No.** "Physical goods of any kind" are prohibited. | LS handles tax | `X-Signature` HMAC-SHA256 hex of the raw body |

All four providers' fees vary by product and region; check current pricing for each.

The merchant-of-record options (B-D) would cover a future digital-only product, such as a downloadable print file. They cannot sell the shipped print, which is the core SKU.

## Recommendation

**Option A: Stripe Checkout, hosted page, `mode=payment`, one Checkout Session per authorized quote.**

- It is the only option here that sells shipped goods.
- It matches the existing architecture references.
- Hosted Checkout keeps card data off our host (lowest PCI scope).
- Enable Stripe Tax only after the owner decides the tax posture.
- Revisit an MoR (B) only for a separate digital-only SKU.

## Consequences

- We are the seller of record. We are responsible for disputes, refunds policy, customer support, and sales-tax nexus.
- New production secrets: a restricted secret key and a `whsec_` endpoint secret per environment. Test and live keys stay separate (billing mode `sandbox` vs `live`; FIN-10). Preview must never hold live keys.
- The webhook route must be reachable by Stripe through the host's bot filter. A 403 counts as a failed delivery. Verify this before launch, or route webhooks to a host that accepts them.
- The `orders` storage needs a payment state, a provider reference and an inbox table (below). Sales, fees, refunds and payouts post to the finance ledger as distinct linked entries (architecture section 7; FIN-09).

## Implementation plan (ready to build once chosen)

1. **Order before payment.**
   - Add an idempotency key to `POST /api/orders` (client-generated UUID, unique index), so a retry returns the same order.
   - Persist `payment_state` (`awaiting_payment | paid | refunded_partial | refunded | failed | disputed`) as a column, plus `provider_session_id` (unique).
   - Create the Checkout Session server-side from the stored, authorized quote. The amount never comes from the browser.
   - Pass `client_reference_id` = order id and `metadata.authorization_id`, and send the order id as the Stripe `Idempotency-Key` on session creation.
2. **Webhook ingress** `POST /api/payments/stripe/webhook` (Node runtime; exempt from CSRF and the Origin check):
   - Read the **raw body** with `await request.text()` before any JSON parse.
   - Verify with `stripe.webhooks.constructEvent(raw, sig, secret)`, default 5-minute tolerance, never 0. Allow two secrets during rotation.
   - Reject when the signature fails or `livemode` doesn't match the deployment mode.
   - Then, in one transaction, `INSERT` into `payment_inbox(event_id PK, type, object_id, livemode, received_at, payload_sha256, status)`. If the insert conflicts, return 200 (duplicate). Otherwise return 2xx immediately; do not fulfil inline.
   - Store only the minimum payload fields; no card data exists in events.
3. **Processor** (in-process drain loop; a worker later):
   - Claim pending inbox rows.
   - For each one, **re-fetch the authoritative object** (Checkout Session with `line_items`, PaymentIntent, Refund) from the API. Don't trust event order or the snapshot.
   - Derive the order's target state from that object.
   - Apply it with a monotonic transition table, compare-and-set on the current state. This makes late or stale events no-ops and lets `refund` arrive before `completed` safely.
4. **Fulfilment** `fulfillCheckout(sessionId)`:
   - Safe to call repeatedly and concurrently.
   - Runs only when `payment_status` is `paid` (or `no_payment_required`).
   - Writes a unique `fulfillment(order_id)` row before it submits to the supplier.
   - Is called both by the processor and by the success page (`success_url?session_id={CHECKOUT_SESSION_ID}`). The webhook remains the guarantee.
5. **Events to subscribe:**
   - `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`
   - `charge.refunded`, `refund.updated`
   - `charge.dispute.created`
   - nothing else.
6. **Economic dedupe:** ledger entries are keyed by Stripe object id (PaymentIntent, Refund, balance transaction), not event id, because Stripe may emit two events for one effect. A replayed effect produces no new posting (FIN-02 pattern).
7. **Tests for LIVE-01:**
   - Fixtures for bad signature, stale timestamp, wrong mode, duplicate `event.id`, and two events for one object.
   - `refund` before `completed`, `async_payment_failed` after `succeeded`, and partial refunds summing to the total.
   - A concurrent success page and webhook.
   - A sandbox run via `stripe listen --forward-to` and `stripe trigger`; then a test-mode end-to-end with reconciliation against the ledger.

## Owner actions

1. **Decide:** Stripe Checkout (recommended) or another option. Also decide whether Stripe Tax is enabled and in which jurisdictions you register.
2. **Account and terms:** create or activate the Stripe account under the company legal entity yourself. That includes business verification, bank account for payouts, the Stripe Services Agreement, and the statement descriptor. Agents must not accept terms or enter bank details. Check current pricing.
3. **Policies:** publish refund, shipping and support-contact policies on the site; Checkout links to them.
4. **Keys:**
   - Create **test-mode** restricted keys first. Scope them to Checkout Sessions write, PaymentIntents/Refunds/Charges read, and Webhook Endpoints.
   - Register the test webhook endpoint, and give the `whsec_` value to the GoDaddy **Preview** environment only.
   - Issue live keys only after LIVE-01 passes and you approve launch.
   - Never paste keys into issues, chat or evidence.
5. **Host:** confirm with GoDaddy that `POST /api/payments/stripe/webhook` from Stripe's published IPs bypasses the bot filter.
6. **Then:** authorize the implementation PR in getticketstub.com and the LIVE-01 sandbox suite. A separate launch approval is needed to switch to live keys.

## Sources

- Stripe webhooks (signatures, retries, ordering, duplicates): https://docs.stripe.com/webhooks
- Stripe Checkout fulfilment: https://docs.stripe.com/checkout/fulfillment
- Stripe idempotent requests: https://docs.stripe.com/api/idempotent_requests
- Stripe Tax: https://docs.stripe.com/tax ; Managed Payments eligibility: https://docs.stripe.com/payments/managed-payments/eligibility
- Paddle signature verification: https://developer.paddle.com/webhooks/signature-verification ; delivery: https://developer.paddle.com/webhooks/about/respond-to-webhooks ; prohibited products: https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle
- Lemon Squeezy signing: https://docs.lemonsqueezy.com/help/webhooks/signing-requests ; prohibited products: https://docs.lemonsqueezy.com/help/getting-started/prohibited-products
- Pricing for every provider: check current pricing (https://stripe.com/pricing).
