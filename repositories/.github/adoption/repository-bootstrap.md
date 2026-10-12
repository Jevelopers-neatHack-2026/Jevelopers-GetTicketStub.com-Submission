# Repository governance bootstrap

Use this checklist for one new or existing repository. It plans deliberate adoption; it does not certify a repository, copy every document, or change GitHub settings.

## 1. Establish local ownership and sources

Before copying:

- Confirm the destination owner role, repository visibility, default branch, intended contributors, and whether the repo will consume shared defaults or local copies. Record the exact observed destination SHA and date; if unavailable, say unknown.
- Read the destination README, OWNERSHIP.md, ACCEPTANCE.md, CONTRIBUTING.md, AGENTS.md files, SECURITY.md, tests/build manifest, and local architecture decisions. Preserve useful local instructions.
- Resolve canonical architecture, contract, and acceptance sources through standards/architecture-linking.md. Identify which local views may be adapted without becoming duplicate sources.
- Identify a maintainer who can review local adoption. Do not infer an assignee, license, CODEOWNERS rule, or settings owner from an organization role.

If sources conflict, leave the destination file untouched until its owner resolves the conflict. Record both source revisions, the disputed requirement, affected roles, and a concrete decision request.

## 2. Minimum content checklist

Record each item as applicable, copied, linked, configured, verified, blocked, deferred, or unknown. Content status and GitHub settings status are separate.

- Accurate README with repository purpose, current status, installation/development steps, and limitations.
- Local OWNERSHIP.md and local acceptance view with canonical IDs/links and explicit local scope.
- CONTRIBUTING guidance linked or adapted, preserving local conventions and security instructions.
- SECURITY.md only after a real private report route, responsible role, access expectations, and escalation owner are confirmed for that destination.
- Applicable local AGENTS.md at repository root and any necessary subdirectory; preserve more-specific instructions and record installation/review.
- The five generally safe issue forms and chooser config, plus a pull-request template, or an explicit owner-approved applicability decision. The sixth security form remains blocked until the reporting route is confirmed.
- Label taxonomy guidance and per-repository label inventory. Do not reference an absent label from a form.
- Release/version and evidence records with repository-specific authority left to the destination owner.
- Workflow recommendations, starter/caller status, exact source revision, and local run evidence. A workflow example is not a deployed caller.
- Source-of-truth links, cross-repository gates, producer/consumer roles, and blocker conditions.

## 3. Place files deliberately

For a public repository, GitHub may display supported community-health defaults from a public organization .github repository when no local equivalent exists. It does not copy them into a clone. A local file overrides the default. This does not distribute agent instructions, CODEOWNERS, licenses, workflow callers, or settings.

For a destination that needs a durable local copy:

1. Record the shared source revision and destination revision.
2. Copy or adapt only the approved files into the correct local paths. Merge with existing guidance instead of overwriting it.
3. Keep destination-specific owners, labels, links, terms, licenses, and contact routes local.
4. Review rendered Markdown and issue forms, local paths, labels, default-branch placement, and security routing.
5. Commit the local change through the destination's normal review process. Record the resulting PR and merge revision only after they exist.
6. Recheck inherited defaults and local overrides on that destination's default branch.

A private .github repository is not a source for public organization's community-health defaults. A public .github repository still does not place files in a clone. GitHub's organization workflow-template source is a separate mechanism under .github/workflow-templates and requires reader access to its source. Reusable workflow execution additionally requires an installed workflow file, explicit caller, correct host/caller visibility, allowed access settings, and an actual run. An issue or pull-request template in this package has no repository-level effect until it is on the applicable default branch or copied to a destination.

Agent instructions must be local where the agent reads them. CODEOWNERS and license decisions must be made in each repository where they apply. Workflow callers and permission settings are local. Do not change repository visibility to obtain inheritance.

## 4. Optional configuration checklist

This is a separate record from content readiness. Do not change settings as part of this bootstrap unless the user separately authorized that exact change.

| Setting | Requested | Configured | Verified | Evidence/owner |
|---|---|---|---|---|
| Branch protection or ruleset | yes/no/unknown | yes/no/unknown | yes/no/unknown | |
| Required review count and eligible identities | yes/no/unknown | yes/no/unknown | yes/no/unknown | |
| Required status checks | exact names / none / unknown | yes/no/unknown | passing run/revision | |
| Force push and deletion restrictions | yes/no/unknown | yes/no/unknown | yes/no/unknown | |
| Actions permissions, allowed actions, reusable workflow access | exact policy / unknown | yes/no/unknown | current setting/run | |
| Secret/environment access and deployment approval | exact policy / unknown | yes/no/unknown | current setting/run | |
| Security reporting feature availability and destination | exact policy / unknown | yes/no/unknown | harmless route test | |
| Repository visibility and community-health behavior | intended / unknown | observed state | default-branch check | |

No API/UI permission error proves that a setting is absent. Record inaccessible configuration as unknown. Required checks must correspond to real workflows; do not invent a check name. A model review does not satisfy a human or team approval rule.

Named owners, licenses, CODEOWNERS, and security contacts require an explicit team basis. If missing, create a blocker through the authorized repository owner; this task does not create foreign issues.

## 5. Adoption evidence

Use templates/adoption-record.md. Record:

- source repository and full source SHA;
- destination URL, visibility, default branch, full destination SHA, PR/merge revision, and observation date;
- reviewer role and actual review date;
- each checklist item's applicability and actual state;
- verification command or UI/API observation and evidence link/hash;
- local deviations with owner role, rationale, review/expiry date;
- unknown settings, missing owners, security route, labels, and next action.

Do not say all fourteen repositories comply from one sample. An adoption record establishes only what was inspected on that destination revision.
