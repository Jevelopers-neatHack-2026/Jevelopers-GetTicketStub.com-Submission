# `fulfillment-connectors`

**Repository status:** Verified existing on GitHub, private, October 10, 2026.
**Proposed owner:** Creative and fulfillment.
**Delivery state:** Architecture plan; implementation criteria remain planned until evidence is recorded.

## Responsibility

Normalize print-provider capabilities, quotes, order submission, and delivery status. Own supplier adapter validation, external submission attempts, provider request identifiers, and external status normalization.

`getticketstub.com` owns verified customer authorization and the customer order lifecycle. The harness coordinates work. This repository checks that its submission prerequisites are satisfied and reports external outcomes without creating a competing commercial state machine.

## Planned internal modules

- `src/providers/`: One selected provider adapter and a deterministic simulator.
- `src/catalog/`: Product capabilities and production requirements.
- `src/quoting/`: Currency, production, shipping, tax, and quote expiry.
- `src/submission/`: Authorization checks and external request attempts.
- `src/idempotency/`: Stable request identity and uncertain-outcome handling.
- `src/status/`: Polling, webhook verification, and normalized external updates.
- `src/recovery/`: Bounded failure handling and escalation.

## Dependencies and handoff

Consume contracts, verified production bundles, and application-issued authorization. Report charges and billable attempts to `cost-intelligence`. Distinguish quotes, accepted orders, and actual charges. After an ambiguous timeout, resolve the existing submission where possible before deciding whether another submission is safe.

## P0 demo slice

Obtain one provider sandbox quote and submit an explicitly authorized sandbox order when a suitable sandbox is available. Use the simulator for deterministic failure and recovery evidence, labeling simulated outcomes throughout the demonstration.

## Acceptance boundary

- [ ] Submission binds the approved artifact, quote terms, and authorization.
- [ ] Repeated delivery of the same command cannot create duplicate orders.
- [ ] Uncertain external outcomes remain visible until resolved.
- [ ] Provider status events are validated and deduplicated.
- [ ] Sandbox and live operations remain distinguishable in reporting.
- [ ] Charges retain their original currency and confirmation status.

[Architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) · [Acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

## Acceptance and contributor handoff

Use the [repository acceptance view](ACCEPTANCE.md) and [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md). Interfaces are specified in the [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md). Preserve local contributor and agent instructions; follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.
