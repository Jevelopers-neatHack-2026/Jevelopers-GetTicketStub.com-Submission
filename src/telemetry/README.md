# telemetry

Immutable local staged observations and a durable outbox are implemented in
observations.ts. See [durability](../../docs/durability/README.md).
These are not UsageEvent or a ledger. Canonical mapping, real finance intake,
EvaluationEvidence and Neatlogs remain blocked.

`evidence-page.ts` is a read-only adapter over `ObservationOutbox.list`. It
returns a deterministic page (`pp.telemetry.staged-observation-page` v1) whose
envelope states the data is local, staged, unmapped and non-authoritative, with
an allowlisted observation projection (observation/operation/execution-attempt/
job/row/publication references; measured or unknown metrics as recorded;
environment=local, billingMode=unclassified, producerBuildDigest=null). The
SHA-256 `integrity.payloadDigest` commits to the canonical (sorted-key) JSON of
everything except `integrity`; `verifyEvidencePage` rechecks it. Pagination uses
a scope-bound `nextCursor`. It is a local integrity check, not a signature or
approved receipt, never mutates the outbox, and does not derive tenant, project
or build from the opaque scope digest.
