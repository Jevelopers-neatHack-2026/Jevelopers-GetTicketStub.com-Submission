# Jevelopers Architecture Kit

Version 1.0 | October 10, 2026

A polished planning and handoff package for the Jevelopers commemorative ticket platform. It preserves the six supplied repository names, proposes eight additional boundaries, and defines an achievable initial application, financial dashboard, and verification plan.

## Start here

1. Read the [architecture guide](docs/architecture.md), also supplied as an [editable Word document](docs/Jevelopers_Repository_Architecture.docx) and a [PDF](docs/Jevelopers_Repository_Architecture.pdf).
2. Assign the roles in the [implementation plan](planning/implementation-plan.md).
3. Give each owner the corresponding [repository brief](#repository-briefs).
4. Agree on the [contract catalog](planning/contract-catalog.md) before parallel implementation.
5. Record actual results in the [acceptance checklist](planning/acceptance-checklist.md).

## Package contents

| Location | Contents |
| --- | --- |
| `docs/` | Full architecture guide in Markdown, DOCX, and PDF |
| `repository-briefs/` | Fourteen focused module handoffs |
| `planning/implementation-plan.md` | Work order, ownership, kickoff decisions, and future extensions |
| `planning/contract-catalog.md` | Contract fields, domain owners, invariants, and lifecycle distinctions |
| `planning/acceptance-checklist.md` | Stable criteria, priorities, owners, tests, and evidence requirements |
| `planning/acceptance-checklist.json` | Same criteria in a machine-readable planning format |
| `planning/repository-map.json` | Repository inventory, roles, boundaries, and planned package dependencies |
| `diagrams/` | Editable Mermaid sources and viewable runtime and financial diagrams |
| `CHANGELOG.md` | Material improvements made to the original proposal |
| `SHA256SUMS.txt` | File integrity checksums for the archive contents |

## Repository briefs

| Repository | Status in supplied inventory | Brief |
| --- | --- | --- |
| [marketing-material](https://github.com/Jevelopers-neatHack-2026/marketing-material) | Existing, private | [01](repository-briefs/01-marketing-material.md) |
| [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness) | Existing, private | [02](repository-briefs/02-agent-harness.md) |
| [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) | Existing, public | [03](repository-briefs/03-getticketstub.com.md) |
| [brand-kit](https://github.com/Jevelopers-neatHack-2026/brand-kit) | Existing, private | [04](repository-briefs/04-brand-kit.md) |
| [landing-page-repo](https://github.com/Jevelopers-neatHack-2026/landing-page-repo) | Existing, private | [05](repository-briefs/05-landing-page-repo.md) |
| [.github](https://github.com/Jevelopers-neatHack-2026/.github) | Existing, private | [06](repository-briefs/06-github-governance.md) |
| `shared-contracts` | Proposed | [07](repository-briefs/07-shared-contracts.md) |
| `event-intelligence` | Proposed | [08](repository-briefs/08-event-intelligence.md) |
| `creative-engine` | Proposed | [09](repository-briefs/09-creative-engine.md) |
| `print-production` | Proposed | [10](repository-briefs/10-print-production.md) |
| `fulfillment-connectors` | Proposed | [11](repository-briefs/11-fulfillment-connectors.md) |
| `cost-intelligence` | Proposed | [12](repository-briefs/12-cost-intelligence.md) |
| `team-dashboard` | Proposed | [13](repository-briefs/13-team-dashboard.md) |
| `integration-evals` | Proposed | [14](repository-briefs/14-integration-evals.md) |

## Status and use

This archive is the completed documentation package. It does not contain an implemented application, checked-out repositories, deployments, connected financial accounts, or completed test results. All implementation acceptance criteria begin as **pending**. Repository existence and visibility above reflect the supplied inventory, not a new inspection of GitHub.

The architecture guide separates the organizer's published requirements from proposed team requirements. Sources are linked in its final section. The repository map is planning data, not a dependency lockfile: it intentionally contains no fabricated commit IDs or executable bootstrap actions.

Extract the ZIP before following its relative links. Edit the Markdown sources for repository documentation or use the Word document for team review. The PDF preserves the reviewed layout. Update all three representations together when making a new release of the plan.

Software licenses and permissions for third-party assets must be selected or verified by the responsible owners before publication. This package does not introduce a software license for the repositories.
