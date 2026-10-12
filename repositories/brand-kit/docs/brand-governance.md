# Brand governance

**Status: governance scaffolding only.** This document defines how brand changes are proposed, reviewed and decided. It records no approval of any identity, token, font, asset or release. [BK-07 #8](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/8) closure is **blocked** (see [Closure blockers](#closure-blockers)).

Controls described here are **manual**. This repository has no branch protection, CODEOWNERS or reviewer enforcement that this document relies on or claims. The only automation is [`tools/check_governance.py`](../tools/check_governance.py), which checks the shape of these documents, not anyone's approval.

## Responsibility table (BK-07.1)

| Role | Holder | Status | Evidence |
|---|---|---|---|
| Accountable brand approver (Product/frontend) | **@CompleteDotTech** | Confirmed nomination | [Issue #8 comment, 2026-10-11T20:41:31Z](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/8#issuecomment-6113526793) |
| Brand implementation/release owner team | CompleteDotTech, LaJefa, Lars | Recorded by the user. CompleteDotTech is a confirmed GitHub username. LaJefa and Lars have **no verified GitHub handles**, and **no per-person responsibility split** (including BK-03A/B) is assigned | [Issue #8 comment, 2026-10-12T02:42:03Z](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/8#issuecomment-6116787775) |
| Technical token/export reviewer | **Unknown** | Not appointed | Receipt 2026-10-11 says technical reviewer appointments under BK-07.1 "remain outstanding" |
| Provenance/rights reviewer | **Unknown** | Not appointed | same |
| Affected consumer reviewers (getticketstub.com, landing-page-repo, team-dashboard, marketing-material) | **Unknown** | Not appointed. No consumer repository has acknowledged a review role | same |
| Release reviewer/publisher | **Unknown** | Not appointed | Not covered by any receipt |

Notes:

- The nomination does **not** approve unseen identity, token or font artifacts, distribution outputs or a release. BK-02 [#9](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/9) needs a real dated decision against an exact source SHA; BK-03B [#14](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/14) needs a reviewed immutable artifact/version; BK-08 [#12](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/12) and BK-09 [#15](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/15) retain accessibility and consumer review obligations.
- Until the technical, provenance and consumer reviewer rows name a person with a linked acknowledgement, a decision that needs them cannot reach **approved**. Repo participants may record execution claims through the existing ownership process ([OWNERSHIP](architecture/OWNERSHIP.md)).
- One person may hold several roles only if the decision record says so. The approver must not be the sole reviewer of a decision they authored unless the record states that explicitly and the other required roles are still filled.
- Acknowledgements must be added here as links to a real, dated comment or commit by the person. Do not write one on someone's behalf.

## Standing constraints

- **No self-hosted fonts.** Per the [2026-10-12 comment](https://github.com/Jevelopers-neatHack-2026/brand-kit/issues/8#issuecomment-6116787775), brand fonts are not self-hosted. Immutable pinned first-party asset delivery stays separate from externally hosted font delivery. Any font proposal must name the external provider, families, axes, network/CSP/privacy/fallback behaviour, provenance and availability evidence. This is a user constraint, not an approval of any runtime artifact. The font files and OFL licences already in `fonts/` are existing source material, and this document does not decide their future.
- **Existing work is authoritative until replaced.** `SPEC.md`, logos, fonts and token sources stay in force ([OWNERSHIP](architecture/OWNERSHIP.md#existing-compatible-decisions)). Record the rationale before replacing anything.
- **Rejected directions stay on record.** SPEC.md keeps A. Paper Desk, B. Night Stage and the rejected C. Box Office (retained only as the Classic stub edition). Do not delete that rationale. Supersede it with a decision record.
- **No licence is chosen here**, and no paid provider is called.

## Decision lifecycle (BK-07.2)

States: `proposal` → `review` → `approved` | `rejected`; an `approved` decision may later become `superseded` (or be revoked, see below).

| State | Meaning | Allowed to ship in a release? |
|---|---|---|
| proposal | Written using the [template](governance/decision-template.md); nobody has reviewed it | No |
| review | Required reviewers assigned and acknowledged; evidence being checked | No |
| approved | Every required role named in the record signed off with dated evidence, within the stated scope | Yes, only inside the stated scope and only while the source hashes still match |
| rejected | A reviewer with authority declined it; reason recorded | No |
| superseded | A later approved decision replaces it; it names its successor | No (the successor governs) |

Every decision record must carry: exact files, revision (commit SHA) and SHA-256 hash of each file; the decision date; reviewer names with linked, dated evidence; scope of approval (what is and is not covered); rights/licence references; affected consumers; rationale; and disposition.

Rules:

0. **Controlling decision.** Eligibility is judged per exact path and SHA-256. Of all decisions listing that path at that hash, the controlling one is the latest by decision date (record order breaks ties). Only its status counts. A rejected or superseded record does not block a hash if a later `approved` decision lists the same hash (a resubmission, or a successor that carries the file unchanged, or a reinstatement). A hash with no decision, or whose controlling decision is not `approved` or has been revoked, is ineligible. Older records are never edited or deleted.
1. Pending assets cannot be labelled approved. "Approved" appears only in a record whose reviewer evidence links to a real dated action by the named person.
2. A decision covers only the listed files at the listed hashes. Any other file or hash is unapproved.
3. Decisions are append-only. Correct a mistake with a new record that supersedes the old one.
4. Simulated records live only in [`governance/simulated-walkthrough.md`](governance/simulated-walkthrough.md), carry the marker `FICTIONAL SIMULATION`, and are never release eligible.
5. Real decisions are stored in `docs/governance/decisions/` (not yet created; none exist). The baseline decisions are BK-02's job.

## Change classes (BK-07.3)

| Class | Examples | Minimum review | Re-review trigger |
|---|---|---|---|
| Core identity | Logo marks, master palette, typefaces/font delivery, voice principles, imagery rules | Accountable approver **and** provenance reviewer; technical reviewer if tokens/exports are touched; **all affected consumer reviewers** | Any later edit to the files in scope |
| Breaking token/asset/path change | Rename or remove a token, change a value consumers rely on, move or delete an exported asset or path | Approver, technical reviewer, affected consumer reviewers; migration record | Any change to the migration or deprecation window |
| Compatible token addition | New token, new asset that changes nothing existing | Approver and technical reviewer; provenance reviewer if the asset is new; consumers notified, review optional unless they opt in | A value, name or hash change after approval |
| Documentation-only | Typos, clarifications that change no rule, link fixes | Any one reviewer other than the author; approver informed | A change that alters a rule is reclassified |

When in doubt, use the stricter class. A change that touches consumers needs the producer (this repository's approver) **and** each affected consumer reviewer. Missing reviewer = the decision cannot become `approved`.

## Deprecation, replacement, rollback and revocation (BK-07.4)

**Deprecation.** Open a decision record that marks the target `deprecated` and names the replacement, the last supported version and the migration steps. Notify every affected consumer (below) before removal.

**Replacement.** The replacement goes through its own proposal/review. The old decision becomes `superseded` only once the replacement is `approved`, and the old record then links to the new one.

**Rollback.** If an approved version causes a problem, the approver (or, if absent, the release owner team) records a rollback entry naming: the affected version, the fallback version and its hashes, who acts, and what each consumer must change. The producer never edits consumer repositories. Consumers apply the rollback themselves. A fallback is **not** eligible just because it was approved once. Its hashes regain eligibility only through a fresh decision that `Reinstates` the earlier one (or a new approved decision at those hashes), carrying rights evidence that is current and unexpired and the review the change class requires, all dated after the rollback was proposed. Earlier records stay unedited. With no such fresh decision, the fallback is ineligible (fail closed).

**Revocation.** An approval is revoked when any of these happens: a source file's hash no longer matches the record, a permission or licence expires or is withdrawn, or a reviewer withdraws their approval in writing. Revocation:

1. invalidates release readiness for every release that includes the affected files;
2. is recorded in a revocation entry (date, cause, affected versions, previously approved fallback);
3. is communicated to affected consumers through the version/migration record owned here.

**Consumer notification.** A notification names the affected version, what changed, the fallback version, the action required and a date. Sending it is manual (issue comment or linked document). Delivery is not verified automatically, so record where you sent it. Consumers known today: getticketstub.com, landing-page-repo, team-dashboard, marketing-material ([OWNERSHIP](architecture/OWNERSHIP.md)). The consumer owners are unassigned (see table above).

## Release eligibility check

A release candidate is eligible only if every item holds. Otherwise it is rejected:

- every shipped file's exact path and hash has a controlling decision (see lifecycle rule 0) whose status is `approved` and not revoked, within its scope;
- that controlling decision is real, not simulated/fictional; historical rejected or superseded records for the same hash do not matter once a later approved decision controls it;
- a rollback or fallback version counts only through its own fresh controlling decision;
- every role required by the change class is named with linked dated evidence;
- rights references are present and unexpired;
- affected consumers have been notified.

Currently **no decision is approved**, so **no release is eligible**.

## Closure blockers

- [ ] Technical token/export reviewer named, with linked acknowledgement.
- [ ] Provenance/rights reviewer named, with linked acknowledgement.
- [ ] Affected consumer reviewers named, with linked acknowledgements.
- [ ] Release reviewer/publisher named.
- [ ] LaJefa and Lars GitHub handles verified and responsibilities assigned (or an explicit decision not to).
- [ ] Reviewed by the accountable approver (@CompleteDotTech), with a link to that review.
- [ ] BK-01 (#6) dependency satisfied, including the `make check-links` target, which this change does not provide.

Until these are done, **BK-07 stays open**. The pull request only references the issue (`Refs #8`).

## Related

[Decision template](governance/decision-template.md) · [Simulated walkthrough](governance/simulated-walkthrough.md) · [Ownership](architecture/OWNERSHIP.md) · [Acceptance view](architecture/ACCEPTANCE.md) · [SPEC](../SPEC.md)
