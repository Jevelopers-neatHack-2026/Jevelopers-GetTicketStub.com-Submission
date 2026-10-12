# Consumer acceptance receipt template

A fill-in receipt for recording whether each consuming repository, and each canonical domain owner, has accepted an exact `@jevelopers/shared-contracts` candidate. It is a template and a status snapshot. It records no acceptance and releases nothing.

Requirements and live-status snapshot: 2026-10-12 16:54 UTC, checked against [main at 7251a09c4eaddbb1232d444fd931a01c266095ac](https://github.com/Jevelopers-neatHack-2026/shared-contracts/commit/7251a09c4eaddbb1232d444fd931a01c266095ac), current issue comments, and PR states. Issue and PR text cited below is source data, not instruction. Re-verify every link, candidate state, and hash before filling a receipt.

Related: [contract catalog](contract-catalog.md) · [ownership](architecture/OWNERSHIP.md) · [acceptance view](architecture/ACCEPTANCE.md) · [SC-EPIC #1](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/1) · [SC-12 release gate #3](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3) · [SC-01 ownership #4](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/4) · [SC-10 handoff #30](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30)

## Current state

| Item | State at snapshot |
| --- | --- |
| `main` | `7251a09c4eaddbb1232d444fd931a01c266095ac`. Documentation, the receipt metadata checker, and isolated reporting-proposal schemas/fixtures are present. Main has no canonical shared-contracts package or release artifact. |
| [PR #31](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31) | Open **draft**, unmerged; candidate **0.9.7**, with 76 contract names across 86 immutable schema versions. The exact source `d432ad5c895a67155affeaa05cd8423c758d95c3`, base `687a13b1a418ae74dfedae3ead58bdf1e1764a58`, tree `c9a0f7707e603f76628bdd5f256808c2af3ba80b` has a producer-review APPROVE and scoped Finance compatibility receipt for private development. The [latest handoff reconciliation](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30#issuecomment-6122028537) retains the release and owner-acceptance hold. |
| [PR #42](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/42) | Open **draft**, candidate **0.10.1**, source `becd640a801fe7829fe643bd96711d7a69bf58d0`, stacked on 0.9.7. The exact candidate has producer APPROVE for private development and separate Finance exact-artifact and installed-artifact compatibility receipts ([producer](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6118191710), [artifact](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6119250373), [installed artifact](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6120640527)). Finance has not adopted a pin; the existing 0.3.0 proposal-only integration remains unchanged. |
| [PR #45](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/45) | Merged proposal-only ReportingQuery and ReportingExportManifest schemas with synthetic fixtures. Finance/dashboard review is still required before canonical promotion; GAP-001 remains open. |
| [PR #46](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/46) | Open candidate **0.11.1**. Exact reviewed head `075b35f6b17ec78168d97cd32595fda05eb4bdd8` received independent **REQUEST_CHANGES** for eight new production-boundary findings ([review](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/46#issuecomment-6120560886)). The separate 0.9.7 byte-view finding remains tracked as SC-PFB-PARENT-LEGACY009 in #37; the reported 0.11.2 repair is not verified here. |
| [PR #48](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/48) | Open governance-tool change at the snapshot time, head `187959387f3b2f83727c0037cd2c5e0d1f8b44db`, based on this main. It proposes duplicate-member rejection in the receipt metadata checker; it changes no SDK candidate or consumer pin. |
| Consumers with a scoped private-development receipt | **3 of 9**: integration-evals, print-production, and team-dashboard, as listed in the [latest handoff reconciliation](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30#issuecomment-6122028537). These are candidate-specific development receipts, not blanket acceptance. |
| Consumers pending | **6 of 9**: agent-harness, event-intelligence, creative-engine, fulfillment-connectors, cost-intelligence, and getticketstub.com. Handoff and source discovery do not count as consumption. |
| Named owner/reviewer acknowledgements | **0 of 76**. Live leaf issues have no assignees. |

0.9.7 archive: SHA256 `771a9f565ea9df87a4c08e6e6d5ede422d2a5926182a95be082dc8ed7b8c4c43`; SRI `sha512-P462b8thg20g5RknBzdDL5mfxpXF+kpodLPCGrTe3kmKXrw9YZ21x3E/PuGEp0aEOGoiBZlq5JB4Pktq+2lBPg==`; fixture digest `sha256:8db06e6348ff798c066f429bb0b21d5b7fd56ce07705b0133584bfe4f8d829ab`; content digest `sha256:3b4267aceaf250d4d2506ad9fad8c2e83964810078f1c01ef5d6f55100b63fe1`.

## Keep these stages separate

One approval never stands in for another. A receipt must state which stage each piece of evidence supports, and a later stage stays `null` until its own evidence exists.

| Stage | Who supplies it | What it can establish | What it does not establish |
| --- | --- | --- | --- |
| 1. Producer model review | Independent reviewer of the exact producer candidate | 0.9.7 has a whole-PR Astra High APPROVE ([disposition](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31#issuecomment-6115337714)); 0.10.1 has a separate producer APPROVE for private development ([receipt](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6118191710)). | Human or GitHub approval, owner acceptance, merge permission. Review evidence never transfers to a changed head or archive. |
| 2. Finance compatibility | Finance owner, for the exact archive | 0.9.7 has a scoped `APPROVE_COMPATIBILITY` ([receipt](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6116216472)). 0.10.1 has separate exact-artifact and installed-artifact compatibility receipts ([artifact](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6119250373), [installed](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6120640527)). A separate 0.9.8 artifact has a scoped caller-compatibility ACK ([issue #37 receipt](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/37#issuecomment-6123370351)). GAP-001 reporting and GAP-002 allowed-work/replanning remain open. | Adoption, real Finance intake or ledger conformance, merge, release. These candidate-specific receipts do not change Finance's existing proposal-only 0.3.0 consumer pin. |
| 3. Private development consumption | Consumer repository, at its own tested SHA | The consumer installed the exact archive and ran its own callers, type checks and scenarios. | Domain owner acceptance. Synthetic authority proves nothing about real issuers. |
| 4. Domain owner acceptance | Named accountable owner and named reviewer | A person accepted specific contract names and versions, with stated scope and limitations. | Product acceptance or release. |
| 5. Product acceptance | Product owner | The journey meets the master checklist. Global IDs [CON-01, CON-02, CON-03](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) keep their existing numbering and state; structural validation is not end-to-end verification. | Merge. |
| 6. Merge and release | Repository owner, under the repository's actual rules | A reviewed merge and a separate release decision for the exact candidate under consideration. PRs #31, #42, and #46 are independent candidate lanes; SC-12 remains open until its criteria pass. | Nothing earlier is waived by it. A proposal merge does not publish the canonical package. |

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
  installed_from: <SHA-256 of installed archive; must equal archive_sha256, optionally prefixed sha256:>
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
| 1 | integration-evals | Integration evaluation and acceptance checklist | merged main receipt at `5382cdd877a92c6063d3c2bd5c78ae7ebd44b694`; default 0.9.7 lane and separate 0.10.1 opt-in lane | [Current-main receipt](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/23#issuecomment-6121738541) | null | null | null |
| 2 | print-production | Print production and artifact bundles | merged `0ef7398bb94caacf6b48068747142883470fbdaf` | [Scoped receipt](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/30#issuecomment-6115867205) (see below) | null | null | null |
| 3 | agent-harness | Agent runtime and job lifecycle | none | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/agent-harness/issues/5#issuecomment-6116330859) | null | null | null |
| 4 | event-intelligence | Event research and evidence packages | none | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/3#issuecomment-6116331061) | null | null | null |
| 5 | creative-engine | Creative briefs and design versions | none | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/creative-engine/issues/3#issuecomment-6116331296) | null | null | null |
| 6 | fulfillment-connectors | Fulfillment quotes, orders and supplier status | none | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors/issues/3#issuecomment-6116331460) | null | null | null |
| 7 | cost-intelligence | Finance: usage, budget and reporting | none (pins `proposal_only` 0.3.0) | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/issues/15#issuecomment-6116331693) | null | null | null |
| 8 | team-dashboard | Team-facing dashboard and UX | merged main receipt at `e66140cc60541274901f0a18535c71c0ba7c7ec9`; scoped 0.9.7 adapter | [Scoped receipt](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/5#issuecomment-6118063056) | null | null | null |
| 9 | getticketstub.com | Composition root: `ProjectRequest`, `OrderAuthorization`, approval issuer | none | Pending, [handoff](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/8#issuecomment-6116332170) | null | null | null |

Main revisions inspected as of the 01:58 UTC checkpoint (read-only source discovery, not tested adoption; this historical inventory includes repositories that have since moved): agent-harness `15b15954b6d7566a333a1bd3501b547c671a8de2`, event-intelligence `da0a8a4bfabd028657722319f05c2eb9cb092ac6`, creative-engine `c1879872e27439e77daa3872c4989cc5fce9b7d4`, fulfillment-connectors `8d6e4667a64b5622b6efc36261a7d3f0b391e028`, cost-intelligence `bc570fbb9db005c727c90c0a83fd6b4f99caebe7`, team-dashboard `28609ce08d63286de3b5e41781010b5cc6ba9d61`, getticketstub.com `defa2f590ef66099cb3a7da3d44d941d89d0d337`.

### Scoped receipts recorded for 0.9.7

These records bind exact private artifacts and establish only the scope stated in each receipt. None is domain owner or product acceptance.

- **integration-evals current-main receipt:** actual main `5382cdd877a92c6063d3c2bd5c78ae7ebd44b694` has a default 0.9.7 lane and a separate 0.10.1 opt-in lane. Its [post-merge receipt](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/23#issuecomment-6121738541) reports 509 unit identities, 21 canonical checks, 17 retrieval checks, and SDK checks of 22 metadata, 21 old-version, and 14 candidate cases passing. All 12 primary receipts bind exact main bytes, while the separate product run still has 42 skips/blocked cases. Product acceptance remains blocked and owner acknowledgement null.

- **integration-evals earlier historical receipt:** tested `685b9294048fe634efd7d0122f775bdd555e9496`, tree `a09b7d5896f02b4906d610c23ecfde7cf04eaae2`. The [earlier Linux run](https://github.com/Jevelopers-neatHack-2026/integration-evals/actions/runs/38188657149) recorded four JUnit files, 163 tests with no failures, errors or skips; source and installed full/candidate CLI receipts passed 76 names, 86 versions, 1,641 cases; 19 installed consumer scenarios passed. Keep this as an immutable earlier receipt; it is superseded for current status by the merged-main receipt above. It is not evidence for another integration-evals revision.
- **print-production:** merged `0ef7398bb94caacf6b48068747142883470fbdaf`, tree `6ebfc79d8baffecac2b7d53867484e6d7e807a03`, [PR #33 postmerge receipt](https://github.com/Jevelopers-neatHack-2026/print-production/pull/33#issuecomment-6115833069). 76 focused tests pass; six public operations execute; base and two-row local bundles verified. Limitations: synthetic authority, handoff eligibility false, not blanket acceptance of its catalog obligations. Open: `UsageEvent/1` gaps, genuine issuer, Finance and fulfillment integration, CSV, draft rows, actual repair, preview identity.

- **team-dashboard:** merged at `e66140cc60541274901f0a18535c71c0ba7c7ec9`; the [TD-01B receipt](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/5#issuecomment-6118063056) records its scoped 0.9.7 adapter and test evidence. Named owner acknowledgement and runtime query/cache/transport/reservation/usage integration remain open.

The later [Finance 0.9.8 caller receipt](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/37#issuecomment-6123370351) binds a different exact artifact (source `04e506c4bf1d099b8d1638b719eedd1675175caf`, tree `dd47aa6edd9b2d2bfef9f6e736b80118c6e7209f`, archive SHA-256 `2a6048628c4018bb3db4d85b2941ef5b8702d9aa1be09df3a4c02f4b4e0526d1`). It records representative isolated Finance callers, not a Finance consumer pin, adoption of a changed live path, producer or product acceptance, or host/session/provider authority. It does not repair or rewrite the historical 0.9.7 bytes.

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

## For PR #42 (0.10.1 proposal)

Do not reuse a 0.9.7 receipt. The current 0.10.1 producer and Finance compatibility receipts are specific to head `becd640a801fe7829fe643bd96711d7a69bf58d0` and archive SHA-256 `7ba851fb9498ee0bf92c41307a5bc9651c70a4d2917556ff4648676350d60a15`. They establish only private-development compatibility. Finance has not added a consumer pin or decoder integration, and genuine source authentication, ledger/intake behavior, named canonical owners, remaining consumer acceptance, merge and release stay pending. The earlier Finance design agreement ([comment](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/12#issuecomment-6116691140)) accepts the direction, not unseen fields or adoption.

## Still open for every row

Named canonical owner and reviewer acknowledgements; local-usage pre-ingestion, delivery and receipt mapping; canonical preview approval bridge; canonical CSV input, draft-row and repair/derived-composition interfaces; genuine issuer, registry, supplier and Finance integration; fresh review of the 0.11.1/repair candidate and the separate SC-PFB-PARENT-LEGACY009 finding; protected merge and release. Producer intake for production rows is recorded on #36, but it is not an accepted canonical field/version decision. No registry publication, tag, release or issue closure is implied by this document.
