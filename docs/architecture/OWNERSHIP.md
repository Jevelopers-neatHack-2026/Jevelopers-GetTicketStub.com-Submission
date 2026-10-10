# `event-intelligence`

**Repository status:** Verified existing on GitHub, private, October 10, 2026.
**Proposed owner:** Agent and research.
**Delivery state:** Architecture plan; implementation criteria remain planned until evidence is recorded.

## Responsibility

Turn an event URL into a reusable, sourced Event Intelligence Package. Own source discovery, factual extraction, conflict handling, event identity, asset candidates, and research caching.

Keep sourced facts, model inferences, customer corrections, and unresolved questions distinguishable. Record evidence origins and retrieval times. Publicly discovered images remain asset candidates until the applicable permission and approval process is satisfied.

## Planned internal modules

- `src/discovery/`: URL classification, source discovery, and event identity.
- `src/providers/`: Web, structured-data, and optional event-provider adapters.
- `src/extraction/`: Event details, venues, organizers, and performers.
- `src/brand-research/`: Asset candidates, typography, and palette references.
- `src/verification/`: Provenance, conflicts, freshness, and permission metadata.
- `src/security/`: URL validation and constrained fetching.
- `src/cache/`: Reusable research packages and invalidation rules.

## Dependencies and handoff

Consume `shared-contracts` and the metered client from `cost-intelligence`. Return research packages to `agent-harness` and `creative-engine`. Reused research retains its original expenditure record; attribution across customer orders must follow the agreed allocation policy instead of creating duplicate expenses.

## P0 demo slice

Research one supported event page, preserve references for essential facts, expose one conflicting or missing field, and deliver an approved asset set or a clearly identified original-artwork fallback.

## Acceptance boundary

- [ ] Essential event facts are traceable to evidence or explicit customer input.
- [ ] Untrusted page content cannot expand tool permissions.
- [ ] Fetching enforces the agreed network and redirect boundaries.
- [ ] Conflicts and unavailable facts remain visible to downstream consumers.
- [ ] Cached reuse preserves provenance and avoids duplicate expense creation.
- [ ] Asset permission status is carried into creative handoff.

[Architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) · [Acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

## Acceptance and contributor handoff

Use the [repository acceptance view](ACCEPTANCE.md) and [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md). Interfaces are specified in the [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md). Preserve local contributor and agent instructions; follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.
