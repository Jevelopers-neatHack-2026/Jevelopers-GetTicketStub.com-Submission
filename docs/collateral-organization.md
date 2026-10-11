# Collateral organization and navigation

This guide accompanies the [machine-readable collateral inventory](collateral-inventory.json). The inventory is the record for asset IDs, family dispositions, path availability, lifecycle, issue ownership, source and provenance references. This guide explains where work belongs and how to preserve its evidence and history.

## Current baseline

At starting revision `97c8aa25ac13d9032033f01ddfd6f536f0bb962b`, `git ls-files` listed only `README.md`, `docs/architecture/OWNERSHIP.md`, and `docs/architecture/ACCEPTANCE.md`. No media, collateral module directories, scripts, export tooling, CI, or `AGENTS.md` were present. The two MM-01 files are created in this candidate and remain drafts until review. No media asset has been migrated.

GitHub repository metadata was checked on **2026-10-11 UTC** using the public REST endpoint `https://api.github.com/repos/Jevelopers-neatHack-2026/marketing-material`; it returned `private=false`, `visibility=public`, and default branch `main`. [OWNERSHIP.md](architecture/OWNERSHIP.md) records this correction. Visibility describes the repository setting only. Every asset still needs its own rights, consent, redaction, claim and destination review before release.

The user assigned the marketing-material supervisor as accountable marketing content/review owner. The MM-01 general-worker task produced this draft inventory. A fresh Astra High reviewer will independently assess the frozen candidate. Neither the draft nor that review substitutes for producer-owned product, brand, financial, sponsor, privacy or rights approvals.

## Path map

| Path | Availability | Purpose and owner boundary |
| --- | --- | --- |
| `README.md` | Existing baseline; updated in this candidate | Entry point and links to maintained navigation and acceptance references. |
| `docs/architecture/OWNERSHIP.md` | Existing baseline; visibility description corrected in this candidate | Repository responsibility and canonical-source boundaries. |
| `docs/architecture/ACCEPTANCE.md` | Existing baseline | Local acceptance navigation; the integration-evals checklist remains authoritative. |
| `docs/collateral-inventory.json` | Created in this candidate | Stable IDs, family dispositions, candidate/planned paths, owners, issues, claims and provenance references. |
| `docs/collateral-organization.md` | Created in this candidate | This navigation, boundary, lifecycle and retention guide. |
| `messaging/` | Proposed; not created | Positioning, audience, value proposition, approved messages and claim ledger. |
| `demo/` | Proposed; not created | Storyboard, narration, recording checklist, submission narrative and evidence-linked support files. |
| `launch/` | Proposed; not created | Social and announcement copy, product descriptions, accessible descriptions and approved export references. It supplies copy handoffs to `landing-page-repo`; it is not the primary landing-page runtime. |
| `examples/` | Proposed; not created | Approved demo outputs with source, rights, attribution and destination records. |
| `review/` | Proposed; not created | Messaging, provenance, brand-consumption, accessibility and release review records. |

The five module names come from the accepted ownership plan. They are proposed locations, not claims that their files or assets exist. Do not add empty folders to make the plan look implemented. Current and proposed paths, including future issue IDs, are listed in the inventory.

## Six collateral family decisions

| Family | MM-01 disposition | V1 use or defer reason | Issue and planned IDs |
| --- | --- | --- | --- |
| Hackathon demo assets | Planned | One truthful journey, timed story and submission narrative. The official event format requires a video no longer than three minutes that covers each partner's architecture, implementation, runtime, reasoning and result, plus a public repository and supporting evidence. Recheck the official rules before final media. | [MM-03 #9](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/9): `DEMO-EXPLAINER-001`, `DEMO-STORYBOARD-001`, `DEMO-NARRATION-001`, `DEMO-RECORDING-CHECKLIST-001`, `DEMO-SUBMISSION-NARRATIVE-001`, `DEMO-SUBMISSION-VIDEO-001`. |
| Social posts and cards | Planned | The official submission requires an X quote-post of the neatlogs post with team, name, project, public repository and demo link. Share announcement asset IDs to avoid duplicate copy or artwork. No broader channel cadence is assumed, and nothing is posted by this task. | [MM-04 #10](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/10): `LAUNCH-X-COPY-001`, `LAUNCH-X-KEY-VISUAL-001`, `LAUNCH-X-ALT-TEXT-001`, `LAUNCH-X-CTA-001`. |
| Product explainers and system diagrams | Planned | A product explanation is required. A separate diagram is deferred unless the approved storyboard identifies a useful, evidence-backed scene. | [MM-03 #9](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/9): `DEMO-EXPLAINER-001`; conditional `DEMO-WORKFLOW-DIAGRAM-001`. |
| Pitch and demo deck support | Deferred | No current official deck requirement or story-confirmed use is recorded. Activate only if the storyboard or refreshed organizer rules require it. | [MM-03 #9](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/9): `DEMO-DECK-SUPPORT-001` (deferred). |
| Screenshots and mockups | Deferred | No approved image exists. Wait for a specific scene need and sanitized, authorized source material, or a clearly labeled conceptual mockup brief. | [MM-03 #9](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/9) and [MM-05 #6](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/6): `DEMO-SCREENSHOT-SET-001` (deferred). |
| Launch and update announcements | Planned | One X submission/demo-sharing set is required. Recaps, feature callouts and other update artwork need a confirmed use, owner and evidence, so remain deferred. | [MM-04 #10](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/10): the four `LAUNCH-X-*` IDs above; `LAUNCH-UPDATE-RECAP-001` (deferred). |

The [official event page](https://neatlogs.com/hackathon) was checked on 2026-10-11 UTC. It requires a public X quote-post of the official post with team, name, project, public repository and demo link; a demo video of three minutes or less that covers neatlogs, Entire and cfo.ai (architecture, implementation, runtime, reasoning and result for each); and supporting repository evidence. The published submission window is October 12, 7:00–11:55 PM IST as a planned close, with the confirmed final cutoff announced on Discord. Recheck the official post and cutoff before producing final variants. A draft is not an external submission or publication authorization.

## Canonical sources and evidence boundaries

| Subject | Canonical owner/source | Marketing-material use |
| --- | --- | --- |
| Visual identity, tokens, logo and voice | `brand-kit` | Consume the pinned, approved revision. Do not recreate or redefine the brand system or copy unapproved assets. |
| Product behavior and application state | `getticketstub.com` | Describe only behavior demonstrated by a pinned implementation/evidence reference. An issue, diagram, architecture plan or proposed PR is not proof of shipped behavior. |
| Sanitized measures, integration and sponsor evidence | `integration-evals` and the relevant sponsor/source owners | Link exact evidence and preserve its labels, mode and limitations. Marketing does not create or verify EVAL/SPN evidence. |
| Financial definitions and actuals | `cost-intelligence` | Use its reporting definitions and source-owner evidence; no forecast, savings or spending claim from a hypothetical export. |
| Landing-page composition and runtime | `landing-page-repo` | Receive approved copy and destination references from `launch/`; do not implement or claim the runtime here. |
| Organizer requirements | Official organizer source | Record source URL and access date for each format decision; refresh before final export or submission. |
| Words, examples and presentation handoff | `marketing-material` | Maintain claims, story, copy and approved collateral references with provenance and use-specific review. |

Claim references point to MM-02's planned `messaging/claims.json` and the upstream source that can substantiate the claim. That ledger does not exist yet. Until an exact claim has reviewed wording, a pinned source revision and evidence classification, keep it planned, simulated, blocked or omit it. Never convert a plan, fixture, mock, local run or architecture document into a live-result statement.

For each image, clip, slide or derivative, MM-05's planned provenance record must identify its source/revision, creator, date, evidence class, consent, rights, allowed destination, attribution, redaction, reviewer and review trigger. Keep restricted originals outside this public repository. Unknown permission or consent means do not use the asset. Upstream approval remains with the relevant source owner.

## Status and review rules

The inventory separates three questions:

- **Disposition** says whether the item is `existing`, `planned`, `missing`, `deferred` or `not_applicable`.
- **Path availability** says whether a path is tracked at the baseline, created in the current candidate, proposed but not created, or unnecessary.
- **Lifecycle** says whether an existing asset is `draft`, `reviewed`, `released` or `deprecated`.

An existing path may still be a draft. A planned path has no lifecycle state yet. Mark an asset reviewed only with the exact revision, reviewer role and review date. Mark it released only when claim evidence, rights/consent, redaction, accessibility and the intended destination have the required approvals. Repository visibility alone never changes lifecycle state. Planned issue links are traceability, not evidence that work is complete.

MM-01 is a draft candidate for [MM-01 #4](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/4). The current accountable marketing content/review owner is the user-assigned repository supervisor; a fresh Astra High review is pending for the frozen candidate. The issue's role mapping remains in the inventory. This does not assign or imply approval by brand, product, finance, organizer or rights owners.

## Migration and retention

1. Keep the three baseline documents and their history. When a path changes, update the inventory and add the old path, new path, date, reason, stable asset ID and superseding ID where applicable. Do not silently rename or delete an approved or referenced asset.
2. Keep one canonical editable source per stable asset ID. Record exports separately with destination, dimensions/format, checksum, claim/provenance references, accessible alternative and approval state. Do not use ambiguous filenames such as `final-final`.
3. When a source, claim, crop, brand revision, rights status, redaction or destination changes, mark the affected derivative draft until re-reviewed. Preserve prior approved references and checksums as deprecated history; never treat a superseded version as reusable.
4. Do not copy canonical brand assets, restricted customer/project material, private financial details, credentials or raw originals into this repository. Preserve access-controlled source references and publish only reviewed derivatives.
5. Keep simulated, mock, planned and measured material distinguishable in the artifact itself and its inventory record. A correction or deprecation must record its reason and replacement mapping.

## MM-01 validation

From the repository root at the candidate revision:

```sh
git ls-files
python3 -m json.tool docs/collateral-inventory.json >/dev/null
git diff --name-status 97c8aa25ac13d9032033f01ddfd6f536f0bb962b...HEAD
```

Reconcile each tracked collateral/document path to one inventory record; confirm that future paths remain planned, not existing; follow each issue/source link; and review all six family dispositions. The inventory's evidence date is 2026-10-11 UTC. This validation does not close MM-01 until an independent review and the issue's required candidate/review evidence are recorded.
