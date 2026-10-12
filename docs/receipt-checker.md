# Receipt metadata checker

A local, offline, dependency-free check of the **shape** of a filled [consumer acceptance receipt](consumer-acceptance-receipt.md), written as JSON. It is a governance aid. It adds no cross-repo contract, replaces no canonical acceptance runner, and changes no receipt format: the JSON mirrors the YAML template (`receipt`, `producer`, `consumer_run`, `stages`).

```sh
node scripts/check-consumer-receipt.mjs receipt.json
node --test tests/consumer-receipt.test.mjs
```

Library use: `import { checkReceipt } from './scripts/check-consumer-receipt.mjs'` returns `{ status, errors, notice }` for an already-parsed value.

## What the result means

| Status | Exit | Meaning |
| --- | --- | --- |
| `METADATA_COMPLETE` | 0 | Every required field is present, well-formed and internally consistent. |
| `INCOMPLETE` | 1 | Well-formed so far, but something is `null`, missing, empty, or a recorded exit code, failure count or skip count is nonzero. |
| `INVALID` | 2 | Something is malformed, inconsistent, unknown, or the file could not be read safely. |

`METADATA_COMPLETE` describes only the metadata that was supplied. It does **not** verify that any command ran, that hashes match real artifacts, that links exist, that a named person exists or agreed, or that anything may be merged or released. All owner and reviewer claims are unverified text. Counts are not coverage proof, and the checker does not require 76 contract names (only positive counts, with `schema_versions >= contract_names`).

Output is JSON on stdout: `status`, `errors` (`{code, path}`) and a fixed `notice`. Codes and paths are fixed strings from the checker. Receipt values, unknown key names and file paths are never printed.

## Rules checked

- **Missing vs null:** an absent key is `MISSING_FIELD`, an explicit `null` is `NULL_FIELD`; both make the receipt `INCOMPLETE`. Unknown keys are `INVALID`.
- **Identity:** `consumer` is one of the nine named consumers; `candidate` equals `producer.package_version`; both are SemVer 2.0.0 (numeric prerelease identifiers have no leading zeros; `+build` metadata is allowed). `recorded_at` is a UTC timestamp (`YYYY-MM-DDTHH:MM:SSZ`).
- **Hashes:** `source_sha`, `base_sha`, `tree_sha`, `consumer_sha`, `consumer_tree` are 40 lowercase hex. `archive_sha256` is 64 hex. `content_digest`, `fixture_digest` are `sha256:<64 hex>`. `archive_sri` is `sha512-` plus base64 that decodes to exactly 64 bytes. `installed_from` must be the archive digest (bare or `sha256:`-prefixed) and equal `archive_sha256`; a path is not accepted because it cannot be matched.
- **Schema manifest:** `producer.schema_hashes` is an object `{ "url": ..., "digest": "sha256:..." }`. The URL must be a GitHub `blob`/`raw` URL pinned to the same 40-hex SHA as `source_sha`.
- **Evidence links** (`evidence_links`, `producer_review`, `acknowledgement_ref`, stage `evidence_ref`): immutable GitHub references only: sha-pinned file, `commit/<sha>`, an issue or PR comment permalink, or `actions/runs/<id>`. Branches, bare issue or PR URLs, query strings and other hosts are `INVALID`. `evidence_links` must be non-empty.
- **Run results:** `type_check` and each scenario carry `command` and `exit_code`. Commands are stored as text and **never executed**. `counts.*` are non-negative integers; `tests` of 0 is `INCOMPLETE`. `failures` and `skips` are `{ "count": n, "identifiers": [...] }` and `count` must equal the number of identifiers (`MISMATCH` otherwise); a nonzero count is `INCOMPLETE`.
- **Environment:** `node` is `x.y.z` (no `v`), at least 22.23.3 within 22 or at least 24.21.0 within 24.
- **Limits and authority:** `limitations` must be a non-empty list of non-blank strings. Required human text (`command`, `os`, limitations, scope) must contain a non-whitespace character. `authority` is `"synthetic"` or `{ "reference_id", "digest" }` for an owner-held reference by identifier and digest.
- **Stages:** each stage key must be present and is either `null` (pending, allowed) or a structured object of references (`evidence_ref`, `evidence_digest`, `scope_and_limitations`; `domain_owner_acceptance` uses the template's own sub-fields, each nullable). `true`, `"approved"` and other scalars are `INVALID`. Filled stages are not required for completeness and are not verified when present.
- **Producer review:** `producer.producer_review` may be `null`; the key must exist.

## Limits

Output lists at most 100 diagnostics, but status severity is computed over every finding: a malformed value past the cap still makes the result `INVALID`. The file is opened non-blocking and must be a regular file (checked with `fstat` before any read), so FIFOs, devices and directories are `FILE_UNREADABLE` without hanging. Files over 1 MiB, nesting deeper than 64, non-UTF-8 text, directories, and unparseable JSON are `INVALID` with a fixed code (`FILE_TOO_LARGE`, `DEPTH_EXCEEDED`, `JSON_MALFORMED`, `FILE_UNREADABLE`, `USAGE`). The checker makes no network calls and never writes files. Free-text fields (limitations, commands) are length- and control-character-checked, not scanned for secrets; keep secrets out of receipts as the evidence rules require.
