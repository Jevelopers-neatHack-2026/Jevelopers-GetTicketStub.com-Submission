<a href="https://github.com/Jevelopers-neatHack-2026/team-dashboard">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="team-dashboard — Finance administration module. TicketStub banner showing a gauge arc and sparkline drawn on a stub-shaped card." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# team-dashboard

Typed React module for the authenticated financial administration area of `getticketstub.com`.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: TD-01 local foundation" src="https://img.shields.io/badge/status-local%20foundation-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href=".nvmrc"><img alt="Node.js 24.15.0" src="https://img.shields.io/badge/node-24.15.0-26302A?style=flat-square&labelColor=17140F"></a>
  <a href="package.json"><img alt="React 19.3.0 peer" src="https://img.shields.io/badge/react-19.3.0%20peer-7CC6D2?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Quickstart](#quickstart) · [Checks](#checks) · [Docs](#docs) · [Related](#related-repositories)

## Status

This revision delivers the **TD-01 local package, route and state foundation**, plus a local TD-10 shared component slice and TD-11 fixture CI:

- A private, unpublished package exporting JS, declarations and isolated CSS; React/React DOM `19.3.0` are exact peers matching the **unaccepted host candidate**, not a claim of WP02 agreement.
- A typed route manifest with loading, empty, error, restricted and unavailable boundaries. Missing upstream integration renders unavailable, never financial zero.
- Presentation components that display supplied values only, with synthetic display samples that are not producer-approved finance fixtures.
- A server-only, provider-agnostic authorization seam (`@jevelopers/team-dashboard/server`): an injected host session verifier, a proposed capability matrix and guarded reads that fail closed. Browser `HostAccess` projections are never credentials ([TD-07 trusted host](docs/integration/TD-07-trusted-host.md)).

Not delivered: financial domain views, a host verifier implementation or identity provider, authoritative financial adapters, exports, or actual host integration. No standalone production server or identity provider is included.

Open items:

- Required domain leaves ([TD-EPIC #1](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/1)).
- **TD-01.E**, actual host/auth/data mount evidence ([TD-01 #3](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/3), [coverage](docs/integration/TD-01-coverage.md)). `npm run test:host` deliberately fails `BLOCKED` until it exists; fixture success is never WP02 evidence.
- The repository release gate ([TD-12 #4](https://github.com/Jevelopers-neatHack-2026/team-dashboard/issues/4)).

## Quickstart

Requires Node **24.15.0** ([`.nvmrc`](.nvmrc)) and npm **11.12.1**, with `engine-strict` on.

```sh
npm ci
npx playwright install --with-deps --only-shell chromium
npm run dev
```

Open `http://127.0.0.1:49171/admin/finance`. The fixture host imports the extracted `npm pack` archive, not module source; its controls are labelled fixtures and contain no financial data. Port, artifact directory and browser-install notes are in [local development](docs/development.md).

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

## Docs

| Document | Covers |
| --- | --- |
| [Local development](docs/development.md) | Toolchain, install, scripts, fixture host, environment variables |
| [Mount and rollback contract](docs/integration/mount-contract.md) | Exports, injected host boundary, routes, styles, rollback |
| [TD-01 coverage](docs/integration/TD-01-coverage.md) | TD-01.A–E local scope vs external obligations, producer blockers |
| [TD-07 trusted host](docs/integration/TD-07-trusted-host.md) | Server authorization seam, fail-closed rules, permission matrix, owner decisions (decided 2026-10-12) |
| [TD-10 components](docs/integration/TD-10-components.md) | Shared presentation components and their limits |
| [TD-11 CI validation](docs/integration/TD-11-ci.md) | Workflow, reports, retention |
| [Runtime and provenance decision](docs/decisions/TD-01-runtime-mount.md) | Dependency pins, host evidence, brand token source |
| [Ownership](docs/architecture/OWNERSHIP.md) · [Acceptance](docs/architecture/ACCEPTANCE.md) | Architecture ownership and global acceptance boundaries (these retain their authority) |

## Related repositories

- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): host application that will mount this module
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): owns financial calculations and ledger writes
- [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts): canonical finance schemas (pending)
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals): authoritative acceptance checklist
- [brand-kit](https://github.com/Jevelopers-neatHack-2026/brand-kit): source of the scoped design tokens

## Contributing

Follow the organization [contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). No license file is present in this repository.
