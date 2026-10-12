# Observed labels and local adoption planning

This page records the labels observed in this `.github` repository and a proposed way to use them locally. It does not assert that another repository has these labels or that maintainers have accepted the names as the reviewed program standard. [GH-04's triage comment](https://github.com/Jevelopers-neatHack-2026/.github/issues/9#issuecomment-6104413119), updated 2026-10-11, reports that the program orchestrator applied a taxonomy and asks whether maintainers accept those names or still expect a rename. That acceptance decision remains open. The read-only inventory below covers this repository only.

## Observed taxonomy and planning rules

A read-only API inventory at 2026-10-11 03:05:46 UTC found the following 27 labels in this `.github` repository. The taxonomy dimensions and usage rules below describe the observed names and propose local handling while maintainer acceptance is pending; they do not apply labels or configure synchronization.

| Dimension | Labels observed in this repository | Local planning rule and limitation |
|---|---|---|
| Priority | `priority:P0`, `priority:P1`, `priority:P2` | Use at most one local priority label if the destination has reviewed the names. Their current descriptions here are P0 “Blocks v1,” P1 “Needed for complete v1, not blocking,” and P2 “Post-v1 / nice to have.” These local descriptions are for v1 sequencing. Keep the integration-evals master checklist meanings unchanged: P0 means demonstration and financial integrity, P1 means next expansion, and Production means before enabling live commerce. Do not translate master `Production` into `priority:P2` or silently change a canonical priority. See the inspected immutable [master acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/ff1f6d2df816ebbff34742f51be728fcb5c28cb5/planning/acceptance-checklist.md). |
| Type | `type:bug`, `type:chore`, `type:contract`, `type:docs`, `type:epic`, `type:implementation`, `type:release-gate` | If a destination accepts this vocabulary, choose one primary type for the work: defect; tooling/CI/housekeeping; schema/interface definition; documentation-only; parent tracking issue; buildable unit; or a release-verification gate that closes last, respectively. The active issue forms map Feature and Integration to `type:implementation`, Research / decision to `type:docs`, and Backlog audit to `type:chore`; these are source-form choices, not a maintainer-approved semantic mapping. There is no observed `type:feature`, `type:integration`, `type:decision`, `type:security`, `type:audit`, or `type:gate`. Do not create or use those names as if they were applied. The security draft is pending and its type classification remains unresolved. |
| Area | `area:governance` | This repository describes `area:governance` as shared engineering and governance (`.github`). Use only an area label verified in the destination. Other `area:<domain>` labels are not present in this repository's observed set. Apply more than one only when distinct owners genuinely need to act and each label exists locally. |
| Dependency state | `state:blocked`, `state:in-progress`, `state:needs-spec`, `state:planned` | Use at most one to describe work state. `blocked` names a missing prerequisite; `needs-spec` means acceptance is unclear; `planned` is specified but not started; `in-progress` means an active branch or PR exists. There is no observed `state:ready`. A state label does not prove a test, acceptance criterion, or dependency passed. |
| Required for v1 | `required-for-v1` | This scope flag is independent of priority and dependency state. Use it only when the destination owner confirms the criterion belongs in v1; absence of the label is not evidence that work is out of scope. |

`cross-repo` is also observed. Treat it as a supplemental coordination flag, not a primary type. The type/state/priorities above are present in this repository's live label set; do not infer that all repositories have them. The `area:<domain>` pattern is a proposed local convention, not a claim that every area label exists.

The master checklist retains its P0/P1/Production categories and owner roles. The `.github` priority descriptions above are local label metadata, not a replacement or automatic mapping for those master fields. Preserve canonical priorities and owners when copying issue metadata between repositories. If a destination uses different labels, retain the canonical priority and required-for-v1 status in the issue body until its owner resolves the mapping.

## Existing labels and source-form configuration

The ten labels in the original baseline inventory remain present in this repository's observed set. Preserve them and their existing use; the live source does not establish that any legacy label was migrated or accepted as an alias.

| Baseline label | Observed status and handling |
|---|---|
| `accessibility` | Independent accessibility flag; not a priority, type, area, or state. |
| `bug` | Still present. The Bug form currently configures both `type:bug` and `bug`; this source configuration does not establish an alias or approved duplication rule. |
| `documentation` | Still present. Keep its prior uses; do not silently rename it to `type:docs`. |
| `duplicate` | Existing disposition label; preserve. |
| `enhancement` | Still present. The Feature form configures it with `type:implementation`; this does not establish a global alias. |
| `good first issue` | Contributor invitation; preserve. |
| `help wanted` | Contributor invitation; preserve. |
| `invalid` | Existing disposition label; preserve. |
| `question` | Request-for-information/discussion label; preserve. |
| `wontfix` | Existing disposition label; preserve. |

The five active issue forms on current main configure these labels; the separate security draft stays outside the chooser:

| Form | Configured labels |
|---|---|
| Feature | `type:implementation`, `enhancement` |
| Bug | `type:bug`, `bug` |
| Integration | `type:implementation`, `cross-repo` |
| Research / decision | `type:docs`, `question` |
| Backlog audit | `type:chore` |
| Security draft | `type:bug` (pending, outside the active chooser; the private route and accountable owner remain unconfirmed) |

The forms are published on the inspected [main commit `4129e71f42a51d42803b1020e146f54108cf2f93`](https://github.com/Jevelopers-neatHack-2026/.github/commit/4129e71f42a51d42803b1020e146f54108cf2f93). A separate read-only snapshot at 2026-10-11 02:44:41 UTC found all eight configured names in each of fourteen repositories. That records label existence at that time only; it does not prove that forms were installed, labels were adopted as a reviewed standard, or any repository remains compliant. Recheck the destination's labels and permissions before relying on a form. These forms do not add priority, area, state, or required-for-v1 labels.

## Examples while acceptance is pending

In each example, preserve the canonical priority, required-for-v1 value, owner roles, acceptance IDs, and dependency evidence in the issue body. Any local labels below are candidates from the observed set; use them only after the destination owner confirms their meaning and availability.

- **Blocked P0 integration:** keep the master priority `P0` and its demonstration/financial-integrity meaning in canonical metadata. If the destination confirms the observed local names, use `type:implementation`, `cross-repo`, and `state:blocked`; add `required-for-v1` only when the criterion is in v1, and add a verified area label only when available. Name the producer, consumer, expected fixture/version, owner roles, and unblock condition. Do not use nonexistent `type:integration`.
- **P1 required-for-v1 documentation leaf:** keep master `P1` as next expansion in canonical metadata and separately state whether it is required for v1. If confirmed locally, candidate labels are `type:docs`, `state:planned`, and `required-for-v1`; the local `priority:P1` label currently says “Needed for complete v1, not blocking,” so do not treat it as an automatic translation of master P1.
- **Security reporting-route decision:** the private route and owner remain unconfirmed. Keep sensitive details out of a public issue and mark the dependency blocked where a verified local `state:blocked` label is available. No `type:security` label was observed; leave type unresolved or use a type only if the destination owner confirms it accurately describes the scoped work. Do not activate the pending form or fabricate a contact.

## Per-repository application

1. Inventory labels and permissions in the destination repository. Record the repository URL, observation date, names/descriptions, and who can manage them.
2. Compare desired names with existing local labels and meanings. Preview the changes; do not rename or delete unrelated labels, and do not infer organization-wide state from this repository or one successful operation.
3. If authorized and permitted, create only missing names that the destination maintainer has approved. If an existing name has a different meaning, pause and record the conflict for that maintainer. If permission is missing, record the desired state as not applied and identify the local owner needed.
4. Verify the resulting set in that repository. Record `desired`, `applied`, and `verified` separately with the date and evidence. Repeat for each destination; one repository's result says nothing about another.
5. Use issue-body metadata when a label is absent. Reference a form label only after the destination owner checks that label and permissions. A local issue-template configuration may set labels but cannot create them.

This guidance does not apply labels, establish a reviewed organization-wide taxonomy, configure automatic synchronization, or verify destination adoption. Keep GH-04 open until the responsible maintainers record whether the applied names are accepted or a rename is expected.
