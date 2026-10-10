# fulfillment-connectors

Supplier quote normalization, external submission attempts, and status observations.

## Implementation status

This branch contains a local worker-runtime foundation candidate with deterministic private fixtures. It has no selected production provider adapter, accepted upstream schema pins, cross-repository conformance reports, or live mode. Sandbox and release verification therefore remain blocked; the candidate does not establish completion of FC-01.

See [runtime design, evidence scope, and exact verification commands](docs/runtime.md).

## Architecture and delivery

- [Repository responsibilities and interfaces](docs/architecture/OWNERSHIP.md)
- [Relevant acceptance criteria](docs/architecture/ACCEPTANCE.md)
- [Architecture reference](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md)
- [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md)

The CI workflow builds and tests only the local foundation and records no provider activity. Architecture integration documents the intended boundaries; it does not establish connected sponsor tools or live financial activity.
