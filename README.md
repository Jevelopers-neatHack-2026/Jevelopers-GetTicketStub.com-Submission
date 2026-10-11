<a href="https://github.com/Jevelopers-neatHack-2026/getticketstub.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="getticketstub.com — The keepsake studio. TicketStub banner showing a stub emerging from a print slot with foil light raking across it." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# getticketstub.com

The TicketStub customer studio: paste an event link, watch the stub print while facts are researched, then edit, tilt the foil, tear it off and pin it to your wall.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: demo preview" src="https://img.shields.io/badge/status-demo%20preview-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href=".nvmrc"><img alt="Node.js 24.18.0" src="https://img.shields.io/badge/node-24.18.0-26302A?style=flat-square&labelColor=17140F"></a>
  <a href="package.json"><img alt="Next.js 16.4.0" src="https://img.shields.io/badge/next.js-16.4.0-7CC6D2?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Quickstart](#quickstart) · [Checks](#checks) · [Docs](#docs) · [Related repositories](#related-repositories) · [Contributing](#contributing)

## Status

This is a hackathon prototype. Implemented in this repository:

- The Next.js App Router studio ([`src/app`](src/app), [`src/customer/studio`](src/customer/studio/README.md)), integrated as the preview runtime for the deployment fix ([PR #22](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/22)). The Plus Launch preview was verified at `660cc5e` ([#21](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/21), closed with deployment evidence).
- Demo mode by default: fixture research (neatHack, The Pale Hours, Harbour FC), simulated art and agent replies, sandbox checkout, and a visible demo banner. Provider keys alone never enable external calls.
- An opt-in `TICKETSTUB_RUNTIME_MODE=live` development mode with direct Anthropic/OpenAI paths or per-capability OpenRouter routing ([`src/server/ai/providers.ts`](src/server/ai/providers.ts)).
- Offline provider tests and a production smoke script, run by the [runtime workflow](.github/workflows/runtime.yml).

Pending or outside this repository's current state:

- Publishing to Live needs separate authorization; the preview deployment is not a production release.
- Production identity, budget and URL access controls ([#7](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/7)–[#13](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/13)) and the WP02 customer application epic ([#1](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/issues/1)) are not done. Live mode is not a production deployment.
- Sign-in, wallet passes and QR codes are simulated; stubs live in browser storage. PR [#20](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/pull/20) remains a separate stacked implementation.
- All [acceptance criteria](docs/architecture/ACCEPTANCE.md) remain planned in the [master checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

## Quickstart

Use Node 24.18.0 ([`.nvmrc`](.nvmrc)) and npm 11.16.0 (`packageManager` in [`package.json`](package.json)).

```sh
npm ci
npm run dev          # http://localhost:3000
```

Production build:

```sh
npm run build
npm start            # binds 0.0.0.0, reads PORT (default 3000)
```

No environment variables are needed for the demo preview. The build downloads Google Fonts, so it needs outbound network access. Hosting settings, live mode and provider keys are in [Preview runtime, deployment and provider configuration](docs/operations/preview-runtime.md).

## Checks

```sh
npm run lint
npm run typecheck
npm test                    # offline provider and route tests; synthetic keys, no network
npm run build
npm run smoke:production    # against a running server; set SMOKE_BASE_URL for a non-default PORT
```

The [runtime workflow](.github/workflows/runtime.yml) runs these on pull requests and pushes to `main`. It does not verify phone gestures, upstream integration or platform deployment.

## Docs

| Document | What it covers |
| --- | --- |
| [Preview runtime and providers](docs/operations/preview-runtime.md) | Toolchain, build and start, Plus Launch settings, runtime mode, direct and OpenRouter provider settings, verification |
| [Studio module](src/customer/studio/README.md) | Routes, real versus simulated behaviour, storage, brand rules |
| [Ownership](docs/architecture/OWNERSHIP.md) | Repository responsibilities and interfaces |
| [Acceptance view](docs/architecture/ACCEPTANCE.md) | Relevant acceptance criteria |
| [Implementation plan](docs/planning/implementation-plan.md) · [Work packages](docs/planning/work-packages.md) | Central plan and P0 issue tracking |
| [Architecture kit v1.0](docs/architecture-kit/v1.0/README.md) | Architecture and diagrams (immutable snapshot) |
| [Repository inventory](integration/repository-map.json) · [Distribution map](docs/architecture-kit-distribution.json) | Verified repositories and kit distribution |
| [Architecture-kit deployment report](docs/architecture-kit-deployment-report.md) | Inventory, commits, PRs, validation and remaining publication requirements |

The architecture kit v1.0 is a checksummed snapshot that preserves the original planning claims, including proposed-repository labels. The maintained ownership documents, the [contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md) and the master checklist supersede snapshot copies for ongoing work. Architecture documents describe intended boundaries; they do not establish completed product functionality, passing implementation tests, connected sponsor tools or live financial activity.

## Related repositories

- [brand-kit](https://github.com/Jevelopers-neatHack-2026/brand-kit): brand tokens and assets used in [`src/brand`](src/brand/tokens.css) and [`public/brand`](public/brand)
- [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts): public schemas and compatibility fixtures
- [team-dashboard](https://github.com/Jevelopers-neatHack-2026/team-dashboard) and [landing-page-repo](https://github.com/Jevelopers-neatHack-2026/landing-page-repo): planned to integrate into this web deployment
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals): [acceptance tracking](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) and [submission evidence](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/evidence/README.md)
- [.github](https://github.com/Jevelopers-neatHack-2026/.github): organisation standards and templates

## Contributing

Follow the organisation [contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Keep secrets in server-side environment variables only, never `NEXT_PUBLIC_` names, and do not run paid provider calls without the project budget and authorization process.
