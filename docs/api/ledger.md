# Financial ledger API

The ledger API accepts typed finance-owned events and persists them through a PostgreSQL transaction. It is available from the package root and `@jevelopers/cost-intelligence/ledger`. `appendLedgerEvent` and `rebuildLedgerProjection` require injected `LedgerRuntimePorts`: a host-approved trusted-context resolver, a connection from the host-managed PostgreSQL pool, and a trusted clock. The ledger does not create its own pool or call a provider.

## Event envelope

Every event has exact `schemaVersion: "1.0.0"`, event and idempotency IDs, request and correlation IDs, trusted tenant/project/environment/billing-mode scope, producer source and build revisions, UTC occurred/observed/ingested times, evidence mode, verification status, classification, valuation, settlement, reconciliation, source identity and content hash, usage completeness, money, dimensions, and lineage references. Scope is checked against the injected trusted context before a database connection is opened. Environment and billing mode are part of source, identity, idempotency, and billable-attempt keys.

The identities remain separate: logical operation, transport attempt, provider attempt, optional provider request, billable attempt, source observation, and optional reservation. Upstream attempt identities use explicit `known`, `unknown`, or `not_applicable` values; an absent provider or transport identifier is never replaced with a fabricated ID. Locally owned event, source-observation, source-event, source-object, and source-line identities remain required. A logical operation can contain multiple billed attempts and multiple financial source lines for one attempt.

`postingMapping` is a versioned adapter declaration (`schemaVersion: "1.0.0"`) that connects one source line to its transport, provider, request, and billable-attempt identities. Each source line is independently revisioned and recorded in an immutable posting-mapping table. Several separately evidenced lines, such as a principal charge and its fee, may map to the same genuine attempt. An exact replay of the same immutable request is a duplicate; a changed request or source content at an already-used source revision conflicts. A newly observed source line is not collapsed merely because it shares an attempt with another line.

`evidenceMode` (`mocked`, `sandbox`, `live`) is separate from `environment` and `billingMode`. A live provider charge remains a live-evidence cost even when the caller's environment is `test`; the synthetic acceptance fixture uses `test` + `simulated` + `mocked` and makes zero external calls.

## Event and lifecycle rules

All event variants keep valuation (`unknown`, `estimated`, `provider_confirmed`), settlement (`unpaid`, `partly_paid`, `paid`), reconciliation (`unmatched`, `matched`, `exception`), and reservation lifecycle as distinct dimensions. Unknown valuation requires `money.amount: null`; unknown quantities remain null or incomplete and are never treated as zero.

| Event | Required classification/effect | Lifecycle | Persistence rule |
| --- | --- | --- | --- |
| `usage_observation` | `usage_memo`; non-financial | null | Preserves source-backed complete, incomplete, or unknown usage. A later source revision may resolve unknown upstream identity evidence without creating a financial effect. |
| `reservation_authorized` | `reservation_memo`; non-financial | `held` | Creates the original authorization record with a reservation ID. |
| `dispatch` | `reservation_memo`; non-financial | `dispatched` | References the same-scope authorization, reservation, operation, and currency. |
| `consumption` | Financial effect; nonnegative cumulative amount | `partially_settled`, `settled`, `outcome_unknown`, or `held_for_reconciliation` | References its authorization when reservation-linked. A higher cumulative revision supersedes the prior consumption on the same source line and posting mapping. After an evidence-linked correction, the next cumulative revision continues from the corrected amount. A linked actual may exceed the original authorization; the authorization is not rewritten. |
| `reservation_release` | `reservation_memo`; non-financial | `released` or `expired` | Retains the same reservation and authorization reference. |
| `charge`, `expense`, `revenue`, `refund`, `credit`, `discount`, `fee`, `tax`, `reimbursement`, `cash_movement` | Financial effect | null or caller-supplied lifecycle | Posts a known or explicitly unknown amount under its original currency. |
| `reversal` | Financial effect with signed known amount | Caller-supplied | Must reference the current effective financial event in the same scope, currency, classification, operation, and reservation lineage. Reversals and corrections are checked together against the root event's reversible amount; a memo or superseded event cannot be reversed. |
| `correction` | Financial effect with source evidence | Caller-supplied | Supersedes the current effective financial event on the same source line and mapping, and preserves its operation, currency, classification, and reservation lineage. It requires content-addressed evidence and may decrease a prior amount. |
| `adjustment` | Financial effect with source evidence | Caller-supplied | Records a separately evidenced adjustment without editing the original. |

The ledger records and validates event shape, identity links, authorization references, source revisions, explicit posting mappings, and replacement lineage. Usage-evidence revisions may refine only non-financial usage records. Financial corrections must reference a current financial predecessor; they cannot turn an unknown usage or reservation memo into expense. It does not implement a budget capacity state machine or decide whether new spending may be authorized. Release, dispatch, budget-window, and grant/release decisions remain the responsibility of a separate budget authority.

For a reservation-linked operation, the recorded economic sequence is:

| Prior record | New event and lifecycle | Recorded meaning | Ledger check |
| --- | --- | --- | --- |
| None | `reservation_authorized` / `held` | Preserve the original grant as a memo | Requires a new reservation ID; no financial effect. |
| `held` | `dispatch` / `dispatched` | Preserve dispatch evidence | Must link to the same-scope authorization, reservation, logical operation, and currency. |
| `dispatched` or prior partial | `consumption` / `partially_settled` or `settled` | Record the cumulative incurred amount | Must link to its authorization and source-line posting mapping. An ordinary cumulative replacement cannot decrease; a later replacement may increase from a separately evidenced correction. |
| `dispatched` or partial | `consumption` / `outcome_unknown` or `held_for_reconciliation` | Preserve uncertainty explicitly | The amount may remain null; a worker lease or cancellation does not convert it to zero. |
| Held or unused balance remains | `reservation_release` / `released` or `expired` | Preserve a release fact | Must link to its authorization and has no financial effect. |

These rows describe the event sequence represented by the ledger. The database enforces references and cumulative replacement rules, but the host budget authority decides whether each dispatch, settlement, or release transition is authorized; the ledger does not infer release from a lease ending or an outcome arriving late.

## Exact money and projections

Amounts and quantities are decimal strings with at most 18 fractional digits. PostgreSQL `numeric(58,18)` stores values; the event payload also preserves the original decimal string and declared scale. Calculations use scaled `BigInt`, never binary floating point. Projection rows are partitioned by currency, event type, and classification. Canonical projection strings trim insignificant trailing zeroes (`1.10` projects as `1.1`); the immutable event retains the original `1.10` spelling and scale. Sub-cent values are accumulated before display rounding, and the ledger performs no implicit FX conversion.

`rebuildLedgerProjection` selects events ingested on or before the requested UTC `asOf`, excludes any event with a successor already ingested by that instant, and hashes the canonical scope, event evidence, totals, and completeness counts. Rebuilding the same as-of snapshot returns the same hash. Unknown amounts make a subtotal incomplete rather than zero; unknown usage follows the same rule for quantities. Incomplete observations retain known-unit subtotals while the total remains null and completeness remains `incomplete`. Every snapshot and its amount/quantity rows are persisted append-only; on reuse, the stored header and child rows are checked against the content-addressed result. Source events and posting mappings also remain append-only.

Unsupported schema versions and event types use a scoped quarantine path. It stores only the trusted scope, safe reason code, supported version when available, payload hash, and stable diagnostic reference; it does not retain the raw payload or post money. Replaying the same unsupported payload in the same scope returns the same reference. Requests without an authorized trusted scope are rejected before opening a database connection.

## Versioned schema and migrations

The append request is a discriminated union in `LedgerAppendRequestSchema`; receipt, projection request, and projection result schemas are exported from the ledger subpath and generated into `schemas/cost-intelligence/1.0.0/`. Migration `0003_financial_ledger.sql` creates immutable event storage, independent identity bindings, source-line revision heads, versioned posting-attempt mappings, projection snapshots, and scoped quarantine records. Database triggers reject event, mapping, quarantine, and snapshot updates/deletes; identity bindings allow only their initial event assignment. Both fresh creation and upgrade from the prior foundation fixture are covered by `npm run test:migrations`.

For the complete synthetic input and expected values, see [`fixtures/ledger/ci02-synthetic-acceptance.json`](../../fixtures/ledger/ci02-synthetic-acceptance.json). `npm run test:ledger` runs the database acceptance against the pinned PostgreSQL 16 image. `npm run test:migrations` covers both fresh creation and an upgrade from the prior foundation fixture. See [compatibility.md](./compatibility.md#runtime-boundary) for the supported Node backend boundary.

The shared-contract dependency remains pinned to an unaccepted proposal with finance findings FC-001 through FC-004. This finance-owned ledger surface is not a canonical shared-contract replacement, and an external trusted-context handoff is still required before claiming cross-repository conformance.
