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

Output always carries `"provider_mode": "N/A"` and `"scope": "integrity-only"`. The audit checks that files and records are internally consistent. It does not establish that anything is true of a live system, does not contact any provider, never writes files, and never changes or promotes a status. Mock or fixture evidence cannot raise a status; a `verified` entry whose evidence refs all contain "mock" is an error.

## Checks

| Code | Meaning |
| --- | --- |
| `no-manifests`, `manifest-empty`, `manifest-unreadable` | No `SHA256SUMS` found, or one is empty/unreadable |
| `malformed-entry` | Line is not `<64 lowercase hex>  <path>` |
| `duplicate-entry` | Same path listed twice in one manifest |
| `path-traversal`, `unsafe-path` | `..`, absolute, backslash, empty or `.` segments, NUL |
| `symlink-escape` | Manifest or listed path resolves outside the manifest directory (or outside the repo for the manifest itself) |
| `missing-file`, `not-regular-file`, `file-unreadable` | Listed file absent, not a regular file, or unreadable |
| `hash-mismatch` | SHA-256 differs from the manifest |
| `duplicate-id`, `unknown-state`, `allowed-states` | Duplicate criterion ID; status outside `planned, in_progress, blocked, verified, deferred`; JSON `allowed_statuses` altered |
| `checklist-disagreement` | An ID is in only one of Markdown/JSON, or the statuses differ |
| `checkbox-mismatch` | Markdown `[x]` is not exactly the `verified` state |
| `verified-missing-evidence`, `verified-missing-revisions`, `verified-mock-evidence` | A verified entry lacks nonempty `evidence_refs` or `tested_revision_refs`, or cites only mock evidence |

Markdown criteria are `### ID title` headings followed by a `- [ ] **Status** ...` line. Errors never echo file contents or malformed lines; only codes, line numbers, IDs and escaped, length-bounded manifest paths.

## Limits

- Verifies integrity, not truthfulness: a hash match or non-empty ref says nothing about whether the evidence is genuine or current.
- Refs are checked for non-emptiness only; URLs and revisions are not resolved.
- Only files named `SHA256SUMS` are discovered; evidence files absent from a manifest are not flagged.
- Symlinks that stay inside the manifest directory are allowed.
