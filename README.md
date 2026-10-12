<a href="https://github.com/Jevelopers-neatHack-2026/shared-contracts">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="shared-contracts — Public schemas and compatibility fixtures. TicketStub banner showing two stub halves meeting at a perforation with interlocking bracket edges." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# shared-contracts

Contract design, compatibility handoffs and offline validation tools for the interfaces between TicketStub repositories.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: local validation tools; canonical package unpublished" src="https://img.shields.io/badge/status-local%20validation-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="docs/contract-catalog.md"><img alt="Contract catalog: proposed design" src="https://img.shields.io/badge/catalog-proposed-26302A?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [What's here](#whats-here) · [Quickstart](#quickstart) · [Validation](#testing-and-validation) · [Docs](#docs) · [Related](#related-repositories)

## Status

**Local validation tooling is implemented; the canonical package is not released.** At the 2026-10-12 audit revision [7251a09](https://github.com/Jevelopers-neatHack-2026/shared-contracts/commit/7251a09c4eaddbb1232d444fd931a01c266095ac), `main` includes the receipt metadata checker, standalone reporting proposal schemas and fixtures, their tests, and an Entire graph artifact workflow. It has no root `package.json`, installable canonical schema package or generated canonical SDK.

- **Available locally:** [receipt metadata validation](docs/receipt-checker.md), the [reporting/query/export proposal](proposals/reporting-v1/README.md), and the commands below. A structurally complete receipt does not verify its claims or grant release authority.
- **Unmerged work:** [draft PR #31](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/31) contains the canonical package candidate; [PR #46](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/46) stages SDK and production-boundary integration, and [PR #42](https://github.com/Jevelopers-neatHack-2026/shared-contracts/pull/42) proposes additional usage-cost fields. A candidate's private development permission, compatibility review, consumer pin and release acceptance are separate records.
- **Consumer pins:** consumers record their exact candidate revision, archive digest and adoption limitations in local manifests, such as [cost-intelligence's contract lock](https://github.com/Jevelopers-neatHack-2026/cost-intelligence/blob/main/contracts.lock.json). A vendored proposal archive is not a registry release or evidence of acceptance by every consumer. Recheck the current manifest rather than copying a moving candidate version into this README.
- Planned work is tracked in [SC-EPIC #1](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/1) and its linked SC issues, ending with the [SC-12 release gate](https://github.com/Jevelopers-neatHack-2026/shared-contracts/issues/3). CON-01 to CON-03 stay planned in the [acceptance view](docs/architecture/ACCEPTANCE.md).

## What's here

This repository owns versioned request, result, event, error and validation contracts between independently developed repositories. Business behavior and provider implementations stay with their domain owners. See [ownership](docs/architecture/OWNERSHIP.md).

The [contract catalog](docs/contract-catalog.md) is the maintained interface design. Its domain contracts are proposed design; the isolated reporting schemas under `proposals/` do not make the catalog a published package:

| Section | Covers |
| --- | --- |
| [Common envelope](docs/contract-catalog.md#common-envelope) | Required scope, correlation, provenance and `billing_mode` fields |
| [Domain contracts](docs/contract-catalog.md#domain-contracts) | Project request through research, creative, production, quote, authorization, usage and summary |
| [Ownership of state](docs/contract-catalog.md#ownership-of-state) | The authoritative owner of each record |
| [Financial identities and lifecycles](docs/contract-catalog.md#financial-identities-and-lifecycles) | Operation, billable attempt and transport retry; valuation and reservation states |
| [Compatibility acceptance](docs/contract-catalog.md#compatibility-acceptance) | Minimum checks before a contract is accepted |
| [Error model](docs/contract-catalog.md#error-model) | Typed, retry-safe error fields |

## Quickstart

Use Git and Node.js. The [maintained receipt runtime contract](docs/receipt-checker.md#rules-checked) recognizes Node 22.23.3 or later within 22, or 24.21.0 or later within 24; use one of those lines when preparing consumer evidence. There is no root npm installation or build step for the tools currently on `main`.

```sh
git clone https://github.com/Jevelopers-neatHack-2026/shared-contracts.git
cd shared-contracts
node --test tests/consumer-receipt.test.mjs tests/graph-workflow.test.mjs
```

These tests exercise the local receipt checker and graph-workflow policy. They make no product/provider request and do not accept a canonical package or an integration.

## Configuration

| Setting or input | Used by | Meaning |
|---|---|---|
| `SC_AJV_ROOT` | Reporting proposal validator and tests | Absolute path to an externally provisioned `node_modules` directory containing exactly `ajv@8.17.1`; the validator does not install dependencies or fetch schemas |
| Receipt JSON file | `scripts/check-consumer-receipt.mjs` | A locally prepared receipt matching the [receipt template](docs/consumer-acceptance-receipt.md); input is metadata, not an executable command list |

No service credentials or `.env` file are needed for these offline tools. Keep secrets out of receipt fields and fixtures. The graph workflow's CLI/plugin setup is defined separately in [its workflow source](.github/workflows/entire-graph.yml).

## Testing and validation

| Check | Command or instructions | What it establishes |
|---|---|---|
| Receipt and workflow policy tests | Quickstart command above | Local metadata validation and static workflow-policy behavior |
| Reporting proposal fixtures | `node proposals/reporting-v1/validate.mjs` after setting `SC_AJV_ROOT` | Synthetic fixtures match proposed structural schemas |
| Reporting runner regressions | `node --test tests/reporting-proposal.test.mjs` with the same dependency setup | Local runner and fixture failure controls |
| Prepared receipt | `node scripts/check-consumer-receipt.mjs receipt.json` after creating that input file | `METADATA_COMPLETE`, `INCOMPLETE` or `INVALID`; no verification of real artifacts, commands or people |

The [reporting proposal README](proposals/reporting-v1/README.md#offline-validation) describes dependency provisioning, exit codes and schema limitations. There are no root npm lint, build or test scripts. The existing [Entire graph workflow](.github/workflows/entire-graph.yml) runs on `main` pushes and uploads graph artifacts; it does not run these contract/receipt suites or establish a product release gate.

## Repository structure

| Path | Contents |
|---|---|
| [`docs/contract-catalog.md`](docs/contract-catalog.md) | Maintained domain-interface design and state ownership |
| [`docs/consumer-acceptance-receipt.md`](docs/consumer-acceptance-receipt.md) | Consumer handoff template and evidence boundaries |
| [`docs/mvp-readiness.md`](docs/mvp-readiness.md) | Dated candidate, owner and consumer-readiness snapshot; follow its receipts for later decisions |
| [`proposals/reporting-v1/`](proposals/reporting-v1/) | Unadopted reporting schemas, synthetic fixtures and isolated validator |
| [`scripts/`](scripts/) | Offline receipt metadata checker |
| [`tests/`](tests/) | Receipt, reporting and workflow-policy tests |
| [`.github/workflows/`](.github/workflows/) | Graph artifact workflow, separate from canonical package acceptance |

## Docs

- [Contract catalog](docs/contract-catalog.md)
- [Receipt checker](docs/receipt-checker.md) · [Consumer acceptance receipt](docs/consumer-acceptance-receipt.md) · [Dated MVP readiness](docs/mvp-readiness.md)
- [Reporting proposal and open owner questions](proposals/reporting-v1/README.md)
- [Ownership](docs/architecture/OWNERSHIP.md) · [Acceptance view](docs/architecture/ACCEPTANCE.md)
- [Architecture section 5: shared contracts and data ownership](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md#5-shared-contracts-and-data-ownership)
- [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Releases and versioning standard](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/standards/releases-versioning.md)

## Related repositories

This catalog coordinates producer/consumer interfaces; it is not itself an installed runtime dependency. Relevant handoffs include:

- [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors): validates through injected ports and records the shared-contracts issues it waits on.
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): owns Finance semantics and its exact candidate pin; [team-dashboard](https://github.com/Jevelopers-neatHack-2026/team-dashboard) consumes authorized Finance projections.
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals): hosts the master checklist that tracks CON-01 contract compatibility.
- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): architecture kit and producer/consumer map.

## Contributing

Read [AGENTS.md](AGENTS.md) and follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Schema changes need review by at least one affected producer and consumer ([compatibility acceptance](docs/contract-catalog.md#compatibility-acceptance)). Keep proposed packets, historical receipts and canonical releases clearly distinguished. Documentation updates do not close the release gate.

## License

No repository license file is present. An archive, source pin or successful validation does not supply licensing terms.
