# Messaging review checklist

This is an executable review brief for MM-02. A checked item needs a source link, exact candidate revision, reviewer/date, and result; writing a rule here does not complete upstream evidence or marketing approval.

## Claim review

- [ ] Copy every externally visible factual, capability, measured, comparative, sponsor, forecast, financial, and CTA statement into messaging/claims.json with a stable ID.
- [ ] Match every sentence, label, visual fragment, HTML text/accessible attribute, and accessible alternative to an exact claim or CTA row and provenance record; reject missing IDs, copy drift, checksum drift, and unlisted tracked files. Do not rely on a broad “simulation” claim to cover unrelated text.
- [ ] Check source repository, path, immutable revision, evidence reference/classification, provider mode, limitations, and review trigger.
- [ ] Keep the exact positioning slogan attributed and qualified as positioning; do not convert it into autonomous-completion proof.
- [ ] Reject unsupported variants such as “fully automated,” “live integration,” and “verified savings.” A synthetic example is acceptable only with a visible concept/simulation label and no claim of live behavior.
- [ ] Keep EVAL-02 comparison, EVAL-03 classification, and EVAL-04 privacy evidence separate. Preserve EVAL-03 labels simulated/sandbox/live/estimated/pending; use mock/planned only as additional states.
- [ ] Review Neatlogs SPN-01, Entire SPN-02, and CFO.ai SPN-03 separately against their own source evidence. Do not transfer a run, result, or approval across sponsors.
- [ ] For cost, forecast, savings, or ROI wording, follow cost-intelligence definitions and actual owner-approved evidence; a hypothetical export or estimate is not verified savings.
- [ ] Treat a source revision, provider mode, data class, destination, limitation, or wording change as invalidating the affected review.

## CTA review

- [ ] Confirm exact wording and intended action.
- [ ] Record destination class, exact target, destination owner, and current availability.
- [ ] Keep repository-documentation action separate from an application or landing transaction.
- [ ] Reject unimplemented, unavailable, or unconfirmed targets and CTAs that imply an unsupported capability or purchase.
- [ ] If a landing/application CTA is proposed, obtain product/landing route-owner confirmation of both the exact target and availability before approval.

## X submission destination review (pending)

Rows: `CLAIM-X-DEST-TEAM-001`, `CLAIM-X-DEST-PROJECT-001`, `CLAIM-X-DEST-REPO-001`. All three are `planned`/`pending`, sourced to the entry-contents list in marketing-material issue 22 (created 2026-10-11T19:31:01Z), a mutable issue record rather than an immutable revision.

- [ ] Confirm each field matches the exact allowed wording in the ledger and that the project name keeps the qualifier “Project name only; product availability is unverified.”
- [ ] The getticketstub.com route owner confirms the repository locator and that it is used as a locator only, not a product route or transaction CTA. `CLAIM-PRODUCT-NAME-001` stays scoped to concept artwork and is not extended.
- [ ] Count the assembled quote-post against the 280-character limit using realistic maximum-length placeholders; the final composer check is a human step.
- [ ] Submitter name and authorization, demo URL, the official neatlogs post URL and the Discord-governed cutoff stay bracketed/pending. Agents do not post.

## Required exercises

- [ ] Reject “fully automated” capability wording.
- [ ] Reject “live integration” wording without live-mode evidence.
- [ ] Reject “verified savings” without an EVAL-02 comparable and finance-reviewed result.
- [ ] Accept a synthetic/concept example only when its label and limitations remain visible in the derivative and accessible alternative; verify the current exact files and status in `docs/collateral-inventory.json` and `review/provenance.json`.
- [ ] Reject a CTA with missing target or unavailable/unconfirmed route.
- [ ] Verify `--mode selected --select ASSET_ID` requires a nonempty, unique known selection and evaluates only its mapped copy, qualifier contexts, CTAs, and rights/lineage.
- [ ] Verify `--mode submission --select ASSET_ID` additionally requires the inventory's named final outputs, product/EVAL/SPN claims and evidence, and brand/organizer gates. Unused internal guardrail rows and the synthetic canary are not global approval prerequisites.

### Exercise execution record (MM-02-C)

Independently re-executed by the Opus 5.5 coordinator in round 2 (not by the author of this change) against verified baseline `b7ff115`: `/usr/bin/python3 -B -m unittest -v` on six tests in `tests.test_collateral_validation.CollateralPolicyValidationTests`, all passed in 0.308s with a clean worktree afterwards.

- `test_unsupported_automation_live_and_savings_copy_is_rejected` (three prohibited phrases)
- `test_labeled_synthetic_copy_is_accepted_and_mapped_exactly` (labeled simulation)
- `test_sponsor_evidence_classes_cannot_be_collapsed` (three sponsor classes)
- `test_unavailable_route_cannot_be_approved_as_a_cta`
- `test_selected_scope_rejects_empty_unknown_duplicate_and_unsafe_copy`
- `test_submission_requires_explicit_assets_and_producer_gates`

These tests also passed in the 109-test post-merge run at `b7ff115`. This record cites that result; it does not tick any box above, and owner-evidence and route-owner criteria (MM-02-A, MM-02-D) remain open.

## Current draft outcome

The ledger has no approved product capability, live integration, sponsor usage, financial result, or transaction CTA. Product and sponsor records are blocked/pending. Repository-documentation CTAs point only to the pinned public README and await exact wording review; the local text-equivalent CTA also awaits wording and route review. Submission readiness adds only the named final outputs and owner evidence, not every unused ledger row. This outcome can change only with pinned upstream evidence and the relevant owner review; user-assigned marketing accountability does not substitute for product, sponsor, finance, brand, organizer, or route-owner evidence.
