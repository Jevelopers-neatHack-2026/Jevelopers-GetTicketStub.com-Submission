# Prodigi v4 sandbox adapter and secret-reference resolver

**Status:** implemented and covered by offline fixtures only. No request has been sent to Prodigi from this repository, so neither sandbox authentication nor any wire behavior has been confirmed against an account. Live mode does not exist.

Tracker: getticketstub.com #27 (Prodigi sandbox item) and [FC-02-SANDBOX](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/15).

## Modules

| Module | Exports | Purpose |
| --- | --- | --- |
| `src/prodigi-secrets.ts` | `createEnvServerSecretSource`, `PRODIGI_SANDBOX_SECRET_BINDING`, `SecretResolverError` | Server-side secret-reference resolver that implements the existing `ServerSecretSource` port used by `withServerSecret` |
| `src/prodigi-sandbox.ts` | `ProdigiSandboxClient`, `createProdigiQuotePort`, `mapQuoteRequest`, `mapOrderRequest`, `projectQuoteResponse`, `projectOrderResponse`, `toStatusResult`, `createFetchProdigiHttpPort`, `ProdigiSandboxError` | Prodigi v4 sandbox quote, order-create and order-read mapping |

## Secret references

Configuration names a credential by **reference** (`prodigi/sandbox/api-key`), never by value. A binding maps one reference to one provider, one credential class and one environment variable:

| Reference | Provider | Class | Environment variable |
| --- | --- | --- | --- |
| `prodigi/sandbox/api-key` | `prodigi` | `sandbox` | `PRODIGI_SANDBOX_API_KEY` |

This is the only predeclared binding. **No live binding exists and no `PRODIGI_API_KEY` binding is defined.**

Resolver rules:

- The environment is read on every `load` (no caching), so rotation takes effect on the next call. Only own properties count. A value must be 1–4096 visible ASCII characters with no whitespace; otherwise the result is `undefined` and `withServerSecret` fails with `server_secret_unavailable`.
- A lease is issued only when the reference, provider and requested mode all match, and only for mode `sandbox`. Simulated mode never receives a credential.
- Sandbox and live stay separate. A sandbox binding's variable must contain a `SANDBOX` token and no `LIVE`, `PROD` or `PRODUCTION` token, and a live binding's variable must not contain `SANDBOX`. One reference or variable cannot be bound twice.
- Live-class bindings are refused at construction unless the future flag `allowLiveCredentialBindings: true` is set. Even with the flag, no live lease can be issued, because `ProviderMode` has no live member. Live ordering stays a separate, future, owner-authorized launch step.
- Errors use fixed codes and messages and never include values.

Locally, the key lives in the git-ignored, owner-only `.env` (see `.env.example`). The package has no `.env` loader. The smoke command uses Node's built-in `--env-file`.

## Adapter

Base URL: `https://api.sandbox.prodigi.com/v4.0` (from `PRODIGI_SANDBOX_BASE_URL`), authenticated with the `X-API-Key` header. Endpoints come only from `PRODIGI_SANDBOX_OPERATION_ENDPOINTS`:

| Operation | Request | Mapping |
| --- | --- | --- |
| Quote | `POST /v4.0/quotes` | Private `QuoteProviderRequest` → `{ shippingMethod, destinationCountryCode, currencyCode, items: [{ sku, copies, attributes, assets: [{ printArea }] }] }` |
| Order create | `POST /v4.0/Orders` | Private `ProdigiOrderCreateInput` → `{ merchantReference, idempotencyKey, shippingMethod, recipient, items: [{ sku, copies, sizing, attributes, assets: [{ printArea, url, md5Hash }] }] }`. No `callbackUrl` or `metadata` is sent. |
| Status | `GET /v4.0/orders/{ord_…}` | Strict `ord_` ID; no body |

No accepted shared-contracts schema exists yet for orders or quotes (shared-contracts #24–#27), so the inputs are the connector's private types. `createProdigiQuotePort` adapts the client to the existing `BoundedQuotePort`, so `executePrivateQuote` normalizes Prodigi quotes through the same exact-money pipeline as the fixtures.

### Gates, in order, before any request

1. `sandboxCallsEnabled` must be exactly `true` (default off).
2. `evaluateProviderPolicy` must return `sandbox_prerequisites_verified` for the configured decision (SKU, destination country, shipping method, decision reference) via an injected `SandboxDecisionVerifier`.
3. The request's SKU, destination and shipping method must equal the verified decision.
4. `withServerSecret` must resolve a sandbox-class lease. The key exists only inside that callback.

Any failed gate throws `ProdigiSandboxError` with `sideEffectState: "not_dispatched"`. No secret is read and the HTTP port is not called.

### Response projection

- **Quote.** The adapter keeps exactly one quote whose `shipmentMethod` matches the request. Line mapping: `production` = `costSummary.items`, `shipping` = `costSummary.shipping`, `tax` = `totalTax`, `total` = `totalCost`. `fee` = `branding`, which is an explicit known zero when absent because the adapter never requests branded inserts. Absent tax or total values stay unknown, never zero. Amounts must be decimal strings in the requested currency (USD, GBP, EUR, CAD or AUD at scale 2). The docs say `totalCost` includes tax but not whether line amounts include it, so the tax basis comes only from exact reconciliation (`excluded` if lines + tax = total, `included` if lines = total and tax > 0, otherwise `unknown`). Prodigi documents no quote ID or expiry, so `providerQuoteReference` is a local SHA-256 digest and expiry and lead time are `unknown/not_disclosed`. Only issue `errorCode`s survive, as warnings; descriptions are dropped.
- **Order.** Outcome (`created`, `onHold`, `createdWithIssues`, `alreadyExists` for create; `ok` for read) is compared case-insensitively, because the docs mix casing. The observation keeps the order ID, timestamps, stage, step details, issue codes and shipment ID, status, carrier, tracking number and dispatch date. Recipient, addresses, asset URLs, tracking URLs, charges and metadata are dropped.
- **Status mapping.** `Cancelled` maps to `cancelled`. `Complete` maps to `shipped` (all shipments notified, not delivered). Any step in `Error` maps to `unknown`. `inProduction` or `shipping` started maps to `in_production`. Anything else maps to `accepted`.

### Failures

Each failure is a `ProdigiSandboxError` with a fixed code and message, a `sideEffectState`, and the HTTP status. Provider bodies are never copied.

- 400 → `validation_failed`, 401 or 403 → `authentication_failed`, 404 → `not_found`, 429 → `rate_limited`. These are `not_dispatched`.
- Other statuses → `provider_unavailable`. Transport errors → `provider_unavailable`, or `timeout` (default 30 s, maximum 60 s). Malformed bodies → `invalid_response`.
- For order creation, every uncertain outcome is `sideEffectState: "unknown"` and must be reconciled with a read, not retried blindly. For quotes and reads it is `not_dispatched`.

The fetch port allows only the sandbox origin and sets `redirect: "error"`.

## Tests

`npm run test:prodigi-sandbox` (also part of `npm test`) runs `tests/prodigi-sandbox-suite.mjs` with an empty environment. It replaces `globalThis.fetch` with a guard and asserts zero network use. The fixtures in `tests/prodigi-sandbox-fixtures.mjs` are synthetic and shaped from the public reference (checked 2026-10-11). They are **not recordings** of sandbox traffic.

## Not done (needs owner approval)

1. **One authenticated sandbox quote or read.** This needs explicit owner approval and an owner-named SKU, destination and shipping method. The command makes exactly one request and never creates an order:

   ```sh
   npm run build
   node --env-file=.env scripts/prodigi-sandbox-smoke.mjs --owner-approved \
     --decision-reference <owner-decision-ref> --sku <SKU> --country <CC> --shipping <Budget|Standard|StandardPlus|Express|Overnight> \
     [--currency USD] [--copies 1] [--attributes '{"<attr>":"<value>"}']
   ```

   The script's verifier is an operator attestation, not product or account evidence. Output is sanitized: it contains no key, recipient or raw body.
2. **Confirm wire details from that read:** amount representation (string versus number), `totalTax`/`totalCost` presence and tax basis, accepted `shippingMethod` casing for quotes (the docs disagree), and the outcome casing. Replace synthetic fixtures with sanitized recordings.
3. **Print-production approval** of one SKU and print specification, destination and shipping method, and a real `SandboxDecisionVerifier` that resolves that evidence.
4. **A sandbox order-create test**, under separate owner approval. Then update the provider matrix's `implementation` and `accountTested` fields with the evidence.
5. Cancellation, callbacks, runtime `ProviderAdapter` wiring and live mode remain out of scope.
