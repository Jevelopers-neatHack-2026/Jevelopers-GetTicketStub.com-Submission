# Architecture, ownership, and evidence links

This registry keeps one authoritative source for each kind of decision. It is a navigation aid, not a lockfile and not evidence that a linked behavior exists.

## Source-of-truth registry

| Subject | Canonical owner and source | Local view | Update rule |
|---|---|---|---|
| Product architecture and repository boundaries | [getticketstub.com architecture kit v1.0 at inspected commit 7f59d33](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/7f59d33922a0585205547d490b288b49eed32419/docs/architecture-kit/v1.0/docs/architecture.md) | Each repository's OWNERSHIP.md | Product architecture owner approves decisions; preserve versioned snapshots and record rationale |
| Implementation work packages | [Central implementation plan at inspected source commit 5a29864](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/5a2986454297dd6df97088a8fbde69adc771f7a0/docs/planning/implementation-plan.md) | Repository issues and local plans | Product owner maintains cross-repo sequence; the plan map is not tested component metadata |
| Shared schemas and compatibility | [shared-contracts catalog at inspected commit c4caacc](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/c4caaccc2ea63b273eeac17ed89af8ac64f6bbde/docs/contract-catalog.md) | Consumer/provider links to a catalog entry and version | shared-contracts owns definitions; affected producer and consumer roles review changes |
| Acceptance IDs, evidence, and integrated status | [integration-evals checklist at inspected commit ff1f6d2](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/ff1f6d2df816ebbff34742f51be728fcb5c28cb5/planning/acceptance-checklist.md), its [JSON tracker](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/ff1f6d2df816ebbff34742f51be728fcb5c28cb5/planning/acceptance-checklist.json), and [evidence index](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/ff1f6d2df816ebbff34742f51be728fcb5c28cb5/evidence/README.md) | This repository's docs/architecture/ACCEPTANCE.md selects relevant IDs | integration-evals owner changes authoritative state after evidence review |
| Shared governance guidance | this .github repository | Local copies/adaptations in destination repositories | Shared source maintains proposed guidance; each destination owner approves local use |
| Implementation, local settings, and agent instructions | The repository that owns the behavior or setting | Its local AGENTS.md, README, OWNERSHIP.md, tests, and settings | Owning maintainers decide and verify locally; links do not transfer ownership |

These commit references identify inspected source revisions, not promises that they remain the latest. Use branch links for navigation only. Use full immutable commit links for evidence. Recheck current sources before a new decision.

## Link conventions

- Within one repository, use relative Markdown links and stable headings. If a heading changes, update inbound links in the same change.
- Across repositories, link to the exact owner/repository/path and, for evidence, a full commit SHA. A main-branch URL is a convenience link and can move.
- A tested source revision belongs in the evidence or release record. Do not describe the central planning repository map as a tested lockfile.
- A repository may record its own release revision in release metadata; do not put a self-referential SHA into the manifest whose commit is being measured.
- Private repository links may be inaccessible to some readers. Record access as restricted or unavailable to that reader; do not call an inaccessible link broken or verified.

## Cross-repository handoff

Before marking a dependency ready, record the exact producer and consumer issue URLs, owner roles, expected artifact and version, tested source revision if one exists, unblock condition, current status date, and evidence needed for consumer acknowledgment. If the issue or revision is unknown, write unknown and assign the resolution to an owner role. Do not manufacture an issue number, contract version, commit, or reviewer.

### Click-through walkthrough: GH-09 and the blocked SC-12 handoff

This navigation example uses real inspected sources and leaves unobserved implementation values unknown. The source links are useful for finding owners and work; their presence is not a test result.

| Step | Follow this link | What it establishes |
|---|---|---|
| Local ownership | [This repository's `OWNERSHIP.md`](../docs/architecture/OWNERSHIP.md) and [local `ACCEPTANCE.md`](../docs/architecture/ACCEPTANCE.md) | The first file describes the `.github` responsibility and role owners. The second selects local criteria; it explicitly leaves master status with integration-evals. |
| Governance work item and plan | [GH-09 issue #6](https://github.com/Jevelopers-neatHack-2026/.github/issues/6) and the [central implementation plan at inspected commit `5a2986454297dd6df97088a8fbde69adc771f7a0`](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/5a2986454297dd6df97088a8fbde69adc771f7a0/docs/planning/implementation-plan.md) | Issue #6 is the actual leaf for this source-linking guidance. The central plan remains the canonical product sequencing map; it is not a tested lockfile and does not turn the governance issue into product implementation evidence. |
| Catalog and contract gate | The [shared-contracts catalog at inspected commit `c4caaccc2ea63b273eeac17ed89af8ac64f6bbde`](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/c4caaccc2ea63b273eeac17ed89af8ac64f6bbde/docs/contract-catalog.md) and actual [SC-12 gate issue #3](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3) | The catalog is the maintained contract source. SC-12 owns release and consumer handoff evidence. At the cited inspection, executable schema, package, fixture, and accepted version evidence were absent; the exact schema and contract version therefore remain **UNKNOWN**. |
| Acceptance and evidence source | The [integration-evals master checklist at inspected commit `ff1f6d2df816ebbff34742f51be728fcb5c28cb5`](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/ff1f6d2df816ebbff34742f51be728fcb5c28cb5/planning/acceptance-checklist.md), its [JSON tracker](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/ff1f6d2df816ebbff34742f51be728fcb5c28cb5/planning/acceptance-checklist.json), and [evidence index](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/ff1f6d2df816ebbff34742f51be728fcb5c28cb5/evidence/README.md) | These preserve acceptance ownership and show where evidence belongs. The inspected tracker has no tested revision or evidence record for this handoff. The evidence index is an index, **not runtime proof**. |
| Local governance gate | This repository's [GH-11 issue #16](https://github.com/Jevelopers-neatHack-2026/.github/issues/16) and [local acceptance view](../docs/architecture/ACCEPTANCE.md) | GH-11 is the local governance release gate. Its gate keys are local checklist identifiers, not global master IDs; this walkthrough does not mark it passed. |
| Integrated project gate | The actual [integration-evals WP09 / IE-EPIC issue #1](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/1) and [IE-09A report issue #8](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/8) | Issue #1 is the integrated verification epic; issue #8 covers machine-readable reporting. They remain separately owned from this local guidance and do not inherit a pass from the links above. |

The handoff represented by this path is **BLOCKED**, recorded 2026-10-11 02:51 UTC from the cited immutable inspections (source status must be rechecked before a later decision):

| Handoff field | Current record |
|---|---|
| Producer and issue | shared-contracts maintainer role, Agent and research; [SC-12 issue #3](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3). Named assignee is unassigned in the inspected issue. |
| Consumer/release reviewer and issue | integration-evals owner role, Finance and reliability; [WP09 / IE-EPIC issue #1](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/1). Named reviewer is unassigned in the inspected issue. |
| Expected artifact and version | Canonical contract artifact, explicit schema/contract version, compatible producer and consumer pins, and fixtures/evidence required by SC-12. Exact artifact schema and version: **UNKNOWN** pending the catalog and contract owners. |
| Inspected source revisions | The linked `c4caaccc…` catalog and `ff1f6d2…` tracker are immutable documentation snapshots only. Runtime-tested producer/consumer revisions, fixture digest, command, and result: **UNKNOWN / NOT RUN**. |
| Unblock condition | Owners publish the versioned artifact and record exact producer/consumer SHAs, fixture identity/digest, command and result, limitations, and reviewer acknowledgment in the authoritative acceptance/evidence source; see [SC-12's acceptance and closure requirements](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3). |
| Status date and owner | **BLOCKED as of 2026-10-11 02:51 UTC.** Unblock roles are identified above; named owner/reviewer assignments remain **UNKNOWN** and must be set by those repositories' maintainers. |

This walkthrough records navigation and a blocked handoff, not a successful contract test, integrated run, or gate decision.

## Architecture and contract changes

For a behavior or schema change, write a decision record in the owning repository with context, options, tradeoffs, decision owner, affected producer/consumer roles, source revisions, compatibility, migration, and rollback. Update the maintained source first, then reverse links and local ownership/acceptance views. Retain immutable versioned snapshots when the architecture kit changes. Do not create a second canonical catalog or move state into this repository.

When guidance disagrees with an accepted local decision, preserve both source links, stop changes at the conflict boundary, and ask the owner of that decision. A code review may resolve a scoped implementation detail only when the authorized owner is clear.
