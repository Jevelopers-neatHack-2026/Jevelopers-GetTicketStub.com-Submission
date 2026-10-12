# Issue forms

The published `GH-ISSUE-FORMS@1.0.0` contract is tracked by
[GH-03-I](https://github.com/Jevelopers-neatHack-2026/.github/issues/13). It provides five active
forms and keeps a security draft outside the chooser because no private reporting destination or
responsible owner is confirmed. The current main source is a partial publication, not six-form
acceptance. This review branch also disables blank issue submissions while that route is unresolved;
the five active forms retain their redaction warning. This change does not provide a private report
route or make the form fields safe for vulnerability details.
The execution-policy pack version is `1.1.0`; it is separate from this form-contract version.

The chooser configuration and five active forms are in [`.github/ISSUE_TEMPLATE/`](../.github/ISSUE_TEMPLATE/).
The parked security draft is [`pending/security.yml`](pending/security.yml).

| Form | State | File | Labels configured | Type-specific prompts |
| --- | --- | --- | --- | --- |
| Feature | Active in published source | [`feature.yml`](../.github/ISSUE_TEMPLATE/feature.yml) | `type:implementation`, `enhancement` | user outcome |
| Bug | Active in published source | [`bug.yml`](../.github/ISSUE_TEMPLATE/bug.yml) | `type:bug`, `bug` | sanitized repro, expected vs actual, environment/revision, regression scope |
| Integration | Active in published source | [`integration.yml`](../.github/ISSUE_TEMPLATE/integration.yml) | `type:implementation`, `cross-repo` | producer, consumers, contract/version, handoff tests |
| Research / decision | Active in published source | [`research-decision.yml`](../.github/ISSUE_TEMPLATE/research-decision.yml) | `type:docs`, `question` | question, alternatives, bounded experiment/budget, decision owner/output, follow-on |
| Security | **Pending; not in chooser** | [`pending/security.yml`](pending/security.yml) | `type:bug` (draft only) | non-sensitive coordination warning, no-secret confirmation |
| Backlog / acceptance audit | Active in published source | [`backlog-audit.yml`](../.github/ISSUE_TEMPLATE/backlog-audit.yml) | `type:chore` | criterion-to-evidence coverage, gaps, release impact |

## Common fields and required inputs

Each form definition includes the common issue key, owner role, priority and rationale, required-for-v1,
current evidence, exact gap, scope/non-goals, acceptance criteria, master acceptance IDs or justified
`N/A`, dependencies, validation plan, provider mode and closure evidence, plus its type-specific fields.
The parked security draft is not available to reporters. Field-level required flags and the optional
regression-scope and follow-on fields are defined in the YAML. A required field asks for an entry; it
does not establish that the answer is true. Contributors should state `unknown` or `N/A - <reason>`
where appropriate, and triage still reviews the response.

## Labels

Each form's YAML lists its exact requested labels in the table above. `cross-repo` is configured on the
integration form; it is not only a triage-applied label. A form does not assign labels based on dropdown
answers: priority and required-for-v1 remain body values, while triage applies those labels after review.

GitHub does not add a configured label that is absent from the destination repository. Before adopting
forms locally, check every configured label in that destination and omit an unsupported optional label
or route it through that repository's approved label process. A read-only inventory on 2026-10-11 UTC found
the eight configured labels in each of the fourteen organization repositories. That snapshot does not
guarantee future or other-repository availability. For other cross-repository issues, triage may apply
`cross-repo` when applicable and present locally.

## Security reporting remains blocked

No private reporting destination or responsible owner is confirmed. The security form is preserved as
a draft at [`pending/security.yml`](pending/security.yml), outside the chooser; `config.yml` has no
security contact link. The public `GH-07` tracking issue is not a reporting destination. Do not activate
or publish the draft until maintainers confirm the private route, access expectations and owner, then
complete a synthetic private-route walkthrough. GitHub private vulnerability reporting is not claimed
to be enabled. The five active forms do not satisfy the sixth-form or security-routing acceptance
criteria. At the user's direction, `GH-03-I` (#13) was closed **not planned**, not completed or
verified; those criteria are deferred and may be reconsidered later. No private route is confirmed.
Do not send sensitive details through a public issue.

## Source, destination and link checks

GitHub requires the shared `.github` source repository to be public for default community-health files
to supply organization defaults. A destination uses those defaults only when it has no local
`ISSUE_TEMPLATE` directory; local issue-template files replace the inherited set, including its
`config.yml`. Inherited files do not appear in a clone. The destination can be private, but GitHub's
form-schema documentation limits `required: true` submission blocking to public repositories. Do not
claim required-field enforcement for a private destination without a native preview there.

See GitHub's [default community health file guidance](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file)
and [issue form schema](https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-githubs-form-schema)
for the current platform rules.

For every target repository, inspect local overrides and verify each label and link with an account
that has the intended reporter access. A link to a private issue or document may be unreadable to some
reporters, and a link's presence does not provide a private security channel. Verify chooser/form
rendering and missing-required-field behavior on the target's default branch using safe synthetic
drafts, then cancel them; do not create sample issues. This documentation check does not substitute
for GitHub's native preview.

## Versioned publication and adoption record

The five forms were published as `GH-ISSUE-FORMS@1.0.0` on the `.github` default branch. This review
branch contains a chooser hardening candidate; it has not been published or assigned a new contract
version. Once a reviewed change reaches the default branch, record its full merge SHA and use
immutable links such as
`https://github.com/Jevelopers-neatHack-2026/.github/blob/<40-character-commit-sha>/.github/ISSUE_TEMPLATE/feature.yml`
when a consumer copies a form. Inherited defaults still follow the source default branch and are not
version-pinned by GitHub.

For each destination, record the contract version, source repository and full SHA/blob links, adoption
mode (inherit or copy), destination repository/default branch/visibility, local override decision,
label and link-access checks, native chooser/form preview, required-field scenario, reviewer role and
date, and any limitation. Do not create a release tag or claim rollout from this documentation alone.
