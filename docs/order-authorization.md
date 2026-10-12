# Order authorization consumer (simulated, development only)

`src/order-authorization-client.ts` is a **simulated, development-only** consumer of the TicketStub order-authorization port (`ticketstub.order-authorization/1`, merged application commit `7d2dd17810425f0b06e07dadbba3e173800ea5fd`, tree `b20931363cb86e60bdb87f650ed2b444d30ca8ea`). It implements the optional `AuthorizationVerifier.revalidateBeforeDispatch` hook together with `verifyAndClaim`, so the dispatch-time revalidation the producer requires is not deferred.

## What this is not

- It is not integration with the live issuer, not a consumer-conformance receipt, and not a scope completion claim. It was exercised only against a fake issuer, a fake HTTP port and the producer's pinned fixture verifier.
- It creates no endpoint, base URL, `fetch`, `.env` read or key. Every byte leaves through an injected `OrderAuthorizationHttpPort`; the port owns the origin-only base URL and TLS. The consumer key is leased per request through the existing `withServerSecret` source and is never cached.
- It accepts no canonical binding and sets no `sourceRevision`. The production bundle, quote, destination and `OrderAuthorization` bindings stay unaccepted, and the runtime's `sandbox_disabled` and `contract_missing` gates are untouched.
- Issuer responses are not message-authenticated. Trust is limited to the transport (TLS) plus the field bindings below.
- It never decodes the token. The token is an opaque string read from `authorizationEnvelope.token`; nothing else in the envelope is used.

## Modes and providers

Only the connector `simulated` mode is accepted, and it maps to the app provider `sandbox`. A connector `sandbox` or `live` mode throws before any request. The app provider `prodigi` is never named, and a provider id outside the injected `trustedProviderIds` throws. `cancel` is unsupported by the producer and returns `rejected` before any request. A malformed envelope (not `{ schema: "ticketstub.order-authorization/1", token: <string up to 8192> }`) returns `rejected`.

## Trusted terms

The producer compares `expect.terms` with the record behind the token. If a consumer echoes the token's own terms the check is meaningless, so the terms come only from an injected `TrustedTermsSource` that returns the full terms from exact local bindings, with `provenance.kind` `development_fixture` and a `sha256:` digest. Anything else rejects before any request: a `missing` result, a throw, other provenance, or a field that is absent or malformed (`sku` may be `null`, never absent). The consumer cross-checks `terms.quote.id` with `quote.quoteId`, `terms.quote.amountMinor` with `amountMinor` and `quote.totalMinor`, and the currency across all three.

## Flow

1. Build `expect` (`tenant`, `project: "stub:<id>"`, `fulfillment.submit`, `sandbox`, terms), the claim key and the local `actionId`.
2. POST `/api/order-authorizations/claim`.
3. If the commit is ambiguous, POST `/api/order-authorizations/claims/lookup` with the same key and no `authorizationId`. `found:true` uses that claim. `found:false` retries the claim **once** with the same key. `authorizationClaimed:true` is `rejected`. A second ambiguity throws. A new key is never minted.
4. Require `claim.actionId` to equal the locally computed `act_` + `sha256(canonical{tenant, project:{kind:"stub",id}, action, orderRef})[0:32]`.
5. POST `/api/order-authorizations/revalidate` with the trusted terms and `claimReference`. Every path to `claimed` ends here: a fresh claim, a replay and a lookup hit. The lookup `authority` is computed against the record's own terms, so it proves nothing about the connector's terms and is not used.

### Claim key

`"fcc1:" + sha256hex(canonicalJson({v:1, consumer:"fulfillment-connectors", providerId, mode, tenant, project:"stub:<id>", action:"fulfillment.submit", orderRef}))` (69 characters). It excludes the token, the delivery idempotency key, the request fingerprint and every secret. Distinct delivery keys share one issuer claim, and the attempt store's `actionId` and `authorizationId` uniqueness still prevents a second dispatch. Because the issuer derives tokens from the record and its signing key, a token key that included the token's bytes would change when the issuer rotates `CONTEXT_SECRET`, stranding a claim that committed with a lost response. This key survives that rotation.

### Response bindings

`/revalidate` must answer `dispatchable` and the returned authorization must satisfy: `id` equals the claim's `authorizationId`; `actionId` equals the claim's and the local one; `audience` is `fulfillment-connectors`; tenant, project and action match; `provider` is the mapped provider; `mode` is `sandbox` (`fixture` and `live` are rejected); `environment` is `development` or `preview`; `terms` are canonically equal to the trusted terms; `expiresAt` is later than the clock. A mismatch is `rejected`.

### HTTP mapping

| Response | Result |
| --- | --- |
| 200 with the expected shape | success |
| 403 or 409 with `{ok:false,status:"rejected",reason}` and a known reason | `rejected` |
| 400, 401, 413, 429, 503, any other non-2xx, a malformed body, an unknown reason, a wrong shape | throws (`authorization_unavailable` in the runtime) |
| claim only: transport error, timeout, 5xx other than 503, 200 with a non-JSON body | ambiguous commit, reconcile by lookup |

A 503 from the producer is its pre-commit `consumer_unavailable` answer, so it is definitive. Lookup and revalidate are never ambiguous: any failure throws. The request is bounded by `timeoutMs` (default 10 s) and aborts through the signal given to the port. The signed path must equal the server's `URL.pathname` exactly and the signed body text must be the exact bytes sent; the port receives both unchanged.

## Consumer key

`createConsumerRequestSigner` refuses keys shorter than 32 characters or containing `FIXTURE-ONLY`, so the published fixture key can never sign through it. Rotation is a hard cutover with no key id: requests in flight get 401, which throws and becomes `authorization_unavailable`, and a later retry reconciles under the same claim key. The fixture signature vector is checked with the pure `consumerSignature` primitive only.

## Dispatch-time revalidation in the runtime

`submit` passes `beforeTransport` to `execute` when the verifier implements `revalidateBeforeDispatch`. It runs before every transport request, including adapter retries, after the claim, attempt persistence and budget reservation, and before the request is sent. `rejected` is `stale_authorization`, a throw or malformed answer is `authorization_unavailable`; the side effect is `not_dispatched` until a request has been sent and `possible` after. The runtime's own `dispatching` metering record is written after this check and before the request; a lapse inside that local window is not rechecked (a limitation of using the existing `beforeTransport` point).

## Redaction

`OrderAuthorizationError` carries a code and a fixed message only. No token, signature, key, claim key or caller text appears in a message, and errors from injected ports are replaced, never wrapped. Requests carry references and digests only; there is no address field anywhere.

## Evidence and fixtures

`npm run verify:order-authorization` runs the suite and writes `evidence/FC-ORDER-AUTH/result.json`. `tests/fixtures/order-authorization/` vendors an exact subset of the producer fixtures byte for byte from git objects at the pinned commit, with `provenance.json` holding the git blob SHA-1 and SHA-256 of each file. They are public, fixture-only values. The vendored producer `verify.mjs` is used by the tests as an independent oracle for tokens, canonical JSON, action ids and consumer signatures; the code under test does not import it.

## Open items (outside this change)

- A non-fixture `TrustedTermsSource` needs the accepted shared-contracts bindings (#24 bundle digest to design hashes, #25 quote id and exact-versus-ceiling amount, a destination `{ref,digest}` contract, #26 `OrderAuthorization`).
- The producer refuses `prodigi` in every non-live mode and has no confirmed SKU, so a connector sandbox run has nothing it can claim.
- The producer's consumer authentication is a shared-key stopgap with no key id, rotation or nonce.
