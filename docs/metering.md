# Connector metering and durable outbox

The runtime can record connector-owned source facts and consume injected finance decisions through `FulfillmentMetering`. It does not value orders, calculate profitability, post a ledger, create an authoritative budget hold, or release one. The module is exported from this package for local integration; its persisted format, private observations, and fixture receipts are not accepted cross-repository contracts.

## Ownership boundaries

| Payload or decision | Shape and owner | Connector responsibility | External responsibility |
| --- | --- | --- | --- |
| Usage and attempt observations | `fulfillment_usage`, shared-contracts issue #11 (SC-06A) | Create attributable candidates, validate through the injected `ContractValidator`, persist in the local outbox, and deliver through `UsageSink` | Shared-contracts owns the accepted schema. Cost-intelligence owns intake, deduplication, valuation, and ledger treatment. Its gateway and intake/settlement conformance remain separate checks. |
| Budget reservation request | `budget_reservation`, shared-contracts issue #12 (SC-06B) | Validate and persist an attributable request; call the injected `BudgetClient` at most once after recording the request; query only through `BudgetReservationResolver` after ambiguity | Shared-contracts owns the accepted shape. Cost-intelligence is the sole authority for reservation decisions, holds, settlement, and release. |
| Provider attempt and transport IDs | Private connector store | Persist logical operation, distinct billable attempt, and transport attempt identities before their corresponding external effects | Provider request IDs and supplier outcomes are included only when supplied by the provider boundary. |
| Currency and amount source facts | Private connector store and usage candidate | Preserve exact decimal text, scaled integer units, unscaled source minor units, original currency, basis, and unknown as `{ amount: null, basis: "unknown" }` | Finance consumers decide how a source observation affects accounting. A quote or accepted order is not evidence of a charge. |

The injected validator may use deterministic local fixtures during development. A `development_fixture` receipt is not an accepted schema pin. Accepted producer and consumer validation for shared-contracts #11/#12 and cost-intelligence CI-04A, CI-05A, CI-05B, and the fulfillment producer row are still required before FC-10 can close or release criteria can pass.

## Recorded facts

Each outbox candidate carries stable event and observation IDs, provider and operation identity, trusted tenant/project scope, logical operation ID, billable attempt ID when applicable, transport attempt ID when known, provider request ID when known, UTC observation/occurrence times, provider mode, billing mode, evidence mode, outcome, completeness, measured duration when known, sanitized source references, and separate quote and charge evidence.

Amounts use decimal strings such as `"12.3400"`, scaled integer strings with an explicit scale, or source minor-unit integers preserved as strings without inferring a currency exponent. Numeric floating-point amounts are rejected. Exact text and integer representation are preserved. `unknown` has no numeric amount; missing data is not represented as zero. Quote facts, reservation amounts, and provider-confirmed charge facts occupy distinct fields. This module does not infer a charge from a quote, reservation, accepted order, or status.

`mode`, `billing_mode`, and `evidence_mode` are stored independently. Provider and billing modes support only `simulated` and `sandbox`; live mode is not enabled. `evidence_mode` distinguishes private fixtures, provider sandbox account evidence, and unknown evidence. A sandbox label alone does not prove account access or successful consumer conformance.

## Runtime integration

`RuntimeDependencies.metering` resolves a recorder using the trusted tenant/project scope already validated by the runtime. `createRuntimeMeteringResolver` opens a durable recorder under a directory partitioned by the full provider, provider mode, billing mode, evidence mode, and tenant/project context. The runtime verifies the returned recorder's provider, mode, and scope before accepting it. Each durable state also stores that immutable context and validates every attempt and candidate against it on open and mutation, so a directory opened with another context fails closed instead of exposing or reattributing prior records.

Before an external operation, the runtime replays pending usage and fails closed if delivery remains unresolved. A submit requires the durable attempt, authorization claim, and successful external budget decision. An approval without a valid reservation reference is treated as unknown and blocks this attempt and retries. Before transport, the runtime records and delivers a distinct transport-attempt event with source references; after that awaited metering boundary, it rechecks quote expiry and transport mode immediately before invoking the provider. A stale quote or changed mode leaves the acquired reservation held and records a not-dispatched result. After the provider response it records any provider request ID and outcome. Quote and read-only status/shipment observations are recorded without creating budget holds. Unknown charge amounts stay unknown. The current runtime cancellation declaration does not permit a billable cancellation; its external outcome is recorded conservatively and never establishes a charge.

The recorder does not invoke the standalone `prepareBillableAttempt` reservation workflow as a second financial authorization for runtime submissions. Its accounting outbox is durable alongside the runtime's existing authorization, attempt-persistence, and `BudgetClient` boundaries. The standalone workflow remains available for integrations that explicitly delegate the full attempt/reservation/dispatch lifecycle to `FulfillmentMetering`.

## Effect and recovery order

For the standalone manager's potentially billable submit or cancel path:

1. The store durably records a billable attempt with a stable logical-operation and reservation-request identity, source references, quote facts, and the externally supplied reservation amount. Unknown reservation amounts cannot authorize dispatch.
2. The attempt usage event is validated and delivered before a reservation request can proceed. An undelivered accounting event blocks reservation and later effects.
3. The canonical reservation candidate and stable reservation-request event are persisted together with the one-time `requesting` claim before calling `BudgetClient.authorize`. The client is invoked at most once for that request ID. If the process stops or the call throws after the claim, the next process only asks the financial owner to resolve that same request. It never sends a second authorization request because the local outcome is uncertain.
4. A positively confirmed external reservation is required to prepare transport dispatch. A stable transport attempt and its usage event are persisted and delivered before the effect callback. One atomic persisted transition owns dispatch; a restart that finds `dispatching` or `unknown` blocks a repeat and requires external reconciliation.
5. The outcome, including `unknown`, is persisted with the same attempt and transport identifiers before its usage event is delivered. If a provider may have accepted work before a crash, the attempt stays uncertain. A new caller key cannot bypass the unresolved logical-operation claim.

Outbox delivery is at least once. A crash after the sink accepts an event but before local acknowledgment may redeliver the same canonical envelope with the same event and observation IDs. Consumers must deduplicate by the accepted contract identity and reject conflicting reuse; local replay does not claim exactly-once delivery.

The JSON snapshot store writes a synced temporary file and atomically renames it while holding an exclusive writer lock. State schema `/2` binds the store to its immutable provider, mode, billing, evidence, and tenant/project context. Older `/1` records and corrupt or mismatched context are rejected without rewriting or deleting the existing file; there is no automatic migration or reattribution. Same-process instances serialize updates; processes contend on the filesystem lock. A stale lock is removed only after the recorded process ID is confirmed dead. A malformed lock, live/indeterminate owner, corrupt state, or storage error fails closed. Reservation responses are merged against the latest persisted attempt, preserving dispatch and terminal effect progress across awaited finance calls; repeated same-key preparation cannot return terminal provider attempts to `ready`. There is no lock lease that releases a financial reservation, and elapsed time never clears an external hold. Manual storage recovery does not imply permission to release a finance hold or repeat a provider effect.

## Private fixture coverage and validation limits

`tests/metering-suite.mjs` contains deterministic private producer rows with digest reported in its JSON result. They cover valid, invalid, duplicate, conflicting, and unknown quote observations; a submit attempt; status; cancellation; and an ambiguous outcome. The rows preserve trusted scope, provider/billing/evidence modes, source references, exact currency facts, and unknown charge values. They are local development fixtures only: they do not claim a canonical producer schema, accepted contract conformance, supplier evidence, or cost-intelligence gateway compatibility.

The local suite exercises crashes, process restarts, replay, duplicate/conflicting identities, concurrent store access, reservation ambiguity, and failures that must block dispatch. Run it after installing the locked dependencies:

```sh
npm ci
npm run build
node scripts/run-metering-tests.mjs
./scripts/verify-fulfillment --suite metering --mode simulated --evidence-dir evidence/FC-10
```

No real provider, supplier, finance account, payment, or billable action is used. Genuine sandbox execution remains pending the provider owner's approved SKU, destination, and secure credential reference. Finance producer/consumer conformance is independently pending accepted upstream intake, gateway, reservation, and settlement interfaces and their receipts.
