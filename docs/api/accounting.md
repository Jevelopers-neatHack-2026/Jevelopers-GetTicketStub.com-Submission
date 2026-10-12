# Accounting projection (CI-06)

Deterministic, offline projection of commerce and expense events into v1
operational metrics. This leaf builds on the CI-02 immutable posting boundary
and the CI-09 ledger. It performs no provider or network calls, never mutates
posted rows, and derives every metric with exact base-10 integer arithmetic.
Reclassification and corrections append adjustments and rebuild the projection;
they never edit a posted event.

Module: `@jevelopers/cost-intelligence/accounting`
Policy version: `ci06-accounting-policy-1.0.0`
Allocation policy version: `ci06-allocation-policy-1.0.0`

---

## Definitions — PENDING FINANCE-OWNER SIGN-OFF

> The metric and classification definitions in this section are a **documented
> default policy** implemented so CI can run and the behavior is pinned and
> testable. They are **PENDING FINANCE-OWNER SIGN-OFF** and must be reviewed and
> accepted by the finance owner before any global acceptance (FIN-08, FIN-09,
> FIN-10) is recorded. Exclusions (pass-through tax, cash separation, simulation
> exclusion) are called out explicitly below for that review.

### v1 operational metrics (CI-06.1)

- **Gross sales** = recognized sale line amounts, before discounts and refunds,
  excluding pass-through taxes.
- **Net sales** = gross sales − discounts − sales refunds.
- **Direct costs** = attributed AI / fulfillment / other direct expense and
  applicable fees under this recognition policy, **net of** recoveries (fee
  refunds, credits, reimbursements) that are linked to their original cost
  category.
- **Contribution** = net sales − direct costs.

Recoveries and credits stay **linked to their original category** and reduce
that category only. They are never also recorded as negative revenue, so no
amount is ever subtracted twice.

### Cash vs. accounting (CI-06.2)

Cash receipts, payouts, and transfers are tracked in a **separate cash
projection** (`cash.receipts`, `cash.payouts`, `cash.net`) and never enter
gross / net / direct / contribution. Estimates and future forecasts never become
actual cash or recognized revenue. A payout is a settlement transfer, never a
new sale.

### Simulation vs. actual (CI-06.4)

Each event carries `recognition: "actual" | "simulated"`. Actual metrics exclude
simulated sales; simulated activity is reported in a parallel `simulated` block.
A live-mode AI direct cost incurred during a test run is `actual` and is
retained; a simulated sale in the same run is excluded from actual sales.

---

## Event → metric sign / classification matrix (CI-06.1)

The sign is applied to a **non-negative** posted magnitude.

| Classification | Gross sales | Net sales | Direct costs | Cash | Recovery | Notes |
|---|---|---|---|---|---|---|
| `sale` | +1 | +1 | 0 | — | no | Recognized sale line; excludes pass-through tax. |
| `discount` | 0 | −1 | 0 | — | no | Contra-revenue. |
| `refund` (sale) | 0 | −1 | 0 | — | yes | Sales refund linked to the original sale. |
| `refund` (fee) | 0 | 0 | −1 | — | yes | Fee refund; recovery linked to the original fee. |
| `credit` | 0 | 0 | −1 | — | yes | Supplier/fee credit; linked to its original cost category. |
| `reimbursement` | 0 | 0 | −1 | — | yes | Recovery linked to its original cost category. |
| `tax` | 0 | 0 | 0 | — | no | Pass-through; excluded from gross and net. |
| `fee` | 0 | 0 | +1 | — | no | Applicable fee recognized as a direct cost. |
| `direct_cost` | 0 | 0 | +1 | — | no | Attributed AI / fulfillment / other direct expense. |
| `payout` | 0 | 0 | 0 | payout | no | Settlement transfer; cash only. |
| `cash_movement` | 0 | 0 | 0 | receipt/payout | no | Cash receipt or payout; separate from accounting totals. |
| `adjustment` | targeted | targeted | targeted | — | no | Reclassification/correction; signed and applied to a named metric. |

`refund` is split by `links.refundKind` (`sale` → net sales; `fee` → direct
costs). Recoveries (`refund:fee`, `credit`, `reimbursement`) carry
`links.recoveryOf` identifying the original category.

---

## Recognition, periods, currency, rounding (CI-06.2)

- **Recognition trigger**: an event is recognized when it is posted with a known
  valuation; `amount: null` (unknown valuation) is retained as visibly
  `incomplete` and never recognized.
- **Period / timezone**: projections are produced as of a UTC `asOf` instant.
- **Currency / rounding**: amounts are exact base-10 decimals at an explicit
  scale; arithmetic is integer minor-unit; no binary floating point. A projection
  resolves a single currency; mixed-currency events without FX evidence are
  retained as `incomplete` (`currency_mismatch_requires_fx_evidence`).

## Shared-expense allocation (CI-06.3)

A shared research expense is **posted once** and allocated analytically across
approved designs / workflows / orders by `allocateSharedExpense` using the
versioned allocation policy (floor allocation). Allocations always sum to **at
most** the source, any remainder is retained as an explicit `residual`, and the
project expense is never increased — it stays exactly equal to the posted
source. Example: `1.00` over three equal targets → `0.33 / 0.33 / 0.33`,
residual `0.01`, project expense `1.00`.

## Source authentication, dedup, reorder, manual imports (CI-06.4)

- **Source authentication**: events from unauthenticated sources are retained as
  `incomplete` (`source_not_authenticated`) and excluded from totals.
- **Dedup / reorder**: events are deduplicated by trusted source identity
  (`source.name` + `sourceEventId` + `revision` + `contentHash`). Replayed and
  reordered streams produce identical economics (identical `projectionHash`).
- **Repeated / reordered adjustments**: only the highest revision per
  `(source.name, sourceEventId)` subject is applied.
- **Manual imports**: require `actor`, `sourceHash`, `reason`, and a `currency`
  matching the event currency, else the event is retained as
  `incomplete` (`manual_import_missing_auditable_evidence`). Corrections are
  auditable via `correctionOf`.

## Persistence (migration `0007_accounting_projection_snapshots`)

Append-only, RLS-protected tables `accounting_projection_snapshots` and
`accounting_allocation_policies` (owned by `ci_finance_owner`, scoped read/insert
for `ci_finance_runtime`, update/delete/truncate rejected) provide a durable,
immutable surface for recorded projections and allocation policy registrations.

## Validation

See `tests/accounting/accounting.test.mjs` and the golden fixture
`fixtures/accounting/ci06-golden-events.json`.
