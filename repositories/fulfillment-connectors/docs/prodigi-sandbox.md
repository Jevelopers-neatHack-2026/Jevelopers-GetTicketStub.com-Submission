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
| Quote | `POST /v4.0/quotes` | Private `QuoteProviderRequest` → `{ shippingMethod, destinationCountryCode, currencyCode, items: [{ sku, copies, attributes, assets: [{ printArea }] }] }`. `shippingMethod` uses the quote reference's lowercase values (`budget`, `standard`, `standardplus`, `express`, `overnight`). |
| Order create | `POST /v4.0/Orders` | Private `ProdigiOrderCreateInput` → `{ merchantReference, idempotencyKey, shippingMethod, recipient, items: [{ sku, copies, sizing, attributes, assets: [{ printArea, url, md5Hash }] }] }`. `shippingMethod` uses the order reference's PascalCase values (`Budget`, `Standard`, `StandardPlus`, `Express`, `Overnight`). No `callbackUrl` or `metadata` is sent. |
| Status | `GET /v4.0/orders/{ord_…}` | Strict `ord_` ID; no body |

No accepted shared-contracts schema exists yet for orders or quotes (shared-contracts #24–#27), so the inputs are the connector's private types. `createProdigiQuotePort` adapts the client to the existing `BoundedQuotePort`, so `executePrivateQuote` normalizes Prodigi quotes through the same exact-money pipeline as the fixtures.

### Gates, in order, before any request

None of these steps reads a secret or sends anything until step 6.

1. Input validation and mapping (`mapQuoteRequest`, `mapOrderRequest`, the strict `ord_` ID check).
2. The request's SKU, destination and shipping method must equal the configured decision.
3. `sandboxCallsEnabled` must be exactly `true` (default off).
4. The caller's `AbortSignal`, if given, must not already be aborted. An aborted signal throws `aborted` / `not_dispatched`.
5. `evaluateProviderPolicy`, called with `adapterId: PRODIGI_SANDBOX_ADAPTER_ID`, must return `sandbox_call_permitted` with `providerCallPermitted: true` for the operation's exact route. This needs the configured decision (SKU, destination country, shipping method, decision reference) to pass an injected `SandboxDecisionVerifier`. Without the adapter ID the policy still returns `sandbox_prerequisites_verified` with `providerCallPermitted: false`, which the adapter refuses.
6. `withServerSecret` must resolve a sandbox-class lease. The key exists only inside that callback. The signal is checked once more just before the request goes to the HTTP port.

Any failed gate throws `ProdigiSandboxError` with `sideEffectState: "not_dispatched"`. The HTTP port is not called, and no secret is read before step 6.

### Response projection

- **Quote.** The adapter keeps exactly one quote whose `shipmentMethod` matches the request. Line mapping: `production` = `costSummary.items`, `shipping` = `costSummary.shipping`, `tax` = `totalTax`, `total` = `totalCost`. `fee` = `branding`, which is an explicit known zero when absent because the adapter never requests branded inserts. Absent tax or total values stay unknown, never zero. Amounts must be decimal strings in the requested currency (USD, GBP, EUR, CAD or AUD at scale 2). The docs say `totalCost` includes tax but not whether line amounts include it, so the tax basis comes only from exact reconciliation (`excluded` if lines + tax = total, `included` if lines = total and tax > 0, otherwise `unknown`). Prodigi documents no quote ID or expiry, so `providerQuoteReference` is a local SHA-256 digest and expiry and lead time are `unknown/not_disclosed`. Only issue `errorCode`s survive, as warnings; descriptions are dropped.
- **Order.** Outcome (`created`, `onHold`, `createdWithIssues`, `alreadyExists` for create; `ok` for read) is compared case-insensitively, because the docs mix casing. The observation keeps the order ID, timestamps, stage, step details, issue codes and shipment ID, status, carrier name and dispatch date. Recipient, addresses, asset URLs, tracking numbers, tracking URLs, charges and metadata are dropped. A tracking number usually reveals the delivery town or postcode and the signer, so only `hasTrackingNumber` is kept; reconcile shipments by order and shipment ID. The carrier name is display-only. If it is not plain text (letters, digits, spaces and `._:/#()&,'+-`), it becomes `null` and the read still succeeds. Shipment ID, status, order ID, stage and step details stay strict.
- **`alreadyExists`.** Prodigi returns the existing order for a reused idempotency key, even when that order's items differ from the new request. The adapter does not compare them; callers must compare the returned order with their own record before treating it as the same order.
- **Status mapping.** `Cancelled` maps to `cancelled`. `Complete` maps to `shipped` (all shipments notified, not delivered). Any step in `Error` maps to `unknown`. `inProduction` or `shipping` started maps to `in_production`. Anything else maps to `accepted`.

### Failures

Each failure is a `ProdigiSandboxError` with a fixed code and message, a `sideEffectState`, and the HTTP status. Provider bodies are never copied.

- 400 → `validation_failed`, 401 or 403 → `authentication_failed`, 404 → `not_found`, 429 → `rate_limited`. These are `not_dispatched`.
- Other statuses → `provider_unavailable`. Transport errors → `provider_unavailable`, or `timeout` (default 30 s, maximum 60 s). Malformed bodies → `invalid_response`.
- A failure after the request reached the HTTP port (including a response whose fields throw when read) is never reported as `credential_unavailable` or `not_dispatched`. For order creation it is `provider_unavailable` with `sideEffectState: "unknown"`: the order may or may not exist.
- For order creation, every uncertain outcome is `sideEffectState: "unknown"` and must be reconciled with a read, not retried blindly. For quotes and reads it is `not_dispatched`.

The fetch port allows only the sandbox origin and sets `redirect: "error"`. It rejects a declared `content-length` over 1 MiB and otherwise streams the body with a byte counter, cancelling it past 1 MiB. Non-2xx bodies are discarded unread.

## Tests

`npm run test:prodigi-sandbox` (also part of `npm test`) runs `tests/prodigi-sandbox-suite.mjs` in a child process with a credential-free environment (only `PATH` and temp-directory variables). The suite never reads `process.env` for credentials: every resolver receives an injected env, and a test plants a sentinel `PRODIGI_SANDBOX_API_KEY` in `process.env` and asserts it never reaches a request.

`tests/prodigi-sandbox-network-guard.mjs` is preloaded with `node --import`, before any `dist/` module loads. It makes `fetch`, `http`/`https` `request`/`get`, `net.connect`/`createConnection`, `net.Socket.prototype.connect` and `tls.connect` throw and counts each attempt. The runner pins the case IDs and fails if a case is missing, renamed or reordered. It reports the measured `externalProviderCalls` and fails unless that value is 0. This is an in-process guard, not OS-level network denial. The cases include 403, a pre-aborted signal, a throwing response getter, an oversized streamed body, and the smoke script refusing to run without `--owner-approved`. The fixtures in `tests/prodigi-sandbox-fixtures.mjs` are synthetic and shaped from the public reference (checked 2026-10-11). They are **not recordings** of sandbox traffic.

## Owner decision (2026-10-12)

The owner delegated this decision on 2026-10-12. Rows R1-R3 of integration-evals decision 0003 ([PR #39](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/39); `planning/decisions/0003-owner-delegated-decisions-2026-10-12.md` once merged; delegation recorded on [getticketstub.com#27](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/27#issuecomment-6116953222)) record it.

- **Sandbox validation SKU:** `GLOBAL-PHO-4X6`. A C-type silver-halide photo print, 102 x 152 mm (4 x 6 in), lustre. Prodigi's public [C-types page](https://www.prodigi.com/products/prints-and-posters/photo-prints/c-types/), checked 2026-10-12 with no API call, lists it as fulfilled in the US. That page lists lustre, gloss and metallic for the product family, not per SKU, so only the product-details read confirms lustre for this SKU. `GLOBAL-PHO-4X6-PRO` (UK and US) is a fitting alternative. 4X6 was chosen for its wider fulfilment.
- **Validation print spec:** one `default` print area, landscape 6 x 4 in, full bleed at 300 dpi (1800 x 1200 px), sRGB JPG, finish lustre, sizing `fillPrintArea`. Bleed, safe area and the stub layout are print-production's template (PP-03, print-production #6).
- **Not decided: the customer-facing mapping.** getticketstub.com sells the `print` tier as matte, foil or holo, in Classic stub (2 x 5.5 in) or Stamp (2 x 3 in). Lustre is not matte, this SKU has no foil or holo, and the customer would receive a 6 x 4 sheet rather than a trimmed stub. That mapping remains an open product decision.
- **Destination and shipping:** `US`, `Standard`.

This names the SKU, destination and shipping that items 1 and 3 below ask for. It is **not** an approval to run the smoke command, and it is not account evidence. The authenticated read, print-production's roster and template acceptance, and the real `SandboxDecisionVerifier` remain open. The read confirms the attribute key and value for the finish and the US `shipsTo`.

## Not done (needs owner approval)

1. **One authenticated sandbox quote or read.** This needs explicit owner approval. The SKU, destination and shipping method are named in the [owner decision](#owner-decision-2026-10-12): `GLOBAL-PHO-4X6`, `US`, `Standard`. The command makes exactly one request and never creates an order:

   ```sh
   npm run build
   node --env-file=.env scripts/prodigi-sandbox-smoke.mjs --owner-approved \
     --decision-reference <owner-decision-ref> --sku <SKU> --country <CC> --shipping <Budget|Standard|StandardPlus|Express|Overnight> \
     [--currency USD] [--copies 1] [--attributes '{"<attr>":"<value>"}']
   ```

   The script's verifier is an operator attestation, not product or account evidence. Output is sanitized: it contains no key, recipient or raw body.
2. **Confirm wire details from that read:** amount representation (string versus number), `totalTax`/`totalCost` presence and tax basis, accepted `shippingMethod` casing for quotes (the adapter sends the documented lowercase values; the docs' own quote example uses `Budget`, so try PascalCase first if the quote fails with `validationFailed`), and the outcome casing. Replace synthetic fixtures with sanitized recordings.
3. **Print-production approval** of one SKU and print specification, destination and shipping method, and a real `SandboxDecisionVerifier` that resolves that evidence.
4. **A sandbox order-create test**, under separate owner approval. Then update the provider matrix's per-operation `implementation` and `accountTested` fields, and `sandboxAdapter`, with the evidence.
5. Cancellation, runtime `ProviderAdapter` wiring and live mode remain out of scope. Callback intake and authenticated reconciliation are covered in [Prodigi callbacks](prodigi-callbacks.md). They are offline-only and disabled by default.
