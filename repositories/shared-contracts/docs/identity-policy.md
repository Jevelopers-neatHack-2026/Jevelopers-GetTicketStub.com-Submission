# Identity and provenance policy

Candidate policy 1.0.0 awaits affected owner review. CommonEnvelope uses a required `contract` discriminator, matching the creative proposal's boundary requirement. It is a separate foundation contract; domain leaves reuse its primitive definitions and field rules with their own discriminators. No aliases are accepted. Consumer-local renames require an explicit versioned adapter and owner fixtures.

| Field | Assigning authority | Scope / uniqueness | Assignment | Retry / omission |
| --- | --- | --- | --- | --- |
| tenant_id | application identity authority | tenant / membership identity | authenticated adapter only; immutable | stable across all work; never in CommonEnvelope |
| project_id | getticketstub.com | tenant / project | authenticated adapter only; immutable | stable across journey; never in CommonEnvelope |
| workflow_id | agent-harness | tenant/project / workflow | server assigned; immutable | stable across resume; when not applicable; provider_request_id also permits explicit null |
| run_id | agent-harness | workflow / run | server assigned; immutable | new for new run; stable during resume; when not applicable; provider_request_id also permits explicit null |
| job_id | agent-harness | workflow/run / job | server assigned; immutable | stable on job redelivery; when not applicable; provider_request_id also permits explicit null |
| artifact_id | creative-engine/print-production | tenant/project / immutable artifact | server assigned; immutable | new artifact for changed content; when not applicable; provider_request_id also permits explicit null |
| design_id | creative-engine | tenant/project / design lineage | server assigned; immutable | stable across edits; when not applicable; provider_request_id also permits explicit null |
| design_version_id | creative-engine | design / immutable version | server assigned; immutable | new on edit; no latest aliases; when not applicable; provider_request_id also permits explicit null |
| order_id | getticketstub.com | tenant/project / order | server assigned; immutable | stable for supplier idempotency mapping; when not applicable; provider_request_id also permits explicit null |
| provider_request_id | provider through adapter | provider account/execution / provider-issued request | provider observation only; immutable | adapter declares reuse; omit or null when unavailable; when not applicable; provider_request_id also permits explicit null |
| trace_id | authenticated ingress/agent-harness | run / trace | server assigned; immutable | propagated; never authority; when not applicable; provider_request_id also permits explicit null |
| correlation_id | getticketstub.com/agent-harness | customer journey / journey correlation | server assigned; immutable | propagated; never authority; never in CommonEnvelope |
| evidence_id | integration-evals | evaluation run / evidence record | server assigned; immutable | stable for one record; public projection uses separate opaque synthetic/pseudonym ID; when not applicable; provider_request_id also permits explicit null |
| event_id | emitting domain owner | producer/tenant / emission | server assigned; immutable | stable on exact redelivery; new for superseding observation; never in CommonEnvelope |
| usage_event_id | metered module | tenant/provider execution / usage observation | server assigned; immutable | stable on duplicate observation; correction links new observation; when not applicable; provider_request_id also permits explicit null |
| logical_operation_id | getticketstub.com/agent-harness | tenant/project / requested operation | server assigned; immutable | stable across attempts; when not applicable; provider_request_id also permits explicit null |
| provider_attempt_id | provider adapter | logical operation / provider execution | server assigned; immutable | transport retries may reuse only under declared adapter mapping; when not applicable; provider_request_id also permits explicit null |
| billable_attempt_id | metered module under finance policy | logical operation / potentially billed execution | server assigned; immutable | new for separately billable execution; when not applicable; provider_request_id also permits explicit null |
| transport_attempt_id | agent-harness/provider adapter | provider execution / transport transmission | server assigned; immutable | new per transmission; no automatic new billable attempt; when not applicable; provider_request_id also permits explicit null |

Every UUID is lowercase with a supported UUID version and variant. UUID uniqueness remains the assigning service's responsibility; shape validation cannot detect collisions. Provider IDs use provider syntax rather than fabricated UUIDs. Distinct branded TypeScript types prevent accidental ID substitution. An adapter parses untrusted input, authenticates context outside this library, then supplies tenant/project and applicable immutable subject expectations to `checkTrustedContext`.

`producer.module`, exact `source_revision` and `build_revision` identify the producer. `schema_version` and `policy_version` identify wire and normative rules. `occurred_at` records the action, `observed_at` its observation, and `ingested_at` ingestion; they are UTC RFC3339-shaped times with zero or three fractional digits and valid Gregorian dates. They are distinct facts; this library infers no ordering across delayed clocks. `source_refs` contain opaque identifiers and optional exact content hashes, never storage URLs or credentials. References cannot grant access.

Omission and explicit null differ. Only provider_request_id permits null in this foundation. Missing IDs are not minted by a validator. ExactDecimal is a nonnegative decimal string preserving sub-cent precision and trailing scale; no exponent, leading zeros, float conversion, rounding or ledger arithmetic occurs here. Finance leaves define signed adjustments and rounding boundaries separately.

The synthetic trace tests propagate the same project, design/version, operation and attempts across research, creative, production and usage/evidence producers. This proves the foundation's preservation of IDs, while domain integration, persistence, deduplication and actual authorization remain downstream obligations under CON-02, AGT-01, FIN-01/02/03 and EVAL-01.
