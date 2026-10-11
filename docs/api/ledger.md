# Financial ledger API

The ledger API accepts typed finance-owned events and persists them through a PostgreSQL transaction. It is available from the package root and `@jevelopers/cost-intelligence/ledger`. `appendLedgerEvent` and `rebuildLedgerProjection` require injected `LedgerRuntimePorts`: a host-approved trusted-context resolver, a connection from the host-managed PostgreSQL pool, and a trusted clock. The ledger does not create its own pool or call a provider.

## Event envelope

Every event has exact `schemaVersion: "1.0.0"`, event and idempotency IDs, request and correlation IDs, trusted tenant/project/environment/billing-mode scope, producer source and build revisions, UTC occurred/observed/ingested times, evidence mode, verification status, classification, valuation, settlement, reconciliation, source identity and content hash, usage completeness, money, dimensions, and lineage references. Scope is checked against the injected trusted context before a database connection is opened. Environment and billing mode are part of source, identity, idempotency, and billable-attempt keys.

The identities remain separate: logical operation, transport attempt, provider attempt, optional provider request, billable attempt, source observation, and optional reservation. A logical operation can contain multiple billed attempts. A source observation can only be bound once; replay of the same immutable request is a duplicate, while changed content under the same identity is a conflict. Source revision subjects distinguish separate lines under one source object.

`evidenceMode` (`mocked`, `sandbox`, `live`) is separate from `environment` and `billingMode`. A live provider charge remains a live-evidence cost even when the caller's environment is `test`; the synthetic acceptance fixture uses `test` + `simulated` + `mocked` and makes zero external calls.

## Event and lifecycle rules

All event variants keep valuation (`unknown`, `estimated`, `provider_confirmed`), settlement (`unpaid`, `partly_paid`, `paid`), reconciliation (`unmatched`, `matched`, `exception`), and reservation lifecycle as distinct dimensions. Unknown valuation requires `money.amount: null`; unknown quantities remain null or incomplete and are never treated as zero.

| Event | Required classification/effect | Lifecycle | Persistence rule |
| --- | --- | --- | --- |
| `usage_observation` | `usage_memo`; non-financial | null | Preserves source-backed complete, incomplete, or unknown usage. |
| `reservation_authorized` | `reservation_memo`; non-financial | `held` | Creates the original authorization record with a reservation ID. |
| `dispatch` | `reservation_memo`; non-financial | `dispatched` | References the same-scope authorization, reservation, operation, and currency. |
| `consumption` | Financial effect; nonnegative cumulative amount | `partially_settled`, `settled`, `outcome_unknown`, or `held_for_reconciliation` | References its authorization when reservation-linked. A higher cumulative revision supersedes the prior consumption on the same billable attempt. A linked actual may exceed the original authorization; the authorization is not rewritten. |
| `reservation_release` | `reservation_memo`; non-financial | `released` or `expired` | Retains the same reservation and authorization reference. |
| `charge`, `expense`, `revenue`, `refund`, `credit`, `discount`, `fee`, `tax`, `reimbursement`, `cash_movement` | Financial effect | null or caller-supplied lifecycle | Posts a known or explicitly unknown amount under its original currency. |
| `reversal` | Financial effect with signed known amount | Caller-supplied | Must reference a same-scope, same-currency and same-classification event. Reversals cannot cumulatively exceed its original amount. |
| `correction` | Financial effect with source evidence | Caller-supplied | Supersedes the current billable event and requires content-addressed evidence; it may decrease a prior amount. |
| `adjustment` | Financial effect with source evidence | Caller-supplied | Records a separately evidenced adjustment without editing the original. |

The ledger records and validates event shape, identity links, authorization references, source revisions, and replacement lineage. It does not implement a budget capacity state machine or decide whether new spending may be authorized. Release, dispatch, budget-window, and grant/release decisions remain the responsibility of a separate budget authority.

For a reservation-linked operation, the recorded economic sequence is:

| Prior record | New event and lifecycle | Recorded meaning | Ledger check |
| --- | --- | --- | --- |
| None | `reservation_authorized` / `held` | Preserve the original grant as a memo | Requires a new reservation ID; no financial effect. |
| `held` | `dispatch` / `dispatched` | Preserve dispatch evidence | Must link to the same-scope authorization, reservation, logical operation, and currency. |
| `dispatched` or prior partial | `consumption` / `partially_settled` or `settled` | Record the cumulative incurred amount | Must link to its authorization; each replacement supersedes the prior billable-attempt consumption and cannot decrease it. |
| `dispatched` or partial | `consumption` / `outcome_unknown` or `held_for_reconciliation` | Preserve uncertainty explicitly | The amount may remain null; a worker lease or cancellation does not convert it to zero. |
| Held or unused balance remains | `reservation_release` / `released` or `expired` | Preserve a release fact | Must link to its authorization and has no financial effect. |

These rows describe the event sequence represented by the ledger. The database enforces references and cumulative replacement rules, but the host budget authority decides whether each dispatch, settlement, or release transition is authorized; the ledger does not infer release from a lease ending or an outcome arriving late.

## Exact money and projections

Amounts and quantities are decimal strings with at most 18 fractional digits. PostgreSQL `numeric(58,18)` stores values; the event payload also preserves the original decimal string and declared scale. Calculations use scaled `BigInt`, never binary floating point. Projection rows are partitioned by currency, event type, and classification. Canonical projection strings trim insignificant trailing zeroes (`1.10` projects as `1.1`); the immutable event retains the original `1.10` spelling and scale. Sub-cent values are accumulated before display rounding, and the ledger performs no implicit FX conversion.

`rebuildLedgerProjection` selects events ingested on or before the requested UTC `asOf`, excludes any event with a successor already ingested by that instant, and hashes the canonical scope, event evidence, totals, and completeness counts. Rebuilding the same as-of snapshot returns the same hash. Unknown amounts make a subtotal incomplete rather than zero; unknown usage follows the same rule for quantities. Every snapshot and its amount/quantity rows are persisted, and source events remain append-only.

## Versioned schema and migrations

The append request is a discriminated union in `LedgerAppendRequestSchema`; receipt, projection request, and projection result schemas are exported from the ledger subpath and generated into `schemas/cost-intelligence/1.0.0/`. Migration `0003_financial_ledger.sql` creates immutable event storage, independent identity bindings, source-revision and billable-attempt heads, and reproducible projection tables. Database triggers reject event updates/deletes and identity-binding mutation except the first-event assignment.

For the complete synthetic input and expected values, see [`fixtures/ledger/ci02-synthetic-acceptance.json`](../../fixtures/ledger/ci02-synthetic-acceptance.json). `npm run test:ledger` runs the database acceptance against the pinned PostgreSQL 16 image. `npm run test:migrations` covers both fresh creation and an upgrade from the prior foundation fixture. See [compatibility.md](./compatibility.md#runtime-boundary) for the supported Node backend boundary.

The shared-contract dependency remains pinned to an unaccepted proposal with finance findings FC-001 through FC-004. This finance-owned ledger surface is not a canonical shared-contract replacement, and an external trusted-context handoff is still required before claiming cross-repository conformance.
