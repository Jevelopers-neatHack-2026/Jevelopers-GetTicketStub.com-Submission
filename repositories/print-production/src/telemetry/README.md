# telemetry

Immutable local staged observations and a durable outbox are implemented in
observations.ts. See [durability](../../docs/durability/README.md).
These are not UsageEvent or a ledger. Canonical mapping, real finance intake,
EvaluationEvidence and Neatlogs remain blocked.

`evidence-page.ts` is a read-only adapter over `ObservationOutbox.list`. It
returns a deterministic page (`pp.telemetry.staged-observation-page` v1) whose
envelope states the data is local, staged, unmapped and non-authoritative, with
an allowlisted observation projection (observation/operation/execution-attempt/
job/publication references; measured or unknown metrics as recorded;
environment=local, billingMode=unclassified, producerBuildDigest=null). The
SHA-256 `integrity.payloadDigest` commits to the canonical (sorted-key) JSON of
everything except `integrity`; `verifyEvidencePage` rechecks it and returns false for malformed pages. Canonicalization
fails closed (`INVALID_INPUT`) on non-JSON data such as undefined, non-finite
numbers, sparse arrays, accessors or cycles, and metrics are projected field by
field so unexpected runtime properties never reach evidence. Pagination uses
a scope-bound `nextCursor`. Delivery status is not included
(`deliveryStatus: "not_included"`); the adapter reads observations only and
makes no delivery claim. The digest is a local integrity check, not a signature
or approved receipt; the adapter never mutates the outbox, and does not derive tenant, project
or build from the scope digest. `scopeDigest` exports no raw tenant/project, but
it is an ordinary guessable SHA-256 routing hash: it gives neither anonymization
nor authentication. Request and row-key digests are not exported (unkeyed hashes
permit dictionary and cross-scope equality disclosure); private joins stay in
the DB. `verifyEvidencePage` also enforces the strict envelope (exact keys and
fixed provenance values) so a forger who recomputes the digest is still
rejected; it is not authority, and there are no signatures or keys.
