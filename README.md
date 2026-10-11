<a href="https://github.com/Jevelopers-neatHack-2026/print-production">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="print-production — Print composition and manifests. TicketStub banner showing crop marks, a registration target and bleed guides around a stub sheet." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# print-production

Print composition and production manifests for TicketStub; today it holds the PP-01A runtime foundation, an offline SVG-to-PNG/PDF calibration and verification harness.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: PP-01A local foundation; production behaviour planned" src="https://img.shields.io/badge/status-PP--01A%20local%20foundation-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href=".nvmrc"><img alt="Node.js 24.21.0" src="https://img.shields.io/badge/node-24.21.0-26302A?style=flat-square&labelColor=17140F"></a>
  <a href="docs/runtime/pins.json"><img alt="Chromium 156.0.8078.4 via Playwright 1.64.0, pinned" src="https://img.shields.io/badge/chromium-156.0.8078.4-7CC6D2?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Quickstart](#quickstart) · [Checks](#checks) · [Module map](#module-map) · [Docs](#docs) · [Related](#related-repositories)

## Status

PP-01A implements a strict Node 24 / TypeScript ESM runtime foundation, exercised locally:

- Offline Chromium SVG-to-PNG/PDF calibration of one synthetic 4 x 2 inch Latin fixture, with independent PNG and PDF checks and normalized repeat hashes.
- Exact environment, dependency, font and browser pins ([pins.json](docs/runtime/pins.json)); mismatches fail with typed `VerificationFailure` codes, with no global-browser or system-font fallback.
- A fail-closed suite dispatcher (`pp-verify`): only the `runtime` suite is implemented; every other registered suite exits 1 with its named dependency, and `release` exits 1 with `RELEASE_INCOMPLETE`.
- The package root exports `renderCalibration`, `verifyRuntime` and `VerificationFailure`.

Not implemented: production composition, templates, typography, personalization, exporters, preflight, manifests, storage, repair, job recovery and metering, and canonical consumer contracts (these await PP-01B and external owners). There is no provider connection and no supplier, approval, purchase, identity or ledger authority. The calibration is an sRGB profile, not CMYK/ICC, PDF/X, trim/bleed or printer certification.

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

`--suite`, `--mode offline` and `--evidence-dir` are all mandatory; the runtime suite writes `runtime.json` and two renders under the evidence directory. Linux CI ([runtime workflow](.github/workflows/runtime.yml)) installs inside a digest-pinned Playwright image, then runs [`scripts/ci-offline.sh`](scripts/ci-offline.sh) with networking disabled, including the additional Linux sandbox suites.

## Module map

| Path | State | Notes |
| --- | --- | --- |
| `src/runtime/`, `src/index.ts` | Implemented (PP-01A) | Environment guard, calibration, typed errors. [Runtime guide](docs/runtime/README.md) |
| `src/exporters/`, `src/preflight/`, `src/typography/` | Calibration only | Offline browser adapter, PNG/PDF output checks, calibration font checks; not production behaviour |
| [`src/assets/`](src/assets/README.md) | Calibration font only | Licensed Noto Sans WOFF2 and OFL; production asset approval unimplemented |
| [`src/api/`](src/api/README.md) | Planned | Production contracts await PP-01B/shared-contracts |
| [`src/composition/`](src/composition/README.md) | Planned | Artwork, text and logo composition |
| [`src/templates/`](src/templates/README.md) | Planned | Layouts bound to a confirmed supplier specification |
| [`src/personalization/`](src/personalization/README.md) | Planned | Canonical attendee fields, later CSV import |
| [`src/manifests/`](src/manifests/README.md) | Planned | Production bundle manifests |
| [`src/storage/`](src/storage/README.md) | Planned | Production artifact storage |
| [`src/jobs/`](src/jobs/README.md) | Planned | Durable jobs and recovery |
| [`src/repair/`](src/repair/README.md) | Planned | Bounded repair |
| [`src/telemetry/`](src/telemetry/README.md) | Planned | Production metering and traces |
| [`scripts/verify/`](scripts/verify/dispatcher.ts) | Implemented | `pp-verify` CLI and suite registry |
| [`scripts/security/`](scripts/security/README.md) | Implemented, Linux CI pending | Container/sandbox policy, probes and diagnostics |

## Docs

- [PP-01A runtime: run, calibration profile, evidence and limits](docs/runtime/README.md)
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
