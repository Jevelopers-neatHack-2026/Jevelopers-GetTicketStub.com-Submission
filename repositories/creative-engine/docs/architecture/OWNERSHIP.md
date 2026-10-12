# creative-engine ownership and implementation boundary

**Repository status:** Public on GitHub; verified October 12, 2026.
**Proposed owner:** Creative and fulfillment.
**Implementation state:** The private, unpublished Node.js package requires Node.js >=22.23.3 and contains a typed creative API, local controls, provider adapters, inspection, immutable version storage and telemetry. External contract acceptance, application identity and approval, finance authority, production provider access and rendering remain separate boundaries.

## Responsibility

Transform approved research and customer direction into artwork and traceable revisions. Own creative briefs, image-provider integration, generation and editing strategies, reference selection, and immutable design versions. Exact provider, model and configuration remain subject to owner selection and access approval.

Exact event text, personalized typography, print dimensions, and production validation belong to print-production. The customer application owns approval. A preview requires customer approval and production checks before printing.

## Current implementation surface

The ESM package exports versioned API, contracts, planning, versions, controls, inspection, models, telemetry and preflight subpaths. The API wraps injected job, storage, provider, research/rights, DecisionPort, metering, approval, inspection, handoff and telemetry ports; it is not a service or customer-facing application.

Local source implements brief planning; generate, edit, inspect, list, compare, restore, cancel and handoff operations; content-addressed artwork; an immutable SQLite version store and paired API/storage adapter; a durable local controls Apply outbox; deterministic inspection and bounded repair; and sanitized attempt-usage evidence. The controls subpath also contains local mock composition review, Apply, history and recovery, plus durable artwork-action recovery. See the [controls guides](../INDEX.md#controls-and-handoff) for their exact local evidence and open scope; these implementations do not establish app runtime integration, production-host qualification, live provider or Finance authority, external acceptance or gate closure. The paired adapter serializes operations by database-file identity within one Node process, commits selected version/job metadata together, and requires provider, Finance and other external I/O to finish outside its publication transaction; publication and synchronous final-fence callbacks run inside. Current mock fixtures include installed public-API process journeys, process-exit recovery and a separate SQLite busy-lock case. See the [state-persistence guide](../state-persistence.md) for the exact exercised scope and limits: these checks do not certify production-host durability, power-loss behavior, backup/restore, multi-host coordination or external integration. OpenAI Images and OpenRouter adapter modules have local checks. An offline check does not prove paid access, external-contract agreement, production rendering or deployment. Local API and controls surfaces do not replace accepted canonical interfaces; the C01-C04 schemas remain proposals until their owners accept them. Application authentication and approval issuance, finance authority and production renderer are not implemented here.

## Integration targets and handoff

Research and asset permissions are intended from event-intelligence. Billable calls require cost-intelligence authority and metering. Immutable versions are intended for print-production and app review through accepted contracts. Current app main does not import this package at runtime. Provider-access and execution-target guides describe gates, not authorization to make a live call.

## P0 target slice

Design intent: generate one artwork concept, apply one customer-requested revision, retain both versions with lineage, inputs, provider metadata and available usage evidence, then hand the selected immutable version to production.

## Acceptance boundary

- [ ] Each revision identifies its parent and source assets.
- [ ] Required asset permissions are checked before the relevant use.
- [ ] Unsupported controls and malformed edit requests are rejected.
- [ ] Usage gaps remain visible and costs retain their estimate status.
- [ ] Approved versions cannot be silently overwritten.
- [ ] Production receives the exact version selected by the customer.

The canonical current-state architecture describes implementation across repositories. The historical v1.0 architecture kit remains design intent: [current organization architecture](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture/CURRENT-STATE.md) · [v1.0 design intent](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/architecture-kit/v1.0/docs/architecture.md).

Use the [repository acceptance view](ACCEPTANCE.md) for criterion allocation only. Current criteria and evidence live in the [master checklist](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.md) and [JSON tracker](https://github.com/Jevelopers-neatHack-2026/integration-evals/blob/main/planning/acceptance-checklist.json). See the [central implementation plan](https://github.com/Jevelopers-neatHack-2026/getticketstub.com/blob/main/docs/planning/implementation-plan.md), [contract catalog](https://github.com/Jevelopers-neatHack-2026/shared-contracts/blob/main/docs/contract-catalog.md) and [organization contribution guidance](https://github.com/Jevelopers-neatHack-2026/.github/blob/main/CONTRIBUTING.md). Named owner and reviewer assignments remain kickoff decisions.

For a guide-by-topic list, see the [documentation index](../INDEX.md).
