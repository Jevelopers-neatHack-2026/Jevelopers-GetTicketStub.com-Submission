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
  <a href="#status"><img alt="Status: documentation baseline, no site source on main" src="https://img.shields.io/badge/status-docs%20baseline-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/2"><img alt="Delivery plan: LP-EPIC issue 2" src="https://img.shields.io/badge/plan-LP--EPIC%20%232-26302A?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [What it owns](#what-it-owns) · [Docs](#docs) · [Related](#related-repositories)

## Status

**Docs baseline.** `main` holds this README and two architecture documents. There is no site source, package manifest, build, test or CI configuration yet, so there is nothing to install or run. No implementation or acceptance has been verified.

- Planned work is tracked in [LP-EPIC #2](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/2), from the page map and static site foundation ([LP-01 #3](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/3)) to the release gate ([LP-10 #12](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/12)).
- As of 2026-10-11 no pull requests are open. The only merged change is the architecture baseline in [PR #1](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pull/1). See [open pull requests](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pulls) for anything newer.
- Relevant acceptance criteria (EVAL-03, EVAL-04) stay planned in the [acceptance view](docs/architecture/ACCEPTANCE.md).

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
