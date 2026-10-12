<!--
Jevelopers neatHack 2026 program pull request template (GH-03-P).
Template interface: GH-PR-TEMPLATE@1.0.0. This names the section/field contract; it does not
assert that this source revision is merged, that any repository adopted it, or that review
enforcement is configured.
Replace every <placeholder>. Write "None" or "N/A — <reason>" instead of deleting a section.
Checkboxes are author claims for the reviewer to check. They do not prove that reviews,
branch protection, required checks or provider calls are configured or happened.
Never paste secrets, tokens, signed URLs, customer data or exploit details here.
-->

[How to fill in this template](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/templates/README.md#filling-in-the-template)

## Summary
[2–4 sentences: what changed and why]

## Linked issues
<!-- Use neutral references for every issue. Do not put GitHub issue-closing keywords in this PR body.
     The supervisor closes an issue only after checking every criterion on the merged revision and
     recording required post-merge evidence. See templates/README.md. -->
Refs owner/repo#N · Refs owner/repo#M
- **Issue key:** e.g. `GH-03-P`, or N/A with a reason

## Scope / Non-goals
- **In scope:** describe what this PR does
- **Non-goals:** describe what it deliberately does not do

## Changes
- list changes by file or area

## Ownership & design
- **Affected ownership / interfaces:** owning repositories and roles, interfaces touched, or None
- **Design / ADR / catalog links:** links, or N/A with a reason

## Acceptance criteria → evidence
<!-- One line per criterion from the linked issue. Tick only criteria with evidence attached.
     Leave unmet criteria unticked and say why. Include master acceptance IDs (e.g. CON-01) or "N/A — <reason>". -->
- [ ] Copy each criterion from the issue — add its test, command output or screenshot path
- **Acceptance IDs:** IDs from integration-evals/planning/acceptance-checklist.md, or N/A with a reason

## Verification
<!-- Separate what was actually run from what is only planned. Include the tested commit SHA. -->
- **Tested revision:** full commit SHA
- **Executed:** exact commands and their results; include a CI run link where available
- **Planned / not run:** checks not executed and why, or None
- **Limitations / skips:** skipped tests, blocked providers, known gaps, or None
- **Evidence links:** sanitized URLs only; no tokens, signed URLs or customer data
- **Provider mode:** mock, sandbox, live, or N/A with a reason; list each component separately when mixed
- **Paid/live provider authorization and budget:** none occurred, or approver, approval reference, permitted use/mode, and budget amount/currency and period
- **Paid/live provider cost:** actual amount/currency with source/date; estimate amount/range with basis; unknown with reason/owner; or N/A when no paid/live calls occurred

## Dependencies / blockers
- **Blocked by:** owner/repo#N, or None
- **Blocks:** owner/repo#N, or None

## Cross-repo impact
<!-- Contracts/versions consumed or published, affected producers/consumers and their acknowledgement; "None" if none. -->
None, or describe the affected contracts, versions, producers, consumers and acknowledgements
- **Compatibility / migration:** breaking changes and migration steps, or None
- **Release / version impact:** versions or tags published or consumed, or None
- **Producer / consumer acknowledgement:** for contract changes, who acknowledged and where; otherwise N/A

## Security & provenance
- [ ] No secrets, tokens, credentials, signed URLs or customer data in the diff, fixtures, logs or screenshots.
- [ ] New dependencies and assets are pinned and their license/provenance is recorded (or N/A).
- [ ] Paid/live provider use was either absent or covered by the authorization and budget recorded above.

## Risk & rollback
Describe the risk, what could break and how to revert.

## Reviewer expectations
<!-- Reviewers check each ticked box against its evidence, verify linked issue status against the merged
     revision and post-merge checks, and confirm affected interface owners have acknowledged. A consumer's
     design review is separate from later consumer integration. Only the supervisor closes issues after
     required merged-revision evidence exists. Name the reviewer role needed. -->
- **Reviewer role(s) requested:** e.g. owning-repo maintainer; contract consumer owner
