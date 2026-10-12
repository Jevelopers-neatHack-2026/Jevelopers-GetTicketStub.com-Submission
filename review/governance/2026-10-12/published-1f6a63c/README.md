# Published LP-09 candidate verification

Refs [LP-09 #11](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/issues/11).

The fetched published source is [`1f6a63c33946c36999f9cad50aed57405a3bab91`](https://github.com/Jevelopers-neatHack-2026/landing-page-repo/commit/1f6a63c33946c36999f9cad50aed57405a3bab91). Its complete tree `eefe6241693c82b636c10067623bf18108e783e6` is identical to the independently reviewed repaired local head `581afccfa8453152f8a59740003f73a4ae3e6d76`. The [transfer record](transfer.json) binds these identities and the full-tree equality check.

These are **new local executions against the reachable published commit**, using Node **24.15.0**. The [command record](commands.json) includes expanded arguments, timestamps, actual exit codes and stdout/stderr hashes. They are local checks and explicitly synthetic fixtures, not GitHub Actions, browser/provider or publication evidence.

| Check | Actual outcome |
|---|---|
| Complete-tree equality | Equal tree IDs; full diff exits 0 |
| Build | PASS; 11 source files |
| Full repository tests | PASS; 157 passed, zero failed, zero skipped |
| Governance draft | PASS_DRAFT; 22 tests passed, exit 0 |
| Governance release | **FAIL**, exit 1; named maintainer/backup and accountable Product/marketing/brand/Finance acceptance remains unconfirmed |
| All draft suites | **FAIL**, exit 1; this standalone branch does not yet include the required brand validator |
| Diff check against published parent | PASS; exit 0 |

The [independent review](independent-review.json) confirms GOV-R1 and GOV-R2 are repaired and records **no remaining actionable code findings**. This scoped review does not supply accountable acceptance, publication permission or issue/gate/epic closure.

The original [REQUEST_CHANGES](../revision-02/independent-review-request-changes.json), [failing regression-only evidence](../revision-02/reproduction.json), and [repaired local run record](../revision-02/runs.json) remain unchanged. Their original local source revisions and execution results are not relabeled as runs of this published commit.

The [built artifact manifest](artifact-manifest.json) retains SHA-256 `389e41ab3e2f32b9169cd70db129b01466a329dde74e1c6874ebbdba1df56470`. The combined integration candidate must be checked with the separate brand slice present; the recorded standalone all-draft failure is still a failure. Final-candidate and postmerge verification must identify their actual revisions.
