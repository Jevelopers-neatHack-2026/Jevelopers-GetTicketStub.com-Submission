# Templates

Contributor templates for the fourteen Jevelopers neatHack 2026 repositories. Each one is a
documented convention; none configures reviews, branch protection or required checks.

| Interface | Contract version | Source | Issue |
| --- | --- | --- | --- |
| Pull request description | `GH-PR-TEMPLATE@1.0.0` | [`.github/pull_request_template.md`](../.github/pull_request_template.md) | [GH-03-P](https://github.com/Jevelopers-neatHack-2026/.github/issues/14) |
| Issue forms (five active; security draft outside the chooser) | `GH-ISSUE-FORMS@1.0.0` | [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/) · [guidance](issue-forms.md) | [GH-03-I](https://github.com/Jevelopers-neatHack-2026/.github/issues/13) |

The rest of this page covers the pull request template. Issue-form fields, labels and the pending
security route are documented in [issue forms](issue-forms.md); the evidence, release, backlog-audit
and adoption records in this directory are linked from the [repository README](../README.md#docs).

## How the pull request template reaches a repository

- This `.github` repository is **public**, so GitHub uses its `.github/pull_request_template.md`
  as the organization default only when a destination repository has no pull request template of its
  own ([GitHub docs on default community health files](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
  and [pull request templates](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository)).
- A repository with a local template (in the root, `docs/` or `.github/`) overrides the default.
  Copy from the pinned producer revision below if a local copy needs extra sections; preserve the
  required fields or record the deliberate variation.
- The default pre-fills new pull requests opened in the browser. It does not rewrite existing pull
  requests, and `gh pr create --body ...` skips it. Inherited files do not appear in a clone, so
  contributors and coding agents must read this source or a recorded local copy.
- A private `.github` repository cannot supply GitHub organization defaults; the source `.github`
  repository must be public. Destination repositories may be public or private, but a destination
  file takes precedence. Check source visibility and local overrides before claiming inheritance.

### Version and adoption record

`GH-PR-TEMPLATE@1.0.0` identifies the section and field contract. It is separate from the
supervisor execution pack version (1.1.0), a product release, and any repository rollout status.
The source on a pull request branch is a candidate. A review, branch head or version string alone
does not publish the default. Once a revision is merged to the default branch, record that immutable
full commit SHA as the published producer revision; do not invent a package, release or tag.

For each adopting repository, record the contract version, full source commit SHA, immutable file
permalink (for example
`https://github.com/Jevelopers-neatHack-2026/.github/blob/<40-character-commit-sha>/.github/pull_request_template.md`),
adoption mode (inherited default, local copy, or not applicable), destination path, date, reviewer
role, differences from the source, and the verification evidence. A moving `main` URL can help
locate the current source but is not an adoption receipt. Track rollout separately for every
repository; publication here does not establish adoption elsewhere. Record each adoption in the
rollout record tracked by [GH-10](https://github.com/Jevelopers-neatHack-2026/.github/issues/15).

The producer handoff for this interface records source issue GH-03-P, contract version, immutable
producer revision, the available template and example files, exact validation commands/results,
known limitations, affected adopters, and any owner review acknowledgement. A consumer's template
review or adoption receipt is separate from verification that its own pull-request flow works.

Version the template interface independently of rollout: increment the major number for an
incompatible required-section or field change, the minor number for an additive compatible field
or section, and the patch number for wording clarifications that do not change required content.
This convention versions the template contract; it does not imply that an adopter has upgraded.

## Filling in the template

- **Linked issues.** `Closes` is GitHub's merge-triggered auto-close syntax. Use it only where the
  destination repository explicitly permits auto-close and all issue criteria can be verified at
  merge with no post-merge check remaining. For this program template, use neutral `Refs` in every
  PR body because required merged-revision checks happen after merge. The repository supervisor
  checks each criterion on the merged revision and records the required evidence, then manually
  closes a fully satisfied issue. Partial issues stay open with unmet criteria and follow-up links;
  parent issues, release gates and related work remain referenced.
- **Acceptance criteria → evidence.** Copy each applicable criterion from its authoritative issue.
  Tick it only when the linked evidence exists and supports that criterion. Leave unmet, skipped or
  blocked criteria unticked and explain their status. A merged PR does not by itself verify a master
  acceptance ID in [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).
- **Verification.** Separate commands that actually ran from checks that are planned or blocked.
  Record the full tested commit SHA, command/procedure, result and sanitized evidence link. A mock
  result does not satisfy a live-required outcome.
- **Provider mode, authority and cost.** List `mock`, `sandbox`, `live` or `N/A — reason` for
  each component when modes differ. For paid or live provider use, identify the approver, approval
  reference, permitted use/mode, and stated budget amount, currency and period. Report cost as actual
  with its source/date, estimated amount/range and basis, or unknown with the reason and follow-up
  owner. Use
  `N/A — no paid/live calls` only when none occurred. Missing billing data is unknown, never zero.
  These fields describe author-reported activity; reviewers check them against evidence.
  For example, a **fictional** sandbox request could record: mode `sandbox`; authority `approved by
  [role] under [approval reference] for [scope], up to [amount/currency/period]`; cost `unknown —
  sandbox billing not reconciled; [owner] will confirm by [date]`. This illustrates field shape only;
  it is not a test result or program evidence. For documentation with no provider call, use `N/A`
  for authority and cost.
- **Ownership & design.** Name the owning repository and role for every affected interface and link
  the design, ADR or catalog entry it follows. Write `N/A — reason` when none applies. A role is
  not a named assignee or CODEOWNERS rule.
- **Cross-repo impact.** State compatibility/migration steps and versions proposed, published or
  consumed. Record producer/consumer acknowledgement as a review response with its owner and link.
  Acknowledgement that a contract was reviewed is distinct from a consumer pin, implementation or
  integration test; keep later integration pending until it is actually verified.
- **Reviewer expectations.** Name the roles needed to review the change. Reviewers check each
  author claim and linked issue status against the evidence; a checked box alone proves nothing.
- **Security & provenance.** Never include secrets, credentials, customer data, signed URLs or
  exploit details. The checkboxes are author claims, not proof that a scanner, review rule or
  provider authorization ran.

## Examples

These three examples preserve the documentation-only, bug-fix and cross-repo contract scenarios
from the original template. They are **fictional walkthroughs**, not program evidence. Issue
numbers, revisions, commands and repository names are illustrative placeholders. No command result,
owner response, merge, provider call or acceptance outcome is claimed as having occurred. Unchecked
criteria and explicit planned/blocked states show what remains open in each scenario.

### 1. Documentation-only change

```markdown
## Summary
Illustrative change: add branch and commit naming guidance to CONTRIBUTING.md for contributors and agents.

## Linked issues
Refs owner/repo#<issue-number>
- **Issue key:** DOCS-<sample-key> (example only)

## Scope / Non-goals
- **In scope:** branch and commit naming guidance with examples.
- **Non-goals:** configuring branch protection, rulesets or review enforcement.

## Changes
- CONTRIBUTING.md: add a "Branches and commits" section.

## Ownership & design
- **Affected ownership / interfaces:** .github contribution guidance; Finance and reliability role.
- **Design / ADR / catalog links:** N/A — documentation-only change with no product interface.

## Acceptance criteria → evidence
- [ ] Branch and commit examples cover feature, bug, docs and cross-repo work — planned documentation review; no evidence supplied in this fictional example.
- [ ] A contributor can follow one example end to end — planned walkthrough; not reviewed in this scenario.
- **Acceptance IDs:** N/A — this illustrative governance change does not verify a master acceptance criterion.

## Verification
- **Tested revision:** N/A — no revision was tested in this fictional scenario.
- **Executed:** None — no command or review is claimed as run.
- **Planned / not run:** Check local Markdown links and walk one example after the change is committed.
- **Limitations / skips:** Review and validation are pending; do not close the issue.
- **Evidence links:** N/A — no execution evidence exists in this example.
- **Provider mode:** N/A — documentation-only; no provider calls.
- **Paid/live provider authorization and budget:** N/A — no paid/live provider calls.
- **Paid/live provider cost:** N/A — no paid/live provider calls.

## Dependencies / blockers
- **Blocked by:** None known in this illustrative scenario.
- **Blocks:** owner/repo#<follow-up-issue> (placeholder only).

## Cross-repo impact
None.
- **Compatibility / migration:** None.
- **Release / version impact:** None.
- **Producer / consumer acknowledgement:** N/A — no cross-repo interface.

## Security & provenance
- [ ] No secrets, tokens, credentials, signed URLs or customer data in the diff, fixtures, logs or screenshots — not reviewed in this scenario.
- [ ] New dependencies and assets are pinned and their license/provenance is recorded (or N/A) — not reviewed.
- [ ] Paid/live provider use was either absent or covered by the authorization and budget recorded above — no use is asserted; claim not independently checked.

## Risk & rollback
Low, if reviewed: documentation could be unclear. Revert the documentation commit if it misleads contributors.

## Reviewer expectations
- **Reviewer role(s) requested:** .github maintainer; review links and walkthrough before the issue is closed.
```

### 2. Bug fix

```markdown
## Summary
Illustrative change: repair workspace scripts that fail when a repository-root package manifest is missing.

## Linked issues
Refs owner/repo#<bug-issue>
- **Issue key:** BUG-<key>

## Scope / Non-goals
- **In scope:** fix root package discovery and add a regression case.
- **Non-goals:** dependency upgrades or unrelated build cleanup.

## Changes
- Repository root: restore the expected package manifest.
- `test/root-workspace.test.ts`: add a regression case (planned in this scenario; not yet added).

## Ownership & design
- **Affected ownership / interfaces:** owning repository maintainer; workspace build interface.
- **Design / ADR / catalog links:** N/A — no contract or design change is proposed.

## Acceptance criteria → evidence
- [ ] Clean install and build succeed — planned; no successful run is claimed.
- [ ] Regression test covers root package discovery — planned; test not yet added or run.
- **Acceptance IDs:** N/A — local build defect; no master acceptance ID is claimed.

## Verification
- **Tested revision:** N/A — the fix is not committed or tested in this fictional scenario.
- **Executed:** None — no command result is claimed.
- **Planned / not run:** `npm ci`, `npm run build` and `npm test` on the committed revision and a clean checkout.
- **Limitations / skips:** CI runner is unavailable in this illustrative scenario; validation is blocked. Keep the issue open.
- **Evidence links:** N/A — no run or artifact is available.
- **Provider mode:** N/A — no provider calls in the planned build checks.
- **Paid/live provider authorization and budget:** N/A — no paid/live provider calls.
- **Paid/live provider cost:** N/A — no paid/live provider calls.

## Dependencies / blockers
- **Blocked by:** CI runner availability for the required clean-checkout build (illustrative blocker).
- **Blocks:** None.

## Cross-repo impact
None.
- **Compatibility / migration:** None.
- **Release / version impact:** None.
- **Producer / consumer acknowledgement:** N/A — no cross-repo interface.

## Security & provenance
- [ ] No secrets, tokens, credentials, signed URLs or customer data in the diff, fixtures, logs or screenshots — not reviewed in this scenario.
- [ ] New dependencies and assets are pinned and their license/provenance is recorded (or N/A) — no new dependency is planned; not reviewed.
- [ ] Paid/live provider use was either absent or covered by the authorization and budget recorded above — no use is asserted; claim not independently checked.

## Risk & rollback
Medium: package discovery can affect commands across the workspace. Revert the fix if the reviewed build fails.

## Reviewer expectations
- **Reviewer role(s) requested:** owning-repository maintainer and CI owner; verify the clean-checkout results before closing the issue.
```

### 3. Cross-repo contract change

```markdown
## Summary
Illustrative proposal: add an optional `edition` field to the order contract so a consumer can select a stub style.

## Linked issues
Refs Jevelopers-neatHack-2026/shared-contracts#<producer-issue> · Refs Jevelopers-neatHack-2026/print-production#<consumer-issue>
- **Issue key:** CON-ORDER-EDITION

## Scope / Non-goals
- **In scope:** propose an additive `edition` field and preserve compatibility with existing order fixtures.
- **Non-goals:** implementing the field in consumers or claiming an integrated product result.

## Changes
- `order` contract: propose version 1.1.0 with an optional `edition` field.
- Old/new fixture compatibility checks are planned; this scenario includes no implementation evidence.

## Ownership & design
- **Affected ownership / interfaces:** shared-contracts producer owner; print-production and fulfillment-connectors consumer owners.
- **Design / ADR / catalog links:** maintained order-contract catalog entry (link to be added at the immutable producer revision).

## Acceptance criteria → evidence
- [ ] Existing and new fixtures validate against the proposed schema — planned; no command result is supplied.
- [ ] Required consumer-owner design review is acknowledged — pending; no owner response is claimed.
- **Acceptance IDs:** CON-01 — relevant master criterion is not verified by this illustrative proposal.

## Verification
- **Tested revision:** N/A — no producer revision has been committed or tested in this scenario.
- **Executed:** None — no fixture or integration test is claimed as run.
- **Planned / not run:** Validate old/new fixtures on the committed producer revision; later, test the consumer against the immutable published version after pinning it.
- **Limitations / skips:** Consumer design-review acknowledgement is pending and is a producer acceptance limitation. Consumer implementation/integration is a separate downstream gate, blocked until a producer version is merged and pinned. Keep both issues open.
- **Evidence links:** N/A — no review response, test output or published artifact exists in this example.
- **Provider mode:** N/A — schema and fixture work only; no provider calls.
- **Paid/live provider authorization and budget:** N/A — no paid/live provider calls.
- **Paid/live provider cost:** N/A — no paid/live provider calls.

## Dependencies / blockers
- **Blocked by:** required consumer-owner design review of the proposed contract; acknowledgement is pending (illustrative request link).
- **Blocks:** consumer integration after producer version 1.1.0 is merged, published at an immutable revision and pinned. This is separate from the design-review response above.

## Cross-repo impact
Proposed `order` contract version 1.1.0, additive and optional. Producer: shared-contracts. Consumers: print-production and fulfillment-connectors.
- **Compatibility / migration:** existing orders remain valid; a consumer may use `edition` only after pinning the compatible version.
- **Release / version impact:** proposed only; no tag or package is published in this scenario.
- **Producer / consumer acknowledgement:** producer-owner review: not recorded; consumer-owner design-review acknowledgement: pending. Neither would prove consumer pinning or integration. Record each response with its owner and immutable link when it occurs.

## Security & provenance
- [ ] No secrets, tokens, credentials, signed URLs or customer data in the diff, fixtures, logs or screenshots — not reviewed in this scenario.
- [ ] New dependencies and assets are pinned and their license/provenance is recorded (or N/A) — no new dependency is proposed; not reviewed.
- [ ] Paid/live provider use was either absent or covered by the authorization and budget recorded above — no use is asserted; claim not independently checked.

## Risk & rollback
Low if additive compatibility is demonstrated. Before publication, drop the proposal if compatibility fails. After a version is published, do not delete it; revert consumers to a compatible pin.

## Reviewer expectations
- **Reviewer role(s) requested:** shared-contracts maintainer and affected consumer owners; check the required design-review response before producer acceptance and track later consumer integration as a separate gate.
```
