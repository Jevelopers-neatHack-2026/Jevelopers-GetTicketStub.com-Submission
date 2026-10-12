# Collateral organization and navigation

This guide accompanies the [machine-readable collateral inventory](collateral-inventory.json). The inventory is the record for asset IDs, family dispositions, path availability, lifecycle, issue ownership, source and provenance references. This guide explains where work belongs and how to preserve its evidence and history.

## Current baseline

At starting revision `97c8aa25ac13d9032033f01ddfd6f536f0bb962b`, `git ls-files` listed only `README.md`, `docs/architecture/OWNERSHIP.md`, and `docs/architecture/ACCEPTANCE.md`. No media, collateral module directories, scripts, export tooling, CI, or `AGENTS.md` were present. The two MM-01 files were subsequently merged in PR #12 at `05ed6ca6db94b6384fa9ef7ee965271be071264b`, and issue #4 closed with evidence. The integrated candidate now also tracks the exact visual sources, exports, static HTML rehearsal page, accessible alternatives, previews, synthetic redaction fixtures, and their review receipts. These are draft concepts and test evidence, not a product screenshot, release asset, or publication approval.

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
| `demo/` | Draft visual candidates and a static HTML rehearsal are tracked | Workflow diagram, fictional mockup, text alternatives, preview receipts and a conceptual page exist. Product explanation, storyboard, narration, recording checklist and submission narrative now exist as drafts. A separate 150-second silent synthetic rehearsal, transcript, SRT/VTT and generated HTML are internal rehearsal outputs; the required authentic product video remains absent at `demo/exports/v1-demo.mp4` and is not replaced by the rehearsal. |
| `launch/` | Draft synthetic X artwork and text alternative are tracked | The key visual and its accessible description exist as draft candidates. Submission copy/CTA and approved exports remain planned; this module supplies handoffs to `landing-page-repo` and is not the primary landing-page runtime. |
| `examples/` | Controlled synthetic redaction fixtures are tracked | The before/after SVG and PNG, canary manifest and text alternative are test fixtures only, not approved demo outputs or customer examples. |
| `review/` | Policy, provenance, visual and accessibility records are tracked | Includes exact-copy and rights policy, visual/browser/contrast/accessibility receipts, and synthetic canaries. Independent content/accessibility review, brand/source-owner rights, organizer confirmation and release records remain pending or planned. |

The five module names come from the accepted ownership plan. Draft visual, narrative, rehearsal, caption, package-copy and test files now exist under demo, launch, release and examples; this does not complete the final product demo or approve any file for external reuse. The 150-second rehearsal is separate from `demo/exports/v1-demo.mp4`. Do not add empty folders to make the plan look implemented. Current and proposed paths, including future issue IDs, are listed in the inventory.

## Six collateral family decisions

| Family | MM-01 disposition | V1 use or defer reason | Issue and planned IDs |
| --- | --- | --- | --- |
| Hackathon demo assets | Required deliverables planned; draft visual support exists | A conceptual workflow, fictional mockup, HTML rehearsal and text alternatives are tracked as unapproved candidates. Product explanation, storyboard, narration, recording checklist and submission narrative now exist as drafts. A separate 150-second silent synthetic rehearsal, transcript, SRT/VTT and generated HTML are internal rehearsal outputs; the required authentic product video remains absent at `demo/exports/v1-demo.mp4` and is not replaced by the rehearsal. The official event format requires a video no longer than three minutes covering each partner's architecture, implementation, runtime, reasoning and result, plus a public repository and supporting evidence. Recheck current rules before final media. | [MM-03 #9](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/9): `DEMO-EXPLAINER-001`, `DEMO-STORYBOARD-001`, `DEMO-NARRATION-001`, `DEMO-RECORDING-CHECKLIST-001`, `DEMO-SUBMISSION-NARRATIVE-001`, `DEMO-SUBMISSION-VIDEO-001`; draft support `DEMO-WORKFLOW-DIAGRAM-001`, `DEMO-DECK-SUPPORT-001`. |
| Social posts and cards | Draft template copy and draft synthetic visual exist | The official submission requires an X quote-post of the neatlogs post with team, name, project, public repository and demo link. A draft key visual and text alternative exist, but copy, exact CTA, rights and destination approval remain pending. Nothing is posted by this task. | [MM-04 #10](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/10): `LAUNCH-X-COPY-001`, `LAUNCH-X-KEY-VISUAL-001`, `LAUNCH-X-ALT-TEXT-001`, `LAUNCH-X-CTA-001`. |
| Product explainers and system diagrams | Explanation planned; conditional draft diagram exists | A truthful product explanation is required. A separate diagram remains conditional on a storyboard-confirmed use and evidence; the tracked diagram is conceptual and does not show product behavior. | [MM-03 #9](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/9): `DEMO-EXPLAINER-001`; conditional draft `DEMO-WORKFLOW-DIAGRAM-001`. |
| Pitch and demo deck support | Draft HTML rehearsal exists; final deck deferred | No current official deck requirement or story-confirmed use is recorded. The HTML page is a conceptual rehearsal candidate. Activate a final deck only if the storyboard or refreshed organizer rules require it. | [MM-03 #9](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/9): `DEMO-DECK-SUPPORT-001` (draft; final deck deferred). |
| Screenshots and mockups | Fictional draft mockup exists; release deferred | No approved product image exists. The tracked SVG/PNG is explicitly a synthetic conceptual mockup, not a screenshot of the running product; rights and independent review remain pending. | [MM-03 #9](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/9) and [MM-05 #6](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/6): `DEMO-SCREENSHOT-SET-001` (synthetic draft). |
| Launch and update announcements | Draft X key visual, alt text, template copy and docs CTA record exist; final post and approval remain pending | One X submission/demo-sharing set is required. The image and alt text are draft; copy, route, rights and destination approval remain pending. Recaps, feature callouts and other update artwork need a confirmed use, owner and evidence, so remain deferred. | [MM-04 #10](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/10): the four `LAUNCH-X-*` IDs above; `LAUNCH-UPDATE-RECAP-001` (deferred). |

The [official event page](https://neatlogs.com/hackathon) was checked on 2026-10-11 UTC. It requires a public X quote-post of the official post with team, name, project, public repository and demo link; a demo video of three minutes or less that covers neatlogs, Entire and cfo.ai (architecture, implementation, runtime, reasoning and result for each); and supporting repository evidence. The published submission window is October 12, 7:00–11:55 PM IST as a planned close, with the confirmed final cutoff announced on Discord. Recheck the official post and cutoff before producing final variants. A draft is not an external submission or publication authorization.

## Canonical sources and evidence boundaries

| Subject | Canonical owner/source | Marketing-material use |
| --- | --- | --- |
| Visual identity, tokens, logo and voice | `brand-kit` | Consume the pinned, approved revision. Do not recreate or redefine the brand system or copy unapproved assets. |
| Product behavior and application state | [`getticketstub.com` at `eb8decce` README](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/eb8decceeffd29c3c1f1ebf4f6a653ef3a98e073/README.md), after runtime PR #20 merged; earlier `7f59d339` pin ([PR #22](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/22)) is historical | A Next.js App Router preview runtime exists and defaults to demo fixtures with simulated art; the source includes demo-mode sign-in with sandbox mail, local SQLite/file storage and sandbox order routes, `/api/agent` answers 204 outside live mode, and arbitrary event links are demo-only. This pin documents the runtime mode and is source availability, not producer acceptance; it does not prove a deployed/accepted customer journey, live provider or sponsor activity, or a product release. Require the sanitized versioned GT-19 capability manifest and GT-12 #6 acceptance before whole-product claims. |
| Sanitized measures, integration and sponsor evidence | `integration-evals` and the relevant sponsor/source owners | Link exact evidence and preserve its labels, mode and limitations. Marketing does not create or verify EVAL/SPN evidence. |
| Financial definitions and actuals | `cost-intelligence` | Use its reporting definitions and source-owner evidence; no forecast, savings or spending claim from a hypothetical export. |
| Landing-page composition and runtime | `landing-page-repo` | Receive approved copy and destination references from `launch/`; do not implement or claim the runtime here. |
| Organizer requirements | Official organizer source | Record source URL and access date for each format decision; refresh before final export or submission. |
| Words, examples and presentation handoff | `marketing-material` | Maintain claims, story, copy and approved collateral references with provenance and use-specific review. |

MM-02's draft `messaging/claims.json` maps exact wording to source repositories, paths, immutable revisions or explicit unpinned draft references, evidence classes, provider modes, limitations, review state and re-review triggers. The source order is brand-kit for identity and vocabulary; landing-page-repo for primary page messaging and route composition; getticketstub.com for product behavior; integration-evals and sponsor owners for comparisons and sponsor evidence; and cost-intelligence for financial definitions and actuals. The pinned upstream revisions in this candidate were checked by GitHub API path lookup on 2026-10-11. The historical product `5a298645` ownership pin describes architecture but predates the runtime integration; current product status is pinned to README commit `eb8decceeffd29c3c1f1ebf4f6a653ef3a98e073`, after runtime PR #20 merged, which documents a demo-mode preview runtime with sandbox mail and sandbox orders; the earlier `7f59d33922a0585205547d490b288b49eed32419` pin (PR #22) is historical. That runtime does not establish a deployed or accepted product journey, and producer GT-10B/GT-12 acceptance remains pending. Integration-evals remains a planned evidence index and establishes no completed comparison or sponsor result.

The exact brand line “No forms: drop your ticket and it's done.” is retained only as qualified positioning. It is not proof of autonomous completion or zero-input fulfillment. EVAL-03 keeps the canonical labels simulated, sandbox, live, estimated, and pending; mock/planned are additional copy states. EVAL-02 and the three distinct sponsor classes remain pending: Neatlogs SPN-01 requires its own run evidence, Entire SPN-02 requires checkpoint/graph evidence, and CFO.ai SPN-03 requires the actual business plan and finance review. No one sponsor record can satisfy another.

Repository-documentation CTAs point to a pinned public README; their exact wording review remains pending. A tracked local text alternative is available for the workflow visual, but its wording and local route review remain pending. Product/landing conversion routes have no confirmed target or availability. A repository-docs route does not authorize or establish a product transaction.

MM-05's draft `review/provenance.json` defines source/revision or content digest, creator/tool/model, date, evidence class, consent, permission/attribution, allowed destinations/modifications, expiry, redaction, lineage/checksum, reviewer/date, and publishability fields. The original invented text/JSON policy canary remains recorded separately from its controlled synthetic SVG/PNG before/after derivatives. Each exact source, export, accessible alternative, preview, evidence file and renderer/test reference has its own path and checksum record. The “before” fixture intentionally retains dummy markers and is excluded from reuse. Keep restricted originals outside this public repository. Unknown, expired, or revoked permission means reject or replace with clearly synthetic content. Upstream approval remains with the relevant source owner.

`review/fixtures/synthetic-canaries.json` covers dummy marker text across visible-text, metadata, notes, alt text, transcript, QR, linked-resource, and extracted-export-text fields. A distinct rendered fixture proves removal from a known synthetic SVG group, its flattened PNG pixels, metadata, comments and accessible description. Current source/export pixels, metadata, HTML rendering, contrast and accessible alternatives were author-checked and pinned in `review/visual/`; the validator verifies those path/hash/copy joins, not arbitrary media. The integrated register records source-to-derivative edges for SVG, PNG and alternative files, including the controlled redaction chain. Independent review, brand/source-owner rights and destination approvals remain release blockers. Video/audio and office exports are absent and marked not applicable; re-review is required if created.

## Status and review rules

The inventory separates three questions:

- **Disposition** says whether the item is `existing`, `planned`, `missing`, `deferred` or `not_applicable`.
- **Path availability** says whether a path is tracked at the baseline, created in the current candidate, proposed but not created, or unnecessary.
- **Lifecycle** says whether an existing asset is `draft`, `reviewed`, `released` or `deprecated`.

An existing path may still be a draft. A planned path has no lifecycle state yet. Mark an asset reviewed only with the exact revision, reviewer role and review date. Mark it released only when claim evidence, rights/consent, redaction, accessibility and the intended destination have the required approvals. Repository visibility alone never changes lifecycle state. Planned issue links are traceability, not evidence that work is complete.

MM-01 was merged in PR #12 at `05ed6ca6db94b6384fa9ef7ee965271be071264b`; issue [MM-01 #4](https://github.com/Jevelopers-neatHack-2026/marketing-material/issues/4) is closed with evidence. The current accountable marketing content/review owner is the user-assigned repository supervisor. MM-02 and MM-05 policy artifacts, visual collateral, and accessibility evidence in this candidate remain drafts pending independent review and upstream evidence. This does not assign or imply approval by brand, product, finance, organizer, sponsor, privacy, or rights owners.

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
    python3 tools/validate_collateral.py --mode selected --select DEMO-SCREENSHOT-SET-001
    python3 tools/validate_collateral.py --mode submission --select LAUNCH-X-KEY-VISUAL-001
    python3 tools/validate_collateral.py --mode release

Draft mode and tests check exact claim/CTA shape, unsafe wording, canonical labels, separate sponsor evidence classes, source/provenance/checksum pins, complete tracked-path inventory, exact handoff/HTML/alternative copy mappings, and reciprocal acyclic provenance. Selected mode evaluates only the requested nonempty known asset IDs and their claim, qualifier, CTA and rights joins. Submission mode adds only the explicitly required deliverables, product/EVAL/SPN evidence, brand and organizer gates. `release` remains a fail-closed alias for submission over the default visual set; unused guardrail claims, CTAs and internal canaries are not global submission approvals. The current package remains blocked pending approved claims, exact routes, independent/source-owner review, rights and final outputs. Do not treat the synthetic fixture as generic media proof or publish a draft because validation passes.
