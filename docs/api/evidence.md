# Operational evidence references (CI-10, local slice)

`@jevelopers/cost-intelligence/evidence` implements CI-10.1 reference typing and the local part of CI-10.2 lookup. Its original lookup functions read through an injected store. The additive `createPostgresEvidenceReader` factory supplies a private PostgreSQL transaction for each lookup of existing ledger references. Both paths return no trace bodies, prompts, URLs or amounts and write no financial records. Constructing the factory opens no connection; invoking its lookup methods does.

## References

`EvidenceReference` has four statuses: `resolved` (the only one carrying `namespace` and `id`), `unknown`, `unavailable` (with a reason) and `not_applicable` (with a reason). The non-resolved variants reject any id, so a missing value cannot be fabricated. Ids reject whitespace, `/`, `?`, `#` and `@`, so URLs, URL paths and query strings cannot be stored as references. Hash and commit kinds require `sha256:<64 hex>` and 40/64-hex respectively.

The kind-to-namespace registry in `src/evidence/index.ts` is a **local policy**, not an accepted shared-contracts vocabulary. Provider request ids (`provider:<name>` namespace) are `correlation_only`; trace, session, checkpoint, design and build refs are `evidence_only`; only ledger identities are `ledger_identity`. Every result carries `billingAuthority: false`.

## Lookups

Every public output is an explicit allowlist projection of the store row (no object spreading). Malformed or URL-shaped source fields are dropped and surfaced as `malformed_source_field` or `unavailable: broken_link`, never echoed. The reverse lookup passes the full resolved reference (kind, namespace, id) to the store and rechecks each returned row for an exact match.

Both lookups authorize with the existing `ledger.readSnapshot` grant (no new permission) and read through an injected `EvidenceLinkStorePort` that must filter by scope. Returned rows are re-verified against the requested scope. An absent posting and a posting in another tenant/project/environment/billing mode are indistinguishable (`not_found`).

The validated request is copied and frozen before any asynchronous authorization or storage work. Each raw host authority response is copied into private data before the shared authorization gate validates it, so later mutation of a retained host object cannot replace the principal revision that the gate checked. Store results are copied before another await can change their scope-checked identities or allowlisted fields. The current grant is checked at entry, after the posting read before any related-observation read, and after the last read before disclosure. Absent and unavailable read results go through the same renewed authorization. A denied, expired, unavailable or scope-mismatched decision returns only its safe error envelope, with no retained evidence. A changed membership or service-grant revision also refuses the lookup; the caller can start a new request under the new revision. These checks use the configured host authority on every call and do not establish a real issuer integration or an export disclosure fence.

Raw authority snapshots preserve own-key semantics so malformed response fields remain invalid after copying. An authority value that cannot be copied produces only the existing safe unavailable envelope before any evidence read.

- `lookupPostingEvidence`: posting to source observations (same logical operation), reservation, rate/rule versions and typed operational refs.
- `lookupByOperationalReference`: reverse lookup by a resolved, validated, indexed kind. Matches are links only; an empty result is declared as not proof of zero usage.

Completeness gaps are returned explicitly (`reconciliation_lineage_not_linked`, `adjustment_lineage_not_linked`, `export_lineage_not_linked`, `reference_kinds_not_indexed`, `result_limit_reached`, ...).

## PostgreSQL reader

`createPostgresEvidenceReader({ database, clock, financeAuthority })` is exported from the package root and evidence subpath. It exposes the same two request/result shapes with no raw store or transaction capability. The whole lookup runs through a restricted runtime connection, current authorization, existing scope bindings, feature health and the controlled-audit partition gate. Any observed database, privacy, health or related-read fault suppresses the entire result, including a posting retained from an earlier successful read. Its additive migration is `0014_evidence_reader_indexes.sql`.

See [PostgreSQL evidence reader](./evidence-postgres.md) for the required host adapter, supported stored fields, transaction observation boundary and validation commands. Model results do not qualify PostgreSQL behavior. The real PostgreSQL suite is a separate mandatory CI step and part of the integration/release file requirement.

## Not delivered here

- Real PostgreSQL qualification and host/consumer acceptance remain required. Adding the adapter and test source does not establish those outcomes.
- Trace, run, design, artifact, commit/build and session/checkpoint refs are reported `unavailable: source_not_integrated`; the ledger has no stored source for them, and an accepted shared-contracts mapping is required.
- Intake observations outside `financial_ledger_events` are not promoted into ledger evidence rows. The additive [stored-lineage reader](stored-lineage.md) now reads bounded intake/outbox and known reporting-snapshot input metadata, but does not promote those facts to ledger rows, return amounts, or re-fetch original provider bytes. Broader reconciliation, adjustment, export lineage and host/consumer acceptance remain separate gaps.
- Reconciliation, adjustment and export lineage linkage; CI-10.3 and CI-10.4 behavior.
