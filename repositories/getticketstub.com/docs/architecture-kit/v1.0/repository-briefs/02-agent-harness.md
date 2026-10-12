# `agent-harness`

**Repository status:** Existing name supplied by the team.  
**Proposed owner:** Agent and research.  
**Delivery state:** Planning only; all checks pending.

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

[Architecture](../docs/architecture.md) · [Acceptance checklist](../planning/acceptance-checklist.md).
