# Finance protocol 2.0.0 proposal

Package 0.6.0 introduces nine exact 2.0.0 finance schemas while retaining their advertised 1.0.0 schema and fixture bytes. The proposal implements the [finance captain decision](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/13#issuecomment-6104393313) and locally repairs FC-001..004. Producer/consumer review and immutable adoption are still pending. The [impact record](../compatibility/finance-v2-impact.json) records the breaking migration.

The affected names are BudgetReservation, ReserveRequest/Result, SettleRequest/Result, ReleaseRequest/Result and QueryRequest/Result. Root TypeScript names are unions of every supported version; version-suffixed types and ContractVersionMap preserve exact decoding. Use the v2-only helpers for the new guarantees:

```ts
import { parseContractVersion, checkFinanceReservation } from '@jevelopers/shared-contracts';
import type { FinanceContext } from '@jevelopers/shared-contracts';
export function checkCurrent(json: string, serverContext: FinanceContext) {
  const parsed = parseContractVersion('BudgetReservation', '2.0.0', json);
  return parsed.ok ? checkFinanceReservation(parsed.value, serverContext) : parsed;
}
```

The serverContext comes from independently authenticated Finance/application records. It never comes from submitted payload fields. The package performs comparisons and exact arithmetic only; it does not authenticate a caller, issue permission, atomically reserve/release funds, post a ledger delta, or contact a provider.

| Field / record | Meaning |
| --- | --- |
| finance_protocol_version | Exact finance semantic profile 2.0.0; the common privacy/version policy remains 1.0.0 |
| held, requested_capacity, grant_request_ref, grant_revision | Immutable original authorized capacity, requested conservative cap and exact initial request binding |
| consumed, consumption_basis | Effective cumulative observed cost; actual cost can exceed authorization |
| overrun, exception_refs | Exact excess over original authorization and independently bound Finance exception evidence |
| retained_exposure, released_capacity, unreported_exposure | Conserved unused authorized amount retained until finality, explicitly released on finality, and separate unknown future exposure |
| dispatch_cap, dispatch_acknowledgement_ref | Dispatch ceiling independent of actual costs; partial grants stay at zero until an exact scoped acknowledgement; terminal/overrun records allow no additional dispatch |
| settlement_intent | none on initial snapshots; explicit partial or final on settlement |
| consumption_kind, consumption_evidence_ref, correction_ref | Regular observations, late charges or append-only corrections with immutable evidence |
| ReserveRequest.pricing_basis, partial_grant | Bounded conservative pricing and explicit opt-in for a distinct partial outcome; unknown/unbounded pricing cannot auto-authorize |
| Result.request_ref | Exact request identity/version/hash; result economics must match the independently supplied command |

Money uses exact nonnegative decimal strings, currency and explicit scale. No floating-point posting or clamping occurs. Held 1.00 and observed 1.10 records all 1.10, overrun 0.10 and zero further dispatch; held remains 1.00. Final observed 0.60 records a 0.40 release and zero retained exposure. Partial observed 0.60 retains 0.40 with unknown future exposure. These are semantic representation checks; Finance alone posts the effective replacement/delta and releases capacity atomically.

Full grants equal the exact requested conservative amount. A smaller response cannot silently call itself full; excess authorization also fails. A partial grant requires allow_with_acknowledgement, a partially_granted outcome, an exact smaller held cap and zero initial dispatch. FinanceContext.dispatch_acknowledgement must independently bind the same scope/modes, reservation, grant revision, request reference, cap, reference, current status and expiry before dispatch becomes eligible. Revoked/expired acknowledgements do not grant dispatch. checkFinanceDispatch also rejects already-running/finished attempts, unknown usage, terminal records and amounts beyond remaining authorized capacity. It is not a dispatch service or an atomic check-and-spend primitive.

Ordinary settlements are cumulative. Success preserves exact command amounts, intent, evidence and prior revision. Each advancing snapshot uses the next revision and a distinct event ID; equal revision is accepted only for exact redelivery. An altered idempotent command conflicts. Increased cost cannot reuse the same observation reference. Finality needs independently supplied complete usage and a resolved execution state; timeout, lease expiry or cancellation request is insufficient.

Partial consumption can report authenticated known subtotal while execution/usage remains incomplete, without releasing unused or uncertain exposure. A currently unsafe scoped settle/release request can receive held_for_reconciliation. Its request shape/identity is checked without executing transition eligibility; held/consumed/overrun/evidence/retained/released exposure remain conserved and final settlement stays null. Actual release/final settlement still fails during in-flight/uncertain execution. Conserved partial holds use prior_observation, not the proposed new command's observations.

A late charge after finality requires a new evidence-linked append-only revision and leaves old records and original authorization unchanged. An ordinary cumulative decrease fails. A decrease through consumption_kind=correction additionally needs separately supplied CorrectionAuthority: authorized current status, same scope/modes/currency/reservation/billable attempt, exact prior revision and byte hash, from/to amounts and matching correction reference. Revoked/missing/wrong-prior authority fails. Finance performs the accounting adjustment; the old reservation cannot dispatch again.

Environment and billing_mode are mandatory independent v2 context expectations. Every supplied initial request, command, prior/current snapshot and prior result is checked against them, including denied/unknown/unavailable outcomes. Nested output modes cannot silently switch simulated/test records into real/live authority. Context currency is equally bound.

DecisionPort v1 compares request, result and receipt modes with independently supplied expectations and requires finance_context.current_reservation: a validated v2 Finance record and context. Its v1 budget field is only an exact full-grant projection: identities, revision, modes, held/consumed amounts, authority and expiry must match the v2 record. Dispatch additionally runs checkFinanceDispatch before the callback. A legacy grant alone, a contradictory projection, an unacknowledged partial grant or a direct v2 record in the v1 projection slot cannot dispatch. No automatic wire conversion or caller projection grants authority; real Finance/consumer adapter review remains pending.

The old 1.0.0 wire decoder remains available, but every current operational finance helper rejects that semantic profile with UNSUPPORTED_VERSION at /schema_version. Old behavior is executable only through the internal historical fixture adapter, marked historical_finance_characterization with operational_authority=false in fixture records; it is absent from operational package exports. It supplies no authority or safety guarantee. All sixteen old counterexamples are retained as historical evidence and also independently reject through current operational entry points. Original negative fixtures were not inverted or deleted. No earlier accepted major is fabricated.

```sh
npm run contracts:check -- --contract BudgetReservation@1.0.0
npm run contracts:fixtures -- --contract BudgetReservation@1.0.0
npm run contracts:check -- --contract BudgetReservation@2.0.0
npm run contracts:fixtures -- --contract BudgetReservation@2.0.0
npm run contracts:compat -- --contract SettleResult@2.0.0
npm run build
npm test
npm run test:installed
```

The catalog and fixture manifest index all 54 supported contract/version pairs across 45 names. The compatibility matrix executes current/current, retained-old/current and current/old-rejection cases using actual exact-version validators. Unknown versions reject. Old schema/fixture SHA histories remain pinned at the 0.5.0 checkpoint. Real consumers must review the impact, pin the new package/source/schema/fixture bytes and return actual exact-revision results and acknowledgements; rollback retains the old immutable archive and encoding with its documented limits.

QueryRequest/Result still concern one reservation. FinancialSummary is a projection, not a reporting/query/export API. Reporting GAP-001 stays in [proposal intake](../compatibility/proposal-intake.json). Other checkpoint findings SC-CHK-001 and SC-CHK-003..008 remain assigned to a separate repair task; this proposal does not claim those fixes or full release acceptance.
# Per-version artifacts

| Name | Retained legacy candidate | Current unaccepted proposal |
| --- | --- | --- |
| BudgetReservation | [1.0.0 schema](../schemas/BudgetReservation/1.0.0.json), [type](../generated/BudgetReservation_1_0_0.d.ts), [fixtures](../fixtures/BudgetReservation.json) | [2.0.0 schema](../schemas/BudgetReservation/2.0.0.json), [type](../generated/BudgetReservation_2_0_0.d.ts), [fixtures](../fixtures/BudgetReservation.2_0_0.json) |
| ReserveRequest | [1.0.0 schema](../schemas/ReserveRequest/1.0.0.json), [type](../generated/ReserveRequest_1_0_0.d.ts), [fixtures](../fixtures/ReserveRequest.json) | [2.0.0 schema](../schemas/ReserveRequest/2.0.0.json), [type](../generated/ReserveRequest_2_0_0.d.ts), [fixtures](../fixtures/ReserveRequest.2_0_0.json) |
| ReserveResult | [1.0.0 schema](../schemas/ReserveResult/1.0.0.json), [type](../generated/ReserveResult_1_0_0.d.ts), [fixtures](../fixtures/ReserveResult.json) | [2.0.0 schema](../schemas/ReserveResult/2.0.0.json), [type](../generated/ReserveResult_2_0_0.d.ts), [fixtures](../fixtures/ReserveResult.2_0_0.json) |
| SettleRequest | [1.0.0 schema](../schemas/SettleRequest/1.0.0.json), [type](../generated/SettleRequest_1_0_0.d.ts), [fixtures](../fixtures/SettleRequest.json) | [2.0.0 schema](../schemas/SettleRequest/2.0.0.json), [type](../generated/SettleRequest_2_0_0.d.ts), [fixtures](../fixtures/SettleRequest.2_0_0.json) |
| SettleResult | [1.0.0 schema](../schemas/SettleResult/1.0.0.json), [type](../generated/SettleResult_1_0_0.d.ts), [fixtures](../fixtures/SettleResult.json) | [2.0.0 schema](../schemas/SettleResult/2.0.0.json), [type](../generated/SettleResult_2_0_0.d.ts), [fixtures](../fixtures/SettleResult.2_0_0.json) |
| ReleaseRequest | [1.0.0 schema](../schemas/ReleaseRequest/1.0.0.json), [type](../generated/ReleaseRequest_1_0_0.d.ts), [fixtures](../fixtures/ReleaseRequest.json) | [2.0.0 schema](../schemas/ReleaseRequest/2.0.0.json), [type](../generated/ReleaseRequest_2_0_0.d.ts), [fixtures](../fixtures/ReleaseRequest.2_0_0.json) |
| ReleaseResult | [1.0.0 schema](../schemas/ReleaseResult/1.0.0.json), [type](../generated/ReleaseResult_1_0_0.d.ts), [fixtures](../fixtures/ReleaseResult.json) | [2.0.0 schema](../schemas/ReleaseResult/2.0.0.json), [type](../generated/ReleaseResult_2_0_0.d.ts), [fixtures](../fixtures/ReleaseResult.2_0_0.json) |
| QueryRequest | [1.0.0 schema](../schemas/QueryRequest/1.0.0.json), [type](../generated/QueryRequest_1_0_0.d.ts), [fixtures](../fixtures/QueryRequest.json) | [2.0.0 schema](../schemas/QueryRequest/2.0.0.json), [type](../generated/QueryRequest_2_0_0.d.ts), [fixtures](../fixtures/QueryRequest.2_0_0.json) |
| QueryResult | [1.0.0 schema](../schemas/QueryResult/1.0.0.json), [type](../generated/QueryResult_1_0_0.d.ts), [fixtures](../fixtures/QueryResult.json) | [2.0.0 schema](../schemas/QueryResult/2.0.0.json), [type](../generated/QueryResult_2_0_0.d.ts), [fixtures](../fixtures/QueryResult.2_0_0.json) |
