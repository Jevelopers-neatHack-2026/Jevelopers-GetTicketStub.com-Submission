# Evidence audit

`tools/audit_evidence.py` is a read-only, stdlib-only (Python 3.9+) integrity check for the evidence tree and the acceptance checklist. It needs no network and no dependencies.

```
python3 tools/audit_evidence.py [--root .] [--evidence evidence] \
  [--checklist-json planning/acceptance-checklist.json] \
  [--checklist-md planning/acceptance-checklist.md]
python3 -m unittest discover -s tests
```

Exit code `0` means no errors; `1` means one or more errors. Stdout is deterministic, key-sorted JSON.

## Scope

Output always carries `"provider_mode": "N/A"` and `"scope": "integrity-only"`. The audit checks that files and records are internally consistent. It does not establish that anything is true of a live system, does not contact any provider, never writes files, and never changes or promotes a status. It does not classify evidence: a reference that happens to contain "mock" is not treated specially, and a structurally complete `verified` entry passes as structural success only, never as proof of live behavior.

## Checks

| Code | Meaning |
| --- | --- |
| `no-manifests`, `manifest-empty`, `manifest-unreadable` | No `SHA256SUMS` found, or one is empty/unreadable |
| `malformed-entry` | Line is not `<64 lowercase hex>  <path>` |
| `duplicate-entry` | Same path listed twice in one manifest |
| `path-traversal`, `unsafe-path` | `..`, absolute, backslash, empty or `.` segments, NUL |
| `symlink-dir` | The evidence root or any directory under it is a symlink; it is reported, never silently skipped |
| `not-regular-input` | A manifest or checklist input is not a regular file (FIFO, device, socket, directory, or a symlink to one); it is rejected before reading, so the audit cannot block |
| `dir-unreadable`, `evidence-not-dir` | An evidence directory cannot be listed, or the evidence root exists but is not a directory |
| `symlink-escape` | Manifest or listed path resolves outside the manifest directory (or outside the repo for the manifest itself) |
| `missing-file`, `not-regular-file`, `file-unreadable` | Listed file absent, not a regular file, or unreadable |
| `hash-mismatch` | SHA-256 differs from the manifest |
| `input-too-large` | A manifest or checklist file exceeds the 1 MiB metadata limit |
| `duplicate-key` | A JSON object repeats a key (ambiguous; rejected without reading either value) |
| `duplicate-status` | A Markdown criterion has more than one status line, even if they agree |
| `empty-checklist` | The JSON `criteria` list or the Markdown criterion set is empty |
| `invalid-id`, `json-shape`, `json-unreadable` | Missing, non-string or malformed criterion ID (`ABC-12` form); non-object criterion, wrong top-level type; unparseable JSON |
| `duplicate-id`, `unknown-state`, `allowed-states` | Duplicate criterion ID; missing, non-string or disallowed status; status outside `planned, in_progress, blocked, verified, deferred`; JSON `allowed_statuses` altered |
| `checklist-disagreement` | An ID is in only one of Markdown/JSON, or the statuses differ |
| `checkbox-mismatch` | Markdown `[x]` is not exactly the `verified` state |
| `verified-missing-evidence`, `verified-missing-revisions` | A verified entry lacks nonempty `evidence_refs` or `tested_revision_refs` |

Markdown criteria are `### ID title` headings; the whole block up to the next heading is scanned and must hold exactly one `- [ ] **Status** ...` line. Criterion IDs are limited to 64 characters. Errors never echo file contents, status values, input paths, manifest paths or arbitrary IDs. The `file` field uses fixed checklist labels, `evidence`, or a 1-based evidence-manifest index in sorted discovery order. The report retains at most 100 detailed errors, sets `errors_truncated` when more exist, and keeps complete per-code totals in `error_counts`.

## Limits

- Verifies integrity, not truthfulness: a hash match or non-empty ref says nothing about whether the evidence is genuine or current.
- Refs are checked for non-emptiness only; URLs and revisions are not resolved.
- Only files named `SHA256SUMS` are discovered; evidence files absent from a manifest are not flagged.
- Symlinks that stay inside the manifest directory are allowed.

## CI

`.github/workflows/evidence-audit.yml` runs the unit tests and the real audit on pull requests and pushes to `main` that touch the tool, tests, docs, checklists or evidence. It uses read-only `contents` permission and no secrets, and writes nothing back. The audit and tests make no provider calls; CI fetches the pinned actions and repository and may download Python. Actions are pinned to full commit SHAs (checkout v7.0.1, setup-python v7.0.0).
