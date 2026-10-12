# Evidence record

Copy this template for an actual scoped check. Replace every bracketed field with observed evidence. Use unknown or not applicable with a reason when appropriate; never invent a value. Fictional examples are in standards/acceptance-evidence.md.

## Identity and scope

- Record title:
- Criterion state: planned / in_progress / blocked / verified / deferred
- Acceptance IDs, or N/A and rationale:
- Owning repository:
- Issue URL:
- Owner role:
- Execution date/time and timezone (record separately from review date):
- Reviewer role and review date/time and timezone:
- Tested full commit SHA, or assembled-manifest revision and digest:
- Runtime and configuration:
- Environment:
- Input or fixture identity and digest:
- Evidence origin/provenance for each artifact (for example, independent synthetic, recorded, sandbox-derived, live, or unknown with reason):
- If recorded: source/run or artifact reference; original source origin and execution mode; exact source revision when available; capture date/time and timezone; captured-by role when known; artifact identity/digest; access class and redaction status:
- If replayed: recorded source artifact reference and digest; transformations/redactions; replay procedure and exact checker revision; replay date/time and timezone:

## Procedure and result

- Command/procedure:
- Expected result:
- Actual result:
- Execution outcome: pass / fail / skipped / error / N/A with rationale
- Execution/provider mode by component for this procedure: mock (including offline replay) / sandbox / live / N/A with rationale
- Evidence URL(s) and hash(es), where available:
- Access class and redaction review:
- Budget, cost, usage, or explicit unknown:
- Limitations and mandatory skips:
- Blocker owner role and unblock condition:
- Staleness trigger or superseding record:

## Decision

- What exact scoped claim does this record support?
- What does it not establish?
- Who may propose the authoritative status change?
- Was the integration-evals master tracker updated by its owner? If not, leave it pending.

Record artifact provenance separately from the mode used by the current procedure. A recorded live-origin input replayed offline has recorded provenance and mock/offline replay mode; it is not a fresh live run. For human decisions, use the standard's `Pass` → `passed` and `Fail` → `failed` wording crosswalk; it does not prescribe integration-evals machine fields or serialization. Integration-evals owns defining those schemas and validators; do not assume an unpublished schema exists.
