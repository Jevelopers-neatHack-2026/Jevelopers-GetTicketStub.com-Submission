# `integration-evals`

**Repository status:** Proposed addition; creation is not claimed.  
**Proposed owner:** Finance and reliability.  
**Delivery state:** Planning only; all checks pending.

## Responsibility

Own reproducible product evaluations and evidence supporting delivery claims. Cover the customer journey, compatibility, recovery, artifact integrity, and financial correctness. Use synthetic or approved fixtures.

Repository-local tests remain with their implementations. Verify behavior across ownership boundaries and record component revisions, configuration, and provider modes. Planned checks do not establish implementation success.

## Planned internal modules

- `fixtures/`: Event pages, assets, customer inputs, and financial observations.
- `scenarios/`: Research, revision, approval, production, and fulfillment journeys.
- `failures/`: Timeouts, duplicate events, interruptions, and budget contention.
- `benchmarks/`: Before-and-after protocols and metric definitions.
- `replay/`: Preserved inputs and repeatable execution guidance.
- `evidence/`: Sanitized Neatlogs, Entire, and CFO.ai references.
- `reports/`: Results, limitations, and unresolved failures.

## Dependencies and handoff

Run against the pinned integration workspace assembled by `getticketstub.com`. Coordinate compatibility fixtures with `shared-contracts` and expected money behavior with `cost-intelligence`. Supply reviewable evidence to `marketing-material` and the submission entry point. Treat development provenance, runtime traces, and financial scenarios as distinct evidence sources.

## P0 demo slice

Verify one complete synthetic order journey, one controlled recovery, and one financial reconciliation. Compare a defined baseline with an improvement using consistent inputs and declared measurement conditions. Preserve evidence links and reproduction instructions.

## Acceptance boundary

- [ ] Each report identifies the tested release and provider mode.
- [ ] A complete journey includes approval, artifact verification, and cost attribution.
- [ ] Replayed observations do not duplicate orders or expenses.
- [ ] Interrupted and uncertain operations exercise the agreed recovery behavior.
- [ ] Improvement claims include baseline, method, result, and limitations.
- [ ] Published evidence is accessible to intended reviewers and sanitized.

[Architecture](../docs/architecture.md) · [Acceptance checklist](../planning/acceptance-checklist.md).
