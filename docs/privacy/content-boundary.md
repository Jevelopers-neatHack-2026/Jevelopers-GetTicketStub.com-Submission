# Internal content and privacy boundary scaffold

Status: local EI-09 preparation work on an isolated branch. These Python types are implementation scaffolding only. They are not an accepted EI API, `ResearchRequest`, shared-contract schema, authenticated identity contract, durable privacy store, or evidence that the full application path has been integrated. EI-01/API work and producer/consumer contract review remain prerequisites to release verification.

## Ingestion boundary

`src/privacy/boundary.py` stores each raw source in a tenant-scoped private vault before processing. The `external_reference` field is retained only inside that private record. It never grants scope or appears in a derivative or diagnostic. The caller must build `TrustedTenantContext` from an authenticated application contract; constructing the type does not authenticate a browser, user, or tenant.

Processing is staged. `prepare(candidate_fields)` checks the input modality, validates a concrete dictionary against the local allowlist, checks that each candidate value appears in the normalized source text, and sanitizes the candidate values. It does not publish a result. `publish()` is the only step that creates a `SanitizedDerivative`. Cancellation before publication clears pending facts. `restart()` reads the same retained original under the same trusted tenant and carries its source reference and untrusted provenance tag into a new attempt.

Only these internal fact fields are currently admitted:

- `event_name`: string up to 180 characters.
- `event_date`: canonical ISO date (`YYYY-MM-DD`).
- `venue`: string up to 180 characters.

Unknown fields, wrong value types, invalid dates, values not present in the source, and empty field sets fail closed. The small deterministic sanitizer masks labeled attendee/contact names, email addresses, phone numbers, seat labels, admission/ticket/entry/QR codes, bearer tokens, and URLs. It records only fixed redaction category names. This is a limited pattern set, not comprehensive PII detection; the core never exports the raw text as a sanitized derivative.

HTML handling retains visible text and drops script, style, and noscript content. `OCR_TEXT`, `PDF_TEXT`, and `PDF_METADATA` are already extracted UTF-8 strings from an upstream component; this module does not perform OCR or parse PDFs. Image bytes, binary/scanned PDFs, attendee CSV, invalid UTF-8, and unsupported modalities are quarantined without a derivative. No vision-based QR or image redaction is implemented or claimed.

## Scope and downstream data

Every derivative carries `UNTRUSTED_EXTERNAL` provenance separately from application-supplied policy. `TenantDerivativeCache` partitions sanitized derivatives by tenant. `TenantTelemetry` records only generated record IDs, fixed state/modality/trust/reason codes, redaction categories, and an HMAC-derived tenant key; reads are tenant-filtered. Decision and creative handoff helpers accept only a same-tenant sanitized derivative and emit allowlisted facts plus provenance. They do not include originals, external source IDs, approval claims, or arbitrary evidence text.

The original vault is an in-memory demonstration with an explicit TTL and private-review setting. It does not provide encryption at rest, durable retention, distributed access control, actor-level authorization, revocation, or audit storage. A production adapter must implement those controls from accepted contracts. The typed action fence in `src/security/content_boundary/policy.py` checks an immutable capability set, unit ceiling, and app-supplied approved-capability set. It accepts no evidence text or caller-supplied approval identifier. Its approval check is capability-level only; it cannot replace the missing issuer, actor, tenant, project, asset/version/hash, intended-use, expiry, and revocation contract.

An optional injection classifier helper returns an annotation or `None`; it cannot modify the action policy. Its result is never authorization. No provider or paid calls are made here. Downstream integrations must preserve provenance and pass untrusted facts as data, never splice them into privileged instructions. This scaffold has no prompt builder or creative engine integration to verify that end-to-end behavior.

## Local verification

With Python 3.9.6, the following direct standard-library commands passed for the synthetic fixture suite:

```sh
python3 -m unittest discover -s tests/privacy -v
python3 -m unittest discover -s tests/security/injection -v
python3 -m py_compile src/privacy/boundary.py src/privacy/flows.py src/security/content_boundary/policy.py
```

The privacy suite has 14 tests and exercises canaries through the sanitized cache, tenant-filtered telemetry, decision state, and creative payload, plus tenant isolation, retention expiry, cancellation, forged internal objects, and retry tags. The policy suite has 3 tests and forces classifier misses, failures, unavailability, and malformed results while checking unchanged deterministic capability, budget, and approval constraints. These are local unit fixtures; no EI runner, live application integration, provider result, or release evidence exists on this branch.

Use the agreed shared-contract and authenticated application interfaces once they are available, then replace these internal scaffold types with reviewed adapters and exercise the actual application routes. EI-09 remains open until the required integrated acceptance cases and release evidence execute on pinned producer/consumer revisions.
