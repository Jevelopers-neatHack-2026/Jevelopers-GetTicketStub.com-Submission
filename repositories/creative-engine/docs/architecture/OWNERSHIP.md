# `creative-engine`

**Repository status:** Verified existing on GitHub, private, October 10, 2026.
**Proposed owner:** Creative and fulfillment.
**Delivery state:** Architecture plan; implementation criteria remain planned until evidence is recorded.

## Responsibility

Transform approved research and customer direction into artwork and traceable revisions. Own creative briefs, image-provider integration, generation and editing strategies, reference selection, and immutable design versions. GPT Image is the proposed initial provider family; select the exact model and configuration at kickoff.

Exact event text, personalized typography, print dimensions, and production validation belong to `print-production`. The customer application owns approval. A preview requires customer approval and production checks before printing.

## Planned internal modules

- `src/planning/`: Creative briefs and design strategies.
- `src/models/`: Image-provider adapters and routing.
- `src/generation/`: Initial concepts and artwork generation.
- `src/editing/`: References, masks, and scoped revision requests.
- `src/controls/`: Validated schemas describing supported customer controls.
- `src/versions/`: Parent links, asset metadata, and version comparisons.
- `src/storage/`: Immutable artwork objects and access references.

## Dependencies and handoff

Consume research from `event-intelligence` and interfaces from `shared-contracts`. Perform billable calls through `cost-intelligence` metering and budget authority. Emit separate attempt identifiers for actual retries; duplicate observations of one attempt must remain reconcilable. Return versioned results through `agent-harness` for customer review.

## P0 demo slice

Generate one artwork concept, apply one customer-requested revision, and retain both versions with their lineage, inputs, provider metadata, and available usage evidence. Hand the selected immutable version to production.

## Acceptance boundary

- [ ] Each revision identifies its parent and source assets.
- [ ] Required asset permissions are checked before the relevant use.
- [ ] Unsupported controls and malformed edit requests are rejected.
- [ ] Usage gaps remain visible and costs retain their estimate status.
- [ ] Approved versions cannot be silently overwritten.
- [ ] Production receives the exact version selected by the customer.

[Architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md) · [Acceptance checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md).

## Acceptance and contributor handoff

Use the [repository acceptance view](ACCEPTANCE.md) and [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md). Interfaces are specified in the [maintained contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md). Preserve local contributor and agent instructions; follow the [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.
