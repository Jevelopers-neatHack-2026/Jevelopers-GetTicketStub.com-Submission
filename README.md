<a href="https://github.com/Jevelopers-neatHack-2026/integration-evals">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="integration-evals — Cross-component verification and evidence. TicketStub banner showing small stubs joined at perforations along a common checkpoint line." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# integration-evals

Cross-component verification for TicketStub, and the home of the master acceptance checklist and its evidence index.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: documentation baseline, no verification tooling on main" src="https://img.shields.io/badge/status-docs%20baseline-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="planning/acceptance-checklist.md"><img alt="Acceptance checklist: 47 criteria, all planned" src="https://img.shields.io/badge/criteria-47%20planned-26302A?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [What's here](#whats-here) · [Docs](#docs) · [Related](#related-repositories)

## Status

**Docs baseline.** `main` contains planning and evidence documentation only: no runner, fixtures, scenarios, package or CI workflow. There is nothing to install or run yet.

- All 47 acceptance criteria are `planned`. None is verified, and no implementation or sponsor evidence has been recorded.
- In review: [draft PR #23](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/23) adds pinned integration verification tooling. It is not merged, and its results are not acceptance evidence for `main`.
- In review: [PR #24](https://github.com/Jevelopers-neatHack-2026/integration-evals/pull/24) adds a saved CFO.ai business plan as SPN-03 evidence. SPN-03 stays planned until owner review and merge.
- Planned work is tracked in [IE-EPIC #1](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/1) and its linked IE issues, ending with the [IE-12 release gate](https://github.com/Jevelopers-neatHack-2026/integration-evals/issues/22).

## What's here

This repository owns reproducible evaluations across ownership boundaries: the customer journey, contract compatibility, recovery, artifact integrity and financial correctness. Repository-local tests stay with their implementations. See [ownership](docs/architecture/OWNERSHIP.md).

| Path | Purpose |
| --- | --- |
| [`planning/acceptance-checklist.md`](planning/acceptance-checklist.md) | Master acceptance criteria (ARC, CON, AGT, ART, FUL, FIN, BUD, DASH, EVAL, SPN, LIVE) with verify and evidence rules |
| [`planning/acceptance-checklist.json`](planning/acceptance-checklist.json) | Machine-readable tracker with empty evidence and revision fields |
| [`evidence/README.md`](evidence/README.md) | Index of required submission evidence; every entry is planned |
| [`docs/architecture/`](docs/architecture/OWNERSHIP.md) | [Ownership](docs/architecture/OWNERSHIP.md) and the [acceptance view](docs/architecture/ACCEPTANCE.md) for this repository |

Other repositories link their `docs/architecture/ACCEPTANCE.md` views to this checklist. Change criterion state here, and only after recording actual evidence and the tested revisions ([state rules](planning/acceptance-checklist.md#state-and-dependency-tracking)).

## Docs

- [Acceptance checklist](planning/acceptance-checklist.md) and [JSON tracker](planning/acceptance-checklist.json)
- [Evidence index](evidence/README.md)
- [Ownership](docs/architecture/OWNERSHIP.md) · [Acceptance view](docs/architecture/ACCEPTANCE.md)
- [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Acceptance evidence standard](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/standards/acceptance-evidence.md)

## Related repositories

- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): assembles the pinned integration workspace these evaluations run against.
- [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts): compatibility fixtures for contract checks.
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): expected money behavior for financial scenarios.
- [marketing-material](https://github.com/Jevelopers-neatHack-2026/marketing-material): consumes reviewed evidence.

## Contributing

Follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Use synthetic or approved fixtures and publish only sanitized evidence. Never fabricate component pins or financial outcomes. No license file is present in this repository.
