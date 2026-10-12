# Governance and repository lifecycle

This is shared guidance for proposing, adopting, maintaining, handing off, and retiring repository governance. It does not configure GitHub, assign a maintainer, or make a recommendation mandatory for a destination repository. Destination maintainers adapt it to their local ownership and accepted design.

## Governance source, adoption, and enforcement

Keep these states separate. A later state needs its own evidence; publishing a policy does not advance a destination repository to adoption or enforcement.

| State | What it means | Evidence to record |
|---|---|---|
| Proposed | Guidance, a template, control, or setting is under consideration. | Proposal text, decision question, and the role that must decide. |
| Published | A reviewed change is merged into the shared `.github` source. | Full source commit and any explicit content/interface version. Publication makes the source available; it does not install or enforce it elsewhere. |
| Available for inheritance or reuse | A GitHub-supported community-health file may be displayed when the source is public and the destination has no applicable local equivalent; or a reusable workflow can be called by a consumer that meets its access and permission requirements. | Source path and revision; destination visibility, local override/caller, access, and relevant GitHub behavior checked for that consumer. |
| Adopted | Destination maintainers deliberately use, copy, link, or call the shared source and record local changes. | Destination path or caller, destination revision/PR, source revision, owner role, review, deviations, and verification result. |
| Enforced | A specific destination setting, required check, or review rule is configured and verified to apply. | Exact setting/rule, repository, date, and current configuration evidence. A document, template, workflow definition, or approval comment alone is insufficient. |
| Superseded or retired | An owner has replaced or withdrawn a source, local adoption, or control. | Replacement or reason, effective revision/date, affected consumers, handoff/notification, and retained historical references. |

Shared community-health inheritance, explicit workflow reuse, local configuration, and organization settings are different mechanisms. GitHub displays supported default community-health content under its documented rules; it does not copy the content into a destination clone. Destination-local files may take precedence, and a local issue-template directory may replace the inherited chooser. Inheritance does not install `AGENTS.md`, `CODEOWNERS`, workflow callers, branch protections, secrets, or Actions permissions. See the [official default community-health rules](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file) and [contribution guidance](../CONTRIBUTING.md).

Reusable workflow source can be called only when the workflow interface, caller, access, and permissions are compatible. The caller's checks and settings belong to the destination repository. A source workflow passing its own checks does not prove the consumer adopted it or that hosted Actions succeeded for that consumer. See [reusable-workflow adoption guidance](../automation-design/reusable-workflows.md) and verify current platform configuration before a claim.

## Roles and decision authority

Name a role in a record before implementation, but do not convert a role into a person, GitHub team, `CODEOWNERS` entry, approval, or setting. These boundaries come from the current ownership and acceptance references; a destination identifies the actual authorized maintainer locally.

| Decision | Responsible authority | Review or evidence handoff |
|---|---|---|
| Shared `.github` standards, templates, and workflow source | Maintainers of this `.github` repository; the overall `Finance and reliability` owner role remains proposed in the original ownership plan. | Keep source changes reviewed under this repository's actual rules. No named owner, code owner, required reviewer, or protection is asserted here. |
| Product behavior, local CI, contributor instructions, repository settings, adoption, and release policy | Maintainers of the destination repository that owns the behavior or setting. | Record the local owner role, tested revision, actual configuration, deviations, and any administrative decision. |
| Product architecture and cross-repository sequencing | The owning product architecture and product planning roles. | Update the canonical architecture or implementation plan in its owner repository; do not establish a competing source here. |
| Canonical schema and compatibility | `shared-contracts` maintainers, with affected producer and consumer roles. | Record version, compatibility, migration, producer tests, and consumer acknowledgment in the maintained catalog and handoff. |
| Master acceptance and integrated release status | `integration-evals` owner with the listed criterion owner role. | Submit exact evidence for independent review; only the integration-evals owner updates master status. |
| Security reporting route and incident response | Maintainers must confirm the route, access expectations, responsible role, and escalation responsibility. | Until confirmed, keep reporting blocked and sensitive details out of ordinary issues and evidence. |
| Visibility, membership, repository rules, required reviews/checks, and other platform settings | Authorized organization or destination repository administrators. | Obtain the applicable decision, apply it through an authorized account, and inspect resulting settings. Documentation is a proposal until this evidence exists. |

Do not claim CODEOWNERS enforcement from a file alone. The destination owns its CODEOWNERS entries and must ensure each referenced user/team exists and has suitable repository access. A rule requiring code-owner review is a separate repository setting and must be checked independently. Do not add fictional users or teams; see [GitHub CODEOWNERS guidance](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners).

## Repository bootstrap

For a new repository, or when bringing an existing repository into shared governance, its owner reviews and records the following before describing an item as adopted:

1. Confirm the repository's purpose, owner role, default branch, visibility decision, access boundaries, and any license decision with the appropriate maintainer. Do not infer approval from the source `.github` repository.
2. Read the destination's existing README, `OWNERSHIP.md`, `ACCEPTANCE.md`, `CONTRIBUTING.md`, `AGENTS.md`, tests, workflows, and release records. Preserve useful local policy and resolve conflicts with the destination owner before copying shared guidance.
3. Select which shared community-health files to inherit, link, or copy. Check destination-local overrides, supported inheritance, issue-form labels, reporter access, and form rendering. Keep security reporting inactive until the route and owner are confirmed.
4. Decide whether the destination will install `AGENTS.md`, `CODEOWNERS`, issue/PR templates, a workflow caller, and local security or release files. Record each as proposed, installed/configured, or verified; do not let a shared source imply local installation.
5. Ask the authorized destination administrator to configure and verify branch/ruleset protections, eligible reviewers, required checks, Actions access, secrets/environments, and security reporting where approved. Keep absent or inaccessible settings unknown.
6. Record source and destination revisions, review role and date, commands or native previews performed, evidence access class, deviations, open decisions, and the next owner action in the [adoption record](../templates/adoption-record.md). A repository is not compliant solely because a policy exists here.

Repositories with specialized contracts, regulatory or privacy needs, unusual release paths, or distinct access boundaries may retain stricter local requirements. The local owner documents why and which shared guidance does not apply.

## Ongoing maintenance

Destination maintainers keep local instructions, owners, workflow callers, settings, dependencies, labels, release procedures, and evidence current. Recheck relevant source versions and platform behavior when adopting a new revision or changing a caller, contract, security route, or release process. Mark evidence stale after a change to a tested source, contract, runtime, configuration, fixture, or procedure. An owner-selected review cadence may be recorded locally; this shared guidance sets no unapproved calendar interval.

When a shared source changes, identify consumers that copied or called it, assess compatibility, publish migration guidance where necessary, and retain an immutable source revision in each adoption record. Inherited defaults follow the source repository's default branch; they are not pinned by a consumer. Each destination decides when to review and accept such a change.

## Ownership handoff

When repository responsibility changes, outgoing and incoming maintainers record the transfer before calling it complete:

- incoming owner role and the maintainer who accepted the handoff, if the destination records named people;
- current repository revision, applicable shared-source revisions, local policies, and settings that were actually inspected;
- open issues/PRs, dependencies, releases, incidents, acceptance evidence, and pending administrative decisions;
- access needed to maintain the repository and the authorized administrator responsible for granting or revoking it;
- credentials or customer data requiring rotation/transfer, handled only through approved secret stores or protected channels, never copied into the handoff document;
- resulting owner/maintainer configuration and evidence, with unknowns and next actions assigned by role.

Do not claim a handoff based only on a reassignment comment or a document edit. Verify that the incoming maintainer can perform the responsibilities they accepted and that any access change was applied by an authorized administrator.

## Decommissioning or archival

The repository owner proposes decommissioning; the authorized repository or organization administrator makes any archive, visibility, access, or deletion change. Before that action:

1. Inventory active consumers, dependencies, contracts, links, scheduled jobs, workflow callers, releases, data, open issues/PRs, and security or acceptance records.
2. Decide whether to transfer the repository or artifact, publish a replacement or migration path, notify affected consumers, and identify the effective date. Have the relevant product, contract, security, or acceptance owners resolve their domain-specific handoffs.
3. Ask authorized administrators to remove or rotate credentials, revoke unnecessary access, disable external integrations, and configure the approved archived/retired state. Do not infer that archiving revokes credentials or stops every external consumer.
4. Preserve required evidence, source revisions, ownership decisions, and recovery information under the actual retention/access policy. If no policy or retention owner is known, record that as unresolved; do not invent a duration.
5. Record who authorized the disposition, source and final revisions, consumer notifications, settings/actions taken and verified, replacement links, unresolved risks, and the role responsible for any remaining work.

Deletion is not a routine substitute for archival and requires the explicit decision of the owner with authority over the repository and its records. This guidance does not authorize a visibility change, archive, or deletion.
