<a href="https://github.com/Jevelopers-neatHack-2026/landing-page-repo">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="landing-page-repo — Product landing page. TicketStub banner showing a stub pinned to a wall under a soft spotlight." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# landing-page-repo

The public introduction to TicketStub: what it is, who it is for, and the way into the studio.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: Crystal landing page added, static site in site/" src="https://img.shields.io/badge/status-static%20site%20in%20site%2F-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/2"><img alt="Delivery plan: LP-EPIC issue 2" src="https://img.shields.io/badge/plan-LP--EPIC%20%232-26302A?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Crystal landing page](#crystal-landing-page) · [What it owns](#what-it-owns) · [Docs](#docs) · [Related](#related-repositories)

## Status

**Static site added.** The Crystal landing page lives in [`site/`](site/README.md) as a single static page with its assets. A dependency-free local artifact build, preview and foundation checks are available. Product/app-owner approval and release acceptance remain pending.

- Planned work is tracked in [LP-EPIC #2](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/2), from the page map and static site foundation ([LP-01 #3](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/3)) to the release gate ([LP-10 #12](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/12)).
- Architecture provenance remains in [PR #1](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pull/1); scroll lifecycle work is in [PR #18](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pull/18). See [open pull requests](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pulls) for current work.
- Relevant acceptance criteria (EVAL-03, EVAL-04) stay planned in the [acceptance view](docs/architecture/ACCEPTANCE.md).

## Crystal landing page

The landing page for personalized ticket stub keepsakes is in [`site/`](site/README.md): [`site/index.html`](site/index.html) plus its 3D model, flight data and scene images in [`site/assets/`](site/assets/). The original source remains intact; the build copies public payloads and records their SHA-256 hashes in `dist/site/manifest.json`.

Use Node 24.15.0 (pinned in `.nvmrc`); no package install is required:

```sh
node scripts/build.mjs
./scripts/validate-landing --suite foundation
node --test tests/scroll.test.mjs
node scripts/preview.mjs --port 8080
# Open http://127.0.0.1:8080/.
```

`./scripts/validate-landing` runs every required suite and exits nonzero for missing validators. A green foundation check establishes local artifact behavior only. The existing fonts/animation libraries still load from CDNs in a browser; offline animation, art rights and actual host routing are not verified here.

The [page inventory](integration/site-map.md), [runtime and validation decision](integration/runtime.md), and [static output proposal](integration/static-output.md) record current behavior and unresolved owner approvals. The host's proposed `/landing/` assets and source-component integration require an agreed adapter before this standalone artifact can be integrated.

## What it owns

The product purpose, audience, a representative example and the route into the customer application. Marketing content stays separate from the signed-in design and ordering flows. The first deployment is planned as static output that [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) serves at `/`, so it adds no separate running service. Route ownership is coordinated with that repository before integration.

Details, planned modules and the acceptance boundary are in [OWNERSHIP.md](docs/architecture/OWNERSHIP.md).

## Docs

| Document | Covers |
|---|---|
| [Repository responsibilities](docs/architecture/OWNERSHIP.md) | Responsibility, planned modules, dependencies, P0 demo slice, acceptance boundary |
| [Acceptance view](docs/architecture/ACCEPTANCE.md) | Master checklist criteria relevant to this repository |
| [Architecture and diagrams](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) | Organization-wide architecture kit v1.0 |
| [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md) | Cross-repository sequencing |

## Related repositories

- [brand-kit](https://github.com/Jevelopers-neatHack-2026/brand-kit): identity, tokens and logos to consume ([LP-06 #8](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/8) pins a publishable subset)
- [marketing-material](https://github.com/Jevelopers-neatHack-2026/marketing-material): approved messages, claims and provenance
- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): the customer application and the entry URLs this page links to
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md): the authoritative acceptance checklist

## Contributing

Follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Product claims on the page must match approved material from marketing-material and the demonstrated release. No licence is declared for this repository.
