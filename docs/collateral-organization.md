# Collateral organization and navigation

This guide accompanies the [machine-readable collateral inventory](collateral-inventory.json). The inventory is the record for asset IDs, family dispositions, path availability, lifecycle, issue ownership, source and provenance references. This guide explains where work belongs and how to preserve its evidence and history.

## Current baseline

At starting revision `97c8aa25ac13d9032033f01ddfd6f536f0bb962b`, `git ls-files` listed only `README.md`, `docs/architecture/OWNERSHIP.md`, and `docs/architecture/ACCEPTANCE.md`. No media, collateral module directories, scripts, export tooling, CI, or `AGENTS.md` were present. The two MM-01 files were subsequently merged in PR #12 at `05ed6ca6db94b6384fa9ef7ee965271be071264b`, and issue #4 closed with evidence. This policy candidate adds messaging and review files; no media asset is claimed as present by this worktree.

GitHub repository metadata was checked on **2026-10-11 UTC** using the public REST endpoint `https://api.github.com/repos/Jevelopers-neatHack-2026/marketing-material`; it returned `private=false`, `visibility=public`, and default branch `main`. [OWNERSHIP.md](architecture/OWNERSHIP.md) records this correction. Visibility describes the repository setting only. Every asset still needs its own rights, consent, redaction, claim and destination review before release.

The user assigned the marketing-material supervisor as accountable marketing content/review owner. The MM-01 general-worker task produced the inventory and navigation; the frozen candidate was reviewed and its evidence was recorded with PR #12. That review does not substitute for producer-owned product, brand, financial, sponsor, privacy or rights approvals.

## Path map

| Path | Availability | Purpose and owner boundary |
| --- | --- | --- |
| `README.md` | Existing baseline; updated in this candidate | Entry point and links to maintained navigation and acceptance references. |
| `docs/architecture/OWNERSHIP.md` | Existing baseline; visibility description corrected in this candidate | Repository responsibility and canonical-source boundaries. |
| `docs/architecture/ACCEPTANCE.md` | Existing baseline | Local acceptance navigation; the integration-evals checklist remains authoritative. |
| `docs/collateral-inventory.json` | Created for MM-01 and merged at PR #12 | Stable IDs, family dispositions, candidate/planned paths, owners, issues, claims and provenance references. |
| `docs/collateral-organization.md` | Created for MM-01 and merged at PR #12; updated in this candidate | This navigation, boundary, lifecycle and retention guide. |
| `messaging/` | Created in the current policy candidate | Positioning guidance and exact-copy claim ledger. All product, sponsor, financial, and transaction claims remain pending/blocked. |
| `demo/` | Proposed; not created | Storyboard, narration, recording checklist, submission narrative and evidence-linked support files. |
| `launch/` | Proposed; not created | Social and announcement copy, product descriptions, accessible descriptions and approved export references. It supplies copy handoffs to `landing-page-repo`; it is not the primary landing-page runtime. |
| `examples/` | Proposed; not created | Approved demo outputs with source, rights, attribution and destination records. |
| `review/` | Created in the current policy candidate | Messaging review, asset provenance, publication safety, and a synthetic text/JSON canary. Other brand, accessibility, visual, and release records remain proposed. |

The five module names come from the accepted ownership plan. The messaging and review modules now contain policy files; demo, launch and examples remain proposed locations and their future files/assets are not claimed to exist. Do not add empty folders to make the plan look implemented. Current and proposed paths, including future issue IDs, are listed in the inventory.

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

MM-02's draft `messaging/claims.json` maps exact wording to source repositories, paths, immutable revisions or explicit unpinned draft references, evidence classes, provider modes, limitations, review state and re-review triggers. The source order is brand-kit for identity and vocabulary; landing-page-repo for primary page messaging and route composition; getticketstub.com for product behavior; integration-evals and sponsor owners for comparisons and sponsor evidence; and cost-intelligence for financial definitions and actuals. The pinned upstream revisions in this candidate were checked by GitHub API path lookup on 2026-10-11. Product and integration-evals revisions are documentation/evidence-index only and establish no shipped capability or completed result.

The exact brand line “No forms: drop your ticket and it's done.” is retained only as qualified positioning. It is not proof of autonomous completion or zero-input fulfillment. EVAL-03 keeps the canonical labels simulated, sandbox, live, estimated, and pending; mock/planned are additional copy states. EVAL-02 and the three distinct sponsor classes remain pending: Neatlogs SPN-01 requires its own run evidence, Entire SPN-02 requires checkpoint/graph evidence, and CFO.ai SPN-03 requires the actual business plan and finance review. No one sponsor record can satisfy another.

Only a repository-documentation CTA points to a pinned public README, and its wording review remains pending. Product/landing conversion routes have no confirmed target or availability. A repository-docs route does not authorize or establish a product transaction.

MM-05's draft `review/provenance.json` defines source/revision or content digest, creator/tool/model, date, evidence class, consent, permission/attribution, allowed destinations/modifications, expiry, redaction, lineage/checksum, reviewer/date, and publishability fields. Its only current record is an invented text/JSON test fixture for internal policy tests. It is not a visual asset and has no external-use permission. Keep restricted originals outside this public repository. Unknown, expired, or revoked permission means reject or replace with clearly synthetic content. Upstream approval remains with the relevant source owner.

`review/fixtures/synthetic-canaries.json` covers dummy marker text across visible-text, metadata, notes, alt text, transcript, QR, linked-resource, and extracted-export-text fields. `tools/validate_collateral.py` checks text/JSON structure and semantic copy rules only. It does not render media, inspect or redact real pixels, or inspect metadata/notes in a flattened export. MM-05 pixel/format review and destination-specific source-owner rights acceptance remain explicit release blockers.

## Status and review rules

The inventory separates three questions:

- **Disposition** says whether the item is `existing`, `planned`, `missing`, `deferred` or `not_applicable`.
- **Path availability** says whether a path is tracked at the baseline, created in the current candidate, proposed but not created, or unnecessary.
- **Lifecycle** says whether an existing asset is `draft`, `reviewed`, `released` or `deprecated`.

An existing path may still be a draft. A planned path has no lifecycle state yet. Mark an asset reviewed only with the exact revision, reviewer role and review date. Mark it released only when claim evidence, rights/consent, redaction, accessibility and the intended destination have the required approvals. Repository visibility alone never changes lifecycle state. Planned issue links are traceability, not evidence that work is complete.

MM-01 was merged in PR #12 at `05ed6ca6db94b6384fa9ef7ee965271be071264b`; issue [MM-01 #4](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/4) is closed with evidence. The current accountable marketing content/review owner is the user-assigned repository supervisor. MM-02 and MM-05 policy artifacts in this candidate remain drafts pending independent review and upstream evidence. This does not assign or imply approval by brand, product, finance, organizer, sponsor, privacy, or rights owners.

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

The baseline snapshot, path reconciliation, six family decisions and visibility evidence were reviewed and recorded with MM-01 PR #12; issue #4 is closed. The original baseline revision remains preserved above. Later policy changes must retain these snapshot IDs and update only current artifact records.

## MM-02 and MM-05 policy validation

From the repository root, run:

    python3 -m json.tool messaging/claims.json >/dev/null
    python3 -m json.tool review/provenance.json >/dev/null
    python3 -m json.tool review/fixtures/synthetic-canaries.json >/dev/null
    python3 tools/validate_collateral.py --mode draft
    python3 -m unittest discover -s tests -p 'test_collateral_validation.py'
    python3 tools/validate_collateral.py --mode release

The draft mode and tests check exact claim/CTA shape, prohibited positive capability/integration/savings wording, canonical labels, separate sponsor evidence classes, destination status, permission-state rejection, and exact canary-to-copy mappings. Release mode is expected to report BLOCKED until claim/source approvals, sponsor and comparable evidence, exact route confirmation, destination rights, and actual format-specific visual/media reviews exist. Do not treat the text-only canary as pixels, and do not publish a draft merely because draft validation passes.
