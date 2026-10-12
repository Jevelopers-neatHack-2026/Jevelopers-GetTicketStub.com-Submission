<a href="https://github.com/Jevelopers-neatHack-2026/landing-page-repo">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="landing-page-repo — Product landing page. TicketStub banner showing a stub pinned to a wall under a soft spotlight." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# TicketStub landing page

`landing-page-repo` contains the public introduction to [TicketStub](https://github.com/Jevelopers-neatHack-2026): what it is, who it is for, and the way into the studio.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: static draft; release pending" src="https://img.shields.io/badge/status-static%20draft-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href="https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/2"><img alt="Delivery plan: LP-EPIC issue 2" src="https://img.shields.io/badge/plan-LP--EPIC%20%232-26302A?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Quickstart](#quickstart) · [Checks](#checks-and-configuration) · [What it owns](#what-it-owns) · [Structure](#repository-structure) · [Docs](#docs) · [Related](#related-repositories)

## Status

**Static draft with local validation; release acceptance remains pending.** The Crystal landing page lives in [`site/`](site/README.md) as one static page and its assets. A dependency-free artifact build, loopback preview, source/fixture tests and review evidence are maintained here. A reachable public host is not proof that it serves these bytes.

- Planned work is tracked in [LP-EPIC #2](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/2), from the page map and static site foundation ([LP-01 #3](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/3)) to the release gate ([LP-10 #12](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/12)).
- Architecture provenance remains in [PR #1](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pull/1). Scroll and maker corrections are recorded in [PR #18](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pull/18) and [PR #32](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pull/32), with revision-specific evidence under [UX review](review/ux/README.md). [PR #33](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pull/33) adds the pinned draft brand inventory and validator; it imports no approved brand distribution. See [open pull requests](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pulls) for current work.
- [PR #34](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/pull/34) adds local content-governance and withdrawal checks. Named accountable reviewers, maintainer/backup and content/publication acceptance remain unconfirmed in the [content policy](review/content-policy.md).
- Relevant acceptance criteria (EVAL-03, EVAL-04) stay planned in the [acceptance view](docs/architecture/ACCEPTANCE.md).

The [CTA contract](integration/cta-contract.md) records a limited owner decision for a separate, input-free **Open studio** link to `https://getticketstub.com/make`; the maker itself updates a local preview. Full CTA/content acceptance, example rights, final brand acceptance, browser/manual/performance evidence, privacy/indexing decisions and the actual host adapter remain release prerequisites. The [LP-10 gate](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/12) records their current disposition. Existing on-page price and delivery copy is an unapproved commercial claim, not a fulfillment promise.

## Crystal landing page

The landing page for personalized ticket stub keepsakes is in [`site/`](site/README.md): [`site/index.html`](site/index.html) plus its 3D model, flight data and scene images in [`site/assets/`](site/assets/). The original source remains intact; the build copies public payloads and records their SHA-256 hashes in `dist/site/manifest.json`.

### Quickstart

Run from the repository root with Node **24.15.0** (pinned in [`.nvmrc`](.nvmrc)); no npm package install is required:

```sh
node scripts/build.mjs
./scripts/validate-landing --suite foundation
node --test tests/*.test.mjs
node scripts/preview.mjs --port 8080
# Open http://127.0.0.1:8080/.
```

## Checks and configuration

`./scripts/validate-landing` builds the artifact and runs every required suite in release mode by default. It exits nonzero for missing validators or pending required acceptance. A green foundation check establishes local artifact behavior only. To inspect the current provisional brand input without claiming release acceptance:

```sh
./scripts/validate-landing --suite brand --mode draft
./scripts/validate-landing --suite brand --mode release
```

The draft command checks pinned local declarations and assets; the release command remains blocked while the upstream publishable subset and required decisions are absent. [Brand consumption](integration/brand-consumption.md) explains the exact boundary. There is no GitHub Actions workflow in this repository; local evidence records are not hosted CI results.

`./scripts/validate-landing --mode draft` runs the complete local draft suite set, including brand and governance. `./scripts/validate-landing --suite governance --mode release` still refuses qualification without the named owner/maintainer decisions. The [content change checklist](review/content-change-checklist.md) and [withdrawal procedure](review/content-policy.md#withdrawal-and-rollback-runbook) explain how to change claims while preserving provenance and previous evidence.

No environment file or service key is needed for the local artifact. `scripts/preview.mjs --port 8080` chooses the loopback preview port. [`src/content/cta.json`](src/content/cta.json) holds the CTA configuration mirrored and checked in [`site/index.html`](site/index.html); destination changes need the [CTA review](integration/cta-contract.md). Browser dependencies remain in the page and require the corresponding [runtime/handoff review](integration/runtime.md) when changed. Fonts and animation libraries still load from CDNs in a browser; source checks do not prove external response integrity, offline animation or asset rights.

The [page inventory](integration/site-map.md), [runtime and validation decision](integration/runtime.md), and [static output proposal](integration/static-output.md) record current behavior and unresolved owner approvals. The host's proposed `/landing/` assets and source-component integration require an agreed adapter before this standalone artifact can be integrated.

## What it owns

The product purpose, audience, a representative example and the route into the customer application. Marketing content stays separate from the signed-in design and ordering flows. The first deployment is planned as static output that [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com) serves at `/`, so it adds no separate running service. Route ownership is coordinated with that repository before integration.

Details, planned modules and the acceptance boundary are in [OWNERSHIP.md](docs/architecture/OWNERSHIP.md).

## Repository structure

| Path | Contents |
| --- | --- |
| [`site/`](site/README.md) | Maintained static page and public assets |
| [`scripts/`](scripts/) · [`tests/`](tests/) | Build, preview, suite dispatcher and dependency-free source/fixture tests |
| [`integration/`](integration/) | Page inventory, artifact contract, runtime and brand consumption boundaries |
| [`review/`](review/) | Content, privacy, brand and UX evidence; excluded from the public artifact |
| [`docs/architecture/`](docs/architecture/) | Repository ownership and acceptance navigation |
| [`markdowns/`](markdowns/README.md) · [`archive/`](archive/README.md) | Historical handoffs and earlier page snapshots; not current release evidence |

Generated `dist/site/` contains only the public page/assets and its handoff manifest. The preview does not serve the manifest, repository documentation, archives or tooling.

## Docs

| Document | Covers |
|---|---|
| [Repository responsibilities](docs/architecture/OWNERSHIP.md) | Responsibility, planned modules, dependencies, P0 demo slice, acceptance boundary |
| [Acceptance view](docs/architecture/ACCEPTANCE.md) | Master checklist criteria relevant to this repository |
| [Page inventory](integration/site-map.md) · [Runtime decision](integration/runtime.md) | Current sections, toolchain, validation and owner boundaries |
| [Static output contract](integration/static-output.md) | Public payload, path isolation, host compatibility and rollback |
| [Brand consumption](integration/brand-consumption.md) | Pinned provisional declarations, empty upstream allowlist and draft/release checks |
| [Content policy](review/content-policy.md) · [Change checklist](review/content-change-checklist.md) · [Governance evidence](review/governance/2026-10-12/README.md) | Proposed review responsibilities, freshness, withdrawal and retained local results |
| [UX review](review/ux/README.md) · [Header fit](review/ux/header-fit/README.md) · [Maker surface](review/ux/maker-surface/README.md) | Exact local browser observations and outstanding manual/host checks |
| [Architecture and diagrams](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) | Organization-wide architecture kit v1.0 |
| [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md) | Cross-repository sequencing |

## Related repositories

- [brand-kit](https://github.com/Jevelopers-neatHack-2026/brand-kit): identity, provisional tokens and logos; [LP-06 #8](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/8) tracks approval of a publishable subset
- [marketing-material](https://github.com/Jevelopers-neatHack-2026/marketing-material): draft collateral, claim/approval tracking and provenance
- [getticketstub.com](https://github.com/Jevelopers-neatHack-2026/getticketstub.com): the customer application and the entry URLs this page links to
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md): the authoritative acceptance checklist

## Contributing

Follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Product claims on the page must match approved material from marketing-material and the demonstrated release. No licence is declared for this repository.
