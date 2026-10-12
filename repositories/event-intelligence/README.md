<a href="https://github.com/Jevelopers-neatHack-2026/event-intelligence">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="event-intelligence — Sourced event facts. TicketStub banner showing a magnifier over a stub whose facts link by dotted lines to source pins." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# event-intelligence

Sourced event facts and research cache for TicketStub, built as internal Node 22 components that keep every fact tied to its source.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: local foundation, internal components; integration pending" src="https://img.shields.io/badge/status-local%20foundation-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href=".nvmrc"><img alt="Node.js 22.23.3" src="https://img.shields.io/badge/node-22.23.3-26302A?style=flat-square&labelColor=17140F"></a>
  <a href=".github/workflows/verify.yml"><img alt="Python 3.11.17 in CI" src="https://img.shields.io/badge/python-3.11.17%20CI-7CC6D2?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Quickstart](#quickstart) · [Checks](#checks) · [Docs](#docs) · [Related](#related-repositories)

## Status

Implemented locally as private, internal components with offline tests:

- Controlled HTTP(S) retrieval that validates URL and DNS policy, pins connections to vetted addresses and bounds responses.
- A content privacy boundary that keeps untrusted content quarantined until a configured trusted review approves the public facts.
- Deterministic source extraction, a bounded text-PDF reader, and evidence storage with provenance.
- Source identity, a bounded source frontier, immutable correction history, scoped reuse cache, asset permission checks and JEV question preparation.
- A private retrieval lifecycle composing the frontier, retrieval, extraction, encrypted evidence store and source identity into a bounded private draft for an authorized host; it adds no public research API ([private retrieval](docs/discovery/private-retrieval.md)).

These do not establish the accepted public research request/response API or full issue acceptance. Still pending: public research API integration, complete source traversal, canonical fact selection, provider connections, live retrieval and release evidence, Finance/billing validation, production-host containment, and full screenshot/scanned-PDF inspection. Work is tracked under the [Agent & Creative v1 research epic (#1)](https://github.com/Jevelopers-neatHack-2026/event-intelligence/issues/1).

The full inventory, with source paths, reference docs and issues, is in [Components, status and checks](docs/components.md).

## Quickstart

Requires Node **22.23.3** ([`.nvmrc`](.nvmrc), [`.node-version`](.node-version)) and Python 3.9 or newer (CI pins 3.11.17).

```sh
npm ci
node tools/install-typescript-host.mjs
```

The helper installs the exact locked TypeScript 7.0.2 host compiler for your platform, which is required after optional packages are omitted.

## Checks

```sh
make verify CASE=safe-retrieval MODE=mock
make verify CASE=content-privacy MODE=mock
make verify CASE=eval-policy-unit MODE=unit
npm run test:runner
npm run typecheck
```

These are the checks in the [`verify` workflow](.github/workflows/verify.yml). They use local fixtures only: no deployment, provider connection or live retrieval. `make verify` fails unless every collected test runs and passes with none skipped. The Python route covers local policy and runner unit tests only; it is not the held-out benchmark or evidence that the policy is promotion-ready. Live mode and the reserved `evals` route stay fail-closed. All cases, Linux-only routes and the per-component CI workflows are listed under [verification routes](docs/components.md#verification-routes).

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

Follow the organization [contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Keep tests on local fixtures and never commit credentials or customer data.
