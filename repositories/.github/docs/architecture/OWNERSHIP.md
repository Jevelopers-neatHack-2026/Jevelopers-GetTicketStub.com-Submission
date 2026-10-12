# `.github`

**Repository status:** Verified existing on GitHub, private, October 10, 2026.
**Proposed owner:** Finance and reliability.
**Delivery state:** Architecture plan; implementation criteria remain planned until evidence is recorded.

## Responsibility

Own the organization's documented contribution practices, review expectations, issue conventions, and reusable engineering guidance. Keep shared policy concise enough for contributors and coding agents to apply consistently across independently maintained repositories.

A public `.github` repository is needed for GitHub's supported inherited community-health defaults. Any visibility decision remains separate from this plan. Repository-specific `CODEOWNERS`, `AGENTS.md`, license decisions, and workflow callers must be installed or maintained in the repositories where they apply; this repository does not make them universal automatically.

## Planned internal modules

- `community/`: Source drafts for supported contribution and security documents.
- `templates/`: Issue, pull-request, and handoff conventions.
- `standards/`: Branching, review, dependency, and release expectations.
- `automation-design/`: Proposed reusable checks and caller requirements.
- `ownership/`: Responsibility matrix and escalation guidance.
- `adoption/`: Per-repository rollout and verification checklist.

## Dependencies and handoff

Coordinate interface gates with `shared-contracts`, integrated release checks with `integration-evals`, and workspace assembly with `getticketstub.com`. Match any future reusable workflow visibility to the visibility of its callers. Document required permissions and configure checks only after their implementation is available.

## P0 demo slice

Agree on pull-request evidence, repository ownership, secret handling, and a minimal integrated release gate. Prepare governance drafts without claiming that branch rules, licenses, workflows, or visibility settings are already configured.

## Acceptance boundary

- [ ] Each repository has a confirmed owner and applicable local instructions.
- [ ] Shared defaults are distinguished from per-repository configuration.
- [ ] Planned checks have named implementers and meaningful pass conditions.
- [ ] License choices remain explicit team decisions.
- [ ] Adoption status is recorded without inventing completed configuration.

[Architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) · [Acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

## Acceptance and contributor handoff

Use the [repository acceptance view](ACCEPTANCE.md) and [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md). Interfaces are specified in the [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md). Preserve local contributor and agent instructions; follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.
