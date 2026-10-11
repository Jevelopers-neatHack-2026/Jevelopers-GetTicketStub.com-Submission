<a href="https://github.com/Jevelopers-neatHack-2026/agent-harness">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/readme/banner-night.svg">
    <img alt="agent-harness — Durable workflow execution and recovery. TicketStub banner showing a track of punched checkpoints with a loop-back arrow for recovery." src="docs/assets/readme/banner-day.svg" width="100%">
  </picture>
</a>

# agent-harness

Durable workflow execution and recovery for the TicketStub agents, built as an experimental internal runtime on Node 22 and SQLite.

<p>
  <a href="https://github.com/Jevelopers-neatHack-2026"><img alt="TicketStub ecosystem" src="https://img.shields.io/badge/TicketStub-ecosystem-E4572E?style=flat-square&labelColor=17140F"></a>
  <a href="#status"><img alt="Status: experimental internal foundation" src="https://img.shields.io/badge/status-experimental%20foundation-B4693E?style=flat-square&labelColor=17140F"></a>
  <a href=".node-version"><img alt="Node.js 22.23.3" src="https://img.shields.io/badge/node-22.23.3-26302A?style=flat-square&labelColor=17140F"></a>
  <a href="docs/decisions/runtime-foundation.md#runtime-and-package"><img alt="Storage: node:sqlite" src="https://img.shields.io/badge/storage-node%3Asqlite-7CC6D2?style=flat-square&labelColor=17140F"></a>
</p>

[Status](#status) · [Quickstart](#quickstart) · [Checks](#checks) · [Docs](#docs) · [Related](#related-repositories)

## Status

An experimental internal runtime foundation is implemented on the pinned Node 22.23.3 toolchain. The package `@jevelopers/agent-harness-runtime` is private and unpublished.

Implemented locally, with offline tests:

- Strict local runtime configuration and safe typed errors. `mode: "live"` is rejected.
- File-backed SQLite workflow durability primitives on Node's built-in `node:sqlite`: checkpoints, worker fencing, recovery receipts, immutable bytes and a transactional event outbox ([runtime foundation](docs/decisions/runtime-foundation.md)).
- A private bounded local controller with plan, registry, limit and recovery-classification mechanics ([bounded runtime](docs/decisions/bounded-internal-runtime.md)).
- Redacted internal telemetry, with offline mapping through the pinned `neatlogs` 1.1.28 SDK into a local collector ([telemetry evidence](docs/evidence-and-provenance.md), [SDK conformance](docs/decisions/neatlogs-sdk-conformance.md)).
- A private JEV wire adapter tested only against synthetic, offline responses ([provider conformance](docs/decisions/provider-conformance.md)).

Not implemented: canonical public ports, provider dispatch, financial authority, budgets or ledger, live Neatlogs ingestion, Entire, or a production workflow.

Pending: AH-01 and AH-03 acceptance needs canonical fixtures, consumer agreement, cross-repository compatibility, server runtime confirmation and integrated evidence. [AH-01 #7](https://github.com/Jevelopers-neatHack-2026/agent-harness/issues/7) and [AH-03 #9](https://github.com/Jevelopers-neatHack-2026/agent-harness/issues/9) stay open until those gates pass.

## Quickstart

Requires Node **22.23.3** ([`.node-version`](.node-version); `engines` accepts `>=22.23.3 <23`). Every Make target checks the Node version first.

```sh
npm ci --ignore-scripts --no-audit --no-fund
make check
python3 .github/scripts/run_ops_owned_command.py --route runtime-foundation
```

Already have the locked packages in your npm cache? `make bootstrap` installs offline and builds in one step. Toolchain pins, the full verification case list and CI details are in the [runtime setup runbook](docs/runbooks/runtime-setup.md).

## Checks

All checks run offline in mock mode and call no provider.

```sh
make check                # syntax, entrypoint and SDK import, strict typecheck
python3 .github/scripts/run_ops_owned_command.py --route runtime-foundation
                           # offline runtime tests with OPS process and registry ownership
make neatlogs-sdk-test    # Neatlogs SDK local-capture tests only
make verify CASE=AH-03 MODE=mock FIXTURE=state-crash-matrix
make verify CASE=ACV1-AH05 MODE=mock FIXTURE=jev-phase-b-offline
python3 tools/verify_provider_readiness.py --profile fixtures/provider-profile.json --mode offline
```

Each `make verify` case prints its scope and is internal prerequisite evidence only; unsupported cases exit `2`. The provider readiness fixture is deliberately incomplete and is expected to exit `2` (pending). See the [runbook](docs/runbooks/runtime-setup.md#named-verification-cases) for all seven cases.

Run the two AH-11-OPS fixtures through the same owner so their detached process groups, private registry and cleanup receipts are reconciled:

```sh
python3 .github/scripts/run_ops_owned_command.py --route ops-quota-shutdown-restart
python3 .github/scripts/run_ops_owned_command.py --route ops-runbook-clean-start
```

The owner accepts only these fixed routes. Do not run `npm test` or either AH-11-OPS fixture directly; each route needs the fresh registry and private temporary directory that the owner creates.

## Docs

| Topic | Document |
| --- | --- |
| Setup, checks and CI | [Runtime setup and verification](docs/runbooks/runtime-setup.md) |
| Runtime, durability and remaining gates | [Runtime foundation decision](docs/decisions/runtime-foundation.md) |
| Bounded local controller | [Bounded private runtime](docs/decisions/bounded-internal-runtime.md) |
| Telemetry | [AH-10 telemetry evidence](docs/evidence-and-provenance.md) · [Neatlogs SDK conformance](docs/decisions/neatlogs-sdk-conformance.md) |
| JEV adapter | [Provider wire conformance](docs/decisions/provider-conformance.md) |
| Provider access profile | [Provider access readiness](docs/runbooks/provider-access.md) |
| Ownership and acceptance | [Responsibilities and interfaces](docs/architecture/OWNERSHIP.md) · [Acceptance criteria](docs/architecture/ACCEPTANCE.md) |
| Architecture and plan | [Architecture kit v1.0](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/README.md) · [Central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md) |

The architecture documents describe intended boundaries. They do not establish completed product functionality, passing implementation tests, connected sponsor tools or live financial activity.

## Related repositories

- [shared-contracts](https://github.com/Jevelopers-neatHack-2026/shared-contracts): proposed contract catalog; canonical ports are not yet generated.
- [event-intelligence](https://github.com/Jevelopers-neatHack-2026/event-intelligence) and [creative-engine](https://github.com/Jevelopers-neatHack-2026/creative-engine): intended consumers of this runtime; conformance is pending.
- [cost-intelligence](https://github.com/Jevelopers-neatHack-2026/cost-intelligence): pricing, budgets and ledger, which this runtime does not implement.
- [integration-evals](https://github.com/Jevelopers-neatHack-2026/integration-evals): cross-component verification.

## Contributing

Follow the organization [contributor guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Keep tests offline and in mock mode, and never commit credentials or `.env` files.
