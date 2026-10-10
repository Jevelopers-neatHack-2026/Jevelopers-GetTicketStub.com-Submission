# `agent-harness`

**Repository status:** Verified existing on GitHub, private, October 10, 2026.
**Proposed owner:** Agent and research.
**Delivery state:** Architecture plan; implementation criteria remain planned until evidence is recorded.

## Responsibility

Coordinate the agent's research, creative work, production checks, and fulfillment requests. Own durable execution state, typed action selection, bounded retries, cancellation, recovery, and operational tracing. Specialist modules can execute in the same background worker through agreed interfaces.

The harness records what a workflow is doing and why. The customer application remains authoritative for customer order state and verified authorization; `cost-intelligence` remains authoritative for spending and reservations. Avoid separate copies of those business rules.

## Planned internal modules

- `src/orchestrator/`: Planning, scheduling, and execution transitions.
- `src/state/`: Checkpoints, persistence, resume, and cancellation.
- `src/decisions/`: Typed actions and validation.
- `src/policy/`: Tool permissions, escalation, and execution limits.
- `src/adapters/`: Research, creative, production, fulfillment, and cost interfaces.
- `src/observability/`: Neatlogs instrumentation and correlation metadata.

## Dependencies and handoff

Consume `shared-contracts` and specialist capabilities through their public interfaces. Receive authenticated project requests from `getticketstub.com`. Check budget authority before billable work and emit per-attempt usage identifiers through the metering protocol. Link execution attempts to the customer operation without treating their states as interchangeable.

## P0 demo slice

Complete one event-to-approved-artwork journey, accept one requested revision, and demonstrate recovery from one controlled provider failure. Persist sufficient state to resume an interrupted run without repeating a completed purchase.

## Acceptance boundary

- [ ] Allowed action transitions and stop conditions are explicit.
- [ ] Recovery preserves approved versions and completed external effects.
- [ ] Retries are bounded and separately attributable when billable.
- [ ] Traces connect decisions, tool attempts, and final verification.
- [ ] Missing authorization or budget authority blocks the dependent action.

[Architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) · [Acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

## Acceptance and contributor handoff

Use the [repository acceptance view](ACCEPTANCE.md) and [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md). Interfaces are specified in the [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md). Preserve local contributor and agent instructions; follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.
