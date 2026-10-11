# fulfillment-connectors

Supplier quote normalization, external submission attempts, and status observations.

## Implementation status

This branch contains a local worker-runtime foundation candidate with deterministic private fixtures. It has no selected production provider adapter, accepted upstream schema pins, cross-repository conformance reports, or live mode. Sandbox and release verification therefore remain blocked; the candidate does not establish completion of FC-01.

The provider-neutral FC-11 security helpers and synthetic policy fixtures are exported and run by the local security verifier. They cover scoped reference access, payload minimization, diagnostics, injected secret and asset ports, tombstone creation, and callback hints. They do not supply production encryption, a secret manager, a pinned network transport, provider callback authentication, persistent replay storage, or accepted upstream SC8; sandbox and release security evidence remain pending. See [security boundary and limits](docs/security.md).

See [runtime design, evidence scope, and exact verification commands](docs/runtime.md).

The [FC-02 provider and environment matrix](docs/provider-matrix.md) records official Prodigi v4 documentation observations separately from local fixtures, account access, selected-product decisions, and implemented support. The simulator remains offline; sandbox and release checks remain blocked until owner evidence and an adapter exist.

The private FC-03 catalog normalizer is exported from the package root and covered by `npm test` / `npm run test:catalog`. Its simulated evidence command is `npm run verify:catalog`; it reports local fixture results while keeping canonical schema pins, print-production review, sandbox readiness, and release readiness separate. See [catalog field semantics and evidence limits](docs/catalog.md).

The deterministic FC-02 mock adapter is compiled for local runtime tests and covered by `npm test` / `npm run verify:mock`. It exercises simulated provider behavior, restart snapshots, and runtime observations through the local durable metering outbox; its synthetic authorization, budget, and contract fixtures do not establish provider sandbox, finance, or release readiness. See [simulator behavior and evidence limits](docs/simulator.md).

The private FC-04 quote normalizer is exported from the package root and covered by `npm test` / `npm run test:quote`; its offline evidence command is `npm run verify:quote`. It obtains estimates only through an injected bounded quote port. It does not authorize submission, reserve a budget, or record an actual expense, and this repository includes no live provider adapter or network transport. The canonical shared-contracts #25 mapping, consumer conformance, and scoped persistence remain pending; sandbox and release readiness remain false. See [quote semantics and evidence limits](docs/quotes.md).

The private FC-07 status inbox is exported from the package root and covered by `npm test` / `npm run test:status`; its simulated fixture command is `npm run verify:status`. The local mapping, polling and correction policies, trusted-lookup port, and outbox remain development fixtures. Issue 13 remains open; canonical shared-contracts #27 mapping, authenticated provider lookup and callbacks, application consumer conformance, and finance, sandbox, and release acceptance remain pending. Format `fc-status-store/2` rejects the previous unsupported format; its local marker detects some inconsistent loss but does not authenticate coordinated rollback or complete directory loss. See [status evidence limits](docs/status.md).

The FC-06 attempt persistence implementation is exported from the package root for local development, exercised by `npm test` / `npm run test:attempt-store`, and reported by `npm run verify:attempt-store`. Its private JSON store supplies restart-safe local claims through the existing `AttemptPersistence` port and is tested with the deterministic simulator and synthetic authorization and budget ports. This is partial issue 11 evidence only: the issue remains open, with no canonical shared schema, issuer or finance authority, provider reconciliation or retry authority, transport-intent/CAS protocol, or production encrypted storage. Sandbox, live, and release readiness remain false. See [local attempt store semantics and limits](docs/attempt-store.md).

The private FC-09 quote comparison projection is exported from the package root and covered by `npm test` / `npm run test:comparison`; `npm run verify:comparison` writes its simulated evidence result. It preserves exact source quote terms and reports unknown or incompatible bases without ranking, choosing a provider, or submitting an order. Currentness uses one captured trusted clock value, so a consumer must recheck at use time. The shared-contracts #25 mapping and application consumer review remain pending; issue 14 stays partial/open, and sandbox, live, and release readiness remain false. See [comparison field semantics and evidence limits](docs/comparison.md).

## Architecture and delivery

- [Repository responsibilities and interfaces](docs/architecture/OWNERSHIP.md)
- [Relevant acceptance criteria](docs/architecture/ACCEPTANCE.md)
- [Architecture reference](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md)
- [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md)
- [Contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md)

The CI workflow builds and tests only the local foundation and records no provider activity. Architecture integration documents the intended boundaries; it does not establish connected sponsor tools or live financial activity.
