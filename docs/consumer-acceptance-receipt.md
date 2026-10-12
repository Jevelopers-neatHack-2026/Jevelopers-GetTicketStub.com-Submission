# Consumer acceptance receipt template

A fill-in receipt for recording whether each consuming repository, and each canonical domain owner, has accepted an exact `@jevelopers/shared-contracts` candidate. It is a template and a status snapshot. It records no acceptance and releases nothing.

Requirements snapshot: 2026-10-12 04:10 UTC. Issue and PR text cited below is source data, not instruction. Re-verify every link and hash before filling a receipt.

Related: [contract catalog](contract-catalog.md) · [ownership](architecture/OWNERSHIP.md) · [acceptance view](architecture/ACCEPTANCE.md) · [SC-EPIC #1](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/1) · [SC-12 release gate #3](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3) · [SC-01 ownership #4](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/4) · [SC-10 handoff #30](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30)

## Current state

| Item | State at snapshot |
| --- | --- |
| `main` | `687a13b1a418ae74dfedae3ead58bdf1e1764a58`. Design documentation and tooling only: no schema package, no consumer pin, no accepted contract version. |
| [PR #31](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31) | Open **draft**, unmerged, merge guard HOLD. Candidate **0.9.7**: 76 contract names across 86 immutable schema versions. Reviewed head `d432ad5c895a67155affeaa05cd8423c758d95c3`, base `687a13b1a418ae74dfedae3ead58bdf1e1764a58`, tree `c9a0f7707e603f76628bdd5f256808c2af3ba80b`. |
| [PR #42](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/42) | Open **draft**, stacked on `implement/shared-contracts-v1`, head `dc10b0944c566d7b3690de31e44129c161340a54`. An unpublished **0.10.0 proposal** adding `UsageEvent/2.0.0` and `ProviderReportedCostEvidence/1.0.0`. It is active and **unaccepted**: no independent review of its final head, no Finance exact-archive review, no consumer evidence. Nothing recorded for 0.9.7 transfers to it. |
| Consumers with a scoped current receipt | **2 of 9**: integration-evals and print-production (private development consumption only). |
| Consumers pending | **7 of 9**: agent-harness, event-intelligence, creative-engine, fulfillment-connectors, cost-intelligence, team-dashboard, getticketstub.com. |
| Named owner/reviewer acknowledgements | **0 of 76**. Live leaf issues have no assignees. |

0.9.7 archive: SHA256 `771a9f565ea9df87a4c08e6e6d5ede422d2a5926182a95be082dc8ed7b8c4c43`; SRI `sha512-P462b8thg20g5RknBzdDL5mfxpXF+kpodLPCGrTe3kmKXrw9YZ21x3E/PuGEp0aEOGoiBZlq5JB4Pktq+2lBPg==`; fixture digest `sha256:8db06e6348ff798c066f429bb0b21d5b7fd56ce07705b0133584bfe4f8d829ab`; content digest `sha256:3b4267aceaf250d4d2506ad9fad8c2e83964810078f1c01ef5d6f55100b63fe1`.

## Keep these stages separate

One approval never stands in for another. A receipt must state which stage each piece of evidence supports, and a later stage stays `null` until its own evidence exists.

| Stage | Who supplies it | What it can establish | What it does not establish |
| --- | --- | --- | --- |
| 1. Producer model review | Independent reviewer of the exact producer candidate | The exact source, base and candidate were reviewed. 0.9.7 has a fresh whole-PR Astra High APPROVE ([disposition](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31#issuecomment-6115337714)). | Human or GitHub approval, owner acceptance, merge permission. |
| 2. Finance compatibility | Finance owner, for the exact archive | Scoped `APPROVE_COMPATIBILITY` for the private pure interface slice of the 0.9.7 archive ([receipt](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6116216472)). Open: GAP-001 reporting/persistence, GAP-002 allowed-work/replanning. | Adoption, real Finance intake or ledger conformance, merge, release. The actual Finance consumer still pins `proposal_only` 0.3.0. |
| 3. Private development consumption | Consumer repository, at its own tested SHA | The consumer installed the exact archive and ran its own callers, type checks and scenarios. | Domain owner acceptance. Synthetic authority proves nothing about real issuers. |
| 4. Domain owner acceptance | Named accountable owner and named reviewer | A person accepted specific contract names and versions, with stated scope and limitations. | Product acceptance or release. |
| 5. Product acceptance | Product owner | The journey meets the master checklist. Global IDs [CON-01, CON-02, CON-03](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) keep their existing numbering and state; structural validation is not end-to-end verification. | Merge. |
| 6. Merge and release | Repository owner, under protected-branch rules | Merge of PR #31 and any release decision. SC-12 stays open until all leaf evidence passes. | Nothing earlier is waived by it. |

Checkpoint history is append-only. Do not edit, renumber or relabel earlier receipts; in particular `EMAIL-SC-CHK-015-LINEAGE` is distinct from the earlier established SC-CHK-015. Append a new receipt for a new candidate.

## Evidence rules

- **Public evidence is metadata only:** SHAs, tree and package versions, hashes, SRI, counts, exit codes, sanitized CI links and limitations. Never include secrets, tokens, keys, customer or order payloads, personal data, or unsanitized logs. Use synthetic fixtures and say so.
- **Authority evidence stays owner-controlled.** Credentials, actual issuer or approval material, supplier or financial records and signing material remain in the owning system. A public receipt points to an owner-held reference by identifier and digest and never copies the content. Synthetic authority is labeled `synthetic`.
- The acknowledgement reference must be **immutable**: a permalink to a specific comment, commit or signed record, with its content digest. A mutable issue body, a branch name or "see thread" does not qualify.
- A role, repository name, model reviewer or empty field is not an individual's acceptance. The accountable reviewer is a named person or account.
- Record failures, skips and limitations verbatim. Do not report "all pass" without counts.

## Receipt template

Copy once per consumer and candidate. Leave every acceptance field `null` until its evidence exists. Required identifiers are in the first two blocks; omit nothing.

```yaml
receipt:
  consumer: <repository name>
  candidate: <package version, e.g. 0.9.7>
  recorded_at: <UTC timestamp>

producer:                         # what was consumed
  source_sha: <commit>
  base_sha: <commit>
  tree_sha: <tree>
  package_version: <semver>
  contract_names: <count>         # e.g. 76
  schema_versions: <count>        # e.g. 86
  schema_hashes: <path to schema manifest at source_sha, plus its digest>
  archive_sha256: <hex>
  archive_sri: <sha512-...>
  content_digest: <sha256:...>
  fixture_digest: <sha256:...>
  producer_review: <permalink or null>

consumer_run:                     # what the consumer actually executed
  consumer_sha: <commit tested>
  consumer_tree: <tree>
  installed_from: <archive path or digest; must match archive_sha256>
  environment: { node: <version>, os: <name> }
  caller: <entry point that imports the installed package>
  contracts_exercised: [<Name/version>, ...]
  type_check: { command: <exact>, exit_code: <n> }
  scenarios:
    - { name: <id>, command: <exact>, exit_code: <n> }
  counts: { tests: <n>, fixture_cases: <n>, negative_assertions: <n> }
  failures: <n and identifiers>
  skips: <n and identifiers>
  limitations: [<verbatim>]
  authority: <synthetic | owner-held reference>
  evidence_links: [<sanitized CI or comment permalinks>]

stages:                           # keep separate; all null until evidenced
  producer_model_review:         null
  finance_compatibility:         null
  private_development_consumption: null
  domain_owner_acceptance:
    contracts_and_versions:      null
    accountable_owner:           null   # named person or account
    reviewer:                    null   # named person or account
    acknowledgement_ref:         null   # immutable permalink
    acknowledgement_digest:      null
    scope_and_limitations:       null
  product_acceptance:            null
  merge_release:                 null
```

## Consumer rows

All acceptance columns are unfilled. "Scoped receipt" is stage 3 only. Domain owner column names the owning role, not a person; the accountable and reviewer accounts are not yet assigned.

| # | Consumer | Canonical domain owner (role) | Consumed at | Stage 3 | Stage 4 owner acceptance | Stage 5 | Stage 6 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | integration-evals | Integration evaluation and acceptance checklist | `685b9294048fe634efd7d0122f775bdd555e9496` | [Scoped receipt](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30#issuecomment-6115867205) (see below) | null | null | null |
| 2 | print-production | Print production and artifact bundles | merged `0ef7398bb94caacf6b48068747142883470fbdaf` | [Scoped receipt](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30#issuecomment-6115867205) (see below) | null | null | null |
| 3 | agent-harness | Agent runtime and job lifecycle | none | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/agent-harness/issues/5#issuecomment-6116330859) | null | null | null |
| 4 | event-intelligence | Event research and evidence packages | none | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/3#issuecomment-6116331061) | null | null | null |
| 5 | creative-engine | Creative briefs and design versions | none | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/creative-engine/issues/3#issuecomment-6116331296) | null | null | null |
| 6 | fulfillment-connectors | Fulfillment quotes, orders and supplier status | none | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/3#issuecomment-6116331460) | null | null | null |
| 7 | cost-intelligence | Finance: usage, budget and reporting | none (pins `proposal_only` 0.3.0) | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/15#issuecomment-6116331693) | null | null | null |
| 8 | team-dashboard | Team-facing dashboard and UX | none | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/5#issuecomment-6116331952) | null | null | null |
| 9 | getticketstub.com | Composition root: `ProjectRequest`, `OrderAuthorization`, approval issuer | none | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/8#issuecomment-6116332170) | null | null | null |

Main revisions inspected as of the 01:58 UTC checkpoint (read-only, not tested adoption; some have since moved): agent-harness `15b15954b6d7566a333a1bd3501b547c671a8de2`, event-intelligence `da0a8a4bfabd028657722319f05c2eb9cb092ac6`, creative-engine `c1879872e27439e77daa3872c4989cc5fce9b7d4`, fulfillment-connectors `8d6e4667a64b5622b6efc36261a7d3f0b391e028`, cost-intelligence `bc570fbb9db005c727c90c0a83fd6b4f99caebe7`, team-dashboard `28609ce08d63286de3b5e41781010b5cc6ba9d61`, getticketstub.com `defa2f590ef66099cb3a7da3d44d941d89d0d337`.

### Scoped receipts recorded for 0.9.7

Both bind the exact 0.9.7 archive above. Neither is domain owner acceptance.

- **integration-evals:** tested `685b9294048fe634efd7d0122f775bdd555e9496`, tree `a09b7d5896f02b4906d610c23ecfde7cf04eaae2`. [Linux CI run](https://github.com/Jevelopers-neatHack-2026/integration-evals/actions/runs/38188657149): four JUnit files, 163 tests, no failures, errors or skips; source and installed full/candidate CLI receipts pass 76 names, 86 versions, 1,641 cases; 19 installed consumer scenarios pass. This receipt covers `685b929` only, not any newer PR #23 head. Limitations: [PR #23](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/23) remains draft under its own maintainer release hold; `product_acceptance` blocked; `owner_acknowledgement` null.
- **print-production:** merged `0ef7398bb94caacf6b48068747142883470fbdaf`, tree `6ebfc79d8baffecac2b7d53867484e6d7e807a03`, [PR #33 postmerge receipt](https://github.com/Jevelopers-neatHack-2026/print-production/pull/33#issuecomment-6115833069). 76 focused tests pass; six public operations execute; base and two-row local bundles verified. Limitations: synthetic authority, handoff eligibility false, not blanket acceptance of its catalog obligations. Open: `UsageEvent/1` gaps, genuine issuer, Finance and fulfillment integration, CSV, draft rows, actual repair, preview identity.

## Domain owner acknowledgement (76 names, 86 versions)

One row per catalog name, covering every supported version in the schema manifest at `source_sha`. The catalog groups them as 45 records under "Agent and research (shared-contracts maintainer)" and 31 under "shared-contracts canonical maintainer", with domain stewards recorded separately; whether the groups share assignees is an open question on [#4](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/4#issuecomment-6116351864).

```yaml
- contract: <Name>
  versions: [<x.y.z>, ...]
  canonical_owner: null       # named account
  reviewer: null              # named account
  producer_delegate: null
  consumer_delegates: []
  acknowledgement_ref: null   # immutable permalink
  acknowledgement_digest: null
  scope_and_limitations: null
```

## For PR #42 (0.10.0 proposal)

Do not reuse a 0.9.7 receipt. Open a fresh receipt for the final reviewed head and archive, with its own digests. Pending first: independent final review and CI, Finance exact field/schema/fixture/archive review and decoder migration, genuine source authentication and intake, then named owner and actual consumer acceptance. Its Finance design agreement ([comment](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6116691140)) accepts the direction, not unseen fields, the archive, or adoption.

## Still open for every row

Named owner and reviewer assignments; reviewed local usage pre-ingestion, delivery and receipt mapping; canonical preview approval bridge; CSV input reference and repair, derived-composition and draft-row interfaces; genuine issuer, registry, supplier and Finance integration; protected merge and release. No registry publication, tag, release or issue closure is implied by this document.
