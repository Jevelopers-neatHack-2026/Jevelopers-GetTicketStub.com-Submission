# FC-04 private quote normalization

`src/quotes.ts` implements an offline development interface for FC-04.1–3. The private `connector-development-quote/1` result binds normalized provider terms to one exact catalog capture, eligible product selection, quantity, destination reference and digest, shipping method, and trusted tenant/project scope. It is not the canonical `FulfillmentQuote` schema and is not yet exported through the package entry point.

Shared-contracts #25 owns the canonical quote shape. The caller must inject the existing `ContractValidator`; the quote path asks it for the `fulfillment_quote` binding and delegates `validateOutbound`. A development fixture binding remains explicitly marked `development_fixture`. Every pin value surfaced in `contractBinding`, including `schemaVersion`, is checked as bounded, privacy-safe metadata before the quote port runs; schema versions must also match the supported version syntax, so safe ordinary versions and prereleases are allowed while URLs, personal contact details, address-like text, and secret-like material are rejected. The receipt version returned by `validateOutbound` is checked before its mapped payload is returned. This change does not invent a competing schema or claim producer/consumer conformance.

## Execution boundary

`executePrivateQuote(input, dependencies)` takes an exact request object with:

| Field | Meaning |
| --- | --- |
| `catalogSource` | Private catalog snapshot input normalized by the existing catalog helper. |
| `selection` | Selection evaluated against that snapshot, including its snapshot and catalog-content identities. |
| `quantity` | Safe integer quantity from 1 through 1,000,000. |
| `destinationReference` | Namespaced opaque destination reference; raw address data is not accepted. |
| `destinationDigest` | SHA-256 digest binding the destination without copying its personal data into the quote. |

Dependencies provide `quotePort.quote(request, { operation: "quote", signal })`, the injected `ContractValidator`, a millisecond `clock.now()`, and a trusted `{ tenantId, projectId }` scope. The bounded quote port has no submit or payment method. Its request contains only provider/API/catalog identity, exact product and selection facts, destination reference/digest and coarse destination codes, shipping, quantity, and a request digest. It does not receive personalization text or a street address. The default policy limits the call to five seconds, ten calls per port per one-second window, and five minutes of local quote validity; supplied policy limits are strictly bounded. Timeout aborts the provided signal and returns a typed safe error.

Inputs and responses are copied through strict own-data validation. Accessors are rejected without invocation; malformed prototypes, sparse or oversized arrays, unsafe numbers, unexpected fields, and invalid references fail closed. Provider failures, including thrown objects and proxy-backed errors, are reduced to newly owned fixed typed diagnostics; only the internal timeout sentinel and own-data rate-limit codes influence classification. Provider warnings and notes are bounded and screened for personal data, URLs, and secret-like values. The boundary result is checked for one exact quote receipt and matching tenant/project scope and schema major before it is returned. Privacy screening allows canonical ISO timestamps only in recognized quote time fields and exact monetary strings only as contract-mapped quote amounts; it still checks mapped text for personal and secret-like content.

## Money, completeness, and expiry

Provider amounts use exact decimal strings and one explicit currency and scale. The normalizer converts them to integer minor units with `BigInt`, without floating-point arithmetic or rounding. Supported input scales are 0–6 places; excess precision or a non-decimal value rejects the provider response. Production, shipping, tax, fee, and total are each either explicitly `known` or `unknown` with a reason code. A known zero remains a known amount.

Tax basis is explicitly `included`, `excluded`, or `unknown`. For excluded tax, the exact reconciliation is production + shipping + fee + tax = total. For included tax, the provider's total is reconciled against production + shipping + fee, while the tax amount remains separately represented. Unknown total, required line amounts, or tax basis produces an `incomplete` quote with an explicit list of missing reconciliation inputs; none is converted to zero. A quote is complete only when all amount lines are known, tax basis is known, and the total reconciles. Lead time is an estimate range or an explicit unknown.

The snapshot preserves provider expiry separately from a conservative local policy expiry. When provider expiry is undocumented, the effective expiry uses the configured local maximum. When provider expiry is earlier, it takes precedence; equality records both sources. A provider expiry at or before quote creation is rejected. Expiry is inclusive as a cutoff: a quote is stale when `effectiveValidUntil <= now`.

Quote IDs are deterministic SHA-256 fingerprints of the immutable quote body, including the scoped selection and normalized terms. A separate terms fingerprint covers the provider reference, currency, breakdown, expiry, lead time, warnings, and notes. These local hashes preserve identity; they do not establish provider authenticity or a canonical contract pin.

## Rechecking and effects

`evaluatePrivateQuoteCurrent(quote, currentInput, dependencies)` first copies and checks the complete private snapshot shape, exact money representation and reconciliation, terms fingerprint, quote fingerprint, expiry relationships, and creation time. It then verifies the current trusted scope, expiry, fresh catalog, selection eligibility, product/spec and catalog identities, options/materials, destination, quantity, and shipping method. This detects malformed or internally inconsistent serialized snapshots; the local hashes are identity checks and do not prove authenticity. It reports `current`, `stale`, `incomplete`, or `invalid`, with explicit refresh, revalidation, re-quote, and external-authorization actions. Any changed binding requires a fresh quote and renewed external authorization. An incomplete or stale quote cannot be presented as current for external review.

Snapshot revalidation uses the same field rules as quote creation for trusted tenant/project scope. Catalog SKUs and trusted scope values are treated as validated identifiers when the privacy scanner checks serialized snapshots and mapped output; other free-text fields retain the full privacy screening. This allows valid numeric supplier SKUs and spaced trusted scope values to round-trip without relaxing quote integrity or privacy checks.

Every result is marked `financialEffect: "quote_only"`. A quote is an estimate, not a paid order, provider charge, budget reservation, or actual expense. This code makes no order, payment, budget, metering, provider-network, or sandbox call.

The private suite is `node tests/quote-suite.mjs`; its synthetic fixtures exercise exact currency arithmetic, unknown versus zero amounts, included/excluded tax, malformed and mismatched provider terms, expiry, changed bindings, timeout, rate limits, contract scope, and zero order submissions. The quote suite is currently run directly because its invocation is outside the separately controlled package-script and public-export integration grant.
