<a href="https://github.com/Jevelopers-neatHack-2026/print-production">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="print-production — Print composition and manifests. TicketStub banner showing crop marks, a registration target and bleed guides around a stub sheet." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# print-production

Private print-production engines for TicketStub, with a pinned offline calibration harness and local composition, batch, render and archive mechanics.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: private local mechanics; external acceptance blocked" src="https://img.shields.io/badge/status-private%20mechanics%20%7C%20acceptance%20blocked-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href=".nvmrc"><img alt="Node.js 24.21.0" src="https://img.shields.io/badge/node-24.21.0-26302A?style=flat-square&labelColor=17140F"></a>
  <a href="docs/runtime/pins.json"><img alt="Chromium 156.0.8078.4 via Playwright 1.64.0, pinned" src="https://img.shields.io/badge/chromium-156.0.8078.4-7CC6D2?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Quickstart](#quickstart) · [Checks](#checks) · [Module map](#module-map) · [Docs](#docs) · [Related](#related-repositories)

## Status

The package has a strict Node 24 / TypeScript ESM runtime foundation and private local engines. Current local work includes:

- Offline Chromium calibration renders a synthetic 4 × 2 inch Latin fixture to PNG/PDF, independently checks both outputs and compares normalized repeats.
- Private composition, typography, asset, template, preflight and repair mechanics; local rendering, output inspection, CSV batches and archives; exact dependency, font and browser pins live in [`pins.json`](docs/runtime/pins.json).
- `pp-verify` runs the calibration and private test suites. Private suites can pass their local checks while still reporting `external-blocked`; release exits 1 with `RELEASE_INCOMPLETE` until its outside contracts and acceptance evidence are available.

These private mechanisms do not define accepted public production operations or a canonical `ProductionBundle`. Test inputs and permission ports are synthetic; no supplier format is enabled, and no supplier, approval, purchase, identity or ledger authority is connected. Handoff eligibility remains false and production eligibility unknown. The calibration profile is sRGB; local output does not claim CMYK, PDF/X or printer certification.

Pending: the revised Linux sandbox configuration (ROOT-R1) still needs remote CI execution and independent review; macOS receipts do not certify Linux. See [evidence and remaining acceptance](docs/runtime/README.md#evidence-and-remaining-acceptance) and [the security policy record](scripts/security/README.md).

## Quickstart

Use the official Node **24.21.0** bundle with bundled npm **11.19.0** ([`.nvmrc`](.nvmrc), [`package.json`](package.json) `engines`, `engine-strict` in [`.npmrc`](.npmrc)). The `preinstall` guard rejects other runtimes. Installation needs registry/CDN access; rendering and checks then use only local resources.

```sh
export TZ=UTC LANG=C.UTF-8 LC_ALL=C.UTF-8
npm ci
npm run browser:install
npm run build
```

Checksum verification of the Node bundle, platform profiles and the calibration profile are in the [runtime guide](docs/runtime/README.md#run).

## Checks

```sh
npm run typecheck
npm run format:check
npm test
npm run verify -- --suite runtime --mode offline --evidence-dir out/evidence/local-macos
```

`--suite`, `--mode offline` and `--evidence-dir` are all mandatory; the runtime suite writes `runtime.json` and two renders under the evidence directory. Linux CI ([runtime workflow](.github/workflows/runtime.yml)) runs the bounded workloads and final verification in a digest-pinned Playwright image with networking disabled, including the Linux sandbox suites.

## Module map

| Path | State | Details |
| --- | --- | --- |
| [`src/runtime/`](docs/runtime/README.md), `src/index.ts` | Local runtime implemented | Pinned offline calibration; the package root exports runtime verification only. |
| [`src/composition/`](docs/composition/README.md), `src/templates/`, `src/typography/`, `src/assets/`, `src/preflight/`, `src/repair/` | Private local mechanics | Synthetic inputs and private adapters; no approved supplier roster or canonical production contracts. |
| `src/exporters/`, `src/personalization/`, `src/manifests/`, `src/storage/`, `src/jobs/` | Private output and batch mechanics | Local files, inspection, CSV/batches, archives and durable storage; no handoff-eligible bundle. See [production output](docs/production-output/README.md). |
| [`src/api/`](src/api/README.md) | Canonical API pending | Public production contracts await PP-01B and shared-contracts acceptance. |
| [`scripts/verify/`](scripts/verify/dispatcher.ts) | Local suites; release blocked | Private checks run locally; external integration gates remain open. |
| [`scripts/security/`](scripts/security/README.md) | Linux candidate pending CI | Runtime sandbox policy and probes; remote execution and review are required for this candidate. |

## Docs

- [PP-01A runtime: run, calibration profile, evidence and limits](docs/runtime/README.md)
- [Private composition mechanics and limits](docs/composition/README.md)
- [Private output, CSV, archive and acceptance holds](docs/production-output/README.md)
- [Linux renderer security policy and ROOT-R1 diagnosis](scripts/security/README.md)
- [Repository responsibilities and interfaces](docs/architecture/OWNERSHIP.md) · [acceptance view](docs/architecture/ACCEPTANCE.md)
- [Architecture reference](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)

Architecture integration documents the intended boundaries. It does not establish completed product functionality, passing implementation tests, connected sponsor tools, or live financial activity.

## Related repositories

- [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine): immutable design versions consumed for composition.
- [event-intelligence](https://github.com/Jevelopers-neatHack-2026/event-intelligence): verified event facts.
- [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts): canonical interfaces (PP-01B dependency).
- [fulfillment-connectors](https://github.com/Jevelopers-neatHack-2026/fulfillment-connectors): selected product requirements and supplier handoff.
- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): receives verified customer downloads.

## Contributing

See the organisation [contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Update acceptance states in the [integration-evals master checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md), not here.
