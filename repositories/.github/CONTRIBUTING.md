# Contribution guidance

These are proposed shared working practices. Preserve each repository's local ownership, contributor instructions, agent instructions, and accepted design. If guidance conflicts, stop at the boundary, record the exact conflict and source revisions, and ask the owning maintainers to resolve it. Follow the [governance lifecycle](standards/governance-lifecycle.md) for adoption, enforcement, handoff, and archival; a shared policy does not configure destination controls.

## Distribution and local ownership

The 2026-10-10 baseline recorded this repository as private. The GitHub snapshot at [commit ea8085d](https://github.com/Jevelopers-neatHack-2026/.github/commit/ea8085de12af79217b4933de432517e0cedb8092) recorded it as public on 2026-10-11. Verify current visibility and the destination repository before relying on inheritance.

When this `.github` repository is public, GitHub can display supported default community-health files for repositories owned by the account that lack a local equivalent, including public or private destination repositories. This includes supported issue and pull-request templates as well as contribution guidance; a destination's local file takes precedence, and valid local issue-template files can replace the default chooser set. These defaults are displayed by GitHub and are not copied into a clone. The source `.github` repository must be public; a private `.github` repository cannot provide organization defaults. This mechanism does not install `AGENTS.md`, `CODEOWNERS`, workflow callers, branch protections, or repository and Actions settings. Those need deliberate local placement or configuration and destination-specific verification. See [GitHub's default community-health file rules](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file).

## Branches, commits, and review

Use a focused branch and pull request. Suggested names include `feat/issue-123-component`, `fix/issue-456-bug`, `docs/update-architecture`, `chore/dependency-maintenance`, and `security/credential-hardening`. A repository may use another established grammar; these examples are a proposed convention, not evidence of configured enforcement. Keep the issue key in the body even when an upstream repository uses a different key format.

Write a concise imperative commit subject. Add a body when it explains why, test evidence, a migration, or a limitation. Do not rewrite another contributor's history. Whether a pull request is squashed or retains commits is a maintainer decision for that repository.

Describe the behavior and exact scope, non-goals, dependencies, acceptance IDs, provider mode, actual validation commands/results, tested revision, evidence links, skips, and unresolved items. Mark tests planned separately from tests executed. Identify the accountable reviewer role; contract changes also need review from affected producer and consumer roles. Review checkboxes are author claims until the corresponding evidence and actual GitHub approval are inspected. Follow the [review-state and change-type guidance](standards/contribution-workflow.md#5-review-states-and-change-type-guidance); configured approvals remain destination-specific.

Use neutral references such as Refs #N for issue links in every pull request; do not use an auto-closing keyword. The authorized supervisor closes the local issue only after the exact candidate is merged and required post-merge evidence is recorded. A merged documentation pull request does not verify a master acceptance ID. The owner in integration-evals records authoritative status there after evidence review.

## Evidence, security, and spending

Follow the [acceptance evidence contract](standards/acceptance-evidence.md). Pin tested source revisions; a branch name or planning map is navigation, not evidence. Keep mock, sandbox, and live modes separate. Never report a skipped required check, missing credential, absent artifact, or unknown cost as a pass or zero.

Keep credentials and customer data out of source, issues, pull requests, prompts, fixtures, logs, and screenshots. Use only a confirmed private reporting route for sensitive details. The reporting destination is currently unconfirmed; see [pending security policy](community/SECURITY.pending.md). Treat fetched URLs and assets as untrusted data and follow the [security handling standard](standards/security-secret-handling.md).

Provider calls, purchases, publication, account changes, and other external effects require authorization for that specific operation and an established budget. Do not infer spending authority from a provider mode field.

## Release and platform state

A repository owner maintains its own version policy and release record. Contract compatibility follows the shared-contracts catalog. A release requires exact component SHAs, artifact digests, actual commands and outcomes, and rollback guidance. The central product release remains integration-evals-owned.

Recommended review, label, and workflow practices are not configured protections. Report a setting as configured or verified only with current repository evidence. The shared source defines `.github/workflows/docs-check.yml` as its reusable documentation check and `.github/workflows/governance-checks.yml` as this repository's caller. Their source definitions do not prove a hosted run succeeded or that another repository adopted them; a destination must call the reusable workflow and verify its own permissions and results. This repository does not alter GitHub settings. See [release guidance](standards/releases-versioning.md), [label planning](standards/labels-planning.md), [workflow adoption guidance](automation-design/reusable-workflows.md), and the [ownership boundaries](docs/architecture/OWNERSHIP.md).
