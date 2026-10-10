# EI-X01: research contract handoff

**Local requirements:** EI-01, EI-06, EI-07, JEV-EI-01, JEV-EI-02. **Acceptance contribution:** CON-01, CON-02, CON-03. **Owner role:** Agent and research. Named owner and reviewer remain unassigned. The local handoff is blocked until narrow versioned exports, reviewed pins and executed fixture evidence are available.

This document and the checker crosswalk are expectations for the external owners. They do not define `ResearchRequest`, `EventIntelligencePackage`, `DecisionPort`, approval tokens or any other wire schema. The maintained catalog remains proposed design. No local canonical schema is authorized.

## Exact external delivery

Shared-contracts, harness, creative and Product owners should review the same narrow crosswalk and fixture set. Deliver separately identifiable versioned exports for ResearchRequest, EventIntelligencePackage, progress/request-answer-batch receipts, safe typed errors, corrections and invalidations; a contract-only injected DecisionPort; producer and consumer bindings; and a trusted scope/approval interface. Pin each deliverable to a full commit. The port belongs in the contract layer; an engine must not import the complete harness package. The checker lists each deliverable separately so a partial package cannot hide a missing schema behind one bundle entry.

The required review roles are Agent and research as producer, Creative and fulfillment as consumer, and Product and frontend for authenticated identity and approval authority. Review acknowledgements must bind those roles to the exact schema revision and fixture digests. The checker currently cannot authenticate those acknowledgements.

## Crosswalk questions owners must resolve

The common envelope fields named by the audit are `schema_version`, `event_id`, `tenant_id`, `project_id`, `correlation_id`, `occurred_at`, `ingested_at`, `environment`, `billing_mode` and `source_refs`. Record the producer/build revision, but let the schema owner settle its exact field spelling. `event_id` identifies an emitted event; it is not the occurrence identity or package identity. Distinguish `logical_operation_id`, `billable_attempt_id`, `transport_attempt_id`, `provider_request_id` and source observation identity. Provider request IDs may be absent.

Resolve the `EventIntelligencePackage`/`ResearchPackage` alias; workflow/run/package/version/hash/parent references; and the exact fields for permitted assets, correction, invalidation and request/answer/batch receipts. `permittedAssets` is only a prose term. It is not an accepted wire alias. Do not infer field names for the undecided entries in the manifest.

The agreed fixtures must carry sourced facts and uncertainty; source and transformed asset hashes; authenticated approval issuer, audience, actor, tenant, project, asset version, hash, intended use, expiry and revocation; source retention/access policy; decision, usage and trace references; and duplicate/out-of-order invalidation identity. Generated producer and consumer bindings must serialize the same canonical fixture and compare bytes or hashes where applicable.

## Required cases

- Parse valid Choice, Score and Noul values; reject missing fields, extra capabilities, invalid enums/probabilities and a Noul confidence field. Choice and Score retain their recorded fields. EI v1 Score criteria and legend stay strings until the official discrepancy is decided.
- Record the official Score-legend documentation discrepancy decision with producer/consumer review; do not change the string-only EI v1 rule before that decision is pinned.
- Preserve the reviewed rule for supported old minor versions and additive fields. An unsupported major version returns `UNSUPPORTED_SCHEMA` with supported versions.
- Verify dependency direction: engines use the contract layer, harness may import engines, and no engine imports the harness package. Timeout, abstention and malformed results cannot expand eligible capabilities.
- Run dependent identity and support questions in separate stages with immutable state/question IDs and no sibling-answer reads.
- Reject forged issuers, wrong tenant/project/asset hash/version/use, expired or revoked approval, transformed-byte approval reuse and boolean-only claims through the agreed trusted mechanism.
- Retain facts, uncertainty, source policy, provenance and decision/usage/trace references; reject alias drift, missing version/hash and confused operation, attempt, event and observation identities.

The currently published creative proposal at commit `65b8036194b3b962e1fd34f7193d54791cf07c88` has local package and Choice/Score/Noul validators. Its canonical owner agreements remain pending. This is a useful compatibility target, not accepted shared schema, generated producer binding or approval authority.
