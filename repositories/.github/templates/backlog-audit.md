# Backlog audit record

Use this template for one repository or a clearly bounded issue set. This is a local audit, not a duplicate acceptance tracker.

- Repository and inspected full revision:
- Audit date and reviewer role:
- Authoritative source path, exact inspected revision, and discovery date (retain historical snapshots separately from current navigation):
- Included/excluded issue URLs and reason:
- Source documents checked:
- Owner role and named-owner state:
- Priority and rationale:
- Required-for-v1 and rationale:
- Dependencies with exact issue URLs, producer/consumer roles, expected artifact/version, unblock condition, and status date:
- Execution/provider mode per criterion: mock / sandbox / live / N/A and reason; record an earlier capture's original mode separately:
- Validation performed and exact command/result:
- Evidence links and access class:
- Evidence origin/provenance and any recorded source/capture/replay references:
- Blocked, deferred, stale, failed, skipped, or unknown items:

## Criterion-to-evidence rows

| Acceptance ID or justified N/A | Local issue URL | State | Actual outcome | Evidence origin/source/capture/replay | Current execution mode by component | Exact tested revision | Evidence link/hash | Gap or unblock action |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |

Do not mark a master ID verified here. Propose a status update to the owning role in integration-evals with the full evidence record. A missing owner, SHA, artifact, result, or reviewer remains unknown. Treat a moving branch as navigation only, record the exact revision/date actually inspected, and do not reuse a historical tracker snapshot as current status. Integration-evals owns defining and implementing any machine-readable schema, joins, and validators.
