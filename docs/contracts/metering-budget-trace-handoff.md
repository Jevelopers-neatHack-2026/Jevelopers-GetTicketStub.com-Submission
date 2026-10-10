# EI-X02: metering, budget and trace handoff

**Local requirements:** EI-11, JEV-EI-05. **Acceptance contribution:** FIN-01/02/03/04/08, BUD-01/02/03 and SPN-01, all under Finance and reliability. **Local owner role:** Agent and research. Named reviewers remain unassigned. The checker expects the narrow protocol and fixtures; it does not implement a ledger, allocation policy or Neatlogs transport.

Finance and reliability owns reservation state, the ledger and shared research allocation. Harness owns trace transport. EI emits usage observations and reuse lineage. The protocol must be reviewed by Finance and the harness owner and pinned to the exact contract revision. Closure of an umbrella or a runtime issue is not evidence that these artifacts exist.

## Proposed protocol fields and trust boundary

These are review prompts, not an accepted schema. Agree the names and transition semantics with the owners before publishing exports:

- Reservation identity, tenant/project/budget scope, capacity amount and currency, rate-card version/effective date, owner, decision and safe error.
- Pre-dispatch authorization tied to a reservation and operation. Revalidate permission immediately before dispatch; a declined or revoked reservation blocks the call.
- Separate `logical_operation_id`, `billable_attempt_id`, `transport_attempt_id`, `provider_request_id`, emitted `event_id` and usage-observation identity. Define missing provider IDs and deduplication behavior.
- A provider billability map covering SDK retries, fresh inference, image/vision work and research calls. A new billable execution remains a distinct attempt even when it shares a logical operation.
- Consume, safe unused release, unknown in-flight outcome, acknowledgement, durable delivery, retry, reconciliation and recovery semantics. A worker lease timeout, cancellation, restart or trace outage never releases unresolved financial capacity by itself.
- Valuation distinguishes `unknown`, `estimated` and `provider_confirmed`; exact amounts use explicit currency and rate-card provenance. Unknown cost is null/unknown, never zero. EI reuse points to the original usage record; Finance supplies allocation evidence separately.

## Required reference fixtures

The manifest requires competition for the final capacity, a declined reservation blocking dispatch, duplicate direct/trace observation deduplication, retention of a new billable attempt, timeout/cancel/restart holds through reconciliation, safe release of known unused pre-dispatch capacity, cache reuse without a duplicate research charge, and durable trace delivery or fail-closed dispatch during outage.

Creative main `65b8036194b3b962e1fd34f7193d54791cf07c88` contains a local metering proposal and fake-authority tests. Those remain owner-review-required and do not establish the Finance protocol or runtime authority. Harness PR25 head `b3a18bb4748e0cabe39e392973658a5e20b2d97e` merged as main `29a9e2084e6d14c2cf35c7f4297c66687c1f32e5`; it adds internal durability plumbing but does not establish public compatibility, provider dispatch, reservations or Neatlogs.
