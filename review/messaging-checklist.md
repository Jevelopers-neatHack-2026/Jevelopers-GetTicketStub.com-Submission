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

## Required exercises

- [ ] Reject “fully automated” capability wording.
- [ ] Reject “live integration” wording without live-mode evidence.
- [ ] Reject “verified savings” without an EVAL-02 comparable and finance-reviewed result.
- [ ] Accept a synthetic/concept example only when its label and limitations remain visible in the derivative and accessible alternative; verify the current exact files and status in `docs/collateral-inventory.json` and `review/provenance.json`.
- [ ] Reject a CTA with missing target or unavailable/unconfirmed route.
- [ ] Verify `--mode selected --select ASSET_ID` requires a nonempty, unique known selection and evaluates only its mapped copy, qualifier contexts, CTAs, and rights/lineage.
- [ ] Verify `--mode submission --select ASSET_ID` additionally requires the inventory's named final outputs, product/EVAL/SPN claims and evidence, and brand/organizer gates. Unused internal guardrail rows and the synthetic canary are not global approval prerequisites.

## Current draft outcome

The ledger has no approved product capability, live integration, sponsor usage, financial result, or transaction CTA. Product and sponsor records are blocked/pending. Repository-documentation CTAs point only to the pinned public README and await exact wording review; the local text-equivalent CTA also awaits wording and route review. Submission readiness adds only the named final outputs and owner evidence, not every unused ledger row. This outcome can change only with pinned upstream evidence and the relevant owner review; user-assigned marketing accountability does not substitute for product, sponsor, finance, brand, organizer, or route-owner evidence.
