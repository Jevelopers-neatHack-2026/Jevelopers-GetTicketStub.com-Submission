<a href="https://github.com/Jevelopers-neatHack-2026/shared-contracts">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="shared-contracts — Public schemas and compatibility fixtures. TicketStub banner showing two stub halves meeting at a perforation with interlocking bracket edges." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# shared-contracts

Versioned schemas, validation and compatibility fixtures for the interfaces between TicketStub repositories.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: documentation baseline, no schemas published on main" src="https://img.shields.io/badge/status-docs%20baseline-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="docs/contract-catalog.md"><img alt="Contract catalog: proposed design" src="https://img.shields.io/badge/catalog-proposed-26302A?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [What's here](#whats-here) · [Docs](#docs) · [Related](#related-repositories)

## Status

**Docs baseline.** `main` contains design documentation only: no schemas, generated types, validators, fixtures, package or CI workflow. There is nothing to install or run yet, and no contract version has been accepted or released from this repository.

- In review: [draft PR #31](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31) proposes the first implementation (canonical JSON Schemas, generated types, offline validators and fixtures). It is a draft under review and is not merged. Owner acknowledgements and consumer adoption are still pending.
- Consumers cannot pin an accepted version yet. [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/blob/main/contracts.lock.json) vendors `@jevelopers/shared-contracts@0.3.0` as a `proposal_only` archive built from an earlier PR #31 head, with `adoption_accepted: false`. That archive is not a release of this repository.
- Planned work is tracked in [SC-EPIC #1](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/1) and its linked SC issues, ending with the [SC-12 release gate](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3). CON-01 to CON-03 stay planned in the [acceptance view](docs/architecture/ACCEPTANCE.md).

## What's here

This repository owns versioned request, result, event, error and validation contracts between independently developed repositories. Business behavior and provider implementations stay with their domain owners. See [ownership](docs/architecture/OWNERSHIP.md).

The [contract catalog](docs/contract-catalog.md) is the maintained interface design. It is proposed design, not implemented schemas:

| Section | Covers |
| --- | --- |
| [Common envelope](docs/contract-catalog.md#common-envelope) | Required scope, correlation, provenance and `billing_mode` fields |
| [Domain contracts](docs/contract-catalog.md#domain-contracts) | Project request through research, creative, production, quote, authorization, usage and summary |
| [Ownership of state](docs/contract-catalog.md#ownership-of-state) | The authoritative owner of each record |
| [Financial identities and lifecycles](docs/contract-catalog.md#financial-identities-and-lifecycles) | Operation, billable attempt and transport retry; valuation and reservation states |
| [Compatibility acceptance](docs/contract-catalog.md#compatibility-acceptance) | Minimum checks before a contract is accepted |
| [Error model](docs/contract-catalog.md#error-model) | Typed, retry-safe error fields |

## Docs

- [Contract catalog](docs/contract-catalog.md)
- [Ownership](docs/architecture/OWNERSHIP.md) · [Acceptance view](docs/architecture/ACCEPTANCE.md)
- [Architecture section 5: shared contracts and data ownership](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md#5-shared-contracts-and-data-ownership)
- [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Releases and versioning standard](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/standards/releases-versioning.md)

## Related repositories

Every producer and consumer depends on this catalog. The closest current consumers:

- [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors): validates through injected ports and records the shared-contracts issues it waits on.
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): pins the 0.3.0 proposal archive described above.
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals): hosts the master checklist that tracks CON-01 contract compatibility.
- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): architecture kit and producer/consumer map.

## Contributing

Follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Schema changes need review by at least one affected producer and consumer ([compatibility acceptance](docs/contract-catalog.md#compatibility-acceptance)). No license file is present in this repository.
