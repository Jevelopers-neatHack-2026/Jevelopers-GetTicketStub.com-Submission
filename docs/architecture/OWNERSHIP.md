# `shared-contracts`

**Repository status:** Public GitHub repository, checked 2026-10-12 against [main at `91736a026c02a3206cb7666ebfbe6134692e5a24`](https://github.com/Jevelopers-neatHack-2026/shared-contracts/commit/91736a026c02a3206cb7666ebfbe6134692e5a24). This visibility check documents repository metadata; it does not change visibility or imply publication.
**Proposed owner:** Agent and research (repository role; named contract owners and reviewers remain unassigned).
**Delivery state:** Private candidate package 0.10.2 supplies 77 wire names across 88 schema versions, generated consumer bindings, standalone validators and offline fixtures alongside the receipt metadata checker and isolated reporting proposal. Named owner/reviewer acknowledgements, accepted consumer pins and release obligations remain separate. See [MVP readiness](../mvp-readiness.md); individual issue and PR records remain authoritative.

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

The JSON Schemas and synthetic fixtures under [`proposals/reporting-v1/`](../../proposals/reporting-v1/README.md) remain an isolated Finance-review proposal. They are not promoted into the canonical contract set. The receipt checker is governance tooling for recording and shape-checking evidence.

## Dependencies and handoff

Collect requirements from every producer and consumer. Each contract names its authoritative owner, schema version, required identifiers, and compatibility behavior. Distinguish a customer operation, execution attempt, provider request, and repeated observation so retries can be reconciled correctly.

## P0 demo slice (planned)

Agree the minimum contracts for one customer journey: request, research package, design version, production bundle, quote, authorization, usage observation, and financial summary. Pin a compatible contract version across the integration workspace.

## Acceptance boundary

Local fixture/schema results are contribution evidence. [Consumer handoff](../consumer-handoff.md), [producer findings](../../compatibility/owner-findings.json) and [proposal intake](../../compatibility/proposal-intake.json) record unresolved work. Historical architecture snapshots do not override the maintained catalog or imply an accepted endpoint API.

- [ ] Every initial producer and consumer agrees on required fields and errors.
- [ ] Unknown, estimated, and confirmed values have distinct representations.
- [ ] Monetary values preserve currency and an explicit precision convention.
- [ ] Breaking changes trigger a compatibility decision before integration.
- [ ] Validation rejects malformed input at agreed trust boundaries.
- [ ] Generated outputs are reproducible from the canonical definitions.

The unchecked items above are local planning prompts, not the status of the global checklist. See the [acceptance view](ACCEPTANCE.md) for the selected global criteria and [integration-evals' master checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) for authoritative IDs, owners, states, and evidence.

[Historical architecture intent](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) · [Acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

## Acceptance and contributor handoff

Use the [repository acceptance view](ACCEPTANCE.md) and [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md). Interfaces are specified in the [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md). Preserve local contributor and agent instructions; follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.
