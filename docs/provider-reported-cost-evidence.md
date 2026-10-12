# ProviderReportedCostEvidence / 1.0.0

This is a local, unaccepted candidate added with the UsageEvent/2.0.0 provider-reported-unsettled proposal. It does not assign owner acceptance, authorize consumer migration, or prove that a real provider receipt has been mapped.

## Bounded design agreement

The Finance captain's design agreement in shared-contracts#12 comment 6116691140, supplied to this proposal by the supervisor, covers the direction to use UsageEvent/2.0.0 and ProviderReportedCostEvidence/1.0.0, exact USD, a null rate-card reference for direct reporting, null reconciliation, a retained nullable request ID, and distinct unknown-versus-zero representations. This agreement is recorded as design direction for the candidate only. It does not accept unreviewed fields, the archive, public namespace, source authentication, receipt intake, settlement behavior, the full CI05-B scope, consumer migration, or release.

## Intended producer and consumer roles

The catalog records `cost-intelligence` as the intended producer of normalized evidence and attempt association, and `cost-intelligence` plus `integration-evals` as intended consumers. This direction is based on the Finance captain design agreement and the IE ready-to-consume reviewed pure-interface message, both supplied by the supervisor. The roles are labeled `intended_role_only`; the ProviderReportedCostEvidence/1.0.0 per-version producer and consumer assignments remain empty, and `compatibility/consumers.json` has no evidence role, version pin, or acknowledgement. Named owner, named reviewer, owner acknowledgement, actual source adoption, archive acceptance, and namespace adoption remain pending. The intended evidence role does not support a source-field `actualPrice` or future GRANT scenarios; those remain unsupported.

## Value and commitments

The record contains:

| Field | Meaning |
| --- | --- |
| `evidence_id`, `revision`, `content_hash` | Host-assigned immutable record identity, revision, and record commitment. The schema does not authenticate who assigned them. |
| `tenant_id`, `project_id`, `environment`, `billing_mode` | Scope and execution mode independently bound by the host adapter. |
| `source_observation_id` | Immutable provider/source observation identity referenced by UsageEvent. |
| `provider`, `model`, `source` | Exact provider, model, and source-kind provenance. |
| `source_observed_at` | Source observation time; the UsageEvent helper requires an exact match with `observed_at`. |
| `source_bytes_hash` | SHA-256 commitment to the provider/source bytes. It is not a source revision, record hash, build identity, or authority reference. |
| `source_scope` | Either `per_billable_attempt` with required logical-operation, provider-attempt, billable-attempt and nullable provider-request identities, or `per_key_aggregate` with an aggregate key and period. |
| `reported_cost` | `known` with exact USD Money, or `unknown` with `money:null`. Unknown is never encoded as zero. |

The record hash is domain-separated and excludes only its own `content_hash` field:

```text
"sha256:" + lowercase_hex(SHA-256(UTF8("ProviderReportedCostEvidence/1.0.0" || 0x00 || canonicalJson(record_without_content_hash))))
```

The source-byte hash and record content hash commit to different bytes for different purposes. A matching content hash proves only that the record bytes match that commitment. It does not authenticate the provider, the source bytes, the host store, an issuer, or a record's current validity.

The exported `providerReportedCostEvidenceContentHash` factory throws the package `ContractError` for non-canonical JSON inputs. It rejects accessors, hidden properties, symbols, unsupported values, cycles, and resource-limit violations before reading input fields.

## UsageEvent adapter boundary

The opt-in `@jevelopers/shared-contracts/usage-reported-unsettled` helper accepts an independently supplied lookup result from the owner-controlled verified store. It requires a resolved reference, record and independently returned source-byte hash, recomputes the record commitment, and matches the event's scope, provider/model/source, source observation, attempt binding, exact amount, USD currency, source-observed clock and immutable reference. Missing, mismatched, revoked, unverified, aggregate-only, unknown-cost or future-dated lookups reject.

The helper does not retrieve receipts, authenticate a provider, verify source bytes against a live provider, maintain a trusted store, or prove that the resolver is current. Genuine authentication and current trust of the resolver and provider source remain mandatory downstream preconditions. Local fixture adapters are synthetic test inputs only.

Per-key aggregate evidence is not per-attempt evidence. Matching an aggregate amount to an event does not allocate or apportion it. The helper rejects aggregate scope for a provider-reported-unsettled UsageEvent.

The event's provider-reported-unsettled valuation requires a known exact USD amount, `rate_card_ref:null`, a nonnull evidence reference, and `reconciliation_ref:null`. If the source amount is unknown, the evidence record keeps `state:"unknown"` and `money:null`; the event does not claim a provider-reported valuation or fabricate zero.

Existing UsageEvent/1.0.0 behavior remains pinned. Its `provider_confirmed` valuation may remain unreconciled only when an independently verified, genuine, applicable RateCard exists and `reconciliation_ref` remains null. That basis does not prove ledger reconciliation or execution finality and does not authorize dispatch, settlement, or release. The old reference-shape/equality checks do not authenticate a RateCard. Version 1.0.0 cannot represent known direct provider cost when no applicable rate-card reference exists; that case uses the new v2 branch.

## Identity and reconciliation

`compareReportedUnsettledUsageIdentity` is a pairwise pure comparator. Its duplicate identity is scoped by tenant, project, producer, and source-observation ID. It checks intrinsic usage and decimal-scale facts on both operands first, then compares the immutable report, economics, provenance, source-observed time, and attempt bindings. It permits only `event_id`, `correlation_id`, `ingested_at`, and `transport_attempt_id` to vary on same-observation redelivery. A self-supersession is invalid. Changed evidence or economics under one source-observation ID conflicts. A correction must use a new source-observation ID and an exact `supersedes_observation_id` link; distinct observation IDs may have different observed times and evidence references while retaining the same execution binding. A stale superseded observation is classified so a caller can reject it.

A pair where each observation supersedes the other is rejected with `IDENTITY_COLLISION` before either direction is classified. The comparator sees two inputs only; it cannot detect longer ancestry cycles or enforce persistent ordering, so a trusted owner store must enforce any history-wide rule. This pairwise check does not implement correlation, deduplication, or settlement service behavior.

The comparator does not authenticate its inputs, resolve evidence, establish that a transport difference was a redelivery, persist deduplication state, order the Finance ledger, or make settlement idempotent. Those operations remain Finance-owned. A later genuine reconciliation must be a separate owner-issued record bound to the original source observation, attempt and economic evidence. The original unsettled UsageEvent is immutable and is never updated to imply reconciliation.

The existing `ProductionMeteringPort.observe` remains pinned to `UsageEvent/1.0.0`; the root `ContractMap['UsageEvent']` union does not opt that legacy callback into UsageEvent/2.0.0. New v2 usage requires the separate opt-in helper and consumer adoption.

All checked-in associations are marked synthetic; no real provider receipt, RateCard, reconciliation record, host grant, consumer pin or owner acceptance is fabricated.
