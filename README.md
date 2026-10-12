<a href="https://github.com/Jevelopers-neatHack-2026/event-intelligence">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="event-intelligence — Sourced event facts. TicketStub banner showing a magnifier over a stub whose facts link by dotted lines to source pins." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# event-intelligence

Internal Node 22 research components for TicketStub: controlled retrieval, extracted source candidates, evidence provenance and scoped research reuse.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: local foundation, internal components; integration pending" src="https://img.shields.io/badge/status-local%20foundation-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href=".nvmrc"><img alt="Node.js 22.23.3" src="https://img.shields.io/badge/node-22.23.3-26302A?style=flat-square&labelColor=17140F"></a>
  <a href=".github/workflows/verify.yml"><img alt="Python 3.11.17 in CI" src="https://img.shields.io/badge/python-3.11.17%20CI-7CC6D2?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Architecture](#architecture-and-responsibilities) · [Quickstart](#quickstart) · [Configuration](#configuration) · [Checks](#checks) · [Docs](#docs) · [Related](#related-repositories)

## Status

Implemented locally as private, internal components with offline tests:

- Controlled HTTP(S) retrieval that validates URL and DNS policy, pins connections to vetted addresses and bounds responses.
- A content privacy boundary that keeps untrusted content quarantined until a configured trusted review approves the public facts.
- Deterministic source extraction, a bounded text-PDF reader, and evidence storage with provenance.
- Source identity, a bounded source frontier, immutable correction history, scoped reuse cache, asset permission checks and JEV question preparation.
- A private retrieval lifecycle composing the frontier, retrieval, extraction, encrypted evidence store and source identity into a bounded private draft for an authorized host; it adds no public research API ([private retrieval](docs/discovery/private-retrieval.md)).

These do not establish the accepted public research request/response API or full issue acceptance. Still pending: public research API integration, complete source traversal, canonical fact selection, provider connections, live retrieval and release evidence, Finance/billing validation, production-host containment, and full screenshot/scanned-PDF inspection. Work is tracked under the [Agent & Creative v1 research epic (#1)](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/1).

The full inventory, with source paths, reference docs and issues, is in [Components, status and checks](docs/components.md).

The npm package `@jevelopers/event-intelligence-safe-retrieval` is private and unpublished at version `0.1.0`. Its declared exports expose retrieval primitives; they do not expose an accepted research service. Release acceptance remains tracked in [EI-12R #22](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/22).

## Architecture and responsibilities

An authenticated host supplies research scope and policy. The private retrieval lifecycle combines the bounded frontier, connection-validated `SafeFetcher`, deterministic extraction, encrypted evidence store and source identity into a private draft. Reopening durable state does not grant a new request budget or authorize disclosure; current evidence and scope checks still apply.

| Boundary | Owner and current surface |
| --- | --- |
| Retrieval package | Root export plus `/security/url-policy`, `/security/dns-resolver` and `/security/controlled-fetch`; exact map in [`package.json`](package.json) |
| Private research components | Source discovery, extraction, evidence, correction history, reuse and asset preparation inside this repository |
| Authenticated request and disclosure authority | Supplied by the host; a source URL, candidate or permission field is not an authority grant |
| Decision transport and Finance | Injected owner boundaries; JEV transport belongs to `agent-harness`, spending authority to `cost-intelligence` |
| Creative handoff | Intended downstream consumer is `creative-engine`; accepted canonical package mapping remains gated |

There is no application server or `npm start` command. Use the [private lifecycle reference](docs/discovery/private-retrieval.md) and [handoff contracts](docs/contracts/research-contract-handoff.md) when composing a host.

## Requirements

Use Node **22.23.3** ([`.nvmrc`](.nvmrc), [`.node-version`](.node-version); package engines require Node 22), npm, Make and Python **3.9 or newer**. CI pins Python **3.11.17**. Linux integration routes require Linux and fail on unsupported platforms. TypeScript **7.0.2** and parser dependencies are locked in [`package-lock.json`](package-lock.json).

## Quickstart

From a checkout of this repository:

```sh
npm ci
node tools/install-typescript-host.mjs
npm run typecheck
make verify CASE=safe-retrieval MODE=mock
```

The helper installs the exact locked TypeScript host compiler for your platform, which is required because [`.npmrc`](.npmrc) omits optional packages. Runtime modules execute directly as ESM source; no separate build script is declared.

## Configuration

Offline checks use repository fixtures and require no provider credentials. `SafeFetcher` receives a URL and optional cancellation signal; its [`DEFAULT_RUN_LIMITS`](src/security/controlled-fetch.mjs) define request, redirect, time and byte ceilings. They are code constants, not environment-variable settings.

Private composition additionally requires host-controlled tenant scope, evidence encryption/storage, authorization and run policy. Asset acquisition is disabled unless the host supplies its versioned acquisition policy and one-use release authority; enabling it still does not establish asset rights or creative approval. See [controlled retrieval](docs/security/controlled-retrieval.md), [evidence storage](docs/evidence/provenance-store.md) and [private retrieval configuration](docs/discovery/private-retrieval.md#opt-in-controlled-svg-acquisition). No implicit credential discovery or production host is installed by this package.

## Checks

```sh
make verify CASE=safe-retrieval MODE=mock
make verify CASE=content-privacy MODE=mock
make verify CASE=eval-policy-unit MODE=unit
make verify CASE=research-api MODE=mock
make verify CASE=question-preparation MODE=mock
npm run test:runner
npm run typecheck
```

These are the checks in the [`verify` workflow](.github/workflows/verify.yml). They use local fixtures only: no deployment, provider connection or live retrieval. `make verify` fails unless every collected test runs and passes with none skipped. The Python route covers local policy and runner unit tests only; it is not the held-out benchmark or evidence that the policy is promotion-ready. Live mode and the reserved `evals` route stay fail-closed. All cases, Linux-only routes and the per-component CI workflows are listed under [verification routes](docs/components.md#verification-routes).

The `research-api` route checks copied candidate contracts against offline fixtures; it does not establish the accepted public API. The separate [installed 0.9.7 consumer diagnostic](docs/contracts/installed-research-consumer-0.9.7.md) requires its owner-pinned archive and retains an expected incompatibility hold. Consult [`tools/verify.mjs`](tools/verify.mjs) for the executable route inventory. The package does not declare a separate lint script.

## Repository structure

| Path | Contents |
| --- | --- |
| [`src/security/`](src/security/), [`src/privacy/`](src/privacy/) | URL/DNS/transport controls and untrusted-content boundaries |
| [`src/discovery/`](src/discovery/), [`src/research/`](src/research/) | Bounded source frontier, identity and private retrieval composition |
| [`src/extraction/`](src/extraction/), [`src/evidence/`](src/evidence/) | Deterministic parsers, PDF support and provenance storage |
| [`src/review/`](src/review/), [`src/cache/`](src/cache/), [`src/decisions/`](src/decisions/) | Immutable corrections, scoped reuse and question preparation |
| [`tests/`](tests/), [`evals/`](evals/) | Synthetic component checks and evaluation-policy work |
| [`tools/`](tools/), [`.github/workflows/`](.github/workflows/) | Verification runners, compiler setup and per-component CI |
| [`docs/`](docs/) | Component limits, internal interfaces and pending handoff agreements |

## Docs

| Topic | Document |
| --- | --- |
| Inventory, pending work and checks | [Components, status and checks](docs/components.md) |
| Retrieval and privacy | [Controlled retrieval](docs/security/controlled-retrieval.md) · [Content privacy boundary](docs/privacy/content-boundary.md) |
| Discovery | [Private retrieval lifecycle](docs/discovery/private-retrieval.md) · [Bounded frontier](docs/discovery/bounded-frontier.md) |
| Extraction and evidence | [Deterministic extraction](docs/extraction/README.md) · [Text-PDF reader limits](docs/extraction/text-pdf.md) · [Evidence and provenance](docs/evidence/provenance-store.md) |
| Evaluation policy | [JEV promotion](docs/decisions/jev-promotion.md) · [Offline normalized results](docs/evals/offline-normalized-results.md) |
| Cross-repository handoffs | [Handoff checker](docs/contracts/handoff-checker.md) · [Research contract](docs/contracts/research-contract-handoff.md) · [Consumer](docs/contracts/consumer-handoff.md) |
| Ownership and acceptance | [Responsibilities and interfaces](docs/architecture/OWNERSHIP.md) · [Acceptance criteria](docs/architecture/ACCEPTANCE.md) |
| Architecture and plan | [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md) |

The architecture documents describe intended boundaries. They do not establish completed product functionality, passing implementation tests, connected sponsor tools or live financial activity.

## Related repositories

- [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts): proposed research schemas; no local canonical schema is defined here.
- [agent-harness](https://github.com/Jevelopers-neatHack-2026/agent-harness): workflow runtime and trace transport.
- [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine): intended consumer of research packages.
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): metering, budgets and ledger.
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals): the master acceptance checklist.

## Contributing

Read [AGENTS.md](AGENTS.md) and follow the organization [contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Keep tests on local fixtures and never commit credentials or customer data. Record source revisions and distinguish component, candidate-contract and release evidence in PRs.

## License

No license file is present in this repository; no license terms are asserted here.
