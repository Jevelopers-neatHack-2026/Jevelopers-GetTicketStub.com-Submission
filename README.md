# fulfillment-connectors

Supplier quote normalization, external submission attempts, and status observations.

## Implementation status

This branch contains a local worker-runtime foundation candidate with deterministic private fixtures. It has no selected production provider adapter, accepted upstream schema pins, cross-repository conformance reports, or live mode. Sandbox and release verification therefore remain blocked; the candidate does not establish completion of FC-01.

The provider-neutral FC-11 security helpers and synthetic policy fixtures are exported and run by the local security verifier. They cover scoped reference access, payload minimization, diagnostics, injected secret and asset ports, tombstone creation, and callback hints. They do not supply production encryption, a secret manager, a pinned network transport, provider callback authentication, persistent replay storage, or accepted upstream SC8; sandbox and release security evidence remain pending. See [security boundary and limits](docs/security.md).

See [runtime design, evidence scope, and exact verification commands](docs/runtime.md).

The [FC-02 provider and environment matrix](docs/provider-matrix.md) records official Prodigi v4 documentation observations separately from local fixtures, account access, selected-product decisions, and implemented support. The simulator remains offline; sandbox and release checks remain blocked until owner evidence and an adapter exist.

The private FC-03 catalog normalizer is exported from the package root and covered by `npm test` / `npm run test:catalog`. Its simulated evidence command is `npm run verify:catalog`; it reports local fixture results while keeping canonical schema pins, print-production review, sandbox readiness, and release readiness separate. See [catalog field semantics and evidence limits](docs/catalog.md).

The deterministic FC-02 mock adapter is compiled for local runtime tests and covered by `npm test` / `npm run verify:mock`. It exercises simulated provider behavior, restart snapshots, and runtime observations through the local durable metering outbox; its synthetic authorization, budget, and contract fixtures do not establish provider sandbox, finance, or release readiness. See [simulator behavior and evidence limits](docs/simulator.md).

## Architecture and delivery

- [Repository responsibilities and interfaces](docs/architecture/OWNERSHIP.md)
- [Relevant acceptance criteria](docs/architecture/ACCEPTANCE.md)
- [Architecture reference](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md)
- [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md)

The CI workflow builds and tests only the local foundation and records no provider activity. Architecture integration documents the intended boundaries; it does not establish connected sponsor tools or live financial activity.
