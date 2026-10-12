# Observed labels and local adoption planning

This page records dated label observations and a proposed way to use labels locally. It does not assert that another repository has these labels or that maintainers accepted the names as the reviewed program standard. [GH-04's triage comment](https://github.com/Jevelopers-neatHack-2026/.github/issues/9#issuecomment-6104413119), updated 2026-10-11, asked whether maintainers accept the applied taxonomy or still expect a rename. The 2026-10-12 issue snapshot later records GH-04 (#9) closed completed. That closure status supersedes the earlier open-issue wording; consult the issue's closure evidence before claiming which taxonomy decision was accepted or proposing a rename.

## Partial current evidence (2026-10-12)

At approximately 17:29 UTC, current public issue label objects confirmed `type:docs` on [issue #9](https://github.com/Jevelopers-neatHack-2026/.github/issues/9), `type:implementation` on [issue #14](https://github.com/Jevelopers-neatHack-2026/.github/issues/14), and `cross-repo` on [issue #12](https://github.com/Jevelopers-neatHack-2026/.github/issues/12). This is a partial sample of labels attached to those issues, not the full catalog. The label-catalog endpoint and public labels page were unavailable during this check. The current existence of other names, including `type:chore`, `type:bug`, `bug`, `enhancement`, and `question`, remains unknown; inability to retrieve the catalog does not show that any label is absent. Verify a label in the destination before configuring or applying it there.

## Closed-issue label discrepancies (2026-10-12)

A read-only issue REST observation captured at 19:22:37 UTC found these labels on closed issues. It is not a full label-catalog check.

| Issue | Observed issue state | Relevant observed labels |
|---|---|---|
| [#3](https://github.com/Jevelopers-neatHack-2026/.github/issues/3) | Closed, completed | `state:in-progress`, `required-for-v1` |
| [#5](https://github.com/Jevelopers-neatHack-2026/.github/issues/5) | Closed, completed | `state:planned`, `required-for-v1` |
| [#16](https://github.com/Jevelopers-neatHack-2026/.github/issues/16) | Closed, completed | `state:planned`, `required-for-v1` |
| [#11](https://github.com/Jevelopers-neatHack-2026/.github/issues/11) | Closed, not planned | `state:planned`, `required-for-v1` |
| [#13](https://github.com/Jevelopers-neatHack-2026/.github/issues/13) | Closed, not planned | `state:in-progress`, `required-for-v1` |

The closed/completed or closed/not-planned dispositions and their closure evidence remain authoritative: see the [GH-08 acceptance receipt](https://github.com/Jevelopers-neatHack-2026/.github/issues/5#issuecomment-6122075793), [GH-11 dated gate decision](https://github.com/Jevelopers-neatHack-2026/.github/issues/16#issuecomment-6122141536), [GH-11 scope addendum](https://github.com/Jevelopers-neatHack-2026/.github/issues/16#issuecomment-6116512227), [GH-03-I scope addendum](https://github.com/Jevelopers-neatHack-2026/.github/issues/3#issuecomment-6116512413), and [epic closure receipt](https://github.com/Jevelopers-neatHack-2026/.github/issues/3#issuecomment-6122142963). An old `state:*` label does not reopen work or verify it. The `required-for-v1` flag on #11 and #13 conflicts with their explicit reduced-scope deferral, not with their closed/not-planned disposition.

**Unapplied cleanup proposal:** after maintainer confirmation, remove only the listed `state:in-progress` / `state:planned` labels from these five closed issues, and reconcile `required-for-v1` on #11 and #13 with the recorded deferral. Preserve every other label and all closed dispositions. No label change was applied by this observation; recheck the issue objects and authority before any future mutation.

## Dated taxonomy inventory and planning rules

The last complete read-only API inventory available here, at 2026-10-11 03:05:46 UTC, found the following 27 labels in this `.github` repository. This table is a historical inventory, not a current full catalog. The taxonomy dimensions and usage rules below describe the names observed then and propose local handling; they do not apply labels or configure synchronization.

| Dimension | Labels in the 2026-10-11 inventory | Local planning rule and limitation |
|---|---|---|
| Priority | `priority:P0`, `priority:P1`, `priority:P2` | Use at most one local priority label if the destination has reviewed the names. Descriptions recorded in the historical inventory were P0 “Blocks v1,” P1 “Needed for complete v1, not blocking,” and P2 “Post-v1 / nice to have.” These local descriptions are for v1 sequencing. Keep the integration-evals master checklist meanings unchanged: P0 means demonstration and financial integrity, P1 means next expansion, and Production means before enabling live commerce. Do not translate master `Production` into `priority:P2` or silently change a canonical priority. See the inspected immutable [master acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/ff1f6d2df816ebbff34742f51be728fcb5c28cb5/planning/acceptance-checklist.md). |
| Type | `type:bug`, `type:chore`, `type:contract`, `type:docs`, `type:epic`, `type:implementation`, `type:release-gate` | If a destination accepts this vocabulary, choose one primary type for the work: defect; tooling/CI/housekeeping; schema/interface definition; documentation-only; parent tracking issue; buildable unit; or a release-verification gate that closes last, respectively. The earlier form source used `type:implementation` for Feature and Integration, `type:docs` for Research / decision, and `type:chore` for Backlog audit. The current partial check confirms only the first two names as attached issue labels; active forms no longer preassign unverified `type:chore`. These mappings are source-form choices, not a maintainer-approved semantic mapping. The dated inventory did not list `type:feature`, `type:integration`, `type:decision`, `type:security`, `type:audit`, or `type:gate`; do not create or use those names as if they were applied. The security draft remains pending and its type classification unresolved. |
| Area | `area:governance` | This repository describes `area:governance` as shared engineering and governance (`.github`). Use only an area label verified in the destination. The historical inventory did not include other `area:<domain>` names. Apply more than one only when distinct owners genuinely need to act and each label exists locally. |
| Dependency state | `state:blocked`, `state:in-progress`, `state:needs-spec`, `state:planned` | Use at most one to describe work state. `blocked` names a missing prerequisite; `needs-spec` means acceptance is unclear; `planned` is specified but not started; `in-progress` means an active branch or PR exists. The historical inventory did not include `state:ready`. A state label does not prove a test, acceptance criterion, or dependency passed. |
| Required for v1 | `required-for-v1` | This scope flag is independent of priority and dependency state. Use it only when the destination owner confirms the criterion belongs in v1; absence of the label is not evidence that work is out of scope. |

`cross-repo` is a supplemental coordination flag, not a primary type; it is also present in the partial 2026-10-12 observation. The other names in the historical inventory are not confirmed as current by that check. Do not infer availability in this repository or any destination from a prior inventory. The `area:<domain>` pattern is a proposed local convention, not a claim that every area label exists.

The master checklist retains its P0/P1/Production categories and owner roles. The `.github` priority descriptions above are local label metadata, not a replacement or automatic mapping for those master fields. Preserve canonical priorities and owners when copying issue metadata between repositories. If a destination uses different labels, retain the canonical priority and required-for-v1 status in the issue body until its owner resolves the mapping.

## Existing labels and source-form configuration

The ten names in the original baseline inventory were observed on 2026-10-11. Their current presence was not established by the partial 2026-10-12 issue-label check. Preserve existing use only after verifying that each label is currently available and appropriate; do not infer a migration or accepted alias.

| Baseline label | Historical observation and handling |
|---|---|
| `accessibility` | Recorded in the 2026-10-11 inventory as an independent accessibility flag; not a priority, type, area, or state. Verify current availability and meaning before use. |
| `bug` | Recorded in the 2026-10-11 inventory. Its current existence is unknown; the active Bug form no longer preassigns it. |
| `documentation` | Recorded in the 2026-10-11 inventory. Verify current availability; do not silently rename it to `type:docs`. |
| `duplicate` | Recorded as a disposition label in the historical inventory; verify current availability before use. |
| `enhancement` | Recorded in the historical inventory; the active Feature form no longer preassigns it because current availability was not confirmed. |
| `good first issue` | Recorded as a contributor invitation in the historical inventory; verify current availability before use. |
| `help wanted` | Recorded as a contributor invitation in the historical inventory; verify current availability before use. |
| `invalid` | Recorded as a disposition label in the historical inventory; verify current availability before use. |
| `question` | Recorded in the historical inventory as a request-for-information/discussion label; the active Research / decision form no longer preassigns it because current availability was not confirmed. |
| `wontfix` | Recorded as a disposition label in the historical inventory; verify current availability before use. |

The active form metadata in this source revision uses only labels confirmed by the partial current observation. The separate security draft stays outside the chooser and its label remains unverified:

| Form | Configured labels |
|---|---|
| Feature | `type:implementation` |
| Bug | None |
| Integration | `type:implementation`, `cross-repo` |
| Research / decision | `type:docs` |
| Backlog audit | None |
| Security draft | `type:bug` (pending, outside the active chooser; availability, private route, and accountable owner remain unconfirmed) |

This metadata-only correction removes unverified optional auto-labels; it does not alter form fields, IDs, bodies, acceptance history, or the `GH-ISSUE-FORMS@1.0.0` contract. A separate read-only snapshot at 2026-10-11 02:44:41 UTC found eight configured names in each of fourteen repositories. That records label existence at that time only; it does not prove that forms were installed, labels were adopted as a reviewed standard, or any repository remains compliant. The full label catalog was unavailable in the 2026-10-12 check. Recheck the destination's labels and permissions before relying on or adding an optional form label. These forms do not add priority, area, state, or required-for-v1 labels.

## Examples while acceptance is pending

In each example, preserve the canonical priority, required-for-v1 value, owner roles, acceptance IDs, and dependency evidence in the issue body. Any local labels below are candidates from the observed set; use them only after the destination owner confirms their meaning and availability.

- **Blocked P0 integration:** keep the master priority `P0` and its demonstration/financial-integrity meaning in canonical metadata. If the destination confirms the observed local names, use `type:implementation`, `cross-repo`, and `state:blocked`; add `required-for-v1` only when the criterion is in v1, and add a verified area label only when available. Name the producer, consumer, expected fixture/version, owner roles, and unblock condition. Do not use nonexistent `type:integration`.
- **P1 required-for-v1 documentation leaf:** keep master `P1` as next expansion in canonical metadata and separately state whether it is required for v1. If confirmed locally, candidate labels are `type:docs`, `state:planned`, and `required-for-v1`; the 2026-10-11 inventory described local `priority:P1` as “Needed for complete v1, not blocking,” so do not treat that historical description as an automatic translation of master P1.
- **Security reporting-route decision:** the private route and owner remain unconfirmed. Keep sensitive details out of a public issue and mark the dependency blocked where a verified local `state:blocked` label is available. The 2026-10-11 inventory did not list `type:security`; current label availability remains unknown. Leave type unresolved or use a type only if the destination owner confirms it accurately describes the scoped work. Do not activate the pending form or fabricate a contact.

## Per-repository application

1. Inventory labels and permissions in the destination repository. Record the repository URL, observation date, names/descriptions, and who can manage them.
2. Compare desired names with existing local labels and meanings. Preview the changes; do not rename or delete unrelated labels, and do not infer organization-wide state from this repository or one successful operation.
3. If authorized and permitted, create only missing names that the destination maintainer has approved. If an existing name has a different meaning, pause and record the conflict for that maintainer. If permission is missing, record the desired state as not applied and identify the local owner needed.
4. Verify the resulting set in that repository. Record `desired`, `applied`, and `verified` separately with the date and evidence. Repeat for each destination; one repository's result says nothing about another.
5. Use issue-body metadata when a label is absent. Reference a form label only after the destination owner checks that label and permissions. A local issue-template configuration may set labels but cannot create them.

This guidance does not apply labels, configure automatic synchronization, or verify destination adoption. The 2026-10-12 issue snapshot records GH-04 (#9) closed as completed; this document does not reopen it. Before changing label names or semantics, inspect that closure evidence and the destination's current labels and owner decision.
