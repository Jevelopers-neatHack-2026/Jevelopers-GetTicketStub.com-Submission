# Current status and boundaries

This page holds the dated status detail and installation boundaries that the [repository README](../README.md) summarizes. The documentation defines expectations; it does not by itself change repository settings, prove that a product requirement passed, or establish adoption by another repository.

For the gate-by-gate assessment (twelve leaf issues, nine `GH-GATE` checks, settings observations and required next evidence), see the [dated partial governance release assessment](../adoption/governance-release-record.md). It is a historical record written before the scope change below and was not rewritten. Recheck live repository state before relying on any dated snapshot.

## Current status

Reconciled 2026-10-12 against immutable source revision [ebac9e4](https://github.com/Jevelopers-neatHack-2026/.github/commit/ebac9e4f3ad4e6784de6ce16cd857a94b18ae5bf), the merge of [PR #24](https://github.com/Jevelopers-neatHack-2026/.github/pull/24). The sections below that cite revision 4129e71 are dated historical evidence.

- **Completed leaves (9):** [#4](https://github.com/Jevelopers-neatHack-2026/.github/issues/4), #6, #7, #8, #9, #10, #12, #14 and #15 are closed completed.
- **Not planned (2):** at the user's direction [#11](https://github.com/Jevelopers-neatHack-2026/.github/issues/11) (`GH-07`) and [#13](https://github.com/Jevelopers-neatHack-2026/.github/issues/13) (`GH-03-I`) were closed **not planned**, with possible later addition ([#11 decision](https://github.com/Jevelopers-neatHack-2026/.github/issues/11#issuecomment-6113528654), [#13 decision](https://github.com/Jevelopers-neatHack-2026/.github/issues/13#issuecomment-6113529011)). This is deferred scope, not a passed check. The original twelve-leaf security baseline is not complete: no private reporting route is confirmed, no sixth (security) form is active, and sensitive details must not go through a public issue.
- **#5 open:** [#5](https://github.com/Jevelopers-neatHack-2026/.github/issues/5) (`GH-08`) has its guidance merged by PR #24 at `ebac9e4`. The refreshed integration-evals consumer [review](https://github.com/Jevelopers-neatHack-2026/.github/issues/5#issuecomment-6117637650) reports all four earlier gaps resolved, with a nonblocking nit that the standard says "four" complete schema demonstrations where five exist. That review is agent evidence; accountable human acceptance of the GH08 guidance is pending and is not claimed.
- **Gate and epic open:** [#16](https://github.com/Jevelopers-neatHack-2026/.github/issues/16) and [#3](https://github.com/Jevelopers-neatHack-2026/.github/issues/3) remain open. The scope addenda ([#16](https://github.com/Jevelopers-neatHack-2026/.github/issues/16#issuecomment-6116512227), [#3](https://github.com/Jevelopers-neatHack-2026/.github/issues/3#issuecomment-6116512413)) record the reduced plan. The [final reduced-scope audit](https://github.com/Jevelopers-neatHack-2026/.github/issues/16#issuecomment-6117682189) at `ebac9e4` is "ready pending maintainer acceptance", not a gate pass. The final public decision and the #5, #16 and #3 closures await actual sign-off.
- **Limits preserved:** no master acceptance, product release, consumer-wide adoption or security-baseline claim. Native GitHub UI behavior beyond the dated client check, hosted Actions and platform isolation, repository settings and other repositories' adoption remain unverified. No human approval is fabricated here.

## Published sources (historical, 4129e71 snapshot)

At inspected public default-branch revision [4129e71](https://github.com/Jevelopers-neatHack-2026/.github/commit/4129e71f42a51d42803b1020e146f54108cf2f93), observed 2026-10-11 02:48:39 UTC, [PR #19](https://github.com/Jevelopers-neatHack-2026/.github/pull/19) published the pull-request template and adoption guide, and [PR #20](https://github.com/Jevelopers-neatHack-2026/.github/pull/20) published five active issue forms plus a security draft outside the chooser. The PR template contract is `GH-PR-TEMPLATE@1.0.0`; the issue-form contract is `GH-ISSUE-FORMS@1.0.0`. Both interface versions are separate from execution-policy pack 1.1.0, product releases, and destination adoption status.

## Open governance work (historical, 4129e71 snapshot)

> **Historical, superseded where it differs:** this section records the 2026-10-11 4129e71 snapshot and is kept as dated evidence. Since then `GH-01` (#4) and `GH-04` (#9) were closed, and `GH-07` (#11) and `GH-03-I` (#13) were closed not planned; see [Current status](#current-status) above for the present state.

At that snapshot the remaining governance guidance work is still under review. `GH-01` still needs its second-maintainer validation. `GH-07` remains blocked until a maintainer confirms a private security-reporting destination and responsible role. A dated native GitHub client check after the PR20 merge verified the five active chooser entries, editable prompts, empty-text client-side required-field rejection under a per-tab network deny guard, and 46 per-field Markdown previews. It created no issue and did not test server validation or an assembled posted body. The check recorded a small 8 px mobile document overflow as an advisory, not a responsive pass; it was not a full assistive-technology audit. The security form remains outside the chooser, and no sensitive details should be sent through an ordinary public issue while the private route is unresolved. `GH-03-I` remains open.

- `GH-01` remains open until the required second-maintainer review is recorded.
- `GH-07` security reporting remains blocked until a maintainer confirms the private destination and responsible role; no contact or response time is supplied here.
- `GH-03-I` remains open: post-merge native checks verified empty-text client rejection for the five active forms, but did not test server validation, an assembled issue body, or an unselected required dropdown. The private route and sixth active form remain blocked, and destination-specific adoption is unverified.
- Per-repository settings and adoption, plus any GitHub-hosted workflow execution or secret-isolation evidence, require separate destination-specific observations.

## Workflows

The central workflow documentation and local fixture can be reviewed independently of a GitHub-hosted workflow run. This repository has no root `.github/workflows` installation; downstream workflow execution, private-workflow access, fork isolation, and secret behavior remain unverified unless separately supported by actual destination evidence. See [reusable workflow guidance](../automation-design/reusable-workflows.md) and the [local fixture](../automation-design/fixtures/reusable-workflow/README.md).

## Architecture and evidence ownership

The master acceptance IDs and their status are owned by integration-evals. A merged documentation change, local fixture result, or mock check does not verify a master acceptance ID or complete a product release.

The [local ownership view](architecture/OWNERSHIP.md) defines this repository's documentation responsibility. The [local acceptance view](architecture/ACCEPTANCE.md) selects criteria but is not the master tracker.

Canonical architecture and the implementation plan live in getticketstub.com. Canonical schemas live in shared-contracts. Master acceptance state and evidence records live in integration-evals. Each repository owns its local implementation instructions, checks, settings, and adoption record. See the [source registry](../standards/architecture-linking.md) for immutable inspected references and link rules.

## Template and installation boundaries

The pull-request template is a published source on this repository's public default branch. GitHub may use organization default community-health files when a destination repository has no local equivalent. Local files take precedence; inherited defaults do not appear in clones. See [template guidance](../templates/README.md) for source visibility, local overrides, the versioned template contract, and per-repository adoption records.

Agent instructions, CODEOWNERS, licenses, workflow callers, labels, and repository settings require deliberate local decisions. Public issue forms and pull-request templates may appear as organization defaults when a destination has no local equivalent, but a local template directory overrides them. Consult current, destination-specific evidence before claiming a setting, label, workflow, or template is active. Do not report organization-wide adoption from one repository's result.

Use the [bootstrap record](../templates/adoption-record.md) to capture source revision, destination revision, applicability, verification evidence, deviations, and blockers. Public `.github` defaults are not copied into clones, and a private `.github` repository is not a supported source for public organization community-health defaults.
