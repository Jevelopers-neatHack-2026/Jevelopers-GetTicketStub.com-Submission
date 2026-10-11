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

The separate `@jevelopers/print-production/candidate` surface binds all six typed operations to real local composition, inspection, export, batch and storage behavior against the frozen shared-contracts 0.9.4 development candidate. It creates canonical v2 bundle bytes and verifies them with the owner byte verifier. It remains explicitly unaccepted: fresh owner review is pending, synthetic authority is used in tests, supplier eligibility is blocked, and canonical visible batch rows are blocked by the candidate's eligibility requirement (PP#13.4). JobRef/status retains persisted row evidence with `batch:null`; candidate repair scheduling and CSV activation remain unimplemented. See [candidate adapter availability and limits](docs/contracts/candidate-adapter.md). The calibration profile is sRGB; local output does not claim CMYK, PDF/X or printer certification.

Runtime PR20 merged at `e7e57bbb048c7c2a5529eed658c8d3ecf8b5ceac` with actual Linux proof and final source review disposition ROOT-R1 resolved. Pipeline PR23 merged at `e2c946b0c4f979227c19d0534ac71b5d5a85badb` with an explicit CI waiver. Separately, main's [PR29](https://github.com/Jevelopers-neatHack-2026/print-production/pull/29) merged at `f0afc32d2624a0aec1c74e50e07e70bab3e6c5fa` and changed CI child deadlines after that waiver. That history is inherited; current CI status was not observed during this dependency refresh. See [evidence and remaining acceptance](docs/runtime/README.md#evidence-and-remaining-acceptance).

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
| [`src/api/`](docs/contracts/candidate-adapter.md) | Six development adapters implemented | Frozen unaccepted shared-contracts candidate; real local bundle integrity, blocked supplier eligibility and canonical row publication. |
| [`scripts/verify/`](scripts/verify/dispatcher.ts) | Local suites; release blocked | Private checks run locally; external integration gates remain open. |
| [`scripts/security/`](scripts/security/README.md) | Accepted runtime foundation | ROOT-R1 resolved in reviewed/merged PR20; separate main PR29 changed CI deadlines; current CI status unobserved. |

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
