# Release and version guidance

This standard separates the revision of shared governance documents, each repository's own package/release version, shared contract versions, and an assembled product release. It does not publish a release, set tags, select a license, or make a version decision for another repository.

## Ownership and naming

Each repository's maintainers own its release cadence, versioning policy, publication authority, licensing decision, tags, and rollback. Record the actual decision in that repository. The shared-contracts catalog owns schema compatibility: each contract has an explicit schema version, and incompatible changes require a new supported version plus producer/consumer review. Do not assign one product-wide version to every component.

Where a repository has not selected a version policy, SemVer-style vMAJOR.MINOR.PATCH and prerelease identifiers such as -rc.1 are a proposal for owner review, not an existing rule. The repository owner must record whether tags/releases are used and who may publish. No current release or tested manifest is implied here.

Keep these identities separate:

- Execution policy pack 1.1.0 governs task routing and implementation/review roles; it is not this documentation tree's release version, a product release, or a workflow interface version.
- This governance tree has no release/version claim in this standard. Identify its content by the actual repository commit; do not infer a package release from the execution policy number.
- A workflow interface contract such as docs-link-check/v1 is a versioned input/output contract, not a release tag for the governance repository.
- A repository commit identifies source content. A full SHA is immutable; main and tags can move unless the tag is protected and verified.
- A contract version is owned by shared-contracts and recorded by each producer/consumer.
- An assembled product release is owned by integration-evals and its release owner, and records every selected component.

## Release lifecycle

Use these terms when a repository has a release process. They describe decision and evidence state; they do not set a version policy, authorize publication, or create GitHub protection.

| State | Meaning and minimum evidence |
|---|---|
| Policy proposed | A version/tag/changelog convention is a suggestion awaiting the repository owner's decision. Do not describe it as the repository's adopted policy. |
| Candidate | A specific source revision and any built artifact are identified. Record the intended version, artifact identity, tests, runtime/configuration, dependencies, and known limitations. |
| Eligible for release review | Required local gates have actual results, compatibility and migration have been reviewed, and required consumer/owner acknowledgments are recorded. Eligibility is not publication authority. |
| Authorized | The owner with publication authority explicitly approves the identified candidate, destination, and release operation. Current repository/tag/workflow settings are checked. |
| Published | The actual release/tag/artifact exists. Record its immutable source SHA, artifact digest, publication date, and destination. A merge or green CI run alone is not publication. |
| Post-release verified | The required post-release checks ran against the published artifact/version and exact environment; record their actual outcomes, evidence, reviewer role, and limitations. Product acceptance still follows the integration-evals process. |
| Blocked | A required owner decision, check, artifact, approval, credential, or configuration is missing, failed, skipped, or unknown. Record the owner role and exact unblock condition. |
| Deprecated, withdrawn, or superseded | The owner has stopped recommending or supporting the version or candidate. Record replacement, consumer impact, migration or rollback path, effective revision/date, and unresolved actions. Preserve prior evidence. |

The lifecycle may require repeated review or correction; never promote a candidate just because a version string exists. The applicable owner decides which states and checks fit their repository and records any stricter local release policy.

## Release record and gates

Use templates/release-record.md. Before declaring a release ready, confirm:

- exact component and repository SHAs, contract versions, runtime and dependency lockfile revisions;
- artifact names and digests, migration set, feature flags, environment and provider mode per component;
- commands/procedures, expected and actual results, evidence links/hashes, reviewer roles and dates;
- compatibility and affected-consumer acknowledgment, known limitations, and recovery/rollback steps tied to a validated artifact;
- authorization for publication and current release/tag/workflow settings.

A planning repository map, moving branch, missing artifact/command record, skipped mandatory test, or mock-only result for a live-required criterion blocks the corresponding release claim. Unknown cost or billing remains unknown. A release record template is not a tested manifest.

When a relevant contract, component, runtime, configuration, or fixture changes, mark prior evidence stale and rerun the affected gate. Preserve the old record as superseded. Roll back only to an artifact and data-recovery procedure that were actually validated; describe irreversible migration recovery explicitly.

## Clearly hypothetical examples

These examples illustrate shape only; they are not tested releases.

- Governance revision example: the fixed implementation starting source for policy pack 1.1.0 is [.github commit 28f67d2ed7cca3b5e90b3aa734533c7934c02d7a](https://github.com/Jevelopers-neatHack-2026/.github/commit/28f67d2ed7cca3b5e90b3aa734533c7934c02d7a). This is an immutable source link, not a release tag, merge, or product verification. The final governance document commit is recorded only after it exists.
- Hypothetical multi-repository product manifest: use the [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/5a2986454297dd6df97088a8fbde69adc771f7a0/docs/planning/implementation-plan.md) for sequencing, the [shared contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/c4caaccc2ea63b273eeac17ed89af8ac64f6bbde/docs/contract-catalog.md) for contract versions, and the [integration-evals master checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/ff1f6d2df816ebbff34742f51be728fcb5c28cb5/planning/acceptance-checklist.md) for acceptance and evidence ownership. These are source links, not component test evidence. Component SHAs = UNKNOWN until pinned; contract version = UNKNOWN until the catalog owner confirms it; artifact digest = UNKNOWN until built; integrated command/result = NOT RUN with no run URL; provider mode = per-component only after inspection; rollback target = UNKNOWN until a specific artifact and recovery procedure have been validated. The example remains blocked and has no evidence link because no product run is claimed.

When evidence exists, link the exact immutable component source and the actual run/artifact record with its digest, access class, command, result, provider mode, and reviewer. The [integration-evals release coordination issue #1](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/1) is a real coordination source, not a run result. Do not substitute it for an execution link.

The source catalog and central plan are linked from standards/architecture-linking.md. Do not duplicate their records in this repository.

## Changelogs, breaking changes, and prereleases

The repository owner chooses whether a changelog, release tags, and SemVer are appropriate. If the owner adopts a changelog, add user-relevant Added, Changed, Fixed, Deprecated, Removed, or Security entries with links to the actual reviewed changes. Exclude secret values, customer data, and unverified performance or compatibility claims. Do not invent a release date or tag.

Before a potentially breaking change, identify every affected producer and consumer, contract/catalog entry, supported version, migration path, compatibility window, rollback or recovery plan, and owner approval. The shared-contracts owner decides schema/version compatibility; this repository does not choose contract numbers. If the project has adopted SemVer, increment the major version for incompatible public behavior and document migration before publication. If no policy has been selected, record that decision as unresolved rather than imposing SemVer.

Where an owner chooses prereleases, use an explicit prerelease identifier such as v1.2.0-rc.1 only after the repository's version policy and tag authority are approved. A prerelease is not production approval. Promotion requires the same exact tested source, passed mandatory gates, completed consumer review, a validated artifact, and publication authorization. Re-running against a moved tag or branch does not refresh immutable evidence.

## Version change, failed gate, and rollback walkthroughs

These scenarios are fictional process examples with no release or test claim.

- Compatible contract change: the producer owner proposes an additive schema change in the [shared-contracts catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/c4caaccc2ea63b273eeac17ed89af8ac64f6bbde/docs/contract-catalog.md), records affected producer/consumer roles, and requests their review before selecting the catalog version. The implementation issue, exact source revisions, local fixtures, and integrated acceptance remain unknown until owners record them. No release is authorized by this scenario.
- Failed gate before publication: an integration fixture failure blocks the candidate. Record the exact failed command and tested SHA, keep the outcome fail, fix the cause in a new revision, rerun affected tests, and obtain fresh producer/consumer review. If no artifact was published, do not create a fictitious rollback tag.
- Rollback after a hypothetical publication: stop promotion, identify the actual published artifact and digest, restore only a previously validated compatible artifact, run its documented data-recovery procedure, and record exact results. If no artifact or recovery test exists, keep rollback blocked; do not guess a target.
- Self-reference: a release manifest cannot contain the immutable SHA of its own commit without changing that commit. Store the manifest content in the source revision, then record the resulting full source SHA in an external release record or index after the commit exists. Do not update the manifest to pin itself recursively.
