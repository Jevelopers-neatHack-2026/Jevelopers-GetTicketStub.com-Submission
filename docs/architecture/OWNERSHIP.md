# `shared-contracts`

**Repository status:** Verified existing on GitHub, public, October 10, 2026. Repository visibility is unchanged by this foundation.
**Proposed owner:** Agent and research.
**Delivery state:** Local package 0.5.0 supplies 45 candidate wire exports, generated bindings and offline fixtures. Named owners, accepted producer/consumer pins, pending API proposals and four finance correctness findings remain release blockers. Public GitHub visibility is distinct from npm's private/unreleased package setting.

## Responsibility

Own versioned interfaces connecting independently developed repositories. Define request, result, event, error, and validation contracts. Business behavior and provider implementations remain with their domain owners.

The shared package should remain dependency-light. It may distribute generated types and contract validators derived from canonical definitions. It should not become a general utility repository or hold competing versions of financial and commercial policy.

## Maintained package modules

- `schemas/<Contract>/<version>.json`: Canonical exact-version candidate interfaces for every maintained catalog export.
- `tooling/`: Pure structural, context, semantic and representative fixture helpers.
- `scripts/`: Deterministic generation, offline checks, actual source/archive/import binding and sanitized coverage.
- `generated/`: Reproducible consumer bindings and validators.
- `fixtures/`: Valid, invalid, and compatibility examples.
- `compatibility/`: Version policy and consumer impact records.

## Dependencies and handoff

Collect requirements from every producer and consumer. Each contract names its authoritative owner, schema version, required identifiers, and compatibility behavior. Distinguish a customer operation, execution attempt, provider request, and repeated observation so retries can be reconciled correctly.

## P0 demo slice

Agree the minimum contracts for one customer journey: request, research package, design version, production bundle, quote, authorization, usage observation, and financial summary. Pin a compatible contract version across the integration workspace.

## Acceptance boundary

Local fixture/schema results are contribution evidence. [Consumer handoff](../consumer-handoff.md), [producer findings](../../compatibility/owner-findings.json) and [proposal intake](../../compatibility/proposal-intake.json) record unresolved work. Historical architecture snapshots do not override the maintained catalog or imply an accepted endpoint API.

- [ ] Every initial producer and consumer agrees on required fields and errors.
- [ ] Unknown, estimated, and confirmed values have distinct representations.
- [ ] Monetary values preserve currency and an explicit precision convention.
- [ ] Breaking changes trigger a compatibility decision before integration.
- [ ] Validation rejects malformed input at agreed trust boundaries.
- [ ] Generated outputs are reproducible from the canonical definitions.

[Architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) · [Acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

## Acceptance and contributor handoff

Use the [repository acceptance view](ACCEPTANCE.md) and [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md). Interfaces are specified in the [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md). Preserve local contributor and agent instructions; follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.
