<a href="https://github.com/Jevelopers-neatHack-2026/.github">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt=".github — Shared standards and templates. TicketStub banner showing a neat stack of blank stub templates with a ruled guide and a paper clip." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# .github

Shared contribution standards, governance records, contributor templates and reusable workflow starters for the Jevelopers neatHack 2026 repositories.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: partly published guidance" src="https://img.shields.io/badge/status-partly%20published-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="templates/README.md"><img alt="Template contracts: GH-PR-TEMPLATE 1.0.0 and GH-ISSUE-FORMS 1.0.0" src="https://img.shields.io/badge/templates-PR%201.0.0%20%C2%B7%20issue%20forms%201.0.0-26302A?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Start here](#start-here) · [Checks](#checks) · [Docs](#docs) · [Related repositories](#related-repositories) · [Contributing](#contributing)

These documents define expectations. They do not change repository settings, prove that a product requirement passed, or establish adoption by another repository.

## Status

Current state, reconciled 2026-10-12 against immutable source revision [ebac9e4](https://github.com/Jevelopers-neatHack-2026/.github/commit/ebac9e4f3ad4e6784de6ce16cd857a94b18ae5bf) (merge of [PR #24](https://github.com/Jevelopers-neatHack-2026/.github/pull/24)). Live issue state can change; recheck before relying on it.

- **Leaf issues:** nine of the ten planned leaves are closed completed: [#4](https://github.com/Jevelopers-neatHack-2026/.github/issues/4), #6, #7, #8, #9, #10, #12, #14 and #15. [#5](https://github.com/Jevelopers-neatHack-2026/.github/issues/5) (`GH-08`, acceptance status and evidence records) is open.
- **#5 evidence:** PR #24 merged the evidence-provenance and consumer-terminology guidance at `ebac9e4`. The refreshed integration-evals consumer [review](https://github.com/Jevelopers-neatHack-2026/.github/issues/5#issuecomment-6117637650) reports all four earlier gaps resolved. That is agent evidence only; accountable human acceptance is still pending and is not recorded here.
- **Reduced scope:** at the user's direction, [#11](https://github.com/Jevelopers-neatHack-2026/.github/issues/11) (security reporting) and [#13](https://github.com/Jevelopers-neatHack-2026/.github/issues/13) (sixth form and private routing) were closed **not planned**, with possible later addition. See the scope addenda on [#16](https://github.com/Jevelopers-neatHack-2026/.github/issues/16#issuecomment-6116512227) and [#3](https://github.com/Jevelopers-neatHack-2026/.github/issues/3#issuecomment-6116512413). This is deferred scope, not a passed check: the original twelve-leaf security baseline is not complete, no private reporting route is confirmed, and only five active issue forms exist. Do not send sensitive details through a public issue.
- **Gate and epic:** release gate [#16](https://github.com/Jevelopers-neatHack-2026/.github/issues/16) (`GH-11`) and epic [#3](https://github.com/Jevelopers-neatHack-2026/.github/issues/3) remain open. The [final reduced-scope audit](https://github.com/Jevelopers-neatHack-2026/.github/issues/16#issuecomment-6117682189) at `ebac9e4` is ready pending maintainer acceptance, not a gate pass; no human approval is represented here.
- **Published sources:** the pull-request template (`GH-PR-TEMPLATE@1.0.0`) and five active issue forms (`GH-ISSUE-FORMS@1.0.0`) were published by [PR #19](https://github.com/Jevelopers-neatHack-2026/.github/pull/19) and [PR #20](https://github.com/Jevelopers-neatHack-2026/.github/pull/20).
- **Limits:** native GitHub UI behavior beyond the dated client check, hosted Actions and platform isolation, repository settings, adoption by other repositories, master acceptance, product release and security are not verified or claimed. This repository has no root `.github/workflows` installation; downstream workflow execution, private-workflow access, fork isolation and secret behaviour are unverified.
- **Acceptance:** master acceptance IDs and their status are owned by [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals). A merged documentation change, local fixture result or mock check does not verify one.

**Historical snapshot, superseded where it differs:** at public revision [4129e71](https://github.com/Jevelopers-neatHack-2026/.github/commit/4129e71f42a51d42803b1020e146f54108cf2f93) (observed 2026-10-11 02:48:39 UTC) `GH-03-I` (#13) and `GH-07` (#11) were open and blocked, and `GH-01` and `GH-04` were still awaiting acceptance. The scope change above supersedes that open/blocked state; the snapshot is kept as dated evidence.

Full detail: [current status and boundaries](docs/status.md). The [governance release assessment](adoption/governance-release-record.md) is a dated historical record and was not updated for the later scope change. Recheck live repository state before relying on either.

## Start here

| You want to | Read |
|---|---|
| Open a pull request | [Contribution guidance](CONTRIBUTING.md), [branch-to-review procedure](standards/contribution-workflow.md), [pull-request template](.github/pull_request_template.md) |
| File an issue | [Issue-form source and adoption guidance](templates/issue-forms.md) |
| Work as a coding agent | [AGENTS.md](AGENTS.md) and [agent guidance](standards/agent-contributors.md) |
| Record evidence | [Acceptance and evidence rules](standards/acceptance-evidence.md) and the [evidence record](templates/evidence-record.md) |
| Adopt guidance in a repository | [Bootstrap checklist](adoption/repository-bootstrap.md) and [adoption record](templates/adoption-record.md) |

## Checks

The reusable link-check workflow has offline tests against synthetic checkouts. From the repository root (Python 3.9 or newer and Node on `PATH`), create an isolated virtual environment and install the pinned test dependencies once. Dependency installation may download packages; it is setup, not an offline check.

```sh
CHECKS_VENV="$(mktemp -d)"
python3 -m venv "$CHECKS_VENV"
"$CHECKS_VENV/bin/python" -m pip install -r automation-design/tests/requirements.txt
```

Then run the offline suite in the same shell:

```sh
"$CHECKS_VENV/bin/python" -m unittest discover -s automation-design/tests -v
```

It runs the checker extracted from the workflow YAML and validates the source, fixture and starter policy. It is not a GitHub Actions run. See the [local fixture](automation-design/fixtures/reusable-workflow/README.md) for what it covers and leaves unverified.

## Docs

| Area | Documents |
|---|---|
| Status and gates | [Current status and boundaries](docs/status.md) · [Governance release assessment](adoption/governance-release-record.md) |
| Inventory | [Governance inventory](adoption/governance-inventory.md) · [Repository gap register](adoption/governance-register.json) |
| Standards | [Acceptance and evidence](standards/acceptance-evidence.md) · [Architecture linking](standards/architecture-linking.md) · [Releases and versioning](standards/releases-versioning.md) · [Label planning](standards/labels-planning.md) · [Security and secret handling](standards/security-secret-handling.md) |
| Templates | [Contributor templates](templates/README.md) · [Issue forms](templates/issue-forms.md) · [Release record](templates/release-record.md) · [Backlog audit](templates/backlog-audit.md) |
| Workflows | [Reusable workflow design](automation-design/reusable-workflows.md) · [Examples](automation-design/examples/README.md) · [Workflow starter](workflow-templates/docs-check.yml) |
| Security | [Pending security policy draft](community/SECURITY.pending.md) |
| Ownership | [Local ownership view](docs/architecture/OWNERSHIP.md) · [Local acceptance view](docs/architecture/ACCEPTANCE.md) |
| Organization profile | [profile/README.md](profile/README.md) |

## Related repositories

- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): canonical architecture and the [implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md).
- [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts): canonical schemas and the [contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md).
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals): master [acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) and evidence records.

Each repository owns its local instructions, checks, settings and adoption record.

## Contributing

Follow [CONTRIBUTING.md](CONTRIBUTING.md) and, for agents, [AGENTS.md](AGENTS.md). Use neutral `Refs #N` links, record the commands you actually ran, and keep credentials and customer data out of every artifact. Agent instructions, CODEOWNERS, licenses, workflow callers, labels and settings are local decisions in each repository; no license file is included here.
