# `shared-contracts`

**Repository status:** Proposed addition; creation is not claimed.  
**Proposed owner:** Agent and research.  
**Delivery state:** Planning only; all checks pending.

## Responsibility

Own versioned interfaces connecting independently developed repositories. Define request, result, event, error, and validation contracts. Business behavior and provider implementations remain with their domain owners.

The shared package should remain dependency-light. It may distribute generated types and contract validators derived from canonical definitions. It should not become a general utility repository or hold competing versions of financial and commercial policy.

## Planned internal modules

- `schemas/`: Projects, event intelligence, creative briefs, and design versions.
- `schemas/production-and-orders/`: Artifacts, quotes, authorization, and external status.
- `schemas/usage-and-finance/`: Metering, reservations, and reporting interfaces.
- `openapi/`: Agreed public and internal endpoint specifications.
- `generated/`: Reproducible consumer bindings and validators.
- `fixtures/`: Valid, invalid, and compatibility examples.
- `compatibility/`: Version policy and consumer impact records.

## Dependencies and handoff

Collect requirements from every producer and consumer. Each contract names its authoritative owner, schema version, required identifiers, and compatibility behavior. Distinguish a customer operation, execution attempt, provider request, and repeated observation so retries can be reconciled correctly.

## P0 demo slice

Agree the minimum contracts for one customer journey: request, research package, design version, production bundle, quote, authorization, usage observation, and financial summary. Pin a compatible contract version across the integration workspace.

## Acceptance boundary

- [ ] Every initial producer and consumer agrees on required fields and errors.
- [ ] Unknown, estimated, and confirmed values have distinct representations.
- [ ] Monetary values preserve currency and an explicit precision convention.
- [ ] Breaking changes trigger a compatibility decision before integration.
- [ ] Validation rejects malformed input at agreed trust boundaries.
- [ ] Generated outputs are reproducible from the canonical definitions.

[Architecture](../docs/architecture.md) · [Acceptance checklist](../planning/acceptance-checklist.md).
