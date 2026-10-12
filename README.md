<a href="https://github.com/Jevelopers-neatHack-2026/team-dashboard">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="team-dashboard — Finance administration module. TicketStub banner showing a gauge arc and sparkline drawn on a stub-shaped card." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# TicketStub team dashboard

`team-dashboard` is the typed React package for the authenticated financial administration area of [TicketStub](https://github.com/Jevelopers-neatHack-2026). It renders host-supplied financial projections; [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence) owns calculations, ledger writes and export generation.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: local and synthetic integration slices" src="https://img.shields.io/badge/status-synthetic%20integration%20slices-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href=".nvmrc"><img alt="Node.js 24.15.0" src="https://img.shields.io/badge/node-24.15.0-26302A?style=flat-square&labelColor=17140F"></a>
  <a href="package.json"><img alt="React 19.3.0 peer" src="https://img.shields.io/badge/react-19.3.0%20peer-7CC6D2?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Architecture](#architecture-and-responsibilities) · [Quickstart](#quickstart) · [Configuration](#configuration) · [Checks](#checks) · [Docs](#docs) · [Related](#related-repositories)

## Status

**Local package and synthetic consumer slices are implemented; actual host integration and the v1 release remain pending.** The repository is public, while [`package.json`](package.json) marks the package private and unpublished. Its implemented surface now extends beyond the original route foundation:

| Implemented surface | Evidence and limits |
| --- | --- |
| Package, routes and shared components | JavaScript, declarations, isolated CSS, typed navigation and explicit loading/empty/error/restricted/unavailable states. Exact React/React DOM `19.3.0` peers are pinned; package compatibility still needs actual-host evidence. |
| Trusted server boundary | An injected `HostSessionVerifier` and guarded, scoped reads. Browser `HostAccess` is a display projection, never a credential. The package does not supply an identity provider or production verifier. See [TD-07](docs/integration/TD-07-trusted-host.md). |
| Canonical summary adapter and view | The private development adapter targets the committed `@jevelopers/shared-contracts@0.9.7` pin and renders `FinancialSummaryView`. Synthetic packet eligibility is distinct from production adoption; see [TD-01B](docs/integration/TD-01B-shared-contracts.md) and [TD-02](docs/integration/TD02-enabled-summary.md). |
| Finance v2 presentation and reads | Budget advisory, cost breakdown, transaction list/detail, snapshot-bound pagination and asynchronous state handling use injected synthetic ports and retained producer captures. Values remain supplied strings; the dashboard does not recompute financial totals. See [views](docs/integration/TD-v2-fixture-views.md) and [read lifecycle](docs/integration/TD-v2-async-port.md). |
| Prepared export presentation | A manual JSON/CSV artifact-consumer path checks scope, current read/export access, source binding and exact artifact bytes. Its accepted port kind is `SYNTHETIC_EXPORT_CONFORMANCE_ONLY`; captured denials and positives are fixture evidence. It does not generate a financial report or deliver anything to CFO.ai. See [export consumer](docs/integration/TD-export-consumer.md). |

The Finance v2 read and export paths in `INTEGRATED` mode remain unavailable. A real Product/Finance host handoff must supply the accepted verifier, scope and grant mapping, read/export ports and disclosure boundary. Synthetic fixtures and captured producer responses do not establish that handoff.

Open items:

- Required domain leaves ([TD-EPIC #1](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/1)).
- **TD-01.E**, actual host/auth/data mount evidence ([TD-01 #3](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/3), [coverage](docs/integration/TD-01-coverage.md)). `npm run test:host` deliberately fails `BLOCKED` until it exists; fixture success is never WP02 evidence.
- The repository release gate ([TD-12 #4](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/4)).

## Architecture and responsibilities

The host owns sessions, current grants, selected project, navigation and the authorized data transport. The server entry checks the injected verifier's result before passing trusted scope to a read. The browser package renders the supplied projection and rejects mismatched scope, revision or state. Finance remains the source of metric definitions, amounts, budgets and prepared exports.

| Package entry | Purpose |
| --- | --- |
| `@jevelopers/team-dashboard` | Dashboard and reusable financial presentation components |
| `@jevelopers/team-dashboard/integration` | Route and host integration types/helpers |
| `@jevelopers/team-dashboard/server` | Server-only authorizer and guarded route reader; keep it out of client bundles |
| `@jevelopers/team-dashboard/style.css` | Isolated dashboard styles |

The [mount contract](docs/integration/mount-contract.md) defines host injection, routing, styles and rollback. Fixture hosts are development tooling; this repository contains no standalone production service.

## Quickstart

Requires Node **24.15.0** ([`.nvmrc`](.nvmrc)) and npm **11.12.1**, with `engine-strict` on.

```sh
npm ci
npx playwright install --with-deps --only-shell chromium
npm run dev
```

Open `http://127.0.0.1:49171/admin/finance`. The fixture host imports the extracted `npm pack` archive. Its controls and synthetic finance samples are explicitly labelled; they are not live business data. Dependency/browser installation needs registry/CDN access. Port, artifact directory and browser-install notes are in [local development](docs/development.md).

## Configuration

The shipped package reads no environment variables and contains no provider credentials. The host injects its verified identity and data ports. Development tooling uses:

| Variable | Local purpose |
| --- | --- |
| `TD_TEST_PORT` | Fixture/test server port; default `49171`, with strict port selection |
| `TD_ARTIFACT_DIR` | Playwright report and screenshot directory; default `test-results` |
| `SHARED_CONTRACTS_NODE_BIN` | Optional directory containing the producer's exact Node `22.23.3` executable for `contracts:provision` |
| `TD_REQUIRE_EXPORT_FIXTURES` | `1` makes missing captured export fixtures a test failure; it grants no integrated access |

## Checks

```sh
npm run lint
npm run typecheck
npm test -- --run
npm run build
npm run check:contrast
npm run test:e2e
npm run test:integration
```

Browser tests block external HTTP requests and need no provider secrets. CI runs the same sequence with a report gate ([TD-11 CI](docs/integration/TD-11-ci.md)); it is fixture validation, not release acceptance.

The optional canonical-contract suite is separate from the default CI gates:

```sh
npm run contracts:provision
npm run test:contracts
```

Provisioning checks the producer source and archive against [`contracts/shared-contracts.pin.json`](contracts/shared-contracts.pin.json), requires the producer's Node `22.23.3` toolchain and network access, and installs the verified package without changing the manifest or lockfile. A later `npm ci` removes that extra installation. The [contract integration guide](docs/integration/TD-01B-shared-contracts.md) explains the exact pin, supported contracts, separate test scope and remaining acknowledgements; a newer producer version is not automatically adopted here.

`npm run test:host` is a separate acceptance gate that currently exits nonzero with `BLOCKED`. Do not count it as a passing test or replace it with fixture-host results.

## Repository structure

| Path | Contents |
| --- | --- |
| [`src/access/`](src/access/) · [`src/server.ts`](src/server.ts) | Host access projections and server authorization seam |
| [`src/components/`](src/components/) · [`src/styles/`](src/styles/) | Shared UI patterns and scoped brand tokens |
| [`src/data/`](src/data/) · [`src/views/`](src/views/) | Read boundaries, canonical summary adapter and financial views |
| [`src/reports/`](src/reports/) | Report-route presentation |
| [`integration/fixture-host/`](integration/fixture-host/) | Packed-package development host and synthetic ports |
| [`contracts/`](contracts/) | Immutable development pin, consumer driver and contract tests |
| [`tests/`](tests/) · [`scripts/`](scripts/) | Unit/browser fixtures, package checks and report gates |

## Docs

| Document | Covers |
| --- | --- |
| [Local development](docs/development.md) | Toolchain, install, scripts, fixture host, environment variables |
| [Mount and rollback contract](docs/integration/mount-contract.md) | Exports, injected host boundary, routes, styles, rollback |
| [TD-01 coverage](docs/integration/TD-01-coverage.md) | TD-01.A–E local scope vs external obligations, producer blockers |
| [TD-01B contracts](docs/integration/TD-01B-shared-contracts.md) | Pinned 0.9.7 adapter, provisioning and consumer-test limits |
| [TD-02 summary](docs/integration/TD02-enabled-summary.md) | Canonical summary presentation and synthetic packet gate |
| [Finance v2 views](docs/integration/TD-v2-fixture-views.md) · [Read lifecycle](docs/integration/TD-v2-async-port.md) | Synthetic views, producer captures, pagination and asynchronous boundaries |
| [Prepared export consumer](docs/integration/TD-export-consumer.md) | Manual artifact download, byte integrity, denial captures and integrated-mode limits |
| [TD-07 trusted host](docs/integration/TD-07-trusted-host.md) | Server authorization seam, fail-closed rules, permission matrix, owner decisions (decided 2026-10-12) |
| [TD-10 components](docs/integration/TD-10-components.md) | Shared presentation components and their limits |
| [TD-11 CI validation](docs/integration/TD-11-ci.md) | Workflow, reports, retention |
| [Runtime and provenance decision](docs/decisions/TD-01-runtime-mount.md) | Dependency pins, host evidence, brand token source |
| [Ownership](docs/architecture/OWNERSHIP.md) · [Acceptance](docs/architecture/ACCEPTANCE.md) | Architecture ownership and global acceptance boundaries (these retain their authority) |

## Related repositories

- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): host application that will mount this module
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): owns financial calculations and ledger writes
- [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts): canonical schemas; this repository's development adapter is pinned separately to 0.9.7, with production adoption pending
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals): authoritative acceptance checklist
- [brand-kit](https://github.com/Jevelopers-neatHack-2026/brand-kit): source of the scoped design tokens

## Contributing

Follow the organization [contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). No license file is present in this repository.
