# MVP readiness checklist

**Status snapshot: 2026-10-12 04:10 UTC.** This page is a point-in-time summary, not a gate. The issues and receipts linked below are authoritative and may have changed since. Re-read them before relying on any row. Status claims use immutable comment permalinks or commit-pinned links, each labeled with its own timestamp. Issue and PR descriptions are mutable, so they are cited only for scope.

Related: [README](../README.md) · [contract catalog](contract-catalog.md) · [ownership](architecture/OWNERSHIP.md) · [acceptance view](architecture/ACCEPTANCE.md)

## Bottom line

**The MVP is not ready.** The private 0.9.7 producer candidate is approved for private development use only. The release gate, consumer acceptance and named-owner acknowledgements are all still open.

- `main` is `687a13b1a418ae74dfedae3ead58bdf1e1764a58` and has no schema package. [PR #31](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31) is an open, unmerged draft at `d432ad5c895a67155affeaa05cd8423c758d95c3`, package 0.9.7. Its [producer disposition](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31#issuecomment-6115337714) (2026-10-11 23:57 UTC) says it stays unmerged, with no registry publication or complete release approved.
- Scope is **32 required leaf issues**: the original 27 (#4–#30) plus #32 and #34–#37. They are tracked in [epic #1](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/1) and gated by [SC-12 / #3](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3). The leaf lists in the descriptions of #1 and #3 (not individually re-fetched here) say every leaf must have closure evidence and the gate stays open. #1, #3 and all five added leaves were read as OPEN on 2026-10-12.
- The description text of #1 and #3 still carries a 2026-10-11 refresh at 0.9.2 / `d0b9bad`. It predates 0.9.7. Use the receipts below for current state, not that text.

## What each approval does and does not cover

| Item | Established | Not established | Receipt (UTC timestamp) |
| --- | --- | --- | --- |
| Producer review of 0.9.7 | Model-independent **APPROVE** of the exact head: no unresolved local blockers, 5,182 tests passing, installed Node 22/24 archives passing. | Human or GitHub approval, merge permission, domain acceptance, release. | [PR #31 comment](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31#issuecomment-6115337714), 2026-10-11 23:57 |
| Finance owner | **APPROVE_COMPATIBILITY** for the exact archive's private pure-interface slice. | Adoption, ledger or intake conformance, human or GitHub review, merge, release. GAP-001 and GAP-002 are expressly outside it. | [issue #12 comment](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6116216472), 2026-10-12 01:37 |
| Scoped consumers | **2 of 9** have exact-current private-development consumption receipts: integration-evals and print-production. | Blanket domain acceptance. Both keep synthetic authority and holds. | [issue #30 comment](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30#issuecomment-6115867205), 2026-10-12 00:58 |
| Release and merge | Nothing. PR #31 is draft and the merge guard is HOLD. | — | [issue #30 checkpoint](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30#issuecomment-6116391932), 2026-10-12 01:58 |

Approved private 0.9.7 producer and Finance receipts are **not** release acceptance, and 2 of 9 scoped consumers is **not** complete consumer acceptance. Don't substitute one for the other. Older approvals do not transfer to later heads or archives.

## Checklist

- [ ] Complete 32-leaf scope has closure evidence and producer/consumer review ([#1](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/1), SC-EPIC.1).
- [ ] Release gate [#3](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3) passes every criterion with pinned revisions and offline results.
- [ ] Final exact source, base and candidate have a fresh independent review. The 0.9.7 producer APPROVE is recorded; any later head needs its own.
- [ ] Finance compatibility receipt for the actual final archive. Recorded for the 0.9.7 private slice only.
- [ ] All nine consumers have tested pins and receipts (2 of 9 done).
- [ ] 76 catalog names have named canonical owner and reviewer acknowledgements (0 of 76).
- [ ] Preview identity mapping decided.
- [ ] Local usage pre-ingestion, delivery and receipt mapping decided.
- [ ] GAP-001 (Finance reporting and persistence) resolved.
- [ ] GAP-002 (allowed-work and replanning) resolved.
- [ ] Production CSV input, draft-row and repair decisions made.
- [ ] Genuine issuer, registry, supplier and Finance integrations exist.
- [ ] Protected merge and release obligations met.

## Prioritized blockers

Owners are roles or repositories taken from the receipts. No named individual is assigned anywhere in them, and none is invented here.

| # | Blocker | Owner (as recorded) | Issue | Evidence (UTC) |
| --- | --- | --- | --- | --- |
| 1 | **76 named owner and reviewer acknowledgements.** No catalog name has a named canonical owner, reviewer or acknowledgement, and the leaf issues have no assignees. Accounts are requested for either one pair for all 76, or separate pairs for the 45 foundation/domain and 31 capability/production records. | The user is asked to supply the names. Per the receipt, the account and acknowledgement fields stay null until supplied and verified. | [#4](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/4) | [Ownership update](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/4#issuecomment-6116351864), 2026-10-12 01:53 |
| 2 | **Seven missing consumer receipts**: agent-harness, event-intelligence, creative-engine, fulfillment-connectors, cost-intelligence, team-dashboard, getticketstub.com. Discovery of their source is not adoption. Finance's consumer still pins `proposal_only` 0.3.0, so it needs its own reviewed upgrade. | Each consumer's domain owner (roles only) | [#30](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30) | [Remaining-work checkpoint](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30#issuecomment-6116391932), 2026-10-12 01:58. Handoffs: [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness/issues/5#issuecomment-6116330859) · [event-intelligence](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/3#issuecomment-6116331061) · [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine/issues/3#issuecomment-6116331296) · [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/3#issuecomment-6116331460) · [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/15#issuecomment-6116331693) · [team-dashboard](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/5#issuecomment-6116331952) · [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/8#issuecomment-6116332170) |
| 3 | **Preview identity mapping.** `ApprovalReceipt/1` names legacy `Preview/1` while production output uses `ArtifactFile/2`. Eligibility returns `LEGACY_UNREPRESENTABLE`. An owner must choose a new versioned ApprovalReceipt or an application-owned verified binding record. | Application / approval issuer; print retains byte verification (roles) | [#22](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/22) | [Mapping request](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/22#issuecomment-6116351160), 2026-10-12 01:53 |
| 4 | **Local usage delivery mapping.** `UsageEvent/1` cannot truthfully represent the actual local print observation. Finance must decide the pre-ingestion event, separate delivery envelope, consumer receipt, dedup/correction rule, missing-partition handling and unvalued-effect rule. | Finance (cost-intelligence) with the print producer | [#11](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/11) | [Decision packet](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/11#issuecomment-6116350871), 2026-10-12 01:53; [actual-row evidence](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/11#issuecomment-6115619581), 2026-10-12 00:30 |
| 5 | **GAP-001** (reporting and persistence) and **GAP-002** (allowed-work and replanning) remain open. Cap-only partial financial dispatch still gets a typed refusal. The Finance receipt does not cover either. | Finance owner (role) | [#12](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12), [#13](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/13) | [Finance receipt](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6116216472), 2026-10-12 01:37 |
| 6 | **Production CSV, draft-row and repair decisions.** Three open choices: a separately versioned CSV input descriptor (activation stays `CAPABILITY_DISABLED`), private versus restricted-public draft rows, and the derived-composition, approval and lineage mapping for repairs. | Print, application and Creative owners (roles) | [#36](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/36) | [Mapping request](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/36#issuecomment-6116351549), 2026-10-12 01:53 |
| 7 | **Genuine issuer, registry, supplier and Finance integration; protected merge; release obligations.** | Domain owners and maintainer (roles) | [#3](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3) | [PR #31 description](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31), live text at 04:10 (mutable); [producer disposition](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31#issuecomment-6115337714), 2026-10-11 23:57 |

## Out of scope: PR #42 (usage 0.10.0)

[PR #42](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/42) proposes `UsageEvent/2.0.0` and `ProviderReportedCostEvidence/1.0.0` as an unpublished **0.10.0** change. As of 2026-10-12 04:07 UTC it is an open draft at `dc10b0944c566d7b3690de31e44129c161340a54`, based on `implement/shared-contracts-v1` and stacked on PR #31.

It is **active and excluded** from this checklist. No receipt counts toward the 0.9.7 evidence above. Its description lists a fresh independent review, Finance exact field/schema/archive review and consumer acceptance as pending, and says prior 0.9.7 approvals do not transfer. It also says the local-usage delivery mapping (blocker 4), GAP-001/GAP-002, CSV/draft/repair and preview mapping remain separate.

Finance's [scoped design agreement](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6116691140) (2026-10-12 02:31 UTC) accepts the direction only, not unseen fields, an archive or adoption.

## Deferring an item from the MVP

Any item above may be deferred out of the MVP, but only by an **explicit, recorded decision** by the accountable owner. Record the item, its issue, the decision-maker, the reason, and what the MVP will and won't claim as a result.

A deferral is a scope decision. It never weakens a gate:

- The issue's criterion stays open and unchecked.
- A deferred item is not reported as satisfied, waived or "accepted with exceptions".
- Gate #3 stays blocked until its evidence passes, or until the maintainers amend its criteria in the open.

No such decision exists in the sources read for this page. Nothing here is a deferral, and no deadline or approval is implied.

## How to refresh this page

1. Re-read #1, #3, #4, #30 and their newest comments, plus PR #31 and PR #42.
2. Replace each status with the current immutable permalink and its timestamp.
3. If PR #31's head changes, re-verify every receipt against the new head, because old approvals do not transfer.
