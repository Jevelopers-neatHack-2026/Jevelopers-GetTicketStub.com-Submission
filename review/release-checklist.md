# Collateral and submission release checklist

Use this checklist against the exact manifest and bytes that would be handed off. A model review or package checksum is not source-owner, rights, brand, product, or submitter approval. Mark each line only from recorded evidence; unresolved items stay blocked.

## Collateral package decision

- [ ] Select only intended, unique asset IDs and variants; reject empty or unknown selections.
- [ ] Confirm every source, editable source, export, caption, transcript, and alt-text file exists, is tracked, and has the manifest SHA-256 plus its declared exact source commit or content-digest pin. Verify inventory/provenance support files using the manifest's documented canonical JSON semantic-field projection; all other support files require exact byte hashes and source pins.
- [ ] Confirm source/export relationships and render receipts bind the actual output bytes, dimensions, format, and renderer/tool versions. For the silent synthetic rehearsal, verify the exact HTML/scene/render-plan/caption lineage, SRT/VTT/transcript alternatives and 17 cue/20 boundary-frame author checks; do not describe boundary inspection as continuous playback or final approval.
- [ ] Confirm each selected asset has a current MM-01 inventory row for its exact path and lifecycle; resolve missing or stale joins in the owner ledger.
- [ ] Confirm exact selected claim wording and required qualifiers join to current ledger rows and pinned evidence. Proposed wording remains a blocker until joined.
- [ ] Confirm selected CTAs use exact, existing destinations with route and wording review, actual reviewer identity/date, and no implied transaction capability.
- [ ] Confirm asset-specific provenance, consent/rights, allowed modifications, current expiry, reviewer, and permission for the exact internal destination. Unknown, expired, revoked, and out-of-scope rights fail.
- [ ] Confirm accessible alternatives and all timed captions match the actual media text/timing. Review contrast, crop, readability, and metadata.
- [ ] Confirm the brand owner has named the approved subset and destination-specific review is complete for each exact asset.
- [ ] Confirm no asset is missing, modified, pending, draft-only, superseded, revoked, expired, or merely planned; package copies are byte-identical and collision-free.
- [ ] Reproduce from the committed inputs without a paid call; record renderer and environment versions and preserve previous package bytes.
- [ ] Record the assigned accountable receiver, role, review date, and exact scoped decision. For this internal handoff, the user-assigned root supervisor is an AI session; record it accurately and do not imply human, rights, brand, product, or submission approval. The separate Astra model receiver dry-run remains pending and does not replace owner approval.

Until every applicable line passes, `collateralPackageReadiness.decision` remains `BLOCKED`. Current source and inventory/provenance joins do not themselves establish readiness: asset-specific rights, selected non-CTA copy review, brand/source-owner approval, accessibility and the independent model receiver dry-run remain pending. Five repository-documentation/text-alternative CTAs have only the scope-limited wording and repository-target review recorded in claims.json; that does not approve their content/accessibility or the draft rehearsal for release.

## External submission decision

- [ ] Use a real, recorded product demo at `demo/exports/v1-demo.mp4`; a mockup, static deck, narration, scene plan, or synthetic silent rehearsal cannot substitute.
- [ ] Show authentic architecture, implementation, runtime, reasoning, and result evidence for **each** of neatlogs, Entire, and cfo.ai. Preserve their separate evidence classes; do not conflate a planned/mock/sandbox result with live evidence.
- [ ] Include the actual public source repository, required supporting evidence, and an accessible video/caption/transcript handoff.
- [ ] Recheck the organizer's current instructions, live official post URL, confirmed Discord cutoff, and final submitter/team/project/repository/demo fields.
- [ ] Fill the organizer's X quote-post flow with team, name, project, public repo, and demo; retain the official post attachment. Recount the completed ordinary post (280 characters per the checked X help page) and inspect any image crop in the current composer.
- [ ] Confirm current rights, consent, selected wording, provenance, brand, accessibility, and human approvals apply to the exact submission bytes and public destinations.
- [ ] Record explicit submitter authorization and the exact final decision. The package builder does not publish, upload, or submit.

### Input status to carry into the next review

Record these as status only. None of them ticks a line above, and the earlier source approvals, pins and history stay in place. Producer receipts are linked in `review/releases/v0.1.0-rehearsal.md`.

- [ ] Known team, project and repository locator are pending ledger rows (`CLAIM-X-DEST-*`) from a mutable issue record. Locator confirmation by its route owner, the submitter name, demo URL and official post URL are still missing.
- [ ] CFO.ai: the authentic plan is available (integration-evals revision 2) and owner acceptance is preserved. Finance finding `CFO-R2-001` is unresolved, with no waiver, and the cost-intelligence export is pending. Do not copy financial figures into this checklist.
- [ ] Entire: static public source is available. That is source availability, not runtime results, and SPN-02 stays `PENDING`.
- [ ] Agent capture is cancelled, and this checklist authorizes none. A human records and a human submits; any future upload needs its own separate, explicit authorization.
- [ ] The Discord cutoff is not verified in the recorded sources; refresh it from the live official source.
- [ ] Required candidate validation: rebind provenance, inventory and package checksums for the edited files, regenerate the manifest, and run the full test suite on that exact candidate. Each step stays pending until exact candidate receipts establish completion. Nothing here claims a test pass, a PR, or a release approval.

Until every applicable line passes, `externalSubmissionReadiness.decision` remains `BLOCKED`. At the checked organizer source, the official post URL was not supplied and the final cutoff remained pending a Discord announcement; update those fields from the live official source before submission. The actual product demo, team/name/project/public URL values, and authentic per-sponsor results remain unavailable in this rehearsal package.
